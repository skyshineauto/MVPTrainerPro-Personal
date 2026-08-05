import { useEffect, useRef, useState } from "react";
import {
  ALERT_SOUND_TYPES,
  listAlertSounds,
  removeAlertSound,
  uploadAlertSound,
  type AlertSoundRecord,
  type AlertSoundType,
} from "../../lib/alertSoundStorage";
import { playWorkoutAlert, primeWorkoutAudio } from "../../lib/workoutAudio";
import { Card } from "../../ui/Card";

const ALERT_LABELS: Record<
  AlertSoundType,
  { title: string; description: string }
> = {
  workout_start: {
    title: "Workout Start",
    description:
      "Plays once when a new workout session begins. It does not replay when a paused workout is resumed.",
  },
  rest_complete: {
    title: "Rest Complete",
    description: "Plays when the rest countdown reaches zero.",
  },
  exercise_complete: {
    title: "Exercise Complete",
    description: "Plays after an exercise is locked as complete.",
  },
  workout_complete: {
    title: "Workout Complete",
    description: "Plays after the final exercise is completed.",
  },
};

type RecordMap = Partial<Record<AlertSoundType, AlertSoundRecord>>;

type Notice = {
  tone: "ok" | "err";
  text: string;
} | null;

export function SoundAlertsPage({
  navigate,
}: {
  navigate?: (to: string) => void;
}) {
  const [records, setRecords] = useState<RecordMap>({});
  const [loading, setLoading] = useState(true);
  const [busyType, setBusyType] = useState<AlertSoundType | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const inputRefs = useRef<Partial<Record<AlertSoundType, HTMLInputElement | null>>>({});

  async function load() {
    setLoading(true);
    setNotice(null);

    try {
      setRecords(await listAlertSounds());
    } catch (error: any) {
      setNotice({
        tone: "err",
        text:
          error?.message ||
          "Alert sounds could not be loaded. Run the included Supabase setup SQL first.",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleUpload(alertType: AlertSoundType, file: File) {
    primeWorkoutAudio();
    setBusyType(alertType);
    setNotice(null);

    try {
      const record = await uploadAlertSound(alertType, file);
      setRecords((current) => ({ ...current, [alertType]: record }));
      setNotice({
        tone: "ok",
        text: `${ALERT_LABELS[alertType].title} sound uploaded.`,
      });
    } catch (error: any) {
      setNotice({
        tone: "err",
        text: error?.message || "The alert sound could not be uploaded.",
      });
    } finally {
      setBusyType(null);
      const input = inputRefs.current[alertType];
      if (input) input.value = "";
    }
  }

  async function handleTest(alertType: AlertSoundType) {
    primeWorkoutAudio();
    setBusyType(alertType);
    setNotice(null);

    try {
      const source = await playWorkoutAlert(alertType);
      setNotice({
        tone: "ok",
        text:
          source === "uploaded"
            ? `${ALERT_LABELS[alertType].title} uploaded sound played.`
            : `${ALERT_LABELS[alertType].title} built-in sound played.`,
      });
    } catch (error: any) {
      setNotice({
        tone: "err",
        text: error?.message || "The sound could not be played.",
      });
    } finally {
      setBusyType(null);
    }
  }

  async function handleRemove(alertType: AlertSoundType) {
    setBusyType(alertType);
    setNotice(null);

    try {
      await removeAlertSound(alertType);
      setRecords((current) => {
        const next = { ...current };
        delete next[alertType];
        return next;
      });
      setNotice({
        tone: "ok",
        text: `${ALERT_LABELS[alertType].title} reset to the built-in sound.`,
      });
    } catch (error: any) {
      setNotice({
        tone: "err",
        text: error?.message || "The uploaded sound could not be removed.",
      });
    } finally {
      setBusyType(null);
    }
  }

  function goBack() {
    if (navigate) {
      navigate("/");
      return;
    }

    window.location.pathname = "/";
  }

  return (
    <div className="tr-soundAlertsPage">
      <Card
        title="Sound & Alerts"
        tone="blue"
        right={
          <button type="button" className="tr-seg" onClick={goBack}>
            Back
          </button>
        }
      >
        <div className="tr-soundAlertsIntro">
          <div className="tr-soundAlertsIntroIcon" aria-hidden>♪</div>
          <div>
            <div className="tr-soundAlertsIntroTitle">CUSTOM WORKOUT ALERTS</div>
            <div className="tr-sub">
              Upload MP3, M4A, or WAV files up to 5 MB. When no custom file is assigned,
              MVP Trainer automatically uses its built-in alert.
            </div>
          </div>
        </div>

        {notice ? (
          <div className={`tr-soundAlertsNotice is-${notice.tone}`} role="status">
            {notice.text}
          </div>
        ) : null}

        {loading ? (
          <div className="tr-rowbox">Loading alert sounds…</div>
        ) : (
          <div className="tr-soundAlertsGrid">
            {ALERT_SOUND_TYPES.map((alertType) => {
              const record = records[alertType];
              const busy = busyType === alertType;

              return (
                <section key={alertType} className="tr-soundAlertCard">
                  <div className="tr-soundAlertCardTop">
                    <div>
                      <div className="tr-kicker">ALERT EVENT</div>
                      <div className="tr-soundAlertTitle">
                        {ALERT_LABELS[alertType].title}
                      </div>
                    </div>
                    <div className={`tr-soundAlertStatus ${record ? "is-custom" : "is-built-in"}`}>
                      {record ? "CUSTOM" : "BUILT-IN"}
                    </div>
                  </div>

                  <div className="tr-sub">{ALERT_LABELS[alertType].description}</div>

                  <div className="tr-soundAlertFile">
                    <div className="tr-soundAlertFileLabel">CURRENT SOUND</div>
                    <div className="tr-soundAlertFileName">
                      {record?.original_name || "MVP Trainer built-in alert"}
                    </div>
                  </div>

                  <input
                    ref={(element) => {
                      inputRefs.current[alertType] = element;
                    }}
                    type="file"
                    accept=".mp3,.m4a,.wav,audio/mpeg,audio/mp4,audio/wav"
                    className="tr-soundAlertHiddenInput"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void handleUpload(alertType, file);
                    }}
                  />

                  <div className="tr-soundAlertActions">
                    <button
                      type="button"
                      className="tr-btn tr-btn--primary"
                      disabled={busyType !== null}
                      onClick={() => inputRefs.current[alertType]?.click()}
                    >
                      {busy ? "WORKING…" : record ? "REPLACE" : "UPLOAD"}
                    </button>

                    <button
                      type="button"
                      className="tr-btn"
                      disabled={busyType !== null}
                      onClick={() => void handleTest(alertType)}
                    >
                      TEST
                    </button>

                    <button
                      type="button"
                      className="tr-btn tr-soundAlertRemove"
                      disabled={busyType !== null || !record}
                      onClick={() => void handleRemove(alertType)}
                    >
                      REMOVE
                    </button>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
