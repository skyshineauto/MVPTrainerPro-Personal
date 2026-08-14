import { supabase } from "./supabase";

const BUCKET = "motivation-videos";
const MAX_FILE_BYTES = 50 * 1024 * 1024;

export type MotivationVideoOrientation = "portrait" | "landscape" | "square";

export type MotivationVideoRecord = {
  id: string;
  user_id: string;
  storage_path: string;
  file_name: string;
  title: string | null;
  is_active: boolean;
  sort_order: number;
  orientation: MotivationVideoOrientation | null;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  size_bytes: number | null;
  created_at: string;
  updated_at: string;
  public_url: string;
};

type UploadProgress = (percent: number) => void;

type VideoMetadata = {
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  orientation: MotivationVideoOrientation | null;
};

function safeFileBaseName(name: string) {
  const withoutExtension = name.replace(/\.[^/.]+$/, "");
  const cleaned = withoutExtension
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, 80);

  return cleaned || "motivation-video";
}

function validateVideo(file: File) {
  const lower = file.name.toLowerCase();
  const isMp4Name = lower.endsWith(".mp4");
  const isMp4Type =
    file.type === "video/mp4" ||
    file.type === "application/mp4" ||
    file.type === "";

  if (!isMp4Name || !isMp4Type) {
    throw new Error("Use an MP4 video file.");
  }

  if (!(file.size > 0)) {
    throw new Error("The selected video file is empty.");
  }

  if (file.size > MAX_FILE_BYTES) {
    throw new Error("Motivation videos must be 50 MB or smaller.");
  }
}

function getPublicUrl(storagePath: string) {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

function withPublicUrl(row: any): MotivationVideoRecord {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    storage_path: String(row.storage_path),
    file_name: String(row.file_name),
    title: row.title != null ? String(row.title) : null,
    is_active: Boolean(row.is_active),
    sort_order: Number(row.sort_order ?? 0),
    orientation: (row.orientation as MotivationVideoOrientation | null) ?? null,
    duration_seconds:
      row.duration_seconds != null && Number.isFinite(Number(row.duration_seconds))
        ? Number(row.duration_seconds)
        : null,
    width:
      row.width != null && Number.isFinite(Number(row.width))
        ? Number(row.width)
        : null,
    height:
      row.height != null && Number.isFinite(Number(row.height))
        ? Number(row.height)
        : null,
    size_bytes:
      row.size_bytes != null && Number.isFinite(Number(row.size_bytes))
        ? Number(row.size_bytes)
        : null,
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
    public_url: getPublicUrl(String(row.storage_path)),
  };
}

async function currentUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("Sign in before managing motivation videos.");
  return data.user.id;
}

async function readVideoMetadata(file: File): Promise<VideoMetadata> {
  if (typeof document === "undefined") {
    return {
      duration_seconds: null,
      width: null,
      height: null,
      orientation: null,
    };
  }

  const objectUrl = URL.createObjectURL(file);

  try {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;

    const metadata = await new Promise<VideoMetadata>((resolve, reject) => {
      const cleanup = () => {
        video.onloadedmetadata = null;
        video.onerror = null;
      };

      video.onloadedmetadata = () => {
        cleanup();

        const width = Number(video.videoWidth || 0);
        const height = Number(video.videoHeight || 0);
        const duration = Number(video.duration || 0);

        let orientation: MotivationVideoOrientation | null = null;
        if (width > 0 && height > 0) {
          if (Math.abs(width - height) <= Math.max(width, height) * 0.04) {
            orientation = "square";
          } else {
            orientation = height > width ? "portrait" : "landscape";
          }
        }

        resolve({
          duration_seconds:
            Number.isFinite(duration) && duration > 0 ? duration : null,
          width: width > 0 ? width : null,
          height: height > 0 ? height : null,
          orientation,
        });
      };

      video.onerror = () => {
        cleanup();
        reject(new Error("MVP Trainer could not read this video's metadata."));
      };

      video.src = objectUrl;
    });

    return metadata;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function progressTicker(onProgress?: UploadProgress) {
  if (!onProgress) {
    return { finish: () => undefined };
  }

  let value = 8;
  onProgress(value);

  const timer = window.setInterval(() => {
    value = Math.min(88, value + Math.max(1, Math.round((92 - value) * 0.13)));
    onProgress(value);
  }, 180);

  return {
    finish: () => {
      window.clearInterval(timer);
      onProgress(100);
    },
  };
}

async function uploadStorageFile(
  storagePath: string,
  file: File,
  onProgress?: UploadProgress
) {
  /*
   * Supabase JS' standard Storage upload does not expose byte-level upload
   * progress. The UI progress bar therefore represents lifecycle progress:
   * validation/metadata, transfer in progress, then commit. The upload itself
   * is a real direct Storage upload and is safe for the 50 MB bucket limit.
   */
  const ticker =
    typeof window !== "undefined"
      ? progressTicker(onProgress)
      : { finish: () => onProgress?.(100) };

  try {
    const { error } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
      cacheControl: "3600",
      contentType: "video/mp4",
      upsert: false,
    });

    if (error) throw error;
    ticker.finish();
  } catch (error) {
    ticker.finish();
    throw error;
  }
}

