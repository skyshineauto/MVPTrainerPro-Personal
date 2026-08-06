import {
  ALERT_SOUND_TYPES,
  getAlertSoundSignedUrl,
  type AlertSoundType,
} from "./alertSoundStorage";
import { playWithMusicDucked } from "./musicPlayer";

type AlertPlaybackSource = "uploaded" | "built_in";

type AlertTone = {
  frequency: number;
  offset: number;
  duration: number;
  type: OscillatorType;
  gain?: number;
};

const ALERT_PLAYBACK_TIMEOUT_MS = 30_000;
const WORKOUT_START_DEDUPE_MS = 2_500;

let sharedAudioContext: AudioContext | null = null;
let audioUnlockPromise: Promise<void> | null = null;
let activeAlertAudio: HTMLAudioElement | null = null;
let activeBufferSource: AudioBufferSourceNode | null = null;
let lastWorkoutStartAt = 0;

const decodedBufferCache = new Map<string, AudioBuffer>();
const decodedBufferPromises = new Map<string, Promise<AudioBuffer>>();
const preloadedAlertUrls = new Map<AlertSoundType, string>();
const alertPreloadPromises = new Map<
  AlertSoundType,
  Promise<string | null>
>();
const activeAlertPromises = new Map<
  AlertSoundType,
  Promise<AlertPlaybackSource>
>();

function getAudioContext() {
  if (typeof window === "undefined") return null;

  const AudioContextConstructor =
    window.AudioContext ||
    (window as typeof window & {
      webkitAudioContext?: typeof AudioContext;
    }).webkitAudioContext;

  if (!AudioContextConstructor) return null;

  if (!sharedAudioContext || sharedAudioContext.state === "closed") {
    sharedAudioContext = new AudioContextConstructor();
  }

  return sharedAudioContext;
}

function playSilentUnlockBuffer(context: AudioContext) {
  try {
    const source = context.createBufferSource();
    source.buffer = context.createBuffer(1, 1, 22_050);
    source.connect(context.destination);
    source.start(0);
  } catch {
    // Resuming the context still helps when the silent buffer is blocked.
  }
}

async function ensureAudioUnlocked() {
  const context = getAudioContext();
  if (!context) return;

  if (context.state === "running") {
    playSilentUnlockBuffer(context);
    return;
  }

  if (!audioUnlockPromise) {
    audioUnlockPromise = (async () => {
      try {
        await context.resume();
        playSilentUnlockBuffer(context);
      } finally {
        audioUnlockPromise = null;
      }
    })();
  }

  await audioUnlockPromise;
}

/**
 * Call directly from a user tap/click. This unlocks Web Audio on iPhone and
 * prepares the context for alerts that play after asynchronous session work.
 */
export function primeWorkoutAudio() {
  try {
    const context = getAudioContext();
    if (!context) return;

    playSilentUnlockBuffer(context);

    if (context.state !== "running") {
      void ensureAudioUnlocked().catch((error) => {
        console.warn("Workout audio could not be unlocked.", error);
      });
    }
  } catch (error) {
    console.warn("Workout audio priming failed.", error);
  }
}

function alertPattern(alertType: AlertSoundType): AlertTone[] {
  if (alertType === "workout_start") {
    return [
      {
        frequency: 392,
        offset: 0,
        duration: 0.15,
        type: "triangle",
        gain: 0.2,
      },
      {
        frequency: 523,
        offset: 0.16,
        duration: 0.15,
        type: "triangle",
        gain: 0.22,
      },
      {
        frequency: 659,
        offset: 0.32,
        duration: 0.17,
        type: "triangle",
        gain: 0.24,
      },
      {
        frequency: 784,
        offset: 0.5,
        duration: 0.32,
        type: "sine",
        gain: 0.26,
      },
    ];
  }

  if (alertType === "exercise_complete") {
    return [
      {
        frequency: 660,
        offset: 0,
        duration: 0.17,
        type: "sine",
        gain: 0.2,
      },
      {
        frequency: 880,
        offset: 0.2,
        duration: 0.2,
        type: "sine",
        gain: 0.22,
      },
    ];
  }

  if (alertType === "workout_complete") {
    return [
      {
        frequency: 523,
        offset: 0,
        duration: 0.18,
        type: "sine",
        gain: 0.2,
      },
      {
        frequency: 659,
        offset: 0.2,
        duration: 0.18,
        type: "sine",
        gain: 0.22,
      },
      {
        frequency: 784,
        offset: 0.4,
        duration: 0.3,
        type: "triangle",
        gain: 0.25,
      },
    ];
  }

  return [
    {
      frequency: 880,
      offset: 0,
      duration: 0.18,
      type: "sine",
      gain: 0.22,
    },
    {
      frequency: 880,
      offset: 0.22,
      duration: 0.18,
      type: "sine",
      gain: 0.22,
    },
    {
      frequency: 1046,
      offset: 0.44,
      duration: 0.22,
      type: "square",
      gain: 0.2,
    },
  ];
}

