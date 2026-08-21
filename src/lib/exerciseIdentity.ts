// Shared movement identity for progression/history views.
// Database UUIDs identify rows. This key identifies the actual movement when a row is recreated.

export type CanonicalExerciseDescriptor = {
  id?: string | null;
  name?: string | null;
  primary_muscles?: string[] | null;
  equipment?: string[] | null;
};

function normalizeIdentityText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizedMuscles(input: CanonicalExerciseDescriptor) {
  return new Set(
    (Array.isArray(input.primary_muscles) ? input.primary_muscles : [])
      .map(normalizeIdentityText)
      .filter(Boolean),
  );
}

export function canonicalExerciseKey(input: CanonicalExerciseDescriptor) {
  const name = normalizeIdentityText(input.name);
  return name ? `movement:${name}` : input.id ? `exercise:${String(input.id)}` : "exercise:unknown";
}

export function sameCanonicalExercise(
  left: CanonicalExerciseDescriptor,
  right: CanonicalExerciseDescriptor,
) {
  const leftName = normalizeIdentityText(left.name);
  const rightName = normalizeIdentityText(right.name);
  if (!leftName || !rightName || leftName !== rightName) return false;

  // Exact normalized names are the primary identity. If both records have muscle
  // metadata, require at least one shared primary muscle as a guard against bad duplicates.
  const leftMuscles = normalizedMuscles(left);
  const rightMuscles = normalizedMuscles(right);
  if (leftMuscles.size && rightMuscles.size) {
    const overlaps = [...leftMuscles].some((muscle) => rightMuscles.has(muscle));
    if (!overlaps) return false;
  }
  return true;
}
