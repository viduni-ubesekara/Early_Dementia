"""Load models, compute C/B/P/M/S, fusion prediction, and explainability.

Clinical-validation upgrades (see CLINICAL_VALIDATION.md):
  - C is computed via the domain-weighted, age/education-adjusted
    `compute_C_weighted` (Crum 1993 norms + memory upweighting per
    Petersen 2004 / Albert 2011 NIA-AA MCI criteria).
  - P uses the age-normed reaction-time curve.
  - B uses the bug-fixed legacy formula (no longer floor-bounded at 39).
  - Top-level fusion uses the literature-justified weights from
    fusion_formulas (W_C=0.40, W_B=0.15, W_P=0.20, W_M=0.25).
  - Each prediction now also carries an `indeterminate` boolean and an
    indeterminate `reason` string, so border cases are explicitly
    routed to clinician review (Van Calster et al. 2019).
"""

from __future__ import annotations

import os
from typing import Any

import joblib
import numpy as np
import pandas as pd

from backend.app.config import MODEL_DIR
from backend.app.services.behavior_aggregation import compute_B_phase2
from backend.app.services.conversation_agent_scoring import (
    analyze_conversation_agent,
    apply_conversation_to_domains,
)
from backend.app.services.insight_engine import build_insights
from backend.data_generation.fusion_formulas import (
    IDX_TO_CLASS,
    INDETERMINATE_HALF_WIDTH,
    class_from_S,
    class_from_S_with_indeterminate,
    compute_B,
    compute_C_weighted,
    compute_P,
    compute_S,
)

_BUNDLE: dict[str, Any] = {}


def _path(p: str) -> str:
    return os.path.join(MODEL_DIR, p)


def load_models() -> None:
    if _BUNDLE:
        return
    _BUNDLE["medical"] = joblib.load(_path("medical_regressor.joblib"))
    for name in ("random_forest", "xgboost", "logistic_regression"):
        _BUNDLE[name] = joblib.load(_path(f"fusion_{name}.joblib"))


def predict_medical_full(medical_row: dict) -> dict[str, float]:
    """Return {M, H, R, I} (each 0-100). Falls back to legacy bundles
    that only have M."""
    load_models()
    bundle = _BUNDLE["medical"]
    cols = bundle["feature_columns"]
    # Drop schema-only fields the regressor was not trained on.
    safe_row = {k: medical_row.get(k, 0) for k in cols}
    df = pd.DataFrame([safe_row])[cols]
    pre = bundle.get("preprocessor")
    if pre is None:
        m = float(bundle["pipeline"].predict(df)[0])
        m = max(0.0, min(100.0, m))
        return {"M": m, "H": m, "R": m, "I": m}
    Xp = pre.transform(df)

    def _bound(v: float) -> float:
        return float(max(0.0, min(100.0, v)))

    M = _bound(float(bundle["M_model"].predict(Xp)[0]))
    H = _bound(float(bundle["H_model"].predict(Xp)[0]))
    R = _bound(float(bundle["R_model"].predict(Xp)[0]))
    I = _bound(float(bundle["I_model"].predict(Xp)[0]))
    return {"M": M, "H": H, "R": R, "I": I}


def predict_medical_risk(medical_row: dict) -> float:
    return predict_medical_full(medical_row)["M"]


def predict_fusion_vector(
    cbpm: list[float], model_name: str = "random_forest"
) -> tuple[str, float, np.ndarray, np.ndarray]:
    load_models()
    pack = _BUNDLE[model_name]
    clf, scaler = pack["clf"], pack["scaler"]
    X = np.array([cbpm], dtype=np.float64)
    Xs = scaler.transform(X)
    proba = clf.predict_proba(Xs)[0]
    classes_ = list(np.asarray(clf.classes_).astype(int))
    if len(classes_) == 4 and list(classes_) == [0, 1, 2, 3]:
        full = proba
    else:
        full = np.zeros(4, dtype=np.float64)
        for j, c in enumerate(classes_):
            if 0 <= c < 4:
                full[c] = proba[j]
    pred_idx = int(np.argmax(full))
    pred_label = IDX_TO_CLASS[pred_idx]
    conf = float(np.max(full))
    return pred_label, conf, proba, full


