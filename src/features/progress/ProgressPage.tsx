// src/features/progress/ProgressPage.tsx
// MVP Trainer Pro - program-separated progress/history + delete-session final pass
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "../../lib/supabase";

type Range = 7 | 14 | 30 | 90 | 365 | "all";
type Tone = "blue" | "green" | "amber" | "red";

type ProgramBlockRow = {
  id: string;
  goal: string | null;
  goal_mode: string | null;
  start_date: string | null;
  end_date: string | null;
  weeks: number | null;
  created_at: string | null;
  status?: string | null;
};

type ProgramView = ProgramBlockRow & {
  label: string;
  shortLabel: string;
  purpose: string;
  isActive: boolean;
  ordinal: number;
};

type ScheduledSessionRow = {
  id: string;
  template_id: string | null;
  session_type: string | null;
  date: string | null;
  program_block_id: string | null;
};

type WorkoutRow = {
  id: string;
  scheduled_session_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  completed_at: string;
  bodyweight_lb: number | null;
  active_seconds: number | null;
  protein_target_g: number | null;
  workout_summary: any | null;
  post_difficulty: string | null;
  post_notes: string | null;
  session_rating: number | null;
  notes: string | null;
};

type WorkoutExerciseRow = {
  id: string;
  workout_id: string;
  exercise_id: string;
  order_index: number;
  prescription_snapshot: any;
  pain: number | null;
  difficulty: string | null;
};

type WorkoutSetRow = {
  workout_exercise_id: string;
  set_index: number;
  reps: number;
  weight: number;
  rir: number | null;
  pain: number | null;
  form: number | null;
};

type ExerciseRow = {
  id: string;
  name: string;
  primary_muscles?: string[] | null;
  secondary_muscles?: string[] | null;
};

type ExerciseDetail = {
  workoutExerciseId: string;
  exerciseId: string;
  name: string;
  primaryMuscles: string[];
  orderIndex: number;
  pain: number | null;
  difficulty: string | null;
  sets: WorkoutSetRow[];
};

type HistoryRow = {
  id: string;
  completedAt: string;
  templateName: string;
  programId: string | null;
  programLabel: string;
  programPurpose: string;
  workoutSeconds: number;
  bodyweightLb: number | null;
  proteinTargetG: number | null;
  painMax: number;
  painAvg: number;
  volumeTotal: number;
  setsLogged: number;
  notes: string | null;
  postDifficulty: string | null;
  exercises: ExerciseDetail[];
};

type ExerciseTrend = {
  id: string;
  name: string;
  muscle: string;
  sessions: number;
  bestWeight: number;
  bestReps: number;
  currentE1rm: number;
  firstE1rm: number;
  change: number | null;
  lastDate: string;
  pain: number | null;
};

const HISTORY_BATCH = 6;

