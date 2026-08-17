import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MARKER = "MVP_TRAINER_V4_5_2_TRUE_PAUSE_CONTINUITY_R2";

const FILES = {
  routes: path.join(ROOT, "src", "app", "routes.tsx"),
  today: path.join(ROOT, "src", "features", "today", "TodayPage.tsx"),
  shell: path.join(ROOT, "src", "app", "layout", "AppShell.tsx"),
  workout: path.join(ROOT, "src", "features", "workout", "WorkoutPlayerPage.tsx"),
  music: path.join(ROOT, "src", "lib", "musicPlayer.ts"),
};

function stop(message) {
  console.error("");
  console.error(`MVP Trainer V4.5.2 R2 stopped: ${message}`);
  console.error("No source files were written.");
  process.exit(1);
}

for (const [name, file] of Object.entries(FILES)) {
  if (!fs.existsSync(file)) stop(`${name} not found: ${path.relative(ROOT, file)}`);
}

const original = Object.fromEntries(
  Object.entries(FILES).map(([name, file]) => [name, fs.readFileSync(file, "utf8")])
);

let routes = original.routes;
let today = original.today;
let shell = original.shell;
let workout = original.workout;
let music = original.music;

function replaceOne(text, regex, replacement, label, allowAlready = false, alreadyTest = null) {
  if (allowAlready && alreadyTest && alreadyTest(text)) return text;
  const matches = [...text.matchAll(new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g"))];
  if (matches.length !== 1) stop(`${label}: expected 1 match, found ${matches.length}.`);
  return text.replace(regex, replacement);
}

function requireText(text, needle, label) {
  if (!text.includes(needle)) stop(`${label}: required source anchor was not found.`);
}

// -----------------------------------------------------------------------------
// MUSIC: export a lightweight "was music actually playing?" query.
// Tolerant of whitespace/comments around pauseMusic().
// -----------------------------------------------------------------------------
if (!/\bexport\s+function\s+isMusicPlaying\s*\(/.test(music)) {
  const pauseDecl = /export\s+function\s+pauseMusic\s*\(\s*\)\s*\{/m;
  if (!pauseDecl.test(music)) stop("music playback state export: pauseMusic() was not found.");

  music = music.replace(
    pauseDecl,
`/* ${MARKER}
 * Workout pause/resume checks the live transport without subscribing AppShell
 * to high-frequency player updates.
 */
export function isMusicPlaying() {
  const audio = audioElement;
  return Boolean(
    state.playing ||
    (audio && !audio.paused && !audio.ended && Boolean(audio.src))
  );
}

export function pauseMusic() {`
  );
}

// -----------------------------------------------------------------------------
// APPSHELL: ONLY the actual Pause Workout button creates pause state.
// Pause music with it, and resume music only if it was playing before pause.
// -----------------------------------------------------------------------------
if (!shell.includes(`from "../../lib/musicPlayer";`)) {
  requireText(shell, `import { MusicMiniPlayer } from "../../features/music/MusicMiniPlayer";`, "AppShell MusicMiniPlayer import");
  shell = shell.replace(
    `import { MusicMiniPlayer } from "../../features/music/MusicMiniPlayer";`,
    `import { MusicMiniPlayer } from "../../features/music/MusicMiniPlayer";
import { isMusicPlaying, pauseMusic, playMusic } from "../../lib/musicPlayer";`
  );
} else if (!shell.includes("isMusicPlaying")) {
  stop("AppShell already imports musicPlayer in an unexpected format. Send the build/source error before retrying.");
}

if (!shell.includes('musicWasPlayingOnPause: "mvp_music_was_playing_on_workout_pause"')) {
  shell = replaceOne(
    shell,
    /(\s*activeExercisePos:\s*"mvp_active_exercise_pos",\s*\n)(\s*};)/m,
    `$1  musicWasPlayingOnPause: "mvp_music_was_playing_on_workout_pause",\n$2`,
    "AppShell music pause storage key"
  );
}

if (!shell.includes('const WORKOUT_PAUSE_STATE_EVENT = "mvp:workout-pause-state";')) {
  shell = replaceOne(
    shell,
    /const\s+END_WORKOUT_REQUEST_EVENT\s*=\s*"mvp:end-workout-request";/m,
    `const END_WORKOUT_REQUEST_EVENT = "mvp:end-workout-request";
const WORKOUT_PAUSE_STATE_EVENT = "mvp:workout-pause-state";`,
    "AppShell pause event"
  );
}

if (!shell.includes(`/* ${MARKER} */`)) {
  const handlerRx = /  const onTogglePause = async \(\) => \{[\s\S]*?\n  \};\n\n  async function startSession/m;

  if (!handlerRx.test(shell)) stop("AppShell onTogglePause handler was not found.");

  shell = shell.replace(
    handlerRx,
`  /* ${MARKER} */
  const onTogglePause = async () => {
    if (hud.mode !== "active") return;

    const paused = lsGet(LS.isPaused) === "true";

    // Manual Pause Workout is the ONLY action that creates paused workout state.
    if (!paused) {
      const musicWasPlaying = isMusicPlaying();
      lsSet(LS.musicWasPlayingOnPause, musicWasPlaying ? "true" : "false");

      if (musicWasPlaying) {
        pauseMusic();
      }

      lsSet(LS.isPaused, "true");
      lsSet(LS.pausedAt, new Date().toISOString());
      setHud({ ...hud, isPaused: true });
      window.dispatchEvent(new Event(WORKOUT_PAUSE_STATE_EVENT));
      return;
    }

    const shouldResumeMusic = lsGet(LS.musicWasPlayingOnPause) === "true";
    const pausedAtISO = lsGet(LS.pausedAt);
    const pausedTotal = Number(lsGet(LS.pausedTotal) ?? "0") || 0;

    if (pausedAtISO) {
      const pMs = new Date(pausedAtISO).getTime();
      const add = Math.max(0, Math.floor((Date.now() - pMs) / 1000));
      lsSet(LS.pausedTotal, String(pausedTotal + add));
    }

    lsSet(LS.isPaused, "false");
    lsDel(LS.pausedAt);
    setHud({ ...hud, isPaused: false });
    window.dispatchEvent(new Event(WORKOUT_PAUSE_STATE_EVENT));

    // Invoke from the Resume button path so mobile gets a real user gesture.
    if (shouldResumeMusic) {
      void playMusic().catch((error) => {
        console.warn("Could not resume workout music.", error);
      });
    }
    lsDel(LS.musicWasPlayingOnPause);

    const active = await resolveActiveWorkoutDbFirst();
    if (active?.sessionId) navigate(\`/workout/\${active.sessionId}\`);
  };

  async function startSession`
  );
}

// -----------------------------------------------------------------------------
// TODAY: active-but-running is RETURN TO WORKOUT. RESUME means actually paused.
// Return uses the existing SPA navigation instead of a browser reload.
// -----------------------------------------------------------------------------
if (!/export\s+function\s+TodayPage\s*\(\s*\{\s*navigate\s*\}/.test(today)) {
  today = replaceOne(
    today,
    /export\s+function\s+TodayPage\s*\(\s*\)\s*\{/m,
    `export function TodayPage({ navigate }: { navigate?: (to: string) => void } = {}) {
  /* ${MARKER} */`,
    "TodayPage signature"
  );
}

if (!today.includes("const [workoutPaused, setWorkoutPaused]")) {
  today = replaceOne(
    today,
    /(\s*const\s+\[editingSessionId,\s*setEditingSessionId\]\s*=\s*useState<string\s*\|\s*null>\(null\);\s*\n)/m,
    `$1  const [workoutPaused, setWorkoutPaused] = useState(() => {\n    try {\n      return localStorage.getItem("mvp_is_paused") === "true";\n    } catch {\n      return false;\n    }\n  });\n`,
    "TodayPage paused state"
  );
}

if (!today.includes('window.addEventListener("mvp:workout-pause-state", syncPauseState')) {
  const firstLoadEffect = /  useEffect\(\(\) => \{\s*\n\s*void load\(\);\s*\n\s*\}, \[\]\);\s*\n/m;
  if (!firstLoadEffect.test(today)) stop("TodayPage initial load effect was not found.");
  today = today.replace(
    firstLoadEffect,
`  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const syncPauseState = () => {
      try {
        setWorkoutPaused(localStorage.getItem("mvp_is_paused") === "true");
      } catch {
        setWorkoutPaused(false);
      }
    };

    syncPauseState();
    window.addEventListener("storage", syncPauseState);
    window.addEventListener("focus", syncPauseState);
    window.addEventListener("mvp:workout-pause-state", syncPauseState as EventListener);

    return () => {
      window.removeEventListener("storage", syncPauseState);
      window.removeEventListener("focus", syncPauseState);
      window.removeEventListener("mvp:workout-pause-state", syncPauseState as EventListener);
    };
  }, []);

`
  );
}

if (!today.includes("function goTo(to: string)")) {
  today = replaceOne(
    today,
    /  function\s+openSession\s*\(\s*sessionId:\s*string\s*\)\s*\{\s*\n\s*window\.location\.pathname\s*=\s*`\/workout\/\$\{sessionId\}`;\s*\n\s*\}/m,
`  function goTo(to: string) {
    if (navigate) {
      navigate(to);
      return;
    }

    const next = to.length > 1 && to.endsWith("/") ? to.slice(0, -1) : to;
    if (window.location.pathname === next) return;
    window.history.pushState({}, "", next);
    window.dispatchEvent(new Event("popstate"));
  }

  function openSession(sessionId: string) {
    goTo(\`/workout/\${sessionId}\`);
  }`,
    "TodayPage openSession SPA navigation"
  );
}

today = today.replace(
  /onClick=\{\(\)\s*=>\s*\(window\.location\.pathname\s*=\s*"\/coach"\)\}/g,
  `onClick={() => goTo("/coach")}`
);

today = today.replace(
  /\{activeSessionId\s*\?\s*"IN PROGRESS"\s*:\s*primaryReadiness\.label\}/g,
  `{activeSessionId ? (workoutPaused ? "PAUSED" : "IN PROGRESS") : primaryReadiness.label}`
);

today = today.replace(
  /\{activeSessionId\s*\?\s*"RESUME WORKOUT"\s*:\s*"START WORKOUT"\}/g,
  `{activeSessionId ? (workoutPaused ? "RESUME WORKOUT" : "RETURN TO WORKOUT") : "START WORKOUT"}`
);

// -----------------------------------------------------------------------------
// ROUTES: pass the already-correct SPA navigator into TodayPage.
// -----------------------------------------------------------------------------
if (!routes.includes('{ path: "/", el: <TodayPage navigate={goTo} /> }')) {
  if (routes.includes('{ path: "/", el: <TodayPage /> }')) {
    routes = routes.replace(
      '{ path: "/", el: <TodayPage /> }',
      '{ path: "/", el: <TodayPage navigate={goTo} /> }'
    );
  } else {
    stop("routes.tsx root TodayPage route was not found.");
  }
}

// If old route helper still exists locally, repair it too.
if (routes.includes("window.location.pathname = to;")) {
  routes = replaceOne(
    routes,
    /const\s+goTo\s*=\s*\(to:\s*string\)\s*=>\s*\{\s*window\.location\.pathname\s*=\s*to;\s*\};/m,
`const goTo = (to: string) => {
  const next = to.length > 1 && to.endsWith("/") ? to.slice(0, -1) : to;
  if (window.location.pathname === next) return;
  window.history.pushState({}, "", next);
  window.dispatchEvent(new Event("popstate"));
};`,
    "routes SPA navigation"
  );
}

// -----------------------------------------------------------------------------
// WORKOUT PLAYER: remove remaining internal full-page navigation and preserve
// exact exercise cursor across tab changes/remounts.
// -----------------------------------------------------------------------------
if (!workout.includes("function navigateWithinTrainer(to: string)")) {
  workout = replaceOne(
    workout,
    /function\s+MediaOrFallback\s*\(/m,
`function navigateWithinTrainer(to: string) {
  const next = to.length > 1 && to.endsWith("/") ? to.slice(0, -1) : to;
  if (window.location.pathname === next) return;
  window.history.pushState({}, "", next);
  window.dispatchEvent(new Event("popstate"));
}

function MediaOrFallback(`,
    "WorkoutPlayer SPA helper"
  );
}

workout = workout.replace(
  /window\.location\.pathname\s*=\s*`\/library\/\$\{exId\}`;/g,
  `navigateWithinTrainer(\`/library/\${exId}\`);`
);
workout = workout.replace(
  /onClick=\{\(\)\s*=>\s*\(window\.location\.pathname\s*=\s*"\/"\)\}/g,
  `onClick={() => navigateWithinTrainer("/")}`
);
workout = workout.replace(
  /onCancel=\{\(\)\s*=>\s*\(window\.location\.pathname\s*=\s*"\/"\)\}/g,
  `onCancel={() => navigateWithinTrainer("/")}`
);
workout = workout.replace(
  /onClick=\{\(\)\s*=>\s*\(window\.location\.pathname\s*=\s*`\/library\/\$\{exerciseId\}`\)\}/g,
  `onClick={() => navigateWithinTrainer(\`/library/\${exerciseId}\`)}`
);

if (!workout.includes('const WORKOUT_CURSOR_STORAGE_PREFIX = "mvp_workout_cursor_v1:";')) {
  const typeRx = /(type WorkoutExerciseRow = \{[\s\S]*?\n\};\s*\n)(\s*type PreviousSetRow = \{)/m;
  if (!typeRx.test(workout)) stop("WorkoutPlayer WorkoutExerciseRow type was not found.");

  workout = workout.replace(
    typeRx,
`$1
const WORKOUT_CURSOR_STORAGE_PREFIX = "mvp_workout_cursor_v1:";

function readStoredWorkoutCursorIndex(workoutId: string, items: WorkoutExerciseRow[]) {
  if (!items.length) return 0;

  try {
    const raw = localStorage.getItem(\`\${WORKOUT_CURSOR_STORAGE_PREFIX}\${workoutId}\`);
    if (!raw) return 0;

    const saved = JSON.parse(raw) as {
      workoutExerciseId?: string | null;
      exerciseId?: string | null;
      index?: number;
    };

    if (saved.workoutExerciseId) {
      const exact = items.findIndex((item) => item.id === saved.workoutExerciseId);
      if (exact >= 0) return exact;
    }

    if (saved.exerciseId) {
      const byExercise = items.findIndex((item) => item.exercise_id === saved.exerciseId);
      if (byExercise >= 0) return byExercise;
    }

    const index = Number(saved.index);
    if (Number.isFinite(index)) {
      return Math.max(0, Math.min(items.length - 1, Math.floor(index)));
    }
  } catch {
    // Cursor persistence is best effort only.
  }

  return 0;
}

$2`
  );
}

if (!workout.includes("workoutExerciseId: current?.id ?? null")) {
  const activeStorageRx =
    /(\s*localStorage\.setItem\("mvp_active_exercise_name",\s*String\(name\)\);\s*\n\s*localStorage\.setItem\("mvp_active_exercise_pos",\s*pos\s*\?\s*`\(\$\{pos\}\)`\s*:\s*""\);)(\s*\n\s*\}\s*catch\s*\{\}\s*\n\s*\},\s*\[sessionId,\s*workoutId,\s*current\?\.exercise\?\.name,\s*current\?\.exercise_id,\s*activeIdx,\s*items\.length\]\);)/m;

  if (!activeStorageRx.test(workout)) stop("WorkoutPlayer active exercise persistence effect was not found.");

  workout = workout.replace(
    activeStorageRx,
`$1

      if (workoutId && current) {
        localStorage.setItem(
          \`\${WORKOUT_CURSOR_STORAGE_PREFIX}\${workoutId}\`,
          JSON.stringify({
            sessionId,
            workoutId,
            workoutExerciseId: current?.id ?? null,
            exerciseId: current?.exercise_id ?? null,
            index: activeIdx,
          })
        );
      }$2`
  );

  workout = workout.replace(
    /\[sessionId,\s*workoutId,\s*current\?\.exercise\?\.name,\s*current\?\.exercise_id,\s*activeIdx,\s*items\.length\]\);/,
    `[sessionId, workoutId, current?.id, current?.exercise?.name, current?.exercise_id, activeIdx, items.length]);`
  );
}

if (workout.includes("setItems(loaded);\n    setActiveIdx(0);")) {
  workout = workout.replace(
    "setItems(loaded);\n    setActiveIdx(0);",
    "setItems(loaded);\n    setActiveIdx(readStoredWorkoutCursorIndex(wId, loaded));"
  );
} else if (!workout.includes("setActiveIdx(readStoredWorkoutCursorIndex(wId, loaded));")) {
  stop("WorkoutPlayer hydrate active index anchor was not found.");
}

// -----------------------------------------------------------------------------
// FINAL VALIDATION. Nothing has been written yet.
// -----------------------------------------------------------------------------
const checks = [
  [/\bexport\s+function\s+isMusicPlaying\s*\(/.test(music), "music isMusicPlaying export missing"],
  [shell.includes("pauseMusic();"), "manual workout pause does not pause music"],
  [shell.includes("void playMusic().catch"), "manual workout resume does not resume music"],
  [shell.includes("musicWasPlayingOnPause"), "music pause intent storage missing"],
  [today.includes('"RETURN TO WORKOUT"'), "RETURN TO WORKOUT label missing"],
  [today.includes('workoutPaused ? "RESUME WORKOUT"'), "true Resume label missing"],
  [today.includes("window.history.pushState"), "TodayPage SPA navigation missing"],
  [routes.includes('<TodayPage navigate={goTo} />'), "TodayPage route is not using SPA navigator"],
  [workout.includes("navigateWithinTrainer"), "WorkoutPlayer SPA navigation helper missing"],
  [workout.includes("readStoredWorkoutCursorIndex(wId, loaded)"), "WorkoutPlayer cursor restore missing"],
];

for (const [ok, label] of checks) {
  if (!ok) stop(`validation failed: ${label}`);
}

// Write only after ALL transforms pass.
for (const [name, file] of Object.entries(FILES)) {
  fs.copyFileSync(file, `${file}.pre-v4-5-2-r2-true-pause-continuity.bak`);
}

fs.writeFileSync(FILES.routes, routes, "utf8");
fs.writeFileSync(FILES.today, today, "utf8");
fs.writeFileSync(FILES.shell, shell, "utf8");
fs.writeFileSync(FILES.workout, workout, "utf8");
fs.writeFileSync(FILES.music, music, "utf8");

console.log("");
console.log("MVP Trainer V4.5.2 R2 True Pause Continuity applied successfully.");
console.log("(v4-5-2-r2-true-pause-continuity)");
console.log("");
console.log("FIXED:");
console.log("  ✓ Changing tabs does NOT pause the workout.");
console.log("  ✓ Running active session says RETURN TO WORKOUT.");
console.log("  ✓ RESUME WORKOUT appears only after PAUSE WORKOUT.");
console.log("  ✓ RETURN/RESUME uses in-app navigation, not a browser reload.");
console.log("  ✓ PAUSE WORKOUT pauses music if it was playing.");
console.log("  ✓ RESUME WORKOUT resumes that music from the same position.");
console.log("  ✓ Exact active exercise cursor is restored after tab navigation.");
console.log("  ✓ Remaining workout internal links no longer force page reload.");
console.log("");
console.log("Backups were created next to each modified source file.");
console.log("NEXT: npm run build");
