import type { MusicTrack } from "./musicStorage";

export type MusicDiscoveryRecommendation = {
  id: string;
  kind: "track" | "artist" | "album";
  title: string;
  artist: string;
  album: string;
  artworkUrl: string | null;
  genre: string | null;
  year: number | null;
  reason: string;
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
  createdAt: number;
  refreshedAt: number;
  recommendations: MusicDiscoveryRecommendation[];
};

const STORAGE_KEY = "mvp_music_discovery_v1";
const PREFERENCE_STORAGE_KEY = "mvp_music_discovery_preferences_v1";
const EVENT = "mvp:music-discovery-changed";

type DiscoveryPreferenceSignal = {
  trackId: string;
  title: string;
  artist: string;
  genre: string;
  count: number;
  lastAt: number;
};

function safeParse(): MusicDiscoverySeed[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(seeds: MusicDiscoverySeed[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeds.slice(0, 18)));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    // Discovery remains best-effort if browser storage is unavailable.
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
      .slice(0, 80);
    window.localStorage.setItem(PREFERENCE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Smart Mix can continue without optional discovery preference history.
  }
}

export function getDiscoverPreferenceBoost(track: MusicTrack) {
  const signals = readPreferenceSignals();
  if (!signals.length) return 0;
  const trackArtist = normalized((track as MusicTrack & { artist?: string | null }).artist);
  const trackGenre = normalized((track as MusicTrack & { genre?: string | null }).genre);
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

export function subscribeMusicDiscovery(listener: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}
function normalized(value: unknown) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function libraryKeys(libraryTracks: MusicTrack[]) {
  return new Set(libraryTracks.map((track) => `${normalized((track as any).artist)}|${normalized(track.title)}`));
}
function yearFromDate(value: unknown) {
  const match = clean(value).match(/^(\d{4})/);
  return match ? Number(match[1]) : null;
}
function highResArtwork(value: unknown) {
  const url = clean(value);
  return url ? url.replace(/\/100x100bb\./, "/600x600bb.") : null;
}

async function fetchJson(url: string) {
  const response = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Discovery lookup ${response.status}`);
  return response.json() as Promise<any>;
}

async function searchItunes(term: string, entity: "musicTrack" | "musicArtist" | "album", limit: number) {
  const params = new URLSearchParams({ term, entity, limit: String(limit), media: "music", country: "US" });
  return fetchJson(`https://itunes.apple.com/search?${params.toString()}`);
}

function candidateId(kind: string, artist: string, title: string, album: string) {
  return `${kind}:${normalized(artist)}:${normalized(title)}:${normalized(album)}`;
}

export async function discoverMoreFromTrack(track: MusicTrack, libraryTracks: MusicTrack[]) {
  rememberDiscoveryPreference(track);
  const artist = clean((track as MusicTrack & { artist?: string | null }).artist);
  const title = clean(track.title);
  const genre = clean((track as any).genre);
  const seedId = `seed:${track.id}`;
  const existing = safeParse();
  const previous = existing.find((seed) => seed.id === seedId);
  const library = libraryKeys(libraryTracks);
  const ignored = new Set(previous?.recommendations.filter((item) => item.dismissed).map((item) => item.id) ?? []);
  const toAdd = new Set(previous?.recommendations.filter((item) => item.toAdd).map((item) => item.id) ?? []);
  const collected = new Map<string, MusicDiscoveryRecommendation>();

  const addTrack = (row: any, reason: string) => {
    const rowArtist = clean(row.artistName);
    const rowTitle = clean(row.trackName);
    const album = clean(row.collectionName);
    if (!rowArtist || !rowTitle) return;
    if (normalized(rowArtist) === normalized(artist) && normalized(rowTitle) === normalized(title)) return;
    const id = candidateId("track", rowArtist, rowTitle, album);
    if (ignored.has(id)) return;
    collected.set(id, {
      id, kind: "track", title: rowTitle, artist: rowArtist, album,
      artworkUrl: highResArtwork(row.artworkUrl100), genre: clean(row.primaryGenreName) || null,
      year: yearFromDate(row.releaseDate), reason,
      inLibrary: library.has(`${normalized(rowArtist)}|${normalized(rowTitle)}`),
      toAdd: toAdd.has(id), dismissed: false,
    });
  };
  const addArtist = (row: any, reason: string) => {
    const rowArtist = clean(row.artistName);
    if (!rowArtist || normalized(rowArtist) === normalized(artist)) return;
    const id = candidateId("artist", rowArtist, rowArtist, "");
    if (ignored.has(id)) return;
    collected.set(id, {
      id, kind: "artist", title: rowArtist, artist: rowArtist, album: "",
      artworkUrl: null, genre: clean(row.primaryGenreName) || genre || null, year: null,
      reason, inLibrary: libraryTracks.some((item) => normalized((item as any).artist) === normalized(rowArtist)),
      toAdd: toAdd.has(id), dismissed: false,
    });
  };
  const addAlbum = (row: any, reason: string) => {
    const rowArtist = clean(row.artistName);
    const album = clean(row.collectionName);
    if (!rowArtist || !album) return;
    const id = candidateId("album", rowArtist, album, album);
    if (ignored.has(id)) return;
    collected.set(id, {
      id, kind: "album", title: album, artist: rowArtist, album,
      artworkUrl: highResArtwork(row.artworkUrl100), genre: clean(row.primaryGenreName) || null,
      year: yearFromDate(row.releaseDate), reason,
      inLibrary: libraryTracks.some((item) => normalized((item as any).artist) === normalized(rowArtist) && normalized((item as any).album) === normalized(album)),
      toAdd: toAdd.has(id), dismissed: false,
    });
  };

  const jobs: Array<Promise<void>> = [];
  if (artist) {
    jobs.push(searchItunes(artist, "musicTrack", 30).then((data) => (data.results ?? []).forEach((row: any) => addTrack(row, `More from ${artist}`))).catch(() => undefined));
    jobs.push(searchItunes(artist, "album", 16).then((data) => (data.results ?? []).forEach((row: any) => addAlbum(row, `Albums connected to ${artist}`))).catch(() => undefined));
  }
  const discoveryTerm = genre || `${artist} ${title}`.trim();
  if (discoveryTerm) {
    jobs.push(searchItunes(discoveryTerm, "musicArtist", 22).then((data) => (data.results ?? []).forEach((row: any) => addArtist(row, genre ? `Similar ${genre} artist` : "Related discovery"))).catch(() => undefined));
    jobs.push(searchItunes(discoveryTerm, "musicTrack", 35).then((data) => (data.results ?? []).forEach((row: any) => addTrack(row, genre ? `Similar ${genre} sound` : "Related sound"))).catch(() => undefined));
  }
  await Promise.all(jobs);

  const recommendations = [...collected.values()].slice(0, 40);
  const nextSeed: MusicDiscoverySeed = {
    id: seedId,
    trackId: track.id,
    trackTitle: title || "Current Song",
    trackArtist: artist || "Unknown Artist",
    artworkUrl: (track as any).external_artwork_url || null,
    createdAt: previous?.createdAt ?? Date.now(),
    refreshedAt: Date.now(),
    recommendations,
  };
  save([nextSeed, ...existing.filter((seed) => seed.id !== seedId)]);
  return nextSeed;
}

export function setDiscoveryRecommendationState(seedId: string, recommendationId: string, patch: Partial<Pick<MusicDiscoveryRecommendation, "toAdd" | "dismissed">>) {
  const seeds = safeParse().map((seed) => seed.id !== seedId ? seed : {
    ...seed,
    recommendations: seed.recommendations.map((item) => item.id !== recommendationId ? item : { ...item, ...patch }),
  });
  save(seeds);
}

export function removeDiscoverySeed(seedId: string) {
  save(safeParse().filter((seed) => seed.id !== seedId));
}

export function refreshDiscoveryLibraryFlags(libraryTracks: MusicTrack[]) {
  const library = libraryKeys(libraryTracks);
  const artists = new Set(libraryTracks.map((item) => normalized((item as any).artist)).filter(Boolean));
  const albums = new Set(libraryTracks.map((item) => `${normalized((item as any).artist)}|${normalized((item as any).album)}`).filter((value) => !value.endsWith("|")));
  const seeds = safeParse().map((seed) => ({
    ...seed,
    recommendations: seed.recommendations.map((item) => {
      const inLibrary = item.kind === "track"
        ? library.has(`${normalized(item.artist)}|${normalized(item.title)}`)
        : item.kind === "artist"
          ? artists.has(normalized(item.artist))
          : albums.has(`${normalized(item.artist)}|${normalized(item.album)}`);
      return {
        ...item,
        inLibrary,
        toAdd: inLibrary ? false : item.toAdd,
      };
    }),
  }));
  save(seeds);
}
