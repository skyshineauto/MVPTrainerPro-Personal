// src/features/coach/CoachPage.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import { Card } from "../../ui/Card";
import { Button } from "../../ui/Button";

type GoalKey = "bulk" | "cut" | "strength" | "fitness";
type SymptomKey = "posture" | "shoulder_pain" | "back_pain" | "knee_pain" | "elbow_wrist";
type Mode = "goal" | "symptom";

function goalLabel(goal: string) {
  const g = (goal || "").toLowerCase();
  if (g === "build_muscle" || g === "bulk" || g === "muscle_gain") return "Muscle Gain";
  if (g === "lose_weight" || g === "cut") return "Cut";
  if (g === "strength") return "Strength";
  if (g === "fitness") return "Fitness";
  return g.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}
function symptomLabel(k: SymptomKey) {
  if (k === "posture") return "POSTURE (FORWARD HEAD + ROUNDED SHOULDERS)";
  if (k === "shoulder_pain") return "SHOULDER PAIN";
  if (k === "back_pain") return "BACK PAIN";
  if (k === "knee_pain") return "KNEE PAIN";
  if (k === "elbow_wrist") return "ELBOW / WRIST";
  return k;
}
function equipLabel(arr: string[]) {
  const hasGym = arr.includes("gym");
  const hasHome = arr.includes("home");
  if (hasGym && hasHome) return "GYM + HOME";
  if (hasGym) return "GYM";
  if (hasHome) return "HOME";
  return "GYM";
}
function fmtDate(ts?: string | null) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "2-digit", day: "2-digit", year: "numeric" });
}

type ProgramBlockRow = {
  id: string;
  status: "active" | "inactive";
  goal: string | null;
  goal_mode: string | null;
  start_date: string | null;
  end_date: string | null;
  weeks: number | null;
  created_at: string;
  intake_snapshot_id?: string | null;
};

type RpcProgramListItem = {
  id: string;
  status: "active" | "inactive";
  goal: string | null;
  created_at: string;
  sessions_count: number;
  workouts_count: number;
  completed_workouts_count: number;
};

type ToastTone = "ok" | "err";
type ToastState = { open: boolean; tone: ToastTone; text: string };

