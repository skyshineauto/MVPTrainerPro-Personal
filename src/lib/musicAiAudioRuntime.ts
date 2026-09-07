import type { MusicMasterPrepProfile } from "./musicAudioIntelligence";

export type MusicMasterPrepSink = (profile: MusicMasterPrepProfile | null) => void;
export type MusicVenueDspSink = (profile: {
  enabled: boolean; widthScale: number; reflectionMix: number; delayMsA: number; delayMsB: number; damping: number;
} | null) => void;

type VenueMode = "off" | "studio" | "small_club" | "concert_hall" | "arena" | "live_stage";
type ProfileName = "headphones" | "speaker";
type StoredSnapshot = Record<string, unknown>;

type RuntimeState = {
  autoEnabled: boolean;
  venue: VenueMode;
  overrides: Record<string, boolean>;
  autoBaselines: Record<string, StoredSnapshot>;
  venueBaselines: Record<string, StoredSnapshot>;
};

const STORAGE_KEY = "mvp_music_ai_audio_runtime_v1";
const DEFAULT_STATE: RuntimeState = {
  autoEnabled: false,
  venue: "off",
  overrides: {},
  autoBaselines: {},
  venueBaselines: {},
};

let installed = false;
let sink: MusicMasterPrepSink | null = null;
let venueSink: MusicVenueDspSink | null = null;
let runtimeState = readState();
let lastTrackId = "";
let lastProfile = "";
let lastPrepKey = "";
let lastAutoApplyKey = "";
let lastVenueApplyKey = "";
let expected: Record<string, unknown> = {};
let graceUntil = 0;
let venueExpected: StoredSnapshot | null = null;
let venueOverride = false;
let statusNode: HTMLElement | null = null;
let detailNode: HTMLElement | null = null;
let panelNode: HTMLElement | null = null;
let latestIntelligence: any = null;

function normalizeVenue(value: unknown): VenueMode {
  return value === "studio" || value === "small_club" || value === "concert_hall" || value === "arena" || value === "live_stage"
    ? value
    : "off";
}

function objectRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function readState(): RuntimeState {
  if (typeof window === "undefined") return { ...DEFAULT_STATE, overrides: {}, autoBaselines: {}, venueBaselines: {} };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? objectRecord(JSON.parse(raw)) : {};
    return {
      autoEnabled: Boolean(parsed.autoEnabled),
      venue: normalizeVenue(parsed.venue),
      overrides: objectRecord(parsed.overrides),
      autoBaselines: objectRecord(parsed.autoBaselines),
      venueBaselines: objectRecord(parsed.venueBaselines),
    };
  } catch {
    return { ...DEFAULT_STATE, overrides: {}, autoBaselines: {}, venueBaselines: {} };
  }
}

function saveState() {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(runtimeState)); } catch { /* optional */ }
}

