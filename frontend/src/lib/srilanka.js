/**
 * Sri Lankan-context cognitive item banks.
 *
 * Standard cognitive screens (MMSE, MoCA) are heavily Western-biased
 * — they ask about months, seasons, and animals familiar to a US/EU
 * test-taker. Cross-cultural validity studies (Iype 2006; Karunaratne
 * 2011; De Silva 2014) consistently show these tests over-detect
 * "impairment" in Sri Lankan elderly because of cultural mismatch,
 * not actual cognition.
 *
 * This module ships culturally-grounded item banks:
 *   - context-aware orientation (festivals, meal times, weather)
 *   - Sri Lankan market simulation (Pola memory)
 *   - bus route logic puzzles (Colombo → Kandy etc.)
 *   - festival ↔ symbol matching
 *   - Sinhala-friendly attention game
 *
 * Each item carries a `domain` so the cognitive scoring engine can map
 * it to the correct MoCA-style sub-score (memory, attention, etc.).
 */

// =====================================================================
// Festivals (used for context-aware orientation and matching game)
// =====================================================================

export const FESTIVALS = [
  {
    id: "avurudu",
    name: "Sinhala / Tamil New Year (Avurudu)",
    shortName: "Avurudu",
    month: 4,
    day: 13,
    symbol: "Milk Rice",
    emoji: "🍚",
  },
  {
    id: "vesak",
    name: "Vesak",
    shortName: "Vesak",
    month: 5,
    day: 15,
    symbol: "Lantern",
    emoji: "🏮",
  },
  {
    id: "poson",
    name: "Poson",
    shortName: "Poson",
    month: 6,
    day: 15,
    symbol: "White Lotus",
    emoji: "🪷",
  },
  {
    id: "esala",
    name: "Esala Perahera",
    shortName: "Esala Perahera",
    month: 8,
    day: 1,
    symbol: "Elephant Procession",
    emoji: "🐘",
  },
  {
    id: "deepavali",
    name: "Deepavali",
    shortName: "Deepavali",
    month: 10,
    day: 31,
    symbol: "Diya Lamp",
    emoji: "🪔",
  },
  {
    id: "christmas",
    name: "Christmas",
    shortName: "Christmas",
    month: 12,
    day: 25,
    symbol: "Christmas Tree",
    emoji: "🎄",
  },
  {
    id: "thaipongal",
    name: "Thai Pongal",
    shortName: "Thai Pongal",
    month: 1,
    day: 14,
    symbol: "Pongal Pot",
    emoji: "🍲",
  },
];

function dayOfYear(d) {
  const start = new Date(d.getFullYear(), 0, 0);
  const diff = d - start;
  return Math.floor(diff / 86400000);
}

/** Return the festival closest in days to `now`, considering wrap-around. */
export function nearestFestival(now = new Date()) {
  const today = dayOfYear(now);
  const isLeap =
    (now.getFullYear() % 4 === 0 && now.getFullYear() % 100 !== 0) ||
    now.getFullYear() % 400 === 0;
  const yearLen = isLeap ? 366 : 365;
  let best = null;
  let bestDist = Infinity;
  for (const f of FESTIVALS) {
    const fd = new Date(now.getFullYear(), f.month - 1, f.day);
    const d = dayOfYear(fd);
    const dist = Math.min(Math.abs(d - today), yearLen - Math.abs(d - today));
    if (dist < bestDist) {
      bestDist = dist;
      best = f;
    }
  }
  return { festival: best, distanceDays: bestDist };
}

// =====================================================================
// Context-aware orientation question bank
// =====================================================================

export function buildContextOrientationItems(now = new Date()) {
  const { festival, distanceDays } = nearestFestival(now);
  const hour = now.getHours();
  const items = [
    {
      id: "festival_now",
      domain: "orientation",
      prompt: `Which festival is closest to today's date?`,
      options: [
        festival.shortName,
        FESTIVALS.find((f) => f.id !== festival.id).shortName,
        FESTIVALS.find((f) => f.id !== festival.id && f.id !== "vesak").shortName,
        "I'm not sure",
      ].filter((v, i, a) => a.indexOf(v) === i).slice(0, 4),
      correctIdx: 0,
      hint: `we're about ${distanceDays} days away`,
    },
    {
      id: "lunch_time",
      domain: "orientation",
      prompt: "What time do most people in Sri Lanka usually have lunch?",
      options: ["Around 7 AM", "Around 12 noon", "Around 5 PM", "Around 9 PM"],
      correctIdx: 1,
    },
    {
      id: "monsoon",
      domain: "orientation",
      prompt: "Which monsoon brings rain to Colombo around May–September?",
      options: [
        "South-West monsoon",
        "North-East monsoon",
        "Trade winds from the East",
        "There is no monsoon in Sri Lanka",
      ],
      correctIdx: 0,
    },
    {
      id: "currency",
      domain: "orientation",
      prompt: "What currency is used in Sri Lanka?",
      options: [
        "Sri Lankan Rupee (LKR)",
        "Indian Rupee (INR)",
        "US Dollar (USD)",
        "Euro (EUR)",
      ],
      correctIdx: 0,
    },
    {
      id: "now_period",
      domain: "orientation",
      prompt: "Right now, is it morning, afternoon, evening, or night?",
      options: ["Morning", "Afternoon", "Evening", "Night"],
      correctIdx: hour < 12 ? 0 : hour < 17 ? 1 : hour < 20 ? 2 : 3,
    },
  ];
  return items;
}

// =====================================================================
// Adaptive memory word lists (Sri Lankan everyday objects)
// =====================================================================

