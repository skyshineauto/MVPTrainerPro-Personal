// src/features/progress/ProgressPage.tsx
import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "../../lib/supabase";

import icoSchedule from "../../assets/progress-icons/schedule.png";
import icoChecked from "../../assets/progress-icons/checked.png";
import icoFlames from "../../assets/progress-icons/flames.png";
import icoInProcess from "../../assets/progress-icons/in-process.png";
import icoWorkout from "../../assets/progress-icons/workout.png";
import icoReport from "../../assets/progress-icons/report.png";
import icoTarget from "../../assets/progress-icons/target.png";
import icoProtein from "../../assets/progress-icons/protein-shake.png";

type Scope = "active" | "all";
type Range = 7 | 14 | 30 | 90 | "all";

type ProgramBlockRow = {
  id: string;
  goal: string | null;
  goal_mode: string | null;
  start_date: string | null;
  end_date: string | null;
  weeks: number | null;
  created_at: string | null;
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
};

type ExerciseDetail = {
  workoutExerciseId: string;
  exerciseId: string;
  name: string;
  orderIndex: number;
  prescription: any;
  pain: number | null;
  difficulty: string | null;
  sets: WorkoutSetRow[];
};

type HistoryRow = {
  id: string;
  completedAt: string;
  templateName: string;
  sessionSeconds: number;
  validDuration: boolean;
  bodyweightLb: number | null;
  proteinTargetG: number | null;
  painMax: number;
  painAvg: number;
  volumeTotal: number;
  setsLogged: number;
  postDifficulty: string | null;
  notes: string | null;
  exercises: ExerciseDetail[];
};

type ExerciseProgressPoint = {
  date: string;
  label: string;
  bestWeight: number;
  bestE1RM: number;
  volume: number;
};

type ExerciseProgress = {
  id: string;
  name: string;
  sessions: number;
  currentWeight: number;
  bestWeight: number;
  bestE1RM: number;
  currentE1RM: number;
  changePct: number | null;
  points: ExerciseProgressPoint[];
};

type ProgramPerformance = {
  name: string;
  sessions: number;
  avgDurationSeconds: number;
  volume: number;
  avgPain: number;
};

type TrendPoint = {
  label: string;
  value: number;
};

const ANALYTICS_MIN_SESSION_SECONDS = 5 * 60;
const ANALYTICS_MAX_SESSION_SECONDS = 4 * 60 * 60;
const HISTORY_BATCH = 5;

function daysAgoISO(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function rangeStartISO(range: Range) {
  return range === "all" ? null : daysAgoISO(range);
}

function rangeLabel(range: Range) {
  return range === "all" ? "ALL TIME" : `${range} DAY`;
}

function formatDateTime(ts: string | null | undefined) {
  if (!ts) return "—";
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "—";

  return `${date
    .toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
    .toUpperCase()} • ${date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function formatShortDate(ts: string | null | undefined) {
  if (!ts) return "—";
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "—";
  return date
    .toLocaleDateString(undefined, { month: "short", day: "numeric" })
    .toUpperCase();
}

function titleCase(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function goalLabel(goal: string | null | undefined) {
  const key = String(goal ?? "").toLowerCase();
  if (["build_muscle", "bulk", "muscle_gain"].includes(key)) return "Muscle Gain";
  if (["lose_weight", "cut"].includes(key)) return "Cut";
  if (key === "strength") return "Strength";
  if (key === "fitness") return "Fitness";
  return titleCase(goal) || "Training";
}

function proteinMultiplier(goal: string | null | undefined) {
  const key = String(goal ?? "").toLowerCase();
  if (key === "cut" || key === "lose_weight") return 1.0;
  return 0.9;
}

function roundProtein(value: number) {
  return Math.round(value / 5) * 5;
}

function estimatedOneRepMax(weight: number, reps: number) {
  if (!(weight > 0) || !(reps > 0)) return 0;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

function workoutDurationSeconds(workout: WorkoutRow) {
  const active = Number(workout.active_seconds ?? 0);
  if (active > 0) return Math.round(active);

  const started = workout.started_at ? new Date(workout.started_at).getTime() : NaN;
  const ended = workout.ended_at
    ? new Date(workout.ended_at).getTime()
    : workout.completed_at
      ? new Date(workout.completed_at).getTime()
      : NaN;

  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended <= started) return 0;
  return Math.max(0, Math.round((ended - started) / 1000));
}

function isAnalyticsDuration(seconds: number) {
  return (
    seconds >= ANALYTICS_MIN_SESSION_SECONDS &&
    seconds <= ANALYTICS_MAX_SESSION_SECONDS
  );
}

function formatDuration(seconds: number, includeSeconds = false) {
  const total = Math.max(0, Math.round(seconds));
  if (!total) return "—";

  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    if (includeSeconds && minutes === 0) return `${hours}H ${secs}S`;
    return minutes ? `${hours}H ${minutes}M` : `${hours}H`;
  }

  if (minutes > 0) {
    return includeSeconds && secs ? `${minutes}M ${secs}S` : `${minutes} MIN`;
  }

  return `${secs} SEC`;
}

function formatNumber(value: number, digits = 0) {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatWeight(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  const rounded = Math.abs(value - Math.round(value)) < 0.01
    ? String(Math.round(value))
    : value.toFixed(1);
  return `${rounded} LB`;
}

function formatVolume(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.round(value).toLocaleString()} LB`;
}

function difficultyLabel(value: string | null | undefined) {
  if (value === "too_easy") return "Too Easy";
  if (value === "just_right") return "On Target";
  if (value === "too_hard") return "Too Hard";
  return "Not Rated";
}

function validSet(set: WorkoutSetRow) {
  return Number(set.reps ?? 0) > 0 && Number(set.weight ?? 0) >= 0;
}

function calcSetVolume(set: WorkoutSetRow) {
  const reps = Number(set.reps ?? 0);
  const weight = Number(set.weight ?? 0);
  return reps > 0 && weight > 0 ? reps * weight : 0;
}

function SvgIcon({
  name,
  size = 18,
}: {
  name:
    | "calendar"
    | "clock"
    | "dumbbell"
    | "chart"
    | "target"
    | "trend"
    | "history"
    | "chevron"
    | "spark"
    | "layers";
  size?: number;
}) {
  const paths: Record<string, ReactNode> = {
    calendar: (
      <>
        <path d="M7 3v3M17 3v3M4.5 9h15M6.5 5h11a2 2 0 0 1 2 2v11.5a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
        <path d="M8 13h2M14 13h2M8 17h2M14 17h2" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5V12l3.2 2" />
      </>
    ),
    dumbbell: (
      <>
        <path d="M7 8v8M17 8v8M4.5 10v4M19.5 10v4M7 12h10" />
        <path d="M3 9.5h1.5v5H3zM19.5 9.5H21v5h-1.5z" />
      </>
    ),
    chart: <path d="M4 18V9M10 18V5M16 18v-7M22 18V3" />,
    target: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <circle cx="12" cy="12" r="4.5" />
        <circle cx="12" cy="12" r="1.3" />
      </>
    ),
    trend: <path d="m4 17 5-5 4 3 7-8M16 7h4v4" />,
    history: (
      <>
        <path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5" />
        <path d="M4 4v4.5h4.5M12 7.5V12l3 2" />
      </>
    ),
    chevron: <path d="m8 10 4 4 4-4" />,
    spark: <path d="m12 3 1.4 5.2L18 10l-4.6 1.8L12 17l-1.4-5.2L6 10l4.6-1.8L12 3Z" />,
    layers: (
      <>
        <path d="m12 4 8 4-8 4-8-4 8-4Z" />
        <path d="m4 12 8 4 8-4M4 16l8 4 8-4" />
      </>
    ),
  };

  return (
    <svg
      className="pr-svgIcon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden
    >
      {paths[name]}
    </svg>
  );
}

function AssetIcon({
  src,
  tone = "blue",
}: {
  src: string;
  tone?: "blue" | "green" | "orange" | "red";
}) {
  return (
    <span className={`pr-assetIcon tone-${tone}`} aria-hidden>
      <img src={src} alt="" />
    </span>
  );
}

function SectionHead({
  eyebrow,
  title,
  detail,
  right,
}: {
  eyebrow: string;
  title: string;
  detail?: string;
  right?: ReactNode;
}) {
  return (
    <div className="pr-sectionHead">
      <div className="pr-sectionTitleGroup">
        <span className="pr-sectionAccent" aria-hidden />
        <div>
          <div className="pr-eyebrow">{eyebrow}</div>
          <h2>{title}</h2>
          {detail ? <p>{detail}</p> : null}
        </div>
      </div>
      {right ? <div className="pr-sectionRight">{right}</div> : null}
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  detail,
  tone = "blue",
}: {
  icon: string;
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: "blue" | "green" | "orange" | "red";
}) {
  return (
    <div className={`pr-metric tone-${tone}`}>
      <div className="pr-metricTop">
        <AssetIcon src={icon} tone={tone} />
        <span>{label}</span>
      </div>
      <div className="pr-metricValue">{value}</div>
      {detail != null ? <div className="pr-metricDetail">{detail}</div> : null}
    </div>
  );
}

