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

type SessionRow = {
  id: string;
  template_id: string | null;
  session_type: string | null;
  date: string | null;
  program_block_id: string | null;
};

type TemplateRow = {
  id: string;
  name: string | null;
  estimated_minutes: number | null;
  focus_tags: string[] | null;
};

type TemplateExerciseRow = {
  template_id: string;
  exercise_id: string;
  order_index: number | null;
  sets: number | null;
  rep_min: number | null;
  rep_max: number | null;
  rest_seconds: number | null;
};

type ExerciseRow = {
  id: string;
  primary_muscles: string[] | null;
  secondary_muscles: string[] | null;
};

type MuscleFocus = {
  key: string;
  label: string;
  icon: string;
  score: number;
};

type SessionMeta = {
  id: string;
  templateId: string | null;
  templateName: string | null;
  exerciseCount: number;
  totalSets: number;
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

type ReadinessTone = "ready" | "monitor" | "recovering";

type Readiness = {
  label: string;
  tone: ReadinessTone;
  detail: string;
};

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

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

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
  ) return "back";
  if (value.includes("quad")) return "quads";
  if (value.includes("hamstring")) return "hamstrings";
  if (value.includes("glute")) return "glutes";
  if (value.includes("calf") || value.includes("soleus") || value.includes("gastro")) return "calves";
  if (value.includes("adductor")) return "adductors";
  if (value.includes("abductor")) return "abductors";
  if (value.includes("abdominal") || value === "abs" || value.includes("rectus abdominis")) return "abs";
  if (value.includes("core") || value.includes("oblique")) return "core";
  if (value.includes("leg")) return "legs";
  return null;
}

function parseDate(raw: unknown) {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const safe = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value;
  const date = new Date(safe);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatAppDate(raw: unknown) {
  const date = parseDate(raw);
  if (!date) return "DATE NOT SET";
  return `${date.getMonth() + 1}/${String(date.getDate()).padStart(2, "0")}/${date.getFullYear()}`;
}

function isSameDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate();
}

function scheduleDateLabel(raw: unknown) {
  const date = parseDate(raw);
  if (!date) return "DATE NOT SET";
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (isSameDay(date, today)) return `TODAY • ${formatAppDate(date)}`;
  if (isSameDay(date, tomorrow)) return `TOMORROW • ${formatAppDate(date)}`;
  return formatAppDate(date);
}

function splitLabel(label: string) {
  const parts = String(label ?? "")
    .replace(/\s+[—–-]\s+/g, " • ")
    .split("•")
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    title: parts[0] || "Workout",
    subtitle: parts.slice(1).join(" • "),
  };
}

function formatDuration(minutes: number | null) {
  if (!minutes || !Number.isFinite(minutes)) return "—";
  const total = Math.max(1, Math.round(minutes));
  if (total < 60) return `~${total} MIN`;
  const hours = Math.floor(total / 60);
  const remainder = total % 60;
  return remainder ? `~${hours} HR ${remainder} MIN` : `~${hours} HR`;
}

function estimateMinutes(rows: TemplateExerciseRow[]) {
  if (!rows.length) return null;
  let seconds = 75;
  rows.forEach((row, index) => {
    const sets = Math.max(1, Number(row.sets ?? 3));
    const repMin = Math.max(1, Number(row.rep_min ?? 8));
    const repMax = Math.max(repMin, Number(row.rep_max ?? repMin));
    const reps = (repMin + repMax) / 2;
    const rest = Math.max(0, Math.min(300, Number(row.rest_seconds ?? 60)));
    const work = Math.min(90, Math.max(25, reps * 4.5));
    seconds += sets * (work + 12) + Math.max(0, sets - 1) * rest;
    if (index < rows.length - 1) seconds += 50;
  });
  return Math.max(15, Math.ceil(seconds / 300) * 5);
}

