import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../../lib/supabase";
import { inferSymptomKey, isSymptomMode, type SymptomKey } from "../../lib/sessionLabel";
import { MusicMiniPlayer } from "../../features/music/MusicMiniPlayer";
import { isMusicPlaying, pauseMusic, playMusic } from "../../lib/musicPlayer";
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
  musicWasPlayingOnPause: "mvp_music_was_playing_on_workout_pause",
};

const END_WORKOUT_REQUEST_EVENT = "mvp:end-workout-request";
const WORKOUT_RESUME_REQUEST_EVENT = "mvp:resume-workout-request";
const WORKOUT_PAUSE_STATE_EVENT = "mvp:workout-pause-state";

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

type PerformanceCoreState = "ready" | "active" | "paused" | "offline";
type SessionDurationBaseline = {
  seconds: number | null;
  sampleCount: number;
  exactCount: number;
};

function normalizedWorkoutName(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function workoutSummaryObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function completedWorkoutDurationSeconds(row: any) {
  const active = Number(row?.active_seconds ?? 0);
  if (Number.isFinite(active) && active >= 300 && active <= 4 * 60 * 60) return active;

  const summary = workoutSummaryObject(row?.workout_summary);
  const summarySeconds = Number(summary?.duration_seconds ?? 0);
  if (Number.isFinite(summarySeconds) && summarySeconds >= 300 && summarySeconds <= 4 * 60 * 60) {
    return summarySeconds;
  }

  const started = row?.started_at ? new Date(row.started_at).getTime() : NaN;
  const ended = row?.ended_at ? new Date(row.ended_at).getTime() : NaN;
  if (Number.isFinite(started) && Number.isFinite(ended) && ended > started) {
    const seconds = (ended - started) / 1000;
    if (seconds >= 300 && seconds <= 4 * 60 * 60) return seconds;
  }

  return null;
}

async function fetchSessionDurationBaseline(userId: string, templateName: string): Promise<SessionDurationBaseline> {
  const { data, error } = await supabase
    .from("workouts")
    .select("active_seconds, workout_summary, started_at, ended_at, completed_at")
    .eq("user_id", userId)
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false })
    .limit(30);

  if (error) throw error;

  const target = normalizedWorkoutName(templateName);
  const rows = (data ?? [])
    .map((row: any) => {
      const seconds = completedWorkoutDurationSeconds(row);
      if (!seconds) return null;
      const summary = workoutSummaryObject(row?.workout_summary);
      return {
        seconds,
        templateName: normalizedWorkoutName(summary?.template_name),
      };
    })
    .filter((row): row is { seconds: number; templateName: string } => Boolean(row));

  const exact = target ? rows.filter((row) => row.templateName === target) : [];
  const exactIds = new Set(exact);
  const ordered = exact.length >= 3
    ? exact.slice(0, 12)
    : [...exact, ...rows.filter((row) => !exactIds.has(row))].slice(0, 12);

  if (!ordered.length) return { seconds: null, sampleCount: 0, exactCount: 0 };

  let weightedSeconds = 0;
  let weightTotal = 0;
  ordered.forEach((row, index) => {
    const weight = Math.pow(0.88, index);
    weightedSeconds += row.seconds * weight;
    weightTotal += weight;
  });

  return {
    seconds: Math.round(weightedSeconds / Math.max(0.0001, weightTotal)),
    sampleCount: ordered.length,
    exactCount: exact.length,
  };
}

function PerformanceCoreIcon({ state }: { state: PerformanceCoreState }) {
  return (
    <span className={`tr-performanceCoreIcon is-${state}`} aria-hidden="true">
      <svg viewBox="0 0 48 48" role="presentation">
        <path className="tr-performanceCoreFrame" d="M24 3.8 40.8 13.3 37.2 35.8 24 44.2 10.8 35.8 7.2 13.3 24 3.8Z" />
        <path className="tr-performanceCoreBlade tr-performanceCoreBladeA" d="M12.4 15.8 21.4 10.8 19.2 21.0 12.0 24.2Z" />
        <path className="tr-performanceCoreBlade tr-performanceCoreBladeB" d="M35.6 15.8 26.6 10.8 28.8 21.0 36.0 24.2Z" />
        <path className="tr-performanceCoreBlade tr-performanceCoreBladeC" d="M17.0 35.0 24.0 29.2 31.0 35.0 24.0 40.4Z" />
        <path className="tr-performanceCorePulse" d="M14.2 28.9 21.0 14.3 24.5 21.2 32.8 15.8 28.3 28.1 24.2 25.2 20.1 34.0 14.2 28.9Z" />
        <circle className="tr-performanceCoreRing" cx="24" cy="24" r="6.3" />
        <circle className="tr-performanceCoreNode" cx="24" cy="24" r="2.8" />
      </svg>
    </span>
  );
}

function sessionTrajectoryMetrics(elapsedSeconds: number, averageSeconds: number | null) {
  const elapsed = Math.max(0, Number(elapsedSeconds) || 0);
  const average = averageSeconds && averageSeconds >= 300 ? averageSeconds : null;
  const averageScale = average ? average / 0.8 : 60 * 60;
  const span = Math.max(30 * 60, averageScale, elapsed > 0 ? elapsed / 0.92 : 0);
  return {
    span,
    progress: Math.max(0, Math.min(0.985, elapsed / span)),
    averagePosition: average ? Math.max(0.05, Math.min(0.94, average / span)) : -1,
  };
}

