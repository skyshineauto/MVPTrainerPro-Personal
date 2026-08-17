import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MARKER = "MVP_TRAINER_V4_5_2_TRUE_PAUSE_CONTINUITY";

const files = {
  routes: path.join(ROOT, "src", "app", "routes.tsx"),
  today: path.join(ROOT, "src", "features", "today", "TodayPage.tsx"),
  shell: path.join(ROOT, "src", "app", "layout", "AppShell.tsx"),
  workout: path.join(ROOT, "src", "features", "workout", "WorkoutPlayerPage.tsx"),
  music: path.join(ROOT, "src", "lib", "musicPlayer.ts"),
};

function fail(message) {
  console.error(`MVP Trainer V4.5.2 installer stopped: ${message}`);
  console.error("No source files were written.");
  process.exit(1);
}

for (const [name, file] of Object.entries(files)) {
  if (!fs.existsSync(file)) fail(`${name} file not found: ${path.relative(ROOT, file)}`);
}

const original = Object.fromEntries(
  Object.entries(files).map(([name, file]) => [name, fs.readFileSync(file, "utf8")])
);

if (
  original.today.includes(MARKER) &&
  original.shell.includes(MARKER) &&
  original.workout.includes(MARKER) &&
  original.music.includes(MARKER)
) {
  console.log("MVP Trainer V4.5.2 True Pause Continuity is already installed.");
  process.exit(0);
}

let routes = original.routes;
let today = original.today;
let shell = original.shell;
let workout = original.workout;
let music = original.music;

function replaceExact(text, from, to, label, required = true) {
  if (text.includes(to)) return text;
  const count = text.split(from).length - 1;
  if (count === 0 && !required) return text;
  if (count !== 1) fail(`${label}: expected 1 match, found ${count}.`);
  return text.replace(from, to);
}

