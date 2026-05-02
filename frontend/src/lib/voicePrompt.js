/**
 * Voice assistant — text-to-speech wrapper around the browser's
 * SpeechSynthesis API.
 *
 * We use this to read every task prompt aloud, which improves
 * accessibility for elderly patients with reduced reading vision
 * (one of the validated "design-for-elderly" recommendations,
 * see Czaja 2019, "Designing for Older Adults").
 *
 * Languages: English by default, with optional Sinhala (si-LK)
 * and Tamil (ta-IN) when those voices are installed on the host OS.
 * We never block on speech — if voices fail or the API is missing,
 * the UI silently falls back to text-only.
 */

const LANG_CODES = {
  en: "en-US",
  si: "si-LK",
  ta: "ta-IN",
};

let cachedVoices = null;

function loadVoices() {
  if (typeof window === "undefined" || !window.speechSynthesis) return [];
  if (cachedVoices && cachedVoices.length) return cachedVoices;
  const v = window.speechSynthesis.getVoices();
  if (v && v.length) cachedVoices = v;
  return v || [];
}

if (typeof window !== "undefined" && window.speechSynthesis) {
  // populate voices when the engine finishes loading them
  window.speechSynthesis.onvoiceschanged = () => {
    cachedVoices = window.speechSynthesis.getVoices() || [];
  };
}

function pickVoice(lang) {
  const voices = loadVoices();
  const target = LANG_CODES[lang] || lang || "en-US";
  return (
    voices.find((v) => v.lang && v.lang.toLowerCase() === target.toLowerCase()) ||
    voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(target.split("-")[0])) ||
    voices.find((v) => /en-/i.test(v.lang)) ||
    null
  );
}

export function isSpeechSynthesisSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function speak(text, opts = {}) {
  if (!isSpeechSynthesisSupported() || !text) {
    if (opts.onEnd) opts.onEnd();
    return false;
  }
  const u = new SpeechSynthesisUtterance(String(text));
  u.rate = opts.rate ?? 0.95;
  u.pitch = opts.pitch ?? 1.0;
  u.volume = opts.volume ?? 1.0;
  u.lang = LANG_CODES[opts.lang] || opts.lang || "en-US";
  const v = pickVoice(opts.lang || "en");
  if (v) u.voice = v;
  if (opts.onEnd) {
    u.onend = () => opts.onEnd();
    u.onerror = () => opts.onEnd();
  }
  try {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    return true;
  } catch {
    if (opts.onEnd) opts.onEnd();
    return false;
  }
}

/**
 * Promise-returning convenience: resolves when TTS playback ends.
 * Always resolves; never rejects (we don't want voice failures to
 * block the test flow).
 */
export function speakAsync(text, opts = {}) {
  return new Promise((resolve) => {
    speak(text, { ...opts, onEnd: resolve });
  });
}

/** Estimate TTS duration in ms (~3.5 chars / sec at rate 0.95). */
export function estimateSpeakDuration(text) {
  if (!text) return 0;
  return Math.min(15000, Math.max(800, text.length * 70));
}

export function stopSpeaking() {
  if (!isSpeechSynthesisSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {}
}
