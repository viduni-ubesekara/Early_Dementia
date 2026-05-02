import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  completeAssessment,
  defaultMedical,
  recordBehavior,
  startSession,
} from "../api.js";
import { useFacialEmotion } from "../hooks/useFacialEmotion.js";
import {
  useSpeechCapture,
  countAnimalsInTranscript,
} from "../hooks/useSpeechCapture.js";
import { createYoloConfusionAnalyzer } from "../lib/confusionFrameAnalyzer.js";
import MedicalForm from "../components/MedicalForm.jsx";
import {
  createAdaptiveTracker,
  MEMORY_LADDER,
} from "../lib/adaptiveDifficulty.js";
import { LIFE_STORY_PROMPTS } from "../lib/srilanka.js";
import {
  speak,
  speakAsync,
  stopSpeaking,
  isSpeechSynthesisSupported,
} from "../lib/voicePrompt.js";

import AdaptiveMemoryTask from "../components/tasks/AdaptiveMemoryTask.jsx";
import MarketMemoryTask from "../components/tasks/MarketMemoryTask.jsx";
import BusRouteTask from "../components/tasks/BusRouteTask.jsx";
import FestivalMatchTask from "../components/tasks/FestivalMatchTask.jsx";
import AttentionGameTask from "../components/tasks/AttentionGameTask.jsx";
import ContextOrientationTask from "../components/tasks/ContextOrientationTask.jsx";
import ConversationAgentTask from "../components/tasks/ConversationAgentTask.jsx";

/**
 * Advanced cognitive screening flow — Sri-Lankan-context Adaptive
 * Cognitive Testing (ACT).
 *
 * Tasks:
 *   1. Context-aware orientation (festival, lunch time, monsoon)
 *   2. Adaptive memory recall (3 → 5 → 7 words, Sri Lankan lexicon)
 *   3. Attention — pick the fruits (gamified, 25 s)
 *   4. Verbal fluency (animals, 60 s)
 *   5. Market Memory ("pola simulation")
 *   6. Bus Route Logic (sequence completion)
 *   7. Trail-making 1-12
 *   8. Picture description (60 s connected speech)
 *   9. Festival ↔ symbol matching
 *  10. Life Story Conversation (90 s connected speech)
 *  11. Self-rated cognition
 *
 * The fusion model, weighting, and risk classification are NOT touched
 * — see CLINICAL_VALIDATION.md. We only upgrade the C, B, and UX
 * layers per the user's brief.
 */

const TASK_LIST = [
  { id: "intro", label: "Welcome" },
  { id: "ctx_orient", label: "Orientation" },
  { id: "memory", label: "Memory (adaptive)" },
  { id: "attention", label: "Attention game" },
  { id: "chat_agent", label: "Friendly chat" },
  { id: "fluency", label: "Verbal fluency" },
  { id: "market", label: "Pola memory" },
  { id: "bus", label: "Bus route logic" },
  { id: "trail", label: "Trail-making" },
  { id: "picture", label: "Picture description" },
  { id: "festival", label: "Festival match" },
  { id: "conversation", label: "Life story" },
  { id: "self", label: "Self-rated" },
  { id: "review", label: "Review" },
];

function taskIdToNumber(id) {
  const idx = TASK_LIST.findIndex((t) => t.id === id);
  return idx >= 0 ? idx + 1 : 0;
}

// Helpers retained from previous implementation (used by surviving tasks).
function fluencyToPoints(uniqueCount) {
  if (uniqueCount >= 18) return 10;
  if (uniqueCount >= 14) return 8;
  if (uniqueCount >= 10) return 6;
  if (uniqueCount >= 6) return 3;
  return 0;
}
function trailToPoints(seconds, errors) {
  let pts = 10;
  if (seconds > 30) pts -= Math.min(6, Math.floor((seconds - 30) / 5));
  pts -= errors * 2;
  return Math.max(0, pts);
}
function pictureToPoints(wordCount, hesRatio) {
  let pts = 0;
  if (wordCount >= 60) pts += 6;
  else if (wordCount >= 40) pts += 4;
  else if (wordCount >= 20) pts += 2;
  if (hesRatio < 0.05) pts += 4;
  else if (hesRatio < 0.12) pts += 2;
  return Math.max(0, Math.min(10, pts));
}

// =====================================================================
// Sub-components (UI chrome)
// =====================================================================

function ProgressDots({ taskId }) {
  const idx = TASK_LIST.findIndex((t) => t.id === taskId);
  return (
    <div className="adv-dots">
      {TASK_LIST.map((t, i) => {
        const state = i < idx ? "done" : i === idx ? "now" : "pending";
        return (
          <div key={t.id} className={`adv-dot adv-dot-${state}`} title={t.label}>
            <span>{i + 1}</span>
          </div>
        );
      })}
    </div>
  );
}

