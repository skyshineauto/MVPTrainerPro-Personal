import type { ReactElement } from "react";

import { LoginPage } from "../features/auth/LoginPage";
import { ForgotPasswordPage } from "../features/auth/ForgotPasswordPage";
import { ResetPasswordPage } from "../features/auth/ResetPasswordPage";
import { TodayPage } from "../features/today/TodayPage";
import { WorkoutPlayerPage } from "../features/workout/WorkoutPlayerPage";
import { LibraryPage } from "../features/library/LibraryPage";
import { ExerciseDetailPage } from "../features/library/ExerciseDetailPage";
import { ProgressPage } from "../features/progress/ProgressPage";
import { CoachPage } from "../features/coach/CoachPage";
import { SoundAlertsPage } from "../features/settings/SoundAlertsPage";
import { MusicPage } from "../features/music/MusicPage";

export type Route = { path: string; el: ReactElement };

/* MVP_STUDIO_V4_5_1_NAVIGATION_CONTINUITY
 * Route wrappers must stay inside the existing React app instance.
 * A full location assignment destroys the singleton HTMLAudioElement / Web Audio graph.
 * pushState + popstate lets App.tsx update its existing route state without reloading.
 */
const goTo = (to: string) => {
  const next = to.length > 1 && to.endsWith("/") ? to.slice(0, -1) : to;
  if (window.location.pathname === next) return;
  window.history.pushState({}, "", next);
  window.dispatchEvent(new Event("popstate"));
};

function LoginPageRoute() {
  return <LoginPage navigate={goTo} />;
}

function LibraryPageRoute() {
  return <LibraryPage navigate={goTo} />;
}

function CoachPageRoute() {
  return <CoachPage navigate={goTo} />;
}

export const routes: Route[] = [
  { path: "/login", el: <LoginPageRoute /> },
  { path: "/forgot-password", el: <ForgotPasswordPage /> },
  { path: "/reset-password", el: <ResetPasswordPage /> },

  { path: "/", el: <TodayPage /> },
  { path: "/workout/:sessionId", el: <WorkoutPlayerPage /> },
  { path: "/library", el: <LibraryPageRoute /> },
  { path: "/library/:exerciseId", el: <ExerciseDetailPage /> },
  { path: "/progress", el: <ProgressPage /> },
  { path: "/sound-alerts", el: <SoundAlertsPage /> },
  { path: "/music", el: <MusicPage /> },
  { path: "/coach", el: <CoachPageRoute /> },
];