function bool(value: unknown) { return Boolean(value); }
function num(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function profileName(value: unknown): ProfileName | null {
  return value === "headphones" || value === "speaker" ? value : null;
}

function currentControlSnapshot(player: any, profile: ProfileName) {
  if (profile === "headphones") {
    return {
      clear: bool(player.toneEngineEnabled) && num(player.clarityDb) >= 1.5 && num(player.airDb) >= 2,
      neuralBass: bool(player.bassEngineEnabled),
      impactOrPunch: bool(player.dynamicsRestoreEnabled) && num(player.dynamicsRestoreAmount) >= 50,
      hdXpanderLevel: Math.max(0, Math.min(3, Math.round(num(player.hdXpanderLevel)))),
      analog: bool(player.exciterEnabled) ? (num(player.saturationMid) >= 7 ? "warm" : "studio") : "off",
      wide: player.headphoneMode === "wide",
      highOutput: num(player.outputReserveDb) >= 5.5,
    };
  }
  return {
    clear: bool(player.toneEngineEnabled) && num(player.clarityDb) >= 1.3 && num(player.airDb) >= 1.7,
    neuralBass: bool(player.bassEngineEnabled),
    impactOrPunch: bool(player.dynamicsRestoreEnabled) && num(player.dynamicsRestoreAmount) >= 50,
    hdXpanderLevel: Math.max(0, Math.min(3, Math.round(num(player.hdXpanderLevel)))),
    analog: bool(player.exciterEnabled) ? (num(player.saturationMid) >= 7 ? "warm" : "studio") : "off",
    wide: bool(player.stereoFieldEnabled) && num(player.stereoUserWidth) >= 115,
    highOutput: num(player.outputReserveDb) >= 5.5,
  };
}

function captureAutoBaseline(player: any, profile: ProfileName): StoredSnapshot {
  const common = {
    toneEngineEnabled: bool(player.toneEngineEnabled),
    presenceDb: num(player.presenceDb),
    clarityDb: num(player.clarityDb),
    airDb: num(player.airDb),
    deharshAmount: num(player.deharshAmount),
    bassEngineEnabled: bool(player.bassEngineEnabled),
    bassSubDb: num(player.bassSubDb),
    bassPunchDb: num(player.bassPunchDb),
    bassBodyDb: num(player.bassBodyDb),
    bassTightness: num(player.bassTightness, 55),
    dynamicsRestoreEnabled: bool(player.dynamicsRestoreEnabled),
    dynamicsRestoreAmount: num(player.dynamicsRestoreAmount),
    hdXpanderLevel: Math.max(0, Math.min(3, Math.round(num(player.hdXpanderLevel)))),
    exciterEnabled: bool(player.exciterEnabled),
    exciterAmount: num(player.exciterAmount),
    saturationLow: num(player.saturationLow),
    saturationMid: num(player.saturationMid),
    saturationHigh: num(player.saturationHigh),
    outputReserveDb: num(player.outputReserveDb),
    autoMakeupEnabled: bool(player.autoMakeupEnabled),
    limiterEnabled: bool(player.limiterEnabled),
  };
  if (profile === "headphones") return { ...common, headphoneMode: String(player.headphoneMode || "off") };
  return {
    ...common,
    stereoFieldEnabled: bool(player.stereoFieldEnabled),
    stereoUserWidth: num(player.stereoUserWidth, 100),
    stereoCenterFocus: num(player.stereoCenterFocus, 100),
    bassMonoHz: num(player.bassMonoHz, 90),
  };
}

function captureVenueBaseline(player: any, profile: ProfileName): StoredSnapshot {
  if (profile === "headphones") {
    return {
      headphoneMode: String(player.headphoneMode || "off"),
      headphoneWidth: num(player.headphoneWidth),
      headphoneDepth: num(player.headphoneDepth),
      headphoneCrossfeed: num(player.headphoneCrossfeed),
      headphoneCenter: num(player.headphoneCenter, 50),
      headphoneBassImpact: num(player.headphoneBassImpact),
      headphoneAdvancedEnabled: bool(player.headphoneAdvancedEnabled),
      headphoneSpeakerAngle: num(player.headphoneSpeakerAngle, 30),
      headphoneDistance: num(player.headphoneDistance, 35),
      headphoneReflections: num(player.headphoneReflections, 6),
      headphoneWet: num(player.headphoneWet, 24),
    };
  }
  return {
    stereoFieldEnabled: bool(player.stereoFieldEnabled),
    stereoUserWidth: num(player.stereoUserWidth, 100),
    stereoCenterFocus: num(player.stereoCenterFocus, 100),
    bassMonoHz: num(player.bassMonoHz, 90),
  };
}

async function restoreAutoBaseline(player: any, profile: ProfileName) {
  const baseline = runtimeState.autoBaselines[profile];
  if (!baseline) return;
  if (profileName(player?.outputProfile) !== profile) return;
  const music: any = await import("./musicPlayer");

  music.setMusicPresence(num(baseline.presenceDb));
  music.setMusicClarity(num(baseline.clarityDb));
  music.setMusicAir(num(baseline.airDb));
  music.setMusicDeharsh(num(baseline.deharshAmount));
  music.setMusicToneEngineEnabled(bool(baseline.toneEngineEnabled));

  music.setMusicBassSub(num(baseline.bassSubDb));
  music.setMusicBassPunch(num(baseline.bassPunchDb));
  music.setMusicBassBody(num(baseline.bassBodyDb));
  music.setMusicBassTightness(num(baseline.bassTightness, 55));
  music.setMusicBassEngineEnabled(bool(baseline.bassEngineEnabled));

  music.setMusicDynamicsRestoreAmount(num(baseline.dynamicsRestoreAmount));
  music.setMusicDynamicsRestoreEnabled(bool(baseline.dynamicsRestoreEnabled));

  music.setMusicExciterAmount(num(baseline.exciterAmount));
  music.setMusicSaturationLow(num(baseline.saturationLow));
  music.setMusicSaturationMid(num(baseline.saturationMid));
  music.setMusicSaturationHigh(num(baseline.saturationHigh));
  music.setMusicExciterEnabled(bool(baseline.exciterEnabled));

  if (profile === "headphones") music.setMusicHeadphoneHdXpander(Math.max(0, Math.min(3, Math.round(num(baseline.hdXpanderLevel)))));
  else music.setMusicSpeakerHdXpander(Math.max(0, Math.min(3, Math.round(num(baseline.hdXpanderLevel)))));

  music.setMusicOutputReserve(num(baseline.outputReserveDb));
  music.setMusicAutoMakeupEnabled(bool(baseline.autoMakeupEnabled));
  music.setMusicLimiterEnabled(bool(baseline.limiterEnabled));

  if (runtimeState.venue === "off") {
    if (profile === "headphones") {
      music.setMusicHeadphoneMode(String(baseline.headphoneMode || "off"));
    } else {
      music.setMusicStereoWidth(num(baseline.stereoUserWidth, 100));
      music.setMusicCenterFocus(num(baseline.stereoCenterFocus, 100));
      music.setMusicBassMonoHz(num(baseline.bassMonoHz, 90));
      music.setMusicStereoFieldEnabled(bool(baseline.stereoFieldEnabled));
    }
  }

  delete runtimeState.autoBaselines[profile];
  expected = {};
  saveState();
}

async function restoreVenueBaseline(player: any, profile: ProfileName) {
  const baseline = runtimeState.venueBaselines[profile];
  if (!baseline) return;
  if (profileName(player?.outputProfile) !== profile) return;
  const music: any = await import("./musicPlayer");
  if (profile === "headphones") {
    music.setMusicHeadphoneWidth(num(baseline.headphoneWidth));
    music.setMusicHeadphoneDepth(num(baseline.headphoneDepth));
    music.setMusicHeadphoneCrossfeed(num(baseline.headphoneCrossfeed));
    music.setMusicHeadphoneCenter(num(baseline.headphoneCenter, 50));
    music.setMusicHeadphoneBassImpact(num(baseline.headphoneBassImpact));
    music.setMusicHeadphoneAdvancedEnabled(bool(baseline.headphoneAdvancedEnabled));
    music.setMusicHeadphoneSpeakerAngle(num(baseline.headphoneSpeakerAngle, 30));
    music.setMusicHeadphoneDistance(num(baseline.headphoneDistance, 35));
    music.setMusicHeadphoneReflections(num(baseline.headphoneReflections, 6));
    music.setMusicHeadphoneWet(num(baseline.headphoneWet, 24));
    music.setMusicHeadphoneMode(String(baseline.headphoneMode || "off"));
  } else {
    music.setMusicStereoWidth(num(baseline.stereoUserWidth, 100));
    music.setMusicCenterFocus(num(baseline.stereoCenterFocus, 100));
    music.setMusicBassMonoHz(num(baseline.bassMonoHz, 90));
    music.setMusicStereoFieldEnabled(bool(baseline.stereoFieldEnabled));
  }
  delete runtimeState.venueBaselines[profile];
  venueExpected = null;
  venueOverride = false;
  saveState();
}

function detectManualOverrides(player: any) {
  const profile = profileName(lastProfile);
  if (!runtimeState.autoEnabled || Date.now() < graceUntil || !profile || !Object.keys(expected).length) return;
  const actual = currentControlSnapshot(player, profile);
  let changed = false;
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (runtimeState.overrides[`${profile}:${key}`]) continue;
    if ((actual as any)[key] !== expectedValue) {
      runtimeState.overrides[`${profile}:${key}`] = true;
      changed = true;
    }
  }
  if (changed) saveState();

  if (runtimeState.venue !== "off" && venueExpected && !venueOverride && Date.now() >= graceUntil) {
    if (profile === "headphones") {
      const expectedMode = String(venueExpected.headphoneMode || "off");
      if (String(player.headphoneMode || "off") !== expectedMode) venueOverride = true;
    } else {
      const expectedWidth = num(venueExpected.stereoUserWidth, 100);
      if (!player.stereoFieldEnabled || Math.abs(num(player.stereoUserWidth, 100) - expectedWidth) > 2) venueOverride = true;
    }
  }
}

