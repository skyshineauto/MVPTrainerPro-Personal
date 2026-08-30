import { supabase } from "./supabase";
import { analyzeMusicAudioLocally, type LocalAudioIntelligence } from "./musicAudioIntelligence";
import {
  getMusicTrackSignedUrl,
  type MusicTrack,
} from "./musicStorage";
import {
  cacheMusicTrackIntelligence,
  cacheMusicTrackIntelligenceMany,
  clearMusicIntelligenceCache,
  getCachedMusicTrackIntelligence,
  normalizeMusicArtistKey,
  type MusicArtistDNA,
  type MusicSongDNA,
  type MusicTrackIntelligence,
} from "./musicIntelligenceCache";

export type { MusicArtistDNA, MusicSongDNA, MusicTrackIntelligence } from "./musicIntelligenceCache";

export const MUSIC_INTELLIGENCE_VERSION = 3;
const TRACK_TABLE = "trainer_music_track_intelligence";

type DbTrackIntelligence = {
  track_id: string;
  artist_key: string | null;
  artist_name: string | null;
  status: MusicTrackIntelligence["status"] | null;
  analysis_version: number | null;
  confidence: number | null;
  source: string[] | null;
  song_dna: MusicSongDNA | null;
  artist_dna: MusicArtistDNA | null;
  bpm: number | null;
  key_signature: string | null;
  tempo_label: string | null;
  main_genres: string[] | null;
  subgenres: string[] | null;
  moods: string[] | null;
  character_tags: string[] | null;
  movement_tags: string[] | null;
  music_for: string[] | null;
  description: string | null;
  musicbrainz_recording_id: string | null;
  musicbrainz_artist_id: string | null;
  cyanite_track_id: string | null;
  cyanite_status: string | null;
  analyzed_at: string | null;
  updated_at: string | null;
  error: string | null;
};

export type MusicIntelligenceStage =
  | "identity"
  | "artist_dna"
  | "song_dna"
  | "audio_intelligence"
  | "saving"
  | "complete";

export type AnalyzeMusicIntelligenceOptions = {
  force?: boolean;
  onStage?: (stage: MusicIntelligenceStage, detail: string) => void;
};

function clamp(value: unknown, fallback = 50) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : fallback;
}

function sanitizeSongDna(value: Partial<MusicSongDNA> | null | undefined): MusicSongDNA {
  return {
    energy: clamp(value?.energy, 60),
    heaviness: clamp(value?.heaviness, 45),
    aggression: clamp(value?.aggression, 40),
    drive: clamp(value?.drive, 58),
    intensity: clamp(value?.intensity, 58),
    melodic: clamp(value?.melodic, 60),
    darkness: clamp(value?.darkness, 42),
    brightness: clamp(value?.brightness, 56),
    atmospheric: clamp(value?.atmospheric, 45),
    reflective: clamp(value?.reflective, 45),
    relaxing: clamp(value?.relaxing, 35),
    uplifting: clamp(value?.uplifting, 48),
    motivational: clamp(value?.motivational, 55),
    chaotic: clamp(value?.chaotic, 30),
    focus: clamp(value?.focus, 58),
    upbeat: clamp(value?.upbeat, 52),
    workoutFit: clamp(value?.workoutFit, 58),
  };
}

