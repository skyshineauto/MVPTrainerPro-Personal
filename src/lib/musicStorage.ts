import { supabase } from "./supabase";

export const MUSIC_BUCKET = "trainer-music";
export const MUSIC_TABLE = "trainer_music_tracks";
export const MAX_MUSIC_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_MUSIC_ARTWORK_BYTES = 8 * 1024 * 1024;

const MUSIC_WORKER_URL =
  "https://mvp-trainer-music-stream.autodetail.workers.dev";

export type MusicEnergyLevel = "low" | "medium" | "high";

export type MusicMetadataStatus = "unknown" | "matched" | "review" | "manual";

export type MusicTrack = {
  id: string;
  user_id: string;
  storage_path: string;
  title: string;
  artist: string | null;
  album: string | null;
  release_year: number | null;
  genre: string | null;
  artwork_path: string | null;
  external_artwork_url: string | null;
  original_name: string;
  mime_type: string | null;
  file_size_bytes: number | null;
  duration_seconds: number | null;
  sort_order: number;
  favorite: boolean;
  play_less: boolean;
  energy_level: MusicEnergyLevel;
  play_count: number;
  skip_count: number;
  completed_play_count: number;
  last_played_at: string | null;
  last_skipped_at: string | null;
  last_completed_at: string | null;
  metadata_status: MusicMetadataStatus;
  metadata_confidence: number | null;
  metadata_source: string | null;
  metadata_updated_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MusicTrackUpdate = Partial<
  Pick<
    MusicTrack,
    | "title"
    | "artist"
    | "album"
    | "release_year"
    | "genre"
    | "external_artwork_url"
    | "sort_order"
    | "favorite"
    | "play_less"
    | "energy_level"
    | "metadata_status"
    | "metadata_confidence"
    | "metadata_source"
    | "metadata_updated_at"
  >
>;

type SignedUrlCacheEntry = {
  url: string;
  expiresAt: number;
};

type WorkerSignedUrlResponse = {
  url?: string;
  expiresAt?: number;
  key?: string;
  size?: number;
  contentType?: string;
  error?: string;
};

type EmbeddedArtwork = {
  blob: Blob;
  mimeType: string;
  extension: "jpg" | "png" | "webp";
};

const TRACK_SELECT =
  "id,user_id,storage_path,title,artist,album,release_year,genre,artwork_path,external_artwork_url,original_name,mime_type,file_size_bytes,duration_seconds,sort_order,favorite,play_less,energy_level,play_count,skip_count,completed_play_count,last_played_at,last_skipped_at,last_completed_at,metadata_status,metadata_confidence,metadata_source,metadata_updated_at,created_at,updated_at";

const signedUrlCache = new Map<string, SignedUrlCacheEntry>();
const artworkSignedUrlCache = new Map<string, SignedUrlCacheEntry>();
const ALLOWED_EXTENSIONS = new Set(["mp3", "m4a", "wav"]);
const ALLOWED_MIME_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/x-m4a",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
]);
const ALLOWED_ARTWORK_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function extensionFromName(name: string) {
  const extension = name.split(".").pop()?.trim().toLowerCase() ?? "";
  return ALLOWED_EXTENSIONS.has(extension) ? extension : "";
}

function safeFileName(name: string) {
  const cleaned = name
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return cleaned || "track";
}

function titleFromFileName(name: string) {
  return (
    name
      .replace(/\.[^.]+$/, "")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "Untitled Track"
  );
}

function contentTypeFor(extension: string, providedType: string) {
  if (providedType) return providedType;
  if (extension === "mp3") return "audio/mpeg";
  if (extension === "m4a") return "audio/mp4";
  return "audio/wav";
}

async function requireUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("Sign in before managing music.");
  return data.user.id;
}

async function requireAccessToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;

  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error("Sign in before playing music.");

  return accessToken;
}

