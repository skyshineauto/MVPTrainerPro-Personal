import { useEffect, useMemo, useState } from "react";
import "./ProgressionCoach.css";

export type ProgressionCoachSet = {
  setIndex: number;
  weight: number;
  reps: number;
  rir?: number | null;
  pain?: number | null;
  form?: number | null;
  completed?: boolean;
};

export type ProgressionCoachPreviousSession = {
  completedAt?: string | null;
  workoutName?: string | null;
  difficulty?: "too_easy" | "just_right" | "too_hard" | null;
  pain?: number | null;
  sets: ProgressionCoachSet[];
};

export type ProgressionCoachDecision =
  | "baseline"
  | "increase"
  | "hold"
  | "reduce"
  | "modify"
  | "stop";

export type ProgressionCoachRecommendation = {
  decision: ProgressionCoachDecision;
  eyebrow: string;
  title: string;
  instruction: string;
  reason: string;
  target: string;
  suggestedWeight: number | null;
  confidence: "BASELINE" | "MODERATE" | "HIGH";
};

type ProgressionCoachProps = {
  exerciseId?: string;
  exerciseName: string;
  repMin: number;
  repMax: number;
  targetSets: number;
  currentSets: ProgressionCoachSet[];
  previousSession?: ProgressionCoachPreviousSession | null;
  loading?: boolean;
  disabled?: boolean;
  weightIncrement?: number;
  onApplyWeight?: (weight: number) => void;
};

const STORAGE_PREFIX = "mvp_progression_coach_open_";

function finiteNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundToIncrement(value: number, increment: number) {
  if (!(value > 0)) return 0;
  const safeIncrement = increment > 0 ? increment : 5;
  return Math.max(
    safeIncrement,
    Math.round(value / safeIncrement) * safeIncrement
  );
}

function formatWeight(value: number | null | undefined) {
  const number = finiteNumber(value);
  if (!(number > 0)) return "BODYWEIGHT / BASELINE";
  return `${Number(number.toFixed(2))} LB`;
}

