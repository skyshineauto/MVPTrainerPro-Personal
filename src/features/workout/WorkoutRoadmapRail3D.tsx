import { useMemo, type CSSProperties } from "react";

export type WorkoutRoadmapRailState = "current" | "next" | "done" | "remaining";

export type WorkoutRoadmapRailItem = {
  id: string;
  name: string;
  accent: string;
  state: WorkoutRoadmapRailState;
};

type WorkoutRoadmapRail3DProps = {
  items: WorkoutRoadmapRailItem[];
  activeIndex: number;
  completedCount: number;
  onSelect: (index: number) => void;
};

type RailPoint = WorkoutRoadmapRailItem & {
  x: number;
  index: number;
};

const VIEW_W = 1200;
const VIEW_H = 150;
const START_X = 104;
const END_X = 1096;
const CENTER_Y = 77;

function statePower(state: WorkoutRoadmapRailState) {
  if (state === "current") return 1;
  if (state === "next") return 0.72;
  if (state === "done") return 0.60;
  return 0.34;
}

function sanitizeId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "");
}

export function WorkoutRoadmapRail3D({
  items,
  activeIndex,
  completedCount,
  onSelect,
}: WorkoutRoadmapRail3DProps) {
  const points = useMemo<RailPoint[]>(() => {
    if (!items.length) return [];
    if (items.length === 1) return [{ ...items[0], x: VIEW_W / 2, index: 0 }];
    const step = (END_X - START_X) / (items.length - 1);
    return items.map((item, index) => ({ ...item, x: START_X + step * index, index }));
  }, [items]);

  if (!points.length) return null;

  return (
    <div
      className="tr-roadmapRail3D tr-roadmapRailPremium"
      role="navigation"
      aria-label={`Workout exercise status rail. ${completedCount} of ${items.length} completed.`}
      style={{ "--tr-roadmap-rail-count": items.length } as CSSProperties}
      data-active-index={activeIndex}
    >
      <svg
        className="tr-roadmapRailPremiumSvg"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="rm8Chassis" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#34434c" />
            <stop offset="0.12" stopColor="#1a242b" />
            <stop offset="0.48" stopColor="#070c10" />
            <stop offset="0.72" stopColor="#11191f" />
            <stop offset="1" stopColor="#020507" />
          </linearGradient>
          <linearGradient id="rm8Crown" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#71838b" stopOpacity="0.45" />
            <stop offset="0.16" stopColor="#25333a" stopOpacity="0.76" />
            <stop offset="0.60" stopColor="#081015" stopOpacity="0.96" />
            <stop offset="1" stopColor="#020608" stopOpacity="0.99" />
          </linearGradient>
          <linearGradient id="rm8Channel" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#c4d8df" stopOpacity="0.19" />
            <stop offset="0.18" stopColor="#273940" stopOpacity="0.72" />
            <stop offset="0.52" stopColor="#020608" />
            <stop offset="0.82" stopColor="#18262d" stopOpacity="0.72" />
            <stop offset="1" stopColor="#000203" />
          </linearGradient>
          <linearGradient id="rm8MetalEdge" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#82959d" stopOpacity="0.05" />
            <stop offset="0.22" stopColor="#e1eef2" stopOpacity="0.44" />
            <stop offset="0.50" stopColor="#ffffff" stopOpacity="0.12" />
            <stop offset="0.78" stopColor="#d2e3e8" stopOpacity="0.34" />
            <stop offset="1" stopColor="#71858e" stopOpacity="0.04" />
          </linearGradient>
          <linearGradient id="rm9NodeRim" x1="0" y1="0" x2="0.82" y2="1">
            <stop offset="0" stopColor="#f0f8fa" stopOpacity="0.50" />
            <stop offset="0.18" stopColor="#8fa5ae" stopOpacity="0.30" />
            <stop offset="0.48" stopColor="#172229" stopOpacity="0.72" />
            <stop offset="0.78" stopColor="#8aa0a9" stopOpacity="0.22" />
            <stop offset="1" stopColor="#020507" stopOpacity="0.90" />
          </linearGradient>
          <linearGradient id="rm9TopSheen" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="0.18" stopColor="#eff9fb" stopOpacity="0.14" />
            <stop offset="0.46" stopColor="#ffffff" stopOpacity="0.28" />
            <stop offset="0.72" stopColor="#d8edf2" stopOpacity="0.10" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="rm8Glass" cx="38%" cy="28%" r="72%">
            <stop offset="0" stopColor="#d9edf3" stopOpacity="0.26" />
            <stop offset="0.18" stopColor="#253a44" stopOpacity="0.72" />
            <stop offset="0.48" stopColor="#071116" stopOpacity="0.96" />
            <stop offset="1" stopColor="#010305" />
          </radialGradient>
          <filter id="rm8Shadow" x="-20%" y="-90%" width="140%" height="280%">
            <feGaussianBlur stdDeviation="8" />
          </filter>
          <filter id="rm8SoftGlow" x="-180%" y="-180%" width="460%" height="460%">
            <feGaussianBlur stdDeviation="7" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="rm8TightGlow" x="-120%" y="-120%" width="340%" height="340%">
            <feGaussianBlur stdDeviation="2.7" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {points.map((point) => {
            const id = sanitizeId(`${point.id}-${point.index}`);
            return (
              <radialGradient key={id} id={`rm8Accent-${id}`} cx="36%" cy="28%" r="72%">
                <stop offset="0" stopColor="#ffffff" stopOpacity={point.state === "current" ? 0.96 : 0.62} />
                <stop offset="0.16" stopColor={point.accent} stopOpacity={statePower(point.state)} />
                <stop offset="0.54" stopColor={point.accent} stopOpacity={statePower(point.state) * 0.58} />
                <stop offset="1" stopColor="#020609" stopOpacity="0.98" />
              </radialGradient>
            );
          })}
        </defs>

        <ellipse cx="600" cy="118" rx="545" ry="17" fill="#000000" opacity="0.54" filter="url(#rm8Shadow)" />

        <path
          d="M50 53 Q70 38 104 38 H1096 Q1130 38 1150 53 L1172 67 Q1182 74 1172 84 L1150 98 Q1130 113 1096 113 H104 Q70 113 50 98 L28 84 Q18 74 28 67 Z"
          fill="url(#rm8Chassis)"
          stroke="#7f959e"
          strokeOpacity="0.30"
          strokeWidth="2"
        />
        <path
          d="M64 58 Q82 47 108 47 H1092 Q1118 47 1136 58 L1152 69 Q1159 75 1152 81 L1136 92 Q1118 103 1092 103 H108 Q82 103 64 92 L48 81 Q41 75 48 69 Z"
          fill="url(#rm8Crown)"
          stroke="url(#rm8MetalEdge)"
          strokeWidth="2.2"
        />
        <path
          d="M74 55 Q91 46 116 46 H1084 Q1109 46 1126 55"
          fill="none"
          stroke="url(#rm9TopSheen)"
          strokeWidth="2.6"
          strokeLinecap="round"
          opacity="0.92"
        />
        <path
          d="M75 96 Q93 105 116 105 H1084 Q1107 105 1125 96"
          fill="none"
          stroke="#000000"
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.62"
        />

        <rect x="79" y="65" width="1042" height="24" rx="12" fill="#010407" opacity="0.92" />
        <rect x="88" y="68" width="1024" height="18" rx="9" fill="url(#rm8Channel)" stroke="#8ba3ad" strokeOpacity="0.13" />
        <path d="M96 69.5 H1104" stroke="#d6e7ec" strokeOpacity="0.15" strokeWidth="1.5" />
        <path d="M96 86 H1104" stroke="#000000" strokeOpacity="0.90" strokeWidth="2.4" />

        {points.slice(0, -1).map((point, index) => {
          const next = points[index + 1];
          const mid = (point.x + next.x) / 2;
          const start = index === 0 ? 88 : (points[index - 1]?.x + point.x) / 2;
          const end = index === points.length - 2 ? 1112 : mid;
          const width = Math.max(0, end - start);
          const opacity = point.state === "current" ? 0.56 : point.state === "done" ? 0.28 : point.state === "next" ? 0.34 : 0.17;
          return (
            <g key={`segment-${point.id}`}>
              <rect x={start} y="74" width={width} height="5" rx="2.5" fill={point.accent} opacity={opacity * 0.24} filter="url(#rm8SoftGlow)" />
              <rect x={start} y="75.5" width={width} height="2" rx="1" fill={point.accent} opacity={opacity} />
              <rect x={mid - 2} y="66" width="4" height="22" rx="2" fill="#020507" stroke="#6d7d84" strokeOpacity="0.22" />
            </g>
          );
        })}

        {points.map((point) => {
          const id = sanitizeId(`${point.id}-${point.index}`);
          const power = statePower(point.state);
          const current = point.state === "current";
          const next = point.state === "next";
          const done = point.state === "done";
          const outerR = current ? 39 : next ? 36 : 34;
          const accentR = current ? 25 : next ? 22 : 19;
          return (
            <g key={point.id} className={`tr-roadmapRailPremiumNode is-${point.state}`}>
              <circle cx={point.x} cy={CENTER_Y + 5} r={outerR + 8} fill="#000" opacity="0.34" filter="url(#rm8Shadow)" />
              <circle cx={point.x} cy={CENTER_Y} r={outerR + 1.5} fill="#030608" stroke="url(#rm9NodeRim)" strokeOpacity={current ? 0.86 : next ? 0.68 : 0.48} strokeWidth="2.5" />
              <circle cx={point.x} cy={CENTER_Y} r={outerR} fill="url(#rm8Chassis)" stroke="#8ba2ab" strokeOpacity="0.28" strokeWidth="1.4" />
              <circle cx={point.x} cy={CENTER_Y} r={outerR - 6} fill="#020507" stroke="#d4e5ea" strokeOpacity={current ? 0.22 : 0.13} strokeWidth="1.6" />
              <circle cx={point.x} cy={CENTER_Y} r={accentR + 7} fill="url(#rm8Glass)" stroke={point.accent} strokeOpacity={0.18 + power * 0.36} strokeWidth="2" />
              <circle
                cx={point.x}
                cy={CENTER_Y}
                r={accentR}
                fill={`url(#rm8Accent-${id})`}
                opacity={0.50 + power * 0.45}
                filter={current || next ? "url(#rm8SoftGlow)" : undefined}
                className={current ? "tr-roadmapRailPremiumCore is-current" : undefined}
              />
              <circle cx={point.x - accentR * 0.27} cy={CENTER_Y - accentR * 0.33} r={Math.max(2.5, accentR * 0.13)} fill="#ffffff" opacity={current ? 0.70 : 0.28} />
              <path
                d={`M ${point.x - outerR * 0.72} ${CENTER_Y - outerR * 0.72} A ${outerR} ${outerR} 0 0 1 ${point.x + outerR * 0.54} ${CENTER_Y - outerR * 0.82}`}
                fill="none"
                stroke="#e8f3f6"
                strokeOpacity={current ? 0.38 : 0.17}
                strokeWidth="2"
                strokeLinecap="round"
              />
              <path
                d={`M ${point.x - outerR * 0.54} ${CENTER_Y + outerR * 0.78} A ${outerR} ${outerR} 0 0 0 ${point.x + outerR * 0.56} ${CENTER_Y + outerR * 0.76}`}
                fill="none"
                stroke="#000000"
                strokeOpacity="0.68"
                strokeWidth="2.4"
                strokeLinecap="round"
              />
              {done ? (
                <g transform={`translate(${point.x} ${CENTER_Y})`} filter="url(#rm8TightGlow)">
                  <circle r="15" fill="#0b261a" stroke="#70e2a6" strokeWidth="2" />
                  <path d="M-7 0 L-2 6 L8 -7" fill="none" stroke="#9cf1c1" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
                </g>
              ) : null}
            </g>
          );
        })}

        <path d="M74 46 H1126" stroke="#f1f7f9" strokeOpacity="0.08" strokeWidth="1.4" />
        <path d="M84 103 H1116" stroke="#000000" strokeOpacity="0.78" strokeWidth="2" />
      </svg>

      <div className="tr-roadmapRail3DHitGrid">
        {points.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className="tr-roadmapRail3DHit"
            onClick={() => onSelect(index)}
            aria-current={index === activeIndex ? "step" : undefined}
            aria-label={`${item.name}. ${item.state}. Go to exercise.`}
            title={`${item.name} • ${item.state.toUpperCase()}`}
          />
        ))}
      </div>
    </div>
  );
}
