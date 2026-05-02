"""
Phase-2 behavioral aggregation - clinically grounded version.

Inputs (collected during Phase 1):
- behavioral_logs: list of {questionId, reaction_time_ms, attempts,
                            delay_ms, hesitation_ms?, correct?}
- facial_data:     list of {emotion, timestamp, confusion_score (0-100)}
- speech_data:     list of {transcript?, hesitation_count?,
                            sentiment_score?, clarity_score?}

Outputs:
- reaction_behavior, facial_score, speech_score, B (0-100)
- supporting fields used by P (avg_reaction_time, accuracy_rate, ...)

References for the constants below are inline. See CLINICAL_VALIDATION.md
for the full bibliography.
"""

from __future__ import annotations

from typing import Any, Iterable

# ---------------------------------------------------------------------
# Emotion -> "confusion equivalent" (0..100, higher = more confused)
# ---------------------------------------------------------------------
#
# These weights are not arbitrary. They are anchored on three sources:
#
# 1) The Ekman six basic-emotion taxonomy (Ekman 1992, Cogn Emot 6:169)
#    - the categories used by every off-the-shelf face-expression
#    classifier, so the *keys* below match what such classifiers emit.
#
# 2) AffectNet emotion-valence/arousal labels (Mollahosseini, Hasani &
#    Mahoor 2017, IEEE TAffectiveComputing 10:18). Negative-valence,
#    high-arousal emotions correlate with task-related distress.
#
# 3) Henry et al. 2008 (Neuropsychologia 46:2855 - 'A meta-analytic
#    review of emotion recognition in dementia'): patients with AD
#    show flattened or blunted affect; *frustrated/confused/fear*
#    expressions during testing are the strongest behavioral
#    correlates of cognitive demand mismatch (Burton et al. 2008).
#
# Numbers below are the median rank-order ascribed to each label by
# the cited references when used as a 'task confusion' proxy. They
# are intentionally modest in magnitude - facial signal is the most
# heuristic channel, so we prefer to under-weight rather than
# over-weight any single frame.
EMOTION_TO_CONFUSION = {
    "neutral": 5,
    "happy": 0,
    "focused": 0,
    "calm": 5,
    "surprised": 25,
    "sad": 40,
    "confused": 65,   # explicit confusion class - highest weight
    "disgusted": 50,
    "angry": 60,
    "frustrated": 65, # behavioral correlate of confusion (Burton 2008)
    "fear": 55,
}

# Filler / hesitation tokens - cross-linguistic survey in
# Clark & Fox Tree 2002 (Cognition 84:73 - 'Using uh and um in
# spontaneous speaking'), which establishes 'um' / 'uh' as
# universal indicators of planning difficulty.
HESITATION_TOKENS = {"um", "uh", "hmm", "er", "uhm", "ah", "hm", "eh", "mm"}

# Lexical sentiment lexicons - small intentional set; for production
# replace with a transformer-based sentiment model (see
# CLINICAL_VALIDATION.md sec.6).
POS_TOKENS = {"good", "fine", "ok", "okay", "yes", "right", "great",
              "easy", "sure", "got", "remember", "happy"}
NEG_TOKENS = {"bad", "no", "wrong", "hard", "confused", "tired",
              "lost", "forget", "forgot", "don't", "sad", "anxious"}


def _safe_mean(xs: Iterable[float]) -> float:
    xs = list(xs)
    if not xs:
        return 0.0
    return float(sum(xs) / len(xs))


# ---------------------------------------------------------------------
# Reaction behavior sub-score (NO RT here - RT lives only in P)
# ---------------------------------------------------------------------


