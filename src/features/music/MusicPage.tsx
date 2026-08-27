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
import { motion } from "motion/react";
import { createPortal } from "react-dom";
import { MusicLibraryVisualEngine } from "./premium/MusicLibraryVisualEngine";
import { MusicPremiumSelect } from "./premium/MusicPremiumSelect";
import "./premium/MusicLibraryPremium.css";

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
type LibraryView = "list" | "grid";
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
        ? <button className={`tr10-previewButton ${previewing ? "is-playing" : ""}`} onClick={() => onPreview(item)}>{previewing ? "■ STOP PREVIEW" : previewError ? "↻ RETRY PREVIEW" : "▶ PREVIEW"}</button>
        : <span className="tr10-previewUnavailable">PREVIEW UNAVAILABLE</span>}
      {item.inLibrary
        ? <b>✓ IN YOUR LIBRARY</b>
        : <button className={saved ? "is-toAdd" : ""} disabled={saved || saving} onClick={() => onSave(item)}>{saved ? "✓ SAVED" : saving ? "SAVING…" : "MARK TO ADD"}</button>}
      <button onClick={() => setDiscoveryRecommendationState(seedId,item.id,{dismissed:true})}>NOT INTERESTED</button>
      {item.storeUrl ? <a className="tr10-storeLink" href={item.storeUrl} target="_blank" rel="noreferrer">APPLE ↗</a> : null}
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
        ? <button className={`tr10-previewButton ${previewing ? "is-playing" : ""}`} onClick={() => onPreview(item)}>{previewing ? "■ STOP PREVIEW" : previewError ? "↻ RETRY PREVIEW" : "▶ PREVIEW"}</button>
        : <span className="tr10-previewUnavailable">PREVIEW UNAVAILABLE</span>}
      {item.storeUrl ? <a className="tr10-storeLink" href={item.storeUrl} target="_blank" rel="noreferrer">APPLE ↗</a> : null}
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
        <button type="button" className="is-primary" disabled={!tracks.length} onClick={onPlayAll}>▶ PLAY ALL</button>
        <button type="button" disabled={tracks.length < 2} onClick={onShuffle}>⤨ SHUFFLE</button>
      </div>
    </header>
    <div className="tr10-collectionSongList">
      {tracks.map((track, index) => {
        const current = currentTrackId === track.id;
        return <article className={`tr10-collectionSong ${current ? "is-current" : ""}`} key={track.id}>
          <b className="tr10-collectionSongNumber">{String(index + 1).padStart(2, "0")}</b>
          <button type="button" className={`tr10-collectionSongPlay ${current && playing ? "is-playing" : ""}`} onClick={() => onPlayTrack(track)} aria-label={`${current && playing ? "Pause" : "Play"} ${track.title}`}>{current && playing ? "Ⅱ" : "▶"}</button>
          <TrackArtwork track={track} />
          <div className="tr10-collectionSongText"><strong>{track.title}</strong><span>{trackMeta(track)}</span></div>
          <span className="tr10-collectionSongDuration">{formatDuration(track.duration_seconds)}</span>
          <div className="tr10-collectionSongActions">
            <button type="button" className={track.favorite ? "is-liked" : ""} onClick={() => onLike(track)}>{track.favorite ? "♥ LIKED" : "♡ LIKE"}</button>
            <button type="button" className={track.play_less ? "is-less" : ""} onClick={() => onPlayLess(track)}>{track.play_less ? "✓ PLAY LESS" : "PLAY LESS"}</button>
            <button type="button" onClick={() => onPlaylist(track)}>+ PLAYLIST</button>
            <button type="button" onClick={() => onEdit(track)}>EDIT</button>
          </div>
        </article>;
      })}
    </div>
  </section>;
}

