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
  artworkFallbackUrl?: string | null;
  durationSeconds: number | null;
  confidence: number;
  recordingConfidence?: number;
  releaseConfidence?: number;
  releaseContext?: string | null;
  source: "itunes" | "musicbrainz";
  releaseQuality?: number;
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
  collectionId?: number;
  wrapperType?: string;
  collectionType?: string;
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

type MusicBrainzArtistCredit = {
  name?: string;
  joinphrase?: string;
  artist?: { name?: string };
};

type MusicBrainzRelease = {
  id?: string;
  title?: string;
  date?: string;
};

type MusicBrainzRecording = {
  id?: string;
  title?: string;
  length?: number;
  "first-release-date"?: string;
  "artist-credit"?: MusicBrainzArtistCredit[];
  releases?: MusicBrainzRelease[];
};

type MusicBrainzResponse = {
  recordings?: MusicBrainzRecording[];
};


type SearchAttribute = "songTerm" | "artistTerm" | null;

export type MusicLookupRetryInfo = {
  status: number;
  attempt: number;
  delayMs: number;
};

export type MusicLookupDiagnostics = {
  rawCandidates: number;
  acceptedCandidates: number;
  returnedCandidates: number;
  reason: "matches" | "no_catalog_results" | "low_confidence";
};

type LookupOptions = {
  onRetry?: (info: MusicLookupRetryInfo) => void;
  onDiagnostics?: (info: MusicLookupDiagnostics) => void;
  includeLowConfidence?: boolean;
};

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
const ARTWORK_LOOKUP_CACHE = new Map<
  string,
  Omit<MusicMetadataCandidate, "confidence">[]
>();

const LOOKUP_MIN_GAP_MS = 3300;
const MUSICBRAINZ_MIN_GAP_MS = 1150;
const LOOKUP_RETRY_DELAYS_MS = [5000, 8000, 12000];
let lastLookupRequestAt = 0;
let lookupGate: Promise<void> = Promise.resolve();
let lastMusicBrainzRequestAt = 0;
let musicBrainzGate: Promise<void> = Promise.resolve();

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

async function enterLookupGate() {
  const previousGate = lookupGate;
  let release!: () => void;
  lookupGate = new Promise<void>((resolve) => { release = resolve; });
  await previousGate;

  const elapsed = Date.now() - lastLookupRequestAt;
  if (elapsed < LOOKUP_MIN_GAP_MS) {
    await wait(LOOKUP_MIN_GAP_MS - elapsed);
  }
  lastLookupRequestAt = Date.now();
  release();
}

async function enterMusicBrainzGate() {
  const previousGate = musicBrainzGate;
  let release!: () => void;
  musicBrainzGate = new Promise<void>((resolve) => { release = resolve; });
  await previousGate;
  const elapsed = Date.now() - lastMusicBrainzRequestAt;
  if (elapsed < MUSICBRAINZ_MIN_GAP_MS) await wait(MUSICBRAINZ_MIN_GAP_MS - elapsed);
  lastMusicBrainzRequestAt = Date.now();
  release();
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    // Apostrophes are usually catalog punctuation, not word boundaries.
    // Removing them makes imported titles like "Cupids Chokehold" line up with
    // catalog titles like "Cupid's Chokehold" instead of scoring them as
    // different token shapes.
    .replace(/[’'`]/g, "")
    .replace(/&/g, " and ")
    .replace(/\b(feat|featuring|ft)\.?\b.*$/i, "")
    .replace(
      /\b(remaster(?:ed)?|deluxe|explicit|clean|radio edit|single version|album version|mono|stereo|edit|version)\b/gi,
      " "
    )
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeArtist(value: string) {
  return normalize(value).replace(/^the\s+/, "").trim();
}

function compactArtistIdentity(value: string) {
  return normalizeArtist(value).replace(/\s+/g, "");
}

function artistTextScore(left: string, right: string) {
  const direct = textScore(left, right);
  const a = normalizeArtist(left);
  const b = normalizeArtist(right);
  if (!a || !b) return direct;
  if (a === b) return Math.max(direct, 0.995);

  // Artist identity must survive missing spaces and punctuation from imported
  // filenames/tags. Examples: PapaRoach = Papa Roach, ThreeDaysGrace =
  // Three Days Grace. This is an identity comparison, not a broad fuzzy pass.
  const compactA = compactArtistIdentity(left);
  const compactB = compactArtistIdentity(right);
  if (compactA && compactA === compactB) return Math.max(direct, 0.995);

  return Math.max(direct, tokenScore(a, b));
}

function stripTrailingVersionText(value: string) {
  let result = value.trim();
  const patterns = [
    /\s*[\[(][^\]\)]*(remaster(?:ed)?|deluxe|explicit|clean|radio edit|single version|album version|mono|stereo|edit|version|live)[^\]\)]*[\])]\s*$/i,
    /\s*[\[(](official\s+)?(music\s+)?(video|audio|lyrics?|lyric\s+video|visuali[sz]er)[\])]\s*$/i,
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of patterns) {
      const next = result.replace(pattern, "").trim();
      if (next !== result) {
        result = next;
        changed = true;
      }
    }
  }
  return result;
}

