import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const BUCKET = "exercise-media"; // your existing bucket
const WGER_BASE = "https://wger.de/api/v2";
const LANGUAGE_EN = 2;

// Start strict-ish. If coverage is low, drop to 0.55.
const MIN_SCORE = 0.60;

// Only fetch media for template-used exercises missing media
const TARGET_LIMIT = 200;

// Upload max images per exercise
const MAX_IMAGES = 2;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s) {
  return norm(s).split(" ").filter(Boolean);
}

// token overlap / Jaccard
function scoreName(a, b) {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;

  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = new Set([...A, ...B]).size;
  return inter / union;
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: { "User-Agent": "mvp-trainer-media-sync/1.0" } });
  if (!r.ok) throw new Error(`Fetch failed ${r.status}: ${url}`);
  return await r.json();
}

async function wgerDownloadAllEnglishExercises(max = 10000) {
  let url = `${WGER_BASE}/exercise/?language=${LANGUAGE_EN}&limit=200&offset=0`;
  const out = [];
  while (url && out.length < max) {
    const data = await fetchJson(url);
    for (const ex of data.results || []) {
      if (ex?.id && ex?.name) out.push({ id: ex.id, name: ex.name });
    }
    url = data.next;
  }
  return out;
}

async function wgerGetImages(exerciseId) {
  // WGER exerciseimage endpoint
  const url = `${WGER_BASE}/exerciseimage/?exercise=${exerciseId}&limit=20`;
  const data = await fetchJson(url);
  const results = data?.results ?? [];
  const urls = results
    .map((r) => r.image || r.image_url || r.url)
    .filter((x) => typeof x === "string" && x.startsWith("http"));
  return Array.from(new Set(urls));
}

async function uploadToBucket(exerciseUuid, imageUrl, idx) {
  const r = await fetch(imageUrl, { headers: { "User-Agent": "mvp-trainer-media-sync/1.0" } });
  if (!r.ok) throw new Error(`Image fetch failed ${r.status}: ${imageUrl}`);

  const buf = Buffer.from(await r.arrayBuffer());
  const extGuess = (imageUrl.split(".").pop() || "jpg").split("?")[0].toLowerCase();
  const ext = ["jpg", "jpeg", "png", "webp", "gif"].includes(extGuess) ? extGuess : "jpg";

  const path = `exercises/${exerciseUuid}/wger_${idx}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, buf, {
    upsert: true,
    contentType:
      ext === "png"
        ? "image/png"
        : ext === "webp"
        ? "image/webp"
        : ext === "gif"
        ? "image/gif"
        : "image/jpeg",
  });
  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

async function listTemplateExercisesNeedingMedia(limit = 200) {
  // Pull exercise_ids used in templates
  const { data: te, error: teErr } = await supabase
    .from("template_exercises")
    .select("exercise_id")
    .limit(1000);

  if (teErr) throw teErr;
  const ids = Array.from(new Set((te ?? []).map((x) => x.exercise_id).filter(Boolean)));

  if (!ids.length) return [];

  const { data: ex, error: exErr } = await supabase
    .from("exercises")
    .select("id,name,media,source,source_id")
    .in("id", ids)
    .limit(limit);

  if (exErr) throw exErr;

  return (ex ?? []).filter((r) => !r.media || JSON.stringify(r.media) === "{}");
}

function bestMatch(name, index) {
  let best = null;
  let bestScore = 0;

  for (const cand of index) {
    const s = scoreName(name, cand.name);
    if (s > bestScore) {
      bestScore = s;
      best = cand;
    }
  }
  return { best, bestScore };
}

async function main() {
  console.log("Downloading WGER English exercise index...");
  const index = await wgerDownloadAllEnglishExercises();
  console.log(`WGER index size: ${index.length}`);

  console.log("Loading template exercises needing media...");
  const targets = await listTemplateExercisesNeedingMedia(TARGET_LIMIT);
  console.log(`Targets needing media: ${targets.length}`);

  let matched = 0;
  let updated = 0;
  let noMatch = 0;
  let noImages = 0;

  for (const t of targets) {
    const exId = t.id;
    const name = t.name;

    const { best, bestScore } = bestMatch(name, index);

    console.log(`\n=== ${name} (${exId}) ===`);
    if (!best || bestScore < MIN_SCORE) {
      console.log(`No confident match. best="${best?.name ?? "—"}" score=${bestScore.toFixed(2)} -> SKIP`);
      noMatch++;
      continue;
    }

    matched++;
    console.log(`Matched WGER: "${best.name}" (id=${best.id}) score=${bestScore.toFixed(2)}`);

    const imgUrls = await wgerGetImages(best.id);
    if (!imgUrls.length) {
      console.log("Match found but WGER has no images -> SKIP");
      noImages++;
      continue;
    }

    const take = imgUrls.slice(0, MAX_IMAGES);
    const uploaded = [];
    for (let i = 0; i < take.length; i++) {
      const publicUrl = await uploadToBucket(exId, take[i], i + 1);
      uploaded.push(publicUrl);
      console.log(`Uploaded: ${publicUrl}`);
    }

    const media = {
      source: "wger",
      wger_exercise_id: best.id,
      images: uploaded,
      poster: uploaded[0],
    };

    const { error: upErr } = await supabase.from("exercises").update({ media }).eq("id", exId);
    if (upErr) throw upErr;

    updated++;
    console.log("Updated exercises.media ✅");
  }

  console.log("\n==== SUMMARY ====");
  console.log(`Matched (score>=${MIN_SCORE}): ${matched}`);
  console.log(`No confident match: ${noMatch}`);
  console.log(`Matched but no images: ${noImages}`);
  console.log(`Updated media: ${updated}`);
}

main().catch((e) => {
  console.error("FAILED:", e?.message || e);
  process.exit(1);
});