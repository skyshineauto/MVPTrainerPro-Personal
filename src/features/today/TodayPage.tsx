import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { Card } from "../../ui/Card";
import { PlannedSessionEditor } from "./PlannedSessionEditor";
import {
  formatSessionLabel,
  inferSymptomKey,
  isSymptomMode,
  type SymptomKey,
} from "../../lib/sessionLabel";

type QueueDash = {
  activeBlock: any | null;
  nextSession: any | null;
  upcoming: any[];
};

type TemplateSummary = {
  id: string;
  name: string;
  template_type?: string | null;
  focus_tags?: string[] | null;
  estimated_minutes?: number | null;
};

type TemplateExerciseSummary = {
  template_id: string;
  exercise_id: string;
  order_index?: number | null;
  sets?: number | null;
  rep_min?: number | null;
  rep_max?: number | null;
  rest_seconds?: number | null;
};

type CompletedWorkoutSummary = {
  id: string;
  scheduled_session_id: string | null;
  completed_at: string;
  active_seconds?: number | null;
  post_difficulty?: string | null;
  session_rating?: number | null;
};

type SessionHistorySummary = {
  count: number;
  lastCompletedAt: string | null;
  averageDurationSeconds: number;
  lastDifficulty: string | null;
  lastRating: number | null;
};

type ScheduleSession = {
  id: string;
  date: string | null;
  sessionType: string;
  templateId: string | null;
  templateName: string | null;
  templateType: string | null;
  focusTags: string[];
  estimatedMinutes: number;
  exerciseCount: number;
  totalSets: number;
  status: string | null;
  history: SessionHistorySummary;
};

type TrainingSummary = {
  completedThisWeek: number;
  averageDurationSeconds: number;
  upcomingMinutes: number;
  progressionSessions: number;
};

const EMPTY_HISTORY: SessionHistorySummary = {
  count: 0,
  lastCompletedAt: null,
  averageDurationSeconds: 0,
  lastDifficulty: null,
  lastRating: null,
};

function uniqueById(rows: any[]) {
  const map = new Map<string, any>();

  for (const row of rows) {
    const id = String(row?.id ?? "").trim();
    if (!id || map.has(id)) continue;
    map.set(id, row);
  }

  return Array.from(map.values());
}

function finiteNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveInteger(value: unknown, fallback = 0) {
  return Math.max(0, Math.floor(finiteNumber(value, fallback)));
}

function normalizeKey(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function titleCase(value: unknown) {
  return String(value ?? "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

function formatMinutes(value: number) {
  const minutes = Math.max(0, Math.round(value));
  if (minutes < 60) return `${minutes} MIN`;

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}H ${remainder}M` : `${hours}H`;
}

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.round(seconds));
  if (!safe) return "—";

  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);

  if (hours > 0) return `${hours}H ${String(minutes).padStart(2, "0")}M`;
  return `${Math.max(1, minutes)} MIN`;
}

function formatShortDate(value: string | null | undefined) {
  if (!value) return "NOT YET";

  const direct = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00`)
    : new Date(value);

  if (Number.isNaN(direct.getTime())) return "NOT YET";

  return direct
    .toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    })
    .toUpperCase();
}

