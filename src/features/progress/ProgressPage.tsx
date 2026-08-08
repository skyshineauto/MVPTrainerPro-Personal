// src/features/progress/ProgressPage.tsx
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "../../lib/supabase";

type Scope = "active" | "all";
type Range = 7 | 14 | 30 | 90 | 365 | "all";
type Tone = "green" | "amber" | "red" | "blue";
type WorkoutTone = "upper1" | "upper2" | "lower1" | "lower2" | "other";

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
  primary_muscles?: string[] | null;
  secondary_muscles?: string[] | null;
};

type ExerciseDetail = {
  workoutExerciseId: string;
  exerciseId: string;
  name: string;
  primaryMuscles: string[];
  secondaryMuscles: string[];
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
  workoutSeconds: number;
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

type ExercisePoint = {
  workoutId: string;
  date: string;
  workoutName: string;
  bestWeight: number;
  bestReps: number;
  bestE1RM: number;
  volume: number;
  avgRir: number | null;
  pain: number | null;
};

type ExerciseProgress = {
  id: string;
  name: string;
  primaryMuscles: string[];
  points: ExercisePoint[];
};

type ExerciseView = ExerciseProgress & {
  currentWeight: number;
  currentReps: number;
  currentE1RM: number;
  d7: number | null;
  d14: number | null;
  d30: number | null;
  d365: number | null;
  selectedChange: number | null;
};

type PainView = {
  id: string;
  name: string;
  current: number | null;
  d7: number | null;
  d14: number | null;
  d30: number | null;
  d365: number | null;
};

type Recommendation = {
  eyebrow: string;
  title: string;
  body: string;
  action: string;
  tone: Tone;
};

type Issue = {
  title: string;
  detail: string;
  tone: Tone;
};

type WorkoutBreakdown = {
  name: string;
  tone: WorkoutTone;
  workouts: number;
  avgTime: number;
  volume: number;
  volumeChange: number | null;
  avgPain: number;
  painChange: number | null;
};

type DropdownOption = { value: string; label: string };

const HISTORY_BATCH = 5;
const MIN_WORKOUT_SECONDS = 5 * 60;
const MAX_WORKOUT_SECONDS = 4 * 60 * 60;
const STABLE_PCT = 2;

function ms(value: string | null | undefined) {
  if (!value) return NaN;
  return new Date(value).getTime();
}

function daysForRange(range: Range) {
  return range === "all" ? null : range;
}

function rangeLabel(range: Range) {
  if (range === "all") return "All Time";
  if (range === 365) return "1 Year";
  return `${range} Days`;
}

function previousLabel(range: Range) {
  if (range === "all") return "previous period";
  if (range === 365) return "previous year";
  return `previous ${range} days`;
}

function inWindow(date: string, days: number | null, offset = 0) {
  if (days == null) return offset === 0;
  const stamp = ms(date);
  if (!Number.isFinite(stamp)) return false;
  const end = Date.now() - offset * days * 86400000;
  const start = end - days * 86400000;
  return stamp >= start && stamp < end;
}

function filterWindow(rows: HistoryRow[], days: number | null, offset = 0) {
  if (days == null) return offset === 0 ? rows : [];
  return rows.filter((row) => inWindow(row.completedAt, days, offset));
}

function average(values: number[]) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function formatNumber(value: number, digits = 0) {
  return Number.isFinite(value)
    ? value.toLocaleString(undefined, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    : "—";
}

function formatWeight(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value) || value <= 0) return "—";
  return `${Number.isInteger(value) ? value : value.toFixed(1)} LB`;
}

