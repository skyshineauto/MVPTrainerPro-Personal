import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../../lib/supabase";
import {
  formatSessionLabel,
  inferSymptomKey,
  isSymptomMode,
  type SymptomKey,
} from "../../lib/sessionLabel";
import { MusicMiniPlayer } from "../../features/music/MusicMiniPlayer";

const LS = {
  isPaused: "mvp_is_paused",
  pausedAt: "mvp_paused_at_iso",
  pausedTotal: "mvp_paused_total_seconds",
  activeSessionId: "mvp_active_session_id",
  activeWorkoutId: "mvp_active_workout_id",
  activeExerciseName: "mvp_active_exercise_name",
  activeExercisePos: "mvp_active_exercise_pos",
};

const END_WORKOUT_REQUEST_EVENT = "mvp:end-workout-request";

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
      ".tr-editCurrentList, .tr-editResultsViewport, .tr-completeGrid, .tr-modalBody"
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

function lsGet(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, val: string) {
  try {
    localStorage.setItem(key, val);
  } catch {}
}
function lsDel(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {}
}

function toHHMMSS(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function fmtClockParts(ts: number) {
  const d = new Date(ts);

  const parts = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).formatToParts(d);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

  const weekday = get("weekday");
  const month = get("month");
  const day = get("day");
  const year = get("year");

  const date = `${weekday} ${month} ${day}, ${year}`.trim();

  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return { date, time };
}

function proteinMultiplier(goal: string | null | undefined) {
  const g = (goal || "").toLowerCase();
  if (g === "cut" || g === "lose_weight") return 1.0;
  return 0.9;
}
function roundProtein(g: number) {
  return Math.round(g / 5) * 5;
}

function difficultyToRating(d: "too_easy" | "just_right" | "too_hard") {
  if (d === "too_easy") return 1;
  if (d === "just_right") return 2;
  return 3;
}

function displayOrNotSet(v: any, notSet = "Not set") {
  const s = String(v ?? "").trim();
  return s ? s : notSet;
}

type Hud =
  | { mode: "signed_out" }
  | { mode: "no_program" }
  | {
      mode: "inactive";
      goal: string | null;
      goalMode: string | null;
      symptomKey: SymptomKey | null;
      proteinTargetG: number | null;
      displayWeightLb: number | null;
      nextSessionId: string | null;
      nextSessionType: string | null;
      nextTemplateName: string | null;
      nextFirstExercise: string | null;
    }
  | {
      mode: "active";
      workoutId: string;
      sessionId: string;
      templateName: string;
      sessionType: string | null;
      goal: string | null;
      goalMode: string | null;
      symptomKey: SymptomKey | null;
      startedAtISO: string;
      isPaused: boolean;
      bodyweightLb: number | null;
      proteinTargetG: number | null;
    };

