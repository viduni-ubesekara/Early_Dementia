import { useEffect } from "react";
import { speak, stopSpeaking } from "../../lib/voicePrompt.js";

/**
 * Common chrome around every cognitive task — title, icon, voice
 * prompt button, and a subtle "Cogsy says…" speech-bubble assistant.
 *
 * Every task that lives under /test-advanced wraps its content in
 * <TaskShell> so the visual language is uniform: same head bar, same
 * voice-prompt affordance, same "Good job!" feedback animation.
 */
export default function TaskShell({
  icon,
  title,
  prompt,
  hint,
  voiceLang = "en",
  voiceEnabled = true,
  feedback,
  level,
  children,
}) {
  useEffect(() => {
    if (voiceEnabled && prompt) {
      const t = setTimeout(() => speak(prompt, { lang: voiceLang }), 300);
      return () => {
        clearTimeout(t);
        stopSpeaking();
      };
    }
    return () => {};
  }, [prompt, voiceLang, voiceEnabled]);

  const replay = () => speak(prompt, { lang: voiceLang });

  return (
    <div className="card adv-task adv-task-shell">
      <div className="adv-task-head">
        <div className="adv-icon">{icon}</div>
        <h2>{title}</h2>
        {level != null && <span className="pill adv-level">level {level + 1}</span>}
        {voiceEnabled && (
          <button
            type="button"
            className="btn btn-ghost adv-voice-btn"
            onClick={replay}
            title="Read prompt aloud"
          >
            🔊 Replay
          </button>
        )}
      </div>
      <p className="adv-prompt-text">{prompt}</p>
      {hint && <p className="adv-hint">💡 {hint}</p>}
      {children}
      {feedback && (
        <div
          className={`adv-feedback ${
            feedback.kind === "good"
              ? "adv-feedback-good"
              : feedback.kind === "ok"
              ? "adv-feedback-ok"
              : "adv-feedback-bad"
          }`}
        >
          {feedback.message}
        </div>
      )}
    </div>
  );
}
