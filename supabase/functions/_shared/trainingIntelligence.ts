export type TrainingGoal = "muscle_gain" | "bulk" | "cut" | "strength" | "fitness" | "training";
export type CoachConfidence = "LOW" | "MODERATE" | "HIGH";
export type ProgressionAction = "BASELINE" | "HOLD" | "MONITOR" | "INCREASE" | "REDUCE" | "RECOVERY";
export type ExerciseDirective = "KEEP" | "PROGRESS" | "MONITOR" | "REGRESS LOAD" | "MODIFY" | "SWAP REVIEW" | "PAUSE";

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
  repPlan: string;
  rirTarget: string;
  ifTooEasy: string;
  ifTooHard: string;
  progressWhen: string;
  exerciseDirective: ExerciseDirective;
  exerciseReason: string;
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

function targetRir(goal: TrainingGoal) {
  if (goal === "strength") return "1–3 RIR";
  if (goal === "cut") return "1–3 RIR • avoid unnecessary failure";
  if (goal === "muscle_gain" || goal === "bulk") return "1–3 RIR • final isolation set may reach 0–1 RIR";
  return "1–3 RIR";
}

function buildRepPlan(sets: ReturnType<typeof cleanSets>, setsTarget: number, repMin: number, repMax: number, action: ProgressionAction) {
  if (action === "BASELINE") return Array.from({ length: setsTarget }, () => `${repMin}–${repMax}`).join(" / ");
  if (action === "INCREASE") {
    const high = Math.min(repMax, repMin + 2);
    return Array.from({ length: setsTarget }, (_, index) => index === setsTarget - 1 ? `${repMin}+` : `${repMin}–${high}`).join(" / ");
  }
  if (action === "REDUCE" || action === "RECOVERY") {
    return Array.from({ length: setsTarget }, (_, index) => index === setsTarget - 1 ? `${repMin}+` : `${repMin}–${Math.min(repMax, repMin + 2)}`).join(" / ");
  }

  const reps = Array.from({ length: setsTarget }, (_, index) => Math.max(repMin, Math.min(repMax, sets[index]?.reps ?? repMin)));
  let additions = action === "MONITOR" ? 1 : Math.max(1, Math.min(2, setsTarget));
  for (let pass = 0; pass < setsTarget * 2 && additions > 0; pass += 1) {
    const index = pass % setsTarget;
    if (reps[index] < repMax) {
      reps[index] += 1;
      additions -= 1;
    }
  }
  return reps.map((value, index) => index === setsTarget - 1 && value < repMax ? `${value}+` : String(value)).join(" / ");
}

function sessionQuality(session: TrainingSessionSample) {
  const sets = cleanSets(session.sets);
  if (!sets.length) return 0;
  const weight = primaryWorkingWeight(sets);
  const reps = sets.reduce((sum, set) => sum + set.reps, 0);
  return weight * (1 + reps / Math.max(1, sets.length) / 30);
}

