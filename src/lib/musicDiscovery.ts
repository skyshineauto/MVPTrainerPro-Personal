import type { MusicTrack } from "./musicStorage";
import { supabase } from "./supabase";

export type MusicDiscoveryCategory = "new_upcoming" | "same_era" | "hidden_era";
export type MusicDiscoveryType = "new_artist" | "new_release" | "modern_match" | "era_match" | "hidden_gem";

export type MusicDiscoveryRecommendation = {
  id: string;
  kind: "track" | "artist" | "album";
  title: string;
  artist: string;
  album: string;
  artworkUrl: string | null;
  genre: string | null;
  year: number | null;
  category: MusicDiscoveryCategory;
  reason: string;
  discoveryType: MusicDiscoveryType;
  previewUrl: string | null;
  storeUrl: string | null;
  inLibrary: boolean;
  toAdd: boolean;
  dismissed: boolean;
};

export type MusicDiscoverySeed = {
  id: string;
  trackId: string;
  trackTitle: string;
  trackArtist: string;
  artworkUrl: string | null;
  seedYear?: number | null;
  createdAt: number;
  refreshedAt: number;
  recommendations: MusicDiscoveryRecommendation[];
};

export type MusicDiscoverySavedSong = {
  id: string;
  recommendationId: string;
  seedId: string;
  seedTrackTitle: string;
  seedTrackArtist: string;
  savedAt: number;
  title: string;
  artist: string;
  album: string;
  artworkUrl: string | null;
  genre: string | null;
  year: number | null;
  category: MusicDiscoveryCategory;
  reason: string;
  discoveryType: MusicDiscoveryType;
  previewUrl: string | null;
  storeUrl: string | null;
  inLibrary: boolean;
};

type DiscoveryPreferenceSignal = {
  trackId: string;
  title: string;
  artist: string;
  genre: string;
  count: number;
  lastAt: number;
};

type CloudSeedRow = {
  seed_id: string;
  track_id: string;
  track_title: string;
  track_artist: string;
  artwork_url: string | null;
  seed_year: number | null;
  created_at: string;
  refreshed_at: string;
  recommendations: MusicDiscoveryRecommendation[] | null;
};

type CloudDiscoverResponse = {
  seed?: MusicDiscoverySeed;
  warning?: string | null;
};

type CloudSavedSongRow = {
  saved_id: string;
  recommendation_id: string;
  seed_id: string;
  seed_track_title: string;
  seed_track_artist: string;
  saved_at: string;
  title: string;
  artist: string;
  album: string;
  artwork_url: string | null;
  genre: string | null;
  year: number | null;
  category: MusicDiscoveryCategory;
  reason: string;
  discovery_type: MusicDiscoveryType;
  preview_url: string | null;
  store_url: string | null;
};

type LibraryTrackPayload = {
  id: string;
  title: string;
  artist: string;
  genre: string;
  releaseYear: number | null;
  energyLevel: string;
  favorite: boolean;
  playLess: boolean;
};

const STORAGE_KEY = "mvp_music_discovery_v2";
const LEGACY_STORAGE_KEY = "mvp_music_discovery_v1";
const PREFERENCE_STORAGE_KEY = "mvp_music_discovery_preferences_v1";
const DELETED_STORAGE_KEY = "mvp_music_discovery_deleted_v1";
const SAVED_SONGS_STORAGE_KEY = "mvp_music_discovery_saved_songs_v1";
const SAVED_SONGS_DELETED_KEY = "mvp_music_discovery_saved_songs_deleted_v1";
const DELETED_TTL_MS = 30 * 86400000;
const EVENT = "mvp:music-discovery-changed";
const CLOUD_TABLE = "music_discovery_seeds";
const HISTORY_TABLE = "music_discovery_history";
const SAVED_SONGS_TABLE = "music_discovery_saved_songs";
const CLOUD_LIMIT = 500;
const MAX_MEMORY_SEEDS = 500;
const MAX_OFFLINE_SEEDS = 40;

