import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
];

function coachCue(sessionType: string, symptom: string | null) {
  if (symptom === "posture") {
    if (/upper/i.test(sessionType)) return "Keep your neck neutral and ribs stacked. Let the shoulder blades move naturally instead of forcing them down and back.";
    return "Brace before every working set and keep the rib cage stacked over the pelvis. Strong lower-body reps should not turn into low-back compensation.";
  }
  if (symptom === "shoulder_pain") return "Use a controlled, pain-free range. If symptoms travel farther down the arm or increase set to set, stop forcing the movement and modify it.";
  if (symptom === "back_pain") return "Brace before the rep, control the eccentric, and keep the load where your trunk position stays solid. Pain progression is not a training target.";
  if (symptom === "knee_pain") return "Use the deepest comfortable range you can control. Keep foot pressure stable and let the knee track naturally with the toes.";
  if (/upper/i.test(sessionType)) return "Keep the neck quiet, control the eccentric, and make the target muscle—not momentum—finish each rep.";
  return "Brace first, own the lowering phase, and keep every rep repeatable. Strong technique makes progression data useful.";
}

function progressCue(last: { weight: number; reps: number; rir: number | null; pain: number | null } | null, repMax: number) {
  if (!last) return "Baseline day: choose a working load you can control through the full target range with roughly 1–2 good reps still available.";
  if ((last.pain ?? 0) >= 4) return `Last time pain reached ${last.pain}/10. Keep progression on hold unless today's movement is comfortable and controlled.`;
  if (last.reps >= repMax && last.weight > 0) return `Last best set: ${last.weight} lb × ${last.reps}. If all working sets are equally clean today, earn the smallest practical load increase.`;
  if (last.weight > 0) return `Last best set: ${last.weight} lb × ${last.reps}. Build clean reps inside today's target before forcing a heavier load.`;
  return `Last best set reached ${last.reps} reps. Keep execution consistent and progress one variable at a time.`;
}