async function playBuiltInAlert(alertType: AlertSoundType) {
  const context = getAudioContext();
  if (!context) {
    throw new Error("Web Audio is unavailable.");
  }

  await ensureAudioUnlocked();

  const tones = alertPattern(alertType);
  const now = context.currentTime + 0.015;
  let longestSeconds = 0;

  for (const tone of tones) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const startAt = now + tone.offset;
    const stopAt = startAt + tone.duration;

    oscillator.type = tone.type;
    oscillator.frequency.setValueAtTime(tone.frequency, startAt);

    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(
      tone.gain ?? 0.2,
      startAt + 0.015
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, stopAt);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(stopAt + 0.03);

    longestSeconds = Math.max(
      longestSeconds,
      tone.offset + tone.duration + 0.06
    );
  }

  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, Math.ceil(longestSeconds * 1000));
  });
}

function vibrationPattern(alertType: AlertSoundType) {
  if (alertType === "workout_start") return [90, 45, 90, 45, 180];
  if (alertType === "workout_complete") {
    return [180, 80, 180, 80, 420];
  }
  if (alertType === "exercise_complete") return [180, 80, 280];
  return [260, 100, 260, 100, 520];
}

async function loadDecodedBuffer(url: string) {
  const cached = decodedBufferCache.get(url);
  if (cached) return cached;

  const existingPromise = decodedBufferPromises.get(url);
  if (existingPromise) return existingPromise;

  const promise = (async () => {
    const context = getAudioContext();
    if (!context) {
      throw new Error("Web Audio is unavailable.");
    }

    const response = await fetch(url, {
      cache: "force-cache",
      credentials: "omit",
    });

    if (!response.ok) {
      throw new Error(
        `Alert sound download failed (${response.status}).`
      );
    }

    const bytes = await response.arrayBuffer();
    const buffer = await context.decodeAudioData(bytes.slice(0));

    decodedBufferCache.set(url, buffer);
    return buffer;
  })();

  decodedBufferPromises.set(url, promise);

  try {
    return await promise;
  } finally {
    decodedBufferPromises.delete(url);
  }
}

function stopActiveUploadedAlert() {
  if (activeBufferSource) {
    try {
      activeBufferSource.stop();
    } catch {
      // The source may already have ended.
    }

    try {
      activeBufferSource.disconnect();
    } catch {
      // Disconnection is best-effort.
    }

    activeBufferSource = null;
  }

  if (activeAlertAudio) {
    activeAlertAudio.pause();
    activeAlertAudio.removeAttribute("src");
    activeAlertAudio.load();
    activeAlertAudio = null;
  }
}

async function playUploadedWithWebAudio(url: string) {
  const context = getAudioContext();
  if (!context) {
    throw new Error("Web Audio is unavailable.");
  }

  await ensureAudioUnlocked();
  const buffer = await loadDecodedBuffer(url);

  stopActiveUploadedAlert();

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let timeoutId = 0;

    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);

      if (activeBufferSource === source) {
        activeBufferSource = null;
      }

      try {
        source.disconnect();
      } catch {
        // Disconnection is best-effort.
      }

      if (error) reject(error);
      else resolve();
    };

    const source = context.createBufferSource();
    activeBufferSource = source;
    source.buffer = buffer;
    source.connect(context.destination);
    source.addEventListener("ended", () => finish(), { once: true });

    timeoutId = window.setTimeout(() => {
      try {
        source.stop();
      } catch {
        // It may already have stopped.
      }

      finish(new Error("Alert sound playback timed out."));
    }, Math.min(
      ALERT_PLAYBACK_TIMEOUT_MS,
      Math.max(2_000, Math.ceil(buffer.duration * 1000) + 1_500)
    ));

    try {
      source.start(0);
    } catch (error) {
      finish(error);
    }
  });
}

async function playUploadedWithHtmlAudio(url: string) {
  stopActiveUploadedAlert();

  const audio = new Audio();
  activeAlertAudio = audio;
  audio.preload = "auto";
  audio.volume = 1;
  audio.src = url;

  await audio.play();

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);

      if (activeAlertAudio === audio) {
        activeAlertAudio = null;
      }
    };

    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();

      if (error) reject(error);
      else resolve();
    };

    const onEnded = () => finish();
    const onError = () =>
      finish(new Error("HTML alert sound playback failed."));

    const timeoutId = window.setTimeout(() => {
      audio.pause();
      finish(new Error("HTML alert sound playback timed out."));
    }, ALERT_PLAYBACK_TIMEOUT_MS);

    audio.addEventListener("ended", onEnded, { once: true });
    audio.addEventListener("error", onError, { once: true });
  });
}

