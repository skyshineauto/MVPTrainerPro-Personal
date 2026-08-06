import { useEffect, useMemo, useState } from "react";
import "./BottomHudAdvanced.css";

type ProgressState = "upcoming" | "current" | "complete";
type ExerciseMapState =
  | ProgressState
  | "skipped"
  | "modified"
  | "pain";

type DetailRow = {
  key: string;
  label: string;
  value: string;
};

export type SessionExerciseMapItem = {
  id?: string;
  name: string;
  state?: ExerciseMapState;
  target?: string;
  meta?: string;
  pain?: number;
  skipped?: boolean;
  modified?: boolean;
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
  exerciseItems?: SessionExerciseMapItem[];
  onSelectExercise?: (index: number) => void;
};

const STORAGE_KEY = "mvp_pro_session_map_collapsed";

function getInitialCollapsed() {
  if (typeof window === "undefined") return false;

  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function statusLabel(state: ExerciseMapState) {
  switch (state) {
    case "complete":
      return "COMPLETED";
    case "current":
      return "CURRENT";
    case "skipped":
      return "SKIPPED";
    case "modified":
      return "MODIFIED";
    case "pain":
      return "PAIN LOGGED";
    default:
      return "UPCOMING";
  }
}

function normalizeExerciseState(
  item: SessionExerciseMapItem | undefined,
  fallback: ProgressState
): ExerciseMapState {
  if (item?.skipped) return "skipped";
  if (item?.modified) return "modified";
  if (Number(item?.pain ?? 0) >= 4) return "pain";
  return item?.state ?? fallback;
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
  exerciseItems = [],
  onSelectExercise,
}: BottomHudAdvancedProps) {
  const [collapsed, setCollapsed] = useState(getInitialCollapsed);

  const safeTotal = Math.max(
    1,
    totalExercises || exerciseItems.length || progressCells.length || 1
  );

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

  const nextRow = detailRows.find((row) => row.key === "next");
  const visibleDetails = detailRows.filter((row) => row.key !== "next");

  const currentIndex = useMemo(() => {
    const explicitIndex = exerciseItems.findIndex(
      (item) => normalizeExerciseState(item, "upcoming") === "current"
    );

    if (explicitIndex >= 0) return explicitIndex;
    return progressCells.findIndex((state) => state === "current");
  }, [exerciseItems, progressCells]);

  const mapItems = useMemo<SessionExerciseMapItem[]>(() => {
    return Array.from({ length: safeTotal }, (_, index) => {
      const supplied = exerciseItems[index];
      const fallbackState = sessionComplete
        ? "complete"
        : progressCells[index] ?? "upcoming";
      const state = normalizeExerciseState(supplied, fallbackState);

      let fallbackName = `Exercise ${index + 1}`;

      if (index === currentIndex) {
        fallbackName = exerciseName || fallbackName;
      } else if (
        index === currentIndex + 1 &&
        nextRow?.value &&
        nextRow.value !== "End"
      ) {
        fallbackName = nextRow.value;
      }

      return {
        id: supplied?.id ?? String(index),
        name: supplied?.name?.trim() || fallbackName,
        state,
        target:
          supplied?.target ??
          (index === currentIndex ? targetLabel : undefined),
        meta: supplied?.meta,
        pain: supplied?.pain,
        skipped: supplied?.skipped,
        modified: supplied?.modified,
      };
    });
  }, [
    currentIndex,
    exerciseItems,
    exerciseName,
    nextRow?.value,
    progressCells,
    safeTotal,
    sessionComplete,
    targetLabel,
  ]);

  const currentMapItem =
    currentIndex >= 0 ? mapItems[currentIndex] : undefined;
  const nextMapItem =
    currentIndex >= 0 ? mapItems[currentIndex + 1] : undefined;

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

  return (
    <section
      className={`bh-sessionMap ${collapsed ? "is-collapsed" : "is-open"} ${
        sessionComplete ? "is-sessionComplete" : ""
      } ${reviewingComplete ? "is-reviewing" : ""}`}
      aria-label="Session exercise map"
    >
      <button
        type="button"
        className="bh-sessionMapHeader"
        onClick={() => setCollapsed((value) => !value)}
        aria-expanded={!collapsed}
      >
        <span className="bh-sessionMapHeaderCopy">
          <span className="bh-sessionMapKicker">SESSION EXERCISE MAP</span>
          <strong>{stateLabel}</strong>
        </span>

        <span
          className="bh-sessionMapCount"
          aria-label={`${safeDone} of ${safeTotal} complete`}
        >
          <strong>{safeDone}</strong>
          <span>/ {safeTotal}</span>
        </span>

        <span className="bh-sessionMapToggle" aria-hidden="true">
          {collapsed ? "+" : "−"}
        </span>
      </button>

      <div
        className="bh-sessionMapProgress"
        style={{ ["--bh-total" as string]: String(safeTotal) }}
        aria-label={`${safeDone} of ${safeTotal} exercises complete`}
      >
        {mapItems.map((item, index) => (
          <span
            key={item.id ?? index}
            className={`bh-sessionMapProgressSegment is-${item.state}`}
            title={`${index + 1}. ${item.name}: ${statusLabel(
              item.state ?? "upcoming"
            )}`}
          />
        ))}
      </div>

      {!collapsed ? (
        <div className="bh-sessionMapSummary">
          <div className="bh-sessionMapCurrent">
            <div className="bh-sessionMapIcon" aria-hidden="true">
              <img src={iconSrc} alt="" />
            </div>

            <div className="bh-sessionMapCurrentCopy">
              <span className="bh-sessionMapKicker">
                {sessionComplete
                  ? "SESSION STATUS"
                  : reviewingComplete
                    ? "REVIEWING"
                    : "CURRENT EXERCISE"}
              </span>

              <strong>
                {sessionComplete
                  ? "All exercises complete"
                  : currentMapItem?.name || exerciseName}
              </strong>

              {!sessionComplete ? (
                <span className="bh-sessionMapTarget">
                  {currentMapItem?.target || targetLabel}
                </span>
              ) : null}
            </div>
          </div>

          <div className="bh-sessionMapMetrics">
            {visibleDetails.map((row) => (
              <div
                key={row.key}
                className={`bh-sessionMapMetric is-${row.key}`}
              >
                <span>{row.label}</span>
                <strong>{row.value}</strong>
              </div>
            ))}
          </div>

          <div className="bh-sessionMapNext">
            <span className="bh-sessionMapKicker">
              {sessionComplete ? "STATUS" : "NEXT EXERCISE"}
            </span>
            <strong>
              {sessionComplete
                ? "WORKOUT ROADMAP COMPLETE"
                : nextMapItem?.name ||
                  (nextRow?.value && nextRow.value !== "End"
                    ? nextRow.value
                    : "FINAL EXERCISE")}
            </strong>
          </div>
        </div>
      ) : null}

      <div className="bh-sessionMapList" role="list">
        {mapItems.map((item, index) => {
          const state = item.state ?? "upcoming";
          const isInteractive = typeof onSelectExercise === "function";
          const content = (
            <>
              <span className="bh-sessionMapNumber" aria-hidden="true">
                {state === "complete" ? "✓" : index + 1}
              </span>

              <span className="bh-sessionMapItemCopy">
                <span className="bh-sessionMapItemTopline">
                  <strong>{item.name}</strong>
                  <span className={`bh-sessionMapBadge is-${state}`}>
                    {statusLabel(state)}
                  </span>
                </span>

                {(item.target || item.meta || Number(item.pain ?? 0) > 0) && (
                  <span className="bh-sessionMapItemMeta">
                    {item.target ? <span>{item.target}</span> : null}
                    {item.meta ? <span>{item.meta}</span> : null}
                    {Number(item.pain ?? 0) > 0 ? (
                      <span>PAIN {Number(item.pain)}</span>
                    ) : null}
                  </span>
                )}
              </span>

              <span className="bh-sessionMapItemMarker" aria-hidden="true" />
            </>
          );

          if (isInteractive) {
            return (
              <button
                key={item.id ?? index}
                type="button"
                role="listitem"
                className={`bh-sessionMapItem is-${state}`}
                onClick={() => onSelectExercise(index)}
                aria-current={state === "current" ? "step" : undefined}
                title={`Open ${item.name}`}
              >
                {content}
              </button>
            );
          }

          return (
            <div
              key={item.id ?? index}
              role="listitem"
              className={`bh-sessionMapItem is-${state}`}
              aria-current={state === "current" ? "step" : undefined}
            >
              {content}
            </div>
          );
        })}
      </div>
    </section>
  );
}