function exerciseDirectiveFor(sessions: TrainingSessionSample[], action: ProgressionAction) {
  const recent = sessions.slice(-6);
  const painWindow = recent.slice(-4);
  const painSignals = painWindow.filter((session) => Number(session.pain ?? 0) >= 3).length;
  const severePain = painWindow.some((session) => Number(session.pain ?? 0) >= 7);
  if (severePain) return { directive: "PAUSE" as const, reason: "A severe pain signal was recorded. Stop loading this movement until a pain-free setup or replacement is established." };
  if (painSignals >= 2) return { directive: "SWAP REVIEW" as const, reason: `Pain was elevated in ${painSignals} of the last ${painWindow.length} usable sessions. Review a pain-free replacement that preserves this movement's role in the program.` };

  // A full four-exposure plateau at hard effort earns a real swap review.
  // Three flat hard exposures trigger a smaller programming modification first.
  const swapWindow = recent.slice(-4);
  if (swapWindow.length >= 4) {
    const first = sessionQuality(swapWindow[0]);
    const last = sessionQuality(swapWindow.at(-1)!);
    const change = first > 0 ? ((last - first) / first) * 100 : 0;
    const recentRirs = swapWindow.flatMap((session) => cleanSets(session.sets).map((set) => set.rir).filter((value): value is number => value != null));
    const avgRir = recentRirs.length ? recentRirs.reduce((sum, value) => sum + value, 0) / recentRirs.length : null;
    if (change < 1 && avgRir != null && avgRir <= 1.5) {
      return { directive: "SWAP REVIEW" as const, reason: "Performance has remained flat across four hard exposures. Review a fresh variation that keeps the same program role instead of forcing more fatigue into a stalled movement." };
    }
  }

  const modifyWindow = recent.slice(-3);
  if (modifyWindow.length >= 3) {
    const first = sessionQuality(modifyWindow[0]);
    const last = sessionQuality(modifyWindow.at(-1)!);
    const change = first > 0 ? ((last - first) / first) * 100 : 0;
    const recentRirs = modifyWindow.flatMap((session) => cleanSets(session.sets).map((set) => set.rir).filter((value): value is number => value != null));
    const avgRir = recentRirs.length ? recentRirs.reduce((sum, value) => sum + value, 0) / recentRirs.length : null;
    if (change < 1 && avgRir != null && avgRir <= 1.5) {
      return { directive: "MODIFY" as const, reason: "Performance has been flat across three hard exposures. Adjust load, rest, rep strategy, or setup before replacing the exercise." };
    }
  }

  if (action === "INCREASE") return { directive: "PROGRESS" as const, reason: "The movement is producing stable, progression-ready performance." };
  if (action === "REDUCE") return { directive: "REGRESS LOAD" as const, reason: "Keep the exercise, but correct the working load so the full set sequence is productive." };
  if (action === "MONITOR" || action === "RECOVERY") return { directive: "MONITOR" as const, reason: "Keep the movement under observation while the next session provides more evidence." };
  return { directive: "KEEP" as const, reason: "The exercise is currently productive enough to keep in the program." };
}

