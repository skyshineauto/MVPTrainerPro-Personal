export type MusicSongDNA = {
  energy: number;
  heaviness: number;
  aggression: number;
  drive: number;
  intensity: number;
  melodic: number;
  darkness: number;
  brightness: number;
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

export type MusicArtistDNA = Partial<MusicSongDNA> & {
  typicalBpm?: number | null;
};

export type MusicTrackIntelligence = {
  trackId: string;
  artistKey: string;
  artistName: string;
  status: "pending" | "processing" | "complete" | "partial" | "failed" | "stale";
  analysisVersion: number;
  confidence: number;
  source: string[];
  songDna: MusicSongDNA;
  artistDna: MusicArtistDNA;
  bpm: number | null;
  keySignature: string | null;
  tempoLabel: string | null;
  mainGenres: string[];
  subgenres: string[];
  moods: string[];
  characterTags: string[];
  movementTags: string[];
  musicFor: string[];
  description: string | null;
  musicbrainzRecordingId: string | null;
  musicbrainzArtistId: string | null;
  cyaniteTrackId: string | null;
  cyaniteStatus: string | null;
  analyzedAt: string | null;
  updatedAt: string;
  error: string | null;
};

const CACHE_KEY = "mvp_music_intelligence_cache_v1";
const MAX_TRACKS = 1600;

type CacheState = {
  tracks: Record<string, MusicTrackIntelligence>;
  artists: Record<string, MusicArtistDNA>;
};

let memory: CacheState | null = null;

export function normalizeMusicArtistKey(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function blank(): CacheState {
  return { tracks: {}, artists: {} };
}

function read(): CacheState {
  if (memory) return memory;
  if (typeof window === "undefined") {
    memory = blank();
    return memory;
  }
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<CacheState>) : null;
    memory = {
      tracks: parsed?.tracks && typeof parsed.tracks === "object" ? parsed.tracks : {},
      artists: parsed?.artists && typeof parsed.artists === "object" ? parsed.artists : {},
    };
  } catch {
    memory = blank();
  }
  return memory;
}

function write() {
  if (typeof window === "undefined") return;
  const state = read();
  try {
    const entries = Object.values(state.tracks)
      .sort((a, b) => Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || ""))
      .slice(0, MAX_TRACKS);
    state.tracks = Object.fromEntries(entries.map((item) => [item.trackId, item]));
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(state));
  } catch {
    // The database remains authoritative. Cache failure must never block music.
  }
}

export function cacheMusicTrackIntelligence(item: MusicTrackIntelligence) {
  const state = read();
  state.tracks[item.trackId] = item;
  if (item.artistKey && Object.keys(item.artistDna || {}).length) {
    state.artists[item.artistKey] = item.artistDna;
  }
  write();
}

export function cacheMusicTrackIntelligenceMany(items: MusicTrackIntelligence[]) {
  const state = read();
  for (const item of items) {
    state.tracks[item.trackId] = item;
    if (item.artistKey && Object.keys(item.artistDna || {}).length) {
      state.artists[item.artistKey] = item.artistDna;
    }
  }
  write();
}

export function getCachedMusicTrackIntelligence(trackId: string) {
  return read().tracks[trackId] ?? null;
}

export function getCachedMusicSongDNA(trackId: string) {
  return getCachedMusicTrackIntelligence(trackId)?.songDna ?? null;
}

export function getCachedMusicArtistDNA(artist: string | null | undefined) {
  const key = normalizeMusicArtistKey(artist);
  return key ? read().artists[key] ?? null : null;
}

export function clearMusicIntelligenceCache(trackId?: string) {
  const state = read();
  if (trackId) delete state.tracks[trackId];
  else memory = blank();
  write();
}
