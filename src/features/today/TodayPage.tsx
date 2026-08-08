import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { PlannedSessionEditor } from "./PlannedSessionEditor";
import {
  formatSessionLabel,
  inferSymptomKey,
  isSymptomMode,
  type SymptomKey,
} from "../../lib/sessionLabel";

import icoChest from "../../assets/gym.png";
import icoBack from "../../assets/back (2).png";
import icoShoulders from "../../assets/shoulder.png";
import icoArms from "../../assets/biceps.png";
import icoCore from "../../assets/human.png";
import icoLegs from "../../assets/leg.png";
import icoQuads from "../../assets/front.png";
import icoCalves from "../../assets/muscles.png";

type QueueDash = {
  activeBlock: any | null;
  nextSession: any | null;
  upcoming: any[];
};

type MuscleFocus = {
  key: string;
  label: string;
  icon: string;
  score: number;
};

type SessionMeta = {
  templateId: string | null;
  templateName: string | null;
  exerciseCount: number;
  estimatedMinutes: number | null;
  muscles: MuscleFocus[];
  allMuscleKeys: string[];
};

type HistorySignal = {
  completedAt: string;
  templateId: string | null;
  postDifficulty: string | null;
  maxPain: number;
};

type Readiness = {
  tone: "ready" | "soon" | "recovering" | "monitor";
  label: string;
  detail: string;
  recommendedDate: Date | null;
};

type TemplateRow = {
  id: string;
  name?: string | null;
  estimated_minutes?: number | null;
  focus_tags?: string[] | null;
};

type TemplateExerciseRow = {
  template_id: string;
  exercise_id: string;
  order_index?: number | null;
  sets?: number | null;
  rep_min?: number | null;
  rep_max?: number | null;
  rest_seconds?: number | null;
};

type ExerciseRow = {
  id: string;
  primary_muscles?: string[] | null;
  secondary_muscles?: string[] | null;
};

const DAY_MS = 86_400_000;

const MUSCLE_DEFS: Record<string, { label: string; icon: string }> = {
  chest: { label: "Chest", icon: icoChest },
  back: { label: "Back", icon: icoBack },
  shoulders: { label: "Shoulders", icon: icoShoulders },
  biceps: { label: "Biceps", icon: icoArms },
  triceps: { label: "Triceps", icon: icoArms },
  forearms: { label: "Forearms", icon: icoArms },
  core: { label: "Core", icon: icoCore },
  abs: { label: "Abs", icon: icoCore },
  quads: { label: "Quads", icon: icoQuads },
  hamstrings: { label: "Hamstrings", icon: icoLegs },
  glutes: { label: "Glutes", icon: icoLegs },
  calves: { label: "Calves", icon: icoCalves },
  adductors: { label: "Adductors", icon: icoLegs },
  abductors: { label: "Abductors", icon: icoLegs },
  legs: { label: "Legs", icon: icoLegs },
};

function clean(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function muscleKey(raw: unknown): string | null {
  const value = clean(raw);
  if (!value) return null;

  if (value.includes("bicep")) return "biceps";
  if (value.includes("tricep")) return "triceps";
  if (value.includes("forearm")) return "forearms";
  if (value.includes("shoulder") || value.includes("delt")) return "shoulders";
  if (value.includes("chest") || value.includes("pec") || value.includes("pector")) return "chest";
  if (
    value.includes("lat") ||
    value.includes("back") ||
    value.includes("rhomboid") ||
    value.includes("trap") ||
    value.includes("erector")
  ) {
    return "back";
  }
  if (value.includes("quad")) return "quads";
  if (value.includes("hamstring")) return "hamstrings";
  if (value.includes("glute")) return "glutes";
  if (value.includes("calf") || value.includes("soleus") || value.includes("gastro")) return "calves";
  if (value.includes("adductor")) return "adductors";
  if (value.includes("abductor")) return "abductors";
  if (
    value.includes("abdominal") ||
    value === "abs" ||
    value.includes("rectus abdominis")
  ) {
    return "abs";
  }
  if (value.includes("core") || value.includes("oblique")) return "core";
  if (value.includes("leg")) return "legs";
  return null;
}

function splitLabel(label: string) {
  const normalized = String(label ?? "")
    .replace(/\s+[—–-]\s+/g, " • ")
    .replace(/\s*•\s*/g, " • ")
    .trim();

  const parts = normalized
    .split("•")
    .map((part) => part.trim())
    .filter(Boolean);

  return {
    title: parts[0] || normalized || "Workout",
    subtitle: parts.slice(1).join(" • "),
  };
}

function parseDateOnly(raw: unknown): Date | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const isoDate = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value;
  const date = new Date(isoDate);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sameDay(a: Date, b: Date) {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

function formatTimelineDate(date: Date | null) {
  if (!date) return "DATE NOT SET";
  const today = startOfDay(new Date());
  if (sameDay(date, today)) return "TODAY";
  if (sameDay(date, addDays(today, 1))) return "TOMORROW";

  return date
    .toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    })
    .toUpperCase();
}

function formatEstimatedDuration(minutes: number | null | undefined) {
  if (!minutes || !Number.isFinite(minutes)) return "—";

  const total = Math.max(1, Math.round(minutes));
  if (total < 60) return `~${total} MIN`;

  const hours = Math.floor(total / 60);
  const remainder = total % 60;
  const hourLabel = hours === 1 ? "HR" : "HRS";

  if (!remainder) return `~${hours} ${hourLabel}`;
  return `~${hours} ${hourLabel} ${remainder} MIN`;
}


function startOfDay(date: Date) {
  const out = new Date(date);
  out.setHours(0, 0, 0, 0);
  return out;
}

function addDays(date: Date, days: number) {
  const out = new Date(date);
  out.setDate(out.getDate() + days);
  return out;
}

function daysBetween(later: Date, earlier: Date) {
  return (startOfDay(later).getTime() - startOfDay(earlier).getTime()) / DAY_MS;
}

function normalizeSessionDate(session: any) {
  return parseDateOnly(session?.date ?? session?.scheduled_date ?? session?.planned_date ?? null);
}

function estimateMinutes(rows: TemplateExerciseRow[]) {
  if (!rows.length) return null;

  // Real template-driven estimate:
  // - exercise execution time comes from the programmed rep range
  // - rest comes directly from each exercise's rest_seconds
  // - a small per-set allowance covers logging/load adjustment
  // - transitions account for moving/setup between exercises
  let seconds = 90; // initial setup / getting into the first movement

  rows.forEach((row, index) => {
    const sets = Math.min(10, Math.max(1, Number(row.sets ?? 3)));
    const rest = Math.min(300, Math.max(0, Number(row.rest_seconds ?? 60)));

    const repMin = Math.max(1, Number(row.rep_min ?? 8));
    const repMax = Math.max(repMin, Number(row.rep_max ?? repMin));
    const averageReps = (repMin + repMax) / 2;

    // About 4.5 sec/rep gives a controlled lifting tempo and includes
    // the brief start/finish of the set. Keep unusual rep ranges sane.
    const executionPerSet = Math.min(90, Math.max(25, averageReps * 4.5));
    const setHandling = 12; // log set / change pin or load / reset position

    seconds += sets * (executionPerSet + setHandling);
    seconds += Math.max(0, sets - 1) * rest;

    if (index < rows.length - 1) {
      seconds += 55; // exercise transition / equipment setup
    }
  });

  const rawMinutes = seconds / 60;
  return Math.max(15, Math.ceil(rawMinutes / 5) * 5);
}

function summarizeTemplate(
  templateId: string | null,
  templateMap: Map<string, TemplateRow>,
  templateExercises: Map<string, TemplateExerciseRow[]>,
  exerciseMap: Map<string, ExerciseRow>
): SessionMeta {
  if (!templateId) {
    return {
      templateId: null,
      templateName: null,
      exerciseCount: 0,
      estimatedMinutes: null,
      muscles: [],
      allMuscleKeys: [],
    };
  }

  const template = templateMap.get(templateId);
  const rows = templateExercises.get(templateId) ?? [];
  const scores = new Map<string, number>();

  const add = (raw: unknown, score: number) => {
    const key = muscleKey(raw);
    if (!key) return;
    scores.set(key, (scores.get(key) ?? 0) + score);
  };

  for (const row of rows) {
    const exercise = exerciseMap.get(row.exercise_id);
    for (const muscle of exercise?.primary_muscles ?? []) add(muscle, 1);
    for (const muscle of exercise?.secondary_muscles ?? []) add(muscle, 0.22);
  }

  for (const tag of template?.focus_tags ?? []) add(tag, 0.18);

  const ranked = Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([key, score]) => ({
      key,
      score,
      label: MUSCLE_DEFS[key]?.label ?? key,
      icon: MUSCLE_DEFS[key]?.icon ?? icoLegs,
    }));

  const primaryHigh = ranked.filter((item) => item.score >= 0.85);
  // Show the actual major focus of the workout. Upper sessions can now
  // correctly surface Back + Shoulders + Core or Chest + Biceps + Triceps
  // + Core, while lower sessions can show the complete leg emphasis.
  const display = (primaryHigh.length ? primaryHigh : ranked).slice(0, 5);
  const templateMinutes = Number(template?.estimated_minutes ?? 0);

  return {
    templateId,
    templateName: template?.name ?? null,
    exerciseCount: rows.length,
    // If the template has real exercise rows, always calculate from the
    // current programming so adding/removing exercises or changing sets,
    // reps or rest immediately changes the dashboard estimate after save.
    estimatedMinutes:
      rows.length > 0
        ? estimateMinutes(rows)
        : templateMinutes > 0
          ? templateMinutes
          : null,
    muscles: display,
    allMuscleKeys: ranked.filter((item) => item.score >= 0.65).map((item) => item.key),
  };
}

function readinessForSession(
  session: any,
  meta: SessionMeta,
  history: HistorySignal[],
  metaByTemplate: Map<string, SessionMeta>,
  plannedDateOverride?: Date | null
): Readiness {
  const today = startOfDay(new Date());
  const plannedStart = startOfDay(plannedDateOverride ?? normalizeSessionDate(session) ?? today);
  const targetMuscles = new Set(meta.allMuscleKeys);

  let latestConflict: {
    history: HistorySignal;
    date: Date;
    overlap: number;
    days: number;
  } | null = null;

  for (const item of history) {
    if (!item.templateId || !item.completedAt) continue;
    const completedDate = new Date(item.completedAt);
    if (Number.isNaN(completedDate.getTime())) continue;

    const histMeta = metaByTemplate.get(item.templateId);
    if (!histMeta) continue;

    const overlap = histMeta.allMuscleKeys.filter((key) => targetMuscles.has(key)).length;
    if (!overlap) continue;

    const days = Math.max(0, daysBetween(today, completedDate));
    if (!latestConflict || completedDate.getTime() > latestConflict.date.getTime()) {
      latestConflict = { history: item, date: completedDate, overlap, days };
    }
  }

  let recoveryDays = 0;
  let recoveryTone: Readiness["tone"] = "soon";

  if (latestConflict) {
    const hard = latestConflict.history.postDifficulty === "too_hard";
    const pain = latestConflict.history.maxPain;
    const overlap = latestConflict.overlap;
    const days = latestConflict.days;

    if (pain >= 7 && days < 3) {
      recoveryDays = Math.max(1, 3 - Math.floor(days));
      recoveryTone = "recovering";
    } else if ((pain >= 3 || hard) && overlap >= 2 && days < 2) {
      recoveryDays = Math.max(1, 2 - Math.floor(days));
      recoveryTone = "recovering";
    } else if (overlap >= 2 && days < 1) {
      recoveryDays = 1;
      recoveryTone = "monitor";
    } else if (overlap === 1 && days < 1) {
      recoveryDays = 1;
      recoveryTone = "monitor";
    }
  }

  const recoveryDate = recoveryDays > 0 ? addDays(today, recoveryDays) : today;
  const recommendedDate =
    recoveryDate.getTime() > plannedStart.getTime() ? recoveryDate : plannedStart;
  const shiftedForRecovery = recommendedDate.getTime() > plannedStart.getTime();

  if (shiftedForRecovery) {
    return {
      tone: recoveryTone,
      label: "RECOVERY EXTENDED",
      detail: "",
      recommendedDate,
    };
  }

  // Dates are advisory. If recovery has not pushed the session later,
  // the workout is available now even when its suggested date is later.
  // Upcoming cards therefore show only the suggested date unless a real
  // recovery exception exists.
  return { tone: "ready", label: "READY TO TRAIN", detail: "", recommendedDate };
}

function overlapCount(a: SessionMeta | null | undefined, b: SessionMeta | null | undefined) {
  if (!a || !b) return 0;
  const left = new Set(a.allMuscleKeys);
  return b.allMuscleKeys.filter((key) => left.has(key)).length;
}

function laterDate(a: Date, b: Date | null | undefined) {
  if (!b) return a;
  return b.getTime() > a.getTime() ? b : a;
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M7 3v3M17 3v3M4.5 9h15M6.5 5h11a2 2 0 0 1 2 2v11.5a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
      <path d="M8 13h2M14 13h2M8 17h2M14 17h2" />
    </svg>
  );
}

function ExerciseMetricIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M7 8v8M17 8v8M4.5 10v4M19.5 10v4M7 12h10" />
      <path d="M3 9.5h1.5v5H3zM19.5 9.5H21v5h-1.5z" />
    </svg>
  );
}

function ClockMetricIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3.2 2" />
    </svg>
  );
}

function ScheduleDateBadge({ date }: { date: Date | null }) {
  const label = formatTimelineDate(date);
  const immediate = label === "TODAY" || label === "TOMORROW";

  return (
    <div className={`tr-sessionDate ${immediate ? "is-immediate" : ""}`}>
      <span className="tr-sessionDateIcon">
        <CalendarIcon />
      </span>
      <strong>{label}</strong>
    </div>
  );
}

function MuscleStrip({ muscles, compact = false }: { muscles: MuscleFocus[]; compact?: boolean }) {
  if (!muscles.length) {
    return <div className="tr-scheduleNoMuscles">Muscle focus updates from the workout exercises.</div>;
  }

  return (
    <div className={`tr-scheduleMuscles ${compact ? "is-compact" : ""}`}>
      {muscles.map((muscle) => (
        <div key={muscle.key} className="tr-scheduleMuscle">
          <span className="tr-scheduleMuscleIcon">
            <img src={muscle.icon} alt="" aria-hidden />
          </span>
          <span>{muscle.label}</span>
        </div>
      ))}
    </div>
  );
}

function ReadinessBadge({ readiness, compact = false }: { readiness: Readiness; compact?: boolean }) {
  // Normal schedule = date only. Compact status is reserved for meaningful
  // exceptions such as recovery being extended.
  if (
    readiness.label === "ON SCHEDULE" ||
    (compact && readiness.label === "READY TO TRAIN")
  ) {
    return null;
  }

  return (
    <div
      className={`tr-readinessStatus tr-readinessStatus--${readiness.tone} ${
        compact ? "is-compact" : ""
      }`}
    >
      <span className="tr-readinessAccent" aria-hidden />
      <div className="tr-readinessCopy">
        {!compact ? <span className="tr-readinessLabel">READINESS</span> : null}
        <strong>{readiness.label}</strong>
      </div>
    </div>
  );
}

