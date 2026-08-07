import { supabase } from "./supabase";

export const MUSIC_BUCKET = "trainer-music";
export const MUSIC_TABLE = "trainer_music_tracks";
export const MAX_MUSIC_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_MUSIC_ARTWORK_BYTES = 8 * 1024 * 1024;

export type MusicEnergyLevel = "low" | "medium" | "high";

export type MusicTrack = {
  id: string;
  user_id: string;
  storage_path: string;
  title: string;
  artist: string | null;
  album: string | null;
  artwork_path: string | null;
  original_name: string;
  mime_type: string | null;
  file_size_bytes: number | null;
  duration_seconds: number | null;
  sort_order: number;
  favorite: boolean;
  energy_level: MusicEnergyLevel;
  play_count: number;
  skip_count: number;
  last_played_at: string | null;
  created_at: string;
  updated_at: string;
};

type MusicTrackUpdate = Partial<
  Pick<
    MusicTrack,
    "title" | "artist" | "album" | "sort_order" | "favorite" | "energy_level"
  >
>;

type SignedUrlCacheEntry = {
  url: string;
  expiresAt: number;
};

type EmbeddedArtwork = {
  blob: Blob;
  mimeType: string;
  extension: "jpg" | "png" | "webp";
};

const TRACK_SELECT =
  "id,user_id,storage_path,title,artist,album,artwork_path,original_name,mime_type,file_size_bytes,duration_seconds,sort_order,favorite,energy_level,play_count,skip_count,last_played_at,created_at,updated_at";

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

function normalizeTrack(row: MusicTrack): MusicTrack {
  return {
    ...row,
    album: row.album || null,
    artwork_path: row.artwork_path || null,
    favorite: Boolean(row.favorite),
    energy_level:
      row.energy_level === "low" || row.energy_level === "high"
        ? row.energy_level
        : "medium",
    play_count: Math.max(0, Number(row.play_count || 0)),
    skip_count: Math.max(0, Number(row.skip_count || 0)),
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
      position += 1; // picture type
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
    mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  return uploadArtworkBlob(track, file, extension, mimeType);
}

export async function removeMusicArtwork(track: MusicTrack) {
  if (!track.artwork_path) return track;
  const userId = await requireUserId();

  const { data, error } = await supabase
    .from(MUSIC_TABLE)
    .update({
      artwork_path: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", track.id)
    .eq("user_id", userId)
    .select(TRACK_SELECT)
    .single();

  if (error) throw error;

  await supabase.storage
    .from(MUSIC_BUCKET)
    .remove([track.artwork_path])
    .catch(() => undefined);

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
  const [durationSeconds, embeddedArtwork] = await Promise.all([
    readMusicDuration(file),
    readEmbeddedMusicArtwork(file),
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
    title: titleFromFileName(file.name),
    artist: null,
    album: null,
    artwork_path: null,
    original_name: file.name,
    mime_type: mimeType,
    file_size_bytes: file.size,
    duration_seconds: durationSeconds,
    sort_order: Math.max(0, Math.floor(sortOrder)),
    favorite: false,
    energy_level: "medium" as MusicEnergyLevel,
    play_count: 0,
    skip_count: 0,
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

  const update: Record<string, string | number | boolean | null> = {
    updated_at: new Date().toISOString(),
  };

  if (patch.title !== undefined) {
    if (!title) throw new Error("Song title cannot be empty.");
    update.title = title;
  }
  if (patch.artist !== undefined) update.artist = artist || null;
  if (patch.album !== undefined) update.album = album || null;
  if (patch.sort_order !== undefined) {
    update.sort_order = Math.max(0, Math.floor(patch.sort_order));
  }
  if (patch.favorite !== undefined) update.favorite = Boolean(patch.favorite);
  if (patch.energy_level !== undefined) update.energy_level = patch.energy_level;

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
  field: "play_count" | "skip_count",
  alsoMarkPlayed: boolean
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

  const counterRow = data as Partial<
    Record<"play_count" | "skip_count", number | null>
  >;
  const nextValue = Math.max(0, Number(counterRow[field] ?? 0)) + 1;

  const update: Record<string, string | number> = {
    [field]: nextValue,
    updated_at: new Date().toISOString(),
  };

  if (alsoMarkPlayed) update.last_played_at = new Date().toISOString();

  const { error: updateError } = await supabase
    .from(MUSIC_TABLE)
    .update(update)
    .eq("id", trackId)
    .eq("user_id", userId);

  if (updateError) throw updateError;
}

export async function recordMusicTrackPlayed(trackId: string) {
  await incrementTrackCounter(trackId, "play_count", true);
}

export async function recordMusicTrackSkipped(trackId: string) {
  await incrementTrackCounter(trackId, "skip_count", false);
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

export async function getMusicTrackSignedUrl(track: MusicTrack): Promise<string> {
  const cached = signedUrlCache.get(track.id);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  const expiresInSeconds = 24 * 60 * 60;
  const { data, error } = await supabase.storage
    .from(MUSIC_BUCKET)
    .createSignedUrl(track.storage_path, expiresInSeconds);

  if (error) throw error;

  signedUrlCache.set(track.id, {
    url: data.signedUrl,
    expiresAt: Date.now() + 20 * 60 * 60 * 1000,
  });

  return data.signedUrl;
}

export async function getMusicArtworkSignedUrl(
  track: MusicTrack
): Promise<string | null> {
  if (!track.artwork_path) return null;

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
