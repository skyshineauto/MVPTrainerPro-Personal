export type MotivationTone =
  | "aggressive"
  | "discipline"
  | "competitive"
  | "persistence"
  | "focus"
  | "comeback"
  | "progression";

export type MotivationHeadline = {
  id: string;
  text: string;
  tones: MotivationTone[];
};

export type MotivationSpeech = {
  id: string;
  text: string;
  tones: MotivationTone[];
};

export type WorkoutMotivationPick = {
  headline: MotivationHeadline;
  speech: MotivationSpeech;
};

const RECENT_HEADLINES_KEY = "mvp_launch_recent_headlines_v1";
const RECENT_SPEECHES_KEY = "mvp_launch_recent_speeches_v1";
const LAST_VIDEO_KEY = "mvp_launch_last_video_v1";
const RECENT_LIMIT = 10;

export const MOTIVATION_HEADLINES: MotivationHeadline[] = [
  { id: "no-excuses", text: "NO EXCUSES", tones: ["aggressive", "discipline"] },
  { id: "outwork-everyone", text: "OUTWORK EVERYONE", tones: ["competitive", "aggressive"] },
  { id: "be-that-mf", text: "BE THAT MF", tones: ["aggressive", "competitive"] },
  { id: "unbroken", text: "UNBROKEN", tones: ["comeback", "persistence"] },
  { id: "get-it-done", text: "GET IT DONE", tones: ["discipline", "focus"] },
  { id: "conquer", text: "CONQUER", tones: ["competitive", "aggressive"] },
  { id: "beast-mode", text: "BEAST MODE", tones: ["aggressive"] },
  { id: "you-vs-you", text: "YOU VS YOU", tones: ["competitive", "progression"] },
  { id: "keep-pushing", text: "KEEP PUSHING", tones: ["persistence"] },
  { id: "unstoppable", text: "UNSTOPPABLE", tones: ["persistence", "aggressive"] },
  { id: "im-going-to-win", text: "I'M GOING TO WIN", tones: ["competitive"] },
  { id: "prove-it", text: "PROVE IT", tones: ["competitive", "progression"] },
  { id: "keep-going", text: "KEEP GOING", tones: ["persistence", "comeback"] },
  { id: "persistence", text: "PERSISTENCE", tones: ["persistence", "discipline"] },
  { id: "committed", text: "COMMITTED", tones: ["discipline"] },
  { id: "shut-up-and-grind", text: "SHUT UP AND GRIND", tones: ["aggressive", "discipline"] },
  { id: "lock-in", text: "LOCK IN", tones: ["focus", "discipline"] },
  { id: "finish-strong", text: "FINISH STRONG", tones: ["persistence", "focus"] },
  { id: "stay-hungry", text: "STAY HUNGRY", tones: ["competitive", "progression"] },
  { id: "earn-it", text: "EARN IT", tones: ["discipline", "competitive"] },
  { id: "no-quit", text: "NO QUIT", tones: ["persistence", "aggressive"] },
  { id: "built-different", text: "BUILT DIFFERENT", tones: ["competitive", "aggressive"] },
  { id: "go-again", text: "GO AGAIN", tones: ["persistence", "progression"] },
  { id: "one-more-rep", text: "ONE MORE REP", tones: ["persistence", "progression"] },
  { id: "make-it-count", text: "MAKE IT COUNT", tones: ["focus", "discipline"] },
  { id: "do-the-work", text: "DO THE WORK", tones: ["discipline", "focus"] },
  { id: "never-coast", text: "NEVER COAST", tones: ["competitive", "discipline"] },
  { id: "all-in", text: "ALL IN", tones: ["focus", "aggressive"] },
  { id: "discipline-wins", text: "DISCIPLINE WINS", tones: ["discipline"] },
  { id: "refuse-to-stop", text: "REFUSE TO STOP", tones: ["persistence", "comeback"] },
  { id: "raise-the-standard", text: "RAISE THE STANDARD", tones: ["progression", "competitive"] },
  { id: "work-until-it-shows", text: "WORK UNTIL IT SHOWS", tones: ["discipline", "persistence"] },
  { id: "nothing-given", text: "NOTHING GIVEN", tones: ["discipline", "competitive"] },
  { id: "stay-relentless", text: "STAY RELENTLESS", tones: ["persistence", "aggressive"] },
  { id: "own-this-session", text: "OWN THIS SESSION", tones: ["focus", "competitive"] },
  { id: "break-your-limit", text: "BREAK YOUR LIMIT", tones: ["progression", "aggressive"] },
  { id: "show-up-strong", text: "SHOW UP STRONG", tones: ["comeback", "discipline"] },
  { id: "not-done-yet", text: "NOT DONE YET", tones: ["persistence", "comeback"] },
  { id: "go-take-it", text: "GO TAKE IT", tones: ["competitive", "aggressive"] },
  { id: "become-more", text: "BECOME MORE", tones: ["progression", "discipline"] },
];

