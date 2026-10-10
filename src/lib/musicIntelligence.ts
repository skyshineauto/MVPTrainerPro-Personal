/* MVP_TRAINER_V5_R7_NEURAL_PLAYER_DISCOVERY */
import type { MusicTrack } from "./musicStorage";
import { getCachedMusicTrackIntelligence } from "./musicIntelligenceCache";
import {
  createMusicPlaylist,
  listMusicPlaylists,
  replaceMusicPlaylistTracks,
} from "./playlistStorage";

export const LIKED_SONGS_PLAYLIST_NAME = "Liked Songs";

export type MusicRadioMode =
  | "more_like_this"
  | "harder"
  | "heavier"
  | "faster"
  | "melodic"
  | "darker"
  | "surprise";

export type WorkoutMusicStage =
  | "off"
  | "warmup"
  | "working"
  | "heavy"
  | "finisher";

export type SongDna = {
  energy: number;
  heavy: number;
  melodic: number;
  dark: number;
  drive: number;
  workoutFit: number;
};

export type PrSoundtrackRecord = {
  id: string;
  trackId: string;
  title: string;
  artist: string;
  exerciseName: string;
  setNumber: number;
  records: string[];
  createdAt: string;
};

const KEYS = {
  radio: "mvp_music_neural_radio_v3",
  recent: "mvp_music_neural_recent_v3",
  stage: "mvp_music_workout_stage_v2",
  autoMix: "mvp_music_automix_v2",
  prSoundtrack: "mvp_music_pr_soundtrack_v2",
  playbackCycle: "mvp_music_playback_cycle_v1",
};

const LEGACY_KEYS = {
  radio: "mvp_music_neural_radio_v2",
  recent: "mvp_music_neural_recent_v2",
};

type RadioState = {
  seedTrackId: string;
  mode: MusicRadioMode;
  startedAt: string;
  steeringRemaining: number;
};


type PlaybackCycleState = {
  playedIds: string[];
  completedCycles: number;
  updatedAt: number;
};

function readPlaybackCycle(): PlaybackCycleState {
  return readJson<PlaybackCycleState>(KEYS.playbackCycle, { playedIds: [], completedCycles: 0, updatedAt: Date.now() });
}

function writePlaybackCycle(state: PlaybackCycleState) {
  writeJson(KEYS.playbackCycle, state);
}

function markCyclePlayed(trackId: string) {
  const cycle = readPlaybackCycle();
  if (cycle.playedIds.includes(trackId)) return;
  writePlaybackCycle({ ...cycle, playedIds: [...cycle.playedIds, trackId], updatedAt: Date.now() });
}

function restartPlaybackCycle(currentTrackId?: string) {
  const cycle = readPlaybackCycle();
  writePlaybackCycle({
    playedIds: currentTrackId ? [currentTrackId] : [],
    completedCycles: cycle.completedCycles + 1,
    updatedAt: Date.now(),
  });
}

export function getPlaybackCycleStatus(library: MusicTrack[]) {
  const eligible = library.filter((track) => !track.play_less);
  const ids = new Set(eligible.map((track) => track.id));
  const cycle = readPlaybackCycle();
  const played = cycle.playedIds.filter((id) => ids.has(id));
  return {
    played: played.length,
    remaining: Math.max(0, eligible.length - played.length),
    eligible: eligible.length,
    completedCycles: cycle.completedCycles,
  };
}

export function chooseCycleSafeTrack(library: MusicTrack[], currentTrackId?: string | null, remember = true) {
  const eligible = library.filter((track) => !track.play_less && track.id !== currentTrackId);
  if (!eligible.length) return null;
  const cycle = readPlaybackCycle();
  const played = new Set(cycle.playedIds);
  let available = eligible.filter((track) => !played.has(track.id));
  if (!available.length) {
    restartPlaybackCycle(currentTrackId || undefined);
    available = eligible;
  }
  const next = available[Math.floor(Math.random() * available.length)] ?? null;
  if (next && remember) markCyclePlayed(next.id);
  return next;
}

export function rememberPlaybackCycleTrack(trackId: string) {
  markCyclePlayed(trackId);
  rememberTrack(trackId);
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Intelligence memory is best effort only.
  }
}

