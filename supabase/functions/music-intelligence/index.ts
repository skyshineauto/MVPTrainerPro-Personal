import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TRACK_TABLE = "trainer_music_track_intelligence";
const ARTIST_TABLE = "trainer_music_artist_intelligence";
const ANALYSIS_VERSION = 8;
const CYANITE_LIMIT_BYTES = 20 * 1024 * 1024;
const CYANITE_LIMIT_SECONDS = 15 * 60;
const CYANITE_MODELS = [
  "BpmV2",
  "TempoV1",
  "KeyV2",
  "MainGenreV2",
  "SubgenreV2",
  "MoodAdvancedV2",
  "MoodSimpleV2",
  "CharacterV2",
  "MovementV2",
  "MusicForV1",
  "ValenceArousalV2",
  "AutoDescriptionV2",
];

type SongDNA = {
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

type ArtistDNA = Partial<SongDNA> & { typicalBpm?: number | null };

type InputTrack = {
  id: string;
  title: string;
  artist: string;
  artistKey?: string;
  album?: string;
  releaseYear?: number | null;
  genre?: string;
  durationSeconds?: number | null;
  fileSizeBytes?: number | null;
  mimeType?: string | null;
  energyLevel?: string | null;
  originalName?: string | null;
};

type LastFmTag = { name: string; count: number };

type ProviderContext = {
  trackTags: LastFmTag[];
  artistTags: LastFmTag[];
  mbRecordingId: string | null;
  mbArtistId: string | null;
  mbGenres: string[];
  mbOriginalYear: number | null;
  yearSource: string;
  mainGenres: string[];
  subgenres: string[];
  catalogSources?: string[];
  catalogCandidates?: Record<string, unknown>;
};

type DeezerAudioFacts = {
  trackId: number | null;
  bpm: number | null;
  gain: number | null;
  confidence: number;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function artistKey(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanTags(value: unknown): LastFmTag[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return {
        name: String(row.name || "").trim(),
        count: Math.max(0, Number(row.count || Math.max(1, 100 - index * 5))),
      };
    })
    .filter((item) => item.name)
    .slice(0, 30);
}

async function lastFmTags(method: "track.getTopTags" | "artist.getTopTags", track: InputTrack, key: string) {
  const params = new URLSearchParams({ method, api_key: key, format: "json", autocorrect: "1" });
  params.set("artist", track.artist);
  if (method === "track.getTopTags") params.set("track", track.title);
  const response = await fetch(`https://ws.audioscrobbler.com/2.0/?${params.toString()}`);
  if (!response.ok) return [];
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  const top = payload?.toptags && typeof payload.toptags === "object" ? payload.toptags as Record<string, unknown> : null;
  return cleanTags(top?.tag);
}

function escapeMb(value: string) {
  return value.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeCatalogText(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/\b(feat|featuring|ft)\.?\b.*$/i, "")
    .replace(/\b(remaster(?:ed)?|deluxe|explicit|clean|radio edit|single version|album version)\b/gi, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function musicBrainzCreditName(recording: Record<string, unknown>) {
  const credits = Array.isArray(recording["artist-credit"]) ? recording["artist-credit"] as Array<Record<string, unknown>> : [];
  return credits.map((credit) => {
    if (typeof credit.name === "string") return credit.name;
    const artist = credit.artist && typeof credit.artist === "object" ? credit.artist as Record<string, unknown> : {};
    return typeof artist.name === "string" ? artist.name : "";
  }).filter(Boolean).join(" ");
}

// R31: MusicBrainz permits a modest request rate. An HTTP 429 is NOT
// evidence that an original recording cannot be identified.
let musicBrainzSlot = Promise.resolve();
let nextMusicBrainzRequest = 0;
async function musicBrainzJson(url: string, timeout = 9000): Promise<Record<string, unknown> | null> {
  const request = musicBrainzSlot.catch(() => undefined).then(async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const wait = Math.max(0, nextMusicBrainzRequest - Date.now());
      if (wait) await new Promise(resolve => setTimeout(resolve, wait));
      nextMusicBrainzRequest = Date.now() + 1150;
      const response = await fetch(url, {
        headers: { "User-Agent": "MVPTrainerPro/1.0 (music-intelligence; contact: https://fitnesstrainer.skyshineautodetailing.com)", Accept: "application/json" },
        signal: AbortSignal.timeout(timeout),
      });
      if (response.status === 429 || response.status === 503) {
        if (attempt === 0) { nextMusicBrainzRequest = Date.now() + 2400; continue; }
        throw new Error(`MusicBrainz rate limited (${response.status}); retry automatically`);
      }
      if (!response.ok) return null;
      return await response.json().catch(() => null) as Record<string, unknown> | null;
    }
    return null;
  });
  musicBrainzSlot = request.then(() => undefined, () => undefined);
  return request;
}
function originalAlbumName(value: string) {
  return String(value || "")
    .replace(/\s*[([{]\s*(?:\d{4}\s+)?(?:\d+(?:st|nd|rd|th)?\s+anniversary|anniversary|deluxe|expanded|special|remaster(?:ed)?|bonus tracks?|edition|\d{4} bonus)[^\])}]*[\])}]/ig, "")
    .replace(/\s+(?:\d+(?:st|nd|rd|th)?|twentieth|twenty-?fifth|thirtieth)\s+anniversary\b/ig, "")
    .replace(/\s+(?:deluxe|expanded|remastered?|anniversary|special)\s+(?:version|edition)$/i, "")
    .trim();
}
function isCollectionOrLive(value: string) {
  return /\b(greatest hits|best of|anthology|compilation|collection|soundtrack|live at|live in|live broadcast|tour|concert|various artists|now that.s what i call)\b|^(?:rock|pop|hits|party|top 40)\s*:/i.test(value);
}
function isEdition(value: string) {
  return /\b(remaster|deluxe|anniversary|expanded|bonus tracks|special edition|legacy edition|twentieth anniversary)\b/i.test(value);
}
function versionKind(value: string) {
  const s = String(value || "").toLowerCase();
  if (/\bremix\b/.test(s)) return "remix";
  if (/\b(?:live|unplugged|broadcast)\b/.test(s)) return "live";
  if (/\bdemo\b/.test(s)) return "demo";
  if (/\bradio edit\b/.test(s)) return "radio-edit";
  if (/\bacoustic\b/.test(s)) return "acoustic";
  return "studio";
}
function cleanLookupTitle(track: InputTrack) {
  const title = String(track.title || "").trim();
  const prefix = `${track.artist} / `;
  return title.toLowerCase().startsWith(prefix.toLowerCase()) ? title.slice(prefix.length).trim() : title;
}
function leadArtist(value: string) {
  return String(value || "").split(/\s*(?:,|\s+&\s+|\s+feat\.?\s+|\s+featuring\s+)\s*/i)[0].trim();
}

