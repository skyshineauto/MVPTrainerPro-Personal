import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../../lib/supabase";
import {
  playWorkoutAlert,
  preloadWorkoutAlerts,
  primeWorkoutAudio,
} from "../../lib/workoutAudio";
import { Card } from "../../ui/Card";
import { PreWorkoutLaunch } from "./PreWorkoutLaunch";
import { CreateExerciseModal, type CreatedExercise } from "../library/CreateExerciseModal";
import {
  effectiveHasMedia,
  getMuscleDetailOptions,
  matchFilters,
  normalizeText,
  resolveRowIcon,
  type EquipKey,
  type MuscleDetailKey,
  type MuscleKey,
  type UserMediaLite,
} from "../../lib/exerciseMatch";
import { AlertIcon, CheckIcon } from "../../lib/exerciseIcons";
import {
  formatSessionLabel,
  inferSymptomKey,
  isSymptomMode,
  type SymptomKey,
} from "../../lib/sessionLabel";
import { sameCanonicalExercise, type CanonicalExerciseDescriptor } from "../../lib/exerciseIdentity";
import { analyzeLiveSet, analyzeProgression } from "../../lib/trainingIntelligence";

import { getMusicPlayerSnapshot } from "../../lib/musicPlayer";
import {
  recordPrSoundtrack,
  setWorkoutMusicContext,
} from "../../lib/musicIntelligence";

import icoDumbbell from "../../assets/dumbbell.png";
import icoRunner from "../../assets/runner.png";
import icoMachine from "../../assets/cable-row-machine.png";

import icoChest from "../../assets/gym.png";
import icoBack from "../../assets/back (2).png";
import icoShoulders from "../../assets/shoulder.png";
import icoCore from "../../assets/human.png";
import icoArms from "../../assets/biceps.png";
import icoLegs from "../../assets/leg.png";
import icoQuads from "../../assets/front.png";
import icoCalves from "../../assets/muscles.png";

const END_WORKOUT_REQUEST_EVENT = "mvp:end-workout-request";
const EDIT_RESULTS_BATCH_SIZE_DESKTOP = 6;
const EDIT_RESULTS_BATCH_SIZE_MOBILE = 5;

function lockDocumentForModal() {
  const appWindow = window as any;
  const existing = appWindow.__mvpTrainerModalLock as
    | { count: number; syncVisualViewport: () => void; releaseRoot: () => void }
    | undefined;

  if (existing) {
    existing.count += 1;
    existing.syncVisualViewport();

    return () => {
      existing.count -= 1;
      if (existing.count <= 0) existing.releaseRoot();
    };
  }

  const body = document.body;
  const html = document.documentElement;
  const scrollY = window.scrollY;
  const viewport = window.visualViewport;

  html.classList.add("tr-modal-open");

  const prevBody = {
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    width: body.style.width,
    height: body.style.height,
    overflow: body.style.overflow,
    overscrollBehavior: body.style.overscrollBehavior,
  };
  const prevHtml = {
    width: html.style.width,
    height: html.style.height,
    overflow: html.style.overflow,
    overscrollBehavior: html.style.overscrollBehavior,
  };

  const syncVisualViewport = () => {
    const height = Math.max(1, Math.round(viewport?.height ?? window.innerHeight));
    const width = Math.max(1, Math.round(viewport?.width ?? window.innerWidth));
    const top = Math.round(viewport?.offsetTop ?? 0);
    const left = Math.round(viewport?.offsetLeft ?? 0);

    html.style.setProperty("--tr-modal-visual-height", `${height}px`);
    html.style.setProperty("--tr-modal-visual-width", `${width}px`);
    html.style.setProperty("--tr-modal-visual-top", `${top}px`);
    html.style.setProperty("--tr-modal-visual-left", `${left}px`);
  };

  syncVisualViewport();

  body.style.position = "fixed";
  body.style.top = `-${scrollY}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.width = "100%";
  body.style.height = "100%";
  body.style.overflow = "hidden";
  body.style.overscrollBehavior = "none";
  html.style.width = "100%";
  html.style.height = "100%";
  html.style.overflow = "hidden";
  html.style.overscrollBehavior = "none";

  let lastTouchX = 0;
  let lastTouchY = 0;

  const onTouchStart = (event: TouchEvent) => {
    const touch = event.touches[0];
    if (!touch) return;
    lastTouchX = touch.clientX;
    lastTouchY = touch.clientY;
  };

  const onTouchMove = (event: TouchEvent) => {
    const touch = event.touches[0];
    if (!touch) return;

    const deltaX = touch.clientX - lastTouchX;
    const deltaY = touch.clientY - lastTouchY;
    lastTouchX = touch.clientX;
    lastTouchY = touch.clientY;

    const target = event.target;
    if (!(target instanceof Element)) {
      event.preventDefault();
      return;
    }

    if (Math.abs(deltaX) > Math.abs(deltaY) && target.closest(".tr-chipRow")) {
      return;
    }

    // Find the first ancestor that can actually scroll vertically.
    // The active-session editor intentionally renders its inner filter/result
    // regions with overflow: visible so the modal body owns the mobile scroll.
    // Using Element.closest() alone can stop on one of those non-scrollable
    // inner regions and incorrectly block the swipe before it reaches the modal.
    let scroller: HTMLElement | null = null;
    let node: Element | null = target;

    while (node) {
      if (
        node instanceof HTMLElement &&
        node.matches(
          ".tr-editCurrentList, .tr-editResultsViewport, .tr-editFilterScroll, .tr-completeGrid, .tr-modalBody"
        )
      ) {
        const style = window.getComputedStyle(node);
        const overflowY = style.overflowY;
        const canScrollY =
          /^(auto|scroll|overlay)$/.test(overflowY) &&
          node.scrollHeight > node.clientHeight + 1;

        if (canScrollY) {
          scroller = node;
          break;
        }
      }

      node = node.parentElement;
    }

    if (!scroller || Math.abs(deltaX) > Math.abs(deltaY)) {
      if (!scroller) event.preventDefault();
      return;
    }

    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);

    const atTop = scroller.scrollTop <= 0;
    const atBottom = scroller.scrollTop >= maxScrollTop - 1;
    const pullingPastTop = atTop && deltaY > 0;
    const pushingPastBottom = atBottom && deltaY < 0;

    if (pullingPastTop || pushingPastBottom) {
      event.preventDefault();
    }
  };

  window.addEventListener("resize", syncVisualViewport);
  viewport?.addEventListener("resize", syncVisualViewport);
  viewport?.addEventListener("scroll", syncVisualViewport);
  document.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
  document.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });

  const releaseRoot = () => {
    window.removeEventListener("resize", syncVisualViewport);
    viewport?.removeEventListener("resize", syncVisualViewport);
    viewport?.removeEventListener("scroll", syncVisualViewport);
    document.removeEventListener("touchstart", onTouchStart, true);
    document.removeEventListener("touchmove", onTouchMove, true);

    body.style.position = prevBody.position;
    body.style.top = prevBody.top;
    body.style.left = prevBody.left;
    body.style.right = prevBody.right;
    body.style.width = prevBody.width;
    body.style.height = prevBody.height;
    body.style.overflow = prevBody.overflow;
    body.style.overscrollBehavior = prevBody.overscrollBehavior;
    html.style.width = prevHtml.width;
    html.style.height = prevHtml.height;
    html.style.overflow = prevHtml.overflow;
    html.style.overscrollBehavior = prevHtml.overscrollBehavior;
    html.classList.remove("tr-modal-open");
    delete appWindow.__mvpTrainerModalLock;
    window.scrollTo(0, scrollY);
  };

  const state = { count: 1, syncVisualViewport, releaseRoot };
  appWindow.__mvpTrainerModalLock = state;

  return () => {
    state.count -= 1;
    if (state.count <= 0) state.releaseRoot();
  };
}

type MediaPack = {
  gif?: string | null;
  video?: string | null;
  poster?: string | null;
  source?: string | null;
};

type ToastTone = "ok" | "err";
type ToastState = { open: boolean; tone: ToastTone; text: string };

function IconImg({ src, alt }: { src: string; alt: string }) {
  return <img src={src} alt={alt} className="tr-ico" loading="lazy" />;
}

function normalizeBuiltMedia(ex: any): MediaPack {
  const m = ex?.media ?? null;
  if (!m || typeof m !== "object") return {};

  const gif = (m.gif as string | undefined) ?? undefined;
  const video = (m.video as string | undefined) ?? undefined;

  let poster =
    (m.poster as string | undefined) ??
    (m.image as string | undefined) ??
    undefined;

  if (!poster && Array.isArray(m.images) && m.images.length > 0) {
    const first = m.images[0];
    if (typeof first === "string") poster = first;
    else if (first && typeof first === "object") {
      poster =
        (first.url as string | undefined) ||
        (first.image as string | undefined) ||
        (first.src as string | undefined);
    }
  }

  return {
    gif: gif ?? null,
    video: video ?? null,
    poster: poster ?? null,
    source: (m.source as string | undefined) ?? "builtin",
  };
}

function resolveMedia(item: any): { gif?: string; video?: string; poster?: string } {
  const m = item?.media ?? item?.exercise?.media ?? null;
  const gif = (m?.gif as string | null) ?? undefined;
  const video = (m?.video as string | null) ?? undefined;
  let poster =
    (m?.poster as string | null) ??
    (m?.image as string | null) ??
    undefined;

  if (!poster) {
    const imgs = m?.images;
    if (Array.isArray(imgs) && imgs.length > 0) {
      if (typeof imgs[0] === "string") poster = imgs[0];
      else if (imgs[0] && typeof imgs[0] === "object") {
        poster =
          (imgs[0].url as string | undefined) ||
          (imgs[0].image as string | undefined) ||
          (imgs[0].src as string | undefined);
      }
    }
  }

  return {
    gif: gif || undefined,
    video: video || undefined,
    poster: poster || undefined,
  };
}

/* MVP_TRAINER_V4_5_4_WORKOUT_INTERNAL_NAV_CONTINUITY
 * Internal workout navigation must stay inside the running React app.
 * Full window.location navigation tears down the live music/Web Audio runtime.
 */
function navigateWithinWorkoutPlayer(to: string) {
  const next = to.length > 1 && to.endsWith("/") ? to.slice(0, -1) : to;

  if (window.location.pathname === next) return;

  window.history.pushState({}, "", next);
  window.dispatchEvent(new Event("popstate"));
}

function MediaOrFallback({ item, exerciseId }: { item: any; exerciseId?: string }) {
  const { gif, video, poster } = resolveMedia(item);
  const [previewOpen, setPreviewOpen] = useState(false);

  const goUpload = () => {
    const exId = exerciseId || item?.id || item?.exercise_id;
    if (!exId) return;
    navigateWithinWorkoutPlayer(`/library/${exId}`);
  };

  const has = !!(video || gif || poster);
  const echoSrc = video || gif || poster || "";
  const mediaKind = video ? "video" : gif ? "gif" : poster ? "image" : "none";

  return (
    <div className="tr-mediaBlock">
      <div className={`tr-mediaStage ${has ? "" : "is-missing"}`}>
        <button className="tr-mediaCtl" onClick={goUpload}>
          {has ? "Media" : "Upload"}
        </button>

        {has ? (
          <>
            <div className="tr-mediaEchoWrap" aria-hidden>
              {video ? (
                <video
                  className="tr-mediaEchoAsset"
                  src={echoSrc}
                  autoPlay
                  loop
                  muted
                  playsInline
                  preload="metadata"
                />
              ) : (
                <img className="tr-mediaEchoAsset" src={echoSrc} alt="" />
              )}
            </div>
            <div className="tr-mediaStageFx" aria-hidden />
            <div className="tr-mediaAmbientGrid" aria-hidden />
          </>
        ) : null}

        <div className="tr-mediaStageInner">
          {has ? (
            <div className={`tr-mediaMount tr-mediaMount--${mediaKind}`}>
              <div className="tr-mediaMountGlow" aria-hidden />
              <div className="tr-mediaMountPlate" aria-hidden />
              <div
                className="tr-mediaMountInner tr-mediaPreviewTrigger"
                role="button"
                tabIndex={0}
                aria-label="Open exercise media full screen"
                onClick={() => setPreviewOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setPreviewOpen(true);
                  }
                }}
              >
                {video ? (
                  <video
                    className="tr-mediaAsset"
                    src={video}
                    autoPlay
                    loop
                    muted
                    playsInline
                    controls={false}
                    preload="metadata"
                  />
                ) : (
                  <img
                    className="tr-mediaAsset"
                    src={gif || poster}
                    alt={`${item?.name ?? "Exercise"} demo`}
                    loading="lazy"
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="tr-mediaEmpty">
              <div className="tr-mediaEmptyTitle">Media missing</div>
              <div className="tr-sub">Upload a GIF, video, or poster for this exercise.</div>
              <button className="tr-btn tr-btn--primary" onClick={goUpload}>
                Upload Media
              </button>
            </div>
          )}
        </div>
      </div>

      {previewOpen && has && typeof document !== "undefined"
        ? createPortal(
            <div
              className="tr-mediaFullscreenOverlay"
              role="presentation"
              onClick={() => setPreviewOpen(false)}
            >
              <div
                className="tr-mediaFullscreenDialog"
                role="dialog"
                aria-modal="true"
                aria-label={`${item?.name ?? "Exercise"} media preview`}
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  className="tr-mediaFullscreenClose"
                  onClick={() => setPreviewOpen(false)}
                  aria-label="Close media preview"
                >
                  CLOSE ×
                </button>

                {video ? (
                  <video
                    className="tr-mediaFullscreenAsset"
                    src={video}
                    autoPlay
                    loop
                    muted
                    playsInline
                    controls
                    preload="metadata"
                  />
                ) : (
                  <img
                    className="tr-mediaFullscreenAsset"
                    src={gif || poster}
                    alt={`${item?.name ?? "Exercise"} demo`}
                  />
                )}
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

type WorkoutExerciseRow = {
  id: string;
  workout_id: string;
  exercise_id: string;
  order_index: number;
  prescription_snapshot: any;
  completed_at?: string | null;
  pain?: number | null;
  difficulty?: "too_easy" | "just_right" | "too_hard" | null;
  exercise?: any;
};

type PreviousSetRow = {
  set_index: number;
  reps: number;
  weight: number;
  rir?: number | null;
  pain?: number | null;
  form?: number | null;
};

type PreviousPerformance = {
  workoutId: string;
  workoutExerciseId: string;
  completedAt: string;
  templateName: string;
  prescriptionSnapshot: any;
  pain: number | null;
  difficulty: "too_easy" | "just_right" | "too_hard" | null;
  sets: PreviousSetRow[];
};

type SearchExerciseRow = {
  id: string;
  name: string;
  source?: string | null;
  primary_muscles?: string[] | null;
  secondary_muscles?: string[] | null;
  equipment?: string[] | null;
  media?: any;
};

type DecoratedSearchRow = SearchExerciseRow & {
  effectiveHasMedia: boolean;
  icon?: string | null;
  iconAlt?: string;
};

function defaultPrescription() {
  return { sets: 3, rep_min: 8, rep_max: 12, rest_seconds: 60, rir_min: 2, rir_max: 3 };
}

function proteinMultiplier(goal: string | null | undefined) {
  const g = (goal || "").toLowerCase();
  if (g === "cut" || g === "lose_weight") return 1.0;
  return 0.9;
}

function roundProtein(g: number) {
  return Math.round(g / 5) * 5;
}

async function loadLatestCompletedBodyWeight(userId: string): Promise<number | null> {
  const { data, error } = await supabase
    .from("workouts")
    .select("bodyweight_lb,completed_at")
    .eq("user_id", userId)
    .not("completed_at", "is", null)
    .not("bodyweight_lb", "is", null)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  const value = Number((data as any)?.bodyweight_lb ?? 0);
  return Number.isFinite(value) && value > 0 ? value : null;
}

async function loadWorkoutExercisesWithExercises(workoutId: string): Promise<WorkoutExerciseRow[]> {
  const { data: wes, error: weErr } = await supabase
    .from("workout_exercises")
    .select("id, workout_id, exercise_id, order_index, prescription_snapshot, completed_at, pain, difficulty")
    .eq("workout_id", workoutId)
    .order("order_index", { ascending: true });

  if (weErr) throw weErr;

  const rows = (wes ?? []) as WorkoutExerciseRow[];
  if (!rows.length) return rows;

  const ids = Array.from(new Set(rows.map((r) => r.exercise_id).filter(Boolean)));
  const { data: exs, error: exErr } = await supabase.from("exercises").select("*").in("id", ids);

  if (exErr) throw exErr;

  const exMap = new Map<string, any>();
  for (const ex of exs ?? []) exMap.set((ex as any).id, ex);

  return rows.map((r) => ({ ...r, exercise: exMap.get(r.exercise_id) || null }));
}

function formatPreviousDate(ts: string | null | undefined) {
  if (!ts) return "Previous workout";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "Previous workout";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatLoggedWeight(weight: number) {
  if (!Number.isFinite(weight)) return "0";
  return Number.isInteger(weight) ? String(weight) : String(Number(weight.toFixed(2)));
}

type SessionIntelligence = {
  weightTrend30: number | null;
  lastSameSession: {
    completedAt: string;
    daysAgo: number;
    durationMinutes: number | null;
    completedSets: number;
    plannedSets: number;
    volume: number;
    volumeDelta: number | null;
  } | null;
  week: {
    completedWorkouts: number;
    trainingMinutes: number;
  };
};

const EMPTY_SESSION_INTELLIGENCE: SessionIntelligence = {
  weightTrend30: null,
  lastSameSession: null,
  week: {
    completedWorkouts: 0,
    trainingMinutes: 0,
  },
};

function normalizedSessionType(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function safeWorkoutDurationMinutes(row: any): number | null {
  const summary = row?.workout_summary ?? {};

  for (const value of [
    summary?.duration_minutes,
    summary?.session_duration_minutes,
    summary?.total_minutes,
    summary?.training_minutes,
  ]) {
    const minutes = Number(value);
    if (Number.isFinite(minutes) && minutes > 0) return Math.max(1, Math.round(minutes));
  }

  for (const value of [
    summary?.duration_seconds,
    summary?.session_duration_seconds,
    summary?.total_seconds,
    summary?.elapsed_seconds,
    summary?.total_time_seconds,
  ]) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.max(1, Math.round(seconds / 60));
    }
  }

  const startedAt = row?.started_at ? new Date(row.started_at).getTime() : NaN;
  const completedAt = row?.completed_at ? new Date(row.completed_at).getTime() : NaN;

  if (Number.isFinite(startedAt) && Number.isFinite(completedAt) && completedAt > startedAt) {
    return Math.max(1, Math.round((completedAt - startedAt) / 60000));
  }

  return null;
}

function localStartOfWeekIso() {
  const now = new Date();
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const start = new Date(now);
  start.setDate(now.getDate() + mondayOffset);
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

function daysSinceLocal(timestamp: string) {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return 0;

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dateStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.max(0, Math.round((todayStart - dateStart) / 86400000));
}

function compactDate(timestamp: string | null | undefined) {
  if (!timestamp) return "";
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }).toUpperCase();
}

function formatMinutesCompact(minutes: number | null | undefined) {
  const safe = Math.max(0, Math.round(Number(minutes ?? 0)));
  if (!safe) return "—";
  if (safe < 60) return `${safe} MIN`;
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return m ? `${h}H ${m}M` : `${h}H`;
}

function formatVolumeLb(value: number | null | undefined) {
  const safe = Math.max(0, Math.round(Number(value ?? 0)));
  return safe ? `${safe.toLocaleString()} LB` : "—";
}

async function loadWorkoutPerformanceSnapshot(workoutId: string) {
  const { data: exerciseRows, error: exerciseError } = await supabase
    .from("workout_exercises")
    .select("id,prescription_snapshot")
    .eq("workout_id", workoutId);

  if (exerciseError) throw exerciseError;

  const exercises = (exerciseRows ?? []) as any[];
  const exerciseIds = exercises.map((row) => String(row.id ?? "")).filter(Boolean);

  let plannedSets = 0;
  for (const row of exercises) {
    const prescription = row?.prescription_snapshot ?? {};
    const timed =
      Number(prescription?.duration_minutes ?? 0) > 0 ||
      Number(prescription?.duration_seconds ?? 0) > 0;

    if (!timed) {
      const count = Number(prescription?.sets ?? 0);
      if (Number.isFinite(count) && count > 0) plannedSets += Math.floor(count);
    }
  }

  if (!exerciseIds.length) {
    return { completedSets: 0, plannedSets, volume: 0 };
  }

  const setRows: any[] = [];
  for (const chunk of chunkValues(exerciseIds)) {
    const { data, error } = await supabase
      .from("workout_sets")
      .select("workout_exercise_id,set_index,reps,weight,rir")
      .in("workout_exercise_id", chunk);

    if (error) throw error;
    setRows.push(...(data ?? []));
  }

  const completedRows = setRows.filter((row) => {
    const reps = Number(row?.reps ?? 0);
    const weight = Number(row?.weight ?? 0);
    return reps > 0 && weight > 0;
  });

  const volume = completedRows.reduce(
    (sum, row) =>
      sum +
      Math.max(0, Number(row?.reps ?? 0)) *
        Math.max(0, Number(row?.weight ?? 0)),
    0
  );

  return {
    completedSets: completedRows.length,
    plannedSets: Math.max(plannedSets, completedRows.length),
    volume,
  };
}

async function loadSessionIntelligence(params: {
  userId: string;
  currentWorkoutId: string;
  currentSessionId: string;
  programBlockId: string | null;
  currentBodyWeight: number | null;
}): Promise<SessionIntelligence> {
  const {
    userId,
    currentWorkoutId,
    currentSessionId,
    programBlockId,
    currentBodyWeight,
  } = params;

  let weightTrend30: number | null = null;

  try {
    const since = new Date();
    since.setDate(since.getDate() - 30);

    const { data: weights, error: weightsError } = await supabase
      .from("workouts")
      .select("bodyweight_lb,completed_at")
      .eq("user_id", userId)
      .not("completed_at", "is", null)
      .not("bodyweight_lb", "is", null)
      .gte("completed_at", since.toISOString())
      .order("completed_at", { ascending: true });

    if (weightsError) throw weightsError;

    const validWeights = (weights ?? [])
      .map((row: any) => Number(row?.bodyweight_lb ?? 0))
      .filter((value) => Number.isFinite(value) && value > 0);

    const reference = validWeights.length ? validWeights[0] : null;
    const latest =
      currentBodyWeight && currentBodyWeight > 0
        ? currentBodyWeight
        : validWeights.length
          ? validWeights[validWeights.length - 1]
          : null;

    if (reference != null && latest != null) {
      weightTrend30 = Number((latest - reference).toFixed(1));
    }
  } catch {
    // Supplemental metric only.
  }

  if (!programBlockId) {
    return { ...EMPTY_SESSION_INTELLIGENCE, weightTrend30 };
  }

  const { data: programSessions, error: programSessionsError } = await supabase
    .from("scheduled_sessions")
    .select("id,session_type")
    .eq("user_id", userId)
    .eq("program_block_id", programBlockId);

  if (programSessionsError) throw programSessionsError;

  const sessions = (programSessions ?? []) as any[];
  const sessionIds = sessions.map((row) => String(row.id ?? "")).filter(Boolean);

  if (!sessionIds.length) {
    return { ...EMPTY_SESSION_INTELLIGENCE, weightTrend30 };
  }

  const currentSession = sessions.find(
    (row) => String(row?.id ?? "") === String(currentSessionId)
  );
  const currentType = normalizedSessionType(currentSession?.session_type);

  const sameSessionIds = new Set(
    sessions
      .filter((row) => {
        if (!currentType) return String(row?.id ?? "") === String(currentSessionId);
        return normalizedSessionType(row?.session_type) === currentType;
      })
      .map((row) => String(row.id))
  );

  const completedWorkouts: any[] = [];
  for (const chunk of chunkValues(sessionIds)) {
    const { data, error } = await supabase
      .from("workouts")
      .select("id,scheduled_session_id,started_at,completed_at,workout_summary")
      .eq("user_id", userId)
      .in("scheduled_session_id", chunk)
      .not("completed_at", "is", null);

    if (error) throw error;
    completedWorkouts.push(...(data ?? []));
  }

  completedWorkouts.sort(
    (a, b) =>
      new Date(String(b?.completed_at ?? 0)).getTime() -
      new Date(String(a?.completed_at ?? 0)).getTime()
  );

  const performanceCache = new Map<
    string,
    Awaited<ReturnType<typeof loadWorkoutPerformanceSnapshot>>
  >();

  const getPerformance = async (row: any) => {
    const id = String(row?.id ?? "");
    const cached = performanceCache.get(id);
    if (cached) return cached;
    const performance = await loadWorkoutPerformanceSnapshot(id);
    performanceCache.set(id, performance);
    return performance;
  };

  const isMeaningfulCompletedWorkout = (
    row: any,
    performance: Awaited<ReturnType<typeof loadWorkoutPerformanceSnapshot>>
  ) => {
    const durationMinutes = safeWorkoutDurationMinutes(row) ?? 0;

    // A completed strength workout must contain real work. This rejects
    // accidentally completed / test / abandoned rows such as 1 min, 0 sets,
    // no volume. Timed-only sessions can still qualify when they contain
    // a meaningful duration and no prescribed strength sets.
    return (
      performance.completedSets > 0 ||
      performance.volume > 0 ||
      (performance.plannedSets === 0 && durationMinutes >= 10)
    );
  };

  const sameSessionWorkouts = completedWorkouts.filter(
    (row) =>
      String(row?.id ?? "") !== String(currentWorkoutId) &&
      sameSessionIds.has(String(row?.scheduled_session_id ?? ""))
  );

  const meaningfulSameSession: Array<{
    row: any;
    performance: Awaited<ReturnType<typeof loadWorkoutPerformanceSnapshot>>;
  }> = [];

  for (const row of sameSessionWorkouts) {
    const performance = await getPerformance(row);
    if (!isMeaningfulCompletedWorkout(row, performance)) continue;
    meaningfulSameSession.push({ row, performance });
    if (meaningfulSameSession.length >= 2) break;
  }

  let lastSameSession: SessionIntelligence["lastSameSession"] = null;

  if (meaningfulSameSession.length) {
    const latest = meaningfulSameSession[0];
    const prior = meaningfulSameSession[1] ?? null;

    lastSameSession = {
      completedAt: String(latest.row.completed_at),
      daysAgo: daysSinceLocal(String(latest.row.completed_at)),
      durationMinutes: safeWorkoutDurationMinutes(latest.row),
      completedSets: latest.performance.completedSets,
      plannedSets: latest.performance.plannedSets,
      volume: latest.performance.volume,
      volumeDelta:
        prior && prior.performance.volume > 0
          ? latest.performance.volume - prior.performance.volume
          : null,
    };
  }

  const weekStart = new Date(localStartOfWeekIso()).getTime();
  const weekCandidates = completedWorkouts.filter((row) => {
    const completed = new Date(String(row?.completed_at ?? 0)).getTime();
    return Number.isFinite(completed) && completed >= weekStart;
  });

  const meaningfulWeekWorkouts: any[] = [];
  for (const row of weekCandidates) {
    const performance = await getPerformance(row);
    if (isMeaningfulCompletedWorkout(row, performance)) {
      meaningfulWeekWorkouts.push(row);
    }
  }

  const weekMinutes = meaningfulWeekWorkouts.reduce(
    (sum, row) => sum + (safeWorkoutDurationMinutes(row) ?? 0),
    0
  );

  return {
    weightTrend30,
    lastSameSession,
    week: {
      completedWorkouts: meaningfulWeekWorkouts.length,
      trainingMinutes: weekMinutes,
    },
  };
}

type CompletedProgramWorkout = {
  id: string;
  scheduled_session_id: string | null;
  completed_at: string;
  workout_summary: any;
};

async function loadCompletedProgramWorkouts(
  userId: string,
  programBlockId: string | null | undefined
): Promise<CompletedProgramWorkout[]> {
  if (!programBlockId) return [];

  const { data: programSessions, error: programSessionsError } = await supabase
    .from("scheduled_sessions")
    .select("id")
    .eq("user_id", userId)
    .eq("program_block_id", programBlockId);

  if (programSessionsError) throw programSessionsError;

  const scheduledSessionIds = (programSessions ?? [])
    .map((row: any) => String(row.id ?? ""))
    .filter(Boolean);

  if (!scheduledSessionIds.length) return [];

  const completed: CompletedProgramWorkout[] = [];

  for (const chunk of chunkValues(scheduledSessionIds)) {
    const { data, error } = await supabase
      .from("workouts")
      .select("id,scheduled_session_id,completed_at,workout_summary")
      .eq("user_id", userId)
      .in("scheduled_session_id", chunk)
      .not("completed_at", "is", null);

    if (error) throw error;

    completed.push(
      ...((data ?? []) as any[]).map((row) => ({
        id: String(row.id),
        scheduled_session_id: row.scheduled_session_id ? String(row.scheduled_session_id) : null,
        completed_at: String(row.completed_at),
        workout_summary: row.workout_summary ?? null,
      }))
    );
  }

  completed.sort(
    (a, b) =>
      new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime()
  );

  return completed;
}

type ProgramExerciseHistoryRow = {
  id: string;
  workout_id: string;
  exercise_id: string;
  prescription_snapshot: any;
  pain: number | null;
  difficulty: PreviousPerformance["difficulty"];
};

async function loadCanonicalProgramExerciseRows(
  exerciseId: string,
  eligibleWorkouts: CompletedProgramWorkout[],
): Promise<{ rows: ProgramExerciseHistoryRow[]; identityRecovered: boolean }> {
  if (!exerciseId || !eligibleWorkouts.length) return { rows: [], identityRecovered: false };

  const allRows: ProgramExerciseHistoryRow[] = [];
  for (const chunk of chunkValues(eligibleWorkouts.map((workout) => workout.id))) {
    const { data, error } = await supabase
      .from("workout_exercises")
      .select("id,workout_id,exercise_id,prescription_snapshot,pain,difficulty")
      .in("workout_id", chunk);
    if (error) throw error;
    allRows.push(...((data ?? []) as any[]).map((row) => ({
      id: String(row.id),
      workout_id: String(row.workout_id),
      exercise_id: String(row.exercise_id),
      prescription_snapshot: row.prescription_snapshot ?? {},
      pain: row.pain == null ? null : Number(row.pain),
      difficulty: (row.difficulty as PreviousPerformance["difficulty"]) ?? null,
    })));
  }

  const exactRows = allRows.filter((row) => row.exercise_id === exerciseId);
  const candidateIds = Array.from(new Set(allRows.map((row) => row.exercise_id).filter(Boolean)));
  if (!candidateIds.length) return { rows: exactRows, identityRecovered: false };

  const metadata = new Map<string, CanonicalExerciseDescriptor>();
  for (const chunk of chunkValues(candidateIds)) {
    const { data, error } = await supabase
      .from("exercises")
      .select("id,name,primary_muscles,equipment")
      .in("id", chunk);
    if (error) throw error;
    for (const row of data ?? []) metadata.set(String((row as any).id), row as CanonicalExerciseDescriptor);
  }

  let current = metadata.get(exerciseId) ?? null;
  if (!current) {
    const { data, error } = await supabase
      .from("exercises")
      .select("id,name,primary_muscles,equipment")
      .eq("id", exerciseId)
      .maybeSingle();
    if (error) throw error;
    current = (data as CanonicalExerciseDescriptor | null) ?? null;
  }
  if (!current) return { rows: exactRows, identityRecovered: false };

  const canonicalIds = new Set<string>([exerciseId]);
  metadata.forEach((candidate, id) => {
    if (sameCanonicalExercise(current!, candidate)) canonicalIds.add(id);
  });
  const rows = allRows.filter((row) => canonicalIds.has(row.exercise_id));
  const identityRecovered = rows.some((row) => row.exercise_id !== exerciseId);
  if (identityRecovered) {
    console.info("MVP progression: recovered same-program exercise history through canonical identity.", {
      exerciseId,
      canonicalExerciseIds: Array.from(canonicalIds),
    });
  }
  return { rows, identityRecovered };
}

async function loadPreviousPerformance(params: {
  exerciseId: string;
  currentWorkoutId: string;
  programBlockId: string | null;
}): Promise<PreviousPerformance | null> {
  const { exerciseId, currentWorkoutId, programBlockId } = params;
  if (!exerciseId || !programBlockId) return null;

  const { data: u, error: uErr } = await supabase.auth.getUser();
  if (uErr) throw uErr;
  if (!u.user) return null;

  const eligibleWorkouts = (await loadCompletedProgramWorkouts(u.user.id, programBlockId))
    .filter((workout) => workout.id !== currentWorkoutId);
  if (!eligibleWorkouts.length) return null;

  const { rows: matchingExercises } = await loadCanonicalProgramExerciseRows(exerciseId, eligibleWorkouts);
  if (!matchingExercises.length) return null;

  const setRows: any[] = [];
  for (const chunk of chunkValues(matchingExercises.map((row) => row.id))) {
    const { data, error } = await supabase
      .from("workout_sets")
      .select("workout_exercise_id,set_index,reps,weight,rir,pain,form")
      .in("workout_exercise_id", chunk)
      .order("set_index", { ascending: true });
    if (error) throw error;
    setRows.push(...(data ?? []));
  }

  const setsByWorkoutExercise = new Map<string, PreviousSetRow[]>();
  for (const raw of setRows) {
    const row: PreviousSetRow = {
      set_index: Number(raw.set_index ?? 0),
      reps: Number(raw.reps ?? 0),
      weight: Number(raw.weight ?? 0),
      rir: raw.rir != null ? Number(raw.rir) : null,
      pain: raw.pain != null ? Number(raw.pain) : null,
      form: raw.form != null ? Number(raw.form) : null,
    };
    if (row.set_index <= 0) continue;
    const key = String(raw.workout_exercise_id);
    const list = setsByWorkoutExercise.get(key) ?? [];
    list.push(row);
    setsByWorkoutExercise.set(key, list);
  }

  // Walk completed workouts newest to oldest until an actual logged performance exists.
  for (const workout of eligibleWorkouts) {
    const candidates = matchingExercises.filter((row) => row.workout_id === workout.id);
    const usable = candidates
      .map((row) => ({ row, sets: (setsByWorkoutExercise.get(row.id) ?? []).slice().sort((a, b) => a.set_index - b.set_index) }))
      .filter((entry) => entry.sets.some((set) => set.weight > 0 && set.reps > 0))
      .sort((a, b) => b.sets.filter((set) => set.weight > 0 && set.reps > 0).length - a.sets.filter((set) => set.weight > 0 && set.reps > 0).length);
    const selected = usable[0];
    if (!selected) continue;

    const summary = workout.workout_summary as any;
    return {
      workoutId: workout.id,
      workoutExerciseId: selected.row.id,
      completedAt: workout.completed_at,
      templateName:
        typeof summary?.template_name === "string" && summary.template_name.trim()
          ? summary.template_name.trim()
          : "Previous workout",
      prescriptionSnapshot: selected.row.prescription_snapshot ?? {},
      pain: selected.row.pain,
      difficulty: selected.row.difficulty,
      sets: selected.sets,
    };
  }

  return null;
}

function previousSetForIndex(previous: PreviousPerformance | null, setIndex: number) {
  if (!previous?.sets.length) return null;
  return previous.sets.find((set) => set.set_index === setIndex) ?? null;
}

function previousWeightForIndex(previous: PreviousPerformance | null, setIndex: number) {
  if (!previous?.sets.length) return 0;
  const exact = previousSetForIndex(previous, setIndex);
  const fallback = previous.sets[previous.sets.length - 1];
  return Number(exact?.weight ?? fallback?.weight ?? 0);
}

type ExerciseHistoryStats = {
  sessions: number;
  bestWeight: number;
  bestSetVolume: number;
  bestEstimated1RM: number;
  bestSessionVolume: number;
  bestSetWeight: number;
  bestSetReps: number;
  maxRepsByWeight: Record<string, number>;
};

type CoachDecision = "BASELINE" | "HOLD" | "PROGRESS" | "MONITOR" | "DELOAD";

type ProgressionGuidance = {
  tone: "first" | "repeat" | "increase" | "review";
  decision: CoachDecision;
  title: string;
  action: string;
  why: string;
  target: string;
  lastSummary: string;
  bestSetSummary: string;
  trend: string;
  suggestedWeight: number | null;
  exactChange: string;
  confidence: "LOW" | "MODERATE" | "HIGH";
  confidenceDetail: string;
  confidenceScore: number;
  rirTarget: string;
  ifTooEasy: string;
  ifTooHard: string;
  progressWhen: string;
  exerciseDirective: string;
  exerciseReason: string;
};

type EffortOption = {
  key: string;
  rir: number | null;
  label: string;
  shortLabel: string;
  detail: string;
};

const EFFORT_OPTIONS: EffortOption[] = [
  { key: "easy", rir: 4, label: "Easy", shortLabel: "Plenty left", detail: "I could have done several more clean reps." },
  { key: "moderate", rir: 3, label: "Moderate", shortLabel: "A few more", detail: "I could have done about three more clean reps." },
  { key: "challenging", rir: 2, label: "Challenging", shortLabel: "Target effort", detail: "I probably had about two clean reps left." },
  { key: "very_hard", rir: 1, label: "Very hard", shortLabel: "Maybe one more", detail: "I might have managed one more clean rep." },
  { key: "maximum", rir: 0, label: "Maximum", shortLabel: "Nothing left", detail: "I could not complete another clean rep." },
  { key: "not_sure", rir: null, label: "Not sure", shortLabel: "Skip estimate", detail: "I cannot judge the effort yet." },
];

function effortOption(rir: number | null | undefined, effortKey?: string | null) {
  if (effortKey) {
    const byKey = EFFORT_OPTIONS.find((option) => option.key === effortKey);
    if (byKey) return byKey;
  }
  if (rir == null) return null;
  return EFFORT_OPTIONS.find((option) => option.rir != null && option.rir === Number(rir)) ?? null;
}

function effortLabel(rir: number | null | undefined, effortKey?: string | null) {
  return effortOption(rir, effortKey)?.label ?? "Not rated";
}

function confidenceForSessions(sessions: number) {
  if (sessions >= 5) return { level: "HIGH" as const, detail: `${sessions} sessions analyzed`, score: 5 };
  if (sessions >= 2) return { level: "MODERATE" as const, detail: `${sessions} sessions analyzed`, score: 3 };
  if (sessions === 1) return { level: "LOW" as const, detail: "1 session analyzed", score: 1 };
  return { level: "LOW" as const, detail: "1 completed session needed", score: 0 };
}

function chunkValues<T>(values: T[], size = 75): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function emptyHistoryStats(): ExerciseHistoryStats {
  return {
    sessions: 0,
    bestWeight: 0,
    bestSetVolume: 0,
    bestEstimated1RM: 0,
    bestSessionVolume: 0,
    bestSetWeight: 0,
    bestSetReps: 0,
    maxRepsByWeight: {},
  };
}

function estimatedOneRepMax(weight: number, reps: number) {
  if (!(weight > 0) || !(reps > 0)) return 0;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

function roundToIncrement(value: number, increment = 5) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.max(increment, Math.round(value / increment) * increment);
}

async function loadExerciseHistoryStats(params: {
  exerciseId: string;
  currentWorkoutId: string;
  programBlockId: string | null;
}): Promise<ExerciseHistoryStats> {
  const { exerciseId, currentWorkoutId, programBlockId } = params;
  if (!exerciseId || !programBlockId) return emptyHistoryStats();

  const { data: u, error: uErr } = await supabase.auth.getUser();
  if (uErr) throw uErr;
  if (!u.user) return emptyHistoryStats();

  const programWorkouts = (await loadCompletedProgramWorkouts(u.user.id, programBlockId))
    .filter((workout) => workout.id !== currentWorkoutId);
  if (!programWorkouts.length) return emptyHistoryStats();

  const { rows: exerciseRows } = await loadCanonicalProgramExerciseRows(exerciseId, programWorkouts);
  if (!exerciseRows.length) return emptyHistoryStats();

  const workoutByExercise = new Map(exerciseRows.map((row) => [row.id, row.workout_id]));
  const setRows: any[] = [];
  for (const chunk of chunkValues(exerciseRows.map((row) => row.id))) {
    const { data, error } = await supabase
      .from("workout_sets")
      .select("workout_exercise_id,set_index,reps,weight")
      .in("workout_exercise_id", chunk);
    if (error) throw error;
    setRows.push(...(data ?? []));
  }

  const stats = emptyHistoryStats();
  const sessionVolumes = new Map<string, number>();
  const usableSessions = new Set<string>();

  for (const row of setRows) {
    const reps = Number(row.reps ?? 0);
    const weight = Number(row.weight ?? 0);
    if (!(reps > 0) || !(weight > 0)) continue;

    const workoutId = workoutByExercise.get(String(row.workout_exercise_id));
    if (workoutId) usableSessions.add(workoutId);
    const volume = reps * weight;
    const e1rm = estimatedOneRepMax(weight, reps);
    const weightKey = String(Number(weight.toFixed(2)));

    stats.bestWeight = Math.max(stats.bestWeight, weight);
    if (e1rm >= stats.bestEstimated1RM) {
      stats.bestSetWeight = weight;
      stats.bestSetReps = reps;
    }
    stats.bestSetVolume = Math.max(stats.bestSetVolume, volume);
    stats.bestEstimated1RM = Math.max(stats.bestEstimated1RM, e1rm);
    stats.maxRepsByWeight[weightKey] = Math.max(stats.maxRepsByWeight[weightKey] ?? 0, reps);

    if (workoutId) sessionVolumes.set(workoutId, (sessionVolumes.get(workoutId) ?? 0) + volume);
  }

  stats.sessions = usableSessions.size;
  stats.bestSessionVolume = Math.max(0, ...Array.from(sessionVolumes.values()));
  return stats;
}

function detectPersonalRecords(
  set: { reps: number; weight: number },
  history: ExerciseHistoryStats
) {
  const reps = Number(set.reps ?? 0);
  const weight = Number(set.weight ?? 0);
  if (!(reps > 0) || !(weight > 0) || history.sessions <= 0) return [] as string[];

  const labels: string[] = [];
  const volume = reps * weight;
  const e1rm = estimatedOneRepMax(weight, reps);
  const priorReps = history.maxRepsByWeight[String(Number(weight.toFixed(2)))] ?? 0;

  if (weight > history.bestWeight) labels.push("HEAVIEST WEIGHT PR");
  if (reps > priorReps) labels.push("REP PR AT THIS WEIGHT");
  if (volume > history.bestSetVolume) labels.push("SET VOLUME PR");
  if (e1rm > history.bestEstimated1RM) labels.push("ESTIMATED STRENGTH PR");

  return labels;
}

type PersonalRecordDetail = {
  key: "weight" | "reps" | "set_volume" | "strength" | "session_volume";
  label: string;
  previous: string;
  current: string;
  improvement: string;
};

type PersonalRecordCelebrationState = {
  id: string;
  exerciseName: string;
  setNumber: number;
  weight: number;
  reps: number;
  records: PersonalRecordDetail[];
};

function buildPersonalRecordDetails(params: {
  set: { reps: number; weight: number };
  history: ExerciseHistoryStats;
  priorCompletedSets: Array<{ reps: number; weight: number }>;
}): PersonalRecordDetail[] {
  const { set, history, priorCompletedSets } = params;
  const reps = Number(set.reps ?? 0);
  const weight = Number(set.weight ?? 0);

  // The first completed session establishes the baseline. Do not manufacture
  // "PRs" when there is no prior completed history to beat.
  if (!(reps > 0) || !(weight > 0) || history.sessions <= 0) return [];

  const validPrior = priorCompletedSets.filter(
    (row) => Number(row.reps) > 0 && Number(row.weight) > 0
  );

  const currentVolume = reps * weight;
  const currentE1rm = estimatedOneRepMax(weight, reps);
  const weightKey = String(Number(weight.toFixed(2)));

  const priorLiveBestWeight = Math.max(
    Number(history.bestWeight ?? 0),
    ...validPrior.map((row) => Number(row.weight ?? 0))
  );

  const priorLiveRepsAtWeight = Math.max(
    Number(history.maxRepsByWeight[weightKey] ?? 0),
    ...validPrior
      .filter((row) => Number(row.weight) === weight)
      .map((row) => Number(row.reps ?? 0))
  );

  const priorLiveBestSetVolume = Math.max(
    Number(history.bestSetVolume ?? 0),
    ...validPrior.map((row) => Number(row.reps ?? 0) * Number(row.weight ?? 0))
  );

  const priorLiveBestE1rm = Math.max(
    Number(history.bestEstimated1RM ?? 0),
    ...validPrior.map((row) =>
      estimatedOneRepMax(Number(row.weight ?? 0), Number(row.reps ?? 0))
    )
  );

  const priorSessionVolume = validPrior.reduce(
    (sum, row) => sum + Number(row.reps ?? 0) * Number(row.weight ?? 0),
    0
  );
  const currentSessionVolume = priorSessionVolume + currentVolume;

  const records: PersonalRecordDetail[] = [];

  if (weight > priorLiveBestWeight) {
    records.push({
      key: "weight",
      label: "HEAVIEST WEIGHT",
      previous: `${formatLoggedWeight(priorLiveBestWeight)} lb`,
      current: `${formatLoggedWeight(weight)} lb`,
      improvement: `+${formatLoggedWeight(weight - priorLiveBestWeight)} lb`,
    });
  }

  if (reps > priorLiveRepsAtWeight) {
    records.push({
      key: "reps",
      label: "REP PR AT THIS WEIGHT",
      previous:
        priorLiveRepsAtWeight > 0
          ? `${priorLiveRepsAtWeight} reps @ ${formatLoggedWeight(weight)} lb`
          : `No prior reps @ ${formatLoggedWeight(weight)} lb`,
      current: `${reps} reps @ ${formatLoggedWeight(weight)} lb`,
      improvement:
        priorLiveRepsAtWeight > 0
          ? `+${reps - priorLiveRepsAtWeight} rep${reps - priorLiveRepsAtWeight === 1 ? "" : "s"}`
          : "NEW WEIGHT / REP MARK",
    });
  }

  if (currentVolume > priorLiveBestSetVolume) {
    records.push({
      key: "set_volume",
      label: "SET VOLUME",
      previous: `${Math.round(priorLiveBestSetVolume).toLocaleString()} lb`,
      current: `${Math.round(currentVolume).toLocaleString()} lb`,
      improvement: `+${Math.round(currentVolume - priorLiveBestSetVolume).toLocaleString()} lb`,
    });
  }

  if (currentE1rm > priorLiveBestE1rm) {
    records.push({
      key: "strength",
      label: "ESTIMATED STRENGTH",
      previous: `${formatLoggedWeight(Number(priorLiveBestE1rm.toFixed(1)))} lb e1RM`,
      current: `${formatLoggedWeight(Number(currentE1rm.toFixed(1)))} lb e1RM`,
      improvement: `+${formatLoggedWeight(Number((currentE1rm - priorLiveBestE1rm).toFixed(1)))} lb`,
    });
  }

  // Celebrate session-volume history only once: exactly when today's exercise
  // volume crosses the previous completed-session record.
  if (
    Number(history.bestSessionVolume ?? 0) > 0 &&
    priorSessionVolume <= Number(history.bestSessionVolume) &&
    currentSessionVolume > Number(history.bestSessionVolume)
  ) {
    records.push({
      key: "session_volume",
      label: "EXERCISE SESSION VOLUME",
      previous: `${Math.round(history.bestSessionVolume).toLocaleString()} lb`,
      current: `${Math.round(currentSessionVolume).toLocaleString()} lb`,
      improvement: `+${Math.round(currentSessionVolume - history.bestSessionVolume).toLocaleString()} lb`,
    });
  }

  return records;
}

function PersonalRecordOverlay({
  celebration,
  onClose,
}: {
  celebration: PersonalRecordCelebrationState | null;
  onClose: () => void;
}) {
  if (!celebration || typeof document === "undefined") return null;

  const count = celebration.records.length;
  const headline = count > 1 ? `${count} RECORDS BROKEN` : "NEW PERSONAL RECORD";

  return createPortal(
    <div
      className="tr-prOverlay"
      role="presentation"
      onClick={onClose}
    >
      <section
        className="tr-prCelebration"
        role="status"
        aria-live="assertive"
        aria-label={`${headline} for ${celebration.exerciseName}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="tr-prHalo" aria-hidden />
        <div className="tr-prTopLine" aria-hidden />

        <header className="tr-prHeader">
          <div className="tr-prMark" aria-hidden>PR</div>
          <div className="tr-prHeaderCopy">
            <span>PERFORMANCE MILESTONE</span>
            <strong>{headline}</strong>
          </div>
          <button
            type="button"
            className="tr-prClose"
            onClick={onClose}
            aria-label="Dismiss personal record celebration"
          >
            ×
          </button>
        </header>

        <div className="tr-prHero">
          <span>{celebration.exerciseName}</span>
          <strong>
            {formatLoggedWeight(celebration.weight)} LB
            <small> × </small>
            {celebration.reps} REPS
          </strong>
          <small>SET {celebration.setNumber} • VERIFIED AGAINST COMPLETED PROGRAM HISTORY</small>
        </div>

        <div className="tr-prRecordGrid">
          {celebration.records.map((record) => (
            <article key={record.key} className="tr-prRecord">
              <div className="tr-prRecordLabel">{record.label}</div>

              <div className="tr-prCompare">
                <div>
                  <span>PREVIOUS BEST</span>
                  <strong>{record.previous}</strong>
                </div>
                <div className="tr-prArrow" aria-hidden>→</div>
                <div>
                  <span>NEW BEST</span>
                  <strong>{record.current}</strong>
                </div>
              </div>

              <div className="tr-prImprovement">{record.improvement}</div>
            </article>
          ))}
        </div>

        <footer className="tr-prFooter">
          <span>RECORDED TO YOUR PERFORMANCE HISTORY</span>
          <strong>TAP ANYWHERE TO DISMISS</strong>
        </footer>

        <div className="tr-prAutoDismiss" aria-hidden>
          <span />
        </div>
      </section>

      <style>{`
        .tr-prOverlay{
          position:fixed;
          inset:0;
          z-index:18000;
          display:grid;
          place-items:center;
          padding:18px;
          background:rgba(0,0,0,.58);
          backdrop-filter:blur(8px);
          -webkit-backdrop-filter:blur(8px);
          animation:trPrOverlayIn .18s ease-out both;
        }
        .tr-prCelebration{
          position:relative;
          width:min(760px,100%);
          overflow:hidden;
          border:1px solid rgba(255,200,80,.48);
          border-radius:26px;
          background:
            radial-gradient(700px 280px at 50% -15%,rgba(255,182,46,.18),transparent 64%),
            radial-gradient(500px 240px at 100% 100%,rgba(0,174,255,.09),transparent 70%),
            linear-gradient(180deg,rgba(16,19,24,.995),rgba(5,8,12,.998));
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.08),
            0 34px 110px rgba(0,0,0,.72),
            0 0 50px rgba(255,168,34,.15);
          animation:trPrCardIn .34s cubic-bezier(.18,.86,.25,1.04) both;
        }
        .tr-prHalo{
          position:absolute;
          width:380px;
          height:200px;
          left:50%;
          top:-95px;
          transform:translateX(-50%);
          border-radius:50%;
          background:radial-gradient(circle,rgba(255,195,72,.30),transparent 70%);
          filter:blur(26px);
          pointer-events:none;
        }
        .tr-prTopLine{
          position:absolute;
          left:10%;
          right:10%;
          top:0;
          height:2px;
          background:linear-gradient(90deg,transparent,#ffd76b,transparent);
          box-shadow:0 0 20px rgba(255,205,92,.42);
        }
        .tr-prHeader{
          position:relative;
          z-index:2;
          display:grid;
          grid-template-columns:58px minmax(0,1fr) 42px;
          align-items:center;
          gap:13px;
          padding:20px 22px 16px;
          border-bottom:1px solid rgba(255,255,255,.075);
        }
        .tr-prMark{
          width:58px;
          height:58px;
          display:grid;
          place-items:center;
          border:1px solid rgba(255,205,96,.58);
          border-radius:18px;
          color:#161006;
          background:linear-gradient(180deg,#ffe28a,#f3a51f);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.72),
            0 10px 26px rgba(0,0,0,.38),
            0 0 22px rgba(255,175,32,.19);
          font-size:18px;
          font-weight:1100;
          letter-spacing:.04em;
        }
        .tr-prHeaderCopy{
          min-width:0;
          display:grid;
          gap:4px;
        }
        .tr-prHeaderCopy span{
          color:#6edfff;
          font-size:8px;
          font-weight:1050;
          letter-spacing:.20em;
        }
        .tr-prHeaderCopy strong{
          color:#fff0b4;
          font-size:clamp(21px,3vw,31px);
          line-height:1;
          font-weight:1100;
          letter-spacing:-.025em;
          text-shadow:0 0 22px rgba(255,190,52,.15);
        }
        .tr-prClose{
          width:42px;
          height:42px;
          display:grid;
          place-items:center;
          border:1px solid rgba(255,255,255,.11);
          border-radius:13px;
          color:rgba(240,246,250,.78);
          background:rgba(255,255,255,.035);
          font-size:24px;
          cursor:pointer;
        }
        .tr-prHero{
          position:relative;
          z-index:2;
          padding:22px 22px 17px;
          display:grid;
          justify-items:center;
          gap:8px;
          text-align:center;
        }
        .tr-prHero>span{
          color:rgba(211,230,240,.72);
          font-size:12px;
          font-weight:1000;
          letter-spacing:.055em;
        }
        .tr-prHero>strong{
          color:#fff;
          font-size:clamp(35px,6vw,58px);
          line-height:.95;
          font-weight:1150;
          letter-spacing:-.04em;
          font-variant-numeric:tabular-nums;
          text-shadow:
            0 3px 0 rgba(0,0,0,.72),
            0 0 28px rgba(255,185,46,.14);
        }
        .tr-prHero>strong small{
          color:#ffd166;
          font:inherit;
        }
        .tr-prHero>small{
          color:rgba(150,186,203,.56);
          font-size:7px;
          font-weight:1000;
          letter-spacing:.12em;
        }
        .tr-prRecordGrid{
          position:relative;
          z-index:2;
          display:grid;
          grid-template-columns:repeat(2,minmax(0,1fr));
          gap:10px;
          padding:0 18px 18px;
        }
        .tr-prRecord{
          min-width:0;
          padding:14px;
          display:grid;
          gap:11px;
          border:1px solid rgba(255,255,255,.085);
          border-radius:16px;
          background:
            linear-gradient(180deg,rgba(255,255,255,.045),rgba(0,0,0,.13)),
            rgba(4,8,12,.88);
          box-shadow:inset 0 1px 0 rgba(255,255,255,.04);
        }
        .tr-prRecordLabel{
          color:#ffd26b;
          font-size:9px;
          font-weight:1100;
          letter-spacing:.13em;
        }
        .tr-prCompare{
          display:grid;
          grid-template-columns:minmax(0,1fr) 24px minmax(0,1fr);
          align-items:center;
          gap:7px;
        }
        .tr-prCompare>div:not(.tr-prArrow){
          min-width:0;
          display:grid;
          gap:4px;
        }
        .tr-prCompare span{
          color:rgba(148,177,192,.50);
          font-size:6px;
          font-weight:1000;
          letter-spacing:.11em;
        }
        .tr-prCompare strong{
          min-width:0;
          color:rgba(238,246,249,.92);
          font-size:12px;
          line-height:1.22;
          font-weight:1000;
          overflow-wrap:anywhere;
        }
        .tr-prCompare>div:last-child strong{color:#fff7d5}
        .tr-prArrow{
          color:#5fdcff;
          font-size:17px;
          text-align:center;
        }
        .tr-prImprovement{
          width:max-content;
          max-width:100%;
          padding:5px 8px;
          border:1px solid rgba(77,225,139,.28);
          border-radius:999px;
          color:#82efa8;
          background:rgba(34,174,94,.09);
          font-size:8px;
          font-weight:1100;
          letter-spacing:.08em;
        }
        .tr-prFooter{
          position:relative;
          z-index:2;
          display:flex;
          justify-content:space-between;
          gap:12px;
          padding:13px 18px 15px;
          border-top:1px solid rgba(255,255,255,.065);
          color:rgba(137,171,186,.52);
          font-size:7px;
          font-weight:1000;
          letter-spacing:.10em;
        }
        .tr-prFooter strong{color:rgba(207,224,233,.66)}
        .tr-prAutoDismiss{
          height:3px;
          background:rgba(255,255,255,.045);
        }
        .tr-prAutoDismiss span{
          display:block;
          width:100%;
          height:100%;
          transform-origin:left;
          background:linear-gradient(90deg,#f3a61f,#ffe27e);
          animation:trPrDismiss 5.2s linear forwards;
        }
        @keyframes trPrOverlayIn{
          from{opacity:0}
          to{opacity:1}
        }
        @keyframes trPrCardIn{
          from{opacity:0;transform:translateY(18px) scale(.975)}
          to{opacity:1;transform:translateY(0) scale(1)}
        }
        @keyframes trPrDismiss{
          from{transform:scaleX(1)}
          to{transform:scaleX(0)}
        }
        @media(max-width:700px){
          .tr-prOverlay{
            align-items:end;
            padding:12px 12px calc(90px + env(safe-area-inset-bottom));
            backdrop-filter:blur(6px);
            -webkit-backdrop-filter:blur(6px);
          }
          .tr-prCelebration{
            width:100%;
            max-height:calc(100dvh - 116px);
            overflow:auto;
            border-radius:24px;
          }
          .tr-prHeader{
            grid-template-columns:50px minmax(0,1fr) 38px;
            gap:10px;
            padding:16px 15px 13px;
          }
          .tr-prMark{width:50px;height:50px;border-radius:15px;font-size:16px}
          .tr-prClose{width:38px;height:38px;border-radius:11px}
          .tr-prHeaderCopy span{font-size:7px}
          .tr-prHeaderCopy strong{font-size:20px}
          .tr-prHero{padding:18px 14px 14px}
          .tr-prHero>span{font-size:11px}
          .tr-prHero>strong{font-size:clamp(34px,11vw,48px)}
          .tr-prHero>small{font-size:6px;letter-spacing:.08em}
          .tr-prRecordGrid{grid-template-columns:1fr;padding:0 12px 13px;gap:8px}
          .tr-prRecord{padding:12px;border-radius:14px}
          .tr-prCompare strong{font-size:11px}
          .tr-prFooter{
            align-items:flex-start;
            flex-direction:column;
            gap:4px;
            padding:11px 13px 13px;
          }
        }
      `}</style>
    </div>,
    document.body
  );
}

function progressionGuidance(
  previous: PreviousPerformance | null,
  history: ExerciseHistoryStats,
  repMin: number,
  repMax: number,
  setsTarget: number,
  exercise: any,
  goal?: string | null
): ProgressionGuidance {
  const confidence = confidenceForSessions(history.sessions);
  const bestSetSummary =
    history.bestSetWeight > 0 && history.bestSetReps > 0
      ? `${formatLoggedWeight(history.bestSetWeight)} lb × ${history.bestSetReps}`
      : "No data yet";

  const analysis = analyzeProgression({
    goal,
    sessions: previous?.sets?.length
      ? [{ sets: previous.sets, pain: previous.pain, difficulty: previous.difficulty, completedAt: previous.completedAt }]
      : [],
    repMin,
    repMax,
    setsTarget,
    exercise,
    usableSessionCount: history.sessions,
  });

  const decision: CoachDecision =
    analysis.action === "INCREASE" ? "PROGRESS" :
    analysis.action === "REDUCE" || analysis.action === "RECOVERY" ? "DELOAD" :
    analysis.action === "MONITOR" ? "MONITOR" :
    analysis.action === "BASELINE" ? "BASELINE" : "HOLD";

  const suggested = analysis.suggestedWeight;
  const current = analysis.currentWeight;
  const delta = suggested != null && current != null ? suggested - current : 0;
  const tone: ProgressionGuidance["tone"] =
    decision === "PROGRESS" ? "increase" :
    decision === "DELOAD" ? "review" :
    decision === "BASELINE" ? "first" : "repeat";

  return {
    tone,
    decision,
    title:
      analysis.action === "INCREASE" ? "Ready to progress" :
      analysis.action === "REDUCE" ? "Reduce and rebuild quality reps" :
      analysis.action === "RECOVERY" ? "Recovery overrides progression" :
      analysis.action === "MONITOR" ? "Monitor this working load" :
      analysis.action === "HOLD" ? "Own the current weight" :
      "Establish your baseline",
    action:
      analysis.action === "INCREASE" && suggested ? `INCREASE TO ${formatLoggedWeight(suggested)} LB` :
      analysis.action === "REDUCE" && suggested ? `REDUCE TO ${formatLoggedWeight(suggested)} LB` :
      analysis.action === "RECOVERY" ? (suggested ? `HOLD / REDUCE TO ${formatLoggedWeight(suggested)} LB` : "STOP OR SWAP THE EXERCISE") :
      analysis.action === "HOLD" || analysis.action === "MONITOR" ? `HOLD AT ${formatLoggedWeight(current ?? 0)} LB` :
      "CHOOSE A CONTROLLED STARTING WEIGHT",
    why: analysis.reason,
    target: analysis.nextTarget,
    lastSummary: analysis.lastSummary,
    bestSetSummary,
    trend: history.sessions <= 1 ? "Building" : analysis.action === "INCREASE" ? "Improving" : analysis.action === "REDUCE" || analysis.action === "RECOVERY" ? "Needs review" : "Building capacity",
    suggestedWeight: suggested,
    exactChange:
      delta > 0 ? `+${formatLoggedWeight(delta)} LB` :
      delta < 0 ? `−${formatLoggedWeight(Math.abs(delta))} LB` :
      analysis.action === "BASELINE" ? "FIRST SESSION" : "NO LOAD CHANGE",
    confidence: confidence.level,
    confidenceDetail: confidence.detail,
    confidenceScore: confidence.score,
    rirTarget: analysis.rirTarget,
    ifTooEasy: analysis.ifTooEasy,
    ifTooHard: analysis.ifTooHard,
    progressWhen: analysis.progressWhen,
    exerciseDirective: analysis.exerciseDirective,
    exerciseReason: analysis.exerciseReason,
  };

}

type LiveSetAdvice = {
  status: string;
  tone: "good" | "hold" | "monitor" | "reduce" | "increase";
  summary: string;
  nextInstruction: string;
  nextWeight: number;
};

function buildLiveSetAdvice(params: {
  set: any | null;
  exercise: any;
  repMin: number;
  repMax: number;
}) : LiveSetAdvice | null {
  const { set, exercise, repMin, repMax } = params;
  if (!set) return null;

  const weight = Number(set.weight ?? 0);
  const reps = Number(set.reps ?? 0);
  const selectedEffort = effortOption(set.rir, set.effort_key);
  const rir = selectedEffort?.rir ?? null;
  const summary = `${formatLoggedWeight(weight)} lb × ${reps} reps • ${effortLabel(set.rir, set.effort_key)}`;
  const result = analyzeLiveSet({ set: { weight, reps, rir }, exercise, repMin, repMax });

  return {
    status: result.status,
    tone: result.tone,
    summary,
    nextInstruction: `${result.instruction} Rest 60 seconds.`,
    nextWeight: result.nextWeight,
  };

}

async function buildUserUploadMediaMap(exerciseIds: string[]): Promise<Record<string, MediaPack>> {
  if (!exerciseIds.length) return {};

  const { data: u, error: uErr } = await supabase.auth.getUser();
  if (uErr) throw uErr;
  if (!u.user) return {};

  const { data: rows, error } = await supabase
    .from("exercise_user_media")
    .select("exercise_id, kind, storage_path, use_user_upload")
    .eq("user_id", u.user.id)
    .in("exercise_id", exerciseIds);

  if (error) throw error;

  const enabledSet = new Set<string>();
  for (const r of rows ?? []) {
    if ((r as any).use_user_upload === true) enabledSet.add((r as any).exercise_id);
  }

  const map: Record<string, MediaPack> = {};
  for (const r of rows ?? []) {
    const exId = (r as any).exercise_id as string;
    if (!enabledSet.has(exId)) continue;

    const kind = (r as any).kind as "gif" | "video" | "poster";
    const path = (r as any).storage_path as string;
    if (!path) continue;

    const pub = supabase.storage.from("exercise-media").getPublicUrl(path);
    const url = pub?.data?.publicUrl || null;
    if (!url) continue;

    map[exId] = map[exId] ?? { source: "user_upload" };
    if (kind === "gif") map[exId].gif = url;
    if (kind === "video") map[exId].video = url;
    if (kind === "poster") map[exId].poster = url;
    map[exId].source = "user_upload";
  }

  return map;
}

function effectiveMediaForExercise(params: {
  exercise: any;
  exerciseId: string;
  rpcMediaMap: Record<string, MediaPack>;
  userUploadMap: Record<string, MediaPack>;
}): MediaPack {
  const { exercise, exerciseId, rpcMediaMap, userUploadMap } = params;
  const rpcM = rpcMediaMap[exerciseId];
  if (rpcM && (rpcM.gif || rpcM.video || rpcM.poster)) return rpcM;
  const upM = userUploadMap[exerciseId];
  if (upM && (upM.gif || upM.video || upM.poster)) return upM;
  return normalizeBuiltMedia(exercise);
}

function Toast({ toast, onClose }: { toast: ToastState; onClose: () => void }) {
  if (!toast.open) return null;

  return (
    <div
      style={{
        position: "fixed",
        right: 18,
        bottom: 86,
        zIndex: 10001,
        width: "min(520px, calc(100vw - 36px))",
      }}
    >
      <div
        className="tr-rowbox"
        style={{
          borderColor: toast.tone === "ok" ? "rgba(0,170,255,.45)" : "rgba(255,80,80,.45)",
          background: toast.tone === "ok" ? "rgba(0,170,255,.12)" : "rgba(255,80,80,.12)",
          fontWeight: 950,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div style={{ lineHeight: 1.25 }}>{toast.text}</div>
        <button className="tr-seg" style={{ height: 36 }} onClick={onClose}>
          OK
        </button>
      </div>
    </div>
  );
}

type RestTimerStatus = "idle" | "running" | "finished";

type RestTimerState = {
  status: RestTimerStatus;
  totalSeconds: number;
  remainingSeconds: number;
  deadlineMs: number | null;
  finishedAtMs: number | null;
  exerciseName: string;
  setIndex: number | null;
  nextSetNumber: number | null;
  totalSets: number | null;
  nextInstruction: string;
};

type RestTimerController = RestTimerState & {
  start: (
    seconds: number,
    exerciseName: string,
    completedSetIndex: number,
    nextSetNumber?: number,
    totalSets?: number,
    nextInstruction?: string
  ) => void;
  addSeconds: (seconds: number) => void;
  skip: () => void;
};

const REST_TIMER_STORAGE_KEY = "mvp_rest_timer_v3";
const REST_COMPLETE_VISIBLE_MS = 1400;

function emptyRestTimer(): RestTimerState {
  return {
    status: "idle",
    totalSeconds: 0,
    remainingSeconds: 0,
    deadlineMs: null,
    finishedAtMs: null,
    exerciseName: "",
    setIndex: null,
    nextSetNumber: null,
    totalSets: null,
    nextInstruction: "",
  };
}

function readStoredRestTimer(): RestTimerState {
  const idle = emptyRestTimer();
  if (typeof window === "undefined") return idle;

  try {
    const raw =
      localStorage.getItem(REST_TIMER_STORAGE_KEY) ??
      localStorage.getItem("mvp_rest_timer_v2") ??
      localStorage.getItem("mvp_rest_timer_v1");

    if (!raw) return idle;

    const parsed = JSON.parse(raw) as Partial<RestTimerState>;
    if (!parsed || !parsed.status) return idle;

    const normalized: RestTimerState = {
      ...idle,
      ...parsed,
      status:
        parsed.status === "running" || parsed.status === "finished"
          ? parsed.status
          : "idle",
    };

    if (normalized.status === "running" && normalized.deadlineMs) {
      const remaining = Math.max(
        0,
        Math.ceil((normalized.deadlineMs - Date.now()) / 1000)
      );

      if (remaining > 0) {
        return { ...normalized, remainingSeconds: remaining };
      }

      return {
        ...normalized,
        status: "finished",
        remainingSeconds: 0,
        deadlineMs: null,
        finishedAtMs: Date.now(),
      };
    }

    if (normalized.status === "finished") {
      const finishedAt = Number(normalized.finishedAtMs ?? 0);
      if (
        finishedAt > 0 &&
        Date.now() - finishedAt >= REST_COMPLETE_VISIBLE_MS
      ) {
        return idle;
      }

      return {
        ...normalized,
        remainingSeconds: 0,
        deadlineMs: null,
        finishedAtMs: finishedAt > 0 ? finishedAt : Date.now(),
      };
    }

    return normalized;
  } catch {
    return idle;
  }
}

function useRestTimer(): RestTimerController {
  const [timer, setTimer] = useState<RestTimerState>(() => readStoredRestTimer());
  const alertedRef = useRef(false);

  useEffect(() => {
    try {
      localStorage.removeItem("mvp_rest_timer_v1");
      localStorage.removeItem("mvp_rest_timer_v2");

      if (timer.status === "idle") {
        localStorage.removeItem(REST_TIMER_STORAGE_KEY);
      } else {
        localStorage.setItem(REST_TIMER_STORAGE_KEY, JSON.stringify(timer));
      }
    } catch {
      // Persistence is helpful, but the timer still works without it.
    }
  }, [timer]);

  useEffect(() => {
    if (timer.status !== "running" || !timer.deadlineMs) return;

    const updateFromDeadline = () => {
      setTimer((current) => {
        if (current.status !== "running" || !current.deadlineMs) return current;

        const remaining = Math.max(
          0,
          Math.ceil((current.deadlineMs - Date.now()) / 1000)
        );

        if (remaining <= 0) {
          return {
            ...current,
            status: "finished",
            remainingSeconds: 0,
            deadlineMs: null,
            finishedAtMs: Date.now(),
          };
        }

        if (remaining === current.remainingSeconds) return current;
        return { ...current, remainingSeconds: remaining };
      });
    };

    updateFromDeadline();
    const intervalId = window.setInterval(updateFromDeadline, 200);
    const onVisibilityOrFocus = () => updateFromDeadline();

    document.addEventListener("visibilitychange", onVisibilityOrFocus);
    window.addEventListener("focus", onVisibilityOrFocus);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityOrFocus);
      window.removeEventListener("focus", onVisibilityOrFocus);
    };
  }, [timer.status, timer.deadlineMs]);

  useEffect(() => {
    if (timer.status === "running") {
      alertedRef.current = false;
      return;
    }

    if (timer.status !== "finished") return;

    if (!alertedRef.current) {
      alertedRef.current = true;
      void playWorkoutAlert("rest_complete");
    }

    const finishedAt = Number(timer.finishedAtMs ?? Date.now());
    const remainingVisibleMs = Math.max(
      0,
      REST_COMPLETE_VISIBLE_MS - (Date.now() - finishedAt)
    );

    if (remainingVisibleMs <= 0) {
      setTimer(emptyRestTimer());
      return;
    }

    const dismissId = window.setTimeout(() => {
      setTimer(emptyRestTimer());
    }, remainingVisibleMs);

    return () => window.clearTimeout(dismissId);
  }, [timer.status, timer.finishedAtMs]);

  const start = (
    seconds: number,
    exerciseName: string,
    completedSetIndex: number,
    nextSetNumber?: number,
    totalSets?: number,
    nextInstruction?: string
  ) => {
    const total = Math.max(1, Math.floor(Number(seconds) || 0));

    primeWorkoutAudio();
    alertedRef.current = false;

    setTimer({
      status: "running",
      totalSeconds: total,
      remainingSeconds: total,
      deadlineMs: Date.now() + total * 1000,
      finishedAtMs: null,
      exerciseName,
      setIndex: completedSetIndex,
      nextSetNumber:
        Number.isFinite(Number(nextSetNumber)) && Number(nextSetNumber) > 0
          ? Number(nextSetNumber)
          : completedSetIndex + 1,
      totalSets:
        Number.isFinite(Number(totalSets)) && Number(totalSets) > 0
          ? Number(totalSets)
          : null,
      nextInstruction: String(nextInstruction ?? "").trim(),
    });
  };

  const addSeconds = (seconds: number) => {
    setTimer((current) => {
      if (current.status !== "running") return current;

      const currentRemaining = current.deadlineMs
        ? Math.max(0, Math.ceil((current.deadlineMs - Date.now()) / 1000))
        : current.remainingSeconds;

      const nextRemaining = Math.max(0, currentRemaining + seconds);

      if (nextRemaining <= 0) {
        return {
          ...current,
          status: "finished",
          remainingSeconds: 0,
          deadlineMs: null,
          finishedAtMs: Date.now(),
        };
      }

      return {
        ...current,
        remainingSeconds: nextRemaining,
        deadlineMs: Date.now() + nextRemaining * 1000,
        finishedAtMs: null,
      };
    });
  };

  const skip = () => {
    alertedRef.current = false;
    setTimer(emptyRestTimer());
  };

  return { ...timer, start, addSeconds, skip };
}

function formatRestClock(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function RestTimerDock({ timer }: { timer: RestTimerController }) {
  const visible = timer.status !== "idle" && typeof document !== "undefined";

  useEffect(() => {
    if (!visible || typeof document === "undefined") return;

    const previousOverflow = document.body.style.overflow;
    const previousOverscroll = document.body.style.overscrollBehavior;

    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscroll;
    };
  }, [visible]);

  if (!visible) return null;

  const finished = timer.status === "finished";
  const progress =
    timer.totalSeconds > 0
      ? Math.max(
          0,
          Math.min(
            100,
            ((timer.totalSeconds - timer.remainingSeconds) /
              timer.totalSeconds) *
              100
          )
        )
      : 0;
  const finalTen = !finished && timer.remainingSeconds <= 10;
  const finalThree = !finished && timer.remainingSeconds <= 3;
  const nextSetNumber =
    timer.nextSetNumber ?? (timer.setIndex != null ? timer.setIndex + 1 : null);
  const setLabel = nextSetNumber
    ? `SET ${nextSetNumber}${timer.totalSets ? ` OF ${timer.totalSets}` : ""}`
    : "NEXT SET";
  const cleanInstruction = timer.nextInstruction
    .replace(/\s*Rest\s+\d+\s+seconds\.?\s*$/i, "")
    .trim();

  return createPortal(
    <div className="tr-recoveryOverlay" role="presentation">
      <section
        className={`tr-recoveryPanel ${finished ? "is-ready" : ""} ${
          finalTen ? "is-final-ten" : ""
        } ${finalThree ? "is-final-three" : ""}`}
        role="timer"
        aria-live="polite"
        aria-label={
          finished
            ? `Rest complete. ${setLabel} ready.`
            : `${formatRestClock(timer.remainingSeconds)} remaining in rest period.`
        }
        style={{ "--tr-recovery-progress": `${progress}%` } as React.CSSProperties}
      >
        {finished ? (
          <div className="tr-recoveryReadyState">
            <div className="tr-recoveryReadyIcon" aria-hidden="true">✓</div>
            <div className="tr-recoveryReadyKicker">REST COMPLETE</div>
            <div className="tr-recoveryReadyTitle">{setLabel} READY</div>
            <div className="tr-recoveryReadyGo">GO</div>
            <div className="tr-recoveryReadyNote">Opening automatically</div>
          </div>
        ) : (
          <>
            <header className="tr-recoveryHeader">
              <div>
                <div className="tr-recoveryKicker">REST RECOVERY</div>
                <div className="tr-recoveryExercise">
                  {timer.exerciseName || "Current exercise"}
                </div>
              </div>
              <div className="tr-recoverySetChip">{setLabel}</div>
            </header>

            <div className="tr-recoveryClockStage">
              <div className="tr-recoveryProgressRing" aria-hidden="true">
                <div className="tr-recoveryClock">
                  {formatRestClock(timer.remainingSeconds)}
                </div>
              </div>
              <div className="tr-recoveryClockLabel">
                {finalTen ? "FINAL COUNTDOWN" : "BREATHE • RESET • PREPARE"}
              </div>
            </div>

            <div className="tr-recoveryInstruction">
              <div className="tr-recoveryInstructionLabel">NEXT SET TARGET</div>
              <div className="tr-recoveryInstructionText">
                {cleanInstruction ||
                  "Return to the prescribed working weight and complete clean, controlled reps."}
              </div>
              <div className="tr-recoveryInstructionMeta">
                <span>60 SEC REST</span>
                <span>AUTO-CLOSES AT ZERO</span>
              </div>
            </div>

            <div className="tr-recoveryAdjustments">
              <button
                type="button"
                onClick={() => timer.addSeconds(-15)}
                disabled={timer.remainingSeconds <= 15}
              >
                −15 SEC
              </button>
              <button type="button" onClick={() => timer.addSeconds(15)}>
                +15 SEC
              </button>
            </div>

            <button
              type="button"
              className="tr-recoverySkip"
              onClick={timer.skip}
            >
              SKIP REST
            </button>
          </>
        )}
      </section>
    </div>,
    document.body
  );
}

function isTimed(pres: any): boolean {
  if (!pres || typeof pres !== "object") return false;
  return pres.duration_minutes != null || pres.duration_seconds != null;
}

function durationMinutes(pres: any): number {
  const m = Number(pres?.duration_minutes ?? 0);
  if (Number.isFinite(m) && m > 0) return m;
  const s = Number(pres?.duration_seconds ?? 0);
  if (Number.isFinite(s) && s > 0) return Math.round(s / 60);
  return 0;
}

function painBand(p: number): "green" | "yellow" | "red" {
  if (p <= 2) return "green";
  if (p <= 6) return "yellow";
  return "red";
}

function painColor(p: number) {
  const b = painBand(p);
  if (b === "green") return "rgba(34,197,94,1)";
  if (b === "yellow") return "rgba(245,158,11,1)";
  return "rgba(239,68,68,1)";
}

function painText(p: number) {
  const b = painBand(p);
  if (b === "green") return "OK";
  if (b === "yellow") return "Caution — coach may modify";
  return "Stop/Swap — coach will adjust";
}

type AddMuscleKey = Exclude<MuscleKey, "all"> | "all";
type AddEquipKey = Exclude<EquipKey, "all"> | "all";

const MUSCLE_CHIPS: { key: Exclude<MuscleKey, "all">; label: string; icon: string }[] = [
  { key: "chest", label: "CHEST", icon: icoChest },
  { key: "back", label: "BACK", icon: icoBack },
  { key: "shoulders", label: "SHOULDERS", icon: icoShoulders },
  { key: "arms", label: "ARMS", icon: icoArms },
  { key: "abs", label: "ABS / CORE", icon: icoCore },
  { key: "legs", label: "LEGS", icon: icoLegs },
  { key: "quads", label: "QUADS", icon: icoQuads },
  { key: "calves", label: "CALVES", icon: icoCalves },
];

const EQUIP_CHIPS: { key: Exclude<EquipKey, "all">; label: string; icon: string }[] = [
  { key: "machine", label: "MACHINE", icon: icoMachine },
  { key: "free_weight", label: "FREE WEIGHT", icon: icoDumbbell },
  { key: "cardio", label: "CARDIO", icon: icoRunner },
];

function expandSearchTerms(raw: string): string[] {
  const q = normalizeText(raw);
  if (!q) return [];
  const out = new Set<string>();
  out.add(q);

  const hasStair =
    q.includes("stair") ||
    q.includes("climb") ||
    q.includes("step") ||
    q.includes("stepper") ||
    q.includes("stepmill") ||
    q.includes("stairmaster");

  if (hasStair) {
    [
      "stair climber",
      "stairclimber",
      "stair stepper",
      "stairmaster",
      "stair master",
      "stepmill",
      "step mill",
      "stepper",
      "climber",
    ].forEach((t) => out.add(t));
  }

  return Array.from(out).filter(Boolean);
}

function buildNameOrIlike(terms: string[]) {
  const uniq = Array.from(new Set(terms.map((t) => t.trim()).filter(Boolean)));
  return uniq
    .map((t) => `name.ilike.%${t.replace(/%/g, "").replace(/_/g, "")}%`)
    .join(",");
}

function cardioBrowseOrIlike() {
  const terms = [
    "treadmill","elliptical","cross trainer","arc trainer","jog","jogging","running","sprint","bike","bicycle",
    "cycling","spin","spinning","air bike","assault bike","rower","rowing","erg","ergometer","concept2",
    "stair climber","stairclimber","stair stepper","stairmaster","stepmill","step mill","skierg","ski erg",
  ];
  return buildNameOrIlike(terms);
}

function prettyMuscle(m: string) {
  const x = String(m || "").toLowerCase();
  if (x === "abs") return "Core";
  if (x === "back") return "Back";
  if (x === "chest") return "Chest";
  if (x === "shoulders") return "Shoulders";
  if (x === "arms") return "Arms";
  if (x === "legs") return "Legs";
  if (x === "quads") return "Quads";
  if (x === "calves") return "Calves";
  return x ? x.charAt(0).toUpperCase() + x.slice(1) : "Full Body";
}

function resolveFocusLabel(item: any, timed: boolean) {
  if (timed) return "Cardio";
  const muscles = Array.isArray(item?.primary_muscles)
    ? item.primary_muscles.filter(Boolean).map((m: string) => prettyMuscle(m))
    : [];
  if (!muscles.length) return "Full Body";
  if (muscles.length === 1) return muscles[0];
  if (muscles.length === 2) return `${muscles[0]} + ${muscles[1]}`;
  return `${muscles[0]} + More`;
}

function targetLabelFromPrescription(pres: any, timed: boolean) {
  if (timed) return `${durationMinutes(pres)} min`;
  const sets = Number(pres?.sets ?? 3);
  const repMin = Number(pres?.rep_min ?? 8);
  const repMax = Number(pres?.rep_max ?? 12);
  return `${sets} × ${repMin}-${repMax}`;
}

function restOrDurationLabel(pres: any, timed: boolean) {
  if (timed) return `${durationMinutes(pres)} min target`;
  return `${Number(pres?.rest_seconds ?? 90)}s rest`;
}

function friendlyPainState(pain: number) {
  if (pain <= 2) return "Clear";
  if (pain <= 6) return "Watch";
  return "High";
}

type WarmupSet = { label: string; weight: number; reps: number };
type PlateLoad = { perSide: Array<{ plate: number; count: number }>; loadedWeight: number; remainder: number };

function buildWarmupPlan(workingWeight: number): WarmupSet[] {
  const weight = Math.max(0, Number(workingWeight) || 0);
  if (weight <= 0) return [];

  const raw = weight >= 135
    ? [
        { label: "Warm-up 1", pct: 0.4, reps: 8 },
        { label: "Warm-up 2", pct: 0.6, reps: 5 },
        { label: "Warm-up 3", pct: 0.8, reps: 3 },
      ]
    : weight >= 70
    ? [
        { label: "Warm-up 1", pct: 0.5, reps: 8 },
        { label: "Warm-up 2", pct: 0.75, reps: 4 },
      ]
    : [{ label: "Warm-up 1", pct: 0.55, reps: 8 }];

  const seen = new Set<number>();
  return raw
    .map((row) => ({
      label: row.label,
      weight: Math.min(weight, roundToIncrement(weight * row.pct, 5)),
      reps: row.reps,
    }))
    .filter((row) => row.weight > 0 && row.weight < weight && !seen.has(row.weight) && seen.add(row.weight));
}

function calculatePlateLoad(targetWeight: number, barWeight: number): PlateLoad {
  const target = Math.max(0, Number(targetWeight) || 0);
  const bar = Math.max(0, Number(barWeight) || 0);
  const perSideTarget = Math.max(0, (target - bar) / 2);
  const plates = [45, 25, 10, 5, 2.5];
  const perSide: Array<{ plate: number; count: number }> = [];
  let remaining = perSideTarget;

  for (const plate of plates) {
    const count = Math.floor((remaining + 0.0001) / plate);
    if (count > 0) {
      perSide.push({ plate, count });
      remaining -= count * plate;
    }
  }

  const loadedPerSide = perSide.reduce((sum, row) => sum + row.plate * row.count, 0);
  return {
    perSide,
    loadedWeight: bar + loadedPerSide * 2,
    remainder: Math.max(0, remaining * 2),
  };
}


type TrainingToolKind =
  | "barbell"
  | "plate_loaded"
  | "dumbbell"
  | "cable_machine"
  | "bodyweight"
  | "general";

type TrainingToolProfile = {
  kind: TrainingToolKind;
  title: string;
  inputLabel: string;
  showTool: boolean;
  showBarSelector: boolean;
  showPlateLoading: boolean;
  plateTitle: string;
  helper: string;
};

function resolveTrainingToolProfile(item: any): TrainingToolProfile {
  const name = String(item?.name ?? item?.title ?? "").toLowerCase();
  const equipment = Array.isArray(item?.equipment)
    ? item.equipment.map((value: any) => String(value ?? "").toLowerCase())
    : [];
  const text = [name, ...equipment].join(" ");

  const bodyweight =
    /body\s*weight|bodyweight|calisthenic|no equipment/.test(text) ||
    (/push[- ]?up|pull[- ]?up|chin[- ]?up|plank|crunch|sit[- ]?up/.test(name) &&
      !/weighted|cable|machine|dumbbell|barbell/.test(text));

  if (bodyweight) {
    return {
      kind: "bodyweight",
      title: "Bodyweight Preparation",
      inputLabel: "WORKING LOAD",
      showTool: false,
      showBarSelector: false,
      showPlateLoading: false,
      plateTitle: "",
      helper: "No loading calculator is needed for this exercise.",
    };
  }

  if (/barbell|olympic bar|ez[- ]?bar|curl bar/.test(text)) {
    return {
      kind: "barbell",
      title: "Warm-up + Barbell Plate Calculator",
      inputLabel: "WORKING WEIGHT",
      showTool: true,
      showBarSelector: true,
      showPlateLoading: true,
      plateTitle: "PLATES PER SIDE",
      helper: "Warm-up and plate-loading guidance only. Nothing here is logged.",
    };
  }

  if (/plate[- ]?loaded|leg press|hack squat|plate press|plate row|lever machine/.test(text)) {
    return {
      kind: "plate_loaded",
      title: "Warm-up + Plate Loading Guidance",
      inputLabel: "WORKING / ADDED LOAD",
      showTool: true,
      showBarSelector: false,
      showPlateLoading: true,
      plateTitle: "PLATES PER SIDE",
      helper: "Guidance only. Plate-loaded machine carriage weight can vary and nothing here is logged.",
    };
  }

  if (/dumbbell|dumbbells/.test(text)) {
    return {
      kind: "dumbbell",
      title: "Dumbbell Warm-up Guidance",
      inputLabel: "WORKING WEIGHT",
      showTool: true,
      showBarSelector: false,
      showPlateLoading: false,
      plateTitle: "",
      helper: "Warm-up guidance only. Nothing here is logged to your workout.",
    };
  }

  if (/cable|selectorized|machine|pec deck|pulldown|lat pull|leg curl|leg extension|adductor|abductor|smith/.test(text)) {
    return {
      kind: "cable_machine",
      title: "Working Weight Warm-up Guidance",
      inputLabel: "WORKING WEIGHT",
      showTool: true,
      showBarSelector: false,
      showPlateLoading: false,
      plateTitle: "",
      helper: "Warm-up guidance only. Nothing here is logged to your workout.",
    };
  }

  return {
    kind: "general",
    title: "Warm-up Guidance",
    inputLabel: "WORKING WEIGHT",
    showTool: true,
    showBarSelector: false,
    showPlateLoading: false,
    plateTitle: "",
    helper: "Optional preparation guidance only. Nothing here is logged.",
  };
}

function SessionCompleteOverlay({
  open,
  onReview,
  onEndWorkout,
  doneCount,
  totalExercises,
}: {
  open: boolean;
  onReview: () => void;
  onEndWorkout: () => void;
  doneCount: number;
  totalExercises: number;
}) {
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="tr-completeOverlay">
      <div className="tr-completeModal">
        <div className="tr-completeHalo" aria-hidden />
        <div className="tr-completeSparkles" aria-hidden />
        <div className="tr-completeGrid">
          <div className="tr-completeCoachWrap">
            <div className="tr-completeCoachRing" aria-hidden />
            <div className="tr-completeCoachBurst" aria-hidden />
            <img src="/coach.png" alt="Coach" className="tr-completeCoach" />
          </div>

          <div className="tr-completeCopy">
            <div className="tr-completeKicker">Session Complete</div>
            <div className="tr-completeTitle">You crushed it today.</div>
            <div className="tr-completeSub">
              You’ve successfully logged <strong>{doneCount}</strong> of <strong>{totalExercises}</strong> exercises.
              Ready to submit today’s data?
            </div>

            <div className="tr-completeStatRow">
              <div className="tr-completeStat">
                <div className="tr-kicker">Completed</div>
                <div className="tr-completeStatValue">{doneCount}/{totalExercises}</div>
              </div>

              <div className="tr-completeStat">
                <div className="tr-kicker">Performance</div>
                <div className="tr-completeStatValue">100% Maxed</div>
              </div>
            </div>

            <div className="tr-completeActions">
              <button className="tr-btn tr-btn--primary" style={{ height: 52 }} onClick={onEndWorkout}>
                END WORKOUT
              </button>
              <button className="tr-btn" style={{ height: 52 }} onClick={onReview}>
                REVIEW SESSION
              </button>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .tr-completeOverlay{
          position: fixed;
          top: var(--tr-modal-visual-top, 0px);
          left: var(--tr-modal-visual-left, 0px);
          right: auto;
          bottom: auto;
          width: var(--tr-modal-visual-width, 100vw);
          height: var(--tr-modal-visual-height, 100dvh);
          z-index: 10000;
          background:
            radial-gradient(circle at 50% 40%, rgba(0,170,255,.20), rgba(0,0,0,0) 34%),
            rgba(0,0,0,.82);
          backdrop-filter: blur(14px);
          display:grid;
          place-items:center;
          padding: 18px;
          overflow: hidden;
        }
        .tr-completeModal{
          position: relative;
          display:flex;
          flex-direction:column;
          width:min(960px, 100%);
          height:min(720px, 100%);
          min-height:0;
          max-height:100%;
          overflow:hidden;
          border-radius: 30px;
          border: 1px solid rgba(0,220,255,.42);
          background:
            linear-gradient(180deg, rgba(10,18,30,.98), rgba(4,8,14,.985)),
            radial-gradient(980px 400px at 20% 0%, rgba(0,170,255,.16), rgba(0,0,0,0) 60%),
            radial-gradient(860px 340px at 100% 100%, rgba(0,170,255,.12), rgba(0,0,0,0) 62%);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.08),
            inset 0 0 0 1px rgba(0,0,0,.55),
            0 32px 120px rgba(0,0,0,.70),
            0 0 32px rgba(0,220,255,.18),
            0 0 92px rgba(0,170,255,.12);
          padding: 24px;
        }
        .tr-completeModal::before{
          content:"";
          position:absolute;
          left: 0;
          right: 0;
          top: 0;
          height: 4px;
          background: linear-gradient(90deg, transparent, rgba(120,230,255,.92), transparent);
          box-shadow: 0 0 24px rgba(120,230,255,.36);
        }
        .tr-completeHalo{
          position:absolute;
          inset:-10% -4%;
          pointer-events:none;
          background:
            radial-gradient(circle at 24% 46%, rgba(0,220,255,.16), rgba(0,0,0,0) 28%),
            radial-gradient(circle at 76% 34%, rgba(120,230,255,.14), rgba(0,0,0,0) 26%),
            linear-gradient(135deg, transparent 18%, rgba(255,255,255,.06) 38%, transparent 58%);
          filter: blur(2px);
        }
        .tr-completeSparkles{
          position:absolute;
          inset:0;
          pointer-events:none;
          background:
            radial-gradient(circle at 14% 22%, rgba(255,255,255,.20) 0 2px, transparent 3px),
            radial-gradient(circle at 26% 68%, rgba(255,255,255,.18) 0 2px, transparent 3px),
            radial-gradient(circle at 54% 32%, rgba(255,255,255,.16) 0 2px, transparent 3px),
            radial-gradient(circle at 72% 58%, rgba(255,255,255,.18) 0 2px, transparent 3px),
            radial-gradient(circle at 86% 24%, rgba(255,255,255,.20) 0 2px, transparent 3px);
          animation: trOverlaySpark 1.8s ease-in-out infinite alternate;
          opacity:.95;
        }
        @keyframes trOverlaySpark{
          0%{ transform: translateY(0px) translateX(0px); opacity:.66; }
          100%{ transform: translateY(-2px) translateX(1px); opacity:1; }
        }
        .tr-completeGrid{
          position:relative;
          z-index:1;
          flex:1 1 0%;
          min-height:0;
          overflow-y:auto;
          overflow-x:hidden;
          overscroll-behavior-y:contain;
          touch-action:pan-y;
          -webkit-overflow-scrolling:touch;
          scrollbar-gutter:stable;
          display:grid;
          grid-template-columns: minmax(220px, 290px) 1fr;
          gap: 24px;
          align-items:center;
        }
        .tr-completeCoachWrap{
          position:relative;
          min-height: 340px;
          display:grid;
          place-items:center;
        }
        .tr-completeCoachRing{
          position:absolute;
          width: 258px;
          height: 258px;
          border-radius:999px;
          background:
            radial-gradient(circle at center, rgba(120,230,255,.34) 0%, rgba(0,170,255,.20) 30%, rgba(0,170,255,0) 72%);
          filter: blur(4px);
          box-shadow:
            0 0 42px rgba(0,220,255,.26),
            0 0 98px rgba(0,170,255,.16);
          animation: trCoachPulse 2s ease-in-out infinite;
        }
        .tr-completeCoachBurst{
          position:absolute;
          width: 320px;
          height: 320px;
          border-radius:999px;
          background:
            radial-gradient(circle at center, rgba(255,255,255,.12) 0%, rgba(120,230,255,.10) 26%, rgba(0,170,255,0) 64%);
          filter: blur(10px);
          opacity:.88;
        }
        @keyframes trCoachPulse{
          0%{ transform: scale(1); opacity:.86; }
          50%{ transform: scale(1.04); opacity:1; }
          100%{ transform: scale(1); opacity:.86; }
        }
        .tr-completeCoach{
          position:relative;
          z-index:1;
          width:min(270px, 100%);
          height:auto;
          object-fit:contain;
          filter:
            drop-shadow(0 24px 50px rgba(0,0,0,.52))
            drop-shadow(0 0 28px rgba(0,170,255,.24));
        }
        .tr-completeCopy{
          display:grid;
          gap: 14px;
        }
        .tr-completeKicker{
          font-size: 12px;
          font-weight: 1100;
          letter-spacing: .26em;
          text-transform: uppercase;
          color: rgba(190,236,255,.92);
        }
        .tr-completeTitle{
          position: relative;
          font-size: clamp(34px, 5vw, 58px);
          line-height: .98;
          font-weight: 1100;
          color: rgba(255,255,255,.98);
          text-shadow:
            0 0 18px rgba(120,230,255,.22),
            0 0 34px rgba(0,170,255,.18),
            0 10px 26px rgba(0,0,0,.34);
        }
        .tr-completeTitle::after{
          content:"✦ ✦";
          position:absolute;
          top: -14px;
          right: 2px;
          font-size: 14px;
          letter-spacing: .35em;
          color: rgba(255,245,195,.92);
          text-shadow: 0 0 16px rgba(255,235,140,.30);
          animation: trCompleteTwinkle 1.8s ease-in-out infinite alternate;
        }
        @keyframes trCompleteTwinkle{
          0%{ opacity:.45; transform: translateY(0); }
          100%{ opacity:1; transform: translateY(-2px); }
        }
        .tr-completeSub{
          font-size: 16px;
          line-height: 1.55;
          color: rgba(255,255,255,.78);
          max-width: 560px;
        }
        .tr-completeStatRow{
          display:grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          margin-top: 2px;
        }
        .tr-completeStat{
          border-radius: 18px;
          border: 1px solid rgba(255,255,255,.10);
          background:
            linear-gradient(180deg, rgba(255,255,255,.05), rgba(0,0,0,.14)),
            radial-gradient(520px 180px at 50% 0%, rgba(0,170,255,.10), rgba(0,0,0,0) 68%);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.05),
            0 18px 44px rgba(0,0,0,.30);
          padding: 14px;
          display:grid;
          gap: 6px;
        }
        .tr-completeStatValue{
          font-size: 24px;
          font-weight: 1100;
          color: rgba(255,255,255,.96);
        }
        .tr-completeActions{
          display:flex;
          gap: 12px;
          flex-wrap:wrap;
          margin-top: 8px;
        }
        @media (max-width: 860px){
          .tr-completeGrid{
            grid-template-columns: 1fr;
            justify-items:center;
            text-align:center;
          }
          .tr-completeCoachWrap{ min-height: 220px; }
          .tr-completeCoachRing{ width: 190px; height: 190px; }
          .tr-completeCoachBurst{ width: 230px; height: 230px; }
          .tr-completeCoach{ width:min(205px, 100%); }
          .tr-completeCopy{ justify-items:center; }
          .tr-completeSub{ max-width: 100%; }
          .tr-completeStatRow{ width:100%; }
          .tr-completeActions{
            position: sticky;
            bottom: 0;
            z-index: 4;
            justify-content:center;
            width:100%;
            padding: 12px;
            margin: 4px -12px -12px;
            border-top: 1px solid rgba(255,255,255,.08);
            background: linear-gradient(180deg, rgba(7,12,20,.88), rgba(4,8,14,.98));
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
          }
        }
        @media (max-width: 620px){
          .tr-completeOverlay{ padding: 10px; }
          .tr-completeModal{
            height: 100%;
            min-height:0;
            max-height:100%;
            border-radius: 22px;
            padding: 14px;
          }
          .tr-completeCoachWrap{ min-height: 165px; }
          .tr-completeCoachRing{ width: 145px; height: 145px; }
          .tr-completeCoachBurst{ width: 180px; height: 180px; }
          .tr-completeCoach{ width:min(160px, 100%); }
          .tr-completeStatRow{ grid-template-columns: 1fr; }
          .tr-completeActions{ flex-direction:column; width:100%; }
          .tr-completeActions .tr-btn{ width:100%; }
          .tr-completeTitle::after{ right: auto; left: 50%; transform: translateX(-50%); }
        }
        @media (max-width: 720px){
  .tr-exerciseConsole,
  .tr-exerciseConsoleRail,
  .tr-railModule,
  .tr-setStack,
  .tr-setRowShell,
  .tr-setGrid,
  .tr-qtyRow,
  .tr-opRow{
    position: relative;
    z-index: 40;
    pointer-events: auto;
  }

  .tr-opBtn,
  .tr-qtyBtn,
  .tr-opInput,
  .tr-bigInput,
  .tr-painSlider{
    position: relative;
    z-index: 45;
    pointer-events: auto;
    touch-action: manipulation;
  }

  .tr-finalActionModule{
    position: static;
    bottom: auto;
    z-index: 1;
  }

  .tr-finalActionBottom--triple{
    grid-template-columns: 1fr;
  }

  .tr-setGrid{
    grid-template-columns: 1fr;
  }

  .tr-qtyRow{
    grid-template-columns: 56px 1fr 56px;
  }

  .tr-qtyBtn,
  .tr-bigInput{
    height: 56px;
  }
}
      `}</style>
    </div>,
    document.body
  );
}


function SessionBodyHologram() {
  return (
    <svg className="tr-siBodySvg" viewBox="0 0 180 250" aria-hidden="true">
      <defs>
        <linearGradient id="trSiBodyLine" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8ff7ff" />
          <stop offset=".5" stopColor="#30d8ff" />
          <stop offset="1" stopColor="#1594ff" />
        </linearGradient>
        <radialGradient id="trSiBodyGlow" cx="50%" cy="42%" r="62%">
          <stop offset="0" stopColor="#49f0ff" stopOpacity=".46" />
          <stop offset=".55" stopColor="#23bfff" stopOpacity=".13" />
          <stop offset="1" stopColor="#0b86ff" stopOpacity="0" />
        </radialGradient>
        <filter id="trSiBodyBloom" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="4.2" result="b" />
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <ellipse cx="90" cy="222" rx="64" ry="16" fill="none" stroke="url(#trSiBodyLine)" strokeWidth="1.2" opacity=".58" />
      <ellipse cx="90" cy="222" rx="47" ry="9" fill="url(#trSiBodyGlow)" opacity=".8" />
      <circle cx="90" cy="34" r="17" fill="url(#trSiBodyGlow)" stroke="url(#trSiBodyLine)" strokeWidth="1.5" />
      <path d="M71 54c7-6 31-6 38 0l10 40-13 43 8 80H96l-6-63-6 63H66l8-80-13-43 10-40Z" fill="url(#trSiBodyGlow)" stroke="url(#trSiBodyLine)" strokeWidth="1.7" />
      <path d="M63 67 42 88 27 137M117 67l21 21 15 49" fill="none" stroke="url(#trSiBodyLine)" strokeWidth="7" strokeLinecap="round" opacity=".7" />
      <path d="M74 76h32M69 96h42M72 117h36M76 138h28M83 57v84M97 57v84" fill="none" stroke="#a6f8ff" strokeWidth=".75" opacity=".36" />
      <path d="M68 63c15 8 29 8 44 0M66 83c16 8 32 8 48 0M72 104c12 7 24 7 36 0" fill="none" stroke="#64eaff" strokeWidth=".7" opacity=".32" />
      <circle cx="90" cy="91" r="3.2" fill="#d6ffff" filter="url(#trSiBodyBloom)" />
      <path d="M29 137c-6 19-8 42-4 61M151 137c6 19 8 42 4 61" fill="none" stroke="#3de0ff" strokeWidth="1" opacity=".42" />
    </svg>
  );
}

function SessionProteinCore() {
  return (
    <svg className="tr-siProteinSvg" viewBox="0 0 190 190" aria-hidden="true">
      <defs>
        <linearGradient id="trSiProteinArc" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#16b8ff" />
          <stop offset=".56" stopColor="#65f5ee" />
          <stop offset="1" stopColor="#ffb657" />
        </linearGradient>
        <radialGradient id="trSiProteinCore" cx="48%" cy="38%" r="62%">
          <stop offset="0" stopColor="#143c52" />
          <stop offset=".58" stopColor="#081722" />
          <stop offset="1" stopColor="#03070b" />
        </radialGradient>
        <filter id="trSiProteinGlow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="5" result="b" />
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <circle cx="95" cy="95" r="69" fill="none" stroke="#22323c" strokeWidth="11" opacity=".9" />
      <circle cx="95" cy="95" r="69" fill="none" stroke="url(#trSiProteinArc)" strokeWidth="11" strokeLinecap="round" strokeDasharray="300 134" transform="rotate(137 95 95)" filter="url(#trSiProteinGlow)" />
      <circle cx="95" cy="95" r="53" fill="url(#trSiProteinCore)" stroke="#83d9f1" strokeOpacity=".32" />
      <path d="M82 72h26l-4 9 3 41H83l3-41-4-9Zm5 9h18" fill="none" stroke="#7fefff" strokeWidth="3" strokeLinejoin="round" />
      <path d="M88 92h17" stroke="#ffb657" strokeWidth="2" opacity=".88" />
      <circle cx="95" cy="95" r="42" fill="none" stroke="#fff" strokeOpacity=".055" strokeDasharray="2 6" />
    </svg>
  );
}

function SessionHistoryDial() {
  return (
    <svg className="tr-siHistorySvg" viewBox="0 0 180 180" aria-hidden="true">
      <defs>
        <linearGradient id="trSiDialRing" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#dfeaff" />
          <stop offset=".52" stopColor="#6da8d2" />
          <stop offset="1" stopColor="#ffac42" />
        </linearGradient>
        <radialGradient id="trSiDialFace" cx="45%" cy="36%" r="70%">
          <stop offset="0" stopColor="#173448" />
          <stop offset=".62" stopColor="#07121b" />
          <stop offset="1" stopColor="#020508" />
        </radialGradient>
        <filter id="trSiDialGlow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="3.2" result="b" />
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <path d="M65 18h50l8 12-7 13H64l-7-13 8-12Z" fill="#17222b" stroke="#a7c9dd" strokeOpacity=".5" />
      <circle cx="90" cy="94" r="58" fill="url(#trSiDialFace)" stroke="url(#trSiDialRing)" strokeWidth="7" />
      <circle cx="90" cy="94" r="45" fill="none" stroke="#fff" strokeOpacity=".09" strokeWidth="1" strokeDasharray="2 5" />
      <path d="M90 94 90 60M90 94l25 12" stroke="#80efff" strokeWidth="3.2" strokeLinecap="round" filter="url(#trSiDialGlow)" />
      <circle cx="90" cy="94" r="6" fill="#ffb653" filter="url(#trSiDialGlow)" />
      <path d="M46 57 36 44M134 57l10-13" stroke="#ffb653" strokeWidth="7" strokeLinecap="round" />
      <rect x="54" y="132" width="72" height="18" rx="7" fill="#06111a" stroke="#7bdff5" strokeOpacity=".2" />
      <path d="M69 141h42" stroke="#7bdff5" strokeWidth="2" opacity=".55" />
    </svg>
  );
}

export function WorkoutPlayerPage({ params }: any) {
  const sessionId = params?.sessionId as string;

  const [payload, setPayload] = useState<any>(null);
  const [workoutId, setWorkoutId] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);

  const [items, setItems] = useState<WorkoutExerciseRow[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);

  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [gateOpen, setGateOpen] = useState(true);
  const [gateWeight, setGateWeight] = useState<string>("");

  const [startedWeight, setStartedWeight] = useState<number | null>(null);
  const [proteinTarget, setProteinTarget] = useState<number | null>(null);
  const [sessionIntelligence, setSessionIntelligence] =
    useState<SessionIntelligence>(EMPTY_SESSION_INTELLIGENCE);
  const [sessionIntelExpanded, setSessionIntelExpanded] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("mvp_session_intel_expanded") === "1";
  });

  const [editing, setEditing] = useState(false);
  const [createExerciseOpen, setCreateExerciseOpen] = useState(false);
  const [editResultsBatchSize, setEditResultsBatchSize] = useState(() => {
    if (typeof window === "undefined") return EDIT_RESULTS_BATCH_SIZE_DESKTOP;
    return window.matchMedia("(max-width: 720px)").matches
      ? EDIT_RESULTS_BATCH_SIZE_MOBILE
      : EDIT_RESULTS_BATCH_SIZE_DESKTOP;
  });

  const [searchQ, setSearchQ] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchLoadingMore, setSearchLoadingMore] = useState(false);
  const [searchResults, setSearchResults] = useState<DecoratedSearchRow[]>([]);
  const [searchPage, setSearchPage] = useState(0);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [swapTargetWeId, setSwapTargetWeId] = useState<string | null>(null);

  const [addMuscle, setAddMuscle] = useState<AddMuscleKey>("all");
  const [addMuscleDetail, setAddMuscleDetail] = useState<MuscleDetailKey>("all");
  const [addEquip, setAddEquip] = useState<AddEquipKey>("all");

  const [justAddedId, setJustAddedId] = useState<string | null>(null);

  const [rpcMediaMap, setRpcMediaMap] = useState<Record<string, MediaPack>>({});
  const [userUploadMap, setUserUploadMap] = useState<Record<string, MediaPack>>({});

  const [sessionType, setSessionType] = useState<string | null>(null);
  const [programBlockId, setProgramBlockId] = useState<string | null>(null);
  const [goal, setGoal] = useState<string | null>(null);
  const [goalMode, setGoalMode] = useState<string | null>(null);
  const [symptomKey, setSymptomKey] = useState<SymptomKey | null>(null);

  const [completeOverlayOpen, setCompleteOverlayOpen] = useState(false);
  const restTimer = useRestTimer();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = window.matchMedia("(max-width: 720px)");
    const syncBatchSize = () => {
      setEditResultsBatchSize(
        query.matches ? EDIT_RESULTS_BATCH_SIZE_MOBILE : EDIT_RESULTS_BATCH_SIZE_DESKTOP
      );
    };
    syncBatchSize();
    query.addEventListener?.("change", syncBatchSize);
    return () => query.removeEventListener?.("change", syncBatchSize);
  }, []);

  useEffect(() => {
    void preloadWorkoutAlerts();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("mvp_session_intel_expanded", sessionIntelExpanded ? "1" : "0");
  }, [sessionIntelExpanded]);

  const doneCount = useMemo(() => items.filter((x) => !!x.completed_at).length, [items]);
  const current = items[activeIdx];

  /* MVP_TRAINER_V5_R6_MUSIC_INTELLIGENCE_SUITE: WORKOUT-AWARE QUEUE */
  useEffect(() => {
    setWorkoutMusicContext(
      activeIdx,
      items.length,
      doneCount,
    );
  }, [activeIdx, items.length, doneCount]);

  const atFirst = activeIdx === 0;
  const atLast = activeIdx === Math.max(0, items.length - 1);
  const sessionComplete = items.length > 0 && doneCount === items.length;

  useEffect(() => {
    if (!editing && !completeOverlayOpen) return;
    return lockDocumentForModal();
  }, [editing, completeOverlayOpen]);

  useEffect(() => {
    try {
      if (sessionId) localStorage.setItem("mvp_active_session_id", String(sessionId));
      if (workoutId) localStorage.setItem("mvp_active_workout_id", String(workoutId));

      const name =
        current?.exercise?.name ??
        current?.exercise?.title ??
        current?.exercise_id ??
        "Not set";
      const pos = items.length ? `${activeIdx + 1}/${items.length}` : "";

      localStorage.setItem("mvp_active_exercise_name", String(name));
      localStorage.setItem("mvp_active_exercise_pos", pos ? `(${pos})` : "");
      if (sessionId && workoutId && current) {
        localStorage.setItem("mvp_active_cursor_session_id", String(sessionId));
        localStorage.setItem("mvp_active_cursor_workout_id", String(workoutId));
        localStorage.setItem("mvp_active_exercise_index", String(activeIdx));
        if (current.id) localStorage.setItem("mvp_active_workout_exercise_row_id", String(current.id));
        if (current.exercise_id) localStorage.setItem("mvp_active_exercise_id", String(current.exercise_id));
      }
    } catch {}
  }, [sessionId, workoutId, current?.exercise?.name, current?.exercise_id, activeIdx, items.length]);

  async function loadSessionLabelContext() {
    try {
      const { data: u, error: uErr } = await supabase.auth.getUser();
      if (uErr) throw uErr;
      if (!u.user) return;

      const { data: ss, error: ssErr } = await supabase
        .from("scheduled_sessions")
        .select("id,session_type,program_block_id")
        .eq("id", sessionId)
        .eq("user_id", u.user.id)
        .maybeSingle();

      if (ssErr) throw ssErr;

      const sessionProgramBlockId = (ss as any)?.program_block_id
        ? String((ss as any).program_block_id)
        : null;

      setSessionType((ss as any)?.session_type ?? null);
      setProgramBlockId(sessionProgramBlockId);

      if (!sessionProgramBlockId) {
        setGoal(null);
        setGoalMode(null);
        setSymptomKey(null);
        return;
      }

      const { data: ab, error: abErr } = await supabase
        .from("program_blocks")
        .select("id,goal,goal_mode")
        .eq("user_id", u.user.id)
        .eq("id", sessionProgramBlockId)
        .maybeSingle();

      if (abErr) throw abErr;

      const g = (ab as any)?.goal ?? null;
      const gm = (ab as any)?.goal_mode ?? null;
      setGoal(g);
      setGoalMode(gm);

      if (isSymptomMode(gm)) {
        const { data: intake } = await supabase
          .from("intake_snapshots")
          .select("symptoms,created_at")
          .eq("user_id", u.user.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        setSymptomKey(inferSymptomKey((intake as any)?.symptoms ?? null));
      } else {
        setSymptomKey(null);
      }
    } catch {
      // Fail closed for program-sensitive context.
      setProgramBlockId(null);
      setGoal(null);
      setGoalMode(null);
      setSymptomKey(null);
    }
  }

  useEffect(() => {
    void loadSessionLabelContext();
  }, [sessionId]);

  const sessionLabel = useMemo(() => {
    const st = sessionType ?? payload?.session?.session_type ?? payload?.template?.name ?? "Session";
    return formatSessionLabel({
      sessionType: st,
      goal,
      goalMode,
      symptomKey,
    });
  }, [sessionType, payload?.session?.session_type, payload?.template?.name, goal, goalMode, symptomKey]);

  useEffect(() => {
    if (gateOpen || !workoutId) return;

    let cancelled = false;

    (async () => {
      try {
        const { data: u, error: uErr } = await supabase.auth.getUser();
        if (uErr) throw uErr;
        if (!u.user) return;

        const next = await loadSessionIntelligence({
          userId: u.user.id,
          currentWorkoutId: workoutId,
          currentSessionId: sessionId,
          programBlockId,
          currentBodyWeight: startedWeight,
        });

        if (!cancelled) setSessionIntelligence(next);
      } catch (error) {
        console.error("SESSION INTELLIGENCE LOAD FAILED:", error);
        if (!cancelled) {
          setSessionIntelligence((current) => ({
            ...EMPTY_SESSION_INTELLIGENCE,
            weightTrend30: current.weightTrend30,
          }));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [gateOpen, workoutId, sessionId, programBlockId, startedWeight]);

  const toastTimer = useRef<any>(null);
  const addedTimer = useRef<any>(null);
  const completedOverlayArmedRef = useRef(false);
  const workoutStartAlertPlayedRef = useRef(false);

  const [toast, setToast] = useState<ToastState>({ open: false, tone: "ok", text: "" });

  function showToast(text: string, tone: ToastTone = "ok") {
    try {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    } catch {}
    setToast({ open: true, tone, text });
    toastTimer.current = setTimeout(() => setToast((t) => ({ ...t, open: false })), 2400);
  }

  useEffect(() => {
    if (sessionComplete && !completedOverlayArmedRef.current) {
      completedOverlayArmedRef.current = true;
      setCompleteOverlayOpen(true);
      showToast("SESSION COMPLETE — REWARD READY.", "ok");
      void playWorkoutAlert("workout_complete");
    }

    if (!sessionComplete) {
      completedOverlayArmedRef.current = false;
      setCompleteOverlayOpen(false);
    }
  }, [sessionComplete]);

  async function hydrateAfterStart(wId: string) {
    const { data, error } = await supabase.rpc("rpc_workout_start", {
      p_session_id: sessionId,
    });

    if (error) throw error;

    setPayload(data ?? null);

    const sess = (data as any)?.session ?? null;
    const tmpl = (data as any)?.template ?? null;

    if (sess?.program_block_id) {
      setProgramBlockId(String(sess.program_block_id));
    }
    const tId =
      (sess?.template_id as string | undefined) ??
      (tmpl?.id as string | undefined) ??
      null;
    setTemplateId(tId);

    const rpcItems = ((data as any)?.items ?? []) as any[];

    const nextRpcMap: Record<string, MediaPack> = {};
    for (const it of rpcItems) {
      const exId = it?.exercise_id as string | undefined;
      const m = it?.media as any;
      if (!exId || !m) continue;

      const pack: MediaPack = {
        gif: m.gif ?? null,
        video: m.video ?? null,
        poster: m.poster ?? null,
        source: m.source ?? "rpc",
      };

      if (pack.gif || pack.video || pack.poster) nextRpcMap[exId] = pack;
    }
    setRpcMediaMap(nextRpcMap);

    const { data: existingWe, error: exErr } = await supabase
      .from("workout_exercises")
      .select("id")
      .eq("workout_id", wId)
      .limit(1);

    if (exErr) throw exErr;

    let loaded: WorkoutExerciseRow[] = [];
    if (existingWe && existingWe.length > 0) {
      loaded = await loadWorkoutExercisesWithExercises(wId);
    } else {
      const seedItems = (rpcItems || []).map((it: any, idx: number) => ({
        exercise_id: it.exercise_id,
        order_index: idx,
        prescription_snapshot:
          it.prescription_snapshot ?? {
            sets: it.sets ?? 3,
            rep_min: it.rep_min ?? 8,
            rep_max: it.rep_max ?? 12,
            rest_seconds: it.rest_seconds ?? 90,
            rir_min: it.rir_min ?? 2,
            rir_max: it.rir_max ?? 3,
          },
        pain: 0,
        difficulty: null,
      }));

      const { error: repErr } = await supabase.rpc("rpc_workout_exercises_replace", {
        p_workout_id: wId,
        p_items: seedItems,
      });

      if (repErr) throw repErr;

      loaded = await loadWorkoutExercisesWithExercises(wId);
    }

    let restoredActiveIdx = 0;
    try {
      const cursorSession = localStorage.getItem("mvp_active_cursor_session_id");
      const cursorWorkout = localStorage.getItem("mvp_active_cursor_workout_id");
      if (cursorSession === String(sessionId) && cursorWorkout === String(wId)) {
        const rowId = localStorage.getItem("mvp_active_workout_exercise_row_id");
        const exerciseId = localStorage.getItem("mvp_active_exercise_id");
        const savedIndex = Number(localStorage.getItem("mvp_active_exercise_index"));
        const rowIndex = rowId ? loaded.findIndex((row) => String(row.id) === rowId) : -1;
        const exerciseIndex = exerciseId ? loaded.findIndex((row) => String(row.exercise_id) === exerciseId) : -1;
        if (rowIndex >= 0) restoredActiveIdx = rowIndex;
        else if (exerciseIndex >= 0) restoredActiveIdx = exerciseIndex;
        else if (Number.isInteger(savedIndex) && savedIndex >= 0 && savedIndex < loaded.length) restoredActiveIdx = savedIndex;
      }
    } catch { /* local cursor is optional */ }
    setItems(loaded);
    setActiveIdx(restoredActiveIdx);

    const exIds = Array.from(new Set(loaded.map((r) => r.exercise_id).filter(Boolean)));
    const upMap = await buildUserUploadMediaMap(exIds);
    setUserUploadMap(upMap);

    void loadSessionLabelContext();
  }

  async function hydrateGateOnly() {
    setLoading(true);
    setLoadErr(null);
    setEditing(false);
    setPayload(null);
    setItems([]);
    setActiveIdx(0);
    setRpcMediaMap({});
    setUserUploadMap({});
    setStartedWeight(null);
    setProteinTarget(null);
    setTemplateId(null);
    setCompleteOverlayOpen(false);

    try {
      const { data: u, error: uErr } = await supabase.auth.getUser();
      if (uErr) throw uErr;
      if (!u.user) throw new Error("Sign in first.");

      const { data: wData, error: wRpcErr } = await supabase.rpc("rpc_workout_get_or_create", {
        p_session_id: sessionId,
      });
      if (wRpcErr) throw wRpcErr;

      const wId = (wData as any)?.workout_id as string;
      if (!wId) throw new Error("Failed to obtain workout id.");
      setWorkoutId(wId);

      const latestCompletedWeight = await loadLatestCompletedBodyWeight(u.user.id);
      const rpcSuggestedWeight =
        (wData as any)?.bodyweight_lb != null && Number((wData as any).bodyweight_lb) > 0
          ? Number((wData as any).bodyweight_lb)
          : null;

      // The launch check-in should match the HUD's "Last completed" body weight.
      // Ignore stale bodyweight data left on an unstarted workout whenever a
      // newer completed-workout value exists.
      const launchSuggestedWeight = latestCompletedWeight ?? rpcSuggestedWeight;
      setGateWeight(
        launchSuggestedWeight != null ? formatLoggedWeight(launchSuggestedWeight) : ""
      );

      const { data: wRow, error: wErr } = await supabase
        .from("workouts")
        .select("id, started_at, bodyweight_lb")
        .eq("id", wId)
        .maybeSingle();

      if (wErr) throw wErr;

      if (wRow?.started_at) {
        setGateOpen(false);

        const bw = wRow.bodyweight_lb != null ? Number(wRow.bodyweight_lb) : null;
        setStartedWeight(bw);

        const { data: sessionContext, error: sessionContextError } = await supabase
          .from("scheduled_sessions")
          .select("program_block_id")
          .eq("id", sessionId)
          .eq("user_id", u.user.id)
          .maybeSingle();

        if (sessionContextError) throw sessionContextError;

        const exactProgramId = (sessionContext as any)?.program_block_id
          ? String((sessionContext as any).program_block_id)
          : null;

        if (exactProgramId) setProgramBlockId(exactProgramId);

        let exactGoal: string | null = null;
        if (exactProgramId) {
          const { data: programRow, error: programError } = await supabase
            .from("program_blocks")
            .select("goal")
            .eq("user_id", u.user.id)
            .eq("id", exactProgramId)
            .maybeSingle();

          if (programError) throw programError;
          exactGoal = (programRow?.goal as string) ?? null;
        }

        setProteinTarget(
          bw && bw > 0
            ? roundProtein(bw * proteinMultiplier(exactGoal))
            : null
        );

        await hydrateAfterStart(wId);
      } else {
        setGateOpen(true);
      }
    } catch (e: any) {
      setLoadErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void hydrateGateOnly();
  }, [sessionId]);

  async function startWorkoutNow() {
    primeWorkoutAudio();
    void preloadWorkoutAlerts();

    if (!workoutId) return;

    const t = gateWeight.trim();
    const w = Number(t);

    if (!t || !Number.isFinite(w) || w <= 0) {
      setLoadErr("Enter your weight (required) to start.");
      return;
    }

    setLoading(true);
    setLoadErr(null);

    try {
      const { data: u, error: uErr } = await supabase.auth.getUser();
      if (uErr) throw uErr;
      if (!u.user) throw new Error("Sign in first.");

      /*
       * IMPORTANT START ORDER
       * AppShell treats a started workout with zero workout_exercises as an
       * invalid empty workout. Prepare/seed the workout first, then mark it
       * started. This restores the persistent session timer, Pause/End controls,
       * and cross-tab Resume behavior without changing AppShell.
       */
      await hydrateAfterStart(workoutId);

      const { data: preparedExercises, error: preparedExercisesError } = await supabase
        .from("workout_exercises")
        .select("id")
        .eq("workout_id", workoutId)
        .limit(1);

      if (preparedExercisesError) throw preparedExercisesError;
      if (!preparedExercises?.length) {
        throw new Error("Workout exercises could not be prepared. Try starting the session again.");
      }

      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from("workouts")
        .update({
          bodyweight_lb: w,
          performed_at: nowIso,
          started_at: nowIso,
        })
        .eq("id", workoutId);

      if (error) throw error;

      try {
        localStorage.setItem("mvp_active_session_id", String(sessionId));
        localStorage.setItem("mvp_active_workout_id", String(workoutId));
        localStorage.setItem("mvp_is_paused", "false");
        localStorage.removeItem("mvp_paused_at_iso");
        localStorage.setItem("mvp_paused_total_seconds", "0");
      } catch {}

      if (!workoutStartAlertPlayedRef.current) {
        workoutStartAlertPlayedRef.current = true;
        void playWorkoutAlert("workout_start");
      }

      setGateOpen(false);
      setStartedWeight(w);

      // AppShell already refreshes itself on window focus. Trigger that existing
      // path immediately so the timer / Pause / End HUD appears without waiting
      // for its normal inactive polling interval.
      window.setTimeout(() => {
        window.dispatchEvent(new Event("focus"));
      }, 0);

      const { data: sessionContext, error: sessionContextError } = await supabase
        .from("scheduled_sessions")
        .select("program_block_id")
        .eq("id", sessionId)
        .eq("user_id", u.user.id)
        .maybeSingle();

      if (sessionContextError) throw sessionContextError;

      const exactProgramId = (sessionContext as any)?.program_block_id
        ? String((sessionContext as any).program_block_id)
        : null;

      if (exactProgramId) setProgramBlockId(exactProgramId);

      let exactGoal: string | null = null;
      if (exactProgramId) {
        const { data: programRow, error: programError } = await supabase
          .from("program_blocks")
          .select("goal")
          .eq("user_id", u.user.id)
          .eq("id", exactProgramId)
          .maybeSingle();

        if (programError) throw programError;
        exactGoal = (programRow?.goal as string) ?? null;
      }

      setProteinTarget(
        w > 0
          ? roundProtein(w * proteinMultiplier(exactGoal))
          : null
      );
    } catch (e: any) {
      setLoadErr(e?.message ?? String(e));
      setGateOpen(true);
    } finally {
      setLoading(false);
    }
  }

  async function reloadWorkoutExercisesKeepIndex(): Promise<WorkoutExerciseRow[]> {
    if (!workoutId) return [];

    const nextItems = await loadWorkoutExercisesWithExercises(workoutId);
    setItems(nextItems);
    setActiveIdx((prev) => (nextItems.length ? Math.min(prev, nextItems.length - 1) : 0));

    const exIds = Array.from(new Set(nextItems.map((r) => r.exercise_id).filter(Boolean)));
    const upMap = await buildUserUploadMediaMap(exIds);
    setUserUploadMap(upMap);
    return nextItems;
  }

  async function handleExerciseCompleted(completedExerciseId: string) {
    if (!workoutId) return;

    const nextItems = await loadWorkoutExercisesWithExercises(workoutId);
    setItems(nextItems);

    const completedIndex = nextItems.findIndex((row) => row.id === completedExerciseId);
    const completedTotal = nextItems.filter((row) => Boolean(row.completed_at)).length;
    const allComplete = nextItems.length > 0 && completedTotal === nextItems.length;

    if (allComplete) {
      setActiveIdx(Math.max(0, completedIndex));
      showToast(`WORKOUT COMPLETE • ${completedTotal}/${nextItems.length} FINISHED.`, "ok");
    } else {
      let nextIncompleteIndex = nextItems.findIndex(
        (row, index) => index > completedIndex && !row.completed_at
      );

      if (nextIncompleteIndex < 0) {
        nextIncompleteIndex = nextItems.findIndex((row) => !row.completed_at);
      }

      if (nextIncompleteIndex >= 0) {
        setActiveIdx(nextIncompleteIndex);
      }

      showToast(
        `EXERCISE COMPLETE • ${completedTotal}/${nextItems.length} FINISHED.`,
        "ok"
      );
      void playWorkoutAlert("exercise_complete");
    }

    const exIds = Array.from(new Set(nextItems.map((row) => row.exercise_id).filter(Boolean)));
    const uploadMap = await buildUserUploadMediaMap(exIds);
    setUserUploadMap(uploadMap);
  }

  async function reindexWorkoutExercises() {
    if (!workoutId) return;

    const next = [...items].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
    for (let idx = 0; idx < next.length; idx++) {
      await supabase
        .from("workout_exercises")
        .update({ order_index: idx })
        .eq("id", next[idx].id);
    }
  }

  async function deleteWorkoutExercise(weId: string) {
    await supabase.from("workout_sets").delete().eq("workout_exercise_id", weId);
    const { error } = await supabase.from("workout_exercises").delete().eq("id", weId);
    if (error) throw error;

    await reloadWorkoutExercisesKeepIndex();
    await reindexWorkoutExercises();
    await reloadWorkoutExercisesKeepIndex();
  }

  async function addExercise(exerciseId: string) {
    if (!workoutId) return;

    let pres: any = items.length
      ? items[items.length - 1]?.prescription_snapshot ?? defaultPrescription()
      : defaultPrescription();

    try {
      const { data: exRow } = await supabase
        .from("exercises")
        .select("id,template_params")
        .eq("id", exerciseId)
        .maybeSingle();

      const dp = (exRow as any)?.template_params?.default_prescription;
      if (dp && typeof dp === "object") pres = dp;
    } catch {}

    const { data: maxRow, error: maxErr } = await supabase
      .from("workout_exercises")
      .select("order_index")
      .eq("workout_id", workoutId)
      .order("order_index", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (maxErr) throw maxErr;

    const order_index = (maxRow?.order_index ?? -1) + 1;

    try {
      const { error } = await supabase.from("workout_exercises").insert({
        workout_id: workoutId,
        exercise_id: exerciseId,
        order_index,
        prescription_snapshot: pres,
        pain: 0,
        difficulty: null,
      });

      if (error) throw error;

      const upMap = await buildUserUploadMediaMap([exerciseId]);
      setUserUploadMap((prev) => ({ ...prev, ...upMap }));

      const after = await loadWorkoutExercisesWithExercises(workoutId);
      const ok = after.some((x) => x.exercise_id === exerciseId);

      if (!ok) {
        showToast("ADD FAILED: DID NOT APPEAR IN SESSION. TRY AGAIN.", "err");
        return;
      }

      setItems(after);
      setJustAddedId(exerciseId);

      try {
        if (addedTimer.current) clearTimeout(addedTimer.current);
      } catch {}

      addedTimer.current = setTimeout(() => setJustAddedId(null), 1400);

      showToast("EXERCISE ADDED.", "ok");
      void runSearch(searchQ, { force: true });
    } catch (e: any) {
      showToast(e?.message ? `ADD FAILED: ${e.message}` : "ADD FAILED.", "err");
    }
  }

  async function swapExercise(weId: string, newExerciseId: string) {
    await supabase.from("workout_sets").delete().eq("workout_exercise_id", weId);

    const { error } = await supabase
      .from("workout_exercises")
      .update({ exercise_id: newExerciseId })
      .eq("id", weId);

    if (error) throw error;

    const upMap = await buildUserUploadMediaMap([newExerciseId]);
    setUserUploadMap((prev) => ({ ...prev, ...upMap }));

    await reloadWorkoutExercisesKeepIndex();
    setSwapTargetWeId(null);
    setSearchQ("");
    setSearchResults([]);
    setSearchPage(0);
    setSearchHasMore(false);
    setSearchError(null);
    showToast("EXERCISE SWAPPED.", "ok");
  }

  async function loadUserMediaRowsForExercises(exerciseIds: string[]): Promise<Map<string, UserMediaLite[]>> {
    const map = new Map<string, UserMediaLite[]>();
    const uniqueIds = Array.from(new Set(exerciseIds.filter(Boolean)));
    if (!uniqueIds.length) return map;

    const { data: u, error: uErr } = await supabase.auth.getUser();
    if (uErr) throw uErr;
    if (!u.user) return map;

    // Supabase serializes `.in(...)` values into the request URL. Sending the
    // entire exercise library at once can exceed Safari/proxy URL limits and
    // make the in-session picker look empty. Load user-media metadata in small
    // batches so the exercise rows always render on mobile.
    const chunkSize = 80;

    for (let start = 0; start < uniqueIds.length; start += chunkSize) {
      const chunk = uniqueIds.slice(start, start + chunkSize);
      const { data: rows, error } = await supabase
        .from("exercise_user_media")
        .select("exercise_id,kind,storage_path,use_user_upload")
        .eq("user_id", u.user.id)
        .in("exercise_id", chunk);

      if (error) throw error;

      for (const r of rows ?? []) {
        const exId = (r as any).exercise_id as string;
        const list = map.get(exId) ?? [];
        list.push(r as any);
        map.set(exId, list);
      }
    }

    return map;
  }

  async function runSearch(q: string, opts?: { force?: boolean }) {
    const termRaw = q.trim();
    const termNorm = normalizeText(termRaw);
    setSearchQ(q);
    setSearchError(null);

    const browsing = addMuscle !== "all" || addMuscleDetail !== "all" || addEquip !== "all";
    if (!opts?.force && !browsing && termNorm.length < 2) {
      setSearchResults([]);
      setSearchPage(0);
      setSearchHasMore(false);
      return;
    }

    setSearchBusy(true);
    try {
      const from = 0;
      const to = 999;

      let query = supabase
        .from("exercises")
        .select("id,name,source,primary_muscles,secondary_muscles,equipment,media")
        .order("name", { ascending: true })
        .range(from, to);

      if (termNorm.length >= 2) {
        query = query.or(buildNameOrIlike(expandSearchTerms(termRaw)));
      } else if (addEquip === "cardio") {
        query = query.or(cardioBrowseOrIlike());
      }

      let { data, error } = await query;

      if (error) {
        let fallbackQuery = supabase
          .from("exercises")
          .select("id,name,source,primary_muscles,secondary_muscles,equipment")
          .order("name", { ascending: true })
          .range(from, to);

        if (termNorm.length >= 2) {
          fallbackQuery = fallbackQuery.or(buildNameOrIlike(expandSearchTerms(termRaw)));
        } else if (addEquip === "cardio") {
          fallbackQuery = fallbackQuery.or(cardioBrowseOrIlike());
        }

        const fallback = await fallbackQuery;
        data = fallback.data as any;
        error = fallback.error;
      }

      if (error) throw error;

      const list = (data ?? []) as SearchExerciseRow[];
      const local = list.filter((row) =>
        matchFilters(
          row,
          addMuscle === "all" ? "all" : (addMuscle as any),
          addEquip === "all" ? "all" : (addEquip as any),
          addMuscleDetail
        )
      );

      const baseDecorated: DecoratedSearchRow[] = local.map((row) => {
        const icon = resolveRowIcon(row);
        return {
          ...row,
          effectiveHasMedia: effectiveHasMedia(row, []),
          icon: icon.icon,
          iconAlt: icon.alt,
        };
      });

      setSearchResults(baseDecorated);
      setSearchPage(0);
      setSearchHasMore(baseDecorated.length > editResultsBatchSize);

      if (!local.length) return;

      try {
        const userMap = await loadUserMediaRowsForExercises(
          local.map((row) => row.id).filter(Boolean)
        );

        const enhanced = baseDecorated.map((row) => ({
          ...row,
          effectiveHasMedia: effectiveHasMedia(row, userMap.get(row.id) ?? []),
        }));

        setSearchResults(enhanced);
        setSearchHasMore(enhanced.length > editResultsBatchSize);
      } catch (mediaError) {
        console.warn("Could not enhance active-session exercise media status.", mediaError);
      }
    } catch (error: any) {
      console.error("Active-session exercise picker failed to load.", error);
      setSearchResults([]);
      setSearchPage(0);
      setSearchHasMore(false);
      setSearchError(error?.message ?? "Exercises could not be loaded.");
    } finally {
      setSearchBusy(false);
    }
  }

  async function loadMoreSearchResults() {
    if (searchBusy || searchLoadingMore || !searchHasMore) return;

    setSearchLoadingMore(true);
    try {
      setSearchPage((prev) => {
        const next = prev + 1;
        const nextVisibleCount = (next + 1) * editResultsBatchSize;
        setSearchHasMore(searchResults.length > nextVisibleCount);
        return next;
      });
    } finally {
      setSearchLoadingMore(false);
    }
  }

  useEffect(() => {
    if (!editing) return;

    void runSearch(searchQ, { force: true });

    const onVis = () => {
      if (document.visibilityState === "visible") void runSearch(searchQ, { force: true });
    };
    const onFocus = () => void runSearch(searchQ, { force: true });

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [editing, addMuscle, addMuscleDetail, addEquip]);

  async function saveEditSessionOnly() {
    await reindexWorkoutExercises();
    await reloadWorkoutExercisesKeepIndex();
    setEditing(false);
    setSwapTargetWeId(null);
    setSearchQ("");
    setSearchResults([]);
    setSearchPage(0);
    setSearchHasMore(false);
    setSearchError(null);
    showToast("SAVED (THIS SESSION).", "ok");
  }

  async function saveEditAllFuture() {
    if (!templateId) {
      showToast("TEMPLATE ID MISSING FOR THIS SESSION.", "err");
      return;
    }

    await reindexWorkoutExercises();
    const latest = await loadWorkoutExercisesWithExercises(workoutId!);
    setItems(latest);

    const p_items = latest
      .slice()
      .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
      .map((we, idx) => {
        const ps = we.prescription_snapshot ?? {};
        const def = defaultPrescription();
        return {
          exercise_id: we.exercise_id,
          order_index: idx,
          sets: Number(ps.sets ?? def.sets),
          rep_min: Number(ps.rep_min ?? def.rep_min),
          rep_max: Number(ps.rep_max ?? def.rep_max),
          rest_seconds: Number(ps.rest_seconds ?? def.rest_seconds),
          rir_min: Number(ps.rir_min ?? def.rir_min),
          rir_max: Number(ps.rir_max ?? def.rir_max),
        };
      });

    const { error } = await supabase.rpc("rpc_template_exercises_replace", {
      p_template_id: templateId,
      p_items,
    });

    if (error) {
      showToast(error.message, "err");
      return;
    }

    setEditing(false);
    setSwapTargetWeId(null);
    setSearchQ("");
    setSearchResults([]);
    setSearchPage(0);
    setSearchHasMore(false);
    showToast("SAVED TO ALL FUTURE SESSIONS.", "ok");
  }

  async function handleCreatedExercise(
    exercise: CreatedExercise,
    addToSession: boolean
  ) {
    if (addToSession) {
      await addExercise(exercise.id);
    }
    await runSearch(exercise.name, { force: true });
  }

  const currentRunnerItem = useMemo(() => {
    if (!current) return null;

    const ex = current.exercise || {};
    const media = effectiveMediaForExercise({
      exercise: ex,
      exerciseId: current.exercise_id,
      rpcMediaMap,
      userUploadMap,
    });

    return {
      ...(ex || {}),
      media,
      prescription_snapshot: current.prescription_snapshot,
      exercise_id: current.exercise_id,
      id: current.exercise_id,
    };
  }, [current, rpcMediaMap, userUploadMap]);

  const currentPrescription = current?.prescription_snapshot ?? {};
  const currentTimed = isTimed(currentPrescription);
  const currentExerciseName =
    current?.exercise?.name ?? current?.exercise?.title ?? "Not set";
  const currentTarget = targetLabelFromPrescription(currentPrescription, currentTimed);
  const currentFocus = currentRunnerItem
    ? resolveFocusLabel(currentRunnerItem, currentTimed)
    : "Full Body";
  const currentRest = restOrDurationLabel(currentPrescription, currentTimed);
  const previousExercise = activeIdx > 0 ? items[activeIdx - 1] : null;
  const previousExerciseName =
    previousExercise?.exercise?.name ??
    previousExercise?.exercise?.title ??
    "Start of workout";
  const nextExercise = activeIdx < items.length - 1 ? items[activeIdx + 1] : null;
  const nextExerciseName =
    nextExercise?.exercise?.name ??
    nextExercise?.exercise?.title ??
    "End of workout";
  const nextIncompleteIndex = items.findIndex(
    (row, index) => index > activeIdx && !row.completed_at
  );
  const sessionShortLabel = sessionLabel.split("•")[0]?.trim() || sessionLabel;
  const lastSession = sessionIntelligence.lastSameSession;
  const lastSessionAgo =
    lastSession == null
      ? "NO COMPLETED BENCHMARK"
      : lastSession.daysAgo === 0
        ? "TODAY"
        : lastSession.daysAgo === 1
          ? "1 DAY AGO"
          : `${lastSession.daysAgo} DAYS AGO`;
  const weightTrend = sessionIntelligence.weightTrend30;
  const weightTrendText =
    weightTrend == null
      ? "30-DAY TREND BUILDING"
      : Math.abs(weightTrend) < 0.05
        ? "STABLE OVER 30 DAYS"
        : `${weightTrend > 0 ? "+" : ""}${weightTrend.toFixed(1)} LB OVER 30 DAYS`;
  const volumeDelta = lastSession?.volumeDelta ?? null;
  const volumeDeltaText =
    volumeDelta == null
      ? "COMPARISON BUILDS AFTER TWO COMPLETED SESSIONS"
      : volumeDelta === 0
        ? `MATCHED PREVIOUS ${sessionShortLabel.toUpperCase()} VOLUME`
        : `${volumeDelta > 0 ? "+" : ""}${Math.round(volumeDelta).toLocaleString()} LB VS PREVIOUS ${sessionShortLabel.toUpperCase()}`;
  const weekCompletionText = String(sessionIntelligence.week.completedWorkouts);
  const weekTrainingTime =
    sessionIntelligence.week.trainingMinutes > 0
      ? formatMinutesCompact(sessionIntelligence.week.trainingMinutes)
      : "0 MIN";
  const progressRatio = items.length ? Math.min(1, doneCount / items.length) : 0;
  const progressPercent = Math.round(progressRatio * 100);
  const currentProgressStart = items.length
    ? Math.min(100, (doneCount / items.length) * 100)
    : 0;
  const currentProgressWidth =
    items.length && doneCount < items.length ? 100 / items.length : 0;

  const prev = () => setActiveIdx((i) => Math.max(i - 1, 0));
  const next = () => setActiveIdx((i) => Math.min(i + 1, Math.max(0, items.length - 1)));

  const endWorkoutNow = () => {
    setCompleteOverlayOpen(false);
    window.dispatchEvent(
      new CustomEvent(END_WORKOUT_REQUEST_EVENT, {
        detail: { source: "session-complete-overlay", sessionId, workoutId },
      })
    );
  };

  if (loading) return <Card title="Workout">Loading…</Card>;

  if (loadErr) {
    return (
      <div style={{ display: "grid", gap: 12, paddingBottom: 156 }}>
        <Toast toast={toast} onClose={() => setToast((t) => ({ ...t, open: false }))} />
        <Card title="Workout failed to load" tone="blue">
          <div
            className="tr-rowbox"
            style={{
              borderColor: "rgb(255 80 80 / .35)",
              background: "rgb(255 80 80 / .10)",
            }}
          >
            <div style={{ fontWeight: 950 }}>RPC / data error</div>
            <div className="tr-sub" style={{ marginTop: 8 }}>
              {loadErr}
            </div>
          </div>

          <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
            <button className="tr-btn tr-btn--primary" onClick={hydrateGateOnly}>
              Retry
            </button>
            <button className="tr-btn" onClick={() => navigateWithinWorkoutPlayer("/")}>
              Back to Workouts
            </button>
          </div>
        </Card>
      </div>
    );
  }

  if (gateOpen) {
    return (
      <div style={{ display: "grid", gap: 12, paddingBottom: 156 }}>
        <Toast toast={toast} onClose={() => setToast((t) => ({ ...t, open: false }))} />
        <PreWorkoutLaunch
          sessionId={sessionId}
          sessionLabel={sessionLabel}
          weight={gateWeight}
          onWeightChange={setGateWeight}
          onStart={startWorkoutNow}
          onCancel={() => navigateWithinWorkoutPlayer("/")}
        />
      </div>
    );
  }

  return (
    <div className="tr-workoutPlayerPage" style={{ display: "grid", gap: 12, paddingBottom: "calc(190px + env(safe-area-inset-bottom))" }}>
      <Toast toast={toast} onClose={() => setToast((t) => ({ ...t, open: false }))} />
      <RestTimerDock timer={restTimer} />

      <SessionCompleteOverlay
        open={completeOverlayOpen}
        onReview={() => setCompleteOverlayOpen(false)}
        onEndWorkout={endWorkoutNow}
        doneCount={doneCount}
        totalExercises={items.length}
      />

      <div className={`tr-workoutCheckinCard tr-siShell ${sessionIntelExpanded ? "is-expanded" : "is-compact"}`}>
        <Card
          title="Session Check-in"
          tone="blue"
          right={
            <div className="tr-siHeaderRight">
              <div className="tr-checkinContext">{sessionLabel} • TODAY</div>
              <button
                type="button"
                className="tr-siToggle"
                onClick={() => setSessionIntelExpanded((value) => !value)}
                aria-expanded={sessionIntelExpanded}
                aria-label={sessionIntelExpanded ? "Minimize Session Check-in" : "Maximize Session Check-in"}
                title={sessionIntelExpanded ? "Minimize Session Check-in" : "Maximize Session Check-in"}
              >
                <span aria-hidden="true">{sessionIntelExpanded ? "⌃" : "⌄"}</span>
              </button>
            </div>
          }
        >
          {sessionIntelExpanded ? (
            <div className="tr-siMax">
              <section className="tr-siBodyPanel">
                <div className="tr-siBodyLight" aria-hidden="true" />
                <SessionBodyHologram />
                <div className="tr-siBodyCopy">
                  <span>BODY WEIGHT</span>
                  <strong>{startedWeight != null ? `${formatLoggedWeight(startedWeight)} LB` : "—"}</strong>
                  <small
                    className={`tr-siTrend ${
                      weightTrend != null && weightTrend > 0
                        ? "is-positive"
                        : weightTrend != null && weightTrend < 0
                          ? "is-negative"
                          : ""
                    }`}
                  >
                    {weightTrendText}
                  </small>
                </div>
                <div className="tr-siBodyPlatform" aria-hidden="true"><i /><i /><i /></div>
              </section>

              <div className="tr-siDashboard">
                <div className="tr-siTopGrid">
                  <section className="tr-siModule tr-siProtein">
                    <div className="tr-siModuleCopy">
                      <span>PROTEIN TARGET</span>
                      <strong>{proteinTarget != null ? `${proteinTarget} G` : "—"}</strong>
                      <small>DAILY MUSCLE-GAIN TARGET</small>
                    </div>
                    <SessionProteinCore />
                  </section>

                  <section className="tr-siModule tr-siLast">
                    <div className="tr-siModuleCopy">
                      <span>LAST {sessionShortLabel.toUpperCase()}</span>
                      <strong>{lastSessionAgo}</strong>
                      <small>{lastSession ? compactDate(lastSession.completedAt) : "COMPLETE ONE TO BUILD HISTORY"}</small>
                    </div>
                    <SessionHistoryDial />
                  </section>
                </div>

                <section className="tr-siPerformance">
                  <div className="tr-siPerformanceHead">
                    <div>
                      <span>PREVIOUS {sessionShortLabel.toUpperCase()}</span>
                      <strong>{lastSession ? "PERFORMANCE BENCHMARK" : "NO COMPLETED BENCHMARK YET"}</strong>
                    </div>
                    {lastSession ? <b>{compactDate(lastSession.completedAt)}</b> : null}
                  </div>

                  <div className="tr-siPerformanceGrid">
                    <div className="tr-siPerfMetric is-time">
                      <div className="tr-siPerfValue">
                        <strong>{formatMinutesCompact(lastSession?.durationMinutes)}</strong>
                        <span>SESSION TIME</span>
                      </div>
                      <svg className="tr-siWave" viewBox="0 0 220 64" preserveAspectRatio="none" aria-hidden="true">
                        <defs>
                          <linearGradient id="trSiWaveGrad" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0" stopColor="#34cfff" stopOpacity=".15" />
                            <stop offset=".45" stopColor="#6df5ff" />
                            <stop offset="1" stopColor="#1b9cff" stopOpacity=".12" />
                          </linearGradient>
                          <filter id="trSiWaveGlow" x="-30%" y="-80%" width="160%" height="260%">
                            <feGaussianBlur stdDeviation="2.1" result="b" />
                            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
                          </filter>
                        </defs>
                        <path d="M0 32h12l5-7 6 18 7-29 7 38 8-21 8 9 7-30 7 45 8-33 7 18 8-7 7-20 7 37 7-22 8 8 7-17 8 28 7-33 8 40 7-26 8 9 7-17 8 27 7-19 8 8 7-13 8 20 7-15 8 6h15" fill="none" stroke="url(#trSiWaveGrad)" strokeWidth="2" filter="url(#trSiWaveGlow)" />
                      </svg>
                      <div className={`tr-siPerfDelta ${
                        volumeDelta != null && volumeDelta > 0
                          ? "is-positive"
                          : volumeDelta != null && volumeDelta < 0
                            ? "is-negative"
                            : ""
                      }`}>
                        {lastSession ? volumeDeltaText : "COMPLETE THIS SESSION TO CREATE YOUR FIRST BENCHMARK"}
                      </div>
                    </div>

                    <div className="tr-siPerfMetric is-sets">
                      <div className="tr-siSetCells" aria-hidden="true">
                        {Array.from({ length: Math.min(18, Math.max(6, lastSession?.plannedSets ?? 6)) }).map((_, index) => (
                          <i key={index} className={lastSession && index < lastSession.completedSets ? "is-done" : ""} />
                        ))}
                      </div>
                      <div className="tr-siPerfValue">
                        <strong>{lastSession ? `${lastSession.completedSets} / ${lastSession.plannedSets}` : "—"}</strong>
                        <span>SETS COMPLETED</span>
                      </div>
                    </div>

                    <div className="tr-siPerfMetric is-volume">
                      <svg className="tr-siVolumeGlyph" viewBox="0 0 150 100" aria-hidden="true">
                        <defs>
                          <linearGradient id="trSiCubeA" x1="0" y1="0" x2="1" y2="1">
                            <stop offset="0" stopColor="#58edff" stopOpacity=".74" />
                            <stop offset="1" stopColor="#5f72ff" stopOpacity=".12" />
                          </linearGradient>
                          <linearGradient id="trSiCubeB" x1="0" y1="0" x2="1" y2="1">
                            <stop offset="0" stopColor="#c9f8ff" stopOpacity=".52" />
                            <stop offset="1" stopColor="#9e7cff" stopOpacity=".15" />
                          </linearGradient>
                        </defs>
                        <g fill="none" stroke="#88eaff" strokeWidth="1.2" opacity=".76">
                          <path d="M61 17 80 7l19 10v22L80 49 61 39Z" fill="url(#trSiCubeA)" />
                          <path d="M36 42 55 32l19 10v22L55 74 36 64Z" fill="url(#trSiCubeB)" />
                          <path d="M86 42 105 32l19 10v22l-19 10-19-10Z" fill="url(#trSiCubeB)" />
                          <path d="M61 66 80 56l19 10v22L80 98 61 88Z" fill="url(#trSiCubeA)" />
                        </g>
                      </svg>
                      <div className="tr-siPerfValue">
                        <strong>{formatVolumeLb(lastSession?.volume)}</strong>
                        <span>TRAINING VOLUME</span>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="tr-siWeekStrip">
                  <div>
                    <span>THIS WEEK</span>
                    <strong>{weekCompletionText}</strong>
                    <small>WORKOUTS COMPLETED</small>
                  </div>
                  <div className="tr-siWeekRail" aria-hidden="true">
                    <i className={Number(weekCompletionText) > 0 ? "is-live" : ""} />
                    <i className={Number(weekCompletionText) > 1 ? "is-live" : ""} />
                    <i className={Number(weekCompletionText) > 2 ? "is-live" : ""} />
                    <i className={Number(weekCompletionText) > 3 ? "is-live" : ""} />
                    <i className={Number(weekCompletionText) > 4 ? "is-live" : ""} />
                  </div>
                  <div className="tr-siWeekTime">
                    <strong>{weekTrainingTime}</strong>
                    <small>TRAINED THIS WEEK</small>
                  </div>
                </section>
              </div>
            </div>
          ) : (
            <div className="tr-siCompact">
              <div className="tr-siCompactMetric is-weight">
                <span className="tr-siCompactIcon" aria-hidden="true">◇</span>
                <div><small>BODY WEIGHT</small><strong>{startedWeight != null ? `${formatLoggedWeight(startedWeight)} LB` : "—"}</strong></div>
              </div>
              <div className="tr-siCompactMetric is-protein">
                <span className="tr-siCompactIcon" aria-hidden="true">◔</span>
                <div><small>PROTEIN</small><strong>{proteinTarget != null ? `${proteinTarget} G` : "—"}</strong></div>
              </div>
              <div className="tr-siCompactMetric is-last">
                <span className="tr-siCompactIcon" aria-hidden="true">◷</span>
                <div><small>LAST {sessionShortLabel.toUpperCase()}</small><strong>{lastSessionAgo}</strong></div>
              </div>
              <div className="tr-siCompactMetric is-performance">
                <div><small>PREVIOUS PERFORMANCE</small><strong>{formatMinutesCompact(lastSession?.durationMinutes)} <em>•</em> {lastSession ? `${lastSession.completedSets}/${lastSession.plannedSets}` : "—"} <em>•</em> {formatVolumeLb(lastSession?.volume)}</strong></div>
              </div>
            </div>
          )}
        </Card>
      </div>

      <div className="tr-workoutSessionCard">
        <Card
          title={sessionLabel}
          tone="blue"
          right={
            <button
              type="button"
              className="tr-seg is-active tr-sessionEditButton"
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
          }
        >
          <div className="tr-sessionNavConsole">
            <button
              type="button"
              className="tr-sessionNavButton is-prev"
              onClick={prev}
              disabled={atFirst}
              aria-label={atFirst ? "Start of workout" : `Previous exercise: ${previousExerciseName}`}
            >
              <span className="tr-sessionNavArrow" aria-hidden="true">←</span>
              <span className="tr-sessionNavCopy">
                {!atFirst ? <small>PREVIOUS</small> : null}
                <strong>{atFirst ? "START OF WORKOUT" : previousExerciseName}</strong>
              </span>
            </button>

            <div className="tr-sessionCurrentPanel">
              <div className="tr-sessionCurrentTopline">
                <span>EXERCISE {items.length ? activeIdx + 1 : 0} OF {items.length}</span>
                <span
                  className={`tr-sessionCurrentState ${
                    current?.completed_at ? "is-complete" : "is-current"
                  }`}
                >
                  {current?.completed_at ? "COMPLETED" : "CURRENT"}
                </span>
              </div>

              <strong className="tr-sessionCurrentName">{currentExerciseName}</strong>

              <div className="tr-sessionCurrentMeta" aria-label="Exercise prescription">
                <span>{currentTarget}</span>
                <span>{currentFocus}</span>
                <span>{currentRest}</span>
              </div>

            </div>

            <button
              type="button"
              className="tr-sessionNavButton is-next"
              onClick={next}
              disabled={atLast}
              aria-label={atLast ? "End of workout" : `Next exercise: ${nextExerciseName}`}
            >
              <span className="tr-sessionNavCopy">
                {!atLast ? <small>NEXT</small> : null}
                <strong>{atLast ? "END OF WORKOUT" : nextExerciseName}</strong>
              </span>
              <span className="tr-sessionNavArrow" aria-hidden="true">→</span>
            </button>
          </div>

          <section className="tr-exerciseProgressPanel" aria-label="Exercise progress">
            <div className="tr-exerciseProgressHeader">
              <div className="tr-exerciseProgressTitle">
                <div className="tr-kicker">EXERCISE PROGRESS</div>
                <strong>WORKOUT ROADMAP</strong>
              </div>

              <div
                className="tr-exerciseProgressCount"
                style={{ "--tr-progress": progressRatio } as any}
                aria-label={`${doneCount} of ${items.length} completed`}
              >
                <div className="tr-exerciseProgressCountValue">
                  <strong className="tr-exerciseProgressDone">{doneCount}</strong>
                  <span className="tr-exerciseProgressTotal">/{items.length}</span>
                </div>
                <span className="tr-exerciseProgressCountLabel">COMPLETED</span>
              </div>
            </div>

            <div
              className="tr-exerciseProgressRail"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={items.length || 1}
              aria-valuenow={doneCount}
              aria-label={`${doneCount} of ${items.length} exercises completed`}
            >
              <span
                className="tr-exerciseProgressRailFill"
                style={{ width: `${progressPercent}%` }}
              />
              {currentProgressWidth > 0 ? (
                <span
                  className="tr-exerciseProgressRailCurrent"
                  style={{
                    left: `${currentProgressStart}%`,
                    width: `${currentProgressWidth}%`,
                  }}
                />
              ) : null}
              <span
                className="tr-exerciseProgressRailCheckpoints"
                aria-hidden="true"
              >
                {items.slice(0, -1).map((row, index) => (
                  <i
                    key={row.id}
                    style={{ left: `${((index + 1) / items.length) * 100}%` }}
                  />
                ))}
              </span>
              {doneCount > 0 && doneCount < items.length ? (
                <span
                  className="tr-exerciseProgressRailEdge"
                  style={{ left: `${progressPercent}%` }}
                  aria-hidden="true"
                />
              ) : null}
            </div>

            <div className="tr-exerciseProgressGrid">
              {items.map((row, index) => {
                const isSelected = index === activeIdx;
                const status = row.completed_at
                  ? "complete"
                  : isSelected
                    ? "current"
                    : index === nextIncompleteIndex
                      ? "next"
                      : "remaining";
                const statusLabel =
                  status === "complete"
                    ? "COMPLETED"
                    : status === "current"
                      ? "CURRENT"
                      : status === "next"
                        ? "UP NEXT"
                        : "REMAINING";
                const exerciseName =
                  row.exercise?.name ??
                  row.exercise?.title ??
                  `Exercise ${index + 1}`;

                return (
                  <button
                    key={row.id}
                    type="button"
                    className={`tr-exerciseProgressCard is-${status} ${
                      isSelected ? "is-selected" : ""
                    } ${isSelected || status === "next" ? "is-mobile-priority" : ""}`}
                    onClick={() => setActiveIdx(index)}
                    aria-current={isSelected ? "step" : undefined}
                  >
                    <span className="tr-exerciseProgressNumber">
                      {row.completed_at ? "✓" : String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="tr-exerciseProgressText">
                      <strong>{exerciseName}</strong>
                      <small>{statusLabel}</small>
                    </span>
                  </button>
                );
              })}
            </div>

          </section>
        </Card>
      </div>

      {current && currentRunnerItem ? (
        <div className="tr-activeExerciseRunner" data-ui-rev="active-console-v2">
          <ExerciseRunner
            workoutExercise={current}
            item={currentRunnerItem}
            programBlockId={programBlockId}
            goal={goal}
            onChanged={reloadWorkoutExercisesKeepIndex}
            onExerciseCompleted={handleExerciseCompleted}
            showToast={showToast}
            exerciseIndex={activeIdx + 1}
            totalExercises={items.length}
            sessionComplete={sessionComplete}
            onStartRest={restTimer.start}
          />
        </div>
      ) : (
        <Card title="Workout">No exercises yet. Use Edit to add.</Card>
      )}

{editing && (
  <EditSessionPanel
    items={items}
    onClose={() => setEditing(false)}
    onSaveSessionOnly={saveEditSessionOnly}
    onSaveAllFuture={saveEditAllFuture}
    onDelete={async (weId) => {
      await deleteWorkoutExercise(weId);
      showToast("DELETED FROM THIS SESSION.", "ok");
    }}
    onSwap={(weId) => setSwapTargetWeId(weId)}
    swapTargetWeId={swapTargetWeId}
    searchQ={searchQ}
    searchBusy={searchBusy}
    searchLoadingMore={searchLoadingMore}
    searchHasMore={searchHasMore}
    searchError={searchError}
    searchResults={searchResults.slice(0, (searchPage + 1) * editResultsBatchSize)}
    resultsBatchSize={editResultsBatchSize}
    onSearch={(v) => runSearch(v)}
    onRetry={() => runSearch(searchQ, { force: true })}
    onLoadMore={loadMoreSearchResults}
    onPickAdd={addExercise}
    onCreateNew={() => setCreateExerciseOpen(true)}
    onPickSwap={async (exerciseId) => {
      if (!swapTargetWeId) return;
      await swapExercise(swapTargetWeId, exerciseId);
    }}
    addMuscle={addMuscle}
    addMuscleDetail={addMuscleDetail}
    addEquip={addEquip}
    setAddMuscle={(v) => {
      setAddMuscle(v);
      setAddMuscleDetail("all");
    }}
    setAddMuscleDetail={(v) => setAddMuscleDetail(v)}
    setAddEquip={(v) => setAddEquip(v)}
    justAddedId={justAddedId}
  />
)}

      <CreateExerciseModal
        open={createExerciseOpen}
        onClose={() => setCreateExerciseOpen(false)}
        onCreated={handleCreatedExercise}
        allowAddToSession
      />

      <style>{`
        .tr-workoutSessionCard .tr-card-body{
          display:grid;
          gap:18px;
        }

        .tr-sessionEditButton{
          min-width:92px;
          height:44px;
          padding:0 20px;
        }

        .tr-sessionNavConsole{
          display:grid;
          grid-template-columns:124px minmax(0,1fr) 124px;
          align-items:stretch;
          gap:14px;
        }

        .tr-sessionNavButton{
          min-width:0;
          min-height:148px;
          display:flex;
          align-items:center;
          justify-content:center;
          gap:10px;
          border:1px solid rgba(255,255,255,.12);
          border-radius:18px;
          color:rgba(245,249,252,.94);
          background:
            linear-gradient(180deg, rgba(255,255,255,.055), rgba(0,0,0,.18)),
            rgba(8,13,19,.98);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.055),
            0 18px 42px rgba(0,0,0,.28);
          font-size:13px;
          letter-spacing:.14em;
          text-transform:uppercase;
          cursor:pointer;
          transition:transform .14s ease, border-color .14s ease, box-shadow .14s ease;
        }

        .tr-sessionNavButton span{
          color:#8bdfff;
          font-size:22px;
          line-height:1;
        }

        .tr-sessionNavButton.is-next{
          border-color:rgba(255,154,31,.34);
        }

        .tr-sessionNavButton.is-next span{
          color:#ffc164;
        }

        .tr-sessionNavButton:hover:not(:disabled),
        .tr-sessionNavButton:focus-visible:not(:disabled){
          transform:translateY(-1px);
          border-color:rgba(58,203,255,.54);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.07),
            0 22px 50px rgba(0,0,0,.34),
            0 0 24px rgba(0,174,255,.09);
        }

        .tr-sessionNavButton:disabled{
          opacity:.32;
          cursor:not-allowed;
          transform:none;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.035);
        }

        .tr-sessionCurrentPanel{
          min-width:0;
          display:grid;
          align-content:center;
          justify-items:center;
          gap:11px;
          padding:20px 24px;
          border:1px solid rgba(24,190,255,.38);
          border-radius:20px;
          background:
            radial-gradient(560px 170px at 50% -24%, rgba(0,178,255,.18), transparent 66%),
            linear-gradient(180deg, rgba(14,24,34,.99), rgba(4,9,14,.995));
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.07),
            0 24px 58px rgba(0,0,0,.34),
            0 0 28px rgba(0,174,255,.075);
          text-align:center;
        }

        .tr-sessionCurrentTopline{
          width:100%;
          display:flex;
          align-items:center;
          justify-content:center;
          gap:10px;
          color:rgba(154,210,235,.76);
          font-size:9px;
          font-weight:1000;
          letter-spacing:.18em;
          text-transform:uppercase;
        }

        .tr-sessionCurrentState{
          padding:5px 8px;
          border:1px solid rgba(34,196,255,.34);
          border-radius:999px;
          color:#83ddff;
          background:rgba(0,174,255,.09);
          letter-spacing:.12em;
        }

        .tr-sessionCurrentState.is-complete{
          border-color:rgba(61,218,116,.38);
          color:#7bea9c;
          background:rgba(40,202,99,.09);
        }

        .tr-sessionCurrentName{
          min-width:0;
          max-width:100%;
          color:#fff;
          font-size:clamp(24px,3.2vw,39px);
          line-height:1.03;
          font-weight:1000;
          letter-spacing:-.025em;
          overflow-wrap:anywhere;
          text-shadow:0 2px 0 rgba(0,0,0,.7), 0 0 24px rgba(0,174,255,.08);
        }

        .tr-sessionCurrentMeta{
          display:flex;
          justify-content:center;
          gap:8px;
          flex-wrap:wrap;
        }

        .tr-sessionCurrentMeta span{
          padding:6px 10px;
          border:1px solid rgba(255,255,255,.105);
          border-radius:999px;
          color:rgba(225,236,244,.82);
          background:rgba(255,255,255,.035);
          font-size:10px;
          font-weight:900;
          letter-spacing:.04em;
        }

        .tr-sessionNextLine{
          max-width:100%;
          display:flex;
          align-items:center;
          justify-content:center;
          gap:9px;
          color:rgba(255,193,100,.94);
          font-size:11px;
        }

        .tr-sessionNextLine span{
          color:rgba(255,184,71,.66);
          font-size:8px;
          font-weight:1000;
          letter-spacing:.16em;
        }

        .tr-sessionNextLine strong{
          min-width:0;
          overflow-wrap:anywhere;
        }

        .tr-exerciseProgressPanel{
          display:grid;
          gap:14px;
          padding:17px;
          border:1px solid rgba(255,255,255,.085);
          border-radius:19px;
          background:
            radial-gradient(620px 190px at 5% -20%, rgba(0,174,255,.09), transparent 63%),
            linear-gradient(180deg, rgba(255,255,255,.028), rgba(0,0,0,.16));
          box-shadow:inset 0 1px 0 rgba(255,255,255,.045);
        }

        .tr-exerciseProgressHeader{
          display:flex;
          align-items:end;
          justify-content:space-between;
          gap:18px;
        }

        .tr-exerciseProgressHeader > div:first-child{
          display:grid;
          gap:6px;
        }

        .tr-exerciseProgressHeader > div:first-child strong{
          color:rgba(246,250,253,.96);
          font-size:15px;
          font-weight:950;
        }

        .tr-exerciseProgressCount{
          display:flex;
          align-items:baseline;
          gap:5px;
          font-variant-numeric:tabular-nums;
          white-space:nowrap;
        }

        .tr-exerciseProgressCount strong{
          color:#ffd078;
          font-size:25px;
          line-height:1;
          font-weight:1000;
        }

        .tr-exerciseProgressCount span{
          color:rgba(203,220,231,.58);
          font-size:10px;
          font-weight:900;
          letter-spacing:.08em;
        }

        .tr-exerciseProgressTrack{
          height:9px;
          overflow:hidden;
          border:1px solid rgba(255,255,255,.085);
          border-radius:999px;
          background:rgba(255,255,255,.05);
          box-shadow:inset 0 2px 4px rgba(0,0,0,.72);
        }

        .tr-exerciseProgressTrack span{
          display:block;
          height:100%;
          border-radius:inherit;
          background:linear-gradient(90deg, #13a64d, #6bf094);
          box-shadow:0 0 16px rgba(54,221,111,.23);
          transition:width .25s ease;
        }

        .tr-exerciseProgressGrid{
          display:grid;
          grid-template-columns:repeat(3,minmax(0,1fr));
          gap:11px;
        }

        .tr-exerciseProgressCard{
          min-width:0;
          min-height:82px;
          display:grid;
          grid-template-columns:43px minmax(0,1fr);
          align-items:center;
          gap:11px;
          padding:12px;
          border:1px solid rgba(255,255,255,.09);
          border-radius:16px;
          color:#fff;
          background:
            linear-gradient(180deg, rgba(255,255,255,.045), rgba(0,0,0,.18)),
            rgba(7,11,16,.98);
          box-shadow:inset 0 1px 0 rgba(255,255,255,.04);
          text-align:left;
          cursor:pointer;
          transition:transform .14s ease, border-color .14s ease, box-shadow .14s ease;
        }

        .tr-exerciseProgressCard:hover,
        .tr-exerciseProgressCard:focus-visible{
          transform:translateY(-1px);
          border-color:rgba(54,194,255,.38);
        }

        .tr-exerciseProgressCard.is-current,
        .tr-exerciseProgressCard.is-selected.is-current{
          border-color:rgba(29,198,255,.76);
          background:
            radial-gradient(300px 100px at 0 0, rgba(0,174,255,.16), transparent 68%),
            linear-gradient(180deg, rgba(8,31,45,.98), rgba(3,12,18,.995));
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.07),
            0 0 22px rgba(0,180,255,.12);
        }

        .tr-exerciseProgressCard.is-next{
          border-color:rgba(255,165,35,.42);
          background:
            radial-gradient(280px 100px at 0 0, rgba(255,145,0,.11), transparent 68%),
            linear-gradient(180deg, rgba(30,22,10,.96), rgba(10,8,5,.995));
        }

        .tr-exerciseProgressCard.is-complete{
          border-color:rgba(58,218,112,.42);
          background:
            radial-gradient(280px 100px at 0 0, rgba(43,207,102,.105), transparent 68%),
            linear-gradient(180deg, rgba(10,28,17,.94), rgba(4,10,7,.995));
        }

        .tr-exerciseProgressCard.is-selected:not(.is-current){
          box-shadow:0 0 0 2px rgba(116,218,255,.22), inset 0 1px 0 rgba(255,255,255,.06);
        }

        .tr-exerciseProgressNumber{
          width:41px;
          height:41px;
          display:grid;
          place-items:center;
          border:1px solid rgba(255,255,255,.12);
          border-radius:13px;
          color:rgba(222,234,242,.8);
          background:rgba(0,0,0,.24);
          font-size:13px;
          font-weight:1000;
          font-variant-numeric:tabular-nums;
        }

        .tr-exerciseProgressCard.is-current .tr-exerciseProgressNumber{
          border-color:rgba(38,199,255,.62);
          color:#bdeeff;
          background:rgba(0,174,255,.12);
        }

        .tr-exerciseProgressCard.is-next .tr-exerciseProgressNumber{
          border-color:rgba(255,165,35,.48);
          color:#ffd08a;
          background:rgba(255,145,0,.085);
        }

        .tr-exerciseProgressCard.is-complete .tr-exerciseProgressNumber{
          border-color:rgba(58,218,112,.5);
          color:#82efa3;
          background:rgba(39,202,96,.09);
          font-size:18px;
        }

        .tr-exerciseProgressText{
          min-width:0;
          display:grid;
          gap:7px;
        }

        .tr-exerciseProgressText strong{
          min-width:0;
          color:rgba(248,251,253,.96);
          font-size:13px;
          line-height:1.22;
          font-weight:950;
          overflow-wrap:anywhere;
          display:-webkit-box;
          -webkit-box-orient:vertical;
          -webkit-line-clamp:2;
          overflow:hidden;
        }

        .tr-exerciseProgressText small{
          width:max-content;
          max-width:100%;
          color:rgba(179,200,214,.52);
          font-size:8px;
          font-weight:1000;
          letter-spacing:.14em;
        }

        .tr-exerciseProgressCard.is-current small{ color:#76d9ff; }
        .tr-exerciseProgressCard.is-next small{ color:#ffc66e; }
        .tr-exerciseProgressCard.is-complete small{ color:#71e493; }

        .tr-exerciseCompletionPanel{
          position:static !important;
          inset:auto !important;
          z-index:auto !important;
          width:100%;
          margin-top:18px;
          display:grid;
          grid-template-columns:minmax(0,1fr) minmax(260px,360px);
          align-items:center;
          gap:18px;
          padding:17px;
          border:1px solid rgba(255,255,255,.105);
          border-radius:19px;
          background:
            radial-gradient(520px 170px at 0 -30%, rgba(0,174,255,.10), transparent 66%),
            linear-gradient(180deg, rgb(17,24,31), rgb(6,10,14));
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.055),
            0 22px 52px rgba(0,0,0,.34);
          backdrop-filter:none !important;
          -webkit-backdrop-filter:none !important;
          opacity:1 !important;
        }

        .tr-exerciseCompletionPanel.is-ready{
          border-color:rgba(36,194,255,.4);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.065),
            0 24px 58px rgba(0,0,0,.36),
            0 0 26px rgba(0,174,255,.08);
        }

        .tr-exerciseCompletionPanel.is-complete,
        .tr-exerciseCompletionPanel.is-sessionComplete{
          border-color:rgba(64,220,120,.39);
          background:
            radial-gradient(520px 170px at 0 -30%, rgba(44,208,103,.105), transparent 66%),
            linear-gradient(180deg, rgb(14,27,20), rgb(5,11,8));
        }

        .tr-exerciseCompletionState{
          min-width:0;
          display:grid;
          gap:7px;
        }

        .tr-exerciseCompletionState strong{
          color:rgba(248,251,253,.96);
          font-size:clamp(17px,2vw,23px);
          line-height:1.14;
          font-weight:1000;
        }

        .tr-exerciseCompletionButton{
          width:100%;
          min-height:52px;
        }

        .tr-exerciseCompletionButton.is-unlock{
          border-color:rgba(255,255,255,.18);
          background:linear-gradient(180deg, rgba(255,255,255,.06), rgba(0,0,0,.14));
        }

        @media (max-width:980px){
          .tr-sessionNavConsole{
            grid-template-columns:104px minmax(0,1fr) 104px;
            gap:10px;
          }
          .tr-sessionNavButton{ min-height:138px; }
          .tr-exerciseProgressGrid{ grid-template-columns:repeat(2,minmax(0,1fr)); }
          .tr-exerciseCompletionPanel{ grid-template-columns:1fr minmax(230px,310px); }
        }

        @media (max-width:720px){
          .tr-sessionEditButton{
            min-width:78px;
            height:42px;
            padding:0 15px;
          }
          .tr-sessionNavConsole{
            grid-template-columns:1fr 1fr;
            grid-template-areas:
              "current current"
              "prev next";
          }
          .tr-sessionCurrentPanel{
            grid-area:current;
            padding:18px 14px;
          }
          .tr-sessionNavButton{
            min-height:50px;
            border-radius:15px;
          }
          .tr-sessionNavButton.is-prev{ grid-area:prev; }
          .tr-sessionNavButton.is-next{ grid-area:next; }
          .tr-sessionCurrentName{ font-size:clamp(22px,7vw,31px); }
          .tr-sessionCurrentTopline{ flex-wrap:wrap; }
          .tr-sessionCurrentMeta span{ font-size:9px; }
          .tr-exerciseProgressPanel{ padding:13px; }
          .tr-exerciseProgressHeader{ align-items:center; }
          .tr-exerciseProgressCount strong{ font-size:22px; }
          .tr-exerciseProgressGrid{ grid-template-columns:1fr; }
          .tr-exerciseProgressCard{ min-height:76px; }
          .tr-exerciseCompletionPanel{
            grid-template-columns:1fr;
            gap:13px;
            padding:14px;
          }
        }

        @media (max-width:430px){
          .tr-exerciseProgressHeader{
            align-items:flex-start;
            flex-direction:column;
            gap:9px;
          }
          .tr-exerciseProgressCount{ align-self:flex-end; }
          .tr-sessionNextLine{ align-items:flex-start; }
        }


        /* Step 1 cumulative mobile refinement */
        @media (max-width:720px){
          .tr-workoutPlayerPage{
            gap:10px !important;
          }

          .tr-workoutCheckinCard .tr-card-head{
            padding:10px 12px 8px;
          }

          .tr-workoutCheckinCard .tr-card-title{
            font-size:11px;
            letter-spacing:.17em;
          }

          .tr-workoutCheckinCard .tr-card-body{
            padding:9px 10px 10px;
          }

          .tr-workoutCheckinCard .tr-rowbox{
            padding:8px !important;
          }

          .tr-workoutCheckinCard .tr-checkinGrid--tight{
            grid-template-columns:repeat(2,minmax(0,1fr)) !important;
            gap:8px;
          }

          .tr-workoutCheckinCard .tr-checkinTile--tight{
            min-width:0;
            padding:10px 5px;
            gap:5px;
            border-radius:13px;
          }

          .tr-workoutCheckinCard .tr-checkinTile--tight .tr-kicker{
            font-size:7.5px;
            letter-spacing:.14em;
            white-space:nowrap;
          }

          .tr-workoutCheckinCard .tr-checkinValue--tight{
            font-size:19px;
            letter-spacing:.015em;
          }

          .tr-workoutSessionCard .tr-card-head{
            display:grid !important;
            grid-template-columns:minmax(0,1fr) auto !important;
            align-items:center !important;
            gap:10px !important;
            padding:11px 12px 10px !important;
          }

          .tr-workoutSessionCard .tr-card-title{
            min-width:0;
            font-size:10.5px;
            line-height:1.35;
            letter-spacing:.15em;
            overflow-wrap:anywhere;
          }

          .tr-workoutSessionCard .tr-card-right{
            width:auto !important;
            min-width:0;
            justify-self:end;
          }

          .tr-sessionEditButton{
            min-width:68px;
            width:auto;
            height:39px;
            padding:0 12px;
            font-size:9px;
            letter-spacing:.11em;
          }

          .tr-workoutSessionCard .tr-card-body{
            gap:12px;
            padding:12px !important;
          }

          .tr-sessionNavConsole{
            gap:9px;
          }

          .tr-sessionCurrentPanel{
            padding:14px 11px 13px;
            gap:8px;
            border-radius:17px;
          }

          .tr-sessionCurrentTopline{
            gap:7px;
            font-size:7.5px;
            letter-spacing:.13em;
          }

          .tr-sessionCurrentState{
            padding:4px 7px;
            font-size:7.5px;
          }

          .tr-sessionCurrentName{
            font-size:clamp(22px,6.8vw,29px);
            line-height:1.04;
          }

          .tr-sessionCurrentMeta{
            gap:6px;
          }

          .tr-sessionCurrentMeta span{
            padding:5px 8px;
            font-size:8px;
          }

          .tr-sessionNextLine{
            gap:7px;
            font-size:9px;
            text-align:center;
          }

          .tr-sessionNavButton{
            min-height:46px;
            border-radius:14px;
            font-size:10px;
            letter-spacing:.12em;
          }

          .tr-sessionNavButton span{
            font-size:18px;
          }

          .tr-exerciseProgressPanel{
            gap:10px;
            padding:12px;
            border-radius:17px;
          }

          .tr-exerciseProgressHeader{
            display:flex;
            flex-direction:row !important;
            align-items:baseline !important;
            justify-content:space-between;
            gap:10px;
          }

          .tr-exerciseProgressHeader > div:first-child{
            gap:0;
          }

          .tr-exerciseProgressCount{
            align-self:auto !important;
            gap:4px;
          }

          .tr-exerciseProgressCount strong{
            font-size:21px;
          }

          .tr-exerciseProgressCount span{
            font-size:8px;
            letter-spacing:.06em;
          }

          .tr-exerciseProgressTrack{
            height:7px;
          }

          .tr-exerciseProgressGrid{
            gap:7px;
          }

          .tr-exerciseProgressCard{
            min-height:58px;
            grid-template-columns:36px minmax(0,1fr);
            gap:10px;
            padding:8px 10px;
            border-radius:14px;
          }

          .tr-exerciseProgressNumber{
            width:34px;
            height:34px;
            border-radius:11px;
            font-size:11px;
          }

          .tr-exerciseProgressCard.is-complete .tr-exerciseProgressNumber{
            font-size:15px;
          }

          .tr-exerciseProgressText{
            grid-template-columns:minmax(0,1fr) auto;
            align-items:center;
            gap:8px;
          }

          .tr-exerciseProgressText strong{
            font-size:11.5px;
            line-height:1.18;
            -webkit-line-clamp:2;
          }

          .tr-exerciseProgressText small{
            justify-self:end;
            font-size:6.8px;
            letter-spacing:.10em;
            white-space:nowrap;
          }

          .tr-exerciseCompletionPanel{
            margin-top:12px;
          }
        }

        @media (max-width:390px){
          .tr-workoutCheckinCard .tr-checkinTile--tight .tr-kicker{
            font-size:6.8px;
            letter-spacing:.10em;
          }

          .tr-workoutCheckinCard .tr-checkinValue--tight{
            font-size:18px;
          }

          .tr-workoutSessionCard .tr-card-title{
            font-size:9.5px;
            letter-spacing:.12em;
          }

          .tr-sessionEditButton{
            min-width:62px;
            padding:0 10px;
          }

          .tr-exerciseProgressText small{
            font-size:6.2px;
          }
        }

        .tr-btn--nextOrange{
          border-color: rgba(255,140,0,.70) !important;
          background: linear-gradient(180deg, rgba(255,140,0,.30), rgba(255,80,80,.16)) !important;
          box-shadow:
            0 0 0 1px rgba(255,140,0,.16) inset,
            0 18px 55px rgba(0,0,0,.45),
            0 0 18px rgba(255,140,0,.22),
            0 0 34px rgba(255,80,80,.12) !important;
        }
        .tr-btn--nextOrange:disabled,
        .tr-btn--prevOrange:disabled{
          opacity:.55;
          box-shadow:none !important;
          background: linear-gradient(180deg, rgba(255,255,255,.05), rgba(0,0,0,.12)) !important;
          border-color: rgba(255,255,255,.12) !important;
        }
        .tr-btn--prevOrange{
          border-color: rgba(255,140,0,.70) !important;
          background: linear-gradient(180deg, rgba(255,140,0,.30), rgba(255,80,80,.16)) !important;
          box-shadow:
            0 0 0 1px rgba(255,140,0,.16) inset,
            0 18px 55px rgba(0,0,0,.45),
            0 0 18px rgba(255,140,0,.22),
            0 0 34px rgba(255,80,80,.12) !important;
        }
        .tr-progressionToggle{
          width: 100%;
          border: 0;
          background: transparent;
          color: inherit;
          padding: 0;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          text-align: left;
          cursor: pointer;
        }
        .tr-progressionToggleText{
          min-width: 0;
          display: grid;
          gap: 4px;
        }
        .tr-progressionToggleRight{
          flex: 0 0 auto;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
        }
        .tr-progressionChevron{
          width: 32px;
          height: 32px;
          border-radius: 10px;
          display: grid;
          place-items: center;
          border: 1px solid rgba(0,170,255,.38);
          background: rgba(0,170,255,.10);
          color: rgba(180,235,255,.98);
          font-size: 13px;
        }
        .tr-progressionToggleLabel{
          color: rgba(190,225,242,.76);
          font-size: 11px;
          font-weight: 1000;
          letter-spacing: .12em;
        }
        .tr-progressionBody{
          display: grid;
          gap: 12px;
          margin-top: 12px;
        }
        .tr-previousPerformance.is-collapsed{
          padding-top: 12px;
          padding-bottom: 12px;
        }
        @media (max-width: 720px){
          .tr-progressionToggle{
            align-items: flex-start;
          }
          .tr-progressionToggleRight{
            gap: 6px;
          }
          .tr-progressionToggleLabel{
            display: none;
          }
          .tr-progressionConfidence{
            font-size: 9px !important;
            white-space: nowrap;
          }
          .tr-progressionChevron{
            width: 30px;
            height: 30px;
          }
        }
        .tr-doneCountPill{
          padding: 0 14px;
          border-radius: 999px;
          border: 1px solid rgba(0,170,255,.46);
          background:
            linear-gradient(180deg, rgba(255,255,255,.10) 0%, rgba(255,255,255,.03) 18%, rgba(255,255,255,0) 46%),
            radial-gradient(520px 180px at 50% 55%, rgba(0,170,255,.22) 0%, rgba(0,170,255,.12) 34%, rgba(0,0,0,0) 76%),
            linear-gradient(180deg, rgba(12,18,30,.92), rgba(0,0,0,.22));
          color: rgba(235,252,255,.94);
          font-weight: 1100;
          letter-spacing: .14em;
          text-transform: uppercase;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          box-shadow:
            inset 0 0 0 1px rgba(0,0,0,.55),
            inset 0 0 0 2px rgba(255,255,255,.04),
            inset 0 0 0 3px rgba(0,170,255,.08),
            inset 0 1px 0 rgba(255,255,255,.08),
            0 18px 55px rgba(0,0,0,.45),
            0 0 18px rgba(0,170,255,.12),
            0 0 52px rgba(0,170,255,.08);
          text-shadow:
            0 1px 0 rgba(0,0,0,.80),
            0 0 14px rgba(0,170,255,.10);
        }
        .tr-checkinGrid--tight{
          display:grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          width: 100%;
        }
        @media (max-width: 980px){
          .tr-checkinGrid--tight{ grid-template-columns: 1fr; }
        }
        .tr-checkinTile--tight{
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,.10);
          background: linear-gradient(180deg, rgba(255,255,255,.045), rgba(0,0,0,.12));
          box-shadow: inset 0 1px 0 rgba(255,255,255,.05);
          padding: 12px 12px;
          display: grid;
          gap: 6px;
          justify-items: center;
          text-align: center;
        }
        .tr-checkinValue--tight{
          font-weight: 1100;
          font-size: 22px;
          line-height: 1.05;
          font-variant-numeric: tabular-nums;
          letter-spacing: .04em;
          color: rgba(255,255,255,.94);
        }

        /* ============================================================
           V13.6 PREMIUM WORKOUT UI
           ============================================================ */
        .tr-workoutCheckinCard .tr-card-head{
          border-bottom-color:rgba(65,198,255,.10);
        }
        .tr-checkinContext{
          color:rgba(150,217,245,.74);
          font-size:9px;
          font-weight:1000;
          letter-spacing:.16em;
          text-transform:uppercase;
          white-space:nowrap;
        }
        .tr-sessionIntel{
          display:grid;
          gap:12px;
        }
        .tr-sessionIntelPrimary{
          display:grid;
          grid-template-columns:1.05fr .8fr 1.15fr;
          gap:10px;
        }
        .tr-sessionIntelMetric{
          min-width:0;
          min-height:116px;
          display:grid;
          align-content:center;
          gap:8px;
          padding:16px 18px;
          border:1px solid rgba(255,255,255,.085);
          border-radius:17px;
          background:
            radial-gradient(280px 110px at 12% -20%, rgba(0,181,255,.105), transparent 68%),
            linear-gradient(180deg, rgba(255,255,255,.035), rgba(0,0,0,.13));
          box-shadow:inset 0 1px 0 rgba(255,255,255,.05),0 18px 42px rgba(0,0,0,.18);
        }
        .tr-sessionIntelMetric strong{
          min-width:0;
          color:#f9fcff;
          font-size:clamp(24px,2.7vw,37px);
          line-height:1;
          font-weight:1000;
          letter-spacing:-.025em;
          font-variant-numeric:tabular-nums;
          overflow-wrap:anywhere;
          text-shadow:0 2px 0 rgba(0,0,0,.68);
        }
        .tr-sessionIntelMetric.is-last strong{
          font-size:clamp(20px,2.2vw,30px);
          color:#ffd183;
        }
        .tr-sessionIntelMetric > span{
          color:rgba(186,208,222,.62);
          font-size:8.5px;
          font-weight:950;
          letter-spacing:.11em;
          text-transform:uppercase;
          line-height:1.3;
        }
        .tr-sessionIntelTrend.is-positive,
        .tr-sessionIntelDelta.is-positive{ color:#7deca0 !important; }
        .tr-sessionIntelTrend.is-negative,
        .tr-sessionIntelDelta.is-negative{ color:#ffab70 !important; }

        .tr-sessionIntelPerformance{
          display:grid;
          gap:13px;
          padding:17px 18px;
          border:1px solid rgba(63,199,255,.16);
          border-radius:18px;
          background:
            radial-gradient(580px 170px at 0 -25%, rgba(0,174,255,.115), transparent 67%),
            linear-gradient(180deg, rgba(10,20,28,.98), rgba(4,8,12,.99));
          box-shadow:inset 0 1px 0 rgba(255,255,255,.055),0 20px 48px rgba(0,0,0,.22);
        }
        .tr-sessionIntelPerformanceHead{
          display:flex;
          align-items:end;
          justify-content:space-between;
          gap:16px;
        }
        .tr-sessionIntelPerformanceHead > div{
          display:grid;
          gap:5px;
        }
        .tr-sessionIntelPerformanceHead strong{
          color:rgba(244,249,252,.9);
          font-size:12px;
          font-weight:950;
          letter-spacing:.03em;
        }
        .tr-sessionIntelDate{
          color:rgba(255,205,125,.74);
          font-size:9px;
          font-weight:1000;
          letter-spacing:.14em;
          white-space:nowrap;
        }
        .tr-sessionIntelPerformanceGrid{
          display:grid;
          grid-template-columns:repeat(3,minmax(0,1fr));
          border-top:1px solid rgba(255,255,255,.07);
          border-bottom:1px solid rgba(255,255,255,.07);
        }
        .tr-sessionIntelPerformanceGrid > div{
          min-width:0;
          display:grid;
          gap:6px;
          padding:14px 16px 13px;
        }
        .tr-sessionIntelPerformanceGrid > div + div{
          border-left:1px solid rgba(255,255,255,.07);
        }
        .tr-sessionIntelPerformanceGrid strong{
          color:#fff;
          font-size:clamp(20px,2.4vw,31px);
          line-height:1;
          font-weight:1000;
          letter-spacing:-.02em;
          font-variant-numeric:tabular-nums;
          overflow-wrap:anywhere;
        }
        .tr-sessionIntelPerformanceGrid span,
        .tr-sessionIntelWeek span{
          color:rgba(181,204,218,.58);
          font-size:8px;
          font-weight:1000;
          letter-spacing:.12em;
          text-transform:uppercase;
        }
        .tr-sessionIntelDelta{
          color:rgba(196,218,230,.66);
          font-size:9px;
          font-weight:1000;
          letter-spacing:.105em;
          text-transform:uppercase;
        }

        .tr-sessionIntelWeek{
          display:grid;
          grid-template-columns:auto minmax(160px,1fr) auto;
          align-items:center;
          gap:18px;
          padding:14px 17px;
          border:1px solid rgba(255,255,255,.075);
          border-radius:17px;
          background:linear-gradient(180deg, rgba(255,255,255,.025), rgba(0,0,0,.12));
        }
        .tr-sessionIntelWeekCopy,
        .tr-sessionIntelWeekTime{
          display:grid;
          gap:4px;
        }
        .tr-sessionIntelWeekCopy strong,
        .tr-sessionIntelWeekTime strong{
          color:#f6fbff;
          font-size:20px;
          line-height:1;
          font-weight:1000;
          font-variant-numeric:tabular-nums;
        }
        .tr-sessionIntelWeekTime{
          justify-items:end;
          text-align:right;
        }
        .tr-sessionIntelWeekRail{
          min-width:0;
          display:grid;
          grid-auto-flow:column;
          grid-auto-columns:minmax(18px,1fr);
          gap:6px;
        }
        .tr-sessionIntelWeekRail span{
          height:7px;
          border-radius:999px;
          background:rgba(255,255,255,.07);
          box-shadow:inset 0 1px 2px rgba(0,0,0,.65);
        }
        .tr-sessionIntelWeekRail span.is-complete{
          background:linear-gradient(90deg,#18b657,#6df19a);
          box-shadow:0 0 14px rgba(68,229,128,.16);
        }

        .tr-sessionNavConsole{
          grid-template-columns:minmax(155px,190px) minmax(0,1fr) minmax(155px,190px);
          gap:12px;
        }
        .tr-sessionNavButton{
          min-height:146px;
          justify-content:flex-start;
          gap:12px;
          padding:16px 15px;
          text-align:left;
          overflow:hidden;
        }
        .tr-sessionNavButton.is-next{
          justify-content:flex-end;
          text-align:right;
        }
        .tr-sessionNavArrow{
          flex:0 0 auto;
          width:34px;
          height:34px;
          display:grid;
          place-items:center;
          border:1px solid rgba(80,207,255,.22);
          border-radius:12px;
          background:rgba(0,174,255,.06);
          color:#8bdfff !important;
          font-size:19px !important;
        }
        .tr-sessionNavButton.is-next .tr-sessionNavArrow{
          border-color:rgba(255,172,54,.28);
          background:rgba(255,148,0,.07);
          color:#ffc164 !important;
        }
        .tr-sessionNavCopy{
          min-width:0;
          display:grid;
          gap:7px;
          text-transform:none;
          letter-spacing:normal;
        }
        .tr-sessionNavCopy small{
          color:rgba(164,201,220,.55);
          font-size:7.5px;
          font-weight:1000;
          letter-spacing:.16em;
          text-transform:uppercase;
        }
        .tr-sessionNavButton.is-next .tr-sessionNavCopy small{
          color:rgba(255,192,96,.66);
        }
        .tr-sessionNavCopy strong{
          min-width:0;
          color:rgba(246,250,253,.93);
          font-size:12px;
          line-height:1.22;
          font-weight:1000;
          overflow-wrap:anywhere;
          display:-webkit-box;
          -webkit-box-orient:vertical;
          -webkit-line-clamp:3;
          overflow:hidden;
        }
        .tr-sessionNavButton:disabled{ opacity:.48; }
        .tr-sessionNavButton:disabled .tr-sessionNavCopy strong{ color:rgba(196,211,220,.5); }
        .tr-sessionCurrentPanel{ min-height:146px; }

        .tr-exerciseProgressPanel{
          gap:15px;
          padding:18px;
          border-color:rgba(54,199,255,.13);
          background:
            radial-gradient(720px 210px at 3% -28%, rgba(0,178,255,.11), transparent 64%),
            linear-gradient(180deg, rgba(10,16,22,.98), rgba(4,8,12,.99));
          box-shadow:inset 0 1px 0 rgba(255,255,255,.05),0 18px 46px rgba(0,0,0,.18);
        }
        .tr-exerciseProgressTitle{
          display:grid;
          gap:5px;
        }
        .tr-exerciseProgressTitle strong{
          color:rgba(238,246,251,.82);
          font-size:12px;
          font-weight:950;
          letter-spacing:.025em;
        }
        .tr-exerciseProgressCount{
          display:grid;
          justify-items:end;
          gap:5px;
          line-height:1;
        }
        .tr-exerciseProgressCount strong{
          color:#fff;
          font-size:34px;
          line-height:.9;
          font-weight:1000;
          letter-spacing:-.045em;
          text-shadow:0 2px 0 rgba(0,0,0,.74),0 0 24px rgba(255,190,74,.10);
        }
        .tr-exerciseProgressCount span{
          color:#ffd080;
          font-size:8px;
          letter-spacing:.17em;
        }
        .tr-exerciseProgressSegments{
          display:grid;
          gap:7px;
        }
        .tr-exerciseProgressSegment{
          min-width:0;
          height:12px;
          padding:0;
          overflow:hidden;
          border:1px solid rgba(255,255,255,.075);
          border-radius:999px;
          background:rgba(255,255,255,.05);
          color:transparent;
          cursor:pointer;
          transition:transform .16s ease,border-color .16s ease,box-shadow .16s ease,background .16s ease;
        }
        .tr-exerciseProgressSegment span{ opacity:0; }
        .tr-exerciseProgressSegment.is-complete{
          border-color:rgba(76,229,132,.42);
          background:linear-gradient(90deg,#16a84f,#6df19b);
          box-shadow:0 0 15px rgba(69,226,128,.14);
        }
        .tr-exerciseProgressSegment.is-current{
          border-color:rgba(57,206,255,.72);
          background:linear-gradient(90deg,#079bd7,#55d8ff);
          box-shadow:0 0 18px rgba(21,187,244,.22);
        }
        .tr-exerciseProgressSegment.is-next{
          border-color:rgba(255,179,68,.58);
          background:linear-gradient(90deg,rgba(255,151,0,.72),rgba(255,201,104,.88));
          box-shadow:0 0 15px rgba(255,159,29,.13);
        }
        .tr-exerciseProgressSegment:hover,
        .tr-exerciseProgressSegment:focus-visible{ transform:scaleY(1.18); }

        .tr-exerciseProgressGrid{
          grid-template-columns:repeat(3,minmax(0,1fr));
          gap:10px;
        }
        .tr-exerciseProgressCard{
          min-height:92px;
          grid-template-columns:46px minmax(0,1fr);
          gap:12px;
          padding:13px 14px;
          border-radius:17px;
        }
        .tr-exerciseProgressCard.is-current,
        .tr-exerciseProgressCard.is-selected.is-current{
          transform:translateY(-1px);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.075),
            0 17px 34px rgba(0,0,0,.22),
            0 0 30px rgba(0,181,255,.14);
        }
        .tr-exerciseProgressNumber{
          width:44px;
          height:44px;
          border-radius:14px;
          font-size:13px;
        }
        .tr-exerciseProgressText strong{
          font-size:14px;
          line-height:1.2;
        }
        .tr-exerciseProgressText small{
          font-size:7.5px;
          letter-spacing:.15em;
        }

        @media (max-width:980px){
          .tr-sessionIntelPrimary{ grid-template-columns:repeat(3,minmax(0,1fr)); }
          .tr-sessionNavConsole{ grid-template-columns:140px minmax(0,1fr) 140px; }
        }

        @media (max-width:720px){
          .tr-workoutCheckinCard .tr-card-head{
            display:grid !important;
            grid-template-columns:minmax(0,1fr) auto !important;
            align-items:center !important;
            gap:8px !important;
            padding:11px 12px 9px !important;
          }
          .tr-workoutCheckinCard .tr-card-title{
            font-size:10.5px;
            letter-spacing:.15em;
          }
          .tr-workoutCheckinCard .tr-card-right{ min-width:0; }
          .tr-checkinContext{
            max-width:138px;
            overflow:hidden;
            text-overflow:ellipsis;
            font-size:7px;
            letter-spacing:.11em;
          }
          .tr-workoutCheckinCard .tr-card-body{ padding:10px !important; }
          .tr-sessionIntel{ gap:9px; }
          .tr-sessionIntelPrimary{
            grid-template-columns:1fr 1fr;
            gap:8px;
          }
          .tr-sessionIntelMetric{
            min-height:92px;
            padding:12px 11px;
            gap:6px;
            border-radius:15px;
          }
          .tr-sessionIntelMetric.is-last{
            grid-column:1 / -1;
            min-height:80px;
            grid-template-columns:minmax(0,1fr) auto;
            align-items:center;
          }
          .tr-sessionIntelMetric.is-last .tr-kicker,
          .tr-sessionIntelMetric.is-last > span{ grid-column:1; }
          .tr-sessionIntelMetric.is-last strong{
            grid-column:2;
            grid-row:1 / span 2;
            justify-self:end;
            text-align:right;
            font-size:22px;
          }
          .tr-sessionIntelMetric strong{ font-size:25px; }
          .tr-sessionIntelMetric > span{
            font-size:7px;
            letter-spacing:.085em;
          }

          .tr-sessionIntelPerformance{
            gap:10px;
            padding:13px 12px;
            border-radius:16px;
          }
          .tr-sessionIntelPerformanceHead{ align-items:start; }
          .tr-sessionIntelPerformanceHead strong{ font-size:10px; }
          .tr-sessionIntelDate{ font-size:7px; }
          .tr-sessionIntelPerformanceGrid{
            grid-template-columns:repeat(3,minmax(0,1fr));
          }
          .tr-sessionIntelPerformanceGrid > div{
            gap:5px;
            padding:11px 8px 10px;
          }
          .tr-sessionIntelPerformanceGrid strong{
            font-size:clamp(17px,5.1vw,22px);
          }
          .tr-sessionIntelPerformanceGrid span{
            font-size:6.5px;
            letter-spacing:.08em;
          }
          .tr-sessionIntelDelta{
            font-size:7px;
            line-height:1.35;
            letter-spacing:.075em;
          }

          .tr-sessionIntelWeek{
            grid-template-columns:auto minmax(70px,1fr) auto;
            gap:10px;
            padding:12px;
            border-radius:15px;
          }
          .tr-sessionIntelWeekCopy strong,
          .tr-sessionIntelWeekTime strong{ font-size:18px; }
          .tr-sessionIntelWeekRail{ gap:4px; }
          .tr-sessionIntelWeekRail span{ height:6px; }
          .tr-sessionIntelWeek span{
            font-size:6.5px;
            letter-spacing:.08em;
          }

          .tr-sessionNavConsole{
            grid-template-columns:1fr 1fr;
            grid-template-areas:"current current" "prev next";
            gap:9px;
          }
          .tr-sessionCurrentPanel{
            grid-area:current;
            min-height:0;
          }
          .tr-sessionNavButton{
            min-height:68px;
            padding:10px;
            gap:8px;
            border-radius:15px;
          }
          .tr-sessionNavButton.is-prev{ grid-area:prev; }
          .tr-sessionNavButton.is-next{ grid-area:next; }
          .tr-sessionNavArrow{
            width:29px;
            height:29px;
            border-radius:10px;
            font-size:16px !important;
          }
          .tr-sessionNavCopy{ gap:4px; }
          .tr-sessionNavCopy small{
            font-size:6.5px;
            letter-spacing:.12em;
          }
          .tr-sessionNavCopy strong{
            font-size:9.5px;
            -webkit-line-clamp:2;
          }

          .tr-exerciseProgressPanel{
            padding:13px 11px 12px;
            gap:12px;
          }
          .tr-exerciseProgressHeader{
            align-items:end !important;
            flex-direction:row !important;
          }
          .tr-exerciseProgressTitle strong{ font-size:9px; }
          .tr-exerciseProgressCount{ min-width:72px; }
          .tr-exerciseProgressCount strong{ font-size:31px; }
          .tr-exerciseProgressCount span{ font-size:7px; }
          .tr-exerciseProgressSegments{ gap:5px; }
          .tr-exerciseProgressSegment{ height:10px; }

          .tr-exerciseProgressGrid{
            display:flex !important;
            gap:8px !important;
            overflow-x:auto;
            overflow-y:hidden;
            overscroll-behavior-x:contain;
            scroll-snap-type:x proximity;
            padding:1px 2px 7px;
            scrollbar-width:none;
          }
          .tr-exerciseProgressGrid::-webkit-scrollbar{ display:none; }
          .tr-exerciseProgressCard{
            flex:0 0 min(72vw,280px);
            min-height:74px;
            grid-template-columns:39px minmax(0,1fr);
            padding:10px;
            scroll-snap-align:start;
          }
          .tr-exerciseProgressCard.is-selected{
            order:-1;
            flex-basis:calc(100% - 2px);
            min-height:88px;
          }
          .tr-exerciseProgressNumber{
            width:38px;
            height:38px;
            border-radius:12px;
          }
          .tr-exerciseProgressCard.is-selected .tr-exerciseProgressNumber{
            width:42px;
            height:42px;
          }
          .tr-exerciseProgressText{
            display:grid !important;
            grid-template-columns:1fr !important;
            align-items:start !important;
            gap:6px !important;
          }
          .tr-exerciseProgressText strong{
            font-size:12px;
            -webkit-line-clamp:2;
          }
          .tr-exerciseProgressCard.is-selected .tr-exerciseProgressText strong{
            font-size:14px;
          }
          .tr-exerciseProgressText small{
            justify-self:start !important;
            font-size:7px !important;
          }
        }

        @media (max-width:390px){
          .tr-sessionIntelMetric strong{ font-size:22px; }
          .tr-sessionIntelMetric.is-last strong{ font-size:19px; }
          .tr-sessionIntelPerformanceGrid strong{ font-size:16px; }
          .tr-sessionIntelWeekCopy strong,
          .tr-sessionIntelWeekTime strong{ font-size:16px; }
          .tr-sessionNavCopy strong{ font-size:8.8px; }
          .tr-exerciseProgressCount strong{ font-size:29px; }
        }

        /* ============================================================
           V13.6.1 — FLAGSHIP ROADMAP + SESSION DATA CORRECTIONS
           ============================================================ */

        /* Session Check-In: clearer hierarchy, no fake weekly target. */
        .tr-sessionIntelMetric.is-protein > span{
          color:rgba(196,216,228,.70);
        }

        .tr-sessionIntelPerformance{
          padding:15px 18px 14px;
        }

        .tr-sessionIntelPerformanceHead strong{
          font-size:11px;
          color:rgba(242,248,252,.86);
        }

        .tr-sessionIntelPerformanceGrid strong{
          letter-spacing:-.035em;
        }

        .tr-sessionIntelDelta{
          min-height:16px;
          display:flex;
          align-items:center;
        }

        .tr-sessionIntelWeek{
          grid-template-columns:minmax(128px,auto) minmax(80px,1fr) minmax(128px,auto);
          gap:18px;
        }

        .tr-sessionIntelWeekCopy strong,
        .tr-sessionIntelWeekTime strong{
          font-size:26px;
          letter-spacing:-.03em;
        }

        .tr-sessionIntelWeekDivider{
          min-width:70px;
          display:flex;
          align-items:center;
          justify-content:center;
        }

        .tr-sessionIntelWeekDivider span{
          width:100%;
          height:1px;
          background:linear-gradient(
            90deg,
            transparent,
            rgba(84,211,255,.18) 22%,
            rgba(255,255,255,.13) 50%,
            rgba(84,211,255,.18) 78%,
            transparent
          );
          box-shadow:0 0 16px rgba(56,196,255,.06);
        }

        /* Previous / Next: premium dark surfaces and stronger typography. */
        .tr-sessionNavButton{
          border-color:rgba(116,174,202,.15);
          background:
            radial-gradient(220px 120px at 50% -35%, rgba(51,184,235,.07), transparent 72%),
            linear-gradient(180deg, rgba(16,25,34,.98), rgba(5,9,14,.995));
        }

        .tr-sessionNavButton.is-next{
          border-color:rgba(226,193,134,.26);
          background:
            radial-gradient(220px 120px at 76% -35%, rgba(225,190,126,.085), transparent 72%),
            linear-gradient(180deg, rgba(17,22,27,.99), rgba(6,9,13,.995));
        }

        .tr-sessionNavArrow{
          border-color:rgba(89,202,244,.25);
          background:linear-gradient(180deg,rgba(25,180,232,.09),rgba(0,0,0,.08));
        }

        .tr-sessionNavButton.is-next .tr-sessionNavArrow{
          border-color:rgba(232,201,148,.34);
          background:linear-gradient(180deg,rgba(224,188,124,.10),rgba(0,0,0,.08));
          color:#e9cb98 !important;
        }

        .tr-sessionNavCopy small{
          font-size:8.5px;
          color:rgba(156,205,228,.66);
        }

        .tr-sessionNavButton.is-next .tr-sessionNavCopy small{
          color:rgba(232,202,151,.78);
        }

        .tr-sessionNavCopy strong{
          font-size:13.5px;
          line-height:1.18;
          letter-spacing:-.01em;
        }

        .tr-sessionNavButton:disabled{
          opacity:.70;
          border-color:rgba(255,255,255,.07);
          background:linear-gradient(180deg,rgba(255,255,255,.02),rgba(0,0,0,.13));
        }

        .tr-sessionNavButton:disabled .tr-sessionNavArrow{
          opacity:.38;
        }

        /* Live completion counter. The completed number moves cyan -> green
           as the workout fills, while /total stays crisp and secondary. */
        .tr-exerciseProgressCount{
          min-width:104px;
          display:grid;
          justify-items:end;
          align-content:center;
          gap:5px;
        }

        .tr-exerciseProgressCountValue{
          display:flex;
          align-items:flex-end;
          line-height:.8;
          white-space:nowrap;
          filter:drop-shadow(0 4px 8px rgba(0,0,0,.46));
        }

        .tr-exerciseProgressDone{
          color:hsl(calc(191 - (var(--tr-progress) * 54)) 88% 62%) !important;
          font-size:46px !important;
          line-height:.78 !important;
          font-weight:1100 !important;
          letter-spacing:-.075em !important;
          text-shadow:
            0 2px 0 rgba(0,0,0,.88),
            0 0 16px hsl(calc(191 - (var(--tr-progress) * 54)) 88% 52% / .34),
            0 0 34px hsl(calc(191 - (var(--tr-progress) * 54)) 88% 52% / .15) !important;
          transition:color .35s ease,text-shadow .35s ease,transform .25s ease;
        }

        .tr-exerciseProgressTotal{
          margin-left:5px;
          padding-bottom:2px;
          color:rgba(244,249,252,.94) !important;
          font-size:26px !important;
          line-height:.85 !important;
          font-weight:1000 !important;
          letter-spacing:-.045em !important;
        }

        .tr-exerciseProgressCountLabel{
          color:rgba(218,228,235,.66) !important;
          font-size:7.5px !important;
          font-weight:1000 !important;
          letter-spacing:.19em !important;
        }

        /* One seamless progress strip with internal checkpoints, no gaps. */
        .tr-exerciseProgressRail{
          position:relative;
          height:14px;
          overflow:hidden;
          border:1px solid rgba(142,196,219,.13);
          border-radius:999px;
          background:
            linear-gradient(180deg,rgba(255,255,255,.055),rgba(0,0,0,.18)),
            rgba(5,10,15,.98);
          box-shadow:
            inset 0 2px 5px rgba(0,0,0,.78),
            inset 0 0 0 1px rgba(255,255,255,.018),
            0 8px 22px rgba(0,0,0,.18);
          isolation:isolate;
        }

        .tr-exerciseProgressRailFill{
          position:absolute;
          z-index:2;
          inset:0 auto 0 0;
          border-radius:999px;
          background:
            linear-gradient(90deg,#16a8db 0%,#38d4de 55%,#66e49a 100%);
          box-shadow:
            0 0 17px rgba(41,202,229,.28),
            inset 0 1px 0 rgba(255,255,255,.30);
          transition:width .38s cubic-bezier(.22,.75,.2,1);
        }

        .tr-exerciseProgressRailCurrent{
          position:absolute;
          z-index:1;
          top:0;
          bottom:0;
          background:
            linear-gradient(
              90deg,
              rgba(25,179,231,.17),
              rgba(58,210,255,.38),
              rgba(25,179,231,.12)
            );
          box-shadow:
            inset 1px 0 0 rgba(88,219,255,.24),
            inset -1px 0 0 rgba(88,219,255,.18),
            0 0 18px rgba(38,193,246,.12);
          animation:tr-roadmap-current-breathe 2.8s ease-in-out infinite;
        }

        .tr-exerciseProgressRailCheckpoints{
          position:absolute;
          z-index:3;
          inset:0;
          pointer-events:none;
        }

        .tr-exerciseProgressRailCheckpoints i{
          position:absolute;
          top:3px;
          bottom:3px;
          width:1px;
          transform:translateX(-.5px);
          background:rgba(220,238,246,.18);
          box-shadow:0 0 4px rgba(0,0,0,.45);
        }

        .tr-exerciseProgressRailEdge{
          position:absolute;
          z-index:4;
          top:50%;
          width:8px;
          height:8px;
          transform:translate(-50%,-50%);
          border-radius:50%;
          background:#7ce9ec;
          box-shadow:
            0 0 0 3px rgba(67,219,225,.13),
            0 0 13px rgba(82,225,229,.72);
          transition:left .38s cubic-bezier(.22,.75,.2,1);
        }

        @keyframes tr-roadmap-current-breathe{
          0%,100%{ opacity:.52; }
          50%{ opacity:.95; }
        }

        /* Flagship roadmap cards. */
        .tr-exerciseProgressGrid{
          gap:11px;
        }

        .tr-exerciseProgressCard{
          position:relative;
          isolation:isolate;
          overflow:hidden;
          min-height:98px;
          border:1px solid rgba(130,169,190,.13);
          border-radius:18px;
          background:
            radial-gradient(260px 110px at 12% -35%,rgba(84,157,194,.055),transparent 72%),
            linear-gradient(180deg,rgba(17,24,31,.985),rgba(5,9,14,.995));
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.045),
            0 13px 28px rgba(0,0,0,.17);
          transition:
            transform .18s ease,
            border-color .18s ease,
            box-shadow .18s ease,
            background .18s ease;
        }

        .tr-exerciseProgressCard::before{
          content:"";
          position:absolute;
          z-index:-1;
          left:11px;
          right:11px;
          top:0;
          height:2px;
          border-radius:0 0 99px 99px;
          background:rgba(130,180,204,.13);
          opacity:.75;
        }

        .tr-exerciseProgressCard::after{
          content:"";
          position:absolute;
          z-index:-2;
          inset:0;
          opacity:0;
          transition:opacity .2s ease;
        }

        .tr-exerciseProgressCard:hover,
        .tr-exerciseProgressCard:focus-visible{
          transform:translateY(-2px);
          border-color:rgba(118,199,232,.28);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.06),
            0 18px 38px rgba(0,0,0,.24);
        }

        .tr-exerciseProgressCard.is-current,
        .tr-exerciseProgressCard.is-selected.is-current{
          border-color:rgba(61,208,255,.64);
          background:
            radial-gradient(340px 150px at 8% -26%,rgba(14,190,249,.22),transparent 68%),
            linear-gradient(180deg,rgba(9,30,43,.995),rgba(3,10,16,.998));
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.09),
            inset 0 0 34px rgba(0,177,239,.045),
            0 19px 42px rgba(0,0,0,.27),
            0 0 30px rgba(0,181,242,.13);
        }

        .tr-exerciseProgressCard.is-current::before{
          background:linear-gradient(90deg,transparent,#42d5ff 18%,#8beaff 50%,#42d5ff 82%,transparent);
          opacity:1;
          box-shadow:0 0 12px rgba(61,210,255,.35);
        }

        .tr-exerciseProgressCard.is-current::after{
          opacity:1;
          background:linear-gradient(110deg,transparent 12%,rgba(64,215,255,.035) 48%,transparent 70%);
          animation:tr-card-current-sheen 5.2s ease-in-out infinite;
        }

        @keyframes tr-card-current-sheen{
          0%,45%{ transform:translateX(-35%); opacity:0; }
          58%{ opacity:1; }
          78%,100%{ transform:translateX(35%); opacity:0; }
        }

        /* UP NEXT: premium champagne accent on a black/glass surface.
           No dark orange card fill. */
        .tr-exerciseProgressCard.is-next{
          border-color:rgba(228,197,143,.34);
          background:
            radial-gradient(300px 130px at 84% -35%,rgba(225,192,132,.105),transparent 70%),
            linear-gradient(180deg,rgba(18,22,26,.995),rgba(6,9,13,.998));
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.055),
            0 16px 34px rgba(0,0,0,.21);
        }

        .tr-exerciseProgressCard.is-next::before{
          background:linear-gradient(90deg,transparent,#d9b879 20%,#f0d39c 50%,#d9b879 80%,transparent);
          opacity:.9;
          box-shadow:0 0 9px rgba(227,193,133,.14);
        }

        .tr-exerciseProgressCard.is-complete{
          border-color:rgba(92,222,156,.28);
          background:
            radial-gradient(280px 120px at 10% -35%,rgba(76,215,153,.10),transparent 70%),
            linear-gradient(180deg,rgba(12,24,24,.99),rgba(5,10,13,.998));
        }

        .tr-exerciseProgressCard.is-complete::before{
          background:linear-gradient(90deg,transparent,#52d59c 20%,#83ebbc 50%,#52d59c 80%,transparent);
          opacity:.72;
        }

        .tr-exerciseProgressCard.is-remaining{
          border-color:rgba(121,159,180,.12);
        }

        .tr-exerciseProgressNumber{
          width:46px;
          height:46px;
          border-radius:15px;
          border-color:rgba(120,185,216,.18);
          color:rgba(220,236,244,.88);
          background:
            linear-gradient(180deg,rgba(255,255,255,.045),rgba(0,0,0,.12)),
            rgba(9,15,21,.92);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.05),
            0 7px 18px rgba(0,0,0,.18);
        }

        .tr-exerciseProgressCard.is-current .tr-exerciseProgressNumber{
          border-color:rgba(61,211,255,.52);
          color:#c8f5ff;
          background:linear-gradient(180deg,rgba(20,189,241,.18),rgba(5,54,72,.25));
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.10),
            0 0 20px rgba(21,190,244,.12);
        }

        .tr-exerciseProgressCard.is-next .tr-exerciseProgressNumber{
          border-color:rgba(229,198,145,.42);
          color:#f1d49f;
          background:linear-gradient(180deg,rgba(225,190,128,.105),rgba(46,37,24,.16));
          box-shadow:inset 0 1px 0 rgba(255,255,255,.07);
        }

        .tr-exerciseProgressCard.is-complete .tr-exerciseProgressNumber{
          border-color:rgba(94,224,160,.38);
          color:#8ceab9;
          background:linear-gradient(180deg,rgba(69,211,145,.11),rgba(11,48,35,.15));
        }

        .tr-exerciseProgressText{
          gap:7px;
        }

        .tr-exerciseProgressText strong{
          color:rgba(250,252,254,.96);
          font-size:14.5px;
          letter-spacing:-.012em;
        }

        .tr-exerciseProgressText small{
          font-size:7.5px;
          letter-spacing:.17em;
        }

        .tr-exerciseProgressCard.is-current small{
          color:#80e3ff;
        }

        .tr-exerciseProgressCard.is-next small{
          color:#e7c68c;
        }

        .tr-exerciseProgressCard.is-complete small{
          color:#7ae4ad;
        }

        .tr-exerciseProgressCard.is-remaining small{
          color:rgba(161,187,200,.43);
        }

        @media (max-width:720px){
          .tr-sessionIntelWeek{
            grid-template-columns:1fr auto 1fr;
            gap:10px;
          }

          .tr-sessionIntelWeekDivider{
            width:1px;
            min-width:1px;
            height:36px;
          }

          .tr-sessionIntelWeekDivider span{
            width:1px;
            height:100%;
            background:linear-gradient(180deg,transparent,rgba(89,210,255,.22),transparent);
          }

          .tr-sessionIntelWeekCopy strong,
          .tr-sessionIntelWeekTime strong{
            font-size:22px;
          }

          .tr-sessionNavCopy strong{
            font-size:11px;
          }

          .tr-sessionNavCopy small{
            font-size:7px;
          }

          .tr-exerciseProgressCount{
            min-width:92px;
          }

          .tr-exerciseProgressDone{
            font-size:42px !important;
          }

          .tr-exerciseProgressTotal{
            font-size:23px !important;
          }

          .tr-exerciseProgressRail{
            height:13px;
          }

          .tr-exerciseProgressCard{
            min-height:82px;
            border-radius:16px;
          }

          .tr-exerciseProgressCard.is-selected{
            min-height:96px;
          }

          .tr-exerciseProgressText strong{
            font-size:12.5px;
          }

          .tr-exerciseProgressCard.is-selected .tr-exerciseProgressText strong{
            font-size:15px;
          }
        }

        @media (max-width:390px){
          .tr-exerciseProgressDone{
            font-size:38px !important;
          }

          .tr-exerciseProgressTotal{
            font-size:21px !important;
          }

          .tr-sessionNavCopy strong{
            font-size:10px;
          }
        }

        @media (prefers-reduced-motion:reduce){
          .tr-exerciseProgressRailCurrent,
          .tr-exerciseProgressCard.is-current::after{
            animation:none !important;
          }
        }
        .tr-addedBadge{
          height: 34px;
          min-width: 96px;
          padding: 0 12px;
          border-radius: 999px;
          border: 1px solid rgba(255,140,0,.45);
          background: linear-gradient(180deg, rgba(255,140,0,.18), rgba(0,0,0,.12));
          color: rgba(255,255,255,.92);
          font-weight: 1000;
          letter-spacing: .14em;
          text-transform: uppercase;
          display: inline-grid;
          place-items: center;
          box-shadow: 0 12px 34px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.06);
          transition: transform .14s ease, filter .14s ease, border-color .14s ease;
        }
        .tr-addedBadge.is-on{
          border-color: rgba(255,140,0,.85);
          filter: saturate(1.1);
          transform: scale(1.06);
          box-shadow:
            0 18px 55px rgba(0,0,0,.45),
            0 0 18px rgba(255,140,0,.20),
            0 0 42px rgba(255,80,80,.12);
        }


        /* ============================================================
           R12.5C — SESSION CHECK-IN / SESSION INTEL
           Full premium dashboard + compact workout-focus instrument.
           ============================================================ */
        .tr-siShell .tr-card{
          position:relative;
          overflow:hidden;
          border-color:rgba(108,191,226,.18);
          background:
            radial-gradient(900px 260px at 12% -24%,rgba(36,198,255,.10),transparent 58%),
            radial-gradient(620px 240px at 88% 0%,rgba(255,158,48,.055),transparent 62%),
            linear-gradient(180deg,rgba(15,24,31,.985),rgba(4,8,12,.995));
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.07),
            inset 0 -1px 0 rgba(74,186,232,.045),
            0 22px 54px rgba(0,0,0,.24);
        }
        .tr-siShell .tr-card::before{
          content:"";
          position:absolute;
          pointer-events:none;
          inset:0;
          background:
            linear-gradient(118deg,transparent 0 22%,rgba(137,226,255,.035) 36%,transparent 49%),
            repeating-linear-gradient(90deg,rgba(255,255,255,.012) 0 1px,transparent 1px 5px);
          mix-blend-mode:screen;
          opacity:.58;
        }
        .tr-siShell .tr-card-head,
        .tr-siShell .tr-card-body{ position:relative; z-index:1; }
        .tr-siShell .tr-card-head{
          min-height:52px;
          border-bottom-color:rgba(97,207,246,.12) !important;
          background:linear-gradient(180deg,rgba(255,255,255,.025),rgba(255,255,255,0));
        }
        .tr-siShell .tr-card-body{ padding:12px !important; }
        .tr-siHeaderRight{
          display:flex;
          align-items:center;
          justify-content:flex-end;
          gap:10px;
          min-width:0;
        }
        .tr-siToggle{
          width:38px;
          height:38px;
          flex:0 0 38px;
          display:grid;
          place-items:center;
          border:1px solid rgba(89,211,255,.30);
          border-radius:12px;
          color:#dff8ff;
          background:
            radial-gradient(circle at 50% 0,rgba(77,213,255,.16),transparent 70%),
            linear-gradient(180deg,rgba(12,31,42,.92),rgba(4,11,16,.98));
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.08),
            0 0 22px rgba(37,184,238,.08);
          cursor:pointer;
          transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease;
        }
        .tr-siToggle:hover{
          transform:translateY(-1px);
          border-color:rgba(108,227,255,.52);
          box-shadow:inset 0 1px 0 rgba(255,255,255,.10),0 0 26px rgba(37,184,238,.16);
        }
        .tr-siToggle span{
          transform:translateY(-1px);
          font-size:18px;
          line-height:1;
          font-weight:1000;
        }

        /* Compact summary */
        .tr-siCompact{
          min-width:0;
          min-height:66px;
          display:grid;
          grid-template-columns:.85fr .8fr 1fr 1.65fr;
          align-items:stretch;
          border:1px solid rgba(110,197,231,.12);
          border-radius:16px;
          overflow:hidden;
          background:
            radial-gradient(520px 90px at 18% 0,rgba(41,196,255,.09),transparent 66%),
            linear-gradient(180deg,rgba(11,22,29,.94),rgba(4,9,13,.99));
          box-shadow:inset 0 1px 0 rgba(255,255,255,.045),0 14px 30px rgba(0,0,0,.16);
        }
        .tr-siCompactMetric{
          position:relative;
          min-width:0;
          display:flex;
          align-items:center;
          gap:10px;
          padding:10px 14px;
        }
        .tr-siCompactMetric + .tr-siCompactMetric::before{
          content:"";
          position:absolute;
          left:0;
          top:12px;
          bottom:12px;
          width:1px;
          background:linear-gradient(180deg,transparent,rgba(159,218,239,.16),transparent);
        }
        .tr-siCompactMetric > div{
          min-width:0;
          display:grid;
          gap:4px;
        }
        .tr-siCompactMetric small{
          min-width:0;
          color:rgba(169,204,221,.63);
          font-size:7.5px;
          line-height:1.1;
          font-weight:1000;
          letter-spacing:.135em;
          text-transform:uppercase;
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis;
        }
        .tr-siCompactMetric strong{
          min-width:0;
          color:#f8fcff;
          font-size:17px;
          line-height:1;
          font-weight:1050;
          letter-spacing:-.02em;
          font-variant-numeric:tabular-nums;
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis;
          text-shadow:0 2px 0 rgba(0,0,0,.52);
        }
        .tr-siCompactMetric.is-last strong{ color:#ffd08a; }
        .tr-siCompactMetric.is-performance strong{ font-size:15px; }
        .tr-siCompactMetric strong em{
          color:#52d7ff;
          font-style:normal;
          margin:0 4px;
        }
        .tr-siCompactIcon{
          width:31px;
          height:31px;
          flex:0 0 31px;
          display:grid;
          place-items:center;
          border:1px solid rgba(101,216,255,.24);
          border-radius:10px;
          color:#74eaff;
          background:radial-gradient(circle at 50% 20%,rgba(64,221,255,.17),rgba(4,13,18,.8));
          box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 0 17px rgba(39,192,238,.08);
          font-size:16px;
          text-shadow:0 0 12px rgba(82,228,255,.42);
        }
        .tr-siCompactMetric.is-last .tr-siCompactIcon{
          border-color:rgba(255,186,91,.28);
          color:#ffc46e;
          background:radial-gradient(circle at 50% 20%,rgba(255,170,57,.14),rgba(12,10,7,.82));
          text-shadow:0 0 12px rgba(255,166,50,.35);
        }

        /* Expanded flagship dashboard */
        .tr-siMax{
          min-width:0;
          display:grid;
          grid-template-columns:minmax(250px,.78fr) minmax(0,2.05fr);
          gap:12px;
        }
        .tr-siBodyPanel,
        .tr-siModule,
        .tr-siPerformance,
        .tr-siWeekStrip{
          position:relative;
          overflow:hidden;
          border:1px solid rgba(150,204,227,.17);
          background:
            radial-gradient(300px 160px at 50% -18%,rgba(80,212,255,.12),transparent 67%),
            linear-gradient(180deg,rgba(27,36,44,.94),rgba(8,13,18,.985));
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.08),
            inset 0 -1px 0 rgba(0,0,0,.44),
            0 20px 42px rgba(0,0,0,.20);
        }
        .tr-siBodyPanel::after,
        .tr-siModule::after,
        .tr-siPerformance::after{
          content:"";
          position:absolute;
          pointer-events:none;
          inset:0;
          background:linear-gradient(120deg,rgba(255,255,255,.05),transparent 23%,transparent 72%,rgba(94,211,255,.025));
          opacity:.72;
        }
        .tr-siBodyPanel{
          min-height:292px;
          border-radius:21px;
          display:grid;
          place-items:center;
          isolation:isolate;
        }
        .tr-siBodyLight{
          position:absolute;
          inset:10% 9% 11%;
          background:radial-gradient(ellipse at 50% 46%,rgba(41,225,255,.18),rgba(27,143,255,.055) 48%,transparent 72%);
          filter:blur(12px);
          animation:tr-si-breathe 5s ease-in-out infinite;
        }
        .tr-siBodySvg{
          position:absolute;
          width:min(58%,190px);
          height:auto;
          left:50%;
          top:49%;
          transform:translate(-50%,-50%);
          filter:drop-shadow(0 0 15px rgba(41,214,255,.24));
          opacity:.92;
        }
        .tr-siBodyCopy{
          position:absolute;
          z-index:3;
          left:18px;
          right:18px;
          top:50%;
          transform:translateY(-2%);
          display:grid;
          justify-items:center;
          text-align:center;
          pointer-events:none;
        }
        .tr-siBodyCopy > span,
        .tr-siModuleCopy > span,
        .tr-siPerformanceHead span,
        .tr-siWeekStrip span{
          color:rgba(188,210,221,.75);
          font-size:9px;
          font-weight:1000;
          letter-spacing:.15em;
          text-transform:uppercase;
        }
        .tr-siBodyCopy strong{
          color:#d6fbff;
          font-size:clamp(38px,4.4vw,62px);
          line-height:.9;
          font-weight:1100;
          letter-spacing:-.055em;
          font-variant-numeric:tabular-nums;
          text-shadow:0 3px 0 rgba(0,0,0,.76),0 0 22px rgba(77,228,255,.35);
        }
        .tr-siBodyCopy small,
        .tr-siModuleCopy small,
        .tr-siWeekStrip small{
          color:rgba(181,205,217,.66);
          font-size:7.5px;
          font-weight:950;
          letter-spacing:.09em;
          text-transform:uppercase;
        }
        .tr-siTrend.is-positive{ color:#73efa1 !important; }
        .tr-siTrend.is-negative{ color:#ff9b69 !important; }
        .tr-siBodyPlatform{
          position:absolute;
          left:50%;
          bottom:16px;
          width:62%;
          height:24px;
          transform:translateX(-50%);
          border:1px solid rgba(107,223,255,.28);
          clip-path:polygon(14% 0,86% 0,100% 43%,82% 100%,18% 100%,0 43%);
          background:linear-gradient(180deg,rgba(63,202,255,.08),rgba(4,13,18,.64));
          box-shadow:0 0 26px rgba(55,203,255,.10),inset 0 1px 0 rgba(255,255,255,.08);
        }
        .tr-siBodyPlatform i{
          position:absolute;
          left:50%; top:50%;
          width:8px; height:8px;
          border:1px solid rgba(94,228,255,.42);
          border-radius:50%;
          background:#5fe8ff;
          box-shadow:0 0 12px rgba(77,226,255,.75);
        }
        .tr-siBodyPlatform i:nth-child(1){ transform:translate(-420%,-50%); }
        .tr-siBodyPlatform i:nth-child(2){ transform:translate(-50%,-50%); }
        .tr-siBodyPlatform i:nth-child(3){ transform:translate(320%,-50%); }

        .tr-siDashboard{ min-width:0; display:grid; gap:10px; }
        .tr-siTopGrid{ min-width:0; display:grid; grid-template-columns:1fr 1.12fr; gap:10px; }
        .tr-siModule{
          min-height:116px;
          border-radius:19px;
          display:grid;
          grid-template-columns:minmax(0,1fr) 126px;
          align-items:center;
          padding:14px 14px 14px 17px;
        }
        .tr-siModule.tr-siLast{
          border-color:rgba(235,184,99,.20);
          background:
            radial-gradient(260px 160px at 95% 35%,rgba(255,156,48,.14),transparent 66%),
            linear-gradient(180deg,rgba(29,34,37,.95),rgba(9,12,15,.985));
        }
        .tr-siModuleCopy{
          position:relative;
          z-index:3;
          min-width:0;
          display:grid;
          align-content:center;
          gap:5px;
        }
        .tr-siModuleCopy strong{
          min-width:0;
          color:#f9fcff;
          font-size:clamp(25px,3vw,42px);
          line-height:.94;
          font-weight:1100;
          letter-spacing:-.045em;
          font-variant-numeric:tabular-nums;
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis;
          text-shadow:0 2px 0 rgba(0,0,0,.66);
        }
        .tr-siLast .tr-siModuleCopy strong{ color:#ffd08a; }
        .tr-siProteinSvg,
        .tr-siHistorySvg{
          position:relative;
          z-index:2;
          width:118px;
          height:118px;
          justify-self:end;
          filter:drop-shadow(0 12px 18px rgba(0,0,0,.44));
        }
        .tr-siProteinSvg{ animation:tr-si-core-float 5.5s ease-in-out infinite; }
        .tr-siHistorySvg{ animation:tr-si-dial-glint 7s ease-in-out infinite; }

        .tr-siPerformance{
          min-height:121px;
          border-radius:19px;
          padding:13px 16px 12px;
          border-color:rgba(79,199,243,.18);
          background:
            radial-gradient(540px 150px at 13% -28%,rgba(19,185,255,.12),transparent 65%),
            linear-gradient(180deg,rgba(8,21,30,.97),rgba(4,9,13,.995));
        }
        .tr-siPerformanceHead{
          position:relative;
          z-index:3;
          display:flex;
          align-items:start;
          justify-content:space-between;
          gap:12px;
          margin-bottom:8px;
        }
        .tr-siPerformanceHead > div{ display:grid; gap:3px; min-width:0; }
        .tr-siPerformanceHead strong{
          color:#eaf7fd;
          font-size:10px;
          line-height:1.1;
          font-weight:1000;
          letter-spacing:.03em;
        }
        .tr-siPerformanceHead b{
          color:#ffc86f;
          font-size:8px;
          font-weight:1000;
          letter-spacing:.13em;
          white-space:nowrap;
        }
        .tr-siPerformanceGrid{
          position:relative;
          z-index:3;
          display:grid;
          grid-template-columns:1.15fr 1fr 1.1fr;
          min-width:0;
          border-top:1px solid rgba(255,255,255,.065);
        }
        .tr-siPerfMetric{
          position:relative;
          min-width:0;
          min-height:72px;
          padding:9px 12px 5px;
          display:flex;
          align-items:center;
          gap:10px;
          overflow:hidden;
        }
        .tr-siPerfMetric + .tr-siPerfMetric{ border-left:1px solid rgba(255,255,255,.065); }
        .tr-siPerfValue{
          position:relative;
          z-index:3;
          min-width:0;
          display:grid;
          gap:4px;
        }
        .tr-siPerfValue strong{
          color:#f9fcff;
          font-size:clamp(21px,2.5vw,34px);
          line-height:.92;
          font-weight:1100;
          letter-spacing:-.04em;
          font-variant-numeric:tabular-nums;
          white-space:nowrap;
        }
        .tr-siPerfValue span{
          color:rgba(182,206,219,.62);
          font-size:7px;
          line-height:1.1;
          font-weight:1000;
          letter-spacing:.115em;
          text-transform:uppercase;
        }
        .tr-siWave{
          position:absolute;
          right:4px;
          top:8px;
          width:55%;
          height:48px;
          opacity:.78;
        }
        .tr-siPerfDelta{
          position:absolute;
          left:12px;
          right:10px;
          bottom:0;
          color:rgba(194,214,226,.65);
          font-size:7px;
          line-height:1;
          font-weight:1000;
          letter-spacing:.07em;
          text-transform:uppercase;
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis;
        }
        .tr-siPerfDelta.is-positive{ color:#72eca0; }
        .tr-siPerfDelta.is-negative{ color:#ff9b68; }
        .tr-siSetCells{
          width:min(55%,122px);
          display:flex;
          align-items:end;
          justify-content:center;
          gap:3px;
          flex-wrap:wrap;
        }
        .tr-siSetCells i{
          width:8px;
          height:27px;
          border:1px solid rgba(174,205,218,.16);
          border-radius:3px;
          background:linear-gradient(180deg,rgba(135,162,176,.30),rgba(51,65,74,.34));
          box-shadow:inset 0 1px 0 rgba(255,255,255,.08);
        }
        .tr-siSetCells i.is-done{
          border-color:rgba(90,236,255,.54);
          background:linear-gradient(180deg,#68f1ff,#1ea9e8 64%,#117ac8);
          box-shadow:0 0 12px rgba(66,214,255,.26),inset 0 1px 0 rgba(255,255,255,.34);
        }
        .tr-siVolumeGlyph{
          width:74px;
          height:62px;
          flex:0 0 74px;
          filter:drop-shadow(0 8px 11px rgba(0,0,0,.35));
        }
        .tr-siPerfMetric.is-volume{ justify-content:space-between; }
        .tr-siPerfMetric.is-volume .tr-siPerfValue{ order:-1; }

        .tr-siWeekStrip{
          min-height:55px;
          border-radius:17px;
          display:grid;
          grid-template-columns:auto minmax(110px,1fr) auto;
          align-items:center;
          gap:14px;
          padding:9px 14px;
          background:
            radial-gradient(380px 90px at 20% -25%,rgba(48,195,255,.07),transparent 70%),
            linear-gradient(180deg,rgba(255,255,255,.025),rgba(0,0,0,.15));
        }
        .tr-siWeekStrip > div:first-child,
        .tr-siWeekTime{ display:grid; gap:2px; }
        .tr-siWeekStrip strong{
          color:#f8fcff;
          font-size:20px;
          line-height:1;
          font-weight:1100;
          letter-spacing:-.03em;
          font-variant-numeric:tabular-nums;
        }
        .tr-siWeekTime{ justify-items:end; text-align:right; }
        .tr-siWeekRail{
          min-width:0;
          display:grid;
          grid-template-columns:repeat(5,minmax(14px,1fr));
          gap:6px;
        }
        .tr-siWeekRail i{
          height:5px;
          border-radius:999px;
          background:rgba(255,255,255,.07);
          box-shadow:inset 0 1px 2px rgba(0,0,0,.7);
        }
        .tr-siWeekRail i.is-live{
          background:linear-gradient(90deg,#2dcdff,#74f0b1);
          box-shadow:0 0 12px rgba(63,220,255,.20);
        }

        @keyframes tr-si-breathe{
          0%,100%{ opacity:.65; transform:scale(.98); }
          50%{ opacity:1; transform:scale(1.035); }
        }
        @keyframes tr-si-core-float{
          0%,100%{ transform:translateY(1px) rotate(-.4deg); filter:drop-shadow(0 12px 18px rgba(0,0,0,.44)) drop-shadow(0 0 8px rgba(73,220,255,.08)); }
          50%{ transform:translateY(-3px) rotate(.5deg); filter:drop-shadow(0 14px 20px rgba(0,0,0,.44)) drop-shadow(0 0 15px rgba(73,220,255,.18)); }
        }
        @keyframes tr-si-dial-glint{
          0%,82%,100%{ filter:drop-shadow(0 12px 18px rgba(0,0,0,.44)); }
          90%{ filter:drop-shadow(0 12px 18px rgba(0,0,0,.44)) drop-shadow(0 0 16px rgba(255,174,73,.28)); }
        }

        @media (max-width:980px){
          .tr-siMax{ grid-template-columns:minmax(205px,.72fr) minmax(0,1.7fr); }
          .tr-siBodyPanel{ min-height:278px; }
          .tr-siTopGrid{ grid-template-columns:1fr 1fr; }
          .tr-siModule{ grid-template-columns:minmax(0,1fr) 96px; }
          .tr-siProteinSvg,.tr-siHistorySvg{ width:92px; height:92px; }
          .tr-siPerformanceGrid{ grid-template-columns:1fr 1fr 1fr; }
          .tr-siCompact{ grid-template-columns:.8fr .8fr 1fr 1.4fr; }
        }

        @media (max-width:720px){
          .tr-siShell .tr-card-head{
            min-height:48px;
            padding-right:8px !important;
          }
          .tr-siShell .tr-card-body{ padding:9px !important; }
          .tr-siHeaderRight{ gap:7px; }
          .tr-siHeaderRight .tr-checkinContext{
            max-width:42vw;
            overflow:hidden;
            text-overflow:ellipsis;
          }
          .tr-siToggle{
            width:40px;
            height:40px;
            flex-basis:40px;
            border-radius:12px;
          }

          .tr-siCompact{
            min-height:108px;
            grid-template-columns:1fr 1fr;
            grid-template-areas:"weight protein" "last performance";
            border-radius:17px;
          }
          .tr-siCompactMetric{ padding:9px 10px; gap:8px; }
          .tr-siCompactMetric.is-weight{ grid-area:weight; }
          .tr-siCompactMetric.is-protein{ grid-area:protein; }
          .tr-siCompactMetric.is-last{ grid-area:last; }
          .tr-siCompactMetric.is-performance{ grid-area:performance; }
          .tr-siCompactMetric::before{ display:none !important; }
          .tr-siCompactMetric:nth-child(n+3){ border-top:1px solid rgba(151,211,234,.10); }
          .tr-siCompactMetric:nth-child(even){ border-left:1px solid rgba(151,211,234,.10); }
          .tr-siCompactMetric small{ font-size:6.8px; }
          .tr-siCompactMetric strong{ font-size:15px; }
          .tr-siCompactMetric.is-last strong{ font-size:13px; }
          .tr-siCompactMetric.is-performance strong{ font-size:11px; letter-spacing:-.01em; }
          .tr-siCompactIcon{ width:29px; height:29px; flex-basis:29px; font-size:14px; }

          .tr-siMax{
            grid-template-columns:1fr;
            gap:9px;
          }
          .tr-siBodyPanel{
            min-height:210px;
            border-radius:18px;
          }
          .tr-siBodySvg{
            width:122px;
            left:24%;
            top:50%;
          }
          .tr-siBodyCopy{
            left:43%;
            right:10px;
            top:49%;
            transform:translateY(-50%);
            justify-items:start;
            text-align:left;
          }
          .tr-siBodyCopy strong{ font-size:39px; }
          .tr-siBodyPlatform{
            left:24%;
            width:36%;
            bottom:13px;
          }
          .tr-siTopGrid{ grid-template-columns:1fr 1fr; gap:8px; }
          .tr-siModule{
            min-height:122px;
            grid-template-columns:1fr;
            align-content:center;
            padding:12px;
          }
          .tr-siModuleCopy{ z-index:4; }
          .tr-siModuleCopy strong{ font-size:25px; }
          .tr-siProteinSvg,.tr-siHistorySvg{
            position:absolute;
            right:4px;
            bottom:-10px;
            width:92px;
            height:92px;
            opacity:.58;
          }
          .tr-siProtein .tr-siModuleCopy,
          .tr-siLast .tr-siModuleCopy{ padding-right:34px; }

          .tr-siPerformance{
            min-height:194px;
            padding:12px 12px 10px;
          }
          .tr-siPerformanceGrid{
            grid-template-columns:repeat(3,minmax(0,1fr));
          }
          .tr-siPerfMetric{
            min-height:116px;
            padding:8px 7px 4px;
            align-items:center;
            justify-content:flex-end;
            flex-direction:column;
            text-align:center;
          }
          .tr-siPerfValue{ justify-items:center; }
          .tr-siPerfValue strong{ font-size:20px; }
          .tr-siPerfValue span{ font-size:6.2px; }
          .tr-siWave{
            position:relative;
            top:auto; right:auto;
            order:-1;
            width:100%;
            height:38px;
            opacity:.62;
          }
          .tr-siPerfDelta{
            left:4px; right:4px; bottom:4px;
            font-size:5.8px;
            text-align:center;
          }
          .tr-siSetCells{
            width:100%;
            height:40px;
            gap:2px;
            align-items:center;
            justify-content:center;
            overflow:hidden;
          }
          .tr-siSetCells i{ width:5px; height:23px; }
          .tr-siVolumeGlyph{ width:58px; height:44px; flex-basis:44px; order:-1; }
          .tr-siPerfMetric.is-volume .tr-siPerfValue{ order:0; }

          .tr-siWeekStrip{
            min-height:58px;
            grid-template-columns:auto 1fr auto;
            gap:8px;
            padding:8px 10px;
          }
          .tr-siWeekStrip span,.tr-siWeekStrip small{ font-size:6px; }
          .tr-siWeekStrip strong{ font-size:17px; }
          .tr-siWeekRail{ gap:4px; }
        }

        @media (max-width:420px){
          .tr-siHeaderRight .tr-checkinContext{ max-width:34vw; font-size:7px; }
          .tr-siCompactMetric{ padding:8px; }
          .tr-siCompactMetric strong{ font-size:14px; }
          .tr-siCompactMetric.is-performance strong{ font-size:10px; }
          .tr-siCompactIcon{ width:27px; height:27px; flex-basis:27px; }
          .tr-siBodyPanel{ min-height:196px; }
          .tr-siBodySvg{ width:110px; left:23%; }
          .tr-siBodyCopy{ left:42%; }
          .tr-siBodyCopy strong{ font-size:35px; }
          .tr-siTopGrid{ grid-template-columns:1fr; }
          .tr-siModule{ min-height:104px; }
          .tr-siProteinSvg,.tr-siHistorySvg{ width:82px; height:82px; }
          .tr-siPerformance{ min-height:188px; }
          .tr-siPerfValue strong{ font-size:18px; }
          .tr-siWeekStrip{ grid-template-columns:auto 1fr auto; }
        }

        @media (prefers-reduced-motion:reduce){
          .tr-siBodyLight,
          .tr-siProteinSvg,
          .tr-siHistorySvg{ animation:none !important; }
        }
      `}</style>
    </div>
  );
}

function EditSessionPanel(props: {
  items: WorkoutExerciseRow[];
  onClose: () => void;
  onSaveSessionOnly: () => Promise<void>;
  onSaveAllFuture: () => Promise<void>;
  onDelete: (weId: string) => Promise<void>;
  onSwap: (weId: string) => void;
  swapTargetWeId: string | null;
  searchQ: string;
  searchBusy: boolean;
  searchLoadingMore: boolean;
  searchHasMore: boolean;
  searchError: string | null;
  searchResults: DecoratedSearchRow[];
  resultsBatchSize: number;
  onSearch: (q: string) => Promise<void>;
  onRetry: () => Promise<void>;
  onLoadMore: () => Promise<void>;
  onPickAdd: (exerciseId: string) => Promise<void>;
  onCreateNew: () => void;
  onPickSwap: (exerciseId: string) => Promise<void>;
  addMuscle: AddMuscleKey;
  addMuscleDetail: MuscleDetailKey;
  addEquip: AddEquipKey;
  setAddMuscle: (v: AddMuscleKey) => void;
  setAddMuscleDetail: (v: MuscleDetailKey) => void;
  setAddEquip: (v: AddEquipKey) => void;
  justAddedId: string | null;
}) {
  const {
    items,
    onClose,
    onSaveSessionOnly,
    onSaveAllFuture,
    onDelete,
    onSwap,
    swapTargetWeId,
    searchQ,
    searchBusy,
    searchLoadingMore,
    searchHasMore,
    searchError,
    searchResults,
    resultsBatchSize,
    onSearch,
    onRetry,
    onLoadMore,
    onPickAdd,
    onCreateNew,
    onPickSwap,
    addMuscle,
    addMuscleDetail,
    addEquip,
    setAddMuscle,
    setAddMuscleDetail,
    setAddEquip,
    justAddedId,
  } = props;

  const mode = swapTargetWeId ? "swap" : "add";
  const [mobileTab, setMobileTab] = useState<"current" | "add">("add");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const addMuscleDetailOptions = useMemo(
    () => getMuscleDetailOptions(addMuscle as MuscleKey),
    [addMuscle]
  );

  useEffect(() => {
    if (swapTargetWeId) setMobileTab("add");
  }, [swapTargetWeId]);

  function handleSwap(weId: string) {
    setMobileTab("add");
    setMobileFiltersOpen(false);
    onSwap(weId);
  }

  function selectBroadMuscle(nextMuscle: AddMuscleKey) {
    setAddMuscle(nextMuscle);
    setAddMuscleDetail("all");
  }

  function iconForWe(we: WorkoutExerciseRow) {
    const ex = we.exercise || {};
    const ic = resolveRowIcon(ex);
    return ic.icon ? <img className="tr-ico" src={ic.icon} alt={ic.alt} /> : null;
  }

  function prettyMeta(value: string) {
    return String(value || "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function resultMeta(row: DecoratedSearchRow) {
    const muscles = Array.isArray(row.primary_muscles)
      ? row.primary_muscles.filter(Boolean).map(prettyMeta)
      : [];
    const equipment = Array.isArray(row.equipment)
      ? row.equipment.filter(Boolean).map(prettyMeta)
      : [];
    return `${muscles.length ? muscles.join(", ") : "General"} • ${equipment.length ? equipment.join(", ") : "Other"}`;
  }

  const showResultsEmptyState =
    !searchBusy &&
    !searchError &&
    !searchResults.length;

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="tr-modalOverlay tr-modalOverlay--locked" role="dialog" aria-modal="true" aria-label="Edit active session">
      <div className={`tr-modal tr-modal--viewport tr-editModal tr-editModal--sessionPicker tr-editModal--mobile-${mobileTab}`}>
        <header className="tr-modalHead tr-editSessionHead">
          <div className="tr-editSessionIdentity">
            <div className="tr-kicker">WORKOUT EDITOR</div>
            <div className="tr-editSessionTitle">EDIT ACTIVE SESSION</div>
            <div className="tr-editSessionCount">{items.length} EXERCISES</div>
          </div>

          <button className="tr-btn tr-editCloseBtn" onClick={onClose}>
            CLOSE
          </button>
        </header>

        <div className="tr-modalBody tr-editModalBody">
          <div className="tr-editMobileTabs" role="tablist" aria-label="Edit session sections">
            <button
              type="button"
              role="tab"
              aria-selected={mobileTab === "current"}
              className={`tr-seg ${mobileTab === "current" ? "is-active" : ""}`}
              onClick={() => setMobileTab("current")}
            >
              CURRENT ({items.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mobileTab === "add"}
              className={`tr-seg ${mobileTab === "add" ? "is-active" : ""}`}
              onClick={() => setMobileTab("add")}
            >
              {mode === "swap" ? "REPLACEMENT" : "ADD EXERCISE"}
            </button>
          </div>

          <section className="tr-editCurrentPanel tr-editSection tr-editSection--current">
            <div className="tr-editSectionHead">
              <div>
                <div className="tr-kicker">CURRENT WORKOUT</div>
                <h3>CURRENT SESSION EXERCISES</h3>
              </div>
              <span className="tr-editSectionCount">{items.length} TOTAL</span>
            </div>

            <div className="tr-editCurrentList">
              {items.map((we, idx) => (
                <div key={we.id} className="tr-editCurrentExerciseRow">
                  <div className="tr-editExerciseIndex">{String(idx + 1).padStart(2, "0")}</div>

                  <div className="tr-editExerciseCopy">
                    <div className="tr-editExerciseName">
                      {iconForWe(we)}
                      <strong>{we.exercise?.name ?? we.exercise_id}</strong>
                    </div>
                    <span>
                      {we.prescription_snapshot?.sets ?? "—"} SETS • {we.prescription_snapshot?.rep_min ?? "—"}-
                      {we.prescription_snapshot?.rep_max ?? "—"} REPS
                    </span>
                  </div>

                  <div className="tr-editExerciseActions">
                    <button className={`tr-seg ${swapTargetWeId === we.id ? "is-active" : ""}`} onClick={() => handleSwap(we.id)}>
                      SWAP
                    </button>
                    <button className="tr-editDeleteBtn" onClick={() => onDelete(we.id)}>
                      DELETE
                    </button>
                  </div>
                </div>
              ))}
              {!items.length ? <div className="tr-editEmptyState">No exercises are currently in this session.</div> : null}
            </div>
          </section>

          <section className="tr-editAddPanel tr-editSection tr-editSection--add">
            <div className="tr-editSectionHead">
              <div>
                <div className="tr-kicker">EXERCISE LIBRARY</div>
                <h3>{mode === "swap" ? "PICK A REPLACEMENT" : "ADD EXERCISE"}</h3>
              </div>
              <button type="button" className="tr-btn tr-btn--blueOutline tr-editCreateBtn" onClick={onCreateNew}>
                + CREATE NEW EXERCISE
              </button>
            </div>

            <div className="tr-editAddLayout">
              {mode === "add" ? (
                <div className="tr-mobileExercisePickerBar">
                  <button
                    type="button"
                    className={`tr-btn ${mobileFiltersOpen ? "tr-btn--primary" : "tr-btn--blueOutline"}`}
                    onClick={() => setMobileFiltersOpen((value) => !value)}
                    aria-expanded={mobileFiltersOpen}
                  >
                    {mobileFiltersOpen ? "HIDE FILTERS" : "FILTERS"}
                  </button>
                  <button type="button" className="tr-btn tr-btn--blueOutline" onClick={onCreateNew}>
                    + NEW EXERCISE
                  </button>
                </div>
              ) : null}

              {mode === "add" ? (
                <div className={`tr-editFilterScroll ${mobileFiltersOpen ? "is-open" : "is-collapsed"}`}>
                  <div className="tr-editFilterGroup">
                    <div className="tr-filterLabel">MUSCLE</div>
                    <div className="tr-chipRow tr-chipRow--wrap">
                      <button className={`tr-seg ${addMuscle === "all" ? "is-active" : ""}`} onClick={() => selectBroadMuscle("all")}>
                        ALL
                      </button>
                      {MUSCLE_CHIPS.map((m) => (
                        <button key={m.key} className={`tr-seg ${addMuscle === m.key ? "is-active" : ""}`} onClick={() => selectBroadMuscle(m.key)}>
                          <IconImg src={m.icon} alt={m.label} /> {m.label}
                        </button>
                      ))}
                    </div>

                    {addMuscleDetailOptions.length > 1 ? (
                      <div className="tr-chipRow tr-chipRow--wrap tr-muscleDetailRow">
                        {addMuscleDetailOptions.map((option) => (
                          <button
                            key={option.key}
                            className={`tr-seg ${addMuscleDetail === option.key ? "is-active" : ""}`}
                            onClick={() => setAddMuscleDetail(option.key)}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="tr-editFilterGroup">
                    <div className="tr-filterLabel">EQUIPMENT</div>
                    <div className="tr-chipRow tr-chipRow--wrap">
                      <button className={`tr-seg ${addEquip === "all" ? "is-active" : ""}`} onClick={() => setAddEquip("all")}>
                        ALL
                      </button>
                      {EQUIP_CHIPS.map((e) => (
                        <button key={e.key} className={`tr-seg ${addEquip === e.key ? "is-active" : ""}`} onClick={() => setAddEquip(e.key)}>
                          <IconImg src={e.icon} alt={e.label} /> {e.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {addEquip === "cardio" ? (
                    <div className="tr-editFilterNote">Muscle filters are unavailable for cardio exercises.</div>
                  ) : null}
                </div>
              ) : null}

              <label className="tr-editSearchField">
                <span className="tr-filterLabel">SEARCH EXERCISES</span>
                <input value={searchQ} onChange={(e) => void onSearch(e.target.value)} placeholder="Search exercises…" />
              </label>

              <div className="tr-editPickerPrompt">
                {searchBusy ? "SEARCHING EXERCISE LIBRARY…" : mode === "swap" ? "SELECT THE EXERCISE TO USE AS THE REPLACEMENT." : "SELECT AN EXERCISE TO ADD TO THIS SESSION."}
              </div>

              <div className="tr-editResultsViewport">
                {searchResults.map((r) => (
                  <button
                    key={r.id}
                    className="tr-rowBtn tr-editResultRowBtn"
                    onClick={() => (mode === "swap" ? onPickSwap(r.id) : onPickAdd(r.id))}
                  >
                    <div className={`tr-editResultRow ${r.effectiveHasMedia ? "is-ready" : "is-missing"}`}>
                      <div className="tr-editResultIcon">
                        {r.icon ? <img className="tr-ico" src={r.icon} alt={r.iconAlt || ""} /> : <span aria-hidden>•</span>}
                      </div>

                      <div className="tr-editResultCopy">
                        <strong>{r.name}</strong>
                        <span>{resultMeta(r)}</span>
                      </div>

                      {r.effectiveHasMedia ? (
                        <div className="tr-editResultStatus is-ready">
                          <CheckIcon />
                          <span>READY</span>
                        </div>
                      ) : (
                        <div className="tr-editResultStatus is-missing">
                          <AlertIcon />
                          <span>NEEDS MEDIA</span>
                        </div>
                      )}

                      {mode === "add" ? (
                        <span className={`tr-addedBadge ${justAddedId === r.id ? "is-on" : ""}`}>
                          {justAddedId === r.id ? "ADDED" : "ADD"}
                        </span>
                      ) : (
                        <span className="tr-editResultPick">SELECT</span>
                      )}
                    </div>
                  </button>
                ))}

                {searchBusy && !searchResults.length ? (
                  <div className="tr-pickerStatus">Loading exercises…</div>
                ) : null}

                {searchError ? (
                  <div className="tr-pickerError" role="alert">
                    <strong>Exercises did not load.</strong>
                    <span>{searchError}</span>
                    <button type="button" className="tr-btn tr-btn--primary" onClick={() => void onRetry()}>
                      RETRY
                    </button>
                  </div>
                ) : null}

                {showResultsEmptyState ? (
                  <div className="tr-pickerStatus">No exercises match these filters.</div>
                ) : null}
              </div>

              {searchResults.length ? (
                <div className="tr-editLoadMoreBlock">
                  {searchHasMore ? (
                    <button
                      type="button"
                      className="tr-btn tr-btn--primary tr-editLoadMoreBtn"
                      onClick={() => void onLoadMore()}
                      disabled={searchBusy || searchLoadingMore}
                    >
                      {searchLoadingMore ? "LOADING…" : `SHOW ${resultsBatchSize} MORE`}
                    </button>
                  ) : (
                    <div className="tr-editAllLoaded">✓ ALL MATCHING EXERCISES LOADED</div>
                  )}
                </div>
              ) : null}
            </div>
          </section>
        </div>

        <footer className="tr-modalFooter tr-editModalFooter tr-editSaveFooter">
          <div className="tr-editSaveFooterCopy">
            <span className="tr-kicker">SAVE CHANGES</span>
            <small>Choose whether these edits apply only now or to future sessions too.</small>
          </div>
          <div className="tr-editSaveActions">
            <button className="tr-btn tr-btn--primary" onClick={onSaveSessionOnly}>
              SAVE THIS SESSION
            </button>
            <button className="tr-btn" onClick={onSaveAllFuture}>
              SAVE TO ALL FUTURE SESSIONS
            </button>
          </div>
        </footer>
      </div>

      <style>{`
        .tr-chipRow{ display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
      `}</style>
    </div>,
    document.body
  );
}

function ExerciseRunner({
  workoutExercise,
  item,
  programBlockId,
  goal,
  onChanged,
  onExerciseCompleted,
  showToast,
  exerciseIndex,
  totalExercises,
  sessionComplete,
  onStartRest,
}: {
  workoutExercise: WorkoutExerciseRow;
  item: any;
  programBlockId: string | null;
  goal: string | null;
  onChanged: () => Promise<WorkoutExerciseRow[]>;
  onExerciseCompleted: (workoutExerciseId: string) => Promise<void>;
  showToast: (msg: string, tone?: ToastTone) => void;
  exerciseIndex: number;
  totalExercises: number;
  sessionComplete: boolean;
  onStartRest: (
    seconds: number,
    exerciseName: string,
    completedSetIndex: number,
    nextSetNumber?: number,
    totalSets?: number,
    nextInstruction?: string
  ) => void;
}) {
  const weId = workoutExercise.id;
  const isDone = !!workoutExercise.completed_at;

  const pres = item?.prescription_snapshot ?? {};
  const timed = isTimed(pres);
  const exerciseId = workoutExercise.exercise_id || item?.exercise_id || item?.id || "";

  const setsTarget = Number(pres.sets ?? 3);
  const repMin = Number(pres.rep_min ?? 8);
  const repMax = Number(pres.rep_max ?? 12);
  const restSeconds = 60;

  const [sets, setSets] = useState<any[]>([]);
  const [loadingSets, setLoadingSets] = useState(true);
  const [previousPerformance, setPreviousPerformance] = useState<PreviousPerformance | null>(null);
  const [previousLoading, setPreviousLoading] = useState(false);
  const [historyStats, setHistoryStats] = useState<ExerciseHistoryStats>(() => emptyHistoryStats());
  const [completedSetIndexes, setCompletedSetIndexes] = useState<number[]>([]);
  const [prCelebration, setPrCelebration] = useState<PersonalRecordCelebrationState | null>(null);
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const [progressionOpen, setProgressionOpen] = useState(() => {
    const isMobile =
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 720px)").matches;

    try {
      const saved = localStorage.getItem("mvp_progression_assistant_open");
      if (saved != null) return saved === "true" && !isMobile;
    } catch {
      // Persistence is optional.
    }

    return !isMobile;
  });

  useEffect(() => {
    try {
      localStorage.setItem(
        "mvp_progression_assistant_open",
        progressionOpen ? "true" : "false"
      );
    } catch {
      // Persistence is optional.
    }
  }, [progressionOpen]);
  const [calculatorWeight, setCalculatorWeight] = useState(0);
  const [barWeight, setBarWeight] = useState(45);

  const [pain, setPain] = useState<number>(0);
  const [painTouched, setPainTouched] = useState(false);

  const prescribedMins = durationMinutes(pres);
  const initialActual = Number(pres?.actual_minutes);
  const [actualMinutes, setActualMinutes] = useState<number>(
    Number.isFinite(initialActual) && initialActual > 0
      ? Math.floor(initialActual)
      : Math.max(0, Math.floor(prescribedMins))
  );

  useEffect(() => {
    const p = Number.isFinite(Number(workoutExercise.pain)) ? Number(workoutExercise.pain) : 0;
    setPain(Math.max(0, Math.min(10, p)));
    setPainTouched(false);

    const dp = durationMinutes(workoutExercise.prescription_snapshot ?? {});
    const act = Number((workoutExercise.prescription_snapshot ?? {})?.actual_minutes);
    setActualMinutes(Number.isFinite(act) && act > 0 ? Math.floor(act) : Math.max(0, Math.floor(dp)));
    setCalculatorOpen(false);
    setPrCelebration(null);
    setProgressionOpen(
      !(
        typeof window !== "undefined" &&
        window.matchMedia("(max-width: 720px)").matches
      )
    );
    setCalculatorWeight(0);

    try {
      const saved = sessionStorage.getItem(`mvp_completed_sets:${weId}`);
      const parsed = saved ? JSON.parse(saved) : [];
      setCompletedSetIndexes(Array.isArray(parsed) ? parsed.map(Number).filter((n) => n > 0) : []);
    } catch {
      setCompletedSetIndexes([]);
    }
  }, [weId]);

  useEffect(() => {
    if (!prCelebration) return;

    try {
      navigator.vibrate?.([70, 45, 130]);
    } catch {
      // Haptics are optional.
    }

    const timer = window.setTimeout(() => {
      setPrCelebration(null);
    }, 5200);

    return () => window.clearTimeout(timer);
  }, [prCelebration?.id]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoadingSets(true);
      setPreviousLoading(true);
      setPreviousPerformance(null);

      if (timed) {
        setSets([]);
        setLoadingSets(false);
        setPreviousLoading(false);
        return;
      }

      try {
        const [existingResult, previous, history] = await Promise.all([
          supabase
            .from("workout_sets")
            .select("set_index,reps,weight,rir")
            .eq("workout_exercise_id", weId)
            .order("set_index", { ascending: true }),
          loadPreviousPerformance({
            exerciseId,
            currentWorkoutId: workoutExercise.workout_id,
            programBlockId,
          }),
          loadExerciseHistoryStats({
            exerciseId,
            currentWorkoutId: workoutExercise.workout_id,
            programBlockId,
          }),
        ]);

        if (existingResult.error) throw existingResult.error;
        if (cancelled) return;

        const rows = (existingResult.data ?? []) as any[];
        const maxExisting = rows.reduce((m, r) => Math.max(m, Number(r.set_index) || 0), 0);
        const total = Math.max(setsTarget, maxExisting);
        const storedEffortKeys = (() => {
          try {
            const saved = sessionStorage.getItem(`mvp_set_efforts:${weId}`);
            const parsed = saved ? JSON.parse(saved) : {};
            return parsed && typeof parsed === "object" ? parsed as Record<string, string> : {};
          } catch {
            return {} as Record<string, string>;
          }
        })();

        const filled = Array.from({ length: total }, (_, i) => {
          const idx = i + 1;
          const found = rows.find((r) => Number(r.set_index) === idx);
          const savedWeight = Number(found?.weight ?? 0);

          return {
            set_index: idx,
            reps: Number(found?.reps ?? 0),
            weight: savedWeight > 0 ? savedWeight : previousWeightForIndex(previous, idx),
            rir: found?.rir != null ? Number(found.rir) : null,
            effort_key:
              storedEffortKeys[String(idx)] ??
              (found?.rir != null
                ? EFFORT_OPTIONS.find((option) => option.rir === Number(found.rir))?.key ?? null
                : null),
          };
        });

        setPreviousPerformance(previous);
        setHistoryStats(history);
        setSets(filled);

        const storedCompleted = (() => {
          try {
            const saved = sessionStorage.getItem(`mvp_completed_sets:${weId}`);
            const parsed = saved ? JSON.parse(saved) : [];
            return Array.isArray(parsed) ? parsed.map(Number).filter((value) => value > 0) : [];
          } catch {
            return [] as number[];
          }
        })();
        const databaseCompleted = filled
          .filter((row) => Number(row.reps) > 0 && Number(row.weight) > 0 && row.rir != null)
          .map((row) => Number(row.set_index));
        setCompletedSetIndexes(Array.from(new Set([...storedCompleted, ...databaseCompleted])).sort((a, b) => a - b));

        const suggestedStart = progressionGuidance(previous, history, repMin, repMax, setsTarget, item, goal).suggestedWeight;
        const firstWeight = filled.find((row) => Number(row.weight) > 0)?.weight ?? 0;
        setCalculatorWeight(Number(firstWeight || suggestedStart || history.bestWeight || 0));
      } catch (error: any) {
        if (!cancelled) {
          console.error("PREVIOUS PERFORMANCE LOAD FAILED:", error);
          setPreviousPerformance(null);
          setHistoryStats(emptyHistoryStats());

          const { data: fallbackRows } = await supabase
            .from("workout_sets")
            .select("set_index,reps,weight,rir")
            .eq("workout_exercise_id", weId)
            .order("set_index", { ascending: true });

          if (cancelled) return;

          const rows = (fallbackRows ?? []) as any[];
          const maxExisting = rows.reduce((m, r) => Math.max(m, Number(r.set_index) || 0), 0);
          const total = Math.max(setsTarget, maxExisting);
          const storedEffortKeys = (() => {
            try {
              const saved = sessionStorage.getItem(`mvp_set_efforts:${weId}`);
              const parsed = saved ? JSON.parse(saved) : {};
              return parsed && typeof parsed === "object" ? parsed as Record<string, string> : {};
            } catch {
              return {} as Record<string, string>;
            }
          })();
          setSets(
            Array.from({ length: total }, (_, i) => {
              const idx = i + 1;
              const found = rows.find((r) => Number(r.set_index) === idx);
              return {
                set_index: idx,
                reps: Number(found?.reps ?? 0),
                weight: Number(found?.weight ?? 0),
                rir: found?.rir != null ? Number(found.rir) : null,
                effort_key:
                  storedEffortKeys[String(idx)] ??
                  (found?.rir != null
                    ? EFFORT_OPTIONS.find((option) => option.rir === Number(found.rir))?.key ?? null
                    : null),
              };
            })
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingSets(false);
          setPreviousLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [weId, exerciseId, workoutExercise.workout_id, programBlockId, setsTarget, timed, goal]);

  const allSetsLogged = useMemo(() => {
    if (timed) return true;
    if (!sets.length) return false;
    return sets.every(
      (set) =>
        Number(set.reps) > 0 &&
        Number(set.weight) > 0 &&
        completedSetIndexes.includes(Number(set.set_index))
    );
  }, [sets, timed, completedSetIndexes]);

  const previousGuidance = useMemo(
    () => progressionGuidance(previousPerformance, historyStats, repMin, repMax, setsTarget, item, goal),
    [previousPerformance, historyStats, repMin, repMax, setsTarget, item, goal]
  );

  const completedSets = useMemo(
    () =>
      sets.filter((set) => completedSetIndexes.includes(Number(set.set_index))),
    [sets, completedSetIndexes]
  );
  const activeSetIndex = useMemo(() => {
    const index = sets.findIndex(
      (set) => !completedSetIndexes.includes(Number(set.set_index))
    );
    return index >= 0 ? index : Math.max(0, sets.length - 1);
  }, [sets, completedSetIndexes]);
  const lastCompletedSet = completedSets.length
    ? completedSets[completedSets.length - 1]
    : null;
  const liveSetAdvice = useMemo(
    () =>
      buildLiveSetAdvice({
        set: lastCompletedSet,
        exercise: item,
        repMin,
        repMax,
      }),
    [lastCompletedSet, item, repMin, repMax]
  );

  const currentPrLabels = useMemo(() => {
    const labels = new Set<string>();
    for (const set of sets) {
      for (const label of detectPersonalRecords(
        { reps: Number(set.reps ?? 0), weight: Number(set.weight ?? 0) },
        historyStats
      )) {
        labels.add(label);
      }
    }

    const currentSessionVolume = sets.reduce(
      (sum, set) => sum + Math.max(0, Number(set.reps ?? 0)) * Math.max(0, Number(set.weight ?? 0)),
      0
    );
    if (historyStats.sessions > 0 && currentSessionVolume > historyStats.bestSessionVolume) {
      labels.add("EXERCISE SESSION VOLUME PR");
    }

    return Array.from(labels);
  }, [sets, historyStats]);

  const readyToLock = timed || allSetsLogged;
  const finalExercise = exerciseIndex >= totalExercises;

  const upsertSet = async (idx: number, patch: any) => {
    if (isDone || timed) return;

    const next = sets.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    setSets(next);

    const row = next[idx];
    await supabase.from("workout_sets").upsert(
      {
        workout_exercise_id: weId,
        set_index: row.set_index,
        reps: row.reps,
        weight: row.weight,
        rir: row.rir,
      },
      { onConflict: "workout_exercise_id,set_index" }
    );
  };

  const persistCompletedSetIndexes = (indexes: number[]) => {
    const unique = Array.from(new Set(indexes.map(Number).filter((value) => value > 0))).sort((a, b) => a - b);
    setCompletedSetIndexes(unique);
    try {
      sessionStorage.setItem(`mvp_completed_sets:${weId}`, JSON.stringify(unique));
    } catch {}
  };

  const setEffortRating = async (idx: number, option: EffortOption) => {
    if (isDone || timed) return;

    const next = sets.map((set, setIndex) =>
      setIndex === idx
        ? { ...set, rir: option.rir, effort_key: option.key }
        : set
    );
    setSets(next);

    try {
      const saved = sessionStorage.getItem(`mvp_set_efforts:${weId}`);
      const parsed = saved ? JSON.parse(saved) : {};
      const map = parsed && typeof parsed === "object" ? parsed : {};
      map[String(next[idx].set_index)] = option.key;
      sessionStorage.setItem(`mvp_set_efforts:${weId}`, JSON.stringify(map));
    } catch {}

    const row = next[idx];
    await supabase.from("workout_sets").upsert(
      {
        workout_exercise_id: weId,
        set_index: row.set_index,
        reps: Number(row.reps ?? 0),
        weight: Number(row.weight ?? 0),
        rir: option.rir,
      },
      { onConflict: "workout_exercise_id,set_index" }
    );
  };

  const completeSetAndStartRest = async (idx: number) => {
    primeWorkoutAudio();
    void preloadWorkoutAlerts();

    if (isDone || timed) return;
    const row = sets[idx];
    const reps = Number(row?.reps ?? 0);
    const weight = Number(row?.weight ?? 0);
    const selectedEffort = effortOption(row?.rir, row?.effort_key);
    const rir = selectedEffort?.rir ?? null;

    if (!(reps > 0) || !(weight > 0)) {
      showToast("ENTER REPS AND WEIGHT BEFORE COMPLETING THE SET.", "err");
      return;
    }

    if (!selectedEffort) {
      showToast("CHOOSE HOW HARD THE SET FELT OR SELECT NOT SURE.", "err");
      return;
    }

    const { error } = await supabase.from("workout_sets").upsert(
      {
        workout_exercise_id: weId,
        set_index: row.set_index,
        reps,
        weight,
        rir,
      },
      { onConflict: "workout_exercise_id,set_index" }
    );

    if (error) {
      showToast(error.message, "err");
      return;
    }

    persistCompletedSetIndexes([...completedSetIndexes, Number(row.set_index)]);

    const advice = buildLiveSetAdvice({ set: { ...row, reps, weight, rir }, exercise: item, repMin, repMax });
    const nextIndex = idx + 1;
    if (advice && nextIndex < sets.length) {
      const nextRows = sets.map((set, setIndex) =>
        setIndex === nextIndex && !completedSetIndexes.includes(Number(set.set_index))
          ? { ...set, weight: advice.nextWeight > 0 ? advice.nextWeight : set.weight }
          : set
      );
      setSets(nextRows);

      const nextRow = nextRows[nextIndex];
      if (nextRow && Number(nextRow.weight) > 0) {
        await supabase.from("workout_sets").upsert(
          {
            workout_exercise_id: weId,
            set_index: nextRow.set_index,
            reps: Number(nextRow.reps ?? 0),
            weight: Number(nextRow.weight),
            rir: nextRow.rir,
          },
          { onConflict: "workout_exercise_id,set_index" }
        );
      }
    }

    const hasNextSet = nextIndex < sets.length;

    const priorCompletedSets = sets
      .filter((set) => completedSetIndexes.includes(Number(set.set_index)))
      .map((set) => ({
        reps: Number(set.reps ?? 0),
        weight: Number(set.weight ?? 0),
      }));

    const prDetails = buildPersonalRecordDetails({
      set: { reps, weight },
      history: historyStats,
      priorCompletedSets,
    });

    if (prDetails.length) {
      setPrCelebration({
        id: `${weId}:${row.set_index}:${Date.now()}`,
        exerciseName: item?.name ?? "Exercise",
        setNumber: Number(row.set_index),
        weight,
        reps,
        records: prDetails,
      });
      /* MVP_TRAINER_V5_R6_MUSIC_INTELLIGENCE_SUITE: PR SOUNDTRACK */
      const prTrack = getMusicPlayerSnapshot().currentTrack;
      if (prTrack) {
        recordPrSoundtrack(prTrack, {
          exerciseName: item?.name ?? "Exercise",
          setNumber: Number(row.set_index),
          records: prDetails.map((record) => record.label),
        });
      }
    } else if (hasNextSet) {
      showToast(`SET ${row.set_index} LOGGED • REST 60 SECONDS.`, "ok");
    } else {
      showToast(`FINAL SET ${row.set_index} LOGGED.`, "ok");
    }

    if (hasNextSet) {
      const nextSetNumber = Number(sets[nextIndex]?.set_index ?? nextIndex + 1);
      const fallbackInstruction = `Keep ${formatLoggedWeight(weight)} lb and stay inside ${repMin}-${repMax} clean reps. Rest 60 seconds.`;

      onStartRest(
        60,
        item?.name ?? "Exercise",
        Number(row.set_index),
        nextSetNumber,
        sets.length,
        advice?.nextInstruction ?? fallbackInstruction
      );
    }
  };

  const editCompletedSet = (setIndex: number) => {
    if (isDone || timed) return;
    persistCompletedSetIndexes(
      completedSetIndexes.filter((value) => value !== Number(setIndex))
    );
    showToast(`SET ${setIndex} UNLOCKED FOR EDITING.`, "ok");
  };

  const applySuggestedWeight = async () => {
    const suggested = Number(previousGuidance.suggestedWeight ?? 0);
    if (!(suggested > 0) || isDone || timed) return;

    const next = sets.map((set) =>
      completedSetIndexes.includes(Number(set.set_index))
        ? set
        : { ...set, weight: suggested }
    );
    setSets(next);
    setCalculatorWeight(suggested);

    const rows = next.map((row) => ({
      workout_exercise_id: weId,
      set_index: row.set_index,
      reps: Number(row.reps ?? 0),
      weight: suggested,
      rir: row.rir,
    }));

    const { error } = await supabase
      .from("workout_sets")
      .upsert(rows, { onConflict: "workout_exercise_id,set_index" });

    if (error) {
      showToast(error.message, "err");
      return;
    }

    showToast(`APPLIED ${formatLoggedWeight(suggested)} LB TO TODAY'S SETS.`, "ok");
  };

  const addSet = async () => {
    if (isDone || timed) return;

    const nextIndex = sets.length + 1;
    const next = [...sets, { set_index: nextIndex, reps: 0, weight: 0, rir: null, effort_key: null }];
    setSets(next);

    await supabase.from("workout_sets").upsert(
      {
        workout_exercise_id: weId,
        set_index: nextIndex,
        reps: 0,
        weight: 0,
        rir: null,
      },
      { onConflict: "workout_exercise_id,set_index" }
    );

    showToast("SET ADDED.", "ok");
  };

  const removeLastSet = async () => {
    if (isDone || timed) return;

    if (sets.length <= 1) {
      showToast("CANNOT REMOVE THE LAST SET.", "err");
      return;
    }

    const last = sets[sets.length - 1];
    const hasData = Number(last?.reps ?? 0) > 0 || Number(last?.weight ?? 0) > 0 || last?.rir != null || !!last?.effort_key;
    if (hasData) {
      showToast("LAST SET HAS DATA. CLEAR REPS/WEIGHT TO REMOVE.", "err");
      return;
    }

    await supabase
      .from("workout_sets")
      .delete()
      .eq("workout_exercise_id", weId)
      .eq("set_index", last.set_index);

    const next = sets.slice(0, -1);
    setSets(next);

    showToast("LAST SET REMOVED.", "ok");
  };

 const savePain = async (nextPain: number) => {
  setPain(nextPain);
  await supabase
    .from("workout_exercises")
    .update({ pain: nextPain })
    .eq("id", weId);

  if (onChanged) {
    await Promise.resolve(onChanged());
  }
};

async function saveTimedActualMinutes(): Promise<void> {
  const cur = workoutExercise.prescription_snapshot ?? {};
  const next = {
    ...(cur || {}),
    actual_minutes: Math.max(0, Math.floor(actualMinutes || 0)),
  };

  await supabase
    .from("workout_exercises")
    .update({ prescription_snapshot: next })
    .eq("id", weId);

  if (onChanged) {
    await Promise.resolve(onChanged());
  }
}

const markDone = async () => {
  primeWorkoutAudio();
  void preloadWorkoutAlerts();

  if (!timed && !allSetsLogged) {
    showToast("COMPLETE EVERY SET WITH WEIGHT, REPS, AND AN EFFORT RATING.", "err");
    return;
  }

  await savePain(pain);

  if (timed) {
    await saveTimedActualMinutes();
  }

  const { error } = await supabase
    .from("workout_exercises")
    .update({ completed_at: new Date().toISOString() })
    .eq("id", weId);

  if (error) {
    showToast(error.message, "err");
    return;
  }

  await onExerciseCompleted(weId);
};

const unlock = async () => {
  const { error } = await supabase
    .from("workout_exercises")
    .update({ completed_at: null })
    .eq("id", weId);

  if (error) {
    showToast(error.message, "err");
    return;
  }

  await onChanged();
  showToast("UNLOCKED.", "ok");
};

  if (loadingSets) return <Card title="Exercise">Loading…</Card>;

  const pColor = painColor(pain);
  const pct = Math.round((pain / 10) * 100);
  const trainingTool = resolveTrainingToolProfile(item);
  const warmupPlan = buildWarmupPlan(calculatorWeight);
  const plateBaseWeight = trainingTool.kind === "plate_loaded" ? 0 : barWeight;
  const plateLoad = calculatePlateLoad(calculatorWeight, plateBaseWeight);

  return (
    <>
      <PersonalRecordOverlay
        celebration={prCelebration}
        onClose={() => setPrCelebration(null)}
      />

      <Card
      title="Exercise Console"
      tone="base"
      clip="no-clip"
      right={
        <div className="tr-exerciseHeadRight">
          <div className="tr-exerciseCountTop">
            Exercise {exerciseIndex} of {totalExercises}
          </div>

          <div className={`tr-painHeadBadge tr-painHeadBadge--${painBand(pain)}`}>
            <span className="tr-painHeadLabel">Pain</span>
            <span className="tr-painHeadValue">{pain}/10</span>
            <span className="tr-painHeadState">{friendlyPainState(pain)}</span>
          </div>
        </div>
      }
    >
      {timed ? (
        <div className="tr-exerciseTopMeta">
          <div className="tr-exerciseSummaryLine">Duration {prescribedMins} min</div>
        </div>
      ) : null}

      <div className="tr-exerciseConsole">
        <div className="tr-exerciseConsoleMedia">
          <MediaOrFallback item={item} exerciseId={item?.exercise_id || item?.id} />
        </div>

        <div className="tr-exerciseConsoleRail">
          <div className="tr-railModule tr-railModule--stats">
            <div className="tr-railStatsGrid">
              <div className="tr-railStat">
                <div className="tr-kicker">Mode</div>
                <div className="tr-railStatValue">{timed ? "Cardio" : "Strength"}</div>
              </div>

              <div className="tr-railStat">
                <div className="tr-kicker">{timed ? "Target" : "Sets"}</div>
                <div className="tr-railStatValue">{timed ? `${prescribedMins} min` : `${setsTarget}`}</div>
              </div>

              <div className="tr-railStat">
                <div className="tr-kicker">{timed ? "Log" : "Reps"}</div>
                <div className="tr-railStatValue">{timed ? "Actual mins" : `${repMin}-${repMax}`}</div>
              </div>

              <div className="tr-railStat">
                <div className="tr-kicker">Viewed</div>
                <div className="tr-railStatValue">
                  {exerciseIndex}/{totalExercises}
                </div>
              </div>
            </div>
          </div>

          <div className="tr-painBox">
            <div className="tr-painTitleRow">
              <div className="tr-painTitle">
                <span className="tr-painIcon" aria-hidden>
                  🏋️
                </span>
                WORKOUT PAIN CHECK
              </div>
              <div className="tr-painSub">Log pain so your coach can adjust next sessions.</div>
            </div>

            <div className="tr-painValue" style={{ color: pColor, textShadow: `0 0 18px ${pColor}44` }}>
              {pain}
            </div>

            <input
              type="range"
              min={0}
              max={10}
              step={1}
              value={pain}
              disabled={isDone}
              onChange={(e) => {
                const v = Math.max(0, Math.min(10, Number(e.target.value)));
                setPainTouched(true);
                setPain(v);
              }}
              onMouseUp={() => painTouched && savePain(pain)}
              onTouchEnd={() => painTouched && savePain(pain)}
              className="tr-painSlider"
              style={{ ["--fillPct" as any]: `${pct}%`, ["--painColor" as any]: pColor }}
            />

            <div className="tr-painHint" style={{ color: pColor }}>
              {painText(pain)}
            </div>

          </div>

          {timed ? (
            <div className="tr-rowbox tr-railModule">
              <div className="tr-sectionTitle">CARDIO LOG</div>
              <div className="tr-sub">Prescribed: {prescribedMins} min • Log what you actually did.</div>

              <div className="tr-qtyRow tr-opRow" style={{ marginTop: 8 }}>
                <button
                  className="tr-qtyBtn tr-opBtn"
                  disabled={isDone}
                  onClick={() => setActualMinutes((v) => Math.max(0, Number(v) - 1))}
                >
                  −
                </button>

                <input
                  className="tr-bigInput tr-opInput"
                  value={String(actualMinutes ?? 0)}
                  disabled={isDone}
                  inputMode="numeric"
                  onChange={(e) => {
                    const cleaned = e.target.value.replace(/[^\d]/g, "");
                    const n = Number(cleaned);
                    setActualMinutes(Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);
                  }}
                />

                <button
                  className="tr-qtyBtn tr-opBtn"
                  disabled={isDone}
                  onClick={() => setActualMinutes((v) => Number(v) + 1)}
                >
                  +
                </button>
              </div>

              <div className="tr-kicker" style={{ textAlign: "center" }}>
                ACTUAL MINUTES
              </div>
            </div>
          ) : (
            <div className="tr-rowbox tr-railModule">
              <div className="tr-workingSetsHeader">
                <div>
                  <div className="tr-kicker">WORKING SETS</div>
                  <div className="tr-workingSetsTitle">{setsTarget} SETS • {repMin}-{repMax} REPS • {restSeconds} SEC REST</div>
                </div>

                <div className="tr-workingSetsHeaderActions">
                  <button
                    className="tr-btn tr-workingSetUtility is-add"
                    disabled={isDone}
                    onClick={addSet}
                  >
                    + ADD SET
                  </button>
                  <button
                    className="tr-btn tr-workingSetUtility is-remove"
                    disabled={isDone}
                    onClick={removeLastSet}
                  >
                    REMOVE LAST
                  </button>
                </div>
              </div>

              <section
                className={`tr-proCoach tr-proCoach--${previousGuidance.decision.toLowerCase()} ${
                  progressionOpen ? "is-open" : "is-collapsed"
                }`}
                aria-label="Progression coach"
              >
                <button
                  type="button"
                  className="tr-proCoachHeader"
                  onClick={() => setProgressionOpen((value) => !value)}
                  aria-expanded={progressionOpen}
                >
                  <span className="tr-proCoachIdentity">
                    <span className="tr-proCoachIcon" aria-hidden>◎</span>
                    <span>
                      <span className="tr-proCoachTitle">PROGRESSION COACH</span>
                      <span className="tr-proCoachSubtitle">Evidence-based load guidance</span>
                    </span>
                  </span>

                  <span className="tr-proCoachHeaderRight">
                    <span className={`tr-proCoachDecision is-${previousGuidance.decision.toLowerCase()}`}>
                      {previousGuidance.decision === "PROGRESS" ? "INCREASE" : previousGuidance.decision === "DELOAD" ? "REDUCE" : previousGuidance.decision}
                    </span>
                    <span className="tr-proCoachMinimize">
                      {progressionOpen ? "MINIMIZE" : "EXPAND"}
                    </span>
                    <span className="tr-proCoachChevron" aria-hidden>
                      {progressionOpen ? "▲" : "▼"}
                    </span>
                  </span>
                </button>

                {!progressionOpen ? (
                  <div className="tr-proCoachCollapsedSummary">
                    <strong>{liveSetAdvice ? liveSetAdvice.status : previousGuidance.action}</strong>
                    <span>{liveSetAdvice ? liveSetAdvice.nextInstruction : previousGuidance.target}</span>
                  </div>
                ) : (
                  <div className="tr-proCoachBody">
                    {previousLoading ? (
                      <div className="tr-sub">Analyzing your completed exercise history…</div>
                    ) : (
                      <>
                        <div className="tr-proCoachHero">
                          <div className="tr-kicker">TODAY'S TRAINING TARGET</div>
                          <div className="tr-proCoachHeroAction">{previousGuidance.action}</div>
                          <div className="tr-proCoachHeroTitle">{previousGuidance.title}</div>
                          <div className="tr-proCoachHeroPrescription">
                            <div>
                              <span>LOAD CHANGE</span>
                              <strong>{previousGuidance.exactChange}</strong>
                            </div>
                            <div>
                              <span>TODAY'S TARGET</span>
                              <strong>{previousGuidance.target}</strong>
                            </div>
                            <div>
                              <span>EFFORT TARGET</span>
                              <strong>{previousGuidance.rirTarget}</strong>
                            </div>
                          </div>
                        </div>

                        <div className="tr-proCoachEvidence">
                          <div>
                            <span>LAST SESSION</span>
                            <strong>{previousGuidance.lastSummary}</strong>
                          </div>
                          <div>
                            <span>BEST SET</span>
                            <strong>{previousGuidance.bestSetSummary}</strong>
                          </div>
                          <div>
                            <span>TREND</span>
                            <strong>{previousGuidance.trend}</strong>
                          </div>
                        </div>

                        <div className="tr-proCoachReason">
                          <div className="tr-kicker">WHY THIS TARGET</div>
                          <p>{previousGuidance.why}</p>
                          <div className="tr-liveRules">
                            <div><span>IF TOO EASY</span><strong>{previousGuidance.ifTooEasy}</strong></div>
                            <div><span>IF TOO HARD</span><strong>{previousGuidance.ifTooHard}</strong></div>
                            <div><span>WHEN TO INCREASE</span><strong>{previousGuidance.progressWhen}</strong></div>
                            <div><span>EXERCISE STATUS</span><strong>{previousGuidance.exerciseDirective} • {previousGuidance.exerciseReason}</strong></div>
                          </div>
                          {previousPerformance ? (
                            <small>
                              {formatPreviousDate(previousPerformance.completedAt)} • {previousPerformance.templateName}
                            </small>
                          ) : null}
                        </div>

                        <div className="tr-proCoachConfidencePanel">
                          <div>
                            <span>COACH CONFIDENCE</span>
                            <strong>{previousGuidance.confidence}</strong>
                            <small>{previousGuidance.confidenceDetail}</small>
                          </div>
                          <div className="tr-proCoachConfidenceDots" aria-label={`${previousGuidance.confidence} confidence`}>
                            {Array.from({ length: 5 }, (_, dotIndex) => (
                              <span
                                key={dotIndex}
                                className={dotIndex < previousGuidance.confidenceScore ? "is-filled" : ""}
                              />
                            ))}
                          </div>
                        </div>

                        {liveSetAdvice && lastCompletedSet ? (
                          <div className={`tr-liveSetReview is-${liveSetAdvice.tone}`}>
                            <div className="tr-liveSetReviewHead">
                              <span>SET {lastCompletedSet.set_index} REVIEW</span>
                              <strong>{liveSetAdvice.status}</strong>
                            </div>
                            <div className="tr-liveSetReviewResult">{liveSetAdvice.summary}</div>
                            <div className="tr-liveSetReviewNext">
                              <span>NEXT SET</span>
                              <strong>{liveSetAdvice.nextInstruction}</strong>
                            </div>
                          </div>
                        ) : null}

                        {previousPerformance?.sets.length ? (
                          <div className="tr-proCoachPreviousSets">
                            {previousPerformance.sets.map((set) => (
                              <span key={set.set_index}>
                                S{set.set_index} {formatLoggedWeight(set.weight)} lb × {set.reps}
                                {set.rir != null ? ` • ${effortLabel(set.rir)}` : ""}
                              </span>
                            ))}
                          </div>
                        ) : null}

                        <div className="tr-proCoachActions">
                          {previousGuidance.suggestedWeight && !isDone ? (
                            <button
                              type="button"
                              className="tr-btn tr-proCoachApply"
                              onClick={applySuggestedWeight}
                            >
                              APPLY {formatLoggedWeight(previousGuidance.suggestedWeight)} LB TO TODAY'S SETS
                            </button>
                          ) : null}

                          <button
                            type="button"
                            className="tr-btn tr-proCoachHistory"
                            onClick={() => navigateWithinWorkoutPlayer(`/library/${exerciseId}`)}
                          >
                            VIEW FULL EXERCISE HISTORY
                          </button>
                        </div>

                        {currentPrLabels.length ? (
                          <div className="tr-livePrPanel">
                            <div className="tr-kicker">LIVE PERSONAL RECORDS</div>
                            <div className="tr-livePrChips">
                              {currentPrLabels.map((label) => (
                                <span key={label} className="tr-livePrChip">★ {label}</span>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                )}
              </section>

              <section className="tr-workingSetsPanel" aria-label="Working sets">
                <div className="tr-workingSetsPanelHead">
                  <div>
                    <span className="tr-kicker">SET EXECUTION</span>
                    <strong>{completedSetIndexes.length} OF {sets.length} SETS LOGGED</strong>
                  </div>
                  <div className="tr-workingSetsProgress" aria-hidden>
                    <span style={{ width: `${sets.length ? (completedSetIndexes.length / sets.length) * 100 : 0}%` }} />
                  </div>
                </div>

                <div className="tr-workingSetList">
                  {sets.map((set, index) => {
                    const setNumber = Number(set.set_index);
                    const isCompletedSet = completedSetIndexes.includes(setNumber);
                    const isActiveSet = !isCompletedSet && index === activeSetIndex;
                    const selectedEffort = effortOption(set.rir, set.effort_key);
                    const previousSet = previousSetForIndex(previousPerformance, setNumber);

                    if (isCompletedSet) {
                      return (
                        <article key={setNumber} className="tr-workingSetRow is-complete">
                          <div className="tr-workingSetStatusIcon" aria-hidden>✓</div>
                          <div className="tr-workingSetSummary">
                            <span>SET {setNumber}</span>
                            <strong>
                              {formatLoggedWeight(Number(set.weight ?? 0))} lb × {Number(set.reps ?? 0)} reps
                            </strong>
                            <small>{effortLabel(set.rir, set.effort_key)} • Rest 60 seconds</small>
                          </div>
                          <span className="tr-workingSetState">COMPLETE</span>
                          {!isDone ? (
                            <button
                              type="button"
                              className="tr-workingSetEdit"
                              onClick={() => editCompletedSet(setNumber)}
                            >
                              EDIT SET
                            </button>
                          ) : null}
                        </article>
                      );
                    }

                    if (!isActiveSet) {
                      return (
                        <article key={setNumber} className="tr-workingSetRow is-upcoming">
                          <div className="tr-workingSetStatusIcon" aria-hidden>{String(setNumber).padStart(2, "0")}</div>
                          <div className="tr-workingSetSummary">
                            <span>SET {setNumber}</span>
                            <strong>Upcoming working set</strong>
                            <small>
                              Previous: {previousSet ? `${formatLoggedWeight(previousSet.weight)} lb × ${previousSet.reps}` : "No prior set"}
                            </small>
                          </div>
                          <span className="tr-workingSetState">UPCOMING</span>
                        </article>
                      );
                    }

                    return (
                      <article key={setNumber} className="tr-workingSetActive">
                        <div className="tr-workingSetActiveHead">
                          <div>
                            <span className="tr-kicker">ACTIVE WORKING SET</span>
                            <strong>SET {setNumber}</strong>
                          </div>
                          <div className="tr-workingSetPrevious">
                            <span>PREVIOUS</span>
                            <strong>
                              {previousSet ? `${formatLoggedWeight(previousSet.weight)} lb × ${previousSet.reps}` : "No data"}
                            </strong>
                          </div>
                        </div>

                        <div className="tr-workingSetControls">
                          <div className="tr-workingSetField">
                            <span>WEIGHT (LB)</span>
                            <Qty
                              label=""
                              value={Number(set.weight ?? 0)}
                              step={5}
                              allowDecimal
                              disabled={isDone}
                              onChange={(value) => upsertSet(index, { weight: value })}
                            />
                          </div>

                          <div className="tr-workingSetField">
                            <span>REPS</span>
                            <Qty
                              label=""
                              value={Number(set.reps ?? 0)}
                              step={1}
                              disabled={isDone}
                              onChange={(value) => upsertSet(index, { reps: value })}
                            />
                          </div>
                        </div>

                        <div className="tr-effortSelector">
                          <div className="tr-effortSelectorHead">
                            <div>
                              <span>HOW HARD DID THAT SET FEEL?</span>
                              <small>Choose the answer that best matches your clean reps.</small>
                            </div>
                            <em>Also called Reps in Reserve</em>
                          </div>

                          <div className="tr-effortOptions">
                            {EFFORT_OPTIONS.map((option) => (
                              <button
                                key={option.key}
                                type="button"
                                className={`${selectedEffort?.key === option.key ? "is-selected" : ""} ${
                                  option.rir === 2 ? "is-target" : ""
                                }`}
                                disabled={isDone}
                                onClick={() => setEffortRating(index, option)}
                                title={option.detail}
                              >
                                <strong>{option.label}</strong>
                                <span>{option.shortLabel}</span>
                              </button>
                            ))}
                          </div>

                          <div className="tr-effortExplanation">
                            {selectedEffort ? (
                              <>
                                <strong>{selectedEffort.label}</strong>
                                <span>{selectedEffort.detail}</span>
                              </>
                            ) : (
                              <>
                                <strong>Select one answer</strong>
                                <span>Think only about another rep with the same clean form and full range of motion.</span>
                              </>
                            )}
                          </div>
                        </div>

                        <button
                          type="button"
                          className="tr-workingSetComplete"
                          disabled={isDone}
                          onClick={() => completeSetAndStartRest(index)}
                        >
                          <span>COMPLETE SET</span>
                        </button>
                      </article>
                    );
                  })}
                </div>
              </section>

              {trainingTool.showTool ? (
                <div className={`tr-trainingCalculator ${calculatorOpen ? "is-open" : ""} is-${trainingTool.kind}`}>
                  <button
                    type="button"
                    className="tr-trainingCalculatorToggle"
                    onClick={() => setCalculatorOpen((value) => !value)}
                  >
                    <span>
                      <span className="tr-kicker">TRAINING TOOLS</span>
                      <strong>{trainingTool.title}</strong>
                      <small className="tr-trainingToolGuidanceTag">GUIDANCE ONLY • NOT LOGGED</small>
                    </span>
                    <span>{calculatorOpen ? "CLOSE" : "OPEN"}</span>
                  </button>

                  {calculatorOpen ? (
                    <div className="tr-trainingCalculatorBody">
                      <div className={`tr-calculatorControls ${trainingTool.showBarSelector ? "has-bar-selector" : "is-single"}`}>
                        <label>
                          <span className="tr-kicker">{trainingTool.inputLabel}</span>
                          <input
                            value={calculatorWeight || ""}
                            inputMode="decimal"
                            onChange={(event: any) => {
                              const raw = event.target.value.replace(/[^\d.]/g, "");
                              const value = Number(raw);
                              setCalculatorWeight(Number.isFinite(value) ? Math.max(0, value) : 0);
                            }}
                            placeholder="Enter weight"
                          />
                        </label>

                        {trainingTool.showBarSelector ? (
                          <label>
                            <span className="tr-kicker">BAR WEIGHT</span>
                            <select value={barWeight} onChange={(event: any) => setBarWeight(Number(event.target.value))}>
                              <option value={45}>45 lb bar</option>
                              <option value={35}>35 lb bar</option>
                              <option value={15}>15 lb training bar</option>
                              <option value={0}>Specialty / no bar weight</option>
                            </select>
                          </label>
                        ) : null}
                      </div>

                      <div className={`tr-calculatorGrid ${trainingTool.showPlateLoading ? "has-plate-loading" : "is-warmup-only"}`}>
                        <div className="tr-calculatorPanel">
                          <div className="tr-kicker">SUGGESTED WARM-UP SETS</div>
                          {warmupPlan.length ? (
                            <div className="tr-warmupRows">
                              {warmupPlan.map((row) => (
                                <div key={`${row.label}-${row.weight}`} className="tr-warmupRow">
                                  <span>{row.label}</span>
                                  <strong>{formatLoggedWeight(row.weight)} lb × {row.reps}</strong>
                                </div>
                              ))}
                              <div className="tr-warmupRow is-working">
                                <span>Working sets</span>
                                <strong>{formatLoggedWeight(calculatorWeight)} lb • {repMin}-{repMax} reps</strong>
                              </div>
                            </div>
                          ) : (
                            <div className="tr-sub">Enter today's working weight to build the warm-up ladder.</div>
                          )}
                        </div>

                        {trainingTool.showPlateLoading ? (
                          <div className="tr-calculatorPanel">
                            <div className="tr-kicker">{trainingTool.plateTitle}</div>
                            {calculatorWeight > plateBaseWeight ? (
                              <>
                                <div className="tr-plateLoadValue">
                                  {plateLoad.perSide.length
                                    ? plateLoad.perSide.map((row) => `${row.count}×${row.plate}`).join(" + ")
                                    : "No plates required"}
                                </div>
                                <div className="tr-sub">
                                  {trainingTool.kind === "plate_loaded"
                                    ? `Added plate load: ${formatLoggedWeight(plateLoad.loadedWeight)} lb`
                                    : `Loaded total: ${formatLoggedWeight(plateLoad.loadedWeight)} lb`}
                                  {plateLoad.remainder > 0.01
                                    ? ` • ${formatLoggedWeight(plateLoad.remainder)} lb below target with available plates`
                                    : " • exact load"}
                                </div>
                              </>
                            ) : (
                              <div className="tr-sub">
                                {trainingTool.kind === "barbell"
                                  ? "Working weight must be above the selected bar weight."
                                  : "Enter the plate load you want to prepare."}
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>

                      <div className="tr-trainingToolGuidanceNote">{trainingTool.helper}</div>
                    </div>
                  ) : null}
                </div>
              ) : null}

            </div>
          )}

        </div>
      </div>

      <section
        className={`tr-exerciseCompletionPanel ${
          isDone ? "is-complete" : readyToLock ? "is-ready" : "is-locked"
        } ${sessionComplete ? "is-sessionComplete" : ""}`}
        aria-label="Exercise completion action"
      >
        <div className="tr-exerciseCompletionState">
          <span className="tr-kicker">
            {sessionComplete
              ? "WORKOUT COMPLETE"
              : isDone
                ? "EXERCISE COMPLETE"
                : readyToLock
                  ? "READY TO ADVANCE"
                  : "ACTION LOCKED"}
          </span>
          <strong>
            {sessionComplete
              ? "All exercises are complete"
              : isDone
                ? "Exercise saved and locked"
                : readyToLock
                  ? finalExercise
                    ? "Ready to finish the final exercise"
                    : "Ready to continue to the next exercise"
                  : "Complete the required training logs"}
          </strong>
        </div>

        {isDone ? (
          <button
            type="button"
            className="tr-btn tr-exerciseCompletionButton is-unlock"
            onClick={unlock}
          >
            Unlock to Edit
          </button>
        ) : (
          <button
            type="button"
            className="tr-btn tr-btn--primary tr-exerciseCompletionButton"
            onClick={markDone}
            disabled={!readyToLock}
          >
            {finalExercise
              ? "Complete Final Exercise"
              : "Complete Exercise & Continue"}
          </button>
        )}
      </section>

      <style>{`
        .tr-exerciseTopMeta{
          display:grid;
          gap:8px;
          margin-bottom: 2px;
        }

        .tr-exerciseSummaryLine{
          font-weight: 1000;
          letter-spacing: .04em;
          color: rgba(255,255,255,.88);
        }

        .tr-sectionTitle{
          font-weight: 1050;
          letter-spacing: .18em;
          text-transform: uppercase;
          opacity: .98;
          font-size: 15px;
        }

        .tr-sectionHeader{
          margin-top: 0;
          display:flex;
          justify-content:space-between;
          gap:10px;
          flex-wrap:wrap;
          align-items:center;
        }

        .tr-sectionHeader--tight{
          margin-bottom: 10px;
        }

        .tr-railStatsGrid{
          display:grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }

        .tr-railStat{
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,.10);
          background:
            linear-gradient(180deg, rgba(255,255,255,.05), rgba(0,0,0,.14));
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.05);
          padding: 10px 12px;
          display:grid;
          gap: 5px;
        }

        .tr-railStatValue{
          font-weight: 1050;
          font-size: 17px;
          line-height: 1.08;
          color: rgba(255,255,255,.95);
        }

        .tr-setStack{
          display:grid;
          gap: 10px;
        }

        .tr-setRowShell{
          border-radius: 16px;
          border: 1px solid rgba(255,255,255,.10);
          background:
            linear-gradient(180deg, rgba(255,255,255,.05), rgba(0,0,0,.12)),
            radial-gradient(320px 120px at 0% 0%, rgba(0,170,255,.06), rgba(0,0,0,0) 66%);
          box-shadow: inset 0 1px 0 rgba(255,255,255,.05);
          padding: 12px;
          display:grid;
          gap: 10px;
        }

        .tr-setRowHead{
          font-weight: 1020;
          letter-spacing: .14em;
          text-transform: uppercase;
          color: rgba(255,255,255,.90);
          font-size: 12px;
        }

        .tr-setGrid{
          display:grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }

        .tr-qtyRow{
          display:grid;
          grid-template-columns: 64px 1fr 64px;
          gap: 10px;
          align-items:center;
        }

        .tr-qtyBtn{
          height: 60px;
          border-radius: 16px;
          border: 1px solid rgba(255,255,255,.14);
          background: linear-gradient(180deg, rgba(255,255,255,.06), rgba(0,0,0,.14));
          color: rgba(255,255,255,.92);
          font-weight: 1000;
          font-size: 26px;
          cursor: pointer;
          box-shadow: inset 0 1px 0 rgba(255,255,255,.05);
          transition: transform .12s ease, border-color .12s ease, box-shadow .12s ease, filter .12s ease;
        }

        .tr-qtyBtn:hover{
          transform: translateY(-1px);
          border-color: rgba(0,170,255,.45);
          box-shadow: 0 14px 40px rgba(0,0,0,.35);
        }

        .tr-qtyBtn:disabled{
          opacity:.55;
          cursor:not-allowed;
          transform:none;
          box-shadow:none;
        }

        .tr-bigInput{
          height: 60px;
          font-size: 22px;
          font-weight: 1000;
          text-align: center;
          width: 100%;
        }

        .tr-painBox{
          border-radius: 16px;
          border: 1px solid rgba(255,255,255,.10);
          background: linear-gradient(180deg, rgba(255,255,255,.045), rgba(0,0,0,.12));
          box-shadow: inset 0 1px 0 rgba(255,255,255,.05);
          padding: 14px 14px 16px;
          display:grid;
          justify-items:center;
          text-align:center;
          gap: 10px;
        }

        .tr-painTitleRow{
          display:grid;
          gap: 6px;
        }

        .tr-painTitle{
          font-weight: 1000;
          letter-spacing: .18em;
          text-transform: uppercase;
          font-size: 16px;
          display:flex;
          align-items:center;
          justify-content:center;
          gap: 10px;
        }

        .tr-painIcon{
          font-size: 18px;
          filter: drop-shadow(0 0 10px rgba(0,170,255,.14));
        }

        .tr-painSub{
          font-size: 12.5px;
          color: rgba(255,255,255,.62);
        }

        .tr-painValue{
          font-weight: 1100;
          font-variant-numeric: tabular-nums;
          font-size: 48px;
          line-height: 1;
        }

        .tr-painSlider{
          width: min(680px, 100%);
          height: 14px;
          -webkit-appearance: none;
          appearance: none;
          border-radius: 999px;
          outline: none;
          background: linear-gradient(90deg, var(--painColor) var(--fillPct), rgba(255,255,255,.14) var(--fillPct));
          border: 1px solid rgba(255,255,255,.12);
          box-shadow: inset 0 1px 0 rgba(255,255,255,.06);
        }

        .tr-painSlider::-webkit-slider-thumb{
          -webkit-appearance: none;
          appearance: none;
          width: 28px;
          height: 28px;
          border-radius: 999px;
          background: var(--painColor);
          border: 2px solid rgba(0,0,0,.35);
          box-shadow: 0 10px 30px rgba(0,0,0,.45), 0 0 18px color-mix(in srgb, var(--painColor) 40%, transparent);
          cursor: pointer;
        }

        .tr-painSlider::-moz-range-thumb{
          width: 28px;
          height: 28px;
          border-radius: 999px;
          background: var(--painColor);
          border: 2px solid rgba(0,0,0,.35);
          box-shadow: 0 10px 30px rgba(0,0,0,.45);
          cursor: pointer;
        }

        .tr-painHint{
          font-weight: 950;
          letter-spacing: .10em;
          text-transform: uppercase;
          font-size: 12px;
        }

        .tr-painRequired{
          margin-top: 2px;
          font-size: 12px;
          color: rgba(255,255,255,.70);
          border: 1px dashed rgba(255,255,255,.16);
          border-radius: 12px;
          padding: 8px 10px;
        }

        .tr-finalActionModule{
          position: static;
          bottom: auto;
          z-index: 1;
          margin-top: 12px;
          border-radius: 18px;
          border: 1px solid rgba(0,170,255,.22);
          background:
            radial-gradient(520px 180px at 50% 0%, rgba(0,170,255,.08), transparent 70%),
            linear-gradient(180deg, rgb(21,28,35), rgb(8,12,17));
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.05),
            0 18px 50px rgba(0,0,0,.38),
            0 0 24px rgba(0,170,255,.08);
          padding: 14px;
          display:grid;
          gap: 12px;
          backdrop-filter: none;
          -webkit-backdrop-filter: none;
        }

        .tr-finalActionModule.is-sessionComplete{
          border-color: rgba(120,230,255,.56);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.06),
            0 22px 64px rgba(0,0,0,.40),
            0 0 26px rgba(0,220,255,.18),
            0 0 72px rgba(0,170,255,.14);
        }

        .tr-finalActionTop{
          display:grid;
          gap: 6px;
        }

        .tr-finalActionDoneText{
          font-weight: 950;
          color: rgba(255,255,255,.88);
        }

        .tr-finalActionDoneText--complete{
          color: rgba(230,249,255,.97);
          letter-spacing: .05em;
          text-shadow:
            0 0 12px rgba(120,230,255,.24),
            0 0 28px rgba(0,170,255,.12);
        }

        .tr-finalActionBottom{
          display:flex;
          gap: 10px;
          justify-content: space-between;
          align-items:center;
          flex-wrap: wrap;
        }

        .tr-finalActionBottom--triple{
          display:grid;
          grid-template-columns: 1fr 1.35fr 1fr;
          gap: 10px;
          align-items:center;
        }

        .tr-doneBtn{
          min-width: 180px;
          width: 100%;
          height: 46px;
        }

        .tr-doneBtn--celebrate{
          box-shadow:
            0 22px 65px rgba(0,170,255,.18),
            0 0 0 1px rgba(0,170,255,.14) inset,
            inset 0 1px 0 rgba(255,255,255,.08),
            0 0 18px rgba(120,230,255,.22),
            0 0 40px rgba(0,170,255,.16);
          animation: trCelebratePulse 1.8s ease-in-out infinite;
        }

        @keyframes trCelebratePulse{
          0%{ transform: scale(1); filter: saturate(1); }
          50%{ transform: scale(1.02); filter: saturate(1.05); }
          100%{ transform: scale(1); filter: saturate(1); }
        }

        .tr-btn--nextOrange{
          border-color: rgba(255,140,0,.70) !important;
          background: linear-gradient(180deg, rgba(255,140,0,.30), rgba(255,80,80,.16)) !important;
          box-shadow:
            0 0 0 1px rgba(255,140,0,.16) inset,
            0 18px 55px rgba(0,0,0,.45),
            0 0 18px rgba(255,140,0,.22),
            0 0 34px rgba(255,80,80,.12) !important;
        }

        .tr-btn--nextOrange:disabled,
        .tr-btn--prevOrange:disabled{
          opacity:.55;
          box-shadow:none !important;
          background: linear-gradient(180deg, rgba(255,255,255,.05), rgba(0,0,0,.12)) !important;
          border-color: rgba(255,255,255,.12) !important;
        }

        .tr-btn--prevOrange{
          border-color: rgba(255,140,0,.70) !important;
          background: linear-gradient(180deg, rgba(255,140,0,.30), rgba(255,80,80,.16)) !important;
          box-shadow:
            0 0 0 1px rgba(255,140,0,.16) inset,
            0 18px 55px rgba(0,0,0,.45),
            0 0 18px rgba(255,140,0,.22),
            0 0 34px rgba(255,80,80,.12) !important;
        }

        .tr-doneCountPill{
          padding: 0 14px;
          border-radius: 999px;
          border: 1px solid rgba(0,170,255,.46);
          background:
            linear-gradient(180deg, rgba(255,255,255,.10) 0%, rgba(255,255,255,.03) 18%, rgba(255,255,255,0) 46%),
            radial-gradient(520px 180px at 50% 55%, rgba(0,170,255,.22) 0%, rgba(0,170,255,.12) 34%, rgba(0,0,0,0) 76%),
            linear-gradient(180deg, rgba(12,18,30,.92), rgba(0,0,0,.22));
          color: rgba(235,252,255,.94);
          font-weight: 1100;
          letter-spacing: .14em;
          text-transform: uppercase;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          box-shadow:
            inset 0 0 0 1px rgba(0,0,0,.55),
            inset 0 0 0 2px rgba(255,255,255,.04),
            inset 0 0 0 3px rgba(0,170,255,.08),
            inset 0 1px 0 rgba(255,255,255,.08),
            0 18px 55px rgba(0,0,0,.45),
            0 0 18px rgba(0,170,255,.12),
            0 0 52px rgba(0,170,255,.08);
          text-shadow:
            0 1px 0 rgba(0,0,0,.80),
            0 0 14px rgba(0,170,255,.10);
        }

        .tr-checkinGrid--tight{
          display:grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          width: 100%;
        }

        @media (max-width: 980px){
          .tr-checkinGrid--tight{ grid-template-columns: 1fr; }
        }

        .tr-checkinTile--tight{
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,.10);
          background: linear-gradient(180deg, rgba(255,255,255,.045), rgba(0,0,0,.12));
          box-shadow: inset 0 1px 0 rgba(255,255,255,.05);
          padding: 12px 12px;
          display: grid;
          gap: 6px;
          justify-items: center;
          text-align: center;
        }

        .tr-checkinValue--tight{
          font-weight: 1100;
          font-size: 22px;
          line-height: 1.05;
          font-variant-numeric: tabular-nums;
          letter-spacing: .04em;
          color: rgba(255,255,255,.94);
        }

        .tr-addedBadge{
          height: 34px;
          min-width: 96px;
          padding: 0 12px;
          border-radius: 999px;
          border: 1px solid rgba(255,140,0,.45);
          background: linear-gradient(180deg, rgba(255,140,0,.18), rgba(0,0,0,.12));
          color: rgba(255,255,255,.92);
          font-weight: 1000;
          letter-spacing: .14em;
          text-transform: uppercase;
          display: inline-grid;
          place-items: center;
          box-shadow: 0 12px 34px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.06);
          transition: transform .14s ease, filter .14s ease, border-color .14s ease;
        }

        .tr-addedBadge.is-on{
          border-color: rgba(255,140,0,.85);
          filter: saturate(1.1);
          transform: scale(1.06);
          box-shadow:
            0 18px 55px rgba(0,0,0,.45),
            0 0 18px rgba(255,140,0,.20),
            0 0 42px rgba(255,80,80,.12);
        }

        .bha-root{
          margin-top: 0;
        }
        @media (max-width: 720px){
  .tr-exerciseConsole{
    display: grid !important;
    grid-template-columns: 1fr !important;
    gap: 12px !important;
  }

  .tr-exerciseConsoleMedia,
  .tr-exerciseConsoleRail,
  .tr-railModule,
  .tr-setStack,
  .tr-setRowShell,
  .tr-setGrid,
  .tr-qtyRow,
  .tr-opRow{
    position: relative !important;
    z-index: 60 !important;
    pointer-events: auto !important;
    overflow: visible !important;
  }

  .tr-setGrid{
    grid-template-columns: 1fr !important;
    gap: 12px !important;
  }

  .tr-qtyRow,
  .tr-opRow{
    grid-template-columns: 64px minmax(0,1fr) 64px !important;
    gap: 8px !important;
    align-items: center !important;
  }

  .tr-opBtn,
  .tr-qtyBtn{
    position: relative !important;
    z-index: 80 !important;
    pointer-events: auto !important;
    touch-action: manipulation !important;
    -webkit-tap-highlight-color: transparent !important;
    height: 58px !important;
    min-height: 58px !important;
    width: 64px !important;
    min-width: 64px !important;
    font-size: 24px !important;
  }

  .tr-opInput,
  .tr-bigInput{
    position: relative !important;
    z-index: 80 !important;
    pointer-events: auto !important;
    touch-action: manipulation !important;
    -webkit-user-select: text !important;
    user-select: text !important;
    height: 58px !important;
    min-height: 58px !important;
    width: 100% !important;
    min-width: 0 !important;
    font-size: 22px !important;
    padding: 0 10px !important;
    text-align: center !important;
  }

   .tr-painSlider{
    position: relative !important;
    z-index: 80 !important;
    pointer-events: auto !important;
    touch-action: pan-x !important;
  }

  .tr-finalActionModule{
    position: static !important;
    bottom: auto !important;
    z-index: 1 !important;
    margin-top: 12px !important;
  }

  .tr-finalActionBottom--triple{
    grid-template-columns: 1fr !important;
  }

  .tr-doneBtn{
    min-width: 0 !important;
    width: 100% !important;
  }
}

.tr-setCardMobile{
  border-radius: 18px;
  border: 1px solid rgba(255,255,255,.10);
  background:
    linear-gradient(180deg, rgba(255,255,255,.05), rgba(0,0,0,.12)),
    radial-gradient(320px 120px at 0% 0%, rgba(0,170,255,.06), rgba(0,0,0,0) 66%);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.05);
  padding: 14px;
  display: grid;
  gap: 14px;
}

.tr-setCardHead{
  font-weight: 1050;
  letter-spacing: .16em;
  text-transform: uppercase;
  color: rgba(255,255,255,.92);
  font-size: 13px;
}

.tr-setFieldBlock{
  display: grid;
  gap: 8px;
}

.tr-setFieldLabel{
  font-size: 12px;
  font-weight: 1000;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: rgba(255,255,255,.70);
}

.tr-qtyBlock{
  display: grid;
  gap: 8px;
}

@media (max-width: 720px){
  .tr-setStack{
    display: grid;
    gap: 12px;
  }

  .tr-setCardMobile{
    padding: 14px 12px;
    gap: 12px;
  }

  .tr-setGrid{
    grid-template-columns: 1fr !important;
  }

  .tr-qtyRow,
  .tr-opRow{
    grid-template-columns: 68px minmax(0,1fr) 68px !important;
    gap: 10px !important;
    align-items: center !important;
  }

  .tr-qtyBtn,
  .tr-opBtn{
    height: 60px !important;
    min-height: 60px !important;
    width: 68px !important;
    min-width: 68px !important;
    font-size: 26px !important;
    border-radius: 16px !important;
  }

  .tr-bigInput,
  .tr-opInput{
    height: 60px !important;
    min-height: 60px !important;
    width: 100% !important;
    min-width: 0 !important;
    font-size: 24px !important;
    font-weight: 1000 !important;
    text-align: center !important;
    border-radius: 16px !important;
    padding: 0 10px !important;
  }
}

/* STEP 3: PREMIUM PROGRESSION COACH + WORKING SETS */
.tr-btn--prevOrange,
.tr-btn--nextOrange{
  border-color:rgba(0,170,255,.42) !important;
  background:
    linear-gradient(180deg,rgba(255,255,255,.075),rgba(255,255,255,.018)),
    linear-gradient(180deg,rgba(12,23,37,.96),rgba(4,9,16,.98)) !important;
  color:rgba(244,251,255,.96) !important;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.08),
    inset 0 0 0 1px rgba(0,0,0,.55),
    0 14px 34px rgba(0,0,0,.34),
    0 0 22px rgba(0,170,255,.10) !important;
}
.tr-btn--nextOrange{
  border-color:rgba(216,185,105,.46) !important;
  color:rgba(255,247,220,.98) !important;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.08),
    inset 0 0 0 1px rgba(0,0,0,.55),
    0 14px 34px rgba(0,0,0,.34),
    0 0 22px rgba(216,185,105,.10) !important;
}
.tr-btn--prevOrange:hover:not(:disabled){
  border-color:rgba(0,196,255,.72) !important;
  transform:translateY(-1px);
}
.tr-btn--nextOrange:hover:not(:disabled){
  border-color:rgba(232,205,132,.75) !important;
  transform:translateY(-1px);
}

.tr-workingSetsHeader{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:16px;
  padding:2px 0 14px;
  border-bottom:1px solid rgba(255,255,255,.08);
}
.tr-workingSetsTitle{
  margin-top:5px;
  color:rgba(246,252,255,.96);
  font-size:18px;
  line-height:1.2;
  font-weight:1050;
  letter-spacing:.025em;
}
.tr-workingSetsHeaderActions{
  display:flex;
  gap:8px;
  flex-wrap:wrap;
  justify-content:flex-end;
}
.tr-workingSetUtility{
  min-height:38px !important;
  height:38px !important;
  padding:0 14px !important;
  border-radius:11px !important;
  font-size:10px !important;
  letter-spacing:.12em !important;
  background:linear-gradient(180deg,rgba(255,255,255,.055),rgba(0,0,0,.16)) !important;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.055),0 10px 24px rgba(0,0,0,.26) !important;
}
.tr-workingSetUtility.is-add{
  border-color:rgba(0,190,255,.48) !important;
  color:rgba(205,245,255,.98) !important;
}
.tr-workingSetUtility.is-remove{
  border-color:rgba(255,105,120,.30) !important;
  color:rgba(255,190,198,.88) !important;
}

.tr-proCoach{
  position:relative; --coach-decision:#63dcff;
  overflow:hidden;
  margin-top:16px;
  border-radius:22px;
  border:1px solid rgba(0,180,255,.27);
  background:
    linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,0) 22%),
    radial-gradient(760px 280px at 0% 0%,rgba(0,170,255,.105),rgba(0,0,0,0) 66%),
    linear-gradient(145deg,rgba(11,19,31,.985),rgba(4,8,14,.985));
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.07),
    inset 0 0 0 1px rgba(0,0,0,.58),
    0 22px 58px rgba(0,0,0,.42),
    0 0 38px rgba(0,170,255,.07);
}
.tr-proCoach::before{
  content:"";
  position:absolute;
  inset:0 auto 0 0;
  width:3px;
  background:linear-gradient(180deg,rgba(0,215,255,.95),rgba(0,120,255,.18));
  box-shadow:0 0 18px rgba(0,190,255,.35);
}
.tr-proCoach--baseline{--coach-decision:#f5fbff;}
.tr-proCoach--hold{--coach-decision:#63dcff;}
.tr-proCoach--progress{--coach-decision:#59f3a8;}
.tr-proCoach--monitor{--coach-decision:#f0c760;}
.tr-proCoach--deload{--coach-decision:#ffad55;}
.tr-proCoachHeader{
  width:100%;
  min-height:72px;
  padding:15px 17px 15px 20px;
  border:0;
  border-bottom:1px solid rgba(255,255,255,.075);
  background:transparent;
  color:inherit;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:14px;
  text-align:left;
  cursor:pointer;
}
.tr-proCoachIdentity{
  display:flex;
  align-items:center;
  gap:12px;
  min-width:0;
}
.tr-proCoachIcon{
  width:38px;
  height:38px;
  flex:0 0 38px;
  display:grid;
  place-items:center;
  border-radius:13px;
  border:1px solid rgba(0,190,255,.42);
  background:linear-gradient(180deg,rgba(0,190,255,.18),rgba(0,100,170,.08));
  color:rgba(202,245,255,.98);
  font-size:23px;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.11),0 0 22px rgba(0,180,255,.12);
}
.tr-proCoachTitle{
  display:block;font-family:inherit;
  color:rgba(250,253,255,.98);
  font-size:14px;
  font-weight:900;
  letter-spacing:.095em;
}
.tr-proCoachSubtitle{
  display:block;
  margin-top:4px;
  color:rgba(181,204,220,.64);
  font-size:10px;
  font-weight:800;
  letter-spacing:.04em;
}
.tr-proCoachHeaderRight{
  display:flex;
  align-items:center;
  justify-content:flex-end;
  gap:8px;
  flex:0 0 auto;
}
.tr-proCoachDecision{
  min-height:30px;
  padding:0 12px;
  border-radius:999px;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  border:1px solid rgba(0,190,255,.46);
  background:rgba(0,170,255,.11);
  color:var(--coach-decision);
  font-size:10px;font-family:inherit;
  font-weight:900;
  letter-spacing:.14em;
}
.tr-proCoachDecision.is-baseline{border-color:rgba(99,220,255,.34);background:rgba(0,170,255,.07);color:#dff8ff;}.tr-proCoachDecision.is-hold{border-color:rgba(99,220,255,.52);background:rgba(0,170,255,.13);color:#8cecff;}.tr-proCoachDecision.is-progress{border-color:rgba(74,235,155,.52);background:rgba(40,205,130,.13);color:#8dffc2;box-shadow:0 0 16px rgba(40,205,130,.10);}
.tr-proCoachDecision.is-monitor{border-color:rgba(240,199,96,.50);background:rgba(205,165,65,.12);color:#ffe09a;box-shadow:0 0 16px rgba(205,165,65,.09);}
.tr-proCoachDecision.is-deload{border-color:rgba(255,173,85,.54);background:rgba(224,124,31,.13);color:#ffc47e;box-shadow:0 0 16px rgba(224,124,31,.10);}
.tr-proCoachMinimize{
  color:rgba(183,207,220,.62);
  font-size:8px;
  font-weight:1000;
  letter-spacing:.12em;
}
.tr-proCoachChevron{
  width:30px;
  height:30px;
  border-radius:10px;
  border:1px solid rgba(255,255,255,.10);
  display:grid;
  place-items:center;
  color:rgba(214,238,248,.84);
  background:rgba(255,255,255,.035);
  font-size:10px;
}
.tr-proCoachCollapsedSummary{
  padding:12px 18px 15px 20px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:14px;
}
.tr-proCoach.is-collapsed .tr-proCoachTitle{color:rgba(250,253,255,.98);text-shadow:none;}
.tr-proCoach.is-collapsed .tr-proCoachIcon{color:rgba(202,245,255,.98);border-color:rgba(0,190,255,.42);}
.tr-proCoachCollapsedSummary strong{
  color:var(--coach-decision);
  font-size:14px;
  letter-spacing:.045em;font-weight:900;text-shadow:0 0 14px currentColor;
}
.tr-proCoachCollapsedSummary span{
  color:rgba(174,202,217,.68);
  font-size:10px;
  text-align:right;
}
.tr-proCoachBody{
  display:grid;
  gap:12px;
  padding:16px 18px 18px 20px;
}
.tr-proCoachHero{
  position:relative;
  overflow:hidden;
  padding:18px 18px 16px 20px;
  border-radius:18px;
  border:1px solid rgba(0,188,255,.25);
  background:
    linear-gradient(180deg,rgba(255,255,255,.052),rgba(255,255,255,0) 28%),
    radial-gradient(640px 230px at 0% 0%,rgba(0,175,255,.13),rgba(0,0,0,0) 70%),
    rgba(2,8,14,.64);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.055),0 16px 34px rgba(0,0,0,.25);
}
.tr-proCoachHero::before{
  content:"";
  position:absolute;
  left:0;
  top:14px;
  bottom:14px;
  width:3px;
  border-radius:0 999px 999px 0;
  background:#25cfff;
  box-shadow:0 0 18px rgba(37,207,255,.45);
}
.tr-proCoachHeroAction{
  margin-top:8px;
  color:var(--coach-decision);
  font-size:clamp(24px,3vw,36px);
  line-height:1.04;
  font-weight:900;font-family:inherit;
  letter-spacing:-.01em;
  text-wrap:balance;
}
.tr-proCoachHeroTitle{
  margin-top:7px;
  color:rgba(180,211,226,.76);
  font-size:13px;
  font-weight:850;
}
.tr-proCoachHeroPrescription{
  margin-top:16px;
  display:grid;
  grid-template-columns:minmax(150px,.7fr) minmax(220px,1.3fr);
  gap:10px;
}
.tr-proCoachHeroPrescription > div{
  min-width:0;
  padding:11px 12px;
  border-radius:13px;
  border:1px solid rgba(255,255,255,.08);
  background:rgba(255,255,255,.028);
  display:grid;
  gap:5px;
}
.tr-proCoachHeroPrescription span,
.tr-proCoachEvidence span,
.tr-proCoachConfidencePanel span,
.tr-liveSetReviewNext span{
  color:rgba(161,191,207,.62);
  font-size:8px;
  font-weight:1050;
  letter-spacing:.14em;
  text-transform:uppercase;
}
.tr-proCoachHeroPrescription strong{
  color:rgba(229,247,255,.96);
  font-size:12px;
  line-height:1.35;
}
.tr-proCoachEvidence{
  display:grid;
  grid-template-columns:repeat(3,minmax(0,1fr));
  border-radius:16px;
  border:1px solid rgba(255,255,255,.075);
  background:rgba(0,0,0,.20);
  overflow:hidden;
}
.tr-proCoachEvidence > div{
  min-width:0;
  padding:13px 14px;
  display:grid;
  gap:6px;
}
.tr-proCoachEvidence > div + div{border-left:1px solid rgba(255,255,255,.07);}
.tr-proCoachEvidence strong{
  color:rgba(240,249,253,.95);
  font-size:13px;
  line-height:1.32;
  overflow-wrap:anywhere;
}
.tr-proCoachReason{
  padding:14px 15px;
  border-radius:15px;
  border:1px solid rgba(255,255,255,.065);
  background:rgba(0,0,0,.16);
}
.tr-proCoachReason p{
  margin:7px 0 0;
  color:rgba(205,223,232,.82);
  font-size:12px;
  line-height:1.55;
}
.tr-proCoachReason small{
  display:block;
  margin-top:7px;
  color:rgba(150,180,195,.54);
  font-size:9px;
}
.tr-proCoachConfidencePanel{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:14px;
  padding:12px 14px;
  border-radius:14px;
  border:1px solid rgba(255,255,255,.07);
  background:rgba(255,255,255,.022);
}
.tr-proCoachConfidencePanel > div:first-child{display:grid;grid-template-columns:auto auto;gap:4px 9px;align-items:center;}
.tr-proCoachConfidencePanel strong{color:rgba(230,247,255,.96);font-size:12px;letter-spacing:.10em;}
.tr-proCoachConfidencePanel small{grid-column:1/-1;color:rgba(160,190,205,.62);font-size:9px;}
.tr-proCoachConfidenceDots{display:flex;align-items:center;gap:5px;}
.tr-proCoachConfidenceDots span{
  width:9px;
  height:9px;
  border-radius:50%;
  border:1px solid rgba(255,255,255,.15);
  background:rgba(255,255,255,.035);
}
.tr-proCoachConfidenceDots span.is-filled{
  border-color:rgba(0,205,255,.65);
  background:#24d0ff;
  box-shadow:0 0 10px rgba(36,208,255,.38);
}
.tr-liveSetReview{
  padding:14px 15px;
  border-radius:16px;
  border:1px solid rgba(0,190,255,.20);
  background:linear-gradient(180deg,rgba(0,180,255,.075),rgba(0,0,0,.15));
}
.tr-liveSetReview.is-good{border-color:rgba(68,231,150,.28);background:linear-gradient(180deg,rgba(40,205,130,.085),rgba(0,0,0,.15));}
.tr-liveSetReview.is-monitor{border-color:rgba(228,198,120,.30);background:linear-gradient(180deg,rgba(205,165,65,.075),rgba(0,0,0,.15));}
.tr-liveSetReview.is-increase{border-color:rgba(92,227,161,.36)!important;box-shadow:inset 3px 0 #5ce3a1}.tr-liveSetReview.is-increase .tr-liveSetReviewHead strong{color:#9ff0bd}.tr-liveSetReview.is-reduce{border-color:rgba(255,102,120,.32);background:linear-gradient(180deg,rgba(225,64,84,.08),rgba(0,0,0,.15));}
.tr-liveSetReviewHead{display:flex;align-items:center;justify-content:space-between;gap:12px;color:rgba(173,204,218,.68);font-size:9px;font-weight:1050;letter-spacing:.13em;}
.tr-liveSetReviewHead strong{color:rgba(235,250,255,.95);font-size:9px;}
.tr-liveSetReviewResult{margin-top:9px;color:rgba(250,253,255,.98);font-size:17px;font-weight:1100;}
.tr-liveSetReviewNext{margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.07);display:grid;gap:5px;}
.tr-liveSetReviewNext strong{color:rgba(207,230,240,.86);font-size:11px;line-height:1.45;}
.tr-proCoachPreviousSets{display:flex;gap:7px;flex-wrap:wrap;}
.tr-proCoachPreviousSets span{padding:7px 9px;border-radius:999px;border:1px solid rgba(255,255,255,.075);background:rgba(255,255,255,.025);color:rgba(185,211,223,.72);font-size:8px;font-weight:900;}
.tr-proCoachActions{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,.72fr);gap:9px;}
.tr-proCoachApply,
.tr-proCoachHistory{
  min-height:45px !important;
  border-radius:13px !important;
  font-size:9px !important;
  letter-spacing:.11em !important;
}
.tr-proCoachApply{
  border-color:rgba(0,205,255,.52) !important;
  background:
    linear-gradient(180deg,rgba(62,220,255,.20),rgba(0,111,185,.15)),
    linear-gradient(180deg,rgba(11,30,46,.98),rgba(3,12,21,.98)) !important;
  color:rgba(240,253,255,.98) !important;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.12),0 0 26px rgba(0,190,255,.13) !important;
}
.tr-proCoachHistory{
  border-color:rgba(255,255,255,.12) !important;
  background:rgba(255,255,255,.025) !important;
  color:rgba(201,224,235,.82) !important;
}

.tr-workingSetsPanel{
  margin-top:14px;
  padding:15px;
  border-radius:20px;
  border:1px solid rgba(255,255,255,.085);
  background:
    linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,0) 20%),
    rgba(2,7,12,.56);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.045),0 18px 42px rgba(0,0,0,.28);
}
.tr-workingSetsPanelHead{
  display:grid;
  grid-template-columns:auto minmax(120px,1fr);
  align-items:center;
  gap:18px;
  padding-bottom:13px;
  border-bottom:1px solid rgba(255,255,255,.07);
}
.tr-workingSetsPanelHead > div:first-child{display:grid;gap:5px;}
.tr-workingSetsPanelHead strong{color:rgba(237,249,254,.92);font-size:11px;letter-spacing:.10em;}
.tr-workingSetsProgress{
  height:6px;
  border-radius:999px;
  background:rgba(255,255,255,.065);
  overflow:hidden;
  box-shadow:inset 0 1px 2px rgba(0,0,0,.6);
}
.tr-workingSetsProgress span{
  display:block;
  height:100%;
  border-radius:inherit;
  background:linear-gradient(90deg,#1db8ff,#4de4c2);
  box-shadow:0 0 16px rgba(29,184,255,.34);
  transition:width .28s ease;
}
.tr-workingSetList{display:grid;gap:10px;margin-top:12px;}
.tr-workingSetRow{
  min-height:70px;
  padding:11px 12px;
  border-radius:15px;
  border:1px solid rgba(255,255,255,.075);
  background:rgba(255,255,255,.022);
  display:grid;
  grid-template-columns:42px minmax(0,1fr) auto auto;
  align-items:center;
  gap:11px;
}
.tr-workingSetRow.is-complete{
  border-color:rgba(62,225,145,.20);
  background:linear-gradient(90deg,rgba(38,190,119,.07),rgba(255,255,255,.016));
}
.tr-workingSetRow.is-upcoming{opacity:.74;}
.tr-workingSetStatusIcon{
  width:40px;
  height:40px;
  border-radius:12px;
  display:grid;
  place-items:center;
  border:1px solid rgba(255,255,255,.10);
  background:rgba(255,255,255,.035);
  color:rgba(180,210,223,.72);
  font-size:11px;
  font-weight:1100;
  letter-spacing:.08em;
}
.tr-workingSetRow.is-complete .tr-workingSetStatusIcon{
  border-color:rgba(62,225,145,.34);
  background:rgba(38,190,119,.11);
  color:#8cffbf;
  font-size:18px;
}
.tr-workingSetSummary{display:grid;gap:3px;min-width:0;}
.tr-workingSetSummary > span{color:rgba(149,181,196,.58);font-size:7px;font-weight:1050;letter-spacing:.14em;}
.tr-workingSetSummary strong{color:rgba(239,249,253,.94);font-size:13px;line-height:1.25;}
.tr-workingSetSummary small{color:rgba(163,191,204,.60);font-size:9px;line-height:1.3;}
.tr-workingSetState{
  padding:6px 8px;
  border-radius:999px;
  border:1px solid rgba(255,255,255,.08);
  color:rgba(166,196,209,.60);
  font-size:7px;
  font-weight:1100;
  letter-spacing:.12em;
}
.tr-workingSetRow.is-complete .tr-workingSetState{border-color:rgba(62,225,145,.25);color:#91efb7;background:rgba(38,190,119,.07);}
.tr-workingSetEdit{
  min-height:31px;
  padding:0 10px;
  border-radius:9px;
  border:1px solid rgba(0,180,255,.25);
  background:rgba(0,160,225,.06);
  color:rgba(190,231,247,.82);
  font-size:7px;
  font-weight:1050;
  letter-spacing:.11em;
  cursor:pointer;
}
.tr-workingSetActive{
  padding:16px;
  border-radius:18px;
  border:1px solid rgba(0,190,255,.31);
  background:
    linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,0) 24%),
    radial-gradient(560px 180px at 0% 0%,rgba(0,175,255,.095),rgba(0,0,0,0) 70%),
    rgba(3,10,17,.80);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 18px 42px rgba(0,0,0,.32),0 0 28px rgba(0,175,255,.07);
}
.tr-workingSetActiveHead{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:14px;
  padding-bottom:13px;
  border-bottom:1px solid rgba(255,255,255,.075);
}
.tr-workingSetActiveHead > div:first-child{display:grid;gap:4px;}
.tr-workingSetActiveHead > div:first-child strong{color:rgba(248,253,255,.98);font-size:22px;letter-spacing:.05em;}
.tr-workingSetPrevious{text-align:right;display:grid;gap:4px;}
.tr-workingSetPrevious span{color:rgba(148,180,195,.58);font-size:7px;font-weight:1050;letter-spacing:.14em;}
.tr-workingSetPrevious strong{color:rgba(207,229,239,.84);font-size:11px;}
.tr-workingSetControls{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:12px;
  margin-top:14px;
}
.tr-workingSetField{display:grid;gap:8px;}
.tr-workingSetField > span{color:rgba(170,199,212,.68);font-size:9px;font-weight:1050;letter-spacing:.13em;}
.tr-workingSetActive .tr-qtyRow{
  grid-template-columns:50px minmax(0,1fr) 50px !important;
  gap:7px !important;
}
.tr-workingSetActive .tr-qtyBtn{
  width:50px !important;
  min-width:50px !important;
  height:52px !important;
  min-height:52px !important;
  border-radius:14px !important;
  border-color:rgba(255,255,255,.10) !important;
  background:linear-gradient(180deg,rgba(255,255,255,.065),rgba(0,0,0,.20)) !important;
  color:rgba(232,246,252,.95) !important;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 10px 22px rgba(0,0,0,.22) !important;
}
.tr-workingSetActive .tr-qtyBtn:hover:not(:disabled){border-color:rgba(0,190,255,.50) !important;color:#d8f8ff !important;}
.tr-workingSetActive .tr-bigInput{
  height:52px !important;
  min-height:52px !important;
  border-radius:14px !important;
  border-color:rgba(0,180,255,.19) !important;
  background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(0,0,0,.24)) !important;
  color:rgba(250,253,255,.99) !important;
  font-size:22px !important;
  font-weight:1100 !important;
  box-shadow:inset 0 1px 3px rgba(0,0,0,.55),0 0 18px rgba(0,170,255,.045) !important;
}
.tr-effortSelector{
  margin-top:14px;
  padding-top:14px;
  border-top:1px solid rgba(255,255,255,.075);
}
.tr-effortSelectorHead{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;}
.tr-effortSelectorHead > div{display:grid;gap:4px;}
.tr-effortSelectorHead span{color:rgba(237,249,254,.92);font-size:10px;font-weight:1100;letter-spacing:.10em;}
.tr-effortSelectorHead small{color:rgba(159,189,203,.62);font-size:9px;}
.tr-effortSelectorHead em{color:rgba(147,177,190,.48);font-size:8px;font-style:normal;}
.tr-effortOptions{
  display:grid;
  grid-template-columns:repeat(3,minmax(0,1fr));
  gap:8px;
  margin-top:11px;
}
.tr-effortOptions button{
  position:relative;
  min-height:66px;
  padding:10px 7px 9px;
  border-radius:13px;
  border:1px solid rgba(255,255,255,.12);
  background:
    linear-gradient(180deg,rgba(255,255,255,.075),rgba(255,255,255,.025) 34%,rgba(0,0,0,.18)),
    linear-gradient(180deg,rgba(12,19,27,.98),rgba(4,8,13,.99));
  color:rgba(229,242,248,.90);
  display:grid;
  align-content:center;
  gap:5px;
  cursor:pointer;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.075),
    inset 0 -1px 0 rgba(0,0,0,.72),
    0 2px 2px rgba(0,0,0,.62),
    0 10px 22px rgba(0,0,0,.28);
  transition:transform .14s ease,border-color .14s ease,background .14s ease,box-shadow .14s ease,color .14s ease;
}
.tr-effortOptions button:hover:not(:disabled){
  transform:translateY(-1px);
  border-color:rgba(0,190,255,.38);
  color:rgba(246,252,255,.98);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.09),0 3px 3px rgba(0,0,0,.62),0 13px 26px rgba(0,0,0,.32);
}
.tr-effortOptions button strong{font-size:10px;font-weight:900;line-height:1.12;letter-spacing:.01em;}
.tr-effortOptions button span{font-size:8px;font-weight:750;color:rgba(184,207,218,.72);line-height:1.18;}
.tr-effortOptions button.is-target::after{
  content:"TARGET";
  position:absolute;
  top:5px;
  right:6px;
  padding:2px 5px;
  border-radius:999px;
  border:1px solid rgba(221,194,119,.35);
  background:#16140d;
  color:#e8d399;
  font-size:5px;
  font-weight:1100;
  letter-spacing:.09em;
}
.tr-effortOptions button.is-selected{
  border-color:rgba(0,205,255,.68);
  background:linear-gradient(180deg,rgba(0,200,255,.19),rgba(0,90,155,.10));
  color:rgba(240,253,255,.99);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.10),0 0 20px rgba(0,190,255,.12);
}
.tr-effortOptions button.is-selected span{color:rgba(199,235,247,.79);}
.tr-effortExplanation{
  margin-top:10px;
  min-height:30px;
  padding:6px 2px 0;
  border:0;
  background:transparent;
  display:flex;
  align-items:flex-start;
  gap:9px;
}
.tr-effortExplanation strong{color:rgba(228,245,252,.92);font-size:9px;white-space:nowrap;}
.tr-effortExplanation span{color:rgba(164,191,204,.66);font-size:9px;line-height:1.35;}
.tr-workingSetComplete{
  width:100%;
  min-height:58px;
  margin-top:14px;
  border-radius:15px;
  border:1px solid rgba(0,205,255,.58);
  background:
    linear-gradient(180deg,rgba(71,224,255,.22),rgba(0,105,175,.14)),
    linear-gradient(180deg,#0b2638,#06131f);
  color:rgba(247,254,255,.99);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.15),
    inset 0 0 0 1px rgba(0,0,0,.48),
    0 14px 28px rgba(0,0,0,.30),
    0 0 24px rgba(0,195,255,.13);
  display:grid;
  place-content:center;
  gap:3px;
  cursor:pointer;
  transition:transform .14s ease,border-color .14s ease,box-shadow .14s ease;
}
.tr-workingSetComplete:hover:not(:disabled){transform:translateY(-1px);border-color:rgba(89,229,255,.85);box-shadow:inset 0 1px 0 rgba(255,255,255,.18),0 17px 32px rgba(0,0,0,.34),0 0 31px rgba(0,195,255,.20);}
.tr-workingSetComplete:active:not(:disabled){transform:translateY(1px);}
.tr-workingSetComplete span{font-size:12px;font-weight:1150;letter-spacing:.14em;}
.tr-workingSetComplete small{font-size:8px;color:rgba(194,230,243,.70);font-weight:850;letter-spacing:.04em;}

@media (max-width:900px){
  .tr-proCoachHeroPrescription{grid-template-columns:1fr;}
  .tr-effortOptions{grid-template-columns:repeat(3,minmax(0,1fr));}
}

@media (max-width:720px){
  .tr-workingSetsHeader{align-items:flex-start;gap:10px;}
  .tr-workingSetsTitle{font-size:13px;white-space:nowrap;}
  .tr-workingSetsHeaderActions{gap:5px;}
  .tr-workingSetUtility{height:33px !important;min-height:33px !important;padding:0 9px !important;font-size:7px !important;}
  .tr-proCoach{margin-top:12px;border-radius:17px;}
  .tr-proCoachHeader{min-height:61px;padding:11px 11px 11px 15px;gap:8px;}
  .tr-proCoachIcon{width:33px;height:33px;flex-basis:33px;border-radius:11px;font-size:19px;}
  .tr-proCoachTitle{font-size:11px;letter-spacing:.11em;}
  .tr-proCoachSubtitle{font-size:8px;}
  .tr-proCoachHeaderRight{gap:5px;}
  .tr-proCoachDecision{min-height:24px;padding:0 7px;font-size:7px;letter-spacing:.10em;}
  .tr-proCoachMinimize{display:none;}
  .tr-proCoachChevron{width:27px;height:27px;border-radius:9px;font-size:8px;}
  .tr-proCoachCollapsedSummary{padding:9px 12px 12px 15px;display:grid;gap:4px;}
  .tr-proCoachCollapsedSummary strong{font-size:11px;}
  .tr-proCoachCollapsedSummary span{text-align:left;font-size:8px;}
  .tr-proCoachBody{padding:11px 11px 13px 14px;gap:9px;}
  .tr-proCoachHero{padding:14px 12px 12px 15px;border-radius:14px;}
  .tr-proCoachHeroAction{font-size:23px;}
  .tr-proCoachHeroTitle{font-size:10px;}
  .tr-proCoachHeroPrescription{margin-top:11px;grid-template-columns:1fr 1fr;gap:7px;}
  .tr-proCoachHeroPrescription > div{padding:8px;border-radius:10px;}
  .tr-proCoachHeroPrescription strong{font-size:9px;}
  .tr-proCoachEvidence{grid-template-columns:repeat(3,minmax(0,1fr));border-radius:12px;}
  .tr-proCoachEvidence > div{padding:9px 7px;}
  .tr-proCoachEvidence strong{font-size:9px;line-height:1.22;}
  .tr-proCoachEvidence span{font-size:6px;letter-spacing:.09em;}
  .tr-proCoachReason{padding:10px 11px;border-radius:12px;}
  .tr-proCoachReason p{font-size:9px;line-height:1.45;}
  .tr-proCoachConfidencePanel{padding:9px 10px;border-radius:11px;}
  .tr-liveSetReview{padding:10px 11px;border-radius:12px;}
  .tr-liveSetReviewResult{font-size:13px;}
  .tr-liveSetReviewNext strong{font-size:9px;}
  .tr-proCoachActions{grid-template-columns:1fr;gap:7px;}
  .tr-proCoachApply,.tr-proCoachHistory{min-height:40px !important;font-size:7px !important;}
  .tr-workingSetsPanel{margin-top:11px;padding:10px;border-radius:16px;}
  .tr-workingSetsPanelHead{grid-template-columns:1fr;gap:8px;padding-bottom:10px;}
  .tr-workingSetList{gap:7px;margin-top:9px;}
  .tr-workingSetRow{min-height:60px;padding:8px 9px;border-radius:12px;grid-template-columns:35px minmax(0,1fr) auto;gap:8px;}
  .tr-workingSetStatusIcon{width:34px;height:34px;border-radius:10px;font-size:9px;}
  .tr-workingSetSummary strong{font-size:11px;}
  .tr-workingSetSummary small{font-size:8px;}
  .tr-workingSetState{font-size:6px;padding:5px 6px;}
  .tr-workingSetEdit{grid-column:2/-1;justify-self:end;min-height:27px;font-size:6px;}
  .tr-workingSetActive{padding:11px;border-radius:14px;}
  .tr-workingSetActiveHead{padding-bottom:9px;}
  .tr-workingSetActiveHead > div:first-child strong{font-size:18px;}
  .tr-workingSetPrevious strong{font-size:9px;}
  .tr-workingSetControls{grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;}
  .tr-workingSetField > span{font-size:7px;}
  .tr-workingSetActive .tr-qtyRow{grid-template-columns:41px minmax(0,1fr) 41px !important;gap:5px !important;}
  .tr-workingSetActive .tr-qtyBtn{width:41px !important;min-width:41px !important;height:46px !important;min-height:46px !important;border-radius:12px !important;font-size:20px !important;}
  .tr-workingSetActive .tr-bigInput{height:46px !important;min-height:46px !important;border-radius:12px !important;font-size:18px !important;padding:0 5px !important;}
  .tr-effortSelector{margin-top:11px;padding-top:11px;}
  .tr-effortSelectorHead{align-items:flex-start;}
  .tr-effortSelectorHead span{font-size:8px;}
  .tr-effortSelectorHead small{font-size:7px;}
  .tr-effortSelectorHead em{display:none;}
  .tr-effortOptions{grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;margin-top:9px;}
  .tr-effortOptions button{min-height:60px;padding:9px 6px;border-radius:11px;}
  .tr-effortOptions button strong{font-size:9px;}
  .tr-effortOptions button span{font-size:7.5px;}
  .tr-effortExplanation{min-height:30px;padding:7px 1px 0;gap:7px;align-items:flex-start;}
  .tr-effortExplanation strong{font-size:8px;}
  .tr-effortExplanation span{font-size:8px;}
  .tr-workingSetComplete{min-height:51px;margin-top:11px;border-radius:13px;}
  .tr-workingSetComplete span{font-size:10px;}
  .tr-workingSetComplete small{font-size:7px;}
}

/* STEP 5B • POLISHED AUTO-DISMISSING REST RECOVERY */
.tr-recoveryOverlay{
  position:fixed;
  inset:0;
  z-index:22000;
  display:grid;
  place-items:center;
  padding:clamp(18px,4vw,46px);
  background:rgba(1,6,10,.90);
  overscroll-behavior:none;
}

.tr-recoveryPanel{
  --tr-recovery-progress:0%;
  position:relative;
  width:min(600px,100%);
  overflow:hidden;
  border:1px solid rgba(37,199,244,.48);
  border-radius:28px;
  background:
    radial-gradient(circle at 50% -20%,rgba(32,177,232,.14),transparent 44%),
    linear-gradient(180deg,#0b1821 0%,#071118 52%,#040a0f 100%);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.10),
    inset 0 0 0 1px rgba(0,0,0,.64),
    0 34px 100px rgba(0,0,0,.76),
    0 0 44px rgba(0,177,229,.10);
  color:#effaff;
  isolation:isolate;
}

.tr-recoveryPanel::before{
  content:"";
  position:absolute;
  inset:0;
  z-index:-1;
  pointer-events:none;
  background:
    linear-gradient(120deg,transparent 18%,rgba(255,255,255,.035) 42%,transparent 64%),
    repeating-linear-gradient(90deg,transparent 0 79px,rgba(255,255,255,.014) 80px);
}

.tr-recoveryHeader{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:18px;
  padding:22px 24px 17px;
  border-bottom:1px solid rgba(255,255,255,.07);
}

.tr-recoveryKicker{
  color:#71dcff;
  font-size:10px;
  font-weight:1000;
  letter-spacing:.19em;
  line-height:1;
}

.tr-recoveryExercise{
  margin-top:6px;
  color:rgba(218,237,246,.72);
  font-size:13px;
  font-weight:850;
  line-height:1.25;
}

.tr-recoverySetChip{
  flex:0 0 auto;
  min-height:32px;
  padding:0 12px;
  border:1px solid rgba(213,181,91,.34);
  border-radius:999px;
  background:rgba(121,85,15,.11);
  color:#ead18a;
  display:grid;
  place-items:center;
  font-size:8px;
  font-weight:1000;
  letter-spacing:.13em;
}

.tr-recoveryClockStage{
  display:grid;
  place-items:center;
  gap:10px;
  padding:25px 20px 18px;
}

.tr-recoveryProgressRing{
  width:clamp(235px,56vw,330px);
  aspect-ratio:1;
  border-radius:50%;
  padding:9px;
  display:grid;
  place-items:center;
  background:
    conic-gradient(from -90deg,#34d9f6 var(--tr-recovery-progress),rgba(255,255,255,.055) 0);
  box-shadow:
    0 0 30px rgba(25,194,236,.12),
    inset 0 0 0 1px rgba(255,255,255,.035);
}

.tr-recoveryProgressRing::before{
  content:"";
  grid-area:1/1;
  width:100%;
  height:100%;
  border-radius:50%;
  background:
    radial-gradient(circle at 50% 32%,rgba(26,168,219,.12),transparent 48%),
    linear-gradient(180deg,#0b1720,#050b10);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.08),
    inset 0 0 34px rgba(0,0,0,.58);
}

.tr-recoveryClock{
  grid-area:1/1;
  position:relative;
  z-index:1;
  color:#f5fbff;
  font-family:"Helvetica Neue",Arial,Helvetica,sans-serif !important;
  font-size:clamp(68px,14vw,102px);
  font-weight:800;
  line-height:1;
  letter-spacing:-.055em;
  font-variant-numeric:tabular-nums lining-nums !important;
  font-feature-settings:"tnum" 1,"lnum" 1,"zero" 0 !important;
  font-variation-settings:normal !important;
  font-synthesis:none;
  text-decoration:none !important;
  text-shadow:0 3px 0 rgba(0,0,0,.72),0 0 28px rgba(34,202,244,.15);
}

.tr-recoveryClockLabel{
  color:rgba(149,182,196,.66);
  font-size:8px;
  font-weight:1000;
  letter-spacing:.17em;
}

.tr-recoveryInstruction{
  margin:0 24px;
  padding:17px 18px;
  border:1px solid rgba(213,181,91,.22);
  border-radius:18px;
  background:linear-gradient(180deg,rgba(122,86,17,.08),rgba(0,0,0,.10));
  box-shadow:inset 0 1px 0 rgba(255,255,255,.04);
}

.tr-recoveryInstructionLabel{
  color:#d8bb6d;
  font-size:8px;
  font-weight:1000;
  letter-spacing:.15em;
}

.tr-recoveryInstructionText{
  margin-top:8px;
  color:rgba(231,244,249,.90);
  font-size:14px;
  font-weight:850;
  line-height:1.45;
}

.tr-recoveryInstructionMeta{
  display:flex;
  flex-wrap:wrap;
  gap:8px 15px;
  margin-top:12px;
  padding-top:10px;
  border-top:1px solid rgba(255,255,255,.06);
}

.tr-recoveryInstructionMeta span{
  color:rgba(147,178,192,.59);
  font-size:7px;
  font-weight:950;
  letter-spacing:.12em;
}

.tr-recoveryAdjustments{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:10px;
  padding:18px 24px 10px;
}

.tr-recoveryAdjustments button,
.tr-recoverySkip{
  min-height:50px;
  border-radius:14px;
  font-size:10px;
  font-weight:1000;
  letter-spacing:.11em;
  cursor:pointer;
  transition:transform .14s ease,border-color .14s ease,background .14s ease;
}

.tr-recoveryAdjustments button{
  border:1px solid rgba(255,255,255,.11);
  background:linear-gradient(180deg,rgba(255,255,255,.055),rgba(0,0,0,.18));
  color:rgba(222,239,247,.88);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.055),0 10px 24px rgba(0,0,0,.22);
}

.tr-recoveryAdjustments button:hover:not(:disabled),
.tr-recoverySkip:hover{
  transform:translateY(-1px);
  border-color:rgba(0,200,255,.43);
}

.tr-recoveryAdjustments button:disabled{
  opacity:.28;
  cursor:not-allowed;
}

.tr-recoverySkip{
  width:calc(100% - 48px);
  margin:0 24px 24px;
  border:1px solid rgba(64,203,237,.38);
  background:linear-gradient(180deg,rgba(0,177,231,.15),rgba(0,67,102,.10)),#07131b;
  color:#dff8ff;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.055),0 12px 28px rgba(0,0,0,.24);
}

.tr-recoveryPanel.is-final-ten{
  border-color:rgba(221,179,69,.52);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.10),0 34px 100px rgba(0,0,0,.76),0 0 44px rgba(221,172,47,.11);
}

.tr-recoveryPanel.is-final-ten .tr-recoveryProgressRing{
  background:conic-gradient(from -90deg,#f0cf70 var(--tr-recovery-progress),rgba(255,255,255,.055) 0);
  box-shadow:0 0 30px rgba(225,177,48,.12),inset 0 0 0 1px rgba(255,255,255,.035);
}

.tr-recoveryPanel.is-final-ten .tr-recoveryClock{
  color:#f2d77f;
  text-shadow:0 3px 0 rgba(0,0,0,.72),0 0 28px rgba(225,177,48,.16);
}

.tr-recoveryPanel.is-final-three .tr-recoveryClock{
  animation:trRecoveryPulse .72s ease-in-out infinite alternate;
}

@keyframes trRecoveryPulse{
  from{transform:scale(1);opacity:.90;}
  to{transform:scale(1.025);opacity:1;}
}

.tr-recoveryPanel.is-ready{
  width:min(500px,100%);
  border-color:rgba(48,224,143,.54);
  background:
    radial-gradient(circle at 50% -15%,rgba(27,214,126,.17),transparent 48%),
    linear-gradient(180deg,#0a1b17 0%,#06110e 58%,#040a08 100%);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.10),0 34px 100px rgba(0,0,0,.76),0 0 54px rgba(31,218,132,.14);
}

.tr-recoveryReadyState{
  min-height:390px;
  padding:42px 24px;
  display:grid;
  place-items:center;
  align-content:center;
  gap:9px;
  text-align:center;
}

.tr-recoveryReadyIcon{
  width:62px;
  height:62px;
  margin-bottom:8px;
  border:1px solid rgba(72,235,158,.45);
  border-radius:50%;
  display:grid;
  place-items:center;
  background:rgba(31,187,111,.14);
  color:#73efb6;
  font-size:28px;
  font-weight:1000;
  box-shadow:0 0 28px rgba(43,223,139,.14);
}

.tr-recoveryReadyKicker{
  color:#70efb4;
  font-size:11px;
  font-weight:1000;
  letter-spacing:.20em;
}

.tr-recoveryReadyTitle{
  color:#e9fff5;
  font-size:clamp(24px,6vw,36px);
  font-weight:1000;
  letter-spacing:.025em;
}

.tr-recoveryReadyGo{
  margin-top:8px;
  color:#82f3be;
  font-family:"Helvetica Neue",Arial,Helvetica,sans-serif;
  font-size:clamp(58px,14vw,90px);
  font-weight:900;
  line-height:1;
  text-shadow:0 0 28px rgba(54,226,144,.20);
}

.tr-recoveryReadyNote{
  color:rgba(167,204,184,.64);
  font-size:8px;
  font-weight:950;
  letter-spacing:.15em;
}

@media (prefers-reduced-motion:reduce){
  .tr-recoveryPanel.is-final-three .tr-recoveryClock{animation:none;}
}

@media (max-width:720px){
  .tr-recoveryOverlay{
    align-items:end;
    padding:12px 12px calc(84px + env(safe-area-inset-bottom));
  }

  .tr-recoveryPanel{
    width:100%;
    max-height:calc(100dvh - 104px);
    overflow:auto;
    border-radius:24px;
  }

  .tr-recoveryHeader{padding:17px 17px 13px;}
  .tr-recoveryKicker{font-size:9px;}
  .tr-recoveryExercise{font-size:11px;}
  .tr-recoverySetChip{min-height:28px;padding:0 9px;font-size:7px;}
  .tr-recoveryClockStage{padding:20px 12px 15px;}
  .tr-recoveryProgressRing{width:min(68vw,270px);padding:7px;}
  .tr-recoveryClock{font-size:clamp(62px,18vw,84px);}
  .tr-recoveryInstruction{margin:0 17px;padding:14px;}
  .tr-recoveryInstructionText{font-size:12px;}
  .tr-recoveryAdjustments{padding:14px 17px 9px;}
  .tr-recoverySkip{width:calc(100% - 34px);margin:0 17px 17px;}
  .tr-recoveryReadyState{min-height:330px;padding:34px 18px;}
}

/* R9.4 LIVE ADAPTIVE COACH */
.tr-proCoachHeroPrescription{grid-template-columns:repeat(3,minmax(0,1fr))!important}
.tr-liveRules{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}
.tr-liveRules>div{padding:10px 11px;border:1px solid rgba(105,202,229,.11);border-radius:10px;background:rgba(4,14,19,.55)}
.tr-liveRules span{display:block;color:rgba(147,184,198,.72);font-size:8px;font-weight:1000;letter-spacing:.09em}
.tr-liveRules strong{display:block;margin-top:5px;color:rgba(238,249,252,.94);font-size:10px;line-height:1.45}
@media(max-width:720px){.tr-proCoachHeroPrescription{grid-template-columns:1fr!important}.tr-liveRules{grid-template-columns:1fr}.tr-liveRules strong{font-size:9px}}
      `}
</style>
      </Card>
    </>
  );
}

function Qty({
  label,
  value,
  step,
  allowDecimal = false,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  allowDecimal?: boolean;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  const [draft, setDraft] = useState(() => String(value ?? 0));

  useEffect(() => {
    setDraft(String(value ?? 0));
  }, [value]);

  const commitDraft = () => {
    const normalized = draft.trim().replace(/^\./, "0.");
    const parsed = Number(normalized);
    if (Number.isFinite(parsed) && parsed >= 0) {
      onChange(allowDecimal ? parsed : Math.floor(parsed));
      setDraft(String(allowDecimal ? parsed : Math.floor(parsed)));
      return;
    }
    setDraft(String(value ?? 0));
  };

  return (
    <div className="tr-qtyBlock">
      {label ? <div className="tr-kicker">{label}</div> : null}

      <div className="tr-qtyRow tr-opRow">
        <button
          className="tr-qtyBtn tr-opBtn"
          disabled={disabled}
          onClick={() => onChange(Math.max(0, Number(value) - step))}
          type="button"
        >
          −
        </button>

        <input
          className="tr-bigInput tr-opInput"
          value={draft}
          disabled={disabled}
          inputMode={allowDecimal ? "decimal" : "numeric"}
          onChange={(e) => {
            const raw = e.target.value;
            const cleaned = allowDecimal
              ? raw.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1")
              : raw.replace(/[^\d]/g, "");
            setDraft(cleaned);

            if (!cleaned || cleaned === "." || cleaned.endsWith(".")) return;
            const parsed = Number(cleaned);
            if (Number.isFinite(parsed) && parsed >= 0) {
              onChange(allowDecimal ? parsed : Math.floor(parsed));
            }
          }}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commitDraft();
              e.currentTarget.blur();
            }
          }}
        />

        <button
          className="tr-qtyBtn tr-opBtn"
          disabled={disabled}
          onClick={() => onChange(Number(value) + step)}
          type="button"
        >
          +
        </button>
      </div>
    </div>
  );
}
