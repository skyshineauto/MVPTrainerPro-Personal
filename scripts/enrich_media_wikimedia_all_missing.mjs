// scripts/enrich_media_wikimedia_all_missing.mjs
import "dotenv/config";
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

const MW_API = "https://commons.wikimedia.org/w/api.php";

const ALLOWED_EXT = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "svg",
  "mp4",
  "webm",
  "ogv",
]);

function extOfTitle(t) {
  const m = String(t || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

function stripHtml(s) {
  return String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function pickExt(meta, key) {
  return stripHtml(meta?.[key]?.value || "");
}

function isAcceptableLicense(licenseShortName) {
  const s = String(licenseShortName || "").toLowerCase();
  return (
    s.includes("cc by") ||
    s.includes("cc-by") ||
    s.includes("cc0") ||
    s.includes("public domain") ||
    s.includes("pd")
  );
}

async function fetchJson(url) {
  const r = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "trainer-media-bot/1.1" },
  });
  if (!r.ok) throw new Error(`Fetch failed ${r.status}: ${url}`);
  return await r.json();
}

function qs(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) sp.set(k, String(v));
  return sp.toString();
}

async function commonsSearchFile(query) {
  const url =
    MW_API +
    "?" +
    qs({
      action: "query",
      format: "json",
      origin: "*",
      list: "search",
      srnamespace: 6, // File:
      srlimit: 12,
      srsearch: query,
    });

  const data = await fetchJson(url);
  const results = data?.query?.search || [];
  return results.map((r) => r.title).filter(Boolean);
}

async function commonsGetImageInfo(fileTitle) {
  const url =
    MW_API +
    "?" +
    qs({
      action: "query",
      format: "json",
      origin: "*",
      prop: "imageinfo",
      titles: fileTitle,
      iiprop: "url|mime|extmetadata",
      iiurlwidth: 1280,
    });

  const data = await fetchJson(url);
  const pages = data?.query?.pages || {};
  const page = Object.values(pages)[0];
  const ii = page?.imageinfo?.[0];
  if (!ii) return null;

  const mime = String(ii.mime || "").toLowerCase();
  // Only accept actual image/video types
  if (!(mime.startsWith("image/") || mime.startsWith("video/"))) return null;

  const meta = ii.extmetadata || {};
  const licenseShort = pickExt(meta, "LicenseShortName");
  const licenseUrl = pickExt(meta, "LicenseUrl");
  const artist = pickExt(meta, "Artist");
  const credit = pickExt(meta, "Credit");
  const attribution = [artist, credit].filter(Boolean).join(" • ").trim();

  if (!licenseShort || !isAcceptableLicense(licenseShort)) return null;

  const poster = ii.thumburl || ii.url || "";
  const images = [poster, ii.url].filter(Boolean);

  return {
    poster,
    images: Array.from(new Set(images)).slice(0, 5),
    file_title: fileTitle,
    page_url: `https://commons.wikimedia.org/wiki/${encodeURIComponent(
      fileTitle.replace(/ /g, "_")
    )}`,
    license: licenseShort,
    license_url: licenseUrl || "",
    attribution: attribution || "Wikimedia Commons",
    mime,
  };
}

