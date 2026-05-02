import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  completeAssessment,
  defaultMedical,
  recordBehavior,
  startSession,
} from "../api.js";
import { useFacialEmotion } from "../hooks/useFacialEmotion.js";
import { useSpeechInput } from "../hooks/useSpeechInput.js";
import { createYoloConfusionAnalyzer } from "../lib/confusionFrameAnalyzer.js";
import MedicalForm from "../components/MedicalForm.jsx";

const QUESTIONS = [
  { id: 1, domain: "orientation", text: "What is today’s year?", options: ["2026", "2015", "1990", "Not sure"], correctIdx: 0 },
  { id: 2, domain: "orientation", text: "What season is it (Northern hemisphere, April)?", options: ["Spring", "Summer", "Winter", "Unknown"], correctIdx: 0 },
  { id: 3, domain: "memory",      text: "Register: rock – child – field. Which set did you hear?", options: ["rock, child, field", "stone, kid, field", "rock, friend, farm", "I don’t know"], correctIdx: 0 },
  { id: 4, domain: "memory",      text: "Recall the three words after delay.", options: ["All three", "Two", "One", "None"], correctIdx: 0 },
  { id: 5, domain: "attention",   text: "Serial 7s from 100: 93 → 90 → 87 → ?", options: ["84", "86", "83", "80"], correctIdx: 0 },
  { id: 6, domain: "attention",   text: "Spell WORLD backwards (closest).", options: ["DLROW", "DROWL", "LDROW", "Cannot"], correctIdx: 0 },
  { id: 7, domain: "language",    text: "Name a pencil and a watch when shown.", options: ["Both", "One", "None", "Refused"], correctIdx: 0 },
  { id: 8, domain: "language",    text: "Repeat: “I know that he is the one to help.”", options: ["Accurate", "Mild error", "Major error", "Cannot"], correctIdx: 0 },
  { id: 9, domain: "visual_spatial", text: "Copy two intersecting pentagons (quality).", options: ["Good", "Mild error", "Poor", "Refused"], correctIdx: 0 },
  { id: 10, domain: "visual_spatial", text: "Clock: numbers and hands at 11:10.", options: ["Good", "Mild error", "Poor", "Refused"], correctIdx: 0 },
];

const MAX_POINTS = 10;
function pointsForOption(correctIdx, oidx) {
  if (oidx === correctIdx) return 10;
  // Other options scale down
  const dist = Math.abs(oidx - correctIdx);
  if (dist === 1) return 5;
  if (dist === 2) return 2;
  return 0;
}