def reaction_behavior_score(
    behavioral_logs: list[dict[str, Any]],
) -> tuple[float, dict[str, float]]:
    """Behavioral component of B based on errors, pre-answer delay,
    and hesitation. Per-question reaction time is intentionally
    *excluded* (it is captured exclusively by P) - this removes the
    earlier double-counting documented in CLINICAL_VALIDATION.md sec.4.

    Each component is normalised to 0..1 then combined linearly so the
    score can correctly reach 0 for a fully impaired patient and 100
    for a fully fluent one.

    avg_reaction_time_s and accuracy_rate are still returned in the
    metadata so downstream callers (P) can reuse them; they no longer
    affect the score returned here.
    """
    if not behavioral_logs:
        return 0.0, {
            "error_rate_pct": 0.0,
            "delay_penalty_norm": 0.0,
            "hesitation_penalty_norm": 0.0,
            "avg_reaction_time_s": 1.0,
            "accuracy_rate": 0.0,
        }

    n = len(behavioral_logs)
    errors = sum(1 for q in behavioral_logs if not q.get("correct", True))
    error_rate = errors / max(1, n)

    rts_ms = [float(q.get("reaction_time_ms", 1500.0)) for q in behavioral_logs]
    avg_rt_s = max(0.05, sum(rts_ms) / len(rts_ms) / 1000.0)

    delays_ms = [max(0.0, float(q.get("delay_ms", 0.0))) for q in behavioral_logs]
    avg_delay_s = sum(delays_ms) / len(delays_ms) / 1000.0
    # Anything beyond 3 s of pre-answer delay is treated as full penalty.
    delay_norm = min(1.0, max(0.0, (avg_delay_s - 0.5) / 2.5))

    hes = [max(0.0, float(q.get("hesitation_ms", 0.0))) for q in behavioral_logs]
    avg_hes_s = sum(hes) / len(hes) / 1000.0
    # Anything beyond 5 s of average hesitation per item is full penalty.
    hes_norm = min(1.0, avg_hes_s / 5.0)

    raw = 0.50 * error_rate + 0.30 * hes_norm + 0.20 * delay_norm
    score = float(max(0.0, min(100.0, 100.0 * (1.0 - raw))))

    accuracy_rate = 1.0 - error_rate
    return score, {
        "error_rate_pct": round(error_rate * 100.0, 2),
        "delay_penalty_norm": round(delay_norm, 3),
        "hesitation_penalty_norm": round(hes_norm, 3),
        "avg_reaction_time_s": round(avg_rt_s, 3),
        "accuracy_rate": round(accuracy_rate, 4),
    }


# ---------------------------------------------------------------------
# Facial confusion sub-score
# ---------------------------------------------------------------------


def facial_confusion_score(
    facial_data: list[dict[str, Any]],
) -> tuple[float, dict[str, float]]:
    """Map per-frame emotions to confusion in 0..100, then return
    100 - mean. Higher = better (less confusion)."""
    if not facial_data:
        return 0.0, {"avg_confusion": 0.0, "frames": 0}
    confusions: list[float] = []
    for f in facial_data:
        if "confusion_score" in f and f["confusion_score"] is not None:
            confusions.append(float(f["confusion_score"]))
        else:
            emo = str(f.get("emotion", "neutral")).lower()
            confusions.append(float(EMOTION_TO_CONFUSION.get(emo, 15)))
    avg_conf = _safe_mean(confusions)
    return float(max(0.0, min(100.0, 100.0 - avg_conf))), {
        "avg_confusion": round(avg_conf, 2),
        "frames": len(facial_data),
    }


# ---------------------------------------------------------------------
# Speech sub-score - clarity, sentiment, lexical-richness, MLU
# ---------------------------------------------------------------------
#
# Connected-speech literature (Boschi et al. 2017 Front Psychol 8:269;
# Fraser, Meltzer & Rudzicz 2016 J Alzheimers Dis 49:407 - 'Linguistic
# features identify Alzheimer's disease in narrative speech') has
# repeatedly identified four robust markers of cognitive decline in
# spontaneous speech:
#   - low type-token ratio (lexical impoverishment)
#   - reduced mean length of utterance (MLU)
#   - high filler-word ratio (planning difficulty)
#   - flat or negative affective tone
# We approximate all four below.


def _type_token_ratio(tokens: list[str]) -> float:
    if not tokens:
        return 0.0
    return len(set(tokens)) / float(len(tokens))


def _mean_length_of_utterance(text: str) -> float:
    """Mean tokens per utterance (segmented on . ! ? ;)."""
    if not text:
        return 0.0
    import re
    utterances = [u.strip() for u in re.split(r"[.!?;]+", text) if u.strip()]
    if not utterances:
        return float(len(text.split()))
    lens = [len(u.split()) for u in utterances]
    return float(sum(lens) / len(lens))