async function applyAutoSound(player: any, intelligence: any) {
  if (!runtimeState.autoEnabled) {
    expected = {};
    return false;
  }
  const profile = profileName(player?.outputProfile);
  if (!profile) return false;
  const recommendation = intelligence?.aiAutoSound?.[profile];
  if (!recommendation) return false;

  if (!runtimeState.autoBaselines[profile]) {
    runtimeState.autoBaselines[profile] = captureAutoBaseline(player, profile);
    saveState();
  }

  const music: any = await import("./musicPlayer");
  const allow = (key: string) => !runtimeState.overrides[`${profile}:${key}`];
  if (profile === "headphones") {
    if (allow("clear")) music.setMusicHeadphoneClear(Boolean(recommendation.clear));
    if (allow("neuralBass")) music.setMusicHeadphoneNeuralBass(Boolean(recommendation.neuralBass));
    if (allow("impactOrPunch")) music.setMusicHeadphoneImpact(Boolean(recommendation.impactOrPunch));
    if (allow("hdXpanderLevel")) music.setMusicHeadphoneHdXpander(Math.max(0, Math.min(3, Number(recommendation.hdXpanderLevel) || 0)));
    if (allow("analog")) music.setMusicHeadphoneAnalog(recommendation.analog || "off");
    // R78f maximum clean output: always request High Output. The unchanged r77i
    // controller grants only real post-effect headroom. A manual OFF remains an override.
    if (allow("highOutput")) music.setMusicHeadphoneHighOutput(true);
    if (runtimeState.venue === "off" && allow("wide")) music.setMusicHeadphoneMode(recommendation.wide ? "wide" : "off");
  } else {
    if (allow("clear")) music.setMusicSpeakerClear(Boolean(recommendation.clear));
    if (allow("neuralBass")) music.setMusicSpeakerNeuralBass(Boolean(recommendation.neuralBass));
    if (allow("impactOrPunch")) music.setMusicSpeakerPunch(Boolean(recommendation.impactOrPunch));
    if (allow("hdXpanderLevel")) music.setMusicSpeakerHdXpander(Math.max(0, Math.min(3, Number(recommendation.hdXpanderLevel) || 0)));
    if (allow("analog")) music.setMusicSpeakerAnalog(recommendation.analog || "off");
    // R78f maximum clean output: always request Max Output. r77i refuses unsafe gain.
    if (allow("highOutput")) music.setMusicSpeakerMaxOutput(true);
    if (runtimeState.venue === "off" && allow("wide")) music.setMusicSpeakerWide(Boolean(recommendation.wide));
  }

  expected = { ...recommendation, highOutput: true };
  delete (expected as any).compatibilityNotes;
  if (runtimeState.venue !== "off") delete (expected as any).wide;
  graceUntil = Date.now() + 1800;
  return true;
}

