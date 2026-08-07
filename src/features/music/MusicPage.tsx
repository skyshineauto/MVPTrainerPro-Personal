import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import {
  getMusicArtworkSignedUrl,
  listMusicTracks,
  removeMusicArtwork,
  removeMusicTrack,
  saveMusicTrackOrder,
  updateMusicTrack,
  uploadMusicArtwork,
  uploadMusicTrack,
  type MusicEnergyLevel,
  type MusicTrack,
} from "../../lib/musicStorage";
import {
  createMusicPlaylist,
  deleteMusicPlaylist,
  listMusicPlaylists,
  listMusicPlaylistTrackLinks,
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
  toggleMusicShuffle,
  useMusicPlayer,
} from "../../lib/musicPlayer";

type DraftMap = Record<string, { title: string; artist: string; album: string }>;
type PlaylistTrackMap = Record<string, string[]>;
type MusicTab = "songs" | "playlists" | "smart";
type SmartIntensity = "high" | "balanced" | "recovery";
type SongSort =
  | "library"
  | "title"
  | "artist"
  | "most_played"
  | "recently_played"
  | "recently_added";
type EnergyFilter = "all" | MusicEnergyLevel;
type PageSize = 12 | 24 | 48;

const PLAYLISTS_CHANGED_EVENT = "mvp:music-playlists-changed";

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

function formatDate(value: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

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

function songSortLabel(sort: SongSort) {
  if (sort === "title") return "Title";
  if (sort === "artist") return "Artist";
  if (sort === "most_played") return "Most played";
  if (sort === "recently_played") return "Recently played";
  if (sort === "recently_added") return "Recently added";
  return "Library order";
}

function TrackArtwork({
  track,
  size = "row",
}: {
  track: MusicTrack;
  size?: "row" | "detail";
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    if (!track.artwork_path) return () => { cancelled = true; };

    void getMusicArtworkSignedUrl(track)
      .then((next) => {
        if (!cancelled) setUrl(next);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });

    return () => { cancelled = true; };
  }, [track.id, track.artwork_path]);

  return (
    <span className={`tr-trackArtwork tr-trackArtwork--${size}`} aria-hidden>
      {url ? (
        <img src={url} alt="" />
      ) : (
        <span className="tr-trackArtworkFallback">♫</span>
      )}
    </span>
  );
}

