"""
Synthetic Cognitive Session Dataset (one row per patient session).

Updated to use the validated formulas from `fusion_formulas`:
  - C is computed via `compute_C_weighted` with each patient's age
    and education years (so the synthetic data reflects the same
    Crum 1993 norm adjustments that the live API now applies).
  - P uses the age-normed reaction-time curve.
  - B uses the bug-fixed compute_B (no more 39 floor).
  - Anxiety modulates behavioral signals (slow RT, more hesitation,
    more errors-due-to-second-guessing) WITHOUT raising the
    underlying cognitive frailty - so the trained classifier learns
    that anxiety + clean cognition != dementia.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .fusion_formulas import (
    class_from_S,
    compute_B,
    compute_C_weighted,
    compute_P,
    compute_S,
)


def generate_cognitive_and_match_medical(
    medical_df: pd.DataFrame, seed: int = 7, noise_std: float = 1.8
) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    n = len(medical_df)
    out = []
    m_sorted = medical_df.sort_values("patient_id").reset_index(drop=True)

    for i in range(n):
        pr = m_sorted.loc[i]
        f_med = float(np.clip(float(pr["medical_risk_score"]) / 100.0, 0, 1))
        anxiety = int(pr.get("anxiety", 0))
        age = float(pr.get("age", 65.0))
        edu = float(pr.get("education_years", 12.0))

        u = float(rng.random())
        if u < 0.16:
            f_mix = float(rng.uniform(0, 0.12))
        elif u < 0.4:
            f_mix = float(rng.uniform(0.82, 0.995))
        else:
            f_mix = float(rng.normal(0.5, 0.18))
        f_mix = float(np.clip(f_mix, 0, 1))
        if 0.16 <= u < 0.4:
            f = float(np.clip(0.28 * f_med + 0.72 * f_mix, 0, 1))
        else:
            f = float(np.clip(0.5 * f_med + 0.5 * f_mix, 0, 1))
        wobble = float(rng.normal(0, noise_std))

        # Domain scores - memory drops fastest with frailty (Albert 2011).
        g = 1.0 + 0.45 * f**2
        memory = float(np.clip(
            rng.normal(20 - 9.0 * f * g, 0.9 + 0.6 * f) + wobble * 0.3, 0, 20
        ))
        orientation = float(np.clip(
            rng.normal(20 - 7.0 * f * g, 0.8 + 0.6 * f) + wobble * 0.3, 0, 20
        ))
        attention = float(np.clip(
            rng.normal(20 - 7.5 * f * g, 0.85 + 0.5 * f) + wobble * 0.3, 0, 20
        ))
        language = float(np.clip(
            rng.normal(20 - 5.5 * f * g, 0.8 + 0.45 * f) + wobble * 0.3, 0, 20
        ))
        visual = float(np.clip(
            rng.normal(20 - 7.0 * f * g, 0.9 + 0.55 * f) + wobble * 0.3, 0, 20
        ))

        # Behavior + performance: anxiety adds slowness/hesitation
        # WITHOUT shifting accuracy or cognitive frailty.
        rt_base = 0.8 + 1.6 * f**1.05
        rt_anx = 0.45 if anxiety else 0.0
        rt = float(max(0.2, rng.normal(rt_base + rt_anx, 0.2 + 0.2 * f)))

        acc_anx = 0.04 if anxiety else 0.0
        acc = float(np.clip(
            0.995 - 0.85 * f**1.05 - acc_anx + rng.normal(0, 0.08), 0, 1
        ))

        hes_anx = 6.0 if anxiety else 0.0
        hesitation = float(max(0, rng.normal(
            1 + 22 * f**1.2 + hes_anx, 1.5 + 2.0 * f
        )))

        err_hi = int(max(0, 2 + int(20 * f**1.2) + (1 if anxiety else 0)))
        errors = int(rng.integers(0, max(1, err_hi + 1)))

        comp_anx = 25.0 if anxiety else 0.0
        completion = float(max(30, rng.normal(
            70 + 100 * f**1.15 + comp_anx, 10 + 8 * f
        )))

        C = compute_C_weighted(
            orientation, memory, attention, language, visual,
            age=age, education_years=edu,
        )
        P = compute_P(acc, rt, age=age)
        B = compute_B(errors, hesitation, completion, n_questions=10)
        M = float(pr["medical_risk_score"])
        S = compute_S(C, B, P, M)
        risk = class_from_S(S)

        out.append(
            {
                "patient_id": int(pr["patient_id"]),
                "age": age,
                "education_years": edu,
                "anxiety": anxiety,
                "orientation_score": orientation,
                "memory_score": memory,
                "attention_score": attention,
                "language_score": language,
                "visual_spatial_score": visual,
                "reaction_time_avg": rt,
                "accuracy_rate": acc,
                "hesitation_time": hesitation,
                "error_count": errors,
                "completion_time": completion,
                "C": C,
                "B": B,
                "P": P,
                "S_session": S,
                "cognitive_risk_class": risk,
            }
        )
    return pd.DataFrame(out)


def build_fusion_table(cognitive_df: pd.DataFrame, medical_df: pd.DataFrame) -> pd.DataFrame:
    from .fusion_formulas import W_C, W_B, W_P, W_M, class_from_S

    m = medical_df[
        [
            "patient_id",
            "H_clinical_risk",
            "R_report_risk",
            "I_imaging_risk",
            "medical_risk_score",
        ]
    ].copy()
    j = cognitive_df.merge(m, on="patient_id", how="left")
    j["M"] = j["medical_risk_score"]
    # Same M-sign-correction as compute_S: M is reported as risk
    # (high=sick) but in S we use (100 - M) so the channel correctly
    # *lowers* S for sicker patients.
    j["S"] = (
        W_C * j["C"]
        + W_B * j["B"]
        + W_P * j["P"]
        + W_M * (100.0 - j["M"])
    )
    j["final_risk_label"] = j["S"].map(class_from_S)
    return j[
        [
            "patient_id",
            "age",
            "education_years",
            "anxiety",
            "C",
            "B",
            "P",
            "M",
            "S",
            "H_clinical_risk",
            "R_report_risk",
            "I_imaging_risk",
            "final_risk_label",
        ]
    ]


__all__ = [
    "generate_cognitive_and_match_medical",
    "build_fusion_table",
]
