import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { Card } from "../../ui/Card";
import { Button } from "../../ui/Button";

type UserMediaRow = {
  id: string;
  user_id: string;
  exercise_id: string;
  kind: "gif" | "video" | "poster";
  storage_path: string;
  use_user_upload: boolean;
  license: string | null;
  attribution: string | null;
  updated_at: string;
};


type ExerciseHistorySet = {
  set_index: number;
  reps: number;
  weight: number;
  rir: number | null;
  pain: number | null;
  form: number | null;
};

type ExerciseHistorySession = {
  workoutId: string;
  workoutExerciseId: string;
  completedAt: string;
  templateName: string;
  pain: number | null;
  difficulty: string | null;
  sets: ExerciseHistorySet[];
  volume: number;
  estimated1RM: number;
};

function chunkValues<T>(values: T[], size = 75): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function estimatedOneRepMax(weight: number, reps: number) {
  if (!(weight > 0) || !(reps > 0)) return 0;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

function formatNumber(value: number, digits = 0) {
  if (!Number.isFinite(value)) return "0";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatWeight(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatHistoryDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function difficultyLabel(value: string | null) {
  if (value === "too_easy") return "Too easy";
  if (value === "just_right") return "Just right";
  if (value === "too_hard") return "Too hard";
  return "Not rated";
}

async function loadExerciseHistory(exerciseId: string, userId: string): Promise<ExerciseHistorySession[]> {
  const { data: exerciseRows, error: exerciseErr } = await supabase
    .from("workout_exercises")
    .select("id,workout_id,pain,difficulty,prescription_snapshot")
    .eq("exercise_id", exerciseId)
    .limit(250);

  if (exerciseErr) throw exerciseErr;
  const rows = (exerciseRows ?? []) as any[];
  if (!rows.length) return [];

  const workoutIds = Array.from(new Set(rows.map((row) => row.workout_id).filter(Boolean)));
  const workouts: any[] = [];
  for (const chunk of chunkValues(workoutIds)) {
    const { data, error } = await supabase
      .from("workouts")
      .select("id,completed_at,workout_summary")
      .eq("user_id", userId)
      .in("id", chunk)
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false });
    if (error) throw error;
    workouts.push(...(data ?? []));
  }

  const workoutMap = new Map(workouts.map((row: any) => [row.id, row]));
  const completeRows = rows.filter((row) => workoutMap.has(row.workout_id));
  if (!completeRows.length) return [];

  const workoutExerciseIds = completeRows.map((row) => row.id);
  const setRows: any[] = [];
  for (const chunk of chunkValues(workoutExerciseIds)) {
    const { data, error } = await supabase
      .from("workout_sets")
      .select("workout_exercise_id,set_index,reps,weight,rir,pain,form")
      .in("workout_exercise_id", chunk)
      .order("set_index", { ascending: true });
    if (error) throw error;
    setRows.push(...(data ?? []));
  }

  const setsByExercise = new Map<string, ExerciseHistorySet[]>();
  for (const row of setRows) {
    const key = (row as any).workout_exercise_id as string;
    const list = setsByExercise.get(key) ?? [];
    list.push({
      set_index: Number((row as any).set_index ?? 0),
      reps: Number((row as any).reps ?? 0),
      weight: Number((row as any).weight ?? 0),
      rir: (row as any).rir != null ? Number((row as any).rir) : null,
      pain: (row as any).pain != null ? Number((row as any).pain) : null,
      form: (row as any).form != null ? Number((row as any).form) : null,
    });
    setsByExercise.set(key, list);
  }

  return completeRows
    .map((row) => {
      const workout = workoutMap.get(row.workout_id) as any;
      const sets = (setsByExercise.get(row.id) ?? [])
        .filter((set) => set.set_index > 0)
        .sort((a, b) => a.set_index - b.set_index);
      const volume = sets.reduce(
        (sum, set) => sum + Math.max(0, set.reps) * Math.max(0, set.weight),
        0
      );
      const bestE1RM = sets.reduce(
        (best, set) => Math.max(best, estimatedOneRepMax(set.weight, set.reps)),
        0
      );
      const summary = workout?.workout_summary as any;

      return {
        workoutId: row.workout_id,
        workoutExerciseId: row.id,
        completedAt: workout?.completed_at,
        templateName:
          typeof summary?.template_name === "string" && summary.template_name.trim()
            ? summary.template_name.trim()
            : "Workout",
        pain: row.pain != null ? Number(row.pain) : null,
        difficulty: row.difficulty ?? null,
        sets,
        volume,
        estimated1RM: bestE1RM,
      } as ExerciseHistorySession;
    })
    .filter((row) => !!row.completedAt)
    .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
}

function StrengthTrendChart({ sessions }: { sessions: ExerciseHistorySession[] }) {
  const points = sessions
    .filter((session) => session.estimated1RM > 0)
    .slice()
    .sort((a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime())
    .slice(-16);

  if (points.length < 2) {
    return <div className="tr-sub">Complete at least two strength sessions to unlock the trend chart.</div>;
  }

  const width = 760;
  const height = 220;
  const padX = 42;
  const padY = 24;
  const values = points.map((point) => point.estimated1RM);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(1, max - min);

  const coordinates = points.map((point, index) => {
    const x = padX + (index / Math.max(1, points.length - 1)) * (width - padX * 2);
    const y = height - padY - ((point.estimated1RM - min) / spread) * (height - padY * 2);
    return { x, y, point };
  });

  const path = coordinates.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");

  return (
    <div className="tr-exHistoryChartWrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Estimated strength trend">
        <defs>
          <linearGradient id="trHistoryArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(82,223,255,.34)" />
            <stop offset="100%" stopColor="rgba(82,223,255,0)" />
          </linearGradient>
        </defs>
        <line x1={padX} y1={height - padY} x2={width - padX} y2={height - padY} className="tr-exHistoryAxis" />
        <path
          d={`${path} L ${coordinates[coordinates.length - 1].x} ${height - padY} L ${coordinates[0].x} ${height - padY} Z`}
          fill="url(#trHistoryArea)"
        />
        <path d={path} className="tr-exHistoryLine" />
        {coordinates.map(({ x, y, point }) => (
          <g key={`${point.workoutExerciseId}-${point.completedAt}`}>
            <circle cx={x} cy={y} r="5" className="tr-exHistoryDot" />
            <title>{`${formatHistoryDate(point.completedAt)}: ${formatNumber(point.estimated1RM, 1)} lb estimated 1RM`}</title>
          </g>
        ))}
        <text x={padX} y={16} className="tr-exHistoryChartLabel">{formatNumber(max, 1)} lb</text>
        <text x={padX} y={height - 5} className="tr-exHistoryChartLabel">{formatNumber(min, 1)} lb</text>
      </svg>
    </div>
  );
}

function isNonEmptyString(x: any) {
  return typeof x === "string" && x.trim().length > 0;
}

function isMediaUsable(media: any) {
  if (!media || typeof media !== "object") return false;
  const gif = media?.gif;
  const video = media?.video;
  const poster = media?.poster;
  const image = media?.image;
  let images0: any = null;
  if (Array.isArray(media?.images) && media.images.length > 0) {
    const first = media.images[0];
    images0 = typeof first === "string" ? first : first?.url || first?.image || first?.src || null;
  }
  return (
    isNonEmptyString(gif) ||
    isNonEmptyString(video) ||
    isNonEmptyString(poster) ||
    isNonEmptyString(image) ||
    isNonEmptyString(images0)
  );
}

async function signedUrlFromPath(path: string, expiresInSeconds = 60 * 30) {
  const { data, error } = await supabase.storage
    .from("exercise-media")
    .createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

function resolveBuiltMedia(ex: any): { gif?: string; video?: string; poster?: string } {
  const m = ex?.media ?? null;
  if (!m || typeof m !== "object") return {};

  const gif = (m.gif as string | undefined) ?? undefined;
  const video = (m.video as string | undefined) ?? undefined;

  let poster =
    (m.poster as string | undefined) ??
    (m.image as string | undefined) ??
    undefined;

  if (!poster && Array.isArray(m.images) && m.images.length > 0) {
    const first = m.images[0];
    if (typeof first === "string") poster = first;
    else if (first && typeof first === "object") {
      poster =
        (first.url as string | undefined) ||
        (first.image as string | undefined) ||
        (first.src as string | undefined);
    }
  }

  return { gif, video, poster };
}

function MediaStage({ ex, userMedia }: { ex: any; userMedia: UserMediaRow[] }) {
  const built = useMemo(() => resolveBuiltMedia(ex), [ex]);

  const anyUserEnabled = useMemo(
    () => userMedia.some((m) => m.use_user_upload),
    [userMedia]
  );

  const resolved = useMemo(() => {
    if (anyUserEnabled) {
      const byKind = new Map<string, UserMediaRow>();
      for (const m of userMedia) byKind.set(m.kind, m);

      return {
        source: "user_upload" as const,
        gifPath: byKind.get("gif")?.storage_path,
        videoPath: byKind.get("video")?.storage_path,
        posterPath: byKind.get("poster")?.storage_path,
      };
    }

    return { source: "built" as const, ...built };
  }, [anyUserEnabled, userMedia, built]);

  const [gifUrl, setGifUrl] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [posterUrl, setPosterUrl] = useState<string | null>(null);

  const [err, setErr] = useState<string | null>(null);
  const [loadFail, setLoadFail] = useState<string | null>(null);

  const resolvedType = useMemo(() => {
    if (resolved.source === "user_upload") {
      if (resolved.videoPath) return "video";
      if (resolved.gifPath) return "gif";
      if (resolved.posterPath) return "poster";
      return "none";
    }
    if ((resolved as any).video) return "video";
    if ((resolved as any).gif) return "gif";
    if ((resolved as any).poster) return "poster";
    return "none";
  }, [resolved]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        setErr(null);
        setLoadFail(null);
        setGifUrl(null);
        setVideoUrl(null);
        setPosterUrl(null);

        if (resolved.source === "user_upload") {
          if (resolved.videoPath) {
            const url = await signedUrlFromPath(resolved.videoPath);
            if (!cancelled) setVideoUrl(url);
          }
          if (resolved.gifPath) {
            const url = await signedUrlFromPath(resolved.gifPath);
            if (!cancelled) setGifUrl(url);
          }
          if (resolved.posterPath) {
            const url = await signedUrlFromPath(resolved.posterPath);
            if (!cancelled) setPosterUrl(url);
          }

          if (!resolved.videoPath && !resolved.gifPath && !resolved.posterPath) {
            if (!cancelled) {
              setLoadFail(
                "Your upload is enabled, but no uploaded media files are present for this exercise."
              );
            }
          }
        } else {
          if (!cancelled) {
            setVideoUrl((resolved as any).video ?? null);
            setGifUrl((resolved as any).gif ?? null);
            setPosterUrl((resolved as any).poster ?? null);
          }
        }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? String(e));
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [resolved]);

  const statusLine = useMemo(() => {
    const src = resolved.source === "user_upload" ? "YOUR UPLOAD" : "BUILT-IN";
    if (err) return { tone: "err", text: `MEDIA ERROR: ${err}` };
    if (loadFail) return { tone: "err", text: loadFail };
    if (resolvedType === "none") {
      return { tone: "warn", text: "No media found for the currently selected source." };
    }
    return { tone: "ok", text: `Using ${src} • ${resolvedType.toUpperCase()}` };
  }, [resolved.source, resolvedType, err, loadFail]);

  const showSomething = !!(videoUrl || gifUrl || posterUrl);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div
        className="tr-rowbox"
        style={{
          borderColor:
            statusLine.tone === "ok"
              ? "rgba(34,197,94,.30)"
              : statusLine.tone === "warn"
              ? "rgba(245,158,11,.30)"
              : "rgba(255,80,80,.35)",
          background:
            statusLine.tone === "ok"
              ? "rgba(34,197,94,.08)"
              : statusLine.tone === "warn"
              ? "rgba(245,158,11,.08)"
              : "rgba(255,80,80,.10)",
          fontWeight: 900,
        }}
      >
        {statusLine.text}
      </div>

      <div className="tr-mediaFrame">
        {!showSomething ? (
          <div style={{ padding: 18, textAlign: "center" }}>
            <div style={{ fontWeight: 900 }}>No media yet</div>
            <div className="tr-sub" style={{ marginTop: 6 }}>
              Upload a GIF/video/poster below, or switch to built-in media if available.
            </div>
          </div>
        ) : videoUrl ? (
          <video
            src={videoUrl}
            autoPlay
            loop
            muted
            playsInline
            controls={false}
            preload="metadata"
            onError={() =>
              setLoadFail(
                "Video failed to load. The URL may be invalid or blocked. Try uploading your own file."
              )
            }
            style={{
              width: "100%",
              height: "auto",
              maxHeight: "52vh",
              objectFit: "contain",
              background: "rgba(0,0,0,.20)",
              display: "block",
              borderRadius: 12,
            }}
          />
        ) : (
          <img
            src={gifUrl || posterUrl || ""}
            alt={`${ex?.name ?? "Exercise"} demo`}
            onError={() =>
              setLoadFail(
                "Image/GIF failed to load. The URL may be invalid or blocked. Try uploading your own file."
              )
            }
            style={{
              width: "100%",
              height: "auto",
              maxHeight: "52vh",
              objectFit: "contain",
              background: "rgba(0,0,0,.20)",
              display: "block",
              borderRadius: 12,
            }}
            loading="lazy"
          />
        )}
      </div>
    </div>
  );
}

function UploadPill({
  kind,
  busy,
  onPick,
}: {
  kind: "gif" | "video" | "poster";
  busy: null | "gif" | "video" | "poster";
  onPick: (file: File) => void;
}) {
  const isBusy = busy === kind;
  const label =
    kind === "gif" ? "Upload GIF" : kind === "video" ? "Upload Video" : "Upload Poster";

  return (
    <label
      className={`tr-seg ${isBusy ? "is-active" : ""}`}
      style={{
        height: 44,
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        cursor: busy ? "not-allowed" : "pointer",
      }}
    >
      <span style={{ fontWeight: 900 }}>{isBusy ? "Uploading…" : label}</span>
      <input
        type="file"
        accept={
          kind === "video"
            ? "video/mp4,video/webm,video/quicktime"
            : kind === "gif"
            ? "image/gif"
            : "image/jpeg,image/png,image/webp"
        }
        disabled={!!busy}
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.currentTarget.value = "";
        }}
      />
    </label>
  );
}