export const MEMORY_WORD_BANK = {
  easy: ["MANGO", "BUS", "TEMPLE"],
  medium: ["KOTTU", "TUK-TUK", "COCONUT", "RICE", "TEA"],
  hard: ["PARIPPU", "ELEPHANT", "POL-SAMBOL", "BO-TREE", "PAGODA", "BANANA", "HOPPER"],
};

// =====================================================================
// Pola (market) memory game
// =====================================================================

export const MARKET_ITEMS = [
  { id: "fish", emoji: "🐟", name: "Fish" },
  { id: "rice", emoji: "🌾", name: "Rice" },
  { id: "coconut", emoji: "🥥", name: "Coconut" },
  { id: "chili", emoji: "🌶️", name: "Chili" },
  { id: "banana", emoji: "🍌", name: "Banana" },
  { id: "mango", emoji: "🥭", name: "Mango" },
  { id: "onion", emoji: "🧅", name: "Onion" },
  { id: "lime", emoji: "🍋", name: "Lime" },
  { id: "egg", emoji: "🥚", name: "Egg" },
  { id: "bread", emoji: "🥖", name: "Bread" },
  { id: "tea", emoji: "🍵", name: "Tea" },
  { id: "pumpkin", emoji: "🎃", name: "Pumpkin" },
];

/** Pick `count` items from `MARKET_ITEMS` deterministically. */
export function pickMarketItems(count, seed = Date.now()) {
  const arr = MARKET_ITEMS.slice();
  // Fisher–Yates with seeded RNG.
  let s = seed >>> 0;
  function rand() {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  }
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, count);
}

// =====================================================================
// Bus route logic puzzles
// =====================================================================

export const BUS_ROUTES = [
  {
    id: "col_kandy",
    label: "Colombo → Kandy",
    sequence: ["Colombo", "Kadawatha", "Nittambuwa", "Kurunegala", "Kandy"],
  },
  {
    id: "col_galle",
    label: "Colombo → Galle",
    sequence: ["Colombo", "Moratuwa", "Panadura", "Kalutara", "Galle"],
  },
  {
    id: "col_jaffna",
    label: "Colombo → Jaffna",
    sequence: ["Colombo", "Anuradhapura", "Vavuniya", "Kilinochchi", "Jaffna"],
  },
  {
    id: "kandy_nuwara",
    label: "Kandy → Nuwara Eliya",
    sequence: ["Kandy", "Peradeniya", "Gampola", "Pussellawa", "Nuwara Eliya"],
  },
];

/** Pick a route and produce a "what's next?" question. */
export function buildBusRouteItem(seed = Date.now()) {
  const route = BUS_ROUTES[seed % BUS_ROUTES.length];
  const cutIdx = 1 + (seed % (route.sequence.length - 2));
  const correct = route.sequence[cutIdx];
  const otherTowns = BUS_ROUTES
    .filter((r) => r.id !== route.id)
    .map((r) => r.sequence[r.sequence.length - 1]);
  const distractors = otherTowns
    .filter((t) => t !== correct)
    .slice(0, 2);
  const options = shuffleSeeded([correct, ...distractors, "I don't know"], seed + 7);
  return {
    id: `bus_${route.id}_${cutIdx}`,
    domain: "language",
    prompt: `If you take a bus from ${route.sequence[0]} to ${
      route.sequence[route.sequence.length - 1]
    }, what stop comes after ${route.sequence[cutIdx - 1]}?`,
    options,
    correctIdx: options.indexOf(correct),
    route: route.id,
  };
}

function shuffleSeeded(arr, seed) {
  const a = arr.slice();
  let s = seed >>> 0;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// =====================================================================
// Attention game: select all fruits
// =====================================================================

export const ATTENTION_GAME_ITEMS = [
  { id: "mango", emoji: "🥭", label: "Mango", isFruit: true },
  { id: "rice", emoji: "🌾", label: "Rice", isFruit: false },
  { id: "banana", emoji: "🍌", label: "Banana", isFruit: true },
  { id: "tuk", emoji: "🛺", label: "Tuk-Tuk", isFruit: false },
  { id: "papaya", emoji: "🍈", label: "Papaya", isFruit: true },
  { id: "temple", emoji: "🏯", label: "Temple", isFruit: false },
  { id: "pineapple", emoji: "🍍", label: "Pineapple", isFruit: true },
  { id: "bus", emoji: "🚌", label: "Bus", isFruit: false },
  { id: "watermelon", emoji: "🍉", label: "Watermelon", isFruit: true },
  { id: "fish", emoji: "🐟", label: "Fish", isFruit: false },
  { id: "coconut", emoji: "🥥", label: "Coconut", isFruit: true },
  { id: "elephant", emoji: "🐘", label: "Elephant", isFruit: false },
];

// =====================================================================
// Festival ↔ symbol matching pairs
// =====================================================================

export function buildFestivalMatchPairs() {
  const subset = FESTIVALS.filter((f) =>
    ["avurudu", "vesak", "deepavali", "christmas"].includes(f.id)
  );
  return subset.map((f) => ({
    id: f.id,
    festival: f.shortName,
    symbol: f.symbol,
    emoji: f.emoji,
  }));
}

// =====================================================================
// Conversation prompts (life-story task)
// =====================================================================

export const LIFE_STORY_PROMPTS = [
  "Tell me about your childhood — where you grew up, who lived with you, and what games you played.",
  "Describe your morning routine. What do you do from when you wake up until lunchtime?",
  "Tell me about the work you used to do or what you do every day. What did you enjoy most?",
  "Describe the last big festival or family gathering you attended. Who was there and what did you eat?",
  "Tell me about a journey or trip that you remember well. Where did you go and how did you feel?",
];
