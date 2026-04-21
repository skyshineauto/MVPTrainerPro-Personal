// enrich_wger_one.mjs
// Run:
// node enrich_wger_one.mjs <EXERCISE_UUID> <WGER_IMAGE_URL>

const [exerciseUuid, imageUrl] = process.argv.slice(2);

if (!exerciseUuid || !imageUrl) {
  console.log("Usage: node enrich_wger_one.mjs <EXERCISE_UUID> <WGER_IMAGE_URL>");
  process.exit(1);
}

const EDGE_URL = process.env.VITE_EXERCISE_MEDIA_SYNC_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!EDGE_URL) throw new Error("Missing VITE_EXERCISE_MEDIA_SYNC_URL in .env");
if (!ANON_KEY) throw new Error("Missing VITE_SUPABASE_ANON_KEY in .env");

const payload = {
  source: "wger",
  exercise_uuid: exerciseUuid,
  image_url: imageUrl,
};

const res = await fetch(EDGE_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    apikey: ANON_KEY,
    Authorization: `Bearer ${ANON_KEY}`,
  },
  body: JSON.stringify(payload),
});

const text = await res.text();
console.log("Status:", res.status);
console.log(text);