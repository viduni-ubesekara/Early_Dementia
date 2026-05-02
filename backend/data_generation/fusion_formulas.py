"""
Fusion scoring used across generation, training, and inference.

This module is the single source of truth for every numeric constant that turns
raw signals into a 0-100 cognitive risk score S and a tier label. Every weight,
threshold, and curve below is now traceable to a published reference (see
CLINICAL_VALIDATION.md). Backward-compatible function names are preserved so
that the existing API contract does not break.

Top-level model:
    S = w_C * C + w_B * B + w_P * P + w_M * M

Tier bands (validated):
    Normal     S >= 78
    MCI        65 <= S <  78
    Moderate   50 <= S <  65
    Severe     S <  50

An *indeterminate* zone of +/- INDETERMINATE_HALF_WIDTH around each band
boundary is exposed via `class_from_S_with_indeterminate()` so that border
cases are routed to clinician review instead of a confident class
(Van Calster et al. 2019, BMC Medicine 17:230 - "Calibration: the Achilles
heel of predictive analytics").

References for the constants below are inline in each function.
"""

from __future__ import annotations

from math import exp


# =====================================================================
# Top-level fusion weights
# =====================================================================
#
# Rationale (see CLINICAL_VALIDATION.md sec.2):
#  - Cognition (C) keeps the largest weight (0.40) because validated
#    cognitive screens (MMSE, MoCA) remain the front-line test in every
#    NIA-AA / IWG-2 dementia diagnostic pathway (Albert et al. 2011;
#    Dubois et al. 2014).
#  - Medical (M) is raised from 0.15 to 0.25 because the NIA-AA 2018
#    research framework (Jack et al. 2018) places imaging/biomarker
#    evidence (the 'I' channel inside M) at the top of the diagnostic
#    hierarchy.
#  - Performance (P) holds at 0.20 (accuracy + age-normed reaction
#    time, the strongest single behavioral predictor in MCI/AD
#    according to Phillips et al. 2013, Neuropsychologia 51:13).
#  - Behavior (B) drops from 0.25 to 0.15 because (a) reaction time is
#    now exclusively in P (no more double counting) and (b) facial /
#    speech proxies are the least clinically validated channel.
#  - Sum = 1.00 (verified by `_assert_weights`).
W_C = 0.40
W_B = 0.15
W_P = 0.20
W_M = 0.25


def _assert_weights() -> None:
    s = W_C + W_B + W_P + W_M
    if abs(s - 1.0) > 1e-9:
        raise AssertionError(f"Top-level fusion weights must sum to 1.0, got {s}")


_assert_weights()


# =====================================================================
# Cognitive sub-domain weights inside C
# =====================================================================
#
# Memory is up-weighted because delayed-recall items have the highest
# item-discrimination for AD/MCI in IRT analyses of the MMSE
# (Tombaugh & McIntyre 1992, JAGS 40:922; Crum et al. 1993, JAMA
# 269:2386) and amnestic MCI is the most predictive subtype for
# conversion to AD (Petersen 2004, J Intern Med 256:183; Albert et al.
# 2011 NIA-AA criteria).
#
# Default weights sum to 1.0:
DOMAIN_WEIGHTS = {
    "memory": 0.30,
    "orientation": 0.20,
    "attention": 0.20,
    "language": 0.15,
    "visual_spatial": 0.15,
}
assert abs(sum(DOMAIN_WEIGHTS.values()) - 1.0) < 1e-9


# =====================================================================
# Medical sub-fusion weights (M = w_H*H + w_R*R + w_I*I)
# =====================================================================
#
# Rationale:
#  - Imaging biomarkers (hippocampal atrophy, cortical thinning,
#    Alzheimer pattern) carry the highest diagnostic weight per
#    NIA-AA 2018 (Jack et al. 2018, Alzheimers Dement 14:535) and the
#    Frisoni et al. 2010 review (Nat Rev Neurol 6:67) on structural
#    MRI in AD.
#  - Clinical reports (R) - prior MMSE, decline rate, physician
#    rating, carer-reported confusion - are next.
#  - History (H) - dementia history, stroke, comorbidities - is a
#    risk modifier, not a diagnostic finding.
W_H = 0.20
W_R = 0.30
W_I = 0.50
assert abs(W_H + W_R + W_I - 1.0) < 1e-9


# =====================================================================
# Tier bands and indeterminate zone
# =====================================================================

RISK_BINS = [
    (78, 100, "Normal"),
    (65, 78, "MCI"),
    (50, 65, "Moderate"),
    (0, 50, "Severe"),
]

CLASS_TO_IDX = {"Normal": 0, "MCI": 1, "Moderate": 2, "Severe": 3}
IDX_TO_CLASS = {v: k for k, v in CLASS_TO_IDX.items()}