// -----------------------------------------------------------------------------
// 1) ROUTES: eliminate full-browser reload navigation.
// -----------------------------------------------------------------------------
if (routes.includes("window.location.pathname = to;")) {
  routes = replaceExact(
    routes,
`const goTo = (to: string) => {
  window.location.pathname = to;
};`,
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
// 2) MUSIC PLAYER: tiny non-reactive playback-state query.
//    Avoids subscribing the whole AppShell to music time updates.
// -----------------------------------------------------------------------------
if (!music.includes("export function isMusicPlaying()")) {
  music = replaceExact(
    music,
`export function pauseMusic() {
  playbackIntent = false;
  ensureAudioElement().pause();
}`,
`/* ${MARKER}
 * Workout controls query playback state without subscribing AppShell to
 * high-frequency music-player updates.
 */
export function isMusicPlaying() {
  const audio = audioElement;
  return Boolean(
    state.playing ||
    (audio && !audio.paused && !audio.ended && Boolean(audio.src))
  );
}

export function pauseMusic() {
  playbackIntent = false;
  ensureAudioElement().pause();
}`,
    "music playback state export"
  );
}

// -----------------------------------------------------------------------------
// 3) APPSHELL: true manual pause semantics + music coupling.
// -----------------------------------------------------------------------------
if (!shell.includes(`from "../../lib/musicPlayer";`)) {
  shell = replaceExact(
    shell,
`import { MusicMiniPlayer } from "../../features/music/MusicMiniPlayer";`,
`import { MusicMiniPlayer } from "../../features/music/MusicMiniPlayer";
import { isMusicPlaying, pauseMusic, playMusic } from "../../lib/musicPlayer";`,
    "AppShell music imports"
  );
}

if (!shell.includes('musicWasPlayingOnPause: "mvp_music_was_playing_on_workout_pause"')) {
  shell = replaceExact(
    shell,
`  activeExercisePos: "mvp_active_exercise_pos",
};`,
`  activeExercisePos: "mvp_active_exercise_pos",
  musicWasPlayingOnPause: "mvp_music_was_playing_on_workout_pause",
};`,
    "AppShell pause/music storage key"
  );
}

if (!shell.includes('const WORKOUT_PAUSE_STATE_EVENT = "mvp:workout-pause-state";')) {
  shell = replaceExact(
    shell,
`const END_WORKOUT_REQUEST_EVENT = "mvp:end-workout-request";`,
`const END_WORKOUT_REQUEST_EVENT = "mvp:end-workout-request";
const WORKOUT_PAUSE_STATE_EVENT = "mvp:workout-pause-state";`,
    "AppShell pause-state event"
  );
}

if (!shell.includes(`/* ${MARKER} */`)) {
  shell = replaceExact(
    shell,
`  const onTogglePause = async () => {
    if (hud.mode !== "active") return;

    const paused = lsGet(LS.isPaused) === "true";

    if (!paused) {
      lsSet(LS.isPaused, "true");
      lsSet(LS.pausedAt, new Date().toISOString());
      setHud({ ...hud, isPaused: true });
      return;
    }

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

    const active = await resolveActiveWorkoutDbFirst();
    if (active?.sessionId) navigate(\`/workout/\${active.sessionId}\`);
  };`,
`  /* ${MARKER} */
  const onTogglePause = async () => {
    if (hud.mode !== "active") return;

    const paused = lsGet(LS.isPaused) === "true";

    // ONLY this explicit button press is allowed to create a paused workout.
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

    // Start this directly from the Resume button gesture. This matters on mobile.
    if (shouldResumeMusic) {
      void playMusic().catch((error) => {
        console.warn("Could not resume workout music.", error);
      });
    }
    lsDel(LS.musicWasPlayingOnPause);

    const active = await resolveActiveWorkoutDbFirst();
    if (active?.sessionId) navigate(\`/workout/\${active.sessionId}\`);
  };`,
    "AppShell true pause handler"
  );
}

// -----------------------------------------------------------------------------
// 4) TODAY PAGE: active workout is RETURN, not RESUME, unless actually paused.
//    Uses SPA navigation so returning does not tear down live audio.
// -----------------------------------------------------------------------------
if (!today.includes(`/* ${MARKER} */`)) {
  today = replaceExact(
    today,
`export function TodayPage() {`,
`export function TodayPage({ navigate }: { navigate?: (to: string) => void } = {}) {
  /* ${MARKER} */`,
    "TodayPage navigate prop"
  );
}

if (!today.includes("const [workoutPaused, setWorkoutPaused]")) {
  today = replaceExact(
    today,
`  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [referenceToday, setReferenceToday] = useState(() => {`,
`  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [workoutPaused, setWorkoutPaused] = useState(() => {
    try {
      return localStorage.getItem("mvp_is_paused") === "true";
    } catch {
      return false;
    }
  });
  const [referenceToday, setReferenceToday] = useState(() => {`,
    "TodayPage pause state"
  );
}

if (!today.includes('window.addEventListener("mvp:workout-pause-state", syncPauseState')) {
  today = replaceExact(
    today,
`  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {`,
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

  useEffect(() => {`,
    "TodayPage pause-state synchronization"
  );
}

today = replaceExact(
  today,
`  function openSession(sessionId: string) {
    window.location.pathname = \`/workout/\${sessionId}\`;
  }`,
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
  "TodayPage session SPA navigation"
);

today = today.replace(
  `onClick={() => (window.location.pathname = "/coach")}`,
  `onClick={() => goTo("/coach")}`
);

today = today.replace(
  `{activeSessionId ? "IN PROGRESS" : primaryReadiness.label}`,
  `{activeSessionId ? (workoutPaused ? "PAUSED" : "IN PROGRESS") : primaryReadiness.label}`
);

today = today.replace(
  `<span aria-hidden>▶</span>{activeSessionId ? "RESUME WORKOUT" : "START WORKOUT"}`,
  `<span aria-hidden>▶</span>{activeSessionId ? (workoutPaused ? "RESUME WORKOUT" : "RETURN TO WORKOUT") : "START WORKOUT"}`
);

// -----------------------------------------------------------------------------
// 5) WORKOUT PLAYER: no internal hard reloads + restore exact exercise cursor.
// -----------------------------------------------------------------------------
if (!workout.includes("function navigateWithinTrainer")) {
  workout = replaceExact(
    workout,
`function MediaOrFallback({ item, exerciseId }: { item: any; exerciseId?: string }) {`,
`function navigateWithinTrainer(to: string) {
  const next = to.length > 1 && to.endsWith("/") ? to.slice(0, -1) : to;
  if (window.location.pathname === next) return;
  window.history.pushState({}, "", next);
  window.dispatchEvent(new Event("popstate"));
}

function MediaOrFallback({ item, exerciseId }: { item: any; exerciseId?: string }) {`,
    "WorkoutPlayer SPA helper"
  );
}

workout = workout.replace(
  `window.location.pathname = \`/library/\${exId}\`;`,
  `navigateWithinTrainer(\`/library/\${exId}\`);`
);
workout = workout.replace(
  `onClick={() => (window.location.pathname = "/")}`,
  `onClick={() => navigateWithinTrainer("/")}`
);
workout = workout.replace(
  `onCancel={() => (window.location.pathname = "/")}`,
  `onCancel={() => navigateWithinTrainer("/")}`
);
workout = workout.replace(
  `onClick={() => (window.location.pathname = \`/library/\${exerciseId}\`)}`,
  `onClick={() => navigateWithinTrainer(\`/library/\${exerciseId}\`)}`
);

if (!workout.includes("WORKOUT_CURSOR_STORAGE_PREFIX")) {
  workout = replaceExact(
    workout,
`type WorkoutExerciseRow = {
  id: string;
  workout_id: string;
  exercise_id: string;
  order_index: number;
  prescription_snapshot: any;
  completed_at?: string | null;
  pain?: number | null;
  difficulty?: "too_easy" | "just_right" | "too_hard" | null;
  exercise?: any;
};

type PreviousSetRow = {`,
`type WorkoutExerciseRow = {
  id: string;
  workout_id: string;
  exercise_id: string;
  order_index: number;
  prescription_snapshot: any;
  completed_at?: string | null;
  pain?: number | null;
  difficulty?: "too_easy" | "just_right" | "too_hard" | null;
  exercise?: any;
};

const WORKOUT_CURSOR_STORAGE_PREFIX = "mvp_workout_cursor_v1:";

function readStoredWorkoutCursorIndex(
  workoutId: string,
  items: WorkoutExerciseRow[]
) {
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
      const exercise = items.findIndex((item) => item.exercise_id === saved.exerciseId);
      if (exercise >= 0) return exercise;
    }

    const index = Number(saved.index);
    if (Number.isFinite(index)) {
      return Math.max(0, Math.min(items.length - 1, Math.floor(index)));
    }
  } catch {
    // Cursor persistence is optional.
  }

  return 0;
}

type PreviousSetRow = {`,
    "WorkoutPlayer cursor helpers"
  );
}

if (!workout.includes("workoutExerciseId: current?.id ?? null")) {
  workout = replaceExact(
    workout,
`      localStorage.setItem("mvp_active_exercise_name", String(name));
      localStorage.setItem("mvp_active_exercise_pos", pos ? \`(\${pos})\` : "");
    } catch {}
  }, [sessionId, workoutId, current?.exercise?.name, current?.exercise_id, activeIdx, items.length]);`,
`      localStorage.setItem("mvp_active_exercise_name", String(name));
      localStorage.setItem("mvp_active_exercise_pos", pos ? \`(\${pos})\` : "");

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
      }
    } catch {}
  }, [sessionId, workoutId, current?.id, current?.exercise?.name, current?.exercise_id, activeIdx, items.length]);`,
    "WorkoutPlayer cursor persistence"
  );
}

workout = replaceExact(
  workout,
`    setItems(loaded);
    setActiveIdx(0);

    const exIds = Array.from(new Set(loaded.map((r) => r.exercise_id).filter(Boolean)));`,
`    setItems(loaded);
    setActiveIdx(readStoredWorkoutCursorIndex(wId, loaded));

    const exIds = Array.from(new Set(loaded.map((r) => r.exercise_id).filter(Boolean)));`,
  "WorkoutPlayer cursor restoration"
);

if (!workout.includes(MARKER)) {
  workout = workout.replace(
    `export function WorkoutPlayerPage({ params }: any) {`,
    `/* ${MARKER} */
export function WorkoutPlayerPage({ params }: any) {`
  );
}

// -----------------------------------------------------------------------------
// Validation before touching disk.
// -----------------------------------------------------------------------------
const validations = [
  [!routes.includes("window.location.pathname = to;"), "routes still contains hard reload helper"],
  [today.includes('workoutPaused ? "RESUME WORKOUT" : "RETURN TO WORKOUT"'), "TodayPage true Resume/Return label missing"],
  [today.includes("window.history.pushState"), "TodayPage SPA navigation missing"],
  [shell.includes("pauseMusic();"), "AppShell does not pause music with workout"],
  [shell.includes("void playMusic().catch"), "AppShell does not resume music with workout"],
  [shell.includes(MARKER), "AppShell marker missing"],
  [music.includes("export function isMusicPlaying()"), "music playback query missing"],
  [workout.includes("readStoredWorkoutCursorIndex(wId, loaded)"), "workout cursor restore missing"],
  [workout.includes("navigateWithinTrainer"), "WorkoutPlayer SPA helper missing"],
  [!workout.includes('window.location.pathname = `/library/${exId}`;'), "WorkoutPlayer media navigation still reloads"],
];

for (const [ok, message] of validations) {
  if (!ok) fail(message);
}

// Back up all source files first. Only write after every transform validates.
for (const [name, file] of Object.entries(files)) {
  const backup = `${file}.pre-v4-5-2-true-pause-continuity.bak`;
  fs.copyFileSync(file, backup);
}

fs.writeFileSync(files.routes, routes, "utf8");
fs.writeFileSync(files.today, today, "utf8");
fs.writeFileSync(files.shell, shell, "utf8");
fs.writeFileSync(files.workout, workout, "utf8");
fs.writeFileSync(files.music, music, "utf8");

console.log("");
console.log("MVP Trainer V4.5.2 True Pause Continuity applied successfully.");
console.log("(v4-5-2-true-pause-continuity-r1)");
console.log("");
console.log("FIXED:");
console.log("  - Tab changes no longer mean workout pause.");
console.log("  - Active running workout says RETURN TO WORKOUT.");
console.log("  - RESUME WORKOUT appears only after manual PAUSE WORKOUT.");
console.log("  - PAUSE WORKOUT pauses music if music was playing.");
console.log("  - RESUME WORKOUT resumes that music from its saved position.");
console.log("  - Workout return navigation stays inside React; no browser reload.");
console.log("  - Exact active exercise is restored when WorkoutPlayer remounts.");
console.log("  - Remaining WorkoutPlayer internal links no longer force reloads.");
console.log("");
console.log("Backups created next to each modified file.");
console.log("NEXT: npm run build");
