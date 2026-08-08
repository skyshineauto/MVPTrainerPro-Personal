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

type LookupSignals = {
  primaryTitle: string;
  titleVariants: string[];
  artistVariants: string[];
  knownArtist: string | null;
};

const LOOKUP_CACHE = new Map<
  string,
  Omit<MusicMetadataCandidate, "confidence">[]
>();

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/\b(feat|featuring|ft)\.?\b.*$/i, "")
    .replace(
      /\b(remaster(?:ed)?|deluxe|explicit|clean|radio edit|single version|album version)\b/gi,
      " "
    )
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueUseful(values: Array<string | null | undefined>) {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const raw of values) {
    const value = (raw || "").replace(/\s+/g, " ").trim();
    const key = normalize(value);
    if (!value || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }

  return result;
}

function filenameStem(value: string) {
  return value
    .replace(/\.[^.]+$/, "")
    .replace(/_/g, " ")
    .replace(/^\s*\d{1,3}\s*[.\-_ ]+\s*/, "")
    .replace(/^\s*\d{1,3}\s*-\s*/, "")
    .replace(/\s+[\-_ ]*\(?copy\)?\s*$/i, "")
    .replace(/\s+\(\d+\)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function removeLookupNoise(value: string) {
  return value
    .replace(/^\s*\d{1,3}\s*[.\-_ ]+\s*/, "")
    .replace(
      /\s*[\[(]\s*(official\s+)?(music\s+)?video\s*[\])]\s*/gi,
      " "
    )
    .replace(/\s*[\[(]\s*(official\s+)?audio\s*[\])]\s*/gi, " ")
    .replace(/\s*[\[(]\s*lyrics?\s*[\])]\s*/gi, " ")
    .replace(/\s*[\[(]\s*lyric\s+video\s*[\])]\s*/gi, " ")
    .replace(/\s*[\[(]\s*visuali[sz]er\s*[\])]\s*/gi, " ")
    .replace(/\s*[\[(]\s*audio\s*[\])]\s*/gi, " ")
    .replace(/\s*[\[(]\s*hd\s*[\])]\s*/gi, " ")
    .replace(/\s*[\[(]\s*4k\s*[\])]\s*/gi, " ")
    .replace(/\s*[\[(]\s*explicit\s*[\])]\s*/gi, " ")
    .replace(/\s*[\[(]\s*clean\s*[\])]\s*/gi, " ")
    .replace(/\s*[\[(]\s*remaster(?:ed)?(?:\s+\d{4})?\s*[\])]\s*/gi, " ")
    .replace(/\s*[\[(]\s*\d{4}\s+remaster(?:ed)?\s*[\])]\s*/gi, " ")
    .replace(/\s*[\[(]\s*radio\s+edit\s*[\])]\s*/gi, " ")
    .replace(/\s*[\[(]\s*single\s+version\s*[\])]\s*/gi, " ")
    .replace(/\s*[\[(]\s*album\s+version\s*[\])]\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksGeneric(value: string) {
  return /^(track|audio|song|untitled)(\s*\d+)?$/i.test(value.trim());
}

function splitArtistTitle(value: string) {
  const cleaned = removeLookupNoise(value);
  const separators = [" - ", " – ", " — ", " | "];

  for (const separator of separators) {
    const index = cleaned.indexOf(separator);
    if (index <= 0) continue;

    const left = cleaned.slice(0, index).trim();
    const right = cleaned.slice(index + separator.length).trim();

    if (left && right) return { left, right };
  }

  return null;
}

function tokenScore(left: string, right: string) {
  const a = new Set(normalize(left).split(" ").filter(Boolean));
  const b = new Set(normalize(right).split(" ").filter(Boolean));
  if (!a.size || !b.size) return 0;

  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }

  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

function textScore(left: string, right: string) {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const token = tokenScore(a, b);
  const contains = a.includes(b) || b.includes(a);

  if (contains && token >= 0.75) return 0.94;
  if (contains) return Math.max(0.84, token);
  return token;
}

function durationScore(
  trackSeconds: number | null,
  candidateSeconds: number | null
) {
  if (!trackSeconds || !candidateSeconds) return 0.7;

  const difference = Math.abs(trackSeconds - candidateSeconds);
  if (difference <= 2) return 1;
  if (difference <= 5) return 0.98;
  if (difference <= 8) return 0.94;
  if (difference <= 12) return 0.86;
  if (difference <= 18) return 0.72;
  if (difference <= 25) return 0.54;
  if (difference <= 40) return 0.28;
  return 0.08;
}

export function cleanMusicLookupTitle(
  track: Pick<MusicTrack, "title" | "original_name">
) {
  const originalStem = removeLookupNoise(filenameStem(track.original_name || ""));
  const current = removeLookupNoise(track.title || "");

  if (!current || looksGeneric(current)) {
    const split = splitArtistTitle(originalStem);
    return split?.right || originalStem || current || track.title;
  }

  const splitCurrent = splitArtistTitle(current);
  if (splitCurrent) return splitCurrent.right;

  return current || originalStem || track.title;
}

function buildLookupSignals(track: MusicTrack): LookupSignals {
  const rawTitle = removeLookupNoise(track.title || "");
  const stem = removeLookupNoise(filenameStem(track.original_name || ""));
  const knownArtist =
    track.artist && !/unknown artist/i.test(track.artist)
      ? removeLookupNoise(track.artist)
      : null;

  const titleVariants: string[] = [];
  const artistVariants: string[] = [];

  if (rawTitle && !looksGeneric(rawTitle)) titleVariants.push(rawTitle);
  if (stem && !looksGeneric(stem)) titleVariants.push(stem);
  if (knownArtist) artistVariants.push(knownArtist);

  const titleSplit = splitArtistTitle(rawTitle);
  const fileSplit = splitArtistTitle(stem);

  const addSplit = (split: { left: string; right: string } | null) => {
    if (!split) return;

    if (knownArtist) {
      const leftArtistScore = textScore(split.left, knownArtist);
      const rightArtistScore = textScore(split.right, knownArtist);

      if (leftArtistScore >= rightArtistScore && leftArtistScore >= 0.62) {
        titleVariants.push(split.right);
        artistVariants.push(split.left);
        return;
      }

      if (rightArtistScore > leftArtistScore && rightArtistScore >= 0.62) {
        titleVariants.push(split.left);
        artistVariants.push(split.right);
        return;
      }
    }

    // With no reliable artist tag, "Artist - Title" is the most common import
    // filename pattern. Search both directions, but prefer the right side as title.
    titleVariants.push(split.right, split.left);
    artistVariants.push(split.left);
  };

  addSplit(titleSplit);
  addSplit(fileSplit);

  if (knownArtist) {
    for (const title of [...titleVariants]) {
      const artistPrefix = new RegExp(
        `^${knownArtist.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[-–—|:]\\s*`,
        "i"
      );
      titleVariants.push(title.replace(artistPrefix, "").trim());
    }
  }

  const titles = uniqueUseful(titleVariants)
    .map(removeLookupNoise)
    .filter((value) => value.length >= 2);

  const artists = uniqueUseful(artistVariants)
    .map(removeLookupNoise)
    .filter((value) => value.length >= 2);

  const primaryTitle =
    titles.find((value) => !splitArtistTitle(value)) ||
    cleanMusicLookupTitle(track) ||
    titles[0] ||
    track.title;

  return {
    primaryTitle,
    titleVariants: uniqueUseful([primaryTitle, ...titles]).slice(0, 6),
    artistVariants: uniqueUseful(artists).slice(0, 4),
    knownArtist,
  };
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

function bestTextScore(values: string[], candidate: string) {
  if (!values.length) return 0;
  return Math.max(...values.map((value) => textScore(value, candidate)));
}

function exactAgainst(values: string[], candidate: string) {
  const target = normalize(candidate);
  return values.some((value) => normalize(value) === target);
}

function scoreCandidate(
  track: MusicTrack,
  signals: LookupSignals,
  candidate: Omit<MusicMetadataCandidate, "confidence">
) {
  const titleSimilarity = bestTextScore(signals.titleVariants, candidate.title);
  const titleExact = exactAgainst(signals.titleVariants, candidate.title);

  const artistKnown = Boolean(signals.knownArtist);
  const artistSimilarity = signals.artistVariants.length
    ? bestTextScore(signals.artistVariants, candidate.artist)
    : 0.72;
  const artistExact = signals.artistVariants.length
    ? exactAgainst(signals.artistVariants, candidate.artist)
    : false;

  const albumSimilarity = track.album
    ? textScore(track.album, candidate.album)
    : 0.66;

  const duration = durationScore(
    track.duration_seconds,
    candidate.durationSeconds
  );

  if (titleExact && artistExact) {
    return Math.min(1, 0.972 + duration * 0.028);
  }

  if (titleExact && artistKnown && artistSimilarity >= 0.9) {
    return Math.min(0.972, 0.91 + artistSimilarity * 0.035 + duration * 0.027);
  }

  if (titleExact && !artistKnown) {
    // Exact title is meaningful, but without a verified artist it remains
    // conservative unless duration also agrees.
    return Math.min(0.944, 0.835 + duration * 0.105);
  }

  if (artistExact && titleSimilarity >= 0.82) {
    return Math.min(
      0.92,
      titleSimilarity * 0.7 + duration * 0.16 + albumSimilarity * 0.04
    );
  }

  let score =
    titleSimilarity * 0.7 +
    artistSimilarity * 0.17 +
    duration * 0.09 +
    albumSimilarity * 0.04;

  // Strongly punish "same artist, wrong song". This was the most damaging
  // failure mode in the previous matcher.
  if (artistExact && titleSimilarity < 0.5) score *= 0.56;
  if (titleSimilarity < 0.4) score *= 0.55;
  if (titleSimilarity < 0.25) score *= 0.55;

  // If a filename/title split produced a very strong title match, keep it
  // competitive even when the imported artist field was blank.
  if (!artistKnown && titleSimilarity >= 0.9 && duration >= 0.72) {
    score = Math.max(score, 0.82 + duration * 0.08);
  }

  return Math.max(0, Math.min(0.9, score));
}

async function searchItunes(
  term: string,
  attribute: SearchAttribute = null,
  limit = 50
) {
  const cleanTerm = term.replace(/\s+/g, " ").trim();
  const cacheKey = `${attribute || "all"}:${normalize(cleanTerm)}:${limit}`;
  const cached = LOOKUP_CACHE.get(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({
    entity: "song",
    limit: String(limit),
    term: cleanTerm,
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
        item.trackId ||
          `${item.artistName}-${item.trackName}-${item.collectionName || ""}`
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
  const signals = buildLookupSignals(track);

  const searchPlan: Array<{
    term: string;
    attribute: SearchAttribute;
    limit: number;
  }> = [];

  const addSearch = (
    term: string,
    attribute: SearchAttribute = null,
    limit = 50
  ) => {
    const clean = term.replace(/\s+/g, " ").trim();
    if (!clean) return;

    const key = `${attribute || "all"}:${normalize(clean)}`;
    if (
      searchPlan.some(
        (item) =>
          `${item.attribute || "all"}:${normalize(item.term)}` === key
      )
    ) {
      return;
    }

    searchPlan.push({ term: clean, attribute, limit });
  };

  // Search title as a song first. iTunes' songTerm index is far less likely
  // to return a popular but unrelated song by the same artist.
  for (const title of signals.titleVariants.slice(0, 4)) {
    addSearch(title, "songTerm", 60);
  }

  // Artist + title is excellent when either embedded tags or filename parsing
  // supplied an artist.
  for (const artist of signals.artistVariants.slice(0, 2)) {
    for (const title of signals.titleVariants.slice(0, 3)) {
      addSearch(`${artist} ${title}`, null, 60);
    }
  }

  // Broad title search catches punctuation, catalog naming, and alternate
  // release formatting that songTerm occasionally misses.
  for (const title of signals.titleVariants.slice(0, 3)) {
    addSearch(title, null, 60);
  }

  // Last-resort artist query is intentionally last because artist-only results
  // used to crowd out the correct title.
  if (signals.knownArtist) {
    addSearch(signals.knownArtist, "artistTerm", 35);
  }

  const combined = new Map<string, MusicMetadataCandidate>();

  // Keep the request count bounded even when a messy filename generated many
  // useful variants.
  for (const request of searchPlan.slice(0, 10)) {
    const rows = await searchItunes(
      request.term,
      request.attribute,
      request.limit
    );

    for (const row of rows) {
      const scored: MusicMetadataCandidate = {
        ...row,
        confidence: scoreCandidate(track, signals, row),
      };

      const dedupeKey = row.sourceId
        ? `id:${row.sourceId}`
        : `${normalize(row.artist)}|${normalize(row.title)}|${normalize(row.album)}`;

      const previous = combined.get(dedupeKey);
      if (!previous || scored.confidence > previous.confidence) {
        combined.set(dedupeKey, scored);
      }
    }
  }

  const ranked = [...combined.values()]
    .sort((left, right) => {
      const leftTitleExact = exactAgainst(
        signals.titleVariants,
        left.title
      );
      const rightTitleExact = exactAgainst(
        signals.titleVariants,
        right.title
      );

      const leftArtistExact = signals.artistVariants.length
        ? exactAgainst(signals.artistVariants, left.artist)
        : false;
      const rightArtistExact = signals.artistVariants.length
        ? exactAgainst(signals.artistVariants, right.artist)
        : false;

      const leftPerfect = leftTitleExact && leftArtistExact;
      const rightPerfect = rightTitleExact && rightArtistExact;

      if (leftPerfect !== rightPerfect) return leftPerfect ? -1 : 1;
      if (leftTitleExact !== rightTitleExact) return leftTitleExact ? -1 : 1;

      if (right.confidence !== left.confidence) {
        return right.confidence - left.confidence;
      }

      const trackDuration = track.duration_seconds || 0;
      const leftDifference = Math.abs(
        trackDuration - (left.durationSeconds || trackDuration)
      );
      const rightDifference = Math.abs(
        trackDuration - (right.durationSeconds || trackDuration)
      );
      return leftDifference - rightDifference;
    })
    .filter((candidate, index) => candidate.confidence >= 0.2 || index < 5);

  // Twelve review choices is still compact in the new scrollable result panel,
  // but gives obscure/older recordings a much better chance of appearing.
  return ranked.slice(0, 12);
}

export function musicMatchTier(confidence: number) {
  if (confidence >= 0.95) return "EXACT MATCH";
  if (confidence >= 0.84) return "STRONG MATCH";
  if (confidence >= 0.62) return "POSSIBLE MATCH";
  return "WEAK MATCH";
}

export function needsMusicMetadata(track: MusicTrack) {
  const missingArtist =
    !track.artist || /unknown artist/i.test(track.artist);
  const missingAlbum = !track.album;
  const genericTitle = looksGeneric(track.title);
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
    metadata_confidence:
      status === "manual" ? 1 : candidate.confidence,
    metadata_source: candidate.source,
    metadata_updated_at: new Date().toISOString(),
  });

  if (candidate.artworkUrl && needsMusicArtwork(updated)) {
    updated = await uploadRemoteMusicArtwork(
      updated,
      candidate.artworkUrl
    );
  }

  return updated;
}

export async function enrichMusicTrack(
  track: MusicTrack,
  options?: {
    artworkOnly?: boolean;
    autoApplyThreshold?: number;
  }
): Promise<MusicEnrichmentResult> {
  const candidates = await findMusicMetadataCandidates(track);
  const candidate = candidates[0] || null;
  const threshold = options?.autoApplyThreshold ?? 0.955;

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
    if (
      candidate.artworkUrl &&
      candidate.confidence >= 0.76
    ) {
      const updated = await uploadRemoteMusicArtwork(
        track,
        candidate.artworkUrl
      );

      return {
        track: updated,
        status:
          candidate.confidence >= threshold
            ? "matched"
            : "review",
        candidate,
        candidates,
        changed:
          updated.artwork_path !== track.artwork_path ||
          updated.external_artwork_url !==
            track.external_artwork_url,
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

export async function delayMusicLookup(milliseconds = 225) {
  await new Promise<void>((resolve) =>
    window.setTimeout(resolve, milliseconds)
  );
}
