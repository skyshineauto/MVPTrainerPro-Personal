import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import {
  listMusicTracks,
  removeMusicTrack,
  saveMusicTrackOrder,
  updateMusicTrack,
  uploadMusicTrack,
  type MusicEnergyLevel,
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

function formatLongDuration(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds / 60));
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  return `${hours} hr${minutes ? ` ${minutes} min` : ""}`;
}

type DraftMap = Record<string, { title: string; artist: string }>;
type PlaylistTrackMap = Record<string, string[]>;
type MusicTab = "songs" | "playlists" | "smart";
type SmartIntensity = "high" | "balanced" | "recovery";
const PLAYLISTS_CHANGED_EVENT = "mvp:music-playlists-changed";

function trackDuration(track: MusicTrack) {
  return Math.max(120, Number(track.duration_seconds || 210));
}

function smartMixScore(track: MusicTrack, intensity: SmartIntensity) {
  const targetEnergy: MusicEnergyLevel =
    intensity === "high" ? "high" : intensity === "recovery" ? "low" : "medium";

  let score = Math.random() * 9;
  if (track.favorite) score += 44;
  if (track.energy_level === targetEnergy) score += 28;
  else if (intensity === "balanced" && track.energy_level === "high") score += 13;
  else if (track.energy_level === "medium") score += 9;

  score += Math.max(0, 8 - track.play_count * 0.35);
  score -= Math.min(28, track.skip_count * 4.5);

  if (track.last_played_at) {
    const ageHours =
      (Date.now() - new Date(track.last_played_at).getTime()) / (1000 * 60 * 60);
    if (ageHours < 12) score -= 16;
    else if (ageHours < 72) score -= 8;
    else if (ageHours < 168) score -= 3;
  } else {
    score += 7;
  }

  return score;
}

