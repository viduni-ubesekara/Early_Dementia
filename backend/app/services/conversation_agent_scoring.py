"""
Conversational Cognitive Assessment Agent — passive scoring from natural dialogue.

The conversational agent is used to passively assess cognitive and emotional
indicators through natural dialogue, without explicitly conducting a formal test.

Outputs four 0–100 sub-scores plus a composite conversation_score (mean).
These feed into behavioral aggregation (B) and a small domain nudge for C
— see inference.run_phase2_assessment. Core fusion weights S = f(C,B,P,M)
and risk bins are unchanged.
"""

from __future__ import annotations

import re
from typing import Any

from backend.app.services.behavior_aggregation import (
    HESITATION_TOKENS,
    NEG_TOKENS,
    POS_TOKENS,
)

# Keywords for lightweight response-relevance (topic overlap).
TOPIC_KEYWORDS: dict[str, set[str]] = {
    "greeting": {"fine", "good", "ok", "okay", "well", "better", "alright", "happy", "tired"},
    "daily": {
        "morning", "today", "woke", "breakfast", "tea", "coffee", "rice", "walk",
        "temple", "church", "family", "read", "watched", "cooked", "rest", "sleep",
        "hoppers", "roti", "bread", "meal", "lunch", "home",
    },
    "memory_routine": {
        "usually", "always", "often", "breakfast", "tea", "rice", "milk", "bread",
        "fruit", "eggs", "coffee", "morning", "eat", "drink", "sometimes",
    },
    "memory_past": {
        "work", "job", "teacher", "office", "shop", "farm", "young", "used",
        "children", "colombo", "kandy", "retired", "years", "company", "business",
    },
    "orientation_natural": {
        "weekday", "weekend", "monday", "tuesday", "wednesday", "thursday",
        "friday", "saturday", "sunday", "think", "maybe", "holiday", "working",
    },
    "emotional": {
        "relax", "relaxed", "calm", "stress", "stressed", "worried", "anxious",
        "happy", "sad", "fine", "okay", "tired", "sleep", "peace",
    },
    "cultural": {
        "avurudu", "vesak", "festival", "family", "celebrate", "temple", "children",
        "yes", "no", "remember", "home", "gathering", "food", "milk", "rice",
        "new", "year", "happy", "together",
    },
}

STEP_TO_TOPIC: dict[str, str] = {
    "greeting": "greeting",
    "daily": "daily",
    "memory_routine": "memory_routine",
    "memory_past": "memory_past",
    "orientation_natural": "orientation_natural",
    "cultural": "cultural",
    "emotional": "emotional",
    "closing": "greeting",
}

_MEMORY_NEG_PHRASES = (
    "don't remember",
    "dont remember",
    "no idea",
    "forgot",
    "can't remember",
    "cannot remember",
    "not sure",
)


def _tokenize(text: str) -> list[str]:
    t = re.sub(r"[^a-z0-9\s']", " ", text.lower())
    return [x for x in t.split() if x]


def _get_turn_speech(t: dict[str, Any]) -> dict[str, Any] | None:
    return t.get("speech_analysis") or t.get("speechAnalysis")


def _mic_fluency_from_turns(turns: list[dict[str, Any]]) -> float | None:
    """Aggregate 0–100 from per-turn WPM, pauses, hesitation, repetition."""
    vals: list[float] = []
    for t in turns:
        if str(t.get("role", "")).lower() != "user":
            continue
        sa = _get_turn_speech(t)
        if not sa:
            continue
        wpm = sa.get("words_per_minute")
        if wpm is not None:
            wpm_f = float(wpm)
            # ~140–180 WPM conversational norm; <80 suggests slowing (Forbes-McKay 2005).
            wpm_score = max(0.0, min(100.0, (wpm_f - 35.0) / 105.0 * 100.0))
        else:
            wpm_score = 55.0
        lp = int(sa.get("long_pause_count") or 0)
        pause_score = max(0.0, 100.0 - lp * 12.0)
        rep = float(sa.get("repetition_rate") or 0.0)
        rep_score = max(0.0, 100.0 - rep * 120.0)
        hes = int(sa.get("hesitation_count") or 0)
        wc = max(1, len(_tokenize(str(t.get("text", "")))))
        hes_r = hes / wc
        hes_score = max(0.0, 100.0 - hes_r * 180.0)
        vals.append(0.35 * wpm_score + 0.25 * pause_score + 0.22 * rep_score + 0.18 * hes_score)
    if not vals:
        return None
    return float(sum(vals) / len(vals))


