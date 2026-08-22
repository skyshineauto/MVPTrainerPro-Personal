export type TrainingGoal = "muscle_gain" | "bulk" | "cut" | "strength" | "fitness" | "training";
export type CoachConfidence = "LOW" | "MODERATE" | "HIGH";
export type ProgressionAction = "BASELINE" | "HOLD" | "MONITOR" | "INCREASE" | "REDUCE" | "RECOVERY";

export type TrainingSetSample = {
  weight: number;
  reps: number;
  rir?: number | null;
};

export type TrainingSessionSample = {
  sets: TrainingSetSample[];
  pain?: number | null;
  difficulty?: string | null;
  completedAt?: string | null;
};

export type ExerciseDescriptor = {
  name?: string | null;
  equipment?: string[] | null;
  primary_muscles?: string[] | null;
};

export type ProgressionAnalysis = {
  action: ProgressionAction;
  currentWeight: number | null;
  suggestedWeight: number | null;
  reason: string;
  nextTarget: string;
  lastSummary: string;
  confidence: CoachConfidence;
  confidenceDetail: string;
  confidenceScore: number;
  averageRir: number | null;
  finalRir: number | null;
  totalReps: number;
  usableSessions: number;
};

export function normalizeTrainingGoal(value: string | null | undefined): TrainingGoal {
  const key = String(value ?? "").trim().toLowerCase();
  if (["build_muscle", "muscle_gain", "bulk"].includes(key)) return key === "bulk" ? "bulk" : "muscle_gain";
  if (["lose_weight", "cut"].includes(key)) return "cut";
  if (key === "strength") return "strength";
  if (key === "fitness") return "fitness";
  return "training";
}

export function confidenceForUsableSessions(sessions: number) {
  if (sessions >= 5) return { level: "HIGH" as const, detail: `${sessions} usable sessions`, score: 5 };
  if (sessions >= 2) return { level: "MODERATE" as const, detail: `${sessions} usable sessions`, score: 3 };
  if (sessions === 1) return { level: "LOW" as const, detail: "1 usable session", score: 1 };
  return { level: "LOW" as const, detail: "No usable sessions yet", score: 0 };
}

function cleanSets(sets: TrainingSetSample[]) {
  return sets
    .map((set) => ({
      weight: Number(set.weight ?? 0),
      reps: Number(set.reps ?? 0),
      rir: set.rir == null ? null : Number(set.rir),
    }))
    .filter((set) => set.weight > 0 && set.reps > 0);
}

export function primaryWorkingWeight(sets: TrainingSetSample[]) {
  const valid = cleanSets(sets);
  if (!valid.length) return 0;
  const counts = new Map<number, number>();
  for (const set of valid) counts.set(set.weight, (counts.get(set.weight) ?? 0) + 1);
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? valid[0].weight;
}

function observedIncrement(sessions: TrainingSessionSample[]) {
  const weights = Array.from(new Set(sessions.flatMap((session) => cleanSets(session.sets).map((set) => set.weight)))).sort((a, b) => a - b);
  const diffs = weights.slice(1).map((value, index) => Number((value - weights[index]).toFixed(2))).filter((value) => value > 0.24 && value <= 50);
  if (!diffs.length) return null;
  return diffs.sort((a, b) => a - b)[0];
}

