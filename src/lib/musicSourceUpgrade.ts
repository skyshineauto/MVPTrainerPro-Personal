import {
  MAX_MUSIC_FILE_BYTES,
  MUSIC_TABLE,
  clearMusicUrlCache,
  readMusicDuration,
  type MusicTrack,
} from "./musicStorage";
import { supabase } from "./supabase";

const MUSIC_WORKER_URL = "https://mvp-trainer-music-stream.autodetail.workers.dev";
const DEFERRED_CLEANUP_KEY = "mvp_music_source_cleanup_v1";

export type MusicSourceCodec = "MP3" | "AAC" | "FLAC" | "WAV" | "AUDIO";
export type MusicSourceTier = "lossless" | "high" | "good" | "standard" | "low" | "unknown";

export type MusicSourceAnalysis = {
  codec: MusicSourceCodec;
  bitrateKbps: number | null;
  bitrateLabel: string;
  tier: MusicSourceTier;
  qualityLabel: string;
  lossless: boolean;
  upgradeRecommended: boolean;
  durationSeconds: number | null;
  sizeBytes: number | null;
  mimeType: string | null;
  extension: string;
};

export type MusicSourceUpgradeComparison = {
  current: MusicSourceAnalysis;
  candidate: MusicSourceAnalysis;
  isUpgrade: boolean;
  sameTrackLikely: boolean;
  durationDeltaSeconds: number | null;
  message: string;
};

function extensionFromName(name: string) {
  return name.split(".").pop()?.trim().toLowerCase() || "";
}

function codecFrom(extension: string, mimeType: string | null | undefined): MusicSourceCodec {
  const ext = extension.toLowerCase();
  const mime = String(mimeType || "").toLowerCase();
  if (ext === "flac" || mime.includes("flac")) return "FLAC";
  if (ext === "wav" || mime.includes("wav") || mime.includes("wave")) return "WAV";
  if (ext === "m4a" || mime.includes("mp4") || mime.includes("aac") || mime.includes("m4a")) return "AAC";
  if (ext === "mp3" || mime.includes("mpeg") || mime.includes("mp3")) return "MP3";
  return "AUDIO";
}

function contentTypeFor(extension: string, providedType: string) {
  const clean = providedType.trim().toLowerCase();
  if (clean.startsWith("audio/")) return clean;
  if (extension === "flac") return "audio/flac";
  if (extension === "wav") return "audio/wav";
  if (extension === "m4a") return "audio/mp4";
  return "audio/mpeg";
}

function estimateBitrateKbps(sizeBytes: number | null | undefined, durationSeconds: number | null | undefined) {
  const bytes = Number(sizeBytes || 0);
  const seconds = Number(durationSeconds || 0);
  if (!(bytes > 0) || !(seconds > 0)) return null;
  const raw = (bytes * 8) / seconds / 1000;
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return Math.max(8, Math.round(raw / 8) * 8);
}

function classify(codec: MusicSourceCodec, bitrateKbps: number | null): Pick<MusicSourceAnalysis, "tier" | "qualityLabel" | "lossless" | "upgradeRecommended"> {
  if (codec === "FLAC" || codec === "WAV") {
    return { tier: "lossless", qualityLabel: "LOSSLESS", lossless: true, upgradeRecommended: false };
  }
  if (bitrateKbps == null) {
    return { tier: "unknown", qualityLabel: "UNKNOWN", lossless: false, upgradeRecommended: false };
  }

  const effective = codec === "AAC" ? bitrateKbps * 1.12 : bitrateKbps;
  if (effective >= 300) return { tier: "high", qualityLabel: "HIGH", lossless: false, upgradeRecommended: false };
  if (effective >= 240) return { tier: "good", qualityLabel: "GOOD", lossless: false, upgradeRecommended: false };
  if (effective >= 176) return { tier: "standard", qualityLabel: "STANDARD", lossless: false, upgradeRecommended: true };
  return { tier: "low", qualityLabel: "LOW", lossless: false, upgradeRecommended: true };
}

