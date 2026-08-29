export const MUSIC_TODAY_CONTEXT_EVENT = "mvp:music-today-context-changed";
export const MUSIC_TODAY_CONTEXT_STORAGE_KEY = "mvp_music_today_context_v1";

export type MusicTodayRadioMode =
  | "more_like_this"
  | "harder"
  | "heavier"
  | "faster"
  | "melodic";

export type MusicTodayContext = {
  version: 1;
  dateKey: string;
  rawInput: string;
  moodTags: string[];
  bodyTags: string[];
  intentTags: string[];
  directionTags: string[];
  summary: string;
  response: string;
  directionLabel: string;
  radioMode: MusicTodayRadioMode;
  updatedAt: number;
};

type DirectionScores = {
  harder: number;
  heavier: number;
  faster: number;
  melodic: number;
  darker: number;
  familiar: number;
  surprise: number;
  steady: number;
  gentle: number;
};

type SignalDefinition = {
  tag: string;
  patterns: RegExp[];
  score?: Partial<DirectionScores>;
};

const MOOD_SIGNALS: SignalDefinition[] = [
  { tag: "Motivated", patterns: [/\bmotivated\b/i, /\bready\b/i, /\bdriven\b/i, /\bdetermined\b/i, /\bfocused\b/i], score: { harder: 2, faster: 1, steady: 2 } },
  { tag: "Relaxed", patterns: [/\brelax(?:ed|ing)?\b/i, /\bcalm\b/i, /\bchill\b/i, /\bpeaceful\b/i, /\bmellow\b/i], score: { melodic: 3, steady: 2, gentle: 2 } },
  { tag: "Tired", patterns: [/\btired\b/i, /\bexhausted\b/i, /\bdrained\b/i, /\bfatigued\b/i, /\bworn out\b/i, /\bno energy\b/i, /\blow energy\b/i], score: { melodic: 2, familiar: 2, steady: 2, gentle: 2, faster: -2 } },
  { tag: "Stressed", patterns: [/\bstress(?:ed|ful)?\b/i, /\boverwhelm(?:ed|ing)?\b/i, /\btense\b/i, /\bpressure\b/i], score: { melodic: 3, familiar: 3, steady: 2, surprise: -1 } },
  { tag: "Anxious", patterns: [/\banxious\b/i, /\banxiety\b/i, /\bnervous\b/i, /\bon edge\b/i], score: { melodic: 3, familiar: 3, steady: 3, gentle: 1, surprise: -2 } },
  { tag: "Frustrated", patterns: [/\bfrustrated\b/i, /\bannoyed\b/i, /\birritated\b/i, /\bmad\b/i, /\bangry\b/i, /\bpissed\b/i], score: { harder: 3, heavier: 4, darker: 2 } },
  { tag: "Happy", patterns: [/\bhappy\b/i, /\bgreat\b/i, /\bawesome\b/i, /\bexcited\b/i, /\bupbeat\b/i, /\bpositive\b/i], score: { faster: 3, harder: 1, melodic: 1 } },
  { tag: "Low", patterns: [/\bsad\b/i, /\bdown\b/i, /\bblue\b/i, /\blow mood\b/i, /\bdepressed\b/i, /\bgloomy\b/i], score: { darker: 3, melodic: 3, familiar: 2, steady: 2 } },
  { tag: "Restless", patterns: [/\brestless\b/i, /\bantsy\b/i, /\bbored\b/i], score: { surprise: 3, faster: 2, harder: 1 } },
  { tag: "Confident", patterns: [/\bconfident\b/i, /\bstrong\b/i, /\bpowerful\b/i], score: { harder: 3, heavier: 2, faster: 1 } },
  { tag: "Rainy Day", patterns: [/\brain(?:y|ing)?\b/i, /\bstorm(?:y|ing)?\b/i, /\bgray day\b/i, /\bgrey day\b/i], score: { darker: 3, melodic: 2, steady: 1 } },
];

const BODY_SIGNALS: SignalDefinition[] = [
  { tag: "Sore", patterns: [/\bsore\b/i, /\baching\b/i, /\bachy\b/i, /\bstiff\b/i], score: { steady: 3, gentle: 2, faster: -1 } },
  { tag: "Injury Aware", patterns: [/\binjur(?:y|ed)\b/i, /\bhurt\b/i, /\bpain\b/i, /\bstrain(?:ed)?\b/i], score: { steady: 4, gentle: 3, faster: -2, surprise: -1 } },
  { tag: "Fresh", patterns: [/\bfresh\b/i, /\brecovered\b/i, /\brested\b/i, /\bfeel good\b/i], score: { harder: 2, faster: 2 } },
];

