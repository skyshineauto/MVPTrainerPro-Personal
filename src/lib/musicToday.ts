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
  getCachedMusicTrackIntelligence,
} from "./musicIntelligenceCache";
import { hydrateMusicIntelligenceCache } from "./musicIntelligenceEnrichment";
import { supabase } from "./supabase";

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
  aggression: number;
  atmospheric: number;
  reflective: number;
  relaxing: number;
  uplifting: number;
  motivational: number;
  chaotic: number;
  upbeat: number;
  workoutFit: number;
  intensity: number;
};

type TodayConstraints = {
  min: Partial<Record<keyof TodayVector, number>>;
  max: Partial<Record<keyof TodayVector, number>>;
  bpmMin: number | null;
  bpmMax: number | null;
};

type TodayLibraryIntent = {
  decadeStart: number | null;
  decadeEnd: number | null;
  decadeLabel: string | null;
  styles: string[];
  styleLabels: string[];
  artistKeys: string[];
  artistLabels: string[];
  artistMode: "none" | "only" | "similar";
  directRequest: boolean;
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
  constraints: TodayConstraints;
  libraryIntent: TodayLibraryIntent;
  revision: number;
  updatedAt: number;
};

const LEGACY_STORAGE_KEY = "mvp_music_today_v2";
const QUEUE_PREFIX = "MVP Today · ";
const listeners = new Set<() => void>();

const EMPTY_CONSTRAINTS: TodayConstraints = {
  min: {},
  max: {},
  bpmMin: null,
  bpmMax: null,
};

const EMPTY_LIBRARY_INTENT: TodayLibraryIntent = {
  decadeStart: null,
  decadeEnd: null,
  decadeLabel: null,
  styles: [],
  styleLabels: [],
  artistKeys: [],
  artistLabels: [],
  artistMode: "none",
  directRequest: false,
};

const EMPTY_CONTEXT: MusicTodayContext = {
  active: false,
  prompt: "",
  tags: [],
  direction: "",
  reply: "",
  queueName: "",
  queueSize: 0,
  target: {
    energy: 58,
    heavy: 46,
    melodic: 60,
    dark: 40,
    drive: 58,
    bright: 56,
    focus: 62,
    aggression: 38,
    atmospheric: 50,
    reflective: 50,
    relaxing: 50,
    uplifting: 55,
    motivational: 56,
    chaotic: 34,
    upbeat: 55,
    workoutFit: 60,
    intensity: 55,
  },
  constraints: EMPTY_CONSTRAINTS,
  libraryIntent: EMPTY_LIBRARY_INTENT,
  revision: 0,
  updatedAt: 0,
};

function freshContext(): MusicTodayContext {
  return {
    ...EMPTY_CONTEXT,
    tags: [],
    target: { ...EMPTY_CONTEXT.target },
    constraints: { min: {}, max: {}, bpmMin: null, bpmMax: null },
    libraryIntent: { ...EMPTY_LIBRARY_INTENT, styles: [], styleLabels: [], artistKeys: [], artistLabels: [] },
  };
}

// AI Today is intentionally session-only. R50 removes the old localStorage
// behavior so a refresh, browser restart or new login never resurrects a
// previous emotional state. Persisted Song DNA / Artist DNA are unaffected.
function removeLegacyTodayPersistence() {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(LEGACY_STORAGE_KEY); } catch { /* optional cleanup */ }
}

removeLegacyTodayPersistence();
let state: MusicTodayContext = freshContext();
let activeAuthUserId: string | null = null;

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function clampVector(vector: TodayVector): TodayVector {
  const next = { ...vector };
  (Object.keys(next) as Array<keyof TodayVector>).forEach((key) => {
    next[key] = clamp(next[key]);
  });
  return next;
}

function emit(next: MusicTodayContext) {
  state = next;
  listeners.forEach((listener) => listener());
}

export function resetMusicTodaySession() {
  removeLegacyTodayPersistence();
  emit(freshContext());
}

if (typeof window !== "undefined") {
  // A full reload naturally creates a fresh module state. This listener covers
  // SPA logout/login transitions where the JavaScript module stays alive.
  supabase.auth.onAuthStateChange((event, session) => {
    const nextUserId = session?.user?.id || null;
    if (event === "SIGNED_OUT") {
      activeAuthUserId = null;
      resetMusicTodaySession();
      return;
    }
    if (event === "SIGNED_IN" && activeAuthUserId && nextUserId && activeAuthUserId !== nextUserId) {
      resetMusicTodaySession();
    }
    if (nextUserId) activeAuthUserId = nextUserId;
  });
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
  return ` ${value.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9+\s']/g, " ").replace(/\s+/g, " ").trim()} `;
}

type MoodRule = {
  tag: string;
  terms: string[];
  phrases?: string[];
  delta: Partial<TodayVector>;
};