function renderEmail(args: {
  workout: string;
  goal: string;
  estimatedMinutes: number | null;
  exercises: Array<{ name: string; sets: number; repMin: number; repMax: number; muscles: string[]; last: { weight: number; reps: number; rir: number | null; pain: number | null } | null }>;
  motivation: string;
  coachCue: string;
  progressCue: string;
  includeTip: boolean;
  includePlan: boolean;
  includeProgress: boolean;
  appUrl: string;
  sessionId: string;
  isTest: boolean;
}) {
  const exerciseCount = args.exercises.length;
  const first = args.exercises[0] ?? null;
  const plan = args.includePlan ? args.exercises.map((exercise, index) => `
    <tr>
      <td style="padding:14px 0;border-bottom:1px solid #1c3440;vertical-align:top;width:42px;color:#52ddff;font-size:13px;font-weight:900;">${String(index + 1).padStart(2, "0")}</td>
      <td style="padding:14px 8px 14px 0;border-bottom:1px solid #1c3440;vertical-align:top;">
        <div style="color:#f7fbfd;font-size:16px;font-weight:900;line-height:1.2;">${htmlEscape(exercise.name)}</div>
        <div style="margin-top:5px;color:#8da9b6;font-size:12px;font-weight:700;">${exercise.sets} sets • ${exercise.repMin}–${exercise.repMax} reps${exercise.muscles.length ? ` • ${htmlEscape(exercise.muscles.slice(0, 2).map(titleCase).join(" / "))}` : ""}</div>
      </td>
    </tr>`).join("") : "";

  const heroSub = [
    exerciseCount ? `${exerciseCount} exercises` : null,
    args.estimatedMinutes ? `~${Math.round(args.estimatedMinutes)} min` : null,
    args.goal || null,
  ].filter(Boolean).join(" • ");

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#05090d;font-family:Arial,Helvetica,sans-serif;color:#f7fbfd;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#05090d;padding:24px 10px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:680px;background:#091118;border:1px solid #17313e;border-radius:18px;overflow:hidden;">
        <tr><td style="padding:22px 26px;background:linear-gradient(135deg,#0b1b24,#071015);border-bottom:1px solid #17313e;">
          <div style="color:#55ddff;font-size:11px;font-weight:900;letter-spacing:2px;">MVP TRAINER PRO${args.isTest ? " • TEST" : ""}</div>
          <div style="margin-top:10px;color:#8af0b9;font-size:12px;font-weight:900;letter-spacing:1.4px;">READY TO TRAIN</div>
          <div style="margin-top:6px;color:#ffffff;font-size:36px;line-height:1.05;font-weight:950;">${htmlEscape(args.workout)}</div>
          <div style="margin-top:9px;color:#9cb3be;font-size:14px;font-weight:700;">${htmlEscape(heroSub)}</div>
        </td></tr>
        <tr><td style="padding:24px 26px;">
          <div style="padding:18px 20px;border:1px solid #294451;border-radius:14px;background:#0c171e;">
            <div style="color:#ffab3d;font-size:11px;font-weight:900;letter-spacing:1.4px;">TODAY'S STANDARD</div>
            <div style="margin-top:8px;color:#ffffff;font-size:20px;line-height:1.35;font-weight:900;">${htmlEscape(args.motivation)}</div>
          </div>
          ${first ? `<div style="margin-top:20px;padding:18px 20px;border-left:3px solid #55ddff;background:#08141b;border-radius:8px;">
            <div style="color:#55ddff;font-size:10px;font-weight:900;letter-spacing:1.4px;">FIRST EXERCISE</div>
            <div style="margin-top:7px;color:#ffffff;font-size:23px;font-weight:950;">${htmlEscape(first.name)}</div>
            <div style="margin-top:5px;color:#9db2bc;font-size:13px;font-weight:700;">${first.sets} sets • ${first.repMin}–${first.repMax} reps</div>
          </div>` : ""}
          ${args.includeTip ? `<div style="margin-top:20px;">
            <div style="color:#b79cff;font-size:10px;font-weight:900;letter-spacing:1.4px;">COACH FOCUS</div>
            <div style="margin-top:7px;color:#dce9ee;font-size:15px;line-height:1.55;font-weight:700;">${htmlEscape(args.coachCue)}</div>
          </div>` : ""}
          ${args.includeProgress ? `<div style="margin-top:20px;">
            <div style="color:#ffb35a;font-size:10px;font-weight:900;letter-spacing:1.4px;">PROGRESSION NOTE</div>
            <div style="margin-top:7px;color:#dce9ee;font-size:15px;line-height:1.55;font-weight:700;">${htmlEscape(args.progressCue)}</div>
          </div>` : ""}
          ${args.includePlan ? `<div style="margin-top:24px;color:#8da9b6;font-size:10px;font-weight:900;letter-spacing:1.4px;">WORKOUT PLAN</div>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:4px;">${plan}</table>` : ""}
          <div style="text-align:center;margin:28px 0 8px;">
            <a href="${htmlEscape(args.appUrl.replace(/\/$/, ""))}/workout/${encodeURIComponent(args.sessionId)}" style="display:inline-block;background:#35c98a;color:#03120c;text-decoration:none;font-size:14px;font-weight:950;letter-spacing:.4px;padding:15px 24px;border-radius:10px;">START ${htmlEscape(args.workout.toUpperCase())}</a>
          </div>
          <div style="margin-top:18px;text-align:center;color:#637b86;font-size:11px;line-height:1.5;">Sent by MVP Trainer Pro because this workout is your current ready session. Notification settings live in Coach.</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
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

    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401, headers: CORS });

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: auth, error: authError } = await admin.auth.getUser(jwt);
    if (authError || !auth.user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401, headers: CORS });

    const body = await req.json().catch(() => ({}));
    const action = body?.action === "test" ? "test" : "ready";
    const reason = clean(body?.reason) || action;
    const userId = auth.user.id;

    const { data: pref, error: prefError } = await admin
      .from("training_email_preferences")
      .select("user_id,program_block_id,enabled,workout_ready,include_coach_tip,include_exercise_plan,include_progress_snapshot,email_override,timezone")
      .eq("user_id", userId)
      .maybeSingle();
    if (prefError) throw prefError;
    if (!pref) return Response.json({ ok: true, skipped: true, reason: "not_configured" }, { headers: CORS });
    if (action === "ready" && (!pref.enabled || !pref.workout_ready)) return Response.json({ ok: true, skipped: true, reason: "disabled" }, { headers: CORS });

    let programId = pref.program_block_id as string | null;
    if (!programId) {
      const { data: active } = await admin.from("program_blocks").select("id").eq("user_id", userId).eq("status", "active").order("created_at", { ascending: false }).limit(1).maybeSingle();
      programId = active?.id ?? null;
    }
    if (!programId) return Response.json({ ok: true, skipped: true, reason: "no_program" }, { headers: CORS });

    const { data: program, error: programError } = await admin
      .from("program_blocks")
      .select("id,user_id,goal,goal_mode,intake_snapshot_id,status")
      .eq("id", programId)
      .eq("user_id", userId)
      .maybeSingle();
    if (programError) throw programError;
    if (!program) return Response.json({ ok: true, skipped: true, reason: "program_not_found" }, { headers: CORS });

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
    if (!viable.length) return Response.json({ ok: true, skipped: true, reason: "no_ready_session" }, { headers: CORS });

    const queueIds = viable.map((row: any) => row.id);
    const { data: completedRows, error: completedError } = await admin
      .from("workouts")
      .select("scheduled_session_id,completed_at")
      .eq("user_id", userId)
      .in("scheduled_session_id", queueIds)
      .not("completed_at", "is", null);
    if (completedError) throw completedError;
    const completedIds = new Set((completedRows ?? []).map((row: any) => row.scheduled_session_id));
    const session = viable.find((row: any) => !completedIds.has(row.id));
    if (!session) return Response.json({ ok: true, skipped: true, reason: "no_ready_session" }, { headers: CORS });

    let priorDelivery: any = null;
    if (action === "ready") {
      const { data: existing, error: existingError } = await admin
        .from("training_email_deliveries")
        .select("id,status,sent_at")
        .eq("user_id", userId)
        .eq("scheduled_session_id", session.id)
        .eq("kind", "workout_ready")
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing?.status === "sent") return Response.json({ ok: true, skipped: true, reason: "already_sent", session_id: session.id }, { headers: CORS });
      if (existing?.status === "pending") return Response.json({ ok: true, skipped: true, reason: "already_processing", session_id: session.id }, { headers: CORS });
      priorDelivery = existing ?? null;
    }

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
      const result = await admin.from("exercises").select("id,name,primary_muscles,secondary_muscles").in("id", exerciseIds);
      if (result.error) throw result.error;
      exerciseRows = result.data ?? [];
    }
    const exerciseMap = new Map(exerciseRows.map((row: any) => [row.id, row]));

    // Previous completed session of the same workout type, used only for a concise progress snapshot.
    const { data: sameTypeRows } = await admin
      .from("scheduled_sessions")
      .select("id")
      .eq("user_id", userId)
      .eq("program_block_id", programId)
      .eq("session_type", session.session_type)
      .limit(120);
    const sameTypeIds = (sameTypeRows ?? []).map((row: any) => row.id);
    let previousWorkout: any = null;
    if (sameTypeIds.length) {
      const result = await admin
        .from("workouts")
        .select("id,scheduled_session_id,completed_at")
        .eq("user_id", userId)
        .in("scheduled_session_id", sameTypeIds)
        .not("completed_at", "is", null)
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!result.error) previousWorkout = result.data;
    }

    const lastMap = new Map<string, { weight: number; reps: number; rir: number | null; pain: number | null }>();
    if (previousWorkout?.id && exerciseIds.length) {
      const { data: weRows } = await admin
        .from("workout_exercises")
        .select("id,exercise_id,pain")
        .eq("workout_id", previousWorkout.id)
        .in("exercise_id", exerciseIds);
      const weIds = (weRows ?? []).map((row: any) => row.id);
      let setRows: any[] = [];
      if (weIds.length) {
        const result = await admin.from("workout_sets").select("workout_exercise_id,reps,weight,rir,set_index").in("workout_exercise_id", weIds);
        if (!result.error) setRows = result.data ?? [];
      }
      const weById = new Map((weRows ?? []).map((row: any) => [row.id, row]));
      for (const set of setRows) {
        const we: any = weById.get(set.workout_exercise_id);
        if (!we?.exercise_id) continue;
        const candidate = { weight: num(set.weight), reps: num(set.reps), rir: set.rir == null ? null : num(set.rir), pain: we.pain == null ? null : num(we.pain) };
        const prior = lastMap.get(we.exercise_id);
        if (!prior || candidate.weight > prior.weight || (candidate.weight === prior.weight && candidate.reps > prior.reps)) lastMap.set(we.exercise_id, candidate);
      }
    }

    let symptom: string | null = null;
    if (program.intake_snapshot_id) {
      const { data: intake } = await admin.from("intake_snapshots").select("symptoms").eq("id", program.intake_snapshot_id).maybeSingle();
      symptom = symptomKey(intake?.symptoms ?? null);
    }

    const exercises = (templateExercises ?? []).map((row: any) => {
      const meta: any = exerciseMap.get(row.exercise_id) ?? {};
      return {
        name: clean(meta.name) || "Exercise",
        sets: Math.max(1, num(row.sets, 3)),
        repMin: Math.max(1, num(row.rep_min, 8)),
        repMax: Math.max(1, num(row.rep_max, 12)),
        muscles: Array.isArray(meta.primary_muscles) ? meta.primary_muscles.map(clean).filter(Boolean) : [],
        last: lastMap.get(row.exercise_id) ?? null,
      };
    });

    const workout = workoutName(session.session_type || template?.name);
    const goal = goalLabel(program.goal);
    const motivation = MOTIVATION[hashIndex(String(session.id), MOTIVATION.length)];
    const first = exercises[0] ?? null;
    const progression = first ? progressCue(first.last, first.repMax) : "Start with controlled reps and build from clean execution.";
    const cue = coachCue(workout, symptom);
    const destination = clean(pref.email_override) || clean(auth.user.email);
    if (!destination || !destination.includes("@")) throw new Error("No valid destination email is configured.");

    const subject = `${action === "test" ? "[TEST] " : ""}${workout} is ready — your MVP Coach brief`;
    const html = renderEmail({
      workout,
      goal,
      estimatedMinutes: template?.estimated_minutes == null ? null : num(template.estimated_minutes),
      exercises,
      motivation,
      coachCue: cue,
      progressCue: progression,
      includeTip: pref.include_coach_tip !== false,
      includePlan: pref.include_exercise_plan !== false,
      includeProgress: pref.include_progress_snapshot !== false,
      appUrl,
      sessionId: session.id,
      isTest: action === "test",
    });

    let deliveryId: string | null = null;
    if (action === "ready") {
      if (priorDelivery?.id) {
        const retry = await admin.from("training_email_deliveries").update({
          status: "pending",
          subject,
          destination,
          trigger_reason: reason,
          error_message: null,
        }).eq("id", priorDelivery.id).select("id").single();
        if (retry.error) throw retry.error;
        deliveryId = retry.data.id;
      } else {
        const insert = await admin.from("training_email_deliveries").insert({
          user_id: userId,
          program_block_id: programId,
          scheduled_session_id: session.id,
          kind: "workout_ready",
          status: "pending",
          subject,
          destination,
          trigger_reason: reason,
        }).select("id").single();

        if (insert.error) {
          if (insert.error.code === "23505") {
            return Response.json({ ok: true, skipped: true, reason: "already_sent_or_processing", session_id: session.id }, { headers: CORS });
          }
          throw insert.error;
        }
        deliveryId = insert.data.id;
      }
    }

    const mailResponse = await fetch(mailEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-skyshine-booking-secret": mailSecret,
      },
      body: JSON.stringify({ to: destination, subject, html }),
    });
    const providerBody = await mailResponse.json().catch(() => ({}));

    if (!mailResponse.ok || providerBody?.ok !== true) {
      const providerError = clean(providerBody?.error || `WordPress mail returned HTTP ${mailResponse.status}`);
      if (deliveryId) await admin.from("training_email_deliveries").update({ status: "failed", error_message: providerError }).eq("id", deliveryId);
      throw new Error(providerError || "WordPress mail transport failed.");
    }

    if (deliveryId) {
      await admin.from("training_email_deliveries").update({
        status: "sent",
        provider_message_id: null,
        sent_at: new Date().toISOString(),
        error_message: null,
      }).eq("id", deliveryId);
    }

    return Response.json({ ok: true, sent: true, subject, session_id: session.id }, { headers: CORS });
  } catch (error) {
    console.error("training-coach-email", error);
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500, headers: CORS });
  }
});
