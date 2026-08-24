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
import { resolveMuscleVisual } from "../../lib/muscleVisuals";

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
    <img
      className="tr-siVisualAsset tr-siVisualBody"
      src="/session-intel/mvp-body-hologram.png"
      alt=""
      aria-hidden="true"
      loading="eager"
      decoding="async"
    />
  );
}

function SessionProteinCore() {
  return (
    <img
      className="tr-siVisualAsset tr-siVisualProtein"
      src="/session-intel/mvp-shaker.png"
      alt=""
      aria-hidden="true"
      loading="eager"
      decoding="async"
    />
  );
}

function SessionHistoryDial() {
  return (
    <img
      className="tr-siVisualAsset tr-siVisualChrono"
      src="/session-intel/mvp-chrono.png"
      alt=""
      aria-hidden="true"
      loading="eager"
      decoding="async"
    />
  );
}

function SessionSetsDumbbell() {
  return (
    <img
      className="tr-siSetsDumbbellAsset"
      src="/session-intel/mvp-sets-dumbbell.png"
      alt=""
      aria-hidden="true"
      loading="eager"
      decoding="async"
    />
  );
}

function SessionVolumeMark() {
  return (
    <svg className="tr-siVolumeMark" viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="trSiVolumeShell" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#79efff" />
          <stop offset=".52" stopColor="#1d8cff" />
          <stop offset="1" stopColor="#ff9b32" />
        </linearGradient>
        <radialGradient id="trSiVolumeCore" cx="50%" cy="42%" r="62%">
          <stop offset="0" stopColor="#17374a" />
          <stop offset="1" stopColor="#05090d" />
        </radialGradient>
      </defs>
      <path d="M20 6h24l14 14v24L44 58H20L6 44V20L20 6Z" fill="rgba(8,17,24,.96)" stroke="url(#trSiVolumeShell)" strokeWidth="2" />
      <path d="M23 13h18l10 10v18L41 51H23L13 41V23l10-10Z" fill="url(#trSiVolumeCore)" stroke="rgba(180,233,255,.28)" />
      <circle cx="32" cy="32" r="10" fill="none" stroke="rgba(116,229,255,.75)" strokeWidth="3" />
      <circle cx="32" cy="32" r="4" fill="#ffad42" />
      <path d="M32 18v5M32 41v5M18 32h5M41 32h5" stroke="rgba(231,250,255,.78)" strokeWidth="2" strokeLinecap="round" />
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

  const currentExerciseName =
    current?.exercise?.name ?? current?.exercise?.title ?? "Not set";
  const nextIncompleteIndex = (() => {
    const afterCurrent = items.findIndex(
      (row, index) => index > activeIdx && !row.completed_at
    );
    if (afterCurrent >= 0) return afterCurrent;
    return items.findIndex(
      (row, index) => index !== activeIdx && !row.completed_at
    );
  })();
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
  const roadmapNextEntry =
    nextIncompleteIndex >= 0 ? { row: items[nextIncompleteIndex], index: nextIncompleteIndex } : null;
  const roadmapRemainingEntries = items
    .map((row, index) => ({ row, index }))
    .filter(({ row, index }) =>
      index !== activeIdx &&
      index !== nextIncompleteIndex &&
      !row.completed_at
    );
  const roadmapDoneEntries = items
    .map((row, index) => ({ row, index }))
    .filter(({ row, index }) => index !== activeIdx && !!row.completed_at);
  const roadmapVisualFor = (row: any) =>
    resolveMuscleVisual({
      ...(row?.exercise || {}),
      name: row?.exercise?.name ?? row?.exercise?.title ?? "",
      primary_muscles: row?.exercise?.primary_muscles ?? [],
      secondary_muscles: row?.exercise?.secondary_muscles ?? [],
    });
  const currentRoadmapVisual = current ? roadmapVisualFor(current) : resolveMuscleVisual(null);
  const roadmapRailInset = items.length > 1 ? Math.min(12, 50 / Math.max(items.length, 1)) : 50;
  const roadmapRailSpan = 100 - roadmapRailInset * 2;

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
                <span aria-hidden="true" className={sessionIntelExpanded ? "is-up" : "is-down"} />
              </button>
            </div>
          }
        >
          {sessionIntelExpanded ? (
            <div className="tr-siMax">
              <div className="tr-siPrimaryRow">
                <section className="tr-siFeature is-weight">
                  <div className="tr-siFeatureVisual is-body"><SessionBodyHologram /></div>
                  <div className="tr-siFeatureCopy">
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
                </section>

                <section className="tr-siFeature is-protein">
                  <div className="tr-siFeatureVisual is-shaker"><SessionProteinCore /></div>
                  <div className="tr-siFeatureCopy">
                    <span>PROTEIN TARGET</span>
                    <strong>{proteinTarget != null ? `${proteinTarget} G` : "—"}</strong>
                    <small>DAILY MUSCLE-GAIN TARGET</small>
                  </div>
                </section>

                <section className="tr-siFeature is-last">
                  <div className="tr-siFeatureVisual is-chrono"><SessionHistoryDial /></div>
                  <div className="tr-siFeatureCopy">
                    <span>LAST {sessionShortLabel.toUpperCase()}</span>
                    <strong>{lastSessionAgo}</strong>
                    <small>{lastSession ? compactDate(lastSession.completedAt) : "COMPLETE ONE TO BUILD HISTORY"}</small>
                  </div>
                </section>
              </div>

              <section className="tr-siBenchmark">
                <div className="tr-siBenchmarkTitle">
                  <span>PREVIOUS {sessionShortLabel.toUpperCase()}</span>
                  <strong>{lastSession ? "PERFORMANCE BENCHMARK" : "NO COMPLETED BENCHMARK YET"}</strong>
                </div>

                <div className="tr-siBenchmarkMetrics">
                  <div className="tr-siBenchMetric is-time">
                    <div className="tr-siBenchIcon tr-siBenchClock"><SessionHistoryDial /></div>
                    <div className="tr-siBenchCopy">
                      <strong>{formatMinutesCompact(lastSession?.durationMinutes)}</strong>
                      <span>SESSION TIME</span>
                    </div>
                  </div>

                  <div className="tr-siBenchMetric is-sets">
                    <div className="tr-siBenchIcon tr-siBenchDumbbell">
                      <SessionSetsDumbbell />
                    </div>
                    <div className="tr-siBenchCopy">
                      <strong>{lastSession ? `${lastSession.completedSets} / ${lastSession.plannedSets}` : "—"}</strong>
                      <span>SETS COMPLETED</span>
                    </div>
                  </div>

                  <div className="tr-siBenchMetric is-volume">
                    <div className="tr-siBenchIcon tr-siBenchVolume"><SessionVolumeMark /></div>
                    <div className="tr-siBenchCopy">
                      <strong>{formatVolumeLb(lastSession?.volume)}</strong>
                      <span>TRAINING VOLUME</span>
                    </div>
                  </div>
                </div>

                <div className={`tr-siPerfDelta ${
                  volumeDelta != null && volumeDelta > 0
                    ? "is-positive"
                    : volumeDelta != null && volumeDelta < 0
                      ? "is-negative"
                      : ""
                }`}>
                  {lastSession ? volumeDeltaText : "COMPLETE THIS SESSION TO CREATE YOUR FIRST BENCHMARK"}
                </div>
              </section>

              <section className="tr-siWeekStrip">
                <div className="tr-siWeekStat is-left">
                  <span>THIS WEEK</span>
                  <strong>{weekCompletionText}</strong>
                  <small>WORKOUTS COMPLETED</small>
                </div>
                <div className="tr-siWeekRail" aria-hidden="true">
                  <span className="tr-siWeekTrack" />
                  <span
                    className="tr-siWeekFill"
                    style={{ width: `${Math.min(100, Math.max(4, Number(weekCompletionText) * 20))}%` }}
                  />
                  <i className="is-start" />
                  <i /><i /><i /><i /><i className="is-end" />
                </div>
                <div className="tr-siWeekStat is-right">
                  <strong>{weekTrainingTime}</strong>
                  <small>TRAINED THIS WEEK</small>
                </div>
              </section>
            </div>
          ) : (
            <div className="tr-siCompact">
              <div className="tr-siCompactMetric is-weight">
                <div className="tr-siCompactVisual is-body"><SessionBodyHologram /></div>
                <div className="tr-siCompactCopy">
                  <small>BODY WEIGHT</small>
                  <strong>{startedWeight != null ? `${formatLoggedWeight(startedWeight)} LB` : "—"}</strong>
                  <span className={`tr-siMiniTrend ${weightTrend != null && weightTrend > 0 ? "is-positive" : weightTrend != null && weightTrend < 0 ? "is-negative" : ""}`}>{weightTrendText}</span>
                </div>
              </div>

              <div className="tr-siCompactMetric is-protein">
                <div className="tr-siCompactVisual is-shaker"><SessionProteinCore /></div>
                <div className="tr-siCompactCopy">
                  <small>PROTEIN TARGET</small>
                  <strong>{proteinTarget != null ? `${proteinTarget} G` : "—"}</strong>
                  <span>DAILY TARGET</span>
                </div>
              </div>

              <div className="tr-siCompactMetric is-last">
                <div className="tr-siCompactVisual is-chrono"><SessionHistoryDial /></div>
                <div className="tr-siCompactCopy">
                  <small>LAST {sessionShortLabel.toUpperCase()}</small>
                  <strong>{lastSessionAgo}</strong>
                  <span>{lastSession ? compactDate(lastSession.completedAt) : "NO HISTORY"}</span>
                </div>
              </div>

              <div className="tr-siCompactMetric is-performance">
                <small>PREVIOUS PERFORMANCE</small>
                <div className="tr-siCompactPerformance">
                  <span className="tr-siCompactPerfItem">
                    <b className="tr-siMiniClock"><SessionHistoryDial /></b>
                    <span className="tr-siCompactPerfCopy"><strong>{formatMinutesCompact(lastSession?.durationMinutes)}</strong><small>SESSION TIME</small></span>
                  </span>
                  <em>•</em>
                  <span className="tr-siCompactPerfItem">
                    <b className="tr-siMiniDumbbell"><SessionSetsDumbbell /></b>
                    <span className="tr-siCompactPerfCopy"><strong>{lastSession ? `${lastSession.completedSets}/${lastSession.plannedSets}` : "—"}</strong><small>SETS COMPLETED</small></span>
                  </span>
                  <em>•</em>
                  <span className="tr-siCompactPerfItem">
                    <b className="tr-siMiniVolume"><SessionVolumeMark /></b>
                    <span className="tr-siCompactPerfCopy"><strong>{formatVolumeLb(lastSession?.volume)}</strong><small>TRAINING VOLUME</small></span>
                  </span>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>

      <div className="tr-workoutSessionCard">
        <Card title={sessionLabel} tone="blue">
          <section
            className="tr-roadmapV2"
            aria-label="Workout roadmap"
            style={{ "--tr-roadmap-progress": progressRatio, "--tr-roadmap-count": Math.max(items.length, 1) } as any}
          >
            <div className="tr-roadmapV2Header">
              <div className="tr-roadmapV2Title">
                <span>EXERCISE PROGRESS</span>
                <div className="tr-roadmapV2TitleLine">
                  <strong>WORKOUT ROADMAP</strong>
                  <button
                    type="button"
                    className="tr-roadmapV2Edit"
                    onClick={() => setEditing(true)}
                    aria-label="Edit workout"
                    title="Edit workout"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M4.8 15.9 4 20l4.1-.8L18.7 8.6l-3.3-3.3L4.8 15.9Z" />
                      <path d="m14.2 6.5 3.3 3.3" />
                    </svg>
                    <span>EDIT</span>
                  </button>
                </div>
              </div>
              <div
                className="tr-roadmapV2Count"
                aria-label={`${doneCount} of ${items.length} completed`}
              >
                <strong>{doneCount}<span> / {items.length}</span></strong>
                <small>COMPLETED</small>
              </div>
            </div>

            <div
              className="tr-roadmapV2Rail"
              role="navigation"
              aria-label={`Workout exercise map. ${doneCount} of ${items.length} completed.`}
            >
              <span className="tr-roadmapV2RailBed" aria-hidden="true" />
              {items.slice(0, -1).map((row, index) => {
                const leftState = index === activeIdx ? "current" : row.completed_at ? "done" : index === nextIncompleteIndex ? "next" : "remaining";
                const rightRow = items[index + 1];
                const rightState = index + 1 === activeIdx ? "current" : rightRow?.completed_at ? "done" : index + 1 === nextIncompleteIndex ? "next" : "remaining";
                const segmentState =
                  leftState === "done" && rightState === "done"
                    ? "done"
                    : leftState === "current" || rightState === "current"
                      ? "current"
                      : leftState === "next" || rightState === "next"
                        ? "next"
                        : "remaining";
                const left = items.length <= 1 ? 50 : roadmapRailInset + (index / (items.length - 1)) * roadmapRailSpan;
                const right = items.length <= 1 ? 50 : roadmapRailInset + ((index + 1) / (items.length - 1)) * roadmapRailSpan;
                return (
                  <span
                    key={`roadmap-segment-${row.id}`}
                    className={`tr-roadmapV2Segment is-${segmentState}`}
                    style={{ left: `${left}%`, width: `${right - left}%` }}
                    aria-hidden="true"
                  />
                );
              })}
              {items.map((row, index) => {
                const isCurrentNode = index === activeIdx;
                const isDoneNode = !!row.completed_at;
                const isNextNode = index === nextIncompleteIndex && !isCurrentNode;
                const state = isCurrentNode ? "CURRENT" : isDoneNode ? "DONE" : isNextNode ? "NEXT" : "REMAINING";
                const nodeLeft = items.length <= 1 ? 50 : roadmapRailInset + (index / (items.length - 1)) * roadmapRailSpan;
                const exerciseName = row.exercise?.name ?? row.exercise?.title ?? `Exercise ${index + 1}`;
                return (
                  <button
                    key={`roadmap-node-${row.id}`}
                    type="button"
                    className={`tr-roadmapV2Node ${isCurrentNode ? "is-current" : ""} ${isDoneNode ? "is-done" : ""} ${isNextNode ? "is-next" : ""}`}
                    style={{ left: `${nodeLeft}%` }}
                    onClick={() => setActiveIdx(index)}
                    aria-current={isCurrentNode ? "step" : undefined}
                    aria-label={`Exercise ${index + 1}: ${exerciseName}. ${state}. Go to exercise.`}
                    title={`${String(index + 1).padStart(2, "0")} • ${exerciseName} • ${state}`}
                  >
                    <span className="tr-roadmapV2NodeFace" aria-hidden="true">
                      {isDoneNode ? <b>✓</b> : <span className="tr-roadmapV2NodeLens" />}
                    </span>
                    <span className="tr-roadmapV2NodeName">{exerciseName}</span>
                    <small>{isCurrentNode ? "NOW" : isNextNode ? "NEXT" : isDoneNode ? "DONE" : "LEFT"}</small>
                  </button>
                );
              })}
            </div>

            <div className="tr-roadmapV2Body">
              <div className={`tr-roadmapV2Current ${current?.completed_at ? "is-complete" : ""}`}>
                <div className="tr-roadmapV2CurrentFx" aria-hidden="true" />
                <div className="tr-roadmapV2CurrentVisual" aria-hidden="true">
                  <span className="tr-roadmapV2VisualHalo" />
                  <img
                    src={currentRoadmapVisual.src}
                    alt=""
                    loading="eager"
                    onError={(event) => event.currentTarget.remove()}
                  />
                </div>
                <div className="tr-roadmapV2CurrentCopy">
                  <div className="tr-roadmapV2CurrentIndex">
                    {String(activeIdx + 1).padStart(2, "0")} <small>/ {String(items.length).padStart(2, "0")}</small>
                  </div>
                  <strong>{currentExerciseName}</strong>
                  <span className="tr-roadmapV2MuscleLabel">{currentRoadmapVisual.label} • PRIMARY TARGET</span>
                  <span className={`tr-roadmapV2CurrentState ${current?.completed_at ? "is-complete" : ""}`}>
                    {current?.completed_at ? "COMPLETED • SELECTED" : "CURRENT"}
                  </span>
                </div>
              </div>

              <div className="tr-roadmapV2Agenda" aria-label="Workout agenda">
                {roadmapNextEntry ? (
                  <div className="tr-roadmapV2Group is-next">
                    <div className="tr-roadmapV2GroupHead"><span>UP NEXT</span></div>
                    {(() => {
                      const { row, index } = roadmapNextEntry;
                      const name = row.exercise?.name ?? row.exercise?.title ?? `Exercise ${index + 1}`;
                      const visual = roadmapVisualFor(row);
                      return (
                        <button
                          type="button"
                          className="tr-roadmapV2AgendaRow is-next"
                          onClick={() => setActiveIdx(index)}
                          aria-label={`Go to ${name}`}
                        >
                          <span className="tr-roadmapV2AgendaVisual" aria-hidden="true">
                            <img src={visual.src} alt="" loading="lazy" onError={(event) => event.currentTarget.remove()} />
                          </span>
                          <span className="tr-roadmapV2AgendaCopy"><strong>{name}</strong><small>{visual.label} • UP NEXT</small></span>
                          <span className="tr-roadmapV2AgendaArrow" aria-hidden="true">›</span>
                        </button>
                      );
                    })()}
                  </div>
                ) : null}

                {roadmapRemainingEntries.length ? (
                  <div className="tr-roadmapV2Group is-remaining">
                    <div className="tr-roadmapV2GroupHead"><span>REMAINING</span><small>{roadmapRemainingEntries.length}</small></div>
                    {roadmapRemainingEntries.map(({ row, index }) => {
                      const name = row.exercise?.name ?? row.exercise?.title ?? `Exercise ${index + 1}`;
                      const visual = roadmapVisualFor(row);
                      return (
                        <button
                          key={row.id}
                          type="button"
                          className="tr-roadmapV2AgendaRow is-remaining"
                          onClick={() => setActiveIdx(index)}
                          aria-label={`Go to ${name}`}
                        >
                          <span className="tr-roadmapV2AgendaVisual" aria-hidden="true">
                            <img src={visual.src} alt="" loading="lazy" onError={(event) => event.currentTarget.remove()} />
                          </span>
                          <span className="tr-roadmapV2AgendaCopy"><strong>{name}</strong><small>{visual.label} • REMAINING</small></span>
                          <span className="tr-roadmapV2AgendaArrow" aria-hidden="true">›</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                {roadmapDoneEntries.length ? (
                  <div className="tr-roadmapV2Group is-done">
                    <div className="tr-roadmapV2GroupHead"><span>DONE</span><small>{roadmapDoneEntries.length}</small></div>
                    {roadmapDoneEntries.map(({ row, index }) => {
                      const name = row.exercise?.name ?? row.exercise?.title ?? `Exercise ${index + 1}`;
                      const visual = roadmapVisualFor(row);
                      return (
                        <button
                          key={row.id}
                          type="button"
                          className="tr-roadmapV2AgendaRow is-done"
                          onClick={() => setActiveIdx(index)}
                          aria-label={`Go to completed exercise ${name}`}
                        >
                          <span className="tr-roadmapV2DoneCheck" aria-hidden="true">✓</span>
                          <span className="tr-roadmapV2AgendaVisual" aria-hidden="true">
                            <img src={visual.src} alt="" loading="lazy" onError={(event) => event.currentTarget.remove()} />
                          </span>
                          <span className="tr-roadmapV2AgendaCopy"><strong>{name}</strong><small>{visual.label} • COMPLETED</small></span>
                          <span className="tr-roadmapV2AgendaArrow" aria-hidden="true">›</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
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
           R12.5C.5 — SESSION CHECK-IN / SESSION INTEL
           Exact mockup direction: premium one-surface instrument panel,
           user-supplied hologram / shaker / chrono assets, standalone chevron,
           chrono + dumbbell + load benchmark icons, and a real weekly rail.
           ============================================================ */
        .tr-siShell .tr-card{
          position:relative;
          overflow:hidden;
          border-color:rgba(63,190,236,.32);
          background:
            radial-gradient(850px 280px at 9% -20%,rgba(20,176,255,.12),transparent 62%),
            radial-gradient(780px 280px at 100% 100%,rgba(255,137,36,.08),transparent 60%),
            linear-gradient(180deg,#07131b 0%,#03090e 100%);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.07),
            inset 0 -1px 0 rgba(255,155,49,.11),
            0 22px 60px rgba(0,0,0,.28);
        }
        .tr-siShell .tr-card::before{
          content:"";position:absolute;inset:0;pointer-events:none;z-index:0;
          background:
            linear-gradient(110deg,transparent 0 34%,rgba(111,226,255,.035) 43%,transparent 53%),
            repeating-linear-gradient(90deg,rgba(255,255,255,.009) 0 1px,transparent 1px 7px);
          mix-blend-mode:screen;opacity:.72
        }
        .tr-siShell .tr-card-head,.tr-siShell .tr-card-body{position:relative;z-index:1}
        .tr-siShell .tr-card-head{
          min-height:50px;
          padding-top:0!important;padding-bottom:0!important;
          border-bottom:1px solid rgba(93,191,225,.13)!important;
          background:linear-gradient(180deg,rgba(255,255,255,.025),transparent);
        }
        .tr-siShell.is-compact .tr-card-head{min-height:40px}
        .tr-siShell .tr-card-body{padding:0!important}

        .tr-siShell .tr-card-head{align-items:center!important}
        .tr-siShell .tr-card-title,.tr-siShell .tr-card-right{align-self:center!important}
        .tr-siHeaderRight{display:flex;align-items:center;justify-content:flex-end;align-self:center;height:100%;gap:12px;min-width:0}
        .tr-siToggle{
          appearance:none;border:0!important;background:transparent!important;
          width:28px;height:28px;display:grid;place-items:center;align-self:center;margin:0;padding:0;
          color:#b9efff;cursor:pointer;box-shadow:none!important;border-radius:0!important;
          transition:color .16s ease,filter .16s ease;
        }
        .tr-siToggle:hover{color:#fff;filter:drop-shadow(0 0 8px rgba(54,210,255,.62))}
        .tr-siToggle span{
          display:block;width:10px;height:10px;box-sizing:border-box;
          border-right:2px solid currentColor;border-bottom:2px solid currentColor;
          filter:drop-shadow(0 0 7px rgba(46,209,255,.42));transform-origin:50% 50%;
        }
        .tr-siToggle span.is-up{transform:translateY(2px) rotate(225deg)}
        .tr-siToggle span.is-down{transform:translateY(-2px) rotate(45deg)}

        .tr-siVisualAsset{display:block;max-width:100%;height:auto;object-fit:contain;pointer-events:none;user-select:none}
        .tr-siVisualBody{filter:saturate(1.08) contrast(1.03) drop-shadow(0 0 17px rgba(28,153,255,.34))}
        .tr-siVisualProtein{filter:drop-shadow(0 18px 25px rgba(0,0,0,.36)) drop-shadow(0 0 10px rgba(20,133,255,.18))}
        .tr-siVisualChrono{filter:drop-shadow(0 17px 24px rgba(0,0,0,.38)) drop-shadow(0 0 10px rgba(255,133,25,.18))}

        /* Expanded desktop: exactly three premium image/text pairings on one surface. */
        .tr-siMax{position:relative;min-width:0;background:linear-gradient(180deg,rgba(4,12,18,.35),rgba(2,7,11,.40));overflow:hidden}
        .tr-siPrimaryRow{display:grid;grid-template-columns:1.06fr .98fr 1.08fr;min-height:238px}
        .tr-siFeature{
          position:relative;min-width:0;display:grid;grid-template-columns:minmax(92px,.90fr) minmax(0,1fr);
          align-items:center;gap:13px;padding:16px 20px;overflow:hidden;
        }
        .tr-siFeature + .tr-siFeature::before{
          content:"";position:absolute;left:0;top:22px;bottom:22px;width:1px;
          background:linear-gradient(180deg,transparent,rgba(119,210,240,.16),transparent)
        }
        .tr-siFeature::after{
          content:"";position:absolute;inset:auto 8% 0 8%;height:1px;opacity:.40;
          background:linear-gradient(90deg,transparent,rgba(49,215,255,.62),transparent)
        }
        .tr-siFeature.is-last::after{background:linear-gradient(90deg,transparent,rgba(255,162,57,.50),transparent)}
        .tr-siFeatureVisual{min-width:0;height:200px;display:grid;place-items:center;align-self:end}
        .tr-siFeatureVisual.is-body{height:208px;align-self:stretch}
        .tr-siFeatureVisual.is-body .tr-siVisualBody{height:100%;width:100%;object-fit:contain;object-position:center bottom}
        .tr-siFeatureVisual.is-shaker .tr-siVisualProtein{height:194px;max-width:145px}
        .tr-siFeatureVisual.is-chrono .tr-siVisualChrono{height:164px;max-width:164px}
        .tr-siFeatureCopy{min-width:0;display:grid;gap:6px;align-content:center}
        .tr-siFeatureCopy>span,.tr-siBenchmarkTitle>span,.tr-siBenchCopy>span,.tr-siWeekStat>span,.tr-siWeekStat>small,.tr-siCompactCopy>small,.tr-siCompactCopy>span,.tr-siCompactMetric.is-performance>small{
          color:rgba(186,214,226,.72);font-size:8px;font-weight:1000;letter-spacing:.15em;text-transform:uppercase
        }
        .tr-siFeatureCopy strong{
          min-width:0;color:#f8fcff;font-size:clamp(29px,3vw,44px);line-height:.94;font-weight:1100;
          letter-spacing:-.045em;font-variant-numeric:tabular-nums;text-shadow:0 3px 0 rgba(0,0,0,.58),0 0 19px rgba(68,220,255,.08);
          white-space:normal;overflow-wrap:anywhere
        }
        .tr-siFeature.is-last .tr-siFeatureCopy strong{color:#ffbd5f;text-shadow:0 3px 0 rgba(0,0,0,.60),0 0 20px rgba(255,145,36,.12)}
        .tr-siFeatureCopy small{font-size:7.4px!important;font-weight:1000!important;letter-spacing:.085em!important;line-height:1.25;white-space:normal!important;overflow:visible!important;text-overflow:clip!important}
        .tr-siTrend.is-positive,.tr-siMiniTrend.is-positive{color:#70f4a1!important}.tr-siTrend.is-negative,.tr-siMiniTrend.is-negative{color:#ff9b65!important}

        /* Benchmark: no waveform / no bar clusters. Clock, dumbbell, high-end load mark. */
        .tr-siBenchmark{
          display:grid;grid-template-columns:1.06fr 3fr;grid-template-areas:"title metrics" "delta metrics";
          align-items:center;min-height:112px;padding:13px 20px 12px;border-top:1px solid rgba(95,198,234,.13);
          border-bottom:1px solid rgba(95,198,234,.10);
          background:linear-gradient(180deg,rgba(5,17,24,.72),rgba(2,8,12,.72));
        }
        .tr-siBenchmarkTitle{grid-area:title;min-width:0;display:grid;gap:4px;padding-right:18px}
        .tr-siBenchmarkTitle strong{color:#e4f8fe;font-size:11px;line-height:1.22;font-weight:1050;letter-spacing:.035em;text-transform:uppercase}
        .tr-siBenchmarkMetrics{grid-area:metrics;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));min-width:0;align-self:stretch}
        .tr-siBenchMetric{position:relative;min-width:0;display:grid;grid-template-columns:72px minmax(0,1fr);align-items:center;gap:12px;padding:5px 16px}
        .tr-siBenchMetric + .tr-siBenchMetric::before{content:"";position:absolute;left:0;top:12px;bottom:12px;width:1px;background:linear-gradient(180deg,transparent,rgba(135,215,241,.17),transparent)}
        .tr-siBenchIcon{height:70px;display:grid;place-items:center;min-width:0}
        .tr-siBenchClock .tr-siVisualChrono{width:67px;height:67px;object-fit:contain}
        .tr-siBenchDumbbell img{width:76px;max-height:58px;object-fit:contain;filter:drop-shadow(0 9px 12px rgba(0,0,0,.42)) drop-shadow(0 0 8px rgba(255,145,34,.16))}
        .tr-siVolumeMark{width:62px;height:62px;display:block;filter:drop-shadow(0 7px 10px rgba(0,0,0,.35)) drop-shadow(0 0 8px rgba(45,185,255,.16))}
        .tr-siBenchCopy{min-width:0;display:grid;gap:5px}
        .tr-siBenchCopy strong{color:#f9fcff;font-size:clamp(24px,2.5vw,34px);line-height:.95;font-weight:1100;letter-spacing:-.04em;font-variant-numeric:tabular-nums;white-space:nowrap}
        .tr-siPerfDelta{grid-area:delta;min-width:0;padding-top:5px;padding-right:16px;color:rgba(191,211,221,.62);font-size:6.7px;font-weight:1000;letter-spacing:.075em;line-height:1.2;text-transform:uppercase;white-space:normal;overflow-wrap:anywhere}
        .tr-siPerfDelta.is-positive{color:#70f4a1}.tr-siPerfDelta.is-negative{color:#ff9b65}

        /* Bottom: one precision rail, not a stack of bars. */
        .tr-siWeekStrip{min-height:58px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:18px;padding:8px 20px 9px;background:linear-gradient(180deg,rgba(255,255,255,.011),rgba(0,0,0,.14))}
        .tr-siWeekStat{display:grid;gap:2px;min-width:0}.tr-siWeekStat.is-right{text-align:right;justify-items:end}
        .tr-siWeekStat strong{color:#f8fcff;font-size:23px;line-height:.94;font-weight:1100;font-variant-numeric:tabular-nums;white-space:nowrap}
        .tr-siWeekRail{position:relative;height:18px;min-width:90px;display:flex;align-items:center;justify-content:space-between;padding:0 6px}
        .tr-siWeekTrack,.tr-siWeekFill{position:absolute;left:6px;right:6px;top:50%;height:3px;border-radius:99px;transform:translateY(-50%)}
        .tr-siWeekTrack{background:linear-gradient(90deg,rgba(66,111,128,.16),rgba(122,164,179,.22),rgba(93,118,129,.13));box-shadow:inset 0 1px 1px rgba(0,0,0,.65)}
        .tr-siWeekFill{right:auto;background:linear-gradient(90deg,#36d8ff,#1f97ff,#58ffc5);box-shadow:0 0 12px rgba(45,207,255,.42),0 0 28px rgba(45,207,255,.12);transition:width .35s ease}
        .tr-siWeekRail i{position:relative;z-index:2;width:6px;height:6px;border-radius:50%;background:#273943;border:1px solid rgba(133,183,199,.18);box-shadow:0 0 0 3px rgba(1,7,10,.52)}
        .tr-siWeekRail i.is-start{background:#72f2ff;border-color:#b6fbff;box-shadow:0 0 11px rgba(57,218,255,.78),0 0 0 3px rgba(1,7,10,.55)}
        .tr-siWeekRail i.is-end{border-color:rgba(255,163,56,.32)}

        /* Minimized: same mockup language, same assets, one precision strip. */
        .tr-siCompact{
          min-width:0;min-height:67px;display:grid;grid-template-columns:1.02fr .92fr 1.13fr 1.75fr;align-items:center;
          padding:3px 14px 5px;background:
            radial-gradient(420px 90px at 8% 0,rgba(32,198,255,.075),transparent 67%),
            radial-gradient(420px 90px at 98% 100%,rgba(255,141,39,.07),transparent 68%),
            linear-gradient(180deg,rgba(5,17,24,.78),rgba(2,8,12,.93));
          box-shadow:inset 0 -1px 0 rgba(255,148,42,.18)
        }
        .tr-siCompactMetric{position:relative;min-width:0;display:grid;align-items:center;gap:7px;padding:4px 12px}
        .tr-siCompactMetric:not(.is-performance){grid-template-columns:42px minmax(0,1fr)}
        .tr-siCompactMetric + .tr-siCompactMetric::before{content:"";position:absolute;left:0;top:10px;bottom:10px;width:1px;background:linear-gradient(180deg,transparent,rgba(126,207,235,.15),transparent)}
        .tr-siCompactVisual{height:50px;display:grid;place-items:center;min-width:0;overflow:hidden}
        .tr-siCompactVisual.is-body .tr-siVisualBody{height:54px;width:50px;object-fit:contain;object-position:center center;border-radius:0;filter:saturate(1.08) contrast(1.04) drop-shadow(0 0 8px rgba(28,153,255,.31))}
        .tr-siCompactVisual.is-shaker .tr-siVisualProtein{height:48px;max-width:35px}
        .tr-siCompactVisual.is-chrono .tr-siVisualChrono{height:47px;max-width:47px}
        .tr-siCompactCopy{min-width:0;display:grid;gap:3px}
        .tr-siCompactCopy strong{color:#f8fcff;font-size:16px;line-height:.96;font-weight:1080;letter-spacing:-.025em;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .tr-siCompactMetric.is-last .tr-siCompactCopy strong{color:#ffbd5f}
        .tr-siCompactCopy>span{font-size:6px;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .tr-siCompactMetric.is-performance{grid-template-columns:1fr;gap:5px}
        .tr-siCompactPerformance{display:flex;align-items:center;gap:7px;min-width:0;white-space:nowrap;overflow:hidden}
        .tr-siCompactPerformance>span{min-width:0;display:flex;align-items:center;gap:5px}
        .tr-siCompactPerfCopy{min-width:0;display:grid;gap:1px}
        .tr-siCompactPerfCopy small{display:none;color:rgba(174,207,221,.68);font-size:5px;font-weight:950;letter-spacing:.08em;line-height:1;text-transform:uppercase;white-space:nowrap}
        .tr-siCompactPerformance strong{font-size:12px;color:#f7fbfd;font-weight:1050;font-variant-numeric:tabular-nums}
        .tr-siCompactPerformance em{font-style:normal;color:#43dfff;font-size:9px}
        .tr-siCompactPerformance b{display:grid;place-items:center;width:23px;height:23px;flex:0 0 23px}
        .tr-siMiniClock .tr-siVisualChrono{width:23px;height:23px;object-fit:contain}
        .tr-siMiniDumbbell img{width:27px;max-height:21px;object-fit:contain;filter:drop-shadow(0 3px 5px rgba(0,0,0,.38)) drop-shadow(0 0 5px rgba(255,146,36,.14))}
        .tr-siMiniVolume .tr-siVolumeMark{width:23px;height:23px}

        @media (max-width:900px){
          .tr-siPrimaryRow{min-height:214px}
          .tr-siFeature{grid-template-columns:minmax(78px,.78fr) minmax(0,1fr);gap:10px;padding:14px}
          .tr-siFeatureVisual{height:178px}.tr-siFeatureVisual.is-body{height:186px}.tr-siFeatureVisual.is-shaker .tr-siVisualProtein{height:172px;max-width:126px}.tr-siFeatureVisual.is-chrono .tr-siVisualChrono{height:146px;max-width:146px}
          .tr-siFeatureCopy strong{font-size:30px}
          .tr-siBenchMetric{grid-template-columns:60px minmax(0,1fr);gap:9px;padding:5px 10px}.tr-siBenchIcon{height:60px}.tr-siBenchClock .tr-siVisualChrono{width:57px;height:57px}.tr-siBenchDumbbell img{width:61px}.tr-siVolumeMark{width:53px;height:53px}
        }

        @media (max-width:720px){
          .tr-siShell .tr-card-head{min-height:45px}
          .tr-siShell.is-compact .tr-card-head{min-height:37px}
          .tr-siHeaderRight{gap:6px}.tr-siHeaderRight .tr-checkinContext{max-width:47vw;font-size:7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
          .tr-siToggle{width:24px;height:24px}.tr-siToggle span{width:9px;height:9px;border-right-width:2px;border-bottom-width:2px}

          /* Mobile expanded: three image/text rows on ONE surface, thin etched separators only. */
          .tr-siPrimaryRow{grid-template-columns:1fr;min-height:0}
          .tr-siFeature{grid-template-columns:108px minmax(0,1fr);min-height:116px;gap:12px;padding:8px 14px}
          .tr-siFeature + .tr-siFeature::before{left:14px;right:14px;top:0;bottom:auto;width:auto;height:1px;background:linear-gradient(90deg,transparent,rgba(109,210,242,.17),transparent)}
          .tr-siFeature::after{display:none}
          .tr-siFeatureVisual,.tr-siFeatureVisual.is-body{height:106px;align-self:center}
          .tr-siFeatureVisual.is-body .tr-siVisualBody{height:108px;width:98px;object-fit:contain;object-position:center center;border-radius:0}
          .tr-siFeatureVisual.is-shaker .tr-siVisualProtein{height:106px;max-width:74px}
          .tr-siFeatureVisual.is-chrono .tr-siVisualChrono{height:96px;max-width:96px}
          .tr-siFeatureCopy{gap:4px}.tr-siFeatureCopy>span{font-size:7px}.tr-siFeatureCopy strong{font-size:31px}.tr-siFeature.is-last .tr-siFeatureCopy strong{font-size:29px}.tr-siFeatureCopy small{font-size:6.5px!important}

          .tr-siBenchmark{grid-template-columns:1fr;grid-template-areas:"title" "metrics" "delta";min-height:0;padding:10px 12px 9px}
          .tr-siBenchmarkTitle{padding-right:0;margin-bottom:6px}.tr-siBenchmarkTitle>span{font-size:6.4px}.tr-siBenchmarkTitle strong{font-size:9.5px}.tr-siBenchmarkMetrics{min-height:80px}
          .tr-siBenchMetric{grid-template-columns:1fr;justify-items:center;text-align:center;gap:3px;padding:4px 7px}.tr-siBenchMetric + .tr-siBenchMetric::before{top:8px;bottom:8px}
          .tr-siBenchIcon{height:43px}.tr-siBenchClock .tr-siVisualChrono{width:43px;height:43px}.tr-siBenchDumbbell img{width:50px;max-height:38px}.tr-siBenchVolume .tr-siVolumeMark{width:42px;height:42px}
          .tr-siBenchCopy{justify-items:center;gap:3px}.tr-siBenchCopy strong{font-size:20px}.tr-siBenchCopy>span{font-size:6px}
          .tr-siPerfDelta{padding:4px 0 0;text-align:left;font-size:5.7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

          .tr-siWeekStrip{min-height:51px;gap:8px;padding:7px 12px}.tr-siWeekStat strong{font-size:18px}.tr-siWeekStat>span,.tr-siWeekStat>small{font-size:5.7px}.tr-siWeekRail{gap:0;padding:0 4px}.tr-siWeekTrack,.tr-siWeekFill{left:4px;right:4px}.tr-siWeekRail i{width:5px;height:5px}

          /* Mobile minimized: compact but all four zones remain visible. */
          .tr-siCompact{min-height:82px;grid-template-columns:.58fr .54fr .80fr 2.08fr;padding:3px 3px 6px}
          .tr-siCompactMetric{gap:2px;padding:4px 2px}.tr-siCompactMetric:not(.is-performance){grid-template-columns:19px minmax(0,1fr)}
          .tr-siCompactVisual{height:32px}.tr-siCompactVisual.is-body .tr-siVisualBody{width:20px;height:32px;object-fit:contain;object-position:center center}.tr-siCompactVisual.is-shaker .tr-siVisualProtein{height:27px;max-width:18px}.tr-siCompactVisual.is-chrono .tr-siVisualChrono{height:25px;max-width:25px;object-fit:contain}
          .tr-siCompactCopy{gap:2px}.tr-siCompactCopy>small,.tr-siCompactMetric.is-performance>small{font-size:4.2px;letter-spacing:.04em;line-height:1.06;white-space:normal;overflow:visible;text-overflow:clip}.tr-siCompactCopy strong{font-size:9px;line-height:.98;white-space:nowrap;overflow:visible;text-overflow:clip}.tr-siCompactMetric.is-last .tr-siCompactCopy strong{font-size:7.75px;letter-spacing:-.04em}.tr-siCompactCopy>span{font-size:3.9px;letter-spacing:.01em;line-height:1.06;white-space:normal;overflow:visible;text-overflow:clip}
          .tr-siCompactMetric.is-performance{gap:3px;padding-left:4px;padding-right:1px}.tr-siCompactPerformance{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0;overflow:visible;align-items:stretch}.tr-siCompactPerformance>em{display:none}.tr-siCompactPerformance>span{display:grid;grid-template-columns:15px minmax(0,1fr);align-items:center;gap:2px;min-width:0;padding:0 4px}.tr-siCompactPerformance>span + span{border-left:1px solid rgba(111,205,235,.18)}.tr-siCompactPerfCopy{gap:2px;align-content:center}.tr-siCompactPerfCopy small{display:block;font-size:3.65px;letter-spacing:.035em;line-height:1.02;white-space:normal}.tr-siCompactPerformance strong{font-size:7.3px;line-height:1;letter-spacing:-.03em;white-space:nowrap}.tr-siCompactPerformance b{width:15px;height:15px;min-width:15px;overflow:visible}.tr-siMiniClock .tr-siVisualChrono{display:block;width:15px;height:15px;max-width:none;object-fit:contain;object-position:center}.tr-siMiniDumbbell img{display:block;width:16px;max-width:none;max-height:13px;object-fit:contain}.tr-siMiniVolume .tr-siVolumeMark{width:15px;height:15px}
        }

        @media (max-width:420px){
          .tr-siHeaderRight .tr-checkinContext{max-width:40vw}
          .tr-siFeature{grid-template-columns:95px minmax(0,1fr);min-height:108px;padding:7px 10px;gap:9px}.tr-siFeatureVisual,.tr-siFeatureVisual.is-body{height:98px}.tr-siFeatureVisual.is-body .tr-siVisualBody{height:100px;width:90px}.tr-siFeatureVisual.is-shaker .tr-siVisualProtein{height:98px;max-width:67px}.tr-siFeatureVisual.is-chrono .tr-siVisualChrono{height:89px;max-width:89px}.tr-siFeatureCopy strong{font-size:28px}.tr-siFeature.is-last .tr-siFeatureCopy strong{font-size:26px}
          .tr-siCompact{min-height:84px;grid-template-columns:.56fr .52fr .78fr 2.14fr;padding-left:2px;padding-right:2px}.tr-siCompactMetric{padding-left:1px;padding-right:1px}.tr-siCompactMetric:not(.is-performance){grid-template-columns:18px minmax(0,1fr)}.tr-siCompactVisual.is-body .tr-siVisualBody{width:19px;height:30px}.tr-siCompactVisual.is-shaker .tr-siVisualProtein{height:25px;max-width:17px}.tr-siCompactVisual.is-chrono .tr-siVisualChrono{height:23px;max-width:23px}.tr-siCompactCopy strong{font-size:8.55px;overflow:visible;text-overflow:clip}.tr-siCompactMetric.is-last .tr-siCompactCopy strong{font-size:7.35px}.tr-siCompactPerformance>span{grid-template-columns:14px minmax(0,1fr);padding-left:3px;padding-right:3px}.tr-siCompactPerformance strong{font-size:6.7px}.tr-siCompactPerfCopy small{font-size:3.35px}.tr-siCompactPerformance b{width:14px;height:14px;min-width:14px}.tr-siMiniClock .tr-siVisualChrono{width:14px;height:14px}.tr-siMiniDumbbell img{width:15px;max-height:12px}.tr-siMiniVolume .tr-siVolumeMark{width:14px;height:14px}
        }

        @media (max-width:365px){
          .tr-siCompact{min-height:86px;grid-template-columns:.54fr .50fr .76fr 2.20fr;padding-left:1px;padding-right:1px}.tr-siCompactMetric:not(.is-performance){grid-template-columns:16px minmax(0,1fr)}.tr-siCompactVisual.is-body .tr-siVisualBody{width:17px;height:28px}.tr-siCompactVisual.is-shaker .tr-siVisualProtein{height:23px;max-width:16px}.tr-siCompactVisual.is-chrono .tr-siVisualChrono{height:21px;max-width:21px}.tr-siCompactCopy strong{font-size:7.95px;overflow:visible;text-overflow:clip}.tr-siCompactMetric.is-last .tr-siCompactCopy strong{font-size:6.85px;letter-spacing:-.045em}.tr-siCompactCopy>small,.tr-siCompactMetric.is-performance>small{font-size:3.65px;letter-spacing:.02em}.tr-siCompactCopy>span{font-size:3.5px;line-height:1.04}.tr-siCompactPerformance>span{grid-template-columns:13px minmax(0,1fr);padding-left:2px;padding-right:2px}.tr-siCompactPerformance strong{font-size:6.2px}.tr-siCompactPerfCopy small{font-size:3.05px;letter-spacing:.02em}.tr-siCompactPerformance b{width:13px;height:13px;min-width:13px}.tr-siMiniClock .tr-siVisualChrono{width:13px;height:13px}.tr-siMiniDumbbell img{width:14px;max-height:11px}.tr-siMiniVolume .tr-siVolumeMark{width:13px;height:13px}
        }



        /* ============================================================
           R12.5E — FLAGSHIP WORKOUT ROADMAP + SMART MUSCLE VISUALS
           Premium one-surface rendering, intelligent independent exercise
           states, clickable precision rail, and global muscle artwork.
           ============================================================ */
        .tr-roadmapV2{
          position:relative;
          isolation:isolate;
          overflow:hidden;
          padding:17px 18px 18px;
          border:1px solid rgba(74,190,232,.30);
          border-radius:21px;
          background:
            radial-gradient(780px 310px at 16% -24%,rgba(0,196,255,.145),transparent 66%),
            radial-gradient(520px 250px at 92% 112%,rgba(255,154,48,.075),transparent 68%),
            linear-gradient(132deg,rgba(11,27,38,.985),rgba(4,13,20,.995) 48%,rgba(2,8,13,.999));
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.075),
            inset 0 -1px 0 rgba(255,156,53,.045),
            inset 0 0 54px rgba(0,115,166,.035),
            0 18px 48px rgba(0,0,0,.28),
            0 0 30px rgba(0,163,225,.045);
        }
        .tr-roadmapV2::before{
          content:"";position:absolute;z-index:-2;inset:0;pointer-events:none;
          background:
            linear-gradient(110deg,transparent 0 27%,rgba(134,235,255,.045) 39%,transparent 52%),
            repeating-linear-gradient(90deg,rgba(255,255,255,.008) 0 1px,transparent 1px 9px);
          opacity:.78;
          animation:tr-roadmapV2-surface 9s ease-in-out infinite;
        }
        .tr-roadmapV2::after{
          content:"";position:absolute;z-index:-1;inset:1px;pointer-events:none;border-radius:20px;
          background:linear-gradient(180deg,rgba(255,255,255,.025),transparent 18%,transparent 82%,rgba(0,0,0,.18));
          box-shadow:inset 16px 0 30px rgba(0,0,0,.10),inset -16px 0 30px rgba(0,0,0,.16);
        }
        .tr-roadmapV2Header{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:7px;min-width:0}
        .tr-roadmapV2Title{display:grid;gap:4px;min-width:0}
        .tr-roadmapV2Title>span{color:rgba(181,211,225,.67);font-size:7.5px;font-weight:1000;letter-spacing:.18em;text-transform:uppercase}
        .tr-roadmapV2TitleLine{display:flex;align-items:center;gap:9px;min-width:0}
        .tr-roadmapV2TitleLine>strong{color:#f7fbfe;font-size:15.5px;font-weight:1050;letter-spacing:.015em;text-transform:uppercase;white-space:nowrap;text-shadow:0 2px 8px rgba(0,0,0,.38)}
        .tr-roadmapV2Edit{
          appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:5px;height:27px;min-width:58px;padding:0 8px;border-radius:8px;
          border:1px solid rgba(68,202,248,.29);background:linear-gradient(180deg,rgba(21,48,63,.80),rgba(5,18,27,.96));color:#bfeeff;cursor:pointer;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.065),0 5px 14px rgba(0,0,0,.24),0 0 13px rgba(36,192,242,.055);
          transition:border-color .18s ease,box-shadow .18s ease,transform .18s ease,background .18s ease;
        }
        .tr-roadmapV2Edit svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;filter:drop-shadow(0 0 5px rgba(89,219,255,.26))}
        .tr-roadmapV2Edit span{font-size:7px;font-weight:1000;letter-spacing:.14em}
        .tr-roadmapV2Edit:hover,.tr-roadmapV2Edit:focus-visible{outline:none;border-color:rgba(103,225,255,.64);background:linear-gradient(180deg,rgba(26,65,84,.88),rgba(5,22,32,.97));box-shadow:inset 0 1px 0 rgba(255,255,255,.10),0 6px 16px rgba(0,0,0,.27),0 0 18px rgba(45,203,250,.12);transform:translateY(-1px)}
        .tr-roadmapV2Count{display:grid;grid-template-columns:auto auto;grid-template-areas:"done total" "label label";align-items:end;justify-items:end;column-gap:4px;line-height:.8;min-width:88px;flex:0 0 auto}
        .tr-roadmapV2Count>strong{grid-area:done;color:hsl(calc(190 - (var(--tr-roadmap-progress) * 46)) 92% 61%);font-size:41px;line-height:.78;font-weight:1100;letter-spacing:-.07em;text-shadow:0 0 20px rgba(44,214,255,.25),0 3px 10px rgba(0,0,0,.5)}
        .tr-roadmapV2Count>b{grid-area:total;color:rgba(244,249,252,.94);font-size:23px;line-height:.9;font-weight:1050;padding-bottom:2px}
        .tr-roadmapV2Count>small{grid-area:label;color:rgba(192,210,219,.58);font-size:6.6px;font-weight:1000;letter-spacing:.17em;margin-top:4px}

        .tr-roadmapV2Rail{position:relative;height:58px;margin:0 3px 12px;overflow:visible}
        .tr-roadmapV2RailBed{position:absolute;left:4%;right:4%;top:22px;height:8px;transform:translateY(-50%);border-radius:99px;background:linear-gradient(180deg,rgba(0,0,0,.72),rgba(24,55,68,.22) 46%,rgba(102,165,190,.12) 49%,rgba(0,0,0,.66));box-shadow:inset 0 2px 3px rgba(0,0,0,.78),inset 0 -1px 0 rgba(111,184,211,.08),0 1px 0 rgba(255,255,255,.025)}
        .tr-roadmapV2Segment{position:absolute;z-index:1;top:22px;height:3px;transform:translateY(-50%);background:rgba(84,130,149,.16);box-shadow:0 0 5px rgba(0,0,0,.36);transition:background .28s ease,box-shadow .28s ease,filter .28s ease}
        .tr-roadmapV2Segment.is-done{background:linear-gradient(90deg,rgba(55,221,148,.62),rgba(89,235,176,.82));box-shadow:0 0 10px rgba(67,226,160,.22)}
        .tr-roadmapV2Segment.is-current{background:linear-gradient(90deg,rgba(47,187,235,.32),rgba(96,231,255,.78),rgba(47,187,235,.34));box-shadow:0 0 11px rgba(61,213,255,.28)}
        .tr-roadmapV2Segment.is-next{background:linear-gradient(90deg,rgba(137,125,96,.20),rgba(235,191,116,.55),rgba(137,125,96,.20));box-shadow:0 0 9px rgba(231,185,106,.14)}
        .tr-roadmapV2Node{appearance:none;position:absolute;z-index:3;top:22px;width:32px;height:44px;padding:0;transform:translate(-50%,-16px);border:0;background:transparent;color:inherit;cursor:pointer;overflow:visible;display:grid;justify-items:center;align-content:start;gap:4px}
        .tr-roadmapV2NodeFace{position:relative;width:31px;height:31px;display:grid;place-items:center;border-radius:50%;border:1px solid rgba(124,176,197,.28);background:radial-gradient(circle at 50% 35%,rgba(35,69,82,.86),rgba(5,15,21,.98) 70%);box-shadow:0 0 0 4px rgba(2,9,14,.88),inset 0 1px 1px rgba(255,255,255,.075),inset 0 -3px 8px rgba(0,0,0,.48),0 5px 11px rgba(0,0,0,.42);transition:transform .18s ease,border-color .18s ease,box-shadow .22s ease,background .22s ease}
        .tr-roadmapV2NodeFace::after{content:"";position:absolute;inset:3px;border-radius:50%;border:1px solid rgba(255,255,255,.025);pointer-events:none}
        .tr-roadmapV2Node b{font-size:8px;line-height:1;font-weight:1100;letter-spacing:.02em;color:rgba(190,216,227,.62);font-variant-numeric:tabular-nums}
        .tr-roadmapV2Node small{font-size:5.4px;line-height:1;font-weight:1000;letter-spacing:.11em;color:rgba(160,190,202,.48);text-shadow:0 1px 4px rgba(0,0,0,.7);white-space:nowrap}
        .tr-roadmapV2Node:hover .tr-roadmapV2NodeFace,.tr-roadmapV2Node:focus-visible .tr-roadmapV2NodeFace{transform:translateY(-1px) scale(1.04);border-color:rgba(112,220,255,.52);box-shadow:0 0 0 4px rgba(2,9,14,.90),0 0 14px rgba(63,211,255,.16),0 6px 14px rgba(0,0,0,.45)}
        .tr-roadmapV2Node:focus-visible{outline:none}
        .tr-roadmapV2Node.is-done .tr-roadmapV2NodeFace{border-color:rgba(102,242,180,.74);background:radial-gradient(circle at 48% 36%,#92f5c5,#32c989 58%,#0d6748 100%);box-shadow:0 0 0 4px rgba(2,12,13,.88),inset 0 1px 1px rgba(255,255,255,.28),inset 0 -5px 9px rgba(0,67,42,.34),0 0 17px rgba(65,228,157,.30),0 6px 13px rgba(0,0,0,.43)}
        .tr-roadmapV2Node.is-done b{font-size:15px;color:#edfff7;text-shadow:0 1px 3px rgba(0,62,40,.75)}
        .tr-roadmapV2Node.is-done small{color:#78e7ae}
        .tr-roadmapV2Node.is-next .tr-roadmapV2NodeFace{border-color:rgba(255,216,150,.78);background:radial-gradient(circle at 50% 34%,#f8dcaa,#ce9b4f 54%,#61421e 100%);box-shadow:0 0 0 4px rgba(11,10,8,.88),inset 0 1px 1px rgba(255,255,255,.22),inset 0 -5px 9px rgba(79,48,13,.32),0 0 16px rgba(239,191,111,.27),0 6px 13px rgba(0,0,0,.43)}
        .tr-roadmapV2Node.is-next b{color:#16120c;font-size:8.5px;text-shadow:0 1px 0 rgba(255,255,255,.25)}
        .tr-roadmapV2Node.is-next small{color:#ebc787}
        .tr-roadmapV2Node.is-current .tr-roadmapV2NodeFace{width:35px;height:35px;border-color:#a6f3ff;background:radial-gradient(circle at 50% 32%,#f0feff 0 11%,#76eaff 24%,#18bee9 56%,#075f82 100%);box-shadow:0 0 0 4px rgba(6,24,34,.92),0 0 0 7px rgba(41,205,250,.09),inset 0 1px 2px rgba(255,255,255,.58),inset 0 -7px 10px rgba(0,78,111,.42),0 0 21px rgba(62,220,255,.60),0 7px 16px rgba(0,0,0,.48);animation:tr-roadmapV2-node 2.7s ease-in-out infinite}
        .tr-roadmapV2Node.is-current b{font-size:9px;color:#062231;text-shadow:0 1px 0 rgba(255,255,255,.35)}
        .tr-roadmapV2Node.is-current.is-done b{font-size:16px;color:#efffff}
        .tr-roadmapV2Node.is-current small{color:#8beeff;text-shadow:0 0 8px rgba(71,219,255,.38)}

        .tr-roadmapV2Body{display:grid;grid-template-columns:minmax(286px,.38fr) minmax(0,.62fr);gap:16px;align-items:stretch}
        .tr-roadmapV2Current{
          position:relative;overflow:hidden;min-height:230px;display:grid;grid-template-columns:minmax(126px,.45fr) minmax(0,.55fr);align-items:center;gap:13px;padding:17px 17px;
          border:1px solid rgba(58,211,255,.50);border-radius:18px;
          background:
            radial-gradient(360px 240px at 18% 49%,rgba(0,196,255,.145),transparent 68%),
            radial-gradient(220px 150px at 74% 112%,rgba(19,101,138,.08),transparent 70%),
            linear-gradient(145deg,rgba(7,30,43,.975),rgba(2,11,17,.998) 68%);
          box-shadow:inset 0 1px 0 rgba(255,255,255,.095),inset 0 -1px 0 rgba(33,145,185,.08),inset 0 0 44px rgba(0,173,235,.035),0 16px 34px rgba(0,0,0,.28),0 0 29px rgba(0,184,240,.09);
        }
        .tr-roadmapV2Current::before{content:"";position:absolute;left:14px;right:14px;top:0;height:2px;background:linear-gradient(90deg,transparent,#31d3ff 18%,#b8f7ff 50%,#31d3ff 82%,transparent);box-shadow:0 0 18px rgba(54,213,255,.42)}
        .tr-roadmapV2Current::after{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(210px 120px at 24% 90%,rgba(49,215,255,.055),transparent 70%);box-shadow:inset 18px 0 28px rgba(0,0,0,.04),inset -14px 0 25px rgba(0,0,0,.18)}
        .tr-roadmapV2CurrentFx{position:absolute;z-index:3;inset:0;pointer-events:none;background:linear-gradient(112deg,transparent 7%,rgba(147,240,255,.055) 43%,transparent 61%);transform:translateX(-42%);animation:tr-roadmapV2-current-sheen 5.8s ease-in-out infinite}
        .tr-roadmapV2Current.is-complete{border-color:rgba(87,230,160,.46);background:radial-gradient(340px 240px at 18% 49%,rgba(57,222,150,.10),transparent 70%),linear-gradient(145deg,rgba(6,30,29,.98),rgba(2,11,14,.998) 68%)}
        .tr-roadmapV2CurrentVisual{position:relative;z-index:2;height:190px;min-width:0;display:grid;place-items:center;border-radius:16px;background:radial-gradient(circle at 50% 50%,rgba(46,207,255,.12),rgba(8,35,47,.025) 52%,transparent 70%);filter:drop-shadow(0 15px 20px rgba(0,0,0,.35))}
        .tr-roadmapV2CurrentVisual::before{content:"";position:absolute;width:74%;height:74%;border-radius:50%;background:radial-gradient(circle,rgba(57,215,255,.11),transparent 68%);filter:blur(10px);opacity:.8}
        .tr-roadmapV2CurrentVisual::after{content:"";position:absolute;left:8%;right:8%;bottom:4px;height:2px;background:linear-gradient(90deg,transparent,rgba(66,224,255,.78),transparent);box-shadow:0 0 15px rgba(56,213,255,.36)}
        .tr-roadmapV2VisualHalo{position:absolute;width:70%;aspect-ratio:1;border-radius:50%;border:1px solid rgba(82,220,255,.065);box-shadow:0 0 25px rgba(41,202,246,.055),inset 0 0 20px rgba(41,202,246,.035)}
        .tr-roadmapV2CurrentVisual img{position:relative;z-index:2;width:100%;height:100%;max-width:188px;max-height:188px;object-fit:contain;object-position:center;filter:drop-shadow(0 8px 10px rgba(0,0,0,.45)) drop-shadow(0 0 11px rgba(42,198,255,.10))}
        .tr-roadmapV2CurrentCopy{position:relative;z-index:4;display:grid;align-content:center;gap:7px;min-width:0}
        .tr-roadmapV2CurrentIndex{color:#8eeaff;font-size:23px;font-weight:1050;line-height:.92;letter-spacing:-.035em;font-variant-numeric:tabular-nums;text-shadow:0 0 14px rgba(61,214,255,.19)}
        .tr-roadmapV2CurrentIndex small{color:rgba(183,211,223,.47);font-size:11px;font-weight:900;letter-spacing:.05em}
        .tr-roadmapV2CurrentCopy>strong{color:#fbfdff;font-size:clamp(22px,2.35vw,33px);line-height:1.02;font-weight:1100;letter-spacing:-.042em;text-shadow:0 3px 0 rgba(0,0,0,.58),0 0 18px rgba(133,231,255,.035);overflow-wrap:anywhere}
        .tr-roadmapV2MuscleLabel{color:rgba(181,218,232,.68);font-size:7px;line-height:1;font-weight:950;letter-spacing:.12em;text-transform:uppercase}
        .tr-roadmapV2CurrentState{width:max-content;max-width:100%;color:#78e6ff;font-size:6.7px;font-weight:1000;letter-spacing:.16em;text-transform:uppercase}.tr-roadmapV2CurrentState.is-complete{color:#72e9a8}

        .tr-roadmapV2Agenda{min-width:0;align-self:stretch;display:grid;align-content:start;gap:7px;padding:0 1px 0 7px}
        .tr-roadmapV2Group{min-width:0;display:grid;gap:1px}
        .tr-roadmapV2GroupHead{min-height:19px;display:flex;align-items:center;justify-content:space-between;padding:0 8px;border-bottom:1px solid rgba(106,178,208,.09)}
        .tr-roadmapV2GroupHead>span{color:rgba(174,207,221,.62);font-size:6.4px;font-weight:1000;letter-spacing:.19em;text-transform:uppercase}
        .tr-roadmapV2GroupHead>small{color:rgba(158,190,204,.42);font-size:6px;font-weight:1000}
        .tr-roadmapV2Group.is-next .tr-roadmapV2GroupHead>span{color:#e8c991;text-shadow:0 0 11px rgba(231,192,126,.12)}.tr-roadmapV2Group.is-done .tr-roadmapV2GroupHead>span{color:#75e0aa}
        .tr-roadmapV2AgendaRow{position:relative;appearance:none;width:100%;min-width:0;min-height:51px;display:grid;grid-template-columns:54px minmax(0,1fr) 17px;align-items:center;gap:10px;padding:4px 8px;border:0;border-bottom:1px solid rgba(108,170,198,.075);background:linear-gradient(90deg,rgba(24,61,76,.012),transparent 75%);color:inherit;text-align:left;cursor:pointer;transition:background .18s ease,transform .18s ease,box-shadow .18s ease}
        .tr-roadmapV2AgendaRow::before{content:"";position:absolute;left:0;top:9px;bottom:9px;width:2px;border-radius:99px;background:transparent;transition:background .18s ease,box-shadow .18s ease}
        .tr-roadmapV2AgendaRow:hover,.tr-roadmapV2AgendaRow:focus-visible{background:linear-gradient(90deg,rgba(38,188,239,.065),rgba(20,64,83,.025) 68%,transparent);transform:translateX(2px);box-shadow:inset 0 1px 0 rgba(255,255,255,.015);outline:none}
        .tr-roadmapV2AgendaRow.is-next::before{background:#e1bb78;box-shadow:0 0 12px rgba(231,191,120,.28)}
        .tr-roadmapV2AgendaRow.is-done::before{background:#50dc9a;box-shadow:0 0 12px rgba(74,220,151,.20)}
        .tr-roadmapV2AgendaVisual{position:relative;width:52px;height:46px;display:grid;place-items:center;border-radius:10px;background:radial-gradient(circle at 50% 50%,rgba(67,195,240,.085),transparent 68%);filter:drop-shadow(0 7px 8px rgba(0,0,0,.27))}
        .tr-roadmapV2AgendaVisual img{position:relative;z-index:2;width:100%;height:100%;max-width:50px;max-height:45px;object-fit:contain;filter:drop-shadow(0 5px 8px rgba(0,0,0,.35))}
        .tr-roadmapV2AgendaVisual>em{position:absolute;z-index:3;right:-1px;bottom:1px;width:14px;height:14px;display:grid;place-items:center;border-radius:50%;background:#30c887;border:1px solid rgba(170,255,215,.66);box-shadow:0 0 9px rgba(59,219,148,.33);color:white;font-style:normal;font-size:8px;font-weight:1100}
        .tr-roadmapV2AgendaRow.is-next .tr-roadmapV2AgendaVisual{background:radial-gradient(circle at 50% 50%,rgba(232,193,125,.13),transparent 69%)}
        .tr-roadmapV2AgendaRow.is-done .tr-roadmapV2AgendaVisual{opacity:.86;filter:saturate(.88) drop-shadow(0 6px 8px rgba(0,0,0,.25))}
        .tr-roadmapV2AgendaCopy{display:grid;gap:3px;min-width:0;align-content:center}
        .tr-roadmapV2AgendaCopy>strong{color:rgba(249,252,254,.97);font-size:13.4px;line-height:1.1;font-weight:980;letter-spacing:-.018em;white-space:normal;overflow-wrap:anywhere;text-shadow:0 2px 5px rgba(0,0,0,.42)}
        .tr-roadmapV2AgendaCopy>small{color:rgba(159,194,208,.50);font-size:5.7px;line-height:1.05;font-weight:1000;letter-spacing:.12em;text-transform:uppercase;white-space:normal;overflow-wrap:anywhere}
        .tr-roadmapV2AgendaRow.is-next .tr-roadmapV2AgendaCopy>small{color:#e8c991}.tr-roadmapV2AgendaRow.is-done .tr-roadmapV2AgendaCopy>small{color:#71dfa6}
        .tr-roadmapV2AgendaArrow{color:rgba(168,211,228,.46);font-size:22px;line-height:1;text-align:center;transition:color .18s ease,transform .18s ease,filter .18s ease}.tr-roadmapV2AgendaRow:hover .tr-roadmapV2AgendaArrow{color:#9beaff;transform:translateX(2px);filter:drop-shadow(0 0 6px rgba(83,219,255,.24))}.tr-roadmapV2AgendaRow.is-next .tr-roadmapV2AgendaArrow{color:#e5c78d}

        @keyframes tr-roadmapV2-surface{0%,100%{transform:translateX(-3%);opacity:.58}50%{transform:translateX(3%);opacity:.94}}
        @keyframes tr-roadmapV2-current-sheen{0%,46%{transform:translateX(-44%);opacity:0}58%{opacity:1}79%,100%{transform:translateX(44%);opacity:0}}
        @keyframes tr-roadmapV2-node{0%,100%{box-shadow:0 0 0 4px rgba(6,24,34,.92),0 0 0 7px rgba(41,205,250,.075),inset 0 1px 2px rgba(255,255,255,.56),inset 0 -7px 10px rgba(0,78,111,.40),0 0 17px rgba(62,220,255,.48),0 7px 16px rgba(0,0,0,.46)}50%{box-shadow:0 0 0 4px rgba(6,24,34,.92),0 0 0 8px rgba(41,205,250,.12),inset 0 1px 2px rgba(255,255,255,.60),inset 0 -7px 10px rgba(0,78,111,.42),0 0 27px rgba(62,220,255,.76),0 7px 16px rgba(0,0,0,.46)}}

        @media (max-width:900px){
          .tr-roadmapV2Body{grid-template-columns:minmax(240px,.40fr) minmax(0,.60fr)}
          .tr-roadmapV2Current{grid-template-columns:112px minmax(0,1fr);min-height:218px;padding:15px 13px;gap:10px}
          .tr-roadmapV2CurrentVisual{height:164px}.tr-roadmapV2CurrentVisual img{max-width:158px;max-height:158px}
          .tr-roadmapV2AgendaRow{grid-template-columns:48px minmax(0,1fr) 15px;gap:8px;padding-left:6px;padding-right:6px}.tr-roadmapV2AgendaVisual{width:46px;height:42px}.tr-roadmapV2AgendaVisual img{max-width:44px;max-height:41px}
        }

        @media (max-width:720px){
          .tr-roadmapV2{padding:12px 11px 13px;border-radius:18px}
          .tr-roadmapV2Header{gap:8px;margin-bottom:4px;align-items:center}.tr-roadmapV2Title{gap:3px}.tr-roadmapV2Title>span{font-size:6.5px}.tr-roadmapV2TitleLine{gap:6px}.tr-roadmapV2TitleLine>strong{font-size:12.8px}.tr-roadmapV2Edit{height:25px;min-width:52px;padding:0 6px;border-radius:7px}.tr-roadmapV2Edit svg{width:10px;height:10px}.tr-roadmapV2Edit span{font-size:6.2px}
          .tr-roadmapV2Count{min-width:70px}.tr-roadmapV2Count>strong{font-size:33px}.tr-roadmapV2Count>b{font-size:19px}.tr-roadmapV2Count>small{font-size:5.3px;letter-spacing:.14em}
          .tr-roadmapV2Rail{height:53px;margin:0 0 8px}.tr-roadmapV2RailBed{top:20px}.tr-roadmapV2Segment{top:20px}.tr-roadmapV2Node{top:20px;width:29px;height:42px;transform:translate(-50%,-15px)}.tr-roadmapV2NodeFace{width:28px;height:28px}.tr-roadmapV2Node.is-current .tr-roadmapV2NodeFace{width:31px;height:31px}.tr-roadmapV2Node b{font-size:7px}.tr-roadmapV2Node.is-current b,.tr-roadmapV2Node.is-next b{font-size:7.5px}.tr-roadmapV2Node.is-done b,.tr-roadmapV2Node.is-current.is-done b{font-size:14px}.tr-roadmapV2Node small{font-size:4.8px}
          .tr-roadmapV2Body{grid-template-columns:1fr;gap:8px}
          .tr-roadmapV2Current{min-height:118px;grid-template-columns:94px minmax(0,1fr);gap:10px;padding:9px 10px;border-radius:16px}
          .tr-roadmapV2CurrentVisual{height:98px;border-radius:12px}.tr-roadmapV2CurrentVisual img{max-width:94px;max-height:94px}.tr-roadmapV2CurrentVisual::after{bottom:1px}
          .tr-roadmapV2CurrentCopy{gap:4px}.tr-roadmapV2CurrentIndex{font-size:18px}.tr-roadmapV2CurrentIndex small{font-size:8.5px}.tr-roadmapV2CurrentCopy>strong{font-size:clamp(19px,6vw,24px);line-height:1.02}.tr-roadmapV2MuscleLabel{font-size:5.7px}.tr-roadmapV2CurrentState{font-size:5.4px}
          .tr-roadmapV2Agenda{gap:5px;padding:0}
          .tr-roadmapV2Group{gap:0}.tr-roadmapV2GroupHead{min-height:18px;padding:0 4px}.tr-roadmapV2GroupHead>span{font-size:5.6px}.tr-roadmapV2GroupHead>small{font-size:5.1px}
          .tr-roadmapV2AgendaRow{min-height:47px;grid-template-columns:46px minmax(0,1fr) 14px;gap:7px;padding:3px 4px}.tr-roadmapV2AgendaVisual{width:44px;height:42px}.tr-roadmapV2AgendaVisual img{max-width:42px;max-height:40px}.tr-roadmapV2AgendaCopy>strong{font-size:11.4px;line-height:1.08}.tr-roadmapV2AgendaCopy>small{font-size:5px;letter-spacing:.095em}.tr-roadmapV2AgendaArrow{font-size:19px}
        }

        @media (max-width:390px){
          .tr-roadmapV2{padding-left:8px;padding-right:8px}.tr-roadmapV2Header{gap:6px}.tr-roadmapV2TitleLine>strong{font-size:11.7px}.tr-roadmapV2Edit{height:24px;min-width:48px;padding:0 5px;gap:4px}.tr-roadmapV2Count{min-width:64px}.tr-roadmapV2Count>strong{font-size:30px}.tr-roadmapV2Count>b{font-size:17px}
          .tr-roadmapV2Rail{height:51px}.tr-roadmapV2Node{width:27px}.tr-roadmapV2NodeFace{width:26px;height:26px}.tr-roadmapV2Node.is-current .tr-roadmapV2NodeFace{width:29px;height:29px}.tr-roadmapV2Node small{font-size:4.5px}
          .tr-roadmapV2Current{grid-template-columns:82px minmax(0,1fr);padding-left:8px;padding-right:8px}.tr-roadmapV2CurrentVisual{height:88px}.tr-roadmapV2CurrentVisual img{max-width:84px;max-height:84px}.tr-roadmapV2CurrentCopy>strong{font-size:19px}
          .tr-roadmapV2AgendaRow{grid-template-columns:42px minmax(0,1fr) 13px;gap:6px}.tr-roadmapV2AgendaVisual{width:40px;height:38px}.tr-roadmapV2AgendaVisual img{max-width:38px;max-height:36px}.tr-roadmapV2AgendaCopy>strong{font-size:10.7px}.tr-roadmapV2AgendaCopy>small{font-size:4.7px}
        }

        @media (max-width:345px){
          .tr-roadmapV2Title>span{font-size:5.8px}.tr-roadmapV2TitleLine{gap:4px}.tr-roadmapV2TitleLine>strong{font-size:10.6px}.tr-roadmapV2Edit{min-width:43px;padding:0 4px}.tr-roadmapV2Edit span{font-size:5.6px}.tr-roadmapV2Edit svg{width:9px;height:9px}.tr-roadmapV2Count{min-width:58px}.tr-roadmapV2Count>strong{font-size:28px}.tr-roadmapV2Count>b{font-size:16px}.tr-roadmapV2Count>small{font-size:4.8px}
          .tr-roadmapV2Current{grid-template-columns:75px minmax(0,1fr);gap:7px}.tr-roadmapV2CurrentVisual{height:81px}.tr-roadmapV2CurrentVisual img{max-width:77px;max-height:77px}.tr-roadmapV2CurrentCopy>strong{font-size:18px}.tr-roadmapV2AgendaRow{grid-template-columns:39px minmax(0,1fr) 12px;gap:5px}.tr-roadmapV2AgendaVisual{width:37px;height:35px}.tr-roadmapV2AgendaVisual img{max-width:35px;max-height:33px}.tr-roadmapV2AgendaCopy>strong{font-size:10px}
        }


        /* ============================================================
           R12.5E.2 — FLAGSHIP ROADMAP RESPONSIVE RENDERING POLISH
           Tightens composition, makes the rail informative at a glance,
           separates DONE confirmation from artwork, and adds materially
           richer depth / lighting without changing workout logic.
           ============================================================ */
        .tr-roadmapV2{
          padding:16px 18px 18px;
          border-color:rgba(77,199,239,.36);
          background:
            radial-gradient(720px 290px at 13% -16%,rgba(0,205,255,.17),transparent 64%),
            radial-gradient(420px 210px at 96% 116%,rgba(255,154,48,.09),transparent 70%),
            linear-gradient(118deg,rgba(255,255,255,.018),transparent 28% 73%,rgba(255,255,255,.012)),
            linear-gradient(137deg,#0a1d29 0%,#05121b 46%,#02080e 100%);
          box-shadow:
            inset 0 1px 0 rgba(214,249,255,.10),
            inset 0 -1px 0 rgba(255,156,53,.055),
            inset 22px 0 42px rgba(0,99,143,.045),
            inset -26px 0 46px rgba(0,0,0,.19),
            0 18px 46px rgba(0,0,0,.34),
            0 0 34px rgba(0,176,234,.065);
        }
        .tr-roadmapV2::before{
          background:
            linear-gradient(111deg,transparent 0 25%,rgba(173,244,255,.055) 39%,transparent 54%),
            linear-gradient(180deg,rgba(255,255,255,.02),transparent 15%),
            repeating-linear-gradient(90deg,rgba(255,255,255,.009) 0 1px,transparent 1px 8px);
        }
        .tr-roadmapV2Header{margin-bottom:4px;gap:14px}
        .tr-roadmapV2Title>span{font-size:8px;color:rgba(190,219,231,.74)}
        .tr-roadmapV2TitleLine{gap:8px}
        .tr-roadmapV2TitleLine>strong{font-size:16px;letter-spacing:.012em}
        .tr-roadmapV2Edit{height:25px;min-width:54px;padding:0 7px;border-radius:7px;border-color:rgba(80,209,250,.35);background:linear-gradient(180deg,rgba(23,54,70,.78),rgba(4,16,24,.98));box-shadow:inset 0 1px 0 rgba(255,255,255,.075),inset 0 -1px 0 rgba(0,0,0,.42),0 5px 13px rgba(0,0,0,.25),0 0 14px rgba(36,192,242,.06)}
        .tr-roadmapV2Edit span{font-size:7.3px}
        .tr-roadmapV2Count{display:grid;grid-template-columns:auto;grid-template-areas:"count" "label";justify-items:center;align-items:center;min-width:76px;line-height:1;gap:3px}
        .tr-roadmapV2Count>strong{grid-area:count;display:inline-flex;align-items:baseline;justify-content:center;gap:0;color:hsl(calc(190 - (var(--tr-roadmap-progress) * 46)) 92% 61%);font-size:28px;line-height:.88;font-weight:1100;letter-spacing:-.055em;font-variant-numeric:tabular-nums;text-shadow:0 0 18px rgba(44,214,255,.22),0 3px 9px rgba(0,0,0,.5)}
        .tr-roadmapV2Count>strong>span{color:rgba(243,249,252,.94);font-size:16px;font-weight:1000;letter-spacing:-.02em;margin-left:2px}
        .tr-roadmapV2Count>b{display:none}
        .tr-roadmapV2Count>small{grid-area:label;color:rgba(219,233,239,.78);font-size:7.4px;line-height:1;font-weight:1000;letter-spacing:.145em;margin:0;text-align:center;text-shadow:0 1px 4px rgba(0,0,0,.72)}

        .tr-roadmapV2Rail{height:62px;margin:1px 5px 10px}
        .tr-roadmapV2RailBed{top:25px;height:10px;background:linear-gradient(180deg,rgba(0,0,0,.86),rgba(14,39,51,.58) 35%,rgba(93,166,193,.13) 48%,rgba(3,13,19,.94) 67%,rgba(0,0,0,.92));box-shadow:inset 0 3px 4px rgba(0,0,0,.86),inset 0 -1px 0 rgba(126,208,236,.11),0 1px 0 rgba(255,255,255,.03),0 5px 13px rgba(0,0,0,.19)}
        .tr-roadmapV2Segment{top:25px;height:3px}.tr-roadmapV2Segment.is-done{box-shadow:0 0 12px rgba(67,226,160,.30)}.tr-roadmapV2Segment.is-current{box-shadow:0 0 14px rgba(61,213,255,.38)}.tr-roadmapV2Segment.is-next{box-shadow:0 0 12px rgba(231,185,106,.22)}
        .tr-roadmapV2Node{top:25px;width:40px;height:55px;transform:translate(-50%,-19px);gap:5px}
        .tr-roadmapV2NodeFace{width:36px;height:36px;border-color:rgba(129,184,207,.34);background:radial-gradient(circle at 49% 27%,rgba(83,132,150,.48),transparent 33%),radial-gradient(circle at 50% 60%,rgba(21,51,64,.96),rgba(3,12,18,.995) 72%);box-shadow:0 0 0 4px rgba(2,9,14,.91),inset 0 1px 1px rgba(255,255,255,.10),inset 0 -5px 10px rgba(0,0,0,.52),0 7px 14px rgba(0,0,0,.48)}
        .tr-roadmapV2NodeFace::before{content:"";position:absolute;left:20%;right:20%;top:5px;height:1px;border-radius:99px;background:linear-gradient(90deg,transparent,rgba(223,250,255,.32),transparent)}
        .tr-roadmapV2Node b{font-size:9px;color:rgba(203,225,234,.72)}.tr-roadmapV2Node small{font-size:6.5px;letter-spacing:.10em;color:rgba(174,204,216,.66)}
        .tr-roadmapV2Node.is-current .tr-roadmapV2NodeFace{width:42px;height:42px}.tr-roadmapV2Node.is-current b{font-size:10px}.tr-roadmapV2Node.is-next b{font-size:9.5px}.tr-roadmapV2Node.is-done b{font-size:17px}
        .tr-roadmapV2Node.is-current small{font-size:6.8px;color:#99f0ff}.tr-roadmapV2Node.is-next small{color:#f0ce91}.tr-roadmapV2Node.is-done small{color:#87ebb8}

        .tr-roadmapV2Body{grid-template-columns:minmax(320px,.42fr) minmax(0,.58fr);gap:14px;align-items:start}
        .tr-roadmapV2Current{align-self:start;min-height:188px;grid-template-columns:158px minmax(0,1fr);gap:14px;padding:13px 15px;border-color:rgba(75,218,255,.61);border-radius:18px;background:radial-gradient(245px 190px at 23% 48%,rgba(24,210,255,.20),transparent 66%),radial-gradient(240px 150px at 86% 117%,rgba(255,155,52,.055),transparent 71%),linear-gradient(106deg,rgba(255,255,255,.036),transparent 31%),linear-gradient(145deg,rgba(8,37,52,.99),rgba(3,16,24,.998) 58%,rgba(1,8,13,.999));box-shadow:inset 0 1px 0 rgba(218,250,255,.16),inset 0 -1px 0 rgba(15,95,126,.20),inset 22px 0 38px rgba(0,183,240,.045),inset -20px 0 31px rgba(0,0,0,.20),0 16px 31px rgba(0,0,0,.31),0 0 30px rgba(0,193,247,.12)}
        .tr-roadmapV2Current::before{left:12px;right:12px;height:2px;background:linear-gradient(90deg,transparent,#30d4ff 17%,#d7fbff 49%,#31d3ff 81%,transparent);box-shadow:0 0 20px rgba(54,213,255,.54)}
        .tr-roadmapV2Current::after{background:linear-gradient(180deg,rgba(255,255,255,.032),transparent 19%),radial-gradient(220px 100px at 21% 96%,rgba(49,215,255,.075),transparent 70%);box-shadow:inset 16px 0 30px rgba(0,0,0,.035),inset -19px 0 31px rgba(0,0,0,.22)}
        .tr-roadmapV2CurrentVisual{height:158px;border-radius:15px;background:radial-gradient(circle at 50% 47%,rgba(91,226,255,.19),rgba(8,45,60,.045) 46%,transparent 69%),linear-gradient(180deg,rgba(255,255,255,.014),transparent);box-shadow:inset 0 1px 0 rgba(181,239,255,.04),inset 0 -12px 24px rgba(0,0,0,.08);filter:drop-shadow(0 14px 18px rgba(0,0,0,.36))}
        .tr-roadmapV2CurrentVisual::before{width:82%;height:82%;background:radial-gradient(circle,rgba(67,223,255,.15),rgba(5,94,126,.035) 48%,transparent 69%);filter:blur(8px)}
        .tr-roadmapV2CurrentVisual::after{left:5%;right:5%;bottom:2px;height:2px;background:linear-gradient(90deg,transparent,rgba(89,228,255,.88),transparent);box-shadow:0 0 17px rgba(56,213,255,.46)}
        .tr-roadmapV2VisualHalo{width:78%;border-color:rgba(98,229,255,.09);box-shadow:0 0 31px rgba(41,202,246,.075),inset 0 0 25px rgba(41,202,246,.045)}
        .tr-roadmapV2CurrentVisual img{max-width:158px;max-height:158px;filter:drop-shadow(0 10px 11px rgba(0,0,0,.48)) drop-shadow(0 0 14px rgba(42,198,255,.15))}
        .tr-roadmapV2CurrentCopy{gap:6px}.tr-roadmapV2CurrentIndex{font-size:21px}.tr-roadmapV2CurrentIndex small{font-size:10px}.tr-roadmapV2CurrentCopy>strong{font-size:clamp(24px,2.45vw,34px);line-height:.98}.tr-roadmapV2MuscleLabel{font-size:8.3px;color:rgba(191,224,237,.76);letter-spacing:.11em}.tr-roadmapV2CurrentState{font-size:7.4px;color:#8cecff}

        .tr-roadmapV2Agenda{gap:7px;padding:0}.tr-roadmapV2Group{gap:4px}
        .tr-roadmapV2GroupHead{min-height:25px;padding:0 9px;border-bottom:1px solid rgba(106,178,208,.15);background:linear-gradient(90deg,rgba(255,255,255,.014),transparent 62%)}
        .tr-roadmapV2GroupHead>span{font-size:8.8px;letter-spacing:.17em;color:rgba(194,221,232,.76);text-shadow:0 1px 5px rgba(0,0,0,.7)}.tr-roadmapV2GroupHead>small{font-size:7.5px;color:rgba(185,211,221,.62)}
        .tr-roadmapV2Group.is-next .tr-roadmapV2GroupHead>span{color:#f0ce91;text-shadow:0 0 13px rgba(231,192,126,.22)}.tr-roadmapV2Group.is-done .tr-roadmapV2GroupHead>span{color:#83ebb8;text-shadow:0 0 12px rgba(79,220,151,.18)}
        .tr-roadmapV2AgendaRow{min-height:56px;grid-template-columns:56px minmax(0,1fr) 18px;gap:10px;padding:4px 9px;border:1px solid rgba(107,177,205,.12);border-radius:12px;background:linear-gradient(180deg,rgba(255,255,255,.032),transparent 28%),radial-gradient(240px 85px at 3% 50%,rgba(30,160,207,.075),transparent 70%),linear-gradient(95deg,rgba(10,30,41,.96),rgba(3,14,21,.985));box-shadow:inset 0 1px 0 rgba(255,255,255,.035),inset 0 -1px 0 rgba(0,0,0,.42),0 7px 16px rgba(0,0,0,.15);overflow:hidden}
        .tr-roadmapV2AgendaRow::before{top:8px;bottom:8px;width:2px}.tr-roadmapV2AgendaRow::after{content:"";position:absolute;left:6%;right:20%;top:0;height:1px;background:linear-gradient(90deg,transparent,rgba(217,247,255,.10),transparent);pointer-events:none}
        .tr-roadmapV2AgendaRow:hover,.tr-roadmapV2AgendaRow:focus-visible{background:linear-gradient(180deg,rgba(255,255,255,.045),transparent 30%),radial-gradient(260px 100px at 4% 50%,rgba(42,193,239,.12),transparent 70%),linear-gradient(95deg,rgba(12,37,51,.98),rgba(3,15,22,.99));border-color:rgba(95,208,244,.26);transform:translateX(2px);box-shadow:inset 0 1px 0 rgba(255,255,255,.055),0 9px 19px rgba(0,0,0,.19),0 0 18px rgba(44,196,239,.045)}
        .tr-roadmapV2AgendaRow.is-next{border-color:rgba(226,186,112,.22);background:linear-gradient(180deg,rgba(255,247,224,.035),transparent 30%),radial-gradient(250px 95px at 5% 50%,rgba(238,190,106,.14),transparent 70%),linear-gradient(95deg,rgba(39,31,21,.94),rgba(8,16,20,.985) 72%);box-shadow:inset 0 1px 0 rgba(255,248,224,.055),inset 0 -1px 0 rgba(50,33,11,.46),0 8px 18px rgba(0,0,0,.18),0 0 17px rgba(225,181,100,.045)}
        .tr-roadmapV2AgendaRow.is-done{grid-template-columns:20px 56px minmax(0,1fr) 18px;border-color:rgba(75,214,147,.16);background:linear-gradient(180deg,rgba(232,255,243,.025),transparent 30%),radial-gradient(220px 90px at 8% 50%,rgba(69,216,149,.09),transparent 72%),linear-gradient(95deg,rgba(8,30,28,.94),rgba(3,14,18,.985) 72%)}
        .tr-roadmapV2AgendaVisual{width:54px;height:50px;border-radius:11px;background:radial-gradient(circle at 50% 50%,rgba(74,210,251,.13),rgba(11,45,59,.028) 56%,transparent 72%);box-shadow:inset 0 1px 0 rgba(255,255,255,.025),0 7px 11px rgba(0,0,0,.20);filter:none}
        .tr-roadmapV2AgendaVisual img{max-width:52px;max-height:48px;filter:drop-shadow(0 6px 8px rgba(0,0,0,.40)) drop-shadow(0 0 8px rgba(42,198,255,.08))}.tr-roadmapV2AgendaVisual>em{display:none}
        .tr-roadmapV2AgendaRow.is-next .tr-roadmapV2AgendaVisual{background:radial-gradient(circle at 50% 50%,rgba(239,197,120,.18),rgba(74,51,20,.035) 56%,transparent 72%)}.tr-roadmapV2AgendaRow.is-done .tr-roadmapV2AgendaVisual{opacity:.92;filter:none;background:radial-gradient(circle at 50% 50%,rgba(75,222,153,.11),rgba(12,51,40,.028) 56%,transparent 72%)}
        .tr-roadmapV2DoneCheck{width:18px;height:18px;display:grid;place-items:center;align-self:center;border-radius:50%;color:#edfff6;font-size:10px;font-weight:1100;background:linear-gradient(180deg,#54e1a2,#1b9f6b);border:1px solid rgba(170,255,216,.55);box-shadow:inset 0 1px 0 rgba(255,255,255,.22),0 0 11px rgba(59,219,148,.24),0 5px 9px rgba(0,0,0,.24)}
        .tr-roadmapV2AgendaCopy{gap:4px}.tr-roadmapV2AgendaCopy>strong{font-size:14.8px;line-height:1.08;letter-spacing:-.012em}.tr-roadmapV2AgendaCopy>small{font-size:7.3px;line-height:1.08;letter-spacing:.105em;color:rgba(178,207,219,.66)}.tr-roadmapV2AgendaRow.is-next .tr-roadmapV2AgendaCopy>small{color:#edcc91}.tr-roadmapV2AgendaRow.is-done .tr-roadmapV2AgendaCopy>small{color:#83e8b5}.tr-roadmapV2AgendaArrow{font-size:20px;color:rgba(184,222,236,.58)}

        @media (max-width:900px) and (min-width:721px){
          .tr-roadmapV2Body{grid-template-columns:minmax(285px,.43fr) minmax(0,.57fr);gap:12px;align-items:start}
          .tr-roadmapV2Current{min-height:178px;grid-template-columns:142px minmax(0,1fr);padding:12px 13px;gap:12px}.tr-roadmapV2CurrentVisual{height:150px}.tr-roadmapV2CurrentVisual img{max-width:148px;max-height:148px}
          .tr-roadmapV2AgendaRow{grid-template-columns:52px minmax(0,1fr) 16px;min-height:54px;gap:8px;padding:4px 7px}.tr-roadmapV2AgendaRow.is-done{grid-template-columns:18px 52px minmax(0,1fr) 16px}.tr-roadmapV2AgendaVisual{width:50px;height:47px}.tr-roadmapV2AgendaVisual img{max-width:48px;max-height:45px}.tr-roadmapV2AgendaCopy>strong{font-size:13.6px}.tr-roadmapV2AgendaCopy>small{font-size:6.8px}
        }

        @media (max-width:720px){
          .tr-roadmapV2{padding:11px 10px 12px;border-radius:17px}.tr-roadmapV2Header{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:7px;margin-bottom:3px}.tr-roadmapV2Title{gap:2px}.tr-roadmapV2Title>span{font-size:6.7px;letter-spacing:.16em}.tr-roadmapV2TitleLine{gap:5px}.tr-roadmapV2TitleLine>strong{font-size:12.6px}.tr-roadmapV2Edit{height:23px;min-width:48px;padding:0 5px;gap:4px;border-radius:6px}.tr-roadmapV2Edit svg{width:10px;height:10px}.tr-roadmapV2Edit span{font-size:6.4px}.tr-roadmapV2Count{min-width:58px;gap:2px}.tr-roadmapV2Count>strong{font-size:23px}.tr-roadmapV2Count>strong>span{font-size:13px;margin-left:1px}.tr-roadmapV2Count>small{font-size:7px;letter-spacing:.11em}
          .tr-roadmapV2Rail{height:54px;margin:0 1px 7px}.tr-roadmapV2RailBed{top:22px;height:8px}.tr-roadmapV2Segment{top:22px}.tr-roadmapV2Node{top:22px;width:33px;height:48px;transform:translate(-50%,-17px);gap:4px}.tr-roadmapV2NodeFace{width:30px;height:30px}.tr-roadmapV2Node.is-current .tr-roadmapV2NodeFace{width:35px;height:35px}.tr-roadmapV2Node b{font-size:7.7px}.tr-roadmapV2Node.is-current b{font-size:8.4px}.tr-roadmapV2Node.is-next b{font-size:8px}.tr-roadmapV2Node.is-done b{font-size:14px}.tr-roadmapV2Node small,.tr-roadmapV2Node.is-current small{font-size:6px;letter-spacing:.075em}
          .tr-roadmapV2Body{grid-template-columns:1fr;gap:8px;align-items:start}.tr-roadmapV2Current{min-height:104px;grid-template-columns:88px minmax(0,1fr);gap:9px;padding:7px 9px;border-radius:15px;background:radial-gradient(170px 120px at 22% 48%,rgba(24,210,255,.18),transparent 67%),linear-gradient(106deg,rgba(255,255,255,.03),transparent 32%),linear-gradient(145deg,rgba(8,36,51,.99),rgba(2,13,20,.998) 67%)}.tr-roadmapV2CurrentVisual{height:88px;border-radius:12px}.tr-roadmapV2CurrentVisual img{max-width:86px;max-height:86px}.tr-roadmapV2CurrentVisual::after{bottom:1px}.tr-roadmapV2CurrentCopy{gap:3px}.tr-roadmapV2CurrentIndex{font-size:17px}.tr-roadmapV2CurrentIndex small{font-size:8px}.tr-roadmapV2CurrentCopy>strong{font-size:clamp(19px,6vw,24px);line-height:1}.tr-roadmapV2MuscleLabel{font-size:6.5px}.tr-roadmapV2CurrentState{font-size:6.1px}
          .tr-roadmapV2Agenda{gap:6px;padding:0}.tr-roadmapV2Group{gap:3px}.tr-roadmapV2GroupHead{min-height:23px;padding:0 6px}.tr-roadmapV2GroupHead>span{font-size:7.7px;letter-spacing:.15em}.tr-roadmapV2GroupHead>small{font-size:6.7px}.tr-roadmapV2AgendaRow{min-height:52px;grid-template-columns:48px minmax(0,1fr) 15px;gap:8px;padding:4px 7px;border-radius:11px}.tr-roadmapV2AgendaRow.is-done{grid-template-columns:16px 48px minmax(0,1fr) 15px;gap:7px}.tr-roadmapV2AgendaVisual{width:46px;height:44px}.tr-roadmapV2AgendaVisual img{max-width:44px;max-height:42px}.tr-roadmapV2DoneCheck{width:16px;height:16px;font-size:9px}.tr-roadmapV2AgendaCopy{gap:3px}.tr-roadmapV2AgendaCopy>strong{font-size:12.6px;line-height:1.06}.tr-roadmapV2AgendaCopy>small{font-size:6.5px;line-height:1.05;letter-spacing:.085em}.tr-roadmapV2AgendaArrow{font-size:18px}
        }

        @media (max-width:390px){
          .tr-roadmapV2{padding-left:8px;padding-right:8px}.tr-roadmapV2Header{gap:5px}.tr-roadmapV2TitleLine>strong{font-size:11.5px}.tr-roadmapV2Edit{height:22px;min-width:44px;padding:0 4px}.tr-roadmapV2Edit span{font-size:5.9px}.tr-roadmapV2Count{min-width:54px}.tr-roadmapV2Count>strong{font-size:21px}.tr-roadmapV2Count>strong>span{font-size:12px}.tr-roadmapV2Count>small{font-size:6.5px}
          .tr-roadmapV2Rail{height:52px}.tr-roadmapV2Node{width:31px}.tr-roadmapV2NodeFace{width:28px;height:28px}.tr-roadmapV2Node.is-current .tr-roadmapV2NodeFace{width:33px;height:33px}.tr-roadmapV2Node small,.tr-roadmapV2Node.is-current small{font-size:5.6px}
          .tr-roadmapV2Current{min-height:98px;grid-template-columns:80px minmax(0,1fr);gap:8px;padding-left:8px;padding-right:8px}.tr-roadmapV2CurrentVisual{height:82px}.tr-roadmapV2CurrentVisual img{max-width:80px;max-height:80px}.tr-roadmapV2CurrentCopy>strong{font-size:19px}.tr-roadmapV2MuscleLabel{font-size:6.1px}.tr-roadmapV2CurrentState{font-size:5.8px}
          .tr-roadmapV2GroupHead>span{font-size:7.3px}.tr-roadmapV2AgendaRow{grid-template-columns:44px minmax(0,1fr) 14px;gap:7px;padding-left:6px;padding-right:6px}.tr-roadmapV2AgendaRow.is-done{grid-template-columns:15px 44px minmax(0,1fr) 14px;gap:6px}.tr-roadmapV2AgendaVisual{width:42px;height:41px}.tr-roadmapV2AgendaVisual img{max-width:40px;max-height:39px}.tr-roadmapV2DoneCheck{width:15px;height:15px;font-size:8px}.tr-roadmapV2AgendaCopy>strong{font-size:11.7px}.tr-roadmapV2AgendaCopy>small{font-size:6px}
        }

        @media (max-width:345px){
          .tr-roadmapV2Title>span{font-size:5.8px}.tr-roadmapV2TitleLine{gap:3px}.tr-roadmapV2TitleLine>strong{font-size:10.5px}.tr-roadmapV2Edit{min-width:41px;gap:3px}.tr-roadmapV2Edit svg{width:9px;height:9px}.tr-roadmapV2Edit span{font-size:5.5px}.tr-roadmapV2Count{min-width:49px}.tr-roadmapV2Count>strong{font-size:20px}.tr-roadmapV2Count>strong>span{font-size:11px}.tr-roadmapV2Count>small{font-size:6px;letter-spacing:.085em}
          .tr-roadmapV2Rail{height:50px}.tr-roadmapV2Node{width:29px}.tr-roadmapV2NodeFace{width:27px;height:27px}.tr-roadmapV2Node.is-current .tr-roadmapV2NodeFace{width:31px;height:31px}.tr-roadmapV2Node small,.tr-roadmapV2Node.is-current small{font-size:5.2px}
          .tr-roadmapV2Current{grid-template-columns:74px minmax(0,1fr);gap:7px}.tr-roadmapV2CurrentVisual{height:76px}.tr-roadmapV2CurrentVisual img{max-width:74px;max-height:74px}.tr-roadmapV2CurrentCopy>strong{font-size:18px}.tr-roadmapV2MuscleLabel{font-size:5.7px}.tr-roadmapV2CurrentState{font-size:5.5px}
          .tr-roadmapV2GroupHead>span{font-size:7px}.tr-roadmapV2AgendaRow{grid-template-columns:41px minmax(0,1fr) 13px;gap:6px;padding-left:5px;padding-right:5px}.tr-roadmapV2AgendaRow.is-done{grid-template-columns:14px 41px minmax(0,1fr) 13px;gap:5px}.tr-roadmapV2AgendaVisual{width:39px;height:38px}.tr-roadmapV2AgendaVisual img{max-width:37px;max-height:36px}.tr-roadmapV2AgendaCopy>strong{font-size:11.1px}.tr-roadmapV2AgendaCopy>small{font-size:5.7px}.tr-roadmapV2AgendaArrow{font-size:17px}
        }


        /* ============================================================
           R12.5E.3 — FINAL FLAGSHIP ROADMAP RENDERING / RESPONSIVE PASS
           Pure presentation refinement. No roadmap/state/muscle logic changes.
           ============================================================ */
        .tr-roadmapV2{
          --tr-rm-cyan:#55ddff;
          --tr-rm-cyan-soft:rgba(68,214,255,.16);
          --tr-rm-gold:#efc778;
          --tr-rm-green:#61e5a5;
          border-color:rgba(87,201,239,.34);
          background:
            radial-gradient(920px 390px at 10% -30%,rgba(0,201,255,.17),transparent 62%),
            radial-gradient(620px 300px at 98% 105%,rgba(255,153,44,.085),transparent 66%),
            linear-gradient(116deg,rgba(255,255,255,.018),transparent 22% 74%,rgba(255,177,80,.018)),
            linear-gradient(138deg,#0b1d29 0%,#06131c 40%,#02090e 100%);
          box-shadow:
            inset 0 1px 0 rgba(224,250,255,.12),
            inset 0 -1px 0 rgba(255,171,71,.055),
            inset 22px 0 54px rgba(0,116,165,.04),
            inset -26px 0 58px rgba(0,0,0,.24),
            0 18px 44px rgba(0,0,0,.34),
            0 0 34px rgba(0,171,226,.06);
        }
        .tr-roadmapV2::before{
          background:
            linear-gradient(112deg,transparent 0 24%,rgba(161,240,255,.055) 37%,transparent 49%),
            radial-gradient(500px 130px at 16% 8%,rgba(95,226,255,.05),transparent 74%),
            repeating-linear-gradient(90deg,rgba(255,255,255,.009) 0 1px,transparent 1px 11px);
          opacity:.88;
        }
        .tr-roadmapV2::after{
          background:
            linear-gradient(180deg,rgba(255,255,255,.035),transparent 16%,transparent 82%,rgba(0,0,0,.23)),
            radial-gradient(560px 160px at 50% 0%,rgba(117,224,255,.025),transparent 75%);
          box-shadow:inset 20px 0 38px rgba(0,0,0,.09),inset -24px 0 42px rgba(0,0,0,.20);
        }

        .tr-roadmapV2Header{margin-bottom:8px;gap:14px}
        .tr-roadmapV2Title{gap:4px}
        .tr-roadmapV2Title>span{font-size:8px;color:rgba(194,222,233,.72)}
        .tr-roadmapV2TitleLine{gap:8px}
        .tr-roadmapV2TitleLine>strong{font-size:15px;letter-spacing:.005em}
        .tr-roadmapV2Edit{
          height:25px;min-width:54px;padding:0 7px;border-radius:7px;
          border-color:rgba(84,211,251,.33);
          background:linear-gradient(180deg,rgba(26,57,72,.82),rgba(4,16,24,.97));
          box-shadow:inset 0 1px 0 rgba(255,255,255,.08),inset 0 -1px 0 rgba(0,0,0,.36),0 5px 12px rgba(0,0,0,.25),0 0 14px rgba(54,205,248,.06);
        }
        .tr-roadmapV2Edit span{font-size:7.3px;letter-spacing:.13em}

        .tr-roadmapV2Count{
          display:grid;grid-template-columns:1fr;grid-template-areas:"value" "label";
          justify-items:center;align-items:center;min-width:70px;line-height:1;gap:3px;
        }
        .tr-roadmapV2Count>strong{
          grid-area:value;display:inline-flex;align-items:baseline;justify-content:center;gap:3px;
          color:hsl(calc(190 - (var(--tr-roadmap-progress) * 46)) 92% 62%);
          font-size:29px;line-height:.9;font-weight:1100;letter-spacing:-.055em;
          text-shadow:0 0 18px rgba(44,214,255,.26),0 3px 10px rgba(0,0,0,.52);
          white-space:nowrap;
        }
        .tr-roadmapV2Count>strong>span{
          color:rgba(246,250,252,.96);font-size:17px;font-weight:1050;letter-spacing:-.025em;
        }
        .tr-roadmapV2Count>small{
          grid-area:label;color:rgba(218,231,237,.80);font-size:8.1px;line-height:1;font-weight:1000;letter-spacing:.12em;margin:0;
        }

        .tr-roadmapV2Rail{height:61px;margin:1px 4px 12px}
        .tr-roadmapV2RailBed{
          top:25px;height:10px;
          background:linear-gradient(180deg,rgba(0,0,0,.80),rgba(16,43,56,.40) 38%,rgba(112,180,207,.13) 50%,rgba(0,0,0,.74));
          border:1px solid rgba(80,149,174,.08);
          box-shadow:inset 0 3px 4px rgba(0,0,0,.82),inset 0 -1px 0 rgba(146,209,230,.08),0 1px 0 rgba(255,255,255,.035),0 5px 12px rgba(0,0,0,.20);
        }
        .tr-roadmapV2Segment{top:25px;height:3px}
        .tr-roadmapV2Segment.is-current{box-shadow:0 0 15px rgba(61,213,255,.42)}
        .tr-roadmapV2Segment.is-done{box-shadow:0 0 13px rgba(67,226,160,.28)}
        .tr-roadmapV2Segment.is-next{box-shadow:0 0 13px rgba(231,185,106,.24)}
        .tr-roadmapV2Node{top:25px;width:42px;height:58px;transform:translate(-50%,-20px);gap:5px}
        .tr-roadmapV2NodeFace{
          width:37px;height:37px;border-color:rgba(139,190,211,.36);
          background:radial-gradient(circle at 48% 25%,rgba(102,158,178,.46),transparent 31%),radial-gradient(circle at 50% 66%,rgba(20,49,62,.97),rgba(2,10,15,.997) 73%);
          box-shadow:0 0 0 4px rgba(1,7,11,.93),inset 0 1px 1px rgba(255,255,255,.11),inset 0 -6px 11px rgba(0,0,0,.55),0 8px 15px rgba(0,0,0,.48);
        }
        .tr-roadmapV2Node b{font-size:9.4px;color:rgba(215,233,240,.79)}
        .tr-roadmapV2Node small{font-size:7.1px;letter-spacing:.095em;color:rgba(187,211,220,.72);text-shadow:0 1px 5px rgba(0,0,0,.82)}
        .tr-roadmapV2Node.is-current .tr-roadmapV2NodeFace{width:44px;height:44px}
        .tr-roadmapV2Node.is-current b{font-size:10.3px}
        .tr-roadmapV2Node.is-current small{font-size:7.4px;color:#a6f3ff}
        .tr-roadmapV2Node.is-next b{font-size:10px}.tr-roadmapV2Node.is-next small{color:#f2d091}
        .tr-roadmapV2Node.is-done b{font-size:18px}.tr-roadmapV2Node.is-done small{color:#8aefbd}

        .tr-roadmapV2Body{position:relative;grid-template-columns:minmax(310px,.40fr) minmax(0,.60fr);gap:14px;align-items:start}
        .tr-roadmapV2Body::before{
          content:"";position:absolute;pointer-events:none;z-index:-1;left:0;bottom:0;width:40%;height:58%;
          background:
            radial-gradient(ellipse at 35% 28%,rgba(46,204,250,.055),transparent 59%),
            linear-gradient(180deg,transparent,rgba(2,12,18,.16));
          filter:blur(.2px);
        }
        .tr-roadmapV2Current{
          min-height:178px;grid-template-columns:minmax(145px,.46fr) minmax(0,.54fr);gap:12px;padding:12px 14px;
          border-color:rgba(82,221,255,.66);border-radius:18px;
          background:
            radial-gradient(285px 210px at 22% 49%,rgba(20,211,255,.225),transparent 64%),
            radial-gradient(250px 160px at 94% 112%,rgba(255,157,54,.075),transparent 66%),
            linear-gradient(107deg,rgba(255,255,255,.048),transparent 31%),
            linear-gradient(144deg,rgba(8,40,56,.995),rgba(3,16,24,.998) 57%,rgba(1,8,13,.999));
          box-shadow:
            inset 0 1px 0 rgba(225,252,255,.19),inset 0 -1px 0 rgba(13,102,137,.24),
            inset 28px 0 48px rgba(0,184,240,.055),inset -25px 0 42px rgba(0,0,0,.23),
            0 18px 34px rgba(0,0,0,.34),0 0 36px rgba(0,195,248,.14);
        }
        .tr-roadmapV2Current::before{left:11px;right:11px;height:2px;box-shadow:0 0 22px rgba(54,213,255,.64)}
        .tr-roadmapV2Current::after{
          background:
            linear-gradient(180deg,rgba(255,255,255,.045),transparent 18%),
            radial-gradient(240px 115px at 20% 96%,rgba(49,215,255,.105),transparent 70%),
            linear-gradient(90deg,rgba(33,207,255,.022),transparent 35% 80%,rgba(255,160,59,.018));
          box-shadow:inset 18px 0 36px rgba(0,0,0,.02),inset -23px 0 36px rgba(0,0,0,.24);
        }
        .tr-roadmapV2CurrentFx{
          background:linear-gradient(112deg,transparent 7%,rgba(168,246,255,.075) 42%,rgba(255,255,255,.025) 48%,transparent 62%);
        }
        .tr-roadmapV2CurrentVisual{
          height:152px;border-radius:15px;
          background:
            radial-gradient(circle at 50% 46%,rgba(104,232,255,.23),rgba(10,62,80,.055) 47%,transparent 69%),
            linear-gradient(180deg,rgba(255,255,255,.022),transparent 62%);
          box-shadow:inset 0 1px 0 rgba(190,245,255,.055),inset 0 -18px 28px rgba(0,0,0,.11),0 12px 28px rgba(0,0,0,.10);
        }
        .tr-roadmapV2CurrentVisual::before{width:86%;height:86%;background:radial-gradient(circle,rgba(78,226,255,.19),rgba(4,95,126,.035) 52%,transparent 70%);filter:blur(8px)}
        .tr-roadmapV2CurrentVisual::after{left:3%;right:3%;bottom:1px;height:2px;box-shadow:0 0 20px rgba(56,213,255,.58)}
        .tr-roadmapV2VisualHalo{width:82%;border-color:rgba(106,235,255,.11);box-shadow:0 0 36px rgba(41,202,246,.10),inset 0 0 30px rgba(41,202,246,.055)}
        .tr-roadmapV2CurrentVisual img{max-width:154px;max-height:154px;filter:drop-shadow(0 13px 13px rgba(0,0,0,.52)) drop-shadow(0 0 18px rgba(42,198,255,.19))}
        .tr-roadmapV2CurrentCopy{gap:5px}
        .tr-roadmapV2CurrentIndex{font-size:22px}.tr-roadmapV2CurrentIndex small{font-size:10.5px}
        .tr-roadmapV2CurrentCopy>strong{font-size:clamp(25px,2.35vw,34px);line-height:.98}
        .tr-roadmapV2MuscleLabel{font-size:8.4px;line-height:1.12;color:rgba(207,230,239,.82);letter-spacing:.095em}
        .tr-roadmapV2CurrentState{font-size:7.8px;color:#9aecff;text-shadow:0 0 10px rgba(54,213,255,.20)}

        .tr-roadmapV2Agenda{
          gap:7px;padding:0;align-self:start;
          background:linear-gradient(180deg,rgba(255,255,255,.008),transparent 58%);
        }
        .tr-roadmapV2Group{gap:4px}
        .tr-roadmapV2GroupHead{
          min-height:27px;padding:0 9px;
          border-bottom:1px solid rgba(116,190,219,.16);
          background:linear-gradient(90deg,rgba(35,113,143,.065),transparent 56%);
        }
        .tr-roadmapV2GroupHead>span{font-size:10px;letter-spacing:.16em;color:rgba(210,231,239,.85)}
        .tr-roadmapV2GroupHead>small{font-size:8.3px;color:rgba(203,221,228,.72)}
        .tr-roadmapV2Group.is-next .tr-roadmapV2GroupHead>span{color:#f3cf8d;text-shadow:0 0 16px rgba(231,192,126,.25)}
        .tr-roadmapV2Group.is-done .tr-roadmapV2GroupHead>span{color:#8bf1bd;text-shadow:0 0 15px rgba(79,220,151,.22)}

        .tr-roadmapV2AgendaRow{
          min-height:58px;grid-template-columns:58px minmax(0,1fr) 16px;gap:9px;padding:4px 8px;border-radius:12px;
          border:1px solid rgba(107,188,219,.15);
          background:
            linear-gradient(180deg,rgba(255,255,255,.047),transparent 25%),
            radial-gradient(260px 100px at 4% 50%,rgba(30,170,218,.105),transparent 69%),
            linear-gradient(95deg,rgba(11,34,46,.975),rgba(3,14,21,.992));
          box-shadow:
            inset 0 1px 0 rgba(230,250,255,.055),inset 0 -1px 0 rgba(0,0,0,.48),
            inset 16px 0 28px rgba(0,170,223,.018),0 8px 18px rgba(0,0,0,.18);
        }
        .tr-roadmapV2AgendaRow::before{top:7px;bottom:7px;width:3px}
        .tr-roadmapV2AgendaRow::after{left:5%;right:18%;background:linear-gradient(90deg,transparent,rgba(225,248,255,.15),transparent)}
        .tr-roadmapV2AgendaRow:hover,.tr-roadmapV2AgendaRow:focus-visible{
          border-color:rgba(104,220,255,.31);
          background:
            linear-gradient(180deg,rgba(255,255,255,.065),transparent 27%),
            radial-gradient(290px 105px at 5% 50%,rgba(44,202,247,.15),transparent 70%),
            linear-gradient(95deg,rgba(13,42,56,.99),rgba(3,15,22,.995));
          box-shadow:inset 0 1px 0 rgba(255,255,255,.08),inset 14px 0 26px rgba(0,182,235,.03),0 10px 22px rgba(0,0,0,.22),0 0 19px rgba(44,196,239,.07);
        }
        .tr-roadmapV2AgendaRow.is-next{
          border-color:rgba(238,196,118,.34);
          background:
            linear-gradient(180deg,rgba(255,248,226,.07),transparent 27%),
            radial-gradient(290px 110px at 4% 50%,rgba(244,193,99,.20),transparent 69%),
            linear-gradient(95deg,rgba(47,35,21,.97),rgba(7,15,19,.992) 72%);
          box-shadow:inset 0 1px 0 rgba(255,249,229,.09),inset 0 -1px 0 rgba(64,38,11,.50),inset 16px 0 30px rgba(229,174,80,.03),0 9px 20px rgba(0,0,0,.21),0 0 21px rgba(225,181,100,.075);
        }
        .tr-roadmapV2AgendaRow.is-done{
          grid-template-columns:22px 58px minmax(0,1fr) 16px;
          border-color:rgba(76,224,152,.26);
          background:
            linear-gradient(180deg,rgba(233,255,244,.052),transparent 28%),
            radial-gradient(250px 105px at 7% 50%,rgba(70,223,151,.14),transparent 70%),
            linear-gradient(95deg,rgba(8,36,31,.97),rgba(3,14,18,.993) 74%);
          box-shadow:inset 0 1px 0 rgba(235,255,244,.06),inset 0 -1px 0 rgba(0,52,34,.40),0 8px 18px rgba(0,0,0,.18),0 0 16px rgba(67,213,145,.045);
        }
        .tr-roadmapV2AgendaVisual{
          width:56px;height:52px;border-radius:11px;
          background:radial-gradient(circle at 50% 48%,rgba(77,220,255,.18),rgba(10,57,73,.035) 57%,transparent 73%);
          box-shadow:inset 0 1px 0 rgba(255,255,255,.035),inset 0 -8px 16px rgba(0,0,0,.06),0 7px 12px rgba(0,0,0,.22);
        }
        .tr-roadmapV2AgendaVisual img{max-width:54px;max-height:50px;filter:drop-shadow(0 7px 8px rgba(0,0,0,.43)) drop-shadow(0 0 10px rgba(42,198,255,.11))}
        .tr-roadmapV2AgendaRow.is-next .tr-roadmapV2AgendaVisual{background:radial-gradient(circle at 50% 49%,rgba(246,202,121,.23),rgba(82,54,19,.035) 58%,transparent 73%)}
        .tr-roadmapV2AgendaRow.is-done .tr-roadmapV2AgendaVisual{opacity:1;background:radial-gradient(circle at 50% 49%,rgba(78,229,158,.17),rgba(12,58,43,.035) 58%,transparent 73%)}
        .tr-roadmapV2DoneCheck{
          width:20px;height:20px;font-size:10px;justify-self:center;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.28),inset 0 -3px 6px rgba(0,75,48,.26),0 0 13px rgba(59,219,148,.28),0 5px 10px rgba(0,0,0,.28);
        }
        .tr-roadmapV2AgendaCopy{gap:4px}
        .tr-roadmapV2AgendaCopy>strong{font-size:15.3px;line-height:1.05;color:#fbfdff}
        .tr-roadmapV2AgendaCopy>small{font-size:8.3px;line-height:1.08;letter-spacing:.09em;color:rgba(195,220,230,.72)}
        .tr-roadmapV2AgendaRow.is-next .tr-roadmapV2AgendaCopy>small{color:#f0ce92}
        .tr-roadmapV2AgendaRow.is-done .tr-roadmapV2AgendaCopy>small{color:#8cecbc}
        .tr-roadmapV2AgendaArrow{font-size:18px;color:rgba(196,228,239,.63)}
        .tr-roadmapV2AgendaRow.is-next .tr-roadmapV2AgendaArrow{color:#f0cf90}

        @media (max-width:900px) and (min-width:721px){
          .tr-roadmapV2Body{grid-template-columns:minmax(285px,.42fr) minmax(0,.58fr);gap:12px}
          .tr-roadmapV2Current{min-height:164px;grid-template-columns:132px minmax(0,1fr);padding:10px 12px;gap:10px}
          .tr-roadmapV2CurrentVisual{height:138px}.tr-roadmapV2CurrentVisual img{max-width:138px;max-height:138px}
          .tr-roadmapV2AgendaRow{min-height:55px;grid-template-columns:53px minmax(0,1fr) 15px;gap:8px;padding:4px 7px}
          .tr-roadmapV2AgendaRow.is-done{grid-template-columns:20px 53px minmax(0,1fr) 15px}
          .tr-roadmapV2AgendaVisual{width:51px;height:49px}.tr-roadmapV2AgendaVisual img{max-width:49px;max-height:47px}
          .tr-roadmapV2AgendaCopy>strong{font-size:14px}.tr-roadmapV2AgendaCopy>small{font-size:7.6px}
        }

        @media (max-width:720px){
          .tr-roadmapV2{
            padding:10px 9px 10px;border-radius:17px;
            background:
              radial-gradient(430px 205px at 8% -10%,rgba(0,201,255,.16),transparent 64%),
              radial-gradient(310px 180px at 100% 102%,rgba(255,153,44,.07),transparent 69%),
              linear-gradient(138deg,#0a1d28 0%,#05131b 45%,#02090e 100%);
          }
          .tr-roadmapV2Header{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px;margin-bottom:4px;align-items:center}
          .tr-roadmapV2Title{gap:2px}.tr-roadmapV2Title>span{font-size:7.2px;letter-spacing:.15em}
          .tr-roadmapV2TitleLine{gap:5px}.tr-roadmapV2TitleLine>strong{font-size:12.8px;line-height:1}
          .tr-roadmapV2Edit{height:24px;min-width:48px;padding:0 5px;border-radius:6px;gap:4px}.tr-roadmapV2Edit svg{width:10px;height:10px}.tr-roadmapV2Edit span{font-size:6.5px}
          .tr-roadmapV2Count{min-width:61px;gap:2px}.tr-roadmapV2Count>strong{font-size:25px;gap:2px}.tr-roadmapV2Count>strong>span{font-size:14px}.tr-roadmapV2Count>small{font-size:7.8px;letter-spacing:.095em}

          .tr-roadmapV2Rail{height:50px;margin:0 1px 6px}.tr-roadmapV2RailBed{top:20px;height:8px}.tr-roadmapV2Segment{top:20px}
          .tr-roadmapV2Node{top:20px;width:32px;height:46px;transform:translate(-50%,-16px);gap:4px}.tr-roadmapV2NodeFace{width:29px;height:29px}.tr-roadmapV2Node.is-current .tr-roadmapV2NodeFace{width:34px;height:34px}
          .tr-roadmapV2Node b{font-size:7.7px}.tr-roadmapV2Node.is-current b{font-size:8.4px}.tr-roadmapV2Node.is-next b{font-size:8px}.tr-roadmapV2Node.is-done b{font-size:14px}
          .tr-roadmapV2Node small,.tr-roadmapV2Node.is-current small{font-size:6.4px;letter-spacing:.07em}

          .tr-roadmapV2Body{grid-template-columns:1fr;gap:7px}
          .tr-roadmapV2Body::before{display:none}
          .tr-roadmapV2Current{
            min-height:98px;grid-template-columns:88px minmax(0,1fr);gap:8px;padding:6px 8px;border-radius:15px;
            background:
              radial-gradient(180px 125px at 19% 48%,rgba(28,216,255,.225),transparent 66%),
              radial-gradient(170px 100px at 96% 110%,rgba(255,158,55,.06),transparent 72%),
              linear-gradient(108deg,rgba(255,255,255,.043),transparent 31%),
              linear-gradient(145deg,rgba(8,39,54,.995),rgba(2,13,20,.999) 69%);
            box-shadow:inset 0 1px 0 rgba(225,252,255,.17),inset 0 -1px 0 rgba(13,102,137,.22),inset 16px 0 28px rgba(0,184,240,.04),0 12px 24px rgba(0,0,0,.29),0 0 25px rgba(0,195,248,.11);
          }
          .tr-roadmapV2CurrentVisual{height:84px;border-radius:11px}.tr-roadmapV2CurrentVisual img{max-width:84px;max-height:84px}.tr-roadmapV2CurrentVisual::after{bottom:0}
          .tr-roadmapV2CurrentCopy{gap:2px}.tr-roadmapV2CurrentIndex{font-size:17px}.tr-roadmapV2CurrentIndex small{font-size:8px}.tr-roadmapV2CurrentCopy>strong{font-size:clamp(20px,6.1vw,24px);line-height:.98}.tr-roadmapV2MuscleLabel{font-size:7.2px;line-height:1.08;letter-spacing:.075em}.tr-roadmapV2CurrentState{font-size:6.8px;letter-spacing:.13em}

          .tr-roadmapV2Agenda{gap:5px;padding:0}.tr-roadmapV2Group{gap:3px}
          .tr-roadmapV2GroupHead{min-height:24px;padding:0 6px}.tr-roadmapV2GroupHead>span{font-size:9.3px;letter-spacing:.14em}.tr-roadmapV2GroupHead>small{font-size:7.6px}
          .tr-roadmapV2AgendaRow{
            min-height:50px;grid-template-columns:47px minmax(0,1fr) 13px;gap:7px;padding:3px 6px;border-radius:10px;
            background:linear-gradient(180deg,rgba(255,255,255,.045),transparent 26%),radial-gradient(205px 82px at 3% 50%,rgba(30,170,218,.10),transparent 69%),linear-gradient(95deg,rgba(10,32,43,.98),rgba(3,14,21,.994));
          }
          .tr-roadmapV2AgendaRow.is-done{grid-template-columns:18px 47px minmax(0,1fr) 13px;gap:6px}
          .tr-roadmapV2AgendaVisual{width:45px;height:44px}.tr-roadmapV2AgendaVisual img{max-width:43px;max-height:42px}
          .tr-roadmapV2DoneCheck{width:17px;height:17px;font-size:8.5px}
          .tr-roadmapV2AgendaCopy{gap:2px}.tr-roadmapV2AgendaCopy>strong{font-size:13.8px;line-height:1.03}.tr-roadmapV2AgendaCopy>small{font-size:7.6px;line-height:1.05;letter-spacing:.07em}
          .tr-roadmapV2AgendaArrow{font-size:16px}
        }

        @media (max-width:390px){
          .tr-roadmapV2{padding-left:8px;padding-right:8px}
          .tr-roadmapV2Header{gap:5px}.tr-roadmapV2TitleLine>strong{font-size:11.8px}.tr-roadmapV2Edit{height:23px;min-width:45px;padding:0 4px}.tr-roadmapV2Edit span{font-size:6.1px}
          .tr-roadmapV2Count{min-width:57px}.tr-roadmapV2Count>strong{font-size:23px}.tr-roadmapV2Count>strong>span{font-size:13px}.tr-roadmapV2Count>small{font-size:7.3px}
          .tr-roadmapV2Rail{height:48px}.tr-roadmapV2Node{width:30px}.tr-roadmapV2NodeFace{width:27px;height:27px}.tr-roadmapV2Node.is-current .tr-roadmapV2NodeFace{width:32px;height:32px}.tr-roadmapV2Node small,.tr-roadmapV2Node.is-current small{font-size:6px}
          .tr-roadmapV2Current{min-height:94px;grid-template-columns:82px minmax(0,1fr);gap:7px;padding:5px 7px}.tr-roadmapV2CurrentVisual{height:80px}.tr-roadmapV2CurrentVisual img{max-width:80px;max-height:80px}.tr-roadmapV2CurrentCopy>strong{font-size:20px}.tr-roadmapV2MuscleLabel{font-size:6.8px}.tr-roadmapV2CurrentState{font-size:6.4px}
          .tr-roadmapV2GroupHead>span{font-size:9px}.tr-roadmapV2AgendaRow{grid-template-columns:44px minmax(0,1fr) 12px;gap:6px;padding-left:5px;padding-right:5px;min-height:48px}.tr-roadmapV2AgendaRow.is-done{grid-template-columns:17px 44px minmax(0,1fr) 12px;gap:5px}.tr-roadmapV2AgendaVisual{width:42px;height:41px}.tr-roadmapV2AgendaVisual img{max-width:40px;max-height:39px}.tr-roadmapV2AgendaCopy>strong{font-size:13.2px}.tr-roadmapV2AgendaCopy>small{font-size:7.2px}
        }

        @media (max-width:345px){
          .tr-roadmapV2Title>span{font-size:6.2px}.tr-roadmapV2TitleLine{gap:3px}.tr-roadmapV2TitleLine>strong{font-size:10.8px}.tr-roadmapV2Edit{min-width:42px;gap:3px}.tr-roadmapV2Edit svg{width:9px;height:9px}.tr-roadmapV2Edit span{font-size:5.7px}
          .tr-roadmapV2Count{min-width:52px}.tr-roadmapV2Count>strong{font-size:21px}.tr-roadmapV2Count>strong>span{font-size:12px}.tr-roadmapV2Count>small{font-size:6.7px;letter-spacing:.075em}
          .tr-roadmapV2Rail{height:47px}.tr-roadmapV2Node{width:28px}.tr-roadmapV2NodeFace{width:26px;height:26px}.tr-roadmapV2Node.is-current .tr-roadmapV2NodeFace{width:30px;height:30px}.tr-roadmapV2Node small,.tr-roadmapV2Node.is-current small{font-size:5.7px}
          .tr-roadmapV2Current{grid-template-columns:75px minmax(0,1fr);gap:6px;min-height:88px}.tr-roadmapV2CurrentVisual{height:73px}.tr-roadmapV2CurrentVisual img{max-width:73px;max-height:73px}.tr-roadmapV2CurrentCopy>strong{font-size:18.5px}.tr-roadmapV2MuscleLabel{font-size:6.2px}.tr-roadmapV2CurrentState{font-size:6px}
          .tr-roadmapV2GroupHead{min-height:22px}.tr-roadmapV2GroupHead>span{font-size:8.5px}.tr-roadmapV2AgendaRow{grid-template-columns:40px minmax(0,1fr) 11px;gap:5px;padding-left:4px;padding-right:4px;min-height:46px}.tr-roadmapV2AgendaRow.is-done{grid-template-columns:16px 40px minmax(0,1fr) 11px;gap:4px}.tr-roadmapV2AgendaVisual{width:38px;height:38px}.tr-roadmapV2AgendaVisual img{max-width:36px;max-height:36px}.tr-roadmapV2DoneCheck{width:16px;height:16px;font-size:8px}.tr-roadmapV2AgendaCopy>strong{font-size:12.3px}.tr-roadmapV2AgendaCopy>small{font-size:6.7px}.tr-roadmapV2AgendaArrow{font-size:15px}
        }


        /* ============================================================
           R12.5E.4 — FUTURISTIC EXERCISE RAIL + ONE-SURFACE ROADMAP
           Exercise-name rail identity, readable remaining states,
           true recessed/illuminated track rendering, no box-in-box
           artwork treatment, and a denser continuous desktop/mobile
           roadmap surface. Presentation + rail labeling only.
           ============================================================ */
        .tr-roadmapV2{
          --tr-rm-cyan:#64e7ff;
          --tr-rm-cyan-hot:#d8fbff;
          --tr-rm-steel:#8fb9c9;
          --tr-rm-gold:#f3c873;
          --tr-rm-green:#67e7a8;
          padding-bottom:14px;
          background:
            radial-gradient(960px 360px at 8% -26%,rgba(0,205,255,.18),transparent 61%),
            radial-gradient(760px 310px at 100% 108%,rgba(255,153,48,.085),transparent 64%),
            linear-gradient(115deg,rgba(235,251,255,.023),transparent 26% 70%,rgba(255,190,99,.018)),
            linear-gradient(141deg,#0b202c 0%,#06151e 38%,#020a0f 100%);
          box-shadow:
            inset 0 1px 0 rgba(229,252,255,.14),
            inset 0 -1px 0 rgba(255,172,72,.055),
            inset 0 24px 68px rgba(56,193,238,.026),
            inset 30px 0 72px rgba(0,122,171,.04),
            inset -32px 0 74px rgba(0,0,0,.26),
            0 20px 48px rgba(0,0,0,.36),
            0 0 42px rgba(0,174,228,.065);
        }
        .tr-roadmapV2::before{
          background:
            linear-gradient(111deg,transparent 0 22%,rgba(181,246,255,.065) 36%,transparent 49%),
            radial-gradient(620px 150px at 18% 4%,rgba(81,225,255,.06),transparent 72%),
            repeating-linear-gradient(90deg,rgba(255,255,255,.009) 0 1px,transparent 1px 12px);
          opacity:.9;
        }
        .tr-roadmapV2::after{
          background:
            linear-gradient(180deg,rgba(255,255,255,.044),transparent 13%,transparent 83%,rgba(0,0,0,.24)),
            radial-gradient(680px 180px at 51% 0%,rgba(135,232,255,.028),transparent 76%);
        }

        .tr-roadmapV2Header{margin-bottom:5px}
        .tr-roadmapV2Count{min-width:74px;gap:2px}
        .tr-roadmapV2Count>strong{font-size:27px;gap:2px;letter-spacing:-.045em}
        .tr-roadmapV2Count>strong>span{font-size:16px;margin:0}
        .tr-roadmapV2Count>small{font-size:8.4px;letter-spacing:.10em;color:rgba(226,239,244,.88)}

        .tr-roadmapV2Rail{height:84px;margin:0 4px 10px;overflow:visible}
        .tr-roadmapV2RailBed{
          left:5%;right:5%;top:25px;height:13px;border-radius:999px;overflow:visible;
          border:1px solid rgba(112,183,207,.13);
          background:linear-gradient(180deg,rgba(2,7,10,.98),rgba(17,45,57,.74) 35%,rgba(48,94,111,.25) 49%,rgba(3,13,18,.98) 66%,rgba(0,0,0,.98));
          box-shadow:inset 0 4px 5px rgba(0,0,0,.92),inset 0 -1px 0 rgba(166,226,245,.13),inset 0 1px 0 rgba(255,255,255,.025),0 1px 0 rgba(255,255,255,.035),0 7px 16px rgba(0,0,0,.30),0 0 20px rgba(58,191,228,.035);
        }
        .tr-roadmapV2RailBed::before{
          content:"";position:absolute;left:1.2%;right:1.2%;top:50%;height:2px;transform:translateY(-50%);border-radius:999px;
          background:linear-gradient(90deg,rgba(70,122,143,.18),rgba(135,198,220,.36) 18%,rgba(78,137,159,.20) 50%,rgba(135,198,220,.34) 82%,rgba(70,122,143,.18));
          box-shadow:0 0 7px rgba(101,193,222,.10),0 1px 0 rgba(255,255,255,.045);pointer-events:none;
        }
        .tr-roadmapV2RailBed::after{
          content:"";position:absolute;left:4%;width:21%;top:3px;bottom:3px;border-radius:999px;
          background:linear-gradient(90deg,transparent,rgba(175,246,255,.18),rgba(87,222,255,.38),rgba(175,246,255,.14),transparent);
          filter:blur(.3px);opacity:.58;pointer-events:none;animation:tr-roadmapV2-rail-energy 4.8s ease-in-out infinite;
        }
        .tr-roadmapV2Segment{top:25px;height:3px;z-index:2;border-radius:999px;filter:saturate(1.08)}
        .tr-roadmapV2Segment.is-remaining{background:linear-gradient(90deg,rgba(90,145,166,.28),rgba(127,185,205,.42),rgba(90,145,166,.28));box-shadow:0 0 7px rgba(104,183,210,.08)}
        .tr-roadmapV2Segment.is-current{background:linear-gradient(90deg,rgba(40,158,198,.40),rgba(115,238,255,.94),rgba(45,174,214,.48));box-shadow:0 0 14px rgba(73,222,255,.48),0 0 3px rgba(219,252,255,.56)}
        .tr-roadmapV2Segment.is-next{background:linear-gradient(90deg,rgba(122,96,55,.32),rgba(245,202,119,.78),rgba(129,99,55,.34));box-shadow:0 0 13px rgba(239,193,110,.30)}
        .tr-roadmapV2Segment.is-done{background:linear-gradient(90deg,rgba(46,174,119,.42),rgba(107,239,177,.86),rgba(50,182,125,.46));box-shadow:0 0 13px rgba(81,226,157,.32)}

        .tr-roadmapV2Node{top:25px;width:min(112px,calc((100% - 18px)/var(--tr-roadmap-count)));height:82px;transform:translate(-50%,-20px);gap:2px;align-content:start}
        .tr-roadmapV2NodeFace{
          width:39px;height:39px;border:1px solid rgba(154,208,227,.54);
          background:radial-gradient(circle at 48% 27%,rgba(225,248,255,.20),transparent 20%),radial-gradient(circle at 50% 58%,rgba(56,103,121,.86),rgba(11,31,40,.99) 55%,rgba(2,9,13,1) 78%);
          box-shadow:0 0 0 4px rgba(1,8,12,.95),0 0 0 5px rgba(116,183,207,.08),inset 0 1px 1px rgba(255,255,255,.17),inset 0 -7px 12px rgba(0,0,0,.60),0 8px 16px rgba(0,0,0,.52),0 0 12px rgba(99,192,221,.08);
        }
        .tr-roadmapV2NodeFace::before{left:22%;right:22%;top:5px;background:linear-gradient(90deg,transparent,rgba(239,253,255,.52),transparent)}
        .tr-roadmapV2NodeFace::after{inset:4px;border-color:rgba(205,242,252,.065)}
        .tr-roadmapV2NodeLens{width:12px;height:12px;border-radius:50%;display:block;background:radial-gradient(circle at 40% 31%,#e9fbff 0 9%,#83c9de 17%,#356d82 43%,#0d2732 72%,#07141a 100%);border:1px solid rgba(174,226,242,.50);box-shadow:inset 0 1px 2px rgba(255,255,255,.26),inset 0 -2px 4px rgba(0,0,0,.48),0 0 9px rgba(92,191,220,.20)}
        .tr-roadmapV2NodeName{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;width:calc(100% - 4px);min-height:18px;color:rgba(226,240,246,.93);font-size:7.8px;line-height:1.08;font-weight:1000;letter-spacing:.035em;text-transform:uppercase;text-align:center;text-shadow:0 1px 5px rgba(0,0,0,.92);overflow-wrap:anywhere}
        .tr-roadmapV2Node small{font-size:7px;letter-spacing:.13em;color:rgba(166,203,217,.78);font-weight:1050;text-shadow:0 1px 5px rgba(0,0,0,.90)}
        .tr-roadmapV2Node.is-current .tr-roadmapV2NodeFace{width:45px;height:45px;border-color:rgba(218,251,255,.96);background:radial-gradient(circle at 48% 25%,#f5feff 0 7%,#8df1ff 19%,#21c8ef 50%,#08759b 75%,#03334a 100%);box-shadow:0 0 0 4px rgba(4,20,29,.95),0 0 0 7px rgba(49,211,251,.11),inset 0 1px 2px rgba(255,255,255,.58),inset 0 -8px 12px rgba(0,70,102,.45),0 0 28px rgba(69,225,255,.74),0 9px 18px rgba(0,0,0,.52)}
        .tr-roadmapV2Node.is-current .tr-roadmapV2NodeLens{width:13px;height:13px;background:radial-gradient(circle at 38% 28%,#fff 0 11%,#d9fbff 16%,#6be9ff 33%,#13bfe8 59%,#075b7b 100%);border-color:rgba(229,253,255,.9);box-shadow:0 0 10px rgba(171,246,255,.68),0 0 20px rgba(55,218,255,.48),inset 0 -2px 4px rgba(0,92,126,.42)}
        .tr-roadmapV2Node.is-current .tr-roadmapV2NodeName{color:#effdff;font-size:8.1px;text-shadow:0 0 10px rgba(86,228,255,.22),0 1px 5px rgba(0,0,0,.9)}
        .tr-roadmapV2Node.is-current small{font-size:7.3px;color:#a9f4ff;text-shadow:0 0 10px rgba(77,224,255,.42)}
        .tr-roadmapV2Node.is-next .tr-roadmapV2NodeFace{border-color:rgba(255,225,170,.88);background:radial-gradient(circle at 48% 26%,#fff4d8 0 7%,#f2d49c 20%,#b57f38 54%,#62431d 77%,#25190d 100%);box-shadow:0 0 0 4px rgba(13,10,6,.95),0 0 0 6px rgba(235,188,103,.075),inset 0 1px 2px rgba(255,255,255,.35),inset 0 -7px 12px rgba(80,48,12,.42),0 0 20px rgba(239,191,111,.36),0 8px 16px rgba(0,0,0,.50)}
        .tr-roadmapV2Node.is-next .tr-roadmapV2NodeLens{background:radial-gradient(circle at 40% 30%,#fff9e8 0 10%,#f5d69a 23%,#d5a052 55%,#77501f 100%);border-color:rgba(255,232,184,.82);box-shadow:0 0 11px rgba(244,200,119,.46),inset 0 -2px 4px rgba(100,60,15,.32)}
        .tr-roadmapV2Node.is-next .tr-roadmapV2NodeName{color:#fff3da}.tr-roadmapV2Node.is-next small{color:#f1d193}
        .tr-roadmapV2Node.is-done .tr-roadmapV2NodeFace{border-color:rgba(145,255,205,.90);background:radial-gradient(circle at 48% 28%,#eafff4 0 6%,#8ef0bd 21%,#31c985 57%,#0f6949 100%);box-shadow:0 0 0 4px rgba(2,13,11,.95),0 0 0 6px rgba(74,220,151,.075),inset 0 1px 2px rgba(255,255,255,.40),inset 0 -7px 12px rgba(0,70,43,.39),0 0 21px rgba(75,228,157,.39),0 8px 16px rgba(0,0,0,.49)}
        .tr-roadmapV2Node.is-done b{font-size:18px;color:#f2fff8}.tr-roadmapV2Node.is-done .tr-roadmapV2NodeName{color:#ddf9ec}.tr-roadmapV2Node.is-done small{color:#8ff0bd}

        .tr-roadmapV2Body{position:relative;grid-template-columns:minmax(330px,.43fr) minmax(0,.57fr);gap:0;align-items:stretch;border-top:1px solid rgba(111,190,219,.10);background:radial-gradient(500px 260px at 17% 48%,rgba(25,208,255,.09),transparent 68%),radial-gradient(430px 250px at 98% 45%,rgba(255,169,69,.025),transparent 72%),linear-gradient(180deg,rgba(255,255,255,.012),transparent 22%);box-shadow:inset 0 1px 0 rgba(255,255,255,.018)}
        .tr-roadmapV2Body::before{left:43%;top:14px;bottom:12px;width:1px;height:auto;background:linear-gradient(180deg,transparent,rgba(125,210,237,.20) 18%,rgba(69,137,162,.14) 72%,transparent);filter:none;z-index:1;box-shadow:1px 0 0 rgba(255,255,255,.015);opacity:1}
        .tr-roadmapV2Current{align-self:stretch;min-height:190px;grid-template-columns:minmax(158px,.48fr) minmax(0,.52fr);gap:12px;padding:14px 18px 14px 6px;border:0;border-radius:0;background:transparent;box-shadow:none;overflow:visible}
        .tr-roadmapV2Current::before{left:2%;right:44%;top:8px;height:1px;background:linear-gradient(90deg,transparent,rgba(121,236,255,.46),transparent);box-shadow:0 0 15px rgba(59,216,255,.20)}
        .tr-roadmapV2Current::after{inset:0;background:radial-gradient(270px 190px at 24% 47%,rgba(53,222,255,.14),transparent 66%),radial-gradient(220px 150px at 66% 107%,rgba(255,159,55,.045),transparent 72%),linear-gradient(108deg,rgba(255,255,255,.025),transparent 34%);box-shadow:none}
        .tr-roadmapV2CurrentFx{inset:0;background:linear-gradient(112deg,transparent 10%,rgba(182,248,255,.055) 39%,rgba(255,255,255,.018) 47%,transparent 60%);opacity:.75}
        .tr-roadmapV2CurrentVisual{height:166px;border-radius:0;background:transparent;box-shadow:none;filter:none;overflow:visible}
        .tr-roadmapV2CurrentVisual::before{width:112%;height:112%;background:radial-gradient(circle,rgba(78,229,255,.20),rgba(7,108,142,.055) 43%,transparent 69%);filter:blur(9px)}
        .tr-roadmapV2CurrentVisual::after{left:8%;right:8%;bottom:0;height:2px;background:linear-gradient(90deg,transparent,rgba(96,232,255,.72),transparent);box-shadow:0 0 18px rgba(57,216,255,.40)}
        .tr-roadmapV2VisualHalo{width:88%;border:0;box-shadow:0 0 48px rgba(43,210,250,.13),inset 0 0 34px rgba(43,210,250,.035)}
        .tr-roadmapV2CurrentVisual img{max-width:166px;max-height:166px;filter:drop-shadow(0 14px 15px rgba(0,0,0,.54)) drop-shadow(0 0 20px rgba(49,209,251,.21))}
        .tr-roadmapV2CurrentCopy{gap:5px;padding-right:4px}.tr-roadmapV2CurrentIndex{font-size:21px}.tr-roadmapV2CurrentIndex small{font-size:10px}.tr-roadmapV2CurrentCopy>strong{font-size:clamp(25px,2.4vw,35px)}.tr-roadmapV2MuscleLabel{font-size:8.7px}.tr-roadmapV2CurrentState{font-size:8px}

        .tr-roadmapV2Agenda{align-self:start;gap:5px;padding:10px 0 0 17px;background:transparent}
        .tr-roadmapV2Group{gap:1px}
        .tr-roadmapV2GroupHead{min-height:24px;padding:0 7px;border-bottom:1px solid rgba(126,194,219,.14);background:linear-gradient(90deg,rgba(50,137,168,.045),transparent 60%)}
        .tr-roadmapV2GroupHead>span{font-size:10.8px;letter-spacing:.15em;color:rgba(221,238,244,.91)}
        .tr-roadmapV2GroupHead>small{font-size:8.7px;color:rgba(203,224,232,.74)}
        .tr-roadmapV2Group.is-next .tr-roadmapV2GroupHead>span{color:#f4d294}.tr-roadmapV2Group.is-done .tr-roadmapV2GroupHead>span{color:#91f0bd}
        .tr-roadmapV2AgendaRow{min-height:50px;grid-template-columns:54px minmax(0,1fr) 16px;gap:9px;padding:3px 7px;border:0;border-bottom:1px solid rgba(115,178,202,.11);border-radius:0;background:linear-gradient(180deg,rgba(255,255,255,.018),transparent 36%),radial-gradient(260px 88px at 3% 50%,rgba(37,180,226,.075),transparent 70%);box-shadow:inset 0 1px 0 rgba(255,255,255,.016);overflow:visible}
        .tr-roadmapV2AgendaRow::after{left:8%;right:22%;opacity:.55}
        .tr-roadmapV2AgendaRow:hover,.tr-roadmapV2AgendaRow:focus-visible{transform:none;border-color:transparent;background:linear-gradient(180deg,rgba(255,255,255,.027),transparent 38%),radial-gradient(300px 100px at 4% 50%,rgba(47,205,248,.13),transparent 72%);box-shadow:inset 0 1px 0 rgba(255,255,255,.028),inset 12px 0 28px rgba(0,188,239,.025),0 0 18px rgba(44,196,239,.035)}
        .tr-roadmapV2AgendaRow.is-next{border-color:transparent;background:linear-gradient(180deg,rgba(255,246,220,.028),transparent 38%),radial-gradient(300px 100px at 4% 50%,rgba(244,193,99,.14),transparent 72%);box-shadow:inset 0 1px 0 rgba(255,248,227,.025),inset 13px 0 29px rgba(230,176,81,.028)}
        .tr-roadmapV2AgendaRow.is-done{grid-template-columns:22px 54px minmax(0,1fr) 16px;border-color:transparent;background:linear-gradient(180deg,rgba(232,255,244,.022),transparent 38%),radial-gradient(280px 96px at 6% 50%,rgba(71,224,152,.11),transparent 72%);box-shadow:inset 0 1px 0 rgba(235,255,244,.022),inset 13px 0 28px rgba(65,210,143,.02)}
        .tr-roadmapV2AgendaVisual{width:52px;height:46px;border-radius:0;background:radial-gradient(circle at 50% 50%,rgba(76,220,255,.13),transparent 68%);box-shadow:none;filter:drop-shadow(0 7px 9px rgba(0,0,0,.30))}
        .tr-roadmapV2AgendaVisual img{max-width:51px;max-height:45px;filter:drop-shadow(0 6px 8px rgba(0,0,0,.42)) drop-shadow(0 0 10px rgba(50,205,245,.10))}
        .tr-roadmapV2AgendaRow.is-next .tr-roadmapV2AgendaVisual{background:radial-gradient(circle at 50% 50%,rgba(246,202,121,.17),transparent 69%)}
        .tr-roadmapV2AgendaRow.is-done .tr-roadmapV2AgendaVisual{background:radial-gradient(circle at 50% 50%,rgba(78,229,158,.13),transparent 69%)}
        .tr-roadmapV2DoneCheck{width:19px;height:19px;font-size:10px;box-shadow:inset 0 1px 0 rgba(255,255,255,.28),0 0 14px rgba(59,219,148,.30),0 5px 9px rgba(0,0,0,.28)}
        .tr-roadmapV2AgendaCopy{gap:3px}.tr-roadmapV2AgendaCopy>strong{font-size:15px}.tr-roadmapV2AgendaCopy>small{font-size:8.4px;letter-spacing:.075em;color:rgba(202,224,233,.77)}
        .tr-roadmapV2AgendaArrow{font-size:17px;color:rgba(202,231,241,.65)}

        @keyframes tr-roadmapV2-rail-energy{0%,100%{transform:translateX(-4%);opacity:.25}50%{transform:translateX(325%);opacity:.66}}

        @media (max-width:900px) and (min-width:721px){
          .tr-roadmapV2Node{width:min(96px,calc((100% - 16px)/var(--tr-roadmap-count)))}.tr-roadmapV2NodeName{width:calc(100% - 4px);font-size:7.3px}
          .tr-roadmapV2Body{grid-template-columns:minmax(285px,.43fr) minmax(0,.57fr)}.tr-roadmapV2Body::before{left:43%}
          .tr-roadmapV2Current{grid-template-columns:142px minmax(0,1fr);padding-right:14px}.tr-roadmapV2CurrentVisual{height:152px}.tr-roadmapV2CurrentVisual img{max-width:150px;max-height:150px}
          .tr-roadmapV2Agenda{padding-left:13px}.tr-roadmapV2AgendaCopy>strong{font-size:14.2px}.tr-roadmapV2AgendaCopy>small{font-size:7.8px}
        }

        @media (max-width:720px){
          .tr-roadmapV2{padding:10px 9px 9px}
          .tr-roadmapV2Header{margin-bottom:2px}.tr-roadmapV2Count{min-width:59px}.tr-roadmapV2Count>strong{font-size:23px}.tr-roadmapV2Count>strong>span{font-size:13px}.tr-roadmapV2Count>small{font-size:7.4px;letter-spacing:.075em}
          .tr-roadmapV2Rail{height:72px;margin:0 0 5px}.tr-roadmapV2RailBed{left:7%;right:7%;top:21px;height:10px}.tr-roadmapV2Segment{top:21px;height:2px}
          .tr-roadmapV2Node{top:21px;width:min(68px,calc((100% - 8px)/var(--tr-roadmap-count)));height:70px;transform:translate(-50%,-16px);gap:1px}.tr-roadmapV2NodeFace{width:30px;height:30px}.tr-roadmapV2Node.is-current .tr-roadmapV2NodeFace{width:34px;height:34px}
          .tr-roadmapV2NodeLens{width:9px;height:9px}.tr-roadmapV2Node.is-current .tr-roadmapV2NodeLens{width:10px;height:10px}
          .tr-roadmapV2NodeName{width:calc(100% - 3px);min-height:17px;font-size:clamp(5.9px,1.85vw,6.8px);line-height:1.04;letter-spacing:.018em}.tr-roadmapV2Node.is-current .tr-roadmapV2NodeName{font-size:7px}
          .tr-roadmapV2Node small,.tr-roadmapV2Node.is-current small{font-size:6.3px;letter-spacing:.09em}.tr-roadmapV2Node.is-done b{font-size:14px}
          .tr-roadmapV2Body{grid-template-columns:1fr;gap:0;border-top-color:rgba(117,194,222,.11);background:radial-gradient(330px 180px at 18% 17%,rgba(38,214,255,.085),transparent 69%)}
          .tr-roadmapV2Body::before{display:none}
          .tr-roadmapV2Current{min-height:88px;grid-template-columns:86px minmax(0,1fr);gap:8px;padding:6px 6px 7px 2px;border:0;border-bottom:1px solid rgba(116,191,218,.12)}
          .tr-roadmapV2Current::before{left:4%;right:62%;top:0}.tr-roadmapV2Current::after{background:radial-gradient(180px 115px at 20% 48%,rgba(53,222,255,.13),transparent 69%),radial-gradient(160px 95px at 92% 107%,rgba(255,159,55,.035),transparent 73%)}
          .tr-roadmapV2CurrentVisual{height:80px}.tr-roadmapV2CurrentVisual img{max-width:82px;max-height:82px}.tr-roadmapV2CurrentVisual::after{left:11%;right:11%}
          .tr-roadmapV2CurrentCopy{gap:2px;padding-right:1px}.tr-roadmapV2CurrentIndex{font-size:16px}.tr-roadmapV2CurrentIndex small{font-size:7.5px}.tr-roadmapV2CurrentCopy>strong{font-size:clamp(19px,5.7vw,23px);line-height:.98}.tr-roadmapV2MuscleLabel{font-size:6.7px;letter-spacing:.06em}.tr-roadmapV2CurrentState{font-size:6.3px}
          .tr-roadmapV2Agenda{gap:3px;padding:5px 0 0}.tr-roadmapV2Group{gap:0}.tr-roadmapV2GroupHead{min-height:21px;padding:0 5px}.tr-roadmapV2GroupHead>span{font-size:9.6px;letter-spacing:.12em}.tr-roadmapV2GroupHead>small{font-size:7.5px}
          .tr-roadmapV2AgendaRow{min-height:46px;grid-template-columns:44px minmax(0,1fr) 12px;gap:7px;padding:2px 5px;border-radius:0}.tr-roadmapV2AgendaRow.is-done{grid-template-columns:17px 44px minmax(0,1fr) 12px;gap:6px}
          .tr-roadmapV2AgendaVisual{width:42px;height:40px}.tr-roadmapV2AgendaVisual img{max-width:41px;max-height:39px}.tr-roadmapV2DoneCheck{width:17px;height:17px;font-size:8.5px}.tr-roadmapV2AgendaCopy{gap:2px}.tr-roadmapV2AgendaCopy>strong{font-size:13.4px}.tr-roadmapV2AgendaCopy>small{font-size:7.3px;letter-spacing:.055em}.tr-roadmapV2AgendaArrow{font-size:15px}
        }

        @media (max-width:390px){
          .tr-roadmapV2{padding-left:7px;padding-right:7px}.tr-roadmapV2Count{min-width:55px}.tr-roadmapV2Count>strong{font-size:21px}.tr-roadmapV2Count>strong>span{font-size:12px}.tr-roadmapV2Count>small{font-size:6.9px}
          .tr-roadmapV2Rail{height:70px}.tr-roadmapV2Node{width:min(62px,calc((100% - 8px)/var(--tr-roadmap-count)))}.tr-roadmapV2NodeName{width:calc(100% - 3px);font-size:clamp(5.7px,1.7vw,6.3px)}.tr-roadmapV2Node.is-current .tr-roadmapV2NodeName{font-size:6.5px}.tr-roadmapV2Node small,.tr-roadmapV2Node.is-current small{font-size:5.9px}
          .tr-roadmapV2Current{grid-template-columns:80px minmax(0,1fr);gap:6px}.tr-roadmapV2CurrentVisual{height:75px}.tr-roadmapV2CurrentVisual img{max-width:77px;max-height:77px}.tr-roadmapV2CurrentCopy>strong{font-size:19px}.tr-roadmapV2MuscleLabel{font-size:6.3px}.tr-roadmapV2CurrentState{font-size:6px}
          .tr-roadmapV2GroupHead>span{font-size:9.1px}.tr-roadmapV2AgendaRow{grid-template-columns:41px minmax(0,1fr) 11px;gap:6px;padding-left:4px;padding-right:4px;min-height:44px}.tr-roadmapV2AgendaRow.is-done{grid-template-columns:16px 41px minmax(0,1fr) 11px;gap:5px}.tr-roadmapV2AgendaVisual{width:39px;height:38px}.tr-roadmapV2AgendaVisual img{max-width:38px;max-height:37px}.tr-roadmapV2AgendaCopy>strong{font-size:12.8px}.tr-roadmapV2AgendaCopy>small{font-size:7px}
        }

        @media (max-width:345px){
          .tr-roadmapV2TitleLine>strong{font-size:10.6px}.tr-roadmapV2Edit{min-width:41px;padding:0 4px}.tr-roadmapV2Count{min-width:50px}.tr-roadmapV2Count>strong{font-size:20px}.tr-roadmapV2Count>strong>span{font-size:11px}.tr-roadmapV2Count>small{font-size:6.3px}
          .tr-roadmapV2Rail{height:68px}.tr-roadmapV2Node{width:min(56px,calc((100% - 6px)/var(--tr-roadmap-count)))}.tr-roadmapV2NodeFace{width:27px;height:27px}.tr-roadmapV2Node.is-current .tr-roadmapV2NodeFace{width:31px;height:31px}.tr-roadmapV2NodeName{width:calc(100% - 2px);font-size:clamp(5.3px,1.65vw,5.9px)}.tr-roadmapV2Node.is-current .tr-roadmapV2NodeName{font-size:6.1px}.tr-roadmapV2Node small,.tr-roadmapV2Node.is-current small{font-size:5.5px}
          .tr-roadmapV2Current{grid-template-columns:74px minmax(0,1fr);gap:5px;min-height:82px}.tr-roadmapV2CurrentVisual{height:70px}.tr-roadmapV2CurrentVisual img{max-width:72px;max-height:72px}.tr-roadmapV2CurrentCopy>strong{font-size:18px}.tr-roadmapV2MuscleLabel{font-size:5.9px}.tr-roadmapV2CurrentState{font-size:5.7px}
          .tr-roadmapV2GroupHead>span{font-size:8.7px}.tr-roadmapV2AgendaRow{grid-template-columns:38px minmax(0,1fr) 10px;gap:5px;min-height:42px}.tr-roadmapV2AgendaRow.is-done{grid-template-columns:15px 38px minmax(0,1fr) 10px;gap:4px}.tr-roadmapV2AgendaVisual{width:36px;height:35px}.tr-roadmapV2AgendaVisual img{max-width:35px;max-height:34px}.tr-roadmapV2AgendaCopy>strong{font-size:12px}.tr-roadmapV2AgendaCopy>small{font-size:6.5px}.tr-roadmapV2AgendaArrow{font-size:14px}
        }

        @media (prefers-reduced-motion:reduce){
          .tr-siToggle,.tr-siWeekFill{transition:none!important}
          .tr-roadmapV2::before,.tr-roadmapV2CurrentFx,.tr-roadmapV2Node.is-current .tr-roadmapV2NodeFace{animation:none!important}
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
