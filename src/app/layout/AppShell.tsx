import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../../lib/supabase";
import { inferSymptomKey, isSymptomMode, type SymptomKey } from "../../lib/sessionLabel";
import { MusicMiniPlayer } from "../../features/music/MusicMiniPlayer";
import {
  APP_BRANDING_CHANGED_EVENT,
  fetchCurrentWeather,
  formatWeatherLocalTime,
  getAppBrandingWeatherSettings,
  getHeaderLogoSignedUrl,
  type AppBrandingWeatherSettings,
  type CurrentWeatherSnapshot,
  type WeatherIconKind,
} from "../../lib/appBrandingWeather";

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

/* Step 1: focused training command center */
.tr-sessionChronographTime{
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif !important;
  font-variant-numeric: tabular-nums lining-nums !important;
  font-feature-settings: "tnum" 1, "lnum" 1, "zero" 0 !important;
  font-synthesis: none;
  letter-spacing: .025em !important;
}
.tr-inactiveCommand{
  position: relative;
  overflow: hidden;
  display: grid;
  grid-template-columns: minmax(132px,.60fr) minmax(390px,1.80fr) minmax(170px,.70fr);
  align-items: center;
  gap: 20px;
  min-height: 168px;
  padding: 22px 24px;
  border: 1px solid rgba(0,170,255,.34);
  border-radius: 22px;
  background:
    radial-gradient(620px 220px at 50% -20%, rgba(0,170,255,.16), transparent 68%),
    linear-gradient(180deg, rgba(14,23,33,.98), rgba(4,8,13,.99));
  box-shadow:
    0 26px 70px rgba(0,0,0,.46),
    inset 0 1px 0 rgba(255,255,255,.08),
    inset 0 -1px 0 rgba(0,135,210,.12);
}
.tr-inactiveCommand::before{
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,.024), transparent);
}
.tr-inactiveCommand > *{
  position: relative;
  z-index: 1;
}
.tr-inactiveCommandStatus{
  min-width: 0;
  display: grid;
  justify-items: start;
  gap: 10px;
}
.tr-inactiveCommandKicker{
  color: #81d9ff;
  font-size: 10px;
  line-height: 1;
  font-weight: 1000;
  letter-spacing: .22em;
  text-transform: uppercase;
}
.tr-inactiveReady{
  display: inline-flex;
  align-items: center;
  gap: 9px;
  color: #a8f3c0;
  font-size: clamp(18px,2.1vw,26px);
  line-height: 1;
  font-weight: 1000;
  letter-spacing: .08em;
}
.tr-inactiveReady > span{
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #3ddd75;
  box-shadow: 0 0 16px rgba(61,221,117,.66);
}
.tr-inactiveReady.is-no-program{
  color: #ffd08a;
}
.tr-inactiveReady.is-no-program > span{
  background: #ffad3d;
  box-shadow: 0 0 16px rgba(255,173,61,.58);
}
.tr-inactiveReady.is-signed-out{
  color: rgba(255,255,255,.72);
}
.tr-inactiveReady.is-signed-out > span{
  background: rgba(255,255,255,.48);
  box-shadow: none;
}
.tr-inactiveCommandClock{
  min-width: 0;
  display: grid;
  justify-items: center;
  gap: 7px;
  text-align: center;
}
.tr-inactiveCommandDate{
  display: block;
  width: 100%;
  max-width: 100%;
  color: rgba(250,253,250,.96);
  font-size: clamp(17px,2vw,24px);
  line-height: 1.08;
  font-weight: 1000;
  letter-spacing: 0;
  white-space: nowrap !important;
  text-wrap: nowrap !important;
  word-break: normal !important;
  overflow-wrap: normal !important;
  text-align: center;
  text-shadow: 0 2px 0 rgba(0,0,0,.72), 0 0 20px rgba(0,170,255,.08);
}
.tr-inactiveCommandTime{
  color: #ffe680;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
  font-size: clamp(25px,3.1vw,38px);
  line-height: 1;
  font-weight: 1000;
  letter-spacing: .06em;
  font-variant-numeric: tabular-nums lining-nums;
  font-feature-settings: "tnum" 1, "lnum" 1, "zero" 0;
  text-shadow: 0 2px 0 rgba(0,0,0,.72), 0 0 22px rgba(255,210,67,.18);
}
.tr-inactiveCommandActions{
  display: grid;
  justify-items: stretch;
}
.tr-inactiveCommandActions .tr-hudActionBtn{
  width: 100%;
  min-width: 0;
  min-height: 54px;
  border-radius: 15px;
}
.tr-inactiveSupportRail{
  display: grid;
  grid-template-columns: repeat(2,minmax(0,1fr));
  gap: 10px;
}
.tr-inactiveSupportMetric{
  min-width: 0;
  display: grid;
  justify-items: center;
  gap: 7px;
  padding: 14px 16px;
  border: 1px solid rgba(0,170,255,.18);
  border-radius: 16px;
  background:
    radial-gradient(420px 120px at 50% 0%, rgba(0,170,255,.08), transparent 68%),
    linear-gradient(180deg, rgba(255,255,255,.038), rgba(0,0,0,.14));
  box-shadow: inset 0 1px 0 rgba(255,255,255,.05);
  text-align: center;
}
.tr-inactiveSupportMetric span{
  color: rgba(181,207,222,.62);
  font-size: 9px;
  line-height: 1;
  font-weight: 1000;
  letter-spacing: .19em;
  text-transform: uppercase;
}
.tr-inactiveSupportMetric strong{
  color: rgba(255,255,255,.96);
  font-size: clamp(21px,2.5vw,29px);
  line-height: 1;
  font-weight: 1000;
  letter-spacing: .03em;
  font-variant-numeric: tabular-nums lining-nums;
}
.tr-inactiveSupportMetric small{
  color: rgba(190,207,218,.52);
  font-size: 10px;
  font-weight: 800;
}
@media (max-width: 820px){
  .tr-inactiveCommand{
    grid-template-columns: 1fr;
    gap: 16px;
    min-height: 0;
    padding: 20px;
  }
  .tr-inactiveCommandStatus,
  .tr-inactiveCommandActions{
    justify-items: center;
  }
  .tr-inactiveCommandActions{
    width: 100%;
  }
  .tr-inactiveCommandActions .tr-hudActionBtn{
    width: min(100%,420px);
  }
}
@media (max-width: 560px){
  .tr-inactiveCommand{
    padding: 17px 13px;
    border-radius: 18px;
  }
  .tr-inactiveCommandDate{
    font-size: clamp(15px,4.55vw,19px);
    letter-spacing: 0;
    white-space: nowrap !important;
    text-wrap: nowrap !important;
    word-break: normal !important;
    overflow-wrap: normal !important;
  }
  .tr-inactiveCommandTime{
    font-size: clamp(23px,7vw,31px);
  }
  .tr-inactiveSupportRail{
    grid-template-columns: 1fr;
  }
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



function HeaderWeatherIcon({
  kind,
  isDay,
}: {
  kind: WeatherIconKind;
  isDay: boolean;
}) {
  const cloud = (
    <path d="M7.2 18.2h9.8a4 4 0 0 0 .35-7.98A5.4 5.4 0 0 0 7.1 8.65 4.8 4.8 0 0 0 7.2 18.2Z" />
  );

  if (kind === "clear") {
    return isDay ? (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.2v2.1M12 19.7v2.1M2.2 12h2.1M19.7 12h2.1M5.1 5.1l1.5 1.5M17.4 17.4l1.5 1.5M18.9 5.1l-1.5 1.5M6.6 17.4l-1.5 1.5" />
      </svg>
    ) : (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M18.8 15.5A7.8 7.8 0 0 1 8.5 5.2 7.9 7.9 0 1 0 18.8 15.5Z" />
      </svg>
    );
  }

  if (kind === "partly_cloudy") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {isDay ? <circle cx="8" cy="8" r="3" /> : <path d="M10.2 9.6A4.4 4.4 0 0 1 6.4 4a4.7 4.7 0 0 0 3.8 7.4" />}
        {cloud}
      </svg>
    );
  }

  if (kind === "fog") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {cloud}
        <path d="M5 20.5h14M7 23h10" />
      </svg>
    );
  }

  if (kind === "drizzle" || kind === "rain") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {cloud}
        <path d={kind === "drizzle" ? "M8 20.5l-.5 1M12 20.5l-.5 1M16 20.5l-.5 1" : "M8.5 20l-1 2M12.5 20l-1 2M16.5 20l-1 2"} />
      </svg>
    );
  }

  if (kind === "snow") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {cloud}
        <path d="M8 20.5v2M7 21.5h2M12 20.5v2M11 21.5h2M16 20.5v2M15 21.5h2" />
      </svg>
    );
  }

  if (kind === "storm") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {cloud}
        <path d="m13.3 18.2-3 4.2h2.6l-1 3.1 4-5.2h-2.7l.1-2.1Z" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">{cloud}</svg>
  );
}

