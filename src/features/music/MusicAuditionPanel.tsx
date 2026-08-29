import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { MusicTrack } from "../../lib/musicStorage";
import { supabase } from "../../lib/supabase";
import { AnimatePresence, motion } from "motion/react";
import {
  ChevronPremiumIcon,
  KeepPremiumIcon,
  MaybePremiumIcon,
  PassPremiumIcon,
  PlayPremiumIcon,
  QueuePremiumIcon,
  SparkPremiumIcon,
  PreviewRenderIcon,
  UploadPremiumIcon,
  YouTubePremiumIcon,
} from "./premium/MusicLibraryPremiumIcons";
import { MusicPremiumSelect } from "./premium/MusicPremiumSelect";

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
const metadataRequests = new Map<string, Promise<MusicAuditionSong>>();
const previewFailures = new Map<string, number>();
// Provider audio URLs are temporary signed/CDN samples. Never trust them for days.
const PREVIEW_URL_CACHE_MS = 10 * 60 * 1000;
const PREVIEW_FAILURE_RETRY_MS = 5 * 60 * 1000;
const APPLE_STOREFRONTS = ["US", "GB", "CA", "AU", "NZ", "IE", "DE", "FR", "NL", "SE", "NO", "DK", "ES", "IT", "BR", "MX"] as const;
const MAX_PREVIEW_PROBES = 14;
const PREVIEW_UNLOCK_AUDIO = "data:audio/wav;base64,UklGRvQHAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YdAHAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==";
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

export async function deleteMusicAuditionSong(songId: string) {
  mutateLocal((state) => ({
    ...state,
    songs: state.songs.filter((song) => song.id !== songId),
    lists: state.lists.map((list) => ({ ...list, songIds: list.songIds.filter((id) => id !== songId), updatedAt: now() })),
  }));
  try {
    const userId = await currentUserId();
    if (!userId) return;
    await supabase.from(LINK_TABLE).delete().eq("user_id", userId).eq("song_id", songId);
    await supabase.from(SONG_TABLE).delete().eq("user_id", userId).eq("song_id", songId);
  } catch {
    // Local removal remains authoritative until a later cloud refresh.
  }
}


function tokenSimilarity(a: string, b: string) {
  const left = new Set(normalize(a).split(" ").filter(Boolean));
  const right = new Set(normalize(b).split(" ").filter(Boolean));
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap += 1;
  return (2 * overlap) / (left.size + right.size);
}

function compactKey(value: unknown) {
  return normalize(value).replace(/\s+/g, "");
}

function leadArtist(value: unknown) {
  const raw = clean(value)
    .replace(/\s+(?:feat(?:uring)?|ft)\.?\s+.*$/i, "")
    .split(/\s+(?:&|x|with)\s+/i)[0]
    .split(/\s*,\s*/)[0];
  return normalize(raw);
}

function artistIdentityKey(value: unknown) {
  return leadArtist(value).replace(/^the\s+/, "").trim();
}

function fullArtistKey(value: unknown) {
  return normalize(clean(value)
    .replace(/\s+(?:feat(?:uring)?|ft)\.?\s+/gi, " & ")
    .replace(/\s+with\s+/gi, " & ")
    .replace(/\s+x\s+/gi, " & "));
}