async function applyVenue(player: any) {
  const profile = profileName(player?.outputProfile);
  if (!profile) return false;

  if (runtimeState.venue === "off") {
    await restoreVenueBaseline(player, profile);
    venueSink?.(null);
    venueExpected = null;
    return true;
  }
  if (venueOverride) return false;

  if (!runtimeState.venueBaselines[profile]) {
    runtimeState.venueBaselines[profile] = captureVenueBaseline(player, profile);
    saveState();
  }

  const music: any = await import("./musicPlayer");
  const mode = runtimeState.venue;
  const venueDsp = profile === "headphones"
    ? {
        studio:       { enabled: true, widthScale: 1.03, reflectionMix: 0.018, delayMsA: 6,  delayMsB: 11, damping: 0.56 },
        small_club:   { enabled: true, widthScale: 1.07, reflectionMix: 0.050, delayMsA: 11, delayMsB: 18, damping: 0.50 },
        concert_hall: { enabled: true, widthScale: 1.10, reflectionMix: 0.078, delayMsA: 21, delayMsB: 34, damping: 0.42 },
        arena:        { enabled: true, widthScale: 1.13, reflectionMix: 0.105, delayMsA: 31, delayMsB: 49, damping: 0.36 },
        live_stage:   { enabled: true, widthScale: 1.11, reflectionMix: 0.068, delayMsA: 15, delayMsB: 27, damping: 0.46 },
      }
    : {
        studio:       { enabled: true, widthScale: 1.04, reflectionMix: 0.024, delayMsA: 6,  delayMsB: 11, damping: 0.58 },
        small_club:   { enabled: true, widthScale: 1.09, reflectionMix: 0.068, delayMsA: 11, delayMsB: 18, damping: 0.52 },
        concert_hall: { enabled: true, widthScale: 1.14, reflectionMix: 0.105, delayMsA: 21, delayMsB: 34, damping: 0.44 },
        arena:        { enabled: true, widthScale: 1.19, reflectionMix: 0.145, delayMsA: 31, delayMsB: 49, damping: 0.38 },
        live_stage:   { enabled: true, widthScale: 1.16, reflectionMix: 0.092, delayMsA: 15, delayMsB: 27, damping: 0.48 },
      };
  venueSink?.(venueDsp[mode as Exclude<VenueMode, "off">]);
  if (profile === "headphones") {
    const values: Record<Exclude<VenueMode, "off">, {
      headphoneMode: string;
      width: number;
      depth: number;
      crossfeed: number;
      center: number;
      angle: number;
      distance: number;
      reflections: number;
      wet: number;
    }> = {
      studio:       { headphoneMode: "wide",    width: 26, depth: 10, crossfeed: 18, center: 54, angle: 28, distance: 28, reflections: 2,  wet: 8  },
      small_club:   { headphoneMode: "spatial", width: 44, depth: 34, crossfeed: 20, center: 52, angle: 34, distance: 42, reflections: 10, wet: 18 },
      concert_hall: { headphoneMode: "deep",    width: 64, depth: 78, crossfeed: 16, center: 50, angle: 40, distance: 72, reflections: 18, wet: 28 },
      arena:        { headphoneMode: "stage",   width: 86, depth: 94, crossfeed: 12, center: 48, angle: 50, distance: 90, reflections: 28, wet: 38 },
      live_stage:   { headphoneMode: "spatial", width: 74, depth: 50, crossfeed: 14, center: 50, angle: 44, distance: 58, reflections: 14, wet: 24 },
    };
    const value = values[mode as Exclude<VenueMode, "off">];
    music.setMusicHeadphoneWidth(value.width);
    music.setMusicHeadphoneDepth(value.depth);
    music.setMusicHeadphoneCrossfeed(value.crossfeed);
    music.setMusicHeadphoneCenter(value.center);
    music.setMusicHeadphoneBassImpact(0);
    music.setMusicHeadphoneAdvancedEnabled(mode !== "studio");
    music.setMusicHeadphoneSpeakerAngle(value.angle);
    music.setMusicHeadphoneDistance(value.distance);
    music.setMusicHeadphoneReflections(value.reflections);
    music.setMusicHeadphoneWet(value.wet);
    music.setMusicHeadphoneMode(value.headphoneMode);
    venueExpected = { headphoneMode: value.headphoneMode };
  } else {
    const values: Record<Exclude<VenueMode, "off">, { width: number; center: number; bassMonoHz: number }> = {
      studio:       { width: 110, center: 104, bassMonoHz: 90 },
      small_club:   { width: 126, center: 102, bassMonoHz: 100 },
      concert_hall: { width: 144, center: 99, bassMonoHz: 108 },
      arena:        { width: 160, center: 96, bassMonoHz: 115 },
      live_stage:   { width: 150, center: 98, bassMonoHz: 110 },
    };
    const value = values[mode as Exclude<VenueMode, "off">];
    music.setMusicStereoFieldEnabled(true);
    music.setMusicStereoWidth(value.width);
    music.setMusicCenterFocus(value.center);
    music.setMusicBassMonoHz(value.bassMonoHz);
    venueExpected = { stereoUserWidth: value.width };
  }

  graceUntil = Date.now() + 1800;
  return true;
}