function summarizeSession(
  session: SessionRow,
  templates: Map<string, TemplateRow>,
  templateExercises: Map<string, TemplateExerciseRow[]>,
  exercises: Map<string, ExerciseRow>
): SessionMeta {
  const templateId = session.template_id;
  const template = templateId ? templates.get(templateId) ?? null : null;
  const rows = templateId ? templateExercises.get(templateId) ?? [] : [];
  const scores = new Map<string, number>();

  const add = (raw: unknown, score: number) => {
    const key = muscleKey(raw);
    if (!key) return;
    scores.set(key, (scores.get(key) ?? 0) + score);
  };

  rows.forEach((row) => {
    const exercise = exercises.get(row.exercise_id);
    (exercise?.primary_muscles ?? []).forEach((muscle) => add(muscle, 1));
    (exercise?.secondary_muscles ?? []).forEach((muscle) => add(muscle, 0.22));
  });
  (template?.focus_tags ?? []).forEach((tag) => add(tag, 0.18));

  const ranked = Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([key, score]) => ({
      key,
      score,
      label: MUSCLE_DEFS[key]?.label ?? key,
      icon: MUSCLE_DEFS[key]?.icon ?? icoLegs,
    }));

  const primary = ranked.filter((item) => item.score >= 0.85);
  const muscles = (primary.length ? primary : ranked).slice(0, 5);
  const calculatedMinutes = rows.length ? estimateMinutes(rows) : null;

  return {
    id: session.id,
    templateId,
    templateName: template?.name ?? null,
    exerciseCount: rows.length,
    totalSets: rows.reduce((sum, row) => sum + Math.max(0, Number(row.sets ?? 0)), 0),
    estimatedMinutes: calculatedMinutes ?? (Number(template?.estimated_minutes ?? 0) || null),
    muscles,
    allMuscleKeys: ranked.filter((item) => item.score >= 0.65).map((item) => item.key),
  };
}

function readinessFor(meta: SessionMeta | null, history: HistorySignal[]) : Readiness {
  if (!meta || !meta.allMuscleKeys.length) {
    return { label: "READY TO TRAIN", tone: "ready", detail: "Workout is available." };
  }
  const target = new Set(meta.allMuscleKeys);
  const now = Date.now();
  const related = history
    .filter((item) => item.templateId)
    .filter((item) => {
      const ageHours = (now - new Date(item.completedAt).getTime()) / 3_600_000;
      return Number.isFinite(ageHours) && ageHours <= 72;
    })
    .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());

  for (const item of related) {
    if (!item.templateId) continue;
    const ageHours = (now - new Date(item.completedAt).getTime()) / 3_600_000;
    if (item.maxPain >= 5 && ageHours < 48) {
      return { label: "RECOVERY CHECK", tone: "recovering", detail: "Recent pain was elevated. Review readiness before starting." };
    }
    if ((item.postDifficulty === "too_hard" || item.maxPain >= 3) && ageHours < 30) {
      return { label: "MONITOR RECOVERY", tone: "monitor", detail: "Recent training was demanding. Keep the first working sets controlled." };
    }
  }

  void target;
  return { label: "READY TO TRAIN", tone: "ready", detail: "No recent recovery flag is blocking this workout." };
}

function MuscleStrip({ muscles }: { muscles: MuscleFocus[] }) {
  if (!muscles.length) return <div className="trp-noMuscles">Muscle focus updates from the exercises.</div>;
  return (
    <div className="trp-muscles" aria-label="Primary muscle groups">
      {muscles.map((muscle) => (
        <div key={muscle.key} className="trp-muscle">
          <span className="trp-muscleIcon"><img src={muscle.icon} alt="" aria-hidden /></span>
          <span>{muscle.label}</span>
        </div>
      ))}
    </div>
  );
}

function MetricIcon({ kind }: { kind: "exercise" | "sets" | "time" }) {
  if (kind === "time") {
    return <svg viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/></svg>;
  }
  if (kind === "sets") {
    return <svg viewBox="0 0 24 24" aria-hidden><path d="M6 7h12M6 12h12M6 17h12"/><path d="M3.5 7h.1M3.5 12h.1M3.5 17h.1"/></svg>;
  }
  return <svg viewBox="0 0 24 24" aria-hidden><path d="M7 8v8M17 8v8M4 10v4M20 10v4M7 12h10"/></svg>;
}

