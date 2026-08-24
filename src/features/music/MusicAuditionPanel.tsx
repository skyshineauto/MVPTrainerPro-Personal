import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { MusicTrack } from "../../lib/musicStorage";
import { supabase } from "../../lib/supabase";

export type AuditionDecision = "keep" | "pass" | "maybe" | null;

export type MusicAuditionSong = {
  id: string;
  canonicalKey: string;
  title: string;
  artist: string;
  album: string;
  releaseYear: number | null;
  genre: string | null;
  artworkUrl: string | null;
  previewUrl: string | null;
  storeUrl: string | null;
  decision: AuditionDecision;
  decidedAt: number | null;
  createdAt: number;
  updatedAt: number;
  metadataUpdatedAt: number | null;
  libraryTrackId: string | null;
};

export type MusicAuditionList = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  songIds: string[];
};

export type MusicAuditionState = {
  version: 1;
  lists: MusicAuditionList[];
  songs: MusicAuditionSong[];
};

export type ParsedAuditionLine = {
  artist: string;
  title: string;
};

type CloudListRow = {
  list_id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

type CloudSongRow = {
  song_id: string;
  canonical_key: string;
  title: string;
  artist: string;
  album: string | null;
  release_year: number | null;
  genre: string | null;
  artwork_url: string | null;
  preview_url: string | null;
  store_url: string | null;
  decision: "keep" | "pass" | "maybe" | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
  metadata_updated_at: string | null;
  library_track_id: string | null;
};

type CloudLinkRow = {
  list_id: string;
  song_id: string;
  position: number;
};

type ItunesSong = {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  artworkUrl100?: string;
  releaseDate?: string;
  primaryGenreName?: string;
  previewUrl?: string;
  trackViewUrl?: string;
};

type ItunesResponse = {
  results?: ItunesSong[];
};

const STORAGE_KEY = "mvp_music_audition_v1";
const EVENT = "mvp:music-audition-changed";
const LIST_TABLE = "music_audition_lists";
const SONG_TABLE = "music_audition_songs";
const LINK_TABLE = "music_audition_list_songs";
const METADATA_FRESH_MS = 30 * 86400000;
const metadataRequests = new Map<string, Promise<MusicAuditionSong>>();
let cloudHydrationPromise: Promise<void> | null = null;

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalize(value: unknown) {
  return clean(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/\b(feat|featuring|ft)\.?\b.*$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function canonicalTitle(value: unknown) {
  return normalize(value)
    .replace(/\b(?:remaster(?:ed)?|radio edit|single version|album version|explicit|clean|deluxe|bonus track|reissue)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function auditionCanonicalKey(artist: unknown, title: unknown) {
  return `${normalize(artist)}|${canonicalTitle(title)}`;
}

function now() {
  return Date.now();
}

function defaultState(): MusicAuditionState {
  return { version: 1, lists: [], songs: [] };
}

function sanitizeDecision(value: unknown): AuditionDecision {
  return value === "keep" || value === "pass" || value === "maybe" ? value : null;
}

function sanitizeSong(value: unknown): MusicAuditionSong | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<MusicAuditionSong>;
  const title = clean(row.title);
  const artist = clean(row.artist);
  if (!title || !artist) return null;
  const canonicalKey = clean(row.canonicalKey) || auditionCanonicalKey(artist, title);
  const createdAt = Number(row.createdAt) || now();
  return {
    id: clean(row.id) || crypto.randomUUID(),
    canonicalKey,
    title,
    artist,
    album: clean(row.album),
    releaseYear: Number(row.releaseYear) >= 1900 ? Number(row.releaseYear) : null,
    genre: clean(row.genre) || null,
    artworkUrl: clean(row.artworkUrl) || null,
    previewUrl: clean(row.previewUrl) || null,
    storeUrl: clean(row.storeUrl) || null,
    decision: sanitizeDecision(row.decision),
    decidedAt: Number(row.decidedAt) || null,
    createdAt,
    updatedAt: Number(row.updatedAt) || createdAt,
    metadataUpdatedAt: Number(row.metadataUpdatedAt) || null,
    libraryTrackId: clean(row.libraryTrackId) || null,
  };
}

function sanitizeList(value: unknown, knownSongIds: Set<string>): MusicAuditionList | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<MusicAuditionList>;
  const name = clean(row.name);
  if (!name) return null;
  const createdAt = Number(row.createdAt) || now();
  const songIds = Array.isArray(row.songIds)
    ? row.songIds.map(clean).filter((id, index, all) => id && knownSongIds.has(id) && all.indexOf(id) === index)
    : [];
  return {
    id: clean(row.id) || crypto.randomUUID(),
    name,
    createdAt,
    updatedAt: Number(row.updatedAt) || createdAt,
    songIds,
  };
}

function readLocal(): MusicAuditionState {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as Partial<MusicAuditionState> | null;
    if (!parsed) return defaultState();
    const songs = (Array.isArray(parsed.songs) ? parsed.songs : []).map(sanitizeSong).filter((song): song is MusicAuditionSong => Boolean(song));
    const songIds = new Set(songs.map((song) => song.id));
    const lists = (Array.isArray(parsed.lists) ? parsed.lists : []).map((list) => sanitizeList(list, songIds)).filter((list): list is MusicAuditionList => Boolean(list));
    return { version: 1, lists, songs };
  } catch {
    return defaultState();
  }
}

function writeLocal(state: MusicAuditionState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent(EVENT));
}

function mutateLocal(mutator: (state: MusicAuditionState) => MusicAuditionState) {
  const next = mutator(readLocal());
  writeLocal(next);
  return next;
}

export function listMusicAuditionState() {
  return readLocal();
}

export function subscribeMusicAudition(listener: () => void) {
  const handler = () => listener();
  window.addEventListener(EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

function stripLineFormatting(line: string) {
  return line
    .replace(/^\s*(?:[-*•▪◦]+|\d+[.)])\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/`/g, "")
    .replace(/\s+[⭐🔥]+.*$/, "")
    .replace(/\s+[•|]\s*(?:19|20)\d{2}.*$/, "")
    .trim();
}

export function parseAuditionListText(text: string): ParsedAuditionLine[] {
  const parsed: ParsedAuditionLine[] = [];
  const seen = new Set<string>();

  for (const raw of text.split(/\r?\n/)) {
    const line = stripLineFormatting(raw);
    if (!line) continue;

    let artist = "";
    let title = "";
    const separators = [" — ", " – ", " - ", "\t", " → "];
    let split: string[] | null = null;
    for (const separator of separators) {
      if (!line.includes(separator)) continue;
      split = line.split(separator).map((part) => clean(part)).filter(Boolean);
      if (split.length >= 2) break;
    }
    if (!split || split.length < 2) continue;

    artist = clean(split[0]);
    title = clean(split.slice(1).join(" - "));
    title = title
      .replace(/\s+→\s+.+$/, "")
      .replace(/\s*[•|]\s*(?:19|20)\d{2}.*$/, "")
      .trim();
    if (!artist || !title) continue;

    const key = auditionCanonicalKey(artist, title);
    if (!key.includes("|") || seen.has(key)) continue;
    seen.add(key);
    parsed.push({ artist, title });
  }
  return parsed;
}

async function currentUserId() {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

function songToCloud(userId: string, song: MusicAuditionSong) {
  return {
    user_id: userId,
    song_id: song.id,
    canonical_key: song.canonicalKey,
    title: song.title,
    artist: song.artist,
    album: song.album || null,
    release_year: song.releaseYear,
    genre: song.genre,
    artwork_url: song.artworkUrl,
    preview_url: song.previewUrl,
    store_url: song.storeUrl,
    decision: song.decision,
    decided_at: song.decidedAt ? new Date(song.decidedAt).toISOString() : null,
    created_at: new Date(song.createdAt).toISOString(),
    updated_at: new Date(song.updatedAt).toISOString(),
    metadata_updated_at: song.metadataUpdatedAt ? new Date(song.metadataUpdatedAt).toISOString() : null,
    library_track_id: song.libraryTrackId,
  };
}

function listToCloud(userId: string, list: MusicAuditionList) {
  return {
    user_id: userId,
    list_id: list.id,
    name: list.name,
    created_at: new Date(list.createdAt).toISOString(),
    updated_at: new Date(list.updatedAt).toISOString(),
  };
}

async function persistSong(song: MusicAuditionSong) {
  try {
    const userId = await currentUserId();
    if (!userId) return;
    await supabase.from(SONG_TABLE).upsert(songToCloud(userId, song), { onConflict: "user_id,song_id" });
  } catch {
    // Local state remains available offline or before the migration is installed.
  }
}

async function persistList(list: MusicAuditionList) {
  try {
    const userId = await currentUserId();
    if (!userId) return;
    const local = readLocal();
    const referencedSongs = local.songs.filter((song) => list.songIds.includes(song.id));
    if (referencedSongs.length) {
      await supabase.from(SONG_TABLE).upsert(referencedSongs.map((song) => songToCloud(userId, song)), { onConflict: "user_id,song_id" });
    }
    await supabase.from(LIST_TABLE).upsert(listToCloud(userId, list), { onConflict: "user_id,list_id" });
    await supabase.from(LINK_TABLE).delete().eq("user_id", userId).eq("list_id", list.id);
    if (list.songIds.length) {
      await supabase.from(LINK_TABLE).insert(list.songIds.map((songId, position) => ({ user_id: userId, list_id: list.id, song_id: songId, position })));
    }
  } catch {
    // Best effort cloud sync.
  }
}

async function persistWholeState(state: MusicAuditionState) {
  try {
    const userId = await currentUserId();
    if (!userId) return;
    if (state.songs.length) {
      await supabase.from(SONG_TABLE).upsert(state.songs.map((song) => songToCloud(userId, song)), { onConflict: "user_id,song_id" });
    }
    if (state.lists.length) {
      await supabase.from(LIST_TABLE).upsert(state.lists.map((list) => listToCloud(userId, list)), { onConflict: "user_id,list_id" });
      await supabase.from(LINK_TABLE).delete().eq("user_id", userId);
      const links = state.lists.flatMap((list) => list.songIds.map((songId, position) => ({ user_id: userId, list_id: list.id, song_id: songId, position })));
      if (links.length) await supabase.from(LINK_TABLE).insert(links);
    }
  } catch {
    // Local state remains authoritative until a later successful write.
  }
}

function cloudSongToLocal(row: CloudSongRow): MusicAuditionSong | null {
  return sanitizeSong({
    id: row.song_id,
    canonicalKey: row.canonical_key,
    title: row.title,
    artist: row.artist,
    album: row.album || "",
    releaseYear: row.release_year,
    genre: row.genre,
    artworkUrl: row.artwork_url,
    previewUrl: row.preview_url,
    storeUrl: row.store_url,
    decision: row.decision,
    decidedAt: row.decided_at ? new Date(row.decided_at).getTime() : null,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
    metadataUpdatedAt: row.metadata_updated_at ? new Date(row.metadata_updated_at).getTime() : null,
    libraryTrackId: row.library_track_id,
  });
}

export async function hydrateMusicAuditionFromCloud() {
  if (cloudHydrationPromise) return cloudHydrationPromise;
  cloudHydrationPromise = (async () => {
    try {
      const userId = await currentUserId();
      if (!userId) return;
      const [listResult, songResult, linkResult] = await Promise.all([
        supabase.from(LIST_TABLE).select("list_id,name,created_at,updated_at").eq("user_id", userId).order("created_at", { ascending: false }),
        supabase.from(SONG_TABLE).select("song_id,canonical_key,title,artist,album,release_year,genre,artwork_url,preview_url,store_url,decision,decided_at,created_at,updated_at,metadata_updated_at,library_track_id").eq("user_id", userId),
        supabase.from(LINK_TABLE).select("list_id,song_id,position").eq("user_id", userId).order("position", { ascending: true }),
      ]);
      if (listResult.error || songResult.error || linkResult.error) return;

      const songs = ((songResult.data || []) as CloudSongRow[]).map(cloudSongToLocal).filter((song): song is MusicAuditionSong => Boolean(song));
      const songIds = new Set(songs.map((song) => song.id));
      const linksByList = new Map<string, Array<{ songId: string; position: number }>>();
      for (const row of (linkResult.data || []) as CloudLinkRow[]) {
        if (!songIds.has(row.song_id)) continue;
        const rows = linksByList.get(row.list_id) || [];
        rows.push({ songId: row.song_id, position: Number(row.position) || 0 });
        linksByList.set(row.list_id, rows);
      }
      const lists = ((listResult.data || []) as CloudListRow[]).map((row) => ({
        id: row.list_id,
        name: row.name,
        createdAt: new Date(row.created_at).getTime(),
        updatedAt: new Date(row.updated_at).getTime(),
        songIds: (linksByList.get(row.list_id) || []).sort((a, b) => a.position - b.position).map((entry) => entry.songId),
      }));
      writeLocal({ version: 1, lists, songs });
    } catch {
      // Offline/local mode is intentional.
    } finally {
      cloudHydrationPromise = null;
    }
  })();
  return cloudHydrationPromise;
}

export function importMusicAuditionList(name: string, text: string) {
  const parsed = parseAuditionListText(text);
  if (!parsed.length) throw new Error("No songs found. Use one song per line as Artist - Song.");
  const listName = clean(name) || `Audition List ${new Date().toLocaleDateString()}`;
  let createdList: MusicAuditionList | null = null;
  const next = mutateLocal((state) => {
    const songs = [...state.songs];
    const byKey = new Map(songs.map((song) => [song.canonicalKey, song]));
    const songIds: string[] = [];
    for (const item of parsed) {
      const key = auditionCanonicalKey(item.artist, item.title);
      let song = byKey.get(key);
      if (!song) {
        const stamp = now();
        song = {
          id: crypto.randomUUID(),
          canonicalKey: key,
          title: item.title,
          artist: item.artist,
          album: "",
          releaseYear: null,
          genre: null,
          artworkUrl: null,
          previewUrl: null,
          storeUrl: null,
          decision: null,
          decidedAt: null,
          createdAt: stamp,
          updatedAt: stamp,
          metadataUpdatedAt: null,
          libraryTrackId: null,
        };
        songs.push(song);
        byKey.set(key, song);
      }
      if (!songIds.includes(song.id)) songIds.push(song.id);
    }
    const stamp = now();
    createdList = { id: crypto.randomUUID(), name: listName, createdAt: stamp, updatedAt: stamp, songIds };
    return { ...state, songs, lists: [createdList, ...state.lists] as MusicAuditionList[] };
  });
  void persistWholeState(next);
  return createdList!;
}

export function renameMusicAuditionList(listId: string, name: string) {
  const nextName = clean(name);
  if (!nextName) throw new Error("List name cannot be empty.");
  let changed: MusicAuditionList | null = null;
  mutateLocal((state) => ({
    ...state,
    lists: state.lists.map((list) => {
      if (list.id !== listId) return list;
      changed = { ...list, name: nextName, updatedAt: now() };
      return changed;
    }),
  }));
  if (changed) void persistList(changed);
  return changed;
}

export function duplicateMusicAuditionList(listId: string) {
  let copy: MusicAuditionList | null = null;
  mutateLocal((state) => {
    const source = state.lists.find((list) => list.id === listId);
    if (!source) return state;
    const stamp = now();
    copy = { ...source, id: crypto.randomUUID(), name: `${source.name} Copy`, createdAt: stamp, updatedAt: stamp, songIds: [...source.songIds] };
    return { ...state, lists: [copy, ...state.lists] as MusicAuditionList[] };
  });
  if (copy) void persistList(copy);
  return copy;
}

export async function deleteMusicAuditionList(listId: string) {
  mutateLocal((state) => ({ ...state, lists: state.lists.filter((list) => list.id !== listId) }));
  try {
    const userId = await currentUserId();
    if (!userId) return;
    await supabase.from(LINK_TABLE).delete().eq("user_id", userId).eq("list_id", listId);
    await supabase.from(LIST_TABLE).delete().eq("user_id", userId).eq("list_id", listId);
  } catch {
    // Keep local delete while offline.
  }
}

export function mergeMusicAuditionLists(sourceListId: string, targetListId: string) {
  if (sourceListId === targetListId) return null;
  let target: MusicAuditionList | null = null;
  mutateLocal((state) => {
    const source = state.lists.find((list) => list.id === sourceListId);
    const currentTarget = state.lists.find((list) => list.id === targetListId);
    if (!source || !currentTarget) return state;
    const combined = [...currentTarget.songIds];
    for (const id of source.songIds) if (!combined.includes(id)) combined.push(id);
    target = { ...currentTarget, songIds: combined, updatedAt: now() };
    return { ...state, lists: state.lists.map((list) => list.id === targetListId ? target! : list) };
  });
  if (target) void persistList(target);
  return target;
}

export function setMusicAuditionDecision(songId: string, decision: AuditionDecision) {
  let changed: MusicAuditionSong | null = null;
  mutateLocal((state) => ({
    ...state,
    songs: state.songs.map((song) => {
      if (song.id !== songId) return song;
      const stamp = now();
      changed = { ...song, decision, decidedAt: decision ? stamp : null, updatedAt: stamp };
      return changed;
    }),
  }));
  if (changed) void persistSong(changed);
  return changed;
}

export function markMusicAuditionSongInLibrary(songId: string, libraryTrackId: string | null) {
  let changed: MusicAuditionSong | null = null;
  mutateLocal((state) => ({
    ...state,
    songs: state.songs.map((song) => {
      if (song.id !== songId) return song;
      changed = { ...song, libraryTrackId: clean(libraryTrackId) || null, updatedAt: now() };
      return changed;
    }),
  }));
  if (changed) void persistSong(changed);
  return changed;
}

function tokenSimilarity(a: string, b: string) {
  const left = new Set(normalize(a).split(" ").filter(Boolean));
  const right = new Set(normalize(b).split(" ").filter(Boolean));
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap += 1;
  return (2 * overlap) / (left.size + right.size);
}

function artwork600(url: string | undefined) {
  if (!url) return null;
  return url.replace(/\/100x100(?:bb)?\.(jpg|png)/i, "/600x600bb.$1");
}

function yearFromDate(value: string | undefined) {
  const match = clean(value).match(/^((?:19|20)\d{2})/);
  return match ? Number(match[1]) : null;
}

export async function resolveMusicAuditionMetadata(songId: string) {
  const state = readLocal();
  const song = state.songs.find((item) => item.id === songId);
  if (!song) throw new Error("Song not found.");
  if (song.metadataUpdatedAt && now() - song.metadataUpdatedAt < METADATA_FRESH_MS && (song.previewUrl || song.artworkUrl)) return song;

  const existing = metadataRequests.get(songId);
  if (existing) return existing;

  const request = (async () => {
    try {
      const params = new URLSearchParams({ entity: "song", limit: "15", term: `${song.artist} ${song.title}` });
      const response = await fetch(`https://itunes.apple.com/search?${params.toString()}`, { mode: "cors", cache: "no-store" });
      if (!response.ok) throw new Error("Preview lookup unavailable.");
      const payload = await response.json() as ItunesResponse;
      const candidates = (payload.results || []).filter((item) => item.trackName && item.artistName);
      const best = candidates
        .map((item) => ({
          item,
          score: tokenSimilarity(song.title, item.trackName || "") * 0.65 + tokenSimilarity(song.artist, item.artistName || "") * 0.35,
        }))
        .sort((a, b) => b.score - a.score)[0];
      if (!best || best.score < 0.55) throw new Error("No reliable preview match found.");
      let changed: MusicAuditionSong | null = null;
      mutateLocal((current) => ({
        ...current,
        songs: current.songs.map((item) => {
          if (item.id !== songId) return item;
          changed = {
            ...item,
            album: clean(best.item.collectionName),
            releaseYear: yearFromDate(best.item.releaseDate),
            genre: clean(best.item.primaryGenreName) || null,
            artworkUrl: artwork600(best.item.artworkUrl100),
            previewUrl: clean(best.item.previewUrl) || null,
            storeUrl: clean(best.item.trackViewUrl) || null,
            metadataUpdatedAt: now(),
            updatedAt: now(),
          };
          return changed;
        }),
      }));
      if (changed) void persistSong(changed);
      return changed || song;
    } catch {
      let changed: MusicAuditionSong | null = null;
      mutateLocal((current) => ({
        ...current,
        songs: current.songs.map((item) => {
          if (item.id !== songId) return item;
          changed = { ...item, metadataUpdatedAt: now(), updatedAt: now() };
          return changed;
        }),
      }));
      if (changed) void persistSong(changed);
      return changed || song;
    } finally {
      metadataRequests.delete(songId);
    }
  })();
  metadataRequests.set(songId, request);
  return request;
}