const HUD_FORCE_CSS = `
.tr-hudTimeBig--active{
  color: rgba(255,230,120,.98) !important;
  text-shadow:
    0 0 18px rgba(255,210,80,.30),
    0 0 44px rgba(255,210,80,.18) !important;
}
.tr-hudTimeBig--paused{
  color: rgba(239,68,68,.98) !important;
  text-shadow:
    0 0 18px rgba(239,68,68,.30),
    0 0 44px rgba(239,68,68,.18) !important;
}
.tr-hudPanel .tr-seg--pauseBlue{
  border-color: rgba(0,170,255,.70) !important;
  background: linear-gradient(180deg, rgba(0,170,255,.22), rgba(0,0,0,.12)) !important;
  box-shadow:
    0 0 0 1px rgba(0,170,255,.12) inset,
    0 18px 55px rgba(0,0,0,.45),
    0 0 18px rgba(0,170,255,.18) !important;
}
.tr-hudPanel .tr-seg--resumeGreen{
  border-color: rgba(34,197,94,.70) !important;
  background: linear-gradient(180deg, rgba(34,197,94,.22), rgba(0,0,0,.12)) !important;
  box-shadow:
    0 0 0 1px rgba(34,197,94,.12) inset,
    0 18px 55px rgba(0,0,0,.45),
    0 0 18px rgba(34,197,94,.16) !important;
}
.tr-hudPanel .tr-seg--endRed{
  border-color: rgba(239,68,68,.70) !important;
  background: linear-gradient(180deg, rgba(239,68,68,.20), rgba(0,0,0,.12)) !important;
  box-shadow:
    0 0 0 1px rgba(239,68,68,.10) inset,
    0 18px 55px rgba(0,0,0,.45),
    0 0 18px rgba(239,68,68,.16) !important;
}
.tr-hudPanel .tr-seg--startBlue{
  border-color: rgba(0,170,255,.75) !important;
  background: linear-gradient(180deg, rgba(0,170,255,.26), rgba(0,0,0,.12)) !important;
  box-shadow:
    0 0 0 1px rgba(0,170,255,.12) inset,
    0 18px 55px rgba(0,0,0,.45),
    0 0 18px rgba(0,170,255,.18) !important;
}
.tr-hudActionBtn:disabled,
.tr-hudActionBtn[disabled]{
  opacity: .55 !important;
  filter: none !important;
  box-shadow: none !important;
}
.tr-pulse{
  animation: trHudPulse 1.6s ease-in-out infinite;
}
@keyframes trHudPulse{
  0%   { transform: translateY(0) scale(1); filter: saturate(1); }
  50%  { transform: translateY(-1px) scale(1.02); filter: saturate(1.08); }
  100% { transform: translateY(0) scale(1); filter: saturate(1); }
}
.tr-shellRoot{
  position: relative;
  isolation: isolate;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  min-height: 100vh;
  min-height: 100dvh;
  overflow-x: clip;
  background: #0b0d10;
  color: rgba(255,255,255,.92);
}
.tr-shellInner{
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 1120px;
  min-width: 0;
  margin: 0 auto;
  padding:
    max(16px, env(safe-area-inset-top))
    max(18px, env(safe-area-inset-right))
    calc(128px + env(safe-area-inset-bottom))
    max(18px, env(safe-area-inset-left));
}
.tr-bottomNavWrap{
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1200;
  isolation: isolate;
  background: rgba(6,8,10,.96);
  border-top: 1px solid rgba(0,170,255,.12);
  box-shadow:
    0 -24px 70px rgba(0,0,0,.78),
    0 -1px 0 rgba(0,170,255,.08) inset,
    0 0 0 1px rgba(255,255,255,.02) inset;
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}
.tr-bottomNavWrap::before{
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 2px;
  background: linear-gradient(90deg, rgba(0,170,255,0), rgba(90,210,255,.78) 30%, rgba(0,255,145,.36) 70%, rgba(0,170,255,0));
  box-shadow: 0 0 14px rgba(0,170,255,.18);
  pointer-events: none;
}
.tr-bottomNavInner{
  position: relative;
  z-index: 1;
  max-width: 1120px;
  margin: 0 auto;
  display: flex;
  gap: 10px;
  padding:
    12px
    max(18px, env(safe-area-inset-right))
    max(14px, env(safe-area-inset-bottom))
    max(18px, env(safe-area-inset-left));
}
@media (max-width: 720px){
  .tr-shellInner{
    max-width: none;
    padding:
      max(10px, env(safe-area-inset-top))
      max(10px, env(safe-area-inset-right))
      calc(108px + env(safe-area-inset-bottom))
      max(10px, env(safe-area-inset-left));
  }

  .tr-bottomNavInner{
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 7px;
    padding:
      9px
      max(8px, env(safe-area-inset-right))
      max(10px, env(safe-area-inset-bottom))
      max(8px, env(safe-area-inset-left));
  }

  .tr-bottomNavInner button{
    min-width: 0 !important;
    width: 100% !important;
    padding: 10px 6px !important;
    border-radius: 14px !important;
    font-size: 10px !important;
    line-height: 12px !important;
    letter-spacing: .06em !important;
  }
}
`;