function fromDb(row: DbTrackIntelligence): MusicTrackIntelligence {
  return {
    trackId: row.track_id,
    artistKey: row.artist_key || "",
    artistName: row.artist_name || "Unknown Artist",
    status: row.status || "partial",
    analysisVersion: Number(row.analysis_version || 0),
    confidence: Math.max(0, Math.min(1, Number(row.confidence || 0))),
    source: Array.isArray(row.source) ? row.source.filter(Boolean) : [],
    songDna: sanitizeSongDna(row.song_dna),
    artistDna: row.artist_dna && typeof row.artist_dna === "object" ? row.artist_dna : {},
    bpm: row.bpm == null ? null : Number(row.bpm),
    keySignature: row.key_signature || null,
    tempoLabel: row.tempo_label || null,
    mainGenres: Array.isArray(row.main_genres) ? row.main_genres.filter(Boolean) : [],
    subgenres: Array.isArray(row.subgenres) ? row.subgenres.filter(Boolean) : [],
    moods: Array.isArray(row.moods) ? row.moods.filter(Boolean) : [],
    characterTags: Array.isArray(row.character_tags) ? row.character_tags.filter(Boolean) : [],
    movementTags: Array.isArray(row.movement_tags) ? row.movement_tags.filter(Boolean) : [],
    musicFor: Array.isArray(row.music_for) ? row.music_for.filter(Boolean) : [],
    description: row.description || null,
    musicbrainzRecordingId: row.musicbrainz_recording_id || null,
    musicbrainzArtistId: row.musicbrainz_artist_id || null,
    cyaniteTrackId: row.cyanite_track_id || null,
    cyaniteStatus: row.cyanite_status || null,
    analyzedAt: row.analyzed_at || null,
    updatedAt: row.updated_at || new Date().toISOString(),
    error: row.error || null,
  };
}


