"""
Cognitive Insight & Recommendation Engine (Layer 5).

Pure, deterministic, rule-based decision-support layer that runs *after* the ML
models have produced S, the risk class, and the C/B/P/M breakdown. The engine
takes those numbers (plus optional behavioral signal details such as facial
confusion, speech sentiment, and per-question reaction logs) and produces:

    {
        "primary": {
            "tier": "Normal" | "MCI" | "Moderate" | "Severe",
            "color": "green" | "amber" | "orange" | "red",
            "headline": str,
            "findings": [str, ...],
            "suggestions": [str, ...],
        },
        "secondary": [
            {"key": "depression_like" | "anxiety" | "cognitive_fatigue",
             "label": str, "severity": "low" | "moderate" | "high",
             "evidence": [str, ...], "suggestions": [str, ...]},
            ...
        ],
        "confidence_note": str,
        "disclaimer": str,
    }

The engine is intentionally **explainable**: every flag carries the textual
evidence (e.g. "speech sentiment 32 < 45 threshold") that triggered it.
This is decision support; nothing here is a diagnosis.
"""

from __future__ import annotations

from typing import Any


DISCLAIMER = (
    "This system does not provide a medical diagnosis. It produces cognitive "
    "risk interpretation and decision-support recommendations based on a "
    "synthetic-trained research prototype. Clinical decisions must be made by "
    "a qualified clinician."
)


# ---------- primary band -----------------------------------------------------


def _primary_band(S: float) -> dict[str, Any]:
    if S >= 78:
        return {
            "tier": "Normal",
            "color": "green",
            "headline": "No cognitive impairment detected.",
            "findings": [
                "Performance is consistent with a normal cognitive functioning pattern.",
                "No immediate intervention required.",
            ],
            "suggestions": [
                "Continue routine cognitive monitoring every 6–12 months.",
                "Maintain healthy sleep, exercise, and social engagement.",
            ],
        }
    if S >= 65:
        return {
            "tier": "MCI",
            "color": "amber",
            "headline": "Early cognitive variability detected (MCI-zone pattern).",
            "findings": [
                "Possible attention/memory inefficiency patterns.",
                "Performance is below the normal threshold but not in a clinically severe range.",
            ],
            "suggestions": [
                "Daily cognitive training (memory, attention, language exercises).",
                "Lifestyle monitoring: sleep regularity, stress, hydration, alcohol/medication review.",
                "Repeat screening in 3 months to track trajectory.",
            ],
        }
    if S >= 50:
        return {
            "tier": "Moderate",
            "color": "orange",
            "headline": "Significant cognitive performance decline indicators.",
            "findings": [
                "Multiple domains show under-performance.",
                "Behavioral inconsistency observed during the session.",
            ],
            "suggestions": [
                "Neurological consultation recommended.",
                "Structured cognitive therapy and supervised activities.",
                "Increase caregiver supervision for daily tasks (medication, finances, navigation).",
            ],
        }
    return {
        "tier": "Severe",
        "color": "red",
        "headline": "Severe cognitive dysfunction indicators detected.",
        "findings": [
            "High probability of neurocognitive disorder patterns.",
            "Cross-domain deficits with strong behavioral and performance impairment.",
        ],
        "suggestions": [
            "Urgent clinical evaluation.",
            "Detailed neuropsychological assessment.",
            "MRI / neuro-imaging follow-up recommended.",
            "Establish a caregiver safety plan (wandering, medication errors, falls).",
        ],
    }


# ---------- secondary detectors ---------------------------------------------


def _safe(d: dict | None, *path, default=None):
    cur: Any = d or {}
    for k in path:
        if not isinstance(cur, dict) or k not in cur:
            return default
        cur = cur[k]
    return cur


