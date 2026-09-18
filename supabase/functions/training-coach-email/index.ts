import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-mvp-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const htmlEscape = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const clean = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
const lower = (value: unknown) => clean(value).toLowerCase();
const num = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function titleCase(value: unknown) {
  return clean(value)
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function workoutName(value: unknown) {
  const raw = clean(value);
  const canonical = raw.match(/\b(upper|lower)\s*([12])\b/i);
  if (canonical) return `${titleCase(canonical[1])} ${canonical[2]}`;
  return raw || "Workout";
}

function goalLabel(value: unknown) {
  const normalized = lower(value);
  if (["build_muscle", "bulk", "muscle_gain"].includes(normalized)) return "Muscle Gain";
  if (["lose_weight", "cut"].includes(normalized)) return "Cut";
  if (normalized === "strength") return "Strength";
  if (normalized === "fitness") return "Fitness";
  return titleCase(value) || "Training";
}

function symptomKey(value: unknown): string | null {
  if (!value) return null;
  if (Array.isArray(value)) return value.map(lower).find(Boolean) ?? null;
  if (typeof value === "string") return lower(value) || null;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const enabled = entries.find(([, on]) => on === true || on === 1 || lower(on) === "true");
    if (enabled) return lower(enabled[0]);
    const first = entries.find(([, on]) => Boolean(on));
    if (first) return lower(first[0]);
  }
  return null;
}

function hashIndex(value: string, length: number) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % Math.max(1, length);
}

const MOTIVATION = [
  "Control the rep. Own the set.",
  "Make today harder to beat tomorrow.",
  "No wasted reps today.",
  "Your last session set the standard. Build on it.",
  "Quality first. Progress follows.",
  "Walk out better than you walked in.",
  "Strong positions. Clean reps. Earn the next load.",
  "Train the target, not the ego.",
];

function coachCue(sessionType: string, symptom: string | null) {
  if (symptom === "posture") {
    if (/upper/i.test(sessionType)) return "Keep the neck neutral and ribs stacked. Let the shoulder blades move naturally around the rib cage instead of forcing them down and back.";
    return "Brace before every working set and keep the rib cage stacked over the pelvis. Strong lower-body reps should not turn into low-back compensation.";
  }
  if (symptom === "shoulder_pain") return "Use a controlled, comfortable range. If symptoms travel farther down the arm or increase set to set, stop forcing the movement and modify it.";
  if (symptom === "back_pain") return "Brace before the rep, control the eccentric, and keep the load where your trunk position stays solid. Pain progression is not a training target.";
  if (symptom === "knee_pain") return "Use the deepest comfortable range you can control. Keep foot pressure stable and let the knee track naturally with the toes.";
  if (/upper/i.test(sessionType)) return "Keep the neck quiet, control the eccentric, and make the target muscle—not momentum—finish each rep.";
  return "Brace first, own the lowering phase, and keep every rep repeatable. Strong technique makes progression data useful.";
}

function firstExerciseCue(name: string) {
  const key = lower(name);
  if (/chest.?supported.*row|row machine/.test(key)) return "Keep your chest supported, reach long without losing rib position, then drive the elbows back without shrugging.";
  if (/one.?arm.*row|cable row|seated.*row/.test(key)) return "Stay square through the torso. Let the shoulder blade reach forward, then row without twisting or jutting the head.";
  if (/pulldown|lat pull/.test(key)) return "Keep ribs stacked, start by controlling the shoulder blade, and pull the elbows down without turning the rep into a lean-back row.";
  if (/face pull/.test(key)) return "Pull toward eye level, keep the neck relaxed, and finish with controlled external rotation instead of yanking with the upper traps.";
  if (/y.?raise|lower.?trap/.test(key)) return "Use very light load, keep the neck long, and let the shoulder blades upwardly rotate as the arms form a Y.";
  if (/serratus|wall slide/.test(key)) return "Reach the shoulder blade around the rib cage without shrugging. Think smooth upward rotation, not pinching the blades together.";
  if (/chin tuck|chin retract/.test(key)) return "Glide the whole head straight back while keeping the eyes level. Do not turn it into a forceful neck flexion.";
  if (/shoulder press|military press|arnold press/.test(key)) return "Keep ribs down and head stacked. Stop the set before the neck pushes forward or the shoulders start shrugging for the load.";
  if (/fly|pec deck/.test(key)) return "Keep a soft elbow, control the stretch, and bring the upper arm across with the chest instead of rolling the shoulders forward.";
  if (/hack squat|belt squat|squat/.test(key)) return "Brace before you descend, keep full-foot pressure, and let the knees track naturally over the toes through a controlled depth.";
  if (/leg press/.test(key)) return "Keep the pelvis planted, use full-foot pressure, and stop the depth before the low back starts rounding off the pad.";
  if (/bulgarian|split squat|lunge/.test(key)) return "Stay balanced through the whole foot, control the lowering phase, and keep the pelvis level rather than collapsing into the front hip.";
  if (/romanian|rdl/.test(key)) return "Push the hips back, keep the load close, and stop where the hamstrings are loaded without losing spinal position.";
  if (/leg curl/.test(key)) return "Keep the hips anchored and finish the curl with the hamstrings. Do not speed through the stretched position.";
  if (/leg extension/.test(key)) return "Control the bottom, extend smoothly, and squeeze the quads without slamming into lockout.";
  if (/hip thrust|glute bridge/.test(key)) return "Keep ribs down, drive through the feet, and finish with the glutes instead of hyperextending the low back.";
  if (/calf/.test(key)) return "Use a full controlled stretch, pause briefly at the top, and avoid bouncing through the bottom.";
  if (/carry|suitcase/.test(key)) return "Stand tall, keep ribs stacked over the pelvis, and resist leaning toward or away from the load.";
  if (/curl/.test(key)) return "Keep the shoulder quiet and control the lowering phase. Finish the rep with the elbow flexors instead of swinging the torso.";
  if (/triceps|pressdown|extension/.test(key)) return "Keep the upper arm stable, control the stretch, and finish the rep without letting the shoulders roll forward.";
  return "Use a controlled eccentric, stable setup, and a repeatable range. Stop adding load when the target muscle stops controlling the rep.";
}

