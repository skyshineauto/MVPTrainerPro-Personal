// scripts/enrich_media_exercemus_then_wger.mjs
import "dotenv/config";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari";

function stripParens(s) {
  return String(s || "").replace(/\([^)]*\)/g, " ");
}
function norm(s) {
  return stripParens(String(s || ""))
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function tokens(s) {
  const t = norm(s).split(" ").filter(Boolean);
  const stop = new Set([
    "machine",
    "db",
    "dumbbell",
    "barbell",
    "smith",
    "neutral",
    "flat",
    "incline",
    "seated",
    "standing",
    "single",
    "arm",
    "one",
    "degree",
    "light",
    "strict",
    "controlled",
    "rom",
    "option",
    "if",
    "needed",
  ]);
  return t.filter((w) => !stop.has(w));
}
function jaccard(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

async function fetchJson(url) {
  const r = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": UA,
    },
  });
  if (!r.ok) throw new Error(`Fetch failed ${r.status}: ${url}`);
  return await r.json();
}

function getListResults(data) {
  return Array.isArray(data?.results)
    ? data.results
    : Array.isArray(data?.result)
      ? data.result
      : [];
}

// ---- media helpers ----
function isNonEmptyString(x) {
  return typeof x === "string" && x.trim().length > 0;
}

function mediaHasUsableAsset(media) {
  if (!media || typeof media !== "object") return false;

  const gif = media.gif;
  const video = media.video;
  const poster = media.poster;
  const image = media.image;
  const images0 =
    Array.isArray(media.images) && media.images.length
      ? (typeof media.images[0] === "string"
          ? media.images[0]
          : media.images[0]?.url || media.images[0]?.image || media.images[0]?.src || null)
      : null;

  return (
    isNonEmptyString(gif) ||
    isNonEmptyString(video) ||
    isNonEmptyString(poster) ||
    isNonEmptyString(image) ||
    isNonEmptyString(images0)
  );
}

function pickMediaFromExercemus(ex) {
  const images = Array.isArray(ex?.images) ? ex.images : [];
  const video = typeof ex?.video === "string" ? ex.video : null;

  const poster = images.find((u) => typeof u === "string" && u.length) || null;
  const license = ex?.license?.full_name || ex?.license?.short_name || null;
  const license_url = ex?.license?.url || null;
  const author = ex?.license_author || null;

  if (!video && !poster && images.length === 0) return null;

  return {
    source: "exercemus",
    video: video || null,
    gif: null,
    poster,
    images: images.slice(0, 5),
    license: license || null,
    license_url,
    attribution: author || null,
    exercemus_name: ex?.name || null,
  };
}

function wgerNameFromExerciseInfo(item) {
  const translations = Array.isArray(item?.translations) ? item.translations : [];
  const en = translations.find((t) => t?.language === 2 && t?.name);
  if (en?.name) return en.name;
  const any = translations.find((t) => t?.name);
  return any?.name || null;
}

function wgerHasMedia(item) {
  const imgs = Array.isArray(item?.images) ? item.images : [];
  const vids = Array.isArray(item?.videos) ? item.videos : [];
  return imgs.length > 0 || vids.length > 0;
}

function wgerMediaFromExerciseInfo(item) {
  const imgsRaw = Array.isArray(item?.images) ? item.images : [];
  const vidsRaw = Array.isArray(item?.videos) ? item.videos : [];

  const imgUrls = imgsRaw
    .map((x) => (typeof x === "string" ? x : x?.image || x?.url || x?.src || null))
    .filter(Boolean);

  const vidUrls = vidsRaw
    .map((x) => (typeof x === "string" ? x : x?.video || x?.url || x?.src || null))
    .filter(Boolean);

  const poster = imgUrls[0] || null;
  const video = vidUrls[0] || null;

  if (!poster && !video) return null;

  const lic = item?.license?.full_name || item?.license?.short_name || null;
  const licUrl = item?.license?.url || null;
  const author = item?.license_author || null;

  return {
    source: "wger",
    video: video || null,
    gif: null,
    poster,
    images: imgUrls.slice(0, 5),
    license: lic || "wger (see source)",
    license_url: licUrl || null,
    attribution: author || "wger.de",
    wger_exerciseinfo_id: item?.id ?? null,
  };
}

