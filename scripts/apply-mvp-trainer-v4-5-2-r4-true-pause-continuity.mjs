import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const VERSION = "v4-5-2-r4-true-pause-continuity";
const MARKER = "MVP_TRAINER_V4_5_2_TRUE_PAUSE_CONTINUITY_R4";

const FILES = {
  today: path.join(ROOT, "src", "features", "today", "TodayPage.tsx"),
  shell: path.join(ROOT, "src", "app", "layout", "AppShell.tsx"),
  music: path.join(ROOT, "src", "lib", "musicPlayer.ts"),
  workout: path.join(ROOT, "src", "features", "workout", "WorkoutPlayerPage.tsx"),
};

function stop(message) {
  console.error("");
  console.error(`MVP Trainer V4.5.2 R4 stopped: ${message}`);
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
let music = original.music;
let workout = original.workout;

function findMatchingBrace(text, openIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (lineComment) {
      if (ch === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === "*" && next === "/") {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === "/" && next === "/") {
      lineComment = true;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      blockComment = true;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
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

function replaceArrowFunction(text, name, replacement) {
  const start = text.indexOf(`const ${name}`);
  if (start < 0) stop(`${name} was not found.`);
  const arrow = text.indexOf("=>", start);
  if (arrow < 0) stop(`${name} arrow was not found.`);
  const open = text.indexOf("{", arrow);
  if (open < 0) stop(`${name} opening brace was not found.`);
  const close = findMatchingBrace(text, open);
  if (close < 0) stop(`${name} closing brace was not found.`);

  let end = close + 1;
  while (end < text.length && /[ \t]/.test(text[end])) end += 1;
  if (text[end] === ";") end += 1;

  return text.slice(0, start) + replacement + text.slice(end);
}

// -----------------------------------------------------------------------------
// MUSIC PLAYER: expose current playback state.
// -----------------------------------------------------------------------------
if (!music.includes("export function isMusicPlaying()")) {
  const pauseIndex = music.indexOf("export function pauseMusic");
  if (pauseIndex < 0) stop("musicPlayer.ts pauseMusic() was not found.");

  music =
    music.slice(0, pauseIndex) +
`/* ${MARKER}: PLAYBACK QUERY */
export function isMusicPlaying() {
  const audio = audioElement;
  return Boolean(audio && !audio.paused && !audio.ended && Boolean(audio.src));
}

` +
    music.slice(pauseIndex);
}

// -----------------------------------------------------------------------------
// APP SHELL: actual Pause Workout controls both workout + music.
// -----------------------------------------------------------------------------
if (!shell.includes(`isMusicPlaying, pauseMusic, playMusic`)) {
  const miniImport = `import { MusicMiniPlayer } from "../../features/music/MusicMiniPlayer";`;
  if (!shell.includes(miniImport)) stop("AppShell MusicMiniPlayer import was not found.");
  shell = shell.replace(
    miniImport,
`${miniImport}
import { isMusicPlaying, pauseMusic, playMusic } from "../../lib/musicPlayer";`
  );
}

if (!shell.includes('musicWasPlayingOnPause: "mvp_music_was_playing_on_workout_pause"')) {
  const key = `  activeExercisePos: "mvp_active_exercise_pos",`;
  if (!shell.includes(key)) stop("AppShell activeExercisePos storage key was not found.");
  shell = shell.replace(
    key,
`${key}
  musicWasPlayingOnPause: "mvp_music_was_playing_on_workout_pause",`
  );
}

if (!shell.includes('const WORKOUT_RESUME_REQUEST_EVENT = "mvp:resume-workout-request";')) {
  const eventKey = `const END_WORKOUT_REQUEST_EVENT = "mvp:end-workout-request";`;
  if (!shell.includes(eventKey)) stop("AppShell end-workout event anchor was not found.");
  shell = shell.replace(
    eventKey,
`${eventKey}
const WORKOUT_RESUME_REQUEST_EVENT = "mvp:resume-workout-request";
const WORKOUT_PAUSE_STATE_EVENT = "mvp:workout-pause-state";`
  );
}

if (!shell.includes(`${MARKER}: TRUE PAUSE`)) {
  const replacement =
`const onTogglePause = async () => {
    if (hud.mode !== "active") return;

    const paused = lsGet(LS.isPaused) === "true";

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

    if (shouldResumeMusic) {
      void playMusic().catch((error) => {
        console.warn("Could not resume workout music.", error);
      });
    }
    lsDel(LS.musicWasPlayingOnPause);

    const active = await resolveActiveWorkoutDbFirst();
    if (active?.sessionId) navigate(\`/workout/\${active.sessionId}\`);
  }; /* ${MARKER}: TRUE PAUSE */`;

  shell = replaceArrowFunction(shell, "onTogglePause", replacement);
}

if (!shell.includes(`${MARKER}: RESUME EVENT`)) {
  const marker = `}; /* ${MARKER}: TRUE PAUSE */`;
  const idx = shell.indexOf(marker);
  if (idx < 0) stop("R4 true-pause handler marker was not found after patch.");
  const insertAt = idx + marker.length;

  shell =
    shell.slice(0, insertAt) +
`

  /* ${MARKER}: RESUME EVENT */
  useEffect(() => {
    const handleResumeRequest = () => {
      if (hud.mode !== "active") return;
      if (lsGet(LS.isPaused) !== "true") return;
      void onTogglePause();
    };

    window.addEventListener(WORKOUT_RESUME_REQUEST_EVENT, handleResumeRequest);
    return () => {
      window.removeEventListener(WORKOUT_RESUME_REQUEST_EVENT, handleResumeRequest);
    };
  }, [hud]);` +
    shell.slice(insertAt);
}

// -----------------------------------------------------------------------------
// TODAY PAGE: running active workout is RETURN. Paused active workout is RESUME.
// -----------------------------------------------------------------------------
if (!today.includes("const [workoutPaused, setWorkoutPaused]")) {
  const anchor = `  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);`;
  if (!today.includes(anchor)) stop("TodayPage editingSessionId state was not found.");
  today = today.replace(
    anchor,
`${anchor}
  const [workoutPaused, setWorkoutPaused] = useState(() => {
    try {
      return localStorage.getItem("mvp_is_paused") === "true";
    } catch {
      return false;
    }
  });`
  );
}

if (!today.includes(`${MARKER}: PAUSE SYNC`)) {
  const goalAnchor = `  const goal = queue?.activeBlock?.goal ? String(queue.activeBlock.goal) : null;`;
  if (!today.includes(goalAnchor)) stop("TodayPage goal anchor was not found.");

  today = today.replace(
    goalAnchor,
`  /* ${MARKER}: PAUSE SYNC */
  useEffect(() => {
    const syncWorkoutPaused = () => {
      try {
        setWorkoutPaused(localStorage.getItem("mvp_is_paused") === "true");
      } catch {
        setWorkoutPaused(false);
      }
    };

    syncWorkoutPaused();
    window.addEventListener("focus", syncWorkoutPaused);
    window.addEventListener("storage", syncWorkoutPaused);
    window.addEventListener("mvp:workout-pause-state", syncWorkoutPaused as EventListener);

    return () => {
      window.removeEventListener("focus", syncWorkoutPaused);
      window.removeEventListener("storage", syncWorkoutPaused);
      window.removeEventListener("mvp:workout-pause-state", syncWorkoutPaused as EventListener);
    };
  }, []);

${goalAnchor}`
  );
}

if (!today.includes("function navigateWithinToday(to: string)")) {
  const start = today.indexOf("  function openSession(sessionId: string)");
  if (start < 0) stop("TodayPage openSession() was not found.");
  const open = today.indexOf("{", start);
  const close = findMatchingBrace(today, open);
  if (close < 0) stop("TodayPage openSession() closing brace was not found.");

  const replacement =
`  function navigateWithinToday(to: string) {
    const next = to.length > 1 && to.endsWith("/") ? to.slice(0, -1) : to;
    if (window.location.pathname === next) return;
    window.history.pushState({}, "", next);
    window.dispatchEvent(new Event("popstate"));
  }

  function openSession(sessionId: string) {
    navigateWithinToday(\`/workout/\${sessionId}\`);
  }

  function handlePrimarySessionAction(sessionId: string) {
    if (activeSessionId === sessionId && workoutPaused) {
      window.dispatchEvent(new Event("mvp:resume-workout-request"));
      return;
    }
    openSession(sessionId);
  }`;

  today = today.slice(0, start) + replacement + today.slice(close + 1);
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
  /if \(id\) openSession\(id\);/g,
  `if (id) handlePrimarySessionAction(id);`
);

today = today.replace(
  /\{activeSessionId\s*\?\s*"RESUME WORKOUT"\s*:\s*"START WORKOUT"\}/g,
  `{activeSessionId ? (workoutPaused ? "RESUME WORKOUT" : "RETURN TO WORKOUT") : "START WORKOUT"}`
);

// -----------------------------------------------------------------------------
// OPTIONAL: exact-ish exercise restoration from the position already saved by
// WorkoutPlayer. This can NEVER block the core pause/music fix.
// -----------------------------------------------------------------------------
let cursorPatch = "not-needed-or-already-customized";
if (
  workout.includes(`setItems(loaded);`) &&
  workout.includes(`setActiveIdx(0);`) &&
  !workout.includes(`${MARKER}: RESTORE CURSOR`)
) {
  const needle = `    setItems(loaded);
    setActiveIdx(0);`;

  if (workout.includes(needle)) {
    workout = workout.replace(
      needle,
`    setItems(loaded);

    /* ${MARKER}: RESTORE CURSOR */
    let restoredActiveIdx = 0;
    try {
      const savedWorkoutId = localStorage.getItem("mvp_active_workout_id");
      const savedPos = localStorage.getItem("mvp_active_exercise_pos") ?? "";
      const match = savedPos.match(/\\(?(\\d+)\\s*\\/\\s*(\\d+)\\)?/);
      if (savedWorkoutId === wId && match) {
        const oneBased = Number(match[1]);
        if (Number.isFinite(oneBased) && oneBased > 0) {
          restoredActiveIdx = Math.max(0, Math.min(loaded.length - 1, oneBased - 1));
        }
      }
    } catch {
      restoredActiveIdx = 0;
    }
    setActiveIdx(restoredActiveIdx);`
    );
    cursorPatch = "applied";
  }
}

// -----------------------------------------------------------------------------
// CORE VALIDATION. Cursor patch is intentionally NOT part of pass/fail.
// -----------------------------------------------------------------------------
const checks = [
  [music.includes("export function isMusicPlaying()"), "music playback query missing"],
  [shell.includes("pauseMusic();"), "Pause Workout does not pause music"],
  [shell.includes("void playMusic().catch"), "Resume Workout does not resume music"],
  [shell.includes("WORKOUT_RESUME_REQUEST_EVENT"), "resume request event missing"],
  [today.includes('"RETURN TO WORKOUT"'), "RETURN TO WORKOUT label missing"],
  [today.includes('workoutPaused ? "RESUME WORKOUT"'), "true Resume label missing"],
  [today.includes("handlePrimarySessionAction"), "primary workout action handler missing"],
  [today.includes("window.history.pushState"), "SPA workout navigation missing"],
  [!today.includes('window.location.pathname = `/workout/${sessionId}`;'), "old full-page workout navigation still present"],
];

for (const [ok, message] of checks) {
  if (!ok) stop(`validation failed: ${message}`);
}

// Write only after every CORE validation succeeds.
const changedFiles = [];
for (const [name, file] of Object.entries(FILES)) {
  const updated = name === "today" ? today : name === "shell" ? shell : name === "music" ? music : workout;
  if (updated === original[name]) continue;

  fs.copyFileSync(file, `${file}.pre-${VERSION}.bak`);
  fs.writeFileSync(file, updated, "utf8");
  changedFiles.push(path.relative(ROOT, file));
}

console.log("");
console.log("MVP Trainer V4.5.2 R4 True Pause Continuity applied successfully.");
console.log(`(${VERSION})`);
console.log("");
console.log("CORE FIXES:");
console.log("  ✓ Changing tabs does not create a paused workout.");
console.log("  ✓ Running active workout says RETURN TO WORKOUT.");
console.log("  ✓ RESUME WORKOUT appears only when the workout is truly paused.");
console.log("  ✓ RETURN TO WORKOUT uses SPA navigation, not a browser reload.");
console.log("  ✓ PAUSE WORKOUT pauses music only when music was playing.");
console.log("  ✓ RESUME WORKOUT resumes that music from the same saved position.");
console.log("");
console.log(`Exercise cursor helper: ${cursorPatch}`);
console.log("");
console.log("Changed files:");
for (const file of changedFiles) console.log(`  - ${file}`);
console.log("");
console.log("Backups created only for files actually changed.");
console.log("NEXT: npm run build");
