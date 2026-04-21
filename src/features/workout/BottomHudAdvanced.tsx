import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import "./BottomHudAdvanced.css";

type ProgressState = "upcoming" | "current" | "complete";

type DetailRow = {
  key: string;
  label: string;
  value: string;
};

type BottomHudAdvancedProps = {
  sessionComplete?: boolean;
  doneCount: number;
  totalExercises: number;
  progressCells: ProgressState[];
  exerciseName: string;
  targetLabel: string;
  detailRows: DetailRow[];
  iconSrc?: string;
};

function useAutoFitText(
  text: string,
  target: string,
  minPx: number,
  maxPx: number
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const targetRef = useRef<HTMLSpanElement | null>(null);
  const [fontSize, setFontSize] = useState(maxPx);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const targetEl = targetRef.current;
    if (!container || !targetEl) return;

    let raf = 0;

    const fit = () => {
      const containerWidth = container.clientWidth;
      const targetWidth = targetEl.offsetWidth;
      const available = Math.max(260, containerWidth - targetWidth - 8);

      const tester = document.createElement("span");
      tester.style.position = "absolute";
      tester.style.visibility = "hidden";
      tester.style.whiteSpace = "nowrap";
      tester.style.fontFamily =
        "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
      tester.style.fontWeight = "900";
      tester.style.letterSpacing = "-0.06em";
      tester.style.lineHeight = "0.96";
      tester.textContent = text;
      document.body.appendChild(tester);

      let nextSize = maxPx;
      for (let px = maxPx; px >= minPx; px -= 1) {
        tester.style.fontSize = `${px}px`;
        if (tester.offsetWidth <= available) {
          nextSize = px;
          break;
        }
      }

      document.body.removeChild(tester);
      setFontSize(nextSize);
    };

    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(fit);
    };

    schedule();

    const ro = new ResizeObserver(schedule);
    ro.observe(container);
    ro.observe(targetEl);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [text, target, minPx, maxPx]);

  return { containerRef, targetRef, fontSize };
}

function ProgressGauge({ cells }: { cells: ProgressState[] }) {
  const total = Math.max(1, cells.length);
  const completeCount = cells.filter((state) => state === "complete").length;
  const currentIndex = cells.findIndex((state) => state === "current");
  const hasCurrent = currentIndex >= 0;

  const segmentWidth = 100 / total;
  const completePct = Math.max(0, Math.min(100, completeCount * segmentWidth));
  const currentLeftPct = hasCurrent
    ? Math.max(0, Math.min(100 - segmentWidth, currentIndex * segmentWidth))
    : Math.max(0, Math.min(100 - segmentWidth, completePct - segmentWidth));

  return (
    <div
      className="bh-progressRail"
      style={{ ["--segments" as string]: String(total) }}
      aria-hidden
    >
      <div className="bh-gaugeTrack">
        <div className="bh-gaugeAnchor">
          <span
            className="bh-gaugeAnchorEmoji"
            role="img"
            aria-label="progress anchor"
          >
            ⭐
          </span>
        </div>

        <div
          className={`bh-gaugeLane ${hasCurrent ? "is-active" : ""}`}
          style={
            {
              ["--segment-width" as string]: `${segmentWidth}%`,
              ["--complete-width" as string]: `${completePct}%`,
              ["--current-left" as string]: `${currentLeftPct}%`,
            } as React.CSSProperties
          }
        >
          <div className="bh-gaugeCompleteFill" />
          {hasCurrent ? <div className="bh-gaugeCurrentMeter" /> : null}

          <div className="bh-gaugeSegments">
            {cells.map((state, idx) => (
              <div
                key={idx}
                className={`bh-gseg bh-gseg--${state}`}
                style={{ ["--i" as string]: String(idx) }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function BottomHudAdvanced({
  totalExercises,
  progressCells,
  exerciseName,
  targetLabel,
  detailRows,
  iconSrc = "/dumbbell.png",
}: BottomHudAdvancedProps) {
  const safeCells = useMemo<ProgressState[]>(
    () => (progressCells.length ? progressCells : ["upcoming"]),
    [progressCells]
  );

  const visualDoneCount = useMemo(
    () => safeCells.filter((cell) => cell === "complete").length,
    [safeCells]
  );

  const visualTotal = useMemo(
    () => Math.max(safeCells.length, totalExercises || 0),
    [safeCells.length, totalExercises]
  );

  const { containerRef, targetRef, fontSize } = useAutoFitText(
    exerciseName,
    targetLabel,
    18,
    58
  );

  return (
    <div className="bh-root">
      <div className="bh-scene">
        <div className="bh-shell">
          <div className="bh-frameMetal" />
          <div className="bh-frameNeon" />
          <div className="bh-topLine" />
          <div className="bh-topFlare bh-topFlare--left" />
          <div className="bh-topFlare bh-topFlare--center" />
          <div className="bh-topFlare bh-topFlare--right" />

          <div className="bh-sideEmitter bh-sideEmitter--left" />
          <div className="bh-sideEmitter bh-sideEmitter--right" />

          <div className="bh-cornerGlow bh-cornerGlow--tl" />
          <div className="bh-cornerGlow bh-cornerGlow--tr" />
          <div className="bh-cornerGlow bh-cornerGlow--bl" />
          <div className="bh-cornerGlow bh-cornerGlow--br" />

          <div className="bh-grid">
            <div className="bh-left">
              <div className="bh-progressModule">
                <div className="bh-title bh-title--blue">SESSION PROGRESS</div>
                <div className="bh-streak bh-streak--blue" />

                <ProgressGauge cells={safeCells} />

                <div className="bh-completed">
                  Completed {visualDoneCount} / {visualTotal}
                </div>
              </div>

              <div className="bh-plaque">
                <div className="bh-plaqueTopSheen" />
                <div className="bh-plaqueGlass" />
                <div className="bh-plaqueHotspot" />

                <div className="bh-iconWrap">
                  <img src={iconSrc} alt="Exercise icon" className="bh-icon" />
                </div>

                <div className="bh-plaqueCopy">
                  <div className="bh-plaqueLabel">Current Exercise:</div>

                  <div className="bh-plaqueMain" ref={containerRef}>
                    <span
                      className="bh-plaqueName"
                      style={{ fontSize: `${fontSize}px` }}
                      title={exerciseName}
                    >
                      {exerciseName}
                    </span>

                    <span ref={targetRef} className="bh-plaqueTargetPill">
                      {targetLabel}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="bh-right">
              <div className="bh-cardTopSheen" />
              <div className="bh-cardHotspot" />

              <div className="bh-title bh-title--green bh-panelTitle">
                EXERCISE DETAILS
              </div>
              <div className="bh-streak bh-streak--green" />

              <div className="bh-panelRows">
                {detailRows.map((row) => (
                  <div key={row.key} className="bh-panelRow">
                    <div className="bh-panelLabel">{row.label}:</div>
                    <div
                      className={`bh-panelValue ${
                        row.key === "next" ? "is-next" : ""
                      }`}
                    >
                      {row.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="bh-floor" aria-hidden>
          <div className="bh-floorPlane" />
        </div>
      </div>
    </div>
  );
}