async function nextSortOrder(userId: string) {
  const { data, error } = await supabase
    .from("motivation_videos")
    .select("sort_order")
    .eq("user_id", userId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  return Number(data?.sort_order ?? -1) + 1;
}

export async function listMotivationVideos(): Promise<MotivationVideoRecord[]> {
  const userId = await currentUserId();

  const { data, error } = await supabase
    .from("motivation_videos")
    .select(
      "id,user_id,storage_path,file_name,title,is_active,sort_order,orientation,duration_seconds,width,height,size_bytes,created_at,updated_at"
    )
    .eq("user_id", userId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw error;

  return (data ?? []).map(withPublicUrl);
}

export async function listActiveMotivationVideos(): Promise<MotivationVideoRecord[]> {
  const userId = await currentUserId();

  const { data, error } = await supabase
    .from("motivation_videos")
    .select(
      "id,user_id,storage_path,file_name,title,is_active,sort_order,orientation,duration_seconds,width,height,size_bytes,created_at,updated_at"
    )
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw error;

  return (data ?? []).map(withPublicUrl);
}

export async function uploadMotivationVideo(
  file: File,
  onProgress?: UploadProgress
): Promise<MotivationVideoRecord> {
  validateVideo(file);

  const userId = await currentUserId();
  onProgress?.(3);

  const metadata = await readVideoMetadata(file);
  onProgress?.(7);

  const unique = `${Date.now()}-${crypto.randomUUID()}`;
  const storagePath = `${userId}/${unique}-${safeFileBaseName(file.name)}.mp4`;

  await uploadStorageFile(storagePath, file, onProgress);

  try {
    const sortOrder = await nextSortOrder(userId);

    const { data, error } = await supabase
      .from("motivation_videos")
      .insert({
        user_id: userId,
        storage_path: storagePath,
        file_name: file.name,
        title: null,
        is_active: true,
        sort_order: sortOrder,
        orientation: metadata.orientation,
        duration_seconds: metadata.duration_seconds,
        width: metadata.width,
        height: metadata.height,
        size_bytes: file.size,
        updated_at: new Date().toISOString(),
      })
      .select(
        "id,user_id,storage_path,file_name,title,is_active,sort_order,orientation,duration_seconds,width,height,size_bytes,created_at,updated_at"
      )
      .single();

    if (error) throw error;
    onProgress?.(100);

    return withPublicUrl(data);
  } catch (error) {
    await supabase.storage.from(BUCKET).remove([storagePath]).catch(() => undefined);
    throw error;
  }
}

export async function replaceMotivationVideo(
  current: MotivationVideoRecord,
  file: File,
  onProgress?: UploadProgress
): Promise<MotivationVideoRecord> {
  validateVideo(file);

  const userId = await currentUserId();
  if (current.user_id !== userId) {
    throw new Error("This motivation video does not belong to the signed-in user.");
  }

  onProgress?.(3);
  const metadata = await readVideoMetadata(file);
  onProgress?.(7);

  const unique = `${Date.now()}-${crypto.randomUUID()}`;
  const newStoragePath = `${userId}/${unique}-${safeFileBaseName(file.name)}.mp4`;

  await uploadStorageFile(newStoragePath, file, onProgress);

  try {
    const { data, error } = await supabase
      .from("motivation_videos")
      .update({
        storage_path: newStoragePath,
        file_name: file.name,
        orientation: metadata.orientation,
        duration_seconds: metadata.duration_seconds,
        width: metadata.width,
        height: metadata.height,
        size_bytes: file.size,
        updated_at: new Date().toISOString(),
      })
      .eq("id", current.id)
      .eq("user_id", userId)
      .select(
        "id,user_id,storage_path,file_name,title,is_active,sort_order,orientation,duration_seconds,width,height,size_bytes,created_at,updated_at"
      )
      .single();

    if (error) throw error;

    if (current.storage_path && current.storage_path !== newStoragePath) {
      const { error: removeError } = await supabase.storage
        .from(BUCKET)
        .remove([current.storage_path]);

      if (removeError) {
        console.warn("Old motivation video could not be removed:", removeError);
      }
    }

    onProgress?.(100);
    return withPublicUrl(data);
  } catch (error) {
    await supabase.storage.from(BUCKET).remove([newStoragePath]).catch(() => undefined);
    throw error;
  }
}

export async function setMotivationVideoActive(
  id: string,
  isActive: boolean
): Promise<MotivationVideoRecord> {
  const userId = await currentUserId();

  const { data, error } = await supabase
    .from("motivation_videos")
    .update({
      is_active: isActive,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", userId)
    .select(
      "id,user_id,storage_path,file_name,title,is_active,sort_order,orientation,duration_seconds,width,height,size_bytes,created_at,updated_at"
    )
    .single();

  if (error) throw error;

  return withPublicUrl(data);
}

export async function removeMotivationVideo(
  video: MotivationVideoRecord
): Promise<void> {
  const userId = await currentUserId();

  const { error: tableError } = await supabase
    .from("motivation_videos")
    .delete()
    .eq("id", video.id)
    .eq("user_id", userId);

  if (tableError) throw tableError;

  const { error: storageError } = await supabase.storage
    .from(BUCKET)
    .remove([video.storage_path]);

  if (storageError) {
    console.warn("Motivation metadata deleted, but Storage cleanup failed:", storageError);
  }
}
