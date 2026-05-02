"""
Webcam-frame confusion via Ultralytics YOLOv8 (Roboflow / Colab export).

Place weights at one of:
  - data/confusion_model/best.pt (repo root)
  - backend/ml_artifacts/confusion_yolo/best.pt
Or set CONFUSION_YOLO_PATH.

Install: pip install -r requirements-confusion.txt
"""

from __future__ import annotations

import io
import os
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

_MODEL: Any = None
_MODEL_PATH: Path | None = None

MAX_FRAME_BYTES = 4 * 1024 * 1024


def _repo_root() -> Path:
    # backend/app/services/confusion_yolo.py -> parents[3] = Viduni
    return Path(__file__).resolve().parents[3]


def default_model_path() -> Path | None:
    env = os.environ.get("CONFUSION_YOLO_PATH")
    if env:
        p = Path(env)
        return p if p.is_file() else None
    candidates = [
        _repo_root() / "data" / "confusion_model" / "best.pt",
        Path(__file__).resolve().parents[2] / "ml_artifacts" / "confusion_yolo" / "best.pt",
    ]
    for p in candidates:
        if p.is_file():
            return p
    return None


def _load_yolo():
    global _MODEL, _MODEL_PATH
    if _MODEL is not None:
        return _MODEL
    path = default_model_path()
    if path is None:
        return None
    try:
        from ultralytics import YOLO
    except ImportError:
        return None
    _MODEL = YOLO(str(path))
    _MODEL_PATH = path
    return _MODEL


def _class_to_emotion_and_score(class_name: str, class_id: int) -> tuple[str, float]:
    """Map YOLO class to UI emotion + 0..100 confusion (behavior aggregation)."""
    n = (class_name or "").lower().strip()

    high_kw = ("high", "severe", "strong", "heavy", "very")
    mid_kw = ("moderate", "medium", "mid", "mild")
    low_kw = ("low", "none", "no_", "clear", "not", "neutral", "minimal")

    if any(k in n for k in high_kw):
        return "confused", 82.0
    if any(k in n for k in mid_kw):
        return "confused", 52.0
    if any(k in n for k in low_kw) or n in ("focused", "attentive"):
        return "focused", 18.0

    # Fallback by id: assume higher id = more confusion (adjust if your yaml order differs)
    if class_id >= 2:
        return "confused", 75.0
    if class_id == 1:
        return "confused", 48.0
    return "neutral", 22.0


def analyze_confusion_frame_bytes(data: bytes) -> dict[str, Any]:
    if len(data) > MAX_FRAME_BYTES:
        raise ValueError("file_too_large")

    model = _load_yolo()
    if model is None:
        return {
            "method": "unavailable",
            "emotion": "neutral",
            "confusion_score": 15.0,
            "predicted_class_id": None,
            "predicted_label": None,
            "confidence": 0.0,
            "note": (
                "No YOLO weights or ultralytics missing. Copy best.pt to data/confusion_model/ "
                "or backend/ml_artifacts/confusion_yolo/ and pip install -r requirements-confusion.txt"
            ),
        }

    im = Image.open(io.BytesIO(data)).convert("RGB")
    results = model.predict(source=im, conf=0.22, verbose=False)
    names = getattr(results[0], "names", None) or {}

    if not results or results[0].boxes is None or len(results[0].boxes) == 0:
        return {
            "method": "yolo",
            "emotion": "neutral",
            "confusion_score": 14.0,
            "predicted_class_id": None,
            "predicted_label": None,
            "confidence": 0.0,
            "note": "No detection above threshold; treated as low confusion signal.",
        }

    boxes = results[0].boxes
    confs = boxes.conf.cpu().numpy()
    clss = boxes.cls.cpu().numpy().astype(int)
    i = int(np.argmax(confs))
    cls_id = int(clss[i])
    conf = float(confs[i])
    label = str(names.get(cls_id, f"class_{cls_id}"))
    emotion, confusion = _class_to_emotion_and_score(label, cls_id)

    return {
        "method": "yolo",
        "emotion": emotion,
        "confusion_score": float(round(min(100, max(0, confusion)), 1)),
        "predicted_class_id": cls_id,
        "predicted_label": label,
        "confidence": conf,
        "note": f"Inference from {_MODEL_PATH.name if _MODEL_PATH else 'weights'} (highest-confidence box).",
    }