export function AppShell({
  children,
  navigate,
  currentPath,
  hideChrome,
}: {
  children: React.ReactNode;
  navigate: (to: string) => void;
  currentPath: string;
  hideChrome?: boolean;
}) {
  const [user, setUser] = useState<any>(null);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [hud, setHud] = useState<Hud>({ mode: "signed_out" });
  const [nowTick, setNowTick] = useState(Date.now());

  const pollRef = useRef<any>(null);

  const isWorkoutSession = currentPath.startsWith("/workout/");
  const isWorkoutsTab = currentPath === "/" || currentPath.startsWith("/workout/");
  const hudVariant = isWorkoutSession ? "hero" : isWorkoutsTab ? "large" : "compact";

  const [endOpen, setEndOpen] = useState(false);
  const [endDifficulty, setEndDifficulty] = useState<"too_easy" | "just_right" | "too_hard" | "">("");
  const [endNotes, setEndNotes] = useState("");
  const [endBusy, setEndBusy] = useState(false);

  useEffect(() => {
    if (!endOpen) return;
    return lockDocumentForModal();
  }, [endOpen]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const signOut = async () => {
    setMsg(null);
    setBusy(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) setMsg(error.message);
      navigate("/login");
    } finally {
      setBusy(false);
    }
  };

  const activeTab = (p: string) => {
    if (p === "/") return currentPath === "/" || currentPath.startsWith("/workout/");
    return currentPath.startsWith(p);
  };

  const tabStyle = (isActive: boolean): React.CSSProperties => ({
    flex: 1,
    padding: "12px 10px",
    borderRadius: 14,
    cursor: "pointer",
    fontWeight: 950,
    color: isActive ? "rgba(255,255,255,.96)" : "rgba(255,255,255,.92)",
    letterSpacing: ".08em",
    textTransform: "uppercase",
    fontSize: 12.5,
    lineHeight: "16px",
    transition: "transform .14s ease, filter .14s ease, border-color .14s ease, background .14s ease, box-shadow .14s ease",
    background: isActive ? "rgba(0,170,255,.12)" : "rgba(0,0,0,.18)",
    border: isActive ? "2px solid rgba(0,170,255,.72)" : "2px solid rgba(255,255,255,.22)",
    boxShadow: isActive
      ? "0 0 0 1px rgba(0,170,255,.18) inset, 0 12px 34px rgba(0,0,0,.55), 0 0 20px rgba(0,170,255,.18)"
      : "0 0 0 1px rgba(255,255,255,.10) inset, 0 12px 34px rgba(0,0,0,.55)",
    textShadow: isActive
      ? "0 2px 0 rgba(0,0,0,.55), 0 0 10px rgba(0,170,255,.18)"
      : "0 2px 0 rgba(0,0,0,.70), 0 0 8px rgba(0,0,0,.55)",
  });

  async function resolveActiveWorkoutDbFirst(): Promise<{
    workoutId: string;
    sessionId: string;
    startedAtISO: string;
    bodyweightLb: number | null;
  } | null> {
    const { data: u, error: uErr } = await supabase.auth.getUser();
    if (uErr) throw uErr;
    if (!u.user) return null;

    const { data: w, error } = await supabase
      .from("workouts")
      .select("id, scheduled_session_id, started_at, performed_at, bodyweight_lb")
      .eq("user_id", u.user.id)
      .is("completed_at", null)
      .not("started_at", "is", null)
      .order("started_at", { ascending: false, nullsFirst: false })
      .order("performed_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!w?.id || !w?.scheduled_session_id || !w.started_at) return null;

    const { data: anyWe, error: weErr } = await supabase
      .from("workout_exercises")
      .select("id")
      .eq("workout_id", w.id)
      .limit(1);
    if (weErr) throw weErr;

    if (!anyWe || anyWe.length === 0) {
      await supabase
        .from("workouts")
        .update({ ended_at: new Date().toISOString(), completed_at: new Date().toISOString(), active_seconds: 0 })
        .eq("id", w.id);
      return null;
    }

    return {
      workoutId: w.id,
      sessionId: w.scheduled_session_id,
      startedAtISO: w.started_at,
      bodyweightLb: w.bodyweight_lb != null ? Number(w.bodyweight_lb) : null,
    };
  }

  async function fetchLatestSymptomKeyIfNeeded(goalMode: string | null): Promise<SymptomKey | null> {
    if (!isSymptomMode(goalMode)) return null;

    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) return null;

    const { data: intake } = await supabase
      .from("intake_snapshots")
      .select("symptoms, created_at")
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return inferSymptomKey((intake as any)?.symptoms ?? null);
  }

  async function fetchHud() {
    if (hideChrome) return;

    const { data: u, error: uErr } = await supabase.auth.getUser();
    if (uErr) throw uErr;
    if (!u.user) {
      setHud({ mode: "signed_out" });
      return;
    }

    const { data: ab } = await supabase
      .from("program_blocks")
      .select("id, goal, goal_mode")
      .eq("user_id", u.user.id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const goal = (ab?.goal as string) ?? null;
    const goalMode = (ab?.goal_mode as string) ?? null;
    const symptomKey = await fetchLatestSymptomKeyIfNeeded(goalMode);

    const { data: lastBW } = await supabase
      .from("workouts")
      .select("bodyweight_lb, completed_at")
      .eq("user_id", u.user.id)
      .not("bodyweight_lb", "is", null)
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const latestCompletedWeight = lastBW?.bodyweight_lb != null ? Number(lastBW.bodyweight_lb) : null;

    const active = await resolveActiveWorkoutDbFirst();
    if (active?.workoutId && active.sessionId) {
      lsSet(LS.activeWorkoutId, active.workoutId);
      lsSet(LS.activeSessionId, active.sessionId);

      let sessionType: string | null = null;
      let templateName = "Session";

      const { data: sess, error: sessErr } = await supabase
        .from("scheduled_sessions")
        .select("id, template_id, session_type")
        .eq("id", active.sessionId)
        .maybeSingle();
      if (sessErr) throw sessErr;

      sessionType = (sess as any)?.session_type ?? null;

      if ((sess as any)?.template_id) {
        const { data: tmpl, error: tmplErr } = await supabase
          .from("workout_templates")
          .select("id,name")
          .eq("id", (sess as any).template_id)
          .maybeSingle();
        if (tmplErr) throw tmplErr;
        if ((tmpl as any)?.name) templateName = (tmpl as any).name;
      }

      const paused = lsGet(LS.isPaused) === "true";
      const bw = active.bodyweightLb ?? null;
      const proteinTargetG = bw && bw > 0 ? roundProtein(bw * proteinMultiplier(goal)) : null;

      setHud({
        mode: "active",
        workoutId: active.workoutId,
        sessionId: active.sessionId,
        templateName,
        sessionType,
        goal,
        goalMode,
        symptomKey,
        startedAtISO: active.startedAtISO,
        isPaused: paused,
        bodyweightLb: bw,
        proteinTargetG,
      });
      return;
    }

    if (!ab?.id) {
      setHud({ mode: "no_program" });
      return;
    }

    const { data: qd, error: qErr } = await supabase.rpc("rpc_queue_dashboard", { p_keep: 7 });
    if (qErr) throw qErr;

    const next = (qd as any)?.nextSession ?? null;
    const nextSessionId = next?.id ?? null;
    const nextSessionType = next?.session_type ?? null;

    let nextTemplateName: string | null = null;
    let nextFirstExercise: string | null = null;

    if (next?.template_id) {
      const { data: tmpl } = await supabase
        .from("workout_templates")
        .select("id,name")
        .eq("id", next.template_id)
        .maybeSingle();
      if ((tmpl as any)?.name) nextTemplateName = (tmpl as any).name;

      const { data: te } = await supabase
        .from("template_exercises")
        .select("exercise_id, order_index")
        .eq("template_id", next.template_id)
        .order("order_index", { ascending: true })
        .limit(1);

      const exId = (te?.[0] as any)?.exercise_id as string | undefined;
      if (exId) {
        const { data: ex } = await supabase.from("exercises").select("id,name").eq("id", exId).maybeSingle();
        if ((ex as any)?.name) nextFirstExercise = (ex as any).name;
      }
    }

    Object.values(LS).forEach((k) => lsDel(k));

    const displayWeightLb = latestCompletedWeight && latestCompletedWeight > 0 ? latestCompletedWeight : null;
    const proteinTargetG = displayWeightLb ? roundProtein(displayWeightLb * proteinMultiplier(goal)) : null;

    setHud({
      mode: "inactive",
      goal,
      goalMode,
      symptomKey,
      proteinTargetG,
      displayWeightLb,
      nextSessionId,
      nextSessionType,
      nextTemplateName,
      nextFirstExercise,
    });
  }

  useEffect(() => {
    let cancelled = false;
    if (hideChrome) return;

    const run = async () => {
      try {
        if (!cancelled) await fetchHud();
      } catch {}
    };

    void run();

    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => void run(), 8000);

    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [user?.id, currentPath, hideChrome]);

  const timerSeconds = useMemo(() => {
    if (hud.mode !== "active") return 0;
    if (!hud.startedAtISO) return 0;

    const startMs = new Date(hud.startedAtISO).getTime();
    if (!Number.isFinite(startMs)) return 0;

    const base = Math.max(0, Math.floor((nowTick - startMs) / 1000));

    const pausedTotal = Number(lsGet(LS.pausedTotal) ?? "0") || 0;
    const pausedAtISO = lsGet(LS.pausedAt);
    const paused = lsGet(LS.isPaused) === "true";

    if (paused && pausedAtISO) {
      const pMs = new Date(pausedAtISO).getTime();
      const extra = Math.max(0, Math.floor((nowTick - pMs) / 1000));
      return Math.max(0, base - pausedTotal - extra);
    }
    return Math.max(0, base - pausedTotal);
  }, [hud, nowTick]);

  const onTogglePause = async () => {
    if (hud.mode !== "active") return;

    const paused = lsGet(LS.isPaused) === "true";

    if (!paused) {
      lsSet(LS.isPaused, "true");
      lsSet(LS.pausedAt, new Date().toISOString());
      setHud({ ...hud, isPaused: true });
      return;
    }

    const pausedAtISO = lsGet(LS.pausedAt);
    const pausedTotal = Number(lsGet(LS.pausedTotal) ?? "0") || 0;
    if (pausedAtISO) {
      const pMs = new Date(pausedAtISO).getTime();
      const add = Math.max(0, Math.floor((Date.now() - pMs) / 1000));
      lsSet(LS.pausedTotal, String(pausedTotal + add));
    }
    lsSet(LS.isPaused, "false");
    lsDel(LS.pausedAt);

    setHud({ ...hud, isPaused: false });

    const active = await resolveActiveWorkoutDbFirst();
    if (active?.sessionId) navigate(`/workout/${active.sessionId}`);
  };

  async function startSession(sessionId: string) {
    navigate(`/workout/${sessionId}`);
  }

  const endEnabled = useMemo(() => {
    if (hud.mode !== "active") return false;
    return !!(hud.bodyweightLb && hud.bodyweightLb > 0);
  }, [hud]);

  const onEndWorkout = async () => {
    if (hud.mode !== "active") return;

    if (!hud.bodyweightLb || hud.bodyweightLb <= 0) {
      setMsg("Enter your weight to start.");
      return;
    }

    setEndDifficulty("");
    setEndNotes("");
    setEndOpen(true);
  };

  useEffect(() => {
    const handler = () => {
      void onEndWorkout();
    };
    window.addEventListener(END_WORKOUT_REQUEST_EVENT, handler as EventListener);
    return () => window.removeEventListener(END_WORKOUT_REQUEST_EVENT, handler as EventListener);
  }, [hud, endEnabled]);

  async function submitEndWorkout() {
    if (hud.mode !== "active") return;

    if (!endDifficulty) {
      setMsg("Pick difficulty (required).");
      return;
    }

    setMsg(null);
    setEndBusy(true);

    try {
      const activeSeconds = timerSeconds;
      const proteinTargetG = roundProtein((hud.bodyweightLb || 0) * proteinMultiplier(hud.goal));
      const endedAt = new Date().toISOString();

      const { data: weRows, error: weErr } = await supabase
        .from("workout_exercises")
        .select("order_index, exercise_id")
        .eq("workout_id", hud.workoutId)
        .order("order_index", { ascending: true });

      if (weErr) throw weErr;

      const exIds = Array.from(new Set((weRows ?? []).map((r: any) => r.exercise_id).filter(Boolean)));

      const nameMap = new Map<string, string>();
      if (exIds.length) {
        const { data: exRows, error: exErr } = await supabase.from("exercises").select("id,name").in("id", exIds);
        if (exErr) throw exErr;
        for (const e of exRows ?? []) nameMap.set((e as any).id, (e as any).name);
      }

      const exerciseNames = (weRows ?? [])
        .map((r: any) => nameMap.get(r.exercise_id) ?? r.exercise_id)
        .filter(Boolean);

      const summary = {
        template_name: hud.templateName || "Session",
        exercises: exerciseNames,
        duration_seconds: activeSeconds,
      };

      const { error } = await supabase
        .from("workouts")
        .update({
          post_difficulty: endDifficulty,
          post_notes: endNotes.trim() ? endNotes.trim() : null,
          workout_summary: summary,
          session_rating: difficultyToRating(endDifficulty as any),
          notes: endNotes.trim() ? endNotes.trim() : null,
          ended_at: endedAt,
          completed_at: endedAt,
          active_seconds: activeSeconds,
          protein_target_g: proteinTargetG,
        })
        .eq("id", hud.workoutId);

      if (error) throw error;

      Object.values(LS).forEach((k) => lsDel(k));

      setEndOpen(false);

      await fetchHud();
      navigate("/progress");
    } catch (e: any) {
      setMsg(e?.message ?? String(e));
    } finally {
      setEndBusy(false);
    }
  }

  const hudClass =
    `tr-hudPanel tr-hud--${hudVariant} ` +
    (hud.mode === "active" ? (lsGet(LS.isPaused) === "true" ? "tr-hud--activePaused" : "tr-hud--active") : "");

  if (hideChrome) {
    return <div style={{ minHeight: "100vh", background: "#0b0d10", color: "rgba(255,255,255,.92)" }}>{children}</div>;
  }

  const inactiveLabel =
    hud.mode === "inactive"
      ? formatSessionLabel({
          sessionType: hud.nextSessionType,
          goal: hud.goal,
          goalMode: hud.goalMode,
          symptomKey: hud.symptomKey,
        })
      : "";

  const activeLabel =
    hud.mode === "active"
      ? formatSessionLabel({
          sessionType: hud.sessionType ?? hud.templateName,
          goal: hud.goal,
          goalMode: hud.goalMode,
          symptomKey: hud.symptomKey,
        })
      : "";

  const clockParts = hud.mode !== "active" ? fmtClockParts(nowTick) : null;

  return (
    <div className="tr-shellRoot">
      <div className="tr-shellInner">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div className="tr-topTitle">MVP Trainer Pro</div>

          {user ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => navigate("/music")}
                style={{
                  background: "rgba(255,145,0,.12)",
                  color: "rgba(255,235,205,.98)",
                  border: "1px solid rgba(255,145,0,.38)",
                  borderRadius: 12,
                  padding: "8px 10px",
                  cursor: "pointer",
                  fontWeight: 900,
                  letterSpacing: ".06em",
                }}
              >
                MY MUSIC
              </button>

              <button
                type="button"
                onClick={() => navigate("/sound-alerts")}
                style={{
                  background: "rgba(0,170,255,.10)",
                  color: "rgba(190,235,255,.96)",
                  border: "1px solid rgba(0,170,255,.28)",
                  borderRadius: 12,
                  padding: "8px 10px",
                  cursor: "pointer",
                  fontWeight: 900,
                  letterSpacing: ".06em",
                }}
              >
                SOUND & ALERTS
              </button>

              <button
                type="button"
                onClick={signOut}
                disabled={busy}
                style={{
                  background: "transparent",
                  color: "rgba(255,255,255,.85)",
                  border: "1px solid rgba(255,255,255,.12)",
                  borderRadius: 12,
                  padding: "8px 10px",
                  cursor: "pointer",
                  fontWeight: 900,
                  opacity: busy ? 0.7 : 1,
                }}
              >
                SIGN OUT
              </button>
            </div>
          ) : null}
        </div>

        <style>{`
          .tr-topTitle{
            font-weight: 1000;
            font-size: 24px;
            line-height: 1;
            letter-spacing: .04em;
            color: rgba(255,230,120,.98);
            text-shadow:
              0 2px 0 rgba(0,0,0,.70),
              0 0 14px rgba(255,230,120,.18),
              0 0 28px rgba(0,170,255,.08);
            position: relative;
            display: inline-block;
            margin: 0;
            padding: 0;
            overflow: hidden;
          }
          .tr-topTitle::after{
            content:"";
            position:absolute;
            inset:-40% -60%;
            background: linear-gradient(
              110deg,
              transparent 0%,
              rgba(255,255,255,0) 42%,
              rgba(255,255,255,.28) 50%,
              rgba(255,255,255,0) 58%,
              transparent 100%
            );
            transform: translateX(-60%);
            opacity: .0;
            pointer-events:none;
            mix-blend-mode: screen;
            animation: trTopTitleShimmer 3.8s ease-in-out infinite;
          }
          @keyframes trTopTitleShimmer{
            0%   { transform: translateX(-60%); opacity: .0; }
            12%  { opacity: .9; }
            28%  { opacity: .9; }
            40%  { opacity: .0; }
            100% { transform: translateX(60%); opacity: .0; }
          }
          @media (prefers-reduced-motion: reduce){
            .tr-topTitle::after{ animation: none; opacity: 0; }
          }
        `}</style>

        {user ? <MusicMiniPlayer navigate={navigate} /> : null}

        {msg ? (
          <div
            className="tr-rowbox"
            style={{
              borderColor: msg.toLowerCase().includes("sent") ? "rgba(0,170,255,.35)" : "rgba(255,80,80,.35)",
              background: msg.toLowerCase().includes("sent") ? "rgba(0,170,255,.10)" : "rgba(255,80,80,.10)",
              fontWeight: 900,
              marginBottom: 12,
            }}
          >
            {msg}
          </div>
        ) : null}

        <section className={`tr-card ${hudClass}`}>
          <div className="tr-card-body tr-sessionOverviewBody">
            {hud.mode === "active" ? (
              <>
                <div className={`tr-sessionChronograph ${hud.isPaused ? "is-paused" : "is-running"}`}>
                  <div className="tr-sessionChronographHead">
                    <div className="tr-sessionChronographKicker">SESSION ELAPSED</div>
                    <div className={`tr-sessionChronographState ${hud.isPaused ? "is-paused" : "is-running"}`}>
                      <span aria-hidden />
                      {hud.isPaused ? "PAUSED" : "TRAINING"}
                    </div>
                  </div>

                  <div className="tr-sessionChronographTime" aria-label={`${toHHMMSS(timerSeconds)} elapsed`}>
                    {toHHMMSS(timerSeconds)}
                  </div>
                  <div className="tr-sessionChronographUnits" aria-hidden>
                    <span>HR</span>
                    <span>MIN</span>
                    <span>SEC</span>
                  </div>

                  <div className="tr-sessionChronographActions">
                    <button
                      type="button"
                      className={`tr-sessionChronographPrimary ${hud.isPaused ? "is-resume" : "is-pause"}`}
                      onClick={onTogglePause}
                    >
                      {hud.isPaused ? "RESUME WORKOUT" : "PAUSE WORKOUT"}
                    </button>
                    <button
                      type="button"
                      className="tr-sessionChronographEnd"
                      onClick={onEndWorkout}
                      disabled={!endEnabled}
                      title={!endEnabled ? "Confirm today's body weight before ending" : "End workout"}
                    >
                      END WORKOUT
                    </button>
                  </div>
                </div>

                <div className="tr-sessionCurrentHero">
                  <div className="tr-sessionCurrentHeroHead">
                    <span>CURRENT EXERCISE</span>
                    <strong>{lsGet(LS.activeExercisePos) || "IN SESSION"}</strong>
                  </div>
                  <div className="tr-sessionCurrentHeroName">
                    {displayOrNotSet(lsGet(LS.activeExerciseName), "Exercise not selected")}
                  </div>
                  <div className="tr-sessionCurrentHeroMode">{activeLabel || "Workout in progress"}</div>
                </div>

                <div className="tr-sessionMetricRail">
                  <div className="tr-sessionMetric tr-sessionMetric--weight">
                    <div className="tr-sessionMetricIcon" aria-hidden>⚖</div>
                    <div>
                      <span>BODY WEIGHT</span>
                      <strong>{hud.bodyweightLb != null ? `${hud.bodyweightLb} lb` : "Not set"}</strong>
                      <small>Today</small>
                    </div>
                  </div>

                  <div className="tr-sessionMetric tr-sessionMetric--protein">
                    <div className="tr-sessionMetricIcon" aria-hidden>◆</div>
                    <div>
                      <span>DAILY PROTEIN</span>
                      <strong>{hud.proteinTargetG != null ? `${hud.proteinTargetG} g` : "Not set"}</strong>
                      <small>Target</small>
                    </div>
                  </div>

                  <div className={`tr-sessionMetric tr-sessionMetric--state ${hud.isPaused ? "is-paused" : "is-running"}`}>
                    <div className="tr-sessionMetricIcon" aria-hidden>●</div>
                    <div>
                      <span>SESSION</span>
                      <strong>{hud.isPaused ? "PAUSED" : "IN PROGRESS"}</strong>
                      <small>{toHHMMSS(timerSeconds)} elapsed</small>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="tr-hudStrip">
                  <div className="tr-hudLeft">
                    <div className="tr-hudKicker">
                      {hud.mode === "inactive" ? "NEXT WORKOUT" : "STATUS"}
                    </div>
                    <div className="tr-hudStripSub">
                      {hud.mode === "inactive"
                        ? inactiveLabel
                        : hud.mode === "no_program"
                        ? "No active program"
                        : "Sign in"}
                    </div>
                  </div>

                  <div className="tr-hudTimeBig tr-hudTimeBig--clock">
                    <div className="tr-hudClockWrap">
                      <div className="tr-hudClockDate">{clockParts?.date}</div>
                      <div className="tr-hudClockTime">{clockParts?.time}</div>
                    </div>
                  </div>

                  <div className="tr-hudActionsRow">
                    {hud.mode === "inactive" ? (
                      <button
                        className={`tr-seg tr-hudActionBtn tr-seg--startBlue ${hud.nextSessionId ? "is-enabled tr-pulse" : ""}`}
                        disabled={!hud.nextSessionId}
                        onClick={() => hud.nextSessionId && startSession(hud.nextSessionId)}
                      >
                        START WORKOUT
                      </button>
                    ) : hud.mode === "no_program" ? (
                      <button
                        className="tr-seg tr-hudActionBtn tr-seg--startBlue is-enabled"
                        onClick={() => navigate("/coach")}
                      >
                        GO TO COACH
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="tr-hudTiles">
                  <div className="tr-rowbox">
                    <div className="tr-hudKicker">NEXT EXERCISE</div>
                    <div style={{ fontWeight: 950, fontSize: 16 }}>
                      {hud.mode === "inactive" ? displayOrNotSet(hud.nextFirstExercise, "Not set") : "Not set"}
                    </div>
                  </div>

                  <div className="tr-rowbox">
                    <div className="tr-hudKicker">BODY WEIGHT</div>
                    <div style={{ fontWeight: 950, fontSize: 16 }}>
                      {hud.mode === "inactive" && hud.displayWeightLb != null ? `${hud.displayWeightLb} lb` : "Not set"}
                    </div>
                    <div className="tr-hudStripSub" style={{ marginTop: 6 }}>
                      {hud.mode === "inactive" ? "Last completed" : ""}
                    </div>
                  </div>

                  <div className="tr-rowbox">
                    <div className="tr-hudKicker">PROTEIN TARGET</div>
                    <div style={{ fontWeight: 950, fontSize: 16 }}>
                      {hud.mode === "inactive" && hud.proteinTargetG != null ? `${hud.proteinTargetG}g` : "Not set"}
                    </div>
                  </div>

                  <div className="tr-rowbox">
                    <div className="tr-hudKicker">STATUS</div>
                    <div style={{ fontWeight: 950, fontSize: 16 }}>
                      {hud.mode === "inactive" ? "READY" : hud.mode === "no_program" ? "NO PROGRAM" : "SIGN IN"}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>

        {children}
      </div>

      <div className="tr-bottomNavWrap">
        <div className="tr-bottomNavInner">
          <button style={tabStyle(activeTab("/"))} onClick={() => navigate("/")}>
            WORKOUTS
          </button>
          <button style={tabStyle(activeTab("/library"))} onClick={() => navigate("/library")}>
            LIBRARY
          </button>
          <button style={tabStyle(activeTab("/progress"))} onClick={() => navigate("/progress")}>
            PROGRESS
          </button>
          <button style={tabStyle(activeTab("/coach"))} onClick={() => navigate("/coach")}>
            COACH
          </button>
        </div>
      </div>

      {endOpen && typeof document !== "undefined"
        ? createPortal(
            <div className="tr-modalOverlay tr-modalOverlay--locked" role="dialog" aria-modal="true" aria-label="Save workout">
              <div className="tr-modal tr-modal--viewport">
            <div className="tr-modalHead">
              <div style={{ fontWeight: 950 }}>How was it?</div>
              <button className="tr-btn" onClick={() => setEndOpen(false)} disabled={endBusy}>
                Close
              </button>
            </div>

            <div className="tr-modalBody" style={{ display: "grid", gap: 12, padding: 16 }}>
              <div className="tr-rowbox">
                <div className="tr-kicker">DIFFICULTY (REQUIRED)</div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
                  <button
                    className={`tr-seg ${endDifficulty === "too_easy" ? "is-active" : ""}`}
                    onClick={() => setEndDifficulty("too_easy")}
                    disabled={endBusy}
                  >
                    Too easy
                  </button>
                  <button
                    className={`tr-seg ${endDifficulty === "just_right" ? "is-active" : ""}`}
                    onClick={() => setEndDifficulty("just_right")}
                    disabled={endBusy}
                  >
                    Just right
                  </button>
                  <button
                    className={`tr-seg ${endDifficulty === "too_hard" ? "is-active" : ""}`}
                    onClick={() => setEndDifficulty("too_hard")}
                    disabled={endBusy}
                  >
                    Too hard
                  </button>
                </div>
              </div>

              <div className="tr-rowbox">
                <div className="tr-kicker">NOTES (OPTIONAL)</div>
                <textarea
                  value={endNotes}
                  onChange={(e) => setEndNotes(e.target.value)}
                  placeholder="Anything you want to remember (pain, tweaks, energy, etc.)"
                  style={{ width: "100%", minHeight: 110, marginTop: 10, resize: "vertical" }}
                  disabled={endBusy}
                />
              </div>

            </div>

            <div className="tr-modalFooter">
              <button
                className="tr-btn tr-btn--primary"
                style={{ height: 52 }}
                onClick={submitEndWorkout}
                disabled={endBusy || !endDifficulty}
              >
                {endBusy ? "Saving…" : "SAVE WORKOUT"}
              </button>
            </div>
              </div>
            </div>,
            document.body
          )
        : null}

      <style>{HUD_FORCE_CSS}</style>
    </div>
  );
}