async function resolveAndDecodeAlertUrl(
  alertType: AlertSoundType,
  forceRefresh = false
) {
  if (!forceRefresh) {
    const cachedUrl = preloadedAlertUrls.get(alertType);
    if (cachedUrl && decodedBufferCache.has(cachedUrl)) {
      return cachedUrl;
    }

    const existing = alertPreloadPromises.get(alertType);
    if (existing) return existing;
  }

  const promise = (async () => {
    const signedUrl = await getAlertSoundSignedUrl(alertType);

    if (!signedUrl) {
      preloadedAlertUrls.delete(alertType);
      return null;
    }

    const previousUrl = preloadedAlertUrls.get(alertType);
    if (previousUrl && previousUrl !== signedUrl) {
      decodedBufferCache.delete(previousUrl);
    }

    await loadDecodedBuffer(signedUrl);
    preloadedAlertUrls.set(alertType, signedUrl);
    return signedUrl;
  })();

  alertPreloadPromises.set(alertType, promise);

  try {
    return await promise;
  } finally {
    if (alertPreloadPromises.get(alertType) === promise) {
      alertPreloadPromises.delete(alertType);
    }
  }
}

/**
 * Pre-download and decode one configured sound so later playback begins
 * immediately after asynchronous workout/session work finishes.
 */
export async function preloadWorkoutAlert(
  alertType: AlertSoundType,
  options?: { forceRefresh?: boolean }
) {
  try {
    return Boolean(
      await resolveAndDecodeAlertUrl(
        alertType,
        options?.forceRefresh === true
      )
    );
  } catch (error) {
    console.warn(`Could not preload ${alertType} alert.`, error);
    return false;
  }
}

/** Preload every configured workout sound in the background. */
export async function preloadWorkoutAlerts() {
  await Promise.all(
    ALERT_SOUND_TYPES.map((alertType) =>
      preloadWorkoutAlert(alertType)
    )
  );
}

/**
 * Use from the Start Workout tap before database work begins. This preserves
 * the user gesture, unlocks Web Audio, and fully prepares the start sound.
 */
export async function prepareWorkoutStartAlert() {
  primeWorkoutAudio();

  try {
    await ensureAudioUnlocked();
  } catch (error) {
    console.warn("Workout Start audio could not be unlocked.", error);
  }

  return preloadWorkoutAlert("workout_start");
}

async function playSelectedAlert(
  alertType: AlertSoundType
): Promise<AlertPlaybackSource> {
  try {
    const signedUrl = await resolveAndDecodeAlertUrl(alertType);

    if (signedUrl) {
      try {
        await playUploadedWithWebAudio(signedUrl);
        return "uploaded";
      } catch (webAudioError) {
        console.warn(
          `${alertType} Web Audio playback failed; trying HTML audio.`,
          webAudioError
        );

        try {
          await playUploadedWithHtmlAudio(signedUrl);
          return "uploaded";
        } catch (htmlAudioError) {
          console.warn(
            `${alertType} HTML audio playback also failed.`,
            htmlAudioError
          );
        }
      }
    }
  } catch (error) {
    console.warn(
      `Custom ${alertType} alert failed; using built-in alert.`,
      error
    );
  }

  await playBuiltInAlert(alertType);
  return "built_in";
}

function shouldDedupeWorkoutStart() {
  const now = Date.now();

  if (now - lastWorkoutStartAt < WORKOUT_START_DEDUPE_MS) {
    return true;
  }

  lastWorkoutStartAt = now;
  return false;
}

export async function playWorkoutAlert(
  alertType: AlertSoundType
): Promise<AlertPlaybackSource> {
  primeWorkoutAudio();

  if (
    alertType === "workout_start" &&
    shouldDedupeWorkoutStart()
  ) {
    const active = activeAlertPromises.get(alertType);
    if (active) return active;
    return "built_in";
  }

  const existing = activeAlertPromises.get(alertType);
  if (existing) return existing;

  const playback = (async () => {
    let result: AlertPlaybackSource = "built_in";

    try {
      await playWithMusicDucked(async () => {
        result = await playSelectedAlert(alertType);
      });
    } catch (error) {
      console.error(`${alertType} alert playback failed.`, error);

      try {
        await playBuiltInAlert(alertType);
        result = "built_in";
      } catch (fallbackError) {
        console.error(
          `${alertType} built-in fallback also failed.`,
          fallbackError
        );
      }
    }

    try {
      navigator.vibrate?.(vibrationPattern(alertType));
    } catch {
      // Vibration is optional.
    }

    return result;
  })();

  activeAlertPromises.set(alertType, playback);

  try {
    return await playback;
  } finally {
    if (activeAlertPromises.get(alertType) === playback) {
      activeAlertPromises.delete(alertType);
    }
  }
}

/**
 * Clears cached signed URLs and decoded audio after a sound is replaced or
 * removed. The next preload/playback will fetch the newest configured file.
 */
export function invalidateWorkoutAlertCache(
  alertType?: AlertSoundType
) {
  if (alertType) {
    const url = preloadedAlertUrls.get(alertType);
    if (url) decodedBufferCache.delete(url);

    preloadedAlertUrls.delete(alertType);
    alertPreloadPromises.delete(alertType);
    return;
  }

  decodedBufferCache.clear();
  decodedBufferPromises.clear();
  preloadedAlertUrls.clear();
  alertPreloadPromises.clear();
}
