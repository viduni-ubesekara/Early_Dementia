import { useEffect, useRef, useState } from "react";
import TaskShell from "./TaskShell.jsx";
import { ATTENTION_GAME_ITEMS } from "../../lib/srilanka.js";

/**
 * Attention game — gamified replacement for serial-7s.
 *
 * "Tap every fruit. Avoid the others." 25-second time limit. Tests
 * sustained, selective attention (Posner & Petersen 1990).
 */
export default function AttentionGameTask({ onComplete, voiceEnabled = true }) {
  const TOTAL_MS = 25000;
  const [picks, setPicks] = useState({});
  const [secondsLeft, setSecondsLeft] = useState(TOTAL_MS / 1000);
  const startRef = useRef(0);
  const [feedback, setFeedback] = useState(null);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    startRef.current = performance.now();
    const id = setInterval(() => {
      const elapsed = performance.now() - startRef.current;
      const left = Math.max(0, TOTAL_MS - elapsed);
      setSecondsLeft(left / 1000);
      if (left <= 0) {
        clearInterval(id);
        finish();
      }
    }, 200);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = () => {
    if (finished) return;
    setFinished(true);
    const correct = ATTENTION_GAME_ITEMS.filter(
      (it) => it.isFruit && picks[it.id]
    ).length;
    const wrong = ATTENTION_GAME_ITEMS.filter(
      (it) => !it.isFruit && picks[it.id]
    ).length;
    const totalFruits = ATTENTION_GAME_ITEMS.filter((it) => it.isFruit).length;
    const adjusted = Math.max(0, correct - wrong);
    const points = Math.round((adjusted / totalFruits) * 10);
    const allRight = correct === totalFruits && wrong === 0;
    setFeedback(
      allRight
        ? { kind: "good", message: `${correct}/${totalFruits} fruits caught — sharp eye!` }
        : { kind: "ok", message: `${correct}/${totalFruits} fruits, ${wrong} extras.` }
    );
    setTimeout(
      () =>
        onComplete({
          domain: "attention",
          points,
          max_points: 10,
          correct: allRight,
          meta: { correct, wrong, total_fruits: totalFruits },
        }),
      1200
    );
  };

  return (
    <TaskShell
      icon="🎯"
      title="Attention — Pick the Fruits"
      voiceEnabled={voiceEnabled}
      prompt="Quickly tap every fruit you can see in the grid below. Avoid anything that is not a fruit."
      hint={`${Math.ceil(secondsLeft)}s remaining`}
      feedback={feedback}
    >
      <div className="adv-attn-grid">
        {ATTENTION_GAME_ITEMS.map((it) => {
          const on = !!picks[it.id];
          return (
            <button
              key={it.id}
              type="button"
              className={`adv-attn-tile ${on ? "on" : ""}`}
              onClick={() => {
                if (finished) return;
                setPicks((p) => ({ ...p, [it.id]: !p[it.id] }));
              }}
              disabled={finished}
            >
              <span className="adv-attn-emoji">{it.emoji}</span>
              <span className="adv-attn-label">{it.label}</span>
            </button>
          );
        })}
      </div>
      <div style={{ marginTop: 12 }}>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={finish}
          disabled={finished}
        >
          I'm done →
        </button>
      </div>
    </TaskShell>
  );
}
