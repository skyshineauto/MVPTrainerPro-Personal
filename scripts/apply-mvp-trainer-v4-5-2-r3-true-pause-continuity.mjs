import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const VERSION = "v4-5-2-r3-true-pause-continuity";
const MARKER = "MVP_TRAINER_V4_5_2_TRUE_PAUSE_CONTINUITY_R3";

const FILES = {
  today: path.join(ROOT, "src", "features", "today", "TodayPage.tsx"),
  shell: path.join(ROOT, "src", "app", "layout", "AppShell.tsx"),
  workout: path.join(ROOT, "src", "features", "workout", "WorkoutPlayerPage.tsx"),
  music: path.join(ROOT, "src", "lib", "musicPlayer.ts"),
};

function stop(message) {
  console.error("");
  console.error(`MVP Trainer V4.5.2 R3 stopped: ${message}`);
  console.error("No source files were written.");
  process.exit(1);
}

for (const [name, file] of Object.entries(FILES)) {
  if (!fs.existsSync(file)) stop(`${name} not found: ${path.relative(ROOT, file)}`);
}

const original = Object.fromEntries(
  Object.entries(FILES).map(([name, file]) => [name, fs.readFileSync(file, "utf8")])
);

let today = original.today;
let shell = original.shell;
let workout = original.workout;
let music = original.music;

/**
 * Finds the closing brace for a JS/TS block while ignoring braces inside
 * quoted strings, template strings, and comments.
 */
