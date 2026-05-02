/**
 * Maps assessment payloads to caregiver-safe copy (no diagnosis tone).
 */

export function valueOr(obj, ...keys) {
  for (const k of keys) {
    if (obj && obj[k] != null) return obj[k];
  }
  return undefined;
}

export function parseModelConfidence(raw) {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n > 1 ? n / 100 : n;
}

/** Low / Medium / High — no decimals shown to families. */
export function confidenceLabel(raw) {
  const c = parseModelConfidence(raw);
  if (c == null) return "Medium";
  if (c < 0.45) return "Low";
  if (c < 0.65) return "Medium";
  return "High";
}

const STATUS = {
  good: {
    key: "good",
    label: "Looking Good Overall",
    shortResult: "Results look reassuring for this screening.",
    dot: "🟢",
    className: "care-status care-status--good",
  },
  attention: {
    key: "attention",
    label: "Needs Attention",
    shortResult: "A few areas may benefit from follow-up.",
    dot: "🟡",
    className: "care-status care-status--attention",
  },
  monitor: {
    key: "monitor",
    label: "Monitor Closely",
    shortResult: "Several signals suggest closer watch and professional input.",
    dot: "🟠",
    className: "care-status care-status--monitor",
  },
  review: {
    key: "review",
    label: "Needs Medical Review",
    shortResult: "It is important to discuss these results with a healthcare professional soon.",
    dot: "🔴",
    className: "care-status care-status--review",
  },
  unclear: {
    key: "unclear",
    label: "Needs Further Checking",
    shortResult: "The results are not clear enough for a strong conclusion from this session alone.",
    dot: "🟡",
    className: "care-status care-status--attention",
  },
};

/**
 * Caregiver summary line from tier, indeterminate flag, and confidence.
 */
export function getCareStatus(res, insights) {
  const tier = insights?.primary?.tier;
  const indeterminate = insights?.indeterminate === true;
  const conf = parseModelConfidence(res?.model_confidence);
  const unclear = indeterminate || tier === "Indeterminate" || (conf != null && conf < 0.52);

  if (unclear) {
    return {
      ...STATUS.unclear,
      confidenceWord: confidenceLabel(res?.model_confidence),
    };
  }

  const rule = res?.risk_level || res?.rule_based_class || tier;
  if (rule === "Normal" || tier === "Normal") {
    return { ...STATUS.good, confidenceWord: confidenceLabel(res?.model_confidence) };
  }
  if (rule === "MCI" || tier === "MCI") {
    return { ...STATUS.attention, confidenceWord: confidenceLabel(res?.model_confidence) };
  }
  if (rule === "Moderate" || tier === "Moderate") {
    return { ...STATUS.monitor, confidenceWord: confidenceLabel(res?.model_confidence) };
  }
  if (rule === "Severe" || tier === "Severe") {
    return { ...STATUS.review, confidenceWord: confidenceLabel(res?.model_confidence) };
  }

  return { ...STATUS.unclear, confidenceWord: confidenceLabel(res?.model_confidence) };
}

function bandFromScore(score) {
  if (score == null || Number.isNaN(score)) return { level: "Moderate", hint: "Mixed performance during the activities." };
  if (score >= 70) return { level: "Good", hint: "Performed steadily on this type of task." };
  if (score >= 45) return { level: "Moderate", hint: "Some uneven spots showed up — common when tired or distracted." };
  return { level: "Low", hint: "More difficulty than expected on this type of task." };
}