function readRadioState(): RadioState | null {
  const current = readJson<RadioState | null>(KEYS.radio, null);
  if (current) return current;

  const legacy = readJson<
    | {
        seedTrackId?: string;
        mode?: MusicRadioMode;
        startedAt?: string;
      }
    | null
  >(LEGACY_KEYS.radio, null);

  if (!legacy?.seedTrackId) return null;

  const migrated: RadioState = {
    seedTrackId: legacy.seedTrackId,
    mode: legacy.mode ?? "more_like_this",
    startedAt: legacy.startedAt ?? new Date().toISOString(),
    steeringRemaining: 0,
  };

  writeJson(KEYS.radio, migrated);
  return migrated;
}

function trackText(track: MusicTrack) {
  return `${track.artist || ""} ${track.album || ""} ${track.title || ""} ${track.genre || ""}`.toLowerCase();
}

function containsAny(value: string, words: string[]) {
  return words.some((word) => value.includes(word));
}

function normalizedArtist(track: MusicTrack) {
  return (track.artist || "Unknown Artist").trim().toLowerCase();
}

function normalizedAlbum(track: MusicTrack) {
  return (track.album || "").trim().toLowerCase();
}

export function getSongDna(track: MusicTrack): SongDna {
  const text = trackText(track);
  const energy =
    track.energy_level === "high"
      ? 88
      : track.energy_level === "medium"
        ? 62
        : 34;

  let heavy = 34 + (energy - 50) * 0.38;
  if (
    containsAny(text, [
      "metal",
      "hard rock",
      "metalcore",
      "hardcore",
      "industrial",
      "nu metal",
      "post-hardcore",
    ])
  ) {
    heavy += 31;
  }
  if (containsAny(text, ["acoustic", "soft rock", "pop"])) heavy -= 14;

  let melodic = 50;
  if (
    containsAny(text, [
      "melodic",
      "alternative",
      "post-grunge",
      "rock",
      "anthem",
      "acoustic",
    ])
  ) {
    melodic += 22;
  }

  let dark = 34;
  if (
    containsAny(text, [
      "dark",
      "doom",
      "goth",
      "industrial",
      "death",
      "grave",
      "pain",
      "dead",
      "bleed",
      "blood",
      "black",
      "night",
      "shadow",
      "broken",
      "alone",
      "failure",
      "hate",
      "fear",
    ])
  ) {
    dark += 28;
  }

  let drive = energy * 0.77 + 12;
  if (
    containsAny(text, ["punk", "thrash", "speed", "hardcore", "metalcore"])
  ) {
    drive += 15;
  }
  if (track.favorite) drive += 5;
  if (track.play_less) drive -= 25;

  const completionRate = track.play_count
    ? Math.min(
        1,
        track.completed_play_count / Math.max(1, track.play_count),
      )
    : 0.45;
  const skipRate = track.play_count
    ? Math.min(1, track.skip_count / Math.max(1, track.play_count))
    : 0;

  const workoutFit =
    energy * 0.54 +
    clamp(heavy) * 0.18 +
    clamp(drive) * 0.17 +
    completionRate * 18 -
    skipRate * 24 +
    (track.favorite ? 10 : 0) -
    (track.play_less ? 40 : 0);

  return {
    energy: clamp(energy),
    heavy: clamp(heavy),
    melodic: clamp(melodic),
    dark: clamp(dark),
    drive: clamp(drive),
    workoutFit: clamp(workoutFit),
  };
}

type RichSimilarityVector = {
  energy: number;
  heavy: number;
  aggression: number;
  drive: number;
  intensity: number;
  melodic: number;
  dark: number;
  bright: number;
  atmospheric: number;
  reflective: number;
  relaxing: number;
  uplifting: number;
  motivational: number;
  chaotic: number;
  focus: number;
  upbeat: number;
  workoutFit: number;
};