def _latency_attention_score(turns: list[dict[str, Any]]) -> float | None:
    """Response time per step (attention / retrieval speed), 0–100."""
    # Soft time budgets (seconds) — generous for elderly + mic latency.
    limits: dict[str, float] = {
        "greeting": 40.0,
        "daily": 75.0,
        "memory_routine": 90.0,
        "memory_past": 120.0,
        "orientation_natural": 60.0,
        "cultural": 90.0,
        "emotional": 75.0,
    }
    scores: list[float] = []
    for t in turns:
        if str(t.get("role", "")).lower() != "user":
            continue
        sid = str(t.get("stepId") or t.get("step_id") or "")
        dur = t.get("durationSec")
        if dur is None:
            dur = t.get("duration_sec")
        if dur is None:
            sa = _get_turn_speech(t)
            if sa and sa.get("duration_sec") is not None:
                dur = sa.get("duration_sec")
        try:
            d = float(dur) if dur is not None else 0.0
        except (TypeError, ValueError):
            d = 0.0
        lim = limits.get(sid, 90.0)
        if d <= 0:
            scores.append(52.0)
        elif d <= lim:
            scores.append(88.0)
        elif d <= lim * 1.6:
            scores.append(68.0)
        elif d <= lim * 2.4:
            scores.append(48.0)
        else:
            scores.append(32.0)
    if not scores:
        return None
    return float(sum(scores) / len(scores))


def _confusion_proxy_from_turns(turns: list[dict[str, Any]]) -> float | None:
    """0–100, higher = less confusion (from mic flags + pauses)."""
    flags: list[float] = []
    for t in turns:
        if str(t.get("role", "")).lower() != "user":
            continue
        sa = _get_turn_speech(t)
        if not sa:
            continue
        s = 78.0
        if sa.get("cognitive_slowdown_flag"):
            s -= 18.0
        if sa.get("excessive_hesitation_flag"):
            s -= 14.0
        if sa.get("excessive_repetition_flag"):
            s -= 16.0
        lp = int(sa.get("long_pause_count") or 0)
        s -= min(24.0, lp * 6.0)
        flags.append(max(0.0, min(100.0, s)))
    if not flags:
        return None
    return float(sum(flags) / len(flags))


def _speech_fluency_score(tokens: list[str]) -> float:
    if not tokens:
        return 0.0
    hes = sum(1 for t in tokens if t in HESITATION_TOKENS)
    hes_r = hes / max(1, len(tokens))
    # Encourage substantive total output across all user turns.
    len_score = min(1.0, len(tokens) / 45.0)
    raw = (1.0 - min(1.0, hes_r * 2.2)) * 62.0 + len_score * 38.0
    return float(max(0.0, min(100.0, raw)))


def _memory_coherence_score(turns: list[dict[str, Any]]) -> float:
    # Routine + autobiographical + cultural reminiscence (festival / family).
    mem_steps = {"memory_routine", "memory_past", "cultural"}
    scores: list[float] = []
    for t in turns:
        if str(t.get("role", "")).lower() != "user":
            continue
        sid = str(t.get("stepId") or t.get("step_id") or "")
        if sid not in mem_steps:
            continue
        txt = str(t.get("text", "")).strip()
        low = txt.lower()
        words = low.split()
        if len(words) < 3:
            scores.append(32.0)
            continue
        if any(p in low for p in _MEMORY_NEG_PHRASES):
            scores.append(38.0)
            continue
        scores.append(float(max(45.0, min(100.0, 48.0 + len(words) * 2.8))))
    if not scores:
        return 50.0
    return float(sum(scores) / len(scores))


def _emotional_stability_score(tokens: list[str]) -> float:
    if not tokens:
        return 48.0
    pos = sum(1 for t in tokens if t in POS_TOKENS)
    neg = sum(1 for t in tokens if t in NEG_TOKENS)
    if pos + neg == 0:
        return 58.0
    bal = (pos - neg) / max(1, pos + neg)
    return float(max(0.0, min(100.0, (bal + 1.0) / 2.0 * 100.0)))


