import { supabase } from "./supabase";

export const ALERT_SOUND_BUCKET = "trainer-alerts";
export const ALERT_SOUND_TABLE = "trainer_alert_sounds";
export const ALERT_SOUND_CHANGED_EVENT =
  "mvp:alert-sound-changed";
export const MAX_ALERT_SOUND_BYTES = 5 * 1024 * 1024;

export const ALERT_SOUND_TYPES = [
  "workout_start",
  "rest_complete",
  "exercise_complete",
  "workout_complete",
] as const;

export type AlertSoundType =
  (typeof ALERT_SOUND_TYPES)[number];

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
  storagePath: string;
  expiresAt: number;
};

type SignedUrlOptions = {
  forceRefresh?: boolean;
};

const SIGNED_URL_SECONDS = 60 * 60;
const SIGNED_URL_CACHE_MS = 50 * 60 * 1000;

const signedUrlCache = new Map<
  AlertSoundType,
  SignedUrlCacheEntry
>();

const signedUrlRequests = new Map<
  AlertSoundType,
  Promise<string | null>
>();

const ALLOWED_EXTENSIONS = new Set([
  "mp3",
  "m4a",
  "wav",
]);

const ALLOWED_MIME_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/x-m4a",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
]);

function isAlertSoundType(
  value: unknown
): value is AlertSoundType {
  return ALERT_SOUND_TYPES.includes(
    value as AlertSoundType
  );
}

function requireAlertSoundType(
  value: unknown
): AlertSoundType {
  if (!isAlertSoundType(value)) {
    throw new Error("Unsupported workout alert type.");
  }

  return value;
}

function extensionFromName(name: string) {
  const extension =
    name.split(".").pop()?.trim().toLowerCase() ?? "";

  return ALLOWED_EXTENSIONS.has(extension)
    ? extension
    : "";
}

function safeFileName(name: string) {
  const cleaned = name
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90);

  return cleaned || "alert-sound";
}

function contentTypeForFile(
  file: File,
  extension: string
) {
  const explicit = file.type.trim();

  if (explicit) return explicit;
  if (extension === "mp3") return "audio/mpeg";
  if (extension === "m4a") return "audio/mp4";

  return "audio/wav";
}

async function requireUserId() {
  const { data, error } = await supabase.auth.getUser();

  if (error) throw error;

  if (!data.user) {
    throw new Error(
      "Sign in before managing alert sounds."
    );
  }

  return data.user.id;
}

function notifyAlertSoundChanged(
  alertType: AlertSoundType,
  action: "uploaded" | "removed"
) {
  if (typeof window === "undefined") return;

  try {
    window.dispatchEvent(
      new CustomEvent(ALERT_SOUND_CHANGED_EVENT, {
        detail: {
          alertType,
          action,
          changedAt: Date.now(),
        },
      })
    );
  } catch {
    // Browser notifications are optional.
  }
}

async function removeStorageObject(
  storagePath: string | null | undefined
) {
  if (!storagePath) return;

  const { error } = await supabase.storage
    .from(ALERT_SOUND_BUCKET)
    .remove([storagePath]);

  if (error) {
    console.warn(
      "Alert sound object cleanup failed:",
      error.message
    );
  }
}

export function clearAlertSoundUrlCache(
  alertType?: AlertSoundType
) {
  if (alertType) {
    signedUrlCache.delete(alertType);
    signedUrlRequests.delete(alertType);
    return;
  }

  signedUrlCache.clear();
  signedUrlRequests.clear();
}

export function validateAlertSoundFile(file: File) {
  if (!(file instanceof File)) {
    throw new Error("Choose an audio file to upload.");
  }

  if (file.size <= 0) {
    throw new Error(
      "The selected sound file is empty."
    );
  }

  if (file.size > MAX_ALERT_SOUND_BYTES) {
    throw new Error(
      "Alert sounds must be 5 MB or smaller."
    );
  }

  const extension = extensionFromName(file.name);
  const mime = file.type.trim().toLowerCase();
  const mimeAllowed =
    !mime ||
    ALLOWED_MIME_TYPES.has(mime) ||
    mime.startsWith("audio/");

  if (!extension || !mimeAllowed) {
    throw new Error(
      "Use an MP3, M4A, or WAV alert sound."
    );
  }

  return extension;
}

export async function listAlertSounds(): Promise<
  Partial<Record<AlertSoundType, AlertSoundRecord>>
> {
  const userId = await requireUserId();

  const { data, error } = await supabase
    .from(ALERT_SOUND_TABLE)
    .select(
      "user_id, alert_type, storage_path, mime_type, original_name, updated_at"
    )
    .eq("user_id", userId);

  if (error) throw error;

  const result: Partial<
    Record<AlertSoundType, AlertSoundRecord>
  > = {};

  for (const row of data ?? []) {
    if (!isAlertSoundType(row.alert_type)) continue;

    const record = row as AlertSoundRecord;
    result[record.alert_type] = record;

    const cached = signedUrlCache.get(
      record.alert_type
    );

    if (
      cached &&
      cached.storagePath !== record.storage_path
    ) {
      clearAlertSoundUrlCache(record.alert_type);
    }
  }

  return result;
}

