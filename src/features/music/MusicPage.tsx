/* MVP_TRAINER_V5_R7_NEURAL_PLAYER_DISCOVERY */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import {
  clearMusicUrlCache,
  getMusicArtworkSignedUrl,
  getMusicTrackSignedUrl,
  listMusicTracks,
  removeMusicArtwork,
  removeMusicTrack,
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
import {
  getDiscoverPreferenceBoost,
  listMusicDiscoverySavedSongs,
  listMusicDiscoverySeeds,
  MUSIC_REDISCOVER_FOCUS_EVENT,
  consumeMusicRediscoverFocus,
  refreshDiscoveryLibraryFlags,
  removeDiscoverySeed,
  removeMusicDiscoverySavedSong,
  saveMusicDiscoveryRecommendation,
  setDiscoveryRecommendationState,
  subscribeMusicDiscovery,
  type MusicDiscoveryCategory,
  type MusicDiscoveryRecommendation,
  type MusicDiscoverySavedSong,
  type MusicDiscoverySeed,
} from "../../lib/musicDiscovery";

import { MusicIntelligencePanel } from "./MusicIntelligencePanel";
import { MusicAuditionPanel, markMusicAuditionSongInLibrary, type MusicAuditionSong } from "./MusicAuditionPanel";
import { buildDiscoveryRadar } from "../../lib/musicIntelligence";
import { createPortal } from "react-dom";
import { MusicLibraryVisualEngine } from "./premium/MusicLibraryVisualEngine";
import { MusicPremiumSelect } from "./premium/MusicPremiumSelect";
import { MvpAction, MvpDensityPicker, MvpMoreMenu, MvpMusicTabs } from "./premium/MusicUiPrimitives";
import {
  ChevronDownPremiumIcon,
  ChevronUpPremiumIcon,
  EditPremiumIcon,
  HeartPremiumIcon,
  NextPremiumIcon,
  PausePremiumIcon,
  PlayLessPremiumIcon,
  PlayPremiumIcon,
  PlaylistPremiumIcon,
  QueuePremiumIcon,
  ShufflePremiumIcon,
  SparkPremiumIcon,
} from "./premium/MusicLibraryPremiumIcons";
import "./premium/MusicLibraryPremium.css";
import "./premium/MusicUiSystem.css";

type DraftMap = Record<string, { title: string; artist: string; album: string; releaseYear: string; genre: string }>;
type PlaylistTrackMap = Record<string, string[]>;
type MusicTab = "songs" | "artists" | "albums" | "playlists" | "smart" | "intelligence" | "discover" | "audition";
type DiscoverySort = "newest" | "oldest" | "artist" | "most";
type DiscoveryFilter = "all" | "artist_catalog" | "new_current" | "same_era" | "hidden" | "unowned";
type DiscoveryView = "archive" | "saved";
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
type CollectionView = "list" | "grid4" | "grid8" | "grid16";
type PageSize = 12 | 24 | 48;
type DetailMode = "edit" | "info_results" | "artwork_results";
type DetailSaveState = "idle" | "searching" | "saving" | "changed" | "error";
type ReviewItem = { trackId: string; candidates: MusicMetadataCandidate[] };
type EnrichmentState = { running: boolean; current: number; total: number; matched: number; review: number; notFound: number; label: string; serviceMessage: string };
type BurnMode = "mp3" | "audio";
type BurnDisc = { number: number; tracks: MusicTrack[]; bytes: number; seconds: number };
type LibraryCollectionDetail =
  | { kind: "artist"; artist: string }
  | { kind: "album"; artist: string; album: string };

const MP3_CD_CAPACITY_BYTES = 700 * 1024 * 1024;
const AUDIO_CD_CAPACITY_SECONDS = 80 * 60;

function burnTrackSeconds(track: MusicTrack) {
  const seconds = Number(track.duration_seconds || 0);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 210;
}
function burnTrackBytes(track: MusicTrack) {
  const bytes = Number(track.file_size_bytes || 0);
  return Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
}
function splitBurnDiscs(tracks: MusicTrack[], mode: BurnMode): BurnDisc[] {
  if (!tracks.length) return [];
  const limit = mode === "mp3" ? MP3_CD_CAPACITY_BYTES : AUDIO_CD_CAPACITY_SECONDS;
  const discs: BurnDisc[] = [];
  let current: BurnDisc = { number: 1, tracks: [], bytes: 0, seconds: 0 };

  for (const track of tracks) {
    const bytes = burnTrackBytes(track);
    const seconds = burnTrackSeconds(track);
    const value = mode === "mp3" ? bytes : seconds;
    const currentValue = mode === "mp3" ? current.bytes : current.seconds;
    if (current.tracks.length && currentValue + value > limit) {
      discs.push(current);
      current = { number: discs.length + 1, tracks: [], bytes: 0, seconds: 0 };
    }
    current.tracks.push(track);
    current.bytes += bytes;
    current.seconds += seconds;
  }
  if (current.tracks.length) discs.push(current);
  return discs;
}
function formatBurnClock(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${minutes}:${String(secs).padStart(2, "0")}`;
}
function formatBurnMb(bytes: number) {
  return `${(Math.max(0, bytes) / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

const PLAYLISTS_CHANGED_EVENT = "mvp:music-playlists-changed";
const SMART_MIX_NAMES: Record<SmartIntensity, string> = {
  high: "Smart Mix • High",
  balanced: "Smart Mix • Balanced",
  recovery: "Smart Mix • Recovery",
};
function isSmartMixPlaylist(playlist: MusicPlaylist) {
  return Object.values(SMART_MIX_NAMES).includes(playlist.name);
}

function formatFileSize(bytes: number | null) {
  const size = Math.max(0, Number(bytes || 0));
  if (!Number.isFinite(size) || size <= 0) return "0 MB";

  const kb = 1024;
  const mb = kb * 1024;
  const gb = mb * 1024;
  const tb = gb * 1024;

  if (size >= tb) {
    const value = size / tb;
    return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} TB`;
  }
  if (size >= gb) {
    const value = size / gb;
    return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} GB`;
  }

  const value = size / mb;
  return `${value.toFixed(value >= 10 ? 0 : 1)} MB`;
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
function compareLibraryText(left: string | null | undefined, right: string | null | undefined) {
  return String(left || "").trim().localeCompare(String(right || "").trim(), undefined, { sensitivity: "base", numeric: true });
}
function compareSongTitle(a: MusicTrack, b: MusicTrack) {
  return compareLibraryText(a.title, b.title) || compareLibraryText(artistLabel(a), artistLabel(b)) || a.sort_order - b.sort_order;
}
function compareSongTitleDescending(a: MusicTrack, b: MusicTrack) {
  return compareLibraryText(b.title, a.title) || compareLibraryText(artistLabel(a), artistLabel(b)) || a.sort_order - b.sort_order;
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
  score += getDiscoverPreferenceBoost(track);
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

function shuffleMusicTracks(tracks: MusicTrack[]) {
  const next = [...tracks];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
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


const DISCOVERY_SECTIONS: Array<{ key: MusicDiscoveryCategory; title: string; subtitle: string; tone: string }> = [
  { key: "artist_catalog", title: "More From This Artist", subtitle: "Popular and seed-matched songs from this artist's full career", tone: "artist" },
  { key: "new_upcoming", title: "New & Current", subtitle: "Current releases that genuinely match the seed song and artist style", tone: "new" },
  { key: "same_era", title: "Similar From That Era", subtitle: "Strong stylistic matches close to the seed song's release era", tone: "era" },
  { key: "hidden_era", title: "Hidden Gems Across Eras", subtitle: "Deeper new-to-you tracks from other eras that still fit the seed sound", tone: "hidden" },
];

function filterDiscoveryRecommendations(items: MusicDiscoveryRecommendation[], filter: DiscoveryFilter) {
  if (filter === "artist_catalog") return items.filter((item) => item.category === "artist_catalog");
  if (filter === "new_current") return items.filter((item) => item.category === "new_upcoming");
  if (filter === "same_era") return items.filter((item) => item.category === "same_era");
  if (filter === "hidden") return items.filter((item) => item.category === "hidden_era");
  if (filter === "unowned") return items.filter((item) => !item.inLibrary);
  return items;
}

function discoverySectionsForFilter(filter: DiscoveryFilter) {
  if (filter === "artist_catalog") return DISCOVERY_SECTIONS.filter((section) => section.key === "artist_catalog");
  if (filter === "new_current") return DISCOVERY_SECTIONS.filter((section) => section.key === "new_upcoming");
  if (filter === "same_era") return DISCOVERY_SECTIONS.filter((section) => section.key === "same_era");
  if (filter === "hidden") return DISCOVERY_SECTIONS.filter((section) => section.key === "hidden_era");
  return DISCOVERY_SECTIONS;
}

const DISCOVERY_SEED_UI_KEY = "mvp_rediscover_expanded_seeds_v1";
const DISCOVERY_LANE_UI_KEY = "mvp_rediscover_expanded_lanes_v1";

function readUiSet(key: string) {
  if (typeof window === "undefined") return new Set<string>();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || "[]");
    return new Set<string>(Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : []);
  } catch {
    return new Set<string>();
  }
}
function writeUiSet(key: string, value: Set<string>) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(key, JSON.stringify([...value])); } catch { /* UI state is optional. */ }
}
function hasUiSet(key: string) {
  if (typeof window === "undefined") return false;
  try { return window.localStorage.getItem(key) !== null; } catch { return false; }
}
function formatDiscoveryDate(value: number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const dateText = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
  const timeText = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
  return `${dateText} • ${timeText}`;
}
function discoveryTypeLabel(item: MusicDiscoveryRecommendation | MusicDiscoverySavedSong) {
  if (item.discoveryType === "artist_catalog") return "ARTIST CATALOG";
  if (item.discoveryType === "new_artist") return "NEW ARTIST";
  if (item.discoveryType === "new_release") return "NEW RELEASE";
  if (item.discoveryType === "modern_match") return "MODERN MATCH";
  if (item.discoveryType === "hidden_gem") return "HIDDEN GEM";
  return "ERA MATCH";
}

function DiscoveryCard({
  seedId,
  item,
  previewingId,
  previewErrorId,
  saved,
  saving,
  onPreview,
  onSave,
}: {
  seedId: string;
  item: MusicDiscoveryRecommendation;
  previewingId: string | null;
  previewErrorId: string | null;
  saved: boolean;
  saving: boolean;
  onPreview: (item: MusicDiscoveryRecommendation) => void;
  onSave: (item: MusicDiscoveryRecommendation) => void;
  key?: string;
}) {
  const previewing = previewingId === item.id;
  const previewError = previewErrorId === item.id;
  return <article className={item.inLibrary ? "is-owned" : ""}>
    {item.artworkUrl ? <img src={item.artworkUrl} alt="" /> : <div className="tr10-discoverArt">♫</div>}
    <div>
      <small className={`tr10-discoverType is-${item.discoveryType}`}>{discoveryTypeLabel(item)}{item.year ? ` • ${item.year}` : ""}</small>
      <strong>{item.title}</strong>
      <span>{item.artist}{item.album && item.album !== item.title ? ` • ${item.album}` : ""}</span>
      <p>{item.reason}</p>
    </div>
    <footer>
      {item.previewUrl
        ? <button className={`tr10-previewButton ${previewing ? "is-playing" : ""}`} onClick={() => onPreview(item)}>{previewing ? <><PausePremiumIcon /><span>STOP PREVIEW</span></> : previewError ? <><SparkPremiumIcon /><span>RETRY PREVIEW</span></> : <><PlayPremiumIcon /><span>PREVIEW</span></>}</button>
        : <span className="tr10-previewUnavailable">PREVIEW UNAVAILABLE</span>}
      {item.inLibrary
        ? <b>✓ IN YOUR LIBRARY</b>
        : <button className={saved ? "is-toAdd" : ""} disabled={saved || saving} onClick={() => onSave(item)}>{saved ? "✓ SAVED" : saving ? "SAVING…" : "MARK TO ADD"}</button>}
      <button onClick={() => setDiscoveryRecommendationState(seedId,item.id,{dismissed:true})}>NOT INTERESTED</button>
      {item.storeUrl ? <a className="tr10-storeLink" href={item.storeUrl} target="_blank" rel="noreferrer">APPLE MUSIC</a> : null}
    </footer>
  </article>;
}

function SavedSongCard({
  item,
  previewingId,
  previewErrorId,
  removing,
  onPreview,
  onDelete,
}: {
  item: MusicDiscoverySavedSong;
  previewingId: string | null;
  previewErrorId: string | null;
  removing: boolean;
  onPreview: (item: MusicDiscoverySavedSong) => void;
  onDelete: (item: MusicDiscoverySavedSong) => void;
  key?: string;
}) {
  const previewing = previewingId === item.id;
  const previewError = previewErrorId === item.id;
  return <article className={item.inLibrary ? "is-owned" : ""}>
    {item.artworkUrl ? <img src={item.artworkUrl} alt="" /> : <div className="tr10-discoverArt">♫</div>}
    <div>
      <small className={`tr10-discoverType is-${item.discoveryType}`}>{discoveryTypeLabel(item)}{item.year ? ` • ${item.year}` : ""}</small>
      <strong>{item.title}</strong>
      <span>{item.artist}{item.album && item.album !== item.title ? ` • ${item.album}` : ""}</span>
      <p>Saved from {item.seedTrackTitle}{item.seedTrackArtist ? ` • ${item.seedTrackArtist}` : ""}</p>
    </div>
    <footer>
      {item.previewUrl
        ? <button className={`tr10-previewButton ${previewing ? "is-playing" : ""}`} onClick={() => onPreview(item)}>{previewing ? <><PausePremiumIcon /><span>STOP PREVIEW</span></> : previewError ? <><SparkPremiumIcon /><span>RETRY PREVIEW</span></> : <><PlayPremiumIcon /><span>PREVIEW</span></>}</button>
        : <span className="tr10-previewUnavailable">PREVIEW UNAVAILABLE</span>}
      {item.storeUrl ? <a className="tr10-storeLink" href={item.storeUrl} target="_blank" rel="noreferrer">APPLE MUSIC</a> : null}
      <button className="tr10-savedDelete" disabled={removing} onClick={() => onDelete(item)}>{removing ? "DELETING…" : "DELETE"}</button>
    </footer>
  </article>;
}


type CollectionDetailViewProps = {
  kind: "artist" | "album";
  title: string;
  subtitle: string;
  tracks: MusicTrack[];
  backLabel: string;
  currentTrackId: string | null;
  playing: boolean;
  trackMeta: (track: MusicTrack) => string;
  onBack: () => void;
  onPlayAll: () => void;
  onShuffle: () => void;
  onPlayTrack: (track: MusicTrack) => void;
  onLike: (track: MusicTrack) => void;
  onPlayLess: (track: MusicTrack) => void;
  onPlaylist: (track: MusicTrack) => void;
  onEdit: (track: MusicTrack) => void;
};

function CollectionDetailView({
  kind,
  title,
  subtitle,
  tracks,
  backLabel,
  currentTrackId,
  playing,
  trackMeta,
  onBack,
  onPlayAll,
  onShuffle,
  onPlayTrack,
  onLike,
  onPlayLess,
  onPlaylist,
  onEdit,
}: CollectionDetailViewProps) {
  const totalSeconds = tracks.reduce((sum, track) => sum + Number(track.duration_seconds || 0), 0);
  const heroTrack = tracks[0];
  return <section className="tr10-collectionDetail">
    <button type="button" className="tr10-collectionBack" onClick={onBack}>‹ {backLabel}</button>
    <header className="tr10-collectionDetailHero">
      {heroTrack ? <TrackArtwork track={heroTrack} size="card" /> : null}
      <div className="tr10-collectionDetailIdentity">
        <small>{kind === "artist" ? "ARTIST" : "ALBUM"}</small>
        <h2>{title}</h2>
        <p>{subtitle}</p>
        <span>{tracks.length} SONG{tracks.length === 1 ? "" : "S"} • {formatLongDuration(totalSeconds)}</span>
      </div>
      <div className="tr10-collectionDetailActions">
        <button type="button" className="is-primary" disabled={!tracks.length} onClick={onPlayAll}><PlayPremiumIcon /><span>PLAY ALL</span></button>
        <button type="button" disabled={tracks.length < 2} onClick={onShuffle}><ShufflePremiumIcon /><span>SHUFFLE</span></button>
      </div>
    </header>
    <div className="tr10-collectionSongList">
      {tracks.map((track, index) => {
        const current = currentTrackId === track.id;
        return <article className={`tr10-collectionSong ${current ? "is-current" : ""}`} key={track.id}>
          <b className="tr10-collectionSongNumber">{String(index + 1).padStart(2, "0")}</b>
          <button type="button" className={`tr10-collectionSongPlay ${current && playing ? "is-playing" : ""}`} onClick={() => onPlayTrack(track)} aria-label={`${current && playing ? "Pause" : "Play"} ${track.title}`}>{current && playing ? <PausePremiumIcon /> : <PlayPremiumIcon />}</button>
          <TrackArtwork track={track} />
          <div className="tr10-collectionSongText"><strong>{track.title}</strong><span>{trackMeta(track)}</span></div>
          <span className="tr10-collectionSongDuration">{formatDuration(track.duration_seconds)}</span>
          <div className="tr10-collectionSongActions">
            <button type="button" className={track.favorite ? "is-liked" : ""} aria-pressed={track.favorite} onClick={() => onLike(track)}><HeartPremiumIcon filled={track.favorite} /><span>{track.favorite ? "LIKED" : "LIKE"}</span></button>
            <button type="button" className={track.play_less ? "is-less" : ""} aria-pressed={track.play_less} onClick={() => onPlayLess(track)}><PlayLessPremiumIcon /><span>PLAY LESS</span></button>
            <button type="button" onClick={() => onPlaylist(track)}><PlaylistPremiumIcon /><span>PLAYLIST</span></button>
            <button type="button" onClick={() => onEdit(track)}><EditPremiumIcon /><span>EDIT</span></button>
          </div>
        </article>;
      })}
    </div>
  </section>;
}

function readCollectionView(key: string, fallback: CollectionView = "grid8"): CollectionView {
  if (typeof window === "undefined") return fallback;
  const value = window.localStorage.getItem(key);
  return value === "list" || value === "grid4" || value === "grid8" || value === "grid16" ? value : fallback;
}


export function MusicPage({ navigate }: { navigate?: (to: string) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const artworkInputRef = useRef<HTMLInputElement | null>(null);
  const tabNavRef = useRef<HTMLDivElement | null>(null);
  const player = useMusicPlayer();

  const [tab, setTab] = useState<MusicTab>("songs");
  const [collectionDetail, setCollectionDetail] = useState<LibraryCollectionDetail | null>(null);
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [drafts, setDrafts] = useState<DraftMap>({});
  const [playlists, setPlaylists] = useState<MusicPlaylist[]>([]);
  const [playlistTrackIds, setPlaylistTrackIds] = useState<PlaylistTrackMap>({});
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [songSearch, setSongSearch] = useState("");
  const [songSort, setSongSort] = useState<SongSort>("library");
  const [artistView, setArtistView] = useState<CollectionView>(() => readCollectionView("mvp_music_artist_view_v1", "grid8"));
  const [albumView, setAlbumView] = useState<CollectionView>(() => readCollectionView("mvp_music_album_view_v1", "grid8"));
  const [energyFilter, setEnergyFilter] = useState<EnergyFilter>("all");
  const [healthFilter, setHealthFilter] = useState<LibraryHealth>("all");
  const [pageSize, setPageSize] = useState<PageSize>(24);
  const [page, setPage] = useState(1);
  const [selectedSongIds, setSelectedSongIds] = useState<Set<string>>(new Set());
  const [resolvedArtworkIds, setResolvedArtworkIds] = useState<Set<string>>(new Set());
  const orderSaveTimerRef = useRef<number | null>(null);
  const orderSaveChainRef = useRef<Promise<void>>(Promise.resolve());
  const pendingOrderRef = useRef<MusicTrack[]>([]);
  const [playbackErrors, setPlaybackErrors] = useState<Record<string, string>>({});
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
  const [discoverySeeds, setDiscoverySeeds] = useState<MusicDiscoverySeed[]>(() => listMusicDiscoverySeeds());
  const [savedDiscoverySongs, setSavedDiscoverySongs] = useState<MusicDiscoverySavedSong[]>(() => listMusicDiscoverySavedSongs());
  const [discoveryView, setDiscoveryView] = useState<DiscoveryView>("archive");
  const [savedSongsPage, setSavedSongsPage] = useState(1);
  const [savingRecommendationId, setSavingRecommendationId] = useState<string | null>(null);
  const [removingSavedSongId, setRemovingSavedSongId] = useState<string | null>(null);
  const [removingDiscoverySeedId, setRemovingDiscoverySeedId] = useState<string | null>(null);
  const [discoverySearch, setDiscoverySearch] = useState("");
  const [discoverySort, setDiscoverySort] = useState<DiscoverySort>("newest");
  const [discoveryFilter, setDiscoveryFilter] = useState<DiscoveryFilter>("all");
  const [expandedDiscoverySeedIds, setExpandedDiscoverySeedIds] = useState<Set<string>>(() => readUiSet(DISCOVERY_SEED_UI_KEY));
  const [expandedDiscoveryLaneIds, setExpandedDiscoveryLaneIds] = useState<Set<string>>(() => readUiSet(DISCOVERY_LANE_UI_KEY));
  const discoveryDefaultsInitializedRef = useRef(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewStopTimerRef = useRef<number | null>(null);
  const [previewingRecommendationId, setPreviewingRecommendationId] = useState<string | null>(null);
  const [previewErrorRecommendationId, setPreviewErrorRecommendationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [burnOpen, setBurnOpen] = useState(false);
  const [burnMode, setBurnMode] = useState<BurnMode>("mp3");
  const [burnBusy, setBurnBusy] = useState(false);
  const [burnStatus, setBurnStatus] = useState("");
  const [burnComplete, setBurnComplete] = useState(false);
  const [burnProgress, setBurnProgress] = useState<{
    disc: number;
    discs: number;
    track: number;
    tracks: number;
    title: string;
    artist: string;
    percent: number;
  } | null>(null);
  const [enrichment, setEnrichment] = useState<EnrichmentState>({ running: false, current: 0, total: 0, matched: 0, review: 0, notFound: 0, label: "", serviceMessage: "" });

  const totalSize = useMemo(() => tracks.reduce((sum, track) => sum + Number(track.file_size_bytes || 0), 0), [tracks]);
  const totalDuration = useMemo(() => tracks.reduce((sum, track) => sum + Number(track.duration_seconds || 0), 0), [tracks]);
  const trackNeedsArtwork = (track: MusicTrack) => needsMusicArtwork(track) && !resolvedArtworkIds.has(track.id);
  const likedCount = useMemo(() => tracks.filter((track) => track.favorite).length, [tracks]);
  const needsInfoCount = useMemo(() => tracks.filter(needsMusicMetadata).length, [tracks]);
  const missingArtCount = useMemo(() => tracks.filter((track) => needsMusicArtwork(track) && !resolvedArtworkIds.has(track.id)).length, [tracks, resolvedArtworkIds]);
  const reviewCount = useMemo(() => tracks.filter((track) => track.metadata_status === "review").length, [tracks]);
  const libraryOrderedTracks = useMemo(() => [...tracks].sort((a, b) => a.sort_order - b.sort_order), [tracks]);
  const libraryOrderIndex = useMemo(() => new Map(libraryOrderedTracks.map((track, index) => [track.id, index] as const)), [libraryOrderedTracks]);
  const regularPlaylists = useMemo(() => playlists.filter((playlist) => !isSmartMixPlaylist(playlist)), [playlists]);
  const smartMixPlaylists = useMemo(() => playlists.filter(isSmartMixPlaylist), [playlists]);
  const discoveryRadar = useMemo(() => buildDiscoveryRadar(tracks), [tracks]);

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
    const map = new Map<string, { artist: string; tracks: MusicTrack[] }>();
    tracks.forEach((track) => {
      const artist = artistLabel(track);
      const key = artist.toLocaleLowerCase();
      const group = map.get(key) || { artist, tracks: [] as MusicTrack[] };
      group.tracks.push(track);
      map.set(key, group);
    });
    return [...map.values()]
      .map((group) => [group.artist, group.tracks] as [string, MusicTrack[]])
      .sort(([a], [b]) => a.localeCompare(b));
  }, [tracks]);
  const albumGroups = useMemo(() => {
    const map = new Map<string, { album: string; artist: string; tracks: MusicTrack[] }>();
    tracks.forEach((track) => {
      const album = albumLabel(track);
      const artist = artistLabel(track);
      const key = `${artist.toLocaleLowerCase()}|||${album.toLocaleLowerCase()}`;
      const group = map.get(key) || { album, artist, tracks: [] as MusicTrack[] };
      group.tracks.push(track);
      map.set(key, group);
    });
    return [...map.values()].sort((a, b) => a.album.localeCompare(b.album) || a.artist.localeCompare(b.artist));
  }, [tracks]);

  const activeArtistDetail = useMemo(() => {
    if (collectionDetail?.kind !== "artist") return null;
    const group = artistGroups.find(([artist]) => artist === collectionDetail.artist);
    if (!group) return null;
    const ordered = [...group[1]].sort((a, b) => {
      const yearA = a.release_year ?? 9999;
      const yearB = b.release_year ?? 9999;
      return yearA - yearB || albumLabel(a).localeCompare(albumLabel(b)) || a.sort_order - b.sort_order || a.title.localeCompare(b.title);
    });
    return { artist: group[0], tracks: ordered };
  }, [collectionDetail, artistGroups]);

  const activeAlbumDetail = useMemo(() => {
    if (collectionDetail?.kind !== "album") return null;
    const group = albumGroups.find((item) => item.artist === collectionDetail.artist && item.album === collectionDetail.album);
    if (!group) return null;
    return { ...group, tracks: [...group.tracks].sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title)) };
  }, [collectionDetail, albumGroups]);


  const discoveryArchive = useMemo(() => {
    const query = discoverySearch.trim().toLowerCase();
    const filtered = discoverySeeds.filter((seed) => {
      const visible = filterDiscoveryRecommendations(seed.recommendations.filter((item) => !item.dismissed), discoveryFilter);
      if (!visible.length) return false;
      if (!query) return true;
      const haystack = [
        seed.trackTitle,
        seed.trackArtist,
        ...visible.flatMap((item) => [item.title, item.artist, item.album, item.reason]),
      ].join(" ").toLowerCase();
      return haystack.includes(query);
    });
    return [...filtered].sort((a, b) => {
      if (discoverySort === "oldest") return a.createdAt - b.createdAt;
      if (discoverySort === "artist") return a.trackArtist.localeCompare(b.trackArtist) || a.trackTitle.localeCompare(b.trackTitle);
      if (discoverySort === "most") {
        const aCount = a.recommendations.filter((item) => !item.dismissed).length;
        const bCount = b.recommendations.filter((item) => !item.dismissed).length;
        return bCount - aCount || b.refreshedAt - a.refreshedAt;
      }
      return b.refreshedAt - a.refreshedAt;
    });
  }, [discoverySeeds, discoverySearch, discoverySort, discoveryFilter]);

  const discoveryCount = useMemo(
    () => discoverySeeds.reduce((sum, seed) => sum + seed.recommendations.filter((item) => !item.dismissed).length, 0),
    [discoverySeeds],
  );

  const savedDiscoverySongIds = useMemo(() => new Set(savedDiscoverySongs.map((song) => song.id)), [savedDiscoverySongs]);
  const savedSongsFiltered = useMemo(() => {
    const query = discoverySearch.trim().toLowerCase();
    const filtered = savedDiscoverySongs.filter((song) => !query || [
      song.title,
      song.artist,
      song.album,
      song.seedTrackTitle,
      song.seedTrackArtist,
    ].join(" ").toLowerCase().includes(query));
    return [...filtered].sort((a, b) => {
      if (discoverySort === "oldest") return a.savedAt - b.savedAt;
      if (discoverySort === "artist") return a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title);
      return b.savedAt - a.savedAt;
    });
  }, [savedDiscoverySongs, discoverySearch, discoverySort]);
  const savedSongsPageCount = Math.max(1, Math.ceil(savedSongsFiltered.length / 5));
  const safeSavedSongsPage = Math.min(savedSongsPage, savedSongsPageCount);
  const pagedSavedSongs = savedSongsFiltered.slice((safeSavedSongsPage - 1) * 5, safeSavedSongsPage * 5);

  const filteredTracks = useMemo(() => {
    const query = songSearch.trim().toLowerCase();
    const next = tracks.filter((track) => {
      const matchesSearch = !query || `${track.title} ${track.artist || ""} ${track.album || ""} ${track.genre || ""} ${track.original_name}`.toLowerCase().includes(query);
      if (!matchesSearch) return false;
      if (energyFilter !== "all" && track.energy_level !== energyFilter) return false;
      if (healthFilter === "needs_info" && !needsMusicMetadata(track)) return false;
      if (healthFilter === "missing_art" && !trackNeedsArtwork(track)) return false;
      if (healthFilter === "liked" && !track.favorite) return false;
      if (healthFilter === "review" && track.metadata_status !== "review" && !reviewItems.some((item) => item.trackId === track.id)) return false;
      return true;
    });
    return [...next].sort((a, b) => {
      if (songSort === "recently_added") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime() || compareSongTitle(a, b);
      if (songSort === "title_asc") return compareSongTitle(a, b);
      if (songSort === "title_desc") return compareSongTitleDescending(a, b);
      if (songSort === "artist_asc") return compareLibraryText(artistLabel(a), artistLabel(b)) || compareSongTitle(a, b);
      if (songSort === "artist_desc") return compareLibraryText(artistLabel(b), artistLabel(a)) || compareSongTitle(a, b);
      if (songSort === "album_asc") return compareLibraryText(albumLabel(a), albumLabel(b)) || compareLibraryText(artistLabel(a), artistLabel(b)) || compareSongTitle(a, b);
      if (songSort === "most_played") return Number(b.play_count || 0) - Number(a.play_count || 0) || Number(b.completed_play_count || 0) - Number(a.completed_play_count || 0) || compareSongTitle(a, b);
      if (songSort === "recently_played") return new Date(b.last_played_at || 0).getTime() - new Date(a.last_played_at || 0).getTime() || compareSongTitle(a, b);
      if (songSort === "high_rotation") return highRotationScore(b) - highRotationScore(a) || compareSongTitle(a, b);
      if (songSort === "least_played") return Number(a.play_count || 0) - Number(b.play_count || 0) || Number(a.completed_play_count || 0) - Number(b.completed_play_count || 0) || compareSongTitle(a, b);
      if (songSort === "most_skipped") return Number(b.skip_count || 0) - Number(a.skip_count || 0) || compareSongTitle(a, b);
      if (songSort === "longest") return Number(b.duration_seconds || 0) - Number(a.duration_seconds || 0) || compareSongTitle(a, b);
      if (songSort === "shortest") return Number(a.duration_seconds || 0) - Number(b.duration_seconds || 0) || compareSongTitle(a, b);
      if (songSort === "energy_high") return energyRank(b.energy_level) - energyRank(a.energy_level) || compareSongTitle(a, b);
      if (songSort === "energy_low") return energyRank(a.energy_level) - energyRank(b.energy_level) || compareSongTitle(a, b);
      return a.sort_order - b.sort_order || compareSongTitle(a, b);
    });
  }, [tracks, songSearch, songSort, energyFilter, healthFilter, reviewItems, resolvedArtworkIds]);

  const pageCount = Math.max(1, Math.ceil(filteredTracks.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pagedTracks = filteredTracks.slice((safePage - 1) * pageSize, safePage * pageSize);
  const selectedCount = selectedSongIds.size;
  const allVisibleSelected = Boolean(pagedTracks.length && pagedTracks.every((track) => selectedSongIds.has(track.id)));

  useEffect(() => { setPage(1); }, [songSearch, songSort, energyFilter, healthFilter, pageSize]);
  useEffect(() => { setSavedSongsPage(1); }, [discoverySearch, discoverySort, discoveryView]);

  async function hydrateArtworkPresence(rows: MusicTrack[]) {
    const candidates = rows.filter(needsMusicArtwork);
    const found = new Set<string>();
    for (let start = 0; start < candidates.length; start += 8) {
      const chunk = candidates.slice(start, start + 8);
      const results = await Promise.allSettled(chunk.map(async (track) => ({
        id: track.id,
        url: await getMusicArtworkSignedUrl(track),
      })));
      results.forEach((result) => {
        if (result.status === "fulfilled" && result.value.url) found.add(result.value.id);
      });
    }
    setResolvedArtworkIds(found);
  }

  function isTransientLibraryError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error || "");
    return /lock broken|steal|navigator\.locks|aborterror|failed to fetch|networkerror/i.test(message);
  }
  async function refreshTracks() {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const rows = await listMusicTracks();
        setTracks(rows); setDrafts(buildDraftMap(rows)); replaceMusicLibrary(rows);
        void hydrateArtworkPresence(rows);
        return rows;
      } catch (error) {
        lastError = error;
        if (!isTransientLibraryError(error) || attempt === 3) break;
        await new Promise((resolve) => window.setTimeout(resolve, 120 * (attempt + 1)));
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Could not refresh your music library.");
  }
  async function refreshPlaylists(preferredId?: string | null) {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const rows = await listMusicPlaylists();
        const entries = await Promise.all(rows.map(async (playlist) => [playlist.id, (await listMusicPlaylistTrackLinks(playlist.id)).map((link) => link.track_id)] as const));
        setPlaylists(rows); setPlaylistTrackIds(Object.fromEntries(entries));
        const regularRows = rows.filter((playlist) => !isSmartMixPlaylist(playlist));
        setSelectedPlaylistId((current) => preferredId && regularRows.some((p) => p.id === preferredId) ? preferredId : current && regularRows.some((p) => p.id === current) ? current : regularRows[0]?.id || null);
        return;
      } catch (error) {
        lastError = error;
        if (!isTransientLibraryError(error) || attempt === 3) break;
        await new Promise((resolve) => window.setTimeout(resolve, 120 * (attempt + 1)));
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Could not refresh playlists.");
  }
  useEffect(() => {
    void Promise.all([refreshTracks(), refreshPlaylists(), loadMusicLibrary()]).catch((caught) => {
      if (!isTransientLibraryError(caught)) setError(caught instanceof Error ? caught.message : "Could not load your music library.");
    }).finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    const refreshDiscovery = () => {
      setDiscoverySeeds(listMusicDiscoverySeeds());
      setSavedDiscoverySongs(listMusicDiscoverySavedSongs());
    };
    const unsubscribe = subscribeMusicDiscovery(refreshDiscovery);
    refreshDiscovery();
    return unsubscribe;
  }, []);
  useEffect(() => {
    refreshDiscoveryLibraryFlags(tracks);
  }, [tracks]);
  useEffect(() => {
    const openPendingRediscover = (event?: Event) => {
      const eventSeedId = event instanceof CustomEvent ? String(event.detail?.seedId || "").trim() : "";
      const storedSeedId = consumeMusicRediscoverFocus();
      const pendingSeedId = eventSeedId || storedSeedId;
      if (!pendingSeedId) return;
      // The discovery change event may land a few milliseconds before state refresh.
      setDiscoverySeeds(listMusicDiscoverySeeds());
      openRediscoverSeed(pendingSeedId);
    };
    openPendingRediscover();
    window.addEventListener(MUSIC_REDISCOVER_FOCUS_EVENT, openPendingRediscover as EventListener);
    return () => window.removeEventListener(MUSIC_REDISCOVER_FOCUS_EVENT, openPendingRediscover as EventListener);
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
      for (const file of Array.from(files)) {
        setMessage(`Uploading ${file.name}…`);
        await uploadMusicTrack(file, order++);
      }
      await refreshTracks();
      await loadMusicLibrary(true);
      setMessage(`${files.length} song${files.length === 1 ? "" : "s"} uploaded.`);
    } catch (caught) {
      const raw = caught instanceof Error ? caught.message : "Music upload failed.";
      setError(/unsupported|audio type|file type/i.test(raw) ? "THIS AUDIO FORMAT IS NOT SUPPORTED FOR UPLOAD" : raw);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function uploadAuditionSong(file: File, auditionSong: MusicAuditionSong) {
    setUploading(true); setMessage(""); setError("");
    try {
      setMessage(`Adding ${auditionSong.artist} - ${auditionSong.title}…`);
      let uploaded = await uploadMusicTrack(file, tracks.length);
      uploaded = await updateMusicTrack(uploaded.id, {
        title: auditionSong.title,
        artist: auditionSong.artist,
        album: auditionSong.album || uploaded.album || undefined,
        release_year: auditionSong.releaseYear ?? uploaded.release_year ?? undefined,
        genre: auditionSong.genre || uploaded.genre || undefined,
        external_artwork_url: auditionSong.artworkUrl || uploaded.external_artwork_url || undefined,
        metadata_status: "manual",
        metadata_confidence: 1,
        metadata_source: "audition",
        metadata_updated_at: new Date().toISOString(),
      });
      markMusicAuditionSongInLibrary(auditionSong.id, uploaded.id);
      await refreshTracks();
      await loadMusicLibrary(true);
      setMessage(`${auditionSong.title} added to your music library.`);
      return uploaded;
    } catch (caught) {
      const raw = caught instanceof Error ? caught.message : "Music upload failed.";
      setError(/unsupported|audio type|file type/i.test(raw) ? "THIS AUDIO FORMAT IS NOT SUPPORTED FOR UPLOAD" : raw);
      throw caught;
    } finally {
      setUploading(false);
    }
  }

  async function playCollectionTrack(queueName: string, queueTracks: MusicTrack[], track: MusicTrack) {
    const current = player.currentTrack?.id === track.id;
    const queueActive = !player.activePlaylistId && player.activePlaylistName === queueName;
    if (current && queueActive && player.playing) { pauseMusic(); return; }
    if (current && queueActive) { await playMusic(); return; }
    await playMusicAdHocQueue(queueName, queueTracks, track.id);
  }

  async function playCollectionShuffle(queueName: string, queueTracks: MusicTrack[]) {
    if (!queueTracks.length) return;
    const shuffled = shuffleMusicTracks(queueTracks);
    await playMusicAdHocQueue(queueName, shuffled, shuffled[0]?.id);
  }

  async function playTrackOnce(track: MusicTrack) {
    const current = player.currentTrack?.id === track.id;

    // Recently Added is displayed newest -> oldest. Its playback queue must
    // use that same visible order so the newest song continues into the next
    // newest instead of landing at the end of the underlying library queue.
    if (songSort === "recently_added") {
      const recentQueueActive = !player.activePlaylistId && player.activePlaylistName === "Recently Added";
      if (current && recentQueueActive && player.playing) { pauseMusic(); return; }
      if (current && recentQueueActive) { await playMusic(); return; }
      await playMusicAdHocQueue("Recently Added", filteredTracks, track.id);
      return;
    }

    if (current && player.playing) { pauseMusic(); return; }
    if (current) { await playMusic(); return; }
    activateAllMusicTracks();
    await playMusicTrack(track.id, 0);
  }

  async function toggleTrackPlayback(track: MusicTrack) {
    setPlaybackErrors((current) => { const next = { ...current }; delete next[track.id]; return next; });
    try {
      await playTrackOnce(track);
    } catch {
      // Refresh the library/storage source and retry once. This repairs newly
      // uploaded tracks whose first signed/source URL was stale or incomplete.
      try {
        clearMusicUrlCache(track.id);
        const refreshed = await refreshTracks();
        await loadMusicLibrary(true);

        if (songSort === "recently_added") {
          const visibleIds = new Set(filteredTracks.map((item) => item.id));
          const refreshedQueue = refreshed
            .filter((item) => visibleIds.has(item.id))
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
          await playMusicAdHocQueue("Recently Added", refreshedQueue, track.id);
        } else {
          activateAllMusicTracks();
          await playMusicTrack(track.id, 0);
        }
      } catch {
        setPlaybackErrors((current) => ({ ...current, [track.id]: "COULDN’T PLAY THIS TRACK • RETRY" }));
      }
    }
  }
  async function changePreference(track: MusicTrack, preference: "like" | "play_less" | "neutral") {
    // Optimistic state makes LIKE / PLAY LESS feel immediate and keeps the
    // selected state visually latched while the storage update completes.
    const optimistic: MusicTrack = {
      ...track,
      favorite: preference === "like" ? true : preference === "neutral" ? false : track.favorite,
      play_less: preference === "play_less" ? true : preference === "neutral" ? false : track.play_less,
    };
    replaceTrackLocally(optimistic);
    try {
      const updated = await setPlayerMusicPreference(track.id, preference);
      replaceTrackLocally(updated);
    } catch (caught) {
      replaceTrackLocally(track);
      setError(caught instanceof Error ? caught.message : "Could not update preference.");
    }
  }
  async function setEnergy(track: MusicTrack, energy: MusicEnergyLevel) {
    try { replaceTrackLocally(await updateMusicTrack(track.id, { energy_level: energy })); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not update energy."); }
  }
  function queueLibraryOrderSave(nextTracks: MusicTrack[]) {
    pendingOrderRef.current = nextTracks;
    if (orderSaveTimerRef.current != null) window.clearTimeout(orderSaveTimerRef.current);
    orderSaveTimerRef.current = window.setTimeout(() => {
      const snapshot = pendingOrderRef.current;
      orderSaveTimerRef.current = null;
      orderSaveChainRef.current = orderSaveChainRef.current
        .catch(() => undefined)
        .then(async () => {
          try {
            for (let index = 0; index < snapshot.length; index += 1) {
              await updateMusicTrack(snapshot[index].id, { sort_order: index });
            }
          } catch {
            setError("COULD NOT SAVE ORDER • RETRY");
          }
        });
    }, 420);
  }

  function moveTrack(trackId: string, direction: -1 | 1) {
    setSongSort("library");
    setTracks((current) => {
      const ordered = [...current].sort((a, b) => a.sort_order - b.sort_order);
      const index = ordered.findIndex((track) => track.id === trackId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= ordered.length) return current;
      [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
      const next = ordered.map((track, position) => ({ ...track, sort_order: position }));
      replaceMusicLibrary(next);
      queueLibraryOrderSave(next);
      return next;
    });
  }

  useEffect(() => () => {
    if (orderSaveTimerRef.current != null) window.clearTimeout(orderSaveTimerRef.current);
  }, []);

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
      // Song Info is a complete identification workflow: metadata and the matched album artwork travel together.
      // A confident provider match is authoritative for this edit, so its artwork may replace stale/incorrect art.
      if (detailPendingCandidate?.artworkUrl) updated = await uploadRemoteMusicArtwork(updated, detailPendingCandidate.artworkUrl);
      replaceTrackLocally(updated); setDetailPendingCandidate(null); setDetailSaveState("changed"); setDetailStatusText("SAVED ✓ • SONG INFO + ARTWORK UPDATED");
      setMessage(`${updated.title} saved.`);
      window.setTimeout(() => { closeDetail(); }, 620);
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
      const best = candidates[0];
      if (mode === "info_results" && best && best.confidence >= 0.86) {
        // A high-confidence identification stages both metadata and its album art
        // in one step. The user still gets a final Save Changes confirmation.
        setDrafts((current) => ({ ...current, [track.id]: { title: best.title, artist: best.artist, album: best.album, releaseYear: best.releaseYear ? String(best.releaseYear) : "", genre: best.genre || "" } }));
        setDetailPendingCandidate(best);
        setDetailMode("edit");
        setDetailSaveState("idle");
        setDetailStatusText(`Best match loaded • ${Math.round(best.confidence * 100)}%${best.artworkUrl ? " • ALBUM ART READY" : ""} • Review and SAVE CHANGES.`);
        return;
      }
      setDetailStatusText(candidates.length ? `${candidates.length} possible match${candidates.length === 1 ? "" : "es"} found • Best ${Math.round(candidates[0].confidence * 100)}%` : "No reliable matches found. Check the title/artist and search again.");
    } catch (caught) { setDetailSaveState("error"); setDetailStatusText(caught instanceof Error ? caught.message : "Music lookup failed."); }
  }
  function applyDetailInfoCandidate(candidate: MusicMetadataCandidate) {
    if (!detailTrack) return;
    setDrafts((current) => ({ ...current, [detailTrack.id]: { title: candidate.title, artist: candidate.artist, album: candidate.album, releaseYear: candidate.releaseYear ? String(candidate.releaseYear) : "", genre: candidate.genre || "" } }));
    setDetailPendingCandidate(candidate); setDetailMode("edit"); setDetailSaveState("idle"); setDetailStatusText(`Match loaded • ${musicMatchTier(candidate.confidence)}${candidate.artworkUrl ? " • ALBUM ART INCLUDED" : ""} • Review, then SAVE.`);
  }
  async function applyDetailArtworkCandidate(candidate: MusicMetadataCandidate) {
    if (!detailTrack || !candidate.artworkUrl) { setDetailStatusText("That result has no usable artwork."); return; }
    // Stage artwork exactly like metadata. This fixes artwork-only edits where
    // the preview changed but SAVE CHANGES previously had nothing to commit.
    setDetailPendingCandidate(candidate);
    setDetailSelectedCandidateId(candidate.sourceId);
    setDetailMode("edit");
    setDetailSaveState("idle");
    setDetailStatusText("ARTWORK SELECTED • Review the cover, then SAVE CHANGES.");
  }

  async function enrichTracks(targets: MusicTrack[], artworkOnly = false) {
    const work = artworkOnly ? targets.filter(trackNeedsArtwork) : targets;
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
    regularPlaylists.forEach((playlist) => { const existing = new Set(playlistTrackIds[playlist.id] || []); if (ids.every((id) => existing.has(id))) selected.add(playlist.id); });
    setPlaylistModalTrackIds(ids); setPlaylistModalSelections(selected); setPlaylistModalName("");
  }
  async function savePlaylistMemberships() {
    if (!playlistModalTrackIds.length) return;
    setBusyId("playlist-route");
    try {
      let preferred: string | null = null;
      if (playlistModalName.trim()) { const created = await createMusicPlaylist(playlistModalName.trim()); preferred = created.id; await replaceMusicPlaylistTracks(created.id, playlistModalTrackIds); }
      for (const playlist of regularPlaylists) {
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

  const selectedPlaylist = regularPlaylists.find((playlist) => playlist.id === selectedPlaylistId) || null;
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

  const selectedPlaylistDurationSeconds = selectedPlaylistTracks.reduce((sum, track) => sum + trackDuration(track), 0);
  const selectedPlaylistHighEnergy = selectedPlaylistTracks.filter((track) => track.energy_level === "high").length;
  const selectedPlaylistLiked = selectedPlaylistTracks.filter((track) => track.favorite).length;
  const selectedPlaylistBurnSeconds = selectedPlaylistTracks.reduce((sum, track) => sum + burnTrackSeconds(track), 0);
  const selectedPlaylistBurnBytes = selectedPlaylistTracks.reduce((sum, track) => sum + burnTrackBytes(track), 0);
  const burnDiscs = splitBurnDiscs(selectedPlaylistTracks, burnMode);

  function openBurnStudio() {
    if (!selectedPlaylist || !selectedPlaylistTracks.length) return;
    setBurnMode("mp3");
    setBurnStatus("");
    setBurnComplete(false);
    setBurnProgress(null);
    setBurnOpen(true);
  }

  function closeBurnStudio() {
    if (burnBusy) return;
    setBurnOpen(false);
    setBurnStatus("");
    setBurnComplete(false);
    setBurnProgress(null);
  }

  function changeBurnMode(mode: BurnMode) {
    if (burnBusy || burnComplete) return;
    setBurnMode(mode);
    setBurnStatus("");
    setBurnProgress(null);
  }

  function burnSafeName(value: string) {
    return (value || "Music")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 110) || "Music";
  }

  function burnExtension(track: MusicTrack) {
    const name = String(track.original_name || "");
    const match = name.match(/\.([a-zA-Z0-9]{2,5})$/);
    if (match?.[1]) return match[1].toLowerCase();
    const mime = String(track.mime_type || "").toLowerCase();
    if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
    if (mime.includes("wav") || mime.includes("wave")) return "wav";
    return "mp3";
  }

  async function writeBurnText(directory: any, fileName: string, text: string) {
    const handle = await directory.getFileHandle(fileName, { create: true });
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
  }

  function concatBurnBytes(parts: Uint8Array[]) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }

  function id3SyncSafe(value: number) {
    const size = Math.max(0, Math.floor(value));
    return new Uint8Array([
      (size >> 21) & 0x7f,
      (size >> 14) & 0x7f,
      (size >> 7) & 0x7f,
      size & 0x7f,
    ]);
  }

  function id3ReadSyncSafe(bytes: Uint8Array, offset: number) {
    return (
      ((bytes[offset] & 0x7f) << 21) |
      ((bytes[offset + 1] & 0x7f) << 14) |
      ((bytes[offset + 2] & 0x7f) << 7) |
      (bytes[offset + 3] & 0x7f)
    );
  }

  function id3ReadBe32(bytes: Uint8Array, offset: number) {
    return (
      bytes[offset] * 0x1000000 +
      bytes[offset + 1] * 0x10000 +
      bytes[offset + 2] * 0x100 +
      bytes[offset + 3]
    );
  }

  function id3TextPayload(value: string, version: number) {
    const text = String(value || "").trim();
    if (version >= 4) {
      return concatBurnBytes([new Uint8Array([3]), new TextEncoder().encode(text)]);
    }

    const utf16 = new Uint8Array(3 + text.length * 2);
    utf16[0] = 1;
    utf16[1] = 0xff;
    utf16[2] = 0xfe;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      utf16[3 + index * 2] = code & 0xff;
      utf16[4 + index * 2] = (code >> 8) & 0xff;
    }
    return utf16;
  }

  function id3TextFrame(id: string, value: string, version: number) {
    const payload = id3TextPayload(value, version);
    const header = new Uint8Array(10);
    for (let index = 0; index < 4; index += 1) header[index] = id.charCodeAt(index) || 0;
    const sizeBytes = version >= 4
      ? id3SyncSafe(payload.length)
      : new Uint8Array([
          (payload.length >>> 24) & 0xff,
          (payload.length >>> 16) & 0xff,
          (payload.length >>> 8) & 0xff,
          payload.length & 0xff,
        ]);
    header.set(sizeBytes, 4);
    return concatBurnBytes([header, payload]);
  }

  function id3AsciiField(value: string, length: number) {
    const out = new Uint8Array(length);
    const normalized = String(value || "").normalize("NFKD");
    for (let index = 0; index < Math.min(length, normalized.length); index += 1) {
      const code = normalized.charCodeAt(index);
      out[index] = code >= 32 && code <= 255 ? code : 63;
    }
    return out;
  }

  function buildBurnId3v1(track: MusicTrack, order: number) {
    const out = new Uint8Array(128);
    out.set(new TextEncoder().encode("TAG"), 0);
    out.set(id3AsciiField(track.title || "", 30), 3);
    out.set(id3AsciiField(artistLabel(track), 30), 33);
    out.set(id3AsciiField(track.album || "", 30), 63);
    out.set(id3AsciiField(track.release_year ? String(track.release_year).slice(0, 4) : "", 4), 93);
    out.set(id3AsciiField("MVP Trainer Pro", 28), 97);
    out[125] = 0;
    out[126] = Math.max(1, Math.min(255, Math.floor(order)));
    out[127] = 255;
    return out;
  }

  function parseBurnId3(bytes: Uint8Array) {
    const hasTag =
      bytes.length >= 10 &&
      bytes[0] === 0x49 &&
      bytes[1] === 0x44 &&
      bytes[2] === 0x33;

    if (!hasTag) {
      return { version: 3, audioStart: 0, preservedFrames: [] as Uint8Array[] };
    }

    const version = bytes[3] === 4 ? 4 : bytes[3] === 3 ? 3 : 3;
    const sourceVersion = bytes[3];
    const flags = bytes[5] || 0;
    const tagSize = id3ReadSyncSafe(bytes, 6);
    const footerBytes = sourceVersion === 4 && (flags & 0x10) ? 10 : 0;
    const audioStart = Math.min(bytes.length, 10 + tagSize + footerBytes);

    if ((sourceVersion !== 3 && sourceVersion !== 4) || (flags & 0x80)) {
      return { version, audioStart, preservedFrames: [] as Uint8Array[] };
    }

    const tagEnd = Math.min(bytes.length, 10 + tagSize);
    let cursor = 10;

    if (flags & 0x40) {
      if (sourceVersion === 3 && cursor + 4 <= tagEnd) {
        const extendedSize = id3ReadBe32(bytes, cursor);
        cursor = Math.min(tagEnd, cursor + 4 + Math.max(0, extendedSize));
      } else if (sourceVersion === 4 && cursor + 4 <= tagEnd) {
        const extendedSize = id3ReadSyncSafe(bytes, cursor);
        cursor = Math.min(tagEnd, cursor + Math.max(4, extendedSize));
      }
    }

    const preservedFrames: Uint8Array[] = [];
    const replacedIds = new Set(["TRCK", "TIT2", "TPE1", "TALB", "TYER", "TDRC", "TCON", "TPOS"]);

    while (cursor + 10 <= tagEnd) {
      const id = String.fromCharCode(bytes[cursor], bytes[cursor + 1], bytes[cursor + 2], bytes[cursor + 3]);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;

      const frameSize = sourceVersion === 4
        ? id3ReadSyncSafe(bytes, cursor + 4)
        : id3ReadBe32(bytes, cursor + 4);
      if (!(frameSize >= 0) || cursor + 10 + frameSize > tagEnd) break;

      if (!replacedIds.has(id)) {
        preservedFrames.push(bytes.slice(cursor, cursor + 10 + frameSize));
      }
      cursor += 10 + frameSize;
    }

    return { version, audioStart, preservedFrames };
  }

  async function normalizeMp3BurnCopy(
    blob: Blob,
    track: MusicTrack,
    order: number,
    totalTracks: number,
    discNumber: number,
    discCount: number
  ) {
    const source = new Uint8Array(await blob.arrayBuffer());
    const parsed = parseBurnId3(source);
    const version = parsed.version;
    const metadataFrames: Uint8Array[] = [
      id3TextFrame("TIT2", track.title || "Unknown Title", version),
      id3TextFrame("TPE1", artistLabel(track), version),
      id3TextFrame("TRCK", `${order}/${totalTracks}`, version),
      id3TextFrame("TPOS", `${discNumber}/${discCount}`, version),
    ];

    if (track.album) metadataFrames.push(id3TextFrame("TALB", track.album, version));
    if (track.genre) metadataFrames.push(id3TextFrame("TCON", track.genre, version));
    if (track.release_year) {
      metadataFrames.push(
        id3TextFrame(version >= 4 ? "TDRC" : "TYER", String(track.release_year).slice(0, 4), version)
      );
    }

    const tagBody = concatBurnBytes([...parsed.preservedFrames, ...metadataFrames]);
    const header = new Uint8Array(10);
    header.set(new TextEncoder().encode("ID3"), 0);
    header[3] = version;
    header[4] = 0;
    header[5] = 0;
    header.set(id3SyncSafe(tagBody.length), 6);

    let audioEnd = source.length;
    if (
      source.length >= 128 &&
      source[source.length - 128] === 0x54 &&
      source[source.length - 127] === 0x41 &&
      source[source.length - 126] === 0x47
    ) {
      audioEnd -= 128;
    }

    const audioBytes = source.slice(parsed.audioStart, audioEnd);
    const id3v1 = buildBurnId3v1(track, order);
    return new Blob([header, tagBody, audioBytes, id3v1], { type: "audio/mpeg" });
  }

  async function writeBurnTrack(
    directory: any,
    track: MusicTrack,
    fileName: string,
    options?: {
      normalizeMp3Order?: boolean;
      order?: number;
      totalTracks?: number;
      discNumber?: number;
      discCount?: number;
    }
  ) {
    const url = await getMusicTrackSignedUrl(track);
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not download ${track.title}.`);
    let blob = await response.blob();

    if (options?.normalizeMp3Order) {
      blob = await normalizeMp3BurnCopy(
        blob,
        track,
        options.order ?? 1,
        options.totalTracks ?? 1,
        options.discNumber ?? 1,
        options.discCount ?? 1
      );
    }

    const handle = await directory.getFileHandle(fileName, { create: true });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
  }

  async function removeBurnEntryIfPresent(directory: any, name: string, recursive = false) {
    try {
      await directory.removeEntry(name, { recursive });
    } catch {
      // The generated entry may not exist yet.
    }
  }

  async function cleanGeneratedBurnOutput(root: any) {
    await removeBurnEntryIfPresent(root, "README.txt");
    await removeBurnEntryIfPresent(root, "BURN_INSTRUCTIONS.txt");
    await removeBurnEntryIfPresent(root, "PLAYLIST.m3u8");

    try {
      for await (const [name, handle] of root.entries()) {
        if (/^Disc \d+$/i.test(name) && handle?.kind === "directory") {
          await removeBurnEntryIfPresent(root, name, true);
        }
        if (/^PLAYLIST - Disc \d+\.m3u8$/i.test(name) && handle?.kind === "file") {
          await removeBurnEntryIfPresent(root, name);
        }
      }
    } catch {
      // Browsers that cannot enumerate still overwrite the files generated below.
    }
  }

  function burnInstructions(mode: BurnMode, playlistName: string, discCount: number) {
    const heading = `MVP TRAINER PRO • ${playlistName}`;
    if (mode === "mp3") {
      return `${heading}\n\nMP3 / DATA DISC\n\nMVP Trainer prepared ${discCount} disc folder${discCount === 1 ? "" : "s"}. Each Disc folder contains MUSIC FILES ONLY for the cleanest car-stereo and MP3-player compatibility.\n\nFor each disc:\n1. Insert a blank CD-R.\n2. Open the matching Disc folder in File Explorer.\n3. Select ONLY the numbered MP3/music files inside that folder.\n4. Copy/send them to your CD/DVD drive.\n5. Use Windows “Finish burning” / “Burn to disc”.\n6. Choose the option intended for a CD/DVD player when Windows asks.\n\nIMPORTANT\n• Filenames are numbered in your MVP Trainer playlist order.\n• Exported MP3 COPIES also receive normalized embedded Track Number metadata so compatible stereos see the same order.\n• Your original MVP Trainer library files are never modified.\n• PLAYLIST file(s) are kept here in the parent folder for reference and should not be copied to the MP3 disc unless you specifically want them.\n`;
    }
    return `${heading}\n\nSTANDARD AUDIO CD\n\nMVP Trainer prepared ${discCount} disc folder${discCount === 1 ? "" : "s"} in playlist order.\n\nFor each disc:\n1. Insert a blank CD-R.\n2. Open Windows Media Player Legacy or your preferred audio-CD burning software.\n3. Open the matching PLAYLIST file in this parent folder, or add the numbered files from that Disc folder in order.\n4. Choose Audio CD / Burn.\n5. Verify the order, then start the burn.\n\nThe Disc folders contain music files only. Your original MVP Trainer library files are never modified.\n`;
  }

  async function prepareCdFiles() {
    if (!selectedPlaylist || !selectedPlaylistTracks.length) return;
    const picker = (window as any).showDirectoryPicker as undefined | ((options?: any) => Promise<any>);
    if (!picker) {
      setBurnStatus("DESKTOP CHROME OR EDGE IS REQUIRED TO PREPARE DISC FILES.");
      return;
    }

    setBurnBusy(true);
    setBurnComplete(false);
    setBurnProgress(null);
    setBurnStatus("SELECT A DESTINATION FOLDER TO BEGIN.");

    try {
      const destination = await picker({ mode: "readwrite" });
      const rootName = burnSafeName(`${selectedPlaylist.name} - ${burnMode === "mp3" ? "MP3 CD" : "Audio CD"}`);
      const root = await destination.getDirectoryHandle(rootName, { create: true });
      await cleanGeneratedBurnOutput(root);

      const overallIndex = new Map(selectedPlaylistTracks.map((track, index) => [track.id, index + 1] as const));
      const playlistFiles: Array<{ name: string; lines: string[] }> = [];
      let preparedTrackCount = 0;

      for (let discIndex = 0; discIndex < burnDiscs.length; discIndex += 1) {
        const disc = burnDiscs[discIndex];
        const discDir = await root.getDirectoryHandle(`Disc ${disc.number}`, { create: true });
        const playlistLines = ["#EXTM3U"];

        for (let trackIndex = 0; trackIndex < disc.tracks.length; trackIndex += 1) {
          const track = disc.tracks[trackIndex];
          const order = overallIndex.get(track.id) ?? trackIndex + 1;
          const ext = burnExtension(track);
          const fileName = `${String(order).padStart(2, "0")} - ${burnSafeName(artistLabel(track))} - ${burnSafeName(track.title)}.${ext}`;
          const percent = Math.max(1, Math.min(99, Math.round((preparedTrackCount / selectedPlaylistTracks.length) * 100)));
          setBurnProgress({
            disc: disc.number,
            discs: burnDiscs.length,
            track: preparedTrackCount + 1,
            tracks: selectedPlaylistTracks.length,
            title: track.title,
            artist: artistLabel(track),
            percent,
          });
          setBurnStatus("");
          await writeBurnTrack(discDir, track, fileName, {
            normalizeMp3Order: burnMode === "mp3" && ext === "mp3",
            order,
            totalTracks: selectedPlaylistTracks.length,
            discNumber: disc.number,
            discCount: burnDiscs.length,
          });
          preparedTrackCount += 1;
          setBurnProgress({
            disc: disc.number,
            discs: burnDiscs.length,
            track: preparedTrackCount,
            tracks: selectedPlaylistTracks.length,
            title: track.title,
            artist: artistLabel(track),
            percent: Math.round((preparedTrackCount / selectedPlaylistTracks.length) * 100),
          });
          playlistLines.push(`#EXTINF:${Math.round(burnTrackSeconds(track))},${artistLabel(track)} - ${track.title}`);
          playlistLines.push(`Disc ${disc.number}/${fileName}`);
        }

        playlistFiles.push({
          name: burnDiscs.length === 1 ? "PLAYLIST.m3u8" : `PLAYLIST - Disc ${disc.number}.m3u8`,
          lines: playlistLines,
        });
      }

      for (const playlistFile of playlistFiles) {
        await writeBurnText(root, playlistFile.name, `${playlistFile.lines.join("\n")}\n`);
      }

      await writeBurnText(
        root,
        "BURN_INSTRUCTIONS.txt",
        burnInstructions(burnMode, selectedPlaylist.name, burnDiscs.length)
      );

      setBurnProgress(null);
      setBurnStatus("");
      setBurnComplete(true);
    } catch (caught: any) {
      setBurnProgress(null);
      setBurnComplete(false);
      if (caught?.name === "AbortError") setBurnStatus("DISC PREPARATION CANCELED.");
      else setBurnStatus(caught instanceof Error ? caught.message : "Could not prepare the disc files.");
    } finally {
      setBurnBusy(false);
    }
  }
  async function buildAndPlaySmartMix(mode: SmartIntensity = smartIntensity) {
    const mix = buildSmartMix(tracks, smartMinutes, mode);
    if (!mix.length) { setError("Upload songs before building a Smart Mix."); return; }
    const name = SMART_MIX_NAMES[mode];
    try {
      let playlist = playlists.find((item) => item.name === name) || null;
      if (!playlist) playlist = await createMusicPlaylist(name);
      await replaceMusicPlaylistTracks(playlist.id, mix.map((track) => track.id));
      await refreshPlaylists(playlist.id);
      window.dispatchEvent(new Event(PLAYLISTS_CHANGED_EVENT));
      await playMusicPlaylist(playlist, mix);
      setMessage(`${name} rebuilt and playing • ${mix.length} songs.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not build Smart Mix.");
    }
  }
  async function playSavedSmartMix(playlist: MusicPlaylist) {
    const ids = playlistTrackIds[playlist.id] || [];
    const mixTracks = ids.map((id) => tracks.find((track) => track.id === id)).filter((track): track is MusicTrack => Boolean(track));
    if (!mixTracks.length) { setError("Rebuild this Smart Mix before playing it."); return; }
    try { await playMusicPlaylist(playlist, mixTracks); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not play Smart Mix."); }
  }

  function toggleDiscoverySeed(seedId: string) {
    setExpandedDiscoverySeedIds((current) => {
      const next = new Set(current);
      if (next.has(seedId)) next.delete(seedId); else next.add(seedId);
      return next;
    });
  }
  function discoveryLaneKey(seedId: string, category: MusicDiscoveryCategory) {
    return `${seedId}|${category}`;
  }
  function toggleDiscoveryLane(seedId: string, category: MusicDiscoveryCategory) {
    const key = discoveryLaneKey(seedId, category);
    setExpandedDiscoveryLaneIds((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  function openRediscoverSeed(seedId: string) {
    if (!seedId) return;
    setTab("discover");
    setCollectionDetail(null);
    setDiscoveryView("archive");
    setDiscoverySearch("");
    setDiscoverySort("newest");
    setDiscoveryFilter("all");
    setExpandedDiscoverySeedIds((current) => new Set([...current, seedId]));
    setExpandedDiscoveryLaneIds((current) => new Set([
      ...current,
      discoveryLaneKey(seedId, "new_upcoming"),
      discoveryLaneKey(seedId, "same_era"),
      discoveryLaneKey(seedId, "hidden_era"),
    ]));

    window.setTimeout(() => {
      const target = [...document.querySelectorAll<HTMLElement>("[data-rediscover-seed-id]")]
        .find((element) => element.dataset.rediscoverSeedId === seedId);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 140);
  }

  function stopDiscoveryPreview() {
    if (previewStopTimerRef.current != null) {
      window.clearTimeout(previewStopTimerRef.current);
      previewStopTimerRef.current = null;
    }
    const audio = previewAudioRef.current;
    if (audio) {
      try { audio.pause(); audio.currentTime = 0; } catch { /* Ignore browser media cleanup errors. */ }
    }
    previewAudioRef.current = null;
    setPreviewingRecommendationId(null);
  }
  function toggleDiscoveryPreview(item: { id: string; previewUrl: string | null }) {
    if (!item.previewUrl) {
      setPreviewErrorRecommendationId(item.id);
      return;
    }
    if (previewingRecommendationId === item.id) {
      stopDiscoveryPreview();
      return;
    }
    stopDiscoveryPreview();
    pauseMusic();
    setPreviewErrorRecommendationId(null);
    const audio = new Audio(item.previewUrl);
    audio.preload = "none";
    audio.volume = Math.max(0, Math.min(1, Number(player.volume) || 0));
    previewAudioRef.current = audio;
    setPreviewingRecommendationId(item.id);
    audio.onended = () => stopDiscoveryPreview();
    audio.onerror = () => {
      stopDiscoveryPreview();
      setPreviewErrorRecommendationId(item.id);
    };
    void audio.play().then(() => {
      previewStopTimerRef.current = window.setTimeout(() => stopDiscoveryPreview(), 15000);
    }).catch(() => {
      stopDiscoveryPreview();
      setPreviewErrorRecommendationId(item.id);
    });
  }

  useEffect(() => {
    const audio = previewAudioRef.current;
    if (!audio) return;
    audio.volume = Math.max(0, Math.min(1, Number(player.volume) || 0));
  }, [player.volume]);

  useEffect(() => {
    if (!player.playing || !previewAudioRef.current) return;
    stopDiscoveryPreview();
  }, [player.playing]);

  async function saveDiscoveryRecommendation(seed: MusicDiscoverySeed, item: MusicDiscoveryRecommendation) {
    if (savedDiscoverySongIds.has(item.id) || savingRecommendationId === item.id) return;
    setSavingRecommendationId(item.id);
    try {
      await saveMusicDiscoveryRecommendation(seed, item);
      setSavedDiscoverySongs(listMusicDiscoverySavedSongs());
      setDiscoverySeeds(listMusicDiscoverySeeds());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save this song.");
    } finally {
      setSavingRecommendationId(null);
    }
  }

  async function deleteSavedDiscoverySong(item: MusicDiscoverySavedSong) {
    if (removingSavedSongId === item.id) return;
    stopDiscoveryPreview();
    setRemovingSavedSongId(item.id);
    const removed = await removeMusicDiscoverySavedSong(item.id);
    setSavedDiscoverySongs(listMusicDiscoverySavedSongs());
    setDiscoverySeeds(listMusicDiscoverySeeds());
    if (!removed) setError("Saved song was removed on this device, but cloud deletion could not be confirmed. Check your connection and try again.");
    setRemovingSavedSongId(null);
  }

  useEffect(() => {
    if (discoveryDefaultsInitializedRef.current || !discoverySeeds.length) return;
    discoveryDefaultsInitializedRef.current = true;
    const newest = [...discoverySeeds].sort((a, b) => b.refreshedAt - a.refreshedAt)[0];
    if (!newest) return;
    if (!hasUiSet(DISCOVERY_SEED_UI_KEY)) setExpandedDiscoverySeedIds(new Set([newest.id]));
    if (!hasUiSet(DISCOVERY_LANE_UI_KEY)) setExpandedDiscoveryLaneIds(new Set([discoveryLaneKey(newest.id, "new_upcoming")]));
  }, [discoverySeeds]);

  useEffect(() => { writeUiSet(DISCOVERY_SEED_UI_KEY, expandedDiscoverySeedIds); }, [expandedDiscoverySeedIds]);
  useEffect(() => { writeUiSet(DISCOVERY_LANE_UI_KEY, expandedDiscoveryLaneIds); }, [expandedDiscoveryLaneIds]);
  useEffect(() => () => {
    if (previewStopTimerRef.current != null) window.clearTimeout(previewStopTimerRef.current);
    if (previewAudioRef.current) {
      try { previewAudioRef.current.pause(); } catch { /* Ignore cleanup errors. */ }
    }
  }, []);

  useEffect(() => {
    const activeButton = tabNavRef.current?.querySelector<HTMLElement>(`[data-music-tab="${tab}"]`);
    if (!activeButton) return;
    activeButton.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [tab]);

  useEffect(() => { try { window.localStorage.setItem("mvp_music_artist_view_v1", artistView); } catch {} }, [artistView]);
  useEffect(() => { try { window.localStorage.setItem("mvp_music_album_view_v1", albumView); } catch {} }, [albumView]);

  const averageTrackSeconds = tracks.length ? tracks.reduce((sum, track) => sum + Math.max(120, Number(track.duration_seconds || 210)), 0) / tracks.length : 210;
  const smartEstimatedSongs = Math.max(1, Math.round((smartMinutes * 60) / averageTrackSeconds));
  const smartEligibleCount = tracks.filter((track) => !track.play_less).length;

  function goBack() { if (navigate) navigate("/"); else window.location.pathname = "/"; }

  return (
    <main data-mvp-music="flagship" className={`tr10-page tr10-premiumLibrary tr10-premium-${tab}`}><MusicLibraryVisualEngine activeTab={tab} playing={Boolean(player.playing)} />
      <section className="tr10-hero">
        <div><h1>My Music</h1></div>
        <button type="button" onClick={goBack}>BACK TO TRAINER</button>
      </section>

      <section className="tr10-stats">
        <div><strong>{tracks.length}</strong><span>SONGS</span></div><div><strong>{formatLongDuration(totalDuration)}</strong><span>PLAY TIME</span></div><div><strong>{formatFileSize(totalSize) || "0 MB"}</strong><span>LIBRARY SIZE</span></div><div><strong>{likedCount}</strong><span>LIKED</span></div>
      </section>

      <section className="tr10-console">
        <header className="tr10-sectionHead">
          <div><span className="tr10-directoryEyebrow">DIRECTORY</span><h2>Song Library</h2></div>
          <div className="tr10-headActions">
            <input ref={inputRef} hidden type="file" multiple accept=".mp3,.m4a,.wav,audio/mpeg,audio/mp4,audio/wav" onChange={(event) => void uploadFiles(event.target.files)} />
            <button type="button" disabled={enrichment.running} onClick={() => void enrichTracks(tracks.filter((track) => needsMusicMetadata(track) || trackNeedsArtwork(track)))}>{enrichment.running ? "SCANNING…" : "ENRICH LIBRARY"}</button>
            <button type="button" className="is-orange" disabled={uploading} onClick={() => inputRef.current?.click()}>{uploading ? "UPLOADING…" : "+ UPLOAD SONGS"}</button>
          </div>
        </header>

        <section className="tr10-statusPanel" aria-label="Library status filters">
          <div className="tr10-statusPanelHead"><span>LIBRARY STATUS</span></div>
          <div className="tr10-healthRail">
            <button className={healthFilter === "all" ? "is-active" : ""} onClick={() => setHealthFilter("all")}><span>ALL SONGS</span><b>{tracks.length}</b></button>
            <button className={`${healthFilter === "needs_info" ? "is-active " : ""}is-needs`} onClick={() => setHealthFilter("needs_info")}><span>NEEDS INFO</span><b>{needsInfoCount}</b></button>
            <button className={`${healthFilter === "missing_art" ? "is-active " : ""}is-art`} onClick={() => setHealthFilter("missing_art")}><span>MISSING ART</span><b>{missingArtCount}</b></button>
            <button className={`${healthFilter === "liked" ? "is-active " : ""}is-liked`} onClick={() => setHealthFilter("liked")}><span>LIKED</span><b>{likedCount}</b></button>
            <button className={`${healthFilter === "review" ? "is-active " : ""}is-review`} onClick={() => setHealthFilter("review")}><span>REVIEW</span><b>{Math.max(reviewCount, reviewItems.length)}</b></button>
          </div>
        </section>

        <div ref={tabNavRef}><MvpMusicTabs value={tab} onChange={(value) => { setTab(value); setCollectionDetail(null); if (value === "discover") setDiscoveryView("archive"); }} /></div>

        {message ? <div className="tr10-message">{message}</div> : null}
        {error ? <div className="tr10-error">{error}</div> : null}

        {tab === "songs" ? <>
          <div className="m36-toolbar tr10-toolbar">
            <label><span>SEARCH</span><input value={songSearch} onChange={(event) => setSongSearch(event.target.value)} placeholder="Song, artist, album, or file…" /></label>
            <MusicPremiumSelect label="ENERGY" value={energyFilter} onChange={(next) => setEnergyFilter(next as EnergyFilter)} options={[{value:"all",label:"All energy"},{value:"low",label:"Low"},{value:"medium",label:"Medium"},{value:"high",label:"High"}]} />
            <MusicPremiumSelect label="SORT" value={songSort} onChange={(next) => setSongSort(next as SongSort)} options={(["library","recently_added","title_asc","title_desc","artist_asc","artist_desc","album_asc","most_played","recently_played","high_rotation","least_played","most_skipped","longest","shortest","energy_high","energy_low"] as SongSort[]).map((sort) => ({ value: sort, label: songSortLabel(sort) }))} />
            <MusicPremiumSelect label="SHOW" value={pageSize} onChange={(next) => setPageSize(Number(next) as PageSize)} options={[{value:12,label:"12"},{value:24,label:"24"},{value:48,label:"48"}]} />
          </div>

          {selectedCount ? <div className="tr10-bulk"><strong>{selectedCount} SELECTED</strong><div><button onClick={() => openPlaylistModal([...selectedSongIds])}>+ PLAYLIST</button><button onClick={() => void enrichTracks(tracks.filter((track) => selectedSongIds.has(track.id)))}>IDENTIFY</button><button onClick={() => void enrichTracks(tracks.filter((track) => selectedSongIds.has(track.id)), true)}>FIND ART</button><button onClick={() => setSelectedSongIds(new Set())}>CLEAR</button></div></div> : null}

          <div className="m36-songTable tr10-table is-list">
            <div className="tr10-tableHead">
              <span className="tr10-orderHead">ORDER</span><label><input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectVisible} /></label>
              <span className="tr10-trackHead">TRACK</span><span className="tr10-timeHead">TIME</span><span className="tr10-energyHead">ENERGY</span>
              <span className="tr10-actionsHead">ACTIONS</span>
            </div>
            {loading ? <div className="tr10-empty">Loading your music…</div> : null}
            {!loading && !pagedTracks.length ? <div className="tr10-empty">No songs match this view.</div> : null}
            {pagedTracks.map((track) => {
              const current = player.currentTrack?.id === track.id;
              const needsInfo = needsMusicMetadata(track);
              const missingArt = trackNeedsArtwork(track);
              const reorderIndex = libraryOrderIndex.get(track.id) ?? -1;
              return <article className={`tr10-row ${current ? "is-current" : ""}`} key={track.id}>
                <div className="tr10-orderCell" aria-label="Reorder song">
                  <button type="button" aria-label={`Move ${track.title} up`} disabled={reorderIndex <= 0} onClick={() => moveTrack(track.id,-1)}><ChevronUpPremiumIcon /></button>
                  <button type="button" aria-label={`Move ${track.title} down`} disabled={reorderIndex < 0 || reorderIndex >= libraryOrderedTracks.length - 1} onClick={() => moveTrack(track.id,1)}><ChevronDownPremiumIcon /></button>
                </div>
                <label className="tr10-check"><input type="checkbox" checked={selectedSongIds.has(track.id)} onChange={() => toggleSongSelection(track.id)} /></label>
                <div className="tr10-trackCell">
                  <button className={`tr10-play ${current && player.playing ? "is-playing" : ""}`} onClick={() => void toggleTrackPlayback(track)} aria-label={`${current && player.playing ? "Pause" : "Play"} ${track.title}`}>{current && player.playing ? <PausePremiumIcon /> : <PlayPremiumIcon />}</button>
                  <TrackArtwork track={track} />
                  <div className="tr10-trackText"><strong>{track.title}</strong><span>{artistLabel(track)}{track.album ? ` • ${track.album}` : ""}</span><small>{track.original_name}</small>{playbackErrors[track.id] ? <em className="tr10-playbackError">{playbackErrors[track.id]}</em> : null}</div>
                  {needsInfo ? <em className="tr10-healthBadge is-needs">NEEDS INFO</em> : missingArt ? <em className="tr10-healthBadge is-art">MISSING ART</em> : null}
                </div>
                <span className="tr10-duration">{formatDuration(track.duration_seconds)}</span>
                <button className={`tr10-energy is-${track.energy_level}`} onClick={() => void setEnergy(track, track.energy_level === "low" ? "medium" : track.energy_level === "medium" ? "high" : "low")} title="Click to change energy"><i className="tr10-energyLed" /><span>{track.energy_level.toUpperCase()}</span></button>
                <div className="m36-trackActions">
                  <MvpAction icon={<HeartPremiumIcon filled={track.favorite} />} label={track.favorite ? "LIKED" : "LIKE"} tone="green" active={track.favorite} onClick={() => void changePreference(track, track.favorite ? "neutral" : "like")} />
                  <MvpAction icon={<PlayLessPremiumIcon />} label="PLAY LESS" tone="red" active={track.play_less} onClick={() => void changePreference(track, track.play_less ? "neutral" : "play_less")} />
                  <MvpAction icon={<NextPremiumIcon />} label="PLAY NEXT" tone="blue" onClick={() => playMusicNext(track.id)} />
                  <MvpAction icon={<QueuePremiumIcon />} label="QUEUE" className="m36-queuePrimary" onClick={() => addMusicToQueue(track.id)} />
                  <div className="m36-wideOnly"><MvpAction icon={<PlaylistPremiumIcon />} label="PLAYLIST" tone="amber" onClick={() => openPlaylistModal([track.id])} /></div>
                  <div className="m36-wideOnly"><MvpAction icon={<EditPremiumIcon />} label="EDIT" onClick={() => openDetail(track)} /></div>
                  <MvpMoreMenu items={[
                    { label: "QUEUE", icon: <QueuePremiumIcon />, onClick: () => addMusicToQueue(track.id) },
                    { label: "PLAYLIST", icon: <PlaylistPremiumIcon />, tone: "amber", onClick: () => openPlaylistModal([track.id]) },
                    { label: "EDIT", icon: <EditPremiumIcon />, onClick: () => openDetail(track) },
                  ]} />
                </div>
              </article>;
            })}
          </div>

          <div className="tr10-pager"><span>{filteredTracks.length ? `${(safePage - 1) * pageSize + 1}–${Math.min(safePage * pageSize, filteredTracks.length)} OF ${filteredTracks.length}` : "0 SONGS"}</span><div><button disabled={safePage <= 1} onClick={() => setPage((value) => Math.max(1,value-1))}>PREV</button><b>{safePage} / {pageCount}</b><button disabled={safePage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount,value+1))}>NEXT</button></div></div>
        </> : null}

        {tab === "artists" ? activeArtistDetail ? <CollectionDetailView
          kind="artist"
          title={activeArtistDetail.artist}
          subtitle="Every uploaded song by this artist"
          tracks={activeArtistDetail.tracks}
          backLabel="ARTISTS"
          currentTrackId={player.currentTrack?.id || null}
          playing={player.playing}
          trackMeta={(track) => [albumLabel(track), track.release_year ? String(track.release_year) : ""].filter(Boolean).join(" • ")}
          onBack={() => setCollectionDetail(null)}
          onPlayAll={() => void playMusicAdHocQueue(activeArtistDetail.artist, activeArtistDetail.tracks)}
          onShuffle={() => void playCollectionShuffle(activeArtistDetail.artist, activeArtistDetail.tracks)}
          onPlayTrack={(track) => void playCollectionTrack(activeArtistDetail.artist, activeArtistDetail.tracks, track)}
          onLike={(track) => void changePreference(track, track.favorite ? "neutral" : "like")}
          onPlayLess={(track) => void changePreference(track, track.play_less ? "neutral" : "play_less")}
          onPlaylist={(track) => openPlaylistModal([track.id])}
          onEdit={openDetail}
        /> : <section className="tr34-collectionBrowse">
          <header className="tr34-collectionTools"><div><span>ARTIST DIRECTORY</span><h3>{artistGroups.length} artists</h3></div><MvpDensityPicker value={artistView} onChange={(mode) => setArtistView(mode as CollectionView)} label="Artist view density" /></header>
          <div className={`m36-collectionGrid tr10-cardGrid tr34-collectionGrid is-${artistView}`}>{artistGroups.map(([artist,songs]) => <article className="tr10-collectionCard" key={artist}>
            <button type="button" className="tr10-collectionOpen" onClick={() => setCollectionDetail({ kind: "artist", artist })} aria-label={`Open ${artist}`} title={artist}><TrackArtwork track={songs[0]} size="card" /><div><small>ARTIST</small><h3>{artist}</h3><p>{songs.length} SONG{songs.length === 1 ? "" : "S"} • {formatLongDuration(songs.reduce((sum,track) => sum + Number(track.duration_seconds || 0),0))}</p></div></button>
            <button type="button" className="tr10-collectionPlay" onClick={() => void playMusicAdHocQueue(artist,songs)}><PlayPremiumIcon /><span>PLAY</span></button>
          </article>)}</div>
        </section> : null}

        {tab === "albums" ? activeAlbumDetail ? <CollectionDetailView
          kind="album"
          title={activeAlbumDetail.album}
          subtitle={activeAlbumDetail.artist}
          tracks={activeAlbumDetail.tracks}
          backLabel="ALBUMS"
          currentTrackId={player.currentTrack?.id || null}
          playing={player.playing}
          trackMeta={(track) => [artistLabel(track), track.release_year ? String(track.release_year) : ""].filter(Boolean).join(" • ")}
          onBack={() => setCollectionDetail(null)}
          onPlayAll={() => void playMusicAdHocQueue(`Album • ${activeAlbumDetail.album}`, activeAlbumDetail.tracks)}
          onShuffle={() => void playCollectionShuffle(`Album • ${activeAlbumDetail.album}`, activeAlbumDetail.tracks)}
          onPlayTrack={(track) => void playCollectionTrack(`Album • ${activeAlbumDetail.album}`, activeAlbumDetail.tracks, track)}
          onLike={(track) => void changePreference(track, track.favorite ? "neutral" : "like")}
          onPlayLess={(track) => void changePreference(track, track.play_less ? "neutral" : "play_less")}
          onPlaylist={(track) => openPlaylistModal([track.id])}
          onEdit={openDetail}
        /> : <section className="tr34-collectionBrowse">
          <header className="tr34-collectionTools"><div><span>ALBUM DIRECTORY</span><h3>{albumGroups.length} albums</h3></div><MvpDensityPicker value={albumView} onChange={(mode) => setAlbumView(mode as CollectionView)} label="Album view density" /></header>
          <div className={`m36-collectionGrid tr10-cardGrid tr34-collectionGrid is-${albumView}`}>{albumGroups.map((group) => <article className="tr10-collectionCard" key={`${group.artist}-${group.album}`}>
            <button type="button" className="tr10-collectionOpen" onClick={() => setCollectionDetail({ kind: "album", artist: group.artist, album: group.album })} aria-label={`Open ${group.album}`} title={`${group.album} • ${group.artist}`}><TrackArtwork track={group.tracks[0]} size="card" /><div><small>ALBUM</small><h3>{group.album}</h3><p>{group.artist} • {group.tracks.length} SONG{group.tracks.length === 1 ? "" : "S"}</p></div></button>
            <button type="button" className="tr10-collectionPlay" onClick={() => void playMusicAdHocQueue(`Album • ${group.album}`,group.tracks)}><PlayPremiumIcon /><span>PLAY</span></button>
          </article>)}</div>
        </section> : null}

        {tab === "playlists" ? <section className="m36-playlists tr21-playlists">
          <aside className="tr21-playlistDock">
            <div className="tr21-playlistDockHead"><span>YOUR COLLECTIONS</span><b>{regularPlaylists.length}</b></div>
            <div className="tr21-createPlaylist"><input value={newPlaylistName} onChange={(event) => setNewPlaylistName(event.target.value)} placeholder="Name a new playlist" onKeyDown={(event) => { if (event.key === "Enter") void createPlaylist(); }} /><button type="button" onClick={() => void createPlaylist()} aria-label="Create playlist">+</button></div>
            <div className="tr21-playlistChoices">{regularPlaylists.map((playlist,index) => { const count=(playlistTrackIds[playlist.id] || []).length; return <button type="button" key={playlist.id} className={selectedPlaylistId === playlist.id ? "is-active" : ""} onClick={() => setSelectedPlaylistId(playlist.id)}><i>{String(index+1).padStart(2,"0")}</i><span><strong>{playlist.name}</strong><small>{count} SONG{count===1?"":"S"}</small></span><em aria-hidden>›</em></button>; })}</div>
          </aside>
          <section className="tr21-playlistStage">{selectedPlaylist ? <>
            <header className="tr21-playlistHero">
              <div className="tr21-playlistArt">{selectedPlaylistTracks[0] ? <TrackArtwork track={selectedPlaylistTracks[0]} size="card" /> : <span>♫</span>}<i aria-hidden /></div>
              <div className="tr21-playlistHeroCopy"><small>MVP COLLECTION</small><h2>{selectedPlaylist.name}</h2><p>{selectedPlaylistTracks.length ? `${selectedPlaylistTracks.length} tracks curated from your private library.` : "This collection is ready for its first tracks."}</p><div className="tr21-playlistMetrics"><span><b>{selectedPlaylistTracks.length}</b><small>TRACKS</small></span><span><b>{formatLongDuration(selectedPlaylistDurationSeconds)}</b><small>PLAY TIME</small></span><span><b>{selectedPlaylistHighEnergy}</b><small>HIGH ENERGY</small></span><span><b>{selectedPlaylistLiked}</b><small>LIKED</small></span></div></div>
              <div className="tr21-playlistHeroActions"><button type="button" className="is-play" disabled={!selectedPlaylistTracks.length} onClick={() => void playSelectedPlaylist()}><i aria-hidden><PlayPremiumIcon /></i><span><strong>PLAY</strong><small>Start collection</small></span></button><button type="button" className="is-shuffle" disabled={!selectedPlaylistTracks.length} onClick={() => void playCollectionShuffle(`Playlist • ${selectedPlaylist.name}`, selectedPlaylistTracks)}><i aria-hidden><ShufflePremiumIcon /></i><span><strong>MIX</strong><small>Shuffle intelligently</small></span></button><button type="button" className="is-export" disabled={!selectedPlaylistTracks.length} onClick={openBurnStudio}><i aria-hidden><SparkPremiumIcon /></i><span><strong>EXPORT</strong><small>Burn / export CD</small></span></button><button type="button" className="is-delete" onClick={() => void removePlaylist(selectedPlaylist)} aria-label={`Delete ${selectedPlaylist.name}`}>DELETE</button></div>
            </header>
            <div className="tr21-playlistRailHead"><div><span>TRACKS</span><strong>{selectedPlaylistTracks.length} SONG{selectedPlaylistTracks.length===1?"":"S"}</strong></div><button type="button" disabled={!selectedSongIds.size} onClick={() => openPlaylistModal([...selectedSongIds])}>+ ADD {selectedSongIds.size || ""} SELECTED</button></div>
            <div className="tr21-playlistTracks">{selectedPlaylistTracks.length ? selectedPlaylistTracks.map((track,index) => <article key={track.id} className={player.currentTrack?.id===track.id ? "is-current" : ""}><span className="tr21-trackNumber">{String(index+1).padStart(2,"0")}</span><TrackArtwork track={track} /><div className="tr21-playlistTrackCopy"><strong>{track.title}</strong><span>{artistLabel(track)}{track.album ? ` • ${track.album}` : ""}</span></div><span className={`tr21-playlistEnergy is-${track.energy_level}`}><i />{track.energy_level.toUpperCase()}</span><span className="tr21-playlistDuration">{formatDuration(track.duration_seconds)}</span><div className="tr21-playlistTrackActions"><button type="button" className="is-trackPlay" onClick={() => void playSelectedPlaylist(track.id)} aria-label={`Play ${track.title}`}><PlayPremiumIcon /></button><button type="button" disabled={index===0} onClick={() => { const next=[...selectedPlaylistTracks]; [next[index-1],next[index]]=[next[index],next[index-1]]; void savePlaylistOrder(next); }} aria-label={`Move ${track.title} up`}><ChevronUpPremiumIcon /></button><button type="button" disabled={index===selectedPlaylistTracks.length-1} onClick={() => { const next=[...selectedPlaylistTracks]; [next[index+1],next[index]]=[next[index],next[index+1]]; void savePlaylistOrder(next); }} aria-label={`Move ${track.title} down`}><ChevronDownPremiumIcon /></button><button type="button" className="is-remove" onClick={() => void savePlaylistOrder(selectedPlaylistTracks.filter((item) => item.id !== track.id))}>REMOVE</button></div></article>) : <div className="tr21-playlistEmpty"><b>EMPTY COLLECTION</b><span>Select songs in the Songs tab, then route them here.</span></div>}</div>
          </> : <div className="tr21-playlistEmpty is-stage"><b>BUILD YOUR FIRST COLLECTION</b><span>Create a playlist on the left to turn your library into a dedicated listening collection.</span></div>}</section>
        </section> : null}

        {tab === "smart" ? <section className="m36-smart tr34-smart">
          <header className="tr34-smartHead"><div><span>SMART MIX</span><h2>Build a workout soundtrack</h2><p>Choose the training character and length. MVP ranks the unplayed pool first, so steering never forces early repeats.</p></div><div><strong>{smartEligibleCount}</strong><span>ELIGIBLE SONGS</span></div></header>
          <div className="tr34-smartModes">{(["high","balanced","recovery"] as SmartIntensity[]).map((value) => { const copy = value === "high" ? "Aggressive, heavy, high-drive" : value === "balanced" ? "Strong energy with more variation" : "Lower intensity and smoother pacing"; const dna = value === "high" ? "ENERGY 90 • HEAVY 82 • DRIVE 92" : value === "balanced" ? "ENERGY 72 • HEAVY 62 • DRIVE 74" : "ENERGY 52 • MELODIC 72 • DRIVE 55"; return <button key={value} className={smartIntensity===value ? "is-active" : ""} onClick={() => setSmartIntensity(value)}><span>{value.toUpperCase()}</span><strong>{copy}</strong><small>{dna}</small></button>; })}</div>
          <div className="tr34-smartBuildRow">
            <section><span>SESSION LENGTH</span><div className="tr34-durationChoices">{[45,60,75,90].map((minutes) => <button key={minutes} className={smartMinutes===minutes ? "is-active" : ""} onClick={() => setSmartMinutes(minutes)}>{minutes}<small>MIN</small></button>)}<label><input type="number" min={15} max={240} step={5} value={smartMinutes} onChange={(event) => setSmartMinutes(Math.max(15,Math.min(240,Number(event.target.value)||60)))} /><small>CUSTOM</small></label></div></section>
            <section className="tr34-smartSummary"><span>BUILDING FROM</span><div><b>{smartEligibleCount}</b><small>ELIGIBLE</small></div><div><b>{likedCount}</b><small>LIKED</small></div><div><b>{smartEstimatedSongs}</b><small>EST. TRACKS</small></div><div><b>ON</b><small>NO-REPEAT CYCLE</small></div></section>
          </div>
          <button className="tr34-smartLaunch" onClick={() => void buildAndPlaySmartMix(smartIntensity)}><SparkPremiumIcon /><span>BUILD {smartIntensity.toUpperCase()} MIX</span><small>{smartMinutes} min • ~{smartEstimatedSongs} tracks • repeat protected</small></button>
          <section className="tr34-savedMixes"><header><span>SAVED MIXES</span><b>{smartMixPlaylists.length}</b></header><div>{(["high","balanced","recovery"] as SmartIntensity[]).map((mode) => { const name=SMART_MIX_NAMES[mode]; const playlist=smartMixPlaylists.find((item)=>item.name===name); const ids=playlist ? playlistTrackIds[playlist.id] || [] : []; const duration=ids.reduce((sum,id)=>{ const found=tracks.find((track)=>track.id===id); return sum+(found ? trackDuration(found) : 0); },0); return <article key={mode}><div><small>{mode.toUpperCase()}</small><h3>{name}</h3><p>{playlist ? `${ids.length} tracks • ${formatLongDuration(duration)}` : "Not built yet"}</p></div><div>{playlist ? <><button onClick={() => void playSavedSmartMix(playlist)}><PlayPremiumIcon /><span>PLAY</span></button><button onClick={() => {setSmartIntensity(mode);void buildAndPlaySmartMix(mode);}}>REBUILD</button></> : <button onClick={() => {setSmartIntensity(mode);void buildAndPlaySmartMix(mode);}}>BUILD</button>}</div></article>; })}</div></section>
        </section> : null}

        {/* MVP_TRAINER_V5_R6_MUSIC_INTELLIGENCE_SUITE: INTELLIGENCE PANEL */}
        {tab === "intelligence" ? (
          <MusicIntelligencePanel tracks={tracks} />
        ) : null}
        {tab === "audition" ? <MusicAuditionPanel tracks={tracks} previewVolume={player.volume} onPreviewStart={() => pauseMusic()} onImportFile={uploadAuditionSong} /> : null}

        {tab === "discover" ? <section className="m36-discover tr10-discover">
          <section className="tr10-radarPanel" aria-label="Discovery Radar">
            <header className="tr10-radarHead">
              <div><span>DISCOVERY RADAR</span><h2>Your library, resurfaced intelligently</h2><p>Forgotten favorites, deep cuts, long-unplayed tracks, recent Likes, and high-energy music worth bringing back.</p></div>
              <strong>{discoveryRadar.reduce((sum, lane) => sum + lane.tracks.length, 0)}</strong>
            </header>
            <div className="tr10-radarGrid">
              {discoveryRadar.map((lane) => <article key={lane.id}>
                <div><small>{lane.tracks.length} TRACKS</small><h3>{lane.title}</h3><p>{lane.subtitle}</p></div>
                <button type="button" disabled={!lane.tracks.length} onClick={() => void playMusicAdHocQueue(`Radar • ${lane.title}`, lane.tracks)}><PlayPremiumIcon /> <span>PLAY</span></button>
              </article>)}
            </div>
          </section>

          <header className="tr10-discoverHead">
            <div><span>REDISCOVER ARCHIVE</span><h2>{discoveryView === "saved" ? "Saved Songs" : "Your saved music discovery library"}</h2><p>{discoveryView === "saved" ? "Songs you marked to get later. Preview them again, then delete them when you are done." : "More from the seed artist, genuinely similar current music, same-era matches, and hidden gems across eras. Saved to your account so you can come back later."}</p></div>
            <div className="tr10-discoverSummary"><strong>{discoveryView === "saved" ? savedDiscoverySongs.length : discoveryCount}</strong><span>{discoveryView === "saved" ? "SAVED SONGS" : "DISCOVERIES"}</span><small>{discoveryView === "saved" ? "5 SONGS PER PAGE" : `${discoverySeeds.length} SAVED SEED${discoverySeeds.length === 1 ? "" : "S"} • 4 CURATED LANES`}</small></div>
          </header>

          {(discoverySeeds.length || savedDiscoverySongs.length) ? <div className="tr10-discoverArchiveTools">
            <label className="tr10-discoverSearch"><span>{discoveryView === "saved" ? "SEARCH SAVED SONGS" : "SEARCH ARCHIVE"}</span><input value={discoverySearch} onChange={(event) => setDiscoverySearch(event.target.value)} placeholder={discoveryView === "saved" ? "Song, artist, or source" : "Song, artist, or recommendation"} /></label>
            <MusicPremiumSelect label="SORT" value={discoverySort} onChange={(next) => setDiscoverySort(next as DiscoverySort)} options={[{value:"newest",label:"Newest"},{value:"oldest",label:"Oldest"},{value:"artist",label:"Artist A–Z"},...(discoveryView === "archive" ? [{value:"most" as DiscoverySort,label:"Most discoveries"}] : [])]} />
            <MusicPremiumSelect label="FILTER" value={discoveryFilter} disabled={discoveryView === "saved"} onChange={(next) => setDiscoveryFilter(next as DiscoveryFilter)} options={[{value:"all",label:discoveryView === "saved" ? "Saved songs" : "All discoveries"},{value:"artist_catalog",label:"Has More From Artist"},{value:"new_current",label:"Has New & Current"},{value:"same_era",label:"Has Same-Era Matches"},{value:"hidden",label:"Has Hidden Gems"},{value:"unowned",label:"Has New-to-You Tracks"}]} />
            <button type="button" className={`tr10-savedSongsButton ${discoveryView === "saved" ? "is-active" : ""}`} aria-pressed={discoveryView === "saved"} onClick={() => setDiscoveryView((current) => current === "saved" ? "archive" : "saved")}>Saved Songs</button>
          </div> : null}

          {discoveryView === "saved" ? <>
            {!savedDiscoverySongs.length ? <div className="tr10-empty">Songs you mark to add will appear here.</div> : !savedSongsFiltered.length ? <div className="tr10-empty">No Saved Songs match this search.</div> : <>
              <div className="tr10-discoverGrid tr10-savedSongsGrid">
                {pagedSavedSongs.map((item) => <SavedSongCard key={item.id} item={item} previewingId={previewingRecommendationId} previewErrorId={previewErrorRecommendationId} removing={removingSavedSongId === item.id} onPreview={toggleDiscoveryPreview} onDelete={(song) => void deleteSavedDiscoverySong(song)} />)}
              </div>
              <div className="tr10-savedSongsPager">
                <button type="button" disabled={safeSavedSongsPage <= 1} onClick={() => setSavedSongsPage((value) => Math.max(1, value - 1))}>PREVIOUS</button>
                <span>{safeSavedSongsPage} / {savedSongsPageCount}</span>
                <button type="button" disabled={safeSavedSongsPage >= savedSongsPageCount} onClick={() => setSavedSongsPage((value) => Math.min(savedSongsPageCount, value + 1))}>NEXT</button>
              </div>
            </>}
          </> : <>
            {!discoverySeeds.length ? <div className="tr10-empty">Play a song you like and press REDISCOVER in the player.</div> : !discoveryArchive.length ? <div className="tr10-empty">No saved Rediscover results match these filters.</div> : discoveryArchive.map((seed) => {
              const visible = filterDiscoveryRecommendations(seed.recommendations.filter((item)=>!item.dismissed), discoveryFilter);
              const seedExpanded = expandedDiscoverySeedIds.has(seed.id);
              const wasRefreshed = seed.refreshedAt - seed.createdAt > 60000;
              return <section className={`tr10-discoverSeed ${seedExpanded ? "is-expanded" : "is-collapsed"}`} data-rediscover-seed-id={seed.id} key={seed.id}>
                <header className="tr10-discoverSeedHead">
                  <button type="button" className="tr10-discoverSeedToggle" onClick={() => toggleDiscoverySeed(seed.id)} aria-expanded={seedExpanded}>
                    <div className="tr10-discoverSeedIdentity"><small>BASED ON</small><h3>{seed.trackTitle}</h3><p>{seed.trackArtist}{seed.seedYear ? ` • ${seed.seedYear}` : ""}</p><time>{wasRefreshed ? "Updated" : "Rediscovered"} {formatDiscoveryDate(wasRefreshed ? seed.refreshedAt : seed.createdAt)}</time></div>
                    <div className="tr10-discoverSeedStats"><strong>{visible.length}</strong><span>DISCOVERIES</span><small>3 CURATED LANES</small></div>
                    <span className="tr10-discoverChevron" aria-hidden>{seedExpanded ? "⌃" : "⌄"}</span>
                  </button>
                  <button type="button" className="tr10-discoverRemove" disabled={removingDiscoverySeedId === seed.id} onClick={() => void (async () => {
                    stopDiscoveryPreview();
                    setRemovingDiscoverySeedId(seed.id);
                    const removed = await removeDiscoverySeed(seed.id);
                    setDiscoverySeeds(listMusicDiscoverySeeds());
                    setExpandedDiscoverySeedIds((current) => { const next = new Set(current); next.delete(seed.id); return next; });
                    setExpandedDiscoveryLaneIds((current) => new Set([...current].filter((key) => !key.startsWith(`${seed.id}|`))));
                    if (!removed) setError("Rediscover was removed from this device, but cloud deletion could not be confirmed. Check your connection and try again.");
                    setRemovingDiscoverySeedId(null);
                  })()}>{removingDiscoverySeedId === seed.id ? "REMOVING…" : "REMOVE"}</button>
                </header>
                {seedExpanded ? (visible.length ? <div className="tr10-discoverSections">
                  {discoverySectionsForFilter(discoveryFilter).map((section) => {
                    const items = visible.filter((item) => item.category === section.key);
                    const laneKey = discoveryLaneKey(seed.id, section.key);
                    const laneExpanded = expandedDiscoveryLaneIds.has(laneKey);
                    const sectionTitle = section.key === "artist_catalog" ? `More From ${seed.trackArtist}` : section.title;
                    return <section className={`tr10-discoverCategory is-${section.tone} ${laneExpanded ? "is-expanded" : "is-collapsed"}`} key={section.key}>
                      <button type="button" className="tr10-discoverCategoryToggle" onClick={() => toggleDiscoveryLane(seed.id, section.key)} aria-expanded={laneExpanded}>
                        <div><span>{sectionTitle}</span><small>{section.subtitle}</small></div><b>{items.length}</b><i aria-hidden>{laneExpanded ? "⌃" : "⌄"}</i>
                      </button>
                      {laneExpanded ? (items.length ? <div className="tr10-discoverGrid">{items.map((item)=><DiscoveryCard key={item.id} seedId={seed.id} item={item} previewingId={previewingRecommendationId} previewErrorId={previewErrorRecommendationId} saved={savedDiscoverySongIds.has(item.id)} saving={savingRecommendationId === item.id} onPreview={toggleDiscoveryPreview} onSave={(recommendation) => void saveDiscoveryRecommendation(seed, recommendation)} />)}</div> : <div className="tr10-discoverLaneEmpty">Press Rediscover again to refresh and widen this lane.</div>) : null}
                    </section>;
                  })}
                </div> : <div className="tr10-discoverConfidence">Rediscover could not build a useful set from the available music services this time. Press Rediscover again to refresh the search.</div>) : null}
              </section>;
            })}
          </>}
        </section> : null}
      </section>

      {enrichment.running ? <div className="tr10-modalBack tr10-analysisBack"><section className="tr10-analysisModal" role="dialog" aria-modal="true" aria-live="polite">
        <header><div><span>MVP MUSIC INTELLIGENCE</span><h2>{enrichment.label}</h2><p>{enrichment.serviceMessage}</p></div><div className="tr10-analysisCounter"><strong>{enrichment.current}</strong><span>OF {enrichment.total}</span></div></header>
        <div className="tr10-analysisProgress"><i style={{ transform: `scaleX(${enrichment.total ? enrichment.current / enrichment.total : 0})` }} /></div>
        <div className="tr10-analysisStats"><div><span>MATCHED</span><strong>{enrichment.matched}</strong></div><div><span>REVIEW</span><strong>{enrichment.review}</strong></div><div><span>NOT FOUND</span><strong>{enrichment.notFound}</strong></div></div>
        <div className="tr10-analysisCurrent"><span>CURRENT TRACK</span><strong>{enrichment.label.replace(/^(ANALYZING|FINDING ART)\s*•\s*/i, "")}</strong><small>{enrichment.serviceMessage}</small></div>
        <footer><span>EXISTING ARTWORK PROTECTED</span><small>Exact title, artist, filename and duration are checked before anything is saved.</small></footer>
      </section></div> : null}

      {reviewItems.length && reviewRemainingCount > 0 ? <button className="tr10-reviewDock" onClick={openReviewQueue}>REVIEW {reviewRemainingCount} POSSIBLE MATCH{reviewRemainingCount === 1 ? "" : "ES"} ›</button> : null}

      {detailTrack && typeof document !== "undefined" ? createPortal(<div className="tr10-modalBack tr10-detailPortal" onMouseDown={closeDetail}><section className="tr10-inspector" role="dialog" aria-modal="true" onMouseDown={(event: MouseEvent<HTMLElement>) => event.stopPropagation()}>
        <header><div className="tr10-inspectIdentity">{detailPendingCandidate?.artworkUrl ? <img className="tr10-detailPreviewArt" src={detailPendingCandidate.artworkUrl} alt="" /> : <TrackArtwork track={detailTrack} size="detail" />}<div><span>SONG CONTROL</span><h2>{detailTrack.title}</h2><p>{artistLabel(detailTrack)}</p>{detailMode === "edit" ? <small className={`tr10-editState ${detailSaveState === "changed" ? "is-changed" : detailDirty ? "is-dirty" : ""}`}>{detailSaveState === "saving" ? "SAVING…" : detailSaveState === "changed" ? "SAVED ✓" : detailDirty ? "UNSAVED CHANGES" : "LIBRARY RECORD"}</small> : null}</div></div><button onClick={closeDetail}>×</button></header>
        {detailMode === "edit" ? <>
          <div className="tr10-inspectorScroll">
            <div className="tr10-inspectCommands"><button disabled={detailSaveState === "searching"} onClick={() => void findDetailMatches(detailTrack,"info_results")}>{detailSaveState === "searching" ? "SEARCHING…" : "FIND SONG INFO"}</button><button disabled={detailSaveState === "searching"} onClick={() => void findDetailMatches(detailTrack,"artwork_results")}>FIND ARTWORK</button><button onClick={() => playMusicNext(detailTrack.id)}>PLAY NEXT</button><button onClick={() => addMusicToQueue(detailTrack.id)}>ADD TO QUEUE</button><button className={detailTrack.favorite ? "is-liked" : ""} onClick={() => void changePreference(detailTrack, detailTrack.favorite ? "neutral" : "like")}>👍 {detailTrack.favorite ? "LIKED" : "LIKE"}</button><button className={detailTrack.play_less ? "is-down" : ""} onClick={() => void changePreference(detailTrack, detailTrack.play_less ? "neutral" : "play_less")}>👎 PLAY LESS</button></div>
            {detailStatusText ? <div className={`tr10-detailStatus is-${detailSaveState}`}>{detailStatusText}</div> : null}
            <div className="tr10-inspectGrid"><label><span>TITLE</span><input value={drafts[detailTrack.id]?.title || ""} onChange={(event) => setDrafts((current) => ({...current,[detailTrack.id]:{...current[detailTrack.id],title:event.target.value}}))} /></label><label><span>ARTIST</span><input value={drafts[detailTrack.id]?.artist || ""} onChange={(event) => setDrafts((current) => ({...current,[detailTrack.id]:{...current[detailTrack.id],artist:event.target.value}}))} /></label><label><span>ALBUM</span><input value={drafts[detailTrack.id]?.album || ""} onChange={(event) => setDrafts((current) => ({...current,[detailTrack.id]:{...current[detailTrack.id],album:event.target.value}}))} /></label><label><span>YEAR</span><input inputMode="numeric" value={drafts[detailTrack.id]?.releaseYear || ""} onChange={(event) => setDrafts((current) => ({...current,[detailTrack.id]:{...current[detailTrack.id],releaseYear:event.target.value}}))} /></label><label><span>GENRE</span><input value={drafts[detailTrack.id]?.genre || ""} onChange={(event) => setDrafts((current) => ({...current,[detailTrack.id]:{...current[detailTrack.id],genre:event.target.value}}))} /></label><div className="tr10-artControls"><input ref={artworkInputRef} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void replaceArtwork(detailTrack,event.target.files?.[0] || null)} /><span>ARTWORK</span><button onClick={() => artworkInputRef.current?.click()}>{needsMusicArtwork(detailTrack) ? "+ ADD" : "REPLACE"}</button>{!needsMusicArtwork(detailTrack) ? <button className="is-danger" onClick={() => void clearArtwork(detailTrack)}>REMOVE</button> : null}</div></div>
            <dl className="tr10-meta"><div><dt>PLAYS</dt><dd>{detailTrack.play_count}</dd></div><div><dt>COMPLETED</dt><dd>{detailTrack.completed_play_count}</dd></div><div><dt>SKIPS</dt><dd>{detailTrack.skip_count}</dd></div><div><dt>LAST PLAYED</dt><dd>{formatDate(detailTrack.last_played_at)}</dd></div><div><dt>MATCH</dt><dd>{detailTrack.metadata_status.toUpperCase()}</dd></div><div><dt>FILE</dt><dd title={detailTrack.original_name}>{detailTrack.original_name}</dd></div></dl>
          </div>
          <footer><button onClick={() => openPlaylistModal([detailTrack.id])}>+ PLAYLIST</button><button className="is-danger" disabled={busyId===detailTrack.id} onClick={() => void deleteTrack(detailTrack)}>DELETE</button><button className={`is-primary tr10-saveButton ${detailSaveState === "changed" ? "is-changed" : ""}`} disabled={!detailDirty || detailSaveState === "saving" || detailSaveState === "changed"} onClick={() => void saveTrack(detailTrack)}>{detailSaveState === "saving" ? "SAVING…" : detailSaveState === "changed" ? "SAVED ✓" : "SAVE CHANGES"}</button></footer>
        </> : <>
          <div className="tr10-detailLookup"><div className="tr10-detailLookupHead"><button onClick={() => {setDetailMode("edit");setDetailSelectedCandidateId(null);}}>← BACK TO SONG</button><div><span>{detailMode === "artwork_results" ? "ARTWORK RESULTS" : "SONG MATCH RESULTS"}</span><h3>{detailMode === "artwork_results" ? "Choose the correct cover" : "Choose the correct recording"}</h3><p>{detailStatusText}</p></div></div>
          <div className={`tr10-detailCandidates ${detailMode === "artwork_results" ? "is-artwork" : ""}`}>{detailSaveState === "searching" ? <div className="tr10-reviewLoading">SEARCHING FOR THE BEST MATCHES…</div> : null}{detailCandidates.map((candidate) => { const selected = detailSelectedCandidateId === candidate.sourceId; const tier = musicMatchTier(candidate.confidence); return <button type="button" key={candidate.sourceId} className={selected ? "is-selected" : ""} onClick={() => setDetailSelectedCandidateId(candidate.sourceId)}>{candidate.artworkUrl ? <img src={candidate.artworkUrl} alt="" /> : <span className="tr10-candidateArt">♫</span>}<div><strong>{candidate.title}</strong><span>{candidate.artist}</span><small>{candidate.album || "Unknown album"}{candidate.releaseYear ? ` • ${candidate.releaseYear}` : ""}{candidate.durationSeconds ? ` • ${formatDuration(candidate.durationSeconds)}` : ""}</small></div><em className={`tr10-matchTier is-${tier.toLowerCase().replaceAll(" ","-")}`}>{tier}<b>{Math.round(candidate.confidence*100)}%</b></em><i className="tr10-selectMark">{selected ? "✓" : ""}</i></button>; })}{detailSaveState !== "searching" && !detailCandidates.length ? <div className="tr10-empty">No useful matches found.</div> : null}</div></div>
          <div className="tr10-detailLookupFooter"><div><strong>{detailSelectedCandidate ? `${detailSelectedCandidate.title} • ${detailSelectedCandidate.artist}` : "Select a result"}</strong><small>Nothing changes until you apply the selection.</small></div><button onClick={() => {setDetailMode("edit");setDetailSelectedCandidateId(null);}}>CANCEL</button><button className="is-primary" disabled={!detailSelectedCandidate || detailSaveState === "saving"} onClick={() => { if (!detailSelectedCandidate) return; if (detailMode === "artwork_results") void applyDetailArtworkCandidate(detailSelectedCandidate); else applyDetailInfoCandidate(detailSelectedCandidate); }}>{detailMode === "artwork_results" ? "USE ARTWORK" : "APPLY MATCH"}</button></div>
        </>}
      </section></div>, document.body) : null}

      {reviewTrack ? <div className="tr10-modalBack tr10-reviewBack" onMouseDown={() => setReviewTrackId(null)}><section className="tr10-reviewModal" role="dialog" aria-modal="true" onMouseDown={(event: MouseEvent<HTMLElement>) => event.stopPropagation()}>
        <header className="tr10-reviewHeader"><div><span>LIBRARY MATCH REVIEW</span><h2>{reviewTrack.title}</h2><p>{artistLabel(reviewTrack)} • {reviewTrack.original_name}</p></div><button onClick={() => setReviewTrackId(null)}>×</button></header>
        <div className="tr10-reviewProgress"><div><strong>REVIEWING {Math.max(1,reviewIndex+1)} OF {reviewItems.length}</strong><span>{reviewSavedIds.size} saved • {reviewSkippedIds.size} skipped • {reviewRemainingCount} remaining</span></div><i style={{ transform: `scaleX(${reviewItems.length ? Math.max(0,reviewIndex+1)/reviewItems.length : 0})` }} /></div>
        <div className="tr10-reviewInstruction"><span>SELECT THE CORRECT RECORDING</span><p>Exact title and artist matches rank first. Existing artwork is protected. Nothing changes until you press Save.</p></div>
        <div className="tr10-candidates">{reviewCandidates.map((candidate) => { const selected = reviewSelectedCandidateId === candidate.sourceId; const tier=musicMatchTier(candidate.confidence); return <button type="button" className={selected ? "is-selected" : ""} key={candidate.sourceId} onClick={() => setReviewSelectedCandidateId(candidate.sourceId)}>{candidate.artworkUrl ? <img src={candidate.artworkUrl} alt="" /> : <span className="tr10-candidateArt">♫</span>}<div><strong>{candidate.title}</strong><span>{candidate.artist}</span><small>{candidate.album || "Unknown album"}{candidate.releaseYear ? ` • ${candidate.releaseYear}` : ""}{candidate.durationSeconds ? ` • ${formatDuration(candidate.durationSeconds)}` : ""}</small></div><em className={`tr10-matchTier is-${tier.toLowerCase().replaceAll(" ","-")}`}>{tier}<b>{Math.round(candidate.confidence*100)}%</b></em><i className="tr10-selectMark">{selected ? "✓" : ""}</i></button>; })}</div>
        <footer><button onClick={skipReview}>SKIP</button><button disabled={!reviewSelectedCandidate || busyId === `match-${reviewTrack.id}`} onClick={() => void saveReviewCandidate(false)}>SAVE</button><button className="is-primary" disabled={!reviewSelectedCandidate || busyId === `match-${reviewTrack.id}`} onClick={() => void saveReviewCandidate(true)}>SAVE & NEXT</button></footer>
      </section></div> : null}

      {playlistModalTrackIds.length ? <div className="tr10-modalBack" onMouseDown={() => setPlaylistModalTrackIds([])}><section className="tr10-picker" onMouseDown={(event: MouseEvent<HTMLElement>) => event.stopPropagation()}><header><div><span>PLAYLIST ROUTING</span><h2>{playlistModalTrackIds.length} song{playlistModalTrackIds.length===1 ? "" : "s"}</h2></div><button onClick={() => setPlaylistModalTrackIds([])}>×</button></header><div>{regularPlaylists.map((playlist) => <label key={playlist.id}><input type="checkbox" checked={playlistModalSelections.has(playlist.id)} onChange={() => setPlaylistModalSelections((current) => {const next=new Set(current);next.has(playlist.id)?next.delete(playlist.id):next.add(playlist.id);return next;})} /><span><strong>{playlist.name}</strong><small>{playlistTrackIds[playlist.id]?.length || 0} songs</small></span></label>)}</div><label className="tr10-newRoute"><span>CREATE NEW PLAYLIST</span><input value={playlistModalName} onChange={(event) => setPlaylistModalName(event.target.value)} placeholder="Playlist name" /></label><footer><button onClick={() => setPlaylistModalTrackIds([])}>CANCEL</button><button className="is-primary" disabled={busyId === "playlist-route"} onClick={() => void savePlaylistMemberships()}>SAVE PLAYLISTS</button></footer></section></div> : null}

      {burnOpen && selectedPlaylist ? (
        <div className="tr10-modalBack tr10-burnBack" onMouseDown={closeBurnStudio}>
          <section className={`tr10-burnStudio ${burnComplete ? "is-complete" : ""}`} role="dialog" aria-modal="true" onMouseDown={(event: MouseEvent<HTMLElement>) => event.stopPropagation()}>
            <header>
              <div>
                <span>DISC AUTHORING STUDIO</span>
                <h2>{selectedPlaylist.name}</h2>
                <p>Prepare this playlist for a professionally organized MP3 or Audio CD.</p>
              </div>
              <button type="button" disabled={burnBusy} onClick={closeBurnStudio}>×</button>
            </header>

            <div className="tr10-burnBody">
              <div className="tr10-burnModes">
                <button type="button" disabled={burnBusy || burnComplete} className={burnMode === "mp3" ? "is-active" : ""} onClick={() => changeBurnMode("mp3")}>
                  <b>MP3 DISC</b>
                  <span>700 MB DATA CD</span>
                  <small>Original music files • Playlist order optimized for compatible stereos, computers, and MP3 players.</small>
                </button>
                <button type="button" disabled={burnBusy || burnComplete} className={burnMode === "audio" ? "is-active" : ""} onClick={() => changeBurnMode("audio")}>
                  <b>STANDARD AUDIO CD</b>
                  <span>80 MINUTE AUDIO CD</span>
                  <small>Traditional audio-disc preparation • Compatible with standard CD players and audio-CD software.</small>
                </button>
              </div>

              <div className="tr10-burnStats">
                <div><span>TRACKS</span><strong>{selectedPlaylistTracks.length}</strong></div>
                <div><span>PLAY TIME</span><strong>{formatBurnClock(selectedPlaylistBurnSeconds)}</strong></div>
                <div><span>FILE SIZE</span><strong>{formatBurnMb(selectedPlaylistBurnBytes)}</strong></div>
                <div><span>DISCS</span><strong>{burnDiscs.length || 1}</strong></div>
              </div>

              <section className="tr10-burnMap">
                <header><span>DISC PLAN</span><small>Playlist order preserved</small></header>
                {burnDiscs.map((disc) => {
                  const first = selectedPlaylistTracks.findIndex((track) => track.id === disc.tracks[0]?.id) + 1;
                  const last = selectedPlaylistTracks.findIndex((track) => track.id === disc.tracks[disc.tracks.length - 1]?.id) + 1;
                  const used = burnMode === "mp3"
                    ? Math.min(100, (disc.bytes / MP3_CD_CAPACITY_BYTES) * 100)
                    : Math.min(100, (disc.seconds / AUDIO_CD_CAPACITY_SECONDS) * 100);
                  return (
                    <article key={disc.number}>
                      <div><b>DISC {disc.number}</b><span>Tracks {first}–{last}</span></div>
                      <div className="tr10-burnMeter"><i style={{ width: `${used}%` }} /></div>
                      <strong>{burnMode === "mp3" ? formatBurnMb(disc.bytes) : formatBurnClock(disc.seconds)}</strong>
                    </article>
                  );
                })}
              </section>

              {!burnComplete ? (
                <div className="tr10-burnHelperNote">
                  <b>DISC PREPARATION</b>
                  <span>MVP Trainer organizes, numbers, and prepares your playlist for Windows disc burning.</span>
                </div>
              ) : null}

              {burnBusy && burnProgress ? (
                <section className="tr10-burnProgressPanel" aria-live="polite">
                  <div className="tr10-burnProgressHead">
                    <div>
                      <span>PREPARING DISC {burnProgress.disc} OF {burnProgress.discs}</span>
                      <strong>TRACK {burnProgress.track} OF {burnProgress.tracks}</strong>
                    </div>
                    <b>{burnProgress.percent}%</b>
                  </div>
                  <div className="tr10-burnProgressTrack"><i style={{ width: `${burnProgress.percent}%` }} /></div>
                  <div className="tr10-burnProgressSong">
                    <strong>{burnProgress.artist} • {burnProgress.title}</strong>
                    <span>Organizing files • Updating track order</span>
                  </div>
                </section>
              ) : null}

              {burnComplete ? (
                <section className="tr10-burnComplete" aria-live="polite">
                  <div className="tr10-burnCompleteIcon" aria-hidden="true">✓</div>
                  <div className="tr10-burnCompleteCopy">
                    <span>PREPARATION COMPLETE</span>
                    <h3>DISC FILES READY</h3>
                    <p>{selectedPlaylistTracks.length} tracks • {burnMode === "mp3" ? formatBurnMb(selectedPlaylistBurnBytes) : formatBurnClock(selectedPlaylistBurnSeconds)} • {burnDiscs.length || 1} disc{burnDiscs.length === 1 ? "" : "s"}</p>
                    <strong>{burnSafeName(`${selectedPlaylist.name} - ${burnMode === "mp3" ? "MP3 CD" : "Audio CD"}`)}</strong>
                    <small>Your playlist is organized and ready for Windows disc burning. Close this window, open the destination folder, and burn the prepared Disc folder.</small>
                  </div>
                </section>
              ) : burnStatus ? (
                <div className="tr10-burnStatus">{burnStatus}</div>
              ) : null}
            </div>

            <footer className={burnComplete ? "is-complete" : ""}>
              {burnComplete ? (
                <button type="button" className="is-primary is-ready" onClick={closeBurnStudio}>CLOSE</button>
              ) : (
                <>
                  <button type="button" disabled={burnBusy} onClick={closeBurnStudio}>CANCEL</button>
                  <button type="button" className="is-primary" disabled={burnBusy || !selectedPlaylistTracks.length} onClick={() => void prepareCdFiles()}>
                    {burnBusy ? "PREPARING DISC…" : burnMode === "mp3" ? "PREPARE MP3 DISC" : "PREPARE AUDIO CD"}
                  </button>
                </>
              )}
            </footer>
          </section>
        </div>
      ) : null}

      
    </main>
  );
}