function SessionTrajectory({
  elapsedSeconds,
  averageSeconds,
  paused,
}: {
  elapsedSeconds: number;
  averageSeconds: number | null;
  paused: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const propsRef = useRef({ elapsedSeconds, averageSeconds, paused });
  const sampleRef = useRef({ seconds: elapsedSeconds, at: 0 });
  const pulseRef = useRef(0);
  const previousElapsedRef = useRef(elapsedSeconds);

  propsRef.current = { elapsedSeconds, averageSeconds, paused };

  useEffect(() => {
    const now = typeof performance !== "undefined" ? performance.now() : 0;
    sampleRef.current = { seconds: elapsedSeconds, at: now };
    const average = averageSeconds ?? 0;
    if (average > 0 && previousElapsedRef.current < average && elapsedSeconds >= average) {
      pulseRef.current = 1;
    }
    previousElapsedRef.current = elapsedSeconds;
  }, [elapsedSeconds, averageSeconds, paused]);

  useEffect(() => {
    const onImpulse = (event: Event) => {
      const detail = (event as CustomEvent<{ intensity?: number }>).detail;
      pulseRef.current = Math.max(pulseRef.current, Math.max(0.25, Math.min(1, Number(detail?.intensity) || 0.55)));
    };
    window.addEventListener("mvp:performance-impulse", onImpulse as EventListener);
    return () => window.removeEventListener("mvp:performance-impulse", onImpulse as EventListener);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: true,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      powerPreference: "high-performance",
    });

    let raf = 0;
    let stopped = false;
    let lastFrame = performance.now();
    let visualTime = 0;

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      return { width, height, dpr };
    };

    const liveElapsed = (now: number) => {
      const sample = sampleRef.current;
      if (propsRef.current.paused || reducedMotion) return sample.seconds;
      return Math.max(sample.seconds, sample.seconds + Math.max(0, now - sample.at) / 1000);
    };

    if (!gl) {
      const context = canvas.getContext("2d");
      if (!context) return;
      const render2d = (now: number) => {
        if (stopped) return;
        const { width, height } = resizeCanvas();
        context.clearRect(0, 0, width, height);
        const elapsed = liveElapsed(now);
        const metrics = sessionTrajectoryMetrics(elapsed, propsRef.current.averageSeconds);
        const y = Math.round(height * 0.46) + 0.5;
        const nodeX = metrics.progress * width;
        const avgX = metrics.averagePosition >= 0 ? metrics.averagePosition * width : -1;
        context.lineCap = "round";
        context.lineWidth = Math.max(1, height * 0.055);
        context.strokeStyle = "rgba(116,153,171,.23)";
        context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke();
        context.strokeStyle = propsRef.current.paused ? "rgba(244,176,74,.92)" : "rgba(91,216,255,.96)";
        context.beginPath(); context.moveTo(0, y); context.lineTo(nodeX, y); context.stroke();
        context.fillStyle = propsRef.current.paused ? "rgba(255,193,91,.98)" : "rgba(215,249,255,.98)";
        context.beginPath(); context.arc(nodeX, y, Math.max(2, height * 0.11), 0, Math.PI * 2); context.fill();
        if (avgX >= 0) {
          context.strokeStyle = "rgba(231,242,247,.62)";
          context.lineWidth = Math.max(1, height * 0.035);
          context.beginPath(); context.moveTo(avgX, y - height * 0.18); context.lineTo(avgX, y + height * 0.18); context.stroke();
        }
        raf = requestAnimationFrame(render2d);
      };
      raf = requestAnimationFrame(render2d);
      return () => { stopped = true; cancelAnimationFrame(raf); };
    }

    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.warn("MVP Session Trajectory shader compile failed.", gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vertex = compile(gl.VERTEX_SHADER, `#version 300 es
      in vec2 a_position;
      void main(){ gl_Position = vec4(a_position, 0.0, 1.0); }
    `);
    const fragment = compile(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float;
      uniform vec2 u_resolution;
      uniform float u_progress;
      uniform float u_average;
      uniform float u_time;
      uniform float u_active;
      uniform float u_paused;
      uniform float u_pulse;
      out vec4 outColor;

      vec3 trajectoryColor(float phase){
        vec3 iceCyan = vec3(0.20, 0.82, 1.00);
        vec3 electricBlue = vec3(0.18, 0.48, 1.00);
        vec3 iceWhite = vec3(0.82, 0.96, 1.00);
        vec3 warmWhite = vec3(1.00, 0.84, 0.55);
        vec3 beyondGold = vec3(1.00, 0.60, 0.18);
        if (phase < 0.30) {
          return mix(iceCyan, electricBlue, smoothstep(0.0, 0.30, phase));
        }
        if (phase < 0.66) {
          return mix(electricBlue, iceWhite, smoothstep(0.30, 0.66, phase));
        }
        if (phase < 1.0) {
          return mix(iceWhite, warmWhite, smoothstep(0.66, 1.0, phase));
        }
        return mix(warmWhite, beyondGold, smoothstep(1.0, 1.30, min(phase, 1.30)));
      }

      void main(){
        vec2 p = gl_FragCoord.xy;
        float w = max(1.0, u_resolution.x);
        float h = max(1.0, u_resolution.y);
        float centerY = h * 0.54;
        float dy = abs(p.y - centerY);
        float xNorm = p.x / w;
        float nodeX = clamp(u_progress, 0.0, 1.0) * w;
        float beforeNode = 1.0 - smoothstep(nodeX - 0.8, nodeX + 0.8, p.x);

        float core = 1.0 - smoothstep(0.55, 1.65, dy);
        float nearGlow = 1.0 - smoothstep(1.0, 5.4, dy);
        float surfaceGlow = 1.0 - smoothstep(1.0, 11.0, dy);

        vec3 futureColor = vec3(0.26, 0.37, 0.44);
        float avgPos = u_average >= 0.05 ? u_average : 0.80;
        float phase = xNorm / max(avgPos, 0.08);
        vec3 pausedGold = vec3(1.00, 0.65, 0.24);
        vec3 activeColor = mix(trajectoryColor(phase), pausedGold, u_paused * 0.78);

        float futureAlpha = core * 0.17 + nearGlow * 0.035;
        float completedAlpha = beforeNode * (core * 0.93 + nearGlow * 0.22 + surfaceGlow * 0.055);
        float flow = (0.5 + 0.5 * sin(p.x * 0.041 - u_time * 2.6));
        completedAlpha += beforeNode * core * flow * 0.055 * u_active * (1.0 - u_paused);
        float filament = pow(0.5 + 0.5 * sin(p.x * 0.068 - u_time * 4.4), 12.0)
          * beforeNode * core * u_active * (1.0 - u_paused);
        float underLight = beforeNode * surfaceGlow * 0.042;

        float behind = max(0.0, nodeX - p.x);
        float trail = step(p.x, nodeX) * exp(-behind / max(38.0, w * 0.055)) * nearGlow;
        completedAlpha += trail * 0.13 * u_active;

        float nodeDist = length(vec2(p.x - nodeX, (p.y - centerY) * 1.08));
        float nodeCore = 1.0 - smoothstep(0.0, 2.4, nodeDist);
        float nodeRing = 1.0 - smoothstep(0.0, 1.2, abs(nodeDist - 4.2));
        float nodeHalo = 1.0 - smoothstep(2.8, 14.0, nodeDist);
        float nodeEnergy = nodeCore + nodeRing * 0.75 + nodeHalo * 0.24;

        float pulseBand = 0.0;
        if (u_pulse > 0.001) {
          float pulseX = nodeX - mod(u_time * 230.0, max(1.0, nodeX + 80.0));
          float pd = abs(p.x - pulseX);
          pulseBand = (1.0 - smoothstep(0.0, 18.0, pd)) * nearGlow * u_pulse;
        }

        float avgMarker = 0.0;
        if (u_average >= 0.0) {
          float avgX = u_average * w;
          float dx = abs(p.x - avgX);
          float vertical = 1.0 - smoothstep(h * 0.11, h * 0.30, dy);
          avgMarker = (1.0 - smoothstep(0.0, 0.75, dx)) * vertical * 0.72;
        }

        vec3 color = futureColor * futureAlpha;
        float alpha = futureAlpha;
        color += activeColor * completedAlpha;
        color += mix(activeColor, vec3(0.92, 0.99, 1.0), 0.42) * filament * 0.34;
        color += activeColor * underLight;
        alpha = max(alpha, max(completedAlpha, max(filament * 0.34, underLight)));
        float nodePhase = clamp(u_progress, 0.0, 1.0) / max(avgPos, 0.08);
        vec3 nodeColor = mix(trajectoryColor(nodePhase), vec3(1.0, 0.76, 0.34), u_paused);
        color += nodeColor * nodeEnergy;
        alpha = max(alpha, nodeEnergy);
        color += activeColor * pulseBand * 0.8;
        alpha = max(alpha, pulseBand * 0.8);
        color += vec3(0.88, 0.95, 0.98) * avgMarker;
        alpha = max(alpha, avgMarker);

        outColor = vec4(min(color, vec3(1.0)), clamp(alpha, 0.0, 1.0));
      }
    `);

    if (!vertex || !fragment) return;
    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn("MVP Session Trajectory program link failed.", gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return;
    }

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const resolutionLoc = gl.getUniformLocation(program, "u_resolution");
    const progressLoc = gl.getUniformLocation(program, "u_progress");
    const averageLoc = gl.getUniformLocation(program, "u_average");
    const timeLoc = gl.getUniformLocation(program, "u_time");
    const activeLoc = gl.getUniformLocation(program, "u_active");
    const pausedLoc = gl.getUniformLocation(program, "u_paused");
    const pulseLoc = gl.getUniformLocation(program, "u_pulse");
    gl.useProgram(program);

    const render = (now: number) => {
      if (stopped) return;
      const frameDelta = Math.min(50, Math.max(0, now - lastFrame));
      lastFrame = now;
      if (!propsRef.current.paused && !reducedMotion) visualTime += frameDelta / 1000;
      pulseRef.current = Math.max(0, pulseRef.current - frameDelta / 850);

      const { width, height } = resizeCanvas();
      const elapsed = liveElapsed(now);
      const metrics = sessionTrajectoryMetrics(elapsed, propsRef.current.averageSeconds);

      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.uniform2f(resolutionLoc, width, height);
      gl.uniform1f(progressLoc, metrics.progress);
      gl.uniform1f(averageLoc, metrics.averagePosition);
      gl.uniform1f(timeLoc, visualTime);
      gl.uniform1f(activeLoc, reducedMotion ? 0 : 1);
      gl.uniform1f(pausedLoc, propsRef.current.paused ? 1 : 0);
      gl.uniform1f(pulseLoc, pulseRef.current);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      raf = requestAnimationFrame(render);
    };

    raf = requestAnimationFrame(render);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      if (buffer) gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  }, []);

  const averageMinutes = averageSeconds ? Math.max(1, Math.round(averageSeconds / 60)) : null;
  const trajectoryMetrics = sessionTrajectoryMetrics(elapsedSeconds, averageSeconds);
  const averageLeft = trajectoryMetrics.averagePosition >= 0
    ? `${Math.max(0, Math.min(100, trajectoryMetrics.averagePosition * 100)).toFixed(3)}%`
    : null;

  return (
    <div className={`tr-sessionTrajectory ${paused ? "is-paused" : "is-active"}`}>
      <canvas ref={canvasRef} className="tr-sessionTrajectoryCanvas" aria-hidden="true" />
      {averageMinutes && averageLeft ? (
        <span className="tr-sessionTrajectoryAverage" style={{ left: averageLeft }} aria-hidden="true">
          AVG {averageMinutes} MIN
        </span>
      ) : (
        <span className="tr-sessionTrajectoryLearning" aria-hidden="true">LEARNING YOUR SESSION PACE</span>
      )}
    </div>
  );
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


/* =====================================================================
   MVP TRAINER R12.4 — ADAPTIVE PERFORMANCE HUD
   One seamless performance surface. Active mode collapses hard so the
   exercise UI owns the screen. The Session Trajectory is WebGL2-rendered
   from real elapsed time + the user's recent completed-workout baseline.
   ===================================================================== */
.tr-performanceHudShell,
.tr-performanceHudShell.tr-hudPanel,
.tr-performanceHudShell.tr-card{
  width:100%!important;
  max-width:none!important;
  margin:0 0 12px!important;
  padding:0!important;
  border:0!important;
  border-radius:0!important;
  background:transparent!important;
  box-shadow:none!important;
  overflow:visible!important;
}
.tr-performanceHudShell::before,
.tr-performanceHudShell::after{display:none!important}
.tr-performanceHudSurface{
  --perf-blue:81,207,255;
  --perf-ice:219,247,255;
  --perf-green:87,239,160;
  --perf-amber:255,181,72;
  position:relative;
  isolation:isolate;
  overflow:hidden;
  min-height:116px;
  padding:15px 18px 11px;
  border:1px solid rgba(139,202,224,.24);
  border-radius:20px;
  background:
    radial-gradient(700px 150px at 50% -52%,rgba(96,206,244,.12),transparent 66%),
    radial-gradient(420px 150px at 8% 110%,rgba(42,122,160,.065),transparent 72%),
    linear-gradient(180deg,rgba(14,24,31,.975),rgba(5,10,14,.992));
  box-shadow:
    0 18px 48px rgba(0,0,0,.34),
    inset 0 1px 0 rgba(255,255,255,.075),
    inset 0 -1px 0 rgba(51,132,165,.055);
  -webkit-backdrop-filter:blur(14px) saturate(1.08);
  backdrop-filter:blur(14px) saturate(1.08);
  transition:min-height .38s cubic-bezier(.22,.78,.22,1),padding .38s cubic-bezier(.22,.78,.22,1),border-color .28s ease,background .35s ease,box-shadow .35s ease;
}
.tr-performanceHudSurface::before{
  content:"";
  position:absolute;
  inset:0;
  z-index:-1;
  pointer-events:none;
  opacity:.78;
  background:
    linear-gradient(115deg,transparent 0 30%,rgba(255,255,255,.018) 43%,transparent 57% 100%),
    repeating-linear-gradient(90deg,rgba(255,255,255,.007) 0 1px,transparent 1px 5px);
  mask-image:linear-gradient(180deg,rgba(0,0,0,.75),rgba(0,0,0,.24));
}
.tr-performanceHudSurface::after{
  content:"";
  position:absolute;
  left:7%;right:7%;top:0;height:1px;
  pointer-events:none;
  background:linear-gradient(90deg,transparent,rgba(214,246,255,.24) 30%,rgba(255,255,255,.35) 50%,rgba(214,246,255,.24) 70%,transparent);
}
.tr-performanceHudSurface.is-active,
.tr-performanceHudSurface.is-paused{
  min-height:68px;
  padding:8px 14px 6px;
  border-color:rgba(104,196,224,.26);
  background:
    radial-gradient(430px 92px at 43% 12%,rgba(58,184,230,.095),transparent 72%),
    linear-gradient(180deg,rgba(10,19,25,.985),rgba(4,8,12,.995));
  box-shadow:0 12px 34px rgba(0,0,0,.31),inset 0 1px 0 rgba(255,255,255,.065),inset 0 -1px rgba(35,124,157,.045);
}
.tr-performanceHudSurface.is-paused{
  border-color:rgba(234,164,72,.24);
  background:
    radial-gradient(410px 90px at 36% 10%,rgba(234,155,52,.075),transparent 72%),
    linear-gradient(180deg,rgba(19,17,13,.985),rgba(7,8,9,.995));
}

.tr-performanceStateBlock{display:flex;align-items:center;gap:10px;min-width:0}
.tr-performanceStateText{display:grid;gap:3px;min-width:0}
.tr-performanceStateText>span{
  color:rgba(164,197,211,.58);
  font-family:"Segoe UI Variable Text","SF Pro Text",Inter,"Segoe UI",system-ui,sans-serif;
  font-size:8px;
  line-height:1;
  font-weight:850;
  letter-spacing:.17em;
  text-transform:uppercase;
}
.tr-performanceStateText>strong{
  color:#c9f6da;
  font-family:"Segoe UI Variable Display","SF Pro Display",Inter,"Segoe UI",system-ui,sans-serif;
  font-size:16px;
  line-height:1;
  font-weight:880;
  font-variation-settings:"wght" 880;
  letter-spacing:.085em;
  text-transform:uppercase;
  text-shadow:none;
}
.tr-performanceStateText>strong.is-ready{color:#c8f8d9}
.tr-performanceStateText>strong.is-offline{color:#e3edf1}
.is-active .tr-performanceStateText>strong{color:#b9f7d2}
.is-paused .tr-performanceStateText>strong{color:#ffd498}

.tr-performanceCoreIcon{
  position:relative;
  display:inline-grid;
  place-items:center;
  width:38px;height:38px;
  flex:0 0 auto;
  color:rgb(var(--perf-ice));
  filter:drop-shadow(0 3px 9px rgba(40,154,198,.15));
}
.tr-performanceCoreIcon::before{
  content:"";
  position:absolute;
  inset:6px;
  border-radius:50%;
  background:radial-gradient(circle,rgba(105,218,255,.11),transparent 68%);
  opacity:.7;
}
.tr-performanceCoreIcon svg{position:relative;width:100%;height:100%;overflow:visible}
.tr-performanceCoreFrame{
  fill:rgba(8,18,24,.38);
  stroke:rgba(179,229,245,.58);
  stroke-width:1.4;
  vector-effect:non-scaling-stroke;
}
.tr-performanceCorePulse{
  fill:none;
  stroke:rgba(119,218,250,.88);
  stroke-width:2.05;
  stroke-linecap:round;
  stroke-linejoin:round;
  vector-effect:non-scaling-stroke;
}
.tr-performanceCoreNode{fill:#eafaff;stroke:rgba(92,210,248,.8);stroke-width:1}
.tr-performanceCoreIcon.is-active{color:rgb(var(--perf-green));filter:drop-shadow(0 0 8px rgba(82,226,167,.20))}
.tr-performanceCoreIcon.is-active .tr-performanceCoreFrame{stroke:rgba(100,232,181,.62)}
.tr-performanceCoreIcon.is-active .tr-performanceCorePulse{stroke:#8af1c0;stroke-dasharray:13 7;animation:tr-performanceCoreFlow 2.15s linear infinite}
.tr-performanceCoreIcon.is-active .tr-performanceCoreNode{fill:#eafff3;stroke:#74efb4}
.tr-performanceCoreIcon.is-paused{filter:drop-shadow(0 0 7px rgba(245,173,67,.16))}
.tr-performanceCoreIcon.is-paused .tr-performanceCoreFrame{stroke:rgba(255,190,94,.62)}
.tr-performanceCoreIcon.is-paused .tr-performanceCorePulse{stroke:#ffc375}
.tr-performanceCoreIcon.is-paused .tr-performanceCoreNode{fill:#fff3d8;stroke:#ffc070}
.tr-performanceCoreIcon.is-offline{opacity:.63;filter:none}
@keyframes tr-performanceCoreFlow{to{stroke-dashoffset:-40}}

.tr-performanceReadyMain{
  min-height:60px;
  display:grid;
  grid-template-columns:minmax(165px,.72fr) minmax(340px,1.5fr) minmax(180px,.72fr);
  align-items:center;
  gap:18px;
}
.tr-performanceClockBlock{display:grid;justify-items:center;gap:3px;text-align:center;min-width:0}
.tr-performanceReadyDate{
  color:rgba(246,250,252,.94);
  font-family:"Segoe UI Variable Text","SF Pro Text",Inter,"Segoe UI",system-ui,sans-serif;
  font-size:clamp(13px,1.35vw,17px);
  line-height:1.05;
  font-weight:760;
  font-variation-settings:"wght" 760;
  letter-spacing:.005em;
  white-space:nowrap;
  text-rendering:geometricPrecision;
}
.tr-performanceReadyTime{
  color:#fff0c2;
  font-family:"Segoe UI Variable Display","SF Pro Display",Inter,"Segoe UI",system-ui,sans-serif;
  font-size:clamp(27px,2.8vw,36px);
  line-height:1;
  font-weight:820;
  font-variation-settings:"wght" 820;
  letter-spacing:.018em;
  font-variant-numeric:tabular-nums lining-nums;
  text-shadow:0 0 24px rgba(255,210,113,.10);
}
.tr-performanceReadyAction{display:flex;justify-content:flex-end;min-width:0}
.tr-performanceStart{
  min-width:170px;
  min-height:43px;
  padding:0 16px;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:9px;
  border:1px solid rgba(89,202,247,.46);
  border-radius:13px;
  background:linear-gradient(180deg,rgba(22,126,177,.28),rgba(6,45,67,.36));
  color:#f7fdff;
  box-shadow:0 8px 20px rgba(0,0,0,.22),inset 0 1px 0 rgba(222,249,255,.10),0 0 18px rgba(62,191,241,.07);
  font-family:"Segoe UI Variable Text","SF Pro Text",Inter,"Segoe UI",system-ui,sans-serif;
  font-size:10px;
  font-weight:900;
  letter-spacing:.10em;
  text-transform:uppercase;
  cursor:pointer;
  transition:transform .16s ease,border-color .16s ease,background .16s ease,box-shadow .16s ease;
}
.tr-performanceStartMark{font-size:12px;color:#bcecff;line-height:1}
.tr-performanceStart:hover:not(:disabled){transform:translateY(-1px);border-color:rgba(107,220,255,.68);background:linear-gradient(180deg,rgba(26,145,200,.34),rgba(7,57,82,.40));box-shadow:0 11px 23px rgba(0,0,0,.26),inset 0 1px 0 rgba(235,252,255,.13),0 0 20px rgba(63,199,248,.10)}
.tr-performanceStart:active:not(:disabled){transform:translateY(0)}
.tr-performanceStart:disabled{opacity:.42;cursor:not-allowed;filter:saturate(.55)}

.tr-performanceReadyFooter{
  position:relative;
  min-height:31px;
  margin-top:7px;
  padding-top:8px;
  display:flex;
  align-items:center;
  gap:16px;
  border-top:1px solid rgba(152,201,218,.10);
}
.tr-performanceMetric{display:flex;align-items:baseline;gap:7px;min-width:0;white-space:nowrap}
.tr-performanceMetric>span{
  color:rgba(156,188,202,.58);
  font-size:7.5px;
  line-height:1;
  font-weight:850;
  letter-spacing:.14em;
}
.tr-performanceMetric>strong{
  color:#f5fbfd;
  font-size:15px;
  line-height:1;
  font-weight:860;
  font-variation-settings:"wght" 860;
  font-variant-numeric:tabular-nums lining-nums;
}
.tr-performanceMetric>small{color:rgba(146,173,184,.42);font-size:6.5px;font-weight:800;letter-spacing:.09em}
.tr-performanceMetricDivider{width:1px;height:16px;background:rgba(159,202,218,.11)}
.tr-performanceDormantRail{
  position:relative;
  height:9px;
  flex:1 1 auto;
  min-width:90px;
  margin-left:5px;
}
.tr-performanceDormantRail::before{
  content:"";
  position:absolute;
  left:0;right:0;top:4px;height:1px;
  background:linear-gradient(90deg,rgba(83,149,174,.08),rgba(116,191,218,.18),rgba(83,149,174,.08));
}
.tr-performanceDormantRail>span{
  position:absolute;
  left:0;top:3px;width:26%;height:2px;
  background:linear-gradient(90deg,rgba(72,176,215,.06),rgba(116,216,246,.30),rgba(72,176,215,.06));
  opacity:.68;
}

.tr-performanceActiveMain{
  min-height:37px;
  display:grid;
  grid-template-columns:minmax(130px,.72fr) auto minmax(220px,1.15fr) auto;
  align-items:center;
  gap:13px;
}
.tr-performanceHudSurface.is-active .tr-performanceCoreIcon,
.tr-performanceHudSurface.is-paused .tr-performanceCoreIcon{width:30px;height:30px}
.tr-performanceHudSurface.is-active .tr-performanceStateText>span,
.tr-performanceHudSurface.is-paused .tr-performanceStateText>span{font-size:6.8px;letter-spacing:.15em}
.tr-performanceHudSurface.is-active .tr-performanceStateText>strong,
.tr-performanceHudSurface.is-paused .tr-performanceStateText>strong{font-size:13px}
.tr-performanceTimerBlock{display:grid;justify-items:center;gap:1px;min-width:112px}
.tr-performanceTimer{
  color:#f7fdff;
  font-family:"Segoe UI Variable Display","SF Pro Display",Inter,"Segoe UI",system-ui,sans-serif;
  font-size:25px;
  line-height:.96;
  font-weight:790;
  font-variation-settings:"wght" 790;
  letter-spacing:.028em;
  font-variant-numeric:tabular-nums lining-nums;
  font-feature-settings:"tnum" 1,"lnum" 1;
  text-rendering:geometricPrecision;
  -webkit-font-smoothing:antialiased;
  text-shadow:0 0 20px rgba(99,214,255,.09);
}
.is-paused .tr-performanceTimer{color:#fff3d5;text-shadow:0 0 18px rgba(255,186,80,.08)}
.tr-performanceTimerBlock>span{
  color:rgba(149,190,207,.55);
  font-size:6.5px;
  font-weight:850;
  letter-spacing:.16em;
  line-height:1;
}
.tr-performanceDate{
  min-width:0;
  text-align:center;
  color:rgba(217,230,236,.72);
  font-size:10.5px;
  line-height:1.1;
  font-weight:720;
  letter-spacing:.01em;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
.tr-performanceActions{display:flex;align-items:center;justify-content:flex-end;gap:7px}
.tr-performanceControl{
  min-height:31px;
  padding:0 10px;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:6px;
  border:1px solid rgba(122,193,220,.22);
  border-radius:9px;
  background:linear-gradient(180deg,rgba(18,35,44,.72),rgba(7,14,18,.86));
  color:#eaf7fb;
  font-size:8px;
  font-weight:900;
  letter-spacing:.08em;
  cursor:pointer;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.045),0 5px 12px rgba(0,0,0,.19);
  transition:transform .15s ease,border-color .15s ease,background .15s ease,color .15s ease;
}
.tr-performanceControl>span{font-size:8.5px;line-height:1}
.tr-performanceControl.is-primary{border-color:rgba(76,200,239,.32);color:#d9f6ff}
.tr-performanceControl.is-resume{border-color:rgba(87,224,155,.34);color:#c9f6da}
.tr-performanceControl.is-end{border-color:rgba(239,104,110,.19);color:#f0b7ba;background:linear-gradient(180deg,rgba(50,24,26,.43),rgba(16,8,9,.70))}
.tr-performanceControl:hover:not(:disabled){transform:translateY(-1px);border-color:rgba(117,218,249,.52)}
.tr-performanceControl.is-end:hover:not(:disabled){border-color:rgba(245,112,118,.42);color:#ffd1d3}
.tr-performanceControl:disabled{opacity:.30;cursor:not-allowed}

.tr-sessionTrajectory{
  position:relative;
  height:23px;
  margin-top:0;
  overflow:hidden;
}
.tr-sessionTrajectory::before{
  content:"";
  position:absolute;
  left:0;right:0;top:9px;height:1px;
  pointer-events:none;
  background:linear-gradient(90deg,rgba(92,135,153,.08),rgba(112,163,182,.16),rgba(92,135,153,.08));
}
.tr-sessionTrajectoryCanvas{
  position:absolute;
  inset:0 0 auto 0;
  width:100%;
  height:17px;
  display:block;
  pointer-events:none;
}
.tr-sessionTrajectoryMeta{
  position:absolute;
  left:0;right:0;bottom:0;
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:12px;
  pointer-events:none;
  color:rgba(142,174,188,.48);
  font-family:"Segoe UI Variable Text","SF Pro Text",Inter,"Segoe UI",system-ui,sans-serif;
  font-size:6.5px;
  line-height:1;
  font-weight:820;
  letter-spacing:.12em;
  text-transform:uppercase;
}
.tr-sessionTrajectoryMeta strong{color:rgba(160,225,244,.72);font-size:6.5px;font-weight:850}
.tr-sessionTrajectory.is-paused .tr-sessionTrajectoryMeta strong{color:rgba(255,203,126,.72)}

@media(max-width:900px){
  .tr-performanceReadyMain{grid-template-columns:minmax(145px,.7fr) minmax(270px,1.35fr) minmax(155px,.72fr);gap:12px}
  .tr-performanceStart{min-width:150px;padding:0 12px}
  .tr-performanceActiveMain{grid-template-columns:minmax(112px,.68fr) auto minmax(170px,1fr) auto;gap:9px}
  .tr-performanceDate{font-size:9.5px}
}

@media(max-width:720px){
  .tr-performanceHudShell,
  .tr-performanceHudShell.tr-hudPanel{margin-bottom:9px!important}
  .tr-performanceHudSurface{
    min-height:132px;
    padding:12px 12px 9px;
    border-radius:16px;
  }
  .tr-performanceReadyMain{
    min-height:84px;
    grid-template-columns:1fr auto;
    grid-template-areas:"state action" "clock clock";
    gap:8px 10px;
  }
  .tr-performanceReadyMain>.tr-performanceStateBlock{grid-area:state}
  .tr-performanceReadyMain>.tr-performanceClockBlock{grid-area:clock}
  .tr-performanceReadyMain>.tr-performanceReadyAction{grid-area:action}
  .tr-performanceCoreIcon{width:32px;height:32px}
  .tr-performanceStateBlock{gap:8px}
  .tr-performanceStateText>span{font-size:6.8px}
  .tr-performanceStateText>strong{font-size:13.5px}
  .tr-performanceReadyDate{font-size:clamp(10.5px,3.2vw,13px);white-space:nowrap}
  .tr-performanceReadyTime{font-size:clamp(25px,8vw,31px)}
  .tr-performanceStart{min-width:0;min-height:38px;padding:0 11px;border-radius:11px;font-size:8.5px;letter-spacing:.075em}
  .tr-performanceStartMark{font-size:10px}
  .tr-performanceReadyFooter{min-height:28px;margin-top:4px;padding-top:7px;gap:8px}
  .tr-performanceMetric{gap:4px}
  .tr-performanceMetric>span{font-size:6px;letter-spacing:.10em}
  .tr-performanceMetric>strong{font-size:12.5px}
  .tr-performanceMetric>small{display:none}
  .tr-performanceMetricDivider{height:13px}
  .tr-performanceDormantRail{display:none}

  .tr-performanceHudSurface.is-active,
  .tr-performanceHudSurface.is-paused{
    min-height:88px;
    padding:7px 9px 5px;
    border-radius:14px;
  }
  .tr-performanceActiveMain{
    min-height:56px;
    grid-template-columns:minmax(105px,1fr) auto;
    grid-template-areas:"state timer" "date actions";
    align-items:center;
    gap:5px 8px;
  }
  .tr-performanceActiveMain>.tr-performanceStateBlock{grid-area:state}
  .tr-performanceActiveMain>.tr-performanceTimerBlock{grid-area:timer;justify-self:end}
  .tr-performanceActiveMain>.tr-performanceDate{grid-area:date;text-align:left;justify-self:start;max-width:100%;font-size:clamp(8.8px,2.75vw,10.5px);overflow:visible;text-overflow:clip;white-space:nowrap}
  .tr-performanceActiveMain>.tr-performanceActions{grid-area:actions;justify-self:end}
  .tr-performanceHudSurface.is-active .tr-performanceCoreIcon,
  .tr-performanceHudSurface.is-paused .tr-performanceCoreIcon{width:27px;height:27px}
  .tr-performanceHudSurface.is-active .tr-performanceStateText>strong,
  .tr-performanceHudSurface.is-paused .tr-performanceStateText>strong{font-size:11.5px}
  .tr-performanceTimerBlock{min-width:0;justify-items:end}
  .tr-performanceTimer{font-size:clamp(20px,6.5vw,24px)}
  .tr-performanceTimerBlock>span{font-size:5.8px;letter-spacing:.13em}
  .tr-performanceControl{min-height:29px;padding:0 8px;font-size:7.2px;border-radius:8px;gap:4px}
  .tr-performanceControl>span{font-size:7.5px}
  .tr-sessionTrajectory{height:22px;margin-top:0}
  .tr-sessionTrajectoryCanvas{height:16px}
  .tr-sessionTrajectoryMeta{font-size:5.7px;letter-spacing:.085em}
  .tr-sessionTrajectoryMeta strong{font-size:5.7px}
}

@media(max-width:390px){
  .tr-performanceHudSurface{padding-left:9px;padding-right:9px}
  .tr-performanceReadyMain{grid-template-columns:minmax(0,1fr) auto}
  .tr-performanceStart{padding:0 9px;font-size:8px}
  .tr-performanceReadyFooter{gap:6px}
  .tr-performanceMetric>span{display:none}
  .tr-performanceMetric>strong{font-size:12px}
  .tr-performanceActiveMain{grid-template-columns:minmax(92px,1fr) auto;gap:4px 6px}
  .tr-performanceStateText>span{display:none}
  .tr-performanceDate{font-size:8.5px!important}
  .tr-performanceControl{padding:0 7px;font-size:6.8px}
}

@media(hover:none){
  .tr-performanceStart:hover:not(:disabled),
  .tr-performanceControl:hover:not(:disabled){transform:none}
}

@media(prefers-reduced-motion:reduce){
  .tr-performanceHudSurface,
  .tr-performanceStart,
  .tr-performanceControl{transition:none!important}
  .tr-performanceCoreIcon.is-active .tr-performanceCorePulse{animation:none!important}
}

/* =====================================================================
   MVP TRAINER R12.5B — PRECISION PERFORMANCE HUD ONLY
   Visual-only HUD refinement. Keeps workout/session behavior intact.
   ===================================================================== */
.tr-performanceHudSurface{
  min-height:102px;
  padding:11px 16px 7px;
  border-radius:14px;
  border-color:rgba(155,219,241,.30);
  background:
    radial-gradient(520px 118px at 50% -34%,rgba(92,213,255,.17),transparent 70%),
    radial-gradient(330px 100px at 8% 112%,rgba(44,134,176,.085),transparent 72%),
    linear-gradient(180deg,rgba(15,27,35,.992),rgba(5,10,14,.998));
  box-shadow:
    0 17px 44px rgba(0,0,0,.39),
    0 0 30px rgba(43,171,219,.035),
    inset 0 1px 0 rgba(239,252,255,.105),
    inset 0 -1px 0 rgba(47,143,181,.075),
    inset 0 0 0 1px rgba(146,222,247,.025);
}
.tr-performanceHudSurface::before{
  opacity:.92;
  background:
    radial-gradient(380px 100px at 50% 16%,rgba(133,226,255,.055),transparent 72%),
    linear-gradient(108deg,transparent 0 34%,rgba(255,255,255,.030) 46%,rgba(164,235,255,.014) 50%,transparent 62% 100%),
    repeating-linear-gradient(90deg,rgba(255,255,255,.006) 0 1px,transparent 1px 6px);
  background-size:100% 100%,220% 100%,100% 100%;
  background-position:0 0,-120% 0,0 0;
  animation:tr-performanceSurfaceSweep 11s ease-in-out infinite;
}
.tr-performanceHudSurface::after{
  left:2.5%;right:2.5%;
  background:linear-gradient(90deg,transparent,rgba(162,229,252,.22) 22%,rgba(245,253,255,.62) 50%,rgba(162,229,252,.22) 78%,transparent);
  box-shadow:0 0 10px rgba(91,203,242,.12);
}
.tr-performanceHudSurface.is-active,
.tr-performanceHudSurface.is-paused{
  min-height:72px;
  padding:7px 13px 4px;
  border-radius:12px;
  border-color:rgba(132,218,247,.34);
  background:
    radial-gradient(390px 76px at 42% 8%,rgba(71,199,247,.145),transparent 72%),
    linear-gradient(180deg,rgba(10,21,28,.995),rgba(4,8,11,.999));
  box-shadow:
    0 12px 32px rgba(0,0,0,.36),
    0 0 28px rgba(55,183,229,.035),
    inset 0 1px 0 rgba(235,251,255,.095),
    inset 0 -1px 0 rgba(50,145,181,.06);
}
.tr-performanceHudSurface.is-active::before{animation-duration:7.8s}
.tr-performanceHudSurface.is-paused{
  border-color:rgba(255,191,97,.31);
  background:
    radial-gradient(390px 76px at 42% 8%,rgba(240,164,55,.105),transparent 72%),
    linear-gradient(180deg,rgba(22,18,12,.995),rgba(7,8,9,.999));
  box-shadow:0 12px 32px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,236,196,.075),inset 0 -1px 0 rgba(160,103,34,.055);
}
.tr-performanceHudSurface.is-paused::before{animation:none;opacity:.62}
@keyframes tr-performanceSurfaceSweep{
  0%,18%{background-position:0 0,-120% 0,0 0}
  72%,100%{background-position:0 0,120% 0,0 0}
}

.tr-performanceCoreIcon{
  width:36px;height:36px;
  filter:drop-shadow(0 4px 10px rgba(67,188,229,.16));
}
.tr-performanceCoreIcon::before{
  inset:4px;
  background:radial-gradient(circle,rgba(115,223,255,.13),rgba(65,170,215,.035) 42%,transparent 70%);
}
.tr-performanceCoreFrame{
  fill:rgba(5,15,21,.58);
  stroke:rgba(202,242,255,.72);
  stroke-width:1.15;
}
.tr-performanceCorePulse{
  fill:rgba(92,214,249,.11);
  stroke:rgba(143,231,255,.92);
  stroke-width:1.55;
  stroke-linejoin:round;
}
.tr-performanceCoreBlade{
  fill:rgba(191,244,255,.24);
  stroke:rgba(185,241,255,.62);
  stroke-width:.8;
  vector-effect:non-scaling-stroke;
}
.tr-performanceCoreNode{fill:#f4fdff;stroke:rgba(113,226,255,.9);stroke-width:1}
.tr-performanceCoreIcon.is-active .tr-performanceCoreFrame{stroke:rgba(153,242,211,.76)}
.tr-performanceCoreIcon.is-active .tr-performanceCorePulse{fill:rgba(84,229,179,.14);stroke:#9af5d1;stroke-dasharray:none;animation:tr-performanceCoreEnergize 2.4s ease-in-out infinite}
.tr-performanceCoreIcon.is-active .tr-performanceCoreBlade{fill:rgba(116,246,202,.22);stroke:rgba(154,248,217,.72)}
.tr-performanceCoreIcon.is-active .tr-performanceCoreNode{fill:#f0fff8;stroke:#7ef2be}
.tr-performanceCoreIcon.is-paused .tr-performanceCorePulse{fill:rgba(255,181,75,.12);stroke:#ffd092;animation:none}
.tr-performanceCoreIcon.is-paused .tr-performanceCoreBlade{fill:rgba(255,190,87,.18);stroke:rgba(255,209,146,.70)}
@keyframes tr-performanceCoreEnergize{0%,100%{opacity:.82}50%{opacity:1}}

.tr-performanceReadyMain{
  min-height:55px;
  grid-template-columns:minmax(145px,.70fr) minmax(310px,1.55fr) minmax(155px,.72fr);
  gap:14px;
}
.tr-performanceClockBlock{gap:2px}
.tr-performanceReadyDate{
  font-size:clamp(12.5px,1.25vw,16px);
  font-weight:720;
  color:rgba(239,248,251,.91);
  text-shadow:0 1px 0 rgba(0,0,0,.48);
}
.tr-performanceReadyTime{
  font-size:clamp(28px,2.75vw,35px);
  font-weight:790;
  color:#fff4d2;
  text-shadow:none;
}
.tr-performanceReadyAction{align-items:center}
.tr-performanceStart{
  min-width:156px;
  min-height:39px;
  padding:0 14px;
  border-radius:10px;
  border-color:rgba(109,215,252,.48);
  background:linear-gradient(180deg,rgba(25,131,177,.26),rgba(6,43,61,.38));
  box-shadow:0 7px 18px rgba(0,0,0,.24),inset 0 1px 0 rgba(229,251,255,.12),0 0 18px rgba(63,192,238,.055);
}
.tr-performanceReadyFooter{
  min-height:27px;
  margin-top:3px;
  padding-top:6px;
  gap:13px;
  border-top-color:rgba(165,220,239,.105);
}
.tr-performanceMetric{gap:6px}
.tr-performanceMetric>span{font-size:7px;color:rgba(167,205,220,.64)}
.tr-performanceMetric>strong{font-size:14px;color:#f7fcfe}
.tr-performanceMetric>small{font-size:6px;color:rgba(151,182,194,.44)}
.tr-performanceDormantRail{height:8px}
.tr-performanceDormantRail::before{top:4px;background:linear-gradient(90deg,rgba(77,139,164,.07),rgba(129,208,235,.20),rgba(77,139,164,.07))}
.tr-performanceDormantRail>span{top:3px;background:linear-gradient(90deg,rgba(74,183,222,.03),rgba(149,230,255,.36),rgba(74,183,222,.03))}

.tr-performanceActiveMain{
  min-height:34px;
  grid-template-columns:minmax(125px,.72fr) minmax(132px,auto) minmax(210px,1.15fr) auto;
  gap:11px;
}
.tr-performanceHudSurface.is-active .tr-performanceCoreIcon,
.tr-performanceHudSurface.is-paused .tr-performanceCoreIcon{width:30px;height:30px}
.tr-performanceStateText>span{color:rgba(171,210,225,.60)}
.tr-performanceStateText>strong{letter-spacing:.075em}
.tr-performanceTimerBlock{
  position:relative;
  isolation:isolate;
  min-width:132px;
  gap:0;
}
.tr-performanceTimerBlock::before{
  content:"";
  position:absolute;
  z-index:-1;
  left:50%;top:50%;
  width:170px;height:58px;
  transform:translate(-50%,-50%);
  pointer-events:none;
  background:radial-gradient(ellipse,rgba(112,222,255,.12),rgba(80,185,230,.035) 44%,transparent 72%);
  filter:blur(2px);
}
.is-paused .tr-performanceTimerBlock::before{background:radial-gradient(ellipse,rgba(255,190,86,.10),rgba(210,131,34,.025) 45%,transparent 72%)}
.tr-performanceTimer{
  font-size:29px;
  font-weight:770;
  letter-spacing:.022em;
  color:#fbfeff;
  text-shadow:none;
}
.is-paused .tr-performanceTimer{color:#fff1d4;text-shadow:none}
.tr-performanceTimerBlock>span{font-size:6.2px;color:rgba(165,206,222,.58);letter-spacing:.15em}
.tr-performanceDate{font-size:10.3px;color:rgba(222,237,242,.76);overflow:visible;text-overflow:clip}
.tr-performanceActions{gap:6px}
.tr-performanceControl{
  min-height:30px;
  padding:0 9px;
  border-radius:7px;
  border-color:rgba(132,205,231,.24);
  background:linear-gradient(180deg,rgba(19,37,47,.72),rgba(6,13,17,.88));
  box-shadow:inset 0 1px 0 rgba(255,255,255,.055),0 5px 13px rgba(0,0,0,.20);
}
.tr-performanceControl.is-primary{border-color:rgba(91,210,248,.38);color:#e2f8ff}
.tr-performanceControl.is-resume{border-color:rgba(94,235,169,.40);color:#d4fae5}
.tr-performanceControl.is-end{border-color:rgba(241,111,117,.22);color:#efb8bb}

.tr-sessionTrajectory{
  height:25px;
  margin-top:0;
  overflow:visible;
}
.tr-sessionTrajectory::before{top:8px;height:1px;background:linear-gradient(90deg,rgba(90,138,157,.065),rgba(139,192,211,.16),rgba(90,138,157,.065))}
.tr-sessionTrajectoryCanvas{height:17px}
.tr-sessionTrajectoryAverage,
.tr-sessionTrajectoryLearning{
  position:absolute;
  bottom:0;
  z-index:2;
  color:rgba(185,214,224,.62);
  font-family:"Segoe UI Variable Text","SF Pro Text",Inter,"Segoe UI",system-ui,sans-serif;
  font-size:6.4px;
  line-height:1;
  font-weight:860;
  letter-spacing:.095em;
  white-space:nowrap;
  text-transform:uppercase;
  pointer-events:none;
  text-shadow:0 1px 0 rgba(0,0,0,.65);
}
.tr-sessionTrajectoryAverage{transform:translateX(-50%);color:rgba(214,232,238,.72)}
.tr-sessionTrajectoryLearning{left:50%;transform:translateX(-50%)}
.tr-sessionTrajectoryMeta{display:none!important}

@media(max-width:720px){
  .tr-performanceHudSurface{
    min-height:108px;
    padding:9px 10px 6px;
    border-radius:13px;
  }
  .tr-performanceReadyMain{
    min-height:67px;
    grid-template-columns:minmax(0,1fr) auto;
    grid-template-areas:"state action" "clock clock";
    gap:5px 8px;
  }
  .tr-performanceCoreIcon{width:30px;height:30px}
  .tr-performanceStateBlock{gap:7px}
  .tr-performanceStateText>span{font-size:6.2px;letter-spacing:.14em}
  .tr-performanceStateText>strong{font-size:12.5px}
  .tr-performanceReadyDate{font-size:clamp(10px,3vw,12px)}
  .tr-performanceReadyTime{font-size:clamp(25px,7.5vw,30px)}
  .tr-performanceStart{min-height:35px;padding:0 9px;border-radius:9px;font-size:7.8px;letter-spacing:.065em}
  .tr-performanceReadyFooter{min-height:25px;margin-top:2px;padding-top:5px;gap:7px}
  .tr-performanceMetric{gap:3px}
  .tr-performanceMetric>span{display:inline;font-size:5.4px;letter-spacing:.075em}
  .tr-performanceMetric>strong{font-size:11.8px}
  .tr-performanceMetric>small{display:none}
  .tr-performanceMetricDivider{height:12px}
  .tr-performanceDormantRail{display:none}

  .tr-performanceHudSurface.is-active,
  .tr-performanceHudSurface.is-paused{
    min-height:82px;
    padding:6px 8px 3px;
    border-radius:11px;
  }
  .tr-performanceActiveMain{
    min-height:48px;
    grid-template-columns:minmax(95px,1fr) auto;
    grid-template-areas:"state timer" "date actions";
    gap:3px 6px;
  }
  .tr-performanceHudSurface.is-active .tr-performanceCoreIcon,
  .tr-performanceHudSurface.is-paused .tr-performanceCoreIcon{width:26px;height:26px}
  .tr-performanceHudSurface.is-active .tr-performanceStateText>span,
  .tr-performanceHudSurface.is-paused .tr-performanceStateText>span{font-size:5.8px}
  .tr-performanceHudSurface.is-active .tr-performanceStateText>strong,
  .tr-performanceHudSurface.is-paused .tr-performanceStateText>strong{font-size:11px}
  .tr-performanceTimerBlock{min-width:0;justify-items:end}
  .tr-performanceTimerBlock::before{width:130px;height:45px;left:58%}
  .tr-performanceTimer{font-size:clamp(22px,6.7vw,25px)}
  .tr-performanceTimerBlock>span{font-size:5.4px}
  .tr-performanceActiveMain>.tr-performanceDate{
    font-size:clamp(8.5px,2.55vw,9.8px);
    white-space:nowrap;
    overflow:visible;
    text-overflow:clip;
  }
  .tr-performanceControl{min-height:28px;padding:0 7px;font-size:6.9px;border-radius:7px;gap:4px}
  .tr-performanceControl>span{font-size:7px}
  .tr-sessionTrajectory{height:24px}
  .tr-sessionTrajectoryCanvas{height:16px}
  .tr-sessionTrajectoryAverage,
  .tr-sessionTrajectoryLearning{font-size:5.6px;letter-spacing:.075em}
}

@media(max-width:390px){
  .tr-performanceHudSurface{padding-left:8px;padding-right:8px}
  .tr-performanceReadyMain{grid-template-columns:minmax(0,1fr) auto}
  .tr-performanceStart{padding:0 8px;font-size:7.2px}
  .tr-performanceReadyFooter{gap:5px}
  .tr-performanceMetric>span{font-size:5px;letter-spacing:.055em}
  .tr-performanceMetric>strong{font-size:11.2px}
  .tr-performanceActiveMain{grid-template-columns:minmax(88px,1fr) auto;gap:3px 5px}
  .tr-performanceStateText>span{display:none}
  .tr-performanceActiveMain>.tr-performanceDate{font-size:8.3px}
  .tr-performanceControl{padding:0 6px;font-size:6.5px}
}


/* =====================================================================
   MVP TRAINER R12.5B.1 — LIVE INSTRUMENT RENDERING POLISH
   Same HUD layout. Adds premium state animation, richer material lighting,
   animated Performance Core, and stronger trajectory/timer rendering.
   ===================================================================== */
.tr-performanceHudSurface{
  background:
    radial-gradient(640px 150px at 50% -40%,rgba(116,224,255,.19),transparent 68%),
    radial-gradient(360px 130px at 7% 108%,rgba(39,145,188,.105),transparent 72%),
    linear-gradient(180deg,rgba(15,29,38,.995),rgba(4,9,13,.999));
  box-shadow:
    0 20px 48px rgba(0,0,0,.42),
    0 0 34px rgba(55,189,235,.045),
    inset 0 1px 0 rgba(244,253,255,.13),
    inset 0 -1px 0 rgba(44,144,183,.085),
    inset 0 0 0 1px rgba(172,232,251,.032);
}
.tr-performanceHudSurface::before{
  background:
    radial-gradient(430px 116px at 48% 18%,rgba(147,234,255,.072),transparent 70%),
    linear-gradient(108deg,transparent 0 31%,rgba(255,255,255,.016) 39%,rgba(217,248,255,.075) 47%,rgba(108,217,250,.022) 52%,transparent 62% 100%),
    repeating-linear-gradient(90deg,rgba(255,255,255,.006) 0 1px,transparent 1px 7px);
  background-size:100% 100%,245% 100%,100% 100%;
  animation:tr-hudGlassSweep 9.6s cubic-bezier(.22,.68,.26,1) infinite;
}
.tr-performanceHudSurface::after{
  background:linear-gradient(90deg,transparent 0 7%,rgba(119,221,253,.24) 26%,rgba(247,254,255,.78) 50%,rgba(119,221,253,.24) 74%,transparent 93% 100%);
  background-size:185% 100%;
  animation:tr-hudEdgeTravel 7.2s ease-in-out infinite;
  box-shadow:0 0 12px rgba(93,213,250,.15);
}
.tr-performanceHudSurface.is-active{
  border-color:rgba(133,230,255,.43);
  background:
    radial-gradient(420px 94px at 42% 7%,rgba(82,215,255,.19),transparent 70%),
    radial-gradient(270px 90px at 7% 30%,rgba(61,238,174,.055),transparent 72%),
    linear-gradient(180deg,rgba(9,23,31,.997),rgba(3,8,11,.999));
  box-shadow:
    0 14px 34px rgba(0,0,0,.39),
    0 0 34px rgba(54,204,248,.055),
    inset 0 1px 0 rgba(242,253,255,.12),
    inset 0 -1px 0 rgba(48,152,190,.07),
    inset 0 0 26px rgba(49,175,219,.028);
}
.tr-performanceHudSurface.is-active::before{
  opacity:1;
  animation:tr-hudGlassSweepActive 6.8s cubic-bezier(.2,.72,.25,1) infinite;
}
.tr-performanceHudSurface.is-paused{
  border-color:rgba(255,194,97,.40);
  background:
    radial-gradient(420px 94px at 42% 7%,rgba(255,182,64,.14),transparent 70%),
    radial-gradient(260px 88px at 7% 30%,rgba(255,205,111,.035),transparent 72%),
    linear-gradient(180deg,rgba(24,18,10,.997),rgba(7,8,8,.999));
  box-shadow:
    0 14px 34px rgba(0,0,0,.39),
    0 0 28px rgba(232,153,50,.045),
    inset 0 1px 0 rgba(255,240,205,.105),
    inset 0 -1px 0 rgba(172,108,30,.07),
    inset 0 0 24px rgba(210,132,35,.024);
}
.tr-performanceHudSurface.is-paused::before{
  opacity:.78;
  animation:tr-hudPausedHold 12s ease-in-out infinite;
}
.tr-performanceHudSurface.is-paused::after{
  background:linear-gradient(90deg,transparent 0 8%,rgba(255,190,93,.20) 28%,rgba(255,236,191,.68) 50%,rgba(255,190,93,.20) 72%,transparent 92% 100%);
  background-size:160% 100%;
  animation:tr-hudEdgeTravelPaused 11s ease-in-out infinite;
  box-shadow:0 0 11px rgba(244,171,71,.12);
}
@keyframes tr-hudGlassSweep{
  0%,14%{background-position:0 0,-138% 0,0 0}
  66%,100%{background-position:0 0,138% 0,0 0}
}
@keyframes tr-hudGlassSweepActive{
  0%,10%{background-position:0 0,-145% 0,0 0}
  62%,100%{background-position:0 0,145% 0,0 0}
}
@keyframes tr-hudPausedHold{
  0%,100%{background-position:0 0,-38% 0,0 0;opacity:.68}
  50%{background-position:0 0,38% 0,0 0;opacity:.82}
}
@keyframes tr-hudEdgeTravel{
  0%,12%{background-position:105% 0;opacity:.54}
  55%{opacity:.92}
  88%,100%{background-position:-5% 0;opacity:.54}
}
@keyframes tr-hudEdgeTravelPaused{
  0%,100%{background-position:82% 0;opacity:.52}
  50%{background-position:18% 0;opacity:.78}
}

.tr-performanceCoreIcon{
  overflow:visible;
  filter:drop-shadow(0 4px 10px rgba(76,198,238,.18));
}
.tr-performanceCoreIcon::before{
  inset:2px;
  background:radial-gradient(circle,rgba(156,237,255,.22) 0 12%,rgba(89,207,244,.095) 30%,rgba(41,132,172,.024) 52%,transparent 72%);
  transform:scale(.88);
}
.tr-performanceCoreIcon svg{
  filter:drop-shadow(0 0 3px rgba(168,237,255,.11));
}
.tr-performanceCoreFrame,
.tr-performanceCorePulse,
.tr-performanceCoreBlade,
.tr-performanceCoreNode{
  transform-box:fill-box;
  transform-origin:center;
}
.tr-performanceCoreIcon.is-ready::before{
  animation:tr-coreReadyAura 5.8s ease-in-out infinite;
}
.tr-performanceCoreIcon.is-ready .tr-performanceCorePulse{
  stroke-dasharray:9 7;
  animation:tr-coreReadyTrace 6.2s linear infinite;
}
.tr-performanceCoreIcon.is-active{
  filter:drop-shadow(0 0 8px rgba(94,239,190,.24)) drop-shadow(0 4px 9px rgba(42,153,193,.14));
}
.tr-performanceCoreIcon.is-active::before{
  background:radial-gradient(circle,rgba(180,255,228,.32) 0 9%,rgba(91,240,185,.15) 28%,rgba(55,197,236,.055) 48%,transparent 73%);
  animation:tr-coreActiveAura 3.15s ease-in-out infinite;
}
.tr-performanceCoreIcon.is-active .tr-performanceCoreFrame{
  stroke:rgba(173,255,226,.88);
  stroke-dasharray:8 3;
  animation:tr-coreFrameTravel 4.4s linear infinite;
}
.tr-performanceCoreIcon.is-active .tr-performanceCorePulse{
  fill:rgba(84,229,179,.16);
  stroke:#adffda;
  stroke-dasharray:10 5;
  animation:tr-corePulseTravel 1.75s linear infinite,tr-corePulseBreath 3.1s ease-in-out infinite;
  filter:drop-shadow(0 0 2.5px rgba(111,250,198,.38));
}
.tr-performanceCoreIcon.is-active .tr-performanceCoreBlade{
  fill:rgba(132,252,210,.29);
  stroke:rgba(189,255,232,.88);
  animation:tr-coreBladeDrive 2.75s cubic-bezier(.3,.1,.25,1) infinite;
}
.tr-performanceCoreIcon.is-active .tr-performanceCoreNode{
  fill:#f8fff9;
  stroke:#8dffca;
  animation:tr-coreNodeCharge 2.15s ease-in-out infinite;
  filter:drop-shadow(0 0 3px rgba(126,255,204,.62));
}
.tr-performanceCoreIcon.is-paused{
  filter:drop-shadow(0 0 7px rgba(255,184,79,.22)) drop-shadow(0 4px 8px rgba(142,90,24,.10));
}
.tr-performanceCoreIcon.is-paused::before{
  background:radial-gradient(circle,rgba(255,220,157,.20) 0 10%,rgba(255,178,62,.10) 30%,transparent 70%);
  animation:tr-corePausedAura 6.8s ease-in-out infinite;
}
.tr-performanceCoreIcon.is-paused .tr-performanceCoreFrame{stroke:rgba(255,213,144,.78)}
.tr-performanceCoreIcon.is-paused .tr-performanceCorePulse{stroke:#ffd393;fill:rgba(255,181,75,.13);animation:none;filter:none}
.tr-performanceCoreIcon.is-paused .tr-performanceCoreBlade{stroke:rgba(255,218,161,.78);fill:rgba(255,190,87,.20);animation:none}
.tr-performanceCoreIcon.is-paused .tr-performanceCoreNode{
  fill:#fff5df;stroke:#ffc873;
  animation:tr-corePausedNode 6.8s ease-in-out infinite;
  filter:drop-shadow(0 0 2px rgba(255,185,76,.34));
}
@keyframes tr-coreReadyAura{0%,100%{transform:scale(.86);opacity:.55}50%{transform:scale(1.03);opacity:.84}}
@keyframes tr-coreReadyTrace{to{stroke-dashoffset:-32}}
@keyframes tr-coreActiveAura{0%,100%{transform:scale(.86);opacity:.60}45%{transform:scale(1.08);opacity:1}70%{transform:scale(.98);opacity:.78}}
@keyframes tr-coreFrameTravel{to{stroke-dashoffset:-44}}
@keyframes tr-corePulseTravel{to{stroke-dashoffset:-30}}
@keyframes tr-corePulseBreath{0%,100%{opacity:.78}50%{opacity:1}}
@keyframes tr-coreBladeDrive{0%,100%{transform:translate3d(0,0,0) rotate(0deg);opacity:.78}45%{transform:translate3d(.35px,-.45px,0) rotate(2deg);opacity:1}72%{transform:translate3d(-.25px,.2px,0) rotate(-1deg);opacity:.88}}
@keyframes tr-coreNodeCharge{0%,100%{transform:scale(.92);opacity:.82}45%{transform:scale(1.28);opacity:1}68%{transform:scale(1.03);opacity:.92}}
@keyframes tr-corePausedAura{0%,100%{transform:scale(.92);opacity:.45}50%{transform:scale(1.01);opacity:.64}}
@keyframes tr-corePausedNode{0%,100%{transform:scale(.96);opacity:.76}50%{transform:scale(1.08);opacity:.90}}

.tr-performanceTimerBlock{overflow:visible}
.tr-performanceTimerBlock::before{
  width:188px;height:64px;
  background:radial-gradient(ellipse,rgba(138,232,255,.17),rgba(77,184,229,.05) 42%,transparent 72%);
  filter:blur(2.5px);
  opacity:.88;
}
.tr-performanceTimerBlock::after{
  content:"";
  position:absolute;
  z-index:1;
  pointer-events:none;
  left:4%;right:4%;top:2px;height:42%;
  opacity:.42;
  background:linear-gradient(104deg,transparent 0 34%,rgba(255,255,255,.14) 45%,rgba(196,245,255,.05) 51%,transparent 61% 100%);
  background-size:235% 100%;
  mix-blend-mode:screen;
  animation:tr-timerSpecular 6.3s ease-in-out infinite;
}
.is-paused .tr-performanceTimerBlock::before{
  background:radial-gradient(ellipse,rgba(255,205,120,.14),rgba(217,139,39,.04) 44%,transparent 72%);
}
.is-paused .tr-performanceTimerBlock::after{animation:none;opacity:.18}
.tr-performanceTimer{
  position:relative;z-index:2;
  color:#fcfeff;
  text-shadow:0 1px 0 rgba(255,255,255,.10),0 6px 15px rgba(0,0,0,.34);
}
.is-paused .tr-performanceTimer{color:#fff2d9;text-shadow:0 1px 0 rgba(255,255,255,.08),0 6px 15px rgba(0,0,0,.34)}
@keyframes tr-timerSpecular{0%,15%{background-position:128% 0;opacity:.18}52%{opacity:.48}76%,100%{background-position:-28% 0;opacity:.18}}

.tr-sessionTrajectory{
  height:28px;
  padding-bottom:1px;
}
.tr-sessionTrajectory::before{
  top:8px;
  background:linear-gradient(90deg,rgba(83,137,158,.055),rgba(141,208,232,.18),rgba(83,137,158,.055));
  box-shadow:0 1px 7px rgba(64,171,213,.035);
}
.tr-sessionTrajectoryCanvas{
  height:19px;
  filter:drop-shadow(0 1px 3px rgba(65,201,244,.13));
}
.tr-sessionTrajectoryAverage,
.tr-sessionTrajectoryLearning{
  bottom:0;
  font-size:7.1px;
  letter-spacing:.085em;
  color:rgba(219,238,244,.78);
  text-shadow:0 1px 0 rgba(0,0,0,.72),0 0 7px rgba(114,201,229,.07);
}
.is-paused .tr-sessionTrajectoryCanvas{filter:drop-shadow(0 1px 3px rgba(239,166,66,.11))}

@media(max-width:720px){
  .tr-performanceHudSurface.is-active,
  .tr-performanceHudSurface.is-paused{
    min-height:80px;
    padding:5px 8px 3px;
  }
  .tr-performanceActiveMain{
    min-height:45px;
    gap:2px 6px;
  }
  .tr-performanceHudSurface.is-active .tr-performanceCoreIcon,
  .tr-performanceHudSurface.is-paused .tr-performanceCoreIcon{width:28px;height:28px}
  .tr-performanceTimerBlock::before{width:146px;height:48px;left:57%}
  .tr-performanceTimerBlock::after{left:0;right:0;height:38%}
  .tr-performanceTimer{font-size:clamp(23px,6.9vw,26px)}
  .tr-performanceActiveMain>.tr-performanceDate{font-size:clamp(8.7px,2.6vw,10px);color:rgba(228,240,244,.82)}
  .tr-sessionTrajectory{height:26px}
  .tr-sessionTrajectoryCanvas{height:18px}
  .tr-sessionTrajectoryAverage,
  .tr-sessionTrajectoryLearning{font-size:6.25px;letter-spacing:.07em}
}

@media(max-width:390px){
  .tr-performanceHudSurface.is-active,
  .tr-performanceHudSurface.is-paused{min-height:79px}
  .tr-performanceHudSurface.is-active .tr-performanceCoreIcon,
  .tr-performanceHudSurface.is-paused .tr-performanceCoreIcon{width:27px;height:27px}
  .tr-performanceTimer{font-size:clamp(22.5px,6.8vw,25px)}
  .tr-sessionTrajectoryAverage,
  .tr-sessionTrajectoryLearning{font-size:6px}
}


/* =====================================================================
   MVP TRAINER R12.5B.2 — BRANDED PRECISION HUD / CORE STATEMENT PASS
   Layout is still compact. Timer is mathematically centered, date aligned,
   controls raised/spaced, typography sharpened, AVG benchmark brighter,
   and the Performance Core now animates internally with MVP brand color.
   ===================================================================== */
.tr-performanceHudSurface{
  --mvp-blue:#32bff3;
  --mvp-blue-deep:#137fb0;
  --mvp-orange:#ff9b39;
  --mvp-active:#66f2ad;
  --mvp-ice:#eafaff;
  --mvp-gold:#ffc66f;
}
.tr-performanceHudSurface.is-active{
  border-color:rgba(91,222,255,.47);
  background:
    radial-gradient(430px 110px at 50% -5%,rgba(48,186,241,.22),transparent 69%),
    radial-gradient(240px 90px at 6% 34%,rgba(84,242,174,.095),transparent 74%),
    radial-gradient(190px 70px at 93% 12%,rgba(255,151,55,.030),transparent 76%),
    linear-gradient(180deg,rgba(8,23,31,.998),rgba(3,8,11,.999));
  box-shadow:
    0 15px 38px rgba(0,0,0,.42),
    0 0 36px rgba(45,187,239,.075),
    0 0 24px rgba(81,239,170,.035),
    inset 0 1px 0 rgba(245,254,255,.15),
    inset 0 -1px 0 rgba(45,143,181,.085),
    inset 0 0 30px rgba(42,170,216,.035);
}
.tr-performanceHudSurface.is-active::before{
  opacity:1;
  background:
    radial-gradient(460px 120px at 50% 18%,rgba(130,232,255,.10),transparent 72%),
    linear-gradient(106deg,transparent 0 28%,rgba(255,255,255,.016) 35%,rgba(185,244,255,.115) 45%,rgba(87,222,255,.025) 51%,transparent 62% 100%),
    repeating-linear-gradient(90deg,rgba(255,255,255,.006) 0 1px,transparent 1px 7px);
  background-size:100% 100%,260% 100%,100% 100%;
  animation:tr-b2ActiveGlass 6.5s cubic-bezier(.2,.72,.24,1) infinite;
}
.tr-performanceHudSurface.is-active::after{
  background:linear-gradient(90deg,transparent 0 4%,rgba(42,191,242,.25) 22%,rgba(223,250,255,.82) 48%,rgba(91,244,181,.24) 70%,rgba(255,151,55,.08) 86%,transparent 96% 100%);
  background-size:210% 100%;
  box-shadow:0 0 13px rgba(64,207,247,.19);
  animation:tr-b2EdgeCurrent 6.9s ease-in-out infinite;
}
.tr-performanceHudSurface.is-paused{
  border-color:rgba(255,170,66,.43);
  background:
    radial-gradient(420px 105px at 50% -5%,rgba(51,157,213,.11),transparent 69%),
    radial-gradient(250px 92px at 7% 33%,rgba(255,154,49,.15),transparent 73%),
    linear-gradient(180deg,rgba(23,18,11,.998),rgba(6,8,9,.999));
  box-shadow:
    0 15px 38px rgba(0,0,0,.42),
    0 0 30px rgba(240,151,48,.055),
    inset 0 1px 0 rgba(255,243,215,.12),
    inset 0 -1px 0 rgba(165,101,27,.08);
}
@keyframes tr-b2ActiveGlass{
  0%,10%{background-position:0 0,-145% 0,0 0}
  56%{background-position:0 0,18% 0,0 0}
  88%,100%{background-position:0 0,145% 0,0 0}
}
@keyframes tr-b2EdgeCurrent{
  0%,12%{background-position:108% 0;opacity:.52}
  48%{opacity:.96}
  88%,100%{background-position:-8% 0;opacity:.56}
}

/* True-centered active/paused geometry. */
.tr-performanceActiveMain{
  position:relative;
  display:block;
  min-height:48px;
  width:100%;
}
.tr-performanceActiveMain>.tr-performanceStateBlock{
  position:absolute;
  left:0;
  top:5px;
  z-index:4;
}
.tr-performanceActiveMain>.tr-performanceTimerBlock{
  position:absolute;
  left:50%;
  top:0;
  z-index:5;
  min-width:150px;
  transform:translateX(-50%);
  justify-items:center;
}
.tr-performanceActiveMain>.tr-performanceDate{
  position:absolute;
  left:50%;
  top:34px;
  z-index:4;
  width:max-content;
  max-width:42%;
  transform:translateX(-50%);
  text-align:center;
  white-space:nowrap;
  overflow:visible;
  text-overflow:clip;
  color:rgba(231,243,248,.88);
  font-size:10.6px;
  font-weight:690;
  letter-spacing:.006em;
  text-shadow:0 1px 0 rgba(0,0,0,.72);
}
.tr-performanceActiveMain>.tr-performanceActions{
  position:absolute;
  right:0;
  top:4px;
  z-index:6;
  display:flex;
  align-items:center;
  justify-content:flex-end;
  gap:12px;
}

/* Timer + technical label. */
.tr-performanceTimerBlock{gap:2px;overflow:visible}
.tr-performanceTimerBlock::before{
  width:210px;
  height:68px;
  left:50%;
  top:47%;
  opacity:.96;
  background:radial-gradient(ellipse,rgba(113,226,255,.20),rgba(50,166,216,.055) 43%,transparent 72%);
  filter:blur(2.3px);
}
.is-active .tr-performanceTimerBlock::before{
  background:radial-gradient(ellipse,rgba(121,231,255,.22),rgba(67,217,165,.045) 42%,rgba(36,143,196,.035) 56%,transparent 74%);
}
.is-paused .tr-performanceTimerBlock::before{
  background:radial-gradient(ellipse,rgba(255,205,122,.18),rgba(218,139,39,.045) 44%,transparent 74%);
}
.tr-performanceTimer{
  font-family:"Segoe UI Variable Display","SF Pro Display",Inter,"Segoe UI",system-ui,sans-serif;
  font-size:30px;
  line-height:.94;
  font-weight:785;
  font-variation-settings:"wght" 785;
  letter-spacing:.018em;
  color:#ffffff;
  text-shadow:0 1px 0 rgba(255,255,255,.12),0 7px 18px rgba(0,0,0,.42);
}
.tr-performanceTimerBlock>span{
  color:rgba(225,245,252,.90);
  font-family:"Segoe UI Variable Text","SF Pro Text",Inter,"Segoe UI",system-ui,sans-serif;
  font-size:7.4px;
  line-height:1;
  font-weight:780;
  letter-spacing:.115em;
  text-shadow:0 1px 0 rgba(0,0,0,.72);
}
.is-paused .tr-performanceTimerBlock>span{color:rgba(255,231,190,.91)}

/* Modern precision controls, no dated pill typography. */
.tr-performanceControl{
  min-height:31px;
  min-width:63px;
  padding:0 11px;
  border-radius:8px;
  font-family:"Segoe UI Variable Display","SF Pro Display",Inter,"Segoe UI",system-ui,sans-serif;
  font-size:8.6px;
  font-weight:760;
  font-variation-settings:"wght" 760;
  letter-spacing:.055em;
  line-height:1;
  border:1px solid rgba(119,212,242,.28);
  background:linear-gradient(180deg,rgba(21,43,54,.77),rgba(5,13,18,.91));
  box-shadow:inset 0 1px 0 rgba(244,253,255,.09),0 6px 16px rgba(0,0,0,.25),0 0 0 1px rgba(0,0,0,.10);
}
.tr-performanceControl>span{
  font-family:"Segoe UI Symbol","Apple Symbols",system-ui,sans-serif;
  font-size:9px;
  font-weight:700;
  opacity:.92;
}
.tr-performanceControl.is-primary{
  border-color:rgba(63,195,242,.44);
  color:#e7faff;
  box-shadow:inset 0 1px 0 rgba(244,253,255,.10),0 6px 16px rgba(0,0,0,.25),0 0 14px rgba(45,190,239,.045);
}
.tr-performanceControl.is-pause{border-color:rgba(88,236,175,.38);color:#dcffed}
.tr-performanceControl.is-resume{border-color:rgba(84,236,170,.48);color:#d8ffea;background:linear-gradient(180deg,rgba(22,63,49,.68),rgba(6,24,18,.90))}
.tr-performanceControl.is-end{border-color:rgba(237,102,108,.25);color:#ffc9cc;background:linear-gradient(180deg,rgba(56,25,28,.55),rgba(19,8,10,.84))}

/* Branded statement Core: static shell + internal energy only. */
.tr-performanceCoreIcon{
  width:38px!important;
  height:38px!important;
  color:var(--mvp-blue);
  filter:drop-shadow(0 5px 12px rgba(24,148,203,.24));
}
.tr-performanceCoreIcon::before{
  inset:-1px;
  transform:none;
  background:radial-gradient(circle,rgba(71,194,240,.23) 0 16%,rgba(35,137,187,.085) 38%,transparent 72%);
}
.tr-performanceCoreIcon svg{filter:drop-shadow(0 1px 2px rgba(0,0,0,.34)) drop-shadow(0 0 4px rgba(55,184,231,.16))}
.tr-performanceCoreFrame{
  fill:rgba(8,27,38,.74);
  stroke:rgba(76,196,239,.92);
  stroke-width:1.45;
  stroke-dasharray:none!important;
  animation:none!important;
  filter:drop-shadow(0 0 2px rgba(46,185,237,.20));
}
.tr-performanceCorePulse{
  fill:rgba(31,152,204,.16);
  stroke:rgba(172,237,255,.92);
  stroke-width:1.15;
  stroke-linejoin:round;
  stroke-dasharray:none!important;
  animation:none;
  transform-origin:24px 24px;
}
.tr-performanceCoreBlade{
  fill:rgba(37,153,205,.18);
  stroke:rgba(93,205,243,.68);
  stroke-width:1;
  stroke-linejoin:round;
  transform-origin:24px 24px;
  animation:none;
}
.tr-performanceCoreRing{
  fill:none;
  stroke:rgba(255,154,55,.72);
  stroke-width:.95;
  opacity:.72;
  transform-origin:24px 24px;
}
.tr-performanceCoreNode{
  fill:#f4fdff;
  stroke:#ff9b39;
  stroke-width:1.15;
  transform-origin:24px 24px;
}
.tr-performanceCoreIcon.is-ready::before{animation:tr-b2CoreReadyAura 5.6s ease-in-out infinite}
.tr-performanceCoreIcon.is-ready .tr-performanceCorePulse{animation:tr-b2CoreReadyPulse 5.4s ease-in-out infinite}
.tr-performanceCoreIcon.is-ready .tr-performanceCoreRing{animation:tr-b2CoreReadyRing 6.2s ease-in-out infinite}

.tr-performanceCoreIcon.is-active{
  filter:drop-shadow(0 0 10px rgba(83,242,174,.32)) drop-shadow(0 5px 12px rgba(27,151,207,.19));
}
.tr-performanceCoreIcon.is-active::before{
  background:radial-gradient(circle,rgba(118,255,204,.34) 0 13%,rgba(80,239,177,.17) 32%,rgba(42,184,229,.075) 52%,transparent 75%);
  animation:tr-b2CoreActiveAura 3.1s ease-in-out infinite;
}
.tr-performanceCoreIcon.is-active .tr-performanceCoreFrame{
  stroke:rgba(68,196,240,.96);
  fill:rgba(6,29,39,.82);
}
.tr-performanceCoreIcon.is-active .tr-performanceCorePulse{
  fill:rgba(91,241,181,.20);
  stroke:#c2ffe5;
  filter:drop-shadow(0 0 3px rgba(83,242,174,.48));
  animation:tr-b2CoreInternalPulse 2.8s ease-in-out infinite;
}
.tr-performanceCoreIcon.is-active .tr-performanceCoreBlade{
  fill:rgba(80,229,177,.22);
  stroke:rgba(166,255,223,.86);
  filter:drop-shadow(0 0 2px rgba(83,242,174,.22));
}
.tr-performanceCoreIcon.is-active .tr-performanceCoreBladeA{animation:tr-b2CoreSegmentA 3.2s ease-in-out infinite}
.tr-performanceCoreIcon.is-active .tr-performanceCoreBladeB{animation:tr-b2CoreSegmentB 3.2s ease-in-out infinite}
.tr-performanceCoreIcon.is-active .tr-performanceCoreBladeC{animation:tr-b2CoreSegmentC 3.2s ease-in-out infinite}
.tr-performanceCoreIcon.is-active .tr-performanceCoreRing{
  stroke:rgba(255,155,56,.92);
  opacity:.86;
  animation:tr-b2CoreRingCharge 3.8s ease-in-out infinite;
  filter:drop-shadow(0 0 2px rgba(255,155,56,.20));
}
.tr-performanceCoreIcon.is-active .tr-performanceCoreNode{
  fill:#f8fff9;
  stroke:#68f2ad;
  filter:drop-shadow(0 0 4px rgba(92,246,181,.68));
  animation:tr-b2CoreNode 2.2s ease-in-out infinite;
}

.tr-performanceCoreIcon.is-paused{
  filter:drop-shadow(0 0 9px rgba(255,158,52,.27)) drop-shadow(0 5px 10px rgba(39,127,170,.10));
}
.tr-performanceCoreIcon.is-paused::before{
  background:radial-gradient(circle,rgba(255,195,101,.24) 0 15%,rgba(255,147,40,.11) 35%,rgba(36,143,196,.035) 56%,transparent 75%);
  animation:tr-b2CorePausedAura 6.4s ease-in-out infinite;
}
.tr-performanceCoreIcon.is-paused .tr-performanceCoreFrame{stroke:rgba(52,174,221,.78);fill:rgba(18,24,27,.82)}
.tr-performanceCoreIcon.is-paused .tr-performanceCorePulse{stroke:#ffd59c;fill:rgba(255,160,56,.18);animation:none;filter:none}
.tr-performanceCoreIcon.is-paused .tr-performanceCoreBlade{stroke:rgba(255,200,126,.75);fill:rgba(255,154,54,.16);animation:none;filter:none}
.tr-performanceCoreIcon.is-paused .tr-performanceCoreRing{stroke:#ff9b39;opacity:.90;animation:none}
.tr-performanceCoreIcon.is-paused .tr-performanceCoreNode{fill:#fff3dd;stroke:#ff9b39;animation:tr-b2CorePausedNode 6.4s ease-in-out infinite;filter:drop-shadow(0 0 3px rgba(255,155,57,.34))}

@keyframes tr-b2CoreReadyAura{0%,100%{opacity:.52;transform:scale(.94)}50%{opacity:.78;transform:scale(1.02)}}
@keyframes tr-b2CoreReadyPulse{0%,100%{opacity:.72;filter:brightness(.96)}50%{opacity:.94;filter:brightness(1.12)}}
@keyframes tr-b2CoreReadyRing{0%,100%{opacity:.52}50%{opacity:.82}}
@keyframes tr-b2CoreActiveAura{0%,100%{opacity:.67;transform:scale(.94)}50%{opacity:1;transform:scale(1.06)}}
@keyframes tr-b2CoreInternalPulse{0%,100%{opacity:.74;transform:scale(.98)}46%{opacity:1;transform:scale(1.035)}70%{opacity:.86;transform:scale(1)}}
@keyframes tr-b2CoreSegmentA{0%,16%,100%{opacity:.50;filter:brightness(.90)}28%,46%{opacity:1;filter:brightness(1.35)}}
@keyframes tr-b2CoreSegmentB{0%,34%,100%{opacity:.50;filter:brightness(.90)}46%,64%{opacity:1;filter:brightness(1.35)}}
@keyframes tr-b2CoreSegmentC{0%,52%,100%{opacity:.50;filter:brightness(.90)}64%,82%{opacity:1;filter:brightness(1.35)}}
@keyframes tr-b2CoreRingCharge{0%,100%{opacity:.54;filter:brightness(.90)}48%{opacity:.96;filter:brightness(1.18)}}
@keyframes tr-b2CoreNode{0%,100%{transform:scale(.90);opacity:.86}48%{transform:scale(1.22);opacity:1}68%{transform:scale(1.02);opacity:.94}}
@keyframes tr-b2CorePausedAura{0%,100%{opacity:.46;transform:scale(.96)}50%{opacity:.63;transform:scale(1.01)}}
@keyframes tr-b2CorePausedNode{0%,100%{transform:scale(.96);opacity:.80}50%{transform:scale(1.08);opacity:.92}}

/* State branding. */
.tr-performanceHudSurface.is-active .tr-performanceStateText>strong{color:#72f0b1;text-shadow:0 0 10px rgba(83,242,174,.18)}
.tr-performanceHudSurface.is-paused .tr-performanceStateText>strong{color:#ffb45c;text-shadow:0 0 9px rgba(255,155,57,.13)}
.tr-performanceStateText>span{color:rgba(179,218,232,.70)!important}

/* Brighter benchmark directly below its marker. */
.tr-sessionTrajectoryAverage{
  color:#ffd083!important;
  font-size:7.4px!important;
  font-weight:820!important;
  letter-spacing:.075em!important;
  text-shadow:0 1px 0 rgba(0,0,0,.85),0 0 8px rgba(255,169,63,.16)!important;
}
.tr-sessionTrajectoryLearning{color:rgba(221,238,244,.72)}
.is-paused .tr-sessionTrajectoryAverage{color:#ffbd69!important;text-shadow:0 1px 0 rgba(0,0,0,.85),0 0 8px rgba(255,155,57,.13)!important}
.tr-sessionTrajectoryCanvas{filter:drop-shadow(0 1px 3px rgba(54,199,244,.17)) drop-shadow(0 0 4px rgba(79,235,176,.035))}
.is-paused .tr-sessionTrajectoryCanvas{filter:drop-shadow(0 1px 3px rgba(241,157,54,.15))}

@media(max-width:720px){
  .tr-performanceHudSurface.is-active,
  .tr-performanceHudSurface.is-paused{
    min-height:84px;
    padding:5px 8px 4px;
  }
  .tr-performanceActiveMain{min-height:51px}
  .tr-performanceActiveMain>.tr-performanceStateBlock{top:4px;left:0}
  .tr-performanceActiveMain>.tr-performanceTimerBlock{
    left:50%;
    top:0;
    min-width:132px;
    transform:translateX(-50%);
    justify-items:center;
  }
  .tr-performanceActiveMain>.tr-performanceDate{
    left:50%;
    top:34px;
    max-width:56%;
    transform:translateX(-50%);
    font-size:clamp(8.8px,2.55vw,10px);
    text-align:center;
  }
  .tr-performanceActiveMain>.tr-performanceActions{
    right:0;
    top:4px;
    gap:9px;
  }
  .tr-performanceHudSurface.is-active .tr-performanceCoreIcon,
  .tr-performanceHudSurface.is-paused .tr-performanceCoreIcon{width:34px!important;height:34px!important}
  .tr-performanceHudSurface.is-active .tr-performanceStateText>span,
  .tr-performanceHudSurface.is-paused .tr-performanceStateText>span{font-size:5.7px;letter-spacing:.12em}
  .tr-performanceHudSurface.is-active .tr-performanceStateText>strong,
  .tr-performanceHudSurface.is-paused .tr-performanceStateText>strong{font-size:11.7px;letter-spacing:.065em}
  .tr-performanceTimer{font-size:clamp(24px,7vw,27px)}
  .tr-performanceTimerBlock>span{font-size:6.6px;letter-spacing:.10em}
  .tr-performanceTimerBlock::before{width:150px;height:50px;left:50%;top:48%}
  .tr-performanceControl{
    min-width:50px;
    min-height:30px;
    padding:0 8px;
    font-size:7.5px;
    letter-spacing:.04em;
    gap:4px;
  }
  .tr-performanceControl>span{font-size:8px}
  .tr-sessionTrajectory{height:27px}
  .tr-sessionTrajectoryCanvas{height:18px}
  .tr-sessionTrajectoryAverage{font-size:6.6px!important;letter-spacing:.055em!important}
}

@media(max-width:430px){
  .tr-performanceHudSurface.is-active,
  .tr-performanceHudSurface.is-paused{padding-left:7px;padding-right:7px}
  .tr-performanceActiveMain>.tr-performanceStateBlock{transform:scale(.94);transform-origin:left center}
  .tr-performanceActiveMain>.tr-performanceActions{gap:7px}
  .tr-performanceControl{min-width:47px;padding:0 6px;font-size:7px}
  .tr-performanceActiveMain>.tr-performanceDate{top:34px;font-size:8.7px;max-width:54%}
}

@media(max-width:380px){
  .tr-performanceActiveMain>.tr-performanceStateBlock{transform:scale(.90);transform-origin:left center}
  .tr-performanceHudSurface.is-active .tr-performanceCoreIcon,
  .tr-performanceHudSurface.is-paused .tr-performanceCoreIcon{width:32px!important;height:32px!important}
  .tr-performanceTimer{font-size:23.5px}
  .tr-performanceActiveMain>.tr-performanceActions{gap:5px}
  .tr-performanceControl{min-width:44px;padding:0 5px;font-size:6.6px}
  .tr-performanceControl>span{font-size:7px}
  .tr-performanceActiveMain>.tr-performanceDate{font-size:8.2px;max-width:50%}
  .tr-sessionTrajectoryAverage{font-size:6.2px!important}
}

@media(prefers-reduced-motion:reduce){
  .tr-performanceHudSurface::before,
  .tr-performanceHudSurface::after,
  .tr-performanceTimerBlock::after,
  .tr-performanceCoreIcon::before,
  .tr-performanceCoreFrame,
  .tr-performanceCorePulse,
  .tr-performanceCoreBlade,
  .tr-performanceCoreRing,
  .tr-performanceCoreNode{animation:none!important}
}

`;



function temperatureToneClass(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return "is-neutral";
  const temp = Number(value);
  if (temp < 32) return "is-freezing";
  if (temp < 50) return "is-cold";
  if (temp < 60) return "is-cool";
  if (temp < 70) return "is-mild";
  if (temp < 80) return "is-comfortable";
  if (temp < 90) return "is-warm";
  return "is-hot";
}

function HeaderWeatherIcon({
  kind,
  isDay,
}: {
  kind: WeatherIconKind;
  isDay: boolean;
}) {
  const cloud = (
    <path
      d="M7.2 18.2h9.8a4 4 0 0 0 .35-7.98A5.4 5.4 0 0 0 7.1 8.65 4.8 4.8 0 0 0 7.2 18.2Z"
      fill="#BAC7D1"
      stroke="#F1F6F9"
    />
  );

  if (kind === "clear") {
    return isDay ? (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4.2" fill="#FFD24D" stroke="#FFE78A" />
        <path className="wx-sunRay" d="M12 2.2v2.1M12 19.7v2.1M2.2 12h2.1M19.7 12h2.1M5.1 5.1l1.5 1.5M17.4 17.4l1.5 1.5M18.9 5.1l-1.5 1.5M6.6 17.4l-1.5 1.5" />
      </svg>
    ) : (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M18.8 15.5A7.8 7.8 0 0 1 8.5 5.2 7.9 7.9 0 1 0 18.8 15.5Z" fill="#9EC7FF" stroke="#D9E9FF" />
      </svg>
    );
  }

  if (kind === "partly_cloudy") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {isDay ? (
          <circle cx="8" cy="8" r="3" fill="#FFD24D" stroke="#FFE78A" />
        ) : (
          <path d="M10.2 9.6A4.4 4.4 0 0 1 6.4 4a4.7 4.7 0 0 0 3.8 7.4" fill="#9EC7FF" stroke="#D9E9FF" />
        )}
        {cloud}
      </svg>
    );
  }

  if (kind === "fog") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {cloud}
        <path d="M5 20.5h14M7 23h10" stroke="#AEBCC5" />
      </svg>
    );
  }

  if (kind === "drizzle" || kind === "rain") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {cloud}
        <path
          d={kind === "drizzle" ? "M8 20.5l-.5 1M12 20.5l-.5 1M16 20.5l-.5 1" : "M8.5 20l-1 2M12.5 20l-1 2M16.5 20l-1 2"}
          stroke="#4DB8FF"
        />
      </svg>
    );
  }

  if (kind === "snow") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {cloud}
        <path d="M8 20.5v2M7 21.5h2M12 20.5v2M11 21.5h2M16 20.5v2M15 21.5h2" stroke="#BFEAFF" />
      </svg>
    );
  }

  if (kind === "storm") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {cloud}
        <path d="m13.3 18.2-3 4.2h2.6l-1 3.1 4-5.2h-2.7l.1-2.1Z" fill="#FFD24D" stroke="#FFE78A" />
        <path d="M7.2 20.2 6.5 22M17.5 20.1 16.7 22" stroke="#4DB8FF" />
      </svg>
    );
  }

  return <svg viewBox="0 0 24 24" aria-hidden="true">{cloud}</svg>;
}