function richSimilarityVector(track: MusicTrack): RichSimilarityVector {
  const cached = getCachedMusicTrackIntelligence(track.id)?.songDna;
  if (cached) {
    return {
      energy: cached.energy,
      heavy: cached.heaviness,
      aggression: cached.aggression,
      drive: cached.drive,
      intensity: cached.intensity,
      melodic: cached.melodic,
      dark: cached.darkness,
      bright: cached.brightness,
      atmospheric: cached.atmospheric,
      reflective: cached.reflective,
      relaxing: cached.relaxing,
      uplifting: cached.uplifting,
      motivational: cached.motivational,
      chaotic: cached.chaotic,
      focus: cached.focus,
      upbeat: cached.upbeat,
      workoutFit: cached.workoutFit,
    };
  }
  const basic = getSongDna(track);
  return {
    energy: basic.energy,
    heavy: basic.heavy,
    aggression: basic.heavy * .72,
    drive: basic.drive,
    intensity: basic.energy * .55 + basic.heavy * .45,
    melodic: basic.melodic,
    dark: basic.dark,
    bright: 100 - basic.dark,
    atmospheric: 50,
    reflective: basic.melodic * .60,
    relaxing: Math.max(0, 100 - basic.energy),
    uplifting: Math.max(0, 100 - basic.dark),
    motivational: basic.workoutFit * .65,
    chaotic: basic.heavy * .35,
    focus: 55,
    upbeat: Math.max(0, basic.energy - basic.dark * .25),
    workoutFit: basic.workoutFit,
  };
}

function richSimilarityDistance(a: MusicTrack, b: MusicTrack) {
  const left = richSimilarityVector(a);
  const right = richSimilarityVector(b);
  const weights: Array<[keyof RichSimilarityVector, number]> = [
    ["heavy", 1.35], ["drive", 1.30], ["energy", 1.22], ["melodic", 1.18],
    ["aggression", 1.15], ["intensity", 1.10], ["dark", 1.04], ["bright", .88],
    ["atmospheric", .92], ["reflective", .82], ["relaxing", .85], ["uplifting", .76],
    ["motivational", .70], ["chaotic", .72], ["focus", .58], ["upbeat", .72], ["workoutFit", .74],
  ];
  const total = weights.reduce((sum, [, weight]) => sum + weight, 0);
  return weights.reduce((sum, [key, weight]) => sum + Math.abs(left[key] - right[key]) * weight, 0) / total;
}

