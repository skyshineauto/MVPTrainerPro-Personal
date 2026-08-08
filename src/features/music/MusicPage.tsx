import {
  useEffect,
  useMemo,
  useRef,
  useState,
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
  uploadRemoteMusicArtwork,
  type MusicEnergyLevel,
  type MusicTrack,
} from "../../lib/musicStorage";
import {
  delayMusicLookup,
  enrichMusicTrack,
  findMusicMetadataCandidates,
  musicMatchTier,
  needsMusicArtwork,
  needsMusicMetadata,
  type MusicMetadataCandidate,
} from "../../lib/musicMetadata";
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
  activateMusicPlaylistQueue,
  addMusicToQueue,
  loadMusicLibrary,
  pauseMusic,
  playMusic,
  playMusicAdHocQueue,
  playMusicNext,
  playMusicPlaylist,
  playMusicTrack,
  replaceMusicLibrary,
  setPlayerMusicPreference,
  useMusicPlayer,
} from "../../lib/musicPlayer";

type MusicTab = "songs" | "artists" | "albums" | "playlists" | "smart";
type SongSort = "library" | "title" | "artist" | "recent" | "plays";
type EnergyFilter = "all" | MusicEnergyLevel;
type HealthFilter = "all" | "needs" | "artwork" | "ready";
type PageSize = 10 | 25 | 50 | 100;
type DetailMode = "edit" | "info_results" | "artwork_results";
type DetailSaveState =
  | "idle"
  | "searching"
  | "saving"
  | "changed"
  | "error";

type Draft = {
  title: string;
  artist: string;
  album: string;
  releaseYear: string;
  genre: string;
};

type DraftMap = Record<string, Draft>;
type PlaylistTrackMap = Record<string, string[]>;

function formatFileSize(bytes: number | null) {
  if (!bytes) return "0 MB";
  const megabytes = bytes / (1024 * 1024);
  return `${megabytes.toFixed(megabytes >= 10 ? 0 : 1)} MB`;
}