def _response_relevance_score(turns: list[dict[str, Any]]) -> float:
    scores: list[float] = []
    for t in turns:
        if str(t.get("role", "")).lower() != "user":
            continue
        sid = str(t.get("stepId") or t.get("step_id") or "")
        topic = STEP_TO_TOPIC.get(sid, "greeting")
        txt = str(t.get("text", "")).strip()
        if not txt:
            scores.append(15.0)
            continue
        if topic == "greeting":
            scores.append(72.0 if len(txt) > 2 else 35.0)
            continue
        kws = TOPIC_KEYWORDS.get(topic, set())
        utoks = set(_tokenize(txt))
        overlap = len(utoks & kws)
        scores.append(float(min(100.0, 38.0 + overlap * 14.0)))
    if not scores:
        return 50.0
    return float(sum(scores) / len(scores))


def analyze_conversation_agent(raw: dict[str, Any] | None) -> dict[str, Any] | None:
    """Return scoring pack from stored session payload, or None if missing."""
    if not raw:
        return None
    turns = raw.get("turns") or []
    if not turns:
        return None

    user_texts = [str(t.get("text", "")) for t in turns if str(t.get("role", "")).lower() == "user"]
    full = " ".join(user_texts).strip()
    tokens = _tokenize(full)

    text_fluency = _speech_fluency_score(tokens)
    mic_fluency = _mic_fluency_from_turns(turns)
    if mic_fluency is not None:
        speech_fluency = 0.42 * text_fluency + 0.58 * mic_fluency
    else:
        speech_fluency = text_fluency

    memory_coherence = _memory_coherence_score(turns)
    emotional_stability = _emotional_stability_score(tokens)

    relevance = _response_relevance_score(turns)
    latency = _latency_attention_score(turns)
    if latency is not None:
        response_relevance = 0.68 * relevance + 0.32 * latency
    else:
        response_relevance = relevance

    confusion_proxy = _confusion_proxy_from_turns(turns)
    if confusion_proxy is not None:
        speech_fluency = 0.82 * speech_fluency + 0.18 * confusion_proxy

    conversation_score = (
        speech_fluency + memory_coherence + emotional_stability + response_relevance
    ) / 4.0

    wpms: list[float] = []
    for t in turns:
        if str(t.get("role", "")).lower() != "user":
            continue
        sa = _get_turn_speech(t)
        if sa and sa.get("words_per_minute") is not None:
            try:
                wpms.append(float(sa["words_per_minute"]))
            except (TypeError, ValueError):
                pass
    avg_wpm = float(sum(wpms) / len(wpms)) if wpms else None

    return {
        "conversation_score": round(conversation_score, 2),
        "speech_fluency_score": round(speech_fluency, 2),
        "memory_coherence_score": round(memory_coherence, 2),
        "emotional_stability_score": round(emotional_stability, 2),
        "response_relevance_score": round(response_relevance, 2),
        "user_turns": len(user_texts),
        "total_words": len(tokens),
        "mic_enriched": mic_fluency is not None,
        "avg_words_per_minute": round(avg_wpm, 1) if avg_wpm is not None else None,
        "latency_attention_score": round(latency, 2) if latency is not None else None,
        "confusion_proxy_score": round(confusion_proxy, 2) if confusion_proxy is not None else None,
    }


def apply_conversation_to_domains(
    domains: dict[str, float], pack: dict[str, Any]
) -> dict[str, float]:
    """Small partial-C adjustment: memory + language domains only (±2.5 max each)."""
    out = dict(domains)
    mc = float(pack.get("memory_coherence_score", 50))
    sf = float(pack.get("speech_fluency_score", 50))
    rr = float(pack.get("response_relevance_score", 50))
    delta_m = (mc - 50.0) / 50.0 * 2.5
    delta_l = ((sf + rr) / 2.0 - 50.0) / 50.0 * 2.5
    out["memory"] = float(max(0.0, min(20.0, out.get("memory", 0.0) + delta_m)))
    out["language"] = float(max(0.0, min(20.0, out.get("language", 0.0) + delta_l)))
    return out