def _depression_like(
    *,
    B: float,
    behavioral: dict | None,
    cognitive_answers: list[dict] | None,
) -> dict | None:
    evidence: list[str] = []
    score = 0  # severity counter

    if B < 50:
        evidence.append(f"Behavioral score B = {B:.1f} (< 50): low engagement / slow output.")
        score += 1
    elif B < 60:
        evidence.append(f"Behavioral score B = {B:.1f} (borderline 50–60).")
        score += 0.5

    sentiment = _safe(behavioral, "details", "speech", "sentiment")
    speech_score = _safe(behavioral, "speech_score")
    if sentiment is not None:
        try:
            sentiment_f = float(sentiment)
            if sentiment_f < 40:
                evidence.append(
                    f"Speech sentiment {sentiment_f:.0f}/100 indicates negative affective tone."
                )
                score += 1
            elif sentiment_f < 50:
                evidence.append(
                    f"Speech sentiment {sentiment_f:.0f}/100 (mildly negative)."
                )
                score += 0.5
        except (TypeError, ValueError):
            pass
    if speech_score is not None:
        try:
            ss = float(speech_score)
            if ss > 0 and ss < 45:
                evidence.append(f"Overall speech quality {ss:.0f}/100 is low.")
                score += 0.5
        except (TypeError, ValueError):
            pass

    # Engagement: average normalized points across answered questions
    if cognitive_answers:
        norms: list[float] = []
        for a in cognitive_answers:
            try:
                pts = float(a.get("points", 0))
                mx = float(a.get("max_points", 10))
                if mx > 0:
                    norms.append(max(0.0, min(1.0, pts / mx)))
            except (TypeError, ValueError):
                continue
        if norms:
            avg_norm = sum(norms) / len(norms)
            if avg_norm < 0.4:
                evidence.append(
                    f"Average answer quality {avg_norm * 100:.0f}% suggests low engagement / withdrawal."
                )
                score += 1

    if not evidence:
        return None

    severity = "high" if score >= 2 else "moderate" if score >= 1 else "low"
    return {
        "key": "depression_like",
        "label": "Depression-like behavioral pattern",
        "severity": severity,
        "evidence": evidence,
        "suggestions": [
            "Screen for mood symptoms with a validated tool (e.g. PHQ-9 or GDS-15).",
            "Review sleep, appetite, and social withdrawal with patient/caregiver.",
            "Consider mental-health referral if pattern persists across sessions.",
        ],
    }


def _anxiety_like(
    *,
    behavioral: dict | None,
    behavioral_logs: list[dict] | None,
) -> dict | None:
    evidence: list[str] = []
    score = 0

    hesitation_pen = _safe(behavioral, "details", "reaction", "hesitation_penalty")
    delay_pen = _safe(behavioral, "details", "reaction", "delay_penalty")
    avg_conf = _safe(behavioral, "details", "facial", "avg_confusion")

    if hesitation_pen is not None:
        try:
            h = float(hesitation_pen)
            if h >= 20:
                evidence.append(f"High hesitation penalty {h:.1f}/35 across the session.")
                score += 1
            elif h >= 10:
                evidence.append(f"Moderate hesitation penalty {h:.1f}/35.")
                score += 0.5
        except (TypeError, ValueError):
            pass

    if delay_pen is not None:
        try:
            d = float(delay_pen)
            if d >= 15:
                evidence.append(f"Pre-answer delay penalty {d:.1f}/35 (long pauses before responding).")
                score += 0.5
        except (TypeError, ValueError):
            pass

    if avg_conf is not None:
        try:
            f = float(avg_conf)
            if f >= 45:
                evidence.append(f"Average facial-confusion score {f:.0f}/100 (looks distressed/uncertain).")
                score += 1
            elif f >= 30:
                evidence.append(f"Facial-confusion score {f:.0f}/100 (mildly uncertain).")
                score += 0.5
        except (TypeError, ValueError):
            pass

    # Inconsistency: variance in per-question reaction times
    if behavioral_logs and len(behavioral_logs) >= 4:
        rts = []
        for q in behavioral_logs:
            try:
                rts.append(float(q.get("reaction_time_ms", 0)) / 1000.0)
            except (TypeError, ValueError):
                continue
        if rts:
            mean = sum(rts) / len(rts)
            var = sum((r - mean) ** 2 for r in rts) / len(rts)
            std = var**0.5
            cv = std / mean if mean > 0 else 0.0
            if cv >= 0.8:
                evidence.append(
                    f"Reaction-time variability is high (CV {cv:.2f}) — inconsistent responding."
                )
                score += 0.5

    if not evidence:
        return None
    severity = "high" if score >= 2 else "moderate" if score >= 1 else "low"
    return {
        "key": "anxiety",
        "label": "Anxiety-like pattern",
        "severity": severity,
        "evidence": evidence,
        "suggestions": [
            "Acknowledge the patient may feel test anxiety; offer a calm re-test environment.",
            "Consider screening with GAD-7 if pattern persists.",
            "Brief relaxation / grounding before the next session.",
        ],
    }


