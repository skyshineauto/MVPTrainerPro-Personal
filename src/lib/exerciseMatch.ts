// src/lib/exerciseMatch.ts
//
// Unified filtering rules used by the Library, active-session editor,
// and planned-session editor.

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

export type MuscleDetailKey =
  | "all"
  | "biceps"
  | "triceps"
  | "forearms"
  | "lats"
  | "middle_back"
  | "lower_back"
  | "traps"
  | "front_delts"
  | "side_delts"
  | "rear_delts"
  | "quadriceps"
  | "hamstrings"
  | "glutes"
  | "calves"
  | "adductors"
  | "abductors"
  | "abdominals"
  | "obliques";

export type MuscleDetailOption = {
  key: MuscleDetailKey;
  label: string;
};

export type UserMediaLite = {
  exercise_id: string;
  kind: "gif" | "video" | "poster";
  storage_path: string | null;
  use_user_upload: boolean;
};

const DETAIL_OPTIONS: Partial<Record<Exclude<MuscleKey, "all">, MuscleDetailOption[]>> = {
  arms: [
    { key: "all", label: "ALL ARMS" },
    { key: "biceps", label: "BICEPS" },
    { key: "triceps", label: "TRICEPS" },
    { key: "forearms", label: "FOREARMS / GRIP" },
  ],
  back: [
    { key: "all", label: "ALL BACK" },
    { key: "lats", label: "LATS" },
    { key: "middle_back", label: "MIDDLE / UPPER BACK" },
    { key: "lower_back", label: "LOWER BACK" },
    { key: "traps", label: "TRAPS" },
  ],
  shoulders: [
    { key: "all", label: "ALL SHOULDERS" },
    { key: "front_delts", label: "FRONT DELTS" },
    { key: "side_delts", label: "SIDE DELTS" },
    { key: "rear_delts", label: "REAR DELTS" },
  ],
  legs: [
    { key: "all", label: "ALL LEGS" },
    { key: "quadriceps", label: "QUADRICEPS" },
    { key: "hamstrings", label: "HAMSTRINGS" },
    { key: "glutes", label: "GLUTES" },
    { key: "calves", label: "CALVES" },
    { key: "adductors", label: "ADDUCTORS" },
    { key: "abductors", label: "ABDUCTORS" },
  ],
  abs: [
    { key: "all", label: "ALL CORE" },
    { key: "abdominals", label: "ABDOMINALS" },
    { key: "obliques", label: "OBLIQUES" },
  ],
};

export function getMuscleDetailOptions(muscle: MuscleKey): MuscleDetailOption[] {
  if (!muscle || muscle === "all") return [];
  return DETAIL_OPTIONS[muscle] ?? [];
}

export function detailToPrimaryMuscleTag(
  detail: MuscleDetailKey,
  broad: Exclude<MuscleKey, "all">
): string {
  if (!detail || detail === "all") {
    if (broad === "abs") return "abdominals";
    if (broad === "quads") return "quadriceps";
    return broad;
  }

  const map: Record<Exclude<MuscleDetailKey, "all">, string> = {
    biceps: "biceps",
    triceps: "triceps",
    forearms: "forearms",
    lats: "lats",
    middle_back: "middle back",
    lower_back: "lower back",
    traps: "traps",
    front_delts: "shoulders",
    side_delts: "shoulders",
    rear_delts: "shoulders",
    quadriceps: "quadriceps",
    hamstrings: "hamstrings",
    glutes: "glutes",
    calves: "calves",
    adductors: "adductors",
    abductors: "abductors",
    abdominals: "abdominals",
    obliques: "obliques",
  };

  return map[detail];
}

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
  if (Array.isArray(a)) return a.map((x) => normalizeText(x)).filter(Boolean);
  return [normalizeText(a)].filter(Boolean);
}

function nameOf(ex: any) {
  return normalizeText(ex?.name ?? ex?.title ?? "");
}

function hasAny(haystack: string, needles: string[]) {
  for (const n of needles) if (n && haystack.includes(normalizeText(n))) return true;
  return false;
}

function isNonEmptyString(x: any) {
  return typeof x === "string" && x.trim().length > 0;
}

