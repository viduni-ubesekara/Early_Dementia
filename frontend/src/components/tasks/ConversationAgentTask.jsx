import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { recordBehavior } from "../../api.js";
import {
  useSpeechCapture,
  analyzeTranscript,
} from "../../hooks/useSpeechCapture.js";
import { speakAsync, stopSpeaking } from "../../lib/voicePrompt.js";
import {
  buildAssistantSteps,
  pickConversationVariant,
} from "../../lib/conversationFlow.js";

function buildSpeechAnalysisPayload(sample) {
  if (!sample) return undefined;
  const o = {
    words_per_minute: sample.words_per_minute ?? undefined,
    duration_sec: sample.duration_sec ?? undefined,
    pause_total_ms: sample.pause_total_ms ?? undefined,
    long_pause_count: sample.long_pause_count ?? undefined,
    hesitation_count: sample.hesitation_count ?? undefined,
    repetition_rate: sample.repetition_rate ?? undefined,
    clarity_score: sample.clarity_score ?? undefined,
    sentence_complexity: sample.sentence_complexity ?? undefined,
    cognitive_slowdown_flag: sample.cognitive_slowdown_flag ?? undefined,
    excessive_repetition_flag: sample.excessive_repetition_flag ?? undefined,
    excessive_hesitation_flag: sample.excessive_hesitation_flag ?? undefined,
  };
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined && v !== null)
  );
}

/**
 * Conversational Cognitive Assessment Agent — microphone-only user input.
 *
 * After each assistant prompt (spoken aloud), the mic opens automatically.
 * Each answer is committed with full Web Speech analysis (WPM, pauses,
 * hesitation, repetition, flags) attached as `speech_analysis` on the turn
 * for backend scoring (confusion proxy, attention latency, fluency).
 */