def _cognitive_fatigue(
    *,
    behavioral_logs: list[dict] | None,
    cognitive_answers: list[dict] | None,
) -> dict | None:
    evidence: list[str] = []
    score = 0

    if behavioral_logs and len(behavioral_logs) >= 4:
        rts = []
        for q in behavioral_logs:
            try:
                rts.append(float(q.get("reaction_time_ms", 0)) / 1000.0)
            except (TypeError, ValueError):
                continue
        if len(rts) >= 4:
            half = len(rts) // 2
            first = rts[:half]
            second = rts[half:]
            avg_first = sum(first) / len(first) if first else 0
            avg_second = sum(second) / len(second) if second else 0
            if avg_first > 0 and avg_second > avg_first * 1.25:
                evidence.append(
                    f"Reaction time rose from {avg_first:.2f}s (first half) to "
                    f"{avg_second:.2f}s (second half)."
                )
                score += 1
            elif avg_first > 0 and avg_second > avg_first * 1.10:
                evidence.append(
                    f"Reaction time slightly increased ({avg_first:.2f}s → {avg_second:.2f}s)."
                )
                score += 0.5

    # Accuracy drop across the session
    if cognitive_answers and len(cognitive_answers) >= 4:
        norms = []
        for a in cognitive_answers:
            try:
                pts = float(a.get("points", 0))
                mx = float(a.get("max_points", 10))
                if mx > 0:
                    norms.append(pts / mx)
            except (TypeError, ValueError):
                continue
        if len(norms) >= 4:
            half = len(norms) // 2
            first = sum(norms[:half]) / half
            second = sum(norms[half:]) / max(1, len(norms) - half)
            if first - second >= 0.20:
                evidence.append(
                    f"Accuracy dropped from {first * 100:.0f}% (first half) to "
                    f"{second * 100:.0f}% (second half)."
                )
                score += 1
            elif first - second >= 0.10:
                evidence.append(
                    f"Mild accuracy drop ({first * 100:.0f}% → {second * 100:.0f}%)."
                )
                score += 0.5

    if not evidence:
        return None
    severity = "high" if score >= 1.5 else "moderate" if score >= 1 else "low"
    return {
        "key": "cognitive_fatigue",
        "label": "Cognitive fatigue / processing slowdown",
        "severity": severity,
        "evidence": evidence,
        "suggestions": [
            "Shorten future sessions or split into two visits.",
            "Schedule the test earlier in the day when alertness is higher.",
            "Rule out medication side-effects, sleep apnea, or thyroid issues.",
        ],
    }


def _confidence_note(model_confidence: float | None) -> str:
    if model_confidence is None:
        return "Model confidence not available."
    try:
        c = float(model_confidence)
    except (TypeError, ValueError):
        return "Model confidence not available."
    pct = c * 100 if c <= 1.0 else c
    if pct >= 75:
        return f"Fusion model confidence is {pct:.1f}% — strong agreement on the predicted class."
    if pct >= 55:
        return f"Fusion model confidence is {pct:.1f}% — moderate confidence; consider re-testing if the borderline matters."
    return f"Fusion model confidence is {pct:.1f}% — low confidence; treat the class as indicative, not definitive."


# ---------- public entry point ----------------------------------------------


