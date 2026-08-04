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

export type Route = { path: string; el: ReactElement };

const goTo = (to: string) => {
  window.location.pathname = to;
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
  { path: "/coach", el: <CoachPageRoute /> },
];
