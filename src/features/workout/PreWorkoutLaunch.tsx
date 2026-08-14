import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { supabase } from "../../lib/supabase";
import {
  listActiveMotivationVideos,
  type MotivationVideoRecord,
} from "../../lib/motivationVideoStorage";
import {
  pickMotivationVideo,
  pickWorkoutMotivation,
  type WorkoutMotivationPick,
} from "../../lib/workoutMotivation";

type LaunchPreview = {
  exerciseCount: number | null;
  workingSets: number | null;
  estimatedMinutes: number | null;
  focus: string;
};

type Props = {
  sessionId: string;
  sessionLabel: string;
  weight: string;
  onWeightChange: (value: string) => void;
  onStart: () => void | Promise<void>;
  onCancel: () => void;
};

const PARTICLES = Array.from({ length: 8 }, (_, index) => ({
  left: `${4 + ((index * 17) % 92)}%`,
  top: `${8 + ((index * 29) % 80)}%`,
  delay: `${-((index * 0.73) % 7)}s`,
  duration: `${6.8 + (index % 6) * 1.15}s`,
  size: `${1 + (index % 3)}px`,
}));

function prettyMuscle(raw: string) {
  const value = String(raw || "").trim().replace(/_/g, " ");
  if (!value) return "";
  if (value.toLowerCase() === "abs") return "Core";
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function estimateTemplateMinutes(rows: any[]) {
  if (!rows.length) return null;

  let totalSeconds = 0;
  for (const row of rows) {
    const durationMinutes = Number(row?.duration_minutes ?? 0);
    const durationSeconds = Number(row?.duration_seconds ?? 0);

    if (durationMinutes > 0 || durationSeconds > 0) {
      totalSeconds += durationMinutes > 0 ? durationMinutes * 60 : durationSeconds;
      totalSeconds += 45;
      continue;
    }

    const sets = Math.max(1, Number(row?.sets ?? row?.prescription_snapshot?.sets ?? 3));
    const rest = Math.max(30, Number(row?.rest_seconds ?? row?.prescription_snapshot?.rest_seconds ?? 60));
    totalSeconds += sets * 50 + Math.max(0, sets - 1) * rest + 45;
  }

  return Math.max(10, Math.round(totalSeconds / 60));
}

async function loadLaunchPreview(sessionId: string): Promise<LaunchPreview> {
  const empty: LaunchPreview = {
    exerciseCount: null,
    workingSets: null,
    estimatedMinutes: null,
    focus: "Training",
  };

  try {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) return empty;

    const { data: session, error: sessionError } = await supabase
      .from("scheduled_sessions")
      .select("*")
      .eq("id", sessionId)
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (sessionError || !session) return empty;

    const templateId = (session as any)?.template_id;
    if (!templateId) return empty;

    const { data: rows, error: templateError } = await supabase
      .from("template_exercises")
      .select("*")
      .eq("template_id", templateId)
      .order("order_index", { ascending: true });

    if (templateError || !rows?.length) return empty;

    const exerciseIds = Array.from(
      new Set((rows as any[]).map((row) => String(row.exercise_id || "")).filter(Boolean))
    );

    let focus = "Training";
    if (exerciseIds.length) {
      const { data: exercises } = await supabase
        .from("exercises")
        .select("id,primary_muscles")
        .in("id", exerciseIds);

      const counts = new Map<string, number>();
      for (const exercise of exercises ?? []) {
        for (const muscle of Array.isArray((exercise as any).primary_muscles)
          ? (exercise as any).primary_muscles
          : []) {
          const key = prettyMuscle(String(muscle));
          if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }

      const top = Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name]) => name);

      if (top.length) focus = top.join(" + ");
    }

    const workingSets = (rows as any[]).reduce((sum, row) => {
      const timed = Number(row?.duration_minutes ?? 0) > 0 || Number(row?.duration_seconds ?? 0) > 0;
      if (timed) return sum;
      return sum + Math.max(1, Number(row?.sets ?? row?.prescription_snapshot?.sets ?? 3));
    }, 0);

    return {
      exerciseCount: rows.length,
      workingSets: workingSets || null,
      estimatedMinutes: estimateTemplateMinutes(rows as any[]),
      focus,
    };
  } catch {
    return empty;
  }
}

