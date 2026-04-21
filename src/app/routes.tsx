import React from "react";

import { LoginPage } from "../features/auth/LoginPage";
import { ForgotPasswordPage } from "../features/auth/ForgotPasswordPage";
import { ResetPasswordPage } from "../features/auth/ResetPasswordPage";
import { TodayPage } from "../features/today/TodayPage";
import { WorkoutPlayerPage } from "../features/workout/WorkoutPlayerPage";
import { LibraryPage } from "../features/library/LibraryPage";
import { ExerciseDetailPage } from "../features/library/ExerciseDetailPage";
import { ProgressPage } from "../features/progress/ProgressPage";
import { CoachPage } from "../features/coach/CoachPage";

export type Route = { path: string; el: React.ReactNode };

export const routes: Route[] = [
  { path: "/login", el: <LoginPage /> },
  { path: "/forgot-password", el: <ForgotPasswordPage /> },
  { path: "/reset-password", el: <ResetPasswordPage /> },

  { path: "/", el: <TodayPage /> },
  { path: "/workout/:sessionId", el: <WorkoutPlayerPage /> },
  { path: "/library", el: <LibraryPage /> },
  { path: "/library/:exerciseId", el: <ExerciseDetailPage /> },
  { path: "/progress", el: <ProgressPage /> },
  { path: "/coach", el: <CoachPage /> },
];