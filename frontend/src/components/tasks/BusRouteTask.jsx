import { useMemo, useState } from "react";
import TaskShell from "./TaskShell.jsx";
import { buildBusRouteItem } from "../../lib/srilanka.js";

/**
 * Bus-route logic puzzle.
 *
 * The patient is shown the start and end of a familiar Sri Lankan
 * route (Colombo → Kandy, etc.) and a partial sequence. They must
 * pick the next stop. Tests:
 *   - logical reasoning (sequence completion)
 *   - cultural orientation (familiarity with main bus routes)
 *   - language (place names)
 */
export default function BusRouteTask({ onComplete, voiceEnabled = true }) {
  const item = useMemo(
    () => buildBusRouteItem(Math.floor(Math.random() * 1e9)),
    []
  );
  const [picked, setPicked] = useState(null);
  const [feedback, setFeedback] = useState(null);

  const onPick = (idx) => {
    if (picked !== null) return;
    setPicked(idx);
    const correct = idx === item.correctIdx;
    setFeedback(
      correct
        ? { kind: "good", message: "Right on track! 🚌" }
        : { kind: "bad", message: `That's not the next stop. Correct: ${item.options[item.correctIdx]}.` }
    );
    setTimeout(
      () =>
        onComplete({
          domain: "language",
          points: correct ? 10 : 0,
          max_points: 10,
          correct,
          meta: { route: item.route, picked_idx: idx, correct_idx: item.correctIdx },
        }),
      1300
    );
  };

  return (
    <TaskShell
      icon="🚌"
      title="Bus Route Logic"
      voiceEnabled={voiceEnabled}
      prompt={item.prompt}
      hint="Pick the next stop along this familiar Sri Lankan route."
      feedback={feedback}
    >
      <div className="adv-options">
        {item.options.map((opt, i) => (
          <button
            key={i}
            type="button"
            className={`adv-option ${
              picked === null
                ? ""
                : i === item.correctIdx
                ? "ok"
                : picked === i
                ? "bad"
                : ""
            }`}
            disabled={picked !== null}
            onClick={() => onPick(i)}
          >
            {opt}
          </button>
        ))}
      </div>
    </TaskShell>
  );
}