export function buildPillars(res, scores, beh, perf) {
  const d = res?.domain_breakdown_0_20 || {};
  const memRaw = d.memory ?? d.memory_domain;
  const attRaw = d.attention;
  const langRaw = d.language ?? d.language_domain;
  const visRaw = d.visuospatial ?? d.visual_spatial;

  const C = Number(scores?.C);
  const P = Number(scores?.P);
  const B = Number(scores?.B);

  const memScore =
    memRaw != null ? (Number(memRaw) / 20) * 100 * 0.55 + (Number.isFinite(C) ? C * 0.45 : 55) : Number.isFinite(C) ? C : 55;

  let attScore =
    attRaw != null ? (Number(attRaw) / 20) * 100 * 0.55 + (Number.isFinite(P) ? P * 0.45 : 55) : Number.isFinite(P) ? P : 55;
  if (perf?.accuracy_rate != null) {
    attScore = attScore * 0.75 + (perf.accuracy_rate * 100) * 0.25;
  }

  let commScore = Number.isFinite(C) ? C * 0.35 : 50;
  if (langRaw != null) commScore += (Number(langRaw) / 20) * 100 * 0.35;
  else commScore += (Number.isFinite(C) ? C : 50) * 0.35;
  const sp = beh?.speech_score;
  if (sp != null) commScore = commScore * 0.5 + Number(sp) * 0.5;
  const ca = res?.conversation_agent;
  if (ca?.speech_fluency_score != null) {
    commScore = commScore * 0.6 + Number(ca.speech_fluency_score) * 0.4;
  }

  let engScore = Number.isFinite(B) ? B : 55;
  if (beh?.facial_score != null) engScore = engScore * 0.65 + Number(beh.facial_score) * 0.35;
  if (visRaw != null) engScore = engScore * 0.85 + (Number(visRaw) / 20) * 100 * 0.15;

  const mem = bandFromScore(memScore);
  const att = bandFromScore(attScore);
  const comm = bandFromScore(commScore);
  const eng = bandFromScore(engScore);

  return [
    {
      key: "memory",
      icon: "🧠",
      title: "Memory",
      ...mem,
      hint:
        mem.level === "Low"
          ? "Some difficulty remembering recent information or steps during the session."
          : mem.level === "Good"
            ? "Memory-based tasks looked mostly comfortable."
            : mem.hint,
    },
    {
      key: "attention",
      icon: "⏱️",
      title: "Attention",
      ...att,
      hint:
        att.level === "Low"
          ? "Focus and speed seemed more variable — tiredness or distraction can affect this."
          : att.level === "Good"
            ? "Attention and pacing looked fairly steady."
            : att.hint,
    },
    {
      key: "communication",
      icon: "💬",
      title: "Communication",
      ...comm,
      hint:
        comm.level === "Low"
          ? "Speech or answers sounded less fluent or clear at times."
          : comm.level === "Good"
            ? "Communication during the session seemed fairly clear."
            : comm.hint,
    },
    {
      key: "engagement",
      icon: "❤️",
      title: "Engagement",
      ...eng,
      hint:
        eng.level === "Low"
          ? "Participation looked lower — mood, hearing, or comfort may play a role."
          : eng.level === "Good"
            ? "Stayed engaged with the activities overall."
            : eng.hint,
    },
  ];
}

const JARGON_REPLACEMENTS = [
  [/S\s*=\s*[\d.]+\s*sits in a buffer zone[^\n]*/gi, "The pattern was close to a boundary — a repeat check can help."],
  [/model confidence is low[^\n]*/gi, "the reading was less certain"],
  [/fusion model confidence[^\n]*/gi, "overall certainty"],
  [/B\s*=\s*[\d.]+/gi, "engagement signals"],
  [/speech sentiment\s*[\d.]+\s*\/\s*100/gi, "tone of speech"],
  [/composite score[^\n]*=\s*[\d.]+\s*\/\s*100/gi, "conversation participation score"],
];

export function softenTechnicalLine(line) {
  if (!line || typeof line !== "string") return "";
  let s = line;
  for (const [re, rep] of JARGON_REPLACEMENTS) s = s.replace(re, rep);
  return s.replace(/\s+/g, " ").trim();
}

/** Plain-language bullets for "What this means" — no C,B,P,M. */
export function caregiverFindingsBullets(insights, status) {
  const out = [];
  const primary = insights?.primary;
  if (primary?.headline && !/severe cognitive dysfunction/i.test(primary.headline)) {
    out.push(softenTechnicalLine(primary.headline));
  } else if (primary?.headline && /severe/i.test(primary.headline)) {
    out.push("The session raised notable concerns across several areas. A clinician should review.");
  }

  if (status.key === "unclear") {
    out.push("The results are not strong enough on their own to draw a firm conclusion.");
    out.push("Some signs of memory or thinking difficulty may have appeared — or the day, mood, or setting may have influenced performance.");
  } else {
    (primary?.findings || []).forEach((f) => {
      const t = softenTechnicalLine(f);
      if (
        t &&
        !/^Performance is consistent with normal/i.test(t) &&
        !/No immediate intervention/i.test(t) &&
        !/Medical .* risk score = [\d.]+/i.test(t)
      ) {
        out.push(t);
      }
    });
  }

  if (out.length === 0) {
    out.push("This screening looks at patterns during your session. It is one piece of information, not a full exam.");
  }
  return [...new Set(out)].slice(0, 5);
}

