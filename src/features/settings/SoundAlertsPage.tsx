import { useEffect, useMemo, useRef, useState } from "react";
import {
  ALERT_SOUND_TYPES,
  listAlertSounds,
  removeAlertSound,
  uploadAlertSound,
  type AlertSoundRecord,
  type AlertSoundType,
} from "../../lib/alertSoundStorage";
import {
  listMotivationVideos,
  removeMotivationVideo,
  replaceMotivationVideo,
  setMotivationVideoActive,
  uploadMotivationVideo,
  type MotivationVideoRecord,
} from "../../lib/motivationVideoStorage";
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

function formatBytes(bytes: number | null | undefined) {
  const value = Number(bytes ?? 0);
  if (!(value > 0)) return "0 MB";
  const mb = value / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(mb >= 100 ? 0 : mb >= 10 ? 1 : 2)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(gb >= 10 ? 1 : 2)} GB`;
}

function formatDuration(seconds: number | null | undefined) {
  const total = Math.max(0, Math.round(Number(seconds ?? 0)));
  if (!total) return "—";
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return mins ? `${mins}:${String(secs).padStart(2, "0")}` : `${secs}s`;
}

function videoResolution(video: MotivationVideoRecord) {
  if (!(video.width && video.height)) return "—";
  return `${video.width} × ${video.height}`;
}

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

  const [motivationVideos, setMotivationVideos] = useState<MotivationVideoRecord[]>([]);
  const [videoLoading, setVideoLoading] = useState(true);
  const [videoBusyId, setVideoBusyId] = useState<string | null>(null);
  const [videoUploading, setVideoUploading] = useState(false);
  const [videoUploadPercent, setVideoUploadPercent] = useState(0);
  const [videoNotice, setVideoNotice] = useState<Notice>(null);
  const [previewVideo, setPreviewVideo] = useState<MotivationVideoRecord | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const replaceTargetRef = useRef<MotivationVideoRecord | null>(null);

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

  async function loadVideos() {
    setVideoLoading(true);
    setVideoNotice(null);

    try {
      setMotivationVideos(await listMotivationVideos());
    } catch (error: any) {
      setVideoNotice({
        tone: "err",
        text:
          error?.message ||
          "Motivation videos could not be loaded. Check the motivation-videos bucket and database setup.",
      });
    } finally {
      setVideoLoading(false);
    }
  }

  useEffect(() => {
    void load();
    void loadVideos();
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

  async function handleMotivationUpload(file: File) {
    setVideoUploading(true);
    setVideoUploadPercent(2);
    setVideoNotice(null);

    try {
      const record = await uploadMotivationVideo(file, (percent) => {
        setVideoUploadPercent(percent);
      });
      setMotivationVideos((current) =>
        [...current, record].sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
      );
      setVideoNotice({
        tone: "ok",
        text: `${record.file_name} uploaded and added to the launch rotation.`,
      });
    } catch (error: any) {
      setVideoNotice({
        tone: "err",
        text: error?.message || "The motivation video could not be uploaded.",
      });
    } finally {
      setVideoUploading(false);
      setVideoUploadPercent(0);
      if (videoInputRef.current) videoInputRef.current.value = "";
    }
  }

  async function handleReplace(file: File) {
    const target = replaceTargetRef.current;
    if (!target) return;

    setVideoBusyId(target.id);
    setVideoUploadPercent(2);
    setVideoNotice(null);

    try {
      const updated = await replaceMotivationVideo(target, file, (percent) => {
        setVideoUploadPercent(percent);
      });
      setMotivationVideos((current) =>
        current.map((video) => (video.id === target.id ? updated : video))
      );
      if (previewVideo?.id === target.id) setPreviewVideo(updated);
      setVideoNotice({
        tone: "ok",
        text: `${updated.file_name} replaced successfully.`,
      });
    } catch (error: any) {
      setVideoNotice({
        tone: "err",
        text: error?.message || "The motivation video could not be replaced.",
      });
    } finally {
      setVideoBusyId(null);
      setVideoUploadPercent(0);
      replaceTargetRef.current = null;
      if (replaceInputRef.current) replaceInputRef.current.value = "";
    }
  }

  async function handleVideoToggle(video: MotivationVideoRecord) {
    setVideoBusyId(video.id);
    setVideoNotice(null);

    try {
      const updated = await setMotivationVideoActive(video.id, !video.is_active);
      setMotivationVideos((current) =>
        current.map((row) => (row.id === updated.id ? updated : row))
      );
      setVideoNotice({
        tone: "ok",
        text: updated.is_active
          ? `${updated.file_name} is active in the workout launch rotation.`
          : `${updated.file_name} is disabled and will not appear before workouts.`,
      });
    } catch (error: any) {
      setVideoNotice({
        tone: "err",
        text: error?.message || "Video status could not be changed.",
      });
    } finally {
      setVideoBusyId(null);
    }
  }

  async function handleVideoRemove(video: MotivationVideoRecord) {
    if (!window.confirm(`Delete "${video.file_name}" from MVP Trainer?`)) return;

    setVideoBusyId(video.id);
    setVideoNotice(null);

    try {
      await removeMotivationVideo(video);
      setMotivationVideos((current) => current.filter((row) => row.id !== video.id));
      if (previewVideo?.id === video.id) setPreviewVideo(null);
      setVideoNotice({
        tone: "ok",
        text: `${video.file_name} deleted.`,
      });
    } catch (error: any) {
      setVideoNotice({
        tone: "err",
        text: error?.message || "The motivation video could not be deleted.",
      });
    } finally {
      setVideoBusyId(null);
    }
  }

  const videoStats = useMemo(() => {
    const totalBytes = motivationVideos.reduce(
      (sum, video) => sum + Math.max(0, Number(video.size_bytes ?? 0)),
      0
    );
    const active = motivationVideos.filter((video) => video.is_active).length;
    return { total: motivationVideos.length, active, totalBytes };
  }, [motivationVideos]);

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

        <section className="tr-motivationManager">
          <div className="tr-motivationHeader">
            <div>
              <div className="tr-kicker">PRE-WORKOUT LAUNCH MEDIA</div>
              <div className="tr-motivationTitle">MOTIVATION VIDEOS</div>
              <div className="tr-sub">
                Upload the cinematic clips used before a workout begins. Active videos rotate automatically in the launch experience.
              </div>
            </div>

            <button
              type="button"
              className="tr-btn tr-btn--primary tr-motivationUploadButton"
              disabled={videoUploading || videoBusyId !== null}
              onClick={() => videoInputRef.current?.click()}
            >
              {videoUploading ? "UPLOADING…" : "+ UPLOAD VIDEO"}
            </button>
          </div>

          <input
            ref={videoInputRef}
            type="file"
            accept=".mp4,video/mp4"
            className="tr-soundAlertHiddenInput"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleMotivationUpload(file);
            }}
          />

          <input
            ref={replaceInputRef}
            type="file"
            accept=".mp4,video/mp4"
            className="tr-soundAlertHiddenInput"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleReplace(file);
            }}
          />

          <div className="tr-motivationStats">
            <div>
              <span>VIDEOS</span>
              <strong>{videoStats.total}</strong>
            </div>
            <div>
              <span>ACTIVE</span>
              <strong>{videoStats.active}</strong>
            </div>
            <div>
              <span>STORAGE</span>
              <strong>{formatBytes(videoStats.totalBytes)}</strong>
            </div>
          </div>

          {(videoUploading || (videoBusyId && videoUploadPercent > 0)) ? (
            <div className="tr-motivationUploadProgress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={videoUploadPercent}>
              <div className="tr-motivationUploadProgressTop">
                <span>{videoUploading ? "UPLOADING VIDEO" : "REPLACING VIDEO"}</span>
                <strong>{Math.round(videoUploadPercent)}%</strong>
              </div>
              <div className="tr-motivationUploadTrack">
                <span style={{ width: `${Math.max(2, videoUploadPercent)}%` }} />
              </div>
            </div>
          ) : null}

          {videoNotice ? (
            <div className={`tr-soundAlertsNotice is-${videoNotice.tone}`} role="status">
              {videoNotice.text}
            </div>
          ) : null}

          {videoLoading ? (
            <div className="tr-rowbox">Loading motivation videos…</div>
          ) : motivationVideos.length ? (
            <div className="tr-motivationVideoGrid">
              {motivationVideos.map((video, index) => {
                const busy = videoBusyId === video.id;

                return (
                  <article key={video.id} className={`tr-motivationVideoCard ${video.is_active ? "is-active" : "is-disabled"}`}>
                    <button
                      type="button"
                      className="tr-motivationPreviewStage"
                      onClick={() => setPreviewVideo(video)}
                      aria-label={`Preview ${video.file_name}`}
                    >
                      <video
                        src={video.public_url}
                        muted
                        playsInline
                        preload="metadata"
                      />
                      <span className="tr-motivationPreviewShade" />
                      <span className="tr-motivationPreviewPlay">▶</span>
                      <span className="tr-motivationVideoNumber">VIDEO {String(index + 1).padStart(2, "0")}</span>
                      <span className={`tr-motivationVideoStatus ${video.is_active ? "is-on" : "is-off"}`}>
                        {video.is_active ? "ACTIVE" : "DISABLED"}
                      </span>
                    </button>

                    <div className="tr-motivationVideoBody">
                      <div className="tr-motivationVideoName">{video.file_name}</div>

                      <div className="tr-motivationVideoMeta">
                        <span>{video.orientation?.toUpperCase() || "VIDEO"}</span>
                        <span>{videoResolution(video)}</span>
                        <span>{formatDuration(video.duration_seconds)}</span>
                        <span>{formatBytes(video.size_bytes)}</span>
                      </div>

                      <div className="tr-motivationVideoActions">
                        <button
                          type="button"
                          className="tr-btn"
                          disabled={videoBusyId !== null || videoUploading}
                          onClick={() => setPreviewVideo(video)}
                        >
                          PREVIEW
                        </button>

                        <button
                          type="button"
                          className={`tr-btn ${video.is_active ? "tr-motivationDisable" : "tr-btn--primary"}`}
                          disabled={videoBusyId !== null || videoUploading}
                          onClick={() => void handleVideoToggle(video)}
                        >
                          {busy ? "WORKING…" : video.is_active ? "DISABLE" : "ENABLE"}
                        </button>

                        <button
                          type="button"
                          className="tr-btn"
                          disabled={videoBusyId !== null || videoUploading}
                          onClick={() => {
                            replaceTargetRef.current = video;
                            replaceInputRef.current?.click();
                          }}
                        >
                          REPLACE
                        </button>

                        <button
                          type="button"
                          className="tr-btn tr-motivationDelete"
                          disabled={videoBusyId !== null || videoUploading}
                          onClick={() => void handleVideoRemove(video)}
                        >
                          DELETE
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="tr-motivationEmpty">
              <div className="tr-motivationEmptyIcon" aria-hidden>▶</div>
              <strong>NO MOTIVATION VIDEOS YET</strong>
              <span>Upload your first MP4 to build the pre-workout launch rotation.</span>
              <button
                type="button"
                className="tr-btn tr-btn--primary"
                onClick={() => videoInputRef.current?.click()}
              >
                + UPLOAD FIRST VIDEO
              </button>
            </div>
          )}
        </section>
      </Card>

      {previewVideo ? (
        <div
          className="tr-motivationPreviewOverlay"
          role="presentation"
          onClick={() => setPreviewVideo(null)}
        >
          <div
            className="tr-motivationPreviewDialog"
            role="dialog"
            aria-modal="true"
            aria-label={`Preview ${previewVideo.file_name}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="tr-motivationPreviewDialogHead">
              <div>
                <div className="tr-kicker">MOTIVATION VIDEO PREVIEW</div>
                <strong>{previewVideo.file_name}</strong>
              </div>
              <button type="button" className="tr-btn" onClick={() => setPreviewVideo(null)}>
                CLOSE ×
              </button>
            </div>

            <div className={`tr-motivationPreviewDialogStage is-${previewVideo.orientation || "landscape"}`}>
              <video
                src={previewVideo.public_url}
                autoPlay
                loop
                muted
                playsInline
                controls
                preload="auto"
              />
            </div>

            <div className="tr-motivationPreviewDialogMeta">
              <span>{previewVideo.orientation?.toUpperCase() || "VIDEO"}</span>
              <span>{videoResolution(previewVideo)}</span>
              <span>{formatDuration(previewVideo.duration_seconds)}</span>
              <span>{formatBytes(previewVideo.size_bytes)}</span>
            </div>
          </div>
        </div>
      ) : null}

      <style>{`
        .tr-motivationManager{
          margin-top:24px;
          padding-top:24px;
          border-top:1px solid rgba(255,255,255,.10);
          display:grid;
          gap:16px;
        }
        .tr-motivationHeader{
          display:flex;
          align-items:flex-end;
          justify-content:space-between;
          gap:20px;
          padding:18px;
          border:1px solid rgba(55,202,255,.22);
          border-radius:20px;
          background:
            radial-gradient(700px 220px at 0 0, rgba(0,174,255,.11), transparent 68%),
            linear-gradient(180deg, rgba(14,22,31,.98), rgba(5,9,14,.99));
          box-shadow:inset 0 1px 0 rgba(255,255,255,.05), 0 20px 54px rgba(0,0,0,.28);
        }
        .tr-motivationHeader > div:first-child{
          min-width:0;
          display:grid;
          gap:7px;
        }
        .tr-motivationTitle{
          color:#fff;
          font-size:clamp(24px,3vw,34px);
          line-height:1;
          font-weight:1100;
          letter-spacing:-.02em;
        }
        .tr-motivationUploadButton{ min-width:190px; height:50px; }
        .tr-motivationStats{
          display:grid;
          grid-template-columns:repeat(3,minmax(0,1fr));
          gap:10px;
        }
        .tr-motivationStats > div{
          min-width:0;
          min-height:82px;
          padding:13px 14px;
          display:grid;
          align-content:center;
          gap:5px;
          border:1px solid rgba(255,255,255,.09);
          border-radius:16px;
          background:linear-gradient(180deg, rgba(255,255,255,.045), rgba(0,0,0,.14));
          box-shadow:inset 0 1px 0 rgba(255,255,255,.04);
          text-align:center;
        }
        .tr-motivationStats span{
          color:rgba(175,202,218,.62);
          font-size:8px;
          font-weight:1000;
          letter-spacing:.17em;
        }
        .tr-motivationStats strong{
          color:#fff;
          font-size:24px;
          font-weight:1100;
          font-variant-numeric:tabular-nums;
        }
        .tr-motivationUploadProgress{
          padding:13px 15px;
          border:1px solid rgba(0,190,255,.28);
          border-radius:15px;
          background:rgba(0,174,255,.065);
          display:grid;
          gap:9px;
        }
        .tr-motivationUploadProgressTop{
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:10px;
          color:#a9e9ff;
          font-size:9px;
          font-weight:1000;
          letter-spacing:.14em;
        }
        .tr-motivationUploadTrack{
          height:7px;
          overflow:hidden;
          border-radius:999px;
          background:rgba(255,255,255,.08);
          box-shadow:inset 0 2px 5px rgba(0,0,0,.55);
        }
        .tr-motivationUploadTrack span{
          display:block;
          height:100%;
          border-radius:inherit;
          background:linear-gradient(90deg,#00aef6,#77e4ff);
          box-shadow:0 0 16px rgba(0,190,255,.28);
          transition:width .18s ease;
        }
        .tr-motivationVideoGrid{
          display:grid;
          grid-template-columns:repeat(2,minmax(0,1fr));
          gap:14px;
        }
        .tr-motivationVideoCard{
          overflow:hidden;
          border:1px solid rgba(48,204,255,.25);
          border-radius:19px;
          background:
            radial-gradient(480px 180px at 0 0, rgba(0,174,255,.08), transparent 66%),
            linear-gradient(180deg, rgba(12,18,26,.99), rgba(4,7,11,.995));
          box-shadow:inset 0 1px 0 rgba(255,255,255,.05),0 20px 48px rgba(0,0,0,.28);
        }
        .tr-motivationVideoCard.is-disabled{
          border-color:rgba(255,255,255,.10);
          filter:saturate(.55);
        }
        .tr-motivationPreviewStage{
          position:relative;
          width:100%;
          height:230px;
          display:block;
          overflow:hidden;
          border:0;
          padding:0;
          background:#05080c;
          cursor:pointer;
        }
        .tr-motivationPreviewStage video{
          width:100%;
          height:100%;
          object-fit:cover;
          display:block;
        }
        .tr-motivationVideoCard.is-disabled .tr-motivationPreviewStage video{
          opacity:.48;
        }
        .tr-motivationPreviewShade{
          position:absolute;
          inset:0;
          background:
            linear-gradient(180deg, rgba(0,0,0,.05), rgba(0,0,0,.08) 50%, rgba(0,0,0,.72)),
            radial-gradient(circle at 50% 45%, transparent 0 28%, rgba(0,0,0,.24) 78%);
          pointer-events:none;
        }
        .tr-motivationPreviewPlay{
          position:absolute;
          left:50%;
          top:50%;
          transform:translate(-50%,-50%);
          width:54px;
          height:54px;
          display:grid;
          place-items:center;
          border:1px solid rgba(180,238,255,.5);
          border-radius:999px;
          color:#d9f7ff;
          background:rgba(2,11,17,.6);
          box-shadow:0 0 28px rgba(0,174,255,.20), inset 0 1px 0 rgba(255,255,255,.09);
          backdrop-filter:blur(8px);
          font-size:18px;
        }
        .tr-motivationVideoNumber{
          position:absolute;
          left:12px;
          bottom:11px;
          color:rgba(225,244,252,.78);
          font-size:8px;
          font-weight:1000;
          letter-spacing:.16em;
        }
        .tr-motivationVideoStatus{
          position:absolute;
          right:11px;
          top:11px;
          padding:6px 9px;
          border-radius:999px;
          font-size:7px;
          font-weight:1100;
          letter-spacing:.14em;
          backdrop-filter:blur(8px);
        }
        .tr-motivationVideoStatus.is-on{
          border:1px solid rgba(65,228,125,.48);
          color:#84efa6;
          background:rgba(25,145,70,.22);
        }
        .tr-motivationVideoStatus.is-off{
          border:1px solid rgba(255,255,255,.14);
          color:rgba(220,226,231,.68);
          background:rgba(0,0,0,.42);
        }
        .tr-motivationVideoBody{
          padding:14px;
          display:grid;
          gap:11px;
        }
        .tr-motivationVideoName{
          min-width:0;
          overflow:hidden;
          text-overflow:ellipsis;
          white-space:nowrap;
          color:#fff;
          font-size:14px;
          font-weight:1000;
        }
        .tr-motivationVideoMeta{
          display:flex;
          flex-wrap:wrap;
          gap:6px;
        }
        .tr-motivationVideoMeta span,
        .tr-motivationPreviewDialogMeta span{
          padding:5px 8px;
          border:1px solid rgba(255,255,255,.09);
          border-radius:999px;
          color:rgba(208,224,234,.68);
          background:rgba(255,255,255,.035);
          font-size:8px;
          font-weight:900;
          letter-spacing:.06em;
        }
        .tr-motivationVideoActions{
          display:grid;
          grid-template-columns:repeat(4,minmax(0,1fr));
          gap:7px;
        }
        .tr-motivationVideoActions .tr-btn{
          min-width:0;
          height:39px;
          padding:0 8px;
          font-size:8px;
          letter-spacing:.08em;
        }
        .tr-motivationDisable{
          border-color:rgba(255,175,56,.34)!important;
          color:#ffd08a!important;
        }
        .tr-motivationDelete{
          border-color:rgba(255,86,86,.28)!important;
          color:#ff9c9c!important;
        }
        .tr-motivationEmpty{
          min-height:220px;
          display:grid;
          place-items:center;
          align-content:center;
          gap:9px;
          padding:28px;
          border:1px dashed rgba(70,202,255,.24);
          border-radius:19px;
          background:rgba(0,174,255,.035);
          text-align:center;
        }
        .tr-motivationEmptyIcon{
          width:54px;
          height:54px;
          display:grid;
          place-items:center;
          border:1px solid rgba(72,213,255,.38);
          border-radius:999px;
          color:#bdeeff;
          background:rgba(0,174,255,.08);
          font-size:18px;
        }
        .tr-motivationEmpty strong{ color:#fff; font-size:16px; }
        .tr-motivationEmpty span{ color:rgba(210,226,236,.65); font-size:12px; }
        .tr-motivationEmpty .tr-btn{ margin-top:5px; }
        .tr-motivationPreviewOverlay{
          position:fixed;
          inset:0;
          z-index:20000;
          padding:18px;
          display:grid;
          place-items:center;
          background:rgba(0,0,0,.84);
          backdrop-filter:blur(16px);
        }
        .tr-motivationPreviewDialog{
          width:min(980px,100%);
          max-height:calc(100dvh - 36px);
          overflow:auto;
          padding:17px;
          display:grid;
          gap:14px;
          border:1px solid rgba(70,213,255,.38);
          border-radius:24px;
          background:
            radial-gradient(760px 280px at 50% 0,rgba(0,174,255,.12),transparent 70%),
            linear-gradient(180deg,rgba(10,17,25,.99),rgba(3,6,10,.995));
          box-shadow:0 30px 110px rgba(0,0,0,.72),0 0 40px rgba(0,174,255,.10);
        }
        .tr-motivationPreviewDialogHead{
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:14px;
        }
        .tr-motivationPreviewDialogHead > div{
          min-width:0;
          display:grid;
          gap:5px;
        }
        .tr-motivationPreviewDialogHead strong{
          min-width:0;
          overflow:hidden;
          text-overflow:ellipsis;
          white-space:nowrap;
          color:#fff;
          font-size:16px;
        }
        .tr-motivationPreviewDialogStage{
          height:min(65dvh,620px);
          display:grid;
          place-items:center;
          overflow:hidden;
          border:1px solid rgba(255,255,255,.09);
          border-radius:18px;
          background:#020406;
        }
        .tr-motivationPreviewDialogStage video{
          width:100%;
          height:100%;
          display:block;
          object-fit:contain;
        }
        .tr-motivationPreviewDialogStage.is-portrait video{ width:auto; max-width:100%; }
        .tr-motivationPreviewDialogMeta{
          display:flex;
          flex-wrap:wrap;
          gap:7px;
        }
        @media(max-width:820px){
          .tr-motivationHeader{
            align-items:stretch;
            flex-direction:column;
          }
          .tr-motivationUploadButton{ width:100%; min-width:0; }
          .tr-motivationVideoGrid{ grid-template-columns:1fr; }
          .tr-motivationPreviewStage{ height:260px; }
        }
        @media(max-width:560px){
          .tr-motivationStats{ gap:7px; }
          .tr-motivationStats > div{ min-height:70px; padding:10px 8px; }
          .tr-motivationStats strong{ font-size:18px; }
          .tr-motivationVideoActions{ grid-template-columns:repeat(2,minmax(0,1fr)); }
          .tr-motivationPreviewStage{ height:230px; }
          .tr-motivationPreviewOverlay{ padding:8px; }
          .tr-motivationPreviewDialog{
            max-height:calc(100dvh - 16px);
            padding:11px;
            border-radius:18px;
          }
          .tr-motivationPreviewDialogHead{
            align-items:flex-start;
          }
          .tr-motivationPreviewDialogStage{
            height:min(68dvh,560px);
            border-radius:14px;
          }
        }
      `}</style>
    </div>
  );
}