function buildAnalysis({
  originalName,
  mimeType,
  sizeBytes,
  durationSeconds,
}: {
  originalName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  durationSeconds: number | null;
}): MusicSourceAnalysis {
  const extension = extensionFromName(originalName);
  const codec = codecFrom(extension, mimeType);
  const bitrateKbps = estimateBitrateKbps(sizeBytes, durationSeconds);
  const quality = classify(codec, bitrateKbps);
  return {
    codec,
    bitrateKbps,
    bitrateLabel: bitrateKbps == null ? "— kbps" : `~${bitrateKbps} kbps`,
    ...quality,
    durationSeconds,
    sizeBytes,
    mimeType,
    extension,
  };
}

export function analyzeMusicTrackSource(track: MusicTrack | null): MusicSourceAnalysis {
  if (!track) {
    return buildAnalysis({
      originalName: "audio",
      mimeType: null,
      sizeBytes: null,
      durationSeconds: null,
    });
  }
  return buildAnalysis({
    originalName: track.original_name || "audio",
    mimeType: track.mime_type || null,
    sizeBytes: track.file_size_bytes == null ? null : Number(track.file_size_bytes),
    durationSeconds: track.duration_seconds == null ? null : Number(track.duration_seconds),
  });
}

function validateUpgradeFile(file: File) {
  if (!(file.size > 0)) throw new Error("The selected audio file is empty.");
  if (file.size > MAX_MUSIC_FILE_BYTES) throw new Error("Replacement audio must be 50 MB or smaller.");
  const extension = extensionFromName(file.name);
  if (!["mp3", "m4a", "wav", "flac"].includes(extension)) {
    throw new Error("Choose an MP3, M4A/AAC, WAV, or FLAC file.");
  }
  const mime = file.type.trim().toLowerCase();
  if (mime && !mime.startsWith("audio/")) throw new Error("The selected file is not an audio file.");
  return extension;
}

export async function analyzeMusicSourceFile(file: File): Promise<MusicSourceAnalysis> {
  const extension = validateUpgradeFile(file);
  const durationSeconds = await readMusicDuration(file);
  return buildAnalysis({
    originalName: file.name,
    mimeType: contentTypeFor(extension, file.type),
    sizeBytes: file.size,
    durationSeconds,
  });
}

function lossyScore(source: MusicSourceAnalysis) {
  if (source.bitrateKbps == null) return 0;
  return source.bitrateKbps * (source.codec === "AAC" ? 1.12 : 1);
}

export function compareMusicSources(
  current: MusicSourceAnalysis,
  candidate: MusicSourceAnalysis
): MusicSourceUpgradeComparison {
  const currentDuration = Number(current.durationSeconds || 0);
  const candidateDuration = Number(candidate.durationSeconds || 0);
  const durationDeltaSeconds = currentDuration > 0 && candidateDuration > 0
    ? Math.abs(currentDuration - candidateDuration)
    : null;
  const durationTolerance = currentDuration > 0 ? Math.max(12, currentDuration * 0.08) : null;
  const sameTrackLikely = durationDeltaSeconds == null || durationTolerance == null || durationDeltaSeconds <= durationTolerance;

  if (!sameTrackLikely) {
    return {
      current,
      candidate,
      isUpgrade: false,
      sameTrackLikely,
      durationDeltaSeconds,
      message: "The replacement duration is very different from the current song. Choose the correct version before replacing it.",
    };
  }

  if (current.lossless) {
    return {
      current,
      candidate,
      isUpgrade: false,
      sameTrackLikely,
      durationDeltaSeconds,
      message: "The current source is already lossless. A larger bitrate would not create additional source detail.",
    };
  }

  if (candidate.lossless) {
    return {
      current,
      candidate,
      isUpgrade: true,
      sameTrackLikely,
      durationDeltaSeconds,
      message: `${candidate.codec} is a genuine lossless source upgrade.`,
    };
  }

  const currentScore = lossyScore(current);
  const candidateScore = lossyScore(candidate);
  const requiredGain = Math.max(24, currentScore * 0.12);
  const isUpgrade = currentScore > 0 && candidateScore >= currentScore + requiredGain;

  return {
    current,
    candidate,
    isUpgrade,
    sameTrackLikely,
    durationDeltaSeconds,
    message: isUpgrade
      ? "The replacement has meaningfully higher source quality."
      : "This file does not provide enough source-quality improvement to replace the current version.",
  };
}

