import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const VERSION = "v4-5-2-true-pause-music-sync-r2";
const MARKER = "MVP_TRAINER_V4_5_2_TRUE_PAUSE_MUSIC_SYNC";
const BACKUP_SUFFIX = ".pre-v4-5-2-true-pause-music-sync.bak";

const FILES = {
  music: path.join(ROOT, "src", "lib", "musicPlayer.ts"),
  shell: path.join(ROOT, "src", "app", "layout", "AppShell.tsx"),
  today: path.join(ROOT, "src", "features", "today", "TodayPage.tsx"),
  workout: path.join(ROOT, "src", "features", "workout", "WorkoutPlayerPage.tsx"),
};

function fail(message) {
  console.error(`MVP Trainer V4.5.2 installer stopped: ${message}`);
  console.error("No source files were changed.");
  process.exit(1);
}

function fileEol(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function adaptEol(value, eol) {
  return value.replace(/\r?\n/g, eol);
}

function replaceOnce(text, search, replacement, label) {
  const eol = fileEol(text);
  const needle = adaptEol(search, eol);
  const value = adaptEol(replacement, eol);
  const first = text.indexOf(needle);
  if (first < 0) fail(`anchor not found: ${label}`);
  if (text.indexOf(needle, first + needle.length) >= 0) {
    fail(`anchor was not unique: ${label}`);
  }
  return text.slice(0, first) + value + text.slice(first + needle.length);
}

function replaceRegexOnce(text, regex, replacement, label) {
  const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
  const matcher = new RegExp(regex.source, flags);
  const matches = [...text.matchAll(matcher)];
  if (matches.length !== 1) fail(`expected one ${label} match, found ${matches.length}`);
  const value = adaptEol(replacement, fileEol(text));
  return text.replace(regex, value);
}

for (const [label, file] of Object.entries(FILES)) {
  if (!fs.existsSync(file)) fail(`${label} file not found: ${path.relative(ROOT, file)}`);
}

const original = Object.fromEntries(
  Object.entries(FILES).map(([key, file]) => [key, fs.readFileSync(file, "utf8")])
);

const marked = Object.entries(original).filter(([, text]) => text.includes(MARKER)).map(([key]) => key);
if (marked.length === Object.keys(FILES).length) {
  console.log("MVP Trainer V4.5.2 True Pause + Music Sync is already installed.");
  process.exit(0);
}
if (marked.length > 0) {
  fail(`partial prior install marker found in: ${marked.join(", ")}`);
}

const updated = { ...original };

/* -------------------------------------------------------------------------- */
/* musicPlayer.ts: preserve the SAME audio element and exact song position.   */
/* -------------------------------------------------------------------------- */

updated.music = replaceOnce(
  updated.music,
`export function pauseMusic() {
  playbackIntent = false;
  ensureAudioElement().pause();
}`,
`/* ${MARKER}: workout pause/music transport bridge */
export function isMusicPlayingNow() {
  const audio = audioElement;
  return Boolean(
    state.currentTrack &&
      (state.playing || (audio && !audio.paused && !audio.ended))
  );
}

export function resumeMusicFromWorkoutPause() {
  playbackIntent = true;
  const audio = ensureAudioElement();
  const track = state.currentTrack;

  if (!track) return Promise.resolve();

  // Normal V4.5.2 path: Resume the SAME media element immediately so
  // desktop/mobile keep the exact timestamp, queue, DSP graph, and user gesture.
  if (audio.src && audio.dataset.trackId === track.id) {
    const context = getAudioContext();
    const contextResume =
      context?.state === "suspended"
        ? context.resume().catch(() => undefined)
        : Promise.resolve();

    let playback: Promise<void>;
    try {
      playback = audio.play();
    } catch (error) {
      return Promise.reject(error);
    }

    return Promise.all([contextResume, playback]).then(() => {
      if (mediaSourceConnected) {
        applyProcessingSettings();
        startLevelMeter();
      }
    });
  }

  // Recovery only. This should not be needed during normal SPA navigation,
  // but it preserves the saved track/time if the media source was lost.
  return playMusic();
}

export function pauseMusic() {
  playbackIntent = false;
  ensureAudioElement().pause();
}`,
  "music pause transport"
);

/* -------------------------------------------------------------------------- */
/* AppShell.tsx: ONLY the real Pause Workout control pauses workout + music.  */
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
  "AppShell music import"
);