function setTriggerState(active: boolean, ready: boolean) {
  if (typeof document === "undefined") return;
  document.querySelectorAll<HTMLElement>("[data-mvp-ai-audio-trigger]").forEach((node) => {
    node.dataset.active = active ? "true" : "false";
    node.dataset.ready = ready ? "true" : "false";
  });
}

function updateUi(intelligence: any) {
  latestIntelligence = intelligence;
  const prep = intelligence?.masterPrep;
  const currentPlayerRecommendation = intelligence?.aiAutoSound;
  const overrideCount = Object.keys(runtimeState.overrides).filter((key) => runtimeState.overrides[key]).length;
  if (statusNode) statusNode.textContent = prep ? "MASTER PREP ACTIVE" : "MASTER PREP PENDING";
  if (detailNode) {
    const ai = runtimeState.autoEnabled
      ? currentPlayerRecommendation
        ? `AI AUTO SOUND ON${overrideCount ? ` · ${overrideCount} MANUAL` : ""}`
        : "AI AUTO SOUND WAITING FOR ENRICHMENT"
      : "AI AUTO SOUND OFF";
    const venue = runtimeState.venue === "off"
      ? "VENUE OFF"
      : `${runtimeState.venue.replaceAll("_", " ").toUpperCase()}${venueOverride ? " · MANUAL OVERRIDE" : ""}`;
    detailNode.textContent = `${ai} · ${venue}`;
  }
  setTriggerState(runtimeState.autoEnabled || runtimeState.venue !== "off", Boolean(prep));

  if (panelNode) panelNode.querySelectorAll<HTMLButtonElement>("[data-venue]").forEach((node) => {
    node.dataset.active = node.dataset.venue === runtimeState.venue ? "true" : "false";
  });
  const toggle = panelNode?.querySelector<HTMLButtonElement>("[data-auto]");
  if (toggle) {
    const recommendationReady = Boolean(currentPlayerRecommendation);
    toggle.dataset.active = runtimeState.autoEnabled ? "true" : "false";
    toggle.dataset.ready = recommendationReady ? "true" : "false";
    toggle.textContent = runtimeState.autoEnabled
      ? recommendationReady ? "AI AUTO SOUND · ON" : "AI AUTO SOUND · WAITING FOR ENRICHMENT"
      : "AI AUTO SOUND · OFF";
  }

  const technical = intelligence?.audioAnalysis;
  const tech = panelNode?.querySelector<HTMLElement>("[data-tech]");
  if (tech) tech.textContent = technical
    ? `${technical.codec || "SOURCE"} · ${technical.truePeakDbtp?.toFixed?.(1) ?? "—"} dBTP · ${technical.crestFactorDb?.toFixed?.(1) ?? "—"} dB CREST · ${technical.correlation?.toFixed?.(2) ?? "—"} CORR`
    : "Run Enrich Library to create Master Prep and AI sound recommendations for this song.";
}