const APP_HEADER_CSS = `
.tr-appHeader{
  position:relative;
  z-index:1400;
  display:grid;
  grid-template-columns:minmax(0,1fr) minmax(360px,500px) minmax(0,1fr);
  align-items:center;
  gap:14px;
  min-height:72px;
  margin:0 0 12px;
  overflow:visible;
}
.tr-appHeaderWeather{
  --wx-accent:rgba(45,210,255,.16);
  justify-self:start;
  width:min(100%,350px);
  min-width:0;
  min-height:62px;
  padding:8px 14px 9px;
  box-sizing:border-box;
  display:grid;
  align-content:center;
  justify-items:stretch;
  gap:6px;
  border:1px solid rgba(89,211,247,.38);
  border-radius:16px;
  background:
    radial-gradient(260px 108px at 4% -16%,var(--wx-accent),transparent 68%),
    linear-gradient(145deg,rgba(7,31,42,.995),rgba(2,10,15,.995) 58%,rgba(7,18,25,.995));
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.075),
    inset 0 -1px 0 rgba(0,0,0,.48),
    0 10px 28px rgba(0,0,0,.36),
    0 0 18px rgba(31,180,228,.07);
  color:#f4fbfe;
  text-align:center;
  cursor:pointer;
  overflow:hidden;
}
.tr-appHeaderWeather[data-weather-kind="clear"]{--wx-accent:rgba(255,188,49,.18)}
.tr-appHeaderWeather[data-weather-kind="partly_cloudy"]{--wx-accent:rgba(255,206,90,.13)}
.tr-appHeaderWeather[data-weather-kind="cloudy"],
.tr-appHeaderWeather[data-weather-kind="fog"]{--wx-accent:rgba(180,203,218,.11)}
.tr-appHeaderWeather[data-weather-kind="drizzle"],
.tr-appHeaderWeather[data-weather-kind="rain"]{--wx-accent:rgba(60,167,255,.16)}
.tr-appHeaderWeather[data-weather-kind="storm"]{--wx-accent:rgba(126,114,255,.16)}
.tr-appHeaderWeather[data-weather-kind="snow"]{--wx-accent:rgba(183,232,255,.16)}
.tr-appHeaderWeather[data-temp-tone="hot"]{border-color:rgba(255,121,77,.34)}
.tr-appHeaderWeather[data-temp-tone="freezing"]{border-color:rgba(147,222,255,.42)}
.tr-appHeaderWeather:hover,
.tr-appHeaderWeather:focus-visible{
  border-color:rgba(110,225,255,.62);
  outline:none;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.09),
    0 12px 30px rgba(0,0,0,.40),
    0 0 22px rgba(42,201,246,.12);
}
.tr-appHeaderWeatherMain{
  width:100%;
  min-width:0;
  display:grid;
  grid-template-columns:34px max-content minmax(0,1fr);
  align-items:center;
  justify-content:center;
  column-gap:10px;
  white-space:nowrap;
}
.tr-appHeaderWeatherIcon{
  width:34px;
  height:34px;
  display:grid;
  place-items:center;
  filter:drop-shadow(0 2px 8px rgba(0,0,0,.52));
}
.tr-appHeaderWeatherIcon svg{
  width:32px;
  height:32px;
  overflow:visible;
  fill:none;
  stroke-width:1.8;
  stroke-linecap:round;
  stroke-linejoin:round;
}
.tr-appHeaderWeatherIcon .wx-sunRay{stroke:#FFD24D}
.tr-appHeaderWeatherTemp{
  min-width:0;
  font-size:24px;
  line-height:1;
  font-weight:1100;
  letter-spacing:-.03em;
  font-variant-numeric:tabular-nums lining-nums;
}
.tr-appHeaderWeatherTime{
  min-width:0;
  color:#fff6d5;
  font-size:14.5px;
  line-height:1;
  font-weight:1100;
  letter-spacing:.005em;
  font-variant-numeric:tabular-nums lining-nums;
  text-align:left;
  text-shadow:0 1px 0 rgba(0,0,0,.9),0 0 12px rgba(255,222,121,.20);
}
.tr-appHeaderWeatherDetail{
  width:100%;
  min-width:0;
  display:flex;
  align-items:center;
  justify-content:center;
  gap:4px;
  color:rgba(231,242,248,.90);
  font-size:9.4px;
  line-height:1.12;
  font-weight:950;
  letter-spacing:.015em;
  text-align:center;
}
.tr-appHeaderWeatherDetailPrimary,
.tr-appHeaderWeatherDetailFeels{
  min-width:0;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:4px;
  white-space:nowrap;
}
.tr-appHeaderWeatherDetailPrimary>span{
  min-width:0;
  overflow:hidden;
  text-overflow:ellipsis;
}
.tr-appHeaderWeatherDetail i{
  color:rgba(155,184,198,.62);
  font-style:normal;
  font-weight:900;
}
.tr-appHeaderWeatherDetail b{color:#fff;font-weight:1100}
.tr-appHeaderWeatherTemp.is-hot,.tr-appHeaderWeatherFeels.is-hot{color:#ff7148;text-shadow:0 0 12px rgba(255,86,45,.34)}
.tr-appHeaderWeatherTemp.is-warm,.tr-appHeaderWeatherFeels.is-warm{color:#ffb84d;text-shadow:0 0 10px rgba(255,174,49,.24)}
.tr-appHeaderWeatherTemp.is-comfortable,.tr-appHeaderWeatherFeels.is-comfortable{color:#d9e96a}
.tr-appHeaderWeatherTemp.is-mild,.tr-appHeaderWeatherFeels.is-mild{color:#61dff2}
.tr-appHeaderWeatherTemp.is-cool,.tr-appHeaderWeatherFeels.is-cool{color:#5fbfff}
.tr-appHeaderWeatherTemp.is-cold,.tr-appHeaderWeatherFeels.is-cold{color:#4c8fff}
.tr-appHeaderWeatherTemp.is-freezing,.tr-appHeaderWeatherFeels.is-freezing{color:#d8f3ff;text-shadow:0 0 12px rgba(134,220,255,.34)}
.tr-appHeaderWeatherTemp.is-neutral,.tr-appHeaderWeatherFeels.is-neutral{color:#f4fbfe}
.tr-appHeaderWeatherFeels{font-weight:1100}
.tr-appHeaderWeatherFeelsTop,.tr-appHeaderWeatherTime--mobile{display:none}
.tr-appHeaderBrand{
  justify-self:center;
  width:100%;
  height:70px;
  min-width:0;
  display:grid;
  place-items:center;
  overflow:visible;
  pointer-events:none;
}
.tr-appHeaderBrand img{
  display:block;
  width:min(100%,430px);
  height:auto;
  max-width:430px;
  max-height:100px;
  object-fit:contain;
  object-position:center;
  overflow:visible;
  filter:drop-shadow(0 4px 12px rgba(0,0,0,.58)) drop-shadow(0 0 12px rgba(34,163,255,.15));
  position:relative;
  top:-12px;
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
  width:100%;
  min-width:0;
  display:flex;
  align-items:center;
  justify-content:flex-end;
  gap:7px;
  overflow:visible;
}
.tr-appHeaderWorkout,
.tr-appHeaderMenuButton{
  min-height:39px;
  padding:0 11px;
  border:1px solid rgba(115,191,219,.27);
  border-radius:10px;
  background:linear-gradient(180deg,#0b1b23,#061016);
  color:#fff;
  font-size:9.5px;
  line-height:1;
  font-weight:1000;
  letter-spacing:.035em;
  white-space:nowrap;
  cursor:pointer;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.04),0 6px 18px rgba(0,0,0,.24);
}
.tr-appHeaderWorkout.is-resume{
  border-color:rgba(255,172,48,.58);
  background:linear-gradient(180deg,rgba(86,48,5,.98),rgba(32,18,4,.99));
  color:#ffd18a;
  box-shadow:inset 0 1px 0 rgba(255,240,201,.06),0 0 18px rgba(255,149,32,.13);
}
.tr-appHeaderWorkout.is-return{
  border-color:rgba(64,205,248,.55);
  background:linear-gradient(180deg,rgba(7,57,76,.98),rgba(3,27,38,.99));
  color:#9ce7ff;
  box-shadow:inset 0 1px 0 rgba(217,248,255,.05),0 0 18px rgba(46,190,235,.12);
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
    grid-template-columns:minmax(112px,1fr) minmax(96px,118px) minmax(112px,1fr);
    gap:6px;
    min-height:68px;
    margin-bottom:12px;
  }
  .tr-appHeaderWeather{
    width:100%;
    min-height:66px;
    padding:7px 7px 8px;
    border-radius:13px;
    gap:4px;
  }
  .tr-appHeaderWeatherMain{
    grid-template-columns:26px max-content minmax(0,1fr);
    column-gap:5px;
  }
  .tr-appHeaderWeatherIcon{width:26px;height:26px}
  .tr-appHeaderWeatherIcon svg{width:25px;height:25px}
  .tr-appHeaderWeatherTemp{font-size:19px}
  .tr-appHeaderWeatherTime{font-size:10.4px;letter-spacing:0;text-align:center}
  .tr-appHeaderWeatherDetail{
    gap:3px;
    font-size:7.3px;
    letter-spacing:0;
    flex-wrap:wrap;
    row-gap:1px;
  }
  .tr-appHeaderWeatherDetailPrimary,.tr-appHeaderWeatherDetailFeels{gap:3px}
  .tr-appHeaderBrand{height:62px;min-width:0}
  .tr-appHeaderBrand img{width:100%;max-width:118px;max-height:62px;top:0}
  .tr-appHeaderBrandFallback{font-size:14px;white-space:normal;text-align:center;line-height:1.05}
  .tr-appHeaderActions{gap:5px}
  .tr-appHeaderWorkout,.tr-appHeaderMenuButton{min-height:38px;padding:0 7px;font-size:8px;border-radius:9px}
  .tr-appHeaderWorkout .tr-desktopOnly{display:none}
  .tr-appHeaderWorkout .tr-mobileOnly{display:inline}
  .tr-appHeaderMenuButton--desktop{display:none}
  .tr-appHeaderMenuButton--mobile{display:inline-flex;align-items:center;justify-content:center}
  .tr-appHeaderMenu{width:178px}
}

@media(max-width:430px){
  .tr-appHeader{
    grid-template-columns:minmax(108px,1fr) minmax(92px,112px) minmax(108px,1fr);
    gap:5px;
    min-height:65px;
  }
  .tr-appHeaderWeather{
    min-height:82px;
    padding:7px 6px 8px;
    gap:3px;
    align-content:center;
  }
  .tr-appHeaderWeatherMain{
    grid-template-columns:24px max-content max-content;
    justify-content:center;
    column-gap:5px;
    align-items:center;
  }
  .tr-appHeaderWeatherIcon{width:24px;height:24px}
  .tr-appHeaderWeatherIcon svg{width:23px;height:23px}
  .tr-appHeaderWeatherTemp{
    font-size:18px;
    line-height:.94;
  }
  .tr-appHeaderWeatherTime--desktop{display:none}
  .tr-appHeaderWeatherFeelsTop{
    min-width:0;
    display:inline-flex;
    align-items:baseline;
    justify-content:center;
    gap:2px;
    white-space:nowrap;
    color:rgba(226,237,243,.86);
    font-size:5.4px;
    line-height:1;
    font-weight:1000;
    letter-spacing:.01em;
  }
  .tr-appHeaderWeatherFeelsTop b{
    font-size:6.6px;
    line-height:1;
    font-weight:1100;
  }
  .tr-appHeaderWeatherDetail{
    display:block;
    width:100%;
    min-width:0;
    margin-top:1px;
    font-size:7px;
    line-height:1.05;
  }
  .tr-appHeaderWeatherDetailPrimary{
    width:100%;
    min-width:0;
    display:flex;
    align-items:center;
    justify-content:center;
    gap:3px;
    white-space:nowrap;
    overflow:hidden;
  }
  .tr-appHeaderWeatherDetailPrimary>b{flex:0 0 auto}
  .tr-appHeaderWeatherDetailPrimary>span{
    min-width:0;
    overflow:hidden;
    text-overflow:ellipsis;
    white-space:nowrap;
  }
  .tr-appHeaderWeatherDetailFeels{display:none}
  .tr-appHeaderWeatherTime--mobile{
    display:block;
    width:100%;
    margin-top:6px;
    color:#ffd84d;
    font-size:11.4px;
    line-height:.95;
    font-weight:1100;
    letter-spacing:.035em;
    text-align:center;
    white-space:nowrap;
    -webkit-text-stroke:.18px rgba(255,239,160,.34);
    text-shadow:
      0 2px 0 rgba(0,0,0,.96),
      0 0 8px rgba(255,217,77,.34),
      0 0 15px rgba(255,188,35,.18);
  }
  .tr-appHeaderBrand{height:58px}
  .tr-appHeaderBrand img{max-width:112px;max-height:58px}
  .tr-appHeaderWorkout,.tr-appHeaderMenuButton{min-height:36px;padding:0 6px;font-size:7.5px}
  .tr-appHeaderMenuButton svg{width:12px;height:12px;margin-right:4px}
}

@media(max-width:365px){
  .tr-appHeader{
    grid-template-columns:minmax(104px,1fr) minmax(84px,104px) minmax(104px,1fr);
    gap:4px;
  }
  .tr-appHeaderWeather{min-height:82px;padding-left:5px;padding-right:5px}
  .tr-appHeaderWeatherMain{grid-template-columns:22px max-content max-content;justify-content:center;column-gap:4px}
  .tr-appHeaderWeatherIcon{width:22px;height:22px}
  .tr-appHeaderWeatherIcon svg{width:21px;height:21px}
  .tr-appHeaderWeatherTemp{font-size:17px}
  .tr-appHeaderWeatherFeelsTop{font-size:5px;gap:1.5px}
  .tr-appHeaderWeatherFeelsTop b{font-size:6.1px}
  .tr-appHeaderWeatherDetail{font-size:6.5px}
  .tr-appHeaderWeatherTime--mobile{margin-top:6px;font-size:10.7px}
  .tr-appHeaderBrand img{max-width:104px}
  .tr-appHeaderWorkout,.tr-appHeaderMenuButton{padding:0 5px;font-size:7px}
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
  const [sessionBaseline, setSessionBaseline] = useState<SessionDurationBaseline>({ seconds: null, sampleCount: 0, exactCount: 0 });

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

    // Keep the command center fresh without repeatedly competing with page/data loads.
    // Route changes, focus and visibility still refresh immediately; this is only the
    // background safety poll. The workout timer itself remains local and updates every second.
    const pollMs = hud.mode === "active" ? 30000 : 120000;
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

  const activeTemplateName = hud.mode === "active" ? hud.templateName : null;

  useEffect(() => {
    if (!user?.id || !activeTemplateName) {
      setSessionBaseline({ seconds: null, sampleCount: 0, exactCount: 0 });
      return;
    }

    let cancelled = false;
    void fetchSessionDurationBaseline(String(user.id), activeTemplateName)
      .then((baseline) => {
        if (!cancelled) setSessionBaseline(baseline);
      })
      .catch((error) => {
        console.warn("Could not build MVP session-duration baseline.", error);
        if (!cancelled) setSessionBaseline({ seconds: null, sampleCount: 0, exactCount: 0 });
      });

    return () => { cancelled = true; };
  }, [user?.id, activeTemplateName]);

  const onTogglePause = async () => {
    if (hud.mode !== "active") return;

    const paused = lsGet(LS.isPaused) === "true";

    if (!paused) {
      const musicWasPlaying = isMusicPlaying();
      lsSet(LS.musicWasPlayingOnPause, musicWasPlaying ? "true" : "false");

      if (musicWasPlaying) {
        pauseMusic();
      }

      lsSet(LS.isPaused, "true");
      lsSet(LS.pausedAt, new Date().toISOString());
      setHud({ ...hud, isPaused: true });
      window.dispatchEvent(new Event(WORKOUT_PAUSE_STATE_EVENT));
      return;
    }

    const shouldResumeMusic = lsGet(LS.musicWasPlayingOnPause) === "true";
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
    window.dispatchEvent(new Event(WORKOUT_PAUSE_STATE_EVENT));

    if (shouldResumeMusic) {
      void playMusic().catch((error) => {
        console.warn("Could not resume workout music.", error);
      });
    }
    lsDel(LS.musicWasPlayingOnPause);

    const active = await resolveActiveWorkoutDbFirst();
    if (active?.sessionId) navigate(`/workout/${active.sessionId}`);
  }; /* MVP_TRAINER_V4_5_2_TRUE_PAUSE_CONTINUITY_R4: TRUE PAUSE */

  /* MVP_TRAINER_V4_5_2_TRUE_PAUSE_CONTINUITY_R4: RESUME EVENT */
  useEffect(() => {
    const handleResumeRequest = () => {
      if (hud.mode !== "active") return;
      if (lsGet(LS.isPaused) !== "true") return;
      void onTogglePause();
    };

    window.addEventListener(WORKOUT_RESUME_REQUEST_EVENT, handleResumeRequest);
    return () => {
      window.removeEventListener(WORKOUT_RESUME_REQUEST_EVENT, handleResumeRequest);
    };
  }, [hud]);

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


  const clockParts = fmtClockParts(nowTick);
  const weatherLocation = branding?.weatherLocation ?? null;
  const weatherTimezone = weather?.timezone || weatherLocation?.timezone || "UTC";
  const weatherTime = formatWeatherLocalTime(weatherTimezone, new Date(nowTick));
  const weatherTemp = weather ? `${Math.round(weather.temperatureF)}°` : "--°";
  const weatherCondition = weather?.condition?.toUpperCase() || (weatherLocation ? "LOADING" : "SET WEATHER");
  const weatherFeels = weather ? `${Math.round(weather.apparentTemperatureF)}°` : "--°";
  const weatherCity = weatherLocation?.displayName?.toUpperCase() || "LOCATION";
  const weatherTempTone = temperatureToneClass(weather?.temperatureF);
  const weatherFeelsTone = temperatureToneClass(weather?.apparentTemperatureF);
  const showHeaderWorkoutAction = hud.mode === "active" && !hud.isPaused && !isWorkoutSession;
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
                data-weather-kind={weather?.icon || "cloudy"}
                data-temp-tone={weatherTempTone.replace("is-", "")}
                onClick={() => navigate("/sound-alerts")}
                title="Weather location settings"
                aria-label={`${weatherCondition}, ${weatherTemp}, ${weatherTime}, ${weatherCity}, feels like ${weatherFeels}`}
              >
                <span className="tr-appHeaderWeatherMain">
                  <span className="tr-appHeaderWeatherIcon" aria-hidden="true">
                    <HeaderWeatherIcon kind={weather?.icon || "cloudy"} isDay={weather?.isDay ?? true} />
                  </span>
                  <strong className={`tr-appHeaderWeatherTemp ${weatherTempTone}`}>{weatherTemp}</strong>
                  <span className="tr-appHeaderWeatherTime tr-appHeaderWeatherTime--desktop">{weatherTime}</span>
                  <span className="tr-appHeaderWeatherFeelsTop">
                    <span>FEELS</span>
                    <b className={`tr-appHeaderWeatherFeels ${weatherFeelsTone}`}>{weatherFeels}</b>
                  </span>
                </span>
                <span className="tr-appHeaderWeatherDetail">
                  <span className="tr-appHeaderWeatherDetailPrimary">
                    <b>{weatherCondition}</b>
                    <i aria-hidden="true">·</i>
                    <span>{weatherCity}</span>
                  </span>
                  <span className="tr-appHeaderWeatherDetailFeels">
                    <i aria-hidden="true">·</i>
                    <span>FEELS</span>
                    <b className={`tr-appHeaderWeatherFeels ${weatherFeelsTone}`}>{weatherFeels}</b>
                  </span>
                </span>
                <span className="tr-appHeaderWeatherTime tr-appHeaderWeatherTime--mobile">{weatherTime}</span>
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

        <section className={`tr-performanceHudShell ${hudClass}`} aria-label="MVP training performance HUD">
          <div className={`tr-performanceHudSurface ${hud.mode === "active" ? (hud.isPaused ? "is-paused" : "is-active") : "is-ready"}`}>
            {hud.mode === "active" ? (
              <>
                <div className="tr-performanceActiveMain">
                  <div className="tr-performanceStateBlock">
                    <PerformanceCoreIcon state={hud.isPaused ? "paused" : "active"} />
                    <div className="tr-performanceStateText">
                      <span>PERFORMANCE</span>
                      <strong>{hud.isPaused ? "PAUSED" : "ACTIVE"}</strong>
                    </div>
                  </div>

                  <div className="tr-performanceTimerBlock">
                    <strong className="tr-performanceTimer" aria-label={`${toHHMMSS(timerSeconds)} elapsed session time`}>
                      {toHHMMSS(timerSeconds)}
                    </strong>
                    <span>SESSION TIME</span>
                  </div>

                  <div className="tr-performanceDate" aria-label={`Today is ${clockParts.date}`}>
                    {clockParts.date}
                  </div>

                  <div className="tr-performanceActions">
                    <button
                      type="button"
                      className={`tr-performanceControl is-primary ${hud.isPaused ? "is-resume" : "is-pause"}`}
                      onClick={onTogglePause}
                    >
                      <span aria-hidden>{hud.isPaused ? "▶" : "Ⅱ"}</span>
                      {hud.isPaused ? "RESUME" : "PAUSE"}
                    </button>
                    <button
                      type="button"
                      className="tr-performanceControl is-end"
                      onClick={onEndWorkout}
                      disabled={!endEnabled}
                      title={!endEnabled ? "Confirm today's body weight before ending" : "End workout"}
                    >
                      <span aria-hidden>■</span>
                      END
                    </button>
                  </div>
                </div>

                <SessionTrajectory
                  elapsedSeconds={timerSeconds}
                  averageSeconds={sessionBaseline.seconds}
                  paused={hud.isPaused}
                />
              </>
            ) : (
              <>
                <div className="tr-performanceReadyMain">
                  <div className="tr-performanceStateBlock">
                    <PerformanceCoreIcon state={hud.mode === "inactive" ? "ready" : "offline"} />
                    <div className="tr-performanceStateText">
                      <span>TRAINING STATUS</span>
                      <strong className={hud.mode === "inactive" ? "is-ready" : "is-offline"}>
                        {hud.mode === "inactive" ? "READY" : hud.mode === "no_program" ? "NO PROGRAM" : "SIGN IN"}
                      </strong>
                    </div>
                  </div>

                  <div className="tr-performanceClockBlock">
                    <div className="tr-performanceReadyDate">{clockParts.date}</div>
                    <div className="tr-performanceReadyTime">{clockParts.time}</div>
                  </div>

                  <div className="tr-performanceReadyAction">
                    {hud.mode === "inactive" ? (
                      <button
                        type="button"
                        className="tr-performanceStart"
                        disabled={!hud.nextSessionId}
                        onClick={() => hud.nextSessionId && startSession(hud.nextSessionId)}
                      >
                        <span className="tr-performanceStartMark" aria-hidden>▶</span>
                        <span>START WORKOUT</span>
                      </button>
                    ) : hud.mode === "no_program" ? (
                      <button type="button" className="tr-performanceStart" onClick={() => navigate("/coach")}>
                        <span className="tr-performanceStartMark" aria-hidden>›</span>
                        <span>GO TO COACH</span>
                      </button>
                    ) : null}
                  </div>
                </div>

                {hud.mode === "inactive" ? (
                  <div className="tr-performanceReadyFooter">
                    <div className="tr-performanceMetric">
                      <span>BODY WEIGHT</span>
                      <strong>{hud.displayWeightLb != null ? `${hud.displayWeightLb} lb` : "Not set"}</strong>
                      <small>LAST COMPLETED</small>
                    </div>
                    <span className="tr-performanceMetricDivider" aria-hidden />
                    <div className="tr-performanceMetric">
                      <span>PROTEIN TARGET</span>
                      <strong>{hud.proteinTargetG != null ? `${hud.proteinTargetG} g` : "Not set"}</strong>
                      <small>DAILY TARGET</small>
                    </div>
                    <div className="tr-performanceDormantRail" aria-hidden>
                      <span />
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
