// scripts/import_exercises.mjs
import "dotenv/config";
import slugify from "slugify";
import { createClient } from "@supabase/supabase-js";

// ✅ Use SERVICE ROLE env vars (bypasses RLS for one-time import)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  console.error("Found SUPABASE_URL:", !!SUPABASE_URL);
  console.error("Found SUPABASE_SERVICE_ROLE_KEY:", !!SUPABASE_SERVICE_ROLE_KEY);
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const WGER_BASE = "https://wger.de/api/v2";
const FREE_DB_URL =
  "https://raw.githubusercontent.com/yuhonas/free-exercise-db/master/dist/exercises.json";

function normToken(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ");
}

function mkSlug(name, equipment = []) {
  const base = slugify(name, { lower: true, strict: true });
  const eq = (equipment || [])
    .slice(0, 2)
    .map((x) => slugify(x, { lower: true, strict: true }))
    .join("-");
  return eq ? `${base}-${eq}` : base;
}

function inferPattern(name, muscles = []) {
  const n = normToken(name);
  const m = muscles.map(normToken).join(" ");
  if (/(squat|lunge|split squat|leg press|step up)/.test(n)) return "squat";
  if (/(deadlift|rdl|hinge|good morning|hip hinge)/.test(n)) return "hinge";
  if (/(hip thrust|glute bridge)/.test(n)) return "hinge";
  if (/(bench|press|push up|dip|chest press|shoulder press)/.test(n))
    return "push";
  if (
    /(row|pull down|pulldown|pull up|pullup|chin up|chinup|face pull)/.test(n)
  )
    return "pull";
  if (/(carry|farmers walk|suitcase carry)/.test(n)) return "carry";
  if (/(plank|dead bug|bird dog|pallof|hollow|crunch)/.test(n)) return "core";
  if (/(chest|pec)/.test(m)) return "push";
  if (/(back|lat|trap|rhomboid)/.test(m)) return "pull";
  if (/(quad|glute|hamstring|calf)/.test(m)) return "squat";
  return "core";
}

function inferTemplate(name, pattern) {
  const n = normToken(name);
  if (/(lateral raise)/.test(n)) return "lateral_raise";
  if (/(rear delt|reverse fly)/.test(n)) return "reverse_fly";
  if (/(face pull)/.test(n)) return "face_pull";
  if (/(curl)/.test(n)) return "curl";
  if (/(triceps|pressdown|skullcrusher|extension)/.test(n)) return "triceps";
  if (/(calf)/.test(n)) return "calf_raise";
  if (/(dead bug)/.test(n)) return "dead_bug";
  if (/(bird dog)/.test(n)) return "bird_dog";
  if (/(plank)/.test(n)) return "plank";
  if (pattern === "squat") return "squat";
  if (pattern === "hinge") return "hinge";
  if (pattern === "push") return "press";
  if (pattern === "pull") return "row";
  if (pattern === "carry") return "carry";
  if (pattern === "core") return "core";
  return "generic";
}