updated.shell = replaceOnce(
  updated.shell,
`  activeExerciseName: "mvp_active_exercise_name",
  activeExercisePos: "mvp_active_exercise_pos",
};`,
`  activeExerciseName: "mvp_active_exercise_name",
  activeExercisePos: "mvp_active_exercise_pos",
  activeWorkoutExerciseId: "mvp_active_workout_exercise_id",
  activeExerciseIndex: "mvp_active_exercise_index",
  resumeMusicAfterPause: "mvp_resume_music_after_workout_pause",
};`,
  "AppShell local-storage keys"
);

updated.shell = replaceOnce(
  updated.shell,
`const END_WORKOUT_REQUEST_EVENT = "mvp:end-workout-request";`,
`const END_WORKOUT_REQUEST_EVENT = "mvp:end-workout-request";
/* ${MARKER}: navigation is not a pause; only an explicit workout pause is. */
const RESUME_WORKOUT_REQUEST_EVENT = "mvp:resume-workout-request";
const WORKOUT_PAUSE_CHANGED_EVENT = "mvp:workout-pause-changed";`,
  "AppShell pause events"
);

updated.shell = replaceRegexOnce(
  updated.shell,
  /  const onTogglePause = async \(\) => \{[\s\S]*?\n  \};\n\n  async function startSession/,
`  const onTogglePause = async () => {
    if (hud.mode !== "active") return;

    const paused = lsGet(LS.isPaused) === "true";

    if (!paused) {
      const musicWasPlaying = isMusicPlayingNow();
      lsSet(LS.resumeMusicAfterPause, musicWasPlaying ? "true" : "false");

      // A real PAUSE WORKOUT means pause both the training clock and music.
      // pauseMusic() does not reset the track or currentTime.
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

    // Start playback before any database await. This keeps the Resume click
    // directly attached to the browser user gesture on both mobile and desktop.
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
      // TodayPage only sends this request for a genuinely paused workout.
      if (lsGet(LS.isPaused) === "true") void onTogglePause();
    };
    window.addEventListener(RESUME_WORKOUT_REQUEST_EVENT, handler as EventListener);
    return () =>
      window.removeEventListener(RESUME_WORKOUT_REQUEST_EVENT, handler as EventListener);
  }, [hud]);

  async function startSession`,
  "AppShell onTogglePause"
);

/* -------------------------------------------------------------------------- */
/* TodayPage.tsx: active != paused. Return and Resume are different actions.   */
/* -------------------------------------------------------------------------- */

updated.today = replaceOnce(
  updated.today,
`import icoCalves from "../../assets/muscles.png";`,
`import icoCalves from "../../assets/muscles.png";

/* ${MARKER}: true workout pause state */
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
}`,
  "TodayPage helper insertion"
);

updated.today = replaceOnce(
  updated.today,
`export function TodayPage() {`,
`export function TodayPage() {
  const [workoutPaused, setWorkoutPaused] = useState(readWorkoutPaused);`,
  "TodayPage component state"
);

updated.today = replaceOnce(
  updated.today,
`  useEffect(() => {
    void load();
  }, []);`,
`  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const syncPauseState = () => setWorkoutPaused(readWorkoutPaused());
    syncPauseState();
    window.addEventListener(WORKOUT_PAUSE_CHANGED_EVENT, syncPauseState as EventListener);
    window.addEventListener("storage", syncPauseState);
    return () => {
      window.removeEventListener(WORKOUT_PAUSE_CHANGED_EVENT, syncPauseState as EventListener);
      window.removeEventListener("storage", syncPauseState);
    };
  }, []);`,
  "TodayPage pause-state synchronization"
);

