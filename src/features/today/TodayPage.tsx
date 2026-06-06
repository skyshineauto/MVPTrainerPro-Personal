// src/features/today/TodayPage.tsx
import { supabase } from "../../lib/supabase";
import { Card } from "../../ui/Card";
import { Button } from "../../ui/Button";
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

  // active/resume state (only when started_at exists)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSessionType, setActiveSessionType] = useState<string | null>(null);

  const [symptomKey, setSymptomKey] = useState<SymptomKey | null>(null);

  async function resolveSessionType(sessionId: string): Promise<string | null> {
    const { data: sess, error } = await supabase
      .from("scheduled_sessions")
      .select("id, session_type")
      .eq("id", sessionId)
      .maybeSingle();
    if (error) return null;
    return (sess as any)?.session_type ?? null;
  }

  async function loadLatestSymptomKeyIfNeeded(goalMode: string | null): Promise<SymptomKey | null> {
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

      // (1) Active workout to RESUME if exists
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

      // (2) Queue dashboard (single truth)
      const { data: qdata, error: qErr } = await supabase.rpc("rpc_queue_dashboard", { p_keep: 7 });
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

  useEffect(() => void load(), []);

  const hasActiveProgram = !!qd?.activeBlock?.id;

  const goal = (qd?.activeBlock?.goal as string) ?? null;
  const goalMode = (qd?.activeBlock?.goal_mode as string) ?? null;

  // ✅ Active label must use the SAME formatter as queue
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

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Card title="Workouts">
        {err ? (
          <div className="tr-rowbox" style={{ borderColor: "rgb(255 80 80 / .35)", background: "rgb(255 80 80 / .10)" }}>
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
            <div className="tr-kicker">{activeSessionId ? "Active workout" : "Next workout"}</div>

            <div style={{ fontWeight: 950, fontSize: 18 }}>
              {activeSessionId ? (activeLabel ?? "Session") : nextLabel}
            </div>

            {/* ✅ Removed weird helper text lines per your request */}

            <div style={{ marginTop: 8 }}>
              <button
                className={`tr-btn tr-btn--primary ${activeSessionId ? "tr-btn--glowResume" : "tr-btn--glowStart"}`}
                disabled={!activeSessionId && !qd?.nextSession?.id}
                onClick={onPrimary}
                style={{ width: "100%", height: 52 }}
              >
                {activeSessionId ? "RESUME WORKOUT" : "START WORKOUT"}
              </button>
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
                <button
                  key={s.id}
                  className="tr-rowBtn"
                  onClick={() => (window.location.pathname = `/workout/${s.id}`)}
                >
                  <div className="tr-rowbox" style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                    <div style={{ display: "grid", gap: 2 }}>
                      <div style={{ fontWeight: 950 }}>
                        #{idx + 1} — {label}
                      </div>
                      {/* leave this line for now; you didn’t flag it as “weird text” */}
                      <div className="tr-sub">Tap to start this session</div>
                    </div>
                    <div className="tr-kicker" style={{ opacity: 0.9 }}>
                      QUEUED
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="tr-sub">No queued sessions returned for the active program.</div>
        )}
      </Card>

      <Card title="Actions">
        <div style={{ display: "grid", gap: 10 }}>
          <Button onClick={() => (window.location.pathname = "/coach")}>Go to Coach</Button>
          <Button variant="secondary" onClick={() => (window.location.pathname = "/progress")}>Go to Progress</Button>
          <Button variant="secondary" onClick={load}>Refresh</Button>
        </div>
      </Card>

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