let cloudHydrationPromise: Promise<void> | null = null;
let savedSongsHydrationPromise: Promise<void> | null = null;
let memorySeeds: MusicDiscoverySeed[] | null = null;
let memorySavedSongs: MusicDiscoverySavedSong[] | null = null;

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function normalized(value: unknown) {
  return clean(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(feat|featuring|ft)\.?\b.*$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function canonicalTitle(value: unknown) {
  return normalized(value)
    .replace(/\b(remaster(?:ed)?|radio edit|single version|album version|explicit|clean|deluxe|bonus track)\b/g, "")
    .replace(/\b(live(?: at| from)?|acoustic|remix|mix|sped up|slowed(?: down)?|re recording|re recorded)\b.*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function yearFromDate(value: unknown) {
  const match = clean(value).match(/^((?:19|20)\d{2})/);
  return match ? Number(match[1]) : null;
}

function yearFromTrack(track: MusicTrack) {
  const source = track as MusicTrack & {
    year?: number | string | null;
    release_year?: number | string | null;
    releaseDate?: string | null;
    release_date?: string | null;
  };
  const numeric = Number(source.year ?? source.release_year ?? 0);
  if (numeric >= 1900 && numeric <= new Date().getFullYear() + 1) return numeric;
  return yearFromDate(source.releaseDate ?? source.release_date);
}

function safeCategory(value: unknown): MusicDiscoveryCategory {
  if (value === "new_upcoming" || value === "hidden_era") return value;
  return "same_era";
}

function safeDiscoveryType(value: unknown, category: MusicDiscoveryCategory): MusicDiscoveryType {
  if (value === "new_artist" || value === "new_release" || value === "modern_match" || value === "era_match" || value === "hidden_gem") return value;
  if (category === "new_upcoming") return "new_release";
  if (category === "hidden_era") return "hidden_gem";
  return "era_match";
}

function sanitizeRecommendation(value: unknown): MusicDiscoveryRecommendation | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<MusicDiscoveryRecommendation>;
  const title = clean(row.title);
  const artist = clean(row.artist);
  if (!title || !artist) return null;
  const category = safeCategory(row.category);
  return {
    id: clean(row.id) || `track:${normalized(artist)}:${canonicalTitle(title)}`,
    kind: row.kind === "artist" || row.kind === "album" ? row.kind : "track",
    title,
    artist,
    album: clean(row.album),
    artworkUrl: clean(row.artworkUrl) || null,
    genre: clean(row.genre) || null,
    year: Number(row.year) >= 1900 ? Number(row.year) : null,
    category,
    reason: clean(row.reason) || "Related discovery",
    discoveryType: safeDiscoveryType((row as Partial<MusicDiscoveryRecommendation>).discoveryType, category),
    previewUrl: clean((row as Partial<MusicDiscoveryRecommendation>).previewUrl) || null,
    storeUrl: clean((row as Partial<MusicDiscoveryRecommendation>).storeUrl) || null,
    inLibrary: Boolean(row.inLibrary),
    toAdd: Boolean(row.toAdd),
    dismissed: Boolean(row.dismissed),
  };
}

function sanitizeSeed(value: unknown): MusicDiscoverySeed | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<MusicDiscoverySeed>;
  const trackId = clean(row.trackId);
  const id = clean(row.id) || (trackId ? `seed:${trackId}` : "");
  if (!id || !trackId) return null;
  const recommendations = Array.isArray(row.recommendations)
    ? row.recommendations.map(sanitizeRecommendation).filter((item): item is MusicDiscoveryRecommendation => Boolean(item))
    : [];
  return {
    id,
    trackId,
    trackTitle: clean(row.trackTitle) || "Current Song",
    trackArtist: clean(row.trackArtist) || "Unknown Artist",
    artworkUrl: clean(row.artworkUrl) || null,
    seedYear: Number(row.seedYear) >= 1900 ? Number(row.seedYear) : null,
    createdAt: Number(row.createdAt) || Date.now(),
    refreshedAt: Number(row.refreshedAt) || Date.now(),
    recommendations,
  };
}

function sanitizeSavedSong(value: unknown): MusicDiscoverySavedSong | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<MusicDiscoverySavedSong>;
  const title = clean(row.title);
  const artist = clean(row.artist);
  const recommendationId = clean(row.recommendationId);
  const id = clean(row.id) || recommendationId;
  if (!id || !recommendationId || !title || !artist) return null;
  const category = safeCategory(row.category);
  return {
    id,
    recommendationId,
    seedId: clean(row.seedId),
    seedTrackTitle: clean(row.seedTrackTitle) || "Rediscover",
    seedTrackArtist: clean(row.seedTrackArtist) || "Unknown Artist",
    savedAt: Number(row.savedAt) || Date.now(),
    title,
    artist,
    album: clean(row.album),
    artworkUrl: clean(row.artworkUrl) || null,
    genre: clean(row.genre) || null,
    year: Number(row.year) >= 1900 ? Number(row.year) : null,
    category,
    reason: clean(row.reason) || "Saved from Rediscover",
    discoveryType: safeDiscoveryType(row.discoveryType, category),
    previewUrl: clean(row.previewUrl) || null,
    storeUrl: clean(row.storeUrl) || null,
    inLibrary: Boolean(row.inLibrary),
  };
}

type DeletedSeedTombstone = { seedId: string; deletedAt: number };

function readDeletedSeedTombstones(): DeletedSeedTombstone[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(DELETED_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - DELETED_TTL_MS;
    return parsed
      .map((row) => ({ seedId: clean(row?.seedId), deletedAt: Number(row?.deletedAt) || 0 }))
      .filter((row) => row.seedId && row.deletedAt >= cutoff);
  } catch {
    return [];
  }
}

function writeDeletedSeedTombstones(rows: DeletedSeedTombstone[]) {
  if (typeof window === "undefined") return;
  try {
    const cutoff = Date.now() - DELETED_TTL_MS;
    const deduped = new Map<string, DeletedSeedTombstone>();
    for (const row of rows) {
      if (!row.seedId || row.deletedAt < cutoff) continue;
      const current = deduped.get(row.seedId);
      if (!current || row.deletedAt > current.deletedAt) deduped.set(row.seedId, row);
    }
    window.localStorage.setItem(DELETED_STORAGE_KEY, JSON.stringify([...deduped.values()]));
  } catch {
    // Deletion still works through Supabase even when localStorage is unavailable.
  }
}

function markSeedDeleted(seedId: string) {
  writeDeletedSeedTombstones([{ seedId, deletedAt: Date.now() }, ...readDeletedSeedTombstones()]);
}

function clearSeedDeleted(seedId: string) {
  writeDeletedSeedTombstones(readDeletedSeedTombstones().filter((row) => row.seedId !== seedId));
}

function locallyDeletedSeedIds() {
  return new Set(readDeletedSeedTombstones().map((row) => row.seedId));
}

type DeletedSavedSongTombstone = { savedId: string; deletedAt: number };

function readDeletedSavedSongTombstones(): DeletedSavedSongTombstone[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SAVED_SONGS_DELETED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - DELETED_TTL_MS;
    return parsed
      .map((row) => ({ savedId: clean(row?.savedId), deletedAt: Number(row?.deletedAt) || 0 }))
      .filter((row) => row.savedId && row.deletedAt >= cutoff);
  } catch {
    return [];
  }
}

