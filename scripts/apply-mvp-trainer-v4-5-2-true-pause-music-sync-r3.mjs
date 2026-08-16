import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const VERSION = "v4-5-2-true-pause-music-sync-r3";
const MARKER = "MVP_TRAINER_V4_5_2_TRUE_PAUSE_MUSIC_SYNC_R3";
const BACKUP_SUFFIX = ".pre-v4-5-2-true-pause-music-sync-r3.bak";

const FILES = {
  music: path.join(ROOT, "src", "lib", "musicPlayer.ts"),
  shell: path.join(ROOT, "src", "app", "layout", "AppShell.tsx"),
  today: path.join(ROOT, "src", "features", "today", "TodayPage.tsx"),
  workout: path.join(ROOT, "src", "features", "workout", "WorkoutPlayerPage.tsx"),
};

function fail(message) {
  console.error(`MVP Trainer V4.5.2 R3 installer stopped: ${message}`);
  console.error("No source files were changed.");
  process.exit(1);
}

function eolOf(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function adapt(value, text) {
  return value.replace(/\r?\n/g, eolOf(text));
}

function requireOnce(text, needle, label) {
  const first = text.indexOf(needle);
  if (first < 0) fail(`anchor not found: ${label}`);
  if (text.indexOf(needle, first + needle.length) >= 0) {
    fail(`anchor not unique: ${label}`);
  }
  return first;
}

function replaceOnce(text, rawNeedle, rawReplacement, label) {
  const needle = adapt(rawNeedle, text);
  const replacement = adapt(rawReplacement, text);
  const first = requireOnce(text, needle, label);
  return text.slice(0, first) + replacement + text.slice(first + needle.length);
}

function replaceAllExpected(text, rawNeedle, rawReplacement, expected, label) {
  const needle = adapt(rawNeedle, text);
  const replacement = adapt(rawReplacement, text);
  const parts = text.split(needle);
  const count = parts.length - 1;
  if (count !== expected) fail(`expected ${expected} ${label} match(es), found ${count}`);
  return parts.join(replacement);
}

function insertBeforeOnce(text, rawAnchor, rawInsertion, label) {
  const anchor = adapt(rawAnchor, text);
  const insertion = adapt(rawInsertion, text);
  const first = requireOnce(text, anchor, label);
  return text.slice(0, first) + insertion + text.slice(first);
}

function replaceBetween(text, rawStart, rawEnd, rawReplacement, label) {
  const start = adapt(rawStart, text);
  const end = adapt(rawEnd, text);
  const replacement = adapt(rawReplacement, text);

  const startIndex = requireOnce(text, start, `${label} start`);
  const endIndex = text.indexOf(end, startIndex + start.length);
  if (endIndex < 0) fail(`anchor not found: ${label} end`);

  const secondEnd = text.indexOf(end, endIndex + end.length);
  if (secondEnd >= 0 && text.indexOf(start, startIndex + start.length) < secondEnd) {
    fail(`ambiguous range: ${label}`);
  }

  return text.slice(0, startIndex) + replacement + text.slice(endIndex);
}

for (const [key, file] of Object.entries(FILES)) {
  if (!fs.existsSync(file)) fail(`${key} source not found: ${path.relative(ROOT, file)}`);
}

const original = Object.fromEntries(
  Object.entries(FILES).map(([key, file]) => [key, fs.readFileSync(file, "utf8")])
);

const priorR3 = Object.entries(original).filter(([, value]) => value.includes(MARKER));
if (priorR3.length === Object.keys(FILES).length) {
  console.log("MVP Trainer V4.5.2 R3 is already installed.");
  process.exit(0);
}
if (priorR3.length > 0) {
  fail(`partial R3 install marker found in: ${priorR3.map(([key]) => key).join(", ")}`);
}

const updated = { ...original };

/* -------------------------------------------------------------------------- */
/* MUSIC: expose playback state + resume the SAME track/position.              */
/* -------------------------------------------------------------------------- */

updated.music = insertBeforeOnce(
  updated.music,
`export function pauseMusic() {`,
`/* ${MARKER}: workout/music pause bridge */
export function isMusicPlayingNow() {
  const audio = audioElement;
  return Boolean(
    state.currentTrack &&
      (state.playing || (audio && !audio.paused && !audio.ended))
  );
}

export function resumeMusicFromWorkoutPause() {
  // playMusic() preserves currentTime when the same current track is already
  // loaded. It only restores stored position if the media source had to reload.
  return playMusic();
}

`,
  "music pause function"
);

/* -------------------------------------------------------------------------- */
/* APPSHELL: manual Pause Workout owns workout pause + music pause/resume.     */
/* -------------------------------------------------------------------------- */

updated.shell = replaceOnce(
  updated.shell,
`import { MusicMiniPlayer } from "../../features/music/MusicMiniPlayer";`,
`import { MusicMiniPlayer } from "../../features/music/MusicMiniPlayer";
import {
  isMusicPlayingNow,
  pauseMusic,
  resumeMusicFromWorkoutPause,
} from "../../lib/musicPlayer";`,
  "AppShell MusicMiniPlayer import"
);

updated.shell = replaceOnce(
  updated.shell,
`  activeExercisePos: "mvp_active_exercise_pos",
};`,
`  activeExercisePos: "mvp_active_exercise_pos",
  resumeMusicAfterPause: "mvp_resume_music_after_workout_pause",
};`,
  "AppShell localStorage keys"
);

updated.shell = replaceOnce(
  updated.shell,
`const END_WORKOUT_REQUEST_EVENT = "mvp:end-workout-request";`,
`const END_WORKOUT_REQUEST_EVENT = "mvp:end-workout-request";
/* ${MARKER}: app navigation never pauses training. */
const RESUME_WORKOUT_REQUEST_EVENT = "mvp:resume-workout-request";
const WORKOUT_PAUSE_CHANGED_EVENT = "mvp:workout-pause-changed";`,
  "AppShell event constants"
);

updated.shell = replaceBetween(
  updated.shell,
`  const onTogglePause = async () => {`,
`  async function startSession(sessionId: string) {`,
`  const onTogglePause = async () => {
    if (hud.mode !== "active") return;

    const paused = lsGet(LS.isPaused) === "true";

    if (!paused) {
      const musicWasPlaying = isMusicPlayingNow();
      lsSet(LS.resumeMusicAfterPause, musicWasPlaying ? "true" : "false");

      // ONLY an explicit PAUSE WORKOUT pauses music.
      // Normal Music/Library/Progress/Coach navigation does nothing here.
      if (musicWasPlaying) pauseMusic();

      lsSet(LS.isPaused, "true");
      lsSet(LS.pausedAt, new Date().toISOString());
      setHud({ ...hud, isPaused: true });
      window.dispatchEvent(
        new CustomEvent(WORKOUT_PAUSE_CHANGED_EVENT, { detail: { paused: true } })
      );
      return;
    }

    const pausedAtISO = lsGet(LS.pausedAt);
    const pausedTotal = Number(lsGet(LS.pausedTotal) ?? "0") || 0;
    if (pausedAtISO) {
      const pMs = new Date(pausedAtISO).getTime();
      const add = Math.max(0, Math.floor((Date.now() - pMs) / 1000));
      lsSet(LS.pausedTotal, String(pausedTotal + add));
    }

    const shouldResumeMusic = lsGet(LS.resumeMusicAfterPause) === "true";

    lsSet(LS.isPaused, "false");
    lsDel(LS.pausedAt);
    lsDel(LS.resumeMusicAfterPause);

    setHud({ ...hud, isPaused: false });
    window.dispatchEvent(
      new CustomEvent(WORKOUT_PAUSE_CHANGED_EVENT, { detail: { paused: false } })
    );

    // Fire from the actual Resume click before the database lookup/navigation.
    // This gives mobile browsers the best chance to keep the playback gesture.
    if (shouldResumeMusic) {
      void resumeMusicFromWorkoutPause().catch((error) => {
        console.warn("Workout resumed but music could not auto-resume.", error);
      });
    }

    const active = await resolveActiveWorkoutDbFirst();
    if (active?.sessionId) navigate(\`/workout/\${active.sessionId}\`);
  };

  useEffect(() => {
    const handler = () => {
      if (lsGet(LS.isPaused) === "true") {
        void onTogglePause();
      }
    };

    window.addEventListener(RESUME_WORKOUT_REQUEST_EVENT, handler as EventListener);
    return () =>
      window.removeEventListener(RESUME_WORKOUT_REQUEST_EVENT, handler as EventListener);
  }, [hud]);

`,
  "AppShell onTogglePause"
);

/* -------------------------------------------------------------------------- */
/* TODAY: active session is RETURN, not RESUME, unless truly manually paused. */
/* -------------------------------------------------------------------------- */

updated.today = insertBeforeOnce(
  updated.today,
`type QueueDash = {`,
`/* ${MARKER}: true-pause state + SPA return navigation */
const RESUME_WORKOUT_REQUEST_EVENT = "mvp:resume-workout-request";
const WORKOUT_PAUSE_CHANGED_EVENT = "mvp:workout-pause-changed";

function readWorkoutPaused() {
  try {
    return localStorage.getItem("mvp_is_paused") === "true";
  } catch {
    return false;
  }
}

function navigateInApp(to: string) {
  const next = to.length > 1 && to.endsWith("/") ? to.slice(0, -1) : to;
  if (window.location.pathname === next) return;
  window.history.pushState({}, "", next);
  window.dispatchEvent(new Event("popstate"));
}

`,
  "TodayPage QueueDash"
);

updated.today = replaceOnce(
  updated.today,
`export function TodayPage() {
  const [loading, setLoading] = useState(true);`,
`export function TodayPage() {
  const [workoutPaused, setWorkoutPaused] = useState(readWorkoutPaused);
  const [loading, setLoading] = useState(true);`,
  "TodayPage component state"
);

updated.today = insertBeforeOnce(
  updated.today,
`  const goal = queue?.activeBlock?.goal ? String(queue.activeBlock.goal) : null;`,
`  useEffect(() => {
    const syncPauseState = () => setWorkoutPaused(readWorkoutPaused());

    syncPauseState();
    window.addEventListener(WORKOUT_PAUSE_CHANGED_EVENT, syncPauseState as EventListener);
    window.addEventListener("storage", syncPauseState);

    return () => {
      window.removeEventListener(WORKOUT_PAUSE_CHANGED_EVENT, syncPauseState as EventListener);
      window.removeEventListener("storage", syncPauseState);
    };
  }, []);

`,
  "TodayPage goal state"
);

updated.today = replaceBetween(
  updated.today,
`  function openSession(sessionId: string) {`,
`  return (`,
`  function openSession(sessionId: string) {
    navigateInApp(\`/workout/\${sessionId}\`);
  }

`,
  "TodayPage openSession"
);

updated.today = replaceAllExpected(
  updated.today,
`onClick={() => (window.location.pathname = "/coach")}`,
`onClick={() => navigateInApp("/coach")}`,
  1,
  "TodayPage Coach hard-navigation"
);

updated.today = replaceOnce(
  updated.today,
`{activeSessionId ? "IN PROGRESS" : primaryReadiness.label}`,
`{activeSessionId ? (workoutPaused ? "PAUSED" : "IN PROGRESS") : primaryReadiness.label}`,
  "TodayPage active status label"
);

updated.today = replaceOnce(
  updated.today,
`                  const id = activeSessionId ?? nextSession?.id;
                  if (id) openSession(id);`,
`                  if (activeSessionId && workoutPaused) {
                    window.dispatchEvent(new Event(RESUME_WORKOUT_REQUEST_EVENT));
                    return;
                  }
                  const id = activeSessionId ?? nextSession?.id;
                  if (id) openSession(id);`,
  "TodayPage primary action handler"
);

updated.today = replaceOnce(
  updated.today,
`<span aria-hidden>▶</span>{activeSessionId ? "RESUME WORKOUT" : "START WORKOUT"}`,
`<span aria-hidden>▶</span>{activeSessionId ? (workoutPaused ? "RESUME WORKOUT" : "RETURN TO WORKOUT") : "START WORKOUT"}`,
  "TodayPage primary action label"
);

/* -------------------------------------------------------------------------- */
/* WORKOUT PLAYER: SPA links + exact active exercise restoration.              */
/* -------------------------------------------------------------------------- */

updated.workout = replaceOnce(
  updated.workout,
`const END_WORKOUT_REQUEST_EVENT = "mvp:end-workout-request";
const EDIT_RESULTS_BATCH_SIZE_DESKTOP = 6;`,
`const END_WORKOUT_REQUEST_EVENT = "mvp:end-workout-request";
/* ${MARKER}: internal workout navigation must not reload the audio engine. */
function navigateInApp(to: string) {
  const next = to.length > 1 && to.endsWith("/") ? to.slice(0, -1) : to;
  if (window.location.pathname === next) return;
  window.history.pushState({}, "", next);
  window.dispatchEvent(new Event("popstate"));
}
const EDIT_RESULTS_BATCH_SIZE_DESKTOP = 6;`,
  "WorkoutPlayer constants"
);

updated.workout = replaceAllExpected(
  updated.workout,
`window.location.pathname = \`/library/\${exId}\`;`,
`navigateInApp(\`/library/\${exId}\`);`,
  1,
  "WorkoutPlayer media hard-navigation"
);

updated.workout = replaceAllExpected(
  updated.workout,
`onClick={() => (window.location.pathname = "/")}`,
`onClick={() => navigateInApp("/")}`,
  1,
  "WorkoutPlayer Back hard-navigation"
);

updated.workout = replaceAllExpected(
  updated.workout,
`onCancel={() => (window.location.pathname = "/")}`,
`onCancel={() => navigateInApp("/")}`,
  1,
  "WorkoutPlayer Cancel hard-navigation"
);

updated.workout = replaceAllExpected(
  updated.workout,
`onClick={() => (window.location.pathname = \`/library/\${exerciseId}\`)}`,
`onClick={() => navigateInApp(\`/library/\${exerciseId}\`)}`,
  1,
  "WorkoutPlayer history hard-navigation"
);

updated.workout = replaceOnce(
  updated.workout,
`      localStorage.setItem("mvp_active_exercise_pos", pos ? \`(\${pos})\` : "");`,
`      localStorage.setItem("mvp_active_exercise_pos", pos ? \`(\${pos})\` : "");
      if (current?.id) {
        localStorage.setItem("mvp_active_workout_exercise_id", String(current.id));
      }
      localStorage.setItem("mvp_active_exercise_index", String(activeIdx));`,
  "WorkoutPlayer active exercise persistence"
);

updated.workout = replaceOnce(
  updated.workout,
`  }, [sessionId, workoutId, current?.exercise?.name, current?.exercise_id, activeIdx, items.length]);`,
`  }, [sessionId, workoutId, current?.id, current?.exercise?.name, current?.exercise_id, activeIdx, items.length]);`,
  "WorkoutPlayer active exercise dependency"
);

updated.workout = replaceOnce(
  updated.workout,
`    setItems(loaded);
    setActiveIdx(0);`,
`    setItems(loaded);

    let restoredIndex = 0;
    try {
      const savedWorkoutId = localStorage.getItem("mvp_active_workout_id");
      if (savedWorkoutId === String(wId)) {
        const savedRowId = localStorage.getItem("mvp_active_workout_exercise_id");
        const savedIndex = Number(localStorage.getItem("mvp_active_exercise_index"));

        const rowIndex = savedRowId
          ? loaded.findIndex((row) => String(row.id) === savedRowId)
          : -1;

        if (rowIndex >= 0) {
          restoredIndex = rowIndex;
        } else if (
          Number.isInteger(savedIndex) &&
          savedIndex >= 0 &&
          savedIndex < loaded.length
        ) {
          restoredIndex = savedIndex;
        }
      }
    } catch {
      /* localStorage unavailable */
    }

    setActiveIdx(restoredIndex);`,
  "WorkoutPlayer hydrate active index"
);

/* -------------------------------------------------------------------------- */
/* POSTFLIGHT: validate EVERY intended behavior before writing any source.     */
/* -------------------------------------------------------------------------- */

const checks = [
  [updated.music.includes("export function isMusicPlayingNow()"), "music playback-state export missing"],
  [updated.music.includes("export function resumeMusicFromWorkoutPause()"), "music resume export missing"],

  [updated.shell.includes("if (musicWasPlaying) pauseMusic();"), "Pause Workout music pause missing"],
  [updated.shell.includes("resumeMusicAfterPause"), "music resume intent flag missing"],
  [updated.shell.includes("RESUME_WORKOUT_REQUEST_EVENT"), "resume request bridge missing"],

  [updated.today.includes('"RETURN TO WORKOUT"'), "RETURN TO WORKOUT label missing"],
  [updated.today.includes('"RESUME WORKOUT"'), "RESUME WORKOUT label missing"],
  [updated.today.includes("workoutPaused ? \"PAUSED\" : \"IN PROGRESS\""), "true pause status missing"],
  [!updated.today.includes("window.location.pathname = `/workout/${sessionId}`"), "Today workout hard reload remains"],

  [updated.workout.includes("mvp_active_workout_exercise_id"), "active exercise row persistence missing"],
  [updated.workout.includes("setActiveIdx(restoredIndex);"), "active exercise restore missing"],
  [!updated.workout.includes('onClick={() => (window.location.pathname = "/")}'), "Workout root hard reload remains"],
];

for (const [ok, message] of checks) {
  if (!ok) fail(message);
}

for (const [key, value] of Object.entries(updated)) {
  if (!value.includes(MARKER)) fail(`${key} R3 marker missing`);
}

/* All transforms passed. Create backups, then write. */
for (const file of Object.values(FILES)) {
  fs.copyFileSync(file, `${file}${BACKUP_SUFFIX}`);
}
for (const [key, file] of Object.entries(FILES)) {
  fs.writeFileSync(file, updated[key], "utf8");
}

console.log("MVP Trainer V4.5.2 True Pause + Music Sync R3 applied successfully.");
console.log(`(${VERSION})`);
console.log("");
console.log("Installed behavior:");
console.log("  • Changing app tabs does NOT pause the workout.");
console.log("  • Active/not-paused card says RETURN TO WORKOUT.");
console.log("  • Only PAUSE WORKOUT creates a true paused state.");
console.log("  • PAUSE WORKOUT pauses music at the exact song position.");
console.log("  • RESUME WORKOUT resumes workout + music.");
console.log("  • Returning restores the exact active exercise.");
console.log("  • Workout return/history/media navigation uses SPA navigation.");
console.log("");
console.log("Backups created with suffix:");
console.log(`  ${BACKUP_SUFFIX}`);
console.log("");
console.log("NEXT: npm run build");