async function musicBrainzIdentity(track: InputTrack) {
  if (!track.artist || !track.title) return { recordingId: null, artistId: null, genres: [] as string[], originalYear: null as number | null };
  const lookupTitle = cleanLookupTitle(track);
  const exactQuery = `recording:"${escapeMb(lookupTitle)}" AND artist:"${escapeMb(track.artist)}"`;
  const search = async (q: string) => musicBrainzJson(`https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(q)}&fmt=json&limit=12`);
  let payload = await search(exactQuery);
  let recordings = Array.isArray(payload?.recordings) ? payload.recordings as Array<Record<string, unknown>> : [];
  if (leadArtist(track.artist) !== track.artist &&
      !recordings.some(row => normalizeCatalogText(row.title) === normalizeCatalogText(lookupTitle) &&
        normalizeCatalogText(musicBrainzCreditName(row)).includes(normalizeCatalogText(leadArtist(track.artist))))) {
    payload = await search(`recording:"${escapeMb(lookupTitle)}" AND artist:"${escapeMb(leadArtist(track.artist))}"`);
    const alternate = Array.isArray(payload?.recordings) ? payload.recordings as Array<Record<string, unknown>> : [];
    recordings = [...recordings, ...alternate];
  }
  const wantedTitle = normalizeCatalogText(lookupTitle);
  const wantedArtist = normalizeCatalogText(track.artist);
  const wantedLeadArtist = normalizeCatalogText(leadArtist(track.artist));
  const wantedVersion = versionKind(`${lookupTitle} ${track.album || ""}`);
  const wantedDurationMs = track.durationSeconds ? Number(track.durationSeconds) * 1000 : null;
  const ranked = recordings.map((recording) => {
    const candidateTitle = normalizeCatalogText(recording.title);
    const candidateArtist = normalizeCatalogText(musicBrainzCreditName(recording));
    let score = 0;
    if (wantedTitle && candidateTitle === wantedTitle) score += 70;
    else if (wantedTitle && candidateTitle && (candidateTitle.includes(wantedTitle) || wantedTitle.includes(candidateTitle))) score += 34;
    if (wantedArtist && candidateArtist === wantedArtist) score += 55;
    else if (wantedLeadArtist && candidateArtist && (candidateArtist === wantedLeadArtist || candidateArtist.startsWith(`${wantedLeadArtist} `))) score += 48;
    else if (wantedArtist && candidateArtist && (candidateArtist.includes(wantedArtist) || wantedArtist.includes(candidateArtist))) score += 22;
    // Never use the studio recording as evidence of a separately uploaded live/remix/edit.
    const candidateVersion = versionKind(`${String(recording.title || "")} ${String(recording.disambiguation || "")}`);
    if (wantedVersion !== "studio" && candidateVersion !== wantedVersion) score = -1000;
    if (wantedVersion === "studio" && ["live", "remix", "demo"].includes(candidateVersion)) score = -1000;
    const candidateDuration = Number(recording.length || 0);
    if (wantedDurationMs && candidateDuration > 0) {
      const diff = Math.abs(wantedDurationMs - candidateDuration);
      if (diff <= 3000) score += 18;
      else if (diff <= 8000) score += 11;
      else if (diff <= 15000) score += 5;
      else if (diff > 40000) score -= 12;
    }
    return { recording, score };
  }).sort((a, b) => b.score - a.score);
  const best = ranked[0]?.score >= 110 ? ranked[0].recording : null;
  if (!best) return { recordingId: null, artistId: null, genres: [] as string[], originalYear: null as number | null };
  const credits = Array.isArray(best["artist-credit"]) ? best["artist-credit"] as Array<Record<string, unknown>> : [];
  const firstCredit = credits[0] || {};
  const artist = firstCredit.artist && typeof firstCredit.artist === "object" ? firstCredit.artist as Record<string, unknown> : {};
  const genresRaw = Array.isArray(best.genres) ? best.genres as Array<Record<string, unknown>> : [];
  // MusicBrainz recording first-release-date references the original recording,
  // not the uploaded deluxe/remastered edition. A non-verified year stays null.
  const firstDate = typeof best["first-release-date"] === "string" ? best["first-release-date"] : "";
  const foundYear = /^(19|20)\d{2}/.exec(firstDate);
  const originalYear = foundYear ? Number(foundYear[0]) : null;
  return {
    recordingId: typeof best.id === "string" ? best.id : null,
    originalYear,
    artistId: typeof artist.id === "string" ? artist.id : null,
    genres: genresRaw.map((item) => String(item.name || "").trim()).filter(Boolean).slice(0, 10),
  };
}


function deezerArtistName(row: Record<string, unknown>) {
  const artist = row.artist && typeof row.artist === "object" ? row.artist as Record<string, unknown> : {};
  return typeof artist.name === "string" ? artist.name : "";
}

function rankDeezerCandidate(track: InputTrack, row: Record<string, unknown>) {
  const wantedTitle = normalizeCatalogText(track.title);
  const wantedArtist = normalizeCatalogText(track.artist);
  const candidateTitle = normalizeCatalogText(row.title_short || row.title);
  const candidateArtist = normalizeCatalogText(deezerArtistName(row));
  let score = 0;

  if (wantedTitle && candidateTitle === wantedTitle) score += 72;
  else if (wantedTitle && candidateTitle && (candidateTitle.includes(wantedTitle) || wantedTitle.includes(candidateTitle))) score += 34;

  if (wantedArtist && candidateArtist === wantedArtist) score += 58;
  else if (wantedArtist && candidateArtist && (candidateArtist.includes(wantedArtist) || wantedArtist.includes(candidateArtist))) score += 24;

  const wantedDuration = Number(track.durationSeconds || 0);
  const candidateDuration = Number(row.duration || 0);
  if (wantedDuration > 0 && candidateDuration > 0) {
    const diff = Math.abs(wantedDuration - candidateDuration);
    if (diff <= 3) score += 18;
    else if (diff <= 8) score += 11;
    else if (diff <= 15) score += 5;
    else if (diff > 40) score -= 14;
  }

  return score;
}

async function deezerAudioFacts(track: InputTrack): Promise<DeezerAudioFacts | null> {
  if (!track.artist || !track.title) return null;
  const query = `artist:"${track.artist.replace(/"/g, " ")}" track:"${track.title.replace(/"/g, " ")}"`;
  const response = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=8`);
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  const rows = Array.isArray(payload?.data) ? payload?.data as Array<Record<string, unknown>> : [];
  const ranked = rows
    .map((row) => ({ row, score: rankDeezerCandidate(track, row) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best || best.score < 92) return null;

  const id = Number(best.row.id || 0);
  if (!Number.isFinite(id) || id <= 0) return null;
  const detailResponse = await fetch(`https://api.deezer.com/track/${id}`);
  if (!detailResponse.ok) return null;
  const detail = await detailResponse.json().catch(() => null) as Record<string, unknown> | null;
  if (!detail || detail.error) return null;

  const bpmRaw = Number(detail.bpm || 0);
  const gainRaw = Number(detail.gain);
  const bpm = Number.isFinite(bpmRaw) && bpmRaw >= 40 && bpmRaw <= 240 ? bpmRaw : null;
  const gain = Number.isFinite(gainRaw) ? gainRaw : null;
  if (bpm == null) return null;

  const confidence = Math.max(.55, Math.min(.92, best.score / 160));
  return { trackId: id, bpm, gain, confidence };
}

// R29: Secondary, independently matched catalog data. Catalog/edition release
// dates are NOT treated as an original recording year without primary evidence.
async function appleCatalog(track: InputTrack) {
  if (!track.artist || !track.title) return null;
  const query = new URLSearchParams({ term: `${track.artist} ${track.title}`, entity: "song", limit: "12" });
  const response = await fetch(`https://itunes.apple.com/search?${query}`, { signal: AbortSignal.timeout(8500) });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  const rows = Array.isArray(payload?.results) ? payload.results as Array<Record<string, unknown>> : [];
  const artist = normalizeCatalogText(track.artist);
  const title = normalizeCatalogText(cleanLookupTitle(track));
  const album = normalizeCatalogText(originalAlbumName(track.album || ""));
  const requestedVersion = versionKind(`${track.title} ${track.album || ""}`);
  const scored = rows.map(row => {
    const a = normalizeCatalogText(row.artistName), t = normalizeCatalogText(row.trackName);
    let score = t === title && (a === artist ||
      a === normalizeCatalogText(leadArtist(track.artist)) ||
      a.startsWith(`${normalizeCatalogText(leadArtist(track.artist))} `)) ? 140 : 0;
    if (score && requestedVersion !== "studio" && requestedVersion !== versionKind(String(row.trackName || ""))) score = 0;
    if (score && requestedVersion === "studio" && ["live", "remix", "demo"].includes(versionKind(String(row.trackName || "")))) score = 0;
    if (score && album && normalizeCatalogText(originalAlbumName(String(row.collectionName || ""))) === album) score += 15;
    const expected = Number(track.durationSeconds || 0), actual = Number(row.trackTimeMillis || 0) / 1000;
    if (score && expected && actual && Math.abs(actual - expected) > 35) score = 0;
    return { row, score };
  }).sort((a,b) => b.score-a.score);
  const found = scored[0];
  if (!found || found.score < 140) return null;
  const row = found.row;
  return {
    genre: typeof row.primaryGenreName === "string" ? row.primaryGenreName.trim() : "",
    album: String(row.collectionName || ""),
    catalogYear: Number(String(row.releaseDate || "").slice(0,4)) || null,
    catalogTrackId: String(row.trackId || ""),
    matchedArtist: String(row.artistName || ""),
    matchedTitle: String(row.trackName || ""),
    sourceUrl: typeof row.trackViewUrl === "string" && row.trackViewUrl.startsWith("https://") ? row.trackViewUrl : null,
    isCompilation: row.isCompilation === true,
  };
}

async function discogsAlbumMaster(track: InputTrack) {
  const token = Deno.env.get("DISCOGS_TOKEN") || "";
  if (!token || !track.album || !track.artist) return null;
  if (isCollectionOrLive(track.album) || ["live", "remix"].includes(versionKind(track.title))) return null;
  const originalAlbum = originalAlbumName(track.album);
  const params = new URLSearchParams({ artist: leadArtist(track.artist), release_title: originalAlbum, type: "master", per_page: "5" });
  const response = await fetch(`https://api.discogs.com/database/search?${params}`, {
    headers: { Authorization: `Discogs token=${token}`, "User-Agent": "MVPTrainerPro/1.0" },
    signal: AbortSignal.timeout(8500),
  });
  if (!response.ok) return null;
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  const rows = Array.isArray(body?.results) ? body.results as Array<Record<string, unknown>> : [];
  const expected = `${normalizeCatalogText(leadArtist(track.artist))} ${normalizeCatalogText(originalAlbum)}`;
  const row = rows.find(item => normalizeCatalogText(item.title) === expected);
  if (!row) return null;
  return {
    genre: Array.isArray(row.genre) ? row.genre.map(String) : [] as string[],
    style: Array.isArray(row.style) ? row.style.map(String) : [] as string[],
    albumMasterYear: Number(row.year || 0) || null,
    masterId: String(row.master_id || row.id || ""),
  };
}