async function poll() {
  try {
    const music: any = await import("./musicPlayer");
    const player = music.getMusicPlayerSnapshot();
    const trackId = String(player?.currentTrack?.id || "");
    const profile = profileName(player?.outputProfile);
    detectManualOverrides(player);

    if (!trackId) {
      if (lastTrackId) sink?.(null);
      lastTrackId = "";
      lastPrepKey = "";
      lastAutoApplyKey = "";
      updateUi(null);
      return;
    }

    const intelligenceModule: any = await import("./musicIntelligenceEnrichment");
    const intelligence = await intelligenceModule.getMusicTrackIntelligence(trackId).catch(() => null);
    const intelligenceKey = `${trackId}:${intelligence?.updatedAt || "none"}`;

    if (intelligenceKey !== lastPrepKey) {
      sink?.(intelligence?.masterPrep || null);
      lastPrepKey = intelligenceKey;
    }

    if (profile) {
      if (!runtimeState.autoEnabled && runtimeState.autoBaselines[profile]) {
        await restoreAutoBaseline(player, profile);
      }
      if (runtimeState.venue === "off" && runtimeState.venueBaselines[profile]) {
        await restoreVenueBaseline(music.getMusicPlayerSnapshot(), profile);
      }

      const autoKey = `${intelligenceKey}:${profile}:${runtimeState.autoEnabled ? "on" : "off"}`;
      if (runtimeState.autoEnabled && autoKey !== lastAutoApplyKey) {
        await applyAutoSound(music.getMusicPlayerSnapshot(), intelligence);
        lastAutoApplyKey = autoKey;
      }

      const venueKey = `${trackId}:${profile}:${runtimeState.venue}:${venueOverride ? "manual" : "auto"}`;
      if (runtimeState.venue !== "off" && venueKey !== lastVenueApplyKey) {
        await applyVenue(music.getMusicPlayerSnapshot());
        lastVenueApplyKey = venueKey;
      }
    }

    lastTrackId = trackId;
    lastProfile = profile || "";
    updateUi(intelligence);
  } catch (error) {
    if (statusNode) statusNode.textContent = "AI AUDIO READY";
    console.debug("MVP AI audio runtime", error);
  }
}

function visibleTrigger() {
  if (typeof document === "undefined") return null;
  return Array.from(document.querySelectorAll<HTMLElement>("[data-mvp-ai-audio-trigger]"))
    .find((node) => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== "hidden") || null;
}

