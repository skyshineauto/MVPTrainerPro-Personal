import type { MusicTrack } from "./musicStorage";
import {
  cycleMusicRepeat,
  getMusicPlayerSnapshot,
  playMusicAdHocQueue,
  toggleMusicShuffle,
} from "./musicPlayer";

export type MusicTodaySteering =
  | "harder"
  | "heavier"
  | "faster"
  | "more_like_this"
  | "melodic"
  | "darker"
  | "surprise";

type TodayVector = {
  energy: number;
  heavy: number;
  melodic: number;
  dark: number;
  drive: number;
  bright: number;
  focus: number;
};

export type MusicTodayContext = {
  active: boolean;
  prompt: string;
  tags: string[];
  direction: string;
  reply: string;
  queueName: string;
  queueSize: number;
  target: TodayVector;
  revision: number;
  updatedAt: number;
};

const STORAGE_KEY = "mvp_music_today_v2";
const QUEUE_PREFIX = "MVP Today · ";
const MAX_QUEUE_SIZE = 48;
const listeners = new Set<() => void>();

const EMPTY_CONTEXT: MusicTodayContext = {
  active: false,
  prompt: "",
  tags: [],
  direction: "",
  reply: "",
  queueName: "",
  queueSize: 0,
  target: {
    energy: 60,
    heavy: 48,
    melodic: 58,
    dark: 38,
    drive: 60,
    bright: 58,
    focus: 62,
  },
  revision: 0,
  updatedAt: 0,
};

let state: MusicTodayContext = readStoredContext();

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function clampVector(vector: TodayVector): TodayVector {
  return {
    energy: clamp(vector.energy),
    heavy: clamp(vector.heavy),
    melodic: clamp(vector.melodic),
    dark: clamp(vector.dark),
    drive: clamp(vector.drive),
    bright: clamp(vector.bright),
    focus: clamp(vector.focus),
  };
}

function readStoredContext(): MusicTodayContext {
  if (typeof window === "undefined") return EMPTY_CONTEXT;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_CONTEXT;
    const parsed = JSON.parse(raw) as Partial<MusicTodayContext>;
    if (!parsed.prompt || !parsed.target) return EMPTY_CONTEXT;
    return {
      ...EMPTY_CONTEXT,
      ...parsed,
      active: false,
      target: clampVector({ ...EMPTY_CONTEXT.target, ...parsed.target }),
      tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 4) : [],
    };
  } catch {
    return EMPTY_CONTEXT;
  }
}

function writeStoredContext(next: MusicTodayContext) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Today context is convenience state only. Playback remains authoritative.
  }
}

function emit(next: MusicTodayContext) {
  state = next;
  writeStoredContext(next);
  listeners.forEach((listener) => listener());
}

