import { supabase } from "./supabase";

export type ExerciseNameRow = {
  id: string;
  name?: string | null;
  canonical_name?: string | null;
  source?: string | null;
  [key: string]: any;
};

export function isUserCreatedExercise(row: ExerciseNameRow | null | undefined) {
  const source = String(row?.source || "").toLowerCase();
  return /custom|user|manual|created/.test(source);
}

export async function applyExerciseNameOverrides<T extends ExerciseNameRow>(rows: T[]): Promise<T[]> {
  if (!rows.length) return rows;
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return rows;

  const ids = Array.from(new Set(rows.map((row) => row.id).filter(Boolean)));
  if (!ids.length) return rows;

  const { data, error } = await supabase
    .from("exercise_name_overrides")
    .select("exercise_id,display_name")
    .eq("user_id", auth.user.id)
    .in("exercise_id", ids);

  if (error) {
    // Keep the app usable before the r77 migration is installed.
    if (/does not exist|relation/i.test(error.message || "")) return rows;
    throw error;
  }

  const names = new Map<string, string>();
  for (const item of data || []) {
    const id = String((item as any).exercise_id || "");
    const name = String((item as any).display_name || "").trim();
    if (id && name) names.set(id, name);
  }

  return rows.map((row) => {
    const canonicalName = String(row.canonical_name || row.name || "").trim();
    return {
      ...row,
      canonical_name: canonicalName,
      name: names.get(row.id) || canonicalName,
    };
  });
}

export async function saveExerciseNameOverride(exerciseId: string, displayName: string) {
  const clean = displayName.trim().replace(/\s+/g, " ");
  if (clean.length < 2) throw new Error("Enter an exercise name.");
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!auth.user) throw new Error("Sign in first.");

  const { error } = await supabase
    .from("exercise_name_overrides")
    .upsert({
      user_id: auth.user.id,
      exercise_id: exerciseId,
      display_name: clean,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,exercise_id" });
  if (error) throw error;

  window.dispatchEvent(new CustomEvent("mvp:exercise-name-changed", {
    detail: { exerciseId, displayName: clean },
  }));
  return clean;
}
