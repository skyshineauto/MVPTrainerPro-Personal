import { supabase } from "./supabase";

export type TrainingEmailPreferences = {
  user_id: string;
  program_block_id: string | null;
  enabled: boolean;
  workout_ready: boolean;
  include_coach_tip: boolean;
  include_exercise_plan: boolean;
  include_progress_snapshot: boolean;
  reminder_enabled: boolean;
  reminder_hours: number;
  reminder_max: number;
  email_override: string | null;
  timezone: string;
};

export type TrainingEmailInvokeResult = {
  ok?: boolean;
  sent?: boolean;
  skipped?: boolean;
  reason?: string;
  subject?: string;
  session_id?: string;
};

export async function requestTrainingReadyEmail(reason = "app_sync") {
  try {
    const { data, error } = await supabase.functions.invoke<TrainingEmailInvokeResult>("training-coach-email", {
      body: { action: "ready", reason },
    });
    if (error) {
      console.warn("Training email coach ready alert failed:", error.message);
      return null;
    }
    return data ?? null;
  } catch (error) {
    console.warn("Training email coach ready alert failed:", error);
    return null;
  }
}

export async function sendTrainingEmailTest() {
  const { data, error } = await supabase.functions.invoke<TrainingEmailInvokeResult>("training-coach-email", {
    body: { action: "test", reason: "coach_test" },
  });
  if (error) throw error;
  return data ?? null;
}
