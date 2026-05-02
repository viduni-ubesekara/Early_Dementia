import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Robust per-task Web Speech API wrapper.
 *
 * Why this exists in addition to `useSpeechInput.js`:
 *   - The browser-side SpeechRecognition object stops on long silences
 *     and errors (no-speech, network, audio-capture). With
 *     continuous=true it still emits `onend` periodically. We
 *     auto-restart while the caller is still in a "want to listen"
 *     state.
 *   - Each capture is bound to a *task id* so the caller can collect
 *     a separate transcript per cognitive task (verbal fluency,
 *     picture description, life conversation, etc.) instead of one
 *     blob for the whole session.
 *   - Common errors are surfaced as a structured `error` value the
 *     UI can show with recovery instructions.
 */

const HESITATION = new Set(["um", "uh", "hmm", "er", "uhm", "ah", "hm", "eh", "mm"]);
const POS = new Set([
  "good", "fine", "ok", "okay", "yes", "right", "great",
  "easy", "sure", "got", "remember", "happy",
]);
const NEG = new Set([
  "bad", "no", "wrong", "hard", "confused", "tired",
  "lost", "forget", "forgot", "sad", "anxious",
]);

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z\s']/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function clarity(tokens) {
  if (!tokens.length) return 0;
  const hes = tokens.filter((t) => HESITATION.has(t)).length;
  const hesRatio = hes / Math.max(1, tokens.length);
  const lenScore = Math.min(1, tokens.length / 8);
  return Math.max(0, Math.min(100, (1 - hesRatio) * 70 + lenScore * 30));
}

function sentiment(tokens) {
  let pos = 0, neg = 0;
  for (const t of tokens) {
    if (POS.has(t)) pos++;
    if (NEG.has(t)) neg++;
  }
  if (pos + neg === 0) return 50;
  return ((pos - neg) / (pos + neg) + 1) / 2 * 100;
}

function typeTokenRatio(tokens) {
  if (!tokens.length) return 0;
  return new Set(tokens).size / tokens.length;
}

function meanLengthOfUtterance(text) {
  if (!text) return 0;
  const utts = text.split(/[.!?;]+/).map((u) => u.trim()).filter(Boolean);
  if (!utts.length) return text.split(/\s+/).filter(Boolean).length;
  const lens = utts.map((u) => u.split(/\s+/).filter(Boolean).length);
  return lens.reduce((a, b) => a + b, 0) / lens.length;
}

/**
 * Repetition rate - fraction of consecutive bigrams (or unigrams) that
 * are exact repeats. Elevated repetition is a hallmark of semantic
 * dementia and Alzheimer's connected speech (Boschi 2017, Front Psychol;
 * Fraser 2016, J Alzheimers Dis).
 */
function repetitionRate(tokens) {
  if (tokens.length < 2) return 0;
  let rep = 0;
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i] === tokens[i - 1]) rep++;
  }
  // Also count short bigram echoes ("the the", "I I went went").
  let bigramRep = 0;
  for (let i = 3; i < tokens.length; i++) {
    if (tokens[i] === tokens[i - 2] && tokens[i - 1] === tokens[i - 3]) bigramRep++;
  }
  return Math.min(1, (rep + bigramRep) / Math.max(1, tokens.length - 1));
}

/**
 * Sentence-complexity proxy (Fraser 2016). Real syntactic parsing is
 * expensive in the browser, so we use two robust surface features:
 *   - mean utterance length (longer sentences => richer syntax)
 *   - subordinator density (because, although, when, etc.)
 * Returns a 0-100 score.
 */
const SUBORDINATORS = new Set([
  "because", "although", "though", "while", "whereas", "since",
  "after", "before", "when", "whenever", "until", "unless",
  "if", "as", "so", "that", "which", "who", "where", "why",
]);

function sentenceComplexityScore(text, tokens) {
  if (!tokens.length) return 0;
  const mlu = meanLengthOfUtterance(text);
  const subs = tokens.filter((t) => SUBORDINATORS.has(t)).length;
  const subDensity = subs / tokens.length;
  // MLU 12+ is rich, MLU < 5 is impoverished (Fraser 2016).
  const mluPart = Math.min(1, mlu / 12) * 70;
  const subPart = Math.min(1, subDensity / 0.05) * 30;
  return Math.round(mluPart + subPart);
}

