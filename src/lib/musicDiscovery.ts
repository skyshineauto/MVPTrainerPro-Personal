import type { MusicTrack } from "./musicStorage";

export type MusicDiscoveryCategory = "new_upcoming" | "same_era" | "hidden_era";

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

const STORAGE_KEY = "mvp_music_discovery_v1";
const PREFERENCE_STORAGE_KEY = "mvp_music_discovery_preferences_v1";
const EVENT = "mvp:music-discovery-changed";
const MAX_RECOMMENDATIONS = 15;
const TARGET_PER_CATEGORY = 5;
const CURRENT_YEAR = new Date().getFullYear();
const NEW_ARTIST_WINDOW_YEARS = 8;
const RECENT_RELEASE_WINDOW_YEARS = 3;
const ITUNES_CACHE_TTL = 15 * 60 * 1000;

const LASTFM_API_KEY = (() => {
  try {
    const meta = import.meta as ImportMeta & { env?: Record<string, string | undefined> };
    return String(meta.env?.VITE_LASTFM_API_KEY ?? "").trim();
  } catch {
    return "";
  }
})();

type DiscoveryPreferenceSignal = {
  trackId: string;
  title: string;
  artist: string;
  genre: string;
  count: number;
  lastAt: number;
};

type RelatedArtistLane = "direct" | "hidden" | "new" | "library" | "catalog";

type RelatedArtist = {
  name: string;
  mbid: string | null;
  similarity: number;
  style: string;
  source: "deezer" | "listenbrainz" | "musicbrainz" | "lastfm" | "library" | "catalog";
  lane: RelatedArtistLane;
  beginYear: number | null;
};

type ArtistProfile = {
  name: string;
  mbid: string | null;
  tags: Array<{ name: string; count: number }>;
  beginYear: number | null;
};

type ItunesTrack = {
  trackId?: number;
  artistId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  artworkUrl100?: string;
  primaryGenreName?: string;
  releaseDate?: string;
};

type DeezerArtist = {
  id?: number;
  name?: string;
};

type ScoredRecommendation = MusicDiscoveryRecommendation & {
  _score: number;
  _depth: number;
};

type LibraryPreferenceProfile = {
  likedArtists: Set<string>;
  playLessArtists: Set<string>;
  playLessTracks: Set<string>;
};

const itunesCache = new Map<string, { at: number; value: { results?: ItunesTrack[] } }>();

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

function yearFromUnknownTrack(track: MusicTrack) {
  const source = track as MusicTrack & {
    year?: number | string | null;
    release_year?: number | string | null;
    releaseDate?: string | null;
    release_date?: string | null;
  };
  const numeric = Number(source.year ?? source.release_year ?? 0);
  if (numeric >= 1900 && numeric <= CURRENT_YEAR + 1) return numeric;
  return yearFromDate(source.releaseDate ?? source.release_date);
}

function highResArtwork(value: unknown) {
  const url = clean(value);
  return url
    ? url
        .replace(/\/100x100bb\./, "/600x600bb.")
        .replace(/\/100x100bb-/, "/600x600bb-")
    : null;
}

function safeCategory(value: unknown): MusicDiscoveryCategory {
  if (value === "new_upcoming" || value === "hidden_era") return value;
  return "same_era";
}