export function PreWorkoutLaunch({
  sessionId,
  sessionLabel,
  weight,
  onWeightChange,
  onStart,
  onCancel,
}: Props) {
  const [selectedVideo, setSelectedVideo] = useState<MotivationVideoRecord | null>(null);
  const [motivation, setMotivation] = useState<WorkoutMotivationPick>(() => pickWorkoutMotivation());
  const [preview, setPreview] = useState<LaunchPreview>({
    exerciseCount: null,
    workingSets: null,
    estimatedMinutes: null,
    focus: "Training",
  });
  const [weightEditing, setWeightEditing] = useState(() => !String(weight || "").trim());
  const [validationError, setValidationError] = useState("");
  const [videoReady, setVideoReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;

    document.documentElement.classList.add("tr-prelaunch-open");
    return () => {
      document.documentElement.classList.remove("tr-prelaunch-open");
    };
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      const video = videoRef.current;
      if (!video) return;

      if (document.hidden) {
        video.pause();
      } else {
        void video.play().catch(() => undefined);
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void listActiveMotivationVideos()
      .then((records) => {
        if (cancelled) return;
        setSelectedVideo(pickMotivationVideo(records));
      })
      .catch(() => {
        if (!cancelled) {
          setSelectedVideo(null);
        }
      });

    void loadLaunchPreview(sessionId).then((result) => {
      if (!cancelled) setPreview(result);
    });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const safeWeight = Number(String(weight || "").trim());
  const hasValidWeight = Number.isFinite(safeWeight) && safeWeight > 0;

  const videoClass = selectedVideo?.orientation
    ? `is-${selectedVideo.orientation}`
    : "is-landscape";

  const statItems = useMemo(
    () => [
      {
        label: "EXERCISES",
        value: preview.exerciseCount != null ? String(preview.exerciseCount) : "READY",
      },
      {
        label: "WORKING SETS",
        value: preview.workingSets != null ? String(preview.workingSets) : "COACH",
      },
      {
        label: "EST. SESSION",
        value: preview.estimatedMinutes != null ? `~${preview.estimatedMinutes} MIN` : "SESSION",
      },
      {
        label: "FOCUS",
        value: preview.focus || "Training",
      },
    ],
    [preview]
  );

  function refreshMotivation() {
    // Keep the current video playing so refreshing the text never forces a
    // second video decode/network start. A new clip is chosen on the next launch.
    setMotivation(pickWorkoutMotivation());
  }

  async function handleStart() {
    if (!hasValidWeight) {
      setValidationError("Enter your current body weight before starting the session.");
      setWeightEditing(true);
      return;
    }

    setValidationError("");
    await onStart();
  }

  return (
    <section className={`tr-preLaunch ${selectedVideo ? "has-video" : ""}`} aria-label="Pre-workout launch">
      <div className="tr-preLaunchField" aria-hidden="true">
        <span className="tr-preLaunchOrb tr-preLaunchOrb--a" />
        <span className="tr-preLaunchOrb tr-preLaunchOrb--b" />
        <span className="tr-preLaunchOrb tr-preLaunchOrb--c" />
        <span className="tr-preLaunchSweep" />
        <span className="tr-preLaunchGrid" />
        <span className="tr-preLaunchNoise" />
        {PARTICLES.map((particle, index) => (
          <span
            key={index}
            className="tr-preLaunchParticle"
            style={
              {
                "--left": particle.left,
                "--top": particle.top,
                "--delay": particle.delay,
                "--duration": particle.duration,
                "--size": particle.size,
              } as CSSProperties
            }
          />
        ))}
      </div>

      <header className="tr-preLaunchTopbar">
        <div>
          <div className="tr-preLaunchKicker">PRE-WORKOUT LAUNCH</div>
          <div className="tr-preLaunchSession">{sessionLabel || "Workout Session"}</div>
        </div>
        <div className="tr-preLaunchReady"><span /> SYSTEM READY</div>
      </header>

      <div className="tr-preLaunchHero">
        <div className={`tr-preLaunchVideoStage ${videoClass}`}>
          {selectedVideo ? (
            <video
              ref={videoRef}
              key={selectedVideo.id}
              src={selectedVideo.public_url}
              className={`tr-preLaunchVideo ${videoReady ? "is-ready" : "is-loading"}`}
              autoPlay
              loop
              muted
              playsInline
              preload="auto"
              disablePictureInPicture
              onLoadStart={() => setVideoReady(false)}
              onCanPlay={() => setVideoReady(true)}
              onPlaying={() => setVideoReady(true)}
            />
          ) : (
            <div className="tr-preLaunchVideoFallback" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          )}
          <div className="tr-preLaunchVideoVignette" aria-hidden="true" />
          <div className="tr-preLaunchVideoScan" aria-hidden="true" />
        </div>

        <div className="tr-preLaunchMotivation">
          <div className="tr-preLaunchMotivationEyebrow">TODAY'S MINDSET</div>
          <h1 key={motivation.headline.id}>{motivation.headline.text}</h1>
          <p key={motivation.speech.id}>{motivation.speech.text}</p>
          <button type="button" className="tr-preLaunchRefresh" onClick={refreshMotivation}>
            ↻ NEW MOTIVATION
          </button>
        </div>
      </div>

      <div className="tr-preLaunchCommandDeck">
        <div className="tr-preLaunchStats">
          {statItems.map((item) => (
            <div key={item.label} className="tr-preLaunchStat">
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>

        <div className="tr-preLaunchWeightCard">
          <div className="tr-preLaunchWeightCopy">
            <span>CURRENT BODY WEIGHT</span>
            <strong>{hasValidWeight && !weightEditing ? `${safeWeight} LB` : "CHECK IN"}</strong>
            <small>Used for today's training and protein target.</small>
          </div>

          {weightEditing ? (
            <div className="tr-preLaunchWeightEditor">
              <div className="tr-preLaunchWeightInputWrap">
                <input
                  value={weight}
                  onChange={(event) => {
                    setValidationError("");
                    onWeightChange(event.target.value.replace(/[^\d.]/g, ""));
                  }}
                  inputMode="decimal"
                  placeholder="185"
                  aria-label="Current body weight in pounds"
                  autoFocus
                />
                <span>LB</span>
              </div>
              {hasValidWeight ? (
                <button type="button" className="tr-preLaunchWeightDone" onClick={() => setWeightEditing(false)}>
                  SAVE
                </button>
              ) : null}
            </div>
          ) : (
            <button type="button" className="tr-preLaunchWeightChange" onClick={() => setWeightEditing(true)}>
              CHANGE
            </button>
          )}
        </div>

        {validationError ? <div className="tr-preLaunchError">{validationError}</div> : null}

        <div className="tr-preLaunchActions">
          <button type="button" className="tr-preLaunchStart" onClick={() => void handleStart()}>
            <span className="tr-preLaunchStartIcon">▶</span>
            <span>
              <small>READY WHEN YOU ARE</small>
              <strong>START SESSION</strong>
            </span>
            <span className="tr-preLaunchStartArrow">→</span>
          </button>

          <button type="button" className="tr-preLaunchCancel" onClick={onCancel}>
            CANCEL
          </button>
        </div>
      </div>

      <style>{`
        .tr-preLaunch{
          position:relative;
          isolation:isolate;
          width:100%;
          min-height:min(840px,calc(100dvh - 138px));
          overflow:hidden;
          border:1px solid rgba(63,211,255,.29);
          border-radius:28px;
          background:linear-gradient(180deg,#071019 0%,#03070c 54%,#05080c 100%);
          box-shadow:inset 0 1px 0 rgba(255,255,255,.065),0 30px 100px rgba(0,0,0,.52),0 0 50px rgba(0,174,255,.07);
          color:#fff;
        }
        .tr-preLaunch::before{
          content:"";
          position:absolute;
          inset:0;
          z-index:-1;
          background:radial-gradient(900px 440px at 14% 2%,rgba(0,177,255,.15),transparent 67%),radial-gradient(800px 500px at 91% 28%,rgba(255,91,20,.10),transparent 68%);
          pointer-events:none;
        }
        .tr-preLaunchField{position:absolute;inset:0;z-index:-1;overflow:hidden;pointer-events:none}
        .tr-preLaunchOrb{position:absolute;border-radius:50%;filter:blur(32px);opacity:.42;will-change:transform}
        .tr-preLaunchOrb--a{width:38vw;height:38vw;left:-12vw;top:8%;background:radial-gradient(circle,rgba(0,194,255,.30),rgba(0,104,255,.04) 66%,transparent 72%);animation:trLaunchFloatA 24s ease-in-out infinite alternate}
        .tr-preLaunchOrb--b{width:34vw;height:34vw;right:-10vw;top:16%;background:radial-gradient(circle,rgba(255,102,26,.20),rgba(255,30,0,.03) 68%,transparent 74%);animation:trLaunchFloatB 28s ease-in-out infinite alternate}
        .tr-preLaunchOrb--c{width:28vw;height:28vw;left:42%;bottom:-17vw;background:radial-gradient(circle,rgba(25,224,180,.13),rgba(0,174,255,.02) 66%,transparent 72%);animation:trLaunchFloatC 32s ease-in-out infinite alternate}
        .tr-preLaunchSweep{position:absolute;inset:-30% -40%;background:conic-gradient(from 210deg at 50% 50%,transparent 0 37%,rgba(104,223,255,.055) 44%,transparent 51% 100%);animation:trLaunchSweep 34s linear infinite}
        .tr-preLaunchGrid{position:absolute;inset:0;opacity:.13;background-image:linear-gradient(rgba(99,219,255,.09) 1px,transparent 1px),linear-gradient(90deg,rgba(99,219,255,.07) 1px,transparent 1px);background-size:72px 72px;mask-image:linear-gradient(to bottom,rgba(0,0,0,.7),transparent 72%)}
        .tr-preLaunchNoise{position:absolute;inset:0;opacity:.11;background-image:radial-gradient(circle at 20% 30%,rgba(255,255,255,.45) 0 .7px,transparent .8px),radial-gradient(circle at 80% 70%,rgba(255,255,255,.35) 0 .6px,transparent .7px);background-size:7px 7px,11px 11px;animation:none}
        .tr-preLaunchParticle{position:absolute;left:var(--left);top:var(--top);width:var(--size);height:var(--size);border-radius:50%;background:rgba(191,240,255,.86);box-shadow:0 0 10px rgba(64,204,255,.7);animation:trLaunchParticle var(--duration) ease-in-out var(--delay) infinite alternate}
        @keyframes trLaunchFloatA{to{transform:translate(11vw,-4vh) scale(1.12)}}
        @keyframes trLaunchFloatB{to{transform:translate(-9vw,8vh) scale(.9)}}
        @keyframes trLaunchFloatC{to{transform:translate(7vw,-6vh) scale(1.18)}}
        @keyframes trLaunchSweep{to{transform:rotate(360deg)}}
        @keyframes trLaunchNoise{50%{transform:translate3d(2px,-1px,0)}}
        @keyframes trLaunchParticle{0%{transform:translateY(8px) scale(.7);opacity:.18}100%{transform:translateY(-22px) scale(1.45);opacity:.9}}
        html.tr-prelaunch-open .tr-hudActionBtn.tr-seg--startBlue{display:none!important}
        .tr-preLaunch.has-video .tr-preLaunchSweep{animation:none;transform:rotate(18deg);opacity:.34}
        .tr-preLaunch.has-video .tr-preLaunchNoise{opacity:.06}
        .tr-preLaunch.has-video .tr-preLaunchParticle{animation-duration:14s;opacity:.5}
        .tr-preLaunchTopbar{position:relative;z-index:3;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:21px 24px 17px;border-bottom:1px solid rgba(255,255,255,.075);background:linear-gradient(180deg,rgba(5,12,18,.88),rgba(5,12,18,.42));backdrop-filter:none}
        .tr-preLaunchTopbar>div:first-child{min-width:0;display:grid;gap:5px}
        .tr-preLaunchKicker{color:#7cdcff;font-size:9px;font-weight:1000;letter-spacing:.25em;text-transform:uppercase}
        .tr-preLaunchSession{min-width:0;color:#f8fbfd;font-size:clamp(17px,2.2vw,25px);font-weight:1000;letter-spacing:-.015em;overflow-wrap:anywhere}
        .tr-preLaunchReady{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:8px 11px;border:1px solid rgba(58,224,116,.30);border-radius:999px;color:#83efa3;background:rgba(34,175,81,.08);font-size:8px;font-weight:1000;letter-spacing:.16em}
        .tr-preLaunchReady span{width:7px;height:7px;border-radius:50%;background:#51e47c;box-shadow:0 0 13px rgba(71,235,122,.7);animation:trLaunchReady 1.7s ease-in-out infinite}
        @keyframes trLaunchReady{50%{opacity:.45;transform:scale(.78)}}
        .tr-preLaunchHero{position:relative;min-height:470px;display:grid;place-items:center;overflow:hidden;contain:paint}
        .tr-preLaunchVideoStage{position:absolute;inset:0;display:grid;place-items:center;overflow:hidden;contain:paint;background:radial-gradient(circle at 50% 48%,rgba(0,174,255,.10),transparent 48%),#020406;transform:translateZ(0)}
        .tr-preLaunchVideo{width:100%;height:100%;display:block;object-fit:cover;opacity:0;transform:translateZ(0);backface-visibility:hidden;transition:opacity .24s ease}.tr-preLaunchVideo.is-ready{opacity:.92}.tr-preLaunchVideo.is-loading{opacity:0}
        .tr-preLaunchVideoStage.is-portrait .tr-preLaunchVideo{width:min(42%,410px);object-fit:cover;border-left:1px solid rgba(171,233,255,.13);border-right:1px solid rgba(171,233,255,.13);box-shadow:0 0 80px rgba(0,0,0,.82),0 0 70px rgba(0,174,255,.09)}
        .tr-preLaunchVideoStage.is-square .tr-preLaunchVideo{width:min(58%,580px);object-fit:cover}
        .tr-preLaunchVideoFallback{position:absolute;inset:0;background:radial-gradient(circle at 28% 34%,rgba(0,174,255,.18),transparent 28%),radial-gradient(circle at 76% 62%,rgba(255,105,28,.12),transparent 31%)}
        .tr-preLaunchVideoFallback span{position:absolute;width:44%;height:1px;left:28%;top:42%;background:linear-gradient(90deg,transparent,rgba(117,223,255,.55),transparent);box-shadow:0 0 22px rgba(0,174,255,.25);animation:trLaunchFallback 2.7s ease-in-out infinite alternate}
        .tr-preLaunchVideoFallback span:nth-child(2){top:50%;animation-delay:-.9s}.tr-preLaunchVideoFallback span:nth-child(3){top:58%;animation-delay:-1.8s}
        @keyframes trLaunchFallback{to{transform:scaleX(.55) translateX(14%);opacity:.28}}
        .tr-preLaunchVideoVignette{position:absolute;inset:0;background:linear-gradient(90deg,rgba(2,6,10,.92) 0%,rgba(2,6,10,.30) 31%,rgba(2,6,10,.20) 50%,rgba(2,6,10,.35) 69%,rgba(2,6,10,.94) 100%),linear-gradient(180deg,rgba(2,6,10,.22),rgba(2,6,10,.24) 48%,rgba(2,6,10,.92) 100%);pointer-events:none}
        .tr-preLaunchVideoScan{position:absolute;inset:0;opacity:.15;background:repeating-linear-gradient(180deg,rgba(255,255,255,.025) 0 1px,transparent 1px 4px);mix-blend-mode:screen;pointer-events:none}
        .tr-preLaunchMotivation{position:relative;z-index:2;width:min(900px,88%);display:grid;justify-items:center;gap:10px;padding:44px 20px 52px;text-align:center;text-shadow:0 4px 24px rgba(0,0,0,.92)}
        .tr-preLaunchMotivationEyebrow{color:rgba(181,229,247,.76);font-size:9px;font-weight:1000;letter-spacing:.27em}
        .tr-preLaunchMotivation h1{margin:0;max-width:100%;font-size:clamp(42px,7vw,88px);line-height:.91;font-weight:1100;letter-spacing:-.045em;text-wrap:balance;animation:trLaunchTitleIn .72s cubic-bezier(.2,.8,.2,1) both}
        .tr-preLaunchMotivation p{margin:3px 0 0;max-width:760px;color:rgba(246,250,252,.94);font-size:clamp(16px,2.05vw,23px);line-height:1.35;font-weight:820;text-wrap:balance;animation:trLaunchSpeechIn .75s .12s ease-out both}
        @keyframes trLaunchTitleIn{from{opacity:0;transform:translateY(18px) scale(.975);filter:blur(7px)}to{opacity:1;transform:none;filter:none}}
        @keyframes trLaunchSpeechIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
        .tr-preLaunchRefresh{margin-top:11px;height:40px;padding:0 16px;border:1px solid rgba(180,229,246,.20);border-radius:999px;color:rgba(218,239,247,.72);background:rgba(3,9,14,.42);font-size:9px;font-weight:1000;letter-spacing:.13em;cursor:pointer;backdrop-filter:none}
        .tr-preLaunchRefresh:hover{border-color:rgba(84,208,255,.46);color:#dff7ff}
        .tr-preLaunchCommandDeck{position:relative;z-index:4;display:grid;gap:13px;padding:16px 19px 20px;border-top:1px solid rgba(255,255,255,.075);background:linear-gradient(180deg,rgba(4,9,14,.75),rgba(3,7,11,.985));backdrop-filter:none}
        .tr-preLaunchStats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}
        .tr-preLaunchStat{min-width:0;min-height:68px;padding:10px 12px;display:grid;align-content:center;gap:5px;border:1px solid rgba(255,255,255,.085);border-radius:14px;background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(0,0,0,.15));box-shadow:inset 0 1px 0 rgba(255,255,255,.035);text-align:center}
        .tr-preLaunchStat span{color:rgba(164,198,216,.55);font-size:7px;font-weight:1000;letter-spacing:.15em}
        .tr-preLaunchStat strong{min-width:0;color:#f7fbfd;font-size:13px;font-weight:1000;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .tr-preLaunchWeightCard{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:14px;padding:13px 15px;border:1px solid rgba(0,191,255,.24);border-radius:16px;background:radial-gradient(440px 130px at 0 0,rgba(0,174,255,.09),transparent 70%),linear-gradient(180deg,rgba(10,20,28,.92),rgba(4,9,13,.96))}
        .tr-preLaunchWeightCopy{min-width:0;display:grid;gap:3px}
        .tr-preLaunchWeightCopy>span{color:#7cdcff;font-size:8px;font-weight:1000;letter-spacing:.16em}
        .tr-preLaunchWeightCopy strong{color:#fff;font-size:24px;line-height:1;font-weight:1100;font-variant-numeric:tabular-nums}
        .tr-preLaunchWeightCopy small{color:rgba(184,207,220,.56);font-size:10px}
        .tr-preLaunchWeightChange,.tr-preLaunchWeightDone{height:42px;padding:0 16px;border:1px solid rgba(72,208,255,.34);border-radius:12px;color:#bcefff;background:rgba(0,174,255,.08);font-size:8px;font-weight:1000;letter-spacing:.13em;cursor:pointer}
        .tr-preLaunchWeightEditor{display:flex;align-items:center;gap:8px}
        .tr-preLaunchWeightInputWrap{height:46px;display:flex;align-items:center;gap:6px;padding:0 10px;border:1px solid rgba(88,215,255,.42);border-radius:12px;background:#07111a;box-shadow:inset 0 2px 8px rgba(0,0,0,.55)}
        .tr-preLaunchWeightInputWrap input{width:104px;border:0;outline:0;background:transparent;color:#fff;font:1000 22px/1 inherit;font-variant-numeric:tabular-nums;text-align:right}
        .tr-preLaunchWeightInputWrap span{color:#76dbff;font-size:10px;font-weight:1000;letter-spacing:.1em}
        .tr-preLaunchError{padding:9px 12px;border:1px solid rgba(255,79,79,.28);border-radius:12px;color:#ffb1b1;background:rgba(255,49,49,.08);font-size:11px;font-weight:800}
        .tr-preLaunchActions{display:grid;grid-template-columns:minmax(0,1fr) 132px;gap:10px}
        .tr-preLaunchStart{position:relative;min-height:70px;display:grid;grid-template-columns:48px minmax(0,1fr) 36px;align-items:center;gap:12px;padding:9px 14px;border:1px solid rgba(75,218,255,.70);border-radius:17px;color:#fff;background:radial-gradient(500px 120px at 18% 0,rgba(68,216,255,.28),transparent 66%),linear-gradient(180deg,#0d82b4,#05506f);box-shadow:inset 0 1px 0 rgba(255,255,255,.18),0 18px 42px rgba(0,0,0,.36),0 0 28px rgba(0,184,255,.14);cursor:pointer;overflow:hidden;transition:transform .15s ease,box-shadow .15s ease}
        .tr-preLaunchStart::after{content:"";position:absolute;inset:-2px -35%;background:linear-gradient(110deg,transparent 35%,rgba(255,255,255,.18) 49%,transparent 63%);transform:translateX(-70%);animation:trLaunchButtonSweep 3.7s ease-in-out infinite}
        @keyframes trLaunchButtonSweep{0%,58%{transform:translateX(-70%)}88%,100%{transform:translateX(70%)}}
        .tr-preLaunchStart:hover{transform:translateY(-1px);box-shadow:inset 0 1px 0 rgba(255,255,255,.2),0 22px 52px rgba(0,0,0,.42),0 0 36px rgba(0,190,255,.22)}
        .tr-preLaunchStartIcon{position:relative;z-index:1;width:44px;height:44px;display:grid;place-items:center;border:1px solid rgba(218,248,255,.46);border-radius:50%;background:rgba(0,0,0,.18);font-size:15px}
        .tr-preLaunchStart>span:nth-child(2){position:relative;z-index:1;min-width:0;display:grid;gap:2px;text-align:left}
        .tr-preLaunchStart small{color:rgba(209,244,255,.74);font-size:7px;font-weight:1000;letter-spacing:.17em}
        .tr-preLaunchStart strong{font-size:20px;font-weight:1100;letter-spacing:.01em}
        .tr-preLaunchStartArrow{position:relative;z-index:1;color:#dff9ff;font-size:24px}
        .tr-preLaunchCancel{border:1px solid rgba(255,255,255,.10);border-radius:17px;color:rgba(223,231,236,.68);background:rgba(255,255,255,.025);font-size:9px;font-weight:1000;letter-spacing:.13em;cursor:pointer}
        @media(max-width:820px){
          .tr-preLaunch{min-height:0;border-radius:22px}
          .tr-preLaunchTopbar{padding:16px}
          .tr-preLaunchHero{min-height:520px}
          .tr-preLaunchVideoStage.is-portrait .tr-preLaunchVideo{width:100%;object-fit:cover;border:0;box-shadow:none}
          .tr-preLaunchVideoStage.is-landscape .tr-preLaunchVideo{object-fit:cover}
          .tr-preLaunchVideoVignette{background:linear-gradient(180deg,rgba(2,6,10,.20),rgba(2,6,10,.12) 45%,rgba(2,6,10,.92) 100%),linear-gradient(90deg,rgba(2,6,10,.24),transparent 28% 72%,rgba(2,6,10,.24))}
          .tr-preLaunchMotivation{width:94%;align-self:end;padding:92px 14px 42px}
          .tr-preLaunchMotivation h1{font-size:clamp(40px,12vw,68px)}
          .tr-preLaunchStats{grid-template-columns:repeat(2,minmax(0,1fr))}
        }
        @media(max-width:560px){
          .tr-preLaunchTopbar{align-items:flex-start}
          .tr-preLaunchReady{font-size:6.8px;padding:7px 8px}
          .tr-preLaunchHero{min-height:480px}
          .tr-preLaunchMotivation{padding-bottom:30px}
          .tr-preLaunchMotivation p{font-size:15px}
          .tr-preLaunchCommandDeck{padding:12px}
          .tr-preLaunchStat{min-height:59px;padding:8px}
          .tr-preLaunchStat strong{font-size:11px}
          .tr-preLaunchWeightCard{grid-template-columns:1fr;gap:10px}
          .tr-preLaunchWeightEditor{justify-content:space-between}
          .tr-preLaunchWeightInputWrap{flex:1}
          .tr-preLaunchWeightInputWrap input{width:100%}
          .tr-preLaunchWeightChange{width:100%}
          .tr-preLaunchActions{grid-template-columns:1fr}
          .tr-preLaunchCancel{min-height:44px}
        }
        @media(prefers-reduced-motion:reduce){
          .tr-preLaunch *{animation-duration:.001ms!important;animation-iteration-count:1!important}
        }
      `}</style>
    </section>
  );
}