updated.today = replaceOnce(
  updated.today,
`  function openSession(sessionId: string) {
    window.location.pathname = \`/workout/\${sessionId}\`;
  }`,
`  function openSession(sessionId: string) {
    // Return to the live workout without reloading the app or audio engine.
    navigateInApp(\`/workout/\${sessionId}\`);
  }`,
  "TodayPage openSession"
);

updated.today = replaceOnce(
  updated.today,
`<button type="button" onClick={() => (window.location.pathname = "/coach")}>OPEN COACH</button>`,
`<button type="button" onClick={() => navigateInApp("/coach")}>OPEN COACH</button>`,
  "TodayPage Coach navigation"
);

updated.today = replaceOnce(
  updated.today,
`<div className={\`trp-readiness is-\${primaryReadiness.tone}\`}><i />{activeSessionId ? "IN PROGRESS" : primaryReadiness.label}</div>`,
`<div className={\`trp-readiness is-\${primaryReadiness.tone}\`}><i />{activeSessionId ? (workoutPaused ? "PAUSED" : "IN PROGRESS") : primaryReadiness.label}</div>`,
  "TodayPage active status"
);

updated.today = replaceOnce(
  updated.today,
`                onClick={() => {
                  const id = activeSessionId ?? nextSession?.id;
                  if (id) openSession(id);
                }}`,
`                onClick={() => {
                  if (activeSessionId && workoutPaused) {
                    window.dispatchEvent(new Event(RESUME_WORKOUT_REQUEST_EVENT));
                    return;
                  }
                  const id = activeSessionId ?? nextSession?.id;
                  if (id) openSession(id);
                }}`,
  "TodayPage primary action"
);

updated.today = replaceOnce(
  updated.today,
`<span aria-hidden>▶</span>{activeSessionId ? "RESUME WORKOUT" : "START WORKOUT"}`,
`<span aria-hidden>▶</span>{activeSessionId ? (workoutPaused ? "RESUME WORKOUT" : "RETURN TO WORKOUT") : "START WORKOUT"}`,
  "TodayPage button label"
);

/* -------------------------------------------------------------------------- */
/* WorkoutPlayerPage.tsx: keep exact exercise context and remove hard reloads. */
/* -------------------------------------------------------------------------- */

updated.workout = replaceOnce(
  updated.workout,
`const END_WORKOUT_REQUEST_EVENT = "mvp:end-workout-request";
const EDIT_RESULTS_BATCH_SIZE_DESKTOP = 6;`,
`const END_WORKOUT_REQUEST_EVENT = "mvp:end-workout-request";
/* ${MARKER}: preserve the live workout and audio engine across app navigation. */
function navigateInApp(to: string) {
  const next = to.length > 1 && to.endsWith("/") ? to.slice(0, -1) : to;
  if (window.location.pathname === next) return;
  window.history.pushState({}, "", next);
  window.dispatchEvent(new Event("popstate"));
}
const EDIT_RESULTS_BATCH_SIZE_DESKTOP = 6;`,
  "WorkoutPlayer SPA navigation helper"
);

updated.workout = replaceOnce(
  updated.workout,
`    window.location.pathname = \`/library/\${exId}\`;`,
`    navigateInApp(\`/library/\${exId}\`);`,
  "WorkoutPlayer media navigation"
);

updated.workout = replaceOnce(
  updated.workout,
`            <button className="tr-btn" onClick={() => (window.location.pathname = "/")}>`,
`            <button className="tr-btn" onClick={() => navigateInApp("/")}>`,
  "WorkoutPlayer back navigation"
);

updated.workout = replaceOnce(
  updated.workout,
`          onCancel={() => (window.location.pathname = "/")}`,
`          onCancel={() => navigateInApp("/")}`,
  "WorkoutPlayer preworkout cancel navigation"
);

