import { useEffect, useMemo, useRef, useState } from "react";
import TaskShell from "./TaskShell.jsx";
import {
  MEMORY_LADDER,
  memoryRecallToPoints,
} from "../../lib/adaptiveDifficulty.js";
import { MEMORY_WORD_BANK } from "../../lib/srilanka.js";
import { speak } from "../../lib/voicePrompt.js";

/**
 * Adaptive memory recall task.
 *
 *   level 0: 3 Sri-Lankan-context words, 8 s delay
 *   level 1: 5 words, 12 s delay
 *   level 2: 7 words, 18 s delay
 *
 * Difficulty is set by the parent (caller) based on a running
 * accuracy tracker, but the task itself can also auto-promote/demote
 * for a smoother in-task experience: if a patient nails 3/3 we offer
 * one more round at the next level for free.
 *
 * Stages: prompt -> show -> distractor (delay) -> recall.
 */

const LEVEL_LISTS = [
  MEMORY_WORD_BANK.easy,
  MEMORY_WORD_BANK.medium,
  MEMORY_WORD_BANK.hard,
];

export default function AdaptiveMemoryTask({
  level: initialLevel = 0,
  onComplete,
  voiceEnabled = true,
}) {
  const [level, setLevel] = useState(
    Math.max(0, Math.min(2, initialLevel))
  );
  const [stage, setStage] = useState("show"); // show -> wait -> recall -> done
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [recall, setRecall] = useState({});
  const [feedback, setFeedback] = useState(null);

  const ladder = MEMORY_LADDER[level];
  const list = useMemo(() => LEVEL_LISTS[level].slice(0, ladder.words), [level, ladder.words]);

  // distractor list (foils for recall recognition)
  const foils = useMemo(() => {
    const all = Object.values(MEMORY_WORD_BANK).flat();
    const set = new Set(list);
    return all.filter((w) => !set.has(w)).slice(0, Math.min(4, ladder.words));
  }, [list, ladder.words]);

  const startTimeRef = useRef(0);

  // Show phase: ~3s per word so the patient can read each one
  useEffect(() => {
    if (stage !== "show") return;
    const showMs = Math.max(6000, ladder.words * 1500);
    if (voiceEnabled) {
      // read out the words, joined with "and"
      const phrase = `Please remember these ${ladder.words} words: ${list.join(", ")}.`;
      const t = setTimeout(() => speak(phrase), 250);
      const t2 = setTimeout(() => setStage("wait"), showMs);
      return () => {
        clearTimeout(t);
        clearTimeout(t2);
      };
    }
    const t = setTimeout(() => setStage("wait"), showMs);
    return () => clearTimeout(t);
  }, [stage, list, ladder.words, voiceEnabled]);

  // Wait phase: countdown delay (the "delayed" part of delayed recall)
  useEffect(() => {
    if (stage !== "wait") return;
    setSecondsLeft(ladder.delaySec);
    startTimeRef.current = performance.now();
    const id = setInterval(() => {
      const elapsed = (performance.now() - startTimeRef.current) / 1000;
      const left = Math.max(0, ladder.delaySec - elapsed);
      setSecondsLeft(left);
      if (left <= 0) {
        clearInterval(id);
        setStage("recall");
      }
    }, 200);
    return () => clearInterval(id);
  }, [stage, ladder.delaySec]);

  const submit = () => {
    const remembered = list.filter((w) => recall[w]).length;
    const wrongPicks = foils.filter((w) => recall[w]).length;
    const adjusted = Math.max(0, remembered - wrongPicks * 0.5);
    const points = memoryRecallToPoints(adjusted, list.length, level);
    const correct = remembered === list.length && wrongPicks === 0;
    setStage("done");
    setFeedback(
      correct
        ? { kind: "good", message: `Excellent! ${remembered}/${list.length} remembered.` }
        : remembered >= Math.ceil(list.length * 0.5)
        ? { kind: "ok", message: `Nice — ${remembered}/${list.length} remembered.` }
        : { kind: "bad", message: `${remembered}/${list.length} remembered. That's okay.` }
    );
    setTimeout(() => {
      onComplete({
        domain: "memory",
        points,
        max_points: 10,
        correct,
        level,
        meta: {
          words_total: list.length,
          remembered,
          wrong_picks: wrongPicks,
        },
      });
    }, 1200);
  };

  const replayShow = () => {
    setStage("show");
    setRecall({});
    setFeedback(null);
  };

  return (
    <TaskShell
      icon="🧠"
      title="Memory — adaptive recall"
      level={level}
      prompt={
        stage === "show"
          ? `Read and remember these ${ladder.words} words. They will disappear in a moment.`
          : stage === "wait"
          ? "Hold those words in mind for a few seconds…"
          : stage === "recall"
          ? "Tick the words you remember. There may also be some words you have NOT seen."
          : "Memory round complete."
      }
      hint={ladder.label}
      voiceEnabled={voiceEnabled}
      feedback={feedback}
    >
      {stage === "show" && (
        <div className="adv-words adv-words-big">
          {list.map((w) => (
            <span key={w} className="adv-word-chip adv-word-show">
              {w}
            </span>
          ))}
        </div>
      )}

      {stage === "wait" && (
        <div className="adv-distractor">
          <div className="adv-distractor-clock">
            {Math.ceil(secondsLeft)}s
          </div>
          <p style={{ color: "var(--muted)" }}>
            Please count slowly from 1 to 10 in your head while you wait.
          </p>
        </div>
      )}

      {stage === "recall" && (
        <>
          <div className="adv-recall">
            {[...list, ...foils]
              .sort()
              .map((w) => (
                <label
                  key={w}
                  className={`adv-recall-chip ${recall[w] ? "on" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={!!recall[w]}
                    onChange={(e) =>
                      setRecall((s) => ({ ...s, [w]: e.target.checked }))
                    }
                  />
                  <span>{w}</span>
                </label>
              ))}
          </div>
          <div style={{ marginTop: 12 }}>
            <button className="btn btn-primary" type="button" onClick={submit}>
              Submit recall →
            </button>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={replayShow}
              style={{ marginLeft: 8 }}
            >
              Show me again
            </button>
          </div>
        </>
      )}

      {level < 2 && stage === "show" && (
        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setLevel((l) => Math.min(2, l + 1))}
          >
            I want a harder list →
          </button>
        </div>
      )}
    </TaskShell>
  );
}
