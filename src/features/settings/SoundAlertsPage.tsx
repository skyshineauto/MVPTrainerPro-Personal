import { useEffect, useRef, useState } from "react";
import {
  ALERT_SOUND_TYPES,
  listAlertSounds,
  removeAlertSound,
  uploadAlertSound,
  type AlertSoundRecord,
  type AlertSoundType,
} from "../../lib/alertSoundStorage";
import {
  invalidateWorkoutAlertCache,
  playWorkoutAlert,
  preloadWorkoutAlert,
  primeWorkoutAudio,
} from "../../lib/workoutAudio";
import { Card } from "../../ui/Card";

const ALERT_LABELS: Record<
  AlertSoundType,
  {
    title: string;
    description: string;
    behavior: string;
  }
> = {
  workout_start: {
    title: "Workout Start",
    description:
      "Plays once after a brand-new workout successfully begins.",
    behavior:
      "Does not replay when you return to or resume an existing workout.",
  },
  rest_complete: {
    title: "Rest Complete",
    description:
      "Plays when the active rest countdown reaches zero.",
    behavior:
      "The finished timer dismisses automatically. Skip Rest remains silent.",
  },
  exercise_complete: {
    title: "Exercise Complete",
    description:
      "Plays after an exercise is locked as complete.",
    behavior:
      "Music lowers temporarily so the completion sound stays clear.",
  },
  workout_complete: {
    title: "Workout Complete",
    description:
      "Plays after the final exercise is completed.",
    behavior:
      "Music lowers temporarily and returns after the alert finishes.",
  },
};

type RecordMap = Partial<
  Record<AlertSoundType, AlertSoundRecord>
>;

type ReadyMap = Partial<Record<AlertSoundType, boolean>>;

type Notice = {
  tone: "ok" | "err";
  text: string;
} | null;