const INTENT_SIGNALS: SignalDefinition[] = [
  { tag: "Harder", patterns: [/\bharder\b/i, /\bgo hard\b/i, /\bmore intense\b/i], score: { harder: 7 } },
  { tag: "Heavier", patterns: [/\bheavier\b/i, /\bheavy\b/i, /\bmore heavy\b/i, /\bstay heavy\b/i, /\bcrush(?:ing)?\b/i], score: { heavier: 7 } },
  { tag: "Faster", patterns: [/\bfaster\b/i, /\bmore tempo\b/i, /\bpick up the pace\b/i, /\bmore energy\b/i], score: { faster: 7 } },
  { tag: "More Melodic", patterns: [/\bmore melodic\b/i, /\bmelodic\b/i, /\bmore melody\b/i], score: { melodic: 7 } },
  { tag: "Darker", patterns: [/\bdarker\b/i, /\bdark vibe\b/i, /\bmoody\b/i], score: { darker: 7 } },
  { tag: "Familiar", patterns: [/\bold favorites?\b/i, /\bfavorites?\b/i, /\bfamiliar\b/i, /\bstuff i know\b/i, /\bcomfort music\b/i], score: { familiar: 7, surprise: -3 } },
  { tag: "Surprise Me", patterns: [/\bsurprise me\b/i, /\bsomething different\b/i, /\bdeep cuts?\b/i, /\bforgotten\b/i], score: { surprise: 7 } },
  { tag: "Like This", patterns: [/\bmore like this\b/i, /\blike this\b/i, /\bsame vibe\b/i, /\bkeep this vibe\b/i], score: { familiar: 3, steady: 3 } },
  { tag: "Easy", patterns: [/\btake it easy\b/i, /\beasy today\b/i, /\blighter\b/i, /\bnot too hard\b/i], score: { gentle: 6, steady: 4, harder: -3, heavier: -2, faster: -2 } },
];

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function cleanTagList(values: string[], max: number) {
  return Array.from(new Set(values)).slice(0, max);
}

function blankScores(): DirectionScores {
  return { harder: 0, heavier: 0, faster: 0, melodic: 0, darker: 0, familiar: 0, surprise: 0, steady: 0, gentle: 0 };
}

function applySignals(input: string, definitions: SignalDefinition[], scores: DirectionScores) {
  const tags: string[] = [];
  for (const definition of definitions) {
    if (!definition.patterns.some((pattern) => pattern.test(input))) continue;
    tags.push(definition.tag);
    if (!definition.score) continue;
    for (const [key, value] of Object.entries(definition.score) as Array<[keyof DirectionScores, number]>) {
      scores[key] += value;
    }
  }
  return tags;
}

function phraseJoin(items: string[]) {
  if (!items.length) return "your current mood";
  if (items.length === 1) return items[0].toLowerCase();
  if (items.length === 2) return `${items[0].toLowerCase()} and ${items[1].toLowerCase()}`;
  return `${items.slice(0, -1).map((item) => item.toLowerCase()).join(", ")}, and ${items[items.length - 1].toLowerCase()}`;
}

function directionFromScores(scores: DirectionScores) {
  const positive: Array<[keyof DirectionScores, number]> = (Object.entries(scores) as Array<[keyof DirectionScores, number]>)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1]);

  const primary = positive[0]?.[0] ?? "steady";
  const tags: string[] = [];
  const push = (label: string) => { if (!tags.includes(label)) tags.push(label); };

  for (const [key] of positive) {
    if (key === "harder") push("Harder drive");
    if (key === "heavier") push("Heavier edge");
    if (key === "faster") push("More pace");
    if (key === "melodic") push("More melodic");
    if (key === "darker") push("Darker tone");
    if (key === "familiar") push("Familiar favorites");
    if (key === "surprise") push("Fresh discovery");
    if (key === "steady") push("Controlled flow");
    if (key === "gentle") push("Lower intensity");
    if (tags.length >= 3) break;
  }

  let radioMode: MusicTodayRadioMode = "more_like_this";
  if (primary === "heavier" || (scores.heavier >= scores.harder && scores.heavier >= 3)) radioMode = "heavier";
  else if (primary === "harder" || scores.harder >= 3) radioMode = "harder";
  else if (primary === "faster" || scores.faster >= 3) radioMode = "faster";
  else if (primary === "melodic" || scores.melodic >= 3 || scores.darker >= 4 || scores.gentle >= 4) radioMode = "melodic";

  if (!tags.length) tags.push("Taste matched", "Controlled flow");
  return { tags, radioMode };
}