export function TodayPage() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [qd, setQd] = useState<QueueDash | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSessionType, setActiveSessionType] = useState<string | null>(null);
  const [symptomKey, setSymptomKey] = useState<SymptomKey | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [metaBySession, setMetaBySession] = useState<Map<string, SessionMeta>>(new Map());
  const [metaByTemplate, setMetaByTemplate] = useState<Map<string, SessionMeta>>(new Map());
  const [historySignals, setHistorySignals] = useState<HistorySignal[]>([]);

  async function resolveSessionType(sessionId: string): Promise<string | null> {
    const { data: sess, error } = await supabase
      .from("scheduled_sessions")
      .select("id, session_type")
      .eq("id", sessionId)
      .maybeSingle();

    if (error) return null;
    return (sess as any)?.session_type ?? null;
  }

  async function loadLatestSymptomKeyIfNeeded(goalMode: string | null): Promise<SymptomKey | null> {
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

  async function enrichQueue(userId: string, sessions: any[]) {
    const currentTemplateIds = Array.from(
      new Set(sessions.map((session) => session?.template_id).filter(Boolean))
    ) as string[];

    const { data: completedRows, error: completedError } = await supabase
      .from("workouts")
      .select("id,scheduled_session_id,completed_at,post_difficulty")
      .eq("user_id", userId)
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(12);
    if (completedError) throw completedError;

    const historyWorkouts = (completedRows ?? []) as any[];
    const historySessionIds = Array.from(
      new Set(historyWorkouts.map((row) => row.scheduled_session_id).filter(Boolean))
    ) as string[];

    const historySessionMap = new Map<string, any>();
    if (historySessionIds.length) {
      const { data: historySessions, error: historySessionError } = await supabase
        .from("scheduled_sessions")
        .select("id,template_id")
        .in("id", historySessionIds);
      if (historySessionError) throw historySessionError;
      for (const row of historySessions ?? []) historySessionMap.set((row as any).id, row);
    }

    const historyTemplateIds = Array.from(
      new Set(
        historyWorkouts
          .map((row) => historySessionMap.get(row.scheduled_session_id)?.template_id)
          .filter(Boolean)
      )
    ) as string[];

    const allTemplateIds = Array.from(new Set([...currentTemplateIds, ...historyTemplateIds]));

    const templateMap = new Map<string, TemplateRow>();
    if (allTemplateIds.length) {
      const { data: templateRows, error: templateError } = await supabase
        .from("workout_templates")
        .select("id,name,estimated_minutes,focus_tags")
        .in("id", allTemplateIds);
      if (templateError) throw templateError;
      for (const row of templateRows ?? []) templateMap.set((row as any).id, row as TemplateRow);
    }

    const teMap = new Map<string, TemplateExerciseRow[]>();
    let allTemplateExercises: TemplateExerciseRow[] = [];
    if (allTemplateIds.length) {
      const { data: teRows, error: teError } = await supabase
        .from("template_exercises")
        .select("template_id,exercise_id,order_index,sets,rep_min,rep_max,rest_seconds")
        .in("template_id", allTemplateIds)
        .order("order_index", { ascending: true });
      if (teError) throw teError;
      allTemplateExercises = (teRows ?? []) as TemplateExerciseRow[];
      for (const row of allTemplateExercises) {
        const list = teMap.get(row.template_id) ?? [];
        list.push(row);
        teMap.set(row.template_id, list);
      }
    }

    const exerciseIds = Array.from(
      new Set(allTemplateExercises.map((row) => row.exercise_id).filter(Boolean))
    );
    const exerciseMap = new Map<string, ExerciseRow>();
    if (exerciseIds.length) {
      const { data: exerciseRows, error: exerciseError } = await supabase
        .from("exercises")
        .select("id,primary_muscles,secondary_muscles")
        .in("id", exerciseIds);
      if (exerciseError) throw exerciseError;
      for (const row of exerciseRows ?? []) exerciseMap.set((row as any).id, row as ExerciseRow);
    }

    const nextMetaByTemplate = new Map<string, SessionMeta>();
    for (const templateId of allTemplateIds) {
      nextMetaByTemplate.set(
        templateId,
        summarizeTemplate(templateId, templateMap, teMap, exerciseMap)
      );
    }

    const nextMetaBySession = new Map<string, SessionMeta>();
    for (const session of sessions) {
      if (!session?.id) continue;
      const templateId = (session.template_id as string | null) ?? null;
      nextMetaBySession.set(
        session.id,
        templateId
          ? nextMetaByTemplate.get(templateId) ?? summarizeTemplate(null, templateMap, teMap, exerciseMap)
          : summarizeTemplate(null, templateMap, teMap, exerciseMap)
      );
    }

    const workoutIds = historyWorkouts.map((row) => row.id).filter(Boolean);
    const painByWorkout = new Map<string, number>();
    if (workoutIds.length) {
      const { data: painRows, error: painError } = await supabase
        .from("workout_exercises")
        .select("workout_id,pain")
        .in("workout_id", workoutIds)
        .not("pain", "is", null);
      if (painError) throw painError;
      for (const row of painRows ?? []) {
        const workoutId = (row as any).workout_id as string;
        const pain = Number((row as any).pain ?? 0);
        painByWorkout.set(workoutId, Math.max(painByWorkout.get(workoutId) ?? 0, pain));
      }
    }

    const signals: HistorySignal[] = historyWorkouts
      .map((row) => ({
        completedAt: row.completed_at as string,
        templateId: (historySessionMap.get(row.scheduled_session_id)?.template_id as string | null) ?? null,
        postDifficulty: (row.post_difficulty as string | null) ?? null,
        maxPain: painByWorkout.get(row.id) ?? 0,
      }))
      .filter((row) => !!row.completedAt);

    setMetaBySession(nextMetaBySession);
    setMetaByTemplate(nextMetaByTemplate);
    setHistorySignals(signals);
  }

  async function load() {
    setLoading(true);
    setErr(null);

    try {
      const { data: u, error: uErr } = await supabase.auth.getUser();
      if (uErr) throw uErr;

      if (!u.user) {
        setQd(null);
        setActiveSessionId(null);
        setActiveSessionType(null);
        setSymptomKey(null);
        setMetaBySession(new Map());
        setMetaByTemplate(new Map());
        setHistorySignals([]);
        setErr("Sign in to view workouts.");
        setLoading(false);
        return;
      }

      const { data: w, error: wErr } = await supabase
        .from("workouts")
        .select("id, scheduled_session_id, started_at")
        .eq("user_id", u.user.id)
        .is("completed_at", null)
        .not("started_at", "is", null)
        .order("started_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();

      if (wErr) throw wErr;

      if (w?.scheduled_session_id) {
        setActiveSessionId(w.scheduled_session_id);
        setActiveSessionType(await resolveSessionType(w.scheduled_session_id));
      } else {
        setActiveSessionId(null);
        setActiveSessionType(null);
      }

      const { data: qdata, error: qErr } = await supabase.rpc("rpc_queue_dashboard", {
        p_keep: 8,
      });
      if (qErr) throw qErr;

      const dash = (qdata ?? null) as any;
      const out: QueueDash = {
        activeBlock: dash?.activeBlock ?? null,
        nextSession: dash?.nextSession ?? null,
        upcoming: Array.isArray(dash?.upcoming) ? dash.upcoming : [],
      };
      setQd(out);

      const goalMode = (out.activeBlock?.goal_mode as string) ?? null;
      setSymptomKey(await loadLatestSymptomKeyIfNeeded(goalMode));

      const queueSessions = [out.nextSession, ...out.upcoming].filter(Boolean);
      await enrichQueue(u.user.id, queueSessions);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setQd(null);
      setActiveSessionId(null);
      setActiveSessionType(null);
      setSymptomKey(null);
      setMetaBySession(new Map());
      setMetaByTemplate(new Map());
      setHistorySignals([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const hasActiveProgram = !!qd?.activeBlock?.id;
  const goal = (qd?.activeBlock?.goal as string) ?? null;
  const goalMode = (qd?.activeBlock?.goal_mode as string) ?? null;

  const activeLabel = useMemo(() => {
    if (!activeSessionId) return null;
    return formatSessionLabel({
      sessionType: activeSessionType ?? "Session",
      goal,
      goalMode,
      symptomKey,
    });
  }, [activeSessionId, activeSessionType, goal, goalMode, symptomKey]);

  const nextLabel = useMemo(() => {
    if (!qd?.activeBlock) return "—";
    const st = (qd?.nextSession?.session_type as string) ?? null;
    return qd?.nextSession
      ? formatSessionLabel({ sessionType: st, goal, goalMode, symptomKey })
      : "—";
  }, [qd, goal, goalMode, symptomKey]);

  const nextSessionId = (qd?.nextSession?.id as string | undefined) ?? null;
  const nextMeta = nextSessionId ? metaBySession.get(nextSessionId) ?? null : null;
  const nextLabelParts = splitLabel(nextLabel);

  const upcomingSessions = useMemo(() => {
    const nextId = qd?.nextSession?.id;
    const seen = new Set<string>();
    return (qd?.upcoming ?? [])
      .filter((session: any) => {
        if (!session?.id || session.id === nextId || seen.has(session.id)) return false;
        seen.add(session.id);
        return true;
      })
      .slice(0, 7);
  }, [qd]);

  const scheduleDateBySession = useMemo(() => {
    const result = new Map<string, Date>();
    const sessions = [qd?.nextSession, ...upcomingSessions].filter(Boolean) as any[];
    if (!sessions.length) return result;

    const today = startOfDay(new Date());
    const firstStoredRaw = normalizeSessionDate(sessions[0]);
    const firstStored = firstStoredRaw ? startOfDay(firstStoredRaw) : null;
    const staleSchedule = !firstStored || firstStored.getTime() < today.getTime();

    let previousEffective: Date | null = null;
    let previousPreviousEffective: Date | null = null;
    let previousStored: Date | null = firstStored;

    sessions.forEach((session, index) => {
      const storedRaw = normalizeSessionDate(session);
      const stored = storedRaw ? startOfDay(storedRaw) : null;
      const meta = session?.id ? metaBySession.get(session.id) ?? null : null;
      let effective: Date;

      if (index === 0) {
        effective = staleSchedule ? today : laterDate(today, stored ?? today);
      } else {
        const previousSession = sessions[index - 1];
        const previousMeta = previousSession?.id
          ? metaBySession.get(previousSession.id) ?? null
          : null;

        let storedGap = 1;
        if (stored && previousStored) {
          storedGap = Math.max(1, Math.round(daysBetween(stored, previousStored)));
        }

        const baseFromRotation = addDays(previousEffective ?? today, storedGap);
        effective = staleSchedule
          ? baseFromRotation
          : laterDate(baseFromRotation, stored ?? baseFromRotation);

        const overlap = overlapCount(previousMeta, meta);
        if (overlap >= 2) {
          effective = laterDate(effective, addDays(previousEffective ?? today, 2));
        }

        const trainedYesterday =
          !!previousPreviousEffective &&
          !!previousEffective &&
          Math.round(daysBetween(previousEffective, previousPreviousEffective)) === 1;
        const wouldBeThirdStraightDay =
          !!previousEffective &&
          Math.round(daysBetween(effective, previousEffective)) === 1 &&
          trainedYesterday;

        if (wouldBeThirdStraightDay) {
          effective = addDays(effective, 1);
        }
      }

      const readiness = readinessForSession(
        session,
        meta ?? summarizeTemplate(null, new Map(), new Map(), new Map()),
        historySignals,
        metaByTemplate,
        effective
      );
      effective = laterDate(effective, readiness.recommendedDate);

      if (session?.id) result.set(session.id, effective);
      previousPreviousEffective = previousEffective;
      previousEffective = effective;
      previousStored = stored ?? previousStored;
    });

    return result;
  }, [qd, upcomingSessions, metaBySession, metaByTemplate, historySignals]);

  const nextPlannedDate =
    nextSessionId && scheduleDateBySession.has(nextSessionId)
      ? scheduleDateBySession.get(nextSessionId) ?? null
      : null;

  const nextReadiness = qd?.nextSession
    ? readinessForSession(
        qd.nextSession,
        nextMeta ?? summarizeTemplate(null, new Map(), new Map(), new Map()),
        historySignals,
        metaByTemplate,
        nextPlannedDate
      )
    : null;

  const onPrimary = () => {
    if (activeSessionId) {
      window.location.pathname = `/workout/${activeSessionId}`;
      return;
    }
    if (nextSessionId) window.location.pathname = `/workout/${nextSessionId}`;
  };

  return (
    <div className="tr-trainingBoard">
      <div className="tr-trainingPageHead">
        <div className="tr-trainingSectionEyebrow">WORKOUTS</div>
      </div>

      {err ? <div className="tr-trainingError">{err}</div> : null}

      {!loading && !hasActiveProgram ? (
        <section className="tr-trainingEmpty">
          <div className="tr-trainingSectionEyebrow">WORKOUTS</div>
          <h2>No active program</h2>
          <p>Generate a program in Coach to build your training queue.</p>
        </section>
      ) : null}

      {hasActiveProgram ? (
        <>
          <section className={`tr-nextHero ${activeSessionId ? "is-active" : ""}`}>
            <div className="tr-nextHeroTopline">
              <div className="tr-trainingSectionEyebrow">
                {activeSessionId ? "ACTIVE WORKOUT" : "NEXT WORKOUT"}
              </div>

              <div
                className={`tr-heroReadinessInline is-${
                  activeSessionId ? "ready" : nextReadiness?.tone ?? "soon"
                }`}
              >
                <span className="tr-heroReadinessLine" aria-hidden />
                <span className="tr-heroReadinessDot" aria-hidden />
                <strong>
                  {activeSessionId ? "IN PROGRESS" : nextReadiness?.label ?? "READY"}
                </strong>
              </div>
            </div>

            <div className={`tr-nextHeroCompact ${activeSessionId ? "is-active" : ""}`}>
              <div className="tr-nextHeroCopy">
                <h1>
                  {activeSessionId
                    ? splitLabel(activeLabel ?? "Session").title
                    : nextLabelParts.title}
                </h1>

                {(activeSessionId
                  ? splitLabel(activeLabel ?? "Session").subtitle
                  : nextLabelParts.subtitle || nextMeta?.templateName) ? (
                  <div className="tr-nextHeroProgram">
                    {activeSessionId
                      ? splitLabel(activeLabel ?? "Session").subtitle
                      : nextLabelParts.subtitle || nextMeta?.templateName}
                  </div>
                ) : null}

                {!activeSessionId ? <MuscleStrip muscles={nextMeta?.muscles ?? []} /> : null}
              </div>

              {!activeSessionId ? (
                <div className="tr-nextHeroQuickStats" aria-label="Next workout details">
                  <div className="tr-nextHeroQuickStat">
                    <span className="tr-heroMetricIcon" aria-hidden>
                      <ExerciseMetricIcon />
                    </span>
                    <div className="tr-heroMetricCopy">
                      <strong>{nextMeta?.exerciseCount ?? "—"}</strong>
                      <span>EXERCISES</span>
                    </div>
                  </div>

                  <div className="tr-nextHeroQuickStat is-time">
                    <span className="tr-heroMetricIcon" aria-hidden>
                      <ClockMetricIcon />
                    </span>
                    <div className="tr-heroMetricCopy">
                      <strong className="tr-durationValue">
                        {formatEstimatedDuration(nextMeta?.estimatedMinutes)}
                      </strong>
                      <span>EST. TIME</span>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="tr-nextHeroActions">
              <button
                className="tr-scheduleBtn tr-scheduleBtn--primary"
                disabled={!activeSessionId && !nextSessionId}
                onClick={onPrimary}
              >
                <span className="tr-primaryActionGlyph" aria-hidden>▶</span>
                <span>{activeSessionId ? "RESUME WORKOUT" : "START WORKOUT"}</span>
              </button>

              {!activeSessionId && nextSessionId ? (
                <button
                  className="tr-scheduleBtn tr-scheduleBtn--edit"
                  onClick={() => setEditingSessionId(nextSessionId)}
                >
                  EDIT
                </button>
              ) : null}
            </div>
          </section>

          <section className="tr-upcomingBoard">
            <div className="tr-upcomingHeader">
              <div className="tr-trainingSectionEyebrow">UPCOMING TRAINING</div>
            </div>

            {loading ? (
              <div className="tr-upcomingLoading">Loading training schedule…</div>
            ) : upcomingSessions.length ? (
              <div className="tr-trainingTimeline">
                {upcomingSessions.map((session: any, index: number) => {
                  const label = formatSessionLabel({
                    sessionType: session.session_type,
                    goal,
                    goalMode,
                    symptomKey,
                  });
                  const parts = splitLabel(label);
                  const meta = metaBySession.get(session.id) ?? null;
                  const plannedDate =
                    scheduleDateBySession.get(session.id) ?? normalizeSessionDate(session);
                  const readiness = readinessForSession(
                    session,
                    meta ?? summarizeTemplate(null, new Map(), new Map(), new Map()),
                    historySignals,
                    metaByTemplate,
                    plannedDate
                  );

                  return (
                    <article key={session.id} className={`tr-trainingTimelineRow is-${readiness.tone}`}>
                      <div className="tr-timelineRail" aria-hidden>
                        <span className="tr-timelineNode" />
                        {index < upcomingSessions.length - 1 ? <span className="tr-timelineLine" /> : null}
                      </div>

                      <div className="tr-sessionCard">
                        <div className="tr-sessionPrimary">
                          <div className="tr-sessionTitleRow">
                            <div className="tr-sessionTitleCopy">
                              <h3>{parts.title}</h3>
                              {(parts.subtitle || meta?.templateName) ? (
                                <p>{parts.subtitle || meta?.templateName}</p>
                              ) : null}
                            </div>
                          </div>

                          <MuscleStrip muscles={meta?.muscles ?? []} compact />

                          <div className="tr-sessionMeta" aria-label="Workout size and estimated duration">
                            <div className="tr-sessionMetaItem">
                              <span className="tr-sessionMetaIcon" aria-hidden>
                                <ExerciseMetricIcon />
                              </span>
                              <strong>{meta?.exerciseCount ?? "—"}</strong>
                              <span>EXERCISES</span>
                            </div>

                            <div className="tr-sessionMetaItem">
                              <span className="tr-sessionMetaIcon" aria-hidden>
                                <ClockMetricIcon />
                              </span>
                              <strong className="tr-durationValue">
                                {formatEstimatedDuration(meta?.estimatedMinutes)}
                              </strong>
                              <span>EST. TIME</span>
                            </div>
                          </div>
                        </div>

                        <div className="tr-sessionRight">
                          <ScheduleDateBadge date={plannedDate} />

                          <div className="tr-sessionReadiness">
                            <ReadinessBadge readiness={readiness} compact />
                          </div>

                          <div className="tr-sessionActions">
                            <button
                              className="tr-scheduleBtn tr-scheduleBtn--rowStart"
                              onClick={() => (window.location.pathname = `/workout/${session.id}`)}
                            >
                              START
                            </button>
                            <button
                              className="tr-scheduleBtn tr-scheduleBtn--rowEdit"
                              onClick={() => setEditingSessionId(session.id)}
                            >
                              EDIT
                            </button>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="tr-upcomingLoading">No upcoming sessions.</div>
            )}
          </section>
        </>
      ) : null}

      {editingSessionId ? (
        <PlannedSessionEditor
          sessionId={editingSessionId}
          onClose={() => setEditingSessionId(null)}
          onSaved={load}
        />
      ) : null}

      <style>{`
        .tr-trainingBoard{
          display:grid;
          gap:16px;
          min-width:0;
          padding-bottom:28px;
        }

        .tr-trainingPageHead{
          display:flex;
          align-items:center;
          justify-content:flex-start;
          min-width:0;
          padding:0 2px 2px;
        }

        .tr-trainingSectionEyebrow{
          color:#67d4ff;
          font-size:12px;
          line-height:1;
          font-weight:1000;
          letter-spacing:.16em;
        }

        .tr-trainingError,
        .tr-trainingEmpty,
        .tr-nextHero,
        .tr-upcomingBoard{
          min-width:0;
          border:1px solid rgba(255,255,255,.09);
          background:
            radial-gradient(circle at 88% -8%, rgba(0,170,255,.08), transparent 32%),
            linear-gradient(145deg, rgba(17,23,33,.99), rgba(7,11,17,.995));
          border-radius:20px;
          box-shadow:
            0 24px 70px rgba(0,0,0,.34),
            inset 0 1px 0 rgba(255,255,255,.035);
        }

        .tr-trainingError{
          padding:14px 16px;
          border-color:rgba(255,80,80,.3);
          background:rgba(255,80,80,.08);
          font-weight:850;
        }

        .tr-trainingEmpty{
          padding:24px;
        }

        .tr-trainingEmpty h2{
          margin:6px 0 0;
          color:#f5f9fc;
          font-size:clamp(22px,2vw,30px);
          letter-spacing:-.03em;
        }

        .tr-trainingEmpty p{
          margin:7px 0 0;
          color:rgba(224,234,244,.64);
          line-height:1.45;
        }

        /* NEXT WORKOUT HERO */
        .tr-nextHero{
          position:relative;
          overflow:hidden;
          padding:24px;
          border-color:rgba(49,190,246,.27);
          background:
            radial-gradient(circle at 84% 8%, rgba(50,193,247,.09), transparent 30%),
            linear-gradient(135deg, rgba(20,29,41,.995), rgba(8,12,19,.995) 60%, rgba(6,10,16,.995));
          box-shadow:
            0 30px 90px rgba(0,0,0,.42),
            inset 0 1px 0 rgba(255,255,255,.05),
            inset 0 0 0 1px rgba(70,199,248,.025);
        }

        .tr-nextHero::before{
          content:"";
          position:absolute;
          inset:0 auto 0 0;
          width:3px;
          background:linear-gradient(180deg,#78e3ff 0%,#1aa9ef 58%,rgba(26,169,239,.05) 100%);
          box-shadow:0 0 20px rgba(47,188,245,.2);
        }

        .tr-nextHero::after{
          content:"";
          position:absolute;
          left:24px;
          right:24px;
          top:0;
          height:1px;
          background:linear-gradient(90deg,rgba(112,223,255,.42),rgba(112,223,255,.08),transparent 72%);
          pointer-events:none;
        }

        .tr-nextHero.is-active::before{
          background:linear-gradient(180deg,#63e6a0,#1db66c 60%,rgba(29,182,108,.05));
        }

        .tr-nextHeroTopline,
        .tr-nextHeroBody,
        .tr-nextHeroActions{
          position:relative;
          z-index:1;
          min-width:0;
        }

        .tr-nextHeroTopline{
          display:flex;
          align-items:flex-start;
          justify-content:space-between;
          gap:20px;
        }

        .tr-nextHeroBody{
          display:grid;
          gap:22px;
          margin-top:24px;
        }

        .tr-nextHeroCopy{
          min-width:0;
        }

        .tr-nextHeroCopy h1{
          margin:0;
          color:#f7fbff;
          font-size:clamp(34px,4.4vw,58px);
          line-height:.98;
          letter-spacing:-.045em;
          font-weight:1000;
          overflow-wrap:anywhere;
          text-shadow:0 8px 26px rgba(0,0,0,.34);
        }

        .tr-nextHeroProgram{
          margin-top:9px;
          color:rgba(226,237,247,.72);
          font-size:15px;
          font-weight:850;
          letter-spacing:.02em;
        }

        .tr-scheduleMuscles{
          display:flex;
          flex-wrap:wrap;
          gap:10px 18px;
          min-width:0;
          margin-top:20px;
        }

        .tr-scheduleMuscle{
          display:flex;
          align-items:center;
          gap:9px;
          min-width:0;
          color:rgba(244,250,255,.9);
          font-size:11px;
          font-weight:950;
          letter-spacing:.06em;
          text-transform:uppercase;
        }

        .tr-scheduleMuscleIcon{
          width:34px;
          height:34px;
          flex:0 0 34px;
          display:grid;
          place-items:center;
          border:1px solid rgba(71,200,247,.16);
          border-radius:10px;
          background:
            linear-gradient(180deg,rgba(60,193,244,.09),rgba(255,255,255,.015));
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.035),
            0 8px 18px rgba(0,0,0,.18);
        }

        .tr-scheduleMuscleIcon img{
          width:25px;
          height:25px;
          object-fit:contain;
          filter:drop-shadow(0 4px 8px rgba(0,170,255,.14));
        }

        .tr-scheduleMuscles.is-compact{
          gap:7px 13px;
          margin-top:11px;
        }

        .tr-scheduleMuscles.is-compact .tr-scheduleMuscle{
          font-size:9.5px;
          letter-spacing:.045em;
          color:rgba(227,237,245,.72);
        }

        .tr-scheduleMuscles.is-compact .tr-scheduleMuscleIcon{
          width:24px;
          height:24px;
          flex-basis:24px;
          border:0;
          border-radius:7px;
          background:rgba(42,180,235,.055);
          box-shadow:none;
        }

        .tr-scheduleMuscles.is-compact .tr-scheduleMuscleIcon img{
          width:19px;
          height:19px;
        }

        .tr-scheduleNoMuscles{
          margin-top:14px;
          color:rgba(207,220,233,.48);
          font-size:11px;
          font-weight:750;
        }

        .tr-readinessStatus{
          position:relative;
          display:flex;
          align-items:stretch;
          gap:10px;
          min-width:190px;
          max-width:320px;
          padding:2px 0 2px 11px;
        }

        .tr-readinessAccent{
          position:absolute;
          inset:1px auto 1px 0;
          width:2px;
          border-radius:2px;
          background:#5ed3ff;
          box-shadow:0 0 12px rgba(94,211,255,.28);
        }

        .tr-readinessCopy{
          min-width:0;
        }

        .tr-readinessLabel{
          display:block;
          color:rgba(194,209,222,.42);
          font-size:9px;
          font-weight:1000;
          letter-spacing:.15em;
        }

        .tr-readinessStatus strong{
          display:block;
          margin-top:4px;
          color:#a9e8ff;
          font-size:11px;
          line-height:1.1;
          font-weight:1000;
          letter-spacing:.08em;
        }

        .tr-readinessDate{
          display:block;
          margin-top:5px;
          color:rgba(217,229,239,.55);
          font-size:10px;
          line-height:1.25;
          font-weight:800;
        }

        .tr-readinessStatus--ready .tr-readinessAccent{
          background:#50df91;
          box-shadow:0 0 12px rgba(80,223,145,.28);
        }
        .tr-readinessStatus--ready strong{ color:#8ef0b8; }

        .tr-readinessStatus--soon .tr-readinessAccent,
        .tr-readinessStatus--monitor .tr-readinessAccent{
          background:#dcb86e;
          box-shadow:0 0 12px rgba(220,184,110,.22);
        }
        .tr-readinessStatus--soon strong,
        .tr-readinessStatus--monitor strong{ color:#efd09a; }

        .tr-readinessStatus--recovering .tr-readinessAccent{
          background:#efa54a;
          box-shadow:0 0 12px rgba(239,165,74,.24);
        }
        .tr-readinessStatus--recovering strong{ color:#ffc476; }

        .tr-readinessStatus.is-compact{
          min-width:0;
          max-width:none;
          padding-left:9px;
        }

        .tr-readinessStatus.is-compact strong{
          margin-top:0;
          font-size:9px;
          white-space:normal;
        }

        .tr-nextHeroMetrics{
          display:grid;
          grid-template-columns:repeat(3,minmax(0,1fr));
          min-width:0;
          border-top:1px solid rgba(255,255,255,.07);
          border-bottom:1px solid rgba(255,255,255,.055);
        }

        .tr-nextMetric{
          position:relative;
          min-width:0;
          padding:15px 16px;
          text-align:center;
        }

        .tr-nextMetric + .tr-nextMetric::before{
          content:"";
          position:absolute;
          left:0;
          top:12px;
          bottom:12px;
          width:1px;
          background:rgba(255,255,255,.065);
        }

        .tr-nextMetric strong{
          display:block;
          color:#f4f9fd;
          font-size:13px;
          line-height:1.18;
          font-weight:1000;
          letter-spacing:.035em;
          white-space:normal;
        }

        .tr-nextHeroActions{
          display:grid;
          grid-template-columns:minmax(0,1fr) 138px;
          gap:10px;
          margin-top:18px;
        }

        .tr-scheduleBtn{
          appearance:none;
          min-width:0;
          min-height:48px;
          padding:0 18px;
          border:1px solid transparent;
          border-radius:12px;
          cursor:pointer;
          font:inherit;
          font-size:11px;
          font-weight:1000;
          letter-spacing:.055em;
          transition:
            transform .16s ease,
            border-color .16s ease,
            box-shadow .16s ease,
            background .16s ease;
        }

        .tr-scheduleBtn:hover{ transform:translateY(-1px); }
        .tr-scheduleBtn:active{ transform:translateY(0) scale(.99); }
        .tr-scheduleBtn:disabled{
          opacity:.45;
          cursor:not-allowed;
          transform:none;
        }

        .tr-scheduleBtn--primary{
          color:#061019;
          background:linear-gradient(180deg,#6be0ff,#28a9ef);
          box-shadow:
            0 15px 34px rgba(0,170,255,.18),
            inset 0 1px 0 rgba(255,255,255,.42);
        }

        .tr-scheduleBtn--edit,
        .tr-scheduleBtn--rowEdit{
          color:rgba(237,246,253,.82);
          border-color:rgba(119,195,230,.16);
          background:linear-gradient(180deg,rgba(255,255,255,.042),rgba(255,255,255,.018));
          box-shadow:inset 0 1px 0 rgba(255,255,255,.025);
        }

        .tr-scheduleBtn--rowStart{
          color:#061019;
          background:linear-gradient(180deg,#5bd7ff,#239fe3);
          box-shadow:inset 0 1px 0 rgba(255,255,255,.36);
        }

        /* UPCOMING TRAINING */
        .tr-upcomingBoard{
          padding:20px 20px 18px;
        }

        .tr-upcomingHeader{
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:18px;
          min-width:0;
          padding-bottom:13px;
          border-bottom:1px solid rgba(255,255,255,.06);
        }

        .tr-rotationStrip{
          min-width:0;
          max-width:620px;
        }

        .tr-rotationStrip > div{
          display:flex;
          align-items:center;
          justify-content:flex-end;
          flex-wrap:wrap;
          gap:6px;
          min-width:0;
        }

        .tr-rotationStrip > div > span{
          display:flex;
          align-items:center;
          gap:6px;
          min-width:0;
          color:rgba(213,226,237,.55);
          font-size:9px;
          font-weight:900;
          letter-spacing:.035em;
          text-transform:uppercase;
        }

        .tr-rotationStrip b{
          color:#49c9fb;
          font-size:14px;
          line-height:1;
          font-weight:900;
        }

        .tr-upcomingLoading{
          padding:20px 2px 4px;
          color:rgba(214,227,238,.56);
          font-weight:800;
        }

        .tr-trainingTimeline{
          display:grid;
          margin-top:10px;
        }

        .tr-trainingTimelineRow{
          display:grid;
          grid-template-columns:28px minmax(0,1fr);
          min-width:0;
          min-height:116px;
        }

        .tr-timelineRail{
          position:relative;
          display:flex;
          justify-content:center;
        }

        .tr-timelineNode{
          position:absolute;
          top:28px;
          left:8px;
          width:9px;
          height:9px;
          border-radius:50%;
          border:2px solid #48c9ff;
          background:#0d141d;
          box-shadow:0 0 12px rgba(72,201,255,.22);
          z-index:2;
        }

        .tr-trainingTimelineRow.is-soon .tr-timelineNode,
        .tr-trainingTimelineRow.is-monitor .tr-timelineNode{
          border-color:#dbb86f;
          box-shadow:0 0 12px rgba(219,184,111,.18);
        }

        .tr-trainingTimelineRow.is-recovering .tr-timelineNode{
          border-color:#efa54a;
          box-shadow:0 0 12px rgba(239,165,74,.2);
        }

        .tr-timelineLine{
          position:absolute;
          top:37px;
          bottom:-23px;
          left:12px;
          width:1px;
          background:linear-gradient(180deg,rgba(72,201,255,.2),rgba(255,255,255,.045));
        }

        .tr-sessionCard{
          display:grid;
          grid-template-columns:minmax(0,1fr) minmax(220px,auto);
          gap:18px;
          align-items:center;
          min-width:0;
          margin:5px 0 10px;
          padding:16px 17px;
          border:1px solid rgba(255,255,255,.06);
          border-radius:15px;
          background:
            linear-gradient(105deg,rgba(255,255,255,.028),rgba(255,255,255,.01));
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.022),
            0 12px 30px rgba(0,0,0,.12);
          transition:border-color .16s ease, transform .16s ease, background .16s ease;
        }

        .tr-sessionCard:hover{
          transform:translateY(-1px);
          border-color:rgba(0,170,255,.16);
          background:linear-gradient(105deg,rgba(0,170,255,.035),rgba(255,255,255,.012));
        }

        .tr-sessionPrimary,
        .tr-sessionTitleCopy{
          min-width:0;
        }

        .tr-sessionTitleRow{
          display:grid;
          grid-template-columns:minmax(0,1fr) auto;
          align-items:start;
          gap:14px;
          min-width:0;
        }

        .tr-sessionTitleRow h3{
          margin:0;
          color:#f5f9fc;
          font-size:18px;
          line-height:1.08;
          letter-spacing:-.015em;
          font-weight:1000;
          overflow-wrap:anywhere;
        }

        .tr-sessionTitleRow p{
          margin:4px 0 0;
          color:rgba(208,222,233,.55);
          font-size:10.5px;
          font-weight:800;
        }

        .tr-sessionDate{
          color:#cceeff;
          font-size:10px;
          line-height:1.2;
          font-weight:1000;
          letter-spacing:.06em;
          text-transform:uppercase;
          white-space:nowrap;
        }

        .tr-sessionMeta{
          display:flex;
          align-items:center;
          flex-wrap:wrap;
          gap:7px;
          margin-top:10px;
          color:rgba(209,223,235,.52);
          font-size:10px;
          font-weight:850;
        }

        .tr-sessionMeta i{
          color:rgba(93,204,247,.42);
          font-style:normal;
        }

        .tr-sessionRight{
          display:grid;
          gap:10px;
          min-width:0;
        }

        .tr-sessionReadiness{
          display:grid;
          gap:4px;
          justify-items:start;
        }

        .tr-sessionReadiness > span{
          color:rgba(208,221,232,.48);
          font-size:9px;
          line-height:1.25;
          font-weight:800;
        }

        .tr-sessionActions{
          display:grid;
          grid-template-columns:minmax(0,1fr) 78px;
          gap:8px;
          min-width:0;
        }

        .tr-sessionActions .tr-scheduleBtn{
          min-height:40px;
          padding:0 12px;
          font-size:9.5px;
        }

        @media (max-width:900px){
          .tr-nextHeroTopline{
            gap:14px;
          }

          .tr-upcomingHeader{
            align-items:flex-start;
            flex-direction:column;
            gap:9px;
          }

          .tr-rotationStrip{
            width:100%;
            max-width:none;
          }

          .tr-rotationStrip > div{
            justify-content:flex-start;
          }

          .tr-sessionCard{
            grid-template-columns:minmax(0,1fr) 200px;
          }
        }

        /* STEP 6C: adaptive schedule + flagship next-workout hero */
        .tr-nextHero{
          padding:28px 28px 24px;
          background:
            linear-gradient(rgba(73,201,255,.025) 1px, transparent 1px),
            linear-gradient(90deg,rgba(73,201,255,.02) 1px, transparent 1px),
            radial-gradient(circle at 82% 20%,rgba(54,199,255,.13),transparent 30%),
            radial-gradient(circle at 12% 110%,rgba(50,115,255,.08),transparent 36%),
            linear-gradient(135deg,rgba(20,30,43,.998),rgba(7,12,19,.998) 64%,rgba(5,9,15,.998));
          background-size:42px 42px,42px 42px,auto,auto,auto;
          border-color:rgba(76,202,249,.31);
          box-shadow:
            0 34px 90px rgba(0,0,0,.46),
            inset 0 1px 0 rgba(255,255,255,.055),
            inset 0 0 48px rgba(31,157,220,.025);
        }

        .tr-nextHeroTopline{
          display:block;
        }

        .tr-nextHeroStage{
          position:relative;
          z-index:1;
          display:grid;
          grid-template-columns:minmax(0,1.35fr) minmax(230px,.65fr);
          align-items:end;
          gap:30px;
          min-width:0;
          margin-top:18px;
          padding-bottom:24px;
        }

        .tr-nextHeroCopy h1{
          max-width:720px;
          font-size:clamp(42px,5.1vw,66px);
          line-height:.92;
          letter-spacing:-.055em;
        }

        .tr-nextHeroProgram{
          margin-top:10px;
          color:rgba(231,240,248,.7);
          font-size:14px;
          font-weight:900;
        }

        .tr-nextHero .tr-scheduleMuscles{
          gap:10px 16px;
          margin-top:22px;
        }

        .tr-nextHero .tr-scheduleMuscle{
          min-height:42px;
          padding:5px 10px 5px 6px;
          border:1px solid rgba(69,199,249,.13);
          border-radius:12px;
          background:linear-gradient(180deg,rgba(48,190,246,.075),rgba(255,255,255,.018));
          box-shadow:inset 0 1px 0 rgba(255,255,255,.03);
        }

        .tr-nextHeroReadiness{
          align-self:stretch;
          display:flex;
          flex-direction:column;
          justify-content:flex-end;
          min-width:0;
          padding:18px 0 4px 24px;
          border-left:1px solid rgba(93,210,252,.16);
          background:linear-gradient(90deg,rgba(56,195,246,.035),transparent 72%);
        }

        .tr-nextHeroReadinessLabel{
          color:rgba(194,210,224,.44);
          font-size:9px;
          font-weight:1000;
          letter-spacing:.17em;
        }

        .tr-nextHeroReadinessState{
          display:flex;
          align-items:center;
          gap:9px;
          margin-top:8px;
          min-width:0;
        }

        .tr-nextHeroReadinessState strong{
          color:#a9e8ff;
          font-size:16px;
          line-height:1.05;
          font-weight:1000;
          letter-spacing:.025em;
        }

        .tr-nextHeroReadinessDot{
          width:8px;
          height:8px;
          flex:0 0 8px;
          border-radius:50%;
          background:#5bd8ff;
          box-shadow:0 0 14px rgba(91,216,255,.38);
        }

        .tr-nextHeroReadinessState.is-ready strong{color:#8ef0b8;}
        .tr-nextHeroReadinessState.is-ready .tr-nextHeroReadinessDot{
          background:#50df91;
          box-shadow:0 0 14px rgba(80,223,145,.38);
        }
        .tr-nextHeroReadinessState.is-soon strong,
        .tr-nextHeroReadinessState.is-monitor strong{color:#efd09a;}
        .tr-nextHeroReadinessState.is-soon .tr-nextHeroReadinessDot,
        .tr-nextHeroReadinessState.is-monitor .tr-nextHeroReadinessDot{
          background:#dcb86e;
          box-shadow:0 0 14px rgba(220,184,110,.3);
        }
        .tr-nextHeroReadinessState.is-recovering strong{color:#ffc476;}
        .tr-nextHeroReadinessState.is-recovering .tr-nextHeroReadinessDot{
          background:#efa54a;
          box-shadow:0 0 14px rgba(239,165,74,.34);
        }

        .tr-nextHeroReadinessRule{
          position:relative;
          width:100%;
          max-width:250px;
          height:3px;
          margin-top:16px;
          overflow:hidden;
          border-radius:999px;
          background:rgba(255,255,255,.055);
        }

        .tr-nextHeroReadinessRule span{
          display:block;
          width:72%;
          height:100%;
          border-radius:inherit;
          background:linear-gradient(90deg,#45c9ff,#55df9b);
          box-shadow:0 0 12px rgba(68,204,255,.24);
        }

        .tr-nextHeroReadinessWhen{
          margin-top:10px;
          color:rgba(238,247,253,.84);
          font-size:12px;
          font-weight:1000;
          letter-spacing:.08em;
        }

        .tr-nextHeroMetrics{
          position:relative;
          z-index:1;
          margin-top:0;
          background:rgba(0,0,0,.08);
        }

        .tr-nextMetric{
          padding:16px 14px;
        }

        .tr-nextMetric strong{
          font-size:12px;
          letter-spacing:.055em;
        }

        .tr-nextHeroActions{
          margin-top:16px;
        }

        .tr-upcomingHeader{
          justify-content:flex-start;
        }

        @media (max-width:680px){
          .tr-trainingBoard{
            gap:12px;
            padding-bottom:110px;
          }

          .tr-nextHero,
          .tr-upcomingBoard{
            width:100%;
            max-width:100%;
            box-sizing:border-box;
            border-radius:16px;
          }

          .tr-nextHero{
            padding:17px 14px 15px;
          }

          .tr-nextHero::after{
            left:14px;
            right:14px;
          }

          .tr-nextHeroTopline{
            display:block;
          }

          .tr-readinessStatus{
            width:100%;
            max-width:none;
            min-width:0;
          }

          .tr-nextHeroStage{
            grid-template-columns:1fr;
            gap:16px;
            margin-top:16px;
            padding-bottom:16px;
          }

          .tr-nextHeroCopy h1{
            font-size:clamp(34px,11vw,46px);
            line-height:.95;
          }

          .tr-nextHeroReadiness{
            padding:13px 0 0;
            border-left:0;
            border-top:1px solid rgba(93,210,252,.12);
            background:transparent;
          }

          .tr-nextHeroReadinessState strong{
            font-size:14px;
          }

          .tr-nextHeroReadinessRule{
            max-width:none;
          }

          .tr-nextHeroProgram{
            margin-top:7px;
            font-size:12px;
          }

          .tr-scheduleMuscles{
            display:grid;
            grid-template-columns:repeat(2,minmax(0,1fr));
            gap:7px;
            margin-top:14px;
          }

          .tr-scheduleMuscle{
            width:100%;
            gap:7px;
            min-height:38px;
            padding:5px 7px;
            border:1px solid rgba(65,194,244,.11);
            border-radius:10px;
            background:rgba(45,184,239,.035);
            font-size:9px;
            overflow:hidden;
          }

          .tr-scheduleMuscleIcon{
            width:26px;
            height:26px;
            flex-basis:26px;
            border-radius:8px;
          }

          .tr-scheduleMuscleIcon img{
            width:20px;
            height:20px;
          }

          .tr-nextHeroMetrics{
            grid-template-columns:repeat(3,minmax(0,1fr));
          }

          .tr-nextMetric{
            min-height:54px;
            padding:13px 6px;
            display:grid;
            place-items:center;
          }

          .tr-nextMetric + .tr-nextMetric::before{
            top:10px;
            bottom:10px;
          }

          .tr-nextMetric strong{
            font-size:10px;
            line-height:1.25;
            letter-spacing:.025em;
            overflow-wrap:anywhere;
          }

          .tr-nextHeroActions{
            grid-template-columns:1fr;
            gap:7px;
            margin-top:14px;
          }

          .tr-nextHeroActions .tr-scheduleBtn{
            width:100%;
            min-height:45px;
          }

          .tr-upcomingBoard{
            padding:16px 12px 15px;
          }

          .tr-upcomingHeader{
            gap:8px;
          }

          .tr-rotationStrip{
            overflow:visible;
          }

          .tr-rotationStrip > div{
            flex-wrap:wrap;
            overflow:visible;
            gap:4px 6px;
          }

          .tr-rotationStrip > div > span{
            flex:0 1 auto;
            font-size:8px;
            white-space:normal;
          }

          .tr-trainingTimeline{
            gap:8px;
            margin-top:10px;
          }

          .tr-trainingTimelineRow{
            display:block;
            min-height:0;
          }

          .tr-timelineRail{
            display:none;
          }

          .tr-sessionCard{
            display:block;
            width:100%;
            max-width:100%;
            min-width:0;
            box-sizing:border-box;
            margin:0;
            padding:13px;
            border-radius:13px;
            overflow:hidden;
          }

          .tr-sessionTitleRow{
            grid-template-columns:minmax(0,1fr) auto;
            gap:8px;
          }

          .tr-sessionTitleRow h3{
            font-size:17px;
          }

          .tr-sessionTitleRow p{
            font-size:9.5px;
          }

          .tr-sessionDate{
            max-width:92px;
            font-size:8.5px;
            text-align:right;
            white-space:normal;
          }

          .tr-scheduleMuscles.is-compact{
            display:flex;
            flex-wrap:wrap;
            gap:6px 10px;
            margin-top:9px;
          }

          .tr-scheduleMuscles.is-compact .tr-scheduleMuscle{
            width:auto;
            min-height:25px;
            padding:0;
            border:0;
            background:transparent;
            overflow:visible;
          }

          .tr-scheduleMuscles.is-compact .tr-scheduleMuscleIcon{
            width:20px;
            height:20px;
            flex-basis:20px;
            background:rgba(0,170,255,.05);
          }

          .tr-scheduleMuscles.is-compact .tr-scheduleMuscleIcon img{
            width:16px;
            height:16px;
          }

          .tr-sessionMeta{
            margin-top:8px;
            gap:5px;
            font-size:9px;
          }

          .tr-sessionRight{
            display:block;
            min-width:0;
            margin-top:10px;
            padding-top:10px;
            border-top:1px solid rgba(255,255,255,.05);
          }

          .tr-sessionReadiness{
            min-width:0;
          }

          .tr-sessionReadiness > span{
            margin-top:3px;
            font-size:8.5px;
          }

          .tr-sessionActions{
            grid-template-columns:minmax(0,1fr) 72px;
            gap:7px;
            margin-top:9px;
          }

          .tr-sessionActions .tr-scheduleBtn{
            min-width:0;
            min-height:38px;
            padding:0 8px;
            font-size:9px;
          }
        }

        /* STEP 6D: ultra-premium visual rendering only */
        .tr-nextHero{
          isolation:isolate;
          border-color:rgba(89,211,255,.30);
          background:
            radial-gradient(900px 360px at 8% -18%, rgba(73,206,255,.16), transparent 57%),
            radial-gradient(520px 340px at 94% 0%, rgba(21,123,193,.13), transparent 64%),
            radial-gradient(680px 260px at 55% 118%, rgba(23,112,168,.07), transparent 72%),
            linear-gradient(137deg, #111c28 0%, #0a131d 46%, #060b12 100%);
          box-shadow:
            0 34px 90px rgba(0,0,0,.50),
            0 10px 30px rgba(0,106,165,.08),
            inset 0 1px 0 rgba(255,255,255,.085),
            inset 0 -1px 0 rgba(0,0,0,.72),
            inset 0 0 0 1px rgba(95,214,255,.035);
        }

        .tr-nextHero::before{
          width:4px;
          background:
            linear-gradient(180deg,#a2edff 0%,#46cffc 28%,#169de7 68%,rgba(22,157,231,.10) 100%);
          box-shadow:
            0 0 22px rgba(68,205,255,.32),
            1px 0 0 rgba(255,255,255,.08);
        }

        .tr-nextHero::after{
          left:1px;
          right:1px;
          top:0;
          height:1px;
          background:
            linear-gradient(90deg,
              rgba(174,239,255,.75) 0%,
              rgba(86,210,255,.30) 22%,
              rgba(86,210,255,.08) 53%,
              transparent 84%);
          box-shadow:0 1px 12px rgba(65,197,244,.08);
        }

        .tr-nextHeroTopline{
          padding-bottom:2px;
        }

        .tr-nextHeroStage{
          position:relative;
          z-index:1;
          grid-template-columns:minmax(0,1.35fr) minmax(250px,.65fr);
          align-items:stretch;
          gap:34px;
          margin-top:18px;
          padding:12px 0 22px;
        }

        .tr-nextHeroStage::before{
          content:"";
          position:absolute;
          inset:0;
          z-index:-1;
          pointer-events:none;
          background:
            linear-gradient(90deg, rgba(92,210,255,.025), transparent 42%),
            repeating-linear-gradient(
              90deg,
              rgba(255,255,255,.012) 0,
              rgba(255,255,255,.012) 1px,
              transparent 1px,
              transparent 46px
            );
          mask-image:linear-gradient(90deg,rgba(0,0,0,.82),transparent 78%);
        }

        .tr-nextHeroCopy{
          display:flex;
          min-height:148px;
          flex-direction:column;
          justify-content:center;
          padding:2px 0 4px;
        }

        .tr-nextHeroCopy h1{
          max-width:760px;
          color:#fbfdff;
          font-size:clamp(44px,5.2vw,68px);
          line-height:.90;
          letter-spacing:-.058em;
          text-shadow:
            0 14px 34px rgba(0,0,0,.44),
            0 1px 0 rgba(255,255,255,.08);
        }

        .tr-nextHeroProgram{
          margin-top:11px;
          color:rgba(225,238,248,.68);
          font-size:14px;
          font-weight:900;
          letter-spacing:.025em;
        }

        .tr-nextHero .tr-scheduleMuscles{
          gap:10px;
          margin-top:20px;
        }

        .tr-nextHero .tr-scheduleMuscle{
          position:relative;
          min-height:44px;
          padding:5px 13px 5px 6px;
          border:1px solid rgba(104,216,255,.18);
          border-radius:13px;
          background:
            linear-gradient(180deg,rgba(36,151,205,.13),rgba(7,19,29,.62));
          box-shadow:
            0 12px 26px rgba(0,0,0,.18),
            inset 0 1px 0 rgba(255,255,255,.055),
            inset 0 -1px 0 rgba(0,0,0,.36);
          transition:
            transform .16s ease,
            border-color .16s ease,
            box-shadow .16s ease;
        }

        .tr-nextHero .tr-scheduleMuscle::after{
          content:"";
          position:absolute;
          inset:0;
          border-radius:inherit;
          pointer-events:none;
          background:
            linear-gradient(110deg,rgba(255,255,255,.035),transparent 34%);
        }

        .tr-nextHero .tr-scheduleMuscle:hover{
          transform:translateY(-1px);
          border-color:rgba(116,222,255,.31);
          box-shadow:
            0 16px 32px rgba(0,0,0,.22),
            0 0 0 1px rgba(82,207,255,.035),
            inset 0 1px 0 rgba(255,255,255,.07);
        }

        .tr-nextHero .tr-scheduleMuscleIcon{
          width:34px;
          height:34px;
          flex-basis:34px;
          border-color:rgba(100,215,255,.22);
          background:
            radial-gradient(circle at 50% 25%,rgba(65,205,255,.16),transparent 60%),
            linear-gradient(180deg,#102b3b,#081722);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.07),
            0 6px 16px rgba(0,0,0,.26);
        }

        .tr-nextHero .tr-scheduleMuscleIcon img{
          filter:
            drop-shadow(0 5px 8px rgba(0,0,0,.25))
            drop-shadow(0 0 8px rgba(52,199,255,.12));
        }

        .tr-nextHeroReadiness{
          position:relative;
          overflow:hidden;
          justify-content:center;
          padding:22px 22px 20px 28px;
          border:1px solid rgba(97,212,255,.12);
          border-left-color:rgba(97,212,255,.22);
          border-radius:16px;
          background:
            radial-gradient(circle at 16% 12%,rgba(61,205,255,.09),transparent 48%),
            linear-gradient(145deg,rgba(9,25,36,.84),rgba(4,10,16,.68));
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.04),
            inset 14px 0 34px rgba(0,155,230,.025),
            0 18px 44px rgba(0,0,0,.18);
        }

        .tr-nextHeroReadiness::before{
          content:"";
          position:absolute;
          left:0;
          top:22px;
          bottom:22px;
          width:2px;
          border-radius:999px;
          background:linear-gradient(180deg,#69deff,#2cb9f4);
          box-shadow:0 0 15px rgba(65,205,255,.25);
        }

        .tr-nextHeroReadinessLabel{
          color:rgba(201,221,234,.48);
          font-size:9px;
          letter-spacing:.19em;
        }

        .tr-nextHeroReadinessState strong{
          font-size:17px;
          letter-spacing:.045em;
          text-shadow:0 0 18px rgba(95,220,255,.10);
        }

        .tr-nextHeroReadinessState.is-ready strong{
          text-shadow:0 0 18px rgba(80,223,145,.12);
        }

        .tr-nextHeroReadinessDot{
          width:9px;
          height:9px;
          flex-basis:9px;
          box-shadow:
            0 0 0 4px rgba(91,216,255,.045),
            0 0 16px rgba(91,216,255,.38);
        }

        .tr-nextHeroReadinessState.is-ready .tr-nextHeroReadinessDot{
          box-shadow:
            0 0 0 4px rgba(80,223,145,.05),
            0 0 16px rgba(80,223,145,.42);
        }

        .tr-nextHeroReadinessRule{
          height:2px;
          margin-top:17px;
          background:rgba(255,255,255,.06);
          box-shadow:inset 0 1px 2px rgba(0,0,0,.55);
        }

        .tr-nextHeroReadinessRule span{
          background:linear-gradient(90deg,#57d3ff,#65e5aa);
          box-shadow:
            0 0 10px rgba(73,208,255,.22),
            0 0 18px rgba(84,224,160,.08);
        }

        .tr-nextHeroReadinessWhen{
          margin-top:11px;
          color:rgba(239,248,253,.80);
          font-size:11px;
          letter-spacing:.11em;
        }

        .tr-nextHeroMetrics{
          overflow:hidden;
          margin-top:2px;
          border-top-color:rgba(134,222,255,.10);
          border-bottom-color:rgba(255,255,255,.05);
          border-radius:10px;
          background:
            linear-gradient(180deg,rgba(255,255,255,.022),rgba(0,0,0,.10));
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.025),
            inset 0 -1px 0 rgba(0,0,0,.25);
        }

        .tr-nextMetric{
          min-height:58px;
          display:grid;
          place-items:center;
          padding:14px 16px;
        }

        .tr-nextMetric strong{
          color:#f5fbff;
          font-size:12px;
          letter-spacing:.075em;
          text-shadow:0 2px 12px rgba(0,0,0,.25);
        }

        .tr-nextMetric + .tr-nextMetric::before{
          top:13px;
          bottom:13px;
          background:
            linear-gradient(180deg,transparent,rgba(104,211,250,.17),transparent);
        }

        .tr-nextHeroActions{
          gap:11px;
          margin-top:14px;
        }

        .tr-scheduleBtn--primary{
          position:relative;
          overflow:hidden;
          color:#041018;
          border-color:rgba(157,235,255,.32);
          background:
            linear-gradient(180deg,#74e2ff 0%,#45c9fb 42%,#23a8ed 100%);
          box-shadow:
            0 16px 35px rgba(0,170,255,.20),
            0 4px 12px rgba(0,0,0,.20),
            inset 0 1px 0 rgba(255,255,255,.58),
            inset 0 -1px 0 rgba(0,91,147,.20);
          text-shadow:0 1px 0 rgba(255,255,255,.18);
        }

        .tr-scheduleBtn--primary::after,
        .tr-scheduleBtn--rowStart::after{
          content:"";
          position:absolute;
          left:7%;
          right:7%;
          top:0;
          height:1px;
          background:linear-gradient(90deg,transparent,rgba(255,255,255,.85),transparent);
          opacity:.65;
          pointer-events:none;
        }

        .tr-scheduleBtn--primary:hover{
          transform:translateY(-2px);
          border-color:rgba(185,242,255,.46);
          box-shadow:
            0 20px 42px rgba(0,170,255,.26),
            0 6px 15px rgba(0,0,0,.22),
            inset 0 1px 0 rgba(255,255,255,.66);
        }

        .tr-scheduleBtn--edit,
        .tr-scheduleBtn--rowEdit{
          border-color:rgba(133,203,233,.14);
          background:
            linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.015));
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.035),
            0 8px 18px rgba(0,0,0,.12);
        }

        .tr-scheduleBtn--edit:hover,
        .tr-scheduleBtn--rowEdit:hover{
          border-color:rgba(119,213,250,.30);
          background:
            linear-gradient(180deg,rgba(60,180,229,.085),rgba(255,255,255,.018));
          box-shadow:
            0 12px 24px rgba(0,0,0,.16),
            inset 0 1px 0 rgba(255,255,255,.05);
        }

        .tr-upcomingBoard{
          position:relative;
          overflow:hidden;
          border-color:rgba(92,202,243,.12);
          background:
            radial-gradient(700px 260px at 100% -8%,rgba(45,169,220,.055),transparent 60%),
            linear-gradient(147deg,#0d151f,#080d13 74%);
          box-shadow:
            0 26px 68px rgba(0,0,0,.34),
            inset 0 1px 0 rgba(255,255,255,.035);
        }

        .tr-upcomingBoard::before{
          content:"";
          position:absolute;
          left:0;
          right:0;
          top:0;
          height:1px;
          background:
            linear-gradient(90deg,rgba(102,216,255,.28),rgba(102,216,255,.06),transparent 76%);
          pointer-events:none;
        }

        .tr-trainingTimeline{
          gap:10px;
        }

        .tr-trainingTimelineRow{
          position:relative;
        }

        .tr-timelineNode{
          width:9px;
          height:9px;
          border:2px solid rgba(95,211,255,.80);
          background:#071019;
          box-shadow:
            0 0 0 4px rgba(62,190,240,.035),
            0 0 13px rgba(61,194,245,.14);
        }

        .tr-trainingTimelineRow.is-ready .tr-timelineNode{
          border-color:#5ee3a0;
          box-shadow:
            0 0 0 4px rgba(81,221,147,.035),
            0 0 13px rgba(81,221,147,.16);
        }

        .tr-trainingTimelineRow.is-soon .tr-timelineNode,
        .tr-trainingTimelineRow.is-monitor .tr-timelineNode{
          border-color:#e5bf73;
          box-shadow:
            0 0 0 4px rgba(229,191,115,.035),
            0 0 12px rgba(229,191,115,.12);
        }

        .tr-timelineLine{
          width:1px;
          background:
            linear-gradient(180deg,rgba(77,195,240,.22),rgba(77,195,240,.045));
        }

        .tr-sessionCard{
          position:relative;
          overflow:hidden;
          border-color:rgba(255,255,255,.075);
          background:
            radial-gradient(480px 150px at 12% 0%,rgba(67,190,235,.045),transparent 65%),
            linear-gradient(145deg,rgba(19,28,38,.98),rgba(9,14,21,.99));
          box-shadow:
            0 13px 34px rgba(0,0,0,.20),
            inset 0 1px 0 rgba(255,255,255,.035),
            inset 0 -1px 0 rgba(0,0,0,.28);
          transition:
            transform .17s ease,
            border-color .17s ease,
            box-shadow .17s ease,
            background .17s ease;
        }

        .tr-sessionCard::before{
          content:"";
          position:absolute;
          left:0;
          right:0;
          top:0;
          height:1px;
          background:linear-gradient(90deg,rgba(103,216,255,.14),transparent 72%);
          pointer-events:none;
        }

        .tr-sessionCard::after{
          content:"";
          position:absolute;
          inset:0;
          pointer-events:none;
          background:
            linear-gradient(118deg,rgba(255,255,255,.018),transparent 25%);
        }

        .tr-sessionCard:hover{
          transform:translateY(-2px);
          border-color:rgba(97,207,249,.18);
          background:
            radial-gradient(520px 170px at 10% 0%,rgba(67,190,235,.065),transparent 65%),
            linear-gradient(145deg,rgba(21,31,42,.99),rgba(9,14,21,.99));
          box-shadow:
            0 18px 42px rgba(0,0,0,.27),
            0 0 0 1px rgba(71,195,243,.025),
            inset 0 1px 0 rgba(255,255,255,.045);
        }

        .tr-sessionTitleRow h3{
          color:#f8fbfd;
          text-shadow:0 3px 16px rgba(0,0,0,.22);
        }

        .tr-sessionTitleRow p{
          color:rgba(218,231,241,.48);
        }

        .tr-sessionDate{
          color:rgba(204,229,242,.78);
          letter-spacing:.055em;
        }

        .tr-sessionMeta{
          color:rgba(202,219,231,.50);
        }

        .tr-scheduleMuscles.is-compact .tr-scheduleMuscleIcon{
          border:1px solid rgba(83,202,247,.08);
          background:
            radial-gradient(circle at 50% 20%,rgba(62,198,248,.08),transparent 62%),
            rgba(21,73,96,.16);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.025);
        }

        .tr-sessionRight{
          position:relative;
          z-index:1;
        }

        .tr-readinessStatus.is-compact{
          padding-left:10px;
        }

        .tr-readinessStatus.is-compact .tr-readinessAccent{
          width:2px;
          box-shadow:0 0 10px rgba(94,211,255,.20);
        }

        .tr-scheduleBtn--rowStart{
          position:relative;
          overflow:hidden;
          color:#081018;
          border-color:rgba(141,225,255,.24);
          background:
            linear-gradient(180deg,#5ed7ff,#2babed);
          box-shadow:
            0 10px 22px rgba(0,167,235,.13),
            inset 0 1px 0 rgba(255,255,255,.46);
        }

        .tr-scheduleBtn--rowStart:hover{
          transform:translateY(-1px);
          border-color:rgba(172,235,255,.34);
          box-shadow:
            0 13px 28px rgba(0,167,235,.18),
            inset 0 1px 0 rgba(255,255,255,.53);
        }

        @media (hover:hover) and (pointer:fine){
          .tr-sessionCard:hover .tr-scheduleMuscleIcon{
            border-color:rgba(83,202,247,.14);
          }
        }

        @media (prefers-reduced-motion:reduce){
          .tr-nextHero .tr-scheduleMuscle,
          .tr-sessionCard,
          .tr-scheduleBtn{
            transition:none !important;
          }
        }

        @media (max-width:680px){
          .tr-nextHero{
            background:
              radial-gradient(520px 230px at 14% -8%,rgba(63,201,255,.11),transparent 58%),
              linear-gradient(145deg,#101b27,#070d14 72%);
            box-shadow:
              0 24px 58px rgba(0,0,0,.42),
              inset 0 1px 0 rgba(255,255,255,.055);
          }

          .tr-nextHeroStage{
            grid-template-columns:1fr;
            gap:13px;
            padding:5px 0 15px;
          }

          .tr-nextHeroStage::before{
            opacity:.45;
          }

          .tr-nextHeroCopy{
            min-height:0;
            padding-top:4px;
          }

          .tr-nextHeroCopy h1{
            max-width:100%;
            font-size:clamp(36px,12.2vw,50px);
            line-height:.91;
          }

          .tr-nextHero .tr-scheduleMuscles{
            display:flex;
            flex-wrap:wrap;
            gap:7px;
            margin-top:15px;
          }

          .tr-nextHero .tr-scheduleMuscle{
            width:auto;
            min-height:38px;
            padding:4px 9px 4px 5px;
            border-radius:11px;
          }

          .tr-nextHero .tr-scheduleMuscleIcon{
            width:29px;
            height:29px;
            flex-basis:29px;
          }

          .tr-nextHero .tr-scheduleMuscleIcon img{
            width:21px;
            height:21px;
          }

          .tr-nextHeroReadiness{
            padding:14px 14px 13px 18px;
            border:1px solid rgba(92,209,250,.11);
            border-top-color:rgba(112,221,255,.17);
            border-radius:13px;
            background:
              linear-gradient(135deg,rgba(38,153,199,.055),rgba(4,10,15,.28));
          }

          .tr-nextHeroReadiness::before{
            top:14px;
            bottom:14px;
          }

          .tr-nextHeroReadinessRule{
            margin-top:12px;
          }

          .tr-nextHeroMetrics{
            border-radius:9px;
          }

          .tr-nextMetric{
            min-height:52px;
            padding:11px 5px;
          }

          .tr-nextMetric strong{
            font-size:9.5px;
            letter-spacing:.04em;
          }

          .tr-upcomingBoard{
            background:
              radial-gradient(430px 180px at 100% 0%,rgba(45,169,220,.05),transparent 65%),
              linear-gradient(150deg,#0d151e,#070c12);
          }

          .tr-sessionCard{
            padding:14px 13px;
            border-color:rgba(255,255,255,.07);
            background:
              radial-gradient(320px 120px at 10% 0%,rgba(67,190,235,.04),transparent 67%),
              linear-gradient(150deg,rgba(17,26,36,.99),rgba(8,13,19,.99));
            box-shadow:
              0 11px 26px rgba(0,0,0,.18),
              inset 0 1px 0 rgba(255,255,255,.03);
          }

          .tr-sessionCard:hover{
            transform:none;
          }

          .tr-sessionActions .tr-scheduleBtn--rowStart{
            box-shadow:
              0 9px 18px rgba(0,167,235,.11),
              inset 0 1px 0 rgba(255,255,255,.42);
          }
        }


        /* STEP 6E: flagship hero + high-end planner card rendering */
        .tr-nextHero{
          position:relative;
          isolation:isolate;
          overflow:hidden;
          padding:22px 22px 20px;
          border:1px solid rgba(110,220,255,.30);
          border-radius:22px;
          background:
            radial-gradient(720px 300px at 8% 18%, rgba(55,200,255,.18), transparent 54%),
            radial-gradient(480px 300px at 96% 104%, rgba(0,0,0,.62), transparent 72%),
            radial-gradient(420px 220px at 77% 0%, rgba(20,103,159,.10), transparent 70%),
            linear-gradient(145deg, #132130 0%, #0a141e 46%, #050a10 100%);
          box-shadow:
            0 2px 0 rgba(255,255,255,.035),
            0 13px 28px rgba(0,0,0,.34),
            0 38px 90px rgba(0,0,0,.48),
            0 16px 50px rgba(0,145,215,.10),
            inset 0 1px 0 rgba(255,255,255,.11),
            inset 0 -18px 34px rgba(0,0,0,.24),
            inset 0 0 0 1px rgba(94,210,255,.035);
        }

        .tr-nextHero::before{
          content:"";
          position:absolute;
          z-index:0;
          left:0;
          top:18px;
          bottom:18px;
          width:3px;
          border-radius:0 999px 999px 0;
          background:linear-gradient(180deg,#b8f3ff 0%,#57d7ff 27%,#12a1e8 72%,rgba(18,161,232,.06) 100%);
          box-shadow:
            0 0 18px rgba(76,210,255,.34),
            1px 0 0 rgba(255,255,255,.12);
        }

        .tr-nextHero::after{
          content:"";
          position:absolute;
          z-index:0;
          left:3px;
          right:3px;
          top:0;
          height:1px;
          pointer-events:none;
          background:linear-gradient(
            90deg,
            rgba(205,248,255,.86) 0%,
            rgba(103,220,255,.42) 17%,
            rgba(103,220,255,.10) 48%,
            rgba(255,255,255,.025) 76%,
            transparent 100%
          );
          box-shadow:0 1px 10px rgba(67,200,248,.10);
        }

        .tr-nextHeroTopline{
          position:relative;
          z-index:2;
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:18px;
          min-width:0;
          padding:0 0 8px;
        }

        .tr-heroReadinessInline{
          position:relative;
          display:flex;
          align-items:center;
          gap:8px;
          min-width:0;
          padding-left:12px;
          color:#a9d8eb;
          font-size:10px;
          line-height:1;
          font-weight:1000;
          letter-spacing:.10em;
          white-space:nowrap;
        }

        .tr-heroReadinessLine{
          position:absolute;
          left:0;
          top:-3px;
          bottom:-3px;
          width:2px;
          border-radius:999px;
          background:#5ad7ff;
          box-shadow:0 0 11px rgba(74,208,255,.34);
        }

        .tr-heroReadinessDot{
          width:7px;
          height:7px;
          flex:0 0 7px;
          border-radius:50%;
          background:#5ad7ff;
          box-shadow:
            0 0 0 4px rgba(90,215,255,.045),
            0 0 13px rgba(90,215,255,.48);
        }

        .tr-heroReadinessInline.is-ready{
          color:#8df0b8;
        }

        .tr-heroReadinessInline.is-ready .tr-heroReadinessLine,
        .tr-heroReadinessInline.is-ready .tr-heroReadinessDot{
          background:#54e29a;
          box-shadow:
            0 0 0 4px rgba(84,226,154,.04),
            0 0 14px rgba(84,226,154,.42);
        }

        .tr-heroReadinessInline.is-soon,
        .tr-heroReadinessInline.is-monitor{
          color:#efd09a;
        }

        .tr-heroReadinessInline.is-soon .tr-heroReadinessLine,
        .tr-heroReadinessInline.is-soon .tr-heroReadinessDot,
        .tr-heroReadinessInline.is-monitor .tr-heroReadinessLine,
        .tr-heroReadinessInline.is-monitor .tr-heroReadinessDot{
          background:#e8bd6d;
          box-shadow:
            0 0 0 4px rgba(232,189,109,.035),
            0 0 12px rgba(232,189,109,.30);
        }

        .tr-heroReadinessInline.is-recovering{
          color:#ffc476;
        }

        .tr-heroReadinessInline.is-recovering .tr-heroReadinessLine,
        .tr-heroReadinessInline.is-recovering .tr-heroReadinessDot{
          background:#ffb65a;
          box-shadow:
            0 0 0 4px rgba(255,182,90,.035),
            0 0 13px rgba(255,182,90,.30);
        }

        .tr-heroIdentityStage{
          position:relative;
          z-index:1;
          overflow:hidden;
          min-height:185px;
          display:flex;
          align-items:center;
          padding:14px 0 20px;
        }

        .tr-heroIdentityStage::before{
          content:"";
          position:absolute;
          z-index:-1;
          width:540px;
          height:260px;
          left:-92px;
          top:-66px;
          border-radius:50%;
          background:radial-gradient(circle,rgba(69,204,255,.11),rgba(31,154,218,.035) 45%,transparent 72%);
          filter:blur(2px);
          pointer-events:none;
        }

        .tr-heroIdentityStage::after{
          content:"";
          position:absolute;
          z-index:-1;
          right:-80px;
          bottom:-120px;
          width:440px;
          height:280px;
          border-radius:50%;
          background:radial-gradient(circle,rgba(0,0,0,.50),transparent 70%);
          pointer-events:none;
        }

        .tr-nextHeroCopy{
          width:100%;
          min-width:0;
          position:relative;
          z-index:2;
        }

        .tr-nextHeroCopy h1{
          max-width:820px;
          margin:0;
          color:#f9fcff;
          font-size:clamp(48px,5.4vw,72px);
          line-height:.89;
          font-weight:1000;
          letter-spacing:-.060em;
          text-shadow:
            0 2px 0 rgba(255,255,255,.025),
            0 12px 34px rgba(0,0,0,.48),
            0 0 42px rgba(70,199,255,.045);
        }

        .tr-nextHeroProgram{
          margin-top:12px;
          color:rgba(222,237,248,.70);
          font-size:14px;
          line-height:1.25;
          font-weight:900;
          letter-spacing:.025em;
        }

        .tr-nextHero .tr-scheduleMuscles{
          gap:12px;
          margin-top:23px;
        }

        .tr-nextHero .tr-scheduleMuscle{
          position:relative;
          overflow:hidden;
          min-height:48px;
          padding:6px 15px 6px 7px;
          gap:9px;
          border:1px solid rgba(103,214,255,.19);
          border-radius:14px;
          background:
            radial-gradient(circle at 18% 8%,rgba(84,210,255,.08),transparent 55%),
            linear-gradient(145deg,rgba(18,42,57,.88),rgba(5,14,21,.94));
          box-shadow:
            0 9px 22px rgba(0,0,0,.22),
            inset 2px 2px 5px rgba(255,255,255,.025),
            inset -3px -5px 9px rgba(0,0,0,.26),
            inset 0 1px 0 rgba(255,255,255,.065);
          transition:
            transform .16s ease,
            border-color .16s ease,
            box-shadow .16s ease;
        }

        .tr-nextHero .tr-scheduleMuscle::before{
          content:"";
          position:absolute;
          left:8%;
          right:8%;
          top:0;
          height:1px;
          background:linear-gradient(90deg,transparent,rgba(255,255,255,.14),transparent);
          pointer-events:none;
        }

        .tr-nextHero .tr-scheduleMuscle:hover{
          transform:translateY(-2px);
          border-color:rgba(121,225,255,.31);
          box-shadow:
            0 14px 28px rgba(0,0,0,.26),
            0 6px 18px rgba(0,153,219,.07),
            inset 2px 2px 5px rgba(255,255,255,.03),
            inset -3px -5px 9px rgba(0,0,0,.28),
            inset 0 1px 0 rgba(255,255,255,.08);
        }

        .tr-nextHero .tr-scheduleMuscleIcon{
          width:36px;
          height:36px;
          flex:0 0 36px;
          border:1px solid rgba(99,214,255,.22);
          border-radius:11px;
          background:
            radial-gradient(circle at 50% 20%,rgba(82,211,255,.16),transparent 57%),
            linear-gradient(145deg,#123348,#071722);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.07),
            inset 0 -4px 8px rgba(0,0,0,.28),
            0 7px 16px rgba(0,0,0,.28);
        }

        .tr-nextHero .tr-scheduleMuscleIcon img{
          width:26px;
          height:26px;
          filter:
            drop-shadow(0 4px 6px rgba(0,0,0,.26))
            drop-shadow(0 0 7px rgba(54,197,255,.12));
        }

        .tr-nextHeroMetrics--two{
          position:relative;
          z-index:2;
          grid-template-columns:repeat(2,minmax(0,1fr));
          overflow:hidden;
          margin-top:1px;
          border:1px solid rgba(115,210,247,.085);
          border-left-color:rgba(115,210,247,.12);
          border-right-color:rgba(115,210,247,.12);
          border-radius:13px;
          background:
            linear-gradient(180deg,rgba(255,255,255,.026),rgba(0,0,0,.14));
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.035),
            inset 0 -5px 10px rgba(0,0,0,.18),
            0 9px 22px rgba(0,0,0,.11);
        }

        .tr-nextHeroMetrics--two::before{
          content:"";
          position:absolute;
          left:4%;
          right:4%;
          top:0;
          height:1px;
          background:linear-gradient(90deg,transparent,rgba(178,235,255,.18),transparent);
          pointer-events:none;
        }

        .tr-nextHeroMetrics--two .tr-nextMetric{
          min-height:64px;
          display:flex;
          flex-direction:column;
          align-items:center;
          justify-content:center;
          gap:6px;
          padding:12px 16px;
        }

        .tr-nextHeroMetrics--two .tr-nextMetric > span{
          color:rgba(165,193,210,.43);
          font-size:8px;
          line-height:1;
          font-weight:1000;
          letter-spacing:.18em;
        }

        .tr-nextHeroMetrics--two .tr-nextMetric strong{
          color:#f6fbff;
          font-size:13px;
          line-height:1.05;
          font-weight:1000;
          letter-spacing:.07em;
          text-shadow:0 5px 15px rgba(0,0,0,.26);
        }

        .tr-nextHeroMetrics--two .tr-nextMetric + .tr-nextMetric{
          border-left:1px solid rgba(118,213,248,.075);
        }

        .tr-nextHeroActions{
          position:relative;
          z-index:2;
          display:grid;
          grid-template-columns:minmax(0,1fr) 130px;
          gap:12px;
          margin-top:14px;
        }

        .tr-nextHeroActions .tr-scheduleBtn{
          min-height:50px;
          border-radius:13px;
        }

        .tr-nextHeroActions .tr-scheduleBtn--primary{
          position:relative;
          overflow:hidden;
          color:#03121a;
          border-color:rgba(174,238,255,.40);
          background:
            linear-gradient(180deg,#83e8ff 0%,#54d4ff 38%,#24acef 100%);
          box-shadow:
            0 3px 0 rgba(0,92,144,.28),
            0 12px 25px rgba(0,0,0,.18),
            0 17px 38px rgba(0,164,230,.21),
            inset 0 1px 0 rgba(255,255,255,.70),
            inset 0 -5px 9px rgba(0,91,145,.15);
          text-shadow:0 1px 0 rgba(255,255,255,.20);
          transition:
            transform .14s ease,
            box-shadow .14s ease,
            filter .14s ease;
        }

        .tr-nextHeroActions .tr-scheduleBtn--primary::before{
          content:"";
          position:absolute;
          left:6%;
          right:6%;
          top:0;
          height:1px;
          background:linear-gradient(90deg,transparent,rgba(255,255,255,.92),transparent);
          opacity:.78;
          pointer-events:none;
        }

        .tr-nextHeroActions .tr-scheduleBtn--primary:hover{
          transform:translateY(-2px);
          filter:saturate(1.05) brightness(1.03);
          box-shadow:
            0 3px 0 rgba(0,92,144,.26),
            0 15px 30px rgba(0,0,0,.20),
            0 22px 46px rgba(0,164,230,.27),
            inset 0 1px 0 rgba(255,255,255,.76),
            inset 0 -5px 9px rgba(0,91,145,.14);
        }

        .tr-nextHeroActions .tr-scheduleBtn--primary:active{
          transform:translateY(1px);
          box-shadow:
            0 1px 0 rgba(0,92,144,.24),
            0 7px 16px rgba(0,0,0,.18),
            0 10px 24px rgba(0,164,230,.15),
            inset 0 1px 0 rgba(255,255,255,.58);
        }

        .tr-nextHeroActions .tr-scheduleBtn--edit{
          border-color:rgba(119,200,233,.13);
          background:
            linear-gradient(145deg,rgba(255,255,255,.045),rgba(255,255,255,.012));
          box-shadow:
            inset 1px 1px 0 rgba(255,255,255,.035),
            inset -2px -3px 7px rgba(0,0,0,.18),
            0 8px 18px rgba(0,0,0,.14);
        }

        .tr-upcomingBoard{
          border-color:rgba(90,200,241,.13);
          background:
            radial-gradient(700px 250px at 100% -12%,rgba(38,158,210,.055),transparent 62%),
            linear-gradient(148deg,#0e1721 0%,#080d14 75%);
          box-shadow:
            0 2px 0 rgba(255,255,255,.018),
            0 20px 52px rgba(0,0,0,.31),
            0 8px 30px rgba(0,129,188,.035),
            inset 0 1px 0 rgba(255,255,255,.038),
            inset 0 -10px 22px rgba(0,0,0,.10);
        }

        .tr-sessionReadiness:empty{
          display:none;
        }

        .tr-sessionCard{
          position:relative;
          overflow:hidden;
          border:1px solid rgba(255,255,255,.075);
          border-top-color:rgba(137,218,248,.105);
          border-radius:15px;
          background:
            radial-gradient(390px 130px at 9% 0%,rgba(58,178,225,.055),transparent 66%),
            radial-gradient(320px 190px at 100% 100%,rgba(0,0,0,.26),transparent 76%),
            linear-gradient(145deg,#14202b 0%,#0b121a 58%,#070c12 100%);
          box-shadow:
            0 2px 0 rgba(255,255,255,.012),
            0 11px 25px rgba(0,0,0,.22),
            0 19px 44px rgba(0,0,0,.16),
            inset 0 1px 0 rgba(255,255,255,.045),
            inset 0 -7px 14px rgba(0,0,0,.13);
          transition:
            transform .16s ease,
            border-color .16s ease,
            box-shadow .16s ease,
            background .16s ease;
        }

        .tr-sessionCard::before{
          content:"";
          position:absolute;
          left:3%;
          right:36%;
          top:0;
          height:1px;
          background:linear-gradient(90deg,rgba(178,238,255,.24),rgba(83,203,247,.08),transparent);
          pointer-events:none;
        }

        .tr-sessionCard::after{
          content:"";
          position:absolute;
          width:300px;
          height:150px;
          left:-110px;
          top:-90px;
          border-radius:50%;
          background:radial-gradient(circle,rgba(75,201,247,.045),transparent 70%);
          pointer-events:none;
        }

        .tr-sessionCard:hover{
          transform:translateY(-2px);
          border-color:rgba(101,210,249,.18);
          border-top-color:rgba(154,229,255,.17);
          box-shadow:
            0 2px 0 rgba(255,255,255,.018),
            0 15px 32px rgba(0,0,0,.25),
            0 25px 55px rgba(0,0,0,.19),
            0 8px 26px rgba(0,146,210,.045),
            inset 0 1px 0 rgba(255,255,255,.055),
            inset 0 -7px 14px rgba(0,0,0,.14);
        }

        .tr-trainingTimelineRow .tr-timelineNode{
          border-color:rgba(89,209,255,.74);
          background:#071019;
          box-shadow:
            0 0 0 4px rgba(66,193,239,.028),
            0 0 11px rgba(66,193,239,.16);
        }

        .tr-trainingTimelineRow.is-ready .tr-timelineNode{
          border-color:#5ce3a0;
          box-shadow:
            0 0 0 4px rgba(92,227,160,.03),
            0 0 12px rgba(92,227,160,.19);
        }

        .tr-trainingTimelineRow.is-soon .tr-timelineNode,
        .tr-trainingTimelineRow.is-monitor .tr-timelineNode{
          border-color:#e5bd70;
          box-shadow:
            0 0 0 4px rgba(229,189,112,.026),
            0 0 10px rgba(229,189,112,.14);
        }

        .tr-sessionTitleRow h3{
          color:#f7fbfe;
          text-shadow:0 4px 14px rgba(0,0,0,.22);
        }

        .tr-sessionDate{
          color:rgba(202,231,245,.78);
        }

        .tr-sessionActions .tr-scheduleBtn--rowStart{
          position:relative;
          overflow:hidden;
          color:#07131b;
          border-color:rgba(118,214,250,.23);
          background:linear-gradient(180deg,#51cef7,#269fd7);
          box-shadow:
            0 2px 0 rgba(0,79,118,.22),
            0 8px 18px rgba(0,0,0,.16),
            0 8px 21px rgba(0,151,214,.10),
            inset 0 1px 0 rgba(255,255,255,.48),
            inset 0 -3px 6px rgba(0,74,112,.12);
        }

        .tr-sessionActions .tr-scheduleBtn--rowStart:hover{
          transform:translateY(-1px);
          border-color:rgba(143,226,255,.32);
          box-shadow:
            0 2px 0 rgba(0,79,118,.20),
            0 11px 22px rgba(0,0,0,.18),
            0 12px 27px rgba(0,151,214,.14),
            inset 0 1px 0 rgba(255,255,255,.54);
        }

        .tr-sessionActions .tr-scheduleBtn--rowEdit{
          border-color:rgba(117,192,223,.10);
          background:linear-gradient(145deg,rgba(255,255,255,.035),rgba(255,255,255,.009));
          box-shadow:
            inset 1px 1px 0 rgba(255,255,255,.025),
            inset -2px -2px 5px rgba(0,0,0,.15);
        }

        @media (max-width:680px){
          .tr-nextHero{
            padding:18px 16px 17px;
            border-radius:19px;
            background:
              radial-gradient(520px 250px at 7% 9%,rgba(55,200,255,.13),transparent 55%),
              radial-gradient(340px 230px at 105% 100%,rgba(0,0,0,.44),transparent 74%),
              linear-gradient(146deg,#111e2b,#071019 66%,#05090e);
            box-shadow:
              0 2px 0 rgba(255,255,255,.025),
              0 17px 42px rgba(0,0,0,.38),
              0 10px 32px rgba(0,145,215,.07),
              inset 0 1px 0 rgba(255,255,255,.07),
              inset 0 -12px 22px rgba(0,0,0,.19);
          }

          .tr-nextHeroTopline{
            align-items:flex-start;
            gap:10px;
          }

          .tr-heroReadinessInline{
            max-width:54%;
            padding-left:10px;
            font-size:8.5px;
            letter-spacing:.07em;
            white-space:normal;
            text-align:right;
            justify-content:flex-end;
          }

          .tr-heroReadinessLine{
            left:auto;
            right:-1px;
          }

          .tr-heroIdentityStage{
            min-height:0;
            padding:16px 0 18px;
          }

          .tr-heroIdentityStage::before{
            width:360px;
            height:200px;
            left:-110px;
            top:-50px;
          }

          .tr-nextHeroCopy h1{
            font-size:clamp(39px,13.2vw,55px);
            line-height:.91;
          }

          .tr-nextHeroProgram{
            margin-top:9px;
            font-size:12.5px;
          }

          .tr-nextHero .tr-scheduleMuscles{
            display:flex;
            flex-wrap:wrap;
            gap:7px;
            margin-top:16px;
          }

          .tr-nextHero .tr-scheduleMuscle{
            min-height:39px;
            padding:4px 9px 4px 5px;
            border-radius:11px;
          }

          .tr-nextHero .tr-scheduleMuscleIcon{
            width:29px;
            height:29px;
            flex-basis:29px;
            border-radius:9px;
          }

          .tr-nextHero .tr-scheduleMuscleIcon img{
            width:21px;
            height:21px;
          }

          .tr-nextHeroMetrics--two{
            border-radius:11px;
          }

          .tr-nextHeroMetrics--two .tr-nextMetric{
            min-height:56px;
            padding:10px 6px;
          }

          .tr-nextHeroMetrics--two .tr-nextMetric > span{
            font-size:7px;
            letter-spacing:.14em;
          }

          .tr-nextHeroMetrics--two .tr-nextMetric strong{
            font-size:10.5px;
            letter-spacing:.04em;
          }

          .tr-nextHeroActions{
            grid-template-columns:1fr;
            gap:8px;
            margin-top:11px;
          }

          .tr-nextHeroActions .tr-scheduleBtn{
            min-height:47px;
          }

          .tr-sessionCard{
            padding:14px 13px;
            border-radius:14px;
            background:
              radial-gradient(280px 115px at 8% 0%,rgba(58,178,225,.045),transparent 66%),
              linear-gradient(148deg,#111b25,#080e15 68%);
            box-shadow:
              0 2px 0 rgba(255,255,255,.01),
              0 10px 24px rgba(0,0,0,.20),
              inset 0 1px 0 rgba(255,255,255,.035),
              inset 0 -5px 11px rgba(0,0,0,.10);
          }

          .tr-sessionCard:hover{
            transform:none;
          }

          .tr-sessionRight{
            gap:10px;
          }
        }

        @media (prefers-reduced-motion:reduce){
          .tr-nextHero .tr-scheduleMuscle,
          .tr-sessionCard,
          .tr-scheduleBtn{
            transition:none !important;
          }
        }


        /* STEP 6F: executive-grade planner material system.
           Crisp shading and real surface depth, no cloudy glows or halo shadows. */

        .tr-nextHero{
          position:relative;
          isolation:isolate;
          overflow:hidden;
          padding:18px 18px 16px;
          border:1px solid rgba(120,205,235,.24);
          border-top-color:rgba(161,226,248,.34);
          border-radius:17px;
          background:
            linear-gradient(180deg,#121d27 0%,#0d161f 42%,#091018 100%);
          box-shadow:
            0 1px 0 rgba(255,255,255,.035),
            0 8px 18px rgba(0,0,0,.28),
            0 18px 34px rgba(0,0,0,.16),
            inset 0 1px 0 rgba(255,255,255,.075),
            inset 0 -1px 0 rgba(0,0,0,.78),
            inset 0 -16px 28px rgba(0,0,0,.10);
        }

        .tr-nextHero::before{
          content:"";
          position:absolute;
          z-index:0;
          left:0;
          top:15px;
          bottom:15px;
          width:3px;
          border-radius:0 2px 2px 0;
          background:linear-gradient(180deg,#83e0ff 0%,#2eaddd 58%,#146483 100%);
          box-shadow:none;
        }

        .tr-nextHero::after{
          content:"";
          position:absolute;
          z-index:0;
          left:18px;
          right:18px;
          top:0;
          height:1px;
          pointer-events:none;
          background:linear-gradient(
            90deg,
            transparent 0%,
            rgba(220,248,255,.40) 18%,
            rgba(144,224,250,.18) 58%,
            transparent 100%
          );
          box-shadow:none;
        }

        .tr-nextHeroTopline{
          position:relative;
          z-index:2;
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:16px;
          min-width:0;
          padding:0 1px 6px;
        }

        .tr-heroReadinessInline{
          position:relative;
          display:flex;
          align-items:center;
          gap:7px;
          min-width:0;
          padding-left:10px;
          color:#9ed8ee;
          font-size:9px;
          line-height:1;
          font-weight:1000;
          letter-spacing:.09em;
          white-space:nowrap;
        }

        .tr-heroReadinessLine{
          position:absolute;
          left:0;
          top:-2px;
          bottom:-2px;
          width:2px;
          border-radius:999px;
          background:#50c9f0;
          box-shadow:none;
        }

        .tr-heroReadinessDot{
          width:6px;
          height:6px;
          flex:0 0 6px;
          border-radius:50%;
          background:#50c9f0;
          box-shadow:0 0 6px rgba(80,201,240,.32);
        }

        .tr-heroReadinessInline.is-ready{
          color:#8debb5;
        }

        .tr-heroReadinessInline.is-ready .tr-heroReadinessLine,
        .tr-heroReadinessInline.is-ready .tr-heroReadinessDot{
          background:#52d98e;
          box-shadow:0 0 6px rgba(82,217,142,.30);
        }

        .tr-heroReadinessInline.is-soon,
        .tr-heroReadinessInline.is-monitor{
          color:#e8c987;
        }

        .tr-heroReadinessInline.is-soon .tr-heroReadinessLine,
        .tr-heroReadinessInline.is-soon .tr-heroReadinessDot,
        .tr-heroReadinessInline.is-monitor .tr-heroReadinessLine,
        .tr-heroReadinessInline.is-monitor .tr-heroReadinessDot{
          background:#ddb96d;
          box-shadow:0 0 5px rgba(221,185,109,.24);
        }

        .tr-heroReadinessInline.is-recovering{
          color:#efbd78;
        }

        .tr-heroReadinessInline.is-recovering .tr-heroReadinessLine,
        .tr-heroReadinessInline.is-recovering .tr-heroReadinessDot{
          background:#e8ad63;
          box-shadow:0 0 5px rgba(232,173,99,.22);
        }

        .tr-nextHeroCompact{
          position:relative;
          z-index:1;
          display:grid;
          grid-template-columns:minmax(0,1fr) 248px;
          align-items:center;
          gap:26px;
          min-height:126px;
          padding:8px 2px 12px;
        }

        .tr-nextHeroCompact::before{
          content:"";
          position:absolute;
          z-index:-1;
          left:0;
          right:0;
          bottom:0;
          height:1px;
          background:linear-gradient(
            90deg,
            transparent,
            rgba(112,194,224,.14) 15%,
            rgba(112,194,224,.07) 72%,
            transparent
          );
        }

        .tr-nextHeroCompact.is-active{
          grid-template-columns:1fr;
        }

        .tr-nextHeroCopy{
          min-width:0;
          align-self:center;
        }

        .tr-nextHeroCopy h1{
          max-width:760px;
          margin:0;
          color:#fbfdff;
          font-size:clamp(44px,4.75vw,62px);
          line-height:.92;
          font-weight:1000;
          letter-spacing:-.055em;
          text-shadow:
            0 1px 0 rgba(255,255,255,.025),
            0 5px 12px rgba(0,0,0,.28);
        }

        .tr-nextHeroProgram{
          margin-top:8px;
          color:rgba(220,234,243,.64);
          font-size:13px;
          line-height:1.2;
          font-weight:900;
          letter-spacing:.02em;
        }

        .tr-nextHero .tr-scheduleMuscles{
          display:flex;
          flex-wrap:wrap;
          gap:9px;
          margin-top:16px;
        }

        .tr-nextHero .tr-scheduleMuscle{
          position:relative;
          overflow:hidden;
          min-height:38px;
          padding:4px 10px 4px 5px;
          gap:7px;
          border:1px solid rgba(114,200,231,.14);
          border-top-color:rgba(145,220,246,.20);
          border-radius:10px;
          background:linear-gradient(180deg,#10202b 0%,#0a151e 100%);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.040),
            inset 0 -1px 0 rgba(0,0,0,.68),
            0 3px 7px rgba(0,0,0,.18);
          transition:
            transform .14s ease,
            border-color .14s ease,
            background .14s ease;
        }

        .tr-nextHero .tr-scheduleMuscle::before{
          content:"";
          position:absolute;
          left:6px;
          right:6px;
          top:0;
          height:1px;
          background:linear-gradient(90deg,transparent,rgba(255,255,255,.10),transparent);
          pointer-events:none;
        }

        .tr-nextHero .tr-scheduleMuscle:hover{
          transform:translateY(-1px);
          border-color:rgba(127,213,243,.24);
          background:linear-gradient(180deg,#122430 0%,#0a161f 100%);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.050),
            inset 0 -1px 0 rgba(0,0,0,.70),
            0 4px 9px rgba(0,0,0,.20);
        }

        .tr-nextHero .tr-scheduleMuscleIcon{
          width:29px;
          height:29px;
          flex:0 0 29px;
          border:1px solid rgba(96,198,235,.17);
          border-radius:8px;
          background:linear-gradient(180deg,#123042 0%,#0a1c27 100%);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.05),
            inset 0 -2px 4px rgba(0,0,0,.28);
        }

        .tr-nextHero .tr-scheduleMuscleIcon img{
          width:22px;
          height:22px;
          filter:drop-shadow(0 2px 3px rgba(0,0,0,.22));
        }

        .tr-nextHeroQuickStats{
          display:grid;
          grid-template-columns:repeat(2,minmax(0,1fr));
          align-items:stretch;
          min-width:0;
          border-left:1px solid rgba(119,198,228,.12);
          background:transparent;
        }

        .tr-nextHeroQuickStat{
          min-width:0;
          display:flex;
          flex-direction:column;
          align-items:flex-start;
          justify-content:center;
          gap:5px;
          min-height:78px;
          padding:10px 20px;
        }

        .tr-nextHeroQuickStat + .tr-nextHeroQuickStat{
          border-left:1px solid rgba(119,198,228,.09);
        }

        .tr-nextHeroQuickStat strong{
          color:#f7fbfd;
          font-size:27px;
          line-height:1;
          font-weight:1000;
          letter-spacing:-.035em;
          text-shadow:0 3px 8px rgba(0,0,0,.24);
        }

        .tr-nextHeroQuickStat span{
          color:rgba(168,193,208,.48);
          font-size:8px;
          line-height:1;
          font-weight:1000;
          letter-spacing:.16em;
        }

        .tr-nextHeroActions{
          position:relative;
          z-index:2;
          display:grid;
          grid-template-columns:minmax(0,1fr) 112px;
          gap:10px;
          margin-top:12px;
        }

        .tr-nextHeroActions .tr-scheduleBtn{
          min-height:46px;
          border-radius:10px;
        }

        .tr-scheduleBtn--primary{
          position:relative;
          overflow:hidden;
          color:#f5fbff;
          border:1px solid rgba(93,194,229,.52);
          border-top-color:rgba(153,226,250,.64);
          background:
            linear-gradient(180deg,#257fa3 0%,#1b6f92 50%,#135b7b 100%);
          box-shadow:
            0 1px 0 rgba(255,255,255,.045),
            0 4px 9px rgba(0,0,0,.28),
            inset 0 1px 0 rgba(255,255,255,.18),
            inset 0 -2px 0 rgba(5,47,66,.36);
          text-shadow:0 1px 2px rgba(0,0,0,.34);
          transition:
            transform .12s ease,
            border-color .12s ease,
            background .12s ease,
            box-shadow .12s ease;
        }

        .tr-scheduleBtn--primary::before,
        .tr-scheduleBtn--rowStart::before{
          content:"";
          position:absolute;
          left:8%;
          right:8%;
          top:0;
          height:1px;
          background:linear-gradient(90deg,transparent,rgba(255,255,255,.38),transparent);
          pointer-events:none;
        }

        .tr-scheduleBtn--primary::after,
        .tr-scheduleBtn--rowStart::after{
          display:none;
        }

        .tr-scheduleBtn--primary:hover{
          transform:translateY(-1px);
          border-color:rgba(125,216,247,.62);
          background:
            linear-gradient(180deg,#2a8caf 0%,#20799c 50%,#166383 100%);
          box-shadow:
            0 1px 0 rgba(255,255,255,.05),
            0 5px 11px rgba(0,0,0,.30),
            inset 0 1px 0 rgba(255,255,255,.20),
            inset 0 -2px 0 rgba(5,47,66,.34);
        }

        .tr-scheduleBtn--primary:active{
          transform:translateY(1px);
          box-shadow:
            0 1px 3px rgba(0,0,0,.28),
            inset 0 2px 4px rgba(0,0,0,.18),
            inset 0 1px 0 rgba(255,255,255,.08);
        }

        .tr-scheduleBtn--edit,
        .tr-scheduleBtn--rowEdit{
          color:rgba(238,246,250,.82);
          border:1px solid rgba(120,181,204,.13);
          border-top-color:rgba(149,203,224,.18);
          background:linear-gradient(180deg,#121a21 0%,#0b1117 100%);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.035),
            inset 0 -1px 0 rgba(0,0,0,.72),
            0 3px 7px rgba(0,0,0,.18);
        }

        .tr-scheduleBtn--edit:hover,
        .tr-scheduleBtn--rowEdit:hover{
          border-color:rgba(126,202,231,.22);
          background:linear-gradient(180deg,#15212a 0%,#0c141b 100%);
        }

        .tr-upcomingBoard{
          position:relative;
          overflow:hidden;
          border:1px solid rgba(111,185,213,.11);
          border-top-color:rgba(139,205,229,.16);
          border-radius:16px;
          background:linear-gradient(180deg,#0d151d 0%,#090f15 100%);
          box-shadow:
            0 1px 0 rgba(255,255,255,.020),
            0 8px 18px rgba(0,0,0,.24),
            inset 0 1px 0 rgba(255,255,255,.030),
            inset 0 -1px 0 rgba(0,0,0,.68);
        }

        .tr-upcomingBoard::before{
          content:"";
          position:absolute;
          left:18px;
          right:18px;
          top:0;
          height:1px;
          background:linear-gradient(90deg,transparent,rgba(185,231,248,.16),transparent);
          pointer-events:none;
        }

        .tr-trainingTimeline{
          gap:9px;
        }

        .tr-trainingTimelineRow{
          position:relative;
        }

        .tr-timelineNode{
          width:7px;
          height:7px;
          border:1px solid rgba(216,182,103,.86);
          background:#0b1116;
          box-shadow:inset 0 0 0 1px rgba(216,182,103,.14);
        }

        .tr-trainingTimelineRow.is-ready .tr-timelineNode{
          border-color:#5dd897;
          box-shadow:inset 0 0 0 1px rgba(93,216,151,.14);
        }

        .tr-trainingTimelineRow.is-soon .tr-timelineNode,
        .tr-trainingTimelineRow.is-monitor .tr-timelineNode{
          border-color:#d5b36c;
          box-shadow:inset 0 0 0 1px rgba(213,179,108,.14);
        }

        .tr-timelineLine{
          width:1px;
          background:rgba(126,177,198,.09);
        }

        .tr-sessionCard{
          position:relative;
          overflow:hidden;
          border:1px solid rgba(255,255,255,.060);
          border-top-color:rgba(143,203,225,.10);
          border-radius:13px;
          background:linear-gradient(180deg,#111922 0%,#0b1118 100%);
          box-shadow:
            0 1px 0 rgba(255,255,255,.012),
            0 6px 13px rgba(0,0,0,.22),
            inset 0 1px 0 rgba(255,255,255,.030),
            inset 0 -1px 0 rgba(0,0,0,.66);
          transition:
            transform .14s ease,
            border-color .14s ease,
            background .14s ease,
            box-shadow .14s ease;
        }

        .tr-sessionCard::before{
          content:"";
          position:absolute;
          left:14px;
          right:36%;
          top:0;
          height:1px;
          background:linear-gradient(90deg,rgba(183,231,247,.12),transparent);
          pointer-events:none;
        }

        .tr-sessionCard::after{
          display:none;
        }

        .tr-sessionCard:hover{
          transform:translateY(-1px);
          border-color:rgba(115,196,225,.13);
          border-top-color:rgba(158,215,236,.15);
          background:linear-gradient(180deg,#131c25 0%,#0c131a 100%);
          box-shadow:
            0 1px 0 rgba(255,255,255,.015),
            0 7px 15px rgba(0,0,0,.24),
            inset 0 1px 0 rgba(255,255,255,.035),
            inset 0 -1px 0 rgba(0,0,0,.67);
        }

        .tr-sessionTitleRow h3{
          color:#f7fafc;
          text-shadow:0 2px 4px rgba(0,0,0,.20);
        }

        .tr-sessionTitleRow p,
        .tr-sessionMeta{
          color:rgba(190,208,220,.45);
        }

        .tr-sessionDate{
          color:rgba(207,231,241,.74);
        }

        .tr-scheduleMuscles.is-compact .tr-scheduleMuscle{
          border-radius:8px;
          background:transparent;
          box-shadow:none;
        }

        .tr-scheduleMuscles.is-compact .tr-scheduleMuscleIcon{
          border:1px solid rgba(108,193,226,.11);
          border-radius:7px;
          background:linear-gradient(180deg,#102633,#0a1922);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.030),
            inset 0 -1px 0 rgba(0,0,0,.52);
        }

        .tr-sessionActions .tr-scheduleBtn--rowStart{
          position:relative;
          overflow:hidden;
          color:#eff9fd;
          border:1px solid rgba(91,185,220,.40);
          border-top-color:rgba(135,213,240,.48);
          background:linear-gradient(180deg,#216f90 0%,#175d7b 100%);
          box-shadow:
            0 3px 7px rgba(0,0,0,.22),
            inset 0 1px 0 rgba(255,255,255,.12),
            inset 0 -1px 0 rgba(0,0,0,.36);
          text-shadow:0 1px 2px rgba(0,0,0,.28);
        }

        .tr-sessionActions .tr-scheduleBtn--rowStart:hover{
          transform:translateY(-1px);
          border-color:rgba(121,208,239,.48);
          background:linear-gradient(180deg,#267d9e 0%,#196483 100%);
          box-shadow:
            0 4px 9px rgba(0,0,0,.24),
            inset 0 1px 0 rgba(255,255,255,.14),
            inset 0 -1px 0 rgba(0,0,0,.34);
        }

        .tr-sessionReadiness:empty{
          display:none;
        }

        @media (hover:hover) and (pointer:fine){
          .tr-sessionCard:hover .tr-scheduleMuscleIcon{
            border-color:rgba(112,202,235,.15);
          }
        }

        @media (max-width:680px){
          .tr-nextHero{
            padding:15px 14px 14px;
            border-radius:15px;
            background:linear-gradient(180deg,#111c26 0%,#0b131b 46%,#080e14 100%);
            box-shadow:
              0 1px 0 rgba(255,255,255,.025),
              0 7px 16px rgba(0,0,0,.27),
              inset 0 1px 0 rgba(255,255,255,.055),
              inset 0 -1px 0 rgba(0,0,0,.72);
          }

          .tr-nextHeroTopline{
            align-items:flex-start;
            gap:8px;
          }

          .tr-heroReadinessInline{
            max-width:58%;
            padding-left:9px;
            font-size:8px;
            letter-spacing:.06em;
            white-space:normal;
            text-align:right;
            justify-content:flex-end;
          }

          .tr-nextHeroCompact{
            grid-template-columns:1fr;
            gap:12px;
            min-height:0;
            padding:12px 1px 12px;
          }

          .tr-nextHeroCopy h1{
            font-size:clamp(38px,12.5vw,50px);
            line-height:.92;
          }

          .tr-nextHeroProgram{
            margin-top:7px;
            font-size:12px;
          }

          .tr-nextHero .tr-scheduleMuscles{
            gap:6px;
            margin-top:13px;
          }

          .tr-nextHero .tr-scheduleMuscle{
            min-height:35px;
            padding:3px 8px 3px 4px;
            border-radius:9px;
          }

          .tr-nextHero .tr-scheduleMuscleIcon{
            width:27px;
            height:27px;
            flex-basis:27px;
          }

          .tr-nextHero .tr-scheduleMuscleIcon img{
            width:20px;
            height:20px;
          }

          .tr-nextHeroQuickStats{
            grid-template-columns:repeat(2,minmax(0,1fr));
            border-left:0;
            border-top:1px solid rgba(121,198,227,.10);
          }

          .tr-nextHeroQuickStat{
            min-height:53px;
            align-items:center;
            padding:10px 8px 5px;
          }

          .tr-nextHeroQuickStat strong{
            font-size:21px;
          }

          .tr-nextHeroQuickStat span{
            font-size:7px;
            letter-spacing:.13em;
          }

          .tr-nextHeroActions{
            grid-template-columns:minmax(0,1fr) 84px;
            gap:8px;
            margin-top:9px;
          }

          .tr-nextHeroActions .tr-scheduleBtn{
            min-height:44px;
            border-radius:9px;
          }

          .tr-upcomingBoard{
            border-radius:14px;
            background:linear-gradient(180deg,#0d151c 0%,#080e14 100%);
            box-shadow:
              0 1px 0 rgba(255,255,255,.015),
              0 7px 15px rgba(0,0,0,.22),
              inset 0 1px 0 rgba(255,255,255,.025);
          }

          .tr-sessionCard{
            padding:13px 12px;
            border-radius:12px;
            background:linear-gradient(180deg,#101821 0%,#0a1118 100%);
            box-shadow:
              0 1px 0 rgba(255,255,255,.01),
              0 5px 11px rgba(0,0,0,.20),
              inset 0 1px 0 rgba(255,255,255,.025),
              inset 0 -1px 0 rgba(0,0,0,.62);
          }

          .tr-sessionCard:hover{
            transform:none;
          }

          .tr-sessionRight{
            gap:9px;
          }
        }

        @media (prefers-reduced-motion:reduce){
          .tr-nextHero .tr-scheduleMuscle,
          .tr-sessionCard,
          .tr-scheduleBtn{
            transition:none !important;
          }
        }


        /* STEP 6G: FLAGSHIP PERFORMANCE COCKPIT
           Precise layered materials, instrument-like controls, deeper
           contact rendering and advisory scheduling. This block is the
           final visual authority for the Workouts planner. */

        .tr-trainingBoard{
          --tr-surface-0:#05090d;
          --tr-surface-1:#081018;
          --tr-surface-2:#0d1720;
          --tr-surface-3:#121f29;
          --tr-edge:rgba(151,218,241,.16);
          --tr-edge-hot:rgba(180,235,253,.31);
          --tr-cyan:#43bee9;
          --tr-cyan-hi:#79d9f7;
          --tr-green:#63dfa0;
          --tr-amber:#e3bd72;
        }

        .tr-nextHero{
          position:relative;
          isolation:isolate;
          overflow:hidden;
          padding:17px 18px 15px;
          border:1px solid rgba(138,210,236,.23);
          border-top-color:rgba(193,239,255,.36);
          border-bottom-color:rgba(54,95,112,.24);
          border-radius:18px;
          background:
            repeating-linear-gradient(
              90deg,
              rgba(255,255,255,.006) 0,
              rgba(255,255,255,.006) 1px,
              transparent 1px,
              transparent 5px
            ),
            linear-gradient(180deg,#14222d 0%,#0e1821 42%,#091117 100%);
          background-blend-mode:soft-light,normal;
          box-shadow:
            0 1px 0 rgba(255,255,255,.055),
            0 2px 3px rgba(0,0,0,.44),
            0 10px 22px rgba(0,0,0,.31),
            0 26px 54px rgba(0,0,0,.18),
            inset 0 1px 0 rgba(255,255,255,.085),
            inset 0 -1px 0 rgba(0,0,0,.92),
            inset 1px 0 0 rgba(255,255,255,.018),
            inset -1px 0 0 rgba(0,0,0,.36);
        }

        .tr-nextHero::before{
          content:"";
          position:absolute;
          z-index:0;
          inset:0;
          pointer-events:none;
          border-radius:inherit;
          background:
            linear-gradient(
              90deg,
              rgba(91,205,244,.095) 0,
              rgba(91,205,244,.025) 9%,
              transparent 22%
            ),
            linear-gradient(
              180deg,
              rgba(255,255,255,.042) 0,
              transparent 12%,
              transparent 83%,
              rgba(0,0,0,.13) 100%
            );
          box-shadow:
            inset 4px 0 0 rgba(75,195,236,.54),
            inset 6px 0 0 rgba(20,79,101,.28);
        }

        .tr-nextHero::after{
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
            transparent 0%,
            rgba(226,249,255,.52) 14%,
            rgba(118,215,247,.34) 42%,
            rgba(118,215,247,.08) 78%,
            transparent 100%
          );
          filter:drop-shadow(0 1px 0 rgba(48,143,177,.22));
        }

        .tr-nextHeroTopline,
        .tr-nextHeroCompact,
        .tr-nextHeroActions{
          position:relative;
          z-index:3;
        }

        .tr-nextHeroTopline{
          padding:0 2px 7px 7px;
        }

        .tr-trainingSectionEyebrow{
          color:rgba(119,211,244,.84);
          font-weight:1000;
          letter-spacing:.17em;
        }

        .tr-heroReadinessInline{
          padding:7px 10px 7px 12px;
          gap:7px;
          border:1px solid rgba(102,217,157,.11);
          border-top-color:rgba(127,235,179,.16);
          border-radius:8px;
          background:
            linear-gradient(180deg,rgba(20,45,37,.56),rgba(8,25,22,.34));
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.03),
            inset 0 -1px 0 rgba(0,0,0,.48);
        }

        .tr-heroReadinessLine{
          display:none;
        }

        .tr-heroReadinessDot{
          width:6px;
          height:6px;
          flex-basis:6px;
          background:var(--tr-green);
          box-shadow:
            0 0 0 2px rgba(99,223,160,.08),
            0 0 8px rgba(99,223,160,.24);
        }

        .tr-heroReadinessInline.is-recovering{
          color:#efc383;
          border-color:rgba(227,189,114,.16);
          background:linear-gradient(180deg,rgba(47,38,21,.54),rgba(25,20,12,.33));
        }

        .tr-heroReadinessInline.is-recovering .tr-heroReadinessDot{
          background:var(--tr-amber);
          box-shadow:
            0 0 0 2px rgba(227,189,114,.08),
            0 0 7px rgba(227,189,114,.20);
        }

        .tr-nextHeroCompact{
          grid-template-columns:minmax(0,1fr) 232px;
          gap:23px;
          min-height:116px;
          padding:8px 3px 11px 8px;
        }

        .tr-nextHeroCompact::before{
          left:8px;
          right:0;
          background:linear-gradient(
            90deg,
            rgba(126,208,237,.16),
            rgba(126,208,237,.055) 70%,
            transparent
          );
        }

        .tr-nextHeroCopy h1{
          margin:0;
          color:#f8fcff;
          font-size:clamp(45px,4.65vw,61px);
          line-height:.91;
          font-weight:1000;
          letter-spacing:-.058em;
          text-shadow:
            0 1px 0 rgba(255,255,255,.045),
            0 3px 3px rgba(0,0,0,.38),
            0 9px 19px rgba(0,0,0,.19);
        }

        .tr-nextHeroProgram{
          margin-top:8px;
          color:rgba(207,225,235,.61);
          font-size:12px;
          font-weight:900;
          letter-spacing:.025em;
        }

        .tr-nextHero .tr-scheduleMuscles{
          gap:7px;
          margin-top:14px;
        }

        .tr-nextHero .tr-scheduleMuscle{
          min-height:36px;
          padding:3px 9px 3px 4px;
          gap:6px;
          border:1px solid rgba(119,196,224,.13);
          border-top-color:rgba(166,222,242,.19);
          border-bottom-color:rgba(42,80,96,.27);
          border-radius:9px;
          color:rgba(222,236,243,.78);
          background:
            linear-gradient(180deg,#11232f 0%,#0a1720 100%);
          box-shadow:
            0 1px 1px rgba(0,0,0,.45),
            0 3px 7px rgba(0,0,0,.17),
            inset 0 1px 0 rgba(255,255,255,.045),
            inset 0 -2px 3px rgba(0,0,0,.30);
        }

        .tr-nextHero .tr-scheduleMuscle::before{
          left:8px;
          right:8px;
          background:linear-gradient(
            90deg,
            transparent,
            rgba(206,244,255,.11),
            transparent
          );
        }

        .tr-nextHero .tr-scheduleMuscleIcon{
          width:28px;
          height:28px;
          flex-basis:28px;
          border:1px solid rgba(96,200,236,.16);
          border-top-color:rgba(151,225,249,.21);
          border-radius:7px;
          background:
            linear-gradient(180deg,#143448 0%,#0a202c 100%);
          box-shadow:
            0 1px 1px rgba(0,0,0,.38),
            inset 0 1px 0 rgba(255,255,255,.055),
            inset 0 -3px 5px rgba(0,0,0,.27);
        }

        .tr-nextHeroQuickStats{
          overflow:hidden;
          align-self:center;
          border:1px solid rgba(124,194,220,.10);
          border-top-color:rgba(169,221,240,.15);
          border-radius:11px;
          background:
            linear-gradient(180deg,rgba(8,18,25,.72),rgba(5,11,16,.54));
          box-shadow:
            0 1px 2px rgba(0,0,0,.45),
            inset 0 2px 5px rgba(0,0,0,.34),
            inset 0 1px 0 rgba(255,255,255,.025),
            inset 0 -1px 0 rgba(255,255,255,.014);
        }

        .tr-nextHeroQuickStat{
          min-height:72px;
          padding:11px 17px;
          align-items:center;
          text-align:center;
        }

        .tr-nextHeroQuickStat + .tr-nextHeroQuickStat{
          border-left:1px solid rgba(122,198,226,.09);
        }

        .tr-nextHeroQuickStat strong{
          color:#f6fbfd;
          font-size:26px;
          text-shadow:
            0 1px 0 rgba(255,255,255,.035),
            0 3px 7px rgba(0,0,0,.34);
        }

        .tr-nextHeroQuickStat span{
          color:rgba(157,189,205,.51);
          font-size:7px;
          letter-spacing:.15em;
        }

        .tr-nextHeroActions{
          grid-template-columns:minmax(0,1fr) 106px;
          gap:9px;
          margin-top:10px;
          padding-left:7px;
        }

        .tr-nextHeroActions .tr-scheduleBtn{
          min-height:45px;
          border-radius:10px;
        }

        .tr-scheduleBtn--primary{
          display:flex;
          align-items:center;
          justify-content:center;
          gap:9px;
          border:1px solid rgba(113,210,243,.57);
          border-top-color:rgba(190,239,255,.72);
          border-bottom-color:rgba(16,80,105,.76);
          color:#f7fcff;
          background:
            linear-gradient(180deg,#2b91b7 0%,#217da0 42%,#16617f 100%);
          box-shadow:
            0 1px 0 rgba(255,255,255,.06),
            0 2px 2px rgba(0,0,0,.45),
            0 6px 12px rgba(0,0,0,.27),
            inset 0 1px 0 rgba(255,255,255,.23),
            inset 0 -1px 0 rgba(0,0,0,.38),
            inset 0 -5px 9px rgba(7,62,82,.18);
          text-shadow:
            0 1px 1px rgba(0,0,0,.42),
            0 2px 5px rgba(0,0,0,.18);
        }

        .tr-scheduleBtn--primary::before{
          left:12%;
          right:12%;
          background:linear-gradient(
            90deg,
            transparent,
            rgba(255,255,255,.53),
            transparent
          );
        }

        .tr-primaryActionGlyph{
          display:grid;
          place-items:center;
          width:22px;
          height:22px;
          padding-left:1px;
          border:1px solid rgba(225,249,255,.24);
          border-radius:50%;
          color:#f8fdff;
          background:
            linear-gradient(180deg,rgba(255,255,255,.13),rgba(0,0,0,.08));
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.13),
            0 1px 2px rgba(0,0,0,.24);
          font-size:8px;
        }

        .tr-scheduleBtn--primary:hover{
          transform:translateY(-1px);
          border-color:rgba(139,221,249,.70);
          border-top-color:rgba(214,248,255,.79);
          background:
            linear-gradient(180deg,#329ac0 0%,#2584a8 43%,#196987 100%);
          box-shadow:
            0 1px 0 rgba(255,255,255,.07),
            0 2px 2px rgba(0,0,0,.42),
            0 8px 15px rgba(0,0,0,.29),
            inset 0 1px 0 rgba(255,255,255,.25),
            inset 0 -1px 0 rgba(0,0,0,.37),
            inset 0 -5px 9px rgba(7,62,82,.15);
        }

        .tr-scheduleBtn--primary:active{
          transform:translateY(1px);
          background:
            linear-gradient(180deg,#1d718f 0%,#1b6d8b 48%,#145b76 100%);
          box-shadow:
            0 1px 1px rgba(0,0,0,.33),
            inset 0 2px 5px rgba(0,0,0,.25),
            inset 0 1px 0 rgba(255,255,255,.09);
        }

        .tr-scheduleBtn--edit,
        .tr-scheduleBtn--rowEdit{
          border:1px solid rgba(132,184,204,.12);
          border-top-color:rgba(182,220,234,.17);
          border-bottom-color:rgba(29,53,64,.34);
          color:rgba(225,237,243,.75);
          background:
            linear-gradient(180deg,#131d25 0%,#0a1117 100%);
          box-shadow:
            0 1px 1px rgba(0,0,0,.42),
            inset 0 1px 0 rgba(255,255,255,.038),
            inset 0 -2px 3px rgba(0,0,0,.30);
        }

        .tr-scheduleBtn--edit:hover,
        .tr-scheduleBtn--rowEdit:hover{
          border-color:rgba(130,208,237,.22);
          color:#eef7fb;
          background:linear-gradient(180deg,#17252f 0%,#0b151c 100%);
        }

        .tr-upcomingBoard{
          position:relative;
          overflow:hidden;
          margin-top:13px;
          padding:0;
          border:1px solid rgba(124,188,211,.105);
          border-top-color:rgba(173,220,237,.15);
          border-bottom-color:rgba(37,65,77,.22);
          border-radius:17px;
          background:
            repeating-linear-gradient(
              0deg,
              rgba(255,255,255,.004) 0,
              rgba(255,255,255,.004) 1px,
              transparent 1px,
              transparent 5px
            ),
            linear-gradient(180deg,#0d161e 0%,#080e14 100%);
          background-blend-mode:soft-light,normal;
          box-shadow:
            0 1px 0 rgba(255,255,255,.02),
            0 2px 3px rgba(0,0,0,.36),
            0 12px 28px rgba(0,0,0,.20),
            inset 0 1px 0 rgba(255,255,255,.028),
            inset 0 -1px 0 rgba(0,0,0,.72);
        }

        .tr-upcomingBoard::before{
          left:20px;
          right:20px;
          background:linear-gradient(
            90deg,
            transparent,
            rgba(187,232,248,.18) 18%,
            rgba(187,232,248,.055) 72%,
            transparent
          );
        }

        .tr-upcomingHeader{
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:12px;
          min-height:45px;
          padding:0 16px;
          border-bottom:1px solid rgba(131,190,211,.075);
          background:linear-gradient(180deg,rgba(255,255,255,.012),rgba(0,0,0,.035));
        }

        .tr-upcomingAdvisory{
          color:rgba(154,185,200,.42);
          font-size:7px;
          line-height:1;
          font-weight:1000;
          letter-spacing:.16em;
          white-space:nowrap;
        }

        .tr-trainingTimeline{
          gap:8px;
          padding:11px 12px 13px;
        }

        .tr-trainingTimelineRow{
          grid-template-columns:20px minmax(0,1fr);
        }

        .tr-timelineRail{
          width:20px;
        }

        .tr-timelineNode{
          width:8px;
          height:8px;
          border:1px solid rgba(127,200,226,.28);
          background:
            linear-gradient(180deg,#13232d,#081118);
          box-shadow:
            0 1px 2px rgba(0,0,0,.45),
            inset 0 1px 0 rgba(255,255,255,.05);
        }

        .tr-trainingTimelineRow.is-ready .tr-timelineNode{
          border-color:rgba(100,212,157,.42);
          background:linear-gradient(180deg,#173229,#0a1c17);
          box-shadow:
            0 1px 2px rgba(0,0,0,.42),
            inset 0 1px 0 rgba(255,255,255,.045);
        }

        .tr-timelineLine{
          width:1px;
          background:linear-gradient(
            180deg,
            rgba(119,187,211,.16),
            rgba(119,187,211,.055)
          );
        }

        .tr-sessionCard{
          position:relative;
          isolation:isolate;
          overflow:hidden;
          padding:13px 14px;
          border:1px solid rgba(255,255,255,.058);
          border-top-color:rgba(154,211,231,.105);
          border-bottom-color:rgba(24,43,52,.52);
          border-radius:13px;
          background:
            linear-gradient(180deg,#121c25 0%,#0b1218 100%);
          box-shadow:
            0 1px 1px rgba(0,0,0,.48),
            0 4px 9px rgba(0,0,0,.22),
            0 11px 22px rgba(0,0,0,.10),
            inset 0 1px 0 rgba(255,255,255,.032),
            inset 0 -1px 0 rgba(0,0,0,.68);
          transition:
            transform .16s cubic-bezier(.2,.8,.2,1),
            border-color .16s ease,
            background .16s ease,
            box-shadow .16s ease;
        }

        .tr-sessionCard::before{
          content:"";
          position:absolute;
          z-index:0;
          left:0;
          top:0;
          bottom:0;
          width:2px;
          background:linear-gradient(180deg,rgba(77,184,224,.50),rgba(25,91,117,.23));
        }

        .tr-sessionCard::after{
          content:"";
          display:block;
          position:absolute;
          z-index:0;
          left:14px;
          right:34%;
          top:0;
          height:1px;
          pointer-events:none;
          background:linear-gradient(
            90deg,
            rgba(215,244,253,.14),
            rgba(117,206,239,.07),
            transparent
          );
        }

        .tr-sessionCard > *{
          position:relative;
          z-index:2;
        }

        .tr-sessionCard:hover{
          transform:translateY(-2px);
          border-color:rgba(104,194,226,.13);
          border-top-color:rgba(171,224,243,.16);
          background:linear-gradient(180deg,#14212b 0%,#0c151c 100%);
          box-shadow:
            0 1px 1px rgba(0,0,0,.44),
            0 6px 12px rgba(0,0,0,.24),
            0 16px 28px rgba(0,0,0,.11),
            inset 0 1px 0 rgba(255,255,255,.038),
            inset 0 -1px 0 rgba(0,0,0,.68);
        }

        .tr-sessionTitleRow{
          gap:14px;
        }

        .tr-sessionTitleRow h3{
          color:#f5f9fb;
          font-size:19px;
          line-height:1.02;
          letter-spacing:-.025em;
          text-shadow:
            0 1px 0 rgba(255,255,255,.025),
            0 2px 4px rgba(0,0,0,.31);
        }

        .tr-sessionTitleRow p{
          margin-top:4px;
          color:rgba(187,207,218,.47);
          font-size:10px;
        }

        .tr-sessionDate{
          align-self:flex-start;
          padding:6px 8px;
          border:1px solid rgba(124,190,214,.09);
          border-top-color:rgba(172,218,235,.13);
          border-radius:8px;
          color:rgba(218,236,244,.72);
          background:linear-gradient(180deg,rgba(10,22,29,.75),rgba(5,12,17,.50));
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.018),
            inset 0 -1px 0 rgba(0,0,0,.38);
          font-size:8px;
          font-weight:1000;
          letter-spacing:.10em;
        }

        .tr-scheduleMuscles.is-compact{
          gap:7px;
          margin-top:9px;
        }

        .tr-scheduleMuscles.is-compact .tr-scheduleMuscle{
          min-height:29px;
          padding:2px 7px 2px 3px;
          gap:5px;
          border:1px solid rgba(102,177,205,.085);
          border-radius:8px;
          color:rgba(199,220,230,.62);
          background:
            linear-gradient(180deg,rgba(14,31,40,.64),rgba(7,17,24,.58));
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.018),
            inset 0 -1px 0 rgba(0,0,0,.38);
        }

        .tr-scheduleMuscles.is-compact .tr-scheduleMuscleIcon{
          width:23px;
          height:23px;
          flex-basis:23px;
          border:1px solid rgba(97,185,219,.10);
          border-top-color:rgba(142,214,239,.15);
          border-radius:6px;
          background:linear-gradient(180deg,#102b3a,#091a24);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.026),
            inset 0 -2px 3px rgba(0,0,0,.27);
        }

        .tr-scheduleMuscles.is-compact .tr-scheduleMuscleIcon img{
          width:18px;
          height:18px;
        }

        .tr-sessionMeta{
          margin-top:9px;
          color:rgba(160,188,202,.44);
          font-size:9px;
        }

        .tr-sessionRight{
          min-width:200px;
          gap:9px;
        }

        .tr-sessionReadiness:empty{
          display:none;
        }

        .tr-readinessStatus.is-compact{
          min-height:27px;
          padding:5px 8px;
          border:1px solid rgba(221,178,104,.14);
          border-radius:7px;
          background:
            linear-gradient(180deg,rgba(45,35,18,.50),rgba(22,17,10,.32));
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.025),
            inset 0 -1px 0 rgba(0,0,0,.36);
        }

        .tr-readinessStatus.is-compact .tr-readinessAccent{
          width:2px;
          border-radius:2px;
          box-shadow:none;
        }

        .tr-readinessStatus.is-compact strong{
          font-size:7px;
          letter-spacing:.10em;
        }

        .tr-sessionActions{
          gap:7px;
        }

        .tr-sessionActions .tr-scheduleBtn{
          min-height:35px;
          border-radius:8px;
          font-size:8px;
          letter-spacing:.08em;
        }

        .tr-sessionActions .tr-scheduleBtn--rowStart{
          border:1px solid rgba(96,192,227,.36);
          border-top-color:rgba(148,220,246,.46);
          border-bottom-color:rgba(16,69,90,.53);
          background:
            linear-gradient(180deg,#1e6d8c 0%,#155775 100%);
          box-shadow:
            0 1px 1px rgba(0,0,0,.42),
            0 3px 6px rgba(0,0,0,.18),
            inset 0 1px 0 rgba(255,255,255,.105),
            inset 0 -2px 3px rgba(0,0,0,.19);
        }

        .tr-sessionActions .tr-scheduleBtn--rowStart:hover{
          transform:translateY(-1px);
          background:
            linear-gradient(180deg,#257a9a 0%,#18617e 100%);
          box-shadow:
            0 1px 1px rgba(0,0,0,.39),
            0 4px 8px rgba(0,0,0,.20),
            inset 0 1px 0 rgba(255,255,255,.12),
            inset 0 -2px 3px rgba(0,0,0,.18);
        }

        @media (hover:hover) and (pointer:fine){
          .tr-nextHero .tr-scheduleMuscle:hover{
            transform:translateY(-1px);
            border-color:rgba(128,213,242,.23);
            background:linear-gradient(180deg,#142a38 0%,#0a1922 100%);
          }
        }

        @media (max-width:900px){
          .tr-nextHeroCompact{
            grid-template-columns:minmax(0,1fr) 208px;
            gap:18px;
          }

          .tr-sessionRight{
            min-width:175px;
          }
        }

        @media (max-width:680px){
          .tr-nextHero{
            padding:15px 13px 13px;
            border-radius:15px;
          }

          .tr-nextHero::before{
            box-shadow:
              inset 3px 0 0 rgba(75,195,236,.48),
              inset 5px 0 0 rgba(20,79,101,.22);
          }

          .tr-nextHeroTopline{
            align-items:center;
            gap:8px;
            padding:0 0 6px 5px;
          }

          .tr-heroReadinessInline{
            max-width:60%;
            padding:6px 8px;
            font-size:7px;
            letter-spacing:.065em;
          }

          .tr-nextHeroCompact{
            grid-template-columns:1fr;
            gap:10px;
            min-height:0;
            padding:10px 0 10px 5px;
          }

          .tr-nextHeroCopy h1{
            font-size:clamp(38px,12vw,50px);
            line-height:.91;
          }

          .tr-nextHeroProgram{
            font-size:11px;
          }

          .tr-nextHero .tr-scheduleMuscles{
            gap:5px;
            margin-top:12px;
          }

          .tr-nextHero .tr-scheduleMuscle{
            min-height:33px;
            padding:2px 7px 2px 3px;
          }

          .tr-nextHero .tr-scheduleMuscleIcon{
            width:26px;
            height:26px;
            flex-basis:26px;
          }

          .tr-nextHeroQuickStats{
            grid-template-columns:repeat(2,minmax(0,1fr));
            border-radius:9px;
          }

          .tr-nextHeroQuickStat{
            min-height:50px;
            padding:8px 7px;
          }

          .tr-nextHeroQuickStat strong{
            font-size:20px;
          }

          .tr-nextHeroActions{
            grid-template-columns:minmax(0,1fr) 80px;
            gap:7px;
            margin-top:8px;
            padding-left:5px;
          }

          .tr-nextHeroActions .tr-scheduleBtn{
            min-height:43px;
            border-radius:9px;
          }

          .tr-primaryActionGlyph{
            width:20px;
            height:20px;
            font-size:7px;
          }

          .tr-upcomingBoard{
            margin-top:11px;
            border-radius:14px;
          }

          .tr-upcomingHeader{
            min-height:42px;
            padding:0 12px;
          }

          .tr-upcomingAdvisory{
            font-size:6px;
            letter-spacing:.13em;
          }

          .tr-trainingTimeline{
            padding:9px 8px 11px;
            gap:7px;
          }

          .tr-trainingTimelineRow{
            grid-template-columns:15px minmax(0,1fr);
          }

          .tr-timelineRail{
            width:15px;
          }

          .tr-sessionCard{
            padding:12px 11px;
            border-radius:11px;
          }

          .tr-sessionCard:hover{
            transform:none;
          }

          .tr-sessionDate{
            padding:5px 6px;
            font-size:7px;
          }

          .tr-scheduleMuscles.is-compact{
            gap:5px;
          }

          .tr-scheduleMuscles.is-compact .tr-scheduleMuscle{
            min-height:27px;
            padding-right:6px;
          }

          .tr-sessionRight{
            min-width:0;
            gap:8px;
          }

          .tr-sessionActions{
            width:100%;
          }
        }

        @media (prefers-reduced-motion:reduce){
          .tr-sessionCard,
          .tr-scheduleBtn,
          .tr-scheduleMuscle{
            transition:none !important;
          }
        }


        /* ==========================================================
           STEP 6H: PERFORMANCE INSTRUMENTS + DEEP UPCOMING CARDS
           ========================================================== */

        .tr-nextHeroQuickStats{
          display:grid;
          grid-template-columns:repeat(2,minmax(0,1fr));
          gap:8px;
          overflow:visible;
          border:0;
          background:none;
          box-shadow:none;
        }

        .tr-nextHeroQuickStat{
          position:relative;
          min-width:0;
          min-height:78px;
          display:grid;
          grid-template-columns:38px minmax(0,1fr);
          align-items:center;
          gap:9px;
          padding:11px 12px;
          overflow:hidden;
          border:1px solid rgba(126,199,224,.16);
          border-top-color:rgba(187,229,244,.25);
          border-bottom-color:rgba(27,59,72,.44);
          border-radius:12px;
          background:
            linear-gradient(180deg,#101d26 0%,#091218 58%,#060c11 100%);
          box-shadow:
            0 1px 0 rgba(255,255,255,.028),
            0 2px 3px rgba(0,0,0,.43),
            0 8px 18px rgba(0,0,0,.22),
            inset 0 1px 0 rgba(255,255,255,.045),
            inset 0 -2px 5px rgba(0,0,0,.30);
          text-align:left;
        }

        .tr-nextHeroQuickStat::after{
          content:"";
          position:absolute;
          left:13px;
          right:13px;
          top:0;
          height:1px;
          background:linear-gradient(
            90deg,
            transparent,
            rgba(209,242,252,.22),
            transparent
          );
        }

        .tr-nextHeroQuickStat + .tr-nextHeroQuickStat{
          border-left:1px solid rgba(126,199,224,.16);
        }

        .tr-heroMetricIcon{
          width:38px;
          height:38px;
          display:grid;
          place-items:center;
          border:1px solid rgba(84,184,219,.21);
          border-top-color:rgba(134,215,244,.29);
          border-radius:10px;
          color:#71d8f8;
          background:
            linear-gradient(180deg,#113448 0%,#09202c 100%);
          box-shadow:
            0 1px 2px rgba(0,0,0,.42),
            inset 0 1px 0 rgba(255,255,255,.055),
            inset 0 -3px 5px rgba(0,0,0,.26);
        }

        .tr-nextHeroQuickStat.is-time .tr-heroMetricIcon{
          color:#efc56f;
          border-color:rgba(219,170,78,.20);
          border-top-color:rgba(241,200,117,.30);
          background:linear-gradient(180deg,#3a2d16 0%,#20180d 100%);
        }

        .tr-heroMetricIcon svg{
          width:21px;
          height:21px;
          fill:none;
          stroke:currentColor;
          stroke-width:1.8;
          stroke-linecap:round;
          stroke-linejoin:round;
        }

        .tr-heroMetricCopy{
          min-width:0;
          display:grid;
          align-content:center;
          gap:4px;
        }

        .tr-heroMetricCopy strong,
        .tr-nextHeroQuickStat strong{
          color:#f7fbfd;
          font-size:28px;
          line-height:.9;
          font-weight:1000;
          letter-spacing:-.045em;
          font-variant-numeric:tabular-nums;
          text-shadow:0 2px 5px rgba(0,0,0,.34);
        }

        .tr-heroMetricCopy span,
        .tr-nextHeroQuickStat span:not(.tr-heroMetricIcon){
          color:rgba(174,204,217,.58);
          font-size:7px;
          line-height:1;
          font-weight:1000;
          letter-spacing:.14em;
          white-space:nowrap;
        }

        /* The upcoming section is a recessed tray. Individual sessions
           are clearly brighter/lifted so they do not disappear into it. */
        .tr-upcomingBoard{
          border-color:rgba(115,184,209,.15);
          border-top-color:rgba(179,224,240,.21);
          background:
            linear-gradient(180deg,#091016 0%,#050a0e 100%);
          box-shadow:
            0 1px 0 rgba(255,255,255,.018),
            0 3px 5px rgba(0,0,0,.40),
            0 16px 38px rgba(0,0,0,.21),
            inset 0 2px 6px rgba(0,0,0,.32),
            inset 0 1px 0 rgba(255,255,255,.021);
        }

        .tr-upcomingHeader{
          min-height:49px;
          padding:0 17px;
          border-bottom-color:rgba(134,196,218,.10);
          background:
            linear-gradient(180deg,rgba(21,37,47,.66),rgba(8,15,20,.42));
        }

        .tr-upcomingAdvisory{
          color:rgba(141,189,207,.54);
          font-size:7px;
          letter-spacing:.17em;
        }

        .tr-trainingTimeline{
          gap:13px;
          padding:14px 13px 16px;
        }

        .tr-sessionCard{
          border:1px solid rgba(123,194,219,.14);
          border-top-color:rgba(189,229,243,.23);
          border-bottom-color:rgba(31,64,77,.50);
          border-radius:14px;
          background:
            linear-gradient(180deg,#172630 0%,#101b23 46%,#0b141b 100%);
          box-shadow:
            0 1px 0 rgba(255,255,255,.040),
            0 2px 3px rgba(0,0,0,.44),
            0 8px 15px rgba(0,0,0,.29),
            0 18px 32px rgba(0,0,0,.12),
            inset 0 1px 0 rgba(255,255,255,.050),
            inset 0 -2px 4px rgba(0,0,0,.27);
        }

        .tr-sessionCard::before{
          width:3px;
          background:
            linear-gradient(
              180deg,
              rgba(78,198,238,.76),
              rgba(31,116,148,.37) 58%,
              rgba(18,63,82,.18)
            );
          box-shadow:1px 0 0 rgba(100,206,242,.05);
        }

        .tr-sessionCard::after{
          left:18px;
          right:24%;
          background:linear-gradient(
            90deg,
            rgba(224,247,255,.20),
            rgba(118,211,243,.09) 44%,
            transparent
          );
        }

        .tr-trainingTimelineRow.is-ready .tr-sessionCard{
          border-top-color:rgba(190,232,245,.25);
        }

        .tr-sessionCard:hover{
          transform:translateY(-2px);
          border-color:rgba(110,204,237,.22);
          border-top-color:rgba(204,238,249,.31);
          background:
            linear-gradient(180deg,#1a2c38 0%,#12212a 48%,#0c171f 100%);
          box-shadow:
            0 1px 0 rgba(255,255,255,.045),
            0 2px 3px rgba(0,0,0,.42),
            0 10px 18px rgba(0,0,0,.30),
            0 22px 38px rgba(0,0,0,.14),
            inset 0 1px 0 rgba(255,255,255,.055),
            inset 0 -2px 4px rgba(0,0,0,.25);
        }

        .tr-sessionTitleRow{
          align-items:flex-start;
        }

        .tr-sessionTitleRow h3{
          font-size:20px;
          color:#f8fbfd;
        }

        .tr-sessionTitleRow p{
          color:rgba(194,217,228,.57);
          font-size:10px;
        }

        /* Schedule/date instrument */
        .tr-sessionDate{
          min-height:35px;
          display:flex;
          align-items:center;
          gap:7px;
          padding:6px 10px 6px 7px;
          border:1px solid rgba(104,185,216,.17);
          border-top-color:rgba(167,220,241,.23);
          border-bottom-color:rgba(28,62,76,.44);
          border-radius:9px;
          color:#d8edf6;
          background:
            linear-gradient(180deg,#102631 0%,#091820 100%);
          box-shadow:
            0 1px 2px rgba(0,0,0,.40),
            inset 0 1px 0 rgba(255,255,255,.040),
            inset 0 -2px 3px rgba(0,0,0,.25);
        }

        .tr-sessionDate.is-immediate{
          border-color:rgba(222,174,82,.28);
          border-top-color:rgba(244,204,125,.38);
          color:#f3cf7b;
          background:
            linear-gradient(180deg,#392b14 0%,#21180c 100%);
          box-shadow:
            0 1px 2px rgba(0,0,0,.40),
            inset 0 1px 0 rgba(255,255,255,.055),
            inset 0 -2px 3px rgba(0,0,0,.25);
        }

        .tr-sessionDateIcon{
          width:23px;
          height:23px;
          display:grid;
          place-items:center;
          flex:0 0 23px;
          border:1px solid rgba(121,202,232,.14);
          border-radius:6px;
          color:#67cff3;
          background:rgba(4,13,18,.42);
        }

        .tr-sessionDate.is-immediate .tr-sessionDateIcon{
          color:#f0c467;
          border-color:rgba(239,194,103,.16);
          background:rgba(32,22,8,.45);
        }

        .tr-sessionDateIcon svg{
          width:14px;
          height:14px;
          fill:none;
          stroke:currentColor;
          stroke-width:1.8;
          stroke-linecap:round;
          stroke-linejoin:round;
        }

        .tr-sessionDate strong{
          color:inherit;
          font-size:8px;
          line-height:1;
          font-weight:1000;
          letter-spacing:.105em;
          white-space:nowrap;
        }

        /* High-contrast workout metadata */
        .tr-sessionMeta{
          display:flex;
          align-items:center;
          gap:7px;
          margin-top:11px;
          color:inherit;
        }

        .tr-sessionMeta i{
          display:none;
        }

        .tr-sessionMetaItem{
          min-height:30px;
          display:flex;
          align-items:center;
          gap:5px;
          padding:4px 8px 4px 5px;
          border:1px solid rgba(117,185,210,.11);
          border-top-color:rgba(162,211,229,.16);
          border-radius:8px;
          background:
            linear-gradient(180deg,rgba(9,23,31,.72),rgba(5,14,19,.68));
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.022),
            inset 0 -1px 0 rgba(0,0,0,.34);
        }

        .tr-sessionMetaIcon{
          width:21px;
          height:21px;
          display:grid;
          place-items:center;
          color:#62c9ed;
          border:1px solid rgba(88,184,219,.12);
          border-radius:6px;
          background:rgba(11,40,53,.68);
        }

        .tr-sessionMetaItem:nth-child(2) .tr-sessionMetaIcon{
          color:#e8bf6a;
          border-color:rgba(216,169,77,.12);
          background:rgba(53,39,16,.58);
        }

        .tr-sessionMetaIcon svg{
          width:13px;
          height:13px;
          fill:none;
          stroke:currentColor;
          stroke-width:1.9;
          stroke-linecap:round;
          stroke-linejoin:round;
        }

        .tr-sessionMetaItem strong{
          color:#f3f8fa;
          font-size:11px;
          line-height:1;
          font-weight:1000;
          font-variant-numeric:tabular-nums;
        }

        .tr-sessionMetaItem > span:last-child{
          color:rgba(174,202,214,.64);
          font-size:7px;
          line-height:1;
          font-weight:1000;
          letter-spacing:.10em;
        }

        /* Timeline has enough presence to visually link the cards. */
        .tr-timelineNode{
          width:9px;
          height:9px;
          border-color:rgba(91,197,235,.45);
          background:linear-gradient(180deg,#183747,#0b1b24);
          box-shadow:
            0 1px 2px rgba(0,0,0,.42),
            0 0 0 3px rgba(60,172,214,.035),
            inset 0 1px 0 rgba(255,255,255,.07);
        }

        .tr-trainingTimelineRow.is-ready .tr-timelineNode{
          border-color:rgba(92,214,151,.53);
          background:linear-gradient(180deg,#1b4132,#0b251b);
          box-shadow:
            0 1px 2px rgba(0,0,0,.42),
            0 0 0 3px rgba(92,214,151,.035),
            inset 0 1px 0 rgba(255,255,255,.065);
        }

        .tr-timelineLine{
          background:linear-gradient(
            180deg,
            rgba(88,182,217,.25),
            rgba(88,182,217,.07)
          );
        }

        @media(max-width:680px){
          .tr-nextHeroQuickStats{
            gap:6px;
          }

          .tr-nextHeroQuickStat{
            min-height:60px;
            grid-template-columns:31px minmax(0,1fr);
            gap:7px;
            padding:8px;
            border-radius:10px;
          }

          .tr-heroMetricIcon{
            width:31px;
            height:31px;
            border-radius:8px;
          }

          .tr-heroMetricIcon svg{
            width:18px;
            height:18px;
          }

          .tr-heroMetricCopy strong,
          .tr-nextHeroQuickStat strong{
            font-size:22px;
          }

          .tr-heroMetricCopy span,
          .tr-nextHeroQuickStat span:not(.tr-heroMetricIcon){
            font-size:6px;
            letter-spacing:.105em;
          }

          .tr-trainingTimeline{
            gap:10px;
            padding:11px 8px 13px;
          }

          .tr-sessionCard{
            padding:12px 10px;
          }

          .tr-sessionDate{
            min-height:31px;
            gap:5px;
            padding:4px 7px 4px 5px;
          }

          .tr-sessionDateIcon{
            width:21px;
            height:21px;
            flex-basis:21px;
          }

          .tr-sessionDate strong{
            font-size:7px;
          }

          .tr-sessionMeta{
            gap:5px;
            margin-top:9px;
            flex-wrap:wrap;
          }

          .tr-sessionMetaItem{
            min-height:28px;
            padding:3px 7px 3px 4px;
          }

          .tr-sessionMetaIcon{
            width:20px;
            height:20px;
          }

          .tr-sessionMetaItem strong{
            font-size:10px;
          }
        }



        /* ==========================================================
           STEP 6I FINAL VISUAL AUTHORITY
           Premium de-boxed planner, stronger readability, exact
           active-WORKOUTS-nav START treatment and aligned schedule rail.
           ========================================================== */

        .tr-trainingBoard{
          --tr-nav-blue:rgba(0,170,255,.12);
          --tr-nav-blue-border:rgba(0,170,255,.72);
          --tr-nav-blue-inner:rgba(0,170,255,.18);
          --tr-orange-hi:#ffe1a1;
          --tr-orange-1:#ffad2c;
          --tr-orange-2:#ef7c08;
          --tr-orange-3:#9c3d00;
          --tr-orange-border:rgba(255,214,145,.92);
        }

        /* Strong section labels */
        .tr-nextHeroTopline .tr-trainingSectionEyebrow,
        .tr-upcomingHeader .tr-trainingSectionEyebrow{
          position:relative;
          display:flex;
          align-items:center;
          gap:9px;
          color:#c9f2ff!important;
          font-size:11.5px!important;
          line-height:1!important;
          font-weight:1000!important;
          letter-spacing:.16em!important;
          text-shadow:0 1px 1px rgba(0,0,0,.55),0 0 12px rgba(0,170,255,.16)!important;
        }

        .tr-nextHeroTopline .tr-trainingSectionEyebrow::before,
        .tr-upcomingHeader .tr-trainingSectionEyebrow::before{
          content:"";
          width:3px;
          height:16px;
          flex:0 0 3px;
          border-radius:3px;
          background:linear-gradient(180deg,#8ae6ff,#16a6e2);
          box-shadow:0 0 10px rgba(49,189,240,.26);
        }

        .tr-upcomingAdvisory{
          color:rgba(220,237,244,.72)!important;
          font-size:8.5px!important;
          font-weight:950!important;
          letter-spacing:.14em!important;
        }

        /* Give hero metrics enough space */
        .tr-nextHeroCompact{
          grid-template-columns:minmax(0,1fr) 282px!important;
          gap:30px!important;
        }

        /* Hero metrics are information, not nested buttons */
        .tr-nextHeroQuickStats{
          display:grid!important;
          grid-template-columns:repeat(2,minmax(0,1fr))!important;
          align-items:center!important;
          gap:0!important;
          width:100%!important;
          min-width:0!important;
          overflow:visible!important;
          border:0!important;
          border-radius:0!important;
          background:none!important;
          box-shadow:none!important;
        }

        .tr-nextHeroQuickStat{
          position:relative!important;
          min-width:0!important;
          min-height:88px!important;
          display:grid!important;
          grid-template-columns:30px minmax(0,1fr)!important;
          align-items:center!important;
          gap:10px!important;
          padding:10px 17px!important;
          overflow:visible!important;
          border:0!important;
          border-radius:0!important;
          background:none!important;
          box-shadow:none!important;
          text-align:left!important;
        }

        .tr-nextHeroQuickStat::after{display:none!important;}

        .tr-nextHeroQuickStat + .tr-nextHeroQuickStat{
          border-left:1px solid rgba(170,216,233,.20)!important;
        }

        .tr-heroMetricIcon{
          width:27px!important;
          height:27px!important;
          display:grid!important;
          place-items:center!important;
          border:0!important;
          border-radius:0!important;
          color:#58d1fa!important;
          background:none!important;
          box-shadow:none!important;
          filter:drop-shadow(0 0 6px rgba(0,170,255,.17));
        }

        .tr-nextHeroQuickStat.is-time .tr-heroMetricIcon{
          color:var(--tr-orange-1)!important;
          filter:drop-shadow(0 0 4px rgba(239,124,8,.28)) drop-shadow(0 0 9px rgba(255,119,0,.12));
        }

        .tr-heroMetricIcon svg{
          width:24px!important;
          height:24px!important;
          stroke-width:2!important;
        }

        .tr-heroMetricCopy{
          min-width:0!important;
          display:grid!important;
          align-content:center!important;
          gap:6px!important;
        }

        .tr-heroMetricCopy strong{
          color:#fff!important;
          font-size:32px!important;
          line-height:.86!important;
          font-weight:1000!important;
          letter-spacing:-.05em!important;
          font-variant-numeric:tabular-nums!important;
          white-space:nowrap!important;
          text-shadow:0 2px 3px rgba(0,0,0,.48)!important;
        }

        .tr-nextHeroQuickStat.is-time .tr-heroMetricCopy strong{
          color:var(--tr-orange-1)!important;
          text-shadow:0 2px 3px rgba(0,0,0,.50),0 0 10px rgba(239,124,8,.14)!important;
        }

        .tr-heroMetricCopy span{
          color:rgba(236,246,250,.88)!important;
          font-size:10px!important;
          line-height:1!important;
          font-weight:1000!important;
          letter-spacing:.11em!important;
          white-space:nowrap!important;
          overflow:visible!important;
        }

        /* Muscle labels integrated into surface, not fake pills */
        .tr-nextHero .tr-scheduleMuscles,
        .tr-scheduleMuscles.is-compact{gap:13px!important;}

        .tr-nextHero .tr-scheduleMuscle,
        .tr-scheduleMuscles.is-compact .tr-scheduleMuscle{
          min-height:28px!important;
          padding:0!important;
          gap:6px!important;
          border:0!important;
          border-radius:0!important;
          color:rgba(235,245,249,.88)!important;
          background:none!important;
          box-shadow:none!important;
          font-size:9.5px!important;
          font-weight:1000!important;
          letter-spacing:.055em!important;
        }

        .tr-nextHero .tr-scheduleMuscle::before,
        .tr-scheduleMuscles.is-compact .tr-scheduleMuscle::before{display:none!important;}

        .tr-nextHero .tr-scheduleMuscleIcon,
        .tr-scheduleMuscles.is-compact .tr-scheduleMuscleIcon{
          width:25px!important;
          height:25px!important;
          flex-basis:25px!important;
          border:0!important;
          border-radius:0!important;
          background:none!important;
          box-shadow:none!important;
        }

        .tr-nextHero .tr-scheduleMuscleIcon img,
        .tr-scheduleMuscles.is-compact .tr-scheduleMuscleIcon img{
          width:23px!important;
          height:23px!important;
          filter:drop-shadow(0 1px 1px rgba(0,0,0,.50)) drop-shadow(0 0 4px rgba(0,170,255,.08));
        }

        /* START buttons match active bottom WORKOUTS nav visual values */
        .tr-scheduleBtn--primary,
        .tr-sessionActions .tr-scheduleBtn--rowStart{
          color:rgba(255,255,255,.96)!important;
          background:var(--tr-nav-blue)!important;
          border:2px solid var(--tr-nav-blue-border)!important;
          border-radius:14px!important;
          box-shadow:
            0 0 0 1px var(--tr-nav-blue-inner) inset,
            0 12px 34px rgba(0,0,0,.55),
            0 0 20px rgba(0,170,255,.18)!important;
          text-shadow:0 2px 0 rgba(0,0,0,.55),0 0 10px rgba(0,170,255,.18)!important;
          font-weight:950!important;
          letter-spacing:.08em!important;
          text-transform:uppercase!important;
          transition:transform .14s ease,filter .14s ease,border-color .14s ease,background .14s ease,box-shadow .14s ease!important;
        }

        .tr-scheduleBtn--primary{
          min-height:48px!important;
          font-size:12.5px!important;
          line-height:16px!important;
        }

        .tr-sessionActions .tr-scheduleBtn--rowStart{
          min-height:38px!important;
          font-size:10px!important;
          line-height:14px!important;
        }

        .tr-scheduleBtn--primary::before,
        .tr-sessionActions .tr-scheduleBtn--rowStart::before{
          display:none!important;
          content:none!important;
        }

        .tr-scheduleBtn--primary:hover,
        .tr-sessionActions .tr-scheduleBtn--rowStart:hover{
          transform:translateY(-1px)!important;
          filter:brightness(1.10)!important;
          background:var(--tr-nav-blue)!important;
          border-color:rgba(68,196,255,.86)!important;
          box-shadow:
            0 0 0 1px rgba(0,170,255,.22) inset,
            0 14px 36px rgba(0,0,0,.56),
            0 0 22px rgba(0,170,255,.22)!important;
        }

        .tr-scheduleBtn--primary:active,
        .tr-sessionActions .tr-scheduleBtn--rowStart:active{
          transform:translateY(1px)!important;
          filter:brightness(.96)!important;
        }

        .tr-primaryActionGlyph{
          width:auto!important;
          height:auto!important;
          display:inline!important;
          padding:0!important;
          border:0!important;
          border-radius:0!important;
          color:inherit!important;
          background:none!important;
          box-shadow:none!important;
          font-size:9px!important;
        }

        /* Stronger upcoming tray/card depth */
        .tr-upcomingBoard{
          overflow:hidden!important;
          border:1px solid rgba(93,153,177,.14)!important;
          border-top-color:rgba(163,211,229,.18)!important;
          background:linear-gradient(180deg,#080e13 0%,#05090d 100%)!important;
          box-shadow:
            0 2px 4px rgba(0,0,0,.40),
            0 18px 42px rgba(0,0,0,.24),
            inset 0 2px 8px rgba(0,0,0,.24),
            inset 0 1px 0 rgba(255,255,255,.020)!important;
        }

        .tr-upcomingHeader{
          min-height:52px!important;
          padding:0 18px!important;
          border-bottom:1px solid rgba(127,191,216,.10)!important;
          background:linear-gradient(180deg,rgba(18,33,43,.74),rgba(8,15,20,.50))!important;
        }

        .tr-trainingTimeline{
          gap:14px!important;
          padding:15px 13px 17px!important;
        }

        .tr-sessionCard{
          display:grid!important;
          grid-template-columns:minmax(0,1fr) 198px!important;
          align-items:stretch!important;
          gap:22px!important;
          padding:16px!important;
          overflow:hidden!important;
          border:1px solid rgba(133,201,226,.17)!important;
          border-top-color:rgba(199,233,245,.25)!important;
          border-bottom-color:rgba(27,56,68,.52)!important;
          border-radius:15px!important;
          background:linear-gradient(180deg,#182a35 0%,#12212b 45%,#0d171e 100%)!important;
          box-shadow:
            0 1px 0 rgba(255,255,255,.045),
            0 3px 4px rgba(0,0,0,.44),
            0 10px 20px rgba(0,0,0,.29),
            0 24px 42px rgba(0,0,0,.15),
            inset 0 1px 0 rgba(255,255,255,.045),
            inset 0 -2px 5px rgba(0,0,0,.28)!important;
        }

        .tr-sessionCard::before{
          width:3px!important;
          background:linear-gradient(180deg,rgba(85,206,246,.78),rgba(32,126,160,.38) 60%,rgba(16,63,83,.14))!important;
          box-shadow:none!important;
        }

        .tr-sessionCard::after{
          left:18px!important;
          right:30%!important;
          background:linear-gradient(90deg,rgba(225,247,255,.20),rgba(121,210,242,.08) 46%,transparent)!important;
        }

        .tr-sessionCard:hover{
          transform:translateY(-2px)!important;
          border-color:rgba(126,212,243,.24)!important;
          border-top-color:rgba(213,241,250,.31)!important;
          background:linear-gradient(180deg,#1c303c 0%,#152630 48%,#0f1b23 100%)!important;
        }

        .tr-sessionPrimary{
          min-width:0!important;
          display:grid!important;
          align-content:center!important;
        }

        .tr-sessionTitleRow{display:block!important;}

        .tr-sessionTitleRow h3{
          color:#fff!important;
          font-size:21px!important;
          line-height:1!important;
          font-weight:1000!important;
          letter-spacing:-.026em!important;
          text-shadow:0 2px 3px rgba(0,0,0,.40)!important;
        }

        .tr-sessionTitleRow p{
          margin-top:5px!important;
          color:rgba(222,236,242,.74)!important;
          font-size:10.5px!important;
          font-weight:850!important;
        }

        /* Upcoming exercise/time rail: larger, bright, de-boxed */
        .tr-sessionMeta{
          display:flex!important;
          align-items:center!important;
          gap:0!important;
          margin-top:12px!important;
          color:inherit!important;
        }

        .tr-sessionMetaItem{
          position:relative!important;
          min-height:28px!important;
          display:flex!important;
          align-items:center!important;
          gap:7px!important;
          padding:0 14px!important;
          border:0!important;
          border-radius:0!important;
          background:none!important;
          box-shadow:none!important;
        }

        .tr-sessionMetaItem:first-child{padding-left:0!important;}

        .tr-sessionMetaItem + .tr-sessionMetaItem{
          border-left:1px solid rgba(158,205,223,.20)!important;
        }

        .tr-sessionMetaIcon{
          width:20px!important;
          height:20px!important;
          display:grid!important;
          place-items:center!important;
          border:0!important;
          border-radius:0!important;
          color:#54cff9!important;
          background:none!important;
          box-shadow:none!important;
          filter:drop-shadow(0 0 5px rgba(0,170,255,.13));
        }

        .tr-sessionMetaItem:nth-child(2) .tr-sessionMetaIcon{
          color:var(--tr-orange-1)!important;
          filter:drop-shadow(0 0 4px rgba(239,124,8,.24)) drop-shadow(0 0 8px rgba(255,119,0,.10));
        }

        .tr-sessionMetaIcon svg{
          width:17px!important;
          height:17px!important;
          stroke-width:2!important;
        }

        .tr-sessionMetaItem strong{
          color:#fff!important;
          font-size:12.5px!important;
          line-height:1!important;
          font-weight:1000!important;
          letter-spacing:-.01em!important;
          font-variant-numeric:tabular-nums!important;
        }

        .tr-sessionMetaItem:nth-child(2) strong{
          color:var(--tr-orange-1)!important;
          text-shadow:0 0 8px rgba(239,124,8,.10)!important;
        }

        .tr-sessionMetaItem > span:last-child{
          color:rgba(236,246,250,.86)!important;
          font-size:9.5px!important;
          line-height:1!important;
          font-weight:1000!important;
          letter-spacing:.095em!important;
        }

        /* Exact date / action alignment */
        .tr-sessionRight{
          width:198px!important;
          min-width:198px!important;
          display:grid!important;
          grid-template-rows:auto 1fr auto!important;
          align-items:stretch!important;
          gap:9px!important;
        }

        .tr-sessionReadiness{
          min-height:0!important;
          display:flex!important;
          align-items:flex-start!important;
        }

        .tr-sessionReadiness:empty{display:block!important;}

        .tr-sessionDate{
          width:100%!important;
          min-width:0!important;
          min-height:38px!important;
          display:flex!important;
          align-items:center!important;
          justify-content:center!important;
          gap:8px!important;
          padding:7px 10px!important;
          border:1px solid rgba(87,177,211,.21)!important;
          border-top-color:rgba(147,216,241,.30)!important;
          border-bottom-color:rgba(27,61,75,.46)!important;
          border-radius:10px!important;
          color:#d6f0f9!important;
          background:linear-gradient(180deg,rgba(14,39,51,.82),rgba(7,22,30,.80))!important;
          box-shadow:0 1px 2px rgba(0,0,0,.39),inset 0 1px 0 rgba(255,255,255,.035),inset 0 -2px 3px rgba(0,0,0,.24)!important;
        }

        /* Same orange family as music PLAY */
        .tr-sessionDate.is-immediate{
          color:#170d03!important;
          border-color:var(--tr-orange-border)!important;
          background:linear-gradient(145deg,var(--tr-orange-hi) 0%,var(--tr-orange-1) 36%,var(--tr-orange-2) 72%,var(--tr-orange-3) 100%)!important;
          box-shadow:
            0 8px 20px rgba(255,119,0,.20),
            0 0 0 1px rgba(255,152,25,.14),
            inset 0 2px 0 rgba(255,255,255,.44),
            inset 0 -4px 9px rgba(80,24,0,.26)!important;
        }

        .tr-sessionDateIcon{
          width:19px!important;
          height:19px!important;
          flex:0 0 19px!important;
          display:grid!important;
          place-items:center!important;
          border:0!important;
          border-radius:0!important;
          color:#63d1f7!important;
          background:none!important;
        }

        .tr-sessionDate.is-immediate .tr-sessionDateIcon{
          color:#170d03!important;
          filter:drop-shadow(0 1px 0 rgba(255,255,255,.16));
        }

        .tr-sessionDateIcon svg{
          width:16px!important;
          height:16px!important;
          stroke-width:2!important;
        }

        .tr-sessionDate strong{
          color:inherit!important;
          font-size:9px!important;
          line-height:1!important;
          font-weight:1000!important;
          letter-spacing:.095em!important;
          white-space:nowrap!important;
        }

        .tr-sessionActions{
          width:100%!important;
          display:grid!important;
          grid-template-columns:minmax(0,1fr) 64px!important;
          gap:8px!important;
          align-self:end!important;
        }

        .tr-sessionActions .tr-scheduleBtn{
          width:100%!important;
          min-width:0!important;
          padding:0 10px!important;
        }

        .tr-sessionActions .tr-scheduleBtn--rowEdit{
          min-height:38px!important;
          border:1px solid rgba(149,190,206,.15)!important;
          border-top-color:rgba(196,224,235,.20)!important;
          border-radius:10px!important;
          color:rgba(237,245,248,.86)!important;
          background:linear-gradient(180deg,#17232b,#0b1217)!important;
          box-shadow:0 2px 4px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.035)!important;
          font-size:9px!important;
          font-weight:1000!important;
          letter-spacing:.08em!important;
        }

        @media(max-width:760px){
          .tr-nextHeroCompact{
            grid-template-columns:1fr!important;
            gap:15px!important;
          }

          .tr-nextHeroQuickStats{width:min(100%,360px)!important;}

          .tr-nextHeroQuickStat{
            min-height:70px!important;
            padding:8px 13px!important;
          }

          .tr-heroMetricCopy strong{font-size:27px!important;}
          .tr-heroMetricCopy span{font-size:9px!important;}

          .tr-sessionCard{
            grid-template-columns:minmax(0,1fr) 164px!important;
            gap:12px!important;
            padding:13px!important;
          }

          .tr-sessionRight{
            width:164px!important;
            min-width:164px!important;
          }

          .tr-sessionActions{
            grid-template-columns:minmax(0,1fr) 55px!important;
            gap:6px!important;
          }

          .tr-sessionMetaItem{padding:0 9px!important;}
          .tr-sessionMetaItem strong{font-size:11px!important;}
          .tr-sessionMetaItem > span:last-child{font-size:8px!important;}
        }

        @media(max-width:560px){
          .tr-nextHeroTopline .tr-trainingSectionEyebrow,
          .tr-upcomingHeader .tr-trainingSectionEyebrow{
            font-size:10px!important;
          }

          .tr-nextHeroQuickStats{width:100%!important;}

          .tr-sessionCard{
            grid-template-columns:1fr!important;
            gap:12px!important;
          }

          .tr-sessionRight{
            width:100%!important;
            min-width:0!important;
            grid-template-columns:minmax(0,1fr) minmax(160px,.72fr)!important;
            grid-template-rows:auto!important;
            align-items:center!important;
            gap:8px!important;
          }

          .tr-sessionRight .tr-sessionDate{grid-column:1!important;}
          .tr-sessionRight .tr-sessionReadiness{display:none!important;}
          .tr-sessionRight .tr-sessionActions{grid-column:2!important;}

          .tr-sessionActions{
            grid-template-columns:minmax(0,1fr) 52px!important;
          }
        }



        /* ==========================================================
           STEP 6J FINAL POLISH
           High-contrast type hierarchy, de-boxed schedule dates,
           readable duration units, cleaner premium composition.
           ========================================================== */

        /* Page-level WORKOUTS heading */
        .tr-trainingPageHead{
          min-height:34px!important;
          display:flex!important;
          align-items:center!important;
          margin:0 0 9px!important;
          padding:0 2px!important;
        }

        .tr-trainingPageHead .tr-trainingSectionEyebrow{
          position:relative!important;
          display:flex!important;
          align-items:center!important;
          gap:10px!important;
          color:#f4fbff!important;
          font-size:15px!important;
          line-height:1!important;
          font-weight:1000!important;
          letter-spacing:.105em!important;
          text-shadow:
            0 2px 3px rgba(0,0,0,.48),
            0 0 14px rgba(53,197,244,.12)!important;
        }

        .tr-trainingPageHead .tr-trainingSectionEyebrow::before{
          content:""!important;
          width:4px!important;
          height:20px!important;
          flex:0 0 4px!important;
          border-radius:4px!important;
          background:linear-gradient(180deg,#94e9ff 0%,#19afe8 100%)!important;
          box-shadow:0 0 11px rgba(25,175,232,.25)!important;
        }

        /* NEXT WORKOUT and UPCOMING TRAINING are real section titles */
        .tr-nextHeroTopline .tr-trainingSectionEyebrow,
        .tr-upcomingHeader .tr-trainingSectionEyebrow{
          gap:10px!important;
          color:#eefaff!important;
          font-size:14px!important;
          line-height:1!important;
          font-weight:1000!important;
          letter-spacing:.115em!important;
          text-shadow:
            0 2px 2px rgba(0,0,0,.50),
            0 0 13px rgba(54,198,244,.14)!important;
        }

        .tr-nextHeroTopline .tr-trainingSectionEyebrow::before,
        .tr-upcomingHeader .tr-trainingSectionEyebrow::before{
          width:4px!important;
          height:18px!important;
          flex-basis:4px!important;
          border-radius:4px!important;
          background:linear-gradient(180deg,#89e7ff,#12aae4)!important;
          box-shadow:0 0 10px rgba(18,170,228,.24)!important;
        }

        .tr-upcomingHeader{
          justify-content:flex-start!important;
        }

        .tr-upcomingAdvisory{
          display:none!important;
        }

        /* Hero title/subtitle readability */
        .tr-nextHeroCopy h1{
          color:#fff!important;
          text-shadow:
            0 2px 2px rgba(0,0,0,.48),
            0 6px 15px rgba(0,0,0,.24)!important;
        }

        .tr-nextHeroProgram{
          color:rgba(229,241,247,.76)!important;
          font-size:12px!important;
          font-weight:900!important;
        }

        /* Give the duration enough horizontal room for 1 HR 15 MIN */
        .tr-nextHeroCompact{
          grid-template-columns:minmax(0,1fr) 345px!important;
          gap:30px!important;
        }

        .tr-nextHeroQuickStat{
          grid-template-columns:31px minmax(0,1fr)!important;
          padding-left:15px!important;
          padding-right:15px!important;
        }

        .tr-heroMetricCopy strong{
          font-size:31px!important;
          overflow:visible!important;
          text-overflow:clip!important;
        }

        .tr-heroMetricCopy strong.tr-durationValue{
          font-size:24px!important;
          line-height:.95!important;
          letter-spacing:-.025em!important;
          white-space:nowrap!important;
        }

        .tr-heroMetricCopy span{
          color:rgba(241,248,251,.90)!important;
          font-size:10.5px!important;
          font-weight:1000!important;
          letter-spacing:.095em!important;
        }

        /* Upcoming cards: stronger title hierarchy */
        .tr-sessionTitleRow h3{
          color:#fff!important;
          font-size:23px!important;
          line-height:1!important;
          font-weight:1000!important;
          letter-spacing:-.03em!important;
          text-shadow:
            0 2px 2px rgba(0,0,0,.46),
            0 5px 12px rgba(0,0,0,.18)!important;
        }

        .tr-sessionTitleRow p{
          color:rgba(226,239,245,.78)!important;
          font-size:11px!important;
          line-height:1.2!important;
          font-weight:900!important;
        }

        /* Muscle text readability */
        .tr-nextHero .tr-scheduleMuscle,
        .tr-scheduleMuscles.is-compact .tr-scheduleMuscle{
          color:rgba(239,247,250,.91)!important;
          font-size:10px!important;
          font-weight:1000!important;
          text-shadow:0 1px 1px rgba(0,0,0,.42)!important;
        }

        /* Upcoming exercise/time information: clearly readable */
        .tr-sessionMeta{
          margin-top:14px!important;
        }

        .tr-sessionMetaItem{
          min-height:31px!important;
          gap:8px!important;
        }

        .tr-sessionMetaIcon{
          width:22px!important;
          height:22px!important;
        }

        .tr-sessionMetaIcon svg{
          width:18px!important;
          height:18px!important;
        }

        .tr-sessionMetaItem strong{
          color:#fff!important;
          font-size:14px!important;
          font-weight:1000!important;
          white-space:nowrap!important;
        }

        .tr-sessionMetaItem strong.tr-durationValue{
          color:var(--tr-orange-1)!important;
          font-size:13px!important;
          letter-spacing:-.01em!important;
        }

        .tr-sessionMetaItem > span:last-child{
          color:rgba(237,246,250,.86)!important;
          font-size:9.5px!important;
          font-weight:1000!important;
          letter-spacing:.085em!important;
          white-space:nowrap!important;
        }

        /* ----------------------------------------------------------
           SCHEDULE DATES
           No buttons, no filled pills, no bevels.
           Same alignment width as the START / EDIT rail below.
           ---------------------------------------------------------- */
        .tr-sessionRight{
          width:198px!important;
          min-width:198px!important;
          grid-template-rows:auto 1fr auto!important;
          gap:10px!important;
        }

        .tr-sessionDate{
          position:relative!important;
          width:100%!important;
          min-width:0!important;
          min-height:34px!important;
          display:flex!important;
          align-items:center!important;
          justify-content:center!important;
          gap:8px!important;
          padding:2px 6px 9px!important;
          overflow:visible!important;
          border:0!important;
          border-radius:0!important;
          color:#e8f5fa!important;
          background:none!important;
          box-shadow:none!important;
        }

        .tr-sessionDate::after{
          content:""!important;
          position:absolute!important;
          left:8px!important;
          right:8px!important;
          bottom:0!important;
          height:2px!important;
          border-radius:2px!important;
          background:linear-gradient(
            90deg,
            transparent 0%,
            rgba(58,198,244,.18) 8%,
            rgba(69,208,255,.84) 50%,
            rgba(58,198,244,.18) 92%,
            transparent 100%
          )!important;
          box-shadow:0 1px 8px rgba(42,185,237,.16)!important;
        }

        .tr-sessionDateIcon{
          width:19px!important;
          height:19px!important;
          flex-basis:19px!important;
          color:#54cff9!important;
          filter:drop-shadow(0 0 5px rgba(42,190,241,.18))!important;
        }

        .tr-sessionDate strong{
          color:#f1f9fc!important;
          font-size:10.5px!important;
          font-weight:1000!important;
          letter-spacing:.085em!important;
          text-shadow:0 1px 2px rgba(0,0,0,.48)!important;
        }

        /* TOMORROW uses Play-button orange only as an accent */
        .tr-sessionDate.is-immediate{
          color:var(--tr-orange-1)!important;
          border:0!important;
          background:none!important;
          box-shadow:none!important;
        }

        .tr-sessionDate.is-immediate::after{
          background:linear-gradient(
            90deg,
            transparent 0%,
            rgba(239,124,8,.18) 8%,
            var(--tr-orange-1) 50%,
            rgba(239,124,8,.18) 92%,
            transparent 100%
          )!important;
          box-shadow:0 1px 9px rgba(239,124,8,.20)!important;
        }

        .tr-sessionDate.is-immediate .tr-sessionDateIcon{
          color:var(--tr-orange-1)!important;
          filter:drop-shadow(0 0 5px rgba(239,124,8,.22))!important;
        }

        .tr-sessionDate.is-immediate strong{
          color:var(--tr-orange-1)!important;
          text-shadow:
            0 1px 2px rgba(0,0,0,.48),
            0 0 8px rgba(239,124,8,.12)!important;
        }

        /* Upcoming START/EDIT remain exactly aligned beneath the date */
        .tr-sessionActions{
          width:100%!important;
          align-self:end!important;
        }

        /* Slightly brighter cards without turning them into glowing boxes */
        .tr-sessionCard{
          background:
            linear-gradient(180deg,#1a2d38 0%,#13232c 47%,#0e1920 100%)!important;
          border-color:rgba(141,205,228,.19)!important;
          border-top-color:rgba(210,238,248,.27)!important;
          box-shadow:
            0 1px 0 rgba(255,255,255,.045),
            0 3px 4px rgba(0,0,0,.44),
            0 11px 21px rgba(0,0,0,.28),
            0 25px 42px rgba(0,0,0,.14),
            inset 0 1px 0 rgba(255,255,255,.045),
            inset 0 -2px 5px rgba(0,0,0,.26)!important;
        }

        @media(max-width:760px){
          .tr-trainingPageHead .tr-trainingSectionEyebrow{
            font-size:13px!important;
          }

          .tr-nextHeroTopline .tr-trainingSectionEyebrow,
          .tr-upcomingHeader .tr-trainingSectionEyebrow{
            font-size:12px!important;
          }

          .tr-nextHeroCompact{
            grid-template-columns:1fr!important;
          }

          .tr-nextHeroQuickStats{
            width:min(100%,410px)!important;
          }

          .tr-heroMetricCopy strong.tr-durationValue{
            font-size:22px!important;
          }

          .tr-sessionTitleRow h3{
            font-size:20px!important;
          }

          .tr-sessionMetaItem strong{
            font-size:12px!important;
          }

          .tr-sessionMetaItem strong.tr-durationValue{
            font-size:11.5px!important;
          }
        }

        @media(max-width:560px){
          .tr-trainingPageHead{
            min-height:31px!important;
          }

          .tr-trainingPageHead .tr-trainingSectionEyebrow{
            font-size:12px!important;
          }

          .tr-nextHeroTopline .tr-trainingSectionEyebrow,
          .tr-upcomingHeader .tr-trainingSectionEyebrow{
            font-size:11px!important;
          }

          .tr-sessionDate{
            min-height:32px!important;
            padding-bottom:8px!important;
          }

          .tr-sessionDate strong{
            font-size:9.5px!important;
          }
        }


      `}</style>
    </div>
  );
}