function safeFileStem(name: string) {
  return name
    .replace(/\.[^/.]+$/, "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, 90) || "music-source";
}

async function accessTokenAndUserId() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const session = data.session;
  if (!session?.access_token || !session.user?.id) throw new Error("Sign in before upgrading a music source.");
  return { token: session.access_token, userId: session.user.id };
}

async function workerError(response: Response, fallback: string) {
  try {
    const json = await response.json() as { error?: string; detail?: string };
    return json.error || json.detail || fallback;
  } catch {
    return fallback;
  }
}

async function uploadObject(token: string, key: string, file: File, contentType: string) {
  const response = await fetch(`${MUSIC_WORKER_URL}/object?key=${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body: file,
  });
  if (!response.ok) throw new Error(await workerError(response, `Music source upload failed (${response.status}).`));
}

async function deleteObject(token: string, key: string) {
  const response = await fetch(`${MUSIC_WORKER_URL}/object?key=${encodeURIComponent(key)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(await workerError(response, `Old music source cleanup failed (${response.status}).`));
}

function readDeferredCleanup() {
  if (typeof window === "undefined") return [] as string[];
  try {
    const raw = window.localStorage.getItem(DEFERRED_CLEANUP_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string" && Boolean(value)) : [];
  } catch {
    return [] as string[];
  }
}

function writeDeferredCleanup(paths: string[]) {
  if (typeof window === "undefined") return;
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (unique.length) window.localStorage.setItem(DEFERRED_CLEANUP_KEY, JSON.stringify(unique));
  else window.localStorage.removeItem(DEFERRED_CLEANUP_KEY);
}

function deferCleanup(path: string) {
  writeDeferredCleanup([...readDeferredCleanup(), path]);
}

export async function flushDeferredMusicSourceCleanup() {
  const paths = readDeferredCleanup();
  if (!paths.length) return;
  const { token } = await accessTokenAndUserId();
  const remaining: string[] = [];
  for (const path of paths) {
    try {
      await deleteObject(token, path);
    } catch {
      remaining.push(path);
    }
  }
  writeDeferredCleanup(remaining);
}

export async function replaceMusicTrackSource(
  track: MusicTrack,
  file: File,
  candidate?: MusicSourceAnalysis,
  options?: { deferOldDelete?: boolean }
): Promise<MusicTrack> {
  const extension = validateUpgradeFile(file);
  const analysis = candidate ?? await analyzeMusicSourceFile(file);
  const current = analyzeMusicTrackSource(track);
  const comparison = compareMusicSources(current, analysis);
  if (!comparison.isUpgrade) throw new Error(comparison.message);

  const { token, userId } = await accessTokenAndUserId();
  if (track.user_id && track.user_id !== userId) throw new Error("This song does not belong to the signed-in user.");

  const contentType = contentTypeFor(extension, file.type);
  const storagePath = `${userId}/${Date.now()}-${crypto.randomUUID()}-${safeFileStem(file.name)}.${extension}`;
  await uploadObject(token, storagePath, file, contentType);

  try {
    const { data, error } = await supabase
      .from(MUSIC_TABLE)
      .update({
        storage_path: storagePath,
        original_name: file.name,
        mime_type: contentType,
        file_size_bytes: file.size,
        duration_seconds: analysis.durationSeconds,
        updated_at: new Date().toISOString(),
      })
      .eq("id", track.id)
      .eq("user_id", userId)
      .select("*")
      .single();

    if (error) throw error;
    clearMusicUrlCache(track.id);

    if (track.storage_path && track.storage_path !== storagePath) {
      if (options?.deferOldDelete) {
        deferCleanup(track.storage_path);
      } else {
        try {
          await deleteObject(token, track.storage_path);
        } catch (cleanupError) {
          console.warn("New source is active, but the old R2 object could not be deleted:", cleanupError);
          deferCleanup(track.storage_path);
        }
      }
    }

    return data as MusicTrack;
  } catch (error) {
    await deleteObject(token, storagePath).catch(() => undefined);
    throw error;
  }
}