async function loadWgerExerciseInfoAll() {
  const out = [];
  let url = "https://wger.de/api/v2/exerciseinfo/?language=2&limit=200&offset=0";
  const first = await fetchJson(url);
  const firstRes = getListResults(first);

  console.log(
    `wger exerciseinfo: count=${first?.count ?? "?"}, firstPageItems=${firstRes.length}`
  );

  out.push(...firstRes);
  url = first?.next || null;

  while (url) {
    const data = await fetchJson(url);
    const res = getListResults(data);
    out.push(...res);
    url = data?.next || null;
  }
  return out;
}

function csvEscape(v) {
  const s = String(v ?? "");
  return `"${s.replaceAll('"', '""')}"`;
}

// ---- NEW: load ALL exercises missing usable media, paged ----
async function loadExercisesMissingMediaPaged(pageSize = 500) {
  console.log("Loading ALL exercises missing usable media from Supabase (paged)...");
  let all = [];
  let from = 0;

  for (;;) {
    const to = from + pageSize - 1;

    const { data, error } = await supabase
      .from("exercises")
      .select("id,slug,name,aliases,media,template_params,source")
      .order("name")
      .range(from, to);

    if (error) throw error;
    if (!data || data.length === 0) break;

    // filter in JS so we can apply the real “usable media” rule
    const batch = data.filter((r) => {
      // skip manual media rows
      if (r?.template_params?.manual_media === true) return false;
      // keep only if missing usable asset
      return !mediaHasUsableAsset(r?.media);
    });

    all.push(...batch);

    if (data.length < pageSize) break;
    from += pageSize;
  }

  console.log(`Candidates missing usable media: ${all.length}`);
  return all;
}