/**
 * Speech speed in words per minute, given a duration in seconds.
 * Healthy adult conversational rate is ~140-180 WPM (Goldman-Eisler 1968).
 * < 100 WPM in connected speech is a flag for cognitive slowing
 * (Forbes-McKay 2005).
 */
function wordsPerMinute(wordCount, durationSec) {
  if (!durationSec || durationSec < 0.1) return 0;
  return (wordCount / durationSec) * 60;
}

export function analyzeTranscript(transcript, opts = {}) {
  const tokens = tokenize(transcript);
  const wpm = opts.durationSec
    ? wordsPerMinute(tokens.length, opts.durationSec)
    : null;
  const pauseTotal = opts.pauseTotalMs ?? null;
  const pauseLong = opts.pauseLongCount ?? null;
  return {
    transcript: String(transcript || ""),
    word_count: tokens.length,
    unique_word_count: new Set(tokens).size,
    hesitation_count: tokens.filter((t) => HESITATION.has(t)).length,
    clarity_score: Number(clarity(tokens).toFixed(2)),
    sentiment_score: Number(sentiment(tokens).toFixed(2)),
    type_token_ratio: Number(typeTokenRatio(tokens).toFixed(3)),
    mean_length_of_utterance: Number(meanLengthOfUtterance(transcript).toFixed(2)),
    repetition_rate: Number(repetitionRate(tokens).toFixed(3)),
    sentence_complexity: sentenceComplexityScore(transcript, tokens),
    duration_sec: opts.durationSec ?? null,
    words_per_minute: wpm == null ? null : Math.round(wpm),
    pause_total_ms: pauseTotal,
    long_pause_count: pauseLong,
    cognitive_slowdown_flag:
      wpm != null && wpm > 0 && wpm < 100,
    excessive_repetition_flag:
      tokens.length >= 20 && repetitionRate(tokens) > 0.08,
    excessive_hesitation_flag:
      tokens.length >= 20 &&
      tokens.filter((t) => HESITATION.has(t)).length / tokens.length > 0.08,
  };
}

/** Domain-specific extractors. */
export function countAnimalsInTranscript(transcript) {
  const list = new Set([
    "dog","cat","cow","horse","goat","sheep","pig","chicken","duck","goose","rabbit","hen","rooster",
    "lion","tiger","leopard","cheetah","bear","panda","wolf","fox","deer","elephant","giraffe",
    "zebra","hippo","hippopotamus","rhino","rhinoceros","kangaroo","koala","monkey","gorilla",
    "ape","chimpanzee","baboon","camel","donkey","mule","squirrel","mouse","rat","hamster",
    "guinea","pig","ferret","beaver","otter","raccoon","skunk","badger","seal","walrus","whale",
    "dolphin","shark","fish","goldfish","tuna","salmon","trout","cod","bass","perch","sardine",
    "octopus","squid","crab","lobster","shrimp","clam","mussel","oyster","jellyfish","starfish",
    "snail","worm","ant","bee","wasp","hornet","fly","mosquito","spider","beetle","butterfly",
    "moth","caterpillar","grasshopper","cricket","cockroach","dragonfly","ladybug","scorpion",
    "snake","cobra","python","lizard","gecko","iguana","chameleon","turtle","tortoise","frog",
    "toad","crocodile","alligator","eagle","hawk","falcon","owl","vulture","crow","raven",
    "sparrow","robin","parrot","peacock","pigeon","dove","seagull","penguin","ostrich","emu",
    "swan","stork","flamingo","heron","turkey","quail","pheasant","mongoose","platypus",
    "iguana","newt","salamander","jaguar","puma","lynx","cougar","leopard","panther","hyena",
  ]);
  const tokens = tokenize(transcript);
  // Count UNIQUE animals named (avoid spam).
  const seen = new Set();
  for (const t of tokens) {
    if (list.has(t)) seen.add(t);
  }
  return { unique_animals: seen.size, named: Array.from(seen) };
}