function strictTitleKey(value: unknown) {
  // Keep meaningful version words such as LIVE / ACOUSTIC / REMIX / INSTRUMENTAL.
  // Those are different recordings and must not be silently matched to the studio song.
  return normalize(clean(value)
    .replace(/\b(?:feat(?:uring)?|ft)\.?\b.*$/i, "")
    .replace(/\((?:feat(?:uring)?|ft|remaster(?:ed)?|radio edit|single version|album version|deluxe|bonus track|reissue)[^)]*\)/gi, " ")
    .replace(/\[(?:feat(?:uring)?|ft|remaster(?:ed)?|radio edit|single version|album version|deluxe|bonus track|reissue)[^\]]*\]/gi, " ")
    .replace(/\b(?:official audio|official video|lyric video|visualizer)\b/gi, " ")
    .replace(/\b(?:remaster(?:ed)?|radio edit|single version|album version)\b/gi, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function versionMarkers(value: unknown) {
  const normalized = normalize(value);
  const markers = new Set<string>();
  const tests: Array<[string, RegExp]> = [
    ["live", /\blive\b/],
    ["acoustic", /\bacoustic\b/],
    ["remix", /\bremix(?:ed)?\b/],
    ["instrumental", /\binstrumental\b/],
    ["karaoke", /\bkaraoke\b/],
    ["tribute", /\btribute\b/],
    ["cover", /\bcover\b/],
    ["sped", /\bsped\s*up\b/],
    ["slowed", /\bslowed\b/],
    ["demo", /\bdemo\b/],
  ];
  for (const [name, pattern] of tests) if (pattern.test(normalized)) markers.add(name);
  return markers;
}

function hasUnrequestedVersion(imported: unknown, candidate: unknown) {
  const wanted = versionMarkers(imported);
  const offered = versionMarkers(candidate);
  for (const marker of offered) {
    if (!wanted.has(marker)) return true;
  }
  return false;
}

function isContainedMatch(left: string, right: string) {
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  return shorter.length >= 7 && longer.includes(shorter);
}

function titleMatchScore(imported: string, candidate: string) {
  if (!imported || !candidate) return 0;
  if (imported === candidate || compactKey(imported) === compactKey(candidate)) return 1;
  const token = tokenSimilarity(imported, candidate);
  const contained = isContainedMatch(imported, candidate) ? 0.94 : 0;
  return Math.max(token, contained);
}

function artistMatchScore(importedValue: unknown, candidateValue: unknown) {
  const importedLead = artistIdentityKey(importedValue);
  const candidateLead = artistIdentityKey(candidateValue);
  const importedFull = fullArtistKey(importedValue);
  const candidateFull = fullArtistKey(candidateValue);
  if (!importedLead || !candidateLead) return 0;
  if (importedLead === candidateLead || compactKey(importedLead) === compactKey(candidateLead)) return 1;
  const leadToken = tokenSimilarity(importedLead, candidateLead);
  const fullToken = tokenSimilarity(importedFull, candidateFull);
  const contained = isContainedMatch(importedLead, candidateLead) ? 0.95 : 0;
  return Math.max(leadToken, fullToken, contained);
}

type PreviewProvider = "apple" | "deezer";

type PreviewCandidate = {
  provider: PreviewProvider;
  id: string;
  trackName: string;
  artistName: string;
  albumName: string;
  artworkUrl: string | null;
  releaseYear: number | null;
  genre: string | null;
  previewUrl: string | null;
  storeUrl: string | null;
};

type DeezerSong = {
  id?: number;
  title?: string;
  title_short?: string;
  preview?: string;
  link?: string;
  artist?: { name?: string };
  album?: { title?: string; cover_big?: string; cover_xl?: string };
};

type DeezerResponse = {
  data?: DeezerSong[];
};

function candidateScore(song: MusicAuditionSong, item: PreviewCandidate) {
  const importedTitle = strictTitleKey(song.title);
  const candidateTitle = strictTitleKey(item.trackName);
  const importedArtist = artistIdentityKey(song.artist);
  const candidateArtist = artistIdentityKey(item.artistName);
  const titleScore = titleMatchScore(importedTitle, candidateTitle);
  const artistScore = artistMatchScore(song.artist, item.artistName);
  const exactTitle = Boolean(importedTitle && candidateTitle && (
    importedTitle === candidateTitle || compactKey(importedTitle) === compactKey(candidateTitle)
  ));
  const exactArtist = Boolean(importedArtist && candidateArtist && (
    importedArtist === candidateArtist || compactKey(importedArtist) === compactKey(candidateArtist)
  ));

  // Never attach live/acoustic/remix/tribute/etc. when that version was not imported.
  if (hasUnrequestedVersion(song.title, item.trackName)) return null;

  // Wrong artists still get rejected, but allow punctuation / featured-artist / alias
  // normalization to score through instead of falsely declaring "no sample".
  if (!exactArtist && artistScore < 0.88) return null;

  // Exact titles remain preferred. A very-close normalized title is allowed so
  // provider punctuation, "&", apostrophes and harmless suffix formatting do not
  // create a false NO PREVIEW result.
  if (!exactTitle && titleScore < 0.90) return null;

  // Short/common titles need exact artist + exact title to avoid famous-title false positives.
  if (importedTitle.length <= 8 && (!exactTitle || !exactArtist)) return null;

  const score =
    titleScore * 0.64 +
    artistScore * 0.30 +
    (exactTitle ? 0.035 : 0) +
    (exactArtist ? 0.025 : 0);
  return { item, score, titleScore, artistScore };
}

function artwork600(url: string | undefined) {
  if (!url) return null;
  return url
    .replace(/\/100x100(?:bb)?\.(jpg|png)/i, "/600x600bb.$1")
    .replace(/\/100x100-75\.(jpg|png)/i, "/600x600bb.$1");
}

function yearFromDate(value: string | undefined) {
  const match = clean(value).match(/^((?:19|20)\d{2})/);
  return match ? Number(match[1]) : null;
}

function appleCandidate(item: ItunesSong): PreviewCandidate | null {
  const trackName = clean(item.trackName);
  const artistName = clean(item.artistName);
  if (!trackName || !artistName) return null;
  return {
    provider: "apple",
    id: `apple:${item.trackId || `${normalize(artistName)}:${strictTitleKey(trackName)}`}`,
    trackName,
    artistName,
    albumName: clean(item.collectionName),
    artworkUrl: artwork600(item.artworkUrl100),
    releaseYear: yearFromDate(item.releaseDate),
    genre: clean(item.primaryGenreName) || null,
    previewUrl: clean(item.previewUrl) || null,
    storeUrl: clean(item.trackViewUrl) || null,
  };
}

function deezerCandidate(item: DeezerSong): PreviewCandidate | null {
  const trackName = clean(item.title_short || item.title);
  const artistName = clean(item.artist?.name);
  if (!trackName || !artistName) return null;
  return {
    provider: "deezer",
    id: `deezer:${item.id || `${normalize(artistName)}:${strictTitleKey(trackName)}`}`,
    trackName,
    artistName,
    albumName: clean(item.album?.title),
    artworkUrl: clean(item.album?.cover_xl || item.album?.cover_big) || null,
    releaseYear: null,
    genre: null,
    previewUrl: clean(item.preview) || null,
    storeUrl: clean(item.link) || null,
  };
}

async function fetchAppleCandidates(
  term: string,
  country = "US",
  attribute?: "songTerm" | "artistTerm",
) {
  const params = new URLSearchParams({
    entity: "song",
    media: "music",
    country,
    limit: "100",
    term,
  });
  if (attribute) params.set("attribute", attribute);
  try {
    const response = await fetch(`https://itunes.apple.com/search?${params.toString()}`, {
      mode: "cors",
      cache: "no-store",
    });
    if (!response.ok) return [] as PreviewCandidate[];
    const payload = await response.json() as ItunesResponse;
    return (payload.results || [])
      .map(appleCandidate)
      .filter((item): item is PreviewCandidate => Boolean(item))
      // The same Apple track can expose a playable sample in one storefront and not another.
      // Keep storefront candidates distinct so fallback can genuinely search worldwide.
      .map((item) => ({ ...item, id: `${item.id}:${country.toUpperCase()}` }));
  } catch {
    return [] as PreviewCandidate[];
  }
}

async function fetchDeezerCandidates(term: string) {
  // Deezer's search endpoint supports JSONP, which avoids the browser CORS restriction
  // without relying on a third-party proxy.
  if (typeof document === "undefined") return [] as PreviewCandidate[];
  return new Promise<PreviewCandidate[]>((resolve) => {
    const callbackName = `__mvpAuditionDeezer_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const target = window as unknown as Record<string, unknown>;
    let settled = false;

    const finish = (rows: PreviewCandidate[]) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      script.remove();
      try {
        delete target[callbackName];
      } catch {
        target[callbackName] = undefined;
      }
      resolve(rows);
    };

    target[callbackName] = (payload: DeezerResponse) => {
      const rows = (payload?.data || [])
        .map(deezerCandidate)
        .filter((item): item is PreviewCandidate => Boolean(item));
      finish(rows);
    };

    const timeoutId = window.setTimeout(() => finish([]), 4500);
    script.onerror = () => finish([]);
    script.async = true;
    script.src = `https://api.deezer.com/search?limit=100&output=jsonp&callback=${encodeURIComponent(callbackName)}&q=${encodeURIComponent(term)}`;
    document.head.appendChild(script);
  });
}

function metadataQueries(song: MusicAuditionSong) {
  const rawArtist = clean(song.artist);
  const rawTitle = clean(song.title);
  const artist = rawArtist.replace(/\s+(?:feat(?:uring)?|ft)\.?\s+.*$/i, "").trim();
  const title = rawTitle
    .replace(/\s*[-–—]\s*(?:remaster(?:ed)?|radio edit|single version|album version|official.*)$/i, "")
    .trim();
  const normalizedArtist = normalize(artist);
  const normalizedTitle = strictTitleKey(title);

  const rows: Array<{ term: string; attribute?: "songTerm" | "artistTerm" }> = [
    { term: `${rawArtist} ${rawTitle}` },
    { term: `${artist} ${title}` },
    { term: `${title} ${artist}` },
    { term: `${normalizedArtist} ${normalizedTitle}` },
    { term: rawTitle, attribute: "songTerm" },
    { term: title, attribute: "songTerm" },
  ];
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.attribute || "all"}|${normalize(row.term)}`;
    if (!row.term || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function deezerSearchTerms(song: MusicAuditionSong) {
  const artist = clean(song.artist).replace(/\s+(?:feat(?:uring)?|ft)\.?\s+.*$/i, "").trim();
  const title = clean(song.title).trim();
  const escapedArtist = artist.replace(/"/g, "");
  const escapedTitle = title.replace(/"/g, "");
  const rows = [
    `artist:"${escapedArtist}" track:"${escapedTitle}"`,
    `${artist} ${title}`,
    `${title} ${artist}`,
    `track:"${escapedTitle}" artist:"${escapedArtist}"`,
    title,
  ];
  return [...new Set(rows.map(clean).filter(Boolean))];
}

function mergeCandidates(rows: PreviewCandidate[][]) {
  const unique = new Map<string, PreviewCandidate>();
  for (const item of rows.flat()) {
    const key = `${item.provider}|${item.id}`;
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()];
}

function rankedCandidates(song: MusicAuditionSong, rows: PreviewCandidate[]) {
  return rows
    .map((item) => candidateScore(song, item))
    .filter((candidate): candidate is NonNullable<ReturnType<typeof candidateScore>> => Boolean(candidate))
    .sort((a, b) => b.score - a.score);
}

async function probePreviewUrl(url: string) {
  if (!url || typeof Audio === "undefined") return false;
  return new Promise<boolean>((resolve) => {
    const audio = new Audio();
    let settled = false;

    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      audio.onloadedmetadata = null;
      audio.oncanplay = null;
      audio.onerror = null;
      audio.src = "";
      resolve(value);
    };

    const timeoutId = window.setTimeout(() => finish(false), 4200);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => finish(true);
    audio.oncanplay = () => finish(true);
    audio.onerror = () => finish(false);
    audio.src = url;
    try {
      audio.load();
    } catch {
      finish(false);
    }
  });
}

async function firstPlayableCandidate(
  ranked: Array<NonNullable<ReturnType<typeof candidateScore>>>,
) {
  const withPreview = ranked.filter((row) => Boolean(row.item.previewUrl)).slice(0, MAX_PREVIEW_PROBES);
  if (!withPreview.length) return null;

  // Probe small ranked batches instead of waiting for every candidate. This lets
  // a good Apple/Deezer sample win quickly while still testing deeper fallbacks.
  const batchSize = 3;
  for (let index = 0; index < withPreview.length; index += batchSize) {
    const batch = withPreview.slice(index, index + batchSize);
    const probes = await Promise.all(
      batch.map(async (row) => ({
        row,
        playable: await probePreviewUrl(row.item.previewUrl || ""),
      })),
    );
    const winner = probes.find((entry) => entry.playable)?.row;
    if (winner) return winner;
  }
  return null;
}

function previewProviderLabel(url: string | null) {
  const value = clean(url).toLowerCase();
  if (!value) return "NO SAMPLE";
  if (value.includes("dzcdn") || value.includes("deezer")) return "DEEZER SAMPLE";
  if (value.includes("apple") || value.includes("itunes")) return "APPLE SAMPLE";
  return "VERIFIED SAMPLE";
}

export async function resolveMusicAuditionMetadata(songId: string, options: { forceFresh?: boolean; blockedPreviewUrls?: Set<string>; blockedArtworkUrls?: Set<string> } = {}) {
  const state = readLocal();
  const song = state.songs.find((item) => item.id === songId);
  if (!song) throw new Error("Song not found.");

  const blockedPreviewUrls = options.blockedPreviewUrls || new Set<string>();
  const blockedArtworkUrls = options.blockedArtworkUrls || new Set<string>();
  const existing = metadataRequests.get(songId);
  if (existing && !options.forceFresh) return existing;

  const request = (async () => {
    try {
      // Reuse a working cached preview immediately unless this call explicitly asks for a fresh source.
      if (
        !options.forceFresh &&
        song.previewUrl &&
        !blockedPreviewUrls.has(song.previewUrl) &&
        (!song.artworkUrl || !blockedArtworkUrls.has(song.artworkUrl)) &&
        await probePreviewUrl(song.previewUrl)
      ) return song;

      const queries = metadataQueries(song);
      const deezerTerms = deezerSearchTerms(song);
      const primaryTerm = queries[0]?.term || `${song.artist} ${song.title}`;
      const reverseTerm = queries.find((row) => normalize(row.term) === normalize(`${song.title} ${song.artist}`))?.term || `${song.title} ${song.artist}`;

      // Fast strict wave. Search more than one catalog/query immediately, but accept only
      // high-confidence artist + title matches.
      const firstWave = await Promise.all([
        fetchAppleCandidates(primaryTerm, "US"),
        fetchAppleCandidates(primaryTerm, "GB"),
        fetchAppleCandidates(reverseTerm, "US"),
        queries.find((row) => row.attribute === "songTerm")
          ? fetchAppleCandidates(queries.find((row) => row.attribute === "songTerm")!.term, "US", "songTerm")
          : Promise.resolve([] as PreviewCandidate[]),
        fetchDeezerCandidates(deezerTerms[0] || primaryTerm),
        fetchDeezerCandidates(deezerTerms[1] || primaryTerm),
        fetchDeezerCandidates(deezerTerms[2] || reverseTerm),
      ]);

      let combined = mergeCandidates(firstWave)
        .filter((item) => !item.previewUrl || !blockedPreviewUrls.has(item.previewUrl));
      let ranked = rankedCandidates(song, combined);
      const metadataCandidates = combined.filter((item) => !item.artworkUrl || !blockedArtworkUrls.has(item.artworkUrl));
      let metadataBest = rankedCandidates(song, metadataCandidates)[0] || ranked[0] || null;
      let playableBest = await firstPlayableCandidate(ranked);

      // Deep worldwide wave only when the fast wave cannot produce a verified playable sample.
      // Apple availability differs by storefront, so the same exact track is checked globally.
      if (!playableBest) {
        const appleDeepRequests: Array<Promise<PreviewCandidate[]>> = [];
        for (const country of APPLE_STOREFRONTS) {
          if (country === "US" || country === "GB") continue;
          appleDeepRequests.push(fetchAppleCandidates(primaryTerm, country));
        }
        for (const query of queries.slice(1)) {
          appleDeepRequests.push(fetchAppleCandidates(query.term, "US", query.attribute));
        }

        const deezerDeepRequests = deezerTerms.slice(3).map((term) => fetchDeezerCandidates(term));
        const secondWave = await Promise.all([...appleDeepRequests, ...deezerDeepRequests]);

        combined = mergeCandidates([combined, ...secondWave])
          .filter((item) => !item.previewUrl || !blockedPreviewUrls.has(item.previewUrl));
        ranked = rankedCandidates(song, combined);
        const freshMetadataCandidates = combined.filter((item) => !item.artworkUrl || !blockedArtworkUrls.has(item.artworkUrl));
        metadataBest = rankedCandidates(song, freshMetadataCandidates)[0] || metadataBest;
        playableBest = await firstPlayableCandidate(ranked);
      }

      if (!metadataBest || metadataBest.score < 0.90) {
        throw new Error("No verified artist/title match found.");
      }

      const metadataItem = metadataBest.item;
      const previewItem = playableBest?.item || null;

      let changed: MusicAuditionSong | null = null;
      mutateLocal((current) => ({
        ...current,
        songs: current.songs.map((item) => {
          if (item.id !== songId) return item;
          changed = {
            ...item,
            // Imported artist/title are always authoritative. Providers only enrich the record.
            album: clean(metadataItem.albumName),
            releaseYear: metadataItem.releaseYear,
            genre: clean(metadataItem.genre) || null,
            artworkUrl:
              (metadataItem.artworkUrl && !blockedArtworkUrls.has(metadataItem.artworkUrl) ? metadataItem.artworkUrl : null) ||
              (previewItem?.artworkUrl && !blockedArtworkUrls.has(previewItem.artworkUrl) ? previewItem.artworkUrl : null) ||
              null,
            previewUrl: previewItem?.previewUrl || null,
            storeUrl: previewItem?.storeUrl || metadataItem.storeUrl || null,
            metadataUpdatedAt: now(),
            updatedAt: now(),
          };
          return changed;
        }),
      }));
      const changedSong = changed as MusicAuditionSong | null;
      if (changedSong) {
        if (changedSong.previewUrl) previewFailures.delete(songId);
        else previewFailures.set(songId, now());
        void persistSong(changedSong);
      }
      return changedSong || song;
    } catch {
      // Keep the imported identity, but never keep weak/wrong provider metadata.
      let changed: MusicAuditionSong | null = null;
      mutateLocal((current) => ({
        ...current,
        songs: current.songs.map((item) => {
          if (item.id !== songId) return item;
          changed = {
            ...item,
            // Keep any good artwork/metadata already found. Only invalidate the temporary sample.
            previewUrl: null,
            metadataUpdatedAt: null,
            updatedAt: now(),
          };
          return changed;
        }),
      }));
      previewFailures.set(songId, now());
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
  // Preserve the imported identity exactly. Do not substitute provider metadata.
  const query = `"${clean(song.artist)}" "${clean(song.title)}"`;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

export function matchingMusicLibraryTrack(song: MusicAuditionSong, tracks: MusicTrack[]) {
  if (song.libraryTrackId) {
    const byId = tracks.find((track) => track.id === song.libraryTrackId);
    if (byId) return byId;
  }

  const exact = tracks.find((track) => auditionCanonicalKey(track.artist || "", track.title) === song.canonicalKey);
  if (exact) return exact;

  // A strict normalized fallback catches harmless metadata differences without hiding a different song.
  return tracks.find((track) => {
    const artistScore = artistMatchScore(song.artist, track.artist || "");
    const titleScore = titleMatchScore(strictTitleKey(song.title), strictTitleKey(track.title));
    return artistScore >= 0.94 && titleScore >= 0.94;
  }) || null;
}

export function musicAuditionSongInLibrary(song: MusicAuditionSong, tracks: MusicTrack[]) {
  return Boolean(matchingMusicLibraryTrack(song, tracks));
}

export function musicAuditionSongSources(songId: string, lists: MusicAuditionList[]) {
  return lists.filter((list) => list.songIds.includes(songId));
}

type AuditionView = "lists" | "audition" | "kept" | "history" | "results";
type ListSort = "newest" | "name" | "progress" | "most_kept";

type Props = {
  tracks: MusicTrack[];
  previewVolume?: number;
  onPreviewStart?: () => void;
  onImportFile?: (file: File, song: MusicAuditionSong) => Promise<MusicTrack | null>;
};

function listStats(
  list: MusicAuditionList,
  songsById: Map<string, MusicAuditionSong>,
  isInLibrary: (song: MusicAuditionSong) => boolean,
) {
  const importedSongs = list.songIds
    .map((id) => songsById.get(id))
    .filter((song): song is MusicAuditionSong => Boolean(song));
  const skipped = importedSongs.filter(isInLibrary).length;
  const songs = importedSongs.filter((song) => !isInLibrary(song));
  const keep = songs.filter((song) => song.decision === "keep").length;
  const pass = songs.filter((song) => song.decision === "pass").length;
  const maybe = songs.filter((song) => song.decision === "maybe").length;
  const reviewed = keep + pass + maybe;
  return {
    importedTotal: importedSongs.length,
    skipped,
    total: songs.length,
    keep,
    pass,
    maybe,
    reviewed,
    progress: songs.length ? reviewed / songs.length : 0,
  };
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



export function MusicAuditionPanel({ tracks, previewVolume = 0.95, onPreviewStart, onImportFile }: Props) {
  const [state, setState] = useState(() => listMusicAuditionState());
  const [view, setView] = useState<AuditionView>("lists");
  const [resultDecision, setResultDecision] = useState<Exclude<AuditionDecision, null>>("keep");
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
  const [previewRequestSongId, setPreviewRequestSongId] = useState<string | null>(null);
  const [importingSongId, setImportingSongId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [failedArtworkUrls, setFailedArtworkUrls] = useState<Set<string>>(() => new Set());
  const [verifiedMetadataIds, setVerifiedMetadataIds] = useState<Set<string>>(() => new Set());
  const verifiedMetadataIdsRef = useRef<Set<string>>(new Set());
  const [decisionFlash, setDecisionFlash] = useState<{ songId: string; decision: Exclude<AuditionDecision, null> } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewGenerationRef = useRef(0);
  const previewRequestSongIdRef = useRef<string | null>(null);
  const decisionTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingFileSongRef = useRef<MusicAuditionSong | null>(null);

  const refresh = () => setState(listMusicAuditionState());

  useEffect(() => {
    const unsubscribe = subscribeMusicAudition(refresh);
    void hydrateMusicAuditionFromCloud().finally(refresh);
    return () => {
      unsubscribe();
      previewGenerationRef.current += 1;
      previewRequestSongIdRef.current = null;
      const audio = audioRef.current;
      if (audio) {
        audio.onended = null;
        audio.onerror = null;
        audio.pause();
        audio.removeAttribute("src");
        try { audio.load(); } catch { /* Media element already disposed. */ }
      }
      audioRef.current = null;
      if (decisionTimerRef.current) window.clearTimeout(decisionTimerRef.current);
    };
  }, []);

  const songsById = useMemo(() => new Map(state.songs.map((song) => [song.id, song])), [state.songs]);
  const libraryIndex = useMemo(() => {
    const ids = new Set<string>();
    const keys = new Set<string>();
    for (const track of tracks) {
      ids.add(track.id);
      const artist = track.artist || "";
      keys.add(auditionCanonicalKey(artist, track.title));
      keys.add(`${leadArtist(artist)}|${strictTitleKey(track.title)}`);
    }
    return { ids, keys };
  }, [tracks]);
  const isInLibraryFast = useCallback((song: MusicAuditionSong) => {
    if (song.libraryTrackId && libraryIndex.ids.has(song.libraryTrackId)) return true;
    if (libraryIndex.keys.has(song.canonicalKey)) return true;
    return libraryIndex.keys.has(`${leadArtist(song.artist)}|${strictTitleKey(song.title)}`);
  }, [libraryIndex]);
  const selectedList = state.lists.find((list) => list.id === selectedListId) || null;
  const selectedAllSongs = useMemo(
    () => selectedList
      ? selectedList.songIds.map((id) => songsById.get(id)).filter((song): song is MusicAuditionSong => Boolean(song))
      : [],
    [selectedList, songsById],
  );
  const selectedSongs = useMemo(
    () => selectedAllSongs.filter((song) => !isInLibraryFast(song) && !song.decision),
    [selectedAllSongs, isInLibraryFast],
  );
  const currentSong = selectedSongs[currentIndex] || null;
  const currentStats = selectedList ? listStats(selectedList, songsById, isInLibraryFast) : null;

  const allKeptSongs = useMemo(
    () => state.songs
      .filter((song) => song.decision === "keep")
      .sort((a, b) => (b.decidedAt || 0) - (a.decidedAt || 0)),
    [state.songs],
  );
  const keptSongs = useMemo(
    () => allKeptSongs.filter((song) => !isInLibraryFast(song)),
    [allKeptSongs, isInLibraryFast],
  );

  const sortedLists = useMemo(() => {
    const rows = [...state.lists];
    if (listSort === "name") return rows.sort((a, b) => a.name.localeCompare(b.name));
    if (listSort === "progress") return rows.sort((a, b) => listStats(b, songsById, isInLibraryFast).progress - listStats(a, songsById, isInLibraryFast).progress || b.updatedAt - a.updatedAt);
    if (listSort === "most_kept") return rows.sort((a, b) => listStats(b, songsById, isInLibraryFast).keep - listStats(a, songsById, isInLibraryFast).keep || b.updatedAt - a.updatedAt);
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  }, [state.lists, songsById, isInLibraryFast, listSort]);
  const activeLists = useMemo(() => sortedLists.filter((list) => {
    const stats = listStats(list, songsById, isInLibraryFast);
    return stats.total > stats.reviewed;
  }), [sortedLists, songsById, isInLibraryFast]);
  const historyLists = useMemo(() => sortedLists.filter((list) => {
    const stats = listStats(list, songsById, isInLibraryFast);
    return stats.total <= stats.reviewed;
  }), [sortedLists, songsById, isInLibraryFast]);
  const resultSongs = useMemo(() => state.songs
    .filter((song) => song.decision === resultDecision)
    .sort((a, b) => (b.decidedAt || 0) - (a.decidedAt || 0)), [state.songs, resultDecision]);
  const parsedImportCount = useMemo(() => parseAuditionListText(importText).length, [importText]);

  useEffect(() => {
    if (!selectedSongs.length) {
      setCurrentIndex(0);
      return;
    }
    setCurrentIndex((index) => Math.min(index, selectedSongs.length - 1));
  }, [selectedSongs.length, selectedListId]);

  useEffect(() => {
    if (!currentSong) return;
    const songId = currentSong.id;
    if (verifiedMetadataIdsRef.current.has(songId) || verifiedMetadataIds.has(songId)) return;

    const failureAt = previewFailures.get(songId) || 0;
    if (failureAt && now() - failureAt < PREVIEW_FAILURE_RETRY_MS) return;

    const previewAge = currentSong.metadataUpdatedAt ? now() - currentSong.metadataUpdatedAt : Number.POSITIVE_INFINITY;
    const forceFresh = !currentSong.previewUrl || previewAge > PREVIEW_URL_CACHE_MS;

    setLookupSongId(songId);
    void resolveMusicAuditionMetadata(songId, { forceFresh })
      .then((resolved) => {
        // Artwork/metadata resolution is independent from embedded-preview availability.
        // A provider can return the correct cover even when no playable sample exists.
        const metadataResolved = Boolean(
          resolved.metadataUpdatedAt ||
          resolved.artworkUrl ||
          resolved.album ||
          resolved.releaseYear ||
          resolved.genre ||
          resolved.storeUrl
        );
        if (metadataResolved) verifiedMetadataIdsRef.current.add(songId);
        else verifiedMetadataIdsRef.current.delete(songId);
        setVerifiedMetadataIds((previous) => {
          const next = new Set(previous);
          if (metadataResolved) next.add(songId);
          else next.delete(songId);
          return next;
        });
      })
      .finally(() => {
        setLookupSongId((id) => id === songId ? null : id);
      });
  }, [currentSong?.id, currentSong?.metadataUpdatedAt, currentSong?.artworkUrl, currentSong?.previewUrl, currentSong?.album, verifiedMetadataIds]);

  useEffect(() => {
    if (!currentSong || !selectedSongs.length) return;
    const timer = window.setTimeout(() => {
      const upcoming = selectedSongs.slice(currentIndex + 1, currentIndex + 6);
      for (const song of upcoming) {
        if (verifiedMetadataIdsRef.current.has(song.id)) continue;
        const failureAt = previewFailures.get(song.id) || 0;
        if (failureAt && now() - failureAt < PREVIEW_FAILURE_RETRY_MS) continue;

        const previewAge = song.metadataUpdatedAt ? now() - song.metadataUpdatedAt : Number.POSITIVE_INFINITY;
        const forceFresh = !song.previewUrl || previewAge > PREVIEW_URL_CACHE_MS;
        void resolveMusicAuditionMetadata(song.id, { forceFresh }).then((resolved) => {
          const metadataResolved = Boolean(
            resolved.metadataUpdatedAt ||
            resolved.artworkUrl ||
            resolved.album ||
            resolved.releaseYear ||
            resolved.genre ||
            resolved.storeUrl
          );
          if (metadataResolved) verifiedMetadataIdsRef.current.add(song.id);
          else verifiedMetadataIdsRef.current.delete(song.id);
        });
      }
    }, 80);
    return () => window.clearTimeout(timer);
  }, [currentSong?.id, currentIndex, selectedSongs]);


  function handleArtworkFailure(song: MusicAuditionSong, url: string) {
    if (!url) return;
    const blocked = new Set<string>(failedArtworkUrls);
    blocked.add(url);
    setFailedArtworkUrls(blocked);
    verifiedMetadataIdsRef.current.delete(song.id);
    setVerifiedMetadataIds((previous) => {
      const next = new Set(previous);
      next.delete(song.id);
      return next;
    });

    setLookupSongId(song.id);
    void resolveMusicAuditionMetadata(song.id, { forceFresh: true, blockedArtworkUrls: blocked })
      .then((resolved) => {
        if (resolved.artworkUrl && !blocked.has(resolved.artworkUrl)) {
          verifiedMetadataIdsRef.current.add(song.id);
          setVerifiedMetadataIds((previous) => new Set(previous).add(song.id));
        }
      })
      .finally(() => setLookupSongId((id) => id === song.id ? null : id));
  }

  function openList(list: MusicAuditionList) {
    stopPreview();
    setSelectedListId(list.id);
    setCurrentIndex(0);
    setView("audition");
    setMessage("");
  }

  function stopPreview() {
    previewGenerationRef.current += 1;
    previewRequestSongIdRef.current = null;
    setPreviewRequestSongId(null);

    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute("src");
      try { audio.load(); } catch { /* Media element already stopped. */ }
    }
    audioRef.current = null;
    setPreviewSongId(null);
  }

  async function togglePreview(song: MusicAuditionSong) {
    // The same control is always a true stop/cancel button, including while a lookup
    // is still pending. This prevents a stale async lookup from restarting audio later.
    if (
      previewSongId === song.id ||
      previewRequestSongId === song.id ||
      previewRequestSongIdRef.current === song.id
    ) {
      stopPreview();
      setMessage("");
      return;
    }

    stopPreview();
    setMessage("");
    onPreviewStart?.();

    const generation = ++previewGenerationRef.current;
    previewRequestSongIdRef.current = song.id;
    setPreviewRequestSongId(song.id);

    const audio = new Audio();
    audio.preload = "auto";
    audio.autoplay = true;
    audio.volume = Math.max(0, Math.min(1, previewVolume));
    audioRef.current = audio;

    const sessionCurrent = () =>
      previewGenerationRef.current === generation &&
      audioRef.current === audio;

    const clearRequest = () => {
      if (!sessionCurrent()) return;
      previewRequestSongIdRef.current = null;
      setPreviewRequestSongId((id) => id === song.id ? null : id);
    };

    const blockedUrls = new Set<string>();

    const markVerified = (songId: string, playable: boolean) => {
      if (playable) verifiedMetadataIdsRef.current.add(songId);
      else verifiedMetadataIdsRef.current.delete(songId);
      setVerifiedMetadataIds((previous) => {
        const next = new Set(previous);
        if (playable) next.add(songId); else next.delete(songId);
        return next;
      });
    };

    const resolveFresh = async (forceFresh: boolean) => {
      if (!sessionCurrent()) return song;
      setLookupSongId(song.id);
      try {
        const resolved = await resolveMusicAuditionMetadata(song.id, { forceFresh, blockedPreviewUrls: blockedUrls });
        if (!sessionCurrent()) return resolved;
        markVerified(song.id, Boolean(resolved.previewUrl));
        return resolved;
      } finally {
        if (sessionCurrent()) setLookupSongId((id) => id === song.id ? null : id);
      }
    };

    const failPreview = (messageText = "No embedded sample is available from the preview providers. YouTube exact search is ready.") => {
      if (!sessionCurrent()) return;
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute("src");
      try { audio.load(); } catch { /* Nothing else to release. */ }
      clearRequest();
      audioRef.current = null;
      setPreviewSongId(null);
      setMessage(messageText);
    };

    const playUrl = async (resolved: MusicAuditionSong, retryDepth = 0): Promise<boolean> => {
      if (!sessionCurrent()) return false;
      const url = clean(resolved.previewUrl);
      if (!url || blockedUrls.has(url)) return false;

      audio.onended = null;
      audio.onerror = null;
      audio.loop = false;
      audio.muted = false;
      audio.volume = Math.max(0, Math.min(1, previewVolume));
      audio.src = url;

      try {
        await audio.play();
        if (!sessionCurrent()) {
          audio.pause();
          return false;
        }

        setPreviewSongId(song.id);
        clearRequest();
        setMessage("");

        audio.onended = () => {
          if (!sessionCurrent()) return;
          previewGenerationRef.current += 1;
          previewRequestSongIdRef.current = null;
          setPreviewRequestSongId(null);
          setPreviewSongId(null);
          audioRef.current = null;
        };

        audio.onerror = () => {
          if (!sessionCurrent() || retryDepth >= 4 || blockedUrls.has(url)) return;
          blockedUrls.add(url);
          markVerified(song.id, false);
          setPreviewSongId(null);
          previewRequestSongIdRef.current = song.id;
          setPreviewRequestSongId(song.id);
          setMessage("Refreshing preview source…");
          void resolveFresh(true)
            .then((fresh) => sessionCurrent() ? playUrl(fresh, retryDepth + 1) : false)
            .then((played) => {
              if (!played && sessionCurrent()) failPreview();
            });
        };
        return true;
      } catch (error) {
        if (!sessionCurrent()) return false;
        blockedUrls.add(url);
        markVerified(song.id, false);

        if (retryDepth < 4) {
          previewRequestSongIdRef.current = song.id;
          setPreviewRequestSongId(song.id);
          const fresh = await resolveFresh(true);
          if (!sessionCurrent()) return false;
          if (fresh.previewUrl && !blockedUrls.has(fresh.previewUrl)) {
            return playUrl(fresh, retryDepth + 1);
          }
        }

        const name = error instanceof DOMException ? error.name : "";
        if (name === "NotAllowedError") {
          // Last browser-policy recovery: muted media playback is permitted by
          // modern browsers even when provider lookup finished after the click.
          // Start this same user-primed element muted, then restore preview volume.
          try {
            audio.autoplay = true;
            audio.muted = true;
            audio.load();
            await audio.play();
            if (!sessionCurrent()) {
              audio.pause();
              return false;
            }
            await new Promise<void>((resolve) => window.setTimeout(resolve, 60));
            audio.muted = false;
            audio.volume = Math.max(0, Math.min(1, previewVolume));
            setPreviewSongId(song.id);
            clearRequest();
            setMessage("");
            return true;
          } catch {
            // A genuinely strict browser policy is the only remaining case. Keep
            // the freshly-resolved provider URL so the next physical tap plays it
            // instantly, rather than repeating metadata searches.
            clearRequest();
            setPreviewSongId(null);
            setMessage("PREVIEW READY • TAP PREVIEW TO PLAY");
            return false;
          }
        }
        failPreview();
        return false;
      }
    };

    // Prime this exact HTMLMediaElement during the real button gesture. When a fresh
    // provider search is needed, the silent loop keeps the element user-activated
    // while Apple/Deezer lookups finish instead of calling play() for the first time
    // after the click event has expired.
    audio.loop = true;
    audio.muted = true;
    audio.src = PREVIEW_UNLOCK_AUDIO;
    try {
      await audio.play();
    } catch {
      // A ready provider URL can still be attempted below. Do not fail early.
    }
    if (!sessionCurrent()) return;

    let resolved = song;
    const failureAt = previewFailures.get(song.id) || 0;
    const previewAge = song.metadataUpdatedAt ? now() - song.metadataUpdatedAt : Number.POSITIVE_INFINITY;
    const cachedPreviewIsFresh = Boolean(
      song.previewUrl &&
      previewAge <= PREVIEW_URL_CACHE_MS &&
      !(failureAt && now() - failureAt < PREVIEW_FAILURE_RETRY_MS),
    );

    if (cachedPreviewIsFresh && resolved.previewUrl) {
      if (await playUrl(resolved)) return;
      if (!sessionCurrent()) return;
    }

    setMessage("Finding a fresh playable preview…");
    resolved = await resolveFresh(true);
    if (!sessionCurrent()) return;

    if (!resolved.previewUrl) {
      failPreview();
      return;
    }

    const played = await playUrl(resolved);
    if (!played && sessionCurrent()) failPreview();
  }

  function openYoutube(song: MusicAuditionSong) {
    window.open(auditionYoutubeUrl(song), "_blank", "noopener,noreferrer");
  }

  function decide(song: MusicAuditionSong, decision: Exclude<AuditionDecision, null>) {
    if (decisionFlash) return;
    stopPreview();
    setMessage("");
    setDecisionFlash({ songId: song.id, decision });
    // Update the local queue immediately. Supabase persistence already runs asynchronously.
    setMusicAuditionDecision(song.id, decision);
    if (decisionTimerRef.current) window.clearTimeout(decisionTimerRef.current);
    decisionTimerRef.current = window.setTimeout(() => {
      setDecisionFlash(null);
      decisionTimerRef.current = null;
    }, 180);
  }

  function submitImport() {
    setImportError("");
    try {
      const list = importMusicAuditionList(importName, importText);
      const freshState = listMusicAuditionState();
      const freshMap = new Map(freshState.songs.map((song) => [song.id, song]));
      const stats = listStats(list, freshMap, isInLibraryFast);
      setImportOpen(false);
      setImportName(defaultListName());
      setImportText("");
      setState(freshState);
      openList(list);
      const remaining = Math.max(0, stats.total - stats.reviewed);
      setMessage(
        `${stats.importedTotal} tracks analyzed • ${stats.skipped} already in MVP skipped • ${stats.reviewed} previously reviewed • ${remaining} ready to audition.`,
      );
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
    stopPreview();
    setCurrentIndex((index) => index >= selectedSongs.length - 1 ? 0 : index + 1);
  }

  const globalCounts = useMemo(() => ({
    keep: state.songs.filter((song) => song.decision === "keep").length,
    pass: state.songs.filter((song) => song.decision === "pass").length,
    maybe: state.songs.filter((song) => song.decision === "maybe").length,
    reviewed: state.songs.filter((song) => Boolean(song.decision)).length,
  }), [state.songs]);

  const currentArtworkReady = Boolean(currentSong?.artworkUrl && !failedArtworkUrls.has(currentSong.artworkUrl));
  const currentPreviewReady = Boolean(currentSong?.previewUrl);
  const currentFlashDecision = currentSong && decisionFlash?.songId === currentSong.id ? decisionFlash.decision : null;
  const currentRemaining = currentStats ? Math.max(0, currentStats.total - currentStats.reviewed) : 0;

  return <section className="m37-audition mvp-audition">
    <input ref={fileInputRef} hidden type="file" accept=".mp3,.m4a,.wav,audio/mpeg,audio/mp4,audio/wav" onChange={(event) => void handleFileChange(event)} />

    <header className="m37-auditionHero m38-auditionHero">
      <div><span>AUDITION</span><h2>Audition Queue</h2><p>Listen, decide, revisit and move the right songs into My Music.</p></div>
      <div className="m37-auditionGlobal m38-auditionTelemetry" aria-label="Audition totals">
        <span className="is-keep"><b>{globalCounts.keep}</b><small>KEPT</small></span>
        <span className="is-maybe"><b>{globalCounts.maybe}</b><small>MAYBE</small></span>
        <span className="is-pass"><b>{globalCounts.pass}</b><small>PASSED</small></span>
        <span><b>{state.lists.length}</b><small>LISTS</small></span>
      </div>
    </header>

    <nav className="m37-auditionNav m38-auditionNav" aria-label="Audition views">
      <motion.button whileTap={{scale:.97}} className={view === "lists" ? "is-active" : ""} onClick={() => { stopPreview(); setView("lists"); }}><QueuePremiumIcon /><span>LISTS</span><b>{state.lists.length}</b></motion.button>
      <motion.button whileTap={{scale:.97}} className={view === "audition" ? "is-active" : ""} disabled={!selectedList} onClick={() => selectedList && setView("audition")}><PlayPremiumIcon /><span>NOW AUDITIONING</span></motion.button>
      <motion.button whileTap={{scale:.97}} className={view === "kept" ? "is-active" : ""} onClick={() => { stopPreview(); setView("kept"); }}><KeepPremiumIcon /><span>KEPT</span><b>{globalCounts.keep}</b></motion.button>
      <motion.button whileTap={{scale:.97}} className={view === "results" && resultDecision === "maybe" ? "is-active is-maybe" : "is-maybe"} onClick={() => { stopPreview(); setResultDecision("maybe"); setView("results"); }}><MaybePremiumIcon /><span>MAYBE</span><b>{globalCounts.maybe}</b></motion.button>
      <motion.button whileTap={{scale:.97}} className={view === "results" && resultDecision === "pass" ? "is-active is-pass" : "is-pass"} onClick={() => { stopPreview(); setResultDecision("pass"); setView("results"); }}><PassPremiumIcon /><span>PASSED</span><b>{globalCounts.pass}</b></motion.button>
      <motion.button whileTap={{scale:.97}} className={view === "history" ? "is-active" : ""} onClick={() => { stopPreview(); setView("history"); }}><SparkPremiumIcon /><span>HISTORY</span></motion.button>
      <motion.button whileTap={{scale:.97}} className="is-import" onClick={() => { setImportError(""); setImportOpen(true); }}><UploadPremiumIcon /><span>IMPORT</span></motion.button>
    </nav>

    {message ? <div className="mvp-auditionMessage">{message}<button type="button" onClick={() => setMessage("")}>×</button></div> : null}

    {view === "lists" ? <>
      <div className="m37-auditionToolbar"><strong>{activeLists.length} ACTIVE</strong><MusicPremiumSelect className="mvp-auditionSortSelect" label="SORT" value={listSort} onChange={(next) => setListSort(next as ListSort)} options={[{value:"newest",label:"Newest"},{value:"name",label:"Name A–Z"},{value:"progress",label:"Most reviewed"},{value:"most_kept",label:"Most kept"}]} /></div>
      {!activeLists.length ? <div className="m37-auditionEmpty"><b>NO ACTIVE AUDITIONS</b><button onClick={() => setImportOpen(true)}>IMPORT LIST</button></div> : <div className="m37-auditionLists">
        {activeLists.map((list) => {
          const stats = listStats(list, songsById, isInLibraryFast);
          const percent = stats.total ? Math.round(stats.progress * 100) : 100;
          const remaining = Math.max(0, stats.total - stats.reviewed);
          return <article key={list.id} className="m37-auditionListCard">
            <header><div className="m37-auditionListIcon">♫</div><div>{renameListId === list.id ? <div className="mvp-auditionRename"><input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") saveRename(); if (event.key === "Escape") setRenameListId(null); }} /><button onClick={saveRename}>SAVE</button><button onClick={() => setRenameListId(null)}>CANCEL</button></div> : <><h3>{list.name}</h3><small>{dateLabel(list.createdAt).toUpperCase()}</small></>}</div><b>{percent}%</b></header>
            <div className="m37-auditionListStats"><span><b>{remaining}</b><small>REMAINING</small></span><span><b>{stats.reviewed}</b><small>REVIEWED</small></span><span className="is-keep"><b>{stats.keep}</b><small>KEEP</small></span><span className="is-maybe"><b>{stats.maybe}</b><small>MAYBE</small></span><span className="is-pass"><b>{stats.pass}</b><small>PASS</small></span></div>
            <footer className="m38-auditionListFooter"><motion.button type="button" className="is-open" onClick={() => openList(list)} whileTap={{scale:.97}}><PlayPremiumIcon /><span>{stats.reviewed ? "CONTINUE" : "START"}</span></motion.button><details className="m38-moreMenu"><summary aria-label={`More actions for ${list.name}`}><span>•••</span><b>MORE</b></summary><div><button onClick={() => startRename(list)}>RENAME</button><button onClick={() => duplicateList(list)}>DUPLICATE</button><button onClick={() => setMergeSourceId(list.id)} disabled={state.lists.length < 2}>MERGE</button><button className="is-danger" onClick={() => void deleteList(list)}>DELETE LIST</button></div></details></footer>
          </article>;
        })}
      </div>}
    </> : null}

    {view === "history" ? <section className="m37-auditionHistory">
      <header><div><span>HISTORY</span><h3>Completed Auditions</h3></div><b>{historyLists.length}</b></header>
      {!historyLists.length ? <div className="m37-auditionEmpty"><b>NO COMPLETED AUDITIONS</b></div> : <div>{historyLists.map((list) => { const stats=listStats(list,songsById,isInLibraryFast); return <article key={list.id}><div><strong>{list.name}</strong><span>{dateLabel(list.updatedAt)}</span></div><div><span><b>{stats.reviewed}</b> REVIEWED</span><span className="is-keep"><b>{stats.keep}</b> KEPT</span><span className="is-maybe"><b>{stats.maybe}</b> MAYBE</span><span className="is-pass"><b>{stats.pass}</b> PASS</span></div><div><button onClick={() => duplicateList(list)}>DUPLICATE</button><button className="is-danger" onClick={() => void deleteList(list)}>DELETE</button></div></article>; })}</div>}
    </section> : null}

    {view === "results" ? <section className="m37-auditionResults m38-auditionResults">
      <header><div><span>DECISION HISTORY</span><h3>{decisionLabel(resultDecision)} Songs</h3><p>Every decision stays reviewable. Preview again, use YouTube, or change your mind.</p></div><b>{resultSongs.length}</b></header>
      {!resultSongs.length ? <div className="m37-auditionEmpty"><b>NO {decisionLabel(resultDecision)} SONGS</b></div> : <div className="m37-auditionResultGrid">{resultSongs.map((song) => { const sources=musicAuditionSongSources(song.id,state.lists); return <motion.article layout key={song.id}>
        <div className="m37-auditionResultArt">{song.artworkUrl && !failedArtworkUrls.has(song.artworkUrl) ? <img src={song.artworkUrl} alt="" onError={() => handleArtworkFailure(song,song.artworkUrl || "")} /> : <span>♫</span>}</div>
        <div className="m38-resultCopy"><strong>{song.title}</strong><span>{song.artist}</span><small>{sources.map((list)=>list.name).join(" • ") || "Audition history"}</small></div>
        <div className="m37-auditionResultActions">
          <motion.button whileTap={{scale:.96}} className={previewSongId===song.id ? "is-active is-preview" : "is-preview"} onClick={() => void togglePreview(song)}><PreviewRenderIcon playing={previewSongId===song.id}/><span>{previewSongId===song.id ? "STOP" : "PREVIEW"}</span></motion.button>
          <motion.button whileTap={{scale:.96}} className="is-youtube" onClick={() => openYoutube(song)}><YouTubePremiumIcon/><span>YOUTUBE</span></motion.button>
          {resultDecision !== "keep" ? <motion.button whileTap={{scale:.96}} className="is-keep" onClick={() => {setMusicAuditionDecision(song.id,"keep");refresh();}}><KeepPremiumIcon/><span>KEEP</span></motion.button> : null}
          {resultDecision !== "maybe" ? <motion.button whileTap={{scale:.96}} className="is-maybe" onClick={() => {setMusicAuditionDecision(song.id,"maybe");refresh();}}><MaybePremiumIcon/><span>MAYBE</span></motion.button> : null}
          {resultDecision !== "pass" ? <motion.button whileTap={{scale:.96}} className="is-pass" onClick={() => {setMusicAuditionDecision(song.id,"pass");refresh();}}><PassPremiumIcon/><span>PASS</span></motion.button> : null}
          <motion.button whileTap={{scale:.96}} className="is-delete" onClick={() => void (async()=>{ if (!window.confirm(`Delete ${song.artist} - ${song.title} from Audition history? This will not delete a song already in My Music.`)) return; stopPreview(); await deleteMusicAuditionSong(song.id); refresh(); })()}><span className="m38-deleteX">×</span><span>DELETE</span></motion.button>
        </div>
      </motion.article>; })}</div>}
    </section> : null}


    {view === "audition" && selectedList && currentStats ? <div className="m37-auditionStage">
      <header className="m37-auditionStageHead"><button onClick={() => { stopPreview(); setView("lists"); }}>‹ LISTS</button><div><span>NOW AUDITIONING</span><h3>{selectedList.name}</h3></div><div><b>{currentRemaining}</b><span>REMAINING</span></div></header>
      {currentSong ? <AnimatePresence mode="wait" initial={false}><motion.article key={currentSong.id} className={`m37-auditionSong m38-auditionSong ${currentArtworkReady ? "has-art" : "no-art"}`} initial={{opacity:0,x:18}} animate={{opacity:1,x:0}} exit={{opacity:0,x:-14}} transition={{duration:.22,ease:[.22,1,.36,1]}}>
        {currentArtworkReady ? <div className="m38-auditionAmbient" aria-hidden style={{backgroundImage:`url("${currentSong.artworkUrl}")`}}/> : null}
        <div className="m37-auditionArtwork m38-auditionArtwork">{currentArtworkReady ? <img src={currentSong.artworkUrl || ""} alt="" onError={() => handleArtworkFailure(currentSong,currentSong.artworkUrl || "")} /> : <div><b>{currentSong.artist.split(/\s+/).slice(0,2).map((part)=>part[0]).join("").toUpperCase()}</b><small>{lookupSongId===currentSong.id ? "SEARCHING" : "NO ART"}</small></div>}<span className="m38-artReflection" aria-hidden/></div>
        <div className="m37-auditionSongInfo m38-auditionSongInfo">
          <div className="m37-auditionSongStatus"><span className={`is-${currentFlashDecision || "new"}`}>{currentFlashDecision ? decisionLabel(currentFlashDecision) : "READY"}</span>{currentPreviewReady ? <span>{previewProviderLabel(currentSong.previewUrl)}</span> : <span>YOUTUBE READY</span>}</div>
          <div className="m38-auditionIdentity"><span>CURRENT SONG</span><h2>{currentSong.title}</h2><h3>{currentSong.artist}</h3><p>{[currentSong.album,currentSong.releaseYear].filter(Boolean).join(" • ") || "Metadata ready when available"}</p></div>
          <div className="m38-auditionListenLabel">LISTEN</div>
          <div className="m37-auditionListen"><motion.button whileTap={{scale:.97}} className={`is-preview ${previewSongId===currentSong.id ? "is-active" : ""}`} onClick={() => void togglePreview(currentSong)}><PreviewRenderIcon playing={previewSongId===currentSong.id}/><span><b>{previewSongId===currentSong.id ? "STOP PREVIEW" : previewRequestSongId===currentSong.id ? "CANCEL" : currentPreviewReady ? "PREVIEW" : "FIND PREVIEW"}</b><small>{currentPreviewReady ? previewProviderLabel(currentSong.previewUrl) : "Search preview sources"}</small></span></motion.button><motion.button whileTap={{scale:.97}} className="is-youtube" onClick={() => openYoutube(currentSong)}><YouTubePremiumIcon/><span><b>YOUTUBE</b><small>Exact artist + title</small></span></motion.button></div>
          <div className="m38-auditionDecisionLabel">DECIDE</div>
          <div className="m37-auditionDecision"><motion.button whileTap={{scale:.97}} aria-pressed={currentFlashDecision==="keep"} className={`is-keep ${currentFlashDecision==="keep" ? "is-active" : ""}`} onClick={() => decide(currentSong,"keep")}><KeepPremiumIcon/><span><b>KEEP</b><small>Save for library</small></span></motion.button><motion.button whileTap={{scale:.97}} aria-pressed={currentFlashDecision==="maybe"} className={`is-maybe ${currentFlashDecision==="maybe" ? "is-active" : ""}`} onClick={() => decide(currentSong,"maybe")}><MaybePremiumIcon/><span><b>MAYBE</b><small>Review later</small></span></motion.button><motion.button whileTap={{scale:.97}} aria-pressed={currentFlashDecision==="pass"} className={`is-pass ${currentFlashDecision==="pass" ? "is-active" : ""}`} onClick={() => decide(currentSong,"pass")}><PassPremiumIcon/><span><b>PASS</b><small>Show less like this</small></span></motion.button></div>
          <div className="m37-auditionPager"><motion.button whileTap={{scale:.97}} disabled={currentIndex<=0} onClick={() => {stopPreview();setCurrentIndex((index)=>Math.max(0,index-1));}}><ChevronPremiumIcon direction="left"/><span>PREVIOUS</span></motion.button><b><small>POSITION</small>{currentIndex + 1} / {selectedSongs.length}</b><motion.button whileTap={{scale:.97}} onClick={nextUnreviewed}><span>NEXT UNREVIEWED</span><ChevronPremiumIcon direction="right"/></motion.button></div>
        </div>
        <aside className="m38-auditionContext">
          <span>WHY IT'S HERE</span>
          <strong>{currentSong.decision ? `Previously ${decisionLabel(currentSong.decision).toLowerCase()}` : "Unreviewed candidate"}</strong>
          <p>{selectedList.name}</p>
          <div><span>PREVIEW</span><b>{currentPreviewReady ? previewProviderLabel(currentSong.previewUrl).replace(" SAMPLE","") : "SEARCH"}</b></div>
          <div><span>ARTWORK</span><b>{currentArtworkReady ? "READY" : "SEARCHING"}</b></div>
          <div><span>LIBRARY</span><b>{currentSong.libraryTrackId ? "IN MVP" : "NOT ADDED"}</b></div>
          <small>Keep, Maybe and Pass remain reversible from the decision tabs.</small>
        </aside>
      </motion.article></AnimatePresence> : <div className="m37-auditionComplete"><b>AUDITION COMPLETE</b><button onClick={() => setView("history")}>VIEW HISTORY</button></div>}

    </div> : null}

    {view === "kept" ? <section className="m37-auditionKept m38-auditionKept"><header><div><span>KEPT SONGS</span><h3>Ready to Add</h3><p>Preview again before importing. Songs already added to My Music are clearly marked.</p></div><b>{keptSongs.length}</b></header>{!keptSongs.length ? <div className="m37-auditionEmpty"><b>NO KEPT SONGS WAITING</b></div> : <div>{keptSongs.map((song) => { const sources=musicAuditionSongSources(song.id,state.lists); return <motion.article layout key={song.id}><div className="m37-auditionResultArt">{song.artworkUrl && !failedArtworkUrls.has(song.artworkUrl) ? <img src={song.artworkUrl} alt="" onError={() => handleArtworkFailure(song,song.artworkUrl || "")} /> : <span>♫</span>}</div><div className="m38-resultCopy"><strong>{song.title}</strong><span>{song.artist}</span><small>{sources.map((list)=>list.name).join(" • ")}</small></div><div className="m37-auditionResultActions"><motion.button whileTap={{scale:.96}} className={previewSongId===song.id ? "is-active is-preview" : "is-preview"} onClick={() => void togglePreview(song)}><PreviewRenderIcon playing={previewSongId===song.id}/><span>{previewSongId===song.id ? "STOP" : "PREVIEW"}</span></motion.button><motion.button whileTap={{scale:.96}} className="is-youtube" onClick={() => openYoutube(song)}><YouTubePremiumIcon/><span>YOUTUBE</span></motion.button>{song.libraryTrackId ? <span className="m38-inLibraryState">✓ IN LIBRARY</span> : onImportFile ? <motion.button whileTap={{scale:.96}} className="is-add" disabled={importingSongId===song.id} onClick={() => requestSongImport(song)}><UploadPremiumIcon/><span>{importingSongId===song.id ? "ADDING…" : "ADD TO LIBRARY"}</span></motion.button> : null}<motion.button whileTap={{scale:.96}} className="is-delete" onClick={() => void (async()=>{ if (!window.confirm(`Delete ${song.artist} - ${song.title} from Audition history? This will not delete the music-library file.`)) return; stopPreview(); await deleteMusicAuditionSong(song.id); refresh(); })()}><span className="m38-deleteX">×</span><span>DELETE</span></motion.button></div></motion.article>; })}</div>}</section> : null}

    {importOpen ? <div className="mvp-auditionModalBackdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setImportOpen(false); }}>
      <section className="mvp-auditionModal">
        <header><div><span>NEW AUDITION LIST</span><h3>Import songs to audition</h3></div><button onClick={() => setImportOpen(false)}>×</button></header>
        <label><span>LIST NAME</span><input value={importName} onChange={(event) => setImportName(event.target.value)} placeholder="Octane Top 100 - August 2026" /></label>
        <label><span>SONGS</span><textarea value={importText} onChange={(event) => setImportText(event.target.value)} placeholder={'Three Days Grace - Mayday\nBreaking Benjamin - Awaken\nArtist - Song'} /></label>
        <div className="mvp-auditionImportHint"><b>{parsedImportCount}</b><span>SONGS</span></div>
        {importError ? <p className="mvp-auditionError">{importError}</p> : null}
        <footer><button onClick={() => setImportOpen(false)}>CANCEL</button><button className="is-import" disabled={!parsedImportCount} onClick={submitImport}>IMPORT {parsedImportCount || ""} SONG{parsedImportCount === 1 ? "" : "S"}</button></footer>
      </section>
    </div> : null}

    {mergeSourceId ? <div className="mvp-auditionModalBackdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setMergeSourceId(null); }}>
      <section className="mvp-auditionModal is-small"><header><div><span>MERGE LIST</span><h3>Choose destination</h3></div><button onClick={() => setMergeSourceId(null)}>×</button></header><div className="mvp-auditionMergeTargets">{state.lists.filter((list) => list.id !== mergeSourceId).map((list) => <button key={list.id} onClick={() => mergeInto(list.id)}><strong>{list.name}</strong><span>{list.songIds.length} songs</span></button>)}</div></section>
    </div> : null}

    
  </section>;
}