export function subscribeMusicToday(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getMusicTodaySnapshot() {
  return state;
}

export function isMusicTodayQueueName(value: string | null | undefined) {
  return Boolean(value?.startsWith(QUEUE_PREFIX));
}

function normalized(value: string) {
  return ` ${value.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9+\-\s']/g, " ").replace(/\s+/g, " ").trim()} `;
}

function has(text: string, terms: string[]) {
  return terms.some((term) => text.includes(` ${term} `) || text.includes(` ${term}s `));
}

function hasPhrase(text: string, phrases: string[]) {
  return phrases.some((phrase) => text.includes(phrase));
}

type MoodRule = {
  tag: string;
  terms: string[];
  phrases?: string[];
  delta: Partial<TodayVector>;
};

const MOOD_RULES: MoodRule[] = [
  {
    tag: "Relaxed",
    terms: ["relaxed", "relaxing", "relax", "calm", "peaceful", "chill", "mellow", "easygoing", "unwound", "unwind"],
    phrases: ["stress free", "stress-free", "at ease", "laid back", "laid-back"],
    delta: { energy: -20, heavy: -12, melodic: 15, dark: -14, drive: -14, bright: 12, focus: 7 },
  },
  {
    tag: "Clear",
    terms: ["clear", "centered", "centred", "present", "sharp"],
    phrases: ["clear minded", "clear-minded", "clear head", "clear headed", "clear-headed"],
    delta: { energy: -2, melodic: 5, dark: -10, drive: 6, bright: 13, focus: 28 },
  },
  {
    tag: "Focused",
    terms: ["focused", "focus", "concentrated", "locked", "dialed", "dialled", "productive"],
    phrases: ["locked in", "dialed in", "dialled in", "in the zone"],
    delta: { energy: 5, drive: 15, bright: 6, focus: 30 },
  },
  {
    tag: "Motivated",
    terms: ["motivated", "motivation", "driven", "determined", "ready", "ambitious", "confident", "purposeful"],
    phrases: ["ready to go", "feel good", "feeling good"],
    delta: { energy: 14, heavy: 4, melodic: 3, drive: 23, bright: 10, focus: 10 },
  },
  {
    tag: "Energized",
    terms: ["energized", "energetic", "amped", "hyped", "excited", "pumped", "wired", "charged"],
    delta: { energy: 27, heavy: 9, drive: 27, bright: 11 },
  },
  {
    tag: "Powerful",
    terms: ["powerful", "strong", "intense", "hard", "harder", "aggressive", "ferocious", "fierce"],
    delta: { energy: 20, heavy: 24, dark: 8, drive: 20 },
  },
  {
    tag: "Angry",
    terms: ["angry", "mad", "pissed", "furious", "rage", "raging", "frustrated"],
    delta: { energy: 27, heavy: 31, melodic: -10, dark: 18, drive: 27, bright: -19, focus: 4 },
  },
  {
    tag: "Dark",
    terms: ["dark", "brooding", "moody", "sinister", "grim", "haunting"],
    delta: { energy: 2, heavy: 10, melodic: 4, dark: 31, bright: -27 },
  },
  {
    tag: "Upbeat",
    terms: ["happy", "upbeat", "positive", "bright", "cheerful", "great", "joyful", "optimistic"],
    delta: { energy: 17, melodic: 14, dark: -24, drive: 11, bright: 29 },
  },
  {
    tag: "Low",
    terms: ["sad", "down", "low", "blue", "melancholy", "melancholic", "heartbroken"],
    delta: { energy: -18, heavy: -3, melodic: 14, dark: 24, drive: -13, bright: -23, focus: -4 },
  },
  {
    tag: "Tired",
    terms: ["tired", "exhausted", "drained", "sleepy", "fatigued", "worn", "spent"],
    phrases: ["worn out", "burned out", "burnt out"],
    delta: { energy: -24, heavy: -13, drive: -23, bright: -5, focus: -13 },
  },
  {
    tag: "Sore",
    terms: ["sore", "aching", "achy", "stiff", "tender", "recovery", "recovering"],
    phrases: ["beat up", "banged up"],
    delta: { energy: -14, heavy: -15, melodic: 9, dark: -3, drive: -11, bright: 4, focus: 4 },
  },
  {
    tag: "Stressed",
    terms: ["stressed", "anxious", "tense", "overwhelmed", "restless", "nervous"],
    delta: { energy: 5, heavy: -5, melodic: 10, dark: 9, drive: -4, bright: -7, focus: -16 },
  },
  {
    tag: "Melodic",
    terms: ["melodic", "melody", "emotional", "soaring", "anthemic"],
    delta: { melodic: 28, heavy: -4, bright: 8 },
  },
  {
    tag: "Heavy",
    terms: ["heavy", "heavier", "brutal", "crushing", "metal"],
    delta: { energy: 12, heavy: 30, dark: 10, drive: 12, bright: -8 },
  },
  {
    tag: "Fast",
    terms: ["fast", "faster", "quick", "speedy", "speed"],
    delta: { energy: 15, drive: 30 },
  },
  {
    tag: "Slow",
    terms: ["slow", "slower", "gentle", "soft"],
    delta: { energy: -19, heavy: -15, melodic: 9, drive: -24 },
  },
];

const NEGATED_PHRASES: Array<[string, string]> = [
  ["not tired", "Tired"],
  ["not stressed", "Stressed"],
  ["not anxious", "Stressed"],
  ["not angry", "Angry"],
  ["not sad", "Low"],
  ["stress free", "Stressed"],
  ["stress-free", "Stressed"],
];

function addDelta(vector: TodayVector, delta: Partial<TodayVector>) {
  const next = { ...vector };
  (Object.keys(delta) as Array<keyof TodayVector>).forEach((key) => {
    next[key] = clamp(next[key] + Number(delta[key] || 0));
  });
  return next;
}

function fallbackTags(raw: string) {
  const stop = new Set([
    "i", "im", "i'm", "am", "feel", "feeling", "today", "right", "now", "very", "really", "pretty", "just", "a", "an", "the", "and", "but", "or", "from", "with", "of", "to", "for", "my", "me", "like", "kind", "sort", "little",
  ]);
  const words = raw
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3 && !stop.has(word));
  return [...new Set(words)].slice(0, 3).map((word) => word.charAt(0).toUpperCase() + word.slice(1));
}

