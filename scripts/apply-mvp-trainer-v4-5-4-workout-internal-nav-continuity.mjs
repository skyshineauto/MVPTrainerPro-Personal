import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const FILE = path.join(ROOT, "src", "features", "workout", "WorkoutPlayerPage.tsx");
const VERSION = "v4-5-4-workout-internal-nav-continuity";
const MARKER = "MVP_TRAINER_V4_5_4_WORKOUT_INTERNAL_NAV_CONTINUITY";

function stop(message) {
  console.error("");
  console.error(`MVP Trainer V4.5.4 stopped: ${message}`);
  console.error("No source files were written.");
  process.exit(1);
}

if (!fs.existsSync(FILE)) {
  stop("src/features/workout/WorkoutPlayerPage.tsx was not found. Run this from the repo root.");
}

const original = fs.readFileSync(FILE, "utf8");
let updated = original;

if (updated.includes(MARKER)) {
  console.log("MVP Trainer V4.5.4 Workout Internal Navigation Continuity is already installed.");
  process.exit(0);
}

if (!updated.includes("function navigateWithinWorkoutPlayer(to: string)")) {
  const anchor = "function MediaOrFallback(";
  const index = updated.indexOf(anchor);

  if (index < 0) {
    stop("MediaOrFallback() was not found.");
  }

  const helper = `/* ${MARKER}
 * Internal workout navigation must stay inside the running React app.
 * Full window.location navigation tears down the live music/Web Audio runtime.
 */
function navigateWithinWorkoutPlayer(to: string) {
  const next = to.length > 1 && to.endsWith("/") ? to.slice(0, -1) : to;

  if (window.location.pathname === next) return;

  window.history.pushState({}, "", next);
  window.dispatchEvent(new Event("popstate"));
}

`;

  updated = updated.slice(0, index) + helper + updated.slice(index);
}

// Exercise Media / Upload.
updated = updated.replace(
  /window\.location\.pathname\s*=\s*`\/library\/\$\{exId\}`;/g,
  'navigateWithinWorkoutPlayer(`/library/${exId}`);'
);

// Back / Cancel to Workouts.
updated = updated.replace(
  /\(\s*window\.location\.pathname\s*=\s*"\/"\s*\)/g,
  'navigateWithinWorkoutPlayer("/")'
);
updated = updated.replace(
  /window\.location\.pathname\s*=\s*"\/";/g,
  'navigateWithinWorkoutPlayer("/");'
);

// View Full Exercise History.
updated = updated.replace(
  /\(\s*window\.location\.pathname\s*=\s*`\/library\/\$\{exerciseId\}`\s*\)/g,
  'navigateWithinWorkoutPlayer(`/library/${exerciseId}`)'
);
updated = updated.replace(
  /window\.location\.pathname\s*=\s*`\/library\/\$\{exerciseId\}`;/g,
  'navigateWithinWorkoutPlayer(`/library/${exerciseId}`);'
);

// Validation.
if (!updated.includes(MARKER)) {
  stop("navigation helper marker was not inserted.");
}

if (!updated.includes('navigateWithinWorkoutPlayer(`/library/${exId}`);')) {
  stop("Media/Upload navigation was not converted.");
}

if (!updated.includes("window.history.pushState")) {
  stop("SPA pushState navigation helper is missing.");
}

if (!updated.includes('window.dispatchEvent(new Event("popstate"))')) {
  stop("SPA route notification is missing.");
}

// Match assignment "=" but NOT equality "==" / "===".
const remainingAssignments =
  updated.match(/window\.location\.pathname\s*=(?!=)/g) ?? [];

if (remainingAssignments.length > 0) {
  stop(
    `${remainingAssignments.length} full-page window.location.pathname assignment(s) still remain. ` +
    "Send the result and I will match the local source before any file is changed."
  );
}

if (updated === original) {
  stop("No changes were necessary.");
}

const backup = `${FILE}.pre-${VERSION}.bak`;
fs.copyFileSync(FILE, backup);
fs.writeFileSync(FILE, updated, "utf8");

console.log("");
console.log("MVP Trainer V4.5.4 Workout Internal Navigation Continuity applied successfully.");
console.log(`(${VERSION})`);
console.log("");
console.log("FIXED:");
console.log("  ✓ Exercise Media / Upload no longer reloads the browser.");
console.log("  ✓ Music remains live when opening exercise media management.");
console.log("  ✓ View Full Exercise History no longer reloads the browser.");
console.log("  ✓ WorkoutPlayer Back/Cancel internal navigation no longer reloads the browser.");
console.log("  ✓ Workout + music remain in the same running React app instance.");
console.log("");
console.log(`Backup: src/features/workout/WorkoutPlayerPage.tsx.pre-${VERSION}.bak`);
console.log("NEXT: npm run build");
