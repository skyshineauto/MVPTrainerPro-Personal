import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const FILE = path.join(ROOT, "src", "features", "today", "TodayPage.tsx");
const VERSION = "v4-5-3-active-workout-direct-return";
const MARKER = "MVP_TRAINER_V4_5_3_ACTIVE_WORKOUT_DIRECT_RETURN";

function stop(message) {
  console.error("");
  console.error(`MVP Trainer V4.5.3 stopped: ${message}`);
  console.error("No source files were written.");
  process.exit(1);
}

if (!fs.existsSync(FILE)) {
  stop("src/features/today/TodayPage.tsx was not found. Run this from the repo root.");
}

const original = fs.readFileSync(FILE, "utf8");
let updated = original;

if (updated.includes(MARKER)) {
  console.log("MVP Trainer V4.5.3 Active Workout Direct Return is already installed.");
  process.exit(0);
}

if (!updated.includes("function navigateWithinToday(to: string)")) {
  stop("R4 navigation helper was not found. Make sure the working R4 update is installed first.");
}

if (!updated.includes("const [workoutPaused, setWorkoutPaused]")) {
  stop("R4 workoutPaused state was not found. Make sure the working R4 update is installed first.");
}

if (!updated.includes("activeSessionId")) {
  stop("TodayPage activeSessionId state was not found.");
}

// Insert a redirect effect after the R4 pause sync effect and before the goal line.
// We use a stable, already-present R4 anchor.
const anchor = `  const goal = queue?.activeBlock?.goal ? String(queue.activeBlock.goal) : null;`;

if (!updated.includes(anchor)) {
  stop("TodayPage goal anchor was not found.");
}

const addition = `  /* ${MARKER}
   * Workouts is a dashboard only when there is no actively running session.
   * If a session is active and NOT manually paused, landing on Workouts should
   * immediately return the user to the live WorkoutPlayer with no extra button.
   */
  useEffect(() => {
    if (!activeSessionId) return;
    if (workoutPaused) return;
    if (window.location.pathname !== "/") return;

    navigateWithinToday(\`/workout/\${activeSessionId}\`);
  }, [activeSessionId, workoutPaused]);

`;

updated = updated.replace(anchor, addition + anchor);

if (!updated.includes(MARKER)) {
  stop("V4.5.3 marker was not inserted.");
}

if (!updated.includes('if (workoutPaused) return;')) {
  stop("paused-workout protection is missing.");
}

if (!updated.includes('navigateWithinToday(`/workout/${activeSessionId}`);')) {
  stop("direct active workout return was not inserted.");
}

const backup = `${FILE}.pre-${VERSION}.bak`;
fs.copyFileSync(FILE, backup);
fs.writeFileSync(FILE, updated, "utf8");

console.log("");
console.log("MVP Trainer V4.5.3 Active Workout Direct Return applied successfully.");
console.log(`(${VERSION})`);
console.log("");
console.log("NEW BEHAVIOR:");
console.log("  ✓ Active + running workout -> Workouts tab returns directly to WorkoutPlayer.");
console.log("  ✓ No Return/Resume card is shown for a running workout.");
console.log("  ✓ Active + manually paused workout -> Workouts page remains visible.");
console.log("  ✓ RESUME WORKOUT is still available only for a truly paused workout.");
console.log("  ✓ No active workout -> normal Workouts dashboard.");
console.log("");
console.log(`Backup: src/features/today/TodayPage.tsx.pre-${VERSION}.bak`);
console.log("NEXT: npm run build");
