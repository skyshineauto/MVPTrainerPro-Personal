import { useEffect, useMemo, useState } from "react";
import "./BottomHudAdvanced.css";

type ProgressState = "upcoming" | "current" | "complete";

type DetailRow = {
  key: string;
  label: string;
  value: string;
};

type BottomHudAdvancedProps = {
  sessionComplete?: boolean;
  reviewingComplete?: boolean;
  doneCount: number;
  totalExercises: number;
  progressCells: ProgressState[];
  exerciseName: string;
  targetLabel: string;
  detailRows: DetailRow[];
  iconSrc?: string;
};

const STORAGE_KEY = "mvp_pro_session_hud_collapsed";

function isMobileViewport() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 760px)").matches
  );
}

function getInitialCollapsed() {
  if (typeof window === "undefined") return false;
  if (isMobileViewport()) return true;

  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export default function BottomHudAdvanced({
  sessionComplete = false,
  reviewingComplete = false,
  doneCount,
  totalExercises,
  progressCells,
  exerciseName,
  targetLabel,
  detailRows,
  iconSrc = "/dumbbell.png",
}: BottomHudAdvancedProps) {
  const [collapsed, setCollapsed] = useState(getInitialCollapsed);

  const safeTotal = Math.max(1, totalExercises || progressCells.length || 1);
  const calculatedDone = progressCells.filter(
    (state) => state === "complete"
  ).length;
  const safeDone = Math.max(
    0,
    Math.min(
      safeTotal,
      Number.isFinite(doneCount) ? Number(doneCount) : calculatedDone
    )
  );

  const currentIndex = useMemo(
    () => progressCells.findIndex((state) => state === "current"),
    [progressCells]
  );

  const nextRow = detailRows.find((row) => row.key === "next");
  const visibleDetails = detailRows.filter((row) => row.key !== "next");

  const stateLabel = sessionComplete
    ? "SESSION COMPLETE"
    : reviewingComplete
      ? "REVIEWING COMPLETED EXERCISE"
      : currentIndex >= 0
        ? `EXERCISE ${currentIndex + 1} OF ${safeTotal}`
        : `${safeDone} OF ${safeTotal} COMPLETE`;

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, collapsed ? "true" : "false");
    } catch {
      // Local persistence is optional.
    }
  }, [collapsed]);

  useEffect(() => {
    if (isMobileViewport()) setCollapsed(true);
  }, [exerciseName]);

  return (
    <section
      className={`bh-commandHud ${collapsed ? "is-collapsed" : "is-open"} ${
        sessionComplete ? "is-sessionComplete" : ""
      } ${reviewingComplete ? "is-reviewing" : ""}`}
      aria-label="Session progress"
    >
      <button
        type="button"
        className="bh-commandHudHeader"
        onClick={() => setCollapsed((value) => !value)}
        aria-expanded={!collapsed}
      >
        <span className="bh-commandHudHeaderText">
          <span className="bh-commandHudKicker">SESSION PROGRESS</span>
          <strong>{stateLabel}</strong>
        </span>

        <span className="bh-commandHudCount" aria-label={`${safeDone} of ${safeTotal} complete`}>
          <strong>{safeDone}</strong>
          <span>/ {safeTotal}</span>
        </span>

        <span className="bh-commandHudToggle" aria-hidden="true">
          {collapsed ? "+" : "−"}
        </span>
      </button>

      <div
        className="bh-commandHudRail"
        style={{ ["--bh-total" as string]: String(safeTotal) }}
        aria-label={`${safeDone} of ${safeTotal} exercises complete`}
      >
        {Array.from({ length: safeTotal }, (_, index) => {
          const state = progressCells[index] ?? "upcoming";
          const label =
            state === "complete"
              ? "Complete"
              : state === "current"
                ? "Current"
                : "Upcoming";

          return (
            <span
              key={index}
              className={`bh-commandHudRailSegment is-${state}`}
              title={`Exercise ${index + 1}: ${label}`}
            />
          );
        })}
      </div>

      {!collapsed ? (
        <div className="bh-commandHudBody">
          <div className="bh-commandHudExercise">
            <div className="bh-commandHudIcon" aria-hidden="true">
              <img src={iconSrc} alt="" />
            </div>

            <div className="bh-commandHudExerciseText">
              <span className="bh-commandHudKicker">
                {sessionComplete
                  ? "COMPLETED"
                  : reviewingComplete
                    ? "REVIEWING"
                    : "CURRENT EXERCISE"}
              </span>
              <strong>{exerciseName}</strong>
              <span className="bh-commandHudTarget">{targetLabel}</span>
            </div>
          </div>

          <div className="bh-commandHudMetrics">
            {visibleDetails.map((row) => (
              <div key={row.key} className={`bh-commandHudMetric is-${row.key}`}>
                <span>{row.label}</span>
                <strong>{row.value}</strong>
              </div>
            ))}
          </div>

          <div className="bh-commandHudNext">
            <span className="bh-commandHudKicker">
              {sessionComplete ? "STATUS" : "NEXT"}
            </span>
            <strong>
              {sessionComplete
                ? "ALL EXERCISES COMPLETE"
                : nextRow?.value && nextRow.value !== "End"
                  ? nextRow.value
                  : "FINAL EXERCISE"}
            </strong>
          </div>
        </div>
      ) : null}
    </section>
  );
}