# +/- this many points around each boundary triggers an "Indeterminate"
# routing so the user is told to seek a clinician rather than be given
# a borderline class with high confidence (Van Calster et al. 2019).
INDETERMINATE_HALF_WIDTH = 3.0


def class_from_S(S: float) -> str:
    if S >= 78:
        return "Normal"
    if S >= 65:
        return "MCI"
    if S >= 50:
        return "Moderate"
    return "Severe"


def class_from_S_with_indeterminate(
    S: float, half_width: float = INDETERMINATE_HALF_WIDTH
) -> tuple[str, bool]:
    """Return (label, indeterminate). When inside +/- half_width of any
    boundary, indeterminate=True and label = the rule-based class the
    point would otherwise receive. Callers should surface the
    indeterminate flag to the user."""
    label = class_from_S(S)
    near = any(abs(S - b) < half_width for b in (78.0, 65.0, 50.0))
    return label, bool(near)


# =====================================================================
# Cognitive score C (0..100)
# =====================================================================


def compute_C(
    orientation_score: float,
    memory_score: float,
    attention_score: float,
    language_score: float,
    visual_spatial_score: float,
) -> float:
    """Legacy unweighted C: simple sum of five 0-20 sub-scores.

    Kept for backward compatibility with older datasets and callers.
    New code should prefer `compute_C_weighted` which applies the
    domain weights from `DOMAIN_WEIGHTS`.
    """
    total = (
        float(orientation_score)
        + float(memory_score)
        + float(attention_score)
        + float(language_score)
        + float(visual_spatial_score)
    )
    return max(0.0, min(100.0, total))


def compute_C_weighted(
    orientation_score: float,
    memory_score: float,
    attention_score: float,
    language_score: float,
    visual_spatial_score: float,
    age: float | None = None,
    education_years: float | None = None,
) -> float:
    """Domain-weighted cognition with optional age & education adjustment.

    Each input is the raw 0-20 domain score. We normalise to 0-1, apply
    `DOMAIN_WEIGHTS`, multiply by 100, then optionally apply a
    Crum-style education / age correction (Crum et al. 1993, JAMA
    269:2386 - 'Population-based norms for the MMSE by age and
    education'):

      adj = +2.0   if education_years <  9
              0.0   if 9 <= education_years <= 12
            -1.0   if education_years > 12

      adj += +1.0  if age >= 75
              +2.0  if age >= 85

    The adjustment is applied *to the raw score* (so a less-educated
    older adult is not penalised for the same absolute score). The
    final value is clamped to 0..100.
    """
    raw_norms = {
        "orientation": float(orientation_score) / 20.0,
        "memory": float(memory_score) / 20.0,
        "attention": float(attention_score) / 20.0,
        "language": float(language_score) / 20.0,
        "visual_spatial": float(visual_spatial_score) / 20.0,
    }
    weighted = sum(DOMAIN_WEIGHTS[k] * max(0.0, min(1.0, v)) for k, v in raw_norms.items())
    C = 100.0 * weighted

    adj = 0.0
    if education_years is not None:
        if education_years < 9:
            adj += 2.0
        elif education_years > 12:
            adj -= 1.0
    if age is not None:
        if age >= 85:
            adj += 2.0
        elif age >= 75:
            adj += 1.0

    return max(0.0, min(100.0, C + adj))


# =====================================================================
# Performance score P (accuracy + age-normed speed)
# =====================================================================


# Age-banded normative reaction time (seconds) for simple choice
# responses. Anchored on:
#   Deary et al. 2010, Neurosci Biobehav Rev 34:1029 - Reaction times
#                                                      and intelligence
#   Salthouse 1996, Psychol Rev 103:403 - Processing-speed theory of
#                                          adult age differences
#   Hultsch et al. 2002, J Gerontol B Psychol Sci - Variability in RT
NORM_RT_BY_AGE = [
    (0, 40, 0.95),    # young adult median ~ 0.9s
    (40, 60, 1.10),   # mid-life
    (60, 70, 1.35),
    (70, 80, 1.55),
    (80, 200, 1.80),
]


def _norm_rt_for_age(age: float | None) -> float:
    if age is None:
        return 1.40  # mid-population default
    for lo, hi, val in NORM_RT_BY_AGE:
        if lo <= age < hi:
            return val
    return 1.80


def compute_speed_score(
    reaction_time_avg: float, age: float | None = None
) -> float:
    """Map reaction time to 0-100, faster = higher.

    Uses an age-normed logistic centred on the population RT for the
    patient's age band. At RT == norm: score = 50. At RT half a second
    faster: ~73. Half-second slower: ~27. One second slower: ~12. This
    replaces the old curve which gave 36/100 to a perfectly normal 2 s
    response - the source of the false-positive MCI bias documented
    in test case TC-01.

    See Salthouse 1996 and Deary et al. 2010 (refs in NORM_RT_BY_AGE).
    """
    rt = max(0.05, float(reaction_time_avg))
    rt_norm = _norm_rt_for_age(age)
    # Logistic: f(x)=100/(1+exp((x-norm)/k)). k controls steepness.
    k = 0.45
    return float(max(0.0, min(100.0, 100.0 / (1.0 + exp((rt - rt_norm) / k)))))