function writeDeletedSavedSongTombstones(rows: DeletedSavedSongTombstone[]) {
  if (typeof window === "undefined") return;
  try {
    const cutoff = Date.now() - DELETED_TTL_MS;
    const deduped = new Map<string, DeletedSavedSongTombstone>();
    for (const row of rows) {
      if (!row.savedId || row.deletedAt < cutoff) continue;
      const current = deduped.get(row.savedId);
      if (!current || row.deletedAt > current.deletedAt) deduped.set(row.savedId, row);
    }
    window.localStorage.setItem(SAVED_SONGS_DELETED_KEY, JSON.stringify([...deduped.values()]));
  } catch {
    // Saved-song cloud state remains usable when localStorage is unavailable.
  }
}

function markSavedSongDeleted(savedId: string) {
  writeDeletedSavedSongTombstones([{ savedId, deletedAt: Date.now() }, ...readDeletedSavedSongTombstones()]);
}

function clearSavedSongDeleted(savedId: string) {
  writeDeletedSavedSongTombstones(readDeletedSavedSongTombstones().filter((row) => row.savedId !== savedId));
}

function locallyDeletedSavedSongIds() {
  return new Set(readDeletedSavedSongTombstones().map((row) => row.savedId));
}

function parseLocalStorageKey(key: string): MusicDiscoverySeed[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizeSeed).filter((seed): seed is MusicDiscoverySeed => Boolean(seed));
  } catch {
    return [];
  }
}

