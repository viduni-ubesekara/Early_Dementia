import { useMemo, useState } from "react";
import TaskShell from "./TaskShell.jsx";
import { buildContextOrientationItems } from "../../lib/srilanka.js";

/**
 * Context-aware orientation — Sri Lankan flavoured.
 *
 * Replaces "What is the date?" with naturalistic, culturally
 * grounded items: closest festival, lunch time, monsoon, currency,
 * time-of-day. Removes the cultural-mismatch confound that biases
 * Western-validated MMSE items against South Asian elderly
 * (Iype 2006; Karunaratne 2011).
 */
export default function ContextOrientationTask({
  onComplete,
  voiceEnabled = true,
  count = 3,
}) {
  const items = useMemo(() => {
    const all = buildContextOrientationItems(new Date());
    // pick `count` items at random
    const shuffled = all.slice().sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }, [count]);

  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [score, setScore] = useState(0);

  const item = items[idx];

  const onPick = (i) => {
    if (picked != null) return;
    setPicked(i);
    const correct = i === item.correctIdx;
    setScore((s) => s + (correct ? 1 : 0));
    setFeedback(
      correct
        ? { kind: "good", message: "Correct! 🎉" }
        : { kind: "bad", message: `Closest answer is "${item.options[item.correctIdx]}".` }
    );
    setTimeout(() => {
      setPicked(null);
      setFeedback(null);
      if (idx + 1 >= items.length) {
        const finalScore = score + (correct ? 1 : 0);
        const points = Math.round((finalScore / items.length) * 10);
        onComplete({
          domain: "orientation",
          points,
          max_points: 10,
          correct: finalScore >= Math.ceil(items.length * 0.66),
          meta: { correct: finalScore, total: items.length },
        });
      } else {
        setIdx((j) => j + 1);
      }
    }, 1200);
  };

  return (
    <TaskShell
      icon="🧭"
      title="Orientation — context-aware"
      voiceEnabled={voiceEnabled}
      prompt={item.prompt}
      hint={item.hint || `Question ${idx + 1} of ${items.length}`}
      feedback={feedback}
    >
      <div className="adv-options">
        {item.options.map((opt, i) => (
          <button
            key={i}
            type="button"
            className={`adv-option ${
              picked == null
                ? ""
                : i === item.correctIdx
                ? "ok"
                : picked === i
                ? "bad"
                : ""
            }`}
            disabled={picked != null}
            onClick={() => onPick(i)}
          >
            {opt}
          </button>
        ))}
      </div>
    </TaskShell>
  );
}