function formatLongDate(value: string | null | undefined) {
  if (!value) return "Flexible schedule";

  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00`)
    : new Date(value);

  if (Number.isNaN(date.getTime())) return "Flexible schedule";

  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfWeekISO() {
  const now = new Date();
  const day = now.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  const start = new Date(now);
  start.setDate(now.getDate() + offset);
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

function dateStatus(date: string | null) {
  if (!date) return "READY";

  const today = localDateKey();
  if (date <= today) return "READY";
  return "SCHEDULED";
}

function focusLabel(tags: string[]) {
  if (!tags.length) return "Full-body training";
  return tags
    .slice(0, 3)
    .map((tag) => titleCase(tag))
    .join(" · ");
}

function intensityLabel(totalSets: number, estimatedMinutes: number) {
  if (totalSets >= 22 || estimatedMinutes >= 75) return "HIGH";
  if (totalSets >= 14 || estimatedMinutes >= 50) return "MODERATE-HIGH";
  if (totalSets >= 8 || estimatedMinutes >= 35) return "MODERATE";
  return "CONTROLLED";
}

function readinessCopy(status: string, history: SessionHistorySummary) {
  if (status === "IN PROGRESS") return "Session controls are available above.";
  if (!history.count) return "Baseline session ready to establish performance.";
  if (history.lastDifficulty === "too_hard") {
    return "Previous session was hard. Open conservatively and own the range.";
  }
  if (history.lastRating != null && history.lastRating >= 4) {
    return "Strong prior session. Look for a clean progression opportunity.";
  }
  return "Build on the previous performance with clean, repeatable reps.";
}

function progressCue(history: SessionHistorySummary) {
  if (!history.count) return "ESTABLISH BASELINE";
  if (history.lastDifficulty === "too_hard") return "CONTROL LOAD & FORM";
  if (history.lastRating != null && history.lastRating >= 4) {
    return "LOOK FOR PROGRESSION";
  }
  return "BEAT LAST PERFORMANCE";
}

function safeFocusTags(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

function buildEstimatedMinutes(
  template: TemplateSummary | undefined,
  exercises: TemplateExerciseSummary[]
) {
  const explicit = positiveInteger(template?.estimated_minutes);
  if (explicit > 0) return explicit;

  const totalSets = exercises.reduce(
    (sum, row) => sum + Math.max(1, positiveInteger(row.sets, 3)),
    0
  );
  const restMinutes = exercises.reduce((sum, row) => {
    const sets = Math.max(1, positiveInteger(row.sets, 3));
    const rests = Math.max(0, sets - 1);
    return sum + (rests * Math.max(0, finiteNumber(row.rest_seconds, 90))) / 60;
  }, 0);

  return Math.max(25, Math.round(8 + totalSets * 1.35 + restMinutes));
}

function historyForType(
  sessionType: string,
  completed: CompletedWorkoutSummary[],
  typeBySessionId: Map<string, string>
): SessionHistorySummary {
  const key = normalizeKey(sessionType);
  const matching = completed.filter((workout) => {
    const scheduledId = workout.scheduled_session_id ?? "";
    return normalizeKey(typeBySessionId.get(scheduledId)) === key;
  });

  if (!matching.length) return { ...EMPTY_HISTORY };

  const durations = matching
    .map((row) => finiteNumber(row.active_seconds))
    .filter((value) => value > 0);

  return {
    count: matching.length,
    lastCompletedAt: matching[0]?.completed_at ?? null,
    averageDurationSeconds: durations.length
      ? durations.reduce((sum, value) => sum + value, 0) / durations.length
      : 0,
    lastDifficulty: matching[0]?.post_difficulty ?? null,
    lastRating:
      matching[0]?.session_rating != null
        ? finiteNumber(matching[0].session_rating)
        : null,
  };
}

export function TodayPage() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [qd, setQd] = useState<QueueDash | null>(null);
  const [schedule, setSchedule] = useState<ScheduleSession[]>([]);
  const [summary, setSummary] = useState<TrainingSummary>({
    completedThisWeek: 0,
    averageDurationSeconds: 0,
    upcomingMinutes: 0,
    progressionSessions: 0,
  });

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSessionType, setActiveSessionType] = useState<string | null>(null);
  const [symptomKey, setSymptomKey] = useState<SymptomKey | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);

  async function resolveSessionType(sessionId: string): Promise<string | null> {
    const { data: session, error } = await supabase
      .from("scheduled_sessions")
      .select("id, session_type")
      .eq("id", sessionId)
      .maybeSingle();

    if (error) return null;
    return (session as any)?.session_type ?? null;
  }

  async function loadLatestSymptomKeyIfNeeded(
    goalMode: string | null
  ): Promise<SymptomKey | null> {
    if (!isSymptomMode(goalMode)) return null;

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return null;

    const { data: intake } = await supabase
      .from("intake_snapshots")
      .select("symptoms, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return inferSymptomKey((intake as any)?.symptoms ?? null);
  }

  async function loadScheduleDetails(params: {
    userId: string;
    queue: QueueDash;
  }) {
    const queueRows = uniqueById([
      params.queue.nextSession,
      ...(params.queue.upcoming ?? []),
    ]).slice(0, 7);

    if (!queueRows.length) {
      setSchedule([]);
      setSummary({
        completedThisWeek: 0,
        averageDurationSeconds: 0,
        upcomingMinutes: 0,
        progressionSessions: 0,
      });
      return;
    }

    const sessionIds = queueRows.map((row) => String(row.id)).filter(Boolean);

    const { data: sessionRows, error: sessionError } = await supabase
      .from("scheduled_sessions")
      .select(
        "id,date,session_type,template_id,status,program_block_id"
      )
      .eq("user_id", params.userId)
      .in("id", sessionIds);

    if (sessionError) throw sessionError;

    const sessionMap = new Map(
      (sessionRows ?? []).map((row: any) => [String(row.id), row])
    );

    const resolvedRows = queueRows.map((row) => ({
      ...row,
      ...(sessionMap.get(String(row.id)) ?? {}),
    }));

    const templateIds = Array.from(
      new Set(
        resolvedRows
          .map((row) => String(row.template_id ?? "").trim())
          .filter(Boolean)
      )
    );

    let templates: TemplateSummary[] = [];
    let templateExercises: TemplateExerciseSummary[] = [];

    if (templateIds.length) {
      const [templateResult, exerciseResult] = await Promise.all([
        supabase
          .from("workout_templates")
          .select(
            "id,name,template_type,focus_tags,estimated_minutes"
          )
          .in("id", templateIds),
        supabase
          .from("template_exercises")
          .select(
            "template_id,exercise_id,order_index,sets,rep_min,rep_max,rest_seconds"
          )
          .in("template_id", templateIds)
          .order("order_index", { ascending: true }),
      ]);

      if (templateResult.error) throw templateResult.error;
      if (exerciseResult.error) throw exerciseResult.error;

      templates = (templateResult.data ?? []) as TemplateSummary[];
      templateExercises = (exerciseResult.data ??
        []) as TemplateExerciseSummary[];
    }

    const { data: completedRows, error: completedError } = await supabase
      .from("workouts")
      .select(
        "id,scheduled_session_id,completed_at,active_seconds,post_difficulty,session_rating"
      )
      .eq("user_id", params.userId)
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(80);

    if (completedError) throw completedError;

    const completed = (completedRows ?? []) as CompletedWorkoutSummary[];
    const completedSessionIds = Array.from(
      new Set(
        completed
          .map((row) => String(row.scheduled_session_id ?? "").trim())
          .filter(Boolean)
      )
    );

    const typeBySessionId = new Map<string, string>();

    if (completedSessionIds.length) {
      const { data: historySessions, error: historySessionError } =
        await supabase
          .from("scheduled_sessions")
          .select("id,session_type")
          .eq("user_id", params.userId)
          .in("id", completedSessionIds);

      if (historySessionError) throw historySessionError;

      for (const row of historySessions ?? []) {
        typeBySessionId.set(
          String((row as any).id),
          String((row as any).session_type ?? "")
        );
      }
    }

    const templateMap = new Map(templates.map((row) => [row.id, row]));
    const exercisesByTemplate = new Map<
      string,
      TemplateExerciseSummary[]
    >();

    for (const row of templateExercises) {
      const list = exercisesByTemplate.get(row.template_id) ?? [];
      list.push(row);
      exercisesByTemplate.set(row.template_id, list);
    }

    const nextSchedule = resolvedRows.map((row): ScheduleSession => {
      const id = String(row.id);
      const sessionType = String(row.session_type ?? "Session");
      const templateId = row.template_id
        ? String(row.template_id)
        : null;
      const template = templateId
        ? templateMap.get(templateId)
        : undefined;
      const exercises = templateId
        ? exercisesByTemplate.get(templateId) ?? []
        : [];
      const totalSets = exercises.reduce(
        (sum, exercise) =>
          sum + Math.max(1, positiveInteger(exercise.sets, 3)),
        0
      );

      return {
        id,
        date: row.date ? String(row.date) : null,
        sessionType,
        templateId,
        templateName: template?.name ?? null,
        templateType: template?.template_type ?? null,
        focusTags: safeFocusTags(template?.focus_tags),
        estimatedMinutes: buildEstimatedMinutes(template, exercises),
        exerciseCount: exercises.length,
        totalSets,
        status: row.status ? String(row.status) : null,
        history: historyForType(
          sessionType,
          completed,
          typeBySessionId
        ),
      };
    });

    const completedThisWeek = completed.filter((row) => {
      const completedAt = new Date(row.completed_at).getTime();
      return (
        Number.isFinite(completedAt) &&
        completedAt >= new Date(startOfWeekISO()).getTime()
      );
    }).length;

    const completedDurations = completed
      .map((row) => finiteNumber(row.active_seconds))
      .filter((value) => value > 0);

    setSchedule(nextSchedule);
    setSummary({
      completedThisWeek,
      averageDurationSeconds: completedDurations.length
        ? completedDurations.reduce((sum, value) => sum + value, 0) /
          completedDurations.length
        : 0,
      upcomingMinutes: nextSchedule.reduce(
        (sum, row) => sum + row.estimatedMinutes,
        0
      ),
      progressionSessions: nextSchedule.filter(
        (row) => row.history.count > 0
      ).length,
    });
  }

  async function load() {
    setLoading(true);
    setErr(null);

    try {
      const { data: userData, error: userError } =
        await supabase.auth.getUser();
      if (userError) throw userError;

      if (!userData.user) {
        setQd(null);
        setSchedule([]);
        setActiveSessionId(null);
        setActiveSessionType(null);
        setSymptomKey(null);
        setErr("Sign in to view workouts.");
        return;
      }

      const { data: activeWorkout, error: activeError } = await supabase
        .from("workouts")
        .select("id, scheduled_session_id, started_at")
        .eq("user_id", userData.user.id)
        .is("completed_at", null)
        .not("started_at", "is", null)
        .order("started_at", {
          ascending: false,
          nullsFirst: false,
        })
        .limit(1)
        .maybeSingle();

      if (activeError) throw activeError;

      if (activeWorkout?.scheduled_session_id) {
        setActiveSessionId(activeWorkout.scheduled_session_id);
        setActiveSessionType(
          await resolveSessionType(
            activeWorkout.scheduled_session_id
          )
        );
      } else {
        setActiveSessionId(null);
        setActiveSessionType(null);
      }

      const { data: queueData, error: queueError } =
        await supabase.rpc("rpc_queue_dashboard", {
          p_keep: 7,
        });
      if (queueError) throw queueError;

      const dashboard = (queueData ?? null) as any;
      const queue: QueueDash = {
        activeBlock: dashboard?.activeBlock ?? null,
        nextSession: dashboard?.nextSession ?? null,
        upcoming: Array.isArray(dashboard?.upcoming)
          ? dashboard.upcoming
          : [],
      };

      setQd(queue);

      const goalMode =
        (queue.activeBlock?.goal_mode as string) ?? null;
      setSymptomKey(
        await loadLatestSymptomKeyIfNeeded(goalMode)
      );

      await loadScheduleDetails({
        userId: userData.user.id,
        queue,
      });
    } catch (error: any) {
      setErr(error?.message ?? String(error));
      setQd(null);
      setSchedule([]);
      setActiveSessionId(null);
      setActiveSessionType(null);
      setSymptomKey(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const hasActiveProgram = Boolean(qd?.activeBlock?.id);
  const goal = (qd?.activeBlock?.goal as string) ?? null;
  const goalMode =
    (qd?.activeBlock?.goal_mode as string) ?? null;

  const activeLabel = useMemo(() => {
    if (!activeSessionId) return null;

    return formatSessionLabel({
      sessionType: activeSessionType ?? "Session",
      goal,
      goalMode,
      symptomKey,
    });
  }, [
    activeSessionId,
    activeSessionType,
    goal,
    goalMode,
    symptomKey,
  ]);

  const nextSession = schedule[0] ?? null;
  const nextLabel = useMemo(() => {
    if (!nextSession) return "No session queued";

    return formatSessionLabel({
      sessionType: nextSession.sessionType,
      goal,
      goalMode,
      symptomKey,
    });
  }, [nextSession, goal, goalMode, symptomKey]);

  const primarySessionId =
    activeSessionId ?? nextSession?.id ?? null;

  const primaryStatus = activeSessionId
    ? "IN PROGRESS"
    : nextSession
      ? dateStatus(nextSession.date)
      : "NO SESSION";

  function openSession(sessionId: string) {
    window.location.pathname = `/workout/${sessionId}`;
  }

  return (
    <div className="tr-workoutBoard">
      <Card
        title="Training Schedule"
        tone="blue"
        right={
          <div className="tr-workoutBoardHeaderActions">
            <button
              type="button"
              className="tr-seg"
              onClick={() => (window.location.pathname = "/coach")}
            >
              COACH
            </button>
            <button
              type="button"
              className="tr-seg"
              onClick={() => (window.location.pathname = "/progress")}
            >
              PROGRESS
            </button>
            <button
              type="button"
              className="tr-seg"
              onClick={() => void load()}
              disabled={loading}
            >
              {loading ? "LOADING…" : "REFRESH"}
            </button>
          </div>
        }
      >
        {err ? (
          <div className="tr-workoutBoardError">{err}</div>
        ) : null}

        {!loading && !hasActiveProgram ? (
          <div className="tr-workoutBoardEmpty">
            <div>
              <span className="tr-workoutBoardKicker">
                PROGRAM REQUIRED
              </span>
              <strong>No active training block</strong>
              <p>
                Generate a program in Coach to build your training
                schedule.
              </p>
            </div>
            <button
              type="button"
              className="tr-btn tr-btn--primary"
              onClick={() => (window.location.pathname = "/coach")}
            >
              OPEN COACH
            </button>
          </div>
        ) : null}

        {hasActiveProgram ? (
          <>
            <div className="tr-trainingSummaryRail">
              <div className="tr-trainingSummaryMetric">
                <span>THIS WEEK</span>
                <strong>{loading ? "—" : summary.completedThisWeek}</strong>
                <small>sessions completed</small>
              </div>
              <div className="tr-trainingSummaryMetric">
                <span>UPCOMING BLOCK</span>
                <strong>
                  {loading
                    ? "—"
                    : formatMinutes(summary.upcomingMinutes)}
                </strong>
                <small>planned training time</small>
              </div>
              <div className="tr-trainingSummaryMetric">
                <span>AVERAGE SESSION</span>
                <strong>
                  {loading
                    ? "—"
                    : formatDuration(summary.averageDurationSeconds)}
                </strong>
                <small>completed workout duration</small>
              </div>
              <div className="tr-trainingSummaryMetric">
                <span>PROGRESSION READY</span>
                <strong>
                  {loading ? "—" : summary.progressionSessions}
                </strong>
                <small>sessions with history</small>
              </div>
            </div>

            <section
              className={`tr-nextSessionCommand ${
                activeSessionId ? "is-active" : ""
              }`}
              aria-label={
                activeSessionId
                  ? "Active workout"
                  : "Next scheduled workout"
              }
            >
              <div className="tr-nextSessionCommandGlow" aria-hidden />

              <div className="tr-nextSessionCommandMain">
                <div className="tr-nextSessionCommandTopline">
                  <span className="tr-workoutBoardKicker">
                    {activeSessionId
                      ? "SESSION IN PROGRESS"
                      : "NEXT SESSION"}
                  </span>
                  <span
                    className={`tr-sessionReadiness is-${primaryStatus
                      .toLowerCase()
                      .replace(/\s+/g, "-")}`}
                  >
                    {primaryStatus}
                  </span>
                </div>

                <h2>
                  {activeSessionId
                    ? activeLabel ?? "Active Session"
                    : nextLabel}
                </h2>

                <p className="tr-nextSessionFocus">
                  {activeSessionId
                    ? "Return to the live session command center."
                    : focusLabel(nextSession?.focusTags ?? [])}
                </p>

                <div className="tr-nextSessionMeta">
                  <div>
                    <span>DATE</span>
                    <strong>
                      {activeSessionId
                        ? "NOW"
                        : formatLongDate(nextSession?.date)}
                    </strong>
                  </div>
                  <div>
                    <span>EXERCISES</span>
                    <strong>
                      {activeSessionId
                        ? "ACTIVE"
                        : nextSession?.exerciseCount || "—"}
                    </strong>
                  </div>
                  <div>
                    <span>EST. TIME</span>
                    <strong>
                      {activeSessionId
                        ? "LIVE"
                        : nextSession
                          ? formatMinutes(
                              nextSession.estimatedMinutes
                            )
                          : "—"}
                    </strong>
                  </div>
                  <div>
                    <span>INTENSITY</span>
                    <strong>
                      {activeSessionId
                        ? "IN SESSION"
                        : nextSession
                          ? intensityLabel(
                              nextSession.totalSets,
                              nextSession.estimatedMinutes
                            )
                          : "—"}
                    </strong>
                  </div>
                </div>
              </div>

              <div className="tr-nextSessionCommandCoach">
                <span className="tr-workoutBoardKicker">
                  SESSION OBJECTIVE
                </span>
                <strong>
                  {activeSessionId
                    ? "Continue the workout"
                    : progressCue(
                        nextSession?.history ?? EMPTY_HISTORY
                      )}
                </strong>
                <p>
                  {readinessCopy(
                    primaryStatus,
                    nextSession?.history ?? EMPTY_HISTORY
                  )}
                </p>

                <div className="tr-nextSessionHistory">
                  <span>
                    LAST COMPLETED
                    <strong>
                      {formatShortDate(
                        nextSession?.history.lastCompletedAt
                      )}
                    </strong>
                  </span>
                  <span>
                    PRIOR SESSIONS
                    <strong>
                      {nextSession?.history.count ?? 0}
                    </strong>
                  </span>
                </div>
              </div>

              <div className="tr-nextSessionCommandActions">
                <button
                  type="button"
                  className={`tr-btn tr-btn--primary ${
                    activeSessionId
                      ? "tr-btn--glowResume"
                      : "tr-btn--glowStart"
                  }`}
                  disabled={!primarySessionId}
                  onClick={() => {
                    if (primarySessionId) {
                      openSession(primarySessionId);
                    }
                  }}
                >
                  {activeSessionId
                    ? "RETURN TO WORKOUT"
                    : "START WORKOUT"}
                </button>

                {!activeSessionId && nextSession ? (
                  <button
                    type="button"
                    className="tr-btn tr-btn--blueOutline"
                    onClick={() =>
                      setEditingSessionId(nextSession.id)
                    }
                  >
                    PREVIEW & EDIT
                  </button>
                ) : null}
              </div>
            </section>

            <div className="tr-trainingScheduleHeading">
              <div>
                <span className="tr-workoutBoardKicker">
                  UPCOMING TRAINING BLOCK
                </span>
                <strong>Next {Math.min(7, schedule.length)} sessions</strong>
              </div>
              <p>
                Every card shows the workload, timing, history, and
                progression focus before you begin.
              </p>
            </div>

            {loading ? (
              <div className="tr-trainingScheduleLoading">
                Building your performance schedule…
              </div>
            ) : schedule.length ? (
              <div className="tr-trainingScheduleGrid">
                {schedule.map((session, index) => {
                  const label = formatSessionLabel({
                    sessionType: session.sessionType,
                    goal,
                    goalMode,
                    symptomKey,
                  });
                  const status =
                    session.id === activeSessionId
                      ? "IN PROGRESS"
                      : dateStatus(session.date);

                  return (
                    <article
                      key={session.id}
                      className={`tr-trainingSessionCard ${
                        index === 0 ? "is-next" : ""
                      } ${
                        session.id === activeSessionId
                          ? "is-active"
                          : ""
                      }`}
                    >
                      <div className="tr-trainingSessionCardTop">
                        <span className="tr-trainingSessionNumber">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span
                          className={`tr-sessionReadiness is-${status
                            .toLowerCase()
                            .replace(/\s+/g, "-")}`}
                        >
                          {status}
                        </span>
                      </div>

                      <div className="tr-trainingSessionDate">
                        {formatLongDate(session.date)}
                      </div>

                      <h3>{label}</h3>
                      <p>{focusLabel(session.focusTags)}</p>

                      <div className="tr-trainingSessionStats">
                        <span>
                          <small>EXERCISES</small>
                          <strong>
                            {session.exerciseCount || "—"}
                          </strong>
                        </span>
                        <span>
                          <small>SETS</small>
                          <strong>{session.totalSets || "—"}</strong>
                        </span>
                        <span>
                          <small>TIME</small>
                          <strong>
                            {formatMinutes(
                              session.estimatedMinutes
                            )}
                          </strong>
                        </span>
                      </div>

                      <div className="tr-trainingSessionCoach">
                        <span>PROGRESSION CUE</span>
                        <strong>
                          {progressCue(session.history)}
                        </strong>
                        <small>
                          {readinessCopy(status, session.history)}
                        </small>
                      </div>

                      <div className="tr-trainingSessionHistory">
                        <span>
                          LAST
                          <strong>
                            {formatShortDate(
                              session.history.lastCompletedAt
                            )}
                          </strong>
                        </span>
                        <span>
                          HISTORY
                          <strong>
                            {session.history.count} SESSION
                            {session.history.count === 1 ? "" : "S"}
                          </strong>
                        </span>
                      </div>

                      <div className="tr-trainingSessionActions">
                        <button
                          type="button"
                          className="tr-btn tr-btn--primary"
                          onClick={() => openSession(session.id)}
                        >
                          {session.id === activeSessionId
                            ? "RETURN"
                            : "START"}
                        </button>
                        <button
                          type="button"
                          className="tr-btn tr-btn--blueOutline"
                          onClick={() =>
                            setEditingSessionId(session.id)
                          }
                        >
                          PREVIEW
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="tr-trainingScheduleLoading">
                No queued sessions were returned for the active
                program.
              </div>
            )}
          </>
        ) : null}
      </Card>

      {editingSessionId ? (
        <PlannedSessionEditor
          sessionId={editingSessionId}
          onClose={() => setEditingSessionId(null)}
          onSaved={load}
        />
      ) : null}

      <style>{`
        .tr-workoutBoard{
          display:grid;
          gap:16px;
        }

        .tr-workoutBoard *{
          box-sizing:border-box;
        }

        .tr-workoutBoardHeaderActions{
          display:flex;
          align-items:center;
          justify-content:flex-end;
          gap:8px;
          flex-wrap:wrap;
        }

        .tr-workoutBoardError,
        .tr-workoutBoardEmpty,
        .tr-trainingScheduleLoading{
          border:1px solid rgba(255,95,103,.32);
          border-radius:18px;
          background:rgba(255,72,82,.08);
          color:rgba(255,235,237,.92);
          padding:16px;
          font-weight:850;
        }

        .tr-workoutBoardEmpty{
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:18px;
          border-color:rgba(70,202,255,.2);
          background:
            radial-gradient(500px 180px at 0 0, rgba(25,156,255,.12), transparent 70%),
            rgba(255,255,255,.018);
        }

        .tr-workoutBoardEmpty > div{
          display:grid;
          gap:7px;
        }

        .tr-workoutBoardEmpty strong{
          color:#fff;
          font-size:22px;
          font-weight:1000;
        }

        .tr-workoutBoardEmpty p{
          margin:0;
          color:rgba(203,220,231,.68);
          font-size:13px;
          line-height:1.45;
        }

        .tr-workoutBoardKicker{
          color:#7edcff;
          font-size:9px;
          line-height:1;
          font-weight:1000;
          letter-spacing:.18em;
          text-transform:uppercase;
        }

        .tr-trainingSummaryRail{
          display:grid;
          grid-template-columns:repeat(4,minmax(0,1fr));
          gap:10px;
          margin-top:12px;
        }

        .tr-trainingSummaryMetric{
          min-width:0;
          min-height:112px;
          display:grid;
          align-content:center;
          gap:7px;
          padding:14px;
          border:1px solid rgba(175,207,226,.11);
          border-radius:16px;
          background:
            linear-gradient(180deg,rgba(255,255,255,.035),rgba(0,0,0,.14)),
            rgba(7,13,19,.72);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.035),
            0 12px 28px rgba(0,0,0,.16);
        }

        .tr-trainingSummaryMetric span{
          color:rgba(185,208,222,.58);
          font-size:8px;
          font-weight:1000;
          letter-spacing:.14em;
        }

        .tr-trainingSummaryMetric strong{
          min-width:0;
          overflow:hidden;
          color:rgba(249,252,255,.98);
          font-size:clamp(24px,3vw,34px);
          line-height:1;
          font-weight:1000;
          text-overflow:ellipsis;
          white-space:nowrap;
        }

        .tr-trainingSummaryMetric small{
          color:rgba(184,205,218,.53);
          font-size:10px;
          font-weight:750;
        }

        .tr-nextSessionCommand{
          position:relative;
          isolation:isolate;
          overflow:hidden;
          display:grid;
          grid-template-columns:minmax(0,1.3fr) minmax(260px,.75fr);
          gap:14px;
          margin-top:14px;
          padding:20px;
          border:1px solid rgba(68,205,255,.34);
          border-radius:24px;
          background:
            radial-gradient(820px 280px at 0 -20%,rgba(25,157,255,.2),transparent 66%),
            radial-gradient(620px 260px at 100% 0,rgba(246,184,95,.09),transparent 72%),
            linear-gradient(180deg,rgba(12,21,30,.99),rgba(4,8,13,.995));
          box-shadow:
            0 26px 70px rgba(0,0,0,.38),
            inset 0 1px 0 rgba(255,255,255,.07),
            inset 0 -1px 0 rgba(64,198,255,.09);
        }

        .tr-nextSessionCommand.is-active{
          border-color:rgba(99,226,149,.38);
          background:
            radial-gradient(820px 280px at 0 -20%,rgba(52,199,108,.16),transparent 66%),
            radial-gradient(620px 260px at 100% 0,rgba(68,205,255,.08),transparent 72%),
            linear-gradient(180deg,rgba(10,24,19,.99),rgba(4,10,8,.995));
        }

        .tr-nextSessionCommandGlow{
          position:absolute;
          inset:0;
          z-index:-1;
          pointer-events:none;
          background:
            linear-gradient(110deg,transparent 8%,rgba(255,255,255,.035) 32%,transparent 55%);
        }

        .tr-nextSessionCommandMain,
        .tr-nextSessionCommandCoach{
          min-width:0;
          display:grid;
          align-content:start;
        }

        .tr-nextSessionCommandTopline{
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:12px;
        }

        .tr-sessionReadiness{
          width:max-content;
          max-width:100%;
          padding:7px 10px;
          border:1px solid rgba(77,213,255,.32);
          border-radius:999px;
          color:#9ce9ff;
          background:rgba(55,199,255,.08);
          font-size:8px;
          line-height:1;
          font-weight:1000;
          letter-spacing:.13em;
        }

        .tr-sessionReadiness.is-in-progress{
          border-color:rgba(99,226,149,.34);
          color:#9af0b7;
          background:rgba(99,226,149,.08);
        }

        .tr-sessionReadiness.is-scheduled{
          border-color:rgba(246,184,95,.3);
          color:#ffd194;
          background:rgba(246,184,95,.07);
        }

        .tr-nextSessionCommand h2{
          margin:18px 0 8px;
          color:#fff;
          font-size:clamp(30px,4.4vw,54px);
          line-height:.98;
          font-weight:1000;
          letter-spacing:-.035em;
        }

        .tr-nextSessionFocus{
          margin:0;
          color:rgba(207,224,235,.72);
          font-size:14px;
          line-height:1.4;
          font-weight:750;
        }

        .tr-nextSessionMeta{
          display:grid;
          grid-template-columns:repeat(4,minmax(0,1fr));
          gap:8px;
          margin-top:20px;
        }

        .tr-nextSessionMeta > div{
          min-width:0;
          display:grid;
          gap:6px;
          padding:11px 12px;
          border:1px solid rgba(177,208,226,.1);
          border-radius:13px;
          background:rgba(255,255,255,.018);
        }

        .tr-nextSessionMeta span{
          color:rgba(185,207,220,.55);
          font-size:7px;
          font-weight:1000;
          letter-spacing:.13em;
        }

        .tr-nextSessionMeta strong{
          min-width:0;
          overflow:hidden;
          color:rgba(247,251,254,.95);
          font-size:11px;
          line-height:1.2;
          font-weight:950;
          text-overflow:ellipsis;
          white-space:nowrap;
        }

        .tr-nextSessionCommandCoach{
          gap:10px;
          padding:16px;
          border:1px solid rgba(246,184,95,.2);
          border-radius:18px;
          background:
            linear-gradient(180deg,rgba(246,184,95,.055),rgba(0,0,0,.12)),
            rgba(7,13,18,.66);
        }

        .tr-nextSessionCommandCoach > strong{
          color:#ffd08d;
          font-size:clamp(18px,2.2vw,26px);
          line-height:1.05;
          font-weight:1000;
        }

        .tr-nextSessionCommandCoach p{
          margin:0;
          color:rgba(201,219,230,.68);
          font-size:12px;
          line-height:1.48;
          font-weight:700;
        }

        .tr-nextSessionHistory{
          display:grid;
          grid-template-columns:1fr 1fr;
          gap:8px;
          margin-top:auto;
        }

        .tr-nextSessionHistory span{
          display:grid;
          gap:5px;
          padding:10px;
          border:1px solid rgba(178,208,226,.09);
          border-radius:12px;
          color:rgba(183,205,218,.53);
          background:rgba(255,255,255,.016);
          font-size:7px;
          font-weight:1000;
          letter-spacing:.12em;
        }

        .tr-nextSessionHistory strong{
          color:rgba(247,251,254,.92);
          font-size:11px;
          font-weight:950;
          letter-spacing:0;
        }

        .tr-nextSessionCommandActions{
          grid-column:1/-1;
          display:grid;
          grid-template-columns:minmax(180px,1fr) minmax(160px,.45fr);
          gap:10px;
        }

        .tr-nextSessionCommandActions .tr-btn{
          min-height:54px;
        }

        .tr-trainingScheduleHeading{
          display:flex;
          align-items:end;
          justify-content:space-between;
          gap:18px;
          margin:28px 2px 12px;
        }

        .tr-trainingScheduleHeading > div{
          display:grid;
          gap:7px;
        }

        .tr-trainingScheduleHeading strong{
          color:#fff;
          font-size:clamp(22px,3vw,32px);
          line-height:1;
          font-weight:1000;
        }

        .tr-trainingScheduleHeading p{
          max-width:520px;
          margin:0;
          color:rgba(190,210,222,.58);
          font-size:12px;
          line-height:1.45;
          text-align:right;
        }

        .tr-trainingScheduleLoading{
          border-color:rgba(67,202,255,.18);
          color:rgba(210,228,239,.72);
          background:rgba(255,255,255,.018);
        }

        .tr-trainingScheduleGrid{
          display:grid;
          grid-template-columns:repeat(3,minmax(0,1fr));
          gap:12px;
        }

        .tr-trainingSessionCard{
          min-width:0;
          display:grid;
          align-content:start;
          gap:11px;
          padding:16px;
          border:1px solid rgba(175,207,226,.12);
          border-radius:20px;
          background:
            radial-gradient(360px 150px at 0 0,rgba(255,255,255,.035),transparent 72%),
            linear-gradient(180deg,rgba(13,21,29,.97),rgba(5,9,14,.99));
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.04),
            0 16px 34px rgba(0,0,0,.2);
        }

        .tr-trainingSessionCard.is-next{
          border-color:rgba(68,205,255,.36);
          box-shadow:
            0 0 28px rgba(68,205,255,.08),
            inset 0 1px 0 rgba(255,255,255,.05),
            0 16px 34px rgba(0,0,0,.22);
        }

        .tr-trainingSessionCard.is-active{
          border-color:rgba(99,226,149,.38);
        }

        .tr-trainingSessionCardTop{
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:10px;
        }

        .tr-trainingSessionNumber{
          color:rgba(122,219,255,.78);
          font-size:24px;
          line-height:1;
          font-weight:1000;
          font-variant-numeric:tabular-nums;
        }

        .tr-trainingSessionDate{
          color:rgba(190,211,224,.54);
          font-size:9px;
          font-weight:900;
          letter-spacing:.08em;
          text-transform:uppercase;
        }

        .tr-trainingSessionCard h3{
          min-width:0;
          margin:0;
          color:rgba(250,253,255,.98);
          font-size:19px;
          line-height:1.08;
          font-weight:1000;
        }

        .tr-trainingSessionCard > p{
          min-height:34px;
          margin:0;
          color:rgba(196,215,227,.65);
          font-size:12px;
          line-height:1.4;
          font-weight:700;
        }

        .tr-trainingSessionStats{
          display:grid;
          grid-template-columns:repeat(3,minmax(0,1fr));
          gap:7px;
        }

        .tr-trainingSessionStats span{
          min-width:0;
          display:grid;
          gap:5px;
          padding:9px;
          border:1px solid rgba(178,208,226,.09);
          border-radius:11px;
          background:rgba(255,255,255,.016);
        }

        .tr-trainingSessionStats small{
          color:rgba(181,203,216,.5);
          font-size:6px;
          font-weight:1000;
          letter-spacing:.12em;
        }

        .tr-trainingSessionStats strong{
          min-width:0;
          overflow:hidden;
          color:rgba(246,251,254,.94);
          font-size:11px;
          font-weight:950;
          text-overflow:ellipsis;
          white-space:nowrap;
        }

        .tr-trainingSessionCoach{
          display:grid;
          gap:5px;
          padding:11px;
          border:1px solid rgba(246,184,95,.16);
          border-radius:13px;
          background:rgba(246,184,95,.045);
        }

        .tr-trainingSessionCoach span{
          color:rgba(246,193,112,.7);
          font-size:7px;
          font-weight:1000;
          letter-spacing:.13em;
        }

        .tr-trainingSessionCoach strong{
          color:#ffd193;
          font-size:12px;
          font-weight:1000;
        }

        .tr-trainingSessionCoach small{
          color:rgba(199,217,229,.61);
          font-size:10px;
          line-height:1.35;
          font-weight:700;
        }

        .tr-trainingSessionHistory{
          display:grid;
          grid-template-columns:1fr 1fr;
          gap:7px;
        }

        .tr-trainingSessionHistory span{
          display:grid;
          gap:4px;
          color:rgba(180,202,215,.48);
          font-size:6px;
          font-weight:1000;
          letter-spacing:.12em;
        }

        .tr-trainingSessionHistory strong{
          color:rgba(235,244,250,.82);
          font-size:9px;
          font-weight:900;
          letter-spacing:0;
        }

        .tr-trainingSessionActions{
          display:grid;
          grid-template-columns:1fr 1fr;
          gap:8px;
          margin-top:auto;
        }

        .tr-trainingSessionActions .tr-btn{
          min-height:44px;
        }

        .tr-btn--glowStart{
          box-shadow:
            0 18px 55px rgba(0,170,255,.14),
            0 0 0 1px rgba(0,170,255,.1) inset,
            inset 0 1px 0 rgba(255,255,255,.06);
        }

        .tr-btn--glowResume{
          box-shadow:
            0 18px 55px rgba(34,197,94,.12),
            0 0 0 1px rgba(34,197,94,.1) inset,
            inset 0 1px 0 rgba(255,255,255,.06);
        }

        @media (max-width:1100px){
          .tr-trainingScheduleGrid{
            grid-template-columns:repeat(2,minmax(0,1fr));
          }

          .tr-trainingSummaryRail{
            grid-template-columns:repeat(2,minmax(0,1fr));
          }
        }

        @media (max-width:820px){
          .tr-nextSessionCommand{
            grid-template-columns:1fr;
          }

          .tr-nextSessionCommandActions{
            grid-column:auto;
          }

          .tr-nextSessionMeta{
            grid-template-columns:repeat(2,minmax(0,1fr));
          }

          .tr-trainingScheduleHeading{
            align-items:start;
            flex-direction:column;
          }

          .tr-trainingScheduleHeading p{
            max-width:none;
            text-align:left;
          }
        }

        @media (max-width:680px){
          .tr-workoutBoardHeaderActions{
            width:100%;
            display:grid;
            grid-template-columns:repeat(3,minmax(0,1fr));
          }

          .tr-workoutBoardHeaderActions .tr-seg{
            min-width:0;
          }

          .tr-workoutBoardEmpty{
            align-items:stretch;
            flex-direction:column;
          }

          .tr-trainingSummaryRail,
          .tr-trainingScheduleGrid{
            grid-template-columns:1fr;
          }

          .tr-trainingSummaryMetric{
            min-height:0;
          }

          .tr-nextSessionCommand{
            padding:15px;
            border-radius:20px;
          }

          .tr-nextSessionCommand h2{
            font-size:clamp(28px,10vw,42px);
          }

          .tr-nextSessionCommandActions{
            grid-template-columns:1fr;
          }

          .tr-trainingSessionCard{
            border-radius:17px;
          }
        }

        @media (max-width:430px){
          .tr-workoutBoardHeaderActions{
            grid-template-columns:1fr;
          }

          .tr-nextSessionMeta{
            grid-template-columns:1fr 1fr;
          }

          .tr-nextSessionHistory{
            grid-template-columns:1fr;
          }

          .tr-trainingSessionStats{
            grid-template-columns:1fr 1fr 1fr;
          }
        }
      `}</style>
    </div>
  );
}
