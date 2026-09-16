import { supabase } from "./supabase";
import type { MusicTrack } from "./musicStorage";
import type { MvpStemBundle } from "./audio/mvpStemObjectEngine";

export type MusicStemPreparationStatus =
  | "checking"
  | "queued"
  | "processing"
  | "uploading"
  | "ready"
  | "error";

type StemApiResponse = {
  ok?: boolean;
  status?: string;
  predictionId?: string;
  detail?: string;
  error?: string;
  bundle?: Partial<MvpStemBundle>;
};

type StoredPrediction = {
  predictionId: string;
  updatedAt: number;
};

const PREDICTION_STORAGE_KEY = "mvp_music_v6_stem_predictions_v1";
const pendingByTrack = new Map<string, Promise<MvpStemBundle>>();
const readyByTrack = new Map<string, MvpStemBundle>();

function readPredictions(): Record<string, StoredPrediction> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PREDICTION_STORAGE_KEY) || "{}") as Record<string, StoredPrediction>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writePrediction(trackId: string, predictionId: string | null) {
  if (typeof window === "undefined") return;
  const all = readPredictions();
  if (predictionId) all[trackId] = { predictionId, updatedAt: Date.now() };
  else delete all[trackId];
  window.localStorage.setItem(PREDICTION_STORAGE_KEY, JSON.stringify(all));
}

async function accessToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in before preparing Object Audio.");
  return token;
}

async function callStemApi(payload: Record<string, unknown>): Promise<StemApiResponse> {
  const token = await accessToken();
  const response = await fetch("/api/music-stems", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  let body: StemApiResponse = {};
  try {
    body = (await response.json()) as StemApiResponse;
  } catch {
    // status error below
  }

  if (!response.ok) {
    throw new Error(body.error || body.detail || `Object Audio service failed (${response.status}).`);
  }

  return body;
}

function completeBundle(value: Partial<MvpStemBundle> | undefined): value is MvpStemBundle {
  return Boolean(value?.vocals && value?.drums && value?.bass && value?.other);
}

export async function probeMusicStemBundle(track: MusicTrack): Promise<MvpStemBundle | null> {
  const cached = readyByTrack.get(track.id);
  if (cached) return cached;

  const response = await callStemApi({
    action: "probe",
    trackId: track.id,
    storagePath: track.storage_path,
  });

  if (completeBundle(response.bundle)) {
    readyByTrack.set(track.id, response.bundle);
    writePrediction(track.id, null);
    return response.bundle;
  }

  return null;
}

export function clearMusicStemCache(trackId?: string) {
  if (trackId) {
    readyByTrack.delete(trackId);
    pendingByTrack.delete(trackId);
    return;
  }
  readyByTrack.clear();
  pendingByTrack.clear();
}

export function ensureMusicStemBundle(
  track: MusicTrack,
  onStatus?: (status: MusicStemPreparationStatus, detail?: string) => void,
): Promise<MvpStemBundle> {
  const cached = readyByTrack.get(track.id);
  if (cached) return Promise.resolve(cached);

  const running = pendingByTrack.get(track.id);
  if (running) return running;

  const task = (async () => {
    onStatus?.("checking");

    const existing = await probeMusicStemBundle(track).catch(() => null);
    if (existing) {
      onStatus?.("ready");
      return existing;
    }

    const saved = readPredictions()[track.id];
    let predictionId =
      saved && Date.now() - Number(saved.updatedAt || 0) < 24 * 60 * 60 * 1000
        ? saved.predictionId
        : "";

    if (!predictionId) {
      onStatus?.("queued");
      const started = await callStemApi({
        action: "start",
        trackId: track.id,
        storagePath: track.storage_path,
      });

      if (completeBundle(started.bundle)) {
        readyByTrack.set(track.id, started.bundle);
        onStatus?.("ready");
        return started.bundle;
      }

      predictionId = String(started.predictionId || "");
      if (!predictionId) throw new Error(started.error || "Object Audio separation did not start.");
      writePrediction(track.id, predictionId);
    }

    for (let attempt = 0; attempt < 600; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, attempt === 0 ? 1200 : 5000));
      onStatus?.("processing");

      const status = await callStemApi({
        action: "status",
        predictionId,
        trackId: track.id,
        storagePath: track.storage_path,
      });

      if (status.status === "uploading") onStatus?.("uploading");

      if (completeBundle(status.bundle)) {
        readyByTrack.set(track.id, status.bundle);
        writePrediction(track.id, null);
        onStatus?.("ready");
        return status.bundle;
      }

      if (status.status === "failed" || status.status === "canceled" || status.status === "error") {
        writePrediction(track.id, null);
        throw new Error(status.error || status.detail || "Object Audio separation failed.");
      }
    }

    throw new Error("Object Audio is still processing in the background. Try Immersion again in a few minutes.");
  })()
    .catch((error) => {
      onStatus?.("error", error instanceof Error ? error.message : String(error));
      throw error;
    })
    .finally(() => {
      pendingByTrack.delete(track.id);
    });

  pendingByTrack.set(track.id, task);
  return task;
}