function interpretPrompt(rawPrompt: string) {
  const prompt = rawPrompt.trim().replace(/\s+/g, " ");
  const text = normalized(prompt);
  let target = { ...EMPTY_CONTEXT.target };
  const matchedTags: Array<{ tag: string; position: number }> = [];
  const negated = new Set(
    NEGATED_PHRASES.filter(([phrase]) => text.includes(phrase)).map(([, tag]) => tag),
  );

  for (const rule of MOOD_RULES) {
    const matched = has(text, rule.terms) || Boolean(rule.phrases && hasPhrase(text, rule.phrases));
    if (!matched || negated.has(rule.tag)) continue;
    target = addDelta(target, rule.delta);
    const positions = [
      ...rule.terms.map((term) => text.indexOf(` ${term} `)),
      ...(rule.phrases || []).map((phrase) => text.indexOf(phrase)),
    ].filter((value) => value >= 0);
    const position = positions.length ? Math.min(...positions) : Number.MAX_SAFE_INTEGER;
    if (!matchedTags.some((item) => item.tag === rule.tag)) matchedTags.push({ tag: rule.tag, position });
  }

  if (text.includes("stress free") || text.includes("stress-free") || text.includes("not stressed")) {
    target = addDelta(target, { energy: -8, dark: -10, drive: 3, bright: 13, focus: 10 });
  }

  if (text.includes("not tired")) {
    target = addDelta(target, { energy: 10, drive: 10, focus: 7 });
  }

  const orderedTags = matchedTags.sort((left, right) => left.position - right.position).map((item) => item.tag);
  const finalTags = (orderedTags.length ? orderedTags : fallbackTags(prompt)).slice(0, 4);
  const safeTags = finalTags.length ? finalTags : ["Balanced"];
  const direction = describeDirection(target, safeTags);
  const reply = buildReply(safeTags, target);

  return { prompt, tags: safeTags, target: clampVector(target), direction, reply };
}

function describeDirection(target: TodayVector, tags: string[]) {
  const energy = target.energy >= 74 ? "high energy" : target.energy <= 45 ? "lower energy" : "controlled energy";
  const weight = target.heavy >= 72 ? "heavy edge" : target.melodic >= 72 ? "melodic lift" : "balanced weight";
  const motion = target.drive >= 75 ? "strong drive" : target.drive <= 44 ? "easy pacing" : "steady drive";
  const tone = target.dark >= 67 ? "darker tone" : target.bright >= 70 ? "brighter tone" : "neutral tone";
  const focus = target.focus >= 75 ? "focused flow" : "open flow";
  if (tags.includes("Sore") || tags.includes("Tired")) return `${energy} · ${motion} · ${weight} · ${focus}`;
  return `${energy} · ${motion} · ${weight} · ${tone}`;
}

function buildReply(tags: string[], target: TodayVector) {
  const label = tags.slice(0, 3).join(", ").toLowerCase();
  const pace = target.drive >= 76 ? "strong forward drive" : target.drive <= 44 ? "an easier pace" : "steady forward motion";
  const texture = target.heavy >= 74 ? "a heavier edge" : target.melodic >= 72 ? "more melody" : "balanced weight";
  return `Got it. I’m matching ${label} with ${pace} and ${texture}. I built a fresh Today queue from what you told me and started the strongest match.`;
}

function trackText(track: MusicTrack) {
  return `${track.title || ""} ${track.album || ""} ${track.genre || ""}`.toLowerCase();
}

function includesAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

