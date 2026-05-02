import { Link } from "react-router-dom";
import {
  buildPillars,
  caregiverCompareNote,
  caregiverFindingsBullets,
  caregiverRecommendations,
  getCareStatus,
  softenSecondaryBlock,
} from "../lib/caregiverDashboard.js";

export default function CaregiverResultsView({ res, patient, prev, scores, beh, perf, insights }) {
  const status = getCareStatus(res, insights);
  const pillars = buildPillars(res, scores, beh, perf);
  const findings = caregiverFindingsBullets(insights, status);
  const recommendations = caregiverRecommendations(insights);
  const compare = caregiverCompareNote(res, prev, scores, null);

  return (
    <>
      <div className={`care-summary-card card ${status.className}`}>
        <div className="care-summary-head">
          <span className="care-summary-emoji" aria-hidden>
            🧠
          </span>
          <div>
            <h1 className="care-summary-title">Cognitive Check Summary</h1>
            <p className="care-summary-sub">
              <strong>Status:</strong> {status.label}{" "}
              <span className="care-summary-dot" aria-hidden>
                {status.dot}
              </span>
            </p>
            <p className="care-summary-confidence">
              <strong>How sure is this tool?</strong> Confidence: {status.confidenceWord}
            </p>
            <p className="care-summary-result-line">
              <strong>Result:</strong> {status.shortResult}
            </p>
            <p className="care-disclaimer-in-card">
              This result is <strong>not a diagnosis</strong>. It suggests whether talking with a
              healthcare professional may be helpful, based on this session only.
            </p>
          </div>
        </div>
      </div>

      <div className="card care-patient-card">
        <div className="tag">Who this summary is for</div>
        {patient ? (
          <p className="care-patient-line">
            <strong>{patient.fullName || "Participant"}</strong>
            {patient.age != null ? ` · ${patient.age} years` : ""}
            {patient.assessmentDate ? ` · ${patient.assessmentDate}` : ""}
          </p>
        ) : (
          <p className="care-patient-line text-muted">No patient details were saved for this run.</p>
        )}
      </div>

      <div className="card">
        <h2 className="care-section-title">Cognitive overview</h2>
        <p className="care-section-lead">
          Simple snapshot — not separate medical tests. Lower labels mean more support might help in
          that area, not a specific disease label.
        </p>
        <div className="care-pillars">
          {pillars.map((p) => (
            <div key={p.key} className={`care-pillar care-pillar--${p.level.toLowerCase()}`}>
              <div className="care-pillar-head">
                <span className="care-pillar-icon" aria-hidden>
                  {p.icon}
                </span>
                <span className="care-pillar-title">{p.title}</span>
                <span className="care-pillar-level">{p.level}</span>
              </div>
              <p className="care-pillar-hint">{p.hint}</p>
            </div>
          ))}
        </div>
      </div>

      {compare && (
        <div className="card care-soft-card">
          <h2 className="care-section-title">Compared with last time</h2>
          <p className="care-plain">{compare}</p>
        </div>
      )}

      <div className="card care-soft-card">
        <h2 className="care-section-title">What this means</h2>
        <ul className="care-plain-list">
          {findings.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
          <li>
            Mood, tiredness, medications, or a noisy room can all affect short check-ins like this
            one.
          </li>
        </ul>
      </div>

      {insights?.secondary?.length > 0 && (
        <div className="card care-wellbeing-card">
          <h2 className="care-section-title">Well-being</h2>
          {insights.secondary.map((s) => {
            const soft = softenSecondaryBlock(s);
            return (
              <div key={s.key} className="care-secondary-block">
                <h3 className="care-secondary-title">{soft.title}</h3>
                <p className="care-plain">{soft.body}</p>
                {soft.extra && <p className="care-plain">{soft.extra}</p>}
              </div>
            );
          })}
        </div>
      )}

      <div className="card care-rec-card">
        <h2 className="care-section-title">Next steps</h2>
        <ul className="care-plain-list">
          {recommendations.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </div>

      <div className="care-router-links">
        <Link className="btn btn-ghost" to="/">
          ← Home
        </Link>
        <Link className="btn btn-primary" to="/test-advanced">
          Run another check
        </Link>
      </div>
    </>
  );
}