function buildSmartMix(
  tracks: MusicTrack[],
  minutes: number,
  intensity: SmartIntensity
) {
  const targetSeconds = Math.max(15, minutes) * 60;
  const candidates = tracks
    .map((track) => ({ track, score: smartMixScore(track, intensity) }))
    .sort((a, b) => b.score - a.score);

  const selected: MusicTrack[] = [];
  const used = new Set<string>();
  let seconds = 0;
  let lastArtist = "";

  while (selected.length < candidates.length && seconds < targetSeconds) {
    const nextIndex = candidates.findIndex(({ track }) => {
      if (used.has(track.id)) return false;
      const artist = (track.artist || "").trim().toLowerCase();
      return !lastArtist || !artist || artist !== lastArtist;
    });
    const fallbackIndex = candidates.findIndex(({ track }) => !used.has(track.id));
    const index = nextIndex >= 0 ? nextIndex : fallbackIndex;
    if (index < 0) break;

    const track = candidates[index].track;
    selected.push(track);
    used.add(track.id);
    seconds += trackDuration(track);
    lastArtist = (track.artist || "").trim().toLowerCase();
  }

  if (!selected.length && tracks.length) selected.push(tracks[0]);
  return selected;
}

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
  const [songSearch, setSongSearch] = useState("");
  const [playlistSearch, setPlaylistSearch] = useState("");
  const [smartMinutes, setSmartMinutes] = useState(60);
  const [smartIntensity, setSmartIntensity] = useState<SmartIntensity>("high");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [buildingSmart, setBuildingSmart] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const totalSize = useMemo(
    () => tracks.reduce((sum, track) => sum + Number(track.file_size_bytes || 0), 0),
    [tracks]
  );

  const totalDuration = useMemo(
    () => tracks.reduce((sum, track) => sum + Number(track.duration_seconds || 0), 0),
    [tracks]
  );

  const favoriteCount = useMemo(
    () => tracks.filter((track) => track.favorite).length,
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

  const selectedPlaylistSeconds = useMemo(
    () => selectedTracks.reduce((sum, track) => sum + trackDuration(track), 0),
    [selectedTracks]
  );

  const filteredTracks = useMemo(() => {
    const query = songSearch.trim().toLowerCase();
    if (!query) return tracks;
    return tracks.filter((track) =>
      `${track.title} ${track.artist || ""} ${track.original_name}`
        .toLowerCase()
        .includes(query)
    );
  }, [songSearch, tracks]);

  const availableTracks = useMemo(() => {
    const selected = new Set(selectedTrackIds);
    const query = playlistSearch.trim().toLowerCase();
    return tracks.filter((track) => {
      if (selected.has(track.id)) return false;
      if (!query) return true;
      return `${track.title} ${track.artist || ""}`.toLowerCase().includes(query);
    });
  }, [selectedTrackIds, playlistSearch, tracks]);

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
    window.dispatchEvent(new Event(PLAYLISTS_CHANGED_EVENT));
    return { rows, map: nextMap, selectedId: nextSelected };
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

  function replaceTrackLocally(updated: MusicTrack) {
    setTracks((current) => {
      const next = current.map((track) => (track.id === updated.id ? updated : track));
      replaceMusicLibrary(next);
      latestOrderRef.current = next;
      return next;
    });
    setDrafts((current) => ({
      ...current,
      [updated.id]: {
        title: updated.title,
        artist: updated.artist || "",
      },
    }));
  }

  async function saveTrack(track: MusicTrack) {
    const draft = drafts[track.id];
    if (!draft) return;

    setBusyId(track.id);
    setError("");
    setMessage("");
    try {
      const updated = await updateMusicTrack(track.id, {
        title: draft.title,
        artist: draft.artist,
      });
      replaceTrackLocally(updated);
      setMessage("Song details saved.");
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not save the song.");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleFavorite(track: MusicTrack) {
    try {
      const updated = await updateMusicTrack(track.id, { favorite: !track.favorite });
      replaceTrackLocally(updated);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not update favorite.");
    }
  }

  async function setEnergy(track: MusicTrack, energy: MusicEnergyLevel) {
    try {
      const updated = await updateMusicTrack(track.id, { energy_level: energy });
      replaceTrackLocally(updated);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not update song energy.");
    }
  }

  async function deleteTrack(track: MusicTrack) {
    if (!window.confirm(`Delete “${track.title}” from MVP Trainer?`)) return;

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
    }, 650);
  }

  function moveTrack(trackId: string, direction: -1 | 1) {
    const index = tracks.findIndex((track) => track.id === trackId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= tracks.length) return;

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
      if (isCurrentTrack && player.playing) pauseMusic();
      else if (isCurrentTrack) await playMusic();
      else {
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
      await refreshPlaylists(null);
      setMessage("Playlist deleted.");
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not delete the playlist.");
    } finally {
      setBusyId(null);
    }
  }

  async function addTrackToSelected(trackId: string) {
    if (!selectedPlaylist) return;
    setBusyId(trackId);
    try {
      await addMusicPlaylistTracks(selectedPlaylist.id, [trackId]);
      await refreshPlaylists(selectedPlaylist.id);
      setMessage("Song added to playlist.");
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not add the song.");
    } finally {
      setBusyId(null);
    }
  }

  async function removeTrackFromSelected(trackId: string) {
    if (!selectedPlaylist) return;
    setBusyId(trackId);
    try {
      await removeMusicPlaylistTrack(selectedPlaylist.id, trackId);
      await refreshPlaylists(selectedPlaylist.id);
      setMessage("Song removed from playlist.");
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not remove the song.");
    } finally {
      setBusyId(null);
    }
  }

  async function movePlaylistTrack(index: number, direction: -1 | 1) {
    if (!selectedPlaylist) return;
    const target = index + direction;
    if (target < 0 || target >= selectedTrackIds.length) return;

    const nextIds = [...selectedTrackIds];
    [nextIds[index], nextIds[target]] = [nextIds[target], nextIds[index]];
    setPlaylistTrackIds((current) => ({ ...current, [selectedPlaylist.id]: nextIds }));

    try {
      await replaceMusicPlaylistTracks(selectedPlaylist.id, nextIds);
      setMessage("Playlist order saved.");
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not save playlist order.");
      await refreshPlaylists(selectedPlaylist.id);
    }
  }

  async function playSelectedPlaylist(startTrackId?: string) {
    if (!selectedPlaylist) return;
    try {
      await playMusicPlaylist(selectedPlaylist, selectedTracks, startTrackId);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not play the playlist.");
    }
  }

  async function buildAndPlaySmartMix() {
    if (!tracks.length) {
      setError("Upload songs before building a Smart Mix.");
      return;
    }

    setBuildingSmart(true);
    setError("");
    setMessage("Building your Smart Mix…");
    try {
      const mixTracks = buildSmartMix(tracks, smartMinutes, smartIntensity);
      const smartName = `Smart Mix • ${
        smartIntensity === "high"
          ? "High Energy"
          : smartIntensity === "recovery"
            ? "Recovery"
            : "Balanced"
      }`;
      let playlist = playlists.find((item) => item.name.startsWith("Smart Mix"));

      if (!playlist) playlist = await createMusicPlaylist(smartName);
      else if (playlist.name !== smartName) playlist = await renameMusicPlaylist(playlist.id, smartName);

      await replaceMusicPlaylistTracks(playlist.id, mixTracks.map((track) => track.id));
      await refreshPlaylists(playlist.id);
      setSelectedPlaylistId(playlist.id);
      setTab("playlists");
      await playMusicPlaylist(playlist, mixTracks);
      setMessage(`Smart Mix ready: ${mixTracks.length} songs, about ${formatLongDuration(mixTracks.reduce((sum, track) => sum + trackDuration(track), 0))}.`);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not build the Smart Mix.");
    } finally {
      setBuildingSmart(false);
    }
  }

  return (
    <div className="tr-musicHubPage">
      <section className="tr-musicHubHero">
        <div>
          <span className="tr-musicHubEyebrow">PRIVATE WORKOUT AUDIO</span>
          <h1>Your music. Engineered for training.</h1>
          <p>Upload your own songs, build playlists, and let Smart Mix assemble a fresh queue from your favorites, energy tags, skips, and recent plays.</p>
        </div>
        <button type="button" className="tr-musicHubBack" onClick={() => (navigate ? navigate("/") : window.history.back())}>BACK</button>
      </section>

      <section className="tr-musicHubStats" aria-label="Music library summary">
        <div><strong>{tracks.length}</strong><span>SONGS</span></div>
        <div><strong>{playlists.length}</strong><span>PLAYLISTS</span></div>
        <div><strong>{favoriteCount}</strong><span>FAVORITES</span></div>
        <div><strong>{formatFileSize(totalSize) || "0 MB"}</strong><span>STORED</span></div>
        <div><strong>{formatLongDuration(totalDuration)}</strong><span>PLAY TIME</span></div>
      </section>

      <nav className="tr-musicHubTabs" aria-label="Music sections">
        <button type="button" className={tab === "songs" ? "is-active" : ""} onClick={() => setTab("songs")}><span>01</span> SONG LIBRARY</button>
        <button type="button" className={tab === "playlists" ? "is-active" : ""} onClick={() => setTab("playlists")}><span>02</span> PLAYLISTS</button>
        <button type="button" className={tab === "smart" ? "is-active" : ""} onClick={() => setTab("smart")}><span>03</span> SMART MIX</button>
      </nav>

      {message ? <div className="tr-musicHubNotice tr-musicHubNotice--ok">{message}</div> : null}
      {error ? <div className="tr-musicHubNotice tr-musicHubNotice--err">{error}</div> : null}

      {tab === "songs" ? (
        <section className="tr-musicLibraryPanel">
          <div className="tr-musicCommandBar">
            <div>
              <span className="tr-musicHubEyebrow">SONG LIBRARY</span>
              <h2>Manage your private catalog</h2>
            </div>
            <label className="tr-musicUploadButton">
              <input
                ref={inputRef}
                type="file"
                accept=".mp3,.m4a,.wav,audio/mpeg,audio/mp4,audio/x-m4a,audio/wav"
                multiple
                onChange={(event: ChangeEvent<HTMLInputElement>) => void uploadFiles(event.target.files)}
              />
              {uploading ? "UPLOADING…" : "+ UPLOAD SONGS"}
            </label>
            <label className="tr-musicSearch">
              <span>SEARCH</span>
              <input value={songSearch} onChange={(event: ChangeEvent<HTMLInputElement>) => setSongSearch(event.target.value)} placeholder="Song, artist, or file…" />
            </label>
          </div>

          {loading ? (
            <div className="tr-musicHubEmpty">Loading your music…</div>
          ) : !filteredTracks.length ? (
            <div className="tr-musicHubEmpty">{tracks.length ? "No songs match your search." : "Upload your first MP3, M4A, or WAV file."}</div>
          ) : (
            <div className="tr-songCardGrid">
              {filteredTracks.map((track) => {
                const index = tracks.findIndex((item) => item.id === track.id);
                const isCurrent = player.currentTrack?.id === track.id;
                const isPlaying = isCurrent && player.playing;
                const draft = drafts[track.id] ?? { title: track.title, artist: track.artist || "" };

                return (
                  <article key={track.id} className={`tr-songCard ${isCurrent ? "is-current" : ""}`}>
                    <div className="tr-songCardTop">
                      <span className="tr-songIndex">{String(index + 1).padStart(2, "0")}</span>
                      <button type="button" className={`tr-songFavorite ${track.favorite ? "is-active" : ""}`} onClick={() => void toggleFavorite(track)} aria-label={track.favorite ? "Remove favorite" : "Add favorite"}>★</button>
                    </div>

                    <div className="tr-songPreview">
                      <button type="button" className="tr-songPlayButton" onClick={() => void toggleTrackPlayback(track)}>{isPlaying ? "Ⅱ" : "▶"}</button>
                      <button type="button" className="tr-songStopButton" disabled={!isCurrent} onClick={() => stopTrackPreview(track)}>■</button>
                      <span>{isPlaying ? "PLAYING" : isCurrent ? "PAUSED" : "PREVIEW"}</span>
                    </div>

                    <label className="tr-songField"><span>SONG TITLE</span><input value={draft.title} onChange={(event: ChangeEvent<HTMLInputElement>) => setDrafts((current) => ({ ...current, [track.id]: { ...draft, title: event.target.value } }))} /></label>
                    <label className="tr-songField"><span>ARTIST</span><input value={draft.artist} placeholder="Optional" onChange={(event: ChangeEvent<HTMLInputElement>) => setDrafts((current) => ({ ...current, [track.id]: { ...draft, artist: event.target.value } }))} /></label>

                    <div className="tr-songEnergy">
                      <span>ENERGY</span>
                      {(["low", "medium", "high"] as MusicEnergyLevel[]).map((energy) => (
                        <button key={energy} type="button" className={track.energy_level === energy ? "is-active" : ""} onClick={() => void setEnergy(track, energy)}>{energy.toUpperCase()}</button>
                      ))}
                    </div>

                    <div className="tr-songMeta">
                      <span>{formatDuration(track.duration_seconds) || "--:--"}</span>
                      <span>{formatFileSize(track.file_size_bytes) || "--"}</span>
                      <span>{track.play_count} plays</span>
                      <span>{track.skip_count} skips</span>
                    </div>

                    <div className="tr-songCardActions">
                      <button type="button" disabled={index === 0} onClick={() => moveTrack(track.id, -1)}>↑ MOVE</button>
                      <button type="button" disabled={index === tracks.length - 1} onClick={() => moveTrack(track.id, 1)}>↓ MOVE</button>
                      <button type="button" className="is-save" disabled={busyId === track.id} onClick={() => void saveTrack(track)}>SAVE</button>
                      <button type="button" className="is-delete" disabled={busyId === track.id} onClick={() => void deleteTrack(track)}>DELETE</button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      {tab === "playlists" ? (
        <section className="tr-playlistStudio">
          <aside className="tr-playlistRail">
            <div className="tr-playlistRailHead"><span className="tr-musicHubEyebrow">YOUR PLAYLISTS</span><strong>Choose a queue</strong></div>
            <div className="tr-playlistCreatePremium">
              <input value={newPlaylistName} placeholder="New playlist name" onChange={(event: ChangeEvent<HTMLInputElement>) => setNewPlaylistName(event.target.value)} onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => { if (event.key === "Enter") void createPlaylist(); }} />
              <button type="button" onClick={() => void createPlaylist()}>+ CREATE</button>
            </div>
            <div className="tr-playlistTileList">
              {playlists.map((playlist) => {
                const count = playlistTrackIds[playlist.id]?.length ?? 0;
                return (
                  <button key={playlist.id} type="button" className={`tr-playlistTile ${selectedPlaylistId === playlist.id ? "is-active" : ""}`} onClick={() => setSelectedPlaylistId(playlist.id)}>
                    <span className="tr-playlistTileIcon">♫</span>
                    <span><strong>{playlist.name}</strong><small>{count} song{count === 1 ? "" : "s"}</small></span>
                    {player.activePlaylistId === playlist.id ? <em>LIVE</em> : null}
                  </button>
                );
              })}
              {!playlists.length ? <div className="tr-musicHubEmpty">Create your first playlist.</div> : null}
            </div>
          </aside>

          <div className="tr-playlistConsole">
            {selectedPlaylist ? (
              <>
                <header className="tr-playlistConsoleHead">
                  <div>
                    <span className="tr-musicHubEyebrow">SELECTED PLAYLIST</span>
                    <input value={playlistNameDraft} onChange={(event: ChangeEvent<HTMLInputElement>) => setPlaylistNameDraft(event.target.value)} />
                    <small>{selectedTracks.length} songs • {formatLongDuration(selectedPlaylistSeconds)}</small>
                  </div>
                  <div className="tr-playlistConsoleActions">
                    <button type="button" onClick={() => void savePlaylistName()}>SAVE NAME</button>
                    <button type="button" className="is-primary" disabled={!selectedTracks.length} onClick={() => void playSelectedPlaylist()}>▶ PLAY</button>
                    <button type="button" disabled={!selectedTracks.length} onClick={() => { if (!player.shuffle) toggleMusicShuffle(); void playSelectedPlaylist(); }}>⇄ SHUFFLE</button>
                    <button type="button" className="is-danger" onClick={() => void removePlaylist()}>DELETE</button>
                  </div>
                </header>

                <div className="tr-playlistTrackStack">
                  {selectedTracks.map((track, index) => (
                    <article key={track.id} className={`tr-playlistTrackRow ${player.currentTrack?.id === track.id ? "is-current" : ""}`}>
                      <span className="tr-playlistTrackIndex">{String(index + 1).padStart(2, "0")}</span>
                      <button type="button" className="tr-playlistTrackPlay" onClick={() => void playSelectedPlaylist(track.id)}>▶</button>
                      <span className="tr-playlistTrackText"><strong>{track.title}</strong><small>{track.artist || "Unknown artist"} • {formatDuration(track.duration_seconds) || "--:--"}</small></span>
                      <span className="tr-playlistTrackTools">
                        <button type="button" disabled={index === 0} onClick={() => void movePlaylistTrack(index, -1)}>↑</button>
                        <button type="button" disabled={index === selectedTracks.length - 1} onClick={() => void movePlaylistTrack(index, 1)}>↓</button>
                        <button type="button" className="is-remove" onClick={() => void removeTrackFromSelected(track.id)}>REMOVE</button>
                      </span>
                    </article>
                  ))}
                  {!selectedTracks.length ? <div className="tr-musicHubEmpty">No songs yet. Add tracks from your library below.</div> : null}
                </div>

                <section className="tr-playlistAddPanel">
                  <div className="tr-playlistAddHead"><div><span className="tr-musicHubEyebrow">ADD FROM LIBRARY</span><strong>Expand this playlist</strong></div><input value={playlistSearch} onChange={(event: ChangeEvent<HTMLInputElement>) => setPlaylistSearch(event.target.value)} placeholder="Search available songs…" /></div>
                  <div className="tr-playlistAvailableGrid">
                    {availableTracks.map((track) => (
                      <article key={track.id} className="tr-playlistAvailableCard"><span><strong>{track.title}</strong><small>{track.artist || "Unknown artist"} • {formatDuration(track.duration_seconds) || "--:--"}</small></span><button type="button" disabled={busyId === track.id} onClick={() => void addTrackToSelected(track.id)}>+ ADD</button></article>
                    ))}
                    {!availableTracks.length ? <div className="tr-musicHubEmpty">Every matching song is already in this playlist.</div> : null}
                  </div>
                </section>
              </>
            ) : (
              <div className="tr-musicHubEmpty">Create or choose a playlist.</div>
            )}
          </div>
        </section>
      ) : null}

      {tab === "smart" ? (
        <section className="tr-smartMixPanel">
          <div className="tr-smartMixCopy">
            <span className="tr-musicHubEyebrow">SMART MIX ENGINE</span>
            <h2>A fresh workout playlist in one press.</h2>
            <p>Smart Mix scores your uploaded songs using favorites, energy, play history, skips, recency, and artist variety. It updates one reusable Smart Mix playlist and starts it immediately.</p>
            <div className="tr-smartSignals"><span>★ FAVORITES</span><span>⚡ ENERGY</span><span>↺ RECENCY</span><span>⊘ SKIPS</span><span>◎ VARIETY</span></div>
          </div>

          <div className="tr-smartMixControls">
            <label><span>MIX LENGTH</span><select value={smartMinutes} onChange={(event: ChangeEvent<HTMLSelectElement>) => setSmartMinutes(Number(event.target.value))}><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option><option value="90">90 minutes</option><option value="120">2 hours</option></select></label>
            <div className="tr-smartIntensity"><span>INTENSITY</span>{(["recovery", "balanced", "high"] as SmartIntensity[]).map((intensity) => <button key={intensity} type="button" className={smartIntensity === intensity ? "is-active" : ""} onClick={() => setSmartIntensity(intensity)}>{intensity === "high" ? "HIGH ENERGY" : intensity.toUpperCase()}</button>)}</div>
            <button type="button" className="tr-smartBuildButton" disabled={buildingSmart || !tracks.length} onClick={() => void buildAndPlaySmartMix()}>{buildingSmart ? "BUILDING MIX…" : "✦ BUILD, SAVE & PLAY SMART MIX"}</button>
            <small>{tracks.length} uploaded songs available • {favoriteCount} favorites tagged</small>
          </div>
        </section>
      ) : null}
    </div>
  );
}