function clampUnit(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

function tempoLabelFromBpm(bpm: number | null) {
  if (bpm == null || !Number.isFinite(bpm)) return null;
  if (bpm < 78) return "very slow";
  if (bpm < 96) return "slow";
  if (bpm < 118) return "moderate";
  if (bpm < 138) return "up-tempo";
  if (bpm < 162) return "fast";
  return "very fast";
}

function normalizeRange(value: number | null, low: number, high: number, fallback: number) {
  if (value == null || !Number.isFinite(value) || high <= low) return fallback;
  return clamp(((value - low) / (high - low)) * 100, fallback);
}

function mergeLocalAudioDna(base: MusicSongDNA, facts: LocalAudioIntelligence): MusicSongDNA {
  const bpm = facts.bpm;
  const pace = bpm == null ? base.drive : normalizeRange(bpm, 62, 176, base.drive);
  const dance = facts.danceability == null
    ? base.upbeat
    : clamp((facts.danceability / 3) * 100, base.upbeat);
  const intensityMeasured = facts.intensityScore == null
    ? clamp(base.intensity * .58 + base.energy * .24 + base.drive * .18, base.intensity)
    : clamp(facts.intensityScore, base.intensity);
  const loudness = normalizeRange(facts.rmsDb, -28, -7, base.energy);
  const brightnessMeasured = normalizeRange(facts.spectralCentroidHz, 650, 5200, base.brightness);
  const noiseMotion = normalizeRange(facts.zeroCrossingRate, 0.018, 0.19, base.chaotic);

  const audioEnergy = clamp(pace * .22 + dance * .17 + intensityMeasured * .28 + loudness * .33);
  const audioDrive = clamp(pace * .46 + dance * .31 + intensityMeasured * .23);
  const audioIntensity = clamp(intensityMeasured * .48 + audioEnergy * .30 + audioDrive * .22);
  const audioUpbeat = clamp(pace * .30 + dance * .38 + brightnessMeasured * .22 + (100 - base.darkness) * .10);
  const audioRelaxing = clamp(100 - (audioEnergy * .38 + audioDrive * .35 + audioIntensity * .17 + noiseMotion * .10));
  const audioWorkout = clamp(audioEnergy * .30 + audioDrive * .40 + audioIntensity * .20 + (100 - audioRelaxing) * .10);

  const mix = (current: number, measured: number, amount: number) => clamp(current * (1 - amount) + measured * amount);
  return {
    ...base,
    energy: mix(base.energy, audioEnergy, .34),
    drive: mix(base.drive, audioDrive, .40),
    intensity: mix(base.intensity, audioIntensity, .34),
    brightness: mix(base.brightness, brightnessMeasured, .22),
    chaotic: mix(base.chaotic, noiseMotion, .18),
    relaxing: mix(base.relaxing, audioRelaxing, .34),
    upbeat: mix(base.upbeat, audioUpbeat, .38),
    workoutFit: mix(base.workoutFit, audioWorkout, .34),
    aggression: mix(base.aggression, clamp(intensityMeasured * .68 + noiseMotion * .32), .16),
    focus: mix(base.focus, clamp(100 - noiseMotion * .48 - Math.abs(audioDrive - 56) * .35), .10),
  };
}

function formatKeySignature(facts: LocalAudioIntelligence) {
  if (!facts.key) return null;
  const scale = facts.scale?.trim().toLowerCase();
  return scale ? `${facts.key} ${scale}` : facts.key;
}

function describeLocalFailures(facts: LocalAudioIntelligence) {
  if (!facts.failedFeatures?.length) return null;
  return facts.failedFeatures
    .map((item) => `${item.feature}: ${item.error}`)
    .join(" | ")
    .slice(0, 900);
}

async function saveLocalAudioIntelligence(
  base: MusicTrackIntelligence,
  facts: LocalAudioIntelligence,
): Promise<MusicTrackIntelligence> {
  const localBpm = facts.bpm != null && Number.isFinite(facts.bpm) && facts.bpm >= 40 && facts.bpm <= 240
    ? Math.round(facts.bpm * 10) / 10
    : null;
  const bpm = localBpm ?? (base.bpm != null && Number.isFinite(base.bpm) ? base.bpm : null);
  const localKeySignature = formatKeySignature(facts);
  const keySignature = localKeySignature ?? base.keySignature ?? null;
  const localFeatures = Array.isArray(facts.successfulFeatures) ? facts.successfulFeatures.filter(Boolean) : [];
  const hasLocalMeasurements = localFeatures.length > 0;
  const coreComplete = bpm != null && Boolean(keySignature) && hasLocalMeasurements;

  if (!hasLocalMeasurements) {
    const failureDetail = describeLocalFailures(facts);
    throw new Error(failureDetail || "Local audio analysis returned no usable measurements.");
  }

  const confidenceSignals = [
    facts.bpmConfidence > 0 ? facts.bpmConfidence : null,
    facts.keyStrength > 0 ? facts.keyStrength : null,
  ].filter((value): value is number => value != null);
  const localConfidence = confidenceSignals.length
    ? confidenceSignals.reduce((sum, value) => sum + value, 0) / confidenceSignals.length
    : .55;
  const confidence = Math.max(base.confidence, Math.min(.99, base.confidence * .74 + clampUnit(localConfidence, .55) * .18 + .08));
  const source = [...new Set([...(base.source || []), "essentia"])];
  const songDna = mergeLocalAudioDna(base.songDna, { ...facts, bpm: localBpm ?? bpm });
  const updatedAt = new Date().toISOString();
  const failureDetail = describeLocalFailures(facts);

  const { data, error } = await supabase
    .from(TRACK_TABLE)
    .update({
      status: coreComplete ? "complete" : "partial",
      analysis_version: coreComplete ? MUSIC_INTELLIGENCE_VERSION : Math.min(base.analysisVersion, MUSIC_INTELLIGENCE_VERSION - 1),
      confidence,
      source,
      song_dna: songDna,
      bpm,
      key_signature: keySignature,
      tempo_label: tempoLabelFromBpm(bpm),
      analyzed_at: updatedAt,
      updated_at: updatedAt,
      error: coreComplete ? null : (failureDetail || "Local audio analysis is partial. BPM or key is still missing."),
    })
    .eq("track_id", base.trackId)
    .select("track_id,artist_key,artist_name,status,analysis_version,confidence,source,song_dna,artist_dna,bpm,key_signature,tempo_label,main_genres,subgenres,moods,character_tags,movement_tags,music_for,description,musicbrainz_recording_id,musicbrainz_artist_id,cyanite_track_id,cyanite_status,analyzed_at,updated_at,error")
    .single();

  if (error) throw error;
  return fromDb(data as DbTrackIntelligence);
}

function chunk<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

export function isMusicIntelligenceCurrent(value: MusicTrackIntelligence | null | undefined) {
  return Boolean(
    value &&
      value.analysisVersion >= MUSIC_INTELLIGENCE_VERSION &&
      (value.status === "complete" || value.status === "partial" || value.status === "processing")
  );
}

export async function getMusicTrackIntelligence(trackId: string) {
  const cached = getCachedMusicTrackIntelligence(trackId);
  if (cached && cached.analysisVersion >= MUSIC_INTELLIGENCE_VERSION && cached.status !== "processing" && cached.status !== "stale" && cached.status !== "failed") return cached;

  const { data, error } = await supabase
    .from(TRACK_TABLE)
    .select("track_id,artist_key,artist_name,status,analysis_version,confidence,source,song_dna,artist_dna,bpm,key_signature,tempo_label,main_genres,subgenres,moods,character_tags,movement_tags,music_for,description,musicbrainz_recording_id,musicbrainz_artist_id,cyanite_track_id,cyanite_status,analyzed_at,updated_at,error")
    .eq("track_id", trackId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  const parsed = fromDb(data as DbTrackIntelligence);
  cacheMusicTrackIntelligence(parsed);
  return parsed;
}

export async function listMusicTrackIntelligenceMap(trackIds: string[]) {
  const ids = [...new Set(trackIds.filter(Boolean))];
  const map = new Map<string, MusicTrackIntelligence>();
  for (const id of ids) {
    const cached = getCachedMusicTrackIntelligence(id);
    if (cached && cached.status !== "processing" && cached.status !== "stale" && cached.status !== "failed") map.set(id, cached);
  }

  const missing = ids.filter((id) => !map.has(id));
  for (const group of chunk(missing, 180)) {
    const { data, error } = await supabase
      .from(TRACK_TABLE)
      .select("track_id,artist_key,artist_name,status,analysis_version,confidence,source,song_dna,artist_dna,bpm,key_signature,tempo_label,main_genres,subgenres,moods,character_tags,movement_tags,music_for,description,musicbrainz_recording_id,musicbrainz_artist_id,cyanite_track_id,cyanite_status,analyzed_at,updated_at,error")
      .in("track_id", group);
    if (error) throw error;
    const parsed = ((data ?? []) as DbTrackIntelligence[]).map(fromDb);
    cacheMusicTrackIntelligenceMany(parsed);
    parsed.forEach((item) => map.set(item.trackId, item));
  }
  return map;
}

export async function hydrateMusicIntelligenceCache(tracks: MusicTrack[]) {
  if (!tracks.length) return new Map<string, MusicTrackIntelligence>();
  return listMusicTrackIntelligenceMap(tracks.map((track) => track.id));
}

function trackPayload(track: MusicTrack) {
  const extended = track as MusicTrack & {
    album?: string | null;
    release_year?: number | null;
    genre?: string | null;
    file_size_bytes?: number | null;
    duration_seconds?: number | null;
    mime_type?: string | null;
    energy_level?: string | null;
    original_name?: string | null;
  };
  return {
    id: track.id,
    title: track.title,
    artist: track.artist || "",
    artistKey: normalizeMusicArtistKey(track.artist),
    album: extended.album || "",
    releaseYear: extended.release_year || null,
    genre: extended.genre || "",
    durationSeconds: extended.duration_seconds || null,
    fileSizeBytes: extended.file_size_bytes || null,
    mimeType: extended.mime_type || null,
    energyLevel: extended.energy_level || "medium",
    originalName: extended.original_name || "",
  };
}

export async function analyzeMusicTrackIntelligence(
  track: MusicTrack,
  options: AnalyzeMusicIntelligenceOptions = {},
): Promise<MusicTrackIntelligence> {
  if (!options.force) {
    const current = await getMusicTrackIntelligence(track.id).catch(() => null);
    if (current && isMusicIntelligenceCurrent(current) && current.status !== "stale" && current.status !== "failed") {
      if (current.status !== "processing") return current;
      // Processing rows are allowed back through so Cyanite results can be collected.
    }
  }

  options.onStage?.("identity", "Checking exact recording and artist identity…");
  let audioUrl: string | null = null;
  try {
    audioUrl = await getMusicTrackSignedUrl(track);
  } catch {
    // Metadata/artist intelligence can still complete without direct audio access.
  }

  options.onStage?.("artist_dna", "Researching artist style and musical character…");
  const { data, error } = await supabase.functions.invoke("music-intelligence", {
    body: {
      action: "analyze",
      force: Boolean(options.force),
      analysisVersion: MUSIC_INTELLIGENCE_VERSION,
      track: trackPayload(track),
      audioUrl,
    },
  });

  if (error) throw error;
  const response = (data ?? {}) as { intelligence?: DbTrackIntelligence | MusicTrackIntelligence; error?: string };
  if (response.error) throw new Error(response.error);
  if (!response.intelligence) throw new Error("Music Intelligence did not return an analysis result.");

  options.onStage?.("song_dna", "Building Song DNA from mood, style, energy and movement…");
  const raw = response.intelligence;
  let parsed = "track_id" in raw ? fromDb(raw as DbTrackIntelligence) : (raw as MusicTrackIntelligence);
  cacheMusicTrackIntelligence(parsed);

  if (audioUrl) {
    options.onStage?.("audio_intelligence", "Analyzing the actual audio locally for BPM, key, rhythm and sonic character…");
    try {
      const facts = await analyzeMusicAudioLocally(audioUrl);
      if (facts.failedFeatures?.length) {
        console.warn("MVP local audio feature fallbacks", track.id, facts.failedFeatures);
      }
      options.onStage?.("saving", "Saving local audio intelligence to your library…");
      parsed = await saveLocalAudioIntelligence(parsed, facts);
      cacheMusicTrackIntelligence(parsed);
      options.onStage?.(
        "audio_intelligence",
        parsed.analysisVersion >= MUSIC_INTELLIGENCE_VERSION
          ? `Audio intelligence complete ✓ ${parsed.bpm ?? "—"} BPM · ${parsed.keySignature ?? "—"}`
          : `Audio intelligence partial • ${parsed.bpm ?? "—"} BPM · ${parsed.keySignature ?? "key pending"} • retry available`,
      );
    } catch (error) {
      console.warn("MVP local audio intelligence failed", track.id, error);
      options.onStage?.("audio_intelligence", "Song + Artist DNA ready • local audio analysis can be retried.");
    }
  } else {
    options.onStage?.("audio_intelligence", "Song + Artist DNA ready • audio file was unavailable for local analysis.");
  }

  if (parsed.analysisVersion < MUSIC_INTELLIGENCE_VERSION) {
    options.onStage?.("saving", "Metadata intelligence saved · audio intelligence still pending…");
  }
  options.onStage?.("complete", parsed.analysisVersion >= MUSIC_INTELLIGENCE_VERSION
    ? "Music Intelligence complete"
    : "Music Intelligence ready · local audio analysis pending");
  return parsed;
}

export async function markMusicTrackIntelligenceStale(trackId: string) {
  const { error } = await supabase
    .from(TRACK_TABLE)
    .update({ status: "stale", updated_at: new Date().toISOString() })
    .eq("track_id", trackId);
  if (error) throw error;
  clearMusicIntelligenceCache(trackId);
}

export function describeMusicIntelligenceSources(item: MusicTrackIntelligence | null | undefined) {
  if (!item?.source.length) return "MVP analysis";
  return item.source
    .map((value) => value === "lastfm" ? "Last.fm" : value === "musicbrainz" ? "MusicBrainz" : value === "cyanite" ? "Cyanite" : value === "essentia" ? "Essentia" : value === "deezer" ? "Deezer" : value === "mvp" ? "MVP" : value)
    .join(" + ");
}
