import { supabase } from "./supabase";

export const MUSIC_BUCKET = "trainer-music";
export const MUSIC_TABLE = "trainer_music_tracks";
export const MAX_MUSIC_FILE_BYTES = 50 * 1024 * 1024;

const MUSIC_WORKER_URL =
  "https://mvp-trainer-music-stream.autodetail.workers.dev";

export type MusicEnergyLevel = "low" | "medium" | "high";

export type MusicTrack = {
  id: string;
  user_id: string;
  storage_path: string;
  title: string;
  artist: string | null;
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
    "title" | "artist" | "sort_order" | "favorite" | "energy_level"
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

const TRACK_SELECT =
  "id,user_id,storage_path,title,artist,original_name,mime_type,file_size_bytes,duration_seconds,sort_order,favorite,energy_level,play_count,skip_count,last_played_at,created_at,updated_at";

const signedUrlCache = new Map<string, SignedUrlCacheEntry>();
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

function extensionFromName(name: string) {
  const extension =
    name.split(".").pop()?.trim().toLowerCase() ?? "";

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

function contentTypeFor(
  extension: string,
  providedType: string
) {
  if (providedType) return providedType;
  if (extension === "mp3") return "audio/mpeg";
  if (extension === "m4a") return "audio/mp4";

  return "audio/wav";
}

async function requireUserId() {
  const { data, error } = await supabase.auth.getUser();

  if (error) throw error;

  if (!data.user) {
    throw new Error(
      "Sign in before managing music."
    );
  }

  return data.user.id;
}

async function requireAccessToken() {
  const { data, error } = await supabase.auth.getSession();

  if (error) throw error;

  const accessToken = data.session?.access_token;

  if (!accessToken) {
    throw new Error(
      "Sign in before playing music."
    );
  }

  return accessToken;
}

function normalizeTrack(
  row: MusicTrack
): MusicTrack {
  return {
    ...row,
    favorite: Boolean(row.favorite),
    energy_level:
      row.energy_level === "low" ||
      row.energy_level === "high"
        ? row.energy_level
        : "medium",
    play_count: Math.max(
      0,
      Number(row.play_count || 0)
    ),
    skip_count: Math.max(
      0,
      Number(row.skip_count || 0)
    ),
  };
}

export function clearMusicUrlCache(
  trackId?: string
) {
  if (trackId) {
    signedUrlCache.delete(trackId);
    return;
  }

  signedUrlCache.clear();
}

export function validateMusicFile(file: File) {
  if (file.size <= 0) {
    throw new Error(
      `${file.name} is empty.`
    );
  }

  if (file.size > MAX_MUSIC_FILE_BYTES) {
    throw new Error(
      `${file.name} is larger than 50 MB.`
    );
  }

  const extension =
    extensionFromName(file.name);
  const mime =
    file.type.trim().toLowerCase();
  const mimeAllowed =
    !mime ||
    ALLOWED_MIME_TYPES.has(mime) ||
    mime.startsWith("audio/");

  if (!extension || !mimeAllowed) {
    throw new Error(
      `${file.name}: use an MP3, M4A, or WAV file.`
    );
  }

  return extension;
}

export async function readMusicDuration(
  file: File
): Promise<number | null> {
  return new Promise((resolve) => {
    const objectUrl =
      URL.createObjectURL(file);
    const audio =
      document.createElement("audio");
    let finished = false;

    const finish = (
      value: number | null
    ) => {
      if (finished) return;

      finished = true;
      URL.revokeObjectURL(objectUrl);
      audio.removeAttribute("src");
      audio.load();
      resolve(value);
    };

    const timeout = window.setTimeout(
      () => finish(null),
      6000
    );

    audio.preload = "metadata";

    audio.addEventListener(
      "loadedmetadata",
      () => {
        window.clearTimeout(timeout);

        const duration =
          Number(audio.duration);

        finish(
          Number.isFinite(duration) &&
            duration > 0
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

export async function listMusicTracks(): Promise<
  MusicTrack[]
> {
  const userId = await requireUserId();

  const { data, error } = await supabase
    .from(MUSIC_TABLE)
    .select(TRACK_SELECT)
    .eq("user_id", userId)
    .order("sort_order", {
      ascending: true,
    })
    .order("created_at", {
      ascending: true,
    });

  if (error) throw error;

  return (
    (data ?? []) as MusicTrack[]
  ).map(normalizeTrack);
}

export async function uploadMusicTrack(
  file: File,
  sortOrder: number
): Promise<MusicTrack> {
  const extension =
    validateMusicFile(file);
  const userId = await requireUserId();
  const durationSeconds =
    await readMusicDuration(file);
  const fileStem = safeFileName(
    file.name.replace(/\.[^.]+$/, "")
  );
  const storagePath =
    `${userId}/${Date.now()}-` +
    `${crypto.randomUUID()}-` +
    `${fileStem}.${extension}`;
  const mimeType = contentTypeFor(
    extension,
    file.type
  );

  const { error: uploadError } =
    await supabase.storage
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
    original_name: file.name,
    mime_type: mimeType,
    file_size_bytes: file.size,
    duration_seconds: durationSeconds,
    sort_order: Math.max(
      0,
      Math.floor(sortOrder)
    ),
    favorite: false,
    energy_level:
      "medium" as MusicEnergyLevel,
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
    await supabase.storage
      .from(MUSIC_BUCKET)
      .remove([storagePath]);

    throw error;
  }

  return normalizeTrack(
    data as MusicTrack
  );
}

export async function updateMusicTrack(
  trackId: string,
  patch: MusicTrackUpdate
): Promise<MusicTrack> {
  const userId = await requireUserId();
  const title = patch.title?.trim();
  const artist = patch.artist?.trim();

  const update: Record<
    string,
    string | number | boolean | null
  > = {
    updated_at: new Date().toISOString(),
  };

  if (patch.title !== undefined) {
    if (!title) {
      throw new Error(
        "Song title cannot be empty."
      );
    }

    update.title = title;
  }

  if (patch.artist !== undefined) {
    update.artist = artist || null;
  }

  if (patch.sort_order !== undefined) {
    update.sort_order = Math.max(
      0,
      Math.floor(patch.sort_order)
    );
  }

  if (patch.favorite !== undefined) {
    update.favorite =
      Boolean(patch.favorite);
  }

  if (patch.energy_level !== undefined) {
    update.energy_level =
      patch.energy_level;
  }

  const { data, error } = await supabase
    .from(MUSIC_TABLE)
    .update(update)
    .eq("id", trackId)
    .eq("user_id", userId)
    .select(TRACK_SELECT)
    .single();

  if (error) throw error;

  return normalizeTrack(
    data as MusicTrack
  );
}

export async function saveMusicTrackOrder(
  tracks: MusicTrack[]
) {
  await Promise.all(
    tracks.map((track, index) =>
      updateMusicTrack(track.id, {
        sort_order: index,
      })
    )
  );
}

async function incrementTrackCounter(
  trackId: string,
  field:
    | "play_count"
    | "skip_count",
  alsoMarkPlayed: boolean
) {
  const userId = await requireUserId();

  const { data, error: readError } =
    await supabase
      .from(MUSIC_TABLE)
      .select(`${field}`)
      .eq("id", trackId)
      .eq("user_id", userId)
      .maybeSingle();

  if (readError) throw readError;
  if (!data) return;

  const counterRow = data as Partial<
    Record<
      "play_count" | "skip_count",
      number | null
    >
  >;

  const nextValue =
    Math.max(
      0,
      Number(counterRow[field] ?? 0)
    ) + 1;

  const patch: Record<
    string,
    string | number
  > = {
    [field]: nextValue,
    updated_at: new Date().toISOString(),
  };

  if (alsoMarkPlayed) {
    patch.last_played_at =
      new Date().toISOString();
  }

  const { error: updateError } =
    await supabase
      .from(MUSIC_TABLE)
      .update(patch)
      .eq("id", trackId)
      .eq("user_id", userId);

  if (updateError) throw updateError;
}

export async function recordMusicTrackPlayed(
  trackId: string
) {
  await incrementTrackCounter(
    trackId,
    "play_count",
    true
  );
}

export async function recordMusicTrackSkipped(
  trackId: string
) {
  await incrementTrackCounter(
    trackId,
    "skip_count",
    false
  );
}

export async function removeMusicTrack(
  trackId: string
) {
  const userId = await requireUserId();

  const {
    data: track,
    error: readError,
  } = await supabase
    .from(MUSIC_TABLE)
    .select("storage_path")
    .eq("id", trackId)
    .eq("user_id", userId)
    .maybeSingle();

  if (readError) throw readError;

  const { error: deleteError } =
    await supabase
      .from(MUSIC_TABLE)
      .delete()
      .eq("id", trackId)
      .eq("user_id", userId);

  if (deleteError) throw deleteError;

  const storagePath =
    track?.storage_path as
      | string
      | undefined;

  if (storagePath) {
    const { error: storageError } =
      await supabase.storage
        .from(MUSIC_BUCKET)
        .remove([storagePath]);

    if (storageError) {
      console.warn(
        "Music file cleanup failed:",
        storageError.message
      );
    }
  }

  clearMusicUrlCache(trackId);
}

export async function getMusicTrackSignedUrl(
  track: MusicTrack
): Promise<string> {
  const cached =
    signedUrlCache.get(track.id);

  if (
    cached &&
    cached.expiresAt > Date.now()
  ) {
    return cached.url;
  }

  const accessToken =
    await requireAccessToken();

  const response = await fetch(
    `${MUSIC_WORKER_URL}/sign`,
    {
      method: "POST",
      headers: {
        Authorization:
          `Bearer ${accessToken}`,
        "Content-Type":
          "application/json",
      },
      body: JSON.stringify({
        key: track.storage_path,
      }),
    }
  );

  let payload: WorkerSignedUrlResponse = {};

  try {
    payload =
      (await response.json()) as WorkerSignedUrlResponse;
  } catch {
    // Keep the payload empty and use the status-based error below.
  }

  if (!response.ok) {
    throw new Error(
      payload.error ||
        `Music stream authorization failed (${response.status}).`
    );
  }

  if (!payload.url) {
    throw new Error(
      "Music stream did not return a playback URL."
    );
  }

  const workerExpiresAt =
    Number(payload.expiresAt);

  const safeExpiresAt =
    Number.isFinite(workerExpiresAt) &&
    workerExpiresAt > Date.now()
      ? Math.max(
          Date.now() + 30_000,
          workerExpiresAt - 5 * 60 * 1000
        )
      : Date.now() + 50 * 60 * 1000;

  signedUrlCache.set(track.id, {
    url: payload.url,
    expiresAt: safeExpiresAt,
  });

  return payload.url;
}
