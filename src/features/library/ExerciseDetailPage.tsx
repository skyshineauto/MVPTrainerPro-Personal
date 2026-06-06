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
  return isNonEmptyString(gif) || isNonEmptyString(video) || isNonEmptyString(poster) || isNonEmptyString(image) || isNonEmptyString(images0);
}

async function signedUrlFromPath(path: string, expiresInSeconds = 60 * 30) {
  const { data, error } = await supabase.storage.from("exercise-media").createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

function resolveBuiltMedia(ex: any): { gif?: string; video?: string; poster?: string } {
  const m = ex?.media ?? null;
  if (!m || typeof m !== "object") return {};

  const gif = (m.gif as string | undefined) ?? undefined;
  const video = (m.video as string | undefined) ?? undefined;

  let poster = (m.poster as string | undefined) ?? (m.image as string | undefined) ?? undefined;

  if (!poster && Array.isArray(m.images) && m.images.length > 0) {
    const first = m.images[0];
    if (typeof first === "string") poster = first;
    else if (first && typeof first === "object") {
      poster = (first.url as string | undefined) || (first.image as string | undefined) || (first.src as string | undefined);
    }
  }

  return { gif, video, poster };
}

function MediaStage({ ex, userMedia }: { ex: any; userMedia: UserMediaRow[] }) {
  const built = useMemo(() => resolveBuiltMedia(ex), [ex]);

  const anyUserEnabled = useMemo(() => userMedia.some((m) => m.use_user_upload), [userMedia]);

  // choose source:
  // if user enabled -> user upload (if available), else built
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
          if (resolved.videoPath) setVideoUrl(await signedUrlFromPath(resolved.videoPath));
          if (resolved.gifPath) setGifUrl(await signedUrlFromPath(resolved.gifPath));
          if (resolved.posterPath) setPosterUrl(await signedUrlFromPath(resolved.posterPath));

          // If user enabled but none present:
          if (!resolved.videoPath && !resolved.gifPath && !resolved.posterPath) {
            setLoadFail("Your upload is enabled, but no uploaded media files are present for this exercise.");
          }
        } else {
          setVideoUrl((resolved as any).video ?? null);
          setGifUrl((resolved as any).gif ?? null);
          setPosterUrl((resolved as any).poster ?? null);
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
    if (resolvedType === "none") return { tone: "warn", text: "No media found for the currently selected source." };
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
            onError={() => setLoadFail("Video failed to load. The URL may be invalid or blocked. Try uploading your own file.")}
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
            onError={() => setLoadFail("Image/GIF failed to load. The URL may be invalid or blocked. Try uploading your own file.")}
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
  const label = kind === "gif" ? "Upload GIF" : kind === "video" ? "Upload Video" : "Upload Poster";

  return (
    <label
      className={`tr-seg ${isBusy ? "is-active" : ""}`}
      style={{ height: 44, display: "inline-flex", alignItems: "center", gap: 8, cursor: busy ? "not-allowed" : "pointer" }}
    >
      <span style={{ fontWeight: 900 }}>{isBusy ? "Uploading…" : label}</span>
      <input
        type="file"
        accept={kind === "video" ? "video/mp4,video/webm,video/quicktime" : kind === "gif" ? "image/gif" : "image/jpeg,image/png,image/webp"}
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

  const builtHasUsable = useMemo(() => (ex ? isMediaUsable(ex.media) : false), [ex]);
  const anyUserEnabled = useMemo(() => userMedia.some((m) => m.use_user_upload), [userMedia]);

  async function loadAll() {
    setLoading(true);
    setErr(null);
    setEx(null);
    setUserMedia([]);

    try {
      const { data: u, error: uErr } = await supabase.auth.getUser();
      if (uErr) throw uErr;
      if (!u.user) throw new Error("Sign in to view exercise detail.");

      const { data: exData, error: exErr } = await supabase.from("exercises").select("*").eq("id", exerciseId).single();
      if (exErr) throw exErr;

      const { data: um, error: umErr } = await supabase
        .from("exercise_user_media")
        .select("id,user_id,exercise_id,kind,storage_path,use_user_upload,license,attribution,updated_at")
        .eq("user_id", u.user.id)
        .eq("exercise_id", exerciseId)
        .order("updated_at", { ascending: false });

      if (umErr) throw umErr;

      setEx(exData);
      setUserMedia((um ?? []) as any);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

    const { error } = await supabase.from("exercise_user_media").update({ use_user_upload: next }).eq("user_id", u.user.id).eq("exercise_id", exerciseId);

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

      // 1) Upload to storage
      const up = await supabase.storage.from("exercise-media").upload(storage_path, file, {
        upsert: true,
        contentType: file.type || undefined,
      });
      if (up.error) throw up.error;

      // 2) Insert/update exercise_user_media row
      // Enable by default if built-in media is missing usable assets; otherwise keep disabled until user toggles.
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
      <Card title="Exercise Detail" tone="blue" right={<span className="tr-kicker">MEDIA</span>}>
        {loading ? (
          <div className="tr-sub">Loading…</div>
        ) : err ? (
          <div className="tr-rowbox" style={{ borderColor: "rgba(255,80,80,.35)", background: "rgba(255,80,80,.10)", fontWeight: 900 }}>
            {err}
          </div>
        ) : ex ? (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div className="tr-kicker">EXERCISE</div>
              <div style={{ fontWeight: 950, fontSize: 18 }}>{ex.name}</div>
              <div className="tr-sub">
                {(Array.isArray(ex.primary_muscles) && ex.primary_muscles.length ? ex.primary_muscles.join(", ") : "—")} •{" "}
                {(Array.isArray(ex.equipment) && ex.equipment.length ? ex.equipment.join(", ") : "—")} • {ex.source ?? "—"}
              </div>
            </div>

            <MediaStage ex={ex} userMedia={userMedia} />

            <div className="tr-row" style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ display: "grid", gap: 4 }}>
                <div className="tr-kicker"></div>
                <div style={{ fontWeight: 950 }}>{anyUserEnabled ? "" : builtHasUsable ? "Using built-in media" : "Missing media"}</div>
                <div className="tr-sub">{builtHasUsable ? `Built-in source: ${ex.media?.source ?? "source"}` : ""}</div>
              </div>

              {userMedia.length ? (
                <Button variant="secondary" onClick={() => toggleUseUserUpload(!anyUserEnabled)}>
                  {anyUserEnabled ? "Use built-in media" : "Use my upload"}
                </Button>
              ) : null}
            </div>

            <div className="tr-row" style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gap: 4 }}>
                <div className="tr-kicker"></div>
                <div className="tr-sub">
                 
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <UploadPill kind="gif" busy={busyUpload} onPick={(f) => onPickFile("gif", f)} />
                <UploadPill kind="video" busy={busyUpload} onPick={(f) => onPickFile("video", f)} />
                <UploadPill kind="poster" busy={busyUpload} onPick={(f) => onPickFile("poster", f)} />
              </div>
            </div>
          </div>
        ) : (
          <div className="tr-sub">Not found.</div>
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
