// src/lib/exerciseMatch.ts
//
// Unified filtering rules (ALL sources):
// - Equipment = cardio => show ONLY cardio. Muscle ignored.
// - Equipment = machine/free_weight => exclude cardio.
// - Equipment = all:
//     - Muscle = all => include cardio + everything else.
//     - Muscle != all => exclude cardio (so Chest doesn’t get treadmill noise).
//
// Used by BOTH:
// - LibraryPage.tsx
// - WorkoutPlayerPage.tsx (Edit modal search)

import icoDumbbell from "../assets/dumbbell.png";
import icoRunner from "../assets/runner.png";
import icoMachine from "../assets/cable-row-machine.png";

import icoChest from "../assets/gym.png";
import icoBack from "../assets/back (2).png";
import icoShoulders from "../assets/shoulder.png";
import icoArms from "../assets/biceps.png";
import icoCore from "../assets/human.png";
import icoLegs from "../assets/leg.png";
import icoQuads from "../assets/front.png";
import icoCalves from "../assets/muscles.png";

export type EquipKey = "all" | "machine" | "free_weight" | "cardio";
export type MuscleKey =
  | "all"
  | "chest"
  | "back"
  | "shoulders"
  | "arms"
  | "abs"
  | "legs"
  | "quads"
  | "calves";

export type UserMediaLite = {
  exercise_id: string;
  kind: "gif" | "video" | "poster";
  storage_path: string | null;
  use_user_upload: boolean;
};

function s(x: any) {
  return String(x ?? "").trim();
}
function lower(x: any) {
  return s(x).toLowerCase();
}

