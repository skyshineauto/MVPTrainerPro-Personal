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
  if (value.includes("ab") || value.includes("core") || value.includes("oblique")) return "core";
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
  let seconds = 0;
  for (const row of rows) {
    const sets = Math.max(1, Number(row.sets ?? 3));
    const rest = Math.max(0, Number(row.rest_seconds ?? 60));
    seconds += sets * 42;
    seconds += Math.max(0, sets - 1) * rest;
  }
  seconds += rows.length * 75;
  return Math.max(15, Math.round(seconds / 300) * 5);
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
  const display = (primaryHigh.length ? primaryHigh : ranked).slice(0, 3);
  const templateMinutes = Number(template?.estimated_minutes ?? 0);

  return {
    templateId,
    templateName: template?.name ?? null,
    exerciseCount: rows.length,
    estimatedMinutes: templateMinutes > 0 ? templateMinutes : estimateMinutes(rows),
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

  if (sameDay(recommendedDate, today)) {
    return { tone: "ready", label: "READY TO TRAIN", detail: "", recommendedDate };
  }

  if (sameDay(recommendedDate, addDays(today, 1))) {
    return { tone: "soon", label: "READY TOMORROW", detail: "", recommendedDate };
  }

  return { tone: "soon", label: "ON SCHEDULE", detail: "", recommendedDate };
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
            </div>

            <div className="tr-nextHeroStage">
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

              <div className="tr-nextHeroReadiness">
                <span className="tr-nextHeroReadinessLabel">READINESS</span>
                <div className={`tr-nextHeroReadinessState is-${activeSessionId ? "ready" : nextReadiness?.tone ?? "soon"}`}>
                  <span className="tr-nextHeroReadinessDot" aria-hidden />
                  <strong>{activeSessionId ? "IN PROGRESS" : nextReadiness?.label ?? "ON SCHEDULE"}</strong>
                </div>
                <div className="tr-nextHeroReadinessRule" aria-hidden>
                  <span />
                </div>
                <div className="tr-nextHeroReadinessWhen">
                  {activeSessionId ? "NOW" : formatTimelineDate(nextReadiness?.recommendedDate ?? nextPlannedDate)}
                </div>
              </div>
            </div>

            {!activeSessionId ? (
              <div className="tr-nextHeroMetrics" aria-label="Next workout details">
                <div className="tr-nextMetric">
                  <strong>{formatTimelineDate(nextPlannedDate)}</strong>
                </div>
                <div className="tr-nextMetric">
                  <strong>
                    {nextMeta?.exerciseCount
                      ? `${nextMeta.exerciseCount} EXERCISES`
                      : "EXERCISES —"}
                  </strong>
                </div>
                <div className="tr-nextMetric">
                  <strong>
                    {nextMeta?.estimatedMinutes
                      ? `~${nextMeta.estimatedMinutes} MIN`
                      : "TIME —"}
                  </strong>
                </div>
              </div>
            ) : null}

            <div className="tr-nextHeroActions">
              <button
                className="tr-scheduleBtn tr-scheduleBtn--primary"
                disabled={!activeSessionId && !nextSessionId}
                onClick={onPrimary}
              >
                {activeSessionId ? "RESUME WORKOUT" : "START WORKOUT"}
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
                            <div className="tr-sessionDate">{formatTimelineDate(plannedDate)}</div>
                          </div>

                          <MuscleStrip muscles={meta?.muscles ?? []} compact />

                          <div className="tr-sessionMeta">
                            <span>
                              {meta?.exerciseCount ? `${meta.exerciseCount} exercises` : "Exercises —"}
                            </span>
                            <i aria-hidden>•</i>
                            <span>
                              {meta?.estimatedMinutes ? `~${meta.estimatedMinutes} min` : "Time —"}
                            </span>
                          </div>
                        </div>

                        <div className="tr-sessionRight">
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

      `}</style>
    </div>
  );
}