function formatDate(value?: string | null) {
  if (!value) return "No completed history";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Previous session";

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function usableSets(sets: ProgressionCoachSet[]) {
  return sets.filter(
    (set) =>
      set.completed !== false &&
      finiteNumber(set.reps) > 0 &&
      finiteNumber(set.weight) >= 0
  );
}

function primaryWeight(sets: ProgressionCoachSet[]) {
  const weighted = sets.filter((set) => finiteNumber(set.weight) > 0);
  if (!weighted.length) return 0;

  const counts = new Map<number, number>();
  for (const set of weighted) {
    const weight = finiteNumber(set.weight);
    counts.set(weight, (counts.get(weight) ?? 0) + 1);
  }

  return (
    Array.from(counts.entries()).sort(
      (left, right) => right[1] - left[1] || right[0] - left[0]
    )[0]?.[0] ?? finiteNumber(weighted[0]?.weight)
  );
}

function buildRecommendation(params: {
  repMin: number;
  repMax: number;
  targetSets: number;
  currentSets: ProgressionCoachSet[];
  previousSession?: ProgressionCoachPreviousSession | null;
  increment: number;
}): ProgressionCoachRecommendation {
  const repMin = Math.max(1, Math.floor(params.repMin || 1));
  const repMax = Math.max(repMin, Math.floor(params.repMax || repMin));
  const targetSets = Math.max(1, Math.floor(params.targetSets || 1));
  const current = usableSets(params.currentSets);
  const previous = usableSets(params.previousSession?.sets ?? []);
  const increment = params.increment > 0 ? params.increment : 5;

  const latest = current[current.length - 1];

  if (latest) {
    const weight = finiteNumber(latest.weight);
    const reps = finiteNumber(latest.reps);
    const rir =
      latest.rir == null ? null : clamp(finiteNumber(latest.rir), 0, 10);
    const pain = clamp(finiteNumber(latest.pain), 0, 10);
    const form =
      latest.form == null ? null : clamp(finiteNumber(latest.form), 0, 10);

    if (pain >= 7) {
      return {
        decision: "stop",
        eyebrow: `SET ${latest.setIndex} REVIEW`,
        title: "Stop this movement",
        instruction:
          "Do not add another working set. End or replace the exercise and record what triggered the pain.",
        reason: `Pain reached ${pain}/10, which overrides load progression.`,
        target: "Continue only with a pain-free alternative at 0–2/10.",
        suggestedWeight: null,
        confidence: "HIGH",
      };
    }

    if (pain >= 4) {
      const reduced = weight > 0
        ? roundToIncrement(weight * 0.85, increment)
        : null;

      return {
        decision: "modify",
        eyebrow: `SET ${latest.setIndex} REVIEW`,
        title: "Reduce or modify",
        instruction: reduced
          ? `Use about ${formatWeight(reduced)} only if the movement becomes comfortable.`
          : "Reduce the difficulty or choose a pain-free variation.",
        reason: `Pain was ${pain}/10. Load progression is paused until symptoms settle.`,
        target: "Keep the next attempt at 0–2/10 pain with controlled form.",
        suggestedWeight: reduced,
        confidence: "HIGH",
      };
    }

    if (form != null && form <= 5) {
      const reduced = weight > 0
        ? roundToIncrement(weight * 0.9, increment)
        : null;

      return {
        decision: "reduce",
        eyebrow: `SET ${latest.setIndex} REVIEW`,
        title: "Protect form quality",
        instruction: reduced
          ? `Reduce to about ${formatWeight(reduced)} for the next set.`
          : "Reduce the challenge before the next set.",
        reason: `Form was logged at ${form}/10, below the progression standard.`,
        target: `${repMin}–${repMax} controlled reps with stable tempo and position.`,
        suggestedWeight: reduced,
        confidence: "HIGH",
      };
    }

    if (reps >= repMax && (rir == null || rir >= 2)) {
      const increased = weight > 0
        ? roundToIncrement(weight + increment, increment)
        : null;

      return {
        decision: "increase",
        eyebrow: `SET ${latest.setIndex} REVIEW`,
        title: "Progress earned",
        instruction: increased
          ? `Increase to ${formatWeight(increased)} for the next set.`
          : "Increase by the smallest safe increment.",
        reason:
          rir == null
            ? `You reached the top of the ${repMin}–${repMax} range with clean reps.`
            : `You reached ${reps} reps with ${rir} reps still in reserve.`,
        target: `Stay at or above ${repMin} clean reps after the increase.`,
        suggestedWeight: increased,
        confidence: current.length >= 2 ? "HIGH" : "MODERATE",
      };
    }

    if (reps < repMin || (rir != null && rir <= 0)) {
      const reduced = weight > 0
        ? roundToIncrement(weight * 0.9, increment)
        : null;

      return {
        decision: "reduce",
        eyebrow: `SET ${latest.setIndex} REVIEW`,
        title: "Load is above today’s target",
        instruction: reduced
          ? `Reduce to about ${formatWeight(reduced)} for the next set.`
          : "Reduce by the smallest practical amount.",
        reason:
          reps < repMin
            ? `${reps} reps fell below the programmed minimum of ${repMin}.`
            : "The set reached failure with no reps left in reserve.",
        target: `${repMin}–${repMax} reps with approximately 1–3 reps remaining.`,
        suggestedWeight: reduced,
        confidence: "HIGH",
      };
    }

    return {
      decision: "hold",
      eyebrow: `SET ${latest.setIndex} REVIEW`,
      title: "Keep the current load",
      instruction:
        weight > 0
          ? `Repeat ${formatWeight(weight)} for the next set.`
          : "Repeat the same setup for the next set.",
      reason: `${reps} reps landed inside the programmed ${repMin}–${repMax} range${
        rir == null ? "." : ` with ${rir} reps in reserve.`
      }`,
      target: `Add a clean rep when possible without losing form or increasing pain.`,
      suggestedWeight: weight > 0 ? weight : null,
      confidence: current.length >= 2 ? "HIGH" : "MODERATE",
    };
  }

  if (!previous.length) {
    return {
      decision: "baseline",
      eyebrow: "TODAY’S PLAN",
      title: "Establish a clean baseline",
      instruction:
        "Choose a controlled starting weight and complete the first set without chasing failure.",
      reason:
        "There is no completed performance for this exercise yet. Set 1 will calibrate the coach.",
      target: `${targetSets} sets of ${repMin}–${repMax} clean reps with 2–3 reps left in reserve.`,
      suggestedWeight: null,
      confidence: "BASELINE",
    };
  }

  const workingWeight = primaryWeight(previous);
  const totalReps = previous.reduce(
    (sum, set) => sum + finiteNumber(set.reps),
    0
  );
  const topRangeSets = previous.filter(
    (set) => finiteNumber(set.reps) >= repMax
  ).length;
  const pain = clamp(
    Math.max(
      finiteNumber(params.previousSession?.pain),
      ...previous.map((set) => finiteNumber(set.pain))
    ),
    0,
    10
  );
  const rirValues = previous
    .map((set) => set.rir)
    .filter((value): value is number => value != null)
    .map((value) => clamp(finiteNumber(value), 0, 10));
  const averageRir = rirValues.length
    ? rirValues.reduce((sum, value) => sum + value, 0) / rirValues.length
    : null;
  const difficulty = params.previousSession?.difficulty;

  if (pain >= 4 || difficulty === "too_hard") {
    const reduced = workingWeight > 0
      ? roundToIncrement(workingWeight * 0.9, increment)
      : null;

    return {
      decision: "reduce",
      eyebrow: "STARTING RECOMMENDATION",
      title: "Begin below the last load",
      instruction: reduced
        ? `Start near ${formatWeight(reduced)} and reassess after Set 1.`
        : "Begin conservatively and reassess after Set 1.",
      reason:
        pain >= 4
          ? `The previous session recorded pain ${pain}/10.`
          : "The previous session was marked Too Hard.",
      target: `${repMin}–${repMax} smooth reps with pain held at 0–2/10.`,
      suggestedWeight: reduced,
      confidence: "HIGH",
    };
  }

  if (
    previous.length >= targetSets &&
    topRangeSets === previous.length &&
    (averageRir == null || averageRir >= 1)
  ) {
    const increased = workingWeight > 0
      ? roundToIncrement(workingWeight + increment, increment)
      : null;

    return {
      decision: "increase",
      eyebrow: "STARTING RECOMMENDATION",
      title: "Open with a small progression",
      instruction: increased
        ? `Start at ${formatWeight(increased)}.`
        : "Add the smallest safe increment.",
      reason: `All ${previous.length} previous sets reached the top of the ${repMin}–${repMax} range.`,
      target: `Earn at least ${repMin} controlled reps on Set 1.`,
      suggestedWeight: increased,
      confidence: "HIGH",
    };
  }

  return {
    decision: "hold",
    eyebrow: "STARTING RECOMMENDATION",
    title: "Own the current load",
    instruction:
      workingWeight > 0
        ? `Start at ${formatWeight(workingWeight)}.`
        : "Repeat the previous setup.",
    reason: `${topRangeSets}/${previous.length} previous sets reached the top of the rep range.`,
    target: `Beat ${totalReps} total reps while keeping every set inside ${repMin}–${repMax}.`,
    suggestedWeight: workingWeight > 0 ? workingWeight : null,
    confidence: previous.length >= 2 ? "HIGH" : "MODERATE",
  };
}

function decisionLabel(decision: ProgressionCoachDecision) {
  switch (decision) {
    case "increase":
      return "INCREASE";
    case "hold":
      return "HOLD";
    case "reduce":
      return "REDUCE";
    case "modify":
      return "MODIFY";
    case "stop":
      return "STOP";
    default:
      return "BASELINE";
  }
}

export default function ProgressionCoach({
  exerciseId,
  exerciseName,
  repMin,
  repMax,
  targetSets,
  currentSets,
  previousSession,
  loading = false,
  disabled = false,
  weightIncrement = 5,
  onApplyWeight,
}: ProgressionCoachProps) {
  const storageKey = `${STORAGE_PREFIX}${exerciseId || exerciseName}`;
  const [open, setOpen] = useState(() => {
    if (typeof window === "undefined") return true;

    try {
      return window.localStorage.getItem(storageKey) !== "false";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, open ? "true" : "false");
    } catch {
      // Local persistence is optional.
    }
  }, [open, storageKey]);

  const recommendation = useMemo(
    () =>
      buildRecommendation({
        repMin,
        repMax,
        targetSets,
        currentSets,
        previousSession,
        increment: weightIncrement,
      }),
    [
      currentSets,
      previousSession,
      repMax,
      repMin,
      targetSets,
      weightIncrement,
    ]
  );

  const latestCompleted = usableSets(currentSets).at(-1);
  const previousSets = usableSets(previousSession?.sets ?? []);
  const canApply =
    !disabled &&
    recommendation.suggestedWeight != null &&
    recommendation.suggestedWeight > 0 &&
    typeof onApplyWeight === "function";

  return (
    <section
      className={`pc-coach is-${recommendation.decision} ${
        open ? "is-open" : "is-collapsed"
      }`}
      aria-label={`Adaptive progression coach for ${exerciseName}`}
    >
      <button
        type="button"
        className="pc-coachHeader"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="pc-coachIdentity">
          <span className="pc-coachIcon" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>

          <span className="pc-coachTitleGroup">
            <span className="pc-coachKicker">ADAPTIVE PROGRESSION COACH</span>
            <strong>{recommendation.title}</strong>
          </span>
        </span>

        <span className="pc-coachHeaderMeta">
          <span className={`pc-coachDecision is-${recommendation.decision}`}>
            {decisionLabel(recommendation.decision)}
          </span>
          <span className="pc-coachConfidence">
            {recommendation.confidence}
          </span>
          <span className="pc-coachToggle" aria-hidden="true">
            {open ? "−" : "+"}
          </span>
        </span>
      </button>

      {!open ? (
        <div className="pc-coachCollapsedLine">
          <strong>{recommendation.instruction}</strong>
          <span>{recommendation.target}</span>
        </div>
      ) : (
        <div className="pc-coachBody">
          {loading ? (
            <div className="pc-coachLoading" role="status">
              <span className="pc-coachLoadingPulse" />
              Reading exercise history and current-set performance…
            </div>
          ) : (
            <>
              <div className="pc-coachRecommendation">
                <div className="pc-coachRecommendationTop">
                  <span className="pc-coachKicker">
                    {recommendation.eyebrow}
                  </span>

                  {latestCompleted ? (
                    <span className="pc-coachSetStamp">
                      {formatWeight(latestCompleted.weight)} ×{" "}
                      {finiteNumber(latestCompleted.reps)} REPS
                    </span>
                  ) : null}
                </div>

                <strong className="pc-coachInstruction">
                  {recommendation.instruction}
                </strong>

                <div className="pc-coachReason">{recommendation.reason}</div>

                <div className="pc-coachTarget">
                  <span>TARGET</span>
                  <strong>{recommendation.target}</strong>
                </div>

                {canApply ? (
                  <button
                    type="button"
                    className="pc-coachApply"
                    onClick={() =>
                      onApplyWeight?.(
                        recommendation.suggestedWeight as number
                      )
                    }
                  >
                    APPLY {formatWeight(recommendation.suggestedWeight)}
                  </button>
                ) : null}
              </div>

              <div className="pc-coachEvidence">
                <div className="pc-coachEvidenceCard">
                  <span>LAST SESSION</span>
                  <strong>
                    {previousSets.length
                      ? `${formatWeight(primaryWeight(previousSets))} WORKING LOAD`
                      : "NO HISTORY"}
                  </strong>
                  <small>{formatDate(previousSession?.completedAt)}</small>
                </div>

                <div className="pc-coachEvidenceCard">
                  <span>PROGRAM TARGET</span>
                  <strong>
                    {targetSets} SETS · {repMin}–{repMax} REPS
                  </strong>
                  <small>
                    {previousSession?.workoutName?.trim() ||
                      "Current prescription"}
                  </small>
                </div>

                <div className="pc-coachEvidenceCard">
                  <span>PAIN CHECK</span>
                  <strong>
                    {latestCompleted?.pain != null
                      ? `${clamp(
                          finiteNumber(latestCompleted.pain),
                          0,
                          10
                        )}/10`
                      : previousSession?.pain != null
                        ? `${clamp(
                            finiteNumber(previousSession.pain),
                            0,
                            10
                          )}/10 LAST TIME`
                        : "CLEAR"}
                  </strong>
                  <small>Pain overrides progression</small>
                </div>
              </div>

              <div className="pc-coachDecisionRail" aria-label="Coach decision rules">
                <span className="is-increase">Top range + clean form</span>
                <span className="is-hold">Inside target range</span>
                <span className="is-reduce">Below range or failure</span>
                <span className="is-stop">High pain</span>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