function normalizeTrack(row: MusicTrack): MusicTrack {
  const metadataStatus: MusicMetadataStatus =
    row.metadata_status === "matched" ||
    row.metadata_status === "review" ||
    row.metadata_status === "manual"
      ? row.metadata_status
      : "unknown";

  return {
    ...row,
    album: row.album || null,
    release_year: row.release_year ? Number(row.release_year) : null,
    genre: row.genre || null,
    artwork_path: row.artwork_path || null,
    external_artwork_url: row.external_artwork_url || null,
    favorite: Boolean(row.favorite),
    play_less: Boolean(row.play_less),
    energy_level:
      row.energy_level === "low" || row.energy_level === "high"
        ? row.energy_level
        : "medium",
    play_count: Math.max(0, Number(row.play_count || 0)),
    skip_count: Math.max(0, Number(row.skip_count || 0)),
    completed_play_count: Math.max(0, Number(row.completed_play_count || 0)),
    metadata_status: metadataStatus,
    metadata_confidence:
      row.metadata_confidence == null ? null : Number(row.metadata_confidence),
    metadata_source: row.metadata_source || null,
    metadata_updated_at: row.metadata_updated_at || null,
  };
}

export function clearMusicUrlCache(trackId?: string) {
  if (trackId) {
    signedUrlCache.delete(trackId);
    artworkSignedUrlCache.delete(trackId);
    return;
  }
  signedUrlCache.clear();
  artworkSignedUrlCache.clear();
}

export function validateMusicFile(file: File) {
  if (file.size <= 0) throw new Error(`${file.name} is empty.`);
  if (file.size > MAX_MUSIC_FILE_BYTES) {
    throw new Error(`${file.name} is larger than 50 MB.`);
  }

  const extension = extensionFromName(file.name);
  const mime = file.type.trim().toLowerCase();
  const mimeAllowed =
    !mime || ALLOWED_MIME_TYPES.has(mime) || mime.startsWith("audio/");

  if (!extension || !mimeAllowed) {
    throw new Error(`${file.name}: use an MP3, M4A, or WAV file.`);
  }

  return extension;
}

export function validateMusicArtwork(file: File) {
  if (file.size <= 0) throw new Error("Artwork file is empty.");
  if (file.size > MAX_MUSIC_ARTWORK_BYTES) {
    throw new Error("Artwork must be 8 MB or smaller.");
  }

  const mime = file.type.trim().toLowerCase();
  if (!ALLOWED_ARTWORK_MIME_TYPES.has(mime)) {
    throw new Error("Artwork must be a JPG, PNG, or WebP image.");
  }

  return mime;
}

export async function readMusicDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    let finished = false;

    const finish = (value: number | null) => {
      if (finished) return;
      finished = true;
      URL.revokeObjectURL(objectUrl);
      audio.removeAttribute("src");
      audio.load();
      resolve(value);
    };

    const timeout = window.setTimeout(() => finish(null), 6000);
    audio.preload = "metadata";

    audio.addEventListener(
      "loadedmetadata",
      () => {
        window.clearTimeout(timeout);
        const duration = Number(audio.duration);
        finish(
          Number.isFinite(duration) && duration > 0
            ? Math.round(duration)
            : null
        );
      },
      { once: true }
    );

    audio.addEventListener(
      "error",
      () => {
        window.clearTimeout(timeout);
        finish(null);
      },
      { once: true }
    );

    audio.src = objectUrl;
  });
}

function syncSafeInt(bytes: Uint8Array, offset: number) {
  return (
    ((bytes[offset] & 0x7f) << 21) |
    ((bytes[offset + 1] & 0x7f) << 14) |
    ((bytes[offset + 2] & 0x7f) << 7) |
    (bytes[offset + 3] & 0x7f)
  );
}

function uint32(bytes: Uint8Array, offset: number) {
  return (
    bytes[offset] * 0x1000000 +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  );
}

