import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchMetrics } from "../api.js";
import { downloadAssessmentPdf } from "../utils/assessmentPdf.js";
import CaregiverResultsView from "../components/CaregiverResultsView.jsx";
import ClinicianResultsPanel from "../components/ClinicianResultsPanel.jsx";

export default function Dashboard() {
  const [res, setRes] = useState(null);
  const [prev, setPrev] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [mErr, setMErr] = useState(null);
  const [patient, setPatient] = useState(null);
  const [clinicianMode, setClinicianMode] = useState(() => {
    try {
      return sessionStorage.getItem("resultsViewMode") === "clinician";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      sessionStorage.setItem("resultsViewMode", clinicianMode ? "clinician" : "caregiver");
    } catch {
      /* ignore */
    }
  }, [clinicianMode]);

  useEffect(() => {
    const j = sessionStorage.getItem("lastResult");
    if (j) setRes(JSON.parse(j));
    const p = sessionStorage.getItem("previousResult");
    if (p) {
      try {
        setPrev(JSON.parse(p));
      } catch {
        /* ignore */
      }
    }
    try {
      const p2 = sessionStorage.getItem("patientInfo");
      if (p2) setPatient(JSON.parse(p2));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!clinicianMode) return;
    fetchMetrics()
      .then(setMetrics)
      .catch(() => setMErr("Metrics unavailable. Train models or start API."));
  }, [clinicianMode]);

  if (!res) {
    return (
      <div className="app-shell">
        <p className="lead">No result yet. Run a session from the test page.</p>
        <Link className="btn btn-primary" to="/test">
          Go to MMSE screen
        </Link>
      </div>
    );
  }

  const scores = res.scores || {
    C: res.score_components?.C_cognitive,
    B: res.score_components?.B_behavioral,
    P: res.score_components?.P_performance,
    M: res.score_components?.M_medical_ML,
  };
  const beh = res.behavioral_breakdown;
  const perf = res.performance_breakdown;
  const insights = res.insights;

  return (
    <div className="app-shell dashboard-shell">
      <div
        className="row dashboard-top-bar"
        style={{ justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.25rem" }}
      >
        <div>
          <Link to="/">← Home</Link>
          <p className="dashboard-view-label" style={{ margin: "0.5rem 0 0", color: "var(--muted)" }}>
            {clinicianMode ? "Clinician / advanced view" : "Caregiver view"}
          </p>
        </div>
        <div className="dashboard-mode-toggle" role="group" aria-label="Results view mode">
          <button
            type="button"
            className={`btn ${!clinicianMode ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setClinicianMode(false)}
          >
            Caregiver
          </button>
          <button
            type="button"
            className={`btn ${clinicianMode ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setClinicianMode(true)}
          >
            Clinician (advanced)
          </button>
        </div>
      </div>

      {clinicianMode ? (
        <>
          <h1 style={{ marginTop: 0 }}>Assessment dashboard</h1>
          <ClinicianResultsPanel res={res} patient={patient} prev={prev} metrics={metrics} mErr={mErr} />
        </>
      ) : (
        <>
          <CaregiverResultsView
            res={res}
            patient={patient}
            prev={prev}
            scores={scores}
            beh={beh}
            perf={perf}
            insights={insights}
          />
          <div className="card" style={{ marginTop: "1rem" }}>
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
                <div className="tag">Share with family</div>
                <p style={{ margin: "0.35rem 0 0", color: "var(--muted)", fontSize: "0.95rem" }}>
                  Download a short, plain-language summary (no model jargon).
                </p>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => downloadAssessmentPdf({ res, patient, prev, caregiver: true })}
              >
                Download summary PDF
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