// R50 uses a broad, compositional emotion lexicon instead of a handful of
// one-off mood buttons. Multiple emotions can coexist and modifiers such as
// "very", "slightly", "but", "not" and "without" change their strength.
const MOOD_RULES: MoodRule[] = [
  { tag: "Relaxed", terms: ["relaxed", "relaxing", "relax", "calm", "calming", "chill", "mellow", "easygoing", "unwound"], phrases: ["laid back", "at ease", "stress free"], delta: { energy: -22, heavy: -12, melodic: 12, drive: -20, aggression: -20, atmospheric: 12, reflective: 7, relaxing: 34, uplifting: 4, chaotic: -20, upbeat: -16, intensity: -24 } },
  { tag: "Peaceful", terms: ["peaceful", "serene", "tranquil", "settled", "grounded", "comfortable", "secure"], phrases: ["inner peace", "feel safe", "feeling safe"], delta: { energy: -17, heavy: -14, melodic: 13, dark: -12, drive: -18, bright: 9, focus: 8, aggression: -24, atmospheric: 18, reflective: 10, relaxing: 34, uplifting: 10, chaotic: -25, upbeat: -10, intensity: -22 } },
  { tag: "Content", terms: ["content", "contented", "satisfied", "fulfilled"], delta: { energy: -6, melodic: 8, dark: -12, drive: -4, bright: 17, focus: 7, aggression: -13, reflective: 10, relaxing: 18, uplifting: 21, chaotic: -12, upbeat: 10, intensity: -7 } },
  { tag: "Happy", terms: ["happy", "joyful", "joy", "cheerful", "positive", "optimistic", "delighted", "glad"], phrases: ["in a good mood", "feeling great"], delta: { energy: 16, melodic: 12, dark: -25, drive: 11, bright: 29, aggression: -10, relaxing: 4, uplifting: 36, motivational: 12, chaotic: -6, upbeat: 31, workoutFit: 8, intensity: 9 } },
  { tag: "Excited", terms: ["excited", "thrilled", "enthusiastic", "eager", "hyped", "amped", "buzzing"], delta: { energy: 29, drive: 29, bright: 19, focus: 3, aggression: 5, uplifting: 26, motivational: 19, chaotic: 8, upbeat: 25, workoutFit: 17, intensity: 27 } },
  { tag: "Energized", terms: ["energized", "energetic", "charged", "pumped", "fired", "wired"], phrases: ["full of energy", "ready to move"], delta: { energy: 35, heavy: 5, drive: 35, bright: 12, focus: 5, motivational: 26, upbeat: 16, workoutFit: 23, intensity: 31 } },
  { tag: "Motivated", terms: ["motivated", "motivation", "determined", "ambitious", "driven", "purposeful", "ready"], phrases: ["ready to go", "ready to train", "ready to lift", "want to train"], delta: { energy: 15, heavy: 4, drive: 31, bright: 10, focus: 17, motivational: 38, chaotic: -5, workoutFit: 28, intensity: 16 } },
  { tag: "Confident", terms: ["confident", "confidence", "bold", "fearless", "capable", "assured"], delta: { energy: 13, heavy: 5, drive: 21, bright: 16, focus: 16, aggression: 5, uplifting: 16, motivational: 22, chaotic: -8, workoutFit: 17, intensity: 10 } },
  { tag: "Focused", terms: ["focused", "focus", "concentrated", "productive", "sharp", "centered", "centred"], phrases: ["locked in", "dialed in", "dialled in", "in the zone", "clear minded", "clear headed"], delta: { energy: 4, melodic: 5, dark: -7, drive: 15, bright: 8, focus: 36, aggression: -5, atmospheric: 8, reflective: 6, motivational: 12, chaotic: -28, workoutFit: 12, intensity: 4 } },
  { tag: "Powerful", terms: ["powerful", "strong", "dominant", "unstoppable", "fierce", "ferocious"], phrases: ["feel strong", "feeling strong"], delta: { energy: 22, heavy: 24, dark: 7, drive: 24, focus: 7, aggression: 22, motivational: 22, upbeat: -4, workoutFit: 27, intensity: 24 } },
  { tag: "Aggressive", terms: ["aggressive", "brutal", "crushing", "savage", "violent"], phrases: ["go hard", "train hard", "lift heavy", "hit it hard"], delta: { energy: 25, heavy: 31, melodic: -8, dark: 14, drive: 27, bright: -13, aggression: 38, relaxing: -28, uplifting: -8, motivational: 19, chaotic: 13, upbeat: -8, workoutFit: 26, intensity: 34 } },
  { tag: "Angry", terms: ["angry", "mad", "furious", "rage", "raging", "pissed", "hostile", "irate", "resentful"], delta: { energy: 28, heavy: 29, melodic: -9, dark: 23, drive: 28, bright: -22, focus: 3, aggression: 40, reflective: -6, relaxing: -30, uplifting: -19, motivational: 10, chaotic: 17, upbeat: -18, workoutFit: 18, intensity: 35 } },
  { tag: "Frustrated", terms: ["frustrated", "annoyed", "irritated", "agitated", "impatient"], phrases: ["fed up"], delta: { energy: 17, heavy: 15, dark: 12, drive: 18, bright: -12, focus: -7, aggression: 24, relaxing: -20, uplifting: -12, motivational: 5, chaotic: 13, upbeat: -11, intensity: 21 } },
  { tag: "Stressed", terms: ["stressed", "tense", "pressure", "strained", "restless"], phrases: ["under pressure", "on edge"], delta: { energy: 7, heavy: -3, melodic: 8, dark: 10, drive: -2, bright: -8, focus: -20, aggression: 5, atmospheric: 8, reflective: 5, relaxing: -27, uplifting: -8, motivational: -4, chaotic: 25, upbeat: -9, intensity: 18 } },
  { tag: "Anxious", terms: ["anxious", "nervous", "worried", "uneasy", "apprehensive", "panicked", "fearful", "afraid", "scared"], delta: { energy: 7, heavy: -7, melodic: 10, dark: 13, drive: -6, bright: -10, focus: -25, aggression: -3, atmospheric: 11, reflective: 10, relaxing: -31, uplifting: -9, motivational: -8, chaotic: 28, upbeat: -12, intensity: 20 } },
  { tag: "Overwhelmed", terms: ["overwhelmed", "overloaded", "swamped", "frazzled"], phrases: ["too much", "can't handle", "cant handle"], delta: { energy: -7, heavy: -10, melodic: 10, dark: 10, drive: -13, bright: -8, focus: -31, aggression: -4, atmospheric: 13, reflective: 8, relaxing: -22, uplifting: -10, motivational: -17, chaotic: 31, upbeat: -15, intensity: 12 } },
  { tag: "Tired", terms: ["tired", "fatigued", "sleepy", "drained", "worn", "spent", "weary", "lazy", "sluggish", "lethargic"], phrases: ["worn out", "low energy"], delta: { energy: -32, heavy: -13, drive: -31, bright: -5, focus: -17, aggression: -14, atmospheric: 8, reflective: 8, relaxing: 22, uplifting: -7, motivational: -20, chaotic: -8, upbeat: -20, workoutFit: -21, intensity: -30 } },
  { tag: "Exhausted", terms: ["exhausted", "depleted", "wrecked"], phrases: ["burned out", "burnt out", "dead tired", "completely drained"], delta: { energy: -40, heavy: -18, drive: -39, bright: -8, focus: -23, aggression: -18, atmospheric: 10, reflective: 10, relaxing: 27, uplifting: -10, motivational: -28, chaotic: -10, upbeat: -24, workoutFit: -29, intensity: -38 } },
  { tag: "Sad", terms: ["sad", "down", "blue", "unhappy", "depressed", "melancholy", "melancholic", "sorrowful"], phrases: ["feeling low", "feeling down"], delta: { energy: -21, heavy: -3, melodic: 15, dark: 28, drive: -16, bright: -28, focus: -4, aggression: -6, atmospheric: 14, reflective: 29, relaxing: 5, uplifting: -31, motivational: -19, chaotic: -4, upbeat: -34, workoutFit: -13, intensity: -6 } },
  { tag: "Heartbroken", terms: ["heartbroken", "devastated", "grieving", "grief", "mourning"], phrases: ["broken heart", "miss someone", "lost someone"], delta: { energy: -25, heavy: 2, melodic: 20, dark: 36, drive: -22, bright: -35, focus: -8, aggression: -4, atmospheric: 22, reflective: 38, relaxing: 3, uplifting: -38, motivational: -28, chaotic: -3, upbeat: -40, workoutFit: -19, intensity: -7 } },
  { tag: "Lonely", terms: ["lonely", "alone", "isolated", "lonesome"], delta: { energy: -19, melodic: 17, dark: 23, drive: -15, bright: -23, focus: -4, aggression: -5, atmospheric: 22, reflective: 31, relaxing: 6, uplifting: -25, motivational: -17, upbeat: -28, intensity: -8 } },
  { tag: "Reflective", terms: ["reflective", "thoughtful", "introspective", "contemplative", "pensive"], phrases: ["deep in thought", "thinking about life"], delta: { energy: -10, melodic: 17, dark: 8, drive: -14, bright: -3, focus: 16, aggression: -14, atmospheric: 24, reflective: 38, relaxing: 13, uplifting: 2, motivational: -3, chaotic: -18, upbeat: -15, intensity: -12 } },
  { tag: "Nostalgic", terms: ["nostalgic", "nostalgia", "sentimental", "wistful"], phrases: ["miss the old days", "thinking back", "remembering when"], delta: { energy: -5, melodic: 20, dark: 7, drive: -9, bright: 3, focus: 9, aggression: -12, atmospheric: 27, reflective: 36, relaxing: 14, uplifting: 7, motivational: 0, chaotic: -16, upbeat: -3, intensity: -8 } },
  { tag: "Hopeful", terms: ["hopeful", "hope", "encouraged", "inspired"], phrases: ["looking forward", "things will get better"], delta: { energy: 8, melodic: 14, dark: -18, drive: 10, bright: 24, focus: 8, aggression: -8, atmospheric: 6, reflective: 12, relaxing: 4, uplifting: 31, motivational: 19, chaotic: -8, upbeat: 18, workoutFit: 9, intensity: 4 } },
  { tag: "Grateful", terms: ["grateful", "thankful", "appreciative", "blessed"], delta: { energy: 1, melodic: 14, dark: -15, drive: -2, bright: 22, focus: 7, aggression: -14, atmospheric: 13, reflective: 18, relaxing: 18, uplifting: 28, motivational: 8, chaotic: -15, upbeat: 13, intensity: -5 } },
  { tag: "Proud", terms: ["proud", "accomplished", "triumphant", "victorious"], delta: { energy: 15, heavy: 6, melodic: 7, dark: -12, drive: 21, bright: 20, focus: 13, aggression: 3, uplifting: 23, motivational: 25, chaotic: -6, upbeat: 19, workoutFit: 18, intensity: 13 } },
  { tag: "Playful", terms: ["playful", "carefree", "fun", "silly", "goofy", "lighthearted"], phrases: ["having fun"], delta: { energy: 18, heavy: -10, melodic: 10, dark: -23, drive: 15, bright: 27, focus: -9, aggression: -11, relaxing: 4, uplifting: 26, motivational: 3, chaotic: 9, upbeat: 32, workoutFit: 4, intensity: 7 } },
  { tag: "Rebellious", terms: ["rebellious", "defiant", "reckless", "wild", "rowdy"], delta: { energy: 22, heavy: 14, melodic: -4, dark: 7, drive: 24, bright: 2, focus: -7, aggression: 18, relaxing: -17, uplifting: 3, motivational: 8, chaotic: 18, upbeat: 8, workoutFit: 14, intensity: 23 } },
  { tag: "Romantic", terms: ["romantic", "loving", "affectionate", "tender", "intimate", "passionate"], phrases: ["in love", "feeling love"], delta: { energy: -5, heavy: -15, melodic: 27, dark: 2, drive: -12, bright: 10, focus: 2, aggression: -19, atmospheric: 28, reflective: 19, relaxing: 17, uplifting: 19, motivational: -3, chaotic: -17, upbeat: 4, intensity: -4 } },
  { tag: "Dreamy", terms: ["dreamy", "ethereal", "floaty", "spacey", "hypnotic"], phrases: ["lost in thought"], delta: { energy: -15, heavy: -17, melodic: 22, dark: 2, drive: -23, bright: 6, focus: 5, aggression: -22, atmospheric: 38, reflective: 21, relaxing: 24, uplifting: 9, motivational: -8, chaotic: -20, upbeat: -10, intensity: -18 } },
  { tag: "Curious", terms: ["curious", "interested", "intrigued", "fascinated", "wondering"], delta: { energy: 3, melodic: 5, drive: 4, bright: 7, focus: 22, aggression: -8, atmospheric: 11, reflective: 12, uplifting: 8, motivational: 11, chaotic: -8, intensity: 2 } },
  { tag: "Surprised", terms: ["surprised", "shocked", "astonished", "amazed", "startled"], delta: { energy: 11, drive: 8, bright: 6, focus: 3, atmospheric: 8, uplifting: 6, chaotic: 10, upbeat: 5, intensity: 17 } },
  { tag: "Bored", terms: ["bored", "uninterested", "understimulated"], delta: { energy: -15, drive: -22, bright: -5, focus: -17, aggression: -6, relaxing: 7, uplifting: -9, motivational: -27, chaotic: -5, upbeat: -12, workoutFit: -18, intensity: -17 } },
  { tag: "Apathetic", terms: ["apathetic", "indifferent", "unmotivated", "meh", "listless"], phrases: ["don't care", "dont care", "no motivation"], delta: { energy: -27, drive: -32, bright: -12, focus: -17, aggression: -12, reflective: 4, relaxing: 8, uplifting: -21, motivational: -38, chaotic: -8, upbeat: -20, workoutFit: -28, intensity: -26 } },
  { tag: "Numb", terms: ["numb", "empty", "emotionless", "detached", "hollow"], phrases: ["feel nothing", "feeling nothing"], delta: { energy: -28, heavy: -7, melodic: -2, dark: 8, drive: -29, bright: -18, focus: -12, aggression: -15, atmospheric: 13, reflective: 8, relaxing: 4, uplifting: -25, motivational: -31, chaotic: -14, upbeat: -26, workoutFit: -25, intensity: -29 } },
  { tag: "Insecure", terms: ["insecure", "self-conscious", "uncertain", "doubtful"], phrases: ["self conscious", "not confident"], delta: { energy: -7, dark: 11, drive: -12, bright: -10, focus: -15, aggression: -5, reflective: 17, relaxing: -6, uplifting: -12, motivational: -15, chaotic: 10, upbeat: -13, intensity: -3 } },
  { tag: "Jealous", terms: ["jealous", "envious", "envy"], delta: { energy: 3, dark: 21, drive: 3, bright: -18, focus: -5, aggression: 13, reflective: 12, relaxing: -13, uplifting: -20, motivational: -5, chaotic: 10, upbeat: -22, intensity: 11 } },
  { tag: "Guilty", terms: ["guilty", "ashamed", "shame", "regretful", "remorseful"], phrases: ["feel bad about", "wish i hadn't", "wish i hadnt"], delta: { energy: -12, melodic: 12, dark: 22, drive: -13, bright: -22, focus: -6, aggression: -9, atmospheric: 13, reflective: 31, relaxing: 0, uplifting: -26, motivational: -14, chaotic: 6, upbeat: -28, intensity: -8 } },
  { tag: "Disgusted", terms: ["disgusted", "repulsed", "grossed", "revolted", "contemptuous"], phrases: ["grossed out"], delta: { energy: 7, heavy: 10, dark: 17, drive: 8, bright: -20, aggression: 22, relaxing: -18, uplifting: -24, chaotic: 8, upbeat: -27, intensity: 17 } },
  { tag: "Sore", terms: ["sore", "aching", "achy", "stiff", "tender", "recovering", "recovery"], phrases: ["beat up", "banged up"], delta: { energy: -14, heavy: -17, melodic: 10, drive: -15, bright: 4, focus: 4, aggression: -12, atmospheric: 6, relaxing: 13, motivational: -4, chaotic: -8, workoutFit: -12, intensity: -15 } },
  { tag: "Heavy", terms: ["heavy", "heavier", "metal"], delta: { energy: 10, heavy: 31, dark: 10, drive: 12, aggression: 14, relaxing: -12, workoutFit: 12, intensity: 15 } },
  { tag: "Melodic", terms: ["melodic", "melody", "soaring", "anthemic"], phrases: ["more melody"], delta: { melodic: 31, heavy: -4, bright: 8, atmospheric: 5, uplifting: 7 } },
  { tag: "Fast", terms: ["fast", "faster", "quick", "speedy"], phrases: ["high tempo", "more tempo"], delta: { energy: 15, drive: 31, upbeat: 10, intensity: 17 } },
  { tag: "Upbeat", terms: ["upbeat", "bouncy", "lively"], phrases: ["high spirits"], delta: { energy: 16, melodic: 8, dark: -18, drive: 15, bright: 24, uplifting: 24, upbeat: 34, intensity: 8 } },
  { tag: "Slow", terms: ["slow", "slower", "gentle", "soft"], phrases: ["low tempo", "easy pace"], delta: { energy: -19, heavy: -15, melodic: 9, drive: -25, aggression: -12, relaxing: 17, upbeat: -12, intensity: -18 } },
  { tag: "Neutral", terms: ["neutral", "normal", "balanced", "okay", "fine"], phrases: ["nothing special", "feel normal"], delta: {} },
];

