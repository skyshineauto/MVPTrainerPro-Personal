import { useEffect, useMemo, useRef } from "react";

export type ExerciseNavigatorItem = {
  id: string;
  name: string;
  completed: boolean;
  pain: number;
};

export function ExerciseNavigator({
  items,
  activeIndex,
  onSelect,
}: {
  items: ExerciseNavigatorItem[];
  activeIndex: number;
  onSelect: (index: number) => void;
}) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const doneCount = useMemo(
    () => items.filter((item) => item.completed).length,
    [items]
  );

  useEffect(() => {
    const activeButton = buttonRefs.current[activeIndex];
    activeButton?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [activeIndex]);

  return (
    <div className="tr-exerciseNavigator">
      <div className="tr-exerciseNavigatorHead">
        <div>
          <div className="tr-kicker">EXERCISE STATUS</div>
          <div className="tr-exerciseNavigatorSummary">
            {doneCount} of {items.length} complete
          </div>
        </div>

        <div className="tr-exerciseNavigatorLegend" aria-hidden>
          <span><i className="is-complete" /> Done</span>
          <span><i className="is-current" /> Current</span>
          <span><i className="is-upcoming" /> Remaining</span>
        </div>
      </div>

      <div className="tr-exerciseNavigatorRail" role="list" aria-label="Workout exercises">
        {items.map((item, index) => {
          const isCurrent = index === activeIndex;
          const hasPainWarning = !item.completed && item.pain > 0;
          const stateClass = item.completed
            ? "is-complete"
            : isCurrent
              ? "is-current"
              : hasPainWarning
                ? "is-warning"
                : "is-upcoming";

          return (
            <button
              key={item.id}
              ref={(element) => {
                buttonRefs.current[index] = element;
              }}
              type="button"
              role="listitem"
              className={`tr-exerciseNavigatorItem ${stateClass}`}
              aria-current={isCurrent ? "step" : undefined}
              onClick={() => onSelect(index)}
              title={item.name}
            >
              <span className="tr-exerciseNavigatorIcon" aria-hidden>
                {item.completed ? "✓" : hasPainWarning ? "!" : index + 1}
              </span>
              <span className="tr-exerciseNavigatorName">{item.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
