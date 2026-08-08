import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent,
} from "react";
import {
  getMusicArtworkSignedUrl,
  listMusicTracks,
  removeMusicArtwork,
  removeMusicTrack,
  setMusicTrackPreference,
  updateMusicTrack,
  uploadMusicArtwork,
  uploadMusicTrack,
  type MusicEnergyLevel,
  type MusicTrack,
} from "../../lib/musicStorage";
import {
  applyMusicMetadataCandidate,
  delayMusicLookup,
  enrichMusicTrack,
  needsMusicArtwork,
  needsMusicMetadata,
  type MusicMetadataCandidate,
} from "../../lib/musicMetadata";
import {
  createMusicPlaylist,
  deleteMusicPlaylist,
  listMusicPlaylists,
  listMusicPlaylistTrackLinks,
  replaceMusicPlaylistTracks,
  type MusicPlaylist,
} from "../../lib/playlistStorage";
import {
  activateAllMusicTracks,
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

type DraftMap = Record<
  string,
  { title: string; artist: string; album: string; releaseYear: string; genre: string }
>;
type PlaylistTrackMap = Record<string, string[]>;
type MusicTab = "songs" | "artists" | "albums" | "playlists" | "smart";
type SmartIntensity = "high" | "balanced" | "recovery";
type LibraryHealth = "all" | "needs_info" | "missing_art" | "liked" | "review";
type SongSort =
  | "library"
  | "recently_added"
  | "title_asc"
  | "title_desc"
  | "artist_asc"
  | "artist_desc"
  | "album_asc"
  | "most_played"
  | "recently_played"
  | "high_rotation"
  | "least_played"
  | "most_skipped"
  | "longest"
  | "shortest"
  | "energy_high"
  | "energy_low";
type EnergyFilter = "all" | MusicEnergyLevel;
type PageSize = 12 | 24 | 48;
type EnrichmentState = {
  running: boolean;
  current: number;
  total: number;
  matched: number;
  review: number;
  notFound: number;
  label: string;
};
type ReviewItem = { trackId: string; candidates: MusicMetadataCandidate[] };

const PLAYLISTS_CHANGED_EVENT = "mvp:music-playlists-changed";

function formatFileSize(bytes: number | null) {
  if (!bytes) return "";
  const megabytes = bytes / (1024 * 1024);
  return `${megabytes.toFixed(megabytes >= 10 ? 0 : 1)} MB`;
}
function formatDuration(seconds: number | null) {
  if (!seconds) return "";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
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
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}
function trackDuration(track: MusicTrack) {
  return Math.max(120, Number(track.duration_seconds || 210));
}
function artistLabel(track: MusicTrack) {
  return track.artist?.trim() || "Unknown Artist";
}
function albumLabel(track: MusicTrack) {
  return track.album?.trim() || "Unknown Album";
}
function highRotationScore(track: MusicTrack) {
  const completed = track.completed_play_count * 3;
  const plays = track.play_count * 1.4;
  const skips = track.skip_count * 2.7;
  const liked = track.favorite ? 18 : 0;
  const less = track.play_less ? 35 : 0;
  return completed + plays + liked - skips - less;
}
function smartMixScore(track: MusicTrack, intensity: SmartIntensity) {
  const targetEnergy: MusicEnergyLevel =
    intensity === "high" ? "high" : intensity === "recovery" ? "low" : "medium";
  let score = Math.random() * 7;
  if (track.favorite) score += 48;
  if (track.play_less) score -= 70;
  if (track.energy_level === targetEnergy) score += 30;
  else if (intensity === "balanced" && track.energy_level === "high") score += 12;
  else if (track.energy_level === "medium") score += 8;
  score += Math.min(18, track.completed_play_count * 1.6);
  score -= Math.min(30, track.skip_count * 4.2);
  score += Math.max(0, 8 - track.play_count * 0.28);
  if (track.last_played_at) {
    const ageHours = (Date.now() - new Date(track.last_played_at).getTime()) / 3600000;
    if (ageHours < 12) score -= 17;
    else if (ageHours < 72) score -= 8;
    else if (ageHours > 336) score += 5;
  } else score += 8;
  return score;
}
function buildSmartMix(tracks: MusicTrack[], minutes: number, intensity: SmartIntensity) {
  const targetSeconds = Math.max(15, minutes) * 60;
  const candidates = tracks
    .filter((track) => !track.play_less)
    .map((track) => ({ track, score: smartMixScore(track, intensity) }))
    .sort((a, b) => b.score - a.score);
  const selected: MusicTrack[] = [];
  const used = new Set<string>();
  let seconds = 0;
  let lastArtist = "";
  while (selected.length < candidates.length && seconds < targetSeconds) {
    const preferred = candidates.findIndex(({ track }) => {
      if (used.has(track.id)) return false;
      const artist = artistLabel(track).toLowerCase();
      return !lastArtist || artist === "unknown artist" || artist !== lastArtist;
    });
    const fallback = candidates.findIndex(({ track }) => !used.has(track.id));
    const index = preferred >= 0 ? preferred : fallback;
    if (index < 0) break;
    const track = candidates[index].track;
    selected.push(track);
    used.add(track.id);
    seconds += trackDuration(track);
    lastArtist = artistLabel(track).toLowerCase();
  }
  return selected.length ? selected : tracks.slice(0, 1);
}
function songSortLabel(sort: SongSort) {
  const labels: Record<SongSort, string> = {
    library: "Library order",
    recently_added: "Recently added",
    title_asc: "Title A–Z",
    title_desc: "Title Z–A",
    artist_asc: "Artist A–Z",
    artist_desc: "Artist Z–A",
    album_asc: "Album A–Z",
    most_played: "Most played",
    recently_played: "Recently played",
    high_rotation: "High rotation",
    least_played: "Least played",
    most_skipped: "Most skipped",
    longest: "Longest",
    shortest: "Shortest",
    energy_high: "Energy high → low",
    energy_low: "Energy low → high",
  };
  return labels[sort];
}
function energyRank(level: MusicEnergyLevel) {
  return level === "high" ? 3 : level === "medium" ? 2 : 1;
}

function TrackArtwork({ track, size = "row" }: { track: MusicTrack; size?: "row" | "detail" | "card" }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setUrl(track.external_artwork_url || null);
    void getMusicArtworkSignedUrl(track)
      .then((next) => { if (!cancelled) setUrl(next); })
      .catch(() => { if (!cancelled) setUrl(track.external_artwork_url || null); });
    return () => { cancelled = true; };
  }, [track.id, track.artwork_path, track.external_artwork_url]);
  return (
    <span className={`tr10-art tr10-art--${size}`} aria-hidden>
      {url ? <img src={url} alt="" /> : <span>♫</span>}
    </span>
  );
}