function cleanInstructions(text) {
  if (!text) return [];
  const t = String(text)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return [];
  const parts = t
    .split(/\. (?=[A-Z0-9])/)
    .map((x) => x.trim())
    .filter(Boolean);
  return parts.length ? parts : [t];
}

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Fetch failed: ${url} ${r.status}`);
  return await r.json();
}

async function fetchWgerExercises(limit = 5000) {
  let url = `${WGER_BASE}/exercise/?limit=200&offset=0&language=2`; // English
  const out = [];
  while (url && out.length < limit) {
    const data = await fetchJson(url);
    for (const ex of data.results || []) {
      if (!ex.name) continue;
      out.push({
        name: ex.name,
        source: "wger",
        source_id: String(ex.id),
        source_url: ex.url || null,
        instructions: cleanInstructions(ex.description),
        primary_muscles: [],
        secondary_muscles: [],
        equipment: [],
      });
    }
    url = data.next;
  }
  return out;
}

async function fetchFreeExerciseDb() {
  const data = await fetchJson(FREE_DB_URL);
  return (data || [])
    .filter((x) => x.name)
    .map((x) => ({
      name: x.name,
      source: "free_exercise_db",
      source_id: mkSlug(x.name, [x.equipment].filter(Boolean)),
      source_url: null,
      difficulty: x.level || null,
      instructions: Array.isArray(x.instructions)
        ? x.instructions.filter(Boolean)
        : cleanInstructions(x.instructions),
      primary_muscles: Array.isArray(x.primaryMuscles)
        ? x.primaryMuscles.map(normToken)
        : [],
      secondary_muscles: Array.isArray(x.secondaryMuscles)
        ? x.secondaryMuscles.map(normToken)
        : [],
      equipment: x.equipment ? [normToken(x.equipment)] : [],
    }));
}

function mergeExercise(a, b) {
  const aliases = new Set(
    [...(a.aliases || []), ...(b.aliases || []), a.name, b.name].filter(Boolean)
  );
  const primary = new Set(
    [...(a.primary_muscles || []), ...(b.primary_muscles || [])]
      .map(normToken)
      .filter(Boolean)
  );
  const secondary = new Set(
    [...(a.secondary_muscles || []), ...(b.secondary_muscles || [])]
      .map(normToken)
      .filter(Boolean)
  );
  const equipment = new Set(
    [...(a.equipment || []), ...(b.equipment || [])]
      .map(normToken)
      .filter(Boolean)
  );
  const instructions =
    a.instructions && a.instructions.length ? a.instructions : b.instructions;

  const name = a.name.length >= b.name.length ? a.name : b.name;

  return {
    ...a,
    name,
    aliases: Array.from(aliases).filter((x) => x && x !== name),
    primary_muscles: Array.from(primary),
    secondary_muscles: Array.from(secondary),
    equipment: Array.from(equipment),
    instructions: instructions || [],
    difficulty: a.difficulty || b.difficulty || null,
  };
}

async function upsertBatch(rows) {
  const { error } = await supabase
    .from("exercises")
    .upsert(rows, { onConflict: "slug" });
  if (error) throw error;
}

(async function main() {
  console.log("Fetching sources...");
  const [wger, freeDb] = await Promise.all([
    fetchWgerExercises(),
    fetchFreeExerciseDb(),
  ]);
  console.log(`wger: ${wger.length} | freeDb: ${freeDb.length}`);

  const map = new Map();

  function keyFor(x) {
    const eq = (x.equipment || []).slice(0, 2).join(",");
    return `${normToken(x.name)}|${eq}`;
  }

  for (const x of [...wger, ...freeDb]) {
    const k = keyFor(x);
    if (!map.has(k)) map.set(k, x);
    else map.set(k, mergeExercise(map.get(k), x));
  }

  const merged = Array.from(map.values()).map((x) => {
    const pattern = inferPattern(x.name, x.primary_muscles || []);
    const template_id = inferTemplate(x.name, pattern);
    const equipment = (x.equipment || []).map(normToken).filter(Boolean);
    const slug = mkSlug(x.name, equipment);

    return {
      slug,
      name: x.name,
      aliases: x.aliases || [],
      primary_muscles: (x.primary_muscles || []).map(normToken).filter(Boolean),
      secondary_muscles: (x.secondary_muscles || []).map(normToken).filter(Boolean),
      equipment,
      patterns: [pattern],
      instructions: (x.instructions || []).map((s) => String(s).trim()).filter(Boolean),
      difficulty: x.difficulty || null,
      source: x.source,
      source_id: x.source_id,
      source_url: x.source_url || null,
      template_id,
      template_params: {},
      status: "active",
    };
  });

  console.log(`Merged total: ${merged.length}`);
  console.log("Upserting into Supabase in batches...");
  const batchSize = 500;
  for (let i = 0; i < merged.length; i += batchSize) {
    const batch = merged.slice(i, i + batchSize);
    await upsertBatch(batch);
    console.log(`Upserted ${Math.min(i + batchSize, merged.length)} / ${merged.length}`);
  }
  console.log("Done.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});