const BUILT_MEDIA_FAILURE_KEY = "mvp_exercise_built_media_failures_v1";

function readBuiltMediaFailures(): Record<string, number> {
  try {
    const raw = localStorage.getItem(BUILT_MEDIA_FAILURE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeBuiltMediaFailures(value: Record<string, number>) {
  try {
    localStorage.setItem(BUILT_MEDIA_FAILURE_KEY, JSON.stringify(value));
  } catch {
    // Media health persistence is best-effort only.
  }
}

export function markBuiltMediaInvalid(exerciseId: string) {
  if (!exerciseId) return;
  const map = readBuiltMediaFailures();
  map[exerciseId] = Date.now();
  writeBuiltMediaFailures(map);
}

export function clearBuiltMediaInvalid(exerciseId: string) {
  if (!exerciseId) return;
  const map = readBuiltMediaFailures();
  if (!(exerciseId in map)) return;
  delete map[exerciseId];
  writeBuiltMediaFailures(map);
}

export function isBuiltMediaInvalid(exerciseId: string) {
  if (!exerciseId) return false;
  return Boolean(readBuiltMediaFailures()[exerciseId]);
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
  if (isBuiltMediaInvalid(String(ex?.id ?? ""))) return false;
  return builtHasUsableMedia(ex?.media);
}

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

const MUSCLE_KWS: Record<Exclude<MuscleKey, "all">, string[]> = {
  chest: ["chest", "pec", "pector", "bench", "fly", "flye", "chest press", "pec deck"],
  back: ["back", "row", "rows", "lat", "lats", "pulldown", "pull down", "pullup", "pull up", "chinup", "chin up", "face pull"],
  shoulders: ["shoulder", "shoulders", "delt", "deltoid", "lateral raise", "side raise", "rear delt", "overhead press", "military press", "arnold press", "upright row"],
  arms: ["bicep", "biceps", "tricep", "triceps", "forearm", "curl", "curls", "hammer curl", "preacher", "pushdown", "push down", "skullcrusher", "skull crusher", "extension", "extensions", "dip", "dips"],
  abs: ["abs", "abdominal", "abdominals", "core", "plank", "crunch", "crunches", "sit up", "situp", "hollow", "leg raise", "hanging raise", "pallof", "woodchop", "wood chop", "russian twist"],
  legs: ["leg", "legs", "squat", "squats", "lunge", "lunges", "deadlift", "deadlifts", "rdl", "hip thrust", "glute bridge", "hamstring", "leg curl", "split squat", "step up"],
  quads: ["quad", "quads", "quadricep", "quadriceps", "leg extension", "front squat", "sissy squat"],
  calves: ["calf", "calves", "soleus", "gastro", "gastrocnemius", "calf raise"],
};

function tagMatchesMuscle(tags: string[], key: Exclude<MuscleKey, "all">): boolean {
  const t = new Set(tags);

  if (key === "abs") return t.has("core") || t.has("abs") || t.has("abdominals") || t.has("obliques");
  if (key === "arms") return t.has("biceps") || t.has("triceps") || t.has("forearms") || t.has("arms");
  if (key === "shoulders") return t.has("shoulders") || t.has("delts") || t.has("deltoids");
  if (key === "chest") return t.has("chest") || t.has("pectorals") || t.has("pecs");
  if (key === "back") return t.has("back") || t.has("lats") || t.has("middle back") || t.has("upper back") || t.has("lower back") || t.has("traps");
  if (key === "legs") return t.has("legs") || t.has("glutes") || t.has("hamstrings") || t.has("quads") || t.has("quadriceps") || t.has("calves") || t.has("adductors") || t.has("abductors");
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
  if (tags.length && tagMatchesMuscle(tags, key)) return true;

  return false;
}

function tagMatchesDetail(tags: string[], detail: Exclude<MuscleDetailKey, "all">): boolean {
  const t = new Set(tags);
  const aliases: Record<Exclude<MuscleDetailKey, "all">, string[]> = {
    biceps: ["biceps", "bicep"],
    triceps: ["triceps", "tricep"],
    forearms: ["forearms", "forearm"],
    lats: ["lats", "latissimus dorsi"],
    middle_back: ["middle back", "upper back", "rhomboids"],
    lower_back: ["lower back", "erector spinae"],
    traps: ["traps", "trapezius"],
    front_delts: ["front delts", "anterior deltoids"],
    side_delts: ["side delts", "lateral deltoids"],
    rear_delts: ["rear delts", "posterior deltoids"],
    quadriceps: ["quadriceps", "quads"],
    hamstrings: ["hamstrings"],
    glutes: ["glutes", "gluteus maximus"],
    calves: ["calves", "gastrocnemius", "soleus"],
    adductors: ["adductors"],
    abductors: ["abductors"],
    abdominals: ["abdominals", "abs", "core"],
    obliques: ["obliques"],
  };

  return aliases[detail].some((tag) => t.has(tag));
}

const DETAIL_NAME_KWS: Partial<Record<Exclude<MuscleDetailKey, "all">, string[]>> = {
  biceps: ["bicep", "curl", "preacher", "hammer curl"],
  triceps: ["tricep", "pushdown", "skull crusher", "skullcrusher", "triceps extension", "close grip press", "dip"],
  forearms: ["forearm", "wrist curl", "reverse curl", "farmer", "grip"],
  lats: ["lat pulldown", "pulldown", "pull up", "pullup", "chin up", "chinup", "straight arm pulldown"],
  middle_back: ["row", "middle back", "upper back", "rhomboid"],
  lower_back: ["lower back", "back extension", "hyperextension", "good morning"],
  traps: ["shrug", "trap raise", "trapezius"],
  front_delts: ["front raise", "anterior delt", "shoulder press", "overhead press", "military press", "arnold press"],
  side_delts: ["lateral raise", "side raise", "middle delt"],
  rear_delts: ["rear delt", "reverse fly", "reverse pec deck", "face pull"],
  quadriceps: ["quad", "leg extension", "front squat", "sissy squat"],
  hamstrings: ["hamstring", "leg curl", "romanian deadlift", "rdl"],
  glutes: ["glute", "hip thrust", "glute bridge"],
  calves: ["calf", "calves", "soleus"],
  adductors: ["adductor", "groin"],
  abductors: ["abductor", "hip abduction"],
  abdominals: ["abdominal", "abs", "crunch", "sit up", "plank", "leg raise"],
  obliques: ["oblique", "russian twist", "side plank", "wood chop", "woodchop"],
};

export function matchMuscleDetail(ex: any, detail: MuscleDetailKey): boolean {
  if (!detail || detail === "all") return true;

  const primaryTags = normalizeArr(ex?.primary_muscles);
  if (primaryTags.length && tagMatchesDetail(primaryTags, detail)) return true;

  const n = nameOf(ex);
  const kws = DETAIL_NAME_KWS[detail] ?? [];

  // Shoulder-head data is normally stored broadly as "shoulders", so the
  // exercise name is the reliable discriminator for front/side/rear delts.
  if (detail === "front_delts" || detail === "side_delts" || detail === "rear_delts") {
    return hasAny(n, kws);
  }

  // Use name fallback only when the database does not already provide a
  // specific primary-muscle tag.
  return !primaryTags.length && hasAny(n, kws);
}

export function matchFilters(
  ex: any,
  muscle: MuscleKey,
  equip: EquipKey,
  detail: MuscleDetailKey = "all"
): boolean {
  if (equip === "cardio") return isCardio(ex);

  let broadMatch = true;

  if (equip === "machine") {
    if (isCardio(ex)) return false;
    broadMatch = equipClass(ex) === "machine" && matchMuscle(ex, muscle);
  } else if (equip === "free_weight") {
    if (isCardio(ex)) return false;
    broadMatch = equipClass(ex) === "free_weight" && matchMuscle(ex, muscle);
  } else if (equip === "all") {
    if (muscle === "all") broadMatch = true;
    else if (isCardio(ex)) return false;
    else broadMatch = matchMuscle(ex, muscle);
  }

  if (!broadMatch) return false;
  if (muscle === "all") return true;
  return matchMuscleDetail(ex, detail);
}

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
