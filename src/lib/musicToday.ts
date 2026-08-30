import type { MusicTrack } from "./musicStorage";
import {
  cycleMusicRepeat,
  getMusicPlayerSnapshot,
  playMusicAdHocQueue,
  toggleMusicShuffle,
} from "./musicPlayer";
import {
  getCachedMusicArtistDNA,
  getCachedMusicSongDNA,
} from "./musicIntelligenceCache";
import { hydrateMusicIntelligenceCache } from "./musicIntelligenceEnrichment";

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
  if (tags.includes("Sore") || tags.includes("Tired")) return `${energy} · ${motion} · ${weight}`;
  return `${energy} · ${motion} · ${tone}`;
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

function artistText(track: MusicTrack) {
  return (track.artist || "").trim().toLowerCase();
}

function includesAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

type TrackDNA = TodayVector & {
  aggression: number;
  atmospheric: number;
  reflective: number;
  relaxing: number;
  upbeat: number;
};

type ArtistDNA = Partial<TrackDNA>;

const ARTIST_DNA: Record<string, ArtistDNA> = {
  "pink floyd": { energy: 38, heavy: 20, melodic: 82, dark: 43, drive: 28, bright: 50, focus: 84, aggression: 8, atmospheric: 97, reflective: 96, relaxing: 84, upbeat: 22 },
  "porcupine tree": { energy: 50, heavy: 42, melodic: 82, dark: 56, drive: 45, bright: 42, focus: 86, aggression: 22, atmospheric: 94, reflective: 88, relaxing: 66, upbeat: 24 },
  "u2": { energy: 58, heavy: 28, melodic: 78, dark: 31, drive: 58, bright: 69, focus: 70, aggression: 19, atmospheric: 74, reflective: 67, relaxing: 55, upbeat: 61 },
  "breaking benjamin": { energy: 73, heavy: 73, melodic: 69, dark: 61, drive: 73, bright: 36, focus: 62, aggression: 61, atmospheric: 54, reflective: 50, relaxing: 22, upbeat: 28 },
  "three days grace": { energy: 80, heavy: 70, melodic: 64, dark: 55, drive: 82, bright: 42, focus: 58, aggression: 69, atmospheric: 39, reflective: 42, relaxing: 15, upbeat: 35 },
  "limp bizkit": { energy: 90, heavy: 79, melodic: 45, dark: 44, drive: 92, bright: 55, focus: 43, aggression: 84, atmospheric: 24, reflective: 18, relaxing: 7, upbeat: 61 },
  "papa roach": { energy: 83, heavy: 73, melodic: 61, dark: 52, drive: 85, bright: 46, focus: 54, aggression: 74, atmospheric: 31, reflective: 39, relaxing: 12, upbeat: 43 },
  "sleep theory": { energy: 82, heavy: 70, melodic: 72, dark: 48, drive: 84, bright: 48, focus: 59, aggression: 65, atmospheric: 44, reflective: 41, relaxing: 15, upbeat: 45 },
  "i prevail": { energy: 87, heavy: 83, melodic: 66, dark: 59, drive: 88, bright: 37, focus: 55, aggression: 80, atmospheric: 38, reflective: 37, relaxing: 9, upbeat: 31 },
  "slipknot": { energy: 94, heavy: 96, melodic: 43, dark: 82, drive: 94, bright: 18, focus: 44, aggression: 97, atmospheric: 31, reflective: 25, relaxing: 3, upbeat: 12 },
  "metallica": { energy: 84, heavy: 84, melodic: 68, dark: 55, drive: 84, bright: 43, focus: 61, aggression: 74, atmospheric: 44, reflective: 46, relaxing: 16, upbeat: 38 },
  "alice in chains": { energy: 61, heavy: 72, melodic: 70, dark: 78, drive: 54, bright: 20, focus: 67, aggression: 52, atmospheric: 73, reflective: 76, relaxing: 34, upbeat: 11 },
  "nirvana": { energy: 72, heavy: 61, melodic: 63, dark: 55, drive: 72, bright: 39, focus: 52, aggression: 62, atmospheric: 43, reflective: 50, relaxing: 25, upbeat: 32 },
  "oasis": { energy: 63, heavy: 35, melodic: 82, dark: 28, drive: 64, bright: 72, focus: 61, aggression: 26, atmospheric: 56, reflective: 52, relaxing: 52, upbeat: 70 },
  "weezer": { energy: 69, heavy: 39, melodic: 82, dark: 24, drive: 71, bright: 78, focus: 56, aggression: 27, atmospheric: 38, reflective: 43, relaxing: 45, upbeat: 79 },
  "aerosmith": { energy: 72, heavy: 47, melodic: 75, dark: 29, drive: 75, bright: 67, focus: 56, aggression: 42, atmospheric: 35, reflective: 39, relaxing: 34, upbeat: 67 },
  "adema": { energy: 79, heavy: 75, melodic: 58, dark: 66, drive: 79, bright: 30, focus: 51, aggression: 72, atmospheric: 38, reflective: 39, relaxing: 12, upbeat: 20 },
  "adrenaline mob": { energy: 88, heavy: 88, melodic: 64, dark: 51, drive: 88, bright: 39, focus: 57, aggression: 82, atmospheric: 30, reflective: 29, relaxing: 7, upbeat: 30 },
  "beartooth": { energy: 89, heavy: 84, melodic: 66, dark: 48, drive: 91, bright: 45, focus: 57, aggression: 84, atmospheric: 29, reflective: 35, relaxing: 6, upbeat: 41 },
  "gemini syndrome": { energy: 80, heavy: 78, melodic: 68, dark: 65, drive: 80, bright: 30, focus: 60, aggression: 69, atmospheric: 51, reflective: 48, relaxing: 15, upbeat: 20 },
  "scar the martyr": { energy: 86, heavy: 88, melodic: 57, dark: 70, drive: 87, bright: 24, focus: 52, aggression: 84, atmospheric: 39, reflective: 32, relaxing: 6, upbeat: 14 },
  "my darkest days": { energy: 77, heavy: 59, melodic: 73, dark: 48, drive: 78, bright: 48, focus: 55, aggression: 54, atmospheric: 39, reflective: 45, relaxing: 23, upbeat: 47 },
  "the devil wears prada": { energy: 91, heavy: 92, melodic: 57, dark: 68, drive: 91, bright: 26, focus: 51, aggression: 90, atmospheric: 36, reflective: 31, relaxing: 4, upbeat: 15 },
};

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function numericFrom(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function readDeepNumber(track: MusicTrack, names: string[]) {
  const root = track as unknown as Record<string, unknown>;
  const sources = [
    root,
    recordOf(root.song_dna),
    recordOf(root.music_dna),
    recordOf(root.audio_features),
    recordOf(root.intelligence),
    recordOf(root.audio_analysis),
  ].filter(Boolean) as Array<Record<string, unknown>>;
  for (const source of sources) {
    for (const name of names) {
      const value = numericFrom(source[name]);
      if (value != null) return clamp(value <= 1 ? value * 100 : value);
    }
  }
  return null;
}

function externalSongDNA(track: MusicTrack): Partial<TrackDNA> {
  const cached = getCachedMusicSongDNA(track.id);
  const cachedResult: Partial<TrackDNA> = cached ? {
    energy: cached.energy, heavy: cached.heaviness, melodic: cached.melodic, dark: cached.darkness, drive: cached.drive, bright: cached.brightness, focus: cached.focus,
    aggression: cached.aggression, atmospheric: cached.atmospheric, reflective: cached.reflective, relaxing: cached.relaxing, upbeat: cached.upbeat,
  } : {};
  const map: Array<[keyof TrackDNA, string[]]> = [
    ["energy", ["energy", "energy_score"]],
    ["heavy", ["heavy", "heaviness", "heaviness_score"]],
    ["melodic", ["melodic", "melody", "melodic_score"]],
    ["dark", ["dark", "darkness", "darkness_score"]],
    ["drive", ["drive", "driving", "drive_score"]],
    ["bright", ["bright", "brightness", "brightness_score"]],
    ["focus", ["focus", "focused", "focus_score"]],
    ["aggression", ["aggression", "aggressive", "aggression_score"]],
    ["atmospheric", ["atmospheric", "atmosphere", "atmospheric_score"]],
    ["reflective", ["reflective", "reflection", "reflective_score"]],
    ["relaxing", ["relaxing", "relaxed", "calm", "calm_score"]],
    ["upbeat", ["upbeat", "uplifting", "upbeat_score"]],
  ];
  const result: Partial<TrackDNA> = { ...cachedResult };
  for (const [key, names] of map) {
    const value = readDeepNumber(track, names);
    if (value != null && result[key] == null) result[key] = value;
  }
  return result;
}

function genericArtistDNA(track: MusicTrack): ArtistDNA {
  const genre = `${track.genre || ""} ${track.album || ""}`.toLowerCase();
  const profile: ArtistDNA = {};
  if (includesAny(genre, ["psychedelic", "progressive rock", "art rock", "post-rock", "ambient"])) Object.assign(profile, { atmospheric: 86, reflective: 82, relaxing: 67, aggression: 20, drive: 42, melodic: 78 });
  if (includesAny(genre, ["soft rock", "adult contemporary", "acoustic", "singer-songwriter", "ballad"])) Object.assign(profile, { energy: 38, heavy: 18, drive: 34, aggression: 12, relaxing: 82, melodic: 80, reflective: 72 });
  if (includesAny(genre, ["metalcore", "deathcore", "hardcore", "nu metal", "industrial metal", "thrash", "heavy metal"])) Object.assign(profile, { energy: 87, heavy: 88, drive: 88, aggression: 84, relaxing: 8, atmospheric: 32 });
  if (includesAny(genre, ["hard rock", "post-grunge", "alternative metal"])) Object.assign(profile, { energy: 77, heavy: 68, drive: 78, aggression: 62, relaxing: 20, melodic: 64 });
  if (includesAny(genre, ["alternative rock", "indie rock"])) Object.assign(profile, { energy: 61, heavy: 37, drive: 59, aggression: 31, melodic: 76, reflective: 58, atmospheric: 57 });
  if (includesAny(genre, ["pop punk", "punk rock"])) Object.assign(profile, { energy: 82, drive: 87, bright: 72, upbeat: 78, aggression: 54, relaxing: 12 });
  return profile;
}

function artistDNA(track: MusicTrack): ArtistDNA {
  const generic = genericArtistDNA(track);
  const known = ARTIST_DNA[artistText(track)];
  const cached = getCachedMusicArtistDNA(track.artist);
  const persisted: ArtistDNA = cached ? {
    energy: cached.energy, heavy: cached.heaviness, melodic: cached.melodic, dark: cached.darkness, drive: cached.drive, bright: cached.brightness, focus: cached.focus,
    aggression: cached.aggression, atmospheric: cached.atmospheric, reflective: cached.reflective, relaxing: cached.relaxing, upbeat: cached.upbeat,
  } : {};
  if (Object.keys(persisted).length) return { ...generic, ...known, ...persisted };
  return known ? { ...generic, ...known } : generic;
}

function blendDNA(base: TrackDNA, source: Partial<TrackDNA>, amount: number) {
  const mix = Math.max(0, Math.min(1, amount));
  const next = { ...base };
  (Object.keys(source) as Array<keyof TrackDNA>).forEach((key) => {
    const value = source[key];
    if (typeof value === "number") next[key] = clamp(next[key] * (1 - mix) + value * mix);
  });
  return next;
}

function staticTrackDNA(track: MusicTrack): TrackDNA {
  const text = trackText(track);
  const energy = track.energy_level === "high" ? 88 : track.energy_level === "medium" ? 61 : 34;

  let heavy = 30 + (energy - 50) * 0.34;
  if (includesAny(text, ["metalcore", "deathcore", "nu metal", "industrial", "hard rock", "hardcore", "thrash", "metal", "grunge"])) heavy += 29;
  if (includesAny(text, ["acoustic", "unplugged", "soft rock", "ambient", "ballad", "psychedelic"])) heavy -= 20;

  let melodic = 54;
  if (includesAny(text, ["melodic", "alternative", "post-grunge", "anthem", "aor", "acoustic", "ballad", "power metal", "emo", "progressive", "psychedelic", "rock"])) melodic += 17;
  if (includesAny(text, ["deathcore", "grind", "noise", "hardcore punk"])) melodic -= 13;

  let dark = 35;
  if (includesAny(text, ["dark", "doom", "goth", "industrial", "death", "grave", "pain", "dead", "black", "night", "shadow", "ghost", "haunt", "blood"])) dark += 28;
  if (includesAny(text, ["sun", "light", "bright", "summer", "happy", "alive", "heaven"])) dark -= 14;

  let drive = energy * 0.76 + 9;
  if (includesAny(text, ["punk", "thrash", "speed", "hardcore", "metalcore", "drum and bass", "edm"])) drive += 16;
  if (includesAny(text, ["ambient", "acoustic", "ballad", "slow", "sleep", "psychedelic"])) drive -= 20;

  let bright = 61 - dark * 0.34 + melodic * 0.22;
  if (includesAny(text, ["upbeat", "pop punk", "anthem", "major", "party", "summer"])) bright += 15;
  if (includesAny(text, ["doom", "goth", "industrial", "black metal"])) bright -= 16;

  let focus = 57 + (drive - 50) * 0.12;
  if (includesAny(text, ["instrumental", "ambient", "progressive", "post-rock", "psychedelic"])) focus += 14;
  if (includesAny(text, ["party", "comedy", "novelty", "live"])) focus -= 8;

  let aggression = heavy * 0.52 + energy * 0.28 + drive * 0.16 - 18;
  if (includesAny(text, ["metalcore", "deathcore", "hardcore", "thrash", "nu metal", "industrial", "rage", "angry"])) aggression += 18;
  if (includesAny(text, ["ambient", "acoustic", "ballad", "soft", "mellow", "psychedelic"])) aggression -= 18;

  let atmospheric = 38;
  if (includesAny(text, ["ambient", "progressive", "psychedelic", "post-rock", "dream", "space", "atmospheric", "instrumental"])) atmospheric += 38;
  if (includesAny(text, ["hardcore", "punk", "party", "rap metal"])) atmospheric -= 12;

  let reflective = 42;
  if (includesAny(text, ["progressive", "psychedelic", "acoustic", "ballad", "ambient", "melancholy", "memory", "time", "dream"])) reflective += 30;
  if (includesAny(text, ["party", "hardcore", "rage", "dance"])) reflective -= 14;

  let relaxing = 74 - energy * 0.42 - aggression * 0.30 - drive * 0.18 + atmospheric * 0.25;
  if (includesAny(text, ["ambient", "acoustic", "ballad", "mellow", "slow", "soft", "psychedelic"])) relaxing += 18;

  let upbeat = energy * 0.34 + bright * 0.46 + drive * 0.20;
  if (includesAny(text, ["party", "upbeat", "happy", "summer", "pop punk", "dance"])) upbeat += 18;
  if (includesAny(text, ["doom", "dark", "melancholy", "ambient"])) upbeat -= 12;

  let dna: TrackDNA = {
    energy: clamp(energy), heavy: clamp(heavy), melodic: clamp(melodic), dark: clamp(dark), drive: clamp(drive), bright: clamp(bright), focus: clamp(focus),
    aggression: clamp(aggression), atmospheric: clamp(atmospheric), reflective: clamp(reflective), relaxing: clamp(relaxing), upbeat: clamp(upbeat),
  };

  const artist = artistDNA(track);
  const knownArtist = Boolean(ARTIST_DNA[artistText(track)]);
  dna = blendDNA(dna, artist, knownArtist ? 0.46 : 0.28);

  const persisted = externalSongDNA(track);
  if (Object.keys(persisted).length) dna = blendDNA(dna, persisted, 0.94);
  return dna;
}

function staticTrackVector(track: MusicTrack): TodayVector {
  const dna = staticTrackDNA(track);
  return { energy: dna.energy, heavy: dna.heavy, melodic: dna.melodic, dark: dna.dark, drive: dna.drive, bright: dna.bright, focus: dna.focus };
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
    ["energy", 1.7], ["drive", 1.7], ["melodic", 1.05], ["heavy", 1.12], ["dark", 0.95], ["bright", 0.82], ["focus", 0.9],
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

function strictCompatibility(target: TodayVector, dna: TrackDNA, relaxation = 0) {
  const slack = relaxation * 7;
  const calmTarget = target.energy <= 50 || target.drive <= 48;
  const veryCalmTarget = target.energy <= 42 && target.drive <= 44;
  const lightTarget = target.heavy <= 45;
  const aggressionLimit = clamp(12 + target.heavy * 0.30 + target.energy * 0.12 + target.drive * 0.08 + slack);

  // Hard mood gates stay strict even when the candidate pool is small.
  // A calm/tired request must never "relax" far enough to admit an obviously
  // aggressive, upbeat or high-drive song.
  if (veryCalmTarget && dna.energy > 58 + Math.min(5, slack)) return false;
  if (veryCalmTarget && dna.drive > 58 + Math.min(5, slack)) return false;
  if (veryCalmTarget && dna.aggression > 46 + Math.min(4, slack)) return false;
  if (veryCalmTarget && dna.upbeat > 65 + Math.min(4, slack)) return false;
  if (veryCalmTarget && dna.relaxing < 32 - Math.min(4, slack)) return false;

  if (calmTarget && dna.energy > 68 + Math.min(7, slack)) return false;
  if (calmTarget && dna.drive > 70 + Math.min(7, slack)) return false;
  if (calmTarget && dna.aggression > Math.max(56, aggressionLimit)) return false;
  if (calmTarget && dna.upbeat > 78 + Math.min(4, slack)) return false;

  if (lightTarget && dna.heavy > 68 + slack) return false;
  if (target.dark <= 40 && dna.dark > 82 + slack) return false;
  if (target.bright >= 70 && dna.bright < 24 - slack) return false;
  return true;
}

function moodAffinity(target: TodayVector, dna: TrackDNA) {
  let bonus = 0;
  if (target.energy <= 48) bonus += dna.relaxing * 0.10 + dna.atmospheric * 0.05 + dna.reflective * 0.05 - dna.aggression * 0.10 - dna.upbeat * 0.05;
  if (target.focus >= 72) bonus += dna.focus * 0.04 + dna.atmospheric * 0.03;
  if (target.melodic >= 68) bonus += dna.melodic * 0.05;
  if (target.dark >= 65) bonus += dna.dark * 0.04;
  return bonus;
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
  const prepared = unique.map((track) => ({ track, dna: staticTrackDNA(track) }));
  let eligible = prepared.filter(({ dna }) => strictCompatibility(target, dna, 0));
  if (eligible.length < Math.min(12, prepared.length)) eligible = prepared.filter(({ dna }) => strictCompatibility(target, dna, 1));
  if (eligible.length < Math.min(8, prepared.length)) eligible = prepared.filter(({ dna }) => strictCompatibility(target, dna, 2));
  if (!eligible.length) {
    const calmTarget = target.energy <= 50 || target.drive <= 48;
    eligible = calmTarget
      ? prepared.filter(({ dna }) => dna.energy <= 72 && dna.drive <= 74 && dna.aggression <= 60 && dna.upbeat <= 80)
      : prepared;
  }

  const ranked = eligible
    .map(({ track, dna }) => {
      const distance = vectorDistance(target, dna);
      const stable = hashUnit(`${prompt}|${revision}|${track.id}`);
      const jitter = surpriseStrength > 0 ? stable * 26 * surpriseStrength : stable * 0.9;
      const currentPenalty = currentTrackId && track.id === currentTrackId ? 160 : 0;
      const score = 100 - distance + moodAffinity(target, dna) + jitter - currentPenalty;
      return { track, score };
    })
    .sort((left, right) => right.score - left.score)
    .map((item) => item.track);

  return diversifyArtists(ranked).slice(0, Math.min(MAX_QUEUE_SIZE, ranked.length));
}

function compactQueueName(tags: string[]) {
  const label = tags.slice(0, 3).join(" + ");
  return `${QUEUE_PREFIX}${label || "Balanced"}`;
}

export function ensureMusicTodayPlaybackMode() {
  if (getMusicPlayerSnapshot().shuffle) toggleMusicShuffle();
  let guard = 0;
  while (getMusicPlayerSnapshot().repeat !== "off" && guard < 3) {
    cycleMusicRepeat();
    guard += 1;
  }
}

async function startQueue(next: MusicTodayContext, surpriseStrength = 0, excludeCurrent = false) {
  const player = getMusicPlayerSnapshot();
  const library = player.libraryTracks;
  if (!library.length) throw new Error("Your music library is empty.");

  // R44: hydrate persisted Song DNA / Artist DNA before ranking. The cache keeps
  // this fast after the first read and the database remains authoritative.
  await hydrateMusicIntelligenceCache(library).catch(() => undefined);

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
    direction: describeDirection(clampVector(target), state.tags),
    reply: `${label} applied. I rebuilt Today around that direction and switched to the strongest new match.`,
    revision: state.revision + 1,
    updatedAt: Date.now(),
  };

  void startQueue(next, surpriseStrength, true).catch(() => undefined);
  return true;
}