function positionPanel() {
  if (!panelNode || panelNode.hidden || typeof window === "undefined") return;
  const trigger = visibleTrigger();
  const margin = 9;
  const gap = 8;
  const panelRect = panelNode.getBoundingClientRect();
  const width = Math.min(panelRect.width || 390, window.innerWidth - margin * 2);
  const height = Math.min(panelRect.height || 420, window.innerHeight - margin * 2);
  let left = Math.max(margin, window.innerWidth - width - margin);
  let top = Math.max(margin, window.innerHeight - height - margin);
  if (trigger) {
    const rect = trigger.getBoundingClientRect();
    left = Math.max(margin, Math.min(rect.right - width, window.innerWidth - width - margin));
    const above = rect.top - height - gap;
    const below = rect.bottom + gap;
    top = above >= margin ? above : Math.min(below, window.innerHeight - height - margin);
  }
  panelNode.style.left = `${Math.round(left)}px`;
  panelNode.style.top = `${Math.round(top)}px`;
}

function createUi() {
  if (typeof document === "undefined" || document.getElementById("mvp-ai-audio-runtime")) return;
  const host = document.createElement("div");
  host.id = "mvp-ai-audio-runtime";
  host.innerHTML = `
    <section class="mvp-ai-audio-panel" hidden>
      <header><div><small>MVP STUDIO</small><strong>AI AUDIO</strong><em>Master Prep · Auto Sound · Venue</em></div><button data-close type="button">×</button></header>
      <div class="mvp-ai-audio-state"><b data-status>MASTER PREP</b><span data-detail>AI AUTO SOUND OFF · VENUE OFF</span></div>
      <button class="mvp-ai-auto" data-auto type="button">AI AUTO SOUND · OFF</button>
      <div class="mvp-ai-venue-title"><b>AI SOUNDSTAGE / VENUE</b><small>Uses the existing real DSP controls</small></div>
      <div class="mvp-ai-venues">
        <button data-venue="off" type="button">OFF</button><button data-venue="studio" type="button">STUDIO</button><button data-venue="small_club" type="button">SMALL CLUB</button><button data-venue="concert_hall" type="button">CONCERT HALL</button><button data-venue="arena" type="button">ARENA</button><button data-venue="live_stage" type="button">LIVE STAGE</button>
      </div>
      <div class="mvp-ai-tech" data-tech>Run Enrich Library to create Master Prep and AI sound recommendations for this song.</div>
      <div class="mvp-ai-actions"><button data-reset type="button">RESET MANUAL OVERRIDES</button></div>
    </section>
    <style>
      #mvp-ai-audio-runtime{position:fixed;inset:0;z-index:2147483647;pointer-events:none;font-family:Inter,system-ui,sans-serif;color:#eefaff}
      .mvp-ai-audio-panel{position:fixed;left:auto;top:auto;width:min(390px,calc(100vw - 18px));max-height:calc(100dvh - 18px);overflow:auto;pointer-events:auto;border:1px solid rgba(90,204,238,.30);border-radius:16px;background:linear-gradient(160deg,rgba(5,18,25,.995),rgba(3,8,12,.998));box-shadow:0 22px 70px rgba(0,0,0,.68),inset 0 1px rgba(255,255,255,.04)}
      .mvp-ai-audio-panel header{padding:14px 15px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(100,194,220,.12)}.mvp-ai-audio-panel header small,.mvp-ai-venue-title small{display:block;color:#59d7fa;font-size:7px;font-weight:1000;letter-spacing:.14em}.mvp-ai-audio-panel header strong{display:block;font-size:19px}.mvp-ai-audio-panel header em{display:block;color:#7898a4;font-size:8px;font-style:normal}.mvp-ai-audio-panel header button{width:34px;height:34px;border:0;border-radius:9px;background:#101b20;color:#fff;font-size:23px;cursor:pointer}
      .mvp-ai-audio-state{padding:11px 13px;display:grid;gap:3px;background:#06141b}.mvp-ai-audio-state b{color:#64e6af;font-size:8px;letter-spacing:.08em}.mvp-ai-audio-state span{color:#9bb3bc;font-size:7px;font-weight:800}
      .mvp-ai-auto{margin:12px;width:calc(100% - 24px);min-height:42px;border:1px solid rgba(77,203,241,.27);border-radius:10px;background:#09222c;color:#dff8ff;font-size:9px;font-weight:1000;letter-spacing:.05em;cursor:pointer}.mvp-ai-auto[data-active="true"]{border-color:#55e09a;background:linear-gradient(180deg,#15945d,#0a6e46);color:#fff}.mvp-ai-auto[data-active="true"][data-ready="false"]{border-color:#f1a441;background:linear-gradient(180deg,#5b3814,#34200d);color:#ffd28a}
      .mvp-ai-venue-title{padding:2px 13px 8px}.mvp-ai-venue-title b{font-size:9px}.mvp-ai-venue-title small{margin-top:3px;color:#7898a4;letter-spacing:.02em}
      .mvp-ai-venues{padding:0 12px 12px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.mvp-ai-venues button{height:36px;border:1px solid rgba(99,166,188,.16);border-radius:8px;background:#07151c;color:#b8cbd2;font-size:8px;font-weight:1000;cursor:pointer}.mvp-ai-venues button[data-active="true"]{border-color:#ff9c35;background:linear-gradient(180deg,#9d5511,#6d3508);color:#fff;box-shadow:0 0 14px rgba(255,139,38,.18)}
      .mvp-ai-tech{margin:0 12px 10px;padding:9px 10px;border:1px solid rgba(99,166,188,.1);border-radius:8px;background:#050d11;color:#7f9ba6;font-size:7px;line-height:1.45}.mvp-ai-actions{padding:0 12px 12px}.mvp-ai-actions button{width:100%;height:32px;border:1px solid rgba(255,153,64,.2);border-radius:8px;background:#1b1008;color:#eab77e;font-size:7px;font-weight:900;cursor:pointer}
      @media(max-width:650px){.mvp-ai-audio-panel{width:calc(100vw - 18px);max-height:calc(100dvh - 18px);border-radius:14px}.mvp-ai-audio-panel header{padding:12px}.mvp-ai-auto{min-height:44px}.mvp-ai-venues button{height:40px}}
    </style>`;
  document.body.appendChild(host);
  panelNode = host.querySelector(".mvp-ai-audio-panel");
  statusNode = host.querySelector("[data-status]");
  detailNode = host.querySelector("[data-detail]");

  const setOpen = (open: boolean) => {
    if (!panelNode) return;
    panelNode.hidden = !open;
    if (open) {
      updateUi(latestIntelligence);
      window.requestAnimationFrame(positionPanel);
    }
  };

  window.addEventListener("mvp:ai-audio-toggle", () => setOpen(Boolean(panelNode?.hidden)));
  host.querySelector("[data-close]")?.addEventListener("click", () => setOpen(false));
  window.addEventListener("resize", positionPanel, { passive: true });
  window.addEventListener("scroll", positionPanel, { passive: true, capture: true });

  host.querySelector("[data-auto]")?.addEventListener("click", async () => {
    const music: any = await import("./musicPlayer");
    const player = music.getMusicPlayerSnapshot();
    const profile = profileName(player?.outputProfile);
    if (!runtimeState.autoEnabled) {
      runtimeState.autoEnabled = true;
      runtimeState.overrides = {};
      if (profile && !runtimeState.autoBaselines[profile]) runtimeState.autoBaselines[profile] = captureAutoBaseline(player, profile);
      saveState();
      lastAutoApplyKey = "";
    } else {
      runtimeState.autoEnabled = false;
      saveState();
      if (profile) await restoreAutoBaseline(player, profile);
      lastAutoApplyKey = "";
    }
    await poll();
  });

  host.querySelectorAll<HTMLElement>("[data-venue]").forEach((node) => node.addEventListener("click", async () => {
    const music: any = await import("./musicPlayer");
    const player = music.getMusicPlayerSnapshot();
    const profile = profileName(player?.outputProfile);
    const nextVenue = normalizeVenue(node.dataset.venue);
    if (nextVenue === "off") {
      runtimeState.venue = "off";
      venueOverride = false;
      saveState();
      if (profile) await restoreVenueBaseline(player, profile);
    } else {
      if (profile && !runtimeState.venueBaselines[profile]) runtimeState.venueBaselines[profile] = captureVenueBaseline(player, profile);
      runtimeState.venue = nextVenue;
      venueOverride = false;
      saveState();
      lastVenueApplyKey = "";
      await applyVenue(music.getMusicPlayerSnapshot());
    }
    await poll();
  }));

  host.querySelector("[data-reset]")?.addEventListener("click", async () => {
    runtimeState.overrides = {};
    venueOverride = false;
    saveState();
    lastAutoApplyKey = "";
    lastVenueApplyKey = "";
    await poll();
  });
}

export function installMusicAiAudioRuntime(masterPrepSink: MusicMasterPrepSink, soundstageSink?: MusicVenueDspSink) {
  sink = masterPrepSink;
  venueSink = soundstageSink || null;
  runtimeState = readState();
  if (installed || typeof window === "undefined" || typeof document === "undefined") return;
  installed = true;
  const start = () => {
    createUi();
    void poll();
    window.setInterval(() => { if (!document.hidden) void poll(); }, 800);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}