export default function ConversationAgentTask({
  sessionId,
  voiceEnabled = true,
  speechQuestionId = 4,
  onDone,
  onError,
}) {
  const variant = useMemo(() => pickConversationVariant(), []);
  const steps = useMemo(() => buildAssistantSteps(variant), [variant]);
  const [turns, setTurns] = useState([]);
  const [pendingStepId, setPendingStepId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [micError, setMicError] = useState("");
  const turnStartRef = useRef(0);
  const sessionStartRef = useRef(0);
  /** Always latest hook API — avoids effect re-running every render when `speech` object identity changes. */
  const speechRef = useRef(null);

  const speech = useSpeechCapture();
  speechRef.current = speech;

  const submitPayload = useCallback(
    async (finalTurns) => {
      if (!sessionId || done) return;
      setDone(true);
      setBusy(true);
      stopSpeaking();
      try {
        if (speech.listening) speech.stop();
        const endedAt = new Date().toISOString();
        const payload = {
          turns: finalTurns,
          locale: "en",
          variant,
          input_mode: "microphone_only",
          startedAt: sessionStartRef.current
            ? new Date(sessionStartRef.current).toISOString()
            : endedAt,
          endedAt,
        };
        const userTexts = finalTurns
          .filter((t) => t.role === "user")
          .map((t) => t.text)
          .join(" ");
        const dur =
          sessionStartRef.current > 0
            ? (performance.now() - sessionStartRef.current) / 1000
            : 0;
        const sample = analyzeTranscript(userTexts, {
          durationSec: dur,
        });
        sample.questionId = speechQuestionId;
        await recordBehavior({
          sessionId,
          conversation_agent: payload,
          speech_sample: sample,
        });
        onDone?.();
      } catch (e) {
        onError?.(e?.message || String(e));
        setDone(false);
      } finally {
        setBusy(false);
      }
    },
    [sessionId, variant, speechQuestionId, onDone, onError, done, speech]
  );

  const startListeningForStep = useCallback((stepId) => {
    if (!stepId) return;
    const cap = speechRef.current;
    if (!cap?.supported) return;
    setMicError("");
    turnStartRef.current = performance.now();
    cap.start(`chat_${stepId}`);
  }, []);

  // First assistant line + optional TTS, then open mic.
  // Deps must NOT include callbacks tied to changing `speech` object identity, or the effect
  // re-runs after setTurns, cleanup cancels the async chain, and the mic never starts.
  useEffect(() => {
    if (!steps.length) return;
    sessionStartRef.current = performance.now();
    const first = steps[0];
    setTurns([{ role: "assistant", text: first.text, stepId: first.id }]);
    setPendingStepId(first.id);
    let cancelled = false;
    (async () => {
      if (voiceEnabled) await speakAsync(first.text);
      await new Promise((r) => setTimeout(r, 400));
      if (cancelled) return;
      const cap = speechRef.current;
      if (!cap?.supported) {
        setMicError(
          "Speech recognition is not available in this browser. Use Google Chrome or Microsoft Edge for microphone-only chat."
        );
        return;
      }
      setMicError("");
      turnStartRef.current = performance.now();
      cap.start(`chat_${first.id}`);
    })();
    return () => {
      cancelled = true;
    };
  }, [steps, voiceEnabled]);

  const advanceAfterUser = async (userTurn, baseTurns) => {
    const answeredId = userTurn.stepId;
    const idx = steps.findIndex((s) => s.id === answeredId);
    const nextTurns = [...baseTurns, userTurn];
    if (idx < 0) {
      setBusy(false);
      return;
    }
    if (idx < 6) {
      const next = steps[idx + 1];
      nextTurns.push({
        role: "assistant",
        text: next.text,
        stepId: next.id,
      });
      setTurns(nextTurns);
      setPendingStepId(next.id);
      if (voiceEnabled) await speakAsync(next.text);
      await new Promise((r) => setTimeout(r, 400));
      startListeningForStep(next.id);
      setBusy(false);
    } else {
      const close = steps[7];
      nextTurns.push({
        role: "assistant",
        text: close.text,
        stepId: close.id,
      });
      setTurns(nextTurns);
      setPendingStepId(null);
      if (speech.listening) speech.stop();
      if (voiceEnabled) await speakAsync(close.text);
      setBusy(false);
      await submitPayload(nextTurns);
    }
  };

  const onDoneSpeaking = async () => {
    if (!pendingStepId || busy || !speech.supported) return;
    if (!speech.listening) {
      startListeningForStep(pendingStepId);
      setMicError(
        "Microphone was not on. It should turn on now — wait for “Mic on”, speak your answer, then tap Done again."
      );
      return;
    }
    setBusy(true);
    setMicError("");
    const sample = speech.stop();
    const text = (sample?.transcript || "").trim();
    if (!text) {
      setMicError(
        "No speech detected. Please speak your answer, then tap “Done speaking”."
      );
      startListeningForStep(pendingStepId);
      setBusy(false);
      return;
    }
    const wallDur = (performance.now() - turnStartRef.current) / 1000;
    const sa = buildSpeechAnalysisPayload(sample);
    const userTurn = {
      role: "user",
      text,
      stepId: pendingStepId,
      durationSec: Math.round(wallDur * 10) / 10,
      speech_analysis: Object.keys(sa).length ? sa : undefined,
    };
    await advanceAfterUser(userTurn, turns);
  };

  if (!speech.supported) {
    return (
      <div className="card adv-task adv-chat-agent">
        <div className="adv-task-head">
          <div className="adv-icon">💬</div>
          <h2>Friendly chat</h2>
        </div>
        <p className="err">
          This step needs the <strong>Web Speech API</strong> (microphone +
          live transcription). Please open the assessment in{" "}
          <strong>Google Chrome</strong> or <strong>Microsoft Edge</strong>,
          allow the microphone, and try again.
        </p>
        <button type="button" className="btn btn-ghost" onClick={() => onDone?.()}>
          Skip chat segment →
        </button>
      </div>
    );
  }

  return (
    <div className="card adv-task adv-chat-agent">
      <div className="adv-task-head">
        <div className="adv-icon">🎙️</div>
        <h2>Friendly chat</h2>
        <span className="pill">Microphone only · speech analysis</span>
      </div>
      <p className="adv-chat-intro">
        The assistant will read each question aloud. Your answers are captured
        <strong> only from the microphone</strong> so we can measure pace,
        pauses, hesitation, and repetition — signals that often track attention,
        memory retrieval, and clarity of thought in natural speech.
      </p>
      <p className="disclaimer" style={{ fontSize: "0.88rem", marginTop: 8 }}>
        These measures are <strong>research-style proxies</strong> from connected speech.
        They support the overall session picture but are{" "}
        <strong>not a substitute</strong> for formal neuropsychological testing or
        clinical diagnosis.
      </p>

      <div className="adv-chat-thread">
        {turns.map((t, i) => (
          <div
            key={i}
            className={`adv-chat-bubble adv-chat-${t.role}`}
          >
            <span className="adv-chat-role">
              {t.role === "assistant" ? "Assistant" : "You (live transcript)"}
            </span>
            <p>{t.text}</p>
            {t.role === "user" && t.speech_analysis?.words_per_minute != null && (
              <p className="adv-chat-mini">
                ~{t.speech_analysis.words_per_minute} wpm
                {t.speech_analysis.long_pause_count != null
                  ? ` · ${t.speech_analysis.long_pause_count} long pauses`
                  : ""}
              </p>
            )}
          </div>
        ))}
      </div>

      {pendingStepId && (
        <div className="adv-chat-compose">
          <label>What we hear (speak clearly — you cannot type here)</label>
          <div className="adv-chat-live" aria-live="polite">
            {speech.listening
              ? speech.interim || "Listening… speak now."
              : "Waiting for microphone…"}
          </div>
          <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <span
              className={
                speech.listening ? "adv-mic adv-mic-on" : "adv-mic"
              }
            >
              {speech.listening ? "● Mic on — speak your answer" : "Mic off"}
            </span>
            <button
              type="button"
              className="btn btn-primary"
              onClick={onDoneSpeaking}
              disabled={busy}
            >
              Done speaking — next →
            </button>
          </div>
          {micError && <p className="err" style={{ marginTop: 8 }}>{micError}</p>}
          {speech.error && (
            <p className="err" style={{ marginTop: 8 }}>
              Mic: {speech.error}
            </p>
          )}
        </div>
      )}

      {busy && pendingStepId && (
        <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>One moment…</p>
      )}
    </div>
  );
}
