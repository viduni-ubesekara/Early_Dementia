const API =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_URL) ||
  "";

export function buildPayload(domainSums, reactionTimeAvg, accuracyRate, hesitationTime, errorCount, completionTime) {
  return {
    session: {
      orientation_score: Math.min(20, domainSums.orientation),
      memory_score: Math.min(20, domainSums.memory),
      attention_score: Math.min(20, domainSums.attention),
      language_score: Math.min(20, domainSums.language),
      visual_spatial_score: Math.min(20, domainSums.visual),
      reaction_time_avg: Math.max(0.05, reactionTimeAvg),
      accuracy_rate: Math.min(1, Math.max(0, accuracyRate)),
      hesitation_time: Math.max(0, hesitationTime),
      error_count: errorCount,
      completion_time: Math.max(1, completionTime),
    },
    medical: {
      dementia_history: 0,
      stroke_history: 0,
      Parkinsons: 0,
      diabetes: 0,
      hypertension: 0,
      depression: 0,
      medication_load: 2,
      MMSE_previous_score: 28.0,
      MMSE_decline_rate: 0.2,
      physician_rating: 2,
      confusion_reported: 0,
      memory_loss_reported: 0,
      hippocampal_volume: 4000.0,
      brain_atrophy_level: 0.0,
      cortical_thickness: 2.4,
      lesion_score: 0.0,
      Alzheimer_pattern_detected: 0,
    },
    model_name: "random_forest",
    store_session: false,
  };
}

export async function submitSession(body, modelName) {
  const b = { ...body, model_name: modelName || body.model_name };
  const r = await fetch(`${API}/api/predict`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(b),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || r.statusText);
  }
  return r.json();
}

export async function fetchMetrics() {
  const r = await fetch(`${API}/api/metrics`);
  if (!r.ok) throw new Error("metrics");
  return r.json();
}

async function _post(path, body) {
  const r = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || r.statusText);
  }
  return r.json();
}

export async function startSession(displayName) {
  return _post("/api/start-session", { display_name: displayName || null });
}

export async function recordBehavior(payload) {
  return _post("/api/record-behavior", payload);
}

export async function completeAssessment(payload) {
  return _post("/api/complete-assessment", payload);
}

/** Webcam JPEG blob → YOLO confusion (requires backend + best.pt + requirements-confusion). */
export async function analyzeConfusionWebcamFrame(blob) {
  const fd = new FormData();
  fd.append("file", blob, "frame.jpg");
  const res = await fetch(`${API}/api/analyze-confusion-frame`, {
    method: "POST",
    body: fd,
  });
  if (!res.ok) {
    let t = await res.text();
    try {
      const j = JSON.parse(t);
      if (j.detail != null) t = Array.isArray(j.detail) ? j.detail.map((d) => d.msg || d).join("; ") : String(j.detail);
    } catch {
      /* plain text */
    }
    throw new Error(t || res.statusText);
  }
  return res.json();
}

/** Upload a 2D MRI slice (PNG/JPEG). Fills imaging-related medical fields from model or heuristic. */
export async function analyzeMriImage(file) {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${API}/api/analyze-mri-image`, {
    method: "POST",
    body: fd,
  });
  if (!res.ok) {
    let t = await res.text();
    try {
      const j = JSON.parse(t);
      if (j.detail != null) t = Array.isArray(j.detail) ? j.detail.map((d) => d.msg || d).join("; ") : String(j.detail);
    } catch {
      /* plain text */
    }
    throw new Error(t || res.statusText);
  }
  return res.json();
}

export function defaultMedical() {
  return {
    dementia_history: 0,
    stroke_history: 0,
    Parkinsons: 0,
    diabetes: 0,
    hypertension: 0,
    depression: 0,
    anxiety: 0,
    medication_load: 2,
    MMSE_previous_score: 28.0,
    MMSE_decline_rate: 0.2,
    physician_rating: 2,
    confusion_reported: 0,
    memory_loss_reported: 0,
    hippocampal_volume: 4000.0,
    brain_atrophy_level: 0.0,
    cortical_thickness: 2.4,
    lesion_score: 0.0,
    Alzheimer_pattern_detected: 0,
  };
}