updated.workout = replaceOnce(
  updated.workout,
`                            onClick={() => (window.location.pathname = \`/library/\${exerciseId}\`)}`,
`                            onClick={() => navigateInApp(\`/library/\${exerciseId}\`)}`,
  "WorkoutPlayer exercise-history navigation"
);

updated.workout = replaceOnce(
  updated.workout,
`      localStorage.setItem("mvp_active_exercise_name", String(name));
      localStorage.setItem("mvp_active_exercise_pos", pos ? \`(\${pos})\` : "");`,
`      localStorage.setItem("mvp_active_exercise_name", String(name));
      localStorage.setItem("mvp_active_exercise_pos", pos ? \`(\${pos})\` : "");
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
  "WorkoutPlayer exercise persistence dependencies"
);

updated.workout = replaceOnce(
  updated.workout,
`    setItems(loaded);
    setActiveIdx(0);

    const exIds = Array.from(new Set(loaded.map((r) => r.exercise_id).filter(Boolean)));`,
`    setItems(loaded);

    // Returning from Music/Library/Progress must reopen the exact exercise.
    // The active working set then restores naturally from the already-saved
    // completed-set data for that workout exercise.
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
      /* local storage unavailable */
    }
    setActiveIdx(restoredIndex);

    const exIds = Array.from(new Set(loaded.map((r) => r.exercise_id).filter(Boolean)));`,
  "WorkoutPlayer exercise restoration"
);

/* -------------------------------------------------------------------------- */
/* Postflight validation before writing ANY file.                             */
/* -------------------------------------------------------------------------- */

const assertions = [
  [updated.music.includes("resumeMusicFromWorkoutPause"), "music resume bridge missing"],
  [updated.shell.includes("resumeMusicAfterPause"), "AppShell music-resume flag missing"],
  [updated.shell.includes("if (musicWasPlaying) pauseMusic();"), "Pause Workout does not pause music"],
  [updated.today.includes('"RETURN TO WORKOUT"'), "TodayPage Return label missing"],
  [updated.today.includes('"RESUME WORKOUT"'), "TodayPage Resume label missing"],
  [updated.today.includes("navigateInApp(`/workout/${sessionId}`)"), "TodayPage still lacks SPA workout return"],
  [!updated.today.includes("window.location.pathname = `/workout/${sessionId}`"), "TodayPage hard workout reload remains"],
  [updated.workout.includes("mvp_active_workout_exercise_id"), "exercise row persistence missing"],
  [updated.workout.includes("setActiveIdx(restoredIndex);"), "exercise restoration missing"],
  [!updated.workout.includes('window.location.pathname = "/";'), "WorkoutPlayer hard root reload remains"],
];

for (const [ok, message] of assertions) {
  if (!ok) fail(message);
}

for (const [key, text] of Object.entries(updated)) {
  if (!text.includes(MARKER)) fail(`${key} postflight marker missing`);
}

/* Back up and write only after every transform/postflight succeeds. */
for (const [key, file] of Object.entries(FILES)) {
  fs.copyFileSync(file, `${file}${BACKUP_SUFFIX}`);
}
for (const [key, file] of Object.entries(FILES)) {
  fs.writeFileSync(file, updated[key], "utf8");
}

console.log("MVP Trainer V4.5.2 True Pause + Music Sync applied successfully.");
console.log(`(${VERSION})`);
console.log("");
console.log("Behavior installed:");
console.log("  • Changing app tabs does NOT pause the workout.");
console.log("  • Active workout shows RETURN TO WORKOUT unless manually paused.");
console.log("  • PAUSE WORKOUT pauses workout time + music at the exact song position.");
console.log("  • RESUME WORKOUT resumes workout + music from that exact song position.");
console.log("  • Returning to a workout restores the exact active exercise.");
console.log("  • Workout/Today internal navigation no longer hard-reloads the app.");
console.log("");
console.log("Backups created beside all four updated source files.");
console.log("NEXT: npm run build");