export function MusicPage({ navigate }: { navigate?: (to: string) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const artworkInputRef = useRef<HTMLInputElement | null>(null);
  const player = useMusicPlayer();

  const [tab, setTab] = useState<MusicTab>("songs");
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [drafts, setDrafts] = useState<DraftMap>({});
  const [playlists, setPlaylists] = useState<MusicPlaylist[]>([]);
  const [playlistTrackIds, setPlaylistTrackIds] = useState<PlaylistTrackMap>({});
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [songSearch, setSongSearch] = useState("");
  const [songSort, setSongSort] = useState<SongSort>("library");
  const [energyFilter, setEnergyFilter] = useState<EnergyFilter>("all");
  const [healthFilter, setHealthFilter] = useState<LibraryHealth>("all");
  const [pageSize, setPageSize] = useState<PageSize>(12);
  const [page, setPage] = useState(1);
  const [selectedSongIds, setSelectedSongIds] = useState<Set<string>>(new Set());
  const [detailTrackId, setDetailTrackId] = useState<string | null>(null);
  const [playlistModalTrackIds, setPlaylistModalTrackIds] = useState<string[]>([]);
  const [playlistModalSelections, setPlaylistModalSelections] = useState<Set<string>>(new Set());
  const [playlistModalName, setPlaylistModalName] = useState("");
  const [smartMinutes, setSmartMinutes] = useState(60);
  const [smartIntensity, setSmartIntensity] = useState<SmartIntensity>("high");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [reviewTrackId, setReviewTrackId] = useState<string | null>(null);
  const [enrichment, setEnrichment] = useState<EnrichmentState>({
    running: false, current: 0, total: 0, matched: 0, review: 0, notFound: 0, label: "",
  });

  const totalSize = useMemo(() => tracks.reduce((sum, track) => sum + Number(track.file_size_bytes || 0), 0), [tracks]);
  const totalDuration = useMemo(() => tracks.reduce((sum, track) => sum + Number(track.duration_seconds || 0), 0), [tracks]);
  const artistCount = useMemo(() => new Set(tracks.map((track) => artistLabel(track).toLowerCase()).filter((v) => v !== "unknown artist")).size, [tracks]);
  const albumCount = useMemo(() => new Set(tracks.map((track) => `${artistLabel(track)}|${albumLabel(track)}`.toLowerCase()).filter((v) => !v.endsWith("|unknown album"))).size, [tracks]);
  const likedCount = useMemo(() => tracks.filter((track) => track.favorite).length, [tracks]);
  const needsInfoCount = useMemo(() => tracks.filter(needsMusicMetadata).length, [tracks]);
  const missingArtCount = useMemo(() => tracks.filter(needsMusicArtwork).length, [tracks]);
  const reviewCount = useMemo(() => tracks.filter((track) => track.metadata_status === "review").length, [tracks]);

  const detailTrack = useMemo(() => tracks.find((track) => track.id === detailTrackId) || null, [detailTrackId, tracks]);
  const reviewTrack = useMemo(() => tracks.find((track) => track.id === reviewTrackId) || null, [reviewTrackId, tracks]);
  const reviewCandidates = useMemo(() => reviewItems.find((item) => item.trackId === reviewTrackId)?.candidates || [], [reviewItems, reviewTrackId]);

  const artistGroups = useMemo(() => {
    const map = new Map<string, MusicTrack[]>();
    tracks.forEach((track) => {
      const key = artistLabel(track);
      map.set(key, [...(map.get(key) || []), track]);
    });
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [tracks]);
  const albumGroups = useMemo(() => {
    const map = new Map<string, { album: string; artist: string; tracks: MusicTrack[] }>();
    tracks.forEach((track) => {
      const album = albumLabel(track);
      const artist = artistLabel(track);
      const key = `${artist}|||${album}`;
      const existing = map.get(key) || { album, artist, tracks: [] };
      existing.tracks.push(track);
      map.set(key, existing);
    });
    return [...map.values()].sort((a, b) => a.album.localeCompare(b.album));
  }, [tracks]);

  const filteredTracks = useMemo(() => {
    const query = songSearch.trim().toLowerCase();
    const next = tracks.filter((track) => {
      const matchesSearch = !query || `${track.title} ${track.artist || ""} ${track.album || ""} ${track.original_name}`.toLowerCase().includes(query);
      const matchesEnergy = energyFilter === "all" || track.energy_level === energyFilter;
      const matchesHealth =
        healthFilter === "all" ||
        (healthFilter === "needs_info" && needsMusicMetadata(track)) ||
        (healthFilter === "missing_art" && needsMusicArtwork(track)) ||
        (healthFilter === "liked" && track.favorite) ||
        (healthFilter === "review" && track.metadata_status === "review");
      return matchesSearch && matchesEnergy && matchesHealth;
    });
    return [...next].sort((left, right) => {
      if (songSort === "recently_added") return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
      if (songSort === "title_asc") return left.title.localeCompare(right.title);
      if (songSort === "title_desc") return right.title.localeCompare(left.title);
      if (songSort === "artist_asc") return artistLabel(left).localeCompare(artistLabel(right));
      if (songSort === "artist_desc") return artistLabel(right).localeCompare(artistLabel(left));
      if (songSort === "album_asc") return albumLabel(left).localeCompare(albumLabel(right));
      if (songSort === "most_played") return right.play_count - left.play_count;
      if (songSort === "recently_played") return new Date(right.last_played_at || 0).getTime() - new Date(left.last_played_at || 0).getTime();
      if (songSort === "high_rotation") return highRotationScore(right) - highRotationScore(left);
      if (songSort === "least_played") return left.play_count - right.play_count;
      if (songSort === "most_skipped") return right.skip_count - left.skip_count;
      if (songSort === "longest") return Number(right.duration_seconds || 0) - Number(left.duration_seconds || 0);
      if (songSort === "shortest") return Number(left.duration_seconds || 0) - Number(right.duration_seconds || 0);
      if (songSort === "energy_high") return energyRank(right.energy_level) - energyRank(left.energy_level);
      if (songSort === "energy_low") return energyRank(left.energy_level) - energyRank(right.energy_level);
      return left.sort_order - right.sort_order;
    });
  }, [tracks, songSearch, energyFilter, healthFilter, songSort]);

  const totalPages = Math.max(1, Math.ceil(filteredTracks.length / pageSize));
  const pagedTracks = useMemo(() => filteredTracks.slice((page - 1) * pageSize, page * pageSize), [filteredTracks, page, pageSize]);
  const selectedCount = selectedSongIds.size;
  const allVisibleSelected = pagedTracks.length > 0 && pagedTracks.every((track) => selectedSongIds.has(track.id));

  function rebuildDrafts(rows: MusicTrack[]) {
    const next: DraftMap = {};
    rows.forEach((track) => {
      next[track.id] = {
        title: track.title,
        artist: track.artist || "",
        album: track.album || "",
        releaseYear: track.release_year ? String(track.release_year) : "",
        genre: track.genre || "",
      };
    });
    setDrafts(next);
  }
  function replaceTrackLocally(updated: MusicTrack) {
    setTracks((current) => {
      const next = current.map((track) => track.id === updated.id ? updated : track);
      replaceMusicLibrary(next);
      return next;
    });
    setDrafts((current) => ({ ...current, [updated.id]: {
      title: updated.title,
      artist: updated.artist || "",
      album: updated.album || "",
      releaseYear: updated.release_year ? String(updated.release_year) : "",
      genre: updated.genre || "",
    }}));
  }
  async function refreshTracks() {
    const rows = await listMusicTracks();
    setTracks(rows);
    rebuildDrafts(rows);
    replaceMusicLibrary(rows);
    return rows;
  }
  async function refreshPlaylists(preferredId?: string | null) {
    const rows = await listMusicPlaylists();
    const entries = await Promise.all(rows.map(async (playlist) => {
      const links = await listMusicPlaylistTrackLinks(playlist.id);
      return [playlist.id, links.map((link) => link.track_id)] as const;
    }));
    setPlaylists(rows);
    setPlaylistTrackIds(Object.fromEntries(entries));
    const nextId = preferredId && rows.some((p) => p.id === preferredId)
      ? preferredId
      : selectedPlaylistId && rows.some((p) => p.id === selectedPlaylistId)
        ? selectedPlaylistId
        : rows[0]?.id || null;
    setSelectedPlaylistId(nextId);
    window.dispatchEvent(new Event(PLAYLISTS_CHANGED_EVENT));
  }
  async function refreshAll() {
    setLoading(true); setError("");
    try { await Promise.all([refreshTracks(), refreshPlaylists()]); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load your music library."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void refreshAll(); void loadMusicLibrary(true); }, []);
  useEffect(() => { setPage(1); }, [songSearch, songSort, energyFilter, healthFilter, pageSize]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true); setError(""); setMessage("");
    try {
      let order = tracks.length;
      for (const file of Array.from(files)) {
        setMessage(`Uploading ${file.name}…`);
        await uploadMusicTrack(file, order++);
      }
      await refreshTracks();
      setMessage(`${files.length} song${files.length === 1 ? "" : "s"} uploaded. Embedded metadata and artwork were imported when available.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not upload songs."); }
    finally { setUploading(false); if (inputRef.current) inputRef.current.value = ""; }
  }

  async function saveTrack(track: MusicTrack) {
    const draft = drafts[track.id]; if (!draft) return;
    setBusyId(track.id); setError("");
    try {
      const updated = await updateMusicTrack(track.id, {
        title: draft.title,
        artist: draft.artist,
        album: draft.album,
        release_year: draft.releaseYear ? Number(draft.releaseYear) : null,
        genre: draft.genre,
        metadata_status: "manual",
        metadata_confidence: 1,
        metadata_source: "manual",
        metadata_updated_at: new Date().toISOString(),
      });
      replaceTrackLocally(updated); setMessage("Song information saved.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save song information."); }
    finally { setBusyId(null); }
  }
  async function changePreference(track: MusicTrack, preference: "like" | "play_less" | "neutral") {
    try {
      const updated = await setMusicTrackPreference(track.id, preference);
      replaceTrackLocally(updated);
      await setPlayerMusicPreference(track.id, preference);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not update preference."); }
  }
  async function setEnergy(track: MusicTrack, energy: MusicEnergyLevel) {
    try { replaceTrackLocally(await updateMusicTrack(track.id, { energy_level: energy })); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not update energy."); }
  }
  async function replaceArtwork(track: MusicTrack, file: File | null) {
    if (!file) return; setBusyId(`art-${track.id}`);
    try { replaceTrackLocally(await uploadMusicArtwork(track, file)); setMessage("Artwork updated."); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not update artwork."); }
    finally { setBusyId(null); if (artworkInputRef.current) artworkInputRef.current.value = ""; }
  }
  async function clearArtwork(track: MusicTrack) {
    setBusyId(`art-${track.id}`);
    try { replaceTrackLocally(await removeMusicArtwork(track)); setMessage("Artwork removed."); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not remove artwork."); }
    finally { setBusyId(null); }
  }
  async function deleteTrack(track: MusicTrack) {
    if (!window.confirm(`Delete “${track.title}” from your private music library?`)) return;
    setBusyId(track.id);
    try { await removeMusicTrack(track.id); setDetailTrackId(null); await refreshTracks(); setMessage("Song deleted."); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not delete song."); }
    finally { setBusyId(null); }
  }
  async function toggleTrackPlayback(track: MusicTrack) {
    try {
      const current = player.currentTrack?.id === track.id;
      if (current && player.playing) pauseMusic();
      else if (current) await playMusic();
      else { activateAllMusicTracks(); await playMusicTrack(track.id, 0); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not play this song."); }
  }
  function toggleSongSelection(trackId: string) {
    setSelectedSongIds((current) => { const next = new Set(current); next.has(trackId) ? next.delete(trackId) : next.add(trackId); return next; });
  }
  function toggleSelectVisible() {
    setSelectedSongIds((current) => {
      const next = new Set(current);
      pagedTracks.forEach((track) => allVisibleSelected ? next.delete(track.id) : next.add(track.id));
      return next;
    });
  }

  async function enrichTracks(targets: MusicTrack[], artworkOnly = false) {
    if (!targets.length) { setMessage(artworkOnly ? "No songs are missing artwork." : "No songs need metadata cleanup."); return; }
    setError(""); setReviewItems([]);
    let matched = 0, review = 0, notFound = 0;
    setEnrichment({ running: true, current: 0, total: targets.length, matched: 0, review: 0, notFound: 0, label: artworkOnly ? "FINDING ARTWORK" : "ENRICHING LIBRARY" });
    for (let index = 0; index < targets.length; index += 1) {
      const track = targets[index];
      try {
        const result = await enrichMusicTrack(track, { artworkOnly });
        if (result.changed) replaceTrackLocally(result.track);
        if (result.status === "matched") matched += 1;
        else if (result.status === "review") {
          review += 1;
          if (result.candidates.length) setReviewItems((current) => [...current, { trackId: track.id, candidates: result.candidates }]);
        } else notFound += 1;
      } catch { notFound += 1; }
      setEnrichment({ running: true, current: index + 1, total: targets.length, matched, review, notFound, label: artworkOnly ? "FINDING ARTWORK" : "ENRICHING LIBRARY" });
      if (index < targets.length - 1) await delayMusicLookup(300);
    }
    await refreshTracks();
    setEnrichment({ running: false, current: targets.length, total: targets.length, matched, review, notFound, label: artworkOnly ? "ARTWORK SCAN COMPLETE" : "LIBRARY ENRICHMENT COMPLETE" });
    setMessage(`${matched} matched${review ? ` • ${review} need review` : ""}${notFound ? ` • ${notFound} not found` : ""}.`);
  }
  async function useCandidate(track: MusicTrack, candidate: MusicMetadataCandidate) {
    setBusyId(`match-${track.id}`);
    try {
      const updated = await applyMusicMetadataCandidate(track, candidate, "manual");
      replaceTrackLocally(updated);
      setReviewItems((current) => current.filter((item) => item.trackId !== track.id));
      setReviewTrackId(null);
      setMessage("Music information and artwork applied.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not apply this match."); }
    finally { setBusyId(null); }
  }

  function openPlaylistModal(trackIds: string[]) {
    const ids = Array.from(new Set(trackIds)); if (!ids.length) return;
    const selected = new Set<string>();
    playlists.forEach((playlist) => {
      const existing = new Set(playlistTrackIds[playlist.id] || []);
      if (ids.every((id) => existing.has(id))) selected.add(playlist.id);
    });
    setPlaylistModalTrackIds(ids); setPlaylistModalSelections(selected); setPlaylistModalName("");
  }
  async function savePlaylistMemberships() {
    if (!playlistModalTrackIds.length) return;
    setBusyId("playlist-route");
    try {
      let preferred: string | null = null;
      if (playlistModalName.trim()) {
        const created = await createMusicPlaylist(playlistModalName.trim());
        preferred = created.id;
        await replaceMusicPlaylistTracks(created.id, playlistModalTrackIds);
      }
      for (const playlist of playlists) {
        const current = playlistTrackIds[playlist.id] || [];
        const chosen = playlistModalSelections.has(playlist.id);
        const targets = new Set(playlistModalTrackIds);
        const next = chosen ? Array.from(new Set([...current, ...playlistModalTrackIds])) : current.filter((id) => !targets.has(id));
        if (next.join("|") !== current.join("|")) await replaceMusicPlaylistTracks(playlist.id, next);
      }
      await refreshPlaylists(preferred || selectedPlaylistId);
      setPlaylistModalTrackIds([]); setPlaylistModalSelections(new Set()); setPlaylistModalName(""); setSelectedSongIds(new Set());
      setMessage("Playlist routing updated.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not update playlists."); }
    finally { setBusyId(null); }
  }
  async function createPlaylist() {
    try { const created = await createMusicPlaylist(newPlaylistName); setNewPlaylistName(""); await refreshPlaylists(created.id); setSelectedPlaylistId(created.id); setMessage("Playlist created."); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create playlist."); }
  }
  async function removePlaylist(playlist: MusicPlaylist) {
    if (!window.confirm(`Delete playlist “${playlist.name}”? Your songs remain in the library.`)) return;
    try { await deleteMusicPlaylist(playlist.id); await refreshPlaylists(null); setMessage("Playlist deleted."); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not delete playlist."); }
  }
  async function buildAndPlaySmartMix() {
    const mix = buildSmartMix(tracks, smartMinutes, smartIntensity);
    if (!mix.length) { setError("Upload songs before building a Smart Mix."); return; }
    await playMusicAdHocQueue(`Smart Mix • ${smartIntensity === "high" ? "High Energy" : smartIntensity === "recovery" ? "Recovery" : "Balanced"}`, mix);
    setMessage(`Smart Mix started with ${mix.length} songs.`);
  }

  const selectedPlaylist = playlists.find((playlist) => playlist.id === selectedPlaylistId) || null;
  const selectedPlaylistTracks = selectedPlaylist
    ? (playlistTrackIds[selectedPlaylist.id] || []).map((id) => tracks.find((track) => track.id === id)).filter((track): track is MusicTrack => Boolean(track))
    : [];

  return (
    <div className="tr10-page">
      <section className="tr10-hero">
        <div><span>PRIVATE WORKOUT AUDIO</span><h1>Your music. Engineered for training.</h1><p>Clean metadata, real artwork, intelligent sorting, smart preferences, playlists, and performance audio in one private library.</p></div>
        <button type="button" onClick={() => navigate ? navigate("/") : window.history.back()}>BACK</button>
      </section>

      <section className="tr10-stats">
        <div><strong>{tracks.length}</strong><span>SONGS</span></div>
        <div><strong>{artistCount}</strong><span>ARTISTS</span></div>
        <div><strong>{albumCount}</strong><span>ALBUMS</span></div>
        <div><strong>{likedCount}</strong><span>LIKED</span></div>
        <div><strong>{formatLongDuration(totalDuration)}</strong><span>PLAY TIME</span></div>
      </section>

      <nav className="tr10-tabs" aria-label="Music library sections">
        {(["songs","artists","albums","playlists","smart"] as MusicTab[]).map((value, index) => (
          <button key={value} type="button" className={tab === value ? "is-active" : ""} onClick={() => setTab(value)}>
            <span>0{index + 1}</span>{value === "smart" ? "SMART MIX" : value.toUpperCase()}
          </button>
        ))}
      </nav>

      {message ? <div className="tr10-notice is-ok">{message}</div> : null}
      {error ? <div className="tr10-notice is-error">{error}</div> : null}

      {enrichment.total ? (
        <section className={`tr10-enrichStatus ${enrichment.running ? "is-running" : ""}`}>
          <div><span>{enrichment.label}</span><strong>{enrichment.current} / {enrichment.total}</strong></div>
          <div className="tr10-progress"><i style={{ transform: `scaleX(${enrichment.total ? enrichment.current / enrichment.total : 0})` }} /></div>
          <div><span>{enrichment.matched} matched</span><span>{enrichment.review} review</span><span>{enrichment.notFound} not found</span></div>
        </section>
      ) : null}

      {tab === "songs" ? (
        <section className="tr10-console">
          <header className="tr10-sectionHead">
            <div><span>SONG LIBRARY</span><h2>Performance-ready catalog</h2><p>{filteredTracks.length} songs shown • {formatFileSize(totalSize) || "0 MB"} stored</p></div>
            <div className="tr10-headActions">
              <input ref={inputRef} type="file" accept=".mp3,.m4a,.wav,audio/*" multiple hidden onChange={(event: ChangeEvent<HTMLInputElement>) => void uploadFiles(event.target.files)} />
              <button type="button" className="is-cyan" disabled={enrichment.running} onClick={() => void enrichTracks(tracks.filter((track) => needsMusicMetadata(track) || needsMusicArtwork(track)))}>{enrichment.running ? "SCANNING…" : "ENRICH LIBRARY"}</button>
              <button type="button" className="is-orange" disabled={uploading} onClick={() => inputRef.current?.click()}>{uploading ? "UPLOADING…" : "+ UPLOAD SONGS"}</button>
            </div>
          </header>

          <div className="tr10-healthRail">
            <button className={healthFilter === "all" ? "is-active" : ""} onClick={() => setHealthFilter("all")}>ALL <b>{tracks.length}</b></button>
            <button className={healthFilter === "needs_info" ? "is-active" : ""} onClick={() => setHealthFilter("needs_info")}>NEEDS INFO <b>{needsInfoCount}</b></button>
            <button className={healthFilter === "missing_art" ? "is-active" : ""} onClick={() => setHealthFilter("missing_art")}>MISSING ART <b>{missingArtCount}</b></button>
            <button className={healthFilter === "liked" ? "is-active" : ""} onClick={() => setHealthFilter("liked")}>LIKED <b>{likedCount}</b></button>
            <button className={healthFilter === "review" ? "is-active" : ""} onClick={() => setHealthFilter("review")}>REVIEW <b>{Math.max(reviewCount, reviewItems.length)}</b></button>
          </div>

          <div className="tr10-toolbar">
            <label><span>SEARCH</span><input value={songSearch} onChange={(e) => setSongSearch(e.target.value)} placeholder="Song, artist, album, or file…" /></label>
            <label><span>ENERGY</span><select value={energyFilter} onChange={(e) => setEnergyFilter(e.target.value as EnergyFilter)}><option value="all">All energy</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
            <label><span>SORT</span><select value={songSort} onChange={(e) => setSongSort(e.target.value as SongSort)}>{(["library","recently_added","title_asc","title_desc","artist_asc","artist_desc","album_asc","most_played","recently_played","high_rotation","least_played","most_skipped","longest","shortest","energy_high","energy_low"] as SongSort[]).map((sort) => <option key={sort} value={sort}>{songSortLabel(sort)}</option>)}</select></label>
          </div>

          {selectedCount ? (
            <div className="tr10-bulk"><strong>{selectedCount} SELECTED</strong><div><button onClick={() => openPlaylistModal([...selectedSongIds])}>+ PLAYLIST</button><button onClick={() => void enrichTracks(tracks.filter((track) => selectedSongIds.has(track.id)))}>IDENTIFY</button><button onClick={() => void enrichTracks(tracks.filter((track) => selectedSongIds.has(track.id)), true)}>FIND ART</button><button onClick={() => setSelectedSongIds(new Set())}>CLEAR</button></div></div>
          ) : null}

          <div className="tr10-table">
            <div className="tr10-tableHead"><label><input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectVisible} /></label><span>TRACK</span><span>TIME</span><span>ENERGY</span><span>ACTIONS</span></div>
            {loading ? <div className="tr10-empty">Loading your music…</div> : null}
            {!loading && !pagedTracks.length ? <div className="tr10-empty">No songs match these filters.</div> : null}
            {pagedTracks.map((track) => {
              const current = player.currentTrack?.id === track.id;
              const playing = current && player.playing;
              return (
                <article key={track.id} className={`tr10-row ${current ? "is-current" : ""}`}>
                  <label><input type="checkbox" checked={selectedSongIds.has(track.id)} onChange={() => toggleSongSelection(track.id)} /></label>
                  <div className="tr10-track">
                    <TrackArtwork track={track} />
                    <button className={`tr10-play ${playing ? "is-playing" : ""}`} onClick={() => void toggleTrackPlayback(track)}>{playing ? "Ⅱ" : "▶"}</button>
                    <div><strong>{track.title}</strong><span>{artistLabel(track)}{track.album ? ` • ${track.album}` : ""}</span></div>
                    {needsMusicMetadata(track) || needsMusicArtwork(track) ? <em className="tr10-healthDot">{needsMusicMetadata(track) ? "NEEDS INFO" : "MISSING ART"}</em> : null}
                  </div>
                  <span>{formatDuration(track.duration_seconds) || "--:--"}</span>
                  <button className={`tr10-energy is-${track.energy_level}`} onClick={() => void setEnergy(track, track.energy_level === "low" ? "medium" : track.energy_level === "medium" ? "high" : "low")}>{track.energy_level.toUpperCase()}</button>
                  <div className="tr10-actions">
                    <button className={track.play_less ? "is-down" : ""} title="Play less" onClick={() => void changePreference(track, track.play_less ? "neutral" : "play_less")}>👎</button>
                    <button className={track.favorite ? "is-liked" : ""} title="Like" onClick={() => void changePreference(track, track.favorite ? "neutral" : "like")}>👍</button>
                    <button onClick={() => openPlaylistModal([track.id])}>+ PLAYLIST</button>
                    <button className="is-more" onClick={() => setDetailTrackId(track.id)}>•••</button>
                  </div>
                </article>
              );
            })}
          </div>

          <footer className="tr10-pager"><label>SHOW <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value) as PageSize)}><option value="12">12 songs</option><option value="24">24 songs</option><option value="48">48 songs</option></select></label><div><button disabled={page <= 1} onClick={() => setPage((v) => v - 1)}>← PREVIOUS</button><span>PAGE {page} OF {totalPages}</span><button disabled={page >= totalPages} onClick={() => setPage((v) => v + 1)}>NEXT →</button></div><span>{filteredTracks.length ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, filteredTracks.length)} OF ${filteredTracks.length}` : "0"}</span></footer>
        </section>
      ) : null}

      {tab === "artists" ? (
        <section className="tr10-console"><header className="tr10-sectionHead"><div><span>ARTISTS</span><h2>Your library by artist</h2><p>{artistGroups.length} artist groups</p></div><button className="is-cyan" onClick={() => { setTab("songs"); setSongSort("artist_asc"); }}>OPEN ARTIST SORT</button></header>
          <div className="tr10-cardGrid">{artistGroups.map(([artist, rows]) => <article className="tr10-collectionCard" key={artist}><TrackArtwork track={rows.find((t) => !needsMusicArtwork(t)) || rows[0]} size="card" /><div><span>ARTIST</span><h3>{artist}</h3><p>{rows.length} song{rows.length === 1 ? "" : "s"} • {formatLongDuration(rows.reduce((s,t) => s + Number(t.duration_seconds || 0),0))}</p></div><button onClick={() => void playMusicAdHocQueue(artist, rows)}>▶ PLAY</button><button onClick={() => { setTab("songs"); setSongSearch(artist === "Unknown Artist" ? "Unknown artist" : artist); setSongSort("title_asc"); }}>VIEW SONGS</button></article>)}</div>
        </section>
      ) : null}

      {tab === "albums" ? (
        <section className="tr10-console"><header className="tr10-sectionHead"><div><span>ALBUMS</span><h2>Album library</h2><p>{albumGroups.length} album groups</p></div><button className="is-cyan" onClick={() => void enrichTracks(tracks.filter(needsMusicArtwork), true)}>FIND MISSING ARTWORK</button></header>
          <div className="tr10-cardGrid">{albumGroups.map((group) => <article className="tr10-collectionCard" key={`${group.artist}-${group.album}`}><TrackArtwork track={group.tracks.find((t) => !needsMusicArtwork(t)) || group.tracks[0]} size="card" /><div><span>ALBUM</span><h3>{group.album}</h3><p>{group.artist} • {group.tracks.length} songs</p></div><button onClick={() => void playMusicAdHocQueue(group.album, group.tracks)}>▶ PLAY</button><button onClick={() => { setTab("songs"); setSongSearch(group.album === "Unknown Album" ? "" : group.album); setSongSort("title_asc"); }}>VIEW SONGS</button></article>)}</div>
        </section>
      ) : null}

      {tab === "playlists" ? (
        <section className="tr10-console"><header className="tr10-sectionHead"><div><span>PLAYLISTS</span><h2>Custom training queues</h2><p>{playlists.length} playlists</p></div><div className="tr10-createPlaylist"><input value={newPlaylistName} onChange={(e) => setNewPlaylistName(e.target.value)} placeholder="New playlist name" /><button className="is-orange" disabled={!newPlaylistName.trim()} onClick={() => void createPlaylist()}>CREATE</button></div></header>
          <div className="tr10-playlistLayout"><aside>{playlists.map((playlist) => <button key={playlist.id} className={selectedPlaylistId === playlist.id ? "is-active" : ""} onClick={() => setSelectedPlaylistId(playlist.id)}><strong>{playlist.name}</strong><span>{playlistTrackIds[playlist.id]?.length || 0} songs</span></button>)}</aside><main>{selectedPlaylist ? <><div className="tr10-playlistHead"><div><span>ACTIVE PLAYLIST</span><h3>{selectedPlaylist.name}</h3></div><div><button onClick={() => void playMusicPlaylist(selectedPlaylist, selectedPlaylistTracks)}>▶ PLAY</button><button className="is-danger" onClick={() => void removePlaylist(selectedPlaylist)}>DELETE</button></div></div>{selectedPlaylistTracks.map((track) => <div className="tr10-playlistRow" key={track.id}><TrackArtwork track={track} /><div><strong>{track.title}</strong><span>{artistLabel(track)}</span></div><span>{formatDuration(track.duration_seconds)}</span><button onClick={() => void playMusicPlaylist(selectedPlaylist, selectedPlaylistTracks, track.id)}>PLAY</button></div>)}</> : <div className="tr10-empty">Create or select a playlist.</div>}</main></div>
        </section>
      ) : null}

      {tab === "smart" ? (
        <section className="tr10-console"><header className="tr10-sectionHead"><div><span>SMART MIX</span><h2>Preference-aware workout rotation</h2><p>Likes, play-less signals, skips, completion, energy, and recency shape the queue.</p></div></header>
          <div className="tr10-smartGrid"><label><span>LENGTH</span><strong>{smartMinutes} MIN</strong><input type="range" min="30" max="180" step="15" value={smartMinutes} onChange={(e) => setSmartMinutes(Number(e.target.value))} /></label><div><span>INTENSITY</span>{(["high","balanced","recovery"] as SmartIntensity[]).map((value) => <button key={value} className={smartIntensity === value ? "is-active" : ""} onClick={() => setSmartIntensity(value)}>{value.toUpperCase()}</button>)}</div><button className="tr10-smartLaunch" onClick={() => void buildAndPlaySmartMix()}>BUILD & PLAY SMART MIX</button></div>
          <div className="tr10-smartCollections"><button onClick={() => {setTab("songs");setHealthFilter("liked");setSongSort("high_rotation");}}>LIKED TRACKS <b>{likedCount}</b></button><button onClick={() => {setTab("songs");setHealthFilter("all");setSongSort("most_played");}}>MOST PLAYED</button><button onClick={() => {setTab("songs");setHealthFilter("all");setSongSort("recently_played");}}>RECENTLY PLAYED</button><button onClick={() => {setTab("songs");setHealthFilter("all");setSongSort("high_rotation");}}>HIGH ROTATION</button><button onClick={() => {setTab("songs");setHealthFilter("liked");setSongSort("least_played");}}>REDISCOVER</button></div>
        </section>
      ) : null}

      {detailTrack ? (
        <div className="tr10-modalBack" onMouseDown={() => setDetailTrackId(null)}><section className="tr10-inspector" role="dialog" aria-modal="true" onMouseDown={(e: MouseEvent<HTMLElement>) => e.stopPropagation()}><header><div className="tr10-inspectIdentity"><TrackArtwork track={detailTrack} size="detail" /><div><span>SONG CONTROL</span><h2>{detailTrack.title}</h2><p>{artistLabel(detailTrack)}</p></div></div><button onClick={() => setDetailTrackId(null)}>×</button></header>
          <div className="tr10-inspectCommands"><button onClick={() => void enrichTracks([detailTrack])}>FIND SONG INFO</button><button onClick={() => void enrichTracks([detailTrack], true)}>FIND ARTWORK</button><button onClick={() => playMusicNext(detailTrack.id)}>PLAY NEXT</button><button onClick={() => addMusicToQueue(detailTrack.id)}>ADD TO QUEUE</button><button className={detailTrack.favorite ? "is-liked" : ""} onClick={() => void changePreference(detailTrack, detailTrack.favorite ? "neutral" : "like")}>👍 {detailTrack.favorite ? "LIKED" : "LIKE"}</button><button className={detailTrack.play_less ? "is-down" : ""} onClick={() => void changePreference(detailTrack, detailTrack.play_less ? "neutral" : "play_less")}>👎 PLAY LESS</button></div>
          <div className="tr10-inspectGrid"><label><span>TITLE</span><input value={drafts[detailTrack.id]?.title || ""} onChange={(e) => setDrafts((c) => ({...c,[detailTrack.id]:{...c[detailTrack.id],title:e.target.value}}))} /></label><label><span>ARTIST</span><input value={drafts[detailTrack.id]?.artist || ""} onChange={(e) => setDrafts((c) => ({...c,[detailTrack.id]:{...c[detailTrack.id],artist:e.target.value}}))} /></label><label><span>ALBUM</span><input value={drafts[detailTrack.id]?.album || ""} onChange={(e) => setDrafts((c) => ({...c,[detailTrack.id]:{...c[detailTrack.id],album:e.target.value}}))} /></label><label><span>YEAR</span><input inputMode="numeric" value={drafts[detailTrack.id]?.releaseYear || ""} onChange={(e) => setDrafts((c) => ({...c,[detailTrack.id]:{...c[detailTrack.id],releaseYear:e.target.value}}))} /></label><label><span>GENRE</span><input value={drafts[detailTrack.id]?.genre || ""} onChange={(e) => setDrafts((c) => ({...c,[detailTrack.id]:{...c[detailTrack.id],genre:e.target.value}}))} /></label><div className="tr10-artControls"><input ref={artworkInputRef} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => void replaceArtwork(detailTrack,e.target.files?.[0] || null)} /><span>ARTWORK</span><button onClick={() => artworkInputRef.current?.click()}>{needsMusicArtwork(detailTrack) ? "+ ADD" : "REPLACE"}</button>{!needsMusicArtwork(detailTrack) ? <button className="is-danger" onClick={() => void clearArtwork(detailTrack)}>REMOVE</button> : null}</div></div>
          <dl className="tr10-meta"><div><dt>PLAYS</dt><dd>{detailTrack.play_count}</dd></div><div><dt>COMPLETED</dt><dd>{detailTrack.completed_play_count}</dd></div><div><dt>SKIPS</dt><dd>{detailTrack.skip_count}</dd></div><div><dt>LAST PLAYED</dt><dd>{formatDate(detailTrack.last_played_at)}</dd></div><div><dt>MATCH</dt><dd>{detailTrack.metadata_status.toUpperCase()}</dd></div><div><dt>FILE</dt><dd title={detailTrack.original_name}>{detailTrack.original_name}</dd></div></dl>
          <footer><button onClick={() => openPlaylistModal([detailTrack.id])}>+ PLAYLIST</button><button className="is-danger" onClick={() => void deleteTrack(detailTrack)}>DELETE</button><button className="is-primary" disabled={busyId === detailTrack.id} onClick={() => void saveTrack(detailTrack)}>SAVE CHANGES</button></footer>
        </section></div>
      ) : null}

      {reviewItems.length ? <button className="tr10-reviewDock" onClick={() => setReviewTrackId(reviewItems[0].trackId)}>REVIEW {reviewItems.length} POSSIBLE MATCH{reviewItems.length === 1 ? "" : "ES"} ›</button> : null}

      {reviewTrack ? (
        <div className="tr10-modalBack" onMouseDown={() => setReviewTrackId(null)}><section className="tr10-reviewModal" role="dialog" aria-modal="true" onMouseDown={(e: MouseEvent<HTMLElement>) => e.stopPropagation()}><header><div><span>MATCH REVIEW</span><h2>{reviewTrack.title}</h2><p>Choose only the correct result. Nothing is renamed automatically here.</p></div><button onClick={() => setReviewTrackId(null)}>×</button></header><div className="tr10-candidates">{reviewCandidates.map((candidate) => <article key={candidate.sourceId}>{candidate.artworkUrl ? <img src={candidate.artworkUrl} alt="" /> : <span className="tr10-candidateArt">♫</span>}<div><strong>{candidate.title}</strong><span>{candidate.artist}</span><small>{candidate.album}{candidate.releaseYear ? ` • ${candidate.releaseYear}` : ""}</small></div><b>{Math.round(candidate.confidence * 100)}%</b><button disabled={busyId === `match-${reviewTrack.id}`} onClick={() => void useCandidate(reviewTrack,candidate)}>USE MATCH</button></article>)}</div></section></div>
      ) : null}

      {playlistModalTrackIds.length ? (
        <div className="tr10-modalBack" onMouseDown={() => setPlaylistModalTrackIds([])}><section className="tr10-picker" onMouseDown={(e: MouseEvent<HTMLElement>) => e.stopPropagation()}><header><div><span>PLAYLIST ROUTING</span><h2>{playlistModalTrackIds.length} song{playlistModalTrackIds.length === 1 ? "" : "s"}</h2></div><button onClick={() => setPlaylistModalTrackIds([])}>×</button></header><div>{playlists.map((playlist) => <label key={playlist.id}><input type="checkbox" checked={playlistModalSelections.has(playlist.id)} onChange={() => setPlaylistModalSelections((current) => {const next=new Set(current);next.has(playlist.id)?next.delete(playlist.id):next.add(playlist.id);return next;})} /><span><strong>{playlist.name}</strong><small>{playlistTrackIds[playlist.id]?.length || 0} songs</small></span></label>)}</div><label className="tr10-newRoute"><span>CREATE NEW PLAYLIST</span><input value={playlistModalName} onChange={(e) => setPlaylistModalName(e.target.value)} placeholder="Playlist name" /></label><footer><button onClick={() => setPlaylistModalTrackIds([])}>CANCEL</button><button className="is-primary" disabled={busyId === "playlist-route"} onClick={() => void savePlaylistMemberships()}>SAVE PLAYLISTS</button></footer></section></div>
      ) : null}

      <style>{`
        .tr10-page{width:min(1180px,calc(100% - 32px));margin:0 auto 120px;color:#eef8fc;font-family:inherit;min-width:0}.tr10-page *{box-sizing:border-box}.tr10-page button,.tr10-page input,.tr10-page select{font:inherit}
        .tr10-hero,.tr10-console{border:1px solid rgba(70,181,222,.24);border-top-color:rgba(149,222,248,.33);border-radius:18px;background:linear-gradient(180deg,rgba(12,31,42,.97),rgba(4,13,19,.99));box-shadow:inset 0 1px 0 rgba(255,255,255,.025),0 14px 32px rgba(0,0,0,.24)}
        .tr10-hero{padding:24px 28px;display:flex;justify-content:space-between;gap:22px;align-items:flex-start}.tr10-hero span,.tr10-sectionHead span,.tr10-inspector header span,.tr10-reviewModal header span,.tr10-picker header span{font-size:10px;font-weight:1000;letter-spacing:.15em;color:#5bcdf2}.tr10-hero h1{font-size:36px;line-height:1;margin:8px 0 9px;letter-spacing:-.04em}.tr10-hero p{max-width:800px;margin:0;color:#8fa5af;font-weight:650}.tr10-hero>button{height:38px;padding:0 18px;border:1px solid rgba(130,170,185,.18);border-radius:10px;background:#071015;color:#dce8ed;font-weight:900;font-size:10px;letter-spacing:.07em}
        .tr10-stats{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin:12px 0}.tr10-stats>div{min-height:74px;display:grid;place-content:center;text-align:center;border:1px solid rgba(119,151,164,.16);border-radius:14px;background:linear-gradient(180deg,#0c1318,#070b0e)}.tr10-stats strong{font-size:24px;color:#ffd477}.tr10-stats span{font-size:8px;font-weight:1000;letter-spacing:.14em;color:#8698a1}
        .tr10-tabs{display:grid;grid-template-columns:repeat(5,1fr);gap:4px;padding:5px;border:1px solid rgba(92,132,148,.12);border-radius:14px;background:#05090c;margin-bottom:14px}.tr10-tabs button{height:48px;border:0;border-radius:10px;background:transparent;color:#7f929c;font-size:10px;font-weight:1000;letter-spacing:.07em}.tr10-tabs button span{color:#55ccea;margin-right:10px}.tr10-tabs button.is-active{color:#15100a;background:linear-gradient(180deg,#ffc357,#f99a16);box-shadow:inset 0 1px 0 rgba(255,255,255,.55),0 7px 16px rgba(224,126,0,.18)}.tr10-tabs button.is-active span{color:#5f3900}
        .tr10-notice{margin:10px 0;padding:12px 15px;border-radius:10px;font-size:12px;font-weight:800}.tr10-notice.is-ok{border:1px solid rgba(74,217,157,.25);background:rgba(25,91,65,.18);color:#a7f2cd}.tr10-notice.is-error{border:1px solid rgba(255,103,103,.28);background:rgba(92,27,27,.22);color:#ffb0b0}
        .tr10-enrichStatus{margin:10px 0 14px;padding:12px 14px;border:1px solid rgba(78,197,239,.23);border-radius:12px;background:#07151d}.tr10-enrichStatus>div:first-child,.tr10-enrichStatus>div:last-child{display:flex;align-items:center;justify-content:space-between;gap:12px}.tr10-enrichStatus span{font-size:9px;font-weight:950;letter-spacing:.08em;color:#8ea7b1}.tr10-enrichStatus strong{color:#e7f9ff}.tr10-progress{height:4px;margin:9px 0;background:#0e2631;border-radius:5px;overflow:hidden}.tr10-progress i{display:block;width:100%;height:100%;transform-origin:left;background:linear-gradient(90deg,#22bce7,#70e6ff,#59d99d);transition:transform .22s ease}.tr10-enrichStatus.is-running{box-shadow:0 0 0 1px rgba(65,206,252,.06),0 0 24px rgba(31,174,222,.07)}
        .tr10-console{overflow:hidden}.tr10-sectionHead{padding:22px 24px;display:flex;justify-content:space-between;gap:18px;align-items:center;border-bottom:1px solid rgba(90,158,183,.1)}.tr10-sectionHead h2{font-size:28px;margin:5px 0 2px;letter-spacing:-.035em}.tr10-sectionHead p{margin:0;color:#879aa4;font-size:12px;font-weight:650}.tr10-headActions,.tr10-createPlaylist{display:flex;gap:8px;align-items:center}.tr10-headActions button,.tr10-createPlaylist button,.tr10-sectionHead>button{height:40px;padding:0 15px;border-radius:10px;font-size:9px;font-weight:1000;letter-spacing:.07em}.is-orange{border:1px solid #ffbd53!important;background:linear-gradient(180deg,#ffc55c,#f59108)!important;color:#191006!important}.is-cyan{border:1px solid rgba(67,211,255,.5)!important;background:linear-gradient(180deg,#0d3342,#081d27)!important;color:#c9f5ff!important}
        .tr10-healthRail{display:flex;gap:4px;padding:10px 13px;border-bottom:1px solid rgba(93,151,172,.09);overflow-x:auto}.tr10-healthRail button{white-space:nowrap;height:34px;padding:0 12px;border:1px solid rgba(97,151,170,.13);border-radius:8px;background:#071016;color:#8398a1;font-size:8px;font-weight:1000;letter-spacing:.07em}.tr10-healthRail button b{margin-left:5px;color:#dceaf0}.tr10-healthRail button.is-active{border-color:rgba(67,207,252,.42);color:#d8f7ff;background:#0a2935}
        .tr10-toolbar{display:grid;grid-template-columns:minmax(240px,1fr) 180px 230px;gap:10px;padding:13px;border-bottom:1px solid rgba(93,151,172,.09)}.tr10-toolbar label{display:grid;gap:5px}.tr10-toolbar label>span,.tr10-inspectGrid label>span,.tr10-artControls>span,.tr10-newRoute>span{font-size:7px;font-weight:1000;letter-spacing:.12em;color:#637e8a}.tr10-toolbar input,.tr10-toolbar select,.tr10-inspectGrid input,.tr10-createPlaylist input,.tr10-newRoute input{width:100%;height:39px;border:1px solid rgba(103,155,175,.15);border-radius:9px;background:#050c10;color:#e8f1f5;padding:0 11px;outline:0}.tr10-toolbar input:focus,.tr10-toolbar select:focus,.tr10-inspectGrid input:focus{border-color:rgba(71,207,255,.46)}
        .tr10-bulk{padding:10px 14px;display:flex;justify-content:space-between;align-items:center;gap:10px;background:rgba(15,76,98,.22);border-bottom:1px solid rgba(66,197,243,.17)}.tr10-bulk strong{font-size:9px;color:#8be6ff;letter-spacing:.1em}.tr10-bulk div{display:flex;gap:6px}.tr10-bulk button,.tr10-actions button,.tr10-playlistHead button,.tr10-playlistRow button{min-height:34px;padding:0 10px;border:1px solid rgba(83,161,190,.18);border-radius:8px;background:#07131a;color:#c8d8df;font-size:8px;font-weight:950;letter-spacing:.05em}
        .tr10-tableHead,.tr10-row{display:grid;grid-template-columns:34px minmax(0,1fr) 72px 105px 270px;gap:10px;align-items:center}.tr10-tableHead{min-height:38px;padding:0 14px;border-bottom:1px solid rgba(103,153,172,.11);color:#627e89;font-size:8px;font-weight:1000;letter-spacing:.1em}.tr10-row{min-height:68px;padding:8px 14px;border-bottom:1px solid rgba(88,143,164,.1);background:rgba(2,8,12,.36)}.tr10-row:hover{background:rgba(9,34,45,.6)}.tr10-row.is-current{background:linear-gradient(90deg,rgba(7,72,99,.58),rgba(2,10,14,.42));box-shadow:inset 3px 0 #27c9ff}.tr10-track{min-width:0;display:grid;grid-template-columns:auto auto minmax(0,1fr) auto;gap:9px;align-items:center}.tr10-track>div{min-width:0}.tr10-track strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px}.tr10-track span{display:block;margin-top:2px;color:#718892;font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tr10-healthDot{font-style:normal;font-size:6px;font-weight:1000;letter-spacing:.06em;color:#ffb34c;border:1px solid rgba(255,174,70,.28);padding:4px 6px;border-radius:6px}.tr10-play{width:36px;height:36px;border:0;border-radius:9px;background:linear-gradient(180deg,#ffc35b,#f6970d);color:#1a1105;font-weight:1000}.tr10-play.is-playing{background:linear-gradient(180deg,#78ebff,#31bddf)}
        .tr10-art{display:grid;place-items:center;overflow:hidden;border:1px solid rgba(91,184,219,.16);background:linear-gradient(145deg,#102936,#07131b);color:#ffc05b;flex:0 0 auto}.tr10-art img{width:100%;height:100%;object-fit:cover}.tr10-art--row{width:34px;height:34px;border-radius:8px}.tr10-art--detail{width:72px;height:72px;border-radius:14px}.tr10-art--card{width:86px;height:86px;border-radius:13px}.tr10-energy{height:28px;border-radius:16px;font-size:7px;font-weight:1000;letter-spacing:.07em}.tr10-energy.is-high{border:1px solid rgba(255,170,52,.4);background:rgba(119,68,10,.2);color:#ffbb55}.tr10-energy.is-medium{border:1px solid rgba(41,201,239,.37);background:rgba(8,80,99,.25);color:#74dff9}.tr10-energy.is-low{border:1px solid rgba(87,215,160,.33);background:rgba(20,87,62,.2);color:#7be0ae}.tr10-actions{display:flex;justify-content:flex-end;gap:5px}.tr10-actions button.is-liked{color:#57e3a1;border-color:rgba(63,215,147,.38);background:rgba(23,82,61,.22)}.tr10-actions button.is-down{color:#ff8989;border-color:rgba(255,105,105,.35);background:rgba(92,27,29,.2)}.tr10-actions .is-more{min-width:42px;font-size:12px}
        .tr10-empty{padding:38px;text-align:center;color:#778d97}.tr10-pager{padding:13px;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:12px;color:#617984;font-size:8px;font-weight:900}.tr10-pager>span{text-align:right}.tr10-pager div{display:flex;gap:10px;align-items:center}.tr10-pager button,.tr10-pager select{height:32px;border:1px solid rgba(95,148,167,.15);border-radius:8px;background:#071015;color:#b9cad1;padding:0 10px;font-size:8px;font-weight:900}.tr10-pager button:disabled{opacity:.32}
        .tr10-cardGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;padding:14px}.tr10-collectionCard{display:grid;grid-template-columns:auto minmax(0,1fr);gap:12px;align-items:center;padding:14px;border:1px solid rgba(91,163,189,.14);border-radius:13px;background:linear-gradient(180deg,#09171f,#050d12)}.tr10-collectionCard>div{min-width:0}.tr10-collectionCard>div>span{font-size:7px;font-weight:1000;letter-spacing:.12em;color:#5cccec}.tr10-collectionCard h3{margin:3px 0;font-size:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tr10-collectionCard p{margin:0;color:#748b95;font-size:9px}.tr10-collectionCard button{height:34px;border:1px solid rgba(86,184,219,.18);border-radius:8px;background:#07141b;color:#d4e8ef;font-size:8px;font-weight:950}.tr10-collectionCard button:first-of-type{border-color:rgba(255,172,55,.35);color:#ffc164}
        .tr10-playlistLayout{display:grid;grid-template-columns:260px minmax(0,1fr);min-height:420px}.tr10-playlistLayout aside{padding:10px;border-right:1px solid rgba(89,148,169,.1)}.tr10-playlistLayout aside button{width:100%;text-align:left;padding:12px;border:1px solid transparent;border-radius:9px;background:transparent;color:#9eb0b8;display:grid;gap:3px}.tr10-playlistLayout aside button.is-active{background:#0a2430;border-color:rgba(72,200,244,.24);color:#ecf9fd}.tr10-playlistLayout aside span{font-size:8px;color:#708690}.tr10-playlistLayout main{padding:12px}.tr10-playlistHead{display:flex;justify-content:space-between;align-items:center;padding:8px 4px 14px}.tr10-playlistHead h3{margin:3px 0;font-size:24px}.tr10-playlistHead span{font-size:7px;letter-spacing:.12em;color:#5acbf0;font-weight:1000}.tr10-playlistHead>div:last-child{display:flex;gap:6px}.is-danger{border-color:rgba(255,97,97,.32)!important;color:#ff9b9b!important;background:rgba(84,22,24,.18)!important}.tr10-playlistRow{display:grid;grid-template-columns:auto minmax(0,1fr) 60px 55px;gap:10px;align-items:center;padding:8px;border-top:1px solid rgba(91,147,168,.1)}.tr10-playlistRow strong{display:block;font-size:11px}.tr10-playlistRow span{color:#728a94;font-size:9px}
        .tr10-smartGrid{padding:20px;display:grid;grid-template-columns:1fr 1fr auto;gap:14px;align-items:end}.tr10-smartGrid label,.tr10-smartGrid>div{display:grid;gap:8px}.tr10-smartGrid span{font-size:8px;font-weight:1000;letter-spacing:.12em;color:#68838f}.tr10-smartGrid strong{font-size:24px}.tr10-smartGrid>div>button{height:34px;margin-right:5px;border:1px solid rgba(76,166,198,.17);border-radius:8px;background:#07131a;color:#8ca2ac;font-size:8px;font-weight:950}.tr10-smartGrid>div>button.is-active{border-color:rgba(255,171,49,.4);color:#ffc062;background:rgba(100,57,6,.19)}.tr10-smartLaunch{height:50px;padding:0 22px;border:1px solid #ffbd52;border-radius:10px;background:linear-gradient(180deg,#ffc55c,#f49408);font-weight:1000;color:#191007}.tr10-smartCollections{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;padding:0 20px 20px}.tr10-smartCollections button{height:60px;border:1px solid rgba(71,177,214,.16);border-radius:10px;background:#061219;color:#c4dbe3;font-size:9px;font-weight:950}.tr10-smartCollections b{display:block;margin-top:4px;color:#58d8ff}
        .tr10-modalBack{position:fixed;inset:0;z-index:1200;padding:34px 16px;display:grid;place-items:center;background:rgba(0,4,7,.82);backdrop-filter:blur(8px)}.tr10-inspector,.tr10-reviewModal,.tr10-picker{width:min(820px,100%);max-height:calc(100vh - 68px);overflow:auto;border:1px solid rgba(89,199,237,.28);border-radius:17px;background:linear-gradient(180deg,#0c202b,#050d12);box-shadow:0 30px 70px rgba(0,0,0,.58)}.tr10-inspector header,.tr10-reviewModal header,.tr10-picker header{padding:18px 20px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(82,157,184,.12)}.tr10-inspector header>button,.tr10-reviewModal header>button,.tr10-picker header>button{width:36px;height:36px;border:1px solid rgba(105,159,178,.16);border-radius:9px;background:#071219;color:#d4e4ea;font-size:22px}.tr10-inspectIdentity{display:flex;gap:12px;align-items:center}.tr10-inspectIdentity h2,.tr10-reviewModal h2{margin:4px 0 2px;font-size:27px}.tr10-inspectIdentity p,.tr10-reviewModal p{margin:0;color:#7c929c}.tr10-inspectCommands{padding:11px 18px;display:flex;flex-wrap:wrap;gap:6px;border-bottom:1px solid rgba(82,157,184,.1)}.tr10-inspectCommands button,.tr10-artControls button{height:34px;border:1px solid rgba(73,181,219,.18);border-radius:8px;background:#07141b;color:#cbe5ee;padding:0 10px;font-size:8px;font-weight:950}.tr10-inspectCommands button.is-liked{color:#61e3a6}.tr10-inspectCommands button.is-down{color:#ff9191}.tr10-inspectGrid{padding:16px 18px;display:grid;grid-template-columns:1fr 1fr;gap:11px}.tr10-inspectGrid label{display:grid;gap:5px}.tr10-artControls{display:flex;align-items:end;gap:6px}.tr10-artControls>span{margin-right:auto}.tr10-meta{display:grid;grid-template-columns:repeat(3,1fr);margin:0;padding:0 18px 16px}.tr10-meta>div{padding:12px;border:1px solid rgba(85,146,167,.1)}.tr10-meta dt{font-size:7px;font-weight:1000;letter-spacing:.1em;color:#66818c}.tr10-meta dd{margin:4px 0 0;font-size:11px;color:#e4eff3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tr10-inspector footer,.tr10-picker footer{padding:14px 18px;display:flex;justify-content:flex-end;gap:7px;border-top:1px solid rgba(82,157,184,.11)}.tr10-inspector footer button,.tr10-picker footer button{height:38px;padding:0 13px;border:1px solid rgba(83,168,199,.17);border-radius:9px;background:#07131a;color:#d1e3e9;font-size:8px;font-weight:1000}.tr10-inspector footer .is-primary,.tr10-picker footer .is-primary{border-color:rgba(61,205,255,.48);background:#0b3443;color:#d8f7ff}
        .tr10-reviewDock{position:fixed;z-index:1100;right:24px;bottom:84px;height:42px;padding:0 16px;border:1px solid rgba(255,175,57,.55);border-radius:10px;background:linear-gradient(180deg,#4d330d,#241904);color:#ffd07a;font-size:9px;font-weight:1000;box-shadow:0 12px 30px rgba(0,0,0,.4)}.tr10-candidates{padding:12px}.tr10-candidates article{display:grid;grid-template-columns:56px minmax(0,1fr) 50px 90px;gap:11px;align-items:center;padding:10px;border-bottom:1px solid rgba(81,144,167,.11)}.tr10-candidates img,.tr10-candidateArt{width:56px;height:56px;border-radius:9px;object-fit:cover;background:#09202a;display:grid;place-items:center}.tr10-candidates strong{display:block}.tr10-candidates span,.tr10-candidates small{display:block;color:#7d949e;font-size:9px}.tr10-candidates b{color:#64ddff}.tr10-candidates button{height:35px;border:1px solid rgba(76,202,247,.31);border-radius:8px;background:#0b2c39;color:#d4f6ff;font-size:8px;font-weight:1000}
        .tr10-picker>div{padding:12px}.tr10-picker>div>label{display:flex;gap:10px;align-items:center;padding:10px;border-bottom:1px solid rgba(78,142,165,.1)}.tr10-picker>div>label span{display:grid}.tr10-picker>div>label small{color:#718892}.tr10-newRoute{display:grid;gap:5px;padding:12px 18px}
        @media(max-width:900px){.tr10-stats{grid-template-columns:repeat(3,1fr)}.tr10-tabs{grid-template-columns:repeat(5,minmax(120px,1fr));overflow-x:auto}.tr10-toolbar{grid-template-columns:1fr 1fr}.tr10-toolbar label:first-child{grid-column:1/-1}.tr10-tableHead,.tr10-row{grid-template-columns:28px minmax(0,1fr) 56px 86px}.tr10-tableHead span:last-child{display:none}.tr10-actions{grid-column:2/-1;justify-content:flex-start}.tr10-row{padding-top:10px;padding-bottom:10px}.tr10-cardGrid{grid-template-columns:1fr 1fr}.tr10-playlistLayout{grid-template-columns:210px 1fr}.tr10-smartGrid{grid-template-columns:1fr 1fr}.tr10-smartLaunch{grid-column:1/-1}.tr10-smartCollections{grid-template-columns:repeat(3,1fr)}}
        @media(max-width:650px){.tr10-page{width:min(100% - 18px,1180px);margin-bottom:105px}.tr10-hero{padding:18px;display:block}.tr10-hero h1{font-size:28px}.tr10-hero>button{margin-top:14px}.tr10-stats{grid-template-columns:repeat(2,1fr)}.tr10-stats>div:last-child{grid-column:1/-1}.tr10-sectionHead{padding:17px;display:block}.tr10-headActions{margin-top:12px;display:grid;grid-template-columns:1fr 1fr}.tr10-headActions button{padding:0 8px}.tr10-healthRail{padding-left:9px}.tr10-toolbar{grid-template-columns:1fr;padding:10px}.tr10-toolbar label:first-child{grid-column:auto}.tr10-tableHead{display:none}.tr10-row{grid-template-columns:28px minmax(0,1fr);gap:8px;padding:11px 10px}.tr10-row>span,.tr10-row>.tr10-energy{grid-column:2}.tr10-actions{grid-column:2;display:grid;grid-template-columns:42px 42px 1fr 46px}.tr10-track{grid-template-columns:auto auto minmax(0,1fr)}.tr10-healthDot{grid-column:3}.tr10-track span{white-space:normal}.tr10-pager{grid-template-columns:1fr;justify-items:center}.tr10-pager>span{text-align:center}.tr10-cardGrid{grid-template-columns:1fr;padding:10px}.tr10-collectionCard{grid-template-columns:68px minmax(0,1fr)}.tr10-art--card{width:68px;height:68px}.tr10-playlistLayout{grid-template-columns:1fr}.tr10-playlistLayout aside{border-right:0;border-bottom:1px solid rgba(89,148,169,.1);display:flex;overflow-x:auto}.tr10-playlistLayout aside button{min-width:155px}.tr10-smartGrid{grid-template-columns:1fr}.tr10-smartCollections{grid-template-columns:1fr 1fr;padding:0 12px 12px}.tr10-inspectGrid{grid-template-columns:1fr}.tr10-meta{grid-template-columns:1fr 1fr}.tr10-candidates article{grid-template-columns:50px minmax(0,1fr);}.tr10-candidates article>b,.tr10-candidates article>button{grid-column:2}.tr10-reviewDock{right:10px;left:10px;bottom:79px}.tr10-bulk{display:block}.tr10-bulk div{margin-top:8px;display:grid;grid-template-columns:1fr 1fr}.tr10-createPlaylist{margin-top:12px}.tr10-artControls{align-items:center}}
      `}</style>
    </div>
  );
}
