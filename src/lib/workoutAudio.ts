import {
  ALERT_SOUND_TYPES,
  getAlertSoundSignedUrl,
  type AlertSoundType,
} from "./alertSoundStorage";
import { playWithMusicDucked } from "./musicPlayer";

let sharedAudioContext: AudioContext | null = null;
let activeAlertAudio: HTMLAudioElement | null = null;

const decodedBufferCache = new Map<string, AudioBuffer>();
const decodedBufferPromises = new Map<string, Promise<AudioBuffer>>();
const preloadedAlertUrls = new Map<AlertSoundType, string>();

function getAudioContext() {
  if (typeof window === "undefined") return null;

  const AudioContextConstructor =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;

  if (!AudioContextConstructor) return null;
  if (!sharedAudioContext) sharedAudioContext = new AudioContextConstructor();
  return sharedAudioContext;
}

function playSilentUnlockBuffer(context: AudioContext) {
  try {
    const source = context.createBufferSource();
    source.buffer = context.createBuffer(1, 1, 22050);
    source.connect(context.destination);
    source.start(0);
  } catch {
    // Resuming the context is still useful even if the silent buffer fails.
  }
}

/**
 * Call this directly from a tap/click. It unlocks Web Audio on iPhone so a
 * custom uploaded sound can play later when a timer finishes without another tap.
 */
export function primeWorkoutAudio() {
  try {
    const context = getAudioContext();
    if (!context) return;

    playSilentUnlockBuffer(context);

    if (context.state === "suspended") {
      void context
        .resume()
        .then(() => playSilentUnlockBuffer(context))
        .catch(() => undefined);
    }
  } catch {
    // Audio remains best-effort in browsers with stricter playback policies.
  }
}

function alertPattern(alertType: AlertSoundType) {
  if (alertType === "workout_start") {
    return [
      { frequency: 392, offset: 0, duration: 0.15, type: "triangle" as OscillatorType },
      { frequency: 523, offset: 0.16, duration: 0.15, type: "triangle" as OscillatorType },
      { frequency: 659, offset: 0.32, duration: 0.17, type: "triangle" as OscillatorType },
      { frequency: 784, offset: 0.5, duration: 0.3, type: "sine" as OscillatorType },
    ];
  }

  if (alertType === "exercise_complete") {
    return [
      { frequency: 660, offset: 0, duration: 0.17, type: "sine" as OscillatorType },
      { frequency: 880, offset: 0.2, duration: 0.2, type: "sine" as OscillatorType },
    ];
  }

  if (alertType === "workout_complete") {
    return [
      { frequency: 523, offset: 0, duration: 0.18, type: "sine" as OscillatorType },
      { frequency: 659, offset: 0.2, duration: 0.18, type: "sine" as OscillatorType },
      { frequency: 784, offset: 0.4, duration: 0.28, type: "triangle" as OscillatorType },
    ];
  }

  return [
    { frequency: 880, offset: 0, duration: 0.18, type: "sine" as OscillatorType },
    { frequency: 880, offset: 0.22, duration: 0.18, type: "sine" as OscillatorType },
    { frequency: 1046, offset: 0.44, duration: 0.2, type: "square" as OscillatorType },
  ];
}

async function playBuiltInAlert(alertType: AlertSoundType) {
  const context = getAudioContext();
  if (!context) return;
  if (context.state === "suspended") await context.resume();

  const tones = alertPattern(alertType);
  const now = context.currentTime;
  let longestSeconds = 0;

  for (const tone of tones) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = tone.type;
    oscillator.frequency.setValueAtTime(tone.frequency, now + tone.offset);
    gain.gain.setValueAtTime(0.0001, now + tone.offset);
    gain.gain.exponentialRampToValueAtTime(0.2, now + tone.offset + 0.015);
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      now + tone.offset + tone.duration
    );

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now + tone.offset);
    oscillator.stop(now + tone.offset + tone.duration + 0.03);
    longestSeconds = Math.max(longestSeconds, tone.offset + tone.duration + 0.05);
  }

  await new Promise<void>((resolve) =>
    window.setTimeout(resolve, Math.ceil(longestSeconds * 1000))
  );
}

function vibrationPattern(alertType: AlertSoundType) {
  if (alertType === "workout_start") return [90, 45, 90, 45, 180];
  if (alertType === "workout_complete") return [180, 80, 180, 80, 420];
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
    if (!context) throw new Error("Web Audio is unavailable.");

    const response = await fetch(url, { cache: "force-cache" });
    if (!response.ok) {
      throw new Error(`Alert sound download failed (${response.status}).`);
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

async function playUploadedWithWebAudio(url: string) {
  const context = getAudioContext();
  if (!context) throw new Error("Web Audio is unavailable.");

  if (context.state === "suspended") await context.resume();

  const buffer = await loadDecodedBuffer(url);
  await new Promise<void>((resolve, reject) => {
    try {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.addEventListener("ended", () => resolve(), { once: true });
      source.start(0);
    } catch (error) {
      reject(error);
    }
  });
}

async function playUploadedWithHtmlAudio(url: string) {
  if (activeAlertAudio) {
    activeAlertAudio.pause();
    activeAlertAudio.src = "";
  }

  const audio = new Audio(url);
  activeAlertAudio = audio;
  audio.preload = "auto";
  audio.volume = 1;

  await audio.play();
  await new Promise<void>((resolve, reject) => {
    audio.addEventListener("ended", () => resolve(), { once: true });
    audio.addEventListener("error", () => reject(new Error("Alert sound playback failed.")), {
      once: true,
    });
  });
}

/** Pre-download and decode one custom sound so playback is immediate. */
export async function preloadWorkoutAlert(alertType: AlertSoundType) {
  try {
    const signedUrl = await getAlertSoundSignedUrl(alertType);
    if (!signedUrl) {
      preloadedAlertUrls.delete(alertType);
      return false;
    }
    await loadDecodedBuffer(signedUrl);
    preloadedAlertUrls.set(alertType, signedUrl);
    return true;
  } catch (error) {
    console.warn(`Could not preload ${alertType} alert.`, error);
    return false;
  }
}

/** Preload every configured workout sound in the background. */
export async function preloadWorkoutAlerts() {
  await Promise.all(ALERT_SOUND_TYPES.map((alertType) => preloadWorkoutAlert(alertType)));
}

async function playSelectedAlert(
  alertType: AlertSoundType
): Promise<"uploaded" | "built_in"> {
  try {
    const signedUrl =
      preloadedAlertUrls.get(alertType) ?? (await getAlertSoundSignedUrl(alertType));

    if (signedUrl) {
      try {
        await playUploadedWithWebAudio(signedUrl);
      } catch (webAudioError) {
        console.warn("Web Audio playback failed; trying HTML audio.", webAudioError);
        await playUploadedWithHtmlAudio(signedUrl);
      }
      return "uploaded";
    }
  } catch (error) {
    console.warn("Custom workout alert failed; using built-in alert.", error);
  }

  await playBuiltInAlert(alertType);
  return "built_in";
}

export async function playWorkoutAlert(
  alertType: AlertSoundType
): Promise<"uploaded" | "built_in"> {
  primeWorkoutAudio();
  let result: "uploaded" | "built_in" = "built_in";

  await playWithMusicDucked(async () => {
    result = await playSelectedAlert(alertType);
  });

  try {
    navigator.vibrate?.(vibrationPattern(alertType));
  } catch {
    // Vibration is optional.
  }

  return result;
}
