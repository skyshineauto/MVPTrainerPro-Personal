/* MVP_TRAINER_V5_R7_NEURAL_PLAYER_DISCOVERY */
import {
  memo,
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
  type MusicLookupDiagnostics,
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
import {
  analyzeMusicTrackIntelligence,
  describeMusicIntelligenceSources,
  getMusicTrackIntelligence,
  hydrateMusicIntelligenceCache,
  isMusicIntelligenceCurrent,
  markMusicTrackIntelligenceStale,
  type MusicIntelligenceStage,
  type MusicTrackIntelligence,
} from "../../lib/musicIntelligenceEnrichment";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { MusicLibraryVisualEngine } from "./premium/MusicLibraryVisualEngine";
import { MusicPremiumSelect } from "./premium/MusicPremiumSelect";
import { MvpDensityPicker, MvpPrimaryAction } from "./premium/MusicUiPrimitives";
// MVP_R12_5E_38A_BUILD_CLEANUP: removes r38 dead symbols after the pro media-layout rewrite.
import {
  ChevronDownPremiumIcon,
  ChevronUpPremiumIcon,
  ClosePremiumIcon,
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
  YouTubePremiumIcon,
} from "./premium/MusicLibraryPremiumIcons";
import "./premium/MusicLibraryPremium.css";
import "./premium/MusicUiSystem.css";
import "./premium/MusicIntelligenceEnrichment.css";
import "./premium/MusicLibraryR52.css";

const StableMusicLibraryVisualEngine = memo(MusicLibraryVisualEngine);

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
type EnrichmentActivity = { id: string; tone: "ok" | "work" | "review" | "error"; text: string; detail: string };
type EnrichmentVisualStage = "idle" | "identifying" | "metadata" | "artwork" | "artist_dna" | "song_dna" | "audio_intelligence" | "saving" | "complete";
type EnrichmentState = {
  running: boolean; open: boolean; minimized: boolean; current: number; total: number; completed: number;
  libraryTotal: number; skipped: number; matched: number; review: number; notFound: number; failed: number; intelligenceComplete: number;
  metadataUpdated: number; artworkUpdated: number; intelligenceUpdated: number;
  label: string; serviceMessage: string; stage: EnrichmentVisualStage; currentTrackId: string | null;
  failedTrackIds: string[]; activity: EnrichmentActivity[];
};
type UploadProgressState = {
  visible: boolean;
  status: "active" | "success" | "error";
  stage: "uploading" | "enriching" | "analyzing" | "complete";
  currentFile: number;
  totalFiles: number;
  completedSteps: number;
  totalSteps: number;
  fileName: string;
  displayName: string;
  intelligenceReady: number;
  summary: string;
};
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

function discoveryYoutubeUrl(item: { artist: string; title: string }) {
  const query = [item.artist, item.title, "official audio"].filter(Boolean).join(" ");
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

/* MVP_R12_5E_33_DISCOVER_WORKSPACE_SAVED_SONGS_HELPER */
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
  const status = item.inLibrary ? "IN LIBRARY" : saved ? "ADDED" : discoveryTypeLabel(item);
  return <motion.article
    className={`m37-discoveryCard tr63-discoveryCard ${item.inLibrary ? "is-owned" : ""} ${saved ? "is-saved" : ""}`}
    whileHover={{ y: -2 }}
    transition={{ duration: .18 }}
  >
    <div className="m37-discoveryArt tr63-discoveryArt">
      {item.artworkUrl ? <img src={item.artworkUrl} alt="" /> : <div>♫</div>}
      <span className={`tr63-discoveryStatus ${item.inLibrary ? "is-owned" : saved ? "is-saved" : ""}`}>{status}</span>
    </div>
    <div className="m37-discoveryCopy tr63-discoveryCopy">
      <strong>{item.title}</strong>
      <span>{item.artist}{item.album && item.album !== item.title ? ` • ${item.album}` : ""}</span>
      <small>{item.reason || discoveryTypeLabel(item)}{item.year ? ` • ${item.year}` : ""}</small>
    </div>
    <div className="m37-discoveryActions tr63-discoveryActions">
      {item.previewUrl ? <button type="button" className={`is-preview ${previewing ? "is-active" : ""}`} onClick={() => onPreview(item)}>{previewing ? <PausePremiumIcon /> : <PlayPremiumIcon />}<span>{previewing ? "STOP PREVIEW" : previewError ? "RETRY PREVIEW" : "PREVIEW"}</span></button> : <span className="is-disabled"><PlayPremiumIcon /><span>NO PREVIEW</span></span>}
      {item.inLibrary ? <span className="is-owned"><HeartPremiumIcon filled /><span>IN LIBRARY</span></span> : <button type="button" className={`is-add ${saved ? "is-active" : ""}`} disabled={saved || saving} onClick={() => onSave(item)}><PlaylistPremiumIcon /><span>{saved ? "ADDED" : saving ? "ADDING…" : "ADD"}</span></button>}
      <button type="button" className="is-dismiss" onClick={() => setDiscoveryRecommendationState(seedId,item.id,{dismissed:true})}><PlayLessPremiumIcon /><span>NOT INTERESTED</span></button>
      {item.storeUrl ? <a className="is-store" href={item.storeUrl} target="_blank" rel="noreferrer"><SparkPremiumIcon /><span>APPLE MUSIC</span></a> : null}
    </div>
  </motion.article>;
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
  const youtubeUrl = discoveryYoutubeUrl(item);
  return <motion.article className={`m37-discoveryCard tr63-discoveryCard is-saved ${item.inLibrary ? "is-owned" : ""}`} whileHover={{ y: -2 }} transition={{ duration: .18 }}>
    <div className="m37-discoveryArt tr63-discoveryArt">{item.artworkUrl ? <img src={item.artworkUrl} alt="" /> : <div>♫</div>}<span className="tr63-discoveryStatus is-saved">SAVED</span></div>
    <div className="m37-discoveryCopy tr63-discoveryCopy"><strong>{item.title}</strong><span>{item.artist}{item.album && item.album !== item.title ? ` • ${item.album}` : ""}</span><small>Saved from {item.seedTrackTitle}</small></div>
    <div className="m37-discoveryActions tr63-discoveryActions is-savedActions">
      {item.previewUrl ? <button type="button" className={`is-preview ${previewing ? "is-active" : ""}`} onClick={() => onPreview(item)}>{previewing ? <PausePremiumIcon /> : <PlayPremiumIcon />}<span>{previewing ? "STOP PREVIEW" : previewError ? "RETRY PREVIEW" : "PREVIEW"}</span></button> : null}
      <a className="is-youtube" href={youtubeUrl} target="_blank" rel="noreferrer"><YouTubePremiumIcon /><span>YOUTUBE</span></a>
      {item.storeUrl ? <a className="is-store" href={item.storeUrl} target="_blank" rel="noreferrer"><SparkPremiumIcon /><span>APPLE MUSIC</span></a> : null}
      <button type="button" className="is-deleteSmall" disabled={removing} aria-label={removing ? `Removing ${item.title}` : `Remove ${item.title} from Saved Songs`} title={removing ? "Removing" : "Remove from Saved Songs"} onClick={() => onDelete(item)}><ClosePremiumIcon /><span>{removing ? "REMOVING" : "DELETE"}</span></button>
    </div>
  </motion.article>;
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

const ENRICHMENT_STAGE_ORDER: Array<{ key: Exclude<EnrichmentVisualStage, "idle" | "complete">; label: string }> = [
  { key: "identifying", label: "IDENTIFY" },
  { key: "metadata", label: "METADATA" },
  { key: "artwork", label: "ARTWORK" },
  { key: "artist_dna", label: "ARTIST DNA" },
  { key: "song_dna", label: "SONG DNA" },
  { key: "audio_intelligence", label: "AUDIO" },
  { key: "saving", label: "SAVE" },
];

function visualStageFromIntelligence(stage: MusicIntelligenceStage): EnrichmentVisualStage {
  if (stage === "identity") return "identifying";
  if (stage === "artist_dna") return "artist_dna";
  if (stage === "song_dna") return "song_dna";
  if (stage === "audio_intelligence") return "audio_intelligence";
  if (stage === "saving") return "saving";
  return "complete";
}

function intelligenceStatusLabel(item: MusicTrackIntelligence | null) {
  if (!item) return "NOT ANALYZED";
  if (item.status === "processing") return "DEEP ANALYSIS RUNNING";
  if (item.status === "failed") return "NEEDS RETRY";
  if (item.status === "stale") return "UPDATE AVAILABLE";
  if (item.status === "partial") return "INTELLIGENCE READY";
  return "ANALYZED";
}

function dnaValue(value: number | null | undefined) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : 0;
}

function readCollectionView(key: string, fallback: CollectionView = "grid8"): CollectionView {
  if (typeof window === "undefined") return fallback;
  const value = window.localStorage.getItem(key);
  return value === "list" || value === "grid4" || value === "grid8" || value === "grid16" ? value : fallback;
}


const R52_MUSIC_TABS: Array<{ key: MusicTab; label: string }> = [
  { key: "songs", label: "SONGS" },
  { key: "artists", label: "ARTISTS" },
  { key: "albums", label: "ALBUMS" },
  { key: "playlists", label: "PLAYLISTS" },
  { key: "smart", label: "SMART MIX" },
  { key: "intelligence", label: "INTELLIGENCE" },
  { key: "discover", label: "DISCOVER" },
  { key: "audition", label: "AUDITION" },
];

function R52TabGlyph({ tab }: { tab: MusicTab }) {
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (tab === "songs") return <svg {...common}><path d="M9 18V5l10-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>;
  if (tab === "artists") return <svg {...common}><circle cx="12" cy="8" r="3"/><path d="M5.5 20c.9-4.2 3.1-6.2 6.5-6.2s5.6 2 6.5 6.2"/></svg>;
  if (tab === "albums") return <svg {...common}><rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/></svg>;
  if (tab === "playlists") return <svg {...common}><path d="M4 7h10M4 12h10M4 17h7"/><path d="M17 10v8"/><path d="M17 10l3-1v7"/><circle cx="15.5" cy="18" r="1.5"/><circle cx="18.5" cy="16" r="1.5"/></svg>;
  if (tab === "smart") return <svg {...common}><path d="M12 3l1.5 4.1L18 8.5l-4.5 1.4L12 14l-1.5-4.1L6 8.5l4.5-1.4L12 3Z"/><path d="M5 15l.8 2.2L8 18l-2.2.8L5 21l-.8-2.2L2 18l2.2-.8L5 15Z"/></svg>;
  if (tab === "intelligence") return <svg {...common}><path d="M9 4a3 3 0 0 0-3 3v1a3 3 0 0 0-2 2.8A3.2 3.2 0 0 0 7.2 14H9V4Z"/><path d="M15 4a3 3 0 0 1 3 3v1a3 3 0 0 1 2 2.8A3.2 3.2 0 0 1 16.8 14H15V4Z"/><path d="M9 8h6M9 12h6M9 16c0 2 1.1 4 3 4s3-2 3-4"/></svg>;
  if (tab === "discover") return <svg {...common}><circle cx="12" cy="12" r="8"/><path d="m15 9-2 4-4 2 2-4 4-2Z"/></svg>;
  return <svg {...common}><path d="M5 7h14M7 4v6M17 4v6"/><path d="M6 13h12v7H6z"/><path d="m10 15 4 2-4 2v-4Z"/></svg>;
}

function R52MusicTabs({ value, onChange }: { value: MusicTab; onChange: (value: MusicTab) => void }) {
  return <nav className="tr52-tabs" aria-label="Music library sections">
    {R52_MUSIC_TABS.map((item) => {
      const active = item.key === value;
      return <motion.button
        key={item.key}
        type="button"
        data-music-tab={item.key}
        className={active ? "is-active" : ""}
        aria-current={active ? "page" : undefined}
        onClick={() => onChange(item.key)}
        whileTap={{ scale: .97 }}
        transition={{ type: "spring", stiffness: 620, damping: 42, mass: .28 }}
      >
        <span className="tr52-tabIcon"><R52TabGlyph tab={item.key} /></span>
        <span className="tr52-tabLabel">{item.label}</span>
        {active ? <motion.i layoutId="tr52-tab-active" transition={{ type: "spring", stiffness: 520, damping: 38 }} /> : null}
      </motion.button>;
    })}
  </nav>;
}

/* MVP_R12_5E_37_PRO_MUSIC_UI: dedicated native mobile navigation, no Motion hit layer. */
function R37MobileMusicTabs({ value, onChange }: { value: MusicTab; onChange: (value: MusicTab) => void }) {
  return <nav className="tr37-mobileTabs" aria-label="Music library sections">
    {R52_MUSIC_TABS.map((item) => {
      const active = item.key === value;
      return <button
        key={item.key}
        type="button"
        data-music-tab={item.key}
        className={active ? "is-active" : ""}
        aria-current={active ? "page" : undefined}
        onClick={() => onChange(item.key)}
      >
        <span className="tr52-tabIcon"><R52TabGlyph tab={item.key} /></span>
        <span className="tr52-tabLabel">{item.label}</span>
      </button>;
    })}
  </nav>;
}

/* MVP_R40_PRO_LIBRARY_FINAL: one contained energy component for desktop, mobile and playlists. */
function R38EnergyBadge({ level, onClick, title = "Energy" }: { level: MusicEnergyLevel; onClick?: () => void; title?: string }) {
  const content = <><span className="tr40-energyDot" aria-hidden /><span className="tr40-energyLabel">{level.toUpperCase()}</span></>;
  if (onClick) return <button type="button" className={`tr38-energyBadge tr40-energyBadge is-${level}`} onClick={onClick} title={title}>{content}</button>;
  return <span className={`tr38-energyBadge tr40-energyBadge is-${level}`} title={title}>{content}</span>;
}

function R52MoreIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>;
}