function buildQueries(slug, name, aliases = []) {
  const base = (name || slug.replace(/-/g, " ")).trim();
  const al = Array.isArray(aliases) ? aliases : [];

  const q = [];

  // Slug-specific high-signal phrases
  const special = {
    "chin-tuck": ["chin tuck exercise", "cervical chin tuck exercise"],
    "chin-tuck-lift": ["chin tuck lift exercise", "chin tuck with lift exercise"],
    "wall-slide": ["wall slide exercise", "shoulder wall slide exercise"],
    "serratus-wall-slide": ["serratus wall slide exercise", "serratus wall slide plus exercise"],
    "thoracic-extension-foam-roller": [
      "thoracic extension foam roller exercise",
      "thoracic spine extension foam roller",
    ],
    "doorway-pec-stretch": ["doorway pec stretch", "doorway chest stretch"],
    "dead-bug": ["dead bug exercise", "deadbug exercise"],
    "pronation-supination": ["forearm pronation supination exercise"],
    "radial-deviation": ["wrist radial deviation exercise"],
    "ulnar-deviation": ["wrist ulnar deviation exercise"],
    "wrist-extension-eccentric": ["eccentric wrist extension exercise"],
    "finger-extensor-opens": ["rubber band finger extensions"],
    "gentle-grip-isometrics": ["hand grip isometric exercise"],
    "tibialis-raise": ["tibialis raise exercise", "tibialis anterior raise"],
    "farmer-carry": ["farmer's walk exercise", "farmer carry exercise"],
    "suitcase-carry": ["suitcase carry exercise", "one arm carry exercise"],
    "scapular-pullup-hold": ["scapular pull-up exercise", "scapular pull up hold"],
    "band-pull-apart": ["band pull-apart exercise", "band pull apart exercise"],
    "pec-deck": ["pec deck machine", "butterfly machine exercise", "pec deck fly machine"],
  };
  if (special[slug]) q.push(...special[slug]);

  // Alias-based queries
  for (const a of al.slice(0, 8)) {
    const aa = String(a || "").trim();
    if (aa.length >= 3) q.push(`${aa} exercise`);
  }

  // Generic queries
  q.push(`${base} exercise`);
  q.push(`${base} gym`);
  q.push(`${base} photo`);

  // dedupe + limit
  const out = [];
  const seen = new Set();
  for (const s of q) {
    const ss = String(s || "").trim();
    const key = ss.toLowerCase();
    if (!ss || seen.has(key)) continue;
    seen.add(key);
    out.push(ss);
  }
  return out.slice(0, 18);
}

async function findWikimediaMedia(slug, name, aliases) {
  const queries = buildQueries(slug, name, aliases);

  for (const q of queries) {
    const titles = await commonsSearchFile(q);
    // Filter to allowed extensions immediately
    const goodTitles = titles.filter((t) => ALLOWED_EXT.has(extOfTitle(t)));

    for (const title of goodTitles) {
      const info = await commonsGetImageInfo(title);
      if (info?.poster) return info;
    }
  }
  return null;
}

function hasMediaObj(media) {
  if (!media || typeof media !== "object") return false;
  return JSON.stringify(media) !== "{}";
}

async function main() {
  console.log("Loading canonical exercises...");
  const { data: canonical, error } = await supabase
    .from("exercises")
    .select("id,slug,name,aliases,media")
    .eq("source", "canonical")
    .order("name");

  if (error) throw error;

  let updated = 0;
  let skippedHasMedia = 0;
  let notFound = 0;

  for (const row of canonical) {
    if (hasMediaObj(row.media)) {
      skippedHasMedia++;
      continue;
    }

    const info = await findWikimediaMedia(row.slug, row.name, row.aliases);
    if (!info) {
      notFound++;
      console.log(`No Wikimedia MEDIA match: ${row.slug} (${row.name})`);
      continue;
    }

    const media = {
      source: "wikimedia",
      video: null,
      gif: null,
      poster: info.poster,
      images: info.images,
      license: info.license,
      license_url: info.license_url || null,
      attribution: info.attribution,
      page_url: info.page_url,
      file_title: info.file_title,
      mime: info.mime,
    };

    const { error: upErr } = await supabase
      .from("exercises")
      .update({ media })
      .eq("id", row.id);
    if (upErr) throw upErr;

    updated++;
    console.log(`Updated: ${row.slug} -> ${info.file_title}`);
  }

  console.log("----");
  console.log(`Updated: ${updated}`);
  console.log(`Skipped already has media: ${skippedHasMedia}`);
  console.log(`Not found: ${notFound}`);
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});