export function ExerciseDetailPage({ params, navigate }: any) {
  const exerciseId = params?.exerciseId as string;

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [ex, setEx] = useState<any>(null);
  const [userMedia, setUserMedia] = useState<UserMediaRow[]>([]);
  const [busyUpload, setBusyUpload] = useState<null | "gif" | "video" | "poster">(null);
  const [history, setHistory] = useState<ExerciseHistorySession[]>([]);
  const [expandedSessions, setExpandedSessions] = useState<Record<string, boolean>>({});

  const builtHasUsable = useMemo(
    () => (ex ? isMediaUsable(ex.media) : false),
    [ex]
  );
  const anyUserEnabled = useMemo(
    () => userMedia.some((m) => m.use_user_upload),
    [userMedia]
  );

  const records = useMemo(() => {
    let bestWeight = 0;
    let bestReps = 0;
    let bestSetVolume = 0;
    let bestEstimated1RM = 0;
    let bestSessionVolume = 0;
    let totalSets = 0;

    for (const session of history) {
      bestSessionVolume = Math.max(bestSessionVolume, session.volume);
      for (const set of session.sets) {
        if (!(set.reps > 0) || !(set.weight > 0)) continue;
        totalSets += 1;
        bestWeight = Math.max(bestWeight, set.weight);
        bestReps = Math.max(bestReps, set.reps);
        bestSetVolume = Math.max(bestSetVolume, set.reps * set.weight);
        bestEstimated1RM = Math.max(bestEstimated1RM, estimatedOneRepMax(set.weight, set.reps));
      }
    }

    const chronological = history
      .filter((session) => session.estimated1RM > 0)
      .slice()
      .sort((a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime());
    const firstStrength = chronological[0]?.estimated1RM ?? 0;
    const latestStrength = chronological[chronological.length - 1]?.estimated1RM ?? 0;
    const strengthChangePct = firstStrength > 0
      ? ((latestStrength - firstStrength) / firstStrength) * 100
      : null;

    return {
      sessions: history.length,
      totalSets,
      bestWeight,
      bestReps,
      bestSetVolume,
      bestEstimated1RM,
      bestSessionVolume,
      strengthChangePct,
    };
  }, [history]);

  async function loadAll() {
    setLoading(true);
    setErr(null);
    setEx(null);
    setUserMedia([]);
    setHistory([]);

    try {
      const { data: u, error: uErr } = await supabase.auth.getUser();
      if (uErr) throw uErr;
      if (!u.user) throw new Error("Sign in to view exercise detail.");

      const { data: exData, error: exErr } = await supabase
        .from("exercises")
        .select("*")
        .eq("id", exerciseId)
        .single();
      if (exErr) throw exErr;

      const { data: um, error: umErr } = await supabase
        .from("exercise_user_media")
        .select(
          "id,user_id,exercise_id,kind,storage_path,use_user_upload,license,attribution,updated_at"
        )
        .eq("user_id", u.user.id)
        .eq("exercise_id", exerciseId)
        .order("updated_at", { ascending: false });

      if (umErr) throw umErr;

      const historyRows = await loadExerciseHistory(exerciseId, u.user.id);

      setEx(exData);
      setUserMedia((um ?? []) as UserMediaRow[]);
      setHistory(historyRows);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, [exerciseId]);

  async function toggleUseUserUpload(next: boolean) {
    const { data: u, error: uErr } = await supabase.auth.getUser();
    if (uErr) {
      alert(uErr.message);
      return;
    }
    if (!u.user) return;

    if (!userMedia.length) {
      alert("Upload a file first, then enable it.");
      return;
    }

    const { error } = await supabase
      .from("exercise_user_media")
      .update({ use_user_upload: next })
      .eq("user_id", u.user.id)
      .eq("exercise_id", exerciseId);

    if (error) {
      alert(error.message);
      return;
    }
    await loadAll();
  }

  async function onPickFile(kind: "gif" | "video" | "poster", file: File) {
    setBusyUpload(kind);
    try {
      const { data: u, error: uErr } = await supabase.auth.getUser();
      if (uErr) throw uErr;
      if (!u.user) throw new Error("Sign in first.");

      const ext = (file.name.split(".").pop() || "bin").toLowerCase();
      const safeName = `${Date.now()}-${kind}.${ext}`;
      const storage_path = `${u.user.id}/${exerciseId}/${safeName}`;

      const up = await supabase.storage.from("exercise-media").upload(storage_path, file, {
        upsert: true,
        contentType: file.type || undefined,
      });
      if (up.error) throw up.error;

      const enableByDefault = builtHasUsable ? false : true;

      const rpc = await supabase.rpc("rpc_exercise_user_media_upsert", {
        p_exercise_id: exerciseId,
        p_kind: kind,
        p_storage_path: storage_path,
        p_mime: file.type || "",
        p_use_user_upload: enableByDefault,
        p_license: null,
        p_attribution: null,
      });

      if (rpc.error) throw rpc.error;

      await loadAll();
    } catch (e: any) {
      console.error("UPLOAD FAIL:", e);
      alert(e?.message ?? JSON.stringify(e));
    } finally {
      setBusyUpload(null);
    }
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Card
        title="Exercise Detail"
        tone="blue"
        right={<span className="tr-kicker">MEDIA</span>}
      >
        {loading ? (
          <div className="tr-sub">Loading…</div>
        ) : err ? (
          <div
            className="tr-rowbox"
            style={{
              borderColor: "rgba(255,80,80,.35)",
              background: "rgba(255,80,80,.10)",
              fontWeight: 900,
            }}
          >
            {err}
          </div>
        ) : ex ? (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div className="tr-kicker">EXERCISE</div>
              <div style={{ fontWeight: 950, fontSize: 18 }}>{ex.name}</div>
              <div className="tr-sub">
                {(Array.isArray(ex.primary_muscles) && ex.primary_muscles.length
                  ? ex.primary_muscles.join(", ")
                  : "—")}{" "}
                •{" "}
                {(Array.isArray(ex.equipment) && ex.equipment.length
                  ? ex.equipment.join(", ")
                  : "—")}{" "}
                • {ex.source ?? "—"}
              </div>
            </div>

            <MediaStage ex={ex} userMedia={userMedia} />

            <div
              className="tr-row"
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "grid", gap: 4 }}>
                <div className="tr-kicker"></div>
                <div style={{ fontWeight: 950 }}>
                  {anyUserEnabled
                    ? ""
                    : builtHasUsable
                    ? "Using built-in media"
                    : "Missing media"}
                </div>
                <div className="tr-sub">
                  {builtHasUsable ? `Built-in source: ${ex.media?.source ?? "source"}` : ""}
                </div>
              </div>

              {userMedia.length ? (
                <Button
                  variant="secondary"
                  onClick={() => toggleUseUserUpload(!anyUserEnabled)}
                >
                  {anyUserEnabled ? "Use built-in media" : "Use my upload"}
                </Button>
              ) : null}
            </div>

            <div className="tr-row" style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gap: 4 }}>
                <div className="tr-kicker"></div>
                <div className="tr-sub"></div>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <UploadPill
                  kind="gif"
                  busy={busyUpload}
                  onPick={(f) => onPickFile("gif", f)}
                />
                <UploadPill
                  kind="video"
                  busy={busyUpload}
                  onPick={(f) => onPickFile("video", f)}
                />
                <UploadPill
                  kind="poster"
                  busy={busyUpload}
                  onPick={(f) => onPickFile("poster", f)}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="tr-sub">Not found.</div>
        )}
      </Card>

      <Card
        title="Performance Intelligence"
        tone="blue"
        right={<span className="tr-kicker">{history.length} COMPLETED SESSIONS</span>}
      >
        {loading ? (
          <div className="tr-sub">Loading performance history…</div>
        ) : err ? null : history.length ? (
          <div className="tr-exHistoryOverview">
            <div className="tr-exHistoryKpis">
              <div className="tr-exHistoryKpi">
                <span>Best Weight</span>
                <strong>{formatWeight(records.bestWeight)} lb</strong>
              </div>
              <div className="tr-exHistoryKpi">
                <span>Best Estimated 1RM</span>
                <strong>{formatNumber(records.bestEstimated1RM, 1)} lb</strong>
              </div>
              <div className="tr-exHistoryKpi">
                <span>Best Set Volume</span>
                <strong>{formatNumber(records.bestSetVolume)} lb</strong>
              </div>
              <div className="tr-exHistoryKpi">
                <span>Best Session Volume</span>
                <strong>{formatNumber(records.bestSessionVolume)} lb</strong>
              </div>
              <div className="tr-exHistoryKpi">
                <span>Most Reps</span>
                <strong>{records.bestReps}</strong>
              </div>
              <div className="tr-exHistoryKpi">
                <span>Strength Trend</span>
                <strong>
                  {records.strengthChangePct == null
                    ? "—"
                    : `${records.strengthChangePct >= 0 ? "+" : ""}${formatNumber(records.strengthChangePct, 1)}%`}
                </strong>
              </div>
            </div>

            <div className="tr-exHistoryChartCard">
              <div className="tr-exHistorySectionHead">
                <div>
                  <div className="tr-kicker">ESTIMATED STRENGTH</div>
                  <div className="tr-exHistorySectionTitle">Performance trend</div>
                </div>
                <div className="tr-sub">Last 16 completed sessions</div>
              </div>
              <StrengthTrendChart sessions={history} />
            </div>
          </div>
        ) : (
          <div className="tr-rowbox">
            <div style={{ fontWeight: 950 }}>No completed history yet</div>
            <div className="tr-sub" style={{ marginTop: 6 }}>
              Complete this exercise in a workout to unlock records, trend charts, and set-by-set history.
            </div>
          </div>
        )}
      </Card>

      <Card title="Complete Exercise History" tone="base">
        {loading ? (
          <div className="tr-sub">Loading…</div>
        ) : history.length ? (
          <div className="tr-exHistoryList">
            {history.map((session, index) => {
              const expanded = !!expandedSessions[session.workoutExerciseId];
              const bestSet = session.sets.reduce<ExerciseHistorySet | null>((best, set) => {
                if (!best) return set;
                return set.weight * set.reps > best.weight * best.reps ? set : best;
              }, null);

              return (
                <div key={session.workoutExerciseId} className="tr-exHistorySession">
                  <button
                    type="button"
                    className="tr-exHistorySessionHead"
                    onClick={() =>
                      setExpandedSessions((current) => ({
                        ...current,
                        [session.workoutExerciseId]: !expanded,
                      }))
                    }
                  >
                    <div className="tr-exHistorySessionIndex">{String(index + 1).padStart(2, "0")}</div>
                    <div className="tr-exHistorySessionCopy">
                      <strong>{formatHistoryDate(session.completedAt)}</strong>
                      <span>{session.templateName}</span>
                    </div>
                    <div className="tr-exHistorySessionSummary">
                      <span>{session.sets.length} sets</span>
                      <span>{formatNumber(session.volume)} lb volume</span>
                      <span>{bestSet ? `${formatWeight(bestSet.weight)} lb × ${bestSet.reps}` : "No set data"}</span>
                    </div>
                    <div className="tr-exHistoryExpand">{expanded ? "−" : "+"}</div>
                  </button>

                  {expanded ? (
                    <div className="tr-exHistorySessionBody">
                      <div className="tr-exHistoryMetaGrid">
                        <div><span>Pain</span><strong>{session.pain == null ? "—" : `${session.pain}/10`}</strong></div>
                        <div><span>Difficulty</span><strong>{difficultyLabel(session.difficulty)}</strong></div>
                        <div><span>Estimated 1RM</span><strong>{formatNumber(session.estimated1RM, 1)} lb</strong></div>
                        <div><span>Session Volume</span><strong>{formatNumber(session.volume)} lb</strong></div>
                      </div>

                      <div className="tr-exHistorySets">
                        {session.sets.map((set) => (
                          <div key={`${session.workoutExerciseId}-${set.set_index}`} className="tr-exHistorySet">
                            <span>SET {set.set_index}</span>
                            <strong>{formatWeight(set.weight)} lb × {set.reps}</strong>
                            <small>
                              {set.rir != null ? `RIR ${set.rir}` : "RIR —"}
                              {set.pain != null ? ` • Pain ${set.pain}/10` : ""}
                              {set.form != null ? ` • Form ${set.form}` : ""}
                            </small>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="tr-sub">No completed performances for this exercise.</div>
        )}
      </Card>

      <Card title="Actions" tone="base">
        <div style={{ display: "grid", gap: 10 }}>
          <Button onClick={() => navigate("/library")}>Back to Library</Button>
          <Button variant="secondary" onClick={() => navigate("/")}>
            Back to Workouts
          </Button>
        </div>
      </Card>
    </div>
  );
}
