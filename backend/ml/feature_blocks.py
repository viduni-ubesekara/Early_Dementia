"""
Normalization (0-1 then *100 in fusion layer), one-hot for categoricals, noise (done at data gen), weighting.
Medical: apply sample_weight ~ importance (comorbidities) during regressor training.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import MinMaxScaler, OneHotEncoder

MED_NUMERIC = [
    "age",
    "education_years",
    "medication_load",
    "MMSE_previous_score",
    "MMSE_decline_rate",
    "hippocampal_volume",
    "brain_atrophy_level",
    "cortical_thickness",
    "lesion_score",
]
MED_BINARY = [
    "dementia_history",
    "stroke_history",
    "Parkinsons",
    "diabetes",
    "hypertension",
    "depression",
    "anxiety",
    "confusion_reported",
    "memory_loss_reported",
    "Alzheimer_pattern_detected",
]
MED_ORD: list = []  # one-hot `physician_rating` below


_DEFAULTS = {
    "age": 65.0,
    "education_years": 12.0,
    "anxiety": 0,
    "medication_load": 0,
    "MMSE_previous_score": 28.0,
    "MMSE_decline_rate": 0.1,
    "hippocampal_volume": 4000.0,
    "brain_atrophy_level": 0.0,
    "cortical_thickness": 2.4,
    "lesion_score": 0.0,
    "dementia_history": 0,
    "stroke_history": 0,
    "Parkinsons": 0,
    "diabetes": 0,
    "hypertension": 0,
    "depression": 0,
    "confusion_reported": 0,
    "memory_loss_reported": 0,
    "Alzheimer_pattern_detected": 0,
    "physician_rating": 2,
}


def medical_feature_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Build the medical feature matrix, filling clinical defaults for
    any missing columns (so inference works even when the caller sends
    a partial payload, and so old datasets without `age` /
    `education_years` / `anxiety` still load)."""
    cols = MED_NUMERIC + MED_BINARY + ["physician_rating"]
    out = df.copy()
    for c in cols:
        if c not in out.columns:
            out[c] = _DEFAULTS.get(c, 0)
        else:
            # Replace nulls with the clinical default for that feature.
            out[c] = out[c].fillna(_DEFAULTS.get(c, 0))
    return out[cols].copy()


def build_medical_preprocessor() -> ColumnTransformer:
    return ColumnTransformer(
        [
            ("num", MinMaxScaler(), MED_NUMERIC),
            (
                "bin",
                "passthrough",  # already 0/1
                MED_BINARY,
            ),
            (
                "phys_oh",
                OneHotEncoder(
                    categories=[[1, 2, 3, 4]],
                    drop=None,
                    sparse_output=False,
                    handle_unknown="error",
                ),
                ["physician_rating"],
            ),
        ]
    )


def medical_sample_weight(df: pd.DataFrame) -> np.ndarray:
    """Higher weight for rows with more clinical burden (synthetic research weighting)."""
    base = np.ones(len(df), dtype=np.float64)
    burden = (
        df["dementia_history"].values * 1.2
        + df["stroke_history"].values * 1.1
        + df["Alzheimer_pattern_detected"].values * 0.8
    )
    return base + burden


def medical_target(df: pd.DataFrame) -> np.ndarray:
    return df["medical_risk_score"].values.astype(np.float64)