function imageTypeFromBytes(bytes: Uint8Array, offset: number) {
  if (
    bytes[offset] === 0xff &&
    bytes[offset + 1] === 0xd8 &&
    bytes[offset + 2] === 0xff
  ) {
    return { mimeType: "image/jpeg", extension: "jpg" as const };
  }
  if (
    bytes[offset] === 0x89 &&
    bytes[offset + 1] === 0x50 &&
    bytes[offset + 2] === 0x4e &&
    bytes[offset + 3] === 0x47
  ) {
    return { mimeType: "image/png", extension: "png" as const };
  }
  if (
    bytes[offset] === 0x52 &&
    bytes[offset + 1] === 0x49 &&
    bytes[offset + 2] === 0x46 &&
    bytes[offset + 3] === 0x46 &&
    bytes[offset + 8] === 0x57 &&
    bytes[offset + 9] === 0x45 &&
    bytes[offset + 10] === 0x42 &&
    bytes[offset + 11] === 0x50
  ) {
    return { mimeType: "image/webp", extension: "webp" as const };
  }
  return null;
}

function locateDescriptionEnd(bytes: Uint8Array, start: number, encoding: number) {
  if (encoding === 1 || encoding === 2) {
    for (let index = start; index + 1 < bytes.length; index += 2) {
      if (bytes[index] === 0 && bytes[index + 1] === 0) return index + 2;
    }
    return bytes.length;
  }

  for (let index = start; index < bytes.length; index += 1) {
    if (bytes[index] === 0) return index + 1;
  }
  return bytes.length;
}

function extractId3Artwork(bytes: Uint8Array): EmbeddedArtwork | null {
  if (
    bytes.length < 10 ||
    bytes[0] !== 0x49 ||
    bytes[1] !== 0x44 ||
    bytes[2] !== 0x33
  ) {
    return null;
  }

  const version = bytes[3];
  const tagSize = Math.min(bytes.length, 10 + syncSafeInt(bytes, 6));
  let cursor = 10;

  while (cursor + 10 <= tagSize) {
    const frameId = String.fromCharCode(
      bytes[cursor],
      bytes[cursor + 1],
      bytes[cursor + 2],
      bytes[cursor + 3]
    );

    if (!/^[A-Z0-9]{4}$/.test(frameId)) break;

    const frameSize =
      version === 4 ? syncSafeInt(bytes, cursor + 4) : uint32(bytes, cursor + 4);
    if (!frameSize || cursor + 10 + frameSize > tagSize) break;

    if (frameId === "APIC") {
      const payload = bytes.subarray(cursor + 10, cursor + 10 + frameSize);
      if (payload.length < 8) return null;

      const encoding = payload[0];
      let position = 1;
      while (position < payload.length && payload[position] !== 0) position += 1;
      position += 1;
      position += 1;
      position = locateDescriptionEnd(payload, position, encoding);

      const detected = imageTypeFromBytes(payload, position);
      if (!detected) return null;

      return {
        blob: new Blob([payload.slice(position)], { type: detected.mimeType }),
        mimeType: detected.mimeType,
        extension: detected.extension,
      };
    }

    cursor += 10 + frameSize;
  }

  return null;
}

function extractM4aArtwork(bytes: Uint8Array): EmbeddedArtwork | null {
  const ascii = (offset: number) =>
    String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3]
    );

  for (let cursor = 4; cursor + 20 < bytes.length; cursor += 1) {
    if (ascii(cursor) !== "covr") continue;

    const searchEnd = Math.min(bytes.length - 16, cursor + 2 * 1024 * 1024);
    for (let dataCursor = cursor + 4; dataCursor < searchEnd; dataCursor += 1) {
      if (ascii(dataCursor) !== "data") continue;

      const atomStart = dataCursor - 4;
      const atomSize = uint32(bytes, atomStart);
      if (atomSize < 20 || atomStart + atomSize > bytes.length) continue;

      const payloadStart = dataCursor + 12;
      for (
        let imageStart = payloadStart;
        imageStart < Math.min(payloadStart + 32, atomStart + atomSize - 12);
        imageStart += 1
      ) {
        const detected = imageTypeFromBytes(bytes, imageStart);
        if (!detected) continue;

        return {
          blob: new Blob([bytes.slice(imageStart, atomStart + atomSize)], {
            type: detected.mimeType,
          }),
          mimeType: detected.mimeType,
          extension: detected.extension,
        };
      }
    }
  }

  return null;
}

