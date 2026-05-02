import { jsPDF } from "jspdf";
import {
  buildPillars,
  caregiverFindingsBullets,
  caregiverRecommendations,
  getCareStatus,
  softenSecondaryBlock,
} from "../lib/caregiverDashboard.js";

function valueOr(obj, ...keys) {
  for (const k of keys) {
    if (obj && obj[k] != null) return obj[k];
  }
  return undefined;
}

function safeNum(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Generates a downloadable PDF summarizing the last assessment result.
 * @param {{ res: object; patient?: object | null; prev?: object | null; caregiver?: boolean }} opts
 */
export function downloadAssessmentPdf({ res, patient, prev, caregiver = false }) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 48;
  const maxW = pageW - margin * 2;
  let y = margin;
  const titleSize = 16;
  const bodySize = 10;
  const sectSize = 12;
  const lineGap = 14;
  const smallGap = 6;

  const ensureSpace = (needed) => {
    if (y + needed > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  };

  const addTitle = (text) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(titleSize);
    ensureSpace(lineGap * 2);
    const lines = doc.splitTextToSize(text, maxW);
    for (const line of lines) {
      doc.text(line, margin, y);
      y += lineGap + 4;
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(bodySize);
  };

  const addSection = (text) => {
    y += smallGap;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(sectSize);
    ensureSpace(lineGap * 2);
    const lines = doc.splitTextToSize(text, maxW);
    for (const line of lines) {
      doc.text(line, margin, y);
      y += lineGap;
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(bodySize);
  };

  const addParagraph = (text) => {
    if (text == null || String(text).trim() === "") return;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(bodySize);
    const lines = doc.splitTextToSize(String(text), maxW);
    for (const line of lines) {
      ensureSpace(lineGap);
      doc.text(line, margin, y);
      y += lineGap;
    }
  };

  const addLines = (items) => {
    for (const item of items) {
      addParagraph(`• ${item}`);
    }
  };

  const S = valueOr(res, "final_score", "cognitive_risk_score_S");
  const scores = res.scores || {
    C: res.score_components?.C_cognitive,
    B: res.score_components?.B_behavioral,
    P: res.score_components?.P_performance,
    M: res.score_components?.M_medical_ML,
  };
  const medical = res.medical || {};
  const rule = res.risk_level || res.rule_based_class;
  const ml = res.fused_model_class;
  const beh = res.behavioral_breakdown;
  const perf = res.performance_breakdown;
  const insights = res.insights;

  if (caregiver) {
    const status = getCareStatus(res, insights);
    const pillars = buildPillars(res, scores, beh, perf);
    const findings = caregiverFindingsBullets(insights, status);
    const recs = caregiverRecommendations(insights);

    addTitle("Cognitive check summary");
    const stamp = new Date().toLocaleString();
    addParagraph(`Generated: ${stamp}`);
    addParagraph("This summary is not a diagnosis.");
    y += smallGap;
    if (patient) {
      addSection("Participant");
      addParagraph(
        `${patient.fullName || "—"}${patient.age != null ? ` · ${patient.age} years` : ""}${patient.assessmentDate ? ` · ${patient.assessmentDate}` : ""}`
      );
    }
    addSection("Overall");
    addParagraph(`Status: ${status.label} (${status.dot})`);
    addParagraph(`Confidence in this reading: ${status.confidenceWord}`);
    addParagraph(status.shortResult);
    addSection("Overview by area");
    for (const p of pillars) {
      addParagraph(`${p.icon} ${p.title}: ${p.level} — ${p.hint}`);
    }
    addSection("What this may mean");
    addLines(findings);
    addParagraph(
      "Mood, tiredness, medications, or the room can affect any short screening."
    );
    if (insights?.secondary?.length) {
      addSection("Well-being notes");
      for (const s of insights.secondary) {
        const soft = softenSecondaryBlock(s);
        addParagraph(`${soft.title}: ${soft.body}`);
      }
    }
    addSection("Suggested next steps");
    addLines(recs);
    const slug =
      patient?.patientId?.replace(/[^\w.-]+/g, "_") ||
      `summary-${new Date().toISOString().slice(0, 10)}`;
    doc.save(`cognitive-check-${slug}.pdf`);
    return;
  }

  addTitle("Assessment report");

  const stamp = new Date().toLocaleString();
  addParagraph(`Generated: ${stamp}`);
  if (patient?.assessmentDate) addParagraph(`Assessment date: ${patient.assessmentDate}`);
  y += smallGap;

  if (patient) {
    addSection("Patient");
    addParagraph(`Name: ${patient.fullName || "—"}`);
    addParagraph(`Patient ID: ${patient.patientId || "—"}`);
    const ageG =
      patient.age != null
        ? `${patient.age} y${patient.gender ? ` · ${patient.gender}` : ""}`
        : "—";
    addParagraph(`Age / gender: ${ageG}`);
    const edu =
      patient.educationYears != null && patient.educationYears !== ""
        ? `${patient.educationYears} yr`
        : "—";
    addParagraph(`Education / handedness: ${edu}${patient.handedness ? ` · ${patient.handedness}` : ""}`);
    addParagraph(`Examiner: ${patient.examinerName || "—"}`);
  }

  addSection("Summary");
  addParagraph(`Cognitive risk score S (0–100): ${S != null ? S : "—"}`);
  addParagraph(`Rule-based classification: ${rule ?? "—"}`);
  if (ml) {
    addParagraph(`Fused model (${res.model_used ?? "—"}): ${ml}`);
    if (res.model_confidence != null) addParagraph(`Model confidence: ${res.model_confidence}`);
  }
  if (res.disclaimer) {
    addSection("Disclaimer");
    addParagraph(res.disclaimer);
  }

  addSection("Score components");
  addParagraph(
    `C (cognitive): ${scores.C?.toFixed?.(1) ?? scores.C ?? "—"}  ·  B (behavioral): ${scores.B?.toFixed?.(1) ?? scores.B ?? "—"}`
  );
  addParagraph(
    `P (performance): ${scores.P?.toFixed?.(1) ?? scores.P ?? "—"}  ·  M (medical ML): ${scores.M?.toFixed?.(1) ?? scores.M ?? "—"}`
  );

  if (medical.H != null || medical.R != null || medical.I != null) {
    addSection("Clinical inputs (H / R / I)");
    addParagraph(
      `H: ${medical.H?.toFixed?.(1) ?? medical.H ?? "—"}  ·  R: ${medical.R?.toFixed?.(1) ?? medical.R ?? "—"}  ·  I: ${medical.I?.toFixed?.(1) ?? medical.I ?? "—"}`
    );
  }

  if (beh) {
    addSection("Behavioral breakdown");
    addParagraph(
      `Reaction: ${beh.reaction_behavior ?? "—"}  ·  Facial: ${beh.facial_score ?? "—"}  ·  Speech: ${beh.speech_score ?? "—"}`
    );
    if (beh.weights && Object.keys(beh.weights).length) {
      addParagraph(
        `Weights: ${Object.entries(beh.weights)
          .map(([k, v]) => `${k}: ${v}`)
          .join(" · ")}`
      );
    }
  }

  if (perf) {
    addSection("Performance");
    addParagraph(
      `Avg reaction time: ${perf.avg_reaction_time_s ?? "—"} s  ·  Accuracy: ${
        perf.accuracy_rate != null ? `${Math.round(perf.accuracy_rate * 100)}%` : "—"
      }  ·  Completion: ${perf.completion_time_s ?? "—"} s`
    );
  }

  if (res.adaptive) {
    addSection("Adaptive testing");
    const lvl = (res.adaptive.memory_level ?? 0) + 1;
    const items = ["3 items", "5 items", "7 items"][res.adaptive.memory_level ?? 0];
    addParagraph(`Highest memory level: ${lvl} (${items})`);
    addParagraph(`Running accuracy: ${Math.round((res.adaptive.accuracy || 0) * 100)}%`);
  }

  if (res.domain_breakdown_0_20 && Object.keys(res.domain_breakdown_0_20).length) {
    addSection("Domain breakdown (0–20)");
    for (const [k, v] of Object.entries(res.domain_breakdown_0_20)) {
      addParagraph(`${k.replace(/_/g, " ")}: ${v}`);
    }
  }

  if (res.class_probabilities && Object.keys(res.class_probabilities).length) {
    addSection("Class probabilities");
    for (const [k, v] of Object.entries(res.class_probabilities)) {
      addParagraph(`${k}: ${(Number(v) * 100).toFixed(1)}%`);
    }
  }

  if (insights) {
    if (insights.primary) {
      addSection("Cognitive insight");
      if (insights.primary.headline) addParagraph(insights.primary.headline);
      if (insights.primary.findings?.length) {
        addParagraph("Findings:");
        addLines(insights.primary.findings);
      }
      if (insights.primary.suggestions?.length) {
        addParagraph("Recommended next steps:");
        addLines(insights.primary.suggestions);
      }
    }
    if (insights.secondary?.length) {
      addSection("Secondary insights");
      for (const s of insights.secondary) {
        addParagraph(`${s.label} (${s.severity})`);
        if (s.evidence?.length) addLines(s.evidence);
        if (s.suggestions?.length) addLines(s.suggestions);
      }
    }
    if (insights.confidence_note) addParagraph(insights.confidence_note);
    if (insights.disclaimer) addParagraph(insights.disclaimer);
  }

  if (res.conversation_agent) {
    addSection("Conversational assessment");
    const ca = res.conversation_agent;
    addParagraph(`Composite: ${ca.conversation_score ?? "—"}`);
    addParagraph(`User turns / words: ${ca.user_turns ?? "—"} / ${ca.total_words ?? "—"}`);
    addParagraph(
      `Fluency: ${ca.speech_fluency_score ?? "—"}  ·  Memory: ${ca.memory_coherence_score ?? "—"}  ·  Emotional: ${ca.emotional_stability_score ?? "—"}  ·  Relevance: ${ca.response_relevance_score ?? "—"}`
    );
  }

  if (prev) {
    addSection("Comparison with previous session");
    const rows = [
      ["Final S", valueOr(res, "final_score", "cognitive_risk_score_S"), valueOr(prev, "final_score", "cognitive_risk_score_S")],
      ["C", scores.C, prev.scores?.C ?? prev.score_components?.C_cognitive],
      ["B", scores.B, prev.scores?.B ?? prev.score_components?.B_behavioral],
      ["P", scores.P, prev.scores?.P ?? prev.score_components?.P_performance],
      ["M", scores.M, prev.scores?.M ?? prev.score_components?.M_medical_ML],
    ];
    for (const [label, curr, p] of rows) {
      const c = safeNum(curr);
      const pr = safeNum(p);
      addParagraph(
        `${label}: ${c != null ? c.toFixed(1) : "—"} (previous: ${pr != null ? pr.toFixed(1) : "—"})`
      );
    }
  }

  const slug =
    patient?.patientId?.replace(/[^\w.-]+/g, "_") ||
    `report-${new Date().toISOString().slice(0, 10)}`;
  doc.save(`assessment-${slug}.pdf`);
}