function titleBaseVariants(value: string) {
  const cleaned = removeLookupNoise(value);
  if (!cleaned) return [];

  const values = [
    cleaned,
    stripTrailingVersionText(cleaned),
    cleaned.replace(/\s*\([^)]*\)\s*$/g, "").trim(),
    cleaned.replace(/\s*\[[^\]]*\]\s*$/g, "").trim(),
    cleaned.split(/\s+[/|]\s+/)[0]?.trim() || "",
    cleaned.replace(/\s*[-–—:]\s*(remaster(?:ed)?|deluxe|radio edit|single version|album version|live).*$/i, "").trim(),
  ];

  return uniqueUseful(values).filter((item) => item.length >= 2);
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

  const addTitleFamily = (value: string | null | undefined) => {
    if (!value) return;
    for (const variant of titleBaseVariants(value)) titleVariants.push(variant);
  };

  addTitleFamily(rawTitle);
  addTitleFamily(stem);
  if (knownArtist) artistVariants.push(knownArtist);

  const titleSplit = splitArtistTitle(rawTitle);
  const fileSplit = splitArtistTitle(stem);

  const addSplit = (split: { left: string; right: string } | null) => {
    if (!split) return;

    if (knownArtist) {
      const leftArtistScore = artistTextScore(split.left, knownArtist);
      const rightArtistScore = artistTextScore(split.right, knownArtist);

      if (leftArtistScore >= rightArtistScore && leftArtistScore >= 0.62) {
        addTitleFamily(split.right);
        artistVariants.push(split.left);
        return;
      }

      if (rightArtistScore > leftArtistScore && rightArtistScore >= 0.62) {
        addTitleFamily(split.left);
        artistVariants.push(split.right);
        return;
      }
    }

    // With no reliable artist tag, "Artist - Title" is the most common import
    // filename pattern. Search both directions, but prefer the right side as title.
    addTitleFamily(split.right);
    addTitleFamily(split.left);
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
      addTitleFamily(title.replace(artistPrefix, "").trim());
    }
  }

  const titles = uniqueUseful(titleVariants)
    .map(removeLookupNoise)
    .flatMap((value) => titleBaseVariants(value))
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
    titleVariants: uniqueUseful([primaryTitle, ...titles]).slice(0, 12),
    artistVariants: uniqueUseful(artists).slice(0, 6),
    knownArtist,
  };
}

function artwork1200(url?: string) {
  if (!url) return null;
  return url
    .replace(/\/\d+x\d+bb\./, "/1200x1200bb.")
    .replace(/\/\d+x\d+bb-/, "/1200x1200bb-");
}

type ReleaseVersionFlag =
  | "unplugged"
  | "acoustic"
  | "live"
  | "remix"
  | "demo"
  | "remaster"
  | "deluxe"
  | "anniversary"
  | "expanded"
  | "single";

function releaseVersionFlags(value: string | null | undefined) {
  const text = (value || "").toLowerCase();
  const flags = new Set<ReleaseVersionFlag>();
  if (/\bunplugged\b/.test(text)) flags.add("unplugged");
  if (/\bacoustic\b/.test(text)) flags.add("acoustic");
  if (/\b(live|concert)\b/.test(text)) flags.add("live");
  if (/\b(remix|remixed|mix)\b/.test(text)) flags.add("remix");
  if (/\bdemo\b/.test(text)) flags.add("demo");
  if (/\bremaster(?:ed)?\b/.test(text)) flags.add("remaster");
  if (/\bdeluxe\b/.test(text)) flags.add("deluxe");
  if (/\banniversary\b/.test(text)) flags.add("anniversary");
  if (/\bexpanded(?: edition)?\b/.test(text)) flags.add("expanded");
  if (/\bsingle\b/.test(text)) flags.add("single");
  return flags;
}

function releaseContextText(track: MusicTrack) {
  return [track.album || "", track.title || "", track.original_name || ""].join(" • ");
}

function releaseContextLabel(track: MusicTrack) {
  const flags = releaseVersionFlags(releaseContextText(track));
  if (flags.has("unplugged")) return "UNPLUGGED";
  if (flags.has("acoustic")) return "ACOUSTIC";
  if (flags.has("live")) return "LIVE";
  if (flags.has("remix")) return "REMIX";
  if (flags.has("demo")) return "DEMO";
  if (flags.has("remaster")) return "REMASTER";
  if (flags.has("deluxe")) return "DELUXE";
  if (flags.has("anniversary")) return "ANNIVERSARY";
  if (flags.has("expanded")) return "EXPANDED";
  if (flags.has("single")) return "SINGLE";
  return null;
}

function releaseQualityFromAlbum(
  album: string | null | undefined,
  expectedFlags?: Set<ReleaseVersionFlag>
) {
  const value = (album || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!value) return 0.2;

  const candidateFlags = releaseVersionFlags(value);
  const versionExpected = Boolean(expectedFlags?.size);
  const versionMatches = versionExpected
    ? [...expectedFlags!].some((flag) => candidateFlags.has(flag))
    : false;

  if (/\b(karaoke|tribute|cover versions?|sound alike)\b/.test(value)) return 0.03;
  if (/\b(various artists|compilation)\b/.test(value)) return 0.16;
  if (/\b(greatest hits|best of|the best|essential|anthology|collection|ultimate hits|hits collection|a sides|b sides|singles collection|rarities|biggest hits|hits live|live usa)\b/.test(value)) return 0.20;

  // Version words are identity clues, not automatic quality penalties. A real
  // Unplugged/Live/Remix release must rank HIGH when that is the version the
  // uploaded song actually is.
  if (versionMatches) return 0.98;
  if (candidateFlags.has("remix")) return versionExpected ? 0.34 : 0.48;
  if (candidateFlags.has("live") || candidateFlags.has("unplugged") || candidateFlags.has("acoustic")) {
    return versionExpected ? 0.42 : 0.38;
  }
  if (/\b(soundtrack|motion picture|original score)\b/.test(value)) return 0.6;
  if (candidateFlags.has("single")) return 0.84;
  if (candidateFlags.has("deluxe") || candidateFlags.has("remaster") || candidateFlags.has("anniversary") || candidateFlags.has("expanded")) return 0.9;
  return 1;
}