function Sparkline({
  points,
  tone = "blue",
  height = 118,
}: {
  points: TrendPoint[];
  tone?: "blue" | "orange" | "green";
  height?: number;
}) {
  if (!points.length) {
    return (
      <div className="pr-chartEmpty" style={{ height }}>
        Not enough logged data yet.
      </div>
    );
  }

  const width = 640;
  const padX = 18;
  const padY = 16;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(1, max - min);
  const denom = Math.max(1, points.length - 1);

  const coords = points.map((point, index) => {
    const x = padX + ((width - padX * 2) * index) / denom;
    const normalized = (point.value - min) / spread;
    const y = height - padY - normalized * (height - padY * 2);
    return { ...point, x, y };
  });

  const polyline = coords.map((point) => `${point.x},${point.y}`).join(" ");
  const area = [
    `${coords[0].x},${height - padY}`,
    ...coords.map((point) => `${point.x},${point.y}`),
    `${coords[coords.length - 1].x},${height - padY}`,
  ].join(" ");

  const color =
    tone === "orange" ? "#ff9f1c" : tone === "green" ? "#4de59a" : "#42c9f5";
  const gradientId = `pr-${tone}-${points.length}-${Math.round(max)}`;

  return (
    <div className="pr-sparkWrap">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="pr-spark"
        preserveAspectRatio="none"
        role="img"
        aria-label="Progress trend"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity=".24" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0.25, 0.5, 0.75].map((fraction) => (
          <line
            key={fraction}
            x1={padX}
            x2={width - padX}
            y1={padY + (height - padY * 2) * fraction}
            y2={padY + (height - padY * 2) * fraction}
            className="pr-chartGrid"
          />
        ))}

        <polygon points={area} fill={`url(#${gradientId})`} />
        <polyline
          points={polyline}
          fill="none"
          stroke={color}
          strokeWidth="3"
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {coords.map((point, index) => (
          <circle
            key={`${point.label}-${index}`}
            cx={point.x}
            cy={point.y}
            r="3.2"
            fill="#071017"
            stroke={color}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      <div className="pr-chartAxis">
        {points.slice(0, 6).map((point, index) => (
          <span key={`${point.label}-${index}`}>{point.label}</span>
        ))}
      </div>
    </div>
  );
}

export function ProgressPage() {
  const [scope, setScope] = useState<Scope>("active");
  const [range, setRange] = useState<Range>(14);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [activeBlock, setActiveBlock] = useState<ProgramBlockRow | null>(null);
  const [programTemplates, setProgramTemplates] = useState<string[]>([]);

  const [workouts, setWorkouts] = useState<WorkoutRow[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [exerciseProgress, setExerciseProgress] = useState<ExerciseProgress[]>([]);
  const [programPerformance, setProgramPerformance] = useState<ProgramPerformance[]>([]);
  const [weightSeries, setWeightSeries] = useState<TrendPoint[]>([]);

  const [historyVisible, setHistoryVisible] = useState(HISTORY_BATCH);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [selectedExerciseId, setSelectedExerciseId] = useState<string>("");

  const [clearOpen, setClearOpen] = useState(false);
  const [clearText, setClearText] = useState("");
  const [clearBusy, setClearBusy] = useState(false);

  async function loadAll() {
    setLoading(true);
    setErr(null);

    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!auth.user) {
        setErr("Sign in to view progress.");
        return;
      }

      const userId = auth.user.id;

      const { data: blockData, error: blockError } = await supabase
        .from("program_blocks")
        .select("id,goal,goal_mode,start_date,end_date,weeks,created_at")
        .eq("user_id", userId)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (blockError) throw blockError;
      const block = (blockData ?? null) as ProgramBlockRow | null;
      setActiveBlock(block);

      let activeSessionIds: string[] | null = null;
      let activeTemplateNames: string[] = [];

      if (block?.id) {
        const { data: scheduled, error: scheduledError } = await supabase
          .from("scheduled_sessions")
          .select("id,template_id,session_type,date,program_block_id")
          .eq("user_id", userId)
          .eq("program_block_id", block.id);

        if (scheduledError) throw scheduledError;

        activeSessionIds = (scheduled ?? [])
          .map((row: any) => String(row.id ?? ""))
          .filter(Boolean);

        const activeTemplateIds = Array.from(
          new Set(
            (scheduled ?? [])
              .map((row: any) => String(row.template_id ?? ""))
              .filter(Boolean)
          )
        );

        if (activeTemplateIds.length) {
          const { data: templateRows, error: templateError } = await supabase
            .from("workout_templates")
            .select("id,name")
            .in("id", activeTemplateIds);

          if (templateError) throw templateError;

          const map = new Map<string, string>();
          for (const row of templateRows ?? []) {
            map.set(String((row as any).id), String((row as any).name ?? "Workout"));
          }

          activeTemplateNames = Array.from(
            new Set(
              (scheduled ?? [])
                .map((row: any) => map.get(String(row.template_id ?? "")) ?? "")
                .filter(Boolean)
            )
          ).slice(0, 6);
        }
      }

      setProgramTemplates(activeTemplateNames);

      if (scope === "active" && block?.id && activeSessionIds?.length === 0) {
        setWorkouts([]);
        setHistory([]);
        setExerciseProgress([]);
        setProgramPerformance([]);
        setWeightSeries([]);
        return;
      }

      let workoutQuery = supabase
        .from("workouts")
        .select(
          "id,scheduled_session_id,started_at,ended_at,completed_at,bodyweight_lb,active_seconds,protein_target_g,workout_summary,post_difficulty,post_notes,session_rating,notes"
        )
        .eq("user_id", userId)
        .not("completed_at", "is", null)
        .order("completed_at", { ascending: false });

      const startISO = rangeStartISO(range);
      if (startISO) workoutQuery = workoutQuery.gte("completed_at", startISO);

      if (scope === "active" && activeSessionIds?.length) {
        workoutQuery = workoutQuery.in("scheduled_session_id", activeSessionIds);
      }

      const { data: workoutData, error: workoutError } = await workoutQuery;
      if (workoutError) throw workoutError;

      const workoutRows = (workoutData ?? []) as WorkoutRow[];
      setWorkouts(workoutRows);

      const workoutIds = workoutRows.map((row) => row.id);

      if (!workoutIds.length) {
        setHistory([]);
        setExerciseProgress([]);
        setProgramPerformance([]);
        setWeightSeries([]);
        return;
      }

      const scheduledIds = Array.from(
        new Set(
          workoutRows
            .map((row) => row.scheduled_session_id)
            .filter((value): value is string => Boolean(value))
        )
      );

      const sessionTemplateMap = new Map<string, string>();
      if (scheduledIds.length) {
        const { data: sessions, error: sessionsError } = await supabase
          .from("scheduled_sessions")
          .select("id,template_id,session_type")
          .in("id", scheduledIds);

        if (sessionsError) throw sessionsError;

        const templateIds = Array.from(
          new Set(
            (sessions ?? [])
              .map((row: any) => String(row.template_id ?? ""))
              .filter(Boolean)
          )
        );

        const templateNameMap = new Map<string, string>();
        if (templateIds.length) {
          const { data: templates, error: templatesError } = await supabase
            .from("workout_templates")
            .select("id,name")
            .in("id", templateIds);

          if (templatesError) throw templatesError;

          for (const row of templates ?? []) {
            templateNameMap.set(
              String((row as any).id),
              String((row as any).name ?? "Workout")
            );
          }
        }

        for (const row of sessions ?? []) {
          const sessionId = String((row as any).id ?? "");
          const templateId = String((row as any).template_id ?? "");
          const sessionType = String((row as any).session_type ?? "");
          const name =
            templateNameMap.get(templateId) ||
            titleCase(sessionType) ||
            "Workout";
          if (sessionId) sessionTemplateMap.set(sessionId, name);
        }
      }

      const { data: workoutExerciseData, error: workoutExerciseError } =
        await supabase
          .from("workout_exercises")
          .select(
            "id,workout_id,exercise_id,order_index,prescription_snapshot,pain,difficulty"
          )
          .in("workout_id", workoutIds)
          .order("order_index", { ascending: true });

      if (workoutExerciseError) throw workoutExerciseError;

      const workoutExerciseRows = (workoutExerciseData ?? []) as WorkoutExerciseRow[];
      const workoutExerciseIds = workoutExerciseRows.map((row) => row.id);
      const exerciseIds = Array.from(
        new Set(workoutExerciseRows.map((row) => row.exercise_id).filter(Boolean))
      );

      const exerciseNameMap = new Map<string, string>();
      if (exerciseIds.length) {
        const { data: exercises, error: exercisesError } = await supabase
          .from("exercises")
          .select("id,name")
          .in("id", exerciseIds);

        if (exercisesError) throw exercisesError;

        for (const exercise of (exercises ?? []) as ExerciseRow[]) {
          exerciseNameMap.set(exercise.id, exercise.name);
        }
      }

      const setsByWorkoutExercise = new Map<string, WorkoutSetRow[]>();
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
            rir: (raw as any).rir != null ? Number((raw as any).rir) : null,
            pain: (raw as any).pain != null ? Number((raw as any).pain) : null,
            form: (raw as any).form != null ? Number((raw as any).form) : null,
          };

          const list = setsByWorkoutExercise.get(row.workout_exercise_id) ?? [];
          list.push(row);
          setsByWorkoutExercise.set(row.workout_exercise_id, list);
        }
      }

      const exerciseDetailsByWorkout = new Map<string, ExerciseDetail[]>();
      for (const row of workoutExerciseRows) {
        const list = exerciseDetailsByWorkout.get(row.workout_id) ?? [];
        list.push({
          workoutExerciseId: row.id,
          exerciseId: row.exercise_id,
          name: exerciseNameMap.get(row.exercise_id) ?? "Exercise",
          orderIndex: Number(row.order_index ?? 0),
          prescription: row.prescription_snapshot ?? {},
          pain: row.pain != null ? Number(row.pain) : null,
          difficulty: row.difficulty,
          sets: (setsByWorkoutExercise.get(row.id) ?? []).sort(
            (left, right) => left.set_index - right.set_index
          ),
        });
        exerciseDetailsByWorkout.set(row.workout_id, list);
      }

      for (const [workoutId, details] of exerciseDetailsByWorkout.entries()) {
        exerciseDetailsByWorkout.set(
          workoutId,
          details.sort((left, right) => left.orderIndex - right.orderIndex)
        );
      }

      const historyRows: HistoryRow[] = workoutRows.map((workout) => {
        const exercises = exerciseDetailsByWorkout.get(workout.id) ?? [];
        const sessionSeconds = workoutDurationSeconds(workout);
        const painValues = exercises
          .map((exercise) => exercise.pain)
          .filter((value): value is number => value != null && Number.isFinite(value));

        const allSets = exercises.flatMap((exercise) =>
          exercise.sets.filter(validSet)
        );

        return {
          id: workout.id,
          completedAt: workout.completed_at,
          templateName:
            (workout.scheduled_session_id
              ? sessionTemplateMap.get(workout.scheduled_session_id)
              : null) ?? "Workout",
          sessionSeconds,
          validDuration: isAnalyticsDuration(sessionSeconds),
          bodyweightLb:
            workout.bodyweight_lb != null ? Number(workout.bodyweight_lb) : null,
          proteinTargetG:
            workout.protein_target_g != null
              ? Number(workout.protein_target_g)
              : null,
          painMax: painValues.length ? Math.max(...painValues) : 0,
          painAvg: painValues.length
            ? painValues.reduce((sum, value) => sum + value, 0) / painValues.length
            : 0,
          volumeTotal: allSets.reduce(
            (sum, set) => sum + calcSetVolume(set),
            0
          ),
          setsLogged: allSets.filter((set) => Number(set.reps ?? 0) > 0).length,
          postDifficulty: workout.post_difficulty,
          notes: workout.post_notes || workout.notes || null,
          exercises,
        };
      });

      setHistory(historyRows);

      const weightPoints = workoutRows
        .filter(
          (row) =>
            row.bodyweight_lb != null &&
            Number.isFinite(Number(row.bodyweight_lb))
        )
        .slice()
        .reverse()
        .map((row) => ({
          label: formatShortDate(row.completed_at),
          value: Number(row.bodyweight_lb),
        }));

      setWeightSeries(weightPoints);

      const completedTimeMap = new Map(
        workoutRows.map((row) => [
          row.id,
          new Date(row.completed_at).getTime(),
        ])
      );

      const workoutById = new Map(workoutRows.map((row) => [row.id, row]));
      const workoutExerciseById = new Map(
        workoutExerciseRows.map((row) => [row.id, row])
      );

      const progressMap = new Map<string, ExerciseProgressPoint[]>();

      for (const detailRows of exerciseDetailsByWorkout.values()) {
        for (const detail of detailRows) {
          const source = workoutExerciseById.get(detail.workoutExerciseId);
          const workout = source ? workoutById.get(source.workout_id) : null;
          if (!workout) continue;

          const sets = detail.sets.filter(
            (set) => Number(set.reps ?? 0) > 0 && Number(set.weight ?? 0) > 0
          );
          if (!sets.length) continue;

          const bestWeight = Math.max(...sets.map((set) => Number(set.weight)));
          const bestE1RM = Math.max(
            ...sets.map((set) =>
              estimatedOneRepMax(Number(set.weight), Number(set.reps))
            )
          );
          const volume = sets.reduce(
            (sum, set) => sum + calcSetVolume(set),
            0
          );

          const list = progressMap.get(detail.exerciseId) ?? [];
          list.push({
            date: workout.completed_at,
            label: formatShortDate(workout.completed_at),
            bestWeight,
            bestE1RM,
            volume,
          });
          progressMap.set(detail.exerciseId, list);
        }
      }

      const progressRows: ExerciseProgress[] = [];
      for (const [exerciseId, rawPoints] of progressMap.entries()) {
        const points = rawPoints.sort(
          (left, right) =>
            new Date(left.date).getTime() - new Date(right.date).getTime()
        );
        const first = points[0];
        const latest = points[points.length - 1];
        const bestWeight = Math.max(...points.map((point) => point.bestWeight));
        const bestE1RM = Math.max(...points.map((point) => point.bestE1RM));
        const changePct =
          first?.bestE1RM > 0
            ? ((latest.bestE1RM - first.bestE1RM) / first.bestE1RM) * 100
            : null;

        progressRows.push({
          id: exerciseId,
          name: exerciseNameMap.get(exerciseId) ?? "Exercise",
          sessions: points.length,
          currentWeight: latest?.bestWeight ?? 0,
          bestWeight,
          bestE1RM,
          currentE1RM: latest?.bestE1RM ?? 0,
          changePct,
          points,
        });
      }

      progressRows.sort((left, right) => {
        const leftChange = left.changePct ?? -999;
        const rightChange = right.changePct ?? -999;
        return rightChange - leftChange || right.sessions - left.sessions;
      });

      setExerciseProgress(progressRows);

      const perfMap = new Map<
        string,
        { sessions: number; validSeconds: number[]; volume: number; pains: number[] }
      >();

      for (const item of historyRows) {
        const current = perfMap.get(item.templateName) ?? {
          sessions: 0,
          validSeconds: [],
          volume: 0,
          pains: [],
        };
        current.sessions += 1;
        if (item.validDuration) current.validSeconds.push(item.sessionSeconds);
        current.volume += item.volumeTotal;
        current.pains.push(item.painAvg);
        perfMap.set(item.templateName, current);
      }

      const performanceRows: ProgramPerformance[] = Array.from(
        perfMap.entries()
      )
        .map(([name, value]) => ({
          name,
          sessions: value.sessions,
          avgDurationSeconds: value.validSeconds.length
            ? Math.round(
                value.validSeconds.reduce((sum, seconds) => sum + seconds, 0) /
                  value.validSeconds.length
              )
            : 0,
          volume: value.volume,
          avgPain: value.pains.length
            ? value.pains.reduce((sum, pain) => sum + pain, 0) / value.pains.length
            : 0,
        }))
        .sort((left, right) => right.sessions - left.sessions)
        .slice(0, 6);

      setProgramPerformance(performanceRows);

      if (!selectedExerciseId && progressRows.length) {
        setSelectedExerciseId(progressRows[0].id);
      } else if (
        selectedExerciseId &&
        !progressRows.some((row) => row.id === selectedExerciseId)
      ) {
        setSelectedExerciseId(progressRows[0]?.id ?? "");
      }

      // Quietly keep the app honest when old test timer records exist.
      const outlierCount = historyRows.filter(
        (row) => row.sessionSeconds > 0 && !row.validDuration
      ).length;
      if (outlierCount > 0) {
        setToast(
          `${outlierCount} test/outlier session${
            outlierCount === 1 ? "" : "s"
          } excluded from time averages.`
        );
      } else {
        setToast(null);
      }

      // Preserve a stable sort for anything derived from completion time.
      void completedTimeMap;
    } catch (error: any) {
      setErr(error?.message ?? String(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setHistoryVisible(HISTORY_BATCH);
    setExpandedHistoryId(null);
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, range]);

  const analytics = useMemo(() => {
    const validDurations = history
      .filter((row) => row.validDuration)
      .map((row) => row.sessionSeconds);

    const totalTime = validDurations.reduce((sum, seconds) => sum + seconds, 0);
    const avgDuration = validDurations.length
      ? Math.round(totalTime / validDurations.length)
      : 0;

    const allSets = history.flatMap((row) =>
      row.exercises.flatMap((exercise) =>
        exercise.sets.filter((set) => Number(set.reps ?? 0) > 0)
      )
    );

    const strengthSets = allSets.filter(
      (set) => Number(set.reps ?? 0) > 0 && Number(set.weight ?? 0) > 0
    );

    const totalVolume = strengthSets.reduce(
      (sum, set) => sum + calcSetVolume(set),
      0
    );

    const heaviestSet = strengthSets.length
      ? Math.max(...strengthSets.map((set) => Number(set.weight)))
      : 0;

    const bestE1RM = strengthSets.length
      ? Math.max(
          ...strengthSets.map((set) =>
            estimatedOneRepMax(Number(set.weight), Number(set.reps))
          )
        )
      : 0;

    const uniqueExercises = new Set(
      history.flatMap((row) => row.exercises.map((exercise) => exercise.exerciseId))
    ).size;

    const painValues = history.flatMap((row) =>
      row.exercises
        .map((exercise) => exercise.pain)
        .filter((value): value is number => value != null && Number.isFinite(value))
    );

    const avgPain = painValues.length
      ? painValues.reduce((sum, pain) => sum + pain, 0) / painValues.length
      : 0;
    const maxPain = painValues.length ? Math.max(...painValues) : 0;
    const painFlags = painValues.filter((pain) => pain >= 3).length;

    const rirValues = allSets
      .map((set) => set.rir)
      .filter((value): value is number => value != null && Number.isFinite(value));

    const avgRir = rirValues.length
      ? rirValues.reduce((sum, value) => sum + value, 0) / rirValues.length
      : null;

    let targetSets = 0;
    let targetHits = 0;

    for (const workout of history) {
      for (const exercise of workout.exercises) {
        const min = Number(exercise.prescription?.rep_min ?? 0);
        const max = Number(exercise.prescription?.rep_max ?? min);
        if (!(min > 0) || !(max >= min)) continue;

        for (const set of exercise.sets) {
          const reps = Number(set.reps ?? 0);
          if (!(reps > 0)) continue;
          targetSets += 1;
          if (reps >= min && reps <= max) targetHits += 1;
        }
      }
    }

    const repTargetSuccess = targetSets
      ? Math.round((targetHits / targetSets) * 100)
      : null;

    const tooEasy = workouts.filter(
      (workout) => workout.post_difficulty === "too_easy"
    ).length;
    const tooHard = workouts.filter(
      (workout) => workout.post_difficulty === "too_hard"
    ).length;
    const onTarget = workouts.filter(
      (workout) => workout.post_difficulty === "just_right"
    ).length;

    const dates = Array.from(
      new Set(
        workouts
          .map((workout) => dateOnly(new Date(workout.completed_at)))
          .filter(Boolean)
      )
    )
      .map((value) => new Date(`${value}T12:00:00`).getTime())
      .sort((left, right) => right - left);

    let streak = 0;
    if (dates.length) {
      streak = 1;
      for (let index = 1; index < dates.length; index += 1) {
        const differenceDays = Math.round(
          (dates[index - 1] - dates[index]) / 86400000
        );
        if (differenceDays === 1) streak += 1;
        else break;
      }
    }

    const completedTimes = workouts
      .map((workout) => new Date(workout.completed_at).getTime())
      .filter(Number.isFinite);

    const spanDays =
      range === "all"
        ? completedTimes.length >= 2
          ? Math.max(
              7,
              Math.ceil(
                (Math.max(...completedTimes) - Math.min(...completedTimes)) /
                  86400000
              ) + 1
            )
          : 7
        : range;

    const workoutsPerWeek = workouts.length / Math.max(1, spanDays / 7);

    const improvedExercises = exerciseProgress.filter(
      (exercise) => (exercise.changePct ?? 0) > 1
    ).length;

    const latestWeight = weightSeries.length
      ? weightSeries[weightSeries.length - 1].value
      : null;
    const firstWeight = weightSeries.length ? weightSeries[0].value : null;
    const weightChange =
      latestWeight != null && firstWeight != null ? latestWeight - firstWeight : null;

    const proteinTarget =
      latestWeight != null
        ? roundProtein(latestWeight * proteinMultiplier(activeBlock?.goal))
        : null;

    return {
      sessions: workouts.length,
      totalTime,
      avgDuration,
      setsLogged: allSets.length,
      totalVolume,
      heaviestSet,
      bestE1RM,
      uniqueExercises,
      avgPain,
      maxPain,
      painFlags,
      avgRir,
      repTargetSuccess,
      tooEasy,
      tooHard,
      onTarget,
      streak,
      workoutsPerWeek,
      improvedExercises,
      latestWeight,
      weightChange,
      proteinTarget,
    };
  }, [history, workouts, range, exerciseProgress, weightSeries, activeBlock]);

  const selectedExercise = useMemo(
    () =>
      exerciseProgress.find((row) => row.id === selectedExerciseId) ??
      exerciseProgress[0] ??
      null,
    [exerciseProgress, selectedExerciseId]
  );

  const selectedExerciseChart = useMemo<TrendPoint[]>(
    () =>
      (selectedExercise?.points ?? []).map((point) => ({
        label: point.label,
        value: point.bestE1RM,
      })),
    [selectedExercise]
  );

  const volumeTrend = useMemo<TrendPoint[]>(
    () =>
      history
        .slice()
        .reverse()
        .map((row) => ({
          label: formatShortDate(row.completedAt),
          value: row.volumeTotal,
        }))
        .filter((point) => point.value > 0),
    [history]
  );

  const topProgressExercise = exerciseProgress[0] ?? null;

  async function clearLogs() {
    setClearBusy(true);
    setErr(null);

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
      if (active?.id) throw new Error("End the active workout first.");

      const { error } = await supabase.rpc("rpc_clear_logs_all_time");
      if (error) throw error;

      setClearOpen(false);
      setClearText("");
      setToast("Training logs cleared.");
      await loadAll();
    } catch (error: any) {
      setErr(error?.message ?? String(error));
    } finally {
      setClearBusy(false);
    }
  }

  const programTitle =
    scope === "all"
      ? "All Programs"
      : `Foundation • ${goalLabel(activeBlock?.goal)}`;

  const visibleHistory = history.slice(0, historyVisible);

  return (
    <div className="pr-page">
      <section className="pr-heroPanel">
        <div className="pr-heroTop">
          <div>
            <div className="pr-pageEyebrow">PROGRESS</div>
            <h1>Performance Intelligence</h1>
            <p>
              Strength, training quality, recovery and body trends from your
              actual logged sessions.
            </p>
          </div>

          <div className="pr-controls">
            <label>
              <span>PROGRAM</span>
              <div className="pr-selectShell">
                <select
                  value={scope}
                  onChange={(event) => setScope(event.target.value as Scope)}
                >
                  <option value="active">Current Program</option>
                  <option value="all">All Programs</option>
                </select>
                <SvgIcon name="chevron" size={16} />
              </div>
            </label>

            <label>
              <span>RANGE</span>
              <div className="pr-selectShell">
                <select
                  value={String(range)}
                  onChange={(event) =>
                    setRange(
                      event.target.value === "all"
                        ? "all"
                        : (Number(event.target.value) as Range)
                    )
                  }
                >
                  <option value="7">7 Days</option>
                  <option value="14">14 Days</option>
                  <option value="30">30 Days</option>
                  <option value="90">90 Days</option>
                  <option value="all">All Time</option>
                </select>
                <SvgIcon name="chevron" size={16} />
              </div>
            </label>
          </div>
        </div>

        <div className="pr-programDeck">
          <div className="pr-programIdentity">
            <div className="pr-programGlyph">
              <SvgIcon name="layers" size={24} />
            </div>
            <div>
              <span>{scope === "active" ? "ACTIVE PROGRAM" : "ANALYSIS SCOPE"}</span>
              <strong>{programTitle}</strong>
              <small>
                {scope === "active"
                  ? `${programTemplates.length || 4} workout rotation`
                  : "Combined training history"}
              </small>
            </div>
          </div>

          {scope === "active" && programTemplates.length ? (
            <div className="pr-rotationRail">
              {programTemplates.slice(0, 4).map((name) => (
                <span key={name}>{name}</span>
              ))}
            </div>
          ) : null}

          <div className="pr-analysisWindow">
            <span>ANALYSIS WINDOW</span>
            <strong>{rangeLabel(range)}</strong>
            <small>{analytics.sessions} completed sessions</small>
          </div>
        </div>
      </section>

      {toast ? <div className="pr-toast">{toast}</div> : null}
      {err ? <div className="pr-error">{err}</div> : null}

      <section className="pr-panel">
        <SectionHead
          eyebrow="TRAINING"
          title="Training Overview"
          detail="The core workload and consistency signals for this analysis window."
        />

        <div className="pr-primaryMetrics">
          <Metric
            icon={icoChecked}
            label="SESSIONS"
            value={loading ? "—" : analytics.sessions}
            detail="completed"
          />
          <Metric
            icon={icoInProcess}
            label="TRAINING TIME"
            value={loading ? "—" : formatDuration(analytics.totalTime)}
            detail="valid active time"
            tone="blue"
          />
          <Metric
            icon={icoSchedule}
            label="AVG SESSION"
            value={loading ? "—" : formatDuration(analytics.avgDuration)}
            detail="valid sessions only"
          />
          <Metric
            icon={icoFlames}
            label="SESSIONS / WEEK"
            value={
              loading ? "—" : analytics.workoutsPerWeek.toFixed(1)
            }
            detail={`${analytics.streak} day training streak`}
            tone={analytics.streak >= 3 ? "green" : "blue"}
          />
        </div>

        <div className="pr-secondaryStrip">
          <div>
            <span>SETS LOGGED</span>
            <strong>{loading ? "—" : analytics.setsLogged.toLocaleString()}</strong>
          </div>
          <div>
            <span>EXERCISES TRAINED</span>
            <strong>{loading ? "—" : analytics.uniqueExercises}</strong>
          </div>
          <div>
            <span>EXERCISES IMPROVED</span>
            <strong>{loading ? "—" : analytics.improvedExercises}</strong>
          </div>
          <div>
            <span>TOP PROGRESS</span>
            <strong>{topProgressExercise?.name ?? "—"}</strong>
          </div>
        </div>
      </section>

      <section className="pr-panel">
        <SectionHead
          eyebrow="PERFORMANCE"
          title="Strength & Workload"
          detail="Real volume and strength output, not decorative totals."
        />

        <div className="pr-twoColumn">
          <div className="pr-chartPanel">
            <div className="pr-chartHead">
              <div>
                <span>TRAINING VOLUME</span>
                <strong>{formatVolume(analytics.totalVolume)}</strong>
              </div>
              <div className="pr-chartBadge">
                <SvgIcon name="trend" size={16} />
                {rangeLabel(range)}
              </div>
            </div>
            <Sparkline points={volumeTrend} />
          </div>

          <div className="pr-performanceRail">
            <Metric
              icon={icoWorkout}
              label="HEAVIEST SET"
              value={formatWeight(analytics.heaviestSet)}
              detail="highest load logged"
              tone="blue"
            />
            <Metric
              icon={icoTarget}
              label="BEST EST. 1RM"
              value={formatWeight(analytics.bestE1RM)}
              detail="Epley estimate"
              tone="green"
            />
            <Metric
              icon={icoReport}
              label="TOTAL VOLUME"
              value={formatVolume(analytics.totalVolume)}
              detail="reps × weight"
              tone="orange"
            />
          </div>
        </div>
      </section>

      <section className="pr-panel">
        <SectionHead
          eyebrow="TRAINING QUALITY"
          title="Execution Quality"
          detail="How closely your logged sets and effort match the programmed stimulus."
        />

        <div className="pr-qualityGrid">
          <div className="pr-qualityMetric">
            <span>REP TARGET SUCCESS</span>
            <strong>
              {analytics.repTargetSuccess == null
                ? "—"
                : `${analytics.repTargetSuccess}%`}
            </strong>
            <small>sets inside programmed rep range</small>
            <div className="pr-meter">
              <span
                style={{
                  width: `${Math.max(
                    0,
                    Math.min(100, analytics.repTargetSuccess ?? 0)
                  )}%`,
                }}
              />
            </div>
          </div>

          <div className="pr-qualityMetric">
            <span>AVERAGE EFFORT</span>
            <strong>
              {analytics.avgRir == null
                ? "—"
                : `${analytics.avgRir.toFixed(1)} RIR`}
            </strong>
            <small>average logged reps in reserve</small>
          </div>

          <div className="pr-qualityMetric">
            <span>SESSION FEEDBACK</span>
            <strong>{analytics.onTarget} ON TARGET</strong>
            <small>
              {analytics.tooEasy} too easy • {analytics.tooHard} too hard
            </small>
          </div>

          <div className="pr-qualityMetric">
            <span>PROGRESSION</span>
            <strong>{analytics.improvedExercises}</strong>
            <small>exercises improved in this range</small>
          </div>
        </div>
      </section>

      <section className="pr-panel">
        <SectionHead
          eyebrow="BODY & RECOVERY"
          title="Recovery Support"
          detail="Body weight, protein target and pain signals in one compact view."
        />

        <div className="pr-bodyGrid">
          <div className="pr-chartPanel pr-bodyChart">
            <div className="pr-chartHead">
              <div>
                <span>BODY WEIGHT</span>
                <strong>
                  {analytics.latestWeight == null
                    ? "—"
                    : `${analytics.latestWeight.toFixed(1)} LB`}
                </strong>
              </div>
              <div
                className={`pr-delta ${
                  (analytics.weightChange ?? 0) >= 0 ? "is-up" : "is-down"
                }`}
              >
                {analytics.weightChange == null
                  ? "NO RANGE CHANGE"
                  : `${analytics.weightChange >= 0 ? "+" : ""}${analytics.weightChange.toFixed(
                      1
                    )} LB`}
              </div>
            </div>
            <Sparkline points={weightSeries} tone="green" />
          </div>

          <div className="pr-recoveryPanel">
            <div className="pr-recoveryMetric">
              <AssetIcon src={icoProtein} tone="blue" />
              <div>
                <span>PROTEIN TARGET</span>
                <strong>
                  {analytics.proteinTarget != null
                    ? `${analytics.proteinTarget} G`
                    : "—"}
                </strong>
                <small>based on latest logged weight + goal</small>
              </div>
            </div>

            <div className="pr-recoveryDivider" />

            <div className="pr-recoveryNumbers">
              <div>
                <span>AVG PAIN</span>
                <strong>{analytics.avgPain.toFixed(1)}</strong>
              </div>
              <div>
                <span>PEAK PAIN</span>
                <strong>{analytics.maxPain}</strong>
              </div>
              <div>
                <span>PAIN FLAGS</span>
                <strong>{analytics.painFlags}</strong>
              </div>
            </div>

            <div
              className={`pr-recoveryState ${
                analytics.maxPain >= 4 ? "is-watch" : "is-clear"
              }`}
            >
              <span aria-hidden />
              {analytics.maxPain >= 4
                ? "RECOVERY NEEDS ATTENTION"
                : "RECOVERY SIGNALS CLEAR"}
            </div>
          </div>
        </div>
      </section>

      <section className="pr-panel">
        <SectionHead
          eyebrow="EXERCISE PROGRESS"
          title="Movement-Level Progression"
          detail="Select an exercise to see real strength progression across logged sessions."
          right={
            <label className="pr-exerciseSelect">
              <span>EXERCISE</span>
              <div className="pr-selectShell">
                <select
                  value={selectedExercise?.id ?? ""}
                  onChange={(event) => setSelectedExerciseId(event.target.value)}
                >
                  {exerciseProgress.map((exercise) => (
                    <option key={exercise.id} value={exercise.id}>
                      {exercise.name}
                    </option>
                  ))}
                </select>
                <SvgIcon name="chevron" size={16} />
              </div>
            </label>
          }
        />

        {selectedExercise ? (
          <div className="pr-exerciseDeck">
            <div className="pr-exerciseStats">
              <div>
                <span>CURRENT LOAD</span>
                <strong>{formatWeight(selectedExercise.currentWeight)}</strong>
              </div>
              <div>
                <span>BEST LOAD</span>
                <strong>{formatWeight(selectedExercise.bestWeight)}</strong>
              </div>
              <div>
                <span>EST. 1RM</span>
                <strong>{formatWeight(selectedExercise.currentE1RM)}</strong>
              </div>
              <div>
                <span>CHANGE</span>
                <strong
                  className={
                    (selectedExercise.changePct ?? 0) > 0 ? "is-positive" : ""
                  }
                >
                  {selectedExercise.changePct == null
                    ? "—"
                    : `${selectedExercise.changePct >= 0 ? "+" : ""}${selectedExercise.changePct.toFixed(
                        1
                      )}%`}
                </strong>
              </div>
            </div>

            <div className="pr-exerciseChart">
              <div className="pr-exerciseChartHead">
                <div>
                  <span>ESTIMATED STRENGTH TREND</span>
                  <strong>{selectedExercise.name}</strong>
                </div>
                <div>{selectedExercise.sessions} logged sessions</div>
              </div>
              <Sparkline points={selectedExerciseChart} />
            </div>
          </div>
        ) : (
          <div className="pr-empty">Log strength sets to build exercise progression.</div>
        )}
      </section>

      <section className="pr-panel">
        <SectionHead
          eyebrow="PROGRAM PERFORMANCE"
          title="Workout Rotation"
          detail="A compact comparison of the workouts inside the selected program scope."
        />

        <div className="pr-programGrid">
          {programPerformance.length ? (
            programPerformance.map((row) => (
              <article key={row.name} className="pr-programCard">
                <div>
                  <span>WORKOUT</span>
                  <h3>{row.name}</h3>
                </div>
                <div className="pr-programCardMetrics">
                  <div>
                    <span>SESSIONS</span>
                    <strong>{row.sessions}</strong>
                  </div>
                  <div>
                    <span>AVG TIME</span>
                    <strong>{formatDuration(row.avgDurationSeconds)}</strong>
                  </div>
                  <div>
                    <span>VOLUME</span>
                    <strong>{formatNumber(row.volume)}</strong>
                  </div>
                  <div>
                    <span>AVG PAIN</span>
                    <strong>{row.avgPain.toFixed(1)}</strong>
                  </div>
                </div>
              </article>
            ))
          ) : (
            <div className="pr-empty">No completed sessions in this range.</div>
          )}
        </div>
      </section>

      <section className="pr-panel pr-historyPanel">
        <SectionHead
          eyebrow="HISTORY"
          title="Recent Sessions"
          detail={`Showing ${Math.min(historyVisible, history.length)} of ${
            history.length
          } sessions`}
          right={
            <button
              type="button"
              className="pr-dangerButton"
              onClick={() => setClearOpen(true)}
            >
              CLEAR TEST LOGS
            </button>
          }
        />

        <div className="pr-historyList">
          {visibleHistory.length ? (
            visibleHistory.map((row) => {
              const expanded = expandedHistoryId === row.id;
              const exerciseNames = row.exercises.map((exercise) => exercise.name);

              return (
                <article
                  key={row.id}
                  className={`pr-historyRow ${expanded ? "is-expanded" : ""}`}
                >
                  <div className="pr-historyTop">
                    <div>
                      <span>COMPLETED WORKOUT</span>
                      <h3>{row.templateName}</h3>
                    </div>
                    <time>{formatDateTime(row.completedAt)}</time>
                  </div>

                  <div className="pr-historyMetrics">
                    <div>
                      <span>TIME</span>
                      <strong>{formatDuration(row.sessionSeconds, true)}</strong>
                      {!row.validDuration && row.sessionSeconds > 0 ? (
                        <small>TEST / OUTLIER</small>
                      ) : null}
                    </div>
                    <div>
                      <span>EXERCISES</span>
                      <strong>{row.exercises.length}</strong>
                    </div>
                    <div>
                      <span>SETS</span>
                      <strong>{row.setsLogged}</strong>
                    </div>
                    <div>
                      <span>VOLUME</span>
                      <strong>{formatVolume(row.volumeTotal)}</strong>
                    </div>
                    <div>
                      <span>PAIN</span>
                      <strong>{row.painMax}</strong>
                    </div>
                  </div>

                  <div className="pr-historyExerciseLine">
                    <span>EXERCISES</span>
                    <p>
                      {exerciseNames.slice(0, 7).join(" • ") || "No exercise names recorded"}
                      {exerciseNames.length > 7
                        ? ` • +${exerciseNames.length - 7} more`
                        : ""}
                    </p>
                  </div>

                  <button
                    type="button"
                    className="pr-historyToggle"
                    onClick={() =>
                      setExpandedHistoryId(expanded ? null : row.id)
                    }
                  >
                    <span>{expanded ? "HIDE SESSION" : "VIEW SESSION"}</span>
                    <SvgIcon name="chevron" size={16} />
                  </button>

                  {expanded ? (
                    <div className="pr-historyDetails">
                      <div className="pr-historyDetailSummary">
                        <div>
                          <span>BODY WEIGHT</span>
                          <strong>{formatWeight(row.bodyweightLb)}</strong>
                        </div>
                        <div>
                          <span>PROTEIN TARGET</span>
                          <strong>
                            {row.proteinTargetG != null
                              ? `${Math.round(row.proteinTargetG)} G`
                              : "—"}
                          </strong>
                        </div>
                        <div>
                          <span>AVG PAIN</span>
                          <strong>{row.painAvg.toFixed(1)}</strong>
                        </div>
                        <div>
                          <span>SESSION FEEL</span>
                          <strong>{difficultyLabel(row.postDifficulty)}</strong>
                        </div>
                      </div>

                      <div className="pr-historyExerciseDetails">
                        {row.exercises.map((exercise) => (
                          <div
                            className="pr-historyExercise"
                            key={exercise.workoutExerciseId}
                          >
                            <div className="pr-historyExerciseHead">
                              <strong>{exercise.name}</strong>
                              <span>
                                {exercise.pain != null
                                  ? `Pain ${exercise.pain}`
                                  : "Pain not logged"}
                              </span>
                            </div>

                            {exercise.sets.length ? (
                              <div className="pr-setRail">
                                {exercise.sets.map((set) => (
                                  <span key={set.set_index}>
                                    <b>SET {set.set_index}</b>
                                    {Number(set.weight || 0) > 0
                                      ? `${formatNumber(Number(set.weight))} LB × ${set.reps}`
                                      : `${set.reps} REPS`}
                                    {set.rir != null ? ` • ${set.rir} RIR` : ""}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <div className="pr-historyNoSets">
                                No strength sets recorded.
                              </div>
                            )}
                          </div>
                        ))}
                      </div>

                      {row.notes ? (
                        <div className="pr-historyNotes">
                          <span>NOTES</span>
                          <p>{row.notes}</p>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })
          ) : (
            <div className="pr-empty">No completed sessions in this range.</div>
          )}
        </div>

        {historyVisible < history.length ? (
          <div className="pr-historyLoadMore">
            <span>
              Showing {Math.min(historyVisible, history.length)} of {history.length}
            </span>
            <button
              type="button"
              onClick={() =>
                setHistoryVisible((value) =>
                  Math.min(history.length, value + HISTORY_BATCH)
                )
              }
            >
              LOAD 5 MORE
            </button>
          </div>
        ) : null}
      </section>

      {clearOpen ? (
        <div className="pr-modalOverlay" role="presentation">
          <section
            className="pr-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pr-clear-title"
          >
            <div className="pr-modalKicker">TEST DATA CONTROL</div>
            <h2 id="pr-clear-title">Clear all training logs?</h2>
            <p>
              This permanently deletes completed workout history. Type CLEAR to
              confirm.
            </p>

            <input
              value={clearText}
              onChange={(event) => setClearText(event.target.value)}
              placeholder="Type CLEAR"
              autoFocus
            />

            <div className="pr-modalActions">
              <button
                type="button"
                onClick={() => {
                  setClearOpen(false);
                  setClearText("");
                }}
              >
                CANCEL
              </button>
              <button
                type="button"
                className="is-danger"
                disabled={clearText.trim().toUpperCase() !== "CLEAR" || clearBusy}
                onClick={() => void clearLogs()}
              >
                {clearBusy ? "CLEARING…" : "CLEAR LOGS"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <style>{`
        .pr-page{
          --pr-bg:#05090d;
          --pr-panel:#0b131a;
          --pr-panel-hi:#101d26;
          --pr-line:rgba(145,207,230,.14);
          --pr-line-hi:rgba(198,235,248,.24);
          --pr-blue:#42c9f5;
          --pr-blue-deep:#0e789f;
          --pr-orange:#ff9f1c;
          --pr-green:#4de59a;
          --pr-red:#ff6b6b;
          display:grid;
          gap:14px;
          padding:0 0 34px;
          color:#f4f9fb;
        }

        .pr-page *{box-sizing:border-box}
        .pr-page button,.pr-page select,.pr-page input{font:inherit}

        .pr-heroPanel,
        .pr-panel{
          position:relative;
          isolation:isolate;
          overflow:hidden;
          border:1px solid var(--pr-line);
          border-top-color:var(--pr-line-hi);
          border-radius:18px;
          background:
            linear-gradient(180deg,#111e27 0%,#0b151c 54%,#070d12 100%);
          box-shadow:
            0 1px 0 rgba(255,255,255,.035),
            0 3px 5px rgba(0,0,0,.42),
            0 18px 42px rgba(0,0,0,.24),
            inset 0 1px 0 rgba(255,255,255,.04),
            inset 0 -1px 0 rgba(0,0,0,.62);
        }

        .pr-heroPanel::before,
        .pr-panel::before{
          content:"";
          position:absolute;
          z-index:0;
          left:22px;
          right:22px;
          top:0;
          height:1px;
          pointer-events:none;
          background:linear-gradient(
            90deg,
            transparent,
            rgba(219,245,253,.30) 15%,
            rgba(91,204,244,.10) 70%,
            transparent
          );
        }

        .pr-heroPanel::after,
        .pr-panel::after{
          content:"";
          position:absolute;
          z-index:0;
          inset:0;
          pointer-events:none;
          opacity:.32;
          background:
            repeating-linear-gradient(
              90deg,
              rgba(255,255,255,.006) 0,
              rgba(255,255,255,.006) 1px,
              transparent 1px,
              transparent 5px
            );
          mix-blend-mode:soft-light;
        }

        .pr-heroPanel>*,
        .pr-panel>*{position:relative;z-index:1}

        .pr-heroPanel{padding:21px}
        .pr-panel{padding:18px}

        .pr-heroTop{
          display:flex;
          align-items:flex-start;
          justify-content:space-between;
          gap:22px;
        }

        .pr-pageEyebrow,
        .pr-eyebrow{
          color:#83dcfa;
          font-size:10px;
          line-height:1;
          font-weight:1000;
          letter-spacing:.17em;
        }

        .pr-heroTop h1{
          margin:8px 0 5px;
          color:#fff;
          font-size:clamp(31px,4vw,48px);
          line-height:.95;
          font-weight:1000;
          letter-spacing:-.045em;
          text-shadow:0 3px 4px rgba(0,0,0,.42);
        }

        .pr-heroTop p{
          max-width:690px;
          margin:0;
          color:rgba(216,232,240,.67);
          font-size:12px;
          line-height:1.5;
          font-weight:750;
        }

        .pr-controls{
          display:flex;
          align-items:flex-end;
          gap:9px;
          flex-wrap:wrap;
          justify-content:flex-end;
        }

        .pr-controls label,
        .pr-exerciseSelect{
          display:grid;
          gap:5px;
        }

        .pr-controls label>span,
        .pr-exerciseSelect>span{
          color:rgba(170,200,213,.60);
          font-size:7px;
          line-height:1;
          font-weight:1000;
          letter-spacing:.15em;
        }

        .pr-selectShell{
          position:relative;
          min-width:150px;
          display:flex;
          align-items:center;
          border:1px solid rgba(128,196,220,.15);
          border-top-color:rgba(181,224,240,.21);
          border-radius:10px;
          background:linear-gradient(180deg,#13212a,#0a1218);
          box-shadow:
            0 2px 4px rgba(0,0,0,.28),
            inset 0 1px 0 rgba(255,255,255,.035);
        }

        .pr-selectShell select{
          width:100%;
          min-height:39px;
          padding:0 34px 0 11px;
          appearance:none;
          border:0;
          outline:0;
          color:#edf7fb;
          background:transparent;
          font-size:10px;
          font-weight:950;
          cursor:pointer;
        }

        .pr-selectShell .pr-svgIcon{
          position:absolute;
          right:10px;
          pointer-events:none;
          color:#56c9f1;
        }

        .pr-svgIcon{
          fill:none;
          stroke:currentColor;
          stroke-width:1.8;
          stroke-linecap:round;
          stroke-linejoin:round;
        }

        .pr-programDeck{
          display:grid;
          grid-template-columns:minmax(240px,1fr) minmax(260px,1.2fr) 170px;
          gap:12px;
          align-items:center;
          margin-top:18px;
          padding-top:16px;
          border-top:1px solid rgba(125,193,218,.10);
        }

        .pr-programIdentity{
          display:flex;
          align-items:center;
          gap:12px;
          min-width:0;
        }

        .pr-programGlyph{
          width:47px;
          height:47px;
          flex:0 0 47px;
          display:grid;
          place-items:center;
          color:#66d5f7;
          border:1px solid rgba(91,196,233,.20);
          border-top-color:rgba(160,225,248,.28);
          border-radius:12px;
          background:linear-gradient(180deg,#123548,#0a202c);
          box-shadow:
            0 2px 4px rgba(0,0,0,.35),
            inset 0 1px 0 rgba(255,255,255,.055),
            inset 0 -3px 5px rgba(0,0,0,.24);
        }

        .pr-programIdentity>div:last-child{
          min-width:0;
          display:grid;
          gap:4px;
        }

        .pr-programIdentity span,
        .pr-analysisWindow span{
          color:rgba(154,190,206,.62);
          font-size:7px;
          font-weight:1000;
          letter-spacing:.15em;
        }

        .pr-programIdentity strong{
          overflow:hidden;
          color:#fff;
          font-size:18px;
          line-height:1;
          font-weight:1000;
          letter-spacing:-.02em;
          white-space:nowrap;
          text-overflow:ellipsis;
        }

        .pr-programIdentity small,
        .pr-analysisWindow small{
          color:rgba(190,211,221,.54);
          font-size:9px;
          font-weight:800;
        }

        .pr-rotationRail{
          display:flex;
          align-items:center;
          justify-content:center;
          gap:0;
          min-width:0;
          overflow:hidden;
        }

        .pr-rotationRail span{
          min-width:0;
          padding:0 13px;
          color:rgba(230,241,246,.78);
          font-size:9px;
          font-weight:950;
          white-space:nowrap;
        }

        .pr-rotationRail span+span{
          border-left:1px solid rgba(140,200,222,.16);
        }

        .pr-analysisWindow{
          display:grid;
          justify-items:end;
          gap:4px;
          text-align:right;
        }

        .pr-analysisWindow strong{
          color:var(--pr-orange);
          font-size:18px;
          line-height:1;
          font-weight:1000;
          letter-spacing:.02em;
        }

        .pr-toast,
        .pr-error{
          padding:11px 13px;
          border-radius:10px;
          font-size:10px;
          font-weight:900;
        }

        .pr-toast{
          color:#bff4d8;
          border:1px solid rgba(77,229,154,.18);
          background:rgba(29,105,70,.18);
        }

        .pr-error{
          color:#ffd5d5;
          border:1px solid rgba(255,107,107,.22);
          background:rgba(113,31,31,.20);
        }

        .pr-sectionHead{
          display:flex;
          align-items:flex-start;
          justify-content:space-between;
          gap:18px;
          margin-bottom:15px;
        }

        .pr-sectionTitleGroup{
          display:flex;
          align-items:flex-start;
          gap:11px;
          min-width:0;
        }

        .pr-sectionAccent{
          width:3px;
          height:34px;
          flex:0 0 3px;
          border-radius:3px;
          background:linear-gradient(180deg,#8de8ff,#16a8e1);
          box-shadow:0 0 10px rgba(39,180,230,.22);
        }

        .pr-sectionHead h2{
          margin:5px 0 3px;
          color:#fff;
          font-size:22px;
          line-height:1;
          font-weight:1000;
          letter-spacing:-.03em;
        }

        .pr-sectionHead p{
          margin:0;
          color:rgba(195,215,224,.57);
          font-size:10px;
          line-height:1.45;
          font-weight:760;
        }

        .pr-sectionRight{
          display:flex;
          align-items:center;
          justify-content:flex-end;
          min-width:0;
        }

        .pr-primaryMetrics{
          display:grid;
          grid-template-columns:repeat(4,minmax(0,1fr));
          gap:0;
          border-top:1px solid rgba(131,198,221,.10);
          border-bottom:1px solid rgba(131,198,221,.08);
        }

        .pr-metric{
          position:relative;
          min-width:0;
          padding:17px 15px 16px;
        }

        .pr-metric+.pr-metric{
          border-left:1px solid rgba(139,201,223,.12);
        }

        .pr-metricTop{
          display:flex;
          align-items:center;
          gap:8px;
          min-width:0;
        }

        .pr-metricTop>span:last-child{
          color:rgba(225,238,244,.79);
          font-size:9px;
          line-height:1.15;
          font-weight:1000;
          letter-spacing:.105em;
        }

        .pr-assetIcon{
          width:27px;
          height:27px;
          flex:0 0 27px;
          display:grid;
          place-items:center;
          border-radius:8px;
          border:1px solid rgba(91,191,227,.16);
          background:rgba(11,43,57,.58);
        }

        .pr-assetIcon img{
          width:19px;
          height:19px;
          object-fit:contain;
        }

        .pr-assetIcon.tone-green{
          border-color:rgba(77,229,154,.16);
          background:rgba(22,74,52,.48);
        }

        .pr-assetIcon.tone-orange{
          border-color:rgba(255,159,28,.16);
          background:rgba(81,52,12,.48);
        }

        .pr-assetIcon.tone-red{
          border-color:rgba(255,107,107,.18);
          background:rgba(82,29,29,.46);
        }

        .pr-metricValue{
          margin-top:13px;
          color:#fff;
          font-size:clamp(24px,3vw,36px);
          line-height:.92;
          font-weight:1000;
          letter-spacing:-.045em;
          font-variant-numeric:tabular-nums;
          white-space:nowrap;
          text-shadow:0 2px 3px rgba(0,0,0,.42);
        }

        .pr-metric.tone-orange .pr-metricValue{color:var(--pr-orange)}
        .pr-metric.tone-green .pr-metricValue{color:#8cf0bb}
        .pr-metric.tone-red .pr-metricValue{color:#ff9c9c}

        .pr-metricDetail{
          margin-top:7px;
          color:rgba(180,205,216,.58);
          font-size:9px;
          line-height:1.25;
          font-weight:780;
        }

        .pr-secondaryStrip{
          display:grid;
          grid-template-columns:repeat(4,minmax(0,1fr));
          gap:8px;
          margin-top:12px;
        }

        .pr-secondaryStrip>div{
          min-width:0;
          padding:10px 12px;
          border-left:2px solid rgba(65,199,245,.32);
          background:linear-gradient(90deg,rgba(29,78,97,.12),transparent 85%);
        }

        .pr-secondaryStrip span,
        .pr-qualityMetric>span,
        .pr-recoveryMetric span,
        .pr-recoveryNumbers span,
        .pr-exerciseStats span,
        .pr-programCard>div:first-child>span,
        .pr-programCardMetrics span,
        .pr-historyMetrics span,
        .pr-historyExerciseLine>span,
        .pr-historyDetailSummary span,
        .pr-historyNotes>span{
          color:rgba(156,190,205,.64);
          font-size:7px;
          line-height:1;
          font-weight:1000;
          letter-spacing:.13em;
        }

        .pr-secondaryStrip strong{
          display:block;
          overflow:hidden;
          margin-top:5px;
          color:#eff8fb;
          font-size:14px;
          font-weight:1000;
          white-space:nowrap;
          text-overflow:ellipsis;
        }

        .pr-twoColumn{
          display:grid;
          grid-template-columns:minmax(0,1.65fr) minmax(260px,.72fr);
          gap:12px;
        }

        .pr-chartPanel,
        .pr-recoveryPanel,
        .pr-exerciseChart{
          position:relative;
          overflow:hidden;
          border:1px solid rgba(121,191,217,.12);
          border-top-color:rgba(179,224,240,.18);
          border-radius:14px;
          background:linear-gradient(180deg,#0d1921,#081016);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.025),
            inset 0 -1px 0 rgba(0,0,0,.58);
        }

        .pr-chartPanel{padding:14px}
        .pr-chartHead{
          display:flex;
          align-items:flex-start;
          justify-content:space-between;
          gap:12px;
          margin-bottom:10px;
        }

        .pr-chartHead>div:first-child{
          display:grid;
          gap:5px;
        }

        .pr-chartHead span,
        .pr-exerciseChartHead span{
          color:rgba(159,192,206,.63);
          font-size:7px;
          font-weight:1000;
          letter-spacing:.14em;
        }

        .pr-chartHead strong{
          color:#fff;
          font-size:23px;
          line-height:1;
          font-weight:1000;
          letter-spacing:-.03em;
        }

        .pr-chartBadge{
          display:flex;
          align-items:center;
          gap:6px;
          color:#9ae4fb;
          font-size:8px;
          font-weight:1000;
          letter-spacing:.08em;
        }

        .pr-sparkWrap{min-width:0}
        .pr-spark{
          width:100%;
          height:118px;
          display:block;
          overflow:visible;
        }

        .pr-chartGrid{
          stroke:rgba(131,189,211,.08);
          stroke-width:1;
          vector-effect:non-scaling-stroke;
          stroke-dasharray:3 7;
        }

        .pr-chartAxis{
          display:flex;
          justify-content:space-between;
          gap:6px;
          margin-top:5px;
          color:rgba(142,177,193,.42);
          font-size:6px;
          font-weight:900;
          letter-spacing:.06em;
        }

        .pr-chartEmpty{
          display:grid;
          place-items:center;
          color:rgba(174,200,212,.48);
          font-size:9px;
          font-weight:850;
        }

        .pr-performanceRail{
          display:grid;
          grid-template-columns:1fr;
          align-content:stretch;
          border-top:1px solid rgba(131,198,221,.09);
          border-bottom:1px solid rgba(131,198,221,.07);
        }

        .pr-performanceRail .pr-metric{
          padding:13px 14px;
        }

        .pr-performanceRail .pr-metric+.pr-metric{
          border-left:0;
          border-top:1px solid rgba(139,201,223,.10);
        }

        .pr-performanceRail .pr-metricValue{
          font-size:24px;
        }

        .pr-qualityGrid{
          display:grid;
          grid-template-columns:1.25fr repeat(3,minmax(0,1fr));
          gap:10px;
        }

        .pr-qualityMetric{
          min-width:0;
          padding:15px;
          border-left:2px solid rgba(64,200,247,.32);
          background:linear-gradient(90deg,rgba(28,78,98,.13),transparent 88%);
        }

        .pr-qualityMetric strong{
          display:block;
          margin-top:8px;
          color:#fff;
          font-size:23px;
          line-height:1;
          font-weight:1000;
          letter-spacing:-.03em;
        }

        .pr-qualityMetric small{
          display:block;
          margin-top:6px;
          color:rgba(184,207,217,.55);
          font-size:8px;
          line-height:1.35;
          font-weight:760;
        }

        .pr-meter{
          height:3px;
          margin-top:12px;
          overflow:hidden;
          border-radius:4px;
          background:rgba(120,179,202,.10);
        }

        .pr-meter span{
          display:block;
          height:100%;
          border-radius:inherit;
          background:linear-gradient(90deg,#1baedf,#75defb);
          box-shadow:0 0 8px rgba(57,198,244,.24);
        }

        .pr-bodyGrid{
          display:grid;
          grid-template-columns:minmax(0,1.45fr) minmax(300px,.8fr);
          gap:12px;
        }

        .pr-bodyChart{min-height:190px}
        .pr-delta{
          color:rgba(204,222,231,.64);
          font-size:9px;
          font-weight:1000;
          letter-spacing:.06em;
        }
        .pr-delta.is-up{color:#8defbb}
        .pr-delta.is-down{color:#ffb66c}

        .pr-recoveryPanel{
          display:grid;
          align-content:center;
          gap:13px;
          padding:15px;
        }

        .pr-recoveryMetric{
          display:flex;
          align-items:center;
          gap:11px;
        }

        .pr-recoveryMetric>div:last-child{
          display:grid;
          gap:4px;
        }

        .pr-recoveryMetric strong{
          color:#fff;
          font-size:25px;
          line-height:1;
          font-weight:1000;
        }

        .pr-recoveryMetric small{
          color:rgba(182,205,216,.55);
          font-size:8px;
          line-height:1.3;
          font-weight:760;
        }

        .pr-recoveryDivider{
          height:1px;
          background:linear-gradient(
            90deg,
            transparent,
            rgba(126,195,220,.15),
            transparent
          );
        }

        .pr-recoveryNumbers{
          display:grid;
          grid-template-columns:repeat(3,1fr);
          gap:0;
        }

        .pr-recoveryNumbers>div{
          min-width:0;
          text-align:center;
        }

        .pr-recoveryNumbers>div+div{
          border-left:1px solid rgba(133,196,219,.12);
        }

        .pr-recoveryNumbers strong{
          display:block;
          margin-top:5px;
          color:#fff;
          font-size:21px;
          font-weight:1000;
        }

        .pr-recoveryState{
          display:flex;
          align-items:center;
          gap:7px;
          color:#91efbd;
          font-size:8px;
          font-weight:1000;
          letter-spacing:.08em;
        }

        .pr-recoveryState>span{
          width:7px;
          height:7px;
          border-radius:50%;
          background:var(--pr-green);
          box-shadow:0 0 9px rgba(77,229,154,.28);
        }

        .pr-recoveryState.is-watch{
          color:#ffbe73;
        }

        .pr-recoveryState.is-watch>span{
          background:var(--pr-orange);
          box-shadow:0 0 9px rgba(255,159,28,.24);
        }

        .pr-exerciseSelect .pr-selectShell{min-width:210px}

        .pr-exerciseDeck{
          display:grid;
          grid-template-columns:minmax(240px,.72fr) minmax(0,1.6fr);
          gap:12px;
        }

        .pr-exerciseStats{
          display:grid;
          grid-template-columns:repeat(2,1fr);
          gap:0;
          border-top:1px solid rgba(132,197,220,.10);
          border-bottom:1px solid rgba(132,197,220,.08);
        }

        .pr-exerciseStats>div{
          min-width:0;
          padding:16px;
        }

        .pr-exerciseStats>div:nth-child(even){
          border-left:1px solid rgba(135,198,220,.11);
        }

        .pr-exerciseStats>div:nth-child(n+3){
          border-top:1px solid rgba(135,198,220,.09);
        }

        .pr-exerciseStats strong{
          display:block;
          margin-top:7px;
          color:#fff;
          font-size:23px;
          line-height:1;
          font-weight:1000;
          letter-spacing:-.03em;
        }

        .pr-exerciseStats strong.is-positive{color:#83edb3}

        .pr-exerciseChart{padding:14px}
        .pr-exerciseChartHead{
          display:flex;
          align-items:flex-start;
          justify-content:space-between;
          gap:12px;
          margin-bottom:10px;
        }

        .pr-exerciseChartHead>div:first-child{
          display:grid;
          gap:5px;
        }

        .pr-exerciseChartHead strong{
          color:#fff;
          font-size:17px;
          font-weight:1000;
        }

        .pr-exerciseChartHead>div:last-child{
          color:rgba(180,206,217,.55);
          font-size:8px;
          font-weight:850;
        }

        .pr-programGrid{
          display:grid;
          grid-template-columns:repeat(2,minmax(0,1fr));
          gap:10px;
        }

        .pr-programCard{
          position:relative;
          overflow:hidden;
          padding:14px;
          border:1px solid rgba(125,194,218,.11);
          border-top-color:rgba(179,224,240,.17);
          border-radius:13px;
          background:linear-gradient(180deg,#101c24,#091117);
          box-shadow:
            0 2px 4px rgba(0,0,0,.26),
            inset 0 1px 0 rgba(255,255,255,.025);
        }

        .pr-programCard::before{
          content:"";
          position:absolute;
          left:0;
          top:0;
          bottom:0;
          width:2px;
          background:linear-gradient(180deg,#60d5f7,#176c8c);
        }

        .pr-programCard h3{
          margin:6px 0 0;
          color:#fff;
          font-size:18px;
          line-height:1;
          font-weight:1000;
        }

        .pr-programCardMetrics{
          display:grid;
          grid-template-columns:repeat(4,minmax(0,1fr));
          gap:0;
          margin-top:14px;
          padding-top:12px;
          border-top:1px solid rgba(133,197,220,.09);
        }

        .pr-programCardMetrics>div{
          min-width:0;
          padding:0 8px;
        }

        .pr-programCardMetrics>div:first-child{padding-left:0}
        .pr-programCardMetrics>div+div{
          border-left:1px solid rgba(132,197,220,.10);
        }

        .pr-programCardMetrics strong{
          display:block;
          margin-top:6px;
          overflow:hidden;
          color:#eef8fb;
          font-size:13px;
          font-weight:1000;
          white-space:nowrap;
          text-overflow:ellipsis;
        }

        .pr-historyPanel{padding-bottom:16px}
        .pr-dangerButton{
          min-height:36px;
          padding:0 13px;
          border:1px solid rgba(255,107,107,.24);
          border-radius:10px;
          color:#ffc1c1;
          background:rgba(91,30,30,.18);
          font-size:8px;
          font-weight:1000;
          letter-spacing:.08em;
          cursor:pointer;
        }

        .pr-historyList{
          display:grid;
          gap:9px;
        }

        .pr-historyRow{
          position:relative;
          overflow:hidden;
          padding:14px;
          border:1px solid rgba(129,194,217,.11);
          border-top-color:rgba(185,225,240,.16);
          border-radius:13px;
          background:linear-gradient(180deg,#111d25,#0a1218);
          box-shadow:
            0 2px 4px rgba(0,0,0,.27),
            inset 0 1px 0 rgba(255,255,255,.025);
        }

        .pr-historyRow::before{
          content:"";
          position:absolute;
          left:0;
          top:0;
          bottom:0;
          width:2px;
          background:linear-gradient(180deg,rgba(71,202,246,.72),rgba(21,94,121,.24));
        }

        .pr-historyTop{
          display:flex;
          align-items:flex-start;
          justify-content:space-between;
          gap:14px;
        }

        .pr-historyTop>div{
          display:grid;
          gap:4px;
        }

        .pr-historyTop>div>span{
          color:rgba(151,189,205,.58);
          font-size:7px;
          font-weight:1000;
          letter-spacing:.14em;
        }

        .pr-historyTop h3{
          margin:0;
          color:#fff;
          font-size:18px;
          line-height:1;
          font-weight:1000;
        }

        .pr-historyTop time{
          color:rgba(215,232,240,.72);
          font-size:8px;
          font-weight:1000;
          letter-spacing:.08em;
          white-space:nowrap;
        }

        .pr-historyMetrics{
          display:grid;
          grid-template-columns:1.15fr repeat(4,minmax(0,1fr));
          gap:0;
          margin-top:12px;
          padding:10px 0;
          border-top:1px solid rgba(129,193,216,.08);
          border-bottom:1px solid rgba(129,193,216,.08);
        }

        .pr-historyMetrics>div{
          min-width:0;
          padding:0 11px;
        }

        .pr-historyMetrics>div:first-child{padding-left:0}
        .pr-historyMetrics>div+div{
          border-left:1px solid rgba(129,193,216,.10);
        }

        .pr-historyMetrics strong{
          display:block;
          margin-top:5px;
          color:#fff;
          font-size:14px;
          font-weight:1000;
          white-space:nowrap;
        }

        .pr-historyMetrics small{
          display:block;
          margin-top:4px;
          color:#ffad64;
          font-size:6px;
          font-weight:1000;
          letter-spacing:.08em;
        }

        .pr-historyExerciseLine{
          display:grid;
          gap:5px;
          margin-top:10px;
        }

        .pr-historyExerciseLine p{
          margin:0;
          color:rgba(217,231,238,.70);
          font-size:9px;
          line-height:1.5;
          font-weight:760;
        }

        .pr-historyToggle{
          width:100%;
          min-height:35px;
          display:flex;
          align-items:center;
          justify-content:center;
          gap:7px;
          margin-top:11px;
          border:1px solid rgba(0,170,255,.32);
          border-radius:9px;
          color:#e9f8fd;
          background:rgba(0,170,255,.07);
          font-size:8px;
          font-weight:1000;
          letter-spacing:.08em;
          cursor:pointer;
        }

        .pr-historyRow.is-expanded .pr-historyToggle .pr-svgIcon{
          transform:rotate(180deg);
        }

        .pr-historyDetails{
          display:grid;
          gap:11px;
          margin-top:12px;
          padding-top:12px;
          border-top:1px solid rgba(129,193,216,.09);
        }

        .pr-historyDetailSummary{
          display:grid;
          grid-template-columns:repeat(4,minmax(0,1fr));
          gap:0;
        }

        .pr-historyDetailSummary>div{
          min-width:0;
          padding:0 10px;
        }

        .pr-historyDetailSummary>div:first-child{padding-left:0}
        .pr-historyDetailSummary>div+div{
          border-left:1px solid rgba(129,193,216,.10);
        }

        .pr-historyDetailSummary strong{
          display:block;
          margin-top:5px;
          color:#fff;
          font-size:13px;
          font-weight:1000;
        }

        .pr-historyExerciseDetails{
          display:grid;
          gap:7px;
        }

        .pr-historyExercise{
          padding:10px 11px;
          border-left:2px solid rgba(68,201,245,.28);
          background:linear-gradient(90deg,rgba(27,78,98,.11),transparent 90%);
        }

        .pr-historyExerciseHead{
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:10px;
        }

        .pr-historyExerciseHead strong{
          color:#f2f9fb;
          font-size:11px;
          font-weight:1000;
        }

        .pr-historyExerciseHead span{
          color:rgba(187,210,220,.58);
          font-size:8px;
          font-weight:850;
        }

        .pr-setRail{
          display:flex;
          flex-wrap:wrap;
          gap:8px 14px;
          margin-top:7px;
        }

        .pr-setRail span{
          color:rgba(218,233,239,.76);
          font-size:9px;
          font-weight:800;
        }

        .pr-setRail b{
          margin-right:5px;
          color:#66d3f5;
          font-size:7px;
          letter-spacing:.08em;
        }

        .pr-historyNoSets{
          margin-top:7px;
          color:rgba(180,204,214,.48);
          font-size:8px;
        }

        .pr-historyNotes{
          padding:10px 11px;
          border-left:2px solid rgba(255,159,28,.30);
          background:linear-gradient(90deg,rgba(92,56,10,.11),transparent 90%);
        }

        .pr-historyNotes p{
          margin:6px 0 0;
          color:rgba(226,236,241,.72);
          font-size:9px;
          line-height:1.45;
        }

        .pr-historyLoadMore{
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:12px;
          margin-top:12px;
          padding-top:12px;
          border-top:1px solid rgba(129,193,216,.08);
        }

        .pr-historyLoadMore span{
          color:rgba(182,205,216,.56);
          font-size:8px;
          font-weight:900;
        }

        .pr-historyLoadMore button{
          min-height:37px;
          padding:0 16px;
          border:2px solid rgba(0,170,255,.62);
          border-radius:11px;
          color:#f4fbff;
          background:rgba(0,170,255,.10);
          box-shadow:
            0 0 0 1px rgba(0,170,255,.14) inset,
            0 8px 20px rgba(0,0,0,.35);
          font-size:8px;
          font-weight:1000;
          letter-spacing:.08em;
          cursor:pointer;
        }

        .pr-empty{
          padding:24px;
          color:rgba(182,205,216,.55);
          text-align:center;
          font-size:10px;
          font-weight:850;
        }

        .pr-modalOverlay{
          position:fixed;
          z-index:9999;
          inset:0;
          display:grid;
          place-items:center;
          padding:20px;
          background:rgba(2,7,11,.80);
          backdrop-filter:blur(7px);
        }

        .pr-modal{
          width:min(470px,100%);
          padding:18px;
          border:1px solid rgba(255,107,107,.23);
          border-top-color:rgba(255,175,175,.30);
          border-radius:16px;
          background:linear-gradient(180deg,#161e24,#090f14);
          box-shadow:0 28px 80px rgba(0,0,0,.60);
        }

        .pr-modalKicker{
          color:#ff9d9d;
          font-size:8px;
          font-weight:1000;
          letter-spacing:.14em;
        }

        .pr-modal h2{
          margin:7px 0 6px;
          color:#fff;
          font-size:22px;
        }

        .pr-modal p{
          margin:0;
          color:rgba(218,232,238,.66);
          font-size:10px;
          line-height:1.5;
        }

        .pr-modal input{
          width:100%;
          min-height:43px;
          margin-top:14px;
          padding:0 12px;
          border:1px solid rgba(255,255,255,.12);
          border-radius:10px;
          outline:0;
          color:#fff;
          background:#070d11;
          font-weight:900;
        }

        .pr-modalActions{
          display:flex;
          justify-content:flex-end;
          gap:8px;
          margin-top:14px;
        }

        .pr-modalActions button{
          min-height:38px;
          padding:0 14px;
          border:1px solid rgba(145,192,210,.15);
          border-radius:10px;
          color:#e7f2f6;
          background:#111a20;
          font-size:8px;
          font-weight:1000;
          letter-spacing:.08em;
          cursor:pointer;
        }

        .pr-modalActions button.is-danger{
          border-color:rgba(255,107,107,.30);
          color:#ffe2e2;
          background:#521d1d;
        }

        .pr-modalActions button:disabled{
          opacity:.42;
          cursor:not-allowed;
        }

        @media(max-width:980px){
          .pr-programDeck{
            grid-template-columns:1fr 1fr;
          }
          .pr-rotationRail{
            grid-column:1 / -1;
            grid-row:2;
            justify-content:flex-start;
          }
          .pr-primaryMetrics{
            grid-template-columns:repeat(2,minmax(0,1fr));
          }
          .pr-primaryMetrics .pr-metric:nth-child(3){
            border-left:0;
            border-top:1px solid rgba(139,201,223,.10);
          }
          .pr-primaryMetrics .pr-metric:nth-child(4){
            border-top:1px solid rgba(139,201,223,.10);
          }
          .pr-secondaryStrip,
          .pr-qualityGrid{
            grid-template-columns:repeat(2,minmax(0,1fr));
          }
          .pr-twoColumn,
          .pr-bodyGrid,
          .pr-exerciseDeck{
            grid-template-columns:1fr;
          }
        }

        @media(max-width:700px){
          .pr-page{gap:10px}
          .pr-heroPanel,.pr-panel{
            padding:13px;
            border-radius:15px;
          }
          .pr-heroTop{
            display:grid;
            gap:14px;
          }
          .pr-controls{
            justify-content:flex-start;
          }
          .pr-controls label{
            flex:1 1 140px;
          }
          .pr-selectShell{min-width:0}
          .pr-programDeck{
            grid-template-columns:1fr;
          }
          .pr-analysisWindow{
            justify-items:start;
            text-align:left;
          }
          .pr-rotationRail{
            grid-column:auto;
            grid-row:auto;
            overflow-x:auto;
            justify-content:flex-start;
            padding-bottom:4px;
          }
          .pr-sectionHead{
            display:grid;
            gap:12px;
          }
          .pr-sectionRight{
            justify-content:flex-start;
          }
          .pr-exerciseSelect,
          .pr-exerciseSelect .pr-selectShell{
            width:100%;
          }
          .pr-primaryMetrics,
          .pr-secondaryStrip,
          .pr-qualityGrid{
            grid-template-columns:1fr 1fr;
          }
          .pr-metric{
            padding:13px 10px;
          }
          .pr-metricValue{font-size:25px}
          .pr-secondaryStrip>div{padding:9px 8px}
          .pr-programGrid{grid-template-columns:1fr}
          .pr-programCardMetrics{
            grid-template-columns:repeat(2,1fr);
            gap:10px 0;
          }
          .pr-programCardMetrics>div:nth-child(3){
            border-left:0;
          }
          .pr-historyTop{
            display:grid;
            gap:7px;
          }
          .pr-historyMetrics{
            grid-template-columns:repeat(3,1fr);
            gap:9px 0;
          }
          .pr-historyMetrics>div{
            padding:0 8px;
          }
          .pr-historyMetrics>div:nth-child(4){
            border-left:0;
          }
          .pr-historyDetailSummary{
            grid-template-columns:repeat(2,1fr);
            gap:10px 0;
          }
          .pr-historyDetailSummary>div:nth-child(3){
            border-left:0;
          }
          .pr-historyLoadMore{
            align-items:stretch;
            flex-direction:column;
          }
          .pr-historyLoadMore button{width:100%}
        }

        @media(max-width:480px){
          .pr-primaryMetrics,
          .pr-secondaryStrip,
          .pr-qualityGrid{
            grid-template-columns:1fr;
          }
          .pr-primaryMetrics .pr-metric+.pr-metric{
            border-left:0;
            border-top:1px solid rgba(139,201,223,.10);
          }
          .pr-recoveryNumbers{
            grid-template-columns:1fr;
            gap:9px;
          }
          .pr-recoveryNumbers>div+div{
            border-left:0;
            border-top:1px solid rgba(133,196,219,.10);
            padding-top:9px;
          }
          .pr-exerciseStats{
            grid-template-columns:1fr;
          }
          .pr-exerciseStats>div:nth-child(even){
            border-left:0;
          }
          .pr-exerciseStats>div+div{
            border-top:1px solid rgba(135,198,220,.09);
          }
          .pr-historyMetrics{
            grid-template-columns:repeat(2,1fr);
          }
          .pr-historyMetrics>div:nth-child(3),
          .pr-historyMetrics>div:nth-child(5){
            border-left:0;
          }
        }

        @media(prefers-reduced-motion:reduce){
          .pr-page *{scroll-behavior:auto!important}
        }
      `}</style>
    </div>
  );
}
