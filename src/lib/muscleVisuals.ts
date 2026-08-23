export type MuscleVisualKey =
  | "chest"
  | "upper-chest"
  | "back"
  | "lats"
  | "traps"
  | "lower-back"
  | "shoulders"
  | "rear-delts"
  | "biceps"
  | "triceps"
  | "forearms"
  | "abs-core"
  | "glutes"
  | "quads"
  | "hamstrings"
  | "calves"
  | "adductors"
  | "abductors"
  | "legs"
  | "full-body";

export type MuscleVisual = {
  key: MuscleVisualKey;
  label: string;
  src: string;
};

const VISUALS: Record<MuscleVisualKey, MuscleVisual> = {
  chest: { key: "chest", label: "Chest", src: "/muscle-visuals/chest.webp" },
  "upper-chest": { key: "upper-chest", label: "Upper Chest", src: "/muscle-visuals/upper-chest.webp" },
  back: { key: "back", label: "Back", src: "/muscle-visuals/back.webp" },
  lats: { key: "lats", label: "Lats", src: "/muscle-visuals/lats.webp" },
  traps: { key: "traps", label: "Traps", src: "/muscle-visuals/traps.webp" },
  "lower-back": { key: "lower-back", label: "Lower Back", src: "/muscle-visuals/lower-back.webp" },
  shoulders: { key: "shoulders", label: "Shoulders", src: "/muscle-visuals/shoulders.webp" },
  "rear-delts": { key: "rear-delts", label: "Rear Delts", src: "/muscle-visuals/rear-delts.webp" },
  biceps: { key: "biceps", label: "Biceps", src: "/muscle-visuals/biceps.webp" },
  triceps: { key: "triceps", label: "Triceps", src: "/muscle-visuals/triceps.webp" },
  forearms: { key: "forearms", label: "Forearms", src: "/muscle-visuals/forearms.webp" },
  "abs-core": { key: "abs-core", label: "Abs / Core", src: "/muscle-visuals/abs-core.webp" },
  glutes: { key: "glutes", label: "Glutes", src: "/muscle-visuals/glutes.webp" },
  quads: { key: "quads", label: "Quads", src: "/muscle-visuals/quads.webp" },
  hamstrings: { key: "hamstrings", label: "Hamstrings", src: "/muscle-visuals/hamstrings.webp" },
  calves: { key: "calves", label: "Calves", src: "/muscle-visuals/calves.webp" },
  adductors: { key: "adductors", label: "Adductors", src: "/muscle-visuals/adductors.webp" },
  abductors: { key: "abductors", label: "Abductors", src: "/muscle-visuals/abductors.webp" },
  legs: { key: "legs", label: "Legs", src: "/muscle-visuals/legs.webp" },
  "full-body": { key: "full-body", label: "Full Body", src: "/muscle-visuals/full-body.webp" },
};

function normalize(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[_/\\-]+/g, " ")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function list(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values.map(normalize).filter(Boolean);
}

function hasAny(text: string, needles: string[]) {
  return needles.some((needle) => text.includes(needle));
}

function tagsHave(tags: string[], aliases: string[]) {
  return tags.some((tag) => aliases.some((alias) => tag === alias || tag.includes(alias)));
}

