import {
  updateMusicTrack,
  uploadRemoteMusicArtwork,
  type MusicTrack,
} from "./musicStorage";

export type MusicMetadataCandidate = {
  sourceId: string;
  title: string;
  artist: string;
  album: string;
  releaseYear: number | null;
  genre: string | null;
  artworkUrl: string | null;
  durationSeconds: number | null;
  confidence: number;
  source: "itunes";
};

export type MusicEnrichmentResult = {
  track: MusicTrack;
  status: "matched" | "review" | "not_found";
  candidate: MusicMetadataCandidate | null;
  candidates: MusicMetadataCandidate[];
  changed: boolean;
};

type ItunesResult = {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  artworkUrl100?: string;
  releaseDate?: string;
  primaryGenreName?: string;
  trackTimeMillis?: number;
};

type ItunesResponse = {
  resultCount?: number;
  results?: ItunesResult[];
};

const LOOKUP_CACHE = new Map<string, MusicMetadataCandidate[]>();

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/\b(feat|featuring|ft)\.?\b.*$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenScore(left: string, right: string) {
  const a = new Set(normalize(left).split(" ").filter(Boolean));
  const b = new Set(normalize(right).split(" ").filter(Boolean));
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

function textScore(left: string, right: string) {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.86;
  return tokenScore(a, b);
}

export function cleanMusicLookupTitle(track: Pick<MusicTrack, "title" | "original_name">) {
  const originalStem = track.original_name
    .replace(/\.[^.]+$/, "")
    .replace(/[_]+/g, " ")
    .replace(/^\s*\d{1,3}\s*[.\-_ ]+\s*/, "")
    .replace(/\s+[\-_ ]*\(?copy\)?\s*$/i, "")
    .replace(/\s+\(\d+\)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();

  const current = track.title
    .replace(/^\s*\d{1,3}\s*[.\-_ ]+\s*/, "")
    .replace(/\s+\(\d+\)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();

  const currentLooksGeneric =
    !current ||
    /^(track|audio|song|untitled)(\s*\d+)?$/i.test(current) ||
    normalize(current) === normalize(track.original_name.replace(/\.[^.]+$/, ""));

  return (currentLooksGeneric ? originalStem : current) || originalStem || track.title;
}

function artwork600(url?: string) {
  if (!url) return null;
  return url
    .replace(/\/100x100bb\./, "/600x600bb.")
    .replace(/\/100x100bb-/, "/600x600bb-");
}

function yearFromDate(value?: string) {
  if (!value) return null;
  const match = value.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function scoreCandidate(track: MusicTrack, candidate: Omit<MusicMetadataCandidate, "confidence">) {
  const lookupTitle = cleanMusicLookupTitle(track);
  const title = textScore(lookupTitle, candidate.title);
  const artistKnown = Boolean(track.artist && !/unknown artist/i.test(track.artist));
  const artist = artistKnown ? textScore(track.artist || "", candidate.artist) : 0.72;
  const albumKnown = Boolean(track.album);
  const album = albumKnown ? textScore(track.album || "", candidate.album) : 0.66;

  let duration = 0.7;
  if (track.duration_seconds && candidate.durationSeconds) {
    const difference = Math.abs(track.duration_seconds - candidate.durationSeconds);
    duration = difference <= 2 ? 1 : difference <= 5 ? 0.94 : difference <= 10 ? 0.78 : difference <= 20 ? 0.55 : 0.2;
  }

  let score = title * 0.57 + artist * 0.23 + duration * 0.14 + album * 0.06;
  if (title === 1 && artist >= 0.9) score += 0.05;
  return Math.max(0, Math.min(1, score));
}

async function searchItunes(term: string) {
  const key = normalize(term);
  const cached = LOOKUP_CACHE.get(key);
  if (cached) return cached;

  const url = `https://itunes.apple.com/search?entity=song&limit=12&term=${encodeURIComponent(term)}`;
  const response = await fetch(url, { mode: "cors", cache: "no-store" });
  if (!response.ok) throw new Error(`Music lookup failed (${response.status}).`);
  const payload = (await response.json()) as ItunesResponse;

  const base = (payload.results || [])
    .filter((item) => item.trackName && item.artistName)
    .map((item) => ({
      sourceId: String(item.trackId || `${item.artistName}-${item.trackName}`),
      title: item.trackName || "",
      artist: item.artistName || "",
      album: item.collectionName || "",
      releaseYear: yearFromDate(item.releaseDate),
      genre: item.primaryGenreName || null,
      artworkUrl: artwork600(item.artworkUrl100),
      durationSeconds: item.trackTimeMillis ? Math.round(item.trackTimeMillis / 1000) : null,
      source: "itunes" as const,
    }));

  LOOKUP_CACHE.set(key, base.map((item) => ({ ...item, confidence: 0 })));
  return base.map((item) => ({ ...item, confidence: 0 }));
}

export async function findMusicMetadataCandidates(track: MusicTrack) {
  const title = cleanMusicLookupTitle(track);
  const artistKnown = Boolean(track.artist && !/unknown artist/i.test(track.artist));
  const searchTerms = [
    artistKnown ? `${track.artist} ${title}` : title,
    artistKnown ? title : "",
  ].filter(Boolean);

  const combined = new Map<string, MusicMetadataCandidate>();
  for (const term of searchTerms) {
    const rows = await searchItunes(term);
    for (const row of rows) {
      const scored = { ...row, confidence: scoreCandidate(track, row) };
      const previous = combined.get(scored.sourceId);
      if (!previous || scored.confidence > previous.confidence) combined.set(scored.sourceId, scored);
    }
    if (combined.size >= 6) break;
  }

  return [...combined.values()]
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 6);
}

export function needsMusicMetadata(track: MusicTrack) {
  const missingArtist = !track.artist || /unknown artist/i.test(track.artist);
  const missingAlbum = !track.album;
  const genericTitle = /^(track|audio|song|untitled)(\s*\d+)?$/i.test(track.title.trim());
  const filenameTitle = normalize(track.title) === normalize(track.original_name.replace(/\.[^.]+$/, ""));
  return missingArtist || missingAlbum || genericTitle || filenameTitle;
}

export function needsMusicArtwork(track: MusicTrack) {
  return !track.artwork_path && !track.external_artwork_url;
}

export async function applyMusicMetadataCandidate(
  track: MusicTrack,
  candidate: MusicMetadataCandidate,
  status: "matched" | "manual" = "matched"
) {
  let updated = await updateMusicTrack(track.id, {
    title: candidate.title,
    artist: candidate.artist,
    album: candidate.album,
    release_year: candidate.releaseYear,
    genre: candidate.genre,
    metadata_status: status,
    metadata_confidence: status === "manual" ? 1 : candidate.confidence,
    metadata_source: candidate.source,
    metadata_updated_at: new Date().toISOString(),
  });

  if (candidate.artworkUrl && needsMusicArtwork(updated)) {
    updated = await uploadRemoteMusicArtwork(updated, candidate.artworkUrl);
  }
  return updated;
}

export async function enrichMusicTrack(
  track: MusicTrack,
  options?: { artworkOnly?: boolean; autoApplyThreshold?: number }
): Promise<MusicEnrichmentResult> {
  const candidates = await findMusicMetadataCandidates(track);
  const candidate = candidates[0] || null;
  const threshold = options?.autoApplyThreshold ?? 0.84;

  if (!candidate) {
    return { track, status: "not_found", candidate: null, candidates: [], changed: false };
  }

  if (options?.artworkOnly) {
    if (candidate.artworkUrl && candidate.confidence >= 0.72) {
      const updated = await uploadRemoteMusicArtwork(track, candidate.artworkUrl);
      return {
        track: updated,
        status: candidate.confidence >= threshold ? "matched" : "review",
        candidate,
        candidates,
        changed: updated.artwork_path !== track.artwork_path || updated.external_artwork_url !== track.external_artwork_url,
      };
    }
    return { track, status: "review", candidate, candidates, changed: false };
  }

  if (candidate.confidence >= threshold) {
    const updated = await applyMusicMetadataCandidate(track, candidate, "matched");
    return { track: updated, status: "matched", candidate, candidates, changed: true };
  }

  await updateMusicTrack(track.id, {
    metadata_status: "review",
    metadata_confidence: candidate.confidence,
    metadata_source: candidate.source,
    metadata_updated_at: new Date().toISOString(),
  });

  return { track, status: "review", candidate, candidates, changed: false };
}

export async function delayMusicLookup(milliseconds = 275) {
  await new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}
