import type { MusicTrack } from "./musicStorage";
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
  | "melodic";

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
  radio: "mvp_music_neural_radio_v2",
  recent: "mvp_music_neural_recent_v2",
  stage: "mvp_music_workout_stage_v2",
  autoMix: "mvp_music_automix_v2",
  prSoundtrack: "mvp_music_pr_soundtrack_v2",
};

type RadioState = {
  seedTrackId: string;
  mode: MusicRadioMode;
  startedAt: string;
};

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

function trackText(track: MusicTrack) {
  return `${track.artist || ""} ${track.album || ""} ${track.title || ""} ${track.genre || ""}`.toLowerCase();
}

function containsAny(value: string, words: string[]) {
  return words.some((word) => value.includes(word));
}

function normalizedArtist(track: MusicTrack) {
  return (track.artist || "Unknown Artist").trim().toLowerCase();
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

export function radioModeLabel(mode: MusicRadioMode) {
  if (mode === "harder") return "Harder";
  if (mode === "heavier") return "Heavier";
  if (mode === "faster") return "Faster";
  if (mode === "melodic") return "More Melodic";
  return "More Like This";
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
  return readJson<string[]>(KEYS.recent, []).slice(0, 24);
}

function rememberTrack(trackId: string) {
  writeJson(
    KEYS.recent,
    [trackId, ...recentIds().filter((id) => id !== trackId)].slice(0, 24),
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
) {
  if (
    candidate.id === current.id ||
    candidate.id === seed.id ||
    candidate.play_less
  ) {
    return -99999;
  }

  const seedDna = getSongDna(seed);
  const candidateDna = getSongDna(candidate);

  let score = 100 - dnaDistance(seedDna, candidateDna, mode);

  if (normalizedArtist(seed) === normalizedArtist(candidate)) score += 20;
  if (normalizedArtist(current) === normalizedArtist(candidate)) score -= 34;

  if (recent.has(candidate.id)) score -= 130;
  if (recentArtists.has(normalizedArtist(candidate))) score -= 24;

  if (mode === "harder") {
    score += Math.max(0, candidateDna.energy - seedDna.energy) * 0.7;
    score += Math.max(0, candidateDna.heavy - seedDna.heavy) * 0.5;
  } else if (mode === "heavier") {
    score += Math.max(0, candidateDna.heavy - seedDna.heavy) * 1.05;
  } else if (mode === "faster") {
    score += Math.max(0, candidateDna.drive - seedDna.drive) * 1.05;
  } else if (mode === "melodic") {
    score +=
      Math.max(0, candidateDna.melodic - seedDna.melodic) * 1.05;
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
    else if (hours > 336) score += 8;
  } else {
    score += 12;
  }

  return score + Math.random() * 4;
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
  };

  writeJson(KEYS.radio, radio);
  rememberTrack(seed.id);

  const recent = new Set(recentIds());
  const recentArtists = new Set<string>();

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
      ),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 50)
    .map((entry) => entry.track);

  return [seed, ...ranked];
}

export function chooseAdaptiveNextTrack(
  current: MusicTrack,
  library: MusicTrack[],
) {
  const radio = readJson<RadioState | null>(KEYS.radio, null);
  if (!radio) return null;

  const seed =
    library.find((track) => track.id === radio.seedTrackId) ?? current;
  const recentList = recentIds();
  const recent = new Set(recentList);
  const recentArtists = new Set(
    recentList
      .map((id) => library.find((track) => track.id === id))
      .filter((track): track is MusicTrack => Boolean(track))
      .map(normalizedArtist),
  );

  const next =
    library
      .filter((track) => track.id !== current.id && !track.play_less)
      .map((track) => ({
        track,
        score: candidateScore(
          seed,
          current,
          track,
          radio.mode,
          recent,
          recentArtists,
        ),
      }))
      .sort((a, b) => b.score - a.score)[0]?.track ?? null;

  if (next) rememberTrack(next.id);
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
      subtitle: "Hidden corners of your library",
      tracks: [...available]
        .sort((a, b) => a.play_count - b.play_count)
        .slice(0, 16),
    },
    {
      id: "energy",
      title: "High-Energy Rediscovery",
      subtitle: "Hard-driving tracks that have cooled off",
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
