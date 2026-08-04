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

function initialCollapsed() {
  if (typeof window === "undefined") return false;
  try {
    const saved = window.localStorage.getItem("mvp_session_hud_collapsed");
    if (saved != null) return saved === "true";
  } catch {
    // Persistence is optional.
  }
  return window.matchMedia("(max-width: 720px)").matches;
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
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        "mvp_session_hud_collapsed",
        collapsed ? "true" : "false"
      );
    } catch {
      // Persistence is optional.
    }
  }, [collapsed]);

  const safeTotal = Math.max(1, totalExercises || progressCells.length || 1);
  const safeDone = Math.max(
    0,
    Math.min(
      safeTotal,
      Number.isFinite(doneCount)
        ? doneCount
        : progressCells.filter((state) => state === "complete").length
    )
  );

  const currentIndex = useMemo(
    () => progressCells.findIndex((state) => state === "current"),
    [progressCells]
  );

  const nextRow = detailRows.find((row) => row.key === "next");
  const compactState = sessionComplete
    ? "SESSION COMPLETE"
    : reviewingComplete
    ? "REVIEWING COMPLETED EXERCISE"
    : currentIndex >= 0
    ? `EXERCISE ${currentIndex + 1} OF ${safeTotal}`
    : `${safeDone} OF ${safeTotal} COMPLETE`;

  return (
    <section
      className={`bh-proHud ${collapsed ? "is-collapsed" : "is-open"} ${
        sessionComplete ? "is-complete" : ""
      }`}
      aria-label="Session progress"
    >
      <button
        type="button"
        className="bh-proHudHeader"
        onClick={() => setCollapsed((value) => !value)}
        aria-expanded={!collapsed}
      >
        <span className="bh-proHudHeaderCopy">
          <span className="bh-proHudEyebrow">SESSION PROGRESS</span>
          <strong>{compactState}</strong>
        </span>

        <span className="bh-proHudHeaderCount">
          <span>{safeDone}</span>
          <small>/ {safeTotal}</small>
        </span>

        <span className="bh-proHudChevron" aria-hidden>
          {collapsed ? "＋" : "−"}
        </span>
      </button>

      <div
        className="bh-proHudSegments"
        style={{ ["--bh-segments" as string]: String(safeTotal) }}
        aria-label={`${safeDone} of ${safeTotal} complete`}
      >
        {Array.from({ length: safeTotal }, (_, index) => {
          const state = progressCells[index] ?? "upcoming";
          return (
            <span
              key={index}
              className={`bh-proHudSegment is-${state}`}
              title={`Exercise ${index + 1}: ${state}`}
            />
          );
        })}
      </div>

      {!collapsed ? (
        <div className="bh-proHudBody">
          <div className="bh-proHudCurrent">
            <div className="bh-proHudIcon">
              <img src={iconSrc} alt="" />
            </div>

            <div className="bh-proHudCurrentCopy">
              <span className="bh-proHudEyebrow">
                {sessionComplete
                  ? "COMPLETED"
                  : reviewingComplete
                  ? "REVIEWING"
                  : "CURRENT EXERCISE"}
              </span>
              <strong>{exerciseName}</strong>
              <span className="bh-proHudTarget">{targetLabel}</span>
            </div>
          </div>

          <div className="bh-proHudDetails">
            {detailRows.map((row) => (
              <div key={row.key} className={`bh-proHudDetail is-${row.key}`}>
                <span>{row.label}</span>
                <strong>{row.value}</strong>
              </div>
            ))}
          </div>

          <div className="bh-proHudFooter">
            <span>
              {nextRow?.value && nextRow.value !== "End"
                ? `NEXT: ${nextRow.value}`
                : sessionComplete
                ? "ALL EXERCISES COMPLETE"
                : "FINAL EXERCISE"}
            </span>
            <span>{safeDone} COMPLETE</span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
