import { useEffect, useMemo, useRef, useState } from "react";
import TaskShell from "./TaskShell.jsx";
import { MARKET_ITEMS, pickMarketItems } from "../../lib/srilanka.js";

/**
 * Market Memory ("Pola simulation").
 *
 * 5 items shown in a stylized market stall for 7 seconds, then
 * a 5-second distractor, then the patient ticks which items they
 * saw from a 12-item grid. Tests memory + selective attention.
 *
 * Cultural context: "pola" is the Sri Lankan weekly open-air market,
 * a very familiar setting that shifts the test from abstract to
 * everyday-functional cognition.
 */
export default function MarketMemoryTask({ onComplete, voiceEnabled = true }) {
  const seedRef = useRef(Math.floor(Math.random() * 1e9));
  const items = useMemo(() => pickMarketItems(5, seedRef.current), []);
  const itemIds = useMemo(() => new Set(items.map((i) => i.id)), [items]);

  const [stage, setStage] = useState("show"); // show -> wait -> pick -> done
  const [secondsLeft, setSecondsLeft] = useState(7);
  const [picks, setPicks] = useState({});
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    if (stage !== "show") return;
    setSecondsLeft(7);
    const start = performance.now();
    const id = setInterval(() => {
      const left = Math.max(0, 7 - (performance.now() - start) / 1000);
      setSecondsLeft(left);
      if (left <= 0) {
        clearInterval(id);
        setStage("wait");
      }
    }, 150);
    return () => clearInterval(id);
  }, [stage]);

  useEffect(() => {
    if (stage !== "wait") return;
    setSecondsLeft(5);
    const start = performance.now();
    const id = setInterval(() => {
      const left = Math.max(0, 5 - (performance.now() - start) / 1000);
      setSecondsLeft(left);
      if (left <= 0) {
        clearInterval(id);
        setStage("pick");
      }
    }, 150);
    return () => clearInterval(id);
  }, [stage]);

  const submit = () => {
    const correct = items.filter((it) => picks[it.id]).length;
    const wrong = MARKET_ITEMS.filter(
      (it) => picks[it.id] && !itemIds.has(it.id)
    ).length;
    const adjusted = Math.max(0, correct - wrong * 0.5);
    const points = Math.round((adjusted / items.length) * 10);
    const allRight = correct === items.length && wrong === 0;
    setStage("done");
    setFeedback(
      allRight
        ? { kind: "good", message: `Perfect — ${correct}/${items.length} from the pola!` }
        : correct >= Math.ceil(items.length * 0.6)
        ? { kind: "ok", message: `Good — ${correct}/${items.length} (${wrong} extra picked).` }
        : { kind: "bad", message: `${correct}/${items.length}. The pola was tricky!` }
    );
    setTimeout(
      () =>
        onComplete({
          domain: "memory",
          points,
          max_points: 10,
          correct: allRight,
          meta: { correct, wrong, total: items.length },
        }),
      1200
    );
  };

  return (
    <TaskShell
      icon="🛒"
      title="Market Memory — Pola simulation"
      voiceEnabled={voiceEnabled}
      prompt={
        stage === "show"
          ? "Look at the items at the pola — try to remember each one. They'll disappear soon."
          : stage === "wait"
          ? "Hold those items in mind for a few seconds…"
          : stage === "pick"
          ? "Tick every item you saw at the pola. Some items below were NOT shown."
          : "Pola round complete."
      }
      feedback={feedback}
    >
      {stage === "show" && (
        <div className="adv-pola">
          <div className="adv-pola-stall">
            {items.map((it) => (
              <div key={it.id} className="adv-pola-item">
                <span className="adv-pola-emoji">{it.emoji}</span>
                <span>{it.name}</span>
              </div>
            ))}
          </div>
          <p style={{ color: "var(--muted)", marginTop: 6 }}>
            disappearing in {Math.ceil(secondsLeft)}s
          </p>
        </div>
      )}

      {stage === "wait" && (
        <div className="adv-distractor">
          <div className="adv-distractor-clock">{Math.ceil(secondsLeft)}s</div>
          <p style={{ color: "var(--muted)" }}>
            Quick distractor: count down from 5 in your head.
          </p>
        </div>
      )}

      {stage === "pick" && (
        <>
          <div className="adv-pola-grid">
            {MARKET_ITEMS.map((it) => (
              <button
                key={it.id}
                type="button"
                className={`adv-pola-tile ${picks[it.id] ? "on" : ""}`}
                onClick={() =>
                  setPicks((p) => ({ ...p, [it.id]: !p[it.id] }))
                }
              >
                <span className="adv-pola-emoji">{it.emoji}</span>
                <span>{it.name}</span>
              </button>
            ))}
          </div>
          <div style={{ marginTop: 12 }}>
            <button type="button" className="btn btn-primary" onClick={submit}>
              Submit picks →
            </button>
          </div>
        </>
      )}
    </TaskShell>
  );
}
