// src/features/coach/CoachPage.tsx
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "../../lib/supabase";
import {
  COACH_TIPS,
  COACH_TIP_CATEGORIES,
  type CoachTip,
  type CoachTipCategory,
} from "./coachTips";

type GoalKey = "bulk" | "cut" | "strength" | "fitness";
type SymptomKey =
  | "posture"
  | "shoulder_pain"
  | "back_pain"
  | "knee_pain"
  | "elbow_wrist";
type Mode = "goal" | "symptom";
type Tone = "green" | "amber" | "red" | "blue" | "neutral";
type Decision = "INCREASE" | "HOLD" | "CONTINUE" | "WATCH";

type ProgramBlockRow = {
  id: string;
  status: "active" | "inactive";
  goal: string | null;
  goal_mode: string | null;
  start_date: string | null;
  end_date: string | null;
  weeks: number | null;
  created_at: string;
  intake_snapshot_id?: string | null;
};

type RpcProgramListItem = {
  id: string;
  status: "active" | "inactive";
  goal: string | null;
  created_at: string;
  sessions_count: number;
  workouts_count: number;
  completed_workouts_count: number;
};

type ScheduledRow = {
  id: string;
  template_id: string | null;
  date: string | null;
  session_type: string | null;
  status: string | null;
  program_block_id: string | null;
};

type TemplateRow = {
  id: string;
  name: string;
  focus_tags: string[] | null;
  estimated_minutes: number | null;
};

type TemplateExerciseRow = {
  id: string;
  template_id: string;
  exercise_id: string;
  order_index: number;
  sets: number;
  rep_min: number;
  rep_max: number;
  rir_min: number | null;
  rir_max: number | null;
  rest_seconds: number | null;
};

type ExerciseMeta = {
  id: string;
  name: string;
  primary_muscles: string[] | null;
  secondary_muscles: string[] | null;
};

type WorkoutRow = {
  id: string;
  scheduled_session_id: string | null;
  completed_at: string;
  started_at: string | null;
  ended_at: string | null;
  active_seconds: number | null;
  bodyweight_lb: number | null;
  protein_target_g: number | null;
  post_difficulty: string | null;
};

type WorkoutExerciseRow = {
  id: string;
  workout_id: string;
  exercise_id: string;
  pain: number | null;
  difficulty: string | null;
  prescription_snapshot: any;
};

type WorkoutSetRow = {
  workout_exercise_id: string;
  set_index: number;
  reps: number;
  weight: number;
  rir: number | null;
};

type ExercisePoint = {
  workoutId: string;
  completedAt: string;
  workoutName: string;
  bestWeight: number;
  bestReps: number;
  bestE1RM: number;
  avgRir: number | null;
  pain: number | null;
  volume: number;
};

type ExerciseInsight = {
  id: string;
  name: string;
  muscles: string[];
  points: ExercisePoint[];
  currentWeight: number;
  currentReps: number;
  currentRir: number | null;
  currentPain: number | null;
  change14: number | null;
  change30: number | null;
  pain14: number | null;
  decision: Decision;
  suggestedWeight: number | null;
  reason: string;
};

type NextExercise = {
  id: string;
  name: string;
  muscles: string[];
  sets: number;
  repMin: number;
  repMax: number;
  rirMin: number | null;
  rirMax: number | null;
  currentWeight: number;
  suggestedWeight: number | null;
  decision: Decision;
  reason: string;
};

type CoachRecommendation = {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  action: string;
  tone: Tone;
  exerciseId?: string;
};

type CoachHistoryRow = {
  id: string;
  createdAt: string;
  title: string;
  action: string;
  tone: Tone;
};

type ToastState = { open: boolean; tone: "ok" | "err"; text: string };

const HISTORY_KEY = "mvp-coach-recommendation-history-v2";
const TIP_RECENT_KEY = "mvp-coach-tip-recent-v2";
const STABLE_PCT = 2;

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function num(value: any, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function ms(value: string | null | undefined) {
  if (!value) return NaN;
  return new Date(value).getTime();
}

function average(values: number[]) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function titleCase(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function goalLabel(goal: string | null | undefined) {
  const g = String(goal ?? "").toLowerCase();
  if (["build_muscle", "bulk", "muscle_gain"].includes(g)) return "Muscle Gain";
  if (["lose_weight", "cut"].includes(g)) return "Cut";
  if (g === "strength") return "Strength";
  if (g === "fitness") return "Fitness";
  return titleCase(goal) || "Training";
}

function goalKeyForTips(goal: string | null | undefined) {
  const g = String(goal ?? "").toLowerCase();
  if (["build_muscle", "bulk", "muscle_gain"].includes(g)) return "muscle_gain";
  if (["lose_weight", "cut"].includes(g)) return "cut";
  if (g === "strength") return "strength";
  if (g === "fitness") return "fitness";
  return "all";
}

function symptomLabel(value: SymptomKey) {
  if (value === "posture") return "Posture";
  if (value === "shoulder_pain") return "Shoulder";
  if (value === "back_pain") return "Back";
  if (value === "knee_pain") return "Knee";
  return "Elbow / Wrist";
}

function prettyMuscle(value: string) {
  const normalized = titleCase(value);
  const aliases: Record<string, string> = {
    Lats: "Back",
    "Upper Back": "Back",
    "Middle Back": "Back",
    Deltoids: "Shoulders",
    "Rear Delts": "Shoulders",
    "Front Delts": "Shoulders",
    "Side Delts": "Shoulders",
    Quadriceps: "Quads",
    Abdominals: "Core",
    Abs: "Core",
    Pectorals: "Chest",
  };
  return aliases[normalized] ?? (normalized || "Other");
}

function fmtDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatWeight(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value) || value <= 0) return "—";
  return `${Number.isInteger(value) ? value : value.toFixed(1)} LB`;
}

function formatPct(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  const clean = Math.abs(value) < 0.05 ? 0 : value;
  return `${clean > 0 ? "+" : ""}${clean.toFixed(1)}%`;
}

function e1rm(weight: number, reps: number) {
  if (!(weight > 0) || !(reps > 0)) return 0;
  return reps === 1 ? weight : weight * (1 + reps / 30);
}

function progressionIncrement(weight: number) {
  if (weight >= 200) return 10;
  if (weight >= 30) return 5;
  if (weight >= 10) return 2.5;
  return 1;
}

function pointAtOrBefore(points: ExercisePoint[], target: number) {
  const eligible = points
    .filter((point) => ms(point.completedAt) <= target)
    .slice()
    .sort((a, b) => ms(a.completedAt) - ms(b.completedAt));
  return eligible[eligible.length - 1] ?? null;
}

function strengthChange(points: ExercisePoint[], days: number) {
  const valid = points
    .filter((point) => point.bestE1RM > 0)
    .slice()
    .sort((a, b) => ms(a.completedAt) - ms(b.completedAt));
  if (valid.length < 2) return null;
  const latest = valid[valid.length - 1];
  const start = Date.now() - days * 86400000;
  const before = pointAtOrBefore(valid, start);
  const inside = valid.filter((point) => ms(point.completedAt) >= start);
  const baseline = before ?? (inside.length >= 2 ? inside[0] : null);
  if (!baseline || baseline.workoutId === latest.workoutId || baseline.bestE1RM <= 0) {
    return null;
  }
  return ((latest.bestE1RM - baseline.bestE1RM) / baseline.bestE1RM) * 100;
}

function painChange(points: ExercisePoint[], days: number) {
  const valid = points
    .filter((point) => point.pain != null && Number.isFinite(point.pain))
    .slice()
    .sort((a, b) => ms(a.completedAt) - ms(b.completedAt));
  if (valid.length < 2) return null;
  const latest = valid[valid.length - 1];
  const start = Date.now() - days * 86400000;
  const before = valid.filter((point) => ms(point.completedAt) <= start).at(-1) ?? null;
  const inside = valid.filter((point) => ms(point.completedAt) >= start);
  const baseline = before ?? (inside.length >= 2 ? inside[0] : null);
  if (!baseline || baseline.workoutId === latest.workoutId) return null;
  return num(latest.pain) - num(baseline.pain);
}

function coachDecision(
  points: ExercisePoint[],
  repMin?: number,
  repMax?: number
): Pick<ExerciseInsight, "decision" | "suggestedWeight" | "reason"> {
  const latest = points[points.length - 1];
  if (!latest) {
    return {
      decision: "CONTINUE",
      suggestedWeight: null,
      reason: "No prior performance yet. Establish a clean baseline.",
    };
  }

  const pain14 = painChange(points, 14);
  if ((latest.pain ?? 0) >= 3 || (pain14 ?? 0) >= 1) {
    return {
      decision: "WATCH",
      suggestedWeight: latest.bestWeight || null,
      reason: "Pain is elevated or trending upward. Hold progression until the signal settles.",
    };
  }

  if (points.length < 2) {
    return {
      decision: "CONTINUE",
      suggestedWeight: latest.bestWeight || null,
      reason: "One workout establishes the baseline. Repeat it before making a progression call.",
    };
  }

  const targetHigh = repMax && repMax > 0 ? repMax : null;
  const targetLow = repMin && repMin > 0 ? repMin : null;
  const highRir = latest.avgRir != null && latest.avgRir >= 3;
  const reachedHigh = targetHigh != null ? latest.bestReps >= targetHigh : latest.bestReps >= 10;
  const belowLow = targetLow != null ? latest.bestReps < targetLow : false;

  if (latest.bestWeight > 0 && highRir && reachedHigh) {
    return {
      decision: "INCREASE",
      suggestedWeight: latest.bestWeight + progressionIncrement(latest.bestWeight),
      reason: "Rep target is achieved with reserve left and pain controlled.",
    };
  }

  if (belowLow || (latest.avgRir != null && latest.avgRir <= 1)) {
    return {
      decision: "HOLD",
      suggestedWeight: latest.bestWeight || null,
      reason: "Current load is already demanding. Earn more reps before adding weight.",
    };
  }

  return {
    decision: "HOLD",
    suggestedWeight: latest.bestWeight || null,
    reason: "Keep the current load and build cleaner reps or a stronger performance trend.",
  };
}

function decisionTone(decision: Decision): Tone {
  if (decision === "INCREASE") return "green";
  if (decision === "WATCH") return "amber";
  if (decision === "HOLD") return "blue";
  return "neutral";
}

function SvgIcon({
  name,
  size = 18,
}: {
  name: "coach" | "trend" | "signal" | "warning" | "tip" | "program" | "chevron" | "nutrition";
  size?: number;
}) {
  const paths: Record<string, ReactNode> = {
    coach: <><path d="M7 8a5 5 0 0 1 10 0v2"/><path d="M5 10h2v5H5zM17 10h2v5h-2zM8 20h8M12 15v5"/></>,
    trend: <path d="m4 17 5-5 4 3 7-8M16 7h4v4"/>,
    signal: <><path d="M5 19V9M10 19V5M15 19v-7M20 19V3"/></>,
    warning: <><path d="M12 4 3.5 19h17L12 4Z"/><path d="M12 9v4M12 16.5v.1"/></>,
    tip: <><path d="M9 18h6M10 21h4"/><path d="M8 14c-1.4-1.1-2-2.6-2-4.3A6 6 0 0 1 18 9.7c0 1.8-.7 3.3-2 4.4-.7.6-1 1.1-1 1.9H9c0-.8-.3-1.4-1-2Z"/></>,
    program: <><path d="m12 4 8 4-8 4-8-4 8-4Z"/><path d="m4 12 8 4 8-4M4 16l8 4 8-4"/></>,
    chevron: <path d="m8 10 4 4 4-4"/>,
    nutrition: <><path d="M12 5c2-2 5-1 5 2 0 5-5 12-5 12S7 12 7 7c0-3 3-4 5-2Z"/><path d="M12 5c0-2 1-3 3-3"/></>,
  };

  return (
    <svg className="co-icon" viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      {paths[name]}
    </svg>
  );
}

function StatusDot({ tone }: { tone: Tone }) {
  return <span className={`co-statusDot is-${tone}`} aria-hidden />;
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
    <div className="co-sectionTitle">
      <div className="co-sectionTitleText">
        <span className="co-sectionAccent" aria-hidden />
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
      </div>
      {right ? <div className="co-sectionRight">{right}</div> : null}
    </div>
  );
}