export type EmbeddedMusicTags = {
  title?: string;
  artist?: string;
  album?: string;
  releaseYear?: number;
  genre?: string;
};

function decodeId3Text(bytes: Uint8Array, start: number, length: number) {
  if (length <= 1) return "";
  const encoding = bytes[start];
  const payload = bytes.slice(start + 1, start + length);
  try {
    if (encoding === 1 || encoding === 2) {
      const littleEndian = payload[0] === 0xff && payload[1] === 0xfe;
      const clean =
        littleEndian || (payload[0] === 0xfe && payload[1] === 0xff)
          ? payload.slice(2)
          : payload;
      const view = new DataView(clean.buffer, clean.byteOffset, clean.byteLength);
      let value = "";
      for (let offset = 0; offset + 1 < clean.byteLength; offset += 2) {
        const code = view.getUint16(offset, littleEndian);
        if (!code) continue;
        value += String.fromCharCode(code);
      }
      return value.replace(/\0/g, "").trim();
    }
    return new TextDecoder(encoding === 3 ? "utf-8" : "iso-8859-1")
      .decode(payload)
      .replace(/\0/g, "")
      .trim();
  } catch {
    return "";
  }
}

function extractId3TextTags(bytes: Uint8Array): EmbeddedMusicTags {
  if (
    bytes.length < 10 ||
    String.fromCharCode(...bytes.slice(0, 3)) !== "ID3"
  ) {
    return {};
  }

  const version = bytes[3];
  const tagSize = syncSafeInt(bytes, 6);
  const end = Math.min(bytes.length, 10 + tagSize);
  const tags: EmbeddedMusicTags = {};
  let offset = 10;

  while (offset + 10 <= end) {
    const frameId = String.fromCharCode(...bytes.slice(offset, offset + 4));
    if (!frameId.trim() || /^\0+$/.test(frameId)) break;
    const frameSize =
      version === 4 ? syncSafeInt(bytes, offset + 4) : uint32(bytes, offset + 4);
    if (!frameSize || offset + 10 + frameSize > end) break;

    const value = decodeId3Text(bytes, offset + 10, frameSize);
    if (value) {
      if (frameId === "TIT2") tags.title = value;
      if (frameId === "TPE1") tags.artist = value;
      if (frameId === "TALB") tags.album = value;
      if (frameId === "TCON") tags.genre = value.replace(/^\(\d+\)\s*/, "");
      if (frameId === "TDRC" || frameId === "TYER") {
        const year = Number(value.match(/\b(19|20)\d{2}\b/)?.[0]);
        if (Number.isFinite(year)) tags.releaseYear = year;
      }
    }
    offset += 10 + frameSize;
  }
  return tags;
}

function extractM4aTextTag(bytes: Uint8Array, atomName: string) {
  const nameBytes = new TextEncoder().encode(atomName);
  for (let index = 4; index + nameBytes.length + 16 < bytes.length; index += 1) {
    let match = true;
    for (let part = 0; part < nameBytes.length; part += 1) {
      if (bytes[index + part] !== nameBytes[part]) {
        match = false;
        break;
      }
    }
    if (!match) continue;

    const atomStart = index - 4;
    const atomSize = uint32(bytes, atomStart);
    if (atomSize < 20 || atomStart + atomSize > bytes.length) continue;
    const atomEnd = atomStart + atomSize;

    for (
      let cursor = index + nameBytes.length;
      cursor + 16 <= atomEnd;
      cursor += 1
    ) {
      if (String.fromCharCode(...bytes.slice(cursor + 4, cursor + 8)) !== "data") {
        continue;
      }

      const dataSize = uint32(bytes, cursor);
      const payloadStart = cursor + 16;
      const payloadEnd = Math.min(atomEnd, cursor + dataSize);
      if (payloadEnd <= payloadStart) continue;

      try {
        return new TextDecoder("utf-8")
          .decode(bytes.slice(payloadStart, payloadEnd))
          .replace(/\0/g, "")
          .trim();
      } catch {
        return "";
      }
    }
  }
  return "";
}