function candidateReleaseQuality(
  candidate: Pick<MusicMetadataCandidate, "album" | "releaseQuality">,
  expectedFlags?: Set<ReleaseVersionFlag>
) {
  // A context-aware pass must recompute quality so legitimate Unplugged/Live/
  // Remix releases are not penalized merely because the cached generic score
  // was created before we knew which version the user actually owns.
  if (expectedFlags?.size) return releaseQualityFromAlbum(candidate.album, expectedFlags);
  return candidate.releaseQuality ?? releaseQualityFromAlbum(candidate.album);
}

function looksLikeBootlegRelease(album: string | null | undefined) {
  const value = (album || "").toLowerCase();
  return (
    /^\s*(19|20)\d{2}[-./]\d{1,2}[-./]\d{1,2}/.test(value) ||
    /\b(bootleg|audience recording|fm broadcast|soundboard|rlr)\b/.test(value)
  );
}

function releaseMatchScore(
  track: MusicTrack,
  candidate: Pick<MusicMetadataCandidate, "artist" | "album" | "releaseYear" | "artworkUrl" | "source" | "releaseQuality">
) {
  const expectedFlags = releaseVersionFlags(releaseContextText(track));
  const candidateFlags = releaseVersionFlags(candidate.album);
  const artist = track.artist ? artistTextScore(track.artist, candidate.artist) : 0.75;
  const trackAlbumTrusted = Boolean(track.album?.trim()) && !looksLikeBootlegRelease(track.album);
  const manualAlbumConstraint = track.metadata_status === "manual" && Boolean(track.album?.trim());
  const album = track.album ? textScore(track.album, candidate.album) : 0.62;
  const hasVersionContext = expectedFlags.size > 0;
  const versionMatches = hasVersionContext
    ? [...expectedFlags].filter((flag) => candidateFlags.has(flag)).length
    : 0;
  const versionMismatch = hasVersionContext && versionMatches === 0;
  const yearDistance = track.release_year && candidate.releaseYear
    ? Math.abs(track.release_year - candidate.releaseYear)
    : null;
  const year = yearDistance == null ? 0.7 : yearDistance <= 1 ? 1 : yearDistance <= 3 ? 0.82 : yearDistance <= 8 ? 0.55 : 0.35;
  const sourceOfficialBias = candidate.source === "itunes" ? 1 : 0.82;
  const quality = releaseQualityFromAlbum(candidate.album, expectedFlags);
  const artwork = candidate.artworkUrl ? 1 : 0;

  let score =
    artist * 0.18 +
    album * (manualAlbumConstraint ? 0.42 : trackAlbumTrusted ? 0.27 : track.album ? 0.08 : 0.12) +
    year * 0.08 +
    quality * 0.16 +
    sourceOfficialBias * 0.12 +
    artwork * 0.09;

  if (hasVersionContext) {
    score += versionMatches ? Math.min(0.28, 0.2 + versionMatches * 0.04) : -0.24;
  } else {
    score += 0.1;
  }

  if (manualAlbumConstraint) {
    if (album >= 0.90) score += 0.16;
    else if (album < 0.70) score -= 0.30;
  }

  if (versionMismatch && looksLikeBootlegRelease(candidate.album)) score -= 0.12;
  if (looksLikeBootlegRelease(candidate.album) && candidate.source !== "itunes") score -= 0.08;

  return Math.max(0, Math.min(1, score));
}

