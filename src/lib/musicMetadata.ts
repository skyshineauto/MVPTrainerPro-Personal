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

type SearchAttribute = "songTerm" | "artistTerm" | null;

const LOOKUP_CACHE = new Map<string, Omit<MusicMetadataCandidate, "confidence">[]>();

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/\b(feat|featuring|ft)\.?\b.*$/i, "")
    .replace(/\b(remaster(?:ed)?|deluxe|explicit|clean|radio edit|single version)\b/gi, " ")
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
  if (a.includes(b) || b.includes(a)) return 0.88;
  return tokenScore(a, b);
}

function durationScore(trackSeconds: number | null, candidateSeconds: number | null) {
  if (!trackSeconds || !candidateSeconds) return 0.72;
  const difference = Math.abs(trackSeconds - candidateSeconds);
  if (difference <= 2) return 1;
  if (difference <= 5) return 0.98;
  if (difference <= 10) return 0.91;
  if (difference <= 15) return 0.80;
  if (difference <= 25) return 0.58;
  return 0.18;
}

export function cleanMusicLookupTitle(
  track: Pick<MusicTrack, "title" | "original_name">
) {
  const originalStem = track.original_name
    .replace(/\.[^.]+$/, "")
    .replace(/[_]+/g, " ")
    .replace(/^\s*\d{1,3}\s*[.\-_ ]+\s*/, "")
    .replace(/^\s*\d{1,3}\s*-\s*/, "")
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
    /^(track|audio|song|untitled)(\s*\d+)?$/i.test(current);

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

function scoreCandidate(
  track: MusicTrack,
  candidate: Omit<MusicMetadataCandidate, "confidence">
) {
  const lookupTitle = cleanMusicLookupTitle(track);
  const titleExact = normalize(lookupTitle) === normalize(candidate.title);
  const titleSimilarity = textScore(lookupTitle, candidate.title);

  const artistKnown = Boolean(
    track.artist && !/unknown artist/i.test(track.artist)
  );
  const artistExact =
    artistKnown && normalize(track.artist || "") === normalize(candidate.artist);
  const artistSimilarity = artistKnown
    ? textScore(track.artist || "", candidate.artist)
    : 0.74;

  const albumKnown = Boolean(track.album);
  const albumSimilarity = albumKnown
    ? textScore(track.album || "", candidate.album)
    : 0.68;

  const duration = durationScore(
    track.duration_seconds,
    candidate.durationSeconds
  );

  // Exact title + exact artist is the dominant signal. This prevents popular
  // songs by the same artist from crowding out the song the library already named.
  if (titleExact && artistExact) {
    return Math.min(1, 0.965 + duration * 0.035);
  }

  // Exact title with a very strong artist match is still excellent.
  if (titleExact && artistSimilarity >= 0.9) {
    return Math.min(0.96, 0.89 + artistSimilarity * 0.045 + duration * 0.025);
  }

  // If the artist is unknown, an exact title plus close duration is useful,
  // but stays below exact artist/title matches so review remains conservative.
  if (titleExact && !artistKnown) {
    return Math.min(0.93, 0.83 + duration * 0.10);
  }

  // Strong fuzzy title + exact artist.
  if (artistExact && titleSimilarity >= 0.78) {
    return Math.min(
      0.89,
      titleSimilarity * 0.68 + duration * 0.17 + albumSimilarity * 0.04
    );
  }

  // General fallback. Same-artist / wrong-title results intentionally remain low.
  let score =
    titleSimilarity * 0.66 +
    artistSimilarity * 0.19 +
    duration * 0.10 +
    albumSimilarity * 0.05;

  if (artistExact && titleSimilarity < 0.45) score *= 0.72;
  if (titleSimilarity < 0.25) score *= 0.72;

  return Math.max(0, Math.min(0.84, score));
}

async function searchItunes(
  term: string,
  attribute: SearchAttribute = null,
  limit = 50
) {
  const cacheKey = `${attribute || "all"}:${normalize(term)}:${limit}`;
  const cached = LOOKUP_CACHE.get(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({
    entity: "song",
    limit: String(limit),
    term,
  });
  if (attribute) params.set("attribute", attribute);

  const response = await fetch(
    `https://itunes.apple.com/search?${params.toString()}`,
    { mode: "cors", cache: "no-store" }
  );

  if (!response.ok) {
    throw new Error(`Music lookup failed (${response.status}).`);
  }

  const payload = (await response.json()) as ItunesResponse;

  const rows = (payload.results || [])
    .filter((item) => item.trackName && item.artistName)
    .map((item) => ({
      sourceId: String(
        item.trackId || `${item.artistName}-${item.trackName}-${item.collectionName || ""}`
      ),
      title: item.trackName || "",
      artist: item.artistName || "",
      album: item.collectionName || "",
      releaseYear: yearFromDate(item.releaseDate),
      genre: item.primaryGenreName || null,
      artworkUrl: artwork600(item.artworkUrl100),
      durationSeconds: item.trackTimeMillis
        ? Math.round(item.trackTimeMillis / 1000)
        : null,
      source: "itunes" as const,
    }));

  LOOKUP_CACHE.set(cacheKey, rows);
  return rows;
}

export async function findMusicMetadataCandidates(track: MusicTrack) {
  const title = cleanMusicLookupTitle(track);
  const artistKnown = Boolean(
    track.artist && !/unknown artist/i.test(track.artist)
  );

  // Search in tiers instead of stopping after the first handful of generic results.
  // 1. Exact song-title field search
  // 2. Artist + title broad search
  // 3. Title broad search
  // 4. Artist field fallback, only when artist is known
  const searchPlan: Array<{
    term: string;
    attribute: SearchAttribute;
    limit: number;
  }> = [
    { term: title, attribute: "songTerm", limit: 50 },
    ...(artistKnown
      ? [{ term: `${track.artist} ${title}`, attribute: null as SearchAttribute, limit: 50 }]
      : []),
    { term: title, attribute: null, limit: 50 },
    ...(artistKnown
      ? [{ term: track.artist || "", attribute: "artistTerm" as SearchAttribute, limit: 25 }]
      : []),
  ];

  const combined = new Map<string, MusicMetadataCandidate>();

  for (const request of searchPlan) {
    if (!request.term.trim()) continue;

    const rows = await searchItunes(
      request.term,
      request.attribute,
      request.limit
    );

    for (const row of rows) {
      const scored: MusicMetadataCandidate = {
        ...row,
        confidence: scoreCandidate(track, row),
      };
      const previous = combined.get(scored.sourceId);
      if (!previous || scored.confidence > previous.confidence) {
        combined.set(scored.sourceId, scored);
      }
    }
  }

  const ranked = [...combined.values()]
    .sort((left, right) => {
      const leftExact =
        normalize(left.title) === normalize(title) &&
        (!artistKnown ||
          normalize(left.artist) === normalize(track.artist || ""));
      const rightExact =
        normalize(right.title) === normalize(title) &&
        (!artistKnown ||
          normalize(right.artist) === normalize(track.artist || ""));

      if (leftExact !== rightExact) return leftExact ? -1 : 1;
      if (right.confidence !== left.confidence) {
        return right.confidence - left.confidence;
      }

      return (
        Math.abs((track.duration_seconds || 0) - (left.durationSeconds || 0)) -
        Math.abs((track.duration_seconds || 0) - (right.durationSeconds || 0))
      );
    })
    .filter((candidate, index) => candidate.confidence >= 0.24 || index < 3);

  return ranked.slice(0, 8);
}

export function musicMatchTier(confidence: number) {
  if (confidence >= 0.95) return "EXACT MATCH";
  if (confidence >= 0.85) return "STRONG MATCH";
  if (confidence >= 0.60) return "POSSIBLE MATCH";
  return "WEAK MATCH";
}

export function needsMusicMetadata(track: MusicTrack) {
  const missingArtist = !track.artist || /unknown artist/i.test(track.artist);
  const missingAlbum = !track.album;
  const genericTitle = /^(track|audio|song|untitled)(\s*\d+)?$/i.test(
    track.title.trim()
  );

  return missingArtist || missingAlbum || genericTitle;
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

  // Only very strong matches auto-apply. Everything else is kept for review.
  const threshold = options?.autoApplyThreshold ?? 0.95;

  if (!candidate) {
    return {
      track,
      status: "not_found",
      candidate: null,
      candidates: [],
      changed: false,
    };
  }

  if (options?.artworkOnly) {
    if (candidate.artworkUrl && candidate.confidence >= 0.78) {
      const updated = await uploadRemoteMusicArtwork(
        track,
        candidate.artworkUrl
      );

      return {
        track: updated,
        status:
          candidate.confidence >= threshold ? "matched" : "review",
        candidate,
        candidates,
        changed:
          updated.artwork_path !== track.artwork_path ||
          updated.external_artwork_url !== track.external_artwork_url,
      };
    }

    return {
      track,
      status: "review",
      candidate,
      candidates,
      changed: false,
    };
  }

  if (candidate.confidence >= threshold) {
    const updated = await applyMusicMetadataCandidate(
      track,
      candidate,
      "matched"
    );

    return {
      track: updated,
      status: "matched",
      candidate,
      candidates,
      changed: true,
    };
  }

  await updateMusicTrack(track.id, {
    metadata_status: "review",
    metadata_confidence: candidate.confidence,
    metadata_source: candidate.source,
    metadata_updated_at: new Date().toISOString(),
  });

  return {
    track,
    status: "review",
    candidate,
    candidates,
    changed: false,
  };
}

export async function delayMusicLookup(milliseconds = 275) {
  await new Promise<void>((resolve) =>
    window.setTimeout(resolve, milliseconds)
  );
}