function extractM4aTextTags(bytes: Uint8Array): EmbeddedMusicTags {
  const title = extractM4aTextTag(bytes, "©nam");
  const artist =
    extractM4aTextTag(bytes, "©ART") || extractM4aTextTag(bytes, "aART");
  const album = extractM4aTextTag(bytes, "©alb");
  const yearText = extractM4aTextTag(bytes, "©day");
  const genre = extractM4aTextTag(bytes, "©gen");
  const releaseYear = Number(yearText.match(/\b(19|20)\d{2}\b/)?.[0]);

  return {
    ...(title ? { title } : {}),
    ...(artist ? { artist } : {}),
    ...(album ? { album } : {}),
    ...(genre ? { genre } : {}),
    ...(Number.isFinite(releaseYear) ? { releaseYear } : {}),
  };
}

export async function readEmbeddedMusicTags(
  file: File
): Promise<EmbeddedMusicTags> {
  try {
    const maxScan = Math.min(file.size, 8 * 1024 * 1024);
    const bytes = new Uint8Array(await file.slice(0, maxScan).arrayBuffer());
    const id3 = extractId3TextTags(bytes);
    const m4a = extractM4aTextTags(bytes);
    return { ...m4a, ...id3 };
  } catch {
    return {};
  }
}

export async function readEmbeddedMusicArtwork(
  file: File
): Promise<EmbeddedArtwork | null> {
  try {
    const maxScan = Math.min(file.size, 12 * 1024 * 1024);
    const bytes = new Uint8Array(await file.slice(0, maxScan).arrayBuffer());
    return extractId3Artwork(bytes) ?? extractM4aArtwork(bytes);
  } catch {
    return null;
  }
}