export function CoachPage({ navigate }: { navigate: (to: string) => void }) {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>({ open: false, tone: "ok", text: "" });
  const toastTimer = useRef<number | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [activeProgram, setActiveProgram] = useState<ProgramBlockRow | null>(null);
  const [scheduled, setScheduled] = useState<ScheduledRow[]>([]);
  const [templateMap, setTemplateMap] = useState<Map<string, TemplateRow>>(new Map());
  const [templateExercises, setTemplateExercises] = useState<TemplateExerciseRow[]>([]);
  const [exerciseMap, setExerciseMap] = useState<Map<string, ExerciseMeta>>(new Map());
  const [workouts, setWorkouts] = useState<WorkoutRow[]>([]);
  const [workoutExercises, setWorkoutExercises] = useState<WorkoutExerciseRow[]>([]);
  const [workoutSets, setWorkoutSets] = useState<WorkoutSetRow[]>([]);

  const [manageOpen, setManageOpen] = useState(false);
  const [manageRows, setManageRows] = useState<RpcProgramListItem[]>([]);
  const [manageLoading, setManageLoading] = useState(false);
  const [manageErr, setManageErr] = useState<string | null>(null);
  const [manageSelected, setManageSelected] = useState<Record<string, boolean>>({});
  const [deleteHistory, setDeleteHistory] = useState(false);
  const [manageBusy, setManageBusy] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const [builderOpen, setBuilderOpen] = useState(false);
  const builderRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [goal, setGoal] = useState<GoalKey>("bulk");
  const [symptom, setSymptom] = useState<SymptomKey>("posture");
  const [focus, setFocus] = useState("");
  const [equipGym, setEquipGym] = useState(true);
  const [equipHome, setEquipHome] = useState(false);
  const [heightFt, setHeightFt] = useState("");
  const [heightIn, setHeightIn] = useState("");
  const [weightLb, setWeightLb] = useState("");
  const [age, setAge] = useState("");
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [switching, setSwitching] = useState(false);

  const [tipCategory, setTipCategory] = useState<CoachTipCategory>("TRAINING");
  const [featuredTip, setFeaturedTip] = useState<CoachTip>(() => COACH_TIPS.find((tip) => tip.category === "TRAINING") ?? COACH_TIPS[0]);
  const [recommendationHistory, setRecommendationHistory] = useState<CoachHistoryRow[]>([]);

  function showToast(text: string, tone: "ok" | "err" = "ok") {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ open: true, tone, text });
    toastTimer.current = window.setTimeout(
      () => setToast((current) => ({ ...current, open: false })),
      2400
    );
  }

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  const equipment = useMemo(() => {
    const result: string[] = [];
    if (equipGym) result.push("gym");
    if (equipHome) result.push("home");
    return result.length ? result : ["gym"];
  }, [equipGym, equipHome]);

  const intake = useMemo(() => {
    const symptoms: Record<string, boolean> = {};
    if (mode === "symptom") symptoms[symptom] = true;
    return {
      symptoms,
      constraints: { equipment },
      aesthetic_interests:
        mode === "goal"
          ? { goal, focus_muscles: focus ? [focus] : [] }
          : {},
      body: {
        height_ft: heightFt.trim() ? Number(heightFt) : null,
        height_in: heightIn.trim() ? Number(heightIn) : null,
        weight_lb: weightLb.trim() ? Number(weightLb) : null,
        age: age.trim() ? Number(age) : null,
      },
    };
  }, [age, equipment, focus, goal, heightFt, heightIn, mode, symptom, weightLb]);

  async function ensureProfile() {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    if (!data.user) throw new Error("Sign in first.");
    const { error: profileError } = await supabase
      .from("profiles")
      .upsert({ user_id: data.user.id }, { onConflict: "user_id" });
    if (profileError) throw profileError;
  }

  async function loadCoach() {
    setLoading(true);
    setMsg(null);

    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!auth.user) throw new Error("Sign in to use Coach.");
      const uid = auth.user.id;
      setUserId(uid);

      const { data: programData, error: programError } = await supabase
        .from("program_blocks")
        .select("id,status,goal,goal_mode,start_date,end_date,weeks,created_at,intake_snapshot_id")
        .eq("user_id", uid)
        .order("created_at", { ascending: false });
      if (programError) throw programError;

      const nextPrograms = (programData ?? []) as ProgramBlockRow[];
      const active = nextPrograms.find((row) => row.status === "active") ?? null;
      setActiveProgram(active);
      if (!active) setBuilderOpen(true);

      let scheduleRows: ScheduledRow[] = [];
      if (active?.id) {
        const { data, error } = await supabase
          .from("scheduled_sessions")
          .select("id,template_id,date,session_type,status,program_block_id")
          .eq("user_id", uid)
          .eq("program_block_id", active.id)
          .order("date", { ascending: true });
        if (error) throw error;
        scheduleRows = (data ?? []) as ScheduledRow[];
      }
      setScheduled(scheduleRows);

      const templateIds = unique(
        scheduleRows.map((row) => row.template_id ?? "").filter(Boolean)
      );
      const nextTemplateMap = new Map<string, TemplateRow>();

      if (templateIds.length) {
        const { data, error } = await supabase
          .from("workout_templates")
          .select("id,name,focus_tags,estimated_minutes")
          .in("id", templateIds);
        if (error) throw error;
        for (const row of (data ?? []) as TemplateRow[]) {
          nextTemplateMap.set(row.id, row);
        }
      }
      setTemplateMap(nextTemplateMap);

      let nextTemplateExercises: TemplateExerciseRow[] = [];
      if (templateIds.length) {
        const { data, error } = await supabase
          .from("template_exercises")
          .select("id,template_id,exercise_id,order_index,sets,rep_min,rep_max,rir_min,rir_max,rest_seconds")
          .in("template_id", templateIds)
          .order("order_index", { ascending: true });
        if (error) throw error;
        nextTemplateExercises = (data ?? []) as TemplateExerciseRow[];
      }
      setTemplateExercises(nextTemplateExercises);

      const templateExerciseIds = unique(
        nextTemplateExercises.map((row) => row.exercise_id).filter(Boolean)
      );

      const { data: workoutData, error: workoutError } = await supabase
        .from("workouts")
        .select("id,scheduled_session_id,completed_at,started_at,ended_at,active_seconds,bodyweight_lb,protein_target_g,post_difficulty")
        .eq("user_id", uid)
        .not("completed_at", "is", null)
        .order("completed_at", { ascending: false })
        .limit(250);
      if (workoutError) throw workoutError;
      const nextWorkouts = (workoutData ?? []) as WorkoutRow[];
      setWorkouts(nextWorkouts);

      const workoutIds = nextWorkouts.map((row) => row.id);
      let nextWorkoutExercises: WorkoutExerciseRow[] = [];
      if (workoutIds.length) {
        const { data, error } = await supabase
          .from("workout_exercises")
          .select("id,workout_id,exercise_id,pain,difficulty,prescription_snapshot")
          .in("workout_id", workoutIds);
        if (error) throw error;
        nextWorkoutExercises = (data ?? []) as WorkoutExerciseRow[];
      }
      setWorkoutExercises(nextWorkoutExercises);

      const historyExerciseIds = unique(
        nextWorkoutExercises.map((row) => row.exercise_id).filter(Boolean)
      );
      const allExerciseIds = unique([...templateExerciseIds, ...historyExerciseIds]);
      const nextExerciseMap = new Map<string, ExerciseMeta>();

      if (allExerciseIds.length) {
        const { data, error } = await supabase
          .from("exercises")
          .select("id,name,primary_muscles,secondary_muscles")
          .in("id", allExerciseIds);
        if (error) throw error;
        for (const row of (data ?? []) as ExerciseMeta[]) {
          nextExerciseMap.set(row.id, row);
        }
      }
      setExerciseMap(nextExerciseMap);

      const workoutExerciseIds = nextWorkoutExercises.map((row) => row.id);
      let nextSets: WorkoutSetRow[] = [];
      if (workoutExerciseIds.length) {
        const { data, error } = await supabase
          .from("workout_sets")
          .select("workout_exercise_id,set_index,reps,weight,rir")
          .in("workout_exercise_id", workoutExerciseIds)
          .order("set_index", { ascending: true });
        if (error) throw error;
        nextSets = (data ?? []) as WorkoutSetRow[];
      }
      setWorkoutSets(nextSets);
    } catch (error: any) {
      const message = error?.message ?? String(error);
      setMsg(message);
      showToast(message, "err");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCoach();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function setActiveProgramBlock(blockId: string) {
    if (!userId) return;
    setSwitching(true);
    try {
      const rpc = await supabase.rpc("rpc_program_set_active", { p_block_id: blockId });
      if (rpc.error) {
        const { error: offError } = await supabase
          .from("program_blocks")
          .update({ status: "inactive" })
          .eq("user_id", userId)
          .eq("status", "active");
        if (offError) throw offError;
        const { error: onError } = await supabase
          .from("program_blocks")
          .update({ status: "active" })
          .eq("user_id", userId)
          .eq("id", blockId);
        if (onError) throw onError;
      }
      showToast("Active program updated.");
      await loadCoach();
    } catch (error: any) {
      showToast(error?.message ?? "Could not switch program.", "err");
    } finally {
      setSwitching(false);
    }
  }

  async function loadManagePrograms() {
    setManageLoading(true);
    setManageErr(null);
    try {
      const { data, error } = await supabase.rpc("rpc_programs_list");
      if (error) throw error;
      setManageRows((((data as any)?.programs ?? []) as RpcProgramListItem[]));
      setManageSelected({});
    } catch (error: any) {
      setManageErr(error?.message ?? String(error));
    } finally {
      setManageLoading(false);
    }
  }

  function openManage() {
    setManageOpen(true);
    setDeleteHistory(false);
    void loadManagePrograms();
  }

  async function deleteSelectedPrograms() {
    const ids = Object.keys(manageSelected).filter((id) => manageSelected[id]);
    if (!ids.length) return;
    setManageBusy(true);
    setManageErr(null);
    try {
      const { error } = await supabase.rpc("rpc_programs_delete_selected", {
        p_program_ids: ids,
        p_delete_history: deleteHistory,
      });
      if (error) throw error;
      showToast("Selected programs deleted.");
      setConfirmDeleteOpen(false);
      await loadManagePrograms();
      await loadCoach();
    } catch (error: any) {
      const message = error?.message ?? String(error);
      setManageErr(message);
      showToast(message, "err");
    } finally {
      setManageBusy(false);
    }
  }

  function resetBuilder() {
    setMode(null);
    setGoal("bulk");
    setSymptom("posture");
    setFocus("");
    setEquipGym(true);
    setEquipHome(false);
    setHeightFt("");
    setHeightIn("");
    setWeightLb("");
    setAge("");
  }

  function openBuilder() {
    resetBuilder();
    setBuilderOpen(true);
    window.setTimeout(
      () => builderRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      50
    );
  }

  async function saveIntake() {
    if (!mode) return;
    setSaving(true);
    try {
      await ensureProfile();
      const { error } = await supabase.rpc("rpc_intake_save", { p_intake: intake });
      if (error) throw error;
      showToast("Program intake saved.");
    } catch (error: any) {
      showToast(error?.message ?? "Could not save intake.", "err");
    } finally {
      setSaving(false);
    }
  }

  async function generateProgram() {
    if (!mode) return;
    setGenerating(true);
    try {
      await ensureProfile();
      const { error } = await supabase.rpc("rpc_generate_program_from_intake", {
        p_intake: intake,
        p_weeks: 4,
        p_days_ahead: 14,
      });
      if (error) throw error;
      showToast("Program generated.");
      await loadCoach();
      setBuilderOpen(false);
      navigate("/");
    } catch (error: any) {
      showToast(error?.message ?? "Could not generate program.", "err");
    } finally {
      setGenerating(false);
    }
  }

  const scheduledMap = useMemo(
    () => new Map(scheduled.map((row) => [row.id, row])),
    [scheduled]
  );

  const activeScheduledIds = useMemo(
    () => new Set(scheduled.map((row) => row.id)),
    [scheduled]
  );

  const activeWorkouts = useMemo(() => {
    if (!activeProgram) return workouts;
    return workouts.filter(
      (row) => row.scheduled_session_id && activeScheduledIds.has(row.scheduled_session_id)
    );
  }, [activeProgram, activeScheduledIds, workouts]);

  const workoutMap = useMemo(
    () => new Map(activeWorkouts.map((row) => [row.id, row])),
    [activeWorkouts]
  );

  const setsByWorkoutExercise = useMemo(() => {
    const map = new Map<string, WorkoutSetRow[]>();
    for (const row of workoutSets) {
      const list = map.get(row.workout_exercise_id) ?? [];
      list.push(row);
      map.set(row.workout_exercise_id, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.set_index - b.set_index);
    }
    return map;
  }, [workoutSets]);

  const activeWorkoutExercises = useMemo(
    () => workoutExercises.filter((row) => workoutMap.has(row.workout_id)),
    [workoutExercises, workoutMap]
  );

  const exerciseInsights = useMemo<ExerciseInsight[]>(() => {
    const pointsMap = new Map<string, ExercisePoint[]>();

    for (const row of activeWorkoutExercises) {
      const workout = workoutMap.get(row.workout_id);
      if (!workout) continue;
      const sets = (setsByWorkoutExercise.get(row.id) ?? []).filter(
        (set) => num(set.reps) > 0
      );
      if (!sets.length) continue;

      const best = sets
        .slice()
        .sort(
          (a, b) =>
            e1rm(num(b.weight), num(b.reps)) - e1rm(num(a.weight), num(a.reps))
        )[0];
      const rirValues = sets
        .map((set) => set.rir)
        .filter((value): value is number => value != null && Number.isFinite(value));

      const scheduledRow = workout.scheduled_session_id
        ? scheduledMap.get(workout.scheduled_session_id)
        : null;
      const templateName = scheduledRow?.template_id
        ? templateMap.get(scheduledRow.template_id)?.name
        : null;

      const point: ExercisePoint = {
        workoutId: workout.id,
        completedAt: workout.completed_at,
        workoutName: templateName || titleCase(scheduledRow?.session_type) || "Workout",
        bestWeight: num(best?.weight),
        bestReps: num(best?.reps),
        bestE1RM: best ? e1rm(num(best.weight), num(best.reps)) : 0,
        avgRir: rirValues.length ? average(rirValues) : null,
        pain: row.pain != null ? num(row.pain) : null,
        volume: sets.reduce((sum, set) => sum + num(set.weight) * num(set.reps), 0),
      };

      const list = pointsMap.get(row.exercise_id) ?? [];
      list.push(point);
      pointsMap.set(row.exercise_id, list);
    }

    return Array.from(pointsMap.entries())
      .map(([id, unsorted]) => {
        const points = unsorted.slice().sort((a, b) => ms(a.completedAt) - ms(b.completedAt));
        const latest = points[points.length - 1];
        const meta = exerciseMap.get(id);
        const baseDecision = coachDecision(points);
        return {
          id,
          name: meta?.name ?? "Exercise",
          muscles: Array.isArray(meta?.primary_muscles)
            ? unique(meta!.primary_muscles!.map(prettyMuscle))
            : [],
          points,
          currentWeight: latest?.bestWeight ?? 0,
          currentReps: latest?.bestReps ?? 0,
          currentRir: latest?.avgRir ?? null,
          currentPain: latest?.pain ?? null,
          change14: strengthChange(points, 14),
          change30: strengthChange(points, 30),
          pain14: painChange(points, 14),
          ...baseDecision,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [activeWorkoutExercises, exerciseMap, scheduledMap, setsByWorkoutExercise, templateMap, workoutMap]);

  const insightMap = useMemo(
    () => new Map(exerciseInsights.map((row) => [row.id, row])),
    [exerciseInsights]
  );

  const completedScheduledIds = useMemo(
    () =>
      new Set(
        activeWorkouts
          .map((row) => row.scheduled_session_id)
          .filter((value): value is string => Boolean(value))
      ),
    [activeWorkouts]
  );

  const nextScheduled = useMemo(
    () =>
      scheduled
        .filter((row) => !completedScheduledIds.has(row.id))
        .slice()
        .sort((a, b) => {
          const aTime = ms(a.date);
          const bTime = ms(b.date);
          if (!Number.isFinite(aTime) && !Number.isFinite(bTime)) return 0;
          if (!Number.isFinite(aTime)) return 1;
          if (!Number.isFinite(bTime)) return -1;
          return aTime - bTime;
        })[0] ?? null,
    [completedScheduledIds, scheduled]
  );

  const nextTemplate = nextScheduled?.template_id
    ? templateMap.get(nextScheduled.template_id) ?? null
    : null;

  const nextWorkoutExercises = useMemo<NextExercise[]>(() => {
    if (!nextScheduled?.template_id) return [];
    return templateExercises
      .filter((row) => row.template_id === nextScheduled.template_id)
      .slice()
      .sort((a, b) => a.order_index - b.order_index)
      .map((row) => {
        const meta = exerciseMap.get(row.exercise_id);
        const insight = insightMap.get(row.exercise_id);
        const decision = coachDecision(insight?.points ?? [], row.rep_min, row.rep_max);
        return {
          id: row.exercise_id,
          name: meta?.name ?? insight?.name ?? "Exercise",
          muscles: Array.isArray(meta?.primary_muscles)
            ? unique(meta!.primary_muscles!.map(prettyMuscle))
            : insight?.muscles ?? [],
          sets: num(row.sets, 3),
          repMin: num(row.rep_min, 8),
          repMax: num(row.rep_max, 12),
          rirMin: row.rir_min != null ? num(row.rir_min) : null,
          rirMax: row.rir_max != null ? num(row.rir_max) : null,
          currentWeight: insight?.currentWeight ?? 0,
          ...decision,
        };
      });
  }, [exerciseMap, insightMap, nextScheduled, templateExercises]);

  const difficulty = useMemo(() => {
    const recent = activeWorkouts
      .filter((row) => ms(row.completed_at) >= Date.now() - 30 * 86400000)
      .slice(0, 20);
    const tooEasy = recent.filter((row) => row.post_difficulty === "too_easy").length;
    const onTarget = recent.filter((row) => row.post_difficulty === "just_right").length;
    const tooHard = recent.filter((row) => row.post_difficulty === "too_hard").length;
    const rated = tooEasy + onTarget + tooHard;
    const avgRirValues = exerciseInsights
      .flatMap((row) => row.points)
      .filter((point) => ms(point.completedAt) >= Date.now() - 30 * 86400000)
      .map((point) => point.avgRir)
      .filter((value): value is number => value != null && Number.isFinite(value));
    return {
      tooEasy,
      onTarget,
      tooHard,
      rated,
      avgRir: avgRirValues.length ? average(avgRirValues) : null,
    };
  }, [activeWorkouts, exerciseInsights]);

  const muscleCoaching = useMemo(() => {
    const groups = new Map<string, ExerciseInsight[]>();
    for (const row of exerciseInsights) {
      for (const muscle of row.muscles.length ? row.muscles : ["Other"]) {
        const list = groups.get(muscle) ?? [];
        list.push(row);
        groups.set(muscle, list);
      }
    }

    return Array.from(groups.entries())
      .map(([name, rows]) => {
        const changes = rows
          .map((row) => row.change30)
          .filter((value): value is number => value != null && Number.isFinite(value));
        const painChanges = rows
          .map((row) => row.pain14)
          .filter((value): value is number => value != null && Number.isFinite(value));
        const change = changes.length ? average(changes) : null;
        const painTrend = painChanges.length ? average(painChanges) : null;
        let coach = "More repeated exercise data is needed before making a muscle-group call.";
        let tone: Tone = "neutral";
        if (change != null && change > STABLE_PCT) {
          coach = "Progress is moving well. Continue the current progression strategy while effort and pain remain controlled.";
          tone = "green";
        } else if (change != null && change < -STABLE_PCT) {
          coach = "Performance is trending down. Review the exercises driving this group before adding more volume.";
          tone = "red";
        } else if (change != null) {
          coach = "This muscle group is stable. Look for one eligible exercise to progress instead of adding random work.";
          tone = "blue";
        }
        if ((painTrend ?? 0) >= 1) {
          coach = "Pain is moving upward in this group. Hold aggressive progression and review the exercise causing the signal.";
          tone = "amber";
        }
        return { name, change, painTrend, coach, tone, exerciseCount: rows.length };
      })
      .sort((a, b) => (b.change ?? -999) - (a.change ?? -999));
  }, [exerciseInsights]);

  const volumeTrend = useMemo(() => {
    const workoutExerciseByWorkout = new Map<string, WorkoutExerciseRow[]>();
    for (const row of activeWorkoutExercises) {
      const list = workoutExerciseByWorkout.get(row.workout_id) ?? [];
      list.push(row);
      workoutExerciseByWorkout.set(row.workout_id, list);
    }

    const volumeForWorkout = (id: string) =>
      (workoutExerciseByWorkout.get(id) ?? []).reduce(
        (sum, row) =>
          sum +
          (setsByWorkoutExercise.get(row.id) ?? []).reduce(
            (setSum, set) => setSum + num(set.weight) * num(set.reps),
            0
          ),
        0
      );

    const now = Date.now();
    const current = activeWorkouts.filter(
      (row) => ms(row.completed_at) >= now - 30 * 86400000
    );
    const previous = activeWorkouts.filter(
      (row) =>
        ms(row.completed_at) >= now - 60 * 86400000 &&
        ms(row.completed_at) < now - 30 * 86400000
    );
    const currentVolume = current.reduce((sum, row) => sum + volumeForWorkout(row.id), 0);
    const previousVolume = previous.reduce((sum, row) => sum + volumeForWorkout(row.id), 0);
    return {
      currentVolume,
      previousVolume,
      change:
        previousVolume > 0
          ? ((currentVolume - previousVolume) / previousVolume) * 100
          : null,
    };
  }, [activeWorkoutExercises, activeWorkouts, setsByWorkoutExercise]);

  const frequencyTrend = useMemo(() => {
    const now = Date.now();
    const current = activeWorkouts.filter(
      (row) => ms(row.completed_at) >= now - 30 * 86400000
    ).length;
    const previous = activeWorkouts.filter(
      (row) =>
        ms(row.completed_at) >= now - 60 * 86400000 &&
        ms(row.completed_at) < now - 30 * 86400000
    ).length;
    return {
      current,
      previous,
      change: previous > 0 ? ((current - previous) / previous) * 100 : null,
      perWeek: current / (30 / 7),
    };
  }, [activeWorkouts]);

  const strengthTrend = useMemo(() => {
    const values = exerciseInsights
      .map((row) => row.change30)
      .filter((value): value is number => value != null && Number.isFinite(value));
    return values.length ? average(values) : null;
  }, [exerciseInsights]);

  const painTrend = useMemo(() => {
    const values = exerciseInsights
      .map((row) => row.pain14)
      .filter((value): value is number => value != null && Number.isFinite(value));
    return values.length ? average(values) : null;
  }, [exerciseInsights]);

  const latestBodyWeight = useMemo(
    () =>
      activeWorkouts
        .filter((row) => row.bodyweight_lb != null && Number.isFinite(row.bodyweight_lb))
        .slice()
        .sort((a, b) => ms(b.completed_at) - ms(a.completed_at))[0]?.bodyweight_lb ?? null,
    [activeWorkouts]
  );

  const latestProteinTarget = useMemo(() => {
    const logged = activeWorkouts
      .filter((row) => row.protein_target_g != null && Number.isFinite(row.protein_target_g))
      .slice()
      .sort((a, b) => ms(b.completed_at) - ms(a.completed_at))[0]?.protein_target_g;
    if (logged != null) return Math.round(logged);
    if (latestBodyWeight == null) return null;
    const multiplier = ["cut", "lose_weight"].includes(String(activeProgram?.goal ?? "").toLowerCase()) ? 1 : 0.9;
    return Math.round((latestBodyWeight * multiplier) / 5) * 5;
  }, [activeProgram?.goal, activeWorkouts, latestBodyWeight]);

  const recommendations = useMemo<CoachRecommendation[]>(() => {
    const rows: CoachRecommendation[] = [];

    const painWatch = exerciseInsights
      .filter((row) => (row.currentPain ?? 0) >= 3 || (row.pain14 ?? 0) >= 1)
      .sort((a, b) => (b.pain14 ?? b.currentPain ?? 0) - (a.pain14 ?? a.currentPain ?? 0))[0];
    if (painWatch) {
      rows.push({
        id: `pain-${painWatch.id}`,
        eyebrow: "WATCH",
        title: painWatch.name,
        body: `Pain ${painWatch.currentPain != null ? painWatch.currentPain.toFixed(1) : "—"}${painWatch.pain14 != null ? ` • ${painWatch.pain14 > 0 ? "+" : ""}${painWatch.pain14.toFixed(1)} over 14 days` : ""}.`,
        action: "Hold load progression and reassess after the next workout.",
        tone: "amber",
        exerciseId: painWatch.id,
      });
    }

    const readyNext = nextWorkoutExercises.find((row) => row.decision === "INCREASE");
    if (readyNext) {
      rows.push({
        id: `increase-${readyNext.id}`,
        eyebrow: "PRIORITY",
        title: readyNext.name,
        body: `${formatWeight(readyNext.currentWeight)} → ${formatWeight(readyNext.suggestedWeight)} for ${readyNext.repMin}-${readyNext.repMax} reps.`,
        action: "Increase only if the programmed rep target and clean execution are still there.",
        tone: "green",
        exerciseId: readyNext.id,
      });
    }

    if (
      difficulty.tooEasy > Math.max(1, difficulty.rated * 0.45) ||
      (difficulty.avgRir != null && difficulty.avgRir >= 4)
    ) {
      rows.push({
        id: "program-intensity",
        eyebrow: "PROGRAM",
        title: "Increase training stimulus",
        body: `${difficulty.tooEasy} rated workout${difficulty.tooEasy === 1 ? "" : "s"} felt Too Easy${difficulty.avgRir != null ? ` • ${difficulty.avgRir.toFixed(1)} avg RIR` : ""}.`,
        action: "Progress eligible exercises before adding unnecessary extra volume.",
        tone: "amber",
      });
    }

    const stalled = exerciseInsights
      .filter(
        (row) =>
          row.points.length >= 3 &&
          row.change30 != null &&
          Math.abs(row.change30) <= STABLE_PCT
      )
      .sort((a, b) => b.points.length - a.points.length)[0];
    if (stalled && rows.length < 3) {
      rows.push({
        id: `stall-${stalled.id}`,
        eyebrow: "REVIEW",
        title: `${stalled.name} is flat`,
        body: `${formatPct(stalled.change30)} estimated strength change across the 30-day trend.`,
        action: "Review reps, RIR, rest, and exercise execution before changing volume.",
        tone: "blue",
        exerciseId: stalled.id,
      });
    }

    const topImprover = exerciseInsights
      .filter((row) => row.change30 != null && row.change30 > STABLE_PCT)
      .sort((a, b) => (b.change30 ?? 0) - (a.change30 ?? 0))[0];
    if (topImprover && rows.length < 3) {
      rows.push({
        id: `progress-${topImprover.id}`,
        eyebrow: "PROGRESS",
        title: topImprover.name,
        body: `${formatPct(topImprover.change30)} estimated strength change over 30 days.`,
        action: "Keep the current progression method while effort and pain remain controlled.",
        tone: "blue",
        exerciseId: topImprover.id,
      });
    }

    if (!rows.length) {
      rows.push({
        id: "baseline",
        eyebrow: "COACH",
        title: "Build the next trend",
        body: "More repeated exercise data is needed before Coach can make a high-confidence progression call.",
        action: "Keep logging weight, reps, RIR, pain, and workout difficulty.",
        tone: "blue",
      });
    }

    return rows.slice(0, 3);
  }, [difficulty, exerciseInsights, nextWorkoutExercises]);

  const progressionGroups = useMemo(() => {
    const ready = exerciseInsights
      .filter((row) => row.decision === "INCREASE")
      .sort((a, b) => (b.change30 ?? 0) - (a.change30 ?? 0));
    const hold = exerciseInsights.filter((row) => row.decision === "HOLD");
    const watch = exerciseInsights.filter((row) => row.decision === "WATCH");
    return { ready, hold, watch };
  }, [exerciseInsights]);

  const signals = useMemo(() => {
    const strengthStatus =
      strengthTrend == null
        ? { label: "Building Trend", tone: "blue" as Tone }
        : strengthTrend > STABLE_PCT
          ? { label: "Improving", tone: "green" as Tone }
          : strengthTrend < -STABLE_PCT
            ? { label: "Declining", tone: "red" as Tone }
            : { label: "Stable", tone: "blue" as Tone };

    const intensityStatus =
      difficulty.tooHard > Math.max(1, difficulty.rated * 0.35)
        ? { label: "Too Hard", tone: "red" as Tone }
        : difficulty.tooEasy > Math.max(1, difficulty.rated * 0.45) ||
            (difficulty.avgRir != null && difficulty.avgRir >= 4)
          ? { label: "Too Easy", tone: "amber" as Tone }
          : difficulty.rated
            ? { label: "On Target", tone: "green" as Tone }
            : { label: "Building Trend", tone: "blue" as Tone };

    const painStatus =
      painTrend == null
        ? { label: "Building Trend", tone: "blue" as Tone }
        : painTrend > 0.5
          ? { label: "Increasing", tone: "red" as Tone }
          : painTrend < -0.5
            ? { label: "Improving", tone: "green" as Tone }
            : { label: "Stable", tone: "green" as Tone };

    const frequencyStatus =
      frequencyTrend.previous > 0 && frequencyTrend.current < frequencyTrend.previous * 0.7
        ? { label: "Below Recent", tone: "amber" as Tone }
        : { label: "On Track", tone: "green" as Tone };

    const recoveryStatus = exerciseInsights.some(
      (row) => (row.currentPain ?? 0) >= 4 || (row.pain14 ?? 0) >= 1.5
    )
      ? { label: "Monitor", tone: "amber" as Tone }
      : { label: "Clear", tone: "green" as Tone };

    const laggingMuscle = muscleCoaching
      .filter((row) => row.change != null)
      .slice()
      .sort((a, b) => (a.change ?? 0) - (b.change ?? 0))[0];

    const balanceStatus = laggingMuscle
      ? {
          label:
            (laggingMuscle.change ?? 0) < -STABLE_PCT
              ? `${laggingMuscle.name} Lagging`
              : "Balanced",
          tone:
            (laggingMuscle.change ?? 0) < -STABLE_PCT
              ? ("amber" as Tone)
              : ("green" as Tone),
        }
      : { label: "Building Trend", tone: "blue" as Tone };

    return [
      { name: "Strength", ...strengthStatus },
      { name: "Intensity", ...intensityStatus },
      { name: "Pain", ...painStatus },
      { name: "Frequency", ...frequencyStatus },
      { name: "Recovery", ...recoveryStatus },
      { name: "Muscle Balance", ...balanceStatus },
    ];
  }, [difficulty, exerciseInsights, frequencyTrend, muscleCoaching, painTrend, strengthTrend]);

  const needsAttention = useMemo(() => {
    const rows: { title: string; detail: string; tone: Tone }[] = [];

    if (difficulty.tooEasy > Math.max(1, difficulty.rated * 0.45)) {
      rows.push({
        title: "Training intensity is light",
        detail: `${difficulty.tooEasy} of ${difficulty.rated || 0} rated workouts were Too Easy.`,
        tone: "amber",
      });
    }

    const pain = exerciseInsights
      .filter((row) => (row.pain14 ?? 0) >= 1)
      .sort((a, b) => (b.pain14 ?? 0) - (a.pain14 ?? 0))[0];
    if (pain) {
      rows.push({
        title: `${pain.name} pain is rising`,
        detail: `${pain.pain14! > 0 ? "+" : ""}${pain.pain14!.toFixed(1)} over 14 days.`,
        tone: "red",
      });
    }

    const down = exerciseInsights
      .filter((row) => row.change30 != null && row.change30 < -STABLE_PCT)
      .sort((a, b) => (a.change30 ?? 0) - (b.change30 ?? 0))[0];
    if (down) {
      rows.push({
        title: `${down.name} is trending down`,
        detail: `${formatPct(down.change30)} estimated strength over 30 days.`,
        tone: "red",
      });
    }

    if (!rows.length) {
      rows.push({
        title: "No major issues detected",
        detail: "Current strength, pain, effort, and workload signals are stable.",
        tone: "green",
      });
    }

    return rows.slice(0, 3);
  }, [difficulty, exerciseInsights]);

  const programReview = useMemo(() => {
    const biggestGain = muscleCoaching.find(
      (row) => row.change != null && row.change > 0
    );
    const weakest = muscleCoaching
      .filter((row) => row.change != null)
      .slice()
      .sort((a, b) => (a.change ?? 0) - (b.change ?? 0))[0];

    let overall = "Building Trend";
    let tone: Tone = "blue";
    if ((painTrend ?? 0) > 0.75 || (strengthTrend ?? 0) < -STABLE_PCT) {
      overall = "Needs Review";
      tone = "amber";
    } else if ((strengthTrend ?? 0) > STABLE_PCT || (volumeTrend.change ?? 0) > 5) {
      overall = "Progressing";
      tone = "green";
    } else if (strengthTrend != null) {
      overall = "Stable";
      tone = "blue";
    }

    let assessment = "Keep logging the current program so Coach can build a stronger trend.";
    if (overall === "Progressing") {
      assessment = `The current program is producing measurable progress${biggestGain ? `, led by ${biggestGain.name}` : ""}. Continue the split and progress eligible exercises while pain remains controlled.`;
    } else if (overall === "Needs Review") {
      assessment = `The program has a signal that deserves attention${weakest ? `, with ${weakest.name} currently the weakest muscle-group trend` : ""}. Review the specific exercises driving the decline before adding more work.`;
    } else if (overall === "Stable") {
      assessment = "The program is stable but not clearly moving forward yet. Look for one or two exercises that are ready for progression instead of increasing volume everywhere.";
    }

    return { overall, tone, biggestGain, weakest, assessment };
  }, [muscleCoaching, painTrend, strengthTrend, volumeTrend.change]);

  const contextualCategories = useMemo<CoachTipCategory[]>(() => {
    const result: CoachTipCategory[] = [];
    if (exerciseInsights.some((row) => (row.pain14 ?? 0) >= 1)) {
      result.push("RECOVERY", "MOBILITY");
    }
    if (
      difficulty.tooEasy > Math.max(1, difficulty.rated * 0.45) ||
      (difficulty.avgRir != null && difficulty.avgRir >= 4)
    ) {
      result.push("TRAINING");
    }
    if (activeProgram?.goal) result.push("NUTRITION");
    result.push("SLEEP", "HABITS", "HYDRATION", "MINDSET");
    return unique(result) as CoachTipCategory[];
  }, [activeProgram?.goal, difficulty, exerciseInsights]);

  function chooseTip(category: CoachTipCategory) {
    const goalKey = goalKeyForTips(activeProgram?.goal);
    const eligible = COACH_TIPS.filter(
      (tip) =>
        tip.category === category &&
        (tip.goals.includes("all") || tip.goals.includes(goalKey))
    );
    const pool = eligible.length ? eligible : COACH_TIPS.filter((tip) => tip.category === category);
    if (!pool.length) return;

    let recent: string[] = [];
    try {
      const raw = window.localStorage.getItem(TIP_RECENT_KEY);
      recent = raw ? (JSON.parse(raw) as string[]) : [];
    } catch {}

    const fresh = pool.filter((tip) => !recent.includes(tip.id));
    const source = fresh.length ? fresh : pool;
    const next = source[Math.floor(Math.random() * source.length)];
    setFeaturedTip(next);

    const nextRecent = [...recent, next.id].slice(-80);
    try {
      window.localStorage.setItem(TIP_RECENT_KEY, JSON.stringify(nextRecent));
    } catch {}
  }

  useEffect(() => {
    const preferred = contextualCategories[0] ?? "TRAINING";
    setTipCategory(preferred);
    chooseTip(preferred);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextualCategories.join("|")]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(HISTORY_KEY);
      setRecommendationHistory(raw ? (JSON.parse(raw) as CoachHistoryRow[]) : []);
    } catch {
      setRecommendationHistory([]);
    }
  }, []);

  useEffect(() => {
    if (!recommendations.length) return;
    try {
      const raw = window.localStorage.getItem(HISTORY_KEY);
      const current = raw ? (JSON.parse(raw) as CoachHistoryRow[]) : [];
      const today = new Date().toISOString();
      const additions = recommendations
        .filter(
          (recommendation) =>
            !current.some(
              (row) =>
                row.id === recommendation.id &&
                Date.now() - ms(row.createdAt) < 3 * 86400000
            )
        )
        .map((recommendation) => ({
          id: recommendation.id,
          createdAt: today,
          title: recommendation.title,
          action: recommendation.action,
          tone: recommendation.tone,
        }));
      if (!additions.length) return;
      const next = [...additions, ...current].slice(0, 30);
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      setRecommendationHistory(next);
    } catch {}
  }, [recommendations]);

  const categoryCounts = useMemo(() => {
    const map = new Map<CoachTipCategory, number>();
    for (const category of COACH_TIP_CATEGORIES) {
      map.set(category, COACH_TIPS.filter((tip) => tip.category === category).length);
    }
    return map;
  }, []);

  const activeProgramName = activeProgram
    ? `Foundation • ${goalLabel(activeProgram.goal)}`
    : "No Active Program";

  const rotationNames = useMemo(
    () =>
      unique(
        scheduled
          .map((row) =>
            row.template_id
              ? templateMap.get(row.template_id)?.name ?? titleCase(row.session_type)
              : titleCase(row.session_type)
          )
          .filter(Boolean)
      ).slice(0, 4),
    [scheduled, templateMap]
  );

  const nextMuscles = useMemo(
    () =>
      unique(
        nextWorkoutExercises.flatMap((row) => row.muscles).filter(Boolean)
      ).slice(0, 4),
    [nextWorkoutExercises]
  );

  const selectedManageIds = Object.keys(manageSelected).filter(
    (id) => manageSelected[id]
  );

  return (
    <div className="co-page">
      {toast.open ? (
        <div className={`co-toast is-${toast.tone}`}>
          <span>{toast.text}</span>
          <button type="button" onClick={() => setToast((value) => ({ ...value, open: false }))}>OK</button>
        </div>
      ) : null}

      <section className="co-surface co-hero">
        <div>
          <h1>Coach</h1>
          <div className="co-programName">{activeProgramName}</div>
          {rotationNames.length ? (
            <div className="co-rotation">
              {rotationNames.map((name, index) => (
                <span key={`${name}-${index}`}>
                  <b>{name}</b>
                  {index < rotationNames.length - 1 ? <i>→</i> : null}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="co-heroStatus">
          <span>Coaching Status</span>
          <strong>{loading ? "Analyzing…" : `${recommendations.length} Actions Ready`}</strong>
          <small>{nextTemplate ? `Next: ${nextTemplate.name}` : "Build the next trend"}</small>
        </div>
      </section>

      {msg ? <div className="co-error">{msg}</div> : null}

      <section className="co-surface co-section co-briefing">
        <SectionTitle
          title="Today's Coaching Brief"
          subtitle="The highest-priority decisions from your current training data."
        />
        <div className="co-briefingGrid">
          {recommendations.map((recommendation, index) => (
            <article
              key={recommendation.id}
              className={`co-briefCard is-${recommendation.tone} ${index === 0 ? "is-lead" : ""}`}
            >
              <div className="co-briefTop">
                <span>{recommendation.eyebrow}</span>
                <StatusDot tone={recommendation.tone} />
              </div>
              <h3>{recommendation.title}</h3>
              <p>{recommendation.body}</p>
              <div className="co-briefAction">{recommendation.action}</div>
              {recommendation.exerciseId ? (
                <button type="button" onClick={() => navigate(`/library/${recommendation.exerciseId}`)}>
                  Open Exercise ›
                </button>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <section className="co-surface co-section">
        <SectionTitle
          title="Next Workout Coaching"
          subtitle="Exercise-by-exercise decisions before you start."
          right={
            nextScheduled ? (
              <button type="button" className="co-primaryAction" onClick={() => navigate(`/workout/${nextScheduled.id}`)}>
                Open Workout ›
              </button>
            ) : null
          }
        />

        {nextScheduled && nextTemplate ? (
          <>
            <div className="co-nextWorkoutHead">
              <div>
                <span>Next Workout</span>
                <strong>{nextTemplate.name}</strong>
                <small>{nextMuscles.length ? nextMuscles.join(" • ") : "Training"}</small>
              </div>
              <div>
                <span>Exercises</span>
                <strong>{nextWorkoutExercises.length}</strong>
              </div>
            </div>

            <div className="co-decisionRows">
              {nextWorkoutExercises.map((exercise) => {
                const tone = decisionTone(exercise.decision);
                return (
                  <article className={`co-decisionRow is-${tone}`} key={exercise.id}>
                    <div className="co-decisionIdentity">
                      <strong>{exercise.name}</strong>
                      <span>{exercise.muscles.slice(0, 2).join(" • ") || "Exercise"}</span>
                    </div>
                    <div className="co-decisionLoad">
                      <span>Current</span>
                      <strong>{formatWeight(exercise.currentWeight)}</strong>
                    </div>
                    <div className="co-decisionLoad">
                      <span>Coach</span>
                      <strong>
                        {exercise.decision === "INCREASE"
                          ? formatWeight(exercise.suggestedWeight)
                          : formatWeight(exercise.currentWeight)}
                      </strong>
                    </div>
                    <div className={`co-decisionState is-${tone}`}>
                      <StatusDot tone={tone} />
                      <strong>{exercise.decision}</strong>
                    </div>
                    <p>{exercise.reason}</p>
                    <button type="button" onClick={() => navigate(`/library/${exercise.id}`)}>View ›</button>
                  </article>
                );
              })}
            </div>
          </>
        ) : (
          <div className="co-empty">No upcoming workout is available yet.</div>
        )}
      </section>

      <section className="co-surface co-section">
        <SectionTitle
          title="Progression Decisions"
          subtitle="Exactly what is ready to move, what should hold, and what deserves attention."
        />
        <div className="co-progressionGrid">
          <div className="co-progressionColumn is-green">
            <div className="co-progressionHead">
              <StatusDot tone="green" />
              <h3>Ready to Progress</h3>
              <b>{progressionGroups.ready.length}</b>
            </div>
            {(progressionGroups.ready.length ? progressionGroups.ready.slice(0, 6) : []).map((row) => (
              <button type="button" key={row.id} onClick={() => navigate(`/library/${row.id}`)}>
                <span><strong>{row.name}</strong><small>{row.reason}</small></span>
                <b>{row.suggestedWeight ? formatWeight(row.suggestedWeight) : "VIEW"}</b>
              </button>
            ))}
            {!progressionGroups.ready.length ? <p>No exercises have earned a load increase yet.</p> : null}
          </div>

          <div className="co-progressionColumn is-blue">
            <div className="co-progressionHead">
              <StatusDot tone="blue" />
              <h3>Hold</h3>
              <b>{progressionGroups.hold.length}</b>
            </div>
            {(progressionGroups.hold.length ? progressionGroups.hold.slice(0, 6) : []).map((row) => (
              <button type="button" key={row.id} onClick={() => navigate(`/library/${row.id}`)}>
                <span><strong>{row.name}</strong><small>{row.reason}</small></span>
                <b>{formatWeight(row.currentWeight)}</b>
              </button>
            ))}
            {!progressionGroups.hold.length ? <p>No exercises currently need a hold decision.</p> : null}
          </div>

          <div className="co-progressionColumn is-amber">
            <div className="co-progressionHead">
              <StatusDot tone="amber" />
              <h3>Watch</h3>
              <b>{progressionGroups.watch.length}</b>
            </div>
            {(progressionGroups.watch.length ? progressionGroups.watch.slice(0, 6) : []).map((row) => (
              <button type="button" key={row.id} onClick={() => navigate(`/library/${row.id}`)}>
                <span><strong>{row.name}</strong><small>{row.reason}</small></span>
                <b>{row.currentPain != null ? `PAIN ${row.currentPain.toFixed(1)}` : "VIEW"}</b>
              </button>
            ))}
            {!progressionGroups.watch.length ? <p>No exercise pain trends currently require a watch.</p> : null}
          </div>
        </div>
      </section>

      <section className="co-surface co-section">
        <SectionTitle
          title="Training Signals"
          subtitle="A fast read on the signals driving Coach decisions."
        />
        <div className="co-signalRail">
          {signals.map((signal) => (
            <div key={signal.name} className={`is-${signal.tone}`}>
              <span>{signal.name}</span>
              <strong><StatusDot tone={signal.tone} /> {signal.label}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="co-surface co-section">
        <SectionTitle title="Needs Attention" subtitle="Only the issues that are meaningful enough to act on." />
        <div className="co-attentionList">
          {needsAttention.map((item, index) => (
            <div key={`${item.title}-${index}`} className={`co-attentionRow is-${item.tone}`}>
              <StatusDot tone={item.tone} />
              <div>
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="co-surface co-section">
        <SectionTitle
          title="Muscle Group Coaching"
          subtitle="Which groups are progressing fastest, stable, or falling behind."
        />
        <div className="co-muscleGrid">
          {muscleCoaching.length ? (
            muscleCoaching.slice(0, 8).map((row, index) => (
              <article className={`co-muscleCard is-${row.tone}`} key={row.name}>
                <div className="co-muscleTop">
                  <span>{index === 0 && (row.change ?? 0) > 0 ? "Strongest 30-Day Gain" : "Muscle Group"}</span>
                  <strong>{row.name}</strong>
                </div>
                <div className="co-muscleMetric">{formatPct(row.change)}</div>
                <small>{row.exerciseCount} tracked exercises</small>
                <p>{row.coach}</p>
              </article>
            ))
          ) : (
            <div className="co-empty">More repeated exercise data is needed for muscle-group coaching.</div>
          )}
        </div>
      </section>

      <section className="co-surface co-section">
        <SectionTitle title="Pain & Recovery Coach" subtitle="Exercise-specific pain trends and recovery decisions." />
        <div className="co-recoveryStrip">
          <div>
            <span>Overall Pain Trend</span>
            <strong className={(painTrend ?? 0) > .5 ? "is-redText" : (painTrend ?? 0) < -.5 ? "is-greenText" : ""}>
              {painTrend == null ? "Building Trend" : `${painTrend > 0 ? "+" : ""}${painTrend.toFixed(1)}`}
            </strong>
          </div>
          <div>
            <span>Exercises Rising</span>
            <strong>{exerciseInsights.filter((row) => (row.pain14 ?? 0) >= 1).length}</strong>
          </div>
          <div>
            <span>Exercises Improving</span>
            <strong>{exerciseInsights.filter((row) => (row.pain14 ?? 0) <= -1).length}</strong>
          </div>
          <div>
            <span>Recovery Status</span>
            <strong>{signals.find((row) => row.name === "Recovery")?.label ?? "Clear"}</strong>
          </div>
        </div>

        <div className="co-painRows">
          {exerciseInsights
            .filter((row) => row.currentPain != null || row.pain14 != null)
            .slice()
            .sort((a, b) => (b.currentPain ?? 0) - (a.currentPain ?? 0))
            .slice(0, 8)
            .map((row) => (
              <button type="button" key={row.id} onClick={() => navigate(`/library/${row.id}`)}>
                <span><strong>{row.name}</strong><small>{row.muscles.slice(0, 2).join(" • ") || "Exercise"}</small></span>
                <span><small>Current</small><strong>{row.currentPain == null ? "—" : row.currentPain.toFixed(1)}</strong></span>
                <span><small>14D</small><strong className={(row.pain14 ?? 0) > 0 ? "is-redText" : (row.pain14 ?? 0) < 0 ? "is-greenText" : ""}>{row.pain14 == null ? "—" : `${row.pain14 > 0 ? "+" : ""}${row.pain14.toFixed(1)}`}</strong></span>
                <b>View ›</b>
              </button>
            ))}
        </div>
      </section>

      <section className="co-surface co-section">
        <SectionTitle title="Program Review" subtitle="Coach's current assessment of the active program." />
        <div className="co-programReview">
          <div className="co-reviewIdentity">
            <span>Current Program</span>
            <strong>{activeProgramName}</strong>
            <small>{rotationNames.join(" → ") || "No rotation available"}</small>
          </div>
          <div className={`co-reviewOverall is-${programReview.tone}`}>
            <StatusDot tone={programReview.tone} />
            <div><span>Overall</span><strong>{programReview.overall}</strong></div>
          </div>
          <div className="co-reviewMetrics">
            <div><span>Strength 30D</span><strong>{formatPct(strengthTrend)}</strong></div>
            <div><span>Workload 30D</span><strong>{formatPct(volumeTrend.change)}</strong></div>
            <div><span>Workouts / Week</span><strong>{frequencyTrend.perWeek.toFixed(1)}</strong></div>
            <div><span>Biggest Gain</span><strong>{programReview.biggestGain?.name ?? "Building Trend"}</strong></div>
          </div>
          <div className="co-assessment">
            <span>Coach Assessment</span>
            <p>{programReview.assessment}</p>
          </div>
        </div>
      </section>

      <section className="co-surface co-section co-tipsSection">
        <SectionTitle
          title="Coach Tips"
          subtitle={`${COACH_TIPS.length} professional tips across training, nutrition, sleep, recovery, habits, hydration, mobility, and mindset.`}
        />

        <div className="co-tipTabs" role="tablist" aria-label="Coach tip categories">
          {COACH_TIP_CATEGORIES.map((category) => (
            <button
              type="button"
              key={category}
              className={tipCategory === category ? "is-active" : ""}
              onClick={() => {
                setTipCategory(category);
                chooseTip(category);
              }}
            >
              {titleCase(category)}
            </button>
          ))}
        </div>

        <div className={`co-featuredTip is-${tipCategory.toLowerCase()}`}>
          <div className="co-tipIcon"><SvgIcon name="tip" size={27} /></div>
          <div className="co-tipMain">
            <div className="co-tipMeta">Featured Coach Tip • {titleCase(featuredTip.category)} • {categoryCounts.get(featuredTip.category) ?? 0} in category</div>
            <h3>{featuredTip.title}</h3>
            <p>{featuredTip.advice}</p>
            <div className="co-tipWhy"><span>Why It Matters</span><strong>{featuredTip.why}</strong></div>
            <div className="co-tipAction"><span>Action</span><strong>{featuredTip.action}</strong></div>
          </div>
          <button type="button" className="co-nextTip" onClick={() => chooseTip(tipCategory)}>Next Tip ›</button>
        </div>
      </section>

      <section className="co-surface co-section">
        <SectionTitle title="Nutrition Coach" subtitle="Goal-specific nutrition guidance tied to your current program." />
        <div className="co-nutritionGrid">
          <div className="co-nutritionTarget">
            <SvgIcon name="nutrition" size={27} />
            <div><span>Current Goal</span><strong>{goalLabel(activeProgram?.goal)}</strong></div>
          </div>
          <div className="co-nutritionTarget">
            <div><span>Protein Target</span><strong>{latestProteinTarget == null ? "—" : `${latestProteinTarget} G`}</strong></div>
          </div>
          <div className="co-nutritionAdvice">
            <span>Coach</span>
            <strong>
              {latestProteinTarget == null
                ? "Log body weight or a protein target so Coach can make this guidance more specific."
                : `Build meals around protein and distribute roughly ${latestProteinTarget} g across the day instead of trying to catch up in one meal.`}
            </strong>
          </div>
          <button type="button" onClick={() => {
            setTipCategory("NUTRITION");
            chooseTip("NUTRITION");
            document.querySelector(".co-tipsSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}>Open Nutrition Tips ›</button>
        </div>
      </section>

      <section className="co-surface co-section">
        <SectionTitle title="Recommendation History" subtitle="Recent coaching decisions saved on this device." />
        <div className="co-historyList">
          {recommendationHistory.length ? recommendationHistory.slice(0, 8).map((row) => (
            <div className={`co-historyRow is-${row.tone}`} key={`${row.id}-${row.createdAt}`}>
              <StatusDot tone={row.tone} />
              <time>{fmtDate(row.createdAt)}</time>
              <strong>{row.title}</strong>
              <span>{row.action}</span>
            </div>
          )) : <div className="co-empty">Coach recommendation history will build as new decisions are generated.</div>}
        </div>
      </section>

      <section className="co-surface co-section co-programManagement">
        <SectionTitle title="Program Management" subtitle="Keep administration at the bottom so coaching stays the priority." />
        <div className="co-currentProgram">
          <div className="co-currentProgramIcon"><SvgIcon name="program" size={24} /></div>
          <div>
            <span>Current Program</span>
            <strong>{activeProgramName}</strong>
            <small>{activeProgram ? `${activeProgram.weeks ?? 4} weeks • ${fmtDate(activeProgram.start_date)} to ${fmtDate(activeProgram.end_date)}` : "Create a program to begin."}</small>
          </div>
          <div className="co-programActions">
            <button type="button" onClick={() => navigate("/")} disabled={!activeProgram}>View Workouts</button>
            <button type="button" onClick={openManage}>Manage Programs</button>
            <button type="button" className="is-primary" onClick={openBuilder}>Start New Program</button>
          </div>
        </div>

        {manageOpen ? (
          <div className="co-managePanel">
            <div className="co-manageHead">
              <div><span>Programs</span><strong>Manage saved programs</strong></div>
              <button type="button" onClick={() => setManageOpen(false)}>Close</button>
            </div>
            {manageErr ? <div className="co-error">{manageErr}</div> : null}
            {manageLoading ? <div className="co-empty">Loading programs…</div> : (
              <div className="co-programRows">
                {manageRows.map((row) => {
                  const active = row.status === "active";
                  return (
                    <div className={`co-programRow ${active ? "is-active" : ""}`} key={row.id}>
                      <input
                        type="checkbox"
                        checked={!!manageSelected[row.id]}
                        onChange={(event: any) => setManageSelected((current) => ({ ...current, [row.id]: event.target.checked }))}
                        disabled={manageBusy}
                      />
                      <div>
                        <strong>{goalLabel(row.goal)}</strong>
                        <span>{fmtDate(row.created_at)} • {row.workouts_count ?? 0} workouts • {row.completed_workouts_count ?? 0} completed</span>
                      </div>
                      <b>{active ? "ACTIVE" : "SAVED"}</b>
                      <button type="button" disabled={active || switching || manageBusy} onClick={() => void setActiveProgramBlock(row.id)}>
                        {active ? "Active" : "Set Active"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="co-manageFooter">
              <label><input type="checkbox" checked={deleteHistory} onChange={(event: any) => setDeleteHistory(event.target.checked)} /> Also delete linked workout history</label>
              <button type="button" className="is-danger" disabled={!selectedManageIds.length || manageBusy} onClick={() => setConfirmDeleteOpen(true)}>
                Delete Selected ({selectedManageIds.length})
              </button>
            </div>
          </div>
        ) : null}

        {builderOpen ? (
          <div className="co-builder" ref={builderRef}>
            <div className="co-builderHead">
              <div><span>New Program</span><strong>Build a new coaching program</strong></div>
              <button type="button" onClick={() => setBuilderOpen(false)}>Close</button>
            </div>

            <div className="co-builderSection">
              <h3>Program Type</h3>
              <div className="co-segmentRow">
                <button type="button" className={mode === "goal" ? "is-active" : ""} onClick={() => setMode("goal")}>Goal Program</button>
                <button type="button" className={mode === "symptom" ? "is-active" : ""} onClick={() => setMode("symptom")}>Targeted Program</button>
              </div>
            </div>

            {mode === "goal" ? (
              <div className="co-builderSection">
                <h3>Goal</h3>
                <div className="co-segmentRow co-four">
                  {(["bulk", "strength", "cut", "fitness"] as GoalKey[]).map((value) => (
                    <button type="button" key={value} className={goal === value ? "is-active" : ""} onClick={() => setGoal(value)}>{goalLabel(value)}</button>
                  ))}
                </div>
                <label className="co-field"><span>Optional Focus</span><input value={focus} onChange={(event: any) => setFocus(event.target.value)} placeholder="Example: Back, Quads, Arms" /></label>
              </div>
            ) : null}

            {mode === "symptom" ? (
              <div className="co-builderSection">
                <h3>Target</h3>
                <div className="co-segmentRow co-wrap">
                  {(["posture", "shoulder_pain", "back_pain", "knee_pain", "elbow_wrist"] as SymptomKey[]).map((value) => (
                    <button type="button" key={value} className={symptom === value ? "is-active" : ""} onClick={() => setSymptom(value)}>{symptomLabel(value)}</button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="co-builderGrid">
              <div className="co-builderSection">
                <h3>Equipment</h3>
                <div className="co-segmentRow">
                  <button type="button" className={equipGym ? "is-active" : ""} onClick={() => setEquipGym((value) => !value)}>Gym</button>
                  <button type="button" className={equipHome ? "is-active" : ""} onClick={() => setEquipHome((value) => !value)}>Home</button>
                </div>
              </div>
              <div className="co-builderSection">
                <h3>Body Data</h3>
                <div className="co-bodyFields">
                  <label className="co-field"><span>Height Ft</span><input value={heightFt} inputMode="numeric" onChange={(event: any) => setHeightFt(event.target.value.replace(/[^\d]/g, ""))} /></label>
                  <label className="co-field"><span>Height In</span><input value={heightIn} inputMode="numeric" onChange={(event: any) => setHeightIn(event.target.value.replace(/[^\d]/g, ""))} /></label>
                  <label className="co-field"><span>Weight LB</span><input value={weightLb} inputMode="decimal" onChange={(event: any) => setWeightLb(event.target.value.replace(/[^\d.]/g, ""))} /></label>
                  <label className="co-field"><span>Age</span><input value={age} inputMode="numeric" onChange={(event: any) => setAge(event.target.value.replace(/[^\d]/g, ""))} /></label>
                </div>
              </div>
            </div>

            <div className="co-builderActions">
              <button type="button" disabled={!mode || saving || generating} onClick={() => void saveIntake()}>{saving ? "Saving…" : "Save Intake"}</button>
              <button type="button" className="is-primary" disabled={!mode || saving || generating} onClick={() => void generateProgram()}>{generating ? "Generating…" : "Generate Program"}</button>
            </div>
          </div>
        ) : null}
      </section>


      {confirmDeleteOpen ? (
        <div className="co-confirmOverlay" role="presentation" onMouseDown={(event: any) => { if (event.target === event.currentTarget && !manageBusy) setConfirmDeleteOpen(false); }}>
          <section className="co-confirmModal" role="dialog" aria-modal="true" aria-labelledby="co-delete-title">
            <span>Program Management</span>
            <h2 id="co-delete-title">Delete selected programs?</h2>
            <p>You're about to permanently delete {selectedManageIds.length} selected program{selectedManageIds.length === 1 ? "" : "s"}{deleteHistory ? " and their linked workout history" : ""}.</p>
            <div>
              <button type="button" onClick={() => setConfirmDeleteOpen(false)} disabled={manageBusy}>Cancel</button>
              <button type="button" className="is-danger" onClick={() => void deleteSelectedPrograms()} disabled={manageBusy}>{manageBusy ? "Deleting…" : "Delete Programs"}</button>
            </div>
          </section>
        </div>
      ) : null}

      <style>{`
        .co-page{
          --co-bg:#05090d;
          --co-surface:#0a1218;
          --co-surface2:#0e1a22;
          --co-line:rgba(132,199,223,.13);
          --co-lineHi:rgba(196,233,247,.24);
          --co-text:#f4f9fb;
          --co-muted:rgba(200,219,228,.62);
          --co-cyan:#51cff5;
          --co-green:#54dfa1;
          --co-amber:#efa94f;
          --co-red:#ff7474;
          display:grid;
          gap:12px;
          padding-bottom:36px;
          color:var(--co-text);
        }
        .co-page *{box-sizing:border-box}
        .co-page button,.co-page input{font:inherit}
        .co-surface{
          position:relative;
          isolation:isolate;
          overflow:visible;
          border:1px solid var(--co-line);
          border-top-color:var(--co-lineHi);
          border-radius:15px;
          background:
            linear-gradient(180deg,rgba(16,29,37,.985),rgba(8,16,22,.99) 58%,rgba(5,10,14,.995));
          box-shadow:
            0 1px 0 rgba(255,255,255,.035),
            0 5px 8px rgba(0,0,0,.31),
            0 18px 42px rgba(0,0,0,.18),
            inset 0 1px 0 rgba(255,255,255,.035);
        }
        .co-surface::before{
          content:"";
          position:absolute;
          inset:0;
          z-index:-1;
          pointer-events:none;
          border-radius:inherit;
          background:linear-gradient(112deg,rgba(255,255,255,.018),transparent 24%,transparent 72%,rgba(63,188,232,.012));
        }
        .co-hero{
          min-height:118px;
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:22px;
          padding:20px;
        }
        .co-hero h1{
          margin:0;
          color:#fff;
          font-size:clamp(42px,5vw,58px);
          line-height:.88;
          font-weight:1000;
          letter-spacing:-.055em;
          text-shadow:0 3px 4px rgba(0,0,0,.42);
        }
        .co-programName{margin-top:11px;color:#edf8fb;font-size:18px;font-weight:1000;letter-spacing:-.02em}
        .co-rotation{display:flex;flex-wrap:wrap;gap:6px 9px;margin-top:8px;color:var(--co-muted);font-size:9px;font-weight:900}
        .co-rotation span{display:inline-flex;align-items:center;gap:9px}.co-rotation b{color:#cce5ee}.co-rotation i{color:rgba(81,207,245,.38);font-style:normal}
        .co-heroStatus{
          min-width:230px;
          padding:11px 13px;
          border-left:2px solid rgba(81,207,245,.42);
          background:linear-gradient(90deg,rgba(31,100,124,.13),transparent 88%);
        }
        .co-heroStatus span,.co-sectionTitle p,.co-heroStatus small{color:var(--co-muted)}
        .co-heroStatus span{display:block;font-size:8px;font-weight:1000;text-transform:uppercase;letter-spacing:.09em}
        .co-heroStatus strong{display:block;margin-top:5px;color:#fff;font-size:16px;font-weight:1000}
        .co-heroStatus small{display:block;margin-top:5px;font-size:8px;font-weight:800}
        .co-section{padding:17px}
        .co-sectionTitle{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:14px}
        .co-sectionTitleText{display:flex;gap:10px;min-width:0}.co-sectionAccent{width:3px;height:37px;flex:0 0 3px;border-radius:3px;background:linear-gradient(180deg,#87e5ff,#159fda);box-shadow:0 0 9px rgba(53,190,238,.18)}
        .co-sectionTitle h2{margin:0;color:#fff;font-size:24px;line-height:1;font-weight:1000;letter-spacing:-.035em}
        .co-sectionTitle p{margin:5px 0 0;font-size:9px;line-height:1.4;font-weight:760}
        .co-sectionRight{display:flex;align-items:center;justify-content:flex-end}
        .co-icon{fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
        .co-statusDot{width:8px;height:8px;flex:0 0 8px;border-radius:50%;background:var(--co-cyan);box-shadow:0 0 8px rgba(81,207,245,.25)}
        .co-statusDot.is-green{background:var(--co-green);box-shadow:0 0 8px rgba(84,223,161,.22)}
        .co-statusDot.is-amber{background:var(--co-amber);box-shadow:0 0 8px rgba(239,169,79,.22)}
        .co-statusDot.is-red{background:var(--co-red);box-shadow:0 0 8px rgba(255,116,116,.22)}
        .co-statusDot.is-neutral{background:rgba(197,217,226,.60);box-shadow:none}
        .co-error{padding:10px 12px;border:1px solid rgba(255,116,116,.22);border-radius:9px;color:#ffd1d1;background:rgba(106,33,33,.15);font-size:10px;font-weight:900}
        .co-toast{position:fixed;right:18px;bottom:84px;z-index:10000;display:flex;align-items:center;justify-content:space-between;gap:12px;width:min(430px,calc(100vw - 36px));padding:11px 12px;border:1px solid rgba(81,207,245,.34);border-radius:10px;color:#eefaff;background:#0a1820;box-shadow:0 18px 50px rgba(0,0,0,.55);font-size:10px;font-weight:900}
        .co-toast.is-err{border-color:rgba(255,116,116,.35);background:#1b0d10}.co-toast button{border:0;color:#7cddfb;background:transparent;font-size:9px;font-weight:1000;cursor:pointer}
        .co-briefingGrid{display:grid;grid-template-columns:minmax(0,1.3fr) repeat(2,minmax(0,1fr));gap:9px}
        .co-briefCard{position:relative;min-height:182px;padding:14px 14px 13px;border-left:2px solid rgba(81,207,245,.42);background:linear-gradient(105deg,rgba(34,100,124,.12),transparent 75%)}
        .co-briefCard.is-lead{background:linear-gradient(110deg,rgba(36,117,145,.16),rgba(9,19,25,.18) 70%)}
        .co-briefCard.is-green{border-left-color:var(--co-green)}.co-briefCard.is-amber{border-left-color:var(--co-amber)}.co-briefCard.is-red{border-left-color:var(--co-red)}
        .co-briefTop{display:flex;align-items:center;justify-content:space-between}.co-briefTop>span{color:#7ddbf8;font-size:8px;font-weight:1000;letter-spacing:.12em}
        .co-briefCard h3{margin:10px 0 0;color:#fff;font-size:clamp(18px,2vw,25px);line-height:1;font-weight:1000;letter-spacing:-.03em}.co-briefCard p{margin:8px 0 0;color:rgba(204,222,230,.66);font-size:9px;line-height:1.45;font-weight:780}.co-briefAction{margin-top:12px;color:#f3f9fb;font-size:10px;line-height:1.4;font-weight:950}.co-briefCard button{position:absolute;left:14px;bottom:12px;border:0;color:#72d7f7;background:transparent;padding:0;font-size:8px;font-weight:1000;cursor:pointer}
        .co-primaryAction{min-height:36px;padding:0 13px;border:1px solid rgba(81,207,245,.36);border-radius:8px;color:#f4fbfd;background:rgba(21,93,118,.16);font-size:9px;font-weight:1000;cursor:pointer}
        .co-nextWorkoutHead{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:11px 13px;border-left:2px solid rgba(81,207,245,.32);background:linear-gradient(90deg,rgba(31,84,104,.10),transparent 90%)}
        .co-nextWorkoutHead span,.co-nextWorkoutHead small,.co-decisionLoad span,.co-decisionIdentity span,.co-recoveryStrip span,.co-reviewIdentity span,.co-reviewIdentity small,.co-reviewMetrics span,.co-assessment span,.co-nutritionTarget span,.co-nutritionAdvice span{display:block;color:rgba(177,205,217,.59);font-size:8px;font-weight:900;text-transform:uppercase;letter-spacing:.07em}
        .co-nextWorkoutHead strong{display:block;margin-top:4px;color:#fff;font-size:19px;font-weight:1000}.co-nextWorkoutHead small{margin-top:5px;text-transform:none;letter-spacing:0}
        .co-decisionRows{display:grid;gap:6px;margin-top:10px}.co-decisionRow{display:grid;grid-template-columns:minmax(190px,1.2fr) 92px 92px 115px minmax(230px,1.4fr) 50px;align-items:center;gap:10px;padding:10px 11px;border-left:2px solid rgba(188,213,222,.22);background:linear-gradient(90deg,rgba(23,56,68,.08),transparent 88%)}.co-decisionRow.is-green{border-left-color:var(--co-green)}.co-decisionRow.is-amber{border-left-color:var(--co-amber)}.co-decisionRow.is-blue{border-left-color:var(--co-cyan)}
        .co-decisionIdentity strong{display:block;color:#fff;font-size:11px;font-weight:1000}.co-decisionIdentity span{margin-top:4px;text-transform:none;letter-spacing:0}.co-decisionLoad strong{display:block;margin-top:5px;color:#eef8fb;font-size:12px;font-weight:1000}.co-decisionState{display:flex;align-items:center;gap:7px}.co-decisionState strong{color:#eef8fb;font-size:8px;font-weight:1000;letter-spacing:.05em}.co-decisionRow>p{margin:0;color:rgba(195,214,223,.60);font-size:8px;line-height:1.35;font-weight:760}.co-decisionRow>button{border:0;color:#75d8f8;background:transparent;font-size:8px;font-weight:1000;cursor:pointer}
        .co-progressionGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.co-progressionColumn{padding:12px;border-top:1px solid rgba(126,191,216,.10);border-bottom:1px solid rgba(126,191,216,.08);background:rgba(8,17,23,.46)}.co-progressionColumn.is-green{box-shadow:inset 2px 0 0 rgba(84,223,161,.62)}.co-progressionColumn.is-blue{box-shadow:inset 2px 0 0 rgba(81,207,245,.50)}.co-progressionColumn.is-amber{box-shadow:inset 2px 0 0 rgba(239,169,79,.62)}
        .co-progressionHead{display:flex;align-items:center;gap:8px;margin-bottom:8px}.co-progressionHead h3{margin:0;color:#fff;font-size:13px;font-weight:1000}.co-progressionHead>b{margin-left:auto;color:#dff3fa;font-size:12px}.co-progressionColumn>button{width:100%;display:flex;align-items:center;justify-content:space-between;gap:9px;padding:9px 0;border:0;border-top:1px solid rgba(129,193,216,.07);color:#fff;background:transparent;text-align:left;cursor:pointer}.co-progressionColumn>button>span{min-width:0}.co-progressionColumn>button strong{display:block;overflow:hidden;font-size:9px;white-space:nowrap;text-overflow:ellipsis}.co-progressionColumn>button small{display:block;margin-top:3px;overflow:hidden;color:rgba(183,207,217,.50);font-size:7px;white-space:nowrap;text-overflow:ellipsis}.co-progressionColumn>button>b{color:#9bdff5;font-size:8px;white-space:nowrap}.co-progressionColumn>p{margin:9px 0 0;color:rgba(184,207,217,.50);font-size:8px;line-height:1.4}
        .co-signalRail{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));border-top:1px solid rgba(129,193,216,.10);border-bottom:1px solid rgba(129,193,216,.08)}.co-signalRail>div{padding:13px 11px}.co-signalRail>div+div{border-left:1px solid rgba(130,193,216,.09)}.co-signalRail span{display:block;color:rgba(174,204,217,.58);font-size:7px;font-weight:1000;text-transform:uppercase;letter-spacing:.07em}.co-signalRail strong{display:flex;align-items:center;gap:7px;margin-top:7px;color:#f2f9fb;font-size:10px;font-weight:1000}
        .co-attentionList{display:grid;gap:7px}.co-attentionRow{display:flex;align-items:flex-start;gap:9px;padding:10px 12px;border-left:2px solid rgba(81,207,245,.30);background:linear-gradient(90deg,rgba(31,84,104,.09),transparent 90%)}.co-attentionRow.is-green{border-left-color:var(--co-green)}.co-attentionRow.is-amber{border-left-color:var(--co-amber)}.co-attentionRow.is-red{border-left-color:var(--co-red)}.co-attentionRow strong{display:block;color:#f1f8fb;font-size:10px}.co-attentionRow p{margin:4px 0 0;color:rgba(190,211,220,.57);font-size:8px;line-height:1.4}
        .co-muscleGrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.co-muscleCard{min-height:155px;padding:12px;border-top:1px solid rgba(129,193,216,.10);border-bottom:1px solid rgba(129,193,216,.08);box-shadow:inset 2px 0 0 rgba(81,207,245,.28);background:linear-gradient(100deg,rgba(25,71,88,.08),transparent 85%)}.co-muscleCard.is-green{box-shadow:inset 2px 0 0 rgba(84,223,161,.55)}.co-muscleCard.is-amber{box-shadow:inset 2px 0 0 rgba(239,169,79,.55)}.co-muscleCard.is-red{box-shadow:inset 2px 0 0 rgba(255,116,116,.55)}.co-muscleTop span{display:block;color:rgba(170,201,214,.53);font-size:7px;font-weight:1000;text-transform:uppercase}.co-muscleTop strong{display:block;margin-top:4px;color:#fff;font-size:15px}.co-muscleMetric{margin-top:11px;color:#7ce5b5;font-size:24px;font-weight:1000;letter-spacing:-.04em}.co-muscleCard.is-red .co-muscleMetric{color:#ff9595}.co-muscleCard small{display:block;margin-top:4px;color:rgba(180,205,216,.50);font-size:7px}.co-muscleCard p{margin:10px 0 0;color:rgba(199,217,225,.62);font-size:8px;line-height:1.4}
        .co-recoveryStrip{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-top:1px solid rgba(129,193,216,.10);border-bottom:1px solid rgba(129,193,216,.08)}.co-recoveryStrip>div{padding:13px}.co-recoveryStrip>div+div{border-left:1px solid rgba(130,193,216,.09)}.co-recoveryStrip strong{display:block;margin-top:6px;color:#fff;font-size:16px}.is-redText{color:#ff8f8f!important}.is-greenText{color:#6ce5aa!important}
        .co-painRows{display:grid;gap:5px;margin-top:10px}.co-painRows>button{display:grid;grid-template-columns:minmax(200px,1fr) 72px 72px 52px;align-items:center;gap:10px;width:100%;padding:9px 10px;border:0;border-top:1px solid rgba(128,192,216,.08);color:#eef8fb;background:transparent;text-align:left;cursor:pointer}.co-painRows strong{display:block;font-size:9px}.co-painRows small{display:block;margin-top:3px;color:rgba(180,205,216,.50);font-size:7px}.co-painRows>b{color:#73d7f7;font-size:8px;text-align:right}
        .co-programReview{display:grid;grid-template-columns:minmax(250px,1fr) 170px;gap:10px}.co-reviewIdentity{padding:11px 13px;border-left:2px solid rgba(81,207,245,.34);background:linear-gradient(90deg,rgba(32,89,109,.10),transparent 90%)}.co-reviewIdentity strong{display:block;margin-top:5px;color:#fff;font-size:18px}.co-reviewIdentity small{margin-top:5px;text-transform:none;letter-spacing:0}.co-reviewOverall{display:flex;align-items:center;justify-content:center;gap:8px;border:1px solid rgba(81,207,245,.13);border-radius:10px;background:rgba(14,44,56,.10)}.co-reviewOverall>div span{display:block;color:rgba(180,205,216,.53);font-size:7px;text-transform:uppercase}.co-reviewOverall>div strong{display:block;margin-top:4px;color:#fff;font-size:13px}.co-reviewMetrics{grid-column:1/-1;display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid rgba(129,193,216,.09);border-bottom:1px solid rgba(129,193,216,.07)}.co-reviewMetrics>div{padding:12px}.co-reviewMetrics>div+div{border-left:1px solid rgba(130,193,216,.09)}.co-reviewMetrics strong{display:block;margin-top:6px;color:#fff;font-size:14px}.co-assessment{grid-column:1/-1;padding:11px 13px;border-left:2px solid rgba(81,207,245,.34);background:linear-gradient(90deg,rgba(31,83,102,.09),transparent 90%)}.co-assessment p{margin:5px 0 0;color:rgba(214,229,235,.70);font-size:9px;line-height:1.48;font-weight:790}
        .co-tipTabs{display:flex;gap:18px;overflow-x:auto;padding:0 2px 9px;border-bottom:1px solid rgba(128,192,216,.09)}.co-tipTabs button{position:relative;flex:0 0 auto;padding:4px 0 7px;border:0;color:rgba(189,211,221,.57);background:transparent;font-size:9px;font-weight:900;cursor:pointer}.co-tipTabs button::after{content:"";position:absolute;left:0;right:0;bottom:0;height:2px;border-radius:2px;background:transparent}.co-tipTabs button.is-active{color:#fff}.co-tipTabs button.is-active::after{background:var(--co-cyan);box-shadow:0 0 8px rgba(81,207,245,.28)}
        .co-featuredTip{display:grid;grid-template-columns:48px minmax(0,1fr) auto;gap:15px;align-items:start;margin-top:13px;padding:16px;border-left:3px solid rgba(81,207,245,.56);background:linear-gradient(100deg,rgba(34,102,128,.13),transparent 79%)}.co-featuredTip.is-nutrition{border-left-color:#64dca2}.co-featuredTip.is-sleep{border-left-color:#8b9cff}.co-featuredTip.is-recovery{border-left-color:#61d5d2}.co-featuredTip.is-habits{border-left-color:#efb05d}.co-featuredTip.is-hydration{border-left-color:#61b9ff}.co-featuredTip.is-mobility{border-left-color:#70d8ec}.co-featuredTip.is-mindset{border-left-color:#c69bff}.co-tipIcon{width:45px;height:45px;display:grid;place-items:center;border:1px solid rgba(81,207,245,.16);border-radius:11px;color:#79daf8;background:#0a171e}.co-tipMeta{color:#78d8f7;font-size:8px;font-weight:1000;text-transform:uppercase;letter-spacing:.08em}.co-tipMain h3{margin:8px 0 0;color:#fff;font-size:25px;line-height:1;font-weight:1000;letter-spacing:-.035em}.co-tipMain>p{margin:9px 0 0;max-width:850px;color:rgba(216,230,236,.72);font-size:10px;line-height:1.5;font-weight:780}.co-tipWhy,.co-tipAction{margin-top:12px;padding-top:10px;border-top:1px solid rgba(128,192,216,.08)}.co-tipWhy span,.co-tipAction span{display:block;color:rgba(170,201,214,.56);font-size:7px;text-transform:uppercase;font-weight:1000;letter-spacing:.08em}.co-tipWhy strong,.co-tipAction strong{display:block;margin-top:5px;color:#eef8fb;font-size:9px;line-height:1.4}.co-nextTip{min-height:37px;padding:0 12px;border:1px solid rgba(81,207,245,.22);border-radius:8px;color:#eaf7fb;background:rgba(20,78,98,.12);font-size:8px;font-weight:1000;cursor:pointer}
        .co-nutritionGrid{display:grid;grid-template-columns:220px 180px minmax(280px,1fr) auto;gap:9px;align-items:stretch}.co-nutritionTarget,.co-nutritionAdvice{display:flex;align-items:center;gap:10px;padding:11px 12px;border-left:2px solid rgba(84,223,161,.38);background:linear-gradient(90deg,rgba(34,100,73,.10),transparent 90%)}.co-nutritionTarget{color:#70dda8}.co-nutritionTarget strong,.co-nutritionAdvice strong{display:block;margin-top:5px;color:#fff;font-size:13px;line-height:1.35}.co-nutritionGrid>button{padding:0 13px;border:1px solid rgba(84,223,161,.20);border-radius:8px;color:#dff8eb;background:rgba(34,95,67,.11);font-size:8px;font-weight:1000;cursor:pointer}
        .co-historyList{display:grid;gap:5px}.co-historyRow{display:grid;grid-template-columns:9px 84px 160px minmax(0,1fr);align-items:center;gap:9px;padding:9px 10px;border-top:1px solid rgba(129,193,216,.07)}.co-historyRow time{color:rgba(178,203,214,.52);font-size:8px}.co-historyRow strong{color:#f0f8fb;font-size:9px}.co-historyRow>span:last-child{color:rgba(196,215,224,.62);font-size:8px;line-height:1.35}
        .co-currentProgram{display:grid;grid-template-columns:46px minmax(0,1fr) auto;align-items:center;gap:12px;padding:12px 13px;border-left:2px solid rgba(81,207,245,.35);background:linear-gradient(90deg,rgba(31,89,111,.10),transparent 90%)}.co-currentProgramIcon{width:42px;height:42px;display:grid;place-items:center;border:1px solid rgba(81,207,245,.14);border-radius:10px;color:#72d8f7;background:#0a171e}.co-currentProgram>div:nth-child(2)>span{display:block;color:rgba(174,203,216,.56);font-size:7px;text-transform:uppercase;font-weight:1000}.co-currentProgram>div:nth-child(2)>strong{display:block;margin-top:4px;color:#fff;font-size:17px}.co-currentProgram>div:nth-child(2)>small{display:block;margin-top:4px;color:rgba(184,208,218,.54);font-size:8px}.co-programActions{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}.co-programActions button,.co-builderActions button,.co-manageHead button,.co-programRow button,.co-builderHead button{min-height:35px;padding:0 11px;border:1px solid rgba(81,207,245,.18);border-radius:8px;color:#eaf7fb;background:rgba(14,54,70,.16);font-size:8px;font-weight:1000;cursor:pointer}.co-programActions button.is-primary,.co-builderActions button.is-primary{border-color:rgba(81,207,245,.45);background:linear-gradient(180deg,rgba(30,151,195,.25),rgba(13,76,101,.20));box-shadow:inset 0 1px 0 rgba(255,255,255,.05)}
        .co-managePanel,.co-builder{margin-top:11px;padding:13px;border:1px solid rgba(126,192,216,.11);border-radius:12px;background:#081117}.co-manageHead,.co-builderHead{display:flex;align-items:center;justify-content:space-between;gap:12px}.co-manageHead span,.co-builderHead span{display:block;color:rgba(171,201,214,.55);font-size:7px;text-transform:uppercase}.co-manageHead strong,.co-builderHead strong{display:block;margin-top:4px;color:#fff;font-size:14px}.co-programRows{display:grid;gap:5px;margin-top:11px;max-height:360px;overflow:auto}.co-programRow{display:grid;grid-template-columns:20px minmax(0,1fr) 70px 80px;align-items:center;gap:9px;padding:9px 10px;border-left:2px solid rgba(180,207,218,.14);background:rgba(12,24,31,.58)}.co-programRow.is-active{border-left-color:var(--co-cyan);background:linear-gradient(90deg,rgba(31,111,142,.12),rgba(12,24,31,.40))}.co-programRow>div strong{display:block;color:#fff;font-size:10px}.co-programRow>div span{display:block;margin-top:3px;color:rgba(181,205,216,.50);font-size:7px}.co-programRow>b{color:#78d8f7;font-size:7px}.co-manageFooter{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:10px;padding-top:10px;border-top:1px solid rgba(128,192,216,.08)}.co-manageFooter label{display:flex;align-items:center;gap:7px;color:rgba(195,214,223,.62);font-size:8px}.co-manageFooter>button{min-height:35px;padding:0 11px;border:1px solid rgba(255,116,116,.22);border-radius:8px;color:#ffc3c3;background:rgba(94,29,29,.12);font-size:8px;font-weight:1000}.co-manageFooter>button:disabled{opacity:.4}
        .co-builder{scroll-margin-top:18px}.co-builderSection{margin-top:12px}.co-builderSection h3{margin:0 0 8px;color:#eef8fb;font-size:11px}.co-segmentRow{display:flex;gap:7px;flex-wrap:wrap}.co-segmentRow.co-four{display:grid;grid-template-columns:repeat(4,1fr)}.co-segmentRow button{min-height:38px;padding:0 12px;border:1px solid rgba(126,191,216,.14);border-radius:8px;color:rgba(218,233,239,.70);background:#0a141a;font-size:8px;font-weight:1000;cursor:pointer}.co-segmentRow button.is-active{color:#fff;border-color:rgba(81,207,245,.48);background:linear-gradient(180deg,rgba(30,133,171,.22),rgba(13,72,94,.18));box-shadow:inset 0 1px 0 rgba(255,255,255,.04)}.co-builderGrid{display:grid;grid-template-columns:.8fr 1.2fr;gap:12px}.co-field{display:grid;gap:5px;margin-top:9px}.co-field span{color:rgba(172,201,214,.56);font-size:7px;text-transform:uppercase;font-weight:1000}.co-field input{width:100%;min-height:39px;padding:0 10px;border:1px solid rgba(127,192,216,.14);border-radius:8px;outline:0;color:#fff;background:#071016;font-size:9px;font-weight:850}.co-field input:focus{border-color:rgba(81,207,245,.45)}.co-bodyFields{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}.co-builderActions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid rgba(128,192,216,.08)}

        .co-confirmOverlay{position:fixed;z-index:10020;inset:0;display:grid;place-items:center;padding:18px;background:rgba(2,6,9,.84);backdrop-filter:blur(8px)}.co-confirmModal{width:min(460px,100%);padding:17px;border:1px solid rgba(255,116,116,.22);border-top-color:rgba(255,183,183,.28);border-radius:14px;background:linear-gradient(180deg,#171a20,#0a0e13);box-shadow:0 28px 90px rgba(0,0,0,.65)}.co-confirmModal>span{color:#ff9d9d;font-size:8px;font-weight:1000;text-transform:uppercase;letter-spacing:.08em}.co-confirmModal h2{margin:7px 0 0;color:#fff;font-size:22px;font-weight:1000}.co-confirmModal p{margin:8px 0 0;color:rgba(220,231,236,.68);font-size:10px;line-height:1.5}.co-confirmModal>div{display:flex;justify-content:flex-end;gap:8px;margin-top:15px}.co-confirmModal button{min-height:37px;padding:0 13px;border:1px solid rgba(127,192,216,.15);border-radius:8px;color:#eaf5f8;background:#0d171d;font-size:9px;font-weight:1000}.co-confirmModal button.is-danger{border-color:rgba(255,116,116,.30);color:#ffd1d1;background:rgba(111,32,32,.32)}.co-confirmModal button:disabled{opacity:.45}
        .co-empty{display:grid;place-items:center;min-height:92px;padding:16px;color:rgba(183,207,217,.52);font-size:9px;text-align:center}
        @media(max-width:1100px){
          .co-briefingGrid{grid-template-columns:1fr 1fr}.co-briefCard.is-lead{grid-column:1/-1}
          .co-decisionRow{grid-template-columns:minmax(170px,1fr) 82px 82px 105px}.co-decisionRow>p{grid-column:1/-2}.co-decisionRow>button{grid-column:-2/-1;grid-row:2}
          .co-signalRail{grid-template-columns:repeat(3,1fr)}.co-signalRail>div:nth-child(4){border-left:0;border-top:1px solid rgba(130,193,216,.09)}.co-signalRail>div:nth-child(n+4){border-top:1px solid rgba(130,193,216,.09)}
          .co-muscleGrid{grid-template-columns:repeat(2,1fr)}
          .co-nutritionGrid{grid-template-columns:1fr 1fr}.co-nutritionAdvice{grid-column:1/-1}.co-nutritionGrid>button{min-height:38px}
        }
        @media(max-width:820px){
          .co-page{gap:9px}.co-hero,.co-section{padding:13px;border-radius:14px}.co-hero{display:grid}.co-heroStatus{min-width:0}
          .co-sectionTitle{display:grid}.co-sectionRight{justify-content:flex-start}
          .co-progressionGrid{grid-template-columns:1fr}.co-muscleGrid{grid-template-columns:1fr 1fr}
          .co-programReview{grid-template-columns:1fr}.co-reviewOverall{min-height:60px}.co-reviewMetrics{grid-column:auto;grid-template-columns:repeat(2,1fr)}.co-assessment{grid-column:auto}
          .co-featuredTip{grid-template-columns:44px 1fr}.co-nextTip{grid-column:2;justify-self:start}
          .co-currentProgram{grid-template-columns:42px 1fr}.co-programActions{grid-column:1/-1;justify-content:flex-start}
          .co-builderGrid{grid-template-columns:1fr}.co-historyRow{grid-template-columns:9px 72px minmax(120px,.5fr) 1fr}
        }
        @media(max-width:620px){
          .co-briefingGrid{grid-template-columns:1fr}.co-briefCard.is-lead{grid-column:auto}
          .co-decisionRow{grid-template-columns:1fr 1fr}.co-decisionIdentity{grid-column:1/-1}.co-decisionState{justify-self:end}.co-decisionRow>p{grid-column:1/-1}.co-decisionRow>button{grid-column:1/-1;grid-row:auto;justify-self:start}
          .co-signalRail{grid-template-columns:1fr 1fr}.co-signalRail>div:nth-child(3),.co-signalRail>div:nth-child(5){border-left:0}.co-signalRail>div:nth-child(n+3){border-top:1px solid rgba(130,193,216,.09)}
          .co-muscleGrid{grid-template-columns:1fr}.co-recoveryStrip{grid-template-columns:1fr 1fr}.co-recoveryStrip>div:nth-child(3){border-left:0;border-top:1px solid rgba(130,193,216,.09)}.co-recoveryStrip>div:nth-child(4){border-top:1px solid rgba(130,193,216,.09)}
          .co-painRows>button{grid-template-columns:1fr 58px 58px}.co-painRows>b{grid-column:1/-1;text-align:left}
          .co-reviewMetrics{grid-template-columns:1fr 1fr}.co-tipTabs{gap:14px}.co-featuredTip{grid-template-columns:1fr}.co-tipIcon{display:none}.co-nextTip{grid-column:auto}
          .co-nutritionGrid{grid-template-columns:1fr}.co-nutritionAdvice{grid-column:auto}.co-historyRow{grid-template-columns:9px 70px 1fr}.co-historyRow>span:last-child{grid-column:3}
          .co-programRow{grid-template-columns:20px 1fr 70px}.co-programRow>button{grid-column:2/-1;justify-self:start}.co-manageFooter{align-items:flex-start;flex-direction:column}.co-bodyFields{grid-template-columns:1fr 1fr}.co-segmentRow.co-four{grid-template-columns:1fr 1fr}
        }
        @media(prefers-reduced-motion:reduce){.co-page *{scroll-behavior:auto!important;transition:none!important}}
      `}</style>
    </div>
  );
}