const APP_HEADER_CSS = `
.tr-appHeader{
  position:relative;
  z-index:1400;
  display:grid;
  grid-template-columns:minmax(0,1fr) minmax(260px,360px) minmax(0,1fr);
  align-items:center;
  gap:16px;
  min-height:82px;
  margin:0 0 18px;
  overflow:visible;
}
.tr-appHeaderWeather{
  justify-self:start;
  width:min(100%,310px);
  min-width:0;
  min-height:62px;
  padding:8px 11px;
  display:grid;
  align-content:center;
  gap:5px;
  border:1px solid rgba(72,203,244,.30);
  border-radius:14px;
  background:
    radial-gradient(250px 80px at 0 0,rgba(0,181,242,.13),transparent 72%),
    linear-gradient(180deg,rgba(10,27,36,.96),rgba(4,12,17,.98));
  box-shadow:inset 0 1px 0 rgba(255,255,255,.055),0 8px 24px rgba(0,0,0,.28);
  color:#eafaff;
  text-align:left;
  cursor:pointer;
}
.tr-appHeaderWeather:hover,
.tr-appHeaderWeather:focus-visible{
  border-color:rgba(84,220,255,.58);
  outline:none;
}
.tr-appHeaderWeatherMain{
  min-width:0;
  display:grid;
  grid-template-columns:30px auto minmax(0,1fr);
  align-items:center;
  gap:8px;
  white-space:nowrap;
}
.tr-appHeaderWeatherIcon{
  width:30px;
  height:30px;
  display:grid;
  place-items:center;
  color:#63dcff;
  filter:drop-shadow(0 0 9px rgba(50,205,248,.28));
}
.tr-appHeaderWeatherIcon svg{
  width:27px;
  height:27px;
  overflow:visible;
  fill:none;
  stroke:currentColor;
  stroke-width:1.75;
  stroke-linecap:round;
  stroke-linejoin:round;
}
.tr-appHeaderWeatherTemp{
  color:#fff;
  font-size:22px;
  line-height:1;
  font-weight:1100;
  letter-spacing:-.025em;
  font-variant-numeric:tabular-nums;
}
.tr-appHeaderWeatherTime{
  min-width:0;
  color:#ffe18a;
  font-size:13px;
  line-height:1;
  font-weight:1000;
  letter-spacing:.025em;
  font-variant-numeric:tabular-nums;
}
.tr-appHeaderWeatherDetail{
  min-width:0;
  color:rgba(215,234,242,.82);
  font-size:9px;
  line-height:1.08;
  font-weight:950;
  letter-spacing:.035em;
  white-space:nowrap;
}
.tr-appHeaderWeatherDetail b{color:#fff;font-weight:1100}
.tr-appHeaderBrand{
  justify-self:center;
  width:100%;
  height:76px;
  min-width:0;
  display:grid;
  place-items:center;
  overflow:visible;
  pointer-events:none;
}
.tr-appHeaderBrand img{
  display:block;
  width:auto;
  height:auto;
  max-width:100%;
  max-height:76px;
  object-fit:contain;
  object-position:center;
  overflow:visible;
  filter:drop-shadow(0 4px 12px rgba(0,0,0,.58)) drop-shadow(0 0 10px rgba(34,163,255,.13));
}
.tr-appHeaderBrandFallback{
  color:#ffe36f;
  font-size:23px;
  font-weight:1100;
  letter-spacing:.035em;
  white-space:nowrap;
  text-shadow:0 2px 0 rgba(0,0,0,.75),0 0 18px rgba(255,215,71,.16);
}
.tr-appHeaderActions{
  justify-self:end;
  min-width:0;
  display:flex;
  align-items:center;
  justify-content:flex-end;
  gap:8px;
  overflow:visible;
}
.tr-appHeaderWorkout,
.tr-appHeaderMenuButton{
  min-height:40px;
  padding:0 12px;
  border:1px solid rgba(115,191,219,.27);
  border-radius:10px;
  background:linear-gradient(180deg,#0b1b23,#061016);
  color:#fff;
  font-size:10px;
  line-height:1;
  font-weight:1000;
  letter-spacing:.04em;
  white-space:nowrap;
  cursor:pointer;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.04),0 6px 18px rgba(0,0,0,.24);
}
.tr-appHeaderWorkout{
  border-color:rgba(255,173,52,.48);
  background:linear-gradient(180deg,rgba(74,42,6,.97),rgba(26,16,5,.99));
  color:#ffd483;
}
.tr-appHeaderWorkout.is-resume{
  border-color:rgba(55,220,130,.48);
  background:linear-gradient(180deg,rgba(13,64,43,.98),rgba(5,29,21,.99));
  color:#8df0b7;
}
.tr-appHeaderWorkout:hover,
.tr-appHeaderMenuButton:hover,
.tr-appHeaderWorkout:focus-visible,
.tr-appHeaderMenuButton:focus-visible{
  outline:none;
  filter:brightness(1.12);
}
.tr-appHeaderMenuWrap{position:relative;flex:0 0 auto}
.tr-appHeaderMenuButton--mobile{display:none}
.tr-appHeaderMenuButton svg{width:14px;height:14px;fill:currentColor;vertical-align:-2px;margin-right:5px}
.tr-appHeaderMenu{
  position:absolute;
  right:0;
  top:calc(100% + 8px);
  z-index:8000;
  width:190px;
  padding:7px;
  display:grid;
  gap:5px;
  border:1px solid rgba(91,194,227,.28);
  border-radius:12px;
  background:linear-gradient(180deg,#0a1820,#040a0e);
  box-shadow:0 22px 56px rgba(0,0,0,.64),inset 0 1px 0 rgba(255,255,255,.045);
}
.tr-appHeaderMenu button{
  width:100%;
  min-height:42px;
  padding:0 11px;
  border:1px solid transparent;
  border-radius:8px;
  background:transparent;
  color:#eef9fc;
  font-size:10px;
  font-weight:1000;
  letter-spacing:.045em;
  text-align:left;
  cursor:pointer;
}
.tr-appHeaderMenu button:hover{border-color:rgba(75,208,248,.22);background:rgba(28,85,104,.20)}
.tr-appHeaderMenu button.is-signout{color:#ffaaa4}
.tr-appHeaderWorkout .tr-mobileOnly{display:none}

@media(max-width:820px){
  .tr-appHeader{
    grid-template-columns:minmax(116px,1fr) minmax(120px,1fr) auto;
    gap:7px;
    min-height:76px;
    margin-bottom:14px;
  }
  .tr-appHeaderWeather{
    width:100%;
    min-height:64px;
    padding:7px 8px;
    border-radius:12px;
    gap:5px;
  }
  .tr-appHeaderWeatherMain{grid-template-columns:25px auto minmax(0,1fr);gap:5px}
  .tr-appHeaderWeatherIcon{width:25px;height:25px}
  .tr-appHeaderWeatherIcon svg{width:23px;height:23px}
  .tr-appHeaderWeatherTemp{font-size:18px}
  .tr-appHeaderWeatherTime{font-size:10px;letter-spacing:0}
  .tr-appHeaderWeatherDetail{font-size:7.2px;letter-spacing:.018em}
  .tr-appHeaderBrand{height:68px;min-width:0}
  .tr-appHeaderBrand img{max-height:66px;max-width:100%}
  .tr-appHeaderBrandFallback{font-size:15px;white-space:normal;text-align:center;line-height:1.05}
  .tr-appHeaderActions{gap:5px}
  .tr-appHeaderWorkout,.tr-appHeaderMenuButton{min-height:40px;padding:0 8px;font-size:8.5px;border-radius:9px}
  .tr-appHeaderWorkout .tr-desktopOnly{display:none}
  .tr-appHeaderWorkout .tr-mobileOnly{display:inline}
  .tr-appHeaderMenuButton--desktop{display:none}
  .tr-appHeaderMenuButton--mobile{display:inline-flex;align-items:center;justify-content:center}
  .tr-appHeaderMenu{width:178px}
}

@media(max-width:430px){
  .tr-appHeader{
    grid-template-columns:minmax(112px,1fr) minmax(112px,1fr) auto;
    gap:6px;
    min-height:72px;
  }
  .tr-appHeaderWeather{min-height:60px;padding:6px 7px}
  .tr-appHeaderWeatherMain{grid-template-columns:23px auto minmax(0,1fr);gap:4px}
  .tr-appHeaderWeatherIcon{width:23px;height:23px}
  .tr-appHeaderWeatherIcon svg{width:21px;height:21px}
  .tr-appHeaderWeatherTemp{font-size:17px}
  .tr-appHeaderWeatherTime{font-size:9px}
  .tr-appHeaderWeatherDetail{font-size:6.8px;letter-spacing:0}
  .tr-appHeaderBrand{height:62px}
  .tr-appHeaderBrand img{max-height:60px}
  .tr-appHeaderWorkout,.tr-appHeaderMenuButton{min-height:38px;padding:0 7px;font-size:8px}
  .tr-appHeaderMenuButton svg{width:12px;height:12px;margin-right:4px}
}

@media(max-width:365px){
  .tr-appHeader{
    grid-template-columns:minmax(102px,1fr) minmax(90px,.9fr) auto;
    gap:4px;
  }
  .tr-appHeaderWeather{padding-left:6px;padding-right:6px}
  .tr-appHeaderWeatherTemp{font-size:16px}
  .tr-appHeaderWeatherTime{font-size:8.2px}
  .tr-appHeaderWeatherDetail{font-size:6.2px}
  .tr-appHeaderWorkout,.tr-appHeaderMenuButton{padding:0 6px;font-size:7.4px}
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
    // Diagnostics are intentionally non-blocking.
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
  const [msg, setMsg] = useState<string | null>(null);

  const [hud, setHud] = useState<Hud>({ mode: "signed_out" });
  const [nowTick, setNowTick] = useState(Date.now());
  const [branding, setBranding] = useState<AppBrandingWeatherSettings | null>(null);
  const [headerLogoUrl, setHeaderLogoUrl] = useState<string | null>(null);
  const [weather, setWeather] = useState<CurrentWeatherSnapshot | null>(null);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const headerMenuRef = useRef<HTMLDivElement | null>(null);

  const pollRef = useRef<any>(null);
  const refreshInFlightRef = useRef(false);

  const isWorkoutSession = currentPath.startsWith("/workout/");
  const isWorkoutsTab = currentPath === "/" || currentPath.startsWith("/workout/");
  const hudVariant = isWorkoutSession ? "hero" : isWorkoutsTab ? "large" : "compact";

  const [endOpen, setEndOpen] = useState(false);
  const [endDifficulty, setEndDifficulty] = useState<"too_easy" | "just_right" | "too_hard" | "">("");
  const [endNotes, setEndNotes] = useState("");
  const [endBusy, setEndBusy] = useState(false);

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
    supabase.auth.getUser().then(({ data }) => setUser(data.user ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);


  useEffect(() => {
    if (!user?.id) {
      setBranding(null);
      setHeaderLogoUrl(null);
      setWeather(null);
      return;
    }

    let cancelled = false;

    const loadBranding = async () => {
      try {
        const settings = await getAppBrandingWeatherSettings();
        if (cancelled) return;
        setBranding(settings);

        if (settings.headerLogoPath) {
          try {
            const url = await getHeaderLogoSignedUrl(settings.headerLogoPath);
            if (!cancelled) setHeaderLogoUrl(url);
          } catch {
            if (!cancelled) setHeaderLogoUrl(null);
          }
        } else {
          setHeaderLogoUrl(null);
        }
      } catch (error) {
        console.warn("Could not load MVP Trainer header branding.", error);
      }
    };

    void loadBranding();
    const onBrandingChanged = () => void loadBranding();
    window.addEventListener(APP_BRANDING_CHANGED_EVENT, onBrandingChanged);

    return () => {
      cancelled = true;
      window.removeEventListener(APP_BRANDING_CHANGED_EVENT, onBrandingChanged);
    };
  }, [user?.id]);

  useEffect(() => {
    const location = branding?.weatherLocation;
    if (!user?.id || !location) {
      setWeather(null);
      return;
    }

    let cancelled = false;
    const refreshWeather = async () => {
      try {
        const snapshot = await fetchCurrentWeather(location);
        if (!cancelled) setWeather(snapshot);
      } catch (error) {
        console.warn("Could not refresh MVP Trainer weather.", error);
      }
    };

    void refreshWeather();
    const timer = window.setInterval(refreshWeather, 10 * 60 * 1000);
    const onFocus = () => void refreshWeather();
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [user?.id, branding?.weatherLocation?.latitude, branding?.weatherLocation?.longitude]);

  useEffect(() => {
    if (!headerMenuOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !headerMenuRef.current?.contains(target)) {
        setHeaderMenuOpen(false);
      }
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHeaderMenuOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onEscape);
    };
  }, [headerMenuOpen]);

  useEffect(() => {
    setNowTick(Date.now());

    const intervalMs = hud.mode === "active" ? 1000 : 30000;
    const t = window.setInterval(() => {
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
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [hud.mode]);

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
        void run();
      }
    };

    void run();

    if (pollRef.current) window.clearInterval(pollRef.current);

    const pollMs = hud.mode === "active" ? 10000 : 45000;
    pollRef.current = window.setInterval(() => void run(), pollMs);

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


  const clockParts = hud.mode !== "active" ? fmtClockParts(nowTick) : null;
  const weatherLocation = branding?.weatherLocation ?? null;
  const weatherTimezone = weather?.timezone || weatherLocation?.timezone || "UTC";
  const weatherTime = formatWeatherLocalTime(weatherTimezone, new Date(nowTick));
  const weatherTemp = weather ? `${Math.round(weather.temperatureF)}°` : "--°";
  const weatherCondition = weather?.condition?.toUpperCase() || (weatherLocation ? "LOADING" : "SET WEATHER");
  const weatherFeels = weather ? `${Math.round(weather.apparentTemperatureF)}°` : "--°";
  const weatherCity = weatherLocation?.displayName?.toUpperCase() || "LOCATION";
  const showHeaderWorkoutAction = hud.mode === "active" && (hud.isPaused || !isWorkoutSession);
  const headerWorkoutLabel = hud.mode === "active"
    ? hud.isPaused
      ? "RESUME"
      : "RETURN TO WORKOUT"
    : "";

  const runHeaderWorkoutAction = () => {
    if (hud.mode !== "active") return;
    setHeaderMenuOpen(false);
    if (hud.isPaused) {
      void onTogglePause();
      return;
    }
    navigate(`/workout/${hud.sessionId}`);
  };

  return (
    <div className="tr-shellRoot">
      <div className="tr-shellInner">
        {user ? (
          <>
            <header className="tr-appHeader">
              <button
                type="button"
                className="tr-appHeaderWeather"
                onClick={() => navigate("/sound-alerts")}
                title="Weather location settings"
                aria-label={`${weatherCondition}, ${weatherTemp}, ${weatherTime}, ${weatherCity}, feels like ${weatherFeels}`}
              >
                <span className="tr-appHeaderWeatherMain">
                  <span className="tr-appHeaderWeatherIcon" aria-hidden="true">
                    <HeaderWeatherIcon kind={weather?.icon || "cloudy"} isDay={weather?.isDay ?? true} />
                  </span>
                  <strong className="tr-appHeaderWeatherTemp">{weatherTemp}</strong>
                  <span className="tr-appHeaderWeatherTime">{weatherTime}</span>
                </span>
                <span className="tr-appHeaderWeatherDetail">
                  <b>{weatherCondition}</b> · {weatherCity} · FEELS {weatherFeels}
                </span>
              </button>

              <div className="tr-appHeaderBrand" aria-label="MVP Trainer Pro">
                {headerLogoUrl ? (
                  <img src={headerLogoUrl} alt="MVP Trainer Pro" />
                ) : (
                  <span className="tr-appHeaderBrandFallback">MVP Trainer Pro</span>
                )}
              </div>

              <div className="tr-appHeaderActions">
                {showHeaderWorkoutAction ? (
                  <button
                    type="button"
                    className={`tr-appHeaderWorkout ${hud.mode === "active" && hud.isPaused ? "is-resume" : "is-return"}`}
                    onClick={runHeaderWorkoutAction}
                  >
                    <span className="tr-desktopOnly">{headerWorkoutLabel}</span>
                    <span className="tr-mobileOnly">{hud.mode === "active" && hud.isPaused ? "RESUME" : "RETURN"}</span>
                  </button>
                ) : null}

                <div ref={headerMenuRef} className="tr-appHeaderMenuWrap">
                  <button
                    type="button"
                    className="tr-appHeaderMenuButton tr-appHeaderMenuButton--desktop"
                    onClick={() => setHeaderMenuOpen((open) => !open)}
                    aria-expanded={headerMenuOpen}
                  >
                    ACCOUNT ▾
                  </button>
                  <button
                    type="button"
                    className="tr-appHeaderMenuButton tr-appHeaderMenuButton--mobile"
                    onClick={() => setHeaderMenuOpen((open) => !open)}
                    aria-expanded={headerMenuOpen}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v2H4V6Zm0 5h16v2H4v-2Zm0 5h16v2H4v-2Z" /></svg>
                    MENU
                  </button>

                  {headerMenuOpen ? (
                    <div className="tr-appHeaderMenu" role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setHeaderMenuOpen(false);
                          navigate("/sound-alerts");
                        }}
                      >
                        SOUND & ALERTS
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="is-signout"
                        disabled={busy}
                        onClick={() => {
                          setHeaderMenuOpen(false);
                          void signOut();
                        }}
                      >
                        {busy ? "SIGNING OUT…" : "SIGN OUT"}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </header>
            <style>{APP_HEADER_CSS}</style>
          </>
        ) : null}

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
                    <div className="tr-sessionChronographKicker">SESSION TIME</div>
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

              </>
            ) : (
              <>
                <div className="tr-inactiveCommand">
                  <div className="tr-inactiveCommandStatus">
                    <div className="tr-inactiveCommandKicker">TRAINING STATUS</div>
                    <div
                      className={`tr-inactiveReady ${
                        hud.mode === "no_program"
                          ? "is-no-program"
                          : hud.mode === "signed_out"
                          ? "is-signed-out"
                          : ""
                      }`}
                    >
                      <span aria-hidden />
                      {hud.mode === "inactive" ? "READY" : hud.mode === "no_program" ? "NO PROGRAM" : "SIGN IN"}
                    </div>
                  </div>

                  <div className="tr-inactiveCommandClock">
                    <div
                      className="tr-inactiveCommandDate"
                      style={{
                        whiteSpace: "nowrap",
                        wordBreak: "normal",
                        overflowWrap: "normal",
                      }}
                    >
                      {clockParts?.date}
                    </div>
                    <div className="tr-inactiveCommandTime">{clockParts?.time}</div>
                  </div>

                  <div className="tr-inactiveCommandActions">
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

                {hud.mode === "inactive" ? (
                  <div className="tr-inactiveSupportRail">
                    <div className="tr-inactiveSupportMetric">
                      <span>BODY WEIGHT</span>
                      <strong>{hud.displayWeightLb != null ? `${hud.displayWeightLb} lb` : "Not set"}</strong>
                      <small>Last completed</small>
                    </div>

                    <div className="tr-inactiveSupportMetric">
                      <span>PROTEIN TARGET</span>
                      <strong>{hud.proteinTargetG != null ? `${hud.proteinTargetG}g` : "Not set"}</strong>
                      <small>Daily target</small>
                    </div>
                  </div>
                ) : null}
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