function yearFromDate(value?: string) {
  if (!value) return null;
  const match = value.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function bestTextScore(values: string[], candidate: string) {
  if (!values.length) return 0;
  const candidateForms = titleBaseVariants(candidate);
  const forms = candidateForms.length ? candidateForms : [candidate];
  return Math.max(...values.flatMap((value) => forms.map((form) => textScore(value, form))));
}

function bestArtistScore(values: string[], candidate: string) {
  if (!values.length) return 0;
  return Math.max(...values.map((value) => artistTextScore(value, candidate)));
}

function exactAgainst(values: string[], candidate: string) {
  const candidateForms = titleBaseVariants(candidate);
  const targets = new Set((candidateForms.length ? candidateForms : [candidate]).map(normalize));
  return values.some((value) => targets.has(normalize(value)));
}

function artistExactAgainst(values: string[], candidate: string) {
  const target = normalizeArtist(candidate);
  const compactTarget = compactArtistIdentity(candidate);
  return values.some((value) => {
    if (normalizeArtist(value) === target) return true;
    const compactValue = compactArtistIdentity(value);
    return Boolean(compactValue && compactTarget && compactValue === compactTarget);
  });
}

function scoreCandidate(
  track: MusicTrack,
  signals: LookupSignals,
  candidate: Omit<MusicMetadataCandidate, "confidence">
) {
  const titleSimilarity = bestTextScore(signals.titleVariants, candidate.title);
  const titleExact = exactAgainst(signals.titleVariants, candidate.title);
  const titleDirectExact = signals.titleVariants.some(
    (value) => normalize(value) === normalize(candidate.title)
  );
  const candidateTitleForms = titleBaseVariants(candidate.title).map(normalize);
  const titleContainment = signals.titleVariants
    .map(normalize)
    .filter((value) => value.length >= 7)
    .some((value) => candidateTitleForms.some((form) =>
      form.startsWith(`${value} `) || value.startsWith(`${form} `)
    ));

  const artistKnown = Boolean(signals.knownArtist);
  const artistSimilarity = signals.artistVariants.length
    ? bestArtistScore(signals.artistVariants, candidate.artist)
    : 0.72;
  const artistExact = signals.artistVariants.length
    ? artistExactAgainst(signals.artistVariants, candidate.artist)
    : false;

  const albumSimilarity = track.album
    ? textScore(track.album, candidate.album)
    : 0.66;

  const duration = durationScore(
    track.duration_seconds,
    candidate.durationSeconds
  );

  // Exact normalized title + artist identity is authoritative. Duration then
  // decides how close to 100% the recording is, allowing common catalog
  // punctuation and a leading "The" in artist names without creating a false
  // miss.
  if (titleExact && artistExact) {
    if (titleDirectExact) return Math.min(1, 0.97 + duration * 0.03);
    if (duration >= 0.94) return Math.min(0.997, 0.962 + duration * 0.035);
    return Math.min(0.965, 0.89 + duration * 0.075);
  }

  if (titleExact && artistKnown && artistSimilarity >= 0.9) {
    if (!titleDirectExact && duration < 0.94) {
      return Math.min(0.955, 0.87 + artistSimilarity * 0.03 + duration * 0.055);
    }
    return Math.min(0.995, 0.925 + artistSimilarity * 0.035 + duration * 0.035);
  }

  if (titleExact && !artistKnown) {
    // Exact title is meaningful, but without a verified artist it remains
    // conservative unless duration also agrees.
    return Math.min(0.955, 0.845 + duration * 0.11);
  }

  if (artistExact && titleSimilarity >= 0.82) {
    if (titleContainment && duration >= 0.94) {
      return Math.min(0.992, 0.952 + duration * 0.04);
    }
    return Math.min(
      0.96,
      titleSimilarity * 0.72 + duration * 0.18 + albumSimilarity * 0.04
    );
  }

  let score =
    titleSimilarity * 0.68 +
    artistSimilarity * 0.18 +
    duration * 0.1 +
    albumSimilarity * 0.04;

  // Strongly punish "same artist, wrong song". This remains the most
  // important safety rail even with a wider search net.
  if (artistExact && titleSimilarity < 0.72) score *= 0.18;
  if (titleSimilarity < 0.5) score *= 0.32;
  if (titleSimilarity < 0.3) score *= 0.22;

  // A near-exact title + artist + close duration is a strong catalog match even
  // if the provider appends a subtitle such as "(Open Fire)".
  if (artistSimilarity >= 0.94 && titleSimilarity >= 0.9 && duration >= 0.94) {
    score = Math.max(score, 0.94 + duration * 0.04);
  }

  // If a filename/title split produced a very strong title match, keep it
  // competitive even when the imported artist field was blank.
  if (!artistKnown && titleSimilarity >= 0.9 && duration >= 0.72) {
    score = Math.max(score, 0.82 + duration * 0.08);
  }

  return Math.max(0, Math.min(0.985, score));
}

async function searchItunes(
  term: string,
  attribute: SearchAttribute = null,
  limit = 25,
  options?: LookupOptions
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

  let lastStatus = 0;

  for (let attempt = 0; attempt <= LOOKUP_RETRY_DELAYS_MS.length; attempt += 1) {
    await enterLookupGate();

    let response: Response;
    try {
      response = await fetch(
        `https://itunes.apple.com/search?${params.toString()}`,
        { mode: "cors", cache: "no-store" }
      );
    } catch {
      if (attempt >= LOOKUP_RETRY_DELAYS_MS.length) {
        throw new Error("Music lookup service could not be reached. Try again in a moment.");
      }

      const delayMs = LOOKUP_RETRY_DELAYS_MS[attempt];
      options?.onRetry?.({ status: 0, attempt: attempt + 1, delayMs });
      await wait(delayMs);
      continue;
    }

    lastStatus = response.status;

    if (response.ok) {
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
          artworkUrl: artwork1200(item.artworkUrl100),
          artworkFallbackUrl: item.artworkUrl100 || null,
          durationSeconds: item.trackTimeMillis
            ? Math.round(item.trackTimeMillis / 1000)
            : null,
          source: "itunes" as const,
          releaseQuality: releaseQualityFromAlbum(item.collectionName || ""),
        }));

      LOOKUP_CACHE.set(cacheKey, rows);
      return rows;
    }

    const retryable =
      response.status === 403 ||
      response.status === 408 ||
      response.status === 429 ||
      response.status >= 500;

    if (!retryable || attempt >= LOOKUP_RETRY_DELAYS_MS.length) break;

    const delayMs = LOOKUP_RETRY_DELAYS_MS[attempt];
    options?.onRetry?.({
      status: response.status,
      attempt: attempt + 1,
      delayMs,
    });
    await wait(delayMs);
  }

  if (lastStatus === 403 || lastStatus === 429) {
    throw new Error("Music lookup service is temporarily busy. Wait a moment and try again.");
  }

  throw new Error(
    lastStatus
      ? `Music lookup service could not complete the request (${lastStatus}).`
      : "Music lookup service could not complete the request."
  );
}

async function searchItunesAlbums(
  track: MusicTrack,
  term: string,
  limit = 30,
  options?: LookupOptions
): Promise<Omit<MusicMetadataCandidate, "confidence">[]> {
  const cleanTerm = term.replace(/\s+/g, " ").trim();
  if (!cleanTerm) return [];
  const cacheKey = `album:${normalize(cleanTerm)}:${normalize(track.title)}:${limit}`;
  const cached = ARTWORK_LOOKUP_CACHE.get(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({
    entity: "album",
    limit: String(limit),
    term: cleanTerm,
  });

  for (let attempt = 0; attempt <= LOOKUP_RETRY_DELAYS_MS.length; attempt += 1) {
    await enterLookupGate();
    try {
      const response = await fetch(`https://itunes.apple.com/search?${params.toString()}`, {
        mode: "cors",
        cache: "no-store",
      });
      if (response.ok) {
        const payload = (await response.json()) as ItunesResponse;
        const rows = (payload.results || [])
          .filter((item) => item.collectionName && item.artistName && item.artworkUrl100)
          .map((item) => ({
            sourceId: `itunes-album:${item.collectionId || `${item.artistName}-${item.collectionName}`}`,
            title: track.title,
            artist: item.artistName || track.artist || "",
            album: item.collectionName || "",
            releaseYear: yearFromDate(item.releaseDate),
            genre: item.primaryGenreName || null,
            artworkUrl: artwork1200(item.artworkUrl100),
            artworkFallbackUrl: item.artworkUrl100 || null,
            durationSeconds: track.duration_seconds,
            source: "itunes" as const,
            releaseQuality: releaseQualityFromAlbum(
              item.collectionName || "",
              releaseVersionFlags(releaseContextText(track))
            ),
          }));
        ARTWORK_LOOKUP_CACHE.set(cacheKey, rows);
        return rows;
      }

      const retryable = response.status === 403 || response.status === 408 || response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= LOOKUP_RETRY_DELAYS_MS.length) return [];
      const delayMs = LOOKUP_RETRY_DELAYS_MS[attempt];
      options?.onRetry?.({ status: response.status, attempt: attempt + 1, delayMs });
      await wait(delayMs);
    } catch {
      if (attempt >= LOOKUP_RETRY_DELAYS_MS.length) return [];
      const delayMs = LOOKUP_RETRY_DELAYS_MS[attempt];
      options?.onRetry?.({ status: 0, attempt: attempt + 1, delayMs });
      await wait(delayMs);
    }
  }

  return [];
}