def _indeterminate_block(
    S: float, model_confidence: float
) -> dict[str, Any]:
    """Compute the rule-based + ML-confidence indeterminate flag.

    Triggers when EITHER:
      - S is within +/- INDETERMINATE_HALF_WIDTH of any tier boundary,
      - model_confidence < 0.65 (uncalibrated or low-confidence call).
    """
    rule_label, near_band = class_from_S_with_indeterminate(S)
    low_conf = model_confidence < 0.65
    flag = bool(near_band or low_conf)
    reasons: list[str] = []
    if near_band:
        reasons.append(
            f"S = {S:.2f} is within +/- {INDETERMINATE_HALF_WIDTH} "
            "of a tier boundary."
        )
    if low_conf:
        reasons.append(
            f"Model confidence {model_confidence:.2f} is below the 0.65 "
            "threshold; treat as indicative, not definitive."
        )
    return {
        "indeterminate": flag,
        "indeterminate_reason": " ".join(reasons) if reasons else "",
        "rule_based_class": rule_label,
    }


def run_full_assessment(
    orientation_score: float,
    memory_score: float,
    attention_score: float,
    language_score: float,
    visual_spatial_score: float,
    reaction_time_avg: float,
    accuracy_rate: float,
    hesitation_time: float,
    error_count: int,
    completion_time: float,
    medical: dict,
    model_name: str = "random_forest",
) -> dict:
    """Single-shot endpoint (legacy /api/predict). Now uses the
    domain-weighted C with optional age/education adjustment when
    those values are present in `medical`.
    """
    age = medical.get("age")
    edu = medical.get("education_years")
    C = compute_C_weighted(
        orientation_score,
        memory_score,
        attention_score,
        language_score,
        visual_spatial_score,
        age=age,
        education_years=edu,
    )
    P = compute_P(accuracy_rate, reaction_time_avg, age=age)
    B = compute_B(int(error_count), float(hesitation_time), float(completion_time))
    med = predict_medical_full(medical)
    M = med["M"]
    S = compute_S(C, B, P, M)
    rule_class = class_from_S(S)
    pred_label, conf, _proba, full4 = predict_fusion_vector(
        [C, B, P, M], model_name=model_name
    )
    indet = _indeterminate_block(S, conf)

    domains = {
        "orientation": round(orientation_score, 1),
        "memory": round(memory_score, 1),
        "attention": round(attention_score, 1),
        "language": round(language_score, 1),
        "visual_spatial": round(visual_spatial_score, 1),
    }
    medical_block = {
        "H": round(med["H"], 2),
        "R": round(med["R"], 2),
        "I": round(med["I"], 2),
    }
    insights = build_insights(
        S=float(S),
        C=float(C),
        B=float(B),
        P=float(P),
        M=float(M),
        medical=medical_block,
        model_confidence=float(conf),
        indeterminate=indet["indeterminate"],
        indeterminate_reason=indet["indeterminate_reason"],
        anxiety_flag=int(medical.get("anxiety", 0) or 0),
    )
    return {
        "cognitive_risk_score_S": round(float(S), 2),
        "final_score": round(float(S), 2),
        "risk_level": rule_class,
        "indeterminate": indet["indeterminate"],
        "indeterminate_reason": indet["indeterminate_reason"],
        "scores": {
            "C": round(C, 2),
            "B": round(B, 2),
            "P": round(P, 2),
            "M": round(M, 2),
        },
        "medical": medical_block,
        "score_components": {
            "C_cognitive": round(C, 2),
            "B_behavioral": round(B, 2),
            "P_performance": round(P, 2),
            "M_medical_ML": round(M, 2),
        },
        "rule_based_class": rule_class,
        "fused_model_class": pred_label,
        "model_confidence": round(conf, 4),
        "class_probabilities": {
            IDX_TO_CLASS[i]: round(float(full4[i]), 4) for i in range(4)
        },
        "domain_breakdown_0_20": domains,
        "insights": insights,
    }


def _domain_sums_from_answers(cognitive_answers: list[dict]) -> dict[str, float]:
    """Sum 0-20 per MMSE domain from a list of {domain, points} answers."""
    domains = {
        "orientation": 0.0,
        "memory": 0.0,
        "attention": 0.0,
        "language": 0.0,
        "visual_spatial": 0.0,
    }
    points: dict[str, list[float]] = {k: [] for k in domains}
    for a in cognitive_answers or []:
        d = str(a.get("domain", "")).lower().replace("-", "_").replace(" ", "_")
        d = "visual_spatial" if d in {"visual", "visualspatial", "visuospatial"} else d
        if d not in points:
            continue
        pts = float(a.get("points", 0))
        max_pts = float(a.get("max_points", 10))
        if max_pts <= 0:
            continue
        norm = max(0.0, min(1.0, pts / max_pts))
        points[d].append(norm)
    for d, vals in points.items():
        if vals:
            domains[d] = float(sum(vals) / len(vals)) * 20.0
    return domains