function formatUpdatedAt(value: string | null | undefined) {
  if (!value) return "Built-in sound";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Custom sound";

  return `Updated ${date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}

export function SoundAlertsPage({
  navigate,
}: {
  navigate?: (to: string) => void;
}) {
  const [records, setRecords] = useState<RecordMap>({});
  const [readyTypes, setReadyTypes] = useState<ReadyMap>({});
  const [loading, setLoading] = useState(true);
  const [busyType, setBusyType] =
    useState<AlertSoundType | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const inputRefs = useRef<
    Partial<Record<AlertSoundType, HTMLInputElement | null>>
  >({});

  async function prepareConfiguredSounds(nextRecords: RecordMap) {
    const entries = await Promise.all(
      ALERT_SOUND_TYPES.map(async (alertType) => {
        if (!nextRecords[alertType]) {
          return [alertType, false] as const;
        }

        const ready = await preloadWorkoutAlert(alertType);
        return [alertType, ready] as const;
      })
    );

    const nextReady: ReadyMap = {};
    for (const [alertType, ready] of entries) {
      nextReady[alertType] = ready;
    }

    setReadyTypes(nextReady);
  }

  async function load() {
    setLoading(true);
    setNotice(null);

    try {
      const nextRecords = await listAlertSounds();
      setRecords(nextRecords);
      await prepareConfiguredSounds(nextRecords);
    } catch (error: unknown) {
      setNotice({
        tone: "err",
        text:
          error instanceof Error
            ? error.message
            : "Alert sounds could not be loaded. Run the included Supabase setup SQL first.",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleUpload(
    alertType: AlertSoundType,
    file: File
  ) {
    primeWorkoutAudio();
    setBusyType(alertType);
    setNotice(null);

    try {
      const record = await uploadAlertSound(alertType, file);

      invalidateWorkoutAlertCache(alertType);

      const ready = await preloadWorkoutAlert(alertType, {
        forceRefresh: true,
      });

      setRecords((current) => ({
        ...current,
        [alertType]: record,
      }));

      setReadyTypes((current) => ({
        ...current,
        [alertType]: ready,
      }));

      setNotice({
        tone: "ok",
        text: ready
          ? `${ALERT_LABELS[alertType].title} sound uploaded, decoded, and ready.`
          : `${ALERT_LABELS[alertType].title} sound uploaded. MVP Trainer will retry it at playback time.`,
      });
    } catch (error: unknown) {
      setNotice({
        tone: "err",
        text:
          error instanceof Error
            ? error.message
            : "The alert sound could not be uploaded.",
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
      if (records[alertType]) {
        const ready = await preloadWorkoutAlert(alertType);

        setReadyTypes((current) => ({
          ...current,
          [alertType]: ready,
        }));
      }

      const source = await playWorkoutAlert(alertType);

      setNotice({
        tone: "ok",
        text:
          source === "uploaded"
            ? `${ALERT_LABELS[alertType].title} custom sound played successfully.`
            : `${ALERT_LABELS[alertType].title} built-in fallback played successfully.`,
      });
    } catch (error: unknown) {
      setNotice({
        tone: "err",
        text:
          error instanceof Error
            ? error.message
            : "The sound could not be played.",
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
      invalidateWorkoutAlertCache(alertType);

      setRecords((current) => {
        const next = { ...current };
        delete next[alertType];
        return next;
      });

      setReadyTypes((current) => ({
        ...current,
        [alertType]: false,
      }));

      setNotice({
        tone: "ok",
        text: `${ALERT_LABELS[alertType].title} reset to the built-in sound.`,
      });
    } catch (error: unknown) {
      setNotice({
        tone: "err",
        text:
          error instanceof Error
            ? error.message
            : "The uploaded sound could not be removed.",
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
          <button
            type="button"
            className="tr-seg"
            onClick={goBack}
          >
            Back
          </button>
        }
      >
        <div className="tr-soundAlertsIntro">
          <div
            className="tr-soundAlertsIntroIcon"
            aria-hidden
          >
            ♪
          </div>

          <div>
            <div className="tr-soundAlertsIntroTitle">
              CUSTOM WORKOUT ALERTS
            </div>

            <div className="tr-sub">
              Upload MP3, M4A, or WAV files up to 5 MB. New
              files are cleared from the old audio cache and
              prepared immediately. When a custom sound cannot
              play, MVP Trainer uses its built-in alert.
            </div>
          </div>
        </div>

        {notice ? (
          <div
            className={`tr-soundAlertsNotice is-${notice.tone}`}
            role="status"
          >
            {notice.text}
          </div>
        ) : null}

        {loading ? (
          <div className="tr-rowbox">
            Loading and preparing alert sounds…
          </div>
        ) : (
          <div className="tr-soundAlertsGrid">
            {ALERT_SOUND_TYPES.map((alertType) => {
              const record = records[alertType];
              const busy = busyType === alertType;
              const customReady =
                Boolean(record) && readyTypes[alertType] === true;

              return (
                <section
                  key={alertType}
                  className="tr-soundAlertCard"
                >
                  <div className="tr-soundAlertCardTop">
                    <div>
                      <div className="tr-kicker">
                        ALERT EVENT
                      </div>

                      <div className="tr-soundAlertTitle">
                        {ALERT_LABELS[alertType].title}
                      </div>
                    </div>

                    <div
                      className={`tr-soundAlertStatus ${
                        record
                          ? "is-custom"
                          : "is-built-in"
                      }`}
                    >
                      {record
                        ? customReady
                          ? "CUSTOM READY"
                          : "CUSTOM"
                        : "BUILT-IN"}
                    </div>
                  </div>

                  <div className="tr-sub">
                    {ALERT_LABELS[alertType].description}
                  </div>

                  <div className="tr-soundAlertFile">
                    <div className="tr-soundAlertFileLabel">
                      CURRENT SOUND
                    </div>

                    <div className="tr-soundAlertFileName">
                      {record?.original_name ||
                        "MVP Trainer built-in alert"}
                    </div>

                    <div className="tr-sub">
                      {record
                        ? formatUpdatedAt(record.updated_at)
                        : ALERT_LABELS[alertType].behavior}
                    </div>
                  </div>

                  {record ? (
                    <div className="tr-sub">
                      {ALERT_LABELS[alertType].behavior}
                    </div>
                  ) : null}

                  <input
                    ref={(element) => {
                      inputRefs.current[alertType] = element;
                    }}
                    type="file"
                    accept=".mp3,.m4a,.wav,audio/mpeg,audio/mp4,audio/wav"
                    className="tr-soundAlertHiddenInput"
                    onChange={(event) => {
                      const file =
                        event.target.files?.[0];

                      if (file) {
                        void handleUpload(
                          alertType,
                          file
                        );
                      }
                    }}
                  />

                  <div className="tr-soundAlertActions">
                    <button
                      type="button"
                      className="tr-btn tr-btn--primary"
                      disabled={busyType !== null}
                      onClick={() =>
                        inputRefs.current[
                          alertType
                        ]?.click()
                      }
                    >
                      {busy
                        ? "PREPARING…"
                        : record
                          ? "REPLACE"
                          : "UPLOAD"}
                    </button>

                    <button
                      type="button"
                      className="tr-btn"
                      disabled={busyType !== null}
                      onClick={() =>
                        void handleTest(alertType)
                      }
                    >
                      {busy ? "WORKING…" : "TEST"}
                    </button>

                    <button
                      type="button"
                      className="tr-btn tr-soundAlertRemove"
                      disabled={
                        busyType !== null || !record
                      }
                      onClick={() =>
                        void handleRemove(alertType)
                      }
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