function musicBrainzArtist(credit?: MusicBrainzArtistCredit[]) {
  if (!Array.isArray(credit)) return "";
  return credit
    .map((row) => `${row.name || row.artist?.name || ""}${row.joinphrase || ""}`)
    .join("")
    .trim();
}

async function searchMusicBrainz(
  title: string,
  artist: string | null,
  limit = 25,
  options?: LookupOptions,
  relaxed = false
): Promise<Omit<MusicMetadataCandidate, "confidence">[]> {
  const cleanTitle = title.replace(/\s+/g, " ").trim();
  const cleanArtist = artist?.replace(/\s+/g, " ").trim() || null;
  if (!cleanTitle) return [];

  const cacheKey = `musicbrainz:${relaxed ? "relaxed" : "exact"}:${normalize(cleanArtist || "")}:${normalize(cleanTitle)}:${limit}`;
  const cached = LOOKUP_CACHE.get(cacheKey);
  if (cached) return cached;

  const escapeQuery = (value: string) =>
    value.replace(/([+\-&|!(){}\[\]^"~*?:\/])/g, "\\$1");

  const escapedTitle = escapeQuery(cleanTitle);
  const escapedArtist = cleanArtist ? escapeQuery(cleanArtist) : null;
  const query = relaxed
    ? escapedArtist
      ? `recording:${escapedTitle} AND artist:${escapedArtist}`
      : `recording:${escapedTitle}`
    : escapedArtist
      ? `recording:"${escapedTitle}" AND artist:"${escapedArtist}"`
      : `recording:"${escapedTitle}"`;

  const params = new URLSearchParams({ query, fmt: "json", limit: String(limit) });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await enterMusicBrainzGate();
    try {
      const response = await fetch(`https://musicbrainz.org/ws/2/recording/?${params.toString()}`, {
        mode: "cors",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        if ((response.status === 429 || response.status >= 500) && attempt < 2) {
          const delayMs = 1800 * (attempt + 1);
          options?.onRetry?.({ status: response.status, attempt: attempt + 1, delayMs });
          await wait(delayMs);
          continue;
        }
        return [];
      }

      const payload = (await response.json()) as MusicBrainzResponse;
      const rows = (payload.recordings || [])
        .filter((recording) => recording.id && recording.title)
        .map((recording) => {
          const releases = (recording.releases || [])
            .filter((item) => item.id && item.title)
            .sort((left, right) => {
              const qualityDifference =
                releaseQualityFromAlbum(right.title || "") -
                releaseQualityFromAlbum(left.title || "");
              if (Math.abs(qualityDifference) > 0.001) return qualityDifference;

              const leftYear = yearFromDate(left.date) || 9999;
              const rightYear = yearFromDate(right.date) || 9999;
              return leftYear - rightYear;
            });
          const release = releases[0] || recording.releases?.[0];
          const releaseId = release?.id || null;
          return {
            sourceId: `mb:${recording.id}`,
            title: recording.title || "",
            artist: musicBrainzArtist(recording["artist-credit"]),
            album: release?.title || "",
            releaseYear: yearFromDate(recording["first-release-date"] || release?.date),
            genre: null,
            artworkUrl: releaseId
              ? `https://coverartarchive.org/release/${releaseId}/front-1200`
              : null,
            artworkFallbackUrl: releaseId
              ? `https://coverartarchive.org/release/${releaseId}/front-500`
              : null,
            durationSeconds: recording.length
              ? Math.round(recording.length / 1000)
              : null,
            source: "musicbrainz" as const,
            releaseQuality: releaseQualityFromAlbum(release?.title || ""),
          };
        })
        .filter((row) => row.artist);

      LOOKUP_CACHE.set(cacheKey, rows);
      return rows;
    } catch {
      if (attempt >= 2) return [];
      const delayMs = 1800 * (attempt + 1);
      options?.onRetry?.({ status: 0, attempt: attempt + 1, delayMs });
      await wait(delayMs);
    }
  }
  return [];
}

export async function findMusicMetadataCandidates(
  track: MusicTrack,
  options?: LookupOptions
) {
  const signals = buildLookupSignals(track);
  const combined = new Map<string, MusicMetadataCandidate>();

  const primaryTitle = signals.primaryTitle;
  const bestArtist = signals.knownArtist || signals.artistVariants[0] || null;
  const secondaryTitles = signals.titleVariants
    .filter((title) => normalize(title) !== normalize(primaryTitle))
    .slice(0, 5);

  const searchPlan: Array<{
    term: string;
    attribute: SearchAttribute;
    limit: number;
  }> = [];

  const addSearch = (
    term: string,
    attribute: SearchAttribute = null,
    limit = 25
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

  // Progressive Apple search. Precise artist/title comes first, followed by
  // title-index searches and normalized filename/title variants. The wider
  // requests only run when the precise pass does not already produce an
  // authoritative match.
  if (bestArtist) addSearch(`${bestArtist} ${primaryTitle}`, null, 50);
  if (bestArtist) addSearch(`${primaryTitle} ${bestArtist}`, null, 50);
  addSearch(primaryTitle, "songTerm", 50);
  addSearch(primaryTitle, null, 50);

  const releaseLabel = releaseContextLabel(track);
  if (bestArtist && releaseLabel) {
    addSearch(`${bestArtist} ${primaryTitle} ${releaseLabel}`, null, 40);
    addSearch(`${bestArtist} ${releaseLabel} ${primaryTitle}`, null, 40);
  }
  if (bestArtist && track.album?.trim()) {
    addSearch(`${bestArtist} ${track.album.trim()} ${primaryTitle}`, null, 40);
  }

  for (const title of secondaryTitles) {
    if (bestArtist) addSearch(`${bestArtist} ${title}`, null, 30);
    addSearch(title, "songTerm", 30);
  }

  // Last-resort artist catalog search can recover songs whose provider title
  // includes a subtitle that defeats the normal term index. Ranking still
  // requires a strong title + artist identity before anything is accepted.
  if (bestArtist) addSearch(bestArtist, "artistTerm", 50);

  const canonicalKey = (row: Omit<MusicMetadataCandidate, "confidence">) => {
    const roundedDuration = row.durationSeconds
      ? Math.round(row.durationSeconds / 3) * 3
      : 0;
    return [
      compactArtistIdentity(row.artist),
      normalize(titleBaseVariants(row.title)[0] || row.title),
      normalize(row.album),
      roundedDuration,
    ].join("|");
  };

  const addRows = (rows: Omit<MusicMetadataCandidate, "confidence">[]) => {
    for (const row of rows) {
      const recordingConfidence = scoreCandidate(track, signals, row);
      const releaseConfidence = releaseMatchScore(track, row);
      const scored: MusicMetadataCandidate = {
        ...row,
        confidence: recordingConfidence,
        recordingConfidence,
        releaseConfidence,
        releaseContext: releaseContextLabel(track),
      };

      const key = canonicalKey(row);
      const previous = combined.get(key);
      if (!previous) {
        combined.set(key, scored);
        continue;
      }

      // Prefer the higher-confidence recording, but merge useful catalog
      // details so an Apple artwork/genre result can complement a MusicBrainz
      // identity match (and vice versa).
      const winner =
        scored.confidence > previous.confidence ? scored : previous;
      const fallback = winner === scored ? previous : scored;
      combined.set(key, {
        ...winner,
        album: winner.album || fallback.album,
        releaseYear: winner.releaseYear ?? fallback.releaseYear,
        genre: winner.genre || fallback.genre,
        artworkUrl: winner.artworkUrl || fallback.artworkUrl,
        artworkFallbackUrl: winner.artworkFallbackUrl || fallback.artworkFallbackUrl || null,
        durationSeconds:
          winner.durationSeconds ?? fallback.durationSeconds,
        recordingConfidence: Math.max(
          winner.recordingConfidence ?? winner.confidence,
          fallback.recordingConfidence ?? fallback.confidence
        ),
        releaseConfidence: Math.max(
          winner.releaseConfidence ?? 0,
          fallback.releaseConfidence ?? 0
        ),
        releaseContext: winner.releaseContext || fallback.releaseContext || null,
        releaseQuality: Math.max(
          candidateReleaseQuality(winner),
          candidateReleaseQuality(fallback)
        ),
      });
    }
  };

  const hasReleaseContext = Boolean(track.album?.trim()) || releaseVersionFlags(releaseContextText(track)).size > 0;
  const hasAuthoritativeMatch = () =>
    [...combined.values()].some((candidate) => {
      const titleExact = exactAgainst(signals.titleVariants, candidate.title);
      const artistOkay = signals.artistVariants.length
        ? bestArtistScore(signals.artistVariants, candidate.artist) >= 0.94
        : true;
      const releaseOkay = !hasReleaseContext || (candidate.releaseConfidence ?? 0) >= 0.86;
      return titleExact && artistOkay && releaseOkay && candidate.confidence >= 0.985;
    });

  // First four are the fast/precise pass.
  for (const request of searchPlan.slice(0, 4)) {
    try {
      addRows(
        await searchItunes(
          request.term,
          request.attribute,
          request.limit,
          options
        )
      );
    } catch {
      // Apple can throttle browser lookups. MusicBrainz and the remaining
      // adaptive passes still get a chance instead of creating a false miss.
    }
    if (hasAuthoritativeMatch()) break;
  }

  // Always compare at least one MusicBrainz result set so the final ranking is
  // cross-catalog instead of simply trusting whichever provider answered first.
  addRows(await searchMusicBrainz(primaryTitle, bestArtist, 30, options, false));

  // If the exact pass did not settle the recording, widen the Apple search
  // using filename/title variants. Cap the total requests to keep full-library
  // enrichment respectful of provider limits.
  if (!hasAuthoritativeMatch()) {
    for (const request of searchPlan.slice(4, 10)) {
      try {
        addRows(
          await searchItunes(
            request.term,
            request.attribute,
            request.limit,
            options
          )
        );
      } catch {
        // Continue to the next catalog strategy.
      }
      if (hasAuthoritativeMatch()) break;
    }
  }

  // Relaxed MusicBrainz search is intentionally second-stage. It catches
  // punctuation, subtitle, apostrophe and version differences while the scoring
  // layer still blocks wrong-song matches.
  if (!hasAuthoritativeMatch()) {
    addRows(await searchMusicBrainz(primaryTitle, bestArtist, 35, options, true));

    for (const title of secondaryTitles.slice(0, 2)) {
      addRows(await searchMusicBrainz(title, bestArtist, 25, options, false));
      if (hasAuthoritativeMatch()) break;
    }
  }

  // Final title-only MusicBrainz fallback. When an artist is known, filtering
  // below still requires that artist to agree before the candidate can survive.
  if (!hasAuthoritativeMatch() && bestArtist) {
    addRows(await searchMusicBrainz(primaryTitle, null, 35, options, true));
  }

  const rawCandidates = [...combined.values()];
  let filtered = rawCandidates.filter((candidate) => {
    const titleSimilarity = bestTextScore(
      signals.titleVariants,
      candidate.title
    );
    const titleExact = exactAgainst(
      signals.titleVariants,
      candidate.title
    );
    const duration = durationScore(
      track.duration_seconds,
      candidate.durationSeconds
    );

    if (signals.artistVariants.length) {
      const artistSimilarity = bestArtistScore(
        signals.artistVariants,
        candidate.artist
      );
      const artistExact = artistExactAgainst(
        signals.artistVariants,
        candidate.artist
      );

      if (titleExact) {
        return artistExact || artistSimilarity >= 0.8;
      }

      // Fuzzy title candidates must agree strongly on artist and either have a
      // very strong title or corroborating duration. This is the safety fence
      // that lets the search widen without attaching the wrong song.
      return (
        artistSimilarity >= 0.88 &&
        (
          titleSimilarity >= 0.88 ||
          (titleSimilarity >= 0.8 && duration >= 0.94)
        )
      );
    }

    // Unknown artist: title + duration must carry the identification.
    return (
      titleExact ||
      titleSimilarity >= 0.92 ||
      (titleSimilarity >= 0.86 && duration >= 0.98)
    );
  });

  // If verified exact/base-title matches exist, keep those release/version
  // variants together and discard unrelated fuzzy catalog noise.
  const exactTitleMatches = filtered.filter((candidate) =>
    exactAgainst(signals.titleVariants, candidate.title)
  );
  if (exactTitleMatches.length) filtered = exactTitleMatches;

  const sortCandidates = (rows: MusicMetadataCandidate[]) =>
    [...rows].sort((left, right) => {
      const leftTitleExact = exactAgainst(
        signals.titleVariants,
        left.title
      );
      const rightTitleExact = exactAgainst(
        signals.titleVariants,
        right.title
      );
      const leftArtistExact = signals.artistVariants.length
        ? artistExactAgainst(signals.artistVariants, left.artist)
        : false;
      const rightArtistExact = signals.artistVariants.length
        ? artistExactAgainst(signals.artistVariants, right.artist)
        : false;

      const leftPerfect = leftTitleExact && leftArtistExact;
      const rightPerfect = rightTitleExact && rightArtistExact;
      if (leftPerfect !== rightPerfect) return leftPerfect ? -1 : 1;
      if (leftTitleExact !== rightTitleExact) return leftTitleExact ? -1 : 1;

      // Once recording identity is settled, release/version identity decides
      // which album wins. This is what keeps an Unplugged/Live/Remix upload on
      // the correct official release instead of a random performance with the
      // same artist/title.
      const releaseContextDifference =
        (right.releaseConfidence ?? 0) - (left.releaseConfidence ?? 0);
      if (leftPerfect && rightPerfect && Math.abs(releaseContextDifference) > 0.035) {
        return releaseContextDifference;
      }

      const expectedFlags = releaseVersionFlags(releaseContextText(track));
      const releaseDifference =
        candidateReleaseQuality(right, expectedFlags) - candidateReleaseQuality(left, expectedFlags);
      if (leftPerfect && rightPerfect && Math.abs(releaseDifference) > 0.08) {
        return releaseDifference;
      }

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
      if (leftDifference !== rightDifference) return leftDifference - rightDifference;

      return candidateReleaseQuality(right, expectedFlags) - candidateReleaseQuality(left, expectedFlags);
    });

  const accepted = sortCandidates(filtered).slice(0, 12);

  let returned = accepted;
  if (!returned.length && options?.includeLowConfidence && rawCandidates.length) {
    const manualPossibilities = rawCandidates.filter((candidate) => {
      const titleSimilarity = bestTextScore(signals.titleVariants, candidate.title);
      const titleExact = exactAgainst(signals.titleVariants, candidate.title);
      const artistSimilarity = signals.artistVariants.length
        ? bestArtistScore(signals.artistVariants, candidate.artist)
        : 0.7;
      return titleExact || (titleSimilarity >= 0.68 && artistSimilarity >= 0.55);
    });
    returned = sortCandidates(manualPossibilities).slice(0, 12);
  }

  options?.onDiagnostics?.({
    rawCandidates: rawCandidates.length,
    acceptedCandidates: accepted.length,
    returnedCandidates: returned.length,
    reason: accepted.length
      ? "matches"
      : rawCandidates.length
        ? "low_confidence"
        : "no_catalog_results",
  });

  return returned;
}

export async function findMusicArtworkCandidates(
  track: MusicTrack,
  options?: LookupOptions
): Promise<MusicMetadataCandidate[]> {
  const signals = buildLookupSignals(track);
  const bestArtist = signals.knownArtist || signals.artistVariants[0] || track.artist || null;
  const releaseLabel = releaseContextLabel(track);
  const combined = new Map<string, MusicMetadataCandidate>();

  const add = (rows: Array<Omit<MusicMetadataCandidate, "confidence"> | MusicMetadataCandidate>, recordingWeight = false) => {
    for (const row of rows) {
      if (!row.artworkUrl) continue;
      const artistConfidence = bestArtist ? artistTextScore(bestArtist, row.artist) : 0.75;
      if (bestArtist && artistConfidence < 0.7) continue;
      const recordingConfidence = "confidence" in row
        ? row.confidence
        : recordingWeight
          ? scoreCandidate(track, signals, row)
          : 0.8;
      const releaseConfidence = releaseMatchScore(track, row);
      // Artwork confidence is deliberately release-first. Recording confidence
      // only corroborates the release; it does not let a random venue recording
      // become a 99% artwork match merely because title + artist are exact.
      const artworkConfidence = Math.max(
        0,
        Math.min(1, releaseConfidence * 0.78 + recordingConfidence * 0.17 + (row.artworkUrl ? 0.05 : 0))
      );
      const candidate: MusicMetadataCandidate = {
        ...row,
        confidence: artworkConfidence,
        recordingConfidence,
        releaseConfidence,
        releaseContext: releaseLabel,
      };
      const key = `${compactArtistIdentity(candidate.artist)}|${normalize(candidate.album)}|${candidate.releaseYear || 0}`;
      const previous = combined.get(key);
      if (!previous || candidate.confidence > previous.confidence) combined.set(key, candidate);
    }
  };

  // 1) Recording candidates contribute exact song identity and duration.
  const recordingCandidates = await findMusicMetadataCandidates(track, {
    ...options,
    includeLowConfidence: true,
    onDiagnostics: undefined,
  });
  add(recordingCandidates, true);

  // 2) Album/release-first Apple searches are the authoritative artwork pass.
  // Current album is searched first; version identity (Unplugged/Live/Remix…)
  // is searched explicitly even when the existing album tag is messy.
  const albumTerms = uniqueUseful([
    bestArtist && track.album ? `${bestArtist} ${track.album}` : null,
    bestArtist && releaseLabel ? `${bestArtist} ${releaseLabel}` : null,
    bestArtist && releaseLabel ? `${bestArtist} ${signals.primaryTitle} ${releaseLabel}` : null,
    bestArtist ? `${bestArtist} ${signals.primaryTitle}` : null,
  ]).slice(0, 4);

  for (const term of albumTerms) {
    try {
      add(await searchItunesAlbums(track, term, 35, options), false);
      if ([...combined.values()].some((candidate) =>
        candidate.source === "itunes" &&
        (candidate.releaseConfidence ?? 0) >= 0.86
      )) break;
    } catch {
      // Song-recording candidates remain available if the album endpoint is busy.
    }
  }

  const rows = [...combined.values()]
    .sort((left, right) => {
      const releaseDifference = (right.releaseConfidence ?? 0) - (left.releaseConfidence ?? 0);
      if (Math.abs(releaseDifference) > 0.02) return releaseDifference;
      if (right.confidence !== left.confidence) return right.confidence - left.confidence;
      if (left.source !== right.source) return left.source === "itunes" ? -1 : 1;
      return (right.releaseYear || 0) - (left.releaseYear || 0);
    })
    .slice(0, 12);

  options?.onDiagnostics?.({
    rawCandidates: combined.size,
    acceptedCandidates: rows.filter((row) => row.confidence >= 0.72).length,
    returnedCandidates: rows.length,
    reason: rows.some((row) => row.confidence >= 0.72)
      ? "matches"
      : rows.length
        ? "low_confidence"
        : "no_catalog_results",
  });

  return rows;
}

export function musicMatchTier(confidence: number) {
  if (confidence >= 0.95) return "EXACT MATCH";
  if (confidence >= 0.87) return "STRONG MATCH";
  if (confidence >= 0.72) return "POSSIBLE MATCH";
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

export async function applyMusicArtworkCandidate(
  track: MusicTrack,
  candidate: MusicMetadataCandidate
) {
  if (!candidate.artworkUrl) return track;
  try {
    return await uploadRemoteMusicArtwork(track, candidate.artworkUrl);
  } catch (primaryError) {
    const fallback = candidate.artworkFallbackUrl;
    if (!fallback || fallback === candidate.artworkUrl) throw primaryError;
    return await uploadRemoteMusicArtwork(track, fallback);
  }
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
    updated = await applyMusicArtworkCandidate(updated, candidate);
  }

  return updated;
}

export async function enrichMusicTrack(
  track: MusicTrack,
  options?: {
    artworkOnly?: boolean;
    autoApplyThreshold?: number;
    onLookupRetry?: (info: MusicLookupRetryInfo) => void;
  }
): Promise<MusicEnrichmentResult> {
  // Existing artwork is locked during automatic enrichment. The only code path
  // allowed to replace it is the explicit artwork action in the song editor.
  if (options?.artworkOnly && !needsMusicArtwork(track)) {
    return {
      track,
      status: "matched",
      candidate: null,
      candidates: [],
      changed: false,
    };
  }

  const candidates = options?.artworkOnly
    ? await findMusicArtworkCandidates(track, { onRetry: options?.onLookupRetry })
    : await findMusicMetadataCandidates(track, { onRetry: options?.onLookupRetry });
  const candidate = candidates[0] || null;
  const threshold = options?.autoApplyThreshold ?? (options?.artworkOnly ? 0.89 : 0.985);

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
      needsMusicArtwork(track) &&
      candidate.artworkUrl &&
      candidate.confidence >= threshold
    ) {
      const updated = await applyMusicArtworkCandidate(track, candidate);

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

  const hasReleaseContext = Boolean(track.album?.trim()) || releaseVersionFlags(releaseContextText(track)).size > 0;
  const releaseSafe = !hasReleaseContext || (candidate.releaseConfidence ?? 0.7) >= 0.68;

  if (candidate.confidence >= threshold && releaseSafe) {
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

export async function delayMusicLookup(milliseconds = 450) {
  await new Promise<void>((resolve) =>
    window.setTimeout(resolve, milliseconds)
  );
}