const INTENT_RULES: MoodRule[] = [
  { tag: "Energized", terms: [], phrases: ["wake me up", "get me going", "give me energy", "boost my energy", "pump me up", "fire me up", "pick up the pace"], delta: { energy: 38, drive: 36, bright: 12, motivational: 25, upbeat: 17, workoutFit: 23, intensity: 28 } },
  { tag: "Happy", terms: [], phrases: ["cheer me up", "lift me up", "brighten my mood", "make me feel better", "something uplifting", "need something uplifting", "uplifting music"], delta: { energy: 11, dark: -25, bright: 28, relaxing: 5, uplifting: 38, motivational: 10, upbeat: 26 } },
  { tag: "Relaxed", terms: [], phrases: ["calm me down", "help me relax", "settle me down", "take the edge off", "help me unwind", "something calming", "need something calming", "something relaxing", "calming music"], delta: { energy: -24, drive: -24, aggression: -25, relaxing: 39, chaotic: -29, intensity: -26 } },
  { tag: "Focused", terms: [], phrases: ["help me focus", "keep me focused", "lock me in", "help me concentrate"], delta: { drive: 12, focus: 39, chaotic: -31, motivational: 12 } },
  { tag: "Motivated", terms: [], phrases: ["push me", "get me motivated", "make me want to train", "get me through this workout"], delta: { energy: 18, drive: 32, focus: 13, motivational: 39, workoutFit: 31, intensity: 18 } },
];

function addDelta(vector: TodayVector, delta: Partial<TodayVector>, amount = 1) {
  const next = { ...vector };
  (Object.keys(delta) as Array<keyof TodayVector>).forEach((key) => {
    next[key] = clamp(next[key] + Number(delta[key] || 0) * amount);
  });
  return next;
}

function modifierWeight(prefix: string) {
  const tail = prefix.slice(-34);
  if (/(?:extremely|incredibly|completely|absolutely|totally|severely|super)\s*$/.test(tail)) return 1.55;
  if (/(?:very|really|so|highly|seriously|deeply)\s*$/.test(tail)) return 1.30;
  if (/(?:pretty|quite|fairly)\s*$/.test(tail)) return 1.14;
  if (/(?:slightly|somewhat|kinda|kind of|sort of|a little|a bit)\s*$/.test(tail)) return 0.58;
  return 1;
}

