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

type Difficulty = "too_easy" | "just_right" | "too_hard";

type ActiveExerciseSummary = {
  currentName: string | null;
  currentPosition: string;
  nextName: string | null;
  completedExercises: number;
  totalExercises: number;
};

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
      readiness: "READY" | "SCHEDULED";
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
      exercise: ActiveExerciseSummary;
    };

function lsGet(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

function lsDel(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {}
}

function clearActiveStorage() {
  Object.values(LS).forEach((key) => lsDel(key));
}

function toHHMMSS(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function fmtClockParts(timestamp: number) {
  const date = new Date(timestamp);
  const dateLabel = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
  const timeLabel = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  return { date: dateLabel, time: timeLabel };
}

function normalize(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function displayOrNotSet(value: unknown, fallback = "Not set") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function proteinMultiplier(goal: string | null | undefined) {
  const normalizedGoal = normalize(goal);
  return normalizedGoal === "cut" || normalizedGoal === "lose_weight" ? 1 : 0.9;
}

function roundProtein(value: number) {
  return Math.round(value / 5) * 5;
}

function difficultyToRating(difficulty: Difficulty) {
  if (difficulty === "too_easy") return 1;
  if (difficulty === "just_right") return 2;
  return 3;
}

function extractPositionIndex(position: string | null, total: number) {
  if (!position) return null;
  const match = position.match(/\d+/);
  if (!match) return null;

  const oneBased = Number(match[0]);
  if (!Number.isFinite(oneBased) || oneBased < 1) return null;
  return Math.min(Math.max(oneBased - 1, 0), Math.max(0, total - 1));
}

function lockDocumentForModal() {
  const appWindow = window as typeof window & {
    __mvpTrainerModalLock?: {
      count: number;
      syncVisualViewport: () => void;
      releaseRoot: () => void;
    };
  };

  const existing = appWindow.__mvpTrainerModalLock;
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

  const previousBody = {
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    width: body.style.width,
    height: body.style.height,
    overflow: body.style.overflow,
    overscrollBehavior: body.style.overscrollBehavior,
  };
  const previousHtml = {
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

  html.classList.add("tr-modal-open");
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

    if (Math.abs(deltaX) > Math.abs(deltaY) && target.closest(".tr-chipRow")) return;

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
    if ((atTop && deltaY > 0) || (atBottom && deltaY < 0)) event.preventDefault();
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

    body.style.position = previousBody.position;
    body.style.top = previousBody.top;
    body.style.left = previousBody.left;
    body.style.right = previousBody.right;
    body.style.width = previousBody.width;
    body.style.height = previousBody.height;
    body.style.overflow = previousBody.overflow;
    body.style.overscrollBehavior = previousBody.overscrollBehavior;
    html.style.width = previousHtml.width;
    html.style.height = previousHtml.height;
    html.style.overflow = previousHtml.overflow;
    html.style.overscrollBehavior = previousHtml.overscrollBehavior;
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

const SHELL_GUARD_CSS = `
.tr-shellRoot{
  position:relative;
  isolation:isolate;
  width:100%;
  max-width:100%;
  min-width:0;
  min-height:100vh;
  min-height:100dvh;
  overflow-x:clip;
  background:#0b0d10;
  color:rgba(255,255,255,.92);
}
.tr-shellInner{
  position:relative;
  z-index:1;
  width:100%;
  max-width:1120px;
  min-width:0;
  margin:0 auto;
  padding:max(16px,env(safe-area-inset-top)) max(18px,env(safe-area-inset-right)) calc(128px + env(safe-area-inset-bottom)) max(18px,env(safe-area-inset-left));
}
.tr-bottomNavWrap{
  position:fixed;
  left:0;
  right:0;
  bottom:0;
  z-index:1200;
  background:rgba(6,8,10,.97);
  border-top:1px solid rgba(0,170,255,.14);
  box-shadow:0 -24px 70px rgba(0,0,0,.78);
}
.tr-bottomNavInner{
  max-width:1120px;
  margin:0 auto;
  display:flex;
  gap:10px;
  padding:12px max(18px,env(safe-area-inset-right)) max(14px,env(safe-area-inset-bottom)) max(18px,env(safe-area-inset-left));
}
@media(max-width:720px){
  .tr-shellInner{
    padding:max(10px,env(safe-area-inset-top)) max(10px,env(safe-area-inset-right)) calc(108px + env(safe-area-inset-bottom)) max(10px,env(safe-area-inset-left));
  }
  .tr-bottomNavInner{
    display:grid;
    grid-template-columns:repeat(4,minmax(0,1fr));
    gap:7px;
    padding:9px max(8px,env(safe-area-inset-right)) max(10px,env(safe-area-inset-bottom)) max(8px,env(safe-area-inset-left));
  }
  .tr-bottomNavInner button{
    min-width:0!important;
    width:100%!important;
    padding:10px 6px!important;
    font-size:10px!important;
    line-height:12px!important;
  }
}

/* ============================================================
   STEP 8B UI RESTORE
   Restores the production command center/header styling while
   keeping the Step 8 stability, polling and restart diagnostics.
   ============================================================ */

.tr-appHeader{
  width:100%;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:14px;
  margin:0 0 12px;
  min-width:0;
}

.tr-topTitle{
  position:relative;
  display:inline-block;
  min-width:0;
  margin:0;
  color:#ffe268;
  font-size:24px;
  line-height:1;
  font-weight:1000;
  letter-spacing:.02em;
  text-shadow:
    0 1px 0 rgba(0,0,0,.88),
    0 3px 8px rgba(0,0,0,.42),
    0 0 18px rgba(255,200,52,.12);
}

.tr-appHeaderActions{
  display:flex;
  align-items:center;
  justify-content:flex-end;
  gap:8px;
  flex-wrap:wrap;
}

.tr-appHeaderButton{
  appearance:none;
  min-height:38px;
  padding:0 13px;
  border-radius:11px;
  border:1px solid rgba(255,255,255,.10);
  color:rgba(241,247,250,.88);
  background:
    linear-gradient(180deg,rgba(255,255,255,.055),rgba(0,0,0,.16)),
    #0d141a;
  box-shadow:
    0 1px 1px rgba(0,0,0,.45),
    0 4px 10px rgba(0,0,0,.18),
    inset 0 1px 0 rgba(255,255,255,.045),
    inset 0 -1px 0 rgba(0,0,0,.52);
  font:inherit;
  font-size:10px;
  line-height:1;
  font-weight:1000;
  letter-spacing:.075em;
  cursor:pointer;
  transition:
    transform .14s ease,
    border-color .14s ease,
    background .14s ease,
    color .14s ease;
}

.tr-appHeaderButton:hover{
  transform:translateY(-1px);
  color:#fff;
}

.tr-appHeaderButton:active{
  transform:translateY(1px);
}

.tr-appHeaderButton.is-music{
  border-color:rgba(245,167,40,.30);
  color:#ffe3b5;
  background:
    linear-gradient(180deg,rgba(255,186,72,.10),rgba(58,31,3,.18)),
    #11120f;
}

.tr-appHeaderButton.is-alerts{
  border-color:rgba(59,189,237,.28);
  color:#bfeeff;
  background:
    linear-gradient(180deg,rgba(37,174,225,.10),rgba(2,42,58,.18)),
    #0b1217;
}

.tr-appHeaderButton.is-signout{
  color:rgba(231,237,240,.72);
}

.tr-appHeaderButton:disabled{
  opacity:.55;
  cursor:not-allowed;
  transform:none;
}

.tr-commandMessage{
  margin:10px 0 12px;
  padding:10px 12px;
  border:1px solid rgba(255,115,115,.22);
  border-radius:11px;
  color:#ffd8d8;
  background:rgba(95,24,24,.20);
  font-size:11px;
  font-weight:850;
}

/* Command center shell */
.tr-commandCenter{
  position:relative;
  isolation:isolate;
  width:100%;
  min-width:0;
  overflow:hidden;
  margin:12px 0 14px;
  border:1px solid rgba(42,162,205,.28);
  border-top-color:rgba(104,208,244,.34);
  border-bottom-color:rgba(22,83,105,.28);
  border-radius:18px;
  background:
    linear-gradient(180deg,rgba(17,34,45,.97),rgba(7,15,21,.99));
  box-shadow:
    0 1px 0 rgba(255,255,255,.035),
    0 4px 10px rgba(0,0,0,.30),
    0 18px 42px rgba(0,0,0,.22),
    inset 0 1px 0 rgba(255,255,255,.045),
    inset 0 -1px 0 rgba(0,0,0,.65);
}

.tr-commandCenter::before{
  content:"";
  position:absolute;
  z-index:0;
  inset:0;
  pointer-events:none;
  background:
    linear-gradient(90deg,rgba(17,150,203,.08),transparent 20%),
    linear-gradient(180deg,rgba(255,255,255,.018),transparent 16%);
}

.tr-commandCenter::after{
  content:"";
  position:absolute;
  z-index:1;
  left:22px;
  right:22px;
  top:0;
  height:1px;
  pointer-events:none;
  background:linear-gradient(
    90deg,
    transparent,
    rgba(175,230,250,.26) 18%,
    rgba(96,192,227,.12) 68%,
    transparent
  );
}

.tr-commandCenter > *{
  position:relative;
  z-index:2;
}

.tr-commandCenter--large{
  border-radius:19px;
}

.tr-commandCenter--compact{
  margin-top:10px;
}

.tr-commandSectionLabel{
  color:#6bd5f6;
  font-size:9px;
  line-height:1;
  font-weight:1000;
  letter-spacing:.17em;
  text-transform:uppercase;
}

/* Inactive command center */
.tr-commandInactive{
  display:grid;
  grid-template-columns:minmax(190px,.88fr) minmax(300px,1.34fr) minmax(190px,.88fr);
  grid-template-areas:
    "status clock action"
    "metrics metrics metrics";
  align-items:center;
  gap:13px 15px;
  padding:18px;
}

.tr-commandDateTime{
  grid-area:clock;
  min-width:0;
  display:grid;
  justify-items:center;
  align-content:center;
  gap:3px;
  text-align:center;
  padding:8px 12px;
}

.tr-commandDateTime > span{
  max-width:100%;
  color:#f2f6f8;
  font-size:18px;
  line-height:1.1;
  font-weight:950;
  letter-spacing:-.025em;
  white-space:nowrap;
}

.tr-commandDateTime > strong{
  color:#ffe16b;
  font-size:34px;
  line-height:1;
  font-weight:1000;
  letter-spacing:-.045em;
  font-variant-numeric:tabular-nums;
  text-shadow:
    0 2px 4px rgba(0,0,0,.38),
    0 0 16px rgba(255,209,67,.09);
}

.tr-commandDateTime > small{
  color:rgba(151,184,200,.45);
  font-size:7px;
  line-height:1;
  font-weight:1000;
  letter-spacing:.15em;
}

.tr-commandNextWorkout{
  grid-area:status;
  min-width:0;
  display:grid;
  align-content:center;
  gap:5px;
  padding:7px 8px 7px 2px;
}

.tr-commandNextWorkout > strong{
  color:#72e7a5;
  font-size:22px;
  line-height:1;
  font-weight:1000;
  letter-spacing:-.025em;
}

.tr-commandNextWorkout > span{
  color:rgba(203,222,232,.58);
  font-size:10px;
  line-height:1.35;
  font-weight:800;
}

.tr-commandMetricRail{
  display:grid;
  grid-template-columns:repeat(3,minmax(0,1fr));
  gap:9px;
  min-width:0;
}

.tr-commandMetricRail--inactive{
  grid-area:metrics;
  grid-template-columns:repeat(2,minmax(0,1fr));
}

.tr-commandMetricRail--inactive .tr-commandMetric.is-status{
  display:none;
}

.tr-commandMetric{
  position:relative;
  min-width:0;
  min-height:76px;
  display:grid;
  justify-items:center;
  align-content:center;
  gap:4px;
  padding:10px 12px;
  overflow:hidden;
  border:1px solid rgba(120,188,212,.10);
  border-top-color:rgba(168,219,237,.15);
  border-bottom-color:rgba(24,52,64,.34);
  border-radius:12px;
  background:
    linear-gradient(180deg,rgba(18,28,35,.92),rgba(8,14,19,.96));
  box-shadow:
    0 1px 1px rgba(0,0,0,.38),
    inset 0 1px 0 rgba(255,255,255,.028),
    inset 0 -1px 0 rgba(0,0,0,.58);
  text-align:center;
}

.tr-commandMetric > span{
  color:rgba(139,173,189,.47);
  font-size:7px;
  line-height:1;
  font-weight:1000;
  letter-spacing:.14em;
  text-transform:uppercase;
}

.tr-commandMetric > strong{
  color:#f2f6f8;
  font-size:24px;
  line-height:1;
  font-weight:1000;
  letter-spacing:-.025em;
  font-variant-numeric:tabular-nums;
}

.tr-commandMetric > small{
  color:rgba(169,194,206,.44);
  font-size:8px;
  line-height:1.2;
  font-weight:750;
}

.tr-commandActions{
  display:flex;
  align-items:center;
  gap:8px;
}

.tr-commandActions--inactive{
  grid-area:action;
  justify-content:flex-end;
}

.tr-commandButton{
  appearance:none;
  min-height:45px;
  min-width:0;
  padding:0 18px;
  border:1px solid rgba(100,196,229,.38);
  border-top-color:rgba(151,222,247,.48);
  border-bottom-color:rgba(13,68,89,.62);
  border-radius:11px;
  color:#f3fbff;
  background:
    linear-gradient(180deg,#17799f 0%,#0d607f 100%);
  box-shadow:
    0 1px 1px rgba(0,0,0,.40),
    0 4px 9px rgba(0,0,0,.23),
    inset 0 1px 0 rgba(255,255,255,.12),
    inset 0 -2px 4px rgba(0,0,0,.18);
  font:inherit;
  font-size:9px;
  line-height:1;
  font-weight:1000;
  letter-spacing:.08em;
  cursor:pointer;
  transition:
    transform .14s ease,
    border-color .14s ease,
    background .14s ease;
}

.tr-commandButton:hover:not(:disabled){
  transform:translateY(-1px);
  background:linear-gradient(180deg,#1b84aa 0%,#126b8b 100%);
}

.tr-commandButton:active:not(:disabled){
  transform:translateY(1px);
}

.tr-commandButton:disabled{
  opacity:.42;
  cursor:not-allowed;
}

.tr-commandButton.is-start{
  width:100%;
  max-width:185px;
  min-height:48px;
}

.tr-commandButton.is-end{
  border-color:rgba(220,88,88,.28);
  color:#ffd2d2;
  background:linear-gradient(180deg,rgba(113,36,36,.82),rgba(65,21,21,.84));
}

.tr-commandButton.is-pause,
.tr-commandButton.is-return{
  background:linear-gradient(180deg,#176b89,#0e5069);
}

.tr-commandButton.is-resume{
  border-color:rgba(92,212,148,.33);
  background:linear-gradient(180deg,#19724e,#10523a);
}

/* Active command center */
.tr-commandActive{
  display:grid;
  gap:12px;
  padding:16px 18px 17px;
}

.tr-commandActiveTopline{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:14px;
  padding-bottom:10px;
  border-bottom:1px solid rgba(124,191,216,.08);
}

.tr-commandLiveIdentity{
  display:flex;
  align-items:center;
  gap:9px;
}

.tr-commandLiveDot{
  width:9px;
  height:9px;
  border-radius:50%;
  flex:0 0 9px;
}

.tr-commandLiveDot.is-running{
  background:#61e29d;
  box-shadow:0 0 0 3px rgba(97,226,157,.07),0 0 11px rgba(97,226,157,.24);
}

.tr-commandLiveDot.is-paused{
  background:#e8bd69;
  box-shadow:0 0 0 3px rgba(232,189,105,.07),0 0 11px rgba(232,189,105,.20);
}

.tr-commandLiveIdentity > div{
  display:grid;
  gap:2px;
}

.tr-commandLiveIdentity span{
  color:rgba(132,178,198,.52);
  font-size:7px;
  font-weight:1000;
  letter-spacing:.15em;
}

.tr-commandLiveIdentity strong{
  color:#eaf5f9;
  font-size:13px;
  line-height:1;
  font-weight:1000;
  letter-spacing:.08em;
}

.tr-commandRealClock{
  display:flex;
  align-items:baseline;
  justify-content:flex-end;
  gap:9px;
  min-width:0;
}

.tr-commandRealClock span{
  color:rgba(198,217,226,.62);
  font-size:10px;
  font-weight:850;
  white-space:nowrap;
}

.tr-commandRealClock strong{
  color:#f0d46b;
  font-size:19px;
  line-height:1;
  font-weight:1000;
  font-variant-numeric:tabular-nums;
  white-space:nowrap;
}

.tr-commandActiveGrid{
  display:grid;
  grid-template-columns:minmax(235px,.74fr) minmax(0,1.26fr);
  gap:11px;
}

.tr-commandChronograph,
.tr-commandExercisePanel{
  min-width:0;
  border:1px solid rgba(116,189,215,.10);
  border-top-color:rgba(168,220,239,.14);
  border-radius:13px;
  background:linear-gradient(180deg,rgba(16,27,35,.93),rgba(7,13,18,.96));
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.025),
    inset 0 -1px 0 rgba(0,0,0,.55);
}

.tr-commandChronograph{
  display:grid;
  align-content:center;
  justify-items:center;
  padding:13px;
}

.tr-commandChronographTime{
  margin-top:5px;
  color:#f7fbfd;
  font-size:40px;
  line-height:1;
  font-weight:1000;
  letter-spacing:-.055em;
  font-variant-numeric:tabular-nums;
}

.tr-commandChronographUnits{
  width:min(190px,80%);
  display:grid;
  grid-template-columns:repeat(3,1fr);
  margin-top:4px;
  color:rgba(129,168,185,.42);
  font-size:6px;
  font-weight:1000;
  letter-spacing:.13em;
  text-align:center;
}

.tr-commandExercisePanel{
  padding:13px 14px;
}

.tr-commandExerciseHead{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  color:rgba(126,174,194,.49);
  font-size:7px;
  font-weight:1000;
  letter-spacing:.13em;
}

.tr-commandExerciseHead strong{
  color:#5fcdf2;
}

.tr-commandExerciseName{
  margin-top:6px;
  color:#f4f9fb;
  font-size:23px;
  line-height:1.05;
  font-weight:1000;
  letter-spacing:-.03em;
}

.tr-commandExerciseProgram{
  margin-top:4px;
  color:rgba(181,204,215,.49);
  font-size:9px;
  font-weight:800;
}

.tr-commandNextExercise{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  margin-top:12px;
  padding-top:10px;
  border-top:1px solid rgba(122,187,211,.08);
}

.tr-commandNextExercise span{
  color:rgba(126,171,190,.46);
  font-size:7px;
  font-weight:1000;
  letter-spacing:.13em;
}

.tr-commandNextExercise strong{
  min-width:0;
  color:rgba(225,237,243,.76);
  font-size:11px;
  font-weight:900;
  text-align:right;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}

.tr-commandActions--active{
  justify-content:flex-end;
  flex-wrap:wrap;
}

/* Compact shell mode used away from main Workouts */
.tr-commandCenter--compact .tr-commandInactive{
  grid-template-columns:minmax(170px,.8fr) minmax(260px,1.2fr) minmax(150px,.7fr);
  padding:13px 15px;
  gap:10px 12px;
}

.tr-commandCenter--compact .tr-commandDateTime > span{
  font-size:14px;
}

.tr-commandCenter--compact .tr-commandDateTime > strong{
  font-size:27px;
}

.tr-commandCenter--compact .tr-commandMetric{
  min-height:64px;
}

.tr-commandCenter--compact .tr-commandMetric > strong{
  font-size:20px;
}

/* Mobile */
@media(max-width:820px){
  .tr-appHeader{
    align-items:flex-start;
  }

  .tr-appHeaderActions{
    gap:6px;
  }

  .tr-appHeaderButton{
    min-height:34px;
    padding:0 9px;
    font-size:8px;
  }

  .tr-commandInactive{
    grid-template-columns:1fr 1fr;
    grid-template-areas:
      "status clock"
      "metrics metrics"
      "action action";
    padding:14px;
  }

  .tr-commandActions--inactive{
    justify-content:stretch;
  }

  .tr-commandButton.is-start{
    max-width:none;
  }

  .tr-commandActiveGrid{
    grid-template-columns:1fr;
  }
}

@media(max-width:560px){
  .tr-appHeader{
    display:grid;
    grid-template-columns:1fr;
    gap:9px;
  }

  .tr-topTitle{
    font-size:21px;
  }

  .tr-appHeaderActions{
    justify-content:flex-start;
    width:100%;
    overflow-x:auto;
    flex-wrap:nowrap;
    scrollbar-width:none;
  }

  .tr-appHeaderActions::-webkit-scrollbar{
    display:none;
  }

  .tr-commandCenter{
    margin:9px 0 12px;
    border-radius:15px;
  }

  .tr-commandInactive,
  .tr-commandCenter--compact .tr-commandInactive{
    grid-template-columns:1fr;
    grid-template-areas:
      "clock"
      "status"
      "metrics"
      "action";
    gap:10px;
    padding:12px;
  }

  .tr-commandDateTime{
    padding:3px 4px 9px;
    border-bottom:1px solid rgba(119,188,214,.08);
  }

  .tr-commandDateTime > span,
  .tr-commandCenter--compact .tr-commandDateTime > span{
    font-size:13px;
  }

  .tr-commandDateTime > strong,
  .tr-commandCenter--compact .tr-commandDateTime > strong{
    font-size:30px;
  }

  .tr-commandNextWorkout{
    padding:3px 2px;
  }

  .tr-commandNextWorkout > strong{
    font-size:19px;
  }

  .tr-commandMetricRail,
  .tr-commandMetricRail--inactive{
    grid-template-columns:repeat(2,minmax(0,1fr));
    gap:7px;
  }

  .tr-commandMetric{
    min-height:66px;
    padding:8px;
    border-radius:10px;
  }

  .tr-commandMetric > strong{
    font-size:20px;
  }

  .tr-commandActive{
    padding:12px;
  }

  .tr-commandActiveTopline{
    align-items:flex-start;
  }

  .tr-commandRealClock{
    display:grid;
    justify-items:end;
    gap:2px;
  }

  .tr-commandRealClock span{
    font-size:8px;
  }

  .tr-commandRealClock strong{
    font-size:16px;
  }

  .tr-commandChronographTime{
    font-size:clamp(35px,11vw,46px);
  }

  .tr-commandExerciseName{
    font-size:20px;
  }

  .tr-commandActions--active{
    display:grid;
    grid-template-columns:1fr;
  }

  .tr-commandActions--active .tr-commandButton{
    width:100%;
  }
}

@media(prefers-reduced-motion:reduce){
  .tr-appHeaderButton,
  .tr-commandButton{
    transition:none!important;
  }
}
`;


const RUNTIME_DIAGNOSTICS_KEY = "mvp_runtime_diagnostics_v1";

type RuntimeDiagnosticsRecord = {
  bootId: string;
  startedAt: number;
  lastHeartbeatAt: number;
  route: string;
  cleanExit: boolean;
  navigationType: string;
  lastError: string | null;
  heapUsedMb: number | null;
  heapLimitMb: number | null;
};

function readRuntimeDiagnostics(): RuntimeDiagnosticsRecord | null {
  try {
    const raw = localStorage.getItem(RUNTIME_DIAGNOSTICS_KEY);
    return raw ? (JSON.parse(raw) as RuntimeDiagnosticsRecord) : null;
  } catch {
    return null;
  }
}

function writeRuntimeDiagnostics(record: RuntimeDiagnosticsRecord) {
  try {
    localStorage.setItem(RUNTIME_DIAGNOSTICS_KEY, JSON.stringify(record));
  } catch {
    // Diagnostics must never interfere with the app.
  }
}

function getNavigationType() {
  try {
    const entry = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    return entry?.type ?? "unknown";
  } catch {
    return "unknown";
  }
}

function readHeapSnapshot() {
  try {
    const memory = (performance as Performance & {
      memory?: {
        usedJSHeapSize?: number;
        jsHeapSizeLimit?: number;
      };
    }).memory;

    const used =
      typeof memory?.usedJSHeapSize === "number"
        ? Math.round((memory.usedJSHeapSize / 1024 / 1024) * 10) / 10
        : null;
    const limit =
      typeof memory?.jsHeapSizeLimit === "number"
        ? Math.round((memory.jsHeapSizeLimit / 1024 / 1024) * 10) / 10
        : null;

    return { used, limit };
  } catch {
    return { used: null, limit: null };
  }
}

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
  const [message, setMessage] = useState<string | null>(null);
  const [hud, setHud] = useState<Hud>({ mode: "signed_out" });
  const [nowTick, setNowTick] = useState(Date.now());

  const [endOpen, setEndOpen] = useState(false);
  const [endDifficulty, setEndDifficulty] = useState<Difficulty | "">("");
  const [endNotes, setEndNotes] = useState("");
  const [endBusy, setEndBusy] = useState(false);

  const pollRef = useRef<ReturnType<typeof window.setInterval> | null>(null);
  const refreshInFlightRef = useRef(false);
  const isWorkoutSession = currentPath.startsWith("/workout/");
  const isWorkoutsTab = currentPath === "/" || isWorkoutSession;
  const hudVariant = isWorkoutSession ? "hero" : isWorkoutsTab ? "large" : "compact";

  useEffect(() => {
    if (hideChrome) return;

    const previous = readRuntimeDiagnostics();
    const now = Date.now();
    const heap = readHeapSnapshot();
    const bootId = `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    const record: RuntimeDiagnosticsRecord = {
      bootId,
      startedAt: now,
      lastHeartbeatAt: now,
      route: currentPath,
      cleanExit: false,
      navigationType: getNavigationType(),
      lastError: null,
      heapUsedMb: heap.used,
      heapLimitMb: heap.limit,
    };

    if (
      previous &&
      !previous.cleanExit &&
      now - previous.lastHeartbeatAt < 5 * 60 * 1000
    ) {
      console.warn("MVP Trainer detected a previous unexpected restart.", {
        previousRoute: previous.route,
        previousSessionSeconds: Math.max(
          0,
          Math.round((previous.lastHeartbeatAt - previous.startedAt) / 1000)
        ),
        previousNavigationType: previous.navigationType,
        previousError: previous.lastError,
        previousHeapUsedMb: previous.heapUsedMb,
        previousHeapLimitMb: previous.heapLimitMb,
      });
    }

    writeRuntimeDiagnostics(record);

    const heartbeat = () => {
      const current = readRuntimeDiagnostics();
      if (!current || current.bootId !== bootId) return;

      const memory = readHeapSnapshot();
      writeRuntimeDiagnostics({
        ...current,
        lastHeartbeatAt: Date.now(),
        route: window.location.pathname,
        heapUsedMb: memory.used,
        heapLimitMb: memory.limit,
      });
    };

    const heartbeatTimer = window.setInterval(heartbeat, 15000);

    const recordError = (message: string) => {
      const current = readRuntimeDiagnostics();
      if (!current || current.bootId !== bootId) return;

      writeRuntimeDiagnostics({
        ...current,
        lastHeartbeatAt: Date.now(),
        lastError: message.slice(0, 1200),
      });
    };

    const onError = (event: ErrorEvent) => {
      recordError(
        [
          event.message,
          event.filename,
          event.lineno ? `line ${event.lineno}` : "",
        ]
          .filter(Boolean)
          .join(" • ")
      );
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason =
        event.reason instanceof Error
          ? `${event.reason.name}: ${event.reason.message}`
          : String(event.reason ?? "Unhandled promise rejection");
      recordError(reason);
    };

    const markCleanExit = () => {
      const current = readRuntimeDiagnostics();
      if (!current || current.bootId !== bootId) return;

      writeRuntimeDiagnostics({
        ...current,
        lastHeartbeatAt: Date.now(),
        cleanExit: true,
      });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    window.addEventListener("pagehide", markCleanExit);
    window.addEventListener("beforeunload", markCleanExit);

    return () => {
      window.clearInterval(heartbeatTimer);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      window.removeEventListener("pagehide", markCleanExit);
      window.removeEventListener("beforeunload", markCleanExit);
    };
  }, [hideChrome]);

  useEffect(() => {
    if (hideChrome) return;

    const current = readRuntimeDiagnostics();
    if (!current) return;

    writeRuntimeDiagnostics({
      ...current,
      route: currentPath,
      lastHeartbeatAt: Date.now(),
    });
  }, [currentPath, hideChrome]);

  useEffect(() => {
    if (!endOpen) return;
    return lockDocumentForModal();
  }, [endOpen]);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setUser(data.user ?? null));
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    setNowTick(Date.now());

    const intervalMs = hud.mode === "active" ? 1000 : 30000;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      setNowTick(Date.now());
    }, intervalMs);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        setNowTick(Date.now());
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [hud.mode]);

  const signOut = async () => {
    setMessage(null);
    setBusy(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) setMessage(error.message);
      clearActiveStorage();
      navigate("/login");
    } finally {
      setBusy(false);
    }
  };

  const activeTab = (path: string) => {
    if (path === "/") return currentPath === "/" || currentPath.startsWith("/workout/");
    return currentPath.startsWith(path);
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: "12px 10px",
    borderRadius: 14,
    cursor: "pointer",
    fontWeight: 950,
    color: active ? "rgba(255,255,255,.98)" : "rgba(255,255,255,.82)",
    letterSpacing: ".08em",
    textTransform: "uppercase",
    fontSize: 12.5,
    lineHeight: "16px",
    transition: "transform .14s ease, border-color .14s ease, background .14s ease, box-shadow .14s ease",
    background: active ? "rgba(0,170,255,.13)" : "rgba(0,0,0,.20)",
    border: active ? "2px solid rgba(0,170,255,.72)" : "2px solid rgba(255,255,255,.18)",
    boxShadow: active
      ? "0 0 0 1px rgba(0,170,255,.16) inset, 0 12px 34px rgba(0,0,0,.55), 0 0 20px rgba(0,170,255,.16)"
      : "0 0 0 1px rgba(255,255,255,.07) inset, 0 12px 34px rgba(0,0,0,.45)",
  });

  async function resolveActiveWorkoutDbFirst(): Promise<{
    workoutId: string;
    sessionId: string;
    startedAtISO: string;
    bodyweightLb: number | null;
  } | null> {
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    if (!auth.user) return null;

    const { data: workout, error } = await supabase
      .from("workouts")
      .select("id, scheduled_session_id, started_at, performed_at, bodyweight_lb")
      .eq("user_id", auth.user.id)
      .is("completed_at", null)
      .not("started_at", "is", null)
      .order("started_at", { ascending: false, nullsFirst: false })
      .order("performed_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!workout?.id || !workout?.scheduled_session_id || !workout.started_at) return null;

    const { data: exerciseRows, error: exerciseError } = await supabase
      .from("workout_exercises")
      .select("id")
      .eq("workout_id", workout.id)
      .limit(1);

    if (exerciseError) throw exerciseError;

    if (!exerciseRows?.length) {
      const endedAt = new Date().toISOString();
      await supabase
        .from("workouts")
        .update({ ended_at: endedAt, completed_at: endedAt, active_seconds: 0 })
        .eq("id", workout.id);
      return null;
    }

    return {
      workoutId: workout.id,
      sessionId: workout.scheduled_session_id,
      startedAtISO: workout.started_at,
      bodyweightLb: workout.bodyweight_lb != null ? Number(workout.bodyweight_lb) : null,
    };
  }

  async function loadActiveExerciseSummary(workoutId: string): Promise<ActiveExerciseSummary> {
    const fallbackName = lsGet(LS.activeExerciseName);
    const fallbackPosition = lsGet(LS.activeExercisePos);

    const { data: rows, error } = await supabase
      .from("workout_exercises")
      .select("id, exercise_id, order_index, completed_at")
      .eq("workout_id", workoutId)
      .order("order_index", { ascending: true });

    if (error) throw error;

    const ordered = (rows ?? []) as Array<{
      id: string;
      exercise_id: string;
      order_index: number | null;
      completed_at: string | null;
    }>;

    if (!ordered.length) {
      return {
        currentName: fallbackName,
        currentPosition: fallbackPosition || "IN SESSION",
        nextName: null,
        completedExercises: 0,
        totalExercises: 0,
      };
    }

    const exerciseIds = Array.from(new Set(ordered.map((row) => row.exercise_id).filter(Boolean)));
    const nameMap = new Map<string, string>();

    if (exerciseIds.length) {
      const { data: exercises, error: exerciseError } = await supabase
        .from("exercises")
        .select("id, name")
        .in("id", exerciseIds);

      if (exerciseError) throw exerciseError;
      for (const exercise of exercises ?? []) {
        nameMap.set((exercise as any).id, (exercise as any).name);
      }
    }

    const names = ordered.map((row, index) => nameMap.get(row.exercise_id) || `Exercise ${index + 1}`);
    const normalizedFallbackName = normalize(fallbackName);
    const nameIndex = normalizedFallbackName
      ? names.findIndex((name) => normalize(name) === normalizedFallbackName)
      : -1;
    const positionIndex = extractPositionIndex(fallbackPosition, ordered.length);
    const firstUnfinishedIndex = ordered.findIndex((row) => !row.completed_at);

    const currentIndex =
      nameIndex >= 0
        ? nameIndex
        : positionIndex != null
        ? positionIndex
        : firstUnfinishedIndex >= 0
        ? firstUnfinishedIndex
        : ordered.length - 1;

    const completedExercises = ordered.filter((row) => Boolean(row.completed_at)).length;
    const currentName = fallbackName || names[currentIndex] || null;
    const nextName = currentIndex + 1 < names.length ? names[currentIndex + 1] : null;

    return {
      currentName,
      currentPosition: `${currentIndex + 1} OF ${ordered.length}`,
      nextName,
      completedExercises,
      totalExercises: ordered.length,
    };
  }

  async function fetchLatestSymptomKeyIfNeeded(goalMode: string | null): Promise<SymptomKey | null> {
    if (!isSymptomMode(goalMode)) return null;

    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user?.id) return null;

    const { data: intake } = await supabase
      .from("intake_snapshots")
      .select("symptoms, created_at")
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return inferSymptomKey((intake as any)?.symptoms ?? null);
  }

  async function fetchHud() {
    if (hideChrome) return;

    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;

    if (!auth.user) {
      setHud({ mode: "signed_out" });
      return;
    }

    const { data: activeBlock } = await supabase
      .from("program_blocks")
      .select("id, goal, goal_mode")
      .eq("user_id", auth.user.id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const goal = (activeBlock?.goal as string) ?? null;
    const goalMode = (activeBlock?.goal_mode as string) ?? null;
    const symptomKey = await fetchLatestSymptomKeyIfNeeded(goalMode);

    const { data: lastBodyWeight } = await supabase
      .from("workouts")
      .select("bodyweight_lb, completed_at")
      .eq("user_id", auth.user.id)
      .not("bodyweight_lb", "is", null)
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const latestCompletedWeight =
      lastBodyWeight?.bodyweight_lb != null ? Number(lastBodyWeight.bodyweight_lb) : null;

    const activeWorkout = await resolveActiveWorkoutDbFirst();
    if (activeWorkout) {
      lsSet(LS.activeWorkoutId, activeWorkout.workoutId);
      lsSet(LS.activeSessionId, activeWorkout.sessionId);

      const { data: session, error: sessionError } = await supabase
        .from("scheduled_sessions")
        .select("id, template_id, session_type")
        .eq("id", activeWorkout.sessionId)
        .maybeSingle();

      if (sessionError) throw sessionError;

      let templateName = "Session";
      const templateId = (session as any)?.template_id as string | null;
      if (templateId) {
        const { data: template, error: templateError } = await supabase
          .from("workout_templates")
          .select("id, name")
          .eq("id", templateId)
          .maybeSingle();

        if (templateError) throw templateError;
        if ((template as any)?.name) templateName = (template as any).name;
      }

      const bodyweightLb = activeWorkout.bodyweightLb;
      const proteinTargetG =
        bodyweightLb && bodyweightLb > 0
          ? roundProtein(bodyweightLb * proteinMultiplier(goal))
          : null;
      const exercise = await loadActiveExerciseSummary(activeWorkout.workoutId);

      setHud({
        mode: "active",
        workoutId: activeWorkout.workoutId,
        sessionId: activeWorkout.sessionId,
        templateName,
        sessionType: (session as any)?.session_type ?? null,
        goal,
        goalMode,
        symptomKey,
        startedAtISO: activeWorkout.startedAtISO,
        isPaused: lsGet(LS.isPaused) === "true",
        bodyweightLb,
        proteinTargetG,
        exercise,
      });
      return;
    }

    if (!activeBlock?.id) {
      clearActiveStorage();
      setHud({ mode: "no_program" });
      return;
    }

    const { data: queueDashboard, error: queueError } = await supabase.rpc("rpc_queue_dashboard", {
      p_keep: 7,
    });
    if (queueError) throw queueError;

    const next = (queueDashboard as any)?.nextSession ?? null;
    const nextSessionId = next?.id ?? null;
    const nextSessionType = next?.session_type ?? null;
    let nextTemplateName: string | null = null;

    if (next?.template_id) {
      const { data: template } = await supabase
        .from("workout_templates")
        .select("id, name")
        .eq("id", next.template_id)
        .maybeSingle();
      nextTemplateName = (template as any)?.name ?? null;
    }

    clearActiveStorage();

    const displayWeightLb =
      latestCompletedWeight && latestCompletedWeight > 0 ? latestCompletedWeight : null;
    const proteinTargetG = displayWeightLb
      ? roundProtein(displayWeightLb * proteinMultiplier(goal))
      : null;

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
      readiness: nextSessionId ? "READY" : "SCHEDULED",
    });
  }

  useEffect(() => {
    let cancelled = false;
    if (hideChrome) return;

    const refresh = async () => {
      if (
        cancelled ||
        refreshInFlightRef.current ||
        document.visibilityState !== "visible"
      ) {
        return;
      }

      refreshInFlightRef.current = true;

      try {
        await fetchHud();
      } catch (error) {
        console.warn("Could not refresh MVP Trainer command center.", error);
      } finally {
        refreshInFlightRef.current = false;
      }
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    };

    void refresh();

    if (pollRef.current) window.clearInterval(pollRef.current);

    const pollMs = hud.mode === "active" ? 10000 : 45000;
    pollRef.current = window.setInterval(() => void refresh(), pollMs);

    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);

      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [user?.id, currentPath, hideChrome, hud.mode]);

  const timerSeconds = useMemo(() => {
    if (hud.mode !== "active" || !hud.startedAtISO) return 0;

    const startMs = new Date(hud.startedAtISO).getTime();
    if (!Number.isFinite(startMs)) return 0;

    const elapsed = Math.max(0, Math.floor((nowTick - startMs) / 1000));
    const pausedTotal = Number(lsGet(LS.pausedTotal) ?? "0") || 0;
    const pausedAtISO = lsGet(LS.pausedAt);
    const paused = lsGet(LS.isPaused) === "true";

    if (paused && pausedAtISO) {
      const pausedAtMs = new Date(pausedAtISO).getTime();
      const currentPause = Math.max(0, Math.floor((nowTick - pausedAtMs) / 1000));
      return Math.max(0, elapsed - pausedTotal - currentPause);
    }

    return Math.max(0, elapsed - pausedTotal);
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
    const previousPausedTotal = Number(lsGet(LS.pausedTotal) ?? "0") || 0;
    if (pausedAtISO) {
      const pausedAtMs = new Date(pausedAtISO).getTime();
      const addedSeconds = Math.max(0, Math.floor((Date.now() - pausedAtMs) / 1000));
      lsSet(LS.pausedTotal, String(previousPausedTotal + addedSeconds));
    }

    lsSet(LS.isPaused, "false");
    lsDel(LS.pausedAt);
    setHud({ ...hud, isPaused: false });
  };

  const endEnabled = hud.mode === "active" && Boolean(hud.bodyweightLb && hud.bodyweightLb > 0);

  const onEndWorkout = () => {
    if (hud.mode !== "active") return;
    if (!hud.bodyweightLb || hud.bodyweightLb <= 0) {
      setMessage("Confirm today's body weight before ending the workout.");
      return;
    }

    setEndDifficulty("");
    setEndNotes("");
    setEndOpen(true);
  };

  useEffect(() => {
    const handler = () => onEndWorkout();
    window.addEventListener(END_WORKOUT_REQUEST_EVENT, handler);
    return () => window.removeEventListener(END_WORKOUT_REQUEST_EVENT, handler);
  }, [hud]);

  async function submitEndWorkout() {
    if (hud.mode !== "active") return;
    if (!endDifficulty) {
      setMessage("Pick workout difficulty before saving.");
      return;
    }

    setMessage(null);
    setEndBusy(true);

    try {
      const activeSeconds = timerSeconds;
      const endedAt = new Date().toISOString();
      const proteinTargetG = roundProtein(
        (hud.bodyweightLb || 0) * proteinMultiplier(hud.goal)
      );

      const { data: workoutExerciseRows, error: workoutExerciseError } = await supabase
        .from("workout_exercises")
        .select("order_index, exercise_id")
        .eq("workout_id", hud.workoutId)
        .order("order_index", { ascending: true });

      if (workoutExerciseError) throw workoutExerciseError;

      const exerciseIds = Array.from(
        new Set((workoutExerciseRows ?? []).map((row: any) => row.exercise_id).filter(Boolean))
      );
      const nameMap = new Map<string, string>();

      if (exerciseIds.length) {
        const { data: exercises, error: exerciseError } = await supabase
          .from("exercises")
          .select("id, name")
          .in("id", exerciseIds);

        if (exerciseError) throw exerciseError;
        for (const exercise of exercises ?? []) {
          nameMap.set((exercise as any).id, (exercise as any).name);
        }
      }

      const exerciseNames = (workoutExerciseRows ?? [])
        .map((row: any) => nameMap.get(row.exercise_id) ?? row.exercise_id)
        .filter(Boolean);

      const { error } = await supabase
        .from("workouts")
        .update({
          post_difficulty: endDifficulty,
          post_notes: endNotes.trim() || null,
          workout_summary: {
            template_name: hud.templateName || "Session",
            exercises: exerciseNames,
            duration_seconds: activeSeconds,
          },
          session_rating: difficultyToRating(endDifficulty),
          notes: endNotes.trim() || null,
          ended_at: endedAt,
          completed_at: endedAt,
          active_seconds: activeSeconds,
          protein_target_g: proteinTargetG,
        })
        .eq("id", hud.workoutId);

      if (error) throw error;

      clearActiveStorage();
      setEndOpen(false);
      await fetchHud();
      navigate("/progress");
    } catch (error: any) {
      setMessage(error?.message ?? String(error));
    } finally {
      setEndBusy(false);
    }
  }

  if (hideChrome) {
    return (
      <div style={{ minHeight: "100vh", background: "#0b0d10", color: "rgba(255,255,255,.92)" }}>
        {children}
      </div>
    );
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

  const clockParts = fmtClockParts(nowTick);
  const commandCenterClass = [
    "tr-commandCenter",
    `tr-commandCenter--${hudVariant}`,
    hud.mode === "active" ? "is-active" : "is-inactive",
    hud.mode === "active" && hud.isPaused ? "is-paused" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="tr-shellRoot">
      <div className="tr-shellInner">
        <header className="tr-appHeader">
          <div className="tr-topTitle">MVP Trainer Pro</div>

          {user ? (
            <div className="tr-appHeaderActions">
              <button type="button" className="tr-appHeaderButton is-music" onClick={() => navigate("/music")}>
                MY MUSIC
              </button>
              <button
                type="button"
                className="tr-appHeaderButton is-alerts"
                onClick={() => navigate("/sound-alerts")}
              >
                SOUND & ALERTS
              </button>
              <button
                type="button"
                className="tr-appHeaderButton is-signout"
                onClick={signOut}
                disabled={busy}
              >
                {busy ? "SIGNING OUT" : "SIGN OUT"}
              </button>
            </div>
          ) : null}
        </header>

        {user ? <MusicMiniPlayer navigate={navigate} /> : null}

        {message ? (
          <div className="tr-commandMessage" role="status">
            {message}
          </div>
        ) : null}

        <section className={commandCenterClass} aria-label="MVP Trainer command center">
          {hud.mode === "active" ? (
            <div className="tr-commandActive">
              <div className="tr-commandActiveTopline">
                <div className="tr-commandLiveIdentity">
                  <span className={`tr-commandLiveDot ${hud.isPaused ? "is-paused" : "is-running"}`} aria-hidden />
                  <div>
                    <span>LIVE SESSION</span>
                    <strong>{hud.isPaused ? "PAUSED" : "TRAINING"}</strong>
                  </div>
                </div>

                <div className="tr-commandRealClock" aria-label={`${clockParts.date}, ${clockParts.time}`}>
                  <span>{clockParts.date}</span>
                  <strong>{clockParts.time}</strong>
                </div>
              </div>

              <div className="tr-commandActiveGrid">
                <div className="tr-commandChronograph">
                  <div className="tr-commandSectionLabel">SESSION ELAPSED</div>
                  <div className="tr-commandChronographTime" aria-label={`${toHHMMSS(timerSeconds)} elapsed`}>
                    {toHHMMSS(timerSeconds)}
                  </div>
                  <div className="tr-commandChronographUnits" aria-hidden>
                    <span>HR</span>
                    <span>MIN</span>
                    <span>SEC</span>
                  </div>
                </div>

                <div className="tr-commandExercisePanel">
                  <div className="tr-commandExerciseHead">
                    <span>CURRENT EXERCISE</span>
                    <strong>{hud.exercise.currentPosition}</strong>
                  </div>
                  <div className="tr-commandExerciseName">
                    {displayOrNotSet(hud.exercise.currentName, "Exercise not selected")}
                  </div>
                  <div className="tr-commandExerciseProgram">{activeLabel || hud.templateName}</div>

                  <div className="tr-commandNextExercise">
                    <span>NEXT EXERCISE</span>
                    <strong>{hud.exercise.nextName || "Final exercise"}</strong>
                  </div>
                </div>
              </div>

              <div className="tr-commandMetricRail">
                <div className="tr-commandMetric is-progress">
                  <span>SESSION PROGRESS</span>
                  <strong>
                    {hud.exercise.completedExercises} / {hud.exercise.totalExercises || "-"}
                  </strong>
                  <small>Exercises complete</small>
                </div>
                <div className="tr-commandMetric is-weight">
                  <span>BODY WEIGHT</span>
                  <strong>{hud.bodyweightLb != null ? `${hud.bodyweightLb} lb` : "Not set"}</strong>
                  <small>Today</small>
                </div>
                <div className="tr-commandMetric is-protein">
                  <span>PROTEIN TARGET</span>
                  <strong>{hud.proteinTargetG != null ? `${hud.proteinTargetG} g` : "Not set"}</strong>
                  <small>Daily target</small>
                </div>
              </div>

              <div className="tr-commandActions tr-commandActions--active">
                {!isWorkoutSession ? (
                  <button
                    type="button"
                    className="tr-commandButton is-return"
                    onClick={() => navigate(`/workout/${hud.sessionId}`)}
                  >
                    RETURN TO WORKOUT
                  </button>
                ) : null}
                <button
                  type="button"
                  className={`tr-commandButton ${hud.isPaused ? "is-resume" : "is-pause"}`}
                  onClick={onTogglePause}
                >
                  {hud.isPaused ? "RESUME WORKOUT" : "PAUSE WORKOUT"}
                </button>
                <button
                  type="button"
                  className="tr-commandButton is-end"
                  onClick={onEndWorkout}
                  disabled={!endEnabled}
                  title={!endEnabled ? "Confirm today's body weight before ending" : "End workout"}
                >
                  END WORKOUT
                </button>
              </div>
            </div>
          ) : (
            <div className="tr-commandInactive">
              <div className="tr-commandDateTime">
                <span>{clockParts.date}</span>
                <strong>{clockParts.time}</strong>
                <small>LOCAL TIME</small>
              </div>

              <div className="tr-commandNextWorkout">
                <div className="tr-commandSectionLabel">
                  {hud.mode === "inactive" ? "NEXT WORKOUT" : "TRAINING STATUS"}
                </div>
                <strong>
                  {hud.mode === "inactive"
                    ? displayOrNotSet(hud.nextTemplateName, "Next session")
                    : hud.mode === "no_program"
                    ? "No active program"
                    : "Sign in required"}
                </strong>
                <span>
                  {hud.mode === "inactive"
                    ? inactiveLabel || "Scheduled training session"
                    : hud.mode === "no_program"
                    ? "Build your training plan in Coach"
                    : "Sign in to load your program"}
                </span>
              </div>

              <div className="tr-commandMetricRail tr-commandMetricRail--inactive">
                <div className="tr-commandMetric is-weight">
                  <span>CURRENT BODY WEIGHT</span>
                  <strong>
                    {hud.mode === "inactive" && hud.displayWeightLb != null
                      ? `${hud.displayWeightLb} lb`
                      : "Not set"}
                  </strong>
                  <small>Latest completed entry</small>
                </div>
                <div className="tr-commandMetric is-protein">
                  <span>PROTEIN TARGET</span>
                  <strong>
                    {hud.mode === "inactive" && hud.proteinTargetG != null
                      ? `${hud.proteinTargetG} g`
                      : "Not set"}
                  </strong>
                  <small>Daily target</small>
                </div>
                <div className="tr-commandMetric is-status">
                  <span>STATUS</span>
                  <strong>
                    {hud.mode === "inactive"
                      ? hud.readiness
                      : hud.mode === "no_program"
                      ? "NO PROGRAM"
                      : "SIGNED OUT"}
                  </strong>
                  <small>
                    {hud.mode === "inactive" && hud.nextSessionId ? "Session available" : "Action needed"}
                  </small>
                </div>
              </div>

              <div className="tr-commandActions tr-commandActions--inactive">
                {hud.mode === "inactive" ? (
                  <button
                    type="button"
                    className="tr-commandButton is-start"
                    disabled={!hud.nextSessionId}
                    onClick={() => hud.nextSessionId && navigate(`/workout/${hud.nextSessionId}`)}
                  >
                    START WORKOUT
                  </button>
                ) : hud.mode === "no_program" ? (
                  <button type="button" className="tr-commandButton is-start" onClick={() => navigate("/coach")}>
                    GO TO COACH
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </section>

        {children}
      </div>

      <nav className="tr-bottomNavWrap" aria-label="Primary navigation">
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
      </nav>

      {endOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className="tr-modalOverlay tr-modalOverlay--locked"
              role="dialog"
              aria-modal="true"
              aria-label="Save workout"
            >
              <div className="tr-modal tr-modal--viewport">
                <div className="tr-modalHead">
                  <div style={{ fontWeight: 950 }}>How was the workout?</div>
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
                      onChange={(event) => setEndNotes(event.target.value)}
                      placeholder="Anything you want to remember, including pain, form, energy, or adjustments"
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

      <style>{SHELL_GUARD_CSS}</style>
    </div>
  );
}