export function TodayPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueDash | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSessionType, setActiveSessionType] = useState<string | null>(null);
  const [symptomKey, setSymptomKey] = useState<SymptomKey | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [metaBySession, setMetaBySession] = useState<Map<string, SessionMeta>>(new Map());
  const [history, setHistory] = useState<HistorySignal[]>([]);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);

  async function loadLatestSymptom(goalMode: string | null, userId: string) {
    if (!isSymptomMode(goalMode)) return null;
    const { data } = await supabase
      .from("intake_snapshots")
      .select("symptoms,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return inferSymptomKey((data as any)?.symptoms ?? null);
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!auth.user) throw new Error("Sign in to view workouts.");
      const userId = auth.user.id;

      const [{ data: active, error: activeError }, { data: queueData, error: queueError }] = await Promise.all([
        supabase
          .from("workouts")
          .select("id,scheduled_session_id,started_at")
          .eq("user_id", userId)
          .is("completed_at", null)
          .not("started_at", "is", null)
          .order("started_at", { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle(),
        supabase.rpc("rpc_queue_dashboard", { p_keep: 7 }),
      ]);
      if (activeError) throw activeError;
      if (queueError) throw queueError;

      const nextQueue: QueueDash = {
        activeBlock: (queueData as any)?.activeBlock ?? null,
        nextSession: (queueData as any)?.nextSession ?? null,
        upcoming: Array.isArray((queueData as any)?.upcoming) ? (queueData as any).upcoming : [],
      };
      setQueue(nextQueue);

      const nextActiveId = (active as any)?.scheduled_session_id ? String((active as any).scheduled_session_id) : null;
      setActiveSessionId(nextActiveId);

      const sessionCandidates = [
        ...(nextActiveId ? [{ id: nextActiveId }] : []),
        ...(nextQueue.nextSession?.id ? [nextQueue.nextSession] : []),
        ...nextQueue.upcoming,
      ];
      const ids = unique(sessionCandidates.map((row: any) => String(row?.id ?? "")).filter(Boolean));

      let sessionRows: SessionRow[] = [];
      if (ids.length) {
        const { data, error: sessionError } = await supabase
          .from("scheduled_sessions")
          .select("id,template_id,session_type,date,program_block_id")
          .eq("user_id", userId)
          .in("id", ids);
        if (sessionError) throw sessionError;
        sessionRows = (data ?? []) as SessionRow[];
      }

      if (nextActiveId) {
        const activeSession = sessionRows.find((row) => row.id === nextActiveId);
        setActiveSessionType(activeSession?.session_type ?? null);
      } else {
        setActiveSessionType(null);
      }

      const templateIds = unique(sessionRows.map((row) => row.template_id).filter((id): id is string => Boolean(id)));
      const templates = new Map<string, TemplateRow>();
      const templateExercises = new Map<string, TemplateExerciseRow[]>();
      const exercises = new Map<string, ExerciseRow>();

      if (templateIds.length) {
        const [{ data: templateData, error: templateError }, { data: templateExerciseData, error: templateExerciseError }] = await Promise.all([
          supabase
            .from("workout_templates")
            .select("id,name,estimated_minutes,focus_tags")
            .in("id", templateIds),
          supabase
            .from("template_exercises")
            .select("template_id,exercise_id,order_index,sets,rep_min,rep_max,rest_seconds")
            .in("template_id", templateIds)
            .order("order_index", { ascending: true }),
        ]);
        if (templateError) throw templateError;
        if (templateExerciseError) throw templateExerciseError;
        (templateData ?? []).forEach((row: any) => templates.set(String(row.id), row as TemplateRow));
        (templateExerciseData ?? []).forEach((raw: any) => {
          const row = raw as TemplateExerciseRow;
          const list = templateExercises.get(row.template_id) ?? [];
          list.push(row);
          templateExercises.set(row.template_id, list);
        });

        const exerciseIds = unique((templateExerciseData ?? []).map((row: any) => String(row.exercise_id ?? "")).filter(Boolean));
        if (exerciseIds.length) {
          const { data: exerciseData, error: exerciseError } = await supabase
            .from("exercises")
            .select("id,primary_muscles,secondary_muscles")
            .in("id", exerciseIds);
          if (exerciseError) throw exerciseError;
          (exerciseData ?? []).forEach((row: any) => exercises.set(String(row.id), row as ExerciseRow));
        }
      }

      const metaMap = new Map<string, SessionMeta>();
      sessionRows.forEach((session) => metaMap.set(session.id, summarizeSession(session, templates, templateExercises, exercises)));
      setSessions(sessionRows);
      setMetaBySession(metaMap);

      const { data: completedData, error: completedError } = await supabase
        .from("workouts")
        .select("id,scheduled_session_id,completed_at,post_difficulty")
        .eq("user_id", userId)
        .not("completed_at", "is", null)
        .order("completed_at", { ascending: false })
        .limit(24);
      if (completedError) throw completedError;
      const completed = completedData ?? [];
      const completedWorkoutIds = completed.map((row: any) => String(row.id));
      const painByWorkout = new Map<string, number>();
      if (completedWorkoutIds.length) {
        const { data: painData } = await supabase
          .from("workout_exercises")
          .select("workout_id,pain")
          .in("workout_id", completedWorkoutIds);
        (painData ?? []).forEach((row: any) => {
          const workoutId = String(row.workout_id ?? "");
          const pain = Number(row.pain ?? 0);
          if (!workoutId || !Number.isFinite(pain)) return;
          painByWorkout.set(workoutId, Math.max(painByWorkout.get(workoutId) ?? 0, pain));
        });
      }

      const allCompletedSessionIds = unique(completed.map((row: any) => String(row.scheduled_session_id ?? "")).filter(Boolean));
      const completedSessionTemplate = new Map<string, string | null>();
      if (allCompletedSessionIds.length) {
        const { data: completedSessionData } = await supabase
          .from("scheduled_sessions")
          .select("id,template_id")
          .in("id", allCompletedSessionIds);
        (completedSessionData ?? []).forEach((row: any) => completedSessionTemplate.set(String(row.id), row.template_id ? String(row.template_id) : null));
      }
      setHistory(completed.map((row: any) => ({
        completedAt: String(row.completed_at),
        templateId: completedSessionTemplate.get(String(row.scheduled_session_id ?? "")) ?? null,
        postDifficulty: row.post_difficulty ? String(row.post_difficulty) : null,
        maxPain: painByWorkout.get(String(row.id)) ?? 0,
      })));

      const goalMode = nextQueue.activeBlock?.goal_mode ? String(nextQueue.activeBlock.goal_mode) : null;
      setSymptomKey(await loadLatestSymptom(goalMode, userId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load workouts.");
      setQueue(null);
      setSessions([]);
      setMetaBySession(new Map());
      setActiveSessionId(null);
      setActiveSessionType(null);
      setSymptomKey(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const goal = queue?.activeBlock?.goal ? String(queue.activeBlock.goal) : null;
  const goalMode = queue?.activeBlock?.goal_mode ? String(queue.activeBlock.goal_mode) : null;
  const hasProgram = Boolean(queue?.activeBlock?.id);

  const sessionById = useMemo(() => new Map(sessions.map((session) => [session.id, session] as const)), [sessions]);

  const upcoming = useMemo(() => {
    const ids: string[] = [];
    if (queue?.nextSession?.id) ids.push(String(queue.nextSession.id));
    (queue?.upcoming ?? []).forEach((row: any) => {
      if (row?.id) ids.push(String(row.id));
    });
    return unique(ids)
      .filter((id) => id !== activeSessionId)
      .map((id) => sessionById.get(id))
      .filter((row): row is SessionRow => Boolean(row))
      .slice(0, 7);
  }, [queue, activeSessionId, sessionById]);

  const nextSession = upcoming[0] ?? null;
  const activeSession = activeSessionId ? sessionById.get(activeSessionId) ?? null : null;
  const activeMeta = activeSessionId ? metaBySession.get(activeSessionId) ?? null : null;
  const nextMeta = nextSession ? metaBySession.get(nextSession.id) ?? null : null;

  const activeLabel = splitLabel(formatSessionLabel({
    sessionType: activeSession?.session_type ?? activeSessionType ?? "Workout",
    goal,
    goalMode,
    symptomKey,
  }));
  const nextLabel = splitLabel(formatSessionLabel({
    sessionType: nextSession?.session_type ?? "Workout",
    goal,
    goalMode,
    symptomKey,
  }));

  const primaryReadiness = readinessFor(activeMeta ?? nextMeta, history);

  function openSession(sessionId: string) {
    window.location.pathname = `/workout/${sessionId}`;
  }

  return (
    <main className="trp-page">
      <header className="trp-pageHead">
        <div>
          <span>WORKOUTS</span>
          <h1>Training</h1>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}>{loading ? "REFRESHING…" : "REFRESH"}</button>
      </header>

      {error ? <div className="trp-alert">{error}</div> : null}

      {!loading && !hasProgram ? (
        <section className="trp-empty">
          <span>PROGRAM REQUIRED</span>
          <h2>No active program</h2>
          <p>Generate a program in Coach to build your training schedule.</p>
          <button type="button" onClick={() => (window.location.pathname = "/coach")}>OPEN COACH</button>
        </section>
      ) : null}

      {hasProgram ? (
        <>
          <section className={`trp-primaryCard ${activeSessionId ? "is-active" : "is-next"}`}>
            <div className="trp-cardAccent" aria-hidden />
            <div className="trp-primaryTop">
              <div>
                <span>{activeSessionId ? "ACTIVE WORKOUT" : "NEXT WORKOUT"}</span>
                <div className={`trp-readiness is-${primaryReadiness.tone}`}><i />{activeSessionId ? "IN PROGRESS" : primaryReadiness.label}</div>
              </div>
              {!activeSessionId && nextSession ? <div className="trp-dateBadge">{scheduleDateLabel(nextSession.date)}</div> : null}
            </div>

            <div className="trp-primaryBody">
              <div className="trp-primaryCopy">
                <h2>{activeSessionId ? activeLabel.title : nextLabel.title}</h2>
                {(activeSessionId ? activeLabel.subtitle : nextLabel.subtitle) ? (
                  <p className="trp-programLine">{activeSessionId ? activeLabel.subtitle : nextLabel.subtitle}</p>
                ) : null}
                <MuscleStrip muscles={(activeMeta ?? nextMeta)?.muscles ?? []} />
              </div>

              <div className="trp-primaryMetrics">
                <article><MetricIcon kind="exercise"/><div><strong>{(activeMeta ?? nextMeta)?.exerciseCount || "—"}</strong><span>EXERCISES</span></div></article>
                <article><MetricIcon kind="sets"/><div><strong>{(activeMeta ?? nextMeta)?.totalSets || "—"}</strong><span>SETS</span></div></article>
                <article><MetricIcon kind="time"/><div><strong>{activeSessionId ? "LIVE" : formatDuration(nextMeta?.estimatedMinutes ?? null)}</strong><span>{activeSessionId ? "SESSION" : "EST. TIME"}</span></div></article>
              </div>
            </div>

            {!activeSessionId ? <p className="trp-readinessCopy">{primaryReadiness.detail}</p> : null}

            <div className="trp-primaryActions">
              <button
                type="button"
                className="trp-primaryAction"
                disabled={!activeSessionId && !nextSession}
                onClick={() => {
                  const id = activeSessionId ?? nextSession?.id;
                  if (id) openSession(id);
                }}
              >
                <span aria-hidden>▶</span>{activeSessionId ? "RESUME WORKOUT" : "START WORKOUT"}
              </button>
              {(activeSessionId ?? nextSession?.id) ? (
                <button type="button" className="trp-editAction" onClick={() => setEditingSessionId(activeSessionId ?? nextSession!.id)}>
                  <span aria-hidden>✎</span>EDIT EXERCISES
                </button>
              ) : null}
            </div>
          </section>

          <section className="trp-upcomingSection">
            <header className="trp-sectionHead">
              <div><span>UPCOMING TRAINING</span><h2>Coming Up</h2></div>
              <small>{upcoming.length} scheduled</small>
            </header>

            {loading ? <div className="trp-loading">Loading training schedule…</div> : upcoming.length ? (
              <div className="trp-upcomingGrid">
                {upcoming.map((session, index) => {
                  const meta = metaBySession.get(session.id) ?? null;
                  const label = splitLabel(formatSessionLabel({
                    sessionType: session.session_type ?? "Workout",
                    goal,
                    goalMode,
                    symptomKey,
                  }));
                  const readiness = readinessFor(meta, history);
                  return (
                    <article className={`trp-sessionCard ${index === 0 ? "is-first" : ""}`} key={session.id}>
                      <div className="trp-sessionTop">
                        <div>
                          <span className="trp-sequence">{index === 0 ? "NEXT UP" : `UPCOMING ${index + 1}`}</span>
                          <div className={`trp-readiness is-${readiness.tone}`}><i />{readiness.label}</div>
                        </div>
                        <div className="trp-sessionDate">{scheduleDateLabel(session.date)}</div>
                      </div>

                      <div className="trp-sessionTitle">
                        <h3>{label.title}</h3>
                        {label.subtitle ? <p>{label.subtitle}</p> : null}
                      </div>

                      <MuscleStrip muscles={meta?.muscles ?? []} />

                      <div className="trp-sessionStats">
                        <div><MetricIcon kind="exercise"/><span><strong>{meta?.exerciseCount || "—"}</strong><small>EXERCISES</small></span></div>
                        <div><MetricIcon kind="sets"/><span><strong>{meta?.totalSets || "—"}</strong><small>SETS</small></span></div>
                        <div><MetricIcon kind="time"/><span><strong>{formatDuration(meta?.estimatedMinutes ?? null)}</strong><small>EST. TIME</small></span></div>
                      </div>

                      <div className="trp-sessionActions">
                        <button type="button" className="trp-startSmall" onClick={() => openSession(session.id)}>START WORKOUT</button>
                        <button type="button" className="trp-editSmall" onClick={() => setEditingSessionId(session.id)}><span aria-hidden>✎</span>EDIT EXERCISES</button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : <div className="trp-loading">No upcoming sessions.</div>}
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
        .trp-page{
          --trp-cyan:#59d8ff;--trp-green:#69e6a5;--trp-amber:#f0b258;--trp-red:#ff747a;
          width:min(1180px,calc(100% - 28px));margin:0 auto 120px;display:grid;gap:14px;color:#f7fbfd;min-width:0;
        }
        .trp-page,.trp-page *{box-sizing:border-box}.trp-page *{min-width:0}.trp-page button{font:inherit;cursor:pointer}.trp-page button:disabled{cursor:not-allowed;opacity:.45}
        .trp-pageHead{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;padding:2px 2px 0}.trp-pageHead>div{display:grid;gap:4px}.trp-pageHead span,.trp-sectionHead span,.trp-empty>span{color:#93dff8;font-size:10px;line-height:1;font-weight:1000;letter-spacing:.16em}.trp-pageHead h1{margin:0;font-size:clamp(29px,3vw,42px);line-height:1;letter-spacing:-.04em}.trp-pageHead>button{min-height:38px;padding:0 13px;border:1px solid rgba(255,255,255,.1);border-radius:10px;background:#0a1117;color:#d9edf4;font-size:10px;font-weight:950;letter-spacing:.06em}
        .trp-alert,.trp-empty{border:1px solid rgba(255,116,122,.28);border-radius:16px;background:rgba(255,80,90,.07);padding:16px;color:#ffe8e9}.trp-empty{display:grid;gap:8px;border-color:rgba(255,255,255,.09);background:linear-gradient(145deg,#0c1319,#060b10)}.trp-empty h2{margin:0;font-size:25px}.trp-empty p{margin:0;color:#b9c8cf}.trp-empty button{justify-self:start;min-height:42px;padding:0 16px;border:1px solid rgba(89,216,255,.26);border-radius:10px;background:#0c2631;color:#dff8ff;font-weight:950}
        .trp-primaryCard,.trp-upcomingSection{position:relative;overflow:hidden;border:1px solid rgba(255,255,255,.09);border-radius:18px;background:linear-gradient(155deg,#0d151b 0%,#070c11 58%,#05090d 100%);box-shadow:inset 0 1px 0 rgba(255,255,255,.035),0 16px 44px rgba(0,0,0,.29)}
        .trp-primaryCard{padding:19px 20px 18px}.trp-cardAccent{position:absolute;left:0;top:16px;bottom:16px;width:3px;border-radius:999px;background:linear-gradient(var(--trp-cyan),rgba(89,216,255,.12));box-shadow:0 0 18px rgba(89,216,255,.18)}.trp-primaryCard.is-active .trp-cardAccent{background:linear-gradient(var(--trp-green),rgba(105,230,165,.12));box-shadow:0 0 18px rgba(105,230,165,.16)}
        .trp-primaryTop,.trp-sessionTop,.trp-sectionHead{display:flex;align-items:center;justify-content:space-between;gap:12px}.trp-primaryTop>div:first-child,.trp-sessionTop>div:first-child{display:flex;align-items:center;gap:11px;flex-wrap:wrap}.trp-primaryTop>div:first-child>span{font-size:10px;font-weight:1000;letter-spacing:.15em;color:#d8e5ea}.trp-dateBadge,.trp-sessionDate{color:#b9cbd2;font-size:11px;font-weight:850;white-space:normal;text-align:right}
        .trp-readiness{display:inline-flex;align-items:center;gap:6px;min-height:26px;padding:0 9px;border:1px solid rgba(255,255,255,.08);border-radius:999px;background:#091116;color:#b7d6e1;font-size:9px;font-weight:1000;letter-spacing:.06em;white-space:nowrap}.trp-readiness i{width:6px;height:6px;border-radius:50%;background:currentColor;box-shadow:0 0 8px currentColor}.trp-readiness.is-ready{color:#79e7aa}.trp-readiness.is-monitor{color:#f3c878}.trp-readiness.is-recovering{color:#ff9298}
        .trp-primaryBody{display:grid;grid-template-columns:minmax(0,1fr) minmax(360px,.72fr);gap:22px;align-items:end;margin-top:17px}.trp-primaryCopy{display:grid;gap:8px}.trp-primaryCopy h2{margin:0;font-size:clamp(36px,5vw,62px);line-height:.96;letter-spacing:-.055em;overflow-wrap:anywhere}.trp-programLine{margin:0;color:#c5d4da;font-size:14px;font-weight:750;line-height:1.4}
        .trp-muscles{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:4px}.trp-muscle{display:flex;align-items:center;gap:7px;min-height:36px;padding:5px 9px 5px 6px;border:1px solid rgba(255,255,255,.075);border-radius:10px;background:rgba(255,255,255,.018);color:#d8e4e9;font-size:11px;font-weight:850}.trp-muscleIcon{width:26px;height:26px;display:grid;place-items:center;flex:0 0 26px;border-radius:7px;background:rgba(89,216,255,.055)}.trp-muscleIcon img{max-width:21px;max-height:21px;object-fit:contain}.trp-noMuscles{margin-top:6px;color:#7e949d;font-size:11px}
        .trp-primaryMetrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.trp-primaryMetrics article{min-height:92px;display:flex;align-items:center;gap:10px;padding:12px;border:1px solid rgba(255,255,255,.075);border-radius:13px;background:rgba(255,255,255,.018)}.trp-primaryMetrics svg,.trp-sessionStats svg{width:20px;height:20px;fill:none;stroke:#79dffc;stroke-width:1.65;stroke-linecap:round;stroke-linejoin:round;flex:0 0 20px}.trp-primaryMetrics article>div{display:grid;gap:5px}.trp-primaryMetrics strong{font-size:22px;line-height:1;color:#fff;white-space:normal}.trp-primaryMetrics span{font-size:8px;font-weight:1000;letter-spacing:.1em;color:#89a0aa}.trp-readinessCopy{margin:13px 0 0;color:#98abb3;font-size:12px;line-height:1.45}
        .trp-primaryActions{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(210px,.7fr);gap:9px;margin-top:15px}.trp-primaryActions button,.trp-sessionActions button{min-height:48px;border-radius:11px;font-weight:1000;letter-spacing:.035em}.trp-primaryAction{border:1px solid rgba(114,220,255,.3);background:linear-gradient(180deg,#45c7f3,#1d91c9);color:#041118;box-shadow:inset 0 1px 0 rgba(255,255,255,.45),0 10px 24px rgba(0,153,215,.12)}.trp-primaryCard.is-active .trp-primaryAction{border-color:rgba(117,237,174,.3);background:linear-gradient(180deg,#65dda2,#2ea36b)}.trp-primaryAction span{margin-right:8px}.trp-editAction,.trp-editSmall{border:1px solid rgba(255,255,255,.11);background:linear-gradient(180deg,#111a21,#0a1015);color:#eef8fb}.trp-editAction span,.trp-editSmall span{margin-right:6px;color:#8edff8}
        .trp-upcomingSection{padding:18px}.trp-upcomingSection::before{content:"";position:absolute;left:0;top:18px;bottom:18px;width:2px;border-radius:99px;background:linear-gradient(var(--trp-amber),rgba(240,178,88,.08))}.trp-sectionHead{margin-bottom:12px}.trp-sectionHead>div{display:grid;gap:4px}.trp-sectionHead span{color:#e9bc73}.trp-sectionHead h2{margin:0;font-size:26px;line-height:1.05;letter-spacing:-.03em}.trp-sectionHead small{color:#889ca5;font-size:11px}.trp-upcomingGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.trp-loading{padding:18px;border:1px solid rgba(255,255,255,.06);border-radius:12px;background:rgba(255,255,255,.015);color:#a6b7be}
        .trp-sessionCard{display:grid;align-content:start;gap:12px;padding:15px;border:1px solid rgba(255,255,255,.075);border-left:3px solid rgba(180,194,201,.24);border-radius:14px;background:linear-gradient(145deg,rgba(255,255,255,.025),rgba(255,255,255,.005))}.trp-sessionCard.is-first{border-left-color:var(--trp-amber);background:linear-gradient(145deg,rgba(240,178,88,.055),rgba(255,255,255,.006))}.trp-sessionTop{align-items:flex-start}.trp-sequence{color:#c6d2d7;font-size:9px;font-weight:1000;letter-spacing:.12em}.trp-sessionTitle{display:grid;gap:4px}.trp-sessionTitle h3{margin:0;font-size:25px;line-height:1.05;letter-spacing:-.035em;overflow-wrap:anywhere}.trp-sessionTitle p{margin:0;color:#a9bcc4;font-size:12px;line-height:1.4;overflow-wrap:anywhere}
        .trp-sessionStats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.trp-sessionStats>div{display:flex;align-items:center;gap:8px;padding:9px;border:1px solid rgba(255,255,255,.06);border-radius:10px;background:rgba(0,0,0,.12)}.trp-sessionStats>div>span{display:grid;gap:3px}.trp-sessionStats strong{font-size:14px;color:#f5fbfd;white-space:normal}.trp-sessionStats small{font-size:7.5px;font-weight:1000;letter-spacing:.08em;color:#81959d}.trp-sessionStats svg{width:17px;height:17px;flex-basis:17px}
        .trp-sessionActions{display:grid;grid-template-columns:minmax(0,1fr) minmax(145px,.65fr);gap:8px}.trp-sessionActions button{min-height:42px;font-size:10px}.trp-startSmall{border:1px solid rgba(89,216,255,.22);background:#0d2833;color:#dff8ff}.trp-editSmall{color:#eef8fb}
        .trp-page h1,.trp-page h2,.trp-page h3,.trp-page p,.trp-page span,.trp-page strong,.trp-page small,.trp-page button{max-width:100%;text-overflow:clip}.trp-page h1,.trp-page h2,.trp-page h3,.trp-page p{white-space:normal;overflow:visible;word-break:normal;overflow-wrap:anywhere}
        @media(max-width:900px){
          .trp-page{width:calc(100% - 18px)}.trp-primaryBody{grid-template-columns:1fr}.trp-primaryMetrics{max-width:none}.trp-upcomingGrid{grid-template-columns:1fr}.trp-primaryCopy h2{font-size:46px}
        }
        @media(max-width:650px){
          .trp-page{width:calc(100% - 10px);gap:9px;margin-bottom:112px;overflow-x:hidden}.trp-pageHead{padding:0 3px}.trp-pageHead h1{font-size:30px}.trp-pageHead>button{min-height:36px;padding:0 10px;font-size:9px}
          .trp-primaryCard,.trp-upcomingSection{border-radius:15px}.trp-primaryCard{padding:14px 12px 13px}.trp-cardAccent{top:12px;bottom:12px}.trp-primaryTop{align-items:flex-start;flex-direction:column;gap:9px}.trp-primaryTop>div:first-child{gap:7px}.trp-dateBadge{width:100%;text-align:left;font-size:10px}.trp-readiness{min-height:25px;font-size:8.5px}
          .trp-primaryBody{gap:13px;margin-top:13px}.trp-primaryCopy h2{font-size:38px;line-height:.98}.trp-programLine{font-size:13px}.trp-muscles{gap:6px}.trp-muscle{min-height:32px;padding:4px 7px 4px 5px;font-size:10px}.trp-muscleIcon{width:23px;height:23px;flex-basis:23px}.trp-muscleIcon img{max-width:18px;max-height:18px}
          .trp-primaryMetrics{grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}.trp-primaryMetrics article{min-height:72px;padding:8px 6px;gap:5px;flex-direction:column;align-items:flex-start}.trp-primaryMetrics svg{width:17px;height:17px}.trp-primaryMetrics strong{font-size:17px;line-height:1.1}.trp-primaryMetrics span{font-size:7px}.trp-readinessCopy{font-size:11.5px}
          .trp-primaryActions{grid-template-columns:1fr;gap:7px}.trp-primaryActions button{min-height:45px;font-size:11px;white-space:normal;line-height:1.2}.trp-upcomingSection{padding:13px 10px}.trp-sectionHead h2{font-size:23px}.trp-sectionHead small{font-size:10px}
          .trp-upcomingGrid{gap:8px}.trp-sessionCard{padding:12px 10px;gap:10px;border-radius:12px}.trp-sessionTop{flex-direction:column;gap:7px}.trp-sessionTop>div:first-child{width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px}.trp-sessionDate{width:100%;text-align:left;font-size:10px}.trp-sessionTitle h3{font-size:23px}.trp-sessionTitle p{font-size:12px}.trp-sessionStats{gap:5px}.trp-sessionStats>div{padding:7px 5px;gap:5px;flex-direction:column;align-items:flex-start}.trp-sessionStats strong{font-size:13px}.trp-sessionStats small{font-size:7px}.trp-sessionActions{grid-template-columns:1fr;gap:6px}.trp-sessionActions button{min-height:42px;font-size:10.5px;white-space:normal}.trp-noMuscles{font-size:10px}
        }
        @media(max-width:390px){
          .trp-primaryCopy h2{font-size:34px}.trp-primaryMetrics strong{font-size:15px}.trp-muscle{font-size:9.5px}.trp-pageHead h1{font-size:28px}
        }
      `}</style>
    </main>
  );
}