function responseFor(feelingTags: string[], intentTags: string[], directionTags: string[], scores: DirectionScores) {
  const feeling = phraseJoin(feelingTags.slice(0, 3));
  const direction = directionTags.map((tag) => tag.toLowerCase()).join(", ");
  const cautious = scores.gentle >= 4 || scores.steady >= 5;
  const energetic = scores.harder >= 4 || scores.heavier >= 4 || scores.faster >= 4;

  if (!feelingTags.length && intentTags.length) {
    return `Got it. I’ll steer today’s queue toward ${direction}, using your current song, likes and listening history as the anchor. This changes today’s direction without rewriting your long-term taste.`;
  }
  if (cautious && energetic) {
    return `Got it. You’re ${feeling}, so I’ll keep the music motivating without making the flow feel frantic. I’ll steer the next tracks toward ${direction} and keep today’s adjustment separate from your long-term taste.`;
  }
  if (cautious) {
    return `Got it. You’re ${feeling}. I’ll smooth out today’s rotation with ${direction}, while still staying inside the music you actually like. This only changes today’s steering.`;
  }
  if (energetic) {
    return `Got it. You’re ${feeling}. I’ll push today’s queue toward ${direction} and use your likes, listening history and current song as the anchor.`;
  }
  return `Got it. I’ll shape today’s queue around ${feeling}, with ${direction}. Your permanent taste profile stays intact, and you can change this anytime.`;
}

export function parseMusicTodayInput(rawInput: string): MusicTodayContext {
  const input = rawInput.trim().replace(/\s+/g, " ");
  const scores = blankScores();
  const moodTags = applySignals(input, MOOD_SIGNALS, scores);
  const bodyTags = applySignals(input, BODY_SIGNALS, scores);
  const intentTags = applySignals(input, INTENT_SIGNALS, scores);

  if (!moodTags.length && !bodyTags.length && !intentTags.length) {
    scores.steady += 2;
    scores.familiar += 1;
  }

  if (/\bbut\b/i.test(input) && /\bmotivated\b|\bready\b|\bfocused\b/i.test(input)) {
    scores.steady += 1;
    scores.harder += 1;
  }
  if (/\brelax/i.test(input) && /\bmotivated\b|\bready\b/i.test(input)) {
    scores.melodic += 1;
    scores.harder += 1;
  }

  const combinedTags = cleanTagList([...bodyTags, ...moodTags, ...intentTags], 5);
  const direction = directionFromScores(scores);
  let directionTags = [...direction.tags];
  const explicitPush = intentTags.some((tag) => tag === "Harder" || tag === "Heavier" || tag === "Faster");
  const cautiousBody = bodyTags.some((tag) => tag === "Sore" || tag === "Injury Aware") || moodTags.some((tag) => tag === "Tired" || tag === "Stressed" || tag === "Anxious");
  const radioMode = cautiousBody && !explicitPush && (direction.radioMode === "harder" || direction.radioMode === "faster") ? "melodic" : direction.radioMode;
  if (cautiousBody && !explicitPush && radioMode === "melodic") {
    directionTags = directionTags.filter((tag) => tag !== "Harder drive" && tag !== "More pace");
    if (!directionTags.includes("More melodic")) directionTags.push("More melodic");
    directionTags = directionTags.slice(0, 3);
  }
  const summaryTags = combinedTags.length ? combinedTags : ["Adaptive"];
  const summary = summaryTags.slice(0, 3).join(" • ");
  const directionLabel = directionTags.join(" • ");

  return {
    version: 1,
    dateKey: localDateKey(),
    rawInput: input,
    moodTags: cleanTagList(moodTags, 4),
    bodyTags: cleanTagList(bodyTags, 3),
    intentTags: cleanTagList(intentTags, 4),
    directionTags: cleanTagList(directionTags, 3),
    summary,
    response: responseFor(cleanTagList([...bodyTags, ...moodTags], 4), intentTags, directionTags, scores),
    directionLabel,
    radioMode,
    updatedAt: Date.now(),
  };
}

export function readMusicTodayContext(): MusicTodayContext | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(MUSIC_TODAY_CONTEXT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MusicTodayContext;
    if (!parsed || parsed.version !== 1 || parsed.dateKey !== localDateKey()) {
      window.localStorage.removeItem(MUSIC_TODAY_CONTEXT_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveMusicTodayContext(context: MusicTodayContext) {
  if (typeof window === "undefined") return context;
  try { window.localStorage.setItem(MUSIC_TODAY_CONTEXT_STORAGE_KEY, JSON.stringify(context)); } catch { /* best effort */ }
  window.dispatchEvent(new CustomEvent(MUSIC_TODAY_CONTEXT_EVENT, { detail: context }));
  return context;
}

export function clearMusicTodayContext() {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(MUSIC_TODAY_CONTEXT_STORAGE_KEY); } catch { /* best effort */ }
  window.dispatchEvent(new CustomEvent(MUSIC_TODAY_CONTEXT_EVENT, { detail: null }));
}

export function subscribeMusicTodayContext(listener: (context: MusicTodayContext | null) => void) {
  if (typeof window === "undefined") return () => undefined;
  const onChange = () => listener(readMusicTodayContext());
  const onStorage = (event: StorageEvent) => {
    if (event.key === MUSIC_TODAY_CONTEXT_STORAGE_KEY) onChange();
  };
  window.addEventListener(MUSIC_TODAY_CONTEXT_EVENT, onChange as EventListener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(MUSIC_TODAY_CONTEXT_EVENT, onChange as EventListener);
    window.removeEventListener("storage", onStorage);
  };
}
