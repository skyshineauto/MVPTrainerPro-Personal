import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
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
const METADATA_CACHE_MS = 7 * 86400000;
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

function fullArtistKey(value: unknown) {
  return normalize(clean(value)
    .replace(/\s+(?:feat(?:uring)?|ft)\.?\s+/gi, " & ")
    .replace(/\s+with\s+/gi, " & ")
    .replace(/\s+x\s+/gi, " & "));
}

function strictTitleKey(value: unknown) {
  return canonicalTitle(value)
    .replace(/\b(?:feat(?:uring)?|ft)\b.*$/i, "")
    .replace(/\((?:feat(?:uring)?|ft|remaster(?:ed)?|radio edit|single version|album version|live|deluxe|bonus track|reissue|acoustic|sped up|slowed|instrumental)[^)]*\)/gi, " ")
    .replace(/\[(?:feat(?:uring)?|ft|remaster(?:ed)?|radio edit|single version|album version|live|deluxe|bonus track|reissue|acoustic|sped up|slowed|instrumental)[^\]]*\]/gi, " ")
    .replace(/\b(?:official audio|official video|lyric video|visualizer)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isContainedMatch(left: string, right: string) {
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  return shorter.length >= 5 && longer.includes(shorter);
}

function titleMatchScore(imported: string, candidate: string) {
  if (!imported || !candidate) return 0;
  if (imported === candidate || compactKey(imported) === compactKey(candidate)) return 1;
  const token = tokenSimilarity(imported, candidate);
  const contained = isContainedMatch(imported, candidate) ? 0.9 : 0;
  return Math.max(token, contained);
}

function artistMatchScore(importedValue: unknown, candidateValue: unknown) {
  const importedLead = leadArtist(importedValue);
  const candidateLead = leadArtist(candidateValue);
  const importedFull = fullArtistKey(importedValue);
  const candidateFull = fullArtistKey(candidateValue);
  if (!importedLead || !candidateLead) return 0;
  if (importedLead === candidateLead || compactKey(importedLead) === compactKey(candidateLead)) return 1;
  const leadToken = tokenSimilarity(importedLead, candidateLead);
  const fullToken = tokenSimilarity(importedFull, candidateFull);
  const contained = isContainedMatch(importedLead, candidateLead) ? 0.92 : 0;
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
  const titleScore = titleMatchScore(importedTitle, candidateTitle);
  const artistScore = artistMatchScore(song.artist, item.artistName);

  // Artist is never optional. A common song title must never attach to the wrong band.
  if (artistScore < 0.72 || titleScore < 0.76) return null;

  // Exact/near-exact artist matters a little more for short or common titles.
  const score = titleScore * 0.68 + artistScore * 0.32;
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
    limit: "50",
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
      .filter((item): item is PreviewCandidate => Boolean(item));
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
    script.src = `https://api.deezer.com/search?limit=50&output=jsonp&callback=${encodeURIComponent(callbackName)}&q=${encodeURIComponent(term)}`;
    document.head.appendChild(script);
  });
}