function tempoLabelFromBpm(bpm: number | null) {
  if (bpm == null) return null;
  if (bpm < 78) return "very slow";
  if (bpm < 96) return "slow";
  if (bpm < 118) return "moderate";
  if (bpm < 138) return "up-tempo";
  if (bpm < 162) return "fast";
  return "very fast";
}

function applyTempoFacts(base: SongDNA, bpm: number | null) {
  if (bpm == null || !Number.isFinite(bpm)) return base;
  const pace = clamp(((bpm - 60) / 100) * 100);
  const dna = { ...base };
  dna.energy = clamp(dna.energy * .84 + pace * .16);
  dna.drive = clamp(dna.drive * .72 + pace * .28);
  dna.upbeat = clamp(dna.upbeat * .82 + pace * .18);
  dna.intensity = clamp(dna.energy * .38 + dna.drive * .25 + dna.aggression * .22 + dna.heaviness * .15);
  dna.workoutFit = clamp(dna.energy * .27 + dna.drive * .33 + dna.motivational * .23 + (100 - dna.relaxing) * .17);
  return dna;
}

function baseSongDna(track: InputTrack): SongDNA {
  const energy = track.energyLevel === "high" ? 86 : track.energyLevel === "low" ? 34 : 60;
  return {
    energy,
    heaviness: clamp(28 + energy * 0.34),
    aggression: clamp(18 + energy * 0.36),
    drive: clamp(18 + energy * 0.72),
    intensity: clamp(20 + energy * 0.70),
    melodic: 58,
    darkness: 40,
    brightness: 55,
    atmospheric: 42,
    reflective: 44,
    relaxing: clamp(78 - energy * 0.62),
    uplifting: 48,
    motivational: clamp(35 + energy * 0.38),
    chaotic: clamp(15 + energy * 0.25),
    focus: 58,
    upbeat: clamp(20 + energy * 0.48),
    workoutFit: clamp(24 + energy * 0.68),
  };
}

function setMany(target: Partial<SongDNA>, patch: Partial<SongDNA>, strength = 1) {
  for (const [key, raw] of Object.entries(patch) as Array<[keyof SongDNA, number]>) {
    const current = target[key];
    target[key] = clamp(typeof current === "number" ? current * (1 - strength) + raw * strength : raw);
  }
}

function profileFromText(text: string, seed?: Partial<SongDNA>): Partial<SongDNA> {
  const normalized = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()} `;
  const p: Partial<SongDNA> = { ...(seed || {}) };
  const has = (...terms: string[]) => terms.some((term) => normalized.includes(` ${term} `) || normalized.includes(term));

  if (has("ambient", "chill", "chillout", "downtempo", "dream pop", "ethereal")) setMany(p, { energy: 30, heaviness: 12, aggression: 8, drive: 25, intensity: 25, melodic: 70, atmospheric: 90, reflective: 74, relaxing: 90, chaotic: 8, focus: 76, upbeat: 32 }, .76);
  if (has("psychedelic", "progressive rock", "prog rock", "psych prog", "post rock", "art rock")) setMany(p, { energy: 48, heaviness: 34, aggression: 18, drive: 42, melodic: 80, atmospheric: 88, reflective: 84, relaxing: 66, focus: 82, chaotic: 22 }, .72);
  if (has("soft rock", "acoustic", "singer songwriter", "ballad", "easy listening")) setMany(p, { energy: 38, heaviness: 16, aggression: 10, drive: 32, intensity: 34, melodic: 82, atmospheric: 62, reflective: 72, relaxing: 82, chaotic: 9 }, .75);
  if (has("classic rock")) setMany(p, { energy: 59, heaviness: 42, aggression: 31, drive: 58, intensity: 58, melodic: 72, atmospheric: 50, reflective: 56 }, .50);
  if (has("alternative rock", "indie rock")) setMany(p, { energy: 62, heaviness: 38, aggression: 34, drive: 61, intensity: 61, melodic: 73, atmospheric: 54, reflective: 58 }, .52);
  if (has("hard rock", "post grunge", "alternative metal")) setMany(p, { energy: 78, heaviness: 70, aggression: 62, drive: 80, intensity: 80, melodic: 62, relaxing: 18, workoutFit: 84 }, .70);
  if (has("metalcore", "deathcore", "hardcore", "thrash", "nu metal", "industrial metal", "death metal", "heavy metal")) setMany(p, { energy: 88, heaviness: 91, aggression: 87, drive: 89, intensity: 92, melodic: 46, relaxing: 7, chaotic: 63, workoutFit: 91 }, .82);
  if (has("punk", "pop punk")) setMany(p, { energy: 86, heaviness: 50, aggression: 55, drive: 91, intensity: 84, brightness: 70, upbeat: 78, relaxing: 10, workoutFit: 85 }, .74);

  if (has("calm", "tranquil", "peaceful", "mellow", "relaxing", "relaxed", "serene")) setMany(p, { energy: 28, aggression: 8, drive: 24, intensity: 24, relaxing: 92, chaotic: 6, atmospheric: 74 }, .68);
  if (has("aggressive", "angry", "violent", "fiery")) setMany(p, { energy: 86, aggression: 92, drive: 87, intensity: 91, relaxing: 5, chaotic: 62 }, .70);
  if (has("energetic", "exciting", "exhilarating", "boisterous")) setMany(p, { energy: 90, drive: 88, intensity: 88, workoutFit: 88 }, .65);
  if (has("upbeat", "happy", "cheerful", "feel good", "uplifting")) setMany(p, { brightness: 83, uplifting: 88, upbeat: 88, darkness: 18 }, .62);
  if (has("dark", "gloomy", "eerie", "creepy", "depressing", "evil")) setMany(p, { darkness: 86, brightness: 24, uplifting: 18, reflective: 64 }, .60);
  if (has("thoughtful", "reflective", "bittersweet", "emotional", "dreamy")) setMany(p, { reflective: 86, atmospheric: 76, melodic: 72, focus: 72 }, .62);
  if (has("confident", "determined", "heroic", "triumphant", "victorious", "achievement", "empowerment")) setMany(p, { motivational: 90, drive: 74, uplifting: 72, workoutFit: 78 }, .58);
  if (has("heavy", "powerful", "stomping")) setMany(p, { heaviness: 86, intensity: 82, drive: 76 }, .55);
  if (has("driving", "running", "pulsing")) setMany(p, { drive: 88, workoutFit: 87, energy: 78 }, .56);
  if (has("flowing", "sparse")) setMany(p, { drive: 32, relaxing: 70, atmospheric: 75 }, .48);
  return p;
}

function weightedTagText(tags: LastFmTag[]) {
  return tags.slice(0, 20).map((tag) => `${tag.name} ${tag.name}`).join(" ");
}

function semanticText(parts: Array<string | null | undefined>) {
  return ` ${parts.filter(Boolean).join(" ").toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9+'\s-]/g, " ").replace(/[-_/]+/g, " ").replace(/\s+/g, " ").trim()} `;
}

function semanticPhraseScore(text: string, strong: string[], supporting: string[] = []) {
  let score = 0;
  for (const phrase of strong) {
    const normalized = phrase.toLowerCase().replace(/[-_/]+/g, " ");
    if (text.includes(` ${normalized} `) || text.includes(normalized)) score = Math.max(score, .92);
  }
  for (const phrase of supporting) {
    const normalized = phrase.toLowerCase().replace(/[-_/]+/g, " ");
    if (text.includes(` ${normalized} `) || text.includes(normalized)) score = Math.max(score, .68);
  }
  return score;
}

type SemanticExtras = {
  moods?: string[];
  characterTags?: string[];
  movementTags?: string[];
  musicFor?: string[];
  description?: string | null;
};