export function resolveMuscleVisual(exercise: any): MuscleVisual {
  const name = normalize(exercise?.name ?? exercise?.title);
  const primary = list(exercise?.primary_muscles ?? exercise?.primaryMuscles);
  const secondary = list(exercise?.secondary_muscles ?? exercise?.secondaryMuscles);
  // Exercise-name precision comes first where the database commonly stores a broad parent group.
  if (
    hasAny(name, ["upper chest", "clavicular", "incline press", "incline bench", "incline fly", "incline chest"]) ||
    (name.includes("incline") && tagsHave(primary, ["chest", "pectorals", "pectoralis"]))
  ) return VISUALS["upper-chest"];
  if (hasAny(name, ["rear delt", "reverse fly", "reverse pec deck", "face pull", "posterior delt"])) return VISUALS["rear-delts"];
  if (hasAny(name, ["lat pulldown", "pulldown", "pull up", "pullup", "chin up", "chinup", "straight arm pulldown"])) return VISUALS.lats;
  if (hasAny(name, ["shrug", "trap raise", "trapezius"])) return VISUALS.traps;
  if (hasAny(name, ["back extension", "hyperextension", "good morning", "lower back"])) return VISUALS["lower-back"];
  if (hasAny(name, ["hip adduction", "adductor", "groin machine"])) return VISUALS.adductors;
  if (hasAny(name, ["hip abduction", "abductor"])) return VISUALS.abductors;
  if (hasAny(name, ["leg extension", "sissy squat"])) return VISUALS.quads;
  if (hasAny(name, ["leg curl", "hamstring curl", "romanian deadlift", "rdl", "nordic curl"])) return VISUALS.hamstrings;
  if (hasAny(name, ["hip thrust", "glute bridge", "glute kickback"])) return VISUALS.glutes;
  if (hasAny(name, ["calf raise", "calves", "soleus"])) return VISUALS.calves;
  if (hasAny(name, ["bicep", "preacher", "hammer curl", "incline curl", "concentration curl"])) return VISUALS.biceps;
  if (hasAny(name, ["tricep", "pushdown", "skull crusher", "skullcrusher", "close grip press"])) return VISUALS.triceps;
  if (hasAny(name, ["forearm", "wrist curl", "reverse curl", "grip", "farmer carry", "farmers carry"])) return VISUALS.forearms;

  // Specific database muscle tags override broad groups.
  if (tagsHave(primary, ["upper chest", "clavicular chest", "clavicular pectoralis"])) return VISUALS["upper-chest"];
  if (tagsHave(primary, ["lats", "latissimus", "latissimus dorsi"])) return VISUALS.lats;
  if (tagsHave(primary, ["traps", "trapezius"])) return VISUALS.traps;
  if (tagsHave(primary, ["lower back", "erector spinae", "lumbar"])) return VISUALS["lower-back"];
  if (tagsHave(primary, ["rear delts", "posterior deltoids", "posterior deltoid"])) return VISUALS["rear-delts"];
  if (tagsHave(primary, ["biceps", "bicep"])) return VISUALS.biceps;
  if (tagsHave(primary, ["triceps", "tricep"])) return VISUALS.triceps;
  if (tagsHave(primary, ["forearms", "forearm", "brachioradialis"])) return VISUALS.forearms;
  if (tagsHave(primary, ["quadriceps", "quads", "quad"])) return VISUALS.quads;
  if (tagsHave(primary, ["hamstrings", "hamstring"])) return VISUALS.hamstrings;
  if (tagsHave(primary, ["glutes", "glute", "gluteus maximus"])) return VISUALS.glutes;
  if (tagsHave(primary, ["calves", "calf", "gastrocnemius", "soleus"])) return VISUALS.calves;
  if (tagsHave(primary, ["adductors", "adductor"])) return VISUALS.adductors;
  if (tagsHave(primary, ["abductors", "abductor"])) return VISUALS.abductors;
  if (tagsHave(primary, ["abdominals", "abdominal", "abs", "core", "obliques", "oblique"])) return VISUALS["abs-core"];

  // Broad parent groups are the fallback when no specific tag exists.
  if (tagsHave(primary, ["chest", "pectorals", "pectoralis"])) return VISUALS.chest;
  if (tagsHave(primary, ["back", "middle back", "upper back", "rhomboids"])) return VISUALS.back;
  if (tagsHave(primary, ["shoulders", "shoulder", "deltoids", "deltoid", "front delts", "side delts"])) return VISUALS.shoulders;
  if (tagsHave(primary, ["arms", "arm"])) {
    if (hasAny(name, ["curl"])) return VISUALS.biceps;
    if (hasAny(name, ["extension", "pressdown", "pushdown", "dip"])) return VISUALS.triceps;
    return VISUALS.biceps;
  }
  if (tagsHave(primary, ["abs", "core"])) return VISUALS["abs-core"];
  if (tagsHave(primary, ["legs", "leg", "lower body"])) return VISUALS.legs;

  // Name-based broad fallbacks cover older/custom exercises with incomplete tags.
  if (hasAny(name, ["chest", "bench press", "pec deck", "fly"])) return VISUALS.chest;
  if (hasAny(name, ["row", "back"])) return VISUALS.back;
  if (hasAny(name, ["shoulder", "overhead press", "military press", "lateral raise", "front raise"])) return VISUALS.shoulders;
  if (hasAny(name, ["crunch", "sit up", "situp", "plank", "ab wheel", "leg raise", "oblique", "wood chop", "russian twist"])) return VISUALS["abs-core"];
  if (hasAny(name, ["squat", "leg press", "lunge", "step up", "hack squat"])) return VISUALS.legs;
  if (hasAny(name, ["deadlift", "clean", "snatch", "burpee", "thruster", "sled", "battle rope"])) return VISUALS["full-body"];

  // Secondary tags are only consulted after all primary/name matches.
  if (tagsHave(secondary, ["quadriceps", "quads"])) return VISUALS.quads;
  if (tagsHave(secondary, ["hamstrings"])) return VISUALS.hamstrings;
  if (tagsHave(secondary, ["glutes"])) return VISUALS.glutes;
  if (tagsHave(secondary, ["chest"])) return VISUALS.chest;
  if (tagsHave(secondary, ["back", "lats"])) return VISUALS.back;

  return VISUALS["full-body"];
}