function MiniBadge({ text, tone }: { text: string; tone?: "blue" | "amber" | "red" }) {
  const border =
    tone === "amber" ? "rgba(245,158,11,.28)" : tone === "red" ? "rgba(255,80,80,.30)" : "rgba(0,170,255,.22)";
  const bg =
    tone === "amber" ? "rgba(245,158,11,.10)" : tone === "red" ? "rgba(255,80,80,.10)" : "rgba(0,170,255,.08)";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 24,
        padding: "0 10px",
        borderRadius: 999,
        border: `1px solid ${border}`,
        background: `linear-gradient(180deg, ${bg}, rgba(0,0,0,.08))`,
        fontWeight: 900,
        letterSpacing: ".08em",
        textTransform: "uppercase",
        fontSize: 10.5,
        opacity: 0.95,
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

/* =========================================================
   COACH TIPS (ONE POOL, main+quick refresh together every 15s)
   ========================================================= */
type TipCat =
  | "NUTRITION"
  | "RECOVERY"
  | "SLEEP"
  | "TRAINING"
  | "POSTURE"
  | "SHOULDERS"
  | "BACK"
  | "NECK"
  | "STRESS"
  | "WELLBEING";
type Tip = { id: string; cat: TipCat; title: string; bullets: string[]; why: string };

const TIPS: Tip[] = [
  { id: "p001", cat: "POSTURE", title: "2-minute posture reset", bullets: ["Stand tall.", "Chin slightly back.", "Shoulders down.", "5 slow breaths."], why: "Quick resets beat perfect posture all day." },
  { id: "p002", cat: "POSTURE", title: "Screen up, head back", bullets: ["Raise your screen.", "Bring it closer.", "Don’t crane your neck."], why: "Stops forward-head strain." },
  { id: "n001", cat: "NECK", title: "No phone shoulder pinch", bullets: ["Use speaker or headset.", "Keep shoulders relaxed."], why: "That pinch posture drives neck pain." },
  { id: "n002", cat: "NECK", title: "Chin tucks (easy)", bullets: ["Head straight back (not down).", "Hold 3 seconds × 5."], why: "Re-centers head position fast." },
  { id: "s001", cat: "SHOULDERS", title: "Stop shrugging during lifts", bullets: ["Shoulders away from ears.", "If traps take over, lighten weight."], why: "Shrugging loads neck/shoulders." },
  { id: "s002", cat: "SHOULDERS", title: "Neutral grip press week", bullets: ["Try neutral dumbbells.", "Keep elbows comfortable."], why: "Often reduces shoulder irritation." },
  { id: "b001", cat: "BACK", title: "Walk after sitting", bullets: ["After sitting: walk 3–5 minutes.", "Then stretch lightly."], why: "Movement reduces stiffness best." },
  { id: "b002", cat: "BACK", title: "Hips back when lifting", bullets: ["Push hips back.", "Keep load close.", "Turn with feet, not spine."], why: "Protects your back under load." },
  { id: "p003", cat: "POSTURE", title: "Desk setup win", bullets: ["Feet flat.", "Elbows supported.", "Screen at eye level."], why: "Small setup fixes big discomfort." },
  { id: "s003", cat: "SHOULDERS", title: "Warm up the shoulders", bullets: ["1–2 lighter sets first.", "Move slow.", "Stop if sharp pain."], why: "Warm tissue moves better." },
  { id: "b003", cat: "BACK", title: "Shorten range on sore days", bullets: ["Reduce range slightly.", "Keep it pain-free.", "Win the next workout."], why: "Protects joints while staying consistent." },

  { id: "t001", cat: "TRAINING", title: "Small progress rule", bullets: ["Add 2.5–5 lb OR 1–2 reps.", "Only when form stays clean."], why: "Tiny wins stack fast." },
  { id: "t002", cat: "TRAINING", title: "Bad sleep day? Go lighter", bullets: ["Shorter session.", "Keep the habit."], why: "Consistency beats hero workouts." },
  { id: "t003", cat: "TRAINING", title: "Repeat to improve", bullets: ["Keep main lifts 2–4 weeks.", "Chase small wins."], why: "Progress loves consistency." },
  { id: "t004", cat: "TRAINING", title: "Stop 1–2 reps early", bullets: ["Leave 1–2 reps in the tank.", "Avoid ugly grinders."], why: "Cleaner reps = safer progress." },
  { id: "t005", cat: "TRAINING", title: "Warm-up rule", bullets: ["Start easier than you think.", "Add weight gradually."], why: "Better performance, fewer tweaks." },

  { id: "sl001", cat: "SLEEP", title: "Same wake time", bullets: ["Keep wake time consistent.", "Even weekends (within 1 hour)."], why: "Rhythm is the cheat code for sleep." },
  { id: "sl002", cat: "SLEEP", title: "Screens off before bed", bullets: ["Dim lights.", "No phone 30 minutes before sleep."], why: "Your brain winds down faster." },
  { id: "sl003", cat: "SLEEP", title: "Cool + dark", bullets: ["Cooler room.", "Darker room."], why: "You sleep deeper when cool." },
  { id: "sl004", cat: "SLEEP", title: "Late caffeine cutoff", bullets: ["Stop caffeine earlier.", "Try decaf later."], why: "Sleep quality matters more than you think." },

  { id: "r001", cat: "RECOVERY", title: "Deload if joints complain", bullets: ["Cut sets by ~30% for one week.", "Keep movement."], why: "Short deloads prevent long flare-ups." },
  { id: "r002", cat: "RECOVERY", title: "Walk for recovery", bullets: ["10–20 min easy walk.", "Keep it easy."], why: "Light movement helps soreness." },
  { id: "w001", cat: "WELLBEING", title: "Win the next meal", bullets: ["Don’t overthink it.", "Pick a clean next meal."], why: "Momentum beats guilt." },
  { id: "w002", cat: "WELLBEING", title: "2-minute tidy", bullets: ["Clear one small area.", "Breathe and reset."], why: "Order reduces stress fast." },

  { id: "st001", cat: "STRESS", title: "60-second calm", bullets: ["Slow inhale.", "Long exhale.", "Repeat 6 times."], why: "Long exhales signal your body to relax." },
  { id: "st002", cat: "STRESS", title: "Outside reset", bullets: ["Step outside for 5 minutes.", "No phone."], why: "Fastest stress reducer." },

  { id: "nu001", cat: "NUTRITION", title: "Protein first", bullets: ["Build meals around protein.", "Then add carbs/fats."], why: "Simplest way to hit targets." },
  { id: "nu002", cat: "NUTRITION", title: "Default breakfast", bullets: ["Pick one high-protein breakfast.", "Repeat most days."], why: "Consistency beats perfection." },
  { id: "nu003", cat: "NUTRITION", title: "Easy protein snacks", bullets: ["Greek yogurt.", "Shake.", "Jerky + fruit."], why: "Prevents low-protein days." },
  { id: "nu004", cat: "NUTRITION", title: "Carbs near training", bullets: ["Carbs before or after workouts.", "Keep it simple."], why: "Helps performance and recovery." },
  { id: "nu005", cat: "NUTRITION", title: "Hydration checkpoint", bullets: ["Water with every meal.", "Extra bottle on training days."], why: "Dehydration kills performance." },
  { id: "nu006", cat: "NUTRITION", title: "Plate method", bullets: ["1/2 veggies.", "1/4 protein.", "1/4 carbs."], why: "Auto-controls intake without tracking." },
  { id: "nu007", cat: "NUTRITION", title: "Sauces matter", bullets: ["Measure oils/creamy sauces.", "Go lighter most days."], why: "Hidden calories add up." },
  { id: "nu008", cat: "NUTRITION", title: "80/20 rule", bullets: ["80% solid foods.", "20% fun foods."], why: "Keeps it sustainable." },
  { id: "nu009", cat: "NUTRITION", title: "Weekend guardrails", bullets: ["Keep protein the same.", "Walk more.", "Don’t go all-or-nothing."], why: "Stops Monday damage control." },
  { id: "nu010", cat: "NUTRITION", title: "Late-night cravings", bullets: ["Try protein first.", "Then brush teeth."], why: "Protein calms hunger fast." },
  { id: "nu011", cat: "NUTRITION", title: "Shopping shortcut", bullets: ["2 proteins.", "2 carbs.", "2 veggies.", "Repeat."], why: "Simple groceries = simple meals." },
  { id: "nu012", cat: "NUTRITION", title: "Cutting? Add volume", bullets: ["More veggies.", "Lean protein.", "Big bowls."], why: "Fullness makes cuts stick." },
  { id: "nu013", cat: "NUTRITION", title: "Bulking? Add small calories", bullets: ["Add rice, nuts, olive oil.", "Small adds daily."], why: "Big jumps usually backfire." },
  { id: "nu014", cat: "NUTRITION", title: "Don’t drink calories", bullets: ["Watch sweet coffee/juice.", "Swap to zero/low."], why: "Liquid calories don’t satisfy hunger." },
];

function catLabel(c: TipCat) {
  return c;
}

function pickRandom<T>(arr: T[]) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickMainTip(pool: Tip[], avoidIds: Set<string>): Tip {
  if (!pool.length) return { id: "x", cat: "TRAINING", title: "No tips loaded", bullets: ["Add tips to the list."], why: "—" };
  for (let i = 0; i < 30; i++) {
    const t = pickRandom(pool);
    if (!avoidIds.has(t.id)) return t;
  }
  return pickRandom(pool);
}

function pickQuickTips(pool: Tip[], count: number, avoidIds: Set<string>): Tip[] {
  const out: Tip[] = [];
  const localAvoid = new Set<string>(avoidIds);
  const max = Math.min(count, pool.length);
  let guard = 0;
  while (out.length < max && guard < 200) {
    guard++;
    const t = pickRandom(pool);
    if (localAvoid.has(t.id)) continue;
    out.push(t);
    localAvoid.add(t.id);
  }
  if (out.length < max) {
    for (const t of pool) {
      if (out.length >= max) break;
      if (localAvoid.has(t.id)) continue;
      out.push(t);
      localAvoid.add(t.id);
    }
  }
  return out;
}

export function CoachPage({ navigate }: { navigate: (to: string) => void }) {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [toast, setToast] = useState<ToastState>({ open: false, tone: "ok", text: "" });
  const toastTimer = useRef<any>(null);
  function showToast(text: string, tone: ToastTone = "ok") {
    try {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    } catch {}
    setToast({ open: true, tone, text });
    toastTimer.current = setTimeout(() => setToast((t) => ({ ...t, open: false })), 2200);
  }
  useEffect(() => {
    return () => {
      try {
        if (toastTimer.current) clearTimeout(toastTimer.current);
      } catch {}
    };
  }, []);

  const [userId, setUserId] = useState<string | null>(null);

  const [programs, setPrograms] = useState<ProgramBlockRow[]>([]);
  const [activeProgram, setActiveProgram] = useState<ProgramBlockRow | null>(null);

  const [builderOpen, setBuilderOpen] = useState(false);

  const [manageOpen, setManageOpen] = useState(false);
  const [manageLoading, setManageLoading] = useState(false);
  const [manageErr, setManageErr] = useState<string | null>(null);
  const [manageRows, setManageRows] = useState<RpcProgramListItem[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [deleteHistory, setDeleteHistory] = useState(false);
  const [confirmSelectedOpen, setConfirmSelectedOpen] = useState(false);
  const [confirmAllText, setConfirmAllText] = useState("");
  const [manageBusy, setManageBusy] = useState(false);

  const [mode, setMode] = useState<Mode | null>(null);

  const [goal, setGoal] = useState<GoalKey>("bulk");
  const [focus, setFocus] = useState<string>("");

  const [symptom, setSymptom] = useState<SymptomKey>("posture");

  const [equipGym, setEquipGym] = useState(true);
  const [equipHome, setEquipHome] = useState(false);

  const [heightFt, setHeightFt] = useState<string>("");
  const [heightIn, setHeightIn] = useState<string>("");
  const [weightLb, setWeightLb] = useState<string>("");
  const [age, setAge] = useState<string>("");

  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [switching, setSwitching] = useState(false);

  const builderRef = useRef<HTMLDivElement | null>(null);

  const equipmentArr = useMemo(() => {
    const out: string[] = [];
    if (equipGym) out.push("gym");
    if (equipHome) out.push("home");
    if (out.length === 0) out.push("gym");
    return out;
  }, [equipGym, equipHome]);

  const focusArr = useMemo(() => (focus ? [focus] : []), [focus]);

  const p_intake = useMemo(() => {
    const symptoms: Record<string, boolean> = {};
    if (mode === "symptom") symptoms[symptom] = true;

    return {
      symptoms,
      constraints: { equipment: equipmentArr },
      aesthetic_interests:
        mode === "goal"
          ? {
              goal,
              focus_muscles: focusArr,
            }
          : {},
      body: {
        height_ft: heightFt.trim() ? Number(heightFt) : null,
        height_in: heightIn.trim() ? Number(heightIn) : null,
        weight_lb: weightLb.trim() ? Number(weightLb) : null,
        age: age.trim() ? Number(age) : null,
      },
    };
  }, [mode, goal, symptom, equipmentArr, focusArr, heightFt, heightIn, weightLb, age]);

  useEffect(() => {
    if (mode === "symptom" && focus) setFocus("");
  }, [mode, focus]);

  async function ensureProfileRow() {
    const { data: u, error: uErr } = await supabase.auth.getUser();
    if (uErr) throw uErr;
    if (!u.user) throw new Error("Sign in first.");
    await supabase.from("profiles").upsert({ user_id: u.user.id }, { onConflict: "user_id" });
  }

  async function loadPrograms() {
    setMsg(null);
    setLoading(true);
    try {
      const { data: u, error: uErr } = await supabase.auth.getUser();
      if (uErr) throw uErr;
      if (!u.user) {
        setUserId(null);
        setPrograms([]);
        setActiveProgram(null);
        setBuilderOpen(true);
        return;
      }
      setUserId(u.user.id);

      const { data: rows, error } = await supabase
        .from("program_blocks")
        .select("id,status,goal,goal_mode,start_date,end_date,weeks,created_at,intake_snapshot_id")
        .eq("user_id", u.user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;

      const list = (rows ?? []) as ProgramBlockRow[];
      setPrograms(list);

      const active = list.find((x) => x.status === "active") ?? null;
      setActiveProgram(active);

      if (!active) setBuilderOpen(true);
    } catch (e: any) {
      setMsg(e?.message ?? String(e));
      showToast(e?.message ?? "Failed to load programs.", "err");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPrograms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetBuilderToDefaults() {
    setMode(null);
    setGoal("bulk");
    setSymptom("posture");
    setEquipGym(true);
    setEquipHome(false);
    setFocus("");
    setHeightFt("");
    setHeightIn("");
    setWeightLb("");
    setAge("");
  }

  function openNewProgramFlow() {
    resetBuilderToDefaults();
    setBuilderOpen(true);
    setMsg(null);
    setTimeout(() => builderRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  async function setActiveProgramBlock(blockId: string) {
    if (!userId) return;
    setMsg(null);
    setSwitching(true);
    try {
      const rpc = await supabase.rpc("rpc_program_set_active", { p_block_id: blockId });
      if (!rpc.error) {
        await loadPrograms();
        setMsg("Active program switched.");
        showToast("Active program switched.", "ok");
        return;
      }

      const { error: offErr } = await supabase.from("program_blocks").update({ status: "inactive" }).eq("user_id", userId).eq("status", "active");
      if (offErr) throw offErr;

      const { error: onErr } = await supabase.from("program_blocks").update({ status: "active" }).eq("user_id", userId).eq("id", blockId);
      if (onErr) throw onErr;

      await loadPrograms();
      setMsg("Active program switched.");
      showToast("Active program switched.", "ok");
    } catch (e: any) {
      setMsg(e?.message ?? String(e));
      showToast(e?.message ?? "Failed to switch program.", "err");
    } finally {
      setSwitching(false);
    }
  }

  async function saveIntake() {
    setMsg(null);
    setSaving(true);
    try {
      await ensureProfileRow();
      if (!mode) throw new Error("Pick Goal Program or Fix a Symptom first.");

      const { error } = await supabase.rpc("rpc_intake_save", { p_intake });
      if (error) throw error;

      setMsg("Saved.");
      showToast("Intake saved.", "ok");
    } catch (e: any) {
      const m = e?.message ?? String(e);
      setMsg(m);
      showToast(m || "Save failed.", "err");
    } finally {
      setSaving(false);
    }
  }

  async function generateProgram() {
    setMsg(null);
    setGenerating(true);
    try {
      await ensureProfileRow();
      if (!mode) throw new Error("Pick Goal Program or Fix a Symptom first.");

      const { error } = await supabase.rpc("rpc_generate_program_from_intake", {
        p_intake,
        p_weeks: 4,
        p_days_ahead: 14,
      });
      if (error) throw error;

      setMsg("Program generated.");
      showToast("Program generated.", "ok");
      await loadPrograms();
      navigate("/");
    } catch (e: any) {
      const m = e?.message ?? String(e);
      setMsg(m);
      showToast(m || "Generate failed.", "err");
    } finally {
      setGenerating(false);
    }
  }

  const activeProgramSummary = useMemo(() => {
    if (!activeProgram) return null;
    const modeStr = activeProgram.goal_mode || "";
    const isSym = modeStr.includes("symptom");
    const isGoal = modeStr.includes("goal");
    return {
      created: activeProgram.created_at,
      weeks: activeProgram.weeks ?? 4,
      kind: isSym ? "Symptom" : isGoal ? "Goal" : "Program",
      goal: activeProgram.goal ?? "—",
      start: activeProgram.start_date,
      end: activeProgram.end_date,
    };
  }, [activeProgram]);

  const canGenerate = useMemo(() => {
    if (!builderOpen) return false;
    if (!mode) return false;
    return true;
  }, [builderOpen, mode]);

  const selectedIds = useMemo(() => Object.keys(selected).filter((k) => selected[k]), [selected]);
  const anySelected = selectedIds.length > 0;

  const selectedRows = useMemo(() => {
    const map = new Map(manageRows.map((r) => [r.id, r]));
    return selectedIds.map((id) => map.get(id)).filter(Boolean) as RpcProgramListItem[];
  }, [manageRows, selectedIds]);

  async function loadManagePrograms() {
    setManageLoading(true);
    setManageErr(null);
    try {
      const { data: u, error: uErr } = await supabase.auth.getUser();
      if (uErr) throw uErr;
      if (!u.user) throw new Error("Sign in first.");

      const { data, error } = await supabase.rpc("rpc_programs_list");
      if (error) throw error;

      const rows = ((data as any)?.programs ?? []) as RpcProgramListItem[];
      setManageRows(rows);
      setSelected({});
    } catch (e: any) {
      setManageErr(e?.message ?? String(e));
    } finally {
      setManageLoading(false);
    }
  }

  function openManage() {
    setManageOpen(true);
    setDeleteHistory(false);
    setConfirmAllText("");
    setConfirmSelectedOpen(false);
    void loadManagePrograms();
  }

  function toggleAll(next: boolean) {
    const map: Record<string, boolean> = {};
    for (const r of manageRows) map[r.id] = next;
    setSelected(map);
  }

  function beginDeleteSelected() {
    if (!anySelected) {
      showToast("Select at least one program.", "err");
      return;
    }
    setConfirmSelectedOpen(true);
  }

  async function confirmDeleteSelected() {
    if (!anySelected) return;

    setManageBusy(true);
    setManageErr(null);
    try {
      const { error } = await supabase.rpc("rpc_programs_delete_selected", {
        p_program_ids: selectedIds,
        p_delete_history: deleteHistory,
      });
      if (error) throw error;

      showToast(deleteHistory ? "Deleted selected programs + history." : "Deleted selected programs.", "ok");
      setConfirmSelectedOpen(false);

      await loadPrograms();
      await loadManagePrograms();
    } catch (e: any) {
      setManageErr(e?.message ?? String(e));
      showToast(e?.message ?? "Delete failed.", "err");
    } finally {
      setManageBusy(false);
    }
  }

  async function doResetAll() {
    if (confirmAllText.trim().toUpperCase() !== "DELETE ALL") {
      showToast('Type "DELETE ALL" to confirm.', "err");
      return;
    }

    setManageBusy(true);
    setManageErr(null);
    try {
      const { error } = await supabase.rpc("rpc_programs_reset", { p_delete_history: deleteHistory });
      if (error) throw error;

      showToast(deleteHistory ? "Clean slate + history cleared." : "Clean slate done.", "ok");

      setConfirmAllText("");
      setSelected({});
      setConfirmSelectedOpen(false);

      await loadPrograms();
      await loadManagePrograms();
    } catch (e: any) {
      setManageErr(e?.message ?? String(e));
      showToast(e?.message ?? "Reset failed.", "err");
    } finally {
      setManageBusy(false);
    }
  }

  const mainHistoryRef = useRef<string[]>([]);
  const quickHistoryRef = useRef<string[]>([]);
  const [tipKey, setTipKey] = useState(0);

  const [mainTip, setMainTip] = useState<Tip>(() => pickRandom(TIPS));
  const [quickTips, setQuickTips] = useState<Tip[]>(() => {
    const avoid = new Set<string>([mainTip.id]);
    return pickQuickTips(TIPS, 3, avoid);
  });

  useEffect(() => {
    mainHistoryRef.current = [mainTip.id];
    quickHistoryRef.current = quickTips.map((t) => t.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      const mainAvoid = new Set<string>(mainHistoryRef.current.slice(-10));
      const nextMain = pickMainTip(TIPS, mainAvoid);

      const quickAvoid = new Set<string>([
        nextMain.id,
        ...quickHistoryRef.current.slice(-12),
      ]);
      const nextQuick = pickQuickTips(TIPS, 3, quickAvoid);

      setMainTip(nextMain);
      setQuickTips(nextQuick);
      setTipKey((k) => k + 1);

      mainHistoryRef.current = [...mainHistoryRef.current, nextMain.id].slice(-14);
      quickHistoryRef.current = [...quickHistoryRef.current, ...nextQuick.map((t) => t.id)].slice(-18);
    }, 15000);

    return () => window.clearInterval(id);
  }, []);

  return (
    <div style={{ display: "grid", gap: 14, position: "relative" }}>
      {toast.open ? (
        <div style={{ position: "fixed", right: 18, bottom: 86, zIndex: 9999, width: "min(420px, calc(100vw - 36px))" }}>
          <div
            className="tr-rowbox"
            style={{
              borderColor: toast.tone === "ok" ? "rgba(0,170,255,.45)" : "rgba(255,80,80,.45)",
              background: toast.tone === "ok" ? "rgba(0,170,255,.12)" : "rgba(255,80,80,.12)",
              fontWeight: 950,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 10,
            }}
          >
            <div>{toast.text}</div>
            <button className="tr-seg" style={{ height: 36 }} onClick={() => setToast((t) => ({ ...t, open: false }))}>
              OK
            </button>
          </div>
        </div>
      ) : null}

      {manageOpen ? (
        <div className="tr-modalOverlay">
          <div className="tr-modal">
            <div className="tr-modalHead">
              <div style={{ fontWeight: 950 }}>
                Manage Programs <span className="tr-sub">({manageRows.length})</span>
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button className="tr-btn tr-btn--blueOutline" style={{ height: 44 }} onClick={loadManagePrograms} disabled={manageBusy || manageLoading}>
                  Refresh
                </button>
                <button className="tr-btn" style={{ height: 44 }} onClick={() => setManageOpen(false)} disabled={manageBusy}>
                  Close
                </button>
              </div>
            </div>

            <div style={{ padding: 16, display: "grid", gap: 12 }}>
              {manageErr ? (
                <div className="tr-rowbox" style={{ borderColor: "rgba(255,80,80,.35)", background: "rgba(255,80,80,.10)", fontWeight: 900 }}>
                  {manageErr}
                </div>
              ) : null}

              <div className="tr-rowbox" style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <div style={{ display: "grid", gap: 4 }}>
                    <div className="tr-kicker">DELETE OPTIONS</div>
                    <div className="tr-sub">
                      Select programs → <b>Delete Selected</b>. “Delete All” is separate and requires a stronger confirm.
                    </div>
                  </div>

                  <label className="tr-rowbox" style={{ display: "flex", gap: 10, alignItems: "center", padding: 10 }}>
                    <input type="checkbox" checked={deleteHistory} onChange={(e) => setDeleteHistory(e.target.checked)} disabled={manageBusy} />
                    <div style={{ display: "grid", gap: 2 }}>
                      <div style={{ fontWeight: 950 }}>Also delete workout history</div>
                      <div className="tr-sub">Deletes workouts + sets linked to the selected programs.</div>
                    </div>
                  </label>
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <button className="tr-seg" onClick={() => toggleAll(true)} disabled={manageBusy || manageLoading || !manageRows.length}>
                    Select all
                  </button>
                  <button className="tr-seg" onClick={() => toggleAll(false)} disabled={manageBusy || manageLoading || !manageRows.length}>
                    Select none
                  </button>

                  <div style={{ marginLeft: "auto", display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button
                      className="tr-btn tr-btn--primary"
                      style={{ height: 48, minWidth: 240 }}
                      onClick={beginDeleteSelected}
                      disabled={manageBusy || manageLoading || !anySelected}
                      title={!anySelected ? "Select at least one program" : "Review + confirm delete"}
                    >
                      {manageBusy ? "Working…" : `DELETE SELECTED (${selectedIds.length})`}
                    </button>
                  </div>
                </div>

                <div className="tr-sub" style={{ opacity: 0.9 }}>
                  Selected items will be shown for confirmation before deletion.
                </div>
              </div>

              <Card title="Programs" tone="base">
                {manageLoading ? (
                  <div className="tr-sub">Loading…</div>
                ) : !manageRows.length ? (
                  <div className="tr-sub">No programs found.</div>
                ) : (
                  <div style={{ display: "grid", gap: 10, maxHeight: 360, overflow: "auto", paddingRight: 4 }}>
                    {manageRows.map((r) => {
                      const checked = !!selected[r.id];
                      const isActive = r.status === "active";
                      return (
                        <div key={r.id} className="tr-rowbox" style={{ display: "grid", gap: 10 }}>
                          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 12, alignItems: "center" }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => setSelected((prev) => ({ ...prev, [r.id]: e.target.checked }))}
                              disabled={manageBusy}
                              style={{ width: 18, height: 18 }}
                            />

                            <div style={{ display: "grid", gap: 4 }}>
                              <div style={{ fontWeight: 950, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                                {goalLabel(r.goal ?? "—")}
                                <MiniBadge text={isActive ? "ACTIVE" : "INACTIVE"} tone={isActive ? "blue" : "amber"} />
                                <MiniBadge text={`SESSIONS ${r.sessions_count ?? 0}`} />
                                <MiniBadge text={`WORKOUTS ${r.workouts_count ?? 0}`} />
                                <MiniBadge text={`DONE ${r.completed_workouts_count ?? 0}`} />
                              </div>
                              <div className="tr-sub">Created {fmtDate(r.created_at)} • id {r.id.slice(0, 8)}…</div>
                            </div>

                            <button
                              className={`tr-seg ${isActive ? "is-active" : ""}`}
                              disabled={switching || isActive || manageBusy}
                              onClick={async () => {
                                await setActiveProgramBlock(r.id);
                                await loadManagePrograms();
                              }}
                            >
                              {isActive ? "ACTIVE" : "SET ACTIVE"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>

              {confirmSelectedOpen ? (
                <div className="tr-modalOverlay" style={{ zIndex: 1005 }}>
                  <div className="tr-modal" style={{ width: "min(760px, 100%)" }}>
                    <div className="tr-modalHead">
                      <div style={{ fontWeight: 950 }}>Confirm delete selected</div>
                      <button className="tr-btn" style={{ height: 44 }} onClick={() => setConfirmSelectedOpen(false)} disabled={manageBusy}>
                        Back
                      </button>
                    </div>

                    <div style={{ padding: 16, display: "grid", gap: 12 }}>
                      <div className="tr-rowbox" style={{ borderColor: "rgba(255,140,0,.28)", background: "rgba(255,140,0,.08)" }}>
                        <div style={{ fontWeight: 950 }}>
                          You are about to delete <b>{selectedRows.length}</b> program(s).
                        </div>
                        <div className="tr-sub" style={{ marginTop: 6 }}>
                          {deleteHistory ? (
                            <span style={{ color: "rgba(255,120,120,.95)", fontWeight: 900 }}>Workout history WILL be deleted for these programs.</span>
                          ) : (
                            <span>Workout history will be kept.</span>
                          )}
                        </div>
                      </div>

                      <div className="tr-rowbox" style={{ display: "grid", gap: 8, maxHeight: 320, overflow: "auto" }}>
                        {selectedRows.map((r) => (
                          <div key={r.id} className="tr-rowbox" style={{ padding: 10, display: "grid", gap: 4 }}>
                            <div style={{ fontWeight: 950, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                              {goalLabel(r.goal ?? "—")}
                              <MiniBadge text={`SESSIONS ${r.sessions_count ?? 0}`} />
                              <MiniBadge text={`WORKOUTS ${r.workouts_count ?? 0}`} />
                              <MiniBadge text={`DONE ${r.completed_workouts_count ?? 0}`} />
                            </div>
                            <div className="tr-sub">Created {fmtDate(r.created_at)} • id {r.id.slice(0, 8)}…</div>
                          </div>
                        ))}
                      </div>

                      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
                        <button className="tr-btn" style={{ height: 46 }} onClick={() => setConfirmSelectedOpen(false)} disabled={manageBusy}>
                          Cancel
                        </button>

                        <button
                          className="tr-btn"
                          style={{
                            height: 46,
                            borderColor: "rgba(255,80,80,.55)",
                            background: "linear-gradient(180deg, rgba(255,80,80,.18), rgba(0,0,0,.12))",
                            fontWeight: 950,
                          }}
                          onClick={confirmDeleteSelected}
                          disabled={manageBusy}
                        >
                          {manageBusy ? "Deleting…" : `CONFIRM DELETE (${selectedRows.length})`}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="tr-rowbox" style={{ borderColor: "rgba(255,80,80,.22)", background: "rgba(255,80,80,.06)", display: "grid", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
                  <div style={{ display: "grid", gap: 4 }}>
                    <div className="tr-kicker">DANGER ZONE</div>
                    <div className="tr-sub">
                      Delete ALL programs for this user. Type <b>DELETE ALL</b> to enable.
                    </div>
                  </div>

                  <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap" }}>
                    <input value={confirmAllText} onChange={(e) => setConfirmAllText(e.target.value)} placeholder="Type DELETE ALL" style={{ height: 40, width: 190 }} disabled={manageBusy} />
                    <button
                      className="tr-seg"
                      style={{
                        height: 40,
                        borderColor: confirmAllText.trim().toUpperCase() === "DELETE ALL" ? "rgba(255,80,80,.55)" : "rgba(255,255,255,.12)",
                        background:
                          confirmAllText.trim().toUpperCase() === "DELETE ALL"
                            ? "linear-gradient(180deg, rgba(255,80,80,.16), rgba(0,0,0,.12))"
                            : "linear-gradient(180deg, rgba(255,255,255,.05), rgba(0,0,0,.12))",
                        fontWeight: 950,
                        minWidth: 120,
                      }}
                      onClick={doResetAll}
                      disabled={manageBusy || confirmAllText.trim().toUpperCase() !== "DELETE ALL"}
                      title="Deletes all programs for this user"
                    >
                      DELETE ALL
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <Card
        title="Coach"
        tone="blue"
        right={
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button className="tr-seg" onClick={openManage}>
              MANAGE
            </button>
            <span className="tr-kicker">PROGRAMS</span>
          </div>
        }
      >
        {msg ? (
          <div
            className="tr-rowbox"
            style={{
              borderColor:
                msg.toLowerCase().includes("saved") ||
                msg.toLowerCase().includes("generated") ||
                msg.toLowerCase().includes("switched")
                  ? "rgba(0,170,255,.35)"
                  : "rgba(255,80,80,.35)",
              background:
                msg.toLowerCase().includes("saved") ||
                msg.toLowerCase().includes("generated") ||
                msg.toLowerCase().includes("switched")
                  ? "rgba(0,170,255,.10)"
                  : "rgba(255,80,80,.10)",
              fontWeight: 900,
            }}
          >
            {msg}
          </div>
        ) : null}

        {loading ? <div className="tr-sub">Loading…</div> : null}

        <div className="tr-rowbox" style={{ display: "grid", gap: 10, marginTop: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div>
              <div className="tr-kicker">ACTIVE PROGRAM</div>
              <div style={{ fontWeight: 950, fontSize: 18 }}>
                {activeProgramSummary ? `${activeProgramSummary.kind}: ${goalLabel(activeProgramSummary.goal)}` : "None"}
              </div>
              <div className="tr-sub" style={{ marginTop: 4 }}>
                {activeProgramSummary
                  ? `Created ${fmtDate(activeProgramSummary.created)} • ${activeProgramSummary.weeks} weeks • ${
                      activeProgramSummary.start ? fmtDate(activeProgramSummary.start) : "—"
                    } → ${activeProgramSummary.end ? fmtDate(activeProgramSummary.end) : "—"}`
                  : "Create your first program below."}
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
              <button className="tr-seg" onClick={() => navigate("/")} disabled={!activeProgram}>
                GO TO WORKOUTS
              </button>

              <button className="tr-seg tr-seg--start" onClick={openNewProgramFlow}>
                START NEW PROGRAM
              </button>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <div className="tr-kicker">PROGRAMS</div>
          <div className="tr-rowbox tr-programList" style={{ display: "grid", gap: 0, marginTop: 8, padding: 0, overflow: "hidden" }}>
            {programs.length ? (
              programs.slice(0, 40).map((p, idx) => {
                const isActive = p.status === "active";
                const kind = (p.goal_mode || "").includes("symptom") ? "Symptom" : (p.goal_mode || "").includes("goal") ? "Goal" : "Program";
                return (
                  <div
                    key={p.id}
                    className={`tr-programRow ${idx % 2 === 0 ? "is-even" : "is-odd"} ${isActive ? "is-activeRow" : ""}`}
                    style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center" }}
                  >
                    <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
                      <div style={{ fontWeight: 950, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                        <span className="tr-programRail" aria-hidden />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {kind}: {goalLabel(p.goal ?? "—")}
                        </span>
                        {isActive ? <MiniBadge text="ACTIVE" tone="blue" /> : <MiniBadge text="INACTIVE" tone="amber" />}
                      </div>
                      <div className="tr-sub" style={{ lineHeight: 1.35 }}>
                        {p.start_date ? fmtDate(p.start_date) : "—"} → {p.end_date ? fmtDate(p.end_date) : "—"} • {p.weeks ?? 4} weeks
                        <span style={{ opacity: 0.86 }}> • Created {fmtDate(p.created_at)}</span>
                      </div>
                    </div>

                    <button className={`tr-seg ${isActive ? "is-active" : ""}`} disabled={switching || isActive} onClick={() => setActiveProgramBlock(p.id)}>
                      {isActive ? "ACTIVE" : "SET ACTIVE"}
                    </button>
                  </div>
                );
              })
            ) : (
              <div className="tr-sub" style={{ padding: 12 }}>
                No programs yet.
              </div>
            )}
          </div>
        </div>
      </Card>

      {builderOpen ? (
        <div ref={builderRef} style={{ display: "grid", gap: 14 }}>
          <Card
            title="Program Builder"
            tone="blue"
            right={
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <MiniBadge text={mode ? (mode === "goal" ? "GOAL MODE" : "SYMPTOM MODE") : "PICK MODE"} tone={mode ? "blue" : "amber"} />
                <button className="tr-seg" onClick={() => setBuilderOpen(false)}>
                  COLLAPSE
                </button>
              </div>
            }
          >
            <div style={{ display: "grid", gap: 12 }}>
              <div className="tr-rowbox" style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "grid", gap: 4 }}>
                  <div className="tr-kicker">STEP 1</div>
                  <div style={{ fontWeight: 950, fontSize: 18 }}>Choose your program path</div>
                  <div className="tr-sub">Pick one route. Goal mode builds around performance. Symptom mode builds around moving better.</div>
                </div>

                <div className="tr-coachChoiceGrid">
                  <button
                    type="button"
                    className={`tr-coachChoice ${mode === "goal" ? "is-active" : ""}`}
                    onClick={() => setMode("goal")}
                  >
                    <div className="tr-coachChoiceKicker">GOAL PROGRAM</div>
                    <div className="tr-coachChoiceTitle">Build around your target</div>
                    <div className="tr-coachChoiceSub">Muscle gain, cut, strength, or fitness.</div>
                  </button>

                  <button
                    type="button"
                    className={`tr-coachChoice ${mode === "symptom" ? "is-active" : ""}`}
                    onClick={() => setMode("symptom")}
                  >
                    <div className="tr-coachChoiceKicker">FIX A SYMPTOM</div>
                    <div className="tr-coachChoiceTitle">Train around what hurts</div>
                    <div className="tr-coachChoiceSub">Posture, shoulder, back, knee, elbow, wrist.</div>
                  </button>
                </div>
              </div>

              {mode === "goal" ? (
                <div className="tr-rowbox" style={{ display: "grid", gap: 12 }}>
                  <div style={{ display: "grid", gap: 4 }}>
                    <div className="tr-kicker">STEP 2A</div>
                    <div style={{ fontWeight: 950, fontSize: 18 }}>Goal setup</div>
                  </div>

                  <div style={{ display: "grid", gap: 8 }}>
                    <div className="tr-kicker">GOAL</div>
                    <div className="tr-chipRow">
                      {(["bulk", "cut", "strength", "fitness"] as GoalKey[]).map((g) => (
                        <button
                          key={g}
                          className={`tr-seg ${goal === g ? "is-active" : ""}`}
                          onClick={() => setGoal(g)}
                          type="button"
                        >
                          {goalLabel(g)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: "grid", gap: 8 }}>
                    <div className="tr-kicker">OPTIONAL FOCUS</div>
                    <div className="tr-chipRow tr-chipRow--wrap">
                      {[
                        { key: "", label: "NONE" },
                        { key: "chest", label: "CHEST" },
                        { key: "back", label: "BACK" },
                        { key: "shoulders", label: "SHOULDERS" },
                        { key: "arms", label: "ARMS" },
                        { key: "legs", label: "LEGS" },
                        { key: "glutes", label: "GLUTES" },
                        { key: "core", label: "CORE" },
                      ].map((f) => (
                        <button
                          key={f.key || "none"}
                          className={`tr-seg ${focus === f.key ? "is-active" : ""}`}
                          onClick={() => setFocus(f.key)}
                          type="button"
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                    <div className="tr-sub">Optional. Leave blank to let the program balance itself.</div>
                  </div>
                </div>
              ) : null}

              {mode === "symptom" ? (
                <div className="tr-rowbox" style={{ display: "grid", gap: 12 }}>
                  <div style={{ display: "grid", gap: 4 }}>
                    <div className="tr-kicker">STEP 2B</div>
                    <div style={{ fontWeight: 950, fontSize: 18 }}>Symptom setup</div>
                  </div>

                  <div className="tr-chipRow tr-chipRow--wrap">
                    {(["posture", "shoulder_pain", "back_pain", "knee_pain", "elbow_wrist"] as SymptomKey[]).map((s) => (
                      <button
                        key={s}
                        className={`tr-seg ${symptom === s ? "is-active" : ""}`}
                        onClick={() => setSymptom(s)}
                        type="button"
                      >
                        {symptomLabel(s)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="tr-rowbox" style={{ display: "grid", gap: 12 }}>
                <div style={{ display: "grid", gap: 4 }}>
                  <div className="tr-kicker">STEP 3</div>
                  <div style={{ fontWeight: 950, fontSize: 18 }}>Equipment</div>
                  <div className="tr-sub">Pick what you want the generator to use.</div>
                </div>

                <div className="tr-chipRow">
                  <button
                    className={`tr-seg ${equipGym ? "is-active" : ""}`}
                    type="button"
                    onClick={() => setEquipGym((v) => !v)}
                  >
                    GYM
                  </button>
                  <button
                    className={`tr-seg ${equipHome ? "is-active" : ""}`}
                    type="button"
                    onClick={() => setEquipHome((v) => !v)}
                  >
                    HOME
                  </button>
                </div>

                <div className="tr-sub">Selected: <b>{equipLabel(equipmentArr)}</b></div>
              </div>

              <div className="tr-rowbox" style={{ display: "grid", gap: 12 }}>
                <div style={{ display: "grid", gap: 4 }}>
                  <div className="tr-kicker">STEP 4</div>
                  <div style={{ fontWeight: 950, fontSize: 18 }}>Body stats</div>
                  <div className="tr-sub">Recommended so protein targets and progress tracking behave correctly.</div>
                </div>

                <div className="tr-bodyGrid">
                  <label className="tr-field">
                    <span className="tr-kicker">HEIGHT FT</span>
                    <input value={heightFt} onChange={(e) => setHeightFt(e.target.value.replace(/[^\d]/g, ""))} placeholder="5" />
                  </label>

                  <label className="tr-field">
                    <span className="tr-kicker">HEIGHT IN</span>
                    <input value={heightIn} onChange={(e) => setHeightIn(e.target.value.replace(/[^\d]/g, ""))} placeholder="10" />
                  </label>

                  <label className="tr-field">
                    <span className="tr-kicker">WEIGHT LB</span>
                    <input value={weightLb} onChange={(e) => setWeightLb(e.target.value.replace(/[^\d.]/g, ""))} placeholder="185" />
                  </label>

                  <label className="tr-field">
                    <span className="tr-kicker">AGE</span>
                    <input value={age} onChange={(e) => setAge(e.target.value.replace(/[^\d]/g, ""))} placeholder="46" />
                  </label>
                </div>
              </div>

              <div className="tr-rowbox" style={{ display: "grid", gap: 10 }}>
                <div className="tr-kicker">SUMMARY</div>
                <div className="tr-summaryGrid">
                  <div className="tr-summaryCell">
                    <div className="tr-summaryLabel">Mode</div>
                    <div className="tr-summaryValue">{mode ? (mode === "goal" ? "Goal Program" : "Symptom Program") : "Not selected"}</div>
                  </div>
                  <div className="tr-summaryCell">
                    <div className="tr-summaryLabel">{mode === "symptom" ? "Symptom" : "Goal"}</div>
                    <div className="tr-summaryValue">
                      {mode === "symptom" ? symptomLabel(symptom) : goalLabel(goal)}
                    </div>
                  </div>
                  <div className="tr-summaryCell">
                    <div className="tr-summaryLabel">Equipment</div>
                    <div className="tr-summaryValue">{equipLabel(equipmentArr)}</div>
                  </div>
                  <div className="tr-summaryCell">
                    <div className="tr-summaryLabel">Focus</div>
                    <div className="tr-summaryValue">{focus ? goalLabel(focus) : "Auto"}</div>
                  </div>
                </div>
              </div>

              <div className="tr-builderActions">
                <button className="tr-btn" style={{ height: 50 }} onClick={saveIntake} disabled={!mode || saving || generating}>
                  {saving ? "Saving…" : "SAVE INTAKE"}
                </button>

                <button
                  className="tr-btn tr-btn--primary"
                  style={{ height: 54 }}
                  onClick={generateProgram}
                  disabled={!canGenerate || saving || generating}
                >
                  {generating ? "GENERATING…" : "GENERATE PROGRAM"}
                </button>
              </div>
            </div>
          </Card>
        </div>
      ) : null}

      <Card title="Coach Tip Console" tone="base">
        <div className="tr-coachTipConsole">
          <div className="tr-coachTipImageBay">
            <img src="/coach.png" alt="Coach" className="tr-coachTipImg" />
            <div className="tr-coachTipScrim" aria-hidden />
            <div className="tr-coachTipSheen" aria-hidden />

            <div key={`main-${tipKey}`} className="tr-coachTipPlate">
              <div className="tr-coachTipPlateTop">
                <div className="tr-coachTipLive">COACH TIP</div>
                <div className="tr-coachTipCat">{catLabel(mainTip.cat)}</div>
              </div>

              <div className="tr-coachTipTitle">{mainTip.title}</div>

              <ul className="tr-coachTipBullets">
                {mainTip.bullets.slice(0, 4).map((b, i) => (
                  <li key={`${mainTip.id}-b-${i}`}>{b}</li>
                ))}
              </ul>

              <div className="tr-coachTipWhy">{mainTip.why}</div>
            </div>

            <div className="tr-coachDockRail">
              <div className="tr-coachDockInner">
                <div className="tr-coachDockLabel">ACTIONS</div>
                <div className="tr-coachDockBtns">
                  <Button onClick={() => navigate("/")}>Go to Workouts</Button>
                  <Button variant="secondary" onClick={loadPrograms} disabled={loading}>
                    Refresh Programs
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div className="tr-coachTipRight">
            <div className="tr-coachTipRightHead">
              <div className="tr-kicker">QUICK TIPS</div>
            </div>

            <div className="tr-coachTipStack">
              {quickTips.map((t, idx) => (
                <div key={`${t.id}-${tipKey}`} className={`tr-coachQuickTip ${idx % 2 === 0 ? "is-even" : "is-odd"}`}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <div className="tr-coachQuickTipCat">{catLabel(t.cat)}</div>
                    <div className="tr-coachQuickTipPill">TIP</div>
                  </div>
                  <div className="tr-coachQuickTipText">{t.title}</div>
                  <div className="tr-coachQuickTipSub">{t.bullets[0] ?? ""}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <style>{`
        .tr-programList{ border-radius: 14px; }
        .tr-programRow{
          padding: 12px;
          border-top: 1px solid rgba(255,255,255,.06);
        }
        .tr-programRow:first-child{ border-top: none; }
        .tr-programRow.is-even{
          background: linear-gradient(180deg, rgba(255,255,255,.045), rgba(0,0,0,.10));
        }
        .tr-programRow.is-odd{
          background: linear-gradient(180deg, rgba(0,170,255,.06), rgba(0,0,0,.12));
        }
        .tr-programRow.is-activeRow{
          box-shadow: inset 0 0 0 1px rgba(0,170,255,.14);
        }
        .tr-programRail{
          width: 10px;
          height: 10px;
          border-radius: 999px;
          background: rgba(255,255,255,.18);
          box-shadow: 0 0 0 1px rgba(0,0,0,.55) inset;
        }
        .tr-programRow.is-activeRow .tr-programRail{
          background: rgba(0,170,255,.85);
          box-shadow: 0 0 16px rgba(0,170,255,.18), 0 0 0 1px rgba(0,0,0,.55) inset;
        }
        .tr-seg--start{
          border-color: rgba(0,170,255,.55);
          background: linear-gradient(180deg, rgba(0,170,255,.16), rgba(0,0,0,.12));
        }

        .tr-coachChoiceGrid{
          display:grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }
        @media (max-width: 860px){
          .tr-coachChoiceGrid{ grid-template-columns: 1fr; }
        }
        .tr-coachChoice{
          border-radius: 18px;
          border: 1px solid rgba(255,255,255,.12);
          background:
            linear-gradient(180deg, rgba(255,255,255,.05), rgba(0,0,0,.12)),
            radial-gradient(520px 180px at 50% 0%, rgba(0,170,255,.08), rgba(0,0,0,0) 70%);
          box-shadow: inset 0 1px 0 rgba(255,255,255,.05), 0 18px 55px rgba(0,0,0,.34);
          padding: 16px;
          display:grid;
          gap: 8px;
          text-align:left;
          cursor:pointer;
          transition: transform .12s ease, border-color .12s ease, box-shadow .12s ease, filter .12s ease;
        }
        .tr-coachChoice:hover{
          transform: translateY(-1px);
          border-color: rgba(0,170,255,.28);
          box-shadow: inset 0 1px 0 rgba(255,255,255,.05), 0 22px 70px rgba(0,0,0,.42), 0 0 16px rgba(0,170,255,.08);
        }
        .tr-coachChoice.is-active{
          border-color: rgba(0,170,255,.46);
          box-shadow: inset 0 1px 0 rgba(255,255,255,.07), 0 22px 70px rgba(0,0,0,.42), 0 0 22px rgba(0,170,255,.12);
          filter: saturate(1.04);
        }
        .tr-coachChoiceKicker{
          font-weight: 1000;
          letter-spacing: .18em;
          text-transform: uppercase;
          font-size: 11px;
          color: rgba(205,230,255,.86);
        }
        .tr-coachChoiceTitle{
          font-weight: 1050;
          font-size: 22px;
          line-height: 1.06;
          color: rgba(244,247,255,.95);
        }
        .tr-coachChoiceSub{
          color: rgba(205,230,255,.72);
          line-height: 1.42;
          font-weight: 800;
        }

        .tr-chipRow{
          display:flex;
          gap:10px;
          flex-wrap:wrap;
          align-items:center;
        }
        .tr-chipRow--wrap{
          flex-wrap:wrap;
        }

        .tr-bodyGrid{
          display:grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
        }
        @media (max-width: 980px){
          .tr-bodyGrid{ grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 620px){
          .tr-bodyGrid{ grid-template-columns: 1fr; }
        }

        .tr-field{
          display:grid;
          gap: 8px;
        }
        .tr-field input{
          height: 48px;
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,.12);
          background: linear-gradient(180deg, rgba(255,255,255,.05), rgba(0,0,0,.12));
          color: rgba(255,255,255,.94);
          padding: 0 14px;
          font-weight: 900;
          box-shadow: inset 0 1px 0 rgba(255,255,255,.04);
        }

        .tr-summaryGrid{
          display:grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        @media (max-width: 760px){
          .tr-summaryGrid{ grid-template-columns: 1fr; }
        }
        .tr-summaryCell{
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,.10);
          background: linear-gradient(180deg, rgba(255,255,255,.045), rgba(0,0,0,.10));
          box-shadow: inset 0 1px 0 rgba(255,255,255,.05);
          padding: 12px;
          display:grid;
          gap: 6px;
        }
        .tr-summaryLabel{
          font-weight: 1000;
          letter-spacing: .14em;
          text-transform: uppercase;
          font-size: 11px;
          color: rgba(205,230,255,.78);
        }
        .tr-summaryValue{
          font-weight: 950;
          line-height: 1.32;
          color: rgba(244,247,255,.95);
        }

        .tr-builderActions{
          display:grid;
          grid-template-columns: minmax(180px, .8fr) minmax(220px, 1.2fr);
          gap: 12px;
        }
        @media (max-width: 760px){
          .tr-builderActions{ grid-template-columns: 1fr; }
        }

        .tr-coachTipConsole{
          display:grid;
          grid-template-columns: 1.25fr .75fr;
          gap: 12px;
          align-items: stretch;
        }
        @media (max-width: 980px){
          .tr-coachTipConsole{ grid-template-columns: 1fr; }
        }

        .tr-coachTipImageBay{
          position: relative;
          border-radius: 18px;
          border: 1px solid rgba(0,170,255,.18);
          overflow: hidden;
          min-height: 390px;
          background: rgba(0,0,0,.25);
          box-shadow:
            inset 0 0 0 1px rgba(0,0,0,.55),
            inset 0 1px 0 rgba(255,255,255,.06),
            0 26px 90px rgba(0,0,0,.62),
            0 0 22px rgba(0,170,255,.10);
        }
        @media (max-width: 520px){
          .tr-coachTipImageBay{ min-height: 320px; }
        }

        .tr-coachTipImg{
          position:absolute;
          inset:0;
          width:100%;
          height:100%;
          object-fit: cover;
          object-position: center 20%;
          transform: none !important;
          filter: none !important;
          image-rendering: auto;
        }

        .tr-coachTipScrim{
          position:absolute;
          inset:0;
          pointer-events:none;
          background:
            radial-gradient(1200px 520px at 50% 50%, rgba(0,0,0,0) 0%, rgba(0,0,0,.45) 66%, rgba(0,0,0,.70) 100%),
            linear-gradient(180deg, rgba(0,0,0,.22), rgba(0,0,0,.74)),
            radial-gradient(900px 520px at 24% 22%, rgba(0,170,255,.14), rgba(0,0,0,0) 62%),
            radial-gradient(800px 420px at 78% 78%, rgba(255,140,0,.10), rgba(0,0,0,0) 64%);
        }

        .tr-coachTipSheen{
          position:absolute;
          inset:0;
          pointer-events:none;
          opacity: .35;
          background:
            linear-gradient(180deg, rgba(255,255,255,.14), rgba(255,255,255,0) 38%),
            linear-gradient(115deg, rgba(255,255,255,0) 0%, rgba(255,255,255,.10) 46%, rgba(255,255,255,.03) 54%, rgba(255,255,255,0) 68%);
          mix-blend-mode: screen;
        }

        .tr-coachTipPlate{
          position:absolute;
          left: 18px;
          top: 50%;
          transform: translateY(-50%);
          width: min(560px, calc(100% - 36px));
          border-radius: 18px;
          border: 1px solid rgba(0,170,255,.26);
          background:
            linear-gradient(180deg, rgba(0,0,0,.78), rgba(0,0,0,.40));
          box-shadow:
            inset 0 0 0 1px rgba(0,0,0,.60),
            inset 0 0 0 2px rgba(255,255,255,.05),
            inset 0 1px 0 rgba(255,255,255,.08),
            0 22px 70px rgba(0,0,0,.70),
            0 0 18px rgba(0,170,255,.10);
          padding: 14px 14px 12px;
          backdrop-filter: blur(8px);
          animation: trTipIn 180ms ease-out 1;
        }
        @keyframes trTipIn{
          from { opacity:0; transform: translateY(calc(-50% + 4px)); }
          to { opacity:1; transform: translateY(-50%); }
        }

        .tr-coachTipPlateTop{
          display:flex;
          justify-content: space-between;
          align-items:center;
          gap:10px;
          flex-wrap: wrap;
          margin-bottom: 10px;
        }
        .tr-coachTipLive{
          font-weight: 1000;
          letter-spacing: .18em;
          text-transform: uppercase;
          font-size: 11px;
          color: rgba(255,210,80,.92);
          text-shadow: 0 8px 0 rgba(0,0,0,.70);
        }
        .tr-coachTipCat{
          font-weight: 1000;
          letter-spacing: .16em;
          text-transform: uppercase;
          font-size: 10.5px;
          color: rgba(205,230,255,.86);
          border: 1px solid rgba(0,170,255,.22);
          background: rgba(0,0,0,.18);
          padding: 4px 10px;
          border-radius: 999px;
        }

        .tr-coachTipTitle{
          margin-top: 2px;
          font-weight: 1100;
          font-size: 28px;
          line-height: 1.10;
          letter-spacing: -0.01em;
          color: rgba(244,247,255,.96);
          text-shadow: 0 2px 14px rgba(0,0,0,.55);
        }
        .tr-coachTipBullets{
          margin: 12px 0 0;
          padding-left: 18px;
          display: grid;
          gap: 7px;
          color: rgba(210,230,255,.82);
          font-weight: 850;
          line-height: 1.45;
        }
        .tr-coachTipWhy{
          margin-top: 10px;
          color: rgba(195,215,235,.74);
          font-size: 12.5px;
          line-height: 1.45;
        }

        .tr-coachDockRail{
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          padding: 10px 12px;
          background:
            linear-gradient(180deg, rgba(0,0,0,.10), rgba(0,0,0,.70)),
            radial-gradient(900px 260px at 20% 0%, rgba(0,170,255,.10), transparent 60%),
            radial-gradient(900px 260px at 80% 0%, rgba(255,140,0,.08), transparent 62%);
          border-top: 1px solid rgba(0,170,255,.18);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.05),
            0 -18px 50px rgba(0,0,0,.45);
          backdrop-filter: blur(10px);
        }
        .tr-coachDockInner{
          display: flex;
          justify-content: flex-end;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }
        .tr-coachDockLabel{
          margin-right: auto;
          font-weight: 1000;
          letter-spacing: .22em;
          text-transform: uppercase;
          font-size: 11px;
          color: rgba(245,250,255,.72);
          text-shadow: 0 8px 0 rgba(0,0,0,.70);
        }
        .tr-coachDockBtns{
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
        }
        .tr-coachDockBtns button{
          height: 44px !important;
        }

        .tr-coachTipRight{
          border-radius: 18px;
          border: 1px solid rgba(255,255,255,.10);
          background: linear-gradient(180deg, rgba(255,255,255,.04), rgba(0,0,0,.12));
          box-shadow: inset 0 1px 0 rgba(255,255,255,.05), 0 22px 70px rgba(0,0,0,.40);
          padding: 12px;
          display:grid;
          gap: 10px;
        }
        .tr-coachTipRightHead{
          display:flex;
          justify-content: space-between;
          gap: 10px;
          align-items: baseline;
          padding: 4px 4px 2px;
        }
        .tr-coachTipStack{
          display:grid;
          gap: 10px;
        }
        .tr-coachQuickTip{
          border-radius: 16px;
          border: 1px solid rgba(255,255,255,.10);
          box-shadow: inset 0 1px 0 rgba(255,255,255,.05), 0 18px 55px rgba(0,0,0,.40);
          padding: 12px;
          display:grid;
          gap: 8px;
          transition: transform .12s ease, border-color .12s ease, box-shadow .12s ease, filter .12s ease;
        }
        .tr-coachQuickTip:hover{
          transform: translateY(-1px);
          border-color: rgba(0,170,255,.26);
          box-shadow: inset 0 1px 0 rgba(255,255,255,.05), 0 22px 70px rgba(0,0,0,.48), 0 0 16px rgba(0,170,255,.08);
          filter: saturate(1.02);
        }
        .tr-coachQuickTip.is-even{
          background: linear-gradient(180deg, rgba(0,170,255,.08), rgba(0,0,0,.12));
          border-color: rgba(0,170,255,.18);
        }
        .tr-coachQuickTip.is-odd{
          background: linear-gradient(180deg, rgba(255,255,255,.04), rgba(0,0,0,.12));
        }
        .tr-coachQuickTipCat{
          font-weight: 1000;
          letter-spacing: .18em;
          text-transform: uppercase;
          font-size: 12px;
          color: rgba(205,230,255,.90);
        }
        .tr-coachQuickTipPill{
          height: 22px;
          padding: 0 10px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,.12);
          background: rgba(0,0,0,.18);
          color: rgba(245,250,255,.76);
          display:inline-flex;
          align-items:center;
          font-weight: 950;
          letter-spacing: .14em;
          text-transform: uppercase;
          font-size: 10px;
        }
        .tr-coachQuickTipText{
          font-weight: 1050;
          font-size: 18px;
          line-height: 1.12;
          color: rgba(244,247,255,.92);
          text-shadow: 0 2px 10px rgba(0,0,0,.45);
        }
        .tr-coachQuickTipSub{
          color: rgba(205,230,255,.74);
          line-height: 1.40;
          font-weight: 800;
        }
      `}</style>
    </div>
  );
}