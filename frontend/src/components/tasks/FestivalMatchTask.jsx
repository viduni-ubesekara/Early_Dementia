import { useMemo, useState } from "react";
import TaskShell from "./TaskShell.jsx";
import { buildFestivalMatchPairs } from "../../lib/srilanka.js";

/**
 * Festival ↔ symbol matching.
 *
 * Patient sees two columns — festivals on the left, symbols on the
 * right — and clicks one from each side to draw a match. Tests
 * cultural cognition (familiar associations) and pair-association
 * memory.
 */
export default function FestivalMatchTask({ onComplete, voiceEnabled = true }) {
  const pairs = useMemo(() => buildFestivalMatchPairs(), []);

  const [shuffledSymbols] = useState(() => {
    const arr = pairs.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  });

  const [matches, setMatches] = useState({});
  const [selected, setSelected] = useState({ festival: null, symbol: null });
  const [feedback, setFeedback] = useState(null);

  const tryMatch = (festivalId, symbolId) => {
    if (festivalId == null || symbolId == null) return;
    if (festivalId === symbolId) {
      setMatches((m) => ({ ...m, [festivalId]: symbolId }));
      setSelected({ festival: null, symbol: null });
    } else {
      // brief shake feedback
      setSelected({ festival: null, symbol: null });
      setFeedback({ kind: "ok", message: "Not a match — try again." });
      setTimeout(() => setFeedback(null), 800);
    }
  };

  const submit = () => {
    const correct = pairs.filter((p) => matches[p.id] === p.id).length;
    const points = Math.round((correct / pairs.length) * 10);
    const allRight = correct === pairs.length;
    setFeedback(
      allRight
        ? { kind: "good", message: `All ${correct}/${pairs.length} matched!` }
        : { kind: "ok", message: `${correct}/${pairs.length} matched.` }
    );
    setTimeout(
      () =>
        onComplete({
          domain: "language",
          points,
          max_points: 10,
          correct: allRight,
          meta: { correct, total: pairs.length },
        }),
      1200
    );
  };

  const onPickFestival = (id) => {
    if (matches[id]) return;
    if (selected.symbol) {
      tryMatch(id, selected.symbol);
    } else {
      setSelected((s) => ({ ...s, festival: id }));
    }
  };
  const onPickSymbol = (id) => {
    if (Object.values(matches).includes(id)) return;
    if (selected.festival) {
      tryMatch(selected.festival, id);
    } else {
      setSelected((s) => ({ ...s, symbol: id }));
    }
  };

  const allDone = Object.keys(matches).length === pairs.length;

  return (
    <TaskShell
      icon="🪔"
      title="Festival Matching"
      voiceEnabled={voiceEnabled}
      prompt="Match each festival on the left with the symbol that goes with it."
      hint="Tap one from each side to draw a match."
      feedback={feedback}
    >
      <div className="adv-match">
        <div className="adv-match-col">
          {pairs.map((p) => {
            const matched = matches[p.id];
            return (
              <button
                key={p.id}
                type="button"
                className={`adv-match-item ${matched ? "matched" : ""} ${
                  selected.festival === p.id ? "active" : ""
                }`}
                onClick={() => onPickFestival(p.id)}
                disabled={!!matched}
              >
                {p.festival}
              </button>
            );
          })}
        </div>
        <div className="adv-match-col">
          {shuffledSymbols.map((p) => {
            const matched = Object.values(matches).includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                className={`adv-match-item ${matched ? "matched" : ""} ${
                  selected.symbol === p.id ? "active" : ""
                }`}
                onClick={() => onPickSymbol(p.id)}
                disabled={matched}
              >
                <span className="adv-match-emoji">{p.emoji}</span>
                {p.symbol}
              </button>
            );
          })}
        </div>
      </div>
      {allDone && (
        <div style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-primary" onClick={submit}>
            Done →
          </button>
        </div>
      )}
    </TaskShell>
  );
}
