/**
 * Adaptive Cognitive Testing (ACT) helpers.
 *
 * Why this exists:
 *   Traditional MMSE-style tests are static — every patient gets the
 *   same items at the same difficulty. That misses ceiling effects in
 *   high-functioning individuals and floor effects in low-functioning
 *   ones (Jorm 2003, Crum 1993). Adaptive testing tunes item difficulty
 *   to a patient's running performance, much like CAT (Computer
 *   Adaptive Testing) used in Alzheimer's research (Mungas 2011).
 *
 *   We use a simple but defensible rule:
 *     - rolling accuracy of last 3 items
 *     - >= 0.66 => step difficulty up
 *     - <= 0.33 => step difficulty down
 *     - else hold
 *
 *   The level returned is an index into a domain-specific difficulty
 *   ladder (e.g. for memory: 3 -> 5 -> 7 words).
 */

export function createAdaptiveTracker({
  initialLevel = 0,
  maxLevel = 2,
  minLevel = 0,
  windowSize = 3,
  upThreshold = 0.66,
  downThreshold = 0.34,
} = {}) {
  let currentLevel = clamp(initialLevel, minLevel, maxLevel);
  const history = [];

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function record(correct) {
    history.push(correct ? 1 : 0);
    const window = history.slice(-windowSize);
    if (window.length < Math.min(windowSize, 2)) return currentLevel;
    const acc = window.reduce((a, b) => a + b, 0) / window.length;
    if (acc >= upThreshold && currentLevel < maxLevel) {
      currentLevel = clamp(currentLevel + 1, minLevel, maxLevel);
    } else if (acc <= downThreshold && currentLevel > minLevel) {
      currentLevel = clamp(currentLevel - 1, minLevel, maxLevel);
    }
    return currentLevel;
  }

  return {
    record,
    getLevel: () => currentLevel,
    setLevel: (v) => {
      currentLevel = clamp(v, minLevel, maxLevel);
      return currentLevel;
    },
    getAccuracy: () =>
      history.length === 0 ? 0 : history.reduce((a, b) => a + b, 0) / history.length,
    getHistory: () => history.slice(),
  };
}

/**
 * Memory ladder: 3 -> 5 -> 7 words (Wechsler 1997 / Tombaugh 2005).
 * Delay seconds rise with the number of words because a longer list
 * produces longer encoding and more proactive interference.
 */
export const MEMORY_LADDER = [
  { level: 0, words: 3, delaySec: 8, label: "Easy (3 items)" },
  { level: 1, words: 5, delaySec: 12, label: "Medium (5 items)" },
  { level: 2, words: 7, delaySec: 18, label: "Hard (7 items)" },
];

/**
 * Score conversion: how many of the shown words were recalled,
 * scaled to 0-10. We award a bonus for higher levels — a patient who
 * recalls 3/3 from the easy list should not score the same as one who
 * recalls 7/7 from the hard list.
 */
export function memoryRecallToPoints(remembered, total, level) {
  if (total === 0) return 0;
  const ratio = remembered / total;
  // Base from ratio, with level bonus capped so easy 100% ~ 7/10,
  // hard 100% = 10/10.
  const base = ratio * (level === 2 ? 10 : level === 1 ? 9 : 8);
  return Math.max(0, Math.min(10, Math.round(base)));
}