function safeParse(): MusicDiscoverySeed[] {
  const deleted = locallyDeletedSeedIds();
  if (memorySeeds) return memorySeeds.filter((seed) => !deleted.has(seed.id));
  const current = parseLocalStorageKey(STORAGE_KEY).filter((seed) => !deleted.has(seed.id));
  if (current.length) {
    memorySeeds = current.slice(0, MAX_MEMORY_SEEDS);
    return memorySeeds;
  }
  const legacy = parseLocalStorageKey(LEGACY_STORAGE_KEY).filter((seed) => !deleted.has(seed.id));
  if (legacy.length) saveLocal(legacy);
  return memorySeeds ?? legacy;
}

function saveLocal(seeds: MusicDiscoverySeed[]) {
  const deleted = locallyDeletedSeedIds();
  const deduped = new Map<string, MusicDiscoverySeed>();
  for (const seed of [...seeds].sort((a, b) => b.refreshedAt - a.refreshedAt)) {
    if (!deleted.has(seed.id) && !deduped.has(seed.id)) deduped.set(seed.id, seed);
  }
  const next = [...deduped.values()].slice(0, MAX_MEMORY_SEEDS);
  memorySeeds = next;

  if (typeof window !== "undefined") {
    try {
      // Keep the permanent archive in Supabase and only a recent offline slice in localStorage.
      // This avoids browser quota failures when the account grows to hundreds of Rediscover seeds.
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next.slice(0, MAX_OFFLINE_SEEDS)));
    } catch {
      // The in-memory/cloud archive remains usable even if browser storage is unavailable.
    }
    window.dispatchEvent(new Event(EVENT));
  }
}

function replaceLocalSeed(seed: MusicDiscoverySeed) {
  clearSeedDeleted(seed.id);
  const existing = safeParse();
  saveLocal([seed, ...existing.filter((item) => item.id !== seed.id)]);
}

function safeSavedSongsParse(): MusicDiscoverySavedSong[] {
  const deleted = locallyDeletedSavedSongIds();
  if (memorySavedSongs) return memorySavedSongs.filter((song) => !deleted.has(song.id));
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SAVED_SONGS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    memorySavedSongs = parsed
      .map(sanitizeSavedSong)
      .filter((song): song is MusicDiscoverySavedSong => song !== null && !deleted.has(song.id))
      .sort((a, b) => b.savedAt - a.savedAt);
    return memorySavedSongs;
  } catch {
    return [];
  }
}

function saveSavedSongsLocal(songs: MusicDiscoverySavedSong[]) {
  const deleted = locallyDeletedSavedSongIds();
  const deduped = new Map<string, MusicDiscoverySavedSong>();
  for (const song of [...songs].sort((a, b) => b.savedAt - a.savedAt)) {
    if (!deleted.has(song.id) && !deduped.has(song.id)) deduped.set(song.id, song);
  }
  memorySavedSongs = [...deduped.values()];
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(SAVED_SONGS_STORAGE_KEY, JSON.stringify(memorySavedSongs)); } catch { /* Cloud remains authoritative. */ }
    window.dispatchEvent(new Event(EVENT));
  }
}

