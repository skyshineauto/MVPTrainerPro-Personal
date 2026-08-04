import { useEffect, useMemo, useRef, useState } from "react";
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
  addMusicPlaylistTracks,
  createMusicPlaylist,
  deleteMusicPlaylist,
  listMusicPlaylists,
  listMusicPlaylistTrackLinks,
  removeMusicPlaylistTrack,
  renameMusicPlaylist,
  replaceMusicPlaylistTracks,
  type MusicPlaylist,
} from "../../lib/playlistStorage";
import {
  activateAllMusicTracks,
  activateMusicPlaylistQueue,
  loadMusicLibrary,
  pauseMusic,
  playMusic,
  playMusicPlaylist,
  playMusicTrack,
  replaceMusicLibrary,
  stopMusic,
  toggleMusicShuffle,
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
type PlaylistTrackMap = Record<string, string[]>;
type MusicTab = "songs" | "playlists";

export function MusicPage({
  navigate,
}: {
  navigate?: (to: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const orderSaveTimerRef = useRef<number | null>(null);
  const latestOrderRef = useRef<MusicTrack[]>([]);
  const player = useMusicPlayer();

  const [tab, setTab] = useState<MusicTab>("songs");
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [drafts, setDrafts] = useState<DraftMap>({});
  const [playlists, setPlaylists] = useState<MusicPlaylist[]>([]);
  const [playlistTrackIds, setPlaylistTrackIds] = useState<PlaylistTrackMap>({});
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [playlistNameDraft, setPlaylistNameDraft] = useState("");
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const totalSize = useMemo(
    () => tracks.reduce((sum, track) => sum + Number(track.file_size_bytes || 0), 0),
    [tracks]
  );

  const selectedPlaylist = useMemo(
    () => playlists.find((playlist) => playlist.id === selectedPlaylistId) ?? null,
    [playlists, selectedPlaylistId]
  );

  const selectedTrackIds = selectedPlaylistId
    ? playlistTrackIds[selectedPlaylistId] ?? []
    : [];

  const selectedTracks = useMemo(() => {
    const byId = new Map(tracks.map((track) => [track.id, track]));
    return selectedTrackIds
      .map((id) => byId.get(id))
      .filter((track): track is MusicTrack => Boolean(track));
  }, [selectedTrackIds, tracks]);

  const availableTracks = useMemo(() => {
    const selected = new Set(selectedTrackIds);
    return tracks.filter((track) => !selected.has(track.id));
  }, [selectedTrackIds, tracks]);

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

  async function refreshTracks() {
    const rows = await listMusicTracks();
    setTracks(rows);
    latestOrderRef.current = rows;
    buildDrafts(rows);
    replaceMusicLibrary(rows);
    return rows;
  }

  async function refreshPlaylists(preferredId?: string | null) {
    const rows = await listMusicPlaylists();
    const entries = await Promise.all(
      rows.map(async (playlist) => {
        const links = await listMusicPlaylistTrackLinks(playlist.id);
        return [playlist.id, links.map((link) => link.track_id)] as const;
      })
    );
    const nextMap = Object.fromEntries(entries) as PlaylistTrackMap;
    setPlaylists(rows);
    setPlaylistTrackIds(nextMap);

    const nextSelected =
      preferredId && rows.some((playlist) => playlist.id === preferredId)
        ? preferredId
        : selectedPlaylistId && rows.some((playlist) => playlist.id === selectedPlaylistId)
        ? selectedPlaylistId
        : rows[0]?.id ?? null;

    setSelectedPlaylistId(nextSelected);
    const selected = rows.find((playlist) => playlist.id === nextSelected);
    setPlaylistNameDraft(selected?.name ?? "");
  }

  async function refreshAll() {
    setLoading(true);
    setError("");
    try {
      await Promise.all([refreshTracks(), refreshPlaylists()]);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not load your music.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshAll();
    void loadMusicLibrary(true);

    return () => {
      if (orderSaveTimerRef.current != null) {
        window.clearTimeout(orderSaveTimerRef.current);
        const pending = latestOrderRef.current;
        if (pending.length) void saveMusicTrackOrder(pending).catch(() => undefined);
      }
    };
  }, []);

  useEffect(() => {
    setPlaylistNameDraft(selectedPlaylist?.name ?? "");
  }, [selectedPlaylist?.id, selectedPlaylist?.name]);

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
      await refreshTracks();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not upload the selected songs.");
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
      await refreshTracks();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not save the song.");
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
      await Promise.all([refreshTracks(), refreshPlaylists()]);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not remove the song.");
    } finally {
      setBusyId(null);
    }
  }

  function scheduleTrackOrderSave(next: MusicTrack[]) {
    latestOrderRef.current = next;
    if (orderSaveTimerRef.current != null) {
      window.clearTimeout(orderSaveTimerRef.current);
    }

    setMessage("Saving song order…");
    orderSaveTimerRef.current = window.setTimeout(async () => {
      orderSaveTimerRef.current = null;
      try {
        await saveMusicTrackOrder(latestOrderRef.current);
        setMessage("Song order saved.");
      } catch (caught: unknown) {
        setError(caught instanceof Error ? caught.message : "Could not save the song order.");
        await refreshTracks();
      }
    }, 500);
  }

  function moveTrack(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= tracks.length) return;

    const next = [...tracks];
    [next[index], next[target]] = [next[target], next[index]];
    setTracks(next);
    replaceMusicLibrary(next);
    scheduleTrackOrderSave(next);
  }

  async function toggleTrackPlayback(track: MusicTrack) {
    setError("");
    try {
      const isCurrentTrack = player.currentTrack?.id === track.id;
      if (isCurrentTrack && player.playing) {
        pauseMusic();
      } else if (isCurrentTrack) {
        await playMusic();
      } else {
        activateAllMusicTracks();
        await playMusicTrack(track.id, 0);
      }
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not control this song.");
    }
  }

  function stopTrackPreview(track: MusicTrack) {
    if (player.currentTrack?.id === track.id) stopMusic();
  }

  async function createPlaylist() {
    setError("");
    setMessage("");
    try {
      const playlist = await createMusicPlaylist(newPlaylistName);
      setNewPlaylistName("");
      setTab("playlists");
      await refreshPlaylists(playlist.id);
      setMessage("Playlist created.");
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not create the playlist.");
    }
  }

  async function savePlaylistName() {
    if (!selectedPlaylist) return;
    setBusyId(selectedPlaylist.id);
    setError("");
    try {
      await renameMusicPlaylist(selectedPlaylist.id, playlistNameDraft);
      await refreshPlaylists(selectedPlaylist.id);
      setMessage("Playlist name saved.");
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not rename the playlist.");
    } finally {
      setBusyId(null);
    }
  }

  async function removePlaylist() {
    if (!selectedPlaylist) return;
    if (!window.confirm(`Delete playlist “${selectedPlaylist.name}”? Your songs will remain in My Music.`)) return;

    setBusyId(selectedPlaylist.id);
    setError("");
    try {
      await deleteMusicPlaylist(selectedPlaylist.id);
      if (player.activePlaylistId === selectedPlaylist.id) activateAllMusicTracks();
      await refreshPlaylists(null);
      setMessage("Playlist deleted. Your songs were not deleted.");
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not delete the playlist.");
    } finally {
      setBusyId(null);
    }
  }

  async function savePlaylistIds(nextIds: string[], successMessage: string) {
    if (!selectedPlaylist) return;
    const previous = selectedTrackIds;
    setPlaylistTrackIds((current) => ({ ...current, [selectedPlaylist.id]: nextIds }));
    setError("");
    setMessage("Saving playlist…");

    try {
      await replaceMusicPlaylistTracks(selectedPlaylist.id, nextIds);
      const nextTracks = nextIds
        .map((id) => tracks.find((track) => track.id === id))
        .filter((track): track is MusicTrack => Boolean(track));
      if (player.activePlaylistId === selectedPlaylist.id) {
        activateMusicPlaylistQueue(selectedPlaylist, nextTracks);
      }
      setMessage(successMessage);
    } catch (caught: unknown) {
      setPlaylistTrackIds((current) => ({ ...current, [selectedPlaylist.id]: previous }));
      setError(caught instanceof Error ? caught.message : "Could not save the playlist.");
    }
  }

  async function addTrackToSelected(trackId: string) {
    if (!selectedPlaylist) return;
    try {
      await addMusicPlaylistTracks(selectedPlaylist.id, [trackId]);
      const nextIds = [...selectedTrackIds, trackId];
      setPlaylistTrackIds((current) => ({ ...current, [selectedPlaylist.id]: nextIds }));
      if (player.activePlaylistId === selectedPlaylist.id) {
        activateMusicPlaylistQueue(
          selectedPlaylist,
          nextIds
            .map((id) => tracks.find((track) => track.id === id))
            .filter((track): track is MusicTrack => Boolean(track))
        );
      }
      setMessage("Song added to playlist.");
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not add the song.");
    }
  }

  async function removeTrackFromSelected(trackId: string) {
    if (!selectedPlaylist) return;
    try {
      await removeMusicPlaylistTrack(selectedPlaylist.id, trackId);
      const nextIds = selectedTrackIds.filter((id) => id !== trackId);
      setPlaylistTrackIds((current) => ({ ...current, [selectedPlaylist.id]: nextIds }));
      if (player.activePlaylistId === selectedPlaylist.id) {
        activateMusicPlaylistQueue(
          selectedPlaylist,
          nextIds
            .map((id) => tracks.find((track) => track.id === id))
            .filter((track): track is MusicTrack => Boolean(track))
        );
      }
      setMessage("Song removed from playlist.");
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not remove the song from the playlist.");
    }
  }

  async function movePlaylistTrack(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= selectedTrackIds.length) return;
    const next = [...selectedTrackIds];
    [next[index], next[target]] = [next[target], next[index]];
    await savePlaylistIds(next, "Playlist order saved.");
  }

  async function playSelectedPlaylist(startTrackId?: string) {
    if (!selectedPlaylist) return;
    setError("");
    try {
      await playMusicPlaylist(selectedPlaylist, selectedTracks, startTrackId);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not play the playlist.");
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
            <div className="tr-musicIntroTitle">Your music. Your playlists. One workout player.</div>
            <div className="tr-sub">
              Upload music once, organize it into playlists, and keep playback running while MVP Trainer handles your workout alerts.
            </div>
          </div>

          <div className="tr-musicStats">
            <div><span>{tracks.length}</span>SONGS</div>
            <div><span>{playlists.length}</span>PLAYLISTS</div>
            <div><span>{formatFileSize(totalSize) || "0 MB"}</span>STORED</div>
          </div>
        </div>

        <div className="tr-musicTabs" role="tablist" aria-label="Music library sections">
          <button type="button" className={tab === "songs" ? "is-active" : ""} onClick={() => setTab("songs")}>
            SONGS
          </button>
          <button type="button" className={tab === "playlists" ? "is-active" : ""} onClick={() => setTab("playlists")}>
            PLAYLISTS
          </button>
        </div>

        {message ? <div className="tr-musicNotice tr-musicNotice--ok">{message}</div> : null}
        {error ? <div className="tr-musicNotice tr-musicNotice--err">{error}</div> : null}

        {tab === "songs" ? (
          <>
            <div className="tr-musicUploadPanel">
              <button
                type="button"
                className="tr-btn tr-btn--musicOrange"
                disabled={uploading}
                onClick={() => inputRef.current?.click()}
              >
                {uploading ? "UPLOADING…" : "UPLOAD SONGS"}
              </button>
              <input
                ref={inputRef}
                type="file"
                accept=".mp3,.m4a,.wav,audio/mpeg,audio/mp4,audio/x-m4a,audio/wav"
                multiple
                onChange={(event) => void uploadFiles(event.target.files)}
              />
              <div className="tr-sub">Maximum 50 MB per song. Upload only music you own or have permission to store.</div>
            </div>

            {loading ? (
              <div className="tr-musicEmpty"><div className="tr-sub">Loading your music…</div></div>
            ) : !tracks.length ? (
              <div className="tr-musicEmpty">
                <div className="tr-musicEmptyIcon">♫</div>
                <div className="tr-musicEmptyTitle">Your music library is empty</div>
                <div className="tr-sub">Upload your first MP3, M4A, or WAV file.</div>
              </div>
            ) : (
              <div className="tr-musicTrackList">
                {tracks.map((track, index) => {
                  const isCurrent = player.currentTrack?.id === track.id;
                  const isPlaying = isCurrent && player.playing;
                  const draft = drafts[track.id] ?? { title: track.title, artist: track.artist || "" };

                  return (
                    <div key={track.id} className={`tr-musicTrack ${isCurrent ? "is-active" : ""}`}>
                      <div className="tr-musicTrackNumber">{String(index + 1).padStart(2, "0")}</div>

                      <div className="tr-musicTrackPreviewControls">
                        <button type="button" className="tr-musicTrackPlay" onClick={() => void toggleTrackPlayback(track)}>
                          {isPlaying ? "Ⅱ" : "▶"}
                        </button>
                        <button type="button" className="tr-musicTrackStop" disabled={!isCurrent} onClick={() => stopTrackPreview(track)}>
                          ■
                        </button>
                      </div>

                      <div className="tr-musicTrackFields">
                        <label>
                          <span>SONG TITLE</span>
                          <input
                            value={draft.title}
                            onChange={(event) => setDrafts((current) => ({
                              ...current,
                              [track.id]: { ...draft, title: event.target.value },
                            }))}
                          />
                        </label>
                        <label>
                          <span>ARTIST</span>
                          <input
                            value={draft.artist}
                            placeholder="Optional"
                            onChange={(event) => setDrafts((current) => ({
                              ...current,
                              [track.id]: { ...draft, artist: event.target.value },
                            }))}
                          />
                        </label>
                        <div className="tr-musicTrackMeta">
                          {track.original_name}
                          {formatDuration(track.duration_seconds) ? ` • ${formatDuration(track.duration_seconds)}` : ""}
                          {formatFileSize(track.file_size_bytes) ? ` • ${formatFileSize(track.file_size_bytes)}` : ""}
                        </div>
                      </div>

                      <div className="tr-musicTrackActions">
                        <button type="button" className="tr-seg" disabled={index === 0} onClick={() => moveTrack(index, -1)}>↑</button>
                        <button type="button" className="tr-seg" disabled={index === tracks.length - 1} onClick={() => moveTrack(index, 1)}>↓</button>
                        <button type="button" className="tr-btn tr-btn--blueOutline" disabled={busyId === track.id} onClick={() => void saveTrack(track)}>SAVE</button>
                        <button type="button" className="tr-btn tr-btn--dangerOutline" disabled={busyId === track.id} onClick={() => void deleteTrack(track)}>DELETE</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <div className="tr-playlistWorkspace">
            <aside className="tr-playlistSidebar">
              <div className="tr-playlistCreate">
                <input
                  value={newPlaylistName}
                  placeholder="New playlist name"
                  onChange={(event) => setNewPlaylistName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void createPlaylist();
                  }}
                />
                <button type="button" className="tr-btn tr-btn--musicOrange" onClick={() => void createPlaylist()}>
                  + CREATE PLAYLIST
                </button>
              </div>

              <div className="tr-playlistList">
                {playlists.map((playlist) => {
                  const count = playlistTrackIds[playlist.id]?.length ?? 0;
                  return (
                    <button
                      key={playlist.id}
                      type="button"
                      className={`tr-playlistCard ${selectedPlaylistId === playlist.id ? "is-active" : ""}`}
                      onClick={() => setSelectedPlaylistId(playlist.id)}
                    >
                      <span>{playlist.name}</span>
                      <small>{count} song{count === 1 ? "" : "s"}</small>
                    </button>
                  );
                })}
                {!playlists.length ? <div className="tr-sub">Create your first playlist.</div> : null}
              </div>
            </aside>

            <section className="tr-playlistEditor">
              {selectedPlaylist ? (
                <>
                  <div className="tr-playlistEditorHead">
                    <div className="tr-playlistNameEdit">
                      <span className="tr-kicker">PLAYLIST NAME</span>
                      <input value={playlistNameDraft} onChange={(event) => setPlaylistNameDraft(event.target.value)} />
                    </div>
                    <div className="tr-playlistHeadActions">
                      <button type="button" className="tr-btn tr-btn--blueOutline" onClick={() => void savePlaylistName()}>SAVE NAME</button>
                      <button type="button" className="tr-btn tr-btn--musicOrange" disabled={!selectedTracks.length} onClick={() => void playSelectedPlaylist()}>
                        ▶ PLAY PLAYLIST
                      </button>
                      <button
                        type="button"
                        className="tr-btn"
                        disabled={!selectedTracks.length}
                        onClick={() => {
                          if (!player.shuffle) toggleMusicShuffle();
                          void playSelectedPlaylist();
                        }}
                      >
                        ⇄ SHUFFLE PLAY
                      </button>
                      <button type="button" className="tr-btn tr-btn--dangerOutline" onClick={() => void removePlaylist()}>DELETE PLAYLIST</button>
                    </div>
                  </div>

                  {player.activePlaylistId === selectedPlaylist.id ? (
                    <div className="tr-playlistActiveBadge">CURRENT PLAYER QUEUE</div>
                  ) : null}

                  <div className="tr-playlistSectionTitle">PLAYLIST SONGS</div>
                  <div className="tr-playlistSongList">
                    {selectedTracks.map((track, index) => (
                      <div key={track.id} className="tr-playlistSong">
                        <span className="tr-playlistSongIndex">{index + 1}</span>
                        <button type="button" className="tr-musicTrackPlay" onClick={() => void playSelectedPlaylist(track.id)}>▶</button>
                        <span className="tr-playlistSongText">
                          <strong>{track.title}</strong>
                          <small>{track.artist || track.original_name}</small>
                        </span>
                        <span className="tr-playlistSongActions">
                          <button type="button" className="tr-seg" disabled={index === 0} onClick={() => void movePlaylistTrack(index, -1)}>↑</button>
                          <button type="button" className="tr-seg" disabled={index === selectedTracks.length - 1} onClick={() => void movePlaylistTrack(index, 1)}>↓</button>
                          <button type="button" className="tr-btn tr-btn--dangerOutline" onClick={() => void removeTrackFromSelected(track.id)}>REMOVE</button>
                        </span>
                      </div>
                    ))}
                    {!selectedTracks.length ? <div className="tr-musicEmpty"><div className="tr-sub">Add songs from your library below.</div></div> : null}
                  </div>

                  <div className="tr-playlistSectionTitle">ADD SONGS</div>
                  <div className="tr-playlistAvailableList">
                    {availableTracks.map((track) => (
                      <div key={track.id} className="tr-playlistAvailableSong">
                        <span><strong>{track.title}</strong><small>{track.artist || track.original_name}</small></span>
                        <button type="button" className="tr-btn tr-btn--blueOutline" onClick={() => void addTrackToSelected(track.id)}>+ ADD</button>
                      </div>
                    ))}
                    {!availableTracks.length ? <div className="tr-sub">Every uploaded song is already in this playlist.</div> : null}
                  </div>
                </>
              ) : (
                <div className="tr-musicEmpty"><div className="tr-sub">Create or choose a playlist.</div></div>
              )}
            </section>
          </div>
        )}
      </Card>
    </div>
  );
}