function isNegated(prefix: string) {
  const tail = prefix.slice(-36);
  return /(?:\bnot\b|\bno\b|\bnever\b|\bwithout\b|\bdont\b|\bdon't\b)(?:\s+too)?(?:\s+(?:very|really|that))?\s*$/.test(tail);
}

function contrastWeight(text: string, position: number) {
  const before = text.slice(0, position);
  const totalContrast = (text.match(/\b(?:but|however|though|although|yet)\b/g) || []).length;
  if (!totalContrast) return 1;
  const passed = (before.match(/\b(?:but|however|though|although|yet)\b/g) || []).length;
  return passed > 0 ? Math.min(1.36, 1.12 + passed * 0.08) : 0.90;
}

function findRuleMatch(text: string, rule: MoodRule) {
  const candidates = [...rule.terms, ...(rule.phrases || [])];
  let best: { position: number; phrase: string } | null = null;
  for (const phrase of candidates) {
    const needle = ` ${phrase} `;
    const position = text.indexOf(needle);
    if (position >= 0 && (!best || position < best.position)) best = { position, phrase };
  }
  return best;
}

function setMax(constraints: TodayConstraints, key: keyof TodayVector, value: number) {
  const current = constraints.max[key];
  constraints.max[key] = current == null ? clamp(value) : Math.min(current, clamp(value));
}

function setMin(constraints: TodayConstraints, key: keyof TodayVector, value: number) {
  const current = constraints.min[key];
  constraints.min[key] = current == null ? clamp(value) : Math.max(current, clamp(value));
}

function applyNegatedConcept(constraints: TodayConstraints, tag: string, text: string) {
  if (["Aggressive", "Angry", "Powerful"].includes(tag)) setMax(constraints, "aggression", text.includes("not too") ? 52 : 44);
  if (["Energized", "Excited", "Fast"].includes(tag)) {
    setMax(constraints, "energy", text.includes("not too") ? 68 : 58);
    setMax(constraints, "drive", text.includes("not too") ? 68 : 58);
    constraints.bpmMax = constraints.bpmMax == null ? 132 : Math.min(constraints.bpmMax, 132);
  }
  if (tag === "Heavy") setMax(constraints, "heavy", text.includes("not too") ? 62 : 52);
  if (tag === "Slow") {
    setMin(constraints, "drive", 48);
    constraints.bpmMin = constraints.bpmMin == null ? 88 : Math.max(constraints.bpmMin, 88);
  }
  if (["Tired", "Exhausted"].includes(tag)) {
    setMin(constraints, "energy", 48);
    setMin(constraints, "drive", 48);
  }
  if (["Sad", "Heartbroken"].includes(tag)) {
    setMax(constraints, "dark", 65);
    setMin(constraints, "uplifting", 40);
  }
  if (["Stressed", "Anxious", "Overwhelmed"].includes(tag)) {
    setMin(constraints, "relaxing", 42);
    setMax(constraints, "chaotic", 58);
  }
}

type LibraryStyleRule = {
  key: string;
  label: string;
  promptTerms: string[];
  matchTerms: string[];
  artistHints?: string[];
};

const LIBRARY_STYLE_RULES: LibraryStyleRule[] = [
  { key: "hair-metal", label: "Hair Metal", promptTerms: ["hair bands", "hair band", "hair metal", "glam metal", "glam rock", "sleaze rock"], matchTerms: ["hair metal", "glam metal", "glam rock", "sleaze rock"], artistHints: ["bon jovi", "def leppard", "motley crue", "mötley crüe", "poison", "ratt", "cinderella", "skid row", "warrant", "dokken", "twisted sister", "quiet riot", "whitesnake", "europe", "great white", "tesla", "slaughter", "firehouse", "l.a. guns", "la guns", "faster pussycat", "winger", "white lion", "kix", "extreme"] },
  { key: "grunge", label: "Grunge", promptTerms: ["grunge", "seattle sound"], matchTerms: ["grunge", "seattle sound"], artistHints: ["nirvana", "pearl jam", "soundgarden", "alice in chains", "mudhoney", "screaming trees", "temple of the dog", "mother love bone", "stone temple pilots", "hole"] },
  { key: "post-grunge", label: "Post-Grunge", promptTerms: ["post grunge", "post-grunge"], matchTerms: ["post grunge", "post-grunge"] },
  { key: "nu-metal", label: "Nu Metal", promptTerms: ["nu metal", "nu-metal"], matchTerms: ["nu metal", "nu-metal"] },
  { key: "metalcore", label: "Metalcore", promptTerms: ["metalcore"], matchTerms: ["metalcore"] },
  { key: "alternative-metal", label: "Alternative Metal", promptTerms: ["alternative metal"], matchTerms: ["alternative metal"] },
  { key: "hard-rock", label: "Hard Rock", promptTerms: ["hard rock"], matchTerms: ["hard rock"] },
  { key: "heavy-metal", label: "Heavy Metal", promptTerms: ["heavy metal"], matchTerms: ["heavy metal"] },
  { key: "thrash-metal", label: "Thrash Metal", promptTerms: ["thrash metal", "thrash"], matchTerms: ["thrash metal", "thrash"] },
  { key: "industrial-metal", label: "Industrial Metal", promptTerms: ["industrial metal"], matchTerms: ["industrial metal"] },
  { key: "deathcore", label: "Deathcore", promptTerms: ["deathcore"], matchTerms: ["deathcore"] },
  { key: "alternative-rock", label: "Alternative Rock", promptTerms: ["alternative rock", "alt rock"], matchTerms: ["alternative rock", "alt rock"] },
  { key: "classic-rock", label: "Classic Rock", promptTerms: ["classic rock"], matchTerms: ["classic rock"], artistHints: ["led zeppelin", "pink floyd", "the rolling stones", "rolling stones", "the who", "aerosmith", "queen", "fleetwood mac", "lynyrd skynyrd", "deep purple", "bad company", "foreigner", "boston", "journey", "heart", "cheap trick", "the doors", "creedence clearwater revival"] },
  { key: "progressive-rock", label: "Progressive Rock", promptTerms: ["progressive rock", "prog rock"], matchTerms: ["progressive rock", "prog rock"] },
  { key: "psychedelic-rock", label: "Psychedelic Rock", promptTerms: ["psychedelic rock", "psychedelic"], matchTerms: ["psychedelic rock", "psychedelic"] },
  { key: "punk-rock", label: "Punk Rock", promptTerms: ["punk rock", "punk"], matchTerms: ["punk rock", "punk"] },
  { key: "pop-punk", label: "Pop Punk", promptTerms: ["pop punk", "pop-punk"], matchTerms: ["pop punk", "pop-punk"] },
  { key: "soft-rock", label: "Soft Rock", promptTerms: ["soft rock"], matchTerms: ["soft rock"] },
  { key: "acoustic", label: "Acoustic", promptTerms: ["acoustic", "unplugged"], matchTerms: ["acoustic", "unplugged"] },
  { key: "ballad", label: "Ballads", promptTerms: ["ballads", "ballad", "power ballads", "power ballad"], matchTerms: ["ballad", "power ballad"] },
  { key: "pop", label: "Pop", promptTerms: ["pop music", "pop songs", "pop"], matchTerms: ["pop", "pop rock", "dance pop", "electropop", "synthpop"] },
  { key: "dance-pop", label: "Dance Pop", promptTerms: ["dance pop", "dance-pop"], matchTerms: ["dance pop", "dance-pop", "electropop"] },
  { key: "new-wave", label: "New Wave", promptTerms: ["new wave"], matchTerms: ["new wave", "synthpop", "synth pop"] },
  { key: "synthpop", label: "Synthpop", promptTerms: ["synthpop", "synth pop"], matchTerms: ["synthpop", "synth pop", "electropop"] },
  { key: "indie-rock", label: "Indie Rock", promptTerms: ["indie rock"], matchTerms: ["indie rock"] },
  { key: "emo", label: "Emo", promptTerms: ["emo"], matchTerms: ["emo", "emo rock", "emocore"] },
  { key: "country", label: "Country", promptTerms: ["country music", "country songs", "country"], matchTerms: ["country", "country rock", "alt country", "americana"] },
  { key: "folk", label: "Folk", promptTerms: ["folk music", "folk rock", "folk"], matchTerms: ["folk", "folk rock", "singer songwriter"] },
  { key: "blues", label: "Blues", promptTerms: ["blues rock", "blues"], matchTerms: ["blues", "blues rock"] },
  { key: "jazz", label: "Jazz", promptTerms: ["jazz"], matchTerms: ["jazz", "jazz rock", "fusion"] },
  { key: "soul", label: "Soul", promptTerms: ["soul music", "soul"], matchTerms: ["soul", "neo soul"] },
  { key: "funk", label: "Funk", promptTerms: ["funk music", "funk"], matchTerms: ["funk", "funk rock"] },
  { key: "disco", label: "Disco", promptTerms: ["disco"], matchTerms: ["disco"] },
  { key: "hip-hop", label: "Hip-Hop", promptTerms: ["hip hop", "hip-hop"], matchTerms: ["hip hop", "hip-hop", "rap"] },
  { key: "rap", label: "Rap", promptTerms: ["rap music", "rap"], matchTerms: ["rap", "hip hop", "hip-hop"] },
  { key: "r-and-b", label: "R&B", promptTerms: ["r&b", "r and b", "rhythm and blues"], matchTerms: ["r&b", "r and b", "rhythm and blues"] },
  { key: "electronic", label: "Electronic", promptTerms: ["electronic music", "electronic", "electronica"], matchTerms: ["electronic", "electronica", "edm"] },
  { key: "edm", label: "EDM", promptTerms: ["edm"], matchTerms: ["edm", "electronic dance"] },
  { key: "industrial", label: "Industrial", promptTerms: ["industrial music", "industrial rock", "industrial"], matchTerms: ["industrial", "industrial rock"] },
  { key: "reggae", label: "Reggae", promptTerms: ["reggae"], matchTerms: ["reggae"] },
  { key: "ska", label: "Ska", promptTerms: ["ska"], matchTerms: ["ska", "ska punk"] },
];

function decadeFromPrompt(rawPrompt: string) {
  const lower = rawPrompt.toLowerCase().replace(/[’]/g, "'");
  const wordDecades: Array<[RegExp, number]> = [
    [/\bsixties\b/, 1960], [/\bseventies\b/, 1970], [/\beighties\b/, 1980], [/\bnineties\b/, 1990],
    [/\btwo thousands\b|\b2000s\b/, 2000], [/\btwenty tens\b|\b2010s\b/, 2010], [/\btwenty twenties\b|\b2020s\b/, 2020],
  ];
  for (const [pattern, start] of wordDecades) {
    if (pattern.test(lower)) return { start, end: start + 9, label: `${String(start).slice(2)}s` };
  }
  const match = lower.match(/\b((?:19|20)?\d{2})\s*'?s\b/);
  if (!match) return null;
  const token = match[1];
  let start = Number(token);
  if (!Number.isFinite(start)) return null;
  if (token.length === 2) start += start >= 40 ? 1900 : 2000;
  start = Math.floor(start / 10) * 10;
  if (start < 1950 || start > 2030) return null;
  return { start, end: start + 9, label: `${String(start).slice(2)}s` };
}

function parseLibraryIntent(rawPrompt: string): TodayLibraryIntent {
  const text = normalized(rawPrompt);
  const decade = decadeFromPrompt(rawPrompt);
  const matched = LIBRARY_STYLE_RULES.filter((rule) => rule.promptTerms.some((term) => text.includes(` ${term} `)));
  const styles = [...new Set(matched.map((rule) => rule.key))];
  const styleLabels = [...new Set(matched.map((rule) => rule.label))];
  const directCue = /\b(?:play|hear|listen|put on|give me|queue|songs?|music|bands?|artists?|tracks?|all)\b/i.test(rawPrompt);
  const directRequest = Boolean(decade || styles.length) && (directCue || styles.length > 0 || Boolean(decade));
  return {
    decadeStart: decade?.start ?? null,
    decadeEnd: decade?.end ?? null,
    decadeLabel: decade?.label ?? null,
    styles,
    styleLabels,
    artistKeys: [],
    artistLabels: [],
    artistMode: "none",
    directRequest,
  };
}

function fallbackTags(raw: string) {
  const stop = new Set([
    "i", "im", "i'm", "am", "feel", "feeling", "today", "right", "now", "very", "really", "pretty", "just", "a", "an", "the", "and", "but", "or", "from", "with", "of", "to", "for", "my", "me", "like", "kind", "sort", "little", "something", "music", "want", "need",
  ]);
  const words = raw.toLowerCase().replace(/[^a-z0-9'\s-]/g, " ").split(/\s+/).map((word) => word.trim()).filter((word) => word.length >= 3 && !stop.has(word));
  return [...new Set(words)].slice(0, 3).map((word) => word.charAt(0).toUpperCase() + word.slice(1));
}

function inferHardConstraints(target: TodayVector, tags: string[], explicit: TodayConstraints): TodayConstraints {
  const constraints: TodayConstraints = {
    min: { ...explicit.min },
    max: { ...explicit.max },
    bpmMin: explicit.bpmMin,
    bpmMax: explicit.bpmMax,
  };
  const hasTag = (...values: string[]) => values.some((value) => tags.includes(value));

  const lowStateTag = hasTag("Tired", "Exhausted", "Relaxed", "Peaceful");
  if ((lowStateTag && target.energy <= 58 && target.drive <= 62) || (target.relaxing >= 72 && target.energy <= 48)) {
    const tired = hasTag("Tired");
    const exhausted = hasTag("Exhausted");
    setMax(constraints, "energy", exhausted ? 48 : tired ? 55 : 62);
    setMax(constraints, "drive", exhausted ? 46 : tired ? 52 : 60);
    setMax(constraints, "aggression", exhausted ? 38 : tired ? 44 : 50);
    setMax(constraints, "upbeat", exhausted ? 44 : tired ? 50 : 62);
    setMax(constraints, "intensity", exhausted ? 48 : tired ? 54 : 60);
    setMin(constraints, "relaxing", exhausted ? 48 : tired ? 42 : 34);
    const limit = exhausted ? 108 : tired ? 114 : 124;
    constraints.bpmMax = constraints.bpmMax == null ? limit : Math.min(constraints.bpmMax, limit);
  }

  if (hasTag("Energized", "Excited") || (target.energy >= 76 && target.drive >= 72)) {
    setMin(constraints, "energy", 55);
    setMin(constraints, "drive", 55);
    setMin(constraints, "intensity", 48);
    constraints.bpmMin = constraints.bpmMin == null ? 88 : Math.max(constraints.bpmMin, 88);
  }

  if (hasTag("Happy", "Playful") || target.uplifting >= 78 || target.upbeat >= 78) {
    setMin(constraints, "uplifting", 45);
    setMin(constraints, "bright", 42);
    setMin(constraints, "upbeat", 43);
    setMax(constraints, "dark", 70);
  }

  if (hasTag("Motivated", "Powerful") || target.motivational >= 78) {
    setMin(constraints, "drive", 54);
    setMin(constraints, "motivational", 45);
    setMin(constraints, "workoutFit", 42);
  }

  if (hasTag("Aggressive", "Angry") || target.aggression >= 76) {
    setMin(constraints, "energy", 55);
    setMin(constraints, "drive", 55);
    setMin(constraints, "aggression", 44);
    setMin(constraints, "intensity", 50);
  }

  if (hasTag("Focused")) setMax(constraints, "chaotic", 62);

  if (hasTag("Reflective", "Nostalgic", "Sad", "Heartbroken", "Lonely") && target.energy <= 58) {
    setMin(constraints, "reflective", 38);
    if (!hasTag("Hopeful", "Happy")) setMax(constraints, "upbeat", 72);
  }

  if (hasTag("Dreamy", "Peaceful") || target.atmospheric >= 78) setMin(constraints, "atmospheric", 38);

  // Resolve mixed-state conflicts around the final target rather than silently
  // dropping one of the user's emotions.
  for (const key of Object.keys(target) as Array<keyof TodayVector>) {
    const min = constraints.min[key];
    const max = constraints.max[key];
    if (min != null && max != null && min > max) {
      const center = target[key];
      constraints.min[key] = Math.max(0, center - 8);
      constraints.max[key] = Math.min(100, center + 8);
    }
  }
  if (constraints.bpmMin != null && constraints.bpmMax != null && constraints.bpmMin > constraints.bpmMax) {
    const midpoint = Math.round((constraints.bpmMin + constraints.bpmMax) / 2);
    constraints.bpmMin = midpoint - 4;
    constraints.bpmMax = midpoint + 4;
  }
  return constraints;
}

function interpretPrompt(rawPrompt: string) {
  const prompt = rawPrompt.trim().replace(/\s+/g, " ");
  const text = normalized(prompt);
  const libraryIntent = parseLibraryIntent(prompt);
  let target = { ...EMPTY_CONTEXT.target };
  const explicitConstraints: TodayConstraints = { min: {}, max: {}, bpmMin: null, bpmMax: null };
  const matchedTags: Array<{ tag: string; position: number; strength: number }> = [];

  const rules = [...MOOD_RULES, ...INTENT_RULES];
  for (const rule of rules) {
    const match = findRuleMatch(text, rule);
    if (!match) continue;
    const prefix = text.slice(0, match.position);
    if (isNegated(prefix)) {
      applyNegatedConcept(explicitConstraints, rule.tag, `${prefix.slice(-30)} ${match.phrase}`);
      continue;
    }
    const strength = modifierWeight(prefix) * contrastWeight(text, match.position);
    target = addDelta(target, rule.delta, strength);
    const current = matchedTags.find((item) => item.tag === rule.tag);
    if (!current) matchedTags.push({ tag: rule.tag, position: match.position, strength });
    else if (strength > current.strength) current.strength = strength;
  }

  // Explicit exclusions and directional phrases get hard gates. These are kept
  // separate from the emotional score so "energized but not aggressive" can be
  // energetic without admitting aggressive songs.
  if (/\b(?:not|without)\s+(?:too\s+)?aggress/.test(text)) setMax(explicitConstraints, "aggression", text.includes("not too aggressive") ? 52 : 44);
  if (/\bnot\s+too\s+energetic\b/.test(text)) { setMax(explicitConstraints, "energy", 68); setMax(explicitConstraints, "drive", 68); }
  if (/\bnot\s+too\s+heavy\b/.test(text)) setMax(explicitConstraints, "heavy", 62);
  if (/\bnot\s+too\s+dark\b/.test(text)) setMax(explicitConstraints, "dark", 62);
  if (/\bnot\s+too\s+(?:fast|upbeat)\b/.test(text)) { explicitConstraints.bpmMax = 128; setMax(explicitConstraints, "upbeat", 66); setMax(explicitConstraints, "drive", 66); }
  if (/\bnot\s+too\s+slow\b/.test(text)) { explicitConstraints.bpmMin = 88; setMin(explicitConstraints, "drive", 48); }
  if (/\bwithout\s+(?:the\s+)?heavy/.test(text)) setMax(explicitConstraints, "heavy", 50);
  if (/\bwithout\s+(?:the\s+)?dark/.test(text)) setMax(explicitConstraints, "dark", 55);

  const ordered = matchedTags.sort((a, b) => a.position - b.position);
  const emotionTags = ordered.map((item) => item.tag).filter((tag, index, array) => array.indexOf(tag) === index);
  const libraryTags = intentLabels(libraryIntent);
  const combinedTags = [...emotionTags, ...libraryTags].filter((tag, index, array) => array.indexOf(tag) === index);
  const fallback = libraryIntent.directRequest ? libraryTags : fallbackTags(prompt);
  const finalTags = (combinedTags.length ? combinedTags : fallback).slice(0, 4);
  const safeTags = finalTags.length ? finalTags : ["Balanced"];
  target = clampVector(target);
  const direction = describeDirection(target, safeTags, libraryIntent, emotionTags.length > 0);
  const reply = buildReply(safeTags, target, libraryIntent, emotionTags.length > 0);

  return { prompt, tags: safeTags, target, constraints: explicitConstraints, libraryIntent, direction, reply };
}

function describeDirection(target: TodayVector, tags: string[], libraryIntent: TodayLibraryIntent, hasEmotion: boolean) {
  if (libraryIntent.directRequest && !hasEmotion) {
    const pieces = intentLabels(libraryIntent);
    return `${pieces.join(" · ")} · library match`;
  }
  const energy = target.energy >= 74 ? "high energy" : target.energy <= 45 ? "lower energy" : "controlled energy";
  const motion = target.drive >= 75 ? "strong drive" : target.drive <= 44 ? "easy pacing" : "steady drive";
  const texture = target.heavy >= 72 ? "heavy edge" : target.melodic >= 72 ? "melodic lift" : target.atmospheric >= 72 ? "atmospheric space" : "balanced weight";
  const tone = target.dark >= 67 ? "darker tone" : target.bright >= 70 ? "brighter tone" : target.uplifting >= 72 ? "uplifting tone" : "neutral tone";
  const suffix = libraryIntent.directRequest ? ` · ${intentLabels(libraryIntent).join(" ")}` : "";
  if (tags.some((tag) => ["Tired", "Exhausted", "Sore", "Relaxed", "Peaceful"].includes(tag))) return `${energy} · ${motion} · ${texture}${suffix}`;
  return `${energy} · ${motion} · ${tone}${suffix}`;
}

function buildReply(tags: string[], target: TodayVector, libraryIntent: TodayLibraryIntent, hasEmotion: boolean) {
  if (libraryIntent.directRequest && !hasEmotion) {
    const request = intentLabels(libraryIntent).join(" ");
    return `Got it. I’m using only ${request || "the music you requested"} from your library and started the strongest match. Every matching song stays in the no-repeat pool.`;
  }
  const label = tags.slice(0, 3).join(", ").toLowerCase();
  const pace = target.drive >= 76 ? "strong forward drive" : target.drive <= 44 ? "an easier pace" : "steady forward motion";
  const texture = target.heavy >= 74 ? "a heavier edge" : target.melodic >= 72 ? "more melody" : target.atmospheric >= 72 ? "more atmosphere" : "balanced weight";
  const request = libraryIntent.directRequest ? ` I’m also restricting it to ${intentLabels(libraryIntent).join(" ")}.` : "";
  return `Got it. I’m matching ${label} with ${pace} and ${texture}.${request} I built a fresh Today queue only from songs that fit what you told me and started the strongest match.`;
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

function trackReleaseYear(track: MusicTrack) {
  const root = track as unknown as Record<string, unknown>;
  const candidates = [root.release_year, root.releaseYear, root.year, root.original_release_year, root.release_date, root.releaseDate];
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 1900 && value <= 2100) return Math.round(value);
    if (typeof value === "string") {
      const match = value.match(/\b(19|20)\d{2}\b/);
      if (match) return Number(match[0]);
    }
  }
  return null;
}

function normalizedArtistName(value: string | null | undefined) {
  return String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function artistMatchesKey(trackArtist: string | null | undefined, artistKey: string) {
  const value = normalizedArtistName(trackArtist);
  if (!value || !artistKey) return false;
  if (value === artistKey) return true;
  return [" feat ", " featuring ", " ft ", " with "].some((separator) => value.startsWith(`${artistKey}${separator}`));
}

function artistMentionedInPrompt(rawPrompt: string, artistKey: string) {
  if (!artistKey) return false;
  const prompt = ` ${normalizedArtistName(rawPrompt)} `;
  if (!prompt.includes(` ${artistKey} `)) return false;
  const words = artistKey.split(" ").filter(Boolean);
  if (words.length > 1) return true;

  // One-word artist names such as Heart, Live, Tool or Rush can also be normal
  // English words. Require a music/artist cue so emotion sentences do not
  // accidentally become artist locks.
  const escaped = artistKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const normalizedPrompt = normalizedArtistName(rawPrompt);
  const direct = new RegExp(`(?:^|\\b)(?:play|hear|listen(?: to)?|put on|queue|give me|songs? by|music by|artist|band)\\s+(?:all\\s+)?${escaped}(?:\\b|$)`, "i");
  const byArtist = new RegExp(`\\bby\\s+${escaped}(?:\\b|$)`, "i");
  if (direct.test(normalizedPrompt) || byArtist.test(normalizedPrompt) || normalizedPrompt === artistKey) return true;

  const hasMusicCue = /\b(?:play|hear|listen|queue|songs?|music|bands?|artists?|tracks?|give me|put on)\b/i.test(rawPrompt);
  const ambiguousSingleWordArtists = new Set([
    "heart", "live", "tool", "rush", "queen", "filter", "bush", "garbage", "kiss", "helmet", "cake", "train", "hole", "europe", "asia", "boston", "chicago", "disturbed",
  ]);
  return hasMusicCue && !ambiguousSingleWordArtists.has(artistKey);
}

function resolveArtistIntent(rawPrompt: string, library: MusicTrack[], base: TodayLibraryIntent): TodayLibraryIntent {
  const unique = new Map<string, string>();
  for (const track of library) {
    const label = String(track.artist || "").trim();
    const key = normalizedArtistName(label);
    if (!key || unique.has(key)) continue;
    unique.set(key, label);
  }

  const matches = [...unique.entries()]
    .filter(([key]) => artistMentionedInPrompt(rawPrompt, key))
    .sort((a, b) => b[0].length - a[0].length);
  if (!matches.length) return base;

  // Prefer the longest artist names first, and avoid retaining a shorter name
  // that is fully contained inside a longer matched artist name.
  const selected: Array<[string, string]> = [];
  for (const match of matches) {
    if (selected.some(([chosen]) => chosen.includes(match[0]) && chosen !== match[0])) continue;
    selected.push(match);
  }

  const similar = /\b(?:similar|sounds? like|bands? like|artists? like|music like)\b/i.test(rawPrompt);
  return {
    ...base,
    artistKeys: selected.map(([key]) => key),
    artistLabels: selected.map(([, label]) => label),
    artistMode: similar ? "similar" : "only",
    directRequest: true,
  };
}

function intentLabels(intent: TodayLibraryIntent) {
  const artists = intent.artistLabels.length
    ? [intent.artistLabels.join(" + ") + (intent.artistMode === "similar" ? " + similar" : "")]
    : [];
  return [...artists, intent.decadeLabel, ...intent.styleLabels].filter((value): value is string => Boolean(value));
}

function styleContext(track: MusicTrack) {
  const intelligence = getCachedMusicTrackIntelligence(track.id);
  const parts = [
    track.genre || "", track.album || "", track.artist || "",
    ...(intelligence?.mainGenres || []), ...(intelligence?.subgenres || []),
    ...(intelligence?.moods || []), ...(intelligence?.characterTags || []),
    ...(intelligence?.movementTags || []), ...(intelligence?.musicFor || []),
    intelligence?.description || "",
  ];
  return parts.join(" ").toLowerCase().replace(/[’']/g, "'").replace(/[-_/]+/g, " ").replace(/\s+/g, " ");
}

function matchesLibraryStyle(track: MusicTrack, key: string) {
  const rule = LIBRARY_STYLE_RULES.find((item) => item.key === key);
  if (!rule) return false;
  const context = styleContext(track);
  const artist = normalizedArtistName(track.artist);
  if (rule.artistHints?.some((hint) => artist === normalizedArtistName(hint))) return true;

  if (key === "grunge") {
    const withoutPostGrunge = context.replace(/\bpost\s+grunge\b/g, " ");
    return /\bgrunge\b/.test(withoutPostGrunge);
  }
  if (key === "classic-rock") {
    return /\bclassic\s+rock\b/.test(context);
  }
  if (key === "pop") {
    const withoutPopPunk = context.replace(/\bpop\s+punk\b/g, " ");
    return /\b(?:pop|pop\s+rock|dance\s+pop|electropop|synthpop)\b/.test(withoutPopPunk);
  }

  return rule.matchTerms.some((term) => {
    const normalizedTerm = term.replace(/-/g, " ").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${normalizedTerm.replace(/\\ /g, "\\s+")}\\b`, "i").test(context);
  });
}

function matchesLibraryIntent(track: MusicTrack, intent: TodayLibraryIntent) {
  if (!intent.directRequest) return true;
  if (intent.decadeStart != null && intent.decadeEnd != null) {
    const year = trackReleaseYear(track);
    if (year == null || year < intent.decadeStart || year > intent.decadeEnd) return false;
  }
  if (intent.styles.length && !intent.styles.some((style) => matchesLibraryStyle(track, style))) return false;
  if (intent.artistMode === "only" && intent.artistKeys.length && !intent.artistKeys.some((key) => artistMatchesKey(track.artist, key))) return false;
  return true;
}


type TrackDNA = TodayVector;

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
    aggression: cached.aggression, atmospheric: cached.atmospheric, reflective: cached.reflective, relaxing: cached.relaxing, uplifting: cached.uplifting, motivational: cached.motivational, chaotic: cached.chaotic, upbeat: cached.upbeat, workoutFit: cached.workoutFit, intensity: cached.intensity,
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
    ["uplifting", ["uplifting", "uplift", "uplifting_score"]],
    ["motivational", ["motivational", "motivation", "motivational_score"]],
    ["chaotic", ["chaotic", "chaos", "chaotic_score"]],
    ["upbeat", ["upbeat", "upbeat_score"]],
    ["workoutFit", ["workoutFit", "workout_fit", "workout_fit_score"]],
    ["intensity", ["intensity", "intensity_score"]],
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
    aggression: cached.aggression, atmospheric: cached.atmospheric, reflective: cached.reflective, relaxing: cached.relaxing, uplifting: cached.uplifting, motivational: cached.motivational, chaotic: cached.chaotic, upbeat: cached.upbeat, workoutFit: cached.workoutFit, intensity: cached.intensity,
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

  const intensity = energy * 0.34 + drive * 0.29 + aggression * 0.22 + heavy * 0.15;
  const uplifting = bright * 0.40 + upbeat * 0.33 + melodic * 0.19 + relaxing * 0.08 - dark * 0.10;
  const chaotic = aggression * 0.30 + drive * 0.24 + heavy * 0.19 + (100 - focus) * 0.27;
  const motivational = drive * 0.31 + energy * 0.23 + focus * 0.18 + Math.max(0, uplifting) * 0.15 + (100 - relaxing) * 0.13;
  const workoutFit = energy * 0.27 + drive * 0.29 + intensity * 0.20 + motivational * 0.16 + heavy * 0.08;

  let dna: TrackDNA = {
    energy: clamp(energy), heavy: clamp(heavy), melodic: clamp(melodic), dark: clamp(dark), drive: clamp(drive), bright: clamp(bright), focus: clamp(focus),
    aggression: clamp(aggression), atmospheric: clamp(atmospheric), reflective: clamp(reflective), relaxing: clamp(relaxing), uplifting: clamp(uplifting), motivational: clamp(motivational), chaotic: clamp(chaotic), upbeat: clamp(upbeat), workoutFit: clamp(workoutFit), intensity: clamp(intensity),
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
  return { ...dna };
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
    ["energy", 1.45], ["drive", 1.45], ["intensity", 1.30], ["aggression", 1.20],
    ["relaxing", 1.20], ["uplifting", 1.15], ["motivational", 1.12], ["upbeat", 1.05],
    ["heavy", 1.00], ["melodic", 0.92], ["dark", 0.90], ["bright", 0.88],
    ["focus", 0.86], ["atmospheric", 0.82], ["reflective", 0.82], ["chaotic", 0.78],
    ["workoutFit", 0.74],
  ];
  const totalWeight = parts.reduce((sum, [, weight]) => sum + weight, 0);
  return parts.reduce((sum, [key, weight]) => sum + Math.abs(a[key] - b[key]) * weight, 0) / totalWeight;
}

function uniqueTracks(library: MusicTrack[]) {
  const seenIds = new Set<string>();
  const seenSongs = new Set<string>();
  return library.filter((track) => {
    if (!track?.id || seenIds.has(track.id)) return false;
    const artist = (track.artist || "").trim().toLowerCase();
    const title = (track.title || "").trim().toLowerCase();
    const songKey = artist && title ? `${artist}|${title}` : "";
    if (songKey && seenSongs.has(songKey)) return false;
    seenIds.add(track.id);
    if (songKey) seenSongs.add(songKey);
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

function strictCompatibility(constraints: TodayConstraints, dna: TrackDNA, bpm: number | null) {
  for (const key of Object.keys(constraints.min) as Array<keyof TodayVector>) {
    const floor = constraints.min[key];
    if (floor != null && dna[key] < floor) return false;
  }
  for (const key of Object.keys(constraints.max) as Array<keyof TodayVector>) {
    const ceiling = constraints.max[key];
    if (ceiling != null && dna[key] > ceiling) return false;
  }
  if (bpm != null && constraints.bpmMin != null && bpm < constraints.bpmMin) return false;
  if (bpm != null && constraints.bpmMax != null && bpm > constraints.bpmMax) return false;
  return true;
}

function moodAffinity(target: TodayVector, dna: TrackDNA) {
  let bonus = 0;
  if (target.energy <= 48) {
    bonus += dna.relaxing * 0.10 + dna.atmospheric * 0.055 + dna.reflective * 0.05;
    bonus -= dna.aggression * 0.095 + dna.upbeat * 0.075 + dna.intensity * 0.06;
  }
  if (target.energy >= 72) bonus += dna.energy * 0.045 + dna.drive * 0.055 + dna.intensity * 0.05;
  if (target.uplifting >= 72) bonus += dna.uplifting * 0.075 + dna.bright * 0.04 + dna.upbeat * 0.055;
  if (target.motivational >= 72) bonus += dna.motivational * 0.075 + dna.workoutFit * 0.05 + dna.drive * 0.035;
  if (target.focus >= 74) bonus += dna.focus * 0.055 + dna.atmospheric * 0.025 - dna.chaotic * 0.05;
  if (target.reflective >= 72) bonus += dna.reflective * 0.075 + dna.atmospheric * 0.035 + dna.melodic * 0.025;
  if (target.aggression >= 72) bonus += dna.aggression * 0.08 + dna.heavy * 0.045 + dna.intensity * 0.05;
  if (target.dark >= 68) bonus += dna.dark * 0.05;
  if (target.melodic >= 72) bonus += dna.melodic * 0.045;
  return bonus;
}

function tempoAffinity(target: TodayVector, bpm: number | null) {
  if (bpm == null || !Number.isFinite(bpm)) return 0;
  const desiredBpm = 70 + target.drive * 0.58 + target.energy * 0.18 + target.upbeat * 0.08;
  let score = -Math.abs(bpm - desiredBpm) * 0.075;
  if (target.energy <= 45 && bpm > 116) score -= (bpm - 116) * 0.14;
  if (target.relaxing >= 72 && bpm > 122) score -= (bpm - 122) * 0.15;
  if (target.drive >= 75 && bpm < 92) score -= (92 - bpm) * 0.08;
  return score;
}

function averageRequestedArtistDNA(library: MusicTrack[], intent: TodayLibraryIntent): TodayVector | null {
  if (intent.artistMode !== "similar" || !intent.artistKeys.length) return null;
  const references = library.filter((track) => intent.artistKeys.some((key) => artistMatchesKey(track.artist, key)));
  if (!references.length) return null;
  const vectors = references.slice(0, 24).map((track) => staticTrackDNA(track));
  const result = { ...EMPTY_CONTEXT.target };
  for (const key of Object.keys(result) as Array<keyof TodayVector>) {
    result[key] = Math.round(vectors.reduce((sum, vector) => sum + vector[key], 0) / vectors.length);
  }
  return result;
}

function matchesSimilarArtistIntent(track: MusicTrack, intent: TodayLibraryIntent, reference: TodayVector | null) {
  if (intent.artistMode !== "similar" || !intent.artistKeys.length) return true;
  if (intent.artistKeys.some((key) => artistMatchesKey(track.artist, key))) return true;
  if (!reference) return false;
  // Similar-artist requests stay strict enough to avoid genre soup. Persisted
  // Artist/Song DNA supplies the identity; Song DNA still has final authority.
  return vectorDistance(reference, staticTrackDNA(track)) <= 19;
}

function rankForToday(
  library: MusicTrack[],
  target: TodayVector,
  explicitConstraints: TodayConstraints,
  tags: string[],
  prompt: string,
  revision: number,
  currentTrackId: string | null,
  surpriseStrength = 0,
  libraryIntent: TodayLibraryIntent = EMPTY_LIBRARY_INTENT,
) {
  const unique = uniqueTracks(library);
  const constraints = inferHardConstraints(target, tags, explicitConstraints);
  const similarArtistReference = averageRequestedArtistDNA(unique, libraryIntent);
  const prepared = unique.map((track) => {
    const intelligence = getCachedMusicTrackIntelligence(track.id);
    const rawBpm = intelligence?.bpm == null ? null : Number(intelligence.bpm);
    const bpm = rawBpm != null && Number.isFinite(rawBpm) && rawBpm >= 40 && rawBpm <= 240 ? rawBpm : null;
    return { track, dna: staticTrackDNA(track), bpm };
  });

  // No filler policy: only tracks that pass the current emotion's hard gates
  // enter the AI Today pool. A small correct pool is preferred to a large
  // watered-down queue.
  const eligible = prepared.filter(({ track, dna, bpm }) =>
    matchesLibraryIntent(track, libraryIntent) &&
    matchesSimilarArtistIntent(track, libraryIntent, similarArtistReference) &&
    strictCompatibility(constraints, dna, bpm)
  );
  if (!eligible.length) return [];

  const ranked = eligible
    .map(({ track, dna, bpm }) => {
      const distance = vectorDistance(target, dna);
      const stable = hashUnit(`${prompt}|${revision}|${track.id}`);
      const jitter = surpriseStrength > 0 ? stable * 24 * surpriseStrength : stable * 0.55;
      const currentPenalty = currentTrackId && track.id === currentTrackId ? 180 : 0;
      const score = 100 - distance + moodAffinity(target, dna) + tempoAffinity(target, bpm) + jitter - currentPenalty;
      return { track, score };
    })
    .sort((left, right) => right.score - left.score)
    .map((item) => item.track);

  // Keep the entire matching pool. Do not truncate to 48 tracks, because that
  // could cause a repeat before every compatible song has had a turn.
  return diversifyArtists(ranked);
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

  const resolvedIntent = resolveArtistIntent(next.prompt, library, next.libraryIntent);
  const artistTags = resolvedIntent.artistLabels.length ? resolvedIntent.artistLabels.slice(0, 2) : [];
  const resolvedTags = [...artistTags, ...next.tags].filter((tag, index, array) => array.indexOf(tag) === index).slice(0, 4);
  const hasEmotion = next.tags.some((tag) => MOOD_RULES.some((rule) => rule.tag === tag) || INTENT_RULES.some((rule) => rule.tag === tag));
  const resolvedNext: MusicTodayContext = {
    ...next,
    tags: resolvedTags.length ? resolvedTags : next.tags,
    libraryIntent: resolvedIntent,
    direction: describeDirection(next.target, resolvedTags.length ? resolvedTags : next.tags, resolvedIntent, hasEmotion),
    reply: buildReply(resolvedTags.length ? resolvedTags : next.tags, next.target, resolvedIntent, hasEmotion),
  };

  const currentTrackId = excludeCurrent ? player.currentTrack?.id || null : null;
  const queue = rankForToday(library, resolvedNext.target, resolvedNext.constraints, resolvedNext.tags, resolvedNext.prompt, resolvedNext.revision, currentTrackId, surpriseStrength, resolvedNext.libraryIntent);
  if (!queue.length) throw new Error("No songs in your library match that request closely enough yet. Try a broader description or add more music that fits it.");

  ensureMusicTodayPlaybackMode();
  const queueName = compactQueueName(resolvedNext.tags);
  const ready = { ...resolvedNext, active: true, queueName, queueSize: queue.length, updatedAt: Date.now() };
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
    constraints: interpreted.constraints,
    libraryIntent: interpreted.libraryIntent,
    revision: state.revision + 1,
    updatedAt: Date.now(),
  };

  return startQueue(next, 0, Boolean(state.prompt));
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
  if (mode === "harder") return addDelta(base, { energy: 15, heavy: 14, drive: 16, aggression: 12, intensity: 16, motivational: 8, workoutFit: 10, bright: -3 });
  if (mode === "heavier") return addDelta(base, { energy: 6, heavy: 24, drive: 7, aggression: 11, intensity: 12, dark: 4, bright: -6 });
  if (mode === "faster") return addDelta(base, { energy: 13, drive: 27, upbeat: 13, intensity: 15, focus: 5 });
  if (mode === "melodic") return addDelta(base, { melodic: 27, atmospheric: 8, uplifting: 6, heavy: -5, dark: -4, bright: 9 });
  if (mode === "darker") return addDelta(base, { dark: 27, heavy: 8, aggression: 6, bright: -24, uplifting: -10, upbeat: -8 });
  return base;
}

export function steerMusicToday(rawMode: string) {
  if (!state.active || !state.prompt) return false;
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
    direction: describeDirection(clampVector(target), state.tags, state.libraryIntent, true),
    reply: `${label} applied. I rebuilt Today around that direction and switched to the strongest new match.`,
    revision: state.revision + 1,
    updatedAt: Date.now(),
  };

  void startQueue(next, surpriseStrength, true).catch(() => undefined);
  return true;
}