function findMatchingBrace(text, openIndex) {
  if (text[openIndex] !== "{") throw new Error("findMatchingBrace requires an opening brace");

  let depth = 0;
  let mode = "code";
  let escaped = false;

  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (mode === "lineComment") {
      if (ch === "\n") mode = "code";
      continue;
    }

    if (mode === "blockComment") {
      if (ch === "*" && next === "/") {
        mode = "code";
        i += 1;
      }
      continue;
    }

    if (mode === "single" || mode === "double" || mode === "template") {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (
        (mode === "single" && ch === "'") ||
        (mode === "double" && ch === '"') ||
        (mode === "template" && ch === "`")
      ) {
        mode = "code";
      }
      continue;
    }

    if (ch === "/" && next === "/") {
      mode = "lineComment";
      i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      mode = "blockComment";
      i += 1;
      continue;
    }
    if (ch === "'") {
      mode = "single";
      continue;
    }
    if (ch === '"') {
      mode = "double";
      continue;
    }
    if (ch === "`") {
      mode = "template";
      continue;
    }

    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function replaceArrowFunctionDeclaration(text, name, replacement) {
  const token = `const ${name}`;
  const start = text.indexOf(token);
  if (start < 0) stop(`${name} declaration was not found.`);

  const arrow = text.indexOf("=>", start);
  if (arrow < 0) stop(`${name} arrow was not found.`);

  const open = text.indexOf("{", arrow);
  if (open < 0) stop(`${name} opening brace was not found.`);

  const close = findMatchingBrace(text, open);
  if (close < 0) stop(`${name} closing brace was not found.`);

  let end = close + 1;
  while (end < text.length && (text[end] === " " || text[end] === "\t")) end += 1;
  if (text[end] === ";") end += 1;

  return text.slice(0, start) + replacement + text.slice(end);
}

function replaceFunctionDeclaration(text, signatureToken, replacement) {
  const start = text.indexOf(signatureToken);
  if (start < 0) stop(`${signatureToken} was not found.`);

  const open = text.indexOf("{", start + signatureToken.length);
  if (open < 0) stop(`${signatureToken} opening brace was not found.`);

  const close = findMatchingBrace(text, open);
  if (close < 0) stop(`${signatureToken} closing brace was not found.`);

  return text.slice(0, start) + replacement + text.slice(close + 1);
}

function insertAfterOnce(text, needle, addition, label) {
  const first = text.indexOf(needle);
  if (first < 0) stop(`${label} anchor was not found.`);
  if (text.indexOf(needle, first + needle.length) >= 0) stop(`${label} anchor was not unique.`);
  return text.slice(0, first + needle.length) + addition + text.slice(first + needle.length);
}

// -----------------------------------------------------------------------------
// MUSIC PLAYER
// -----------------------------------------------------------------------------
if (!music.includes("export function isMusicPlaying()")) {
  const pauseToken = "export function pauseMusic";
  const pauseIndex = music.indexOf(pauseToken);
  if (pauseIndex < 0) stop("musicPlayer.ts pauseMusic() was not found.");

  music =
    music.slice(0, pauseIndex) +
`/* ${MARKER}
 * Lightweight live transport query for workout pause/resume.
 */
export function isMusicPlaying() {
  const audio = audioElement;
  return Boolean(audio && !audio.paused && !audio.ended && Boolean(audio.src));
}

` +
    music.slice(pauseIndex);
}

// -----------------------------------------------------------------------------
// APP SHELL
// -----------------------------------------------------------------------------
if (!shell.includes(`isMusicPlaying, pauseMusic, playMusic`)) {
  const importNeedle = `import { MusicMiniPlayer } from "../../features/music/MusicMiniPlayer";`;
  if (!shell.includes(importNeedle)) stop("AppShell MusicMiniPlayer import was not found.");

  shell = shell.replace(
    importNeedle,
`${importNeedle}
import { isMusicPlaying, pauseMusic, playMusic } from "../../lib/musicPlayer";`
  );
}

if (!shell.includes('musicWasPlayingOnPause: "mvp_music_was_playing_on_workout_pause"')) {
  const keyNeedle = `  activeExercisePos: "mvp_active_exercise_pos",`;
  if (!shell.includes(keyNeedle)) stop("AppShell LS.activeExercisePos was not found.");

  shell = shell.replace(
    keyNeedle,
`${keyNeedle}
  musicWasPlayingOnPause: "mvp_music_was_playing_on_workout_pause",`
  );
}

if (!shell.includes('const WORKOUT_PAUSE_STATE_EVENT = "mvp:workout-pause-state";')) {
  const eventNeedle = `const END_WORKOUT_REQUEST_EVENT = "mvp:end-workout-request";`;
  if (!shell.includes(eventNeedle)) stop("AppShell END_WORKOUT_REQUEST_EVENT was not found.");

  shell = shell.replace(
    eventNeedle,
`${eventNeedle}
const WORKOUT_PAUSE_STATE_EVENT = "mvp:workout-pause-state";`
  );
}

if (!shell.includes(`/* ${MARKER}: TRUE MANUAL PAUSE */`)) {
  const replacement =
`const onTogglePause = async () => {
    if (hud.mode !== "active") return;

    const paused = lsGet(LS.isPaused) === "true";

    // ONLY an explicit Pause Workout press creates paused workout state.
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

    // Resume from the user's Resume Workout click, including on mobile.
    if (shouldResumeMusic) {
      void playMusic().catch((error) => {
        console.warn("Could not resume workout music.", error);
      });
    }
    lsDel(LS.musicWasPlayingOnPause);

    const active = await resolveActiveWorkoutDbFirst();
    if (active?.sessionId) navigate(\`/workout/\${active.sessionId}\`);
  }; /* ${MARKER}: TRUE MANUAL PAUSE */`;

  shell = replaceArrowFunctionDeclaration(shell, "onTogglePause", replacement);
}

// -----------------------------------------------------------------------------
// TODAY / WORKOUTS PAGE
// -----------------------------------------------------------------------------
if (!today.includes("const [workoutPaused, setWorkoutPaused]")) {
  const stateNeedle = `  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);`;
  if (!today.includes(stateNeedle)) stop("TodayPage editingSessionId state was not found.");

  today = today.replace(
    stateNeedle,
`${stateNeedle}
  const [workoutPaused, setWorkoutPaused] = useState(() => {
    try {
      return localStorage.getItem("mvp_is_paused") === "true";
    } catch {
      return false;
    }
  });`
  );
}

if (!today.includes(`/* ${MARKER}: PAUSE STATE SYNC */`)) {
  const goalNeedle = `  const goal = queue?.activeBlock?.goal ? String(queue.activeBlock.goal) : null;`;
  if (!today.includes(goalNeedle)) stop("TodayPage goal anchor was not found.");

  today = today.replace(
    goalNeedle,
`  /* ${MARKER}: PAUSE STATE SYNC */
  useEffect(() => {
    const syncPauseState = () => {
      try {
        setWorkoutPaused(localStorage.getItem("mvp_is_paused") === "true");
      } catch {
        setWorkoutPaused(false);
      }
    };

    syncPauseState();
    window.addEventListener("focus", syncPauseState);
    window.addEventListener("storage", syncPauseState);
    window.addEventListener("mvp:workout-pause-state", syncPauseState as EventListener);

    return () => {
      window.removeEventListener("focus", syncPauseState);
      window.removeEventListener("storage", syncPauseState);
      window.removeEventListener("mvp:workout-pause-state", syncPauseState as EventListener);
    };
  }, []);

${goalNeedle}`
  );
}

if (!today.includes("function navigateWithinToday(to: string)")) {
  const openToken = "  function openSession(sessionId: string)";
  const openIndex = today.indexOf(openToken);
  if (openIndex < 0) stop("TodayPage openSession() was not found.");

  const replacement =
`  function navigateWithinToday(to: string) {
    const next = to.length > 1 && to.endsWith("/") ? to.slice(0, -1) : to;
    if (window.location.pathname === next) return;
    window.history.pushState({}, "", next);
    window.dispatchEvent(new Event("popstate"));
  }

  function openSession(sessionId: string) {
    navigateWithinToday(\`/workout/\${sessionId}\`);
  }`;

  const local = today.slice(openIndex);
  const braceOpen = local.indexOf("{");
  if (braceOpen < 0) stop("TodayPage openSession opening brace was not found.");
  const absoluteOpen = openIndex + braceOpen;
  const absoluteClose = findMatchingBrace(today, absoluteOpen);
  if (absoluteClose < 0) stop("TodayPage openSession closing brace was not found.");

  today = today.slice(0, openIndex) + replacement + today.slice(absoluteClose + 1);
}

today = today.replace(
  /onClick=\{\(\)\s*=>\s*\(window\.location\.pathname\s*=\s*"\/coach"\)\}/g,
  `onClick={() => navigateWithinToday("/coach")}`
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
// WORKOUT PLAYER NAVIGATION + EXACT EXERCISE CURSOR
// -----------------------------------------------------------------------------
if (!workout.includes("function navigateWithinTrainer(to: string)")) {
  const mediaToken = "function MediaOrFallback";
  const mediaIndex = workout.indexOf(mediaToken);
  if (mediaIndex < 0) stop("WorkoutPlayer MediaOrFallback was not found.");

  workout =
    workout.slice(0, mediaIndex) +
`function navigateWithinTrainer(to: string) {
  const next = to.length > 1 && to.endsWith("/") ? to.slice(0, -1) : to;
  if (window.location.pathname === next) return;
  window.history.pushState({}, "", next);
  window.dispatchEvent(new Event("popstate"));
}

` +
    workout.slice(mediaIndex);
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

if (!workout.includes(`/* ${MARKER}: SAVE EXERCISE CURSOR */`)) {
  const cursorNeedle = `      localStorage.setItem("mvp_active_exercise_pos", pos ? \`(\${pos})\` : "");`;
  if (!workout.includes(cursorNeedle)) stop("WorkoutPlayer active exercise storage anchor was not found.");

  workout = workout.replace(
    cursorNeedle,
`${cursorNeedle}

      /* ${MARKER}: SAVE EXERCISE CURSOR */
      if (workoutId && current) {
        localStorage.setItem(
          \`mvp_active_exercise_cursor:\${workoutId}\`,
          JSON.stringify({
            workoutExerciseId: current.id ?? null,
            exerciseId: current.exercise_id ?? null,
            index: activeIdx,
          })
        );
      }`
  );
}

if (!workout.includes(`/* ${MARKER}: RESTORE EXERCISE CURSOR */`)) {
  const loadedNeedle = `    setItems(loaded);
    setActiveIdx(0);

    const exIds = Array.from(new Set(loaded.map((r) => r.exercise_id).filter(Boolean)));`;

  if (!workout.includes(loadedNeedle)) stop("WorkoutPlayer loaded/setActiveIdx anchor was not found.");

  workout = workout.replace(
    loadedNeedle,
`    setItems(loaded);

    /* ${MARKER}: RESTORE EXERCISE CURSOR */
    let restoredIndex = 0;
    try {
      const rawCursor = localStorage.getItem(\`mvp_active_exercise_cursor:\${wId}\`);
      if (rawCursor) {
        const savedCursor = JSON.parse(rawCursor) as {
          workoutExerciseId?: string | null;
          exerciseId?: string | null;
          index?: number;
        };

        const exactIndex = savedCursor.workoutExerciseId
          ? loaded.findIndex((row) => row.id === savedCursor.workoutExerciseId)
          : -1;

        const exerciseIndex =
          exactIndex < 0 && savedCursor.exerciseId
            ? loaded.findIndex((row) => row.exercise_id === savedCursor.exerciseId)
            : -1;

        const numericIndex = Number(savedCursor.index);

        if (exactIndex >= 0) restoredIndex = exactIndex;
        else if (exerciseIndex >= 0) restoredIndex = exerciseIndex;
        else if (Number.isFinite(numericIndex)) {
          restoredIndex = Math.max(0, Math.min(loaded.length - 1, Math.floor(numericIndex)));
        }
      }
    } catch {
      restoredIndex = 0;
    }

    setActiveIdx(restoredIndex);

    const exIds = Array.from(new Set(loaded.map((r) => r.exercise_id).filter(Boolean)));`
  );
}

// -----------------------------------------------------------------------------
// VALIDATE EVERYTHING BEFORE WRITING.
// -----------------------------------------------------------------------------
const validations = [
  [music.includes("export function isMusicPlaying()"), "music transport query missing"],
  [shell.includes("pauseMusic();"), "Pause Workout music pause missing"],
  [shell.includes("void playMusic().catch"), "Resume Workout music resume missing"],
  [shell.includes(`/* ${MARKER}: TRUE MANUAL PAUSE */`), "AppShell R3 pause handler missing"],
  [today.includes('"RETURN TO WORKOUT"'), "RETURN TO WORKOUT label missing"],
  [today.includes('workoutPaused ? "RESUME WORKOUT"'), "true paused Resume label missing"],
  [today.includes("navigateWithinToday"), "TodayPage SPA navigation missing"],
  [!today.includes('window.location.pathname = `/workout/${sessionId}`;'), "TodayPage still hard reloads workout"],
  [workout.includes("navigateWithinTrainer"), "WorkoutPlayer SPA helper missing"],
  [workout.includes(`/* ${MARKER}: SAVE EXERCISE CURSOR */`), "exercise cursor save missing"],
  [workout.includes(`/* ${MARKER}: RESTORE EXERCISE CURSOR */`), "exercise cursor restore missing"],
];

for (const [ok, message] of validations) {
  if (!ok) stop(`validation failed: ${message}`);
}

// Backups and writes happen only after every validation succeeds.
for (const file of Object.values(FILES)) {
  fs.copyFileSync(file, `${file}.pre-${VERSION}.bak`);
}

fs.writeFileSync(FILES.today, today, "utf8");
fs.writeFileSync(FILES.shell, shell, "utf8");
fs.writeFileSync(FILES.workout, workout, "utf8");
fs.writeFileSync(FILES.music, music, "utf8");

console.log("");
console.log("MVP Trainer V4.5.2 R3 True Pause Continuity applied successfully.");
console.log(`(${VERSION})`);
console.log("");
console.log("FIXED:");
console.log("  ✓ Leaving the workout screen does NOT pause the workout.");
console.log("  ✓ An active running workout says RETURN TO WORKOUT.");
console.log("  ✓ RESUME WORKOUT appears only when mvp_is_paused is actually true.");
console.log("  ✓ RETURN TO WORKOUT uses SPA navigation, so music is not torn down.");
console.log("  ✓ PAUSE WORKOUT pauses music if music is currently playing.");
console.log("  ✓ RESUME WORKOUT resumes that same music from its paused position.");
console.log("  ✓ Exact workout exercise is restored after navigating away and back.");
console.log("  ✓ Workout internal links no longer force full browser reloads.");
console.log("");
console.log("Backups created next to the four modified source files.");
console.log("NEXT: npm run build");