function staticTrackVector(track: MusicTrack): TodayVector {
  const text = trackText(track);
  const energy = track.energy_level === "high" ? 88 : track.energy_level === "medium" ? 62 : 36;

  let heavy = 32 + (energy - 50) * 0.38;
  if (includesAny(text, ["metalcore", "deathcore", "nu metal", "industrial", "hard rock", "hardcore", "thrash", "metal", "grunge"])) heavy += 30;
  if (includesAny(text, ["acoustic", "unplugged", "soft rock", "ambient", "ballad", "pop"])) heavy -= 18;

  let melodic = 52;
  if (includesAny(text, ["melodic", "alternative", "post-grunge", "anthem", "aor", "acoustic", "ballad", "power metal", "emo", "rock"])) melodic += 18;
  if (includesAny(text, ["deathcore", "grind", "noise", "hardcore punk"])) melodic -= 12;

  let dark = 36;
  if (includesAny(text, ["dark", "doom", "goth", "industrial", "death", "grave", "pain", "dead", "black", "night", "shadow", "ghost", "haunt", "blood"])) dark += 28;
  if (includesAny(text, ["sun", "light", "bright", "summer", "happy", "alive", "heaven"])) dark -= 14;

  let drive = energy * 0.78 + 10;
  if (includesAny(text, ["punk", "thrash", "speed", "hardcore", "metalcore", "drum and bass", "edm"])) drive += 15;
  if (includesAny(text, ["ambient", "acoustic", "ballad", "slow", "sleep"])) drive -= 18;

  let bright = 62 - dark * 0.36 + melodic * 0.22;
  if (includesAny(text, ["upbeat", "pop punk", "anthem", "major", "party", "summer"])) bright += 15;
  if (includesAny(text, ["doom", "goth", "industrial", "black metal"])) bright -= 16;

  let focus = 58 + (drive - 50) * 0.13;
  if (includesAny(text, ["instrumental", "ambient", "progressive", "post-rock"])) focus += 13;
  if (includesAny(text, ["party", "comedy", "novelty", "live"])) focus -= 8;

  return clampVector({ energy, heavy, melodic, dark, drive, bright, focus });
}

