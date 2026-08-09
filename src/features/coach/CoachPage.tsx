// src/features/coach/CoachPage.tsx
// MVP Trainer Pro - semantic program identity + clear coaching decisions + responsive pro UI
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
type Decision = "INCREASE" | "HOLD" | "REDUCE" | "REPEAT & ASSESS";

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

type IntakeSnapshotRow = {
  id: string;
  constraints?: any;
  symptoms?: any;
  aesthetic_interests?: any;
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
  change30: number | null;
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

const HISTORY_KEY = "mvp-coach-recommendation-history-v3";
const TIP_RECENT_KEY = "mvp-coach-tip-recent-v3";

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function num(value: any, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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
  const normalized = String(goal ?? "").toLowerCase();
  if (["build_muscle", "bulk", "muscle_gain"].includes(normalized)) return "Muscle Gain";
  if (["lose_weight", "cut"].includes(normalized)) return "Cut";
  if (normalized === "strength") return "Strength";
  if (normalized === "fitness") return "Fitness";
  return titleCase(goal) || "Training";
}

function goalKeyForTips(goal: string | null | undefined) {
  const normalized = String(goal ?? "").toLowerCase();
  if (["build_muscle", "bulk", "muscle_gain"].includes(normalized)) return "muscle_gain";
  if (["lose_weight", "cut"].includes(normalized)) return "cut";
  if (normalized === "strength") return "strength";
  if (normalized === "fitness") return "fitness";
  return "all";
}

function symptomLabel(value: string | null | undefined) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "posture") return "Posture";
  if (normalized === "shoulder_pain") return "Shoulder";
  if (normalized === "back_pain") return "Back";
  if (normalized === "knee_pain") return "Knee";
  if (normalized === "elbow_wrist") return "Elbow / Wrist";
  return titleCase(value) || "Targeted Training";
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

function cleanWorkoutName(value: string | null | undefined) {
  const raw = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return "Workout";
  const canonical = raw.match(/\b(upper|lower)\s*([12])\b/i);
  if (canonical) return `${titleCase(canonical[1])} ${canonical[2]}`;
  const pieces = raw
    .split(/\s*[•|/]\s*/)
    .map((piece) => piece.trim())
    .filter(Boolean)
    .filter((piece) => !/\d{4}-\d{2}-\d{2}/.test(piece))
    .filter((piece) => !/^(future|past|scheduled|completed|active|session)$/i.test(piece));
  const deduped = pieces.filter((piece, index) => pieces.findIndex((candidate) => candidate.toLowerCase() === piece.toLowerCase()) === index);
  return deduped[0] ? titleCase(deduped[0]) : "Workout";
}

function formatWeight(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value) || value <= 0) return "BASELINE";
  return `${Number.isInteger(value) ? value : value.toFixed(1)} LB`;
}