function progressStatus(last: LastSet | null, repMax: number) {
  if (!last) return { label: "BASELINE", color: "#d6e1e7" };
  if ((last.pain ?? 0) >= 4) return { label: "HOLD", color: "#62d9ff" };
  if (last.reps >= repMax && last.weight > 0) return { label: "INCREASE IF CLEAN", color: "#63e3a8" };
  return { label: "BUILD REPS", color: "#ffb45d" };
}

function progressCue(last: LastSet | null, repMax: number) {
  if (!last) return "Baseline day: choose a working load you can control through the full target range with roughly 1–2 good reps still available.";
  if ((last.pain ?? 0) >= 4) return `Last time pain reached ${last.pain}/10. Keep progression on hold unless today's movement is comfortable and controlled.`;
  if (last.reps >= repMax && last.weight > 0) return `Last best set: ${formatWeight(last.weight)} × ${last.reps}. If all working sets are equally clean today, earn the smallest practical load increase.`;
  if (last.weight > 0) return `Last best set: ${formatWeight(last.weight)} × ${last.reps}. Build clean reps inside today's target before forcing a heavier load.`;
  return `Last best set reached ${last.reps} reps. Keep execution consistent and progress one variable at a time.`;
}

function e1rm(weight: number, reps: number) {
  return weight > 0 && reps > 0 ? weight * (1 + reps / 30) : 0;
}