export default function MmseTest() {
  const nav = useNavigate();

  const [sessionId, setSessionId] = useState(null);
  const [phase, setPhase] = useState("idle");
  const [step, setStep] = useState(0);
  const [model, setModel] = useState("random_forest");

  const [enableCam, setEnableCam] = useState(true);
  const [enableSpeech, setEnableSpeech] = useState(true);

  const [medical, setMedical] = useState(() => defaultMedical());

  const [patient, setPatient] = useState(() => {
    try {
      const raw = sessionStorage.getItem("patientInfo");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  // If the user lands here without filling the patient form, send them back.
  useEffect(() => {
    if (!patient || !patient.fullName) {
      nav("/patient", { replace: true });
    }
  }, [patient, nav]);

  const [err, setErr] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Pre-flight media-permission state. Browsers will only show a
  // permission prompt the first time getUserMedia is called per origin.
  // We call it explicitly here (idle phase) so the user can grant
  // access *before* clicking Start session, and so we can show a clear
  // error if the browser blocks us.
  const [permState, setPermState] = useState({
    cam: "unknown", // "unknown" | "ok" | "denied" | "missing"
    mic: "unknown",
    detail: "",
  });

  const requestMediaAccess = useCallback(async () => {
    setPermState((p) => ({ ...p, detail: "Requesting permission..." }));
    let camOk = false;
    let micOk = false;
    let detail = "";
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: enableCam ? { width: 240, height: 180, facingMode: "user" } : false,
        audio: enableSpeech,
      });
      camOk = enableCam ? stream.getVideoTracks().length > 0 : true;
      micOk = enableSpeech ? stream.getAudioTracks().length > 0 : true;
      stream.getTracks().forEach((t) => t.stop());
      detail = "Permissions granted. You can start the session now.";
    } catch (e) {
      detail =
        e?.name === "NotAllowedError"
          ? "Browser blocked access. Click the camera/lock icon in the address bar, allow camera and microphone for this site, then reload."
          : e?.name === "NotFoundError"
          ? "No camera or microphone found on this device."
          : `Error: ${e?.message || e}. Make sure no other tab/app is using the device, then try again.`;
      camOk = false;
      micOk = false;
    }
    setPermState({
      cam: enableCam ? (camOk ? "ok" : "denied") : "missing",
      mic: enableSpeech ? (micOk ? "ok" : "denied") : "missing",
      detail,
    });
  }, [enableCam, enableSpeech]);

  // Per-question timing refs
  const questionStartRef = useRef(0);
  const firstHoverRef = useRef(0);
  const sessionStartRef = useRef(0);

  // Local mirror of phase-1 logs (for live UI; backend has the source of truth)
  const [logsCount, setLogsCount] = useState({ answers: 0, behavior: 0, frames: 0, speech: 0 });

  const confusionAnalyzeFrame = useMemo(() => createYoloConfusionAnalyzer(), []);

  // Facial sampling — only runs while assessment is active and webcam toggle is on
  const facial = useFacialEmotion({
    enable: enableCam && (phase === "assessment"),
    intervalMs: 1500,
    analyzeFrame: confusionAnalyzeFrame,
    onFrame: useCallback(
      async (frame) => {
        if (!sessionId) return;
        try {
          await recordBehavior({
            sessionId,
            facial_frame: { ...frame, questionId: QUESTIONS[Math.min(step, QUESTIONS.length - 1)]?.id ?? null },
          });
          setLogsCount((c) => ({ ...c, frames: c.frames + 1 }));
        } catch {}
      },
      [sessionId, step]
    ),
  });

  const speech = useSpeechInput();
  const speechActive = enableSpeech && speech.supported && phase === "assessment";

  const startAssessment = async () => {
    setErr(null);
    try {
      const s = await startSession(patient?.fullName || null);
      setSessionId(s.sessionId);
      sessionStartRef.current = performance.now();
      questionStartRef.current = performance.now();
      firstHoverRef.current = 0;
      setStep(0);
      setLogsCount({ answers: 0, behavior: 0, frames: 0, speech: 0 });
      setPhase("assessment");
      if (speech.supported && enableSpeech) speech.start();
    } catch (e) {
      setErr(`Could not start session: ${e.message}. Is the API running on :8000?`);
    }
  };

  useEffect(() => {
    if (phase !== "assessment") return;
    questionStartRef.current = performance.now();
    firstHoverRef.current = 0;
  }, [step, phase]);

  const onHoverFirst = useCallback(() => {
    if (firstHoverRef.current === 0) firstHoverRef.current = performance.now();
  }, []);

  const onPick = async (oidx) => {
    if (phase !== "assessment" || !sessionId) return;
    const q = QUESTIONS[step];
    const now = performance.now();
    const reaction_time_ms = Math.max(0, now - questionStartRef.current);
    const delay_ms = firstHoverRef.current
      ? Math.max(0, firstHoverRef.current - questionStartRef.current)
      : Math.min(reaction_time_ms, 800);
    const hesitation_ms = Math.max(0, reaction_time_ms - delay_ms);

    const points = pointsForOption(q.correctIdx, oidx);
    const correct = oidx === q.correctIdx;

    try {
      await recordBehavior({
        sessionId,
        cognitive_answer: {
          questionId: q.id,
          domain: q.domain,
          points,
          max_points: MAX_POINTS,
          correct,
        },
        behavioral_log: {
          questionId: q.id,
          reaction_time_ms,
          attempts: 1,
          delay_ms,
          hesitation_ms,
          correct,
        },
      });
      setLogsCount((c) => ({
        ...c,
        answers: c.answers + 1,
        behavior: c.behavior + 1,
      }));
    } catch (e) {
      setErr(`Could not record answer: ${e.message}`);
      return;
    }

    if (step + 1 < QUESTIONS.length) {
      setStep((s) => s + 1);
    } else {
      await finishPhase1();
    }
  };

  const finishPhase1 = async () => {
    if (speech.supported && speechActive) {
      const sample = speech.stop();
      if (sample && sample.transcript) {
        try {
          await recordBehavior({
            sessionId,
            speech_sample: sample,
          });
          setLogsCount((c) => ({ ...c, speech: c.speech + 1 }));
        } catch {}
      }
    }
    setPhase("review");
  };

  const submit = async () => {
    if (!sessionId) return;
    setSubmitting(true);
    setErr(null);
    const completion_time_s = (performance.now() - sessionStartRef.current) / 1000;
    // Merge patient demographics (age, education) into the medical
    // payload so the backend's Crum-1993 / Salthouse-1996 normative
    // adjustments actually fire. Without these the new clinical-
    // validation logic falls back to age=None defaults.
    const medicalWithDemographics = {
      ...medical,
      ...(patient?.age != null && patient?.age !== ""
        ? { age: Number(patient.age) }
        : {}),
      ...(patient?.educationYears != null && patient?.educationYears !== ""
        ? { education_years: Number(patient.educationYears) }
        : {}),
    };
    try {
      const res = await completeAssessment({
        sessionId,
        medical: medicalWithDemographics,
        model_name: model,
        completion_time_s,
        total_questions: QUESTIONS.length,
        persist: false,
      });
      sessionStorage.setItem("lastResult", JSON.stringify(res));
      nav("/results");
    } catch (e) {
      setErr(`Could not finalize: ${e.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const elapsed = useMemo(() => {
    if (phase === "idle" || sessionStartRef.current === 0) return 0;
    return (performance.now() - sessionStartRef.current) / 1000;
  }, [phase, step]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="app-shell">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <Link to="/">← Home</Link>
        <div className="timer">
          {phase !== "idle" ? `Elapsed: ${elapsed.toFixed(1)}s` : "Timer idle"}
        </div>
      </div>
      <h1>MMSE-style screen — phased capture</h1>
      <p className="lead">
        Phase 1 collects per-question reaction, facial confusion, and (optional) speech in real
        time. Phase 2 computes C, B, P, and the ML medical score M after you finish.
      </p>

      {patient && (
        <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <div>
            <div className="tag" style={{ marginBottom: 4 }}>Patient</div>
            <div style={{ fontWeight: 600, fontSize: "1.05rem" }}>
              {patient.fullName}
              {patient.patientId ? <span style={{ color: "var(--muted)", fontWeight: 400 }}> · ID {patient.patientId}</span> : null}
            </div>
            <div style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: 2 }}>
              {patient.age != null ? `${patient.age} y` : ""}
              {patient.gender ? ` · ${patient.gender}` : ""}
              {patient.educationYears != null && patient.educationYears !== "" ? ` · ${patient.educationYears} yr edu` : ""}
              {patient.handedness ? ` · ${patient.handedness}-handed` : ""}
              {patient.assessmentDate ? ` · ${patient.assessmentDate}` : ""}
              {patient.examinerName ? ` · examiner: ${patient.examinerName}` : ""}
            </div>
          </div>
          <Link className="btn btn-ghost" to="/patient">
            Edit patient info
          </Link>
        </div>
      )}

      {phase === "idle" && (
        <>
          <div className="card">
            <div className="row">
              <div>
                <label>Webcam (facial confusion)</label>
                <div style={{ marginTop: 6 }}>
                  <button
                    className={`btn ${enableCam ? "btn-primary" : "btn-ghost"}`}
                    type="button"
                    onClick={() => setEnableCam((v) => !v)}
                  >
                    {enableCam ? "Enabled" : "Disabled"}
                  </button>
                </div>
              </div>
              <div>
                <label>Speech analysis</label>
                <div style={{ marginTop: 6 }}>
                  <button
                    className={`btn ${enableSpeech ? "btn-primary" : "btn-ghost"}`}
                    type="button"
                    onClick={() => setEnableSpeech((v) => !v)}
                    disabled={!speech.supported}
                    title={speech.supported ? "Web Speech API" : "not supported in this browser"}
                  >
                    {enableSpeech && speech.supported ? "Enabled" : speech.supported ? "Disabled" : "Unsupported"}
                  </button>
                </div>
              </div>
              <div>
                <label>Fusion classifier</label>
                <div style={{ marginTop: 6 }}>
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    style={{ maxWidth: 360 }}
                  >
                    <option value="random_forest">Random Forest (primary)</option>
                    <option value="xgboost">XGBoost</option>
                    <option value="logistic_regression">Logistic regression (baseline)</option>
                  </select>
                </div>
              </div>
            </div>
            {(enableCam || enableSpeech) && (
              <div style={{ marginTop: 12 }}>
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={requestMediaAccess}
                >
                  Test camera &amp; microphone access
                </button>
                <span style={{ marginLeft: 12 }}>
                  {enableCam && (
                    <span className="pill" style={{ marginRight: 6 }}>
                      cam: {permState.cam === "ok"
                        ? "✓ allowed"
                        : permState.cam === "denied"
                        ? "✗ blocked"
                        : "not yet checked"}
                    </span>
                  )}
                  {enableSpeech && (
                    <span className="pill">
                      mic: {permState.mic === "ok"
                        ? "✓ allowed"
                        : permState.mic === "denied"
                        ? "✗ blocked"
                        : "not yet checked"}
                    </span>
                  )}
                </span>
                {permState.detail && (
                  <p
                    style={{
                      marginTop: 8,
                      color:
                        permState.cam === "denied" || permState.mic === "denied"
                          ? "#f1a36a"
                          : "var(--muted)",
                      fontSize: "0.92rem",
                    }}
                  >
                    {permState.detail}
                  </p>
                )}
                <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: 4 }}>
                  Tip: open the site at <code>http://localhost:5173</code> (not a raw IP).
                  If the browser asked once and you clicked Block, click the
                  camera/lock icon in the address bar &rarr; Allow camera and
                  microphone &rarr; reload.
                </p>
              </div>
            )}
          </div>

          <MedicalForm value={medical} onChange={setMedical} />

          {err && <p className="err" style={{ marginTop: 12 }}>{err}</p>}
          <div style={{ marginTop: 8 }}>
            <button className="btn btn-primary" type="button" onClick={startAssessment}>
              Start session
            </button>
            <button
              className="btn btn-ghost"
              type="button"
              style={{ marginLeft: 8 }}
              onClick={() => setMedical(defaultMedical())}
              title="reset medical inputs to neutral defaults"
            >
              Reset medical
            </button>
          </div>
        </>
      )}

      {phase === "assessment" && step < QUESTIONS.length && (
        <>
          <div className="card">
            <div className="tag">Q {step + 1} / {QUESTIONS.length} · {QUESTIONS[step].domain.replace("_", " ")}</div>
            <p style={{ fontSize: "1.05rem" }}>{QUESTIONS[step].text}</p>
            <div onMouseEnter={onHoverFirst}>
              {QUESTIONS[step].options.map((o, i) => (
                <div key={i} style={{ marginBottom: 8 }}>
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onMouseEnter={onHoverFirst}
                    onClick={() => onPick(i)}
                  >
                    {o}
                  </button>
                </div>
              ))}
            </div>
            {err && <p className="err">{err}</p>}
          </div>

          <div className="card">
            <div className="row" style={{ alignItems: "flex-start" }}>
              <div style={{ minWidth: 240 }}>
                <div className="tag">Facial sampler</div>
                <video
                  ref={facial.videoRef}
                  muted
                  playsInline
                  style={{
                    width: 240,
                    height: 180,
                    background: "#ffffff",
                    borderRadius: 10,
                    border: "1px solid var(--border)",
                  }}
                />
                <canvas ref={facial.canvasRef} style={{ display: "none" }} />
                <p
                  style={{
                    color: facial.error ? "#f1a36a" : "var(--muted)",
                    fontSize: 12,
                    marginTop: 6,
                  }}
                >
                  {facial.active
                    ? "capturing"
                    : facial.error
                    ? `webcam blocked: ${facial.error}. Click the camera icon in the address bar and Allow, then reload.`
                    : enableCam
                    ? "starting (allow the browser prompt)"
                    : "disabled"}
                </p>
              </div>
              <div style={{ flex: 1 }}>
                <div className="tag">Phase-1 capture (live)</div>
                <div className="meter">
                  <span className="pill">answers: {logsCount.answers}</span>
                  <span className="pill">behavior: {logsCount.behavior}</span>
                  <span className="pill">frames: {logsCount.frames}</span>
                  <span className="pill">speech: {logsCount.speech}</span>
                </div>
                {speechActive && (
                  <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 8 }}>
                    🎙 listening… {speech.interim ? `“${speech.interim}”` : ""}
                  </p>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {phase === "review" && (
        <>
          <div className="card">
            <div className="tag">Phase-2 ready</div>
            <p>
              Captured {logsCount.answers} answers, {logsCount.behavior} behavioral logs,{" "}
              {logsCount.frames} facial frames, {logsCount.speech} speech samples.
            </p>
            <p className="lead">
              On submit, the backend computes C, P, B (= 0.4·reaction + 0.3·facial + 0.3·speech) and
              calls the medical ML model for M, then fuses S and classifies risk.
            </p>
            {err && <p className="err">{err}</p>}
            <button
              className="btn btn-primary"
              type="button"
              onClick={submit}
              disabled={submitting}
            >
              {submitting ? "Computing…" : "Run fusion assessment"}
            </button>
          </div>

          <details className="card" style={{ paddingBottom: 12 }}>
            <summary style={{ cursor: "pointer" }}>
              Edit medical inputs before submitting
            </summary>
            <div style={{ marginTop: 12 }}>
              <MedicalForm value={medical} onChange={setMedical} />
            </div>
          </details>
        </>
      )}
    </div>
  );
}
