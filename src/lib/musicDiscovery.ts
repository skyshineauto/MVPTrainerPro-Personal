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
const MAX_RECOMMENDATIONS = 18;

type DiscoveryPreferenceSignal = {
  trackId: string;
  title: string;
  artist: string;
  genre: string;
  count: number;
  lastAt: number;
};

type RelatedArtist = { name: string; mbid: string | null; similarity: number };

type ItunesTrack = {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  artworkUrl100?: string;
  primaryGenreName?: string;
  releaseDate?: string;
};

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
    .replace(/\b(live(?: at| from)?|acoustic|remix|mix)\b.*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function yearFromDate(value: unknown) {
  const match = clean(value).match(/^((?:19|20)\d{2})/);
  return match ? Number(match[1]) : null;
}

function highResArtwork(value: unknown) {
  const url = clean(value);
  return url
    ? url
        .replace(/\/100x100bb\./, "/600x600bb.")
        .replace(/\/100x100bb-/, "/600x600bb-")
    : null;
}

function safeParse(): MusicDiscoverySeed[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((seed) => ({
      ...seed,
      recommendations: Array.isArray(seed?.recommendations) ? seed.recommendations : [],
    }));
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

function libraryKeys(libraryTracks: MusicTrack[]) {
  return new Set(libraryTracks.map((track) => `${normalized((track as MusicTrack & { artist?: string | null }).artist)}|${canonicalTitle(track.title)}`));
}

async function fetchJson(url: string) {
  const response = await fetch(url, {
    method: "GET",
    mode: "cors",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Discovery lookup ${response.status}`);
  return response.json() as Promise<any>;
}

async function searchItunesTracks(term: string, limit: number) {
  const params = new URLSearchParams({ term, entity: "musicTrack", limit: String(limit), media: "music", country: "US" });
  return fetchJson(`https://itunes.apple.com/search?${params.toString()}`) as Promise<{ results?: ItunesTrack[] }>;
}

async function resolveArtistMbid(artist: string) {
  if (!artist) return null;
  const query = `artist:\"${artist.replace(/\"/g, "")}\"`;
  const params = new URLSearchParams({ query, fmt: "json", limit: "5" });
  try {
    const data = await fetchJson(`https://musicbrainz.org/ws/2/artist/?${params.toString()}`);
    const target = normalized(artist);
    const rows = Array.isArray(data?.artists) ? data.artists : [];
    const exact = rows.find((row: any) => normalized(row?.name) === target);
    const best = exact ?? rows[0];
    return clean(best?.id) || null;
  } catch {
    return null;
  }
}

function extractRelatedArtists(payload: any, seedArtist: string) {
  const found = new Map<string, RelatedArtist>();
  const seedKey = normalized(seedArtist);

  const visit = (value: any) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object") return;

    const name = clean(value.similar_artist_name ?? value.artist_name ?? value.name);
    const mbid = clean(value.similar_artist_mbid ?? value.artist_mbid ?? value.mbid) || null;
    if (name && normalized(name) !== seedKey) {
      const key = normalized(name);
      const listenCount = Number(value.total_listen_count ?? value.listen_count ?? 0);
      const similarity = Number(value.similarity ?? 0) || Math.log10(Math.max(10, listenCount)) / 8;
      const current = found.get(key);
      if (!current || similarity > current.similarity) found.set(key, { name, mbid, similarity });
    }
    Object.values(value).forEach(visit);
  };

  visit(payload);
  return [...found.values()]
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, 14);
}

async function relatedArtistsFromListenBrainz(seedMbid: string, seedArtist: string) {
  const params = new URLSearchParams({
    mode: "easy",
    max_similar_artists: "14",
    max_recordings_per_artist: "3",
    pop_begin: "15",
    pop_end: "100",
  });
  try {
    const payload = await fetchJson(`https://api.listenbrainz.org/1/lb-radio/artist/${encodeURIComponent(seedMbid)}?${params.toString()}`);
    return extractRelatedArtists(payload, seedArtist);
  } catch {
    return [];
  }
}

function genreFamily(value: unknown) {
  const genre = normalized(value);
  if (!genre) return "";
  if (/metalcore|post hardcore|hardcore|alternative metal|nu metal/.test(genre)) return "modern-heavy";
  if (/hard rock|alternative rock|rock/.test(genre)) return "rock";
  if (/hip hop|rap/.test(genre)) return "hip-hop";
  if (/country/.test(genre)) return "country";
  if (/electronic|dance|edm|house|techno/.test(genre)) return "electronic";
  if (/pop/.test(genre)) return "pop";
  if (/r&b|soul/.test(genre)) return "rnb";
  if (/jazz|swing|standards/.test(genre)) return "jazz";
  return genre.split(" ").slice(0, 2).join(" ");
}

function candidateId(artist: string, title: string) {
  return `track:${normalized(artist)}:${canonicalTitle(title)}`;
}

function reasonFor(relatedArtist: string, seedGenre: string, rowGenre: string) {
  const family = genreFamily(rowGenre || seedGenre);
  if (family === "modern-heavy") return `Related artist • modern heavy sound`;
  if (family === "rock") return `Related artist • similar rock energy`;
  if (family === "hip-hop") return `Related artist • similar rap energy`;
  if (family === "electronic") return `Related artist • similar electronic energy`;
  return `Related to ${relatedArtist}`;
}

function makeRecommendation(
  row: ItunesTrack,
  relatedArtist: RelatedArtist,
  seed: { artist: string; title: string; genre: string },
  library: Set<string>,
  ignored: Set<string>,
  toAdd: Set<string>
): MusicDiscoveryRecommendation | null {
  const artist = clean(row.artistName);
  const title = clean(row.trackName);
  const album = clean(row.collectionName);
  if (!artist || !title) return null;

  const seedArtistKey = normalized(seed.artist);
  const artistKey = normalized(artist);
  const expectedArtistKey = normalized(relatedArtist.name);
  if (artistKey === seedArtistKey) return null;
  if (artistKey !== expectedArtistKey && !artistKey.includes(expectedArtistKey) && !expectedArtistKey.includes(artistKey)) return null;

  const titleKey = canonicalTitle(title);
  if (!titleKey || titleKey === canonicalTitle(seed.title)) return null;
  if (/\b(karaoke|tribute|cover version|instrumental version)\b/i.test(title)) return null;

  const id = candidateId(artist, title);
  if (ignored.has(id)) return null;

  return {
    id,
    kind: "track",
    title,
    artist,
    album,
    artworkUrl: highResArtwork(row.artworkUrl100),
    genre: clean(row.primaryGenreName) || null,
    year: yearFromDate(row.releaseDate),
    reason: reasonFor(relatedArtist.name, seed.genre, clean(row.primaryGenreName)),
    inLibrary: library.has(`${artistKey}|${titleKey}`),
    toAdd: toAdd.has(id),
    dismissed: false,
  };
}

async function fallbackGenreTracks(seed: { artist: string; title: string; genre: string }) {
  const family = genreFamily(seed.genre);
  if (!family || ["rock", "pop"].includes(family)) return [] as RelatedArtist[];
  // If the related-artist service is unavailable, only use a specific genre family.
  // Broad labels such as "Rock" are intentionally rejected rather than returning junk.
  try {
    const data = await searchItunesTracks(seed.genre, 50);
    const artists = new Map<string, RelatedArtist>();
    for (const row of data.results ?? []) {
      const name = clean(row.artistName);
      if (!name || normalized(name) === normalized(seed.artist)) continue;
      if (genreFamily(row.primaryGenreName) !== family) continue;
      const key = normalized(name);
      if (!artists.has(key)) artists.set(key, { name, mbid: null, similarity: 0.25 });
      if (artists.size >= 10) break;
    }
    return [...artists.values()];
  } catch {
    return [];
  }
}

export async function discoverMoreFromTrack(track: MusicTrack, libraryTracks: MusicTrack[]) {
  rememberDiscoveryPreference(track);

  const artist = clean((track as MusicTrack & { artist?: string | null }).artist);
  const title = clean(track.title);
  const genre = clean((track as MusicTrack & { genre?: string | null }).genre);
  const seedId = `seed:${track.id}`;
  const existing = safeParse();
  const previous = existing.find((seed) => seed.id === seedId);
  const library = libraryKeys(libraryTracks);
  const ignored = new Set(previous?.recommendations.filter((item) => item.dismissed).map((item) => item.id) ?? []);
  const toAdd = new Set(previous?.recommendations.filter((item) => item.toAdd).map((item) => item.id) ?? []);

  const seed = { artist, title, genre };
  const mbid = await resolveArtistMbid(artist);
  let relatedArtists = mbid ? await relatedArtistsFromListenBrainz(mbid, artist) : [];
  if (!relatedArtists.length) relatedArtists = await fallbackGenreTracks(seed);

  const collected = new Map<string, MusicDiscoveryRecommendation>();
  // Limit requests and return a smaller high-confidence set instead of a giant noisy catalog dump.
  for (const relatedArtist of relatedArtists.slice(0, 10)) {
    try {
      const data = await searchItunesTracks(relatedArtist.name, 10);
      const candidates = (data.results ?? [])
        .map((row) => makeRecommendation(row, relatedArtist, seed, library, ignored, toAdd))
        .filter((item): item is MusicDiscoveryRecommendation => Boolean(item));

      for (const item of candidates.slice(0, 2)) {
        // Canonical artist+title ID collapses single/remaster/live catalog variants.
        if (!collected.has(item.id)) collected.set(item.id, item);
      }
    } catch {
      // A single failed artist lookup should not discard the rest of Discover.
    }
    if (collected.size >= MAX_RECOMMENDATIONS) break;
  }

  const recommendations = [...collected.values()].slice(0, MAX_RECOMMENDATIONS);
  const nextSeed: MusicDiscoverySeed = {
    id: seedId,
    trackId: track.id,
    trackTitle: title || "Current Song",
    trackArtist: artist || "Unknown Artist",
    artworkUrl: (track as MusicTrack & { external_artwork_url?: string | null }).external_artwork_url || null,
    createdAt: previous?.createdAt ?? Date.now(),
    refreshedAt: Date.now(),
    recommendations,
  };

  save([nextSeed, ...existing.filter((item) => item.id !== seedId)]);
  return nextSeed;
}

export function setDiscoveryRecommendationState(
  seedId: string,
  recommendationId: string,
  patch: Partial<Pick<MusicDiscoveryRecommendation, "toAdd" | "dismissed">>
) {
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
  const seeds = safeParse().map((seed) => ({
    ...seed,
    recommendations: seed.recommendations.map((item) => {
      const inLibrary = item.kind === "track"
        ? library.has(`${normalized(item.artist)}|${canonicalTitle(item.title)}`)
        : false;
      return {
        ...item,
        inLibrary,
        toAdd: inLibrary ? false : item.toAdd,
      };
    }),
  }));
  save(seeds);
}