function formatWeight(weight: number) {
  const rounded = Math.round(weight * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} lb`;
}

function formatVolume(volume: number) {
  return `${Math.round(Math.max(0, volume)).toLocaleString("en-US")} lb`;
}

function durationSeconds(row: any) {
  const active = num(row?.active_seconds);
  if (active >= 60 && active <= 6 * 60 * 60) return active;
  const started = row?.started_at ? new Date(row.started_at).getTime() : NaN;
  const ended = row?.ended_at ? new Date(row.ended_at).getTime() : row?.completed_at ? new Date(row.completed_at).getTime() : NaN;
  if (Number.isFinite(started) && Number.isFinite(ended) && ended > started) {
    const seconds = (ended - started) / 1000;
    if (seconds >= 60 && seconds <= 6 * 60 * 60) return seconds;
  }
  return null;
}

function minutesLabel(seconds: number | null) {
  return seconds ? `${Math.max(1, Math.round(seconds / 60))} min` : "—";
}

function localDateLabel(iso: string | null | undefined, timezone: string) {
  if (!iso) return "No prior session";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: timezone || "America/New_York", month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
}

function daysAgoLabel(iso: string | null | undefined) {
  if (!iso) return "FIRST RUN";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "—";
  const days = Math.max(0, Math.floor(ms / 86400000));
  if (days === 0) return "TODAY";
  if (days === 1) return "1 DAY AGO";
  return `${days} DAYS AGO`;
}

function unique(values: string[]) {
  return Array.from(new Set(values.map(clean).filter(Boolean)));
}

type LastSet = { weight: number; reps: number; rir: number | null; pain: number | null };
type ExerciseBrief = {
  id: string;
  name: string;
  sets: number;
  repMin: number;
  repMax: number;
  restSeconds: number;
  muscles: string[];
  equipment: string[];
  patterns: string[];
  last: LastSet | null;
};
type PriorStats = {
  completedAt: string | null;
  dateLabel: string;
  ageLabel: string;
  durationSeconds: number | null;
  completedSets: number;
  completedExercises: number;
  loadedVolume: number;
  bodyweight: number | null;
  difficulty: string | null;
};

type EmailContext = {
  workout: string;
  goal: string;
  exercises: ExerciseBrief[];
  templateMinutes: number | null;
  expectedMinutes: number | null;
  totalSets: number;
  targetRepMin: number;
  targetRepMax: number;
  totalRestMinutes: number;
  focusMuscles: string[];
  motivation: string;
  coachCue: string;
  firstCue: string;
  progressCue: string;
  prior: PriorStats | null;
  logoUrl: string | null;
  appUrl: string;
  sessionId: string;
  includeTip: boolean;
  includePlan: boolean;
  includeProgress: boolean;
  isTest: boolean;
  isReminder: boolean;
  reminderNumber: number;
  readyAgeHours: number | null;
};

function metricCell(label: string, value: string, accent = "#ffffff") {
  return `<td width="25%" valign="top" style="padding:12px 9px;border-right:1px solid #17303a;text-align:center;">
    <div style="color:#6f8d99;font-size:9px;font-weight:900;letter-spacing:1.05px;">${htmlEscape(label)}</div>
    <div style="margin-top:5px;color:${accent};font-size:18px;line-height:1.1;font-weight:950;">${htmlEscape(value)}</div>
  </td>`;
}

function renderEmail(args: EmailContext) {
  const first = args.exercises[0] ?? null;
  const heroSub = [
    args.exercises.length ? `${args.exercises.length} exercises` : null,
    args.totalSets ? `${args.totalSets} working sets` : null,
    args.expectedMinutes ? `~${Math.round(args.expectedMinutes)} min expected` : null,
    args.goal || null,
  ].filter(Boolean).join(" • ");

  const plan = args.includePlan ? args.exercises.map((exercise, index) => {
    const status = progressStatus(exercise.last, exercise.repMax);
    const lastText = exercise.last
      ? `${exercise.last.weight > 0 ? `${formatWeight(exercise.last.weight)} × ` : ""}${exercise.last.reps} last best`
      : "No prior benchmark";
    return `<tr>
      <td style="padding:14px 0;border-bottom:1px solid #17313b;vertical-align:top;width:42px;color:#52ddff;font-size:12px;font-weight:950;">${String(index + 1).padStart(2, "0")}</td>
      <td style="padding:14px 8px 14px 0;border-bottom:1px solid #17313b;vertical-align:top;">
        <div style="color:#f7fbfd;font-size:15px;font-weight:950;line-height:1.25;">${htmlEscape(exercise.name)}</div>
        <div style="margin-top:5px;color:#8da9b6;font-size:11px;font-weight:700;">${exercise.sets} sets • ${exercise.repMin}–${exercise.repMax} reps${exercise.muscles.length ? ` • ${htmlEscape(exercise.muscles.slice(0, 2).map(titleCase).join(" / "))}` : ""}</div>
        ${args.includeProgress ? `<div style="margin-top:6px;color:#8299a3;font-size:10px;font-weight:700;">${htmlEscape(lastText)} <span style="color:${status.color};font-weight:950;">• ${status.label}</span></div>` : ""}
      </td>
    </tr>`;
  }).join("") : "";

  const logo = args.logoUrl
    ? `<img src="${htmlEscape(args.logoUrl)}" width="230" alt="MVP Trainer Pro" style="display:block;max-width:230px;height:auto;border:0;outline:none;text-decoration:none;">`
    : `<div style="color:#55ddff;font-size:12px;font-weight:950;letter-spacing:2.2px;">MVP TRAINER PRO</div>`;

  const prior = args.prior;
  const priorSection = prior ? `<div style="margin-top:22px;color:#879fa9;font-size:10px;font-weight:950;letter-spacing:1.35px;">LAST ${htmlEscape(args.workout.toUpperCase())}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:7px;background:#08141a;border:1px solid #17313b;border-radius:12px;overflow:hidden;">
      <tr>
        ${metricCell("SESSION TIME", minutesLabel(prior.durationSeconds), "#ffb45d")}
        ${metricCell("SETS DONE", prior.completedSets ? String(prior.completedSets) : "—", "#ffffff")}
        ${metricCell("LOADED VOLUME", prior.loadedVolume > 0 ? formatVolume(prior.loadedVolume) : "—", "#ffffff")}
        ${metricCell("LAST TRAINED", prior.ageLabel, "#ffb45d")}
      </tr>
    </table>
    <div style="margin-top:7px;color:#6f8792;font-size:10px;line-height:1.5;">${htmlEscape(prior.dateLabel)}${prior.bodyweight ? ` • Body weight ${formatWeight(prior.bodyweight)}` : ""}${prior.difficulty ? ` • Difficulty ${htmlEscape(titleCase(prior.difficulty))}` : ""}</div>` : `<div style="margin-top:22px;padding:13px 15px;border:1px solid #17313b;border-radius:11px;background:#08141a;color:#9bb0b9;font-size:12px;font-weight:750;">No prior ${htmlEscape(args.workout)} benchmark yet. Today establishes the baseline.</div>`;

  const reminderLead = args.isReminder
    ? `<div style="margin-top:9px;color:#ffb45d;font-size:12px;font-weight:900;">REMINDER ${args.reminderNumber}${args.readyAgeHours != null ? ` • READY ${Math.max(1, Math.round(args.readyAgeHours))} HOURS` : ""}</div>`
    : "";

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#05090d;font-family:Arial,Helvetica,sans-serif;color:#f7fbfd;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#05090d;padding:24px 10px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:700px;background:#091118;border:1px solid #17313e;border-radius:18px;overflow:hidden;">
        <tr><td style="padding:22px 26px 20px;background:#071218;border-bottom:1px solid #17313e;">
          ${logo}
          <div style="margin-top:16px;color:${args.isReminder ? "#ffb45d" : "#8af0b9"};font-size:11px;font-weight:950;letter-spacing:1.6px;">${args.isReminder ? "STILL READY TO TRAIN" : "READY TO TRAIN"}${args.isTest ? " • TEST" : ""}</div>
          ${reminderLead}
          <div style="margin-top:6px;color:#ffffff;font-size:36px;line-height:1.05;font-weight:950;">${htmlEscape(args.workout)}</div>
          <div style="margin-top:9px;color:#9cb3be;font-size:13px;font-weight:750;">${htmlEscape(heroSub)}</div>
        </td></tr>
        <tr><td style="padding:22px 26px 26px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#08141a;border:1px solid #17313b;border-radius:12px;overflow:hidden;">
            <tr>
              ${metricCell("EXERCISES", String(args.exercises.length), "#55ddff")}
              ${metricCell("WORKING SETS", String(args.totalSets), "#ffffff")}
              ${metricCell("TARGET REPS", `${args.targetRepMin}–${args.targetRepMax}`, "#ffffff")}
              ${metricCell("EXPECTED TIME", args.expectedMinutes ? `~${Math.round(args.expectedMinutes)} min` : "—", "#55ddff")}
            </tr>
          </table>
          ${args.focusMuscles.length ? `<div style="margin-top:9px;color:#718995;font-size:10px;font-weight:800;">FOCUS • ${htmlEscape(args.focusMuscles.slice(0, 5).map(titleCase).join(" • "))}${args.totalRestMinutes > 0 ? ` • ~${Math.round(args.totalRestMinutes)} min programmed rest` : ""}</div>` : ""}

          ${priorSection}

          <div style="margin-top:22px;padding:17px 19px;border:1px solid #294451;border-radius:13px;background:#0c171e;">
            <div style="color:#ffab3d;font-size:10px;font-weight:950;letter-spacing:1.4px;">TODAY'S STANDARD</div>
            <div style="margin-top:7px;color:#ffffff;font-size:19px;line-height:1.35;font-weight:950;">${htmlEscape(args.motivation)}</div>
          </div>

          ${first ? `<div style="margin-top:18px;padding:18px 19px;border-left:3px solid #55ddff;background:#08141b;border-radius:8px;">
            <div style="color:#55ddff;font-size:10px;font-weight:950;letter-spacing:1.4px;">FIRST EXERCISE</div>
            <div style="margin-top:7px;color:#ffffff;font-size:22px;font-weight:950;">${htmlEscape(first.name)}</div>
            <div style="margin-top:5px;color:#9db2bc;font-size:12px;font-weight:750;">${first.sets} sets • ${first.repMin}–${first.repMax} reps${first.restSeconds ? ` • ${first.restSeconds}s rest` : ""}</div>
            ${first.last && args.includeProgress ? `<div style="margin-top:7px;color:#ffb45d;font-size:11px;font-weight:850;">Last best: ${first.last.weight > 0 ? `${formatWeight(first.last.weight)} × ` : ""}${first.last.reps}</div>` : ""}
          </div>` : ""}

          ${args.includeTip ? `<div style="margin-top:20px;">
            <div style="color:#b79cff;font-size:10px;font-weight:950;letter-spacing:1.4px;">SESSION COACHING</div>
            <div style="margin-top:7px;padding:14px 15px;border-radius:10px;background:#0a141a;color:#dce9ee;font-size:13px;line-height:1.55;font-weight:750;"><b style="color:#ffffff;">Workout:</b> ${htmlEscape(args.coachCue)}</div>
            ${first ? `<div style="margin-top:8px;padding:14px 15px;border-radius:10px;background:#0a141a;color:#dce9ee;font-size:13px;line-height:1.55;font-weight:750;"><b style="color:#55ddff;">${htmlEscape(first.name)}:</b> ${htmlEscape(args.firstCue)}</div>` : ""}
          </div>` : ""}

          ${args.includeProgress ? `<div style="margin-top:20px;">
            <div style="color:#ffb35a;font-size:10px;font-weight:950;letter-spacing:1.4px;">PROGRESSION TARGET</div>
            <div style="margin-top:7px;color:#dce9ee;font-size:14px;line-height:1.55;font-weight:750;">${htmlEscape(args.progressCue)}</div>
          </div>` : ""}

          ${args.includePlan ? `<div style="margin-top:23px;color:#8da9b6;font-size:10px;font-weight:950;letter-spacing:1.4px;">TODAY'S WORKOUT PLAN</div>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:4px;">${plan}</table>` : ""}

          <div style="text-align:center;margin:28px 0 8px;">
            <a href="${htmlEscape(args.appUrl.replace(/\/$/, ""))}/workout/${encodeURIComponent(args.sessionId)}" style="display:inline-block;background:#35c98a;color:#03120c;text-decoration:none;font-size:14px;font-weight:950;letter-spacing:.45px;padding:15px 25px;border-radius:10px;">START ${htmlEscape(args.workout.toUpperCase())}</a>
          </div>
          <div style="margin-top:18px;text-align:center;color:#637b86;font-size:10px;line-height:1.5;">MVP Trainer Pro • This brief follows your pinned program and current Up Next rotation. Reminder settings live in Coach.</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

async function currentSession(admin: any, userId: string, programId: string) {
  const { data: queueRows, error: queueError } = await admin
    .from("scheduled_sessions")
    .select("id,template_id,session_type,status,program_block_id,queue_index,created_at")
    .eq("user_id", userId)
    .eq("program_block_id", programId)
    .or("queue_index.is.null,queue_index.lt.1000000")
    .order("queue_index", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(40);
  if (queueError) throw queueError;

  const viable = (queueRows ?? []).filter((row: any) => !["skipped","canceled","cancelled","completed"].includes(lower(row.status || "scheduled")));
  if (!viable.length) return null;

  const ids = viable.map((row: any) => row.id);
  const { data: completedRows, error: completedError } = await admin
    .from("workouts")
    .select("scheduled_session_id,completed_at")
    .eq("user_id", userId)
    .in("scheduled_session_id", ids)
    .not("completed_at", "is", null);
  if (completedError) throw completedError;
  const completedIds = new Set((completedRows ?? []).map((row: any) => row.scheduled_session_id));
  return viable.find((row: any) => !completedIds.has(row.id)) ?? null;
}

async function activeStartedWorkout(admin: any, userId: string, sessionId: string) {
  const { data } = await admin
    .from("workouts")
    .select("id,started_at,completed_at")
    .eq("user_id", userId)
    .eq("scheduled_session_id", sessionId)
    .is("completed_at", null)
    .not("started_at", "is", null)
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

async function buildContext(admin: any, userId: string, authUser: any, pref: any, program: any, session: any, appUrl: string, options: { isTest: boolean; isReminder: boolean; reminderNumber: number; readyAgeHours: number | null }) {
  const { data: template, error: templateError } = await admin
    .from("workout_templates")
    .select("id,name,estimated_minutes,focus_tags")
    .eq("id", session.template_id)
    .maybeSingle();
  if (templateError) throw templateError;

  const { data: templateExercises, error: teError } = await admin
    .from("template_exercises")
    .select("exercise_id,order_index,sets,rep_min,rep_max,rir_min,rir_max,rest_seconds")
    .eq("template_id", session.template_id)
    .order("order_index", { ascending: true });
  if (teError) throw teError;

  const exerciseIds = (templateExercises ?? []).map((row: any) => row.exercise_id).filter(Boolean);
  let exerciseRows: any[] = [];
  if (exerciseIds.length) {
    const result = await admin.from("exercises").select("id,name,primary_muscles,secondary_muscles,equipment,patterns").in("id", exerciseIds);
    if (result.error) throw result.error;
    exerciseRows = result.data ?? [];
  }
  const exerciseMap = new Map(exerciseRows.map((row: any) => [row.id, row]));

  const { data: sameTypeRows } = await admin
    .from("scheduled_sessions")
    .select("id")
    .eq("user_id", userId)
    .eq("program_block_id", program.id)
    .eq("session_type", session.session_type)
    .limit(200);
  const sameTypeIds = (sameTypeRows ?? []).map((row: any) => row.id);

  let priorWorkouts: any[] = [];
  if (sameTypeIds.length) {
    const result = await admin
      .from("workouts")
      .select("id,scheduled_session_id,completed_at,started_at,ended_at,active_seconds,bodyweight_lb,post_difficulty,session_rating")
      .eq("user_id", userId)
      .in("scheduled_session_id", sameTypeIds)
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(6);
    if (!result.error) priorWorkouts = result.data ?? [];
  }
  const previousWorkout = priorWorkouts[0] ?? null;

  const lastMap = new Map<string, LastSet>();
  let priorStats: PriorStats | null = null;
  if (previousWorkout?.id) {
    const { data: weRows, error: weError } = await admin
      .from("workout_exercises")
      .select("id,exercise_id,pain,difficulty")
      .eq("workout_id", previousWorkout.id);
    if (weError) throw weError;
    const weIds = (weRows ?? []).map((row: any) => row.id);
    let setRows: any[] = [];
    if (weIds.length) {
      const result = await admin.from("workout_sets").select("workout_exercise_id,reps,weight,rir,set_index").in("workout_exercise_id", weIds);
      if (!result.error) setRows = result.data ?? [];
    }
    const weById = new Map((weRows ?? []).map((row: any) => [row.id, row]));
    const completedExerciseIds = new Set<string>();
    let loadedVolume = 0;
    let completedSets = 0;
    for (const set of setRows) {
      const we: any = weById.get(set.workout_exercise_id);
      if (!we?.exercise_id) continue;
      const reps = num(set.reps);
      const weight = num(set.weight);
      if (reps > 0) {
        completedSets += 1;
        completedExerciseIds.add(we.exercise_id);
        if (weight > 0) loadedVolume += weight * reps;
      }
      if (!exerciseIds.includes(we.exercise_id) || reps <= 0) continue;
      const candidate: LastSet = { weight, reps, rir: set.rir == null ? null : num(set.rir), pain: we.pain == null ? null : num(we.pain) };
      const prior = lastMap.get(we.exercise_id);
      if (!prior || e1rm(candidate.weight, candidate.reps) > e1rm(prior.weight, prior.reps)) lastMap.set(we.exercise_id, candidate);
    }
    priorStats = {
      completedAt: previousWorkout.completed_at ?? null,
      dateLabel: localDateLabel(previousWorkout.completed_at, pref.timezone),
      ageLabel: daysAgoLabel(previousWorkout.completed_at),
      durationSeconds: durationSeconds(previousWorkout),
      completedSets,
      completedExercises: completedExerciseIds.size,
      loadedVolume,
      bodyweight: previousWorkout.bodyweight_lb == null ? null : num(previousWorkout.bodyweight_lb),
      difficulty: clean(previousWorkout.post_difficulty || previousWorkout.session_rating) || null,
    };
  }

  const durations = priorWorkouts.map(durationSeconds).filter((value): value is number => Boolean(value));
  const averageDuration = durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : null;

  let symptom: string | null = null;
  if (program.intake_snapshot_id) {
    const { data: intake } = await admin.from("intake_snapshots").select("symptoms").eq("id", program.intake_snapshot_id).maybeSingle();
    symptom = symptomKey(intake?.symptoms ?? null);
  }

  const exercises: ExerciseBrief[] = (templateExercises ?? []).map((row: any) => {
    const meta: any = exerciseMap.get(row.exercise_id) ?? {};
    const equipment = Array.isArray(meta.equipment) ? meta.equipment : meta.equipment ? [meta.equipment] : [];
    const patterns = Array.isArray(meta.patterns) ? meta.patterns : meta.patterns ? [meta.patterns] : [];
    return {
      id: row.exercise_id,
      name: clean(meta.name) || "Exercise",
      sets: Math.max(1, num(row.sets, 3)),
      repMin: Math.max(1, num(row.rep_min, 8)),
      repMax: Math.max(1, num(row.rep_max, 12)),
      restSeconds: Math.max(0, num(row.rest_seconds, 90)),
      muscles: Array.isArray(meta.primary_muscles) ? meta.primary_muscles.map(clean).filter(Boolean) : [],
      equipment: equipment.map(clean).filter(Boolean),
      patterns: patterns.map(clean).filter(Boolean),
      last: lastMap.get(row.exercise_id) ?? null,
    };
  });

  const totalSets = exercises.reduce((sum, exercise) => sum + exercise.sets, 0);
  const targetRepMin = exercises.reduce((sum, exercise) => sum + exercise.sets * exercise.repMin, 0);
  const targetRepMax = exercises.reduce((sum, exercise) => sum + exercise.sets * exercise.repMax, 0);
  const totalRestSeconds = exercises.reduce((sum, exercise) => sum + Math.max(0, exercise.sets - 1) * exercise.restSeconds, 0);
  const focusMuscles = unique(exercises.flatMap((exercise) => exercise.muscles));
  const templateMinutes = template?.estimated_minutes == null ? null : num(template.estimated_minutes);
  const historyMinutes = averageDuration ? averageDuration / 60 : null;
  const expectedMinutes = historyMinutes && historyMinutes >= 15 && historyMinutes <= 180
    ? Math.round((historyMinutes * 0.65 + (templateMinutes || historyMinutes) * 0.35))
    : templateMinutes;

  const workout = workoutName(session.session_type || template?.name);
  const goal = goalLabel(program.goal);
  const motivationSeed = `${session.id}:${options.isReminder ? `reminder-${options.reminderNumber}` : "ready"}`;
  const motivation = MOTIVATION[hashIndex(motivationSeed, MOTIVATION.length)];
  const first = exercises[0] ?? null;
  const progression = first ? progressCue(first.last, first.repMax) : "Start with controlled reps and build from clean execution.";
  const cue = coachCue(workout, symptom);

  let logoUrl: string | null = null;
  const logoPath = clean(authUser?.user_metadata?.mvp_trainer_ui?.headerLogoPath);
  if (logoPath) {
    const signed = await admin.storage.from("app-assets").createSignedUrl(logoPath, 30 * 24 * 60 * 60);
    if (!signed.error) logoUrl = signed.data?.signedUrl ?? null;
  }

  return {
    workout,
    goal,
    exercises,
    templateMinutes,
    expectedMinutes,
    totalSets,
    targetRepMin,
    targetRepMax,
    totalRestMinutes: totalRestSeconds / 60,
    focusMuscles,
    motivation,
    coachCue: cue,
    firstCue: first ? firstExerciseCue(first.name) : "",
    progressCue: progression,
    prior: priorStats,
    logoUrl,
    appUrl,
    sessionId: session.id,
    includeTip: pref.include_coach_tip !== false,
    includePlan: pref.include_exercise_plan !== false,
    includeProgress: pref.include_progress_snapshot !== false,
    isTest: options.isTest,
    isReminder: options.isReminder,
    reminderNumber: options.reminderNumber,
    readyAgeHours: options.readyAgeHours,
  } satisfies EmailContext;
}

async function sendMail(args: { admin: any; mailEndpoint: string; mailSecret: string; destination: string; subject: string; html: string; deliveryId: string | null }) {
  const mailResponse = await fetch(args.mailEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json", "x-skyshine-booking-secret": args.mailSecret },
    body: JSON.stringify({ to: args.destination, subject: args.subject, html: args.html }),
  });
  const providerBody = await mailResponse.json().catch(() => ({}));
  if (!mailResponse.ok || providerBody?.ok !== true) {
    const providerError = clean(providerBody?.error || `WordPress mail returned HTTP ${mailResponse.status}`);
    if (args.deliveryId) await args.admin.from("training_email_deliveries").update({ status: "failed", error_message: providerError }).eq("id", args.deliveryId);
    throw new Error(providerError || "WordPress mail transport failed.");
  }
  if (args.deliveryId) {
    await args.admin.from("training_email_deliveries").update({ status: "sent", provider_message_id: null, sent_at: new Date().toISOString(), error_message: null }).eq("id", args.deliveryId);
  }
}

async function reserveDelivery(admin: any, payload: { userId: string; programId: string; sessionId: string; kind: string; subject: string; destination: string; reason: string }) {
  const { data: existing, error: existingError } = await admin
    .from("training_email_deliveries")
    .select("id,status,sent_at")
    .eq("user_id", payload.userId)
    .eq("scheduled_session_id", payload.sessionId)
    .eq("kind", payload.kind)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing?.status === "sent" || existing?.status === "pending") return { id: null, skipped: true };
  if (existing?.id) {
    const retry = await admin.from("training_email_deliveries").update({ status: "pending", subject: payload.subject, destination: payload.destination, trigger_reason: payload.reason, error_message: null }).eq("id", existing.id).select("id").single();
    if (retry.error) throw retry.error;
    return { id: retry.data.id as string, skipped: false };
  }
  const insert = await admin.from("training_email_deliveries").insert({
    user_id: payload.userId,
    program_block_id: payload.programId,
    scheduled_session_id: payload.sessionId,
    kind: payload.kind,
    status: "pending",
    subject: payload.subject,
    destination: payload.destination,
    trigger_reason: payload.reason,
  }).select("id").single();
  if (insert.error) {
    if (insert.error.code === "23505") return { id: null, skipped: true };
    throw insert.error;
  }
  return { id: insert.data.id as string, skipped: false };
}

async function sendForUser(args: { admin: any; userId: string; pref: any; authUser: any; action: "ready" | "test" | "scan"; reason: string; mailEndpoint: string; mailSecret: string; appUrl: string }) {
  const { admin, userId, pref, authUser } = args;
  let programId = pref.program_block_id as string | null;
  if (!programId) {
    const { data: active } = await admin.from("program_blocks").select("id").eq("user_id", userId).eq("status", "active").order("created_at", { ascending: false }).limit(1).maybeSingle();
    programId = active?.id ?? null;
  }
  if (!programId) return { ok: true, skipped: true, reason: "no_program" };

  const { data: program, error: programError } = await admin
    .from("program_blocks")
    .select("id,user_id,goal,goal_mode,intake_snapshot_id,status")
    .eq("id", programId)
    .eq("user_id", userId)
    .maybeSingle();
  if (programError) throw programError;
  if (!program) return { ok: true, skipped: true, reason: "program_not_found" };

  const session = await currentSession(admin, userId, programId);
  if (!session) return { ok: true, skipped: true, reason: "no_ready_session" };

  const destination = clean(pref.email_override) || clean(authUser?.email);
  if (!destination || !destination.includes("@")) return { ok: true, skipped: true, reason: "no_destination" };

  if (args.action === "test") {
    const context = await buildContext(admin, userId, authUser, pref, program, session, args.appUrl, { isTest: true, isReminder: false, reminderNumber: 0, readyAgeHours: null });
    const subject = `[TEST] ${context.workout} is ready — your MVP Coach brief`;
    await sendMail({ admin, mailEndpoint: args.mailEndpoint, mailSecret: args.mailSecret, destination, subject, html: renderEmail(context), deliveryId: null });
    return { ok: true, sent: true, subject, session_id: session.id };
  }

  if (!pref.enabled || !pref.workout_ready) return { ok: true, skipped: true, reason: "disabled" };

  if (args.action === "ready") {
    const context = await buildContext(admin, userId, authUser, pref, program, session, args.appUrl, { isTest: false, isReminder: false, reminderNumber: 0, readyAgeHours: null });
    const subject = `${context.workout} is ready — your MVP Coach brief`;
    const reservation = await reserveDelivery(admin, { userId, programId, sessionId: session.id, kind: "workout_ready", subject, destination, reason: args.reason });
    if (reservation.skipped) return { ok: true, skipped: true, reason: "already_sent_or_processing", session_id: session.id };
    await sendMail({ admin, mailEndpoint: args.mailEndpoint, mailSecret: args.mailSecret, destination, subject, html: renderEmail(context), deliveryId: reservation.id });
    return { ok: true, sent: true, subject, session_id: session.id };
  }

  const started = await activeStartedWorkout(admin, userId, session.id);
  if (started) return { ok: true, skipped: true, reason: "workout_already_started", session_id: session.id };

  const { data: readyDelivery, error: readyError } = await admin
    .from("training_email_deliveries")
    .select("id,status,sent_at")
    .eq("user_id", userId)
    .eq("scheduled_session_id", session.id)
    .eq("kind", "workout_ready")
    .maybeSingle();
  if (readyError) throw readyError;

  if (!readyDelivery || readyDelivery.status !== "sent" || !readyDelivery.sent_at) {
    const context = await buildContext(admin, userId, authUser, pref, program, session, args.appUrl, { isTest: false, isReminder: false, reminderNumber: 0, readyAgeHours: null });
    const subject = `${context.workout} is ready — your MVP Coach brief`;
    const reservation = await reserveDelivery(admin, { userId, programId, sessionId: session.id, kind: "workout_ready", subject, destination, reason: "cron_ready_recovery" });
    if (!reservation.skipped) {
      await sendMail({ admin, mailEndpoint: args.mailEndpoint, mailSecret: args.mailSecret, destination, subject, html: renderEmail(context), deliveryId: reservation.id });
      return { ok: true, sent: true, kind: "workout_ready", session_id: session.id };
    }
    return { ok: true, skipped: true, reason: "ready_processing", session_id: session.id };
  }

  if (!pref.reminder_enabled) return { ok: true, skipped: true, reason: "reminders_disabled", session_id: session.id };
  const reminderMax = Math.max(1, Math.min(3, num(pref.reminder_max, 2)));
  const reminderHours = Math.max(6, Math.min(168, num(pref.reminder_hours, 24)));

  const { data: reminderRows, error: reminderError } = await admin
    .from("training_email_deliveries")
    .select("kind,status,sent_at")
    .eq("user_id", userId)
    .eq("scheduled_session_id", session.id)
    .like("kind", "workout_reminder_%")
    .eq("status", "sent")
    .order("sent_at", { ascending: true });
  if (reminderError) throw reminderError;
  const sentReminders = reminderRows ?? [];
  if (sentReminders.length >= reminderMax) return { ok: true, skipped: true, reason: "reminder_limit_reached", session_id: session.id };

  const anchorIso = sentReminders.length ? sentReminders[sentReminders.length - 1].sent_at : readyDelivery.sent_at;
  const anchorMs = new Date(anchorIso).getTime();
  const elapsedHours = (Date.now() - anchorMs) / 3600000;
  if (!Number.isFinite(elapsedHours) || elapsedHours < reminderHours) return { ok: true, skipped: true, reason: "reminder_not_due", session_id: session.id };

  const reminderNumber = sentReminders.length + 1;
  const readyAgeHours = (Date.now() - new Date(readyDelivery.sent_at).getTime()) / 3600000;
  const context = await buildContext(admin, userId, authUser, pref, program, session, args.appUrl, { isTest: false, isReminder: true, reminderNumber, readyAgeHours });
  const subject = `Reminder: ${context.workout} is still Up Next — MVP Coach`;
  const kind = `workout_reminder_${reminderNumber}`;
  const reservation = await reserveDelivery(admin, { userId, programId, sessionId: session.id, kind, subject, destination, reason: args.reason });
  if (reservation.skipped) return { ok: true, skipped: true, reason: "reminder_already_sent_or_processing", session_id: session.id };
  await sendMail({ admin, mailEndpoint: args.mailEndpoint, mailSecret: args.mailSecret, destination, subject, html: renderEmail(context), deliveryId: reservation.id });
  return { ok: true, sent: true, kind, session_id: session.id };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return Response.json({ ok: false, error: "Method not allowed" }, { status: 405, headers: CORS });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const mailSecret = Deno.env.get("SSX_CRM_BOOKING_MACHINE_SECRET") ?? "";
    const mailEndpoint = Deno.env.get("MVP_TRAINER_MAIL_ENDPOINT") ?? "https://skyshineautodetailing.com/wp-json/skyshine/v1/crm-mail";
    const appUrl = Deno.env.get("MVP_APP_URL") ?? "https://fitnesstrainer.skyshineautodetailing.com";
    if (!supabaseUrl || !serviceKey) throw new Error("Supabase Edge Function environment is incomplete.");
    if (!mailSecret) throw new Error("SSX_CRM_BOOKING_MACHINE_SECRET is not configured in MVP Trainer Edge Function secrets.");

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const body = await req.json().catch(() => ({}));
    const requestedAction = clean(body?.action);

    if (requestedAction === "scan_reminders") {
      const suppliedCronSecret = clean(req.headers.get("x-mvp-cron-secret"));
      const { data: systemConfig, error: systemError } = await admin
        .from("training_email_system_config")
        .select("cron_secret")
        .eq("id", "default")
        .maybeSingle();
      if (systemError) throw systemError;
      if (!suppliedCronSecret || !systemConfig?.cron_secret || suppliedCronSecret !== systemConfig.cron_secret) {
        return Response.json({ ok: false, error: "Unauthorized cron request" }, { status: 401, headers: CORS });
      }

      const { data: prefs, error: prefsError } = await admin
        .from("training_email_preferences")
        .select("user_id,program_block_id,enabled,workout_ready,include_coach_tip,include_exercise_plan,include_progress_snapshot,email_override,timezone,reminder_enabled,reminder_hours,reminder_max")
        .eq("enabled", true)
        .eq("workout_ready", true);
      if (prefsError) throw prefsError;

      let sent = 0;
      let skipped = 0;
      const errors: string[] = [];
      for (const pref of prefs ?? []) {
        try {
          const { data: userResult, error: userError } = await admin.auth.admin.getUserById(pref.user_id);
          if (userError || !userResult.user) { skipped += 1; continue; }
          const result = await sendForUser({ admin, userId: pref.user_id, pref, authUser: userResult.user, action: "scan", reason: "hourly_cron", mailEndpoint, mailSecret, appUrl });
          if ((result as any)?.sent) sent += 1; else skipped += 1;
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
      return Response.json({ ok: true, scanned: (prefs ?? []).length, sent, skipped, errors: errors.slice(0, 8) }, { headers: CORS });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401, headers: CORS });
    const { data: auth, error: authError } = await admin.auth.getUser(jwt);
    if (authError || !auth.user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401, headers: CORS });

    const action: "ready" | "test" = requestedAction === "test" ? "test" : "ready";
    const reason = clean(body?.reason) || action;
    const userId = auth.user.id;
    const { data: pref, error: prefError } = await admin
      .from("training_email_preferences")
      .select("user_id,program_block_id,enabled,workout_ready,include_coach_tip,include_exercise_plan,include_progress_snapshot,email_override,timezone,reminder_enabled,reminder_hours,reminder_max")
      .eq("user_id", userId)
      .maybeSingle();
    if (prefError) throw prefError;
    if (!pref) return Response.json({ ok: true, skipped: true, reason: "not_configured" }, { headers: CORS });

    const result = await sendForUser({ admin, userId, pref, authUser: auth.user, action, reason, mailEndpoint, mailSecret, appUrl });
    return Response.json(result, { headers: CORS });
  } catch (error) {
    console.error("training-coach-email", error);
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500, headers: CORS });
  }
});
