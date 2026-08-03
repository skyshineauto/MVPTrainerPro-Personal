// src/features/progress/ProgressPage.tsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { Card } from "../../ui/Card";
import { Button } from "../../ui/Button";
import { Chip } from "../../ui/Chip";

/** ===== PNG ICONS (put files in: src/assets/progress-icons/) ===== */
import icoSchedule from "../../assets/progress-icons/schedule.png";
import icoChecked from "../../assets/progress-icons/checked.png";
import icoRate from "../../assets/progress-icons/rate.png";
import icoFlames from "../../assets/progress-icons/flames.png";
import icoInProcess from "../../assets/progress-icons/in-process.png";
import icoWorkout from "../../assets/progress-icons/workout.png";
import icoReport from "../../assets/progress-icons/report.png";

import icoFlag from "../../assets/progress-icons/flag.png";
import icoPain from "../../assets/progress-icons/pain.png";
import icoWarning from "../../assets/progress-icons/warning.png";

import icoTarget from "../../assets/progress-icons/target.png";
import icoScale from "../../assets/progress-icons/bathroom-scale.png";
import icoProtein from "../../assets/progress-icons/protein-shake.png";

type Scope = "active" | "all";
type Range = 7 | 14 | 30 | 90 | "all";
type Tab = "protein" | "weight" | "volume" | "pain";

type HistorySetRow = {
  set_index: number;
  reps: number;
  weight: number;
  rir: number | null;
  pain: number | null;
  form: number | null;
};

type HistoryExerciseRow = {
  workout_exercise_id: string;
  exercise_id: string;
  name: string;
  order_index: number;
  prescription_snapshot: any;
  pain: number | null;
  difficulty: string | null;
  sets: HistorySetRow[];
};

type HistoryRow = {
  id: string;
  completed_at: string;
  template_name: string;
  session_seconds: number;
  bodyweight_lb: number | null;
  protein_target_g: number | null;
  pain_max: number;
  pain_avg: number;
  volume_total: number;
  post_difficulty: string | null;
  session_rating: number | null;
  post_notes: string | null;
  notes: string | null;
  workout_summary: any | null;
  exercises: HistoryExerciseRow[];
};

function daysAgoISO(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}
function dateOnly(d: Date) {
  return d.toISOString().slice(0, 10);
}
function fmtMDYTime(ts: any) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  const date = d.toLocaleDateString(undefined, {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date} • ${time}`;
}
function fmtHMS(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${String(h).padStart(2, "0")}h ${String(m).padStart(
    2,
    "0"
  )}m ${String(ss).padStart(2, "0")}s`;
}
function rangeLabel(range: Range) {
  return range === "all" ? "ALL TIME" : `${range}D`;
}
function rangeStartISO(range: Range) {
  return range === "all" ? null : daysAgoISO(range);
}
function fmtDecimal(value: number, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : "0.0";
}
function proteinMultiplier(goal: string | null | undefined) {
  const g = (goal || "").toLowerCase();
  if (g === "cut" || g === "lose_weight") return 1.0;
  return 0.9;
}
function roundProtein(g: number) {
  return Math.round(g / 5) * 5;
}
function difficultyLabel(d?: string | null, legacyRating?: number | null) {
  if (d === "too_easy") return "Too easy";
  if (d === "just_right") return "Just right";
  if (d === "too_hard") return "Too hard";
  if (legacyRating === 1) return "Too easy";
  if (legacyRating === 2) return "Just right";
  if (legacyRating === 3) return "Too hard";
  return null;
}

function HudIcon({
  src,
  alt,
  size = 18,
  tone = "blue",
}: {
  src: string;
  alt: string;
  size?: number;
  tone?: "blue" | "green" | "orange" | "red" | "base";
}) {
  return (
    <span
      className={`tr-icocap ${size >= 22 ? "is-big" : ""} tone-${tone}`}
      aria-hidden
      title={alt}
    >
      <img src={src} alt={alt} style={{ width: size, height: size }} />
    </span>
  );
}

function MetricLabel({
  icon,
  text,
  tone,
}: {
  icon: string;
  text: string;
  tone?: any;
}) {
  return (
    <div className="tr-metricLabel">
      <HudIcon src={icon} alt="" size={18} tone={tone} />
      <span>{text}</span>
    </div>
  );
}

function MetricValue({ value }: { value: React.ReactNode }) {
  return (
    <div className="tr-metricValue">
      <span className="tr-metricNum">{value}</span>
    </div>
  );
}

function KpiTile({
  icon,
  label,
  value,
  sub,
  tone = "base",
  hero = false,
}: {
  icon: string;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "base" | "blue" | "green" | "orange" | "red";
  hero?: boolean;
}) {
  return (
    <div className={`tr-kpiTile tone-${tone} ${hero ? "is-hero" : ""}`}>
      <MetricLabel icon={icon} text={label} tone={tone} />
      <MetricValue value={value} />
      {sub != null ? <div className="tr-sub tr-kpiSub">{sub}</div> : null}
    </div>
  );
}

