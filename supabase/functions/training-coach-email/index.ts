import { createClient } from "npm:@supabase/supabase-js@2";
import { analyzeProgression, type ProgressionAnalysis, type TrainingSessionSample } from "../_shared/trainingIntelligence.ts";

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

// Match R39 Coach's canonical name key (active-program boundary remains mandatory).
function movementKey(name: unknown, id: string) {
  const normalized = String(name ?? "")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ")
    .trim().replace(/\s+/g, " ");
  return normalized ? `movement:${normalized}` : `exercise:${id}`;
}
function batches<T>(items: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
function effortLabel(key: string | null, rir: number | null) {
  const labels: Record<string, string> = {
    easy: "Easy", moderate: "Moderate", challenging: "Challenging",
    very_hard: "Very hard", maximum: "Maximum", not_sure: "Not sure",
  };
  if (key && labels[key]) return labels[key];
  const byRir: Record<number, string> = { 4: "Easy", 3: "Moderate", 2: "Challenging", 1: "Very hard", 0: "Maximum" };
  return rir != null ? byRir[rir] ?? `${rir} RIR` : "Not recorded";
}
type LastSet = { setIndex: number; weight: number; reps: number; rir: number | null; effortKey: string | null; pain: number | null };
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
  lastSets: LastSet[];
  coach: ProgressionAnalysis;
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
  priority: ExerciseBrief | null;
  decisionCounts: { increase: number; hold: number; recovery: number };
  heroUrl: string;
  timezone: string;
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

// R40.1 visual-only revision. Coach snapshots, queue selection and transport unchanged.
// R40.1 visual-only revision. Coach snapshots, queue selection and transport unchanged.
// R40.1 visual-only revision. Coach snapshots, queue selection and transport unchanged.
function mailMetric(value: string, caption: string) {
  return `<td width="33%" align="center" valign="middle" style="width:33%;padding:17px 6px 16px;border-right:1px solid #146284;background:#091e30;">
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:28px;line-height:32px;font-weight:900;color:#ffffff;white-space:nowrap;">${htmlEscape(value)}</div>
    <div style="padding-top:7px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:17px;font-weight:800;color:#7cddff;letter-spacing:.5px;">${htmlEscape(caption)}</div>
  </td>`;
}
function coachCommand(exercise: ExerciseBrief) {
  const c = exercise.coach;
  if (c.action === "BASELINE" || c.suggestedWeight == null || c.suggestedWeight <= 0) return "SET BASELINE";
  return `${formatWeight(c.suggestedWeight)}${c.action === "INCREASE" ? " ↑" : ""}`;
}
function decisionLabel(action: string) {
  const labels: Record<string,string> = { BASELINE:"ESTABLISH LOAD", HOLD:"HOLD", MONITOR:"BUILD REPS", INCREASE:"INCREASE", REDUCE:"REDUCE LOAD", RECOVERY:"RECOVERY FIRST" };
  return labels[action] ?? "COACH REVIEW";
}
function renderEmail(args: EmailContext) {
  const root = args.appUrl.replace(/\/$/, "");
  const sessionHref = `${root}/workout/${encodeURIComponent(args.sessionId)}`;
  const logoHref = `${root}/email/mvp-email-logo.jpg`;
  const heroHref = args.heroUrl;
  const priority = args.priority;
  const accent = priority?.coach.action === "REDUCE" || priority?.coach.action === "RECOVERY" ? "#ffac59" : "#4ff48e";
  const isRowImage = priority && /^seated\s+cable\s+rows?$/i.test(priority.name.trim());
  const priorityPhoto = isRowImage ? `<td class="priorityImage" width="194" valign="top" style="width:194px;padding:0 18px 0 0;">
    <img src="${htmlEscape(root+'/email/mvp-cable-row.jpg')}" width="194" alt="Seated cable row equipment" style="display:block;width:194px;max-width:194px;height:auto;border:1px solid #e6831b;border-radius:12px;">
  </td>` : "";
  const priorityBody = priority ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border:2px solid #fa8d18;background:#07121d;">
    <tr><td style="padding:21px 20px 16px;">
      <div style="font-family:Arial,Helvetica,sans-serif;color:#ff982a;font-size:17px;line-height:23px;font-weight:900;letter-spacing:.4px;">◎ &nbsp; PROGRESSION COACH — TOP PRIORITY</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;"><tr>
        ${priorityPhoto}
        <td valign="top" style="padding:0;">
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:25px;line-height:29px;font-weight:900;color:#ffffff;padding-bottom:12px;">${htmlEscape(priority.name)}</div>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;"><tr>
            <td valign="top" style="width:49%;padding:0 6px 0 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #147ca3;background:#061e30;"><tr><td style="padding:11px 12px 12px;">
              <div style="font-family:Arial,sans-serif;color:#71e3ff;font-size:11px;font-weight:900;line-height:16px;">RECOMMENDED START</div>
              <div style="padding-top:5px;font-family:Arial,sans-serif;color:${accent};font-size:29px;font-weight:900;line-height:35px;">${htmlEscape(coachCommand(priority))}</div>
            </td></tr></table></td>
            <td valign="top" style="width:51%;padding:0 0 0 6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #147ca3;background:#061e30;"><tr><td style="padding:11px 12px 12px;">
              <div style="font-family:Arial,sans-serif;color:#71e3ff;font-size:11px;font-weight:900;line-height:16px;">TARGET REPS</div>
              <div style="padding-top:7px;font-family:Arial,sans-serif;color:#ffffff;font-size:18px;font-weight:900;line-height:31px;">${htmlEscape(priority.coach.repPlan)}</div>
            </td></tr></table></td>
          </tr></table>
          <div style="padding-top:13px;font-family:Arial,Helvetica,sans-serif;color:#ecfaff;font-size:15px;line-height:23px;font-weight:400;">${htmlEscape(priority.coach.reason)}</div>
          <div style="padding-top:7px;font-family:Arial,Helvetica,sans-serif;color:#7be4ff;font-size:11px;line-height:16px;font-weight:800;">${htmlEscape(decisionLabel(priority.coach.action))} &nbsp;·&nbsp; ${htmlEscape(priority.coach.confidence)} CONFIDENCE</div>
        </td>
      </tr></table>
    </td></tr>
  </table>` : "";
  const previous = args.prior ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border:2px solid #06bafa;background:#081829;">
    <tr><td style="padding:19px 20px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td valign="middle" style="font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:24px;font-weight:900;color:#64e0ff;">◉ &nbsp; YOUR LAST ${htmlEscape(args.workout.toUpperCase())}</td>
        <td align="right" valign="middle" style="font-family:Arial,sans-serif;font-size:12px;line-height:18px;font-weight:700;color:#d5e7f1;">${htmlEscape(args.prior.dateLabel)}</td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:0 12px 15px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      ${mailMetric(minutesLabel(args.prior.durationSeconds),"DURATION")}
      ${mailMetric(String(args.prior.completedSets),"SETS COMPLETED")}
      ${mailMetric(formatVolume(args.prior.loadedVolume),"TOTAL VOLUME")}
    </tr></table></td></tr>
  </table>` : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:2px solid #06bafa;background:#081829;"><tr><td style="padding:20px;font-family:Arial,sans-serif;font-size:15px;line-height:22px;color:#d9f4ff;">FIRST ${htmlEscape(args.workout.toUpperCase())} · This session will establish the baseline.</td></tr></table>`;
  const plan = args.includePlan ? args.exercises.map((exercise,index)=>{
    const last = exercise.lastSets.length ? exercise.lastSets.map(s=>`${formatWeight(s.weight)} × ${s.reps} (${effortLabel(s.effortKey,s.rir)})`).join(" / ") : "No completed working sets yet";
    const startColor = exercise.coach.action === "RECOVERY" || exercise.coach.action === "REDUCE" ? "#ffb35a" : "#46ea97";
    return `<tr>
      <td width="40" valign="middle" style="width:40px;padding:16px 8px;border-bottom:1px solid #165677;color:#5dd6ff;font-family:Arial,sans-serif;font-size:17px;line-height:23px;font-weight:900;">${String(index+1).padStart(2,"0")}</td>
      <td valign="middle" style="padding:16px 8px 16px 4px;border-bottom:1px solid #165677;">
        <div style="font-family:Arial,Helvetica,sans-serif;color:#ffffff;font-size:16px;line-height:21px;font-weight:900;">${htmlEscape(exercise.name)}</div>
        <div style="padding-top:5px;font-family:Arial,sans-serif;color:#b9d5e5;font-size:12px;line-height:17px;font-weight:700;">${exercise.sets} sets · ${exercise.repMin}–${exercise.repMax} reps</div>
        ${args.includeProgress ? `<div class="lastDesktop" style="padding-top:4px;font-family:Arial,sans-serif;color:#83b7cb;font-size:11px;line-height:16px;font-weight:600;">LAST: ${htmlEscape(last)}</div>` : ""}
        <div class="mobileCoach" style="display:none;max-height:0;overflow:hidden;mso-hide:all;">
          <span style="color:${startColor};font-weight:900;">${htmlEscape(coachCommand(exercise))}</span> &nbsp;·&nbsp; ${htmlEscape(exercise.coach.repPlan)}<br>
          <span style="color:#77d8f3;">${htmlEscape(decisionLabel(exercise.coach.action))}</span>
          ${args.includeProgress ? `<div style="padding-top:4px;color:#93bcce;font-size:11px;line-height:16px;">LAST: ${htmlEscape(exercise.lastSets.length ? exercise.lastSets.map(s=>`${formatWeight(s.weight)} × ${s.reps} ${effortLabel(s.effortKey,s.rir)}`).join(" / ") : "No completed working sets")}</div>` : ""}
        </div>
      </td>
      <td class="planStart" width="128" valign="middle" style="width:128px;padding:16px 5px;border-bottom:1px solid #165677;">
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:22px;font-weight:900;color:${startColor};">${htmlEscape(coachCommand(exercise))}</div>
        <div style="padding-top:3px;font-family:Arial,sans-serif;color:#91d5ef;font-size:11px;line-height:16px;font-weight:800;">${htmlEscape(decisionLabel(exercise.coach.action))}</div>
      </td>
      <td class="planReps" width="160" valign="middle" style="width:160px;padding:16px 5px;border-bottom:1px solid #165677;font-family:Arial,sans-serif;color:#ffffff;font-size:14px;line-height:21px;font-weight:900;">${htmlEscape(exercise.coach.repPlan)}</td>
      <td width="20" align="right" valign="middle" style="width:20px;padding:16px 6px 16px 0;border-bottom:1px solid #165677;font-family:Arial,sans-serif;color:#ff971a;font-size:22px;font-weight:900;">›</td>
    </tr>`;
  }).join("") : "";
  const date = localDateLabel(new Date().toISOString(), args.timezone || "America/New_York");
  const tip = priority ? firstExerciseCue(priority.name) : args.coachCue;
  const recovery = args.decisionCounts.recovery
    ? `${args.decisionCounts.recovery} exercise${args.decisionCounts.recovery===1?" requires":"s require"} load or recovery review. Follow your current in-workout coaching.`
    : "No active load or recovery correction flagged in available workout history.";
  const preview = `${args.exercises.length} exercises · ${args.totalSets} sets · ${priority ? `${priority.name}: ${coachCommand(priority)}` : "Your plan is ready"}.`;
  const buttonText = args.isReminder ? "OPEN YOUR WORKOUT" : "START YOUR WORKOUT";
  const cta = `<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="#ff941e" style="background:#ff941e;border:1px solid #ffbb4a;border-radius:12px;">
    <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${htmlEscape(sessionHref)}" style="height:62px;v-text-anchor:middle;width:365px;" arcsize="18%" strokecolor="#ffb83e" fillcolor="#ff941e"><w:anchorlock/><center style="color:#061320;font:900 20px Arial,sans-serif;">${htmlEscape(buttonText)}</center></v:roundrect><![endif]-->
    <!--[if !mso]><!--><a href="${htmlEscape(sessionHref)}" style="display:inline-block;min-width:245px;padding:19px 23px;border-radius:12px;white-space:nowrap;color:#061320;background-color:#ff941e;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:20px;line-height:24px;font-weight:900;">▶ &nbsp; ${htmlEscape(buttonText)} &nbsp; ›</a><!--<![endif]-->
  </td></tr></table>`;
  const logo = `<img src="${htmlEscape(logoHref)}" alt="MVP Trainer Pro" width="304" style="display:block;width:304px;max-width:100%;height:auto;border:0;outline:none;">`;
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${htmlEscape(args.workout)} | MVP Trainer Pro</title>
    <style type="text/css">
      body,table,td{margin:0;padding:0} table{border-spacing:0}img{border:0;outline:none;text-decoration:none}a{color:inherit}
      @media screen and (max-width:800px) {
        .emailShell{width:100%!important;max-width:100%!important;}.emailGutter{padding-left:12px!important;padding-right:12px!important;}
        .heroTitle{font-size:38px!important;line-height:41px!important;}.heroPhoto{width:36%!important;}.heroPhoto img{width:100%!important;max-width:100%!important;height:auto!important;}
        .priorityImage{display:none!important;width:0!important;max-height:0!important;overflow:hidden!important}.planReps{width:105px!important;font-size:12px!important;line-height:18px!important}.planStart{width:103px!important;}
      }
      @media screen and (max-width:460px) {
        .heroTitle{font-size:32px!important;line-height:37px!important}.heroPhoto{display:none!important;max-height:0!important;width:0!important;overflow:hidden!important}
        .priorityImage{display:none!important}.emailGutter{padding-left:10px!important;padding-right:10px!important}
        .planStart,.planReps{display:none!important;width:0!important;max-height:0!important;overflow:hidden!important;padding:0!important;}
        .mobileCoach{display:block!important;max-height:none!important;overflow:visible!important;padding-top:7px!important;font-family:Arial,Helvetica,sans-serif!important;font-size:13px!important;line-height:18px!important;color:#ffffff!important;}
        .lastDesktop{display:none!important;}
      }
    </style>
    <!--[if mso]><style type="text/css">table{border-collapse:collapse!important}td{mso-line-height-rule:exactly}</style><![endif]-->
  </head><body style="margin:0;padding:0;width:100%;background-color:#020a12;color:#ffffff;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none!important;font-size:1px;color:#020a12;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${htmlEscape(preview)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width:100%;background:#020a12;"><tr><td align="center" style="padding:12px 5px 28px;">
      <!--[if mso]><table role="presentation" width="800" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" class="emailShell" width="800" border="0" cellspacing="0" cellpadding="0" style="width:800px;max-width:800px;background:#041321;border:1px solid #0b3e59;">
        <tr><td class="emailGutter" style="padding:24px 27px 20px;border-bottom:2px solid #00c6fa;background:#020e1b;">
          <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0"><tr>
            <td width="55%" valign="middle" align="left">${logo}</td>
            <td width="45%" align="right" valign="middle" style="font-family:Arial,sans-serif;font-size:15px;line-height:21px;color:#ffffff;font-weight:900;letter-spacing:.6px;">TRAIN SMARTER.<br><span style="color:#ff9226;">GET STRONGER.</span></td>
          </tr></table>
        </td></tr>
        <tr><td class="emailGutter" style="padding:31px 27px 16px;background:#041321;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td valign="middle" style="padding-right:12px;">
              <div style="font-family:Arial,sans-serif;color:#09d9fa;font-size:18px;line-height:25px;font-weight:900;letter-spacing:.5px;">YOUR WORKOUT BRIEFING${args.isTest ? " · TEST" : ""}</div>
              <div class="heroTitle" style="padding-top:6px;font-family:Arial,sans-serif;color:#ffffff;font-size:55px;line-height:60px;font-weight:900;letter-spacing:-1px;">${htmlEscape(args.workout.toUpperCase())}</div>
              <div style="padding-top:5px;font-family:Arial,sans-serif;color:#d6effc;font-size:23px;line-height:29px;font-weight:800;">${htmlEscape(args.goal)}</div>
              ${args.isReminder ? `<div style="padding-top:10px;font-family:Arial,sans-serif;color:#ffad53;font-size:12px;line-height:18px;font-weight:800;">REMINDER ${args.reminderNumber} · YOUR SESSION IS STILL UP NEXT</div>` : ""}
            </td>
            <td class="heroPhoto" width="295" valign="middle" align="right" style="width:295px;"><img src="${htmlEscape(heroHref)}" width="295" alt="" style="display:block;width:295px;max-width:295px;height:auto;"></td>
          </tr></table>
        </td></tr>
        <tr><td class="emailGutter" style="padding:8px 27px 18px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          ${mailMetric(String(args.exercises.length),"EXERCISES")}
          ${mailMetric(String(args.totalSets),"WORKING SETS")}
          ${mailMetric(args.expectedMinutes ? `~${Math.round(args.expectedMinutes)} min` : "—","EST. DURATION")}
        </tr></table></td></tr>
        <tr><td class="emailGutter" align="center" style="padding:2px 27px 26px;">${cta}</td></tr>
        <tr><td class="emailGutter" style="padding:0 27px 17px;">${args.includeProgress ? previous : ""}</td></tr>
        <tr><td class="emailGutter" style="padding:0 27px 18px;">${priorityBody}</td></tr>
        ${args.includePlan ? `<tr><td class="emailGutter" style="padding:0 27px 18px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#061929;border:2px solid #03bbf0;">
          <tr><td style="padding:19px 18px 13px;border-bottom:1px solid #1b6c88;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
              <td style="color:#ffffff;font-family:Arial,sans-serif;font-size:23px;line-height:29px;font-weight:900;">▤ &nbsp; TODAY'S WORKOUT PLAN</td>
              <td align="right" style="color:#74dcff;font-family:Arial,sans-serif;font-size:12px;line-height:19px;font-weight:800;">${args.exercises.length} EXERCISES</td>
            </tr></table>
            <div style="padding-top:5px;font-family:Arial,sans-serif;color:#9ad8f0;font-size:13px;line-height:20px;">Your active program · ${args.totalSets} working sets · ${args.expectedMinutes ? `~${Math.round(args.expectedMinutes)} min` : "duration varies"}</div>
          </td></tr>
          <tr><td style="padding:0 13px 11px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${plan}</table></td></tr>
        </table></td></tr>` : ""}
        <tr><td class="emailGutter" style="padding:0 27px 18px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#071e31;border:1px solid #167da4;"><tr><td style="padding:17px 19px;">
          <div style="color:#7de3ff;font-family:Arial,sans-serif;font-size:15px;line-height:22px;font-weight:900;">ADDITIONAL NOTES</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:11px;"><tr>
            <td width="50%" valign="top" style="width:50%;padding-right:10px;color:#c4dfeb;font-family:Arial,sans-serif;font-size:13px;line-height:19px;"><span style="color:#69deff;font-weight:900;">RECOVERY</span><br>${htmlEscape(recovery)}</td>
            <td width="50%" valign="top" style="width:50%;padding-left:13px;border-left:1px solid #226487;color:#c4dfeb;font-family:Arial,sans-serif;font-size:13px;line-height:19px;"><span style="color:#69deff;font-weight:900;">COACHING FOCUS</span><br>${htmlEscape(args.includeTip ? tip : "Follow the recorded workout plan and use your in-session feedback.")}</td>
          </tr></table>
        </td></tr></table></td></tr>
        <tr><td class="emailGutter" style="padding:18px 27px 23px;border-top:3px solid #02c5ef;background:#020e19;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="color:#2fd4ff;font-family:Arial,sans-serif;font-size:15px;line-height:21px;font-weight:900;letter-spacing:1px;">CONSISTENCY BUILDS RESULTS.</td>
          <td align="right" style="color:#ffffff;font-family:Arial,sans-serif;font-size:15px;line-height:21px;font-weight:900;">MVP TRAINER <span style="color:#ff972b;">PRO</span></td>
        </tr></table>
        <div style="padding-top:13px;text-align:center;color:#99b6c8;font-family:Arial,sans-serif;font-size:12px;line-height:18px;">Briefing generated ${htmlEscape(date)}. Recommendations can update after new completed performance; the current workout is authoritative.</div>
        <div style="padding-top:7px;text-align:center;color:#7ec7df;font-family:Arial,sans-serif;font-size:12px;line-height:18px;">TRAIN &nbsp; · &nbsp; TRACK &nbsp; · &nbsp; IMPROVE &nbsp; · &nbsp; ACHIEVE</div>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr></table>
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

  // All completed exposures in this active program. Match the R39 Coach tab:
  // same completed workout boundary, canonical-name grouping, chronological order,
  // and the complete working-set sequence (not just a single best set).
  const { data: programSessions, error: programSessionsError } = await admin
    .from("scheduled_sessions")
    .select("id,session_type")
    .eq("user_id", userId)
    .eq("program_block_id", program.id)
    .limit(1000);
  if (programSessionsError) throw programSessionsError;
  const programSessionMap = new Map((programSessions ?? []).map((row: any) => [row.id, row]));
  const allCompleted: any[] = [];
  for (const ids of batches(Array.from(programSessionMap.keys()))) {
    const response = await admin.from("workouts")
      .select("id,scheduled_session_id,completed_at,started_at,ended_at,active_seconds,bodyweight_lb,post_difficulty,session_rating")
      .eq("user_id", userId).in("scheduled_session_id", ids)
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false }).limit(1000);
    if (response.error) throw response.error;
    allCompleted.push(...(response.data ?? []));
  }
  allCompleted.sort((a,b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime());
  // The Coach currently caps completed workouts at 1,000. Do not silently
  // compute from a different historical window in email.
  if (allCompleted.length > 1000) throw new Error("Coaching history exceeds the supported 1,000 completed-session window; email not sent with inconsistent recommendations.");
  const latestSameType = allCompleted.filter((row: any) =>
    lower((programSessionMap.get(row.scheduled_session_id) as any)?.session_type) === lower(session.session_type));
  const previousWorkout = latestSameType[0] ?? null;
  const allWorkExerciseRows: any[] = [];
  for (const ids of batches(allCompleted.map(row => row.id), 40)) {
    const result = await admin.from("workout_exercises")
      .select("id,workout_id,exercise_id,pain,difficulty")
      .in("workout_id", ids).limit(1000);
    if (result.error) throw result.error;
    allWorkExerciseRows.push(...(result.data ?? []));
  }
  const allExerciseIds = unique([...exerciseIds, ...allWorkExerciseRows.map(r => r.exercise_id)]);
  const historyExerciseRows: any[] = [];
  for (const ids of batches(allExerciseIds)) {
    const response = await admin.from("exercises")
      .select("id,name,primary_muscles,equipment").in("id", ids).limit(1000);
    if (response.error) throw response.error;
    historyExerciseRows.push(...(response.data ?? []));
  }
  // Resolve the same per-user display names that CoachPage resolves before
  // canonical name grouping. A rename never rewrites historical set records.
  const { data: nameOverrides, error: nameOverrideError } = await admin
    .from("exercise_name_overrides").select("exercise_id,display_name")
    .eq("user_id", userId);
  if (nameOverrideError && !/does not exist|relation/i.test(nameOverrideError.message || "")) throw nameOverrideError;
  const overrideMap = new Map((nameOverrides ?? [])
    .filter((x:any)=>clean(x.display_name)).map((x:any)=>[x.exercise_id, clean(x.display_name)]));
  for (const row of historyExerciseRows) row.name = overrideMap.get(row.id) || row.name;
  for (const row of exerciseRows) row.name = overrideMap.get(row.id) || row.name;
  const historyMetadata = new Map(historyExerciseRows.map((row: any) => [row.id, row]));
  const allSetRows: any[] = [];
  for (const ids of batches(allWorkExerciseRows.map(row => row.id), 50)) {
    const response = await admin.from("workout_sets")
      .select("workout_exercise_id,set_index,reps,weight,rir,effort_key")
      .in("workout_exercise_id", ids).order("set_index", { ascending: true }).limit(1000);
    if (response.error) throw response.error;
    allSetRows.push(...(response.data ?? []));
  }
  const workoutById = new Map(allCompleted.map((row: any) => [row.id, row]));
  const workExerciseById = new Map(allWorkExerciseRows.map((row: any) => [row.id, row]));
  const setsByWorkExercise = new Map<string, LastSet[]>();
  let priorStats: PriorStats | null = null;
  let previousCompletedSets = 0;
  let previousVolume = 0;
  const previousExerciseIds = new Set<string>();
  for (const raw of allSetRows) {
    const we: any = workExerciseById.get(raw.workout_exercise_id);
    if (!we) continue;
    const set: LastSet = {
      setIndex: num(raw.set_index), weight: num(raw.weight), reps: num(raw.reps),
      rir: raw.rir == null ? null : num(raw.rir),
      effortKey: typeof raw.effort_key === "string" ? raw.effort_key : null,
      pain: we.pain == null ? null : num(we.pain),
    };
    const list = setsByWorkExercise.get(we.id) ?? [];
    list.push(set);
    setsByWorkExercise.set(we.id, list);
    if (we.workout_id === previousWorkout?.id && set.reps > 0) {
      previousCompletedSets++;
      previousExerciseIds.add(we.exercise_id);
      if (set.weight > 0) previousVolume += set.weight * set.reps;
    }
  }
  if (previousWorkout) {
    priorStats = {
      completedAt: previousWorkout.completed_at ?? null,
      dateLabel: localDateLabel(previousWorkout.completed_at, pref.timezone),
      ageLabel: daysAgoLabel(previousWorkout.completed_at),
      durationSeconds: durationSeconds(previousWorkout),
      completedSets: previousCompletedSets,
      completedExercises: previousExerciseIds.size,
      loadedVolume: previousVolume,
      bodyweight: previousWorkout.bodyweight_lb == null ? null : num(previousWorkout.bodyweight_lb),
      difficulty: clean(previousWorkout.post_difficulty || previousWorkout.session_rating) || null,
    };
  }
  const historyByMovement = new Map<string, TrainingSessionSample[]>();
  const recentByMovement = new Map<string, { sets: LastSet[]; completedAt: string }>();
  // Sorting is chronological just like CoachPage's pointsMap before analysis.
  for (const we of allWorkExerciseRows.slice().sort((a,b) =>
    new Date((workoutById.get(a.workout_id) as any)?.completed_at ?? 0).getTime() -
    new Date((workoutById.get(b.workout_id) as any)?.completed_at ?? 0).getTime())) {
    const workout: any = workoutById.get(we.workout_id);
    const meta: any = historyMetadata.get(we.exercise_id);
    if (!workout || !meta) continue;
    const sets = (setsByWorkExercise.get(we.id) ?? [])
      .filter(x => x.weight > 0 && x.reps > 0).sort((a,b) => a.setIndex-b.setIndex);
    if (!sets.length) continue;
    const key = movementKey(meta.name, we.exercise_id);
    const list = historyByMovement.get(key) ?? [];
    list.push({
      sets: sets.map(x => ({ weight:x.weight, reps:x.reps, rir:x.rir })),
      pain: we.pain == null ? null : num(we.pain),
      difficulty: we.difficulty ?? null,
      completedAt: workout.completed_at ?? null,
    });
    historyByMovement.set(key, list);
    recentByMovement.set(key, { sets, completedAt: workout.completed_at });
  }
  const priorWorkouts = latestSameType.slice(0,6);
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
    const key = movementKey(meta.name, row.exercise_id);
    const sessions = historyByMovement.get(key) ?? [];
    const lastSets = recentByMovement.get(key)?.sets ?? [];
    const best = lastSets.slice().sort((a,b) => e1rm(b.weight,b.reps)-e1rm(a.weight,a.reps))[0] ?? null;
    const setsTarget = Math.max(1, num(row.sets, 3));
    const repMin = Math.max(1, num(row.rep_min, 8));
    const repMax = Math.max(repMin, num(row.rep_max, 12));
    const coach = analyzeProgression({
      goal: program.goal, sessions, repMin, repMax, setsTarget,
      exercise: { name: meta.name ?? "Exercise", equipment: equipment.map(clean), primary_muscles: Array.isArray(meta.primary_muscles) ? meta.primary_muscles : [] },
    });
    return {
      id: row.exercise_id,
      name: clean(meta.name) || "Exercise",
      sets: setsTarget,
      repMin, repMax,
      restSeconds: Math.max(0, num(row.rest_seconds, 90)),
      muscles: Array.isArray(meta.primary_muscles) ? meta.primary_muscles.map(clean).filter(Boolean) : [],
      equipment: equipment.map(clean),
      patterns: patterns.map(clean),
      last: best,
      lastSets,
      coach,
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
  const baseGoal = goalLabel(program.goal);
  const symptomDisplay = symptom ? titleCase(symptom.replace(/_/g, " ")) : "";
  const goal = symptomDisplay && !baseGoal.toLowerCase().includes(symptomDisplay.toLowerCase()) ? `${baseGoal} + ${symptomDisplay}` : baseGoal;
  const motivationSeed = `${session.id}:${options.isReminder ? `reminder-${options.reminderNumber}` : "ready"}`;
  const motivation = MOTIVATION[hashIndex(motivationSeed, MOTIVATION.length)];
  const first = exercises[0] ?? null;
  const priority = exercises.slice().sort((a,b) => {
    const directiveRank = (x: ExerciseBrief) => x.coach.exerciseDirective === "PAUSE" ? 0 : x.coach.exerciseDirective === "SWAP REVIEW" ? 1 : 2;
    const ranks: Record<string,number> = { RECOVERY:0, REDUCE:1, INCREASE:2, MONITOR:3, HOLD:4, BASELINE:5 };
    return directiveRank(a)-directiveRank(b) || (ranks[a.coach.action] ?? 9)-(ranks[b.coach.action] ?? 9);
  })[0] ?? null;
  const decisionCounts = {
    increase: exercises.filter(x => x.coach.action === "INCREASE").length,
    hold: exercises.filter(x => x.coach.action === "HOLD" || x.coach.action === "MONITOR").length,
    recovery: exercises.filter(x => x.coach.action === "REDUCE" || x.coach.action === "RECOVERY" || x.coach.exerciseDirective === "PAUSE" || x.coach.exerciseDirective === "SWAP REVIEW").length,
  };
  const progression = priority?.coach.reason ?? "Choose a controlled starting load and log the completed working sets.";
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
    priority,
    decisionCounts,
    heroUrl: `${appUrl.replace(/\/$/, "")}/email/mvp-workout-hero.jpg`,
    timezone: pref.timezone || "America/New_York",
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
  // Coach and Workout use the active program, never a stale email-preference pin.
  const { data: activeProgram, error: activeProgramError } = await admin.from("program_blocks")
    .select("id").eq("user_id", userId).eq("status", "active")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (activeProgramError) throw activeProgramError;
  const programId = activeProgram?.id ?? null;
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
    const subject = `[TEST] ${context.workout} | MVP Trainer Pro Performance Briefing`;
    await sendMail({ admin, mailEndpoint: args.mailEndpoint, mailSecret: args.mailSecret, destination, subject, html: renderEmail(context), deliveryId: null });
    return { ok: true, sent: true, subject, session_id: session.id };
  }

  if (!pref.enabled || !pref.workout_ready) return { ok: true, skipped: true, reason: "disabled" };

  if (args.action === "ready") {
    const context = await buildContext(admin, userId, authUser, pref, program, session, args.appUrl, { isTest: false, isReminder: false, reminderNumber: 0, readyAgeHours: null });
    const subject = `${context.workout} Is Ready | Your Workout Briefing — MVP Trainer Pro`;
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
    const subject = `${context.workout} Is Ready | Your Workout Briefing — MVP Trainer Pro`;
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
  const subject = `Your ${context.workout} Workout Is Waiting | MVP Trainer Pro`;
  const kind = `workout_reminder_${reminderNumber}`;
  const reservation = await reserveDelivery(admin, { userId, programId, sessionId: session.id, kind, subject, destination, reason: args.reason });
  if (reservation.skipped) return { ok: true, skipped: true, reason: "reminder_already_sent_or_processing", session_id: session.id };
  await sendMail({ admin, mailEndpoint: args.mailEndpoint, mailSecret: args.mailSecret, destination, subject, html: renderEmail(context), deliveryId: reservation.id });
  return { ok: true, sent: true, kind, session_id: session.id };
}

Deno.serve(async (req: Request) => {
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
