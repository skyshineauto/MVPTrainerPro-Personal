import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TRACK_TABLE = "trainer_music_track_intelligence";
const ARTIST_TABLE = "trainer_music_artist_intelligence";
const ANALYSIS_VERSION = 1;
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

async function musicBrainzIdentity(track: InputTrack) {
  if (!track.artist || !track.title) return { recordingId: null, artistId: null, genres: [] as string[] };
  const query = `recording:"${escapeMb(track.title)}" AND artist:"${escapeMb(track.artist)}"`;
  const url = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}&fmt=json&limit=5`;
  const response = await fetch(url, {
    headers: { "User-Agent": "MVPTrainerPro/1.0 (music-intelligence)" },
  });
  if (!response.ok) return { recordingId: null, artistId: null, genres: [] as string[] };
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  const recordings = Array.isArray(payload?.recordings) ? payload?.recordings as Array<Record<string, unknown>> : [];
  const wantedTitle = normalizeCatalogText(track.title);
  const wantedArtist = normalizeCatalogText(track.artist);
  const wantedDurationMs = track.durationSeconds ? Number(track.durationSeconds) * 1000 : null;
  const ranked = recordings.map((recording) => {
    const candidateTitle = normalizeCatalogText(recording.title);
    const candidateArtist = normalizeCatalogText(musicBrainzCreditName(recording));
    let score = 0;
    if (wantedTitle && candidateTitle === wantedTitle) score += 70;
    else if (wantedTitle && candidateTitle && (candidateTitle.includes(wantedTitle) || wantedTitle.includes(candidateTitle))) score += 34;
    if (wantedArtist && candidateArtist === wantedArtist) score += 55;
    else if (wantedArtist && candidateArtist && (candidateArtist.includes(wantedArtist) || wantedArtist.includes(candidateArtist))) score += 22;
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
  const best = ranked[0]?.score >= 45 ? ranked[0].recording : null;
  if (!best) return { recordingId: null, artistId: null, genres: [] as string[] };
  const credits = Array.isArray(best["artist-credit"]) ? best["artist-credit"] as Array<Record<string, unknown>> : [];
  const firstCredit = credits[0] || {};
  const artist = firstCredit.artist && typeof firstCredit.artist === "object" ? firstCredit.artist as Record<string, unknown> : {};
  const genresRaw = Array.isArray(best.genres) ? best.genres as Array<Record<string, unknown>> : [];
  return {
    recordingId: typeof best.id === "string" ? best.id : null,
    artistId: typeof artist.id === "string" ? artist.id : null,
    genres: genresRaw.map((item) => String(item.name || "").trim()).filter(Boolean).slice(0, 10),
  };
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
  const [trackTags, artistTags, mb] = await Promise.all([
    lastFmKey && track.artist && track.title ? lastFmTags("track.getTopTags", track, lastFmKey).catch(() => []) : Promise.resolve([]),
    cachedTags.length ? Promise.resolve(cachedTags) : lastFmKey && track.artist ? lastFmTags("artist.getTopTags", track, lastFmKey).catch(() => []) : Promise.resolve([]),
    musicBrainzIdentity(track).catch(() => ({ recordingId: null, artistId: null, genres: [] as string[] })),
  ]);
  return {
    trackTags,
    artistTags,
    mbRecordingId: mb.recordingId,
    mbArtistId: mb.artistId || cachedArtist?.musicbrainz_artist_id || null,
    mbGenres: [...new Set([...(mb.genres || []), ...(Array.isArray(cachedArtist?.genres) ? cachedArtist?.genres || [] : [])])].slice(0, 12),
  };
}

function sourceList(context: ProviderContext, cyanite = false) {
  const sources = ["mvp"];
  if (context.trackTags.length || context.artistTags.length) sources.push("lastfm");
  if (context.mbRecordingId || context.mbArtistId || context.mbGenres.length) sources.push("musicbrainz");
  if (cyanite) sources.push("cyanite");
  return sources;
}

function confidenceFor(context: ProviderContext, cyanite = false) {
  let confidence = .50;
  if (context.trackTags.length) confidence += .10;
  if (context.artistTags.length) confidence += .08;
  if (context.mbRecordingId) confidence += .10;
  if (context.mbArtistId) confidence += .05;
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

  return {
    dna,
    bpm,
    tempoLabel: typeof tempoModel?.tag === "string" ? tempoModel.tag : null,
    keySignature: typeof keyModel?.tag === "string" ? keyModel.tag : null,
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
    genres: context.mbGenres,
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
) {
  for (let attempt = 0; attempt < 14; attempt += 1) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 4500));
    const payload = await fetchCyaniteModels(cyaniteTrackId, key).catch(() => null);
    const cyanite = applyCyanite(baseDna, payload);
    if (!cyanite) continue;
    const source = sourceList(context, true);
    const row = {
      user_id: userId,
      track_id: track.id,
      artist_key: track.artistKey || artistKey(track.artist || ""),
      artist_name: track.artist || "",
      status: "complete",
      analysis_version: ANALYSIS_VERSION,
      confidence: confidenceFor(context, true),
      source,
      song_dna: cyanite.dna,
      artist_dna: artistDna,
      bpm: cyanite.bpm,
      key_signature: cyanite.keySignature,
      tempo_label: cyanite.tempoLabel,
      main_genres: cyanite.mainGenres.length ? cyanite.mainGenres : context.mbGenres,
      subgenres: cyanite.subgenres,
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
      provider_payload: { cyanite: cyanite.raw },
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
    if (existing?.cyanite_track_id && cyaniteKey) {
      const payload = await fetchCyaniteModels(String(existing.cyanite_track_id), cyaniteKey).catch(() => null);
      const cyanite = applyCyanite((existing.song_dna || baseSongDna(track)) as SongDNA, payload);
      if (cyanite) {
        const context: ProviderContext = {
          trackTags: Array.isArray(existing.lastfm_track_tags) ? existing.lastfm_track_tags : [],
          artistTags: [],
          mbRecordingId: existing.musicbrainz_recording_id || null,
          mbArtistId: existing.musicbrainz_artist_id || null,
          mbGenres: Array.isArray(existing.main_genres) ? existing.main_genres : [],
        };
        const updated = {
          ...existing,
          status: "complete",
          confidence: Math.max(Number(existing.confidence || 0), confidenceFor(context, true)),
          source: [...new Set([...(Array.isArray(existing.source) ? existing.source : []), "cyanite"])],
          song_dna: cyanite.dna,
          bpm: cyanite.bpm,
          key_signature: cyanite.keySignature,
          tempo_label: cyanite.tempoLabel,
          main_genres: cyanite.mainGenres.length ? cyanite.mainGenres : existing.main_genres,
          subgenres: cyanite.subgenres,
          moods: cyanite.moods,
          character_tags: cyanite.characterTags,
          movement_tags: cyanite.movementTags,
          music_for: cyanite.musicFor,
          description: cyanite.description,
          cyanite_status: "complete",
          provider_payload: { ...(existing.provider_payload || {}), cyanite: cyanite.raw },
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
    const context = await providerContext(track, cachedArtist as CachedArtistRow | null);
    const cachedArtistDna = cachedArtist && Number(cachedArtist.analysis_version || 0) >= ANALYSIS_VERSION && cachedArtist.artist_dna
      ? cachedArtist.artist_dna as ArtistDNA
      : null;
    const aDna = cachedArtistDna || deriveArtistDna(track, context);
    const sDna = deriveSongDna(track, context, aDna);
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

    const sources = sourceList(context, false);
    const status = cyaniteStatus === "processing" ? "processing" : "complete";
    const provisional = {
      user_id: userId,
      track_id: track.id,
      artist_key: track.artistKey || artistKey(track.artist || ""),
      artist_name: track.artist || "",
      status,
      analysis_version: ANALYSIS_VERSION,
      confidence: confidenceFor(context, false),
      source: sources,
      song_dna: sDna,
      artist_dna: aDna,
      bpm: existing?.bpm || null,
      key_signature: existing?.key_signature || null,
      tempo_label: existing?.tempo_label || null,
      main_genres: context.mbGenres,
      subgenres: existing?.subgenres || [],
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
      provider_payload: { lastfmArtistTags: context.artistTags, musicbrainzGenres: context.mbGenres },
      analyzed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      error: cyaniteError,
    };
    const { data: saved, error: saveError } = await service.from(TRACK_TABLE).upsert(provisional, { onConflict: "user_id,track_id" }).select("*").single();
    if (saveError) throw saveError;

    if (cyaniteStatus === "processing" && cyaniteTrackId && cyaniteKey) {
      const task = finalizeCyanite(service, userId, track, context, aDna, sDna, cyaniteTrackId, cyaniteKey).catch(() => undefined);
      const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } }).EdgeRuntime;
      if (runtime?.waitUntil) runtime.waitUntil(task);
    }

    return json({ intelligence: saved, reused: false });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Music Intelligence failed." }, 500);
  }
});
