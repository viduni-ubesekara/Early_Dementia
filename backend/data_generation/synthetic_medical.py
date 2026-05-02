"""
Synthetic Medical Dataset: clinical history, reports, imaging.
Labels: H, R, I sub-scores and medical_risk_score M via the
imaging-dominant sub-fusion (NIA-AA 2018; Frisoni 2010).

Now also includes:
  - age (40..95, weighted toward 60..85 to match dementia screening
    populations)
  - education_years (0..20)
  - anxiety (independent of dementia frailty)

These let the inference layer apply Crum 1993 MMSE norms and the
Salthouse 1996 RT-by-age curve (see fusion_formulas).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .fusion_formulas import medical_subfusion


def generate_medical(
    n: int = 5000, seed: int = 42, noise_std: float = 2.5
) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rows = []

    for i in range(n):
        # Latent frailty (drives most clinical findings).
        f = float(
            0.35 * rng.uniform(0, 1)
            + 0.65 * rng.beta(0.85, 0.85)
        )
        f = float(np.clip(f, 0.01, 0.99))

        # Age: weighted toward older population, but with realistic
        # spread - matches the typical memory clinic referral age
        # distribution (mean ~70, sd ~10).
        age = float(np.clip(rng.normal(60 + 25 * f, 8.0), 40, 95))
        # Education years: weakly anti-correlated with frailty, but
        # sampled with wide noise (range typical of community samples).
        education_years = float(np.clip(
            rng.normal(13 - 4 * f, 3.5), 0, 20
        ))
        # Anxiety is an *independent* axis from dementia frailty - this
        # is critical so the trained models can learn that anxiety does
        # not imply dementia.
        anxiety = int(rng.random() < 0.18)

        dementia_history = int(rng.random() < 0.1 + 0.35 * f)
        stroke_history = int(rng.random() < 0.05 + 0.15 * f)
        parkinsons = int(rng.random() < 0.03 + 0.1 * f)
        diabetes = int(rng.random() < 0.12 + 0.15 * f)
        hypertension = int(rng.random() < 0.2 + 0.2 * f)
        depression = int(rng.random() < 0.1 + 0.25 * f)
        medication_load = int(rng.integers(0, 12))
        med_noise = float(rng.normal(0, 0.5))

        # Clinical sub-score H (history-driven, 0-100).
        h_raw = (
            dementia_history * 22
            + stroke_history * 16
            + parkinsons * 12
            + diabetes * 6
            + hypertension * 4
            + depression * 8
            + min(20, medication_load * 1.2)
        ) + med_noise
        H = float(np.clip(h_raw * (0.6 + 0.4 * f) + rng.normal(0, noise_std), 0, 100))

        mmse_prev = float(rng.normal(28 - 8 * f, 1.2))
        mmse_prev = float(np.clip(mmse_prev, 5, 30))
        decline = float(rng.gamma(1.0 + 3 * f, 0.3))
        physician_rating = int(rng.integers(1, 5))
        confusion = int(rng.random() < 0.1 + 0.5 * f)
        memory_loss = int(rng.random() < 0.15 + 0.45 * f)

        r_raw = (30 - mmse_prev) * 2.0 + decline * 8 + (physician_rating - 1) * 10
        r_raw += confusion * 8 + memory_loss * 6
        R = float(np.clip(r_raw + rng.normal(0, noise_std), 0, 100))

        hipp = float(rng.normal(4000 - 2000 * f, 200))
        hipp = float(np.clip(hipp, 2000, 5000))
        atrophy = float(rng.integers(0, 4))
        cort = float(rng.normal(2.4 - 0.4 * f, 0.08))
        cort = float(np.clip(cort, 1.8, 2.8))
        lesion = float(rng.gamma(0.5 + 2 * f, 1.0))
        alz_pattern = int(rng.random() < 0.02 + 0.35 * f)

        i_raw = (
            max(0, (4500 - hipp) / 25.0) * 3
            + atrophy * 8
            + max(0, 2.6 - cort) * 30
            + min(20, lesion * 2)
            + alz_pattern * 15
        )
        I = float(np.clip(i_raw + rng.normal(0, noise_std), 0, 100))

        # Imaging-dominant sub-fusion - new clinical-validated weights.
        M = float(medical_subfusion(H, R, I))
        M = float(np.clip(M * (0.7 + 0.45 * f) + rng.normal(0, noise_std * 0.75), 0, 100))
        if float(rng.random()) < 0.12:
            M = float(np.clip(0.55 * M + 0.45 * rng.uniform(55, 99), 0, 100))
        if float(rng.random()) < 0.08:
            M = float(np.clip(0.7 * M + 0.3 * rng.uniform(0, 25), 0, 100))
        if float(rng.random()) < 0.1:
            M = float(max(M, float(rng.uniform(70, 99))))
        medical_risk_score = M

        rows.append(
            {
                "patient_id": i + 1,
                "age": age,
                "education_years": education_years,
                "anxiety": anxiety,
                "dementia_history": dementia_history,
                "stroke_history": stroke_history,
                "Parkinsons": parkinsons,
                "diabetes": diabetes,
                "hypertension": hypertension,
                "depression": depression,
                "medication_load": medication_load,
                "MMSE_previous_score": mmse_prev,
                "MMSE_decline_rate": decline,
                "physician_rating": physician_rating,
                "confusion_reported": confusion,
                "memory_loss_reported": memory_loss,
                "hippocampal_volume": hipp,
                "brain_atrophy_level": atrophy,
                "cortical_thickness": cort,
                "lesion_score": lesion,
                "Alzheimer_pattern_detected": alz_pattern,
                "H_clinical_risk": H,
                "R_report_risk": R,
                "I_imaging_risk": I,
                "medical_risk_score": medical_risk_score,
            }
        )

    return pd.DataFrame(rows)