export function softenSecondaryBlock(s) {
  const key = s?.key || "";
  if (key === "depression_like") {
    return {
      title: "Emotional well-being",
      body:
        "The system noticed patterns that can go along with low mood or reduced energy. This does not confirm depression.",
      extra:
        "Checking in on sleep, appetite, and daily enjoyment — and talking with a clinician if concerns continue — can help.",
      suggestions: (s.suggestions || []).map(sanitizeCaregiverSuggestion).filter(Boolean),
    };
  }
  if (key === "anxiety_like" || key === "anxiety_explicit") {
    return {
      title: "Stress and worry",
      body: "There were signals that stress, nervousness, or worry may have affected the session.",
      extra: "Anxiety can overlap with attention and memory on short tests. A calm redo on another day is often useful.",
      suggestions: (s.suggestions || []).map(sanitizeCaregiverSuggestion).filter(Boolean),
    };
  }
  if (key === "cognitive_fatigue") {
    return {
      title: "Tiredness",
      body: "Signs of fatigue appeared during longer or harder parts of the session.",
      extra: "Rest, hydration, and testing earlier in the day can make the next try more representative.",
      suggestions: (s.suggestions || []).map(sanitizeCaregiverSuggestion).filter(Boolean),
    };
  }
  if (key === "conversational_concern") {
    return {
      title: "Conversation",
      body: "During relaxed conversation, flow or clarity was a bit lower than typical.",
      extra: "This supports — but does not replace — structured tasks and a clinical visit.",
      suggestions: (s.suggestions || []).map(sanitizeCaregiverSuggestion).filter(Boolean),
    };
  }
  return {
    title: (s.label || "Additional note").replace(/depression-like/i, "mood-related").replace(/behavioral pattern/i, "patterns"),
    body: "There is an extra note from the session worth discussing with a professional if it fits what you see day to day.",
    extra: null,
    suggestions: (s.suggestions || []).map(sanitizeCaregiverSuggestion).filter(Boolean),
  };
}

export function sanitizeCaregiverSuggestion(text) {
  if (!text) return "";
  let t = text;
  t = t.replace(/\bPHQ-9\b|\bGDS-15\b|\bHAM-A\b|\bGAD-7\b|\bMoCA\b|\bACE-III\b/gi, "a brief checklist with your clinician");
  t = t.replace(/neuropsychological assessment/gi, "full cognitive assessment");
  t = t.replace(/MRI\s*\/\s*neuro-imaging/gi, "brain imaging if your doctor advises");
  return t.trim();
}

export function caregiverRecommendations(insights) {
  const primary = insights?.primary;
  const base = (primary?.suggestions || []).map(sanitizeCaregiverSuggestion).filter(Boolean);
  const extra = [
    "Repeat this check on another day if the person was tired, ill, or upset.",
    "Ensure good sleep and a regular meal before a future session.",
  ];
  const merged = [...new Set([...base, ...extra])];
  return merged.slice(0, 6);
}

export function caregiverCompareNote(res, prev, scores, prevScores) {
  if (!prev) return null;
  const S = valueOr(res, "final_score", "cognitive_risk_score_S");
  const Sp = valueOr(prev, "final_score", "cognitive_risk_score_S");
  if (S == null || Sp == null) return null;
  const d = Number(S) - Number(Sp);
  if (Math.abs(d) < 2) return "Compared with the last session, overall performance looked similar.";
  if (d > 0) return "Compared with the last session, this run looked a bit stronger overall.";
  return "Compared with the last session, this run looked a bit weaker — a repeat when well-rested is a good idea.";
}