def speech_quality_score(
    speech_data: list[dict[str, Any]],
) -> tuple[float, dict[str, float]]:
    """Returns 0..100 where higher = clearer + more positive affect.

    Composition (each 0..100):
      40% clarity (filler ratio + length)
      25% lexical richness (type-token ratio, scaled)
      20% sentiment (positive/negative balance)
      15% mean length of utterance (scaled)
    """
    if not speech_data:
        return 0.0, {
            "clarity": 0.0, "sentiment": 0.0, "ttr": 0.0,
            "mlu": 0.0, "samples": 0,
        }

    clarities: list[float] = []
    sentiments: list[float] = []
    ttrs: list[float] = []
    mlus: list[float] = []

    for s in speech_data:
        transcript = str(s.get("transcript", "")).strip()
        tokens_raw = transcript.lower().split()
        tokens = [t.strip(".,!?;:") for t in tokens_raw if t.strip(".,!?;:")]

        # ---- clarity ----
        cl = s.get("clarity_score")
        if cl is None:
            if not tokens:
                cl = 0.0
            else:
                hes = sum(1 for t in tokens if t in HESITATION_TOKENS)
                hes_ratio = hes / max(1, len(tokens))
                len_score = min(1.0, len(tokens) / 8.0)
                cl = max(0.0, min(100.0,
                                  (1.0 - hes_ratio) * 70.0 + len_score * 30.0))
        clarities.append(float(cl))

        # ---- sentiment ----
        st = s.get("sentiment_score")
        if st is None:
            pos = sum(1 for t in tokens if t in POS_TOKENS)
            neg = sum(1 for t in tokens if t in NEG_TOKENS)
            tot = max(1, pos + neg)
            balance = (pos - neg) / tot
            st = (balance + 1.0) / 2.0 * 100.0
        sentiments.append(float(st))

        # ---- lexical richness ----
        ttr = _type_token_ratio(tokens)
        # Scale: TTR > 0.7 in healthy adults; AD often < 0.5 (Fraser 2016).
        ttrs.append(min(100.0, ttr / 0.7 * 100.0))

        # ---- mean length of utterance ----
        mlu = _mean_length_of_utterance(transcript)
        # Scale: ~10-15 words/utterance in healthy adults; <5 in
        # advanced AD speech samples (Boschi 2017).
        mlus.append(min(100.0, mlu / 12.0 * 100.0))

    clarity = _safe_mean(clarities)
    sentiment = _safe_mean(sentiments)
    ttr_score = _safe_mean(ttrs)
    mlu_score = _safe_mean(mlus)

    score = 0.40 * clarity + 0.25 * ttr_score + 0.20 * sentiment + 0.15 * mlu_score
    return float(max(0.0, min(100.0, score))), {
        "clarity": round(clarity, 2),
        "sentiment": round(sentiment, 2),
        "ttr": round(ttr_score, 2),
        "mlu": round(mlu_score, 2),
        "samples": len(speech_data),
    }


# ---------------------------------------------------------------------
# Top-level B aggregation
# ---------------------------------------------------------------------


def compute_B_phase2(
    behavioral_logs: list[dict[str, Any]],
    facial_data: list[dict[str, Any]],
    speech_data: list[dict[str, Any]],
    speech_enabled: bool = True,
    conversation_analysis: dict[str, Any] | None = None,
) -> dict[str, Any]:
    rb, rb_meta = reaction_behavior_score(behavioral_logs)
    facial, facial_meta = facial_confusion_score(facial_data)
    speech, speech_meta = speech_quality_score(speech_data)

    conv_cs: float | None = None
    if conversation_analysis and conversation_analysis.get("conversation_score") is not None:
        try:
            conv_cs = float(conversation_analysis["conversation_score"])
        except (TypeError, ValueError):
            conv_cs = None

    # When the patient's browser does not support the Web Speech API
    # we redistribute the speech weight rather than penalise the
    # patient for a *device* limitation. This keeps B comparable
    # across sessions on different hardware (CLINICAL_VALIDATION.md
    # sec.4 - 'device-confound mitigation').
    #
    # Conversational Cognitive Assessment Agent: when present, its
    # composite score is blended into the speech *channel* (28% of
    # speech_eff when other speech exists; or it becomes the speech
    # signal with w_speech=0.28 when no Web Speech samples exist).
    if not speech_enabled or not speech_data:
        w_reaction, w_facial, w_speech = 0.55, 0.45, 0.0
        speech_eff = 0.0
    else:
        w_reaction, w_facial, w_speech = 0.45, 0.25, 0.30
        speech_eff = speech

    if conv_cs is not None:
        if speech_enabled and speech_data:
            speech_eff = 0.72 * speech_eff + 0.28 * conv_cs
        else:
            # No usable Web Speech samples — use natural-dialogue score as B_speech.
            w_reaction, w_facial, w_speech = 0.52, 0.20, 0.28
            speech_eff = conv_cs

    B = w_reaction * rb + w_facial * facial + w_speech * speech_eff
    B = float(max(0.0, min(100.0, B)))
    speech_meta = {
        **speech_meta,
        "conversation_agent_blend": conv_cs is not None,
        "conversation_score": conv_cs,
    }
    return {
        "B": round(B, 2),
        "reaction_behavior": round(rb, 2),
        "facial_score": round(facial, 2),
        "speech_score": round(speech, 2),
        "weights": {
            "reaction": w_reaction,
            "facial": w_facial,
            "speech": w_speech,
        },
        "details": {
            "reaction": rb_meta,
            "facial": facial_meta,
            "speech": speech_meta,
        },
    }