function hashUnit(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function vectorDistance(a: TodayVector, b: TodayVector) {
  const parts: Array<[keyof TodayVector, number]> = [
    ["energy", 1.45],
    ["drive", 1.45],
    ["melodic", 1.08],
    ["heavy", 1.02],
    ["dark", 1.02],
    ["bright", 0.84],
    ["focus", 0.9],
  ];
  const totalWeight = parts.reduce((sum, [, weight]) => sum + weight, 0);
  return parts.reduce((sum, [key, weight]) => sum + Math.abs(a[key] - b[key]) * weight, 0) / totalWeight;
}

function uniqueTracks(library: MusicTrack[]) {
  const seen = new Set<string>();
  return library.filter((track) => {
    if (!track?.id || seen.has(track.id)) return false;
    seen.add(track.id);
    return true;
  });
}

function diversifyArtists(ranked: MusicTrack[]) {
  if (ranked.length < 3) return ranked;
  const output: MusicTrack[] = [];
  const remaining = [...ranked];
  while (remaining.length) {
    const lastArtist = (output.at(-1)?.artist || "").trim().toLowerCase();
    let index = remaining.findIndex((track) => (track.artist || "").trim().toLowerCase() !== lastArtist);
    if (index < 0) index = 0;
    output.push(remaining.splice(index, 1)[0]);
  }
  return output;
}

function rankForToday(
  library: MusicTrack[],
  target: TodayVector,
  prompt: string,
  revision: number,
  currentTrackId: string | null,
  surpriseStrength = 0,
) {
  const unique = uniqueTracks(library);
  const ranked = unique
    .map((track) => {
      const dna = staticTrackVector(track);
      const distance = vectorDistance(target, dna);
      const stable = hashUnit(`${prompt}|${revision}|${track.id}`);
      const jitter = surpriseStrength > 0 ? stable * 32 * surpriseStrength : stable * 1.8;
      const currentPenalty = currentTrackId && track.id === currentTrackId ? 140 : 0;
      return { track, score: 100 - distance + jitter - currentPenalty };
    })
    .sort((left, right) => right.score - left.score)
    .map((item) => item.track);

  return diversifyArtists(ranked).slice(0, Math.min(MAX_QUEUE_SIZE, unique.length));
}

function compactQueueName(tags: string[]) {
  const label = tags.slice(0, 3).join(" + ");
  return `${QUEUE_PREFIX}${label || "Balanced"}`;
}

export function ensureMusicTodayPlaybackMode() {
  const player = getMusicPlayerSnapshot();
  if (player.shuffle) toggleMusicShuffle();

  const repeat = getMusicPlayerSnapshot().repeat;
  if (repeat === "off") {
    cycleMusicRepeat();
  } else if (repeat === "one") {
    cycleMusicRepeat();
    cycleMusicRepeat();
  }
}

async function startQueue(next: MusicTodayContext, surpriseStrength = 0, excludeCurrent = false) {
  const player = getMusicPlayerSnapshot();
  const library = player.libraryTracks;
  if (!library.length) throw new Error("Your music library is empty.");

  const currentTrackId = excludeCurrent ? player.currentTrack?.id || null : null;
  const queue = rankForToday(library, next.target, next.prompt, next.revision, currentTrackId, surpriseStrength);
  if (!queue.length) throw new Error("MVP could not build a Today queue from this library.");

  ensureMusicTodayPlaybackMode();
  const queueName = compactQueueName(next.tags);
  const ready = { ...next, active: true, queueName, queueSize: queue.length, updatedAt: Date.now() };
  emit(ready);
  await playMusicAdHocQueue(queueName, queue, queue[0].id);
  ensureMusicTodayPlaybackMode();
  return ready;
}

export async function activateMusicToday(rawPrompt: string) {
  const interpreted = interpretPrompt(rawPrompt);
  if (!interpreted.prompt) throw new Error("Tell MVP how you feel first.");

  const next: MusicTodayContext = {
    active: true,
    prompt: interpreted.prompt,
    tags: interpreted.tags,
    direction: interpreted.direction,
    reply: interpreted.reply,
    queueName: compactQueueName(interpreted.tags),
    queueSize: 0,
    target: interpreted.target,
    revision: state.revision + 1,
    updatedAt: Date.now(),
  };

  return startQueue(next, 0, false);
}

function blendTarget(base: TodayVector, source: TodayVector, amount: number): TodayVector {
  const mix = Math.max(0, Math.min(1, amount));
  const next = { ...base };
  (Object.keys(base) as Array<keyof TodayVector>).forEach((key) => {
    next[key] = clamp(base[key] * (1 - mix) + source[key] * mix);
  });
  return next;
}

function steeringTarget(base: TodayVector, mode: MusicTodaySteering) {
  if (mode === "harder") return addDelta(base, { energy: 15, heavy: 14, drive: 16, bright: -3 });
  if (mode === "heavier") return addDelta(base, { energy: 6, heavy: 24, drive: 7, dark: 4, bright: -6 });
  if (mode === "faster") return addDelta(base, { energy: 13, drive: 27, focus: 5 });
  if (mode === "melodic") return addDelta(base, { melodic: 27, heavy: -5, dark: -4, bright: 9 });
  if (mode === "darker") return addDelta(base, { dark: 27, heavy: 8, bright: -24 });
  return base;
}

export function steerMusicToday(rawMode: string) {
  if (!isMusicTodayQueueName(getMusicPlayerSnapshot().activePlaylistName)) return false;
  const mode = rawMode as MusicTodaySteering;
  if (!["harder", "heavier", "faster", "more_like_this", "melodic", "darker", "surprise"].includes(mode)) return false;

  const player = getMusicPlayerSnapshot();
  let target = state.target;
  let surpriseStrength = 0;

  if (mode === "more_like_this" && player.currentTrack) {
    target = blendTarget(target, staticTrackVector(player.currentTrack), 0.46);
  } else if (mode === "surprise") {
    surpriseStrength = 1;
    target = addDelta(target, { energy: 3, drive: 3 });
  } else {
    target = steeringTarget(target, mode);
  }

  const label =
    mode === "more_like_this" ? "Like This" :
    mode === "surprise" ? "Surprise" :
    mode.charAt(0).toUpperCase() + mode.slice(1);

  const next: MusicTodayContext = {
    ...state,
    active: true,
    target: clampVector(target),
    direction: `${state.direction} · ${label}`,
    reply: `${label} applied. I rebuilt Today around that direction and switched to the strongest new match.`,
    revision: state.revision + 1,
    updatedAt: Date.now(),
  };

  void startQueue(next, surpriseStrength, true).catch(() => undefined);
  return true;
}