function formatDuration(seconds: number | null) {
  if (!seconds) return "--:--";
  const minutes = Math.floor(seconds / 60);
  const remainder = String(Math.floor(seconds % 60)).padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function formatLongDuration(seconds: number) {
  if (!seconds) return "0 MIN";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours ? `${hours}H ${minutes}M` : `${minutes} MIN`;
}

function formatDate(value: string | null) {
  if (!value) return "NEVER";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "NEVER";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function artistLabel(track: MusicTrack) {
  return track.artist?.trim() || "Unknown Artist";
}

function albumLabel(track: MusicTrack) {
  return track.album?.trim() || "Unknown Album";
}

function buildDrafts(rows: MusicTrack[]) {
  const next: DraftMap = {};
  for (const track of rows) {
    next[track.id] = {
      title: track.title,
      artist: track.artist || "",
      album: track.album || "",
      releaseYear: track.release_year ? String(track.release_year) : "",
      genre: track.genre || "",
    };
  }
  return next;
}

function matchClass(confidence: number) {
  return `is-${musicMatchTier(confidence)
    .toLowerCase()
    .replace(/\s+/g, "-")}`;
}

function groupTracks(
  tracks: MusicTrack[],
  selector: (track: MusicTrack) => string
) {
  const groups = new Map<string, MusicTrack[]>();

  for (const track of tracks) {
    const key = selector(track);
    const current = groups.get(key) || [];
    current.push(track);
    groups.set(key, current);
  }

  return [...groups.entries()]
    .map(([name, songs]) => ({
      name,
      songs,
      plays: songs.reduce((sum, song) => sum + song.play_count, 0),
      duration: songs.reduce(
        (sum, song) => sum + Number(song.duration_seconds || 0),
        0
      ),
    }))
    .sort((left, right) =>
      left.name.localeCompare(right.name, undefined, {
        sensitivity: "base",
      })
    );
}

function TrackArtwork({
  track,
  size = "row",
}: {
  track: MusicTrack;
  size?: "row" | "card" | "detail";
}) {
  const [url, setUrl] = useState<string | null>(
    track.external_artwork_url || null
  );

  useEffect(() => {
    let cancelled = false;

    void getMusicArtworkSignedUrl(track)
      .then((value) => {
        if (!cancelled) setUrl(value);
      })
      .catch(() => {
        if (!cancelled) setUrl(track.external_artwork_url || null);
      });

    return () => {
      cancelled = true;
    };
  }, [track.id, track.artwork_path, track.external_artwork_url]);

  return (
    <span className={`tr12-art tr12-art--${size}`}>
      {url ? <img src={url} alt="" /> : <i>♫</i>}
    </span>
  );
}

export function MusicPage({
  navigate,
}: {
  navigate?: (to: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const artworkInputRef = useRef<HTMLInputElement | null>(null);
  const player = useMusicPlayer();

  const [tab, setTab] = useState<MusicTab>("songs");
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [drafts, setDrafts] = useState<DraftMap>({});
  const [playlists, setPlaylists] = useState<MusicPlaylist[]>([]);
  const [playlistTrackIds, setPlaylistTrackIds] =
    useState<PlaylistTrackMap>({});
  const [selectedPlaylistId, setSelectedPlaylistId] =
    useState<string | null>(null);
  const [playlistNameDraft, setPlaylistNameDraft] = useState("");
  const [newPlaylistName, setNewPlaylistName] = useState("");

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SongSort>("library");
  const [energyFilter, setEnergyFilter] =
    useState<EnergyFilter>("all");
  const [healthFilter, setHealthFilter] =
    useState<HealthFilter>("all");
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set()
  );

  const [detailTrackId, setDetailTrackId] =
    useState<string | null>(null);
  const [detailMode, setDetailMode] =
    useState<DetailMode>("edit");
  const [detailCandidates, setDetailCandidates] =
    useState<MusicMetadataCandidate[]>([]);
  const [detailSelectedCandidateId, setDetailSelectedCandidateId] =
    useState<string | null>(null);
  const [detailPendingCandidate, setDetailPendingCandidate] =
    useState<MusicMetadataCandidate | null>(null);
  const [detailSaveState, setDetailSaveState] =
    useState<DetailSaveState>("idle");
  const [detailStatusText, setDetailStatusText] = useState("");

  const [playlistPickerIds, setPlaylistPickerIds] = useState<
    string[] | null
  >(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [smartMinutes, setSmartMinutes] = useState(60);
  const [smartEnergy, setSmartEnergy] =
    useState<MusicEnergyLevel>("high");
  const [smartFavorites, setSmartFavorites] = useState(true);

  const detailTrack = useMemo(
    () => tracks.find((track) => track.id === detailTrackId) || null,
    [tracks, detailTrackId]
  );

  const detailSelectedCandidate = useMemo(
    () =>
      detailCandidates.find(
        (candidate) =>
          candidate.sourceId === detailSelectedCandidateId
      ) || null,
    [detailCandidates, detailSelectedCandidateId]
  );

  const detailDraft = detailTrack
    ? drafts[detailTrack.id] || null
    : null;

  const detailDirty = Boolean(
    detailTrack &&
      detailDraft &&
      (detailDraft.title.trim() !== detailTrack.title.trim() ||
        detailDraft.artist.trim() !==
          (detailTrack.artist || "").trim() ||
        detailDraft.album.trim() !==
          (detailTrack.album || "").trim() ||
        detailDraft.releaseYear.trim() !==
          (detailTrack.release_year
            ? String(detailTrack.release_year)
            : "") ||
        detailDraft.genre.trim() !==
          (detailTrack.genre || "").trim() ||
        detailPendingCandidate)
  );

  const totalSize = useMemo(
    () =>
      tracks.reduce(
        (sum, track) => sum + Number(track.file_size_bytes || 0),
        0
      ),
    [tracks]
  );

  const totalDuration = useMemo(
    () =>
      tracks.reduce(
        (sum, track) => sum + Number(track.duration_seconds || 0),
        0
      ),
    [tracks]
  );

  const needsInfoCount = useMemo(
    () => tracks.filter(needsMusicMetadata).length,
    [tracks]
  );

  const needsArtworkCount = useMemo(
    () => tracks.filter(needsMusicArtwork).length,
    [tracks]
  );

  const favoritesCount = useMemo(
    () => tracks.filter((track) => track.favorite).length,
    [tracks]
  );

  const artists = useMemo(
    () => groupTracks(tracks, artistLabel),
    [tracks]
  );

  const albums = useMemo(
    () => groupTracks(tracks, albumLabel),
    [tracks]
  );

  const selectedPlaylist = useMemo(
    () =>
      playlists.find(
        (playlist) => playlist.id === selectedPlaylistId
      ) || null,
    [playlists, selectedPlaylistId]
  );

  const selectedPlaylistIds = selectedPlaylistId
    ? playlistTrackIds[selectedPlaylistId] || []
    : [];

  const selectedPlaylistTracks = useMemo(() => {
    const byId = new Map(tracks.map((track) => [track.id, track]));
    return selectedPlaylistIds
      .map((id) => byId.get(id))
      .filter((track): track is MusicTrack => Boolean(track));
  }, [selectedPlaylistIds, tracks]);

  const filteredTracks = useMemo(() => {
    const query = search.trim().toLowerCase();

    let next = tracks.filter((track) => {
      if (
        query &&
        ![
          track.title,
          track.artist,
          track.album,
          track.genre,
          track.original_name,
        ]
          .filter(Boolean)
          .some((value) =>
            String(value).toLowerCase().includes(query)
          )
      ) {
        return false;
      }

      if (
        energyFilter !== "all" &&
        track.energy_level !== energyFilter
      ) {
        return false;
      }

      if (
        healthFilter === "needs" &&
        !needsMusicMetadata(track)
      ) {
        return false;
      }

      if (
        healthFilter === "artwork" &&
        !needsMusicArtwork(track)
      ) {
        return false;
      }

      if (
        healthFilter === "ready" &&
        (needsMusicMetadata(track) || needsMusicArtwork(track))
      ) {
        return false;
      }

      return true;
    });

    next = [...next].sort((left, right) => {
      if (sort === "title") return left.title.localeCompare(right.title);
      if (sort === "artist") {
        return artistLabel(left).localeCompare(artistLabel(right));
      }
      if (sort === "recent") {
        return (
          new Date(right.created_at).getTime() -
          new Date(left.created_at).getTime()
        );
      }
      if (sort === "plays") return right.play_count - left.play_count;
      return left.sort_order - right.sort_order;
    });

    return next;
  }, [tracks, search, energyFilter, healthFilter, sort]);

  const pageCount = Math.max(
    1,
    Math.ceil(filteredTracks.length / pageSize)
  );

  const visibleTracks = useMemo(() => {
    const safePage = Math.min(page, pageCount);
    const start = (safePage - 1) * pageSize;
    return filteredTracks.slice(start, start + pageSize);
  }, [filteredTracks, page, pageCount, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [search, sort, energyFilter, healthFilter, pageSize]);

  async function refreshTracks() {
    const rows = await listMusicTracks();
    setTracks(rows);
    setDrafts(buildDrafts(rows));
    replaceMusicLibrary(rows);
    return rows;
  }

  async function refreshPlaylists(preferredId?: string | null) {
    const rows = await listMusicPlaylists();
    const entries = await Promise.all(
      rows.map(async (playlist) => [
        playlist.id,
        (
          await listMusicPlaylistTrackLinks(playlist.id)
        ).map((link) => link.track_id),
      ])
    );

    setPlaylists(rows);
    setPlaylistTrackIds(Object.fromEntries(entries));

    setSelectedPlaylistId((current) => {
      if (
        preferredId &&
        rows.some((playlist) => playlist.id === preferredId)
      ) {
        return preferredId;
      }
      if (
        current &&
        rows.some((playlist) => playlist.id === current)
      ) {
        return current;
      }
      return rows[0]?.id || null;
    });
  }

  async function refreshAll() {
    setError("");
    try {
      await Promise.all([
        refreshTracks(),
        refreshPlaylists(),
        loadMusicLibrary(true),
      ]);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not load your music library."
      );
    }
  }

  useEffect(() => {
    void refreshAll();
  }, []);

  useEffect(() => {
    setPlaylistNameDraft(selectedPlaylist?.name || "");
  }, [selectedPlaylist?.id, selectedPlaylist?.name]);

  function replaceTrackLocally(updated: MusicTrack) {
    setTracks((current) => {
      const next = current.map((track) =>
        track.id === updated.id ? updated : track
      );
      replaceMusicLibrary(next);
      return next;
    });

    setDrafts((current) => ({
      ...current,
      [updated.id]: {
        title: updated.title,
        artist: updated.artist || "",
        album: updated.album || "",
        releaseYear: updated.release_year
          ? String(updated.release_year)
          : "",
        genre: updated.genre || "",
      },
    }));
  }

  function openDetail(track: MusicTrack) {
    setDetailTrackId(track.id);
    setDetailMode("edit");
    setDetailCandidates([]);
    setDetailSelectedCandidateId(null);
    setDetailPendingCandidate(null);
    setDetailSaveState("idle");
    setDetailStatusText("");
  }

  function closeDetail() {
    setDetailTrackId(null);
    setDetailMode("edit");
    setDetailCandidates([]);
    setDetailSelectedCandidateId(null);
    setDetailPendingCandidate(null);
    setDetailSaveState("idle");
    setDetailStatusText("");
  }

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

      await refreshTracks();
      setMessage(
        `${files.length} song${files.length === 1 ? "" : "s"} uploaded.`
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Music upload failed."
      );
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function toggleTrackPlayback(track: MusicTrack) {
    setError("");
    try {
      const isCurrent = player.currentTrack?.id === track.id;
      if (isCurrent && player.playing) {
        pauseMusic();
      } else if (isCurrent) {
        await playMusic();
      } else {
        activateAllMusicTracks();
        await playMusicTrack(track.id, 0);
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not control this song."
      );
    }
  }

  async function changePreference(
    track: MusicTrack,
    preference: "like" | "play_less" | "neutral"
  ) {
    try {
      const updated = await setPlayerMusicPreference(
        track.id,
        preference
      );
      replaceTrackLocally(updated);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not update song preference."
      );
    }
  }

  async function setEnergy(
    track: MusicTrack,
    energy: MusicEnergyLevel
  ) {
    try {
      const updated = await updateMusicTrack(track.id, {
        energy_level: energy,
      });
      replaceTrackLocally(updated);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not update energy."
      );
    }
  }

  async function saveTrack(track: MusicTrack) {
    const draft = drafts[track.id];
    if (!draft || detailSaveState === "saving") return;

    setBusyId(track.id);
    setError("");
    setDetailSaveState("saving");
    setDetailStatusText("Saving changes to your library…");

    try {
      let updated = await updateMusicTrack(track.id, {
        title: draft.title,
        artist: draft.artist,
        album: draft.album,
        release_year: draft.releaseYear
          ? Number(draft.releaseYear)
          : null,
        genre: draft.genre,
        metadata_status: "manual",
        metadata_confidence: 1,
        metadata_source:
          detailPendingCandidate?.source || "manual",
        metadata_updated_at: new Date().toISOString(),
      });

      if (
        detailPendingCandidate?.artworkUrl &&
        needsMusicArtwork(updated)
      ) {
        updated = await uploadRemoteMusicArtwork(
          updated,
          detailPendingCandidate.artworkUrl
        );
      }

      replaceTrackLocally(updated);
      setDetailPendingCandidate(null);
      setDetailSaveState("changed");
      setDetailStatusText("✓ CHANGED • SAVED TO LIBRARY");

      window.setTimeout(() => {
        setDetailTrackId((current) =>
          current === track.id ? null : current
        );
      }, 1100);
    } catch (caught) {
      setDetailSaveState("error");
      setDetailStatusText(
        caught instanceof Error
          ? caught.message
          : "Could not save this song."
      );
    } finally {
      setBusyId(null);
    }
  }

  async function deleteTrack(track: MusicTrack) {
    if (!window.confirm(`Delete “${track.title}” from MVP Trainer?`)) {
      return;
    }

    setBusyId(track.id);
    try {
      await removeMusicTrack(track.id);
      if (detailTrackId === track.id) closeDetail();
      await refreshTracks();
      setMessage("Song removed.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not delete this song."
      );
    } finally {
      setBusyId(null);
    }
  }

  async function replaceArtwork(
    track: MusicTrack,
    file: File | null
  ) {
    if (!file) return;
    setBusyId(track.id);
    setDetailStatusText("Uploading artwork…");

    try {
      const updated = await uploadMusicArtwork(track, file);
      replaceTrackLocally(updated);
      setDetailStatusText("Artwork updated.");
    } catch (caught) {
      setDetailSaveState("error");
      setDetailStatusText(
        caught instanceof Error
          ? caught.message
          : "Could not upload artwork."
      );
    } finally {
      setBusyId(null);
      if (artworkInputRef.current) artworkInputRef.current.value = "";
    }
  }

  async function clearArtwork(track: MusicTrack) {
    setBusyId(track.id);
    try {
      const updated = await removeMusicArtwork(track);
      replaceTrackLocally(updated);
      setDetailStatusText("Artwork removed.");
    } catch (caught) {
      setDetailSaveState("error");
      setDetailStatusText(
        caught instanceof Error
          ? caught.message
          : "Could not remove artwork."
      );
    } finally {
      setBusyId(null);
    }
  }

  async function findDetailMatches(
    track: MusicTrack,
    mode: "info_results" | "artwork_results"
  ) {
    setDetailSaveState("searching");
    setDetailStatusText(
      mode === "artwork_results"
        ? "Searching music catalogs for artwork…"
        : "Searching music catalogs for the exact recording…"
    );
    setDetailCandidates([]);
    setDetailSelectedCandidateId(null);
    setDetailMode(mode);

    try {
      const candidates = await findMusicMetadataCandidates(track);
      setDetailCandidates(candidates);
      setDetailSelectedCandidateId(
        candidates[0]?.sourceId || null
      );
      setDetailSaveState("idle");

      if (!candidates.length) {
        setDetailStatusText(
          "No reliable matches found. Edit the title or artist, then search again."
        );
      } else {
        const top = candidates[0];
        setDetailStatusText(
          `${candidates.length} match${
            candidates.length === 1 ? "" : "es"
          } found • Best result ${Math.round(
            top.confidence * 100
          )}%`
        );
      }
    } catch (caught) {
      setDetailSaveState("error");
      setDetailStatusText(
        caught instanceof Error
          ? caught.message
          : "Music lookup failed."
      );
    }
  }

  async function useDetailCandidate() {
    if (!detailTrack || !detailSelectedCandidate) return;

    if (detailMode === "artwork_results") {
      if (!detailSelectedCandidate.artworkUrl) {
        setDetailStatusText("That result has no usable artwork.");
        return;
      }

      setDetailSaveState("saving");
      setDetailStatusText("Applying artwork…");

      try {
        const updated = await uploadRemoteMusicArtwork(
          detailTrack,
          detailSelectedCandidate.artworkUrl
        );
        replaceTrackLocally(updated);
        setDetailMode("edit");
        setDetailSaveState("changed");
        setDetailStatusText("✓ ARTWORK CHANGED");
        window.setTimeout(() => {
          setDetailSaveState("idle");
          setDetailStatusText("");
        }, 1400);
      } catch (caught) {
        setDetailSaveState("error");
        setDetailStatusText(
          caught instanceof Error
            ? caught.message
            : "Could not apply artwork."
        );
      }
      return;
    }

    const candidate = detailSelectedCandidate;
    setDrafts((current) => ({
      ...current,
      [detailTrack.id]: {
        title: candidate.title,
        artist: candidate.artist,
        album: candidate.album,
        releaseYear: candidate.releaseYear
          ? String(candidate.releaseYear)
          : "",
        genre: candidate.genre || "",
      },
    }));

    setDetailPendingCandidate(candidate);
    setDetailMode("edit");
    setDetailSaveState("idle");
    setDetailStatusText(
      `Match loaded • ${musicMatchTier(
        candidate.confidence
      )} • Review it, then SAVE CHANGES.`
    );
  }

  async function moveTrack(trackId: string, direction: -1 | 1) {
    const index = tracks.findIndex((track) => track.id === trackId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= tracks.length) return;

    const next = [...tracks];
    [next[index], next[target]] = [next[target], next[index]];
    setTracks(next);
    replaceMusicLibrary(next);

    try {
      await saveMusicTrackOrder(next);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not save the song order."
      );
      await refreshTracks();
    }
  }

  function toggleSelected(trackId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  }

  function selectVisible() {
    setSelectedIds((current) => {
      const next = new Set(current);
      const allSelected = visibleTracks.every((track) =>
        next.has(track.id)
      );

      for (const track of visibleTracks) {
        if (allSelected) next.delete(track.id);
        else next.add(track.id);
      }
      return next;
    });
  }

  async function enrichSelected(artworkOnly = false) {
    const chosen = tracks.filter((track) =>
      selectedIds.has(track.id)
    );
    if (!chosen.length) return;

    setBulkBusy(true);
    setError("");
    setMessage("");

    try {
      let changed = 0;
      let review = 0;

      for (let index = 0; index < chosen.length; index += 1) {
        const track = chosen[index];
        setMessage(
          `${artworkOnly ? "Finding artwork" : "Finding song info"} • ${
            index + 1
          } / ${chosen.length} • ${track.title}`
        );

        const result = await enrichMusicTrack(track, {
          artworkOnly,
          autoApplyThreshold: 0.955,
        });

        if (result.changed) changed += 1;
        if (result.status === "review") review += 1;
        await delayMusicLookup();
      }

      await refreshTracks();
      setMessage(
        `${changed} updated • ${review} need review. ${
          review
            ? "Use NEEDS INFO to inspect the remaining matches."
            : ""
        }`
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not finish music lookup."
      );
    } finally {
      setBulkBusy(false);
    }
  }

  async function createPlaylist() {
    try {
      const created = await createMusicPlaylist(newPlaylistName);
      setNewPlaylistName("");
      await refreshPlaylists(created.id);
      setTab("playlists");
      setMessage("Playlist created.");
      window.dispatchEvent(new Event("mvp:music-playlists-changed"));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not create playlist."
      );
    }
  }

  async function savePlaylistName() {
    if (!selectedPlaylist) return;

    try {
      await renameMusicPlaylist(
        selectedPlaylist.id,
        playlistNameDraft
      );
      await refreshPlaylists(selectedPlaylist.id);
      setMessage("Playlist name saved.");
      window.dispatchEvent(new Event("mvp:music-playlists-changed"));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not rename playlist."
      );
    }
  }

  async function removePlaylist() {
    if (!selectedPlaylist) return;
    if (
      !window.confirm(
        `Delete playlist “${selectedPlaylist.name}”? Your songs will remain in My Music.`
      )
    ) {
      return;
    }

    try {
      await deleteMusicPlaylist(selectedPlaylist.id);
      if (player.activePlaylistId === selectedPlaylist.id) {
        activateAllMusicTracks();
      }
      await refreshPlaylists(null);
      setMessage("Playlist deleted. Songs were not deleted.");
      window.dispatchEvent(new Event("mvp:music-playlists-changed"));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not delete playlist."
      );
    }
  }

  async function savePlaylistIds(
    playlist: MusicPlaylist,
    nextIds: string[],
    success: string
  ) {
    const previous = playlistTrackIds[playlist.id] || [];
    setPlaylistTrackIds((current) => ({
      ...current,
      [playlist.id]: nextIds,
    }));

    try {
      await replaceMusicPlaylistTracks(playlist.id, nextIds);

      if (player.activePlaylistId === playlist.id) {
        const byId = new Map(
          tracks.map((track) => [track.id, track])
        );
        activateMusicPlaylistQueue(
          playlist,
          nextIds
            .map((id) => byId.get(id))
            .filter((track): track is MusicTrack => Boolean(track))
        );
      }

      setMessage(success);
      window.dispatchEvent(new Event("mvp:music-playlists-changed"));
    } catch (caught) {
      setPlaylistTrackIds((current) => ({
        ...current,
        [playlist.id]: previous,
      }));
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not save playlist."
      );
    }
  }

  async function addToPlaylist(
    playlist: MusicPlaylist,
    ids: string[]
  ) {
    const existing = playlistTrackIds[playlist.id] || [];
    await savePlaylistIds(
      playlist,
      [...new Set([...existing, ...ids])],
      `${ids.length} song${ids.length === 1 ? "" : "s"} added to ${
        playlist.name
      }.`
    );
    setPlaylistPickerIds(null);
  }

  async function removePlaylistSong(trackId: string) {
    if (!selectedPlaylist) return;
    await savePlaylistIds(
      selectedPlaylist,
      selectedPlaylistIds.filter((id) => id !== trackId),
      "Song removed from playlist."
    );
  }

  async function movePlaylistSong(index: number, direction: -1 | 1) {
    if (!selectedPlaylist) return;
    const target = index + direction;
    if (
      target < 0 ||
      target >= selectedPlaylistIds.length
    ) {
      return;
    }

    const next = [...selectedPlaylistIds];
    [next[index], next[target]] = [next[target], next[index]];
    await savePlaylistIds(
      selectedPlaylist,
      next,
      "Playlist order saved."
    );
  }

  async function playSelectedPlaylist(trackId?: string) {
    if (!selectedPlaylist || !selectedPlaylistTracks.length) return;
    try {
      await playMusicPlaylist(
        selectedPlaylist,
        selectedPlaylistTracks,
        trackId
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not play playlist."
      );
    }
  }

  function buildSmartMix() {
    const targetSeconds = Math.max(15, smartMinutes) * 60;

    const ranked = [...tracks].sort((left, right) => {
      const score = (track: MusicTrack) => {
        let value = 0;
        if (track.energy_level === smartEnergy) value += 10;
        if (track.favorite && smartFavorites) value += 8;
        if (track.play_less) value -= 9;
        value += Math.min(6, track.play_count / 5);
        value -= Math.min(4, track.skip_count / 3);
        return value;
      };
      return score(right) - score(left);
    });

    const selected: MusicTrack[] = [];
    let seconds = 0;
    let lastArtist = "";

    while (ranked.length && seconds < targetSeconds) {
      let index = ranked.findIndex((track) => {
        const artist = artistLabel(track).toLowerCase();
        return artist !== lastArtist;
      });

      if (index < 0) index = 0;
      const [track] = ranked.splice(index, 1);
      if (!track) break;

      selected.push(track);
      seconds += track.duration_seconds || 210;
      lastArtist = artistLabel(track).toLowerCase();
    }

    return selected;
  }

  async function playSmartMix() {
    const mix = buildSmartMix();
    if (!mix.length) return;
    await playMusicAdHocQueue(
      `Smart Mix • ${smartMinutes} min`,
      mix
    );
  }

  function goBack() {
    if (navigate) navigate("/");
    else window.location.pathname = "/";
  }

  const smartPreview = buildSmartMix();

  return (
    <main className="tr12-musicPage">
      <section className="tr12-hero">
        <div>
          <span>MVP TRAINER • PRIVATE AUDIO LIBRARY</span>
          <h1>My Music</h1>
          <p>
            Your workout library, playlists, Smart Mix, metadata,
            artwork and playback controls in one place.
          </p>
        </div>
        <button type="button" onClick={goBack}>
          BACK TO TRAINER
        </button>
      </section>

      <section className="tr12-stats">
        <div>
          <strong>{tracks.length}</strong>
          <span>SONGS</span>
        </div>
        <div>
          <strong>{artists.length}</strong>
          <span>ARTISTS</span>
        </div>
        <div>
          <strong>{formatLongDuration(totalDuration)}</strong>
          <span>PLAY TIME</span>
        </div>
        <div>
          <strong>{favoritesCount}</strong>
          <span>LIKED</span>
        </div>
        <div className={needsInfoCount ? "is-alert" : ""}>
          <strong>{needsInfoCount}</strong>
          <span>NEEDS INFO</span>
        </div>
      </section>

      <section className="tr12-libraryShell">
        <header className="tr12-sectionHead">
          <div>
            <span>MUSIC CONTROL CENTER</span>
            <h2>Your Library</h2>
          </div>
          <div className="tr12-headActions">
            <input
              ref={inputRef}
              hidden
              type="file"
              multiple
              accept=".mp3,.m4a,.wav,audio/*"
              onChange={(event) =>
                void uploadFiles(event.target.files)
              }
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? "UPLOADING…" : "+ ADD MUSIC"}
            </button>
            <button
              type="button"
              className={
                needsInfoCount ? "is-needsAction" : ""
              }
              onClick={() => {
                setTab("songs");
                setHealthFilter("needs");
              }}
            >
              NEEDS INFO {needsInfoCount ? `(${needsInfoCount})` : ""}
            </button>
          </div>
        </header>

        <nav className="tr12-tabs">
          {(
            [
              ["songs", "SONGS"],
              ["artists", "ARTISTS"],
              ["albums", "ALBUMS"],
              ["playlists", "PLAYLISTS"],
              ["smart", "SMART MIX"],
            ] as Array<[MusicTab, string]>
          ).map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={tab === value ? "is-active" : ""}
              onClick={() => setTab(value)}
            >
              {label}
            </button>
          ))}
        </nav>

        {message ? <div className="tr12-message">{message}</div> : null}
        {error ? <div className="tr12-error">{error}</div> : null}

        {tab === "songs" ? (
          <>
            <div className="tr12-toolbar">
              <label className="tr12-search">
                <span>SEARCH</span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Song, artist, album, genre…"
                />
              </label>

              <label>
                <span>SORT</span>
                <select
                  value={sort}
                  onChange={(event) =>
                    setSort(event.target.value as SongSort)
                  }
                >
                  <option value="library">Library order</option>
                  <option value="title">Title</option>
                  <option value="artist">Artist</option>
                  <option value="recent">Newest</option>
                  <option value="plays">Most played</option>
                </select>
              </label>

              <label>
                <span>ENERGY</span>
                <select
                  value={energyFilter}
                  onChange={(event) =>
                    setEnergyFilter(
                      event.target.value as EnergyFilter
                    )
                  }
                >
                  <option value="all">All energy</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </label>

              <label>
                <span>HEALTH</span>
                <select
                  value={healthFilter}
                  onChange={(event) =>
                    setHealthFilter(
                      event.target.value as HealthFilter
                    )
                  }
                >
                  <option value="all">All songs</option>
                  <option value="needs">Needs info</option>
                  <option value="artwork">Missing artwork</option>
                  <option value="ready">Complete</option>
                </select>
              </label>

              <label>
                <span>SHOW</span>
                <select
                  value={pageSize}
                  onChange={(event) =>
                    setPageSize(
                      Number(event.target.value) as PageSize
                    )
                  }
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>
            </div>

            {selectedIds.size ? (
              <div className="tr12-bulk">
                <strong>{selectedIds.size} SELECTED</strong>
                <div>
                  <button
                    type="button"
                    disabled={bulkBusy}
                    onClick={() => void enrichSelected(false)}
                  >
                    FIND SONG INFO
                  </button>
                  <button
                    type="button"
                    disabled={bulkBusy}
                    onClick={() => void enrichSelected(true)}
                  >
                    FIND ARTWORK
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setPlaylistPickerIds([...selectedIds])
                    }
                  >
                    + PLAYLIST
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedIds(new Set())}
                  >
                    CLEAR
                  </button>
                </div>
              </div>
            ) : null}

            <div className="tr12-table">
              <div className="tr12-tableHead">
                <button
                  type="button"
                  onClick={selectVisible}
                  aria-label="Select visible songs"
                >
                  ✓
                </button>
                <span>SONG</span>
                <span>TIME</span>
                <span>ENERGY</span>
                <span>ACTIONS</span>
              </div>

              {visibleTracks.map((track) => {
                const playing =
                  player.currentTrack?.id === track.id &&
                  player.playing;
                const selected = selectedIds.has(track.id);
                const needsInfo = needsMusicMetadata(track);
                const missingArt = needsMusicArtwork(track);

                return (
                  <article
                    className={`tr12-row ${
                      player.currentTrack?.id === track.id
                        ? "is-current"
                        : ""
                    }`}
                    key={track.id}
                  >
                    <button
                      type="button"
                      className={`tr12-check ${
                        selected ? "is-selected" : ""
                      }`}
                      onClick={() => toggleSelected(track.id)}
                    >
                      {selected ? "✓" : ""}
                    </button>

                    <div className="tr12-track">
                      <button
                        type="button"
                        className={`tr12-play ${
                          playing ? "is-playing" : ""
                        }`}
                        onClick={() =>
                          void toggleTrackPlayback(track)
                        }
                      >
                        {playing ? "Ⅱ" : "▶"}
                      </button>
                      <TrackArtwork track={track} />
                      <div>
                        <strong>{track.title}</strong>
                        <span>
                          {artistLabel(track)}
                          {track.album ? ` • ${track.album}` : ""}
                        </span>
                      </div>
                      {needsInfo || missingArt ? (
                        <em
                          className={`tr12-health ${
                            needsInfo ? "is-needs" : "is-art"
                          }`}
                        >
                          {needsInfo
                            ? "NEEDS INFO"
                            : "MISSING ART"}
                        </em>
                      ) : null}
                    </div>

                    <span className="tr12-duration">
                      {formatDuration(track.duration_seconds)}
                    </span>

                    <button
                      type="button"
                      className={`tr12-energy is-${track.energy_level}`}
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
                      title="Click to change energy"
                    >
                      <i />
                      <span>{track.energy_level.toUpperCase()}</span>
                      <b>
                        {track.energy_level === "high"
                          ? "III"
                          : track.energy_level === "medium"
                            ? "II"
                            : "I"}
                      </b>
                    </button>

                    <div className="tr12-actions">
                      <button
                        type="button"
                        className={track.favorite ? "is-liked" : ""}
                        onClick={() =>
                          void changePreference(
                            track,
                            track.favorite ? "neutral" : "like"
                          )
                        }
                        title="Like"
                      >
                        ♥
                      </button>
                      <button
                        type="button"
                        className={track.play_less ? "is-down" : ""}
                        onClick={() =>
                          void changePreference(
                            track,
                            track.play_less
                              ? "neutral"
                              : "play_less"
                          )
                        }
                        title="Play less"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => playMusicNext(track.id)}
                      >
                        PLAY NEXT
                      </button>
                      <button
                        type="button"
                        onClick={() => addMusicToQueue(track.id)}
                      >
                        + QUEUE
                      </button>
                      <button
                        type="button"
                        className="is-more"
                        onClick={() => openDetail(track)}
                      >
                        •••
                      </button>
                    </div>

                    <div className="tr12-orderTools">
                      <button
                        type="button"
                        disabled={
                          tracks.findIndex(
                            (item) => item.id === track.id
                          ) === 0
                        }
                        onClick={() =>
                          void moveTrack(track.id, -1)
                        }
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={
                          tracks.findIndex(
                            (item) => item.id === track.id
                          ) ===
                          tracks.length - 1
                        }
                        onClick={() =>
                          void moveTrack(track.id, 1)
                        }
                      >
                        ↓
                      </button>
                    </div>
                  </article>
                );
              })}

              {!visibleTracks.length ? (
                <div className="tr12-empty">
                  No songs match these filters.
                </div>
              ) : null}
            </div>

            <div className="tr12-pager">
              <span>
                {filteredTracks.length
                  ? `${(Math.min(page, pageCount) - 1) * pageSize + 1}–${Math.min(
                      Math.min(page, pageCount) * pageSize,
                      filteredTracks.length
                    )} OF ${filteredTracks.length}`
                  : "0 SONGS"}
              </span>
              <div>
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() =>
                    setPage((current) => Math.max(1, current - 1))
                  }
                >
                  PREV
                </button>
                <b>
                  {Math.min(page, pageCount)} / {pageCount}
                </b>
                <button
                  type="button"
                  disabled={page >= pageCount}
                  onClick={() =>
                    setPage((current) =>
                      Math.min(pageCount, current + 1)
                    )
                  }
                >
                  NEXT
                </button>
              </div>
            </div>
          </>
        ) : null}

        {tab === "artists" ? (
          <div className="tr12-cardGrid">
            {artists.map((group) => (
              <article className="tr12-collectionCard" key={group.name}>
                <TrackArtwork track={group.songs[0]} size="card" />
                <div>
                  <small>ARTIST</small>
                  <h3>{group.name}</h3>
                  <p>
                    {group.songs.length} SONG
                    {group.songs.length === 1 ? "" : "S"} •{" "}
                    {formatLongDuration(group.duration)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    void playMusicAdHocQueue(
                      group.name,
                      group.songs
                    )
                  }
                >
                  ▶ PLAY
                </button>
              </article>
            ))}
          </div>
        ) : null}

        {tab === "albums" ? (
          <div className="tr12-cardGrid">
            {albums.map((group) => (
              <article className="tr12-collectionCard" key={group.name}>
                <TrackArtwork track={group.songs[0]} size="card" />
                <div>
                  <small>ALBUM</small>
                  <h3>{group.name}</h3>
                  <p>
                    {group.songs.length} SONG
                    {group.songs.length === 1 ? "" : "S"} •{" "}
                    {formatLongDuration(group.duration)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    void playMusicAdHocQueue(
                      group.name,
                      group.songs
                    )
                  }
                >
                  ▶ PLAY
                </button>
              </article>
            ))}
          </div>
        ) : null}

        {tab === "playlists" ? (
          <div className="tr12-playlistLayout">
            <aside>
              <div className="tr12-createPlaylist">
                <input
                  value={newPlaylistName}
                  onChange={(event) =>
                    setNewPlaylistName(event.target.value)
                  }
                  placeholder="New playlist"
                />
                <button
                  type="button"
                  onClick={() => void createPlaylist()}
                >
                  +
                </button>
              </div>

              {playlists.map((playlist) => (
                <button
                  type="button"
                  key={playlist.id}
                  className={
                    selectedPlaylistId === playlist.id
                      ? "is-active"
                      : ""
                  }
                  onClick={() =>
                    setSelectedPlaylistId(playlist.id)
                  }
                >
                  <strong>{playlist.name}</strong>
                  <span>
                    {(playlistTrackIds[playlist.id] || []).length} SONGS
                  </span>
                </button>
              ))}
            </aside>

            <section className="tr12-playlistConsole">
              {selectedPlaylist ? (
                <>
                  <header>
                    <div>
                      <small>PLAYLIST</small>
                      <input
                        value={playlistNameDraft}
                        onChange={(event) =>
                          setPlaylistNameDraft(event.target.value)
                        }
                      />
                    </div>
                    <div>
                      <button
                        type="button"
                        onClick={() => void savePlaylistName()}
                      >
                        SAVE NAME
                      </button>
                      <button
                        type="button"
                        className="is-primary"
                        disabled={!selectedPlaylistTracks.length}
                        onClick={() =>
                          void playSelectedPlaylist()
                        }
                      >
                        ▶ PLAY
                      </button>
                      <button
                        type="button"
                        className="is-danger"
                        onClick={() => void removePlaylist()}
                      >
                        DELETE
                      </button>
                    </div>
                  </header>

                  <div className="tr12-playlistSongs">
                    {selectedPlaylistTracks.map((track, index) => (
                      <article key={track.id}>
                        <b>
                          {String(index + 1).padStart(2, "0")}
                        </b>
                        <TrackArtwork track={track} />
                        <div>
                          <strong>{track.title}</strong>
                          <span>{artistLabel(track)}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            void playSelectedPlaylist(track.id)
                          }
                        >
                          ▶
                        </button>
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() =>
                            void movePlaylistSong(index, -1)
                          }
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          disabled={
                            index ===
                            selectedPlaylistTracks.length - 1
                          }
                          onClick={() =>
                            void movePlaylistSong(index, 1)
                          }
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="is-danger"
                          onClick={() =>
                            void removePlaylistSong(track.id)
                          }
                        >
                          REMOVE
                        </button>
                      </article>
                    ))}

                    {!selectedPlaylistTracks.length ? (
                      <div className="tr12-empty">
                        Add songs from your library.
                      </div>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    className="tr12-addSelected"
                    disabled={!selectedIds.size}
                    onClick={() =>
                      setPlaylistPickerIds([...selectedIds])
                    }
                  >
                    + ADD {selectedIds.size || ""} SELECTED SONGS
                  </button>
                </>
              ) : (
                <div className="tr12-empty">
                  Create a playlist to get started.
                </div>
              )}
            </section>
          </div>
        ) : null}

        {tab === "smart" ? (
          <div className="tr12-smart">
            <section className="tr12-smartBuilder">
              <small>SMART WORKOUT MIX</small>
              <h2>Build a workout-length queue</h2>
              <p>
                Prioritizes your energy target, likes and playback
                history while reducing repeated artists.
              </p>

              <div className="tr12-smartGrid">
                <label>
                  <span>WORKOUT LENGTH</span>
                  <input
                    type="number"
                    min={15}
                    max={240}
                    step={5}
                    value={smartMinutes}
                    onChange={(event) =>
                      setSmartMinutes(
                        Math.max(
                          15,
                          Math.min(240, Number(event.target.value) || 60)
                        )
                      )
                    }
                  />
                  <b>MINUTES</b>
                </label>

                <label>
                  <span>ENERGY TARGET</span>
                  <select
                    value={smartEnergy}
                    onChange={(event) =>
                      setSmartEnergy(
                        event.target.value as MusicEnergyLevel
                      )
                    }
                  >
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </label>

                <label className="tr12-toggle">
                  <span>FAVOR LIKED SONGS</span>
                  <button
                    type="button"
                    className={smartFavorites ? "is-on" : ""}
                    onClick={() =>
                      setSmartFavorites((current) => !current)
                    }
                  >
                    {smartFavorites ? "YES" : "NO"}
                  </button>
                </label>
              </div>

              <button
                type="button"
                className="tr12-smartLaunch"
                disabled={!smartPreview.length}
                onClick={() => void playSmartMix()}
              >
                ▶ START SMART MIX • {smartPreview.length} SONGS
              </button>
            </section>

            <section className="tr12-smartPreview">
              <header>
                <span>PREVIEW</span>
                <b>{formatLongDuration(
                  smartPreview.reduce(
                    (sum, track) =>
                      sum + Number(track.duration_seconds || 210),
                    0
                  )
                )}</b>
              </header>
              {smartPreview.slice(0, 14).map((track, index) => (
                <div key={track.id}>
                  <b>{String(index + 1).padStart(2, "0")}</b>
                  <span>
                    <strong>{track.title}</strong>
                    <small>{artistLabel(track)}</small>
                  </span>
                  <em>{track.energy_level.toUpperCase()}</em>
                </div>
              ))}
            </section>
          </div>
        ) : null}
      </section>

      <section className="tr12-footerStats">
        <span>{formatFileSize(totalSize)} STORED</span>
        <span>{needsArtworkCount} MISSING ARTWORK</span>
        <span>{playlists.length} PLAYLISTS</span>
      </section>

      {detailTrack ? (
        <div
          className="tr12-modalBack"
          onMouseDown={closeDetail}
        >
          <section
            className="tr12-inspector"
            role="dialog"
            aria-modal="true"
            onMouseDown={(event: MouseEvent<HTMLElement>) =>
              event.stopPropagation()
            }
          >
            <header className="tr12-inspectorHead">
              <div className="tr12-inspectIdentity">
                <TrackArtwork track={detailTrack} size="detail" />
                <div>
                  <span>SONG CONTROL</span>
                  <h2>{detailTrack.title}</h2>
                  <p>{artistLabel(detailTrack)}</p>
                  {detailMode === "edit" ? (
                    <small
                      className={`tr12-editState ${
                        detailSaveState === "changed"
                          ? "is-changed"
                          : detailDirty
                            ? "is-dirty"
                            : ""
                      }`}
                    >
                      {detailSaveState === "saving"
                        ? "SAVING…"
                        : detailSaveState === "changed"
                          ? "✓ CHANGED"
                          : detailDirty
                            ? "UNSAVED CHANGES"
                            : "LIBRARY RECORD"}
                    </small>
                  ) : null}
                </div>
              </div>

              <button type="button" onClick={closeDetail}>
                ×
              </button>
            </header>

            {detailMode === "edit" ? (
              <>
                <div className="tr12-inspectorBody">
                  <div className="tr12-inspectCommands">
                    <button
                      type="button"
                      disabled={detailSaveState === "searching"}
                      onClick={() =>
                        void findDetailMatches(
                          detailTrack,
                          "info_results"
                        )
                      }
                    >
                      {detailSaveState === "searching"
                        ? "SEARCHING…"
                        : "FIND SONG INFO"}
                    </button>
                    <button
                      type="button"
                      disabled={detailSaveState === "searching"}
                      onClick={() =>
                        void findDetailMatches(
                          detailTrack,
                          "artwork_results"
                        )
                      }
                    >
                      FIND ARTWORK
                    </button>
                    <button
                      type="button"
                      onClick={() => playMusicNext(detailTrack.id)}
                    >
                      PLAY NEXT
                    </button>
                    <button
                      type="button"
                      onClick={() => addMusicToQueue(detailTrack.id)}
                    >
                      ADD TO QUEUE
                    </button>
                    <button
                      type="button"
                      className={
                        detailTrack.favorite ? "is-liked" : ""
                      }
                      onClick={() =>
                        void changePreference(
                          detailTrack,
                          detailTrack.favorite
                            ? "neutral"
                            : "like"
                        )
                      }
                    >
                      ♥ {detailTrack.favorite ? "LIKED" : "LIKE"}
                    </button>
                    <button
                      type="button"
                      className={
                        detailTrack.play_less ? "is-down" : ""
                      }
                      onClick={() =>
                        void changePreference(
                          detailTrack,
                          detailTrack.play_less
                            ? "neutral"
                            : "play_less"
                        )
                      }
                    >
                      ↓ PLAY LESS
                    </button>
                  </div>

                  {detailStatusText ? (
                    <div
                      className={`tr12-modalStatus ${
                        detailSaveState === "error"
                          ? "is-error"
                          : detailSaveState === "changed"
                            ? "is-changed"
                            : ""
                      }`}
                    >
                      {detailStatusText}
                    </div>
                  ) : null}

                  <div className="tr12-inspectGrid">
                    <label>
                      <span>TITLE</span>
                      <input
                        value={drafts[detailTrack.id]?.title || ""}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [detailTrack.id]: {
                              ...current[detailTrack.id],
                              title: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>ARTIST</span>
                      <input
                        value={drafts[detailTrack.id]?.artist || ""}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [detailTrack.id]: {
                              ...current[detailTrack.id],
                              artist: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>ALBUM</span>
                      <input
                        value={drafts[detailTrack.id]?.album || ""}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [detailTrack.id]: {
                              ...current[detailTrack.id],
                              album: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>YEAR</span>
                      <input
                        inputMode="numeric"
                        value={
                          drafts[detailTrack.id]?.releaseYear || ""
                        }
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [detailTrack.id]: {
                              ...current[detailTrack.id],
                              releaseYear: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>GENRE</span>
                      <input
                        value={drafts[detailTrack.id]?.genre || ""}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [detailTrack.id]: {
                              ...current[detailTrack.id],
                              genre: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>

                    <div className="tr12-artControls">
                      <input
                        ref={artworkInputRef}
                        hidden
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(event) =>
                          void replaceArtwork(
                            detailTrack,
                            event.target.files?.[0] || null
                          )
                        }
                      />
                      <span>ARTWORK</span>
                      <button
                        type="button"
                        onClick={() =>
                          artworkInputRef.current?.click()
                        }
                      >
                        {needsMusicArtwork(detailTrack)
                          ? "+ ADD"
                          : "REPLACE"}
                      </button>
                      {!needsMusicArtwork(detailTrack) ? (
                        <button
                          type="button"
                          className="is-danger"
                          onClick={() =>
                            void clearArtwork(detailTrack)
                          }
                        >
                          REMOVE
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <dl className="tr12-meta">
                    <div>
                      <dt>PLAYS</dt>
                      <dd>{detailTrack.play_count}</dd>
                    </div>
                    <div>
                      <dt>COMPLETED</dt>
                      <dd>{detailTrack.completed_play_count}</dd>
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
                      <dt>MATCH</dt>
                      <dd>{detailTrack.metadata_status.toUpperCase()}</dd>
                    </div>
                    <div>
                      <dt>FILE</dt>
                      <dd title={detailTrack.original_name}>
                        {detailTrack.original_name}
                      </dd>
                    </div>
                  </dl>
                </div>

                <footer className="tr12-inspectorFooter">
                  <button
                    type="button"
                    onClick={() =>
                      setPlaylistPickerIds([detailTrack.id])
                    }
                  >
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
                    className={`is-primary tr12-saveButton ${
                      detailSaveState === "changed"
                        ? "is-changed"
                        : ""
                    }`}
                    disabled={
                      !detailDirty ||
                      detailSaveState === "saving" ||
                      detailSaveState === "changed"
                    }
                    onClick={() => void saveTrack(detailTrack)}
                  >
                    {detailSaveState === "saving"
                      ? "SAVING…"
                      : detailSaveState === "changed"
                        ? "✓ CHANGED"
                        : "SAVE CHANGES"}
                  </button>
                </footer>
              </>
            ) : (
              <>
                <div className="tr12-lookupBody">
                  <div className="tr12-lookupHead">
                    <button
                      type="button"
                      onClick={() => {
                        setDetailMode("edit");
                        setDetailSelectedCandidateId(null);
                      }}
                    >
                      ← BACK TO SONG
                    </button>
                    <div>
                      <span>
                        {detailMode === "artwork_results"
                          ? "ARTWORK RESULTS"
                          : "SONG MATCH RESULTS"}
                      </span>
                      <h3>
                        {detailMode === "artwork_results"
                          ? "Choose the correct cover"
                          : "Choose the correct recording"}
                      </h3>
                      <p>{detailStatusText}</p>
                    </div>
                  </div>

                  {detailSaveState === "searching" ? (
                    <div className="tr12-searching">
                      <i />
                      <strong>SEARCHING MUSIC CATALOGS</strong>
                      <span>
                        Checking title, artist, filename variants and
                        recording duration…
                      </span>
                    </div>
                  ) : null}

                  <div
                    className={`tr12-detailCandidates ${
                      detailMode === "artwork_results"
                        ? "is-artwork"
                        : ""
                    }`}
                  >
                    {detailCandidates.map((candidate) => {
                      const selected =
                        detailSelectedCandidateId ===
                        candidate.sourceId;

                      return (
                        <button
                          type="button"
                          key={candidate.sourceId}
                          className={selected ? "is-selected" : ""}
                          onClick={() =>
                            setDetailSelectedCandidateId(
                              candidate.sourceId
                            )
                          }
                        >
                          {candidate.artworkUrl ? (
                            <img src={candidate.artworkUrl} alt="" />
                          ) : (
                            <span className="tr12-candidateArt">
                              ♫
                            </span>
                          )}

                          <div>
                            <strong>{candidate.title}</strong>
                            <span>{candidate.artist}</span>
                            <small>
                              {candidate.album || "Unknown album"}
                              {candidate.releaseYear
                                ? ` • ${candidate.releaseYear}`
                                : ""}
                              {candidate.durationSeconds
                                ? ` • ${formatDuration(
                                    candidate.durationSeconds
                                  )}`
                                : ""}
                            </small>
                          </div>

                          <em
                            className={`tr12-matchTier ${matchClass(
                              candidate.confidence
                            )}`}
                          >
                            <b>
                              {Math.round(
                                candidate.confidence * 100
                              )}
                              %
                            </b>
                            {musicMatchTier(candidate.confidence)}
                          </em>

                          <i className="tr12-selectMark">
                            {selected ? "✓" : ""}
                          </i>
                        </button>
                      );
                    })}
                  </div>

                  {!detailCandidates.length &&
                  detailSaveState !== "searching" ? (
                    <div className="tr12-empty">
                      No matches to show. Go back, correct the title or
                      artist if needed, then search again.
                    </div>
                  ) : null}
                </div>

                <footer className="tr12-lookupFooter">
                  <div>
                    <span>
                      {detailSelectedCandidate
                        ? `${detailSelectedCandidate.title} • ${detailSelectedCandidate.artist}`
                        : "Select a result above"}
                    </span>
                    <small>
                      The selected result stays visible here before you
                      apply it.
                    </small>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setDetailMode("edit");
                      setDetailSelectedCandidateId(null);
                    }}
                  >
                    CANCEL
                  </button>
                  <button
                    type="button"
                    className="is-primary"
                    disabled={
                      !detailSelectedCandidate ||
                      detailSaveState === "saving"
                    }
                    onClick={() => void useDetailCandidate()}
                  >
                    {detailMode === "artwork_results"
                      ? "USE ARTWORK"
                      : "USE THIS MATCH"}
                  </button>
                </footer>
              </>
            )}
          </section>
        </div>
      ) : null}

      {playlistPickerIds ? (
        <div
          className="tr12-modalBack"
          onMouseDown={() => setPlaylistPickerIds(null)}
        >
          <section
            className="tr12-picker"
            role="dialog"
            aria-modal="true"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span>ADD TO PLAYLIST</span>
                <h2>
                  {playlistPickerIds.length} song
                  {playlistPickerIds.length === 1 ? "" : "s"}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setPlaylistPickerIds(null)}
              >
                ×
              </button>
            </header>

            <div>
              {playlists.map((playlist) => (
                <button
                  type="button"
                  key={playlist.id}
                  onClick={() =>
                    void addToPlaylist(playlist, playlistPickerIds)
                  }
                >
                  <strong>{playlist.name}</strong>
                  <span>
                    {(playlistTrackIds[playlist.id] || []).length} songs
                  </span>
                  <b>ADD →</b>
                </button>
              ))}

              {!playlists.length ? (
                <div className="tr12-empty">
                  Create a playlist first.
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      <style>{`
        .tr12-musicPage{width:min(1180px,calc(100% - 28px));margin:18px auto 118px;color:#eaf5f8;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
        .tr12-musicPage button,.tr12-musicPage input,.tr12-musicPage select{font:inherit}.tr12-musicPage button{cursor:pointer}.tr12-musicPage button:disabled{cursor:not-allowed;opacity:.38}
        .tr12-hero{padding:25px 28px;display:flex;justify-content:space-between;gap:20px;align-items:flex-start;border:1px solid rgba(93,162,188,.15);border-radius:18px;background:radial-gradient(circle at 12% -15%,rgba(28,137,178,.2),transparent 35%),linear-gradient(180deg,#0b161c,#060b0f);box-shadow:0 18px 45px rgba(0,0,0,.18)}
        .tr12-hero span,.tr12-sectionHead span,.tr12-inspectorHead span,.tr12-picker header span,.tr12-smartBuilder>small{font-size:9px;font-weight:1000;letter-spacing:.16em;color:#55d0f5}.tr12-hero h1{margin:8px 0 8px;font-size:38px;line-height:1;letter-spacing:-.045em}.tr12-hero p{max-width:760px;margin:0;color:#849ba5;font-size:12px;font-weight:650}.tr12-hero>button{height:38px;padding:0 16px;border:1px solid rgba(102,165,188,.17);border-radius:9px;background:#071219;color:#ccdee5;font-size:8px;font-weight:1000;letter-spacing:.06em}
        .tr12-stats{display:grid;grid-template-columns:repeat(5,1fr);gap:9px;margin:11px 0}.tr12-stats>div{min-height:72px;display:grid;place-content:center;text-align:center;border:1px solid rgba(105,151,168,.14);border-radius:13px;background:linear-gradient(180deg,#0b1217,#06090c)}.tr12-stats strong{font-size:23px;color:#f1cb74;letter-spacing:-.025em}.tr12-stats span{margin-top:2px;color:#748993;font-size:7px;font-weight:1000;letter-spacing:.14em}.tr12-stats>div.is-alert{border-color:rgba(255,74,84,.32);background:linear-gradient(180deg,rgba(72,16,21,.55),rgba(20,7,9,.88));box-shadow:inset 0 1px rgba(255,163,169,.035),0 0 24px rgba(255,45,58,.045)}.tr12-stats>div.is-alert strong{color:#ff7a82}.tr12-stats>div.is-alert span{color:#e8868b}
        .tr12-libraryShell{overflow:hidden;border:1px solid rgba(88,156,182,.15);border-radius:18px;background:#04090c;box-shadow:0 22px 55px rgba(0,0,0,.2)}
        .tr12-sectionHead{padding:18px 20px;display:flex;align-items:center;justify-content:space-between;gap:14px;background:linear-gradient(180deg,#0b1820,#071016);border-bottom:1px solid rgba(83,150,175,.1)}.tr12-sectionHead h2{margin:4px 0 0;font-size:23px}.tr12-headActions{display:flex;gap:7px}.tr12-headActions button{height:36px;padding:0 12px;border:1px solid rgba(78,163,194,.17);border-radius:8px;background:#07141b;color:#c7dce4;font-size:8px;font-weight:1000}.tr12-headActions button.is-needsAction{border-color:rgba(255,68,79,.48);background:linear-gradient(180deg,rgba(108,23,29,.7),rgba(53,11,15,.84));color:#ffbdc1;box-shadow:0 0 18px rgba(255,60,72,.07)}
        .tr12-tabs{display:grid;grid-template-columns:repeat(5,1fr);background:#050c10;border-bottom:1px solid rgba(78,145,170,.1)}.tr12-tabs button{height:43px;border:0;border-right:1px solid rgba(73,137,160,.07);background:transparent;color:#657d87;font-size:8px;font-weight:1000;letter-spacing:.08em}.tr12-tabs button.is-active{position:relative;color:#dff7ff;background:linear-gradient(180deg,rgba(9,41,52,.72),rgba(5,18,24,.72))}.tr12-tabs button.is-active:after{content:"";position:absolute;left:18%;right:18%;bottom:0;height:2px;background:#49d3f8;box-shadow:0 0 10px rgba(73,211,248,.35)}
        .tr12-message,.tr12-error{margin:10px 12px 0;padding:9px 11px;border-radius:8px;font-size:8px;font-weight:850}.tr12-message{border:1px solid rgba(74,208,151,.18);background:rgba(15,65,47,.2);color:#83dcb0}.tr12-error{border:1px solid rgba(255,82,92,.28);background:rgba(90,19,24,.25);color:#ffadb2}
        .tr12-toolbar{padding:10px 12px;display:grid;grid-template-columns:minmax(220px,1fr) repeat(4,minmax(110px,auto));gap:8px;border-bottom:1px solid rgba(74,139,162,.08);background:#050b0f}.tr12-toolbar label{display:grid;gap:4px}.tr12-toolbar label>span{color:#58717c;font-size:6px;font-weight:1000;letter-spacing:.11em}.tr12-toolbar input,.tr12-toolbar select{height:36px;padding:0 10px;border:1px solid rgba(75,151,178,.14);border-radius:8px;background:#071219;color:#c9dde5;outline:none;font-size:8px;font-weight:850}.tr12-toolbar input:focus,.tr12-toolbar select:focus{border-color:rgba(75,205,245,.45)}
        .tr12-bulk{min-height:48px;padding:8px 12px;display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid rgba(69,151,181,.1);background:linear-gradient(90deg,rgba(8,45,59,.62),rgba(5,17,23,.64))}.tr12-bulk strong{font-size:8px;letter-spacing:.1em;color:#7bdff7}.tr12-bulk>div{display:flex;gap:6px}.tr12-bulk button{height:32px;padding:0 10px;border:1px solid rgba(76,176,211,.2);border-radius:7px;background:#07141b;color:#bdd6df;font-size:7px;font-weight:1000}
        .tr12-tableHead,.tr12-row{display:grid;grid-template-columns:30px minmax(0,1fr) 62px 110px 300px;gap:10px;align-items:center}.tr12-tableHead{min-height:37px;padding:0 13px;border-bottom:1px solid rgba(88,143,164,.09);color:#5c7782;font-size:7px;font-weight:1000;letter-spacing:.1em}.tr12-tableHead>button{width:22px;height:22px;border:1px solid rgba(75,145,169,.13);border-radius:5px;background:#061016;color:#7f98a2}.tr12-row{position:relative;min-height:71px;padding:8px 13px;border-bottom:1px solid rgba(83,137,157,.085);background:rgba(2,8,11,.38);transition:background .13s ease}.tr12-row:hover{background:rgba(7,30,39,.52)}.tr12-row.is-current{background:linear-gradient(90deg,rgba(7,65,84,.55),rgba(3,13,18,.4));box-shadow:inset 3px 0 #38cef8}
        .tr12-check{width:23px;height:23px;border:1px solid rgba(77,146,171,.16);border-radius:6px;background:#061118;color:#65e6ae;font-size:10px;font-weight:1000}.tr12-check.is-selected{border-color:rgba(79,219,166,.42);background:rgba(16,72,52,.38)}
        .tr12-track{min-width:0;display:grid;grid-template-columns:auto auto minmax(0,1fr) auto;gap:9px;align-items:center}.tr12-track>div{min-width:0}.tr12-track strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px}.tr12-track span{display:block;margin-top:2px;color:#718892;font-size:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tr12-play{width:35px;height:35px;border:0;border-radius:9px;background:linear-gradient(180deg,#ffc65d,#f59a13);color:#1b1105;font-weight:1000;box-shadow:0 4px 14px rgba(239,156,28,.1)}.tr12-play.is-playing{background:linear-gradient(180deg,#73eaff,#31bfdf)}
        .tr12-art{display:grid;place-items:center;overflow:hidden;flex:0 0 auto;border:1px solid rgba(91,184,219,.16);background:linear-gradient(145deg,#102936,#07131b);color:#ffc05b}.tr12-art img{width:100%;height:100%;object-fit:cover}.tr12-art i{font-style:normal}.tr12-art--row{width:34px;height:34px;border-radius:8px}.tr12-art--detail{width:72px;height:72px;border-radius:14px}.tr12-art--card{width:78px;height:78px;border-radius:12px}
        .tr12-health{font-style:normal;font-size:6px;font-weight:1000;letter-spacing:.08em;padding:5px 8px;border-radius:6px;white-space:nowrap}.tr12-health.is-needs{color:#ffd4d6;border:1px solid rgba(255,58,69,.64);background:linear-gradient(180deg,rgba(132,24,32,.76),rgba(68,10,15,.82));box-shadow:inset 0 1px rgba(255,201,204,.08),0 0 12px rgba(255,48,61,.09)}.tr12-health.is-art{color:#ffd086;border:1px solid rgba(230,161,55,.34);background:rgba(82,49,9,.25)}
        .tr12-duration{color:#81949c;font-size:9px;font-weight:800;font-variant-numeric:tabular-nums}
        .tr12-energy{height:34px;min-width:102px;padding:0 10px;display:grid;grid-template-columns:7px 1fr auto;gap:8px;align-items:center;border-radius:9px;font-size:7px;font-weight:1000;letter-spacing:.12em;font-variant-numeric:tabular-nums;transition:transform .13s ease,border-color .13s ease}.tr12-energy:hover{transform:translateY(-1px)}.tr12-energy i{width:7px;height:7px;border-radius:2px;background:currentColor;box-shadow:0 0 9px currentColor}.tr12-energy span{text-align:left}.tr12-energy b{font-size:6px;letter-spacing:1px;opacity:.66}.tr12-energy.is-high{border:1px solid rgba(241,170,64,.5);color:#f3b45e;background:linear-gradient(180deg,rgba(73,46,13,.56),rgba(17,13,8,.9));box-shadow:inset 0 1px rgba(255,224,174,.035)}.tr12-energy.is-medium{border:1px solid rgba(67,200,235,.42);color:#76dff5;background:linear-gradient(180deg,rgba(9,55,70,.52),rgba(5,16,22,.92))}.tr12-energy.is-low{border:1px solid rgba(67,207,155,.4);color:#77dfae;background:linear-gradient(180deg,rgba(11,61,43,.5),rgba(5,18,14,.92))}
        .tr12-actions{display:flex;justify-content:flex-end;gap:5px}.tr12-actions button,.tr12-orderTools button{height:31px;padding:0 9px;border:1px solid rgba(75,147,172,.13);border-radius:7px;background:#061118;color:#8199a2;font-size:7px;font-weight:950}.tr12-actions button.is-liked{color:#5fe2a6;border-color:rgba(66,211,151,.32);background:rgba(18,76,55,.28)}.tr12-actions button.is-down{color:#ff8d93;border-color:rgba(255,90,99,.3);background:rgba(83,20,25,.27)}.tr12-actions button.is-more{font-size:12px;min-width:39px}.tr12-orderTools{position:absolute;right:9px;bottom:3px;display:none;gap:3px}.tr12-row:hover .tr12-orderTools{display:flex}.tr12-orderTools button{height:20px;padding:0 5px;font-size:7px}
        .tr12-empty{padding:26px;text-align:center;color:#68808a;font-size:9px;font-weight:800}.tr12-pager{padding:10px 13px;display:flex;align-items:center;justify-content:space-between;gap:12px;background:#050b0f}.tr12-pager>span{color:#5c7580;font-size:7px;font-weight:1000;letter-spacing:.08em}.tr12-pager>div{display:flex;align-items:center;gap:7px}.tr12-pager button{height:30px;padding:0 10px;border:1px solid rgba(76,148,173,.14);border-radius:7px;background:#061118;color:#8fa6af;font-size:7px;font-weight:1000}.tr12-pager b{min-width:55px;text-align:center;font-size:8px;color:#a8c0ca}
        .tr12-cardGrid{padding:12px;display:grid;grid-template-columns:1fr 1fr;gap:9px}.tr12-collectionCard{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:12px;align-items:center;padding:12px;border:1px solid rgba(79,145,169,.11);border-radius:12px;background:linear-gradient(180deg,#07141a,#050c10)}.tr12-collectionCard small{color:#56ceeF;font-size:6px;font-weight:1000;letter-spacing:.12em}.tr12-collectionCard h3{margin:4px 0 2px;font-size:15px}.tr12-collectionCard p{margin:0;color:#6f8791;font-size:7px;font-weight:800}.tr12-collectionCard>button{height:34px;padding:0 10px;border:1px solid rgba(70,196,236,.25);border-radius:8px;background:#082633;color:#cceef8;font-size:7px;font-weight:1000}
        .tr12-playlistLayout{display:grid;grid-template-columns:230px 1fr;min-height:430px}.tr12-playlistLayout>aside{padding:10px;border-right:1px solid rgba(78,143,166,.1);background:#050b0f}.tr12-createPlaylist{display:grid;grid-template-columns:1fr 35px;gap:5px;margin-bottom:9px}.tr12-createPlaylist input{min-width:0;height:35px;padding:0 9px;border:1px solid rgba(75,149,175,.14);border-radius:8px;background:#071219;color:#d7e7ed;outline:none}.tr12-createPlaylist button{height:35px;border:1px solid rgba(70,194,234,.24);border-radius:8px;background:#082734;color:#d9f7ff;font-weight:1000}.tr12-playlistLayout>aside>button{width:100%;min-height:52px;padding:9px 10px;display:grid;gap:2px;text-align:left;border:0;border-radius:8px;background:transparent;color:#91a7af}.tr12-playlistLayout>aside>button.is-active{background:linear-gradient(90deg,rgba(10,63,81,.58),rgba(7,25,33,.3));color:#e3f7fc}.tr12-playlistLayout>aside>button strong{font-size:10px}.tr12-playlistLayout>aside>button span{font-size:6px;color:#607984}
        .tr12-playlistConsole{min-width:0}.tr12-playlistConsole>header{padding:12px 14px;display:flex;justify-content:space-between;gap:12px;align-items:end;border-bottom:1px solid rgba(77,144,168,.09)}.tr12-playlistConsole>header small{display:block;color:#5bcfee;font-size:6px;font-weight:1000;letter-spacing:.1em}.tr12-playlistConsole>header input{height:36px;min-width:250px;margin-top:4px;padding:0 10px;border:1px solid rgba(76,151,177,.14);border-radius:8px;background:#071219;color:#e0eef2;font-weight:900}.tr12-playlistConsole>header>div:last-child{display:flex;gap:5px}.tr12-playlistConsole button{height:33px;padding:0 9px;border:1px solid rgba(75,148,174,.14);border-radius:7px;background:#061218;color:#91aab3;font-size:7px;font-weight:1000}.tr12-playlistConsole button.is-primary{color:#d9f7ff;border-color:rgba(69,198,239,.32);background:#092c3a}.tr12-playlistConsole button.is-danger{color:#ff9fa4;border-color:rgba(255,82,91,.23);background:rgba(71,17,21,.25)}
        .tr12-playlistSongs{padding:9px}.tr12-playlistSongs article{display:grid;grid-template-columns:25px auto minmax(0,1fr) repeat(4,auto);gap:7px;align-items:center;padding:7px;border-bottom:1px solid rgba(75,136,158,.08)}.tr12-playlistSongs article>b{color:#586f79;font-size:7px}.tr12-playlistSongs strong{display:block;font-size:10px}.tr12-playlistSongs span{display:block;margin-top:2px;color:#677f89;font-size:7px}.tr12-addSelected{margin:0 12px 12px}
        .tr12-smart{display:grid;grid-template-columns:1fr 330px;min-height:450px}.tr12-smartBuilder{padding:24px}.tr12-smartBuilder h2{margin:6px 0;font-size:27px}.tr12-smartBuilder>p{max-width:650px;margin:0;color:#788f99;font-size:10px;line-height:1.55}.tr12-smartGrid{margin-top:22px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}.tr12-smartGrid label{padding:12px;display:grid;gap:7px;border:1px solid rgba(76,145,169,.1);border-radius:10px;background:#061118}.tr12-smartGrid label>span{font-size:6px;font-weight:1000;letter-spacing:.11em;color:#5f7882}.tr12-smartGrid input,.tr12-smartGrid select{height:38px;padding:0 10px;border:1px solid rgba(74,148,174,.13);border-radius:8px;background:#07151c;color:#d6e8ee;font-weight:900}.tr12-smartGrid label>b{font-size:6px;color:#607984}.tr12-toggle button{height:38px;border:1px solid rgba(74,149,175,.13);border-radius:8px;background:#07151c;color:#748d97;font-size:8px;font-weight:1000}.tr12-toggle button.is-on{color:#6ee2ab;border-color:rgba(72,215,158,.3);background:rgba(15,70,50,.3)}.tr12-smartLaunch{width:100%;height:48px;margin-top:13px;border:1px solid rgba(72,203,244,.42);border-radius:10px;background:linear-gradient(180deg,#0c4c62,#082d3b);color:#e2f9ff;font-size:9px;font-weight:1000;letter-spacing:.05em}
        .tr12-smartPreview{padding:11px;border-left:1px solid rgba(75,141,164,.09);background:#050b0f}.tr12-smartPreview>header{padding:8px;display:flex;justify-content:space-between;color:#607b86;font-size:7px;font-weight:1000}.tr12-smartPreview>div{display:grid;grid-template-columns:24px 1fr auto;gap:8px;align-items:center;padding:8px;border-bottom:1px solid rgba(73,132,153,.07)}.tr12-smartPreview>div>b{color:#516974;font-size:7px}.tr12-smartPreview strong{display:block;font-size:9px}.tr12-smartPreview small{display:block;margin-top:1px;color:#627a84;font-size:6px}.tr12-smartPreview em{font-style:normal;color:#77dff4;font-size:6px;font-weight:1000}
        .tr12-footerStats{padding:10px 3px;display:flex;gap:15px;color:#546d77;font-size:7px;font-weight:900;letter-spacing:.07em}
        .tr12-modalBack{position:fixed;inset:0;z-index:6000;padding:22px 14px;display:grid;place-items:center;background:rgba(0,4,7,.88);backdrop-filter:blur(10px)}
        .tr12-inspector{width:min(860px,100%);height:min(760px,calc(100dvh - 44px));display:grid;grid-template-rows:auto minmax(0,1fr) auto;overflow:hidden;border:1px solid rgba(80,206,246,.34);border-radius:18px;background:linear-gradient(180deg,#0b202b,#050d12);box-shadow:0 34px 90px rgba(0,0,0,.68),0 0 0 1px rgba(255,255,255,.012)}
        .tr12-inspectorHead,.tr12-picker>header{padding:16px 18px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(82,157,184,.12);background:linear-gradient(180deg,rgba(11,35,47,.98),rgba(7,22,30,.98));z-index:3}.tr12-inspectorHead>button,.tr12-picker>header>button{width:36px;height:36px;border:1px solid rgba(105,159,178,.17);border-radius:9px;background:#071219;color:#d8e8ed;font-size:21px}.tr12-inspectIdentity{display:flex;gap:12px;align-items:center;min-width:0}.tr12-inspectIdentity>div{min-width:0}.tr12-inspectIdentity h2{max-width:620px;margin:4px 0 2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:25px}.tr12-inspectIdentity p{margin:0;color:#7a919b;font-size:10px}.tr12-editState{display:inline-block;margin-top:6px;color:#6b848e;font-size:6px;font-weight:1000;letter-spacing:.11em}.tr12-editState.is-dirty{color:#efb85f}.tr12-editState.is-changed{color:#69e4aa}
        .tr12-inspectorBody,.tr12-lookupBody{min-height:0;overflow:auto;overscroll-behavior:contain}.tr12-inspectCommands{position:sticky;top:0;z-index:4;padding:10px 16px;display:flex;flex-wrap:wrap;gap:6px;border-bottom:1px solid rgba(82,157,184,.1);background:rgba(6,18,25,.97);backdrop-filter:blur(8px)}.tr12-inspectCommands button,.tr12-artControls button{height:34px;padding:0 10px;border:1px solid rgba(73,181,219,.19);border-radius:8px;background:#07141b;color:#cbe5ee;font-size:7px;font-weight:1000}.tr12-inspectCommands button:hover{border-color:rgba(73,209,249,.42);background:#092633}.tr12-inspectCommands button.is-liked{color:#61e3a6}.tr12-inspectCommands button.is-down{color:#ff9191}
        .tr12-modalStatus{margin:10px 16px 0;padding:10px 12px;border:1px solid rgba(77,171,205,.17);border-radius:8px;background:#07141b;color:#9ec0cd;font-size:8px;font-weight:850}.tr12-modalStatus.is-changed{border-color:rgba(67,208,147,.32);color:#8ce8ba;background:rgba(16,66,48,.25)}.tr12-modalStatus.is-error{border-color:rgba(255,92,99,.38);color:#ffb1b5;background:rgba(83,19,24,.3)}
        .tr12-inspectGrid{padding:14px 16px;display:grid;grid-template-columns:1fr 1fr;gap:10px}.tr12-inspectGrid label{display:grid;gap:5px}.tr12-inspectGrid label>span,.tr12-artControls>span{font-size:6px;font-weight:1000;letter-spacing:.11em;color:#617b85}.tr12-inspectGrid input{height:40px;padding:0 10px;border:1px solid rgba(75,151,178,.15);border-radius:8px;background:#06131a;color:#e8f5f9;outline:none;font-size:10px;font-weight:800}.tr12-inspectGrid input:focus{border-color:rgba(72,207,248,.5);box-shadow:0 0 0 2px rgba(65,200,242,.05)}.tr12-artControls{display:flex;align-items:end;gap:6px}.tr12-artControls>span{margin-right:auto;margin-bottom:10px}.tr12-artControls button.is-danger{color:#ff969c;border-color:rgba(255,84,94,.24)}
        .tr12-meta{display:grid;grid-template-columns:repeat(3,1fr);margin:0;padding:0 16px 14px}.tr12-meta>div{min-width:0;padding:11px;border:1px solid rgba(85,146,167,.09)}.tr12-meta dt{font-size:6px;font-weight:1000;letter-spacing:.1em;color:#617b85}.tr12-meta dd{margin:4px 0 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:9px;color:#dfeef3}
        .tr12-inspectorFooter,.tr12-lookupFooter{z-index:5;padding:13px 16px;display:flex;justify-content:flex-end;align-items:center;gap:7px;border-top:1px solid rgba(82,157,184,.12);background:linear-gradient(180deg,rgba(6,17,23,.98),rgba(4,11,15,.99));box-shadow:0 -12px 30px rgba(0,0,0,.2)}.tr12-inspectorFooter button,.tr12-lookupFooter button{height:39px;padding:0 13px;border:1px solid rgba(83,168,199,.18);border-radius:9px;background:#07131a;color:#d1e3e9;font-size:7px;font-weight:1000;letter-spacing:.03em}.tr12-inspectorFooter button.is-primary,.tr12-lookupFooter button.is-primary{min-width:128px;border-color:rgba(61,205,255,.52);background:linear-gradient(180deg,#0d4559,#092e3c);color:#e1f9ff;box-shadow:0 5px 16px rgba(40,179,220,.1)}.tr12-inspectorFooter button.is-danger{color:#ff9da3;border-color:rgba(255,81,91,.25);background:rgba(69,17,21,.25)}.tr12-saveButton.is-changed{border-color:rgba(72,221,155,.58)!important;background:linear-gradient(180deg,rgba(25,115,78,.8),rgba(16,70,49,.88))!important;color:#b3f5d2!important;box-shadow:0 0 18px rgba(70,222,157,.1)!important}
        .tr12-lookupHead{position:sticky;top:0;z-index:4;padding:14px 16px;display:grid;grid-template-columns:auto minmax(0,1fr);gap:13px;align-items:start;border-bottom:1px solid rgba(75,148,174,.12);background:rgba(6,19,26,.98);backdrop-filter:blur(9px)}.tr12-lookupHead>button{height:34px;padding:0 10px;border:1px solid rgba(77,164,196,.2);border-radius:8px;background:#07141b;color:#bdd5de;font-size:7px;font-weight:1000}.tr12-lookupHead span{font-size:6px;font-weight:1000;letter-spacing:.13em;color:#5cd4f6}.tr12-lookupHead h3{margin:3px 0 2px;font-size:21px}.tr12-lookupHead p{margin:0;color:#78909a;font-size:8px}
        .tr12-searching{margin:12px 14px;padding:20px;display:grid;justify-items:center;gap:6px;border:1px solid rgba(72,192,232,.15);border-radius:10px;background:#06131a;color:#90b4c0;text-align:center}.tr12-searching i{width:24px;height:24px;border:2px solid rgba(77,204,244,.18);border-top-color:#55d6f8;border-radius:50%;animation:tr12spin .7s linear infinite}.tr12-searching strong{font-size:8px;letter-spacing:.09em}.tr12-searching span{font-size:7px;color:#68818b}@keyframes tr12spin{to{transform:rotate(360deg)}}
        .tr12-detailCandidates{padding:10px 13px 18px;display:grid;gap:7px}.tr12-detailCandidates>button{position:relative;width:100%;display:grid;grid-template-columns:58px minmax(0,1fr) 118px 26px;gap:11px;align-items:center;text-align:left;padding:9px;border:1px solid rgba(78,143,166,.12);border-radius:10px;background:linear-gradient(180deg,rgba(7,19,26,.96),rgba(4,12,17,.97));color:#edf7fb;box-shadow:0 6px 16px rgba(0,0,0,.08)}.tr12-detailCandidates>button:hover{border-color:rgba(83,200,239,.32);background:#09212b}.tr12-detailCandidates>button.is-selected{border-color:rgba(73,210,252,.66);background:linear-gradient(90deg,rgba(10,65,83,.68),rgba(5,20,27,.96));box-shadow:inset 3px 0 #42d3fb,0 0 18px rgba(55,198,239,.06)}.tr12-detailCandidates img,.tr12-candidateArt{width:58px;height:58px;border-radius:8px;object-fit:cover}.tr12-candidateArt{display:grid;place-items:center;background:#09202a;color:#7cdff7}.tr12-detailCandidates strong{display:block;font-size:11px}.tr12-detailCandidates span,.tr12-detailCandidates small{display:block;margin-top:2px;color:#738a94;font-size:8px}.tr12-matchTier{justify-self:end;display:grid;gap:2px;text-align:right;font-style:normal;font-size:6px;font-weight:1000;letter-spacing:.07em;color:#8299a2}.tr12-matchTier b{font-size:14px;letter-spacing:-.02em;color:#78dff9}.tr12-matchTier.is-exact-match{color:#78e2ac}.tr12-matchTier.is-exact-match b{color:#69e9ad}.tr12-matchTier.is-strong-match{color:#8fdbed}.tr12-matchTier.is-possible-match{color:#e3ba71}.tr12-matchTier.is-possible-match b{color:#efc372}.tr12-matchTier.is-weak-match{color:#8b969a}.tr12-matchTier.is-weak-match b{color:#9da7ab}.tr12-selectMark{width:24px;height:24px;display:grid;place-items:center;border:1px solid rgba(83,153,179,.19);border-radius:50%;font-style:normal;color:#70eab0}.tr12-detailCandidates>button.is-selected .tr12-selectMark{border-color:rgba(83,229,174,.48);background:rgba(26,100,73,.31)}
        .tr12-detailCandidates.is-artwork{grid-template-columns:repeat(2,minmax(0,1fr))}.tr12-detailCandidates.is-artwork>button{grid-template-columns:70px minmax(0,1fr) 28px;grid-template-rows:auto auto}.tr12-detailCandidates.is-artwork img,.tr12-detailCandidates.is-artwork .tr12-candidateArt{width:70px;height:70px}.tr12-detailCandidates.is-artwork .tr12-matchTier{grid-column:2;justify-self:start;text-align:left}.tr12-detailCandidates.is-artwork .tr12-selectMark{grid-column:3;grid-row:1/3}
        .tr12-lookupFooter>div{min-width:0;margin-right:auto;display:grid;gap:2px}.tr12-lookupFooter>div span{max-width:470px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#b9d5df;font-size:8px;font-weight:900}.tr12-lookupFooter>div small{color:#607984;font-size:6px}
        .tr12-picker{width:min(520px,100%);max-height:calc(100dvh - 44px);overflow:hidden;border:1px solid rgba(80,199,238,.3);border-radius:16px;background:linear-gradient(180deg,#0a1f29,#050d12);box-shadow:0 30px 80px rgba(0,0,0,.65)}.tr12-picker h2{margin:4px 0 0;font-size:20px}.tr12-picker>div{max-height:430px;overflow:auto;padding:10px}.tr12-picker>div>button{width:100%;min-height:54px;padding:10px;display:grid;grid-template-columns:1fr auto;gap:2px;text-align:left;border:0;border-bottom:1px solid rgba(76,139,163,.09);background:transparent;color:#dcebf0}.tr12-picker>div>button strong{font-size:10px}.tr12-picker>div>button span{grid-column:1;color:#6f8791;font-size:7px}.tr12-picker>div>button b{grid-column:2;grid-row:1/3;align-self:center;color:#6bdcf7;font-size:7px}
        @media(max-width:920px){.tr12-stats{grid-template-columns:repeat(3,1fr)}.tr12-toolbar{grid-template-columns:1fr 1fr}.tr12-search{grid-column:1/-1}.tr12-tableHead,.tr12-row{grid-template-columns:28px minmax(0,1fr) 58px 98px}.tr12-tableHead span:last-child{display:none}.tr12-actions{grid-column:2/-1;justify-content:flex-start}.tr12-orderTools{display:none!important}.tr12-cardGrid{grid-template-columns:1fr 1fr}.tr12-playlistLayout{grid-template-columns:200px 1fr}.tr12-smart{grid-template-columns:1fr}.tr12-smartPreview{border-left:0;border-top:1px solid rgba(75,141,164,.09)}}
        @media(max-width:650px){.tr12-musicPage{width:min(100% - 16px,1180px);margin-top:10px}.tr12-hero{padding:18px;display:block}.tr12-hero h1{font-size:30px}.tr12-hero>button{margin-top:13px}.tr12-stats{grid-template-columns:repeat(2,1fr)}.tr12-stats>div:last-child{grid-column:1/-1}.tr12-sectionHead{display:block}.tr12-headActions{margin-top:11px;display:grid;grid-template-columns:1fr 1fr}.tr12-tabs{grid-template-columns:repeat(5,minmax(105px,1fr));overflow-x:auto}.tr12-toolbar{grid-template-columns:1fr;padding:9px}.tr12-search{grid-column:auto}.tr12-bulk{display:block}.tr12-bulk>div{margin-top:8px;display:grid;grid-template-columns:1fr 1fr}.tr12-tableHead{display:none}.tr12-row{grid-template-columns:26px minmax(0,1fr);gap:8px;padding:10px 9px}.tr12-row>.tr12-duration,.tr12-row>.tr12-energy{grid-column:2}.tr12-actions{grid-column:2;display:grid;grid-template-columns:38px 38px 1fr 1fr 42px}.tr12-track{grid-template-columns:auto auto minmax(0,1fr)}.tr12-health{grid-column:3;justify-self:start;margin-top:4px}.tr12-energy{min-width:100px;width:100%;max-width:150px}.tr12-pager{display:grid;justify-items:center}.tr12-cardGrid{grid-template-columns:1fr;padding:9px}.tr12-collectionCard{grid-template-columns:64px minmax(0,1fr)}.tr12-art--card{width:64px;height:64px}.tr12-collectionCard>button{grid-column:2;justify-self:start}.tr12-playlistLayout{grid-template-columns:1fr}.tr12-playlistLayout>aside{border-right:0;border-bottom:1px solid rgba(78,143,166,.1);display:flex;overflow-x:auto}.tr12-createPlaylist{min-width:190px}.tr12-playlistLayout>aside>button{min-width:145px}.tr12-playlistConsole>header{display:block}.tr12-playlistConsole>header input{width:100%;min-width:0}.tr12-playlistConsole>header>div:last-child{margin-top:8px;display:grid;grid-template-columns:1fr 1fr 1fr}.tr12-playlistSongs article{grid-template-columns:23px auto minmax(0,1fr) auto}.tr12-playlistSongs article>button:nth-of-type(n+2){display:none}.tr12-smartBuilder{padding:18px}.tr12-smartGrid{grid-template-columns:1fr}.tr12-footerStats{flex-wrap:wrap}.tr12-modalBack{padding:8px}.tr12-inspector{height:calc(100dvh - 16px);border-radius:13px}.tr12-inspectorHead{padding:12px}.tr12-art--detail{width:55px;height:55px;border-radius:10px}.tr12-inspectIdentity h2{font-size:18px}.tr12-inspectCommands{padding:8px;display:grid;grid-template-columns:1fr 1fr}.tr12-inspectGrid{grid-template-columns:1fr;padding:10px}.tr12-meta{grid-template-columns:1fr 1fr;padding:0 10px 10px}.tr12-inspectorFooter{padding:9px;display:grid;grid-template-columns:1fr 1fr}.tr12-inspectorFooter .tr12-saveButton{grid-column:1/-1;grid-row:1}.tr12-lookupHead{padding:10px;display:block}.tr12-lookupHead>button{margin-bottom:8px}.tr12-detailCandidates{padding:8px}.tr12-detailCandidates>button{grid-template-columns:52px minmax(0,1fr) 25px}.tr12-detailCandidates img,.tr12-candidateArt{width:52px;height:52px}.tr12-matchTier{grid-column:2;justify-self:start;text-align:left}.tr12-selectMark{grid-column:3;grid-row:1/3}.tr12-detailCandidates.is-artwork{grid-template-columns:1fr}.tr12-lookupFooter{padding:9px;display:grid;grid-template-columns:1fr 1fr}.tr12-lookupFooter>div{grid-column:1/-1}.tr12-lookupFooter button.is-primary{min-width:0}.tr12-picker{max-height:calc(100dvh - 16px)}}
      `}</style>
    </main>
  );
}