function readPreferenceSignals(): DiscoveryPreferenceSignal[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PREFERENCE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function rememberDiscoveryPreference(track: MusicTrack) {
  if (typeof window === "undefined") return;
  try {
    const artist = clean((track as MusicTrack & { artist?: string | null }).artist);
    const genre = clean((track as MusicTrack & { genre?: string | null }).genre);
    const current = readPreferenceSignals();
    const existing = current.find((item) => item.trackId === track.id);
    const signal: DiscoveryPreferenceSignal = {
      trackId: track.id,
      title: clean(track.title),
      artist,
      genre,
      count: Math.min(12, (existing?.count ?? 0) + 1),
      lastAt: Date.now(),
    };
    const next = [signal, ...current.filter((item) => item.trackId !== track.id)]
      .sort((a, b) => b.lastAt - a.lastAt)
      .slice(0, 100);
    window.localStorage.setItem(PREFERENCE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Preference history must never interfere with playback.
  }
}

function trackToLibraryPayload(track: MusicTrack): LibraryTrackPayload {
  const source = track as MusicTrack & {
    artist?: string | null;
    genre?: string | null;
    energy_level?: string | null;
    favorite?: boolean;
    play_less?: boolean;
  };
  return {
    id: track.id,
    title: clean(track.title),
    artist: clean(source.artist),
    genre: clean(source.genre),
    releaseYear: yearFromTrack(track),
    energyLevel: clean(source.energy_level),
    favorite: Boolean(source.favorite),
    playLess: Boolean(source.play_less),
  };
}

function cloudRowToSeed(row: CloudSeedRow): MusicDiscoverySeed | null {
  return sanitizeSeed({
    id: row.seed_id,
    trackId: row.track_id,
    trackTitle: row.track_title,
    trackArtist: row.track_artist,
    artworkUrl: row.artwork_url,
    seedYear: row.seed_year,
    createdAt: new Date(row.created_at).getTime(),
    refreshedAt: new Date(row.refreshed_at).getTime(),
    recommendations: row.recommendations ?? [],
  });
}

function cloudRowToSavedSong(row: CloudSavedSongRow): MusicDiscoverySavedSong | null {
  return sanitizeSavedSong({
    id: row.saved_id,
    recommendationId: row.recommendation_id,
    seedId: row.seed_id,
    seedTrackTitle: row.seed_track_title,
    seedTrackArtist: row.seed_track_artist,
    savedAt: new Date(row.saved_at).getTime(),
    title: row.title,
    artist: row.artist,
    album: row.album,
    artworkUrl: row.artwork_url,
    genre: row.genre,
    year: row.year,
    category: row.category,
    reason: row.reason,
    discoveryType: row.discovery_type,
    previewUrl: row.preview_url,
    storeUrl: row.store_url,
    inLibrary: false,
  });
}

async function currentUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user?.id ?? null;
}

async function persistSeedToCloud(seed: MusicDiscoverySeed) {
  try {
    if (locallyDeletedSeedIds().has(seed.id)) return;
    const userId = await currentUserId();
    if (!userId) return;
    await supabase.from(CLOUD_TABLE).upsert({
      user_id: userId,
      seed_id: seed.id,
      track_id: seed.trackId,
      track_title: seed.trackTitle,
      track_artist: seed.trackArtist,
      artwork_url: seed.artworkUrl,
      seed_year: seed.seedYear ?? null,
      created_at: new Date(seed.createdAt).toISOString(),
      refreshed_at: new Date(seed.refreshedAt).toISOString(),
      recommendations: seed.recommendations,
      deleted_at: null,
    }, { onConflict: "user_id,seed_id" });
  } catch {
    // Cloud persistence is best-effort; local state stays usable.
  }
}

export async function hydrateMusicDiscoveryFromCloud() {
  if (cloudHydrationPromise) return cloudHydrationPromise;
  cloudHydrationPromise = (async () => {
    try {
      const userId = await currentUserId();
      if (!userId) return;
      const { data, error } = await supabase
        .from(CLOUD_TABLE)
        .select("seed_id,track_id,track_title,track_artist,artwork_url,seed_year,created_at,refreshed_at,recommendations")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .order("refreshed_at", { ascending: false })
        .limit(CLOUD_LIMIT);
      if (error || !Array.isArray(data)) return;
      const deleted = locallyDeletedSeedIds();
      const cloudSeeds = (data as CloudSeedRow[])
        .map(cloudRowToSeed)
        .filter((seed): seed is MusicDiscoverySeed => seed !== null && !deleted.has(seed.id));
      // Once the signed-in cloud table is reachable it becomes authoritative. This deliberately
      // removes old device-only Rediscover results so mobile and desktop show the same account data.
      saveLocal(cloudSeeds);
    } catch {
      // Offline/mobile browser failures must not wipe cached discovery results.
    } finally {
      cloudHydrationPromise = null;
    }
  })();
  return cloudHydrationPromise;
}

export async function hydrateMusicDiscoverySavedSongsFromCloud() {
  if (savedSongsHydrationPromise) return savedSongsHydrationPromise;
  savedSongsHydrationPromise = (async () => {
    try {
      const userId = await currentUserId();
      if (!userId) return;
      const { data, error } = await supabase
        .from(SAVED_SONGS_TABLE)
        .select("saved_id,recommendation_id,seed_id,seed_track_title,seed_track_artist,saved_at,title,artist,album,artwork_url,genre,year,category,reason,discovery_type,preview_url,store_url")
        .eq("user_id", userId)
        .order("saved_at", { ascending: false })
        .limit(1000);
      if (error || !Array.isArray(data)) return;
      const deleted = locallyDeletedSavedSongIds();
      const cloudSongs = (data as CloudSavedSongRow[])
        .map(cloudRowToSavedSong)
        .filter((song): song is MusicDiscoverySavedSong => song !== null && !deleted.has(song.id));
      saveSavedSongsLocal(cloudSongs);
    } catch {
      // Keep the recent local Saved Songs list available while offline.
    } finally {
      savedSongsHydrationPromise = null;
    }
  })();
  return savedSongsHydrationPromise;
}

export function getDiscoverPreferenceBoost(track: MusicTrack) {
  const signals = readPreferenceSignals();
  if (!signals.length) return 0;
  const source = track as MusicTrack & { artist?: string | null; genre?: string | null };
  const trackArtist = normalized(source.artist);
  const trackGenre = normalized(source.genre);
  let boost = 0;
  for (const signal of signals) {
    const strength = Math.min(3, Math.max(1, signal.count));
    if (signal.trackId === track.id) boost += 10 * strength;
    else if (trackArtist && normalized(signal.artist) === trackArtist) boost += 5 * strength;
    else if (trackGenre && normalized(signal.genre) === trackGenre) boost += 2.5 * strength;
  }
  return Math.min(32, boost);
}

export function listMusicDiscoverySeeds() {
  return safeParse().sort((a, b) => b.refreshedAt - a.refreshedAt);
}

export function listMusicDiscoverySavedSongs() {
  return safeSavedSongsParse().sort((a, b) => b.savedAt - a.savedAt);
}

export function subscribeMusicDiscovery(listener: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(EVENT, listener);
  void hydrateMusicDiscoveryFromCloud();
  void hydrateMusicDiscoverySavedSongsFromCloud();
  return () => window.removeEventListener(EVENT, listener);
}

function libraryKeys(libraryTracks: MusicTrack[]) {
  return new Set(
    libraryTracks.map((track) => {
      const artist = (track as MusicTrack & { artist?: string | null }).artist;
      return `${normalized(artist)}|${canonicalTitle(track.title)}`;
    })
  );
}

async function strictBrowserFallback(track: MusicTrack, libraryTracks: MusicTrack[]) {
  const artist = clean((track as MusicTrack & { artist?: string | null }).artist);
  const title = clean(track.title);
  const seedId = `seed:${track.id}`;
  const existing = safeParse();
  const previous = existing.find((seed) => seed.id === seedId);
  const now = Date.now();
  return sanitizeSeed({
    id: seedId,
    trackId: track.id,
    trackTitle: title || "Current Song",
    trackArtist: artist || "Unknown Artist",
    artworkUrl: (track as MusicTrack & { external_artwork_url?: string | null }).external_artwork_url || null,
    seedYear: yearFromTrack(track),
    createdAt: previous?.createdAt ?? now,
    refreshedAt: now,
    recommendations: previous?.recommendations?.map((item) => ({
      ...item,
      inLibrary: libraryKeys(libraryTracks).has(`${normalized(item.artist)}|${canonicalTitle(item.title)}`),
    })) ?? [],
  });
}

export async function discoverMoreFromTrack(track: MusicTrack, libraryTracks: MusicTrack[]) {
  rememberDiscoveryPreference(track);
  clearSeedDeleted(`seed:${track.id}`);

  const source = track as MusicTrack & {
    artist?: string | null;
    genre?: string | null;
    external_artwork_url?: string | null;
  };
  const artist = clean(source.artist);
  const title = clean(track.title);
  if (!artist || !title) {
    const fallback = await strictBrowserFallback(track, libraryTracks);
    if (fallback) replaceLocalSeed(fallback);
    return fallback;
  }

  try {
    const { data, error } = await supabase.functions.invoke("music-rediscover", {
      body: {
        seed: {
          trackId: track.id,
          title,
          artist,
          genre: clean(source.genre),
          year: yearFromTrack(track),
          artworkUrl: source.external_artwork_url || null,
        },
        library: libraryTracks.slice(0, 1200).map(trackToLibraryPayload),
      },
    });

    if (error) throw error;
    const response = (data ?? {}) as CloudDiscoverResponse;
    const cloudSeed = sanitizeSeed(response.seed);
    if (!cloudSeed) throw new Error(response.warning || "Rediscover returned no usable seed");
    replaceLocalSeed(cloudSeed);
    return cloudSeed;
  } catch {
    const fallback = await strictBrowserFallback(track, libraryTracks);
    if (fallback) replaceLocalSeed(fallback);
    return fallback;
  }
}

export function setDiscoveryRecommendationState(
  seedId: string,
  recommendationId: string,
  patch: Partial<Pick<MusicDiscoveryRecommendation, "toAdd" | "dismissed">>
) {
  const seeds = safeParse();
  const next = seeds.map((seed) => seed.id !== seedId ? seed : {
    ...seed,
    recommendations: seed.recommendations.map((item) =>
      item.id !== recommendationId ? item : { ...item, ...patch }
    ),
  });
  const changedSeed = next.find((seed) => seed.id === seedId) ?? null;
  const changedRecommendation = changedSeed?.recommendations.find((item) => item.id === recommendationId) ?? null;

  saveLocal(next);
  if (changedSeed) void persistSeedToCloud(changedSeed);

  if (patch.dismissed && changedRecommendation) {
    const item: MusicDiscoveryRecommendation = changedRecommendation;
    void (async () => {
      try {
        const userId = await currentUserId();
        if (!userId) return;
        await supabase.from(HISTORY_TABLE).upsert({
          user_id: userId,
          recommendation_id: item.id,
          artist: item.artist,
          title: item.title,
          category: item.category,
          dismissed: true,
          last_seen_at: new Date().toISOString(),
        }, { onConflict: "user_id,recommendation_id" });
      } catch {
        // Local dismissal remains authoritative until the next successful sync.
      }
    })();
  }
}

export async function saveMusicDiscoveryRecommendation(
  seed: MusicDiscoverySeed,
  item: MusicDiscoveryRecommendation
) {
  const saved: MusicDiscoverySavedSong = {
    id: item.id,
    recommendationId: item.id,
    seedId: seed.id,
    seedTrackTitle: seed.trackTitle,
    seedTrackArtist: seed.trackArtist,
    savedAt: Date.now(),
    title: item.title,
    artist: item.artist,
    album: item.album,
    artworkUrl: item.artworkUrl,
    genre: item.genre,
    year: item.year,
    category: item.category,
    reason: item.reason,
    discoveryType: item.discoveryType,
    previewUrl: item.previewUrl,
    storeUrl: item.storeUrl,
    inLibrary: item.inLibrary,
  };

  clearSavedSongDeleted(saved.id);
  saveSavedSongsLocal([saved, ...safeSavedSongsParse().filter((song) => song.id !== saved.id)]);
  setDiscoveryRecommendationState(seed.id, item.id, { toAdd: true });

  try {
    const userId = await currentUserId();
    if (!userId) return saved;
    const { error } = await supabase.from(SAVED_SONGS_TABLE).upsert({
      user_id: userId,
      saved_id: saved.id,
      recommendation_id: saved.recommendationId,
      seed_id: saved.seedId,
      seed_track_title: saved.seedTrackTitle,
      seed_track_artist: saved.seedTrackArtist,
      saved_at: new Date(saved.savedAt).toISOString(),
      title: saved.title,
      artist: saved.artist,
      album: saved.album,
      artwork_url: saved.artworkUrl,
      genre: saved.genre,
      year: saved.year,
      category: saved.category,
      reason: saved.reason,
      discovery_type: saved.discoveryType,
      preview_url: saved.previewUrl,
      store_url: saved.storeUrl,
    }, { onConflict: "user_id,saved_id" });
    if (error) throw error;
  } catch {
    // The local saved copy stays visible and can sync on a later save.
  }

  return saved;
}

export async function removeMusicDiscoverySavedSong(savedId: string) {
  const previous = safeSavedSongsParse();
  markSavedSongDeleted(savedId);
  saveSavedSongsLocal(previous.filter((song) => song.id !== savedId));

  const affectedSeeds = safeParse()
    .filter((seed) => seed.recommendations.some((item) => item.id === savedId && item.toAdd))
    .map((seed) => ({
      ...seed,
      recommendations: seed.recommendations.map((item) => item.id === savedId ? { ...item, toAdd: false } : item),
    }));
  if (affectedSeeds.length) {
    const unaffected = safeParse().filter((seed) => !affectedSeeds.some((changed) => changed.id === seed.id));
    saveLocal([...affectedSeeds, ...unaffected]);
    affectedSeeds.forEach((seed) => void persistSeedToCloud(seed));
  }

  try {
    const userId = await currentUserId();
    if (!userId) return true;
    const { error } = await supabase
      .from(SAVED_SONGS_TABLE)
      .delete()
      .eq("user_id", userId)
      .eq("saved_id", savedId);
    if (error) throw error;
    return true;
  } catch {
    // Keep the local tombstone so a stale cloud refresh does not immediately resurrect the song.
    // A later explicit save clears the tombstone and re-adds the song.
    return false;
  }
}

export async function removeDiscoverySeed(seedId: string) {
  markSeedDeleted(seedId);
  saveLocal(safeParse().filter((seed) => seed.id !== seedId));

  try {
    const userId = await currentUserId();
    if (!userId) return true;

    const { error: tombstoneError } = await supabase
      .from(CLOUD_TABLE)
      .update({ deleted_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("seed_id", seedId);

    if (!tombstoneError) return true;

    // Backward-compatible fallback if the migration has not reached a device yet.
    const { error: deleteError } = await supabase
      .from(CLOUD_TABLE)
      .delete()
      .eq("user_id", userId)
      .eq("seed_id", seedId);

    return !deleteError;
  } catch {
    // The local tombstone prevents the deleted seed from immediately resurrecting.
    return false;
  }
}

export function refreshDiscoveryLibraryFlags(libraryTracks: MusicTrack[]) {
  const library = libraryKeys(libraryTracks);
  const seeds = safeParse().map((seed) => ({
    ...seed,
    recommendations: seed.recommendations.map((item) => {
      const inLibrary = item.kind === "track"
        ? library.has(`${normalized(item.artist)}|${canonicalTitle(item.title)}`)
        : false;
      return {
        ...item,
        category: safeCategory(item.category),
        inLibrary,
      };
    }),
  }));
  saveLocal(seeds);

  const savedSongs = safeSavedSongsParse().map((song) => ({
    ...song,
    inLibrary: library.has(`${normalized(song.artist)}|${canonicalTitle(song.title)}`),
  }));
  saveSavedSongsLocal(savedSongs);
}
