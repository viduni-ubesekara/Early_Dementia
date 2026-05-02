import { Link } from "react-router-dom";
import { downloadAssessmentPdf } from "../utils/assessmentPdf.js";

function badge(c) {
  if (c === "Normal") return "c-normal";
  if (c === "MCI") return "c-mci";
  if (c === "Moderate") return "c-mod";
  return "c-sev";
}

function valueOr(obj, ...keys) {
  for (const k of keys) {
    if (obj && obj[k] != null) return obj[k];
  }
  return undefined;
}

function deltaTag(curr, prev) {
  if (curr == null || prev == null) return null;
  const diff = +curr - +prev;
  if (Math.abs(diff) < 0.5) return { kind: "same", label: "≈ same" };
  return diff > 0
    ? { kind: "up", label: `▲ +${diff.toFixed(1)}` }
    : { kind: "down", label: `▼ ${diff.toFixed(1)}` };
}

function summarizeSpeechFromResult(res) {
  const beh = res.behavioral_breakdown || {};
  return {
    speech_score: beh.speech_score,
    pause_total_ms: beh.pause_total_ms,
    repetition_rate: beh.repetition_rate,
    words_per_minute: beh.words_per_minute,
  };
}

/** Full metrics view for clinicians / developers */
export default function ClinicianResultsPanel({
  res,
  patient,
  prev,
  metrics,
  mErr,
}) {
  const S = valueOr(res, "final_score", "cognitive_risk_score_S");
  const scores = res.scores || {
    C: res.score_components?.C_cognitive,
    B: res.score_components?.B_behavioral,
    P: res.score_components?.P_performance,
    M: res.score_components?.M_medical_ML,
  };
  const medical = res.medical || {};
  const beh = res.behavioral_breakdown;
  const perf = res.performance_breakdown;
  const rule = res.risk_level || res.rule_based_class;
  const ml = res.fused_model_class;
  const insights = res.insights;

  return (
    <>
      <p className="lead">{res.disclaimer}</p>

      {patient && (
        <div className="card">
          <div className="tag">Patient (full)</div>
          <div className="grid2" style={{ marginTop: 6 }}>
            <div>
              <label>Name</label>
              <p style={{ fontWeight: 600, margin: "0.1rem 0" }}>{patient.fullName || "—"}</p>
            </div>
            <div>
              <label>Patient ID</label>
              <p style={{ margin: "0.1rem 0" }}>{patient.patientId || "—"}</p>
            </div>
            <div>
              <label>Age / Gender</label>
              <p style={{ margin: "0.1rem 0" }}>
                {patient.age != null ? `${patient.age} y` : "—"}
                {patient.gender ? ` · ${patient.gender}` : ""}
              </p>
            </div>
            <div>
              <label>Education / Handedness</label>
              <p style={{ margin: "0.1rem 0" }}>
                {patient.educationYears != null && patient.educationYears !== ""
                  ? `${patient.educationYears} yr`
                  : "—"}
                {patient.handedness ? ` · ${patient.handedness}` : ""}
              </p>
            </div>
            <div>
              <label>Assessment date</label>
              <p style={{ margin: "0.1rem 0" }}>{patient.assessmentDate || "—"}</p>
            </div>
            <div>
              <label>Examiner</label>
              <p style={{ margin: "0.1rem 0" }}>{patient.examinerName || "—"}</p>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <div className="tag">Cognitive risk score S (0–100)</div>
            <div className="score-big">{S}</div>
            <div className="bar">
              <i style={{ width: `${S}%` }} />
            </div>
          </div>
          <div>
            <div className="tag">Rule from S</div>
            <div className={`class-badge ${badge(rule)}`}>{rule}</div>
            {ml && (
              <>
                <div style={{ marginTop: 12 }} className="tag">
                  Fused model ({res.model_used})
                </div>
                <div className={`class-badge ${badge(ml)}`}>{ml}</div>
                <p style={{ color: "var(--muted)", margin: "0.4rem 0 0" }}>
                  model confidence: {res.model_confidence}
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      {prev && (
        <div className="card adv-compare">
          <div className="tag">Comparison with previous session (explainability)</div>
          <div className="grid2" style={{ marginTop: 8 }}>
            {[
              ["Final S", valueOr(res, "final_score", "cognitive_risk_score_S"),
                valueOr(prev, "final_score", "cognitive_risk_score_S")],
              ["Cognition C", scores.C, prev.scores?.C ?? prev.score_components?.C_cognitive],
              ["Behavior B", scores.B, prev.scores?.B ?? prev.score_components?.B_behavioral],
              ["Performance P", scores.P, prev.scores?.P ?? prev.score_components?.P_performance],
              ["Medical M", scores.M, prev.scores?.M ?? prev.score_components?.M_medical_ML],
            ].map(([label, curr, p]) => {
              const d = deltaTag(curr, p);
              return (
                <div key={label} className="adv-compare-row">
                  <div>
                    <div className="tag">{label}</div>
                    <p style={{ margin: "0.2rem 0", fontSize: "1.1rem" }}>
                      {curr != null ? Number(curr).toFixed(1) : "—"}{" "}
                      <span style={{ color: "var(--muted)" }}>
                        (was {p != null ? Number(p).toFixed(1) : "—"})
                      </span>
                    </p>
                  </div>
                  {d && <span className={`adv-delta adv-delta-${d.kind}`}>{d.label}</span>}
                </div>
              );
            })}
          </div>
          {(() => {
            const cur = summarizeSpeechFromResult(res);
            const old = summarizeSpeechFromResult(prev);
            const lines = [];
            if (cur.speech_score != null && old.speech_score != null) {
              const d = +cur.speech_score - +old.speech_score;
              if (Math.abs(d) >= 3) {
                lines.push(
                  d < 0
                    ? `Speech quality dropped by ${Math.abs(d).toFixed(1)} points compared to last session.`
                    : `Speech quality improved by ${d.toFixed(1)} points compared to last session.`
                );
              }
            }
            if (lines.length === 0) return null;
            return (
              <div className="insight insight-amber" style={{ marginTop: 10 }}>
                <p className="insight-headline">What changed since last time</p>
                <ul className="insight-list">
                  {lines.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </div>
            );
          })()}
        </div>
      )}

      {res.adaptive && (
        <div className="card">
          <div className="tag">Adaptive testing summary</div>
          <div className="grid2" style={{ marginTop: 8 }}>
            <div>
              <label>Highest memory level reached</label>
              <p style={{ margin: "0.2rem 0", fontSize: "1.1rem" }}>
                Level {(res.adaptive.memory_level ?? 0) + 1} (
                {["3 items", "5 items", "7 items"][res.adaptive.memory_level ?? 0]})
              </p>
            </div>
            <div>
              <label>Running accuracy across all items</label>
              <p style={{ margin: "0.2rem 0", fontSize: "1.1rem" }}>
                {Math.round((res.adaptive.accuracy || 0) * 100)}%
              </p>
            </div>
          </div>
          {res.advanced_session && (
            <p style={{ color: "var(--muted)", marginTop: 6, fontSize: "0.92rem" }}>
              Adaptive session: difficulty adjusted to performance.
            </p>
          )}
        </div>
      )}

      {insights && (
        <div className="card">
          <div className="tag">Cognitive insight & recommendations (technical)</div>
          <div className={`insight insight-${insights.primary?.color || "amber"}`}>
            <p className="insight-headline">{insights.primary?.headline}</p>
            {insights.primary?.findings?.length > 0 && (
              <>
                <div className="insight-section-tag">Findings</div>
                <ul className="insight-list">
                  {insights.primary.findings.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </>
            )}
            {insights.primary?.suggestions?.length > 0 && (
              <>
                <div className="insight-section-tag">Recommended next steps</div>
                <ul className="insight-list">
                  {insights.primary.suggestions.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {insights.secondary?.length > 0 && (
            <>
              <div className="insight-section-tag" style={{ marginTop: "1rem" }}>
                Secondary mental-health insights
              </div>
              {insights.secondary.map((s) => (
                <div
                  key={s.key}
                  className={`insight insight-${
                    s.severity === "high" ? "red" : s.severity === "moderate" ? "orange" : "amber"
                  }`}
                  style={{ marginTop: "0.6rem" }}
                >
                  <p style={{ margin: "0.15rem 0", fontWeight: 600 }}>
                    {s.label}
                    <span className={`severity-pill sev-${s.severity}`}>{s.severity}</span>
                  </p>
                  {s.evidence?.length > 0 && (
                    <>
                      <div className="insight-section-tag">Why this was flagged</div>
                      <ul className="insight-list">
                        {s.evidence.map((e, i) => (
                          <li key={i}>{e}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  {s.suggestions?.length > 0 && (
                    <>
                      <div className="insight-section-tag">Suggestions</div>
                      <ul className="insight-list">
                        {s.suggestions.map((sg, i) => (
                          <li key={i}>{sg}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              ))}
            </>
          )}

          {insights.confidence_note && (
            <p style={{ color: "var(--muted)", marginTop: "0.75rem" }}>{insights.confidence_note}</p>
          )}
          {insights.disclaimer && <p className="disclaimer">{insights.disclaimer}</p>}
        </div>
      )}

      {res.conversation_agent && (
        <div className="card">
          <div className="tag">Conversational agent metrics</div>
          <p style={{ color: "var(--muted)", fontSize: "0.92rem", marginTop: 6 }}>
            Passive dialogue features (speech, coherence, tone, relevance). Proxies only.
          </p>
          <div className="grid2" style={{ marginTop: 10 }}>
            <div>
              <label>Conversation composite (0–100)</label>
              <p style={{ fontSize: "1.35rem", margin: "0.2rem 0" }}>
                {res.conversation_agent.conversation_score ?? "—"}
              </p>
            </div>
            <div>
              <label>User turns / words</label>
              <p style={{ margin: "0.2rem 0" }}>
                {res.conversation_agent.user_turns ?? "—"} turns ·{" "}
                {res.conversation_agent.total_words ?? "—"} words
              </p>
            </div>
            <div>
              <label>Speech fluency</label>
              <p>{res.conversation_agent.speech_fluency_score ?? "—"}</p>
            </div>
            <div>
              <label>Memory coherence</label>
              <p>{res.conversation_agent.memory_coherence_score ?? "—"}</p>
            </div>
            <div>
              <label>Emotional stability</label>
              <p>{res.conversation_agent.emotional_stability_score ?? "—"}</p>
            </div>
            <div>
              <label>Response relevance</label>
              <p>{res.conversation_agent.response_relevance_score ?? "—"}</p>
            </div>
            <div>
              <label>Mic-enriched scoring</label>
              <p>
                {res.conversation_agent.mic_enriched === true
                  ? "Yes"
                  : res.conversation_agent.mic_enriched === false
                    ? "No"
                    : "—"}
              </p>
            </div>
            <div>
              <label>Avg. words/min</label>
              <p>
                {res.conversation_agent.avg_words_per_minute != null
                  ? `${res.conversation_agent.avg_words_per_minute} wpm`
                  : "—"}
              </p>
            </div>
            <div>
              <label>Latency / attention (0–100)</label>
              <p>{res.conversation_agent.latency_attention_score ?? "—"}</p>
            </div>
            <div>
              <label>Confusion proxy (0–100)</label>
              <p>{res.conversation_agent.confusion_proxy_score ?? "—"}</p>
            </div>
          </div>
        </div>
      )}

      <div className="card grid2">
        <div>
          <div className="tag">C (cognitive)</div>
          <p style={{ fontSize: "1.4rem" }}>{scores.C?.toFixed?.(1) ?? scores.C}</p>
        </div>
        <div>
          <div className="tag">B (behavioral)</div>
          <p style={{ fontSize: "1.4rem" }}>{scores.B?.toFixed?.(1) ?? scores.B}</p>
        </div>
        <div>
          <div className="tag">P (performance)</div>
          <p style={{ fontSize: "1.4rem" }}>{scores.P?.toFixed?.(1) ?? scores.P}</p>
        </div>
        <div>
          <div className="tag">M (medical, ML)</div>
          <p style={{ fontSize: "1.4rem" }}>{scores.M?.toFixed?.(1) ?? scores.M}</p>
        </div>
      </div>

      {(medical.H != null || medical.R != null || medical.I != null) && (
        <div className="card grid2">
          <div>
            <div className="tag">H — clinical history</div>
            <div className="bar">
              <i style={{ width: `${medical.H || 0}%` }} />
            </div>
            <p>{medical.H?.toFixed?.(1) ?? medical.H}</p>
          </div>
          <div>
            <div className="tag">R — reports</div>
            <div className="bar">
              <i style={{ width: `${medical.R || 0}%` }} />
            </div>
            <p>{medical.R?.toFixed?.(1) ?? medical.R}</p>
          </div>
          <div>
            <div className="tag">I — imaging</div>
            <div className="bar">
              <i style={{ width: `${medical.I || 0}%` }} />
            </div>
            <p>{medical.I?.toFixed?.(1) ?? medical.I}</p>
          </div>
        </div>
      )}

      {beh && (
        <div className="card">
          <div className="tag">B breakdown (0.4·reaction + 0.3·facial + 0.3·speech)</div>
          <div className="grid2" style={{ marginTop: 8 }}>
            <div>
              <label>reaction behavior</label>
              <div className="bar">
                <i style={{ width: `${beh.reaction_behavior || 0}%` }} />
              </div>
              <p>{beh.reaction_behavior}</p>
            </div>
            <div>
              <label>facial</label>
              <div className="bar">
                <i style={{ width: `${beh.facial_score || 0}%` }} />
              </div>
              <p>{beh.facial_score}</p>
            </div>
            <div>
              <label>speech</label>
              <div className="bar">
                <i style={{ width: `${beh.speech_score || 0}%` }} />
              </div>
              <p>{beh.speech_score}</p>
            </div>
            <div>
              <label>weights</label>
              <p style={{ color: "var(--muted)" }}>
                {Object.entries(beh.weights || {})
                  .map(([k, v]) => `${k}:${v}`)
                  .join("  ·  ")}
              </p>
            </div>
          </div>
        </div>
      )}

      {perf && (
        <div className="card grid2">
          <div>
            <div className="tag">avg reaction time</div>
            <p>{perf.avg_reaction_time_s}s</p>
          </div>
          <div>
            <div className="tag">accuracy</div>
            <p>{Math.round((perf.accuracy_rate || 0) * 100)}%</p>
          </div>
          <div>
            <div className="tag">completion time</div>
            <p>{perf.completion_time_s}s</p>
          </div>
        </div>
      )}

      {res.domain_breakdown_0_20 && (
        <div className="card">
          <div className="tag">Domain breakdown (0–20 per domain)</div>
          <div className="grid2" style={{ marginTop: 8 }}>
            {Object.entries(res.domain_breakdown_0_20).map(([k, v]) => (
              <div key={k}>
                <label>{k.replace("_", " ")}</label>
                <div className="bar">
                  <i style={{ width: `${(v / 20) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {res.class_probabilities && (
        <div className="card">
          <div className="tag">Class probabilities (explainability)</div>
          <div className="grid2" style={{ marginTop: 8 }}>
            {Object.entries(res.class_probabilities).map(([k, v]) => (
              <div key={k} className="row" style={{ justifyContent: "space-between" }}>
                <span>{k}</span>
                <span>{(v * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {metrics && (
        <div className="card">
          <div className="tag">Panel metrics (hold-out evaluation)</div>
          {["random_forest", "xgboost", "logistic_regression"].map((n) => {
            const m = metrics[n];
            if (!m) return null;
            return (
              <div key={n} style={{ marginBottom: 12 }}>
                <strong>{n}</strong>: acc {m.accuracy?.toFixed(4)} · macro F1 {m.macro_f1?.toFixed(4)}{" "}
                · ROC AUC (OvR) {m.roc_auc_macro_ovr?.toFixed(4)}
              </div>
            );
          })}
        </div>
      )}
      {mErr && <p className="lead">{mErr}</p>}

      <div className="card">
        <div
          className="row"
          style={{
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <div className="tag">Export (full technical)</div>
            <p style={{ margin: "0.35rem 0 0", color: "var(--muted)", fontSize: "0.92rem" }}>
              PDF includes scores C/B/P/M, probabilities, and model notes.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => downloadAssessmentPdf({ res, patient, prev, caregiver: false })}
          >
            Download PDF
          </button>
        </div>
      </div>

      <p style={{ marginTop: 16 }}>
        <Link className="btn btn-ghost" to="/">
          ← Home
        </Link>
      </p>
    </>
  );
}