function basePrescription(goal: TrainingGoal, currentWeight: number | null, increment: number, repMin: number, repMax: number) {
  const load = currentWeight ?? 0;
  return {
    rirTarget: targetRir(goal),
    ifTooEasy: load > 0
      ? `If Set 1 reaches ${Math.max(repMin, repMax - 1)}+ reps with 4+ RIR, move up one available increment to about ${fmtWeight(roundToIncrement(load + increment, increment))} lb.`
      : `If the first working set reaches ${Math.max(repMin, repMax - 1)}+ reps with 4+ RIR, increase one available increment.`,
    ifTooHard: load > 0
      ? `If Set 1 falls below ${repMin} reps at 0–1 RIR, reduce one available increment to about ${fmtWeight(roundDownToIncrement(load - increment, increment))} lb.`
      : `If Set 1 falls below ${repMin} reps at 0–1 RIR, reduce one available increment.`,
    progressWhen: `Increase load when the full working-set sequence is near the upper end of ${repMin}–${repMax} with clean technique and roughly 1–2 RIR, not because one set touched ${repMax}.`,
  };
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
    const exerciseState = exerciseDirectiveFor([], "BASELINE");
    return {
      action: "BASELINE", currentWeight: null, suggestedWeight: null,
      reason: "No usable completed performance exists yet. Establish a controlled working weight and log every working set.",
      nextTarget: `${setsTarget} × ${repMin}–${repMax} reps`, lastSummary: "No usable history",
      confidence: confidence.level, confidenceDetail: confidence.detail, confidenceScore: confidence.score,
      averageRir: null, finalRir: null, totalReps: 0, usableSessions: 0,
      repPlan: buildRepPlan([], setsTarget, repMin, repMax, "BASELINE"), rirTarget: targetRir(goal),
      ifTooEasy: `If Set 1 reaches ${Math.max(repMin, repMax - 1)}+ reps with 4+ RIR, increase one available increment.`,
      ifTooHard: `If Set 1 falls below ${repMin} reps at 0–1 RIR, reduce one available increment.`,
      progressWhen: `Increase load when the full working-set sequence is near the upper end of ${repMin}–${repMax} with clean technique and roughly 1–2 RIR.`,
      exerciseDirective: exerciseState.directive, exerciseReason: exerciseState.reason,
    };
  }

  const sets = cleanSets(latest.sets).slice(0, setsTarget);
  const currentWeight = primaryWorkingWeight(sets);
  const increment = inferLoadIncrement(params.exercise, currentWeight, usableSessions);
  const prescription = basePrescription(goal, currentWeight, increment, repMin, repMax);
  const totalReps = sets.reduce((sum, set) => sum + set.reps, 0);
  const rirValues = sets.map((set) => set.rir).filter((value): value is number => value != null && Number.isFinite(value) && value >= 0);
  const averageRir = rirValues.length ? rirValues.reduce((sum, value) => sum + value, 0) / rirValues.length : null;
  const finalRir = sets.length && sets.at(-1)!.rir != null ? Number(sets.at(-1)!.rir) : null;
  const pain = Number(latest.pain ?? 0);
  const belowMinimum = sets.filter((set) => set.reps < repMin).length;
  const allAtLeastMinimum = sets.length >= setsTarget && sets.every((set) => set.reps >= repMin);
  const allReachedTop = sets.length >= setsTarget && sets.every((set) => set.reps >= repMax);
  const allNearTop = sets.length >= setsTarget && sets.every((set) => set.reps >= Math.max(repMin, repMax - 1));
  const repDrop = sets.length >= 2 ? sets[0].reps - sets.at(-1)!.reps : 0;
  const lastSummary = `${fmtWeight(currentWeight)} lb • ${sets.map((set) => set.reps).join(" / ")} reps${averageRir == null ? "" : ` • ${averageRir.toFixed(1)} avg RIR`}`;

  let action: ProgressionAction = "HOLD";
  let suggestedWeight: number | null = currentWeight;
  let reason = "The current load is productive. Add clean reps across the working sets before increasing weight.";

  if (pain >= 7) {
    action = "RECOVERY";
    suggestedWeight = roundDownToIncrement(currentWeight * 0.9, increment) || null;
    reason = `Pain reached ${pain}/10. Recovery takes priority. Stop or use a pain-free variation rather than forcing progression.`;
  } else {
    const majorFailure = belowMinimum >= Math.max(1, Math.ceil(setsTarget / 2)) || (sets[0]?.rir != null && Number(sets[0].rir) <= 1 && belowMinimum > 0);
    if (majorFailure || latest.difficulty === "too_hard") {
      action = "REDUCE";
      suggestedWeight = roundDownToIncrement(currentWeight - increment, increment);
      reason = majorFailure
        ? `${belowMinimum} working set${belowMinimum === 1 ? "" : "s"} fell below the ${repMin}–${repMax} floor. The exercise can stay, but the latest working load was not sustainable across the full set sequence.`
        : "The previous session was marked too hard. Reduce one available increment and rebuild quality reps.";
    } else if (pain >= 3) {
      action = "RECOVERY";
      suggestedWeight = currentWeight;
      reason = `Pain was ${pain}/10. Hold progression and reassess the movement after the first working set. Repeated pain should trigger a variation or swap review.`;
    } else {
      const clearlyEasy = allReachedTop && averageRir != null && averageRir >= 3;
      const earnedIncrease = (allReachedTop && (averageRir == null || averageRir <= 2.5) && (finalRir == null || finalRir <= 2.5)) ||
        (usableSessionCount >= 2 && allNearTop && averageRir != null && averageRir >= 1 && averageRir <= 2.5);
      const cutNeedsExtraEvidence = goal === "cut" && usableSessionCount < 2 && !clearlyEasy;
      if ((clearlyEasy || earnedIncrease) && !cutNeedsExtraEvidence) {
        action = "INCREASE";
        suggestedWeight = roundToIncrement(currentWeight + increment, increment);
        reason = clearlyEasy
          ? `The full working-set sequence reached ${repMax} reps with too much reserve. ${fmtWeight(currentWeight)} lb is now too conservative.`
          : `The full set sequence is near the upper end of ${repMin}–${repMax} at productive effort. Progression is earned across the exercise, not from a single top set.`;
      } else if (!allAtLeastMinimum || repDrop >= Math.max(4, Math.ceil((repMax - repMin + 1) / 2) + 2)) {
        action = "MONITOR";
        suggestedWeight = currentWeight;
        reason = "The load is usable, but set-to-set performance is not stable enough to add weight. Build a stronger full-set sequence first.";
      } else if (goal === "cut") {
        action = "HOLD";
        suggestedWeight = currentWeight;
        reason = "The current load is preserving productive performance. During a cut, maintaining strength and quality reps is a win until progression is clearly earned.";
      }
    }
  }

  const exerciseState = exerciseDirectiveFor(usableSessions, action);
  const repPlan = buildRepPlan(sets, setsTarget, repMin, repMax, action);
  const nextTarget = suggestedWeight
    ? `${fmtWeight(suggestedWeight)} lb • ${repPlan}`
    : `${setsTarget} × ${repMin}–${repMax}`;

  return {
    action, currentWeight, suggestedWeight, reason, nextTarget, lastSummary,
    confidence: confidence.level, confidenceDetail: confidence.detail, confidenceScore: confidence.score,
    averageRir, finalRir, totalReps, usableSessions: usableSessionCount,
    repPlan, ...prescription,
    exerciseDirective: exerciseState.directive,
    exerciseReason: exerciseState.reason,
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

  if (rir != null && rir <= 1 && reps < repMin) {
    const nextWeight = roundDownToIncrement(weight - increment, increment);
    return { status: "LOAD TOO HEAVY", tone: "reduce" as const, nextWeight, instruction: `Reduce to ${fmtWeight(nextWeight)} lb. Target ${repMin}–${Math.min(repMax, repMin + 2)} clean reps and keep 1–3 RIR.` };
  }
  if (rir != null && rir >= 4 && reps >= Math.max(repMin, repMax - 1)) {
    const nextWeight = roundToIncrement(weight + increment, increment);
    return { status: "TOO EASY", tone: "increase" as const, nextWeight, instruction: `Move to ${fmtWeight(nextWeight)} lb now. Target ${repMin}–${Math.min(repMax, repMin + 2)} reps on the next set.` };
  }
  if (rir === 0) {
    return { status: "AT FAILURE", tone: "monitor" as const, nextWeight: weight, instruction: `Do not increase. Keep ${fmtWeight(weight)} lb only if the next set can stay at or above ${repMin}; otherwise reduce one increment.` };
  }
  if (rir === 1) {
    return { status: "HIGH STIMULUS", tone: "good" as const, nextWeight: weight, instruction: `Keep ${fmtWeight(weight)} lb. Protect the ${repMin}-rep floor and do not force extra failure work.` };
  }
  if (rir === 2) {
    return { status: "WORKING LOAD FOUND", tone: "good" as const, nextWeight: weight, instruction: `Keep ${fmtWeight(weight)} lb. This is productive hypertrophy effort. Match or beat the planned next-set reps.` };
  }
  if (rir === 3) {
    return { status: "PRODUCTIVE SET", tone: "good" as const, nextWeight: weight, instruction: `Keep ${fmtWeight(weight)} lb and add a clean rep if available while staying controlled.` };
  }
  if (rir != null && rir >= 4) {
    return { status: "ROOM TO PUSH", tone: "hold" as const, nextWeight: weight, instruction: `Keep ${fmtWeight(weight)} lb for now, but push toward the upper half of ${repMin}–${repMax}. If you reach ${Math.max(repMin, repMax - 1)}+ again, increase one increment.` };
  }
  return { status: "EFFORT NOT RATED", tone: "hold" as const, nextWeight: weight, instruction: `Keep ${fmtWeight(weight)} lb and stay inside ${repMin}–${repMax} clean reps.` };
}