function buildSemanticProfile(track: InputTrack, context: ProviderContext, extras: SemanticExtras = {}) {
  const trackTagNames = context.trackTags.map((tag) => tag.name);
  const artistTagNames = context.artistTags.slice(0, 8).map((tag) => tag.name);
  const trackText = semanticText([track.title, track.album, track.genre, ...context.mbGenres, ...trackTagNames, ...(extras.moods || []), ...(extras.characterTags || []), ...(extras.movementTags || []), ...(extras.musicFor || []), extras.description || ""]);
  const titleText = semanticText([track.title]);
  const tagText = semanticText([...trackTagNames, ...(extras.moods || []), ...(extras.characterTags || []), ...(extras.musicFor || []), extras.description || ""]);

  const love = Math.max(
    semanticPhraseScore(tagText, ["love", "romantic", "romance", "in love", "love song", "affectionate", "tender"], ["relationship", "passionate", "intimate"]),
    semanticPhraseScore(titleText, ["love", "lover", "loving", "romance", "heart of mine"], ["kiss", "baby", "darling"]) * .90,
  );
  const heartbreak = Math.max(
    semanticPhraseScore(tagText, ["heartbreak", "heartbroken", "broken heart", "breakup", "break up", "lost love", "unrequited"], ["grief", "mourning", "goodbye", "lonely"]),
    semanticPhraseScore(titleText, ["heartbreak", "broken heart", "goodbye", "without you", "miss you"], ["alone", "lonely"]) * .88,
  );
  const sad = semanticPhraseScore(trackText, ["sad", "melancholy", "melancholic", "sorrowful", "depressing", "heartbroken", "grief"], ["bittersweet", "lonely", "reflective", "emotional"]);
  const angry = semanticPhraseScore(trackText, ["angry", "aggressive", "rage", "furious", "violent", "hostile"], ["rebellious", "defiant", "intense"]);
  const motivational = semanticPhraseScore(trackText, ["motivational", "determined", "empowerment", "triumphant", "victorious", "heroic"], ["confident", "uplifting", "driving"]);
  const party = semanticPhraseScore(trackText, ["party", "party anthem", "club", "dance party"], ["fun", "celebration", "upbeat"]);

  const cleanVocal = semanticPhraseScore(trackText, ["clean vocals", "clean vocal", "melodic vocals", "melodic vocal"], ["melodic"]);
  const screamedVocal = semanticPhraseScore(trackText, ["screamed vocals", "screaming vocals", "scream vocals", "harsh vocals"], ["screamo", "metalcore"]);
  const growledVocal = semanticPhraseScore(trackText, ["growled vocals", "growling vocals", "death growls", "growls"], ["death metal", "deathcore"]);
  const raspyVocal = semanticPhraseScore(trackText, ["raspy vocals", "raspy vocal", "gritty vocals", "gravelly vocals"], ["grunge", "blues rock"]);

  const originalReleaseYear = context.mbOriginalYear;
  const decade = originalReleaseYear != null ? Math.floor(originalReleaseYear / 10) * 10 : null;
  const evidenceCount = Number(context.trackTags.length > 0) + Number(context.mbGenres.length > 0) + Number(Boolean(extras.description)) + Number((extras.moods || []).length > 0);
  const confidence = Math.min(.98, .46 + evidenceCount * .11 + (context.mbRecordingId ? .08 : 0));

  return {
    version: 1,
    originalReleaseYear,
    originalReleaseYearSource: context.yearSource,
    suppliedEditionYear: Number(track.releaseYear) || null,
    decade,
    themes: { love, heartbreak, motivation: motivational, party },
    moods: { sad, angry },
    vocals: { clean: cleanVocal, screamed: screamedVocal, growled: growledVocal, raspy: raspyVocal },
    confidence,
    evidence: [...new Set([...trackTagNames.slice(0, 8), ...context.mbGenres.slice(0, 6), ...artistTagNames.slice(0, 4)])].slice(0, 16),
  };
}

function deriveArtistDna(track: InputTrack, context: ProviderContext): ArtistDNA {
  const text = [track.genre, ...context.mbGenres, weightedTagText(context.artistTags)].filter(Boolean).join(" ");
  return profileFromText(text);
}

function mergeDna(base: SongDNA, source: Partial<SongDNA>, amount: number): SongDNA {
  const next = { ...base };
  for (const key of Object.keys(next) as Array<keyof SongDNA>) {
    const value = source[key];
    if (typeof value === "number") next[key] = clamp(next[key] * (1 - amount) + value * amount);
  }
  return next;
}

function deriveSongDna(track: InputTrack, context: ProviderContext, artistDna: ArtistDNA): SongDNA {
  let dna = baseSongDna(track);
  dna = mergeDna(dna, artistDna, .38);
  const text = [track.title, track.album, track.genre, ...context.mbGenres, weightedTagText(context.trackTags)].filter(Boolean).join(" ");
  dna = mergeDna(dna, profileFromText(text), .74);
  dna.intensity = clamp(dna.energy * .42 + dna.drive * .26 + dna.aggression * .20 + dna.heaviness * .12);
  dna.workoutFit = clamp(dna.energy * .30 + dna.drive * .34 + dna.motivational * .22 + (100 - dna.relaxing) * .14);
  return dna;
}

type CachedArtistRow = {
  analysis_version?: number | null;
  artist_dna?: ArtistDNA | null;
  top_tags?: LastFmTag[] | null;
  genres?: string[] | null;
  musicbrainz_artist_id?: string | null;
};

async function providerContext(track: InputTrack, cachedArtist?: CachedArtistRow | null): Promise<ProviderContext> {
  const lastFmKey = Deno.env.get("LASTFM_API_KEY") || "";
  const cachedTags = Array.isArray(cachedArtist?.top_tags) ? cleanTags(cachedArtist?.top_tags) : [];
  const [trackTags, artistTags, mb, apple, discogs] = await Promise.all([
    lastFmKey && track.artist && track.title ? lastFmTags("track.getTopTags", track, lastFmKey).catch(() => []) : Promise.resolve([]),
    cachedTags.length ? Promise.resolve(cachedTags) : lastFmKey && track.artist ? lastFmTags("artist.getTopTags", track, lastFmKey).catch(() => []) : Promise.resolve([]),
    musicBrainzIdentity(track).catch(() => ({ recordingId: null, artistId: null, genres: [] as string[], originalYear: null as number | null })),
    appleCatalog(track).catch(() => null),
    discogsAlbumMaster(track).catch(() => null),
  ]);
  // Reuse the recording-specific release associations before considering albums.
  // Edition, cover and live recordings must never inherit the composition date.
  const recordingYear = mb.originalYear || !mb.recordingId ? null
    : await r30RecordingReleaseYear(mb.recordingId).catch(() => null);
  const albumYear = mb.originalYear || recordingYear ? null : await r27AlbumYear(track).catch(() => null);
  const singleYear = mb.originalYear || recordingYear || albumYear ? null : await exactSingleReleaseYear(track).catch(() => null);
  const appleYear = mb.originalYear || recordingYear || albumYear || singleYear ? null : exactAppleEditionYear(track, apple);
  // Discogs master years describe the original master, not the later reissue.
  // Require Apple to establish that this exact track belongs to the same album.
  const discogsYear = !mb.originalYear && !recordingYear && !albumYear && !singleYear && !appleYear &&
    discogs?.albumMasterYear && apple?.album && track.album &&
    !isCollectionOrLive(track.album) &&
    normalizeCatalogText(originalAlbumName(apple.album)) === normalizeCatalogText(originalAlbumName(track.album)) &&
    Number(discogs.albumMasterYear) >= 1900 && Number(discogs.albumMasterYear) <= new Date().getFullYear() + 1
    ? Number(discogs.albumMasterYear) : null;
  const year = mb.originalYear || recordingYear || albumYear || singleYear || appleYear || discogsYear;
  const classification = r27Classification(track, {
    trackTags, artistTags, mbRecordingId: mb.recordingId, mbArtistId: mb.artistId,
    mbOriginalYear: year, yearSource: "", mbGenres: [...(mb.genres || []), ...(cachedArtist?.genres || []), ...(apple?.genre ? [apple.genre] : []), ...(discogs?.genre || []), ...(discogs?.style || [])], mainGenres: [], subgenres: [],
  });
  return {
    trackTags,
    artistTags,
    mbRecordingId: mb.recordingId,
    mbOriginalYear: year,
    yearSource: mb.originalYear ? "musicbrainz-recording-first-release-date" : recordingYear ? "musicbrainz-recording-release-groups" : albumYear ? "musicbrainz-original-album-release-group" : singleYear ? "musicbrainz-exact-single-release-group" : appleYear ? "apple-exact-original-release-record" : discogsYear ? "discogs-original-master-plus-apple-track-match" : "unverified",
    mainGenres: classification.mainGenres,
    subgenres: classification.subgenres,
    mbArtistId: mb.artistId || cachedArtist?.musicbrainz_artist_id || null,
    mbGenres: [...new Set([...(mb.genres || []), ...(Array.isArray(cachedArtist?.genres) ? cachedArtist?.genres || [] : []), ...(apple?.genre ? [apple.genre] : []), ...(discogs?.genre || []), ...(discogs?.style || [])])].slice(0, 16),
    catalogSources: [...(apple ? ["itunes"] : []), ...(discogs ? ["discogs"] : [])],
    // Catalog edition years are evidence candidates only, not original dates.
    catalogCandidates: { apple: apple || null, discogs: discogs || null,
      releaseYearCandidate: apple?.catalogYear || discogs?.albumMasterYear || Number(track.releaseYear) || null,
      yearEvidence: { recordingYear, albumYear, singleYear, appleYear, discogsYear, matchedRecordingId: mb.recordingId || null,
        reason: year ? "recording-or-original-edition-evidence" : "original-recording-date-unverified" } },
  };
}