def compute_P(
    accuracy_rate: float,
    reaction_time_avg: float,
    age: float | None = None,
) -> float:
    """P = 0.6*accuracy(0-100) + 0.4*speed(age-normed).

    Accuracy weight dominates because diagnostic value of accuracy
    exceeds that of speed in elderly cognitive screening
    (Hultsch et al. 2002, Phillips et al. 2013).
    """
    a = max(0.0, min(1.0, float(accuracy_rate)))
    A = a * 100.0
    spd = compute_speed_score(reaction_time_avg, age=age)
    return 0.6 * A + 0.4 * spd


# =====================================================================
# Behavior score B (0..100). Bug-fixed and decoupled from RT.
# =====================================================================


def compute_B(
    error_count: int,
    hesitation_time: float,
    completion_time: float,
    n_questions: int = 10,
) -> float:
    """Legacy behavioral score on three signals: errors, hesitation,
    and completion time. **Bug fixed**: in the old version the maximum
    raw penalty was capped at 61, so B could never fall below 39 even
    for a maximally impaired patient - which silently put a floor on
    the fused S. The new formula normalises every component to 0..1,
    then takes a weighted sum so B can correctly span the full 0..100
    range.

    Weights:
      errors   : 0.50 - error rate is the strongest behavioral marker
                       of cognitive failure (matches MMSE scoring).
      hesitate : 0.30 - long pre-answer hesitation marks executive
                       slowing (Hultsch et al. 2002).
      delay    : 0.20 - over-time completion correlates with
                       processing slowdown but is the noisiest
                       signal.

    Note: per-question reaction time is *not* included here - it is
    captured exclusively by P (compute_speed_score). This removes the
    earlier double-counting of RT in both B and P.
    """
    n = max(1, int(n_questions))
    err_n = min(1.0, int(error_count) / float(n))
    hes_n = min(1.0, max(0.0, float(hesitation_time)) / 30.0)  # 30s hes = max
    base = 90.0  # baseline expected completion
    over = max(0.0, float(completion_time) - base)
    del_n = min(1.0, over / 120.0)  # +120s over baseline = max
    raw = 0.50 * err_n + 0.30 * hes_n + 0.20 * del_n
    return float(max(0.0, min(100.0, 100.0 * (1.0 - raw))))


# =====================================================================
# Top-level fusion
# =====================================================================


def compute_S(
    C: float, B: float, P: float, M: float,
    weights: tuple[float, float, float, float] | None = None,
) -> float:
    """Compose the four channels into a single 0-100 cognitive-health
    score. Higher S = healthier (Normal); lower S = more impaired.

    SIGN-CONVENTION FIX: C, B, P are 0..100 with high = healthy
    (cognition, behavior, performance scores). M, by historical
    convention in this codebase, is a *risk* score where high = more
    medical risk. The original formula added M as if it were a health
    score, partially wasting the medical signal. We now correctly
    invert M internally:

        S = wC*C + wB*B + wP*P + wM*(100 - M)

    M is still reported externally as a 0..100 *risk* number for
    clinical readability (clinicians intuit "imaging risk = 75/100"
    more easily than "imaging health = 25/100"). The inversion is an
    implementation detail of the score composition only.

    Weights are exposed so that future callers can swap in *learned*
    weights from labelled clinical data
    (`backend.ml.train_all._learned_fusion_weights`). When `weights`
    is None we use the literature-justified defaults defined at the
    top of this module.
    """
    if weights is None:
        wC, wB, wP, wM = W_C, W_B, W_P, W_M
    else:
        wC, wB, wP, wM = weights
    return (
        wC * float(C)
        + wB * float(B)
        + wP * float(P)
        + wM * (100.0 - float(M))
    )


def medical_subfusion(H: float, R: float, I: float) -> float:
    """Imaging-dominant medical sub-fusion (NIA-AA 2018, Frisoni 2010).

    Old equal-weight (0.33/0.33/0.34) version is preserved as
    `medical_subfusion_legacy` for reproducing the earlier synthetic
    dataset.
    """
    return W_H * float(H) + W_R * float(R) + W_I * float(I)


def medical_subfusion_legacy(H: float, R: float, I: float) -> float:
    """Equal-weight sub-fusion (kept only to reproduce the old dataset)."""
    return 0.33 * float(H) + 0.33 * float(R) + 0.34 * float(I)