export function auditionYoutubeUrl(song: Pick<MusicAuditionSong, "artist" | "title">) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${song.artist} ${song.title} official audio`)}`;
}

export function musicAuditionSongInLibrary(song: MusicAuditionSong, tracks: MusicTrack[]) {
  if (song.libraryTrackId && tracks.some((track) => track.id === song.libraryTrackId)) return true;
  const key = song.canonicalKey;
  return tracks.some((track) => auditionCanonicalKey(track.artist || "", track.title) === key);
}

export function musicAuditionSongSources(songId: string, lists: MusicAuditionList[]) {
  return lists.filter((list) => list.songIds.includes(songId));
}

type AuditionView = "lists" | "audition" | "kept";
type ListSort = "newest" | "name" | "progress" | "most_kept";

type Props = {
  tracks: MusicTrack[];
  onPreviewStart?: () => void;
  onImportFile?: (file: File, song: MusicAuditionSong) => Promise<MusicTrack | null>;
};

function listStats(list: MusicAuditionList, songsById: Map<string, MusicAuditionSong>) {
  const songs = list.songIds.map((id) => songsById.get(id)).filter((song): song is MusicAuditionSong => Boolean(song));
  const keep = songs.filter((song) => song.decision === "keep").length;
  const pass = songs.filter((song) => song.decision === "pass").length;
  const maybe = songs.filter((song) => song.decision === "maybe").length;
  const reviewed = keep + pass + maybe;
  return { total: songs.length, keep, pass, maybe, reviewed, progress: songs.length ? reviewed / songs.length : 0 };
}