function CountdownRing({ remainingMs, totalMs, label }) {
  const pct = Math.max(0, Math.min(1, remainingMs / totalMs));
  const angle = pct * 360;
  return (
    <div className="adv-ring" style={{ "--angle": `${angle}deg` }}>
      <div className="adv-ring-inner">
        <div className="adv-ring-num">{Math.ceil(remainingMs / 1000)}s</div>
        {label && <div className="adv-ring-label">{label}</div>}
      </div>
    </div>
  );
}

function MicStatus({ speech, label }) {
  const cls = speech.error
    ? "adv-mic adv-mic-err"
    : speech.listening
    ? "adv-mic adv-mic-on"
    : "adv-mic";
  const text = speech.error
    ? `mic error: ${speech.error}`
    : speech.listening
    ? `${label || "listening"}…`
    : "mic idle";
  return <span className={cls}>{text}</span>;
}

// =====================================================================
// Main component
// =====================================================================

export default function AdvancedTest() {
  const nav = useNavigate();

  const [sessionId, setSessionId] = useState(null);
  const [taskId, setTaskId] = useState("intro");
  const [model, setModel] = useState("random_forest");

  const [enableCam, setEnableCam] = useState(true);
  const [enableSpeech, setEnableSpeech] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(
    isSpeechSynthesisSupported()
  );

  const [medical, setMedical] = useState(() => defaultMedical());

  const [patient, setPatient] = useState(() => {
    try {
      const raw = sessionStorage.getItem("patientInfo");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (!patient || !patient.fullName) {
      nav("/patient", { replace: true });
    }
  }, [patient, nav]);

  const [err, setErr] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [logsCount, setLogsCount] = useState({
    answers: 0, behavior: 0, frames: 0, speech: 0,
  });

  // Adaptive difficulty tracker — fed by every task that returns a
  // correct/incorrect answer. The memory task uses the level
  // suggested here; other tasks just record into it for future
  // adaptation.
  const tracker = useMemo(
    () => createAdaptiveTracker({ initialLevel: 0, maxLevel: 2 }),
    []
  );
  const [memoryLevel, setMemoryLevel] = useState(0);

  // Per-task transient state (for tasks not yet componentized)
  const [fluencyTimerMs, setFluencyTimerMs] = useState(60000);
  const fluencyStartRef = useRef(0);
  const fluencyTickRef = useRef(null);
  const [fluencyLiveText, setFluencyLiveText] = useState("");
  const [fluencyAnimals, setFluencyAnimals] = useState(0);

  const [trailIdx, setTrailIdx] = useState(0);
  const [trailErrors, setTrailErrors] = useState(0);
  const trailStartRef = useRef(0);
  const [trailDone, setTrailDone] = useState(false);
  const [trailSeconds, setTrailSeconds] = useState(0);

  const [pictureTimerMs, setPictureTimerMs] = useState(60000);
  const pictureStartRef = useRef(0);
  const pictureTickRef = useRef(null);

  const [convTimerMs, setConvTimerMs] = useState(90000);
  const convStartRef = useRef(0);
  const convTickRef = useRef(null);
  const [convPrompt] = useState(
    LIFE_STORY_PROMPTS[Math.floor(Math.random() * LIFE_STORY_PROMPTS.length)]
  );

  const [self, setSelf] = useState({ memory: 3, focus: 3, naming: 3, mood: 3 });

  const questionStartRef = useRef(0);
  const sessionStartRef = useRef(0);

  useEffect(() => {
    if (taskId === "intro" || taskId === "review") return;
    questionStartRef.current = performance.now();
  }, [taskId]);

  // Voice prompt: announce task transitions
  useEffect(() => {
    if (!voiceEnabled) return;
    const idx = TASK_LIST.findIndex((t) => t.id === taskId);
    if (idx < 1 || idx >= TASK_LIST.length - 1) return;
    // Each task component reads its own prompt — we do nothing here
    // beyond ensuring the synth queue is reset for the new task.
    stopSpeaking();
  }, [taskId, voiceEnabled]);

  // Facial sampling — keep stream alive for the whole session.
  // sessionId & taskId are read via refs inside onFrame so the
  // callback identity stays stable across task transitions and the
  // webcam doesn't get torn down on every advance.
  const sessionIdRef = useRef(sessionId);
  const taskIdRef = useRef(taskId);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);
  useEffect(() => {
    taskIdRef.current = taskId;
  }, [taskId]);

  const confusionAnalyzeFrame = useMemo(() => createYoloConfusionAnalyzer(), []);

  const facial = useFacialEmotion({
    enable: enableCam && sessionId != null,
    intervalMs: 1500,
    analyzeFrame: confusionAnalyzeFrame,
    onFrame: useCallback(async (frame) => {
      const sid = sessionIdRef.current;
      const tid = taskIdRef.current;
      if (!sid) return;
      try {
        await recordBehavior({
          sessionId: sid,
          facial_frame: { ...frame, questionId: taskIdToNumber(tid) },
        });
        setLogsCount((c) => ({ ...c, frames: c.frames + 1 }));
      } catch (e) {
        // Surface the failure so we don't silently zero-out frames.
        // eslint-disable-next-line no-console
        console.warn("[facial_frame] post failed:", e?.message || e);
      }
    }, []),
  });

  const speech = useSpeechCapture();

  // pre-flight permissions
  const [permState, setPermState] = useState({ cam: "unknown", mic: "unknown", detail: "" });
  const requestMediaAccess = useCallback(async () => {
    setPermState((p) => ({ ...p, detail: "Requesting permission…" }));
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: enableCam ? { width: 240, height: 180, facingMode: "user" } : false,
        audio: enableSpeech,
      });
      stream.getTracks().forEach((t) => t.stop());
      setPermState({
        cam: enableCam ? "ok" : "n/a",
        mic: enableSpeech ? "ok" : "n/a",
        detail: "Permissions granted. You can start when ready.",
      });
    } catch (e) {
      setPermState({
        cam: enableCam ? "denied" : "n/a",
        mic: enableSpeech ? "denied" : "n/a",
        detail:
          e?.name === "NotAllowedError"
            ? "Browser blocked access. Click the camera icon in the address bar → Allow → reload."
            : e?.name === "NotFoundError"
            ? "No camera or microphone detected."
            : `Error: ${e?.message || e}`,
      });
    }
  }, [enableCam, enableSpeech]);

  const startAssessment = async () => {
    setErr(null);
    try {
      const s = await startSession(patient?.fullName || null);
      setSessionId(s.sessionId);
      sessionStartRef.current = performance.now();
      setLogsCount({ answers: 0, behavior: 0, frames: 0, speech: 0 });
      setTaskId("ctx_orient");
      if (voiceEnabled) speak("Welcome! Let's begin with a few quick questions.");
    } catch (e) {
      setErr(`Could not start session: ${e.message}. Is the API running on :8000?`);
    }
  };

  // Generic sender used by component tasks via onComplete callback.
  const sendCognitiveAnswer = useCallback(
    async ({ id, domain, points, max_points = 10, correct, meta }) => {
      if (!sessionId) return;
      const reaction_time_ms = Math.max(
        0,
        performance.now() - questionStartRef.current
      );
      try {
        await recordBehavior({
          sessionId,
          cognitive_answer: {
            questionId: TASK_LIST.findIndex((t) => t.id === id) + 1,
            domain,
            points,
            max_points,
            correct,
            ...(meta ? { meta } : {}),
          },
          behavioral_log: {
            questionId: TASK_LIST.findIndex((t) => t.id === id) + 1,
            reaction_time_ms,
            attempts: 1,
            delay_ms: Math.min(reaction_time_ms, 800),
            hesitation_ms: Math.max(0, reaction_time_ms - 800),
            correct,
          },
        });
        setLogsCount((c) => ({
          ...c,
          answers: c.answers + 1,
          behavior: c.behavior + 1,
        }));
        // feed the adaptive tracker
        const newLevel = tracker.record(correct);
        if (id === "memory") setMemoryLevel(newLevel);
      } catch (e) {
        setErr(`Could not record answer: ${e.message}`);
      }
    },
    [sessionId, tracker]
  );

  const sendSpeechSample = useCallback(
    async (sample) => {
      if (!sessionId || !sample) return;
      // Backend wants questionId: int. The capture hook gives us a
      // string task ID like "fluency"; map it to the numeric index.
      const speech_sample = {
        ...sample,
        questionId:
          typeof sample.questionId === "string"
            ? taskIdToNumber(sample.questionId)
            : sample.questionId ?? null,
      };
      try {
        await recordBehavior({ sessionId, speech_sample });
        setLogsCount((c) => ({ ...c, speech: c.speech + 1 }));
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[speech_sample] post failed:", e?.message || e);
      }
    },
    [sessionId]
  );

  // --- adapter for component tasks: they call onComplete -> we record + advance
  const onTaskComplete = useCallback(
    (nextTaskId) =>
      async (result) => {
        await sendCognitiveAnswer({ id: taskId, ...result });
        if (voiceEnabled && result.correct) {
          speak("Good job!");
        }
        setTaskId(nextTaskId);
      },
    [sendCognitiveAnswer, taskId, voiceEnabled]
  );

  // ---- verbal fluency: 60s speech, count animals
  useEffect(() => {
    if (taskId !== "fluency") return;
    if (!enableSpeech || !speech.supported) {
      (async () => {
        await sendCognitiveAnswer({
          id: "fluency", domain: "language", points: 5, max_points: 10, correct: false,
        });
        setTaskId("market");
      })();
      return;
    }
    let cancelled = false;
    (async () => {
      setFluencyTimerMs(60000);
      setFluencyLiveText("");
      setFluencyAnimals(0);
      if (voiceEnabled) {
        await speakAsync("Now name as many animals as you can in 60 seconds.");
      }
      if (cancelled) return;
      fluencyStartRef.current = performance.now();
      speech.start("fluency");
    })();
    fluencyTickRef.current = setInterval(() => {
      if (!fluencyStartRef.current) return; // still waiting on TTS
      const elapsed = performance.now() - fluencyStartRef.current;
      const remaining = Math.max(0, 60000 - elapsed);
      setFluencyTimerMs(remaining);
      const live = (speech.interim || "").trim();
      setFluencyLiveText(live);
      const sample = countAnimalsInTranscript(live).unique_animals;
      setFluencyAnimals(sample);
      if (remaining <= 0) {
        clearInterval(fluencyTickRef.current);
        finishFluency();
      }
    }, 200);
    return () => {
      cancelled = true;
      clearInterval(fluencyTickRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  const finishFluency = async () => {
    const sample = speech.stop();
    if (sample) {
      const { unique_animals } = countAnimalsInTranscript(sample.transcript || "");
      sample.unique_animals = unique_animals;
      await sendSpeechSample(sample);
      const points = fluencyToPoints(unique_animals);
      await sendCognitiveAnswer({
        id: "fluency", domain: "language", points, max_points: 10, correct: points >= 6,
      });
    }
    setTaskId("market");
  };

  // ---- trail-making: click 1..12 in order
  useEffect(() => {
    if (taskId !== "trail") return;
    setTrailIdx(0);
    setTrailErrors(0);
    setTrailDone(false);
    trailStartRef.current = performance.now();
    if (voiceEnabled) {
      speak("Click the numbers in order, from 1 to 12, as fast as you can.");
    }
  }, [taskId, voiceEnabled]);

  const trailNumbers = useMemo(() => {
    const nodes = [];
    let x = 7;
    for (let i = 1; i <= 12; i++) {
      x = (x * 1103515245 + 12345) % 2147483647;
      const left = 8 + ((x >> 4) % 80);
      const top = 8 + ((x >> 8) % 70);
      nodes.push({ n: i, left, top });
    }
    return nodes;
  }, []);

  const onClickTrail = async (n) => {
    if (trailDone) return;
    if (n === trailIdx + 1) {
      const next = trailIdx + 1;
      setTrailIdx(next);
      if (next >= 12) {
        const seconds = Math.round(
          (performance.now() - trailStartRef.current) / 1000
        );
        setTrailSeconds(seconds);
        setTrailDone(true);
        const points = trailToPoints(seconds, trailErrors);
        await sendCognitiveAnswer({
          id: "trail", domain: "attention", points, max_points: 10,
          correct: points >= 6,
        });
        setTimeout(() => setTaskId("picture"), 800);
      }
    } else {
      setTrailErrors((e) => e + 1);
    }
  };

  // ---- picture description: 60s speech
  useEffect(() => {
    if (taskId !== "picture") return;
    if (!enableSpeech || !speech.supported) {
      (async () => {
        await sendCognitiveAnswer({
          id: "picture", domain: "language", points: 5, max_points: 10, correct: false,
        });
        setTaskId("festival");
      })();
      return;
    }
    let cancelled = false;
    pictureStartRef.current = 0;
    setPictureTimerMs(60000);
    (async () => {
      if (voiceEnabled) {
        await speakAsync(
          "Look at the kitchen scene and describe what you see. Talk for 60 seconds."
        );
      }
      if (cancelled) return;
      pictureStartRef.current = performance.now();
      speech.start("picture");
    })();
    pictureTickRef.current = setInterval(() => {
      if (!pictureStartRef.current) return;
      const remaining = Math.max(
        0,
        60000 - (performance.now() - pictureStartRef.current)
      );
      setPictureTimerMs(remaining);
      if (remaining <= 0) {
        clearInterval(pictureTickRef.current);
        finishPicture();
      }
    }, 200);
    return () => {
      cancelled = true;
      clearInterval(pictureTickRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  const finishPicture = async () => {
    const sample = speech.stop();
    if (sample) {
      await sendSpeechSample(sample);
      const hesRatio = sample.word_count
        ? sample.hesitation_count / sample.word_count
        : 0;
      const points = pictureToPoints(sample.word_count, hesRatio);
      await sendCognitiveAnswer({
        id: "picture", domain: "language", points, max_points: 10,
        correct: points >= 5,
      });
    }
    setTaskId("festival");
  };

  // ---- life conversation: 90s open-ended speech
  useEffect(() => {
    if (taskId !== "conversation") return;
    if (!enableSpeech || !speech.supported) {
      (async () => {
        setTaskId("self");
      })();
      return;
    }
    let cancelled = false;
    convStartRef.current = 0;
    setConvTimerMs(90000);
    (async () => {
      if (voiceEnabled) {
        await speakAsync(
          `Now I'd like to ask you something personal. ${convPrompt} Take your time.`
        );
      }
      if (cancelled) return;
      convStartRef.current = performance.now();
      speech.start("conversation");
    })();
    convTickRef.current = setInterval(() => {
      if (!convStartRef.current) return;
      const remaining = Math.max(
        0,
        90000 - (performance.now() - convStartRef.current)
      );
      setConvTimerMs(remaining);
      if (remaining <= 0) {
        clearInterval(convTickRef.current);
        finishConversation();
      }
    }, 200);
    return () => {
      cancelled = true;
      clearInterval(convTickRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  const finishConversation = async () => {
    const sample = speech.stop();
    if (sample) await sendSpeechSample(sample);
    setTaskId("self");
  };

  const submitSelf = () => setTaskId("review");

  const submit = async () => {
    if (!sessionId) return;
    setSubmitting(true);
    setErr(null);
    const completion_time_s =
      (performance.now() - sessionStartRef.current) / 1000;
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
        total_questions: 12,
        persist: false,
      });
      res.advanced_session = true;
      res.self_rated = self;
      res.adaptive = {
        memory_level: memoryLevel,
        accuracy: tracker.getAccuracy(),
        history: tracker.getHistory(),
      };
      // remember the previous result for next-session comparison
      try {
        const prior = sessionStorage.getItem("lastResult");
        if (prior) {
          sessionStorage.setItem("previousResult", prior);
        }
      } catch {}
      sessionStorage.setItem("lastResult", JSON.stringify(res));
      nav("/results");
    } catch (e) {
      setErr(`Could not finalize: ${e.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  // =====================================================================
  // Render
  // =====================================================================

  return (
    <div className="app-shell adv-shell">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <Link to="/">← Home</Link>
        <span className="tag">Adaptive Sri-Lankan-context screening</span>
      </div>

      <h1 style={{ marginBottom: "0.4rem" }}>Cognitive screening — adaptive session</h1>
      <p className="lead" style={{ marginTop: 0 }}>
        Interactive, culturally-grounded cognitive assessment. Difficulty
        adjusts to your performance. Speech is analysed for clarity, words
        per minute, pauses, repetition, and sentence complexity.
      </p>

      <ProgressDots taskId={taskId} />

      {patient && (
        <div className="card adv-patient">
          <div className="tag">Patient</div>
          <strong>{patient.fullName}</strong>
          <span className="adv-patient-meta">
            {patient.age != null ? `${patient.age} y` : ""}
            {patient.gender ? ` · ${patient.gender}` : ""}
            {patient.educationYears != null && patient.educationYears !== ""
              ? ` · ${patient.educationYears} yr education`
              : ""}
          </span>
          <Link className="btn btn-ghost adv-patient-edit" to="/patient">
            Edit
          </Link>
        </div>
      )}

      {/* INTRO */}
      {taskId === "intro" && (
        <>
          <div className="card">
            <div className="row">
              <div>
                <label>Webcam</label>
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
                <label>Speech</label>
                <div style={{ marginTop: 6 }}>
                  <button
                    className={`btn ${enableSpeech ? "btn-primary" : "btn-ghost"}`}
                    type="button"
                    onClick={() => setEnableSpeech((v) => !v)}
                    disabled={!speech.supported}
                  >
                    {enableSpeech && speech.supported
                      ? "Enabled"
                      : speech.supported
                      ? "Disabled"
                      : "Unsupported"}
                  </button>
                </div>
              </div>
              <div>
                <label>Voice assistant</label>
                <div style={{ marginTop: 6 }}>
                  <button
                    className={`btn ${voiceEnabled ? "btn-primary" : "btn-ghost"}`}
                    type="button"
                    onClick={() => setVoiceEnabled((v) => !v)}
                    disabled={!isSpeechSynthesisSupported()}
                  >
                    {voiceEnabled
                      ? "Speaks prompts"
                      : isSpeechSynthesisSupported()
                      ? "Off"
                      : "Unsupported"}
                  </button>
                </div>
              </div>
              <div>
                <label>Fusion classifier</label>
                <div style={{ marginTop: 6 }}>
                  <select value={model} onChange={(e) => setModel(e.target.value)}>
                    <option value="random_forest">Random Forest</option>
                    <option value="xgboost">XGBoost</option>
                    <option value="logistic_regression">Logistic regression</option>
                  </select>
                </div>
              </div>
            </div>
            {(enableCam || enableSpeech) && (
              <div style={{ marginTop: 12 }}>
                <button className="btn btn-ghost" type="button" onClick={requestMediaAccess}>
                  Test camera &amp; microphone access
                </button>
                <span style={{ marginLeft: 12 }}>
                  {enableCam && (
                    <span className="pill" style={{ marginRight: 6 }}>
                      cam:{" "}
                      {permState.cam === "ok"
                        ? "✓ allowed"
                        : permState.cam === "denied"
                        ? "✗ blocked"
                        : "not yet checked"}
                    </span>
                  )}
                  {enableSpeech && (
                    <span className="pill">
                      mic:{" "}
                      {permState.mic === "ok"
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
              </div>
            )}
          </div>

          <MedicalForm value={medical} onChange={setMedical} />

          {err && <p className="err">{err}</p>}
          <button className="btn btn-primary" type="button" onClick={startAssessment}>
            🎮 Let's play! Begin session →
          </button>
        </>
      )}

      {/* CONTEXT ORIENTATION */}
      {taskId === "ctx_orient" && (
        <ContextOrientationTask
          voiceEnabled={voiceEnabled}
          count={3}
          onComplete={onTaskComplete("memory")}
        />
      )}

      {/* ADAPTIVE MEMORY */}
      {taskId === "memory" && (
        <AdaptiveMemoryTask
          level={memoryLevel}
          voiceEnabled={voiceEnabled}
          onComplete={onTaskComplete("attention")}
        />
      )}

      {/* ATTENTION GAME */}
      {taskId === "attention" && (
        <AttentionGameTask
          voiceEnabled={voiceEnabled}
          onComplete={onTaskComplete("chat_agent")}
        />
      )}

      {taskId === "chat_agent" && sessionId && (
        <ConversationAgentTask
          sessionId={sessionId}
          voiceEnabled={voiceEnabled}
          speechQuestionId={taskIdToNumber("chat_agent")}
          onDone={() => setTaskId("fluency")}
          onError={(msg) => setErr(msg)}
        />
      )}

      {/* VERBAL FLUENCY */}
      {taskId === "fluency" && (
        <div className="card adv-task">
          <div className="adv-task-head">
            <div className="adv-icon">🗣️</div>
            <h2>Verbal fluency — animals</h2>
          </div>
          <p>
            Name as many <strong>animals</strong> as you can in 60 seconds.
            Speak normally; the system will count them.
          </p>
          <div className="adv-flex-row">
            <CountdownRing
              remainingMs={fluencyTimerMs}
              totalMs={60000}
              label="left"
            />
            <div>
              <div className="adv-counter">
                <div className="adv-counter-num">{fluencyAnimals}</div>
                <div className="adv-counter-label">unique animals</div>
              </div>
              <MicStatus speech={speech} label="listening" />
              {fluencyLiveText && (
                <p style={{ color: "var(--muted)", marginTop: 8, maxWidth: 480 }}>
                  "{fluencyLiveText}"
                </p>
              )}
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <button className="btn btn-ghost" type="button" onClick={finishFluency}>
              Stop early
            </button>
          </div>
        </div>
      )}

      {/* MARKET MEMORY (POLA) */}
      {taskId === "market" && (
        <MarketMemoryTask
          voiceEnabled={voiceEnabled}
          onComplete={onTaskComplete("bus")}
        />
      )}

      {/* BUS ROUTE */}
      {taskId === "bus" && (
        <BusRouteTask
          voiceEnabled={voiceEnabled}
          onComplete={onTaskComplete("trail")}
        />
      )}

      {/* TRAIL MAKING */}
      {taskId === "trail" && (
        <div className="card adv-task">
          <div className="adv-task-head">
            <div className="adv-icon">🔢</div>
            <h2>Trail-making</h2>
          </div>
          <p>
            Click the numbers in order — <strong>1, 2, 3 … 12</strong>. Try to
            be quick and accurate.
          </p>
          <div className="adv-trail">
            {trailNumbers.map((node) => {
              const isNext = node.n === trailIdx + 1;
              const isDone = node.n <= trailIdx;
              return (
                <button
                  key={node.n}
                  className={`adv-trail-node ${isNext ? "next" : ""} ${isDone ? "done" : ""}`}
                  style={{ left: `${node.left}%`, top: `${node.top}%` }}
                  onClick={() => onClickTrail(node.n)}
                  disabled={isDone}
                  type="button"
                >
                  {node.n}
                </button>
              );
            })}
          </div>
          <p style={{ color: "var(--muted)" }}>
            current target: <strong>{Math.min(12, trailIdx + 1)}</strong> ·
            errors: {trailErrors}
            {trailDone && (
              <>
                {" "}
                · finished in <strong>{trailSeconds} s</strong>
              </>
            )}
          </p>
        </div>
      )}

      {/* PICTURE DESCRIPTION */}
      {taskId === "picture" && (
        <div className="card adv-task">
          <div className="adv-task-head">
            <div className="adv-icon">🖼️</div>
            <h2>Picture description</h2>
          </div>
          <p>
            Look at the scene below and <strong>describe what you see</strong>.
            Talk continuously for the full 60 seconds — names of objects,
            actions, anything that comes to mind.
          </p>
          <KitchenScene />
          <div className="adv-flex-row" style={{ marginTop: 12 }}>
            <CountdownRing remainingMs={pictureTimerMs} totalMs={60000} label="describing" />
            <div>
              <MicStatus speech={speech} label="listening" />
              {speech.interim && (
                <p style={{ color: "var(--muted)", marginTop: 8, maxWidth: 480 }}>
                  "{speech.interim}"
                </p>
              )}
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <button className="btn btn-ghost" type="button" onClick={finishPicture}>
              Stop early
            </button>
          </div>
        </div>
      )}

      {/* FESTIVAL MATCH */}
      {taskId === "festival" && (
        <FestivalMatchTask
          voiceEnabled={voiceEnabled}
          onComplete={onTaskComplete("conversation")}
        />
      )}

      {/* LIFE STORY CONVERSATION */}
      {taskId === "conversation" && (
        <div className="card adv-task">
          <div className="adv-task-head">
            <div className="adv-icon">💬</div>
            <h2>Life Story Conversation</h2>
          </div>
          <p>
            Please talk for about <strong>90 seconds</strong>. There are no
            right or wrong answers — speak naturally.
          </p>
          <div className="adv-prompt-box">"{convPrompt}"</div>
          <div className="adv-flex-row" style={{ marginTop: 12 }}>
            <CountdownRing remainingMs={convTimerMs} totalMs={90000} label="talking" />
            <div>
              <MicStatus speech={speech} label="listening" />
              {speech.interim && (
                <p style={{ color: "var(--muted)", marginTop: 8, maxWidth: 480 }}>
                  "{speech.interim}"
                </p>
              )}
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <button className="btn btn-ghost" type="button" onClick={finishConversation}>
              I'm done →
            </button>
          </div>
        </div>
      )}

      {/* SELF RATED */}
      {taskId === "self" && (
        <div className="card adv-task">
          <div className="adv-task-head">
            <div className="adv-icon">📋</div>
            <h2>Self rating</h2>
          </div>
          <p>How would you rate yourself this week? (1 = poor, 5 = excellent)</p>
          <div className="adv-likert-grid">
            {[
              ["memory", "Memory"],
              ["focus", "Concentration"],
              ["naming", "Word-finding / naming"],
              ["mood", "Mood / energy"],
            ].map(([k, label]) => (
              <div key={k}>
                <div style={{ marginBottom: 6 }}>{label}</div>
                <div className="adv-likert">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`adv-likert-btn ${self[k] === n ? "on" : ""}`}
                      onClick={() => setSelf((s) => ({ ...s, [k]: n }))}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16 }}>
            <button className="btn btn-primary" type="button" onClick={submitSelf}>
              Continue →
            </button>
          </div>
        </div>
      )}

      {/* REVIEW */}
      {taskId === "review" && (
        <div className="card adv-task">
          <div className="adv-task-head">
            <div className="adv-icon">✓</div>
            <h2>Ready to compute results</h2>
          </div>
          <p>
            Captured: {logsCount.answers} cognitive answers ·{" "}
            {logsCount.frames} facial frames · {logsCount.speech} speech samples.
          </p>
          <p style={{ color: "var(--muted)" }}>
            Adaptive memory finished at <strong>{MEMORY_LADDER[memoryLevel].label}</strong>{" "}
            · running accuracy{" "}
            <strong>{Math.round(tracker.getAccuracy() * 100)}%</strong>
          </p>
          {err && <p className="err">{err}</p>}
          <div style={{ marginTop: 12 }}>
            <button
              className="btn btn-primary"
              type="button"
              onClick={submit}
              disabled={submitting}
            >
              {submitting ? "Computing…" : "Run fusion assessment →"}
            </button>
          </div>
        </div>
      )}

      {/* live media panel */}
      {taskId !== "intro" && taskId !== "review" && (
        <div className="card adv-media">
          <div className="row" style={{ alignItems: "flex-start" }}>
            <div style={{ minWidth: 180 }}>
              <div className="tag">Webcam</div>
              <video
                ref={facial.videoRef}
                muted
                playsInline
                style={{
                  width: 180,
                  height: 135,
                  background: "#ffffff",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                }}
              />
              <canvas ref={facial.canvasRef} style={{ display: "none" }} />
              <p style={{ color: facial.error ? "#f1a36a" : "var(--muted)", fontSize: 12, marginTop: 6 }}>
                {facial.active
                  ? "capturing"
                  : facial.error
                  ? `webcam: ${facial.error}`
                  : enableCam
                  ? "starting (allow the prompt)"
                  : "disabled"}
              </p>
            </div>
            <div style={{ flex: 1 }}>
              <div className="tag">Live capture</div>
              <div className="meter">
                <span className="pill">answers: {logsCount.answers}</span>
                <span className="pill">behavior: {logsCount.behavior}</span>
                <span className="pill">frames: {logsCount.frames}</span>
                <span className="pill">speech: {logsCount.speech}</span>
                <span className="pill">memory level: {memoryLevel + 1}</span>
              </div>
              <div style={{ marginTop: 8 }}>
                <MicStatus speech={speech} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// =====================================================================
// Picture description scene (lightweight inline SVG, retained)
// =====================================================================

function KitchenScene() {
  return (
    <svg viewBox="0 0 480 240" className="adv-picture" role="img" aria-label="Kitchen scene">
      <defs>
        <linearGradient id="floor" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#3b3023" />
          <stop offset="1" stopColor="#251c12" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="480" height="180" fill="#f4ecd8" />
      <rect x="0" y="180" width="480" height="60" fill="url(#floor)" />
      <rect x="40" y="30" width="120" height="80" fill="#a8d8ff" stroke="#5d6b80" strokeWidth="2" />
      <line x1="100" y1="30" x2="100" y2="110" stroke="#5d6b80" strokeWidth="2" />
      <line x1="40" y1="70" x2="160" y2="70" stroke="#5d6b80" strokeWidth="2" />
      <rect x="0" y="150" width="480" height="30" fill="#cfb98a" />
      <rect x="0" y="148" width="480" height="4" fill="#7c6a4b" />
      <rect x="200" y="120" width="80" height="32" fill="#9aa3b1" stroke="#41485a" strokeWidth="2" />
      <rect x="232" y="100" width="6" height="22" fill="#41485a" />
      <line x1="235" y1="122" x2="235" y2="148" stroke="#4cc9a8" strokeWidth="2" />
      <rect x="320" y="120" width="40" height="40" fill="#8a5d3d" />
      <rect x="318" y="158" width="44" height="6" fill="#5b3b25" />
      <circle cx="340" cy="100" r="14" fill="#f3c290" />
      <rect x="334" y="112" width="12" height="20" fill="#5b85ff" />
      <rect x="380" y="60" width="50" height="50" fill="#d97a4d" stroke="#7b3b1c" strokeWidth="2" />
      <rect x="378" y="55" width="54" height="10" fill="#7b3b1c" />
      <text x="390" y="90" fontSize="18" fill="#fff" fontFamily="Arial">JAR</text>
      <circle cx="120" cy="130" r="14" fill="#f3c290" />
      <rect x="114" y="142" width="12" height="22" fill="#e88aa7" />
      <line x1="126" y1="148" x2="160" y2="120" stroke="#41485a" strokeWidth="2" />
      <circle cx="240" cy="110" r="14" fill="#f3c290" />
      <rect x="234" y="122" width="12" height="22" fill="#7eb874" />
      <path
        d="M 200 152 Q 195 175, 180 180 L 100 180 Q 96 175, 96 162"
        fill="none"
        stroke="#4cc9a8"
        strokeWidth="3"
      />
    </svg>
  );
}
