import {
  getAlertSoundSignedUrl,
  type AlertSoundType,
} from "./alertSoundStorage";

let sharedAudioContext: AudioContext | null = null;
let activeAlertAudio: HTMLAudioElement | null = null;

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

export function primeWorkoutAudio() {
  try {
    const context = getAudioContext();
    if (context?.state === "suspended") {
      void context.resume();
    }
  } catch {
    // Audio remains best-effort in browsers with stricter playback policies.
  }
}

function alertPattern(alertType: AlertSoundType) {
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

function playBuiltInAlert(alertType: AlertSoundType) {
  try {
    const context = getAudioContext();
    if (!context) return;
    if (context.state === "suspended") void context.resume();

    const now = context.currentTime;
    for (const tone of alertPattern(alertType)) {
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
    }
  } catch {
    // The visual alert remains available if audio playback is blocked.
  }
}

function vibrationPattern(alertType: AlertSoundType) {
  if (alertType === "workout_complete") return [180, 80, 180, 80, 420];
  if (alertType === "exercise_complete") return [180, 80, 280];
  return [260, 100, 260, 100, 520];
}

async function playUploadedAlert(url: string) {
  if (activeAlertAudio) {
    activeAlertAudio.pause();
    activeAlertAudio.src = "";
  }

  const audio = new Audio(url);
  activeAlertAudio = audio;
  audio.preload = "auto";
  audio.volume = 1;

  await audio.play();
}

export async function playWorkoutAlert(
  alertType: AlertSoundType
): Promise<"uploaded" | "built_in"> {
  primeWorkoutAudio();

  try {
    const signedUrl = await getAlertSoundSignedUrl(alertType);
    if (signedUrl) {
      await playUploadedAlert(signedUrl);
      try {
        navigator.vibrate?.(vibrationPattern(alertType));
      } catch {
        // Vibration is optional.
      }
      return "uploaded";
    }
  } catch (error) {
    console.warn("Custom workout alert failed; using built-in alert.", error);
  }

  playBuiltInAlert(alertType);
  try {
    navigator.vibrate?.(vibrationPattern(alertType));
  } catch {
    // Vibration is optional.
  }
  return "built_in";
}