function metadataQueries(song: MusicAuditionSong) {
  const artist = clean(song.artist).replace(/\s+(?:feat(?:uring)?|ft)\.?\s+.*$/i, "");
  const title = clean(song.title)
    .replace(/\s*[-–—]\s*(?:remaster(?:ed)?|radio edit|single version|album version|live|official.*)$/i, "")
    .trim();
  const rows: Array<{ term: string; attribute?: "songTerm" | "artistTerm" }> = [
    { term: `${artist} ${title}` },
    { term: `${title} ${artist}` },
    { term: title, attribute: "songTerm" },
    { term: artist, attribute: "artistTerm" },
  ];
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.attribute || "all"}|${normalize(row.term)}`;
    if (!row.term || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
  const withPreview = ranked.filter((row) => Boolean(row.item.previewUrl)).slice(0, 5);
  if (!withPreview.length) return null;

  const probes = await Promise.all(
    withPreview.map(async (row) => ({
      row,
      playable: await probePreviewUrl(row.item.previewUrl || ""),
    })),
  );
  return probes.find((entry) => entry.playable)?.row || null;
}

function previewProviderLabel(url: string | null) {
  const value = clean(url).toLowerCase();
  if (!value) return "NO SAMPLE";
  if (value.includes("dzcdn") || value.includes("deezer")) return "DEEZER SAMPLE";
  if (value.includes("apple") || value.includes("itunes")) return "APPLE SAMPLE";
  return "VERIFIED SAMPLE";
}

export async function resolveMusicAuditionMetadata(songId: string) {
  const state = readLocal();
  const song = state.songs.find((item) => item.id === songId);
  if (!song) throw new Error("Song not found.");

  const existing = metadataRequests.get(songId);
  if (existing) return existing;

  const request = (async () => {
    try {
      // Reuse a working cached preview immediately. If it died, continue into the full resolver.
      if (song.previewUrl && await probePreviewUrl(song.previewUrl)) return song;

      const queries = metadataQueries(song);
      const primaryTerm = queries[0]?.term || `${song.artist} ${song.title}`;
      const reverseTerm = queries[1]?.term || `${song.title} ${song.artist}`;

      // First wave: the two strongest catalogs/searches. This keeps normal matches fast.
      const firstWave = await Promise.all([
        fetchAppleCandidates(primaryTerm, "US"),
        fetchAppleCandidates(reverseTerm, "US"),
        fetchDeezerCandidates(primaryTerm),
      ]);

      let combined = mergeCandidates(firstWave);
      let ranked = rankedCandidates(song, combined);
      let metadataBest = ranked[0] || null;
      let playableBest = await firstPlayableCandidate(ranked);

      // Second wave only when the first wave did not produce a playable sample.
      if (!playableBest) {
        const secondWave = await Promise.all([
          fetchAppleCandidates(primaryTerm, "GB"),
          fetchAppleCandidates(primaryTerm, "CA"),
          fetchAppleCandidates(primaryTerm, "AU"),
          queries[2] ? fetchAppleCandidates(queries[2].term, "US", queries[2].attribute) : Promise.resolve([] as PreviewCandidate[]),
          fetchDeezerCandidates(reverseTerm),
        ]);
        combined = mergeCandidates([combined, ...secondWave]);
        ranked = rankedCandidates(song, combined);
        metadataBest = ranked[0] || metadataBest;
        playableBest = await firstPlayableCandidate(ranked);
      }

      if (!metadataBest || metadataBest.score < 0.78) {
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
            artworkUrl: metadataItem.artworkUrl || previewItem?.artworkUrl || null,
            previewUrl: previewItem?.previewUrl || null,
            storeUrl: previewItem?.storeUrl || metadataItem.storeUrl || null,
            metadataUpdatedAt: now(),
            updatedAt: now(),
          };
          return changed;
        }),
      }));
      if (changed) void persistSong(changed);
      return changed || song;
    } catch {
      // Keep the imported identity, but never keep weak/wrong provider metadata.
      let changed: MusicAuditionSong | null = null;
      mutateLocal((current) => ({
        ...current,
        songs: current.songs.map((item) => {
          if (item.id !== songId) return item;
          changed = {
            ...item,
            album: "",
            releaseYear: null,
            genre: null,
            artworkUrl: null,
            previewUrl: null,
            storeUrl: null,
            metadataUpdatedAt: now(),
            updatedAt: now(),
          };
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

type AuditionView = "lists" | "audition" | "kept";
type ListSort = "newest" | "name" | "progress" | "most_kept";

type Props = {
  tracks: MusicTrack[];
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


function PreviewGlyph({ stop = false }: { stop?: boolean }) {
  return <svg className="mvp-svg mvp-svgPreview" viewBox="0 0 42 28" aria-hidden="true" fill="none">
    <path d="M2 14h3M7 9v10M11 5v18M15 8v12M19 11v6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    {stop
      ? <><rect x="27" y="7" width="4" height="14" rx="1" fill="currentColor" /><rect x="34" y="7" width="4" height="14" rx="1" fill="currentColor" /></>
      : <path d="M27 5.5 39 14 27 22.5V5.5Z" fill="currentColor" />}
  </svg>;
}

function YouTubeGlyph() {
  return <svg className="mvp-svg mvp-svgYoutube" viewBox="0 0 40 28" aria-hidden="true">
    <path fill="#ff1938" d="M38.5 6.1a5.1 5.1 0 0 0-3.6-3.6C31.7 1.6 20 1.6 20 1.6S8.3 1.6 5.1 2.5A5.1 5.1 0 0 0 1.5 6.1C.6 9.3.6 14 .6 14s0 4.7.9 7.9a5.1 5.1 0 0 0 3.6 3.6c3.2.9 14.9.9 14.9.9s11.7 0 14.9-.9a5.1 5.1 0 0 0 3.6-3.6c.9-3.2.9-7.9.9-7.9s0-4.7-.9-7.9Z"/>
    <path fill="#fff" d="m16.2 20.1 9.9-6.1-9.9-6.1v12.2Z"/>
  </svg>;
}

function KeepGlyph() {
  return <svg className="mvp-svg mvp-svgKeep" viewBox="0 0 36 28" aria-hidden="true" fill="none">
    <path d="M3 15.5 11.3 24 33 3.5" stroke="currentColor" strokeWidth="3.1" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M7 15.2 12 20.3" stroke="rgba(255,255,255,.55)" strokeWidth="1.1" strokeLinecap="round"/>
  </svg>;
}

function MaybeGlyph() {
  return <svg className="mvp-svg mvp-svgMaybe" viewBox="0 0 32 32" aria-hidden="true" fill="none">
    <path d="M7.3 10.2c.8-4.1 4.1-6.4 8.8-6.4 5.3 0 8.8 3.1 8.8 7.6 0 6.3-7.2 6.3-7.2 11.1" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round"/>
    <path d="M17.7 28.2h.1" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/>
  </svg>;
}

function PassGlyph() {
  return <svg className="mvp-svg mvp-svgPass" viewBox="0 0 32 32" aria-hidden="true" fill="none">
    <path d="M5 5 27 27M27 5 5 27" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round"/>
    <path d="M8.5 4.5 27.5 23.5" stroke="rgba(255,255,255,.22)" strokeWidth=".9" strokeLinecap="round"/>
  </svg>;
}

function UploadGlyph() {
  return <svg className="mvp-svg mvp-svgUpload" viewBox="0 0 36 30" aria-hidden="true" fill="none">
    <path d="M18 20V3m0 0-6 6m6-6 6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M5 19v7h26v-7" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round"/>
    <path d="M10 26h16" stroke="rgba(255,255,255,.3)" strokeWidth="1"/>
  </svg>;
}

function MoreGlyph() {
  return <svg className="mvp-svg mvp-svgMore" viewBox="0 0 36 12" aria-hidden="true" fill="currentColor">
    <rect x="2" y="5" width="7" height="2" rx="1"/><rect x="14.5" y="5" width="7" height="2" rx="1"/><rect x="27" y="5" width="7" height="2" rx="1"/>
  </svg>;
}

function ChevronGlyph({ direction }: { direction: "left" | "right" }) {
  return <svg className="mvp-svg mvp-svgChevron" viewBox="0 0 20 32" aria-hidden="true" fill="none">
    <path d={direction === "left" ? "M15.5 4 4 16l11.5 12" : "M4.5 4 16 16 4.5 28"} stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>;
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
  const [verifiedMetadataIds, setVerifiedMetadataIds] = useState<Set<string>>(() => new Set());
  const verifiedMetadataIdsRef = useRef<Set<string>>(new Set());
  const [decisionFlash, setDecisionFlash] = useState<{ songId: string; decision: Exclude<AuditionDecision, null> } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const decisionTimerRef = useRef<number | null>(null);
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
  const keptInLibraryCount = allKeptSongs.length - keptSongs.length;

  const sortedLists = useMemo(() => {
    const rows = [...state.lists];
    if (listSort === "name") return rows.sort((a, b) => a.name.localeCompare(b.name));
    if (listSort === "progress") return rows.sort((a, b) => listStats(b, songsById, isInLibraryFast).progress - listStats(a, songsById, isInLibraryFast).progress || b.updatedAt - a.updatedAt);
    if (listSort === "most_kept") return rows.sort((a, b) => listStats(b, songsById, isInLibraryFast).keep - listStats(a, songsById, isInLibraryFast).keep || b.updatedAt - a.updatedAt);
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  }, [state.lists, songsById, isInLibraryFast, listSort]);
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
    const freshCached = Boolean(
      currentSong.metadataUpdatedAt &&
      now() - currentSong.metadataUpdatedAt < METADATA_CACHE_MS &&
      (currentSong.artworkUrl || currentSong.previewUrl || currentSong.album),
    );

    if (verifiedMetadataIds.has(songId)) return;
    if (verifiedMetadataIdsRef.current.has(songId) || freshCached) {
      verifiedMetadataIdsRef.current.add(songId);
      setVerifiedMetadataIds((previous) => {
        if (previous.has(songId)) return previous;
        const next = new Set(previous);
        next.add(songId);
        return next;
      });
      return;
    }

    setLookupSongId(songId);
    void resolveMusicAuditionMetadata(songId)
      .then(() => {
        verifiedMetadataIdsRef.current.add(songId);
        setVerifiedMetadataIds((previous) => {
          if (previous.has(songId)) return previous;
          const next = new Set(previous);
          next.add(songId);
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
        const freshCached = Boolean(
          song.metadataUpdatedAt &&
          now() - song.metadataUpdatedAt < METADATA_CACHE_MS &&
          (song.artworkUrl || song.previewUrl || song.album),
        );
        if (freshCached || verifiedMetadataIdsRef.current.has(song.id)) {
          verifiedMetadataIdsRef.current.add(song.id);
          continue;
        }
        void resolveMusicAuditionMetadata(song.id).then(() => {
          verifiedMetadataIdsRef.current.add(song.id);
        });
      }
    }, 80);
    return () => window.clearTimeout(timer);
  }, [currentSong?.id, currentIndex, selectedSongs]);


  function openList(list: MusicAuditionList) {
    stopPreview();
    setSelectedListId(list.id);
    setCurrentIndex(0);
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
    if (!resolved.previewUrl || !verifiedMetadataIds.has(song.id)) {
      setLookupSongId(song.id);
      resolved = await resolveMusicAuditionMetadata(song.id);
      setVerifiedMetadataIds((previous) => {
        const next = new Set(previous);
        next.add(song.id);
        return next;
      });
      setLookupSongId(null);
    }
    if (!resolved.previewUrl) {
      setMessage("No playable embedded sample was found across Apple and Deezer for this exact artist/title. YouTube is still available for the full song.");
      return;
    }
    onPreviewStart?.();
    const audio = new Audio(resolved.previewUrl);
    audio.preload = "auto";
    audio.volume = 0.95;
    audio.onended = () => setPreviewSongId(null);
    audio.onerror = () => {
      setPreviewSongId(null);
      setVerifiedMetadataIds((previous) => {
        const next = new Set(previous);
        next.delete(song.id);
        return next;
      });
      setMessage("That sample expired or failed. MVP will search the other preview sources the next time you press Preview.");
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

  function decide(song: MusicAuditionSong, decision: Exclude<AuditionDecision, null>) {
    if (decisionFlash) return;
    stopPreview();
    setMessage("");
    setDecisionFlash({ songId: song.id, decision });
    if (decisionTimerRef.current) window.clearTimeout(decisionTimerRef.current);
    decisionTimerRef.current = window.setTimeout(() => {
      setMusicAuditionDecision(song.id, decision);
      setDecisionFlash(null);
      decisionTimerRef.current = null;
    }, 110);
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

  const globalCounts = useMemo(() => {
    const candidates = state.songs.filter((song) => !isInLibraryFast(song));
    return {
      keep: candidates.filter((song) => song.decision === "keep").length,
      pass: candidates.filter((song) => song.decision === "pass").length,
      maybe: candidates.filter((song) => song.decision === "maybe").length,
      reviewed: candidates.filter((song) => Boolean(song.decision)).length,
    };
  }, [state.songs, isInLibraryFast]);

  const currentMetadataVerified = Boolean(currentSong && verifiedMetadataIds.has(currentSong.id));
  const currentMetadataAvailable = Boolean(
    currentSong &&
    currentMetadataVerified &&
    (currentSong.artworkUrl || currentSong.previewUrl || currentSong.album),
  );
  const currentPreviewReady = Boolean(currentSong?.previewUrl && currentMetadataVerified);
  const currentFlashDecision = currentSong && decisionFlash?.songId === currentSong.id ? decisionFlash.decision : null;
  const currentRemaining = currentStats ? Math.max(0, currentStats.total - currentStats.reviewed) : 0;

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
          const stats = listStats(list, songsById, isInLibraryFast);
          const percent = stats.total ? Math.round(stats.progress * 100) : stats.skipped ? 100 : 0;
          return <article key={list.id} className="mvp-auditionListCard">
            <header>
              <div className="mvp-auditionListIcon">♫</div>
              <div className="mvp-auditionListTitle">
                {renameListId === list.id ? <div className="mvp-auditionRename"><input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") saveRename(); if (event.key === "Escape") setRenameListId(null); }} /><button onClick={saveRename}>SAVE</button><button onClick={() => setRenameListId(null)}>CANCEL</button></div> : <><h3>{list.name}</h3><small>CREATED {dateLabel(list.createdAt).toUpperCase()}</small></>}
              </div>
              <b className="mvp-auditionPercent">{percent}%</b>
            </header>
            <div className="mvp-auditionProgress"><i style={{ width: `${percent}%` }} /></div>
            {stats.skipped ? <div className="mvp-auditionPreflight"><span>✓ {stats.skipped} ALREADY IN MVP</span><small>Skipped automatically • {stats.total} candidate{stats.total === 1 ? "" : "s"} remain</small></div> : null}
            <div className="mvp-auditionListStats"><span><b>{stats.reviewed}</b> / {stats.total}<small>REVIEWED</small></span><span className="is-keep"><b>{stats.keep}</b><small>KEEP</small></span><span className="is-maybe"><b>{stats.maybe}</b><small>MAYBE</small></span><span className="is-pass"><b>{stats.pass}</b><small>PASS</small></span></div>
            <footer><button className="is-open" disabled={!stats.total} onClick={() => openList(list)}>▶ {stats.total ? (stats.reviewed ? "CONTINUE" : "START") : "ALL IN MVP"}</button><button onClick={() => startRename(list)}>RENAME</button><button onClick={() => duplicateList(list)}>DUPLICATE</button><button onClick={() => setMergeSourceId(list.id)} disabled={state.lists.length < 2}>MERGE</button><button className="is-danger" onClick={() => void deleteList(list)}>DELETE</button></footer>
          </article>;
        })}
      </div>}
    </> : null}

    {view === "audition" && selectedList && currentStats ? <div className="mvp-auditionStage">
      <header className="mvp-auditionStageHead">
        <button onClick={() => { stopPreview(); setView("lists"); }}>‹ LISTS</button>
        <div><span>NOW AUDITIONING</span><h3>{selectedList.name}</h3></div>
        <div className="mvp-auditionStageProgress"><b>{currentRemaining}</b><span>LEFT TO AUDITION</span><small>{currentStats.keep} KEPT • {currentStats.maybe} MAYBE • {currentStats.pass} PASSED{currentStats.skipped ? ` • ${currentStats.skipped} IN MVP` : ""}</small></div>
      </header>
      <div className="mvp-auditionStageBar"><i style={{ width: `${currentStats.total ? Math.round(currentStats.progress * 100) : currentStats.skipped ? 100 : 0}%` }} /></div>
      {currentSong ? <article className={`mvp-auditionSongCard ${currentMetadataVerified && currentSong.artworkUrl ? "has-art" : "no-art"}`}>
        <div className="mvp-auditionAmbient" aria-hidden="true" style={currentMetadataVerified && currentSong.artworkUrl ? { backgroundImage: `url("${currentSong.artworkUrl}")` } : undefined} />
        <div className="mvp-auditionArtwork">
          {currentMetadataVerified && currentSong.artworkUrl ? <img src={currentSong.artworkUrl} alt="" /> : <div className="mvp-auditionArtworkFallback"><div className="mvp-auditionWave" aria-hidden="true"><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/></div><b>{currentSong.artist.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</b><small>{lookupSongId === currentSong.id ? "SEARCHING APPLE + DEEZER" : currentMetadataVerified ? "NO ART FOUND" : "ARTWORK SEARCH"}</small></div>}
          <span>{currentIndex + 1}<small>/ {selectedSongs.length}</small></span>
        </div>
        <div className="mvp-auditionSongInfo">
          <div className="mvp-auditionStatusRow">
            <span className={`is-${currentFlashDecision || "new"}`}>{currentFlashDecision ? `${decisionLabel(currentFlashDecision)} SELECTED` : "READY"}</span>
            {lookupSongId === currentSong.id
              ? <span className="is-source">SEARCHING APPLE + DEEZER</span>
              : currentPreviewReady
                ? <span className="is-verified">✓ {previewProviderLabel(currentSong.previewUrl)}</span>
                : <span className="is-source">YOUTUBE READY</span>}
          </div>
          <h2>{currentSong.title}</h2>
          <h3>{currentSong.artist}</h3>
          <p className="mvp-auditionMeta">
            {lookupSongId === currentSong.id
              ? "Checking multiple preview catalogs and validating playable audio…"
              : currentPreviewReady
                ? [previewProviderLabel(currentSong.previewUrl), currentSong.album, currentSong.releaseYear].filter(Boolean).join(" • ")
                : currentMetadataAvailable
                  ? "Artwork matched, but no playable embedded sample survived verification. Use YouTube for the full song."
                  : "No playable embedded sample found yet. YouTube always searches the exact imported artist and title."}
          </p>
          <div className="mvp-auditionActionLabel"><span>LISTEN</span><i /></div>
          <div className="mvp-auditionListen">
            <button
              className={`is-preview ${previewSongId === currentSong.id ? "is-playing" : ""} ${!currentPreviewReady && lookupSongId !== currentSong.id ? "is-unavailable" : ""}`}
              disabled={lookupSongId === currentSong.id || (!currentPreviewReady && currentMetadataVerified)}
              onClick={() => void togglePreview(currentSong)}
            >
              <span className="mvp-auditionControlIcon"><PreviewGlyph stop={previewSongId === currentSong.id} /></span>
              <span className="mvp-auditionControlCopy">
                <strong>{lookupSongId === currentSong.id ? "SEARCHING" : previewSongId === currentSong.id ? "STOP PREVIEW" : currentPreviewReady ? "PREVIEW" : "NO SAMPLE"}</strong>
                <small>{lookupSongId === currentSong.id ? "Apple + Deezer" : currentPreviewReady ? previewProviderLabel(currentSong.previewUrl) : "Use YouTube"}</small>
              </span>
            </button>
            <button className="is-youtube" onClick={() => openYoutube(currentSong)}>
              <span className="mvp-auditionControlIcon"><YouTubeGlyph /></span>
              <span className="mvp-auditionControlCopy"><strong>YOUTUBE</strong><small>Exact full-song search</small></span>
            </button>
          </div>
          <div className="mvp-auditionActionLabel is-decision"><span>YOUR DECISION</span><i /></div>
          <div className="mvp-auditionDecision">
            <button aria-pressed={currentFlashDecision === "keep"} disabled={Boolean(decisionFlash)} className={`is-keep ${currentFlashDecision === "keep" ? "is-active" : ""}`} onClick={() => decide(currentSong, "keep")}><span className="mvp-auditionDecisionIcon"><KeepGlyph /></span><span><strong>{currentFlashDecision === "keep" ? "KEEP SELECTED" : "KEEP"}</strong><small>{currentFlashDecision === "keep" ? "Saved" : "Save to winners"}</small></span></button>
            <button aria-pressed={currentFlashDecision === "maybe"} disabled={Boolean(decisionFlash)} className={`is-maybe ${currentFlashDecision === "maybe" ? "is-active" : ""}`} onClick={() => decide(currentSong, "maybe")}><span className="mvp-auditionDecisionIcon"><MaybeGlyph /></span><span><strong>{currentFlashDecision === "maybe" ? "MAYBE SELECTED" : "MAYBE"}</strong><small>{currentFlashDecision === "maybe" ? "Saved" : "Revisit later"}</small></span></button>
            <button aria-pressed={currentFlashDecision === "pass"} disabled={Boolean(decisionFlash)} className={`is-pass ${currentFlashDecision === "pass" ? "is-active" : ""}`} onClick={() => decide(currentSong, "pass")}><span className="mvp-auditionDecisionIcon"><PassGlyph /></span><span><strong>{currentFlashDecision === "pass" ? "PASS SELECTED" : "PASS"}</strong><small>{currentFlashDecision === "pass" ? "Saved" : "Reject candidate"}</small></span></button>
          </div>
          <div className="mvp-auditionPager">
            <button className="is-prev" disabled={currentIndex <= 0} onClick={() => { stopPreview(); setCurrentIndex((index) => Math.max(0, index - 1)); }}><ChevronGlyph direction="left" /><span>PREVIOUS</span></button>
            <span><b>{selectedSongs.length}</b><small>UNREVIEWED LEFT</small></span>
            <button className="is-next-unreviewed" onClick={nextUnreviewed}><span>NEXT UNREVIEWED</span><ChevronGlyph direction="right" /></button>
          </div>
        </div>
      </article> : <div className="mvp-auditionEmpty"><b>{currentStats.total === 0 && currentStats.skipped ? "EVERY TRACK IS ALREADY IN MVP" : currentRemaining === 0 ? "AUDITION COMPLETE" : "THIS LIST IS EMPTY"}</b><span>{currentStats.total === 0 && currentStats.skipped ? `${currentStats.skipped} imported track${currentStats.skipped === 1 ? "" : "s"} were recognized in your music library and skipped automatically.` : currentRemaining === 0 ? `${currentStats.keep} kept • ${currentStats.maybe} maybe • ${currentStats.pass} passed${currentStats.skipped ? ` • ${currentStats.skipped} already in MVP` : ""}.` : ""}</span></div>}
      <footer className="mvp-auditionCounts"><span className="is-keep"><b>{currentStats.keep}</b> KEEP</span><span className="is-pass"><b>{currentStats.pass}</b> PASS</span><span className="is-maybe"><b>{currentStats.maybe}</b> MAYBE</span><span><b>{currentRemaining}</b> LEFT TO AUDITION</span></footer>
    </div> : null}

    {view === "kept" ? <div className="mvp-auditionKept">
      <header><div><span>APPROVED MUSIC</span><h3>Kept Songs</h3><p>Only songs still waiting to be added to MVP stay here.{keptInLibraryCount ? ` ${keptInLibraryCount} previously kept song${keptInLibraryCount === 1 ? " is" : "s are"} already in your library and hidden.` : ""}</p></div><b>{keptSongs.length}</b></header>
      {!keptSongs.length ? <div className="mvp-auditionEmpty"><b>{keptInLibraryCount ? "ALL KEPT SONGS ARE IN MVP" : "NO KEEPERS YET"}</b><span>{keptInLibraryCount ? "Your staging queue is clear." : "Hit KEEP while auditioning and your winners will collect here."}</span></div> : <div className="mvp-auditionKeptGrid">
        {keptSongs.map((song) => {
          const sources = musicAuditionSongSources(song.id, state.lists);
          return <article key={song.id}>
            <div className="mvp-keptAmbient" aria-hidden="true" style={song.artworkUrl ? { backgroundImage: `url("${song.artworkUrl}")` } : undefined} />
            <div className="mvp-auditionKeptArt">{song.artworkUrl ? <img src={song.artworkUrl} alt="" /> : <span>♫</span>}</div>
            <div className="mvp-auditionKeptInfo"><small>🔥 READY TO ADD</small><strong>{song.title}</strong><b>{song.artist}</b><p>{sources.length ? `FROM ${sources.map((list) => list.name).join(" • ")}` : "KEPT FROM AUDITION"}</p></div>
            <div className="mvp-auditionKeptActions">
              <button className="mvp-keptAction is-preview" onClick={() => void togglePreview(song)}>
                <span className="mvp-keptActionIcon"><PreviewGlyph stop={previewSongId === song.id} /></span>
                <span><strong>{previewSongId === song.id ? "STOP" : "PREVIEW"}</strong><small>{song.previewUrl ? previewProviderLabel(song.previewUrl) : "Find sample"}</small></span>
              </button>
              <button className="mvp-keptAction is-youtube" onClick={() => openYoutube(song)}>
                <span className="mvp-keptActionIcon"><YouTubeGlyph /></span>
                <span><strong>YOUTUBE</strong><small>Full song</small></span>
              </button>
              {onImportFile ? <button className="mvp-keptAction is-add" disabled={importingSongId === song.id} onClick={() => requestSongImport(song)}>
                <span className="mvp-keptActionIcon"><UploadGlyph /></span>
                <span><strong>{importingSongId === song.id ? "ADDING…" : "ADD TO MVP"}</strong><small>Import audio</small></span>
              </button> : null}
              <details className="mvp-keptMore">
                <summary aria-label={`More actions for ${song.title}`}><MoreGlyph /></summary>
                <div><button onClick={() => { setMusicAuditionDecision(song.id, null); refresh(); }}>REMOVE FROM KEPT</button></div>
              </details>
            </div>
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

      /* MVP_TRAINER_V5_R12_5E_9_AUDITION_PREMIUM */
      .mvp-audition{
        --aud-cyan:#45d8ff;
        --aud-cyan2:#10a7d7;
        --aud-orange:#ff9f24;
        --aud-green:#43e69a;
        --aud-amber:#ffc05a;
        --aud-red:#ff5e68;
        color:#edf9fd;
      }
      .mvp-auditionHero{
        position:relative;overflow:hidden;
        padding:18px 19px;
        border-bottom:1px solid rgba(79,190,225,.16);
        background:
          radial-gradient(700px 180px at 8% -30%,rgba(41,206,255,.16),transparent 62%),
          radial-gradient(420px 180px at 92% 130%,rgba(255,151,30,.08),transparent 70%),
          linear-gradient(180deg,#071820 0%,#051117 100%);
      }
      .mvp-auditionHero:after{content:"";position:absolute;inset:auto 0 0;height:1px;background:linear-gradient(90deg,transparent,rgba(64,214,255,.65),rgba(255,158,36,.38),transparent);opacity:.65}
      .mvp-auditionHero h2{font-size:30px!important;letter-spacing:-.045em!important;text-shadow:0 4px 24px rgba(0,0,0,.36)}
      .mvp-auditionHero p{max-width:680px!important;color:#8ea8b2!important;font-size:9px!important;font-weight:750!important}
      .mvp-auditionGlobal>div{
        min-width:70px!important;min-height:58px!important;
        border:1px solid rgba(92,185,217,.13)!important;border-radius:11px!important;
        background:linear-gradient(180deg,rgba(8,27,35,.92),rgba(4,13,18,.96))!important;
        box-shadow:inset 0 1px rgba(255,255,255,.025),0 10px 24px rgba(0,0,0,.18)!important;
      }
      .mvp-auditionGlobal>div b{font-size:21px!important;color:#f5fcff!important}
      .mvp-auditionGlobal>div span{font-size:6px!important;letter-spacing:.13em!important}
      .mvp-auditionNav{
        padding:7px!important;gap:6px!important;
        border-bottom:1px solid rgba(73,166,198,.13)!important;
        background:#030b0f!important;
      }
      .mvp-auditionNav button{
        min-height:39px!important;padding:0 13px!important;
        border:1px solid rgba(91,171,198,.10)!important;border-radius:9px!important;
        background:linear-gradient(180deg,#081820,#051015)!important;
        color:#859da7!important;font-size:7.5px!important;font-weight:1000!important;letter-spacing:.08em!important;
        box-shadow:inset 0 1px rgba(255,255,255,.02)!important;
      }
      .mvp-auditionNav button:hover{color:#dff8ff!important;border-color:rgba(76,206,247,.28)!important;background:linear-gradient(180deg,#0a2632,#06161d)!important}
      .mvp-auditionNav button.is-active{
        color:#f4fcff!important;border-color:rgba(68,213,255,.42)!important;
        background:linear-gradient(180deg,#0c3443,#08222d)!important;
        box-shadow:inset 0 -2px var(--aud-cyan),0 0 18px rgba(49,197,239,.08)!important;
      }
      .mvp-auditionNav button.is-import{
        margin-left:auto!important;color:#071116!important;
        border-color:rgba(255,174,54,.86)!important;
        background:linear-gradient(180deg,#ffb13f,#e58109)!important;
        box-shadow:inset 0 1px rgba(255,255,255,.38),0 6px 18px rgba(229,129,9,.16)!important;
        text-shadow:0 1px rgba(255,255,255,.22)!important;
      }
      .mvp-auditionStage{
        overflow:hidden;border:1px solid rgba(77,183,217,.18)!important;border-radius:15px!important;
        background:linear-gradient(180deg,#06141b,#030a0e)!important;
        box-shadow:0 18px 42px rgba(0,0,0,.20),inset 0 1px rgba(255,255,255,.02)!important;
      }
      .mvp-auditionStageHead{
        min-height:64px!important;padding:10px 13px!important;
        background:linear-gradient(180deg,rgba(8,26,34,.98),rgba(4,13,18,.98))!important;
      }
      .mvp-auditionStageHead>button{
        min-height:34px!important;border-radius:8px!important;border-color:rgba(95,178,208,.17)!important;
        background:#07151b!important;color:#a9c1ca!important;
      }
      .mvp-auditionStageHead h3{font-size:14px!important;color:#f5fbfe!important}
      .mvp-auditionStageProgress b{font-size:16px!important;color:#fff!important}
      .mvp-auditionStageBar{height:2px!important;background:#031017!important}
      .mvp-auditionStageBar i{background:linear-gradient(90deg,var(--aud-cyan),#79e7ff 58%,var(--aud-orange))!important;box-shadow:0 0 10px rgba(63,210,250,.42)!important}
      .mvp-auditionSongCard{
        position:relative;isolation:isolate;
        grid-template-columns:minmax(220px,300px) minmax(0,1fr)!important;
        gap:22px!important;padding:20px!important;
        border:0!important;border-radius:0!important;
        background:
          radial-gradient(600px 250px at 12% 16%,rgba(49,200,242,.085),transparent 62%),
          radial-gradient(500px 260px at 95% 95%,rgba(255,151,34,.045),transparent 68%),
          linear-gradient(145deg,#061319 0%,#03090d 72%)!important;
      }
      .mvp-auditionSongCard:before{
        content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;
        background:linear-gradient(115deg,rgba(255,255,255,.018),transparent 38%);
      }
      .mvp-auditionArtwork{
        width:100%!important;aspect-ratio:1/1!important;
        border:1px solid rgba(86,196,230,.21)!important;border-radius:16px!important;
        background:
          radial-gradient(circle at 32% 20%,rgba(71,217,255,.15),transparent 42%),
          linear-gradient(145deg,#0a2029,#040c10)!important;
        box-shadow:0 22px 48px rgba(0,0,0,.36),inset 0 1px rgba(255,255,255,.04),0 0 0 1px rgba(0,0,0,.35)!important;
      }
      .mvp-auditionArtwork img{filter:saturate(1.04) contrast(1.03)}
      .mvp-auditionArtworkFallback{position:absolute!important;inset:0!important;display:grid!important;place-content:center!important;gap:8px!important;text-align:center!important;color:#78ddfa!important}
      .mvp-auditionArtworkFallback>span{font-size:72px!important;line-height:1!important;opacity:.36!important;text-shadow:0 0 30px rgba(69,216,255,.16)}
      .mvp-auditionArtworkFallback>small{font-size:7px!important;font-weight:1000!important;letter-spacing:.16em!important;color:#708e99!important}
      .mvp-auditionArtwork>span{
        right:11px!important;bottom:11px!important;min-width:60px!important;height:32px!important;border-radius:9px!important;
        border-color:rgba(255,255,255,.16)!important;background:rgba(2,8,11,.88)!important;
        box-shadow:0 8px 20px rgba(0,0,0,.24)!important;
      }
      .mvp-auditionSongInfo{padding:4px 0!important}
      .mvp-auditionStatusRow{gap:6px!important;flex-wrap:wrap!important;margin-bottom:11px!important}
      .mvp-auditionStatusRow span,.mvp-auditionStatusRow b{min-height:23px!important;padding:0 8px!important;font-size:6px!important;border-radius:7px!important}
      .mvp-auditionStatusRow .is-source{color:#9bb5bf!important;border-color:rgba(126,168,183,.13)!important;background:#071219!important}
      .mvp-auditionStatusRow .is-verified{color:#77efb0!important;border-color:rgba(73,223,148,.26)!important;background:rgba(7,38,24,.82)!important}
      .mvp-auditionSongInfo h2{
        max-width:760px;margin:0!important;font-size:36px!important;line-height:1.02!important;letter-spacing:-.048em!important;
        color:#fff!important;text-wrap:balance;text-shadow:0 5px 24px rgba(0,0,0,.34)!important;
      }
      .mvp-auditionSongInfo h3{margin:7px 0 0!important;font-size:17px!important;color:#a9d7e6!important;letter-spacing:-.012em!important}
      .mvp-auditionMeta{
        min-height:20px;margin:9px 0 16px!important;color:#6f8a94!important;font-size:8px!important;font-weight:800!important;letter-spacing:.015em!important;
      }
      .mvp-auditionListen{grid-template-columns:1fr 1fr!important;gap:8px!important}
      .mvp-auditionListen button{
        min-height:54px!important;padding:0 14px!important;display:flex!important;align-items:center!important;justify-content:flex-start!important;gap:11px!important;
        border-radius:11px!important;border:1px solid rgba(76,200,240,.28)!important;
        background:linear-gradient(180deg,#0b2a36,#061820)!important;color:#eefbff!important;
        box-shadow:inset 0 1px rgba(255,255,255,.04),0 8px 18px rgba(0,0,0,.18)!important;
        text-align:left!important;cursor:pointer!important;
      }
      .mvp-auditionListen button:hover{transform:translateY(-1px);border-color:rgba(71,216,255,.52)!important;background:linear-gradient(180deg,#0d3645,#071e28)!important}
      .mvp-auditionListen button.is-playing{border-color:#6fe0ff!important;background:linear-gradient(180deg,#143f4d,#0a2530)!important;color:#fff!important;box-shadow:0 0 0 1px rgba(85,220,255,.12),0 0 22px rgba(59,202,242,.12)!important}
      .mvp-auditionListen button.is-youtube{
        border-color:rgba(255,82,94,.34)!important;background:linear-gradient(180deg,#2b1014,#15080a)!important;color:#ffd8dc!important;
      }
      .mvp-auditionListen button.is-youtube:hover{border-color:rgba(255,83,95,.58)!important;background:linear-gradient(180deg,#371318,#1a090c)!important}
      .mvp-auditionControlIcon{
        width:31px;height:31px;display:grid;place-items:center;flex:0 0 31px;
        border:1px solid rgba(255,255,255,.09);border-radius:999px;background:rgba(0,0,0,.22);
        color:#fff;font-size:12px;font-weight:1000;
      }
      .mvp-auditionControlCopy{display:grid;gap:2px!important}
      .mvp-auditionControlCopy strong{font-size:8px!important;letter-spacing:.09em!important}
      .mvp-auditionControlCopy small{color:#78949f!important;font-size:6.5px!important;font-weight:850!important;letter-spacing:.025em!important}
      .mvp-auditionListen .is-youtube .mvp-auditionControlCopy small{color:#a86e74!important}
      .mvp-auditionDecision{grid-template-columns:1.2fr 1fr 1fr!important;gap:8px!important;margin-top:9px!important}
      .mvp-auditionDecision button{
        min-height:59px!important;padding:0 12px!important;display:flex!important;align-items:center!important;justify-content:center!important;gap:10px!important;
        border-radius:11px!important;border:1px solid rgba(105,163,183,.12)!important;
        background:linear-gradient(180deg,#08171e,#050f14)!important;color:#8fa6af!important;
        box-shadow:inset 0 1px rgba(255,255,255,.022),0 7px 16px rgba(0,0,0,.14)!important;
        text-align:left!important;
      }
      .mvp-auditionDecision button>span:last-child{display:grid!important;gap:1px!important}
      .mvp-auditionDecision button strong{font-size:8px!important;letter-spacing:.12em!important}
      .mvp-auditionDecision button small{font-size:6px!important;color:#667f89!important;font-weight:800!important;letter-spacing:.02em!important}
      .mvp-auditionDecisionIcon{
        width:30px;height:30px;display:grid!important;place-items:center!important;flex:0 0 30px;
        border-radius:9px!important;background:rgba(0,0,0,.22)!important;font-size:15px!important;font-weight:1000!important;
      }
      .mvp-auditionDecision .is-keep{color:#76efad!important}
      .mvp-auditionDecision .is-keep:hover,.mvp-auditionDecision .is-keep.is-active{
        border-color:rgba(66,230,151,.46)!important;background:linear-gradient(180deg,#0a2d1d,#06170f)!important;
        box-shadow:inset 0 -2px rgba(67,230,154,.55),0 0 20px rgba(49,210,132,.09)!important;
      }
      .mvp-auditionDecision .is-maybe{color:#ffc766!important}
      .mvp-auditionDecision .is-maybe:hover,.mvp-auditionDecision .is-maybe.is-active{
        border-color:rgba(255,190,75,.42)!important;background:linear-gradient(180deg,#2b1d08,#140e05)!important;
        box-shadow:inset 0 -2px rgba(255,190,75,.48),0 0 18px rgba(237,166,44,.07)!important;
      }
      .mvp-auditionDecision .is-pass{color:#ff7e88!important}
      .mvp-auditionDecision .is-pass:hover,.mvp-auditionDecision .is-pass.is-active{
        border-color:rgba(255,88,101,.42)!important;background:linear-gradient(180deg,#2b0d12,#15070a)!important;
        box-shadow:inset 0 -2px rgba(255,83,98,.48),0 0 18px rgba(226,54,69,.07)!important;
      }
      .mvp-auditionPager{grid-template-columns:.9fr 1.2fr .9fr!important;gap:6px!important;margin-top:8px!important}
      .mvp-auditionPager button{
        min-height:37px!important;border-radius:9px!important;border-color:rgba(94,164,189,.12)!important;
        background:linear-gradient(180deg,#07151b,#040d11)!important;color:#839da7!important;font-size:6.5px!important;letter-spacing:.07em!important;
      }
      .mvp-auditionPager button:not(:disabled):hover{color:#dff8ff!important;border-color:rgba(74,200,240,.26)!important;background:#081d26!important}
      .mvp-auditionPager .is-next-unreviewed{color:#c7f2ff!important;border-color:rgba(63,198,239,.24)!important;background:linear-gradient(180deg,#0a2834,#061921)!important}
      .mvp-auditionCounts{
        min-height:39px!important;align-items:center!important;gap:18px!important;padding:8px 12px!important;
        border-top-color:rgba(82,170,200,.12)!important;background:#03090d!important;
      }
      @media(max-width:760px){.mvp-auditionHero{align-items:stretch;flex-direction:column;padding:14px}.mvp-auditionHero h2{font-size:24px}.mvp-auditionGlobal{grid-template-columns:repeat(4,minmax(0,1fr))}.mvp-auditionGlobal>div{min-height:50px}.mvp-auditionNav{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.mvp-auditionNav button.is-import{margin-left:0}.mvp-auditionToolbar{align-items:stretch;flex-direction:column}.mvp-auditionToolbar select{width:100%}.mvp-auditionLists{grid-template-columns:1fr}.mvp-auditionListStats{grid-template-columns:repeat(4,1fr)}.mvp-auditionListCard footer .is-danger{margin-left:0}.mvp-auditionSongCard{grid-template-columns:1fr;gap:15px;padding:13px}.mvp-auditionArtwork{width:min(100%,330px);justify-self:center}.mvp-auditionSongInfo h2{font-size:27px}.mvp-auditionListen{grid-template-columns:1fr 1fr}.mvp-auditionDecision button{min-height:67px}.mvp-auditionStageHead{grid-template-columns:auto 1fr}.mvp-auditionStageProgress{grid-column:1/-1;text-align:left;grid-template-columns:auto 1fr;gap:6px;align-items:center}.mvp-auditionKeptGrid>article{grid-template-columns:52px minmax(0,1fr)}.mvp-auditionKeptArt{width:52px;height:52px}.mvp-auditionKeptActions{grid-column:1/-1;justify-content:flex-start}.mvp-auditionModal textarea{height:230px}.mvp-auditionImportHint{grid-template-columns:auto 1fr}.mvp-auditionImportHint small{grid-column:1/-1;justify-self:start}.mvp-auditionCounts{flex-wrap:wrap}}

      /* Premium saved-list and empty-state surfaces */
      .mvp-auditionToolbar{padding:6px 3px 2px!important}
      .mvp-auditionToolbar strong{font-size:9px!important;letter-spacing:.05em!important;color:#eaf8fc!important}
      .mvp-auditionToolbar>div span{font-size:7.5px!important;color:#718b95!important}
      .mvp-auditionToolbar select{
        min-width:156px!important;height:38px!important;border-radius:9px!important;
        border-color:rgba(85,180,213,.17)!important;background:linear-gradient(180deg,#071820,#050e13)!important;
        color:#e0f0f5!important;
      }
      .mvp-auditionLists{gap:11px!important}
      .mvp-auditionListCard{
        position:relative;overflow:hidden;padding:14px!important;border-radius:14px!important;
        border-color:rgba(81,180,214,.16)!important;
        background:
          radial-gradient(350px 110px at 0% 0%,rgba(48,204,247,.08),transparent 70%),
          linear-gradient(155deg,#081820,#040c10 72%)!important;
        box-shadow:inset 0 1px rgba(255,255,255,.025),0 16px 34px rgba(0,0,0,.18)!important;
      }
      .mvp-auditionListCard:after{content:"";position:absolute;left:0;right:0;bottom:0;height:1px;background:linear-gradient(90deg,transparent,rgba(70,210,250,.28),transparent)}
      .mvp-auditionListIcon{
        border-radius:11px!important;border-color:rgba(71,207,249,.24)!important;
        background:linear-gradient(145deg,#103544,#07171e)!important;color:#75e5ff!important;
        box-shadow:inset 0 1px rgba(255,255,255,.04),0 8px 18px rgba(0,0,0,.16)!important;
      }
      .mvp-auditionListTitle h3{font-size:15px!important;letter-spacing:-.02em!important}
      .mvp-auditionPercent{font-size:20px!important;color:#7de5ff!important}
      .mvp-auditionProgress{height:3px!important;background:#07171e!important}
      .mvp-auditionListStats span{
        min-height:45px!important;border-radius:9px!important;border-color:rgba(103,168,190,.09)!important;
        background:rgba(3,11,15,.72)!important;
      }
      .mvp-auditionListCard footer button{
        min-height:33px!important;padding:0 10px!important;border-radius:8px!important;
        border-color:rgba(95,170,197,.12)!important;background:linear-gradient(180deg,#07161d,#050e13)!important;
        color:#9cb4bd!important;
      }
      .mvp-auditionListCard footer button:hover{color:#e5f8fe!important;border-color:rgba(74,199,239,.25)!important}
      .mvp-auditionListCard footer .is-open{
        color:#f1fcff!important;border-color:rgba(65,209,250,.35)!important;
        background:linear-gradient(180deg,#0b3140,#071e28)!important;
        box-shadow:inset 0 -2px rgba(65,213,255,.45)!important;
      }
      .mvp-auditionListCard footer .is-danger{color:#ff9299!important;background:linear-gradient(180deg,#1e0a0d,#100507)!important}
      .mvp-auditionEmpty{
        min-height:230px!important;border-style:solid!important;border-color:rgba(89,177,208,.12)!important;
        background:
          radial-gradient(420px 150px at 50% 10%,rgba(55,201,242,.07),transparent 66%),
          #040c10!important;
        box-shadow:inset 0 1px rgba(255,255,255,.018)!important;
      }
      .mvp-auditionEmpty b{font-size:10px!important;letter-spacing:.08em!important;color:#e9f7fb!important}
      .mvp-auditionEmpty span{font-size:7.5px!important;color:#718a94!important}
      .mvp-auditionEmpty button{
        min-height:38px!important;border-radius:9px!important;border-color:rgba(70,205,246,.32)!important;
        background:linear-gradient(180deg,#0b3342,#071d26)!important;color:#edfaff!important;
        box-shadow:inset 0 -2px rgba(62,208,250,.4)!important;
      }
      .mvp-auditionArtworkFallback{opacity:1!important}
      @media(max-width:760px){
        .mvp-auditionHero{border-radius:12px!important}
        .mvp-auditionHero h2{font-size:26px!important}
        .mvp-auditionNav{grid-template-columns:repeat(2,minmax(0,1fr))!important}
        .mvp-auditionNav button{min-height:42px!important}
        .mvp-auditionNav button.is-import{margin-left:0!important}
        .mvp-auditionSongCard{grid-template-columns:1fr!important;gap:14px!important;padding:12px!important}
        .mvp-auditionArtwork{width:min(100%,320px)!important;justify-self:center!important;border-radius:15px!important}
        .mvp-auditionSongInfo{padding:1px 2px 3px!important}
        .mvp-auditionSongInfo h2{font-size:27px!important}
        .mvp-auditionSongInfo h3{font-size:15px!important}
        .mvp-auditionListen{grid-template-columns:1fr 1fr!important}
        .mvp-auditionListen button{min-height:52px!important;padding:0 10px!important;gap:8px!important}
        .mvp-auditionControlIcon{width:28px;height:28px;flex-basis:28px}
        .mvp-auditionDecision{grid-template-columns:repeat(3,minmax(0,1fr))!important}
        .mvp-auditionDecision button{min-height:58px!important;padding:0 7px!important;gap:6px!important}
        .mvp-auditionDecisionIcon{width:27px;height:27px;flex-basis:27px}
        .mvp-auditionDecision button small{display:none!important}
        .mvp-auditionPager{grid-template-columns:1fr 1.35fr 1fr!important}
        .mvp-auditionPager button{min-height:38px!important;font-size:6px!important}
        .mvp-auditionStatusRow .is-source{display:none!important}
      }
      @media(max-width:420px){
        .mvp-auditionGlobal{grid-template-columns:repeat(2,minmax(0,1fr))!important}
        .mvp-auditionListen{grid-template-columns:1fr!important}
        .mvp-auditionDecision{grid-template-columns:1fr 1fr 1fr!important;gap:5px!important}
        .mvp-auditionDecision button{min-height:54px!important;display:grid!important;place-content:center!important;text-align:center!important}
        .mvp-auditionDecisionIcon{display:none!important}
        .mvp-auditionPager{grid-template-columns:1fr 1fr!important}
        .mvp-auditionPager .is-next-unreviewed{grid-column:1/-1;grid-row:1}
      }


      /* MVP AUDITION R12.5E.10 — premium discovery deck */
      .mvp-audition{--aud-cyan:#49d7ff;--aud-orange:#ffad35;--aud-green:#63f0a2;--aud-red:#ff626d;--aud-amber:#ffc65a;gap:10px!important}
      .mvp-auditionHero{
        position:relative;overflow:hidden;padding:17px 18px!important;border-radius:13px!important;
        border:1px solid rgba(75,196,235,.16)!important;
        background:linear-gradient(110deg,rgba(7,29,38,.98),rgba(3,10,14,.98) 66%)!important;
        box-shadow:inset 0 1px rgba(255,255,255,.025),0 12px 28px rgba(0,0,0,.16)!important;
      }
      .mvp-auditionHero:after{content:"";position:absolute;left:18px;right:18px;bottom:0;height:1px;background:linear-gradient(90deg,var(--aud-cyan),rgba(255,173,53,.72),transparent);opacity:.7}
      .mvp-auditionHero h2{font-size:27px!important;line-height:1!important;margin:5px 0 7px!important}
      .mvp-auditionHero p{font-size:10px!important;color:#91a9b2!important}
      .mvp-auditionGlobal{gap:12px!important;grid-template-columns:repeat(4,60px)!important}
      .mvp-auditionGlobal>div{min-height:48px!important;border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important;position:relative}
      .mvp-auditionGlobal>div:after{content:"";position:absolute;left:12px;right:12px;bottom:2px;height:2px;border-radius:2px;background:rgba(73,215,255,.18)}
      .mvp-auditionGlobal>div:nth-child(1):after{background:rgba(99,240,162,.55)}
      .mvp-auditionGlobal>div:nth-child(2):after{background:rgba(255,198,90,.55)}
      .mvp-auditionGlobal>div:nth-child(3):after{background:rgba(255,98,109,.5)}
      .mvp-auditionGlobal b{font-size:22px!important}
      .mvp-auditionGlobal span{font-size:7px!important;letter-spacing:.12em!important}
      .mvp-auditionNav{padding:4px!important;gap:4px!important;border-radius:10px!important;background:#030a0e!important}
      .mvp-auditionNav button{min-height:40px!important;border-radius:7px!important;font-size:8px!important;color:#b9ccd3!important}
      .mvp-auditionNav button.is-active{border-color:rgba(71,210,250,.42)!important;background:linear-gradient(180deg,#0b3544,#071d27)!important;box-shadow:inset 0 -3px #46d1f7,0 0 16px rgba(67,205,244,.06)!important}
      .mvp-auditionNav button.is-import{min-width:120px!important;color:#071014!important;background:linear-gradient(180deg,#ffbd52,#ee8d14)!important;border-color:#ffbc4d!important;box-shadow:inset 0 1px rgba(255,255,255,.35),0 5px 16px rgba(237,138,17,.14)!important}
      .mvp-auditionMessage{min-height:35px!important;padding:8px 11px!important;border-radius:8px!important;font-size:9px!important;color:#c7dce3!important;background:linear-gradient(180deg,#07161d,#041016)!important}

      .mvp-auditionStage{border:1px solid rgba(71,174,207,.14)!important;border-radius:14px!important;overflow:hidden!important;background:#030a0e!important;box-shadow:0 16px 34px rgba(0,0,0,.16)!important}
      .mvp-auditionStageHead{padding:12px 14px 10px!important;background:linear-gradient(180deg,#07161d,#040c11)!important}
      .mvp-auditionStageHead>button{min-height:34px!important;padding:0 10px!important;border-radius:8px!important;font-size:8px!important}
      .mvp-auditionStageHead>div:nth-child(2)>span{font-size:7px!important;letter-spacing:.15em!important}
      .mvp-auditionStageHead h3{font-size:15px!important;margin-top:3px!important}
      .mvp-auditionStageProgress b{font-size:18px!important}
      .mvp-auditionStageProgress span{font-size:6.5px!important}
      .mvp-auditionStageBar{height:3px!important}

      .mvp-auditionSongCard{
        position:relative!important;display:grid!important;grid-template-columns:minmax(210px,270px) minmax(0,1fr)!important;
        gap:22px!important;padding:18px!important;border:0!important;border-radius:0!important;
        background:
          radial-gradient(600px 260px at 12% 12%,rgba(42,195,239,.075),transparent 70%),
          linear-gradient(120deg,#06141b,#03090d 68%)!important;
        box-shadow:none!important;
      }
      .mvp-auditionSongCard.no-art{grid-template-columns:155px minmax(0,1fr)!important;gap:20px!important}
      .mvp-auditionArtwork{
        width:100%!important;aspect-ratio:1/1!important;min-height:0!important;border-radius:16px!important;
        border:1px solid rgba(86,194,228,.2)!important;background:linear-gradient(155deg,#0a2732,#06151c 68%)!important;
        box-shadow:inset 0 1px rgba(255,255,255,.04),0 16px 32px rgba(0,0,0,.22)!important;
      }
      .mvp-auditionSongCard.no-art .mvp-auditionArtwork{aspect-ratio:auto!important;height:188px!important;align-self:center!important}
      .mvp-auditionArtwork:after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(145deg,rgba(255,255,255,.045),transparent 35%,rgba(36,190,234,.035))}
      .mvp-auditionArtworkFallback{display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;gap:8px!important;padding:14px!important}
      .mvp-auditionArtworkFallback>b{font-size:24px!important;letter-spacing:.05em!important;color:#dff8ff!important;text-shadow:0 0 18px rgba(78,215,255,.17)}
      .mvp-auditionArtworkFallback>small{font-size:6.5px!important;letter-spacing:.14em!important;color:#6f929e!important}
      .mvp-auditionWave{height:55px;display:flex;align-items:center;justify-content:center;gap:4px}
      .mvp-auditionWave i{display:block;width:3px;height:14px;border-radius:6px;background:linear-gradient(180deg,#7ce7ff,#2abde7);box-shadow:0 0 8px rgba(67,205,242,.24);animation:mvpAuditionWave 1.15s ease-in-out infinite;transform-origin:center}
      .mvp-auditionWave i:nth-child(2),.mvp-auditionWave i:nth-child(10){animation-delay:-.8s}.mvp-auditionWave i:nth-child(3),.mvp-auditionWave i:nth-child(9){animation-delay:-.55s}.mvp-auditionWave i:nth-child(4),.mvp-auditionWave i:nth-child(8){animation-delay:-.25s}.mvp-auditionWave i:nth-child(5),.mvp-auditionWave i:nth-child(7){animation-delay:-.7s}.mvp-auditionWave i:nth-child(6){animation-delay:-.4s}
      @keyframes mvpAuditionWave{0%,100%{transform:scaleY(.45);opacity:.45}50%{transform:scaleY(2.7);opacity:1}}
      .mvp-auditionArtwork>span{right:8px!important;bottom:8px!important;left:auto!important;padding:6px 8px!important;border-radius:8px!important;background:rgba(2,8,11,.86)!important;border:1px solid rgba(101,194,225,.18)!important;font-size:10px!important}
      .mvp-auditionArtwork>span small{font-size:6px!important}

      .mvp-auditionSongInfo{align-self:center!important;padding:2px 4px 2px 0!important}
      .mvp-auditionStatusRow{gap:6px!important;margin-bottom:7px!important}
      .mvp-auditionStatusRow>span,.mvp-auditionStatusRow>b{min-height:22px!important;padding:0 8px!important;border-radius:999px!important;font-size:6.5px!important;letter-spacing:.08em!important}
      .mvp-auditionSongInfo h2{font-size:34px!important;line-height:1.02!important;letter-spacing:-.045em!important;margin:5px 0 5px!important;color:#fff!important;text-shadow:0 4px 18px rgba(0,0,0,.25)}
      .mvp-auditionSongInfo h3{font-size:16px!important;line-height:1.15!important;color:#8dddf5!important;margin:0!important}
      .mvp-auditionMeta{min-height:19px!important;margin:7px 0 12px!important;font-size:9px!important;line-height:1.45!important;color:#829da7!important}
      .mvp-auditionListen{gap:9px!important}
      .mvp-auditionListen button{min-height:62px!important;padding:0 15px!important;border-radius:12px!important;font-size:9px!important;gap:12px!important}
      .mvp-auditionListen .is-preview{border-color:rgba(76,207,247,.31)!important;background:linear-gradient(180deg,#0b3443,#071d27)!important;box-shadow:inset 0 -2px rgba(66,210,251,.35)!important}
      .mvp-auditionListen button.is-youtube{border-color:rgba(255,77,89,.31)!important;background:linear-gradient(180deg,#351116,#19070a)!important;box-shadow:inset 0 -2px rgba(255,78,91,.3)!important}
      .mvp-auditionControlIcon{width:36px!important;height:36px!important;flex:0 0 36px!important;border-radius:50%!important;font-size:13px!important;background:rgba(0,0,0,.23)!important;border:1px solid rgba(255,255,255,.08)!important}
      .mvp-auditionControlCopy strong{font-size:10px!important;letter-spacing:.1em!important}
      .mvp-auditionControlCopy small{font-size:7px!important;margin-top:2px!important}

      .mvp-auditionDecision{grid-template-columns:1.28fr 1fr 1fr!important;gap:9px!important;margin-top:10px!important}
      .mvp-auditionDecision button{min-height:70px!important;padding:0 14px!important;border-radius:12px!important;gap:11px!important;background:linear-gradient(180deg,#08171e,#040d12)!important}
      .mvp-auditionDecisionIcon{width:38px!important;height:38px!important;flex:0 0 38px!important;border-radius:50%!important;font-size:17px!important}
      .mvp-auditionDecision button strong{font-size:10px!important;letter-spacing:.12em!important}
      .mvp-auditionDecision button small{font-size:7px!important;color:#8298a1!important}
      .mvp-auditionDecision .is-keep{border-color:rgba(67,225,145,.22)!important}
      .mvp-auditionDecision .is-keep:hover,.mvp-auditionDecision .is-keep.is-active{background:linear-gradient(180deg,#0d3b25,#061a10)!important;border-color:rgba(78,239,158,.58)!important;box-shadow:inset 0 -3px #48e996,0 0 24px rgba(56,221,139,.1)!important}
      .mvp-auditionDecision .is-maybe{border-color:rgba(255,193,82,.18)!important}
      .mvp-auditionDecision .is-maybe:hover,.mvp-auditionDecision .is-maybe.is-active{background:linear-gradient(180deg,#352408,#180f04)!important;border-color:rgba(255,196,84,.52)!important;box-shadow:inset 0 -3px #ffc34f!important}
      .mvp-auditionDecision .is-pass{border-color:rgba(255,91,104,.2)!important}
      .mvp-auditionDecision .is-pass:hover,.mvp-auditionDecision .is-pass.is-active{background:linear-gradient(180deg,#391016,#19070a)!important;border-color:rgba(255,96,109,.5)!important;box-shadow:inset 0 -3px #ff5c68!important}
      .mvp-auditionPager{gap:7px!important;margin-top:9px!important}
      .mvp-auditionPager button{min-height:41px!important;border-radius:9px!important;font-size:7.5px!important;color:#9eb5be!important}
      .mvp-auditionPager .is-next-unreviewed{color:#effbff!important}
      .mvp-auditionCounts{justify-content:center!important;gap:24px!important;min-height:43px!important;padding:9px 12px!important;font-size:7px!important;background:#02080b!important}
      .mvp-auditionCounts span{letter-spacing:.08em!important}

      @media(max-width:760px){
        .mvp-auditionGlobal{grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:4px!important}
        .mvp-auditionSongCard,.mvp-auditionSongCard.no-art{grid-template-columns:1fr!important;gap:13px!important;padding:12px!important}
        .mvp-auditionArtwork,.mvp-auditionSongCard.no-art .mvp-auditionArtwork{width:min(100%,300px)!important;height:auto!important;aspect-ratio:1/1!important;justify-self:center!important}
        .mvp-auditionSongCard.no-art .mvp-auditionArtwork{max-height:190px!important;aspect-ratio:auto!important}
        .mvp-auditionSongInfo{padding:0!important}
        .mvp-auditionSongInfo h2{font-size:29px!important}
        .mvp-auditionSongInfo h3{font-size:15px!important}
        .mvp-auditionMeta{font-size:9px!important}
        .mvp-auditionListen button{min-height:58px!important}
        .mvp-auditionDecision button{min-height:62px!important}
        .mvp-auditionNav button.is-import{min-width:0!important}
      }
      @media(max-width:430px){
        .mvp-auditionHero{padding:14px 12px!important}
        .mvp-auditionHero h2{font-size:25px!important}
        .mvp-auditionGlobal{grid-template-columns:repeat(4,minmax(0,1fr))!important}
        .mvp-auditionGlobal b{font-size:18px!important}
        .mvp-auditionListen{grid-template-columns:1fr!important}
        .mvp-auditionDecision{grid-template-columns:1.2fr 1fr 1fr!important;gap:5px!important}
        .mvp-auditionDecision button{min-height:58px!important;padding:0 6px!important}
        .mvp-auditionDecision button small{display:none!important}
        .mvp-auditionDecisionIcon{display:grid!important;width:28px!important;height:28px!important;flex-basis:28px!important;font-size:13px!important}
        .mvp-auditionCounts{gap:12px!important}
      }

      /* MVP_TRAINER_V5_R12_5E_11_AUDITION_INTELLIGENCE_PREMIUM */
      .mvp-auditionPreflight{
        display:flex!important;align-items:center!important;justify-content:space-between!important;gap:10px!important;
        margin:8px 0 7px!important;padding:7px 9px!important;border-radius:9px!important;
        border:1px solid rgba(72,221,151,.13)!important;background:linear-gradient(90deg,rgba(13,64,43,.32),rgba(4,14,18,.2))!important;
      }
      .mvp-auditionPreflight span{font-size:6.8px!important;font-weight:1000!important;letter-spacing:.08em!important;color:#73e9a7!important}
      .mvp-auditionPreflight small{font-size:6.6px!important;color:#718a94!important}
      .mvp-auditionListCard footer .is-open:disabled{
        color:#6d8b80!important;border-color:rgba(75,155,116,.16)!important;background:#07110d!important;
        box-shadow:none!important;cursor:default!important;
      }

      /* Main audition listening controls: dark glass, luminous icon cores, no giant color slabs. */
      .mvp-auditionListen{
        display:grid!important;grid-template-columns:1fr 1fr!important;gap:10px!important;margin-top:3px!important;
      }
      .mvp-auditionListen button{
        position:relative!important;overflow:hidden!important;display:flex!important;align-items:center!important;justify-content:flex-start!important;
        min-height:70px!important;padding:0 16px!important;gap:13px!important;border-radius:16px!important;
        border:1px solid rgba(110,177,200,.16)!important;
        background:
          radial-gradient(120px 70px at 0% 50%,rgba(78,213,252,.08),transparent 72%),
          linear-gradient(180deg,rgba(10,25,32,.96),rgba(4,13,18,.98))!important;
        color:#dff8ff!important;
        box-shadow:inset 0 1px rgba(255,255,255,.035),0 12px 28px rgba(0,0,0,.18)!important;
        transform:none!important;transition:border-color .18s ease,box-shadow .18s ease,background .18s ease!important;
      }
      .mvp-auditionListen button:after{
        content:"";position:absolute!important;left:14px!important;right:14px!important;bottom:0!important;height:2px!important;
        border-radius:99px 99px 0 0!important;opacity:.78!important;
      }
      .mvp-auditionListen .is-preview:after{background:linear-gradient(90deg,transparent,#54d8ff,transparent)!important}
      .mvp-auditionListen .is-youtube:after{background:linear-gradient(90deg,transparent,#ff4f5e,transparent)!important}
      .mvp-auditionListen button:not(:disabled):hover{
        border-color:rgba(111,219,249,.34)!important;
        box-shadow:inset 0 1px rgba(255,255,255,.05),0 12px 30px rgba(0,0,0,.22),0 0 24px rgba(62,196,235,.07)!important;
      }
      .mvp-auditionListen .is-youtube:not(:disabled):hover{
        border-color:rgba(255,91,104,.34)!important;
        box-shadow:inset 0 1px rgba(255,255,255,.04),0 12px 30px rgba(0,0,0,.22),0 0 22px rgba(255,74,88,.06)!important;
      }
      .mvp-auditionListen button.is-unavailable,.mvp-auditionListen button:disabled{
        opacity:.48!important;cursor:default!important;box-shadow:none!important;
      }
      .mvp-auditionListen button.is-unavailable:after{background:linear-gradient(90deg,transparent,#536872,transparent)!important}
      .mvp-auditionControlIcon{
        width:44px!important;height:44px!important;flex:0 0 44px!important;display:grid!important;place-items:center!important;
        border-radius:50%!important;background:linear-gradient(145deg,#102c37,#07151b)!important;
        border:1px solid rgba(110,219,249,.26)!important;color:#e9fbff!important;
        box-shadow:inset 0 1px rgba(255,255,255,.08),0 0 0 5px rgba(68,205,244,.025),0 8px 18px rgba(0,0,0,.25)!important;
      }
      .mvp-auditionListen .is-youtube .mvp-auditionControlIcon{
        color:#fff!important;border-color:rgba(255,88,101,.26)!important;background:linear-gradient(145deg,#331319,#16080b)!important;
        box-shadow:inset 0 1px rgba(255,255,255,.06),0 0 0 5px rgba(255,70,84,.02),0 8px 18px rgba(0,0,0,.25)!important;
      }
      .mvp-auditionControlIcon svg{width:17px!important;height:17px!important}
      .mvp-auditionControlCopy{display:grid!important;gap:3px!important;text-align:left!important}
      .mvp-auditionControlCopy strong{font-size:10px!important;letter-spacing:.11em!important;color:#f4fcff!important}
      .mvp-auditionControlCopy small{font-size:7px!important;color:#72909b!important;letter-spacing:.025em!important}
      .mvp-auditionListen .is-youtube .mvp-auditionControlCopy small{color:#956d73!important}
      .mvp-auditionListen button.is-playing{
        border-color:rgba(89,224,255,.45)!important;background:linear-gradient(180deg,#0b2732,#06161d)!important;
        box-shadow:inset 0 1px rgba(255,255,255,.05),0 0 26px rgba(55,201,242,.08)!important;
      }

      /* KEEP / MAYBE / PASS now use the same floating control language as the player. */
      .mvp-auditionDecision{
        display:grid!important;grid-template-columns:1.18fr 1fr 1fr!important;gap:10px!important;margin-top:10px!important;
      }
      .mvp-auditionDecision button{
        position:relative!important;display:flex!important;align-items:center!important;justify-content:flex-start!important;
        min-height:68px!important;padding:0 14px!important;gap:11px!important;border-radius:15px!important;
        border:1px solid rgba(104,166,187,.13)!important;
        background:linear-gradient(180deg,rgba(8,21,27,.96),rgba(4,12,16,.98))!important;
        box-shadow:inset 0 1px rgba(255,255,255,.025),0 10px 22px rgba(0,0,0,.16)!important;
        transform:none!important;
      }
      .mvp-auditionDecision button:after{
        content:"";position:absolute!important;left:16px!important;right:16px!important;bottom:0!important;height:2px!important;
        border-radius:99px!important;opacity:.48!important;
      }
      .mvp-auditionDecision .is-keep:after{background:linear-gradient(90deg,transparent,#4bea98,transparent)!important}
      .mvp-auditionDecision .is-maybe:after{background:linear-gradient(90deg,transparent,#ffc14d,transparent)!important}
      .mvp-auditionDecision .is-pass:after{background:linear-gradient(90deg,transparent,#ff5967,transparent)!important}
      .mvp-auditionDecisionIcon{
        width:40px!important;height:40px!important;flex:0 0 40px!important;display:grid!important;place-items:center!important;
        border-radius:50%!important;background:#061117!important;border:1px solid currentColor!important;
        box-shadow:inset 0 1px rgba(255,255,255,.045),0 0 0 5px rgba(255,255,255,.012)!important;
      }
      .mvp-auditionDecisionIcon svg{width:18px!important;height:18px!important}
      .mvp-auditionDecision button>span:last-child{display:grid!important;gap:2px!important;text-align:left!important}
      .mvp-auditionDecision button strong{font-size:10px!important;letter-spacing:.12em!important}
      .mvp-auditionDecision button small{font-size:7px!important;color:#708891!important}
      .mvp-auditionDecision .is-keep{color:#73e9a7!important}
      .mvp-auditionDecision .is-maybe{color:#ffc85d!important}
      .mvp-auditionDecision .is-pass{color:#ff737f!important}
      .mvp-auditionDecision .is-keep:hover,.mvp-auditionDecision .is-keep.is-active{
        border-color:rgba(75,234,153,.35)!important;background:linear-gradient(180deg,#0a2117,#05110c)!important;
        box-shadow:inset 0 1px rgba(255,255,255,.03),0 0 24px rgba(51,216,135,.07)!important;
      }
      .mvp-auditionDecision .is-maybe:hover,.mvp-auditionDecision .is-maybe.is-active{
        border-color:rgba(255,196,77,.3)!important;background:linear-gradient(180deg,#201707,#100b04)!important;
        box-shadow:inset 0 1px rgba(255,255,255,.025),0 0 22px rgba(243,176,51,.06)!important;
      }
      .mvp-auditionDecision .is-pass:hover,.mvp-auditionDecision .is-pass.is-active{
        border-color:rgba(255,89,103,.32)!important;background:linear-gradient(180deg,#211014,#100609)!important;
        box-shadow:inset 0 1px rgba(255,255,255,.025),0 0 22px rgba(235,61,76,.055)!important;
      }

      /* Kept Songs becomes a true premium staging queue. */
      .mvp-auditionKept{gap:11px!important}
      .mvp-auditionKept>header{
        padding:15px 17px!important;border-radius:14px!important;border-color:rgba(78,188,221,.14)!important;
        background:
          radial-gradient(330px 100px at 100% 0%,rgba(55,224,147,.055),transparent 72%),
          linear-gradient(150deg,#07171e,#040c10)!important;
        box-shadow:inset 0 1px rgba(255,255,255,.025),0 14px 28px rgba(0,0,0,.15)!important;
      }
      .mvp-auditionKept>header h3{font-size:22px!important;letter-spacing:-.025em!important}
      .mvp-auditionKept>header p{font-size:8px!important;line-height:1.5!important;color:#78929c!important}
      .mvp-auditionKept>header>b{
        min-width:50px;height:50px;display:grid;place-items:center;border-radius:50%!important;
        border:1px solid rgba(82,226,151,.2)!important;background:#061810!important;color:#78ecad!important;font-size:24px!important;
        box-shadow:0 0 0 5px rgba(75,223,145,.018)!important;
      }
      .mvp-auditionKeptGrid{gap:8px!important}
      .mvp-auditionKeptGrid>article{
        position:relative!important;grid-template-columns:68px minmax(0,1fr) auto!important;gap:13px!important;
        min-height:88px!important;padding:10px 12px!important;border-radius:13px!important;
        border-color:rgba(95,174,202,.12)!important;
        background:
          linear-gradient(90deg,rgba(17,54,67,.22),transparent 28%),
          linear-gradient(180deg,#07141a,#040c10)!important;
        box-shadow:inset 0 1px rgba(255,255,255,.02),0 9px 22px rgba(0,0,0,.12)!important;
        transition:border-color .18s ease,background .18s ease!important;
      }
      .mvp-auditionKeptGrid>article:hover{
        border-color:rgba(86,196,230,.23)!important;
        background:linear-gradient(90deg,rgba(20,72,88,.25),transparent 30%),linear-gradient(180deg,#081820,#040d11)!important;
      }
      .mvp-auditionKeptArt{
        width:68px!important;height:68px!important;border-radius:11px!important;border:1px solid rgba(91,189,220,.13)!important;
        background:radial-gradient(circle at 50% 35%,#15303a,#07141a 70%)!important;
        box-shadow:0 8px 20px rgba(0,0,0,.2)!important;
      }
      .mvp-auditionKeptInfo{gap:2px!important}
      .mvp-auditionKeptInfo small{font-size:6.5px!important;letter-spacing:.1em!important;color:#76eaaa!important}
      .mvp-auditionKeptInfo strong{font-size:14px!important;letter-spacing:-.015em!important}
      .mvp-auditionKeptInfo b{font-size:9px!important;color:#9fc4d0!important}
      .mvp-auditionKeptInfo p{margin-top:4px!important;font-size:6.7px!important;color:#647e88!important}

      .mvp-auditionKeptActions{
        display:flex!important;align-items:center!important;justify-content:flex-end!important;gap:7px!important;flex-wrap:nowrap!important;
      }
      .mvp-auditionKeptActions .mvp-keptAction{
        position:relative!important;display:flex!important;align-items:center!important;justify-content:flex-start!important;gap:8px!important;
        min-width:112px!important;min-height:51px!important;padding:0 10px!important;border-radius:12px!important;
        border:1px solid rgba(105,170,192,.13)!important;
        background:linear-gradient(180deg,#08171e,#040d12)!important;
        color:#a9c4ce!important;box-shadow:inset 0 1px rgba(255,255,255,.025),0 8px 18px rgba(0,0,0,.14)!important;
        transition:border-color .18s ease,box-shadow .18s ease!important;
      }
      .mvp-auditionKeptActions .mvp-keptAction:hover{border-color:rgba(93,196,229,.25)!important;color:#edfaff!important}
      .mvp-keptActionIcon{
        width:32px!important;height:32px!important;flex:0 0 32px!important;display:grid!important;place-items:center!important;
        border-radius:50%!important;background:#071218!important;border:1px solid currentColor!important;
        box-shadow:0 0 0 4px rgba(255,255,255,.012)!important;
      }
      .mvp-keptActionIcon svg{width:14px!important;height:14px!important}
      .mvp-keptAction>span:last-child{display:grid!important;gap:2px!important;text-align:left!important}
      .mvp-keptAction strong{font-size:7.7px!important;letter-spacing:.08em!important;color:inherit!important;white-space:nowrap!important}
      .mvp-keptAction small{font-size:6px!important;color:#637d87!important;white-space:nowrap!important}
      .mvp-keptAction.is-preview{color:#72dcf7!important}
      .mvp-keptAction.is-youtube{
        color:#ff8b94!important;border-color:rgba(255,88,101,.16)!important;
        background:linear-gradient(180deg,#160a0d,#090507)!important;
      }
      .mvp-keptAction.is-add{
        color:#ffbd55!important;border-color:rgba(255,178,57,.22)!important;
        background:
          radial-gradient(100px 45px at 0% 50%,rgba(245,157,31,.08),transparent 74%),
          linear-gradient(180deg,#1a1207,#0b0804)!important;
        box-shadow:inset 0 1px rgba(255,255,255,.025),0 0 20px rgba(239,145,19,.035)!important;
      }
      .mvp-keptAction.is-add:hover{
        border-color:rgba(255,188,73,.4)!important;box-shadow:inset 0 1px rgba(255,255,255,.035),0 0 24px rgba(239,145,19,.07)!important;
      }
      .mvp-keptAction:disabled{opacity:.45!important;cursor:default!important}
      .mvp-keptMore{position:relative!important;flex:0 0 auto!important}
      .mvp-keptMore summary{
        list-style:none!important;width:42px!important;height:42px!important;display:grid!important;place-items:center!important;cursor:pointer!important;
        border-radius:50%!important;border:1px solid rgba(107,171,193,.13)!important;background:#07141a!important;color:#78939d!important;
      }
      .mvp-keptMore summary::-webkit-details-marker{display:none!important}
      .mvp-keptMore summary svg{width:18px!important;height:18px!important}
      .mvp-keptMore[open] summary,.mvp-keptMore summary:hover{color:#dceff5!important;border-color:rgba(91,193,225,.25)!important;background:#091b22!important}
      .mvp-keptMore>div{
        position:absolute!important;z-index:30!important;right:0!important;top:48px!important;min-width:150px!important;padding:5px!important;
        border:1px solid rgba(255,95,108,.16)!important;border-radius:10px!important;background:#0c0a0c!important;
        box-shadow:0 16px 35px rgba(0,0,0,.4)!important;
      }
      .mvp-keptMore>div button{
        width:100%!important;min-height:34px!important;border:0!important;border-radius:7px!important;background:transparent!important;
        color:#ff8992!important;font-size:6.7px!important;font-weight:1000!important;letter-spacing:.07em!important;text-align:left!important;padding:0 9px!important;
      }
      .mvp-keptMore>div button:hover{background:#210b0f!important}

      @media(max-width:980px){
        .mvp-auditionKeptGrid>article{grid-template-columns:62px minmax(0,1fr)!important}
        .mvp-auditionKeptArt{width:62px!important;height:62px!important}
        .mvp-auditionKeptActions{grid-column:1/-1!important;justify-content:flex-start!important;flex-wrap:wrap!important}
      }
      @media(max-width:760px){
        .mvp-auditionPreflight{align-items:flex-start!important;flex-direction:column!important;gap:3px!important}
        .mvp-auditionListen{grid-template-columns:1fr 1fr!important}
        .mvp-auditionDecision{grid-template-columns:1.15fr 1fr 1fr!important;gap:6px!important}
        .mvp-auditionDecision button{min-height:62px!important;padding:0 8px!important;gap:7px!important}
        .mvp-auditionDecisionIcon{width:32px!important;height:32px!important;flex-basis:32px!important}
        .mvp-auditionKeptGrid>article{grid-template-columns:58px minmax(0,1fr)!important;padding:9px 10px!important}
        .mvp-auditionKeptArt{width:58px!important;height:58px!important}
        .mvp-auditionKeptActions{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr)) auto!important;width:100%!important;gap:6px!important}
        .mvp-auditionKeptActions .mvp-keptAction{min-width:0!important;width:100%!important;min-height:48px!important;padding:0 8px!important}
        .mvp-keptMore summary{width:48px!important;height:48px!important}
      }
      @media(max-width:520px){
        .mvp-auditionListen{grid-template-columns:1fr!important}
        .mvp-auditionControlIcon{width:40px!important;height:40px!important;flex-basis:40px!important}
        .mvp-auditionDecision button small{display:none!important}
        .mvp-auditionDecisionIcon{width:29px!important;height:29px!important;flex-basis:29px!important}
        .mvp-auditionKeptActions{grid-template-columns:1fr 1fr!important}
        .mvp-keptMore{grid-column:2!important;justify-self:end!important}
      }

      /* v12: fast unreviewed-only audition deck + unmistakable premium states */
      .mvp-auditionStageHead{grid-template-columns:auto minmax(0,1fr) auto!important;align-items:center!important;gap:18px!important}
      .mvp-auditionStageProgress{min-width:150px!important;text-align:right!important;display:grid!important;gap:1px!important}
      .mvp-auditionStageProgress>b{font-size:28px!important;line-height:1!important;color:#f7fbfd!important;letter-spacing:-.04em!important}
      .mvp-auditionStageProgress>span{font-size:7px!important;letter-spacing:.13em!important;color:#66d9f7!important;font-weight:1000!important}
      .mvp-auditionStageProgress>small{font-size:6px!important;color:#708b95!important;white-space:nowrap!important}
      .mvp-auditionSongCard{grid-template-columns:minmax(190px,260px) minmax(0,1fr)!important;gap:28px!important;padding:22px!important;border:1px solid rgba(84,178,208,.14)!important;border-radius:18px!important;background:radial-gradient(circle at 22% 14%,rgba(31,160,202,.09),transparent 34%),linear-gradient(145deg,rgba(8,22,28,.98),rgba(3,9,12,.98))!important;box-shadow:0 20px 65px rgba(0,0,0,.28),inset 0 1px rgba(255,255,255,.018)!important}
      .mvp-auditionSongInfo{align-self:center!important}
      .mvp-auditionSongInfo h2{font-size:clamp(30px,3vw,46px)!important;line-height:.98!important;letter-spacing:-.055em!important;margin-top:5px!important}
      .mvp-auditionSongInfo h3{font-size:18px!important;color:#a7d7e4!important;margin-top:8px!important}
      .mvp-auditionSongInfo>p{font-size:8px!important;line-height:1.5!important;margin:8px 0 17px!important}
      .mvp-auditionActionLabel{display:flex!important;align-items:center!important;gap:10px!important;margin:8px 0 8px!important;color:#6e8d99!important;font-size:6.5px!important;font-weight:1000!important;letter-spacing:.16em!important}
      .mvp-auditionActionLabel i{height:1px!important;flex:1!important;background:linear-gradient(90deg,rgba(82,202,239,.18),transparent)!important}
      .mvp-auditionActionLabel.is-decision{margin-top:20px!important}
      .mvp-auditionListen{display:grid!important;grid-template-columns:minmax(0,1fr) minmax(0,.72fr)!important;gap:14px!important}
      .mvp-auditionListen button{min-height:64px!important;border-radius:17px!important;padding:0 18px!important;display:flex!important;align-items:center!important;gap:13px!important;text-align:left!important;background:linear-gradient(180deg,rgba(8,24,31,.92),rgba(4,13,17,.94))!important;border:1px solid rgba(102,181,207,.15)!important;box-shadow:inset 0 1px rgba(255,255,255,.018)!important;transition:transform .16s ease,border-color .16s ease,box-shadow .16s ease!important}
      .mvp-auditionListen button:hover:not(:disabled){transform:translateY(-1px)!important;border-color:rgba(103,205,237,.32)!important}
      .mvp-auditionListen .is-preview{color:#eafaff!important;border-color:rgba(69,200,240,.25)!important;background:radial-gradient(circle at 10% 40%,rgba(46,185,226,.12),transparent 33%),linear-gradient(180deg,#0a1d24,#051116)!important}
      .mvp-auditionListen .is-youtube{color:#f6fbfd!important;border-color:rgba(255,99,109,.18)!important;background:radial-gradient(circle at 12% 45%,rgba(219,51,65,.09),transparent 30%),linear-gradient(180deg,#111417,#070b0d)!important}
      .mvp-auditionListen .is-youtube .mvp-auditionControlIcon{color:#ff6670!important;border-color:rgba(255,97,107,.35)!important;box-shadow:0 0 22px rgba(255,69,81,.08)!important}
      .mvp-auditionControlIcon{width:38px!important;height:38px!important;border-radius:50%!important;display:grid!important;place-items:center!important;background:#061219!important;border:1px solid rgba(90,206,241,.32)!important;color:#76e1ff!important;flex:0 0 auto!important}
      .mvp-auditionControlIcon svg{width:14px!important;height:14px!important}
      .mvp-auditionControlCopy strong{font-size:9px!important;letter-spacing:.08em!important}
      .mvp-auditionControlCopy small{font-size:6.5px!important;color:#6d8994!important}
      .mvp-auditionDecision{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:14px!important;margin-top:0!important}
      .mvp-auditionDecision button{min-height:76px!important;border-radius:17px!important;padding:10px 14px!important;display:flex!important;align-items:center!important;justify-content:center!important;gap:11px!important;background:linear-gradient(180deg,rgba(9,20,25,.95),rgba(4,11,14,.96))!important;border:1px solid rgba(111,164,182,.15)!important;color:#dbe7eb!important;box-shadow:inset 0 1px rgba(255,255,255,.018)!important;transition:transform .14s ease,border-color .14s ease,box-shadow .14s ease,background .14s ease!important}
      .mvp-auditionDecision button:hover:not(:disabled){transform:translateY(-1px)!important;border-color:rgba(135,197,218,.28)!important}
      .mvp-auditionDecision button:disabled{cursor:default!important}
      .mvp-auditionDecisionIcon{width:42px!important;height:42px!important;border-radius:50%!important;display:grid!important;place-items:center!important;flex:0 0 auto!important;background:#061116!important;border:1px solid rgba(116,161,177,.18)!important;color:#8da4ad!important;box-shadow:none!important}
      .mvp-auditionDecisionIcon svg{width:18px!important;height:18px!important}
      .mvp-auditionDecision button>span:last-child{display:grid!important;gap:3px!important;text-align:left!important}
      .mvp-auditionDecision strong{font-size:8.5px!important;letter-spacing:.08em!important;color:#f4fafc!important}
      .mvp-auditionDecision small{font-size:6.3px!important;color:#627a84!important}
      .mvp-auditionDecision .is-keep:not(.is-active) .mvp-auditionDecisionIcon{color:#67dca1!important}
      .mvp-auditionDecision .is-maybe:not(.is-active) .mvp-auditionDecisionIcon{color:#e6b950!important}
      .mvp-auditionDecision .is-pass:not(.is-active) .mvp-auditionDecisionIcon{color:#e36d76!important}
      .mvp-auditionDecision .is-keep.is-active{border-color:#44dc8b!important;background:radial-gradient(circle at 18% 40%,rgba(58,220,137,.22),transparent 38%),linear-gradient(180deg,#0a2218,#06130e)!important;box-shadow:0 0 0 1px rgba(68,220,139,.18),0 0 28px rgba(54,214,131,.18),inset 0 1px rgba(255,255,255,.04)!important}
      .mvp-auditionDecision .is-keep.is-active .mvp-auditionDecisionIcon{background:#103a28!important;border-color:#55e49a!important;color:#a4ffd0!important;box-shadow:0 0 24px rgba(62,222,139,.22)!important}
      .mvp-auditionDecision .is-maybe.is-active{border-color:#e4ad3f!important;background:radial-gradient(circle at 18% 40%,rgba(230,176,62,.2),transparent 38%),linear-gradient(180deg,#211806,#120d04)!important;box-shadow:0 0 0 1px rgba(228,173,63,.16),0 0 28px rgba(229,168,46,.14)!important}
      .mvp-auditionDecision .is-maybe.is-active .mvp-auditionDecisionIcon{background:#3a2908!important;border-color:#e7b84f!important;color:#ffe29b!important;box-shadow:0 0 24px rgba(232,180,70,.18)!important}
      .mvp-auditionDecision .is-pass.is-active{border-color:#ef5964!important;background:radial-gradient(circle at 18% 40%,rgba(235,75,89,.2),transparent 38%),linear-gradient(180deg,#251014,#12070a)!important;box-shadow:0 0 0 1px rgba(239,89,100,.16),0 0 28px rgba(230,69,84,.15)!important}
      .mvp-auditionDecision .is-pass.is-active .mvp-auditionDecisionIcon{background:#41141a!important;border-color:#f0616c!important;color:#ffb1b7!important;box-shadow:0 0 24px rgba(239,82,95,.19)!important}
      .mvp-auditionPager{display:grid!important;grid-template-columns:minmax(110px,.72fr) auto minmax(150px,1fr)!important;gap:10px!important;align-items:center!important;margin-top:15px!important}
      .mvp-auditionPager button{min-height:38px!important;border-radius:11px!important;background:#061015!important;border:1px solid rgba(100,166,189,.13)!important;color:#829ca6!important}
      .mvp-auditionPager .is-next-unreviewed{color:#e9faff!important;background:linear-gradient(180deg,#092631,#061820)!important;border-color:rgba(62,194,235,.25)!important}
      .mvp-auditionPager>span{display:grid!important;place-items:center!important;color:#607a84!important;font-size:6.5px!important;font-weight:1000!important;letter-spacing:.08em!important}
      .mvp-auditionPager>span b{font-size:13px!important;color:#dff7ff!important;letter-spacing:-.02em!important}
      .mvp-auditionStatusRow .is-new{color:#9cb4bd!important;background:#07151a!important;border-color:rgba(115,166,185,.14)!important}
      .mvp-auditionStatusRow .is-keep{color:#9cffc7!important;background:#082117!important;border-color:rgba(76,220,142,.3)!important}
      .mvp-auditionStatusRow .is-maybe{color:#ffe19a!important;background:#211806!important;border-color:rgba(230,177,71,.28)!important}
      .mvp-auditionStatusRow .is-pass{color:#ff9ea5!important;background:#251014!important;border-color:rgba(239,91,103,.28)!important}
      .mvp-auditionKeptGrid>article{grid-template-columns:68px minmax(0,1fr) auto!important;gap:14px!important;padding:11px 12px!important;border-radius:14px!important;background:linear-gradient(180deg,rgba(8,20,25,.96),rgba(4,11,14,.97))!important;border:1px solid rgba(100,169,192,.1)!important}
      .mvp-auditionKeptArt{width:68px!important;height:68px!important;border-radius:12px!important}
      .mvp-auditionKeptInfo strong{font-size:14px!important}
      .mvp-auditionKeptInfo b{font-size:9px!important;color:#a9c7d1!important}
      .mvp-auditionKeptActions{display:flex!important;align-items:center!important;gap:9px!important;flex-wrap:nowrap!important}
      .mvp-auditionKeptActions .mvp-keptAction{min-height:48px!important;min-width:108px!important;border-radius:13px!important;padding:0 11px!important;background:#061116!important;border:1px solid rgba(105,169,190,.13)!important;box-shadow:inset 0 1px rgba(255,255,255,.016)!important}
      .mvp-keptActionIcon{width:31px!important;height:31px!important;border-radius:50%!important;background:#0a1b22!important;border:1px solid rgba(101,181,206,.18)!important}
      .mvp-keptAction.is-preview .mvp-keptActionIcon{color:#6bddfb!important;border-color:rgba(74,199,239,.28)!important}
      .mvp-keptAction.is-youtube{background:#081013!important;color:#f2f7f9!important;border-color:rgba(255,92,103,.13)!important}
      .mvp-keptAction.is-youtube .mvp-keptActionIcon{color:#ff6873!important;border-color:rgba(255,91,102,.26)!important}
      .mvp-keptAction.is-add{color:#f9fbfc!important;background:radial-gradient(circle at 10% 50%,rgba(255,163,38,.13),transparent 34%),#0b1113!important;border-color:rgba(255,170,47,.24)!important}
      .mvp-keptAction.is-add .mvp-keptActionIcon{color:#ffb74d!important;border-color:rgba(255,177,68,.32)!important}
      @media(max-width:760px){
        .mvp-auditionSongCard{grid-template-columns:1fr!important;gap:16px!important;padding:14px!important}
        .mvp-auditionArtwork{width:min(72vw,260px)!important;margin:0 auto!important}
        .mvp-auditionListen{grid-template-columns:1fr 1fr!important;gap:9px!important}
        .mvp-auditionDecision{grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:7px!important}
        .mvp-auditionDecision button{min-height:70px!important;padding:8px 5px!important;display:grid!important;place-content:center!important;text-align:center!important}
        .mvp-auditionDecision button>span:last-child{text-align:center!important}
        .mvp-auditionDecisionIcon{width:36px!important;height:36px!important;margin:auto!important}
        .mvp-auditionDecision strong{font-size:7px!important}
        .mvp-auditionDecision small{display:none!important}
        .mvp-auditionPager{grid-template-columns:1fr 1fr!important}
        .mvp-auditionPager>span{grid-column:1/-1!important;grid-row:1!important}
        .mvp-auditionPager button:first-child{grid-column:1!important}
        .mvp-auditionPager .is-next-unreviewed{grid-column:2!important;grid-row:auto!important}
        .mvp-auditionStageHead{grid-template-columns:auto 1fr!important}
        .mvp-auditionStageProgress{grid-column:1/-1!important;text-align:left!important;min-width:0!important}
        .mvp-auditionStageProgress>small{white-space:normal!important}
        .mvp-auditionKeptGrid>article{grid-template-columns:58px 1fr!important}
        .mvp-auditionKeptArt{width:58px!important;height:58px!important}
        .mvp-auditionKeptActions{grid-column:1/-1!important;display:grid!important;grid-template-columns:repeat(3,1fr) auto!important;gap:7px!important}
        .mvp-auditionKeptActions .mvp-keptAction{min-width:0!important;width:100%!important}
      }

      /* MVP_TRAINER_V5_R12_5E_13_AUDITION_CINEMATIC_FAST */
      .mvp-audition{
        --mvp-ice:#bff5ff;
        --mvp-cyan:#42d9ff;
        --mvp-blue:#1596d6;
        --mvp-orange:#ff9f24;
        --mvp-green:#47e89a;
        --mvp-amber:#ffc457;
        --mvp-red:#ff5e6d;
      }

      /* CINEMATIC CURRENT-SONG DECK */
      .mvp-auditionSongCard{
        position:relative!important;
        isolation:isolate!important;
        overflow:hidden!important;
        grid-template-columns:minmax(210px,290px) minmax(0,1fr)!important;
        gap:34px!important;
        padding:26px!important;
        border:1px solid rgba(111,211,241,.13)!important;
        border-radius:22px!important;
        background:
          radial-gradient(900px 420px at 8% 12%,rgba(42,186,229,.11),transparent 58%),
          radial-gradient(650px 320px at 86% 108%,rgba(255,152,34,.055),transparent 68%),
          linear-gradient(145deg,#07161d 0%,#03090d 72%,#020609 100%)!important;
        box-shadow:
          0 30px 90px rgba(0,0,0,.34),
          inset 0 1px rgba(255,255,255,.026),
          inset 0 -1px rgba(64,201,241,.035)!important;
      }
      .mvp-auditionSongCard:before{
        content:"";position:absolute;z-index:-1;inset:0;pointer-events:none;
        background:
          linear-gradient(110deg,transparent 0 24%,rgba(94,224,255,.035) 38%,transparent 53%),
          linear-gradient(180deg,rgba(255,255,255,.014),transparent 34%);
        transform:translateZ(0);
      }
      .mvp-auditionAmbient{
        position:absolute;z-index:-2;inset:-90px -70px -90px -50px;
        background-position:20% 42%;background-size:58% auto;background-repeat:no-repeat;
        filter:blur(58px) saturate(1.55) contrast(1.06);
        opacity:.22;transform:scale(1.13) translateZ(0);
        mask-image:linear-gradient(90deg,#000 0 45%,transparent 76%);
        -webkit-mask-image:linear-gradient(90deg,#000 0 45%,transparent 76%);
      }
      .mvp-auditionSongCard.has-art .mvp-auditionArtwork{
        transform:translateZ(0);
        box-shadow:
          0 24px 55px rgba(0,0,0,.44),
          0 0 0 1px rgba(255,255,255,.12),
          0 0 40px rgba(65,204,243,.09)!important;
      }
      .mvp-auditionArtwork{
        border-radius:18px!important;
        overflow:hidden!important;
        background:#061116!important;
      }
      .mvp-auditionArtwork img{transform:scale(1.001);transition:transform .45s cubic-bezier(.2,.7,.2,1),filter .3s ease!important}
      .mvp-auditionSongCard:hover .mvp-auditionArtwork img{transform:scale(1.016)!important;filter:saturate(1.05) contrast(1.02)!important}

      .mvp-auditionStatusRow{margin-bottom:12px!important;gap:9px!important}
      .mvp-auditionStatusRow span,.mvp-auditionStatusRow b{
        min-height:22px!important;padding:0 8px!important;border-radius:5px!important;
        letter-spacing:.13em!important;font-size:6px!important;
        background:rgba(5,16,21,.72)!important;backdrop-filter:blur(10px)!important;
      }
      .mvp-auditionSongInfo h2{
        font-size:clamp(36px,4.25vw,58px)!important;
        line-height:.91!important;
        letter-spacing:-.065em!important;
        text-wrap:balance;
        text-shadow:0 9px 34px rgba(0,0,0,.44);
      }
      .mvp-auditionSongInfo h3{
        margin-top:11px!important;font-size:19px!important;
        color:#9bd9eb!important;font-weight:900!important;letter-spacing:-.02em!important;
      }
      .mvp-auditionMeta{max-width:780px!important;margin:9px 0 22px!important;color:#6e8994!important}
      .mvp-auditionActionLabel{
        margin:13px 0 8px!important;
        color:#657f89!important;font-size:6px!important;letter-spacing:.2em!important;
      }
      .mvp-auditionActionLabel.is-decision{margin-top:28px!important}
      .mvp-auditionActionLabel i{opacity:.55!important}

      /* REAL SVG MEDIA CONTROLS - no icon circles */
      .mvp-auditionListen{
        grid-template-columns:minmax(0,1.08fr) minmax(0,.82fr)!important;
        gap:22px!important;
      }
      .mvp-auditionListen button{
        min-height:74px!important;
        padding:0 22px!important;
        gap:17px!important;
        border-radius:10px!important;
        clip-path:polygon(0 0,calc(100% - 12px) 0,100% 12px,100% 100%,12px 100%,0 calc(100% - 12px))!important;
        border:0!important;
        outline:1px solid rgba(115,191,216,.13)!important;
        outline-offset:-1px!important;
        background:
          linear-gradient(180deg,rgba(10,26,33,.94),rgba(4,12,16,.97))!important;
        box-shadow:
          inset 0 1px rgba(255,255,255,.026),
          0 14px 28px rgba(0,0,0,.18)!important;
      }
      .mvp-auditionListen button:before{
        content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:#29434d;opacity:.75;
      }
      .mvp-auditionListen .is-preview:before{background:linear-gradient(180deg,#87ecff,#1caee4)!important}
      .mvp-auditionListen .is-youtube:before{background:linear-gradient(180deg,#ff6575,#e51635)!important}
      .mvp-auditionListen button:after{
        left:18px!important;right:18px!important;height:1px!important;opacity:.52!important;
      }
      .mvp-auditionListen button:not(:disabled):hover{
        transform:translateY(-2px)!important;
        outline-color:rgba(122,222,250,.28)!important;
        box-shadow:inset 0 1px rgba(255,255,255,.04),0 18px 38px rgba(0,0,0,.24),0 0 30px rgba(48,192,233,.06)!important;
      }
      .mvp-auditionListen .is-youtube:not(:disabled):hover{
        outline-color:rgba(255,83,103,.25)!important;
        box-shadow:inset 0 1px rgba(255,255,255,.03),0 18px 38px rgba(0,0,0,.24),0 0 28px rgba(255,48,69,.055)!important;
      }
      .mvp-auditionControlIcon{
        width:50px!important;height:32px!important;flex:0 0 50px!important;
        border:0!important;border-radius:0!important;background:transparent!important;
        box-shadow:none!important;display:grid!important;place-items:center!important;
      }
      .mvp-auditionControlIcon .mvp-svg{display:block!important;width:44px!important;height:29px!important;overflow:visible!important}
      .mvp-auditionListen .is-preview .mvp-auditionControlIcon{color:#79e6ff!important}
      .mvp-auditionListen .is-youtube .mvp-auditionControlIcon{
        border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important;color:#fff!important;
      }
      .mvp-auditionControlCopy{gap:4px!important}
      .mvp-auditionControlCopy strong{font-size:10px!important;letter-spacing:.14em!important}
      .mvp-auditionControlCopy small{font-size:6.5px!important}
      .mvp-auditionListen button.is-playing{
        outline-color:rgba(80,221,255,.42)!important;
        background:
          radial-gradient(280px 80px at 0% 50%,rgba(57,205,244,.14),transparent 72%),
          linear-gradient(180deg,#0b252f,#05141a)!important;
      }
      .mvp-auditionListen button.is-playing .mvp-svgPreview{filter:drop-shadow(0 0 10px rgba(72,217,255,.42))!important}

      /* DECISION RAIL: neutral idle, unmistakable selected */
      .mvp-auditionDecision{
        gap:16px!important;
        grid-template-columns:repeat(3,minmax(0,1fr))!important;
      }
      .mvp-auditionDecision button{
        min-height:76px!important;padding:0 18px!important;gap:15px!important;
        border:0!important;border-radius:9px!important;
        clip-path:polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,10px 100%,0 calc(100% - 10px))!important;
        outline:1px solid rgba(118,166,181,.13)!important;outline-offset:-1px!important;
        background:linear-gradient(180deg,rgba(8,19,24,.96),rgba(3,10,13,.985))!important;
        color:#879ba3!important;
        box-shadow:inset 0 1px rgba(255,255,255,.018),0 12px 26px rgba(0,0,0,.13)!important;
      }
      .mvp-auditionDecision button:after{opacity:0!important}
      .mvp-auditionDecision button:hover:not(:disabled){
        transform:translateY(-2px)!important;
        outline-color:rgba(146,200,218,.24)!important;
        background:linear-gradient(180deg,#0a2029,#050f14)!important;
      }
      .mvp-auditionDecisionIcon{
        width:41px!important;height:34px!important;flex:0 0 41px!important;
        border:0!important;border-radius:0!important;background:transparent!important;
        box-shadow:none!important;color:#82959c!important;
        display:grid!important;place-items:center!important;
      }
      .mvp-auditionDecisionIcon .mvp-svg{width:34px!important;height:28px!important;overflow:visible!important}
      .mvp-auditionDecision .is-keep:not(.is-active),
      .mvp-auditionDecision .is-maybe:not(.is-active),
      .mvp-auditionDecision .is-pass:not(.is-active){color:#879ba3!important}
      .mvp-auditionDecision .is-keep:not(.is-active) .mvp-auditionDecisionIcon,
      .mvp-auditionDecision .is-maybe:not(.is-active) .mvp-auditionDecisionIcon,
      .mvp-auditionDecision .is-pass:not(.is-active) .mvp-auditionDecisionIcon{color:#71868e!important}
      .mvp-auditionDecision button strong{color:#dce8ec!important;font-size:9px!important;letter-spacing:.14em!important}
      .mvp-auditionDecision button small{color:#596f78!important;font-size:6.5px!important}
      .mvp-auditionDecision .is-keep.is-active{
        outline-color:#56eca1!important;
        background:linear-gradient(110deg,rgba(21,78,53,.72),rgba(4,18,12,.98))!important;
        box-shadow:0 0 0 1px rgba(70,234,151,.15),0 0 36px rgba(64,224,141,.16),inset 0 1px rgba(255,255,255,.04)!important;
      }
      .mvp-auditionDecision .is-keep.is-active .mvp-auditionDecisionIcon{color:#70ffb3!important;filter:drop-shadow(0 0 8px rgba(69,234,151,.42))!important}
      .mvp-auditionDecision .is-keep.is-active strong{color:#b7ffd5!important}
      .mvp-auditionDecision .is-maybe.is-active{
        outline-color:#ffc14d!important;
        background:linear-gradient(110deg,rgba(91,63,12,.7),rgba(19,13,3,.98))!important;
        box-shadow:0 0 0 1px rgba(255,193,77,.13),0 0 34px rgba(244,177,54,.13)!important;
      }
      .mvp-auditionDecision .is-maybe.is-active .mvp-auditionDecisionIcon{color:#ffd26d!important;filter:drop-shadow(0 0 8px rgba(255,192,72,.35))!important}
      .mvp-auditionDecision .is-maybe.is-active strong{color:#ffe5a8!important}
      .mvp-auditionDecision .is-pass.is-active{
        outline-color:#ff6674!important;
        background:linear-gradient(110deg,rgba(87,24,34,.72),rgba(19,5,8,.98))!important;
        box-shadow:0 0 0 1px rgba(255,90,104,.13),0 0 34px rgba(239,66,82,.13)!important;
      }
      .mvp-auditionDecision .is-pass.is-active .mvp-auditionDecisionIcon{color:#ff7c88!important;filter:drop-shadow(0 0 8px rgba(255,77,92,.35))!important}
      .mvp-auditionDecision .is-pass.is-active strong{color:#ffc1c6!important}

      /* NAVIGATION - engineered chevrons, no generic button arrows */
      .mvp-auditionPager{
        grid-template-columns:minmax(125px,.75fr) auto minmax(180px,1.05fr)!important;
        gap:14px!important;margin-top:18px!important;
      }
      .mvp-auditionPager button{
        min-height:42px!important;padding:0 14px!important;border:0!important;border-radius:7px!important;
        background:linear-gradient(180deg,#061217,#030a0d)!important;
        outline:1px solid rgba(104,165,185,.11)!important;outline-offset:-1px!important;
        color:#718993!important;display:flex!important;align-items:center!important;justify-content:center!important;gap:10px!important;
      }
      .mvp-auditionPager button .mvp-svgChevron{width:9px!important;height:19px!important}
      .mvp-auditionPager button:not(:disabled):hover{color:#bfefff!important;outline-color:rgba(72,202,241,.23)!important}
      .mvp-auditionPager .is-next-unreviewed{
        color:#c9f4ff!important;
        background:linear-gradient(180deg,#092631,#05161d)!important;
        outline-color:rgba(64,202,242,.22)!important;
      }
      .mvp-auditionPager>span b{font-size:16px!important}
      .mvp-auditionPager>span small{font-size:5.8px!important;letter-spacing:.13em!important}

      /* KEPT SONGS - cinematic staging rails */
      .mvp-auditionKeptGrid{gap:9px!important}
      .mvp-auditionKeptGrid>article{
        position:relative!important;isolation:isolate!important;overflow:hidden!important;
        grid-template-columns:76px minmax(220px,1fr) auto!important;
        gap:16px!important;padding:12px 14px!important;
        border:0!important;border-radius:13px!important;
        outline:1px solid rgba(100,176,201,.10)!important;outline-offset:-1px!important;
        background:linear-gradient(110deg,rgba(8,21,27,.97),rgba(3,10,13,.985))!important;
        box-shadow:0 12px 32px rgba(0,0,0,.13),inset 0 1px rgba(255,255,255,.014)!important;
        transition:transform .16s ease,outline-color .16s ease,box-shadow .16s ease!important;
      }
      .mvp-auditionKeptGrid>article:hover{
        transform:translateY(-1px)!important;outline-color:rgba(87,203,237,.20)!important;
        box-shadow:0 16px 38px rgba(0,0,0,.18),inset 0 1px rgba(255,255,255,.02)!important;
      }
      .mvp-keptAmbient{
        position:absolute;z-index:-1;inset:-60px auto -60px -40px;width:360px;
        background-size:220px;background-position:25px center;background-repeat:no-repeat;
        filter:blur(48px) saturate(1.45);opacity:.105;transform:scale(1.16);
        mask-image:linear-gradient(90deg,#000,transparent 95%);
        -webkit-mask-image:linear-gradient(90deg,#000,transparent 95%);
      }
      .mvp-auditionKeptArt{
        width:76px!important;height:76px!important;border-radius:11px!important;
        box-shadow:0 12px 25px rgba(0,0,0,.30),0 0 0 1px rgba(255,255,255,.08)!important;
      }
      .mvp-auditionKeptInfo small{
        color:#75e6a8!important;font-size:6.2px!important;letter-spacing:.14em!important;
      }
      .mvp-auditionKeptInfo strong{font-size:15px!important;line-height:1.05!important;letter-spacing:-.025em!important}
      .mvp-auditionKeptInfo b{font-size:9.5px!important;color:#a7ccd7!important}
      .mvp-auditionKeptInfo p{font-size:6px!important;color:#58727b!important;margin-top:5px!important}
      .mvp-auditionKeptActions{gap:10px!important}
      .mvp-auditionKeptActions .mvp-keptAction{
        min-width:118px!important;min-height:50px!important;padding:0 11px!important;gap:8px!important;
        border:0!important;border-radius:8px!important;
        clip-path:polygon(0 0,calc(100% - 8px) 0,100% 8px,100% 100%,8px 100%,0 calc(100% - 8px))!important;
        outline:1px solid rgba(105,168,190,.11)!important;outline-offset:-1px!important;
        background:linear-gradient(180deg,#07151b,#030b0f)!important;
        box-shadow:none!important;
      }
      .mvp-auditionKeptActions .mvp-keptAction:hover{transform:translateY(-1px)!important;outline-color:rgba(90,202,236,.24)!important}
      .mvp-keptActionIcon{
        width:36px!important;height:28px!important;flex:0 0 36px!important;
        border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important;
        display:grid!important;place-items:center!important;
      }
      .mvp-keptActionIcon .mvp-svg{width:33px!important;height:24px!important;overflow:visible!important}
      .mvp-keptAction.is-preview .mvp-keptActionIcon{color:#6edfff!important}
      .mvp-keptAction.is-youtube .mvp-keptActionIcon{color:#fff!important}
      .mvp-keptAction.is-add{
        outline-color:rgba(255,169,48,.22)!important;
        background:linear-gradient(180deg,rgba(37,25,8,.80),rgba(11,10,6,.98))!important;
      }
      .mvp-keptAction.is-add .mvp-keptActionIcon{color:#ffb342!important}
      .mvp-keptAction strong{font-size:7px!important;letter-spacing:.11em!important}
      .mvp-keptAction small{font-size:5.6px!important;color:#617780!important}
      .mvp-keptMore summary{
        width:44px!important;height:44px!important;
        border:0!important;border-radius:7px!important;
        outline:1px solid rgba(103,164,185,.11)!important;outline-offset:-1px!important;
        background:#061116!important;color:#617a83!important;
      }
      .mvp-keptMore summary .mvp-svgMore{width:26px!important;height:9px!important}

      /* MOBILE: same premium SVG system, recomposed for touch */
      @media(max-width:760px){
        .mvp-auditionSongCard{
          grid-template-columns:1fr!important;gap:18px!important;padding:14px!important;border-radius:17px!important;
        }
        .mvp-auditionAmbient{
          inset:-60px!important;background-size:120% auto!important;background-position:center 8%!important;
          filter:blur(62px) saturate(1.45)!important;opacity:.15!important;
          mask-image:linear-gradient(180deg,#000 0 45%,transparent 74%)!important;
          -webkit-mask-image:linear-gradient(180deg,#000 0 45%,transparent 74%)!important;
        }
        .mvp-auditionArtwork{width:min(86vw,360px)!important;margin:0 auto!important;border-radius:16px!important}
        .mvp-auditionSongInfo h2{font-size:clamp(31px,10vw,45px)!important;text-align:left!important}
        .mvp-auditionSongInfo h3{font-size:16px!important}
        .mvp-auditionListen{grid-template-columns:1fr 1fr!important;gap:10px!important}
        .mvp-auditionListen button{min-height:62px!important;padding:0 12px!important;gap:8px!important}
        .mvp-auditionControlIcon{width:38px!important;height:28px!important;flex-basis:38px!important}
        .mvp-auditionControlIcon .mvp-svg{width:36px!important;height:25px!important}
        .mvp-auditionControlCopy strong{font-size:8px!important}
        .mvp-auditionControlCopy small{font-size:5.5px!important}
        .mvp-auditionActionLabel.is-decision{margin-top:21px!important}
        .mvp-auditionDecision{grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:7px!important}
        .mvp-auditionDecision button{
          min-height:67px!important;padding:7px 5px!important;gap:4px!important;
          display:grid!important;place-content:center!important;text-align:center!important;
        }
        .mvp-auditionDecisionIcon{width:31px!important;height:27px!important;flex-basis:auto!important;margin:auto!important}
        .mvp-auditionDecisionIcon .mvp-svg{width:29px!important;height:24px!important}
        .mvp-auditionDecision button>span:last-child{text-align:center!important}
        .mvp-auditionDecision button strong{font-size:7px!important}
        .mvp-auditionDecision button small{display:none!important}
        .mvp-auditionPager{grid-template-columns:1fr 1fr!important;gap:8px!important}
        .mvp-auditionPager>span{grid-column:1/-1!important;grid-row:1!important}
        .mvp-auditionPager button{min-height:42px!important}
        .mvp-auditionKeptGrid>article{
          grid-template-columns:64px minmax(0,1fr)!important;gap:11px!important;padding:10px!important;
        }
        .mvp-auditionKeptArt{width:64px!important;height:64px!important}
        .mvp-auditionKeptActions{
          grid-column:1/-1!important;
          display:grid!important;grid-template-columns:1fr 1fr 1.15fr 42px!important;gap:6px!important;width:100%!important;
        }
        .mvp-auditionKeptActions .mvp-keptAction{
          min-width:0!important;width:100%!important;min-height:48px!important;padding:0 6px!important;gap:5px!important;
        }
        .mvp-keptActionIcon{width:27px!important;height:23px!important;flex-basis:27px!important}
        .mvp-keptActionIcon .mvp-svg{width:27px!important;height:21px!important}
        .mvp-keptAction strong{font-size:6.2px!important}
        .mvp-keptAction small{display:none!important}
        .mvp-keptMore summary{width:42px!important;height:48px!important}
      }
      @media(max-width:430px){
        .mvp-auditionListen{grid-template-columns:1fr!important}
        .mvp-auditionListen button{min-height:60px!important}
        .mvp-auditionKeptActions{grid-template-columns:1fr 1fr!important}
        .mvp-auditionKeptActions .is-add{grid-column:1/-1!important}
        .mvp-keptMore{position:absolute!important;right:8px!important;top:8px!important}
      }

    `}
</style>
  </section>;
}
