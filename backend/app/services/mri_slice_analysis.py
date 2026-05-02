"""
MRI axial-slice analysis for the medical form.

Matches the Colab notebook pipeline (MobileNetV2, 224×224, preprocess_input) when
`best_mri_model.keras` is available (copy from Colab `mri_artifacts/` into `backend/ml_artifacts/`).

Real volumetry (mm³, mm) is not recovered from a single 2D slice — we map the 4-class
dementia-severity head to *proxy* values aligned with the synthetic feature ranges used by M / R / I.
"""

from __future__ import annotations

import io
import os
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

CLASS_LABELS = (
    "Non-Demented",
    "Very Mild",
    "Mild",
    "Moderate",
)

# Rows: class index → [hippocampal_volume, brain_atrophy_level, cortical_thickness, lesion_score, physician_rating]
_FIELD_TABLE = np.array(
    [
        [4300.0, 0.0, 2.55, 0.5, 1.0],
        [4000.0, 1.0, 2.35, 2.0, 2.0],
        [3300.0, 2.0, 2.05, 4.5, 3.0],
        [2600.0, 3.0, 1.75, 7.5, 4.0],
    ],
    dtype=np.float64,
)

_MODEL: Any = None

MAX_UPLOAD_BYTES = 20 * 1024 * 1024


def default_model_path() -> Path:
    env = os.environ.get("MRI_MODEL_PATH")
    if env:
        return Path(env)
    return Path(__file__).resolve().parents[2] / "ml_artifacts" / "best_mri_model.keras"


def _load_keras_model():
    global _MODEL
    if _MODEL is not None:
        return _MODEL
    path = default_model_path()
    if not path.is_file():
        return None
    try:
        import tensorflow as tf  # noqa: PLC0415

        _MODEL = tf.keras.models.load_model(path, compile=False)
    except Exception:
        _MODEL = None
        return None
    return _MODEL


def _pil_to_rgb_224(data: bytes) -> np.ndarray:
    im = Image.open(io.BytesIO(data))
    im = im.convert("RGB")
    im = im.resize((224, 224), Image.Resampling.BILINEAR)
    return np.asarray(im, dtype=np.float32)


def _preprocess_mobilenet(rgb_224: np.ndarray) -> np.ndarray:
    try:
        import tensorflow as tf  # noqa: PLC0415

        out = tf.keras.applications.mobilenet_v2.preprocess_input(rgb_224)
        return np.asarray(out, dtype=np.float32)
    except Exception:
        # Same scaling family as MobileNet v2 on 0–255 floats.
        return rgb_224 / 127.5 - 1.0


def _fields_from_probs(probs: np.ndarray) -> dict[str, Any]:
    probs = np.asarray(probs, dtype=np.float64).reshape(4)
    probs = np.clip(probs, 1e-8, 1.0)
    probs = probs / probs.sum()
    blended = (probs.reshape(4, 1) * _FIELD_TABLE).sum(axis=0)
    alz_prob = float(probs[2] + probs[3])
    return {
        "hippocampal_volume": float(np.clip(blended[0], 1500.0, 5500.0)),
        "brain_atrophy_level": int(np.clip(round(blended[1]), 0, 3)),
        "cortical_thickness": float(np.clip(blended[2], 1.5, 3.0)),
        "lesion_score": float(np.clip(blended[3], 0.0, 10.0)),
        "physician_rating": int(np.clip(round(blended[4]), 1, 4)),
        "Alzheimer_pattern_detected": int(alz_prob >= 0.28),
    }


def _heuristic_probs(rgb_224: np.ndarray) -> np.ndarray:
    """Fallback when TensorFlow or weights are missing — demo-only mapping."""
    gray = (
        0.299 * rgb_224[..., 0] + 0.587 * rgb_224[..., 1] + 0.114 * rgb_224[..., 2]
    ) / 255.0
    gy = np.abs(np.diff(gray, axis=0)).mean()
    gx = np.abs(np.diff(gray, axis=1)).mean()
    edge = float((gx + gy) / 2)
    spread = float(np.std(gray))
    median = float(np.median(gray))
    sev = float(
        np.clip(0.38 * (1.0 - median) + 0.32 * spread + 0.30 * min(edge * 4.0, 1.0), 0.0, 1.0)
    )
    # Softer distribution at low severity (most clinical slices skew “mild”).
    p = np.array(
        [
            (1.0 - sev) ** 2,
            2.0 * sev * (1.0 - sev),
            (sev**1.4) * 0.85,
            (sev**3) * 0.6,
        ],
        dtype=np.float64,
    )
    p = np.clip(p, 1e-6, None)
    return p / p.sum()


def analyze_mri_image_bytes(data: bytes) -> dict[str, Any]:
    if len(data) > MAX_UPLOAD_BYTES:
        raise ValueError("file_too_large")

    rgb = _pil_to_rgb_224(data)
    model = _load_keras_model()

    if model is not None:
        x = _preprocess_mobilenet(rgb)
        batch = np.expand_dims(x, axis=0)
        probs = np.asarray(model.predict(batch, verbose=0), dtype=np.float64).reshape(4)
        probs = np.clip(probs, 1e-8, 1.0)
        probs = probs / probs.sum()
        method = "keras_model"
        note = (
            "Predictions from your trained MobileNetV2 head (4-class). Values below are *proxies* "
            "for the medical form, not true mm³ / radiology reads."
        )
    else:
        probs = _heuristic_probs(rgb)
        method = "heuristic_fallback"
        note = (
            "No Keras weights found (copy best_mri_model.keras to backend/ml_artifacts/ and install "
            "TensorFlow). Using a rough image-statistics fallback — not for clinical use."
        )

    argmax = int(np.argmax(probs))
    suggested = _fields_from_probs(probs)

    return {
        "method": method,
        "class_probs": {CLASS_LABELS[i]: float(probs[i]) for i in range(4)},
        "predicted_class_id": argmax,
        "predicted_label": CLASS_LABELS[argmax],
        "confidence": float(probs[argmax]),
        "suggested_fields": suggested,
        "note": note,
    }
