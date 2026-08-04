import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "../../ui/Card";
import {
  listMusicTracks,
  removeMusicTrack,
  saveMusicTrackOrder,
  updateMusicTrack,
  uploadMusicTrack,
  type MusicTrack,
} from "../../lib/musicStorage";
import {
  loadMusicLibrary,
  playMusicTrack,
  replaceMusicLibrary,
  useMusicPlayer,
} from "../../lib/musicPlayer";

function formatFileSize(bytes: number | null) {
  if (!bytes) return "";
  const megabytes = bytes / (1024 * 1024);
  return `${megabytes.toFixed(megabytes >= 10 ? 0 : 1)} MB`;
}

function formatDuration(seconds: number | null) {
  if (!seconds) return "";
  const minutes = Math.floor(seconds / 60);
  const remainder = String(Math.floor(seconds % 60)).padStart(2, "0");
  return `${minutes}:${remainder}`;
}

type DraftMap = Record<string, { title: string; artist: string }>;

export function MusicPage({
  navigate,
}: {
  navigate?: (to: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const player = useMusicPlayer();
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [drafts, setDrafts] = useState<DraftMap>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const totalSize = useMemo(
    () => tracks.reduce((sum, track) => sum + Number(track.file_size_bytes || 0), 0),
    [tracks]
  );

  function buildDrafts(rows: MusicTrack[]) {
    const next: DraftMap = {};
    for (const track of rows) {
      next[track.id] = {
        title: track.title,
        artist: track.artist || "",
      };
    }
    setDrafts(next);
  }

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const rows = await listMusicTracks();
      setTracks(rows);
      buildDrafts(rows);
      replaceMusicLibrary(rows);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not load your music.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    void loadMusicLibrary(true);
  }, []);

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setMessage("");
    setError("");

    try {
      let order = tracks.length;
      for (const file of Array.from(files)) {
        setMessage(`Uploading ${file.name}…`);
        await uploadMusicTrack(file, order);
        order += 1;
      }
      setMessage(`${files.length} song${files.length === 1 ? "" : "s"} uploaded.`);
      await refresh();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Music upload failed.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function saveTrack(track: MusicTrack) {
    const draft = drafts[track.id];
    if (!draft) return;
    setBusyId(track.id);
    setError("");
    setMessage("");

    try {
      await updateMusicTrack(track.id, {
        title: draft.title,
        artist: draft.artist,
      });
      setMessage("Song details saved.");
      await refresh();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not save song details.");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteTrack(track: MusicTrack) {
    const confirmed = window.confirm(`Delete “${track.title}” from MVP Trainer?`);
    if (!confirmed) return;

    setBusyId(track.id);
    setError("");
    setMessage("");
    try {
      await removeMusicTrack(track.id);
      setMessage("Song removed.");
      await refresh();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not remove the song.");
    } finally {
      setBusyId(null);
    }
  }

  async function moveTrack(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= tracks.length) return;

    const next = [...tracks];
    const current = next[index];
    const other = next[target];
    if (!current || !other) return;
    next[index] = other;
    next[target] = current;

    setTracks(next);
    replaceMusicLibrary(next);
    setBusyId(current.id);
    setError("");
    try {
      await saveMusicTrackOrder(next);
      await refresh();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not reorder the playlist.");
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  function goBack() {
    if (navigate) navigate("/");
    else window.location.pathname = "/";
  }

  return (
    <div className="tr-musicPage">
      <Card
        title="My Music"
        tone="blue"
        right={
          <button type="button" className="tr-seg" onClick={goBack}>
            BACK
          </button>
        }
      >
        <div className="tr-musicIntro">
          <div>
            <div className="tr-kicker">PRIVATE WORKOUT MUSIC LIBRARY</div>
            <div className="tr-musicIntroTitle">Your own music, inside MVP Trainer.</div>
            <div className="tr-sub">
              Upload MP3, M4A, or WAV songs. During alerts, MVP Trainer lowers this player, plays your custom alert, and restores the music.
            </div>
          </div>

          <div className="tr-musicStats">
            <div>
              <span>{tracks.length}</span>
              SONGS
            </div>
            <div>
              <span>{formatFileSize(totalSize) || "0 MB"}</span>
              STORED
            </div>
          </div>
        </div>

        <div className="tr-musicUploadPanel">
          <input
            ref={inputRef}
            type="file"
            accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,.mp3,.m4a,.wav"
            multiple
            onChange={(event) => void uploadFiles(event.target.files)}
            disabled={uploading}
          />
          <button
            type="button"
            className="tr-btn tr-btn--musicOrange"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? "UPLOADING…" : "UPLOAD SONGS"}
          </button>
          <div className="tr-sub">Maximum 50 MB per song. Upload only music you own or have permission to store.</div>
        </div>

        {message ? <div className="tr-musicNotice tr-musicNotice--ok">{message}</div> : null}
        {error ? <div className="tr-musicNotice tr-musicNotice--err">{error}</div> : null}

        {loading ? (
          <div className="tr-rowbox">Loading your music library…</div>
        ) : tracks.length === 0 ? (
          <div className="tr-musicEmpty">
            <div className="tr-musicEmptyIcon" aria-hidden>♫</div>
            <div className="tr-musicEmptyTitle">No songs uploaded yet</div>
            <div className="tr-sub">Press Upload Songs to build your private workout playlist.</div>
          </div>
        ) : (
          <div className="tr-musicTrackList">
            {tracks.map((track, index) => {
              const draft = drafts[track.id] ?? { title: track.title, artist: track.artist || "" };
              const active = player.currentTrack?.id === track.id;
              const busy = busyId === track.id;

              return (
                <article key={track.id} className={`tr-musicTrack ${active ? "is-active" : ""}`}>
                  <div className="tr-musicTrackNumber">{String(index + 1).padStart(2, "0")}</div>

                  <button
                    type="button"
                    className="tr-musicTrackPlay"
                    onClick={() => void playMusicTrack(track.id).catch(() => undefined)}
                    aria-label={`Play ${track.title}`}
                    title={`Play ${track.title}`}
                  >
                    {active && player.playing ? "Ⅱ" : "▶"}
                  </button>

                  <div className="tr-musicTrackFields">
                    <label>
                      <span>SONG TITLE</span>
                      <input
                        value={draft.title}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [track.id]: { ...draft, title: event.target.value },
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>ARTIST</span>
                      <input
                        value={draft.artist}
                        placeholder="Optional"
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [track.id]: { ...draft, artist: event.target.value },
                          }))
                        }
                      />
                    </label>
                    <div className="tr-musicTrackMeta">
                      {track.original_name}
                      {track.duration_seconds ? ` • ${formatDuration(track.duration_seconds)}` : ""}
                      {track.file_size_bytes ? ` • ${formatFileSize(track.file_size_bytes)}` : ""}
                    </div>
                  </div>

                  <div className="tr-musicTrackActions">
                    <button type="button" className="tr-seg" onClick={() => void moveTrack(index, -1)} disabled={busy || index === 0}>
                      ↑
                    </button>
                    <button type="button" className="tr-seg" onClick={() => void moveTrack(index, 1)} disabled={busy || index === tracks.length - 1}>
                      ↓
                    </button>
                    <button type="button" className="tr-btn tr-btn--blueOutline" onClick={() => void saveTrack(track)} disabled={busy}>
                      SAVE
                    </button>
                    <button type="button" className="tr-btn tr-btn--dangerOutline" onClick={() => void deleteTrack(track)} disabled={busy}>
                      DELETE
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
