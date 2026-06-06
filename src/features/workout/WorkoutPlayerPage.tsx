import BottomHudAdvanced from "./BottomHudAdvanced";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import { Card } from "../../ui/Card";
import {
  effectiveHasMedia,
  matchFilters,
  normalizeText,
  resolveRowIcon,
  type EquipKey,
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

type SearchExerciseRow = {
  id: string;
  name: string;
  source?: string | null;
  primary_muscles?: string[] | null;
  equipment?: string[] | null;
  media?: any;
};

type DecoratedSearchRow = SearchExerciseRow & {
  effectiveHasMedia: boolean;
  icon?: string | null;
  iconAlt?: string;
};

function defaultPrescription() {
  return { sets: 3, rep_min: 8, rep_max: 12, rest_seconds: 90, rir_min: 2, rir_max: 3 };
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
  if (!open) return null;

  return (
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
          inset: 0;
          z-index: 10000;
          background:
            radial-gradient(circle at 50% 40%, rgba(0,170,255,.20), rgba(0,0,0,0) 34%),
            rgba(0,0,0,.82);
          backdrop-filter: blur(14px);
          display:grid;
          place-items:center;
          padding: 18px;
        }
        .tr-completeModal{
          position: relative;
          overflow:hidden;
          width:min(960px, 100%);
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
          .tr-completeCopy{ justify-items:center; }
          .tr-completeSub{ max-width: 100%; }
          .tr-completeStatRow{ width:100%; }
          .tr-completeActions{ justify-content:center; width:100%; }
        }
        @media (max-width: 620px){
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
    </div>
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

  const [searchQ, setSearchQ] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchResults, setSearchResults] = useState<DecoratedSearchRow[]>([]);
  const [swapTargetWeId, setSwapTargetWeId] = useState<string | null>(null);

  const [addMuscle, setAddMuscle] = useState<AddMuscleKey>("all");
  const [addEquip, setAddEquip] = useState<AddEquipKey>("all");

  const [justAddedId, setJustAddedId] = useState<string | null>(null);

  const [rpcMediaMap, setRpcMediaMap] = useState<Record<string, MediaPack>>({});
  const [userUploadMap, setUserUploadMap] = useState<Record<string, MediaPack>>({});

  const [sessionType, setSessionType] = useState<string | null>(null);
  const [goal, setGoal] = useState<string | null>(null);
  const [goalMode, setGoalMode] = useState<string | null>(null);
  const [symptomKey, setSymptomKey] = useState<SymptomKey | null>(null);

  const [completeOverlayOpen, setCompleteOverlayOpen] = useState(false);

  const doneCount = useMemo(() => items.filter((x) => !!x.completed_at).length, [items]);
  const current = items[activeIdx];
  const nextUp = items[activeIdx + 1];

  const atFirst = activeIdx === 0;
  const atLast = activeIdx === Math.max(0, items.length - 1);
  const sessionComplete = items.length > 0 && doneCount === items.length;

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

  async function reloadWorkoutExercisesKeepIndex() {
    if (!workoutId) return;

    const nextItems = await loadWorkoutExercisesWithExercises(workoutId);
    setItems(nextItems);
    setActiveIdx((prev) => (nextItems.length ? Math.min(prev, nextItems.length - 1) : 0));

    const exIds = Array.from(new Set(nextItems.map((r) => r.exercise_id).filter(Boolean)));
    const upMap = await buildUserUploadMediaMap(exIds);
    setUserUploadMap(upMap);
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
    showToast("EXERCISE SWAPPED.", "ok");
  }

  async function loadUserMediaRowsForExercises(exerciseIds: string[]): Promise<Map<string, UserMediaLite[]>> {
    const map = new Map<string, UserMediaLite[]>();
    if (!exerciseIds.length) return map;

    const { data: u, error: uErr } = await supabase.auth.getUser();
    if (uErr) throw uErr;
    if (!u.user) return map;

    const { data: rows, error } = await supabase
      .from("exercise_user_media")
      .select("exercise_id,kind,storage_path,use_user_upload")
      .eq("user_id", u.user.id)
      .in("exercise_id", exerciseIds);

    if (error) throw error;

    for (const r of rows ?? []) {
      const exId = (r as any).exercise_id as string;
      const list = map.get(exId) ?? [];
      list.push(r as any);
      map.set(exId, list);
    }

    return map;
  }

  async function runSearch(q: string, opts?: { force?: boolean }) {
    const termRaw = q.trim();
    const termNorm = normalizeText(termRaw);
    setSearchQ(q);

    const browsing = addMuscle !== "all" || addEquip !== "all";
    if (!opts?.force) {
      if (!browsing && termNorm.length < 2) {
        setSearchResults([]);
        return;
      }
    }

    setSearchBusy(true);
    try {
      const limit = termNorm.length >= 2 ? 200 : addEquip === "cardio" ? 500 : browsing ? 350 : 80;

      let query = supabase
        .from("exercises")
        .select("id,name,source,primary_muscles,equipment,media")
        .order("name", { ascending: true })
        .limit(limit);

      if (termNorm.length >= 2) {
        query = query.or(buildNameOrIlike(expandSearchTerms(termRaw)));
      } else if (addEquip === "cardio") {
        query = query.or(cardioBrowseOrIlike());
      }

      const { data, error } = await query;
      if (error) throw error;

      const list = (data ?? []) as SearchExerciseRow[];

      const local = list.filter((r) =>
        matchFilters(
          r,
          addMuscle === "all" ? "all" : (addMuscle as any),
          addEquip === "all" ? "all" : (addEquip as any)
        )
      );

      const ids = local.map((x) => x.id).filter(Boolean);
      const userMap = await loadUserMediaRowsForExercises(ids);

      const decorated: DecoratedSearchRow[] = local.map((r) => {
        const uRows = userMap.get(r.id) ?? [];
        const ok = effectiveHasMedia(r, uRows);
        const ic = resolveRowIcon(r);
        return {
          ...r,
          effectiveHasMedia: ok,
          icon: ic.icon,
          iconAlt: ic.alt,
        };
      });

      setSearchResults(decorated);
    } catch {
      setSearchResults([]);
    } finally {
      setSearchBusy(false);
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
  }, [editing, addMuscle, addEquip]);

  async function saveEditSessionOnly() {
    await reindexWorkoutExercises();
    await reloadWorkoutExercisesKeepIndex();
    setEditing(false);
    setSwapTargetWeId(null);
    setSearchQ("");
    setSearchResults([]);
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
    showToast("SAVED TO ALL FUTURE SESSIONS.", "ok");
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
    <div style={{ display: "grid", gap: 12, paddingBottom: 156 }}>
      <Toast toast={toast} onClose={() => setToast((t) => ({ ...t, open: false }))} />

      <SessionCompleteOverlay
        open={completeOverlayOpen}
        onReview={() => setCompleteOverlayOpen(false)}
        onEndWorkout={endWorkoutNow}
        doneCount={doneCount}
        totalExercises={items.length}
      />

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

      <Card
        title={sessionLabel}
        tone="blue"
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="tr-seg is-active" onClick={() => setEditing(true)} style={{ height: 44 }}>
              Edit
            </button>
          </div>
        }
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1.4fr 1fr",
            gap: 10,
            alignItems: "center",
            marginBottom: 10,
          }}
        >
          <div />
          <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={prev}
              className={`tr-seg ${atLast ? "tr-btn--prevOrange" : ""}`}
              disabled={atFirst}
              style={{ height: 40 }}
            >
              Prev
            </button>

            <div className="tr-doneCountPill" style={{ height: 40 }}>
              DONE {doneCount}/{items.length}
            </div>

            <button
              onClick={next}
              className={`tr-seg ${!atLast ? "tr-btn--nextOrange" : ""}`}
              disabled={atLast}
              style={{ height: 40 }}
            >
              Next
            </button>
          </div>
          <div />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 1fr", gap: 10, alignItems: "center" }}>
          <div style={{ display: "grid", gap: 4 }}>
            <div className="tr-kicker">WORKOUT</div>
            <div style={{ fontWeight: 1000 }}>
              Exercise {items.length ? activeIdx + 1 : 0}/{items.length}
            </div>
          </div>

          <div style={{ textAlign: "center", display: "grid", gap: 4 }}>
            <div className="tr-kicker">CURRENT</div>
            <div style={{ fontWeight: 1000 }}>{current?.exercise?.name ?? "Not set"}</div>
          </div>

          <div style={{ textAlign: "right", display: "grid", gap: 4 }}>
            <div className="tr-kicker">NEXT UP</div>
            <div style={{ fontWeight: 1000 }}>
              {nextUp?.exercise?.name ?? (items.length ? "End" : "Not set")}
            </div>
          </div>
        </div>
      </Card>

      {current && currentRunnerItem ? (
        <ExerciseRunner
          workoutExercise={current}
          item={currentRunnerItem}
          items={items}
          activeIdx={activeIdx}
          onChanged={reloadWorkoutExercisesKeepIndex}
          showToast={showToast}
          exerciseIndex={activeIdx + 1}
          totalExercises={items.length}
          doneCount={doneCount}
          nextExerciseName={nextUp?.exercise?.name ?? "End"}
          onPrev={prev}
          onNext={next}
          atFirst={atFirst}
          atLast={atLast}
          sessionComplete={sessionComplete}
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
    searchResults={searchResults}
    onSearch={(v) => runSearch(v)}
    onPickAdd={addExercise}
    onPickSwap={async (exerciseId) => {
      if (!swapTargetWeId) return;
      await swapExercise(swapTargetWeId, exerciseId);
    }}
    addMuscle={addMuscle}
    addEquip={addEquip}
    setAddMuscle={(v) => setAddMuscle(v)}
    setAddEquip={(v) => setAddEquip(v)}
    justAddedId={justAddedId}
  />
)}

      <style>{`
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
  searchResults: DecoratedSearchRow[];
  onSearch: (q: string) => Promise<void>;
  onPickAdd: (exerciseId: string) => Promise<void>;
  onPickSwap: (exerciseId: string) => Promise<void>;
  addMuscle: AddMuscleKey;
  addEquip: AddEquipKey;
  setAddMuscle: (v: AddMuscleKey) => void;
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
    searchResults,
    onSearch,
    onPickAdd,
    onPickSwap,
    addMuscle,
    addEquip,
    setAddMuscle,
    setAddEquip,
    justAddedId,
  } = props;

  const mode = swapTargetWeId ? "swap" : "add";

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
    !searchResults.length &&
    (searchQ.trim().length >= 2 || addMuscle !== "all" || addEquip !== "all");

  return (
    <div className="tr-modalOverlay">
      <div className="tr-modal">
        <div className="tr-modalHead">
          <div style={{ fontWeight: 950 }}>
            Edit Session <span className="tr-sub">({items.length})</span>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
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

        <div style={{ marginTop: 10, display: "grid", gap: 10, padding: "0 16px 16px" }}>
          <Card title="Current session exercises" tone="base">
            <div style={{ display: "grid", gap: 8 }}>
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

                  <button className={`tr-seg ${swapTargetWeId === we.id ? "is-active" : ""}`} onClick={() => onSwap(we.id)}>
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

          <Card title={mode === "swap" ? "Pick replacement" : "Add an exercise"} tone="blue">
            <div style={{ display: "grid", gap: 10 }}>
              {mode === "add" ? (
                <div className="tr-rowbox" style={{ display: "grid", gap: 10 }}>
                  <div style={{ display: "grid", gap: 6 }}>
                    <div className="tr-kicker">MUSCLE</div>
                    <div className="tr-chipRow tr-chipRow--wrap">
                      <button className={`tr-seg ${addMuscle === "all" ? "is-active" : ""}`} onClick={() => setAddMuscle("all")}>
                        ALL
                      </button>
                      {MUSCLE_CHIPS.map((m) => (
                        <button key={m.key} className={`tr-seg ${addMuscle === m.key ? "is-active" : ""}`} onClick={() => setAddMuscle(m.key)}>
                          <IconImg src={m.icon} alt={m.label} /> {m.label}
                        </button>
                      ))}
                    </div>
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

              <div style={{ display: "grid", gap: 8, maxHeight: 320, overflow: "auto" }}>
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

                {showResultsEmptyState ? <div className="tr-sub">No matches.</div> : null}
              </div>
            </div>
          </Card>
        </div>
      </div>

      <style>{`
        .tr-chipRow{ display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
      `}</style>
    </div>
  );
}

function ExerciseRunner({
  workoutExercise,
  item,
  items,
  activeIdx,
  onChanged,
  showToast,
  exerciseIndex,
  totalExercises,
  doneCount,
  nextExerciseName,
  onPrev,
  onNext,
  atFirst,
  atLast,
  sessionComplete,
}: {
  workoutExercise: WorkoutExerciseRow;
  item: any;
  items: WorkoutExerciseRow[];
  activeIdx: number;
  onChanged: () => Promise<void>;
  showToast: (msg: string, tone?: ToastTone) => void;
  exerciseIndex: number;
  totalExercises: number;
  doneCount: number;
  nextExerciseName: string;
  onPrev: () => void;
  onNext: () => void;
  atFirst: boolean;
  atLast: boolean;
  sessionComplete: boolean;
}) {
  const weId = workoutExercise.id;
  const isDone = !!workoutExercise.completed_at;

  const pres = item?.prescription_snapshot ?? {};
  const timed = isTimed(pres);

  const setsTarget = Number(pres.sets ?? 3);
  const repMin = Number(pres.rep_min ?? 8);
  const repMax = Number(pres.rep_max ?? 12);
  const restSeconds = Number(pres.rest_seconds ?? 90);

  const [sets, setSets] = useState<any[]>([]);
  const [loadingSets, setLoadingSets] = useState(true);

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
  }, [weId]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoadingSets(true);

      if (timed) {
        setSets([]);
        setLoadingSets(false);
        return;
      }

      const { data: existing } = await supabase
        .from("workout_sets")
        .select("set_index,reps,weight")
        .eq("workout_exercise_id", weId)
        .order("set_index", { ascending: true });

      if (cancelled) return;

      const rows = (existing ?? []) as any[];
      const maxExisting = rows.reduce((m, r) => Math.max(m, Number(r.set_index) || 0), 0);
      const total = Math.max(setsTarget, maxExisting);

      const filled = Array.from({ length: total }, (_, i) => {
        const idx = i + 1;
        const found = rows.find((r) => Number(r.set_index) === idx);
        return {
          set_index: idx,
          reps: Number(found?.reps ?? 0),
          weight: Number(found?.weight ?? 0),
        };
      });

      setSets(filled);
      setLoadingSets(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [weId, setsTarget, timed]);

  const allSetsLogged = useMemo(() => {
    if (timed) return true;
    if (!sets.length) return false;
    return sets.every((s) => Number(s.reps) > 0 && Number(s.weight) > 0);
  }, [sets, timed]);

  const readyToLock = painTouched && (timed || allSetsLogged);

  const focusLabel = resolveFocusLabel(item, timed);
  const targetLabel = targetLabelFromPrescription(pres, timed);
  const restDurationLabel = restOrDurationLabel(pres, timed);

  const progressCellCount = Math.max(1, items.length || totalExercises || 1);
  const progressCells = Array.from({ length: progressCellCount }, (_, idx) => {
    const row = items[idx];
    if (!row) return "upcoming";
    if (row.completed_at) return "complete";
    if (!sessionComplete && idx === activeIdx) return "current";
    return "upcoming";
  });

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
      },
      { onConflict: "workout_exercise_id,set_index" }
    );
  };

  const addSet = async () => {
    if (isDone || timed) return;

    const nextIndex = sets.length + 1;
    const next = [...sets, { set_index: nextIndex, reps: 0, weight: 0 }];
    setSets(next);

    await supabase.from("workout_sets").upsert(
      {
        workout_exercise_id: weId,
        set_index: nextIndex,
        reps: 0,
        weight: 0,
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
    const hasData = Number(last?.reps ?? 0) > 0 || Number(last?.weight ?? 0) > 0;
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
  if (!painTouched) {
    showToast("LOG PAIN BEFORE LOCKING DONE.", "err");
    return;
  }

  if (!timed && !allSetsLogged) {
    showToast("To mark Done: all sets must have reps + weight.", "err");
    return;
  }

  if (timed) {
    await saveTimedActualMinutes();
  }

  await supabase
    .from("workout_exercises")
    .update({ completed_at: new Date().toISOString() })
    .eq("id", weId);

  if (onChanged) {
    await Promise.resolve(onChanged());
  }

  showToast("LOCKED AS DONE.", "ok");
};

const unlock = async () => {
  await supabase
    .from("workout_exercises")
    .update({ completed_at: null })
    .eq("id", weId);

  if (onChanged) {
    await Promise.resolve(onChanged());
  }

  showToast("UNLOCKED.", "ok");
};

  if (loadingSets) return <Card title="Exercise">Loading…</Card>;

  const pColor = painColor(pain);
  const pct = Math.round((pain / 10) * 100);

  const detailRows = [
    { key: "sets", label: "Sets", value: timed ? "—" : String(setsTarget) },
    { key: "reps", label: "Reps", value: timed ? `${durationMinutes(pres)} min` : `${repMin}-${repMax}` },
    { key: "focus", label: "Focus", value: focusLabel },
    { key: "next", label: "Next", value: nextExerciseName },
    { key: "rest", label: "Rest", value: timed ? restDurationLabel : `${restSeconds} Sec` },
  ];

  return (
    <Card
      title={item.name}
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
              <div className="tr-sectionHeader tr-sectionHeader--tight">
                <div className="tr-sectionTitle">SETS</div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    className="tr-btn tr-btn--blueOutline"
                    style={{ height: 40 }}
                    disabled={isDone}
                    onClick={addSet}
                  >
                    + ADD SET
                  </button>

                  <button
                    className="tr-btn"
                    style={{ height: 40, borderColor: "rgba(255,255,255,.18)" }}
                    disabled={isDone}
                    onClick={removeLastSet}
                  >
                    − REMOVE LAST
                  </button>
                </div>
              </div>

              <div className="tr-setStack">
                {sets.map((s, i) => (
                  <div key={s.set_index} className="tr-setRowShell">
                    <div className="tr-setRowHead">SET {s.set_index}</div>
                    <div className="tr-setGrid">
                      <Qty
                        label="REPS"
                        value={Number(s.reps ?? 0)}
                        step={1}
                        disabled={isDone}
                        onChange={(v) => upsertSet(i, { reps: v })}
                      />
                      <Qty
                        label="WEIGHT (LB)"
                        value={Number(s.weight ?? 0)}
                        step={5}
                        disabled={isDone}
                        onChange={(v) => upsertSet(i, { weight: v })}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className={`tr-finalActionModule ${sessionComplete ? "is-sessionComplete" : ""}`}>
            <div className="tr-finalActionTop">
              {sessionComplete ? (
                <div className="tr-finalActionDoneText tr-finalActionDoneText--complete">
                  Mission complete — reward ready.
                </div>
              ) : isDone ? (
                <div className="tr-finalActionDoneText">Exercise locked as complete.</div>
              ) : (
                <div className="tr-sub">Complete sets or time, log pain, then move through the session below.</div>
              )}
            </div>

            <div className="tr-finalActionBottom tr-finalActionBottom--triple">
              <button
                className={`tr-btn ${atLast ? "tr-btn--prevOrange" : ""}`}
                style={{ height: 46 }}
                disabled={atFirst}
                onClick={onPrev}
              >
                Prev
              </button>

              {isDone ? (
                <button
                  className={`tr-btn tr-btn--primary tr-doneBtn ${sessionComplete ? "tr-doneBtn--celebrate" : ""}`}
                  style={{ height: 46 }}
                  onClick={unlock}
                >
                  {sessionComplete ? "UNLOCK / REVIEW" : "UNLOCK"}
                </button>
              ) : (
                <button
                  className="tr-btn tr-btn--primary tr-doneBtn"
                  type="button"
                  onClick={markDone}
                  disabled={!readyToLock}
                >
                  DONE (LOCK)
                </button>
              )}

              <button
                className={`tr-btn ${!atLast ? "tr-btn--nextOrange" : ""}`}
                style={{ height: 46 }}
                disabled={atLast}
                onClick={onNext}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 28 }}>
        <BottomHudAdvanced
          sessionComplete={sessionComplete}
          doneCount={doneCount}
          totalExercises={totalExercises}
          progressCells={progressCells}
          exerciseName={item?.name ?? `Exercise ${exerciseIndex}`}
          targetLabel={targetLabel}
          detailRows={detailRows}
          iconSrc="/dumbbell.png"
        />
      </div>

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
          position: sticky;
          bottom: 14px;
          z-index: 20;
          border-radius: 18px;
          border: 1px solid rgba(0,170,255,.22);
          background:
            linear-gradient(180deg, rgba(255,255,255,.06), rgba(0,0,0,.18)),
            radial-gradient(520px 180px at 50% 0%, rgba(0,170,255,.08), rgba(0,0,0,0) 70%);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.05),
            0 18px 50px rgba(0,0,0,.38),
            0 0 24px rgba(0,170,255,.08);
          padding: 14px;
          display:grid;
          gap: 12px;
          backdrop-filter: blur(10px);
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
    <div style={{ display: "grid", gap: 8 }}>
      <div className="tr-kicker">{label}</div>
      <div className="tr-qtyRow tr-opRow">
        <button className="tr-qtyBtn tr-opBtn" disabled={disabled} onClick={() => onChange(Math.max(0, Number(value) - step))}>
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

        <button className="tr-qtyBtn tr-opBtn" disabled={disabled} onClick={() => onChange(Number(value) + step)}>
          +
        </button>
      </div>
    </div>
  );
}