function formatVolume(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.round(value).toLocaleString()} LB`;
}

function formatPct(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  const clean = Math.abs(value) < 0.05 ? 0 : value;
  return `${clean > 0 ? "+" : ""}${clean.toFixed(1)}%`;
}

function formatPainDelta(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  const clean = Math.abs(value) < 0.05 ? 0 : value;
  return `${clean > 0 ? "+" : ""}${clean.toFixed(1)}`;
}

function formatDuration(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  if (!total) return "—";
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours) return minutes ? `${hours}H ${minutes}M` : `${hours}H`;
  return `${minutes || 1} MIN`;
}

function formatDate(ts: string) {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date
    .toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    .toUpperCase()} • ${date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function shortDate(ts: string) {
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

function goalLabel(value: string | null | undefined) {
  const key = String(value ?? "").toLowerCase();
  if (["build_muscle", "bulk", "muscle_gain"].includes(key)) return "Muscle Gain";
  if (["lose_weight", "cut"].includes(key)) return "Cut";
  if (key === "strength") return "Strength";
  if (key === "fitness") return "Fitness";
  return titleCase(value) || "Training";
}

function prettyMuscle(value: string) {
  const v = titleCase(value);
  const alias: Record<string, string> = {
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
  return alias[v] ?? v ?? "Other";
}

function proteinMultiplier(goal: string | null | undefined) {
  const key = String(goal ?? "").toLowerCase();
  return key === "cut" || key === "lose_weight" ? 1 : 0.9;
}

function roundProtein(value: number) {
  return Math.round(value / 5) * 5;
}

function e1rm(weight: number, reps: number) {
  if (!(weight > 0) || !(reps > 0)) return 0;
  return reps === 1 ? weight : weight * (1 + reps / 30);
}

function setVolume(set: WorkoutSetRow) {
  const reps = Number(set.reps ?? 0);
  const weight = Number(set.weight ?? 0);
  return reps > 0 && weight > 0 ? reps * weight : 0;
}

function workoutSeconds(workout: WorkoutRow) {
  const active = Number(workout.active_seconds ?? 0);
  if (active > 0) return Math.round(active);
  const start = workout.started_at ? ms(workout.started_at) : NaN;
  const end = workout.ended_at ? ms(workout.ended_at) : ms(workout.completed_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 1000);
}

function validWorkoutSeconds(seconds: number) {
  return seconds >= MIN_WORKOUT_SECONDS && seconds <= MAX_WORKOUT_SECONDS;
}

function workoutTone(name: string): WorkoutTone {
  const key = name.toLowerCase();
  const one = /\b1\b|\ba\b/.test(key);
  const two = /\b2\b|\bb\b/.test(key);
  if (key.includes("upper") && one) return "upper1";
  if (key.includes("upper") && two) return "upper2";
  if (key.includes("lower") && one) return "lower1";
  if (key.includes("lower") && two) return "lower2";
  return "other";
}

function changeTone(value: number | null, reverse = false) {
  if (value == null || Math.abs(value) < 0.05) return "neutral";
  const up = value > 0;
  if (reverse) return up ? "negative" : "positive";
  return up ? "positive" : "negative";
}

function pointAtOrBefore(points: ExercisePoint[], target: number) {
  return (
    points
      .filter((point) => ms(point.date) <= target)
      .slice()
      .sort((a, b) => ms(a.date) - ms(b.date))
      .at(-1) ?? null
  );
}

function exerciseChange(points: ExercisePoint[], days: number | null) {
  const valid = points
    .filter((point) => point.bestE1RM > 0)
    .slice()
    .sort((a, b) => ms(a.date) - ms(b.date));

  if (valid.length < 2) return null;
  const latest = valid.at(-1)!;

  if (days == null) {
    const first = valid[0];
    return first.bestE1RM > 0
      ? ((latest.bestE1RM - first.bestE1RM) / first.bestE1RM) * 100
      : null;
  }

  const start = Date.now() - days * 86400000;
  const before = pointAtOrBefore(valid, start);
  const inside = valid.filter((point) => ms(point.date) >= start);
  const baseline = before ?? (inside.length >= 2 ? inside[0] : null);
  if (!baseline || baseline.workoutId === latest.workoutId) return null;
  return baseline.bestE1RM > 0
    ? ((latest.bestE1RM - baseline.bestE1RM) / baseline.bestE1RM) * 100
    : null;
}

function painChange(points: { date: string; pain: number }[], days: number) {
  const valid = points.slice().sort((a, b) => ms(a.date) - ms(b.date));
  if (valid.length < 2) return null;
  const latest = valid.at(-1)!;
  const start = Date.now() - days * 86400000;
  const before =
    valid.filter((point) => ms(point.date) <= start).at(-1) ?? null;
  const inside = valid.filter((point) => ms(point.date) >= start);
  const baseline = before ?? (inside.length >= 2 ? inside[0] : null);
  if (!baseline || baseline.date === latest.date) return null;
  return latest.pain - baseline.pain;
}

function SvgIcon({
  name,
  size = 18,
}: {
  name: "chevron" | "coach" | "trend" | "trophy" | "weight";
  size?: number;
}) {
  const paths: Record<string, ReactNode> = {
    chevron: <path d="m8 10 4 4 4-4" />,
    coach: (
      <>
        <path d="M7 8a5 5 0 0 1 10 0v2" />
        <path d="M5 10h2v5H5zM17 10h2v5h-2zM8 20h8M12 15v5" />
      </>
    ),
    trend: <path d="m4 17 5-5 4 3 7-8M16 7h4v4" />,
    trophy: (
      <>
        <path d="M8 4h8v5a4 4 0 0 1-8 0V4ZM10 13v4M14 13v4M8 20h8" />
        <path d="M8 6H5v2a3 3 0 0 0 3 3M16 6h3v2a3 3 0 0 1-3 3" />
      </>
    ),
    weight: (
      <>
        <path d="M5 8h14l1 12H4L5 8Z" />
        <path d="M8 8a4 4 0 0 1 8 0M12 8l2-2" />
      </>
    ),
  };

  return (
    <svg
      className="pr-icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden
    >
      {paths[name]}
    </svg>
  );
}

function ProDropdown({
  value,
  options,
  onChange,
  ariaLabel,
  className = "",
}: {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (target && !root.current?.contains(target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("touchstart", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("touchstart", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div className={`pr-dropdown ${className}`} ref={root}>
      <button
        type="button"
        className={`pr-dropdownTrigger ${open ? "is-open" : ""}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{selected?.label ?? "Select"}</span>
        <SvgIcon name="chevron" size={16} />
      </button>

      {open ? (
        <div className="pr-dropdownMenu" role="listbox" aria-label={ariaLabel}>
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                type="button"
                key={option.value}
                role="option"
                aria-selected={active}
                className={`pr-dropdownOption ${active ? "is-selected" : ""}`}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span>{option.label}</span>
                {active ? <i aria-hidden /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function SectionTitle({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <div className="pr-sectionTitle">
      <div className="pr-sectionTitleText">
        <span className="pr-sectionAccent" aria-hidden />
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
      </div>
      {right ? <div className="pr-sectionRight">{right}</div> : null}
    </div>
  );
}

function Delta({
  value,
  reverse = false,
  pain = false,
}: {
  value: number | null;
  reverse?: boolean;
  pain?: boolean;
}) {
  return (
    <span className={`pr-delta is-${changeTone(value, reverse)}`}>
      {pain ? formatPainDelta(value) : formatPct(value)}
    </span>
  );
}

function StatusDot({ tone }: { tone: Tone }) {
  return <span className={`pr-statusDot is-${tone}`} aria-hidden />;
}

function WorkoutVolumeChart({ rows }: { rows: HistoryRow[] }) {
  const data = rows
    .slice()
    .sort((a, b) => ms(a.completedAt) - ms(b.completedAt))
    .slice(-10);
  const max = Math.max(1, ...data.map((row) => row.volumeTotal));

  if (!data.some((row) => row.volumeTotal > 0)) {
    return <div className="pr-empty">Log weighted sets to build a workout-volume trend.</div>;
  }

  return (
    <div className="pr-volumeChart">
      <div className="pr-volumeBars">
        {data.map((row) => (
          <div className="pr-volumeCol" key={row.id}>
            <b>{row.volumeTotal ? formatNumber(row.volumeTotal) : "—"}</b>
            <div className="pr-volumeTrack">
              <span
                className={`pr-volumeBar is-${workoutTone(row.templateName)}`}
                style={{
                  height: `${Math.max(8, (row.volumeTotal / max) * 100)}%`,
                }}
              />
            </div>
            <div>
              <strong className={`is-${workoutTone(row.templateName)}`}>
                {row.templateName}
              </strong>
              <small>{shortDate(row.completedAt)}</small>
            </div>
          </div>
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
  const [rotation, setRotation] = useState<string[]>([]);
  const [allWorkouts, setAllWorkouts] = useState<WorkoutRow[]>([]);
  const [allHistory, setAllHistory] = useState<HistoryRow[]>([]);

  const [selectedExerciseId, setSelectedExerciseId] = useState("");
  const [historyVisible, setHistoryVisible] = useState(HISTORY_BATCH);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [showBreakdown, setShowBreakdown] = useState(false);

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

      let activeWorkoutIds: string[] = [];
      let activeRotation: string[] = [];

      if (block?.id) {
        const { data: scheduled, error: scheduledError } = await supabase
          .from("scheduled_sessions")
          .select("id,template_id,session_type,date,program_block_id")
          .eq("user_id", userId)
          .eq("program_block_id", block.id)
          .order("date", { ascending: true });

        if (scheduledError) throw scheduledError;

        activeWorkoutIds = (scheduled ?? [])
          .map((row: any) => String(row.id ?? ""))
          .filter(Boolean);

        const templateIds = unique(
          (scheduled ?? [])
            .map((row: any) => String(row.template_id ?? ""))
            .filter(Boolean)
        );

        const templateMap = new Map<string, string>();
        if (templateIds.length) {
          const { data: templates, error: templateError } = await supabase
            .from("workout_templates")
            .select("id,name")
            .in("id", templateIds);

          if (templateError) throw templateError;
          for (const row of templates ?? []) {
            templateMap.set(
              String((row as any).id),
              String((row as any).name ?? "Workout")
            );
          }
        }

        activeRotation = unique(
          (scheduled ?? [])
            .map((row: any) => {
              const templateId = String(row.template_id ?? "");
              return (
                templateMap.get(templateId) ||
                titleCase(String(row.session_type ?? "")) ||
                "Workout"
              );
            })
            .filter(Boolean)
        ).slice(0, 6);
      }

      setRotation(activeRotation);

      if (scope === "active" && (!block?.id || !activeWorkoutIds.length)) {
        setAllWorkouts([]);
        setAllHistory([]);
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

      if (scope === "active") {
        workoutQuery = workoutQuery.in("scheduled_session_id", activeWorkoutIds);
      }

      const { data: workoutData, error: workoutError } = await workoutQuery;
      if (workoutError) throw workoutError;

      const workouts = (workoutData ?? []) as WorkoutRow[];
      setAllWorkouts(workouts);

      const workoutIds = workouts.map((row) => row.id);
      if (!workoutIds.length) {
        setAllHistory([]);
        return;
      }

      const scheduledIds = unique(
        workouts
          .map((row) => row.scheduled_session_id ?? "")
          .filter(Boolean)
      );

      const workoutNameMap = new Map<string, string>();

      if (scheduledIds.length) {
        const { data: scheduledRows, error: scheduledRowsError } = await supabase
          .from("scheduled_sessions")
          .select("id,template_id,session_type")
          .in("id", scheduledIds);

        if (scheduledRowsError) throw scheduledRowsError;

        const templateIds = unique(
          (scheduledRows ?? [])
            .map((row: any) => String(row.template_id ?? ""))
            .filter(Boolean)
        );

        const templateMap = new Map<string, string>();

        if (templateIds.length) {
          const { data: templateRows, error: templateRowsError } = await supabase
            .from("workout_templates")
            .select("id,name")
            .in("id", templateIds);

          if (templateRowsError) throw templateRowsError;

          for (const row of templateRows ?? []) {
            templateMap.set(
              String((row as any).id),
              String((row as any).name ?? "Workout")
            );
          }
        }

        for (const row of scheduledRows ?? []) {
          const id = String((row as any).id ?? "");
          const templateId = String((row as any).template_id ?? "");
          const name =
            templateMap.get(templateId) ||
            titleCase(String((row as any).session_type ?? "")) ||
            "Workout";
          if (id) workoutNameMap.set(id, name);
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

      const workoutExercises =
        (workoutExerciseData ?? []) as WorkoutExerciseRow[];

      const workoutExerciseIds = workoutExercises.map((row) => row.id);
      const exerciseIds = unique(
        workoutExercises.map((row) => row.exercise_id).filter(Boolean)
      );

      const exerciseMap = new Map<string, ExerciseRow>();

      if (exerciseIds.length) {
        const { data: exerciseData, error: exerciseError } = await supabase
          .from("exercises")
          .select("id,name,primary_muscles,secondary_muscles")
          .in("id", exerciseIds);

        if (exerciseError) throw exerciseError;

        for (const row of (exerciseData ?? []) as ExerciseRow[]) {
          exerciseMap.set(row.id, row);
        }
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
            rir: (raw as any).rir != null ? Number((raw as any).rir) : null,
            pain: (raw as any).pain != null ? Number((raw as any).pain) : null,
            form: (raw as any).form != null ? Number((raw as any).form) : null,
          };

          const list = setsByExercise.get(row.workout_exercise_id) ?? [];
          list.push(row);
          setsByExercise.set(row.workout_exercise_id, list);
        }
      }

      const detailsByWorkout = new Map<string, ExerciseDetail[]>();

      for (const row of workoutExercises) {
        const meta = exerciseMap.get(row.exercise_id);
        const list = detailsByWorkout.get(row.workout_id) ?? [];

        list.push({
          workoutExerciseId: row.id,
          exerciseId: row.exercise_id,
          name: meta?.name ?? "Exercise",
          primaryMuscles: Array.isArray(meta?.primary_muscles)
            ? meta!.primary_muscles!.map(prettyMuscle)
            : [],
          secondaryMuscles: Array.isArray(meta?.secondary_muscles)
            ? meta!.secondary_muscles!.map(prettyMuscle)
            : [],
          orderIndex: Number(row.order_index ?? 0),
          prescription: row.prescription_snapshot ?? {},
          pain: row.pain != null ? Number(row.pain) : null,
          difficulty: row.difficulty,
          sets: (setsByExercise.get(row.id) ?? []).sort(
            (a, b) => a.set_index - b.set_index
          ),
        });

        detailsByWorkout.set(row.workout_id, list);
      }

      const history: HistoryRow[] = workouts.map((workout) => {
        const exercises = (detailsByWorkout.get(workout.id) ?? []).sort(
          (a, b) => a.orderIndex - b.orderIndex
        );

        const painValues = exercises
          .map((exercise) => exercise.pain)
          .filter((value): value is number => value != null && Number.isFinite(value));

        const loggedSets = exercises.flatMap((exercise) =>
          exercise.sets.filter((set) => Number(set.reps ?? 0) > 0)
        );

        const seconds = workoutSeconds(workout);

        return {
          id: workout.id,
          completedAt: workout.completed_at,
          templateName:
            (workout.scheduled_session_id
              ? workoutNameMap.get(workout.scheduled_session_id)
              : null) ?? "Workout",
          workoutSeconds: seconds,
          validDuration: validWorkoutSeconds(seconds),
          bodyweightLb:
            workout.bodyweight_lb != null ? Number(workout.bodyweight_lb) : null,
          proteinTargetG:
            workout.protein_target_g != null
              ? Number(workout.protein_target_g)
              : null,
          painMax: painValues.length ? Math.max(...painValues) : 0,
          painAvg: painValues.length ? average(painValues) : 0,
          volumeTotal: loggedSets.reduce((sum, set) => sum + setVolume(set), 0),
          setsLogged: loggedSets.length,
          postDifficulty: workout.post_difficulty,
          notes: workout.post_notes || workout.notes || null,
          exercises,
        };
      });

      setAllHistory(history);

      const firstExercise = history
        .flatMap((row) => row.exercises)
        .find((exercise) =>
          exercise.sets.some((set) => Number(set.reps ?? 0) > 0)
        );

      setSelectedExerciseId((current) =>
        current &&
        history.some((row) =>
          row.exercises.some((exercise) => exercise.exerciseId === current)
        )
          ? current
          : firstExercise?.exerciseId ?? ""
      );
    } catch (error: any) {
      setErr(error?.message ?? String(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setHistoryVisible(HISTORY_BATCH);
    setDetailId(null);
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  useEffect(() => {
    setHistoryVisible(HISTORY_BATCH);
    setDetailId(null);
  }, [range]);

  const selectedDays = daysForRange(range);

  const currentHistory = useMemo(
    () => filterWindow(allHistory, selectedDays, 0),
    [allHistory, selectedDays]
  );

  const previousHistory = useMemo(
    () => filterWindow(allHistory, selectedDays, 1),
    [allHistory, selectedDays]
  );

  const currentWorkoutIds = useMemo(
    () => new Set(currentHistory.map((row) => row.id)),
    [currentHistory]
  );

  const currentWorkouts = useMemo(
    () => allWorkouts.filter((row) => currentWorkoutIds.has(row.id)),
    [allWorkouts, currentWorkoutIds]
  );

  const exerciseProgress = useMemo<ExerciseProgress[]>(() => {
    const map = new Map<string, ExerciseProgress>();

    for (const workout of allHistory.slice().reverse()) {
      for (const exercise of workout.exercises) {
        const logged = exercise.sets.filter(
          (set) => Number(set.reps ?? 0) > 0
        );
        if (!logged.length) continue;

        const weighted = logged.filter((set) => Number(set.weight ?? 0) > 0);
        const bestSet =
          weighted
            .slice()
            .sort(
              (a, b) =>
                e1rm(Number(b.weight), Number(b.reps)) -
                e1rm(Number(a.weight), Number(a.reps))
            )[0] ??
          logged
            .slice()
            .sort((a, b) => Number(b.reps) - Number(a.reps))[0];

        const rirValues = logged
          .map((set) => set.rir)
          .filter((value): value is number => value != null && Number.isFinite(value));

        const row =
          map.get(exercise.exerciseId) ??
          ({
            id: exercise.exerciseId,
            name: exercise.name,
            primaryMuscles: exercise.primaryMuscles,
            points: [],
          } satisfies ExerciseProgress);

        row.points.push({
          workoutId: workout.id,
          date: workout.completedAt,
          workoutName: workout.templateName,
          bestWeight: bestSet ? Number(bestSet.weight ?? 0) : 0,
          bestReps: bestSet ? Number(bestSet.reps ?? 0) : 0,
          bestE1RM: bestSet
            ? e1rm(Number(bestSet.weight ?? 0), Number(bestSet.reps ?? 0))
            : 0,
          volume: logged.reduce((sum, set) => sum + setVolume(set), 0),
          avgRir: rirValues.length ? average(rirValues) : null,
          pain: exercise.pain,
        });

        map.set(exercise.exerciseId, row);
      }
    }

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [allHistory]);

  const exerciseViews = useMemo<ExerciseView[]>(
    () =>
      exerciseProgress.map((exercise) => {
        const latest = exercise.points.at(-1);
        return {
          ...exercise,
          currentWeight: latest?.bestWeight ?? 0,
          currentReps: latest?.bestReps ?? 0,
          currentE1RM: latest?.bestE1RM ?? 0,
          d7: exerciseChange(exercise.points, 7),
          d14: exerciseChange(exercise.points, 14),
          d30: exerciseChange(exercise.points, 30),
          d365: exerciseChange(exercise.points, 365),
          selectedChange: exerciseChange(exercise.points, selectedDays),
        };
      }),
    [exerciseProgress, selectedDays]
  );

  const selectedExercise = useMemo(
    () =>
      exerciseViews.find((row) => row.id === selectedExerciseId) ??
      exerciseViews[0] ??
      null,
    [exerciseViews, selectedExerciseId]
  );

  const frequency = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const week = new Date(today);
    week.setDate(week.getDate() - week.getDay());
    const month = new Date(now.getFullYear(), now.getMonth(), 1);
    const year = new Date(now.getFullYear(), 0, 1);

    const count = (start: Date) =>
      allHistory.filter((row) => {
        const stamp = ms(row.completedAt);
        return stamp >= start.getTime() && stamp <= now.getTime();
      }).length;

    const thisWeek = count(week);
    const thisMonth = count(month);
    const thisYear = count(year);

    const daysIntoYear = Math.max(
      1,
      (now.getTime() - year.getTime()) / 86400000 + 1
    );

    const dateKeys = unique(
      allHistory.map((row) => {
        const date = new Date(row.completedAt);
        if (Number.isNaN(date.getTime())) return "";
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
          2,
          "0"
        )}-${String(date.getDate()).padStart(2, "0")}`;
      })
    )
      .filter(Boolean)
      .map((key) => new Date(`${key}T12:00:00`).getTime())
      .sort((a, b) => b - a);

    let currentStreak = 0;
    if (dateKeys.length) {
      const latest = new Date(dateKeys[0]);
      latest.setHours(0, 0, 0, 0);
      const gap = Math.round(
        (today.getTime() - latest.getTime()) / 86400000
      );

      if (gap <= 1) {
        currentStreak = 1;
        for (let i = 1; i < dateKeys.length; i += 1) {
          const diff = Math.round((dateKeys[i - 1] - dateKeys[i]) / 86400000);
          if (diff === 1) currentStreak += 1;
          else break;
        }
      }
    }

    let longestStreak = 0;
    let running = 0;
    const ascending = dateKeys.slice().sort((a, b) => a - b);

    ascending.forEach((value, index) => {
      if (!index) running = 1;
      else {
        const diff = Math.round((value - ascending[index - 1]) / 86400000);
        running = diff === 1 ? running + 1 : 1;
      }
      longestStreak = Math.max(longestStreak, running);
    });

    return {
      thisWeek,
      thisMonth,
      thisYear,
      avgPerWeek: thisYear / (daysIntoYear / 7),
      currentStreak,
      longestStreak,
    };
  }, [allHistory]);

  const overview = useMemo(() => {
    const durations = currentHistory
      .filter((row) => row.validDuration)
      .map((row) => row.workoutSeconds);

    const totalTime = durations.reduce((sum, value) => sum + value, 0);
    const spanDays =
      selectedDays ??
      (() => {
        const stamps = currentHistory
          .map((row) => ms(row.completedAt))
          .filter(Number.isFinite);
        if (stamps.length < 2) return 7;
        return Math.max(
          7,
          Math.ceil((Math.max(...stamps) - Math.min(...stamps)) / 86400000) + 1
        );
      })();

    const exerciseIds = new Set(
      currentHistory.flatMap((row) =>
        row.exercises.map((exercise) => exercise.exerciseId)
      )
    );

    return {
      workouts: currentHistory.length,
      totalTime,
      avgTime: durations.length ? average(durations) : 0,
      perWeek: currentHistory.length / Math.max(1, spanDays / 7),
      sets: currentHistory.reduce((sum, row) => sum + row.setsLogged, 0),
      exercises: exerciseIds.size,
    };
  }, [currentHistory, selectedDays]);

  const performance = useMemo(() => {
    const improving = exerciseViews.filter(
      (row) => row.selectedChange != null && row.selectedChange > STABLE_PCT
    );
    const declining = exerciseViews.filter(
      (row) => row.selectedChange != null && row.selectedChange < -STABLE_PCT
    );
    const stable = exerciseViews.filter(
      (row) =>
        row.selectedChange != null &&
        Math.abs(row.selectedChange) <= STABLE_PCT
    );

    const volume = currentHistory.reduce((sum, row) => sum + row.volumeTotal, 0);
    const previousVolume = previousHistory.reduce(
      (sum, row) => sum + row.volumeTotal,
      0
    );

    const volumeChange =
      previousVolume > 0 ? ((volume - previousVolume) / previousVolume) * 100 : null;

    const sets = currentHistory.reduce((sum, row) => sum + row.setsLogged, 0);
    const previousSets = previousHistory.reduce((sum, row) => sum + row.setsLogged, 0);

    const setChange =
      previousSets > 0 ? ((sets - previousSets) / previousSets) * 100 : null;

    const periodStart =
      selectedDays == null ? -Infinity : Date.now() - selectedDays * 86400000;

    const records = exerciseViews
      .map((exercise) => {
        const points = exercise.points
          .filter((point) => point.bestWeight > 0)
          .slice()
          .sort((a, b) => ms(a.date) - ms(b.date));

        if (points.length < 2) return null;

        const current =
          selectedDays == null
            ? [points.at(-1)!]
            : points.filter((point) => ms(point.date) >= periodStart);

        const before =
          selectedDays == null
            ? points.slice(0, -1)
            : points.filter((point) => ms(point.date) < periodStart);

        if (!current.length || !before.length) return null;

        const previousBest = Math.max(...before.map((point) => point.bestWeight));
        const currentBest = Math.max(...current.map((point) => point.bestWeight));

        if (currentBest <= previousBest) return null;

        return {
          id: exercise.id,
          name: exercise.name,
          value: formatWeight(currentBest),
        };
      })
      .filter(
        (row): row is { id: string; name: string; value: string } => Boolean(row)
      )
      .slice(0, 4);

    return {
      improving,
      declining,
      stable,
      records,
      volume,
      volumeChange,
      sets,
      setChange,
      avgVolume: currentHistory.length ? volume / currentHistory.length : 0,
    };
  }, [currentHistory, exerciseViews, previousHistory, selectedDays]);

  const quality = useMemo(() => {
    let targetSets = 0;
    let targetHits = 0;
    const rir: number[] = [];

    for (const workout of currentHistory) {
      for (const exercise of workout.exercises) {
        const min = Number(exercise.prescription?.rep_min ?? 0);
        const max = Number(exercise.prescription?.rep_max ?? min);

        for (const set of exercise.sets) {
          const reps = Number(set.reps ?? 0);
          if (set.rir != null && Number.isFinite(Number(set.rir))) {
            rir.push(Number(set.rir));
          }
          if (!(reps > 0) || !(min > 0) || !(max >= min)) continue;
          targetSets += 1;
          if (reps >= min && reps <= max) targetHits += 1;
        }
      }
    }

    const tooEasy = currentWorkouts.filter(
      (workout) => workout.post_difficulty === "too_easy"
    ).length;
    const onTarget = currentWorkouts.filter(
      (workout) => workout.post_difficulty === "just_right"
    ).length;
    const tooHard = currentWorkouts.filter(
      (workout) => workout.post_difficulty === "too_hard"
    ).length;
    const unrated = Math.max(
      0,
      currentWorkouts.length - tooEasy - onTarget - tooHard
    );
    const avgRir = rir.length ? average(rir) : null;

    let status = "Not enough data";
    let tone: Tone = "blue";

    if (currentWorkouts.length) {
      if (tooHard > Math.max(1, currentWorkouts.length * 0.35)) {
        status = "Intensity may be too high";
        tone = "red";
      } else if (
        tooEasy > Math.max(1, currentWorkouts.length * 0.4) ||
        (avgRir != null && avgRir >= 4)
      ) {
        status = "Intensity lighter than target";
        tone = "amber";
      } else {
        status = "Training intensity on target";
        tone = "green";
      }
    }

    return {
      repSuccess: targetSets ? (targetHits / targetSets) * 100 : null,
      avgRir,
      tooEasy,
      onTarget,
      tooHard,
      unrated,
      status,
      tone,
    };
  }, [currentHistory, currentWorkouts]);

  const painViews = useMemo<PainView[]>(() => {
    const map = new Map<
      string,
      { name: string; points: { date: string; pain: number }[] }
    >();

    for (const workout of allHistory.slice().reverse()) {
      for (const exercise of workout.exercises) {
        if (exercise.pain == null || !Number.isFinite(exercise.pain)) continue;
        const row = map.get(exercise.exerciseId) ?? {
          name: exercise.name,
          points: [],
        };
        row.points.push({
          date: workout.completedAt,
          pain: Number(exercise.pain),
        });
        map.set(exercise.exerciseId, row);
      }
    }

    return Array.from(map.entries())
      .map(([id, row]) => ({
        id,
        name: row.name,
        current: row.points.at(-1)?.pain ?? null,
        d7: painChange(row.points, 7),
        d14: painChange(row.points, 14),
        d30: painChange(row.points, 30),
        d365: painChange(row.points, 365),
      }))
      .sort((a, b) => (b.current ?? -1) - (a.current ?? -1));
  }, [allHistory]);

  const muscleViews = useMemo(() => {
    const map = new Map<string, ExerciseView[]>();

    for (const exercise of exerciseViews) {
      const muscles = exercise.primaryMuscles.length
        ? unique(exercise.primaryMuscles.map(prettyMuscle))
        : ["Other"];

      for (const muscle of muscles) {
        const list = map.get(muscle) ?? [];
        list.push(exercise);
        map.set(muscle, list);
      }
    }

    const avg = (rows: ExerciseView[], key: "d7" | "d14" | "d30" | "d365") => {
      const values = rows
        .map((row) => row[key])
        .filter((value): value is number => value != null && Number.isFinite(value));
      return values.length ? average(values) : null;
    };

    return Array.from(map.entries())
      .map(([name, rows]) => ({
        name,
        count: rows.length,
        d7: avg(rows, "d7"),
        d14: avg(rows, "d14"),
        d30: avg(rows, "d30"),
        d365: avg(rows, "d365"),
      }))
      .sort((a, b) => (b.d30 ?? -999) - (a.d30 ?? -999));
  }, [exerciseViews]);

  const recovery = useMemo(() => {
    const allWeights = allHistory
      .filter((row) => row.bodyweightLb != null && Number.isFinite(row.bodyweightLb))
      .slice()
      .sort((a, b) => ms(a.completedAt) - ms(b.completedAt));

    const currentWeights = currentHistory
      .filter((row) => row.bodyweightLb != null && Number.isFinite(row.bodyweightLb))
      .slice()
      .sort((a, b) => ms(a.completedAt) - ms(b.completedAt));

    const latestWeight = allWeights.at(-1)?.bodyweightLb ?? null;
    const firstWeight = currentWeights[0]?.bodyweightLb ?? null;
    const weightChange =
      latestWeight != null && firstWeight != null ? latestWeight - firstWeight : null;

    const pain = currentHistory.flatMap((row) =>
      row.exercises
        .map((exercise) => exercise.pain)
        .filter((value): value is number => value != null && Number.isFinite(value))
    );

    const avgPain = pain.length ? average(pain) : 0;
    const peakPain = pain.length ? Math.max(...pain) : 0;
    const painFlags = pain.filter((value) => value >= 3).length;

    let status = "Recovery clear";
    let tone: Tone = "green";
    if (peakPain >= 5 || painFlags >= 3) {
      status = "Recovery needs attention";
      tone = "red";
    } else if (peakPain >= 3 || painFlags) {
      status = "Monitor recovery";
      tone = "amber";
    }

    return {
      latestWeight,
      weightChange,
      avgPain,
      peakPain,
      painFlags,
      protein:
        latestWeight != null
          ? roundProtein(latestWeight * proteinMultiplier(activeBlock?.goal))
          : null,
      status,
      tone,
    };
  }, [activeBlock?.goal, allHistory, currentHistory]);

  const breakdown = useMemo<WorkoutBreakdown[]>(() => {
    const names = unique([
      ...rotation,
      ...currentHistory.map((row) => row.templateName),
    ]);

    return names
      .map((name) => {
        const current = currentHistory.filter((row) => row.templateName === name);
        const previous = previousHistory.filter((row) => row.templateName === name);

        const volume = current.reduce((sum, row) => sum + row.volumeTotal, 0);
        const prevVolume = previous.reduce((sum, row) => sum + row.volumeTotal, 0);
        const volumeChange =
          prevVolume > 0 ? ((volume - prevVolume) / prevVolume) * 100 : null;

        const avgPain = current.length
          ? average(current.map((row) => row.painAvg))
          : 0;
        const prevPain = previous.length
          ? average(previous.map((row) => row.painAvg))
          : null;

        const times = current
          .filter((row) => row.validDuration)
          .map((row) => row.workoutSeconds);

        return {
          name,
          tone: workoutTone(name),
          workouts: current.length,
          avgTime: times.length ? average(times) : 0,
          volume,
          volumeChange,
          avgPain,
          painChange: prevPain != null ? avgPain - prevPain : null,
        };
      })
      .filter((row) => row.workouts > 0 || rotation.includes(row.name))
      .slice(0, 6);
  }, [currentHistory, previousHistory, rotation]);

  const issues = useMemo<Issue[]>(() => {
    const rows: Issue[] = [];

    if (
      quality.tooEasy > Math.max(1, currentWorkouts.length * 0.4) ||
      (quality.avgRir != null && quality.avgRir >= 4)
    ) {
      rows.push({
        title: "Training intensity looks light",
        detail: `${quality.tooEasy} workout${quality.tooEasy === 1 ? "" : "s"} rated Too Easy in this range.`,
        tone: "amber",
      });
    }

    const risingPain = painViews
      .filter((row) => row.d14 != null && row.d14 >= 1)
      .sort((a, b) => (b.d14 ?? 0) - (a.d14 ?? 0))[0];

    if (risingPain) {
      rows.push({
        title: `${risingPain.name} pain is increasing`,
        detail: `Pain is up ${formatPainDelta(risingPain.d14)} over 14 days.`,
        tone: "red",
      });
    }

    const declining = performance.declining
      .slice()
      .sort((a, b) => (a.selectedChange ?? 0) - (b.selectedChange ?? 0))[0];

    if (declining) {
      rows.push({
        title: `${declining.name} is trending down`,
        detail: `${formatPct(declining.selectedChange)} estimated strength change.`,
        tone: "red",
      });
    }

    if (!rows.length) {
      rows.push({
        title: "No major issues detected",
        detail: "Current workload, pain and performance signals are stable.",
        tone: "green",
      });
    }

    return rows.slice(0, 3);
  }, [currentWorkouts.length, painViews, performance.declining, quality]);

  const recommendations = useMemo<Recommendation[]>(() => {
    const rows: Recommendation[] = [];

    const risingPain = painViews
      .filter((row) => row.d14 != null && row.d14 >= 1)
      .sort((a, b) => (b.d14 ?? 0) - (a.d14 ?? 0))[0];

    if (risingPain) {
      rows.push({
        eyebrow: "WATCH",
        title: risingPain.name,
        body: `Pain has increased ${formatPainDelta(risingPain.d14)} over 14 days.`,
        action: "Hold load progression and reassess after the next workout.",
        tone: "red",
      });
    }

    const eligible = exerciseViews
      .filter((exercise) => {
        const latest = exercise.points.at(-1);
        return (
          exercise.points.length >= 2 &&
          latest?.avgRir != null &&
          latest.avgRir >= 3 &&
          (latest.pain ?? 0) <= 1 &&
          latest.bestWeight > 0
        );
      })
      .sort(
        (a, b) =>
          (b.points.at(-1)?.avgRir ?? 0) - (a.points.at(-1)?.avgRir ?? 0)
      )[0];

    if (eligible) {
      const latest = eligible.points.at(-1)!;
      rows.push({
        eyebrow: "PRIORITY",
        title: eligible.name,
        body: `${formatWeight(latest.bestWeight)} with ${latest.avgRir?.toFixed(1)} average RIR and controlled pain.`,
        action: "If the programmed rep target is met, consider the next small load increase.",
        tone: "green",
      });
    }

    if (
      quality.tooEasy > Math.max(1, currentWorkouts.length * 0.4) ||
      (quality.avgRir != null && quality.avgRir >= 4)
    ) {
      rows.push({
        eyebrow: "PROGRAM",
        title: "Increase training stimulus",
        body: `${quality.tooEasy} workout${quality.tooEasy === 1 ? "" : "s"} rated Too Easy.`,
        action: "Progress eligible exercises instead of adding unnecessary extra work.",
        tone: "amber",
      });
    }

    const improver = performance.improving
      .slice()
      .sort((a, b) => (b.selectedChange ?? 0) - (a.selectedChange ?? 0))[0];

    if (improver && rows.length < 3) {
      rows.push({
        eyebrow: "PROGRESS",
        title: improver.name,
        body: `${formatPct(improver.selectedChange)} estimated strength change.`,
        action: "Keep the current progression pattern while reps and pain stay controlled.",
        tone: "blue",
      });
    }

    if (!rows.length) {
      rows.push({
        eyebrow: "COACH",
        title: "Build the next trend",
        body: "More repeated exercise data is needed for a confident progression call.",
        action: "Keep logging weight, reps, RIR and pain on every workout.",
        tone: "blue",
      });
    }

    return rows.slice(0, 3);
  }, [currentWorkouts.length, exerciseViews, painViews, performance.improving, quality]);

  const selectedDetail = useMemo(() => {
    if (!selectedExercise) return null;
    const latest = selectedExercise.points.at(-1);
    const d30 = selectedExercise.d30;

    let status = "Baseline established";
    let tone: Tone = "blue";
    let detail = "Complete this exercise again to begin measuring progression.";

    if (selectedExercise.points.length >= 2) {
      if (d30 != null && d30 > STABLE_PCT) {
        status = "Trending up";
        tone = "green";
        detail = `Estimated strength is ${formatPct(d30)} over 30 days.`;
      } else if (d30 != null && d30 < -STABLE_PCT) {
        status = "Trending down";
        tone = "red";
        detail = `Estimated strength is ${formatPct(d30)} over 30 days.`;
      } else {
        status = "Stable";
        tone = "blue";
        detail = "Strength is holding within a narrow range.";
      }
    }

    let coach = "Keep logging this exercise to build a stronger trend.";
    if ((latest?.pain ?? 0) >= 3) {
      coach = "Hold load progression while pain is elevated.";
    } else if (
      selectedExercise.points.length >= 2 &&
      latest?.avgRir != null &&
      latest.avgRir >= 3 &&
      (latest.pain ?? 0) <= 1
    ) {
      coach = "If the rep target is met, this exercise may be ready for the next small load increase.";
    } else if (selectedExercise.points.length >= 2) {
      coach = "Keep the current load until reps or estimated strength clearly improve.";
    }

    return { latest, status, tone, detail, coach };
  }, [selectedExercise]);

  const biggestMuscle =
    muscleViews.find((row) => row.d30 != null && row.d30 > 0) ?? null;
  const highestPain = painViews[0] ?? null;
  const bestPain = painViews
    .filter((row) => row.d30 != null)
    .slice()
    .sort((a, b) => (a.d30 ?? 0) - (b.d30 ?? 0))[0] ?? null;

  const visibleHistory = currentHistory.slice(0, historyVisible);
  const detailWorkout = allHistory.find((row) => row.id === detailId) ?? null;

  const programTitle =
    scope === "all"
      ? "All Programs"
      : activeBlock
        ? `Foundation • ${goalLabel(activeBlock.goal)}`
        : "No Active Program";

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
      await loadAll();
      setToast("Workout logs cleared.");
    } catch (error: any) {
      setErr(error?.message ?? String(error));
    } finally {
      setClearBusy(false);
    }
  }

  const selectedStrengthChanges = exerciseViews
    .map((row) => row.selectedChange)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const overallStrengthTrend = selectedStrengthChanges.length
    ? average(selectedStrengthChanges)
    : null;
  const pain30Values = painViews
    .map((row) => row.d30)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const overallPainTrend = pain30Values.length ? average(pain30Values) : null;

  return (
    <div className="pr-page">
      <section className="pr-surface pr-hero">
        <div>
          <h1>Progress</h1>
          <div className="pr-program">{programTitle}</div>
          {scope === "active" && rotation.length ? (
            <div className="pr-rotation">
              {rotation.slice(0, 4).map((name, index) => (
                <span key={`${name}-${index}`}>
                  <b className={`is-${workoutTone(name)}`}>{name}</b>
                  {index < Math.min(rotation.length, 4) - 1 ? <i>→</i> : null}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="pr-heroControls">
          <ProDropdown
            ariaLabel="Program"
            value={scope}
            options={[
              { value: "active", label: "Current Program" },
              { value: "all", label: "All Programs" },
            ]}
            onChange={(value) => setScope(value as Scope)}
          />

          <ProDropdown
            ariaLabel="Range"
            value={String(range)}
            options={[
              { value: "7", label: "7 Days" },
              { value: "14", label: "14 Days" },
              { value: "30", label: "30 Days" },
              { value: "90", label: "90 Days" },
              { value: "365", label: "1 Year" },
              { value: "all", label: "All Time" },
            ]}
            onChange={(value) =>
              setRange(value === "all" ? "all" : (Number(value) as Range))
            }
          />
        </div>
      </section>

      {toast ? <div className="pr-toast">{toast}</div> : null}
      {err ? <div className="pr-error">{err}</div> : null}

      <section className="pr-surface pr-section">
        <SectionTitle
          title="Coach Recommendations"
          subtitle="The most important actions from your current training data."
        />
        <div className="pr-coachList">
          {recommendations.map((item, index) => (
            <article
              className={`pr-coachRow is-${item.tone}`}
              key={`${item.title}-${index}`}
            >
              <div className="pr-coachIcon">
                <SvgIcon name="coach" size={22} />
              </div>
              <div className="pr-coachCopy">
                <span>{item.eyebrow}</span>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </div>
              <strong className="pr-coachAction">{item.action}</strong>
            </article>
          ))}
        </div>
      </section>

      <section className="pr-surface pr-section">
        <SectionTitle
          title="Training Frequency"
          subtitle="Your workout consistency across the calendar."
        />
        <div className="pr-majorRail pr-three">
          <div>
            <span>This Week</span>
            <strong>{loading ? "—" : frequency.thisWeek}</strong>
            <small>Workouts</small>
          </div>
          <div>
            <span>This Month</span>
            <strong>{loading ? "—" : frequency.thisMonth}</strong>
            <small>Workouts</small>
          </div>
          <div>
            <span>This Year</span>
            <strong>{loading ? "—" : frequency.thisYear}</strong>
            <small>Workouts</small>
          </div>
        </div>
        <div className="pr-minorRail pr-three">
          <div>
            <span>Avg / Week YTD</span>
            <strong>{loading ? "—" : frequency.avgPerWeek.toFixed(1)}</strong>
          </div>
          <div>
            <span>Current Streak</span>
            <strong>{loading ? "—" : `${frequency.currentStreak} Days`}</strong>
          </div>
          <div>
            <span>Longest Streak</span>
            <strong>{loading ? "—" : `${frequency.longestStreak} Days`}</strong>
          </div>
        </div>
      </section>

      <section className="pr-surface pr-section">
        <SectionTitle
          title="Training Overview"
          subtitle={`${rangeLabel(range)} at a glance.`}
        />
        <div className="pr-majorRail pr-four">
          <div>
            <span>Workouts</span>
            <strong>{overview.workouts}</strong>
          </div>
          <div>
            <span>Training Time</span>
            <strong>{formatDuration(overview.totalTime)}</strong>
          </div>
          <div>
            <span>Avg Workout</span>
            <strong>{formatDuration(overview.avgTime)}</strong>
          </div>
          <div>
            <span>Workouts / Week</span>
            <strong>{overview.perWeek.toFixed(1)}</strong>
          </div>
        </div>
        <div className="pr-minorRail pr-three">
          <div>
            <span>Sets Logged</span>
            <strong>{overview.sets}</strong>
          </div>
          <div>
            <span>Exercises Trained</span>
            <strong>{overview.exercises}</strong>
          </div>
          <div>
            <span>Current Streak</span>
            <strong>{frequency.currentStreak} Days</strong>
          </div>
        </div>
      </section>

      <section className="pr-surface pr-section">
        <SectionTitle
          title="Performance"
          subtitle="Whether strength and workload are actually moving forward."
        />

        <div className="pr-majorRail pr-four pr-performanceStatus">
          <div className="is-good">
            <span>Exercises Improving</span>
            <strong>{performance.improving.length}</strong>
          </div>
          <div>
            <span>Stable</span>
            <strong>{performance.stable.length}</strong>
          </div>
          <div className="is-bad">
            <span>Trending Down</span>
            <strong>{performance.declining.length}</strong>
          </div>
          <div className="is-info">
            <span>Personal Records</span>
            <strong>{performance.records.length}</strong>
          </div>
        </div>

        <div className="pr-performanceGrid">
          <div className="pr-chartPanel">
            <div className="pr-chartHead">
              <div>
                <span>Workout Volume</span>
                <strong>{formatVolume(performance.volume)}</strong>
                <small>Total weighted volume</small>
              </div>
              <div className="pr-chartCompare">
                <Delta value={performance.volumeChange} />
                <small>vs {previousLabel(range)}</small>
              </div>
            </div>

            <WorkoutVolumeChart rows={currentHistory} />

            <div className="pr-chartFooter pr-three">
              <div>
                <span>Avg Volume / Workout</span>
                <strong>{formatVolume(performance.avgVolume)}</strong>
              </div>
              <div>
                <span>Working Sets</span>
                <strong>{performance.sets}</strong>
              </div>
              <div>
                <span>Set Change</span>
                <strong><Delta value={performance.setChange} /></strong>
              </div>
            </div>
          </div>

          <div className="pr-highlightStack">
            <div className="pr-highlight">
              <h3><SvgIcon name="trend" size={18} /> Top Progress</h3>
              {performance.improving.length ? (
                performance.improving
                  .slice()
                  .sort(
                    (a, b) =>
                      (b.selectedChange ?? 0) - (a.selectedChange ?? 0)
                  )
                  .slice(0, 3)
                  .map((exercise) => (
                    <div className="pr-highlightRow" key={exercise.id}>
                      <div>
                        <strong>{exercise.name}</strong>
                        <span>{formatWeight(exercise.currentWeight)}</span>
                      </div>
                      <Delta value={exercise.selectedChange} />
                    </div>
                  ))
              ) : (
                <p>More repeated exercise data is needed to rank progress.</p>
              )}
            </div>

            <div className="pr-highlight">
              <h3><SvgIcon name="trophy" size={18} /> Personal Records</h3>
              {performance.records.length ? (
                performance.records.slice(0, 3).map((record) => (
                  <div className="pr-highlightRow" key={record.id}>
                    <div>
                      <strong>{record.name}</strong>
                      <span>Weight PR</span>
                    </div>
                    <b>{record.value}</b>
                  </div>
                ))
              ) : (
                <p>No new weight records in this range yet.</p>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="pr-surface pr-section">
        <SectionTitle
          title="Progress Trends"
          subtitle="The direction of your major training signals."
        />
        <div className="pr-trendIssueGrid">
          <div className="pr-trendGrid">
            <div>
              <span>Strength</span>
              <strong>
                {overallStrengthTrend == null
                  ? "Building Trend"
                  : overallStrengthTrend > STABLE_PCT
                    ? "Improving"
                    : overallStrengthTrend < -STABLE_PCT
                      ? "Declining"
                      : "Stable"}
              </strong>
              <Delta value={overallStrengthTrend} />
            </div>
            <div>
              <span>Workload</span>
              <strong>
                {performance.volumeChange == null
                  ? "Building Trend"
                  : performance.volumeChange > 2
                    ? "Increasing"
                    : performance.volumeChange < -2
                      ? "Decreasing"
                      : "Stable"}
              </strong>
              <Delta value={performance.volumeChange} />
            </div>
            <div>
              <span>Workout Frequency</span>
              <strong>{frequency.avgPerWeek.toFixed(1)} / Week</strong>
              <small>Year to date</small>
            </div>
            <div>
              <span>Effort</span>
              <strong>
                {quality.avgRir == null
                  ? "Building Trend"
                  : quality.avgRir >= 4
                    ? "Too Easy"
                    : quality.avgRir <= 1
                      ? "Very Hard"
                      : "On Target"}
              </strong>
              <small>
                {quality.avgRir == null ? "RIR not established" : `${quality.avgRir.toFixed(1)} avg RIR`}
              </small>
            </div>
            <div>
              <span>Pain</span>
              <strong>
                {overallPainTrend == null
                  ? "Building Trend"
                  : overallPainTrend < -0.2
                    ? "Improving"
                    : overallPainTrend > 0.2
                      ? "Increasing"
                      : "Stable"}
              </strong>
              <Delta value={overallPainTrend} reverse pain />
            </div>
            <div>
              <span>Body Weight</span>
              <strong>
                {recovery.weightChange == null
                  ? "No Change Data"
                  : `${recovery.weightChange > 0 ? "+" : ""}${recovery.weightChange.toFixed(1)} LB`}
              </strong>
              <small>{rangeLabel(range)}</small>
            </div>
          </div>

          <div className="pr-issues">
            <h3>Needs Attention</h3>
            {issues.map((issue, index) => (
              <div className={`pr-issue is-${issue.tone}`} key={`${issue.title}-${index}`}>
                <StatusDot tone={issue.tone} />
                <div>
                  <strong>{issue.title}</strong>
                  <p>{issue.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="pr-surface pr-section">
        <SectionTitle
          title="Muscle Group Progress"
          subtitle="Strength progress normalized across the exercises that train each muscle group."
        />
        {biggestMuscle ? (
          <div className="pr-featureRow is-green">
            <div>
              <span>Biggest 30-Day Gain</span>
              <strong>{biggestMuscle.name}</strong>
            </div>
            <Delta value={biggestMuscle.d30} />
          </div>
        ) : null}

        <div className="pr-tableWrap pr-muscleTableWrap">
          <table className="pr-table">
            <thead>
              <tr>
                <th>Muscle Group</th>
                <th>Exercises</th>
                <th>7D</th>
                <th>14D</th>
                <th>30D</th>
                <th>1Y</th>
              </tr>
            </thead>
            <tbody>
              {muscleViews.length ? (
                muscleViews.map((row) => (
                  <tr key={row.name}>
                    <td><strong>{row.name}</strong></td>
                    <td>{row.count}</td>
                    <td><Delta value={row.d7} /></td>
                    <td><Delta value={row.d14} /></td>
                    <td><Delta value={row.d30} /></td>
                    <td><Delta value={row.d365} /></td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={6} className="pr-emptyCell">More repeated exercise data is needed.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="pr-surface pr-section pr-exerciseSection">
        <SectionTitle
          title="Exercise Progress"
          subtitle="Current working weight and change across 7 days, 14 days, 30 days and 1 year."
          right={
            exerciseViews.length ? (
              <ProDropdown
                ariaLabel="Choose exercise"
                className="pr-exerciseDropdown"
                value={selectedExercise?.id ?? ""}
                options={exerciseViews.map((exercise) => ({
                  value: exercise.id,
                  label: exercise.name,
                }))}
                onChange={setSelectedExerciseId}
              />
            ) : null
          }
        />

        <div className="pr-tableWrap pr-scrollTable">
          <table className="pr-table pr-exerciseTable">
            <thead>
              <tr>
                <th>Exercise</th>
                <th>Current</th>
                <th>7D</th>
                <th>14D</th>
                <th>30D</th>
                <th>1Y</th>
                <th>Trend</th>
              </tr>
            </thead>
            <tbody>
              {exerciseViews.length ? (
                exerciseViews.map((row) => {
                  const trend =
                    row.d30 == null
                      ? "Baseline"
                      : row.d30 > STABLE_PCT
                        ? "Improving"
                        : row.d30 < -STABLE_PCT
                          ? "Declining"
                          : "Stable";
                  return (
                    <tr
                      key={row.id}
                      className={row.id === selectedExercise?.id ? "is-selected" : ""}
                      onClick={() => setSelectedExerciseId(row.id)}
                    >
                      <td>
                        <strong>{row.name}</strong>
                        <small>{row.primaryMuscles.slice(0, 2).join(" • ") || "General"}</small>
                      </td>
                      <td><b>{formatWeight(row.currentWeight)}</b></td>
                      <td><Delta value={row.d7} /></td>
                      <td><Delta value={row.d14} /></td>
                      <td><Delta value={row.d30} /></td>
                      <td><Delta value={row.d365} /></td>
                      <td>
                        <span className={`pr-trendWord is-${trend.toLowerCase()}`}>{trend}</span>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr><td colSpan={7} className="pr-emptyCell">Exercise progress will appear after workouts are logged.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {selectedExercise && selectedDetail ? (
          <div className="pr-exerciseDetail">
            <div className="pr-exerciseDetailHead">
              <div>
                <span>{selectedExercise.primaryMuscles.join(" • ") || "Exercise"}</span>
                <h3>{selectedExercise.name}</h3>
              </div>
              <div className={`pr-trendState is-${selectedDetail.tone}`}>
                <StatusDot tone={selectedDetail.tone} />
                <div>
                  <strong>{selectedDetail.status}</strong>
                  <span>{selectedDetail.detail}</span>
                </div>
              </div>
            </div>

            {selectedExercise.points.length < 2 ? (
              <div className="pr-baseline">
                <div>
                  <span>Working Weight</span>
                  <strong>{formatWeight(selectedDetail.latest?.bestWeight)}</strong>
                </div>
                <div>
                  <span>Best Set</span>
                  <strong>{selectedDetail.latest?.bestReps ? `${selectedDetail.latest.bestReps} Reps` : "—"}</strong>
                </div>
                <div>
                  <span>Workouts Logged</span>
                  <strong>{selectedExercise.points.length}</strong>
                </div>
                <p>Complete this exercise again to begin measuring progression.</p>
              </div>
            ) : (
              <>
                <div className="pr-exerciseStats pr-six">
                  <div><span>Current</span><strong>{formatWeight(selectedExercise.currentWeight)}</strong></div>
                  <div><span>Est. Strength</span><strong>{formatWeight(selectedExercise.currentE1RM)}</strong></div>
                  <div><span>7D</span><strong><Delta value={selectedExercise.d7} /></strong></div>
                  <div><span>14D</span><strong><Delta value={selectedExercise.d14} /></strong></div>
                  <div><span>30D</span><strong><Delta value={selectedExercise.d30} /></strong></div>
                  <div><span>1Y</span><strong><Delta value={selectedExercise.d365} /></strong></div>
                </div>

                <div className="pr-strengthTimeline">
                  {(() => {
                    const points = selectedExercise.points
                      .filter((point) => point.bestE1RM > 0)
                      .slice(-10);
                    const max = Math.max(1, ...points.map((point) => point.bestE1RM));
                    return points.map((point) => (
                      <div key={point.workoutId}>
                        <b>{formatNumber(point.bestE1RM, 0)}</b>
                        <span
                          className={`is-${workoutTone(point.workoutName)}`}
                          style={{ height: `${Math.max(10, (point.bestE1RM / max) * 100)}%` }}
                        />
                        <small>{shortDate(point.date)}</small>
                      </div>
                    ));
                  })()}
                </div>
              </>
            )}

            <div className="pr-exerciseCoach">
              <SvgIcon name="coach" size={19} />
              <div>
                <span>Coach</span>
                <strong>{selectedDetail.coach}</strong>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <section className="pr-surface pr-section">
        <SectionTitle
          title="Training Quality"
          subtitle="Rep execution and workout effort relative to the program."
        />
        <div className="pr-qualityStatus">
          <StatusDot tone={quality.tone} />
          <strong>{quality.status}</strong>
        </div>
        <div className="pr-qualityGrid pr-six">
          <div><span>Rep Range Success</span><strong>{quality.repSuccess == null ? "—" : `${Math.round(quality.repSuccess)}%`}</strong></div>
          <div><span>Average Effort</span><strong>{quality.avgRir == null ? "—" : `${quality.avgRir.toFixed(1)} RIR`}</strong></div>
          <div className="is-amber"><span>Too Easy</span><strong>{quality.tooEasy}</strong></div>
          <div className="is-green"><span>On Target</span><strong>{quality.onTarget}</strong></div>
          <div className="is-red"><span>Too Hard</span><strong>{quality.tooHard}</strong></div>
          <div><span>Not Rated</span><strong>{quality.unrated}</strong></div>
        </div>
      </section>

      <section className="pr-surface pr-section">
        <SectionTitle
          title="Pain & Recovery"
          subtitle="Current recovery status plus pain changes by exercise."
        />

        <div className="pr-recoveryGrid">
          <div className="pr-weightCard">
            <SvgIcon name="weight" size={28} />
            <div>
              <span>Body Weight</span>
              <strong>{recovery.latestWeight == null ? "—" : `${recovery.latestWeight.toFixed(1)} LB`}</strong>
              <small>
                {recovery.weightChange == null
                  ? "No range comparison"
                  : `${recovery.weightChange > 0 ? "+" : ""}${recovery.weightChange.toFixed(1)} LB • ${rangeLabel(range)}`}
              </small>
            </div>
          </div>

          <div className="pr-recoveryMetrics pr-four">
            <div><span>Protein Target</span><strong>{recovery.protein == null ? "—" : `${recovery.protein} G`}</strong></div>
            <div><span>Avg Pain</span><strong>{recovery.avgPain.toFixed(1)}</strong></div>
            <div><span>Peak Pain</span><strong>{recovery.peakPain}</strong></div>
            <div><span>Pain Flags</span><strong>{recovery.painFlags}</strong></div>
          </div>

          <div className={`pr-recoveryState is-${recovery.tone}`}>
            <StatusDot tone={recovery.tone} />
            <strong>{recovery.status}</strong>
          </div>
        </div>

        <div className="pr-painHighlights pr-three">
          <div>
            <span>Highest Current Pain</span>
            <strong>{highestPain?.name ?? "None"}</strong>
            <b>{highestPain?.current == null ? "—" : highestPain.current.toFixed(1)}</b>
          </div>
          <div>
            <span>Biggest 30-Day Improvement</span>
            <strong>{bestPain?.name ?? "Not Enough Data"}</strong>
            <b>{bestPain?.d30 == null ? "—" : <Delta value={bestPain.d30} reverse pain />}</b>
          </div>
          <div>
            <span>Pain Trending Up</span>
            <strong>{painViews.filter((row) => (row.d30 ?? 0) > 0.5).length} Exercises</strong>
          </div>
        </div>

        <div className="pr-tableWrap pr-scrollTable pr-painTableWrap">
          <table className="pr-table">
            <thead>
              <tr>
                <th>Exercise</th>
                <th>Current</th>
                <th>7D</th>
                <th>14D</th>
                <th>30D</th>
                <th>1Y</th>
              </tr>
            </thead>
            <tbody>
              {painViews.length ? (
                painViews.map((row) => (
                  <tr key={row.id}>
                    <td><strong>{row.name}</strong></td>
                    <td>{row.current == null ? "—" : row.current.toFixed(1)}</td>
                    <td><Delta value={row.d7} reverse pain /></td>
                    <td><Delta value={row.d14} reverse pain /></td>
                    <td><Delta value={row.d30} reverse pain /></td>
                    <td><Delta value={row.d365} reverse pain /></td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={6} className="pr-emptyCell">Pain trends will appear after exercise pain is logged.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="pr-surface pr-section">
        <SectionTitle
          title="Workout Breakdown"
          subtitle="Upper 1, Upper 2, Lower 1 and Lower 2 stay visually distinct."
          right={
            <button
              type="button"
              className="pr-breakdownButton"
              onClick={() => setShowBreakdown((value) => !value)}
            >
              {showBreakdown ? "Hide Breakdown" : "View Breakdown"}
              <SvgIcon name="chevron" size={16} />
            </button>
          }
        />

        {showBreakdown ? (
          <div className="pr-workoutGrid">
            {breakdown.map((row) => (
              <article className={`pr-workoutCard is-${row.tone}`} key={row.name}>
                <div className="pr-workoutTitle">
                  <i />
                  <h3>{row.name}</h3>
                </div>
                <div className="pr-workoutStats pr-four">
                  <div><span>Workouts</span><strong>{row.workouts}</strong></div>
                  <div><span>Avg Time</span><strong>{formatDuration(row.avgTime)}</strong></div>
                  <div><span>Volume</span><strong>{formatVolume(row.volume)}</strong><Delta value={row.volumeChange} /></div>
                  <div><span>Avg Pain</span><strong>{row.avgPain.toFixed(1)}</strong><Delta value={row.painChange} reverse pain /></div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="pr-workoutPreview pr-four">
            {breakdown.slice(0, 4).map((row) => (
              <div className={`is-${row.tone}`} key={row.name}>
                <i />
                <strong>{row.name}</strong>
                <small>{row.workouts} Workouts</small>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="pr-surface pr-section">
        <SectionTitle
          title="Recent Workouts"
          subtitle={`Showing ${Math.min(historyVisible, currentHistory.length)} of ${currentHistory.length} workouts`}
          right={
            <button type="button" className="pr-clearButton" onClick={() => setClearOpen(true)}>
              Clear Logs
            </button>
          }
        />

        <div className="pr-historyList">
          {visibleHistory.length ? (
            visibleHistory.map((row) => (
              <article className={`pr-historyRow is-${workoutTone(row.templateName)}`} key={row.id}>
                <i className="pr-historyAccent" />
                <div className="pr-historyName">
                  <h3>{row.templateName}</h3>
                  <time>{formatDate(row.completedAt)}</time>
                  <p>{row.exercises.slice(0, 6).map((exercise) => exercise.name).join(" • ") || "No exercises recorded"}</p>
                </div>
                <div className="pr-historyMetrics">
                  <div><span>Time</span><strong>{formatDuration(row.workoutSeconds)}</strong></div>
                  <div><span>Exercises</span><strong>{row.exercises.length}</strong></div>
                  <div><span>Sets</span><strong>{row.setsLogged}</strong></div>
                  <div><span>Volume</span><strong>{formatVolume(row.volumeTotal)}</strong></div>
                  <div><span>Pain</span><strong>{row.painMax}</strong></div>
                </div>
                <button type="button" className="pr-viewButton" onClick={() => setDetailId(row.id)}>View ›</button>
              </article>
            ))
          ) : (
            <div className="pr-empty">No completed workouts in this range.</div>
          )}
        </div>

        {historyVisible < currentHistory.length ? (
          <div className="pr-loadMore">
            <span>Showing {historyVisible} of {currentHistory.length}</span>
            <button
              type="button"
              onClick={() =>
                setHistoryVisible((value) =>
                  Math.min(currentHistory.length, value + HISTORY_BATCH)
                )
              }
            >
              Load 5 More
            </button>
          </div>
        ) : null}
      </section>

      {detailWorkout ? (
        <div className="pr-overlay" onMouseDown={(event: any) => {
          if (event.target === event.currentTarget) setDetailId(null);
        }}>
          <section className="pr-detailModal" role="dialog" aria-modal="true">
            <div className="pr-modalHead">
              <div>
                <span>{formatDate(detailWorkout.completedAt)}</span>
                <h2>{detailWorkout.templateName}</h2>
              </div>
              <button type="button" onClick={() => setDetailId(null)}>×</button>
            </div>

            <div className="pr-modalSummary pr-four">
              <div><span>Time</span><strong>{formatDuration(detailWorkout.workoutSeconds)}</strong></div>
              <div><span>Volume</span><strong>{formatVolume(detailWorkout.volumeTotal)}</strong></div>
              <div><span>Body Weight</span><strong>{formatWeight(detailWorkout.bodyweightLb)}</strong></div>
              <div><span>Peak Pain</span><strong>{detailWorkout.painMax}</strong></div>
            </div>

            <div className="pr-detailExercises">
              {detailWorkout.exercises.map((exercise) => (
                <div className="pr-detailExercise" key={exercise.workoutExerciseId}>
                  <div>
                    <strong>{exercise.name}</strong>
                    <span>{exercise.primaryMuscles.join(" • ") || "Exercise"}</span>
                  </div>
                  <div className="pr-setList">
                    {exercise.sets.length ? (
                      exercise.sets.map((set) => (
                        <span key={set.set_index}>
                          <b>SET {set.set_index}</b>
                          {Number(set.weight ?? 0) > 0 ? `${formatNumber(Number(set.weight))} LB × ${set.reps}` : `${set.reps} REPS`}
                          {set.rir != null ? ` • ${set.rir} RIR` : ""}
                        </span>
                      ))
                    ) : (
                      <em>No sets recorded.</em>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {clearOpen ? (
        <div className="pr-overlay">
          <section className="pr-clearModal" role="dialog" aria-modal="true">
            <h2>Clear all workout logs?</h2>
            <p>This permanently deletes your completed workout history. Type CLEAR to confirm.</p>
            <input
              value={clearText}
              onChange={(event: any) => setClearText(event.target.value)}
              placeholder="Type CLEAR"
              autoFocus
            />
            <div>
              <button type="button" onClick={() => {
                setClearOpen(false);
                setClearText("");
              }}>Cancel</button>
              <button
                type="button"
                className="is-danger"
                disabled={clearText.trim().toUpperCase() !== "CLEAR" || clearBusy}
                onClick={() => void clearLogs()}
              >
                {clearBusy ? "Clearing…" : "Clear Logs"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <style>{`
        .pr-page{
          --cyan:#52cef4;
          --green:#55dfa2;
          --red:#ff7474;
          --amber:#efa94f;
          --text:#f4f9fb;
          --muted:rgba(202,220,229,.62);
          display:grid;
          gap:12px;
          padding-bottom:34px;
          color:var(--text);
        }
        .pr-page *{box-sizing:border-box}
        .pr-page button,.pr-page input{font:inherit}
        .pr-surface{
          position:relative;
          isolation:isolate;
          overflow:visible;
          border:1px solid rgba(133,199,222,.13);
          border-top-color:rgba(197,234,247,.23);
          border-radius:16px;
          background:linear-gradient(180deg,#101d25,#091218 58%,#060c11);
          box-shadow:0 1px 0 rgba(255,255,255,.035),0 5px 8px rgba(0,0,0,.30),0 18px 40px rgba(0,0,0,.18),inset 0 1px 0 rgba(255,255,255,.035);
        }
        .pr-surface:has(.pr-dropdownTrigger.is-open){z-index:300}
        .pr-hero{z-index:40;padding:20px;display:flex;align-items:center;justify-content:space-between;gap:20px}
        .pr-hero h1{margin:0;color:#fff;font-size:clamp(40px,5vw,56px);line-height:.9;font-weight:1000;letter-spacing:-.055em}
        .pr-program{margin-top:10px;color:#edf8fb;font-size:18px;font-weight:1000}
        .pr-rotation{display:flex;flex-wrap:wrap;gap:7px 10px;margin-top:8px;font-size:10px;font-weight:1000}
        .pr-rotation span{display:inline-flex;align-items:center;gap:10px}
        .pr-rotation i{color:rgba(79,198,239,.40);font-style:normal}
        .is-upper1{color:#78a7ff!important}.is-upper2{color:#6ae5e9!important}.is-lower1{color:#74e4ad!important}.is-lower2{color:#f0bd77!important}
        .pr-heroControls{display:flex;gap:9px}
        .pr-dropdown{position:relative;z-index:50;min-width:165px}
        .pr-dropdownTrigger{width:100%;min-height:43px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 12px;border:1px solid rgba(127,198,222,.20);border-top-color:rgba(190,230,244,.28);border-radius:9px;color:#f4fafc;background:linear-gradient(180deg,#172731,#091116);box-shadow:0 2px 4px rgba(0,0,0,.34),inset 0 1px 0 rgba(255,255,255,.04);font-size:11px;font-weight:950;cursor:pointer}
        .pr-dropdownTrigger:hover,.pr-dropdownTrigger.is-open{border-color:rgba(82,206,244,.55)}
        .pr-dropdownTrigger .pr-icon{color:var(--cyan);transition:transform .14s ease}.pr-dropdownTrigger.is-open .pr-icon{transform:rotate(180deg)}
        .pr-dropdownMenu{position:absolute;z-index:9999;top:calc(100% + 7px);left:0;right:0;max-height:310px;overflow:auto;padding:5px;border:1px solid rgba(110,191,222,.31);border-top-color:rgba(190,231,246,.40);border-radius:11px;background:#071017;box-shadow:0 22px 58px rgba(0,0,0,.76)}
        .pr-dropdownOption{width:100%;min-height:40px;display:flex;align-items:center;justify-content:space-between;padding:0 10px;border:0;border-radius:7px;color:rgba(231,242,248,.80);background:transparent;font-size:10px;font-weight:900;text-align:left;cursor:pointer}
        .pr-dropdownOption:hover{color:#fff;background:rgba(48,166,207,.13)}
        .pr-dropdownOption.is-selected{color:#fff;background:linear-gradient(90deg,rgba(30,145,187,.18),rgba(14,64,85,.06))}
        .pr-dropdownOption i{width:3px;height:18px;border-radius:3px;background:var(--cyan)}
        .pr-icon{fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
        .pr-section{padding:17px}
        .pr-sectionTitle{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:14px}
        .pr-sectionTitleText{display:flex;gap:10px}.pr-sectionAccent{width:3px;height:36px;border-radius:3px;background:linear-gradient(180deg,#88e5ff,#159fda);box-shadow:0 0 9px rgba(53,190,238,.18)}
        .pr-sectionTitle h2{margin:0;color:#fff;font-size:24px;line-height:1;font-weight:1000;letter-spacing:-.035em}
        .pr-sectionTitle p{margin:5px 0 0;color:var(--muted);font-size:9px;line-height:1.4;font-weight:760}
        .pr-toast,.pr-error{padding:10px 12px;border-radius:9px;font-size:10px;font-weight:900}.pr-toast{color:#c7f3d9;border:1px solid rgba(85,223,162,.17);background:rgba(30,94,64,.13)}.pr-error{color:#ffd0d0;border:1px solid rgba(255,116,116,.20);background:rgba(110,33,33,.16)}
        .pr-majorRail,.pr-minorRail,.pr-chartFooter,.pr-qualityGrid,.pr-recoveryMetrics,.pr-painHighlights,.pr-workoutPreview,.pr-workoutStats,.pr-modalSummary,.pr-exerciseStats{display:grid}
        .pr-three{grid-template-columns:repeat(3,minmax(0,1fr))}.pr-four{grid-template-columns:repeat(4,minmax(0,1fr))}.pr-six{grid-template-columns:repeat(6,minmax(0,1fr))}
        .pr-majorRail{border-top:1px solid rgba(130,194,217,.10);border-bottom:1px solid rgba(130,194,217,.08)}
        .pr-majorRail>div{padding:15px;min-width:0}.pr-majorRail>div+div{border-left:1px solid rgba(132,195,218,.10)}
        .pr-majorRail span,.pr-minorRail span,.pr-chartHead span,.pr-chartFooter span,.pr-trendGrid span,.pr-qualityGrid span,.pr-recoveryMetrics span,.pr-weightCard span,.pr-painHighlights span,.pr-exerciseStats span,.pr-baseline span,.pr-modalSummary span{display:block;color:rgba(179,207,219,.62);font-size:8px;line-height:1;font-weight:1000;text-transform:uppercase;letter-spacing:.075em}
        .pr-majorRail strong{display:block;margin-top:8px;color:#fff;font-size:clamp(28px,3vw,38px);line-height:.92;font-weight:1000;letter-spacing:-.045em}
        .pr-majorRail small{display:block;margin-top:6px;color:rgba(187,210,220,.54);font-size:8px;font-weight:850}
        .pr-performanceStatus .is-good strong{color:#7be9b4}.pr-performanceStatus .is-bad strong{color:#ff9999}.pr-performanceStatus .is-info strong{color:#82def9}
        .pr-minorRail{margin-top:10px}.pr-minorRail>div{padding:9px 12px;border-left:2px solid rgba(72,193,235,.27);background:linear-gradient(90deg,rgba(31,84,104,.10),transparent 88%)}.pr-minorRail strong{display:block;margin-top:5px;color:#eff8fb;font-size:14px;font-weight:1000}
        .pr-coachList{display:grid;gap:7px}.pr-coachRow{display:grid;grid-template-columns:40px minmax(0,1fr) minmax(220px,.75fr);align-items:center;gap:13px;padding:12px 13px;border-left:2px solid rgba(82,206,244,.4);background:linear-gradient(90deg,rgba(34,92,114,.10),transparent 84%)}.pr-coachRow.is-green{border-left-color:var(--green)}.pr-coachRow.is-amber{border-left-color:var(--amber)}.pr-coachRow.is-red{border-left-color:var(--red)}
        .pr-coachIcon{width:38px;height:38px;display:grid;place-items:center;border:1px solid rgba(82,199,240,.16);border-radius:10px;color:#79daf8;background:#0b1a22}.pr-coachCopy span{color:#80d9f6;font-size:7px;font-weight:1000;letter-spacing:.12em}.pr-coachCopy h3{margin:5px 0 4px;color:#fff;font-size:15px;font-weight:1000}.pr-coachCopy p{margin:0;color:rgba(208,224,232,.64);font-size:9px;line-height:1.4}.pr-coachAction{color:#eef8fb;font-size:10px;line-height:1.4}
        .pr-delta{display:inline-flex;color:rgba(204,219,226,.62);font-size:11px;font-weight:1000}.pr-delta.is-positive{color:#63e4a4}.pr-delta.is-negative{color:#ff8787}
        .pr-performanceGrid{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(280px,.75fr);gap:11px;margin-top:11px}
        .pr-chartPanel,.pr-exerciseDetail,.pr-issues{padding:14px;border:1px solid rgba(126,192,216,.11);border-top-color:rgba(181,225,240,.17);border-radius:13px;background:linear-gradient(180deg,#0d1921,#071016)}
        .pr-chartHead{display:flex;justify-content:space-between;gap:14px}.pr-chartHead strong{display:block;margin-top:6px;color:#fff;font-size:27px;font-weight:1000}.pr-chartHead small,.pr-chartCompare small{display:block;margin-top:5px;color:rgba(184,207,217,.54);font-size:8px}.pr-chartCompare{text-align:right}
        .pr-volumeChart{margin-top:14px;overflow-x:auto}.pr-volumeBars{min-width:560px;height:185px;display:flex;align-items:flex-end;gap:9px}.pr-volumeCol{min-width:58px;flex:1;align-self:stretch;display:grid;grid-template-rows:18px 1fr 34px;gap:5px;align-items:end;text-align:center}.pr-volumeCol>b{color:rgba(224,237,243,.70);font-size:7px}.pr-volumeTrack{height:100%;display:flex;align-items:flex-end;justify-content:center;border-bottom:1px solid rgba(134,196,219,.11);background:repeating-linear-gradient(180deg,transparent 0,transparent 27px,rgba(127,188,211,.06) 28px)}.pr-volumeBar{width:58%;min-height:6px;border-radius:4px 4px 1px 1px}.pr-volumeBar.is-upper1{background:linear-gradient(#6ca2ff,#2c65c7)}.pr-volumeBar.is-upper2{background:linear-gradient(#64e7ec,#218f97)}.pr-volumeBar.is-lower1{background:linear-gradient(#73eab2,#28855d)}.pr-volumeBar.is-lower2{background:linear-gradient(#f1bf78,#a96b25)}.pr-volumeBar.is-other{background:linear-gradient(#72d7f6,#27799a)}.pr-volumeCol strong{display:block;overflow:hidden;font-size:7px;white-space:nowrap;text-overflow:ellipsis}.pr-volumeCol small{display:block;margin-top:3px;color:rgba(164,191,203,.46);font-size:6px}
        .pr-chartFooter{margin-top:11px;padding-top:10px;border-top:1px solid rgba(128,191,215,.09)}.pr-chartFooter>div{padding:0 10px}.pr-chartFooter>div+div{border-left:1px solid rgba(130,194,216,.09)}.pr-chartFooter strong{display:block;margin-top:6px;color:#f0f8fb;font-size:13px;font-weight:1000}
        .pr-highlightStack{display:grid;gap:10px}.pr-highlight{padding:13px;border-left:2px solid rgba(72,193,235,.28);background:linear-gradient(90deg,rgba(27,75,94,.10),transparent 90%)}.pr-highlight h3{display:flex;align-items:center;gap:7px;margin:0;color:#84dcf8;font-size:10px;text-transform:uppercase}.pr-highlightRow{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:11px}.pr-highlightRow>div{min-width:0}.pr-highlightRow strong{display:block;overflow:hidden;color:#f1f8fb;font-size:10px;white-space:nowrap;text-overflow:ellipsis}.pr-highlightRow span:not(.pr-delta){display:block;margin-top:3px;color:rgba(182,207,217,.52);font-size:8px}.pr-highlightRow>b{color:#89def8;font-size:10px}.pr-highlight p{margin:10px 0 0;color:rgba(185,207,217,.50);font-size:9px;line-height:1.4}
        .pr-trendIssueGrid{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(280px,.8fr);gap:11px}.pr-trendGrid{display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid rgba(129,193,216,.10);border-bottom:1px solid rgba(129,193,216,.08)}.pr-trendGrid>div{padding:14px}.pr-trendGrid>div:nth-child(2),.pr-trendGrid>div:nth-child(3),.pr-trendGrid>div:nth-child(5),.pr-trendGrid>div:nth-child(6){border-left:1px solid rgba(131,194,216,.09)}.pr-trendGrid>div:nth-child(n+4){border-top:1px solid rgba(131,194,216,.09)}.pr-trendGrid strong{display:block;margin-top:7px;color:#fff;font-size:16px;font-weight:1000}.pr-trendGrid small{display:block;margin-top:5px;color:rgba(182,205,216,.52);font-size:8px}.pr-trendGrid .pr-delta{margin-top:6px}
        .pr-issues h3{margin:0 0 10px;color:#fff;font-size:14px}.pr-issue{display:flex;gap:9px;padding:9px 0}.pr-issue+.pr-issue{border-top:1px solid rgba(127,190,214,.08)}.pr-statusDot{width:8px;height:8px;flex:0 0 8px;margin-top:3px;border-radius:50%;background:var(--cyan);box-shadow:0 0 8px rgba(82,206,244,.2)}.pr-statusDot.is-green{background:var(--green)}.pr-statusDot.is-amber{background:var(--amber)}.pr-statusDot.is-red{background:var(--red)}.pr-issue strong{color:#eef8fb;font-size:10px}.pr-issue p{margin:4px 0 0;color:rgba(188,210,220,.56);font-size:8px;line-height:1.4}
        .pr-featureRow{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;padding:11px 13px;border-left:3px solid var(--green);background:linear-gradient(90deg,rgba(42,118,81,.14),transparent 78%)}.pr-featureRow span{display:block;color:rgba(179,208,219,.59);font-size:8px;text-transform:uppercase;font-weight:1000}.pr-featureRow strong{display:block;margin-top:4px;color:#fff;font-size:19px}.pr-featureRow .pr-delta{font-size:21px}
        .pr-tableWrap{width:100%;overflow:auto;border-top:1px solid rgba(128,193,217,.09);border-bottom:1px solid rgba(128,193,217,.07)}.pr-scrollTable{max-height:420px}.pr-table{width:100%;min-width:650px;border-collapse:collapse}.pr-table th{position:sticky;top:0;z-index:2;padding:10px 11px;color:rgba(174,204,217,.62);background:#0b151c;border-bottom:1px solid rgba(130,193,216,.10);font-size:8px;text-align:right;text-transform:uppercase;letter-spacing:.08em;white-space:nowrap}.pr-table th:first-child{text-align:left}.pr-table td{padding:10px 11px;border-bottom:1px solid rgba(130,193,216,.065);color:rgba(220,234,240,.78);font-size:10px;text-align:right;white-space:nowrap}.pr-table td:first-child{text-align:left}.pr-table tbody tr:hover{background:rgba(42,136,171,.065)}.pr-table td strong{color:#f1f8fb;font-size:10px}.pr-table td small{display:block;margin-top:3px;color:rgba(173,202,214,.47);font-size:7px}.pr-emptyCell{padding:22px!important;text-align:center!important;color:rgba(183,207,217,.52)!important}
        .pr-exerciseTable tr{cursor:pointer}.pr-exerciseTable tr.is-selected{background:linear-gradient(90deg,rgba(31,138,178,.14),rgba(20,74,96,.04));box-shadow:inset 3px 0 0 #4ac9f2}.pr-trendWord{font-size:9px;font-weight:1000}.pr-trendWord.is-improving{color:#69e4aa}.pr-trendWord.is-declining{color:#ff8787}.pr-trendWord.is-stable,.pr-trendWord.is-baseline{color:rgba(207,221,228,.62)}
        .pr-exerciseDropdown{min-width:220px}.pr-exerciseDetail{margin-top:12px}.pr-exerciseDetailHead{display:flex;justify-content:space-between;gap:16px}.pr-exerciseDetailHead>div:first-child>span{color:rgba(168,199,212,.55);font-size:8px}.pr-exerciseDetailHead h3{margin:5px 0 0;color:#fff;font-size:21px}.pr-trendState{display:flex;gap:8px;max-width:310px}.pr-trendState>div{display:grid;gap:3px}.pr-trendState strong{color:#fff;font-size:10px;text-transform:uppercase}.pr-trendState span{color:rgba(188,211,220,.57);font-size:8px;line-height:1.35}
        .pr-baseline,.pr-exerciseStats{display:grid;margin-top:13px;border-top:1px solid rgba(129,193,216,.09);border-bottom:1px solid rgba(129,193,216,.07)}.pr-baseline{grid-template-columns:repeat(3,1fr)}.pr-baseline>div,.pr-exerciseStats>div{padding:13px 12px}.pr-baseline>div+div,.pr-exerciseStats>div+div{border-left:1px solid rgba(130,193,216,.09)}.pr-baseline strong,.pr-exerciseStats strong{display:block;margin-top:6px;color:#fff;font-size:17px}.pr-baseline p{grid-column:1/-1;margin:0;padding:11px 12px;border-top:1px solid rgba(130,193,216,.08);color:rgba(197,216,224,.62);font-size:9px}
        .pr-strengthTimeline{height:150px;display:flex;align-items:flex-end;gap:8px;margin-top:13px;padding-top:8px;border-bottom:1px solid rgba(129,193,216,.09);overflow-x:auto}.pr-strengthTimeline>div{min-width:42px;flex:1;align-self:stretch;display:grid;grid-template-rows:16px 1fr 18px;align-items:end;text-align:center}.pr-strengthTimeline b{color:rgba(222,236,242,.66);font-size:7px}.pr-strengthTimeline>div>span{width:52%;justify-self:center;min-height:7px;border-radius:4px 4px 0 0;background:#52cef4}.pr-strengthTimeline>div>span.is-upper1{background:#4a8cff}.pr-strengthTimeline>div>span.is-upper2{background:#35d2dc}.pr-strengthTimeline>div>span.is-lower1{background:#4ed79b}.pr-strengthTimeline>div>span.is-lower2{background:#e9a54b}.pr-strengthTimeline small{color:rgba(160,189,201,.45);font-size:6px}
        .pr-exerciseCoach{display:flex;gap:9px;margin-top:12px;padding:10px 12px;border-left:2px solid rgba(82,206,244,.42);color:#75d8f7;background:linear-gradient(90deg,rgba(35,105,132,.11),transparent 87%)}.pr-exerciseCoach>div{display:grid;gap:4px}.pr-exerciseCoach span{color:#7bdaf8;font-size:8px;text-transform:uppercase;font-weight:1000}.pr-exerciseCoach strong{color:#eef8fb;font-size:10px;line-height:1.4}
        .pr-qualityStatus{display:flex;align-items:center;gap:8px;margin-bottom:10px;color:#eef8fb;font-size:10px;text-transform:uppercase;font-weight:1000}.pr-qualityGrid{border-top:1px solid rgba(129,193,216,.10);border-bottom:1px solid rgba(129,193,216,.08)}.pr-qualityGrid>div{padding:14px 11px}.pr-qualityGrid>div+div{border-left:1px solid rgba(131,194,216,.09)}.pr-qualityGrid strong{display:block;margin-top:7px;color:#fff;font-size:19px}.pr-qualityGrid .is-amber strong{color:#f3bc79}.pr-qualityGrid .is-green strong{color:#7be7b3}.pr-qualityGrid .is-red strong{color:#ff9696}
        .pr-recoveryGrid{display:grid;grid-template-columns:minmax(220px,.8fr) minmax(0,1.35fr) minmax(180px,.55fr);gap:10px}.pr-weightCard{display:flex;align-items:center;gap:12px;padding:14px;border-left:2px solid rgba(82,206,244,.34);background:linear-gradient(90deg,rgba(33,92,113,.10),transparent 90%);color:#66d3f6}.pr-weightCard>div{display:grid;gap:5px}.pr-weightCard strong{color:#fff;font-size:24px}.pr-weightCard small{color:rgba(189,211,221,.56);font-size:8px}
        .pr-recoveryMetrics{border-top:1px solid rgba(129,193,216,.09);border-bottom:1px solid rgba(129,193,216,.07)}.pr-recoveryMetrics>div{padding:13px 11px}.pr-recoveryMetrics>div+div{border-left:1px solid rgba(130,193,216,.09)}.pr-recoveryMetrics strong{display:block;margin-top:6px;color:#fff;font-size:18px}.pr-recoveryState{display:flex;align-items:center;justify-content:center;gap:8px;padding:12px;border:1px solid rgba(85,223,162,.13);border-radius:10px;background:rgba(36,104,73,.08);text-align:center}.pr-recoveryState.is-amber{border-color:rgba(239,169,79,.15);background:rgba(107,69,23,.08)}.pr-recoveryState.is-red{border-color:rgba(255,116,116,.15);background:rgba(104,35,35,.08)}.pr-recoveryState strong{color:#eef8f2;font-size:9px;text-transform:uppercase}
        .pr-painHighlights{gap:8px;margin:11px 0}.pr-painHighlights>div{padding:10px 12px;border-left:2px solid rgba(82,206,244,.26);background:linear-gradient(90deg,rgba(31,83,102,.09),transparent 90%)}.pr-painHighlights strong{display:block;margin-top:5px;overflow:hidden;color:#edf7fa;font-size:11px;white-space:nowrap;text-overflow:ellipsis}.pr-painHighlights b{display:block;margin-top:5px;color:#fff;font-size:14px}
        .pr-breakdownButton,.pr-clearButton{min-height:35px;display:flex;align-items:center;gap:7px;padding:0 12px;border:1px solid rgba(91,196,233,.18);border-radius:8px;color:#eaf6fa;background:rgba(14,54,70,.18);font-size:9px;font-weight:950;cursor:pointer}.pr-clearButton{border-color:rgba(255,116,116,.22);color:#ffc2c2;background:rgba(92,28,28,.10)}
        .pr-workoutPreview{gap:8px}.pr-workoutPreview>div{position:relative;padding:11px 12px 11px 16px;border:1px solid rgba(127,192,216,.09);border-radius:10px;background:#091218;overflow:hidden}.pr-workoutPreview i,.pr-workoutTitle i,.pr-historyAccent{position:absolute;left:0;top:0;bottom:0;width:3px;background:#52cef4}.pr-workoutPreview .is-upper1 i,.pr-workoutCard.is-upper1 i,.pr-historyRow.is-upper1 .pr-historyAccent{background:#4a8cff}.pr-workoutPreview .is-upper2 i,.pr-workoutCard.is-upper2 i,.pr-historyRow.is-upper2 .pr-historyAccent{background:#35d2dc}.pr-workoutPreview .is-lower1 i,.pr-workoutCard.is-lower1 i,.pr-historyRow.is-lower1 .pr-historyAccent{background:#4ed79b}.pr-workoutPreview .is-lower2 i,.pr-workoutCard.is-lower2 i,.pr-historyRow.is-lower2 .pr-historyAccent{background:#e9a54b}.pr-workoutPreview strong{display:block;color:#f1f8fb;font-size:11px}.pr-workoutPreview small{display:block;margin-top:4px;color:rgba(181,205,216,.52);font-size:8px}
        .pr-workoutGrid{display:grid;grid-template-columns:repeat(2,1fr);gap:9px}.pr-workoutCard{position:relative;overflow:hidden;padding:13px;border:1px solid rgba(129,193,216,.10);border-radius:12px;background:#091218}.pr-workoutCard.is-upper1{background:linear-gradient(115deg,rgba(37,77,139,.16),#091218 37%)}.pr-workoutCard.is-upper2{background:linear-gradient(115deg,rgba(27,108,113,.15),#091218 37%)}.pr-workoutCard.is-lower1{background:linear-gradient(115deg,rgba(31,112,76,.14),#091218 37%)}.pr-workoutCard.is-lower2{background:linear-gradient(115deg,rgba(131,83,25,.14),#091218 37%)}.pr-workoutTitle{position:relative;padding-left:10px}.pr-workoutTitle h3{margin:0;color:#fff;font-size:17px}.pr-workoutStats{margin-top:12px;padding-top:11px;border-top:1px solid rgba(130,193,216,.08)}.pr-workoutStats>div{padding:0 8px}.pr-workoutStats>div+div{border-left:1px solid rgba(130,193,216,.09)}.pr-workoutStats span{display:block;color:rgba(176,204,216,.56);font-size:7px;text-transform:uppercase}.pr-workoutStats strong{display:block;margin-top:5px;color:#fff;font-size:12px}.pr-workoutStats .pr-delta{display:block;margin-top:5px;font-size:9px}
        .pr-historyList{display:grid;gap:7px}.pr-historyRow{position:relative;display:grid;grid-template-columns:3px minmax(210px,1.25fr) minmax(390px,1.6fr) 68px;align-items:center;gap:12px;padding:10px 12px 10px 0;border:1px solid rgba(127,192,216,.09);border-radius:11px;background:#091218;overflow:hidden}.pr-historyAccent{position:static;align-self:stretch;width:3px}.pr-historyName h3{margin:0;color:#fff;font-size:15px}.pr-historyName time{display:block;margin-top:5px;color:rgba(195,214,223,.60);font-size:8px}.pr-historyName p{margin:5px 0 0;overflow:hidden;color:rgba(188,209,219,.50);font-size:8px;white-space:nowrap;text-overflow:ellipsis}.pr-historyMetrics{display:grid;grid-template-columns:1.15fr repeat(4,1fr)}.pr-historyMetrics>div{padding:0 8px}.pr-historyMetrics>div+div{border-left:1px solid rgba(130,193,216,.08)}.pr-historyMetrics span{display:block;color:rgba(171,201,214,.52);font-size:7px;text-transform:uppercase}.pr-historyMetrics strong{display:block;margin-top:5px;color:#f0f8fb;font-size:11px;white-space:nowrap}.pr-viewButton{min-height:32px;border:1px solid rgba(74,190,231,.21);border-radius:8px;color:#eaf7fb;background:rgba(20,78,98,.12);font-size:8px;font-weight:1000;cursor:pointer}
        .pr-loadMore{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:11px;padding-top:11px;border-top:1px solid rgba(127,191,215,.08)}.pr-loadMore span{color:rgba(183,206,216,.52);font-size:8px}.pr-loadMore button{min-height:36px;padding:0 14px;border:1px solid rgba(64,185,228,.30);border-radius:9px;color:#f0f9fc;background:rgba(20,82,104,.15);font-size:8px;font-weight:1000;cursor:pointer}
        .pr-empty{display:grid;place-items:center;min-height:100px;padding:18px;color:rgba(184,207,217,.51);font-size:9px;text-align:center}
        .pr-overlay{position:fixed;z-index:9999;inset:0;display:grid;place-items:center;padding:18px;background:rgba(2,6,9,.84);backdrop-filter:blur(8px)}.pr-detailModal,.pr-clearModal{width:min(760px,100%);max-height:86vh;overflow:auto;padding:17px;border:1px solid rgba(126,196,221,.18);border-radius:15px;background:linear-gradient(180deg,#111d24,#071016);box-shadow:0 28px 90px rgba(0,0,0,.64)}.pr-modalHead{display:flex;justify-content:space-between}.pr-modalHead span{color:rgba(185,209,219,.55);font-size:8px}.pr-modalHead h2{margin:5px 0 0;color:#fff;font-size:24px}.pr-modalHead button{width:34px;height:34px;border:1px solid rgba(125,191,216,.12);border-radius:9px;color:#eaf6fa;background:#0c161c;font-size:20px}.pr-modalSummary{margin-top:13px;border-top:1px solid rgba(128,191,215,.09);border-bottom:1px solid rgba(128,191,215,.07)}.pr-modalSummary>div{padding:12px}.pr-modalSummary>div+div{border-left:1px solid rgba(128,191,215,.08)}.pr-modalSummary strong{display:block;margin-top:6px;color:#fff;font-size:14px}
        .pr-detailExercises{display:grid;gap:8px;margin-top:12px}.pr-detailExercise{padding:11px 12px;border-left:2px solid rgba(78,200,241,.30);background:linear-gradient(90deg,rgba(30,84,105,.10),transparent 90%)}.pr-detailExercise>div:first-child strong{display:block;color:#fff;font-size:11px}.pr-detailExercise>div:first-child span{display:block;margin-top:3px;color:rgba(182,205,216,.50);font-size:8px}.pr-setList{display:flex;flex-wrap:wrap;gap:7px 14px;margin-top:8px}.pr-setList span{color:rgba(215,231,238,.72);font-size:9px}.pr-setList b{margin-right:5px;color:#65d2f4;font-size:7px}
        .pr-clearModal{width:min(460px,100%)}.pr-clearModal h2{margin:0;color:#fff;font-size:22px}.pr-clearModal p{margin:7px 0 0;color:rgba(209,226,234,.64);font-size:10px;line-height:1.5}.pr-clearModal input{width:100%;min-height:43px;margin-top:14px;padding:0 12px;border:1px solid rgba(255,255,255,.11);border-radius:9px;color:#fff;background:#060d12;outline:0}.pr-clearModal>div{display:flex;justify-content:flex-end;gap:8px;margin-top:13px}.pr-clearModal button{min-height:37px;padding:0 13px;border:1px solid rgba(128,191,215,.13);border-radius:9px;color:#eaf4f8;background:#0f181e;font-size:9px;font-weight:950}.pr-clearModal button.is-danger{border-color:rgba(255,116,116,.26);color:#ffd1d1;background:rgba(110,32,32,.34)}.pr-clearModal button:disabled{opacity:.42}
        @media(max-width:1050px){.pr-performanceGrid,.pr-trendIssueGrid{grid-template-columns:1fr}.pr-recoveryGrid{grid-template-columns:1fr 1.4fr}.pr-recoveryState{grid-column:1/-1}.pr-qualityGrid.pr-six,.pr-exerciseStats.pr-six{grid-template-columns:repeat(3,1fr)}.pr-historyRow{grid-template-columns:3px minmax(190px,1fr) minmax(340px,1.4fr) 64px}}
        @media(max-width:780px){.pr-hero{display:grid;padding:13px}.pr-section{padding:13px}.pr-heroControls{display:grid;grid-template-columns:1fr 1fr}.pr-dropdown{min-width:0}.pr-sectionTitle{display:grid}.pr-coachRow{grid-template-columns:36px 1fr}.pr-coachAction{grid-column:2}.pr-majorRail.pr-four{grid-template-columns:repeat(2,1fr)}.pr-majorRail.pr-four>div:nth-child(3){border-left:0;border-top:1px solid rgba(132,195,218,.10)}.pr-majorRail.pr-four>div:nth-child(4){border-top:1px solid rgba(132,195,218,.10)}.pr-trendGrid{grid-template-columns:repeat(2,1fr)}.pr-recoveryGrid{grid-template-columns:1fr}.pr-recoveryState{grid-column:auto}.pr-recoveryMetrics.pr-four{grid-template-columns:repeat(2,1fr)}.pr-painHighlights.pr-three{grid-template-columns:1fr}.pr-workoutGrid,.pr-workoutPreview.pr-four{grid-template-columns:repeat(2,1fr)}.pr-historyRow{grid-template-columns:3px 1fr 62px}.pr-historyMetrics{grid-column:2/-1;grid-row:2;padding-top:8px;border-top:1px solid rgba(130,193,216,.08)}.pr-viewButton{grid-column:3;grid-row:1}.pr-modalSummary.pr-four{grid-template-columns:repeat(2,1fr)}}
        @media(max-width:520px){.pr-heroControls{grid-template-columns:1fr}.pr-majorRail.pr-three,.pr-majorRail.pr-four,.pr-minorRail.pr-three,.pr-qualityGrid.pr-six{grid-template-columns:1fr}.pr-majorRail>div+div,.pr-qualityGrid>div+div{border-left:0;border-top:1px solid rgba(132,195,218,.10)}.pr-trendGrid{grid-template-columns:1fr}.pr-trendGrid>div+div{border-left:0!important;border-top:1px solid rgba(131,194,216,.09)}.pr-workoutGrid,.pr-workoutPreview.pr-four{grid-template-columns:1fr}.pr-loadMore{align-items:stretch;flex-direction:column}.pr-loadMore button{width:100%}}

        /* ==========================================================
           STEP 10B MOBILE RESPONSIVE HARDENING
           Converts wide analytics tables into readable phone cards,
           constrains every surface, and keeps history/recovery in view.
           ========================================================== */
        @media(max-width:680px){
          .pr-page{
            width:100%!important;
            min-width:0!important;
            max-width:100%!important;
            overflow-x:hidden!important;
          }

          .pr-page > *,
          .pr-surface,
          .pr-section,
          .pr-hero,
          .pr-sectionTitle,
          .pr-sectionTitleText,
          .pr-sectionTitleText > div,
          .pr-performanceGrid,
          .pr-trendIssueGrid,
          .pr-chartPanel,
          .pr-highlightStack,
          .pr-exerciseDetail,
          .pr-recoveryGrid,
          .pr-recoveryMetrics,
          .pr-historyList,
          .pr-historyRow,
          .pr-historyName,
          .pr-historyMetrics{
            min-width:0!important;
            max-width:100%!important;
          }

          .pr-surface{
            width:100%!important;
            overflow:visible!important;
          }

          .pr-sectionTitle h2{
            font-size:clamp(27px,8vw,36px)!important;
            line-height:.98!important;
            overflow-wrap:anywhere!important;
          }

          .pr-sectionTitle p,
          .pr-coachCopy p,
          .pr-coachAction,
          .pr-issue p,
          .pr-highlight p,
          .pr-trendState span,
          .pr-exerciseCoach strong{
            white-space:normal!important;
            overflow-wrap:anywhere!important;
          }

          .pr-sectionRight{
            width:100%!important;
            min-width:0!important;
          }

          .pr-exerciseDropdown{
            width:100%!important;
            min-width:0!important;
            max-width:100%!important;
          }

          .pr-dropdownMenu{
            max-width:calc(100vw - 54px)!important;
          }

          .pr-majorRail.pr-three,
          .pr-majorRail.pr-four{
            grid-template-columns:repeat(2,minmax(0,1fr))!important;
          }

          .pr-majorRail.pr-three > div:nth-child(3){
            grid-column:1/-1!important;
          }

          .pr-minorRail.pr-three{
            grid-template-columns:repeat(3,minmax(0,1fr))!important;
          }

          .pr-majorRail > div,
          .pr-minorRail > div{
            min-width:0!important;
          }

          .pr-majorRail strong{
            font-size:clamp(25px,7vw,34px)!important;
            overflow-wrap:anywhere!important;
          }

          .pr-coachRow{
            grid-template-columns:36px minmax(0,1fr)!important;
          }

          .pr-coachAction{
            grid-column:2!important;
          }

          .pr-volumeChart{
            width:100%!important;
            max-width:100%!important;
            overflow-x:auto!important;
            overscroll-behavior-inline:contain;
          }

          .pr-trendGrid{
            grid-template-columns:repeat(2,minmax(0,1fr))!important;
          }

          .pr-recoveryGrid{
            grid-template-columns:1fr!important;
          }

          .pr-recoveryMetrics.pr-four{
            width:100%!important;
            grid-template-columns:repeat(2,minmax(0,1fr))!important;
          }

          .pr-recoveryMetrics > div{
            min-width:0!important;
          }

          .pr-recoveryMetrics > div:nth-child(3){
            border-left:0!important;
            border-top:1px solid rgba(130,193,216,.09)!important;
          }

          .pr-recoveryMetrics > div:nth-child(4){
            border-top:1px solid rgba(130,193,216,.09)!important;
          }

          .pr-recoveryState{
            width:100%!important;
            min-width:0!important;
            justify-content:flex-start!important;
            text-align:left!important;
          }

          .pr-painHighlights.pr-three{
            grid-template-columns:1fr!important;
          }

          .pr-painHighlights strong{
            white-space:normal!important;
            overflow:visible!important;
            text-overflow:clip!important;
            overflow-wrap:anywhere!important;
          }

          /* Wide desktop analytics become phone-native cards. */
          .pr-muscleTableWrap,
          .pr-exerciseTableWrap,
          .pr-painTableWrap{
            max-height:none!important;
            overflow:visible!important;
            border:0!important;
          }

          .pr-muscleTableWrap .pr-table,
          .pr-exerciseTableWrap .pr-table,
          .pr-painTableWrap .pr-table{
            display:block!important;
            width:100%!important;
            min-width:0!important;
          }

          .pr-muscleTableWrap .pr-table thead,
          .pr-exerciseTableWrap .pr-table thead,
          .pr-painTableWrap .pr-table thead{
            display:none!important;
          }

          .pr-muscleTableWrap .pr-table tbody,
          .pr-exerciseTableWrap .pr-table tbody,
          .pr-painTableWrap .pr-table tbody{
            display:grid!important;
            gap:8px!important;
            width:100%!important;
          }

          .pr-muscleTableWrap .pr-table tr,
          .pr-exerciseTableWrap .pr-table tr,
          .pr-painTableWrap .pr-table tr{
            display:grid!important;
            grid-template-columns:repeat(2,minmax(0,1fr))!important;
            width:100%!important;
            min-width:0!important;
            padding:10px 11px!important;
            border:1px solid rgba(129,193,216,.10)!important;
            border-left:3px solid rgba(82,206,244,.42)!important;
            border-radius:10px!important;
            background:linear-gradient(180deg,#0c171e,#081116)!important;
          }

          .pr-exerciseTableWrap .pr-table tr.is-selected{
            border-left-color:#4ac9f2!important;
            box-shadow:inset 0 1px 0 rgba(255,255,255,.025)!important;
            background:linear-gradient(105deg,rgba(31,138,178,.13),#081116 58%)!important;
          }

          .pr-muscleTableWrap .pr-table td,
          .pr-exerciseTableWrap .pr-table td,
          .pr-painTableWrap .pr-table td{
            min-width:0!important;
            display:flex!important;
            flex-direction:column!important;
            align-items:flex-start!important;
            justify-content:flex-start!important;
            gap:4px!important;
            padding:7px 7px!important;
            border:0!important;
            text-align:left!important;
            white-space:normal!important;
            overflow-wrap:anywhere!important;
          }

          .pr-muscleTableWrap .pr-table td:first-child,
          .pr-exerciseTableWrap .pr-table td:first-child,
          .pr-painTableWrap .pr-table td:first-child{
            grid-column:1/-1!important;
            padding-bottom:9px!important;
            border-bottom:1px solid rgba(130,193,216,.08)!important;
          }

          .pr-muscleTableWrap .pr-table td::before,
          .pr-exerciseTableWrap .pr-table td::before,
          .pr-painTableWrap .pr-table td::before{
            display:block!important;
            color:rgba(174,204,217,.56)!important;
            font-size:7px!important;
            line-height:1!important;
            font-weight:1000!important;
            letter-spacing:.08em!important;
            text-transform:uppercase!important;
          }

          .pr-muscleTableWrap .pr-table td:nth-child(1)::before{content:"Muscle Group"}
          .pr-muscleTableWrap .pr-table td:nth-child(2)::before{content:"Exercises"}
          .pr-muscleTableWrap .pr-table td:nth-child(3)::before{content:"7D"}
          .pr-muscleTableWrap .pr-table td:nth-child(4)::before{content:"14D"}
          .pr-muscleTableWrap .pr-table td:nth-child(5)::before{content:"30D"}
          .pr-muscleTableWrap .pr-table td:nth-child(6)::before{content:"1Y"}

          .pr-exerciseTableWrap .pr-table td:nth-child(1)::before{content:"Exercise"}
          .pr-exerciseTableWrap .pr-table td:nth-child(2)::before{content:"Current"}
          .pr-exerciseTableWrap .pr-table td:nth-child(3)::before{content:"7D"}
          .pr-exerciseTableWrap .pr-table td:nth-child(4)::before{content:"14D"}
          .pr-exerciseTableWrap .pr-table td:nth-child(5)::before{content:"30D"}
          .pr-exerciseTableWrap .pr-table td:nth-child(6)::before{content:"1Y"}
          .pr-exerciseTableWrap .pr-table td:nth-child(7)::before{content:"Trend"}
          .pr-exerciseTableWrap .pr-table td:nth-child(7){grid-column:1/-1!important}

          .pr-painTableWrap .pr-table td:nth-child(1)::before{content:"Exercise"}
          .pr-painTableWrap .pr-table td:nth-child(2)::before{content:"Current"}
          .pr-painTableWrap .pr-table td:nth-child(3)::before{content:"7D"}
          .pr-painTableWrap .pr-table td:nth-child(4)::before{content:"14D"}
          .pr-painTableWrap .pr-table td:nth-child(5)::before{content:"30D"}
          .pr-painTableWrap .pr-table td:nth-child(6)::before{content:"1Y"}

          .pr-table td strong,
          .pr-table td b,
          .pr-table .pr-delta{
            font-size:13px!important;
          }

          .pr-exerciseDetailHead{
            display:grid!important;
            grid-template-columns:1fr!important;
          }

          .pr-trendState{
            max-width:100%!important;
          }

          .pr-baseline,
          .pr-exerciseStats.pr-six{
            grid-template-columns:repeat(2,minmax(0,1fr))!important;
          }

          .pr-baseline > div,
          .pr-exerciseStats > div{
            min-width:0!important;
          }

          .pr-baseline > div:nth-child(3){
            grid-column:1/-1!important;
            border-left:0!important;
            border-top:1px solid rgba(130,193,216,.09)!important;
          }

          .pr-historyRow{
            width:100%!important;
            min-width:0!important;
            display:grid!important;
            grid-template-columns:3px minmax(0,1fr)!important;
            gap:10px!important;
            padding:12px 12px 12px 0!important;
          }

          .pr-historyAccent{
            grid-column:1!important;
            grid-row:1/4!important;
          }

          .pr-historyName{
            grid-column:2!important;
            grid-row:1!important;
          }

          .pr-historyName p{
            max-width:100%!important;
            white-space:normal!important;
            overflow:visible!important;
            text-overflow:clip!important;
            overflow-wrap:anywhere!important;
            line-height:1.35!important;
          }

          .pr-historyMetrics{
            grid-column:2!important;
            grid-row:2!important;
            width:100%!important;
            display:grid!important;
            grid-template-columns:repeat(2,minmax(0,1fr))!important;
            gap:0!important;
            padding-top:9px!important;
            border-top:1px solid rgba(130,193,216,.08)!important;
          }

          .pr-historyMetrics > div{
            min-width:0!important;
            padding:8px 8px!important;
            border-left:0!important;
          }

          .pr-historyMetrics > div:nth-child(even){
            border-left:1px solid rgba(130,193,216,.08)!important;
          }

          .pr-historyMetrics > div:nth-child(n+3){
            border-top:1px solid rgba(130,193,216,.08)!important;
          }

          .pr-historyMetrics > div:last-child{
            grid-column:1/-1!important;
          }

          .pr-historyMetrics strong{
            white-space:normal!important;
            overflow-wrap:anywhere!important;
          }

          .pr-viewButton{
            grid-column:2!important;
            grid-row:3!important;
            width:100%!important;
            min-height:40px!important;
            margin-top:2px!important;
          }

          .pr-workoutStats.pr-four{
            grid-template-columns:repeat(2,minmax(0,1fr))!important;
          }

          .pr-workoutStats > div:nth-child(3){
            border-left:0!important;
            border-top:1px solid rgba(130,193,216,.08)!important;
            padding-top:9px!important;
          }

          .pr-workoutStats > div:nth-child(4){
            border-top:1px solid rgba(130,193,216,.08)!important;
            padding-top:9px!important;
          }
        }

        @media(max-width:430px){
          .pr-majorRail.pr-three,
          .pr-majorRail.pr-four{
            grid-template-columns:repeat(2,minmax(0,1fr))!important;
          }

          .pr-minorRail.pr-three{
            grid-template-columns:1fr!important;
          }

          .pr-trendGrid{
            grid-template-columns:1fr!important;
          }

          .pr-trendGrid > div + div{
            border-left:0!important;
            border-top:1px solid rgba(131,194,216,.09)!important;
          }
        }

        @media(prefers-reduced-motion:reduce){.pr-page *{transition:none!important}}
      `}</style>
    </div>
  );
}