export function MusicPage({ navigate }: { navigate?: (to: string) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const artworkInputRef = useRef<HTMLInputElement | null>(null);
  const tabNavRef = useRef<HTMLElement | null>(null);
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
  const [libraryView, setLibraryView] = useState<LibraryView>("list");
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

  async function refreshTracks() {
    const rows = await listMusicTracks();
    setTracks(rows); setDrafts(buildDraftMap(rows)); replaceMusicLibrary(rows);
    void hydrateArtworkPresence(rows);
    return rows;
  }
  async function refreshPlaylists(preferredId?: string | null) {
    const rows = await listMusicPlaylists();
    const entries = await Promise.all(rows.map(async (playlist) => [playlist.id, (await listMusicPlaylistTrackLinks(playlist.id)).map((link) => link.track_id)] as const));
    setPlaylists(rows); setPlaylistTrackIds(Object.fromEntries(entries));
    const regularRows = rows.filter((playlist) => !isSmartMixPlaylist(playlist));
    setSelectedPlaylistId((current) => preferredId && regularRows.some((p) => p.id === preferredId) ? preferredId : current && regularRows.some((p) => p.id === current) ? current : regularRows[0]?.id || null);
  }
  useEffect(() => {
    void Promise.all([refreshTracks(), refreshPlaylists(), loadMusicLibrary()]).catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load your music library.")).finally(() => setLoading(false));
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
    try {
      const updated = await setPlayerMusicPreference(track.id, preference);
      replaceTrackLocally(updated);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not update preference."); }
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

  function goBack() { if (navigate) navigate("/"); else window.location.pathname = "/"; }

  return (
    <main className={`tr10-page tr10-premiumLibrary tr10-premium-${tab}`}><MusicLibraryVisualEngine activeTab={tab} playing={Boolean(player.playing)} />
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

        <nav ref={tabNavRef} className="tr10-tabs" aria-label="Music library sections">
          {([ ["songs","SONGS"], ["artists","ARTISTS"], ["albums","ALBUMS"], ["playlists","PLAYLISTS"], ["smart","SMART MIX"], ["intelligence","INTELLIGENCE"], ["discover","DISCOVER"], ["audition","AUDITION"] ] as Array<[MusicTab,string]>).map(([value,label]) => (
            <motion.button
              type="button"
              key={value}
              data-music-tab={value}
              aria-current={tab === value ? "page" : undefined}
              className={tab === value ? "is-active" : ""}
              onClick={() => { setTab(value); setCollectionDetail(null); if (value === "discover") setDiscoveryView("archive"); }}
              whileTap={{ scale: 0.985 }}
              transition={{ type: "spring", stiffness: 460, damping: 34, mass: 0.42 }}
            >
              {tab === value ? <motion.span className="tr10-tabEnergy" layoutId="music-library-active-tab" transition={{ type: "spring", stiffness: 410, damping: 34 }} /> : null}
              <span>{label}</span>
            </motion.button>
          ))}
        </nav>

        {message ? <div className="tr10-message">{message}</div> : null}
        {error ? <div className="tr10-error">{error}</div> : null}

        {tab === "songs" ? <>
          <div className="tr10-toolbar">
            <label><span>SEARCH</span><input value={songSearch} onChange={(event) => setSongSearch(event.target.value)} placeholder="Song, artist, album, or file…" /></label>
            <MusicPremiumSelect label="ENERGY" value={energyFilter} onChange={(next) => setEnergyFilter(next as EnergyFilter)} options={[{value:"all",label:"All energy"},{value:"low",label:"Low"},{value:"medium",label:"Medium"},{value:"high",label:"High"}]} />
            <MusicPremiumSelect label="SORT" value={songSort} onChange={(next) => setSongSort(next as SongSort)} options={(["library","recently_added","title_asc","title_desc","artist_asc","artist_desc","album_asc","most_played","recently_played","high_rotation","least_played","most_skipped","longest","shortest","energy_high","energy_low"] as SongSort[]).map((sort) => ({ value: sort, label: songSortLabel(sort) }))} />
            <MusicPremiumSelect label="SHOW" value={pageSize} onChange={(next) => setPageSize(Number(next) as PageSize)} options={[{value:12,label:"12"},{value:24,label:"24"},{value:48,label:"48"}]} />
          </div>

          {selectedCount ? <div className="tr10-bulk"><strong>{selectedCount} SELECTED</strong><div><button onClick={() => openPlaylistModal([...selectedSongIds])}>+ PLAYLIST</button><button onClick={() => void enrichTracks(tracks.filter((track) => selectedSongIds.has(track.id)))}>IDENTIFY</button><button onClick={() => void enrichTracks(tracks.filter((track) => selectedSongIds.has(track.id)), true)}>FIND ART</button><button onClick={() => setSelectedSongIds(new Set())}>CLEAR</button></div></div> : null}

          <div className={`tr10-table ${libraryView === "grid" ? "is-grid" : "is-list"}`}>
            <div className="tr10-tableHead">
              <span className="tr10-orderHead">ORDER</span><label><input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectVisible} /></label>
              <span>TRACK</span><span>TIME</span><span>ENERGY</span>
              <span className="tr10-actionsHead">ACTIONS<button type="button" className="tr10-viewToggle" onClick={() => setLibraryView((current) => current === "list" ? "grid" : "list")} aria-label={libraryView === "list" ? "Switch song library to grid view" : "Switch song library to list view"} title={libraryView === "list" ? "Grid view" : "List view"}>{libraryView === "list" ? "▦" : "▤"}</button></span>
            </div>
            <div className="tr10-mobileViewBar"><span>ACTIONS</span><button type="button" className="tr10-viewToggle" onClick={() => setLibraryView((current) => current === "list" ? "grid" : "list")} aria-label={libraryView === "list" ? "Switch song library to grid view" : "Switch song library to list view"} title={libraryView === "list" ? "Grid view" : "List view"}>{libraryView === "list" ? "▦" : "▤"}</button></div>
            {loading ? <div className="tr10-empty">Loading your music…</div> : null}
            {!loading && !pagedTracks.length ? <div className="tr10-empty">No songs match this view.</div> : null}
            {pagedTracks.map((track) => {
              const current = player.currentTrack?.id === track.id;
              const needsInfo = needsMusicMetadata(track);
              const missingArt = trackNeedsArtwork(track);
              const reorderIndex = libraryOrderIndex.get(track.id) ?? -1;
              return <article className={`tr10-row ${current ? "is-current" : ""}`} key={track.id}>
                <div className="tr10-orderCell" aria-label="Reorder song">
                  <button type="button" aria-label={`Move ${track.title} up`} disabled={reorderIndex <= 0} onClick={() => moveTrack(track.id,-1)}>▲</button>
                  <button type="button" aria-label={`Move ${track.title} down`} disabled={reorderIndex < 0 || reorderIndex >= libraryOrderedTracks.length - 1} onClick={() => moveTrack(track.id,1)}>▼</button>
                </div>
                <label className="tr10-check"><input type="checkbox" checked={selectedSongIds.has(track.id)} onChange={() => toggleSongSelection(track.id)} /></label>
                <div className="tr10-trackCell">
                  <button className={`tr10-play ${current && player.playing ? "is-playing" : ""}`} onClick={() => void toggleTrackPlayback(track)}>{current && player.playing ? "Ⅱ" : "▶"}</button>
                  <TrackArtwork track={track} />
                  <div className="tr10-trackText"><strong>{track.title}</strong><span>{artistLabel(track)}{track.album ? ` • ${track.album}` : ""}</span><small>{track.original_name}</small>{playbackErrors[track.id] ? <em className="tr10-playbackError">{playbackErrors[track.id]}</em> : null}</div>
                  {needsInfo ? <em className="tr10-healthBadge is-needs">NEEDS INFO</em> : missingArt ? <em className="tr10-healthBadge is-art">MISSING ART</em> : null}
                </div>
                <span className="tr10-duration">{formatDuration(track.duration_seconds)}</span>
                <button className={`tr10-energy is-${track.energy_level}`} onClick={() => void setEnergy(track, track.energy_level === "low" ? "medium" : track.energy_level === "medium" ? "high" : "low")} title="Click to change energy"><i className="tr10-energyLed" /><span>{track.energy_level.toUpperCase()}</span><b className="tr10-energySegments" aria-hidden><i /><i /><i /></b></button>
                <div className="tr10-actions">
                  <button type="button" className={`tr10-likeAction ${track.favorite ? "is-liked" : ""}`} onClick={() => void changePreference(track, track.favorite ? "neutral" : "like")} title={track.favorite ? "Liked" : "Like"}><i className="tr10-actionGlyph" aria-hidden="true">♥</i><span>{track.favorite ? "LIKED" : "LIKE"}</span></button>
                  <button type="button" className={`tr10-lessAction ${track.play_less ? "is-down" : ""}`} onClick={() => void changePreference(track, track.play_less ? "neutral" : "play_less")} title="Play less"><i className="tr10-actionGlyph" aria-hidden="true">−</i><span>PLAY LESS</span></button>
                  <button type="button" className="tr10-nextAction" onClick={() => playMusicNext(track.id)}><i className="tr10-actionGlyph" aria-hidden="true">▶</i><span>PLAY NEXT</span></button><button type="button" className="tr10-queueAction" onClick={() => addMusicToQueue(track.id)}><i className="tr10-actionGlyph" aria-hidden="true">≡</i><span>QUEUE</span></button><button type="button" className="tr10-playlistAction" onClick={() => openPlaylistModal([track.id])}><i className="tr10-actionGlyph" aria-hidden="true">＋</i><span>PLAYLIST</span></button><button type="button" className="is-edit tr10-editAction" onClick={() => openDetail(track)}><i className="tr10-actionGlyph" aria-hidden="true">✎</i><span>EDIT</span></button>
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
        /> : <div className="tr10-cardGrid">{artistGroups.map(([artist,songs]) => <article className="tr10-collectionCard" key={artist}>
          <button type="button" className="tr10-collectionOpen" onClick={() => setCollectionDetail({ kind: "artist", artist })} aria-label={`Open ${artist}`}><TrackArtwork track={songs[0]} size="card" /><div><small>ARTIST</small><h3>{artist}</h3><p>{songs.length} SONG{songs.length === 1 ? "" : "S"} • {formatLongDuration(songs.reduce((sum,track) => sum + Number(track.duration_seconds || 0),0))}</p></div><span className="tr10-collectionChevron" aria-hidden>›</span></button>
          <button type="button" className="tr10-collectionPlay" onClick={() => void playMusicAdHocQueue(artist,songs)}>▶ PLAY</button>
        </article>)}</div> : null}

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
        /> : <div className="tr10-cardGrid">{albumGroups.map((group) => <article className="tr10-collectionCard" key={`${group.artist}-${group.album}`}>
          <button type="button" className="tr10-collectionOpen" onClick={() => setCollectionDetail({ kind: "album", artist: group.artist, album: group.album })} aria-label={`Open ${group.album}`}><TrackArtwork track={group.tracks[0]} size="card" /><div><small>ALBUM</small><h3>{group.album}</h3><p>{group.artist} • {group.tracks.length} SONG{group.tracks.length === 1 ? "" : "S"}</p></div><span className="tr10-collectionChevron" aria-hidden>›</span></button>
          <button type="button" className="tr10-collectionPlay" onClick={() => void playMusicAdHocQueue(`Album • ${group.album}`,group.tracks)}>▶ PLAY</button>
        </article>)}</div> : null}

        {tab === "playlists" ? <section className="tr21-playlists">
          <aside className="tr21-playlistDock">
            <div className="tr21-playlistDockHead"><span>YOUR COLLECTIONS</span><b>{regularPlaylists.length}</b></div>
            <div className="tr21-createPlaylist"><input value={newPlaylistName} onChange={(event) => setNewPlaylistName(event.target.value)} placeholder="Name a new playlist" onKeyDown={(event) => { if (event.key === "Enter") void createPlaylist(); }} /><button type="button" onClick={() => void createPlaylist()} aria-label="Create playlist">+</button></div>
            <div className="tr21-playlistChoices">{regularPlaylists.map((playlist,index) => { const count=(playlistTrackIds[playlist.id] || []).length; return <button type="button" key={playlist.id} className={selectedPlaylistId === playlist.id ? "is-active" : ""} onClick={() => setSelectedPlaylistId(playlist.id)}><i>{String(index+1).padStart(2,"0")}</i><span><strong>{playlist.name}</strong><small>{count} SONG{count===1?"":"S"}</small></span><em aria-hidden>›</em></button>; })}</div>
          </aside>
          <section className="tr21-playlistStage">{selectedPlaylist ? <>
            <header className="tr21-playlistHero">
              <div className="tr21-playlistArt">{selectedPlaylistTracks[0] ? <TrackArtwork track={selectedPlaylistTracks[0]} size="card" /> : <span>♫</span>}<i aria-hidden /></div>
              <div className="tr21-playlistHeroCopy"><small>MVP COLLECTION</small><h2>{selectedPlaylist.name}</h2><p>{selectedPlaylistTracks.length ? `${selectedPlaylistTracks.length} tracks curated from your private library.` : "This collection is ready for its first tracks."}</p><div className="tr21-playlistMetrics"><span><b>{selectedPlaylistTracks.length}</b><small>TRACKS</small></span><span><b>{formatLongDuration(selectedPlaylistDurationSeconds)}</b><small>PLAY TIME</small></span><span><b>{selectedPlaylistHighEnergy}</b><small>HIGH ENERGY</small></span><span><b>{selectedPlaylistLiked}</b><small>LIKED</small></span></div></div>
              <div className="tr21-playlistHeroActions"><button type="button" className="is-play" disabled={!selectedPlaylistTracks.length} onClick={() => void playSelectedPlaylist()}><i aria-hidden>▶</i><span><strong>PLAY</strong><small>Start collection</small></span></button><button type="button" className="is-shuffle" disabled={!selectedPlaylistTracks.length} onClick={() => void playCollectionShuffle(`Playlist • ${selectedPlaylist.name}`, selectedPlaylistTracks)}><i aria-hidden>⤨</i><span><strong>MIX</strong><small>Shuffle intelligently</small></span></button><button type="button" className="is-export" disabled={!selectedPlaylistTracks.length} onClick={openBurnStudio}><i aria-hidden>↥</i><span><strong>EXPORT</strong><small>Burn / export CD</small></span></button><button type="button" className="is-delete" onClick={() => void removePlaylist(selectedPlaylist)} aria-label={`Delete ${selectedPlaylist.name}`}>DELETE</button></div>
            </header>
            <div className="tr21-playlistRailHead"><div><span>TRACK RAIL</span><strong>{selectedPlaylistTracks.length} SONG{selectedPlaylistTracks.length===1?"":"S"}</strong></div><button type="button" disabled={!selectedSongIds.size} onClick={() => openPlaylistModal([...selectedSongIds])}>+ ADD {selectedSongIds.size || ""} SELECTED</button></div>
            <div className="tr21-playlistTracks">{selectedPlaylistTracks.length ? selectedPlaylistTracks.map((track,index) => <article key={track.id} className={player.currentTrack?.id===track.id ? "is-current" : ""}><span className="tr21-trackNumber">{String(index+1).padStart(2,"0")}</span><TrackArtwork track={track} /><div className="tr21-playlistTrackCopy"><strong>{track.title}</strong><span>{artistLabel(track)}{track.album ? ` • ${track.album}` : ""}</span></div><span className={`tr21-playlistEnergy is-${track.energy_level}`}><i />{track.energy_level.toUpperCase()}</span><span className="tr21-playlistDuration">{formatDuration(track.duration_seconds)}</span><div className="tr21-playlistTrackActions"><button type="button" className="is-trackPlay" onClick={() => void playSelectedPlaylist(track.id)} aria-label={`Play ${track.title}`}>▶</button><button type="button" disabled={index===0} onClick={() => { const next=[...selectedPlaylistTracks]; [next[index-1],next[index]]=[next[index],next[index-1]]; void savePlaylistOrder(next); }} aria-label={`Move ${track.title} up`}>↑</button><button type="button" disabled={index===selectedPlaylistTracks.length-1} onClick={() => { const next=[...selectedPlaylistTracks]; [next[index+1],next[index]]=[next[index],next[index+1]]; void savePlaylistOrder(next); }} aria-label={`Move ${track.title} down`}>↓</button><button type="button" className="is-remove" onClick={() => void savePlaylistOrder(selectedPlaylistTracks.filter((item) => item.id !== track.id))}>REMOVE</button></div></article>) : <div className="tr21-playlistEmpty"><b>EMPTY COLLECTION</b><span>Select songs in the Songs tab, then route them here.</span></div>}</div>
          </> : <div className="tr21-playlistEmpty is-stage"><b>BUILD YOUR FIRST COLLECTION</b><span>Create a playlist on the left to turn your library into a dedicated listening collection.</span></div>}</section>
        </section> : null}

        {tab === "smart" ? <section className="tr10-smart">
          <div className="tr10-smartBuild"><span>SMART WORKOUT MIX</span><h2>Build or refresh a saved Smart Mix</h2><p>Uses energy, likes, completed plays, skips and recent playback. Play Less tracks are excluded. Your current queue stays stable until you rebuild it.</p><label><span>WORKOUT LENGTH</span><input type="number" min={15} max={240} step={5} value={smartMinutes} onChange={(event) => setSmartMinutes(Math.max(15,Math.min(240,Number(event.target.value)||60)))} /><b>MINUTES</b></label><div className="tr10-intensity">{(["high","balanced","recovery"] as SmartIntensity[]).map((value) => <button key={value} className={smartIntensity===value ? "is-active" : ""} onClick={() => setSmartIntensity(value)}>{value.toUpperCase()}</button>)}</div><button className="tr10-smartLaunch" onClick={() => void buildAndPlaySmartMix(smartIntensity)}>BUILD & PLAY {smartIntensity.toUpperCase()}</button></div>
          <div className="tr10-savedMixes"><div className="tr10-savedMixHead"><span>YOUR SMART MIXES</span><b>{smartMixPlaylists.length}</b></div>{(["high","balanced","recovery"] as SmartIntensity[]).map((mode) => { const name=SMART_MIX_NAMES[mode]; const playlist=smartMixPlaylists.find((item)=>item.name===name); const ids=playlist ? playlistTrackIds[playlist.id] || [] : []; const duration=ids.reduce((sum,id)=>{ const found=tracks.find((track)=>track.id===id); return sum+(found ? trackDuration(found) : 0); },0); return <article key={mode} className={player.activePlaylistId===playlist?.id ? "is-playing" : ""}><div><small>{mode.toUpperCase()}</small><h3>{name}</h3><p>{playlist ? `${ids.length} songs • ${formatLongDuration(duration)}` : "Not built yet"}</p></div><div>{playlist ? <><button className="is-primary" onClick={() => void playSavedSmartMix(playlist)}>▶ PLAY</button><button onClick={() => {setSmartIntensity(mode);void buildAndPlaySmartMix(mode);}}>REBUILD</button></> : <button onClick={() => {setSmartIntensity(mode);}}>SELECT</button>}</div></article>; })}</div>
          <div className="tr10-smartCollections"><button onClick={() => {setTab("songs");setHealthFilter("liked");setSongSort("high_rotation");}}>LIKED TRACKS <b>{likedCount}</b></button><button onClick={() => {setTab("songs");setHealthFilter("all");setSongSort("most_played");}}>MOST PLAYED</button><button onClick={() => {setTab("songs");setHealthFilter("all");setSongSort("recently_played");}}>RECENTLY PLAYED</button><button onClick={() => {setTab("songs");setHealthFilter("all");setSongSort("high_rotation");}}>HIGH ROTATION</button><button onClick={() => {setTab("songs");setHealthFilter("liked");setSongSort("least_played");}}>REDISCOVER</button></div>
        </section> : null}

        {/* MVP_TRAINER_V5_R6_MUSIC_INTELLIGENCE_SUITE: INTELLIGENCE PANEL */}
        {tab === "intelligence" ? (
          <MusicIntelligencePanel tracks={tracks} />
        ) : null}
        {tab === "audition" ? <MusicAuditionPanel tracks={tracks} previewVolume={player.volume} onPreviewStart={() => pauseMusic()} onImportFile={uploadAuditionSong} /> : null}

        {tab === "discover" ? <section className="tr10-discover">
          <section className="tr10-radarPanel" aria-label="Discovery Radar">
            <header className="tr10-radarHead">
              <div><span>DISCOVERY RADAR</span><h2>Your library, resurfaced intelligently</h2><p>Forgotten favorites, deep cuts, long-unplayed tracks, recent Likes, and high-energy music worth bringing back.</p></div>
              <strong>{discoveryRadar.reduce((sum, lane) => sum + lane.tracks.length, 0)}</strong>
            </header>
            <div className="tr10-radarGrid">
              {discoveryRadar.map((lane) => <article key={lane.id}>
                <div><small>{lane.tracks.length} TRACKS</small><h3>{lane.title}</h3><p>{lane.subtitle}</p></div>
                <button type="button" disabled={!lane.tracks.length} onClick={() => void playMusicAdHocQueue(`Radar • ${lane.title}`, lane.tracks)}>▶ PLAY</button>
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

      <style>{`
        .tr10-page{width:min(1180px,calc(100% - 32px));margin:0 auto 120px;color:#eef8fc;font-family:inherit;min-width:0}.tr10-page *{box-sizing:border-box}.tr10-page button,.tr10-page input,.tr10-page select{font:inherit}.tr10-page button{cursor:pointer}.tr10-page button:disabled{cursor:not-allowed;opacity:.42}
        .tr10-hero,.tr10-console{border:1px solid rgba(70,181,222,.24);border-top-color:rgba(149,222,248,.33);border-radius:18px;background:linear-gradient(180deg,rgba(12,31,42,.97),rgba(4,13,19,.99));box-shadow:inset 0 1px 0 rgba(255,255,255,.025),0 14px 32px rgba(0,0,0,.24)}.tr10-hero{padding:24px 28px;display:flex;justify-content:space-between;gap:22px;align-items:flex-start}.tr10-hero span,.tr10-sectionHead span,.tr10-inspector header span,.tr10-reviewModal header span,.tr10-picker header span,.tr10-smart span{font-size:9px;font-weight:1000;letter-spacing:.15em;color:#5bcdf2}.tr10-hero h1{font-size:36px;line-height:1;margin:8px 0 9px;letter-spacing:-.04em}.tr10-hero p{max-width:800px;margin:0;color:#8fa5af;font-weight:650;font-size:11px}.tr10-hero>button{height:38px;padding:0 18px;border:1px solid rgba(130,170,185,.18);border-radius:10px;background:#071219;color:#c8dce4;font-size:8px;font-weight:1000}
        .tr10-stats{display:grid;grid-template-columns:repeat(5,1fr);gap:9px;margin:10px 0}.tr10-stats>div{min-height:70px;display:grid;place-content:center;text-align:center;border:1px solid rgba(91,157,181,.14);border-radius:12px;background:linear-gradient(180deg,#09151c,#050b0f)}.tr10-stats strong{font-size:22px;color:#f2c56d}.tr10-stats span{font-size:7px;font-weight:1000;letter-spacing:.12em;color:#6e8791}
        .tr10-console{overflow:hidden}.tr10-sectionHead{padding:16px 18px;display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid rgba(84,155,181,.11)}.tr10-sectionHead h2{margin:4px 0 2px;font-size:23px}.tr10-sectionHead p{margin:0;color:#68838d;font-size:8px}.tr10-headActions{display:flex;gap:7px}.tr10-headActions button{height:36px;padding:0 12px;border:1px solid rgba(82,167,197,.2);border-radius:8px;background:#07141b;color:#cce3ec;font-size:8px;font-weight:1000}.tr10-headActions .is-orange{border-color:rgba(255,175,68,.42);background:linear-gradient(180deg,#ef9d2e,#b8650e);color:#1a1005;box-shadow:inset 0 1px rgba(255,255,255,.3)}
        .tr10-statusPanel{padding:9px 11px 11px;border-bottom:1px solid rgba(82,151,176,.12);background:linear-gradient(180deg,#07131a,#050d12)}.tr10-statusPanelHead{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 2px 7px}.tr10-statusPanelHead span{color:#77a8b9;font-size:6px;font-weight:1000;letter-spacing:.16em}.tr10-statusPanelHead small{color:#4f6d78;font-size:5.5px;font-weight:900;letter-spacing:.1em}.tr10-healthRail{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px}.tr10-healthRail button{min-width:0;height:34px;padding:0 8px;display:flex;align-items:center;justify-content:space-between;gap:7px;border:1px solid rgba(82,151,176,.11);border-radius:7px;background:linear-gradient(180deg,rgba(10,25,33,.92),rgba(5,13,18,.96));color:#728a95;font-size:6.5px;font-weight:1000;letter-spacing:.075em;box-shadow:inset 0 1px rgba(255,255,255,.018)}.tr10-healthRail button span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:inherit;font:inherit;letter-spacing:inherit}.tr10-healthRail button b{min-width:22px;height:20px;padding:0 5px;display:grid;place-items:center;border:1px solid rgba(91,164,189,.10);border-radius:5px;background:rgba(0,0,0,.18);color:#b5cbd3;font-size:7px;font-variant-numeric:tabular-nums}.tr10-healthRail button.is-active{border-color:rgba(70,204,246,.4);color:#ddf7ff;background:linear-gradient(180deg,rgba(10,55,70,.82),rgba(5,27,36,.9));box-shadow:inset 0 1px rgba(157,233,255,.05),0 0 0 1px rgba(63,192,233,.035)}.tr10-healthRail button.is-needs{border-color:rgba(255,75,85,.24);color:#e8a2a7}.tr10-healthRail button.is-needs b{border-color:rgba(255,75,85,.25);color:#ff8a91;background:rgba(92,18,24,.3)}.tr10-healthRail button.is-needs.is-active{border-color:rgba(255,75,85,.58);color:#ffe1e3;background:linear-gradient(180deg,rgba(100,21,27,.75),rgba(48,10,14,.86));box-shadow:inset 0 1px rgba(255,198,201,.055)}.tr10-healthRail button.is-art{color:#d2ae71}.tr10-healthRail button.is-art.is-active{border-color:rgba(232,169,68,.42);color:#ffd995;background:linear-gradient(180deg,rgba(76,48,12,.68),rgba(35,23,8,.84))}.tr10-healthRail button.is-liked.is-active{border-color:rgba(68,212,153,.4);color:#9be8bf;background:linear-gradient(180deg,rgba(14,65,47,.65),rgba(7,31,23,.86))}.tr10-healthRail button.is-review.is-active{border-color:rgba(147,129,245,.38);color:#c9c1ff;background:linear-gradient(180deg,rgba(46,39,94,.62),rgba(21,18,49,.86))}
        .tr10-tabs{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));border-bottom:1px solid rgba(82,151,176,.1);background:#061016}.tr10-tabs button{height:42px;border:0;border-right:1px solid rgba(82,151,176,.07);background:transparent;color:#67808b;font-size:8px;font-weight:1000;letter-spacing:.08em}.tr10-tabs button.is-active{color:#e1f8ff;background:rgba(9,42,55,.62);box-shadow:inset 0 -2px #47cff5}
        .tr10-message,.tr10-error{margin:9px 11px 0;padding:9px 11px;border-radius:8px;font-size:8px;font-weight:850}.tr10-message{border:1px solid rgba(74,208,151,.18);background:rgba(15,65,47,.2);color:#83dcb0}.tr10-error{border:1px solid rgba(255,82,92,.28);background:rgba(90,19,24,.25);color:#ffadb2}
        .tr10-toolbar{padding:10px 12px;display:grid;grid-template-columns:minmax(240px,1fr) 140px 190px 90px;gap:8px;border-bottom:1px solid rgba(74,139,162,.08);background:#050b0f}.tr10-toolbar label{display:grid;gap:4px}.tr10-toolbar span{font-size:6px;font-weight:1000;letter-spacing:.11em;color:#5d7681}.tr10-toolbar input,.tr10-toolbar select{height:36px;padding:0 10px;border:1px solid rgba(75,151,178,.14);border-radius:8px;background:#071219;color:#c9dde5;outline:none;font-size:8px;font-weight:850}.tr10-bulk{min-height:48px;padding:8px 12px;display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid rgba(69,151,181,.1);background:linear-gradient(90deg,rgba(8,45,59,.62),rgba(5,17,23,.64))}.tr10-bulk strong{font-size:8px;color:#7bdff7;letter-spacing:.1em}.tr10-bulk>div{display:flex;gap:6px}.tr10-bulk button{height:32px;padding:0 10px;border:1px solid rgba(76,176,211,.2);border-radius:7px;background:#07141b;color:#bdd6df;font-size:7px;font-weight:1000}
        .tr10-tableHead,.tr10-row{display:grid;grid-template-columns:30px minmax(0,1fr) 62px 112px 390px;gap:10px;align-items:center}.tr10-tableHead{min-height:36px;padding:0 12px;border-bottom:1px solid rgba(88,143,164,.09);color:#5c7782;font-size:7px;font-weight:1000;letter-spacing:.1em}.tr10-row{position:relative;min-height:72px;padding:8px 12px;border-bottom:1px solid rgba(83,137,157,.085);background:rgba(2,8,11,.38)}.tr10-row:hover{background:rgba(7,30,39,.52)}.tr10-row.is-current{background:linear-gradient(90deg,rgba(7,65,84,.55),rgba(3,13,18,.4));box-shadow:inset 3px 0 #38cef8}.tr10-check{display:grid;place-items:center}.tr10-check input{accent-color:#49d3f8}.tr10-trackCell{min-width:0;display:grid;grid-template-columns:auto auto minmax(0,1fr) auto;gap:9px;align-items:center}.tr10-trackText{min-width:0}.tr10-trackText strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px}.tr10-trackText span,.tr10-trackText small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tr10-trackText span{margin-top:2px;color:#78909a;font-size:8px}.tr10-trackText small{margin-top:2px;color:#4f6873;font-size:6px}.tr10-play{width:34px;height:34px;border:1px solid rgba(247,178,75,.34);border-radius:8px;background:linear-gradient(180deg,#ffc45b,#f29514);color:#1b1104;font-weight:1000}.tr10-play.is-playing{border-color:rgba(75,211,249,.44);background:linear-gradient(180deg,#74e9ff,#2ebedc)}
        .tr10-art{display:grid;place-items:center;overflow:hidden;border:1px solid rgba(91,184,219,.16);background:linear-gradient(145deg,#102936,#07131b);color:#ffc05b;flex:0 0 auto}.tr10-art img{width:100%;height:100%;object-fit:cover}.tr10-art--row{width:36px;height:36px;border-radius:8px}.tr10-art--detail{width:72px;height:72px;border-radius:14px}.tr10-art--card{width:76px;height:76px;border-radius:12px}.tr10-healthBadge{font-style:normal;font-size:6px;font-weight:1000;letter-spacing:.08em;padding:5px 8px;border-radius:6px;white-space:nowrap}.tr10-healthBadge.is-needs{color:#ffd9dc;border:1px solid rgba(255,75,85,.58);background:linear-gradient(180deg,rgba(126,25,32,.75),rgba(62,10,15,.84));box-shadow:0 0 12px rgba(255,55,66,.08)}.tr10-healthBadge.is-art{color:#ffd086;border:1px solid rgba(230,161,55,.34);background:rgba(82,49,9,.25)}.tr10-duration{font-size:9px;color:#8398a1;font-variant-numeric:tabular-nums}
        .tr10-energy{position:relative;height:34px;padding:0 9px;display:grid;grid-template-columns:10px minmax(0,1fr) auto;gap:8px;align-items:center;overflow:hidden;border-radius:6px;color:#a8bac1;background:linear-gradient(180deg,#0d171c,#05090c 68%,#030609);font-size:7px;font-weight:1000;letter-spacing:.12em;text-shadow:0 1px 0 #000;box-shadow:inset 0 1px rgba(255,255,255,.045),inset 0 -1px rgba(0,0,0,.7),0 2px 5px rgba(0,0,0,.18);transition:border-color .12s ease,filter .12s ease}.tr10-energy:after{content:"";position:absolute;left:7px;right:7px;top:4px;height:1px;background:rgba(255,255,255,.025);pointer-events:none}.tr10-energy:hover{filter:brightness(1.08)}.tr10-energy>.tr10-energyLed{width:7px;height:7px;border:1px solid currentColor;border-radius:50%;background:currentColor;box-shadow:0 0 0 2px rgba(0,0,0,.42),0 0 7px currentColor}.tr10-energy>span{text-align:left;white-space:nowrap}.tr10-energySegments{display:flex;align-items:flex-end;gap:2px;height:13px;padding:2px 4px;border:1px solid rgba(255,255,255,.055);border-radius:3px;background:rgba(0,0,0,.25)}.tr10-energySegments i{display:block;width:3px;border-radius:1px;background:currentColor;box-shadow:0 0 4px currentColor;opacity:.13}.tr10-energySegments i:nth-child(1){height:4px;opacity:1}.tr10-energySegments i:nth-child(2){height:7px}.tr10-energySegments i:nth-child(3){height:10px}.tr10-energy.is-medium .tr10-energySegments i:nth-child(2),.tr10-energy.is-high .tr10-energySegments i:nth-child(2),.tr10-energy.is-high .tr10-energySegments i:nth-child(3){opacity:1}.tr10-energy.is-high{border:1px solid rgba(226,159,53,.48);color:#efb253;background:linear-gradient(180deg,#231a0d,#0e0b07 70%,#070503)}.tr10-energy.is-medium{border:1px solid rgba(62,185,220,.44);color:#67d5ef;background:linear-gradient(180deg,#0b2028,#071014 70%,#04090c)}.tr10-energy.is-low{border:1px solid rgba(56,190,133,.4);color:#68dca3;background:linear-gradient(180deg,#0c2119,#07110d 70%,#040907)}
        .tr10-actions{display:flex;justify-content:flex-end;gap:5px}.tr10-actions button,.tr10-order button{height:30px;padding:0 8px;border:1px solid rgba(75,147,172,.13);border-radius:7px;background:#061118;color:#879da6;font-size:7px;font-weight:950}.tr10-actions button.is-liked{color:#5fe2a6;border-color:rgba(66,211,151,.32);background:rgba(18,76,55,.28)}.tr10-actions button.is-down{color:#ff8d93;border-color:rgba(255,90,99,.3);background:rgba(83,20,25,.27)}.tr10-actions .is-edit{color:#d9f5fd;border-color:rgba(71,197,238,.28);background:#082733}.tr10-order{position:absolute;right:9px;bottom:3px;display:none;gap:3px}.tr10-row:hover .tr10-order{display:flex}.tr10-order button{height:19px;padding:0 5px;font-size:7px}
        .tr10-pager{padding:10px 12px;display:flex;align-items:center;justify-content:space-between;background:#050b0f}.tr10-pager>span{color:#5d7580;font-size:7px;font-weight:1000}.tr10-pager>div{display:flex;gap:7px;align-items:center}.tr10-pager button{height:30px;padding:0 10px;border:1px solid rgba(76,148,173,.14);border-radius:7px;background:#061118;color:#8fa6af;font-size:7px;font-weight:1000}.tr10-pager b{min-width:55px;text-align:center;font-size:8px}
        .tr10-cardGrid{padding:12px;display:grid;grid-template-columns:1fr 1fr;gap:9px}.tr10-collectionCard{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:12px;align-items:center;padding:12px;border:1px solid rgba(79,145,169,.11);border-radius:12px;background:linear-gradient(180deg,#07141a,#050c10)}.tr10-collectionCard small{color:#56ceef;font-size:6px;font-weight:1000}.tr10-collectionCard h3{margin:4px 0 2px;font-size:15px}.tr10-collectionCard p{margin:0;color:#6f8791;font-size:7px;font-weight:800}.tr10-collectionCard>button{height:34px;padding:0 10px;border:1px solid rgba(70,196,236,.25);border-radius:8px;background:#082633;color:#cceef8;font-size:7px;font-weight:1000}
        .tr10-playlistLayout{display:grid;grid-template-columns:230px 1fr;min-height:430px}.tr10-playlistLayout>aside{padding:10px;border-right:1px solid rgba(78,143,166,.1);background:#050b0f}.tr10-createPlaylist{display:grid;grid-template-columns:1fr 35px;gap:5px;margin-bottom:9px}.tr10-createPlaylist input{min-width:0;height:35px;padding:0 9px;border:1px solid rgba(75,149,175,.14);border-radius:8px;background:#071219;color:#d7e7ed}.tr10-createPlaylist button{height:35px;border:1px solid rgba(70,194,234,.24);border-radius:8px;background:#082734;color:#d9f7ff;font-weight:1000}.tr10-playlistLayout>aside>button{width:100%;min-height:52px;padding:9px 10px;display:grid;gap:2px;text-align:left;border:0;border-radius:8px;background:transparent;color:#91a7af}.tr10-playlistLayout>aside>button.is-active{background:linear-gradient(90deg,rgba(10,63,81,.58),rgba(7,25,33,.3));color:#e3f7fc}.tr10-playlistLayout>aside>button span{font-size:6px;color:#607984}.tr10-playlistConsole>header{padding:12px 14px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(77,144,168,.09)}.tr10-playlistConsole>header h2{margin:3px 0 0}.tr10-playlistConsole>header>div:last-child{display:flex;gap:6px}.tr10-playlistConsole button{height:33px;padding:0 9px;border:1px solid rgba(75,148,174,.14);border-radius:7px;background:#061218;color:#91aab3;font-size:7px;font-weight:1000}.tr10-playlistConsole button.is-primary{color:#d9f7ff;border-color:rgba(69,198,239,.32);background:#092c3a}.tr10-playlistConsole button.is-burn{color:#ffe2a5;border-color:rgba(242,174,61,.34);background:linear-gradient(180deg,rgba(92,58,12,.52),rgba(37,24,8,.56));box-shadow:inset 0 1px rgba(255,255,255,.04),0 7px 18px rgba(0,0,0,.22)}.tr10-playlistConsole button.is-burn:hover{border-color:rgba(255,194,82,.62);color:#fff0c8}.tr10-playlistConsole button.is-danger{color:#ff9fa4;border-color:rgba(255,82,91,.23);background:rgba(71,17,21,.25)}.tr10-playlistSongs{padding:9px}.tr10-playlistSongs article{display:grid;grid-template-columns:25px auto minmax(0,1fr) repeat(4,auto);gap:7px;align-items:center;padding:7px;border-bottom:1px solid rgba(75,136,158,.08)}.tr10-playlistSongs article>b{font-size:7px;color:#586f79}.tr10-playlistSongs strong{display:block;font-size:10px}.tr10-playlistSongs span{display:block;font-size:7px;color:#677f89}.tr10-addSelected{margin:0 12px 12px}
        .tr10-smart{display:grid;grid-template-columns:1fr 300px;min-height:430px}.tr10-smartBuild{padding:23px}.tr10-smartBuild h2{margin:6px 0;font-size:26px}.tr10-smartBuild p{margin:0 0 18px;color:#788f99;font-size:10px}.tr10-smartBuild label{display:grid;grid-template-columns:auto 100px auto;gap:8px;align-items:center;padding:10px;border:1px solid rgba(76,145,169,.1);border-radius:10px;background:#061118}.tr10-smartBuild label input{height:35px;padding:0 9px;border:1px solid rgba(74,148,174,.13);border-radius:8px;background:#07151c;color:#d6e8ee}.tr10-intensity{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:10px}.tr10-intensity button{height:36px;border:1px solid rgba(74,149,175,.13);border-radius:8px;background:#07151c;color:#748d97;font-size:8px;font-weight:1000}.tr10-intensity button.is-active{color:#dff7ff;border-color:rgba(73,206,246,.38);background:#0a3040}.tr10-smartLaunch{width:100%;height:46px;margin-top:10px;border:1px solid rgba(72,203,244,.42);border-radius:10px;background:linear-gradient(180deg,#0c4c62,#082d3b);color:#e2f9ff;font-size:9px;font-weight:1000}.tr10-smartCollections{padding:12px;border-left:1px solid rgba(75,141,164,.09);background:#050b0f}.tr10-smartCollections button{width:100%;min-height:54px;padding:0 12px;display:flex;align-items:center;justify-content:space-between;border:0;border-bottom:1px solid rgba(73,132,153,.07);background:transparent;color:#9fb5bd;font-size:8px;font-weight:1000;text-align:left}
        .tr10-reviewDock{position:fixed;right:18px;bottom:88px;z-index:6500;min-height:42px;padding:0 15px;border:1px solid rgba(255,185,77,.42);border-radius:10px;background:linear-gradient(180deg,#d98a21,#9b540c);color:#180e04;font-size:8px;font-weight:1000;box-shadow:0 12px 32px rgba(0,0,0,.36)}
        .tr10-modalBack{position:fixed;inset:0;z-index:9000;padding:18px 12px;display:grid;place-items:center;background:rgba(0,4,7,.89);backdrop-filter:blur(10px)}.tr10-inspector,.tr10-reviewModal,.tr10-picker{width:min(900px,100%);max-height:calc(100dvh - 36px);overflow:hidden;border:1px solid rgba(80,206,246,.34);border-radius:17px;background:linear-gradient(180deg,#0b202b,#050d12);box-shadow:0 34px 90px rgba(0,0,0,.68)}.tr10-inspector{height:min(760px,calc(100dvh - 36px));display:grid;grid-template-rows:auto minmax(0,1fr) auto}.tr10-inspector>header,.tr10-reviewModal>header,.tr10-picker>header{padding:14px 16px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(82,157,184,.12);background:#081922}.tr10-inspector>header>button,.tr10-reviewModal>header>button,.tr10-picker>header>button{width:35px;height:35px;border:1px solid rgba(105,159,178,.17);border-radius:9px;background:#071219;color:#d8e8ed;font-size:20px}.tr10-inspectIdentity{display:flex;gap:12px;align-items:center;min-width:0}.tr10-inspectIdentity h2{margin:4px 0 2px;font-size:23px}.tr10-inspectIdentity p{margin:0;color:#7a919b;font-size:9px}.tr10-editState{display:block;margin-top:5px;color:#65808b;font-size:6px;font-weight:1000;letter-spacing:.1em}.tr10-editState.is-dirty{color:#f0b75f}.tr10-editState.is-changed{color:#6ae3aa}.tr10-inspectorScroll{min-height:0;overflow:auto;overscroll-behavior:contain}.tr10-inspectCommands{position:sticky;top:0;z-index:3;padding:9px 13px;display:flex;flex-wrap:wrap;gap:6px;border-bottom:1px solid rgba(80,153,180,.1);background:rgba(6,18,25,.97)}.tr10-inspectCommands button,.tr10-artControls button{height:34px;padding:0 10px;border:1px solid rgba(73,181,219,.19);border-radius:8px;background:#07141b;color:#cbe5ee;font-size:7px;font-weight:1000}.tr10-inspectCommands button.is-liked{color:#61e3a6}.tr10-inspectCommands button.is-down{color:#ff9191}.tr10-detailStatus{margin:10px 13px 0;padding:9px 11px;border:1px solid rgba(77,171,205,.17);border-radius:8px;background:#07141b;color:#9ec0cd;font-size:8px}.tr10-detailStatus.is-changed{border-color:rgba(67,208,147,.32);color:#8ce8ba}.tr10-detailStatus.is-error{border-color:rgba(255,92,99,.38);color:#ffb1b5}.tr10-inspectGrid{padding:13px;display:grid;grid-template-columns:1fr 1fr;gap:9px}.tr10-inspectGrid label{display:grid;gap:5px}.tr10-inspectGrid label>span,.tr10-artControls>span{font-size:6px;font-weight:1000;letter-spacing:.11em;color:#617b85}.tr10-inspectGrid input{height:39px;padding:0 10px;border:1px solid rgba(75,151,178,.15);border-radius:8px;background:#06131a;color:#e8f5f9}.tr10-artControls{display:flex;align-items:end;gap:6px}.tr10-artControls>span{margin-right:auto;margin-bottom:10px}.tr10-artControls .is-danger{color:#ff969c}.tr10-meta{display:grid;grid-template-columns:repeat(3,1fr);margin:0;padding:0 13px 13px}.tr10-meta>div{min-width:0;padding:10px;border:1px solid rgba(85,146,167,.09)}.tr10-meta dt{font-size:6px;font-weight:1000;color:#617b85}.tr10-meta dd{margin:4px 0 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:8px}.tr10-inspector>footer,.tr10-detailLookupFooter,.tr10-reviewModal>footer,.tr10-picker>footer{padding:11px 13px;display:flex;justify-content:flex-end;align-items:center;gap:7px;border-top:1px solid rgba(82,157,184,.12);background:#061117}.tr10-inspector>footer button,.tr10-detailLookupFooter button,.tr10-reviewModal>footer button,.tr10-picker>footer button{height:38px;padding:0 12px;border:1px solid rgba(83,168,199,.18);border-radius:9px;background:#07131a;color:#d1e3e9;font-size:7px;font-weight:1000}.tr10-inspector>footer .is-primary,.tr10-detailLookupFooter .is-primary,.tr10-reviewModal>footer .is-primary,.tr10-picker>footer .is-primary{border-color:rgba(61,205,255,.5);background:linear-gradient(180deg,#0d4559,#092e3c);color:#e1f9ff}.tr10-inspector>footer .is-danger{color:#ff9da3}.tr10-saveButton.is-changed{border-color:rgba(72,221,155,.58)!important;background:linear-gradient(180deg,rgba(25,115,78,.8),rgba(16,70,49,.88))!important;color:#b3f5d2!important}
        .tr10-detailLookup{min-height:0;overflow:auto}.tr10-detailLookupHead{position:sticky;top:0;z-index:4;padding:12px 13px;display:grid;grid-template-columns:auto 1fr;gap:12px;align-items:start;border-bottom:1px solid rgba(75,148,174,.12);background:rgba(6,19,26,.98)}.tr10-detailLookupHead>button{height:34px;padding:0 10px;border:1px solid rgba(77,164,196,.2);border-radius:8px;background:#07141b;color:#bdd5de;font-size:7px;font-weight:1000}.tr10-detailLookupHead h3{margin:3px 0 2px;font-size:20px}.tr10-detailLookupHead p{margin:0;color:#78909a;font-size:8px}.tr10-detailCandidates,.tr10-candidates{padding:10px 12px 18px;display:grid;gap:7px;max-height:470px;overflow:auto}.tr10-detailCandidates>button,.tr10-candidates>button{width:100%;display:grid;grid-template-columns:58px minmax(0,1fr) 120px 26px;gap:10px;align-items:center;text-align:left;padding:9px;border:1px solid rgba(78,143,166,.12);border-radius:10px;background:linear-gradient(180deg,rgba(7,19,26,.96),rgba(4,12,17,.97));color:#edf7fb}.tr10-detailCandidates>button.is-selected,.tr10-candidates>button.is-selected{border-color:rgba(73,210,252,.66);background:linear-gradient(90deg,rgba(10,65,83,.68),rgba(5,20,27,.96));box-shadow:inset 3px 0 #42d3fb}.tr10-detailCandidates img,.tr10-candidates img,.tr10-candidateArt{width:58px;height:58px;border-radius:8px;object-fit:cover}.tr10-candidateArt{display:grid;place-items:center;background:#09202a;color:#7cdff7}.tr10-detailCandidates strong,.tr10-candidates strong{display:block;font-size:10px}.tr10-detailCandidates span,.tr10-detailCandidates small,.tr10-candidates span,.tr10-candidates small{display:block;margin-top:2px;color:#738a94;font-size:7px}.tr10-matchTier{justify-self:end;display:grid;gap:2px;text-align:right;font-style:normal;font-size:6px;font-weight:1000;color:#8299a2}.tr10-matchTier b{font-size:13px;color:#78dff9}.tr10-matchTier.is-exact-match,.tr10-matchTier.is-exact-match b{color:#69e9ad}.tr10-matchTier.is-possible-match b{color:#efc372}.tr10-selectMark{width:24px;height:24px;display:grid;place-items:center;border:1px solid rgba(83,153,179,.19);border-radius:50%;font-style:normal;color:#70eab0}.tr10-detailCandidates>button.is-selected .tr10-selectMark,.tr10-candidates>button.is-selected .tr10-selectMark{border-color:rgba(83,229,174,.48);background:rgba(26,100,73,.31)}.tr10-detailLookupFooter{z-index:5}.tr10-detailLookupFooter>div{min-width:0;margin-right:auto;display:grid;gap:2px}.tr10-detailLookupFooter strong{font-size:8px;color:#b9d5df}.tr10-detailLookupFooter small{font-size:6px;color:#607984}.tr10-reviewLoading,.tr10-empty{padding:24px;text-align:center;color:#68808a;font-size:8px;font-weight:800}
        .tr10-analysisBack{z-index:7600}.tr10-analysisModal{width:min(610px,100%);overflow:hidden;border:1px solid rgba(72,202,245,.38);border-radius:16px;background:linear-gradient(180deg,#0b202a,#050d12);box-shadow:0 30px 90px rgba(0,0,0,.72),inset 0 1px rgba(255,255,255,.025)}.tr10-analysisModal>header{padding:17px 18px 14px;display:flex;align-items:flex-start;justify-content:space-between;gap:15px;border-bottom:1px solid rgba(82,157,184,.12);background:linear-gradient(180deg,rgba(11,39,51,.96),rgba(7,23,31,.96))}.tr10-analysisModal>header span{color:#59d5f7;font-size:7px;font-weight:1000;letter-spacing:.14em}.tr10-analysisModal>header h2{margin:5px 0 3px;font-size:20px}.tr10-analysisModal>header p{margin:0;color:#79919b;font-size:8px}.tr10-analysisCounter{min-width:72px;padding:8px 10px;display:grid;justify-items:center;border:1px solid rgba(75,190,229,.16);border-radius:9px;background:rgba(0,0,0,.18)}.tr10-analysisCounter strong{font-size:21px;line-height:1;color:#e7f8fd;font-variant-numeric:tabular-nums}.tr10-analysisCounter span{margin-top:3px;color:#66828d!important;font-size:6px!important}.tr10-analysisProgress{height:4px;background:rgba(75,158,188,.08);overflow:hidden}.tr10-analysisProgress i{display:block;width:100%;height:100%;transform-origin:left;background:linear-gradient(90deg,#2db8df,#6fe5ff);box-shadow:0 0 9px rgba(65,210,249,.3);transition:transform .25s ease}.tr10-analysisStats{padding:13px 16px;display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.tr10-analysisStats>div{min-height:59px;display:grid;place-content:center;text-align:center;border:1px solid rgba(76,151,178,.11);border-radius:8px;background:rgba(4,13,18,.7)}.tr10-analysisStats span{color:#627d88;font-size:6px;font-weight:1000;letter-spacing:.1em}.tr10-analysisStats strong{margin-top:3px;color:#d9edf4;font-size:18px;font-variant-numeric:tabular-nums}.tr10-analysisStats>div:nth-child(1) strong{color:#72e0aa}.tr10-analysisStats>div:nth-child(2) strong{color:#76dbf4}.tr10-analysisStats>div:nth-child(3) strong{color:#e9b16a}.tr10-analysisSweep{height:66px;padding:10px 18px 11px;display:grid;grid-template-columns:repeat(10,1fr);gap:5px;align-items:end;border-top:1px solid rgba(75,145,170,.07);border-bottom:1px solid rgba(75,145,170,.07);background:repeating-linear-gradient(0deg,transparent 0,transparent 9px,rgba(78,158,187,.035) 10px)}.tr10-analysisSweep i{height:54%;border-radius:2px 2px 0 0;background:linear-gradient(180deg,#70e2ff,#29afd4);opacity:.35;animation:tr10Analyze 1.05s ease-in-out infinite alternate}.tr10-analysisSweep i:nth-child(2){animation-delay:.08s;height:78%}.tr10-analysisSweep i:nth-child(3){animation-delay:.16s;height:62%}.tr10-analysisSweep i:nth-child(4){animation-delay:.24s;height:88%}.tr10-analysisSweep i:nth-child(5){animation-delay:.32s;height:70%}.tr10-analysisSweep i:nth-child(6){animation-delay:.4s;height:82%}.tr10-analysisSweep i:nth-child(7){animation-delay:.48s;height:58%}.tr10-analysisSweep i:nth-child(8){animation-delay:.56s;height:72%}.tr10-analysisSweep i:nth-child(9){animation-delay:.64s;height:48%}.tr10-analysisSweep i:nth-child(10){animation-delay:.72s;height:63%}@keyframes tr10Analyze{from{transform:scaleY(.32);opacity:.25}to{transform:scaleY(1);opacity:.82}}.tr10-analysisModal>footer{padding:12px 16px 14px;display:grid;gap:3px}.tr10-analysisModal>footer span{color:#75dca9;font-size:7px;font-weight:1000;letter-spacing:.11em}.tr10-analysisModal>footer small{color:#69818b;font-size:7px}.tr10-reviewModal{width:min(850px,100%);display:grid;grid-template-rows:auto auto auto minmax(0,1fr) auto}.tr10-reviewHeader h2{margin:4px 0 2px}.tr10-reviewHeader p{margin:0;color:#738a94;font-size:8px}.tr10-reviewProgress{position:relative;padding:10px 13px;border-bottom:1px solid rgba(80,151,177,.1);overflow:hidden}.tr10-reviewProgress>div{display:flex;justify-content:space-between;gap:12px;color:#7d99a3;font-size:7px}.tr10-reviewProgress strong{color:#d8edf4}.tr10-reviewProgress>i{position:absolute;left:0;right:0;bottom:0;height:2px;transform-origin:left;background:#4dd7f8}.tr10-reviewInstruction{padding:10px 13px;border-bottom:1px solid rgba(80,151,177,.08);background:#061219}.tr10-reviewInstruction span{font-size:7px;font-weight:1000;color:#6edbf7}.tr10-reviewInstruction p{margin:4px 0 0;color:#7b929c;font-size:8px}.tr10-reviewModal .tr10-candidates{max-height:none;min-height:0}.tr10-picker{width:min(520px,100%)}.tr10-picker>div{max-height:330px;overflow:auto;padding:9px}.tr10-picker>div>label{min-height:52px;display:grid;grid-template-columns:28px 1fr;align-items:center;padding:8px;border-bottom:1px solid rgba(80,145,169,.08)}.tr10-picker>div strong{display:block;font-size:9px}.tr10-picker>div small{font-size:7px;color:#677f89}.tr10-newRoute{display:grid;gap:5px;padding:10px 13px}.tr10-newRoute span{font-size:6px;font-weight:1000;color:#617b85}.tr10-newRoute input{height:38px;padding:0 10px;border:1px solid rgba(75,151,178,.15);border-radius:8px;background:#06131a;color:#e8f5f9}
        .tr10-burnStudio{width:min(760px,100%);max-height:calc(100dvh - 32px);overflow:hidden;display:grid;grid-template-rows:auto minmax(0,1fr) auto;border:1px solid rgba(85,196,232,.34);border-radius:18px;background:linear-gradient(180deg,#0b1b24,#050c11);box-shadow:0 38px 110px rgba(0,0,0,.78),inset 0 1px rgba(255,255,255,.05)}
        .tr10-burnStudio>header{padding:15px 17px;display:flex;align-items:center;justify-content:space-between;gap:14px;border-bottom:1px solid rgba(93,166,192,.12);background:linear-gradient(180deg,#0c202a,#08151c)}.tr10-burnStudio>header span{color:#f5bd60;font-size:7px;font-weight:1000;letter-spacing:.15em}.tr10-burnStudio>header h2{margin:4px 0 2px;color:#f4fbfd;font-size:22px}.tr10-burnStudio>header p{margin:0;color:#79919b;font-size:8px}.tr10-burnStudio>header>button{width:36px;height:36px;border:1px solid rgba(112,165,184,.18);border-radius:10px;background:#071219;color:#dcecf1;font-size:20px}
        .tr10-burnBody{min-height:0;overflow:auto;padding:13px;display:grid;gap:11px}.tr10-burnModes{display:grid;grid-template-columns:1fr 1fr;gap:9px}.tr10-burnModes>button{min-height:104px;padding:12px;display:grid;align-content:start;gap:4px;text-align:left;border:1px solid rgba(104,166,187,.14);border-radius:12px;background:linear-gradient(180deg,#09161d,#050c10);color:#a6bac2}.tr10-burnModes>button b{font-size:12px;color:#e4f0f4}.tr10-burnModes>button span{font-size:7px;font-weight:1000;letter-spacing:.09em;color:#718b95}.tr10-burnModes>button small{margin-top:4px;font-size:8px;line-height:1.4;color:#758c95}.tr10-burnModes>button.is-active{border-color:rgba(244,181,78,.55);background:radial-gradient(480px 100px at 20% 0,rgba(244,181,78,.10),transparent 62%),linear-gradient(180deg,#17180f,#090d0d);box-shadow:inset 0 1px rgba(255,255,255,.04),0 16px 38px rgba(0,0,0,.28)}.tr10-burnModes>button.is-active b{color:#ffe1a0}.tr10-burnModes>button.is-active span{color:#d5a953}
        .tr10-burnStats{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}.tr10-burnStats>div{min-height:58px;padding:9px;display:grid;align-content:center;border:1px solid rgba(91,154,176,.11);border-radius:9px;background:#061016}.tr10-burnStats span{font-size:6px;font-weight:1000;letter-spacing:.1em;color:#657f89}.tr10-burnStats strong{margin-top:4px;color:#deedf2;font-size:14px;font-variant-numeric:tabular-nums}
        .tr10-burnMap{border:1px solid rgba(93,157,179,.11);border-radius:11px;overflow:hidden;background:#050d11}.tr10-burnMap>header{padding:8px 10px;display:flex;justify-content:space-between;border-bottom:1px solid rgba(93,157,179,.09)}.tr10-burnMap>header span{font-size:7px;font-weight:1000;letter-spacing:.11em;color:#8da8b2}.tr10-burnMap>header small{font-size:7px;color:#657e87}.tr10-burnMap article{padding:9px 10px;display:grid;grid-template-columns:145px minmax(0,1fr) 82px;gap:10px;align-items:center;border-bottom:1px solid rgba(92,147,166,.07)}.tr10-burnMap article:last-child{border-bottom:0}.tr10-burnMap article>div:first-child{display:grid;gap:2px}.tr10-burnMap article b{font-size:8px;color:#f0c779}.tr10-burnMap article span{font-size:7px;color:#77909a}.tr10-burnMap article>strong{text-align:right;font-size:9px;color:#cbdce2;font-variant-numeric:tabular-nums}.tr10-burnMeter{height:6px;overflow:hidden;border-radius:999px;background:#0d1a20}.tr10-burnMeter i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#26b6df,#f1b34f);box-shadow:0 0 10px rgba(70,204,241,.16)}
        .tr10-burnHelperNote{padding:11px 12px;display:grid;grid-template-columns:116px 1fr;gap:12px;align-items:start;border:1px solid rgba(83,178,210,.15);border-radius:10px;background:linear-gradient(180deg,rgba(8,29,38,.62),rgba(4,16,22,.72));box-shadow:inset 0 1px 0 rgba(255,255,255,.025)}.tr10-burnHelperNote b{font-size:7px;color:#78dff8;letter-spacing:.12em}.tr10-burnHelperNote span{font-size:8px;line-height:1.45;color:#9bb1b9}.tr10-burnStatus{padding:10px 12px;border:1px solid rgba(242,174,61,.24);border-radius:9px;background:rgba(85,53,8,.16);color:#efc77d;font-size:8px;font-weight:1000;letter-spacing:.04em}
        .tr10-burnProgressPanel{padding:13px;border:1px solid rgba(69,205,245,.30);border-top-color:rgba(137,229,255,.45);border-radius:12px;background:linear-gradient(180deg,#09202a,#061218);box-shadow:0 18px 38px rgba(0,0,0,.34),inset 0 1px 0 rgba(255,255,255,.055)}.tr10-burnProgressHead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.tr10-burnProgressHead>div{display:grid;gap:4px}.tr10-burnProgressHead span{font-size:7px;font-weight:1000;letter-spacing:.13em;color:#70d9f6}.tr10-burnProgressHead strong{font-size:11px;color:#eaf8fc}.tr10-burnProgressHead>b{font-size:20px;line-height:1;color:#f4c56d;font-variant-numeric:tabular-nums}.tr10-burnProgressTrack{height:8px;margin:11px 0 10px;overflow:hidden;border-radius:999px;background:#02070a;box-shadow:inset 0 1px 3px rgba(0,0,0,.8)}.tr10-burnProgressTrack i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#25bde8,#f0b64d);box-shadow:0 0 14px rgba(57,201,242,.22);transition:width .18s ease}.tr10-burnProgressSong{display:grid;gap:3px}.tr10-burnProgressSong strong{font-size:10px;color:#dfeff4}.tr10-burnProgressSong span{font-size:7px;color:#718a94}
        .tr10-burnComplete{padding:16px;display:grid;grid-template-columns:54px minmax(0,1fr);gap:14px;align-items:center;border:1px solid rgba(53,220,145,.38);border-top-color:rgba(138,255,200,.52);border-radius:13px;background:radial-gradient(520px 120px at 18% 0,rgba(52,218,144,.11),transparent 68%),linear-gradient(180deg,#0a2119,#06120e);box-shadow:0 22px 48px rgba(0,0,0,.40),inset 0 1px 0 rgba(255,255,255,.06)}.tr10-burnCompleteIcon{width:50px;height:50px;display:grid;place-items:center;border:1px solid rgba(79,225,159,.46);border-radius:14px;background:linear-gradient(180deg,#174a34,#0b2b1e);color:#8cf0ba;font-size:24px;font-weight:1000;box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 12px 24px rgba(0,0,0,.28)}.tr10-burnCompleteCopy{display:grid;gap:4px}.tr10-burnCompleteCopy>span{font-size:7px;font-weight:1000;letter-spacing:.14em;color:#71dda5}.tr10-burnCompleteCopy h3{margin:0;color:#f0fff7;font-size:18px;letter-spacing:.02em}.tr10-burnCompleteCopy p{margin:0;color:#b7d6c5;font-size:9px;font-weight:850}.tr10-burnCompleteCopy>strong{margin-top:4px;color:#dff9ea;font-size:9px}.tr10-burnCompleteCopy small{max-width:620px;color:#78988a;font-size:8px;line-height:1.45}
        .tr10-burnStudio.is-complete .tr10-burnModes>button:not(.is-active){opacity:.38}.tr10-burnStudio.is-complete .tr10-burnModes>button.is-active{cursor:default}.tr10-burnStudio>footer{padding:11px 13px;display:flex;justify-content:flex-end;gap:8px;border-top:1px solid rgba(83,154,180,.12);background:#061117}.tr10-burnStudio>footer.is-complete{justify-content:flex-end}.tr10-burnStudio>footer button{height:40px;padding:0 14px;border:1px solid rgba(83,164,194,.18);border-radius:9px;background:#07131a;color:#d3e4ea;font-size:7px;font-weight:1000}.tr10-burnStudio>footer button.is-primary{min-width:180px;border-color:rgba(244,181,78,.52);background:linear-gradient(180deg,#6b4715,#3b260b);color:#ffebbd;box-shadow:inset 0 1px rgba(255,255,255,.08),0 12px 28px rgba(0,0,0,.30)}.tr10-burnStudio>footer button.is-primary.is-ready{border-color:rgba(54,217,143,.52);background:linear-gradient(180deg,#176743,#0d3d28);color:#d9ffea;box-shadow:inset 0 1px rgba(255,255,255,.09),0 12px 28px rgba(0,0,0,.32)}

        @media(max-width:900px){.tr10-stats{grid-template-columns:repeat(3,1fr)}.tr10-tableHead,.tr10-row{grid-template-columns:28px minmax(0,1fr) 55px 100px}.tr10-tableHead span:last-child{display:none}.tr10-actions{grid-column:2/-1;justify-content:flex-start}.tr10-toolbar{grid-template-columns:1fr 1fr}.tr10-toolbar label:first-child{grid-column:1/-1}.tr10-playlistLayout{grid-template-columns:200px 1fr}.tr10-smart{grid-template-columns:1fr}}
        @media(max-width:650px){.tr10-burnModes{grid-template-columns:1fr}.tr10-burnStats{grid-template-columns:1fr 1fr}.tr10-burnMap article{grid-template-columns:98px minmax(0,1fr) 64px;gap:7px}.tr10-burnHelperNote{grid-template-columns:1fr;gap:4px}.tr10-burnComplete{grid-template-columns:42px minmax(0,1fr);padding:13px}.tr10-burnCompleteIcon{width:40px;height:40px;border-radius:11px;font-size:20px}.tr10-burnCompleteCopy h3{font-size:16px}.tr10-burnStudio>footer{display:grid;grid-template-columns:1fr 1fr}.tr10-burnStudio>footer.is-complete{grid-template-columns:1fr}.tr10-burnStudio>footer button.is-primary{min-width:0}.tr10-page{width:calc(100% - 14px)}.tr10-hero{padding:18px;display:block}.tr10-hero h1{font-size:30px}.tr10-hero>button{margin-top:12px}.tr10-stats{grid-template-columns:1fr 1fr}.tr10-sectionHead{display:block}.tr10-headActions{margin-top:10px;display:grid;grid-template-columns:1fr 1fr}.tr10-healthRail{grid-template-columns:repeat(5,minmax(112px,1fr));overflow-x:auto;padding-bottom:2px}.tr10-tabs{grid-template-columns:repeat(5,minmax(105px,1fr));overflow-x:auto}.tr10-statusPanelHead small{display:none}.tr10-toolbar{grid-template-columns:1fr}.tr10-toolbar label:first-child{grid-column:auto}.tr10-bulk{display:block}.tr10-bulk>div{margin-top:8px;display:grid;grid-template-columns:1fr 1fr}.tr10-tableHead{display:none}.tr10-row{grid-template-columns:26px minmax(0,1fr);gap:8px;padding:10px 9px}.tr10-row>.tr10-duration,.tr10-row>.tr10-energy{grid-column:2}.tr10-actions{grid-column:2;display:grid;grid-template-columns:40px 40px repeat(4,1fr)}.tr10-trackCell{grid-template-columns:auto auto minmax(0,1fr)}.tr10-healthBadge{grid-column:3;justify-self:start}.tr10-energy{width:150px}.tr10-order{display:none!important}.tr10-cardGrid{grid-template-columns:1fr;padding:9px}.tr10-playlistLayout{grid-template-columns:1fr}.tr10-playlistLayout>aside{border-right:0;border-bottom:1px solid rgba(78,143,166,.1);display:flex;overflow-x:auto}.tr10-createPlaylist{min-width:190px}.tr10-playlistLayout>aside>button{min-width:145px}.tr10-playlistSongs article{grid-template-columns:23px auto minmax(0,1fr) auto}.tr10-playlistSongs article>button:nth-of-type(n+2){display:none}.tr10-inspector{height:calc(100dvh - 16px)}.tr10-modalBack{padding:8px}.tr10-inspectGrid{grid-template-columns:1fr;padding:10px}.tr10-meta{grid-template-columns:1fr 1fr;padding:0 10px 10px}.tr10-inspectCommands{display:grid;grid-template-columns:1fr 1fr}.tr10-inspector>footer{display:grid;grid-template-columns:1fr 1fr}.tr10-inspector>footer .tr10-saveButton{grid-column:1/-1;grid-row:1}.tr10-detailLookupHead{display:block}.tr10-detailLookupHead>button{margin-bottom:8px}.tr10-detailCandidates>button,.tr10-candidates>button{grid-template-columns:52px minmax(0,1fr) 26px}.tr10-detailCandidates img,.tr10-candidates img,.tr10-candidateArt{width:52px;height:52px}.tr10-matchTier{grid-column:2;justify-self:start;text-align:left}.tr10-selectMark{grid-column:3;grid-row:1/3}.tr10-detailLookupFooter{display:grid;grid-template-columns:1fr 1fr}.tr10-detailLookupFooter>div{grid-column:1/-1}.tr10-reviewProgress>div{display:grid}.tr10-reviewDock{right:9px;bottom:80px}.tr10-smartBuild{padding:18px}}

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

        /* PRO FINAL PASS: dedicated reorder, compact energy, high contrast controls */
        .tr10-reorderConsole{margin:0 11px 10px;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid rgba(83,171,203,.14);border-radius:9px;background:#061218}.tr10-reorderConsole>div:first-child{display:grid;gap:2px}.tr10-reorderConsole span{color:#68daf9;font-size:6px;font-weight:1000;letter-spacing:.14em}.tr10-reorderConsole strong{color:#f3fbff;font-size:10px}.tr10-reorderConsole small{color:#9bb4be;font-size:7px}.tr10-reorderConsole>div:last-child{display:flex;gap:7px}.tr10-reorderConsole button{min-height:34px;padding:0 12px;border:1px solid rgba(97,179,209,.24);border-radius:7px;background:#0a1c25;color:#f5fbfe!important;font-size:7px;font-weight:1000;letter-spacing:.06em}.tr10-reorderConsole button.is-primary{border-color:rgba(64,208,250,.54);background:linear-gradient(180deg,#0d4051,#082530);color:#fff!important}.tr10-reorderConsole.is-active{border-color:rgba(68,209,249,.34);box-shadow:inset 3px 0 #45d0f5}.tr10-actions.is-reorder{display:grid!important;grid-template-columns:1fr 1fr!important}.tr10-reorderMove{color:#fff!important;border-color:rgba(67,202,244,.30)!important;background:linear-gradient(180deg,#0a2e3d,#071b24)!important}.tr10-order{display:none!important}.tr10-energy{width:76px!important;min-width:76px!important;max-width:76px!important;height:27px!important;padding:0 6px!important;border-radius:5px!important;font-size:6.4px!important;letter-spacing:.055em!important}.tr10-energySegments{gap:2px!important}.tr10-energySegments i{width:3px!important;height:8px!important;border-radius:1px!important}.tr10-energyLed{width:5px!important;height:5px!important}.tr10-actions button,.tr10-headActions button,.tr10-bulk button,.tr10-pager button,.tr10-inspectCommands button,.tr10-inspector>footer button,.tr10-reviewModal button,.tr10-picker button,.tr10-tabs button,.tr10-healthRail button{color:#f4fbfe!important;text-shadow:0 1px 0 rgba(0,0,0,.82)!important}.tr10-actions button:disabled,.tr10-reorderConsole button:disabled{color:rgba(225,239,245,.42)!important}.tr10-healthRail button.is-needs{color:#ffd9dc!important}.tr10-healthBadge.is-needs{color:#fff!important;background:#8b1f2a!important;border-color:#ff6974!important}.tr10-trackCell{overflow:hidden!important}.tr10-trackText{min-width:0!important;overflow:hidden!important}.tr10-trackText strong,.tr10-trackText span,.tr10-trackText small{max-width:100%!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}.tr10-analysisProgress{height:8px!important;background:#02090d!important}.tr10-analysisProgress i{display:block!important;height:100%!important;transform-origin:left center!important}.tr10-detailCandidates img,.tr10-candidates img{object-fit:cover;background:#09131a}.tr10-matchTier{color:#fff!important}.tr10-empty{color:#c8dce4!important}
        @media(max-width:650px){.tr10-reorderConsole{margin:0 8px 9px;display:grid;gap:8px}.tr10-reorderConsole>div:last-child{display:grid;grid-template-columns:1fr 1fr}.tr10-reorderConsole>div:last-child>button:only-child{grid-column:1/-1}.tr10-actions.is-reorder{grid-template-columns:1fr 1fr!important;grid-auto-rows:34px!important}.tr10-reorderMove{font-size:6.4px!important}.tr10-energy{width:70px!important;min-width:70px!important;max-width:70px!important;height:26px!important}.tr10-actions button{color:#fff!important;font-size:6.2px!important}.tr10-trackText strong{color:#fff!important}.tr10-trackText span{color:#bcd0d8!important}.tr10-trackText small{color:#8097a1!important}}
        /* AUG 9 LIBRARY CLARITY + DEDICATED ORDER COLUMN */
        .tr10-statusPanel{padding:11px 13px 13px!important;background:linear-gradient(180deg,#081821,#050d12)!important;border-bottom:1px solid rgba(108,190,219,.22)!important;box-shadow:inset 0 -1px rgba(0,0,0,.45)!important}
        .tr10-statusPanelHead{margin:0 1px 9px!important}
        .tr10-statusPanelHead span{color:#b8d7e2!important;font-size:8px!important;font-weight:1000!important;letter-spacing:.15em!important}
        .tr10-statusPanelHead small{color:#718f9b!important;font-size:7px!important;font-weight:900!important}
        .tr10-healthRail{gap:7px!important}
        .tr10-healthRail button{height:37px!important;padding:0 10px!important;border-radius:7px!important;color:#c5d7de!important;font-size:8.5px!important;letter-spacing:.055em!important;background:linear-gradient(180deg,#0a1b23,#061118)!important;border-color:rgba(112,183,208,.18)!important;text-shadow:none!important}
        .tr10-healthRail button b{min-width:25px!important;height:22px!important;color:#eef9fc!important;font-size:8.5px!important}
        .tr10-healthRail button.is-active{color:#fff!important;border-color:rgba(70,210,251,.58)!important;background:linear-gradient(180deg,#0b4052,#072531)!important;box-shadow:inset 0 -2px #43cef4!important}
        .tr10-healthRail button.is-needs{color:#ffdce0!important;border-color:rgba(255,87,98,.35)!important}
        .tr10-tabs{display:grid!important;grid-template-columns:repeat(5,1fr)!important;gap:5px!important;padding:6px 8px!important;background:#030a0f!important;border-top:1px solid rgba(255,255,255,.02)!important;border-bottom:1px solid rgba(112,183,208,.18)!important}
        .tr10-tabs button{height:43px!important;border:1px solid rgba(106,177,203,.14)!important;border-radius:7px!important;background:linear-gradient(180deg,#08171e,#050d12)!important;color:#c0d2d9!important;font-size:9.5px!important;font-weight:1000!important;letter-spacing:.07em!important;text-shadow:none!important}
        .tr10-tabs button:hover{color:#fff!important;border-color:rgba(86,211,250,.38)!important;background:#0a222c!important}
        .tr10-tabs button.is-active{color:#fff!important;border-color:rgba(72,210,250,.54)!important;background:linear-gradient(180deg,#0c3d4d,#08232d)!important;box-shadow:inset 0 -3px #46d0f6!important}
        .tr10-toolbar label>span{color:#9bb3bc!important;font-size:8px!important}
        .tr10-toolbar input,.tr10-toolbar select{color:#fff!important;font-size:9.5px!important}
        .tr10-reorderConsole{margin:0 12px 11px!important;padding:11px 13px!important;border-color:rgba(88,195,231,.23)!important;background:linear-gradient(180deg,#091b24,#061118)!important}
        .tr10-reorderConsole span{font-size:7.5px!important;color:#8fe5fb!important}.tr10-reorderConsole strong{font-size:11px!important}.tr10-reorderConsole small{font-size:8px!important;color:#abc0c8!important}
        .tr10-reorderConsole button{min-height:36px!important;color:#fff!important;font-size:8px!important}
        .tr10-table.is-reorder .tr10-tableHead,.tr10-table.is-reorder .tr10-row{grid-template-columns:70px minmax(0,1fr) 58px 72px minmax(300px,auto)!important}
        .tr10-orderHead{display:grid!important;place-items:center!important;color:#a9c7d1!important;font-size:7.5px!important;letter-spacing:.12em!important}
        .tr10-orderCell{align-self:stretch;display:grid!important;grid-template-columns:1fr!important;grid-template-rows:28px 22px 28px!important;gap:3px!important;place-items:center!important;padding:4px 7px!important;border-right:1px solid rgba(93,170,197,.12)!important;background:linear-gradient(180deg,rgba(9,35,45,.72),rgba(5,18,24,.86))!important}
        .tr10-orderCell b{display:grid;place-items:center;width:100%;height:22px;color:#effbff!important;font-size:9px!important;font-variant-numeric:tabular-nums;border:1px solid rgba(94,184,216,.17);border-radius:5px;background:#06141b}
        .tr10-orderCell button{width:100%!important;height:28px!important;padding:0!important;border:1px solid rgba(72,203,245,.28)!important;border-radius:6px!important;background:linear-gradient(180deg,#0b3544,#071d27)!important;color:#fff!important;font-size:15px!important;line-height:1!important;font-weight:1000!important;box-shadow:inset 0 1px rgba(255,255,255,.04)!important}
        .tr10-orderCell button:hover:not(:disabled){border-color:rgba(76,218,255,.68)!important;background:#0d4558!important}
        .tr10-orderCell button:disabled{opacity:.26!important}
        .tr10-row{min-height:72px!important;overflow:hidden!important}
        .tr10-art--row,.tr10-art--row img{overflow:hidden!important;object-fit:cover!important;object-position:center!important}
        .tr10-trackText strong{color:#fff!important;font-size:11px!important;line-height:1.2!important}.tr10-trackText span{color:#bfd2d9!important;font-size:8px!important}.tr10-trackText small{color:#8299a2!important;font-size:7px!important}
        .tr10-duration{color:#c1d2d9!important;font-size:8px!important}
        .tr10-energy{width:66px!important;min-width:66px!important;max-width:66px!important;height:24px!important;padding:0 5px!important;border-radius:4px!important;background:linear-gradient(180deg,#0c151a,#05090c)!important;border-color:rgba(166,200,211,.19)!important;box-shadow:inset 0 1px rgba(255,255,255,.035),inset 0 -1px rgba(0,0,0,.55)!important;font-size:7px!important;font-weight:1000!important;letter-spacing:.045em!important;text-shadow:none!important}
        .tr10-energyLed{width:4px!important;height:4px!important}.tr10-energySegments{gap:1px!important}.tr10-energySegments i{width:2px!important;height:7px!important;border-radius:0!important;opacity:.78!important}
        .tr10-actions{gap:6px!important}.tr10-actions button{min-height:32px!important;height:32px!important;padding:0 9px!important;border-radius:6px!important;color:#fff!important;font-size:8px!important;font-weight:1000!important;letter-spacing:.035em!important;border-color:rgba(116,184,208,.21)!important;background:linear-gradient(180deg,#0a1921,#061017)!important;text-shadow:none!important}
        .tr10-actions button:hover{border-color:rgba(76,210,251,.45)!important;background:#0b2732!important}
        .tr10-actions .is-edit{color:#fff!important;background:linear-gradient(180deg,#0b3a4a,#07212b)!important;border-color:rgba(70,205,247,.38)!important}
        .tr10-analysisProgress{height:7px!important;margin:12px 0!important;overflow:hidden!important;border:1px solid rgba(99,182,211,.18)!important;border-radius:999px!important;background:#02080c!important;box-shadow:inset 0 1px 3px rgba(0,0,0,.75)!important}
        .tr10-analysisProgress i{display:block!important;width:100%!important;height:100%!important;border-radius:999px!important;background:linear-gradient(90deg,#249cc4,#4ad7f8)!important;box-shadow:0 0 10px rgba(74,215,248,.20)!important;transform-origin:left center!important;transition:transform .18s ease!important}

        @media(max-width:650px){
          .tr10-page{width:calc(100% - 10px)!important}
          .tr10-statusPanel{padding:10px 8px!important}
          .tr10-statusPanelHead span{font-size:8.5px!important}.tr10-statusPanelHead small{display:none!important}
          .tr10-healthRail{grid-template-columns:repeat(5,minmax(106px,1fr))!important;gap:6px!important;overflow-x:auto!important;padding-bottom:3px!important;scrollbar-width:none!important}
          .tr10-healthRail::-webkit-scrollbar{display:none!important}
          .tr10-healthRail button{height:38px!important;font-size:8.5px!important}
          .tr10-tabs{display:flex!important;gap:6px!important;padding:7px!important;overflow-x:auto!important;scrollbar-width:none!important}
          .tr10-tabs::-webkit-scrollbar{display:none!important}
          .tr10-tabs button{flex:0 0 112px!important;min-width:112px!important;height:43px!important;font-size:9.2px!important}
          .tr10-reorderConsole{margin:0 7px 9px!important;padding:10px!important}.tr10-reorderConsole strong{font-size:11px!important}.tr10-reorderConsole small{font-size:8px!important;line-height:1.35!important}
          .tr10-table.is-reorder .tr10-tableHead{display:none!important}
          .tr10-row,.tr10-row.is-reorder{grid-template-columns:58px minmax(0,1fr)!important;grid-template-rows:auto 28px auto!important;gap:7px!important;padding:9px 7px!important;align-items:center!important}
          .tr10-row:not(.is-reorder){grid-template-columns:24px minmax(0,1fr)!important}
          .tr10-orderCell{grid-column:1!important;grid-row:1/4!important;align-self:stretch!important;grid-template-rows:34px 24px 34px!important;padding:3px 5px!important;border:1px solid rgba(73,199,239,.20)!important;border-radius:7px!important}
          .tr10-orderCell button{height:34px!important;font-size:17px!important}.tr10-orderCell b{height:24px!important;font-size:9px!important}
          .tr10-row.is-reorder .tr10-trackCell{grid-column:2!important;grid-row:1!important}
          .tr10-row.is-reorder>.tr10-duration{grid-column:2!important;grid-row:2!important;justify-self:start!important}
          .tr10-row.is-reorder>.tr10-energy{grid-column:2!important;grid-row:2!important;justify-self:end!important}
          .tr10-row.is-reorder>.tr10-actions{grid-column:2!important;grid-row:3!important}
          .tr10-trackCell{grid-template-columns:36px 40px minmax(0,1fr)!important;gap:7px!important}
          .tr10-art--row{width:40px!important;height:40px!important;min-width:40px!important;max-width:40px!important;min-height:40px!important;max-height:40px!important}
          .tr10-trackText strong{font-size:11.5px!important}.tr10-trackText span{font-size:8.2px!important}.tr10-trackText small{font-size:6.8px!important}
          .tr10-energy{width:62px!important;min-width:62px!important;max-width:62px!important;height:24px!important;font-size:6.8px!important}
          .tr10-actions{display:grid!important;grid-template-columns:34px 34px repeat(4,minmax(0,1fr))!important;gap:5px!important;width:100%!important}
          .tr10-actions button{min-width:0!important;height:34px!important;min-height:34px!important;padding:0 4px!important;font-size:7px!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
          .tr10-pager{font-size:8px!important}
        }
        @media(max-width:410px){
          .tr10-actions{grid-template-columns:34px 34px repeat(2,minmax(0,1fr))!important;grid-auto-rows:34px!important}
          .tr10-actions button:nth-child(n+5){grid-column:auto!important}
          .tr10-row,.tr10-row.is-reorder{padding-left:6px!important;padding-right:6px!important}
        }

        /* AUG 9 FINAL LIBRARY ORDER + READABILITY */
        .tr10-stats{grid-template-columns:repeat(4,minmax(0,1fr))!important}
        .tr10-stats strong{font-size:25px!important;color:#ffd27c!important}.tr10-stats span{font-size:10px!important;color:#b5cbd4!important}
        .tr10-hero{align-items:center!important;padding:18px 22px!important}.tr10-hero h1{margin:0!important;font-size:34px!important}.tr10-hero>button{font-size:10px!important;color:#fff!important}
        .tr10-sectionHead h2{font-size:23px!important;color:#fff!important}
        .tr10-tableHead,.tr10-row{grid-template-columns:60px 28px minmax(0,1fr) 62px 82px minmax(350px,auto)!important}
        .tr10-tableHead{font-size:9px!important;color:#a4bac3!important}.tr10-tableHead label{display:grid!important;place-items:center!important}
        .tr10-orderCell{align-self:stretch;display:grid!important;grid-template-columns:1fr!important;grid-template-rows:26px 18px 26px!important;gap:2px!important;place-items:center!important;padding:2px 6px!important;border-right:1px solid rgba(93,170,197,.12)!important;background:linear-gradient(180deg,rgba(9,35,45,.72),rgba(5,18,24,.86))!important}
        .tr10-orderCell b{display:grid!important;place-items:center!important;width:100%!important;height:18px!important;color:#effbff!important;font-size:9px!important;font-variant-numeric:tabular-nums!important}
        .tr10-orderCell button{width:100%!important;height:26px!important;padding:0!important;border:1px solid rgba(72,203,245,.28)!important;border-radius:6px!important;background:linear-gradient(180deg,#0b3544,#071d27)!important;color:#fff!important;font-size:16px!important;line-height:1!important;font-weight:1000!important}
        .tr10-orderCell button:hover:not(:disabled){border-color:rgba(76,218,255,.68)!important;background:#0d4558!important}.tr10-orderCell button:disabled{opacity:.28!important}
        .tr10-trackText strong{font-size:13px!important;color:#fff!important}.tr10-trackText span{font-size:10px!important;color:#c1d4dc!important}.tr10-trackText small{font-size:9px!important;color:#8ca4ae!important}
        .tr10-playbackError{display:block!important;margin-top:4px!important;color:#ffb0b5!important;font-size:9px!important;font-style:normal!important;font-weight:950!important;letter-spacing:.025em!important;white-space:normal!important}
        .tr10-duration{font-size:10px!important;color:#dce9ee!important}.tr10-energy{font-size:9px!important;color:#fff!important}
        .tr10-actions button{font-size:9px!important;color:#fff!important;min-height:34px!important}
        .tr10-healthRail button,.tr10-tabs button,.tr10-toolbar label>span,.tr10-toolbar input,.tr10-toolbar select,.tr10-headActions button,.tr10-pager{font-size:10px!important}
        @media(max-width:900px){
          .tr10-tableHead,.tr10-row{grid-template-columns:56px 26px minmax(0,1fr) 56px 78px!important}
          .tr10-tableHead span:last-child{display:none!important}.tr10-actions{grid-column:3/-1!important}
        }
        @media(max-width:650px){
          .tr10-stats{grid-template-columns:1fr 1fr!important;gap:7px!important}.tr10-stats>div{min-height:72px!important}.tr10-stats strong{font-size:22px!important}.tr10-stats span{font-size:9px!important}
          .tr10-hero{padding:14px 15px!important}.tr10-hero h1{font-size:29px!important}
          .tr10-row{grid-template-columns:50px 24px minmax(0,1fr)!important;grid-template-rows:auto 30px auto!important;gap:7px!important;padding:8px!important}
          .tr10-orderCell{grid-column:1!important;grid-row:1/4!important;grid-template-rows:34px 22px 34px!important;padding:3px 5px!important;border:1px solid rgba(73,199,239,.20)!important;border-radius:7px!important}
          .tr10-orderCell button{height:34px!important;font-size:18px!important}.tr10-orderCell b{height:22px!important;font-size:10px!important}
          .tr10-check{grid-column:2!important;grid-row:1!important;align-self:start!important;margin-top:10px!important}.tr10-check input{width:18px!important;height:18px!important}
          .tr10-trackCell{grid-column:3!important;grid-row:1!important;grid-template-columns:36px 42px minmax(0,1fr)!important;gap:7px!important}
          .tr10-trackText strong{font-size:13px!important}.tr10-trackText span{font-size:10px!important}.tr10-trackText small{font-size:8.5px!important}
          .tr10-row>.tr10-duration{grid-column:3!important;grid-row:2!important;font-size:10px!important}.tr10-row>.tr10-energy{grid-column:3!important;grid-row:2!important;justify-self:end!important}
          .tr10-actions{grid-column:3!important;grid-row:3!important;display:grid!important;grid-template-columns:36px 36px repeat(2,minmax(0,1fr))!important;grid-auto-rows:36px!important;gap:5px!important;width:100%!important}
          .tr10-actions button{min-width:0!important;height:36px!important;min-height:36px!important;padding:0 5px!important;font-size:8.5px!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
          .tr10-healthRail button,.tr10-tabs button{font-size:9.5px!important}.tr10-toolbar input,.tr10-toolbar select{font-size:12px!important}
        }

        /* FINAL MOBILE LIBRARY GEOMETRY */
        .tr10-orderCell{width:38px!important;min-width:38px!important;max-width:38px!important;grid-template-rows:22px 16px 22px!important;padding:2px!important;border-radius:6px!important;background:rgba(5,19,26,.74)!important}
        .tr10-orderCell button{width:30px!important;height:22px!important;min-height:22px!important;padding:0!important;border-radius:5px!important;font-size:12px!important;line-height:1!important;background:#082430!important;border-color:rgba(73,203,244,.24)!important}.tr10-orderCell b{height:16px!important;font-size:8px!important}
        .tr10-energy{box-sizing:border-box!important;width:78px!important;min-width:78px!important;max-width:78px!important;height:27px!important;padding:0 6px!important;overflow:hidden!important;color:#fff!important}
        .tr10-energy.is-low{border-color:rgba(75,220,143,.38)!important;background:linear-gradient(180deg,#0b3023,#061a13)!important;color:#caffdf!important}.tr10-energy.is-low .tr10-energyLed,.tr10-energy.is-low .tr10-energySegments i{background:#4cdd91!important}
        .tr10-energy.is-medium{border-color:rgba(72,204,244,.38)!important;background:linear-gradient(180deg,#0b3040,#061b24)!important;color:#d9f8ff!important}.tr10-energy.is-medium .tr10-energyLed,.tr10-energy.is-medium .tr10-energySegments i{background:#49cff3!important}
        .tr10-energy.is-high{border-color:rgba(244,177,74,.42)!important;background:linear-gradient(180deg,#3a2810,#1e1408)!important;color:#ffe5b1!important}.tr10-energy.is-high .tr10-energyLed,.tr10-energy.is-high .tr10-energySegments i{background:#f0aa43!important}
        @media(max-width:650px){
          .tr10-page{width:calc(100% - 8px)!important;overflow-x:hidden!important}.tr10-statusPanel,.tr10-library,.tr10-hero{min-width:0!important;overflow:hidden!important}
          .tr10-healthRail{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:6px!important;overflow:visible!important}.tr10-healthRail button{min-width:0!important;width:100%!important;padding:0 7px!important;font-size:9px!important;white-space:normal!important;line-height:1.05!important}.tr10-healthRail button:first-child{grid-column:1/-1!important}
          .tr10-tabs{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;overflow:visible!important;gap:6px!important}.tr10-tabs button{min-width:0!important;width:100%!important;flex:auto!important;font-size:10px!important}.tr10-tabs button:last-child{grid-column:1/-1!important}
          .tr10-toolbar{display:grid!important;grid-template-columns:1fr!important}.tr10-toolbar>*,.tr10-toolbar input,.tr10-toolbar select{width:100%!important;min-width:0!important;box-sizing:border-box!important}
          .tr10-tableHead{display:none!important}.tr10-row{display:grid!important;grid-template-columns:40px 24px minmax(0,1fr)!important;grid-template-rows:auto auto auto!important;gap:7px!important;padding:9px 7px!important;min-width:0!important;overflow:hidden!important}.tr10-orderCell{grid-column:1!important;grid-row:1/4!important;align-self:start!important;margin-top:1px!important}.tr10-check{grid-column:2!important;grid-row:1!important;margin-top:8px!important}.tr10-trackCell{grid-column:3!important;grid-row:1!important;min-width:0!important;grid-template-columns:34px 44px minmax(0,1fr)!important}.tr10-art--row{width:44px!important;height:44px!important;min-width:44px!important;min-height:44px!important;max-width:44px!important;max-height:44px!important}.tr10-trackText strong{font-size:14px!important}.tr10-trackText span{font-size:10.5px!important}.tr10-trackText small{font-size:9px!important}.tr10-row>.tr10-duration{grid-column:3!important;grid-row:2!important;justify-self:start!important;font-size:11px!important}.tr10-row>.tr10-energy{grid-column:3!important;grid-row:2!important;justify-self:end!important;width:78px!important;min-width:78px!important;max-width:78px!important;font-size:8.5px!important}.tr10-actions{grid-column:3!important;grid-row:3!important;display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;grid-auto-rows:38px!important;gap:5px!important;width:100%!important;min-width:0!important}.tr10-actions button{width:100%!important;min-width:0!important;min-height:38px!important;height:38px!important;padding:0 4px!important;font-size:9px!important;white-space:normal!important;line-height:1.05!important;overflow:visible!important;text-overflow:clip!important}.tr10-actions button svg{width:15px!important;height:15px!important}
        }
        @media(max-width:390px){.tr10-row{grid-template-columns:38px 22px minmax(0,1fr)!important;padding:8px 5px!important;gap:5px!important}.tr10-trackCell{grid-template-columns:32px 40px minmax(0,1fr)!important;gap:6px!important}.tr10-art--row{width:40px!important;height:40px!important;min-width:40px!important;min-height:40px!important;max-width:40px!important;max-height:40px!important}.tr10-actions{grid-template-columns:repeat(2,minmax(0,1fr))!important}.tr10-energy{width:74px!important;min-width:74px!important;max-width:74px!important}}

        /* AUG 9 FINAL LIBRARY DESKTOP + MOBILE */
        .tr10-orderCell{width:34px!important;min-width:34px!important;display:grid!important;grid-template-rows:20px 12px 20px!important;gap:1px!important;align-items:center!important;justify-items:center!important}
        .tr10-orderCell button{width:27px!important;height:20px!important;min-width:27px!important;min-height:20px!important;padding:0!important;border-radius:5px!important;font-size:13px!important;line-height:1!important;color:#eafaff!important;background:#09232d!important;border:1px solid rgba(73,197,235,.25)!important}
        .tr10-orderCell button:disabled{opacity:.24!important}
        .tr10-orderCell b{font-size:7px!important;line-height:1!important;color:#8fa8b2!important}
        .tr10-energy{width:78px!important;min-width:78px!important;max-width:78px!important;height:28px!important;padding:0 6px!important;grid-template-columns:7px minmax(0,1fr) 15px!important;gap:5px!important;overflow:visible!important;font-size:7px!important;letter-spacing:.05em!important}
        .tr10-energy.is-low{color:#76e8ac!important;border-color:rgba(64,210,142,.50)!important;background:linear-gradient(180deg,#0c281d,#07140f)!important}
        .tr10-energy.is-medium{color:#78e2fb!important;border-color:rgba(70,199,236,.52)!important;background:linear-gradient(180deg,#0b2631,#07151b)!important}
        .tr10-energy.is-high{color:#ffc66f!important;border-color:rgba(239,169,67,.58)!important;background:linear-gradient(180deg,#2c1f0d,#151006)!important}
        .tr10-energy>span{overflow:visible!important;text-overflow:clip!important}
        .tr10-energySegments{padding:1px 2px!important;gap:1px!important;width:15px!important}
        .tr10-row{overflow:visible!important}
        @media(max-width:650px){
          .tr10-page{width:calc(100% - 10px)!important;max-width:100%!important;margin-bottom:116px!important;overflow:visible!important}
          .tr10-hero{padding:15px 13px!important}
          .tr10-hero h1{font-size:31px!important}
          .tr10-stats{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:6px!important}
          .tr10-stats>div{min-width:0!important;padding:11px 8px!important}
          .tr10-stats strong{font-size:19px!important}
          .tr10-stats span{font-size:8px!important}
          .tr10-healthRail{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;overflow:visible!important;gap:6px!important}
          .tr10-healthRail button{min-width:0!important;width:100%!important;min-height:42px!important;padding:0 7px!important;font-size:9px!important;white-space:normal!important;line-height:1.15!important}
          .tr10-healthRail button:first-child{grid-column:1/-1!important}
          .tr10-tabs{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;overflow:visible!important;gap:5px!important}
          .tr10-tabs button{min-width:0!important;width:100%!important;min-height:41px!important;font-size:9px!important}
          .tr10-tabs button:last-child{grid-column:1/-1!important}
          .tr10-toolbar{grid-template-columns:1fr!important;gap:7px!important}
          .tr10-toolbar label{min-width:0!important;width:100%!important}
          .tr10-toolbar input,.tr10-toolbar select{width:100%!important;min-width:0!important;height:43px!important;font-size:12px!important}
          .tr10-table{overflow:visible!important}
          .tr10-row{display:grid!important;grid-template-columns:34px 22px minmax(0,1fr)!important;gap:7px!important;padding:10px 7px!important;align-items:start!important}
          .tr10-orderCell{grid-column:1!important;grid-row:1/4!important;display:grid!important;width:32px!important;min-width:32px!important}
          .tr10-check{grid-column:2!important;grid-row:1!important;padding-top:11px!important}
          .tr10-trackCell{grid-column:3!important;grid-row:1!important;min-width:0!important;grid-template-columns:34px 46px minmax(0,1fr)!important;gap:7px!important}
          .tr10-play{width:34px!important;height:34px!important;min-width:34px!important}
          .tr10-artwork,.tr10-artwork img{width:46px!important;height:46px!important;min-width:46px!important;max-width:46px!important}
          .tr10-trackText strong{font-size:13px!important;line-height:1.2!important}
          .tr10-trackText span{font-size:10.5px!important;line-height:1.25!important}
          .tr10-trackText small{font-size:9px!important}
          .tr10-healthBadge{grid-column:3!important;justify-self:start!important;margin-top:5px!important;font-size:8px!important}
          .tr10-duration{grid-column:3!important;grid-row:2!important;justify-self:start!important;font-size:10px!important;color:#dbeaf0!important}
          .tr10-energy{grid-column:3!important;grid-row:2!important;justify-self:end!important;width:78px!important;min-width:78px!important;max-width:78px!important;height:28px!important}
          .tr10-actions{grid-column:3!important;grid-row:3!important;display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:5px!important;width:100%!important}
          .tr10-actions button{min-width:0!important;width:100%!important;min-height:36px!important;padding:0 4px!important;font-size:8px!important;white-space:normal!important;line-height:1.1!important;overflow:visible!important;text-overflow:clip!important}
          .tr10-playbackError{font-size:9px!important;white-space:normal!important;line-height:1.25!important}
          .tr10-orderCell button{width:26px!important;height:20px!important;font-size:12px!important}
          .tr10-orderCell b{font-size:7px!important}
        }
        @media(max-width:380px){.tr10-actions{grid-template-columns:repeat(2,minmax(0,1fr))!important}.tr10-trackCell{grid-template-columns:32px 42px minmax(0,1fr)!important}.tr10-artwork,.tr10-artwork img{width:42px!important;height:42px!important;min-width:42px!important;max-width:42px!important}}

        /* AUG 9 LOCKED LIBRARY / SMART MIX / DISCOVER */
        .tr10-stats{grid-template-columns:repeat(4,minmax(0,1fr))!important}
        .tr10-tabs{display:grid!important;grid-template-columns:repeat(6,minmax(0,1fr))!important;gap:0!important}
        .tr10-tabs button{min-width:0!important;white-space:normal!important;line-height:1.15!important;padding:11px 6px!important;color:#d8eef6!important;font-size:9px!important}
        .tr10-orderCell{display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;gap:3px!important;width:28px!important;min-width:28px!important}
        .tr10-orderCell b{display:none!important}
        .tr10-orderCell button{width:24px!important;height:22px!important;min-height:22px!important;padding:0!important;border-radius:6px!important;font-size:13px!important;line-height:1!important;color:#e7f8ff!important;background:#0a202a!important;border:1px solid rgba(83,194,232,.28)!important}
        .tr10-energy{min-width:84px!important;max-width:100%!important;overflow:visible!important;white-space:nowrap!important}
        .tr10-energy.is-low{border-color:rgba(57,218,137,.48)!important;color:#8cf0b7!important;background:linear-gradient(180deg,rgba(11,74,48,.72),rgba(5,35,23,.9))!important}.tr10-energy.is-low .tr10-energyLed,.tr10-energy.is-low .tr10-energySegments i{background:#45e491!important}
        .tr10-energy.is-medium{border-color:rgba(71,204,242,.5)!important;color:#9ce9ff!important;background:linear-gradient(180deg,rgba(8,66,88,.74),rgba(4,31,43,.92))!important}.tr10-energy.is-medium .tr10-energyLed,.tr10-energy.is-medium .tr10-energySegments i{background:#49d6fa!important}
        .tr10-energy.is-high{border-color:rgba(255,180,65,.52)!important;color:#ffd18a!important;background:linear-gradient(180deg,rgba(92,54,9,.76),rgba(43,25,4,.94))!important}.tr10-energy.is-high .tr10-energyLed,.tr10-energy.is-high .tr10-energySegments i{background:#ffb548!important}
        .tr10-actions .tr10-likeAction,.tr10-actions .tr10-lessAction{display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:5px!important;min-width:72px!important;white-space:nowrap!important}.tr10-actions .tr10-likeAction span,.tr10-actions .tr10-lessAction span{font-size:7px!important;font-weight:1000!important}
        .tr10-actions .tr10-likeAction{color:#ffd84d!important;border-color:rgba(255,216,77,.30)!important}.tr10-actions .tr10-likeAction.is-liked{color:#fff!important;border-color:#45e394!important;background:linear-gradient(180deg,#13945c,#087044)!important;box-shadow:0 0 14px rgba(49,218,137,.2)!important}
        .tr10-actions .tr10-lessAction{color:#ff747c!important;border-color:rgba(255,83,96,.3)!important}.tr10-actions .tr10-lessAction.is-down{color:#fff!important;border-color:#ff5360!important;background:linear-gradient(180deg,#c42d39,#8c1520)!important;box-shadow:0 0 14px rgba(230,50,64,.18)!important}
        .tr10-savedMixes{display:grid;gap:8px}.tr10-savedMixHead{display:flex;align-items:center;justify-content:space-between}.tr10-savedMixHead span{font-size:9px;font-weight:1000;letter-spacing:.12em;color:#6ed9fa}.tr10-savedMixHead b{font-size:11px;color:#f7ca75}.tr10-savedMixes article{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:13px 14px;border:1px solid rgba(83,169,201,.16);border-radius:12px;background:linear-gradient(180deg,#081923,#050d12)}.tr10-savedMixes article.is-playing{border-color:rgba(71,215,255,.5);box-shadow:inset 3px 0 #42d7ff}.tr10-savedMixes article h3{margin:3px 0;font-size:16px;color:#fff}.tr10-savedMixes article p{margin:0;color:#8da8b3;font-size:10px}.tr10-savedMixes article>div:last-child{display:flex;gap:7px;flex-wrap:wrap}.tr10-savedMixes article button{min-height:34px;padding:0 11px;border:1px solid rgba(80,174,208,.22);border-radius:8px;background:#07151c;color:#fff;font-size:8px;font-weight:1000}.tr10-savedMixes article button.is-primary{border-color:rgba(255,183,72,.48);background:linear-gradient(180deg,#f2a534,#b96910);color:#171006}
        .tr10-discover{padding:15px;display:grid;gap:14px}.tr10-discoverHead{display:flex;align-items:center;justify-content:space-between;gap:18px}.tr10-discoverHead>div:first-child>span,.tr10-discoverSeed header small{font-size:8px;font-weight:1000;letter-spacing:.14em;color:#6ed9fa}.tr10-discoverHead h2{margin:4px 0;font-size:22px}.tr10-discoverHead p,.tr10-discoverSeed header p{margin:0;color:#8da5af;font-size:10px}.tr10-discoverSummary{min-width:132px;padding:9px 12px;display:grid;grid-template-columns:auto 1fr;grid-template-areas:"count label" "count meta";column-gap:8px;align-items:center;border-left:2px solid #f1b352;background:linear-gradient(90deg,rgba(241,179,82,.10),rgba(241,179,82,.02));border-radius:8px}.tr10-discoverSummary strong{grid-area:count;color:#ffd17f;font-size:25px;line-height:1;font-weight:1000}.tr10-discoverSummary span{grid-area:label;color:#f4f8fa;font-size:9px;font-weight:1000;letter-spacing:.08em}.tr10-discoverSummary small{grid-area:meta;color:#8499a2;font-size:7px;font-weight:900;letter-spacing:.06em}.tr10-discoverSeed{border-top:1px solid rgba(98,177,205,.12);padding-top:13px}.tr10-discoverSeed>header{display:flex;justify-content:space-between;gap:12px;align-items:center}.tr10-discoverSeed h3{margin:3px 0;font-size:18px}.tr10-discoverSeed>header button{min-height:30px;padding:0 9px;border:1px solid rgba(255,95,105,.22);border-radius:8px;background:#1a090b;color:#ff9298;font-size:7px;font-weight:1000}.tr10-discoverGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:10px}.tr10-discoverGrid article{display:grid;grid-template-columns:68px minmax(0,1fr);gap:10px;padding:10px;border:1px solid rgba(91,169,197,.15);border-radius:11px;background:#061118;min-width:0}.tr10-discoverGrid article>img,.tr10-discoverArt{width:68px;height:68px;object-fit:cover;border-radius:8px;background:#0b1a21;display:grid;place-items:center}.tr10-discoverGrid article>div{min-width:0;display:grid;align-content:start;gap:2px}.tr10-discoverGrid article strong{font-size:12px;color:#fff;line-height:1.25;white-space:normal;word-break:break-word}.tr10-discoverGrid article span{font-size:9px;color:#b6cdd6;white-space:normal;word-break:break-word}.tr10-discoverGrid article p{margin:3px 0 0;font-size:8px;color:#7895a0}.tr10-discoverGrid article footer{grid-column:1/-1;display:flex;gap:6px;flex-wrap:wrap}.tr10-discoverGrid article footer button,.tr10-discoverGrid article footer b{min-height:30px;padding:0 9px;display:inline-flex;align-items:center;border:1px solid rgba(96,175,203,.17);border-radius:8px;background:#08151b;color:#e8f6fa;font-size:7px;font-weight:1000}.tr10-discoverGrid article footer button.is-toAdd{border-color:rgba(255,191,77,.44);color:#ffd37f;background:#241705}.tr10-discoverGrid article footer b{border-color:rgba(68,211,149,.35);color:#8ee9b7;background:#092319}
        @media(max-width:650px){
          .tr10-page{width:calc(100% - 12px)!important;margin-bottom:112px!important}.tr10-hero{padding:13px 12px!important}.tr10-hero h1{font-size:28px!important}.tr10-stats{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:6px!important}.tr10-stats>div{min-height:62px!important}.tr10-stats strong{font-size:19px!important}.tr10-tabs{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important}.tr10-tabs button{font-size:8px!important;min-height:42px!important;padding:7px 4px!important;overflow:visible!important}.tr10-healthRail{grid-template-columns:repeat(2,minmax(0,1fr))!important}.tr10-healthRail button{height:38px!important;font-size:7px!important}.tr10-healthRail button span{white-space:normal!important;overflow:visible!important;text-overflow:clip!important;line-height:1.1!important}.tr10-healthRail button:first-child{grid-column:1/-1!important}.tr10-toolbar{grid-template-columns:1fr 1fr!important}.tr10-toolbar label:first-child{grid-column:1/-1!important}.tr10-tableHead{display:none!important}.tr10-row{display:grid!important;grid-template-columns:30px 24px minmax(0,1fr)!important;grid-template-areas:"order check track" "order . duration" "energy energy energy" "actions actions actions"!important;gap:7px 8px!important;padding:11px 9px!important;align-items:start!important}.tr10-orderCell{grid-area:order!important;align-self:start!important;width:26px!important;min-width:26px!important;gap:4px!important}.tr10-orderCell button{width:24px!important;height:23px!important}.tr10-check{grid-area:check!important;padding-top:6px!important}.tr10-trackCell{grid-area:track!important;grid-template-columns:36px 48px minmax(0,1fr)!important;gap:7px!important;min-width:0!important}.tr10-trackText strong{font-size:12px!important;line-height:1.25!important;white-space:normal!important;overflow:visible!important;text-overflow:clip!important;word-break:break-word!important}.tr10-trackText span,.tr10-trackText small{font-size:8px!important;white-space:normal!important;overflow:visible!important;text-overflow:clip!important;word-break:break-word!important}.tr10-duration{grid-area:duration!important;justify-self:start!important;margin-left:91px!important;font-size:9px!important}.tr10-energy{grid-area:energy!important;justify-self:start!important;width:auto!important;min-width:98px!important;min-height:32px!important}.tr10-actions{grid-area:actions!important;display:flex!important;flex-wrap:wrap!important;gap:5px!important;min-width:0!important}.tr10-actions button{min-height:34px!important;padding:0 8px!important;font-size:7px!important;white-space:nowrap!important}.tr10-actions .tr10-likeAction,.tr10-actions .tr10-lessAction{min-width:82px!important}.tr10-headActions{flex-wrap:wrap!important;justify-content:flex-end!important}.tr10-headActions button{min-height:36px!important}.tr10-smart{grid-template-columns:1fr!important}.tr10-savedMixes article{align-items:flex-start!important;flex-direction:column!important}.tr10-discover{padding:10px!important}.tr10-discoverHead{flex-direction:column!important;align-items:stretch!important}.tr10-discoverSummary{align-self:flex-start!important;min-width:126px!important;padding:8px 10px!important}.tr10-discoverSummary strong{font-size:22px!important}.tr10-discoverGrid{grid-template-columns:1fr!important}.tr10-playlistLayout{grid-template-columns:1fr!important}.tr10-playlistLayout aside{max-height:none!important}.tr10-playlistSongs article{grid-template-columns:34px 42px minmax(0,1fr) repeat(2,34px)!important}.tr10-playlistSongs article>.is-danger{grid-column:3/-1!important;justify-self:start!important}.tr10-picker,.tr10-inspector,.tr10-reviewModal,.tr10-analysisModal{max-height:calc(100dvh - 18px)!important;width:calc(100% - 12px)!important;overflow:auto!important}
        }


        /* AUG 9 FINAL LIBRARY POLISH: compact desktop rows + deliberate mobile cards */
        .tr10-page{min-width:0!important;overflow-x:hidden!important}
        .tr10-table{border-radius:12px!important;overflow:hidden!important}
        .tr10-tableHead,.tr10-row{grid-template-columns:42px 26px minmax(240px,1fr) 54px 76px minmax(390px,auto)!important}
        .tr10-tableHead{min-height:34px!important;padding:0 9px!important;font-size:8px!important;letter-spacing:.09em!important}
        .tr10-row{min-height:62px!important;padding:6px 9px!important;gap:7px!important;border-top:1px solid rgba(99,160,182,.085)!important;background:linear-gradient(180deg,rgba(8,21,28,.92),rgba(4,11,15,.96))!important;overflow:visible!important}
        .tr10-row:hover{background:linear-gradient(180deg,rgba(10,31,40,.96),rgba(5,15,20,.98))!important}
        .tr10-row.is-current{box-shadow:inset 3px 0 #48d7fa!important;background:linear-gradient(90deg,rgba(21,104,132,.18),rgba(5,15,20,.97) 24%)!important}
        .tr10-orderCell{width:32px!important;min-width:32px!important;display:grid!important;grid-template-columns:1fr!important;gap:2px!important;align-content:center!important}
        .tr10-orderCell button{width:28px!important;height:23px!important;min-height:23px!important;padding:0!important;border-radius:6px!important;font-size:12px!important;background:#07161d!important;border-color:rgba(100,177,202,.17)!important}
        .tr10-trackCell{grid-template-columns:32px 48px minmax(0,1fr)!important;gap:8px!important;align-items:center!important}
        .tr10-art--row,.tr10-artwork{width:48px!important;height:48px!important;min-width:48px!important;min-height:48px!important;max-width:48px!important;max-height:48px!important;border-radius:7px!important}
        .tr10-play{width:30px!important;height:30px!important;min-width:30px!important;min-height:30px!important}
        .tr10-trackText{min-width:0!important;gap:2px!important}
        .tr10-trackText strong{font-size:12px!important;line-height:1.2!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;color:#f7fbfd!important}
        .tr10-trackText span{font-size:9px!important;line-height:1.25!important;color:#aac1ca!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
        .tr10-trackText small{font-size:7.5px!important;line-height:1.2!important;color:#607b86!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
        .tr10-duration{font-size:9px!important;color:#b7cbd2!important}
        .tr10-energy{height:29px!important;min-height:29px!important;min-width:72px!important;width:72px!important;padding:0 7px!important;font-size:8px!important;border-radius:7px!important}
        .tr10-energySegments{display:none!important}
        .tr10-actions{display:flex!important;align-items:center!important;justify-content:flex-end!important;gap:4px!important;flex-wrap:nowrap!important;min-width:0!important}
        .tr10-actions button{height:29px!important;min-height:29px!important;min-width:0!important;padding:0 7px!important;border-radius:6px!important;font-size:7.5px!important;white-space:nowrap!important;line-height:1!important;overflow:visible!important;text-overflow:clip!important}
        .tr10-actions .tr10-likeAction,.tr10-actions .tr10-lessAction{min-width:60px!important;color:#eef7fa!important;border-color:rgba(116,184,208,.20)!important;background:linear-gradient(180deg,#0a1921,#061017)!important}
        .tr10-actions .tr10-likeAction.is-liked{color:#fff!important;border-color:#45e394!important;background:linear-gradient(180deg,#13945c,#087044)!important}
        .tr10-actions .tr10-lessAction.is-down{color:#fff!important;border-color:#ff5360!important;background:linear-gradient(180deg,#c42d39,#8c1520)!important}
        .tr10-actions .tr10-likeAction span,.tr10-actions .tr10-lessAction span{font-size:7px!important}
        .tr10-discoverConfidence{grid-column:1/-1;padding:20px 14px;border:1px solid rgba(102,177,201,.12);border-radius:10px;background:#061118;color:#9db5be;font-size:11px;line-height:1.5;text-align:center}
        .tr10-discoverGrid{grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:8px!important}
        .tr10-discoverGrid article{grid-template-columns:58px minmax(0,1fr)!important;gap:8px!important;padding:8px!important;border-radius:10px!important}
        .tr10-discoverGrid article>img,.tr10-discoverArt{width:58px!important;height:58px!important;border-radius:7px!important}
        .tr10-discoverGrid article strong{font-size:11px!important}.tr10-discoverGrid article span{font-size:8.5px!important}.tr10-discoverGrid article p{font-size:7.5px!important;line-height:1.35!important}
        .tr10-discoverGrid article footer{gap:4px!important}.tr10-discoverGrid article footer button,.tr10-discoverGrid article footer b{min-height:28px!important;padding:0 7px!important;font-size:6.8px!important}

        @media(max-width:1100px){
          .tr10-tableHead,.tr10-row{grid-template-columns:38px 24px minmax(210px,1fr) 48px 70px!important}
          .tr10-tableHead span:last-child{display:none!important}
          .tr10-actions{grid-column:3/-1!important;justify-content:flex-start!important;flex-wrap:wrap!important;padding-top:4px!important}
          .tr10-row{grid-template-rows:auto auto!important}
        }
        @media(max-width:650px){
          .tr10-page{width:calc(100% - 8px)!important}
          .tr10-row{display:grid!important;grid-template-columns:30px 22px 42px minmax(0,1fr)!important;grid-template-areas:"order check art copy" "order . meta meta" "actions actions actions actions"!important;grid-template-rows:auto auto auto!important;gap:6px!important;padding:8px 7px!important;min-height:0!important;border-radius:0!important;overflow:visible!important}
          .tr10-orderCell{grid-area:order!important;width:28px!important;min-width:28px!important;align-self:start!important;padding-top:1px!important}
          .tr10-orderCell button{width:27px!important;height:24px!important}
          .tr10-check{grid-area:check!important;padding-top:10px!important}
          .tr10-trackCell{grid-column:3/5!important;grid-row:1!important;display:grid!important;grid-template-columns:42px minmax(0,1fr)!important;grid-template-areas:"art copy"!important;gap:7px!important;align-items:center!important}
          .tr10-trackCell>.tr10-play{position:absolute!important;margin-left:5px!important;margin-top:5px!important;z-index:2!important;width:32px!important;height:32px!important;background:rgba(2,8,12,.80)!important;backdrop-filter:blur(3px)!important}
          .tr10-trackCell>.tr10-artwork,.tr10-trackCell>.tr10-art--row{grid-area:art!important;width:42px!important;height:42px!important;min-width:42px!important;min-height:42px!important;max-width:42px!important;max-height:42px!important}
          .tr10-trackText{grid-area:copy!important;min-width:0!important}
          .tr10-trackText strong{font-size:13px!important;line-height:1.2!important;white-space:normal!important;display:-webkit-box!important;-webkit-box-orient:vertical!important;-webkit-line-clamp:2!important;overflow:hidden!important}
          .tr10-trackText span{font-size:9.5px!important;white-space:normal!important;display:-webkit-box!important;-webkit-box-orient:vertical!important;-webkit-line-clamp:1!important;overflow:hidden!important}
          .tr10-trackText small{display:none!important}
          .tr10-healthBadge{display:none!important}
          .tr10-row>.tr10-duration{grid-column:3!important;grid-row:2!important;justify-self:start!important;margin:0!important;font-size:9px!important;align-self:center!important}
          .tr10-row>.tr10-energy{grid-column:4!important;grid-row:2!important;justify-self:end!important;width:78px!important;min-width:78px!important;height:29px!important}
          .tr10-actions{grid-area:actions!important;display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:4px!important;width:100%!important;padding:1px 0 0!important}
          .tr10-actions button,.tr10-actions .tr10-likeAction,.tr10-actions .tr10-lessAction{width:100%!important;min-width:0!important;height:34px!important;min-height:34px!important;padding:0 4px!important;font-size:7.5px!important;white-space:normal!important;line-height:1.05!important;overflow:visible!important;text-overflow:clip!important}
          .tr10-actions .tr10-likeAction span,.tr10-actions .tr10-lessAction span{font-size:6.8px!important}
          .tr10-discoverGrid{grid-template-columns:1fr!important}
          .tr10-discoverGrid article{grid-template-columns:54px minmax(0,1fr)!important;padding:8px!important}
          .tr10-discoverGrid article>img,.tr10-discoverArt{width:54px!important;height:54px!important}
          .tr10-tabs button{font-size:9px!important;line-height:1.15!important;min-height:44px!important;white-space:normal!important;overflow:visible!important;text-overflow:clip!important}
          .tr10-healthRail button span{font-size:8px!important;white-space:normal!important;overflow:visible!important;text-overflow:clip!important}
        }
        @media(max-width:380px){
          .tr10-row{grid-template-columns:28px 20px 40px minmax(0,1fr)!important;padding:7px 5px!important;gap:5px!important}
          .tr10-actions{grid-template-columns:repeat(2,minmax(0,1fr))!important}
          .tr10-tabs{grid-template-columns:repeat(2,minmax(0,1fr))!important}
        }

        /* FINAL NO-CUTOFF / READABLE LIBRARY DENSITY */
        .tr10-row{height:auto!important}
        .tr10-trackText strong,.tr10-trackText span{display:block!important;white-space:normal!important;overflow:visible!important;text-overflow:clip!important;-webkit-line-clamp:unset!important;-webkit-box-orient:initial!important;overflow-wrap:anywhere!important}
        .tr10-trackText strong{font-size:13px!important;line-height:1.22!important}
        .tr10-trackText span{font-size:10px!important;line-height:1.28!important}
        .tr10-trackText small{display:none!important}
        .tr10-actions button{font-size:8.5px!important;font-weight:950!important}
        @media(max-width:650px){
          .tr10-trackText strong{font-size:14px!important;line-height:1.22!important}
          .tr10-trackText span{font-size:10.5px!important;line-height:1.3!important}
          .tr10-actions button,.tr10-actions .tr10-likeAction,.tr10-actions .tr10-lessAction{font-size:9.5px!important;line-height:1.12!important;min-height:37px!important}
          .tr10-actions .tr10-likeAction span,.tr10-actions .tr10-lessAction span{font-size:8.5px!important}
          .tr10-duration{font-size:10px!important}.tr10-energy{font-size:9px!important}
        }


        /* AUG 9 AUTHORITATIVE MOBILE LIBRARY V3: compact rows, artwork never covered */
        @media(max-width:650px){
          .tr10-row{
            display:grid!important;
            grid-template-columns:28px 20px minmax(0,1fr)!important;
            grid-template-rows:auto 29px auto!important;
            gap:5px 6px!important;
            padding:7px 6px!important;
            min-height:0!important;
            overflow:hidden!important;
            align-items:center!important;
          }
          .tr10-orderCell{grid-column:1!important;grid-row:1/3!important;width:28px!important;min-width:28px!important;align-self:start!important;padding-top:1px!important;gap:3px!important}
          .tr10-orderCell button{width:27px!important;height:23px!important;min-height:23px!important;border-radius:6px!important;font-size:12px!important}
          .tr10-check{grid-column:2!important;grid-row:1!important;align-self:center!important;padding:0!important;margin:0!important}
          .tr10-trackCell{
            grid-column:3!important;grid-row:1!important;
            display:grid!important;
            grid-template-columns:30px 44px minmax(0,1fr)!important;
            grid-template-rows:auto!important;
            grid-template-areas:"play art copy"!important;
            align-items:center!important;gap:6px!important;min-width:0!important;
          }
          .tr10-trackCell>.tr10-play{
            grid-area:play!important;position:static!important;inset:auto!important;margin:0!important;z-index:auto!important;
            width:30px!important;height:30px!important;min-width:30px!important;min-height:30px!important;padding:0!important;
            border-radius:7px!important;background:linear-gradient(180deg,#ffc45b,#f29514)!important;backdrop-filter:none!important;color:#1b1104!important;
          }
          .tr10-trackCell>.tr10-play.is-playing{background:linear-gradient(180deg,#74e9ff,#2ebedc)!important;color:#041117!important}
          .tr10-trackCell>.tr10-artwork,.tr10-trackCell>.tr10-art--row,.tr10-trackCell>.tr10-art{
            grid-area:art!important;position:static!important;margin:0!important;width:44px!important;height:44px!important;min-width:44px!important;min-height:44px!important;max-width:44px!important;max-height:44px!important;border-radius:7px!important;overflow:hidden!important;
          }
          .tr10-trackCell>.tr10-artwork img,.tr10-trackCell>.tr10-art--row img,.tr10-trackCell>.tr10-art img{display:block!important;width:100%!important;height:100%!important;object-fit:cover!important}
          .tr10-trackText{grid-area:copy!important;min-width:0!important;padding:0!important}
          .tr10-trackText strong{font-size:12.5px!important;line-height:1.18!important;display:-webkit-box!important;-webkit-box-orient:vertical!important;-webkit-line-clamp:2!important;overflow:hidden!important;overflow-wrap:anywhere!important}
          .tr10-trackText span{margin-top:2px!important;font-size:9px!important;line-height:1.2!important;display:-webkit-box!important;-webkit-box-orient:vertical!important;-webkit-line-clamp:1!important;overflow:hidden!important;color:#9eb5be!important}
          .tr10-trackText small,.tr10-healthBadge{display:none!important}
          .tr10-row>.tr10-duration{grid-column:3!important;grid-row:2!important;justify-self:start!important;align-self:center!important;margin-left:36px!important;font-size:9px!important;line-height:1!important;color:#a9c0c9!important}
          .tr10-row>.tr10-energy{grid-column:3!important;grid-row:2!important;justify-self:end!important;align-self:center!important;width:72px!important;min-width:72px!important;height:27px!important;min-height:27px!important;padding:0 6px!important;font-size:8px!important;border-radius:7px!important}
          .tr10-actions{
            grid-column:1/-1!important;grid-row:3!important;width:100%!important;padding:1px 0 0!important;margin:0!important;
            display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:4px!important;
          }
          .tr10-actions button,.tr10-actions .tr10-likeAction,.tr10-actions .tr10-lessAction{
            width:100%!important;min-width:0!important;height:30px!important;min-height:30px!important;padding:0 4px!important;border-radius:6px!important;
            font-size:7.5px!important;line-height:1.05!important;font-weight:950!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;
          }
          .tr10-actions .tr10-likeAction,.tr10-actions .tr10-lessAction{display:flex!important;align-items:center!important;justify-content:center!important;gap:3px!important}
          .tr10-actions .tr10-likeAction span,.tr10-actions .tr10-lessAction span{font-size:7px!important;line-height:1!important}
        }
        @media(max-width:380px){
          .tr10-row{grid-template-columns:26px 18px minmax(0,1fr)!important;padding:6px 5px!important;gap:5px!important}
          .tr10-trackCell{grid-template-columns:28px 40px minmax(0,1fr)!important;gap:5px!important}
          .tr10-trackCell>.tr10-play{width:28px!important;height:28px!important;min-width:28px!important;min-height:28px!important}
          .tr10-trackCell>.tr10-artwork,.tr10-trackCell>.tr10-art--row,.tr10-trackCell>.tr10-art{width:40px!important;height:40px!important;min-width:40px!important;min-height:40px!important;max-width:40px!important;max-height:40px!important}
          .tr10-trackText strong{font-size:11.5px!important}.tr10-trackText span{font-size:8.5px!important}
          .tr10-actions{grid-template-columns:repeat(3,minmax(0,1fr))!important}.tr10-actions button,.tr10-actions .tr10-likeAction,.tr10-actions .tr10-lessAction{font-size:7px!important;height:29px!important;min-height:29px!important;padding:0 2px!important}
        }

        /* AUG 9 REDISCOVER LANES + CLEAN MOBILE REORDER */
        .tr10-discoverSections{display:grid;gap:12px;margin-top:11px}
        .tr10-discoverCategory{overflow:hidden;border:1px solid rgba(153,177,187,.13);border-radius:11px;background:linear-gradient(180deg,#0a1419,#050b0e)}
        .tr10-discoverCategory>header{min-height:52px;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid rgba(153,177,187,.10);background:#091116}
        .tr10-discoverCategory>header>div{display:grid;gap:3px}.tr10-discoverCategory>header span{color:#fff;font-size:12px;font-weight:1000}.tr10-discoverCategory>header small{color:#8fa5ae;font-size:8px;line-height:1.3}.tr10-discoverCategory>header b{min-width:28px;height:28px;display:grid;place-items:center;border-radius:999px;background:#101b20;color:#d9e9ee;font-size:9px}
        .tr10-discoverCategory.is-new{border-top:2px solid #53d69a}.tr10-discoverCategory.is-new>header span{color:#7fe8b2}.tr10-discoverCategory.is-era{border-top:2px solid #54cff3}.tr10-discoverCategory.is-era>header span{color:#7adcf7}.tr10-discoverCategory.is-hidden{border-top:2px solid #f1b352}.tr10-discoverCategory.is-hidden>header span{color:#ffd17f}
        .tr10-discoverCategory .tr10-discoverGrid{margin:0!important;padding:8px!important}.tr10-discoverLaneEmpty{padding:14px;color:#8fa7b0;font-size:9px;text-align:center}
        @media(max-width:650px){
          .tr10-orderCell{border:0!important;background:transparent!important;padding:1px!important;grid-template-rows:25px 25px!important;gap:3px!important;align-content:start!important}
          .tr10-orderCell button{width:24px!important;height:25px!important;min-height:25px!important;padding:0!important;border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important;color:#dff8ff!important;font-size:15px!important;line-height:1!important;text-shadow:0 0 8px rgba(81,210,247,.22)!important}
          .tr10-orderCell button:active:not(:disabled){transform:scale(.88)!important;color:#62dbfb!important}.tr10-orderCell button:disabled{opacity:.18!important}
          .tr10-discoverCategory>header{min-height:48px!important;padding:9px 10px!important}.tr10-discoverCategory>header span{font-size:11px!important}.tr10-discoverCategory>header small{font-size:7.5px!important}.tr10-discoverCategory .tr10-discoverGrid{padding:6px!important}
        }

        /* AUG 9 REDISCOVER ARCHIVE + PREVIEW PRO PASS */
        .tr10-discover{gap:12px!important}
        .tr10-discoverHead{padding-bottom:2px}
        .tr10-discoverArchiveTools{display:grid;grid-template-columns:minmax(260px,1.6fr) minmax(150px,.65fr) minmax(180px,.75fr) 82px;gap:8px;align-items:end;padding:10px;border:1px solid rgba(112,173,196,.12);border-radius:12px;background:linear-gradient(180deg,#081217,#050b0f)}
        .tr10-discoverArchiveTools label{display:grid;gap:5px;min-width:0}.tr10-discoverArchiveTools label>span{font-size:7px;font-weight:1000;letter-spacing:.10em;color:#7e9aa5}
        .tr10-discoverArchiveTools input,.tr10-discoverArchiveTools select{width:100%;height:38px;min-width:0;padding:0 10px;border:1px solid rgba(119,178,199,.16);border-radius:9px;background:#071117;color:#f4fbfd;font-size:10px;font-weight:850;outline:none}
        .tr10-discoverArchiveTools input:focus,.tr10-discoverArchiveTools select:focus{border-color:rgba(76,205,243,.50);box-shadow:0 0 0 2px rgba(76,205,243,.07)}
        .tr10-discoverArchiveCount{height:38px;display:flex;align-items:center;justify-content:center;gap:6px;border-left:2px solid #f1b352;border-radius:9px;background:rgba(241,179,82,.07)}.tr10-discoverArchiveCount strong{font-size:17px;color:#ffd17f}.tr10-discoverArchiveCount span{font-size:7px;font-weight:1000;color:#b9c9ce}

        .tr10-discoverSeed{padding:0!important;border:1px solid rgba(115,175,197,.12)!important;border-radius:12px!important;background:linear-gradient(180deg,#081318,#050b0e)!important;overflow:hidden}
        .tr10-discoverSeed+.tr10-discoverSeed{margin-top:0!important}
        .tr10-discoverSeedHead{display:grid!important;grid-template-columns:minmax(0,1fr) auto!important;gap:8px!important;align-items:stretch!important;padding:0!important;background:#081218!important;border:0!important}
        .tr10-discoverSeed>header button{border-radius:0!important}
        .tr10-discoverSeedToggle{width:100%;min-width:0;min-height:72px;padding:10px 12px!important;display:grid!important;grid-template-columns:minmax(0,1fr) auto 24px!important;gap:12px!important;align-items:center!important;border:0!important;background:transparent!important;color:#fff!important;text-align:left!important;cursor:pointer}
        .tr10-discoverSeedToggle:hover{background:rgba(73,166,199,.035)!important}
        .tr10-discoverSeedIdentity{min-width:0;display:grid;gap:2px}.tr10-discoverSeedIdentity small{font-size:7px!important;color:#69d8f8!important}.tr10-discoverSeedIdentity h3{margin:0!important;font-size:17px!important;line-height:1.16!important;white-space:normal!important;overflow-wrap:anywhere}.tr10-discoverSeedIdentity p{margin:0!important;font-size:9px!important;color:#a8c0c9!important}.tr10-discoverSeedIdentity time{margin-top:4px;font-size:8px;font-weight:800;color:#718c96}
        .tr10-discoverSeedStats{min-width:96px;padding:7px 9px;display:grid;grid-template-columns:auto 1fr;grid-template-areas:"count label" "count meta";column-gap:6px;align-items:center;border-left:1px solid rgba(241,179,82,.23);background:linear-gradient(90deg,rgba(241,179,82,.075),transparent)}
        .tr10-discoverSeedStats strong{grid-area:count;font-size:20px;line-height:1;color:#ffd17f}.tr10-discoverSeedStats span{grid-area:label;font-size:7px;font-weight:1000;color:#f2f7f9}.tr10-discoverSeedStats small{grid-area:meta;font-size:6px!important;color:#78909a!important;letter-spacing:.04em!important}
        .tr10-discoverChevron{display:grid;place-items:center;width:24px;height:24px;border:1px solid rgba(120,181,204,.14);border-radius:8px;color:#cce3ea;font-size:13px}
        .tr10-discoverRemove{align-self:center!important;margin-right:9px!important;min-height:32px!important;padding:0 9px!important;border:1px solid rgba(255,95,105,.22)!important;border-radius:8px!important;background:#18090b!important;color:#ff9298!important;font-size:7px!important;font-weight:1000!important}

        .tr10-discoverSections{padding:0 9px 9px!important;gap:7px!important;margin-top:0!important;border-top:1px solid rgba(115,175,197,.08)}
        .tr10-discoverCategory{border-radius:9px!important}
        .tr10-discoverCategoryToggle{width:100%;min-height:48px;padding:8px 10px;display:grid;grid-template-columns:minmax(0,1fr) auto 20px;gap:8px;align-items:center;border:0;background:#091116;color:#fff;text-align:left;cursor:pointer}
        .tr10-discoverCategoryToggle>div{display:grid;gap:2px;min-width:0}.tr10-discoverCategoryToggle span{font-size:11px;font-weight:1000}.tr10-discoverCategoryToggle small{font-size:7.5px;color:#8fa5ae;line-height:1.3}.tr10-discoverCategoryToggle b{min-width:27px;height:27px;display:grid;place-items:center;border-radius:999px;background:#101b20;color:#d9e9ee;font-size:8px}.tr10-discoverCategoryToggle i{font-style:normal;color:#9db5be;text-align:center}
        .tr10-discoverCategory.is-new .tr10-discoverCategoryToggle span{color:#7fe8b2}.tr10-discoverCategory.is-era .tr10-discoverCategoryToggle span{color:#7adcf7}.tr10-discoverCategory.is-hidden .tr10-discoverCategoryToggle span{color:#ffd17f}
        .tr10-discoverCategory.is-collapsed .tr10-discoverCategoryToggle{border-bottom:0}
        .tr10-discoverCategory.is-expanded .tr10-discoverCategoryToggle{border-bottom:1px solid rgba(153,177,187,.09)}

        .tr10-discoverType{display:inline-flex!important;justify-self:start;padding:3px 6px;border-radius:999px;background:#0e1b21;color:#b5cdd6!important;font-size:6.5px!important;font-weight:1000!important;letter-spacing:.06em!important}
        .tr10-discoverType.is-new_artist{color:#9af0bf!important;background:rgba(38,164,102,.12)}
        .tr10-discoverType.is-new_release{color:#ffd27e!important;background:rgba(211,140,35,.12)}
        .tr10-discoverType.is-modern_match{color:#a8dfff!important;background:rgba(60,151,197,.12)}
        .tr10-discoverType.is-era_match{color:#89e0f7!important;background:rgba(48,156,190,.10)}
        .tr10-discoverType.is-hidden_gem{color:#e7c0ff!important;background:rgba(145,82,192,.11)}
        .tr10-discoverGrid article footer{align-items:center}
        .tr10-discoverGrid article footer .tr10-previewButton{border-color:rgba(80,203,241,.26);color:#aeeaff;background:#071b24}.tr10-discoverGrid article footer .tr10-previewButton.is-playing{border-color:rgba(79,225,167,.46);color:#bcf8dc;background:#0a2a20}
        .tr10-previewUnavailable{min-height:28px;padding:0 7px;display:inline-flex;align-items:center;border:1px solid rgba(124,150,160,.09);border-radius:8px;color:#677d86;font-size:6.5px;font-weight:900}
        .tr10-storeLink{min-height:28px;padding:0 7px;display:inline-flex;align-items:center;border:1px solid rgba(166,172,178,.12);border-radius:8px;background:#0a1115;color:#aebbc0;font-size:6.5px;font-weight:1000;text-decoration:none}.tr10-storeLink:hover{color:#fff;border-color:rgba(199,207,211,.24)}
        .tr10-discoverSeed.is-collapsed .tr10-discoverSeedHead{background:linear-gradient(180deg,#081318,#060d11)}
        .tr10-discoverSeed.is-collapsed .tr10-discoverSeedToggle{min-height:64px}

        @media(max-width:760px){
          .tr10-discoverArchiveTools{grid-template-columns:1fr 1fr!important;padding:7px!important;gap:6px!important}.tr10-discoverSearch{grid-column:1/-1!important}.tr10-discoverArchiveCount{height:35px!important}.tr10-discoverArchiveTools input,.tr10-discoverArchiveTools select{height:35px!important;font-size:9px!important}
          .tr10-discoverSeedHead{grid-template-columns:minmax(0,1fr)!important}.tr10-discoverSeedToggle{min-height:66px!important;padding:8px 8px!important;grid-template-columns:minmax(0,1fr) 82px 20px!important;gap:7px!important}.tr10-discoverSeedIdentity h3{font-size:14px!important}.tr10-discoverSeedIdentity p{font-size:8.5px!important}.tr10-discoverSeedIdentity time{font-size:7px!important}.tr10-discoverSeedStats{min-width:0!important;padding:6px 6px!important}.tr10-discoverSeedStats strong{font-size:17px!important}.tr10-discoverSeedStats span{font-size:6.5px!important}.tr10-discoverSeedStats small{font-size:5.5px!important}
          .tr10-discoverRemove{margin:0 8px 8px!important;width:max-content!important;justify-self:end!important;min-height:29px!important}
          .tr10-discoverSections{padding:0 6px 6px!important;gap:5px!important}.tr10-discoverCategoryToggle{min-height:44px!important;padding:7px 8px!important}.tr10-discoverCategoryToggle span{font-size:10px!important}.tr10-discoverCategoryToggle small{font-size:7px!important}.tr10-discoverCategoryToggle b{min-width:24px!important;height:24px!important;font-size:7px!important}
          .tr10-discoverGrid article footer button,.tr10-discoverGrid article footer b,.tr10-previewUnavailable,.tr10-storeLink{min-height:27px!important;font-size:6.4px!important;padding:0 6px!important}
        }
        @media(max-width:390px){
          .tr10-discoverSeedToggle{grid-template-columns:minmax(0,1fr) 72px 18px!important}.tr10-discoverSeedStats small{display:none!important}.tr10-discoverSeedStats{grid-template-areas:"count label"!important}.tr10-discoverArchiveTools label>span{font-size:6.5px!important}
        }


        /* AUG 9 REMAINING REDISCOVER FIXES: functional filters + Saved Songs */
        .tr10-discoverArchiveTools{
          grid-template-columns:minmax(260px,1.6fr) minmax(145px,.62fr) minmax(180px,.76fr) 116px!important;
        }
        .tr10-discoverArchiveTools select:disabled{opacity:.62;cursor:not-allowed}
        .tr10-savedSongsButton{
          height:38px;min-height:38px;width:100%;padding:0 10px;
          border:1px solid rgba(96,175,203,.17);border-radius:9px;
          background:#08151b;color:#e8f6fa;font-size:8px;font-weight:1000;letter-spacing:.035em;
          cursor:pointer;white-space:nowrap;
        }
        .tr10-savedSongsButton:hover{border-color:rgba(80,203,241,.38);background:#0a2029}
        .tr10-savedSongsButton.is-active{
          border-color:rgba(80,203,241,.56);background:linear-gradient(180deg,#0b3b4b,#082630);
          color:#fff;box-shadow:inset 0 -2px #48d1f5;
        }
        .tr10-savedSongsGrid{margin-top:0!important;padding:0!important;grid-template-columns:repeat(2,minmax(0,1fr))!important}
        .tr10-savedSongsGrid article{margin:0!important}
        .tr10-savedDelete{
          border-color:rgba(255,95,105,.30)!important;background:#18090b!important;color:#ff9aa0!important;
        }
        .tr10-savedSongsPager{
          display:grid;grid-template-columns:110px auto 110px;align-items:center;justify-content:center;gap:10px;
          margin-top:2px;padding:9px;border:1px solid rgba(112,173,196,.10);border-radius:10px;background:#061015;
        }
        .tr10-savedSongsPager button{
          height:32px;border:1px solid rgba(96,175,203,.17);border-radius:8px;background:#08151b;color:#e8f6fa;
          font-size:7px;font-weight:1000;cursor:pointer;
        }
        .tr10-savedSongsPager button:disabled{opacity:.32;cursor:not-allowed}
        .tr10-savedSongsPager span{color:#b8ccd4;font-size:8px;font-weight:1000;text-align:center}
        @media(max-width:760px){
          .tr10-discoverArchiveTools{grid-template-columns:1fr 1fr!important}
          .tr10-discoverSearch{grid-column:1/-1!important}
          .tr10-savedSongsButton{height:35px!important;min-height:35px!important;font-size:8px!important}
          .tr10-savedSongsGrid{grid-template-columns:1fr!important}
          .tr10-savedSongsPager{grid-template-columns:1fr auto 1fr!important;gap:6px!important;padding:7px!important}
          .tr10-savedSongsPager button{height:30px!important}
        }
        /* MVP_TRAINER_V5_R6_MUSIC_INTELLIGENCE_SUITE: 7-TAB NAV */
        .tr10-tabs{grid-template-columns:repeat(8,minmax(0,1fr))!important}
        @media(max-width:650px){
          .tr10-tabs{grid-template-columns:repeat(3,minmax(0,1fr))!important}
          .tr10-tabs button:last-child{grid-column:auto!important}
        }

        /* MVP_TRAINER_V5_R7_NEURAL_PLAYER_DISCOVERY: DIRECTORY DISCOVERY RADAR */
        .tr10-directoryEyebrow{display:block;margin-bottom:3px;color:#5edcff;font-size:7px;font-weight:1000;letter-spacing:.16em}
        .tr10-radarPanel{margin:10px;border:1px solid rgba(70,199,237,.18);border-radius:12px;overflow:hidden;background:radial-gradient(circle at 8% 0%,rgba(36,170,210,.12),transparent 34%),linear-gradient(180deg,#07151c,#040b0f)}
        .tr10-radarHead{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:13px 14px;border-bottom:1px solid rgba(88,182,211,.10)}
        .tr10-radarHead span{color:#59d7f6;font-size:7px;font-weight:1000;letter-spacing:.16em}.tr10-radarHead h2{margin:4px 0 3px;color:#f5fbfe;font-size:18px}.tr10-radarHead p{margin:0;max-width:720px;color:#809aa4;font-size:8px;line-height:1.5}.tr10-radarHead>strong{min-width:48px;text-align:right;color:#f6c55d;font-size:28px;line-height:1}
        .tr10-radarGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;padding:10px}.tr10-radarGrid article{min-height:94px;padding:10px;display:flex;align-items:flex-end;justify-content:space-between;gap:10px;border:1px solid rgba(100,174,197,.11);border-radius:9px;background:linear-gradient(145deg,rgba(9,27,35,.96),rgba(4,13,18,.96));box-shadow:inset 0 1px rgba(255,255,255,.025)}.tr10-radarGrid small{color:#55d5f5;font-size:6px;font-weight:1000;letter-spacing:.08em}.tr10-radarGrid h3{margin:4px 0 3px;color:#fff;font-size:11px}.tr10-radarGrid p{margin:0;color:#76909a;font-size:7px;line-height:1.4}.tr10-radarGrid button{height:31px;flex:0 0 auto;padding:0 10px;border:1px solid rgba(75,202,239,.28);border-radius:7px;background:#08242e;color:#eafaff;font-size:7px;font-weight:1000}.tr10-radarGrid button:disabled{opacity:.28}
        @media(max-width:820px){.tr10-radarGrid{grid-template-columns:repeat(2,minmax(0,1fr))}.tr10-radarHead{align-items:flex-start}.tr10-radarHead>strong{font-size:23px}}
        @media(max-width:520px){.tr10-radarPanel{margin:7px}.tr10-radarHead{padding:10px}.tr10-radarHead h2{font-size:15px}.tr10-radarHead p{font-size:7px}.tr10-radarGrid{grid-template-columns:1fr;padding:7px}.tr10-radarGrid article{min-height:78px;padding:9px}.tr10-radarGrid h3{font-size:10px}.tr10-radarGrid p{font-size:6.5px}}


        /* MVP_TRAINER_V5_R8_6_LIBRARY_COLLECTION_DRILLDOWN */
        .tr10-collectionCard{padding:0!important;grid-template-columns:minmax(0,1fr) auto!important;gap:0!important;overflow:hidden!important}
        .tr10-collectionCard>.tr10-collectionOpen{width:100%!important;height:auto!important;min-width:0!important;min-height:86px!important;padding:12px!important;display:grid!important;grid-template-columns:auto minmax(0,1fr) 24px!important;gap:12px!important;align-items:center!important;border:0!important;border-radius:0!important;background:transparent!important;color:#fff!important;text-align:left!important;font-size:inherit!important;font-weight:inherit!important;cursor:pointer!important}
        .tr10-collectionCard>.tr10-collectionOpen:hover{background:linear-gradient(90deg,rgba(49,193,237,.075),transparent)!important}
        .tr10-collectionOpen>div{min-width:0}.tr10-collectionOpen small{color:#56ceef;font-size:7px;font-weight:1000;letter-spacing:.09em}.tr10-collectionOpen h3{margin:4px 0 3px;color:#f8fcfe;font-size:16px;line-height:1.08;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tr10-collectionOpen p{margin:0;color:#8299a2;font-size:8px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tr10-collectionChevron{display:grid;place-items:center;width:24px;height:34px;color:#8fdff7;font-size:28px;font-weight:500;opacity:.78}
        .tr10-collectionCard>.tr10-collectionPlay{align-self:center;height:38px;margin-right:12px;padding:0 13px;border:1px solid rgba(70,196,236,.30);border-radius:9px;background:#082633;color:#e8faff;font-size:8px;font-weight:1000;white-space:nowrap;cursor:pointer}.tr10-collectionCard>.tr10-collectionPlay:hover{border-color:rgba(78,216,255,.55);background:#0a3443}

        .tr10-collectionDetail{padding:12px;display:grid;gap:10px}
        .tr10-collectionBack{justify-self:start;height:34px;padding:0 11px;border:1px solid rgba(101,177,204,.18);border-radius:9px;background:#07141a;color:#dff7ff;font-size:8px;font-weight:1000;letter-spacing:.05em;cursor:pointer}
        .tr10-collectionDetailHero{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:16px;align-items:center;padding:16px;border:1px solid rgba(75,184,218,.17);border-radius:14px;background:radial-gradient(circle at 8% 0%,rgba(48,188,232,.11),transparent 34%),linear-gradient(180deg,#091820,#050d12);box-shadow:inset 0 1px rgba(255,255,255,.035),0 14px 30px rgba(0,0,0,.22)}
        .tr10-collectionDetailHero .tr10-art--card{width:92px;height:92px;border-radius:12px}
        .tr10-collectionDetailIdentity{min-width:0}.tr10-collectionDetailIdentity small{display:block;color:#58d8f8;font-size:7px;font-weight:1000;letter-spacing:.14em}.tr10-collectionDetailIdentity h2{margin:5px 0 4px;color:#fff;font-size:28px;line-height:1.02;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tr10-collectionDetailIdentity p{margin:0;color:#b7cad1;font-size:10px;font-weight:850}.tr10-collectionDetailIdentity>span{display:block;margin-top:7px;color:#718d98;font-size:8px;font-weight:900;letter-spacing:.035em}
        .tr10-collectionDetailActions{display:flex;gap:7px;align-items:center}.tr10-collectionDetailActions button{height:40px;padding:0 13px;border:1px solid rgba(102,172,197,.18);border-radius:9px;background:#07151b;color:#d9e9ee;font-size:8px;font-weight:1000;white-space:nowrap;cursor:pointer}.tr10-collectionDetailActions button.is-primary{border-color:rgba(67,206,246,.38);background:linear-gradient(180deg,#0b4052,#082a36);color:#f2fcff;box-shadow:inset 0 -2px rgba(70,210,249,.48)}.tr10-collectionDetailActions button:disabled{opacity:.35;cursor:not-allowed}
        .tr10-collectionSongList{overflow:hidden;border:1px solid rgba(95,159,181,.11);border-radius:12px;background:#050d11}
        .tr10-collectionSong{display:grid;grid-template-columns:30px 38px 46px minmax(0,1fr) 54px auto;gap:9px;align-items:center;min-height:68px;padding:8px 10px;border-bottom:1px solid rgba(85,144,165,.085);background:rgba(2,8,11,.36)}.tr10-collectionSong:last-child{border-bottom:0}.tr10-collectionSong:hover{background:rgba(8,28,36,.48)}.tr10-collectionSong.is-current{background:linear-gradient(90deg,rgba(7,67,88,.52),rgba(3,13,18,.4));box-shadow:inset 3px 0 #3ed2f8}
        .tr10-collectionSongNumber{color:#57717b;font-size:8px;text-align:center}.tr10-collectionSongPlay{width:34px;height:34px;border:1px solid rgba(76,201,239,.26);border-radius:999px;background:#071b23;color:#eafaff;font-size:11px;font-weight:1000;cursor:pointer}.tr10-collectionSongPlay.is-playing{border-color:rgba(77,218,255,.58);background:#0a3544;color:#fff;box-shadow:0 0 12px rgba(57,199,241,.16)}
        .tr10-collectionSongText{min-width:0}.tr10-collectionSongText strong{display:block;color:#fff;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tr10-collectionSongText span{display:block;margin-top:3px;color:#8199a2;font-size:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tr10-collectionSongDuration{color:#a6bbc2;font-size:8px;font-weight:900;text-align:right}
        .tr10-collectionSongActions{display:flex;gap:5px;align-items:center}.tr10-collectionSongActions button{height:30px;padding:0 8px;border:1px solid rgba(102,158,178,.13);border-radius:7px;background:#071117;color:#a8bdc5;font-size:6.5px;font-weight:1000;white-space:nowrap;cursor:pointer}.tr10-collectionSongActions button.is-liked{border-color:rgba(65,225,166,.30);color:#91f2c8;background:rgba(22,109,79,.18)}.tr10-collectionSongActions button.is-less{border-color:rgba(255,94,103,.28);color:#ffb2b7;background:rgba(112,28,35,.16)}
        @media(max-width:760px){
          .tr10-collectionCard{grid-template-columns:minmax(0,1fr) 74px!important}.tr10-collectionCard>.tr10-collectionOpen{min-height:78px!important;padding:9px!important;grid-template-columns:54px minmax(0,1fr) 18px!important;gap:8px!important}.tr10-collectionOpen .tr10-art--card{width:54px;height:54px}.tr10-collectionOpen h3{font-size:14px}.tr10-collectionOpen p{font-size:7px}.tr10-collectionChevron{width:18px;font-size:23px}.tr10-collectionCard>.tr10-collectionPlay{height:34px;margin-right:8px;padding:0 8px;font-size:7px}
          .tr10-collectionDetail{padding:8px;gap:8px}.tr10-collectionBack{height:32px;font-size:7px}.tr10-collectionDetailHero{grid-template-columns:70px minmax(0,1fr);gap:10px;padding:11px}.tr10-collectionDetailHero .tr10-art--card{width:70px;height:70px}.tr10-collectionDetailIdentity h2{font-size:20px;white-space:normal}.tr10-collectionDetailIdentity p{font-size:9px}.tr10-collectionDetailIdentity>span{font-size:7px}.tr10-collectionDetailActions{grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;width:100%}.tr10-collectionDetailActions button{height:38px}
          .tr10-collectionSong{grid-template-columns:24px 34px 42px minmax(0,1fr);grid-template-areas:"num play art text" ". duration duration duration" "actions actions actions actions";gap:7px;min-height:0;padding:9px 8px}.tr10-collectionSongNumber{grid-area:num}.tr10-collectionSongPlay{grid-area:play;width:32px;height:32px}.tr10-collectionSong>.tr10-art--row{grid-area:art;width:42px!important;height:42px!important;min-width:42px!important;min-height:42px!important}.tr10-collectionSongText{grid-area:text}.tr10-collectionSongText strong{font-size:12px;white-space:normal}.tr10-collectionSongText span{font-size:8px;white-space:normal}.tr10-collectionSongDuration{grid-area:duration;justify-self:start;text-align:left;font-size:8px}.tr10-collectionSongActions{grid-area:actions;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px}.tr10-collectionSongActions button{width:100%;height:32px;padding:0 3px;font-size:6.5px;white-space:normal;line-height:1.05}
        }
        @media(max-width:390px){.tr10-collectionSongActions{grid-template-columns:repeat(2,minmax(0,1fr))}.tr10-collectionDetailIdentity h2{font-size:18px}.tr10-collectionOpen h3{font-size:13px}}

        /* MVP_TRAINER_V5_R9_5_LIBRARY_SORT_VIEW: deterministic sorting + list/grid switch */
        .tr10-actionsHead{display:flex!important;align-items:center!important;justify-content:flex-end!important;gap:8px!important;white-space:nowrap!important}
        .tr10-viewToggle{width:30px!important;min-width:30px!important;height:28px!important;padding:0!important;display:grid!important;place-items:center!important;border:1px solid rgba(77,202,240,.28)!important;border-radius:7px!important;background:linear-gradient(180deg,#0a2834,#061820)!important;color:#e9faff!important;font-size:17px!important;line-height:1!important;font-weight:900!important;box-shadow:inset 0 1px rgba(255,255,255,.035)!important}
        .tr10-viewToggle:hover{border-color:rgba(77,216,255,.58)!important;background:#0b3443!important}
        .tr10-mobileViewBar{display:none}

        .tr10-table.is-grid{padding:10px!important;display:grid!important;grid-template-columns:repeat(5,minmax(0,1fr))!important;gap:9px!important;background:#040b0f!important}
        .tr10-table.is-grid>.tr10-tableHead,.tr10-table.is-grid>.tr10-mobileViewBar,.tr10-table.is-grid>.tr10-empty{grid-column:1/-1!important}
        .tr10-table.is-grid>.tr10-tableHead{display:grid!important;margin:-10px -10px 0!important}
        .tr10-table.is-grid>.tr10-row{display:grid!important;grid-template-columns:1fr auto!important;grid-template-rows:auto auto auto!important;gap:8px!important;min-width:0!important;min-height:0!important;padding:9px!important;overflow:hidden!important;border:1px solid rgba(83,164,192,.14)!important;border-radius:11px!important;background:linear-gradient(180deg,#08161d,#040c10)!important}
        .tr10-table.is-grid>.tr10-row:hover{border-color:rgba(78,204,243,.28)!important;background:linear-gradient(180deg,#0a2029,#050e13)!important}
        .tr10-table.is-grid>.tr10-row.is-current{box-shadow:inset 0 0 0 1px rgba(59,210,250,.55),0 0 20px rgba(47,187,229,.09)!important}
        .tr10-table.is-grid .tr10-orderCell{display:none!important}
        .tr10-table.is-grid .tr10-check{grid-column:2!important;grid-row:1!important;z-index:4!important;align-self:start!important;justify-self:end!important;margin:3px!important;padding:0!important}
        .tr10-table.is-grid .tr10-check input{width:18px!important;height:18px!important}
        .tr10-table.is-grid .tr10-trackCell{grid-column:1/-1!important;grid-row:1!important;display:grid!important;grid-template-columns:1fr!important;grid-template-rows:auto auto!important;gap:8px!important;overflow:visible!important}
        .tr10-table.is-grid .tr10-trackCell>.tr10-art--row{grid-column:1!important;grid-row:1!important;width:100%!important;min-width:0!important;max-width:none!important;height:auto!important;min-height:0!important;max-height:none!important;aspect-ratio:1/1!important;border-radius:9px!important}
        .tr10-table.is-grid .tr10-trackCell>.tr10-play{grid-column:1!important;grid-row:1!important;z-index:3!important;align-self:center!important;justify-self:center!important;width:46px!important;height:46px!important;min-width:46px!important;border-radius:999px!important;font-size:14px!important;box-shadow:0 8px 22px rgba(0,0,0,.42)!important}
        .tr10-table.is-grid .tr10-trackText{grid-column:1!important;grid-row:2!important;min-width:0!important;overflow:hidden!important}
        .tr10-table.is-grid .tr10-trackText strong{font-size:11px!important;line-height:1.18!important;color:#fff!important}
        .tr10-table.is-grid .tr10-trackText span{font-size:8px!important;color:#a4bac3!important}
        .tr10-table.is-grid .tr10-trackText small{display:none!important}
        .tr10-table.is-grid .tr10-trackCell>.tr10-healthBadge{grid-column:1!important;grid-row:1!important;z-index:3!important;align-self:end!important;justify-self:start!important;margin:7px!important}
        .tr10-table.is-grid>.tr10-row>.tr10-duration{grid-column:1!important;grid-row:2!important;align-self:center!important;justify-self:start!important;font-size:8px!important;color:#9db3bc!important}
        .tr10-table.is-grid>.tr10-row>.tr10-energy{grid-column:2!important;grid-row:2!important;align-self:center!important;justify-self:end!important;width:78px!important;min-width:78px!important;max-width:78px!important}
        .tr10-table.is-grid .tr10-actions{grid-column:1/-1!important;grid-row:3!important;display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:5px!important;width:100%!important}
        .tr10-table.is-grid .tr10-actions button{width:100%!important;min-width:0!important;height:31px!important;min-height:31px!important;padding:0 4px!important;font-size:6.5px!important;white-space:normal!important;line-height:1.05!important;overflow:hidden!important}
        .tr10-table.is-grid .tr10-likeAction,.tr10-table.is-grid .tr10-lessAction{font-size:10px!important}
        .tr10-table.is-grid .tr10-likeAction span,.tr10-table.is-grid .tr10-lessAction span{display:none!important}

        @media(max-width:1050px){.tr10-table.is-grid{grid-template-columns:repeat(4,minmax(0,1fr))!important}}
        @media(max-width:820px){.tr10-table.is-grid{grid-template-columns:repeat(3,minmax(0,1fr))!important}}
        @media(max-width:650px){
          .tr10-table.is-list>.tr10-mobileViewBar{display:flex!important;align-items:center!important;justify-content:flex-end!important;gap:8px!important;min-height:36px!important;padding:4px 8px!important;border-bottom:1px solid rgba(83,151,176,.10)!important;background:#050b0f!important;color:#7e99a4!important;font-size:7px!important;font-weight:1000!important;letter-spacing:.1em!important}
          .tr10-table.is-list>.tr10-mobileViewBar .tr10-viewToggle{width:32px!important;min-width:32px!important;height:30px!important}
          .tr10-table.is-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important;padding:7px!important;gap:7px!important}
          .tr10-table.is-grid>.tr10-tableHead{display:none!important}
          .tr10-table.is-grid>.tr10-mobileViewBar{display:flex!important;grid-column:1/-1!important;align-items:center!important;justify-content:flex-end!important;gap:8px!important;min-height:36px!important;padding:4px 1px 7px!important;color:#7e99a4!important;font-size:7px!important;font-weight:1000!important;letter-spacing:.1em!important}
          .tr10-table.is-grid>.tr10-mobileViewBar .tr10-viewToggle{width:34px!important;min-width:34px!important;height:32px!important}
          .tr10-table.is-grid>.tr10-row{padding:7px!important;gap:7px!important}
          .tr10-table.is-grid .tr10-trackText strong{font-size:12px!important}
          .tr10-table.is-grid .tr10-trackText span{font-size:8.5px!important}
          .tr10-table.is-grid .tr10-actions{grid-template-columns:repeat(2,minmax(0,1fr))!important}
          .tr10-table.is-grid .tr10-actions button{height:34px!important;min-height:34px!important;font-size:7px!important}
        }
        @media(max-width:360px){.tr10-table.is-grid{grid-template-columns:1fr!important}}



        /* MVP TRAINER R12.2 REDISCOVER DEPTH + ARTIST CATALOG */
        .tr10-discover{background:radial-gradient(circle at 50% 0%,rgba(41,117,144,.055),transparent 34%),linear-gradient(180deg,#03090d 0%,#020609 100%)!important;border-radius:14px!important}
        .tr10-discoverSeed{background:linear-gradient(180deg,#071116 0%,#04090c 100%)!important;border-color:rgba(127,184,203,.16)!important;box-shadow:0 12px 32px rgba(0,0,0,.28),inset 0 1px rgba(255,255,255,.025)!important}
        .tr10-discoverSections{background:linear-gradient(180deg,rgba(2,7,10,.94),rgba(2,6,9,.99))!important}
        .tr10-discoverCategory{background:#050b0f!important;border:1px solid rgba(128,181,198,.12)!important;box-shadow:inset 0 1px rgba(255,255,255,.025),0 7px 18px rgba(0,0,0,.20)!important;overflow:hidden!important}
        .tr10-discoverCategoryToggle{background:linear-gradient(180deg,#0b151a,#071015)!important;box-shadow:inset 0 1px rgba(255,255,255,.035),inset 0 -1px rgba(0,0,0,.65)!important}
        .tr10-discoverCategory.is-artist{border-top:2px solid #eef7fb!important}.tr10-discoverCategory.is-artist .tr10-discoverCategoryToggle span{color:#f4fbff!important;text-shadow:0 0 12px rgba(218,239,248,.22)!important}.tr10-discoverCategory.is-artist .tr10-discoverCategoryToggle b{border:1px solid rgba(225,241,248,.24)!important;background:linear-gradient(180deg,#202b30,#11191d)!important;color:#fff!important;box-shadow:0 0 12px rgba(219,239,247,.10)!important}
        .tr10-discoverType.is-artist_catalog{color:#f2f9fc!important;background:linear-gradient(180deg,rgba(228,241,247,.15),rgba(174,202,213,.07))!important;border:1px solid rgba(224,241,248,.18)!important;box-shadow:inset 0 1px rgba(255,255,255,.08)!important}
        .tr10-discoverCategory .tr10-discoverGrid{background:linear-gradient(180deg,#03080b,#020608)!important}
        .tr10-discoverGrid article{position:relative!important;background:linear-gradient(155deg,#122028 0%,#0c171d 48%,#081116 100%)!important;border:1px solid rgba(157,204,220,.22)!important;box-shadow:0 10px 24px rgba(0,0,0,.38),0 2px 7px rgba(0,0,0,.30),inset 0 1px rgba(255,255,255,.075),inset 1px 0 rgba(255,255,255,.025)!important;overflow:hidden!important;transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease!important}
        .tr10-discoverGrid article::before{content:"";position:absolute;inset:0 0 auto;height:1px;background:linear-gradient(90deg,transparent,rgba(221,242,249,.20),transparent);pointer-events:none}
        .tr10-discoverGrid article:hover{transform:translateY(-2px)!important;border-color:rgba(140,211,234,.34)!important;box-shadow:0 15px 31px rgba(0,0,0,.46),0 4px 11px rgba(0,0,0,.32),inset 0 1px rgba(255,255,255,.10)!important}
        .tr10-discoverGrid article>img,.tr10-discoverArt{position:relative!important;z-index:1!important;border:1px solid rgba(210,236,245,.16)!important;box-shadow:0 8px 18px rgba(0,0,0,.38),0 0 18px rgba(91,184,218,.07),inset 0 1px rgba(255,255,255,.07)!important}
        .tr10-discoverGrid article>div,.tr10-discoverGrid article footer{position:relative!important;z-index:1!important}
        .tr10-discoverGrid article strong{color:#fff!important;text-shadow:0 1px 1px rgba(0,0,0,.58)!important}.tr10-discoverGrid article span{color:#c4d6dd!important}.tr10-discoverGrid article p{color:#8faab4!important}
        .tr10-discoverGrid article footer button,.tr10-discoverGrid article footer b,.tr10-previewUnavailable,.tr10-storeLink{background:linear-gradient(180deg,#12222a,#091318)!important;border-color:rgba(145,197,214,.20)!important;box-shadow:0 4px 9px rgba(0,0,0,.24),inset 0 1px rgba(255,255,255,.055)!important}
        .tr10-discoverGrid article footer button:hover,.tr10-storeLink:hover{transform:translateY(-1px);border-color:rgba(113,210,242,.38)!important;box-shadow:0 7px 13px rgba(0,0,0,.30),inset 0 1px rgba(255,255,255,.075)!important}
        .tr10-discoverGrid article.is-owned{opacity:.82!important;background:linear-gradient(155deg,#101b20,#091116)!important}
        @media(max-width:650px){.tr10-discoverGrid article:hover{transform:none!important}.tr10-discover{border-radius:11px!important}.tr10-discoverCategory .tr10-discoverGrid{padding:7px!important}.tr10-discoverGrid article{box-shadow:0 8px 17px rgba(0,0,0,.36),inset 0 1px rgba(255,255,255,.07)!important}}

        /* R12.4 — precision Rediscover badge rendering, desktop + mobile */
        .tr10-discoverType{
          min-height:20px!important;
          padding:5px 8px 4px!important;
          display:inline-flex!important;
          align-items:center!important;
          justify-content:center!important;
          border:1px solid rgba(218,238,246,.22)!important;
          border-radius:999px!important;
          font-family:"Segoe UI Variable Text","SF Pro Text",Inter,"Segoe UI",system-ui,sans-serif!important;
          font-size:8.25px!important;
          line-height:1!important;
          font-weight:850!important;
          font-variation-settings:"wght" 850!important;
          letter-spacing:.032em!important;
          text-transform:uppercase!important;
          text-shadow:none!important;
          filter:none!important;
          transform:none!important;
          opacity:1!important;
          -webkit-font-smoothing:antialiased!important;
          -moz-osx-font-smoothing:grayscale!important;
          text-rendering:geometricPrecision!important;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.07),0 1px 1px rgba(0,0,0,.28)!important;
          backface-visibility:hidden!important;
        }
        .tr10-discoverType.is-artist_catalog{color:#f7fbfd!important;border-color:rgba(231,244,249,.28)!important}
        .tr10-discoverType.is-new_artist{color:#a9f5c9!important;border-color:rgba(73,205,137,.24)!important}
        .tr10-discoverType.is-new_release{color:#ffdc91!important;border-color:rgba(222,166,66,.28)!important}
        .tr10-discoverType.is-modern_match{color:#b7e6ff!important;border-color:rgba(89,180,225,.27)!important}
        .tr10-discoverType.is-era_match{color:#9de9fb!important;border-color:rgba(72,184,217,.27)!important}
        .tr10-discoverType.is-hidden_gem{color:#edceff!important;border-color:rgba(170,109,214,.27)!important}
        @media(max-width:650px){
          .tr10-discoverType{min-height:21px!important;padding:5px 8px!important;font-size:8.6px!important;letter-spacing:.028em!important}
        }


        /* MVP_TRAINER_V5_R12_5E_19_CONTROL_REFINEMENT */
        .tr10-detailPortal{position:fixed!important;inset:0!important;z-index:2147483000!important;padding:18px 12px!important;display:grid!important;place-items:center!important;background:rgba(0,4,7,.90)!important;backdrop-filter:blur(15px) saturate(125%)!important;-webkit-backdrop-filter:blur(15px) saturate(125%)!important}
        .tr10-detailPortal .tr10-inspector{position:relative!important;z-index:1!important;border-color:rgba(92,218,255,.38)!important;background:radial-gradient(circle at 12% 0%,rgba(53,202,244,.12),transparent 32%),radial-gradient(circle at 90% 100%,rgba(255,157,37,.07),transparent 32%),linear-gradient(180deg,#0a202a,#040d12)!important;box-shadow:0 40px 120px rgba(0,0,0,.78),0 0 0 1px rgba(255,255,255,.025),0 0 60px rgba(45,198,239,.08)!important}
        .tr10-detailPortal .tr10-inspector>header{background:linear-gradient(180deg,#0b2530,#07171e)!important}
        .tr10-detailPortal button:not(:disabled):hover{filter:brightness(1.18)!important;transform:translateY(-1px)!important}

        .tr10-toolbar label{position:relative!important;overflow:visible!important}
        .tr10-toolbar select{color-scheme:dark!important;appearance:none!important;-webkit-appearance:none!important;cursor:pointer!important;padding-right:24px!important;background-image:linear-gradient(45deg,transparent 50%,#79dff8 50%),linear-gradient(135deg,#79dff8 50%,transparent 50%)!important;background-position:calc(100% - 10px) calc(50% - 2px),calc(100% - 6px) calc(50% - 2px)!important;background-size:4px 4px,4px 4px!important;background-repeat:no-repeat!important}
        .tr10-toolbar select option{background:#071219!important;color:#eaf8fc!important}
        .tr10-toolbar label:hover{border-color:rgba(89,219,255,.32)!important;background:linear-gradient(180deg,rgba(7,29,38,.78),rgba(3,15,21,.68))!important;box-shadow:0 0 22px rgba(46,198,239,.055),inset 0 1px rgba(255,255,255,.04)!important}

        .tr10-actions{gap:5px!important;align-items:center!important}
        .tr10-actions button{position:relative!important;isolation:isolate!important;min-height:31px!important;padding:0 9px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:5px!important;border-radius:8px!important;border:1px solid rgba(115,185,207,.16)!important;background:linear-gradient(180deg,rgba(8,25,32,.92),rgba(4,13,18,.96))!important;color:#dcecf2!important;box-shadow:inset 0 1px rgba(255,255,255,.03),0 6px 14px rgba(0,0,0,.12)!important;transition:transform .15s ease,border-color .15s ease,background .15s ease,box-shadow .15s ease,color .15s ease!important}
        .tr10-actions button:after{content:"";position:absolute;left:8px;right:8px;bottom:0;height:1px;border-radius:99px;background:linear-gradient(90deg,transparent,currentColor,transparent);opacity:.32;pointer-events:none}
        .tr10-actions button:not(:disabled):hover{transform:translateY(-1px)!important;background:linear-gradient(180deg,rgba(16,48,60,.98),rgba(6,22,29,.98))!important;border-color:rgba(109,224,252,.38)!important;color:#fff!important;box-shadow:inset 0 1px rgba(255,255,255,.07),0 9px 20px rgba(0,0,0,.19),0 0 20px rgba(55,207,244,.07)!important;filter:none!important}
        .tr10-actions button:not(:disabled):active{transform:translateY(1px)!important;filter:brightness(1.08)!important}
        .tr10-actionGlyph{width:15px;height:15px;display:grid;place-items:center;font-style:normal!important;font-size:10px;line-height:1;border-radius:50%;background:rgba(255,255,255,.035);box-shadow:inset 0 1px rgba(255,255,255,.04);color:currentColor}
        .tr10-likeAction{color:#76efad!important}.tr10-lessAction{color:#ff7d87!important}.tr10-nextAction{color:#7ae8ff!important}.tr10-queueAction{color:#83cfff!important}.tr10-playlistAction{color:#ffbd62!important}.tr10-editAction{color:#d8f8ff!important}
        .tr10-likeAction.is-liked{border-color:rgba(76,230,150,.42)!important;background:linear-gradient(180deg,rgba(13,70,46,.88),rgba(6,30,20,.92))!important;box-shadow:0 0 20px rgba(65,221,142,.08),inset 0 1px rgba(255,255,255,.04)!important}
        .tr10-lessAction.is-down{border-color:rgba(255,91,104,.40)!important;background:linear-gradient(180deg,rgba(76,19,29,.88),rgba(31,8,13,.94))!important;box-shadow:0 0 18px rgba(235,68,83,.06),inset 0 1px rgba(255,255,255,.035)!important}
        .tr10-editAction{border-color:rgba(105,221,250,.25)!important;background:linear-gradient(180deg,rgba(10,38,49,.96),rgba(4,17,23,.98))!important}

        .tr10-headActions button:not(:disabled):hover,.tr10-bulk button:not(:disabled):hover,.tr10-pager button:not(:disabled):hover{background:linear-gradient(180deg,rgba(16,49,61,.98),rgba(6,22,29,.98))!important;border-color:rgba(109,224,252,.38)!important;color:#fff!important;box-shadow:inset 0 1px rgba(255,255,255,.07),0 9px 22px rgba(0,0,0,.20),0 0 22px rgba(53,204,242,.07)!important;filter:none!important}
        .tr10-headActions .is-orange:not(:disabled):hover{background:linear-gradient(180deg,#ffc35d,#f0951b)!important;border-color:#ffd27c!important;color:#071016!important;box-shadow:0 10px 28px rgba(243,148,26,.20),inset 0 1px rgba(255,255,255,.58)!important}

        @media(max-width:650px){.tr10-detailPortal{padding:8px!important}.tr10-actions button{min-height:36px!important;padding:0 8px!important}.tr10-actionGlyph{width:16px;height:16px}}


        /* MVP_TRAINER_V5_R12_5E_20_LUMINOUS_HOVER */
        .tr10-premiumLibrary button:not(:disabled){transition:transform .15s ease,filter .15s ease,border-color .15s ease,background .15s ease,box-shadow .15s ease,color .15s ease!important}
        .tr10-premiumLibrary button:not(:disabled):hover{filter:brightness(1.16) saturate(1.05)!important}
        .tr10-actions button:not(:disabled):hover{color:#f8fdff!important;border-color:rgba(116,228,255,.48)!important;background:radial-gradient(100px 40px at 20% 0%,rgba(94,228,255,.18),transparent 76%),linear-gradient(180deg,#123f50,#092630)!important;box-shadow:inset 0 1px rgba(255,255,255,.11),0 10px 24px rgba(0,0,0,.18),0 0 26px rgba(54,209,247,.12)!important}
        .tr10-actions .tr10-likeAction:not(:disabled):hover{color:#baffd7!important;border-color:rgba(84,239,162,.52)!important;background:radial-gradient(120px 44px at 18% 0%,rgba(87,241,165,.20),transparent 76%),linear-gradient(180deg,#14563a,#0a2b1e)!important;box-shadow:inset 0 1px rgba(255,255,255,.10),0 0 24px rgba(67,224,146,.13)!important}
        .tr10-actions .tr10-lessAction:not(:disabled):hover{color:#ffd0d4!important;border-color:rgba(255,111,123,.50)!important;background:radial-gradient(120px 44px at 18% 0%,rgba(255,100,115,.20),transparent 76%),linear-gradient(180deg,#5a1c27,#2c0d14)!important;box-shadow:inset 0 1px rgba(255,255,255,.09),0 0 22px rgba(243,72,90,.11)!important}
        .tr10-actions .tr10-nextAction:not(:disabled):hover{color:#e5fbff!important;border-color:rgba(98,226,255,.55)!important;background:linear-gradient(180deg,#12485a,#0a2934)!important}
        .tr10-actions .tr10-queueAction:not(:disabled):hover{color:#e8f8ff!important;border-color:rgba(104,190,255,.50)!important;background:linear-gradient(180deg,#153b59,#0b2236)!important}
        .tr10-actions .tr10-playlistAction:not(:disabled):hover{color:#fff1d0!important;border-color:rgba(255,193,93,.50)!important;background:linear-gradient(180deg,#5b3b12,#2c1c08)!important;box-shadow:0 0 22px rgba(244,164,45,.10),inset 0 1px rgba(255,255,255,.08)!important}
        .tr10-actions .tr10-editAction:not(:disabled):hover{color:#fff!important;border-color:rgba(132,233,255,.58)!important;background:linear-gradient(180deg,#16536a,#0b2c38)!important;box-shadow:0 0 24px rgba(67,211,248,.12),inset 0 1px rgba(255,255,255,.10)!important}
        .tr10-headActions button:not(:disabled):hover,.tr10-bulk button:not(:disabled):hover,.tr10-pager button:not(:disabled):hover,.tr10-order button:not(:disabled):hover{color:#fff!important;border-color:rgba(113,225,255,.46)!important;background:radial-gradient(120px 45px at 20% 0%,rgba(92,226,255,.16),transparent 74%),linear-gradient(180deg,#123f50,#08232d)!important;box-shadow:inset 0 1px rgba(255,255,255,.10),0 10px 24px rgba(0,0,0,.18),0 0 24px rgba(51,204,242,.10)!important}
        .tr10-headActions .is-orange:not(:disabled):hover{filter:brightness(1.08) saturate(1.06)!important;background:linear-gradient(180deg,#ffd277,#ffab32)!important;border-color:#ffe0a1!important;color:#091014!important;box-shadow:0 12px 30px rgba(247,157,36,.24),inset 0 1px rgba(255,255,255,.65)!important}
        .tr10-healthRail button:not(:disabled):hover{color:#f4fcff!important;background:linear-gradient(180deg,rgba(44,190,229,.15),rgba(10,53,68,.09))!important;box-shadow:inset 0 -2px rgba(74,217,255,.34),0 0 20px rgba(56,205,243,.07)!important}
        .tr10-tabs button:not(:disabled):hover{filter:brightness(1.14) saturate(1.07)!important;background:linear-gradient(180deg,rgba(255,255,255,.075),transparent 28%),radial-gradient(90% 82% at 30% 110%,color-mix(in srgb,var(--tab-a) 21%,transparent),transparent 70%),radial-gradient(80% 70% at 88% 112%,color-mix(in srgb,var(--tab-b) 14%,transparent),transparent 72%),linear-gradient(180deg,rgba(12,38,49,.97),rgba(3,15,21,.98))!important}
        .tr10-collectionPlay:not(:disabled):hover,.tr10-smartCollections button:not(:disabled):hover,.tr10-playlistLayout>aside>button:not(:disabled):hover{filter:brightness(1.18) saturate(1.06)!important;background:linear-gradient(180deg,rgba(21,77,96,.92),rgba(7,32,42,.92))!important;border-color:rgba(102,224,255,.38)!important;box-shadow:inset 0 1px rgba(255,255,255,.08),0 0 24px rgba(57,207,245,.09)!important}
        .tr10-toolbar label:hover{filter:brightness(1.13)!important;background:radial-gradient(170px 55px at 20% 0%,rgba(84,222,255,.14),transparent 78%),linear-gradient(180deg,rgba(11,39,49,.90),rgba(4,20,27,.82))!important;border-color:rgba(94,222,255,.38)!important}
        @media(hover:none){.tr10-premiumLibrary button:not(:disabled):hover{filter:none!important;transform:none!important}.tr10-premiumLibrary button:not(:disabled):active{filter:brightness(1.12)!important;transform:scale(.985)!important}}


        /* MVP_TRAINER_V5_R12_5E_21_UNIFIED_MUSIC_OS */
        .tr10-toolbar>.mvpPremiumSelect{align-self:stretch;min-width:0}
        .tr10-discoverArchiveTools>.mvpPremiumSelect{min-width:160px}

        /* Every premium control gains light on hover. Older dark hover declarations stay underneath this final optical rule. */
        @media(hover:hover){
          .tr10-page button:not(:disabled):hover{filter:brightness(1.16) saturate(1.06)!important}
          .tr10-tabs button:not(:disabled):hover{color:#f3fcff!important;border-color:rgba(96,225,255,.33)!important;box-shadow:inset 0 1px rgba(255,255,255,.07),0 0 21px rgba(50,204,244,.08)!important}
        }

        /* PLAYLISTS — collection browser, not a folder/sidebar table. */
        .tr21-playlists{--pl-cyan:#48dcff;--pl-orange:#ffab35;position:relative;isolation:isolate;display:grid;grid-template-columns:220px minmax(0,1fr);min-height:560px;border-top:1px solid rgba(76,187,220,.12);background:radial-gradient(680px 320px at 0 15%,rgba(31,190,229,.10),transparent 70%),radial-gradient(620px 360px at 100% 45%,rgba(255,139,31,.07),transparent 72%),linear-gradient(180deg,rgba(2,10,14,.88),rgba(2,7,10,.96));overflow:hidden}
        .tr21-playlists:before{content:"";position:absolute;z-index:-1;inset:0;pointer-events:none;background:linear-gradient(112deg,transparent 0 35%,rgba(88,222,255,.025) 48%,transparent 58%),radial-gradient(circle at 48% 108%,rgba(76,211,247,.05),transparent 28%)}
        .tr21-playlistDock{padding:15px 12px;border-right:1px solid rgba(83,177,207,.11);background:linear-gradient(180deg,rgba(3,16,21,.88),rgba(2,10,14,.94));display:grid;align-content:start;gap:10px;min-width:0}
        .tr21-playlistDockHead{display:flex;align-items:center;justify-content:space-between;padding:0 3px 2px;color:#79a3b0}.tr21-playlistDockHead span{font-size:6.5px;font-weight:1000;letter-spacing:.15em}.tr21-playlistDockHead b{font-size:15px;color:#62dfff}
        .tr21-createPlaylist{display:grid;grid-template-columns:minmax(0,1fr) 40px;gap:6px}.tr21-createPlaylist input{min-width:0;height:42px;padding:0 11px;border:1px solid rgba(87,180,211,.18);border-radius:9px;background:#041017;color:#ecfaff;outline:0;font-size:9px}.tr21-createPlaylist input:focus{border-color:rgba(74,215,255,.46);box-shadow:0 0 0 2px rgba(58,206,246,.06)}.tr21-createPlaylist button{height:42px;border:1px solid rgba(80,210,249,.30);border-radius:9px;background:linear-gradient(180deg,#0b3140,#071b24);color:#8be9ff;font-size:18px;font-weight:500;cursor:pointer}
        .tr21-playlistChoices{display:grid;gap:5px}.tr21-playlistChoices>button{min-width:0;min-height:58px;padding:8px 9px;display:grid;grid-template-columns:24px minmax(0,1fr) 12px;gap:8px;align-items:center;border:1px solid transparent;border-radius:10px;background:transparent;color:#8fa9b3;text-align:left;cursor:pointer;transition:.16s ease}.tr21-playlistChoices>button i{font-style:normal;font-size:7px;color:#47626c;font-weight:1000}.tr21-playlistChoices>button span{display:grid;gap:2px;min-width:0}.tr21-playlistChoices strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#cfe1e7;font-size:10px}.tr21-playlistChoices small{font-size:6px;letter-spacing:.08em;color:#617c86;font-weight:900}.tr21-playlistChoices em{font-style:normal;font-size:18px;color:#496b77}.tr21-playlistChoices>button.is-active{border-color:rgba(78,214,253,.27);background:radial-gradient(170px 70px at 0 50%,rgba(48,205,245,.16),transparent 78%),linear-gradient(180deg,#071d26,#041219);box-shadow:inset 2px 0 var(--pl-cyan),0 0 22px rgba(49,203,243,.06)}.tr21-playlistChoices>button.is-active strong{color:#f2fcff}.tr21-playlistChoices>button.is-active i,.tr21-playlistChoices>button.is-active em{color:#69e4ff}
        .tr21-playlistStage{min-width:0;padding:14px 14px 18px;display:grid;align-content:start;gap:11px}
        .tr21-playlistHero{position:relative;overflow:hidden;display:grid;grid-template-columns:150px minmax(0,1fr) 180px;gap:18px;align-items:center;min-height:190px;padding:17px;border:1px solid rgba(91,186,217,.13);border-radius:16px;background:radial-gradient(460px 210px at 4% 12%,rgba(48,202,243,.12),transparent 69%),radial-gradient(400px 220px at 104% 100%,rgba(255,147,34,.08),transparent 70%),linear-gradient(135deg,rgba(6,24,32,.96),rgba(2,9,13,.98));box-shadow:0 20px 50px rgba(0,0,0,.22),inset 0 1px rgba(255,255,255,.025)}
        .tr21-playlistHero:after{content:"";position:absolute;left:17px;right:17px;bottom:0;height:1px;background:linear-gradient(90deg,var(--pl-cyan),rgba(255,255,255,.18),var(--pl-orange),transparent);opacity:.7}
        .tr21-playlistArt{position:relative;width:150px;height:150px;border-radius:15px;overflow:hidden;background:radial-gradient(circle at 35% 20%,#163744,#061219 68%);box-shadow:0 18px 42px rgba(0,0,0,.38),0 0 0 1px rgba(255,255,255,.09)}.tr21-playlistArt .tr10-art,.tr21-playlistArt img{width:100%!important;height:100%!important;border-radius:inherit!important;object-fit:cover!important}.tr21-playlistArt>span{height:100%;display:grid;place-items:center;color:#67dbf9;font-size:34px}.tr21-playlistArt>i{position:absolute;inset:0;pointer-events:none;background:linear-gradient(145deg,rgba(255,255,255,.08),transparent 28%,rgba(57,207,246,.04))}
        .tr21-playlistHeroCopy{min-width:0}.tr21-playlistHeroCopy>small{font-size:6.5px;font-weight:1000;letter-spacing:.17em;color:#63dfff}.tr21-playlistHeroCopy h2{margin:5px 0 5px;color:#fff;font-size:clamp(25px,3vw,39px);line-height:1;letter-spacing:-.05em;text-wrap:balance}.tr21-playlistHeroCopy>p{max-width:540px;margin:0;color:#748f99;font-size:8px;line-height:1.45}
        .tr21-playlistMetrics{display:flex;gap:18px;margin-top:18px;padding-top:12px;border-top:1px solid rgba(92,170,196,.09)}.tr21-playlistMetrics span{display:grid;gap:3px}.tr21-playlistMetrics b{font-size:15px;color:#ebfaff;letter-spacing:-.03em}.tr21-playlistMetrics small{font-size:5.5px;font-weight:1000;letter-spacing:.1em;color:#627b85}
        .tr21-playlistHeroActions{display:grid;grid-template-columns:1fr 1fr;gap:7px}.tr21-playlistHeroActions>button{min-height:55px;padding:0 10px;display:flex;align-items:center;gap:8px;border:1px solid rgba(92,174,202,.13);border-radius:10px;background:linear-gradient(180deg,#07171e,#040d12);color:#b6ccd4;cursor:pointer;text-align:left}.tr21-playlistHeroActions>button>i{width:27px;height:27px;display:grid;place-items:center;flex:0 0 27px;border-radius:50%;font-style:normal;background:#06131a;color:#71e5ff;border:1px solid rgba(78,205,244,.20)}.tr21-playlistHeroActions>button>span{display:grid;gap:1px}.tr21-playlistHeroActions strong{font-size:7px;letter-spacing:.1em;color:#eefbff}.tr21-playlistHeroActions small{font-size:5.5px;color:#617982}.tr21-playlistHeroActions .is-play{border-color:rgba(77,215,255,.25);background:linear-gradient(180deg,#092b37,#06171f)}.tr21-playlistHeroActions .is-shuffle>i{color:#a5f4ff}.tr21-playlistHeroActions .is-export{border-color:rgba(255,174,58,.20)}.tr21-playlistHeroActions .is-export>i{color:#ffbd5b;border-color:rgba(255,174,58,.22)}.tr21-playlistHeroActions .is-delete{min-height:34px;grid-column:1/-1;justify-content:center;color:#ff7d88;border-color:rgba(255,82,97,.17);background:#12080a;font-size:6px;font-weight:1000;letter-spacing:.1em}.tr21-playlistHeroActions button:disabled{opacity:.32;cursor:default}
        .tr21-playlistRailHead{display:flex;align-items:end;justify-content:space-between;gap:12px;padding:5px 2px}.tr21-playlistRailHead>div{display:grid;gap:2px}.tr21-playlistRailHead span{font-size:6px;font-weight:1000;letter-spacing:.15em;color:#5ccfee}.tr21-playlistRailHead strong{font-size:9px;color:#b8cdd5}.tr21-playlistRailHead>button{min-height:34px;padding:0 10px;border:1px solid rgba(75,197,236,.19);border-radius:8px;background:#071820;color:#a8deec;font-size:6.5px;font-weight:1000;letter-spacing:.08em}.tr21-playlistRailHead>button:disabled{opacity:.3}
        .tr21-playlistTracks{display:grid;gap:4px}.tr21-playlistTracks>article{min-width:0;min-height:58px;padding:7px 8px;display:grid;grid-template-columns:26px 42px minmax(0,1fr) 78px 48px auto;gap:9px;align-items:center;border:1px solid rgba(91,161,184,.08);border-radius:9px;background:linear-gradient(180deg,rgba(5,16,21,.86),rgba(2,9,13,.92));transition:.15s ease}.tr21-playlistTracks>article:hover{border-color:rgba(74,197,236,.19);background:radial-gradient(220px 70px at 0 50%,rgba(43,188,227,.08),transparent 80%),linear-gradient(180deg,#071a22,#031016)}.tr21-playlistTracks>article.is-current{border-color:rgba(70,211,251,.28);box-shadow:inset 2px 0 #48d9ff}.tr21-trackNumber{font-size:7px;color:#4e6872;font-weight:1000}.tr21-playlistTracks .tr10-art{width:42px!important;height:42px!important;border-radius:7px!important}.tr21-playlistTrackCopy{min-width:0;display:grid;gap:2px}.tr21-playlistTrackCopy strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#eaf7fb;font-size:9px}.tr21-playlistTrackCopy span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#718993;font-size:6.5px}.tr21-playlistEnergy{display:flex;align-items:center;gap:5px;font-size:5.8px;font-weight:1000;letter-spacing:.08em;color:#8aa2ac}.tr21-playlistEnergy i{width:6px;height:6px;border-radius:50%;background:#58cfe9;box-shadow:0 0 8px rgba(70,207,240,.24)}.tr21-playlistEnergy.is-high{color:#ffc35a}.tr21-playlistEnergy.is-high i{background:#ffae36;box-shadow:0 0 8px rgba(255,163,44,.25)}.tr21-playlistEnergy.is-low{color:#78e4aa}.tr21-playlistEnergy.is-low i{background:#50d996}.tr21-playlistDuration{font-size:7px;color:#78919b;text-align:right}.tr21-playlistTrackActions{display:flex;gap:4px;justify-content:flex-end}.tr21-playlistTrackActions button{height:30px;min-width:30px;padding:0 7px;border:1px solid rgba(87,160,185,.11);border-radius:7px;background:#06141a;color:#809ba5;font-size:6px;font-weight:1000;cursor:pointer}.tr21-playlistTrackActions .is-trackPlay{color:#72dff8;border-color:rgba(72,201,240,.19)}.tr21-playlistTrackActions .is-remove{color:#ff7984;border-color:rgba(255,78,92,.15);background:#110709}.tr21-playlistTrackActions button:disabled{opacity:.2;cursor:default}
        .tr21-playlistEmpty{min-height:130px;display:grid;place-content:center;justify-items:center;gap:6px;color:#687f89;text-align:center}.tr21-playlistEmpty b{font-size:8px;letter-spacing:.13em;color:#c9dbe1}.tr21-playlistEmpty span{font-size:7px}.tr21-playlistEmpty.is-stage{min-height:420px}

        /* Mobile tab rail: real swipe deck, every tab fully reachable and active tab can center itself. */
        @media(max-width:650px){
          .tr10-tabs{display:flex!important;grid-template-columns:none!important;gap:8px!important;width:100%!important;max-width:100%!important;overflow-x:auto!important;overflow-y:hidden!important;padding:8px 14px 10px!important;box-sizing:border-box!important;scroll-snap-type:x proximity!important;scroll-padding-inline:14px!important;-webkit-overflow-scrolling:touch!important;overscroll-behavior-inline:contain!important;scrollbar-width:none!important}
          .tr10-tabs::-webkit-scrollbar{display:none!important}
          .tr10-tabs button{flex:0 0 132px!important;min-width:132px!important;width:132px!important;height:48px!important;scroll-snap-align:center!important;scroll-snap-stop:normal!important;border-radius:10px!important}
          .tr10-tabs button:first-child{margin-left:0!important}.tr10-tabs button:last-child{margin-right:2px!important}
          .tr10-toolbar>.mvpPremiumSelect{min-width:0!important}
          .tr10-discoverArchiveTools{grid-template-columns:1fr!important}.tr10-discoverArchiveTools>.mvpPremiumSelect{width:100%!important;min-width:0!important}
          .tr21-playlists{grid-template-columns:1fr;min-height:0}.tr21-playlistDock{border-right:0;border-bottom:1px solid rgba(83,177,207,.11);padding:11px 10px}.tr21-playlistChoices{display:flex;overflow-x:auto;gap:7px;padding-bottom:3px;scroll-snap-type:x proximity;scrollbar-width:none}.tr21-playlistChoices::-webkit-scrollbar{display:none}.tr21-playlistChoices>button{flex:0 0 155px;scroll-snap-align:start}.tr21-playlistStage{padding:10px}.tr21-playlistHero{grid-template-columns:88px minmax(0,1fr);gap:12px;min-height:0;padding:12px}.tr21-playlistArt{width:88px;height:88px}.tr21-playlistHeroCopy h2{font-size:25px}.tr21-playlistHeroCopy>p{font-size:7px}.tr21-playlistMetrics{grid-column:1/-1;display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:11px;padding-top:9px}.tr21-playlistHeroActions{grid-column:1/-1;grid-template-columns:1fr 1fr 1fr auto}.tr21-playlistHeroActions .is-delete{grid-column:auto;min-height:48px;padding:0 10px}.tr21-playlistHeroActions small{display:none}.tr21-playlistTracks>article{grid-template-columns:22px 40px minmax(0,1fr) auto;gap:7px}.tr21-playlistEnergy,.tr21-playlistDuration{display:none}.tr21-playlistTrackActions{grid-column:3/-1;justify-content:flex-start;padding-top:3px}.tr21-playlistTrackActions button{height:34px;min-width:34px}.tr21-playlistTrackActions .is-remove{margin-left:auto}
        }
        @media(max-width:430px){.tr10-tabs button{flex-basis:124px!important;min-width:124px!important;width:124px!important}.tr21-playlistHero{grid-template-columns:72px minmax(0,1fr)}.tr21-playlistArt{width:72px;height:72px}.tr21-playlistHeroCopy h2{font-size:22px}.tr21-playlistMetrics{grid-template-columns:1fr 1fr}.tr21-playlistHeroActions{grid-template-columns:1fr 1fr}.tr21-playlistHeroActions .is-delete{grid-column:1/-1;min-height:34px}.tr21-playlistRailHead{align-items:stretch;flex-direction:column}.tr21-playlistRailHead>button{width:100%}}


        /* MVP_TRAINER_V5_R12_5E_23_LIVE_CONTROL_FOUNDATION */
        .tr10-premiumLibrary{--m23-blue:#0b7cff;--m23-blueHi:#22a5ed;--m23-orange:#eb8b0f;--m23-orangeHi:#ffae35;--m23-surface:#071018;--m23-raised:#0a151e;--m23-line:rgba(130,177,196,.14);--m23-top:inset 0 1px 0 rgba(255,255,255,.055);--m23-contact:0 8px 20px rgba(0,0,0,.24)}
        .tr10-premiumLibrary .tr10-headActions button,.tr10-premiumLibrary .tr10-actions button,.tr10-premiumLibrary .tr10-bulk button,.tr10-premiumLibrary .tr10-pager button,.tr10-premiumLibrary .tr10-order button{background:#071018!important;border:1px solid var(--m23-line)!important;color:#dce7eb!important;box-shadow:var(--m23-top),0 5px 12px rgba(0,0,0,.19)!important;filter:none!important;text-shadow:none!important}
        @media(hover:hover){
          .tr10-premiumLibrary .tr10-headActions button:not(:disabled):hover,.tr10-premiumLibrary .tr10-actions button:not(:disabled):hover,.tr10-premiumLibrary .tr10-bulk button:not(:disabled):hover,.tr10-premiumLibrary .tr10-pager button:not(:disabled):hover,.tr10-premiumLibrary .tr10-order button:not(:disabled):hover{background:#0b1821!important;border-color:rgba(34,165,237,.34)!important;color:#fff!important;box-shadow:var(--m23-top),0 9px 20px rgba(0,0,0,.25),inset 0 -1px rgba(11,124,255,.28)!important;transform:translateY(-1px)!important;filter:none!important}
          .tr10-premiumLibrary .tr10-actions .tr10-likeAction:not(:disabled):hover{background:#0b1821!important;border-color:rgba(79,224,154,.36)!important;color:#caffdf!important;box-shadow:var(--m23-top),0 9px 20px rgba(0,0,0,.24),inset 0 -1px rgba(79,224,154,.38)!important}
          .tr10-premiumLibrary .tr10-actions .tr10-lessAction:not(:disabled):hover{background:#0b1821!important;border-color:rgba(255,104,117,.34)!important;color:#ffd2d7!important;box-shadow:var(--m23-top),0 9px 20px rgba(0,0,0,.24),inset 0 -1px rgba(255,104,117,.34)!important}
          .tr10-premiumLibrary .tr10-actions .tr10-playlistAction:not(:disabled):hover{background:#0b1821!important;border-color:rgba(235,139,15,.38)!important;color:#ffe5bb!important;box-shadow:var(--m23-top),0 9px 20px rgba(0,0,0,.24),inset 0 -1px rgba(235,139,15,.38)!important}
        }
        .tr10-premiumLibrary .tr10-actions .tr10-likeAction.is-liked{background:#09151a!important;border-color:rgba(79,224,154,.32)!important;color:#bfffd7!important;box-shadow:var(--m23-top),inset 0 -2px rgba(79,224,154,.44)!important}
        .tr10-premiumLibrary .tr10-actions .tr10-lessAction.is-down{background:#09151a!important;border-color:rgba(255,104,117,.30)!important;color:#ffc5cb!important;box-shadow:var(--m23-top),inset 0 -2px rgba(255,104,117,.40)!important}
        .tr10-premiumLibrary .tr10-actions .tr10-editAction{background:#09141c!important;border-color:rgba(34,165,237,.24)!important;color:#d9f1ff!important}
        .tr10-premiumLibrary .tr10-actionGlyph{background:#02070b!important;border:1px solid rgba(255,255,255,.035)!important;box-shadow:inset 0 1px rgba(255,255,255,.025)!important}
        .tr10-premiumLibrary .tr10-headActions .is-orange{background:#d97808!important;border-color:#f3a02b!important;color:#081015!important;box-shadow:inset 0 1px rgba(255,255,255,.28),0 8px 20px rgba(0,0,0,.22)!important}
        @media(hover:hover){.tr10-premiumLibrary .tr10-headActions .is-orange:not(:disabled):hover{background:#ee8e12!important;border-color:#ffb647!important;color:#071014!important;box-shadow:inset 0 1px rgba(255,255,255,.34),0 10px 24px rgba(0,0,0,.26),0 0 0 1px rgba(235,139,15,.08)!important;transform:translateY(-1px)!important;filter:none!important}}
        .tr10-premiumLibrary .tr10-headActions .is-orange:not(:disabled):active{background:#cf7306!important;transform:translateY(1px)!important}

        /* Active navigation: precision hardware slot, no glossy fake pill. */
        .tr10-premiumLibrary .tr10-tabs button{background:#071018!important;border:1px solid rgba(126,174,193,.12)!important;color:#9baab1!important;box-shadow:inset 0 1px rgba(255,255,255,.045),0 4px 10px rgba(0,0,0,.18)!important}
        @media(hover:hover){.tr10-premiumLibrary .tr10-tabs button:not(.is-active):hover{background:#0a151e!important;border-color:rgba(34,165,237,.26)!important;color:#f2f7f9!important;box-shadow:inset 0 1px rgba(255,255,255,.06),0 8px 18px rgba(0,0,0,.23),inset 0 -1px rgba(11,124,255,.20)!important;filter:none!important}}
        .tr10-premiumLibrary .tr10-tabs button.is-active{background:#0b1620!important;border-color:rgba(34,165,237,.46)!important;color:#fff!important;box-shadow:inset 0 1px rgba(255,255,255,.07),0 10px 24px rgba(0,0,0,.27),inset 0 -2px var(--m23-blue)!important;filter:none!important}
        .tr10-premiumLibrary .tr10-tabs button.is-active:after{background:linear-gradient(90deg,transparent,var(--m23-blue) 20%,var(--m23-blueHi) 64%,var(--m23-orange) 92%,transparent)!important;opacity:.72!important;filter:none!important}

        /* Readability and density. */
        .tr10-premiumLibrary .tr10-row{min-height:52px!important}
        .tr10-premiumLibrary .tr10-trackText strong{font-size:10.5px!important;line-height:1.18!important;color:#f4f8fa!important}.tr10-premiumLibrary .tr10-trackText span{font-size:8px!important;line-height:1.25!important;color:#8fa1a9!important}
        .tr10-premiumLibrary .tr10-actions button{min-height:31px!important;font-size:7.5px!important;font-weight:850!important;letter-spacing:.035em!important}
        .tr10-premiumLibrary .tr10-toolbar label>span,.tr10-premiumLibrary .mvpPremiumSelectLabel{font-size:8px!important}
        .tr10-premiumLibrary .tr10-directoryEyebrow,.tr10-premiumLibrary .tr10-sectionHead span{font-size:8.5px!important}
        .tr10-premiumLibrary .tr10-stats strong{color:#f2a02b!important}.tr10-premiumLibrary .tr10-directoryEyebrow,.tr10-premiumLibrary .tr10-sectionHead span,.tr10-premiumLibrary .tr10-hero span{color:#68b8ff!important}
        .tr10-premiumLibrary .tr10-healthRail button.is-review.is-active{border-color:rgba(11,124,255,.38)!important;color:#b8d9ff!important;background:#09141c!important;box-shadow:inset 0 -2px rgba(11,124,255,.38)!important}
        .tr10-premiumLibrary .tr10-discoverType.is-hidden_gem{color:#ffd49a!important;border-color:rgba(235,139,15,.28)!important}

        /* Keep artwork-led collection views clean and dimensional. */
        .tr10-premiumLibrary .tr10-collectionCard{background:#050c12!important;border-color:rgba(128,174,193,.10)!important;box-shadow:inset 0 1px rgba(255,255,255,.035),0 10px 24px rgba(0,0,0,.20)!important}
        @media(hover:hover){.tr10-premiumLibrary .tr10-collectionCard:hover{background:#08131b!important;border-color:rgba(34,165,237,.20)!important;transform:translateY(-2px)!important;box-shadow:inset 0 1px rgba(255,255,255,.05),0 16px 32px rgba(0,0,0,.27)!important}}
        .tr10-premiumLibrary .tr10-collectionCard .tr10-art{box-shadow:0 10px 24px rgba(0,0,0,.34),0 0 0 1px rgba(255,255,255,.06)!important}

        /* Remove decorative bottom-ribbon feel from every tab shell. */
        .tr10-premiumLibrary:after,.tr10-premiumLibrary .tr10-console:after{display:none!important}

        @media(max-width:650px){
          .tr10-premiumLibrary .tr10-tabs{gap:7px!important;padding:7px max(10px,calc(env(safe-area-inset-left) + 8px)) 9px!important;scroll-padding-inline:calc(50vw - 56px)!important}
          .tr10-premiumLibrary .tr10-tabs button{flex:0 0 112px!important;min-width:112px!important;width:112px!important;height:46px!important;font-size:9px!important}
          .tr10-premiumLibrary .tr10-trackText strong{font-size:12px!important}.tr10-premiumLibrary .tr10-trackText span{font-size:9px!important}
          .tr10-premiumLibrary .tr10-actions{gap:5px!important}.tr10-premiumLibrary .tr10-actions button{min-height:38px!important;font-size:8px!important;padding:0 9px!important}
          .tr10-premiumLibrary .tr10-headActions button{min-height:44px!important;font-size:9px!important}
        }

      `}</style>
    </main>
  );
}