def run_phase2_assessment(
    cognitive_answers: list[dict],
    behavioral_logs: list[dict],
    facial_data: list[dict],
    speech_data: list[dict],
    medical: dict,
    model_name: str = "random_forest",
    completion_time_s: float | None = None,
    total_questions: int | None = None,
    conversation_agent: dict | None = None,
) -> dict:
    """Phase-2 computation: C from answers (weighted, age/edu-adjusted),
    P from behavior + RT (age-normed), B from real-time logs (no RT),
    M from medical ML, then S = wC*C + wB*B + wP*P + wM*M.

    Optional `conversation_agent` carries natural-dialogue turns from the
    Conversational Cognitive Assessment Agent; it nudges memory/language
    domains for C and blends into the speech channel of B. Fusion weights
    for S and risk bins are unchanged.
    """
    age = medical.get("age")
    edu = medical.get("education_years")

    domains = _domain_sums_from_answers(cognitive_answers)
    conversation_pack = analyze_conversation_agent(conversation_agent)
    if conversation_pack:
        domains = apply_conversation_to_domains(domains, conversation_pack)

    C = compute_C_weighted(
        domains["orientation"],
        domains["memory"],
        domains["attention"],
        domains["language"],
        domains["visual_spatial"],
        age=age,
        education_years=edu,
    )

    b_pack = compute_B_phase2(
        behavioral_logs,
        facial_data,
        speech_data,
        conversation_analysis=conversation_pack,
    )
    rb_meta = b_pack["details"]["reaction"]
    avg_rt_s = float(rb_meta.get("avg_reaction_time_s", 1.0))
    accuracy_rate = float(rb_meta.get("accuracy_rate", 0.0))
    P = compute_P(accuracy_rate, avg_rt_s, age=age)
    if completion_time_s is None and behavioral_logs:
        rts = [float(q.get("reaction_time_ms", 0)) for q in behavioral_logs]
        delays = [float(q.get("delay_ms", 0)) for q in behavioral_logs]
        completion_time_s = sum(rts + delays) / 1000.0

    med = predict_medical_full(medical)
    M = med["M"]
    B = b_pack["B"]
    S = compute_S(C, B, P, M)
    rule_class = class_from_S(S)
    pred_label, conf, _proba, full4 = predict_fusion_vector(
        [C, B, P, M], model_name=model_name
    )
    indet = _indeterminate_block(S, conf)

    behavioral_block = {
        "reaction_behavior": b_pack["reaction_behavior"],
        "facial_score": b_pack["facial_score"],
        "speech_score": b_pack["speech_score"],
        "weights": b_pack["weights"],
        "details": b_pack["details"],
    }
    medical_block = {
        "H": round(med["H"], 2),
        "R": round(med["R"], 2),
        "I": round(med["I"], 2),
    }

    insights = build_insights(
        S=float(S),
        C=float(C),
        B=float(B),
        P=float(P),
        M=float(M),
        medical=medical_block,
        behavioral=behavioral_block,
        behavioral_logs=behavioral_logs,
        cognitive_answers=cognitive_answers,
        model_confidence=float(conf),
        indeterminate=indet["indeterminate"],
        indeterminate_reason=indet["indeterminate_reason"],
        anxiety_flag=int(medical.get("anxiety", 0) or 0),
        conversation_agent_pack=conversation_pack,
    )

    return {
        "final_score": round(float(S), 2),
        "risk_level": rule_class,
        "indeterminate": indet["indeterminate"],
        "indeterminate_reason": indet["indeterminate_reason"],
        "scores": {
            "C": round(C, 2),
            "B": round(B, 2),
            "P": round(P, 2),
            "M": round(M, 2),
        },
        "medical": medical_block,
        "behavioral_breakdown": behavioral_block,
        "performance_breakdown": {
            "avg_reaction_time_s": round(avg_rt_s, 3),
            "accuracy_rate": round(accuracy_rate, 4),
            "completion_time_s": round(float(completion_time_s or 0.0), 2),
        },
        "domain_breakdown_0_20": {k: round(v, 2) for k, v in domains.items()},
        "conversation_agent": conversation_pack,
        "rule_based_class": rule_class,
        "fused_model_class": pred_label,
        "model_confidence": round(conf, 4),
        "class_probabilities": {
            IDX_TO_CLASS[i]: round(float(full4[i]), 4) for i in range(4)
        },
        "model_used": model_name,
        "insights": insights,
        "disclaimer": (
            "Research prototype. Synthetic-only training. Not a medical "
            "device or diagnosis."
        ),
    }