def build_insights(
    *,
    S: float,
    C: float | None = None,
    B: float | None = None,
    P: float | None = None,
    M: float | None = None,
    medical: dict | None = None,
    behavioral: dict | None = None,
    behavioral_logs: list[dict] | None = None,
    cognitive_answers: list[dict] | None = None,
    model_confidence: float | None = None,
    indeterminate: bool = False,
    indeterminate_reason: str = "",
    anxiety_flag: int = 0,
    conversation_agent_pack: dict | None = None,
) -> dict[str, Any]:
    primary = _primary_band(float(S))

    # ----- indeterminate override --------------------------------------
    # When the rule-based S sits inside a tier-boundary buffer or the
    # ML confidence is low, we override the primary tier to a neutral
    # "indeterminate" block telling the user to seek clinician review,
    # while still surfacing the underlying tier in `findings` so the
    # explanation is complete (Van Calster 2019).
    if indeterminate:
        underlying = primary["tier"]
        primary = {
            "tier": "Indeterminate",
            "color": "gray",
            "headline": (
                f"Borderline result - clinician review recommended "
                f"(underlying tier estimate: {underlying})."
            ),
            "findings": [
                f"S = {S:.2f} sits in a buffer zone or model confidence is low.",
                f"Reason: {indeterminate_reason}",
            ],
            "suggestions": [
                "Repeat the screening on a different day to check stability.",
                "Refer to a clinician for a validated cognitive battery "
                "(e.g. MoCA, ACE-III) before drawing any conclusion.",
                "Do not communicate a class label to the patient based on "
                "this single borderline session.",
            ],
        }

    # Add medical-specific finding if any sub-score is markedly high.
    if medical:
        for k, label in (("H", "clinical history"), ("R", "reports"), ("I", "imaging")):
            v = medical.get(k)
            if v is None:
                continue
            try:
                v_f = float(v)
            except (TypeError, ValueError):
                continue
            if v_f >= 70:
                primary["findings"].append(
                    f"Medical {label} risk score = {v_f:.1f}/100 (elevated)."
                )

    secondary: list[dict] = []

    # Honour an *explicit* anxiety flag from the medical form.
    if anxiety_flag:
        secondary.append({
            "key": "anxiety_explicit",
            "label": "Anxiety reported in medical history",
            "severity": "moderate",
            "evidence": [
                "Clinician/self-report indicated a known anxiety disorder.",
                "Borderline cognitive results in patients with anxiety can "
                "reflect 'anxiety pseudodementia' (Wells 1979; Kang 2014).",
            ],
            "suggestions": [
                "Repeat screening in a calm environment.",
                "Consider GAD-7 / HAM-A before interpreting borderline results.",
            ],
        })

    if B is not None:
        dep = _depression_like(
            B=float(B),
            behavioral=behavioral,
            cognitive_answers=cognitive_answers,
        )
        if dep:
            secondary.append(dep)
    anx = _anxiety_like(
        behavioral=behavioral,
        behavioral_logs=behavioral_logs,
    )
    if anx:
        secondary.append(anx)
    fat = _cognitive_fatigue(
        behavioral_logs=behavioral_logs,
        cognitive_answers=cognitive_answers,
    )
    if fat:
        secondary.append(fat)

    # Conversational Cognitive Assessment Agent (natural dialogue, passive).
    if conversation_agent_pack:
        cs = float(conversation_agent_pack.get("conversation_score") or 0)
        primary["findings"].append(
            "The conversational agent passively assessed cognitive and emotional "
            "indicators through natural dialogue, without explicitly conducting a "
            "formal test."
        )
        primary["findings"].append(
            f"Dialogue composite score (fluency, memory coherence, affect, "
            f"relevance) = {cs:.0f}/100."
        )
        if cs < 45:
            secondary.append({
                "key": "conversational_concern",
                "label": "Natural dialogue showed reduced fluency / coherence",
                "severity": "moderate",
                "evidence": [
                    f"Conversation composite {cs:.0f}/100 is below the mid-range.",
                    "Interpret alongside structured tasks and clinical context.",
                ],
                "suggestions": [
                    "Repeat in a quiet environment; consider language-matched prompts.",
                    "This is supportive screening only — not a diagnosis.",
                ],
            })

    return {
        "primary": primary,
        "secondary": secondary,
        "confidence_note": _confidence_note(model_confidence),
        "indeterminate": bool(indeterminate),
        "indeterminate_reason": indeterminate_reason,
        "disclaimer": DISCLAIMER,
    }