async function uploadArtworkBlob(
  track: MusicTrack,
  blob: Blob,
  extension: "jpg" | "png" | "webp",
  mimeType: string
) {
  const userId = await requireUserId();
  const artworkPath = `${userId}/artwork/${track.id}-${crypto.randomUUID()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(MUSIC_BUCKET)
    .upload(artworkPath, blob, {
      upsert: false,
      contentType: mimeType,
      cacheControl: "86400",
    });

  if (uploadError) throw uploadError;

  const { data, error } = await supabase
    .from(MUSIC_TABLE)
    .update({
      artwork_path: artworkPath,
      external_artwork_url: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", track.id)
    .eq("user_id", userId)
    .select(TRACK_SELECT)
    .single();

  if (error) {
    await supabase.storage.from(MUSIC_BUCKET).remove([artworkPath]);
    throw error;
  }

  if (track.artwork_path && track.artwork_path !== artworkPath) {
    await supabase.storage
      .from(MUSIC_BUCKET)
      .remove([track.artwork_path])
      .catch(() => undefined);
  }

  artworkSignedUrlCache.delete(track.id);
  return normalizeTrack(data as MusicTrack);
}

export async function uploadMusicArtwork(track: MusicTrack, file: File) {
  const mimeType = validateMusicArtwork(file);
  const extension =
    mimeType === "image/png"
      ? "png"
      : mimeType === "image/webp"
        ? "webp"
        : "jpg";
  return uploadArtworkBlob(track, file, extension, mimeType);
}

export async function removeMusicArtwork(track: MusicTrack) {
  if (!track.artwork_path && !track.external_artwork_url) return track;
  const userId = await requireUserId();

  const { data, error } = await supabase
    .from(MUSIC_TABLE)
    .update({
      artwork_path: null,
      external_artwork_url: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", track.id)
    .eq("user_id", userId)
    .select(TRACK_SELECT)
    .single();

  if (error) throw error;

  if (track.artwork_path) {
    await supabase.storage
      .from(MUSIC_BUCKET)
      .remove([track.artwork_path])
      .catch(() => undefined);
  }

  artworkSignedUrlCache.delete(track.id);
  return normalizeTrack(data as MusicTrack);
}

export async function listMusicTracks(): Promise<MusicTrack[]> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from(MUSIC_TABLE)
    .select(TRACK_SELECT)
    .eq("user_id", userId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw error;
  return ((data ?? []) as MusicTrack[]).map(normalizeTrack);
}

export async function uploadMusicTrack(
  file: File,
  sortOrder: number
): Promise<MusicTrack> {
  const extension = validateMusicFile(file);
  const userId = await requireUserId();
  const [durationSeconds, embeddedArtwork, embeddedTags] = await Promise.all([
    readMusicDuration(file),
    readEmbeddedMusicArtwork(file),
    readEmbeddedMusicTags(file),
  ]);

  const fileStem = safeFileName(file.name.replace(/\.[^.]+$/, ""));
  const storagePath =
    `${userId}/${Date.now()}-${crypto.randomUUID()}-${fileStem}.${extension}`;
  const mimeType = contentTypeFor(extension, file.type);

  const { error: uploadError } = await supabase.storage
    .from(MUSIC_BUCKET)
    .upload(storagePath, file, {
      upsert: false,
      contentType: mimeType,
      cacheControl: "86400",
    });

  if (uploadError) throw uploadError;

  const row = {
    user_id: userId,
    storage_path: storagePath,
    title: embeddedTags.title?.trim() || titleFromFileName(file.name),
    artist: embeddedTags.artist?.trim() || null,
    album: embeddedTags.album?.trim() || null,
    release_year: embeddedTags.releaseYear || null,
    genre: embeddedTags.genre?.trim() || null,
    artwork_path: null,
    external_artwork_url: null,
    original_name: file.name,
    mime_type: mimeType,
    file_size_bytes: file.size,
    duration_seconds: durationSeconds,
    sort_order: Math.max(0, Math.floor(sortOrder)),
    favorite: false,
    play_less: false,
    energy_level: "medium" as MusicEnergyLevel,
    play_count: 0,
    skip_count: 0,
    completed_play_count: 0,
    last_played_at: null,
    last_skipped_at: null,
    last_completed_at: null,
    metadata_status:
      embeddedTags.title || embeddedTags.artist || embeddedTags.album
        ? "manual"
        : "unknown",
    metadata_confidence: embeddedTags.title || embeddedTags.artist ? 1 : null,
    metadata_source: embeddedTags.title || embeddedTags.artist ? "embedded" : null,
    metadata_updated_at:
      embeddedTags.title || embeddedTags.artist || embeddedTags.album
        ? new Date().toISOString()
        : null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from(MUSIC_TABLE)
    .insert(row)
    .select(TRACK_SELECT)
    .single();

  if (error) {
    await supabase.storage.from(MUSIC_BUCKET).remove([storagePath]);
    throw error;
  }

  let track = normalizeTrack(data as MusicTrack);

  if (embeddedArtwork) {
    try {
      track = await uploadArtworkBlob(
        track,
        embeddedArtwork.blob,
        embeddedArtwork.extension,
        embeddedArtwork.mimeType
      );
    } catch (artworkError) {
      console.warn("Embedded album artwork could not be saved:", artworkError);
    }
  }

  return track;
}

export async function updateMusicTrack(
  trackId: string,
  patch: MusicTrackUpdate
): Promise<MusicTrack> {
  const userId = await requireUserId();
  const title = patch.title?.trim();
  const artist = patch.artist?.trim();
  const album = patch.album?.trim();
  const genre = patch.genre?.trim();
  const externalArtworkUrl = patch.external_artwork_url?.trim();

  const update: Record<string, string | number | boolean | null> = {
    updated_at: new Date().toISOString(),
  };

  if (patch.title !== undefined) {
    if (!title) throw new Error("Song title cannot be empty.");
    update.title = title;
  }
  if (patch.artist !== undefined) update.artist = artist || null;
  if (patch.album !== undefined) update.album = album || null;
  if (patch.release_year !== undefined) {
    update.release_year = patch.release_year
      ? Math.max(1900, Math.min(2100, Math.round(patch.release_year)))
      : null;
  }
  if (patch.genre !== undefined) update.genre = genre || null;
  if (patch.external_artwork_url !== undefined) {
    update.external_artwork_url = externalArtworkUrl || null;
  }
  if (patch.sort_order !== undefined) {
    update.sort_order = Math.max(0, Math.floor(patch.sort_order));
  }
  if (patch.favorite !== undefined) update.favorite = Boolean(patch.favorite);
  if (patch.play_less !== undefined) update.play_less = Boolean(patch.play_less);
  if (patch.energy_level !== undefined) update.energy_level = patch.energy_level;
  if (patch.metadata_status !== undefined) {
    update.metadata_status = patch.metadata_status;
  }
  if (patch.metadata_confidence !== undefined) {
    update.metadata_confidence =
      patch.metadata_confidence == null
        ? null
        : Math.max(0, Math.min(1, Number(patch.metadata_confidence)));
  }
  if (patch.metadata_source !== undefined) {
    update.metadata_source = patch.metadata_source || null;
  }
  if (patch.metadata_updated_at !== undefined) {
    update.metadata_updated_at = patch.metadata_updated_at;
  }

  const { data, error } = await supabase
    .from(MUSIC_TABLE)
    .update(update)
    .eq("id", trackId)
    .eq("user_id", userId)
    .select(TRACK_SELECT)
    .single();

  if (error) throw error;
  return normalizeTrack(data as MusicTrack);
}

export async function saveMusicTrackOrder(tracks: MusicTrack[]) {
  await Promise.all(
    tracks.map((track, index) =>
      updateMusicTrack(track.id, { sort_order: index })
    )
  );
}

async function incrementTrackCounter(
  trackId: string,
  field: "play_count" | "skip_count" | "completed_play_count",
  timestampField?: "last_played_at" | "last_skipped_at" | "last_completed_at"
) {
  const userId = await requireUserId();
  const { data, error: readError } = await supabase
    .from(MUSIC_TABLE)
    .select(`${field}`)
    .eq("id", trackId)
    .eq("user_id", userId)
    .maybeSingle();

  if (readError) throw readError;
  if (!data) return;

  const current = Number((data as Record<string, number | null>)[field] ?? 0);
  const update: Record<string, string | number> = {
    [field]: Math.max(0, current) + 1,
    updated_at: new Date().toISOString(),
  };
  if (timestampField) update[timestampField] = new Date().toISOString();

  const { error } = await supabase
    .from(MUSIC_TABLE)
    .update(update)
    .eq("id", trackId)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function recordMusicTrackPlayed(trackId: string) {
  await incrementTrackCounter(trackId, "play_count", "last_played_at");
}

export async function recordMusicTrackSkipped(trackId: string) {
  await incrementTrackCounter(trackId, "skip_count", "last_skipped_at");
}

export async function recordMusicTrackCompleted(trackId: string) {
  await incrementTrackCounter(
    trackId,
    "completed_play_count",
    "last_completed_at"
  );
}

export async function setMusicTrackPreference(
  trackId: string,
  preference: "like" | "play_less" | "neutral"
) {
  return updateMusicTrack(trackId, {
    favorite: preference === "like",
    play_less: preference === "play_less",
  });
}

function artworkExtensionFromMime(mime: string) {
  if (mime.includes("png")) return "png" as const;
  if (mime.includes("webp")) return "webp" as const;
  return "jpg" as const;
}

export async function uploadRemoteMusicArtwork(
  track: MusicTrack,
  url: string
): Promise<MusicTrack> {
  const cleanUrl = url.trim();
  if (!cleanUrl) return track;

  try {
    const response = await fetch(cleanUrl, {
      mode: "cors",
      cache: "force-cache",
    });

    if (!response.ok) {
      throw new Error(`Artwork request failed (${response.status}).`);
    }

    const blob = await response.blob();
    const mime = blob.type || "image/jpeg";

    if (!mime.startsWith("image/")) {
      throw new Error("Artwork response was not an image.");
    }

    if (blob.size > MAX_MUSIC_ARTWORK_BYTES) {
      throw new Error("Artwork image is too large.");
    }

    return await uploadArtworkBlob(
      track,
      blob,
      artworkExtensionFromMime(mime),
      mime
    );
  } catch {
    return updateMusicTrack(track.id, {
      external_artwork_url: cleanUrl,
    });
  }
}

export async function removeMusicTrack(trackId: string) {
  const userId = await requireUserId();
  const { data: track, error: readError } = await supabase
    .from(MUSIC_TABLE)
    .select("storage_path,artwork_path")
    .eq("id", trackId)
    .eq("user_id", userId)
    .maybeSingle();

  if (readError) throw readError;

  const { error: deleteError } = await supabase
    .from(MUSIC_TABLE)
    .delete()
    .eq("id", trackId)
    .eq("user_id", userId);

  if (deleteError) throw deleteError;

  const paths = [track?.storage_path, track?.artwork_path].filter(
    (value): value is string => Boolean(value)
  );

  if (paths.length) {
    const { error: storageError } = await supabase.storage
      .from(MUSIC_BUCKET)
      .remove(paths);

    if (storageError) {
      console.warn("Music storage cleanup failed:", storageError.message);
    }
  }

  clearMusicUrlCache(trackId);
}

export async function getMusicTrackSignedUrl(
  track: MusicTrack
): Promise<string> {
  const cached = signedUrlCache.get(track.id);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  const accessToken = await requireAccessToken();

  const response = await fetch(`${MUSIC_WORKER_URL}/sign`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      key: track.storage_path,
    }),
  });

  let payload: WorkerSignedUrlResponse = {};

  try {
    payload = (await response.json()) as WorkerSignedUrlResponse;
  } catch {
    // Status-based error below.
  }

  if (!response.ok) {
    throw new Error(
      payload.error ||
        `Music stream authorization failed (${response.status}).`
    );
  }

  if (!payload.url) {
    throw new Error("Music stream did not return a playback URL.");
  }

  const workerExpiresAt = Number(payload.expiresAt);
  const cacheExpiresAt =
    Number.isFinite(workerExpiresAt) && workerExpiresAt > Date.now()
      ? Math.max(Date.now() + 30_000, workerExpiresAt - 5 * 60 * 1000)
      : Date.now() + 50 * 60 * 1000;

  signedUrlCache.set(track.id, {
    url: payload.url,
    expiresAt: cacheExpiresAt,
  });

  return payload.url;
}

export async function getMusicArtworkSignedUrl(
  track: MusicTrack
): Promise<string | null> {
  if (!track.artwork_path) return track.external_artwork_url || null;

  const cached = artworkSignedUrlCache.get(track.id);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  const { data, error } = await supabase.storage
    .from(MUSIC_BUCKET)
    .createSignedUrl(track.artwork_path, 24 * 60 * 60);

  if (error) throw error;

  artworkSignedUrlCache.set(track.id, {
    url: data.signedUrl,
    expiresAt: Date.now() + 20 * 60 * 60 * 1000,
  });

  return data.signedUrl;
}