// R27: curate genre tags rather than storing arbitrary moods, artist names or prose as genres.
// Prefer track evidence; artist tags alone may provide a broad family but not prove a subgenre.
const R27_GENRES = new Map<string, string>([
  ["grunge", "grunge"], ["post grunge", "post grunge"],
  ["alternative metal", "alternative metal"], ["alternative rock", "alternative rock"],
  ["hard rock", "hard rock"], ["heavy metal", "heavy metal"],
  ["thrash metal", "thrash metal"], ["nu metal", "nu metal"],
  ["industrial metal", "industrial metal"], ["industrial rock", "industrial rock"],
  ["metalcore", "metalcore"], ["post hardcore", "post hardcore"],
  ["punk rock", "punk rock"], ["pop punk", "pop punk"],
  ["classic rock", "classic rock"], ["progressive rock", "progressive rock"],
  ["progressive metal", "progressive metal"], ["indie rock", "indie rock"],
  ["blues rock", "blues rock"], ["southern rock", "southern rock"],
  ["alternative", "alternative rock"], ["alt rock", "alternative rock"],
  ["grunge rock", "grunge"], ["seattle sound", "grunge"], ["hardrock", "hard rock"],
  ["rock", "rock"], ["metal", "metal"], ["pop", "pop"],
  ["hip hop", "hip hop"], ["rap", "rap"], ["electronic", "electronic"],
  ["country", "country"], ["folk", "folk"], ["jazz", "jazz"],
  ["r&b", "r&b"], ["soul", "soul"], ["funk", "funk"],
  ["dance", "dance"], ["synthpop", "synthpop"], ["new wave", "new wave"],
  // Valid catalog families previously discarded as if no genre existed.
  ["christian", "christian"], ["christian rock", "christian rock"], ["christian music", "christian"],
  ["children's music", "children's music"], ["childrens music", "children's music"],
  ["kids", "children's music"], ["children", "children's music"],
  ["soundtrack", "soundtrack"], ["soundtracks", "soundtrack"],
  ["film score", "soundtrack"], ["alternative hip hop", "alternative hip hop"],
  ["pop rock", "pop rock"], ["adult alternative", "adult alternative"],
  ["modern rock", "modern rock"], ["indie pop", "indie pop"],
  ["reggae", "reggae"], ["ska", "ska"], ["disco", "disco"],
  ["comedy", "comedy"], ["spoken word", "spoken word"], ["latin", "latin"],
  ["electropop", "electropop"], ["rnb", "r&b"], ["rhythm and blues", "r&b"],
  ["trap", "trap"], ["drum and bass", "drum and bass"], ["dubstep", "dubstep"],
  ["hip-hop/rap", "hip hop"], ["hip hop/rap", "hip hop"], ["hip hop rap", "hip hop"],
  ["prog-rock/art rock", "progressive rock"], ["prog rock/art rock", "progressive rock"], ["progressive", "progressive rock"],
  ["christian & gospel", "christian"], ["gospel", "gospel"], ["hard rock & metal", "hard rock"],
  ["rock & roll", "rock"], ["r&b/soul", "r&b"],
  ["singer/songwriter", "singer songwriter"], ["singer songwriter", "singer songwriter"],
  ["new age", "new age"], ["adult contemporary", "adult contemporary"],
  ["alternative & punk", "alternative rock"], ["indie", "indie rock"],
  ["world", "world"], ["instrumental", "instrumental"], ["worship", "christian"],
]);
function r27GenreTags(values: string[]) {
  const out: string[] = [];
  for (const raw of values) {
    const key = String(raw).toLowerCase().trim().replace(/[-_]+/g, " ").replace(/\s+/g, " ");
    const value = R27_GENRES.get(key) || (key === "christian & gospel" ? "christian" : key === "kids & family" ? "children's music" : null);
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
}
function r27Classification(track: InputTrack, context: ProviderContext) {
  const trackEvidence = r27GenreTags([
    ...context.mbGenres,
    ...context.trackTags.filter(t => t.count >= 1).map(t => t.name),
    ...(track.genre ? track.genre.split(/[,/;]+/) : []),
  ]);
  const artistEvidence = r27GenreTags(context.artistTags.map(t => t.name));
  const main = [...new Set([...trackEvidence, ...artistEvidence])].slice(0, 10);
  const sub = trackEvidence.filter(t => !["rock", "metal", "pop", "rap", "electronic", "country", "folk", "jazz", "dance"].includes(t)).slice(0, 8);
  return { mainGenres: main, subgenres: sub, trackEvidence: trackEvidence.length > 0 };
}
function r27Complete(context: ProviderContext, mainGenres: string[]) {
  return Boolean(context.mbOriginalYear && mainGenres.length);
}

// Look up the exact identified recording's linked release groups. This is
// preferable to using an arbitrary remaster, cover, or compilation date.
async function r30RecordingReleaseYear(recordingId: string): Promise<number | null> {
  if (!/^[0-9a-f-]{36}$/i.test(recordingId)) return null;
  const body = await musicBrainzJson(`https://musicbrainz.org/ws/2/recording/${encodeURIComponent(recordingId)}?inc=releases+release-groups&fmt=json`, 9500);
  const releases = Array.isArray(body?.releases) ? body.releases as Array<Record<string, unknown>> : [];
  const years = releases.map(release => {
    const group = release["release-group"] && typeof release["release-group"] === "object"
      ? release["release-group"] as Record<string, unknown> : null;
    const kind = String(group?.["primary-type"] || "");
    if (!group || !["Album", "Single", "EP"].includes(kind)) return null;
    const match = /^(19|20)\d{2}/.exec(String(group["first-release-date"] || ""));
    return match ? Number(match[0]) : null;
  }).filter((year): year is number => year != null && year >= 1900 && year <= 2100);
  return years.length ? Math.min(...years) : null;
}

// A verified original album release-group date is secondary evidence; the
// uploaded deluxe/remastered edition's own year is never substituted.
async function r27AlbumYear(track: InputTrack): Promise<number | null> {
  if (!track.artist || !track.album) return null;
  if (isCollectionOrLive(track.album) || versionKind(track.title) === "live" || versionKind(track.title) === "remix") return null;
  const originalAlbum = originalAlbumName(track.album);
  const album = normalizeCatalogText(originalAlbum);
  if (!album) return null;
  const query = `releasegroup:"${escapeMb(originalAlbum)}" AND artist:"${escapeMb(leadArtist(track.artist))}"`;
  const body = await musicBrainzJson(`https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(query)}&fmt=json&limit=12`, 8000);
  const rows = Array.isArray(body?.["release-groups"]) ? body["release-groups"] as Array<Record<string, unknown>> : [];
  const matches = rows.filter(row => normalizeCatalogText(row.title) === album &&
    (normalizeCatalogText(musicBrainzCreditName(row)) === normalizeCatalogText(track.artist) ||
      normalizeCatalogText(musicBrainzCreditName(row)) === normalizeCatalogText(leadArtist(track.artist))) &&
    (row["primary-type"] === "Album" || row["primary-type"] === "Single"));
  const years = matches.map(row => String(row["first-release-date"] || "").match(/^(19|20)\d{2}/)?.[0]).filter((y): y is string => Boolean(y)).map(Number);
  return years.length ? Math.min(...years) : null;
}

// R31: Standalone singles may not have a useful album identity. Search the
// artist's actual single release group, rather than an unrelated song/composition.
async function exactSingleReleaseYear(track: InputTrack): Promise<number | null> {
  const title = cleanLookupTitle(track);
  if (!title || !track.artist || versionKind(title) === "live" || versionKind(title) === "remix") return null;
  const query = `releasegroup:"${escapeMb(title)}" AND artist:"${escapeMb(leadArtist(track.artist))}"`;
  const body = await musicBrainzJson(`https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(query)}&fmt=json&limit=8`, 8000);
  const groups = Array.isArray(body?.["release-groups"]) ? body["release-groups"] as Array<Record<string, unknown>> : [];
  const exact = groups.filter(row => normalizeCatalogText(row.title) === normalizeCatalogText(title) &&
    (normalizeCatalogText(musicBrainzCreditName(row)) === normalizeCatalogText(track.artist) ||
      normalizeCatalogText(musicBrainzCreditName(row)) === normalizeCatalogText(leadArtist(track.artist))) &&
    row["primary-type"] === "Single");
  const years = exact.map(row => /^(19|20)\d{2}/.exec(String(row["first-release-date"] || ""))?.[0]).filter((v): v is string => Boolean(v)).map(Number);
  return years.length ? Math.min(...years) : null;
}
function exactAppleEditionYear(track: InputTrack, apple: Awaited<ReturnType<typeof appleCatalog>>) {
  if (!apple?.catalogYear || apple.catalogYear < 1900 || apple.catalogYear > new Date().getFullYear() + 1) return null;
  const album = String(apple.album || "");
  const wanted = String(track.album || "");
  const albumClean = normalizeCatalogText(originalAlbumName(album));
  const wantedClean = normalizeCatalogText(originalAlbumName(wanted));
  // A remaster, compilation, remix, live set or best-of catalog date is not the
  // original recording date. An exact originally-issued album/single is evidence.
  if (apple.isCompilation || !albumClean || !wantedClean || albumClean !== wantedClean || isCollectionOrLive(album) ||
    isCollectionOrLive(wanted) || isEdition(album) || isEdition(wanted)) return null;
  if (["live", "remix", "demo"].includes(versionKind(`${track.title} ${wanted}`))) return null;
  const isSingle = /(?:^|\s)(?:-\s*)?single$/i.test(album) && albumClean === wantedClean;
  const exactOriginalAlbum = !/\b(single|ep|greatest|remaster)\b/i.test(album) &&
    normalizeCatalogText(album) === normalizeCatalogText(wanted);
  return isSingle || exactOriginalAlbum ? apple.catalogYear : null;
}

function sourceList(context: ProviderContext, cyanite = false, deezer = false) {
  const sources = ["mvp"];
  if (context.trackTags.length || context.artistTags.length) sources.push("lastfm");
  if (context.mbRecordingId || context.mbArtistId || context.yearSource.startsWith("musicbrainz")) sources.push("musicbrainz");
  for (const source of context.catalogSources || []) sources.push(source);
  if (deezer) sources.push("deezer");
  if (cyanite) sources.push("cyanite");
  return sources;
}

function confidenceFor(context: ProviderContext, cyanite = false, deezer = false) {
  let confidence = .50;
  if (context.trackTags.length) confidence += .10;
  if (context.artistTags.length) confidence += .08;
  if (context.mbRecordingId) confidence += .10;
  if (context.mbArtistId) confidence += .05;
  if (deezer) confidence += .07;
  if (cyanite) confidence += .15;
  return Math.min(.98, confidence);
}

function extractCyaniteTrackId(payload: unknown) {
  const row = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  if (typeof row.id === "string") return row.id;
  const track = row.track && typeof row.track === "object" ? row.track as Record<string, unknown> : {};
  return typeof track.id === "string" ? track.id : null;
}

function modelObjects(value: unknown, output: Array<Record<string, unknown>> = []) {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    value.forEach((item) => modelObjects(item, output));
    return output;
  }
  const row = value as Record<string, unknown>;
  if (typeof row.version === "string") output.push(row);
  Object.values(row).forEach((child) => {
    if (child && typeof child === "object") modelObjects(child, output);
  });
  return output;
}