function R52PlayingGlyph() {
  return <svg className="tr52-playingGlyph" viewBox="0 0 24 24" aria-hidden><rect x="5" y="9" width="3" height="10" rx="1.5"/><rect x="10.5" y="5" width="3" height="14" rx="1.5"/><rect x="16" y="7" width="3" height="12" rx="1.5"/></svg>;
}

function R56TrashGlyph() {
  return <svg className="tr56-trashGlyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="m7 7 1 13h8l1-13"/><path d="M10 11v5M14 11v5"/></svg>;
}


/* MVP_TRAINER_R41_OCCURRENCE_SKIP_AND_MOBILE_SONG_ROOT_FIX */
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
  // MVP_R12_5E_36_MOBILE_MANAGE_MODES
  const [mobileSelectMode, setMobileSelectMode] = useState(false);
  const [mobileReorderMode, setMobileReorderMode] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedSongIds, setSelectedSongIds] = useState<Set<string>>(new Set());
  const [openSongMenuId, setOpenSongMenuId] = useState<string | null>(null);
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
  const [detailIntelligence, setDetailIntelligence] = useState<MusicTrackIntelligence | null>(null);
  const [detailIntelligenceBusy, setDetailIntelligenceBusy] = useState(false);
  const detailSessionRef = useRef(0);
  const detailLookupRequestRef = useRef(0);
  const detailIntelligenceRequestRef = useRef(0);
  const [playlistModalTrackIds, setPlaylistModalTrackIds] = useState<string[]>([]);
  const [playlistModalSelections, setPlaylistModalSelections] = useState<Set<string>>(new Set());
  const [playlistModalName, setPlaylistModalName] = useState("");
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [reviewTrackId, setReviewTrackId] = useState<string | null>(null);
  const [reviewSelectedCandidateId, setReviewSelectedCandidateId] = useState<string | null>(null);
  const [reviewSavedIds, setReviewSavedIds] = useState<Set<string>>(new Set());
  const [reviewSkippedIds, setReviewSkippedIds] = useState<Set<string>>(new Set());
  const [smartMinutes, setSmartMinutes] = useState(60);
  const [smartCustom, setSmartCustom] = useState(false);
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
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState | null>(null);
  const uploadHideTimerRef = useRef<number | null>(null);
  const messageTimerRef = useRef<number | null>(null);
  const enrichmentCompletionTimerRef = useRef<number | null>(null);
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
  const [enrichment, setEnrichmentState] = useState<EnrichmentState>({
    running: false, open: false, minimized: false, current: 0, total: 0, completed: 0, libraryTotal: 0, skipped: 0, matched: 0, review: 0, notFound: 0, failed: 0, intelligenceComplete: 0,
    metadataUpdated: 0, artworkUpdated: 0, intelligenceUpdated: 0,
    label: "LIBRARY INTELLIGENCE", serviceMessage: "Ready to enrich your music library.", stage: "idle", currentTrackId: null, failedTrackIds: [], activity: [],
  });
  const enrichmentRef = useRef(enrichment);
  const enrichmentFlushTimerRef = useRef<number | null>(null);
  const setEnrichment = (update: EnrichmentState | ((current: EnrichmentState) => EnrichmentState)) => {
    const previous = enrichmentRef.current;
    const next = typeof update === "function" ? update(previous) : update;
    enrichmentRef.current = next;

    const immediate =
      previous.running !== next.running ||
      previous.open !== next.open ||
      previous.minimized !== next.minimized ||
      next.stage === "complete";

    if (immediate) {
      if (enrichmentFlushTimerRef.current !== null) {
        window.clearTimeout(enrichmentFlushTimerRef.current);
        enrichmentFlushTimerRef.current = null;
      }
      setEnrichmentState(next);
      return;
    }

    if (enrichmentFlushTimerRef.current !== null) return;
    // Enrichment can emit several stage callbacks for one song. Rendering the
    // entire My Music tree for every callback starves the player/DSP animation
    // loop. The panel still feels live, while background scans update at a much
    // lower cost.
    const delay = next.minimized ? 650 : 120;
    enrichmentFlushTimerRef.current = window.setTimeout(() => {
      enrichmentFlushTimerRef.current = null;
      setEnrichmentState(enrichmentRef.current);
    }, delay);
  };

  useEffect(() => () => {
    if (enrichmentFlushTimerRef.current !== null) window.clearTimeout(enrichmentFlushTimerRef.current);
    if (uploadHideTimerRef.current !== null) window.clearTimeout(uploadHideTimerRef.current);
    if (messageTimerRef.current !== null) window.clearTimeout(messageTimerRef.current);
    if (enrichmentCompletionTimerRef.current !== null) window.clearTimeout(enrichmentCompletionTimerRef.current);
  }, []);

  function showTemporaryMessage(text: string, durationMs = 1900) {
    if (messageTimerRef.current !== null) window.clearTimeout(messageTimerRef.current);
    setMessage(text);
    messageTimerRef.current = window.setTimeout(() => {
      messageTimerRef.current = null;
      setMessage("");
    }, durationMs);
  }

  function hideUploadProgressAfter(delayMs = 2200) {
    if (uploadHideTimerRef.current !== null) window.clearTimeout(uploadHideTimerRef.current);
    uploadHideTimerRef.current = window.setTimeout(() => {
      uploadHideTimerRef.current = null;
      setUploadProgress(null);
    }, delayMs);
  }

  useEffect(() => {
    if (enrichmentCompletionTimerRef.current !== null) {
      window.clearTimeout(enrichmentCompletionTimerRef.current);
      enrichmentCompletionTimerRef.current = null;
    }
    if (enrichment.running || enrichment.stage !== "complete") return;

    // A minimized/background enrichment completion is a brief acknowledgement,
    // not a permanent button state. The detailed panel remains untouched if the
    // user is actively looking at it.
    if (enrichment.minimized || !enrichment.open) {
      enrichmentCompletionTimerRef.current = window.setTimeout(() => {
        enrichmentCompletionTimerRef.current = null;
        setEnrichment((current) => {
          if (current.running || current.open) return current;
          return {
            ...current,
            minimized: false,
            stage: "idle",
            label: "LIBRARY INTELLIGENCE",
            serviceMessage: "Ready to enrich your music library.",
          };
        });
      }, 2200);
    }
  }, [enrichment.running, enrichment.stage, enrichment.minimized, enrichment.open]);

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
  const detailIntelligenceForTrack = detailTrack && detailIntelligence?.trackId === detailTrack.id ? detailIntelligence : null;

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

    const batch = Array.from(files);
    const totalSteps = batch.length * 3;
    if (uploadHideTimerRef.current !== null) {
      window.clearTimeout(uploadHideTimerRef.current);
      uploadHideTimerRef.current = null;
    }
    if (messageTimerRef.current !== null) {
      window.clearTimeout(messageTimerRef.current);
      messageTimerRef.current = null;
    }

    setUploading(true);
    setMessage("");
    setError("");
    setUploadProgress({
      visible: true,
      status: "active",
      stage: "uploading",
      currentFile: 1,
      totalFiles: batch.length,
      completedSteps: 0,
      totalSteps,
      fileName: batch[0]?.name || "Music file",
      displayName: batch[0]?.name || "Music file",
      intelligenceReady: 0,
      summary: "Starting secure music import…",
    });

    try {
      let order = tracks.length;
      let intelligenceReady = 0;

      for (let index = 0; index < batch.length; index += 1) {
        const file = batch[index];
        const currentFile = index + 1;
        const stepBase = index * 3;

        setUploadProgress((current) => ({
          ...(current || {
            visible: true, status: "active", stage: "uploading", currentFile, totalFiles: batch.length, completedSteps: stepBase, totalSteps, fileName: file.name, displayName: file.name, intelligenceReady, summary: "",
          }),
          visible: true,
          status: "active",
          stage: "uploading",
          currentFile,
          totalFiles: batch.length,
          completedSteps: stepBase,
          totalSteps,
          fileName: file.name,
          displayName: file.name,
          intelligenceReady,
          summary: "Uploading to your private music library…",
        }));

        let uploaded = await uploadMusicTrack(file, order++);

        setUploadProgress((current) => current ? ({
          ...current,
          stage: "enriching",
          completedSteps: stepBase + 1,
          displayName: uploaded.title || file.name,
          summary: "Finding the best song info and artwork…",
        }) : current);

        try {
          if (needsMusicMetadata(uploaded) || needsMusicArtwork(uploaded)) {
            const result = await enrichMusicTrack(uploaded, { autoApplyThreshold: 0.98 });
            uploaded = result.track;
          }

          setUploadProgress((current) => current ? ({
            ...current,
            stage: "analyzing",
            completedSteps: stepBase + 2,
            displayName: uploaded.title || file.name,
            summary: "Building Song DNA and Artist DNA…",
          }) : current);

          await analyzeMusicTrackIntelligence(uploaded);
          intelligenceReady += 1;
        } catch (analysisError) {
          console.warn("Automatic music intelligence enrichment will retry from Enrich Library:", analysisError);
        }

        setUploadProgress((current) => current ? ({
          ...current,
          stage: "analyzing",
          completedSteps: stepBase + 3,
          intelligenceReady,
          summary: currentFile < batch.length ? "Song ready • moving to the next file…" : "Finishing library refresh…",
        }) : current);
      }

      await refreshTracks();
      await loadMusicLibrary(true);

      const summary = `${batch.length} song${batch.length === 1 ? "" : "s"} uploaded • ${intelligenceReady} intelligence profile${intelligenceReady === 1 ? "" : "s"} ready`;
      setUploadProgress((current) => current ? ({
        ...current,
        status: "success",
        stage: "complete",
        currentFile: batch.length,
        completedSteps: totalSteps,
        intelligenceReady,
        summary,
      }) : current);
      hideUploadProgressAfter(2200);
    } catch (caught) {
      const raw = caught instanceof Error ? caught.message : "Music upload failed.";
      const friendly = /unsupported|audio type|file type/i.test(raw)
        ? "THIS AUDIO FORMAT IS NOT SUPPORTED FOR UPLOAD"
        : raw;
      setError(friendly);
      setUploadProgress((current) => current ? ({
        ...current,
        status: "error",
        summary: friendly,
      }) : current);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function uploadAuditionSong(file: File, auditionSong: MusicAuditionSong) {
    if (messageTimerRef.current !== null) { window.clearTimeout(messageTimerRef.current); messageTimerRef.current = null; }
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
      try {
        setMessage(`Analyzing ${auditionSong.title} intelligence…`);
        await analyzeMusicTrackIntelligence(uploaded);
      } catch (analysisError) {
        console.warn("Audition import intelligence will retry from Enrich Library:", analysisError);
      }
      await refreshTracks();
      await loadMusicLibrary(true);
      showTemporaryMessage(`${auditionSong.title} added to your music library.`);
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

  function draftFromTrack(track: MusicTrack) {
    return {
      title: track.title,
      artist: track.artist || "",
      album: track.album || "",
      releaseYear: track.release_year ? String(track.release_year) : "",
      genre: track.genre || "",
    };
  }

  function updateDetailDraftField(
    trackId: string,
    field: keyof DraftMap[string],
    value: string,
    invalidateLookup = false
  ) {
    setDrafts((current) => ({
      ...current,
      [trackId]: { ...current[trackId], [field]: value },
    }));

    if (invalidateLookup) {
      detailLookupRequestRef.current += 1;
      setDetailCandidates([]);
      setDetailSelectedCandidateId(null);
      setDetailPendingCandidate(null);
      setDetailSaveState("idle");
      setDetailStatusText("");
    }
  }

  useEffect(() => {
    if (!openSongMenuId) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element) {
        const menu = target.closest(".tr52-more");
        if (menu?.getAttribute("data-song-menu-id") === openSongMenuId) return;
      }
      setOpenSongMenuId(null);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpenSongMenuId(null); };
    const onScroll = () => setOpenSongMenuId(null);
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [openSongMenuId]);

  useEffect(() => { setOpenSongMenuId(null); }, [tab, page]);

  function openDetail(track: MusicTrack) {
    setOpenSongMenuId(null);
    const sessionId = ++detailSessionRef.current;
    detailLookupRequestRef.current += 1;
    const intelligenceRequestId = ++detailIntelligenceRequestRef.current;

    // Every song gets a clean editor workspace. Unsaved state, search results,
    // staged artwork and async responses from the previous song cannot leak in.
    setDrafts((current) => ({ ...current, [track.id]: draftFromTrack(track) }));
    setDetailTrackId(track.id);
    setDetailMode("edit");
    setDetailCandidates([]);
    setDetailSelectedCandidateId(null);
    setDetailPendingCandidate(null);
    setDetailSaveState("idle");
    setDetailStatusText("");
    setDetailIntelligence(null);
    setDetailIntelligenceBusy(false);

    void getMusicTrackIntelligence(track.id)
      .then((value) => {
        if (
          detailSessionRef.current !== sessionId ||
          detailIntelligenceRequestRef.current !== intelligenceRequestId
        ) return;
        setDetailIntelligence(value);
      })
      .catch(() => undefined);
  }

  function closeDetail() {
    detailSessionRef.current += 1;
    detailLookupRequestRef.current += 1;
    detailIntelligenceRequestRef.current += 1;
    setDetailTrackId(null);
    setDetailMode("edit");
    setDetailCandidates([]);
    setDetailSelectedCandidateId(null);
    setDetailPendingCandidate(null);
    setDetailSaveState("idle");
    setDetailStatusText("");
    setDetailIntelligence(null);
    setDetailIntelligenceBusy(false);
  }

  async function refreshDetailIntelligence(track: MusicTrack, force = false) {
    if (detailIntelligenceBusy) return;
    const sessionId = detailSessionRef.current;
    const requestId = ++detailIntelligenceRequestRef.current;
    const isCurrent = () =>
      detailSessionRef.current === sessionId &&
      detailIntelligenceRequestRef.current === requestId;

    setDetailIntelligenceBusy(true);
    setDetailSaveState("idle");
    setDetailStatusText(force ? "Reanalyzing Song DNA and Artist DNA…" : "Building Song DNA and Artist DNA…");
    try {
      const intelligence = await analyzeMusicTrackIntelligence(track, {
        force,
        onStage: (_stage, detail) => { if (isCurrent()) setDetailStatusText(detail); },
      });
      if (!isCurrent()) return;
      setDetailIntelligence(intelligence);
      setDetailStatusText(intelligence.status === "processing" ? "MVP Intelligence ready • deep audio analysis continues in the background." : "MVP Intelligence analyzed ✓");
    } catch (caught) {
      if (!isCurrent()) return;
      setDetailSaveState("error");
      setDetailStatusText(caught instanceof Error ? caught.message : "Could not analyze this song.");
    } finally {
      if (isCurrent()) setDetailIntelligenceBusy(false);
    }
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
      showTemporaryMessage("Song info saved ✓");
      await markMusicTrackIntelligenceStale(updated.id).catch(() => undefined);
      void analyzeMusicTrackIntelligence(updated, { force: true }).then((value) => setDetailIntelligence(value)).catch(() => undefined);
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
    try { await removeMusicTrack(track.id); closeDetail(); await refreshTracks(); showTemporaryMessage("Song deleted."); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not delete song."); }
    finally { setBusyId(null); }
  }

  async function findDetailMatches(track: MusicTrack, mode: "info_results" | "artwork_results") {
    const sessionId = detailSessionRef.current;
    const requestId = ++detailLookupRequestRef.current;
    const isCurrent = () =>
      detailSessionRef.current === sessionId &&
      detailLookupRequestRef.current === requestId;

    const draft = drafts[track.id] || draftFromTrack(track);
    const lookupTrack: MusicTrack = {
      ...track,
      // Find Song Info searches what is on screen RIGHT NOW. The user does not
      // need to save a corrected artist/title and reopen the editor first.
      title: draft.title.trim() || track.title,
      artist: draft.artist.trim() || null,
      album: draft.album.trim() || null,
      release_year: draft.releaseYear.trim() ? Number(draft.releaseYear) || null : null,
      genre: draft.genre.trim() || null,
    };

    let diagnostics: MusicLookupDiagnostics = {
      rawCandidates: 0,
      acceptedCandidates: 0,
      returnedCandidates: 0,
      reason: "no_catalog_results",
    };

    setDetailMode(mode);
    setDetailSaveState("searching");
    setDetailStatusText(
      mode === "artwork_results"
        ? `Searching artwork for ${lookupTrack.artist ? `${lookupTrack.artist} • ` : ""}${lookupTrack.title}…`
        : `Searching for ${lookupTrack.artist ? `${lookupTrack.artist} • ` : ""}${lookupTrack.title}…`
    );
    setDetailCandidates([]);
    setDetailSelectedCandidateId(null);

    try {
      const candidates = await findMusicMetadataCandidates(lookupTrack, {
        includeLowConfidence: true,
        onDiagnostics: (info) => { diagnostics = info; },
        onRetry: ({ status, delayMs }) => {
          if (!isCurrent()) return;
          setDetailStatusText(
            `Lookup service busy${status ? ` (${status})` : ""} • retrying automatically in ${Math.max(1, Math.ceil(delayMs / 1000))}s…`
          );
        },
      });

      if (!isCurrent()) return;

      setDetailCandidates(candidates);
      setDetailSelectedCandidateId(candidates[0]?.sourceId || null);
      setDetailSaveState("idle");

      const best = candidates[0];
      const verifiedResults = diagnostics.reason === "matches";

      if (mode === "info_results" && best && verifiedResults && best.confidence >= 0.86) {
        // High-confidence identification stages metadata + the ranked official
        // artwork in the editor. Nothing is written until SAVE CHANGES.
        setDrafts((current) => ({
          ...current,
          [track.id]: {
            title: best.title,
            artist: best.artist,
            album: best.album,
            releaseYear: best.releaseYear ? String(best.releaseYear) : "",
            genre: best.genre || "",
          },
        }));
        setDetailPendingCandidate(best);
        setDetailMode("edit");
        setDetailSaveState("idle");
        setDetailStatusText(
          `Best match loaded • ${Math.round(best.confidence * 100)}%${best.artworkUrl ? " • HIGH-RES ART READY" : ""} • Review and SAVE CHANGES.`
        );
        return;
      }

      if (candidates.length) {
        if (diagnostics.reason === "low_confidence") {
          setDetailStatusText(
            `${candidates.length} possible catalog result${candidates.length === 1 ? "" : "s"} found • confidence is too low for automatic changes • choose manually.`
          );
        } else {
          setDetailStatusText(
            `${candidates.length} match${candidates.length === 1 ? "" : "es"} found • Best ${Math.round(candidates[0].confidence * 100)}%`
          );
        }
      } else if (diagnostics.reason === "low_confidence") {
        setDetailStatusText(
          "Catalog results were returned, but none matched the current artist/title strongly enough. Correct either field and search again."
        );
      } else {
        setDetailStatusText(
          "No catalog results were returned for the current artist/title. Check the spelling or try the title with the artist corrected."
        );
      }
    } catch (caught) {
      if (!isCurrent()) return;
      setDetailSaveState("error");
      setDetailStatusText(caught instanceof Error ? caught.message : "Music lookup failed.");
    }
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
    setError("");
    setMessage("");
    setReviewItems([]);
    setReviewTrackId(null);
    setReviewSelectedCandidateId(null);
    setReviewSavedIds(new Set());
    setReviewSkippedIds(new Set());

    let intelligenceMap = new Map<string, MusicTrackIntelligence>();
    if (!artworkOnly && targets.length) {
      intelligenceMap = await hydrateMusicIntelligenceCache(targets).catch(() => new Map<string, MusicTrackIntelligence>());
    }

    const metadataNeedsWork = (track: MusicTrack) =>
      needsMusicMetadata(track) ||
      trackNeedsArtwork(track) ||
      track.metadata_status === "unknown" ||
      track.metadata_status === "review" ||
      !track.metadata_updated_at;

    const intelligenceNeedsWork = (track: MusicTrack) => {
      const existing = intelligenceMap.get(track.id) || null;
      return !isMusicIntelligenceCurrent(existing) ||
        existing?.status === "processing" ||
        existing?.status === "stale" ||
        existing?.status === "failed" ||
        !existing?.bpm ||
        !existing?.keySignature;
    };

    const work = artworkOnly
      ? targets.filter(trackNeedsArtwork)
      : targets.filter((track) => metadataNeedsWork(track) || intelligenceNeedsWork(track));
    const skipped = Math.max(0, targets.length - work.length);
    const initialActivity: EnrichmentActivity[] = skipped
      ? [{ id: `skip-${Date.now()}`, tone: "ok", text: `${skipped} song${skipped === 1 ? "" : "s"} already complete`, detail: "Verified metadata, artwork and current V3 intelligence protected • skipped" }]
      : [];

    if (!work.length) {
      setEnrichment({
        running: false, open: true, minimized: false, current: 0, total: 0, completed: 0, libraryTotal: targets.length, skipped,
        matched: 0, review: 0, notFound: 0, failed: 0, intelligenceComplete: artworkOnly ? 0 : skipped,
        metadataUpdated: 0, artworkUpdated: 0, intelligenceUpdated: 0,
        label: artworkOnly ? "ARTWORK ALREADY COMPLETE" : "LIBRARY ALREADY COMPLETE",
        serviceMessage: artworkOnly ? "Every selected song already has protected artwork." : "No missing or outdated song information was found. Nothing was rescanned.",
        stage: "complete", currentTrackId: null, failedTrackIds: [], activity: initialActivity,
      });
      return;
    }

    let matched = 0;
    let review = 0;
    let notFound = 0;
    let failed = 0;
    let intelligenceComplete = 0;
    let metadataUpdated = 0;
    let artworkUpdated = 0;
    let intelligenceUpdated = 0;
    const failedTrackIds: string[] = [];
    const reviewQueue: ReviewItem[] = [];
    let activity: EnrichmentActivity[] = [...initialActivity];

    const addActivity = (tone: EnrichmentActivity["tone"], text: string, detail: string) => {
      const entry = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, tone, text, detail };
      activity = [entry, ...activity].slice(0, 8);
      setEnrichment((current) => ({ ...current, activity }));
    };

    setEnrichment({
      running: true, open: true, minimized: false, current: 0, total: work.length, completed: 0, libraryTotal: targets.length, skipped,
      matched: 0, review: 0, notFound: 0, failed: 0, intelligenceComplete: 0,
      metadataUpdated: 0, artworkUpdated: 0, intelligenceUpdated: 0,
      label: artworkOnly ? "FINDING MISSING ARTWORK" : "ENRICHING MUSIC LIBRARY",
      serviceMessage: artworkOnly
        ? `${skipped} already complete • ${work.length} artwork check${work.length === 1 ? "" : "s"} needed.`
        : `${skipped} already complete • ${work.length} song${work.length === 1 ? "" : "s"} need missing or outdated information.`,
      stage: "identifying", currentTrackId: null, failedTrackIds: [], activity,
    });

    try {
      for (let index = 0; index < work.length; index += 1) {
        const originalTrack = work[index];
        let track = originalTrack;
        const currentNumber = index + 1;
        const identity = [artistLabel(track), track.title].filter(Boolean).join(" • ");
        let metadataChangedThisTrack = false;
        let artworkChangedThisTrack = false;
        let intelligenceUpdatedThisTrack = false;

        setEnrichment((current) => ({
          ...current, current: currentNumber, label: artworkOnly ? `FINDING ARTWORK • ${track.title}` : `ENRICHING • ${track.title}`,
          serviceMessage: identity, stage: "identifying", currentTrackId: track.id, matched, review, notFound, failed, intelligenceComplete,
          metadataUpdated, artworkUpdated, intelligenceUpdated, failedTrackIds: [...failedTrackIds],
        }));

        try {
          const metadataNeeded = artworkOnly || metadataNeedsWork(track);
          if (metadataNeeded) {
            const beforeMetadata = [track.title, track.artist || "", track.album || "", track.release_year || "", track.genre || "", track.metadata_status || ""].join("\u0001");
            const beforeArtwork = [track.artwork_path || "", track.external_artwork_url || ""].join("\u0001");
            setEnrichment((current) => ({ ...current, stage: artworkOnly ? "artwork" : "metadata", serviceMessage: artworkOnly ? `Searching missing artwork • ${identity}` : `Checking only missing song info • ${identity}` }));
            const result = await enrichMusicTrack(track, {
              artworkOnly,
              autoApplyThreshold: 0.98,
              onLookupRetry: ({ status, attempt, delayMs }) => {
                setEnrichment((current) => ({
                  ...current, stage: artworkOnly ? "artwork" : "metadata",
                  serviceMessage: `Catalog busy${status ? ` (${status})` : ""} • retry ${attempt} in ${Math.max(1, Math.ceil(delayMs / 1000))}s`,
                }));
              },
            });
            track = result.track;
            replaceTrackLocally(track);
            const afterMetadata = [track.title, track.artist || "", track.album || "", track.release_year || "", track.genre || "", track.metadata_status || ""].join("\u0001");
            const afterArtwork = [track.artwork_path || "", track.external_artwork_url || ""].join("\u0001");
            metadataChangedThisTrack = beforeMetadata !== afterMetadata;
            artworkChangedThisTrack = beforeArtwork !== afterArtwork;
            if (metadataChangedThisTrack) metadataUpdated += 1;
            if (artworkChangedThisTrack) artworkUpdated += 1;
            if (result.status === "matched") matched += 1;
            else if (result.status === "review") {
              review += 1;
              if (result.candidates.length) reviewQueue.push({ trackId: track.id, candidates: result.candidates });
            } else if (result.status === "not_found") notFound += 1;
            setEnrichment((current) => ({ ...current, stage: "artwork", serviceMessage: trackNeedsArtwork(track) ? "Artwork is still missing • existing good data remains protected." : "Artwork ready ✓" }));
          } else {
            matched += 1;
            setEnrichment((current) => ({ ...current, stage: "artwork", serviceMessage: "Verified song info and artwork skipped ✓" }));
          }

          if (!artworkOnly) {
            const existing = intelligenceMap.get(track.id) || null;
            let intelligence = existing;
            const intelligenceNeeded = metadataChangedThisTrack || intelligenceNeedsWork(track);
            if (intelligenceNeeded) {
              intelligence = await analyzeMusicTrackIntelligence(track, {
                force: true,
                onStage: (stage, detail) => {
                  setEnrichment((current) => ({ ...current, stage: visualStageFromIntelligence(stage), serviceMessage: detail }));
                },
              });
              intelligenceUpdatedThisTrack = true;
              intelligenceUpdated += 1;
            } else {
              setEnrichment((current) => ({ ...current, stage: "song_dna", serviceMessage: "Current V3 Song DNA, BPM and Key protected ✓" }));
            }
            if (intelligence) {
              intelligenceMap.set(track.id, intelligence);
              if (isMusicIntelligenceCurrent(intelligence) && intelligence.bpm && intelligence.keySignature) intelligenceComplete += 1;
            }
          }

          setEnrichment((current) => ({ ...current, stage: "saving", serviceMessage: "Saving only the fields that changed…" }));
          const changes = [
            metadataChangedThisTrack ? "song info updated" : "",
            artworkChangedThisTrack ? "artwork updated" : "",
            intelligenceUpdatedThisTrack ? "V3 intelligence updated" : "",
          ].filter(Boolean);
          addActivity(
            reviewQueue.some((item) => item.trackId === track.id) ? "review" : "ok",
            `${track.title} • ${artistLabel(track)}`,
            changes.length ? changes.join(" • ") : (artworkOnly ? "Artwork checked • protected existing data" : "Missing fields checked • current data protected"),
          );
        } catch (caught) {
          failed += 1;
          failedTrackIds.push(track.id);
          const detail = caught instanceof Error ? caught.message : `Could not enrich ${track.title}.`;
          addActivity("error", `${track.title} • ${artistLabel(track)}`, detail);
        }

        setEnrichment((current) => ({
          ...current, completed: currentNumber, current: currentNumber, matched, review, notFound, failed, intelligenceComplete,
          metadataUpdated, artworkUpdated, intelligenceUpdated, failedTrackIds: [...failedTrackIds],
        }));
        if (index < work.length - 1) await delayMusicLookup(artworkOnly ? 180 : 1250);
      }

      await refreshTracks();
      setReviewItems(reviewQueue);
      setEnrichment((current) => ({
        ...current,
        running: false,
        open: current.minimized ? false : true,
        minimized: current.minimized,
        current: work.length,
        completed: work.length,
        total: work.length,
        libraryTotal: targets.length,
        skipped,
        matched,
        review,
        notFound,
        failed,
        intelligenceComplete,
        metadataUpdated,
        artworkUpdated,
        intelligenceUpdated,
        label: artworkOnly ? "ARTWORK SCAN COMPLETE" : "LIBRARY ENRICHMENT COMPLETE",
        serviceMessage: failed
          ? `${failed} song${failed === 1 ? "" : "s"} can be retried. ${skipped} complete song${skipped === 1 ? " was" : "s were"} never rescanned.`
          : reviewQueue.length
            ? `${reviewQueue.length} possible metadata match${reviewQueue.length === 1 ? "" : "es"} need review. ${skipped} complete song${skipped === 1 ? " was" : "s were"} skipped.`
            : `${skipped} already complete • ${work.length} song${work.length === 1 ? "" : "s"} checked only where information was missing or outdated.`,
        stage: "complete",
        currentTrackId: null,
        failedTrackIds: [...failedTrackIds],
        activity,
      }));

      if (!reviewQueue.length) {
        showTemporaryMessage(`${work.length - failed} updated or checked • ${skipped} already complete${failed ? ` • ${failed} retry` : ""}.`, 2200);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not finish library enrichment.");
      setEnrichment((current) => ({ ...current, running: false, open: current.minimized ? false : true, stage: "complete" }));
    }
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
      setReviewSavedIds((current) => new Set(current).add(reviewTrack.id)); showTemporaryMessage("Correct song information saved ✓");
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
      await refreshPlaylists(preferred || selectedPlaylistId); setPlaylistModalTrackIds([]); setPlaylistModalSelections(new Set()); setPlaylistModalName(""); setSelectedSongIds(new Set()); showTemporaryMessage("Playlist routing updated."); window.dispatchEvent(new Event(PLAYLISTS_CHANGED_EVENT));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not update playlists."); }
    finally { setBusyId(null); }
  }
  async function createPlaylist() {
    if (!newPlaylistName.trim()) return;
    try { const created = await createMusicPlaylist(newPlaylistName.trim()); setNewPlaylistName(""); await refreshPlaylists(created.id); setSelectedPlaylistId(created.id); showTemporaryMessage("Playlist created."); window.dispatchEvent(new Event(PLAYLISTS_CHANGED_EVENT)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create playlist."); }
  }
  async function removePlaylist(playlist: MusicPlaylist) {
    if (!window.confirm(`Delete playlist “${playlist.name}”? Your songs remain in the library.`)) return;
    try { await deleteMusicPlaylist(playlist.id); await refreshPlaylists(null); showTemporaryMessage("Playlist deleted. Songs were not deleted."); window.dispatchEvent(new Event(PLAYLISTS_CHANGED_EVENT)); }
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
      showTemporaryMessage(`${name} rebuilt and playing • ${mix.length} songs.`);
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
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches) return;
    const activeButton = tabNavRef.current?.querySelector<HTMLElement>(`[data-music-tab="${tab}"]`);
    if (!activeButton) return;
    activeButton.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [tab]);

  useEffect(() => { try { window.localStorage.setItem("mvp_music_artist_view_v1", artistView); } catch {} }, [artistView]);
  useEffect(() => { try { window.localStorage.setItem("mvp_music_album_view_v1", albumView); } catch {} }, [albumView]);

  const averageTrackSeconds = tracks.length ? tracks.reduce((sum, track) => sum + Math.max(120, Number(track.duration_seconds || 210)), 0) / tracks.length : 210;
  const smartEstimatedSongs = Math.max(1, Math.round((smartMinutes * 60) / averageTrackSeconds));
  const smartEligibleCount = tracks.filter((track) => !track.play_less).length;
  const uploadPercent = uploadProgress
    ? Math.max(0, Math.min(100, Math.round((uploadProgress.completedSteps / Math.max(1, uploadProgress.totalSteps)) * 100)))
    : 0;
  const uploadStageLabel = uploadProgress?.status === "success"
    ? "UPLOAD COMPLETE"
    : uploadProgress?.status === "error"
      ? "UPLOAD NEEDS ATTENTION"
      : uploadProgress?.stage === "enriching"
        ? "MATCHING SONG INFO"
        : uploadProgress?.stage === "analyzing"
          ? "BUILDING INTELLIGENCE"
          : "UPLOADING";

  function goBack() { if (navigate) navigate("/"); else window.location.pathname = "/"; }

  return (
    <main data-mvp-music="flagship" className={`tr10-page tr10-premiumLibrary tr10-premium-${tab}`}><StableMusicLibraryVisualEngine activeTab={tab} playing={Boolean(player.playing)} />
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
            <button type="button" className={`tr44-enrichLauncher${enrichment.running ? " is-running" : ""}${enrichment.minimized && enrichment.stage === "complete" ? " is-complete" : ""}`} onClick={(event) => { if (!event.nativeEvent.isTrusted) return; if (enrichment.running || enrichment.minimized) setEnrichment((current) => ({ ...current, open: true, minimized: false })); else void enrichTracks(tracks); }}>{enrichment.running ? `ENRICHING ${enrichment.completed}/${enrichment.total}` : enrichment.minimized && enrichment.stage === "complete" ? "ENRICHMENT COMPLETE" : "ENRICH LIBRARY"}</button>
            <button type="button" className="is-orange" disabled={uploading} aria-busy={uploading} onClick={(event) => { if (!event.nativeEvent.isTrusted) return; inputRef.current?.click(); }}>+ UPLOAD SONGS</button>
          </div>
        </header>

        <section className="tr10-statusPanel" aria-label="Library status filters">
          <div className="tr10-statusPanelHead"><span>LIBRARY STATUS</span></div>
          <div className="tr10-healthRail">
            <button className={healthFilter === "all" ? "is-active" : ""} onClick={() => setHealthFilter("all")}><span>ALL SONGS</span><b>{tracks.length}</b></button>
            <button className={`${healthFilter === "needs_info" ? "is-active " : ""}is-needs`} onClick={() => setHealthFilter("needs_info")}><span>NEEDS INFO</span><b>{needsInfoCount}</b></button>
            <button className={`${healthFilter === "missing_art" ? "is-active " : ""}is-art`} onClick={() => setHealthFilter("missing_art")}><span>MISSING ART</span><b>{missingArtCount}</b></button>
            <button className={`${healthFilter === "liked" ? "is-active " : ""}is-liked`} onClick={() => setHealthFilter("liked")}><span>LIKED</span><b>{likedCount}</b></button>
            <button className={`${healthFilter === "review" ? "is-active " : ""}is-review`} onClick={() => setHealthFilter("review")}><span>REVIEW</span><b>{Math.max(reviewCount, reviewRemainingCount)}</b></button>
          </div>
        </section>

        <div ref={tabNavRef} className="tr52-tabRail tr37-desktopTabRail"><R52MusicTabs value={tab} onChange={(value) => { setTab(value); setCollectionDetail(null); setMobileSelectMode(false); setMobileReorderMode(false); setSelectedSongIds(new Set()); if (value === "discover") setDiscoveryView("archive"); }} /></div>
        <div className="tr37-mobileTabRail"><R37MobileMusicTabs value={tab} onChange={(value) => { setTab(value); setCollectionDetail(null); setMobileSelectMode(false); setMobileReorderMode(false); setSelectedSongIds(new Set()); if (value === "discover") setDiscoveryView("archive"); }} /></div>

        {uploadProgress?.visible ? <motion.section
          className={`tr66-uploadRail is-${uploadProgress.status}`}
          role={uploadProgress.status === "error" ? "alert" : "status"}
          aria-live="polite"
          initial={{ opacity: 0, y: -6, scaleY: .96 }}
          animate={{ opacity: 1, y: 0, scaleY: 1 }}
          transition={{ duration: .24, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="tr66-uploadTop">
            <span className="tr66-uploadPulse" aria-hidden><i /><i /><i /></span>
            <div className="tr66-uploadIdentity">
              <strong>{uploadStageLabel}</strong>
              <span title={uploadProgress.fileName}>{uploadProgress.status === "success" ? uploadProgress.summary : uploadProgress.displayName}</span>
              {uploadProgress.status !== "success" ? <small>{uploadProgress.summary}</small> : null}
            </div>
            <div className="tr66-uploadNumbers">
              <strong>{uploadProgress.status === "success" ? "DONE" : `${uploadProgress.currentFile} / ${uploadProgress.totalFiles}`}</strong>
              <span>{uploadPercent}%</span>
            </div>
          </div>
          <div className="tr66-uploadTrack" aria-hidden>
            <motion.i initial={false} animate={{ scaleX: uploadPercent / 100 }} transition={{ type: "spring", stiffness: 190, damping: 28 }} />
            <b style={{ left: `${uploadPercent}%` }} />
          </div>
        </motion.section> : null}

        {/* MVP_ENRICH_COMPLETION_HIDDEN_V25 */ message && !/(updated or checked|already complete)/i.test(message) ? <motion.div className="tr10-message" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>{message}</motion.div> : null}
        {error ? <div className="tr10-error">{error}</div> : null}

        {tab === "songs" ? <>
          <div className="m37-toolbar tr10-toolbar tr40-songToolbar">
            <label><span>SEARCH</span><input value={songSearch} onChange={(event) => setSongSearch(event.target.value)} placeholder="Song, artist, album, or file…" /></label>
            <div className="tr52-energyFilter" role="group" aria-label="Energy filter"><span>ENERGY</span><div>{(["all","low","medium","high"] as EnergyFilter[]).map((level) => <button key={level} type="button" className={`is-${level}${energyFilter === level ? " is-active" : ""}`} aria-pressed={energyFilter === level} onClick={() => setEnergyFilter(level)}>{level === "all" ? "ALL" : level.toUpperCase()}</button>)}</div></div>
            <MusicPremiumSelect label="SORT" value={songSort} onChange={(next) => setSongSort(next as SongSort)} options={(["library","recently_added","title_asc","title_desc","artist_asc","artist_desc","album_asc","most_played","recently_played","high_rotation","least_played","most_skipped","longest","shortest","energy_high","energy_low"] as SongSort[]).map((sort) => ({ value: sort, label: songSortLabel(sort) }))} />
            <MusicPremiumSelect label="SHOW" value={pageSize} onChange={(next) => setPageSize(Number(next) as PageSize)} options={[{value:12,label:"12"},{value:24,label:"24"},{value:48,label:"48"}]} />
            <div className="tr36-mobileManage" aria-label="Mobile song list controls">
              <button type="button" className={mobileSelectMode ? "is-active" : ""} aria-pressed={mobileSelectMode} onClick={() => { setMobileSelectMode((current) => { const next = !current; if (next) setMobileReorderMode(false); if (!next) setSelectedSongIds(new Set()); return next; }); }}>SELECT</button>
              <button type="button" className={mobileReorderMode ? "is-active" : ""} aria-pressed={mobileReorderMode} onClick={() => { setMobileReorderMode((current) => { const next = !current; if (next) { setMobileSelectMode(false); setSelectedSongIds(new Set()); } return next; }); }}>ORDER</button>
            </div>
          </div>

          {selectedCount ? <div className="tr10-bulk"><strong>{selectedCount} SELECTED</strong><div><button onClick={() => openPlaylistModal([...selectedSongIds])}>+ PLAYLIST</button><button onClick={() => void enrichTracks(tracks.filter((track) => selectedSongIds.has(track.id)))}>IDENTIFY</button><button onClick={() => void enrichTracks(tracks.filter((track) => selectedSongIds.has(track.id)), true)}>FIND ART</button><button onClick={() => setSelectedSongIds(new Set())}>CLEAR</button></div></div> : null}

          <div className={`m37-songTable tr10-table tr37-desktopSongTable tr40-desktopSongTable is-list${mobileSelectMode ? " is-mobile-selecting" : ""}${mobileReorderMode ? " is-mobile-reordering" : ""}`}>
            <div className="tr10-tableHead tr38-desktopSongHead tr40-desktopSongHead">
              <span className="tr10-trackHead">TRACK</span><span className="tr10-energyHead">ENERGY</span><span className="tr10-timeHead">TIME</span><span className="tr10-actionsHead">ACTIONS</span>
            </div>
            {loading ? <div className="tr10-empty">Loading your music…</div> : null}
            {!loading && !pagedTracks.length ? <div className="tr10-empty">No songs match this view.</div> : null}
            {pagedTracks.map((track) => {
              const current = player.currentTrack?.id === track.id;
              const needsInfo = needsMusicMetadata(track);
              const missingArt = trackNeedsArtwork(track);
              const reorderIndex = libraryOrderIndex.get(track.id) ?? -1;
              return <article className={`tr10-row tr40-desktopSongRow ${current ? "is-current" : ""}`} key={track.id}>
                <div className="tr10-orderCell" aria-label="Reorder song">
                  <button type="button" aria-label={`Move ${track.title} up`} disabled={reorderIndex <= 0} onClick={() => moveTrack(track.id,-1)}><ChevronUpPremiumIcon /></button>
                  <button type="button" aria-label={`Move ${track.title} down`} disabled={reorderIndex < 0 || reorderIndex >= libraryOrderedTracks.length - 1} onClick={() => moveTrack(track.id,1)}><ChevronDownPremiumIcon /></button>
                </div>
                <label className="tr10-check"><input type="checkbox" checked={selectedSongIds.has(track.id)} onChange={() => toggleSongSelection(track.id)} /></label>
                <div className="tr10-trackCell">
                  <button className={`tr10-play ${current && player.playing ? "is-playing" : ""}`} onClick={() => void toggleTrackPlayback(track)} aria-label={`${current && player.playing ? "Pause" : "Play"} ${track.title}`}>{current && player.playing ? <R52PlayingGlyph /> : <PlayPremiumIcon />}</button>
                  <TrackArtwork track={track} />
                  <div className="tr10-trackText tr40-trackText"><strong title={track.title}>{track.title}</strong><div className="tr40-trackMeta" title={[artistLabel(track), track.album].filter(Boolean).join(" • ")}><span className="tr40-trackArtist">{artistLabel(track)}</span>{track.album ? <><i aria-hidden>•</i><span className="tr40-trackAlbum">{track.album}</span></> : null}</div><small>{track.original_name}</small>{playbackErrors[track.id] ? <em className="tr10-playbackError">{playbackErrors[track.id]}</em> : null}</div>
                  {needsInfo ? <em className="tr10-healthBadge is-needs">NEEDS INFO</em> : missingArt ? <em className="tr10-healthBadge is-art">MISSING ART</em> : null}
                </div>
                <R38EnergyBadge level={track.energy_level} title="Click to change energy" onClick={() => void setEnergy(track, track.energy_level === "low" ? "medium" : track.energy_level === "medium" ? "high" : "low")} />
                <span className="tr10-duration">{formatDuration(track.duration_seconds)}</span>
                <div className="tr38-desktopSongActions tr40-desktopSongActions">
                  <button type="button" className={`is-like${track.favorite ? " is-active" : ""}`} aria-label={track.favorite ? `Unlike ${track.title}` : `Like ${track.title}`} aria-pressed={track.favorite} title={track.favorite ? "Liked" : "Like"} onClick={() => void changePreference(track, track.favorite ? "neutral" : "like")}><HeartPremiumIcon filled={track.favorite} /></button>
                  <button type="button" className={`is-less${track.play_less ? " is-active" : ""}`} aria-label={track.play_less ? `Play ${track.title} normally` : `Play ${track.title} less`} aria-pressed={track.play_less} title="Play less" onClick={() => void changePreference(track, track.play_less ? "neutral" : "play_less")}><PlayLessPremiumIcon /></button>
                  <details
                    className="tr52-more tr38-desktopMore"
                    data-song-menu-id={track.id}
                    open={openSongMenuId === track.id}
                    onToggle={(event) => {
                      const isOpen = event.currentTarget.open;
                      setOpenSongMenuId((current) => isOpen ? track.id : current === track.id ? null : current);
                    }}
                  >
                    <summary aria-label={`More actions for ${track.title}`} title="More actions"><R52MoreIcon /></summary>
                    <div className="tr52-moreMenu">
                      <button type="button" onClick={() => { playMusicNext(track.id); setOpenSongMenuId(null); }}><NextPremiumIcon /><span>PLAY NEXT</span></button>
                      <button type="button" onClick={() => { addMusicToQueue(track.id); setOpenSongMenuId(null); }}><QueuePremiumIcon /><span>ADD TO QUEUE</span></button>
                      <button type="button" onClick={() => { openPlaylistModal([track.id]); setOpenSongMenuId(null); }}><PlaylistPremiumIcon /><span>ADD TO PLAYLIST</span></button>
                      <button type="button" onClick={() => { setOpenSongMenuId(null); openDetail(track); }}><EditPremiumIcon /><span>EDIT SONG</span></button>
                    </div>
                  </details>
                </div>
              </article>;
            })}
          </div>

          <div className={`tr41-mobileSongList${mobileSelectMode ? " is-selecting" : ""}${mobileReorderMode ? " is-reordering" : ""}`} aria-label="Songs">
            {loading ? <div className="tr38-mobileSongEmpty">Loading your music…</div> : null}
            {!loading && !pagedTracks.length ? <div className="tr38-mobileSongEmpty">No songs match this view.</div> : null}
            {pagedTracks.map((track) => {
              const current = player.currentTrack?.id === track.id;
              const reorderIndex = libraryOrderIndex.get(track.id) ?? -1;
              const needsInfo = needsMusicMetadata(track);
              const missingArt = trackNeedsArtwork(track);
              return <article className={`tr41-mobileSongRow${current ? " is-current" : ""}${current && player.playing ? " is-playing" : ""}`} key={`mobile-${track.id}`}>
                {mobileSelectMode ? <label className="tr41-mobileSelect"><input type="checkbox" checked={selectedSongIds.has(track.id)} onChange={() => toggleSongSelection(track.id)} /></label> : null}
                {mobileReorderMode ? <div className="tr41-mobileReorder" aria-label="Reorder song"><button type="button" aria-label={`Move ${track.title} up`} disabled={reorderIndex <= 0} onClick={() => moveTrack(track.id,-1)}><ChevronUpPremiumIcon /></button><button type="button" aria-label={`Move ${track.title} down`} disabled={reorderIndex < 0 || reorderIndex >= libraryOrderedTracks.length - 1} onClick={() => moveTrack(track.id,1)}><ChevronDownPremiumIcon /></button></div> : null}
                <div className="tr41-mobileSongArt">
                  <TrackArtwork track={track} />
                  <button type="button" className={`tr41-mobileSongPlay${current && player.playing ? " is-playing" : ""}`} onClick={() => void toggleTrackPlayback(track)} aria-label={`${current && player.playing ? "Pause" : "Play"} ${track.title}`}>{current && player.playing ? <R52PlayingGlyph /> : <PlayPremiumIcon />}</button>
                </div>
                <div className="tr41-mobileSongCopy">
                  <strong title={track.title}>{track.title}</strong>
                  <div className="tr41-mobileSongSub" title={[artistLabel(track), track.album].filter(Boolean).join(" • ")}><span className="tr41-mobileSongArtist">{artistLabel(track)}</span>{track.album ? <><i aria-hidden>•</i><span className="tr41-mobileSongAlbum">{track.album}</span></> : null}</div>
                  <div className="tr41-mobileSongMeta"><b>{formatDuration(track.duration_seconds)}</b><R38EnergyBadge level={track.energy_level} title="Change energy" onClick={() => void setEnergy(track, track.energy_level === "low" ? "medium" : track.energy_level === "medium" ? "high" : "low")} />{needsInfo ? <mark>NEEDS INFO</mark> : missingArt ? <mark>MISSING ART</mark> : null}</div>
                </div>
                <div className="tr41-mobileSongActions">
                  <button type="button" className={`is-like${track.favorite ? " is-active" : ""}`} aria-label={track.favorite ? `Unlike ${track.title}` : `Like ${track.title}`} aria-pressed={track.favorite} onClick={() => void changePreference(track, track.favorite ? "neutral" : "like")}><HeartPremiumIcon filled={track.favorite} /></button>
                  <button type="button" className={`is-less${track.play_less ? " is-active" : ""}`} aria-label={track.play_less ? `Play ${track.title} normally` : `Play ${track.title} less`} aria-pressed={track.play_less} onClick={() => void changePreference(track, track.play_less ? "neutral" : "play_less")}><PlayLessPremiumIcon /></button>
                  <details
                    className="tr52-more tr41-mobileMore"
                    data-song-menu-id={track.id}
                    open={openSongMenuId === track.id}
                    onToggle={(event) => {
                      const isOpen = event.currentTarget.open;
                      setOpenSongMenuId((current) => isOpen ? track.id : current === track.id ? null : current);
                    }}
                  >
                    <summary aria-label={`More actions for ${track.title}`} title="More actions"><R52MoreIcon /></summary>
                    <div className="tr52-moreMenu">
                      <button type="button" onClick={() => { playMusicNext(track.id); setOpenSongMenuId(null); }}><NextPremiumIcon /><span>PLAY NEXT</span></button>
                      <button type="button" onClick={() => { addMusicToQueue(track.id); setOpenSongMenuId(null); }}><QueuePremiumIcon /><span>ADD TO QUEUE</span></button>
                      <button type="button" onClick={() => { openPlaylistModal([track.id]); setOpenSongMenuId(null); }}><PlaylistPremiumIcon /><span>ADD TO PLAYLIST</span></button>
                      <button type="button" onClick={() => { setOpenSongMenuId(null); openDetail(track); }}><EditPremiumIcon /><span>EDIT SONG</span></button>
                    </div>
                  </details>
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
          <div className={`m37-collectionGrid tr10-cardGrid tr34-collectionGrid is-${artistView}`}>{artistGroups.map(([artist,songs]) => {
            const artistListPlaying = artistView === "list" && player.playing && !player.activePlaylistId && player.activePlaylistName === artist && Boolean(player.currentTrack?.id) && songs.some((track) => track.id === player.currentTrack?.id);
            return <article className="tr10-collectionCard" key={artist}>
              <button type="button" className="tr10-collectionOpen" onClick={() => setCollectionDetail({ kind: "artist", artist })} aria-label={`Open ${artist}`} title={artist}><TrackArtwork track={songs[0]} size="card" /><div><small>ARTIST</small><h3>{artist}</h3><p>{songs.length} SONG{songs.length === 1 ? "" : "S"} • {formatLongDuration(songs.reduce((sum,track) => sum + Number(track.duration_seconds || 0),0))}</p></div></button>
              <button type="button" className={`tr10-collectionPlay ${artistListPlaying ? "is-playing" : ""}`} onClick={() => { if (artistListPlaying) pauseMusic(); else void playMusicAdHocQueue(artist,songs); }} aria-label={artistListPlaying ? `Pause ${artist}` : `Play ${artist}`}>{artistListPlaying ? <R52PlayingGlyph /> : <PlayPremiumIcon />}<span>{artistListPlaying ? "PLAYING" : "PLAY"}</span></button>
            </article>;
          })}</div>
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
          <div className={`m37-collectionGrid tr10-cardGrid tr34-collectionGrid is-${albumView}`}>{albumGroups.map((group) => {
            const albumQueueName = `Album • ${group.album}`;
            const albumListPlaying = albumView === "list" && player.playing && !player.activePlaylistId && player.activePlaylistName === albumQueueName && Boolean(player.currentTrack?.id) && group.tracks.some((track) => track.id === player.currentTrack?.id);
            return <article className="tr10-collectionCard" key={`${group.artist}-${group.album}`}>
              <button type="button" className="tr10-collectionOpen" onClick={() => setCollectionDetail({ kind: "album", artist: group.artist, album: group.album })} aria-label={`Open ${group.album}`} title={`${group.album} • ${group.artist}`}><TrackArtwork track={group.tracks[0]} size="card" /><div><small>ALBUM</small><h3>{group.album}</h3><p>{group.artist} • {group.tracks.length} SONG{group.tracks.length === 1 ? "" : "S"}</p></div></button>
              <button type="button" className={`tr10-collectionPlay ${albumListPlaying ? "is-playing" : ""}`} onClick={() => { if (albumListPlaying) pauseMusic(); else void playMusicAdHocQueue(albumQueueName,group.tracks); }} aria-label={albumListPlaying ? `Pause ${group.album}` : `Play ${group.album}`}>{albumListPlaying ? <R52PlayingGlyph /> : <PlayPremiumIcon />}<span>{albumListPlaying ? "PLAYING" : "PLAY"}</span></button>
            </article>;
          })}</div>
        </section> : null}

        {tab === "playlists" ? <>
          <section className="m37-playlists tr21-playlists tr56-playlists tr38-desktopPlaylists">
          <aside className="tr21-playlistDock tr56-playlistDock">
            <div className="tr21-playlistDockHead"><span>PLAYLIST DIRECTORY</span><b>{regularPlaylists.length}</b></div>
            <div className="tr21-createPlaylist"><input value={newPlaylistName} onChange={(event) => setNewPlaylistName(event.target.value)} placeholder="Name a new playlist" onKeyDown={(event) => { if (event.key === "Enter") void createPlaylist(); }} /><button type="button" onClick={() => void createPlaylist()} aria-label="Create playlist"><span aria-hidden>+</span></button></div>
            <div className="tr21-playlistChoices">{regularPlaylists.map((playlist) => { const count=(playlistTrackIds[playlist.id] || []).length; const active=selectedPlaylistId === playlist.id; return <motion.button type="button" key={playlist.id} className={active ? "is-active" : ""} aria-pressed={active} onClick={() => setSelectedPlaylistId(playlist.id)} whileTap={{scale:.985}}><span className="tr56-playlistChoiceIcon"><PlaylistPremiumIcon /></span><span className="tr56-playlistChoiceCopy"><strong>{playlist.name}</strong><small>{count} SONG{count===1?"":"S"}</small></span><em aria-hidden>›</em></motion.button>; })}</div>
          </aside>
          <section className="tr21-playlistStage tr56-playlistStage">{selectedPlaylist ? <>
            <header className="tr21-playlistHero tr56-playlistHero">
              <div className="tr21-playlistArt">{selectedPlaylistTracks[0] ? <TrackArtwork track={selectedPlaylistTracks[0]} size="card" /> : <span>♫</span>}<i aria-hidden /></div>
              <div className="tr21-playlistHeroCopy"><small>MVP COLLECTION</small><h2>{selectedPlaylist.name}</h2><p>{selectedPlaylistTracks.length ? `${selectedPlaylistTracks.length} tracks curated from your private library.` : "This collection is ready for its first tracks."}</p><div className="tr21-playlistMetrics"><span><b>{selectedPlaylistTracks.length}</b><small>TRACKS</small></span><span><b>{formatLongDuration(selectedPlaylistDurationSeconds)}</b><small>PLAY TIME</small></span><span><b>{selectedPlaylistHighEnergy}</b><small>HIGH ENERGY</small></span><span><b>{selectedPlaylistLiked}</b><small>LIKED</small></span></div></div>
              <div className="m37-playlistActions tr21-playlistHeroActions tr56-playlistHeroActions"><motion.button type="button" className="is-play" disabled={!selectedPlaylistTracks.length} onClick={() => void playSelectedPlaylist()} whileTap={{scale:.97}}><PlayPremiumIcon /><strong>PLAY</strong></motion.button><motion.button type="button" className="is-shuffle" disabled={!selectedPlaylistTracks.length} onClick={() => void playCollectionShuffle(`Playlist • ${selectedPlaylist.name}`, selectedPlaylistTracks)} whileTap={{scale:.97}}><ShufflePremiumIcon /><strong>MIX</strong></motion.button><motion.button type="button" className="is-export" disabled={!selectedPlaylistTracks.length} onClick={openBurnStudio} whileTap={{scale:.97}}><SparkPremiumIcon /><strong>EXPORT</strong></motion.button><motion.button type="button" className="is-delete" onClick={() => void removePlaylist(selectedPlaylist)} aria-label={`Delete ${selectedPlaylist.name}`} whileTap={{scale:.97}}><R56TrashGlyph /><strong>DELETE</strong></motion.button></div>
            </header>
            <div className="tr21-playlistRailHead tr56-playlistRailHead"><div><span>TRACKS</span><strong>{selectedPlaylistTracks.length} SONG{selectedPlaylistTracks.length===1?"":"S"}</strong></div><button type="button" disabled={!selectedSongIds.size} onClick={() => openPlaylistModal([...selectedSongIds])}><PlaylistPremiumIcon /><strong>ADD SELECTED</strong>{selectedSongIds.size ? <span>{selectedSongIds.size}</span> : null}</button></div>
            <div className="tr21-playlistTracks tr56-playlistTracks">{selectedPlaylistTracks.length ? selectedPlaylistTracks.map((track,index) => { const isPlaying=player.currentTrack?.id===track.id && player.playing; return <article key={track.id} className={player.currentTrack?.id===track.id ? "is-current" : ""}><span className="tr21-trackNumber">{String(index+1).padStart(2,"0")}</span><TrackArtwork track={track} /><div className="tr21-playlistTrackCopy"><strong>{track.title}</strong><span>{artistLabel(track)}{track.album ? ` • ${track.album}` : ""}</span></div><span className="tr21-playlistDuration">{formatDuration(track.duration_seconds)}</span><span className={`tr21-playlistEnergy is-${track.energy_level}`}><i />{track.energy_level.toUpperCase()}</span><div className="tr21-playlistTrackActions"><button type="button" className={`is-trackPlay ${isPlaying ? "is-playing" : ""}`} onClick={() => { if (isPlaying) pauseMusic(); else void playSelectedPlaylist(track.id); }} aria-label={isPlaying ? `Pause ${track.title}` : `Play ${track.title}`}>{isPlaying ? <R52PlayingGlyph /> : <PlayPremiumIcon />}</button><button type="button" disabled={index===0} onClick={() => { const next=[...selectedPlaylistTracks]; [next[index-1],next[index]]=[next[index],next[index-1]]; void savePlaylistOrder(next); }} aria-label={`Move ${track.title} up`}><ChevronUpPremiumIcon /></button><button type="button" disabled={index===selectedPlaylistTracks.length-1} onClick={() => { const next=[...selectedPlaylistTracks]; [next[index+1],next[index]]=[next[index],next[index+1]]; void savePlaylistOrder(next); }} aria-label={`Move ${track.title} down`}><ChevronDownPremiumIcon /></button><button type="button" className="is-remove" onClick={() => void savePlaylistOrder(selectedPlaylistTracks.filter((item) => item.id !== track.id))} aria-label={`Remove ${track.title} from ${selectedPlaylist.name}`}><R56TrashGlyph /><span>REMOVE</span></button></div></article>; }) : <div className="tr21-playlistEmpty"><b>EMPTY COLLECTION</b><span>Select songs in the Songs tab, then route them here.</span></div>}</div>
          </> : <div className="tr21-playlistEmpty is-stage"><b>BUILD YOUR FIRST COLLECTION</b><span>Create a playlist on the left to turn your library into a dedicated listening collection.</span></div>}</section>
        </section>
          <section className="tr38-mobilePlaylists tr40-mobilePlaylists" aria-label="Playlists">
          <header className="tr38-mobilePlaylistDirectory">
            <div><span>PLAYLIST DIRECTORY</span><b>{regularPlaylists.length}</b></div>
            <div className="tr38-mobilePlaylistCreate"><input value={newPlaylistName} onChange={(event) => setNewPlaylistName(event.target.value)} placeholder="New playlist" onKeyDown={(event) => { if (event.key === "Enter") void createPlaylist(); }} /><button type="button" onClick={() => void createPlaylist()} aria-label="Create playlist">+</button></div>
          </header>
          <div className="tr38-mobilePlaylistChoices">{regularPlaylists.map((playlist) => { const count=(playlistTrackIds[playlist.id] || []).length; const active=selectedPlaylistId === playlist.id; return <button type="button" key={`mobile-playlist-${playlist.id}`} className={active ? "is-active" : ""} aria-pressed={active} onClick={() => setSelectedPlaylistId(playlist.id)}><PlaylistPremiumIcon /><span><strong>{playlist.name}</strong><small>{count} SONG{count===1?"":"S"}</small></span></button>; })}</div>
          {selectedPlaylist ? <section className="tr38-mobilePlaylistStage">
            <header className="tr38-mobilePlaylistHero">
              <div className="tr38-mobilePlaylistArt">{selectedPlaylistTracks[0] ? <TrackArtwork track={selectedPlaylistTracks[0]} size="card" /> : <span>♫</span>}</div>
              <div className="tr38-mobilePlaylistIdentity"><small>PLAYLIST</small><h2>{selectedPlaylist.name}</h2><p>{selectedPlaylistTracks.length} track{selectedPlaylistTracks.length===1?"":"s"} • {formatLongDuration(selectedPlaylistDurationSeconds)}</p></div>
              <div className="tr38-mobilePlaylistHeroActions">
                <button type="button" className="is-play" disabled={!selectedPlaylistTracks.length} onClick={() => void playSelectedPlaylist()}><PlayPremiumIcon /><span>PLAY</span></button>
                <button type="button" className="is-mix" disabled={!selectedPlaylistTracks.length} onClick={() => void playCollectionShuffle(`Playlist • ${selectedPlaylist.name}`, selectedPlaylistTracks)}><ShufflePremiumIcon /><span>MIX</span></button>
                <details className="tr38-mobilePlaylistMore"><summary aria-label={`More actions for ${selectedPlaylist.name}`}><R52MoreIcon /></summary><div><button type="button" disabled={!selectedPlaylistTracks.length} onClick={openBurnStudio}><SparkPremiumIcon /><span>EXPORT</span></button><button type="button" className="is-delete" onClick={() => void removePlaylist(selectedPlaylist)}><R56TrashGlyph /><span>DELETE PLAYLIST</span></button></div></details>
              </div>
            </header>
            <div className="tr38-mobilePlaylistTrackHead"><span>TRACKS</span><strong>{selectedPlaylistTracks.length}</strong></div>
            <div className="tr38-mobilePlaylistTracks">{selectedPlaylistTracks.length ? selectedPlaylistTracks.map((track,index) => { const current=player.currentTrack?.id===track.id; const isPlaying=current && player.playing; return <article key={`mobile-playlist-track-${track.id}`} className={current ? "is-current" : ""}>
              <div className="tr38-mobilePlaylistTrackArt"><TrackArtwork track={track} /><button type="button" className={isPlaying ? "is-playing" : ""} onClick={() => { if (isPlaying) pauseMusic(); else void playSelectedPlaylist(track.id); }} aria-label={isPlaying ? `Pause ${track.title}` : `Play ${track.title}`}>{isPlaying ? <R52PlayingGlyph /> : <PlayPremiumIcon />}</button></div>
              <div className="tr38-mobilePlaylistTrackText"><strong>{track.title}</strong><span>{artistLabel(track)}</span><small><b>{formatDuration(track.duration_seconds)}</b><R38EnergyBadge level={track.energy_level} /></small></div>
              <details className="tr38-mobilePlaylistTrackMore"><summary aria-label={`More actions for ${track.title}`}><R52MoreIcon /></summary><div><button type="button" disabled={index===0} onClick={() => { const next=[...selectedPlaylistTracks]; [next[index-1],next[index]]=[next[index],next[index-1]]; void savePlaylistOrder(next); }}><ChevronUpPremiumIcon /><span>MOVE UP</span></button><button type="button" disabled={index===selectedPlaylistTracks.length-1} onClick={() => { const next=[...selectedPlaylistTracks]; [next[index+1],next[index]]=[next[index],next[index+1]]; void savePlaylistOrder(next); }}><ChevronDownPremiumIcon /><span>MOVE DOWN</span></button><button type="button" className="is-delete" onClick={() => void savePlaylistOrder(selectedPlaylistTracks.filter((item) => item.id !== track.id))}><R56TrashGlyph /><span>REMOVE</span></button></div></details>
            </article>; }) : <div className="tr38-mobilePlaylistEmpty">This playlist is ready for its first tracks.</div>}</div>
          </section> : <div className="tr38-mobilePlaylistEmpty is-stage">Create a playlist to start a collection.</div>}
        </section>
        </> : null}

        {tab === "smart" ? <motion.section className="m37-smart tr10-smartPremiumV25" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}>
          <header className="m37-smartHead"><div><span>SMART MIX</span><h2>Workout Soundtrack</h2></div><strong>{smartEligibleCount}<small>ELIGIBLE</small></strong></header>
          <section className="m37-smartModes" aria-label="Smart Mix mode">{(["high","balanced","recovery"] as SmartIntensity[]).map((value) => {
            const title = value === "high" ? "Maximum drive" : value === "balanced" ? "Sustained energy" : "Smooth pacing";
            const copy = value === "high" ? "Hard sets and finishers" : value === "balanced" ? "Strong training with more variety" : "Warm-ups, lighter work and cooldowns";
            const dna = value === "high" ? "ENERGY 90  •  HEAVY 82  •  DRIVE 92" : value === "balanced" ? "ENERGY 72  •  HEAVY 62  •  DRIVE 74" : "ENERGY 52  •  MELODIC 72  •  DRIVE 55";
            return <motion.button key={value} type="button" className={smartIntensity===value ? "is-active" : ""} aria-pressed={smartIntensity===value} onClick={() => setSmartIntensity(value)} whileTap={{scale:.975}}><span>{value.toUpperCase()}</span><strong>{title}</strong><p>{copy}</p><small>{dna}</small></motion.button>;
          })}</section>
          <section className="m37-smartLength"><header><span>SESSION LENGTH</span><b>~{smartEstimatedSongs} TRACKS</b></header><div className="m37-smartLengthChoices">{[45,60,75,90].map((minutes) => <motion.button key={minutes} type="button" className={!smartCustom && smartMinutes===minutes ? "is-active" : ""} aria-pressed={!smartCustom && smartMinutes===minutes} onClick={() => {setSmartCustom(false);setSmartMinutes(minutes);}} whileTap={{scale:.97}}><strong>{minutes}</strong><small>MIN</small></motion.button>)}<motion.button type="button" className={smartCustom ? "is-active is-custom" : "is-custom"} aria-pressed={smartCustom} onClick={() => {setSmartCustom(true);if ([45,60,75,90].includes(smartMinutes)) setSmartMinutes(105);}} whileTap={{scale:.97}}><strong>CUSTOM</strong><small>{smartCustom ? `${smartMinutes} MIN` : "SET TIME"}</small></motion.button></div>{smartCustom ? <div className="m37-smartStepper"><motion.button data-smart-motion="v25" whileHover={{ y: -1, scale: 1.01 }} whileTap={{ scale: 0.985 }} transition={{ type: "spring", stiffness: 420, damping: 28 }} type="button" onClick={() => setSmartMinutes((value) => Math.max(15,value-5))}>−</motion.button><strong>{smartMinutes}<small>MIN</small></strong><motion.button data-smart-motion="v25" whileHover={{ y: -1, scale: 1.01 }} whileTap={{ scale: 0.985 }} transition={{ type: "spring", stiffness: 420, damping: 28 }} type="button" onClick={() => setSmartMinutes((value) => Math.min(240,value+5))}>+</motion.button></div> : null}</section>
          <div className="m37-smartInputs"><span>{smartEligibleCount} eligible</span><span>{likedCount} liked</span><span>~{smartEstimatedSongs} tracks</span><span className="is-on">Repeat protection ON</span></div>
          <MvpPrimaryAction className="m37-smartBuild" icon={<SparkPremiumIcon />} onClick={() => void buildAndPlaySmartMix(smartIntensity)}>BUILD {smartIntensity.toUpperCase()} MIX</MvpPrimaryAction>
          <section className="m37-savedMixes"><header><h3>SAVED MIXES</h3><span>{smartMixPlaylists.length} SAVED</span></header><div>{(["high","balanced","recovery"] as SmartIntensity[]).map((mode) => { const name=SMART_MIX_NAMES[mode]; const playlist=smartMixPlaylists.find((item)=>item.name===name); const ids=playlist ? playlistTrackIds[playlist.id] || [] : []; const duration=ids.reduce((sum,id)=>{ const found=tracks.find((track)=>track.id===id); return sum+(found ? trackDuration(found) : 0); },0); return <article key={mode}><div><small>{mode.toUpperCase()}</small><strong>{name}</strong><span>{playlist ? `${ids.length} tracks • ${formatLongDuration(duration)}` : "Not built yet"}</span></div><div>{playlist ? <><motion.button type="button" className="is-play" onClick={() => void playSavedSmartMix(playlist)} whileTap={{scale:.96}}><PlayPremiumIcon /><b>PLAY</b></motion.button><motion.button type="button" className="is-rebuild" onClick={() => {setSmartIntensity(mode);void buildAndPlaySmartMix(mode);}} whileTap={{scale:.96}}><SparkPremiumIcon /><b>REBUILD</b></motion.button></> : <motion.button type="button" className="is-build" onClick={() => {setSmartIntensity(mode);void buildAndPlaySmartMix(mode);}} whileTap={{scale:.96}}><SparkPremiumIcon /><b>BUILD</b></motion.button>}</div></article>; })}</div></section>
        </motion.section> : null}

        {/* MVP_TRAINER_V5_R6_MUSIC_INTELLIGENCE_SUITE: INTELLIGENCE PANEL */}
        {tab === "intelligence" ? (
          <MusicIntelligencePanel tracks={tracks} />
        ) : null}
        {tab === "audition" ? <MusicAuditionPanel tracks={tracks} previewVolume={player.volume} onPreviewStart={() => pauseMusic()} onImportFile={uploadAuditionSong} /> : null}

        {tab === "discover" ? <section className="m37-discover tr10-discover tr63-discover">
          {/* MVP_R12_5E_33_DISCOVER_WORKSPACE_SAVED_SONGS_BANNER */}
          <section className="tr10-radarPanel" aria-label="Discovery Radar">
            <header className="tr10-radarHead">
              <div><span>DISCOVERY RADAR</span><h2>Library Radar</h2></div>
              <div className="tr63-radarTotal"><strong>{discoveryRadar.reduce((sum, lane) => sum + lane.tracks.length, 0)}</strong><span>TRACKS READY</span></div>
            </header>
            <div className="tr10-radarGrid">
              {discoveryRadar.map((lane) => <motion.article key={lane.id} className={lane.tracks.length ? "is-ready" : "is-empty"} whileHover={lane.tracks.length ? { y: -2 } : undefined} transition={{ duration: .18 }}>
                <div className="tr63-radarIdentity"><span className="tr63-radarGlyph"><SparkPremiumIcon /></span><div><small><b>{lane.tracks.length}</b> TRACKS</small><h3>{lane.title}</h3><p>{lane.subtitle}</p></div></div>
                <button type="button" aria-label={`Play ${lane.title}`} disabled={!lane.tracks.length} onClick={() => void playMusicAdHocQueue(`Radar • ${lane.title}`, lane.tracks)}><PlayPremiumIcon /><span>PLAY</span></button>
              </motion.article>)}
            </div>
          </section>

          <header className="tr10-discoverHead">
            <div><span>REDISCOVER</span><h2>{discoveryView === "saved" ? "Saved Songs" : "Discover"}</h2></div>
            <div className="tr10-discoverSummary tr63-discoverSummary"><strong>{discoveryView === "saved" ? savedDiscoverySongs.length : discoveryCount}</strong><div><span>{discoveryView === "saved" ? "SAVED SONGS" : "DISCOVERIES"}</span><small>{discoveryView === "saved" ? `${savedDiscoverySongs.length} TOTAL` : `${discoverySeeds.length} SEED${discoverySeeds.length === 1 ? "" : "S"}`}</small></div></div>
          </header>

          {(discoverySeeds.length || savedDiscoverySongs.length) ? <div className="tr10-discoverArchiveTools">
            <label className="tr10-discoverSearch"><span>{discoveryView === "saved" ? "SEARCH SAVED SONGS" : "SEARCH ARCHIVE"}</span><input value={discoverySearch} onChange={(event) => setDiscoverySearch(event.target.value)} placeholder={discoveryView === "saved" ? "Song, artist, or source" : "Song, artist, or recommendation"} /></label>
            <MusicPremiumSelect className="tr63-discoverySelect" label="SORT" value={discoverySort} onChange={(next) => setDiscoverySort(next as DiscoverySort)} options={[{value:"newest",label:"Newest"},{value:"oldest",label:"Oldest"},{value:"artist",label:"Artist A–Z"},...(discoveryView === "archive" ? [{value:"most" as DiscoverySort,label:"Most discoveries"}] : [])]} />
            <MusicPremiumSelect className="tr63-discoverySelect" label="FILTER" value={discoveryFilter} disabled={discoveryView === "saved"} onChange={(next) => setDiscoveryFilter(next as DiscoveryFilter)} options={[{value:"all",label:discoveryView === "saved" ? "Saved songs" : "All discoveries"},{value:"artist_catalog",label:"Has More From Artist"},{value:"new_current",label:"Has New & Current"},{value:"same_era",label:"Has Same-Era Matches"},{value:"hidden",label:"Has Hidden Gems"},{value:"unowned",label:"Has New-to-You Tracks"}]} />
            <button type="button" className={`tr10-savedSongsButton ${discoveryView === "saved" ? "is-active" : ""}`} aria-pressed={discoveryView === "saved"} onClick={() => setDiscoveryView((current) => current === "saved" ? "archive" : "saved")}><HeartPremiumIcon filled={discoveryView === "saved"} /><span>Saved Songs</span></button>
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
                    <div className="tr10-discoverSeedIdentity"><span className="tr63-seedGlyph"><SparkPremiumIcon /></span><div><small>BASED ON</small><h3>{seed.trackTitle}</h3><p>{seed.trackArtist}{seed.seedYear ? ` • ${seed.seedYear}` : ""}</p><time>{wasRefreshed ? "Updated" : "Rediscovered"} {formatDiscoveryDate(wasRefreshed ? seed.refreshedAt : seed.createdAt)}</time></div></div>
                    <div className="tr10-discoverSeedStats"><strong>{visible.length}</strong><span>DISCOVERIES</span><small>3 CURATED LANES</small></div>
                    <span className="tr10-discoverChevron" aria-hidden>{seedExpanded ? "⌃" : "⌄"}</span>
                  </button>
                  <button type="button" className="tr10-discoverRemove" aria-label={`Remove discovery session for ${seed.trackTitle}`} disabled={removingDiscoverySeedId === seed.id} onClick={() => void (async () => {
                    stopDiscoveryPreview();
                    setRemovingDiscoverySeedId(seed.id);
                    const removed = await removeDiscoverySeed(seed.id);
                    setDiscoverySeeds(listMusicDiscoverySeeds());
                    setExpandedDiscoverySeedIds((current) => { const next = new Set(current); next.delete(seed.id); return next; });
                    setExpandedDiscoveryLaneIds((current) => new Set([...current].filter((key) => !key.startsWith(`${seed.id}|`))));
                    if (!removed) setError("Rediscover was removed from this device, but cloud deletion could not be confirmed. Check your connection and try again.");
                    setRemovingDiscoverySeedId(null);
                  })()}><PlayLessPremiumIcon /><span>{removingDiscoverySeedId === seed.id ? "REMOVING…" : "REMOVE"}</span></button>
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

      {enrichment.open && !enrichment.minimized && typeof document !== "undefined" ? createPortal(<div className="tr10-modalBack tr10-analysisBack tr44-enrichmentBack"><motion.section className="tr10-analysisModal tr44-enrichmentModal" role="dialog" aria-modal="true" aria-live="polite" initial={{ opacity: 0, y: 18, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 30 }}>
        <header className="tr44-enrichmentHeader"><div><span>MVP MUSIC INTELLIGENCE</span><h2>{enrichment.label}</h2><p>{enrichment.serviceMessage}</p></div><div className="tr44-enrichmentHeaderTools"><div className="tr10-analysisCounter"><strong>{enrichment.running ? enrichment.completed : enrichment.libraryTotal}</strong><span>{enrichment.running ? `OF ${enrichment.total}` : "CHECKED"}</span></div><button type="button" onClick={() => { if (!enrichment.running) setMessage(""); setEnrichment((current) => ({ ...current, open: false, minimized: current.running })); }}>{enrichment.running ? "MINIMIZE" : "CLOSE"}</button></div></header>
        <div className="tr44-progressLine"><motion.i initial={false} animate={{ scaleX: enrichment.running ? (enrichment.total ? enrichment.completed / enrichment.total : 0) : 1 }} transition={{ type: "spring", stiffness: 220, damping: 28 }} /></div>
        <div className="tr44-stageRail">{ENRICHMENT_STAGE_ORDER.map((item, index) => { const activeIndex = ENRICHMENT_STAGE_ORDER.findIndex((stage) => stage.key === enrichment.stage); const complete = enrichment.stage === "complete" || (activeIndex >= 0 && index < activeIndex); const active = item.key === enrichment.stage; return <div key={item.key} className={`${complete ? "is-complete " : ""}${active ? "is-active" : ""}`}><i>{complete ? "✓" : index + 1}</i><span>{item.label}</span></div>; })}</div>
        <div className="tr44-enrichmentMetrics"><span><b>{enrichment.completed}</b> COMPLETED</span><span><b>{Math.max(0,enrichment.total-enrichment.completed)}</b> REMAINING</span><span><b>{enrichment.skipped}</b> SKIPPED</span><span><b>{enrichment.intelligenceComplete}</b> DNA READY</span><span><b>{enrichment.review}</b> REVIEW</span><span className={enrichment.failed ? "is-alert" : ""}><b>{enrichment.failed}</b> FAILED</span></div>
        <div className="tr44-enrichmentNow"><span>{enrichment.running ? "NOW PROCESSING" : "SCAN SUMMARY"}</span><strong>{enrichment.running && enrichment.currentTrackId ? tracks.find((track) => track.id === enrichment.currentTrackId)?.title || enrichment.label : enrichment.label}</strong><small>{enrichment.serviceMessage}</small></div>
        {!enrichment.running && enrichment.stage === "complete" ? <div className="tr51-completionSummary" aria-label="Enrichment completion summary"><div><b>{enrichment.libraryTotal}</b><span>SONGS CHECKED</span></div><div><b>{enrichment.skipped}</b><span>ALREADY COMPLETE</span></div><div><b>{enrichment.metadataUpdated}</b><span>SONG INFO UPDATED</span></div><div><b>{enrichment.artworkUpdated}</b><span>ARTWORK UPDATED</span></div><div><b>{enrichment.intelligenceUpdated}</b><span>V3 / AUDIO UPDATED</span></div><div><b>{enrichment.review}</b><span>NEED REVIEW</span></div><div className={enrichment.failed ? "is-alert" : ""}><b>{enrichment.failed}</b><span>FAILED</span></div></div> : null}
        <div className="tr44-activityFeed"><div className="tr44-feedTitle"><span>LIVE ACTIVITY</span><small>{enrichment.running ? "Only songs needing work enter the pipeline" : "Most recent results"}</small></div>{enrichment.activity.length ? enrichment.activity.map((item) => <motion.div key={item.id} className={`is-${item.tone}`} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}><i>{item.tone === "ok" ? "✓" : item.tone === "error" ? "!" : item.tone === "review" ? "?" : "•"}</i><span><strong>{item.text}</strong><small>{item.detail}</small></span></motion.div>) : <div className="tr44-feedEmpty">Checking which library records actually need work…</div>}</div>
        <footer className="tr44-enrichmentFooter"><div><strong>GOOD DATA STAYS PROTECTED</strong><small>Complete records are skipped. MVP searches only missing or outdated song info, artwork and intelligence.</small></div><div>{!enrichment.running && enrichment.failedTrackIds.length ? <button type="button" onClick={() => void enrichTracks(tracks.filter((track) => enrichment.failedTrackIds.includes(track.id)))}>RETRY {enrichment.failedTrackIds.length}</button> : null}<button type="button" className="is-primary" onClick={() => { if (!enrichment.running) setMessage(""); setEnrichment((current) => ({ ...current, open: false, minimized: current.running })); }}>{enrichment.running ? "RUN IN BACKGROUND" : "CLOSE"}</button></div></footer>
      </motion.section></div>, document.body) : null}

      {detailTrack && typeof document !== "undefined" ? createPortal(<div className="tr10-modalBack tr10-detailPortal tr44-detailBack" onMouseDown={closeDetail}><motion.section key={detailTrack.id} className="tr10-inspector tr44-songInspector" role="dialog" aria-modal="true" onMouseDown={(event: MouseEvent<HTMLElement>) => event.stopPropagation()} initial={{ opacity: 0, y: 18, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 320, damping: 32 }}>
        <header className="tr44-songHeader"><div className="tr10-inspectIdentity tr44-songIdentity">{detailPendingCandidate?.artworkUrl ? <img className="tr10-detailPreviewArt" src={detailPendingCandidate.artworkUrl} alt="" /> : <TrackArtwork track={detailTrack} size="detail" />}<div><span>SONG CONTROL</span><h2>{detailDraft?.title || detailTrack.title}</h2><p>{detailDraft?.artist || artistLabel(detailTrack)}{(detailDraft?.album || detailTrack.album) ? ` • ${detailDraft?.album || detailTrack.album}` : ""}</p>{detailMode === "edit" ? <small className={`tr10-editState ${detailSaveState === "changed" ? "is-changed" : detailDirty ? "is-dirty" : ""}`}>{detailSaveState === "saving" ? "SAVING…" : detailSaveState === "changed" ? "SAVED ✓" : detailDirty ? "UNSAVED CHANGES" : "LIBRARY RECORD"}</small> : null}</div></div><button className="tr44-close" onClick={closeDetail} aria-label="Close song control">×</button></header>
        {detailMode === "edit" ? <>
          <div className="tr10-inspectorScroll tr44-inspectorScroll">
            <div className="tr10-inspectCommands tr44-commandRail">
              <motion.button whileHover={{ y: -2 }} whileTap={{ scale: .97 }} disabled={detailSaveState === "searching"} onClick={() => void findDetailMatches(detailTrack,"info_results")}><SparkPremiumIcon /><span>{detailSaveState === "searching" ? "SEARCHING…" : "FIND SONG INFO"}</span></motion.button>
              <motion.button whileHover={{ y: -2 }} whileTap={{ scale: .97 }} disabled={detailSaveState === "searching"} onClick={() => void findDetailMatches(detailTrack,"artwork_results")}><SparkPremiumIcon /><span>FIND ARTWORK</span></motion.button>
              <motion.button whileHover={{ y: -2 }} whileTap={{ scale: .97 }} onClick={() => playMusicNext(detailTrack.id)}><NextPremiumIcon /><span>PLAY NEXT</span></motion.button>
              <motion.button whileHover={{ y: -2 }} whileTap={{ scale: .97 }} onClick={() => addMusicToQueue(detailTrack.id)}><QueuePremiumIcon /><span>ADD TO QUEUE</span></motion.button>
              <motion.button whileHover={{ y: -2 }} whileTap={{ scale: .97 }} className={detailTrack.favorite ? "is-liked" : ""} onClick={() => void changePreference(detailTrack, detailTrack.favorite ? "neutral" : "like")}><HeartPremiumIcon /><span>{detailTrack.favorite ? "LIKED" : "LIKE"}</span></motion.button>
              <motion.button whileHover={{ y: -2 }} whileTap={{ scale: .97 }} className={detailTrack.play_less ? "is-down" : ""} onClick={() => void changePreference(detailTrack, detailTrack.play_less ? "neutral" : "play_less")}><PlayLessPremiumIcon /><span>PLAY LESS</span></motion.button>
            </div>
            {detailStatusText ? <div className={`tr10-detailStatus tr44-detailStatus is-${detailSaveState}`}>{detailStatusText}</div> : null}

            <section className="tr44-recordSection"><div className="tr44-sectionHeading"><div><span>LIBRARY RECORD</span><h3>Song information</h3></div><small>Manual edits stay yours. Find Song Info can stage a verified match before you save.</small></div><div className="tr10-inspectGrid tr44-metadataGrid"><label><span>TITLE</span><input value={drafts[detailTrack.id]?.title || ""} onChange={(event) => updateDetailDraftField(detailTrack.id,"title",event.target.value,true)} /></label><label><span>ARTIST</span><input value={drafts[detailTrack.id]?.artist || ""} onChange={(event) => updateDetailDraftField(detailTrack.id,"artist",event.target.value,true)} /></label><label><span>ALBUM</span><input value={drafts[detailTrack.id]?.album || ""} onChange={(event) => updateDetailDraftField(detailTrack.id,"album",event.target.value)} /></label><label><span>YEAR</span><input inputMode="numeric" value={drafts[detailTrack.id]?.releaseYear || ""} onChange={(event) => updateDetailDraftField(detailTrack.id,"releaseYear",event.target.value)} /></label><label><span>GENRE / STYLE</span><input value={drafts[detailTrack.id]?.genre || ""} onChange={(event) => updateDetailDraftField(detailTrack.id,"genre",event.target.value)} /></label><div className="tr10-artControls tr44-artControls"><input ref={artworkInputRef} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void replaceArtwork(detailTrack,event.target.files?.[0] || null)} /><span>ARTWORK</span><div><button onClick={() => artworkInputRef.current?.click()}>{needsMusicArtwork(detailTrack) ? "+ ADD" : "REPLACE"}</button>{!needsMusicArtwork(detailTrack) ? <button className="is-danger" onClick={() => void clearArtwork(detailTrack)}>REMOVE</button> : null}</div></div></div></section>

            <section className="tr44-intelligenceSection"><div className="tr44-sectionHeading"><div><span>MVP INTELLIGENCE</span><h3>Song DNA + Artist DNA</h3></div><div className={`tr44-intelligenceState is-${detailIntelligenceForTrack?.status || "missing"}`}><i />{intelligenceStatusLabel(detailIntelligenceForTrack)}</div></div>
              {detailIntelligenceForTrack ? <>
                <div className="tr44-intelligenceSummary"><div><strong>{Math.round(detailIntelligenceForTrack.confidence * 100)}%</strong><span>CONFIDENCE</span></div><div><strong>{detailIntelligenceForTrack.bpm ? Math.round(detailIntelligenceForTrack.bpm) : "—"}</strong><span>BPM</span></div><div><strong>{detailIntelligenceForTrack.keySignature || "—"}</strong><span>KEY</span></div><div><strong>V{detailIntelligenceForTrack.analysisVersion}</strong><span>DNA VERSION</span></div><div className="is-source"><strong>{describeMusicIntelligenceSources(detailIntelligenceForTrack)}</strong><span>SOURCES</span></div></div>
                <div className="tr44-dnaGrid">{([
                  ["ENERGY", detailIntelligenceForTrack.songDna.energy], ["HEAVINESS", detailIntelligenceForTrack.songDna.heaviness], ["AGGRESSION", detailIntelligenceForTrack.songDna.aggression], ["DRIVE", detailIntelligenceForTrack.songDna.drive],
                  ["INTENSITY", detailIntelligenceForTrack.songDna.intensity], ["MELODIC", detailIntelligenceForTrack.songDna.melodic], ["ATMOSPHERE", detailIntelligenceForTrack.songDna.atmospheric], ["REFLECTIVE", detailIntelligenceForTrack.songDna.reflective],
                  ["RELAXING", detailIntelligenceForTrack.songDna.relaxing], ["UPLIFTING", detailIntelligenceForTrack.songDna.uplifting], ["DARKNESS", detailIntelligenceForTrack.songDna.darkness], ["WORKOUT FIT", detailIntelligenceForTrack.songDna.workoutFit],
                ] as Array<[string, number]>).map(([label,value]) => <div key={label}><span><b>{label}</b><em>{dnaValue(value)}</em></span><div><motion.i initial={false} animate={{ scaleX: dnaValue(value) / 100 }} transition={{ type: "spring", stiffness: 210, damping: 26 }} /></div></div>)}</div>
                <div className="tr44-intelligenceDetails"><div><span>STYLE</span><strong>{[...detailIntelligenceForTrack.mainGenres,...detailIntelligenceForTrack.subgenres].slice(0,5).join(" • ") || detailTrack.genre || "Analyzed from song + artist context"}</strong></div><div><span>MOOD / CHARACTER</span><strong>{[...detailIntelligenceForTrack.moods,...detailIntelligenceForTrack.characterTags].slice(0,6).join(" • ") || "DNA profile ready"}</strong></div>{detailIntelligenceForTrack.description ? <p>{detailIntelligenceForTrack.description}</p> : null}</div>
              </> : <div className="tr44-intelligenceEmpty"><SparkPremiumIcon /><div><strong>This song has not been through the R44 intelligence pipeline yet.</strong><span>Analyze it now or run Enrich Library to backfill the full collection.</span></div></div>}
              <div className="tr44-intelligenceActions"><button type="button" className="tr44-aiAnalyze" disabled={detailIntelligenceBusy} onClick={() => void refreshDetailIntelligence(detailTrack, Boolean(detailIntelligenceForTrack))}><SparkPremiumIcon /><span>{detailIntelligenceBusy ? "ANALYZING…" : detailIntelligenceForTrack ? "REANALYZE INTELLIGENCE" : "ANALYZE INTELLIGENCE"}</span></button>{detailIntelligenceForTrack?.cyaniteStatus === "processing" ? <small>Deep audio analysis is processing in the background. The current DNA is already usable.</small> : null}</div>
            </section>

            <section className="tr44-historyRail"><div><b>{detailTrack.play_count}</b><span>PLAYS</span></div><div><b>{detailTrack.completed_play_count}</b><span>COMPLETED</span></div><div><b>{detailTrack.skip_count}</b><span>SKIPS</span></div><div><b>{formatDate(detailTrack.last_played_at)}</b><span>LAST PLAYED</span></div><div><b>{detailTrack.metadata_status.toUpperCase()}</b><span>METADATA</span></div><div className="is-file" title={detailTrack.original_name}><b>{detailTrack.original_name}</b><span>FILE</span></div></section>
          </div>
          <footer className="tr44-songFooter"><button onClick={() => openPlaylistModal([detailTrack.id])}><PlaylistPremiumIcon /> PLAYLIST</button><button className="is-danger" disabled={busyId===detailTrack.id} onClick={() => void deleteTrack(detailTrack)}>DELETE</button><button className={`is-primary tr10-saveButton ${detailSaveState === "changed" ? "is-changed" : ""}`} disabled={!detailDirty || detailSaveState === "saving" || detailSaveState === "changed"} onClick={() => void saveTrack(detailTrack)}>{detailSaveState === "saving" ? "SAVING…" : detailSaveState === "changed" ? "SAVED ✓" : "SAVE CHANGES"}</button></footer>
        </> : <>
          <div className="tr10-detailLookup"><div className="tr10-detailLookupHead"><button onClick={() => {setDetailMode("edit");setDetailSelectedCandidateId(null);}}>← BACK TO SONG</button><div><span>{detailMode === "artwork_results" ? "ARTWORK RESULTS" : "SONG MATCH RESULTS"}</span><h3>{detailMode === "artwork_results" ? "Choose the correct cover" : "Choose the correct recording"}</h3><p>{detailStatusText}</p></div></div>
          <div className={`tr10-detailCandidates ${detailMode === "artwork_results" ? "is-artwork" : ""}`}>{detailSaveState === "searching" ? <div className="tr10-reviewLoading">SEARCHING FOR THE BEST MATCHES…</div> : null}{detailCandidates.map((candidate) => { const selected = detailSelectedCandidateId === candidate.sourceId; const tier = musicMatchTier(candidate.confidence); return <button type="button" key={candidate.sourceId} className={selected ? "is-selected" : ""} onClick={() => setDetailSelectedCandidateId(candidate.sourceId)}>{candidate.artworkUrl ? <img src={candidate.artworkUrl} alt="" /> : <span className="tr10-candidateArt">♫</span>}<div><strong>{candidate.title}</strong><span>{candidate.artist}</span><small>{candidate.album || "Unknown album"}{candidate.releaseYear ? ` • ${candidate.releaseYear}` : ""}{candidate.durationSeconds ? ` • ${formatDuration(candidate.durationSeconds)}` : ""}</small></div><em className={`tr10-matchTier is-${tier.toLowerCase().replaceAll(" ","-")}`}>{tier}<b>{Math.round(candidate.confidence*100)}%</b></em><i className="tr10-selectMark">{selected ? "✓" : ""}</i></button>; })}{detailSaveState !== "searching" && !detailCandidates.length ? <div className="tr10-empty">No matching catalog results to show.</div> : null}</div></div>
          <div className="tr10-detailLookupFooter"><div><strong>{detailSelectedCandidate ? `${detailSelectedCandidate.title} • ${detailSelectedCandidate.artist}` : "Select a result"}</strong><small>Nothing changes until you apply the selection.</small></div><button onClick={() => {setDetailMode("edit");setDetailSelectedCandidateId(null);}}>CANCEL</button><button className="is-primary" disabled={!detailSelectedCandidate || detailSaveState === "saving"} onClick={() => { if (!detailSelectedCandidate) return; if (detailMode === "artwork_results") void applyDetailArtworkCandidate(detailSelectedCandidate); else applyDetailInfoCandidate(detailSelectedCandidate); }}>{detailMode === "artwork_results" ? "USE ARTWORK" : "APPLY MATCH"}</button></div>
        </>}
      </motion.section></div>, document.body) : null}

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