async function main() {
  // 1) Load candidates (ALL sources, missing usable media)
  const candidates = await loadExercisesMissingMediaPaged(500);

  // 2) Pull Exercemus dataset
  console.log("Fetching Exercemus minified dataset...");
  const exercemusUrl =
    "https://raw.githubusercontent.com/exercemus/exercises/minified/minified-exercises.json";
  const exercemusJson = await fetchJson(exercemusUrl);
  const exercemusArr = Array.isArray(exercemusJson?.exercises)
    ? exercemusJson.exercises
    : [];

  const exercemusWithMedia = exercemusArr
    .map((ex) => ({ name: ex?.name, t: tokens(ex?.name), media: pickMediaFromExercemus(ex) }))
    .filter((x) => x.media);

  console.log(`Exercemus w/ media: ${exercemusWithMedia.length}`);

  // 3) Pull WGER exerciseinfo list
  console.log("Loading full wger exerciseinfo list...");
  const wgerAll = await loadWgerExerciseInfoAll();

  const wgerNames = [];
  const wgerMedia = [];

  for (const item of wgerAll) {
    const name = wgerNameFromExerciseInfo(item);
    if (!name) continue;

    const base = {
      id: item?.id ?? null,
      name,
      t: tokens(name),
      has_media: wgerHasMedia(item),
    };
    wgerNames.push(base);

    const media = wgerMediaFromExerciseInfo(item);
    if (media) wgerMedia.push({ id: item?.id ?? null, name, t: base.t, media });
  }

  console.log(`wger total named: ${wgerNames.length}`);
  console.log(`wger w/ media: ${wgerMedia.length}`);

  // 4) Overrides table (optional)
  const { data: overrides, error: ovErr } = await supabase
    .from("exercise_media_overrides")
    .select("canonical_slug,wger_exerciseinfo_id");
  if (ovErr) throw ovErr;

  const overrideBySlug = new Map(
    (overrides || []).map((r) => [r.canonical_slug, r.wger_exerciseinfo_id])
  );

  const wgerMediaById = new Map(wgerMedia.map((x) => [x.id, x.media]));

  let matchedExercemus = 0;
  let matchedWger = 0;
  let skippedHasMedia = 0; // should be near 0 now because candidates already missing usable media
  let missingAll = 0;

  const missingRows = [];

  for (const row of candidates) {
    // safety: if it somehow has usable media now, skip
    if (mediaHasUsableAsset(row?.media)) {
      skippedHasMedia++;
      continue;
    }

    // override first (only meaningful for canonical slugs)
    const ovId = row?.slug ? overrideBySlug.get(row.slug) : null;
    if (ovId) {
      const media = wgerMediaById.get(ovId);
      if (media) {
        matchedWger++;
        await supabase.from("exercises").update({ media }).eq("id", row.id);
        continue;
      }
    }

    const candNames = [row.name, ...(Array.isArray(row.aliases) ? row.aliases : [])];
    const rowTokens = tokens(candNames.join(" "));

    // Exercemus best
    let bestE = null;
    for (const item of exercemusWithMedia) {
      const score = jaccard(rowTokens, item.t);
      if (!bestE || score > bestE.score) bestE = { score, item };
    }
    if (bestE && bestE.score >= 0.35) {
      matchedExercemus++;
      await supabase.from("exercises").update({ media: bestE.item.media }).eq("id", row.id);
      continue;
    }

    // wger best (media only)
    let bestMedia = null;
    for (const item of wgerMedia) {
      const score = jaccard(rowTokens, item.t);
      if (!bestMedia || score > bestMedia.score) bestMedia = { score, item };
    }

    // also keep a “name best” record for reporting
    let bestName = null;
    for (const item of wgerNames) {
      const score = jaccard(rowTokens, item.t);
      if (!bestName || score > bestName.score) bestName = { score, item };
    }

    if (bestMedia && bestMedia.score >= 0.35) {
      matchedWger++;
      await supabase.from("exercises").update({ media: bestMedia.item.media }).eq("id", row.id);
      continue;
    }

    missingAll++;
    missingRows.push({
      id: row.id,
      slug: row.slug || "",
      name: row.name,
      source: row.source || "",
      aliases: Array.isArray(row.aliases) ? row.aliases.join("|") : "",
      best_wger_score: bestName?.score ?? 0,
      best_wger_id: bestName?.item?.id ?? "",
      best_wger_name: bestName?.item?.name ?? "",
      best_wger_has_media: bestName?.item?.has_media ?? "",
      best_exercemus_score: bestE?.score ?? 0,
      best_exercemus_name: bestE?.item?.name ?? "",
      note: bestName?.item?.has_media
        ? "wger_has_media=true_but_low_match"
        : "wger_has_media=false",
    });
  }

  // report
  const header = [
    "id",
    "slug",
    "name",
    "source",
    "aliases",
    "best_wger_score",
    "best_wger_id",
    "best_wger_name",
    "best_wger_has_media",
    "best_exercemus_score",
    "best_exercemus_name",
    "note",
  ];
  const lines = [header.map(csvEscape).join(",")];
  for (const r of missingRows) {
    lines.push(
      [
        r.id,
        r.slug,
        r.name,
        r.source,
        r.aliases,
        r.best_wger_score,
        r.best_wger_id,
        r.best_wger_name,
        r.best_wger_has_media,
        r.best_exercemus_score,
        r.best_exercemus_name,
        r.note,
      ]
        .map(csvEscape)
        .join(",")
    );
  }
  fs.writeFileSync("missing_media_report.csv", lines.join("\n"), "utf8");

  console.log(`Matched Exercemus: ${matchedExercemus}`);
  console.log(`Matched Wger: ${matchedWger}`);
  console.log(`Skipped (now has usable media): ${skippedHasMedia}`);
  console.log(`Still missing: ${missingAll}`);
  console.log(`Wrote missing_media_report.csv (${missingRows.length} rows)`);
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});