export async function uploadAlertSound(
  alertTypeValue: AlertSoundType,
  file: File
): Promise<AlertSoundRecord> {
  const alertType =
    requireAlertSoundType(alertTypeValue);
  const extension = validateAlertSoundFile(file);
  const userId = await requireUserId();

  clearAlertSoundUrlCache(alertType);

  const { data: previous, error: previousError } =
    await supabase
      .from(ALERT_SOUND_TABLE)
      .select("storage_path")
      .eq("user_id", userId)
      .eq("alert_type", alertType)
      .maybeSingle();

  if (previousError) throw previousError;

  const sourceName = file.name.replace(
    /\.[^.]+$/,
    ""
  );
  const fileName = safeFileName(sourceName);
  const storagePath =
    `${userId}/${alertType}/` +
    `${Date.now()}-${fileName}.${extension}`;
  const contentType = contentTypeForFile(
    file,
    extension
  );

  const uploadResult = await supabase.storage
    .from(ALERT_SOUND_BUCKET)
    .upload(storagePath, file, {
      upsert: false,
      contentType,
      cacheControl: "3600",
    });

  if (uploadResult.error) {
    throw uploadResult.error;
  }

  const record: AlertSoundRecord = {
    user_id: userId,
    alert_type: alertType,
    storage_path: storagePath,
    mime_type: contentType,
    original_name: file.name,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from(ALERT_SOUND_TABLE)
    .upsert(record, {
      onConflict: "user_id,alert_type",
    })
    .select(
      "user_id, alert_type, storage_path, mime_type, original_name, updated_at"
    )
    .single();

  if (error) {
    await removeStorageObject(storagePath);
    throw error;
  }

  const previousPath = previous?.storage_path as
    | string
    | undefined;

  if (
    previousPath &&
    previousPath !== storagePath
  ) {
    await removeStorageObject(previousPath);
  }

  clearAlertSoundUrlCache(alertType);
  notifyAlertSoundChanged(alertType, "uploaded");

  return data as AlertSoundRecord;
}

export async function removeAlertSound(
  alertTypeValue: AlertSoundType
) {
  const alertType =
    requireAlertSoundType(alertTypeValue);
  const userId = await requireUserId();

  clearAlertSoundUrlCache(alertType);

  const { data: current, error: currentError } =
    await supabase
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

  await removeStorageObject(
    current?.storage_path as string | undefined
  );

  clearAlertSoundUrlCache(alertType);
  notifyAlertSoundChanged(alertType, "removed");
}

async function createAlertSoundSignedUrl(
  alertType: AlertSoundType
) {
  const userId = await requireUserId();

  const { data: record, error } = await supabase
    .from(ALERT_SOUND_TABLE)
    .select("storage_path")
    .eq("user_id", userId)
    .eq("alert_type", alertType)
    .maybeSingle();

  if (error) throw error;

  const storagePath = String(
    record?.storage_path ?? ""
  ).trim();

  if (!storagePath) {
    signedUrlCache.delete(alertType);
    return null;
  }

  const { data, error: signedUrlError } =
    await supabase.storage
      .from(ALERT_SOUND_BUCKET)
      .createSignedUrl(
        storagePath,
        SIGNED_URL_SECONDS
      );

  if (signedUrlError) throw signedUrlError;

  const signedUrl = String(
    data?.signedUrl ?? ""
  ).trim();

  if (!signedUrl) {
    throw new Error(
      "The custom alert sound URL was not created."
    );
  }

  signedUrlCache.set(alertType, {
    url: signedUrl,
    storagePath,
    expiresAt:
      Date.now() + SIGNED_URL_CACHE_MS,
  });

  return signedUrl;
}

export async function getAlertSoundSignedUrl(
  alertTypeValue: AlertSoundType,
  options?: SignedUrlOptions
): Promise<string | null> {
  const alertType =
    requireAlertSoundType(alertTypeValue);
  const forceRefresh =
    options?.forceRefresh === true;

  if (forceRefresh) {
    clearAlertSoundUrlCache(alertType);
  } else {
    const cached = signedUrlCache.get(alertType);

    if (
      cached &&
      cached.expiresAt > Date.now()
    ) {
      return cached.url;
    }

    const existingRequest =
      signedUrlRequests.get(alertType);

    if (existingRequest) {
      return existingRequest;
    }
  }

  const request = createAlertSoundSignedUrl(
    alertType
  );

  signedUrlRequests.set(alertType, request);

  try {
    return await request;
  } finally {
    if (
      signedUrlRequests.get(alertType) === request
    ) {
      signedUrlRequests.delete(alertType);
    }
  }
}
