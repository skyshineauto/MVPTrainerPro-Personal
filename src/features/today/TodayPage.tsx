import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { Card } from "../../ui/Card";
import { Button } from "../../ui/Button";
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

export function TodayPage() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [qd, setQd] = useState<QueueDash | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSessionType, setActiveSessionType] = useState<string | null>(null);
  const [symptomKey, setSymptomKey] = useState<SymptomKey | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);

  async function resolveSessionType(sessionId: string): Promise<string | null> {
    const { data: sess, error } = await supabase
      .from("scheduled_sessions")
      .select("id, session_type")
      .eq("id", sessionId)
      .maybeSingle();

    if (error) return null;
    return (sess as any)?.session_type ?? null;
  }

  async function loadLatestSymptomKeyIfNeeded(
    goalMode: string | null
  ): Promise<SymptomKey | null> {
    if (!isSymptomMode(goalMode)) return null;

    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) return null;

    const { data: intake } = await supabase
      .from("intake_snapshots")
      .select("symptoms, created_at")
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return inferSymptomKey((intake as any)?.symptoms ?? null);
  }

  async function load() {
    setLoading(true);
    setErr(null);

    try {
      const { data: u, error: uErr } = await supabase.auth.getUser();
      if (uErr) throw uErr;

      if (!u.user) {
        setQd(null);
        setActiveSessionId(null);
        setActiveSessionType(null);
        setSymptomKey(null);
        setErr("Sign in to view workouts.");
        setLoading(false);
        return;
      }

      const { data: w, error: wErr } = await supabase
        .from("workouts")
        .select("id, scheduled_session_id, started_at")
        .eq("user_id", u.user.id)
        .is("completed_at", null)
        .not("started_at", "is", null)
        .order("started_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();

      if (wErr) throw wErr;

      if (w?.scheduled_session_id) {
        setActiveSessionId(w.scheduled_session_id);
        setActiveSessionType(await resolveSessionType(w.scheduled_session_id));
      } else {
        setActiveSessionId(null);
        setActiveSessionType(null);
      }

      const { data: qdata, error: qErr } = await supabase.rpc("rpc_queue_dashboard", {
        p_keep: 7,
      });
      if (qErr) throw qErr;

      const dash = (qdata ?? null) as any;
      const out: QueueDash = {
        activeBlock: dash?.activeBlock ?? null,
        nextSession: dash?.nextSession ?? null,
        upcoming: Array.isArray(dash?.upcoming) ? dash.upcoming : [],
      };
      setQd(out);

      const goalMode = (out.activeBlock?.goal_mode as string) ?? null;
      setSymptomKey(await loadLatestSymptomKeyIfNeeded(goalMode));
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setQd(null);
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

  const hasActiveProgram = !!qd?.activeBlock?.id;
  const goal = (qd?.activeBlock?.goal as string) ?? null;
  const goalMode = (qd?.activeBlock?.goal_mode as string) ?? null;

  const activeLabel = useMemo(() => {
    if (!activeSessionId) return null;
    return formatSessionLabel({
      sessionType: activeSessionType ?? "Session",
      goal,
      goalMode,
      symptomKey,
    });
  }, [activeSessionId, activeSessionType, goal, goalMode, symptomKey]);

  const nextLabel = useMemo(() => {
    if (!qd?.activeBlock) return "—";
    const st = (qd?.nextSession?.session_type as string) ?? null;

    return qd?.nextSession
      ? formatSessionLabel({ sessionType: st, goal, goalMode, symptomKey })
      : "—";
  }, [qd, goal, goalMode, symptomKey]);

  const onPrimary = () => {
    if (activeSessionId) {
      window.location.pathname = `/workout/${activeSessionId}`;
      return;
    }
    const nextId = qd?.nextSession?.id as string | undefined;
    if (nextId) window.location.pathname = `/workout/${nextId}`;
  };

  const nextSessionId = (qd?.nextSession?.id as string | undefined) ?? null;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Card title="Workouts">
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

        {!loading && !hasActiveProgram ? (
          <div className="tr-sub" style={{ marginTop: 6 }}>
            No active program yet. Go to Coach and generate a program.
          </div>
        ) : null}

        <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
          <div className="tr-rowbox" style={{ display: "grid", gap: 6 }}>
            <div className="tr-kicker">
              {activeSessionId ? "Active workout" : "Next workout"}
            </div>

            <div style={{ fontWeight: 950, fontSize: 18 }}>
              {activeSessionId ? activeLabel ?? "Session" : nextLabel}
            </div>

            <div className={`tr-nextWorkoutActions ${activeSessionId ? "is-active" : ""}`}>
              <button
                className={`tr-btn tr-btn--primary ${
                  activeSessionId ? "tr-btn--glowResume" : "tr-btn--glowStart"
                }`}
                disabled={!activeSessionId && !nextSessionId}
                onClick={onPrimary}
                style={{ height: 52 }}
              >
                {activeSessionId ? "RESUME WORKOUT" : "START WORKOUT"}
              </button>

              {!activeSessionId && nextSessionId ? (
                <button
                  className="tr-btn tr-btn--blueOutline"
                  style={{ height: 52 }}
                  onClick={() => setEditingSessionId(nextSessionId)}
                >
                  EDIT WORKOUT
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </Card>

      <Card title="Next 7 sessions">
        {loading ? (
          <div className="tr-sub">Loading…</div>
        ) : !hasActiveProgram ? (
          <div className="tr-sub">Generate a program to see your queue.</div>
        ) : qd?.upcoming?.length ? (
          <div style={{ display: "grid", gap: 10 }}>
            {qd.upcoming.slice(0, 7).map((s: any, idx: number) => {
              const label = formatSessionLabel({
                sessionType: s.session_type,
                goal,
                goalMode,
                symptomKey,
              });

              return (
                <div key={s.id} className="tr-rowbox tr-queueSessionRow">
                  <div className="tr-queueSessionCopy">
                    <div style={{ fontWeight: 950 }}>
                      #{idx + 1} — {label}
                    </div>
                    <div className="tr-sub">Plan it now or start when you are ready.</div>
                  </div>

                  <div className="tr-queueSessionActions">
                    <button
                      className="tr-btn tr-btn--primary"
                      onClick={() => (window.location.pathname = `/workout/${s.id}`)}
                    >
                      START
                    </button>
                    <button
                      className="tr-btn tr-btn--blueOutline"
                      onClick={() => setEditingSessionId(s.id)}
                    >
                      EDIT
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="tr-sub">
            No queued sessions returned for the active program.
          </div>
        )}
      </Card>

      <Card title="Actions">
        <div style={{ display: "grid", gap: 10 }}>
          <Button onClick={() => (window.location.pathname = "/coach")}>Go to Coach</Button>
          <Button variant="secondary" onClick={() => (window.location.pathname = "/progress")}>
            Go to Progress
          </Button>
          <Button variant="secondary" onClick={load}>Refresh</Button>
        </div>
      </Card>

      {editingSessionId ? (
        <PlannedSessionEditor
          sessionId={editingSessionId}
          onClose={() => setEditingSessionId(null)}
          onSaved={load}
        />
      ) : null}

      <style>{`
        .tr-btn--glowStart{
          box-shadow:
            0 18px 55px rgba(0,170,255,.14),
            0 0 0 1px rgba(0,170,255,.10) inset,
            inset 0 1px 0 rgba(255,255,255,.06);
        }
        .tr-btn--glowResume{
          box-shadow:
            0 18px 55px rgba(34,197,94,.12),
            0 0 0 1px rgba(34,197,94,.10) inset,
            inset 0 1px 0 rgba(255,255,255,.06);
        }
      `}</style>
    </div>
  );
}
