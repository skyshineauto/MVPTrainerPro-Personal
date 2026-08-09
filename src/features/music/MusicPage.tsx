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
  setMusicTrackPreference,
  updateMusicTrack,
  uploadMusicArtwork,
  uploadMusicTrack,
  uploadRemoteMusicArtwork,
  type MusicEnergyLevel,
  type MusicTrack,
} from "../../lib/musicStorage";
import {
  applyMusicMetadataCandidate,
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

type DraftMap = Record<string, { title: string; artist: string; album: string; releaseYear: string; genre: string }>;
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
type DetailMode = "edit" | "info_results" | "artwork_results";
type DetailSaveState = "idle" | "searching" | "saving" | "changed" | "error";
type ReviewItem = { trackId: string; candidates: MusicMetadataCandidate[] };
type EnrichmentState = { running: boolean; current: number; total: number; matched: number; review: number; notFound: number; label: string; serviceMessage: string };

const PLAYLISTS_CHANGED_EVENT = "mvp:music-playlists-changed";

function formatFileSize(bytes: number | null) {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
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
function trackDuration(track: MusicTrack) { return Math.max(120, Number(track.duration_seconds || 210)); }
function artistLabel(track: MusicTrack) { return track.artist?.trim() || "Unknown Artist"; }
function albumLabel(track: MusicTrack) { return track.album?.trim() || "Unknown Album"; }
function energyRank(level: MusicEnergyLevel) { return level === "high" ? 3 : level === "medium" ? 2 : 1; }
function highRotationScore(track: MusicTrack) {
  return track.completed_play_count * 3 + track.play_count * 1.4 + (track.favorite ? 18 : 0) - track.skip_count * 2.7 - (track.play_less ? 35 : 0);
}
function songSortLabel(sort: SongSort) {
  const labels: Record<SongSort, string> = {
    library: "Library order", recently_added: "Recently added", title_asc: "Title A–Z", title_desc: "Title Z–A",
    artist_asc: "Artist A–Z", artist_desc: "Artist Z–A", album_asc: "Album A–Z", most_played: "Most played",
    recently_played: "Recently played", high_rotation: "High rotation", least_played: "Least played", most_skipped: "Most skipped",
    longest: "Longest", shortest: "Shortest", energy_high: "Energy high → low", energy_low: "Energy low → high",
  };
  return labels[sort];
}
function smartMixScore(track: MusicTrack, intensity: SmartIntensity) {
  const target: MusicEnergyLevel = intensity === "high" ? "high" : intensity === "recovery" ? "low" : "medium";
  let score = Math.random() * 5;
  if (track.favorite) score += 48;
  if (track.play_less) score -= 70;
  if (track.energy_level === target) score += 30;
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
  const candidates = tracks.filter((track) => !track.play_less).map((track) => ({ track, score: smartMixScore(track, intensity) })).sort((a, b) => b.score - a.score);
  const selected: MusicTrack[] = [];
  const used = new Set<string>();
  let seconds = 0;
  let lastArtist = "";
  while (selected.length < candidates.length && seconds < targetSeconds) {
    const preferred = candidates.findIndex(({ track }) => !used.has(track.id) && (artistLabel(track).toLowerCase() === "unknown artist" || artistLabel(track).toLowerCase() !== lastArtist));
    const fallback = candidates.findIndex(({ track }) => !used.has(track.id));
    const index = preferred >= 0 ? preferred : fallback;
    if (index < 0) break;
    const track = candidates[index].track;
    selected.push(track); used.add(track.id); seconds += trackDuration(track); lastArtist = artistLabel(track).toLowerCase();
  }
  return selected.length ? selected : tracks.slice(0, 1);
}

function TrackArtwork({ track, size = "row" }: { track: MusicTrack; size?: "row" | "detail" | "card" }) {
  const [url, setUrl] = useState<string | null>(track.external_artwork_url || null);
  useEffect(() => {
    let cancelled = false;
    setUrl(track.external_artwork_url || null);
    void getMusicArtworkSignedUrl(track)
      .then((next) => { if (!cancelled) setUrl(next || track.external_artwork_url || null); })
      .catch(() => { if (!cancelled) setUrl(track.external_artwork_url || null); });
    return () => { cancelled = true; };
  }, [track.id, track.artwork_path, track.external_artwork_url]);
  return <span className={`tr10-art tr10-art--${size}`} aria-hidden>{url ? <img src={url} alt="" /> : <span>♫</span>}</span>;
}

function buildDraftMap(rows: MusicTrack[]): DraftMap {
  return Object.fromEntries(rows.map((track) => [track.id, {
    title: track.title, artist: track.artist || "", album: track.album || "", releaseYear: track.release_year ? String(track.release_year) : "", genre: track.genre || "",
  }]));
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
  const [pageSize, setPageSize] = useState<PageSize>(24);
  const [page, setPage] = useState(1);
  const [selectedSongIds, setSelectedSongIds] = useState<Set<string>>(new Set());
  const [detailTrackId, setDetailTrackId] = useState<string | null>(null);
  const [detailMode, setDetailMode] = useState<DetailMode>("edit");
  const [detailCandidates, setDetailCandidates] = useState<MusicMetadataCandidate[]>([]);
  const [detailSelectedCandidateId, setDetailSelectedCandidateId] = useState<string | null>(null);
  const [detailPendingCandidate, setDetailPendingCandidate] = useState<MusicMetadataCandidate | null>(null);
  const [detailSaveState, setDetailSaveState] = useState<DetailSaveState>("idle");
  const [detailStatusText, setDetailStatusText] = useState("");
  const [playlistModalTrackIds, setPlaylistModalTrackIds] = useState<string[]>([]);
  const [playlistModalSelections, setPlaylistModalSelections] = useState<Set<string>>(new Set());
  const [playlistModalName, setPlaylistModalName] = useState("");
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [reviewTrackId, setReviewTrackId] = useState<string | null>(null);
  const [reviewSelectedCandidateId, setReviewSelectedCandidateId] = useState<string | null>(null);
  const [reviewSavedIds, setReviewSavedIds] = useState<Set<string>>(new Set());
  const [reviewSkippedIds, setReviewSkippedIds] = useState<Set<string>>(new Set());
  const [smartMinutes, setSmartMinutes] = useState(60);
  const [smartIntensity, setSmartIntensity] = useState<SmartIntensity>("high");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [enrichment, setEnrichment] = useState<EnrichmentState>({ running: false, current: 0, total: 0, matched: 0, review: 0, notFound: 0, label: "", serviceMessage: "" });

  const totalSize = useMemo(() => tracks.reduce((sum, track) => sum + Number(track.file_size_bytes || 0), 0), [tracks]);
  const totalDuration = useMemo(() => tracks.reduce((sum, track) => sum + Number(track.duration_seconds || 0), 0), [tracks]);
  const artistCount = useMemo(() => new Set(tracks.map((track) => artistLabel(track).toLowerCase()).filter((value) => value !== "unknown artist")).size, [tracks]);
  const albumCount = useMemo(() => new Set(tracks.map((track) => `${artistLabel(track)}|${albumLabel(track)}`.toLowerCase()).filter((value) => !value.endsWith("|unknown album"))).size, [tracks]);
  const likedCount = useMemo(() => tracks.filter((track) => track.favorite).length, [tracks]);
  const needsInfoCount = useMemo(() => tracks.filter(needsMusicMetadata).length, [tracks]);
  const missingArtCount = useMemo(() => tracks.filter(needsMusicArtwork).length, [tracks]);
  const reviewCount = useMemo(() => tracks.filter((track) => track.metadata_status === "review").length, [tracks]);

  const detailTrack = useMemo(() => tracks.find((track) => track.id === detailTrackId) || null, [tracks, detailTrackId]);
  const detailDraft = detailTrack ? drafts[detailTrack.id] : null;
  const detailSelectedCandidate = useMemo(() => detailCandidates.find((candidate) => candidate.sourceId === detailSelectedCandidateId) || null, [detailCandidates, detailSelectedCandidateId]);
  const detailDirty = Boolean(detailTrack && detailDraft && (
    detailDraft.title.trim() !== detailTrack.title.trim() || detailDraft.artist.trim() !== (detailTrack.artist || "").trim() || detailDraft.album.trim() !== (detailTrack.album || "").trim() ||
    detailDraft.releaseYear.trim() !== (detailTrack.release_year ? String(detailTrack.release_year) : "") || detailDraft.genre.trim() !== (detailTrack.genre || "").trim() || detailPendingCandidate
  ));

  const reviewTrack = useMemo(() => tracks.find((track) => track.id === reviewTrackId) || null, [tracks, reviewTrackId]);
  const reviewCandidates = useMemo(() => reviewItems.find((item) => item.trackId === reviewTrackId)?.candidates || [], [reviewItems, reviewTrackId]);
  const reviewSelectedCandidate = useMemo(() => reviewCandidates.find((candidate) => candidate.sourceId === reviewSelectedCandidateId) || null, [reviewCandidates, reviewSelectedCandidateId]);
  const reviewIndex = useMemo(() => reviewTrackId ? reviewItems.findIndex((item) => item.trackId === reviewTrackId) : -1, [reviewItems, reviewTrackId]);
  const reviewResolvedIds = useMemo(() => new Set([...reviewSavedIds, ...reviewSkippedIds]), [reviewSavedIds, reviewSkippedIds]);
  const reviewRemainingCount = reviewItems.filter((item) => !reviewResolvedIds.has(item.trackId)).length;

  const artistGroups = useMemo(() => {
    const map = new Map<string, MusicTrack[]>();
    tracks.forEach((track) => { const key = artistLabel(track); map.set(key, [...(map.get(key) || []), track]); });
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [tracks]);
  const albumGroups = useMemo(() => {
    const map = new Map<string, { album: string; artist: string; tracks: MusicTrack[] }>();
    tracks.forEach((track) => { const album = albumLabel(track); const artist = artistLabel(track); const key = `${artist}|||${album}`; const group = map.get(key) || { album, artist, tracks: [] }; group.tracks.push(track); map.set(key, group); });
    return [...map.values()].sort((a, b) => a.album.localeCompare(b.album));
  }, [tracks]);

  const filteredTracks = useMemo(() => {
    const query = songSearch.trim().toLowerCase();
    const next = tracks.filter((track) => {
      const matchesSearch = !query || `${track.title} ${track.artist || ""} ${track.album || ""} ${track.genre || ""} ${track.original_name}`.toLowerCase().includes(query);
      if (!matchesSearch) return false;
      if (energyFilter !== "all" && track.energy_level !== energyFilter) return false;
      if (healthFilter === "needs_info" && !needsMusicMetadata(track)) return false;
      if (healthFilter === "missing_art" && !needsMusicArtwork(track)) return false;
      if (healthFilter === "liked" && !track.favorite) return false;
      if (healthFilter === "review" && track.metadata_status !== "review" && !reviewItems.some((item) => item.trackId === track.id)) return false;
      return true;
    });
    return [...next].sort((a, b) => {
      if (songSort === "recently_added") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (songSort === "title_asc") return a.title.localeCompare(b.title);
      if (songSort === "title_desc") return b.title.localeCompare(a.title);
      if (songSort === "artist_asc") return artistLabel(a).localeCompare(artistLabel(b));
      if (songSort === "artist_desc") return artistLabel(b).localeCompare(artistLabel(a));
      if (songSort === "album_asc") return albumLabel(a).localeCompare(albumLabel(b));
      if (songSort === "most_played") return b.play_count - a.play_count;
      if (songSort === "recently_played") return new Date(b.last_played_at || 0).getTime() - new Date(a.last_played_at || 0).getTime();
      if (songSort === "high_rotation") return highRotationScore(b) - highRotationScore(a);
      if (songSort === "least_played") return a.play_count - b.play_count;
      if (songSort === "most_skipped") return b.skip_count - a.skip_count;
      if (songSort === "longest") return Number(b.duration_seconds || 0) - Number(a.duration_seconds || 0);
      if (songSort === "shortest") return Number(a.duration_seconds || 0) - Number(b.duration_seconds || 0);
      if (songSort === "energy_high") return energyRank(b.energy_level) - energyRank(a.energy_level);
      if (songSort === "energy_low") return energyRank(a.energy_level) - energyRank(b.energy_level);
      return a.sort_order - b.sort_order;
    });
  }, [tracks, songSearch, songSort, energyFilter, healthFilter, reviewItems]);

  const pageCount = Math.max(1, Math.ceil(filteredTracks.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pagedTracks = filteredTracks.slice((safePage - 1) * pageSize, safePage * pageSize);
  const selectedCount = selectedSongIds.size;
  const allVisibleSelected = Boolean(pagedTracks.length && pagedTracks.every((track) => selectedSongIds.has(track.id)));

  useEffect(() => { setPage(1); }, [songSearch, songSort, energyFilter, healthFilter, pageSize]);

  async function refreshTracks() {
    const rows = await listMusicTracks();
    setTracks(rows); setDrafts(buildDraftMap(rows)); replaceMusicLibrary(rows);
    return rows;
  }
  async function refreshPlaylists(preferredId?: string | null) {
    const rows = await listMusicPlaylists();
    const entries = await Promise.all(rows.map(async (playlist) => [playlist.id, (await listMusicPlaylistTrackLinks(playlist.id)).map((link) => link.track_id)] as const));
    setPlaylists(rows); setPlaylistTrackIds(Object.fromEntries(entries));
    setSelectedPlaylistId((current) => preferredId && rows.some((p) => p.id === preferredId) ? preferredId : current && rows.some((p) => p.id === current) ? current : rows[0]?.id || null);
  }
  useEffect(() => {
    void Promise.all([refreshTracks(), refreshPlaylists(), loadMusicLibrary(true)]).catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load your music library.")).finally(() => setLoading(false));
  }, []);

  function replaceTrackLocally(updated: MusicTrack) {
    setTracks((current) => { const next = current.map((track) => track.id === updated.id ? updated : track); replaceMusicLibrary(next); return next; });
    setDrafts((current) => ({ ...current, [updated.id]: { title: updated.title, artist: updated.artist || "", album: updated.album || "", releaseYear: updated.release_year ? String(updated.release_year) : "", genre: updated.genre || "" } }));
  }

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true); setMessage(""); setError("");
    try {
      let order = tracks.length;
      for (const file of Array.from(files)) { setMessage(`Uploading ${file.name}…`); await uploadMusicTrack(file, order++); }
      await refreshTracks(); setMessage(`${files.length} song${files.length === 1 ? "" : "s"} uploaded.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Music upload failed."); }
    finally { setUploading(false); if (inputRef.current) inputRef.current.value = ""; }
  }

  async function toggleTrackPlayback(track: MusicTrack) {
    try {
      const current = player.currentTrack?.id === track.id;
      if (current && player.playing) pauseMusic(); else if (current) await playMusic(); else { activateAllMusicTracks(); await playMusicTrack(track.id, 0); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not play this song."); }
  }
  async function changePreference(track: MusicTrack, preference: "like" | "play_less" | "neutral") {
    try {
      const updated = await setMusicTrackPreference(track.id, preference); replaceTrackLocally(updated); await setPlayerMusicPreference(track.id, preference);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not update preference."); }
  }
  async function setEnergy(track: MusicTrack, energy: MusicEnergyLevel) {
    try { replaceTrackLocally(await updateMusicTrack(track.id, { energy_level: energy })); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not update energy."); }
  }
  async function moveTrack(trackId: string, direction: -1 | 1) {
    const index = tracks.findIndex((track) => track.id === trackId); const target = index + direction;
    if (index < 0 || target < 0 || target >= tracks.length) return;
    const next = [...tracks]; [next[index], next[target]] = [next[target], next[index]]; setTracks(next); replaceMusicLibrary(next);
    try { await saveMusicTrackOrder(next); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save song order."); await refreshTracks(); }
  }

  function openDetail(track: MusicTrack) {
    setDetailTrackId(track.id); setDetailMode("edit"); setDetailCandidates([]); setDetailSelectedCandidateId(null); setDetailPendingCandidate(null); setDetailSaveState("idle"); setDetailStatusText("");
  }
  function closeDetail() {
    setDetailTrackId(null); setDetailMode("edit"); setDetailCandidates([]); setDetailSelectedCandidateId(null); setDetailPendingCandidate(null); setDetailSaveState("idle"); setDetailStatusText("");
  }
  async function saveTrack(track: MusicTrack) {
    const draft = drafts[track.id]; if (!draft || detailSaveState === "saving") return;
    setBusyId(track.id); setDetailSaveState("saving"); setDetailStatusText("Saving changes to your library…"); setError("");
    try {
      let updated = await updateMusicTrack(track.id, { title: draft.title, artist: draft.artist, album: draft.album, release_year: draft.releaseYear ? Number(draft.releaseYear) : null, genre: draft.genre, metadata_status: "manual", metadata_confidence: 1, metadata_source: detailPendingCandidate?.source || "manual", metadata_updated_at: new Date().toISOString() });
      if (detailPendingCandidate?.artworkUrl && needsMusicArtwork(updated)) updated = await uploadRemoteMusicArtwork(updated, detailPendingCandidate.artworkUrl);
      replaceTrackLocally(updated); setDetailPendingCandidate(null); setDetailSaveState("changed"); setDetailStatusText("✓ CHANGED");
      window.setTimeout(() => setDetailTrackId((current) => current === track.id ? null : current), 1200);
    } catch (caught) { setDetailSaveState("error"); setDetailStatusText(caught instanceof Error ? caught.message : "Could not save song information."); }
    finally { setBusyId(null); }
  }
  async function replaceArtwork(track: MusicTrack, file: File | null) {
    if (!file) return; setBusyId(`art-${track.id}`); setDetailStatusText("Updating artwork…");
    try { replaceTrackLocally(await uploadMusicArtwork(track, file)); setDetailStatusText("Artwork changed ✓"); }
    catch (caught) { setDetailStatusText(caught instanceof Error ? caught.message : "Could not update artwork."); }
    finally { setBusyId(null); if (artworkInputRef.current) artworkInputRef.current.value = ""; }
  }
  async function clearArtwork(track: MusicTrack) {
    setBusyId(`art-${track.id}`); setDetailStatusText("Removing artwork…");
    try { replaceTrackLocally(await removeMusicArtwork(track)); setDetailStatusText("Artwork removed ✓"); }
    catch (caught) { setDetailStatusText(caught instanceof Error ? caught.message : "Could not remove artwork."); }
    finally { setBusyId(null); }
  }
  async function deleteTrack(track: MusicTrack) {
    if (!window.confirm(`Delete “${track.title}” from your private music library?`)) return;
    setBusyId(track.id);
    try { await removeMusicTrack(track.id); closeDetail(); await refreshTracks(); setMessage("Song deleted."); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not delete song."); }
    finally { setBusyId(null); }
  }

  async function findDetailMatches(track: MusicTrack, mode: "info_results" | "artwork_results") {
    setDetailMode(mode); setDetailSaveState("searching"); setDetailStatusText(mode === "artwork_results" ? "Searching the identified recording for album artwork…" : "Searching for the exact recording…"); setDetailCandidates([]); setDetailSelectedCandidateId(null);
    try {
      const candidates = await findMusicMetadataCandidates(track, {
        onRetry: ({ status, delayMs }) => {
          setDetailStatusText(
            `Lookup service busy${status ? ` (${status})` : ""} • retrying automatically in ${Math.max(1, Math.ceil(delayMs / 1000))}s…`
          );
        },
      });
      setDetailCandidates(candidates); setDetailSelectedCandidateId(candidates[0]?.sourceId || null); setDetailSaveState("idle");
      setDetailStatusText(candidates.length ? `${candidates.length} possible match${candidates.length === 1 ? "" : "es"} found • Best ${Math.round(candidates[0].confidence * 100)}%` : "No reliable matches found. Check the title/artist and search again.");
    } catch (caught) { setDetailSaveState("error"); setDetailStatusText(caught instanceof Error ? caught.message : "Music lookup failed."); }
  }
  function applyDetailInfoCandidate(candidate: MusicMetadataCandidate) {
    if (!detailTrack) return;
    setDrafts((current) => ({ ...current, [detailTrack.id]: { title: candidate.title, artist: candidate.artist, album: candidate.album, releaseYear: candidate.releaseYear ? String(candidate.releaseYear) : "", genre: candidate.genre || "" } }));
    setDetailPendingCandidate(candidate); setDetailMode("edit"); setDetailSaveState("idle"); setDetailStatusText(`Match loaded • ${musicMatchTier(candidate.confidence)} • Review it, then SAVE CHANGES.`);
  }
  async function applyDetailArtworkCandidate(candidate: MusicMetadataCandidate) {
    if (!detailTrack || !candidate.artworkUrl) { setDetailStatusText("That result has no usable artwork."); return; }
    setDetailSaveState("saving"); setDetailStatusText("Applying selected artwork…");
    try { replaceTrackLocally(await uploadRemoteMusicArtwork(detailTrack, candidate.artworkUrl)); setDetailMode("edit"); setDetailSaveState("changed"); setDetailStatusText("✓ ARTWORK CHANGED"); window.setTimeout(() => { setDetailSaveState("idle"); setDetailStatusText(""); }, 1300); }
    catch (caught) { setDetailSaveState("error"); setDetailStatusText(caught instanceof Error ? caught.message : "Could not apply artwork."); }
  }

  async function enrichTracks(targets: MusicTrack[], artworkOnly = false) {
    const work = artworkOnly ? targets.filter(needsMusicArtwork) : targets;
    if (!work.length) {
      setMessage(artworkOnly ? "Selected songs already have artwork. Existing artwork is protected." : "No songs were selected for identification.");
      return;
    }

    setError("");
    setMessage("");
    setReviewItems([]);
    setReviewTrackId(null);
    setReviewSelectedCandidateId(null);
    setReviewSavedIds(new Set());
    setReviewSkippedIds(new Set());

    let matched = 0;
    let review = 0;
    let notFound = 0;
    const reviewQueue: ReviewItem[] = [];

    setEnrichment({
      running: true, current: 0, total: work.length, matched: 0, review: 0, notFound: 0,
      label: artworkOnly ? "FINDING ARTWORK" : "ANALYZING MUSIC LIBRARY",
      serviceMessage: "Preparing protected library scan…",
    });

    try {
      for (let index = 0; index < work.length; index += 1) {
        const track = work[index];
        const currentNumber = index + 1;

        setEnrichment({
          running: true, current: currentNumber, total: work.length, matched, review, notFound,
          label: `${artworkOnly ? "FINDING ART" : "ANALYZING"} • ${track.title}`,
          serviceMessage: [artistLabel(track), track.album].filter(Boolean).join(" • ") || "Matching title, filename and duration…",
        });

        try {
          const result = await enrichMusicTrack(track, {
            artworkOnly,
            autoApplyThreshold: 0.98,
            onLookupRetry: ({ status, attempt, delayMs }) => {
              setEnrichment((current) => ({
                ...current,
                label: "LOOKUP SERVICE BUSY • RETRYING",
                serviceMessage: `${track.title} • retry ${attempt}${status ? ` • service ${status}` : ""} • ${Math.max(1, Math.ceil(delayMs / 1000))}s`,
              }));
            },
          });

          if (result.status === "matched") matched += 1;
          else if (result.status === "review") {
            review += 1;
            if (result.candidates.length) reviewQueue.push({ trackId: track.id, candidates: result.candidates });
          } else if (result.status === "not_found") {
            notFound += 1;
          }
        } catch (caught) {
          // A temporary catalog failure should not throw away the songs already
          // processed. Count this track as not found and continue the scan.
          notFound += 1;
          setEnrichment((current) => ({
            ...current,
            label: "LOOKUP SKIPPED • CONTINUING",
            serviceMessage: caught instanceof Error ? caught.message : `Could not analyze ${track.title}.`,
          }));
          await delayMusicLookup(900);
        }

        setEnrichment((current) => ({
          ...current,
          current: currentNumber,
          matched,
          review,
          notFound,
        }));
        await delayMusicLookup();
      }

      await refreshTracks();
      setReviewItems(reviewQueue);
      setEnrichment({
        running: false, current: work.length, total: work.length, matched, review, notFound,
        label: artworkOnly ? "ARTWORK SCAN COMPLETE" : "LIBRARY ANALYSIS COMPLETE",
        serviceMessage: reviewQueue.length ? "Opening possible matches…" : "Scan complete.",
      });

      if (reviewQueue.length) {
        const first = reviewQueue[0];
        setReviewTrackId(first.trackId);
        setReviewSelectedCandidateId(first.candidates[0]?.sourceId || null);
      } else {
        setMessage(`${matched} matched${notFound ? ` • ${notFound} not found` : ""}. Existing artwork was not replaced.`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not finish library enrichment.");
      setEnrichment((current) => ({ ...current, running: false }));
    }
  }

  function openReviewQueue() {
    const next = reviewItems.find((item) => !reviewResolvedIds.has(item.trackId));
    if (!next) return;
    setReviewTrackId(next.trackId); setReviewSelectedCandidateId(next.candidates[0]?.sourceId || null);
  }
  function advanceReview(currentTrackId: string) {
    const resolved = new Set([...reviewResolvedIds, currentTrackId]);
    const next = reviewItems.find((item) => !resolved.has(item.trackId));
    if (!next) { setReviewTrackId(null); setReviewSelectedCandidateId(null); return; }
    setReviewTrackId(next.trackId); setReviewSelectedCandidateId(next.candidates[0]?.sourceId || null);
  }
  async function saveReviewCandidate(advance = false) {
    if (!reviewTrack || !reviewSelectedCandidate) return;
    setBusyId(`match-${reviewTrack.id}`);
    try {
      const updated = await applyMusicMetadataCandidate(reviewTrack, reviewSelectedCandidate, "manual"); replaceTrackLocally(updated);
      setReviewSavedIds((current) => new Set(current).add(reviewTrack.id)); setMessage("Correct song information saved.");
      if (advance) advanceReview(reviewTrack.id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save this match."); }
    finally { setBusyId(null); }
  }
  function skipReview() {
    if (!reviewTrack) return;
    const id = reviewTrack.id; setReviewSkippedIds((current) => new Set(current).add(id)); advanceReview(id);
  }

  function toggleSongSelection(trackId: string) {
    setSelectedSongIds((current) => { const next = new Set(current); next.has(trackId) ? next.delete(trackId) : next.add(trackId); return next; });
  }
  function toggleSelectVisible() {
    setSelectedSongIds((current) => { const next = new Set(current); pagedTracks.forEach((track) => allVisibleSelected ? next.delete(track.id) : next.add(track.id)); return next; });
  }

  function openPlaylistModal(trackIds: string[]) {
    const ids = Array.from(new Set(trackIds)); if (!ids.length) return;
    const selected = new Set<string>();
    playlists.forEach((playlist) => { const existing = new Set(playlistTrackIds[playlist.id] || []); if (ids.every((id) => existing.has(id))) selected.add(playlist.id); });
    setPlaylistModalTrackIds(ids); setPlaylistModalSelections(selected); setPlaylistModalName("");
  }
  async function savePlaylistMemberships() {
    if (!playlistModalTrackIds.length) return;
    setBusyId("playlist-route");
    try {
      let preferred: string | null = null;
      if (playlistModalName.trim()) { const created = await createMusicPlaylist(playlistModalName.trim()); preferred = created.id; await replaceMusicPlaylistTracks(created.id, playlistModalTrackIds); }
      for (const playlist of playlists) {
        const current = playlistTrackIds[playlist.id] || []; const chosen = playlistModalSelections.has(playlist.id); const targets = new Set(playlistModalTrackIds);
        const next = chosen ? Array.from(new Set([...current, ...playlistModalTrackIds])) : current.filter((id) => !targets.has(id));
        if (next.join("|") !== current.join("|")) await replaceMusicPlaylistTracks(playlist.id, next);
      }
      await refreshPlaylists(preferred || selectedPlaylistId); setPlaylistModalTrackIds([]); setPlaylistModalSelections(new Set()); setPlaylistModalName(""); setSelectedSongIds(new Set()); setMessage("Playlist routing updated."); window.dispatchEvent(new Event(PLAYLISTS_CHANGED_EVENT));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not update playlists."); }
    finally { setBusyId(null); }
  }
  async function createPlaylist() {
    if (!newPlaylistName.trim()) return;
    try { const created = await createMusicPlaylist(newPlaylistName.trim()); setNewPlaylistName(""); await refreshPlaylists(created.id); setSelectedPlaylistId(created.id); setMessage("Playlist created."); window.dispatchEvent(new Event(PLAYLISTS_CHANGED_EVENT)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create playlist."); }
  }
  async function removePlaylist(playlist: MusicPlaylist) {
    if (!window.confirm(`Delete playlist “${playlist.name}”? Your songs remain in the library.`)) return;
    try { await deleteMusicPlaylist(playlist.id); await refreshPlaylists(null); setMessage("Playlist deleted. Songs were not deleted."); window.dispatchEvent(new Event(PLAYLISTS_CHANGED_EVENT)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not delete playlist."); }
  }

  const selectedPlaylist = playlists.find((playlist) => playlist.id === selectedPlaylistId) || null;
  const selectedPlaylistTracks = selectedPlaylist ? (playlistTrackIds[selectedPlaylist.id] || []).map((id) => tracks.find((track) => track.id === id)).filter((track): track is MusicTrack => Boolean(track)) : [];
  async function savePlaylistOrder(next: MusicTrack[]) {
    if (!selectedPlaylist) return;
    const ids = next.map((track) => track.id);
    setPlaylistTrackIds((current) => ({ ...current, [selectedPlaylist.id]: ids }));
    try { await replaceMusicPlaylistTracks(selectedPlaylist.id, ids); window.dispatchEvent(new Event(PLAYLISTS_CHANGED_EVENT)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save playlist order."); await refreshPlaylists(selectedPlaylist.id); }
  }
  async function playSelectedPlaylist(trackId?: string) {
    if (!selectedPlaylist || !selectedPlaylistTracks.length) return;
    try { await playMusicPlaylist(selectedPlaylist, selectedPlaylistTracks, trackId); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not play playlist."); }
  }
  async function buildAndPlaySmartMix() {
    const mix = buildSmartMix(tracks, smartMinutes, smartIntensity);
    if (!mix.length) { setError("Upload songs before building a Smart Mix."); return; }
    await playMusicAdHocQueue(`Smart Mix • ${smartIntensity === "high" ? "High Energy" : smartIntensity === "recovery" ? "Recovery" : "Balanced"}`, mix);
    setMessage(`Smart Mix started with ${mix.length} songs.`);
  }

  function goBack() { if (navigate) navigate("/"); else window.location.pathname = "/"; }

  return (
    <main className="tr10-page">
      <section className="tr10-hero">
        <div><span>MVP TRAINER • PRIVATE MUSIC</span><h1>My Music</h1><p>Your uploaded workout library, playlists, Smart Mix, likes, play-less preferences, metadata and artwork.</p></div>
        <button type="button" onClick={goBack}>BACK TO TRAINER</button>
      </section>

      <section className="tr10-stats">
        <div><strong>{tracks.length}</strong><span>SONGS</span></div><div><strong>{artistCount}</strong><span>ARTISTS</span></div><div><strong>{albumCount}</strong><span>ALBUMS</span></div><div><strong>{formatLongDuration(totalDuration)}</strong><span>PLAY TIME</span></div><div><strong>{likedCount}</strong><span>LIKED</span></div>
      </section>

      <section className="tr10-console">
        <header className="tr10-sectionHead">
          <div><span>PRIVATE AUDIO LIBRARY</span><h2>Song Library</h2><p>{formatFileSize(totalSize)} stored • {tracks.length} songs</p></div>
          <div className="tr10-headActions">
            <input ref={inputRef} hidden type="file" multiple accept=".mp3,.m4a,.wav,audio/*" onChange={(event) => void uploadFiles(event.target.files)} />
            <button type="button" disabled={enrichment.running} onClick={() => void enrichTracks(tracks.filter((track) => needsMusicMetadata(track) || needsMusicArtwork(track)))}>{enrichment.running ? "SCANNING…" : "ENRICH LIBRARY"}</button>
            <button type="button" className="is-orange" disabled={uploading} onClick={() => inputRef.current?.click()}>{uploading ? "UPLOADING…" : "+ UPLOAD SONGS"}</button>
          </div>
        </header>

        <section className="tr10-statusPanel" aria-label="Library status filters">
          <div className="tr10-statusPanelHead"><span>LIBRARY STATUS</span><small>FILTER SONGS BY CONDITION</small></div>
          <div className="tr10-healthRail">
            <button className={healthFilter === "all" ? "is-active" : ""} onClick={() => setHealthFilter("all")}><span>ALL SONGS</span><b>{tracks.length}</b></button>
            <button className={`${healthFilter === "needs_info" ? "is-active " : ""}is-needs`} onClick={() => setHealthFilter("needs_info")}><span>NEEDS INFO</span><b>{needsInfoCount}</b></button>
            <button className={`${healthFilter === "missing_art" ? "is-active " : ""}is-art`} onClick={() => setHealthFilter("missing_art")}><span>MISSING ART</span><b>{missingArtCount}</b></button>
            <button className={`${healthFilter === "liked" ? "is-active " : ""}is-liked`} onClick={() => setHealthFilter("liked")}><span>LIKED</span><b>{likedCount}</b></button>
            <button className={`${healthFilter === "review" ? "is-active " : ""}is-review`} onClick={() => setHealthFilter("review")}><span>REVIEW</span><b>{Math.max(reviewCount, reviewItems.length)}</b></button>
          </div>
        </section>

        <nav className="tr10-tabs">
          {([ ["songs","SONGS"], ["artists","ARTISTS"], ["albums","ALBUMS"], ["playlists","PLAYLISTS"], ["smart","SMART MIX"] ] as Array<[MusicTab,string]>).map(([value,label]) => <button type="button" key={value} className={tab === value ? "is-active" : ""} onClick={() => setTab(value)}>{label}</button>)}
        </nav>

        {message ? <div className="tr10-message">{message}</div> : null}
        {error ? <div className="tr10-error">{error}</div> : null}

        {tab === "songs" ? <>
          <div className="tr10-toolbar">
            <label><span>SEARCH</span><input value={songSearch} onChange={(event) => setSongSearch(event.target.value)} placeholder="Song, artist, album, or file…" /></label>
            <label><span>ENERGY</span><select value={energyFilter} onChange={(event) => setEnergyFilter(event.target.value as EnergyFilter)}><option value="all">All energy</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
            <label><span>SORT</span><select value={songSort} onChange={(event) => setSongSort(event.target.value as SongSort)}>{(["library","recently_added","title_asc","title_desc","artist_asc","artist_desc","album_asc","most_played","recently_played","high_rotation","least_played","most_skipped","longest","shortest","energy_high","energy_low"] as SongSort[]).map((sort) => <option key={sort} value={sort}>{songSortLabel(sort)}</option>)}</select></label>
            <label><span>SHOW</span><select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value) as PageSize)}><option value={12}>12</option><option value={24}>24</option><option value={48}>48</option></select></label>
          </div>

          {selectedCount ? <div className="tr10-bulk"><strong>{selectedCount} SELECTED</strong><div><button onClick={() => openPlaylistModal([...selectedSongIds])}>+ PLAYLIST</button><button onClick={() => void enrichTracks(tracks.filter((track) => selectedSongIds.has(track.id)))}>IDENTIFY</button><button onClick={() => void enrichTracks(tracks.filter((track) => selectedSongIds.has(track.id)), true)}>FIND ART</button><button onClick={() => setSelectedSongIds(new Set())}>CLEAR</button></div></div> : null}

          <div className="tr10-table">
            <div className="tr10-tableHead"><label><input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectVisible} /></label><span>TRACK</span><span>TIME</span><span>ENERGY</span><span>ACTIONS</span></div>
            {loading ? <div className="tr10-empty">Loading your music…</div> : null}
            {!loading && !pagedTracks.length ? <div className="tr10-empty">No songs match this view.</div> : null}
            {pagedTracks.map((track) => {
              const current = player.currentTrack?.id === track.id;
              const needsInfo = needsMusicMetadata(track);
              const missingArt = needsMusicArtwork(track);
              return <article className={`tr10-row ${current ? "is-current" : ""}`} key={track.id}>
                <label className="tr10-check"><input type="checkbox" checked={selectedSongIds.has(track.id)} onChange={() => toggleSongSelection(track.id)} /></label>
                <div className="tr10-trackCell">
                  <button className={`tr10-play ${current && player.playing ? "is-playing" : ""}`} onClick={() => void toggleTrackPlayback(track)}>{current && player.playing ? "Ⅱ" : "▶"}</button>
                  <TrackArtwork track={track} />
                  <div className="tr10-trackText"><strong>{track.title}</strong><span>{artistLabel(track)}{track.album ? ` • ${track.album}` : ""}</span><small>{track.original_name}</small></div>
                  {needsInfo ? <em className="tr10-healthBadge is-needs">NEEDS INFO</em> : missingArt ? <em className="tr10-healthBadge is-art">MISSING ART</em> : null}
                </div>
                <span className="tr10-duration">{formatDuration(track.duration_seconds)}</span>
                <button className={`tr10-energy is-${track.energy_level}`} onClick={() => void setEnergy(track, track.energy_level === "low" ? "medium" : track.energy_level === "medium" ? "high" : "low")} title="Click to change energy"><i className="tr10-energyLed" /><span>{track.energy_level.toUpperCase()}</span><b className="tr10-energySegments" aria-hidden><i /><i /><i /></b></button>
                <div className="tr10-actions">
                  <button className={track.favorite ? "is-liked" : ""} onClick={() => void changePreference(track, track.favorite ? "neutral" : "like")} title="Like">👍</button>
                  <button className={track.play_less ? "is-down" : ""} onClick={() => void changePreference(track, track.play_less ? "neutral" : "play_less")} title="Play less">👎</button>
                  <button onClick={() => playMusicNext(track.id)}>PLAY NEXT</button><button onClick={() => addMusicToQueue(track.id)}>+ QUEUE</button><button onClick={() => openPlaylistModal([track.id])}>+ LIST</button><button className="is-edit" onClick={() => openDetail(track)}>EDIT</button>
                </div>
                <div className="tr10-order"><button disabled={tracks.findIndex((item) => item.id === track.id) === 0} onClick={() => void moveTrack(track.id,-1)}>↑</button><button disabled={tracks.findIndex((item) => item.id === track.id) === tracks.length - 1} onClick={() => void moveTrack(track.id,1)}>↓</button></div>
              </article>;
            })}
          </div>

          <div className="tr10-pager"><span>{filteredTracks.length ? `${(safePage - 1) * pageSize + 1}–${Math.min(safePage * pageSize, filteredTracks.length)} OF ${filteredTracks.length}` : "0 SONGS"}</span><div><button disabled={safePage <= 1} onClick={() => setPage((value) => Math.max(1,value-1))}>PREV</button><b>{safePage} / {pageCount}</b><button disabled={safePage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount,value+1))}>NEXT</button></div></div>
        </> : null}

        {tab === "artists" ? <div className="tr10-cardGrid">{artistGroups.map(([artist,songs]) => <article className="tr10-collectionCard" key={artist}><TrackArtwork track={songs[0]} size="card" /><div><small>ARTIST</small><h3>{artist}</h3><p>{songs.length} SONG{songs.length === 1 ? "" : "S"} • {formatLongDuration(songs.reduce((sum,track) => sum + Number(track.duration_seconds || 0),0))}</p></div><button onClick={() => void playMusicAdHocQueue(artist,songs)}>▶ PLAY</button></article>)}</div> : null}

        {tab === "albums" ? <div className="tr10-cardGrid">{albumGroups.map((group) => <article className="tr10-collectionCard" key={`${group.artist}-${group.album}`}><TrackArtwork track={group.tracks[0]} size="card" /><div><small>ALBUM</small><h3>{group.album}</h3><p>{group.artist} • {group.tracks.length} SONG{group.tracks.length === 1 ? "" : "S"}</p></div><button onClick={() => void playMusicAdHocQueue(group.album,group.tracks)}>▶ PLAY</button></article>)}</div> : null}

        {tab === "playlists" ? <div className="tr10-playlistLayout">
          <aside><div className="tr10-createPlaylist"><input value={newPlaylistName} onChange={(event) => setNewPlaylistName(event.target.value)} placeholder="New playlist" /><button onClick={() => void createPlaylist()}>+</button></div>{playlists.map((playlist) => <button key={playlist.id} className={selectedPlaylistId === playlist.id ? "is-active" : ""} onClick={() => setSelectedPlaylistId(playlist.id)}><strong>{playlist.name}</strong><span>{(playlistTrackIds[playlist.id] || []).length} SONGS</span></button>)}</aside>
          <section className="tr10-playlistConsole">{selectedPlaylist ? <><header><div><small>PLAYLIST</small><h2>{selectedPlaylist.name}</h2></div><div><button className="is-primary" disabled={!selectedPlaylistTracks.length} onClick={() => void playSelectedPlaylist()}>▶ PLAY</button><button className="is-danger" onClick={() => void removePlaylist(selectedPlaylist)}>DELETE</button></div></header><div className="tr10-playlistSongs">{selectedPlaylistTracks.map((track,index) => <article key={track.id}><b>{String(index+1).padStart(2,"0")}</b><TrackArtwork track={track} /><div><strong>{track.title}</strong><span>{artistLabel(track)}</span></div><button onClick={() => void playSelectedPlaylist(track.id)}>▶</button><button disabled={index===0} onClick={() => { const next=[...selectedPlaylistTracks]; [next[index-1],next[index]]=[next[index],next[index-1]]; void savePlaylistOrder(next); }}>↑</button><button disabled={index===selectedPlaylistTracks.length-1} onClick={() => { const next=[...selectedPlaylistTracks]; [next[index+1],next[index]]=[next[index],next[index+1]]; void savePlaylistOrder(next); }}>↓</button><button className="is-danger" onClick={() => void savePlaylistOrder(selectedPlaylistTracks.filter((item) => item.id !== track.id))}>REMOVE</button></article>)}</div><button className="tr10-addSelected" disabled={!selectedSongIds.size} onClick={() => openPlaylistModal([...selectedSongIds])}>+ ADD {selectedSongIds.size || ""} SELECTED SONGS</button></> : <div className="tr10-empty">Create a playlist to get started.</div>}</section>
        </div> : null}

        {tab === "smart" ? <section className="tr10-smart"><div className="tr10-smartBuild"><span>SMART WORKOUT MIX</span><h2>Build a workout-length queue</h2><p>Uses energy, likes, completed plays, skips and recent playback. Songs marked Play Less are excluded.</p><label><span>WORKOUT LENGTH</span><input type="number" min={15} max={240} step={5} value={smartMinutes} onChange={(event) => setSmartMinutes(Math.max(15,Math.min(240,Number(event.target.value)||60)))} /><b>MINUTES</b></label><div className="tr10-intensity">{(["high","balanced","recovery"] as SmartIntensity[]).map((value) => <button key={value} className={smartIntensity===value ? "is-active" : ""} onClick={() => setSmartIntensity(value)}>{value.toUpperCase()}</button>)}</div><button className="tr10-smartLaunch" onClick={() => void buildAndPlaySmartMix()}>BUILD & PLAY SMART MIX</button></div><div className="tr10-smartCollections"><button onClick={() => {setTab("songs");setHealthFilter("liked");setSongSort("high_rotation");}}>LIKED TRACKS <b>{likedCount}</b></button><button onClick={() => {setTab("songs");setHealthFilter("all");setSongSort("most_played");}}>MOST PLAYED</button><button onClick={() => {setTab("songs");setHealthFilter("all");setSongSort("recently_played");}}>RECENTLY PLAYED</button><button onClick={() => {setTab("songs");setHealthFilter("all");setSongSort("high_rotation");}}>HIGH ROTATION</button><button onClick={() => {setTab("songs");setHealthFilter("liked");setSongSort("least_played");}}>REDISCOVER</button></div></section> : null}
      </section>

      {enrichment.running ? <div className="tr10-modalBack tr10-analysisBack"><section className="tr10-analysisModal" role="dialog" aria-modal="true" aria-live="polite">
        <header><div><span>MVP MUSIC INTELLIGENCE</span><h2>{enrichment.label}</h2><p>{enrichment.serviceMessage}</p></div><div className="tr10-analysisCounter"><strong>{enrichment.current}</strong><span>OF {enrichment.total}</span></div></header>
        <div className="tr10-analysisProgress"><i style={{ transform: `scaleX(${enrichment.total ? enrichment.current / enrichment.total : 0})` }} /></div>
        <div className="tr10-analysisStats"><div><span>MATCHED</span><strong>{enrichment.matched}</strong></div><div><span>REVIEW</span><strong>{enrichment.review}</strong></div><div><span>NOT FOUND</span><strong>{enrichment.notFound}</strong></div></div>
        <div className="tr10-analysisCurrent"><span>CURRENT TRACK</span><strong>{enrichment.label.replace(/^(ANALYZING|FINDING ART)\s*•\s*/i, "")}</strong><small>{enrichment.serviceMessage}</small></div>
        <footer><span>EXISTING ARTWORK PROTECTED</span><small>Exact title, artist, filename and duration are checked before anything is saved.</small></footer>
      </section></div> : null}

      {reviewItems.length && reviewRemainingCount > 0 ? <button className="tr10-reviewDock" onClick={openReviewQueue}>REVIEW {reviewRemainingCount} POSSIBLE MATCH{reviewRemainingCount === 1 ? "" : "ES"} ›</button> : null}

      {detailTrack ? <div className="tr10-modalBack" onMouseDown={closeDetail}><section className="tr10-inspector" role="dialog" aria-modal="true" onMouseDown={(event: MouseEvent<HTMLElement>) => event.stopPropagation()}>
        <header><div className="tr10-inspectIdentity"><TrackArtwork track={detailTrack} size="detail" /><div><span>SONG CONTROL</span><h2>{detailTrack.title}</h2><p>{artistLabel(detailTrack)}</p>{detailMode === "edit" ? <small className={`tr10-editState ${detailSaveState === "changed" ? "is-changed" : detailDirty ? "is-dirty" : ""}`}>{detailSaveState === "saving" ? "SAVING…" : detailSaveState === "changed" ? "✓ CHANGED" : detailDirty ? "UNSAVED CHANGES" : "LIBRARY RECORD"}</small> : null}</div></div><button onClick={closeDetail}>×</button></header>
        {detailMode === "edit" ? <>
          <div className="tr10-inspectorScroll">
            <div className="tr10-inspectCommands"><button disabled={detailSaveState === "searching"} onClick={() => void findDetailMatches(detailTrack,"info_results")}>{detailSaveState === "searching" ? "SEARCHING…" : "FIND SONG INFO"}</button><button disabled={detailSaveState === "searching"} onClick={() => void findDetailMatches(detailTrack,"artwork_results")}>FIND ARTWORK</button><button onClick={() => playMusicNext(detailTrack.id)}>PLAY NEXT</button><button onClick={() => addMusicToQueue(detailTrack.id)}>ADD TO QUEUE</button><button className={detailTrack.favorite ? "is-liked" : ""} onClick={() => void changePreference(detailTrack, detailTrack.favorite ? "neutral" : "like")}>👍 {detailTrack.favorite ? "LIKED" : "LIKE"}</button><button className={detailTrack.play_less ? "is-down" : ""} onClick={() => void changePreference(detailTrack, detailTrack.play_less ? "neutral" : "play_less")}>👎 PLAY LESS</button></div>
            {detailStatusText ? <div className={`tr10-detailStatus is-${detailSaveState}`}>{detailStatusText}</div> : null}
            <div className="tr10-inspectGrid"><label><span>TITLE</span><input value={drafts[detailTrack.id]?.title || ""} onChange={(event) => setDrafts((current) => ({...current,[detailTrack.id]:{...current[detailTrack.id],title:event.target.value}}))} /></label><label><span>ARTIST</span><input value={drafts[detailTrack.id]?.artist || ""} onChange={(event) => setDrafts((current) => ({...current,[detailTrack.id]:{...current[detailTrack.id],artist:event.target.value}}))} /></label><label><span>ALBUM</span><input value={drafts[detailTrack.id]?.album || ""} onChange={(event) => setDrafts((current) => ({...current,[detailTrack.id]:{...current[detailTrack.id],album:event.target.value}}))} /></label><label><span>YEAR</span><input inputMode="numeric" value={drafts[detailTrack.id]?.releaseYear || ""} onChange={(event) => setDrafts((current) => ({...current,[detailTrack.id]:{...current[detailTrack.id],releaseYear:event.target.value}}))} /></label><label><span>GENRE</span><input value={drafts[detailTrack.id]?.genre || ""} onChange={(event) => setDrafts((current) => ({...current,[detailTrack.id]:{...current[detailTrack.id],genre:event.target.value}}))} /></label><div className="tr10-artControls"><input ref={artworkInputRef} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void replaceArtwork(detailTrack,event.target.files?.[0] || null)} /><span>ARTWORK</span><button onClick={() => artworkInputRef.current?.click()}>{needsMusicArtwork(detailTrack) ? "+ ADD" : "REPLACE"}</button>{!needsMusicArtwork(detailTrack) ? <button className="is-danger" onClick={() => void clearArtwork(detailTrack)}>REMOVE</button> : null}</div></div>
            <dl className="tr10-meta"><div><dt>PLAYS</dt><dd>{detailTrack.play_count}</dd></div><div><dt>COMPLETED</dt><dd>{detailTrack.completed_play_count}</dd></div><div><dt>SKIPS</dt><dd>{detailTrack.skip_count}</dd></div><div><dt>LAST PLAYED</dt><dd>{formatDate(detailTrack.last_played_at)}</dd></div><div><dt>MATCH</dt><dd>{detailTrack.metadata_status.toUpperCase()}</dd></div><div><dt>FILE</dt><dd title={detailTrack.original_name}>{detailTrack.original_name}</dd></div></dl>
          </div>
          <footer><button onClick={() => openPlaylistModal([detailTrack.id])}>+ PLAYLIST</button><button className="is-danger" disabled={busyId===detailTrack.id} onClick={() => void deleteTrack(detailTrack)}>DELETE</button><button className={`is-primary tr10-saveButton ${detailSaveState === "changed" ? "is-changed" : ""}`} disabled={!detailDirty || detailSaveState === "saving" || detailSaveState === "changed"} onClick={() => void saveTrack(detailTrack)}>{detailSaveState === "saving" ? "SAVING…" : detailSaveState === "changed" ? "✓ CHANGED" : "SAVE CHANGES"}</button></footer>
        </> : <>
          <div className="tr10-detailLookup"><div className="tr10-detailLookupHead"><button onClick={() => {setDetailMode("edit");setDetailSelectedCandidateId(null);}}>← BACK TO SONG</button><div><span>{detailMode === "artwork_results" ? "ARTWORK RESULTS" : "SONG MATCH RESULTS"}</span><h3>{detailMode === "artwork_results" ? "Choose the correct cover" : "Choose the correct recording"}</h3><p>{detailStatusText}</p></div></div>
          <div className={`tr10-detailCandidates ${detailMode === "artwork_results" ? "is-artwork" : ""}`}>{detailSaveState === "searching" ? <div className="tr10-reviewLoading">SEARCHING FOR THE BEST MATCHES…</div> : null}{detailCandidates.map((candidate) => { const selected = detailSelectedCandidateId === candidate.sourceId; const tier = musicMatchTier(candidate.confidence); return <button type="button" key={candidate.sourceId} className={selected ? "is-selected" : ""} onClick={() => setDetailSelectedCandidateId(candidate.sourceId)}>{candidate.artworkUrl ? <img src={candidate.artworkUrl} alt="" /> : <span className="tr10-candidateArt">♫</span>}<div><strong>{candidate.title}</strong><span>{candidate.artist}</span><small>{candidate.album || "Unknown album"}{candidate.releaseYear ? ` • ${candidate.releaseYear}` : ""}{candidate.durationSeconds ? ` • ${formatDuration(candidate.durationSeconds)}` : ""}</small></div><em className={`tr10-matchTier is-${tier.toLowerCase().replaceAll(" ","-")}`}>{tier}<b>{Math.round(candidate.confidence*100)}%</b></em><i className="tr10-selectMark">{selected ? "✓" : ""}</i></button>; })}{detailSaveState !== "searching" && !detailCandidates.length ? <div className="tr10-empty">No useful matches found.</div> : null}</div></div>
          <div className="tr10-detailLookupFooter"><div><strong>{detailSelectedCandidate ? `${detailSelectedCandidate.title} • ${detailSelectedCandidate.artist}` : "Select a result"}</strong><small>Nothing changes until you apply the selection.</small></div><button onClick={() => {setDetailMode("edit");setDetailSelectedCandidateId(null);}}>CANCEL</button><button className="is-primary" disabled={!detailSelectedCandidate || detailSaveState === "saving"} onClick={() => { if (!detailSelectedCandidate) return; if (detailMode === "artwork_results") void applyDetailArtworkCandidate(detailSelectedCandidate); else applyDetailInfoCandidate(detailSelectedCandidate); }}>{detailMode === "artwork_results" ? "USE ARTWORK" : "APPLY MATCH"}</button></div>
        </>}
      </section></div> : null}

      {reviewTrack ? <div className="tr10-modalBack tr10-reviewBack" onMouseDown={() => setReviewTrackId(null)}><section className="tr10-reviewModal" role="dialog" aria-modal="true" onMouseDown={(event: MouseEvent<HTMLElement>) => event.stopPropagation()}>
        <header className="tr10-reviewHeader"><div><span>LIBRARY MATCH REVIEW</span><h2>{reviewTrack.title}</h2><p>{artistLabel(reviewTrack)} • {reviewTrack.original_name}</p></div><button onClick={() => setReviewTrackId(null)}>×</button></header>
        <div className="tr10-reviewProgress"><div><strong>REVIEWING {Math.max(1,reviewIndex+1)} OF {reviewItems.length}</strong><span>{reviewSavedIds.size} saved • {reviewSkippedIds.size} skipped • {reviewRemainingCount} remaining</span></div><i style={{ transform: `scaleX(${reviewItems.length ? Math.max(0,reviewIndex+1)/reviewItems.length : 0})` }} /></div>
        <div className="tr10-reviewInstruction"><span>SELECT THE CORRECT RECORDING</span><p>Exact title and artist matches rank first. Existing artwork is protected. Nothing changes until you press Save.</p></div>
        <div className="tr10-candidates">{reviewCandidates.map((candidate) => { const selected = reviewSelectedCandidateId === candidate.sourceId; const tier=musicMatchTier(candidate.confidence); return <button type="button" className={selected ? "is-selected" : ""} key={candidate.sourceId} onClick={() => setReviewSelectedCandidateId(candidate.sourceId)}>{candidate.artworkUrl ? <img src={candidate.artworkUrl} alt="" /> : <span className="tr10-candidateArt">♫</span>}<div><strong>{candidate.title}</strong><span>{candidate.artist}</span><small>{candidate.album || "Unknown album"}{candidate.releaseYear ? ` • ${candidate.releaseYear}` : ""}{candidate.durationSeconds ? ` • ${formatDuration(candidate.durationSeconds)}` : ""}</small></div><em className={`tr10-matchTier is-${tier.toLowerCase().replaceAll(" ","-")}`}>{tier}<b>{Math.round(candidate.confidence*100)}%</b></em><i className="tr10-selectMark">{selected ? "✓" : ""}</i></button>; })}</div>
        <footer><button onClick={skipReview}>SKIP</button><button disabled={!reviewSelectedCandidate || busyId === `match-${reviewTrack.id}`} onClick={() => void saveReviewCandidate(false)}>SAVE</button><button className="is-primary" disabled={!reviewSelectedCandidate || busyId === `match-${reviewTrack.id}`} onClick={() => void saveReviewCandidate(true)}>SAVE & NEXT</button></footer>
      </section></div> : null}

      {playlistModalTrackIds.length ? <div className="tr10-modalBack" onMouseDown={() => setPlaylistModalTrackIds([])}><section className="tr10-picker" onMouseDown={(event: MouseEvent<HTMLElement>) => event.stopPropagation()}><header><div><span>PLAYLIST ROUTING</span><h2>{playlistModalTrackIds.length} song{playlistModalTrackIds.length===1 ? "" : "s"}</h2></div><button onClick={() => setPlaylistModalTrackIds([])}>×</button></header><div>{playlists.map((playlist) => <label key={playlist.id}><input type="checkbox" checked={playlistModalSelections.has(playlist.id)} onChange={() => setPlaylistModalSelections((current) => {const next=new Set(current);next.has(playlist.id)?next.delete(playlist.id):next.add(playlist.id);return next;})} /><span><strong>{playlist.name}</strong><small>{playlistTrackIds[playlist.id]?.length || 0} songs</small></span></label>)}</div><label className="tr10-newRoute"><span>CREATE NEW PLAYLIST</span><input value={playlistModalName} onChange={(event) => setPlaylistModalName(event.target.value)} placeholder="Playlist name" /></label><footer><button onClick={() => setPlaylistModalTrackIds([])}>CANCEL</button><button className="is-primary" disabled={busyId === "playlist-route"} onClick={() => void savePlaylistMemberships()}>SAVE PLAYLISTS</button></footer></section></div> : null}

      <style>{`
        .tr10-page{width:min(1180px,calc(100% - 32px));margin:0 auto 120px;color:#eef8fc;font-family:inherit;min-width:0}.tr10-page *{box-sizing:border-box}.tr10-page button,.tr10-page input,.tr10-page select{font:inherit}.tr10-page button{cursor:pointer}.tr10-page button:disabled{cursor:not-allowed;opacity:.42}
        .tr10-hero,.tr10-console{border:1px solid rgba(70,181,222,.24);border-top-color:rgba(149,222,248,.33);border-radius:18px;background:linear-gradient(180deg,rgba(12,31,42,.97),rgba(4,13,19,.99));box-shadow:inset 0 1px 0 rgba(255,255,255,.025),0 14px 32px rgba(0,0,0,.24)}.tr10-hero{padding:24px 28px;display:flex;justify-content:space-between;gap:22px;align-items:flex-start}.tr10-hero span,.tr10-sectionHead span,.tr10-inspector header span,.tr10-reviewModal header span,.tr10-picker header span,.tr10-smart span{font-size:9px;font-weight:1000;letter-spacing:.15em;color:#5bcdf2}.tr10-hero h1{font-size:36px;line-height:1;margin:8px 0 9px;letter-spacing:-.04em}.tr10-hero p{max-width:800px;margin:0;color:#8fa5af;font-weight:650;font-size:11px}.tr10-hero>button{height:38px;padding:0 18px;border:1px solid rgba(130,170,185,.18);border-radius:10px;background:#071219;color:#c8dce4;font-size:8px;font-weight:1000}
        .tr10-stats{display:grid;grid-template-columns:repeat(5,1fr);gap:9px;margin:10px 0}.tr10-stats>div{min-height:70px;display:grid;place-content:center;text-align:center;border:1px solid rgba(91,157,181,.14);border-radius:12px;background:linear-gradient(180deg,#09151c,#050b0f)}.tr10-stats strong{font-size:22px;color:#f2c56d}.tr10-stats span{font-size:7px;font-weight:1000;letter-spacing:.12em;color:#6e8791}
        .tr10-console{overflow:hidden}.tr10-sectionHead{padding:16px 18px;display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid rgba(84,155,181,.11)}.tr10-sectionHead h2{margin:4px 0 2px;font-size:23px}.tr10-sectionHead p{margin:0;color:#68838d;font-size:8px}.tr10-headActions{display:flex;gap:7px}.tr10-headActions button{height:36px;padding:0 12px;border:1px solid rgba(82,167,197,.2);border-radius:8px;background:#07141b;color:#cce3ec;font-size:8px;font-weight:1000}.tr10-headActions .is-orange{border-color:rgba(255,175,68,.42);background:linear-gradient(180deg,#ef9d2e,#b8650e);color:#1a1005;box-shadow:inset 0 1px rgba(255,255,255,.3)}
        .tr10-statusPanel{padding:9px 11px 11px;border-bottom:1px solid rgba(82,151,176,.12);background:linear-gradient(180deg,#07131a,#050d12)}.tr10-statusPanelHead{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 2px 7px}.tr10-statusPanelHead span{color:#77a8b9;font-size:6px;font-weight:1000;letter-spacing:.16em}.tr10-statusPanelHead small{color:#4f6d78;font-size:5.5px;font-weight:900;letter-spacing:.1em}.tr10-healthRail{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px}.tr10-healthRail button{min-width:0;height:34px;padding:0 8px;display:flex;align-items:center;justify-content:space-between;gap:7px;border:1px solid rgba(82,151,176,.11);border-radius:7px;background:linear-gradient(180deg,rgba(10,25,33,.92),rgba(5,13,18,.96));color:#728a95;font-size:6.5px;font-weight:1000;letter-spacing:.075em;box-shadow:inset 0 1px rgba(255,255,255,.018)}.tr10-healthRail button span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:inherit;font:inherit;letter-spacing:inherit}.tr10-healthRail button b{min-width:22px;height:20px;padding:0 5px;display:grid;place-items:center;border:1px solid rgba(91,164,189,.10);border-radius:5px;background:rgba(0,0,0,.18);color:#b5cbd3;font-size:7px;font-variant-numeric:tabular-nums}.tr10-healthRail button.is-active{border-color:rgba(70,204,246,.4);color:#ddf7ff;background:linear-gradient(180deg,rgba(10,55,70,.82),rgba(5,27,36,.9));box-shadow:inset 0 1px rgba(157,233,255,.05),0 0 0 1px rgba(63,192,233,.035)}.tr10-healthRail button.is-needs{border-color:rgba(255,75,85,.24);color:#e8a2a7}.tr10-healthRail button.is-needs b{border-color:rgba(255,75,85,.25);color:#ff8a91;background:rgba(92,18,24,.3)}.tr10-healthRail button.is-needs.is-active{border-color:rgba(255,75,85,.58);color:#ffe1e3;background:linear-gradient(180deg,rgba(100,21,27,.75),rgba(48,10,14,.86));box-shadow:inset 0 1px rgba(255,198,201,.055)}.tr10-healthRail button.is-art{color:#d2ae71}.tr10-healthRail button.is-art.is-active{border-color:rgba(232,169,68,.42);color:#ffd995;background:linear-gradient(180deg,rgba(76,48,12,.68),rgba(35,23,8,.84))}.tr10-healthRail button.is-liked.is-active{border-color:rgba(68,212,153,.4);color:#9be8bf;background:linear-gradient(180deg,rgba(14,65,47,.65),rgba(7,31,23,.86))}.tr10-healthRail button.is-review.is-active{border-color:rgba(147,129,245,.38);color:#c9c1ff;background:linear-gradient(180deg,rgba(46,39,94,.62),rgba(21,18,49,.86))}
        .tr10-tabs{display:grid;grid-template-columns:repeat(5,1fr);border-bottom:1px solid rgba(82,151,176,.1);background:#061016}.tr10-tabs button{height:42px;border:0;border-right:1px solid rgba(82,151,176,.07);background:transparent;color:#67808b;font-size:8px;font-weight:1000;letter-spacing:.08em}.tr10-tabs button.is-active{color:#e1f8ff;background:rgba(9,42,55,.62);box-shadow:inset 0 -2px #47cff5}
        .tr10-message,.tr10-error{margin:9px 11px 0;padding:9px 11px;border-radius:8px;font-size:8px;font-weight:850}.tr10-message{border:1px solid rgba(74,208,151,.18);background:rgba(15,65,47,.2);color:#83dcb0}.tr10-error{border:1px solid rgba(255,82,92,.28);background:rgba(90,19,24,.25);color:#ffadb2}
        .tr10-toolbar{padding:10px 12px;display:grid;grid-template-columns:minmax(240px,1fr) 140px 190px 90px;gap:8px;border-bottom:1px solid rgba(74,139,162,.08);background:#050b0f}.tr10-toolbar label{display:grid;gap:4px}.tr10-toolbar span{font-size:6px;font-weight:1000;letter-spacing:.11em;color:#5d7681}.tr10-toolbar input,.tr10-toolbar select{height:36px;padding:0 10px;border:1px solid rgba(75,151,178,.14);border-radius:8px;background:#071219;color:#c9dde5;outline:none;font-size:8px;font-weight:850}.tr10-bulk{min-height:48px;padding:8px 12px;display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid rgba(69,151,181,.1);background:linear-gradient(90deg,rgba(8,45,59,.62),rgba(5,17,23,.64))}.tr10-bulk strong{font-size:8px;color:#7bdff7;letter-spacing:.1em}.tr10-bulk>div{display:flex;gap:6px}.tr10-bulk button{height:32px;padding:0 10px;border:1px solid rgba(76,176,211,.2);border-radius:7px;background:#07141b;color:#bdd6df;font-size:7px;font-weight:1000}
        .tr10-tableHead,.tr10-row{display:grid;grid-template-columns:30px minmax(0,1fr) 62px 112px 390px;gap:10px;align-items:center}.tr10-tableHead{min-height:36px;padding:0 12px;border-bottom:1px solid rgba(88,143,164,.09);color:#5c7782;font-size:7px;font-weight:1000;letter-spacing:.1em}.tr10-row{position:relative;min-height:72px;padding:8px 12px;border-bottom:1px solid rgba(83,137,157,.085);background:rgba(2,8,11,.38)}.tr10-row:hover{background:rgba(7,30,39,.52)}.tr10-row.is-current{background:linear-gradient(90deg,rgba(7,65,84,.55),rgba(3,13,18,.4));box-shadow:inset 3px 0 #38cef8}.tr10-check{display:grid;place-items:center}.tr10-check input{accent-color:#49d3f8}.tr10-trackCell{min-width:0;display:grid;grid-template-columns:auto auto minmax(0,1fr) auto;gap:9px;align-items:center}.tr10-trackText{min-width:0}.tr10-trackText strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px}.tr10-trackText span,.tr10-trackText small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tr10-trackText span{margin-top:2px;color:#78909a;font-size:8px}.tr10-trackText small{margin-top:2px;color:#4f6873;font-size:6px}.tr10-play{width:34px;height:34px;border:1px solid rgba(247,178,75,.34);border-radius:8px;background:linear-gradient(180deg,#ffc45b,#f29514);color:#1b1104;font-weight:1000}.tr10-play.is-playing{border-color:rgba(75,211,249,.44);background:linear-gradient(180deg,#74e9ff,#2ebedc)}
        .tr10-art{display:grid;place-items:center;overflow:hidden;border:1px solid rgba(91,184,219,.16);background:linear-gradient(145deg,#102936,#07131b);color:#ffc05b;flex:0 0 auto}.tr10-art img{width:100%;height:100%;object-fit:cover}.tr10-art--row{width:36px;height:36px;border-radius:8px}.tr10-art--detail{width:72px;height:72px;border-radius:14px}.tr10-art--card{width:76px;height:76px;border-radius:12px}.tr10-healthBadge{font-style:normal;font-size:6px;font-weight:1000;letter-spacing:.08em;padding:5px 8px;border-radius:6px;white-space:nowrap}.tr10-healthBadge.is-needs{color:#ffd9dc;border:1px solid rgba(255,75,85,.58);background:linear-gradient(180deg,rgba(126,25,32,.75),rgba(62,10,15,.84));box-shadow:0 0 12px rgba(255,55,66,.08)}.tr10-healthBadge.is-art{color:#ffd086;border:1px solid rgba(230,161,55,.34);background:rgba(82,49,9,.25)}.tr10-duration{font-size:9px;color:#8398a1;font-variant-numeric:tabular-nums}
        .tr10-energy{position:relative;height:34px;padding:0 9px;display:grid;grid-template-columns:10px minmax(0,1fr) auto;gap:8px;align-items:center;overflow:hidden;border-radius:6px;color:#a8bac1;background:linear-gradient(180deg,#0d171c,#05090c 68%,#030609);font-size:7px;font-weight:1000;letter-spacing:.12em;text-shadow:0 1px 0 #000;box-shadow:inset 0 1px rgba(255,255,255,.045),inset 0 -1px rgba(0,0,0,.7),0 2px 5px rgba(0,0,0,.18);transition:border-color .12s ease,filter .12s ease}.tr10-energy:after{content:"";position:absolute;left:7px;right:7px;top:4px;height:1px;background:rgba(255,255,255,.025);pointer-events:none}.tr10-energy:hover{filter:brightness(1.08)}.tr10-energy>.tr10-energyLed{width:7px;height:7px;border:1px solid currentColor;border-radius:50%;background:currentColor;box-shadow:0 0 0 2px rgba(0,0,0,.42),0 0 7px currentColor}.tr10-energy>span{text-align:left;white-space:nowrap}.tr10-energySegments{display:flex;align-items:flex-end;gap:2px;height:13px;padding:2px 4px;border:1px solid rgba(255,255,255,.055);border-radius:3px;background:rgba(0,0,0,.25)}.tr10-energySegments i{display:block;width:3px;border-radius:1px;background:currentColor;box-shadow:0 0 4px currentColor;opacity:.13}.tr10-energySegments i:nth-child(1){height:4px;opacity:1}.tr10-energySegments i:nth-child(2){height:7px}.tr10-energySegments i:nth-child(3){height:10px}.tr10-energy.is-medium .tr10-energySegments i:nth-child(2),.tr10-energy.is-high .tr10-energySegments i:nth-child(2),.tr10-energy.is-high .tr10-energySegments i:nth-child(3){opacity:1}.tr10-energy.is-high{border:1px solid rgba(226,159,53,.48);color:#efb253;background:linear-gradient(180deg,#231a0d,#0e0b07 70%,#070503)}.tr10-energy.is-medium{border:1px solid rgba(62,185,220,.44);color:#67d5ef;background:linear-gradient(180deg,#0b2028,#071014 70%,#04090c)}.tr10-energy.is-low{border:1px solid rgba(56,190,133,.4);color:#68dca3;background:linear-gradient(180deg,#0c2119,#07110d 70%,#040907)}
        .tr10-actions{display:flex;justify-content:flex-end;gap:5px}.tr10-actions button,.tr10-order button{height:30px;padding:0 8px;border:1px solid rgba(75,147,172,.13);border-radius:7px;background:#061118;color:#879da6;font-size:7px;font-weight:950}.tr10-actions button.is-liked{color:#5fe2a6;border-color:rgba(66,211,151,.32);background:rgba(18,76,55,.28)}.tr10-actions button.is-down{color:#ff8d93;border-color:rgba(255,90,99,.3);background:rgba(83,20,25,.27)}.tr10-actions .is-edit{color:#d9f5fd;border-color:rgba(71,197,238,.28);background:#082733}.tr10-order{position:absolute;right:9px;bottom:3px;display:none;gap:3px}.tr10-row:hover .tr10-order{display:flex}.tr10-order button{height:19px;padding:0 5px;font-size:7px}
        .tr10-pager{padding:10px 12px;display:flex;align-items:center;justify-content:space-between;background:#050b0f}.tr10-pager>span{color:#5d7580;font-size:7px;font-weight:1000}.tr10-pager>div{display:flex;gap:7px;align-items:center}.tr10-pager button{height:30px;padding:0 10px;border:1px solid rgba(76,148,173,.14);border-radius:7px;background:#061118;color:#8fa6af;font-size:7px;font-weight:1000}.tr10-pager b{min-width:55px;text-align:center;font-size:8px}
        .tr10-cardGrid{padding:12px;display:grid;grid-template-columns:1fr 1fr;gap:9px}.tr10-collectionCard{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:12px;align-items:center;padding:12px;border:1px solid rgba(79,145,169,.11);border-radius:12px;background:linear-gradient(180deg,#07141a,#050c10)}.tr10-collectionCard small{color:#56ceef;font-size:6px;font-weight:1000}.tr10-collectionCard h3{margin:4px 0 2px;font-size:15px}.tr10-collectionCard p{margin:0;color:#6f8791;font-size:7px;font-weight:800}.tr10-collectionCard>button{height:34px;padding:0 10px;border:1px solid rgba(70,196,236,.25);border-radius:8px;background:#082633;color:#cceef8;font-size:7px;font-weight:1000}
        .tr10-playlistLayout{display:grid;grid-template-columns:230px 1fr;min-height:430px}.tr10-playlistLayout>aside{padding:10px;border-right:1px solid rgba(78,143,166,.1);background:#050b0f}.tr10-createPlaylist{display:grid;grid-template-columns:1fr 35px;gap:5px;margin-bottom:9px}.tr10-createPlaylist input{min-width:0;height:35px;padding:0 9px;border:1px solid rgba(75,149,175,.14);border-radius:8px;background:#071219;color:#d7e7ed}.tr10-createPlaylist button{height:35px;border:1px solid rgba(70,194,234,.24);border-radius:8px;background:#082734;color:#d9f7ff;font-weight:1000}.tr10-playlistLayout>aside>button{width:100%;min-height:52px;padding:9px 10px;display:grid;gap:2px;text-align:left;border:0;border-radius:8px;background:transparent;color:#91a7af}.tr10-playlistLayout>aside>button.is-active{background:linear-gradient(90deg,rgba(10,63,81,.58),rgba(7,25,33,.3));color:#e3f7fc}.tr10-playlistLayout>aside>button span{font-size:6px;color:#607984}.tr10-playlistConsole>header{padding:12px 14px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(77,144,168,.09)}.tr10-playlistConsole>header h2{margin:3px 0 0}.tr10-playlistConsole>header>div:last-child{display:flex;gap:6px}.tr10-playlistConsole button{height:33px;padding:0 9px;border:1px solid rgba(75,148,174,.14);border-radius:7px;background:#061218;color:#91aab3;font-size:7px;font-weight:1000}.tr10-playlistConsole button.is-primary{color:#d9f7ff;border-color:rgba(69,198,239,.32);background:#092c3a}.tr10-playlistConsole button.is-danger{color:#ff9fa4;border-color:rgba(255,82,91,.23);background:rgba(71,17,21,.25)}.tr10-playlistSongs{padding:9px}.tr10-playlistSongs article{display:grid;grid-template-columns:25px auto minmax(0,1fr) repeat(4,auto);gap:7px;align-items:center;padding:7px;border-bottom:1px solid rgba(75,136,158,.08)}.tr10-playlistSongs article>b{font-size:7px;color:#586f79}.tr10-playlistSongs strong{display:block;font-size:10px}.tr10-playlistSongs span{display:block;font-size:7px;color:#677f89}.tr10-addSelected{margin:0 12px 12px}
        .tr10-smart{display:grid;grid-template-columns:1fr 300px;min-height:430px}.tr10-smartBuild{padding:23px}.tr10-smartBuild h2{margin:6px 0;font-size:26px}.tr10-smartBuild p{margin:0 0 18px;color:#788f99;font-size:10px}.tr10-smartBuild label{display:grid;grid-template-columns:auto 100px auto;gap:8px;align-items:center;padding:10px;border:1px solid rgba(76,145,169,.1);border-radius:10px;background:#061118}.tr10-smartBuild label input{height:35px;padding:0 9px;border:1px solid rgba(74,148,174,.13);border-radius:8px;background:#07151c;color:#d6e8ee}.tr10-intensity{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:10px}.tr10-intensity button{height:36px;border:1px solid rgba(74,149,175,.13);border-radius:8px;background:#07151c;color:#748d97;font-size:8px;font-weight:1000}.tr10-intensity button.is-active{color:#dff7ff;border-color:rgba(73,206,246,.38);background:#0a3040}.tr10-smartLaunch{width:100%;height:46px;margin-top:10px;border:1px solid rgba(72,203,244,.42);border-radius:10px;background:linear-gradient(180deg,#0c4c62,#082d3b);color:#e2f9ff;font-size:9px;font-weight:1000}.tr10-smartCollections{padding:12px;border-left:1px solid rgba(75,141,164,.09);background:#050b0f}.tr10-smartCollections button{width:100%;min-height:54px;padding:0 12px;display:flex;align-items:center;justify-content:space-between;border:0;border-bottom:1px solid rgba(73,132,153,.07);background:transparent;color:#9fb5bd;font-size:8px;font-weight:1000;text-align:left}
        .tr10-reviewDock{position:fixed;right:18px;bottom:88px;z-index:6500;min-height:42px;padding:0 15px;border:1px solid rgba(255,185,77,.42);border-radius:10px;background:linear-gradient(180deg,#d98a21,#9b540c);color:#180e04;font-size:8px;font-weight:1000;box-shadow:0 12px 32px rgba(0,0,0,.36)}
        .tr10-modalBack{position:fixed;inset:0;z-index:9000;padding:18px 12px;display:grid;place-items:center;background:rgba(0,4,7,.89);backdrop-filter:blur(10px)}.tr10-inspector,.tr10-reviewModal,.tr10-picker{width:min(900px,100%);max-height:calc(100dvh - 36px);overflow:hidden;border:1px solid rgba(80,206,246,.34);border-radius:17px;background:linear-gradient(180deg,#0b202b,#050d12);box-shadow:0 34px 90px rgba(0,0,0,.68)}.tr10-inspector{height:min(760px,calc(100dvh - 36px));display:grid;grid-template-rows:auto minmax(0,1fr) auto}.tr10-inspector>header,.tr10-reviewModal>header,.tr10-picker>header{padding:14px 16px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(82,157,184,.12);background:#081922}.tr10-inspector>header>button,.tr10-reviewModal>header>button,.tr10-picker>header>button{width:35px;height:35px;border:1px solid rgba(105,159,178,.17);border-radius:9px;background:#071219;color:#d8e8ed;font-size:20px}.tr10-inspectIdentity{display:flex;gap:12px;align-items:center;min-width:0}.tr10-inspectIdentity h2{margin:4px 0 2px;font-size:23px}.tr10-inspectIdentity p{margin:0;color:#7a919b;font-size:9px}.tr10-editState{display:block;margin-top:5px;color:#65808b;font-size:6px;font-weight:1000;letter-spacing:.1em}.tr10-editState.is-dirty{color:#f0b75f}.tr10-editState.is-changed{color:#6ae3aa}.tr10-inspectorScroll{min-height:0;overflow:auto;overscroll-behavior:contain}.tr10-inspectCommands{position:sticky;top:0;z-index:3;padding:9px 13px;display:flex;flex-wrap:wrap;gap:6px;border-bottom:1px solid rgba(80,153,180,.1);background:rgba(6,18,25,.97)}.tr10-inspectCommands button,.tr10-artControls button{height:34px;padding:0 10px;border:1px solid rgba(73,181,219,.19);border-radius:8px;background:#07141b;color:#cbe5ee;font-size:7px;font-weight:1000}.tr10-inspectCommands button.is-liked{color:#61e3a6}.tr10-inspectCommands button.is-down{color:#ff9191}.tr10-detailStatus{margin:10px 13px 0;padding:9px 11px;border:1px solid rgba(77,171,205,.17);border-radius:8px;background:#07141b;color:#9ec0cd;font-size:8px}.tr10-detailStatus.is-changed{border-color:rgba(67,208,147,.32);color:#8ce8ba}.tr10-detailStatus.is-error{border-color:rgba(255,92,99,.38);color:#ffb1b5}.tr10-inspectGrid{padding:13px;display:grid;grid-template-columns:1fr 1fr;gap:9px}.tr10-inspectGrid label{display:grid;gap:5px}.tr10-inspectGrid label>span,.tr10-artControls>span{font-size:6px;font-weight:1000;letter-spacing:.11em;color:#617b85}.tr10-inspectGrid input{height:39px;padding:0 10px;border:1px solid rgba(75,151,178,.15);border-radius:8px;background:#06131a;color:#e8f5f9}.tr10-artControls{display:flex;align-items:end;gap:6px}.tr10-artControls>span{margin-right:auto;margin-bottom:10px}.tr10-artControls .is-danger{color:#ff969c}.tr10-meta{display:grid;grid-template-columns:repeat(3,1fr);margin:0;padding:0 13px 13px}.tr10-meta>div{min-width:0;padding:10px;border:1px solid rgba(85,146,167,.09)}.tr10-meta dt{font-size:6px;font-weight:1000;color:#617b85}.tr10-meta dd{margin:4px 0 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:8px}.tr10-inspector>footer,.tr10-detailLookupFooter,.tr10-reviewModal>footer,.tr10-picker>footer{padding:11px 13px;display:flex;justify-content:flex-end;align-items:center;gap:7px;border-top:1px solid rgba(82,157,184,.12);background:#061117}.tr10-inspector>footer button,.tr10-detailLookupFooter button,.tr10-reviewModal>footer button,.tr10-picker>footer button{height:38px;padding:0 12px;border:1px solid rgba(83,168,199,.18);border-radius:9px;background:#07131a;color:#d1e3e9;font-size:7px;font-weight:1000}.tr10-inspector>footer .is-primary,.tr10-detailLookupFooter .is-primary,.tr10-reviewModal>footer .is-primary,.tr10-picker>footer .is-primary{border-color:rgba(61,205,255,.5);background:linear-gradient(180deg,#0d4559,#092e3c);color:#e1f9ff}.tr10-inspector>footer .is-danger{color:#ff9da3}.tr10-saveButton.is-changed{border-color:rgba(72,221,155,.58)!important;background:linear-gradient(180deg,rgba(25,115,78,.8),rgba(16,70,49,.88))!important;color:#b3f5d2!important}
        .tr10-detailLookup{min-height:0;overflow:auto}.tr10-detailLookupHead{position:sticky;top:0;z-index:4;padding:12px 13px;display:grid;grid-template-columns:auto 1fr;gap:12px;align-items:start;border-bottom:1px solid rgba(75,148,174,.12);background:rgba(6,19,26,.98)}.tr10-detailLookupHead>button{height:34px;padding:0 10px;border:1px solid rgba(77,164,196,.2);border-radius:8px;background:#07141b;color:#bdd5de;font-size:7px;font-weight:1000}.tr10-detailLookupHead h3{margin:3px 0 2px;font-size:20px}.tr10-detailLookupHead p{margin:0;color:#78909a;font-size:8px}.tr10-detailCandidates,.tr10-candidates{padding:10px 12px 18px;display:grid;gap:7px;max-height:470px;overflow:auto}.tr10-detailCandidates>button,.tr10-candidates>button{width:100%;display:grid;grid-template-columns:58px minmax(0,1fr) 120px 26px;gap:10px;align-items:center;text-align:left;padding:9px;border:1px solid rgba(78,143,166,.12);border-radius:10px;background:linear-gradient(180deg,rgba(7,19,26,.96),rgba(4,12,17,.97));color:#edf7fb}.tr10-detailCandidates>button.is-selected,.tr10-candidates>button.is-selected{border-color:rgba(73,210,252,.66);background:linear-gradient(90deg,rgba(10,65,83,.68),rgba(5,20,27,.96));box-shadow:inset 3px 0 #42d3fb}.tr10-detailCandidates img,.tr10-candidates img,.tr10-candidateArt{width:58px;height:58px;border-radius:8px;object-fit:cover}.tr10-candidateArt{display:grid;place-items:center;background:#09202a;color:#7cdff7}.tr10-detailCandidates strong,.tr10-candidates strong{display:block;font-size:10px}.tr10-detailCandidates span,.tr10-detailCandidates small,.tr10-candidates span,.tr10-candidates small{display:block;margin-top:2px;color:#738a94;font-size:7px}.tr10-matchTier{justify-self:end;display:grid;gap:2px;text-align:right;font-style:normal;font-size:6px;font-weight:1000;color:#8299a2}.tr10-matchTier b{font-size:13px;color:#78dff9}.tr10-matchTier.is-exact-match,.tr10-matchTier.is-exact-match b{color:#69e9ad}.tr10-matchTier.is-possible-match b{color:#efc372}.tr10-selectMark{width:24px;height:24px;display:grid;place-items:center;border:1px solid rgba(83,153,179,.19);border-radius:50%;font-style:normal;color:#70eab0}.tr10-detailCandidates>button.is-selected .tr10-selectMark,.tr10-candidates>button.is-selected .tr10-selectMark{border-color:rgba(83,229,174,.48);background:rgba(26,100,73,.31)}.tr10-detailLookupFooter{z-index:5}.tr10-detailLookupFooter>div{min-width:0;margin-right:auto;display:grid;gap:2px}.tr10-detailLookupFooter strong{font-size:8px;color:#b9d5df}.tr10-detailLookupFooter small{font-size:6px;color:#607984}.tr10-reviewLoading,.tr10-empty{padding:24px;text-align:center;color:#68808a;font-size:8px;font-weight:800}
        .tr10-analysisBack{z-index:7600}.tr10-analysisModal{width:min(610px,100%);overflow:hidden;border:1px solid rgba(72,202,245,.38);border-radius:16px;background:linear-gradient(180deg,#0b202a,#050d12);box-shadow:0 30px 90px rgba(0,0,0,.72),inset 0 1px rgba(255,255,255,.025)}.tr10-analysisModal>header{padding:17px 18px 14px;display:flex;align-items:flex-start;justify-content:space-between;gap:15px;border-bottom:1px solid rgba(82,157,184,.12);background:linear-gradient(180deg,rgba(11,39,51,.96),rgba(7,23,31,.96))}.tr10-analysisModal>header span{color:#59d5f7;font-size:7px;font-weight:1000;letter-spacing:.14em}.tr10-analysisModal>header h2{margin:5px 0 3px;font-size:20px}.tr10-analysisModal>header p{margin:0;color:#79919b;font-size:8px}.tr10-analysisCounter{min-width:72px;padding:8px 10px;display:grid;justify-items:center;border:1px solid rgba(75,190,229,.16);border-radius:9px;background:rgba(0,0,0,.18)}.tr10-analysisCounter strong{font-size:21px;line-height:1;color:#e7f8fd;font-variant-numeric:tabular-nums}.tr10-analysisCounter span{margin-top:3px;color:#66828d!important;font-size:6px!important}.tr10-analysisProgress{height:4px;background:rgba(75,158,188,.08);overflow:hidden}.tr10-analysisProgress i{display:block;width:100%;height:100%;transform-origin:left;background:linear-gradient(90deg,#2db8df,#6fe5ff);box-shadow:0 0 9px rgba(65,210,249,.3);transition:transform .25s ease}.tr10-analysisStats{padding:13px 16px;display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.tr10-analysisStats>div{min-height:59px;display:grid;place-content:center;text-align:center;border:1px solid rgba(76,151,178,.11);border-radius:8px;background:rgba(4,13,18,.7)}.tr10-analysisStats span{color:#627d88;font-size:6px;font-weight:1000;letter-spacing:.1em}.tr10-analysisStats strong{margin-top:3px;color:#d9edf4;font-size:18px;font-variant-numeric:tabular-nums}.tr10-analysisStats>div:nth-child(1) strong{color:#72e0aa}.tr10-analysisStats>div:nth-child(2) strong{color:#76dbf4}.tr10-analysisStats>div:nth-child(3) strong{color:#e9b16a}.tr10-analysisSweep{height:66px;padding:10px 18px 11px;display:grid;grid-template-columns:repeat(10,1fr);gap:5px;align-items:end;border-top:1px solid rgba(75,145,170,.07);border-bottom:1px solid rgba(75,145,170,.07);background:repeating-linear-gradient(0deg,transparent 0,transparent 9px,rgba(78,158,187,.035) 10px)}.tr10-analysisSweep i{height:54%;border-radius:2px 2px 0 0;background:linear-gradient(180deg,#70e2ff,#29afd4);opacity:.35;animation:tr10Analyze 1.05s ease-in-out infinite alternate}.tr10-analysisSweep i:nth-child(2){animation-delay:.08s;height:78%}.tr10-analysisSweep i:nth-child(3){animation-delay:.16s;height:62%}.tr10-analysisSweep i:nth-child(4){animation-delay:.24s;height:88%}.tr10-analysisSweep i:nth-child(5){animation-delay:.32s;height:70%}.tr10-analysisSweep i:nth-child(6){animation-delay:.4s;height:82%}.tr10-analysisSweep i:nth-child(7){animation-delay:.48s;height:58%}.tr10-analysisSweep i:nth-child(8){animation-delay:.56s;height:72%}.tr10-analysisSweep i:nth-child(9){animation-delay:.64s;height:48%}.tr10-analysisSweep i:nth-child(10){animation-delay:.72s;height:63%}@keyframes tr10Analyze{from{transform:scaleY(.32);opacity:.25}to{transform:scaleY(1);opacity:.82}}.tr10-analysisModal>footer{padding:12px 16px 14px;display:grid;gap:3px}.tr10-analysisModal>footer span{color:#75dca9;font-size:7px;font-weight:1000;letter-spacing:.11em}.tr10-analysisModal>footer small{color:#69818b;font-size:7px}.tr10-reviewModal{width:min(850px,100%);display:grid;grid-template-rows:auto auto auto minmax(0,1fr) auto}.tr10-reviewHeader h2{margin:4px 0 2px}.tr10-reviewHeader p{margin:0;color:#738a94;font-size:8px}.tr10-reviewProgress{position:relative;padding:10px 13px;border-bottom:1px solid rgba(80,151,177,.1);overflow:hidden}.tr10-reviewProgress>div{display:flex;justify-content:space-between;gap:12px;color:#7d99a3;font-size:7px}.tr10-reviewProgress strong{color:#d8edf4}.tr10-reviewProgress>i{position:absolute;left:0;right:0;bottom:0;height:2px;transform-origin:left;background:#4dd7f8}.tr10-reviewInstruction{padding:10px 13px;border-bottom:1px solid rgba(80,151,177,.08);background:#061219}.tr10-reviewInstruction span{font-size:7px;font-weight:1000;color:#6edbf7}.tr10-reviewInstruction p{margin:4px 0 0;color:#7b929c;font-size:8px}.tr10-reviewModal .tr10-candidates{max-height:none;min-height:0}.tr10-picker{width:min(520px,100%)}.tr10-picker>div{max-height:330px;overflow:auto;padding:9px}.tr10-picker>div>label{min-height:52px;display:grid;grid-template-columns:28px 1fr;align-items:center;padding:8px;border-bottom:1px solid rgba(80,145,169,.08)}.tr10-picker>div strong{display:block;font-size:9px}.tr10-picker>div small{font-size:7px;color:#677f89}.tr10-newRoute{display:grid;gap:5px;padding:10px 13px}.tr10-newRoute span{font-size:6px;font-weight:1000;color:#617b85}.tr10-newRoute input{height:38px;padding:0 10px;border:1px solid rgba(75,151,178,.15);border-radius:8px;background:#06131a;color:#e8f5f9}
        @media(max-width:900px){.tr10-stats{grid-template-columns:repeat(3,1fr)}.tr10-tableHead,.tr10-row{grid-template-columns:28px minmax(0,1fr) 55px 100px}.tr10-tableHead span:last-child{display:none}.tr10-actions{grid-column:2/-1;justify-content:flex-start}.tr10-toolbar{grid-template-columns:1fr 1fr}.tr10-toolbar label:first-child{grid-column:1/-1}.tr10-playlistLayout{grid-template-columns:200px 1fr}.tr10-smart{grid-template-columns:1fr}}
        @media(max-width:650px){.tr10-page{width:calc(100% - 14px)}.tr10-hero{padding:18px;display:block}.tr10-hero h1{font-size:30px}.tr10-hero>button{margin-top:12px}.tr10-stats{grid-template-columns:1fr 1fr}.tr10-sectionHead{display:block}.tr10-headActions{margin-top:10px;display:grid;grid-template-columns:1fr 1fr}.tr10-healthRail{grid-template-columns:repeat(5,minmax(112px,1fr));overflow-x:auto;padding-bottom:2px}.tr10-tabs{grid-template-columns:repeat(5,minmax(105px,1fr));overflow-x:auto}.tr10-statusPanelHead small{display:none}.tr10-toolbar{grid-template-columns:1fr}.tr10-toolbar label:first-child{grid-column:auto}.tr10-bulk{display:block}.tr10-bulk>div{margin-top:8px;display:grid;grid-template-columns:1fr 1fr}.tr10-tableHead{display:none}.tr10-row{grid-template-columns:26px minmax(0,1fr);gap:8px;padding:10px 9px}.tr10-row>.tr10-duration,.tr10-row>.tr10-energy{grid-column:2}.tr10-actions{grid-column:2;display:grid;grid-template-columns:40px 40px repeat(4,1fr)}.tr10-trackCell{grid-template-columns:auto auto minmax(0,1fr)}.tr10-healthBadge{grid-column:3;justify-self:start}.tr10-energy{width:150px}.tr10-order{display:none!important}.tr10-cardGrid{grid-template-columns:1fr;padding:9px}.tr10-playlistLayout{grid-template-columns:1fr}.tr10-playlistLayout>aside{border-right:0;border-bottom:1px solid rgba(78,143,166,.1);display:flex;overflow-x:auto}.tr10-createPlaylist{min-width:190px}.tr10-playlistLayout>aside>button{min-width:145px}.tr10-playlistSongs article{grid-template-columns:23px auto minmax(0,1fr) auto}.tr10-playlistSongs article>button:nth-of-type(n+2){display:none}.tr10-inspector{height:calc(100dvh - 16px)}.tr10-modalBack{padding:8px}.tr10-inspectGrid{grid-template-columns:1fr;padding:10px}.tr10-meta{grid-template-columns:1fr 1fr;padding:0 10px 10px}.tr10-inspectCommands{display:grid;grid-template-columns:1fr 1fr}.tr10-inspector>footer{display:grid;grid-template-columns:1fr 1fr}.tr10-inspector>footer .tr10-saveButton{grid-column:1/-1;grid-row:1}.tr10-detailLookupHead{display:block}.tr10-detailLookupHead>button{margin-bottom:8px}.tr10-detailCandidates>button,.tr10-candidates>button{grid-template-columns:52px minmax(0,1fr) 26px}.tr10-detailCandidates img,.tr10-candidates img,.tr10-candidateArt{width:52px;height:52px}.tr10-matchTier{grid-column:2;justify-self:start;text-align:left}.tr10-selectMark{grid-column:3;grid-row:1/3}.tr10-detailLookupFooter{display:grid;grid-template-columns:1fr 1fr}.tr10-detailLookupFooter>div{grid-column:1/-1}.tr10-reviewProgress>div{display:grid}.tr10-reviewDock{right:9px;bottom:80px}.tr10-smartBuild{padding:18px}}

        /* FINAL PRO LIBRARY + RESPONSIVE PASS: preserve all current features */
        .tr10-page{
          padding-bottom:calc(92px + env(safe-area-inset-bottom,0px));
        }

        /* Library status is a dashboard filter rail, not a duplicate tab bar. */
        .tr10-statusPanel{
          padding:11px 12px 12px!important;
          border-top:1px solid rgba(103,188,218,.08)!important;
          border-bottom:1px solid rgba(103,188,218,.18)!important;
          background:linear-gradient(180deg,#08151c,#050c10)!important;
        }
        .tr10-statusPanelHead{
          margin:0 1px 8px!important;
        }
        .tr10-statusPanelHead span{
          color:#9dc3d0!important;
          font-size:7px!important;
          font-weight:1000!important;
          letter-spacing:.16em!important;
        }
        .tr10-statusPanelHead small{
          color:#617d88!important;
          font-size:6px!important;
          letter-spacing:.1em!important;
        }
        .tr10-healthRail{
          gap:7px!important;
        }
        .tr10-healthRail button{
          height:38px!important;
          padding:0 10px!important;
          border-radius:7px!important;
          border-color:rgba(99,175,202,.16)!important;
          background:linear-gradient(180deg,#0a1921,#050d12)!important;
          color:#9bb0b9!important;
          font-size:7.5px!important;
          letter-spacing:.07em!important;
          box-shadow:inset 0 1px rgba(255,255,255,.025)!important;
        }
        .tr10-healthRail button b{
          min-width:25px!important;
          height:22px!important;
          border-radius:5px!important;
          color:#d8e9ef!important;
          font-size:7.5px!important;
        }
        .tr10-healthRail button.is-active{
          border-color:rgba(72,207,247,.52)!important;
          color:#f0fbff!important;
          background:linear-gradient(180deg,#0b3444,#071c25)!important;
          box-shadow:inset 0 -2px #44d1f7,inset 0 1px rgba(255,255,255,.04)!important;
        }
        .tr10-healthRail button.is-needs{
          border-color:rgba(255,78,88,.30)!important;
          color:#f1a9ae!important;
        }
        .tr10-healthRail button.is-needs.is-active{
          border-color:rgba(255,78,88,.64)!important;
          color:#ffe6e8!important;
          background:linear-gradient(180deg,#5b171d,#2c0b0f)!important;
          box-shadow:inset 0 -2px #ff5c66!important;
        }

        /* Main navigation reads as a separate premium navigation deck. */
        .tr10-tabs{
          gap:1px!important;
          padding:5px!important;
          border-top:1px solid rgba(255,255,255,.018)!important;
          border-bottom:1px solid rgba(95,173,202,.14)!important;
          background:#03090d!important;
        }
        .tr10-tabs button{
          height:40px!important;
          border:1px solid transparent!important;
          border-radius:6px!important;
          background:linear-gradient(180deg,rgba(10,22,29,.6),rgba(4,11,15,.55))!important;
          color:#8199a3!important;
          font-size:8.5px!important;
          font-weight:1000!important;
          letter-spacing:.095em!important;
          text-shadow:0 1px rgba(0,0,0,.9)!important;
        }
        .tr10-tabs button:hover{
          color:#c5e1e9!important;
          border-color:rgba(84,168,199,.12)!important;
        }
        .tr10-tabs button.is-active{
          border-color:rgba(70,201,242,.28)!important;
          color:#effbff!important;
          background:linear-gradient(180deg,#0a2a36,#071821)!important;
          box-shadow:inset 0 -2px #46d2f7,inset 0 1px rgba(255,255,255,.035)!important;
        }

        /* Hard geometry boundaries stop artwork from ever intruding into text. */
        .tr10-tableHead,.tr10-row{
          grid-template-columns:30px minmax(260px,1fr) 58px 94px minmax(330px,390px)!important;
          gap:9px!important;
        }
        .tr10-trackCell{
          position:relative!important;
          min-width:0!important;
          display:grid!important;
          grid-template-columns:34px 36px minmax(0,1fr)!important;
          grid-template-rows:auto auto!important;
          column-gap:9px!important;
          row-gap:3px!important;
          align-items:center!important;
          overflow:hidden!important;
        }
        .tr10-trackCell>.tr10-play{
          grid-column:1!important;
          grid-row:1/3!important;
          width:34px!important;
          height:34px!important;
          min-width:34px!important;
          align-self:center!important;
        }
        .tr10-trackCell>.tr10-art{
          grid-column:2!important;
          grid-row:1/3!important;
          align-self:center!important;
        }
        .tr10-trackText{
          position:relative!important;
          z-index:1!important;
          grid-column:3!important;
          grid-row:1!important;
          width:100%!important;
          min-width:0!important;
          overflow:hidden!important;
        }
        .tr10-trackText strong,.tr10-trackText span,.tr10-trackText small{
          width:100%!important;
          max-width:100%!important;
          overflow:hidden!important;
          text-overflow:ellipsis!important;
          white-space:nowrap!important;
        }
        .tr10-art--row{
          position:relative!important;
          width:36px!important;
          min-width:36px!important;
          max-width:36px!important;
          height:36px!important;
          min-height:36px!important;
          max-height:36px!important;
          contain:paint!important;
          isolation:isolate!important;
        }
        .tr10-art--row img{
          position:absolute!important;
          inset:0!important;
          display:block!important;
          width:100%!important;
          height:100%!important;
          max-width:100%!important;
          max-height:100%!important;
          object-fit:cover!important;
        }
        .tr10-trackCell>.tr10-healthBadge{
          grid-column:3!important;
          grid-row:2!important;
          justify-self:start!important;
          margin:0!important;
          max-width:100%!important;
        }

        /* Compact premium hardware-style energy selector. */
        .tr10-energy{
          justify-self:start!important;
          width:88px!important;
          min-width:88px!important;
          max-width:88px!important;
          height:28px!important;
          padding:0 6px!important;
          grid-template-columns:7px minmax(0,1fr) 18px!important;
          gap:6px!important;
          border-radius:5px!important;
          font-size:7px!important;
          letter-spacing:.105em!important;
          text-shadow:none!important;
          box-shadow:inset 0 1px rgba(255,255,255,.035),inset 0 -1px rgba(0,0,0,.8)!important;
        }
        .tr10-energy:after{left:6px!important;right:6px!important;top:3px!important}
        .tr10-energy>.tr10-energyLed{
          width:5px!important;
          height:5px!important;
          box-shadow:0 0 5px currentColor!important;
        }
        .tr10-energySegments{
          width:18px!important;
          height:12px!important;
          padding:2px 3px!important;
          gap:1px!important;
          border-radius:3px!important;
        }
        .tr10-energySegments i{width:2px!important;box-shadow:none!important}
        .tr10-energySegments i:nth-child(1){height:3px!important}
        .tr10-energySegments i:nth-child(2){height:6px!important}
        .tr10-energySegments i:nth-child(3){height:9px!important}

        /* Real progress UI: no decorative analyzer/graph while scanning. */
        .tr10-analysisModal{
          width:min(620px,100%)!important;
        }
        .tr10-analysisProgress{
          height:8px!important;
          margin:0!important;
          border-top:1px solid rgba(74,174,209,.08)!important;
          border-bottom:1px solid rgba(0,0,0,.4)!important;
          background:#031017!important;
        }
        .tr10-analysisProgress i{
          background:linear-gradient(90deg,#29bce5,#73e5ff)!important;
          box-shadow:0 0 12px rgba(68,208,247,.28)!important;
        }
        .tr10-analysisCurrent{
          margin:0 16px 14px!important;
          padding:13px 14px!important;
          display:grid!important;
          gap:3px!important;
          border:1px solid rgba(86,171,201,.15)!important;
          border-radius:9px!important;
          background:linear-gradient(180deg,#07151c,#040c11)!important;
        }
        .tr10-analysisCurrent span{
          color:#5ed6f5!important;
          font-size:6.5px!important;
          font-weight:1000!important;
          letter-spacing:.13em!important;
        }
        .tr10-analysisCurrent strong{
          min-width:0!important;
          overflow:hidden!important;
          text-overflow:ellipsis!important;
          white-space:nowrap!important;
          color:#e7f6fb!important;
          font-size:12px!important;
        }
        .tr10-analysisCurrent small{
          min-width:0!important;
          overflow:hidden!important;
          text-overflow:ellipsis!important;
          white-space:nowrap!important;
          color:#718a94!important;
          font-size:8px!important;
        }
        .tr10-analysisSweep{display:none!important}

        /* Review results stay clean and foregrounded. */
        .tr10-reviewModal{
          max-height:calc(100dvh - 30px)!important;
        }
        .tr10-candidates{
          min-height:0!important;
          overflow:auto!important;
          overscroll-behavior:contain!important;
        }

        @media(max-width:900px){
          .tr10-tableHead,.tr10-row{
            grid-template-columns:28px minmax(0,1fr) 54px 90px!important;
          }
          .tr10-actions{
            grid-column:2/-1!important;
          }
        }

        @media(max-width:650px){
          .tr10-page{
            width:calc(100% - 12px)!important;
            margin-left:auto!important;
            margin-right:auto!important;
            padding-bottom:calc(104px + env(safe-area-inset-bottom,0px))!important;
          }
          .tr10-hero{padding:15px!important}
          .tr10-hero h1{font-size:27px!important}
          .tr10-stats{gap:6px!important}
          .tr10-stats>div{min-height:62px!important}

          .tr10-statusPanel{padding:10px!important}
          .tr10-statusPanelHead{margin-bottom:8px!important}
          .tr10-statusPanelHead small{display:block!important;font-size:5.5px!important}
          .tr10-healthRail{
            grid-template-columns:1fr 1fr!important;
            overflow:visible!important;
            gap:6px!important;
          }
          .tr10-healthRail button{
            width:100%!important;
            min-width:0!important;
            height:39px!important;
            font-size:7.5px!important;
          }
          .tr10-healthRail button:first-child{
            grid-column:1/-1!important;
          }

          .tr10-tabs{
            display:flex!important;
            gap:5px!important;
            padding:6px!important;
            overflow-x:auto!important;
            overscroll-behavior-x:contain!important;
            scroll-snap-type:x proximity!important;
            scrollbar-width:none!important;
          }
          .tr10-tabs::-webkit-scrollbar{display:none!important}
          .tr10-tabs button{
            flex:0 0 116px!important;
            min-width:116px!important;
            height:42px!important;
            font-size:8.5px!important;
            scroll-snap-align:start!important;
          }

          .tr10-toolbar{
            gap:7px!important;
            padding:9px!important;
          }
          .tr10-toolbar input,.tr10-toolbar select{
            height:42px!important;
            font-size:9px!important;
          }

          /* Three compact mobile rows: song, time/energy, actions. */
          .tr10-row{
            min-height:0!important;
            padding:10px 8px!important;
            display:grid!important;
            grid-template-columns:22px minmax(0,1fr)!important;
            grid-template-rows:auto 30px 34px!important;
            column-gap:8px!important;
            row-gap:7px!important;
            align-items:center!important;
          }
          .tr10-check{
            grid-column:1!important;
            grid-row:1/4!important;
            align-self:start!important;
            padding-top:10px!important;
          }
          .tr10-trackCell{
            grid-column:2!important;
            grid-row:1!important;
            grid-template-columns:36px 38px minmax(0,1fr)!important;
            grid-template-rows:auto auto!important;
            gap:4px 8px!important;
            overflow:hidden!important;
          }
          .tr10-trackCell>.tr10-play{
            width:36px!important;
            height:36px!important;
            min-width:36px!important;
          }
          .tr10-art--row{
            width:38px!important;
            min-width:38px!important;
            max-width:38px!important;
            height:38px!important;
            min-height:38px!important;
            max-height:38px!important;
          }
          .tr10-trackText strong{font-size:11px!important}
          .tr10-trackText span{font-size:7.5px!important}
          .tr10-trackText small{font-size:6px!important}
          .tr10-trackCell>.tr10-healthBadge{
            padding:4px 7px!important;
            font-size:5.5px!important;
          }
          .tr10-duration{
            grid-column:2!important;
            grid-row:2!important;
            justify-self:start!important;
            align-self:center!important;
            margin:0!important;
            font-size:8px!important;
          }
          .tr10-energy{
            grid-column:2!important;
            grid-row:2!important;
            justify-self:end!important;
            align-self:center!important;
            width:82px!important;
            min-width:82px!important;
            max-width:82px!important;
            height:26px!important;
            font-size:6.5px!important;
          }
          .tr10-actions{
            grid-column:2!important;
            grid-row:3!important;
            width:100%!important;
            display:grid!important;
            grid-template-columns:32px 32px repeat(4,minmax(0,1fr))!important;
            gap:5px!important;
            justify-content:stretch!important;
          }
          .tr10-actions button{
            width:100%!important;
            min-width:0!important;
            height:32px!important;
            padding:0 4px!important;
            border-radius:6px!important;
            font-size:5.7px!important;
            line-height:1.05!important;
            white-space:normal!important;
          }
          .tr10-actions button:nth-child(1),.tr10-actions button:nth-child(2){font-size:10px!important}
          .tr10-order{display:none!important}

          .tr10-analysisBack,.tr10-reviewBack{
            padding:8px!important;
            align-items:center!important;
          }
          .tr10-analysisModal,.tr10-reviewModal{
            width:100%!important;
            max-height:calc(100dvh - 16px)!important;
            border-radius:13px!important;
          }
          .tr10-analysisModal>header{
            padding:13px!important;
            gap:9px!important;
          }
          .tr10-analysisModal>header h2{font-size:16px!important}
          .tr10-analysisModal>header p{font-size:7px!important}
          .tr10-analysisCounter{min-width:62px!important;padding:7px!important}
          .tr10-analysisCounter strong{font-size:18px!important}
          .tr10-analysisStats{padding:10px!important;gap:6px!important}
          .tr10-analysisStats>div{min-height:52px!important}
          .tr10-analysisCurrent{margin:0 10px 10px!important;padding:10px!important}
          .tr10-analysisCurrent strong{font-size:10px!important}
          .tr10-analysisModal>footer{padding:10px!important}

          .tr10-reviewModal{
            display:grid!important;
            grid-template-rows:auto auto auto minmax(0,1fr) auto!important;
          }
          .tr10-reviewModal .tr10-candidates{
            overflow:auto!important;
            padding:7px!important;
          }
          .tr10-reviewModal>footer{
            display:grid!important;
            grid-template-columns:1fr 1fr!important;
            gap:6px!important;
            padding:9px!important;
          }
          .tr10-reviewModal>footer .is-primary{
            grid-column:1/-1!important;
          }
          .tr10-detailCandidates>button,.tr10-candidates>button{
            padding:8px!important;
          }
          .tr10-reviewDock{
            right:8px!important;
            left:8px!important;
            bottom:calc(82px + env(safe-area-inset-bottom,0px))!important;
            width:auto!important;
            text-align:center!important;
          }
        }

        @media(max-width:390px){
          .tr10-actions{grid-template-columns:30px 30px repeat(2,minmax(0,1fr))!important;grid-auto-rows:31px!important}
          .tr10-row{grid-template-rows:auto 28px auto!important}
          .tr10-energy{width:78px!important;min-width:78px!important;max-width:78px!important}
          .tr10-statusPanelHead small{display:none!important}
        }
      `}</style>
    </main>
  );
}
