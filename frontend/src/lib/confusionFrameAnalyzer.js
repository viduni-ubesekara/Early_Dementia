import { analyzeConfusionWebcamFrame } from "../api.js";
import { defaultAnalyzeFrame } from "../hooks/useFacialEmotion.js";

/**
 * Sends each webcam frame to POST /api/analyze-confusion-frame (YOLOv8 on the server).
 * On failure or missing weights (503), falls back to the local placeholder stats.
 */
export function createYoloConfusionAnalyzer(options = {}) {
  const fallback = options.fallbackAnalyzeFrame || defaultAnalyzeFrame;
  return function analyzeFrame(canvas, ctx) {
    return new Promise((resolve) => {
      canvas.toBlob(
        async (blob) => {
          if (!blob) {
            resolve(fallback(canvas, ctx));
            return;
          }
          try {
            const j = await analyzeConfusionWebcamFrame(blob);
            resolve({
              emotion: j.emotion ?? "neutral",
              confusion_score: Math.round(Number(j.confusion_score ?? 0)),
            });
          } catch {
            resolve(fallback(canvas, ctx));
          }
        },
        "image/jpeg",
        0.82
      );
    });
  };
}
