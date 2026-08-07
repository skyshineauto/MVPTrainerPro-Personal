import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../../lib/supabase";
import {
  playWorkoutAlert,
  preloadWorkoutAlerts,
  primeWorkoutAudio,
} from "../../lib/workoutAudio";
import { Card } from "../../ui/Card";
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
const EDIT_RESULTS_BATCH_SIZE = 14;

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

    const scroller = target.closest<HTMLElement>(
      ".tr-editCurrentList, .tr-editResultsViewport, .tr-editFilterScroll, .tr-completeGrid, .tr-modalBody"
    );

    if (!scroller || Math.abs(deltaX) > Math.abs(deltaY)) {
      if (!scroller) event.preventDefault();
      return;
    }

    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    if (maxScrollTop <= 1) {
      event.preventDefault();
      return;
    }

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

function MediaOrFallback({ item, exerciseId }: { item: any; exerciseId?: string }) {
  const { gif, video, poster } = resolveMedia(item);

  const goUpload = () => {
    const exId = exerciseId || item?.id || item?.exercise_id;
    if (!exId) return;
    window.location.pathname = `/library/${exId}`;
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
              <div className="tr-mediaMountInner">
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

async function loadPreviousPerformance(params: {
  exerciseId: string;
  currentWorkoutId: string;
}): Promise<PreviousPerformance | null> {
  const { exerciseId, currentWorkoutId } = params;
  if (!exerciseId) return null;

  const { data: u, error: uErr } = await supabase.auth.getUser();
  if (uErr) throw uErr;
  if (!u.user) return null;

  const { data: matchingRows, error: matchingErr } = await supabase
    .from("workout_exercises")
    .select("id, workout_id, exercise_id, prescription_snapshot, pain, difficulty")
    .eq("exercise_id", exerciseId)
    .neq("workout_id", currentWorkoutId);

  if (matchingErr) throw matchingErr;

  const matchingExercises = (matchingRows ?? []) as any[];
  const workoutIds = Array.from(
    new Set(matchingExercises.map((row) => row.workout_id).filter(Boolean))
  );
  if (!workoutIds.length) return null;

  const { data: completedWorkouts, error: workoutErr } = await supabase
    .from("workouts")
    .select("id, completed_at, workout_summary")
    .eq("user_id", u.user.id)
    .in("id", workoutIds)
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false })
    .limit(1);

  if (workoutErr) throw workoutErr;

  const previousWorkout = (completedWorkouts ?? [])[0] as any;
  if (!previousWorkout) return null;

  const previousExercise = matchingExercises.find(
    (row) => row.workout_id === previousWorkout.id
  );
  if (!previousExercise?.id) return null;

  const { data: setRows, error: setsErr } = await supabase
    .from("workout_sets")
    .select("set_index,reps,weight,rir,pain,form")
    .eq("workout_exercise_id", previousExercise.id)
    .order("set_index", { ascending: true });

  if (setsErr) throw setsErr;

  const summary = previousWorkout.workout_summary as any;

  return {
    workoutId: previousWorkout.id,
    workoutExerciseId: previousExercise.id,
    completedAt: previousWorkout.completed_at,
    templateName:
      typeof summary?.template_name === "string" && summary.template_name.trim()
        ? summary.template_name.trim()
        : "Previous workout",
    prescriptionSnapshot: previousExercise.prescription_snapshot ?? {},
    pain:
      previousExercise.pain != null && Number.isFinite(Number(previousExercise.pain))
        ? Number(previousExercise.pain)
        : null,
    difficulty: (previousExercise.difficulty as PreviousPerformance["difficulty"]) ?? null,
    sets: ((setRows ?? []) as any[])
      .map((row) => ({
        set_index: Number(row.set_index ?? 0),
        reps: Number(row.reps ?? 0),
        weight: Number(row.weight ?? 0),
        rir: row.rir != null ? Number(row.rir) : null,
        pain: row.pain != null ? Number(row.pain) : null,
        form: row.form != null ? Number(row.form) : null,
      }))
      .filter((row) => row.set_index > 0)
      .sort((a, b) => a.set_index - b.set_index),
  };
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

function usableRir(rir: number | null | undefined) {
  if (rir == null) return null;
  const value = Number(rir);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function loadIncrementForExercise(exercise: any, currentWeight: number) {
  const text = [
    exercise?.name,
    ...(Array.isArray(exercise?.equipment) ? exercise.equipment : []),
    ...(Array.isArray(exercise?.primary_muscles) ? exercise.primary_muscles : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/leg press|hack squat|squat|deadlift|hip thrust|calf press/.test(text)) return 10;
  if (/barbell/.test(text) && currentWeight >= 95) return 10;
  return 5;
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

function roundDownToIncrement(value: number, increment = 5) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.max(increment, Math.floor(value / increment) * increment);
}

function primaryWorkingWeight(sets: PreviousSetRow[]) {
  const valid = sets.filter((set) => set.weight > 0 && set.reps > 0);
  if (!valid.length) return 0;

  const counts = new Map<number, number>();
  for (const set of valid) counts.set(set.weight, (counts.get(set.weight) ?? 0) + 1);

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? valid[0].weight;
}

async function loadExerciseHistoryStats(params: {
  exerciseId: string;
  currentWorkoutId: string;
}): Promise<ExerciseHistoryStats> {
  const { exerciseId, currentWorkoutId } = params;
  if (!exerciseId) return emptyHistoryStats();

  const { data: u, error: uErr } = await supabase.auth.getUser();
  if (uErr) throw uErr;
  if (!u.user) return emptyHistoryStats();

  const { data: exerciseRows, error: exerciseErr } = await supabase
    .from("workout_exercises")
    .select("id,workout_id")
    .eq("exercise_id", exerciseId)
    .neq("workout_id", currentWorkoutId)
    .limit(250);

  if (exerciseErr) throw exerciseErr;

  const rows = (exerciseRows ?? []) as Array<{ id: string; workout_id: string }>;
  if (!rows.length) return emptyHistoryStats();

  const workoutIds = Array.from(new Set(rows.map((row) => row.workout_id).filter(Boolean)));
  const completedWorkouts: any[] = [];
  for (const chunk of chunkValues(workoutIds)) {
    const { data, error } = await supabase
      .from("workouts")
      .select("id")
      .eq("user_id", u.user.id)
      .in("id", chunk)
      .not("completed_at", "is", null);
    if (error) throw error;
    completedWorkouts.push(...(data ?? []));
  }

  const completedIds = new Set(completedWorkouts.map((row: any) => row.id));
  const completedExerciseRows = rows.filter((row) => completedIds.has(row.workout_id));
  if (!completedExerciseRows.length) return emptyHistoryStats();

  const workoutExerciseIds = completedExerciseRows.map((row) => row.id);
  const workoutByExercise = new Map(completedExerciseRows.map((row) => [row.id, row.workout_id]));

  const setRows: any[] = [];
  for (const chunk of chunkValues(workoutExerciseIds)) {
    const { data, error } = await supabase
      .from("workout_sets")
      .select("workout_exercise_id,set_index,reps,weight")
      .in("workout_exercise_id", chunk);
    if (error) throw error;
    setRows.push(...(data ?? []));
  }

  const stats = emptyHistoryStats();
  stats.sessions = completedIds.size;
  const sessionVolumes = new Map<string, number>();

  for (const row of setRows ?? []) {
    const reps = Number((row as any).reps ?? 0);
    const weight = Number((row as any).weight ?? 0);
    if (!(reps > 0) || !(weight > 0)) continue;

    const volume = reps * weight;
    const e1rm = estimatedOneRepMax(weight, reps);
    const weightKey = String(Number(weight.toFixed(2)));
    const workoutId = workoutByExercise.get((row as any).workout_exercise_id);

    stats.bestWeight = Math.max(stats.bestWeight, weight);
    if (e1rm >= stats.bestEstimated1RM) {
      stats.bestSetWeight = weight;
      stats.bestSetReps = reps;
    }
    stats.bestSetVolume = Math.max(stats.bestSetVolume, volume);
    stats.bestEstimated1RM = Math.max(stats.bestEstimated1RM, e1rm);
    stats.maxRepsByWeight[weightKey] = Math.max(stats.maxRepsByWeight[weightKey] ?? 0, reps);

    if (workoutId) {
      sessionVolumes.set(workoutId, (sessionVolumes.get(workoutId) ?? 0) + volume);
    }
  }

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

function progressionGuidance(
  previous: PreviousPerformance | null,
  history: ExerciseHistoryStats,
  repMin: number,
  repMax: number,
  setsTarget: number,
  exercise: any
): ProgressionGuidance {
  const confidence = confidenceForSessions(history.sessions);
  const bestSetSummary =
    history.bestSetWeight > 0 && history.bestSetReps > 0
      ? `${formatLoggedWeight(history.bestSetWeight)} lb × ${history.bestSetReps}`
      : "No data yet";

  if (!previous?.sets.length) {
    return {
      tone: "first",
      decision: "BASELINE",
      title: "Establish your baseline",
      action: "CHOOSE A CONTROLLED STARTING WEIGHT",
      why: "No completed performance exists for this exact exercise. Log clean working sets so the coach can calculate a precise load change next time.",
      target: `${setsTarget} sets × ${repMin}-${repMax} reps • Rest 60 seconds`,
      lastSummary: "No data yet",
      bestSetSummary,
      trend: "Baseline",
      suggestedWeight: null,
      exactChange: "FIRST SESSION",
      confidence: confidence.level,
      confidenceDetail: confidence.detail,
      confidenceScore: confidence.score,
    };
  }

  const validSets = previous.sets.filter((set) => set.reps > 0 && set.weight > 0);
  if (!validSets.length) {
    return {
      tone: "first",
      decision: "BASELINE",
      title: "Build the first usable performance",
      action: "LOG EVERY WORKING SET",
      why: "The previous session did not contain complete weight-and-rep data.",
      target: `${setsTarget} sets × ${repMin}-${repMax} reps • Rest 60 seconds`,
      lastSummary: "Previous data incomplete",
      bestSetSummary,
      trend: "Baseline",
      suggestedWeight: null,
      exactChange: "NO LOAD DECISION",
      confidence: confidence.level,
      confidenceDetail: confidence.detail,
      confidenceScore: confidence.score,
    };
  }

  const workingWeight = primaryWorkingWeight(validSets);
  const increment = loadIncrementForExercise(exercise, workingWeight);
  const totalReps = validSets.reduce((sum, set) => sum + set.reps, 0);
  const allAtLeastMinimum = validSets.length >= setsTarget && validSets.every((set) => set.reps >= repMin);
  const allReachedTop = validSets.length >= setsTarget && validSets.every((set) => set.reps >= repMax);
  const belowMinimum = validSets.filter((set) => set.reps < repMin).length;
  const usableEfforts = validSets
    .map((set) => usableRir(set.rir))
    .filter((value): value is number => value != null);
  const averageRir = usableEfforts.length
    ? usableEfforts.reduce((sum, value) => sum + value, 0) / usableEfforts.length
    : null;
  const firstRir = usableRir(validSets[0]?.rir);
  const finalRir = usableRir(validSets[validSets.length - 1]?.rir);
  const pain = Number(previous.pain ?? 0);
  const tooHard = previous.difficulty === "too_hard";
  const lastSummary = `${formatLoggedWeight(workingWeight)} lb • ${validSets
    .map((set) => set.reps)
    .join(" / ")} reps`;
  const previousBestE1rm = Math.max(
    0,
    ...validSets.map((set) => estimatedOneRepMax(set.weight, set.reps))
  );
  const trend =
    history.sessions <= 1
      ? "Building"
      : previousBestE1rm >= history.bestEstimated1RM * 0.985
      ? "Improving"
      : "Steady";

  if (pain >= 7) {
    const reduced = roundDownToIncrement(workingWeight * 0.9, increment);
    const change = Math.max(0, workingWeight - reduced);
    return {
      tone: "review",
      decision: "DELOAD",
      title: "Pain overrides progression",
      action: reduced > 0 ? `REDUCE TO ${formatLoggedWeight(reduced)} LB` : "STOP OR SWAP THE EXERCISE",
      why: `The last performance recorded pain ${pain}/10. Reduce the load or use a pain-free variation before progressing.`,
      target: `${setsTarget} controlled sets × ${repMin}-${repMax} reps • Rest 60 seconds`,
      lastSummary,
      bestSetSummary,
      trend: "Needs review",
      suggestedWeight: reduced || null,
      exactChange: change > 0 ? `−${formatLoggedWeight(change)} LB` : "PAIN-FIRST ADJUSTMENT",
      confidence: confidence.level,
      confidenceDetail: confidence.detail,
      confidenceScore: confidence.score,
    };
  }

  const majorFailure =
    belowMinimum >= Math.max(1, Math.ceil(validSets.length / 2)) ||
    (firstRir != null && firstRir <= 1 && belowMinimum > 0);

  if (majorFailure || tooHard || pain >= 3) {
    const reductionRate = majorFailure || pain >= 5 ? 0.9 : 0.95;
    const reduced = roundDownToIncrement(workingWeight * reductionRate, increment);
    const change = Math.max(increment, workingWeight - reduced);
    return {
      tone: "review",
      decision: "DELOAD",
      title: "Reduce the load and restore clean reps",
      action: `REDUCE TO ${formatLoggedWeight(reduced)} LB`,
      why:
        pain >= 3
          ? `The last performance recorded pain ${pain}/10.`
          : tooHard
          ? "The last performance was marked too hard."
          : `${belowMinimum} working set${belowMinimum === 1 ? "" : "s"} fell below the programmed rep range.`,
      target: `${setsTarget} sets × ${repMin}-${Math.min(repMax, repMin + 2)} reps • Rest 60 seconds`,
      lastSummary,
      bestSetSummary,
      trend: "Reduce and rebuild",
      suggestedWeight: reduced,
      exactChange: `−${formatLoggedWeight(change)} LB`,
      confidence: confidence.level,
      confidenceDetail: confidence.detail,
      confidenceScore: confidence.score,
    };
  }

  if (allReachedTop && (finalRir == null || finalRir >= 2) && (averageRir == null || averageRir >= 2)) {
    const suggested = roundToIncrement(workingWeight + increment, increment);
    return {
      tone: "increase",
      decision: "PROGRESS",
      title: "Ready to progress",
      action: `INCREASE TO ${formatLoggedWeight(suggested)} LB`,
      why: `All ${setsTarget} working sets reached the top of the ${repMin}-${repMax} range without finishing near maximum effort.`,
      target: `${setsTarget} sets × ${repMin}-${Math.min(repMax, repMin + 2)} reps • Rest 60 seconds`,
      lastSummary,
      bestSetSummary,
      trend,
      suggestedWeight: suggested,
      exactChange: `+${formatLoggedWeight(increment)} LB`,
      confidence: confidence.level,
      confidenceDetail: confidence.detail,
      confidenceScore: confidence.score,
    };
  }

  if (allAtLeastMinimum && finalRir != null && finalRir <= 1) {
    return {
      tone: "repeat",
      decision: "HOLD",
      title: "Good working weight",
      action: `HOLD AT ${formatLoggedWeight(workingWeight)} LB`,
      why: "You completed the programmed work, but the final set was very hard. Keep the load and improve total reps or control before increasing.",
      target: `Add 1-2 total clean reps across ${setsTarget} sets • Rest 60 seconds`,
      lastSummary,
      bestSetSummary,
      trend: "Building capacity",
      suggestedWeight: workingWeight,
      exactChange: "NO LOAD CHANGE",
      confidence: confidence.level,
      confidenceDetail: confidence.detail,
      confidenceScore: confidence.score,
    };
  }

  const nextRepGoal = totalReps + Math.max(1, Math.min(2, setsTarget));
  return {
    tone: "repeat",
    decision: averageRir != null && averageRir <= 1 ? "MONITOR" : "HOLD",
    title: "Own the current weight",
    action: `HOLD AT ${formatLoggedWeight(workingWeight)} LB`,
    why: "The current load still has productive reps available before a weight increase is justified.",
    target: `Aim for ${nextRepGoal} total reps across ${setsTarget} sets • Rest 60 seconds`,
    lastSummary,
    bestSetSummary,
    trend,
    suggestedWeight: workingWeight,
    exactChange: "NO LOAD CHANGE",
    confidence: confidence.level,
    confidenceDetail: confidence.detail,
    confidenceScore: confidence.score,
  };
}

type LiveSetAdvice = {
  status: string;
  tone: "good" | "hold" | "monitor" | "reduce";
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
  const rir = selectedEffort?.rir;
  const increment = loadIncrementForExercise(exercise, weight);
  const summary = `${formatLoggedWeight(weight)} lb × ${reps} reps • ${effortLabel(set.rir, set.effort_key)}`;

  if (rir === 0) {
    const reduced = roundDownToIncrement(weight * 0.95, increment);
    return {
      status: "MAXIMUM EFFORT",
      tone: "reduce",
      summary,
      nextInstruction: `Reduce to ${formatLoggedWeight(reduced)} lb and target ${repMin}-${Math.min(repMax, repMin + 1)} clean reps. Rest 60 seconds.`,
      nextWeight: reduced,
    };
  }

  if (rir === 1) {
    return {
      status: "VERY HARD",
      tone: "monitor",
      summary,
      nextInstruction: `Keep ${formatLoggedWeight(weight)} lb and target ${repMin}-${Math.min(repMax, reps)} clean reps. Rest 60 seconds.`,
      nextWeight: weight,
    };
  }

  if (rir === 2) {
    return {
      status: "TARGET REACHED",
      tone: "good",
      summary,
      nextInstruction: `Keep ${formatLoggedWeight(weight)} lb and target ${Math.max(repMin, reps - 1)}-${Math.min(repMax, reps)} clean reps. Rest 60 seconds.`,
      nextWeight: weight,
    };
  }

  if (rir != null && rir >= 3) {
    return {
      status: "CONTROLLED SET",
      tone: "good",
      summary,
      nextInstruction: `Keep ${formatLoggedWeight(weight)} lb and aim for ${Math.min(repMax, reps + 1)} clean reps. Rest 60 seconds.`,
      nextWeight: weight,
    };
  }

  return {
    status: "EFFORT NOT RATED",
    tone: "hold",
    summary,
    nextInstruction: `Keep ${formatLoggedWeight(weight)} lb and stay inside ${repMin}-${repMax} clean reps. Rest 60 seconds.`,
    nextWeight: weight,
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

const REST_TIMER_STORAGE_KEY = "mvp_rest_timer_v2";

function emptyRestTimer(): RestTimerState {
  return {
    status: "idle",
    totalSeconds: 0,
    remainingSeconds: 0,
    deadlineMs: null,
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

      return {
        ...normalized,
        remainingSeconds: remaining,
        status: remaining > 0 ? "running" : "finished",
        deadlineMs: remaining > 0 ? normalized.deadlineMs : null,
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

      if (timer.status === "idle") {
        localStorage.removeItem(REST_TIMER_STORAGE_KEY);
      } else {
        localStorage.setItem(REST_TIMER_STORAGE_KEY, JSON.stringify(timer));
      }
    } catch {
      // Timer persistence is helpful but not required.
    }
  }, [timer]);

  useEffect(() => {
    if (timer.status !== "running" || !timer.deadlineMs) return;

    const tick = () => {
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
          };
        }

        if (remaining === current.remainingSeconds) return current;
        return { ...current, remainingSeconds: remaining };
      });
    };

    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
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

    const dismissId = window.setTimeout(() => {
      setTimer(emptyRestTimer());
    }, 1600);

    return () => window.clearTimeout(dismissId);
  }, [timer.status]);

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
        ? Math.max(
            0,
            Math.ceil((current.deadlineMs - Date.now()) / 1000)
          )
        : current.remainingSeconds;

      const nextRemaining = Math.max(0, currentRemaining + seconds);

      if (nextRemaining <= 0) {
        return {
          ...current,
          status: "finished",
          remainingSeconds: 0,
          deadlineMs: null,
        };
      }

      return {
        ...current,
        remainingSeconds: nextRemaining,
        deadlineMs: Date.now() + nextRemaining * 1000,
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

  const finished = timer.status === "finished";
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
    <div className="tr-restTimerOverlay" role="presentation">
      <section
        className={`tr-restTimerDock tr-restTimerDock--pro ${
          finished ? "is-finished" : ""
        } ${finalTen ? "is-final-ten" : ""} ${
          finalThree ? "is-final-three" : ""
        }`}
        role="timer"
        aria-live="polite"
        aria-label={
          finished
            ? `Rest complete. ${setLabel} ready.`
            : `${formatRestClock(timer.remainingSeconds)} remaining in rest period.`
        }
      >
        <div className="tr-restTimerTop">
          <div className="tr-restTimerIdentity">
            <div className="tr-restTimerKicker">
              {finished ? "REST COMPLETE" : "REST PERIOD"}
            </div>
            <div className="tr-restTimerExercise">
              {finished
                ? `${setLabel} READY`
                : `${timer.exerciseName || "Exercise"} • Recovery`}
            </div>
          </div>

          <div className="tr-restTimerRestTarget">60 SEC TARGET</div>
        </div>

        <div className="tr-restTimerClockWrap">
          <div className="tr-restTimerClock">
            {formatRestClock(timer.remainingSeconds)}
          </div>
          <div className="tr-restTimerClockCaption">
            {finished
              ? "NEXT SET IS READY"
              : finalTen
                ? "FINAL COUNTDOWN"
                : "BREATHE • RESET • PREPARE"}
          </div>
        </div>

        <div
          className="tr-restTimerProgressTrack"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={timer.totalSeconds || 60}
          aria-valuenow={Math.max(
            0,
            (timer.totalSeconds || 60) - timer.remainingSeconds
          )}
        >
          <span style={{ width: `${progress}%` }} />
        </div>

        <div className="tr-restTimerNext">
          <div>
            <span>NEXT SET</span>
            <strong>{setLabel}</strong>
          </div>

          <p>
            {cleanInstruction ||
              "Return to the prescribed working weight and complete clean, controlled reps."}
          </p>

          <div className="tr-restTimerNextMeta">
            <span>REST 60 SECONDS</span>
            <span>AUTO-CLOSES AT ZERO</span>
          </div>
        </div>

        {!finished ? (
          <div className="tr-restTimerActions tr-restTimerActions--simple">
            <button
              type="button"
              onClick={() => timer.addSeconds(-15)}
              disabled={timer.remainingSeconds <= 15}
            >
              −15 SEC
            </button>

            <button
              type="button"
              onClick={() => timer.addSeconds(15)}
            >
              +15 SEC
            </button>

            <button
              type="button"
              className="tr-restTimerSkip"
              onClick={timer.skip}
            >
              SKIP REST
            </button>
          </div>
        ) : (
          <div className="tr-restTimerReady">
            <span aria-hidden="true">✓</span>
            OPENING {setLabel}
          </div>
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

  const [editing, setEditing] = useState(false);
  const [createExerciseOpen, setCreateExerciseOpen] = useState(false);

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
  const [goal, setGoal] = useState<string | null>(null);
  const [goalMode, setGoalMode] = useState<string | null>(null);
  const [symptomKey, setSymptomKey] = useState<SymptomKey | null>(null);

  const [completeOverlayOpen, setCompleteOverlayOpen] = useState(false);
  const restTimer = useRestTimer();

  useEffect(() => {
    void preloadWorkoutAlerts();
  }, []);

  const doneCount = useMemo(() => items.filter((x) => !!x.completed_at).length, [items]);
  const current = items[activeIdx];

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
    } catch {}
  }, [sessionId, workoutId, current?.exercise?.name, current?.exercise_id, activeIdx, items.length]);

  async function loadSessionLabelContext() {
    try {
      const { data: u, error: uErr } = await supabase.auth.getUser();
      if (uErr) throw uErr;
      if (!u.user) return;

      const { data: ss, error: ssErr } = await supabase
        .from("scheduled_sessions")
        .select("id, session_type, program_block_id")
        .eq("id", sessionId)
        .maybeSingle();

      if (ssErr) throw ssErr;

      setSessionType((ss as any)?.session_type ?? null);

      const { data: ab, error: abErr } = await supabase
        .from("program_blocks")
        .select("id, goal, goal_mode")
        .eq("user_id", u.user.id)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (abErr) throw abErr;

      const g = (ab as any)?.goal ?? null;
      const gm = (ab as any)?.goal_mode ?? null;
      setGoal(g);
      setGoalMode(gm);

      if (isSymptomMode(gm)) {
        const { data: intake } = await supabase
          .from("intake_snapshots")
          .select("symptoms, created_at")
          .eq("user_id", u.user.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        setSymptomKey(inferSymptomKey((intake as any)?.symptoms ?? null));
      } else {
        setSymptomKey(null);
      }
    } catch {}
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

    setItems(loaded);
    setActiveIdx(0);

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

      const suggested =
        (wData as any)?.bodyweight_lb != null
          ? String((wData as any).bodyweight_lb)
          : "";
      setGateWeight(suggested);

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

        const { data: ab } = await supabase
          .from("program_blocks")
          .select("goal")
          .eq("user_id", u.user.id)
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const goal = (ab?.goal as string) ?? null;
        setProteinTarget(bw && bw > 0 ? roundProtein(bw * proteinMultiplier(goal)) : null);

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

      if (!workoutStartAlertPlayedRef.current) {
        workoutStartAlertPlayedRef.current = true;
        void playWorkoutAlert("workout_start");
      }

      setGateOpen(false);
      setStartedWeight(w);

      const { data: ab } = await supabase
        .from("program_blocks")
        .select("goal")
        .eq("user_id", u.user.id)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const goal = (ab?.goal as string) ?? null;
      setProteinTarget(w > 0 ? roundProtein(w * proteinMultiplier(goal)) : null);

      await hydrateAfterStart(workoutId);
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
      setSearchHasMore(baseDecorated.length > EDIT_RESULTS_BATCH_SIZE);

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
        setSearchHasMore(enhanced.length > EDIT_RESULTS_BATCH_SIZE);
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
        const nextVisibleCount = (next + 1) * EDIT_RESULTS_BATCH_SIZE;
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
  const nextIncompleteIndex = items.findIndex(
    (row, index) => index > activeIdx && !row.completed_at
  );
  const nextIncomplete =
    nextIncompleteIndex >= 0 ? items[nextIncompleteIndex] : null;
  const nextIncompleteName =
    nextIncomplete?.exercise?.name ??
    nextIncomplete?.exercise?.title ??
    (sessionComplete ? "Workout complete" : "End of workout");
  const progressPercent = items.length
    ? Math.round((doneCount / items.length) * 100)
    : 0;

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
            <button className="tr-btn" onClick={() => (window.location.pathname = "/")}>
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
        <Card title="Start Workout" tone="blue">
          <div className="tr-rowbox" style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "grid", gap: 4 }}>
              <div className="tr-kicker">WEIGHT (LB) — REQUIRED</div>
              <div className="tr-sub">Enter your weight to start. Timer begins only after you start.</div>
            </div>

            <input
              value={gateWeight}
              onChange={(e) => setGateWeight(e.target.value.replace(/[^\d.]/g, ""))}
              placeholder="e.g. 185"
              style={{ height: 52, width: "min(320px, 100%)", fontSize: 18, fontWeight: 950 }}
              inputMode="decimal"
              autoFocus
            />

            <button className="tr-btn tr-btn--primary" style={{ height: 56 }} onClick={startWorkoutNow}>
              START WORKOUT
            </button>

            <button className="tr-btn" onClick={() => (window.location.pathname = "/")}>
              Cancel
            </button>
          </div>
        </Card>
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

      <div className="tr-workoutCheckinCard">
        <Card title="Session Check-in" tone="blue">
          <div className="tr-rowbox">
            <div className="tr-checkinGrid tr-checkinGrid--tight">
            <div className="tr-checkinTile tr-checkinTile--tight">
              <div className="tr-kicker">WEIGHT (LB)</div>
              <div className="tr-checkinValue tr-checkinValue--tight">
                {startedWeight != null ? `${startedWeight} lb` : "Not set"}
              </div>
            </div>

            <div className="tr-checkinTile tr-checkinTile--tight">
              <div className="tr-kicker">PROTEIN TARGET</div>
              <div className="tr-checkinValue tr-checkinValue--tight">
                {proteinTarget != null ? `${proteinTarget}g` : "Not set"}
              </div>
            </div>
            </div>
          </div>
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
              aria-label="Previous exercise"
            >
              <span aria-hidden="true">←</span>
              <strong>Prev</strong>
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

              <div className="tr-sessionNextLine">
                <span>NEXT</span>
                <strong>{nextIncompleteName}</strong>
              </div>
            </div>

            <button
              type="button"
              className="tr-sessionNavButton is-next"
              onClick={next}
              disabled={atLast}
              aria-label="Next exercise"
            >
              <strong>Next</strong>
              <span aria-hidden="true">→</span>
            </button>
          </div>

          <section className="tr-exerciseProgressPanel" aria-label="Exercise progress">
            <div className="tr-exerciseProgressHeader">
              <div>
                <div className="tr-kicker">EXERCISE PROGRESS</div>
              </div>

              <div className="tr-exerciseProgressCount">
                <strong>{doneCount}</strong>
                <span>/ {items.length} COMPLETE</span>
              </div>
            </div>

            <div
              className="tr-exerciseProgressTrack"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={items.length || 1}
              aria-valuenow={doneCount}
              aria-label={`${doneCount} of ${items.length} exercises complete`}
            >
              <span style={{ width: `${progressPercent}%` }} />
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
                    }`}
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
        <ExerciseRunner
          workoutExercise={current}
          item={currentRunnerItem}
          onChanged={reloadWorkoutExercisesKeepIndex}
          onExerciseCompleted={handleExerciseCompleted}
          showToast={showToast}
          exerciseIndex={activeIdx + 1}
          totalExercises={items.length}
          sessionComplete={sessionComplete}
          onStartRest={restTimer.start}
        />
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
    searchResults={searchResults.slice(0, (searchPage + 1) * EDIT_RESULTS_BATCH_SIZE)}
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

  function handleResultsScroll(event: React.UIEvent<HTMLDivElement>) {
    if (!searchHasMore || searchBusy || searchLoadingMore) return;
    const viewport = event.currentTarget;
    const remaining = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    if (remaining <= 180) void onLoadMore();
  }

  function selectBroadMuscle(nextMuscle: AddMuscleKey) {
    setAddMuscle(nextMuscle);
    setAddMuscleDetail("all");
  }

  const dangerStyle: React.CSSProperties = {
    height: 36,
    borderRadius: 12,
    border: "1px solid rgba(255,140,0,.55)",
    background: "linear-gradient(180deg, rgba(255,140,0,.26), rgba(255,80,80,.12))",
    color: "rgba(255,255,255,.92)",
    fontWeight: 950,
    letterSpacing: ".10em",
    textTransform: "uppercase",
    cursor: "pointer",
    padding: "0 12px",
  };

  function iconForWe(we: WorkoutExerciseRow) {
    const ex = we.exercise || {};
    const ic = resolveRowIcon(ex);
    return ic.icon ? <img className="tr-ico" src={ic.icon} alt={ic.alt} /> : null;
  }

  const showResultsEmptyState =
    !searchBusy &&
    !searchError &&
    !searchResults.length;

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="tr-modalOverlay tr-modalOverlay--locked" role="dialog" aria-modal="true" aria-label="Edit session">
      <div className={`tr-modal tr-modal--viewport tr-editModal tr-editModal--sessionPicker tr-editModal--mobile-${mobileTab}`}>
        <div className="tr-modalHead">
          <div style={{ fontWeight: 950 }}>
            Edit Session <span className="tr-sub">({items.length})</span>
          </div>

          <div className="tr-editModalActions" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button className="tr-btn tr-btn--primary" onClick={onSaveSessionOnly}>
              Save (this session)
            </button>
            <button className="tr-btn" onClick={onSaveAllFuture}>
              Save to all future sessions
            </button>
            <button className="tr-btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div className="tr-modalBody tr-editModalBody">
          <div className="tr-editMobileTabs" role="tablist" aria-label="Edit session sections">
            <button
              type="button"
              role="tab"
              aria-selected={mobileTab === "current"}
              className={`tr-seg ${mobileTab === "current" ? "is-active" : ""}`}
              onClick={() => setMobileTab("current")}
            >
              Current Session ({items.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mobileTab === "add"}
              className={`tr-seg ${mobileTab === "add" ? "is-active" : ""}`}
              onClick={() => setMobileTab("add")}
            >
              {mode === "swap" ? "Pick Replacement" : "Add Exercise"}
            </button>
          </div>

          <div className="tr-editCurrentPanel">
          <Card title="Current session exercises" tone="base">
            <div className="tr-editCurrentList">
              {items.map((we, idx) => (
                <div key={we.id} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, alignItems: "center" }}>
                  <div style={{ display: "grid", gap: 4 }}>
                    <div style={{ fontWeight: 950, display: "flex", gap: 10, alignItems: "center" }}>
                      {iconForWe(we)}
                      {idx + 1}. {we.exercise?.name ?? we.exercise_id}
                    </div>
                    <div className="tr-sub">
                      {we.prescription_snapshot?.sets ?? "—"} sets • {we.prescription_snapshot?.rep_min ?? "—"}-
                      {we.prescription_snapshot?.rep_max ?? "—"} reps
                    </div>
                  </div>

                  <button className={`tr-seg ${swapTargetWeId === we.id ? "is-active" : ""}`} onClick={() => handleSwap(we.id)}>
                    Swap
                  </button>

                  <button style={dangerStyle} onClick={() => onDelete(we.id)}>
                    Delete
                  </button>
                </div>
              ))}
              {!items.length ? <div className="tr-sub">No exercises yet.</div> : null}
            </div>
          </Card>
          </div>

          <div className="tr-editAddPanel">
          <Card title={mode === "swap" ? "Pick replacement" : "Add an exercise"} tone="blue">
            <div className="tr-editAddLayout" style={{ display: "grid", gap: 10 }}>
              <div className="tr-mobileExercisePickerBar">
                {mode === "add" ? (
                  <button
                    type="button"
                    className={`tr-btn ${mobileFiltersOpen ? "tr-btn--primary" : "tr-btn--blueOutline"}`}
                    onClick={() => setMobileFiltersOpen((value) => !value)}
                    aria-expanded={mobileFiltersOpen}
                  >
                    {mobileFiltersOpen ? "Hide Filters" : "Filters"}
                  </button>
                ) : <span />}
                <button type="button" className="tr-btn tr-btn--blueOutline" onClick={onCreateNew}>
                  + New Exercise
                </button>
              </div>

              {mode === "add" ? (
                <div className={`tr-rowbox tr-editFilterScroll ${mobileFiltersOpen ? "is-open" : "is-collapsed"}`} style={{ display: "grid", gap: 10 }}>
                  <div className="tr-createInlineBar">
                    <div>
                      <div className="tr-kicker">CUSTOM EXERCISE</div>
                      <div className="tr-sub">Create it with defaults and media, then add it now.</div>
                    </div>
                    <button
                      type="button"
                      className="tr-btn tr-btn--blueOutline"
                      onClick={onCreateNew}
                    >
                      + Create New Exercise
                    </button>
                  </div>

                  <div style={{ display: "grid", gap: 6 }}>
                    <div className="tr-kicker">MUSCLE</div>
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

                    <div className="tr-sub">Muscle ignored in cardio mode (per contract).</div>
                  </div>

                  <div style={{ display: "grid", gap: 6 }}>
                    <div className="tr-kicker">EQUIPMENT</div>
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
                </div>
              ) : null}

              <input value={searchQ} onChange={(e) => onSearch(e.target.value)} placeholder="Search exercises…" style={{ height: 44 }} />

              <div className="tr-sub">
                {searchBusy ? "Searching…" : mode === "swap" ? "Pick an exercise to swap in." : "Pick an exercise to add."}
              </div>

              <div className="tr-editResultsViewport" onScroll={handleResultsScroll}>
                {searchResults.map((r) => (
                  <button
                    key={r.id}
                    className="tr-rowBtn"
                    onClick={() => (mode === "swap" ? onPickSwap(r.id) : onPickAdd(r.id))}
                  >
                    <div className="tr-rowbox" style={{ display: "grid", gap: 6 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                        <div style={{ display: "grid", gap: 4 }}>
                          <div style={{ fontWeight: 950, display: "flex", gap: 10, alignItems: "center" }}>
                            {r.icon ? <img className="tr-ico" src={r.icon} alt={r.iconAlt || ""} /> : null}
                            {r.name}
                          </div>
                        </div>

                        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                          {r.effectiveHasMedia ? (
                            <div className="tr-pillOK" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                              <CheckIcon />
                              OK
                            </div>
                          ) : (
                            <div className="tr-pillMISS" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                              <AlertIcon />
                              MISSING
                            </div>
                          )}

                          {mode === "add" ? (
                            <span className={`tr-addedBadge ${justAddedId === r.id ? "is-on" : ""}`}>
                              {justAddedId === r.id ? "ADDED" : "ADD"}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div className="tr-sub">
                        {(Array.isArray(r.primary_muscles) && r.primary_muscles.length ? r.primary_muscles.join(", ") : "—")} •{" "}
                        {(Array.isArray(r.equipment) && r.equipment.length ? r.equipment.join(", ") : "—")} • {r.source ?? "—"}
                      </div>
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
                      Retry
                    </button>
                  </div>
                ) : null}

                {showResultsEmptyState ? (
                  <div className="tr-pickerStatus">No exercises match these filters.</div>
                ) : null}

              </div>
            </div>
          </Card>
          </div>
        </div>

        <div className="tr-modalFooter tr-modalFooter--center tr-editModalFooter">
          <button
            type="button"
            className="tr-btn tr-btn--primary tr-editFooterCurrentAction"
            style={{ height: 46, minWidth: 240 }}
            onClick={() => setMobileTab("add")}
          >
            Add Exercise
          </button>

          <button
            type="button"
            className="tr-btn tr-btn--primary tr-editFooterLoadMore"
            style={{ height: 46, minWidth: 240 }}
            onClick={onLoadMore}
            disabled={!searchHasMore || searchBusy || searchLoadingMore}
          >
            {searchLoadingMore ? "Loading…" : "Load more exercises"}
          </button>
        </div>
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
          }),
          loadExerciseHistoryStats({
            exerciseId,
            currentWorkoutId: workoutExercise.workout_id,
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

        const suggestedStart = progressionGuidance(previous, history, repMin, repMax, setsTarget, item).suggestedWeight;
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
  }, [weId, exerciseId, workoutExercise.workout_id, setsTarget, timed]);

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
    () => progressionGuidance(previousPerformance, historyStats, repMin, repMax, setsTarget, item),
    [previousPerformance, historyStats, repMin, repMax, setsTarget, item]
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

  const readyToLock = painTouched && (timed || allSetsLogged);
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
    const prs = detectPersonalRecords({ reps, weight }, historyStats);

    if (prs.length) {
      showToast(`NEW PR • ${prs.join(" • ")}`, "ok");
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

  if (!painTouched) {
    showToast("LOG PAIN BEFORE LOCKING DONE.", "err");
    return;
  }

  if (!timed && !allSetsLogged) {
    showToast("COMPLETE EVERY SET WITH WEIGHT, REPS, AND AN EFFORT RATING.", "err");
    return;
  }

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
  const warmupPlan = buildWarmupPlan(calculatorWeight);
  const plateLoad = calculatePlateLoad(calculatorWeight, barWeight);

  return (
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
      <div className="tr-exerciseTopMeta">
        <div className="tr-exerciseSummaryLine">
          {timed ? (
            <>Duration {prescribedMins} min</>
          ) : (
            <>
              {setsTarget} sets • {repMin}-{repMax} reps • Rest {restSeconds}s
            </>
          )}
        </div>
      </div>

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

            {!painTouched && !isDone ? (
              <div className="tr-painRequired">
                Required: move the slider once (even if you leave it at 0).
              </div>
            ) : null}
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
                  <div className="tr-workingSetsTitle">{setsTarget} × {repMin}-{repMax} REPS • 60 SEC REST</div>
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
                      {previousGuidance.decision}
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
                              <span>REP TARGET</span>
                              <strong>{previousGuidance.target}</strong>
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
                            onClick={() => (window.location.pathname = `/library/${exerciseId}`)}
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

              <div className={`tr-trainingCalculator ${calculatorOpen ? "is-open" : ""}`}>
                <button
                  type="button"
                  className="tr-trainingCalculatorToggle"
                  onClick={() => setCalculatorOpen((value) => !value)}
                >
                  <span>
                    <span className="tr-kicker">TRAINING TOOLS</span>
                    <strong>Warm-up + Barbell Plate Calculator</strong>
                  </span>
                  <span>{calculatorOpen ? "CLOSE" : "OPEN"}</span>
                </button>

                {calculatorOpen ? (
                  <div className="tr-trainingCalculatorBody">
                    <div className="tr-calculatorControls">
                      <label>
                        <span className="tr-kicker">WORKING WEIGHT</span>
                        <input
                          value={calculatorWeight || ""}
                          inputMode="decimal"
                          onChange={(event: any) => {
                            const value = Number(event.target.value.replace(/[^\d.]/g, ""));
                            setCalculatorWeight(Number.isFinite(value) ? Math.max(0, value) : 0);
                          }}
                          placeholder="Enter weight"
                        />
                      </label>

                      <label>
                        <span className="tr-kicker">BAR WEIGHT</span>
                        <select value={barWeight} onChange={(event: any) => setBarWeight(Number(event.target.value))}>
                          <option value={45}>45 lb bar</option>
                          <option value={35}>35 lb bar</option>
                          <option value={15}>15 lb training bar</option>
                          <option value={0}>No bar / machine</option>
                        </select>
                      </label>
                    </div>

                    <div className="tr-calculatorGrid">
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

                      <div className="tr-calculatorPanel">
                        <div className="tr-kicker">PLATES PER SIDE</div>
                        {calculatorWeight > barWeight ? (
                          <>
                            <div className="tr-plateLoadValue">
                              {plateLoad.perSide.length
                                ? plateLoad.perSide.map((row) => `${row.count}×${row.plate}`).join(" + ")
                                : "No plates required"}
                            </div>
                            <div className="tr-sub">
                              Loaded total: {formatLoggedWeight(plateLoad.loadedWeight)} lb
                              {plateLoad.remainder > 0.01
                                ? ` • ${formatLoggedWeight(plateLoad.remainder)} lb below target with available plates`
                                : " • exact load"}
                            </div>
                          </>
                        ) : (
                          <div className="tr-sub">Working weight must be above the selected bar weight.</div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

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
  position:relative;
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
.tr-proCoach--progress::before{background:linear-gradient(180deg,#59f3a8,rgba(22,184,112,.18));}
.tr-proCoach--monitor::before{background:linear-gradient(180deg,#e4c678,rgba(193,148,44,.18));}
.tr-proCoach--deload::before{background:linear-gradient(180deg,#ff7584,rgba(207,55,77,.18));}
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
  display:block;
  color:rgba(250,253,255,.98);
  font-size:15px;
  font-weight:1100;
  letter-spacing:.14em;
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
  min-height:28px;
  padding:0 11px;
  border-radius:999px;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  border:1px solid rgba(0,190,255,.40);
  background:rgba(0,170,255,.10);
  color:rgba(206,245,255,.98);
  font-size:9px;
  font-weight:1100;
  letter-spacing:.14em;
}
.tr-proCoachDecision.is-progress{border-color:rgba(74,235,155,.44);background:rgba(40,205,130,.11);color:#a8ffd0;}
.tr-proCoachDecision.is-monitor{border-color:rgba(228,198,120,.44);background:rgba(205,165,65,.10);color:#f3dfaa;}
.tr-proCoachDecision.is-deload{border-color:rgba(255,102,120,.46);background:rgba(230,70,92,.11);color:#ffc1c9;}
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
.tr-proCoachCollapsedSummary strong{
  color:rgba(236,250,255,.96);
  font-size:13px;
  letter-spacing:.04em;
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
  color:rgba(246,253,255,.99);
  font-size:clamp(23px,3vw,36px);
  line-height:1.04;
  font-weight:1150;
  letter-spacing:.018em;
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
.tr-liveSetReview.is-reduce{border-color:rgba(255,102,120,.32);background:linear-gradient(180deg,rgba(225,64,84,.08),rgba(0,0,0,.15));}
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
  grid-template-columns:repeat(6,minmax(0,1fr));
  gap:7px;
  margin-top:11px;
}
.tr-effortOptions button{
  position:relative;
  min-height:58px;
  padding:8px 6px;
  border-radius:12px;
  border:1px solid rgba(255,255,255,.085);
  background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(0,0,0,.15));
  color:rgba(200,221,231,.78);
  display:grid;
  align-content:center;
  gap:4px;
  cursor:pointer;
  transition:transform .14s ease,border-color .14s ease,background .14s ease,box-shadow .14s ease;
}
.tr-effortOptions button:hover:not(:disabled){transform:translateY(-1px);border-color:rgba(0,190,255,.38);}
.tr-effortOptions button strong{font-size:9px;line-height:1.15;}
.tr-effortOptions button span{font-size:7px;color:rgba(155,184,197,.58);line-height:1.15;}
.tr-effortOptions button.is-target::after{
  content:"TARGET";
  position:absolute;
  top:-7px;
  left:50%;
  transform:translateX(-50%);
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
  margin-top:9px;
  min-height:38px;
  padding:9px 11px;
  border-radius:11px;
  border:1px solid rgba(255,255,255,.06);
  background:rgba(0,0,0,.15);
  display:flex;
  align-items:center;
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
  .tr-effortOptions button{min-height:49px;padding:7px 4px;border-radius:10px;}
  .tr-effortOptions button strong{font-size:7.5px;}
  .tr-effortOptions button span{font-size:6px;}
  .tr-effortExplanation{min-height:34px;padding:7px 8px;gap:6px;align-items:flex-start;}
  .tr-effortExplanation strong{font-size:7px;}
  .tr-effortExplanation span{font-size:7px;}
  .tr-workingSetComplete{min-height:51px;margin-top:11px;border-radius:13px;}
  .tr-workingSetComplete span{font-size:10px;}
  .tr-workingSetComplete small{font-size:7px;}
}

/* STEP 5 • PROFESSIONAL REST TIMER */
.tr-restTimerOverlay{
  position:fixed;
  inset:0;
  z-index:16000;
  display:grid;
  place-items:center;
  padding:clamp(18px,4vw,48px);
  background:rgba(2,7,11,.93);
  overscroll-behavior:none;
}

.tr-restTimerDock.tr-restTimerDock--pro{
  position:relative !important;
  inset:auto !important;
  left:auto !important;
  right:auto !important;
  top:auto !important;
  bottom:auto !important;
  transform:none !important;
  width:min(620px,100%) !important;
  max-width:620px !important;
  min-height:0 !important;
  margin:0 !important;
  padding:0 !important;
  display:grid !important;
  grid-template-columns:1fr !important;
  gap:0 !important;
  overflow:hidden !important;
  border:1px solid rgba(0,190,255,.50) !important;
  border-radius:26px !important;
  background:
    radial-gradient(circle at 50% -15%,rgba(0,174,255,.13),transparent 45%),
    linear-gradient(180deg,#0c1821 0%,#071018 54%,#050b10 100%) !important;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.10),
    inset 0 0 0 1px rgba(0,0,0,.58),
    0 30px 90px rgba(0,0,0,.70),
    0 0 48px rgba(0,170,255,.10) !important;
  backdrop-filter:none !important;
  -webkit-backdrop-filter:none !important;
  color:rgba(242,251,255,.98);
}

.tr-restTimerDock.tr-restTimerDock--pro::before{
  content:"";
  position:absolute;
  inset:0;
  pointer-events:none;
  background:
    linear-gradient(90deg,transparent,rgba(255,255,255,.035),transparent);
  opacity:.45;
}

.tr-restTimerTop{
  position:relative;
  z-index:1;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:18px;
  padding:22px 24px 16px;
  border-bottom:1px solid rgba(255,255,255,.065);
}

.tr-restTimerIdentity{
  min-width:0;
  display:grid;
  gap:5px;
}

.tr-restTimerKicker{
  color:#71dcff !important;
  font-size:11px !important;
  font-weight:1100 !important;
  letter-spacing:.18em !important;
  line-height:1 !important;
}

.tr-restTimerExercise{
  color:rgba(221,239,247,.74) !important;
  font-size:13px !important;
  font-weight:850 !important;
  letter-spacing:.03em !important;
  line-height:1.25 !important;
  white-space:normal !important;
}

.tr-restTimerRestTarget{
  flex:0 0 auto;
  min-height:30px;
  padding:0 10px;
  border:1px solid rgba(220,190,105,.32);
  border-radius:999px;
  background:rgba(127,87,8,.10);
  color:#e7ce8a;
  display:grid;
  place-items:center;
  font-size:8px;
  font-weight:1100;
  letter-spacing:.12em;
}

.tr-restTimerClockWrap{
  position:relative;
  z-index:1;
  display:grid;
  place-items:center;
  gap:7px;
  padding:30px 20px 24px;
}

.tr-restTimerClock{
  min-width:0 !important;
  color:#f4fbff !important;
  font-family:Arial,Helvetica,sans-serif !important;
  font-size:clamp(72px,16vw,118px) !important;
  font-weight:800 !important;
  line-height:.88 !important;
  letter-spacing:-.055em !important;
  font-variant-numeric:tabular-nums !important;
  font-feature-settings:"tnum" 1,"zero" 0 !important;
  text-shadow:
    0 3px 0 rgba(0,0,0,.70),
    0 0 34px rgba(0,190,255,.17) !important;
}

.tr-restTimerClockCaption{
  color:rgba(151,184,198,.66);
  font-size:8px;
  font-weight:1000;
  letter-spacing:.16em;
}

.tr-restTimerProgressTrack{
  position:relative;
  z-index:1;
  height:8px;
  margin:0 24px;
  overflow:hidden;
  border:1px solid rgba(255,255,255,.09);
  border-radius:999px;
  background:rgba(0,0,0,.42);
  box-shadow:inset 0 1px 4px rgba(0,0,0,.74);
}

.tr-restTimerProgressTrack > span{
  display:block;
  width:0;
  height:100%;
  border-radius:inherit;
  background:linear-gradient(90deg,#0e8fd2,#42d9f5);
  box-shadow:0 0 15px rgba(0,195,255,.46);
  transition:width .20s linear,background .18s ease;
}

.tr-restTimerNext{
  position:relative;
  z-index:1;
  margin:20px 24px 0;
  padding:18px;
  border:1px solid rgba(222,188,92,.22);
  border-radius:18px;
  background:
    linear-gradient(180deg,rgba(120,83,10,.085),rgba(0,0,0,.11)),
    rgba(7,13,18,.90);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.045);
  display:grid;
  gap:12px;
}

.tr-restTimerNext > div:first-child{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
}

.tr-restTimerNext span{
  color:#d8bb6d;
  font-size:8px;
  font-weight:1050;
  letter-spacing:.14em;
}

.tr-restTimerNext strong{
  color:#fff2ca;
  font-size:18px;
  font-weight:1100;
  letter-spacing:.04em;
}

.tr-restTimerNext p{
  margin:0;
  color:rgba(225,240,247,.86);
  font-size:14px;
  font-weight:800;
  line-height:1.45;
}

.tr-restTimerNextMeta{
  display:flex;
  flex-wrap:wrap;
  gap:8px 14px;
  padding-top:10px;
  border-top:1px solid rgba(255,255,255,.055);
}

.tr-restTimerNextMeta span{
  color:rgba(150,180,194,.57);
  font-size:7px;
}

.tr-restTimerActions.tr-restTimerActions--simple{
  position:relative;
  z-index:1;
  display:grid !important;
  grid-template-columns:1fr 1fr 1.18fr !important;
  gap:10px !important;
  padding:18px 24px 24px !important;
}

.tr-restTimerActions.tr-restTimerActions--simple button{
  min-height:52px !important;
  padding:0 12px !important;
  border:1px solid rgba(255,255,255,.11) !important;
  border-radius:14px !important;
  background:linear-gradient(180deg,rgba(255,255,255,.055),rgba(0,0,0,.18)) !important;
  color:rgba(222,239,247,.88) !important;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.055),
    0 10px 24px rgba(0,0,0,.22) !important;
  font-size:10px !important;
  font-weight:1050 !important;
  letter-spacing:.10em !important;
  cursor:pointer;
  transition:transform .14s ease,border-color .14s ease,background .14s ease;
}

.tr-restTimerActions.tr-restTimerActions--simple button:hover:not(:disabled){
  transform:translateY(-1px);
  border-color:rgba(0,200,255,.42) !important;
  background:linear-gradient(180deg,rgba(0,177,235,.13),rgba(0,53,84,.16)) !important;
}

.tr-restTimerActions.tr-restTimerActions--simple button:active:not(:disabled){
  transform:translateY(1px);
}

.tr-restTimerActions.tr-restTimerActions--simple button:disabled{
  opacity:.30 !important;
  cursor:not-allowed;
}

.tr-restTimerActions.tr-restTimerActions--simple .tr-restTimerSkip{
  border-color:rgba(78,205,235,.35) !important;
  background:
    linear-gradient(180deg,rgba(0,181,229,.16),rgba(0,74,114,.11)),
    #07131c !important;
  color:#dff8ff !important;
}

.tr-restTimerDock.is-final-ten{
  border-color:rgba(223,177,62,.54) !important;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.10),
    0 30px 90px rgba(0,0,0,.70),
    0 0 46px rgba(218,164,38,.11) !important;
}

.tr-restTimerDock.is-final-ten .tr-restTimerClock{
  color:#f2d67c !important;
  text-shadow:0 3px 0 rgba(0,0,0,.72),0 0 34px rgba(228,175,47,.18) !important;
}

.tr-restTimerDock.is-final-ten .tr-restTimerProgressTrack > span{
  background:linear-gradient(90deg,#d79a21,#f2d46e);
  box-shadow:0 0 15px rgba(229,174,50,.36);
}

.tr-restTimerDock.is-final-three .tr-restTimerClock{
  animation:tr-restTimerPulse .72s ease-in-out infinite alternate;
}

@keyframes tr-restTimerPulse{
  from{transform:scale(1);opacity:.88;}
  to{transform:scale(1.025);opacity:1;}
}

.tr-restTimerDock.is-finished{
  border-color:rgba(40,218,131,.55) !important;
  background:
    radial-gradient(circle at 50% -15%,rgba(24,214,124,.15),transparent 48%),
    linear-gradient(180deg,#0b1b18 0%,#07120f 56%,#050b09 100%) !important;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.10),
    0 30px 90px rgba(0,0,0,.70),
    0 0 52px rgba(30,219,128,.13) !important;
}

.tr-restTimerDock.is-finished .tr-restTimerKicker,
.tr-restTimerDock.is-finished .tr-restTimerClock{
  color:#70efb4 !important;
}

.tr-restTimerDock.is-finished .tr-restTimerProgressTrack > span{
  width:100% !important;
  background:linear-gradient(90deg,#16a66a,#53edaa);
  box-shadow:0 0 18px rgba(45,227,145,.40);
}

.tr-restTimerReady{
  position:relative;
  z-index:1;
  margin:18px 24px 24px;
  min-height:58px;
  border:1px solid rgba(52,223,143,.42);
  border-radius:15px;
  background:rgba(22,155,93,.12);
  color:#bff9dc;
  display:flex;
  align-items:center;
  justify-content:center;
  gap:10px;
  font-size:11px;
  font-weight:1100;
  letter-spacing:.12em;
}

.tr-restTimerReady > span{
  width:25px;
  height:25px;
  border-radius:999px;
  background:rgba(51,226,143,.18);
  display:grid;
  place-items:center;
  color:#67efad;
}

@media (prefers-reduced-motion:reduce){
  .tr-restTimerDock.is-final-three .tr-restTimerClock{
    animation:none;
  }
}

@media (max-width:720px){
  .tr-restTimerOverlay{
    align-items:end;
    padding:12px 12px calc(82px + env(safe-area-inset-bottom));
  }

  .tr-restTimerDock.tr-restTimerDock--pro{
    width:100% !important;
    max-width:none !important;
    max-height:calc(100dvh - 100px) !important;
    border-radius:24px !important;
  }

  .tr-restTimerTop{
    padding:17px 17px 13px;
  }

  .tr-restTimerKicker{
    font-size:9px !important;
  }

  .tr-restTimerExercise{
    font-size:11px !important;
  }

  .tr-restTimerRestTarget{
    min-height:27px;
    padding:0 8px;
    font-size:6px;
  }

  .tr-restTimerClockWrap{
    padding:24px 14px 18px;
  }

  .tr-restTimerClock{
    font-size:clamp(72px,25vw,104px) !important;
  }

  .tr-restTimerProgressTrack{
    margin:0 17px;
  }

  .tr-restTimerNext{
    margin:16px 17px 0;
    padding:14px;
    border-radius:15px;
  }

  .tr-restTimerNext strong{
    font-size:15px;
  }

  .tr-restTimerNext p{
    font-size:12px;
  }

  .tr-restTimerActions.tr-restTimerActions--simple{
    grid-template-columns:1fr 1fr !important;
    padding:14px 17px 17px !important;
  }

  .tr-restTimerActions.tr-restTimerActions--simple .tr-restTimerSkip{
    grid-column:1/-1;
  }

  .tr-restTimerReady{
    margin:14px 17px 17px;
  }
}

`}</style>
    </Card>
  );
}

function Qty({
  label,
  value,
  step,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
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
          value={String(value ?? 0)}
          disabled={disabled}
          inputMode="decimal"
          onChange={(e) => {
            const cleaned = e.target.value.replace(/[^\d.]/g, "");
            const n = Number(cleaned);
            onChange(Number.isFinite(n) ? n : 0);
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
