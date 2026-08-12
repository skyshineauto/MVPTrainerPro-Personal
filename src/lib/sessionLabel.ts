// src/lib/sessionLabel.ts

export type SymptomKey =
  | "posture"
  | "shoulder_pain"
  | "back_pain"
  | "knee_pain"
  | "elbow_wrist";

export function friendlyBaseName(sessionType: string | null | undefined) {
  const s = String(sessionType || "").trim();

  if (s === "Upper 1") return "Upper 1";
  if (s === "Upper 2") return "Upper 2";
  if (s === "Lower 1") return "Lower 1";
  if (s === "Lower 2") return "Lower 2";

  return s || "Session";
}

export function goalTagLabel(goal: string | null | undefined) {
  const g = String(goal || "").toLowerCase();

  if (!g) return "—";
  if (g === "build_muscle" || g === "bulk" || g === "muscle_gain") {
    return "Muscle Gain";
  }
  if (g === "lose_weight" || g === "cut") return "Cut";
  if (g === "strength") return "Strength";
  if (g === "fitness") return "Fitness";

  return g
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

export function symptomTagLabel(k: SymptomKey) {
  if (k === "posture") return "Posture";
  if (k === "shoulder_pain") return "Shoulder Pain";
  if (k === "back_pain") return "Back Pain";
  if (k === "knee_pain") return "Knee Pain";
  if (k === "elbow_wrist") return "Elbow/Wrist";
  return "Symptom";
}

/**
 * Infer single symptom key from intake_snapshot.symptoms jsonb.
 * Only one symptom is expected to be active.
 */
export function inferSymptomKey(symptoms: any): SymptomKey | null {
  const s = symptoms && typeof symptoms === "object" ? symptoms : {};

  const posture =
    !!s.posture ||
    !!s.forward_head ||
    !!s.rounded_shoulders;

  if (posture) return "posture";
  if (s.shoulder_pain) return "shoulder_pain";
  if (s.elbow_wrist) return "elbow_wrist";
  if (s.back_pain) return "back_pain";
  if (s.knee_pain) return "knee_pain";

  return null;
}

export function isSymptomMode(goalMode: string | null | undefined) {
  return String(goalMode || "")
    .toLowerCase()
    .includes("symptom");
}

export function formatSessionLabel(params: {
  sessionType: string | null | undefined;
  goal: string | null | undefined;
  goalMode: string | null | undefined;
  symptomKey?: SymptomKey | null;
}) {
  const base = friendlyBaseName(params.sessionType);

  if (isSymptomMode(params.goalMode)) {
    const sk = params.symptomKey ?? null;
    const tag = sk ? symptomTagLabel(sk) : "Symptom";
    return `${base} • ${tag}`;
  }

  return `${base} • ${goalTagLabel(params.goal)}`;
}