export const MOTIVATION_SPEECHES: MotivationSpeech[] = [
  { id: "showed-up", text: "You showed up. Now make it count.", tones: ["discipline", "focus"] },
  { id: "no-talking", text: "No talking. No waiting. Do the work.", tones: ["aggressive", "discipline"] },
  { id: "someone-stopping", text: "Someone else is stopping. You're just getting started.", tones: ["competitive", "aggressive"] },
  { id: "beat-last-you", text: "Beat the version of you that trained last time.", tones: ["progression", "competitive"] },
  { id: "tired-not-finished", text: "Tired is not finished.", tones: ["persistence", "comeback"] },
  { id: "one-more-set", text: "One more set. One more rep. Keep building.", tones: ["persistence", "progression"] },
  { id: "made-decision", text: "You made the decision. Now finish the work.", tones: ["discipline", "focus"] },
  { id: "not-hoping", text: "Not hoping. Working until it happens.", tones: ["competitive", "discipline"] },
  { id: "work-is-proof", text: "The work is the proof.", tones: ["competitive", "discipline"] },
  { id: "nobody-can-do-set", text: "Nobody can do this set for you.", tones: ["focus", "discipline"] },
  { id: "need-effort", text: "You don't need perfect. You need effort.", tones: ["comeback", "persistence"] },
  { id: "next-rep-progress", text: "The next rep is where progress lives.", tones: ["progression", "focus"] },
  { id: "harder-to-beat", text: "Make today harder to beat tomorrow.", tones: ["progression", "competitive"] },
  { id: "separate-yourself", text: "This is where you separate yourself.", tones: ["competitive", "aggressive"] },
  { id: "came-for-reason", text: "You came here for a reason. Go earn it.", tones: ["discipline", "competitive"] },
  { id: "dont-negotiate", text: "Don't negotiate with the work.", tones: ["discipline", "aggressive"] },
  { id: "finish-started", text: "Finish what you started.", tones: ["persistence", "discipline"] },
  { id: "weight-doesnt-care", text: "The weight doesn't care how you feel. Move it.", tones: ["aggressive", "focus"] },
  { id: "control-own", text: "Control the rep. Own the set.", tones: ["focus", "progression"] },
  { id: "hard-set-buys", text: "Every hard set buys something.", tones: ["progression", "persistence"] },
  { id: "last-standard", text: "Your last session set the standard. Beat it.", tones: ["progression", "competitive"] },
  { id: "win-this-set", text: "Stop thinking about the whole workout. Win this set.", tones: ["focus", "competitive"] },
  { id: "nothing-changes", text: "Nothing changes until you do.", tones: ["discipline", "comeback"] },
  { id: "mind-commits", text: "The body follows what the mind commits to.", tones: ["discipline", "focus"] },
  { id: "your-hour", text: "This is your hour. Use it.", tones: ["focus", "discipline"] },
  { id: "no-wasted-reps", text: "No wasted reps today.", tones: ["focus", "progression"] },
  { id: "stay-sharp", text: "Stay sharp. Stay controlled. Keep moving.", tones: ["focus", "persistence"] },
  { id: "other-side", text: "Progress is waiting on the other side of this set.", tones: ["progression", "persistence"] },
  { id: "already-started", text: "You already started. Now finish strong.", tones: ["persistence", "discipline"] },
  { id: "walk-out-better", text: "Walk out better than you walked in.", tones: ["progression", "focus"] },
  { id: "decide-ending", text: "Walk in like you already decided how this ends.", tones: ["competitive", "aggressive"] },
  { id: "pressure-purpose", text: "Pressure has a purpose. Use it.", tones: ["comeback", "focus"] },
  { id: "quiet-work", text: "Keep the promises you made when nobody was watching.", tones: ["discipline", "persistence"] },
  { id: "stronger-choice", text: "Choose the harder rep. Become the stronger version.", tones: ["progression", "discipline"] },
];

function readRecent(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function saveRecent(key: string, id: string) {
  if (typeof window === "undefined") return;
  try {
    const next = [id, ...readRecent(key).filter((value) => value !== id)].slice(0, RECENT_LIMIT);
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Rotation history is optional.
  }
}

function randomFrom<T>(values: T[]): T {
  return values[Math.floor(Math.random() * values.length)];
}

function pickAvoidingRecent<T extends { id: string }>(values: T[], recentKey: string): T {
  const recent = new Set(readRecent(recentKey));
  const fresh = values.filter((value) => !recent.has(value.id));
  const chosen = randomFrom(fresh.length ? fresh : values);
  saveRecent(recentKey, chosen.id);
  return chosen;
}

export function pickWorkoutMotivation(preferredTone?: MotivationTone): WorkoutMotivationPick {
  const headlinePool = preferredTone
    ? MOTIVATION_HEADLINES.filter((item) => item.tones.includes(preferredTone))
    : MOTIVATION_HEADLINES;

  const headline = pickAvoidingRecent(
    headlinePool.length ? headlinePool : MOTIVATION_HEADLINES,
    RECENT_HEADLINES_KEY
  );

  const matchingSpeeches = MOTIVATION_SPEECHES.filter((speech) =>
    speech.tones.some((tone) => headline.tones.includes(tone))
  );

  const speech = pickAvoidingRecent(
    matchingSpeeches.length ? matchingSpeeches : MOTIVATION_SPEECHES,
    RECENT_SPEECHES_KEY
  );

  return { headline, speech };
}

export function pickMotivationVideo<T extends { id: string }>(videos: T[]): T | null {
  if (!videos.length) return null;

  let lastId = "";
  if (typeof window !== "undefined") {
    try {
      lastId = localStorage.getItem(LAST_VIDEO_KEY) || "";
    } catch {
      lastId = "";
    }
  }

  const pool = videos.length > 1 ? videos.filter((video) => video.id !== lastId) : videos;
  const chosen = randomFrom(pool.length ? pool : videos);

  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(LAST_VIDEO_KEY, chosen.id);
    } catch {
      // Rotation history is optional.
    }
  }

  return chosen;
}