function formatPct(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  const clean = Math.abs(value) < 0.05 ? 0 : value;
  return `${clean > 0 ? "+" : ""}${clean.toFixed(1)}%`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.getMonth() + 1}/${String(date.getDate()).padStart(2, "0")}/${date.getFullYear()}`;
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

function strengthChange(points: ExercisePoint[], days = 30) {
  const valid = points
    .filter((point) => point.bestE1RM > 0)
    .slice()
    .sort((a, b) => ms(a.completedAt) - ms(b.completedAt));
  if (valid.length < 2) return null;
  const cutoff = Date.now() - days * 86400000;
  const inside = valid.filter((point) => ms(point.completedAt) >= cutoff);
  const baseline = inside.length >= 2 ? inside[0] : valid[0];
  const latest = valid[valid.length - 1];
  if (!baseline || baseline.workoutId === latest.workoutId || baseline.bestE1RM <= 0) return null;
  return ((latest.bestE1RM - baseline.bestE1RM) / baseline.bestE1RM) * 100;
}

function coachingDecision(
  points: ExercisePoint[],
  repMin?: number,
  repMax?: number
): Pick<ExerciseInsight, "decision" | "suggestedWeight" | "reason"> {
  const latest = points.at(-1);
  if (!latest) {
    return {
      decision: "REPEAT & ASSESS",
      suggestedWeight: null,
      reason: "No completed performance yet. Establish a clean baseline first.",
    };
  }

  if ((latest.pain ?? 0) >= 3) {
    return {
      decision: "HOLD",
      suggestedWeight: latest.bestWeight || null,
      reason: `Pain was ${latest.pain}/10. Keep the load steady until the movement is comfortable again.`,
    };
  }

  if (points.length < 2) {
    return {
      decision: "REPEAT & ASSESS",
      suggestedWeight: latest.bestWeight || null,
      reason: "One session is a baseline. Repeat the load and confirm the trend before progressing.",
    };
  }

  const low = repMin && repMin > 0 ? repMin : 8;
  const high = repMax && repMax >= low ? repMax : Math.max(low, 12);
  const rir = latest.avgRir;

  if (latest.bestReps >= high && (rir == null || rir >= 2)) {
    const next = latest.bestWeight > 0
      ? latest.bestWeight + progressionIncrement(latest.bestWeight)
      : null;
    return {
      decision: "INCREASE",
      suggestedWeight: next,
      reason: `You reached the top of the ${low}–${high} rep range${rir == null ? "" : ` with ${rir.toFixed(1)} RIR`}.`,
    };
  }

  if (latest.bestReps < low || (rir != null && rir <= 0)) {
    const next = latest.bestWeight > 0
      ? Math.max(progressionIncrement(latest.bestWeight), latest.bestWeight - progressionIncrement(latest.bestWeight))
      : null;
    return {
      decision: "REDUCE",
      suggestedWeight: next,
      reason: `The last performance fell below the ${low}–${high} target or reached failure.`,
    };
  }

  return {
    decision: "HOLD",
    suggestedWeight: latest.bestWeight || null,
    reason: `The load is inside the ${low}–${high} target. Earn more clean reps before increasing.`,
  };
}

function decisionTone(decision: Decision): Tone {
  if (decision === "INCREASE") return "green";
  if (decision === "REDUCE") return "red";
  if (decision === "HOLD") return "blue";
  return "amber";
}

function programTypeLabel(program: ProgramBlockRow | null) {
  const mode = String(program?.goal_mode ?? "").toLowerCase();
  return mode.includes("symptom") || mode.includes("target")
    ? "Targeted Program"
    : "Goal Program";
}

function activeSymptom(intake: IntakeSnapshotRow | null) {
  const symptoms = intake?.symptoms;
  if (!symptoms || typeof symptoms !== "object") return null;
  return Object.keys(symptoms).find((key) => Boolean(symptoms[key])) ?? null;
}

function equipmentLabel(intake: IntakeSnapshotRow | null) {
  const raw = intake?.constraints?.equipment;
  const values = Array.isArray(raw) ? raw.map((value) => titleCase(String(value))) : [];
  return values.length ? unique(values).join(" + ") : "Gym";
}

function SectionTitle({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
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
  const [activeIntake, setActiveIntake] = useState<IntakeSnapshotRow | null>(null);
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
  const [switching, setSwitching] = useState(false);

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

  const [tipCategory, setTipCategory] = useState<CoachTipCategory>("TRAINING");
  const [featuredTip, setFeaturedTip] = useState<CoachTip>(
    () => COACH_TIPS.find((tip) => tip.category === "TRAINING") ?? COACH_TIPS[0]
  );
  const [recommendationHistory, setRecommendationHistory] = useState<CoachHistoryRow[]>([]);

  function showToast(text: string, tone: "ok" | "err" = "ok") {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ open: true, tone, text });
    toastTimer.current = window.setTimeout(
      () => setToast((current) => ({ ...current, open: false })),
      2600
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
        mode === "goal" ? { goal, focus_muscles: focus ? [focus] : [] } : {},
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

      const programs = (programData ?? []) as ProgramBlockRow[];
      const active = programs.find((row) => row.status === "active") ?? null;
      setActiveProgram(active);
      if (!active) setBuilderOpen(true);

      let intakeRow: IntakeSnapshotRow | null = null;
      if (active?.intake_snapshot_id) {
        const { data, error } = await supabase
          .from("intake_snapshots")
          .select("id,constraints,symptoms,aesthetic_interests")
          .eq("id", active.intake_snapshot_id)
          .maybeSingle();
        if (!error && data) intakeRow = data as IntakeSnapshotRow;
      }
      setActiveIntake(intakeRow);

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

      const templateIds = unique(scheduleRows.map((row) => row.template_id ?? ""));
      const nextTemplateMap = new Map<string, TemplateRow>();
      if (templateIds.length) {
        const { data, error } = await supabase
          .from("workout_templates")
          .select("id,name,focus_tags,estimated_minutes")
          .in("id", templateIds);
        if (error) throw error;
        for (const row of (data ?? []) as TemplateRow[]) nextTemplateMap.set(row.id, row);
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

      const workoutExerciseIds = nextWorkoutExercises.map((row) => row.id);
      let nextWorkoutSets: WorkoutSetRow[] = [];
      if (workoutExerciseIds.length) {
        const { data, error } = await supabase
          .from("workout_sets")
          .select("workout_exercise_id,set_index,reps,weight,rir")
          .in("workout_exercise_id", workoutExerciseIds)
          .order("set_index", { ascending: true });
        if (error) throw error;
        nextWorkoutSets = (data ?? []) as WorkoutSetRow[];
      }
      setWorkoutSets(nextWorkoutSets);

      const exerciseIds = unique([
        ...nextTemplateExercises.map((row) => row.exercise_id),
        ...nextWorkoutExercises.map((row) => row.exercise_id),
      ]);
      const nextExerciseMap = new Map<string, ExerciseMeta>();
      if (exerciseIds.length) {
        const { data, error } = await supabase
          .from("exercises")
          .select("id,name,primary_muscles,secondary_muscles")
          .in("id", exerciseIds);
        if (error) throw error;
        for (const row of (data ?? []) as ExerciseMeta[]) nextExerciseMap.set(row.id, row);
      }
      setExerciseMap(nextExerciseMap);
    } catch (error: any) {
      setMsg(error?.message ?? "Could not load Coach.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCoach();
    try {
      const raw = window.localStorage.getItem(HISTORY_KEY);
      setRecommendationHistory(raw ? (JSON.parse(raw) as CoachHistoryRow[]) : []);
    } catch {
      setRecommendationHistory([]);
    }
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
      await loadManagePrograms();
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
    window.setTimeout(() => builderRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
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

  const activeProgramName = useMemo(() => {
    if (!activeProgram) return "No Active Program";
    const goalName = goalLabel(activeProgram.goal);
    const symptomKey = activeSymptom(activeIntake);
    const targetName = symptomKey ? symptomLabel(symptomKey) : "";
    if (goalName && goalName !== "Training" && targetName && goalName.toLowerCase() !== targetName.toLowerCase()) {
      return `${goalName} + ${targetName}`;
    }
    return targetName || goalName || "Training";
  }, [activeIntake, activeProgram]);

  const activeProgramMeta = useMemo(
    () => activeProgram ? `${programTypeLabel(activeProgram)} • ${equipmentLabel(activeIntake)}` : "Create a program to begin",
    [activeIntake, activeProgram]
  );

  const scheduledMap = useMemo(() => new Map(scheduled.map((row) => [row.id, row])), [scheduled]);
  const activeScheduledIds = useMemo(() => new Set(scheduled.map((row) => row.id)), [scheduled]);
  const activeWorkouts = useMemo(
    () => workouts.filter((row) => row.scheduled_session_id && activeScheduledIds.has(row.scheduled_session_id)),
    [activeScheduledIds, workouts]
  );
  const workoutMap = useMemo(() => new Map(activeWorkouts.map((row) => [row.id, row])), [activeWorkouts]);

  const setsByWorkoutExercise = useMemo(() => {
    const map = new Map<string, WorkoutSetRow[]>();
    for (const row of workoutSets) {
      const list = map.get(row.workout_exercise_id) ?? [];
      list.push(row);
      map.set(row.workout_exercise_id, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.set_index - b.set_index);
    return map;
  }, [workoutSets]);

  const exerciseInsights = useMemo<ExerciseInsight[]>(() => {
    const pointsMap = new Map<string, ExercisePoint[]>();
    for (const row of workoutExercises) {
      const workout = workoutMap.get(row.workout_id);
      if (!workout) continue;
      const session = workout.scheduled_session_id ? scheduledMap.get(workout.scheduled_session_id) : null;
      const template = session?.template_id ? templateMap.get(session.template_id) : null;
      const sets = (setsByWorkoutExercise.get(row.id) ?? []).filter((set) => set.reps > 0);
      if (!sets.length) continue;
      const best = sets.slice().sort((a, b) => e1rm(b.weight, b.reps) - e1rm(a.weight, a.reps))[0];
      const rirValues = sets.map((set) => set.rir).filter((value): value is number => value != null && Number.isFinite(value));
      const point: ExercisePoint = {
        workoutId: workout.id,
        completedAt: workout.completed_at,
        workoutName: cleanWorkoutName(template?.name || session?.session_type),
        bestWeight: num(best?.weight),
        bestReps: num(best?.reps),
        bestE1RM: e1rm(num(best?.weight), num(best?.reps)),
        avgRir: rirValues.length ? average(rirValues) : null,
        pain: row.pain == null ? null : num(row.pain),
        volume: sets.reduce((sum, set) => sum + num(set.weight) * num(set.reps), 0),
      };
      const list = pointsMap.get(row.exercise_id) ?? [];
      list.push(point);
      pointsMap.set(row.exercise_id, list);
    }

    return Array.from(pointsMap.entries()).map(([id, unsorted]) => {
      const points = unsorted.slice().sort((a, b) => ms(a.completedAt) - ms(b.completedAt));
      const latest = points.at(-1)!;
      const meta = exerciseMap.get(id);
      return {
        id,
        name: meta?.name ?? "Exercise",
        muscles: Array.isArray(meta?.primary_muscles) ? unique(meta.primary_muscles.map(prettyMuscle)) : [],
        points,
        currentWeight: latest.bestWeight,
        currentReps: latest.bestReps,
        currentRir: latest.avgRir,
        currentPain: latest.pain,
        change30: strengthChange(points, 30),
        ...coachingDecision(points),
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [exerciseMap, scheduledMap, setsByWorkoutExercise, templateMap, workoutExercises, workoutMap]);

  const insightMap = useMemo(() => new Map(exerciseInsights.map((row) => [row.id, row])), [exerciseInsights]);
  const completedScheduledIds = useMemo(
    () => new Set(activeWorkouts.map((row) => row.scheduled_session_id).filter((value): value is string => Boolean(value))),
    [activeWorkouts]
  );

  const nextScheduled = useMemo(
    () => scheduled
      .filter((row) => !completedScheduledIds.has(row.id))
      .slice()
      .sort((a, b) => {
        const left = ms(a.date);
        const right = ms(b.date);
        if (!Number.isFinite(left)) return 1;
        if (!Number.isFinite(right)) return -1;
        return left - right;
      })[0] ?? null,
    [completedScheduledIds, scheduled]
  );

  const nextTemplate = nextScheduled?.template_id ? templateMap.get(nextScheduled.template_id) ?? null : null;

  const nextWorkoutExercises = useMemo<NextExercise[]>(() => {
    if (!nextScheduled?.template_id) return [];
    return templateExercises
      .filter((row) => row.template_id === nextScheduled.template_id)
      .slice()
      .sort((a, b) => a.order_index - b.order_index)
      .map((row) => {
        const meta = exerciseMap.get(row.exercise_id);
        const insight = insightMap.get(row.exercise_id);
        const decision = coachingDecision(insight?.points ?? [], row.rep_min, row.rep_max);
        return {
          id: row.exercise_id,
          name: meta?.name ?? insight?.name ?? "Exercise",
          muscles: Array.isArray(meta?.primary_muscles)
            ? unique(meta.primary_muscles.map(prettyMuscle))
            : insight?.muscles ?? [],
          sets: num(row.sets, 3),
          repMin: num(row.rep_min, 8),
          repMax: num(row.rep_max, 12),
          currentWeight: insight?.currentWeight ?? 0,
          ...decision,
        };
      });
  }, [exerciseMap, insightMap, nextScheduled, templateExercises]);

  const recommendations = useMemo<CoachRecommendation[]>(() => {
    const rows: CoachRecommendation[] = [];
    const increase = nextWorkoutExercises.find((row) => row.decision === "INCREASE");
    const reduce = nextWorkoutExercises.find((row) => row.decision === "REDUCE");
    const hold = nextWorkoutExercises.find((row) => row.decision === "HOLD");

    if (increase) {
      rows.push({
        id: `increase-${increase.id}`,
        eyebrow: "PRIMARY ACTION",
        title: `Increase ${increase.name}`,
        body: increase.reason,
        action: `${formatWeight(increase.currentWeight)} → ${formatWeight(increase.suggestedWeight)}`,
        tone: "green",
        exerciseId: increase.id,
      });
    } else if (reduce) {
      rows.push({
        id: `reduce-${reduce.id}`,
        eyebrow: "PRIMARY ACTION",
        title: `Reduce ${reduce.name}`,
        body: reduce.reason,
        action: `${formatWeight(reduce.currentWeight)} → ${formatWeight(reduce.suggestedWeight)}`,
        tone: "amber",
        exerciseId: reduce.id,
      });
    } else if (hold) {
      rows.push({
        id: `hold-${hold.id}`,
        eyebrow: "PRIMARY ACTION",
        title: `Hold ${hold.name}`,
        body: hold.reason,
        action: `NEXT SET • ${formatWeight(hold.suggestedWeight)}`,
        tone: "blue",
        exerciseId: hold.id,
      });
    }

    rows.push({
      id: "next-workout",
      eyebrow: "NEXT WORKOUT",
      title: nextTemplate ? cleanWorkoutName(nextTemplate.name) : "Build the next trend",
      body: nextTemplate
        ? `${nextWorkoutExercises.length} exercises ready inside ${activeProgramName}.`
        : "No upcoming scheduled workout is waiting right now.",
      action: nextTemplate ? `${nextTemplate.estimated_minutes ?? "—"} MIN PLANNED` : "NO ACTION NEEDED",
      tone: "blue",
    });

    const painSignal = exerciseInsights.find((row) => (row.currentPain ?? 0) >= 3);
    rows.push({
      id: painSignal ? `pain-${painSignal.id}` : "recovery-clear",
      eyebrow: "RECOVERY CHECK",
      title: painSignal ? `Hold progression on ${painSignal.name}` : "Pain signal is controlled",
      body: painSignal
        ? `Latest pain was ${painSignal.currentPain}/10. Progression stays paused on that movement.`
        : "No elevated exercise-pain signal is currently forcing a load reduction.",
      action: painSignal ? "HOLD & REASSESS" : "PROGRESSION AVAILABLE",
      tone: painSignal ? "amber" : "green",
      exerciseId: painSignal?.id,
    });

    return rows.slice(0, 3);
  }, [activeProgramName, exerciseInsights, nextTemplate, nextWorkoutExercises]);

  useEffect(() => {
    if (!recommendations.length) return;
    try {
      const raw = window.localStorage.getItem(HISTORY_KEY);
      const current = raw ? (JSON.parse(raw) as CoachHistoryRow[]) : [];
      const now = new Date().toISOString();
      const additions = recommendations
        .filter((recommendation) => !current.some((row) => row.id === recommendation.id && Date.now() - ms(row.createdAt) < 2 * 86400000))
        .map((recommendation) => ({
          id: recommendation.id,
          createdAt: now,
          title: recommendation.title,
          action: recommendation.action,
          tone: recommendation.tone,
        }));
      if (!additions.length) return;
      const next = [...additions, ...current].slice(0, 30);
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      setRecommendationHistory(next);
    } catch {
      // History is optional.
    }
  }, [recommendations]);

  const programReview = useMemo(() => {
    const changes = exerciseInsights.map((row) => row.change30).filter((value): value is number => value != null && Number.isFinite(value));
    const strength30 = changes.length ? average(changes) : null;
    const recent = activeWorkouts.filter((row) => ms(row.completed_at) >= Date.now() - 30 * 86400000);
    const frequency = recent.length / (30 / 7);
    const biggest = exerciseInsights
      .filter((row) => row.change30 != null)
      .slice()
      .sort((a, b) => num(b.change30) - num(a.change30))[0] ?? null;
    const pain = exerciseInsights.filter((row) => (row.currentPain ?? 0) >= 3).length;
    const tone: Tone = pain ? "amber" : strength30 != null && strength30 > 2 ? "green" : "blue";
    const overall = pain ? "Needs Review" : strength30 != null && strength30 > 2 ? "Progressing" : "Stable";
    const assessment = pain
      ? "One or more exercises have a pain signal. Keep those loads steady and progress only pain-free movements."
      : strength30 != null && strength30 > 2
        ? `The current ${activeProgramName} program is producing measurable strength progress. Keep the split and progress only exercises that earn it.`
        : `The current ${activeProgramName} program is stable. Use the exercise decisions below instead of adding load everywhere at once.`;
    return { strength30, frequency, biggest, tone, overall, assessment };
  }, [activeProgramName, activeWorkouts, exerciseInsights]);

  const latestProteinTarget = useMemo(
    () => activeWorkouts.find((row) => row.protein_target_g != null)?.protein_target_g ?? null,
    [activeWorkouts]
  );

  function chooseTip(category: CoachTipCategory) {
    const goalKey = goalKeyForTips(activeProgram?.goal);
    const eligible = COACH_TIPS.filter(
      (tip) => tip.category === category && (tip.goals.includes("all") || tip.goals.includes(goalKey))
    );
    const pool = eligible.length ? eligible : COACH_TIPS.filter((tip) => tip.category === category);
    if (!pool.length) return;
    let recent: string[] = [];
    try {
      const raw = window.localStorage.getItem(TIP_RECENT_KEY);
      recent = raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      recent = [];
    }
    const fresh = pool.filter((tip) => !recent.includes(tip.id));
    const source = fresh.length ? fresh : pool;
    const next = source[Math.floor(Math.random() * source.length)];
    setFeaturedTip(next);
    try {
      window.localStorage.setItem(TIP_RECENT_KEY, JSON.stringify([...recent, next.id].slice(-80)));
    } catch {
      // Optional.
    }
  }

  const selectedManageIds = Object.keys(manageSelected).filter((id) => manageSelected[id]);

  return (
    <div className="co-page">
      {toast.open ? (
        <div className={`co-toast is-${toast.tone}`}>
          <span>{toast.text}</span>
          <button type="button" onClick={() => setToast((value) => ({ ...value, open: false }))}>OK</button>
        </div>
      ) : null}

      <section className="co-surface co-hero">
        <div className="co-heroMain">
          <h1>Coach</h1>
          <div className="co-programName">{activeProgramName}</div>
          <div className="co-programMetaLine">{activeProgramMeta}</div>
        </div>
        <div className="co-heroStatus">
          <span>COACHING STATUS</span>
          <strong>{loading ? "ANALYZING…" : `${recommendations.length} ACTIONS READY`}</strong>
          <small>{activeProgram ? "Current active program only" : "No active program"}</small>
        </div>
      </section>

      {msg ? <div className="co-error">{msg}</div> : null}

      <section className="co-surface co-section co-section--brief">
        <SectionTitle title="Today's Coaching Brief" />
        <div className="co-briefingGrid">
          {recommendations.map((recommendation, index) => (
            <article key={recommendation.id} className={`co-briefCard is-${recommendation.tone} ${index === 0 ? "is-lead" : ""}`}>
              <div className="co-briefTop"><span>{recommendation.eyebrow}</span><i /></div>
              <h3>{recommendation.title}</h3>
              <p>{recommendation.body}</p>
              <div className="co-briefAction">{recommendation.action}</div>
              {recommendation.exerciseId ? (
                <button type="button" onClick={() => navigate(`/library/${recommendation.exerciseId}`)}>OPEN EXERCISE</button>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <section className="co-surface co-section co-section--next">
        <SectionTitle
          title="Next Workout Coaching"
          right={nextScheduled ? <button className="co-primaryAction" type="button" onClick={() => navigate(`/workout/${nextScheduled.id}`)}>OPEN WORKOUT</button> : null}
        />
        {nextScheduled && nextTemplate ? (
          <>
            <div className="co-nextWorkoutHead">
              <div><span>NEXT WORKOUT</span><strong>{cleanWorkoutName(nextTemplate.name)}</strong></div>
              <div><span>EXERCISES</span><strong>{nextWorkoutExercises.length}</strong><small>{nextTemplate.estimated_minutes ? `${nextTemplate.estimated_minutes} min planned` : "Ready"}</small></div>
            </div>
            <div className="co-decisionRows">
              {nextWorkoutExercises.map((exercise) => (
                <article key={exercise.id} className={`co-decisionRow is-${decisionTone(exercise.decision)}`}>
                  <div className="co-decisionExercise">
                    <strong>{exercise.name}</strong>
                    <span>{exercise.sets} sets • {exercise.repMin}–{exercise.repMax} reps{exercise.muscles.length ? ` • ${exercise.muscles.join(" / ")}` : ""}</span>
                  </div>
                  <div className="co-decisionCommand">
                    <span>{exercise.decision}</span>
                    <strong>
                      {exercise.decision === "INCREASE" || exercise.decision === "REDUCE"
                        ? `${formatWeight(exercise.currentWeight)} → ${formatWeight(exercise.suggestedWeight)}`
                        : `NEXT SET • ${formatWeight(exercise.suggestedWeight)}`}
                    </strong>
                    <small>{exercise.reason}</small>
                  </div>
                  <button type="button" onClick={() => navigate(`/library/${exercise.id}`)}>DETAILS</button>
                </article>
              ))}
            </div>
          </>
        ) : <div className="co-empty">No upcoming scheduled workout. Your current program remains intact.</div>}
      </section>

      <section className="co-surface co-section co-section--review">
        <SectionTitle title="Program Review" subtitle={activeProgramName} />
        <div className="co-reviewGrid">
          <article className={`co-overall is-${programReview.tone}`}><span>OVERALL</span><strong>{programReview.overall}</strong></article>
          <article><span>STRENGTH 30D</span><strong>{formatPct(programReview.strength30)}</strong></article>
          <article><span>WORKOUTS / WEEK</span><strong>{programReview.frequency.toFixed(1)}</strong></article>
          <article><span>BIGGEST GAIN</span><strong>{programReview.biggest?.name ?? "Building Trend"}</strong></article>
        </div>
        <div className="co-assessment"><span>COACH ASSESSMENT</span><p>{programReview.assessment}</p></div>
      </section>

      <section className="co-surface co-section co-section--nutrition">
        <SectionTitle title="Nutrition Coach" subtitle="Targets tied to your current training goal." />
        <div className="co-nutritionGrid">
          <article><span>CURRENT GOAL</span><strong>{activeProgramName}</strong></article>
          <article><span>PROTEIN TARGET</span><strong>{latestProteinTarget == null ? "NOT SET" : `${latestProteinTarget} G`}</strong></article>
          <article className="co-nutritionAdvice"><span>COACH</span><strong>{latestProteinTarget == null ? "Log a protein target so Coach can keep nutrition guidance anchored to your plan." : "Keep daily protein consistent, especially across training and recovery days."}</strong></article>
        </div>
      </section>

      <section className="co-surface co-section co-section--tips">
        <SectionTitle title="Coach Tips" subtitle="Training, recovery, nutrition, sleep, mobility, hydration and habits." />
        <div className="co-tipTabs" role="tablist" aria-label="Coach tip categories">
          {COACH_TIP_CATEGORIES.map((category) => (
            <button type="button" key={category} className={tipCategory === category ? "is-active" : ""} onClick={() => { setTipCategory(category); chooseTip(category); }}>
              {titleCase(category)}
            </button>
          ))}
        </div>
        <article className="co-featuredTip">
          <div><span>{titleCase(featuredTip.category)}</span><h3>{featuredTip.title}</h3><p>{featuredTip.advice}</p></div>
          <div className="co-tipEvidence"><span>WHY IT MATTERS</span><strong>{featuredTip.why}</strong></div>
          <div className="co-tipEvidence"><span>ACTION</span><strong>{featuredTip.action}</strong></div>
          <button type="button" onClick={() => chooseTip(tipCategory)}>NEXT TIP</button>
        </article>
      </section>

      <section className="co-surface co-section co-section--history">
        <SectionTitle title="Recommendation History" subtitle="Recent coaching calls, kept concise." />
        <div className="co-historyList">
          {recommendationHistory.slice(0, 8).map((row) => (
            <article key={`${row.id}-${row.createdAt}`} className={`is-${row.tone}`}><div><strong>{row.title}</strong><span>{formatDate(row.createdAt)}</span></div><b>{row.action}</b></article>
          ))}
          {!recommendationHistory.length ? <div className="co-empty">Coach history will appear as the app learns from completed sessions.</div> : null}
        </div>
      </section>

      <section className="co-surface co-section co-section--control">
        <SectionTitle title="Program Control" subtitle="Manage programs without exposing database IDs." />
        <div className="co-programControl">
          <div><span>ACTIVE PROGRAM</span><strong>{activeProgramName}</strong><small>{activeProgramMeta}</small></div>
          <div className="co-controlButtons">
            <button type="button" onClick={() => navigate("/progress")}>VIEW PROGRESS</button>
            <button type="button" onClick={openManage}>MANAGE PROGRAMS</button>
            <button type="button" className="is-primary" onClick={openBuilder}>START NEW PROGRAM</button>
          </div>
        </div>

        {manageOpen ? (
          <div className="co-managePanel">
            <div className="co-manageHead"><div><span>PROGRAM MANAGEMENT</span><strong>Choose exactly what changes</strong></div><button type="button" onClick={() => setManageOpen(false)}>CLOSE</button></div>
            {manageErr ? <div className="co-error">{manageErr}</div> : null}
            {manageLoading ? <div className="co-empty">Loading programs…</div> : (
              <div className="co-manageRows">
                {manageRows.map((row) => (
                  <article key={row.id} className={row.status === "active" ? "is-active" : ""}>
                    <label><input type="checkbox" checked={Boolean(manageSelected[row.id])} onChange={(event) => setManageSelected((current) => ({ ...current, [row.id]: event.target.checked }))} /><span /></label>
                    <div><strong>{goalLabel(row.goal)}</strong><span>{row.status === "active" ? "ACTIVE" : "SAVED"} • {row.completed_workouts_count} completed • {row.sessions_count} scheduled</span><small>Created {formatDate(row.created_at)}</small></div>
                    {row.status !== "active" ? <button type="button" disabled={switching} onClick={() => void setActiveProgramBlock(row.id)}>SET ACTIVE</button> : <b>ACTIVE</b>}
                  </article>
                ))}
              </div>
            )}
            <div className="co-deleteOptions">
              <label><input type="checkbox" checked={deleteHistory} onChange={(event) => setDeleteHistory(event.target.checked)} />Also delete linked workout history</label>
              <button type="button" className="is-danger" disabled={!selectedManageIds.length || manageBusy} onClick={() => setConfirmDeleteOpen(true)}>DELETE SELECTED</button>
            </div>
          </div>
        ) : null}
      </section>

      <section ref={builderRef} className={`co-surface co-section co-builder ${builderOpen ? "is-open" : ""}`}>
        <SectionTitle title="Program Builder" subtitle="Your selections become the visible program identity." right={builderOpen ? <button type="button" onClick={() => setBuilderOpen(false)}>CLOSE</button> : <button type="button" onClick={openBuilder}>OPEN BUILDER</button>} />
        {builderOpen ? (
          <div className="co-builderBody">
            <div className="co-builderGrid">
              <div className="co-builderSection"><h3>Program Type</h3><div className="co-choiceRow"><button type="button" className={mode === "goal" ? "is-active" : ""} onClick={() => setMode("goal")}>Goal Program</button><button type="button" className={mode === "symptom" ? "is-active" : ""} onClick={() => setMode("symptom")}>Targeted Program</button></div></div>
              {mode === "goal" ? <div className="co-builderSection"><h3>Goal</h3><div className="co-choiceGrid"><button type="button" className={goal === "bulk" ? "is-active" : ""} onClick={() => setGoal("bulk")}>Muscle Gain</button><button type="button" className={goal === "strength" ? "is-active" : ""} onClick={() => setGoal("strength")}>Strength</button><button type="button" className={goal === "cut" ? "is-active" : ""} onClick={() => setGoal("cut")}>Cut</button><button type="button" className={goal === "fitness" ? "is-active" : ""} onClick={() => setGoal("fitness")}>Fitness</button></div><label className="co-field"><span>FOCUS MUSCLE (OPTIONAL)</span><input value={focus} onChange={(event) => setFocus(event.target.value)} placeholder="Example: Back" /></label></div> : null}
              {mode === "symptom" ? <div className="co-builderSection"><h3>Target</h3><div className="co-choiceGrid"><button type="button" className={symptom === "posture" ? "is-active" : ""} onClick={() => setSymptom("posture")}>Posture</button><button type="button" className={symptom === "shoulder_pain" ? "is-active" : ""} onClick={() => setSymptom("shoulder_pain")}>Shoulder</button><button type="button" className={symptom === "back_pain" ? "is-active" : ""} onClick={() => setSymptom("back_pain")}>Back</button><button type="button" className={symptom === "knee_pain" ? "is-active" : ""} onClick={() => setSymptom("knee_pain")}>Knee</button><button type="button" className={symptom === "elbow_wrist" ? "is-active" : ""} onClick={() => setSymptom("elbow_wrist")}>Elbow / Wrist</button></div></div> : null}
              <div className="co-builderSection"><h3>Equipment</h3><div className="co-choiceRow"><button type="button" className={equipGym ? "is-active" : ""} onClick={() => setEquipGym((value) => !value)}>Gym</button><button type="button" className={equipHome ? "is-active" : ""} onClick={() => setEquipHome((value) => !value)}>Home</button></div></div>
              <div className="co-builderSection"><h3>Body Data</h3><div className="co-bodyFields"><label className="co-field"><span>HEIGHT FT</span><input value={heightFt} inputMode="numeric" onChange={(event) => setHeightFt(event.target.value.replace(/[^\d]/g, ""))} /></label><label className="co-field"><span>HEIGHT IN</span><input value={heightIn} inputMode="numeric" onChange={(event) => setHeightIn(event.target.value.replace(/[^\d]/g, ""))} /></label><label className="co-field"><span>WEIGHT LB</span><input value={weightLb} inputMode="decimal" onChange={(event) => setWeightLb(event.target.value.replace(/[^\d.]/g, ""))} /></label><label className="co-field"><span>AGE</span><input value={age} inputMode="numeric" onChange={(event) => setAge(event.target.value.replace(/[^\d]/g, ""))} /></label></div></div>
            </div>
            <div className="co-builderActions"><button type="button" disabled={!mode || saving || generating} onClick={() => void saveIntake()}>{saving ? "SAVING…" : "SAVE INTAKE"}</button><button type="button" className="is-primary" disabled={!mode || saving || generating} onClick={() => void generateProgram()}>{generating ? "GENERATING…" : "GENERATE PROGRAM"}</button></div>
          </div>
        ) : null}
      </section>

      {confirmDeleteOpen ? (
        <div className="co-confirmOverlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !manageBusy) setConfirmDeleteOpen(false); }}>
          <section className="co-confirmModal" role="dialog" aria-modal="true">
            <span>PROGRAM MANAGEMENT</span><h2>Delete selected programs?</h2><p>You are about to permanently delete {selectedManageIds.length} program{selectedManageIds.length === 1 ? "" : "s"}{deleteHistory ? " and their linked workout history" : ""}. The other programs stay untouched.</p>
            <div><button type="button" disabled={manageBusy} onClick={() => setConfirmDeleteOpen(false)}>CANCEL</button><button type="button" className="is-danger" disabled={manageBusy} onClick={() => void deleteSelectedPrograms()}>{manageBusy ? "DELETING…" : "DELETE PROGRAMS"}</button></div>
          </section>
        </div>
      ) : null}

      <style>{`
        .co-page{--c:#59d8ff;--g:#5ce3a1;--a:#f0b258;--r:#ff747a;--line:rgba(128,201,227,.16);width:min(1180px,calc(100% - 28px));margin:0 auto 120px;display:grid;gap:14px;color:#f3fbff;font-family:inherit}.co-page *{box-sizing:border-box}.co-page button,.co-page input{font:inherit}.co-page button{cursor:pointer;color:#f7fcff}.co-page button:disabled{cursor:not-allowed;opacity:.44}.co-surface{border:1px solid var(--line);border-top-color:rgba(181,229,246,.26);border-radius:18px;background:linear-gradient(180deg,#0b1c25,#050d12);box-shadow:inset 0 1px rgba(255,255,255,.028),0 14px 32px rgba(0,0,0,.24)}
        .co-hero{padding:25px 27px;display:flex;align-items:center;justify-content:space-between;gap:22px}.co-kicker,.co-sectionTitleText p,.co-heroStatus span,.co-briefTop span,.co-reviewGrid span,.co-assessment span,.co-programControl span,.co-featuredTip>div>span,.co-tipEvidence span,.co-nextWorkoutHead span{color:#83b2c2;font-size:10px;font-weight:900;letter-spacing:.115em;text-transform:uppercase}.co-hero h1{margin:4px 0 4px;font-size:clamp(34px,5vw,58px);line-height:.96;letter-spacing:-.05em}.co-programName{font-size:clamp(21px,3vw,32px);font-weight:1000}.co-programMetaLine{margin-top:7px;color:#86dfff;font-size:13px;font-weight:850}.co-heroStatus{min-width:250px;padding:15px 17px;border:1px solid rgba(89,216,255,.19);border-radius:14px;background:rgba(10,33,44,.72)}.co-heroStatus strong{display:block;margin:5px 0;color:#fff;font-size:19px}.co-heroStatus small{color:#b7ccd5;font-size:12px}.co-error{padding:12px 14px;border:1px solid rgba(255,116,122,.32);border-radius:12px;background:rgba(115,30,35,.2);color:#ffd4d6;font-weight:800}.co-toast{position:fixed;z-index:10050;right:18px;bottom:88px;width:min(440px,calc(100vw - 36px));display:flex;align-items:center;justify-content:space-between;gap:15px;padding:13px 15px;border:1px solid rgba(89,216,255,.36);border-radius:12px;background:#09171e;box-shadow:0 20px 55px rgba(0,0,0,.6);font-size:13px;font-weight:850}.co-toast.is-err{border-color:rgba(255,116,122,.4);background:#1c0d10}.co-toast button{border:0;background:transparent;color:#86e4ff;font-weight:1000}
        .co-section{padding:22px}.co-sectionTitle{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:18px}.co-sectionTitleText{display:flex;gap:11px;min-width:0}.co-sectionAccent{width:4px;height:42px;border-radius:4px;background:linear-gradient(#8fe8ff,#189fd6)}.co-sectionTitle h2{margin:0;font-size:clamp(23px,3vw,31px);line-height:1;font-weight:1000;letter-spacing:-.035em}.co-sectionTitleText p{margin:7px 0 0;letter-spacing:.02em;text-transform:none;font-size:12px;line-height:1.45}.co-sectionRight button,.co-primaryAction{min-height:42px;padding:0 15px;border:1px solid rgba(89,216,255,.34);border-radius:10px;background:rgba(32,126,160,.18);font-size:11px;font-weight:950;letter-spacing:.05em}
        .co-briefingGrid{display:grid;grid-template-columns:1.28fr 1fr 1fr;gap:10px}.co-briefCard{min-height:210px;display:flex;flex-direction:column;padding:17px;border:1px solid rgba(139,202,226,.11);border-left:3px solid var(--c);border-radius:14px;background:linear-gradient(110deg,rgba(38,125,158,.12),transparent 72%)}.co-briefCard.is-green{border-left-color:var(--g)}.co-briefCard.is-amber{border-left-color:var(--a)}.co-briefCard.is-lead{background:linear-gradient(120deg,rgba(31,139,179,.19),rgba(6,15,21,.15))}.co-briefTop{display:flex;align-items:center;justify-content:space-between}.co-briefTop i{width:8px;height:8px;border-radius:50%;background:currentColor;box-shadow:0 0 12px currentColor}.co-briefCard h3{margin:14px 0 8px;font-size:20px;line-height:1.12}.co-briefCard p{margin:0;color:#c0d2da;font-size:13px;line-height:1.5}.co-briefAction{margin-top:auto;padding-top:15px;color:#fff;font-size:16px;font-weight:1000}.co-briefCard button{margin-top:10px;align-self:flex-start;border:0;background:transparent;color:#7fe1ff;font-size:10px;font-weight:1000;letter-spacing:.07em}
        .co-nextWorkoutHead{display:grid;grid-template-columns:1fr 170px;gap:10px;margin-bottom:10px}.co-nextWorkoutHead>div{padding:15px 16px;border:1px solid rgba(138,198,221,.11);border-radius:12px;background:rgba(255,255,255,.018)}.co-nextWorkoutHead strong{display:block;margin:5px 0;font-size:22px}.co-nextWorkoutHead small{color:#a9c0ca;font-size:11px}.co-decisionRows{display:grid;gap:8px}.co-decisionRow{display:grid;grid-template-columns:minmax(190px,.85fr) minmax(0,1.55fr) 86px;gap:14px;align-items:center;padding:14px 15px;border:1px solid rgba(136,198,221,.11);border-left:3px solid #6e91a0;border-radius:12px;background:rgba(255,255,255,.018)}.co-decisionRow.is-green{border-left-color:var(--g)}.co-decisionRow.is-blue{border-left-color:var(--c)}.co-decisionRow.is-amber{border-left-color:var(--a)}.co-decisionExercise strong{display:block;font-size:15px}.co-decisionExercise span,.co-decisionCommand small{display:block;margin-top:4px;color:#9db6c0;font-size:11px;line-height:1.4}.co-decisionCommand>span{display:block;color:#8edfff;font-size:10px;font-weight:1000;letter-spacing:.11em}.co-decisionCommand>strong{display:block;margin-top:4px;color:#fff;font-size:20px;line-height:1.1}.co-decisionRow.is-green .co-decisionCommand>strong{color:#9ef3bf}.co-decisionRow.is-amber .co-decisionCommand>strong{color:#ffd195}.co-decisionRow>button{height:38px;border:1px solid rgba(120,194,220,.18);border-radius:9px;background:#0a171e;font-size:9px;font-weight:950}
        .co-reviewGrid{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid rgba(138,198,221,.11);border-radius:13px;overflow:hidden}.co-reviewGrid article{min-height:92px;padding:16px;background:rgba(255,255,255,.015)}.co-reviewGrid article+article{border-left:1px solid rgba(138,198,221,.09)}.co-reviewGrid strong{display:block;margin-top:9px;font-size:20px}.co-overall.is-green strong{color:#8ceab0}.co-overall.is-amber strong{color:#f4c27d}.co-assessment{margin-top:10px;padding:15px 16px;border-left:3px solid var(--c);background:linear-gradient(90deg,rgba(45,141,177,.12),transparent)}.co-assessment p{margin:6px 0 0;color:#d2e2e8;font-size:13px;line-height:1.55}
        .co-nutritionGrid{display:grid;grid-template-columns:220px 220px minmax(0,1fr);gap:9px}.co-nutritionGrid article{padding:15px;border:1px solid rgba(138,198,221,.11);border-radius:12px;background:rgba(255,255,255,.018)}.co-nutritionGrid span{color:#83aebb;font-size:9px;font-weight:950;letter-spacing:.11em}.co-nutritionGrid strong{display:block;margin-top:7px;font-size:17px}.co-nutritionAdvice strong{font-size:13px;line-height:1.45}
        .co-tipTabs{display:flex;gap:6px;overflow-x:auto;padding-bottom:5px}.co-tipTabs button{flex:0 0 auto;min-height:37px;padding:0 11px;border:1px solid rgba(126,189,212,.13);border-radius:9px;background:#08151c;color:#a9c2cb;font-size:9px;font-weight:950}.co-tipTabs button.is-active{border-color:rgba(89,216,255,.42);background:rgba(35,130,166,.2);color:#fff}.co-featuredTip{display:grid;grid-template-columns:minmax(0,1.35fr) 1fr 1fr auto;gap:12px;align-items:center;margin-top:10px;padding:17px;border:1px solid rgba(133,198,222,.12);border-radius:13px;background:linear-gradient(115deg,rgba(35,119,151,.1),transparent 72%)}.co-featuredTip h3{margin:6px 0;font-size:19px}.co-featuredTip p{margin:0;color:#bdd1d9;font-size:12px;line-height:1.5}.co-tipEvidence{padding-left:12px;border-left:1px solid rgba(136,197,220,.1)}.co-tipEvidence strong{display:block;margin-top:6px;font-size:12px;line-height:1.45}.co-featuredTip>button{height:40px;padding:0 13px;border:1px solid rgba(89,216,255,.22);border-radius:9px;background:#0a1820;font-size:9px;font-weight:950}
        .co-historyList{display:grid;gap:7px}.co-historyList article{display:flex;align-items:center;justify-content:space-between;gap:15px;padding:12px 14px;border-left:3px solid #7894a0;background:rgba(255,255,255,.015)}.co-historyList article.is-green{border-left-color:var(--g)}.co-historyList article.is-blue{border-left-color:var(--c)}.co-historyList article.is-amber{border-left-color:var(--a)}.co-historyList article div{display:grid;gap:3px}.co-historyList article strong{font-size:13px}.co-historyList article span{color:#8ea9b4;font-size:10px}.co-historyList article b{font-size:12px}.co-empty{padding:22px;border:1px dashed rgba(129,195,220,.16);border-radius:12px;color:#98b2bd;text-align:center;font-size:12px}
        .co-programControl{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:16px;border:1px solid rgba(137,199,221,.11);border-radius:13px;background:rgba(255,255,255,.018)}.co-programControl strong{display:block;margin:5px 0;font-size:22px}.co-programControl small{color:#88dfff;font-size:12px}.co-controlButtons{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}.co-controlButtons button,.co-manageHead button,.co-builderActions button,.co-builder .co-sectionRight button{min-height:40px;padding:0 13px;border:1px solid rgba(130,193,216,.17);border-radius:9px;background:#09161d;font-size:9px;font-weight:950;letter-spacing:.04em}.co-controlButtons .is-primary,.co-builderActions .is-primary{border-color:rgba(89,216,255,.45);background:linear-gradient(180deg,rgba(42,150,189,.28),rgba(16,79,105,.23))}.co-managePanel{margin-top:10px;padding:14px;border:1px solid rgba(134,196,219,.12);border-radius:13px;background:#071219}.co-manageHead{display:flex;align-items:center;justify-content:space-between;gap:15px;margin-bottom:10px}.co-manageHead span{display:block;color:#81afbf;font-size:9px;font-weight:950;letter-spacing:.11em}.co-manageHead strong{display:block;margin-top:4px;font-size:16px}.co-manageRows{display:grid;gap:7px}.co-manageRows article{display:grid;grid-template-columns:34px minmax(0,1fr) auto;align-items:center;gap:10px;padding:11px;border:1px solid rgba(130,193,216,.1);border-radius:10px;background:rgba(255,255,255,.015)}.co-manageRows article.is-active{border-color:rgba(92,227,161,.23)}.co-manageRows label{width:25px;height:25px;display:grid;place-items:center}.co-manageRows label input{width:17px;height:17px}.co-manageRows article strong{display:block;font-size:13px}.co-manageRows article span,.co-manageRows article small{display:block;margin-top:3px;color:#9cb6c0;font-size:10px}.co-manageRows article>button{height:36px;padding:0 10px;border:1px solid rgba(89,216,255,.2);border-radius:8px;background:#0a1820;font-size:8px;font-weight:950}.co-manageRows article>b{color:#83e7ae;font-size:9px;letter-spacing:.08em}.co-deleteOptions{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:12px;padding-top:12px;border-top:1px solid rgba(130,193,216,.1)}.co-deleteOptions label{color:#bdcfd6;font-size:11px}.co-deleteOptions input{margin-right:8px}.is-danger{border-color:rgba(255,116,122,.32)!important;color:#ffb6ba!important;background:rgba(110,25,31,.18)!important}
        .co-builder{scroll-margin-top:18px}.co-builderBody{display:grid;gap:13px}.co-builderGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.co-builderSection{padding:15px;border:1px solid rgba(133,196,219,.11);border-radius:12px;background:rgba(255,255,255,.015)}.co-builderSection h3{margin:0 0 11px;font-size:15px}.co-choiceRow,.co-choiceGrid{display:flex;gap:7px;flex-wrap:wrap}.co-choiceGrid{display:grid;grid-template-columns:repeat(2,1fr)}.co-choiceRow button,.co-choiceGrid button{min-height:42px;padding:0 12px;border:1px solid rgba(129,192,215,.15);border-radius:9px;background:#08151c;color:#c1d3da;font-size:10px;font-weight:900}.co-choiceRow button.is-active,.co-choiceGrid button.is-active{border-color:rgba(89,216,255,.45);background:rgba(35,132,169,.21);color:#fff}.co-field{display:grid;gap:5px;margin-top:10px}.co-field span{color:#8caebb;font-size:8px;font-weight:950;letter-spacing:.08em}.co-field input{height:42px;padding:0 11px;border:1px solid rgba(129,191,214,.16);border-radius:8px;outline:0;background:#061117;color:#fff;font-size:12px}.co-field input:focus{border-color:rgba(89,216,255,.5)}.co-bodyFields{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}.co-bodyFields .co-field{margin:0}.co-builderActions{display:flex;justify-content:flex-end;gap:8px}.co-builderActions button{min-height:44px;padding:0 16px}
        .co-confirmOverlay{position:fixed;z-index:10100;inset:0;display:grid;place-items:center;padding:18px;background:rgba(0,5,9,.8);backdrop-filter:blur(10px)}.co-confirmModal{width:min(520px,100%);padding:22px;border:1px solid rgba(255,116,122,.35);border-radius:17px;background:linear-gradient(#142028,#081015);box-shadow:0 30px 80px rgba(0,0,0,.7)}.co-confirmModal>span{color:#ff9ea3;font-size:9px;font-weight:1000;letter-spacing:.12em}.co-confirmModal h2{margin:7px 0;font-size:25px}.co-confirmModal p{color:#c7d6dc;font-size:13px;line-height:1.55}.co-confirmModal div{display:flex;justify-content:flex-end;gap:8px}.co-confirmModal button{height:42px;padding:0 14px;border:1px solid rgba(130,193,216,.17);border-radius:9px;background:#09161d;font-size:9px;font-weight:950}
        @media(max-width:900px){.co-briefingGrid{grid-template-columns:1fr}.co-briefCard{min-height:0}.co-reviewGrid{grid-template-columns:repeat(2,1fr)}.co-reviewGrid article:nth-child(3){border-left:0;border-top:1px solid rgba(138,198,221,.09)}.co-reviewGrid article:nth-child(4){border-top:1px solid rgba(138,198,221,.09)}.co-nutritionGrid{grid-template-columns:1fr 1fr}.co-nutritionAdvice{grid-column:1/-1}.co-featuredTip{grid-template-columns:1fr 1fr}.co-featuredTip>div:first-child{grid-column:1/-1}.co-programControl{align-items:flex-start;flex-direction:column}.co-controlButtons{justify-content:flex-start}.co-builderGrid{grid-template-columns:1fr}.co-decisionRow{grid-template-columns:minmax(170px,.8fr) minmax(0,1.5fr)}}
        @media(max-width:650px){.co-page{width:min(100% - 16px,1180px);gap:9px;margin-bottom:105px}.co-hero{padding:18px;align-items:flex-start;flex-direction:column}.co-hero h1{font-size:38px}.co-programName{font-size:25px}.co-programMetaLine{font-size:12px}.co-heroStatus{width:100%;min-width:0}.co-section{padding:15px}.co-sectionTitle{align-items:flex-start;flex-direction:column;margin-bottom:13px}.co-sectionTitle h2{font-size:24px}.co-sectionTitleText p{font-size:11px}.co-sectionRight,.co-sectionRight button{width:100%}.co-nextWorkoutHead{grid-template-columns:1fr 115px}.co-nextWorkoutHead strong{font-size:18px}.co-decisionRow{grid-template-columns:1fr;gap:9px;padding:13px}.co-decisionCommand>strong{font-size:19px}.co-decisionRow>button{width:100%}.co-reviewGrid{grid-template-columns:1fr}.co-reviewGrid article+article,.co-reviewGrid article:nth-child(3){border-left:0;border-top:1px solid rgba(138,198,221,.09)}.co-nutritionGrid{grid-template-columns:1fr}.co-nutritionAdvice{grid-column:auto}.co-featuredTip{grid-template-columns:1fr}.co-featuredTip>div:first-child{grid-column:auto}.co-tipEvidence{padding-left:0;padding-top:10px;border-left:0;border-top:1px solid rgba(136,197,220,.1)}.co-featuredTip>button{width:100%}.co-historyList article{align-items:flex-start;flex-direction:column}.co-historyList article b{font-size:13px}.co-controlButtons{display:grid;grid-template-columns:1fr;width:100%}.co-manageRows article{grid-template-columns:28px minmax(0,1fr)}.co-manageRows article>button,.co-manageRows article>b{grid-column:2;width:100%;text-align:center}.co-deleteOptions{align-items:flex-start;flex-direction:column}.co-deleteOptions button{width:100%}.co-choiceGrid{grid-template-columns:1fr 1fr}.co-bodyFields{grid-template-columns:1fr 1fr}.co-builderActions{display:grid;grid-template-columns:1fr}.co-builderActions button{width:100%}.co-toast{right:8px;bottom:76px;width:calc(100vw - 16px)}}
        /* FINAL COACH READABILITY PASS */
        .co-sectionTitleText p,.co-heroStatus span,.co-briefTop span,.co-reviewGrid span,.co-assessment span,.co-programControl span,.co-featuredTip>div>span,.co-tipEvidence span,.co-nextWorkoutHead span{font-size:11px;line-height:1.35}.co-heroStatus small,.co-decisionExercise span,.co-decisionCommand small{font-size:13px;line-height:1.45}.co-briefCard h3{font-size:20px}.co-briefCard p{font-size:14px;line-height:1.55}.co-briefAction{font-size:14px}.co-briefCard button,.co-decisionRow>button,.co-controlButtons button,.co-manageHead button,.co-builderActions button,.co-builder .co-sectionRight button,.co-featuredTip>button{font-size:12px;color:#fff}.co-decisionExercise strong{font-size:17px}.co-decisionCommand>span{font-size:12px}.co-decisionCommand>strong{font-size:23px}.co-reviewGrid strong{font-size:22px}.co-programControl small{font-size:13px}.co-manageRows article strong{font-size:15px}.co-manageRows article span,.co-manageRows article small{font-size:12px}.co-manageRows article>button,.co-manageRows article>b{font-size:11px}.co-choiceRow button,.co-choiceGrid button{font-size:13px;color:#fff}.co-field span{font-size:11px}.co-field input{font-size:14px}.co-confirmModal>span,.co-confirmModal button{font-size:12px}
        @media(max-width:650px){.co-page{width:calc(100% - 12px)}.co-hero{padding:17px 15px}.co-hero h1{font-size:34px}.co-programName{font-size:26px}.co-programMetaLine{font-size:14px}.co-heroStatus strong{font-size:20px}.co-section{padding:14px}.co-sectionTitle h2{font-size:24px}.co-sectionTitleText p{font-size:13px}.co-nextWorkoutHead{grid-template-columns:1fr}.co-nextWorkoutHead strong{font-size:22px}.co-nextWorkoutHead small{font-size:13px}.co-decisionRow{padding:15px}.co-decisionExercise strong{font-size:18px}.co-decisionExercise span{font-size:13px}.co-decisionCommand>span{font-size:12px}.co-decisionCommand>strong{font-size:24px}.co-decisionCommand small{font-size:13px}.co-decisionRow>button{min-height:43px;font-size:13px}.co-reviewGrid strong{font-size:24px}.co-controlButtons button{min-height:44px;font-size:13px}.co-manageRows article{padding:13px}.co-choiceRow button,.co-choiceGrid button{min-height:46px;font-size:13px}}

        /* AUG 9 FINAL COACH ACTIVE-PROGRAM + MOBILE */
        .co-programName{overflow-wrap:anywhere!important;line-height:1.08!important}
        .co-nextWorkoutHead>div:first-child{display:grid!important;align-content:center!important}
        .co-nextWorkoutHead>div:first-child strong{font-size:24px!important}
        .co-decisionCommand>span{font-size:12px!important;color:#a9eaff!important}
        .co-decisionCommand>strong{font-size:24px!important}
        .co-decisionCommand small{font-size:13px!important;color:#b9ced6!important}
        .co-decisionExercise strong{font-size:17px!important}
        .co-decisionExercise span{font-size:12px!important;color:#b1c6ce!important}
        /* FINAL NO-CLIP / PRO MOBILE GUARANTEE */
        .co-page,.co-page *{min-width:0}
        .co-page h1,.co-page h2,.co-page h3,.co-page strong,.co-page span,.co-page small,.co-page p,.co-page b,.co-page button,.co-page label{overflow-wrap:anywhere;word-break:normal}
        .co-page button{white-space:normal;line-height:1.25;min-height:40px}
        .co-sectionTitleText,.co-nextWorkoutHead>div,.co-decisionExercise,.co-decisionCommand,.co-programControl>div{min-width:0;overflow:visible}
        .co-decisionExercise strong,.co-decisionCommand strong,.co-nextWorkoutHead strong{line-height:1.2;padding-bottom:2px;overflow:visible}
        .co-nextWorkoutHead{overflow:hidden}
        .co-nextWorkoutHead>div{overflow:hidden}
        .co-nextWorkoutHead small{white-space:normal}
        @media(max-width:650px){
          .co-page{width:calc(100% - 10px)!important;max-width:100%!important;margin-bottom:116px!important;overflow-x:hidden!important}
          .co-hero{padding:16px 13px!important;gap:12px!important}
          .co-hero h1{font-size:34px!important}.co-programName{font-size:25px!important}.co-programMetaLine{font-size:13px!important}
          .co-heroStatus{padding:13px!important}.co-heroStatus strong{font-size:18px!important}.co-heroStatus small{font-size:12px!important}
          .co-section{padding:13px 11px!important}
          .co-sectionTitle{gap:10px!important;margin-bottom:12px!important}.co-sectionTitle h2{font-size:23px!important}.co-sectionTitleText p{font-size:12px!important}
          .co-briefingGrid{grid-template-columns:1fr!important;gap:7px!important}.co-briefCard{min-height:0!important;padding:14px!important}.co-briefCard h3{font-size:19px!important}.co-briefCard p{font-size:13px!important}.co-briefAction{font-size:15px!important;padding-top:10px!important}
          .co-nextWorkoutHead{grid-template-columns:1fr!important;gap:7px!important}.co-nextWorkoutHead>div{padding:13px!important}.co-nextWorkoutHead strong{font-size:22px!important}
          .co-decisionRows{gap:7px!important}.co-decisionRow{grid-template-columns:1fr!important;gap:8px!important;padding:13px!important}.co-decisionExercise strong{font-size:18px!important}.co-decisionExercise span{font-size:12px!important}.co-decisionCommand>span{font-size:11px!important}.co-decisionCommand>strong{font-size:23px!important}.co-decisionCommand small{font-size:12.5px!important;line-height:1.45!important}.co-decisionRow>button{width:100%!important;min-height:42px!important;font-size:12px!important}
          .co-reviewGrid{grid-template-columns:1fr!important}.co-reviewGrid article{min-height:0!important;padding:13px!important}.co-reviewGrid strong{font-size:22px!important}
          .co-nutritionGrid{grid-template-columns:1fr!important}.co-programControl{padding:13px!important}.co-programControl strong{font-size:19px!important}.co-controlButtons{grid-template-columns:1fr!important}
          .co-manageRows article{grid-template-columns:28px minmax(0,1fr)!important}.co-manageRows article>button,.co-manageRows article>b{grid-column:2!important;width:100%!important}
          .co-primaryAction,.co-sectionRight button{width:100%!important;min-height:43px!important;font-size:12px!important}
        }

        /* AUG 9 FLAGSHIP SEMANTIC SURFACE PASS */
        .co-page{--violet:#b79cff;--neutral:#0a1117}
        .co-surface{
          border-color:rgba(255,255,255,.085)!important;
          border-top-color:rgba(255,255,255,.14)!important;
          background:linear-gradient(155deg,#0c1319 0%,#070c11 58%,#05090d 100%)!important;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.035),0 16px 42px rgba(0,0,0,.28)!important;
        }
        .co-section{position:relative;overflow:hidden}
        .co-section::before{content:"";position:absolute;left:0;top:18px;bottom:18px;width:2px;border-radius:99px;background:rgba(126,220,255,.34);pointer-events:none}
        .co-section--brief::before{background:var(--violet)!important}.co-section--brief .co-sectionAccent{background:var(--violet)!important}
        .co-section--next::before{background:var(--c)!important}.co-section--next .co-sectionAccent{background:var(--c)!important}
        .co-section--review::before{background:var(--g)!important}.co-section--review .co-sectionAccent{background:var(--g)!important}
        .co-section--nutrition::before{background:var(--a)!important}.co-section--nutrition .co-sectionAccent{background:var(--a)!important}
        .co-section--tips::before{background:var(--violet)!important}.co-section--tips .co-sectionAccent{background:var(--violet)!important}
        .co-section--history::before{background:#8ba0aa!important}.co-section--history .co-sectionAccent{background:#8ba0aa!important}
        .co-section--control::before{background:#6f8cf5!important}.co-section--control .co-sectionAccent{background:#6f8cf5!important}
        .co-builder::before{background:#6f8cf5!important}.co-builder .co-sectionAccent{background:#6f8cf5!important}
        .co-briefCard{background:linear-gradient(145deg,rgba(255,255,255,.025),rgba(255,255,255,.006))!important;border-color:rgba(255,255,255,.075)!important}
        .co-briefCard.is-green{background:linear-gradient(145deg,rgba(44,190,119,.075),rgba(255,255,255,.008))!important}
        .co-briefCard.is-amber{background:linear-gradient(145deg,rgba(231,167,65,.075),rgba(255,255,255,.008))!important}
        .co-briefCard.is-red{border-left-color:var(--r)!important;background:linear-gradient(145deg,rgba(255,92,101,.072),rgba(255,255,255,.008))!important}
        .co-nextWorkoutHead>div{background:linear-gradient(145deg,rgba(255,255,255,.028),rgba(255,255,255,.008))!important;border-color:rgba(255,255,255,.08)!important}
        .co-decisionRow{background:linear-gradient(145deg,rgba(255,255,255,.024),rgba(255,255,255,.006))!important;border-color:rgba(255,255,255,.075)!important}
        .co-decisionRow.is-red{border-left-color:var(--r)!important}.co-decisionRow.is-red .co-decisionCommand>span,.co-decisionRow.is-red .co-decisionCommand>strong{color:#ff969b!important}
        .co-decisionRow.is-amber{border-left-color:var(--a)!important}.co-decisionRow.is-amber .co-decisionCommand>span,.co-decisionRow.is-amber .co-decisionCommand>strong{color:#ffd18a!important}
        .co-decisionRow.is-blue{border-left-color:var(--c)!important}.co-decisionRow.is-blue .co-decisionCommand>span,.co-decisionRow.is-blue .co-decisionCommand>strong{color:#94e6ff!important}
        .co-decisionRow.is-green{border-left-color:var(--g)!important}.co-decisionRow.is-green .co-decisionCommand>span,.co-decisionRow.is-green .co-decisionCommand>strong{color:#9ff0bd!important}
        .co-reviewGrid article,.co-assessment,.co-programControl,.co-featuredTip,.co-manageRows article{background:rgba(255,255,255,.018)!important}
        .co-sectionTitle h2,.co-programName,.co-nextWorkoutHead strong{color:#f8fbfd!important}
        .co-page p,.co-page small,.co-page span{max-width:100%}
        .co-page button{overflow:visible;text-overflow:clip}
        @media(max-width:900px){.co-page{width:calc(100% - 18px)!important}.co-nextWorkoutHead,.co-decisionRow{min-width:0!important}.co-decisionRow>button{grid-column:auto!important}}
        @media(max-width:650px){
          .co-surface{border-radius:15px!important}
          .co-section::before{top:12px;bottom:12px}
          .co-sectionTitle,.co-nextWorkoutHead,.co-briefCard,.co-decisionRow,.co-reviewGrid article,.co-programControl,.co-featuredTip{min-width:0!important;max-width:100%!important}
          .co-sectionTitle h2,.co-briefCard h3,.co-programName,.co-nextWorkoutHead strong,.co-decisionExercise strong,.co-decisionCommand strong{white-space:normal!important;overflow:visible!important;text-overflow:clip!important;word-break:normal!important;overflow-wrap:anywhere!important}
          .co-decisionExercise span,.co-decisionCommand small,.co-sectionTitleText p{white-space:normal!important;overflow:visible!important}
        }
      `}</style>
    </div>
  );
}