export function MusicPage({ navigate }: { navigate?: (to: string) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const artworkInputRef = useRef<HTMLInputElement | null>(null);
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

  const [energyFilter, setEnergyFilter] = useState<EnergyFilter>("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [songSort, setSongSort] = useState<SongSort>("library");
  const [pageSize, setPageSize] = useState<PageSize>(12);
  const [page, setPage] = useState(1);
  const [selectedSongIds, setSelectedSongIds] = useState<Set<string>>(new Set());
  const [detailTrackId, setDetailTrackId] = useState<string | null>(null);
  const [playlistModalTrackIds, setPlaylistModalTrackIds] = useState<string[]>([]);
  const [playlistModalSelections, setPlaylistModalSelections] = useState<Set<string>>(
    new Set()
  );
  const [playlistModalName, setPlaylistModalName] = useState("");
  const [playlistModalBusy, setPlaylistModalBusy] = useState(false);

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
    const next = tracks.filter((track) => {
      const matchesSearch =
        !query ||
        `${track.title} ${track.artist || ""} ${track.original_name}`
          .toLowerCase()
          .includes(query);
      const matchesEnergy =
        energyFilter === "all" || track.energy_level === energyFilter;
      const matchesFavorite = !favoritesOnly || track.favorite;
      return matchesSearch && matchesEnergy && matchesFavorite;
    });

    return [...next].sort((left, right) => {
      if (songSort === "title") return left.title.localeCompare(right.title);
      if (songSort === "artist") {
        return (left.artist || "").localeCompare(right.artist || "");
      }
      if (songSort === "most_played") return right.play_count - left.play_count;
      if (songSort === "recently_played") {
        return (
          new Date(right.last_played_at || 0).getTime() -
          new Date(left.last_played_at || 0).getTime()
        );
      }
      if (songSort === "recently_added") {
        return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
      }
      return left.sort_order - right.sort_order;
    });
  }, [energyFilter, favoritesOnly, songSearch, songSort, tracks]);

  const totalPages = Math.max(1, Math.ceil(filteredTracks.length / pageSize));
  const pagedTracks = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredTracks.slice(start, start + pageSize);
  }, [filteredTracks, page, pageSize]);

  const availableTracks = useMemo(() => {
    const selected = new Set(selectedTrackIds);
    const query = playlistSearch.trim().toLowerCase();
    return tracks.filter((track) => {
      if (selected.has(track.id)) return false;
      if (!query) return true;
      return `${track.title} ${track.artist || ""}`.toLowerCase().includes(query);
    });
  }, [selectedTrackIds, playlistSearch, tracks]);

  const detailTrack = useMemo(
    () => tracks.find((track) => track.id === detailTrackId) ?? null,
    [detailTrackId, tracks]
  );

  const selectedCount = selectedSongIds.size;
  const allVisibleSelected =
    pagedTracks.length > 0 && pagedTracks.every((track) => selectedSongIds.has(track.id));

  function buildDrafts(rows: MusicTrack[]) {
    const next: DraftMap = {};
    for (const track of rows) {
      next[track.id] = {
        title: track.title,
        artist: track.artist || "",
        album: track.album || "",
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

  useEffect(() => {
    setPage(1);
  }, [songSearch, energyFilter, favoritesOnly, songSort, pageSize]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

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
      setError(
        caught instanceof Error ? caught.message : "Could not upload the selected songs."
      );
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
        album: updated.album || "",
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
        album: draft.album,
      });
      replaceTrackLocally(updated);
      setMessage("Song details saved.");
      setDetailTrackId(null);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not save the song.");
    } finally {
      setBusyId(null);
    }
  }

  async function replaceArtwork(track: MusicTrack, file: File | null) {
    if (!file) return;
    setBusyId(`artwork-${track.id}`);
    setError("");
    setMessage("");
    try {
      const updated = await uploadMusicArtwork(track, file);
      replaceTrackLocally(updated);
      setMessage("Album artwork updated.");
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not update album artwork.");
    } finally {
      setBusyId(null);
      if (artworkInputRef.current) artworkInputRef.current.value = "";
    }
  }

  async function clearArtwork(track: MusicTrack) {
    setBusyId(`artwork-${track.id}`);
    setError("");
    try {
      const updated = await removeMusicArtwork(track);
      replaceTrackLocally(updated);
      setMessage("Album artwork removed.");
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not remove album artwork.");
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

  async function applyBulkEnergy(energy: MusicEnergyLevel) {
    const ids = Array.from(selectedSongIds);
    if (!ids.length) return;
    setBusyId("bulk-energy");
    setError("");
    try {
      const updates = await Promise.all(
        ids.map((id) => updateMusicTrack(id, { energy_level: energy }))
      );
      for (const updated of updates) replaceTrackLocally(updated);
      setMessage(`${updates.length} songs marked ${energy}.`);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not update song energy.");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteTrack(track: MusicTrack) {
    if (!window.confirm(`Delete “${track.title}” from MVP Trainer?`)) return;

    setBusyId(track.id);
    setError("");
    setMessage("");
    try {
      await removeMusicTrack(track.id);
      setDetailTrackId(null);
      setMessage("Song removed.");
      await Promise.all([refreshTracks(), refreshPlaylists()]);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not remove the song.");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteSelectedTracks() {
    const ids = Array.from(selectedSongIds);
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length} selected songs from MVP Trainer?`)) return;

    setBusyId("bulk-delete");
    setError("");
    try {
      for (const id of ids) await removeMusicTrack(id);
      setSelectedSongIds(new Set());
      setMessage(`${ids.length} songs removed.`);
      await Promise.all([refreshTracks(), refreshPlaylists()]);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not remove the songs.");
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
    if (
      !window.confirm(
        `Delete playlist “${selectedPlaylist.name}”? Your songs will remain in My Music.`
      )
    )
      return;

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
      const next = [...selectedTrackIds, trackId];
      await replaceMusicPlaylistTracks(selectedPlaylist.id, next);
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
      await replaceMusicPlaylistTracks(
        selectedPlaylist.id,
        selectedTrackIds.filter((id) => id !== trackId)
      );
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
      else if (playlist.name !== smartName) {
        playlist = await renameMusicPlaylist(playlist.id, smartName);
      }

      await replaceMusicPlaylistTracks(
        playlist.id,
        mixTracks.map((track) => track.id)
      );
      await refreshPlaylists(playlist.id);
      setSelectedPlaylistId(playlist.id);
      setTab("playlists");
      await playMusicPlaylist(playlist, mixTracks);
      setMessage(
        `Smart Mix ready: ${mixTracks.length} songs, about ${formatLongDuration(
          mixTracks.reduce((sum, track) => sum + trackDuration(track), 0)
        )}.`
      );
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not build the Smart Mix.");
    } finally {
      setBuildingSmart(false);
    }
  }

  function toggleSongSelection(trackId: string) {
    setSelectedSongIds((current) => {
      const next = new Set(current);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  }

  function toggleSelectVisible() {
    setSelectedSongIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        for (const track of pagedTracks) next.delete(track.id);
      } else {
        for (const track of pagedTracks) next.add(track.id);
      }
      return next;
    });
  }

  function openPlaylistModal(trackIds: string[]) {
    const uniqueIds = Array.from(new Set(trackIds.filter(Boolean)));
    if (!uniqueIds.length) return;
    setDetailTrackId(null);
    const selectedPlaylists = new Set<string>();
    for (const playlist of playlists) {
      const ids = new Set(playlistTrackIds[playlist.id] ?? []);
      if (uniqueIds.every((id) => ids.has(id))) selectedPlaylists.add(playlist.id);
    }
    setPlaylistModalTrackIds(uniqueIds);
    setPlaylistModalSelections(selectedPlaylists);
    setPlaylistModalName("");
  }

  function closePlaylistModal() {
    if (playlistModalBusy) return;
    setPlaylistModalTrackIds([]);
    setPlaylistModalSelections(new Set());
    setPlaylistModalName("");
  }

  async function savePlaylistMemberships() {
    if (!playlistModalTrackIds.length) return;
    setPlaylistModalBusy(true);
    setError("");
    try {
      let createdPlaylistId: string | null = null;
      const cleanName = playlistModalName.trim();
      if (cleanName) {
        const created = await createMusicPlaylist(cleanName);
        createdPlaylistId = created.id;
        await replaceMusicPlaylistTracks(created.id, playlistModalTrackIds);
      }

      for (const playlist of playlists) {
        const currentIds = playlistTrackIds[playlist.id] ?? [];
        const targetSet = new Set(playlistModalTrackIds);
        const shouldContain = playlistModalSelections.has(playlist.id);
        const nextIds = shouldContain
          ? Array.from(new Set([...currentIds, ...playlistModalTrackIds]))
          : currentIds.filter((id) => !targetSet.has(id));
        if (nextIds.join("|") !== currentIds.join("|")) {
          await replaceMusicPlaylistTracks(playlist.id, nextIds);
        }
      }

      await refreshPlaylists(createdPlaylistId ?? selectedPlaylistId);
      setMessage(
        `${playlistModalTrackIds.length} song${
          playlistModalTrackIds.length === 1 ? "" : "s"
        } playlist memberships updated.`
      );
      setSelectedSongIds(new Set());
      setPlaylistModalTrackIds([]);
      setPlaylistModalSelections(new Set());
      setPlaylistModalName("");
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not update playlists.");
    } finally {
      setPlaylistModalBusy(false);
    }
  }

  const modalTrackNames = playlistModalTrackIds
    .map((id) => tracks.find((track) => track.id === id)?.title)
    .filter(Boolean);

  return (
    <div className="tr-musicHubPage tr-musicHubPage--v4">
      <section className="tr-musicHubHero">
        <div>
          <span className="tr-musicHubEyebrow">PRIVATE WORKOUT AUDIO</span>
          <h1>Your music. Engineered for training.</h1>
          <p>
            Upload your own songs, build playlists, and let Smart Mix assemble a fresh
            queue from your favorites, energy tags, skips, and recent plays.
          </p>
        </div>
        <button
          type="button"
          className="tr-musicHubBack"
          onClick={() => (navigate ? navigate("/") : window.history.back())}
        >
          BACK
        </button>
      </section>

      <section className="tr-musicHubStats" aria-label="Music library summary">
        <div>
          <strong>{tracks.length}</strong>
          <span>SONGS</span>
        </div>
        <div>
          <strong>{playlists.length}</strong>
          <span>PLAYLISTS</span>
        </div>
        <div>
          <strong>{favoriteCount}</strong>
          <span>FAVORITES</span>
        </div>
        <div>
          <strong>{formatFileSize(totalSize) || "0 MB"}</strong>
          <span>STORED</span>
        </div>
        <div>
          <strong>{formatLongDuration(totalDuration)}</strong>
          <span>PLAY TIME</span>
        </div>
      </section>

      <nav className="tr-musicHubTabs" aria-label="Music sections">
        <button
          type="button"
          className={tab === "songs" ? "is-active" : ""}
          onClick={() => setTab("songs")}
        >
          <span>01</span> SONG LIBRARY
        </button>
        <button
          type="button"
          className={tab === "playlists" ? "is-active" : ""}
          onClick={() => setTab("playlists")}
        >
          <span>02</span> PLAYLISTS
        </button>
        <button
          type="button"
          className={tab === "smart" ? "is-active" : ""}
          onClick={() => setTab("smart")}
        >
          <span>03</span> SMART MIX
        </button>
      </nav>

      {message ? <div className="tr-musicHubNotice tr-musicHubNotice--ok">{message}</div> : null}
      {error ? <div className="tr-musicHubNotice tr-musicHubNotice--err">{error}</div> : null}

      {tab === "songs" ? (
        <section className="tr-libraryConsole">
          <header className="tr-libraryHeader">
            <div>
              <span className="tr-musicHubEyebrow">SONG LIBRARY</span>
              <h2>Performance-ready catalog</h2>
              <p>{filteredTracks.length} matching songs across your private library.</p>
            </div>
            <div className="tr-libraryUploadBlock">
              <input
                ref={inputRef}
                type="file"
                accept=".mp3,.m4a,.wav,audio/*"
                multiple
                hidden
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  void uploadFiles(event.target.files)
                }
              />
              <button
                type="button"
                className="tr-libraryUpload"
                disabled={uploading}
                onClick={() => inputRef.current?.click()}
              >
                {uploading ? "UPLOADING…" : "+ UPLOAD SONGS"}
              </button>
            </div>
          </header>

          <div className="tr-libraryToolbar">
            <label className="tr-librarySearch">
              <span>SEARCH</span>
              <input
                value={songSearch}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setSongSearch(event.target.value)
                }
                placeholder="Song, artist, or file…"
              />
            </label>

            <label className="tr-libraryFilter">
              <span>ENERGY</span>
              <select
                value={energyFilter}
                onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                  setEnergyFilter(event.target.value as EnergyFilter)
                }
              >
                <option value="all">All energy</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>

            <label className="tr-libraryFilter">
              <span>SORT</span>
              <select
                value={songSort}
                onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                  setSongSort(event.target.value as SongSort)
                }
              >
                {(
                  [
                    "library",
                    "recently_added",
                    "title",
                    "artist",
                    "most_played",
                    "recently_played",
                  ] as SongSort[]
                ).map((sort) => (
                  <option key={sort} value={sort}>
                    {songSortLabel(sort)}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              className={`tr-libraryFavorites ${favoritesOnly ? "is-active" : ""}`}
              onClick={() => setFavoritesOnly((current) => !current)}
            >
              ★ FAVORITES
            </button>
          </div>

          {selectedCount ? (
            <div className="tr-libraryBulkBar">
              <strong>{selectedCount} SONG{selectedCount === 1 ? "" : "S"} SELECTED</strong>
              <div>
                <button type="button" onClick={() => openPlaylistModal(Array.from(selectedSongIds))}>
                  + ADD TO PLAYLIST
                </button>
                <button
                  type="button"
                  disabled={busyId === "bulk-energy"}
                  onClick={() => void applyBulkEnergy("high")}
                >
                  ⚡ HIGH ENERGY
                </button>
                <button
                  type="button"
                  className="is-danger"
                  disabled={busyId === "bulk-delete"}
                  onClick={() => void deleteSelectedTracks()}
                >
                  DELETE
                </button>
                <button type="button" onClick={() => setSelectedSongIds(new Set())}>
                  CLEAR
                </button>
              </div>
            </div>
          ) : null}

          <div className="tr-libraryTable" role="table" aria-label="Music library">
            <div className="tr-libraryTableHead" role="row">
              <label className="tr-libraryCheck">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleSelectVisible}
                  aria-label="Select all visible songs"
                />
              </label>
              <span>TRACK</span>
              <span>TIME</span>
              <span>ENERGY</span>
              <span>ACTIONS</span>
            </div>

            {loading ? <div className="tr-musicHubEmpty">Loading your music…</div> : null}
            {!loading && !pagedTracks.length ? (
              <div className="tr-musicHubEmpty">No songs match these filters.</div>
            ) : null}

            {!loading
              ? pagedTracks.map((track) => {
                  const isCurrent = player.currentTrack?.id === track.id;
                  const isPlaying = isCurrent && player.playing;
                  return (
                    <article
                      key={track.id}
                      className={`tr-libraryRow ${isCurrent ? "is-current" : ""}`}
                      role="row"
                    >
                      <label className="tr-libraryCheck">
                        <input
                          type="checkbox"
                          checked={selectedSongIds.has(track.id)}
                          onChange={() => toggleSongSelection(track.id)}
                          aria-label={`Select ${track.title}`}
                        />
                      </label>

                      <div className="tr-libraryTrackCell">
                        <TrackArtwork track={track} />
                        <button
                          type="button"
                          className={`tr-libraryPlay ${isPlaying ? "is-playing" : ""}`}
                          onClick={() => void toggleTrackPlayback(track)}
                          aria-label={isPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
                        >
                          {isPlaying ? "Ⅱ" : "▶"}
                        </button>
                        <div>
                          <strong>{track.title}</strong>
                          <span>
                            {[track.artist || "Unknown artist", track.album].filter(Boolean).join(" • ")}
                          </span>
                        </div>
                        {isCurrent ? <em>{isPlaying ? "PLAYING" : "READY"}</em> : null}
                      </div>

                      <span className="tr-libraryDuration">
                        {formatDuration(track.duration_seconds) || "--:--"}
                      </span>

                      <button
                        type="button"
                        className={`tr-libraryEnergy tr-libraryEnergy--${track.energy_level}`}
                        onClick={() =>
                          void setEnergy(
                            track,
                            track.energy_level === "low"
                              ? "medium"
                              : track.energy_level === "medium"
                                ? "high"
                                : "low"
                          )
                        }
                        aria-label={`Change energy for ${track.title}`}
                      >
                        {track.energy_level.toUpperCase()}
                      </button>

                      <div className="tr-libraryActions">
                        <button
                          type="button"
                          className={`tr-libraryFavorite ${track.favorite ? "is-active" : ""}`}
                          onClick={() => void toggleFavorite(track)}
                          aria-label={track.favorite ? "Remove favorite" : "Add favorite"}
                        >
                          ★
                        </button>
                        <button
                          type="button"
                          className="tr-libraryPlaylistButton"
                          onClick={() => openPlaylistModal([track.id])}
                        >
                          + PLAYLIST
                        </button>
                        <button
                          type="button"
                          className="tr-libraryMore"
                          onClick={() => setDetailTrackId(track.id)}
                          aria-label={`More options for ${track.title}`}
                        >
                          •••
                        </button>
                      </div>
                    </article>
                  );
                })
              : null}
          </div>

          <footer className="tr-libraryPagination">
            <label>
              <span>SHOW</span>
              <select
                value={pageSize}
                onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                  setPageSize(Number(event.target.value) as PageSize)
                }
              >
                <option value="12">12 songs</option>
                <option value="24">24 songs</option>
                <option value="48">48 songs</option>
              </select>
            </label>
            <div>
              <button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                ← PREVIOUS
              </button>
              <strong>
                PAGE {page} OF {totalPages}
              </strong>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((value) => value + 1)}
              >
                NEXT →
              </button>
            </div>
            <span>
              {filteredTracks.length ? (page - 1) * pageSize + 1 : 0}–
              {Math.min(page * pageSize, filteredTracks.length)} OF {filteredTracks.length}
            </span>
          </footer>
        </section>
      ) : null}

      {tab === "playlists" ? (
        <section className="tr-playlistStudio">
          <aside className="tr-playlistRail">
            <div className="tr-playlistRailHead">
              <span className="tr-musicHubEyebrow">YOUR PLAYLISTS</span>
              <strong>Choose a queue</strong>
            </div>
            <div className="tr-playlistCreatePremium">
              <input
                value={newPlaylistName}
                placeholder="New playlist name"
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setNewPlaylistName(event.target.value)
                }
                onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                  if (event.key === "Enter") void createPlaylist();
                }}
              />
              <button type="button" onClick={() => void createPlaylist()}>
                + CREATE
              </button>
            </div>
            <div className="tr-playlistTileList">
              {playlists.map((playlist) => {
                const count = playlistTrackIds[playlist.id]?.length ?? 0;
                return (
                  <button
                    key={playlist.id}
                    type="button"
                    className={`tr-playlistTile ${
                      selectedPlaylistId === playlist.id ? "is-active" : ""
                    }`}
                    onClick={() => setSelectedPlaylistId(playlist.id)}
                  >
                    <span className="tr-playlistTileIcon">♫</span>
                    <span>
                      <strong>{playlist.name}</strong>
                      <small>
                        {count} song{count === 1 ? "" : "s"}
                      </small>
                    </span>
                    {player.activePlaylistId === playlist.id ? <em>LIVE</em> : null}
                  </button>
                );
              })}
              {!playlists.length ? (
                <div className="tr-musicHubEmpty">Create your first playlist.</div>
              ) : null}
            </div>
          </aside>

          <div className="tr-playlistConsole">
            {selectedPlaylist ? (
              <>
                <header className="tr-playlistConsoleHead">
                  <div>
                    <span className="tr-musicHubEyebrow">SELECTED PLAYLIST</span>
                    <input
                      value={playlistNameDraft}
                      onChange={(event: ChangeEvent<HTMLInputElement>) =>
                        setPlaylistNameDraft(event.target.value)
                      }
                    />
                    <small>
                      {selectedTracks.length} songs • {formatLongDuration(selectedPlaylistSeconds)}
                    </small>
                  </div>
                  <div className="tr-playlistConsoleActions">
                    <button type="button" onClick={() => void savePlaylistName()}>
                      SAVE NAME
                    </button>
                    <button
                      type="button"
                      className="is-primary"
                      disabled={!selectedTracks.length}
                      onClick={() => void playSelectedPlaylist()}
                    >
                      ▶ PLAY
                    </button>
                    <button
                      type="button"
                      disabled={!selectedTracks.length}
                      onClick={() => {
                        if (!player.shuffle) toggleMusicShuffle();
                        void playSelectedPlaylist();
                      }}
                    >
                      ⇄ SHUFFLE
                    </button>
                    <button type="button" className="is-danger" onClick={() => void removePlaylist()}>
                      DELETE
                    </button>
                  </div>
                </header>

                <div className="tr-playlistTrackStack">
                  {selectedTracks.map((track, index) => (
                    <article
                      key={track.id}
                      className={`tr-playlistTrackRow ${
                        player.currentTrack?.id === track.id ? "is-current" : ""
                      }`}
                    >
                      <span className="tr-playlistTrackIndex">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <button
                        type="button"
                        className="tr-playlistTrackPlay"
                        onClick={() => void playSelectedPlaylist(track.id)}
                      >
                        ▶
                      </button>
                      <TrackArtwork track={track} />
                      <span className="tr-playlistTrackText">
                        <strong>{track.title}</strong>
                        <small>
                          {track.artist || "Unknown artist"} • {formatDuration(track.duration_seconds) || "--:--"}
                        </small>
                      </span>
                      <span className="tr-playlistTrackTools">
                        <button type="button" disabled={index === 0} onClick={() => void movePlaylistTrack(index, -1)}>
                          ↑
                        </button>
                        <button
                          type="button"
                          disabled={index === selectedTracks.length - 1}
                          onClick={() => void movePlaylistTrack(index, 1)}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="is-remove"
                          onClick={() => void removeTrackFromSelected(track.id)}
                        >
                          REMOVE
                        </button>
                      </span>
                    </article>
                  ))}
                  {!selectedTracks.length ? (
                    <div className="tr-musicHubEmpty">
                      No songs yet. Add tracks from your library below.
                    </div>
                  ) : null}
                </div>

                <section className="tr-playlistAddPanel">
                  <div className="tr-playlistAddHead">
                    <div>
                      <span className="tr-musicHubEyebrow">ADD FROM LIBRARY</span>
                      <strong>Expand this playlist</strong>
                    </div>
                    <input
                      value={playlistSearch}
                      onChange={(event: ChangeEvent<HTMLInputElement>) =>
                        setPlaylistSearch(event.target.value)
                      }
                      placeholder="Search available songs…"
                    />
                  </div>
                  <div className="tr-playlistAvailableGrid">
                    {availableTracks.map((track) => (
                      <article key={track.id} className="tr-playlistAvailableCard">
                        <span>
                          <strong>{track.title}</strong>
                          <small>
                            {track.artist || "Unknown artist"} • {formatDuration(track.duration_seconds) || "--:--"}
                          </small>
                        </span>
                        <button
                          type="button"
                          disabled={busyId === track.id}
                          onClick={() => void addTrackToSelected(track.id)}
                        >
                          + ADD
                        </button>
                      </article>
                    ))}
                    {!availableTracks.length ? (
                      <div className="tr-musicHubEmpty">
                        Every matching song is already in this playlist.
                      </div>
                    ) : null}
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
            <p>
              Smart Mix scores your uploaded songs using favorites, energy, play history,
              skips, recency, and artist variety. It updates one reusable Smart Mix playlist
              and starts it immediately.
            </p>
            <div className="tr-smartSignals">
              <span>★ FAVORITES</span>
              <span>⚡ ENERGY</span>
              <span>↺ RECENCY</span>
              <span>⊘ SKIPS</span>
              <span>◎ VARIETY</span>
            </div>
          </div>

          <div className="tr-smartMixControls">
            <label>
              <span>MIX LENGTH</span>
              <select
                value={smartMinutes}
                onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                  setSmartMinutes(Number(event.target.value))
                }
              >
                <option value="30">30 minutes</option>
                <option value="45">45 minutes</option>
                <option value="60">60 minutes</option>
                <option value="90">90 minutes</option>
                <option value="120">2 hours</option>
              </select>
            </label>
            <div className="tr-smartIntensity">
              <span>INTENSITY</span>
              {(["recovery", "balanced", "high"] as SmartIntensity[]).map((intensity) => (
                <button
                  key={intensity}
                  type="button"
                  className={smartIntensity === intensity ? "is-active" : ""}
                  onClick={() => setSmartIntensity(intensity)}
                >
                  {intensity === "high" ? "HIGH ENERGY" : intensity.toUpperCase()}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="tr-smartBuildButton"
              disabled={buildingSmart || !tracks.length}
              onClick={() => void buildAndPlaySmartMix()}
            >
              {buildingSmart ? "BUILDING MIX…" : "✦ BUILD, SAVE & PLAY SMART MIX"}
            </button>
            <small>
              {tracks.length} uploaded songs available • {favoriteCount} favorites tagged
            </small>
          </div>
        </section>
      ) : null}

      {detailTrack ? (
        <div className="tr-musicModalBackdrop" role="presentation" onMouseDown={() => setDetailTrackId(null)}>
          <section
            className="tr-trackInspector"
            role="dialog"
            aria-modal="true"
            aria-label={`Edit ${detailTrack.title}`}
            onMouseDown={(event: MouseEvent<HTMLElement>) => event.stopPropagation()}
          >
            <header>
              <div className="tr-trackInspectorIdentity">
                <TrackArtwork track={detailTrack} size="detail" />
                <div>
                  <span className="tr-musicHubEyebrow">TRACK DETAILS</span>
                  <h2>{detailTrack.title}</h2>
                </div>
              </div>
              <button type="button" onClick={() => setDetailTrackId(null)} aria-label="Close track details">
                ×
              </button>
            </header>

            <div className="tr-trackInspectorBody">
              <label>
                <span>SONG TITLE</span>
                <input
                  value={drafts[detailTrack.id]?.title ?? detailTrack.title}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setDrafts((current) => ({
                      ...current,
                      [detailTrack.id]: {
                        title: event.target.value,
                        artist: current[detailTrack.id]?.artist ?? detailTrack.artist ?? "",
                        album: current[detailTrack.id]?.album ?? detailTrack.album ?? "",
                      },
                    }))
                  }
                />
              </label>
              <label>
                <span>ARTIST</span>
                <input
                  value={drafts[detailTrack.id]?.artist ?? detailTrack.artist ?? ""}
                  placeholder="Unknown artist"
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setDrafts((current) => ({
                      ...current,
                      [detailTrack.id]: {
                        title: current[detailTrack.id]?.title ?? detailTrack.title,
                        artist: event.target.value,
                        album: current[detailTrack.id]?.album ?? detailTrack.album ?? "",
                      },
                    }))
                  }
                />
              </label>

              <label>
                <span>ALBUM</span>
                <input
                  value={drafts[detailTrack.id]?.album ?? detailTrack.album ?? ""}
                  placeholder="Optional album"
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setDrafts((current) => ({
                      ...current,
                      [detailTrack.id]: {
                        title: current[detailTrack.id]?.title ?? detailTrack.title,
                        artist: current[detailTrack.id]?.artist ?? detailTrack.artist ?? "",
                        album: event.target.value,
                      },
                    }))
                  }
                />
              </label>

              <div className="tr-trackArtworkEditor">
                <input
                  ref={artworkInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    void replaceArtwork(detailTrack, event.target.files?.[0] ?? null)
                  }
                />
                <div>
                  <span>ALBUM ARTWORK</span>
                  <small>
                    Embedded MP3/M4A artwork is imported automatically when available.
                  </small>
                </div>
                <button
                  type="button"
                  disabled={busyId === `artwork-${detailTrack.id}`}
                  onClick={() => artworkInputRef.current?.click()}
                >
                  {detailTrack.artwork_path ? "REPLACE ARTWORK" : "+ ADD ARTWORK"}
                </button>
                {detailTrack.artwork_path ? (
                  <button
                    type="button"
                    className="is-danger"
                    disabled={busyId === `artwork-${detailTrack.id}`}
                    onClick={() => void clearArtwork(detailTrack)}
                  >
                    REMOVE
                  </button>
                ) : null}
              </div>

              <div className="tr-trackInspectorEnergy">
                <span>ENERGY LEVEL</span>
                <div>
                  {(["low", "medium", "high"] as MusicEnergyLevel[]).map((energy) => (
                    <button
                      key={energy}
                      type="button"
                      className={detailTrack.energy_level === energy ? "is-active" : ""}
                      onClick={() => void setEnergy(detailTrack, energy)}
                    >
                      {energy.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              <dl className="tr-trackInspectorMeta">
                <div>
                  <dt>DURATION</dt>
                  <dd>{formatDuration(detailTrack.duration_seconds) || "--:--"}</dd>
                </div>
                <div>
                  <dt>FILE SIZE</dt>
                  <dd>{formatFileSize(detailTrack.file_size_bytes) || "--"}</dd>
                </div>
                <div>
                  <dt>PLAYS</dt>
                  <dd>{detailTrack.play_count}</dd>
                </div>
                <div>
                  <dt>SKIPS</dt>
                  <dd>{detailTrack.skip_count}</dd>
                </div>
                <div>
                  <dt>LAST PLAYED</dt>
                  <dd>{formatDate(detailTrack.last_played_at)}</dd>
                </div>
                <div>
                  <dt>ADDED</dt>
                  <dd>{formatDate(detailTrack.created_at)}</dd>
                </div>
              </dl>
            </div>

            <footer>
              <div>
                <button
                  type="button"
                  disabled={tracks.findIndex((track) => track.id === detailTrack.id) === 0}
                  onClick={() => moveTrack(detailTrack.id, -1)}
                >
                  ↑ MOVE UP
                </button>
                <button
                  type="button"
                  disabled={tracks.findIndex((track) => track.id === detailTrack.id) === tracks.length - 1}
                  onClick={() => moveTrack(detailTrack.id, 1)}
                >
                  ↓ MOVE DOWN
                </button>
              </div>
              <div>
                <button type="button" onClick={() => openPlaylistModal([detailTrack.id])}>
                  + PLAYLIST
                </button>
                <button
                  type="button"
                  className="is-danger"
                  disabled={busyId === detailTrack.id}
                  onClick={() => void deleteTrack(detailTrack)}
                >
                  DELETE
                </button>
                <button
                  type="button"
                  className="is-primary"
                  disabled={busyId === detailTrack.id}
                  onClick={() => void saveTrack(detailTrack)}
                >
                  SAVE CHANGES
                </button>
              </div>
            </footer>
          </section>
        </div>
      ) : null}

      {playlistModalTrackIds.length ? (
        <div className="tr-musicModalBackdrop" role="presentation" onMouseDown={closePlaylistModal}>
          <section
            className="tr-playlistPicker"
            role="dialog"
            aria-modal="true"
            aria-label="Add songs to playlists"
            onMouseDown={(event: MouseEvent<HTMLElement>) => event.stopPropagation()}
          >
            <header>
              <div>
                <span className="tr-musicHubEyebrow">PLAYLIST ROUTING</span>
                <h2>
                  {playlistModalTrackIds.length === 1
                    ? `Add “${modalTrackNames[0] || "song"}”`
                    : `Route ${playlistModalTrackIds.length} selected songs`}
                </h2>
              </div>
              <button type="button" onClick={closePlaylistModal} aria-label="Close playlist picker">
                ×
              </button>
            </header>

            <div className="tr-playlistPickerList">
              {playlists.map((playlist) => {
                const currentIds = new Set(playlistTrackIds[playlist.id] ?? []);
                const matchingCount = playlistModalTrackIds.filter((id) => currentIds.has(id)).length;
                const checked = playlistModalSelections.has(playlist.id);
                return (
                  <label key={playlist.id} className={checked ? "is-checked" : ""}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setPlaylistModalSelections((current) => {
                          const next = new Set(current);
                          if (next.has(playlist.id)) next.delete(playlist.id);
                          else next.add(playlist.id);
                          return next;
                        })
                      }
                    />
                    <span className="tr-playlistPickerIcon">♫</span>
                    <span>
                      <strong>{playlist.name}</strong>
                      <small>
                        {playlistTrackIds[playlist.id]?.length ?? 0} songs
                        {matchingCount
                          ? ` • ${matchingCount}/${playlistModalTrackIds.length} selected already included`
                          : ""}
                      </small>
                    </span>
                  </label>
                );
              })}
              {!playlists.length ? (
                <div className="tr-musicHubEmpty">Create a playlist below.</div>
              ) : null}
            </div>

            <label className="tr-playlistPickerCreate">
              <span>CREATE A NEW PLAYLIST AND ADD THESE SONGS</span>
              <input
                value={playlistModalName}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setPlaylistModalName(event.target.value)
                }
                placeholder="New playlist name"
              />
            </label>

            <footer>
              <button type="button" onClick={closePlaylistModal} disabled={playlistModalBusy}>
                CANCEL
              </button>
              <button
                type="button"
                className="is-primary"
                onClick={() => void savePlaylistMemberships()}
                disabled={playlistModalBusy}
              >
                {playlistModalBusy ? "SAVING…" : "SAVE PLAYLISTS"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      <style>{`
        .tr-libraryTrackCell{grid-template-columns:auto auto minmax(0,1fr) auto!important;}
        .tr-trackArtwork{display:grid;place-items:center;overflow:hidden;flex:0 0 auto;border:1px solid rgba(101,194,229,.15);background:linear-gradient(145deg,#102331,#07131b);box-shadow:inset 0 1px 0 rgba(255,255,255,.04);}
        .tr-trackArtwork--row{width:34px;height:34px;border-radius:8px;}
        .tr-trackArtwork--detail{width:68px;height:68px;border-radius:13px;}
        .tr-trackArtwork img{width:100%;height:100%;object-fit:cover;display:block;}
        .tr-trackArtworkFallback{color:#ffc164;font-size:16px;font-weight:1000;}
        .tr-trackArtwork--detail .tr-trackArtworkFallback{font-size:28px;}
        .tr-trackInspectorIdentity{display:flex!important;align-items:center;gap:12px;min-width:0;}
        .tr-trackInspectorIdentity>div{min-width:0;}
        .tr-trackArtworkEditor{grid-column:1/-1;display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px;align-items:center;padding:11px;border:1px solid rgba(91,192,231,.16);border-radius:12px;background:rgba(5,15,22,.45);}
        .tr-trackArtworkEditor>div{display:grid;gap:3px;}.tr-trackArtworkEditor>div>span{color:#9ddff8;font-size:8px;font-weight:1000;letter-spacing:.13em;}.tr-trackArtworkEditor small{color:rgba(200,217,226,.55);font-size:10px;}
        .tr-trackArtworkEditor button{min-height:35px;padding:0 11px;border:1px solid rgba(91,194,231,.25);border-radius:9px;color:#dff6ff;background:rgba(15,74,98,.30);font-size:8px;font-weight:1000;letter-spacing:.07em;cursor:pointer;}
        .tr-trackArtworkEditor button.is-danger{border-color:rgba(227,88,88,.25);color:#ffb3b3;background:rgba(105,22,22,.18);}
        .tr-playlistTrackRow>.tr-trackArtwork{margin-left:2px;}
        @media(max-width:700px){
          .tr-libraryTrackCell{grid-template-columns:auto auto minmax(0,1fr)!important;}.tr-libraryTrackCell>em{grid-column:3;}
          .tr-trackArtworkEditor{grid-template-columns:1fr 1fr;}.tr-trackArtworkEditor>div{grid-column:1/-1;}.tr-trackInspectorIdentity .tr-trackArtwork--detail{width:54px;height:54px;}
        }
      `}</style>
    </div>
  );
}