function score(scores: unknown, key: string) {
  if (!scores || typeof scores !== "object") return 0;
  const value = Number((scores as Record<string, unknown>)[key] ?? 0);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function tagsFromModel(model: Record<string, unknown> | undefined) {
  return Array.isArray(model?.tags) ? (model?.tags as unknown[]).map(String).filter(Boolean) : [];
}

function applyCyanite(base: SongDNA, payload: unknown) {
  const models = modelObjects(payload);
  const byVersion = new Map(models.map((model) => [String(model.version), model]));
  if (!byVersion.size) return null;
  let dna = { ...base };

  const advanced = byVersion.get("MoodAdvancedV2");
  const simple = byVersion.get("MoodSimpleV2");
  const moodScores = advanced?.scores || simple?.scores;
  if (moodScores && typeof moodScores === "object") {
    const energetic = Math.max(score(moodScores, "energetic"), score(moodScores, "excited"), score(moodScores, "exhilarating"));
    const calm = Math.max(score(moodScores, "calm"), score(moodScores, "tranquil"), score(moodScores, "contented"));
    const aggressive = Math.max(score(moodScores, "aggressive"), score(moodScores, "angry"), score(moodScores, "violent"));
    const bright = Math.max(score(moodScores, "bright"), score(moodScores, "cheerful"), score(moodScores, "happy"));
    const dark = Math.max(score(moodScores, "dark"), score(moodScores, "gloomy"), score(moodScores, "eerie"));
    const uplifting = Math.max(score(moodScores, "uplifting"), score(moodScores, "hopeful"), score(moodScores, "feelGood"));
    const reflective = Math.max(score(moodScores, "thoughtful"), score(moodScores, "bittersweet"), score(moodScores, "emotional"));
    const motivation = Math.max(score(moodScores, "determined"), score(moodScores, "confident"), score(moodScores, "heroic"), score(moodScores, "triumphant"));
    const chaos = Math.max(score(moodScores, "agitated"), score(moodScores, "boisterous"), score(moodScores, "violent"));
    const heavy = Math.max(score(moodScores, "heavy"), score(moodScores, "powerful"));
    const atmospheric = Math.max(score(moodScores, "dreamy"), score(moodScores, "ethereal"), score(moodScores, "mysterious"));
    const moodPatch: Partial<SongDNA> = {
      energy: clamp((energetic * .84 + (1 - calm) * .16) * 100),
      aggression: clamp(aggressive * 100),
      heaviness: clamp((heavy * .74 + aggressive * .26) * 100),
      brightness: clamp(bright * 100),
      darkness: clamp(dark * 100),
      uplifting: clamp(uplifting * 100),
      reflective: clamp(reflective * 100),
      motivational: clamp(motivation * 100),
      chaotic: clamp(chaos * 100),
      atmospheric: clamp(atmospheric * 100),
      relaxing: clamp(calm * 100),
      upbeat: clamp(Math.max(score(moodScores, "upbeat"), bright, uplifting) * 100),
    };
    dna = mergeDna(dna, moodPatch, .86);
  }

  const movement = byVersion.get("MovementV2");
  if (movement?.scores && typeof movement.scores === "object") {
    const driving = Math.max(score(movement.scores, "driving"), score(movement.scores, "running"), score(movement.scores, "pulsing"), score(movement.scores, "stomping"));
    const flowing = Math.max(score(movement.scores, "flowing"), score(movement.scores, "steady"));
    dna.drive = clamp(dna.drive * .25 + driving * 75);
    dna.focus = clamp(dna.focus * .55 + flowing * 45);
  }

  const valence = byVersion.get("ValenceArousalV2");
  if (valence?.scores && typeof valence.scores === "object") {
    const arousalRaw = Number((valence.scores as Record<string, unknown>).arousal);
    const valenceRaw = Number((valence.scores as Record<string, unknown>).valence);
    if (Number.isFinite(arousalRaw)) dna.energy = clamp(dna.energy * .25 + ((arousalRaw + 1) / 2) * 75);
    if (Number.isFinite(valenceRaw)) {
      const positivity = ((valenceRaw + 1) / 2) * 100;
      dna.brightness = clamp(dna.brightness * .40 + positivity * .60);
      dna.uplifting = clamp(dna.uplifting * .45 + positivity * .55);
    }
  }

  const bpmModel = byVersion.get("BpmV2");
  const bpm = bpmModel && Number.isFinite(Number(bpmModel.tag)) ? Number(bpmModel.tag) : null;
  const tempoModel = byVersion.get("TempoV1");
  const keyModel = byVersion.get("KeyV2");
  const genreModel = byVersion.get("MainGenreV2");
  const subgenreModel = byVersion.get("SubgenreV2");
  const characterModel = byVersion.get("CharacterV2");
  const musicForModel = byVersion.get("MusicForV1");
  const descriptionModel = byVersion.get("AutoDescriptionV2");

  if (bpm) {
    const bpmEnergy = clamp((bpm - 60) / 140 * 100);
    dna.energy = clamp(dna.energy * .72 + bpmEnergy * .28);
  }
  dna.intensity = clamp(dna.energy * .38 + dna.drive * .24 + dna.aggression * .23 + dna.heaviness * .15);
  dna.workoutFit = clamp(dna.energy * .28 + dna.drive * .32 + dna.motivational * .23 + (100 - dna.relaxing) * .17);

  const keySignature = typeof keyModel?.tag === "string" && keyModel.tag.trim() ? keyModel.tag.trim() : null;
  const tempoLabel = typeof tempoModel?.tag === "string" && tempoModel.tag.trim() ? tempoModel.tag.trim() : null;

  return {
    dna,
    bpm,
    audioReady: bpm != null && keySignature != null,
    tempoLabel,
    keySignature,
    mainGenres: tagsFromModel(genreModel),
    subgenres: tagsFromModel(subgenreModel),
    moods: [...new Set([...tagsFromModel(advanced), ...tagsFromModel(simple)])].slice(0, 16),
    characterTags: tagsFromModel(characterModel).slice(0, 12),
    movementTags: tagsFromModel(movement).slice(0, 12),
    musicFor: tagsFromModel(musicForModel).slice(0, 16),
    description: typeof descriptionModel?.description === "string" ? descriptionModel.description : null,
    raw: payload,
  };
}

async function fetchCyaniteModels(trackId: string, key: string) {
  const query = CYANITE_MODELS.map((model) => `model=${encodeURIComponent(model)}`).join("&");
  const response = await fetch(`https://rest-api.cyanite.ai/v1/library-tracks/${encodeURIComponent(trackId)}/models?${query}`, {
    headers: { "x-api-key": key },
  });
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

async function uploadCyanite(track: InputTrack, audioUrl: string, key: string) {
  const response = await fetch(audioUrl);
  if (!response.ok) throw new Error(`Audio source unavailable (${response.status}).`);
  const blob = await response.blob();
  if (blob.size > CYANITE_LIMIT_BYTES) throw new Error("Track exceeds Cyanite 20 MB analysis limit.");
  const form = new FormData();
  form.append("title", `${track.artist ? `${track.artist} - ` : ""}${track.title}`);
  form.append("inputType", "MP3");
  form.append("file", new File([blob], track.originalName || `${track.title}.mp3`, { type: "audio/mpeg" }));
  const upload = await fetch("https://rest-api.cyanite.ai/v1/library-tracks", {
    method: "POST",
    headers: { "x-api-key": key },
    body: form,
  });
  if (!upload.ok) throw new Error(`Cyanite upload failed (${upload.status}).`);
  const payload = await upload.json().catch(() => null);
  const id = extractCyaniteTrackId(payload);
  if (!id) throw new Error("Cyanite did not return a track ID.");
  return id;
}

function inputIsCyaniteEligible(track: InputTrack, audioUrl: string | null) {
  const type = String(track.mimeType || "").toLowerCase();
  const name = String(track.originalName || "").toLowerCase();
  const mp3 = type.includes("mpeg") || type.includes("mp3") || name.endsWith(".mp3");
  const sizeOk = !track.fileSizeBytes || Number(track.fileSizeBytes) <= CYANITE_LIMIT_BYTES;
  const durationOk = !track.durationSeconds || Number(track.durationSeconds) <= CYANITE_LIMIT_SECONDS;
  return Boolean(audioUrl && mp3 && sizeOk && durationOk);
}

async function upsertArtist(service: ReturnType<typeof createClient>, userId: string, track: InputTrack, context: ProviderContext, dna: ArtistDNA) {
  const key = track.artistKey || artistKey(track.artist || "");
  if (!key || !track.artist) return;
  const sources = sourceList(context, false);
  await service.from(ARTIST_TABLE).upsert({
    user_id: userId,
    artist_key: key,
    artist_name: track.artist,
    status: "complete",
    analysis_version: ANALYSIS_VERSION,
    confidence: confidenceFor(context, false),
    source: sources,
    artist_dna: dna,
    top_tags: context.artistTags,
    genres: context.mainGenres,
    musicbrainz_artist_id: context.mbArtistId,
    analyzed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    error: null,
  }, { onConflict: "user_id,artist_key" });
}

async function finalizeCyanite(
  service: ReturnType<typeof createClient>,
  userId: string,
  track: InputTrack,
  context: ProviderContext,
  artistDna: ArtistDNA,
  baseDna: SongDNA,
  cyaniteTrackId: string,
  key: string,
  fallbackBpm: number | null,
  deezerUsed: boolean,
) {
  for (let attempt = 0; attempt < 14; attempt += 1) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 4500));
    const payload = await fetchCyaniteModels(cyaniteTrackId, key).catch(() => null);
    const cyanite = applyCyanite(baseDna, payload);
    if (!cyanite || !cyanite.audioReady) continue;
    const source = sourceList(context, true, deezerUsed);
    const row = {
      user_id: userId,
      track_id: track.id,
      artist_key: track.artistKey || artistKey(track.artist || ""),
      artist_name: track.artist || "",
      status: r27Complete(context, [...cyanite.mainGenres, ...context.mainGenres]) ? "complete" : "partial",
      analysis_version: ANALYSIS_VERSION,
      confidence: confidenceFor(context, true, deezerUsed),
      source,
      song_dna: cyanite.dna,
      artist_dna: artistDna,
      bpm: cyanite.bpm ?? fallbackBpm,
      key_signature: cyanite.keySignature,
      tempo_label: cyanite.tempoLabel,
      main_genres: [...new Set([...cyanite.mainGenres, ...context.mainGenres])],
      subgenres: [...new Set([...cyanite.subgenres, ...context.subgenres])],
      moods: cyanite.moods,
      character_tags: cyanite.characterTags,
      movement_tags: cyanite.movementTags,
      music_for: cyanite.musicFor,
      description: cyanite.description,
      musicbrainz_recording_id: context.mbRecordingId,
      musicbrainz_artist_id: context.mbArtistId,
      lastfm_track_tags: context.trackTags,
      cyanite_track_id: cyaniteTrackId,
      cyanite_status: "complete",
      provider_payload: {
        cyanite: cyanite.raw,
        semantic_profile: buildSemanticProfile(track, context, {
          moods: cyanite.moods,
          characterTags: cyanite.characterTags,
          movementTags: cyanite.movementTags,
          musicFor: cyanite.musicFor,
          description: cyanite.description,
        }),
      },
      analyzed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      error: null,
    };
    await service.from(TRACK_TABLE).upsert(row, { onConflict: "user_id,track_id" });
    return;
  }
  await service.from(TRACK_TABLE).update({
    cyanite_status: "processing",
    updated_at: new Date().toISOString(),
  }).eq("user_id", userId).eq("track_id", track.id);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: "Supabase function environment is incomplete." }, 500);

    const authorization = req.headers.get("Authorization") || "";
    if (!authorization) return json({ error: "Sign in before analyzing music." }, 401);
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return json({ error: "Music Intelligence authentication failed." }, 401);
    const userId = authData.user.id;
    const service = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const track = body.track && typeof body.track === "object" ? body.track as InputTrack : null;
    if (!track?.id || !track.title) return json({ error: "Missing music track." }, 400);
    const force = Boolean(body.force);
    const audioUrl = typeof body.audioUrl === "string" ? body.audioUrl : null;

    const { data: existing } = await service.from(TRACK_TABLE).select("*").eq("user_id", userId).eq("track_id", track.id).maybeSingle();
    if (existing && !force && Number(existing.analysis_version || 0) >= ANALYSIS_VERSION && existing.status === "complete") {
      return json({ intelligence: existing, reused: true });
    }

    const cyaniteKey = Deno.env.get("CYANITE_API_KEY") || "";
    if (existing?.cyanite_track_id && cyaniteKey &&
      Number(existing.provider_payload?.semantic_profile?.originalReleaseYear || 0) >= 1900 &&
      (Array.isArray(existing.main_genres) && existing.main_genres.length > 0 ||
       Array.isArray(existing.subgenres) && existing.subgenres.length > 0)) {
      const payload = await fetchCyaniteModels(String(existing.cyanite_track_id), cyaniteKey).catch(() => null);
      const cyanite = applyCyanite((existing.song_dna || baseSongDna(track)) as SongDNA, payload);
      if (cyanite?.audioReady) {
        const context: ProviderContext = {
          trackTags: Array.isArray(existing.lastfm_track_tags) ? existing.lastfm_track_tags : [],
          artistTags: [],
          mbRecordingId: existing.musicbrainz_recording_id || null,
          mbOriginalYear: Number(existing.provider_payload?.semantic_profile?.originalReleaseYear) || null,
          yearSource: String(existing.provider_payload?.semantic_profile?.originalReleaseYearSource || "unverified"),
          mainGenres: Array.isArray(existing.main_genres) ? existing.main_genres : [],
          subgenres: Array.isArray(existing.subgenres) ? existing.subgenres : [],
          mbArtistId: existing.musicbrainz_artist_id || null,
          mbGenres: Array.isArray(existing.main_genres) ? existing.main_genres : [],
        };
        const updated = {
          ...existing,
          status: r27Complete(context, [...cyanite.mainGenres, ...(Array.isArray(existing.main_genres) ? existing.main_genres : [])]) ? "complete" : "partial",
          analysis_version: ANALYSIS_VERSION,
          confidence: Math.max(Number(existing.confidence || 0), confidenceFor(context, true)),
          source: [...new Set([...(Array.isArray(existing.source) ? existing.source : []), "cyanite"])],
          song_dna: cyanite.dna,
          bpm: cyanite.bpm ?? existing.bpm ?? null,
          key_signature: cyanite.keySignature ?? existing.key_signature ?? null,
          tempo_label: cyanite.tempoLabel ?? existing.tempo_label ?? null,
          main_genres: [...new Set([...cyanite.mainGenres, ...(Array.isArray(existing.main_genres) ? existing.main_genres : [])])],
          subgenres: [...new Set([...cyanite.subgenres, ...(Array.isArray(existing.subgenres) ? existing.subgenres : [])])],
          moods: cyanite.moods,
          character_tags: cyanite.characterTags,
          movement_tags: cyanite.movementTags,
          music_for: cyanite.musicFor,
          description: cyanite.description,
          cyanite_status: "complete",
          provider_payload: {
            ...(existing.provider_payload || {}),
            cyanite: cyanite.raw,
            semantic_profile: buildSemanticProfile(track, {
              ...context,
              trackTags: Array.isArray(existing.lastfm_track_tags) ? existing.lastfm_track_tags : context.trackTags,
            }, {
              moods: cyanite.moods,
              characterTags: cyanite.characterTags,
              movementTags: cyanite.movementTags,
              musicFor: cyanite.musicFor,
              description: cyanite.description,
            }),
          },
          analyzed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          error: null,
        };
        const { data: saved, error: saveError } = await service.from(TRACK_TABLE).upsert(updated, { onConflict: "user_id,track_id" }).select("*").single();
        if (saveError) throw saveError;
        return json({ intelligence: saved, reused: false });
      }
    }

    const normalizedArtistKey = track.artistKey || artistKey(track.artist || "");
    const { data: cachedArtist } = normalizedArtistKey
      ? await service.from(ARTIST_TABLE).select("analysis_version,artist_dna,top_tags,genres,musicbrainz_artist_id").eq("user_id", userId).eq("artist_key", normalizedArtistKey).maybeSingle()
      : { data: null };
    const [context, deezer] = await Promise.all([
      providerContext(track, cachedArtist as CachedArtistRow | null),
      deezerAudioFacts(track).catch(() => null),
    ]);
    const oldSemantic = existing?.provider_payload?.semantic_profile;
    if (!context.mbOriginalYear && Number(oldSemantic?.originalReleaseYear) >= 1900 && Number(oldSemantic?.originalReleaseYear) <= 2100) {
      context.mbOriginalYear = Number(oldSemantic.originalReleaseYear);
      context.yearSource = String(oldSemantic.originalReleaseYearSource || "previously-verified");
    }
    if (existing) {
      const retainedCatalog = existing.provider_payload?.catalogCandidates &&
        typeof existing.provider_payload.catalogCandidates === "object"
        ? existing.provider_payload.catalogCandidates as Record<string, unknown> : {};
      const previousApple = retainedCatalog.apple && typeof retainedCatalog.apple === "object"
        ? retainedCatalog.apple as Record<string, unknown> : null;
      const previousDiscogs = retainedCatalog.discogs && typeof retainedCatalog.discogs === "object"
        ? retainedCatalog.discogs as Record<string, unknown> : null;
      const priorCatalogGenres = [
        ...(typeof previousApple?.genre === "string" ? [previousApple.genre] : []),
        ...(Array.isArray(previousDiscogs?.genre) ? previousDiscogs.genre.map(String) : []),
        ...(Array.isArray(previousDiscogs?.style) ? previousDiscogs.style.map(String) : []),
      ];
      const previousClassification = r27GenreTags(priorCatalogGenres);
      context.mainGenres = [...new Set([...context.mainGenres, ...previousClassification,
        ...(Array.isArray(existing.main_genres) ? existing.main_genres : [])])].slice(0, 12);
      context.subgenres = [...new Set([...context.subgenres,
        ...(Array.isArray(existing.subgenres) ? existing.subgenres : [])])].slice(0, 10);
      context.mbGenres = [...new Set([...context.mbGenres, ...priorCatalogGenres])].slice(0, 18);
      context.catalogCandidates = {
        ...retainedCatalog,
        ...(context.catalogCandidates || {}),
        apple: context.catalogCandidates?.apple || retainedCatalog.apple || null,
        discogs: context.catalogCandidates?.discogs || retainedCatalog.discogs || null,
      };
      // The saved Apple candidate previously passed exact artist/title matching;
      // reuse it when a later provider request was throttled, not an arbitrary date.
      if (!context.mbOriginalYear && previousApple) {
        const stored = {
          album: String(previousApple.album || ""), catalogYear: Number(previousApple.catalogYear || 0),
        } as NonNullable<Awaited<ReturnType<typeof appleCatalog>>>;
        const supportedYear = exactAppleEditionYear(track, stored);
        if (supportedYear) {
          context.mbOriginalYear = supportedYear;
          context.yearSource = "apple-cached-exact-original-release-record";
          context.catalogSources = [...new Set([...(context.catalogSources || []), "itunes"])];
        }
      }
    }
    const cachedArtistDna = cachedArtist && Number(cachedArtist.analysis_version || 0) >= ANALYSIS_VERSION && cachedArtist.artist_dna
      ? cachedArtist.artist_dna as ArtistDNA
      : null;
    const aDna = cachedArtistDna || deriveArtistDna(track, context);
    const sDna = applyTempoFacts(deriveSongDna(track, context, aDna), deezer?.bpm ?? null);
    if (!cachedArtistDna) await upsertArtist(service, userId, track, context, aDna);

    let cyaniteTrackId = existing?.cyanite_track_id ? String(existing.cyanite_track_id) : null;
    let cyaniteStatus: string | null = cyaniteKey ? "not_eligible" : "not_configured";
    let cyaniteError: string | null = null;
    const eligible = Boolean(cyaniteKey && inputIsCyaniteEligible(track, audioUrl));

    if (eligible && !cyaniteTrackId && audioUrl) {
      try {
        cyaniteTrackId = await uploadCyanite(track, audioUrl, cyaniteKey);
        cyaniteStatus = "processing";
      } catch (error) {
        cyaniteStatus = "failed";
        cyaniteError = error instanceof Error ? error.message : "Cyanite upload failed.";
      }
    } else if (eligible && cyaniteTrackId) {
      cyaniteStatus = "processing";
    }

    const deezerUsed = Boolean(deezer?.bpm);
    const sources = sourceList(context, false, deezerUsed);
    const status = cyaniteStatus === "processing" ? "processing" : r27Complete(context, context.mainGenres) ? "complete" : "partial";
    const provisional = {
      user_id: userId,
      track_id: track.id,
      artist_key: track.artistKey || artistKey(track.artist || ""),
      artist_name: track.artist || "",
      status,
      analysis_version: ANALYSIS_VERSION,
      confidence: confidenceFor(context, false, deezerUsed),
      source: sources,
      song_dna: sDna,
      artist_dna: aDna,
      bpm: deezer?.bpm ?? existing?.bpm ?? null,
      key_signature: existing?.key_signature ?? null,
      tempo_label: tempoLabelFromBpm(deezer?.bpm ?? existing?.bpm ?? null) ?? existing?.tempo_label ?? null,
      main_genres: [...new Set([...context.mainGenres, ...(Array.isArray(existing?.main_genres) ? existing.main_genres : [])])],
      subgenres: [...new Set([...context.subgenres, ...(Array.isArray(existing?.subgenres) ? existing.subgenres : [])])],
      moods: context.trackTags.slice(0, 10).map((tag) => tag.name),
      character_tags: existing?.character_tags || [],
      movement_tags: existing?.movement_tags || [],
      music_for: existing?.music_for || [],
      description: existing?.description || null,
      musicbrainz_recording_id: context.mbRecordingId,
      musicbrainz_artist_id: context.mbArtistId,
      lastfm_track_tags: context.trackTags,
      cyanite_track_id: cyaniteTrackId,
      cyanite_status: cyaniteStatus,
      provider_payload: {
        ...(existing?.provider_payload || {}),
        lastfmArtistTags: context.artistTags,
        musicbrainzGenres: context.mbGenres,
        catalogCandidates: context.catalogCandidates || {},
        deezer: deezer ? { trackId: deezer.trackId, bpm: deezer.bpm, gain: deezer.gain, confidence: deezer.confidence } : null,
        semantic_profile: buildSemanticProfile(track, context, {
          moods: context.trackTags.slice(0, 10).map((tag) => tag.name),
          characterTags: existing?.character_tags || [],
          movementTags: existing?.movement_tags || [],
          musicFor: existing?.music_for || [],
          description: existing?.description || null,
        }),
      },
      analyzed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      error: cyaniteError,
    };
    const { data: saved, error: saveError } = await service.from(TRACK_TABLE).upsert(provisional, { onConflict: "user_id,track_id" }).select("*").single();
    if (saveError) throw saveError;

    if (cyaniteStatus === "processing" && cyaniteTrackId && cyaniteKey) {
      const task = finalizeCyanite(
        service,
        userId,
        track,
        context,
        aDna,
        sDna,
        cyaniteTrackId,
        cyaniteKey,
        deezer?.bpm ?? existing?.bpm ?? null,
        deezerUsed,
      ).catch(() => undefined);
      const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } }).EdgeRuntime;
      if (runtime?.waitUntil) runtime.waitUntil(task);
    }

    return json({ intelligence: saved, reused: false });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Music Intelligence failed." }, 500);
  }
});