export function normalizeText(x: any) {
  return lower(x)
    .replace(/[_/]+/g, " ")
    .replace(/[-]+/g, " ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeArr(a: any): string[] {
  if (!a) return [];
  if (Array.isArray(a)) return a.map((x) => lower(x)).filter(Boolean);
  return [lower(a)].filter(Boolean);
}

function nameOf(ex: any) {
  return normalizeText(ex?.name ?? ex?.title ?? "");
}

function hasAny(haystack: string, needles: string[]) {
  for (const n of needles) if (n && haystack.includes(n)) return true;
  return false;
}

/* ===========================
   MEDIA: usable?
   =========================== */

function isNonEmptyString(x: any) {
  return typeof x === "string" && x.trim().length > 0;
}

export function builtHasUsableMedia(media: any) {
  if (!media || typeof media !== "object") return false;
  const gif = media?.gif;
  const video = media?.video;
  const poster = media?.poster;
  const image = media?.image;

  let images0: any = null;
  if (Array.isArray(media?.images) && media.images.length > 0) {
    const first = media.images[0];
    images0 =
      typeof first === "string"
        ? first
        : first?.url || first?.image || first?.src || null;
  }

  return (
    isNonEmptyString(gif) ||
    isNonEmptyString(video) ||
    isNonEmptyString(poster) ||
    isNonEmptyString(image) ||
    isNonEmptyString(images0)
  );
}

export function effectiveHasMedia(ex: any, userMediaRows: UserMediaLite[]) {
  const enabled = (userMediaRows ?? []).some(
    (m) => m.use_user_upload && isNonEmptyString(m.storage_path)
  );
  if (enabled) return true;
  return builtHasUsableMedia(ex?.media);
}

/* ===========================
   CARDIO: STRICT (name + tag helper)
   =========================== */

function hasDbCardioTag(ex: any): boolean {
  const equip = normalizeArr(ex?.equipment);
  const mus = normalizeArr(ex?.primary_muscles);
  return equip.includes("cardio") || mus.includes("cardio");
}

const CARDIO_REGEX: RegExp[] = [
  /\btreadmill\b/i,
  /\bjogging,\s*treadmill\b/i,
  /\brunning,\s*treadmill\b/i,
  /\bwalking,\s*treadmill\b/i,
  /\bincline walk,\s*treadmill\b/i,
  /\bincline walking,\s*treadmill\b/i,

  /\belliptical\b/i,
  /\bellitical\b/i,
  /\bcross trainer\b/i,
  /\barc trainer\b/i,
  /\barctrainer\b/i,

  /\bjog\b/i,
  /\bjogging\b/i,
  /\brunning\b/i,
  /\bsprint\b/i,
  /\bsprinting\b/i,

  /\bbike\b/i,
  /\bbiking\b/i,
  /\bbicycle\b/i,
  /\bcycling\b/i,
  /\bstationary bike\b/i,
  /\bindoor bike\b/i,
  /\bspin\b/i,
  /\bspinning\b/i,
  /\bair ?bike\b/i,
  /\bassault ?bike\b/i,

  /\brower\b/i,
  /\browing\b/i,
  /\berg\b/i,
  /\bergometer\b/i,
  /\bconcept2\b/i,

  /\bstair climber\b/i,
  /\bstair stepper\b/i,
  /\bstairmaster\b/i,
  /\bstair master\b/i,
  /\bstepmill\b/i,
  /\bstep mill\b/i,
  /\bclimber\b/i,

  /\bskierg\b/i,
  /\bski erg\b/i,
];

function isCardioByName(ex: any): boolean {
  const n = nameOf(ex);
  if (!n) return false;
  return CARDIO_REGEX.some((re) => re.test(n));
}

function isCardio(ex: any): boolean {
  return isCardioByName(ex) || hasDbCardioTag(ex);
}

/* ===========================
   MACHINE / FREE WEIGHT
   =========================== */

function isMachine(ex: any): boolean {
  const n = nameOf(ex);
  const equip = normalizeArr(ex?.equipment);

  if (n.includes("cable") || equip.includes("cable")) return true;

  if (
    equip.includes("machine") ||
    equip.includes("smith") ||
    equip.includes("pulley")
  )
    return true;

  if (
    n.includes("machine") ||
    n.includes("smith") ||
    n.includes("pulley") ||
    n.includes("lat pulldown") ||
    n.includes("leg press") ||
    n.includes("hack squat")
  ) {
    return true;
  }

  return false;
}

function equipClass(ex: any): Exclude<EquipKey, "all"> {
  if (isCardio(ex)) return "cardio";
  if (isMachine(ex)) return "machine";
  return "free_weight";
}

export function matchEquip(ex: any, key: EquipKey): boolean {
  if (!key || key === "all") return true;
  return equipClass(ex) === key;
}

/* ===========================
   MUSCLE MATCHING (name-first)
   =========================== */

const MUSCLE_KWS: Record<Exclude<MuscleKey, "all">, string[]> = {
  chest: ["chest", "pec", "pector", "bench", "fly", "flye", "chest press", "pec deck"],
  back: ["back", "row", "rows", "lat", "lats", "pulldown", "pull-down", "pullup", "pull-up", "chinup", "chin-up", "face pull"],
  shoulders: ["shoulder", "shoulders", "delt", "deltoid", "lateral raise", "side raise", "rear delt", "overhead press", "military press", "arnold press", "upright row"],
  arms: ["bicep", "biceps", "tricep", "triceps", "forearm", "curl", "curls", "hammer curl", "preacher", "pushdown", "push-down", "skullcrusher", "skull crusher", "extension", "extensions", "dip", "dips"],
  abs: ["abs", "abdominal", "abdominals", "core", "plank", "crunch", "crunches", "sit-up", "situp", "hollow", "leg raise", "hanging raise", "pallof", "woodchop", "wood chop", "russian twist"],
  legs: ["leg", "legs", "squat", "squats", "lunge", "lunges", "deadlift", "deadlifts", "rdl", "hip thrust", "glute bridge", "hamstring", "leg curl", "split squat", "step-up", "step up"],
  quads: ["quad", "quads", "quadricep", "quadriceps", "leg extension", "front squat", "sissy squat"],
  calves: ["calf", "calves", "soleus", "gastro", "gastrocnemius", "calf raise"],
};

function tagMatchesMuscle(tags: string[], key: Exclude<MuscleKey, "all">): boolean {
  const t = new Set(tags);

  if (key === "abs") return t.has("core") || t.has("abs") || t.has("abdominals");
  if (key === "arms") return t.has("biceps") || t.has("triceps") || t.has("forearms") || t.has("arms");
  if (key === "shoulders") return t.has("shoulders") || t.has("delts") || t.has("deltoids");
  if (key === "chest") return t.has("chest") || t.has("pectorals") || t.has("pecs");
  if (key === "back") return t.has("back") || t.has("lats") || t.has("upper back") || t.has("lower back");
  if (key === "legs") return t.has("legs") || t.has("glutes") || t.has("hamstrings") || t.has("quads") || t.has("quadriceps");
  if (key === "quads") return t.has("quads") || t.has("quadriceps");
  if (key === "calves") return t.has("calves");
  return false;
}

export function matchMuscle(ex: any, key: MuscleKey): boolean {
  if (!key || key === "all") return true;

  const n = nameOf(ex);
  const tags = normalizeArr(ex?.primary_muscles);
  const kws = MUSCLE_KWS[key];

  if (n && hasAny(n, kws)) return true;
  if (tags.length && tagMatchesMuscle(tags, key as any)) return true;

  return false;
}

/* ===========================
   COMBINED FILTER RULES (CONTRACT)
   =========================== */

export function matchFilters(ex: any, muscle: MuscleKey, equip: EquipKey): boolean {
  if (equip === "cardio") return isCardio(ex);

  if (equip === "machine") {
    if (isCardio(ex)) return false;
    return equipClass(ex) === "machine" && matchMuscle(ex, muscle);
  }
  if (equip === "free_weight") {
    if (isCardio(ex)) return false;
    return equipClass(ex) === "free_weight" && matchMuscle(ex, muscle);
  }

  if (equip === "all") {
    if (muscle === "all") return true;
    if (isCardio(ex)) return false;
    return matchMuscle(ex, muscle);
  }

  return true;
}

/* ===========================
   ROW ICONS
   =========================== */

export function resolveRowIcon(ex: any): { icon: string | null; alt: string } {
  const eq = equipClass(ex);

  if (eq === "cardio") return { icon: icoRunner, alt: "Cardio" };
  if (eq === "machine") return { icon: icoMachine, alt: "Machine" };

  const n = nameOf(ex);
  const tags = normalizeArr(ex?.primary_muscles);

  const keys: Exclude<MuscleKey, "all">[] = [
    "chest",
    "back",
    "shoulders",
    "arms",
    "abs",
    "legs",
    "quads",
    "calves",
  ];

  let m: Exclude<MuscleKey, "all"> | null = null;
  for (const k of keys) {
    if ((n && hasAny(n, MUSCLE_KWS[k])) || (tags.length && tagMatchesMuscle(tags, k))) {
      m = k;
      break;
    }
  }

  if (m === "chest") return { icon: icoChest, alt: "Chest" };
  if (m === "back") return { icon: icoBack, alt: "Back" };
  if (m === "shoulders") return { icon: icoShoulders, alt: "Shoulders" };
  if (m === "arms") return { icon: icoArms, alt: "Arms" };
  if (m === "abs") return { icon: icoCore, alt: "Core" };
  if (m === "legs") return { icon: icoLegs, alt: "Legs" };
  if (m === "quads") return { icon: icoQuads, alt: "Quads" };
  if (m === "calves") return { icon: icoCalves, alt: "Calves" };

  return { icon: icoDumbbell, alt: "Free weight" };
}