function safeParse(): MusicDiscoverySeed[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((seed) => ({
      ...seed,
      seedYear: Number(seed?.seedYear) || null,
      recommendations: Array.isArray(seed?.recommendations)
        ? seed.recommendations.map((item: MusicDiscoveryRecommendation) => ({
            ...item,
            category: safeCategory((item as MusicDiscoveryRecommendation & { category?: unknown }).category),
          }))
        : [],
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
    // Preference history must never interfere with playback.
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
  return new Set(
    libraryTracks.map((track) =>
      `${normalized((track as MusicTrack & { artist?: string | null }).artist)}|${canonicalTitle(track.title)}`
    )
  );
}

function libraryPreferenceProfile(libraryTracks: MusicTrack[]): LibraryPreferenceProfile {
  const likedArtists = new Set<string>();
  const playLessArtists = new Set<string>();
  const playLessTracks = new Set<string>();
  const artistCounts = new Map<string, { liked: number; less: number }>();

  for (const track of libraryTracks) {
    const artist = normalized((track as MusicTrack & { artist?: string | null }).artist);
    if (!artist) continue;
    const favorite = Boolean((track as MusicTrack & { favorite?: boolean }).favorite);
    const playLess = Boolean((track as MusicTrack & { play_less?: boolean }).play_less);
    const counts = artistCounts.get(artist) ?? { liked: 0, less: 0 };
    if (favorite) counts.liked += 1;
    if (playLess) {
      counts.less += 1;
      playLessTracks.add(`${artist}|${canonicalTitle(track.title)}`);
    }
    artistCounts.set(artist, counts);
  }

  for (const [artist, counts] of artistCounts) {
    if (counts.liked > counts.less) likedArtists.add(artist);
    if (counts.less >= 2 && counts.less > counts.liked) playLessArtists.add(artist);
  }
  return { likedArtists, playLessArtists, playLessTracks };
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
  const cacheKey = `${normalized(term)}|${limit}`;
  const cached = itunesCache.get(cacheKey);
  if (cached && Date.now() - cached.at < ITUNES_CACHE_TTL) return cached.value;
  const params = new URLSearchParams({
    term,
    entity: "musicTrack",
    limit: String(limit),
    media: "music",
    country: "US",
  });
  const value = await fetchJson(`https://itunes.apple.com/search?${params.toString()}`) as { results?: ItunesTrack[] };
  itunesCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

function tagRows(value: unknown) {
  if (!Array.isArray(value)) return [] as Array<{ name: string; count: number }>;
  return value
    .map((row: any) => ({ name: clean(row?.name), count: Number(row?.count ?? row?.votes ?? 1) || 1 }))
    .filter((row) => Boolean(row.name));
}

const GENERIC_TAGS = new Set([
  "rock", "pop", "alternative", "american", "english", "usa", "male vocalists", "female vocalists",
  "seen live", "favorites", "favourite", "albums i own", "spotify", "00s", "2000s", "2010s", "2020s",
  "band", "music", "awesome", "alternative rock",
]);

function normalizeTag(value: string) {
  return normalized(value).replace(/\s+/g, " ");
}

function specificProfileTags(profile: ArtistProfile, seedGenre: string) {
  const combined = [...profile.tags, ...(seedGenre ? [{ name: seedGenre, count: 8 }] : [])];
  const seen = new Set<string>();
  return combined
    .map((item) => ({ ...item, key: normalizeTag(item.name) }))
    .filter((item) => item.key && !GENERIC_TAGS.has(item.key))
    .filter((item) => {
      if (seen.has(item.key)) return false;
      seen.add(item.key);
      return true;
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
}

async function resolveArtistProfile(artist: string): Promise<ArtistProfile> {
  if (!artist) return { name: "", mbid: null, tags: [], beginYear: null };
  const query = `artist:\"${artist.replace(/\"/g, "")}\"`;
  const params = new URLSearchParams({ query, fmt: "json", limit: "6" });
  try {
    const data = await fetchJson(`https://musicbrainz.org/ws/2/artist/?${params.toString()}`);
    const target = normalized(artist);
    const rows = Array.isArray(data?.artists) ? data.artists : [];
    const exact = rows.find((row: any) => normalized(row?.name) === target);
    const best = exact ?? rows[0];
    const mbid = clean(best?.id) || null;
    const beginYear = yearFromDate(best?.["life-span"]?.begin ?? best?.begin);
    const tags = [...tagRows(best?.tags), ...tagRows(best?.genres)];
    return { name: clean(best?.name) || artist, mbid, tags, beginYear };
  } catch {
    return { name: artist, mbid: null, tags: [], beginYear: null };
  }
}

function familyFromText(value: unknown) {
  const text = normalized(value);
  if (!text) return "";
  if (/psychedelic rock|acid rock/.test(text)) return "psychedelic-rock";
  if (/glam rock|glam metal/.test(text)) return "glam-rock";
  if (/garage rock/.test(text)) return "garage-rock";
  if (/rap rock|rap metal|rapcore|nu metal/.test(text)) return "rap-rock";
  if (/metalcore|post hardcore|posthardcore|hardcore punk|easycore/.test(text)) return "metalcore";
  if (/alternative metal|industrial metal|modern metal/.test(text)) return "alt-metal";
  if (/hard rock|heavy rock/.test(text)) return "hard-rock";
  if (/pop punk|punk rock|emo/.test(text)) return "pop-punk";
  if (/alternative rock|grunge/.test(text)) return "alt-rock";
  if (/indie rock/.test(text)) return "indie-rock";
  if (/hip hop|hiphop|rap/.test(text)) return "hip-hop";
  if (/electronic rock|electronicore/.test(text)) return "electronic-rock";
  if (/electronic|dance|edm|house|techno/.test(text)) return "electronic";
  if (/country/.test(text)) return "country";
  if (/r b|r&b|soul/.test(text)) return "rnb";
  if (/jazz|swing|standards/.test(text)) return "jazz";
  if (/pop/.test(text)) return "pop";
  if (/rock/.test(text)) return "rock";
  return text.split(" ").slice(0, 2).join("-");
}

function styleLabel(value: string) {
  const family = familyFromText(value);
  if (family === "psychedelic-rock") return "Psychedelic rock";
  if (family === "glam-rock") return "Glam-rock DNA";
  if (family === "garage-rock") return "Garage-rock edge";
  if (family === "rap-rock") return "Rap-rock crossover";
  if (family === "metalcore") return "Modern metalcore";
  if (family === "alt-metal") return "Alternative metal";
  if (family === "hard-rock") return "Hard-rock energy";
  if (family === "pop-punk") return "Pop-punk / post-hardcore";
  if (family === "alt-rock") return "Alternative rock";
  if (family === "indie-rock") return "Indie rock";
  if (family === "electronic-rock") return "Electronic rock";
  if (family === "hip-hop") return "Rap / hip-hop adjacency";
  if (family === "electronic") return "Electronic adjacency";
  if (family === "country") return "Country adjacency";
  if (family === "rnb") return "R&B / soul adjacency";
  return clean(value) || "Related artist";
}

function isBadArtistName(value: unknown) {
  return /\b(tribute|karaoke|cover band|the tribute|instrumental versions?)\b/i.test(clean(value));
}

function lanePriority(lane: RelatedArtistLane) {
  if (lane === "new") return 5;
  if (lane === "direct") return 4;
  if (lane === "hidden") return 3;
  if (lane === "library") return 2;
  return 1;
}

function mergeRelatedArtists(...groups: RelatedArtist[][]) {
  const found = new Map<string, RelatedArtist>();
  for (const group of groups) {
    for (const candidate of group) {
      const key = normalized(candidate.name);
      if (!key || isBadArtistName(candidate.name)) continue;
      const current = found.get(key);
      if (!current) {
        found.set(key, candidate);
        continue;
      }
      const stronger = candidate.similarity > current.similarity ? candidate : current;
      found.set(key, {
        ...stronger,
        beginYear: current.beginYear ?? candidate.beginYear,
        lane: lanePriority(candidate.lane) > lanePriority(current.lane) ? candidate.lane : current.lane,
      });
    }
  }
  return [...found.values()].sort((a, b) => b.similarity - a.similarity);
}

async function relatedArtistsFromLastFm(seedArtist: string, seedMbid: string | null): Promise<RelatedArtist[]> {
  if (!LASTFM_API_KEY || !seedArtist) return [];
  try {
    const params = new URLSearchParams({
      method: "artist.getsimilar",
      artist: seedArtist,
      api_key: LASTFM_API_KEY,
      format: "json",
      autocorrect: "1",
      limit: "24",
    });
    if (seedMbid) params.set("mbid", seedMbid);
    const payload = await fetchJson(`https://ws.audioscrobbler.com/2.0/?${params.toString()}`);
    const rows = Array.isArray(payload?.similarartists?.artist) ? payload.similarartists.artist : [];
    return rows
      .map((row: any) => ({
        name: clean(row?.name),
        mbid: clean(row?.mbid) || null,
        similarity: Math.max(0.44, Math.min(1, Number(row?.match) || 0.58)),
        style: "Related artist",
        source: "lastfm" as const,
        lane: "direct" as const,
        beginYear: null,
      }))
      .filter((row: RelatedArtist) => row.name && normalized(row.name) !== normalized(seedArtist) && !isBadArtistName(row.name));
  } catch {
    return [];
  }
}

async function relatedArtistsFromDeezer(seedArtist: string): Promise<RelatedArtist[]> {
  if (!seedArtist) return [];
  try {
    const search = await fetchJson(`https://api.deezer.com/search/artist?q=${encodeURIComponent(seedArtist)}&limit=6`);
    const rows = Array.isArray(search?.data) ? search.data as DeezerArtist[] : [];
    const target = normalized(seedArtist);
    const exact = rows.find((row) => normalized(row?.name) === target) ?? rows[0];
    if (!exact?.id) return [];
    const related = await fetchJson(`https://api.deezer.com/artist/${exact.id}/related?limit=22`);
    const data = Array.isArray(related?.data) ? related.data as DeezerArtist[] : [];
    return data
      .filter((row) => clean(row.name) && normalized(row.name) !== target)
      .slice(0, 22)
      .map((row, index) => ({
        name: clean(row.name),
        mbid: null,
        similarity: Math.max(0.44, 0.97 - index * 0.027),
        style: "Related artist",
        source: "deezer" as const,
        lane: "direct" as const,
        beginYear: null,
      }));
  } catch {
    return [];
  }
}

function extractListenBrainzArtists(payload: any, seedArtist: string, lane: RelatedArtistLane): RelatedArtist[] {
  const target = normalized(seedArtist);
  const found = new Map<string, RelatedArtist>();
  const add = (nameValue: unknown, scoreValue: unknown, beginYearValue?: unknown) => {
    const name = clean(nameValue);
    const key = normalized(name);
    if (!name || !key || key === target || isBadArtistName(name)) return;
    const numeric = Number(scoreValue);
    const similarity = Number.isFinite(numeric) && numeric > 0 ? Math.min(1, numeric) : lane === "hidden" ? 0.59 : 0.68;
    const candidate: RelatedArtist = {
      name,
      mbid: null,
      similarity,
      style: "Related artist",
      source: "listenbrainz",
      lane,
      beginYear: yearFromDate(beginYearValue),
    };
    const current = found.get(key);
    if (!current || similarity > current.similarity) found.set(key, candidate);
  };

  const containers = [payload, payload?.payload, payload?.playlist, payload?.data];
  for (const container of containers) {
    const arrays = [container?.track, container?.recordings, container?.similar_artists, container?.artists];
    for (const rows of arrays) {
      if (!Array.isArray(rows)) continue;
      rows.forEach((row: any, index: number) => add(
        row?.similar_artist_name ?? row?.creator ?? row?.artist_name ?? row?.artist,
        row?.similarity ?? row?.score ?? ((lane === "hidden" ? 0.72 : 0.92) - index * 0.017),
        row?.begin
      ));
    }
  }
  if (Array.isArray(payload)) {
    payload.forEach((row: any, index: number) => add(
      row?.similar_artist_name ?? row?.creator ?? row?.artist_name ?? row?.artist,
      row?.similarity ?? row?.score ?? ((lane === "hidden" ? 0.72 : 0.92) - index * 0.017),
      row?.begin
    ));
  }
  return [...found.values()].sort((a, b) => b.similarity - a.similarity).slice(0, 22);
}

async function relatedArtistsFromListenBrainz(
  seedMbid: string | null,
  seedArtist: string,
  mode: "easy" | "medium" | "hard",
  popBegin: number,
  popEnd: number,
  lane: RelatedArtistLane
) {
  if (!seedMbid) return [] as RelatedArtist[];
  const params = new URLSearchParams({
    mode,
    max_similar_artists: "22",
    max_recordings_per_artist: "3",
    pop_begin: String(popBegin),
    pop_end: String(popEnd),
  });
  try {
    const payload = await fetchJson(`https://api.listenbrainz.org/1/lb-radio/artist/${encodeURIComponent(seedMbid)}?${params.toString()}`);
    return extractListenBrainzArtists(payload, seedArtist, lane);
  } catch {
    return [];
  }
}

async function relatedArtistsFromMusicBrainzTags(profile: ArtistProfile, seedGenre: string) {
  const tags = specificProfileTags(profile, seedGenre).slice(0, 3);
  if (!tags.length) return [] as RelatedArtist[];
  const query = tags.map((tag) => `tag:\"${tag.name.replace(/\"/g, "")}\"`).join(" OR ");
  const params = new URLSearchParams({ query, fmt: "json", limit: "40" });
  try {
    const data = await fetchJson(`https://musicbrainz.org/ws/2/artist/?${params.toString()}`);
    const rows = Array.isArray(data?.artists) ? data.artists : [];
    const seedKey = normalized(profile.name);
    const candidates: RelatedArtist[] = [];
    for (const row of rows) {
      const name = clean(row?.name);
      if (!name || normalized(name) === seedKey || isBadArtistName(name)) continue;
      const rowTags = [...tagRows(row?.tags), ...tagRows(row?.genres)].map((item) => normalizeTag(item.name));
      const matched = tags.find((tag) => rowTags.includes(tag.key)) ?? tags[0];
      const score = Number(row?.score ?? 0) / 100;
      const beginYear = yearFromDate(row?.["life-span"]?.begin ?? row?.begin);
      candidates.push({
        name,
        mbid: clean(row?.id) || null,
        similarity: Math.max(0.40, Math.min(0.86, 0.48 + score * 0.29 + Math.min(0.08, matched.count / 250))),
        style: styleLabel(matched.name),
        source: "musicbrainz",
        lane: beginYear && beginYear >= CURRENT_YEAR - NEW_ARTIST_WINDOW_YEARS ? "new" : "direct",
        beginYear,
      });
    }
    return candidates.slice(0, 26);
  } catch {
    return [];
  }
}

function libraryRelatedArtists(
  seed: { artist: string; genre: string },
  profile: ArtistProfile,
  libraryTracks: MusicTrack[]
) {
  const seedKey = normalized(seed.artist);
  const profileText = specificProfileTags(profile, seed.genre).map((tag) => tag.name).join(" ");
  const seedFamily = familyFromText(profileText || seed.genre);
  const grouped = new Map<string, { name: string; score: number; style: string }>();

  for (const track of libraryTracks) {
    const artist = clean((track as MusicTrack & { artist?: string | null }).artist);
    const genre = clean((track as MusicTrack & { genre?: string | null }).genre);
    const key = normalized(artist);
    if (!artist || !key || key === seedKey || isBadArtistName(artist)) continue;
    const family = familyFromText(genre);
    if (seedFamily && family && family !== seedFamily) continue;
    const sameGenre = normalized(genre) && normalized(genre) === normalized(seed.genre);
    const favorite = Boolean((track as MusicTrack & { favorite?: boolean }).favorite);
    const playLess = Boolean((track as MusicTrack & { play_less?: boolean }).play_less);
    const energy = clean((track as MusicTrack & { energy_level?: string | null }).energy_level);
    let score = sameGenre ? 0.76 : 0.60;
    if (favorite) score += 0.08;
    if (energy === "high") score += 0.025;
    if (playLess) score -= 0.22;
    const current = grouped.get(key);
    if (!current || score > current.score) grouped.set(key, { name: artist, score, style: styleLabel(genre || profileText) });
  }

  return [...grouped.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 16)
    .map((item) => ({
      name: item.name,
      mbid: null,
      similarity: item.score,
      style: item.style,
      source: "library" as const,
      lane: "library" as const,
      beginYear: null,
    }));
}

async function catalogArtistsFromSpecificStyles(profile: ArtistProfile, seedGenre: string, seedArtist: string) {
  const tags = specificProfileTags(profile, seedGenre).slice(0, 3);
  const searchTerms = tags.length ? tags.map((tag) => tag.name) : [seedGenre].filter(Boolean);
  if (!searchTerms.length) return [] as RelatedArtist[];
  const seedKey = normalized(seedArtist);
  const candidates = new Map<string, RelatedArtist>();
  for (const term of searchTerms) {
    try {
      const data = await searchItunesTracks(term, 50);
      for (const row of data.results ?? []) {
        const name = clean(row.artistName);
        const key = normalized(name);
        if (!name || !key || key === seedKey || isBadArtistName(name)) continue;
        const releaseYear = yearFromDate(row.releaseDate);
        const current = candidates.get(key);
        const lane: RelatedArtistLane = releaseYear && releaseYear >= CURRENT_YEAR - RECENT_RELEASE_WINDOW_YEARS ? "new" : "catalog";
        const candidate: RelatedArtist = {
          name,
          mbid: null,
          similarity: lane === "new" ? 0.48 : 0.40,
          style: styleLabel(term),
          source: "catalog",
          lane,
          beginYear: null,
        };
        if (!current || candidate.similarity > current.similarity || lanePriority(candidate.lane) > lanePriority(current.lane)) {
          candidates.set(key, candidate);
        }
        if (candidates.size >= 24) break;
      }
    } catch {
      // Continue with another style term.
    }
    if (candidates.size >= 24) break;
  }
  return [...candidates.values()];
}

async function resolveSeedYear(track: MusicTrack, artist: string, title: string) {
  const localYear = yearFromUnknownTrack(track);
  if (localYear) return localYear;
  if (!artist || !title) return null;
  try {
    const data = await searchItunesTracks(`${artist} ${title}`, 18);
    const artistKey = normalized(artist);
    const titleKey = canonicalTitle(title);
    const years = (data.results ?? [])
      .filter((row) => normalized(row.artistName) === artistKey && canonicalTitle(row.trackName) === titleKey)
      .map((row) => yearFromDate(row.releaseDate))
      .filter((year): year is number => Boolean(year));
    return years.length ? Math.min(...years) : null;
  } catch {
    return null;
  }
}

function candidateId(artist: string, title: string) {
  return `track:${normalized(artist)}:${canonicalTitle(title)}`;
}

function versionPenalty(value: string) {
  const text = normalized(value);
  if (/\b(karaoke|tribute|cover version|instrumental version)\b/.test(text)) return 100;
  if (/\b(live|acoustic|remix|sped up|slowed|re recorded|re recording)\b/.test(text)) return 20;
  if (/\b(remaster|radio edit|single version|album version)\b/.test(text)) return 7;
  return 0;
}

function eraRadius(seedYear: number | null) {
  if (!seedYear) return 5;
  if (seedYear < 1980) return 6;
  if (seedYear < 2000) return 5;
  if (seedYear < 2015) return 4;
  return 3;
}

function isNewArtist(beginYear: number | null, catalogStartYear: number | null) {
  const start = beginYear ?? catalogStartYear;
  return Boolean(start && start >= CURRENT_YEAR - NEW_ARTIST_WINDOW_YEARS);
}

function recommendationCategory(
  relatedArtist: RelatedArtist,
  seedYear: number | null,
  rowYear: number | null,
  catalogStartYear: number | null,
  depthIndex: number
): MusicDiscoveryCategory {
  if (isNewArtist(relatedArtist.beginYear, catalogStartYear)) return "new_upcoming";

  const sameEra = Boolean(seedYear && rowYear && Math.abs(rowYear - seedYear) <= eraRadius(seedYear));
  if (sameEra) {
    if (relatedArtist.lane === "hidden" || depthIndex >= 3 || relatedArtist.similarity < 0.68) return "hidden_era";
    return "same_era";
  }

  if (!seedYear) {
    if (rowYear && rowYear >= CURRENT_YEAR - RECENT_RELEASE_WINDOW_YEARS && relatedArtist.lane === "new") return "new_upcoming";
    return relatedArtist.lane === "hidden" || depthIndex >= 4 ? "hidden_era" : "same_era";
  }

  // A strong newer release from a recently formed artist is still useful even if the seed is old.
  if (rowYear && rowYear >= CURRENT_YEAR - RECENT_RELEASE_WINDOW_YEARS && relatedArtist.lane === "new") return "new_upcoming";

  // When a provider gives a very strong artist relationship but the catalog date falls outside the exact
  // era window, keep it in the closest lane instead of throwing the recommendation away.
  return relatedArtist.lane === "hidden" || depthIndex >= 4 ? "hidden_era" : "same_era";
}

function reasonFor(category: MusicDiscoveryCategory, relatedArtist: RelatedArtist, rowGenre: string, rowYear: number | null) {
  const style = relatedArtist.style && relatedArtist.style !== "Related artist"
    ? relatedArtist.style
    : styleLabel(rowGenre);
  const year = rowYear ? ` • ${rowYear}` : "";
  if (category === "new_upcoming") return `${style} • newer artist${year}`;
  if (category === "hidden_era") return `${style} • same-era deep cut${year}`;
  if (relatedArtist.source === "library") return `${style} • same-era fit${year}`;
  return `${style} • same-era match${year}`;
}

function makeRecommendation(
  row: ItunesTrack,
  rowIndex: number,
  artistCatalogStartYear: number | null,
  relatedArtist: RelatedArtist,
  seed: { artist: string; title: string; genre: string; year: number | null },
  library: Set<string>,
  preferences: LibraryPreferenceProfile,
  ignored: Set<string>,
  toAdd: Set<string>
): ScoredRecommendation | null {
  const artist = clean(row.artistName);
  const title = clean(row.trackName);
  const album = clean(row.collectionName);
  if (!artist || !title) return null;

  const seedArtistKey = normalized(seed.artist);
  const artistKey = normalized(artist);
  const expectedArtistKey = normalized(relatedArtist.name);
  if (artistKey === seedArtistKey) return null;
  if (isBadArtistName(artist) || isBadArtistName(album)) return null;
  if (artistKey !== expectedArtistKey && !artistKey.includes(expectedArtistKey) && !expectedArtistKey.includes(artistKey)) return null;

  const titleKey = canonicalTitle(title);
  if (!titleKey || titleKey === canonicalTitle(seed.title)) return null;
  const penalty = versionPenalty(`${title} ${album}`);
  if (penalty >= 100) return null;

  const id = candidateId(artist, title);
  if (ignored.has(id)) return null;
  if (preferences.playLessTracks.has(`${artistKey}|${titleKey}`)) return null;

  const rowYear = yearFromDate(row.releaseDate);
  const category = recommendationCategory(relatedArtist, seed.year, rowYear, artistCatalogStartYear, rowIndex);
  const inLibrary = library.has(`${artistKey}|${titleKey}`);

  let score = relatedArtist.similarity * 100 - penalty - rowIndex * 0.55;
  if (inLibrary) score -= 28;
  if (preferences.likedArtists.has(artistKey)) score += 5;
  if (preferences.playLessArtists.has(artistKey)) score -= 24;
  if (category === "new_upcoming") score += 8;
  if (category === "hidden_era") score += Math.min(8, rowIndex * 1.5);
  if (seed.year && rowYear) score += Math.max(0, 8 - Math.abs(rowYear - seed.year));

  return {
    id,
    kind: "track",
    title,
    artist,
    album,
    artworkUrl: highResArtwork(row.artworkUrl100),
    genre: clean(row.primaryGenreName) || null,
    year: rowYear,
    category,
    reason: reasonFor(category, relatedArtist, clean(row.primaryGenreName), rowYear),
    inLibrary,
    toAdd: toAdd.has(id),
    dismissed: false,
    _score: score,
    _depth: rowIndex,
  };
}

async function tracksForRelatedArtist(
  relatedArtist: RelatedArtist,
  seed: { artist: string; title: string; genre: string; year: number | null },
  library: Set<string>,
  preferences: LibraryPreferenceProfile,
  ignored: Set<string>,
  toAdd: Set<string>
) {
  try {
    const data = await searchItunesTracks(relatedArtist.name, 24);
    const rows = (data.results ?? []).filter((row) => {
      const artistKey = normalized(row.artistName);
      const expected = normalized(relatedArtist.name);
      return artistKey === expected || artistKey.includes(expected) || expected.includes(artistKey);
    });
    const years = rows
      .map((row) => yearFromDate(row.releaseDate))
      .filter((year): year is number => Boolean(year));
    const artistCatalogStartYear = relatedArtist.beginYear ?? (years.length ? Math.min(...years) : null);

    return rows
      .map((row, index) => makeRecommendation(
        row,
        index,
        artistCatalogStartYear,
        relatedArtist,
        seed,
        library,
        preferences,
        ignored,
        toAdd
      ))
      .filter((item): item is ScoredRecommendation => Boolean(item))
      .sort((a, b) => b._score - a._score)
      .slice(0, 5);
  } catch {
    return [];
  }
}

function selectCategorizedRecommendations(
  candidates: ScoredRecommendation[],
  previousIds: Set<string>
) {
  const categories: MusicDiscoveryCategory[] = ["new_upcoming", "same_era", "hidden_era"];
  const selected: MusicDiscoveryRecommendation[] = [];
  const selectedIds = new Set<string>();
  const artistCounts = new Map<string, number>();
  const categoryArtistCounts = new Map<string, number>();

  const sorted = [...candidates].sort((a, b) => {
    const freshA = previousIds.has(a.id) ? 0 : 1;
    const freshB = previousIds.has(b.id) ? 0 : 1;
    if (freshA !== freshB) return freshB - freshA;
    if (a.inLibrary !== b.inLibrary) return a.inLibrary ? 1 : -1;
    return b._score - a._score;
  });

  for (const category of categories) {
    let categoryCount = 0;
    for (const item of sorted) {
      if (item.category !== category || selectedIds.has(item.id)) continue;
      const artistKey = normalized(item.artist);
      const totalArtistCount = artistCounts.get(artistKey) ?? 0;
      const categoryArtistKey = `${category}|${artistKey}`;
      const sameCategoryArtistCount = categoryArtistCounts.get(categoryArtistKey) ?? 0;
      if (totalArtistCount >= 2 || sameCategoryArtistCount >= 1) continue;
      const { _score: _discardScore, _depth: _discardDepth, ...recommendation } = item;
      void _discardScore;
      void _discardDepth;
      selected.push(recommendation);
      selectedIds.add(item.id);
      artistCounts.set(artistKey, totalArtistCount + 1);
      categoryArtistCounts.set(categoryArtistKey, sameCategoryArtistCount + 1);
      categoryCount += 1;
      if (categoryCount >= TARGET_PER_CATEGORY) break;
    }
  }

  return selected.slice(0, MAX_RECOMMENDATIONS);
}

function appendPreviousByCategory(
  selected: MusicDiscoveryRecommendation[],
  previous: MusicDiscoverySeed | undefined,
  library: Set<string>
) {
  if (!previous) return selected;
  const next = [...selected];
  const selectedIds = new Set(next.map((item) => item.id));
  const counts = new Map<MusicDiscoveryCategory, number>();
  for (const item of next) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);

  const categories: MusicDiscoveryCategory[] = ["new_upcoming", "same_era", "hidden_era"];
  for (const category of categories) {
    if ((counts.get(category) ?? 0) >= TARGET_PER_CATEGORY) continue;
    for (const item of previous.recommendations) {
      if (item.dismissed || selectedIds.has(item.id) || safeCategory(item.category) !== category) continue;
      next.push({
        ...item,
        category,
        inLibrary: library.has(`${normalized(item.artist)}|${canonicalTitle(item.title)}`),
      });
      selectedIds.add(item.id);
      counts.set(category, (counts.get(category) ?? 0) + 1);
      if ((counts.get(category) ?? 0) >= TARGET_PER_CATEGORY || next.length >= MAX_RECOMMENDATIONS) break;
    }
  }
  return next.slice(0, MAX_RECOMMENDATIONS);
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
  const preferences = libraryPreferenceProfile(libraryTracks);
  const ignored = new Set(previous?.recommendations.filter((item) => item.dismissed).map((item) => item.id) ?? []);
  const toAdd = new Set(previous?.recommendations.filter((item) => item.toAdd).map((item) => item.id) ?? []);
  const previousIds = new Set(previous?.recommendations.map((item) => item.id) ?? []);

  const [profile, seedYear] = await Promise.all([
    resolveArtistProfile(artist),
    resolveSeedYear(track, artist, title),
  ]);
  const seed = { artist, title, genre, year: seedYear };

  const [lastFm, deezer, listenEasy, listenHidden] = await Promise.all([
    relatedArtistsFromLastFm(artist, profile.mbid),
    relatedArtistsFromDeezer(artist),
    relatedArtistsFromListenBrainz(profile.mbid, artist, "easy", 35, 100, "direct"),
    relatedArtistsFromListenBrainz(profile.mbid, artist, "hard", 0, 55, "hidden"),
  ]);

  const tagRelated = await relatedArtistsFromMusicBrainzTags(profile, genre);
  const libraryRelated = libraryRelatedArtists(seed, profile, libraryTracks);
  let relatedArtists = mergeRelatedArtists(lastFm, deezer, listenEasy, listenHidden, tagRelated, libraryRelated)
    .filter((item) => normalized(item.name) !== normalized(artist));

  // If direct services are sparse, widen intelligently by the seed's specific style instead of returning nothing.
  if (relatedArtists.length < 16 || relatedArtists.filter((item) => item.lane === "new").length < 4) {
    const catalog = await catalogArtistsFromSpecificStyles(profile, genre, artist);
    relatedArtists = mergeRelatedArtists(relatedArtists, catalog);
  }

  // Keep calls below Apple's approximate public Search API guidance while still giving each discovery lane room.
  const direct = relatedArtists.filter((item) => item.lane === "direct" || item.lane === "library").slice(0, 7);
  const newer = relatedArtists.filter((item) => item.lane === "new").slice(0, 5);
  const hidden = relatedArtists.filter((item) => item.lane === "hidden" || item.lane === "catalog").slice(0, 5);
  const lookupArtists = mergeRelatedArtists(newer, direct, hidden).slice(0, 12);

  const batches = await Promise.all(lookupArtists.map((candidate) =>
    tracksForRelatedArtist(candidate, seed, library, preferences, ignored, toAdd)
  ));

  const deduped = new Map<string, ScoredRecommendation>();
  for (const item of batches.flat()) {
    const current = deduped.get(item.id);
    if (!current || item._score > current._score) deduped.set(item.id, item);
  }

  let selected = selectCategorizedRecommendations([...deduped.values()], previousIds);
  selected = appendPreviousByCategory(selected, previous, library);

  const nextSeed: MusicDiscoverySeed = {
    id: seedId,
    trackId: track.id,
    trackTitle: title || "Current Song",
    trackArtist: artist || "Unknown Artist",
    artworkUrl: (track as MusicTrack & { external_artwork_url?: string | null }).external_artwork_url || null,
    seedYear,
    createdAt: previous?.createdAt ?? Date.now(),
    refreshedAt: Date.now(),
    recommendations: selected,
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
        category: safeCategory(item.category),
        inLibrary,
        toAdd: inLibrary ? false : item.toAdd,
      };
    }),
  }));
  save(seeds);
}