export function useSpeechCapture() {
  const Recog =
    typeof window !== "undefined"
      ? (window.SpeechRecognition || window.webkitSpeechRecognition)
      : null;
  const [supported] = useState(Boolean(Recog));
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState(null);
  const [activeTaskId, setActiveTaskId] = useState(null);

  const recogRef = useRef(null);
  const finalRef = useRef("");
  const wantListeningRef = useRef(false);
  /** Single pending start after stop/onend — avoids "recognition has already started". */
  const startTimerRef = useRef(null);

  // Timing instrumentation for WPM + pause-duration features.
  const startTimeRef = useRef(0);
  const lastSpeechAtRef = useRef(0);
  const pauseTotalRef = useRef(0);
  const longPauseCountRef = useRef(0);
  const LONG_PAUSE_MS = 1500;

  const clearStartTimer = useCallback(() => {
    if (startTimerRef.current != null) {
      clearTimeout(startTimerRef.current);
      startTimerRef.current = null;
    }
  }, []);

  /**
   * Exactly one delayed start — coalesces onend restarts + user "mic on" taps.
   */
  const scheduleStart = useCallback(
    (delayMs = 60) => {
      clearStartTimer();
      startTimerRef.current = setTimeout(() => {
        startTimerRef.current = null;
        const r = recogRef.current;
        if (!r || !wantListeningRef.current) return;
        try {
          r.start();
        } catch (e) {
          const msg = String(e?.message || e || "");
          if (/already started|already running/i.test(msg)) {
            try {
              r.stop();
            } catch {
              try {
                r.abort?.();
              } catch {
                /* ignore */
              }
            }
            startTimerRef.current = setTimeout(() => {
              startTimerRef.current = null;
              if (!wantListeningRef.current) return;
              try {
                r.start();
              } catch (e2) {
                setError(String(e2?.message || e2));
                setListening(false);
              }
            }, 140);
            return;
          }
          setError(msg || "speech-start-failed");
          setListening(false);
        }
      }, delayMs);
    },
    [clearStartTimer]
  );

  const ensureRecognizer = useCallback(() => {
    if (!Recog) return null;
    if (recogRef.current) return recogRef.current;
    const r = new Recog();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    r.onstart = () => {
      setListening(true);
      setError(null);
    };
    r.onresult = (e) => {
      const now = performance.now();
      const lastT = lastSpeechAtRef.current || now;
      const gap = now - lastT;
      if (gap > LONG_PAUSE_MS && lastSpeechAtRef.current !== 0) {
        pauseTotalRef.current += gap;
        longPauseCountRef.current += 1;
      }
      lastSpeechAtRef.current = now;

      let final = "";
      let inter = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += " " + t;
        else inter += " " + t;
      }
      if (final) finalRef.current = (finalRef.current + " " + final).trim();
      setInterim(inter.trim());
    };
    r.onerror = (e) => {
      const code = e?.error || "speech-error";
      // no-speech and audio-capture are recoverable - keep listening.
      if (code === "no-speech" || code === "audio-capture" || code === "aborted" || code === "network") {
        // onend will follow; restart logic in onend handles it.
        return;
      }
      setError(code);
    };
    r.onend = () => {
      if (wantListeningRef.current) {
        scheduleStart(70);
      } else {
        setListening(false);
      }
    };
    recogRef.current = r;
    return r;
  }, [Recog, scheduleStart]);

  const start = useCallback(
    (taskId = null) => {
      if (!Recog) return false;
      clearStartTimer();
      setError(null);
      finalRef.current = "";
      setInterim("");
      setActiveTaskId(taskId);
      startTimeRef.current = performance.now();
      lastSpeechAtRef.current = 0;
      pauseTotalRef.current = 0;
      longPauseCountRef.current = 0;
      const r = ensureRecognizer();
      if (!r) return false;
      wantListeningRef.current = true;
      try {
        r.stop();
      } catch {
        try {
          r.abort?.();
        } catch {
          /* ignore */
        }
      }
      scheduleStart(50);
      return true;
    },
    [Recog, ensureRecognizer, scheduleStart, clearStartTimer]
  );

  const stop = useCallback(() => {
    clearStartTimer();
    wantListeningRef.current = false;
    try {
      recogRef.current?.stop();
    } catch {}
    setListening(false);
    const transcript = (finalRef.current + " " + interim).trim();
    const durationSec =
      startTimeRef.current > 0
        ? (performance.now() - startTimeRef.current) / 1000
        : 0;
    const sample = analyzeTranscript(transcript, {
      durationSec,
      pauseTotalMs: Math.round(pauseTotalRef.current),
      pauseLongCount: longPauseCountRef.current,
    });
    sample.questionId = activeTaskId;
    return sample;
  }, [interim, activeTaskId, clearStartTimer]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      clearStartTimer();
      wantListeningRef.current = false;
      try {
        recogRef.current?.stop();
      } catch {}
      recogRef.current = null;
    };
  }, [clearStartTimer]);

  return {
    supported,
    listening,
    interim,
    error,
    activeTaskId,
    start,
    stop,
  };
}