function ms(value: string | null | undefined) {
  if (!value) return NaN;
  return new Date(value).getTime();
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function titleCase(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function goalLabel(value: string | null | undefined) {
  const key = String(value ?? "").toLowerCase();
  if (["build_muscle", "bulk", "muscle_gain"].includes(key)) return "Muscle Gain";
  if (["lose_weight", "cut"].includes(key)) return "Cut";
  if (key === "strength") return "Strength";
  if (key === "fitness") return "Fitness";
  if (/posture|rehab|mobility|corrective/.test(key)) return "Posture Rebuild";
  return titleCase(value) || "Training";
}

function programPurpose(block: ProgramBlockRow) {
  const mode = String(block.goal_mode ?? "").toLowerCase();
  const goal = String(block.goal ?? "").toLowerCase();
  if (/symptom|posture|rehab|corrective|mobility/.test(`${mode} ${goal}`)) return "Posture Rebuild";
  return goalLabel(block.goal);
}

function buildPrograms(blocks: ProgramBlockRow[]) {
  const ordered = [...blocks].sort((a, b) => {
    const left = ms(a.created_at || a.start_date);
    const right = ms(b.created_at || b.start_date);
    return (Number.isFinite(left) ? left : 0) - (Number.isFinite(right) ? right : 0);
  });
  const purposeCounts = new Map<string, number>();
  return ordered.map((block, index): ProgramView => {
    const purpose = programPurpose(block);
    const ordinal = (purposeCounts.get(purpose) ?? 0) + 1;
    purposeCounts.set(purpose, ordinal);
    const isActive = String(block.status ?? "").toLowerCase() === "active";
    const shortLabel = `${purpose} • Block ${ordinal}`;
    return {
      ...block,
      purpose,
      ordinal,
      isActive,
      shortLabel,
      label: `${shortLabel}${isActive ? " • ACTIVE" : ""}`,
    };
  });
}

function prettyMuscle(value: string) {
  const key = titleCase(value);
  const map: Record<string, string> = {
    Lats: "Back",
    "Upper Back": "Back",
    "Middle Back": "Back",
    Deltoids: "Shoulders",
    "Rear Delts": "Shoulders",
    "Side Delts": "Shoulders",
    "Front Delts": "Shoulders",
    Quadriceps: "Quads",
    Abdominals: "Core",
    Abs: "Core",
    Pectorals: "Chest",
  };
  return map[key] ?? key ?? "Other";
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).toUpperCase()} • ${date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function shortDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" }).toUpperCase();
}

function formatNumber(value: number, digits = 0) {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatDuration(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  if (!total) return "—";
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours) return `${hours}H${minutes ? ` ${minutes}M` : ""}`;
  return `${Math.max(1, minutes)} MIN`;
}

function formatPct(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  const clean = Math.abs(value) < 0.05 ? 0 : value;
  return `${clean > 0 ? "+" : ""}${clean.toFixed(1)}%`;
}

function setVolume(set: WorkoutSetRow) {
  const reps = Math.max(0, Number(set.reps ?? 0));
  const weight = Math.max(0, Number(set.weight ?? 0));
  return reps > 0 && weight > 0 ? reps * weight : 0;
}

function e1rm(weight: number, reps: number) {
  if (!(weight > 0) || !(reps > 0)) return 0;
  return reps === 1 ? weight : weight * (1 + reps / 30);
}

function workoutSeconds(workout: WorkoutRow) {
  const active = Number(workout.active_seconds ?? 0);
  if (active > 0) return Math.round(active);
  const start = ms(workout.started_at);
  const end = ms(workout.ended_at || workout.completed_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 1000);
}

function rangeDays(range: Range) {
  return range === "all" ? null : range;
}

function inRange(date: string, range: Range) {
  const days = rangeDays(range);
  if (days == null) return true;
  const stamp = ms(date);
  return Number.isFinite(stamp) && stamp >= Date.now() - days * 86400000;
}

function rangeName(range: Range) {
  if (range === "all") return "All Time";
  if (range === 365) return "1 Year";
  return `${range} Days`;
}

function Icon({ name }: { name: "program" | "time" | "volume" | "sets" | "pain" | "trend" | "trash" }) {
  const paths: Record<string, ReactNode> = {
    program: <><path d="M5 5h6v6H5zM13 5h6v6h-6zM5 13h6v6H5zM13 13h6v6h-6z" /></>,
    time: <><circle cx="12" cy="12" r="8" /><path d="M12 8v5l3 2" /></>,
    volume: <><path d="M5 8h14l1 11H4L5 8Z" /><path d="M8 8a4 4 0 0 1 8 0" /></>,
    sets: <><path d="M5 6h14M5 12h14M5 18h14" /><circle cx="3" cy="6" r="1" /><circle cx="3" cy="12" r="1" /><circle cx="3" cy="18" r="1" /></>,
    pain: <><path d="M12 3 5 14h6l-1 7 9-12h-6l1-6Z" /></>,
    trend: <><path d="m4 17 5-5 4 3 7-8M16 7h4v4" /></>,
    trash: <><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13M10 10v7M14 10v7" /></>,
  };
  return <svg className="prx-icon" viewBox="0 0 24 24" aria-hidden>{paths[name]}</svg>;
}

function toneForPain(value: number) : Tone {
  if (value >= 5) return "red";
  if (value >= 3) return "amber";
  return "green";
}

export function ProgressPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [programs, setPrograms] = useState<ProgramView[]>([]);
  const [selectedProgramId, setSelectedProgramId] = useState<string>("all");
  const [range, setRange] = useState<Range>(30);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyVisible, setHistoryVisible] = useState(HISTORY_BATCH);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearText, setClearText] = useState("");
  const [clearBusy, setClearBusy] = useState(false);

  async function loadAll(preferredProgramId?: string | null) {
    setLoading(true);
    setError("");
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!auth.user) throw new Error("Sign in to view progress.");
      const userId = auth.user.id;

      const { data: blockData, error: blockError } = await supabase
        .from("program_blocks")
        .select("id,goal,goal_mode,start_date,end_date,weeks,created_at,status")
        .eq("user_id", userId)
        .order("created_at", { ascending: true });
      if (blockError) throw blockError;

      const builtPrograms = buildPrograms((blockData ?? []) as ProgramBlockRow[]);
      setPrograms(builtPrograms);
      const active = [...builtPrograms].reverse().find((program) => program.isActive) ?? builtPrograms.at(-1) ?? null;
      setSelectedProgramId((current) => {
        const requested = preferredProgramId ?? current;
        if (requested === "all") return active?.id ?? "all";
        if (builtPrograms.some((program) => program.id === requested)) return requested;
        return active?.id ?? "all";
      });

      const { data: scheduledData, error: scheduledError } = await supabase
        .from("scheduled_sessions")
        .select("id,template_id,session_type,date,program_block_id")
        .eq("user_id", userId);
      if (scheduledError) throw scheduledError;
      const scheduled = (scheduledData ?? []) as ScheduledSessionRow[];

      const templateIds = unique(scheduled.map((row) => row.template_id ?? ""));
      const templateMap = new Map<string, string>();
      if (templateIds.length) {
        const { data: templateData, error: templateError } = await supabase
          .from("workout_templates")
          .select("id,name")
          .in("id", templateIds);
        if (templateError) throw templateError;
        for (const row of templateData ?? []) templateMap.set(String((row as any).id), String((row as any).name ?? "Workout"));
      }

      const sessionMap = new Map<string, ScheduledSessionRow>();
      scheduled.forEach((row) => sessionMap.set(row.id, row));
      const programMap = new Map(builtPrograms.map((program) => [program.id, program] as const));

      const { data: workoutData, error: workoutError } = await supabase
        .from("workouts")
        .select("id,scheduled_session_id,started_at,ended_at,completed_at,bodyweight_lb,active_seconds,protein_target_g,workout_summary,post_difficulty,post_notes,session_rating,notes")
        .eq("user_id", userId)
        .not("completed_at", "is", null)
        .order("completed_at", { ascending: false });
      if (workoutError) throw workoutError;
      const workouts = (workoutData ?? []) as WorkoutRow[];
      const workoutIds = workouts.map((row) => row.id);
      if (!workoutIds.length) {
        setHistory([]);
        return;
      }

      const { data: workoutExerciseData, error: workoutExerciseError } = await supabase
        .from("workout_exercises")
        .select("id,workout_id,exercise_id,order_index,prescription_snapshot,pain,difficulty")
        .in("workout_id", workoutIds)
        .order("order_index", { ascending: true });
      if (workoutExerciseError) throw workoutExerciseError;
      const workoutExercises = (workoutExerciseData ?? []) as WorkoutExerciseRow[];
      const workoutExerciseIds = workoutExercises.map((row) => row.id);
      const exerciseIds = unique(workoutExercises.map((row) => row.exercise_id));

      const exerciseMap = new Map<string, ExerciseRow>();
      if (exerciseIds.length) {
        const { data: exerciseData, error: exerciseError } = await supabase
          .from("exercises")
          .select("id,name,primary_muscles,secondary_muscles")
          .in("id", exerciseIds);
        if (exerciseError) throw exerciseError;
        for (const row of (exerciseData ?? []) as ExerciseRow[]) exerciseMap.set(row.id, row);
      }

      const setsByExercise = new Map<string, WorkoutSetRow[]>();
      if (workoutExerciseIds.length) {
        const { data: setData, error: setError } = await supabase
          .from("workout_sets")
          .select("workout_exercise_id,set_index,reps,weight,rir,pain,form")
          .in("workout_exercise_id", workoutExerciseIds)
          .order("set_index", { ascending: true });
        if (setError) throw setError;
        for (const raw of setData ?? []) {
          const row: WorkoutSetRow = {
            workout_exercise_id: String((raw as any).workout_exercise_id),
            set_index: Number((raw as any).set_index ?? 0),
            reps: Number((raw as any).reps ?? 0),
            weight: Number((raw as any).weight ?? 0),
            rir: (raw as any).rir == null ? null : Number((raw as any).rir),
            pain: (raw as any).pain == null ? null : Number((raw as any).pain),
            form: (raw as any).form == null ? null : Number((raw as any).form),
          };
          const list = setsByExercise.get(row.workout_exercise_id) ?? [];
          list.push(row);
          setsByExercise.set(row.workout_exercise_id, list);
        }
      }

      const detailsByWorkout = new Map<string, ExerciseDetail[]>();
      workoutExercises.forEach((row) => {
        const meta = exerciseMap.get(row.exercise_id);
        const list = detailsByWorkout.get(row.workout_id) ?? [];
        list.push({
          workoutExerciseId: row.id,
          exerciseId: row.exercise_id,
          name: meta?.name ?? "Exercise",
          primaryMuscles: Array.isArray(meta?.primary_muscles) ? meta!.primary_muscles!.map(prettyMuscle) : [],
          orderIndex: Number(row.order_index ?? 0),
          pain: row.pain == null ? null : Number(row.pain),
          difficulty: row.difficulty,
          sets: (setsByExercise.get(row.id) ?? []).slice().sort((a, b) => a.set_index - b.set_index),
        });
        detailsByWorkout.set(row.workout_id, list);
      });

      const rows: HistoryRow[] = workouts.map((workout) => {
        const session = workout.scheduled_session_id ? sessionMap.get(workout.scheduled_session_id) ?? null : null;
        const program = session?.program_block_id ? programMap.get(session.program_block_id) ?? null : null;
        const summary = workout.workout_summary as any;
        const templateName =
          (session?.template_id ? templateMap.get(session.template_id) : null) ||
          (typeof summary?.template_name === "string" && summary.template_name.trim() ? summary.template_name.trim() : null) ||
          titleCase(session?.session_type) ||
          "Workout";
        const exercises = (detailsByWorkout.get(workout.id) ?? []).slice().sort((a, b) => a.orderIndex - b.orderIndex);
        const loggedSets = exercises.flatMap((exercise) => exercise.sets.filter((set) => set.reps > 0));
        const painValues = [
          ...exercises.map((exercise) => exercise.pain),
          ...loggedSets.map((set) => set.pain),
        ].filter((value): value is number => value != null && Number.isFinite(value));
        return {
          id: workout.id,
          completedAt: workout.completed_at,
          templateName,
          programId: program?.id ?? null,
          programLabel: program?.shortLabel ?? "Legacy / Unassigned",
          programPurpose: program?.purpose ?? "Legacy",
          workoutSeconds: workoutSeconds(workout),
          bodyweightLb: workout.bodyweight_lb == null ? null : Number(workout.bodyweight_lb),
          proteinTargetG: workout.protein_target_g == null ? null : Number(workout.protein_target_g),
          painMax: painValues.length ? Math.max(...painValues) : 0,
          painAvg: painValues.length ? painValues.reduce((sum, value) => sum + value, 0) / painValues.length : 0,
          volumeTotal: loggedSets.reduce((sum, set) => sum + setVolume(set), 0),
          setsLogged: loggedSets.length,
          notes: workout.post_notes || workout.notes || null,
          postDifficulty: workout.post_difficulty,
          exercises,
        };
      });
      setHistory(rows);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load progress.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setHistoryVisible(HISTORY_BATCH);
    setDetailId(null);
  }, [selectedProgramId, range]);

  const selectedProgram = useMemo(
    () => programs.find((program) => program.id === selectedProgramId) ?? null,
    [programs, selectedProgramId]
  );

  const scopedHistory = useMemo(() => {
    return history.filter((row) => {
      if (selectedProgramId !== "all" && row.programId !== selectedProgramId) return false;
      return inRange(row.completedAt, range);
    });
  }, [history, selectedProgramId, range]);

  const metrics = useMemo(() => {
    const sessions = scopedHistory.length;
    const seconds = scopedHistory.reduce((sum, row) => sum + row.workoutSeconds, 0);
    const volume = scopedHistory.reduce((sum, row) => sum + row.volumeTotal, 0);
    const sets = scopedHistory.reduce((sum, row) => sum + row.setsLogged, 0);
    const painRows = scopedHistory.filter((row) => row.painMax > 0 || row.painAvg > 0);
    const pain = painRows.length ? painRows.reduce((sum, row) => sum + row.painAvg, 0) / painRows.length : 0;
    return { sessions, seconds, volume, sets, pain };
  }, [scopedHistory]);

  const exerciseTrends = useMemo<ExerciseTrend[]>(() => {
    const map = new Map<string, Array<{ date: string; name: string; muscle: string; weight: number; reps: number; e1rm: number; pain: number | null }>>();
    [...scopedHistory].reverse().forEach((workout) => {
      workout.exercises.forEach((exercise) => {
        const sets = exercise.sets.filter((set) => set.reps > 0);
        if (!sets.length) return;
        const best = sets.slice().sort((a, b) => e1rm(b.weight, b.reps) - e1rm(a.weight, a.reps))[0];
        const list = map.get(exercise.exerciseId) ?? [];
        list.push({
          date: workout.completedAt,
          name: exercise.name,
          muscle: exercise.primaryMuscles[0] ?? "Other",
          weight: best?.weight ?? 0,
          reps: best?.reps ?? 0,
          e1rm: best ? e1rm(best.weight, best.reps) : 0,
          pain: exercise.pain,
        });
        map.set(exercise.exerciseId, list);
      });
    });
    return [...map.entries()].map(([id, points]) => {
      const first = points.find((point) => point.e1rm > 0) ?? points[0];
      const latest = [...points].reverse().find((point) => point.e1rm > 0) ?? points.at(-1)!;
      const change = first?.e1rm > 0 && latest?.e1rm > 0 && first !== latest
        ? ((latest.e1rm - first.e1rm) / first.e1rm) * 100
        : null;
      return {
        id,
        name: latest.name,
        muscle: latest.muscle,
        sessions: points.length,
        bestWeight: Math.max(0, ...points.map((point) => point.weight)),
        bestReps: latest.reps,
        currentE1rm: latest.e1rm,
        firstE1rm: first?.e1rm ?? 0,
        change,
        lastDate: latest.date,
        pain: latest.pain,
      };
    }).sort((a, b) => (b.change ?? -999) - (a.change ?? -999));
  }, [scopedHistory]);

  const visibleHistory = scopedHistory.slice(0, historyVisible);
  const detail = history.find((row) => row.id === detailId) ?? null;
  const deleting = history.find((row) => row.id === deleteId) ?? null;

  const volumeRows = useMemo(
    () => scopedHistory.slice(0, 10).reverse(),
    [scopedHistory]
  );
  const volumeMax = Math.max(1, ...volumeRows.map((row) => row.volumeTotal));

  async function deleteSession() {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true);
    setError("");
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!auth.user) throw new Error("Sign in first.");

      const { data: exerciseRows, error: exerciseError } = await supabase
        .from("workout_exercises")
        .select("id")
        .eq("workout_id", deleting.id);
      if (exerciseError) throw exerciseError;
      const workoutExerciseIds = (exerciseRows ?? []).map((row: any) => String(row.id)).filter(Boolean);

      if (workoutExerciseIds.length) {
        const { error: setsError } = await supabase
          .from("workout_sets")
          .delete()
          .in("workout_exercise_id", workoutExerciseIds);
        if (setsError) throw setsError;
      }
      const { error: workoutExercisesError } = await supabase
        .from("workout_exercises")
        .delete()
        .eq("workout_id", deleting.id);
      if (workoutExercisesError) throw workoutExercisesError;

      const { error: workoutDeleteError } = await supabase
        .from("workouts")
        .delete()
        .eq("id", deleting.id)
        .eq("user_id", auth.user.id);
      if (workoutDeleteError) throw workoutDeleteError;

      setDeleteId(null);
      setDetailId((current) => current === deleting.id ? null : current);
      setMessage("✓ SESSION DELETED");
      await loadAll(selectedProgramId);
      window.setTimeout(() => setMessage((current) => current === "✓ SESSION DELETED" ? "" : current), 1800);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete this completed session.");
    } finally {
      setDeleteBusy(false);
    }
  }

  async function clearAllLogs() {
    if (clearText.trim().toUpperCase() !== "DELETE" || clearBusy) return;
    setClearBusy(true);
    setError("");
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!auth.user) throw new Error("Sign in first.");
      const { data: active, error: activeError } = await supabase
        .from("workouts")
        .select("id")
        .eq("user_id", auth.user.id)
        .is("completed_at", null)
        .limit(1)
        .maybeSingle();
      if (activeError) throw activeError;
      if (active?.id) throw new Error("End the active workout before clearing logs.");
      const { error: rpcError } = await supabase.rpc("rpc_clear_logs_all_time");
      if (rpcError) throw rpcError;
      setClearOpen(false);
      setClearText("");
      setMessage("Workout logs cleared.");
      await loadAll(selectedProgramId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not clear workout logs.");
    } finally {
      setClearBusy(false);
    }
  }

  const currentProgramText = selectedProgramId === "all"
    ? "All Programs"
    : selectedProgram?.label ?? "Active Program";

  return (
    <main className="prx-page">
      <section className="prx-hero">
        <div className="prx-heroText">
          <span>MVP TRAINER • PERFORMANCE INTELLIGENCE</span>
          <h1>Progress</h1>
          <p>Every completed workout stays tied to the program that produced it. Change programs without mixing the history underneath them.</p>
        </div>
        <div className="prx-controls">
          <label>
            <span>PROGRAM</span>
            <select value={selectedProgramId} onChange={(event) => setSelectedProgramId(event.target.value)}>
              {programs.length ? <optgroup label="PROGRAMS">
                {[...programs].reverse().map((program) => <option key={program.id} value={program.id}>{program.label}</option>)}
              </optgroup> : null}
              <option value="all">All Programs</option>
            </select>
          </label>
          <label>
            <span>RANGE</span>
            <select value={String(range)} onChange={(event) => setRange(event.target.value === "all" ? "all" : Number(event.target.value) as Range)}>
              <option value="7">7 Days</option><option value="14">14 Days</option><option value="30">30 Days</option><option value="90">90 Days</option><option value="365">1 Year</option><option value="all">All Time</option>
            </select>
          </label>
        </div>
      </section>

      {error ? <div className="prx-alert is-error">{error}</div> : null}
      {message ? <div className="prx-alert is-ok">{message}</div> : null}

      <section className="prx-programDeck">
        <div className="prx-programIdentity">
          <Icon name="program" />
          <div><span>VIEWING PROGRAM</span><strong>{currentProgramText}</strong><small>{rangeName(range)} • {scopedHistory.length} completed session{scopedHistory.length === 1 ? "" : "s"}</small></div>
        </div>
        {selectedProgram ? <div className="prx-programMeta"><div><span>PURPOSE</span><strong>{selectedProgram.purpose}</strong></div><div><span>START</span><strong>{selectedProgram.start_date ? shortDate(selectedProgram.start_date) : "—"}</strong></div><div><span>LENGTH</span><strong>{selectedProgram.weeks ? `${selectedProgram.weeks} WKS` : "—"}</strong></div><div className={selectedProgram.isActive ? "is-active" : ""}><span>STATUS</span><strong>{selectedProgram.isActive ? "ACTIVE" : "PAST"}</strong></div></div> : <div className="prx-programMeta"><div><span>SCOPE</span><strong>EVERY PROGRAM</strong></div><div><span>PROGRAMS</span><strong>{programs.length}</strong></div></div>}
      </section>

      <section className="prx-kpis">
        <article><Icon name="program" /><div><span>SESSIONS</span><strong>{metrics.sessions}</strong><small>completed</small></div></article>
        <article><Icon name="time" /><div><span>TRAINING TIME</span><strong>{formatDuration(metrics.seconds)}</strong><small>active time</small></div></article>
        <article><Icon name="volume" /><div><span>VOLUME</span><strong>{formatNumber(metrics.volume)}</strong><small>LB logged</small></div></article>
        <article><Icon name="sets" /><div><span>WORKING SETS</span><strong>{metrics.sets}</strong><small>logged sets</small></div></article>
        <article className={`is-${toneForPain(metrics.pain)}`}><Icon name="pain" /><div><span>AVG PAIN</span><strong>{metrics.pain ? metrics.pain.toFixed(1) : "0"}</strong><small>0–10 scale</small></div></article>
      </section>

      <section className="prx-panel">
        <header className="prx-sectionHead"><div><span>PROGRAM LOAD</span><h2>Workout Volume</h2></div><small>LAST {volumeRows.length || 0} IN THIS VIEW</small></header>
        {loading ? <div className="prx-empty">Loading training data…</div> : volumeRows.some((row) => row.volumeTotal > 0) ? <div className="prx-volumeChart">
          {volumeRows.map((row) => <div className="prx-volumeCol" key={row.id}><b>{row.volumeTotal ? formatNumber(row.volumeTotal) : "—"}</b><div><i style={{ height: `${Math.max(5, row.volumeTotal / volumeMax * 100)}%` }} /></div><strong>{row.templateName}</strong><small>{shortDate(row.completedAt)}</small></div>)}
        </div> : <div className="prx-empty">Log weighted sets to build the volume trend for this program.</div>}
      </section>

      <section className="prx-panel">
        <header className="prx-sectionHead"><div><span>EXERCISE PERFORMANCE</span><h2>Strength Trends</h2></div><small>{exerciseTrends.length} EXERCISES</small></header>
        {exerciseTrends.length ? <div className="prx-trendGrid">{exerciseTrends.slice(0, 12).map((exercise) => <article key={exercise.id}>
          <div className="prx-trendTop"><div><span>{exercise.muscle}</span><strong>{exercise.name}</strong></div><em className={(exercise.change ?? 0) > 1 ? "is-up" : (exercise.change ?? 0) < -1 ? "is-down" : ""}>{formatPct(exercise.change)}</em></div>
          <div className="prx-trendMetrics"><div><span>BEST LOAD</span><strong>{exercise.bestWeight > 0 ? `${formatNumber(exercise.bestWeight, exercise.bestWeight % 1 ? 1 : 0)} LB` : "BODYWEIGHT"}</strong></div><div><span>EST. 1RM</span><strong>{exercise.currentE1rm > 0 ? `${formatNumber(exercise.currentE1rm)} LB` : "—"}</strong></div><div><span>SESSIONS</span><strong>{exercise.sessions}</strong></div></div>
          <small>Last trained {shortDate(exercise.lastDate)}{exercise.pain != null ? ` • pain ${exercise.pain}/10` : ""}</small>
        </article>)}</div> : <div className="prx-empty">This program needs repeated exercise data before strength trends can be calculated.</div>}
      </section>

      <section className="prx-panel prx-historyPanel">
        <header className="prx-sectionHead"><div><span>COMPLETED TRAINING</span><h2>Session History</h2></div><small>{scopedHistory.length} SESSION{scopedHistory.length === 1 ? "" : "S"}</small></header>
        {!loading && !scopedHistory.length ? <div className="prx-empty">No completed sessions match this program and date range.</div> : null}
        <div className="prx-historyList">
          {visibleHistory.map((row) => <article key={row.id} className="prx-historyRow">
            <div className="prx-historyMain">
              <div className="prx-programBadge"><span>{row.programPurpose}</span><strong>{row.programLabel}</strong></div>
              <h3>{row.templateName}</h3>
              <p>{formatDate(row.completedAt)}</p>
              <div className="prx-historyMetrics"><span><b>{formatDuration(row.workoutSeconds)}</b> TIME</span><span><b>{formatNumber(row.volumeTotal)}</b> LB</span><span><b>{row.setsLogged}</b> SETS</span><span className={`is-${toneForPain(row.painMax)}`}><b>{row.painMax.toFixed(0)}</b> PAIN</span></div>
            </div>
            <div className="prx-historyActions"><button type="button" onClick={() => setDetailId(row.id)}>VIEW DETAILS</button><button type="button" className="is-delete" onClick={() => setDeleteId(row.id)}><Icon name="trash" />DELETE SESSION</button></div>
          </article>)}
        </div>
        {historyVisible < scopedHistory.length ? <button className="prx-loadMore" onClick={() => setHistoryVisible((value) => value + HISTORY_BATCH)}>LOAD MORE</button> : null}
      </section>

      <section className="prx-dangerZone">
        <div><span>DATA CONTROL</span><strong>Clear all workout logs</strong><small>This is separate from deleting one mistaken session above.</small></div>
        <button onClick={() => setClearOpen(true)}>CLEAR ALL LOGS</button>
      </section>

      {detail ? <div className="prx-modalBack" onMouseDown={() => setDetailId(null)}><section className="prx-modal prx-detailModal" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span>{detail.programLabel}</span><h2>{detail.templateName}</h2><p>{formatDate(detail.completedAt)}</p></div><button onClick={() => setDetailId(null)}>×</button></header>
        <div className="prx-detailSummary"><div><span>TIME</span><strong>{formatDuration(detail.workoutSeconds)}</strong></div><div><span>VOLUME</span><strong>{formatNumber(detail.volumeTotal)} LB</strong></div><div><span>SETS</span><strong>{detail.setsLogged}</strong></div><div><span>PAIN MAX</span><strong>{detail.painMax.toFixed(0)}/10</strong></div></div>
        <div className="prx-detailScroll">{detail.exercises.map((exercise) => <article className="prx-exerciseDetail" key={exercise.workoutExerciseId}><header><div><span>{exercise.primaryMuscles.join(" • ") || "EXERCISE"}</span><strong>{exercise.name}</strong></div>{exercise.pain != null ? <em>PAIN {exercise.pain}/10</em> : null}</header><div className="prx-setTable"><div className="prx-setHead"><span>SET</span><span>WEIGHT</span><span>REPS</span><span>RIR</span><span>FORM</span></div>{exercise.sets.map((set) => <div key={`${exercise.workoutExerciseId}-${set.set_index}`}><span>{set.set_index}</span><strong>{set.weight > 0 ? `${formatNumber(set.weight, set.weight % 1 ? 1 : 0)} LB` : "BW"}</strong><strong>{set.reps || "—"}</strong><span>{set.rir ?? "—"}</span><span>{set.form ?? "—"}</span></div>)}</div></article>)}</div>
        <footer><button onClick={() => setDetailId(null)}>CLOSE</button><button className="is-delete" onClick={() => { setDeleteId(detail.id); setDetailId(null); }}>DELETE SESSION</button></footer>
      </section></div> : null}

      {deleting ? <div className="prx-modalBack" onMouseDown={() => !deleteBusy && setDeleteId(null)}><section className="prx-modal prx-confirm" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span>DELETE COMPLETED SESSION</span><h2>{deleting.templateName}</h2><p>{deleting.programLabel} • {formatDate(deleting.completedAt)}</p></div></header>
        <div><strong>Delete only this logged workout?</strong><p>This removes this session, its exercise records, and its logged sets. The training program itself stays intact.</p></div>
        <footer><button disabled={deleteBusy} onClick={() => setDeleteId(null)}>CANCEL</button><button className="is-delete" disabled={deleteBusy} onClick={() => void deleteSession()}>{deleteBusy ? "DELETING…" : "DELETE SESSION"}</button></footer>
      </section></div> : null}

      {clearOpen ? <div className="prx-modalBack" onMouseDown={() => !clearBusy && setClearOpen(false)}><section className="prx-modal prx-confirm" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span>HIGH IMPACT ACTION</span><h2>Clear all workout logs</h2></div></header>
        <div><p>This removes all completed workout history across every program. Type <b>DELETE</b> to continue.</p><input value={clearText} onChange={(event) => setClearText(event.target.value)} placeholder="Type DELETE" /></div>
        <footer><button disabled={clearBusy} onClick={() => setClearOpen(false)}>CANCEL</button><button className="is-delete" disabled={clearBusy || clearText.trim().toUpperCase() !== "DELETE"} onClick={() => void clearAllLogs()}>{clearBusy ? "CLEARING…" : "CLEAR ALL LOGS"}</button></footer>
      </section></div> : null}

      <style>{`
        .prx-page{width:min(1180px,calc(100% - 28px));margin:0 auto 120px;color:#eef8fc;font-family:inherit}.prx-page *{box-sizing:border-box}.prx-page button,.prx-page select,.prx-page input{font:inherit}.prx-page button{cursor:pointer;color:#f6fcff}.prx-page button:disabled{cursor:not-allowed;opacity:.42}.prx-icon{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
        .prx-hero,.prx-programDeck,.prx-panel{border:1px solid rgba(79,179,214,.22);border-top-color:rgba(159,221,242,.31);border-radius:16px;background:linear-gradient(180deg,#0a202b,#040d13);box-shadow:inset 0 1px rgba(255,255,255,.025),0 15px 34px rgba(0,0,0,.23)}.prx-hero{padding:25px 27px;display:flex;align-items:flex-start;justify-content:space-between;gap:22px}.prx-heroText>span,.prx-sectionHead span,.prx-programIdentity span,.prx-dangerZone span{color:#59d3f5;font-size:8px;font-weight:1000;letter-spacing:.14em}.prx-hero h1{margin:5px 0 4px;color:#fff;font-size:44px;line-height:1;letter-spacing:-.045em}.prx-hero p{max-width:690px;margin:0;color:#a9bec7;font-size:10px;line-height:1.55}.prx-controls{display:grid;grid-template-columns:220px 140px;gap:8px}.prx-controls label{display:grid;gap:5px}.prx-controls label>span{color:#8aa5b0;font-size:6px;font-weight:1000;letter-spacing:.13em}.prx-controls select{height:42px;padding:0 34px 0 11px;border:1px solid rgba(102,185,214,.22);border-radius:8px;background:#07151d;color:#fff;font-size:9px;font-weight:900;outline:none}.prx-controls select:focus{border-color:#4bd2f7;box-shadow:0 0 0 2px rgba(75,210,247,.1)}
        .prx-alert{margin:10px 0;padding:10px 13px;border-radius:8px;font-size:9px;font-weight:900}.prx-alert.is-error{border:1px solid rgba(255,91,103,.4);background:#311015;color:#ffd8db}.prx-alert.is-ok{border:1px solid rgba(72,221,156,.34);background:#0c2b20;color:#bdffdf}
        .prx-programDeck{margin-top:11px;padding:16px 18px;display:grid;grid-template-columns:minmax(260px,1fr) minmax(420px,1.3fr);gap:18px;align-items:center}.prx-programIdentity{display:flex;align-items:center;gap:12px;min-width:0}.prx-programIdentity>.prx-icon{width:30px;height:30px;color:#68daf8}.prx-programIdentity>div{min-width:0;display:grid;gap:3px}.prx-programIdentity strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#fff;font-size:18px}.prx-programIdentity small{color:#829da8;font-size:8px}.prx-programMeta{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid rgba(111,180,205,.09);border-radius:8px;overflow:hidden;background:#061219}.prx-programMeta>div{padding:10px;border-left:1px solid rgba(111,180,205,.08)}.prx-programMeta>div:first-child{border-left:0}.prx-programMeta span{display:block;color:#718b96;font-size:6px;font-weight:900;letter-spacing:.1em}.prx-programMeta strong{display:block;margin-top:5px;color:#eef9fc;font-size:10px}.prx-programMeta .is-active strong{color:#6ce3ac}
        .prx-kpis{margin-top:10px;display:grid;grid-template-columns:repeat(5,1fr);gap:7px}.prx-kpis article{min-height:89px;padding:13px;display:flex;align-items:center;gap:10px;border:1px solid rgba(92,170,198,.14);border-radius:10px;background:linear-gradient(180deg,#091923,#050d13)}.prx-kpis .prx-icon{flex:0 0 auto;width:25px;height:25px;color:#55d1f4}.prx-kpis article>div{min-width:0}.prx-kpis span{display:block;color:#7f9aa5;font-size:6px;font-weight:1000;letter-spacing:.12em}.prx-kpis strong{display:block;margin-top:4px;color:#fff;font-size:19px;line-height:1}.prx-kpis small{display:block;margin-top:4px;color:#69828d;font-size:7px}.prx-kpis .is-amber .prx-icon,.prx-kpis .is-amber strong{color:#f2b967}.prx-kpis .is-red .prx-icon,.prx-kpis .is-red strong{color:#ff7c84}.prx-kpis .is-green .prx-icon{color:#5ce0a4}
        .prx-panel{margin-top:11px;overflow:hidden}.prx-sectionHead{padding:15px 17px;display:flex;align-items:flex-end;justify-content:space-between;gap:14px;border-bottom:1px solid rgba(98,168,194,.1);background:#071821}.prx-sectionHead h2{margin:4px 0 0;color:#fff;font-size:22px;letter-spacing:-.025em}.prx-sectionHead>small{color:#6d8791;font-size:7px;font-weight:900;letter-spacing:.09em}.prx-empty{padding:28px 18px;color:#9db5bf;text-align:center;font-size:9px}
        .prx-volumeChart{height:210px;padding:18px 16px 13px;display:flex;align-items:flex-end;gap:8px;overflow-x:auto;background:linear-gradient(to top,rgba(91,164,190,.045) 1px,transparent 1px);background-size:100% 25%}.prx-volumeCol{height:100%;min-width:66px;flex:1;display:grid;grid-template-rows:17px 1fr 16px 13px;gap:3px;text-align:center}.prx-volumeCol>b{color:#a9c2cc;font-size:6px}.prx-volumeCol>div{position:relative;border-bottom:1px solid rgba(112,183,207,.18)}.prx-volumeCol i{position:absolute;left:25%;right:25%;bottom:0;border-radius:3px 3px 0 0;background:linear-gradient(180deg,#5cdafb,#228db3);box-shadow:0 0 10px rgba(61,201,241,.11)}.prx-volumeCol strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#dbeaf0;font-size:6px}.prx-volumeCol small{color:#657e88;font-size:6px}
        .prx-trendGrid{padding:11px;display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.prx-trendGrid article{padding:12px;border:1px solid rgba(91,163,190,.12);border-radius:9px;background:#061219}.prx-trendTop{display:flex;justify-content:space-between;gap:10px}.prx-trendTop>div{min-width:0;display:grid;gap:3px}.prx-trendTop span{color:#67d6f4;font-size:6px;font-weight:1000;letter-spacing:.1em}.prx-trendTop strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#fff;font-size:10px}.prx-trendTop em{align-self:start;padding:4px 6px;border-radius:5px;background:#101c22;color:#98abb3;font-size:7px;font-style:normal;font-weight:1000}.prx-trendTop em.is-up{background:#0d3023;color:#69e2aa}.prx-trendTop em.is-down{background:#331116;color:#ff858d}.prx-trendMetrics{margin-top:10px;display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid rgba(102,175,200,.09);border-bottom:1px solid rgba(102,175,200,.07)}.prx-trendMetrics>div{padding:8px 6px}.prx-trendMetrics>div+div{border-left:1px solid rgba(102,175,200,.08)}.prx-trendMetrics span{display:block;color:#657f89;font-size:5.5px;font-weight:900}.prx-trendMetrics strong{display:block;margin-top:4px;color:#edf8fc;font-size:9px}.prx-trendGrid article>small{display:block;margin-top:7px;color:#6c858f;font-size:6.5px}
        .prx-historyList{display:grid}.prx-historyRow{padding:13px 15px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px;align-items:center;border-bottom:1px solid rgba(98,167,191,.09)}.prx-historyRow:last-child{border-bottom:0}.prx-historyMain{min-width:0}.prx-programBadge{display:flex;align-items:center;gap:8px;margin-bottom:6px}.prx-programBadge span{padding:4px 6px;border:1px solid rgba(76,203,242,.25);border-radius:4px;background:#082631;color:#76ddf8;font-size:6px;font-weight:1000;letter-spacing:.08em}.prx-programBadge strong{color:#96adb6;font-size:7px}.prx-historyMain h3{margin:0;color:#fff;font-size:15px}.prx-historyMain>p{margin:4px 0 0;color:#748d98;font-size:7px}.prx-historyMetrics{margin-top:9px;display:flex;gap:6px;flex-wrap:wrap}.prx-historyMetrics span{padding:5px 7px;border:1px solid rgba(95,165,189,.09);border-radius:5px;background:#071319;color:#839ba5;font-size:6px;font-weight:900}.prx-historyMetrics b{margin-right:3px;color:#eaf6fa;font-size:7px}.prx-historyMetrics .is-amber b{color:#efba71}.prx-historyMetrics .is-red b{color:#ff7f88}.prx-historyActions{display:flex;gap:7px}.prx-historyActions button,.prx-loadMore,.prx-dangerZone button,.prx-modal footer button{min-height:34px;padding:0 11px;border:1px solid rgba(101,178,205,.19);border-radius:7px;background:#081922;color:#f5fbfe;font-size:7px;font-weight:1000;letter-spacing:.05em}.prx-historyActions button:hover{border-color:rgba(77,205,245,.43);background:#0a2531}.prx-historyActions .is-delete,.prx-modal .is-delete{display:inline-flex;align-items:center;justify-content:center;gap:5px;border-color:rgba(255,84,96,.32);background:#2b0d12;color:#ffdfe1}.prx-historyActions .is-delete .prx-icon{width:13px;height:13px}.prx-loadMore{display:block;margin:11px auto 14px;min-width:150px}.prx-dangerZone{margin-top:12px;padding:13px 15px;display:flex;justify-content:space-between;align-items:center;gap:14px;border:1px solid rgba(255,83,94,.13);border-radius:10px;background:#0d0b0d}.prx-dangerZone>div{display:grid;gap:3px}.prx-dangerZone strong{color:#f5edef;font-size:10px}.prx-dangerZone small{color:#786c70;font-size:7px}.prx-dangerZone button{border-color:rgba(255,83,94,.24);background:#240b10;color:#ffcdd1}
        .prx-modalBack{position:fixed;inset:0;z-index:10000;padding:16px;display:grid;place-items:center;background:rgba(0,4,7,.88);backdrop-filter:blur(10px)}.prx-modal{width:min(860px,100%);max-height:calc(100dvh - 32px);overflow:hidden;display:grid;grid-template-rows:auto minmax(0,1fr) auto;border:1px solid rgba(91,196,232,.31);border-radius:15px;background:linear-gradient(180deg,#0a202b,#040d12);box-shadow:0 30px 80px rgba(0,0,0,.7)}.prx-modal>header{padding:14px 16px;display:flex;justify-content:space-between;gap:12px;align-items:flex-start;border-bottom:1px solid rgba(91,170,198,.12)}.prx-modal>header span{color:#66d9f7;font-size:7px;font-weight:1000;letter-spacing:.12em}.prx-modal>header h2{margin:4px 0 2px;color:#fff;font-size:21px}.prx-modal>header p{margin:0;color:#819aa4;font-size:7px}.prx-modal>header>button{width:34px;height:34px;border:1px solid rgba(110,171,193,.16);border-radius:7px;background:#071219;color:#fff;font-size:19px}.prx-detailModal{grid-template-rows:auto auto minmax(0,1fr) auto}.prx-detailSummary{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid rgba(98,173,199,.1)}.prx-detailSummary>div{padding:10px 13px}.prx-detailSummary>div+div{border-left:1px solid rgba(98,173,199,.08)}.prx-detailSummary span{display:block;color:#6c8791;font-size:6px;font-weight:900}.prx-detailSummary strong{display:block;margin-top:4px;color:#fff;font-size:11px}.prx-detailScroll{min-height:0;overflow:auto;padding:10px}.prx-exerciseDetail{margin-bottom:8px;border:1px solid rgba(89,166,193,.12);border-radius:9px;background:#061219;overflow:hidden}.prx-exerciseDetail>header{padding:9px 11px;display:flex;justify-content:space-between;gap:10px;border-bottom:1px solid rgba(89,166,193,.08)}.prx-exerciseDetail>header span{display:block;color:#66d5f3;font-size:6px;font-weight:900}.prx-exerciseDetail>header strong{display:block;margin-top:3px;color:#fff;font-size:10px}.prx-exerciseDetail>header em{color:#efa979;font-size:7px;font-style:normal;font-weight:900}.prx-setTable>div{display:grid;grid-template-columns:44px 1fr 1fr 1fr 1fr;padding:7px 10px;border-top:1px solid rgba(94,166,192,.06);text-align:center}.prx-setTable .prx-setHead{background:#071820;color:#6f8993;font-size:6px;font-weight:900}.prx-setTable span,.prx-setTable strong{color:#aec3cb;font-size:7px}.prx-setTable strong{color:#fff}.prx-modal>footer{padding:10px;display:flex;justify-content:flex-end;gap:7px;border-top:1px solid rgba(91,168,195,.11);background:#06151c}.prx-confirm{width:min(520px,100%);grid-template-rows:auto auto auto}.prx-confirm>div{padding:17px}.prx-confirm>div strong{color:#fff;font-size:13px}.prx-confirm>div p{margin:7px 0 0;color:#a0b5bd;font-size:9px;line-height:1.55}.prx-confirm input{width:100%;height:41px;margin-top:12px;padding:0 11px;border:1px solid rgba(255,99,109,.28);border-radius:7px;background:#100b0d;color:#fff;outline:none}.prx-confirm input:focus{border-color:#ff6670}
        @media(max-width:900px){.prx-controls{grid-template-columns:1fr 1fr;min-width:330px}.prx-programDeck{grid-template-columns:1fr}.prx-kpis{grid-template-columns:repeat(3,1fr)}.prx-trendGrid{grid-template-columns:repeat(2,1fr)}}
        @media(max-width:650px){.prx-page{width:calc(100% - 12px);margin-bottom:110px}.prx-hero{padding:17px;display:grid}.prx-hero h1{font-size:34px}.prx-hero p{font-size:9px}.prx-controls{min-width:0;grid-template-columns:1fr}.prx-controls select{height:44px;font-size:10px}.prx-programDeck{padding:13px}.prx-programIdentity strong{white-space:normal;font-size:16px}.prx-programMeta{grid-template-columns:1fr 1fr}.prx-programMeta>div:nth-child(3){border-left:0;border-top:1px solid rgba(111,180,205,.08)}.prx-programMeta>div:nth-child(4){border-top:1px solid rgba(111,180,205,.08)}.prx-kpis{grid-template-columns:1fr 1fr;gap:6px}.prx-kpis article{min-height:78px}.prx-kpis article:last-child{grid-column:1/-1}.prx-sectionHead{padding:13px}.prx-sectionHead h2{font-size:19px}.prx-trendGrid{grid-template-columns:1fr;padding:8px}.prx-volumeChart{height:180px;padding-left:9px;padding-right:9px}.prx-volumeCol{min-width:55px}.prx-historyRow{padding:12px 10px;grid-template-columns:1fr}.prx-historyActions{display:grid;grid-template-columns:1fr 1fr}.prx-historyActions button{min-height:38px;color:#fff;font-size:7px}.prx-programBadge{align-items:flex-start;flex-direction:column;gap:4px}.prx-dangerZone{align-items:flex-start;flex-direction:column}.prx-dangerZone button{width:100%;min-height:40px}.prx-modalBack{padding:7px}.prx-modal{max-height:calc(100dvh - 14px);border-radius:12px}.prx-detailSummary{grid-template-columns:1fr 1fr}.prx-detailSummary>div:nth-child(3){border-left:0;border-top:1px solid rgba(98,173,199,.08)}.prx-detailSummary>div:nth-child(4){border-top:1px solid rgba(98,173,199,.08)}.prx-setTable>div{grid-template-columns:32px 1fr 1fr 42px 42px;padding:7px 5px}.prx-modal>footer{display:grid;grid-template-columns:1fr 1fr}.prx-modal>footer button{min-height:40px;color:#fff}.prx-confirm>div{padding:14px}}
      `}</style>
    </main>
  );
}
