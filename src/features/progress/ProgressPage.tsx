// src/features/progress/ProgressPage.tsx
// MVP Trainer Pro - program-separated progress/history + delete-session final pass
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "../../lib/supabase";
import { canonicalExerciseKey } from "../../lib/exerciseIdentity";

type Range = 30 | 90 | 180 | 365 | "all";
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
  intake_snapshot_id?: string | null;
};

type IntakeSnapshotRow = {
  id: string;
  constraints?: any;
  symptoms?: any;
  aesthetic_interests?: any;
};

type ProgramView = ProgramBlockRow & {
  label: string;
  shortLabel: string;
  purpose: string;
  programType: string;
  equipment: string;
  isActive: boolean;
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
  equipment?: string[] | null;
};

type ExerciseDetail = {
  workoutExerciseId: string;
  exerciseId: string;
  identityKey: string;
  name: string;
  primaryMuscles: string[];
  orderIndex: number;
  pain: number | null;
  difficulty: string | null;
  sets: WorkoutSetRow[];
};

type HistoryRow = {
  id: string;
  scheduledSessionId: string | null;
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

type EditSetDraft = {
  workoutExerciseId: string;
  setIndex: number;
  weight: string;
  reps: string;
  rir: string;
  pain: string;
  form: string;
};

type EditExerciseDraft = {
  workoutExerciseId: string;
  name: string;
  pain: string;
  sets: EditSetDraft[];
};

type EditSessionDraft = {
  workoutId: string;
  scheduledSessionId: string | null;
  workoutName: string;
  durationMinutes: string;
  completedLocal: string;
  programId: string;
  exercises: EditExerciseDraft[];
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

type DailyCheckIn = {
  id: string;
  programId: string;
  date: string;
  bodyweightLb: number | null;
  calories: number | null;
  proteinG: number | null;
  calorieTarget: number | null;
  proteinTarget: number | null;
  pain: number | null;
  recovery: number | null;
  savedAt: number;
};

type CheckInDraft = {
  date: string;
  bodyweight: string;
  calories: string;
  protein: string;
  calorieTarget: string;
  proteinTarget: string;
  pain: string;
  recovery: string;
};

const DAILY_CHECKIN_KEY = "mvp_progress_daily_checkins_v1";

function todayInputDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function readDailyCheckIns(): DailyCheckIn[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(DAILY_CHECKIN_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeDailyCheckIns(rows: DailyCheckIn[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DAILY_CHECKIN_KEY, JSON.stringify(rows.slice(0, 730)));
}


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
  return titleCase(value) || "Training";
}

function symptomFromSnapshot(snapshot: IntakeSnapshotRow | null | undefined) {
  const symptoms = snapshot?.symptoms;
  if (!symptoms || typeof symptoms !== "object") return "Targeted Training";
  const active = Object.entries(symptoms).find(([, value]) => Boolean(value))?.[0] ?? "";
  const map: Record<string, string> = {
    posture: "Posture",
    shoulder_pain: "Shoulder",
    back_pain: "Back",
    knee_pain: "Knee",
    elbow_wrist: "Elbow / Wrist",
  };
  return map[active] ?? (titleCase(active) || "Targeted Training");
}

function programTypeLabel(goalMode: string | null | undefined) {
  const mode = String(goalMode ?? "").toLowerCase();
  return /symptom|target|corrective|posture|rehab/.test(mode)
    ? "Targeted Program"
    : "Goal Program";
}

function equipmentLabel(snapshot: IntakeSnapshotRow | null | undefined) {
  const equipment = snapshot?.constraints?.equipment;
  if (!Array.isArray(equipment) || !equipment.length) return "Equipment";
  const labels = equipment
    .map((value: unknown) => String(value ?? "").toLowerCase())
    .filter(Boolean)
    .map((value: string) => value === "gym" ? "Gym" : value === "home" ? "Home" : titleCase(value));
  return Array.from(new Set(labels)).join(" + ") || "Equipment";
}

function buildPrograms(
  blocks: ProgramBlockRow[],
  intakeMap: Map<string, IntakeSnapshotRow>
) {
  const ordered = [...blocks].sort((a, b) => {
    const left = ms(a.created_at || a.start_date);
    const right = ms(b.created_at || b.start_date);
    return (Number.isFinite(left) ? left : 0) - (Number.isFinite(right) ? right : 0);
  });

  return ordered.map((block): ProgramView => {
    const intake = block.intake_snapshot_id
      ? intakeMap.get(block.intake_snapshot_id) ?? null
      : null;
    const programType = programTypeLabel(block.goal_mode);
    const goalPurpose = goalLabel(block.goal);
    const targetedPurpose = symptomFromSnapshot(intake);
    const hasTarget = targetedPurpose !== "Targeted Training";
    const hasGoal = goalPurpose !== "Training";
    const purpose = hasGoal && hasTarget && goalPurpose.toLowerCase() !== targetedPurpose.toLowerCase()
      ? `${goalPurpose} + ${targetedPurpose}`
      : hasTarget
        ? targetedPurpose
        : goalPurpose;
    const equipment = equipmentLabel(intake);
    const isActive = String(block.status ?? "").toLowerCase() === "active";
    return {
      ...block,
      purpose,
      programType,
      equipment,
      isActive,
      shortLabel: purpose,
      label: `${purpose} • ${programType}${isActive ? " • ACTIVE" : ""}`,
    };
  });
}

function cleanWorkoutName(...values: Array<string | null | undefined>) {
  for (const raw of values) {
    const value = String(raw ?? "").trim();
    if (!value) continue;

    const canonical = value.match(/\b(upper|lower)\s*([12])\b/i);
    if (canonical) return `${titleCase(canonical[1])} ${canonical[2]}`;

    const parts = value
      .split(/[•|]/)
      .map((part) => part.trim())
      .filter(Boolean)
      .filter((part) => !/^\d{4}-\d{2}-\d{2}/.test(part))
      .filter((part) => !/^(future|past|scheduled|completed|active)$/i.test(part));
    const deduped = parts.filter(
      (part, index) => parts.findIndex((candidate) => candidate.toLowerCase() === part.toLowerCase()) === index
    );
    if (deduped.length) return titleCase(deduped[0]);
  }
  return "Workout";
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
    month: "long",
    day: "numeric",
    year: "numeric",
  })} • ${date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function shortDate(value: string) {
  const raw = String(value ?? "").trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T12:00:00`) : new Date(raw);
  if (Number.isNaN(date.getTime())) return "—";
  const month = date.getMonth() + 1;
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}/${day}/${date.getFullYear()}`;
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

function toDateTimeLocal(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function parseOptionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : null;
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
  if (range === 180) return "6 Months";
  if (range === 90) return "3 Months";
  return "30 Days";
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
  const [historyCollapsed, setHistoryCollapsed] = useState<boolean>(() => {
    try { return window.localStorage.getItem("mvp_progress_history_collapsed") === "true"; } catch { return false; }
  });
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [detailId, setDetailId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditSessionDraft | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearText, setClearText] = useState("");
  const [clearBusy, setClearBusy] = useState(false);
  const [scheduledSessions, setScheduledSessions] = useState<ScheduledSessionRow[]>([]);
  const [dailyCheckIns, setDailyCheckIns] = useState<DailyCheckIn[]>(() => readDailyCheckIns());
  const [checkInDraft, setCheckInDraft] = useState<CheckInDraft>(() => ({
    date: todayInputDate(), bodyweight: "", calories: "", protein: "", calorieTarget: "", proteinTarget: "", pain: "", recovery: "",
  }));

  async function loadAll(preferredProgramId?: string | null) {
    setLoading(true);
    setError("");
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!auth.user) throw new Error("Sign in to view progress.");
      const userId = auth.user.id;

      // Daily body/nutrition metrics sync through Supabase when the optional
      // trainer_daily_metrics table is installed. Local storage remains a safe
      // fallback so this page never fails if the migration has not been run yet.
      const { data: dailyMetricData, error: dailyMetricError } = await supabase
        .from("trainer_daily_metrics")
        .select("id,program_block_id,log_date,bodyweight_lb,calories_kcal,protein_g,calorie_target_kcal,protein_target_g,pain,recovery,updated_at")
        .eq("user_id", userId)
        .order("log_date", { ascending: false });
      if (!dailyMetricError && Array.isArray(dailyMetricData)) {
        const synced: DailyCheckIn[] = dailyMetricData.map((raw: any) => ({
          id: `${String(raw.program_block_id)}:${String(raw.log_date)}`,
          programId: String(raw.program_block_id),
          date: String(raw.log_date),
          bodyweightLb: raw.bodyweight_lb == null ? null : Number(raw.bodyweight_lb),
          calories: raw.calories_kcal == null ? null : Number(raw.calories_kcal),
          proteinG: raw.protein_g == null ? null : Number(raw.protein_g),
          calorieTarget: raw.calorie_target_kcal == null ? null : Number(raw.calorie_target_kcal),
          proteinTarget: raw.protein_target_g == null ? null : Number(raw.protein_target_g),
          pain: raw.pain == null ? null : Number(raw.pain),
          recovery: raw.recovery == null ? null : Number(raw.recovery),
          savedAt: raw.updated_at ? ms(String(raw.updated_at)) : Date.now(),
        }));
        setDailyCheckIns(synced);
        writeDailyCheckIns(synced);
      }

      const { data: blockData, error: blockError } = await supabase
        .from("program_blocks")
        .select("id,goal,goal_mode,start_date,end_date,weeks,created_at,status,intake_snapshot_id")
        .eq("user_id", userId)
        .order("created_at", { ascending: true });
      if (blockError) throw blockError;

      const programBlocks = (blockData ?? []) as ProgramBlockRow[];
      const intakeIds = unique(programBlocks.map((block) => block.intake_snapshot_id ?? ""));
      const intakeMap = new Map<string, IntakeSnapshotRow>();
      if (intakeIds.length) {
        const { data: intakeData } = await supabase
          .from("intake_snapshots")
          .select("id,constraints,symptoms,aesthetic_interests")
          .in("id", intakeIds);
        for (const row of (intakeData ?? []) as IntakeSnapshotRow[]) intakeMap.set(row.id, row);
      }

      const builtPrograms = buildPrograms(programBlocks, intakeMap);
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
      setScheduledSessions(scheduled);

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
          .select("id,name,primary_muscles,secondary_muscles,equipment")
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
          identityKey: canonicalExerciseKey({
            id: row.exercise_id,
            name: meta?.name ?? "Exercise",
            primary_muscles: meta?.primary_muscles ?? null,
            equipment: meta?.equipment ?? null,
          }),
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
        const templateName = cleanWorkoutName(
          session?.session_type,
          session?.template_id ? templateMap.get(session.template_id) : null,
          typeof summary?.template_name === "string" ? summary.template_name : null
        );
        const exercises = (detailsByWorkout.get(workout.id) ?? []).slice().sort((a, b) => a.orderIndex - b.orderIndex);
        const loggedSets = exercises.flatMap((exercise) => exercise.sets.filter((set) => set.reps > 0));
        const painValues = [
          ...exercises.map((exercise) => exercise.pain),
          ...loggedSets.map((set) => set.pain),
        ].filter((value): value is number => value != null && Number.isFinite(value));
        return {
          id: workout.id,
          scheduledSessionId: workout.scheduled_session_id,
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
    setCollapsedGroups({});
    setDetailId(null);
    setEditId(null);
    setEditDraft(null);
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
        const list = map.get(exercise.identityKey) ?? [];
        list.push({
          date: workout.completedAt,
          name: exercise.name,
          muscle: exercise.primaryMuscles[0] ?? "Other",
          weight: best?.weight ?? 0,
          reps: best?.reps ?? 0,
          e1rm: best ? e1rm(best.weight, best.reps) : 0,
          pain: exercise.pain,
        });
        map.set(exercise.identityKey, list);
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

  const programCheckIns = useMemo(() => {
    if (selectedProgramId === "all") return dailyCheckIns.filter((row) => inRange(`${row.date}T12:00:00`, range));
    return dailyCheckIns.filter((row) => row.programId === selectedProgramId && inRange(`${row.date}T12:00:00`, range));
  }, [dailyCheckIns, selectedProgramId, range]);

  const bodyweightPoints = useMemo(() => {
    const points: Array<{ date: string; weight: number }> = [];
    for (const row of scopedHistory) if ((row.bodyweightLb ?? 0) > 0) points.push({ date: row.completedAt, weight: Number(row.bodyweightLb) });
    for (const row of programCheckIns) if ((row.bodyweightLb ?? 0) > 0) points.push({ date: `${row.date}T12:00:00`, weight: Number(row.bodyweightLb) });
    const byDay = new Map<string, { date: string; weight: number }>();
    points.sort((a, b) => ms(a.date) - ms(b.date)).forEach((point) => byDay.set(new Date(point.date).toISOString().slice(0,10), point));
    return [...byDay.values()].sort((a, b) => ms(a.date) - ms(b.date));
  }, [scopedHistory, programCheckIns]);

  const performance = useMemo(() => {
    const comparable = exerciseTrends.filter((item) => item.sessions >= 2 && item.change != null && Number.isFinite(item.change));
    const strengthChange = comparable.length ? comparable.reduce((sum, item) => sum + Number(item.change), 0) / comparable.length : null;
    const progressing = comparable.filter((item) => Number(item.change) > 1).length;
    const holding = comparable.filter((item) => Math.abs(Number(item.change)) <= 1).length;
    const needsAttention = comparable.filter((item) => Number(item.change) < -1).length;

    const allSets = scopedHistory.flatMap((workout) => workout.exercises.flatMap((exercise) => exercise.sets.filter((set) => set.reps > 0)));
    const rirValues = allSets.map((set) => set.rir).filter((value): value is number => value != null && Number.isFinite(value));
    const avgRir = rirValues.length ? rirValues.reduce((sum, value) => sum + value, 0) / rirValues.length : null;

    const muscleSets = new Map<string, number>();
    scopedHistory.forEach((workout) => workout.exercises.forEach((exercise) => {
      const hardSets = exercise.sets.filter((set) => set.reps > 0 && (set.rir == null || set.rir <= 4)).length;
      const muscles = exercise.primaryMuscles.length ? exercise.primaryMuscles : ["Other"];
      muscles.forEach((muscle) => muscleSets.set(muscle, (muscleSets.get(muscle) ?? 0) + hardSets));
    }));
    const muscleRows = [...muscleSets.entries()].map(([muscle, sets]) => ({ muscle, sets })).sort((a,b)=>b.sets-a.sets);

    let newPrs = 0;
    const exerciseHistory = new Map<string, Array<{ date: string; best: number; weight: number; reps: number }>>();
    [...scopedHistory].reverse().forEach((workout) => workout.exercises.forEach((exercise) => {
      const bestSet = exercise.sets.filter((set)=>set.reps>0).sort((a,b)=>e1rm(b.weight,b.reps)-e1rm(a.weight,a.reps))[0];
      if (!bestSet) return;
      const list = exerciseHistory.get(exercise.identityKey) ?? [];
      list.push({ date: workout.completedAt, best: e1rm(bestSet.weight,bestSet.reps), weight: bestSet.weight, reps: bestSet.reps });
      exerciseHistory.set(exercise.identityKey,list);
    }));
    exerciseHistory.forEach((points) => {
      if (points.length < 2) return;
      const latest = points.at(-1)!;
      const priorBest = Math.max(0, ...points.slice(0,-1).map((point)=>point.best));
      if (latest.best > priorBest * 1.005) newPrs += 1;
    });

    const latestWeight = bodyweightPoints.at(-1)?.weight ?? null;
    const startWeight = bodyweightPoints[0]?.weight ?? null;
    const weightChange = latestWeight != null && startWeight != null && bodyweightPoints.length > 1 ? latestWeight - startWeight : null;
    const latestDate = bodyweightPoints.at(-1)?.date;
    const firstDate = bodyweightPoints[0]?.date;
    const weeks = latestDate && firstDate ? Math.max(0.01, (ms(latestDate)-ms(firstDate))/604800000) : 0;
    const weeklyWeightChange = weightChange != null && weeks > 0.2 ? weightChange / weeks : null;
    const last7 = bodyweightPoints.filter((point) => Date.now() - ms(point.date) <= 7*86400000);
    const avg7 = last7.length ? last7.reduce((sum,point)=>sum+point.weight,0)/last7.length : latestWeight;

    const calorieRows = programCheckIns.filter((row): row is DailyCheckIn & { calories: number } => row.calories != null && row.calories > 0);
    const proteinRows = programCheckIns.filter((row): row is DailyCheckIn & { proteinG: number } => row.proteinG != null && row.proteinG > 0);
    const recoveryRows = programCheckIns.filter((row): row is DailyCheckIn & { recovery: number } => row.recovery != null && row.recovery >= 1 && row.recovery <= 5);
    const dailyPainRows = programCheckIns.filter((row): row is DailyCheckIn & { pain: number } => row.pain != null && row.pain >= 0 && row.pain <= 10);
    const calorieAverage = calorieRows.length ? calorieRows.reduce((sum,row)=>sum+row.calories,0)/calorieRows.length : null;
    const proteinAverage = proteinRows.length ? proteinRows.reduce((sum,row)=>sum+row.proteinG,0)/proteinRows.length : null;
    const recoveryAverage = recoveryRows.length ? recoveryRows.reduce((sum,row)=>sum+row.recovery,0)/recoveryRows.length : null;
    const dailyPainAverage = dailyPainRows.length ? dailyPainRows.reduce((sum,row)=>sum+row.pain,0)/dailyPainRows.length : null;
    const calorieTarget = [...programCheckIns].reverse().find((row)=>(row.calorieTarget ?? 0)>0)?.calorieTarget ?? null;
    const proteinTarget = [...programCheckIns].reverse().find((row)=>(row.proteinTarget ?? 0)>0)?.proteinTarget ?? scopedHistory.find((row)=>(row.proteinTargetG ?? 0)>0)?.proteinTargetG ?? null;
    const calorieHit = calorieTarget && calorieRows.length ? calorieRows.filter((row)=>row.calories >= calorieTarget*0.95 && row.calories <= calorieTarget*1.05).length : 0;
    const proteinHit = proteinTarget && proteinRows.length ? proteinRows.filter((row)=>row.proteinG >= proteinTarget).length : 0;

    const painRows = scopedHistory.filter((row)=>row.painAvg > 0);
    const recentPain = painRows.slice(0, Math.max(1,Math.ceil(painRows.length/2)));
    const olderPain = painRows.slice(Math.max(1,Math.ceil(painRows.length/2)));
    const painAvg = recentPain.length ? recentPain.reduce((sum,row)=>sum+row.painAvg,0)/recentPain.length : 0;
    const painPrior = olderPain.length ? olderPain.reduce((sum,row)=>sum+row.painAvg,0)/olderPain.length : null;
    const painChange = painPrior != null ? painAvg - painPrior : null;

    const planned = scheduledSessions.filter((session) => {
      if (selectedProgramId !== "all" && session.program_block_id !== selectedProgramId) return false;
      if (!session.date) return false;
      const date = new Date(`${session.date}T12:00:00`);
      if (Number.isNaN(date.getTime()) || date.getTime() > Date.now()+86400000) return false;
      return inRange(date.toISOString(), range);
    }).length;
    const adherence = planned > 0 ? Math.min(100, (scopedHistory.length/planned)*100) : null;

    return { strengthChange, progressing, holding, needsAttention, avgRir, muscleRows, newPrs, latestWeight, startWeight, weightChange, weeklyWeightChange, avg7, calorieAverage, proteinAverage, recoveryAverage, dailyPainAverage, calorieTarget, proteinTarget, calorieDays: calorieRows.length, proteinDays: proteinRows.length, recoveryDays: recoveryRows.length, calorieHit, proteinHit, painAvg, painChange, planned, adherence };
  }, [exerciseTrends, scopedHistory, bodyweightPoints, programCheckIns, scheduledSessions, selectedProgramId, range]);

  async function saveDailyCheckIn() {
    if (selectedProgramId === "all") { setError("Choose a specific program before saving a daily check-in."); return; }
    const numberOrNull = (value: string) => { const parsed = Number(value); return value.trim() && Number.isFinite(parsed) ? parsed : null; };
    const row: DailyCheckIn = {
      id: `${selectedProgramId}:${checkInDraft.date}`,
      programId: selectedProgramId,
      date: checkInDraft.date || todayInputDate(),
      bodyweightLb: numberOrNull(checkInDraft.bodyweight),
      calories: numberOrNull(checkInDraft.calories),
      proteinG: numberOrNull(checkInDraft.protein),
      calorieTarget: numberOrNull(checkInDraft.calorieTarget),
      proteinTarget: numberOrNull(checkInDraft.proteinTarget),
      pain: numberOrNull(checkInDraft.pain),
      recovery: numberOrNull(checkInDraft.recovery),
      savedAt: Date.now(),
    };
    const next = [row, ...dailyCheckIns.filter((item)=>item.id!==row.id)].sort((a,b)=>b.date.localeCompare(a.date));
    setDailyCheckIns(next);
    writeDailyCheckIns(next);

    let synced = false;
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (auth.user) {
        const { error: syncError } = await supabase
          .from("trainer_daily_metrics")
          .upsert({
            user_id: auth.user.id,
            program_block_id: selectedProgramId,
            log_date: row.date,
            bodyweight_lb: row.bodyweightLb,
            calories_kcal: row.calories,
            protein_g: row.proteinG,
            calorie_target_kcal: row.calorieTarget,
            protein_target_g: row.proteinTarget,
            pain: row.pain,
            recovery: row.recovery,
            updated_at: new Date().toISOString(),
          }, { onConflict: "user_id,program_block_id,log_date" });
        synced = !syncError;
      }
    } catch {
      synced = false;
    }

    setCheckInDraft((current)=>({ ...current, bodyweight:"", calories:"", protein:"", pain:"", recovery:"" }));
    setMessage(synced ? "✓ DAILY CHECK-IN SAVED" : "✓ CHECK-IN SAVED ON THIS DEVICE");
    window.setTimeout(()=>setMessage(""),1800);
  }

  const programInsight = useMemo(() => {
    const pieces: string[] = [];
    if (performance.weeklyWeightChange != null) pieces.push(`Body weight is ${performance.weeklyWeightChange >= 0 ? "up" : "down"} ${Math.abs(performance.weeklyWeightChange).toFixed(2)} lb/week.`);
    if (performance.strengthChange != null) pieces.push(`Comparable exercise strength is ${performance.strengthChange >= 0 ? "up" : "down"} ${Math.abs(performance.strengthChange).toFixed(1)}%.`);
    if (performance.proteinAverage != null && performance.proteinTarget) pieces.push(`Protein is averaging ${Math.round(performance.proteinAverage)} of ${Math.round(performance.proteinTarget)} g/day.`);
    if (performance.painChange != null) pieces.push(`Pain trend is ${performance.painChange > .2 ? "higher" : performance.painChange < -.2 ? "lower" : "stable"} versus the earlier sessions in this view.`);
    return pieces.length ? pieces.join(" ") : "Keep logging workouts, body weight, nutrition and pain to build a clearer program trend.";
  }, [performance]);

  const historyGroups = useMemo(() => {
    const now = new Date();
    const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const startOfWeek = (date: Date) => {
      const d = startOfDay(date);
      const day = (d.getDay() + 6) % 7;
      d.setDate(d.getDate() - day);
      return d;
    };
    const thisWeek = startOfWeek(now);
    const lastWeek = new Date(thisWeek); lastWeek.setDate(lastWeek.getDate() - 7);
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const groups = new Map<string, { key: string; label: string; sort: number; rows: HistoryRow[] }>();
    for (const row of scopedHistory) {
      const date = new Date(row.completedAt);
      if (Number.isNaN(date.getTime())) continue;
      let key = ""; let label = ""; let sort = 0;
      if (date >= thisWeek) { key = "this-week"; label = "This Week"; sort = 5000000000; }
      else if (date >= lastWeek && date < thisWeek) { key = "last-week"; label = "Last Week"; sort = 4900000000; }
      else if (date >= thisMonth) { key = "this-month"; label = "This Month"; sort = 4800000000; }
      else if (date >= lastMonth && date < thisMonth) { key = `${date.getFullYear()}-${date.getMonth()}`; label = date.toLocaleDateString(undefined,{month:"long",year:"numeric"}); sort = date.getFullYear()*100+date.getMonth(); }
      else if (date.getFullYear() === now.getFullYear()) { key = `${date.getFullYear()}-${date.getMonth()}`; label = date.toLocaleDateString(undefined,{month:"long",year:"numeric"}); sort = date.getFullYear()*100+date.getMonth(); }
      else { key = `year-${date.getFullYear()}`; label = String(date.getFullYear()); sort = date.getFullYear(); }
      const group = groups.get(key) ?? { key, label, sort, rows: [] };
      group.rows.push(row); groups.set(key, group);
    }
    return [...groups.values()].sort((a,b)=>b.sort-a.sort);
  }, [scopedHistory]);

  useEffect(() => {
    if (!historyGroups.length) return;
    setCollapsedGroups((current) => {
      const next = { ...current };
      historyGroups.forEach((group, index) => { if (!(group.key in next)) next[group.key] = index > 0; });
      return next;
    });
  }, [historyGroups]);

  function setHistoryCollapsedPersisted(value: boolean) {
    setHistoryCollapsed(value);
    try { window.localStorage.setItem("mvp_progress_history_collapsed", String(value)); } catch {}
  }

  const detail = history.find((row) => row.id === detailId) ?? null;
  const deleting = history.find((row) => row.id === deleteId) ?? null;
  const editing = history.find((row) => row.id === editId) ?? null;

  function openEditSession(row: HistoryRow) {
    setDetailId(null);
    setEditId(row.id);
    setEditDraft({
      workoutId: row.id,
      scheduledSessionId: row.scheduledSessionId,
      workoutName: row.templateName,
      durationMinutes: String(Math.max(1, Math.round(row.workoutSeconds / 60) || 1)),
      completedLocal: toDateTimeLocal(row.completedAt),
      programId: row.programId ?? "",
      exercises: row.exercises.map((exercise) => ({
        workoutExerciseId: exercise.workoutExerciseId,
        name: exercise.name,
        pain: exercise.pain == null ? "" : String(exercise.pain),
        sets: exercise.sets.map((set) => ({
          workoutExerciseId: exercise.workoutExerciseId,
          setIndex: set.set_index,
          weight: String(set.weight ?? 0),
          reps: String(set.reps ?? 0),
          rir: set.rir == null ? "" : String(set.rir),
          pain: set.pain == null ? "" : String(set.pain),
          form: set.form == null ? "" : String(set.form),
        })),
      })),
    });
  }

  function updateEditExercisePain(workoutExerciseId: string, value: string) {
    setEditDraft((current) => current ? {
      ...current,
      exercises: current.exercises.map((exercise) =>
        exercise.workoutExerciseId === workoutExerciseId ? { ...exercise, pain: value } : exercise
      ),
    } : current);
  }

  function updateEditSet(
    workoutExerciseId: string,
    setIndex: number,
    field: keyof Pick<EditSetDraft, "weight" | "reps" | "rir" | "pain" | "form">,
    value: string
  ) {
    setEditDraft((current) => current ? {
      ...current,
      exercises: current.exercises.map((exercise) =>
        exercise.workoutExerciseId !== workoutExerciseId ? exercise : {
          ...exercise,
          sets: exercise.sets.map((set) =>
            set.setIndex === setIndex ? { ...set, [field]: value } : set
          ),
        }
      ),
    } : current);
  }

  async function saveEditedSession() {
    if (!editing || !editDraft || editBusy) return;
    const durationMinutes = Number(editDraft.durationMinutes);
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0 || durationMinutes > 1440) {
      setError("Enter a session duration between 1 and 1,440 minutes.");
      return;
    }
    const completedDate = new Date(editDraft.completedLocal);
    if (!editDraft.completedLocal || Number.isNaN(completedDate.getTime())) {
      setError("Enter a valid completed date and time.");
      return;
    }

    setEditBusy(true);
    setError("");
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!auth.user) throw new Error("Sign in first.");

      const { error: workoutError } = await supabase
        .from("workouts")
        .update({
          active_seconds: Math.round(durationMinutes * 60),
          completed_at: completedDate.toISOString(),
        })
        .eq("id", editing.id)
        .eq("user_id", auth.user.id);
      if (workoutError) throw workoutError;

      if (
        editDraft.scheduledSessionId &&
        editDraft.programId &&
        editDraft.programId !== (editing.programId ?? "")
      ) {
        const { error: programError } = await supabase
          .from("scheduled_sessions")
          .update({ program_block_id: editDraft.programId })
          .eq("id", editDraft.scheduledSessionId)
          .eq("user_id", auth.user.id);
        if (programError) throw programError;
      }

      for (const exercise of editDraft.exercises) {
        const exercisePain = parseOptionalNumber(exercise.pain);
        const { error: exerciseError } = await supabase
          .from("workout_exercises")
          .update({ pain: exercisePain })
          .eq("id", exercise.workoutExerciseId)
          .eq("workout_id", editing.id);
        if (exerciseError) throw exerciseError;

        for (const set of exercise.sets) {
          const weight = Math.max(0, Number(set.weight) || 0);
          const reps = Math.max(0, Math.round(Number(set.reps) || 0));
          const rir = parseOptionalNumber(set.rir);
          const pain = parseOptionalNumber(set.pain);
          const form = parseOptionalNumber(set.form);
          const { error: setError } = await supabase
            .from("workout_sets")
            .update({ weight, reps, rir, pain, form })
            .eq("workout_exercise_id", set.workoutExerciseId)
            .eq("set_index", set.setIndex);
          if (setError) throw setError;
        }
      }

      const nextProgramId = editDraft.programId || selectedProgramId;
      setEditId(null);
      setEditDraft(null);
      setMessage("✓ SESSION UPDATED");
      await loadAll(nextProgramId === "all" ? selectedProgramId : nextProgramId);
      window.setTimeout(() => setMessage((current) => current === "✓ SESSION UPDATED" ? "" : current), 2000);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update this session.");
    } finally {
      setEditBusy(false);
    }
  }


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
    : selectedProgram?.purpose ?? "Active Program";

  return (
    <main className="prx-page">
      <section className="prx-hero">
        <div className="prx-heroText">
          <h1>Progress</h1>
        </div>
        <div className="prx-controls">
          <label>
            <span>PROGRAM</span>
            <select value={selectedProgramId} onChange={(event) => setSelectedProgramId(event.target.value)}>
              {programs.length ? <optgroup label="PROGRAMS">
                {[...programs].reverse().map((program) => <option key={program.id} value={program.id}>{program.purpose}{program.isActive ? " • ACTIVE" : ""}</option>)}
              </optgroup> : null}
              <option value="all">All Programs</option>
            </select>
          </label>
          <label>
            <span>RANGE</span>
            <select value={String(range)} onChange={(event) => setRange(event.target.value === "all" ? "all" : Number(event.target.value) as Range)}>
              <option value="30">30 Days</option><option value="90">3 Months</option><option value="180">6 Months</option><option value="365">1 Year</option><option value="all">All</option>
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
        {selectedProgram ? <div className="prx-programMeta"><div><span>PROGRAM TYPE</span><strong>{selectedProgram.programType}</strong></div><div><span>EQUIPMENT</span><strong>{selectedProgram.equipment}</strong></div><div><span>START</span><strong>{selectedProgram.start_date ? shortDate(selectedProgram.start_date) : "—"}</strong></div><div className={selectedProgram.isActive ? "is-active" : ""}><span>STATUS</span><strong>{selectedProgram.isActive ? "ACTIVE" : "PAST"}</strong></div></div> : <div className="prx-programMeta"><div><span>SCOPE</span><strong>EVERY PROGRAM</strong></div><div><span>PROGRAMS</span><strong>{programs.length}</strong></div></div>}
      </section>

      <section className="prx-kpis prx-kpis--performance">
        <article className="is-weight"><Icon name="trend" /><div><span>CURRENT WEIGHT</span><strong>{performance.latestWeight != null ? `${formatNumber(performance.latestWeight, 1)} LB` : "—"}</strong><small>{performance.avg7 != null ? `7-day avg ${formatNumber(performance.avg7,1)} lb` : "Log body weight"}</small></div></article>
        <article className="is-weight"><Icon name="trend" /><div><span>WEIGHT TREND</span><strong>{performance.weeklyWeightChange != null ? `${performance.weeklyWeightChange >= 0 ? "+" : ""}${performance.weeklyWeightChange.toFixed(2)} LB/WK` : "—"}</strong><small>{performance.weightChange != null ? `${performance.weightChange >= 0 ? "+" : ""}${performance.weightChange.toFixed(1)} lb in this view` : "Needs 2 weigh-ins"}</small></div></article>
        <article className="is-strength"><Icon name="trend" /><div><span>STRENGTH TREND</span><strong>{formatPct(performance.strengthChange)}</strong><small>{performance.progressing} progressing • {performance.holding} holding</small></div></article>
        <article className="is-adherence"><Icon name="program" /><div><span>ADHERENCE</span><strong>{performance.adherence != null ? `${Math.round(performance.adherence)}%` : "—"}</strong><small>{scopedHistory.length}{performance.planned ? ` / ${performance.planned}` : ""} completed</small></div></article>
        <article className="is-nutrition"><Icon name="sets" /><div><span>AVG CALORIES</span><strong>{performance.calorieAverage != null ? formatNumber(performance.calorieAverage) : "—"}</strong><small>{performance.calorieTarget ? `target ${formatNumber(performance.calorieTarget)}` : "Set calorie target"}</small></div></article>
        <article className="is-nutrition"><Icon name="sets" /><div><span>AVG PROTEIN</span><strong>{performance.proteinAverage != null ? `${formatNumber(performance.proteinAverage)} G` : "—"}</strong><small>{performance.proteinTarget ? `target ${formatNumber(performance.proteinTarget)} g` : "Set protein target"}</small></div></article>
        <article className={`is-pain is-${toneForPain(performance.painAvg)}`}><Icon name="pain" /><div><span>PAIN TREND</span><strong>{performance.painAvg ? performance.painAvg.toFixed(1) : "0.0"}</strong><small>{performance.painChange == null ? "0–10 scale" : `${performance.painChange > 0 ? "+" : ""}${performance.painChange.toFixed(1)} vs earlier`}</small></div></article>
        <article className="is-recovery"><Icon name="time" /><div><span>AVG RIR</span><strong>{performance.avgRir != null ? performance.avgRir.toFixed(1) : "—"}</strong><small>{metrics.sets} working sets logged</small></div></article>
        <article className="is-recovery"><Icon name="time" /><div><span>RECOVERY</span><strong>{performance.recoveryAverage != null ? `${performance.recoveryAverage.toFixed(1)} / 5` : "—"}</strong><small>{performance.recoveryDays ? `${performance.recoveryDays} daily check-in${performance.recoveryDays === 1 ? "" : "s"}` : "Log daily recovery"}</small></div></article>
      </section>

      <section className="prx-insightCard">
        <div><span>PROGRAM INSIGHT</span><strong>{currentProgramText}</strong></div>
        <p>{programInsight}</p>
      </section>

      <section className="prx-panel prx-panel--nutrition">
        <header className="prx-sectionHead"><div><span>BODY & NUTRITION</span><h2>Daily Check-In</h2></div><small>REAL NUMBERS YOU ENTER</small></header>
        <div className="prx-checkInGrid">
          <label><span>DATE</span><input type="date" value={checkInDraft.date} onChange={(event)=>setCheckInDraft((current)=>({...current,date:event.target.value}))} /></label>
          <label><span>BODY WEIGHT</span><div><input type="number" inputMode="decimal" placeholder="lb" value={checkInDraft.bodyweight} onChange={(event)=>setCheckInDraft((current)=>({...current,bodyweight:event.target.value}))} /><b>LB</b></div></label>
          <label><span>CALORIES EATEN</span><div><input type="number" inputMode="numeric" placeholder="kcal" value={checkInDraft.calories} onChange={(event)=>setCheckInDraft((current)=>({...current,calories:event.target.value}))} /><b>KCAL</b></div></label>
          <label><span>PROTEIN</span><div><input type="number" inputMode="numeric" placeholder="grams" value={checkInDraft.protein} onChange={(event)=>setCheckInDraft((current)=>({...current,protein:event.target.value}))} /><b>G</b></div></label>
          <label><span>CALORIE TARGET</span><div><input type="number" inputMode="numeric" placeholder="target" value={checkInDraft.calorieTarget} onChange={(event)=>setCheckInDraft((current)=>({...current,calorieTarget:event.target.value}))} /><b>KCAL</b></div></label>
          <label><span>PROTEIN TARGET</span><div><input type="number" inputMode="numeric" placeholder="target" value={checkInDraft.proteinTarget} onChange={(event)=>setCheckInDraft((current)=>({...current,proteinTarget:event.target.value}))} /><b>G</b></div></label>
          <label><span>PAIN TODAY</span><div><input type="number" min="0" max="10" inputMode="decimal" placeholder="0–10" value={checkInDraft.pain} onChange={(event)=>setCheckInDraft((current)=>({...current,pain:event.target.value}))} /><b>/10</b></div></label>
          <label><span>RECOVERY</span><div><input type="number" min="1" max="5" inputMode="numeric" placeholder="1–5" value={checkInDraft.recovery} onChange={(event)=>setCheckInDraft((current)=>({...current,recovery:event.target.value}))} /><b>/5</b></div></label>
          <button type="button" onClick={() => void saveDailyCheckIn()} disabled={selectedProgramId === "all"}>SAVE CHECK-IN</button>
        </div>
        <div className="prx-bodyNutritionGrid">
          <article className="is-weight"><header><span>BODYWEIGHT</span><strong>{performance.latestWeight != null ? `${formatNumber(performance.latestWeight,1)} LB` : "NO WEIGHT DATA"}</strong></header><div className="prx-miniMetrics"><div><span>PROGRAM START</span><b>{performance.startWeight != null ? `${formatNumber(performance.startWeight,1)} LB` : "—"}</b></div><div><span>7-DAY AVG</span><b>{performance.avg7 != null ? `${formatNumber(performance.avg7,1)} LB` : "—"}</b></div><div><span>RATE</span><b>{performance.weeklyWeightChange != null ? `${performance.weeklyWeightChange >= 0 ? "+" : ""}${performance.weeklyWeightChange.toFixed(2)} LB/WK` : "—"}</b></div></div><div className="prx-weightPoints">{bodyweightPoints.slice(-7).map((point)=><span key={point.date}><b>{formatNumber(point.weight,1)}</b><small>{shortDate(point.date)}</small></span>)}</div></article>
          <article className="is-nutrition"><header><span>NUTRITION</span><strong>{performance.calorieDays || performance.proteinDays ? "TRACKING" : "NO DAILY LOGS"}</strong></header><div className="prx-miniMetrics"><div><span>CAL AVG</span><b>{performance.calorieAverage != null ? formatNumber(performance.calorieAverage) : "—"}</b></div><div><span>CAL TARGET HIT</span><b>{performance.calorieTarget && performance.calorieDays ? `${performance.calorieHit}/${performance.calorieDays}` : "—"}</b></div><div><span>PROTEIN AVG</span><b>{performance.proteinAverage != null ? `${formatNumber(performance.proteinAverage)} G` : "—"}</b></div><div><span>PROTEIN TARGET HIT</span><b>{performance.proteinTarget && performance.proteinDays ? `${performance.proteinHit}/${performance.proteinDays}` : "—"}</b></div></div><p>{performance.calorieTarget && performance.calorieAverage != null ? `Calories are averaging ${Math.round(performance.calorieAverage-performance.calorieTarget)} kcal ${performance.calorieAverage >= performance.calorieTarget ? "above" : "below"} the current target.` : "Add calorie and protein entries to connect nutrition with weight and strength trends."}</p></article>
        </div>
      </section>

      <section className="prx-panel prx-panel--training">
        <header className="prx-sectionHead"><div><span>TRAINING PERFORMANCE</span><h2>Muscle-Building Work</h2></div><small>{performance.newPrs} RECENT PR{performance.newPrs === 1 ? "" : "S"}</small></header>
        <div className="prx-trainingSummary">
          <article className="is-strength"><span>EXERCISES</span><strong>{performance.progressing} ↑</strong><small>progressing</small></article>
          <article className="is-hold"><span>HOLDING</span><strong>{performance.holding}</strong><small>stable</small></article>
          <article className="is-pain"><span>NEEDS ATTENTION</span><strong>{performance.needsAttention}</strong><small>strength down</small></article>
          <article className="is-recovery"><span>AVG SESSION</span><strong>{metrics.sessions ? formatDuration(metrics.seconds/metrics.sessions) : "—"}</strong><small>active training time</small></article>
        </div>
        {performance.muscleRows.length ? <div className="prx-muscleSetGrid">{performance.muscleRows.slice(0,12).map((row)=><article key={row.muscle}><span>{row.muscle}</span><strong>{row.sets}</strong><small>hard sets</small><i style={{width:`${Math.min(100,(row.sets/Math.max(1,performance.muscleRows[0]?.sets ?? 1))*100)}%`}} /></article>)}</div> : <div className="prx-empty">Complete logged working sets to build muscle-group training data.</div>}
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
        <header className="prx-sectionHead prx-historyHead">
          <div><h2>Session History</h2><small>{scopedHistory.length} SESSION{scopedHistory.length === 1 ? "" : "S"}</small></div>
          <button type="button" className="prx-collapseAll" onClick={() => setHistoryCollapsedPersisted(!historyCollapsed)}>{historyCollapsed ? "EXPAND" : "COLLAPSE"}</button>
        </header>
        {!loading && !scopedHistory.length ? <div className="prx-empty">No completed sessions match this program and date range.</div> : null}
        {!historyCollapsed ? <div className="prx-historyGroups">
          {historyGroups.map((group) => {
            const collapsed = Boolean(collapsedGroups[group.key]);
            return <section className="prx-historyGroup" key={group.key}>
              <button type="button" className="prx-historyGroupHead" onClick={() => setCollapsedGroups((current) => ({ ...current, [group.key]: !collapsed }))}>
                <span>{group.label}</span><b>{group.rows.length} SESSION{group.rows.length === 1 ? "" : "S"}</b><i>{collapsed ? "+" : "−"}</i>
              </button>
              {!collapsed ? <div className="prx-historyList">
                {group.rows.map((row) => {
                  const programForRow = selectedProgramId !== "all" && selectedProgram ? selectedProgram : programs.find((program) => program.id === row.programId) ?? null;
                  return <article key={row.id} className="prx-historyRow">
                    <div className="prx-historyMain">
                      <div className="prx-programBadge"><span>{(programForRow?.purpose ?? row.programPurpose).toUpperCase()}</span><strong>{programForRow?.programType ?? (row.programId ? "PROGRAM" : "LEGACY / UNASSIGNED")}</strong></div>
                      <h3>{row.templateName}</h3>
                      <p>{formatDate(row.completedAt)}</p>
                      <div className="prx-historyMetrics"><span><b>{formatDuration(row.workoutSeconds)}</b> TIME</span><span><b>{row.exercises.length}</b> EXERCISES</span><span><b>{row.setsLogged}</b> SETS</span><span className={`is-${toneForPain(row.painMax)}`}><b>{row.painMax.toFixed(0)}</b> PAIN</span></div>
                    </div>
                    <div className="prx-historyActions"><button type="button" onClick={() => setDetailId(row.id)}>VIEW DETAILS</button><button type="button" className="is-edit" onClick={() => openEditSession(row)}>EDIT SESSION</button><button type="button" className="is-delete" onClick={() => setDeleteId(row.id)}><Icon name="trash" />DELETE SESSION</button></div>
                  </article>;
                })}
              </div> : null}
            </section>;
          })}
        </div> : null}
      </section>

      <section className="prx-dangerZone">
        <div><span>DATA CONTROL</span><strong>Clear all workout logs</strong><small>This is separate from deleting one mistaken session above.</small></div>
        <button onClick={() => setClearOpen(true)}>CLEAR ALL LOGS</button>
      </section>

      {detail ? <div className="prx-modalBack" onMouseDown={() => setDetailId(null)}><section className="prx-modal prx-detailModal" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span>{detail.programLabel}</span><h2>{detail.templateName}</h2><p>{formatDate(detail.completedAt)}</p></div><button onClick={() => setDetailId(null)}>×</button></header>
        <div className="prx-detailSummary"><div><span>TIME</span><strong>{formatDuration(detail.workoutSeconds)}</strong></div><div><span>EXERCISES</span><strong>{detail.exercises.length}</strong></div><div><span>SETS</span><strong>{detail.setsLogged}</strong></div><div><span>PAIN MAX</span><strong>{detail.painMax.toFixed(0)}/10</strong></div></div>
        <div className="prx-detailScroll">{detail.exercises.map((exercise) => <article className="prx-exerciseDetail" key={exercise.workoutExerciseId}><header><div><span>{exercise.primaryMuscles.join(" • ") || "EXERCISE"}</span><strong>{exercise.name}</strong></div>{exercise.pain != null ? <em>PAIN {exercise.pain}/10</em> : null}</header><div className="prx-setTable"><div className="prx-setHead"><span>SET</span><span>WEIGHT</span><span>REPS</span><span>RIR</span><span>FORM</span></div>{exercise.sets.map((set) => <div key={`${exercise.workoutExerciseId}-${set.set_index}`}><span>{set.set_index}</span><strong>{set.weight > 0 ? `${formatNumber(set.weight, set.weight % 1 ? 1 : 0)} LB` : "BW"}</strong><strong>{set.reps || "—"}</strong><span>{set.rir ?? "—"}</span><span>{set.form ?? "—"}</span></div>)}</div></article>)}</div>
        <footer><button onClick={() => setDetailId(null)}>CLOSE</button><button className="is-edit" onClick={() => openEditSession(detail)}>EDIT SESSION</button><button className="is-delete" onClick={() => { setDeleteId(detail.id); setDetailId(null); }}>DELETE SESSION</button></footer>
      </section></div> : null}

      {editing && editDraft ? <div className="prx-modalBack" onMouseDown={() => !editBusy && (setEditId(null), setEditDraft(null))}><section className="prx-modal prx-editModal" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span>EDIT COMPLETED SESSION</span><h2>{editing.templateName}</h2><p>Correct a logging mistake without deleting the workout.</p></div><button disabled={editBusy} onClick={() => { setEditId(null); setEditDraft(null); }}>×</button></header>
        <div className="prx-editScroll">
          <section className="prx-editBasics">
            <label><span>SESSION DURATION</span><div className="prx-durationInput"><input type="number" min="1" max="1440" inputMode="numeric" value={editDraft.durationMinutes} onChange={(event) => setEditDraft((current) => current ? { ...current, durationMinutes: event.target.value } : current)} /><b>MINUTES</b></div><small>Correct the recorded session length when needed.</small></label>
            <label><span>COMPLETED DATE / TIME</span><input type="datetime-local" value={editDraft.completedLocal} onChange={(event) => setEditDraft((current) => current ? { ...current, completedLocal: event.target.value } : current)} /></label>
            <label><span>PROGRAM</span><select value={editDraft.programId} disabled={!editDraft.scheduledSessionId} onChange={(event) => setEditDraft((current) => current ? { ...current, programId: event.target.value } : current)}><option value="">Legacy / Unassigned</option>{[...programs].reverse().map((program) => <option key={program.id} value={program.id}>{program.purpose}{program.isActive ? " • ACTIVE" : ""}</option>)}</select><small>{editDraft.scheduledSessionId ? "Moving a session changes the program totals it contributes to." : "This legacy workout is not linked to a scheduled session."}</small></label>
          </section>
          <section className="prx-editLog">
            <div className="prx-editLogHead"><span>EXERCISE LOG</span><strong>Edit only values that were entered incorrectly.</strong></div>
            {editDraft.exercises.map((exercise) => <article className="prx-editExercise" key={exercise.workoutExerciseId}>
              <header><strong>{exercise.name}</strong><label><span>EXERCISE PAIN</span><input type="number" min="0" max="10" step="1" value={exercise.pain} onChange={(event) => updateEditExercisePain(exercise.workoutExerciseId, event.target.value)} placeholder="—" /></label></header>
              <div className="prx-editSetHead"><span>SET</span><span>WEIGHT</span><span>REPS</span><span>RIR</span><span>PAIN</span><span>FORM</span></div>
              {exercise.sets.map((set) => <div className="prx-editSet" key={`${set.workoutExerciseId}-${set.setIndex}`}><b>{set.setIndex}</b><input inputMode="decimal" value={set.weight} onChange={(event) => updateEditSet(set.workoutExerciseId,set.setIndex,"weight",event.target.value)} /><input inputMode="numeric" value={set.reps} onChange={(event) => updateEditSet(set.workoutExerciseId,set.setIndex,"reps",event.target.value)} /><input inputMode="decimal" value={set.rir} onChange={(event) => updateEditSet(set.workoutExerciseId,set.setIndex,"rir",event.target.value)} placeholder="—" /><input inputMode="decimal" value={set.pain} onChange={(event) => updateEditSet(set.workoutExerciseId,set.setIndex,"pain",event.target.value)} placeholder="—" /><input inputMode="decimal" value={set.form} onChange={(event) => updateEditSet(set.workoutExerciseId,set.setIndex,"form",event.target.value)} placeholder="—" /></div>)}
            </article>)}
          </section>
        </div>
        <footer><button disabled={editBusy} onClick={() => { setEditId(null); setEditDraft(null); }}>CANCEL</button><button className="is-primary" disabled={editBusy} onClick={() => void saveEditedSession()}>{editBusy ? "SAVING…" : "SAVE SESSION"}</button></footer>
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
        /* AUG 9 READABILITY + EDIT SESSION */
        .prx-page{width:min(1240px,calc(100% - 28px))!important;color:#f5fbfe!important}
        .prx-heroText>span,.prx-sectionHead span,.prx-programIdentity span,.prx-dangerZone span{font-size:9px!important;color:#8ce5fb!important}
        .prx-hero p{font-size:12px!important;line-height:1.55!important;color:#c0d1d8!important}
        .prx-controls label>span{font-size:8px!important;color:#aac0c9!important}.prx-controls select{height:44px!important;font-size:11px!important}
        .prx-programIdentity strong{font-size:21px!important;color:#fff!important}.prx-programIdentity small{font-size:10px!important;color:#b5c9d1!important}
        .prx-programMeta span{font-size:7.5px!important;color:#92aeb9!important}.prx-programMeta strong{font-size:11px!important;color:#fff!important}
        .prx-kpis article>div>span{font-size:8px!important;color:#9eb7c1!important}.prx-kpis article>div>strong{font-size:22px!important;color:#fff!important}.prx-kpis article>div>small{font-size:8px!important;color:#9db3bc!important}
        .prx-sectionHead h2{font-size:25px!important}.prx-sectionHead>small{font-size:8px!important;color:#91a8b1!important}
        .prx-empty{font-size:11px!important;color:#b3c7cf!important}
        .prx-volumeCol>b{font-size:8px!important;color:#d3e1e6!important}.prx-volumeCol strong{font-size:8px!important;color:#eff8fb!important}.prx-volumeCol small{font-size:7px!important;color:#91a7b0!important}
        .prx-trendTop span{font-size:8px!important}.prx-trendTop strong{font-size:13px!important}.prx-trendTop em{font-size:9px!important}.prx-trendMetrics span{font-size:7px!important;color:#91a9b2!important}.prx-trendMetrics strong{font-size:11px!important}.prx-trendGrid article>small{font-size:8px!important;color:#9fb5be!important}
        .prx-programBadge span{font-size:8px!important;padding:5px 8px!important;color:#d9f7ff!important}.prx-programBadge strong{font-size:9px!important;color:#aebfc6!important}
        .prx-historyMain h3{font-size:19px!important}.prx-historyMain>p{font-size:10px!important;color:#a8bdc5!important}.prx-historyMetrics span{font-size:8px!important;color:#a8bdc5!important;padding:6px 9px!important}.prx-historyMetrics b{font-size:9px!important;color:#fff!important}
        .prx-historyActions{flex-wrap:wrap!important;justify-content:flex-end!important}.prx-historyActions button,.prx-loadMore,.prx-dangerZone button,.prx-modal footer button{min-height:38px!important;font-size:8.5px!important;color:#fff!important}.prx-historyActions .is-edit,.prx-modal .is-edit{border-color:rgba(74,205,247,.35)!important;background:linear-gradient(180deg,#0b3442,#071e28)!important;color:#fff!important}
        .prx-modal>header span{font-size:8px!important}.prx-modal>header h2{font-size:24px!important}.prx-modal>header p{font-size:9px!important;color:#a9bdc5!important}.prx-detailSummary span{font-size:7px!important}.prx-detailSummary strong{font-size:13px!important}.prx-exerciseDetail>header span{font-size:7px!important}.prx-exerciseDetail>header strong{font-size:12px!important}.prx-exerciseDetail>header em{font-size:8px!important}.prx-setTable .prx-setHead{font-size:7px!important}.prx-setTable span,.prx-setTable strong{font-size:9px!important}
        .prx-editModal{width:min(940px,100%)!important}.prx-editScroll{min-height:0;overflow:auto;padding:13px;display:grid;gap:12px}.prx-editBasics{display:grid;grid-template-columns:1fr 1fr 1fr;gap:9px}.prx-editBasics>label{min-width:0;padding:12px;border:1px solid rgba(96,177,206,.15);border-radius:9px;background:#06151c;display:grid;gap:7px}.prx-editBasics label>span,.prx-editLogHead span,.prx-editExercise header label span{color:#8cdff6;font-size:8px;font-weight:1000;letter-spacing:.1em}.prx-editBasics input,.prx-editBasics select,.prx-editExercise input,.prx-editSet input{width:100%;height:40px;min-width:0;padding:0 9px;border:1px solid rgba(108,182,207,.22);border-radius:7px;background:#041017;color:#fff;font-size:11px;font-weight:850;outline:none}.prx-editBasics input:focus,.prx-editBasics select:focus,.prx-editExercise input:focus,.prx-editSet input:focus{border-color:#4bd4f7;box-shadow:0 0 0 2px rgba(75,212,247,.08)}.prx-editBasics small{color:#9ab1ba;font-size:8px;line-height:1.4}.prx-durationInput{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:7px}.prx-durationInput b{color:#d6e9ef;font-size:9px}.prx-editLog{border:1px solid rgba(94,174,202,.13);border-radius:10px;overflow:hidden;background:#051118}.prx-editLogHead{padding:11px 12px;border-bottom:1px solid rgba(95,174,201,.11);display:flex;justify-content:space-between;gap:12px;align-items:center}.prx-editLogHead strong{color:#dcebf0;font-size:9px}.prx-editExercise+ .prx-editExercise{border-top:1px solid rgba(95,174,201,.12)}.prx-editExercise>header{padding:10px 11px;display:flex;align-items:center;justify-content:space-between;gap:12px;background:#071821}.prx-editExercise>header>strong{color:#fff;font-size:13px}.prx-editExercise>header label{display:grid;grid-template-columns:auto 64px;align-items:center;gap:8px}.prx-editExercise>header label input{height:34px;text-align:center}.prx-editSetHead,.prx-editSet{display:grid;grid-template-columns:45px repeat(5,minmax(70px,1fr));gap:6px;align-items:center;padding:7px 10px}.prx-editSetHead{background:#061219;color:#8da7b1;font-size:7px;font-weight:1000;text-align:center}.prx-editSet{border-top:1px solid rgba(91,165,192,.06)}.prx-editSet>b{color:#d5e6ec;text-align:center;font-size:9px}.prx-editSet input{height:36px;text-align:center}.prx-editModal footer .is-primary{border-color:rgba(72,211,250,.55)!important;background:linear-gradient(180deg,#0d4254,#082833)!important;color:#fff!important}
        @media(max-width:900px){.prx-controls{grid-template-columns:1fr 1fr;min-width:330px}.prx-programDeck{grid-template-columns:1fr}.prx-kpis{grid-template-columns:repeat(3,1fr)}.prx-trendGrid{grid-template-columns:repeat(2,1fr)}}
        @media(max-width:650px){.prx-page{width:calc(100% - 10px);margin-bottom:116px}.prx-hero{padding:17px;display:grid}.prx-hero h1{font-size:36px}.prx-hero p{font-size:12px!important;line-height:1.5!important}.prx-controls{min-width:0;grid-template-columns:1fr}.prx-controls label>span{font-size:8px!important}.prx-controls select{height:46px;font-size:11px!important}.prx-programDeck{padding:13px}.prx-programIdentity strong{white-space:normal;font-size:19px!important}.prx-programIdentity small{font-size:9px!important}.prx-programMeta{grid-template-columns:1fr 1fr}.prx-programMeta>div:nth-child(3){border-left:0;border-top:1px solid rgba(111,180,205,.08)}.prx-programMeta>div:nth-child(4){border-top:1px solid rgba(111,180,205,.08)}.prx-programMeta span{font-size:7px!important}.prx-programMeta strong{font-size:10px!important}.prx-kpis{grid-template-columns:1fr 1fr;gap:7px}.prx-kpis article{min-height:88px}.prx-kpis article:last-child{grid-column:1/-1}.prx-kpis article>div>span{font-size:7.5px!important}.prx-kpis article>div>strong{font-size:21px!important}.prx-kpis article>div>small{font-size:7.5px!important}.prx-sectionHead{padding:13px}.prx-sectionHead h2{font-size:22px!important}.prx-sectionHead>small{font-size:7.5px!important}.prx-trendGrid{grid-template-columns:1fr;padding:8px}.prx-trendTop strong{font-size:14px!important}.prx-trendMetrics strong{font-size:11px!important}.prx-volumeChart{height:188px;padding-left:9px;padding-right:9px}.prx-volumeCol{min-width:60px}.prx-volumeCol>b{font-size:7px!important}.prx-volumeCol strong{font-size:7.5px!important}.prx-historyRow{padding:14px 11px;grid-template-columns:1fr;gap:12px}.prx-historyMain h3{font-size:20px!important}.prx-historyMain>p{font-size:10px!important}.prx-programBadge{align-items:flex-start;flex-direction:column;gap:5px}.prx-programBadge span{font-size:8px!important}.prx-programBadge strong{font-size:8.5px!important}.prx-historyMetrics span{font-size:8px!important}.prx-historyMetrics b{font-size:9px!important}.prx-historyActions{display:grid!important;grid-template-columns:1fr 1fr!important;gap:7px!important}.prx-historyActions button{min-height:42px!important;color:#fff;font-size:8px!important}.prx-historyActions .is-delete{grid-column:1/-1!important}.prx-dangerZone{align-items:flex-start;flex-direction:column}.prx-dangerZone strong{font-size:12px!important}.prx-dangerZone small{font-size:8px!important}.prx-dangerZone button{width:100%;min-height:42px}.prx-modalBack{padding:6px}.prx-modal{max-height:calc(100dvh - 12px);border-radius:12px}.prx-modal>header h2{font-size:21px!important}.prx-detailSummary{grid-template-columns:1fr 1fr}.prx-detailSummary>div:nth-child(3){border-left:0;border-top:1px solid rgba(98,173,199,.08)}.prx-detailSummary>div:nth-child(4){border-top:1px solid rgba(98,173,199,.08)}.prx-detailSummary span{font-size:7px!important}.prx-detailSummary strong{font-size:12px!important}.prx-setTable>div{grid-template-columns:32px 1fr 1fr 42px 42px;padding:8px 5px}.prx-setTable span,.prx-setTable strong{font-size:8px!important}.prx-modal>footer{display:grid;grid-template-columns:1fr 1fr}.prx-modal>footer button{min-height:42px;color:#fff;font-size:8px!important}.prx-detailModal>footer{grid-template-columns:1fr 1fr!important}.prx-detailModal>footer .is-delete{grid-column:1/-1!important}.prx-confirm>div{padding:14px}.prx-editBasics{grid-template-columns:1fr!important}.prx-editBasics>label{padding:11px}.prx-editBasics input,.prx-editBasics select{height:44px;font-size:11px!important}.prx-editLogHead{display:grid;gap:4px}.prx-editLogHead strong{font-size:8px!important}.prx-editExercise>header{align-items:flex-start;display:grid}.prx-editExercise>header>strong{font-size:14px!important}.prx-editExercise>header label{grid-template-columns:1fr 68px}.prx-editSetHead{display:none}.prx-editSet{grid-template-columns:34px 1fr 1fr!important;gap:6px;padding:8px!important}.prx-editSet>b{grid-row:1/3;align-self:stretch;display:grid;place-items:center;border-right:1px solid rgba(97,176,203,.12)}.prx-editSet input{height:40px!important;font-size:10px!important}.prx-editSet input:nth-of-type(1)::before{content:"WEIGHT"}.prx-editScroll{padding:8px}.prx-editModal>footer{grid-template-columns:1fr 1fr!important}}

        /* FINAL READABILITY PASS */
        .prx-heroText>span,.prx-sectionHead span,.prx-programIdentity span,.prx-dangerZone span{font-size:11px!important;line-height:1.35!important}.prx-hero p{font-size:14px!important;line-height:1.55!important}.prx-controls label>span,.prx-programMeta span,.prx-kpis span,.prx-trendTop span,.prx-trendMetrics span{font-size:10px!important;line-height:1.3!important}.prx-controls select{font-size:14px!important}.prx-programIdentity strong{font-size:22px!important}.prx-programIdentity small{font-size:13px!important}.prx-programMeta strong{font-size:14px!important}.prx-kpis article>div>strong{font-size:25px!important}.prx-kpis article>div>small{font-size:12px!important}.prx-sectionHead h2{font-size:26px!important}.prx-sectionHead>small,.prx-empty{font-size:12px!important}.prx-volumeCol>b,.prx-volumeCol strong,.prx-volumeCol small{font-size:10px!important}.prx-trendTop strong{font-size:15px!important}.prx-trendTop em{font-size:11px!important}.prx-trendMetrics strong{font-size:14px!important}.prx-trendGrid article>small{font-size:11px!important;line-height:1.45!important}.prx-historyRow{padding:17px 18px!important}.prx-programBadge span{font-size:11px!important}.prx-programBadge strong{font-size:11px!important}.prx-historyMain h3{font-size:20px!important}.prx-historyMain>p{font-size:13px!important}.prx-historyMetrics span{font-size:11px!important}.prx-historyMetrics b{font-size:13px!important}.prx-historyActions button,.prx-loadMore,.prx-dangerZone button,.prx-modal footer button{min-height:42px!important;font-size:12px!important}.prx-modal>header span{font-size:11px!important}.prx-modal>header p{font-size:12px!important}.prx-detailSummary span{font-size:10px!important}.prx-detailSummary strong{font-size:15px!important}.prx-exerciseDetail>header span{font-size:10px!important}.prx-exerciseDetail>header strong{font-size:15px!important}.prx-setTable .prx-setHead{font-size:10px!important}.prx-setTable span,.prx-setTable strong{font-size:12px!important}.prx-editBasics label>span,.prx-editLogHead span,.prx-editExercise header label span{font-size:10px!important}.prx-editBasics input,.prx-editBasics select,.prx-editExercise input,.prx-editSet input{font-size:14px!important}.prx-editBasics small{font-size:11px!important}.prx-durationInput b,.prx-editLogHead strong,.prx-editSet>b{font-size:11px!important}
        @media(max-width:650px){.prx-page{width:calc(100% - 12px)!important}.prx-hero{padding:18px 16px!important}.prx-hero h1{font-size:36px!important}.prx-programIdentity{align-items:flex-start!important}.prx-programIdentity strong{white-space:normal!important;font-size:21px!important}.prx-programIdentity small{font-size:13px!important}.prx-programMeta span{font-size:9px!important}.prx-programMeta strong{font-size:13px!important}.prx-kpis article{min-height:100px!important}.prx-kpis article>div>span{font-size:9px!important}.prx-kpis article>div>strong{font-size:25px!important}.prx-kpis article>div>small{font-size:11px!important}.prx-sectionHead{align-items:flex-start!important;flex-direction:column!important}.prx-sectionHead h2{font-size:25px!important}.prx-sectionHead>small{font-size:11px!important}.prx-volumeChart{height:230px!important}.prx-volumeCol{min-width:78px!important}.prx-historyMain h3{font-size:21px!important}.prx-historyMain>p{font-size:13px!important}.prx-historyMetrics{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:8px!important}.prx-historyMetrics span{font-size:11px!important}.prx-historyMetrics b{font-size:13px!important}.prx-historyActions button{font-size:12px!important}.prx-modal{width:calc(100vw - 14px)!important;max-height:calc(100dvh - 20px)!important}.prx-modal>footer button{font-size:12px!important}.prx-editBasics input,.prx-editBasics select{font-size:14px!important}.prx-editSet input{font-size:13px!important}}

        /* AUG 9 FINAL PROGRESS SCALING + HISTORY */
        .prx-hero{grid-template-columns:minmax(0,1fr) minmax(360px,520px)!important;align-items:end!important}
        .prx-controls{width:100%!important;min-width:0!important;grid-template-columns:minmax(220px,1.4fr) minmax(150px,.7fr)!important}
        .prx-controls label,.prx-controls select{min-width:0!important;width:100%!important}
        .prx-controls select{overflow:hidden!important;text-overflow:ellipsis!important}
        .prx-programIdentity{min-width:0!important}
        .prx-programIdentity>div{min-width:0!important}
        .prx-programIdentity strong{display:block!important;white-space:normal!important;overflow-wrap:anywhere!important;line-height:1.15!important}
        .prx-historyHead{align-items:center!important;flex-direction:row!important}
        .prx-historyHead>div{display:flex!important;align-items:baseline!important;gap:10px!important;min-width:0!important}
        .prx-historyHead>div>small{color:#a9c0c9!important;font-size:11px!important;font-weight:900!important}
        .prx-collapseAll{min-height:38px!important;padding:0 13px!important;border:1px solid rgba(82,196,234,.28)!important;border-radius:8px!important;background:#08202a!important;color:#fff!important;font-size:11px!important;font-weight:1000!important}
        .prx-historyGroups{display:grid!important;gap:8px!important;padding:9px!important}
        .prx-historyGroup{overflow:hidden!important;border:1px solid rgba(105,178,203,.13)!important;border-radius:11px!important;background:#061219!important}
        .prx-historyGroupHead{width:100%!important;min-height:44px!important;padding:0 12px!important;display:grid!important;grid-template-columns:minmax(0,1fr) auto 24px!important;gap:9px!important;align-items:center!important;border:0!important;background:#091923!important;color:#fff!important;text-align:left!important}
        .prx-historyGroupHead span{font-size:13px!important;font-weight:1000!important}.prx-historyGroupHead b{color:#9eb5be!important;font-size:10px!important}.prx-historyGroupHead i{font-style:normal!important;text-align:center!important;color:#75dcfa!important;font-size:19px!important}
        .prx-historyGroup .prx-historyList{border-top:1px solid rgba(103,177,203,.10)!important}
        @media(max-width:650px){
          .prx-hero{grid-template-columns:1fr!important;padding:16px 13px!important;gap:12px!important}
          .prx-hero h1{font-size:34px!important}
          .prx-controls{grid-template-columns:1fr!important;width:100%!important}
          .prx-controls select{height:46px!important;font-size:13px!important;padding-inline:10px 32px!important}
          .prx-programDeck{padding:13px 11px!important;gap:11px!important}
          .prx-programIdentity{align-items:flex-start!important}
          .prx-programIdentity strong{font-size:20px!important;overflow-wrap:anywhere!important}
          .prx-programMeta{grid-template-columns:repeat(2,minmax(0,1fr))!important}
          .prx-programMeta>div{min-width:0!important;padding:10px 8px!important}
          .prx-programMeta strong{font-size:12px!important;overflow-wrap:anywhere!important}
          .prx-historyHead{flex-direction:row!important;align-items:center!important;padding:12px!important}
          .prx-historyHead h2{font-size:22px!important}
          .prx-historyHead>div{display:grid!important;gap:2px!important}
          .prx-collapseAll{min-height:38px!important;font-size:10px!important}
          .prx-historyGroups{padding:7px!important;gap:7px!important}
          .prx-historyGroupHead{min-height:48px!important;padding:0 10px!important;grid-template-columns:minmax(0,1fr) auto 22px!important}
          .prx-historyGroupHead span{font-size:13px!important}.prx-historyGroupHead b{font-size:9px!important}
          .prx-historyRow{padding:13px 10px!important}
          .prx-historyActions{grid-template-columns:1fr 1fr!important}.prx-historyActions .is-delete{grid-column:1/-1!important}
        }

        .prx-programBadge{min-width:0!important;flex-wrap:wrap!important}.prx-programBadge span,.prx-programBadge strong{white-space:normal!important;overflow-wrap:anywhere!important}

        /* AUG 9 PROGRESS VOLUME + NO-CLIP */
        .prx-controls,.prx-controls label,.prx-controls select,.prx-programDeck,.prx-programIdentity,.prx-programIdentity>div{min-width:0!important;max-width:100%!important}.prx-controls select{width:100%!important;white-space:normal!important;text-overflow:clip!important}.prx-programIdentity strong{white-space:normal!important;overflow:visible!important;text-overflow:clip!important;word-break:break-word!important;line-height:1.25!important;padding-bottom:2px!important}
        .prx-volumeSummary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:12px 14px 2px}.prx-volumeSummary>div{display:grid;gap:4px;padding:10px 12px;border:1px solid rgba(94,173,201,.13);border-radius:10px;background:#061118}.prx-volumeSummary span{font-size:9px;font-weight:1000;letter-spacing:.08em;color:#88a7b3}.prx-volumeSummary strong{font-size:17px;color:#fff}.prx-volumeSummary strong.is-up{color:#76e6ad}.prx-volumeSummary strong.is-down{color:#ff888f}.prx-volumeCol>b{font-size:9px!important;color:#f3f8fa!important;white-space:nowrap!important}.prx-volumeCol strong{white-space:normal!important;overflow:visible!important;text-overflow:clip!important;line-height:1.15!important}
        @media(max-width:650px){.prx-controls{width:100%!important}.prx-controls label{width:100%!important}.prx-controls select{font-size:13px!important;line-height:1.2!important}.prx-volumeSummary{grid-template-columns:1fr!important;padding:9px 9px 0!important}.prx-volumeSummary>div{grid-template-columns:1fr auto;align-items:center;padding:9px 10px!important}.prx-volumeSummary span{font-size:9px!important}.prx-volumeSummary strong{font-size:14px!important}.prx-volumeChart{overflow-x:auto!important;scroll-snap-type:x proximity}.prx-volumeCol{min-width:76px!important;scroll-snap-align:end}.prx-volumeCol>b{font-size:8px!important}.prx-historyGroupHead,.prx-historyTop{min-width:0!important;flex-wrap:wrap!important}.prx-historyMain,.prx-historyMain>*{max-width:100%!important;min-width:0!important;overflow:visible!important;white-space:normal!important;word-break:break-word!important}}


        /* AUG 9 FINAL PROGRESS SYSTEM: semantic sections, real program metrics, no blue wall */
        .prx-page{min-width:0!important;overflow-x:hidden!important}
        .prx-hero,.prx-programDeck,.prx-panel,.prx-insightCard{border-color:rgba(153,177,187,.16)!important;border-top-color:rgba(205,223,230,.20)!important;background:linear-gradient(180deg,#0d151a,#070c10)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.035),0 16px 38px rgba(0,0,0,.24)!important}
        .prx-hero{background:radial-gradient(620px 220px at 4% -30%,rgba(65,190,230,.11),transparent 62%),linear-gradient(180deg,#0e171d,#070c10)!important}
        .prx-programDeck{background:linear-gradient(180deg,#10171b,#080d10)!important}
        .prx-kpis--performance{grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:8px!important}
        .prx-kpis--performance article{position:relative;overflow:hidden;min-height:96px!important;border:1px solid rgba(155,178,188,.14)!important;background:linear-gradient(180deg,#10181d,#080d10)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.025)!important}
        .prx-kpis--performance article::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:#6c8490}
        .prx-kpis--performance article.is-weight::before{background:#48d58d}.prx-kpis--performance article.is-strength::before{background:#4bd3f6}.prx-kpis--performance article.is-adherence::before{background:#5f8df5}.prx-kpis--performance article.is-nutrition::before{background:#f0ad48}.prx-kpis--performance article.is-pain::before{background:#f26872}.prx-kpis--performance article.is-recovery::before{background:#a879f4}
        .prx-kpis--performance article.is-weight svg{color:#5be09a!important}.prx-kpis--performance article.is-strength svg{color:#5adcf8!important}.prx-kpis--performance article.is-adherence svg{color:#7ca2ff!important}.prx-kpis--performance article.is-nutrition svg{color:#f2b75c!important}.prx-kpis--performance article.is-pain svg{color:#ff7881!important}.prx-kpis--performance article.is-recovery svg{color:#b78cff!important}
        .prx-kpis--performance article>div>span{color:#9db1ba!important;font-size:9px!important}.prx-kpis--performance article>div>strong{font-size:23px!important;color:#fff!important;white-space:normal!important;overflow-wrap:anywhere!important}.prx-kpis--performance article>div>small{font-size:10px!important;color:#80959e!important;line-height:1.3!important}
        .prx-insightCard{margin-top:10px;padding:15px 17px;border:1px solid rgba(92,204,232,.18);border-radius:13px;display:grid;grid-template-columns:220px minmax(0,1fr);gap:18px;align-items:center}
        .prx-insightCard>div{display:grid;gap:4px}.prx-insightCard span{color:#58d3f3;font-size:8px;font-weight:1000;letter-spacing:.14em}.prx-insightCard strong{color:#fff;font-size:15px}.prx-insightCard p{margin:0;color:#bfd0d6;font-size:11px;line-height:1.55}
        .prx-panel--nutrition{border-top:2px solid rgba(240,173,72,.72)!important}.prx-panel--nutrition .prx-sectionHead span{color:#f0ad48!important}
        .prx-panel--training{border-top:2px solid rgba(75,211,246,.72)!important}.prx-panel--training .prx-sectionHead span{color:#4bd3f6!important}
        .prx-historyPanel{border-top:2px solid rgba(160,178,188,.42)!important}.prx-historyPanel .prx-sectionHead span{color:#a9bac1!important}
        .prx-checkInGrid{padding:12px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;background:linear-gradient(180deg,rgba(240,173,72,.025),transparent)}
        .prx-checkInGrid label{display:grid;gap:5px;min-width:0}.prx-checkInGrid label>span{color:#a5967e;font-size:7px;font-weight:1000;letter-spacing:.08em}.prx-checkInGrid label>div{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;border:1px solid rgba(211,179,122,.15);border-radius:8px;background:#090f12;overflow:hidden}.prx-checkInGrid input{width:100%;min-width:0;height:38px;padding:0 9px;border:1px solid rgba(211,179,122,.15);border-radius:8px;background:#090f12;color:#fff;font-size:11px;font-weight:850;outline:none}.prx-checkInGrid label>div input{border:0;border-radius:0;background:transparent}.prx-checkInGrid label>div b{padding:0 9px;color:#8b7b62;font-size:7px}.prx-checkInGrid button{grid-column:4;min-height:38px;border:1px solid rgba(244,181,81,.42);border-radius:8px;background:linear-gradient(180deg,#e8a53f,#a96212);color:#171006;font-size:9px;font-weight:1000}.prx-checkInGrid button:disabled{opacity:.42}
        .prx-bodyNutritionGrid{padding:0 12px 12px;display:grid;grid-template-columns:1fr 1fr;gap:8px}.prx-bodyNutritionGrid>article{min-width:0;padding:13px;border:1px solid rgba(150,174,184,.12);border-radius:10px;background:#080f13}.prx-bodyNutritionGrid>article.is-weight{box-shadow:inset 3px 0 #48d58d}.prx-bodyNutritionGrid>article.is-nutrition{box-shadow:inset 3px 0 #f0ad48}.prx-bodyNutritionGrid header{display:grid;gap:4px}.prx-bodyNutritionGrid header span{color:#8ea4ad;font-size:7px;font-weight:1000;letter-spacing:.1em}.prx-bodyNutritionGrid header strong{color:#fff;font-size:18px}.prx-miniMetrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin-top:10px;border-top:1px solid rgba(150,174,184,.08);border-bottom:1px solid rgba(150,174,184,.08)}.prx-miniMetrics>div{padding:8px 5px;min-width:0}.prx-miniMetrics>div+div{border-left:1px solid rgba(150,174,184,.08)}.prx-miniMetrics span{display:block;color:#718892;font-size:6px;font-weight:900}.prx-miniMetrics b{display:block;margin-top:4px;color:#f1f7f9;font-size:10px;white-space:normal;overflow-wrap:anywhere}.prx-bodyNutritionGrid p{margin:9px 0 0;color:#8da2aa;font-size:9px;line-height:1.45}.prx-weightPoints{display:flex;gap:5px;overflow-x:auto;padding-top:9px}.prx-weightPoints span{flex:0 0 auto;display:grid;gap:2px;padding:6px 8px;border-radius:7px;background:#0d1816;border:1px solid rgba(72,213,141,.12)}.prx-weightPoints b{color:#a4ecc6;font-size:9px}.prx-weightPoints small{color:#668277;font-size:6px}
        .prx-trainingSummary{padding:12px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}.prx-trainingSummary article{padding:11px;border:1px solid rgba(150,174,184,.11);border-radius:9px;background:#080f13;box-shadow:inset 3px 0 #6e8791}.prx-trainingSummary article.is-strength{box-shadow:inset 3px 0 #4bd3f6}.prx-trainingSummary article.is-hold{box-shadow:inset 3px 0 #7ca2ff}.prx-trainingSummary article.is-pain{box-shadow:inset 3px 0 #f26872}.prx-trainingSummary article.is-recovery{box-shadow:inset 3px 0 #a879f4}.prx-trainingSummary span{display:block;color:#8298a1;font-size:7px;font-weight:1000}.prx-trainingSummary strong{display:block;margin-top:5px;color:#fff;font-size:19px}.prx-trainingSummary small{display:block;margin-top:2px;color:#6f858e;font-size:7px}
        .prx-muscleSetGrid{padding:0 12px 12px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}.prx-muscleSetGrid article{position:relative;overflow:hidden;padding:11px 10px 13px;border:1px solid rgba(85,190,221,.12);border-radius:9px;background:#071116}.prx-muscleSetGrid span{display:block;color:#8faab4;font-size:7px;font-weight:1000;text-transform:uppercase}.prx-muscleSetGrid strong{display:inline-block;margin-top:5px;color:#fff;font-size:19px}.prx-muscleSetGrid small{margin-left:5px;color:#69838d;font-size:7px}.prx-muscleSetGrid i{position:absolute;left:0;bottom:0;height:3px;background:linear-gradient(90deg,#38c9ed,#64e3bd);border-radius:0 999px 999px 0}
        .prx-trendGrid article{background:linear-gradient(180deg,#0a1419,#070d10)!important}.prx-trendGrid article:nth-child(4n+1){box-shadow:inset 2px 0 #4bd3f6}.prx-trendGrid article:nth-child(4n+2){box-shadow:inset 2px 0 #48d58d}.prx-trendGrid article:nth-child(4n+3){box-shadow:inset 2px 0 #a879f4}.prx-trendGrid article:nth-child(4n+4){box-shadow:inset 2px 0 #f0ad48}
        .prx-historyRow{background:#080f13!important;border-color:rgba(155,178,188,.11)!important}.prx-historyMain>p{color:#b5c7cd!important}
        @media(max-width:900px){.prx-kpis--performance{grid-template-columns:repeat(2,minmax(0,1fr))!important}.prx-checkInGrid{grid-template-columns:repeat(2,minmax(0,1fr))}.prx-checkInGrid button{grid-column:1/-1}.prx-muscleSetGrid{grid-template-columns:repeat(2,minmax(0,1fr))}.prx-insightCard{grid-template-columns:1fr}}
        @media(max-width:650px){
          .prx-page{width:calc(100% - 8px)!important;overflow-x:hidden!important}
          .prx-hero,.prx-programDeck,.prx-panel,.prx-insightCard{border-radius:13px!important}
          .prx-kpis--performance{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:6px!important}.prx-kpis--performance article{min-height:91px!important;padding:11px 9px!important}.prx-kpis--performance article>div>strong{font-size:20px!important}.prx-kpis--performance article>div>small{font-size:9px!important;white-space:normal!important}
          .prx-insightCard{padding:13px;gap:7px}.prx-insightCard strong{font-size:14px}.prx-insightCard p{font-size:11px;line-height:1.48}
          .prx-checkInGrid{grid-template-columns:1fr 1fr!important;padding:9px;gap:6px}.prx-checkInGrid label>span{font-size:7.5px!important}.prx-checkInGrid input{height:42px!important;font-size:12px!important}.prx-checkInGrid button{grid-column:1/-1!important;min-height:44px!important;font-size:10px!important}
          .prx-bodyNutritionGrid{grid-template-columns:1fr!important;padding:0 9px 9px!important}.prx-bodyNutritionGrid>article{padding:11px!important}.prx-bodyNutritionGrid header strong{font-size:17px!important}.prx-miniMetrics span{font-size:7px!important}.prx-miniMetrics b{font-size:10px!important}.prx-weightPoints span{padding:6px 7px}.prx-weightPoints b{font-size:9px!important}.prx-weightPoints small{font-size:6.5px!important}
          .prx-trainingSummary{grid-template-columns:1fr 1fr!important;padding:9px!important}.prx-trainingSummary article{padding:10px!important}.prx-trainingSummary strong{font-size:18px!important}
          .prx-muscleSetGrid{grid-template-columns:1fr 1fr!important;padding:0 9px 9px!important;gap:6px!important}.prx-muscleSetGrid article{padding:10px 8px 12px!important}.prx-muscleSetGrid strong{font-size:17px!important}
          .prx-sectionHead{align-items:flex-start!important}.prx-sectionHead>small{white-space:normal!important;text-align:right!important;max-width:40%!important}
          .prx-historyMetrics{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:5px!important}.prx-historyMetrics span{min-width:0!important;white-space:normal!important}
        }
        @media(max-width:365px){.prx-kpis--performance{grid-template-columns:1fr!important}.prx-checkInGrid{grid-template-columns:1fr!important}.prx-muscleSetGrid{grid-template-columns:1fr!important}}

        /* FINAL PROGRESS READABILITY / NO-BUNCHING PASS */
        .prx-page,.prx-page *{min-width:0}
        .prx-page h1,.prx-page h2,.prx-page h3,.prx-page strong,.prx-page b,.prx-page span,.prx-page small,.prx-page p,.prx-page button,.prx-page label{overflow-wrap:anywhere;word-break:normal;text-overflow:clip}
        .prx-miniMetrics{grid-template-columns:repeat(4,minmax(0,1fr))!important}
        .prx-miniMetrics span,.prx-trainingSummary span,.prx-muscleSetGrid span{font-size:8.5px!important;line-height:1.2!important}.prx-miniMetrics b{font-size:11px!important;line-height:1.25!important}.prx-trainingSummary small,.prx-muscleSetGrid small{font-size:8.5px!important;line-height:1.25!important}
        .prx-bodyNutritionGrid p{font-size:10.5px!important}.prx-weightPoints b{font-size:10px!important}.prx-weightPoints small{font-size:8px!important}
        .prx-historyMain h3{white-space:normal!important;overflow:visible!important;text-overflow:clip!important;line-height:1.2!important}.prx-historyMain p{white-space:normal!important;line-height:1.3!important}
        @media(max-width:650px){
          .prx-kpis--performance article>div>span{font-size:9.5px!important}.prx-kpis--performance article>div>strong{font-size:21px!important;line-height:1.12!important}.prx-kpis--performance article>div>small{font-size:10px!important;line-height:1.35!important}
          .prx-miniMetrics{grid-template-columns:repeat(2,minmax(0,1fr))!important}.prx-miniMetrics>div:nth-child(3){border-left:0!important;border-top:1px solid rgba(150,174,184,.08)!important}.prx-miniMetrics>div:nth-child(4){border-top:1px solid rgba(150,174,184,.08)!important}
          .prx-miniMetrics span,.prx-trainingSummary span,.prx-muscleSetGrid span{font-size:9px!important}.prx-miniMetrics b{font-size:11.5px!important}.prx-trainingSummary small,.prx-muscleSetGrid small{font-size:9px!important}
          .prx-sectionHead h2{font-size:22px!important;line-height:1.12!important}.prx-sectionHead span{font-size:9px!important}.prx-sectionHead>small{font-size:9px!important;line-height:1.25!important}
          .prx-historyMain h3{font-size:17px!important}.prx-historyMain p{font-size:11px!important}.prx-historyMetrics span{font-size:9px!important}.prx-historyActions button{font-size:10px!important;min-height:40px!important;white-space:normal!important}
        }

        /* AUG 9 DESKTOP PROGRESS HEADER NO-WRAP */
        @media(min-width:651px){
          .prx-hero{display:grid!important;grid-template-columns:minmax(180px,240px) minmax(460px,1fr)!important;align-items:end!important;gap:24px!important}
          .prx-heroText{min-width:180px!important;align-self:end!important}
          .prx-hero h1{white-space:nowrap!important;word-break:normal!important;overflow-wrap:normal!important;hyphens:none!important}
          .prx-controls{justify-self:end!important;width:min(100%,520px)!important;grid-template-columns:minmax(280px,1fr) minmax(150px,180px)!important}
        }
      `}</style>
    </main>
  );
}
