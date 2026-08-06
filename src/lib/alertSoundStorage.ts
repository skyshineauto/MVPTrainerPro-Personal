import { supabase } from "./supabase";

export const ALERT_SOUND_BUCKET = "trainer-alerts";
export const ALERT_SOUND_TABLE = "trainer_alert_sounds";
export const MAX_ALERT_SOUND_BYTES = 5 * 1024 * 1024;

export const ALERT_SOUND_TYPES = [
  "workout_start",
  "rest_complete",
  "exercise_complete",
  "workout_complete",
] as const;

export type AlertSoundType = (typeof ALERT_SOUND_TYPES)[number];

export type AlertSoundRecord = {
  user_id: string;
  alert_type: AlertSoundType;
  storage_path: string;
  mime_type: string | null;
  original_name: string | null;
  updated_at: string;
};

type SignedUrlCacheEntry = {
  url: string;
  expiresAt: number;
};

const signedUrlCache = new Map<AlertSoundType, SignedUrlCacheEntry>();

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
  const extension = name.split(".").pop()?.trim().toLowerCase() ?? "";
  return ALLOWED_EXTENSIONS.has(extension) ? extension : "";
}

function safeFileName(name: string) {
  const cleaned = name
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return cleaned || "alert-sound";
}

async function requireUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("Sign in before managing alert sounds.");
  return data.user.id;
}

export function clearAlertSoundUrlCache(alertType?: AlertSoundType) {
  if (alertType) {
    signedUrlCache.delete(alertType);
    return;
  }

  signedUrlCache.clear();
}

export function validateAlertSoundFile(file: File) {
  if (file.size <= 0) {
    throw new Error("The selected sound file is empty.");
  }

  if (file.size > MAX_ALERT_SOUND_BYTES) {
    throw new Error("Alert sounds must be 5 MB or smaller.");
  }

  const extension = extensionFromName(file.name);
  const mime = file.type.trim().toLowerCase();
  const mimeAllowed = !mime || ALLOWED_MIME_TYPES.has(mime) || mime.startsWith("audio/");

  if (!extension || !mimeAllowed) {
    throw new Error("Use an MP3, M4A, or WAV alert sound.");
  }

  return extension;
}

export async function listAlertSounds(): Promise<Partial<Record<AlertSoundType, AlertSoundRecord>>> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from(ALERT_SOUND_TABLE)
    .select("user_id, alert_type, storage_path, mime_type, original_name, updated_at")
    .eq("user_id", userId);

  if (error) throw error;

  const result: Partial<Record<AlertSoundType, AlertSoundRecord>> = {};
  for (const row of data ?? []) {
    const alertType = row.alert_type as AlertSoundType;
    if (!ALERT_SOUND_TYPES.includes(alertType)) continue;
    result[alertType] = row as AlertSoundRecord;
  }

  return result;
}

export async function uploadAlertSound(
  alertType: AlertSoundType,
  file: File
): Promise<AlertSoundRecord> {
  const extension = validateAlertSoundFile(file);
  const userId = await requireUserId();

  const { data: previous, error: previousError } = await supabase
    .from(ALERT_SOUND_TABLE)
    .select("storage_path")
    .eq("user_id", userId)
    .eq("alert_type", alertType)
    .maybeSingle();

  if (previousError) throw previousError;

  const fileName = safeFileName(file.name.replace(/\.[^.]+$/, ""));
  const storagePath = `${userId}/${alertType}/${Date.now()}-${fileName}.${extension}`;
  const contentType =
    file.type ||
    (extension === "mp3"
      ? "audio/mpeg"
      : extension === "m4a"
        ? "audio/mp4"
        : "audio/wav");

  const uploadResult = await supabase.storage
    .from(ALERT_SOUND_BUCKET)
    .upload(storagePath, file, {
      upsert: false,
      contentType,
      cacheControl: "3600",
    });

  if (uploadResult.error) throw uploadResult.error;

  const record = {
    user_id: userId,
    alert_type: alertType,
    storage_path: storagePath,
    mime_type: contentType,
    original_name: file.name,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from(ALERT_SOUND_TABLE)
    .upsert(record, { onConflict: "user_id,alert_type" })
    .select("user_id, alert_type, storage_path, mime_type, original_name, updated_at")
    .single();

  if (error) {
    await supabase.storage.from(ALERT_SOUND_BUCKET).remove([storagePath]);
    throw error;
  }

  const previousPath = previous?.storage_path as string | undefined;
  if (previousPath && previousPath !== storagePath) {
    await supabase.storage.from(ALERT_SOUND_BUCKET).remove([previousPath]);
  }

  clearAlertSoundUrlCache(alertType);
  return data as AlertSoundRecord;
}

export async function removeAlertSound(alertType: AlertSoundType) {
  const userId = await requireUserId();

  const { data: current, error: currentError } = await supabase
    .from(ALERT_SOUND_TABLE)
    .select("storage_path")
    .eq("user_id", userId)
    .eq("alert_type", alertType)
    .maybeSingle();

  if (currentError) throw currentError;

  const { error: deleteError } = await supabase
    .from(ALERT_SOUND_TABLE)
    .delete()
    .eq("user_id", userId)
    .eq("alert_type", alertType);

  if (deleteError) throw deleteError;

  const storagePath = current?.storage_path as string | undefined;
  if (storagePath) {
    const { error: storageError } = await supabase.storage
      .from(ALERT_SOUND_BUCKET)
      .remove([storagePath]);

    if (storageError) {
      console.warn("Alert sound object cleanup failed:", storageError.message);
    }
  }

  clearAlertSoundUrlCache(alertType);
}

export async function getAlertSoundSignedUrl(
  alertType: AlertSoundType
): Promise<string | null> {
  const cached = signedUrlCache.get(alertType);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.url;
  }

  const userId = await requireUserId();
  const { data: record, error } = await supabase
    .from(ALERT_SOUND_TABLE)
    .select("storage_path")
    .eq("user_id", userId)
    .eq("alert_type", alertType)
    .maybeSingle();

  if (error) throw error;
  if (!record?.storage_path) return null;

  const expiresInSeconds = 60 * 60;
  const { data, error: signedUrlError } = await supabase.storage
    .from(ALERT_SOUND_BUCKET)
    .createSignedUrl(record.storage_path, expiresInSeconds);

  if (signedUrlError) throw signedUrlError;

  signedUrlCache.set(alertType, {
    url: data.signedUrl,
    expiresAt: Date.now() + 50 * 60 * 1000,
  });

  return data.signedUrl;
}