function decisionLabel(decision: AuditionDecision) {
  if (decision === "keep") return "KEEP";
  if (decision === "pass") return "PASS";
  if (decision === "maybe") return "MAYBE";
  return "UNREVIEWED";
}

function dateLabel(value: number | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function defaultListName() {
  const date = new Date();
  return `Audition List ${date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

export function MusicAuditionPanel({ tracks, onPreviewStart, onImportFile }: Props) {
  const [state, setState] = useState(() => listMusicAuditionState());
  const [view, setView] = useState<AuditionView>("lists");
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [listSort, setListSort] = useState<ListSort>("newest");
  const [importOpen, setImportOpen] = useState(false);
  const [importName, setImportName] = useState(defaultListName());
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");
  const [renameListId, setRenameListId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [mergeSourceId, setMergeSourceId] = useState<string | null>(null);
  const [lookupSongId, setLookupSongId] = useState<string | null>(null);
  const [previewSongId, setPreviewSongId] = useState<string | null>(null);
  const [importingSongId, setImportingSongId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingFileSongRef = useRef<MusicAuditionSong | null>(null);

  const refresh = () => setState(listMusicAuditionState());

  useEffect(() => {
    const unsubscribe = subscribeMusicAudition(refresh);
    void hydrateMusicAuditionFromCloud().finally(refresh);
    return () => {
      unsubscribe();
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  const songsById = useMemo(() => new Map(state.songs.map((song) => [song.id, song])), [state.songs]);
  const selectedList = state.lists.find((list) => list.id === selectedListId) || null;
  const selectedSongs = useMemo(
    () => selectedList ? selectedList.songIds.map((id) => songsById.get(id)).filter((song): song is MusicAuditionSong => Boolean(song)) : [],
    [selectedList, songsById],
  );
  const currentSong = selectedSongs[currentIndex] || null;
  const currentStats = selectedList ? listStats(selectedList, songsById) : null;
  const keptSongs = useMemo(
    () => state.songs.filter((song) => song.decision === "keep").sort((a, b) => (b.decidedAt || 0) - (a.decidedAt || 0)),
    [state.songs],
  );
  const sortedLists = useMemo(() => {
    const rows = [...state.lists];
    if (listSort === "name") return rows.sort((a, b) => a.name.localeCompare(b.name));
    if (listSort === "progress") return rows.sort((a, b) => listStats(b, songsById).progress - listStats(a, songsById).progress || b.updatedAt - a.updatedAt);
    if (listSort === "most_kept") return rows.sort((a, b) => listStats(b, songsById).keep - listStats(a, songsById).keep || b.updatedAt - a.updatedAt);
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  }, [state.lists, songsById, listSort]);
  const parsedImportCount = useMemo(() => parseAuditionListText(importText).length, [importText]);

  useEffect(() => {
    if (!currentSong) return;
    if ((currentSong.artworkUrl || currentSong.previewUrl) && currentSong.metadataUpdatedAt) return;
    setLookupSongId(currentSong.id);
    void resolveMusicAuditionMetadata(currentSong.id).finally(() => {
      setLookupSongId((id) => id === currentSong.id ? null : id);
      refresh();
    });
  }, [currentSong?.id]);

  function openList(list: MusicAuditionList) {
    stopPreview();
    setSelectedListId(list.id);
    const songs = list.songIds.map((id) => songsById.get(id)).filter((song): song is MusicAuditionSong => Boolean(song));
    const firstUnreviewed = songs.findIndex((song) => !song.decision);
    setCurrentIndex(firstUnreviewed >= 0 ? firstUnreviewed : 0);
    setView("audition");
    setMessage("");
  }

  function stopPreview() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    setPreviewSongId(null);
  }

  async function togglePreview(song: MusicAuditionSong) {
    if (previewSongId === song.id) {
      stopPreview();
      return;
    }
    stopPreview();
    let resolved = song;
    if (!resolved.previewUrl) {
      setLookupSongId(song.id);
      resolved = await resolveMusicAuditionMetadata(song.id);
      setLookupSongId(null);
      refresh();
    }
    if (!resolved.previewUrl) {
      setMessage("No embedded preview was found for this song. Use YouTube to hear the full track.");
      return;
    }
    onPreviewStart?.();
    const audio = new Audio(resolved.previewUrl);
    audio.preload = "auto";
    audio.volume = 0.95;
    audio.onended = () => setPreviewSongId(null);
    audio.onerror = () => {
      setPreviewSongId(null);
      setMessage("That preview could not be played. Use YouTube for the full song.");
    };
    audioRef.current = audio;
    try {
      await audio.play();
      setPreviewSongId(song.id);
      setMessage("");
    } catch {
      setMessage("Preview playback was blocked by the browser. Tap Preview again or use YouTube.");
    }
  }

  function openYoutube(song: MusicAuditionSong) {
    window.open(auditionYoutubeUrl(song), "_blank", "noopener,noreferrer");
  }

  function decide(song: MusicAuditionSong, decision: AuditionDecision, autoAdvance = true) {
    stopPreview();
    setMusicAuditionDecision(song.id, decision);
    refresh();
    if (autoAdvance && selectedSongs.length) setCurrentIndex((index) => Math.min(selectedSongs.length - 1, index + 1));
  }

  function submitImport() {
    setImportError("");
    try {
      const list = importMusicAuditionList(importName, importText);
      setImportOpen(false);
      setImportName(defaultListName());
      setImportText("");
      refresh();
      openList(list);
    } catch (caught) {
      setImportError(caught instanceof Error ? caught.message : "Could not import this list.");
    }
  }

  function startRename(list: MusicAuditionList) {
    setRenameListId(list.id);
    setRenameValue(list.name);
  }

  function saveRename() {
    if (!renameListId) return;
    try {
      renameMusicAuditionList(renameListId, renameValue);
      setRenameListId(null);
      refresh();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Could not rename this list.");
    }
  }

  async function deleteList(list: MusicAuditionList) {
    if (!window.confirm(`Delete \"${list.name}\"? Your KEEP/PASS/MAYBE history for the songs will remain.`)) return;
    await deleteMusicAuditionList(list.id);
    if (selectedListId === list.id) {
      setSelectedListId(null);
      setView("lists");
    }
    refresh();
  }

  function duplicateList(list: MusicAuditionList) {
    duplicateMusicAuditionList(list.id);
    refresh();
  }

  function mergeInto(targetId: string) {
    if (!mergeSourceId) return;
    mergeMusicAuditionLists(mergeSourceId, targetId);
    setMergeSourceId(null);
    refresh();
  }

  function requestSongImport(song: MusicAuditionSong) {
    if (!onImportFile) return;
    pendingFileSongRef.current = song;
    fileInputRef.current?.click();
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    const song = pendingFileSongRef.current;
    event.target.value = "";
    pendingFileSongRef.current = null;
    if (!file || !song || !onImportFile) return;
    setImportingSongId(song.id);
    setMessage(`Adding ${song.artist} - ${song.title} to your library…`);
    try {
      const track = await onImportFile(file, song);
      if (track) markMusicAuditionSongInLibrary(song.id, track.id);
      setMessage(track ? "Added to your MVP music library." : "Upload finished. Refreshing library status…");
      refresh();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Song import failed.");
    } finally {
      setImportingSongId(null);
    }
  }

  function nextUnreviewed() {
    if (!selectedSongs.length) return;
    const after = selectedSongs.findIndex((song, index) => index > currentIndex && !song.decision);
    if (after >= 0) setCurrentIndex(after);
    else {
      const before = selectedSongs.findIndex((song) => !song.decision);
      if (before >= 0) setCurrentIndex(before);
    }
  }

  const globalCounts = useMemo(() => ({
    keep: state.songs.filter((song) => song.decision === "keep").length,
    pass: state.songs.filter((song) => song.decision === "pass").length,
    maybe: state.songs.filter((song) => song.decision === "maybe").length,
    reviewed: state.songs.filter((song) => Boolean(song.decision)).length,
  }), [state.songs]);

  return <section className="mvp-audition">
    <input ref={fileInputRef} hidden type="file" accept=".mp3,.m4a,.wav,audio/mpeg,audio/mp4,audio/wav" onChange={(event) => void handleFileChange(event)} />

    <header className="mvp-auditionHero">
      <div>
        <span className="mvp-auditionEyebrow">MVP MUSIC DISCOVERY</span>
        <h2>Audition Queue</h2>
        <p>Preview candidates before they ever touch your real music library. Keep the winners. Pass the filler.</p>
      </div>
      <div className="mvp-auditionGlobal">
        <div><b>{globalCounts.keep}</b><span>KEPT</span></div>
        <div><b>{globalCounts.maybe}</b><span>MAYBE</span></div>
        <div><b>{globalCounts.pass}</b><span>PASS</span></div>
        <div><b>{state.lists.length}</b><span>LISTS</span></div>
      </div>
    </header>

    <nav className="mvp-auditionNav">
      <button className={view === "lists" ? "is-active" : ""} onClick={() => { stopPreview(); setView("lists"); }}>AUDITION LISTS</button>
      <button className={view === "audition" ? "is-active" : ""} disabled={!selectedList} onClick={() => selectedList && setView("audition")}>NOW AUDITIONING</button>
      <button className={view === "kept" ? "is-active" : ""} onClick={() => { stopPreview(); setView("kept"); }}>🔥 KEPT SONGS <b>{keptSongs.length}</b></button>
      <button className="is-import" onClick={() => { setImportError(""); setImportOpen(true); }}>+ IMPORT LIST</button>
    </nav>

    {message ? <div className="mvp-auditionMessage">{message}<button type="button" onClick={() => setMessage("")}>×</button></div> : null}

    {view === "lists" ? <>
      <div className="mvp-auditionToolbar">
        <div><strong>{state.lists.length} SAVED LIST{state.lists.length === 1 ? "" : "S"}</strong><span>Import as many hunting lists as you want. Decisions follow the song across every list.</span></div>
        <label><span>SORT</span><select value={listSort} onChange={(event) => setListSort(event.target.value as ListSort)}><option value="newest">Newest</option><option value="name">Name A-Z</option><option value="progress">Most reviewed</option><option value="most_kept">Most kept</option></select></label>
      </div>
      {!sortedLists.length ? <div className="mvp-auditionEmpty"><b>NO AUDITION LISTS YET</b><span>Import an Octane list, Spotify finds, covers list, or any Artist - Song list to begin.</span><button onClick={() => setImportOpen(true)}>IMPORT YOUR FIRST LIST</button></div> : <div className="mvp-auditionLists">
        {sortedLists.map((list) => {
          const stats = listStats(list, songsById);
          const percent = Math.round(stats.progress * 100);
          return <article key={list.id} className="mvp-auditionListCard">
            <header>
              <div className="mvp-auditionListIcon">♫</div>
              <div className="mvp-auditionListTitle">
                {renameListId === list.id ? <div className="mvp-auditionRename"><input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") saveRename(); if (event.key === "Escape") setRenameListId(null); }} /><button onClick={saveRename}>SAVE</button><button onClick={() => setRenameListId(null)}>CANCEL</button></div> : <><h3>{list.name}</h3><small>CREATED {dateLabel(list.createdAt).toUpperCase()}</small></>}
              </div>
              <b className="mvp-auditionPercent">{percent}%</b>
            </header>
            <div className="mvp-auditionProgress"><i style={{ width: `${percent}%` }} /></div>
            <div className="mvp-auditionListStats"><span><b>{stats.reviewed}</b> / {stats.total}<small>REVIEWED</small></span><span className="is-keep"><b>{stats.keep}</b><small>KEEP</small></span><span className="is-maybe"><b>{stats.maybe}</b><small>MAYBE</small></span><span className="is-pass"><b>{stats.pass}</b><small>PASS</small></span></div>
            <footer><button className="is-open" onClick={() => openList(list)}>▶ {stats.reviewed ? "CONTINUE" : "START"}</button><button onClick={() => startRename(list)}>RENAME</button><button onClick={() => duplicateList(list)}>DUPLICATE</button><button onClick={() => setMergeSourceId(list.id)} disabled={state.lists.length < 2}>MERGE</button><button className="is-danger" onClick={() => void deleteList(list)}>DELETE</button></footer>
          </article>;
        })}
      </div>}
    </> : null}

    {view === "audition" && selectedList && currentStats ? <div className="mvp-auditionStage">
      <header className="mvp-auditionStageHead">
        <button onClick={() => { stopPreview(); setView("lists"); }}>‹ LISTS</button>
        <div><span>NOW AUDITIONING</span><h3>{selectedList.name}</h3></div>
        <div className="mvp-auditionStageProgress"><b>{currentStats.reviewed} / {currentStats.total}</b><span>REVIEWED</span></div>
      </header>
      <div className="mvp-auditionStageBar"><i style={{ width: `${Math.round(currentStats.progress * 100)}%` }} /></div>
      {currentSong ? <article className="mvp-auditionSongCard">
        <div className="mvp-auditionArtwork">
          {currentSong.artworkUrl ? <img src={currentSong.artworkUrl} alt="" /> : <div>♫</div>}
          <span>{currentIndex + 1}<small>/ {selectedSongs.length}</small></span>
        </div>
        <div className="mvp-auditionSongInfo">
          <div className="mvp-auditionStatusRow"><span className={`is-${currentSong.decision || "new"}`}>{decisionLabel(currentSong.decision)}</span>{musicAuditionSongInLibrary(currentSong, tracks) ? <b>✓ IN LIBRARY</b> : null}</div>
          <h2>{currentSong.title}</h2>
          <h3>{currentSong.artist}</h3>
          <p>{[currentSong.album, currentSong.releaseYear, currentSong.genre].filter(Boolean).join(" • ") || (lookupSongId === currentSong.id ? "Finding artwork and preview…" : "Ready to audition")}</p>
          <div className="mvp-auditionListen">
            <button className={previewSongId === currentSong.id ? "is-playing" : ""} disabled={lookupSongId === currentSong.id} onClick={() => void togglePreview(currentSong)}>{lookupSongId === currentSong.id ? "⌁ FINDING PREVIEW" : previewSongId === currentSong.id ? "■ STOP PREVIEW" : "▶ PREVIEW"}</button>
            <button className="is-youtube" onClick={() => openYoutube(currentSong)}>▶ YOUTUBE ↗</button>
          </div>
          <div className="mvp-auditionDecision">
            <button className={`is-keep ${currentSong.decision === "keep" ? "is-active" : ""}`} onClick={() => decide(currentSong, "keep")}>🔥<span>KEEP</span></button>
            <button className={`is-maybe ${currentSong.decision === "maybe" ? "is-active" : ""}`} onClick={() => decide(currentSong, "maybe")}>?<span>MAYBE</span></button>
            <button className={`is-pass ${currentSong.decision === "pass" ? "is-active" : ""}`} onClick={() => decide(currentSong, "pass")}>×<span>PASS</span></button>
          </div>
          <div className="mvp-auditionPager"><button disabled={currentIndex <= 0} onClick={() => { stopPreview(); setCurrentIndex((index) => Math.max(0, index - 1)); }}>‹ PREVIOUS</button><button onClick={nextUnreviewed}>NEXT UNREVIEWED</button><button disabled={currentIndex >= selectedSongs.length - 1} onClick={() => { stopPreview(); setCurrentIndex((index) => Math.min(selectedSongs.length - 1, index + 1)); }}>NEXT ›</button></div>
        </div>
      </article> : <div className="mvp-auditionEmpty"><b>THIS LIST IS EMPTY</b></div>}
      <footer className="mvp-auditionCounts"><span className="is-keep"><b>{currentStats.keep}</b> KEEP</span><span className="is-pass"><b>{currentStats.pass}</b> PASS</span><span className="is-maybe"><b>{currentStats.maybe}</b> MAYBE</span><span><b>{currentStats.total - currentStats.reviewed}</b> LEFT</span></footer>
    </div> : null}

    {view === "kept" ? <div className="mvp-auditionKept">
      <header><div><span>APPROVED MUSIC</span><h3>Kept Songs</h3><p>These songs survived Audition. They stay here until you add the actual audio file to MVP.</p></div><b>{keptSongs.length}</b></header>
      {!keptSongs.length ? <div className="mvp-auditionEmpty"><b>NO KEEPERS YET</b><span>Hit KEEP while auditioning and your winners will collect here.</span></div> : <div className="mvp-auditionKeptGrid">
        {keptSongs.map((song) => {
          const sources = musicAuditionSongSources(song.id, state.lists);
          const inLibrary = musicAuditionSongInLibrary(song, tracks);
          return <article key={song.id}>
            <div className="mvp-auditionKeptArt">{song.artworkUrl ? <img src={song.artworkUrl} alt="" /> : <span>♫</span>}</div>
            <div className="mvp-auditionKeptInfo"><small>{inLibrary ? "✓ IN LIBRARY" : "🔥 KEPT"}</small><strong>{song.title}</strong><b>{song.artist}</b><p>{sources.length ? `FROM ${sources.map((list) => list.name).join(" • ")}` : "KEPT FROM AUDITION"}</p></div>
            <div className="mvp-auditionKeptActions"><button onClick={() => void togglePreview(song)}>{previewSongId === song.id ? "STOP" : "PREVIEW"}</button><button className="is-youtube" onClick={() => openYoutube(song)}>YOUTUBE ↗</button>{!inLibrary && onImportFile ? <button className="is-add" disabled={importingSongId === song.id} onClick={() => requestSongImport(song)}>{importingSongId === song.id ? "ADDING…" : "+ ADD FILE"}</button> : null}<button className="is-remove" onClick={() => { setMusicAuditionDecision(song.id, null); refresh(); }}>REMOVE</button></div>
          </article>;
        })}
      </div>}
    </div> : null}

    {importOpen ? <div className="mvp-auditionModalBackdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setImportOpen(false); }}>
      <section className="mvp-auditionModal">
        <header><div><span>NEW AUDITION LIST</span><h3>Import songs to audition</h3></div><button onClick={() => setImportOpen(false)}>×</button></header>
        <label><span>LIST NAME</span><input value={importName} onChange={(event) => setImportName(event.target.value)} placeholder="Octane Top 100 - August 2026" /></label>
        <label><span>SONGS</span><textarea value={importText} onChange={(event) => setImportText(event.target.value)} placeholder={'Three Days Grace - Mayday\nBreaking Benjamin - Awaken\nArtist - Song'} /></label>
        <div className="mvp-auditionImportHint"><b>{parsedImportCount}</b><span>songs recognized</span><small>One per line: ARTIST - SONG. Numbered and bulleted lists are okay.</small></div>
        {importError ? <p className="mvp-auditionError">{importError}</p> : null}
        <footer><button onClick={() => setImportOpen(false)}>CANCEL</button><button className="is-import" disabled={!parsedImportCount} onClick={submitImport}>IMPORT {parsedImportCount || ""} SONG{parsedImportCount === 1 ? "" : "S"}</button></footer>
      </section>
    </div> : null}

    {mergeSourceId ? <div className="mvp-auditionModalBackdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setMergeSourceId(null); }}>
      <section className="mvp-auditionModal is-small"><header><div><span>MERGE LIST</span><h3>Choose destination</h3></div><button onClick={() => setMergeSourceId(null)}>×</button></header><p className="mvp-auditionMergeCopy">Songs are added to the destination without duplicates. The original list stays intact.</p><div className="mvp-auditionMergeTargets">{state.lists.filter((list) => list.id !== mergeSourceId).map((list) => <button key={list.id} onClick={() => mergeInto(list.id)}><strong>{list.name}</strong><span>{list.songIds.length} songs</span></button>)}</div></section>
    </div> : null}

    <style>{`
      .mvp-audition{display:grid;gap:12px;color:#eef7fa}.mvp-audition button,.mvp-audition input,.mvp-audition textarea,.mvp-audition select{font:inherit}.mvp-auditionHero{display:flex;justify-content:space-between;gap:20px;align-items:center;padding:18px 20px;border:1px solid rgba(80,186,223,.18);border-radius:15px;background:radial-gradient(circle at 85% 10%,rgba(20,128,192,.18),transparent 32%),linear-gradient(135deg,#081820,#050a0e 66%);box-shadow:0 18px 50px rgba(0,0,0,.22)}.mvp-auditionEyebrow,.mvp-auditionHero span{font-size:8px;font-weight:1000;letter-spacing:.18em;color:#64d2f4}.mvp-auditionHero h2{margin:4px 0 5px;font-size:28px;letter-spacing:-.04em;color:#fff}.mvp-auditionHero p{max-width:650px;margin:0;color:#8fa8b2;font-size:10px;line-height:1.5}.mvp-auditionGlobal{display:grid;grid-template-columns:repeat(4,70px);gap:6px}.mvp-auditionGlobal>div{min-height:57px;display:grid;place-content:center;text-align:center;border:1px solid rgba(116,180,202,.13);border-radius:10px;background:rgba(5,17,23,.78)}.mvp-auditionGlobal b{font-size:20px;line-height:1;color:#fff}.mvp-auditionGlobal span{margin-top:5px;font-size:6.5px;color:#7f9aa5}.mvp-auditionNav{display:flex;gap:6px;padding:5px;border:1px solid rgba(108,169,193,.12);border-radius:11px;background:#050c10}.mvp-auditionNav button{min-height:39px;padding:0 13px;border:1px solid transparent;border-radius:8px;background:transparent;color:#77939e;font-size:7.5px;font-weight:1000;letter-spacing:.08em;cursor:pointer}.mvp-auditionNav button:hover{color:#d9eef5;background:#0a171d}.mvp-auditionNav button.is-active{color:#fff;border-color:rgba(75,191,232,.3);background:linear-gradient(180deg,#0e2732,#09151b);box-shadow:inset 0 1px rgba(255,255,255,.04)}.mvp-auditionNav button.is-import{margin-left:auto;color:#081116;background:linear-gradient(135deg,#72ddfb,#43b7e5);box-shadow:0 0 18px rgba(74,193,232,.2)}.mvp-auditionNav button:disabled{opacity:.35;cursor:not-allowed}.mvp-auditionMessage{display:flex;justify-content:space-between;align-items:center;padding:9px 12px;border:1px solid rgba(88,183,215,.18);border-radius:9px;background:#07141a;color:#b7d3dc;font-size:9px}.mvp-auditionMessage button{border:0;background:transparent;color:#9eb7c0;font-size:18px;cursor:pointer}.mvp-auditionToolbar{display:flex;justify-content:space-between;gap:14px;align-items:end;padding:4px 2px}.mvp-auditionToolbar>div{display:grid;gap:3px}.mvp-auditionToolbar strong{font-size:10px;color:#dcecf1}.mvp-auditionToolbar>div span{font-size:8px;color:#748e98}.mvp-auditionToolbar label{display:grid;gap:4px}.mvp-auditionToolbar label span{font-size:6.5px;font-weight:1000;color:#6f8994;letter-spacing:.12em}.mvp-auditionToolbar select{min-width:150px;height:35px;padding:0 9px;border:1px solid rgba(115,170,191,.15);border-radius:8px;background:#071219;color:#dbe9ed;font-size:8px}.mvp-auditionLists{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.mvp-auditionListCard{padding:13px;border:1px solid rgba(108,175,199,.14);border-radius:13px;background:linear-gradient(160deg,#08141a,#050b0f);box-shadow:0 14px 35px rgba(0,0,0,.16)}.mvp-auditionListCard>header{display:grid;grid-template-columns:42px minmax(0,1fr) auto;gap:10px;align-items:center}.mvp-auditionListIcon{width:42px;height:42px;display:grid;place-items:center;border-radius:10px;border:1px solid rgba(74,190,231,.2);background:linear-gradient(145deg,#102630,#07141a);color:#65d3f5;font-size:18px}.mvp-auditionListTitle{min-width:0}.mvp-auditionListTitle h3{margin:0 0 3px;color:#fff;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mvp-auditionListTitle small{font-size:6.5px;color:#708994;letter-spacing:.08em}.mvp-auditionPercent{font-size:19px;color:#73dcfa}.mvp-auditionProgress,.mvp-auditionStageBar{height:4px;margin:11px 0 10px;overflow:hidden;border-radius:99px;background:#0d2028}.mvp-auditionProgress i,.mvp-auditionStageBar i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#41b7e4,#74e4fb);box-shadow:0 0 12px rgba(72,201,238,.35)}.mvp-auditionListStats{display:grid;grid-template-columns:1.6fr repeat(3,1fr);gap:5px}.mvp-auditionListStats span{min-height:47px;display:grid;place-content:center;border:1px solid rgba(106,161,180,.1);border-radius:8px;background:#061015;text-align:center;color:#bdcdd3;font-size:9px}.mvp-auditionListStats b{font-size:14px;color:#fff}.mvp-auditionListStats small{margin-top:2px;font-size:6px;font-weight:1000;letter-spacing:.08em;color:#708891}.mvp-auditionListStats .is-keep b{color:#72e9a6}.mvp-auditionListStats .is-maybe b{color:#ffd271}.mvp-auditionListStats .is-pass b{color:#ff8189}.mvp-auditionListCard footer{display:flex;gap:5px;margin-top:10px;flex-wrap:wrap}.mvp-auditionListCard footer button{min-height:31px;padding:0 9px;border:1px solid rgba(108,170,192,.13);border-radius:7px;background:#07141a;color:#a9c0c9;font-size:6.5px;font-weight:1000;cursor:pointer}.mvp-auditionListCard footer .is-open{color:#dff8ff;border-color:rgba(72,194,234,.3);background:#0b2530}.mvp-auditionListCard footer .is-danger{margin-left:auto;color:#ff8990;border-color:rgba(255,93,106,.16);background:#17090b}.mvp-auditionRename{display:flex;gap:4px}.mvp-auditionRename input{min-width:0;height:32px;padding:0 8px;border:1px solid #3db7df;border-radius:7px;background:#061118;color:#fff;font-size:10px}.mvp-auditionRename button{height:32px;padding:0 7px;border:1px solid rgba(89,184,215,.2);border-radius:7px;background:#0a1b22;color:#bfe8f5;font-size:6px;font-weight:1000}.mvp-auditionEmpty{min-height:220px;display:grid;place-content:center;justify-items:center;gap:8px;border:1px dashed rgba(111,177,199,.17);border-radius:13px;background:#050d11;color:#8299a2;text-align:center}.mvp-auditionEmpty b{color:#dcebf0;font-size:11px}.mvp-auditionEmpty span{max-width:440px;font-size:8px}.mvp-auditionEmpty button{min-height:36px;padding:0 14px;border:1px solid rgba(68,190,230,.25);border-radius:8px;background:#0b2631;color:#dff8ff;font-size:7px;font-weight:1000}.mvp-auditionStage{display:grid;gap:0;border:1px solid rgba(89,179,211,.16);border-radius:15px;background:radial-gradient(circle at 20% 0,rgba(32,130,174,.11),transparent 35%),#050c10;overflow:hidden}.mvp-auditionStageHead{display:grid;grid-template-columns:auto 1fr auto;gap:14px;align-items:center;padding:14px 16px 8px}.mvp-auditionStageHead>button{height:32px;padding:0 9px;border:1px solid rgba(104,170,193,.15);border-radius:8px;background:#07141a;color:#9ab2bc;font-size:7px;font-weight:1000}.mvp-auditionStageHead>div:nth-child(2){display:grid;gap:2px}.mvp-auditionStageHead span{font-size:6.5px;font-weight:1000;letter-spacing:.14em;color:#56c9ed}.mvp-auditionStageHead h3{margin:0;font-size:14px;color:#fff}.mvp-auditionStageProgress{display:grid;text-align:right}.mvp-auditionStageProgress b{font-size:15px}.mvp-auditionStageProgress span{font-size:6px;color:#718d97}.mvp-auditionStageBar{margin:0 16px;height:3px}.mvp-auditionSongCard{display:grid;grid-template-columns:minmax(260px,.82fr) minmax(0,1.18fr);gap:24px;padding:20px}.mvp-auditionArtwork{position:relative;aspect-ratio:1/1;max-height:410px;border-radius:18px;overflow:hidden;border:1px solid rgba(106,185,214,.18);background:radial-gradient(circle at 50% 30%,#18313a,#071015 65%);box-shadow:0 24px 60px rgba(0,0,0,.32)}.mvp-auditionArtwork img{width:100%;height:100%;object-fit:cover}.mvp-auditionArtwork>div{width:100%;height:100%;display:grid;place-items:center;color:#66d4f3;font-size:80px;opacity:.5}.mvp-auditionArtwork>span{position:absolute;right:12px;bottom:12px;min-width:64px;height:35px;display:flex;align-items:baseline;justify-content:center;gap:3px;border:1px solid rgba(255,255,255,.13);border-radius:10px;background:rgba(3,9,12,.82);backdrop-filter:blur(10px);font-size:15px;font-weight:1000;color:#fff}.mvp-auditionArtwork>span small{font-size:8px;color:#90a7af}.mvp-auditionSongInfo{align-self:center;min-width:0}.mvp-auditionStatusRow{display:flex;gap:7px;align-items:center;margin-bottom:8px}.mvp-auditionStatusRow span,.mvp-auditionStatusRow b{min-height:24px;display:inline-flex;align-items:center;padding:0 8px;border-radius:999px;font-size:6.5px;font-weight:1000;letter-spacing:.08em}.mvp-auditionStatusRow span{border:1px solid rgba(97,164,188,.15);background:#07151b;color:#91aab4}.mvp-auditionStatusRow span.is-keep{color:#82efb0;border-color:rgba(74,220,142,.25);background:#071d13}.mvp-auditionStatusRow span.is-pass{color:#ff8a92;border-color:rgba(255,93,105,.2);background:#1a090c}.mvp-auditionStatusRow span.is-maybe{color:#ffd173;border-color:rgba(241,178,71,.22);background:#1b1406}.mvp-auditionStatusRow b{color:#8ceab7;background:#082117;border:1px solid rgba(83,214,148,.22)}.mvp-auditionSongInfo h2{margin:0;color:#fff;font-size:34px;line-height:1.05;letter-spacing:-.045em}.mvp-auditionSongInfo h3{margin:6px 0 0;color:#9ac7d6;font-size:17px}.mvp-auditionSongInfo>p{margin:7px 0 16px;color:#718c97;font-size:9px}.mvp-auditionListen{display:grid;grid-template-columns:1fr 1fr;gap:8px}.mvp-auditionListen button{min-height:48px;border-radius:11px;border:1px solid rgba(82,190,228,.24);background:linear-gradient(180deg,#0d2731,#08171d);color:#e7f8fd;font-size:8px;font-weight:1000;letter-spacing:.05em;cursor:pointer}.mvp-auditionListen button.is-playing{color:#071116;background:#72ddfa}.mvp-auditionListen button.is-youtube{border-color:rgba(255,79,87,.3);background:linear-gradient(180deg,#2a0d10,#150708);color:#ffb0b4}.mvp-auditionDecision{display:grid;grid-template-columns:1.2fr .8fr 1fr;gap:8px;margin-top:9px}.mvp-auditionDecision button{min-height:76px;display:grid;place-content:center;gap:3px;border-radius:13px;border:1px solid rgba(104,163,183,.14);background:#081319;color:#829ca6;font-size:19px;font-weight:1000;cursor:pointer}.mvp-auditionDecision button span{font-size:7px;letter-spacing:.1em}.mvp-auditionDecision .is-keep{color:#75e9a9}.mvp-auditionDecision .is-keep:hover,.mvp-auditionDecision .is-keep.is-active{border-color:rgba(68,221,141,.45);background:radial-gradient(circle at 50% 10%,rgba(65,219,137,.2),transparent 70%),#071a11;box-shadow:0 0 24px rgba(57,207,128,.1)}.mvp-auditionDecision .is-maybe{color:#ffd16f}.mvp-auditionDecision .is-maybe:hover,.mvp-auditionDecision .is-maybe.is-active{border-color:rgba(242,184,77,.42);background:#1a1306}.mvp-auditionDecision .is-pass{color:#ff818b}.mvp-auditionDecision .is-pass:hover,.mvp-auditionDecision .is-pass.is-active{border-color:rgba(255,84,99,.4);background:#19090c}.mvp-auditionPager{display:grid;grid-template-columns:1fr 1.15fr 1fr;gap:6px;margin-top:9px}.mvp-auditionPager button{min-height:34px;border:1px solid rgba(101,162,184,.12);border-radius:8px;background:#061015;color:#839ba4;font-size:6.5px;font-weight:1000}.mvp-auditionPager button:disabled{opacity:.3}.mvp-auditionCounts{display:flex;gap:14px;justify-content:center;padding:11px;border-top:1px solid rgba(99,164,188,.1);background:#040a0d;color:#8199a2;font-size:7px;font-weight:1000}.mvp-auditionCounts b{color:#fff}.mvp-auditionCounts .is-keep b{color:#75e9a9}.mvp-auditionCounts .is-pass b{color:#ff818b}.mvp-auditionCounts .is-maybe b{color:#ffd16f}.mvp-auditionKept{display:grid;gap:10px}.mvp-auditionKept>header{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border:1px solid rgba(83,181,214,.14);border-radius:12px;background:#061117}.mvp-auditionKept>header span{font-size:6.5px;font-weight:1000;letter-spacing:.14em;color:#70dfa6}.mvp-auditionKept>header h3{margin:2px 0;font-size:20px}.mvp-auditionKept>header p{margin:0;color:#7d98a2;font-size:8px}.mvp-auditionKept>header>b{font-size:31px;color:#71e5a5}.mvp-auditionKeptGrid{display:grid;gap:6px}.mvp-auditionKeptGrid>article{display:grid;grid-template-columns:58px minmax(0,1fr) auto;gap:10px;align-items:center;padding:8px 10px;border:1px solid rgba(100,164,186,.11);border-radius:10px;background:#061015}.mvp-auditionKeptArt{width:58px;height:58px;border-radius:8px;overflow:hidden;background:#0d1d23;display:grid;place-items:center;color:#65d2f3}.mvp-auditionKeptArt img{width:100%;height:100%;object-fit:cover}.mvp-auditionKeptInfo{min-width:0;display:grid;gap:1px}.mvp-auditionKeptInfo small{color:#73e3a6;font-size:6px;font-weight:1000;letter-spacing:.08em}.mvp-auditionKeptInfo strong{color:#fff;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mvp-auditionKeptInfo b{color:#a8c3cd;font-size:8px}.mvp-auditionKeptInfo p{margin:3px 0 0;color:#657f89;font-size:6.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mvp-auditionKeptActions{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end}.mvp-auditionKeptActions button{min-height:31px;padding:0 8px;border:1px solid rgba(100,168,192,.13);border-radius:7px;background:#08161c;color:#a9c2cc;font-size:6px;font-weight:1000}.mvp-auditionKeptActions .is-youtube{color:#ff9ba1;border-color:rgba(255,83,95,.2);background:#16080a}.mvp-auditionKeptActions .is-add{color:#7de8ad;border-color:rgba(70,214,139,.24);background:#071a11}.mvp-auditionKeptActions .is-remove{color:#ff858e}.mvp-auditionModalBackdrop{position:fixed;inset:0;z-index:10040;display:grid;place-items:center;padding:14px;background:rgba(0,0,0,.76);backdrop-filter:blur(12px)}.mvp-auditionModal{width:min(680px,96vw);max-height:92dvh;overflow:auto;padding:16px;border:1px solid rgba(91,190,225,.22);border-radius:16px;background:linear-gradient(155deg,#0a171d,#050a0d);box-shadow:0 30px 90px rgba(0,0,0,.55)}.mvp-auditionModal.is-small{width:min(480px,96vw)}.mvp-auditionModal>header{display:flex;justify-content:space-between;align-items:start;margin-bottom:12px}.mvp-auditionModal>header span{font-size:6.5px;font-weight:1000;letter-spacing:.14em;color:#62d1f3}.mvp-auditionModal>header h3{margin:3px 0;font-size:20px;color:#fff}.mvp-auditionModal>header>button{width:32px;height:32px;border:1px solid rgba(109,169,190,.14);border-radius:8px;background:#071218;color:#9ab1ba;font-size:18px}.mvp-auditionModal>label{display:grid;gap:5px;margin-top:10px}.mvp-auditionModal>label>span{font-size:6.5px;font-weight:1000;letter-spacing:.12em;color:#7b949d}.mvp-auditionModal input,.mvp-auditionModal textarea{width:100%;box-sizing:border-box;border:1px solid rgba(93,174,203,.18);border-radius:9px;background:#040c10;color:#f0f8fa;outline:none}.mvp-auditionModal input{height:41px;padding:0 11px;font-size:10px}.mvp-auditionModal textarea{height:270px;padding:11px;resize:vertical;font:500 10px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace}.mvp-auditionModal input:focus,.mvp-auditionModal textarea:focus{border-color:#43bee8;box-shadow:0 0 0 2px rgba(67,190,232,.08)}.mvp-auditionImportHint{display:grid;grid-template-columns:auto auto 1fr;gap:6px;align-items:center;margin-top:9px;padding:8px 10px;border-radius:8px;background:#07151b}.mvp-auditionImportHint b{font-size:17px;color:#69d9f7}.mvp-auditionImportHint span{font-size:7px;font-weight:1000;color:#bdd2da}.mvp-auditionImportHint small{justify-self:end;color:#708a94;font-size:7px}.mvp-auditionError{padding:8px;border-radius:7px;background:#1a090b;color:#ff8e96;font-size:8px}.mvp-auditionModal>footer{display:flex;justify-content:flex-end;gap:7px;margin-top:12px}.mvp-auditionModal>footer button{min-height:38px;padding:0 13px;border:1px solid rgba(105,165,187,.14);border-radius:8px;background:#08151b;color:#9fb7c0;font-size:7px;font-weight:1000}.mvp-auditionModal>footer .is-import{color:#071116;background:#65d8f6;border-color:#65d8f6}.mvp-auditionModal>footer button:disabled{opacity:.35}.mvp-auditionMergeCopy{color:#829aa4;font-size:8px}.mvp-auditionMergeTargets{display:grid;gap:6px;margin-top:10px}.mvp-auditionMergeTargets button{display:flex;justify-content:space-between;align-items:center;min-height:46px;padding:0 11px;border:1px solid rgba(93,173,201,.14);border-radius:8px;background:#07141a;color:#d7e9ee}.mvp-auditionMergeTargets button strong{font-size:9px}.mvp-auditionMergeTargets button span{font-size:7px;color:#78929c}
      @media(max-width:760px){.mvp-auditionHero{align-items:stretch;flex-direction:column;padding:14px}.mvp-auditionHero h2{font-size:24px}.mvp-auditionGlobal{grid-template-columns:repeat(4,minmax(0,1fr))}.mvp-auditionGlobal>div{min-height:50px}.mvp-auditionNav{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.mvp-auditionNav button.is-import{margin-left:0}.mvp-auditionToolbar{align-items:stretch;flex-direction:column}.mvp-auditionToolbar select{width:100%}.mvp-auditionLists{grid-template-columns:1fr}.mvp-auditionListStats{grid-template-columns:repeat(4,1fr)}.mvp-auditionListCard footer .is-danger{margin-left:0}.mvp-auditionSongCard{grid-template-columns:1fr;gap:15px;padding:13px}.mvp-auditionArtwork{width:min(100%,330px);justify-self:center}.mvp-auditionSongInfo h2{font-size:27px}.mvp-auditionListen{grid-template-columns:1fr 1fr}.mvp-auditionDecision button{min-height:67px}.mvp-auditionStageHead{grid-template-columns:auto 1fr}.mvp-auditionStageProgress{grid-column:1/-1;text-align:left;grid-template-columns:auto 1fr;gap:6px;align-items:center}.mvp-auditionKeptGrid>article{grid-template-columns:52px minmax(0,1fr)}.mvp-auditionKeptArt{width:52px;height:52px}.mvp-auditionKeptActions{grid-column:1/-1;justify-content:flex-start}.mvp-auditionModal textarea{height:230px}.mvp-auditionImportHint{grid-template-columns:auto 1fr}.mvp-auditionImportHint small{grid-column:1/-1;justify-self:start}.mvp-auditionCounts{flex-wrap:wrap}}
    `}</style>
  </section>;
}
