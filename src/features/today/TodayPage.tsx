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
  const parts = label
    .split("•")
    .map((part) => part.trim())
    .filter(Boolean);

  return {
    title: parts[0] || label || "Workout",
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

function formatScheduleDate(raw: unknown, long = false) {
  const date = parseDateOnly(raw);
  if (!date) return "Date not set";
  return date.toLocaleDateString(undefined, {
    weekday: long ? "long" : "short",
    month: "short",
    day: "numeric",
  });
}

function formatRecommendedDate(date: Date | null) {
  if (!date) return "As scheduled";
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
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
  metaByTemplate: Map<string, SessionMeta>
): Readiness {
  const today = startOfDay(new Date());
  const planned = normalizeSessionDate(session) ?? today;
  const plannedStart = startOfDay(planned);
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
  let detail = "Logged recovery window is clear.";
  let tone: Readiness["tone"] = plannedStart.getTime() > today.getTime() ? "soon" : "ready";
  let label = plannedStart.getTime() > today.getTime() ? "ON SCHEDULE" : "READY TO TRAIN";

  if (latestConflict) {
    const hard = latestConflict.history.postDifficulty === "too_hard";
    const pain = latestConflict.history.maxPain;
    const overlap = latestConflict.overlap;
    const days = latestConflict.days;

    if (pain >= 7 && days < 3) {
      recoveryDays = Math.max(1, 3 - Math.floor(days));
      tone = "recovering";
      label = "RECOVERY CHECK";
      detail = "Recent overlapping work logged a high pain rating.";
    } else if ((pain >= 3 || hard) && overlap >= 2 && days < 2) {
      recoveryDays = Math.max(1, 2 - Math.floor(days));
      tone = "recovering";
      label = "RECOVERING";
      detail = "Recent overlapping muscles logged higher stress.";
    } else if (overlap >= 2 && days < 1) {
      recoveryDays = 1;
      tone = "monitor";
      label = "RECOVERY WINDOW";
      detail = "This session heavily overlaps today’s trained muscles.";
    } else if (overlap === 1 && days < 1) {
      tone = "monitor";
      label = "MONITOR RECOVERY";
      detail = "Some muscle overlap exists with your latest session.";
    }
  }

  const recoveryDate = recoveryDays > 0 ? addDays(today, recoveryDays) : plannedStart;
  const recommendedDate = recoveryDate.getTime() > plannedStart.getTime() ? recoveryDate : plannedStart;

  if (recoveryDays === 0 && plannedStart.getTime() <= today.getTime()) {
    label = "READY TO TRAIN";
    tone = "ready";
  }

  return { tone, label, detail, recommendedDate };
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
    <div className={`tr-readiness tr-readiness--${readiness.tone} ${compact ? "is-compact" : ""}`}>
      <span className="tr-readinessDot" aria-hidden />
      <div>
        <strong>{readiness.label}</strong>
        {!compact ? <span>{readiness.detail}</span> : null}
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
  const nextReadiness = qd?.nextSession
    ? readinessForSession(qd.nextSession, nextMeta ?? summarizeTemplate(null, new Map(), new Map(), new Map()), historySignals, metaByTemplate)
    : null;

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

  const rotationLabels = useMemo(() => {
    const sessions = [qd?.nextSession, ...upcomingSessions].filter(Boolean).slice(0, 5);
    return sessions.map((session: any) => {
      const label = formatSessionLabel({
        sessionType: session.session_type,
        goal,
        goalMode,
        symptomKey,
      });
      return splitLabel(label).title;
    });
  }, [qd, upcomingSessions, goal, goalMode, symptomKey]);

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
        <div className="tr-trainingPageHeadCopy">Training schedule • readiness • program rotation</div>
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
              <div>
                <div className="tr-trainingSectionEyebrow">
                  {activeSessionId ? "ACTIVE WORKOUT" : "NEXT WORKOUT"}
                </div>
                <div className="tr-nextHeroSequence">01</div>
              </div>

              {!activeSessionId && nextReadiness ? (
                <ReadinessBadge readiness={nextReadiness} />
              ) : (
                <div className="tr-readiness tr-readiness--ready">
                  <span className="tr-readinessDot" />
                  <div>
                    <strong>IN PROGRESS</strong>
                    <span>Your active workout is ready to resume.</span>
                  </div>
                </div>
              )}
            </div>

            <div className="tr-nextHeroBody">
              <div className="tr-nextHeroCopy">
                <h1>{activeSessionId ? splitLabel(activeLabel ?? "Session").title : nextLabelParts.title}</h1>
                <div className="tr-nextHeroProgram">
                  {activeSessionId
                    ? splitLabel(activeLabel ?? "Session").subtitle || "Current training session"
                    : nextLabelParts.subtitle || nextMeta?.templateName || "Scheduled training session"}
                </div>

                {!activeSessionId ? <MuscleStrip muscles={nextMeta?.muscles ?? []} /> : null}
              </div>

              {!activeSessionId ? (
                <div className="tr-nextHeroMetrics">
                  <div className="tr-nextMetric">
                    <span>PLANNED</span>
                    <strong>{formatScheduleDate(qd?.nextSession?.date, true)}</strong>
                  </div>
                  <div className="tr-nextMetric">
                    <span>EXERCISES</span>
                    <strong>{nextMeta?.exerciseCount || "—"}</strong>
                  </div>
                  <div className="tr-nextMetric">
                    <span>EST. TIME</span>
                    <strong>{nextMeta?.estimatedMinutes ? `~${nextMeta.estimatedMinutes} min` : "—"}</strong>
                  </div>
                  <div className="tr-nextMetric">
                    <span>RECOMMENDED</span>
                    <strong>{formatRecommendedDate(nextReadiness?.recommendedDate ?? null)}</strong>
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
              <div>
                <div className="tr-trainingSectionEyebrow">UPCOMING TRAINING</div>
                <h2>Your next 7 sessions</h2>
                <p>Seven sessions ahead in your current program rotation.</p>
              </div>

              {rotationLabels.length ? (
                <div className="tr-rotationStrip" aria-label="Program rotation">
                  <span>PROGRAM ROTATION</span>
                  <div>
                    {rotationLabels.map((label, index) => (
                      <span key={`${label}-${index}`}>
                        {label}
                        {index < rotationLabels.length - 1 ? <b aria-hidden>›</b> : null}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
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
                  const readiness = readinessForSession(
                    session,
                    meta ?? summarizeTemplate(null, new Map(), new Map(), new Map()),
                    historySignals,
                    metaByTemplate
                  );

                  return (
                    <article key={session.id} className={`tr-trainingTimelineRow is-${readiness.tone}`}>
                      <div className="tr-timelineRail" aria-hidden>
                        <span className="tr-timelineNumber">{String(index + 2).padStart(2, "0")}</span>
                        <span className="tr-timelineNode" />
                        {index < upcomingSessions.length - 1 ? <span className="tr-timelineLine" /> : null}
                      </div>

                      <div className="tr-sessionCard">
                        <div className="tr-sessionPrimary">
                          <div className="tr-sessionTitleRow">
                            <div>
                              <h3>{parts.title}</h3>
                              <p>{parts.subtitle || meta?.templateName || "Training session"}</p>
                            </div>
                            <div className="tr-sessionDate">{formatScheduleDate(session.date)}</div>
                          </div>

                          <MuscleStrip muscles={meta?.muscles ?? []} compact />

                          <div className="tr-sessionMeta">
                            <span>{meta?.exerciseCount || "—"} exercises</span>
                            <i aria-hidden>•</i>
                            <span>{meta?.estimatedMinutes ? `~${meta.estimatedMinutes} min` : "Duration not set"}</span>
                            <i aria-hidden>•</i>
                            <span>Recommended {formatRecommendedDate(readiness.recommendedDate)}</span>
                          </div>
                        </div>

                        <div className="tr-sessionRight">
                          <ReadinessBadge readiness={readiness} compact />
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
              <div className="tr-upcomingLoading">No queued sessions returned for the active program.</div>
            )}

            <div className="tr-readinessFootnote">
              Readiness uses your logged muscle overlap, recent session difficulty, pain ratings, and time between completed workouts. Planned dates remain your schedule.
            </div>
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
          padding-bottom:18px;
        }
        .tr-trainingPageHead{
          display:flex;
          align-items:end;
          justify-content:space-between;
          gap:12px;
          padding:0 2px 2px;
        }
        .tr-trainingPageHeadCopy{
          color:rgba(206,220,232,.43);
          font-size:10px;
          font-weight:850;
          letter-spacing:.06em;
          text-transform:uppercase;
        }
        .tr-trainingError,
        .tr-trainingEmpty,
        .tr-nextHero,
        .tr-upcomingBoard{
          border:1px solid rgba(255,255,255,.095);
          background:
            radial-gradient(circle at 88% 0%, rgba(0,170,255,.08), transparent 34%),
            linear-gradient(145deg, rgba(18,24,34,.98), rgba(8,12,19,.995));
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
        .tr-trainingEmpty h2,
        .tr-upcomingHeader h2{
          margin:5px 0 0;
          font-size:clamp(22px,2vw,30px);
          letter-spacing:-.03em;
        }
        .tr-trainingEmpty p,
        .tr-upcomingHeader p{
          margin:6px 0 0;
          color:rgba(224,234,244,.64);
          line-height:1.45;
        }
        .tr-trainingSectionEyebrow{
          color:#67d4ff;
          font-size:12px;
          line-height:1;
          font-weight:1000;
          letter-spacing:.16em;
        }

        .tr-nextHero{
          position:relative;
          overflow:hidden;
          padding:22px;
          border-color:rgba(0,170,255,.27);
          box-shadow:
            0 30px 85px rgba(0,0,0,.42),
            0 0 0 1px rgba(0,170,255,.055) inset,
            inset 0 1px 0 rgba(255,255,255,.05);
        }
        .tr-nextHero::before{
          content:"";
          position:absolute;
          inset:0 auto 0 0;
          width:3px;
          background:linear-gradient(180deg,#63d9ff,#138fd8 56%,rgba(19,143,216,.08));
          box-shadow:0 0 24px rgba(0,170,255,.28);
        }
        .tr-nextHero::after{
          content:"";
          position:absolute;
          width:300px;
          height:300px;
          right:-130px;
          top:-170px;
          border-radius:50%;
          background:rgba(0,170,255,.07);
          filter:blur(20px);
          pointer-events:none;
        }
        .tr-nextHero.is-active::before{
          background:linear-gradient(180deg,#48e18d,#17a85f 60%,rgba(23,168,95,.08));
        }
        .tr-nextHeroTopline,
        .tr-nextHeroBody,
        .tr-nextHeroActions{
          position:relative;
          z-index:1;
        }
        .tr-nextHeroTopline{
          display:flex;
          align-items:flex-start;
          justify-content:space-between;
          gap:16px;
        }
        .tr-nextHeroSequence{
          margin-top:9px;
          color:rgba(255,255,255,.22);
          font-size:12px;
          font-weight:1000;
          letter-spacing:.2em;
        }
        .tr-nextHeroBody{
          display:grid;
          grid-template-columns:minmax(0,1.15fr) minmax(360px,.85fr);
          gap:26px;
          align-items:end;
          margin-top:24px;
        }
        .tr-nextHeroCopy h1{
          margin:0;
          font-size:clamp(32px,4.5vw,58px);
          line-height:.98;
          letter-spacing:-.045em;
          font-weight:1000;
          color:#f6fbff;
          text-shadow:0 8px 30px rgba(0,0,0,.42);
        }
        .tr-nextHeroProgram{
          margin-top:9px;
          color:rgba(228,238,248,.72);
          font-size:15px;
          font-weight:850;
          letter-spacing:.02em;
        }
        .tr-nextHeroMetrics{
          display:grid;
          grid-template-columns:repeat(2,minmax(0,1fr));
          gap:9px;
        }
        .tr-nextMetric{
          min-height:74px;
          padding:13px 14px;
          border:1px solid rgba(255,255,255,.075);
          border-radius:14px;
          background:linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.012));
          box-shadow:inset 0 1px 0 rgba(255,255,255,.025);
        }
        .tr-nextMetric span{
          display:block;
          color:rgba(188,204,218,.56);
          font-size:10px;
          font-weight:1000;
          letter-spacing:.13em;
        }
        .tr-nextMetric strong{
          display:block;
          margin-top:7px;
          color:#f4f9fd;
          font-size:15px;
          line-height:1.2;
          font-weight:950;
        }
        .tr-nextHeroActions{
          display:grid;
          grid-template-columns:minmax(0,1fr) 148px;
          gap:10px;
          margin-top:20px;
        }

        .tr-scheduleMuscles{
          display:flex;
          flex-wrap:wrap;
          gap:9px;
          margin-top:18px;
        }
        .tr-scheduleMuscle{
          display:flex;
          align-items:center;
          gap:8px;
          min-height:38px;
          padding:6px 11px 6px 7px;
          border:1px solid rgba(0,170,255,.16);
          border-radius:12px;
          background:rgba(0,170,255,.055);
          color:rgba(240,248,255,.88);
          font-size:11px;
          font-weight:950;
          letter-spacing:.045em;
          text-transform:uppercase;
        }
        .tr-scheduleMuscleIcon{
          width:26px;
          height:26px;
          display:grid;
          place-items:center;
          border-radius:8px;
          background:rgba(0,170,255,.09);
          box-shadow:inset 0 0 0 1px rgba(0,170,255,.09);
        }
        .tr-scheduleMuscleIcon img{
          width:21px;
          height:21px;
          object-fit:contain;
          filter:drop-shadow(0 3px 8px rgba(0,170,255,.16));
        }
        .tr-scheduleMuscles.is-compact{
          margin-top:11px;
          gap:7px;
        }
        .tr-scheduleMuscles.is-compact .tr-scheduleMuscle{
          min-height:32px;
          padding:4px 9px 4px 5px;
          font-size:10px;
          border-color:rgba(255,255,255,.075);
          background:rgba(255,255,255,.025);
        }
        .tr-scheduleMuscles.is-compact .tr-scheduleMuscleIcon{
          width:22px;
          height:22px;
          background:rgba(0,170,255,.055);
        }
        .tr-scheduleMuscles.is-compact .tr-scheduleMuscleIcon img{
          width:18px;
          height:18px;
        }
        .tr-scheduleNoMuscles{
          margin-top:14px;
          color:rgba(207,220,233,.48);
          font-size:12px;
          font-weight:750;
        }

        .tr-readiness{
          display:flex;
          align-items:flex-start;
          gap:9px;
          min-width:220px;
          max-width:330px;
          padding:10px 12px;
          border-radius:13px;
          border:1px solid rgba(255,255,255,.08);
          background:rgba(255,255,255,.025);
        }
        .tr-readinessDot{
          width:8px;
          height:8px;
          flex:0 0 8px;
          margin-top:4px;
          border-radius:50%;
          background:#69d6ff;
          box-shadow:0 0 14px rgba(105,214,255,.48);
        }
        .tr-readiness strong{
          display:block;
          color:#dff6ff;
          font-size:10px;
          letter-spacing:.11em;
          font-weight:1000;
        }
        .tr-readiness span:not(.tr-readinessDot){
          display:block;
          margin-top:4px;
          color:rgba(220,232,242,.58);
          font-size:11px;
          line-height:1.35;
          font-weight:750;
        }
        .tr-readiness--ready{
          border-color:rgba(58,220,131,.19);
          background:rgba(58,220,131,.055);
        }
        .tr-readiness--ready .tr-readinessDot{
          background:#44dd88;
          box-shadow:0 0 15px rgba(68,221,136,.44);
        }
        .tr-readiness--ready strong{ color:#8df2bb; }
        .tr-readiness--soon,
        .tr-readiness--monitor{
          border-color:rgba(224,181,92,.2);
          background:rgba(224,181,92,.045);
        }
        .tr-readiness--soon .tr-readinessDot,
        .tr-readiness--monitor .tr-readinessDot{
          background:#e1bc72;
          box-shadow:0 0 14px rgba(225,188,114,.35);
        }
        .tr-readiness--soon strong,
        .tr-readiness--monitor strong{ color:#f1d39a; }
        .tr-readiness--recovering{
          border-color:rgba(240,166,64,.23);
          background:rgba(240,166,64,.055);
        }
        .tr-readiness--recovering .tr-readinessDot{
          background:#f0a640;
          box-shadow:0 0 14px rgba(240,166,64,.35);
        }
        .tr-readiness--recovering strong{ color:#ffc46f; }
        .tr-readiness.is-compact{
          min-width:0;
          max-width:none;
          padding:7px 9px;
          border-radius:10px;
          white-space:nowrap;
        }
        .tr-readiness.is-compact .tr-readinessDot{ margin-top:2px; }

        .tr-scheduleBtn{
          appearance:none;
          border:0;
          border-radius:13px;
          min-height:48px;
          padding:0 18px;
          cursor:pointer;
          font:inherit;
          font-size:12px;
          font-weight:1000;
          letter-spacing:.055em;
          transition:transform .16s ease, border-color .16s ease, box-shadow .16s ease, background .16s ease;
        }
        .tr-scheduleBtn:hover{ transform:translateY(-1px); }
        .tr-scheduleBtn:active{ transform:translateY(0) scale(.99); }
        .tr-scheduleBtn:disabled{ opacity:.45; cursor:not-allowed; transform:none; }
        .tr-scheduleBtn--primary{
          color:#061019;
          background:linear-gradient(180deg,#67ddff,#29a9ef);
          box-shadow:
            0 14px 32px rgba(0,170,255,.18),
            inset 0 1px 0 rgba(255,255,255,.42);
        }
        .tr-scheduleBtn--edit,
        .tr-scheduleBtn--rowEdit{
          color:#c9eefe;
          border:1px solid rgba(0,170,255,.24);
          background:rgba(0,170,255,.055);
          box-shadow:inset 0 1px 0 rgba(255,255,255,.025);
        }
        .tr-scheduleBtn--rowStart{
          min-height:40px;
          color:#dff7ff;
          border:1px solid rgba(0,170,255,.23);
          background:linear-gradient(180deg,rgba(0,170,255,.14),rgba(0,170,255,.065));
          box-shadow:0 10px 25px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.03);
        }
        .tr-scheduleBtn--rowEdit{
          min-height:40px;
          color:rgba(211,225,236,.72);
          border-color:rgba(255,255,255,.08);
          background:rgba(255,255,255,.025);
        }

        .tr-upcomingBoard{
          padding:20px;
        }
        .tr-upcomingHeader{
          display:flex;
          align-items:flex-end;
          justify-content:space-between;
          gap:20px;
          padding-bottom:16px;
          border-bottom:1px solid rgba(255,255,255,.06);
        }
        .tr-rotationStrip{
          max-width:520px;
          text-align:right;
        }
        .tr-rotationStrip > span{
          display:block;
          color:rgba(187,204,219,.42);
          font-size:9px;
          font-weight:1000;
          letter-spacing:.14em;
        }
        .tr-rotationStrip > div{
          display:flex;
          align-items:center;
          justify-content:flex-end;
          flex-wrap:wrap;
          gap:6px;
          margin-top:6px;
        }
        .tr-rotationStrip > div > span{
          display:flex;
          align-items:center;
          gap:6px;
          color:rgba(231,240,247,.69);
          font-size:10px;
          font-weight:900;
          text-transform:uppercase;
        }
        .tr-rotationStrip b{
          color:#4cc8fb;
          font-size:15px;
          line-height:1;
        }
        .tr-upcomingLoading{
          padding:22px 2px 4px;
          color:rgba(214,227,238,.58);
          font-weight:800;
        }
        .tr-trainingTimeline{
          display:grid;
          margin-top:12px;
        }
        .tr-trainingTimelineRow{
          display:grid;
          grid-template-columns:62px minmax(0,1fr);
          min-height:124px;
        }
        .tr-timelineRail{
          position:relative;
          display:flex;
          justify-content:center;
        }
        .tr-timelineNumber{
          position:absolute;
          top:23px;
          left:0;
          width:29px;
          color:rgba(220,234,245,.38);
          font-size:11px;
          font-weight:1000;
          letter-spacing:.12em;
        }
        .tr-timelineNode{
          position:absolute;
          top:27px;
          left:39px;
          width:9px;
          height:9px;
          border-radius:50%;
          border:2px solid #48c9ff;
          background:#0d141d;
          box-shadow:0 0 14px rgba(72,201,255,.25);
          z-index:2;
        }
        .tr-trainingTimelineRow.is-soon .tr-timelineNode,
        .tr-trainingTimelineRow.is-monitor .tr-timelineNode{
          border-color:#e1bc72;
          box-shadow:0 0 14px rgba(225,188,114,.2);
        }
        .tr-trainingTimelineRow.is-recovering .tr-timelineNode{
          border-color:#f0a640;
          box-shadow:0 0 14px rgba(240,166,64,.22);
        }
        .tr-timelineLine{
          position:absolute;
          top:36px;
          bottom:-25px;
          left:43px;
          width:1px;
          background:linear-gradient(180deg,rgba(72,201,255,.22),rgba(255,255,255,.055));
        }
        .tr-sessionCard{
          display:grid;
          grid-template-columns:minmax(0,1fr) auto;
          gap:18px;
          align-items:center;
          margin:5px 0 10px;
          padding:16px 17px;
          border:1px solid rgba(255,255,255,.065);
          border-radius:15px;
          background:
            linear-gradient(105deg,rgba(255,255,255,.032),rgba(255,255,255,.012));
          box-shadow:inset 0 1px 0 rgba(255,255,255,.025);
          transition:border-color .16s ease, transform .16s ease, background .16s ease;
        }
        .tr-sessionCard:hover{
          transform:translateY(-1px);
          border-color:rgba(0,170,255,.17);
          background:linear-gradient(105deg,rgba(0,170,255,.04),rgba(255,255,255,.012));
        }
        .tr-sessionPrimary{ min-width:0; }
        .tr-sessionTitleRow{
          display:flex;
          align-items:flex-start;
          justify-content:space-between;
          gap:16px;
        }
        .tr-sessionTitleRow h3{
          margin:0;
          color:#f5f9fc;
          font-size:18px;
          line-height:1.08;
          letter-spacing:-.015em;
          font-weight:1000;
        }
        .tr-sessionTitleRow p{
          margin:4px 0 0;
          color:rgba(208,222,233,.55);
          font-size:11px;
          font-weight:800;
        }
        .tr-sessionDate{
          flex:0 0 auto;
          color:#cceeff;
          font-size:11px;
          font-weight:1000;
          letter-spacing:.06em;
          text-transform:uppercase;
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
          color:rgba(93,204,247,.45);
          font-style:normal;
        }
        .tr-sessionRight{
          display:grid;
          gap:9px;
          min-width:238px;
        }
        .tr-sessionActions{
          display:grid;
          grid-template-columns:minmax(0,1fr) 82px;
          gap:8px;
        }
        .tr-readinessFootnote{
          margin:11px 0 0 62px;
          padding-top:12px;
          border-top:1px solid rgba(255,255,255,.05);
          color:rgba(188,205,220,.4);
          font-size:9px;
          line-height:1.45;
          font-weight:700;
        }

        @media (max-width:900px){
          .tr-nextHeroBody{
            grid-template-columns:1fr;
            gap:18px;
          }
          .tr-upcomingHeader{
            align-items:flex-start;
            flex-direction:column;
          }
          .tr-rotationStrip{
            max-width:none;
            text-align:left;
          }
          .tr-rotationStrip > div{ justify-content:flex-start; }
        }

        @media (max-width:680px){
          .tr-trainingBoard{ gap:12px; }
          .tr-trainingPageHead{
            align-items:flex-start;
            flex-direction:column;
            gap:5px;
            padding-left:2px;
          }
          .tr-trainingPageHeadCopy{ font-size:8.5px; }
          .tr-nextHero,
          .tr-upcomingBoard{
            border-radius:16px;
          }
          .tr-nextHero{
            padding:17px 14px 15px;
          }
          .tr-nextHeroTopline{
            align-items:flex-start;
          }
          .tr-nextHeroTopline .tr-readiness{
            min-width:0;
            width:auto;
            max-width:55%;
            padding:8px 9px;
          }
          .tr-nextHeroTopline .tr-readiness span:not(.tr-readinessDot){
            display:none;
          }
          .tr-nextHeroBody{ margin-top:17px; }
          .tr-nextHeroCopy h1{
            font-size:clamp(31px,10.5vw,44px);
          }
          .tr-nextHeroProgram{
            margin-top:7px;
            font-size:12px;
          }
          .tr-scheduleMuscles{
            display:grid;
            grid-template-columns:repeat(3,minmax(0,1fr));
            gap:6px;
            margin-top:14px;
          }
          .tr-scheduleMuscle{
            justify-content:flex-start;
            min-width:0;
            min-height:36px;
            padding:5px 6px;
            font-size:9px;
            overflow:hidden;
          }
          .tr-scheduleMuscleIcon{
            width:24px;
            height:24px;
            flex:0 0 24px;
          }
          .tr-scheduleMuscleIcon img{
            width:19px;
            height:19px;
          }
          .tr-nextHeroMetrics{
            grid-template-columns:repeat(2,minmax(0,1fr));
            gap:7px;
          }
          .tr-nextMetric{
            min-height:67px;
            padding:11px;
            border-radius:12px;
          }
          .tr-nextMetric strong{ font-size:13px; }
          .tr-nextHeroActions{
            grid-template-columns:minmax(0,1fr) 88px;
            gap:8px;
            margin-top:14px;
          }
          .tr-scheduleBtn{
            min-height:45px;
            border-radius:11px;
            padding:0 12px;
            font-size:11px;
          }

          .tr-upcomingBoard{
            padding:16px 12px 15px;
          }
          .tr-upcomingHeader h2{
            font-size:23px;
          }
          .tr-upcomingHeader p{
            font-size:11px;
          }
          .tr-rotationStrip{
            width:100%;
            overflow:hidden;
          }
          .tr-rotationStrip > div{
            flex-wrap:nowrap;
            overflow-x:auto;
            scrollbar-width:none;
            padding-bottom:2px;
          }
          .tr-rotationStrip > div::-webkit-scrollbar{ display:none; }
          .tr-rotationStrip > div > span{ flex:0 0 auto; }

          .tr-trainingTimeline{
            gap:8px;
            margin-top:12px;
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
            margin:0;
            padding:13px;
            border-radius:13px;
          }
          .tr-sessionTitleRow{
            gap:10px;
          }
          .tr-sessionTitleRow h3{
            font-size:17px;
          }
          .tr-sessionTitleRow p{
            font-size:10px;
          }
          .tr-sessionDate{
            font-size:9px;
            padding-top:2px;
          }
          .tr-scheduleMuscles.is-compact{
            display:flex;
            flex-wrap:wrap;
            margin-top:9px;
          }
          .tr-scheduleMuscles.is-compact .tr-scheduleMuscle{
            flex:0 0 auto;
            width:auto;
            min-height:28px;
            font-size:9px;
          }
          .tr-sessionMeta{
            margin-top:8px;
            gap:5px;
            font-size:9px;
          }
          .tr-sessionRight{
            display:grid;
            grid-template-columns:minmax(0,1fr) auto;
            align-items:center;
            gap:8px;
            min-width:0;
            margin-top:10px;
            padding-top:10px;
            border-top:1px solid rgba(255,255,255,.05);
          }
          .tr-sessionRight .tr-readiness.is-compact{
            justify-self:start;
            min-width:0;
          }
          .tr-sessionActions{
            grid-template-columns:74px 60px;
            gap:6px;
          }
          .tr-sessionActions .tr-scheduleBtn{
            min-height:36px;
            padding:0 8px;
            font-size:9px;
          }
          .tr-readinessFootnote{
            margin:11px 0 0;
            font-size:8.5px;
          }
        }
      `}</style>
    </div>
  );
}
