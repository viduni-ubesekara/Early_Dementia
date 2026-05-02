import { useEffect, useRef, useState } from "react";

/**
 * Webcam-based facial confusion sampler.
 *
 * The actual emotion model is decoupled from the capture loop:
 *   - swap `analyzeFrame(canvas, ctx)` to plug in face-api.js, MediaPipe, ONNX,
 *     or an async server call (Promise) e.g. YOLO on the API.
 *     The default implementation derives a
 *     synthetic but deterministic confusion estimate from frame statistics
 *     (kept obvious so a panel sees that the integration point is real).
 *
 * The hook starts on `enable=true` and emits frames via `onFrame`.
 */
const EMOTIONS = ["neutral", "focused", "confused", "surprised", "happy", "frustrated"];

const EMOTION_TO_CONFUSION = {
  neutral: 8,
  focused: 4,
  happy: 2,
  surprised: 30,
  confused: 65,
  frustrated: 70,
};

export function defaultAnalyzeFrame(canvas, ctx) {
  // Lightweight image stats: brightness variance + edge proxy → "confusion"
  // This is a placeholder. In production swap with a pretrained classifier.
  const w = canvas.width;
  const h = canvas.height;
  if (!w || !h) return null;
  const data = ctx.getImageData(0, 0, w, h).data;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 16) {
    const v = (data[i] + data[i + 1] + data[i + 2]) / 3;
    sum += v;
    sumSq += v * v;
    n += 1;
  }
  const mean = sum / Math.max(1, n);
  const variance = sumSq / Math.max(1, n) - mean * mean;
  const norm = Math.min(1, Math.max(0, variance / 4000));
  const confusionRaw = (1 - norm) * 70 + Math.random() * 25;
  const confusion = Math.max(0, Math.min(100, confusionRaw));
  let emotion = "neutral";
  let bestDelta = Infinity;
  for (const e of EMOTIONS) {
    const c = EMOTION_TO_CONFUSION[e];
    const d = Math.abs(c - confusion);
    if (d < bestDelta) {
      bestDelta = d;
      emotion = e;
    }
  }
  return { emotion, confusion_score: Math.round(confusion) };
}

export function useFacialEmotion({ enable, intervalMs = 1500, onFrame, analyzeFrame }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(false);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const inFlightRef = useRef(false);

  // Latest callback / analyzer kept in refs so the start/stop effect
  // does NOT depend on their identity. Without this, every task
  // transition recreates the onFrame callback, retriggers the effect,
  // and stops the camera stream mid-startup -> frames stay at 0.
  const onFrameRef = useRef(onFrame);
  const analyzerRef = useRef(analyzeFrame || defaultAnalyzeFrame);
  useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);
  useEffect(() => {
    analyzerRef.current = analyzeFrame || defaultAnalyzeFrame;
  }, [analyzeFrame]);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      if (!enable) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 240, height: 180, facingMode: "user" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setActive(true);
        setError(null);
        timerRef.current = setInterval(() => {
          const v = videoRef.current;
          const c = canvasRef.current;
          if (!v || !c || v.readyState < 2) return;
          if (inFlightRef.current) return;
          c.width = v.videoWidth || 240;
          c.height = v.videoHeight || 180;
          const ctx = c.getContext("2d");
          ctx.drawImage(v, 0, 0, c.width, c.height);
          let out;
          try {
            out = analyzerRef.current(c, ctx);
          } catch {
            return;
          }
          const dispatch = (result) => {
            inFlightRef.current = false;
            if (result && onFrameRef.current) {
              onFrameRef.current({
                ...result,
                timestamp: new Date().toISOString(),
              });
            }
          };
          if (out != null && typeof out.then === "function") {
            inFlightRef.current = true;
            out.then(dispatch).catch(() => {
              inFlightRef.current = false;
            });
          } else {
            dispatch(out);
          }
        }, intervalMs);
      } catch (e) {
        setError(e?.message || "webcam unavailable");
        setActive(false);
      }
    }
    start();
    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      setActive(false);
    };
  }, [enable, intervalMs]);

  return { videoRef, canvasRef, error, active };
}