export function ProgressPage() {
  const [scope, setScope] = useState<Scope>("active");
  const [range, setRange] = useState<Range>(14);
  const [tab, setTab] = useState<Tab>("protein");

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [goal, setGoal] = useState<string | null>(null);

  const [completedCount, setCompletedCount] = useState(0);
  const [completionRate, setCompletionRate] = useState<number | null>(null);
  const [streakDays, setStreakDays] = useState(0);

  const [totalTimeSeconds, setTotalTimeSeconds] = useState(0);
  const [avgDurationSeconds, setAvgDurationSeconds] = useState(0);
  const [setsLogged, setSetsLogged] = useState(0);

  const [periodSpanDays, setPeriodSpanDays] = useState(14);

  const [painFlags7d, setPainFlags7d] = useState(0);
  const [painAvgRange, setPainAvgRange] = useState<number | null>(null);
  const [painMaxRange, setPainMaxRange] = useState<number | null>(null);

  const [latestBW, setLatestBW] = useState<number | null>(null);
  const [bwChange, setBwChange] = useState<number | null>(null);
  const [volumeTotal, setVolumeTotal] = useState<number | null>(null);
  const [painRows, setPainRows] = useState<
    Array<{ name: string; avg: number; max: number; count: number }>
  >([]);

  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [expandedHistoryIds, setExpandedHistoryIds] = useState<Record<string, boolean>>({});

  const [clearOpen, setClearOpen] = useState(false);
  const [clearText, setClearText] = useState("");
  const [clearBusy, setClearBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  async function loadAll() {
    setLoading(true);
    setErr(null);

    try {
      const { data: u, error: uErr } = await supabase.auth.getUser();
      if (uErr) throw uErr;
      if (!u.user) {
        setErr("Sign in to view progress.");
        setLoading(false);
        return;
      }

      const { data: ab } = await supabase
        .from("program_blocks")
        .select("*")
        .eq("user_id", u.user.id)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      setGoal((ab?.goal as string) ?? null);

      const fromISO = rangeStartISO(range);
      const from7ISO = daysAgoISO(7);

      let activeSessionIds: string[] | null = null;
      if (scope === "active" && ab?.id) {
        const { data: ss, error: ssErr } = await supabase
          .from("scheduled_sessions")
          .select("id")
          .eq("user_id", u.user.id)
          .eq("program_block_id", ab.id);
        if (ssErr) throw ssErr;
        activeSessionIds = (ss ?? []).map((x: any) => x.id).filter(Boolean);

        if (activeSessionIds.length === 0) {
          setCompletedCount(0);
          setCompletionRate(0);
          setStreakDays(0);
          setTotalTimeSeconds(0);
          setAvgDurationSeconds(0);
          setSetsLogged(0);
          setPeriodSpanDays(range === "all" ? 7 : range);
          setPainFlags7d(0);
          setPainAvgRange(null);
          setPainMaxRange(null);
          setLatestBW(null);
          setBwChange(null);
          setVolumeTotal(0);
          setPainRows([]);
          setHistory([]);
          setLoading(false);
          return;
        }
      }


      let wQuery = supabase
        .from("workouts")
        .select(
          "id, scheduled_session_id, started_at, ended_at, completed_at, bodyweight_lb, active_seconds, protein_target_g, workout_summary, post_difficulty, post_notes, session_rating, notes"
        )
        .eq("user_id", u.user.id)
        .not("completed_at", "is", null)
        .order("completed_at", { ascending: false });

      if (fromISO) {
        wQuery = wQuery.gte("completed_at", fromISO);
      }

      if (scope === "active" && activeSessionIds) {
        wQuery = wQuery.in("scheduled_session_id", activeSessionIds);
      }

      const { data: workouts, error: wErr } = await wQuery;
      if (wErr) throw wErr;

      const wRows = workouts ?? [];
      const wIds = wRows.map((w: any) => w.id);

      setCompletedCount(wRows.length);

      if (range === "all") {
        const completedTimes = wRows
          .map((row: any) => new Date(row.completed_at).getTime())
          .filter((value: number) => Number.isFinite(value));
        if (completedTimes.length >= 2) {
          const minTime = Math.min(...completedTimes);
          const maxTime = Math.max(...completedTimes);
          setPeriodSpanDays(Math.max(7, Math.ceil((maxTime - minTime) / 86400000) + 1));
        } else {
          setPeriodSpanDays(7);
        }
      } else {
        setPeriodSpanDays(range);
      }

      if (scope === "active" && ab?.id) {
        let schedQuery = supabase
          .from("scheduled_sessions")
          .select("id, date")
          .eq("user_id", u.user.id)
          .eq("program_block_id", ab.id)
          .lte("date", dateOnly(new Date()));

        if (range !== "all") {
          const startDate = dateOnly(new Date(Date.now() - range * 86400000));
          schedQuery = schedQuery.gte("date", startDate);
        }

        const { data: sched, error: schedErr } = await schedQuery;
        if (schedErr) throw schedErr;

        const denom = (sched ?? []).length;
        const num = wRows.length;
        setCompletionRate(denom > 0 ? Math.round((num / denom) * 100) : 0);
      } else {
        setCompletionRate(null);
      }

      const dates = new Set<string>();
      for (const w of wRows) {
        const dt = w.completed_at ? new Date(w.completed_at) : null;
        if (!dt) continue;
        dates.add(dateOnly(dt));
      }
      let streak = 0;
      for (let i = 0; i < 365; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = dateOnly(d);
        if (dates.has(key)) streak++;
        else break;
      }
      setStreakDays(streak);

      let totalSec = 0;
      const durations: number[] = [];
      for (const w of wRows) {
        const asec = Number(w.active_seconds ?? 0);
        if (asec > 0) {
          totalSec += asec;
          durations.push(asec);
        } else {
          const s = w.started_at ? new Date(w.started_at).getTime() : null;
          const e = w.ended_at
            ? new Date(w.ended_at).getTime()
            : w.completed_at
            ? new Date(w.completed_at).getTime()
            : null;
          if (s && e && e > s) {
            const sec = Math.floor((e - s) / 1000);
            totalSec += sec;
            durations.push(sec);
          }
        }
      }
      setTotalTimeSeconds(totalSec);
      setAvgDurationSeconds(
        durations.length ? Math.round(totalSec / durations.length) : 0
      );

      const bwSeries = wRows
        .filter((w: any) => w.bodyweight_lb != null)
        .map((w: any) => ({
          t: w.completed_at || w.started_at,
          bw: Number(w.bodyweight_lb),
        }))
        .filter((x: any) => !!x.t && Number.isFinite(x.bw))
        .sort(
          (a: any, b: any) =>
            new Date(a.t).getTime() - new Date(b.t).getTime()
        );

      if (bwSeries.length) {
        const first = bwSeries[0].bw;
        const last = bwSeries[bwSeries.length - 1].bw;
        setLatestBW(last);
        setBwChange(last - first);
      } else {
        const { data: lastBW } = await supabase
          .from("workouts")
          .select("bodyweight_lb, completed_at, started_at")
          .eq("user_id", u.user.id)
          .not("bodyweight_lb", "is", null)
          .order("completed_at", { ascending: false })
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        setLatestBW(
          lastBW?.bodyweight_lb != null ? Number(lastBW.bodyweight_lb) : null
        );
        setBwChange(null);
      }

      let w7Query = supabase
        .from("workouts")
        .select("id, scheduled_session_id, completed_at")
        .eq("user_id", u.user.id)
        .not("completed_at", "is", null)
        .gte("completed_at", from7ISO);

      if (scope === "active" && activeSessionIds) {
        w7Query = w7Query.in("scheduled_session_id", activeSessionIds);
      }

      const { data: w7, error: w7Err } = await w7Query;
      if (w7Err) throw w7Err;

      const w7Ids = (w7 ?? []).map((x: any) => x.id);
      if (w7Ids.length) {
        const { data: pf, error: pfErr } = await supabase
          .from("workout_exercises")
          .select("id")
          .in("workout_id", w7Ids)
          .gte("pain", 3);
        if (pfErr) throw pfErr;
        setPainFlags7d((pf ?? []).length);
      } else {
        setPainFlags7d(0);
      }

      if (wIds.length) {
        const { data: wes, error: wesErr } = await supabase
          .from("workout_exercises")
          .select("exercise_id,pain,workout_id")
          .in("workout_id", wIds)
          .not("pain", "is", null);
        if (wesErr) throw wesErr;

        const allPain = (wes ?? [])
          .map((x: any) => Number(x.pain))
          .filter((p: number) => Number.isFinite(p));
        if (allPain.length) {
          const sum = allPain.reduce((a: number, b: number) => a + b, 0);
          const mx = allPain.reduce((m: number, p: number) => Math.max(m, p), 0);
          setPainAvgRange(sum / allPain.length);
          setPainMaxRange(mx);
        } else {
          setPainAvgRange(null);
          setPainMaxRange(null);
        }

        const list = (wes ?? []).filter((x: any) => Number(x.pain) > 0);
        const exIds = Array.from(
          new Set(list.map((x: any) => x.exercise_id).filter(Boolean))
        );

        const nameMap = new Map<string, string>();
        if (exIds.length) {
          const { data: ex, error: exNameErr } = await supabase
            .from("exercises")
            .select("id,name")
            .in("id", exIds);
          if (exNameErr) throw exNameErr;
          for (const e of ex ?? []) {
            nameMap.set((e as any).id, (e as any).name);
          }
        }

        const agg = new Map<
          string,
          { sum: number; max: number; count: number; name: string }
        >();
        for (const r of list) {
          const id = (r as any).exercise_id as string;
          const p = Number((r as any).pain);
          if (!id || !Number.isFinite(p)) continue;

          const name = nameMap.get(id) ?? id;
          const cur = agg.get(id) ?? { sum: 0, max: 0, count: 0, name };
          cur.sum += p;
          cur.max = Math.max(cur.max, p);
          cur.count += 1;
          agg.set(id, cur);
        }

        const rowsOut = Array.from(agg.values())
          .map((a) => ({
            name: a.name,
            avg: a.count ? a.sum / a.count : 0,
            max: a.max,
            count: a.count,
          }))
          .sort((a, b) => b.max - a.max || b.avg - a.avg)
          .slice(0, 12);

        setPainRows(rowsOut);
      } else {
        setPainRows([]);
        setPainAvgRange(null);
        setPainMaxRange(null);
      }

      if (wIds.length) {
        const { data: weids, error: weidErr } = await supabase
          .from("workout_exercises")
          .select("id, workout_id")
          .in("workout_id", wIds);
        if (weidErr) throw weidErr;

        const weIds = (weids ?? []).map((x: any) => x.id);
        if (weIds.length) {
          const { data: sets, error: setsErr } = await supabase
            .from("workout_sets")
            .select("reps,weight,workout_exercise_id")
            .in("workout_exercise_id", weIds);
          if (setsErr) throw setsErr;

          let vol = 0;
          let setsOk = 0;

          for (const s of sets ?? []) {
            const reps = Number((s as any).reps ?? 0);
            const wt = Number((s as any).weight ?? 0);
            if (reps > 0 && wt > 0) {
              vol += reps * wt;
              setsOk += 1;
            }
          }
          setVolumeTotal(vol);
          setSetsLogged(setsOk);
        } else {
          setVolumeTotal(0);
          setSetsLogged(0);
        }
      } else {
        setVolumeTotal(0);
        setSetsLogged(0);
      }

      if (wRows.length) {
        const top = wRows.slice(0, 20);
        const sessIds = Array.from(
          new Set(top.map((w: any) => w.scheduled_session_id).filter(Boolean))
        );

        const sessMap = new Map<string, any>();
        if (sessIds.length) {
          const { data: sess } = await supabase
            .from("scheduled_sessions")
            .select("id, template_id")
            .in("id", sessIds);
          for (const s of sess ?? []) {
            sessMap.set((s as any).id, s);
          }
        }

        const tmplIds = Array.from(
          new Set(
            Array.from(sessMap.values())
              .map((s: any) => s.template_id)
              .filter(Boolean)
          )
        );
        const tmplMap = new Map<string, string>();
        if (tmplIds.length) {
          const { data: tmpls } = await supabase
            .from("workout_templates")
            .select("id,name")
            .in("id", tmplIds);
          for (const t of tmpls ?? []) {
            tmplMap.set((t as any).id, (t as any).name);
          }
        }

        const topIds = top.map((w: any) => w.id);

        const painAgg = new Map<
          string,
          { sum: number; max: number; count: number }
        >();
        if (topIds.length) {
          const { data: wes } = await supabase
            .from("workout_exercises")
            .select("workout_id,pain")
            .in("workout_id", topIds)
            .not("pain", "is", null);
          for (const r of wes ?? []) {
            const wid = (r as any).workout_id as string;
            const p = Number((r as any).pain ?? 0);
            if (!wid) continue;
            const cur = painAgg.get(wid) ?? { sum: 0, max: 0, count: 0 };
            cur.sum += p;
            cur.max = Math.max(cur.max, p);
            cur.count += 1;
            painAgg.set(wid, cur);
          }
        }

        const volAgg = new Map<string, number>();
        if (topIds.length) {
          const { data: weids2 } = await supabase
            .from("workout_exercises")
            .select("id, workout_id")
            .in("workout_id", topIds);
          const weIds2 = (weids2 ?? []).map((x: any) => x.id);
          const weToW = new Map<string, string>();
          for (const w of weids2 ?? []) {
            weToW.set((w as any).id, (w as any).workout_id);
          }

          if (weIds2.length) {
            const { data: sets } = await supabase
              .from("workout_sets")
              .select("reps,weight,workout_exercise_id")
              .in("workout_exercise_id", weIds2);
            for (const s of sets ?? []) {
              const weid = (s as any).workout_exercise_id as string;
              const wid = weToW.get(weid);
              if (!wid) continue;
              const reps = Number((s as any).reps ?? 0);
              const wt = Number((s as any).weight ?? 0);
              if (reps > 0 && wt > 0) {
                volAgg.set(wid, (volAgg.get(wid) ?? 0) + reps * wt);
              }
            }
          }
        }

        const detailByWorkout = new Map<string, HistoryExerciseRow[]>();
        if (topIds.length) {
          const { data: detailExerciseRows, error: detailExerciseErr } = await supabase
            .from("workout_exercises")
            .select("id,workout_id,exercise_id,order_index,prescription_snapshot,pain,difficulty")
            .in("workout_id", topIds)
            .order("order_index", { ascending: true });

          if (detailExerciseErr) throw detailExerciseErr;

          const detailRows = (detailExerciseRows ?? []) as any[];
          const detailExerciseIds = Array.from(
            new Set(detailRows.map((row) => row.exercise_id).filter(Boolean))
          );

          const detailNameMap = new Map<string, string>();
          if (detailExerciseIds.length) {
            const { data: detailNames, error: detailNameErr } = await supabase
              .from("exercises")
              .select("id,name")
              .in("id", detailExerciseIds);

            if (detailNameErr) throw detailNameErr;
            for (const row of detailNames ?? []) {
              detailNameMap.set((row as any).id, (row as any).name);
            }
          }

          const detailWeIds = detailRows.map((row) => row.id).filter(Boolean);
          const setsByWorkoutExercise = new Map<string, HistorySetRow[]>();

          if (detailWeIds.length) {
            const { data: detailSets, error: detailSetsErr } = await supabase
              .from("workout_sets")
              .select("workout_exercise_id,set_index,reps,weight,rir,pain,form")
              .in("workout_exercise_id", detailWeIds)
              .order("set_index", { ascending: true });

            if (detailSetsErr) throw detailSetsErr;

            for (const row of detailSets ?? []) {
              const workoutExerciseId = (row as any).workout_exercise_id as string;
              if (!workoutExerciseId) continue;

              const list = setsByWorkoutExercise.get(workoutExerciseId) ?? [];
              list.push({
                set_index: Number((row as any).set_index ?? 0),
                reps: Number((row as any).reps ?? 0),
                weight: Number((row as any).weight ?? 0),
                rir: (row as any).rir != null ? Number((row as any).rir) : null,
                pain: (row as any).pain != null ? Number((row as any).pain) : null,
                form: (row as any).form != null ? Number((row as any).form) : null,
              });
              setsByWorkoutExercise.set(workoutExerciseId, list);
            }
          }

          for (const row of detailRows) {
            const workoutId = row.workout_id as string;
            if (!workoutId) continue;

            const list = detailByWorkout.get(workoutId) ?? [];
            list.push({
              workout_exercise_id: row.id,
              exercise_id: row.exercise_id,
              name: detailNameMap.get(row.exercise_id) ?? row.exercise_id ?? "Exercise",
              order_index: Number(row.order_index ?? 0),
              prescription_snapshot: row.prescription_snapshot ?? {},
              pain: row.pain != null ? Number(row.pain) : null,
              difficulty: row.difficulty != null ? String(row.difficulty) : null,
              sets: (setsByWorkoutExercise.get(row.id) ?? []).sort(
                (a, b) => a.set_index - b.set_index
              ),
            });
            detailByWorkout.set(workoutId, list);
          }

          for (const [workoutId, exerciseRows] of detailByWorkout) {
            detailByWorkout.set(
              workoutId,
              exerciseRows.sort((a, b) => a.order_index - b.order_index)
            );
          }
        }

        const out = top.map((w: any) => {
          const sess = sessMap.get(w.scheduled_session_id);
          const tmplName = sess?.template_id
            ? tmplMap.get(sess.template_id) ?? "Session"
            : "Session";

          const secs =
            Number(w.active_seconds ?? 0) > 0
              ? Number(w.active_seconds)
              : (() => {
                  const s = w.started_at ? new Date(w.started_at).getTime() : null;
                  const e = w.ended_at
                    ? new Date(w.ended_at).getTime()
                    : w.completed_at
                    ? new Date(w.completed_at).getTime()
                    : null;
                  return s && e && e > s ? Math.floor((e - s) / 1000) : 0;
                })();

          const pa = painAgg.get(w.id) ?? { sum: 0, max: 0, count: 0 };
          const painAvg = pa.count ? pa.sum / pa.count : 0;

          return {
            id: w.id,
            completed_at: w.completed_at,
            template_name: tmplName,
            session_seconds: secs,
            bodyweight_lb:
              w.bodyweight_lb != null ? Number(w.bodyweight_lb) : null,
            protein_target_g:
              w.protein_target_g != null ? Number(w.protein_target_g) : null,
            pain_max: pa.max,
            pain_avg: painAvg,
            volume_total: volAgg.get(w.id) ?? 0,
            post_difficulty: (w.post_difficulty as string) ?? null,
            session_rating:
              w.session_rating != null ? Number(w.session_rating) : null,
            post_notes: (w.post_notes as string) ?? null,
            notes: (w.notes as string) ?? null,
            workout_summary: (w.workout_summary as any) ?? null,
            exercises: detailByWorkout.get(w.id) ?? [],
          };
        });

        setHistory(out);
        setExpandedHistoryIds((previous) => {
          if (!out.length) return {};
          if (Object.keys(previous).some((id) => out.some((row) => row.id === id))) return previous;
          return { [out[0].id]: true };
        });
      } else {
        setHistory([]);
      }
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, range]);

  const proteinTargetToday = useMemo(() => {
    if (!latestBW || latestBW <= 0) return null;
    return roundProtein(latestBW * proteinMultiplier(goal));
  }, [latestBW, goal]);

  const selectedPeriodLabel = rangeLabel(range);
  const workoutsPerWeek = useMemo(() => {
    const weeks = Math.max(1, periodSpanDays / 7);
    return completedCount / weeks;
  }, [completedCount, periodSpanDays]);
  const averageSetsPerWorkout = useMemo(() => {
    return completedCount > 0 ? setsLogged / completedCount : 0;
  }, [completedCount, setsLogged]);

  async function onClearLogs() {
    setToast(null);
    setErr(null);
    setClearBusy(true);
    try {
      const { data: u, error: uErr } = await supabase.auth.getUser();
      if (uErr) throw uErr;
      if (!u.user) throw new Error("Sign in first.");

      const { data: active, error: aErr } = await supabase
        .from("workouts")
        .select("id")
        .eq("user_id", u.user.id)
        .is("completed_at", null)
        .limit(1)
        .maybeSingle();
      if (aErr) throw aErr;
      if (active?.id) throw new Error("End the active workout first.");

      const { data, error } = await supabase.rpc("rpc_clear_logs_all_time");
      if (error) throw error;

      setToast(`Logs cleared. (${data?.workouts_deleted ?? 0} workouts)`);
      setClearOpen(false);
      setClearText("");
      await loadAll();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setClearBusy(false);
    }
  }

  function renderExerciseList(h: HistoryRow) {
    const detailedNames = h.exercises.map((exercise) => exercise.name).filter(Boolean);
    const summaryNames = Array.isArray(h.workout_summary?.exercises)
      ? h.workout_summary.exercises
      : [];
    const names = detailedNames.length ? detailedNames : summaryNames;
    if (!names.length) return null;

    const top = names.slice(0, 10);
    const extra = names.length - top.length;

    return (
      <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
        <div className="tr-kicker">EXERCISES</div>
        <div className="tr-sub" style={{ lineHeight: 1.45 }}>
          {top.join(", ")}
          {extra > 0 ? ` (+${extra} more)` : ""}
        </div>
      </div>
    );
  }

  function renderExerciseDetails(h: HistoryRow) {
    if (!h.exercises.length) {
      return (
        <div className="tr-historyNoDetails">
          No set-by-set rows were found for this completed session.
        </div>
      );
    }

    return (
      <div className="tr-historyExerciseList">
        {h.exercises.map((exercise) => {
          const actualMinutes = Number(exercise.prescription_snapshot?.actual_minutes ?? 0);
          const durationMinutes = Number(
            exercise.prescription_snapshot?.duration_minutes ??
              (Number(exercise.prescription_snapshot?.duration_seconds ?? 0) > 0
                ? Math.round(Number(exercise.prescription_snapshot.duration_seconds) / 60)
                : 0)
          );

          return (
            <div key={exercise.workout_exercise_id} className="tr-historyExerciseCard">
              <div className="tr-historyExerciseHead">
                <div>
                  <div className="tr-historyExerciseName">{exercise.name}</div>
                  <div className="tr-historyExerciseMeta">
                    {exercise.pain != null ? `Pain ${exercise.pain}/10` : "Pain —"}
                    {exercise.difficulty ? ` • ${difficultyLabel(exercise.difficulty) ?? exercise.difficulty}` : ""}
                  </div>
                </div>

                {exercise.sets.length ? (
                  <div className="tr-historySetCount">{exercise.sets.length} sets</div>
                ) : null}
              </div>

              {exercise.sets.length ? (
                <div className="tr-historySetGrid">
                  {exercise.sets.map((set) => (
                    <div key={set.set_index} className="tr-historySetRow">
                      <span className="tr-historySetNumber">SET {set.set_index}</span>
                      <span className="tr-historySetResult">
                        {Number.isInteger(set.weight) ? set.weight : Number(set.weight.toFixed(2))} lb × {set.reps}
                      </span>
                      {set.rir != null ? <span className="tr-historySetExtra">RIR {set.rir}</span> : null}
                    </div>
                  ))}
                </div>
              ) : actualMinutes > 0 || durationMinutes > 0 ? (
                <div className="tr-historyTimedResult">
                  Actual {actualMinutes > 0 ? actualMinutes : durationMinutes} min
                  {durationMinutes > 0 ? ` • Target ${durationMinutes} min` : ""}
                </div>
              ) : (
                <div className="tr-historyNoSets">No strength sets were recorded.</div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  function toggleHistoryDetails(workoutId: string) {
    setExpandedHistoryIds((previous) => ({
      ...previous,
      [workoutId]: !previous[workoutId],
    }));
  }

  const painTone = useMemo(() => {
    const mx = painMaxRange ?? 0;
    if (mx >= 7) return "red" as const;
    if (mx >= 4) return "orange" as const;
    return "green" as const;
  }, [painMaxRange]);

  const heroCompletion = completionRate == null ? "—" : `${completionRate}%`;

  return (
    <div className="tr-progressStage">
      <div className="tr-progressStack">
        <Card
          title="Progress"
          right={
            <div className="tr-progressControls">
              <div className="tr-progressControlGroup">
                <span className="tr-progressControlLabel">PROGRAM</span>
                <button
                  className={`tr-seg ${scope === "active" ? "is-active" : ""}`}
                  onClick={() => setScope("active")}
                >
                  Current Program
                </button>
                <button
                  className={`tr-seg ${scope === "all" ? "is-active" : ""}`}
                  onClick={() => setScope("all")}
                >
                  All Programs
                </button>
              </div>

              <span className="tr-progressDivider" />

              <div className="tr-progressControlGroup">
                <span className="tr-progressControlLabel">PERIOD</span>
                <button
                  className={`tr-seg ${range === 7 ? "is-active" : ""}`}
                  onClick={() => setRange(7)}
                >
                  7d
                </button>
                <button
                  className={`tr-seg ${range === 14 ? "is-active" : ""}`}
                  onClick={() => setRange(14)}
                >
                  14d
                </button>
                <button
                  className={`tr-seg ${range === 30 ? "is-active" : ""}`}
                  onClick={() => setRange(30)}
                >
                  30d
                </button>
                <button
                  className={`tr-seg ${range === 90 ? "is-active" : ""}`}
                  onClick={() => setRange(90)}
                >
                  90d
                </button>
                <button
                  className={`tr-seg ${range === "all" ? "is-active" : ""}`}
                  onClick={() => setRange("all")}
                >
                  All Time
                </button>
              </div>
            </div>
          }
        >
          {toast ? (
            <div
              className="tr-rowbox"
              style={{
                borderColor: "rgba(0,170,255,.35)",
                background: "rgba(0,170,255,.10)",
                fontWeight: 900,
              }}
            >
              {toast}
            </div>
          ) : null}

          {err ? (
            <div
              className="tr-rowbox"
              style={{
                borderColor: "rgb(255 80 80 / .35)",
                background: "rgb(255 80 80 / .10)",
              }}
            >
              {err}
            </div>
          ) : null}

          <div className="tr-moduleFrame">
            <div className="tr-progressSectionLabel">TRAINING OVERVIEW • {selectedPeriodLabel}</div>
            <div className="tr-kpiGrid tr-kpiGrid--4">
              <KpiTile
                icon={icoChecked}
                label={`WORKOUTS COMPLETED (${selectedPeriodLabel})`}
                value={loading ? "—" : completedCount}
                tone="blue"
                sub={scope === "active" ? "Current program" : "All programs"}
              />
              <KpiTile
                icon={icoInProcess}
                label={`TOTAL TRAINING TIME (${selectedPeriodLabel})`}
                value={loading ? "—" : fmtHMS(totalTimeSeconds)}
                tone="blue"
                sub="Active training time"
                hero
              />
              <KpiTile
                icon={icoWorkout}
                label={`SETS LOGGED (${selectedPeriodLabel})`}
                value={loading ? "—" : setsLogged}
                tone="base"
                sub={`${fmtDecimal(averageSetsPerWorkout)} avg per workout`}
              />
              <KpiTile
                icon={icoFlames}
                label="CURRENT STREAK"
                value={loading ? "—" : `${streakDays}`}
                tone={streakDays >= 7 ? "green" : "base"}
                sub="consecutive training days"
              />
            </div>

            <div className="tr-progressSectionLabel tr-progressSectionLabel--spaced">TRAINING EFFICIENCY</div>
            <div className="tr-kpiGrid tr-kpiGrid--4">
              <KpiTile
                icon={icoRate}
                label={`COMPLETION RATE (${selectedPeriodLabel})`}
                value={loading ? "—" : heroCompletion}
                tone="blue"
                sub={scope === "active" ? "Scheduled vs completed" : "Current program only"}
              />
              <KpiTile
                icon={icoInProcess}
                label={`AVERAGE WORKOUT (${selectedPeriodLabel})`}
                value={loading ? "—" : fmtHMS(avgDurationSeconds)}
                tone="base"
                sub="Average session duration"
              />
              <KpiTile
                icon={icoSchedule}
                label="WORKOUTS PER WEEK"
                value={loading ? "—" : fmtDecimal(workoutsPerWeek)}
                tone="base"
                sub={`Based on ${selectedPeriodLabel.toLowerCase()}`}
              />
              <KpiTile
                icon={icoReport}
                label={`TOTAL VOLUME (${selectedPeriodLabel})`}
                value={loading || volumeTotal == null ? "—" : Math.round(volumeTotal).toLocaleString()}
                tone="blue"
                sub="sum(reps × weight)"
              />
            </div>
          </div>

          <div className="tr-progressTabs">
            <button
              className={`tr-seg ${tab === "protein" ? "is-active" : ""}`}
              onClick={() => setTab("protein")}
            >
              Protein
            </button>
            <button
              className={`tr-seg ${tab === "weight" ? "is-active" : ""}`}
              onClick={() => setTab("weight")}
            >
              Weight
            </button>
            <button
              className={`tr-seg ${tab === "volume" ? "is-active" : ""}`}
              onClick={() => setTab("volume")}
            >
              Volume
            </button>
            <button
              className={`tr-seg ${tab === "pain" ? "is-active" : ""}`}
              onClick={() => setTab("pain")}
            >
              Pain
            </button>
          </div>
        </Card>

        <Card title="Pain" tone="blue">
          <div className={`tr-moduleFrame tr-moduleFrame--pain tone-${painTone}`}>
            <div className="tr-kpiGrid tr-kpiGrid--3">
              <KpiTile
                icon={icoFlag}
                label="PAIN FLAGS (7D)"
                value={loading ? "—" : painFlags7d}
                tone={painFlags7d > 0 ? "orange" : "green"}
                sub="pain ≥ 3"
              />
              <KpiTile
                icon={icoPain}
                label={`AVG PAIN (${selectedPeriodLabel})`}
                value={
                  loading ? "—" : painAvgRange == null ? "—" : painAvgRange.toFixed(1)
                }
                tone={painTone}
                sub="all logged pain"
              />
              <KpiTile
                icon={icoWarning}
                label={`MAX PAIN (${selectedPeriodLabel})`}
                value={loading ? "—" : painMaxRange == null ? "—" : painMaxRange}
                tone={painTone}
                sub="peak in range"
              />
            </div>
          </div>
        </Card>

        {tab === "protein" && (
          <Card title="Protein">
            <div className="tr-moduleFrame tr-moduleFrame--protein">
              <div className="tr-proteinHero">
                <div className="tr-proteinHeroLeft">
                  <MetricLabel icon={icoProtein} text="TARGET TODAY" tone="blue" />
                  <MetricValue
                    value={
                      proteinTargetToday != null ? `${proteinTargetToday}g` : "—"
                    }
                  />
                  <div className="tr-sub" style={{ marginTop: 6 }}>
                    Based on current weight + goal.
                  </div>
                </div>
                <div className="tr-proteinHeroRight">
                  <div className="tr-rowbox tr-rowbox--row">
                    <MetricLabel icon={icoTarget} text="GOAL" tone="base" />
                    <div style={{ fontWeight: 1000 }}>{goal ?? "—"}</div>
                  </div>
                  <div className="tr-rowbox tr-rowbox--row">
                    <MetricLabel
                      icon={icoScale}
                      text="CURRENT WEIGHT (LB)"
                      tone="base"
                    />
                    <MetricValue value={latestBW != null ? latestBW : "—"} />
                  </div>
                </div>
              </div>
            </div>
          </Card>
        )}

        {tab === "weight" && (
          <Card title="Bodyweight">
            <div className="tr-moduleFrame">
              <div className="tr-kpiGrid tr-kpiGrid--2">
                <KpiTile
                  icon={icoScale}
                  label="LATEST"
                  value={latestBW != null ? `${latestBW} lb` : "—"}
                  tone="blue"
                />
                <KpiTile
                  icon={icoRate}
                  label={`CHANGE (${selectedPeriodLabel})`}
                  value={
                    bwChange == null
                      ? "—"
                      : `${bwChange >= 0 ? "+" : ""}${bwChange.toFixed(1)} lb`
                  }
                  tone={bwChange == null ? "base" : bwChange < 0 ? "green" : "orange"}
                  sub="start → now"
                />
              </div>
            </div>
          </Card>
        )}

        {tab === "volume" && (
          <Card title="Volume">
            <div className="tr-moduleFrame">
              <KpiTile
                icon={icoReport}
                label={`TOTAL VOLUME (${selectedPeriodLabel})`}
                value={
                  volumeTotal == null ? "—" : Math.round(volumeTotal).toLocaleString()
                }
                tone="blue"
                sub="sum(reps × weight)"
                hero
              />
            </div>
          </Card>
        )}

        {tab === "pain" && (
          <Card title="Pain">
            <div className="tr-moduleFrame">
              <div style={{ marginTop: 6, display: "grid", gap: 10 }}>
                {painRows.length ? (
                  painRows.map((r) => (
                    <div
                      key={r.name}
                      className="tr-rowbox tr-rowbox--float"
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr auto",
                        gap: 10,
                        alignItems: "center",
                      }}
                    >
                      <div style={{ display: "grid", gap: 2 }}>
                        <div
                          style={{
                            fontWeight: 950,
                            display: "flex",
                            gap: 10,
                            alignItems: "center",
                          }}
                        >
                          <HudIcon
                            src={icoPain}
                            alt=""
                            size={18}
                            tone={r.max >= 5 ? "orange" : "blue"}
                          />
                          {r.name}
                        </div>
                        <div className="tr-sub">
                          avg {r.avg.toFixed(1)} • max {r.max} • n={r.count}
                        </div>
                      </div>
                      <Chip tone={r.max >= 5 ? "orange" : "blue"}>
                        max {r.max}
                      </Chip>
                    </div>
                  ))
                ) : (
                  <div className="tr-sub">No pain data in this range.</div>
                )}
              </div>
            </div>
          </Card>
        )}

        <Card
          title="History"
          right={
            <button
              className="tr-seg"
              style={{ minWidth: 160, borderColor: "rgba(255,80,80,.35)" }}
              onClick={() => setClearOpen(true)}
            >
              Clear Logs
            </button>
          }
        >
          {loading ? (
            <div className="tr-sub">Loading…</div>
          ) : history.length ? (
            <div style={{ display: "grid", gap: 10 }}>
              {history.map((h) => {
                const diff = difficultyLabel(h.post_difficulty, h.session_rating);
                const note = (h.post_notes || h.notes || "").trim() || null;
                const detailsOpen = !!expandedHistoryIds[h.id];

                return (
                  <div
                    key={h.id}
                    className="tr-rowbox tr-rowbox--float"
                    style={{ display: "grid", gap: 8 }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 10,
                        alignItems: "baseline",
                        flexWrap: "wrap",
                      }}
                    >
                      <div style={{ fontWeight: 950 }}>{h.template_name}</div>
                      <div className="tr-kicker">{fmtMDYTime(h.completed_at)}</div>
                    </div>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <Chip tone="blue">{fmtHMS(h.session_seconds)}</Chip>
                      <Chip tone="blue">
                        Weight {h.bodyweight_lb != null ? `${h.bodyweight_lb} lb` : "—"}
                      </Chip>
                      <Chip tone="blue">
                        Protein{" "}
                        {h.protein_target_g != null ? `${h.protein_target_g}g` : "—"}
                      </Chip>
                      <Chip tone={h.pain_max >= 5 ? "orange" : "blue"}>
                        Pain max {h.pain_max}
                      </Chip>
                      <Chip tone="blue">
                        Vol {Math.round(h.volume_total).toLocaleString()}
                      </Chip>
                      {diff ? <Chip tone="blue">{diff}</Chip> : null}
                    </div>

                    <div className="tr-sub">avg pain {h.pain_avg.toFixed(1)}</div>

                    {renderExerciseList(h)}

                    <button
                      type="button"
                      className={`tr-historyDetailsToggle ${detailsOpen ? "is-open" : ""}`}
                      onClick={() => toggleHistoryDetails(h.id)}
                    >
                      {detailsOpen ? "HIDE SET DETAILS" : "SHOW SET DETAILS"}
                    </button>

                    {detailsOpen ? renderExerciseDetails(h) : null}

                    {note ? (
                      <div style={{ marginTop: 8 }}>
                        <div className="tr-kicker">NOTES</div>
                        <div className="tr-sub" style={{ marginTop: 6, lineHeight: 1.45 }}>
                          {note}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="tr-sub">No completed sessions in this period.</div>
          )}

          {clearOpen ? (
            <div className="tr-modalOverlay">
              <div className="tr-modal">
                <div className="tr-modalHead">
                  <div style={{ fontWeight: 950 }}>Clear Logs (All Time)</div>
                  <button
                    className="tr-btn"
                    onClick={() => setClearOpen(false)}
                    disabled={clearBusy}
                  >
                    Close
                  </button>
                </div>

                <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                  <div
                    className="tr-rowbox"
                    style={{
                      borderColor: "rgba(255,80,80,.35)",
                      background: "rgba(255,80,80,.10)",
                      fontWeight: 900,
                    }}
                  >
                    This permanently deletes all completed workout logs (History + KPIs).
                    Schedule/templates stay intact.
                    <div style={{ marginTop: 8 }}>
                      Type <b>CLEAR</b> to confirm.
                    </div>
                  </div>

                  <input
                    value={clearText}
                    onChange={(e) => setClearText(e.target.value)}
                    placeholder="Type CLEAR"
                    style={{ height: 44 }}
                    disabled={clearBusy}
                  />

                  <button
                    className="tr-btn tr-btn--primary"
                    style={{
                      borderColor:
                        clearText.trim().toUpperCase() === "CLEAR"
                          ? "rgba(255,80,80,.65)"
                          : undefined,
                      background:
                        clearText.trim().toUpperCase() === "CLEAR"
                          ? "linear-gradient(180deg, rgba(255,80,80,.22), rgba(255,80,80,.12))"
                          : undefined,
                    }}
                    disabled={clearBusy || clearText.trim().toUpperCase() !== "CLEAR"}
                    onClick={onClearLogs}
                  >
                    DELETE LOGS
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </Card>

        <Card title="Actions">
          <div style={{ display: "grid", gap: 10 }}>
            <Button onClick={() => (window.location.pathname = "/")}>
              Back to Workouts
            </Button>
            <Button
              variant="secondary"
              onClick={() => (window.location.pathname = "/coach")}
            >
              Go to Coach
            </Button>
            <Button variant="secondary" onClick={loadAll}>
              Refresh
            </Button>
          </div>
        </Card>
      </div>

      <style>{`
        .tr-progressStage{
          position: relative;
          isolation: isolate;
        }
        .tr-progressStage::before{
          content:"";
          position:absolute;
          inset: -26px -18px -26px -18px;
          z-index: 0;
          pointer-events:none;
          background:
            radial-gradient(1100px 520px at 50% 8%, rgba(0,170,255,.14), rgba(0,0,0,0) 62%),
            radial-gradient(1100px 760px at 50% 52%, rgba(255,255,255,.04), rgba(0,0,0,0) 68%),
            radial-gradient(900px 520px at 20% 18%, rgba(0,0,0,.52), rgba(0,0,0,0) 66%),
            radial-gradient(900px 520px at 80% 22%, rgba(0,0,0,.52), rgba(0,0,0,0) 66%);
          filter: blur(0.2px);
          opacity: .95;
        }
        .tr-progressStack{
          position: relative;
          z-index: 1;
          display: grid;
          gap: 14px;
        }

        .tr-progressControls{
          display:flex;
          gap:8px;
          align-items:center;
          flex-wrap:wrap;
          justify-content:flex-end;
        }
        .tr-progressControlGroup{
          display:flex;
          gap:8px;
          align-items:center;
          flex-wrap:wrap;
          justify-content:flex-end;
        }
        .tr-progressControlLabel{
          font-size: 9px;
          letter-spacing: .20em;
          text-transform: uppercase;
          font-weight: 950;
          color: rgba(255,255,255,.48);
          margin-right: 2px;
        }
        .tr-progressSectionLabel{
          margin-bottom: 10px;
          font-size: 10px;
          letter-spacing: .22em;
          text-transform: uppercase;
          font-weight: 950;
          color: rgba(255,255,255,.58);
        }
        .tr-progressSectionLabel--spaced{
          margin-top: 14px;
        }
        .tr-progressDivider{
          width: 10px;
          height: 26px;
          border-left: 1px solid rgba(255,255,255,.10);
          opacity: .7;
        }

        .tr-progressStage .tr-card{
          transform: translateZ(0);
          box-shadow:
            0 8px 18px rgba(0,0,0,.34),
            0 28px 90px rgba(0,0,0,.62),
            inset 0 1px 0 rgba(255,255,255,.08),
            0 0 0 1px rgba(0,170,255,.06) !important;
        }
        .tr-progressStage .tr-card::after{
          content:"";
          position:absolute;
          inset:0;
          border-radius: 18px;
          pointer-events:none;
          background: linear-gradient(180deg, rgba(255,255,255,.10), rgba(255,255,255,0) 42%);
          opacity: .25;
        }

        .tr-moduleFrame{
          margin-top: 12px;
          border-radius: 18px;
          border: 1px solid rgba(0,170,255,.18);
          background:
            radial-gradient(860px 240px at 50% 0%, rgba(0,170,255,.10), rgba(0,0,0,0) 62%),
            linear-gradient(180deg, rgba(255,255,255,.045), rgba(0,0,0,.14));
          box-shadow:
            inset 0 0 0 1px rgba(0,0,0,.55),
            inset 0 1px 0 rgba(255,255,255,.06),
            0 22px 70px rgba(0,0,0,.42);
          padding: 12px;
          position: relative;
          overflow:hidden;
        }
        .tr-moduleFrame::before{
          content:"";
          position:absolute;
          inset:0;
          pointer-events:none;
          background: linear-gradient(180deg, rgba(255,255,255,.10), rgba(255,255,255,0) 46%);
          opacity: .55;
        }
        .tr-moduleFrame > *{ position: relative; z-index: 1; }

        .tr-moduleFrame--pain.tone-green{
          border-color: rgba(34,197,94,.20);
          background:
            radial-gradient(860px 240px at 50% 0%, rgba(34,197,94,.12), rgba(0,0,0,0) 62%),
            linear-gradient(180deg, rgba(255,255,255,.045), rgba(0,0,0,.14));
        }
        .tr-moduleFrame--pain.tone-orange{
          border-color: rgba(255,140,0,.24);
          background:
            radial-gradient(860px 240px at 50% 0%, rgba(255,140,0,.14), rgba(0,0,0,0) 62%),
            linear-gradient(180deg, rgba(255,255,255,.045), rgba(0,0,0,.14));
        }
        .tr-moduleFrame--pain.tone-red{
          border-color: rgba(239,68,68,.26);
          background:
            radial-gradient(860px 240px at 50% 0%, rgba(239,68,68,.16), rgba(0,0,0,0) 62%),
            linear-gradient(180deg, rgba(255,255,255,.045), rgba(0,0,0,.14));
        }

        .tr-moduleFrame--protein{
          border-color: rgba(0,170,255,.22);
          background:
            radial-gradient(860px 240px at 50% 0%, rgba(0,170,255,.14), rgba(0,0,0,0) 62%),
            linear-gradient(180deg, rgba(255,255,255,.045), rgba(0,0,0,.14));
        }

        .tr-progressTabs{
          margin-top: 14px;
          display:flex;
          gap:10px;
          flex-wrap:wrap;
          justify-content:flex-end;
        }

        .tr-kpiGrid{
          display:grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
        }
        .tr-kpiGrid--2{ grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .tr-kpiGrid--3{ grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .tr-kpiGrid--4{ grid-template-columns: repeat(4, minmax(0, 1fr)); }

        @media (max-width: 1120px){
          .tr-kpiGrid--4{ grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 980px){
          .tr-kpiGrid{ grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .tr-kpiGrid--3{ grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .tr-kpiGrid--2{ grid-template-columns: 1fr; }
          .tr-progressControls{
            width: 100%;
            justify-content: flex-start;
          }
          .tr-progressControlGroup{
            width: 100%;
            justify-content: flex-start;
          }
          .tr-progressDivider{
            width: 100%;
            height: 1px;
            border-left: 0;
            border-top: 1px solid rgba(255,255,255,.10);
          }
        }
        @media (max-width: 520px){
          .tr-kpiGrid{ grid-template-columns: 1fr; }
          .tr-kpiGrid--3{ grid-template-columns: 1fr; }
          .tr-kpiGrid--4{ grid-template-columns: 1fr; }
          .tr-progressControlGroup{
            display:grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .tr-progressControlGroup .tr-progressControlLabel{
            grid-column: 1 / -1;
          }
          .tr-progressControlGroup .tr-seg{
            width: 100%;
            min-width: 0;
            padding-left: 8px;
            padding-right: 8px;
            font-size: 10px;
          }
        }

        .tr-kpiTile{
          border-radius: 16px;
          border: 1px solid rgba(255,255,255,.10);
          background:
            linear-gradient(180deg, rgba(255,255,255,.05), rgba(0,0,0,.12));
          box-shadow:
            0 10px 18px rgba(0,0,0,.20),
            0 22px 70px rgba(0,0,0,.48),
            inset 0 1px 0 rgba(255,255,255,.06);
          padding: 14px;
          display:grid;
          gap: 6px;
          position: relative;
          overflow:hidden;
          transform: translateZ(0);
          transition: transform .14s ease, border-color .14s ease, box-shadow .14s ease, filter .14s ease;
        }
        .tr-kpiTile::before{
          content:"";
          position:absolute;
          inset:0;
          pointer-events:none;
          background:
            radial-gradient(520px 180px at 50% 24%, rgba(0,170,255,.10), rgba(0,0,0,0) 70%),
            linear-gradient(180deg, rgba(255,255,255,.10), rgba(255,255,255,0) 44%);
          opacity: .55;
        }
        .tr-kpiTile > *{ position: relative; z-index: 1; }

        .tr-kpiTile .tr-ico{
          width: 28px !important;
          height: 28px !important;
        }
        .tr-kpiTile .tr-icocap{
          width: 34px !important;
          height:34px !important;
        }

        .tr-kpiTile:hover{
          transform: translateY(-1px);
          border-color: rgba(0,170,255,.22);
          box-shadow:
            0 14px 24px rgba(0,0,0,.26),
            0 30px 90px rgba(0,0,0,.56),
            0 0 18px rgba(0,170,255,.10),
            inset 0 1px 0 rgba(255,255,255,.07);
          filter: saturate(1.03);
        }

        .tr-kpiTile.tone-blue{ border-color: rgba(0,170,255,.22); }
        .tr-kpiTile.tone-green{ border-color: rgba(34,197,94,.22); }
        .tr-kpiTile.tone-orange{ border-color: rgba(255,140,0,.24); }
        .tr-kpiTile.tone-red{ border-color: rgba(239,68,68,.26); }

        .tr-kpiTile.is-hero{
          background:
            radial-gradient(680px 220px at 50% 24%, rgba(0,170,255,.16), rgba(0,0,0,0) 70%),
            linear-gradient(180deg, rgba(255,255,255,.06), rgba(0,0,0,.12));
          border-color: rgba(0,170,255,.34);
          box-shadow:
            0 18px 30px rgba(0,0,0,.28),
            0 44px 120px rgba(0,0,0,.64),
            0 0 26px rgba(0,170,255,.12),
            inset 0 1px 0 rgba(255,255,255,.08);
        }
        .tr-kpiTile.is-hero .tr-metricNum{
          font-size: 44px;
          letter-spacing: .02em;
          text-shadow:
            0 10px 0 rgba(0,0,0,.76),
            0 0 26px rgba(0,170,255,.12);
        }

        .tr-kpiSub{ margin-top: 2px; }

        .tr-icocap{
          width: 28px;
          height: 28px;
          border-radius: 12px;
          display: inline-grid;
          place-items: center;
          border: 1px solid rgba(0,170,255,.26);
          background:
            radial-gradient(240px 120px at 50% 35%, rgba(0,170,255,.14), rgba(0,0,0,0) 70%),
            linear-gradient(180deg, rgba(255,255,255,.06), rgba(0,0,0,.16));
          box-shadow:
            inset 0 0 0 1px rgba(0,0,0,.50),
            inset 0 1px 0 rgba(255,255,255,.06),
            0 14px 44px rgba(0,0,0,.40),
            0 0 16px rgba(0,170,255,.08);
        }
        .tr-icocap img{
          object-fit: contain;
          filter: drop-shadow(0 0 10px rgba(0,170,255,.10));
        }
        .tr-icocap.is-big{
          width: 34px;
          height: 34px;
          border-radius: 14px;
          border-color: rgba(0,170,255,.34);
          box-shadow:
            inset 0 0 0 1px rgba(0,0,0,.55),
            inset 0 1px 0 rgba(255,255,255,.07),
            0 18px 60px rgba(0,0,0,.52),
            0 0 22px rgba(0,170,255,.10);
        }
        .tr-icocap.tone-green{ border-color: rgba(34,197,94,.26); }
        .tr-icocap.tone-orange{ border-color: rgba(255,140,0,.30); }
        .tr-icocap.tone-red{ border-color: rgba(239,68,68,.30); }
        .tr-icocap.tone-base{ border-color: rgba(255,255,255,.14); }

        .tr-metricLabel{
          display:inline-flex;
          align-items:center;
          gap:10px;
          font-weight: 950;
          letter-spacing: .18em;
          text-transform: uppercase;
          font-size: 12px;
          color: rgba(255,255,255,.86);
        }
        .tr-metricValue{
          margin-top: 8px;
          display:inline-flex;
          align-items:center;
          gap:12px;
        }
        .tr-metricNum{
          font-variant-numeric: tabular-nums;
          font-weight: 1100;
          font-size: 34px;
          line-height: 1.05;
        }

        .tr-proteinHero{
          display:grid;
          grid-template-columns: 1.2fr .8fr;
          gap: 12px;
          align-items: start;
        }
        @media (max-width: 980px){
          .tr-proteinHero{ grid-template-columns: 1fr; }
        }
        .tr-proteinHeroLeft{
          border-radius: 16px;
          border: 1px solid rgba(0,170,255,.18);
          background:
            radial-gradient(620px 220px at 50% 20%, rgba(0,170,255,.12), rgba(0,0,0,0) 72%),
            linear-gradient(180deg, rgba(255,255,255,.05), rgba(0,0,0,.12));
          box-shadow:
            inset 0 0 0 1px rgba(0,0,0,.55),
            inset 0 1px 0 rgba(255,255,255,.06),
            0 22px 70px rgba(0,0,0,.42);
          padding: 14px;
        }
        .tr-proteinHeroRight{
          display:grid;
          gap: 10px;
        }
        .tr-rowbox--row{
          display:flex;
          justify-content: space-between;
          align-items:center;
          gap: 12px;
        }
        .tr-rowbox--float{
          border-color: rgba(255,255,255,.12);
          box-shadow:
            0 10px 18px rgba(0,0,0,.20),
            0 22px 70px rgba(0,0,0,.48),
            inset 0 1px 0 rgba(255,255,255,.06);
        }
      `}</style>
    </div>
  );
}
