import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Web Speech API wrapper that emits per-question speech samples with
 * lightweight clarity + sentiment heuristics. If the API is not available
 * (e.g. Firefox), `supported` is false and the UI should hide controls.
 */
const HESITATION = new Set(["um", "uh", "hmm", "er", "uhm", "ah", "hm", "eh"]);
const POS = new Set(["good", "fine", "ok", "yes", "right", "great", "easy", "sure", "got"]);
const NEG = new Set(["bad", "no", "wrong", "hard", "confused", "tired", "lost", "forget", "forgot"]);

function clarityFromTokens(tokens) {
  if (tokens.length === 0) return 0;
  const hes = tokens.filter((t) => HESITATION.has(t)).length;
  const hesRatio = hes / Math.max(1, tokens.length);
  const lenScore = Math.min(1, tokens.length / 8);
  return Math.max(0, Math.min(100, (1 - hesRatio) * 70 + lenScore * 30));
}

function sentimentFromTokens(tokens) {
  let pos = 0;
  let neg = 0;
  for (const t of tokens) {
    if (POS.has(t)) pos += 1;
    if (NEG.has(t)) neg += 1;
  }
  if (pos + neg === 0) return 50;
  const balance = (pos - neg) / (pos + neg);
  return ((balance + 1) / 2) * 100;
}

export function analyzeTranscript(transcript) {
  const tokens = String(transcript || "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return {
    transcript: String(transcript || ""),
    hesitation_count: tokens.filter((t) => HESITATION.has(t)).length,
    clarity_score: Number(clarityFromTokens(tokens).toFixed(2)),
    sentiment_score: Number(sentimentFromTokens(tokens).toFixed(2)),
  };
}

export function useSpeechInput() {
  const Recog =
    (typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition)) ||
    null;
  const [supported] = useState(Boolean(Recog));
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const recogRef = useRef(null);
  const finalRef = useRef("");

  useEffect(() => {
    if (!Recog) return;
    const r = new Recog();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    r.onresult = (e) => {
      let final = "";
      let inter = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const txt = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += " " + txt;
        else inter += " " + txt;
      }
      if (final) finalRef.current = (finalRef.current + " " + final).trim();
      setInterim(inter.trim());
    };
    r.onend = () => setListening(false);
    recogRef.current = r;
    return () => {
      try {
        r.stop();
      } catch {}
      recogRef.current = null;
    };
  }, [Recog]);

  const start = useCallback(() => {
    if (!recogRef.current) return;
    finalRef.current = "";
    setInterim("");
    const r = recogRef.current;
    try {
      r.start();
      setListening(true);
    } catch (e) {
      const msg = String(e?.message || e || "");
      if (/already started|already running/i.test(msg)) {
        try {
          r.stop();
        } catch {}
        setTimeout(() => {
          try {
            r.start();
            setListening(true);
          } catch {
            setListening(false);
          }
        }, 120);
        return;
      }
      setListening(false);
    }
  }, []);

  const stop = useCallback(() => {
    if (!recogRef.current) return null;
    try {
      recogRef.current.stop();
    } catch {}
    setListening(false);
    const tx = (finalRef.current + " " + interim).trim();
    return analyzeTranscript(tx);
  }, [interim]);

  return { supported, listening, interim, start, stop };
}