export function inferLoadIncrement(exercise: ExerciseDescriptor | null | undefined, currentWeight: number, sessions: TrainingSessionSample[] = []) {
  const observed = observedIncrement(sessions);
  if (observed != null) return observed;

  const text = [exercise?.name, ...(exercise?.equipment ?? []), ...(exercise?.primary_muscles ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/dumbbell|db\b/.test(text)) return 5;
  if (/cable|selector|machine|stack/.test(text)) return currentWeight < 30 ? 2.5 : 5;
  if (/leg press|hack squat|squat|deadlift|hip thrust|calf press/.test(text)) return 10;
  if (/barbell/.test(text)) return currentWeight >= 95 ? 10 : 5;
  if (/bodyweight|pull[- ]?up|chin[- ]?up|dip/.test(text)) return 5;
  if (currentWeight < 10) return 1;
  if (currentWeight < 30) return 2.5;
  return 5;
}

function roundToIncrement(value: number, increment: number) {
  if (!(value > 0) || !(increment > 0)) return 0;
  return Math.max(increment, Math.round(value / increment) * increment);
}

function roundDownToIncrement(value: number, increment: number) {
  if (!(value > 0) || !(increment > 0)) return 0;
  return Math.max(increment, Math.floor(value / increment) * increment);
}

function fmtWeight(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

export function analyzeProgression(params: {
  goal?: string | null;
  sessions: TrainingSessionSample[];
  repMin: number;
  repMax: number;
  setsTarget: number;
  exercise?: ExerciseDescriptor | null;
  usableSessionCount?: number;
}): ProgressionAnalysis {
  const goal = normalizeTrainingGoal(params.goal);
  const repMin = Math.max(1, Number(params.repMin || 8));
  const repMax = Math.max(repMin, Number(params.repMax || repMin));
  const setsTarget = Math.max(1, Number(params.setsTarget || 3));
  const usableSessions = params.sessions.filter((session) => cleanSets(session.sets).length > 0);
  const usableSessionCount = Math.max(usableSessions.length, Number(params.usableSessionCount ?? 0));
  const confidence = confidenceForUsableSessions(usableSessionCount);
  const latest = usableSessions.at(-1) ?? null;

  if (!latest) {
    return {
      action: "BASELINE",
      currentWeight: null,
      suggestedWeight: null,
      reason: "No usable completed performance exists yet. Establish a controlled working weight and log every working set.",
      nextTarget: `${setsTarget} × ${repMin}-${repMax} reps`,
      lastSummary: "No usable history",
      confidence: confidence.level,
      confidenceDetail: confidence.detail,
      confidenceScore: confidence.score,
      averageRir: null,
      finalRir: null,
      totalReps: 0,
      usableSessions: 0,
    };
  }

  const sets = cleanSets(latest.sets);
  const currentWeight = primaryWorkingWeight(sets);
  const increment = inferLoadIncrement(params.exercise, currentWeight, usableSessions);
  const totalReps = sets.reduce((sum, set) => sum + set.reps, 0);
  const rirValues = sets.map((set) => set.rir).filter((value): value is number => value != null && Number.isFinite(value) && value >= 0);
  const averageRir = rirValues.length ? rirValues.reduce((sum, value) => sum + value, 0) / rirValues.length : null;
  const finalRir = sets.length && sets.at(-1)!.rir != null ? Number(sets.at(-1)!.rir) : null;
  const pain = Number(latest.pain ?? 0);
  const belowMinimum = sets.filter((set) => set.reps < repMin).length;
  const allAtLeastMinimum = sets.length >= setsTarget && sets.slice(0, setsTarget).every((set) => set.reps >= repMin);
  const allReachedTop = sets.length >= setsTarget && sets.slice(0, setsTarget).every((set) => set.reps >= repMax);
  const repDrop = sets.length >= 2 ? sets[0].reps - sets[Math.min(sets.length, setsTarget) - 1].reps : 0;
  const lastSummary = `${fmtWeight(currentWeight)} lb • ${sets.slice(0, setsTarget).map((set) => set.reps).join(" / ")} reps${averageRir == null ? "" : ` • ${averageRir.toFixed(1)} avg RIR`}`;

  if (pain >= 7) {
    return {
      action: "RECOVERY",
      currentWeight,
      suggestedWeight: roundDownToIncrement(currentWeight * 0.9, increment) || null,
      reason: `Pain reached ${pain}/10. Recovery takes priority over progression on this movement.`,
      nextTarget: "Use a pain-free load or variation before resuming progression",
      lastSummary,
      confidence: confidence.level,
      confidenceDetail: confidence.detail,
      confidenceScore: confidence.score,
      averageRir,
      finalRir,
      totalReps,
      usableSessions: usableSessionCount,
    };
  }

  const majorFailure = belowMinimum >= Math.max(1, Math.ceil(setsTarget / 2)) || (sets[0]?.rir != null && Number(sets[0].rir) <= 1 && belowMinimum > 0);
  if (majorFailure || latest.difficulty === "too_hard") {
    const reduced = roundDownToIncrement(currentWeight * 0.9, increment);
    return {
      action: "REDUCE",
      currentWeight,
      suggestedWeight: reduced,
      reason: majorFailure
        ? `${belowMinimum} working set${belowMinimum === 1 ? "" : "s"} fell below the ${repMin}-${repMax} target and the load was not producing enough quality work.`
        : "The previous session was marked too hard. Reduce the load and rebuild clean reps.",
      nextTarget: `${setsTarget} × ${repMin}-${Math.min(repMax, repMin + 2)} clean reps`,
      lastSummary,
      confidence: confidence.level,
      confidenceDetail: confidence.detail,
      confidenceScore: confidence.score,
      averageRir,
      finalRir,
      totalReps,
      usableSessions: usableSessionCount,
    };
  }

  if (pain >= 3) {
    return {
      action: "RECOVERY",
      currentWeight,
      suggestedWeight: currentWeight,
      reason: `Pain was ${pain}/10. Hold load progression and reassess this movement before adding weight.`,
      nextTarget: `Stay controlled inside ${repMin}-${repMax} reps only if the movement is comfortable`,
      lastSummary,
      confidence: confidence.level,
      confidenceDetail: confidence.detail,
      confidenceScore: confidence.score,
      averageRir,
      finalRir,
      totalReps,
      usableSessions: usableSessionCount,
    };
  }

  const clearlyEasy = allReachedTop && averageRir != null && averageRir >= 3;
  const earnedIncrease = allReachedTop && (averageRir == null || averageRir >= 2) && (finalRir == null || finalRir >= 2);
  const cutNeedsExtraEvidence = goal === "cut" && usableSessionCount < 2 && !clearlyEasy;

  if ((clearlyEasy || earnedIncrease) && !cutNeedsExtraEvidence) {
    const suggestedWeight = roundToIncrement(currentWeight + increment, increment);
    return {
      action: "INCREASE",
      currentWeight,
      suggestedWeight,
      reason: clearlyEasy
        ? `All working sets reached the top of the ${repMin}-${repMax} range with substantial reps still in reserve. The load is now too conservative.`
        : `All ${setsTarget} working sets reached the top of the ${repMin}-${repMax} range with controlled effort.`,
      nextTarget: `${setsTarget} × ${repMin}-${Math.min(repMax, repMin + 2)} reps at ${fmtWeight(suggestedWeight)} lb`,
      lastSummary,
      confidence: confidence.level,
      confidenceDetail: confidence.detail,
      confidenceScore: confidence.score,
      averageRir,
      finalRir,
      totalReps,
      usableSessions: usableSessionCount,
    };
  }

  if (!allAtLeastMinimum || repDrop >= Math.max(4, Math.ceil((repMax - repMin + 1) / 2) + 2)) {
    return {
      action: "MONITOR",
      currentWeight,
      suggestedWeight: currentWeight,
      reason: "The load is usable, but set-to-set performance is not yet stable enough to justify an increase.",
      nextTarget: `Keep ${fmtWeight(currentWeight)} lb and add 1-2 total clean reps without increasing effort`,
      lastSummary,
      confidence: confidence.level,
      confidenceDetail: confidence.detail,
      confidenceScore: confidence.score,
      averageRir,
      finalRir,
      totalReps,
      usableSessions: usableSessionCount,
    };
  }

  const nextTotal = totalReps + Math.max(1, Math.min(2, setsTarget));
  return {
    action: "HOLD",
    currentWeight,
    suggestedWeight: currentWeight,
    reason: goal === "cut"
      ? "The current load is preserving productive performance. During a cut, maintaining strength and quality reps is a successful result until progression is clearly earned."
      : "The current load is productive. Add clean reps across the working sets before increasing weight.",
    nextTarget: `Aim for ${nextTotal} total reps across ${setsTarget} sets at ${fmtWeight(currentWeight)} lb`,
    lastSummary,
    confidence: confidence.level,
    confidenceDetail: confidence.detail,
    confidenceScore: confidence.score,
    averageRir,
    finalRir,
    totalReps,
    usableSessions: usableSessionCount,
  };
}

export function analyzeLiveSet(params: {
  goal?: string | null;
  set: TrainingSetSample;
  repMin: number;
  repMax: number;
  exercise?: ExerciseDescriptor | null;
  historySessions?: TrainingSessionSample[];
}) {
  const weight = Number(params.set.weight ?? 0);
  const reps = Number(params.set.reps ?? 0);
  const rir = params.set.rir == null ? null : Number(params.set.rir);
  const repMin = Math.max(1, Number(params.repMin || 8));
  const repMax = Math.max(repMin, Number(params.repMax || repMin));
  const increment = inferLoadIncrement(params.exercise, weight, params.historySessions ?? []);

  if (rir === 0 && reps < repMin) {
    const nextWeight = roundDownToIncrement(weight * 0.9, increment);
    return { status: "LOAD TOO HEAVY", tone: "reduce" as const, nextWeight, instruction: `Reduce to ${fmtWeight(nextWeight)} lb and target ${repMin}-${Math.min(repMax, repMin + 2)} clean reps.` };
  }
  if (rir != null && rir >= 4 && reps >= Math.max(repMin, repMax - 1)) {
    const nextWeight = roundToIncrement(weight + increment, increment);
    return { status: "TOO EASY", tone: "increase" as const, nextWeight, instruction: `Increase next set to ${fmtWeight(nextWeight)} lb and target ${repMin}-${Math.min(repMax, repMin + 2)} clean reps.` };
  }
  if (rir === 0) {
    return { status: "MAXIMUM EFFORT", tone: "monitor" as const, nextWeight: weight, instruction: `Keep ${fmtWeight(weight)} lb only if you can stay inside ${repMin}-${repMax} clean reps. Otherwise reduce one increment.` };
  }
  if (rir === 1) {
    return { status: "VERY HARD", tone: "monitor" as const, nextWeight: weight, instruction: `Keep ${fmtWeight(weight)} lb and protect the rep floor. Do not add weight.` };
  }
  if (rir === 2) {
    return { status: "TARGET EFFORT", tone: "good" as const, nextWeight: weight, instruction: `Keep ${fmtWeight(weight)} lb and stay in the ${repMin}-${repMax} range with clean reps.` };
  }
  if (rir != null && rir >= 3) {
    return { status: "CONTROLLED SET", tone: "good" as const, nextWeight: weight, instruction: `Keep ${fmtWeight(weight)} lb and add a clean rep if available without forcing failure.` };
  }
  return { status: "EFFORT NOT RATED", tone: "hold" as const, nextWeight: weight, instruction: `Keep ${fmtWeight(weight)} lb and stay inside ${repMin}-${repMax} clean reps.` };
}