function normalizedStyleTokens(track: MusicTrack) {
  const intelligence = getCachedMusicTrackIntelligence(track.id);
  const values = [track.genre || "", ...(intelligence?.mainGenres || []), ...(intelligence?.subgenres || [])];
  return new Set(values.flatMap((value) => String(value).toLowerCase().replace(/[’']/g, "'").split(/[,/|]+/)).map((value) => value.trim().replace(/[-_]+/g, " ")).filter(Boolean));
}

function styleOverlapScore(seed: MusicTrack, candidate: MusicTrack) {
  const a = normalizedStyleTokens(seed);
  const b = normalizedStyleTokens(candidate);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const value of a) if (b.has(value)) shared += 1;
  if (!shared) return -16;
  return Math.min(30, 12 + shared * 9);
}

function releaseYear(track: MusicTrack) {
  const year = Number(track.release_year || 0);
  return Number.isFinite(year) && year >= 1900 && year <= 2100 ? year : null;
}

function eraSimilarityScore(seed: MusicTrack, candidate: MusicTrack) {
  const a = releaseYear(seed);
  const b = releaseYear(candidate);
  if (a == null || b == null) return 0;
  const delta = Math.abs(a - b);
  if (delta <= 2) return 18;
  if (delta <= 5) return 13;
  if (Math.floor(a / 10) === Math.floor(b / 10)) return 9;
  if (delta <= 15) return 1;
  return -12;
}

function exactSongFingerprintScore(seed: MusicTrack, candidate: MusicTrack) {
  const distance = richSimilarityDistance(seed, candidate);
  return 122 - distance * 1.72 + styleOverlapScore(seed, candidate) + eraSimilarityScore(seed, candidate);
}

export function radioModeLabel(mode: MusicRadioMode) {
  if (mode === "harder") return "Harder";
  if (mode === "heavier") return "Heavier";
  if (mode === "faster") return "Faster";
  if (mode === "melodic") return "More Melodic";
  if (mode === "darker") return "Darker";
  if (mode === "surprise") return "Surprise Me";
  return "More Like This";
}

export function getActiveRadioMode(): MusicRadioMode | null {
  return readRadioState()?.mode ?? null;
}

export function getActiveRadioSteeringRemaining() {
  return Math.max(0, readRadioState()?.steeringRemaining ?? 0);
}

export function adaptiveRadioQueueName(
  seed: MusicTrack,
  mode: MusicRadioMode,
) {
  return `MVP Neural • ${radioModeLabel(mode)} • ${seed.title}`;
}

export function isAdaptiveRadioName(name: string | null | undefined) {
  return Boolean(
    name &&
      (name.startsWith("MVP Neural •") ||
        name.startsWith("Like Radio •")),
  );
}

export function setWorkoutMusicContext(
  activeIndex: number,
  totalExercises: number,
  doneCount = 0,
) {
  let stage: WorkoutMusicStage = "off";

  if (totalExercises > 0) {
    const progress =
      Math.max(activeIndex, doneCount) /
      Math.max(1, totalExercises - 1);

    if (progress <= 0.12) stage = "warmup";
    else if (progress >= 0.82) stage = "finisher";
    else if (progress >= 0.48) stage = "heavy";
    else stage = "working";
  }

  writeJson(KEYS.stage, stage);
  return stage;
}

export function getWorkoutMusicStage(): WorkoutMusicStage {
  if (typeof window !== "undefined") {
    try {
      if (!window.localStorage.getItem("mvp_active_session_id")) return "off";
    } catch {
      // Fall through.
    }
  }
  return readJson<WorkoutMusicStage>(KEYS.stage, "off");
}

function recentIds() {
  // Keep a long workout/session memory. With a 500+ song library there is no
  // reason to recycle the same 20–30 tracks aggressively.
  const current = readJson<string[]>(KEYS.recent, []);
  if (current.length) return current.slice(0, 72);
  return readJson<string[]>(LEGACY_KEYS.recent, []).slice(0, 72);
}

function rememberTrack(trackId: string) {
  writeJson(
    KEYS.recent,
    [trackId, ...recentIds().filter((id) => id !== trackId)].slice(0, 72),
  );
}

function stageBias(dna: SongDna, stage: WorkoutMusicStage) {
  if (stage === "warmup") {
    return 22 - Math.abs(dna.energy - 64) * 0.35;
  }
  if (stage === "working") {
    return dna.workoutFit * 0.23 + dna.drive * 0.12;
  }
  if (stage === "heavy") {
    return dna.heavy * 0.2 + dna.energy * 0.18 + dna.drive * 0.16;
  }
  if (stage === "finisher") {
    return dna.workoutFit * 0.28 + dna.energy * 0.2 + dna.drive * 0.2;
  }
  return dna.workoutFit * 0.08;
}

function dnaDistance(a: SongDna, b: SongDna, mode: MusicRadioMode) {
  const weights =
    mode === "heavier"
      ? [0.8, 1.9, 0.5, 0.7, 0.9]
      : mode === "faster"
        ? [1.1, 0.6, 0.5, 0.4, 2]
        : mode === "melodic"
          ? [0.7, 0.5, 2, 0.5, 0.7]
          : mode === "darker"
            ? [0.7, 0.8, 0.5, 2.1, 0.8]
            : mode === "surprise"
              ? [0.55, 0.55, 0.5, 0.5, 0.6]
              : mode === "harder"
                ? [1.6, 1.4, 0.4, 0.5, 1.5]
                : [1, 1, 1, 0.7, 1];

  const values = [
    Math.abs(a.energy - b.energy),
    Math.abs(a.heavy - b.heavy),
    Math.abs(a.melodic - b.melodic),
    Math.abs(a.dark - b.dark),
    Math.abs(a.drive - b.drive),
  ];

  return (
    values.reduce(
      (sum, value, index) => sum + value * weights[index],
      0,
    ) / weights.reduce((sum, value) => sum + value, 0)
  );
}

function candidateScore(
  seed: MusicTrack,
  current: MusicTrack,
  candidate: MusicTrack,
  mode: MusicRadioMode,
  recent: Set<string>,
  recentArtists: Set<string>,
  recentAlbums: Set<string>,
) {
  if (
    candidate.id === current.id ||
    candidate.id === seed.id ||
    candidate.play_less
  ) {
    return -99999;
  }

  const seedDna = getSongDna(seed);
  const currentDna = getSongDna(current);
  const candidateDna = getSongDna(candidate);

  const surpriseSimilarityScale = mode === "surprise" ? 0.58 : 1;
  let score = mode === "more_like_this"
    ? exactSongFingerprintScore(seed, candidate)
    : 100 - dnaDistance(seedDna, candidateDna, mode) * surpriseSimilarityScale;

  if (normalizedArtist(seed) === normalizedArtist(candidate)) {
    score += mode === "surprise" ? -12 : 8;
  }
  // Strong artist cooldown. Repeating an artist immediately should be rare.
  if (normalizedArtist(current) === normalizedArtist(candidate)) score -= 95;
  const candidateAlbum = normalizedAlbum(candidate);
  if (candidateAlbum && candidateAlbum === normalizedAlbum(current)) score -= 46;

  // Recent tracks are effectively excluded. Artist and album cooldowns stop
  // the radio from orbiting the same few bands/records even when their DNA is
  // an otherwise perfect match.
  if (recent.has(candidate.id)) score -= 1000;
  if (recentArtists.has(normalizedArtist(candidate))) score -= 62;
  if (candidateAlbum && recentAlbums.has(candidateAlbum)) score -= 30;

  // Steering commands are directional from the song playing NOW, not merely
  // similarity tags relative to the original radio seed. This makes a tap on
  // HEAVIER / FASTER / HARDER audibly change what comes next.
  if (mode === "harder") {
    const gain = (candidateDna.energy - currentDna.energy) * 1.15 + (candidateDna.heavy - currentDna.heavy) * 1.05 + (candidateDna.drive - currentDna.drive) * 0.85;
    score += gain;
    if (candidateDna.energy <= currentDna.energy && candidateDna.heavy <= currentDna.heavy) score -= 42;
  } else if (mode === "heavier") {
    const delta = candidateDna.heavy - currentDna.heavy;
    score += delta * 1.85;
    if (delta <= 0) score -= 36;
  } else if (mode === "faster") {
    const delta = candidateDna.drive - currentDna.drive;
    score += delta * 1.75;
    if (delta <= 0) score -= 34;
  } else if (mode === "melodic") {
    const delta = candidateDna.melodic - currentDna.melodic;
    score += delta * 1.65;
    if (delta <= 0) score -= 24;
  } else if (mode === "darker") {
    const delta = candidateDna.dark - currentDna.dark;
    score += delta * 1.70 + Math.max(0, candidateDna.heavy - currentDna.heavy) * 0.30;
    if (delta <= 0) score -= 28;
  } else if (mode === "surprise") {
    const lowPlayBoost = Math.max(0, 10 - Math.min(10, candidate.play_count)) * 1.25;
    score += lowPlayBoost;
    score += candidate.favorite ? 3 : 0;
    score += Math.random() * 22;
  }

  score += stageBias(candidateDna, getWorkoutMusicStage());
  score += candidate.favorite ? 10 : 0;
  score += Math.min(12, candidate.completed_play_count * 0.8);
  score -= Math.min(26, candidate.skip_count * 3.2);

  if (candidate.last_played_at) {
    const hours =
      (Date.now() - new Date(candidate.last_played_at).getTime()) /
      3600000;

    if (hours < 6) score -= 45;
    else if (hours < 24) score -= 22;
    else if (hours < 72) score -= 9;
    else if (hours > 336) score += mode === "surprise" ? 16 : 8;
  } else {
    score += mode === "surprise" ? 22 : 12;
  }

  return score + Math.random() * (mode === "surprise" ? 8 : mode === "more_like_this" ? 1.25 : 4);
}

function steeringLength(mode: MusicRadioMode) {
  if (mode === "more_like_this") return 0;
  if (mode === "surprise") return 3;
  return 4;
}

export function startRadioSession(
  seed: MusicTrack,
  library: MusicTrack[],
  mode: MusicRadioMode = "more_like_this",
) {
  const radio: RadioState = {
    seedTrackId: seed.id,
    mode,
    startedAt: new Date().toISOString(),
    steeringRemaining: steeringLength(mode),
  };

  writeJson(KEYS.radio, radio);
  rememberTrack(seed.id);
  markCyclePlayed(seed.id);

  const recent = new Set(recentIds());
  const recentArtists = new Set<string>();
  const recentAlbums = new Set<string>();

  const ranked = library
    .filter((track) => track.id !== seed.id && !track.play_less)
    .map((track) => ({
      track,
      score: candidateScore(
        seed,
        seed,
        track,
        mode,
        recent,
        recentArtists,
        recentAlbums,
      ),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 50)
    .map((entry) => entry.track);

  return [seed, ...ranked];
}

function rankedAdaptiveCandidates(current: MusicTrack, library: MusicTrack[]) {
  const radio = readRadioState();
  if (!radio) return [] as Array<{ track: MusicTrack; score: number }>;

  const seed = library.find((track) => track.id === radio.seedTrackId) ?? current;
  const recentList = recentIds();
  const recent = new Set(recentList);
  const recentTracks = recentList
    .map((id) => library.find((track) => track.id === id))
    .filter((track): track is MusicTrack => Boolean(track));
  const recentArtists = new Set(recentTracks.map(normalizedArtist));
  const recentAlbums = new Set(recentTracks.map(normalizedAlbum).filter(Boolean));

  const eligible = library.filter((track) => track.id !== current.id && !track.play_less);
  const cycle = readPlaybackCycle();
  const played = new Set(cycle.playedIds);
  let available = eligible.filter((track) => !played.has(track.id));

  // A track is never eligible again until every other playable track in the
  // current library pool has been exhausted. Only then do we open a new cycle.
  if (!available.length && eligible.length) {
    restartPlaybackCycle(current.id);
    available = eligible;
  }

  return available
    .map((track) => ({
      track,
      score: candidateScore(seed, current, track, radio.mode, recent, recentArtists, recentAlbums),
    }))
    .sort((a, b) => b.score - a.score);
}

export function getAdaptiveDecisionPreview(current: MusicTrack, library: MusicTrack[], limit = 3) {
  return rankedAdaptiveCandidates(current, library).slice(0, Math.max(1, limit));
}

export function chooseAdaptiveNextTrack(
  current: MusicTrack,
  library: MusicTrack[],
  options: { remember?: boolean } = {},
) {
  const ranked = rankedAdaptiveCandidates(current, library);
  if (!ranked.length) return null;

  // Do not deterministically hammer the single highest score. Randomize within
  // the best unplayed candidates while preserving the steering bias.
  const radio = readRadioState();
  const closeMatchMode = radio?.mode === "more_like_this";
  const explore = closeMatchMode && Math.random() < 0.12;
  const poolSize = closeMatchMode
    ? Math.min(explore ? 8 : 3, ranked.length)
    : Math.min(10, Math.max(3, Math.ceil(Math.sqrt(ranked.length))));
  const pool = ranked.slice(0, Math.max(1, poolSize));
  const floor = pool[pool.length - 1]?.score ?? 0;
  const weighted = pool.map((entry) => ({ ...entry, weight: Math.max(1, entry.score - floor + 6) }));
  const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = Math.random() * totalWeight;
  let next = weighted[0]?.track ?? null;
  for (const entry of weighted) {
    roll -= entry.weight;
    if (roll <= 0) { next = entry.track; break; }
  }

  if (next && options.remember !== false) {
    rememberTrack(next.id);
    markCyclePlayed(next.id);
  }

  return next;
}

export function isAutoMixEnabled() {
  const stored = readJson<boolean | null>(KEYS.autoMix, null);
  return stored == null ? true : stored;
}

export function setAutoMixEnabled(enabled: boolean) {
  writeJson(KEYS.autoMix, Boolean(enabled));
}

export async function syncLikedSongsPlaylist(library: MusicTrack[]) {
  const playlists = await listMusicPlaylists();

  let playlist =
    playlists.find(
      (item) =>
        item.name.trim().toLowerCase() ===
        LIKED_SONGS_PLAYLIST_NAME.toLowerCase(),
    ) ?? null;

  if (!playlist) {
    playlist = await createMusicPlaylist(LIKED_SONGS_PLAYLIST_NAME);
  }

  const ids = library
    .filter((track) => track.favorite)
    .sort(
      (a, b) =>
        new Date(b.updated_at).getTime() -
        new Date(a.updated_at).getTime(),
    )
    .map((track) => track.id);

  await replaceMusicPlaylistTracks(playlist.id, ids);

  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("mvp:music-playlists-changed"));
  }

  return playlist;
}

function staleHours(track: MusicTrack) {
  if (!track.last_played_at) return Number.POSITIVE_INFINITY;
  return Math.max(
    0,
    (Date.now() - new Date(track.last_played_at).getTime()) / 3600000,
  );
}

export function buildDiscoveryRadar(library: MusicTrack[]) {
  const available = library.filter((track) => !track.play_less);

  return [
    {
      id: "forgotten",
      title: "Forgotten Favorites",
      subtitle: "Liked songs you have not heard lately",
      tracks: [...available]
        .filter((track) => track.favorite && staleHours(track) > 336)
        .sort((a, b) => staleHours(b) - staleHours(a))
        .slice(0, 16),
    },
    {
      id: "ninety",
      title: "Haven't Played in 90 Days",
      subtitle: "Strong library tracks that have been quiet for months",
      tracks: [...available]
        .filter((track) => staleHours(track) > 2160)
        .sort((a, b) => getSongDna(b).workoutFit - getSongDna(a).workoutFit)
        .slice(0, 16),
    },
    {
      id: "deep",
      title: "Deep Cuts",
      subtitle: "Low-play tracks with strong workout potential",
      tracks: [...available]
        .filter(
          (track) => track.play_count <= 4 && track.skip_count <= 1,
        )
        .sort(
          (a, b) =>
            getSongDna(b).workoutFit - getSongDna(a).workoutFit,
        )
        .slice(0, 16),
    },
    {
      id: "rare",
      title: "Rarely Played",
      subtitle: "Hidden corners of your uploaded library",
      tracks: [...available]
        .sort((a, b) => a.play_count - b.play_count)
        .slice(0, 16),
    },
    {
      id: "energy",
      title: "High-Energy Rediscovery",
      subtitle: "Hard-driving tracks you have not heard lately",
      tracks: [...available]
        .filter(
          (track) =>
            track.energy_level === "high" &&
            staleHours(track) > 168,
        )
        .sort(
          (a, b) =>
            getSongDna(b).workoutFit - getSongDna(a).workoutFit,
        )
        .slice(0, 16),
    },
    {
      id: "recent-liked",
      title: "Recently Liked",
      subtitle: "Your newest permanent Liked Songs additions",
      tracks: [...available]
        .filter((track) => track.favorite)
        .sort(
          (a, b) =>
            new Date(b.updated_at).getTime() -
            new Date(a.updated_at).getTime(),
        )
        .slice(0, 16),
    },
  ];
}

export function buildTasteMap(library: MusicTrack[]) {
  const available = library.filter((track) => !track.play_less);

  const definitions = [
    {
      id: "heavy",
      label: "HEAVY",
      subtitle: "Weight, impact, aggression",
      score: (dna: SongDna) => dna.heavy,
    },
    {
      id: "drive",
      label: "HIGH DRIVE",
      subtitle: "Forward motion and workout pace",
      score: (dna: SongDna) => dna.drive,
    },
    {
      id: "melodic",
      label: "MELODIC",
      subtitle: "Hooks and melodic pull",
      score: (dna: SongDna) => dna.melodic,
    },
    {
      id: "dark",
      label: "DARK",
      subtitle: "Darker tonal character",
      score: (dna: SongDna) => dna.dark,
    },
    {
      id: "workout",
      label: "WORKOUT CORE",
      subtitle: "Highest overall training fit",
      score: (dna: SongDna) => dna.workoutFit,
    },
  ];

  return definitions.map((definition) => {
    const tracks = [...available]
      .sort(
        (a, b) =>
          definition.score(getSongDna(b)) -
          definition.score(getSongDna(a)),
      )
      .slice(0, 18);

    const score = tracks.length
      ? Math.round(
          tracks.reduce(
            (sum, track) =>
              sum + definition.score(getSongDna(track)),
            0,
          ) / tracks.length,
        )
      : 0;

    return {
      id: definition.id,
      label: definition.label,
      subtitle: definition.subtitle,
      score,
      tracks,
    };
  });
}

export function recordPrSoundtrack(
  track: MusicTrack,
  details: {
    exerciseName: string;
    setNumber: number;
    records: string[];
  },
) {
  const previous = readJson<PrSoundtrackRecord[]>(
    KEYS.prSoundtrack,
    [],
  );

  const record: PrSoundtrackRecord = {
    id: `${Date.now()}:${track.id}`,
    trackId: track.id,
    title: track.title,
    artist: track.artist || "Unknown Artist",
    exerciseName: details.exerciseName,
    setNumber: details.setNumber,
    records: details.records,
    createdAt: new Date().toISOString(),
  };

  writeJson(KEYS.prSoundtrack, [record, ...previous].slice(0, 100));
  return record;
}

export function listPrSoundtracks() {
  return readJson<PrSoundtrackRecord[]>(KEYS.prSoundtrack, []);
}
