import type { MusicMasterPrepProfile } from "./musicAudioIntelligence";

export type MusicMasterPrepSink = (profile: MusicMasterPrepProfile | null) => void;

type VenueMode = "off" | "studio" | "small_club" | "concert_hall" | "arena" | "live_stage";

type RuntimeState = {
  autoEnabled: boolean;
  venue: VenueMode;
  overrides: Record<string, boolean>;
};

const STORAGE_KEY = "mvp_music_ai_audio_runtime_v1";
const DEFAULT_STATE: RuntimeState = { autoEnabled: false, venue: "off", overrides: {} };
let installed = false;
let sink: MusicMasterPrepSink | null = null;
let runtimeState = readState();
let lastTrackId = "";
let lastProfile = "";
let lastAppliedKey = "";
let expected: Record<string, unknown> = {};
let graceUntil = 0;
let venueExpected: string | null = null;
let venueOverride = false;
let statusNode: HTMLElement | null = null;
let detailNode: HTMLElement | null = null;
let buttonNode: HTMLButtonElement | null = null;
let panelNode: HTMLElement | null = null;

function readState(): RuntimeState {
  if (typeof window === "undefined") return { ...DEFAULT_STATE, overrides: {} };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as Partial<RuntimeState> : null;
    const venue = parsed?.venue;
    return {
      autoEnabled: Boolean(parsed?.autoEnabled),
      venue: venue === "studio" || venue === "small_club" || venue === "concert_hall" || venue === "arena" || venue === "live_stage" ? venue : "off",
      overrides: parsed?.overrides && typeof parsed.overrides === "object" ? parsed.overrides : {},
    };
  } catch {
    return { ...DEFAULT_STATE, overrides: {} };
  }
}

function saveState() {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(runtimeState)); } catch { /* optional */ }
}

function bool(value: unknown) { return Boolean(value); }
function num(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function currentControlSnapshot(player: any, profile: string) {
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
  if (profile === "speaker") {
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
  return {};
}

function detectManualOverrides(player: any) {
  if (!runtimeState.autoEnabled || Date.now() < graceUntil || !lastProfile || !Object.keys(expected).length) return;
  const actual = currentControlSnapshot(player, lastProfile);
  let changed = false;
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (runtimeState.overrides[`${lastProfile}:${key}`]) continue;
    if ((actual as any)[key] !== expectedValue) {
      runtimeState.overrides[`${lastProfile}:${key}`] = true;
      changed = true;
    }
  }
  if (changed) saveState();
  if (runtimeState.venue !== "off" && venueExpected && !venueOverride && Date.now() >= graceUntil) {
    if (lastProfile === "headphones" && player.headphoneMode !== venueExpected) venueOverride = true;
    if (lastProfile === "speaker" && runtimeState.venue !== "studio" && !player.stereoFieldEnabled) venueOverride = true;
  }
}

async function applyAutoSound(player: any, intelligence: any) {
  if (!runtimeState.autoEnabled) {
    expected = {};
    return;
  }
  const profile = player.outputProfile;
  if (profile !== "headphones" && profile !== "speaker") return;
  const recommendation = intelligence?.aiAutoSound?.[profile];
  if (!recommendation) return;
  const music: any = await import("./musicPlayer");
  const allow = (key: string) => !runtimeState.overrides[`${profile}:${key}`];

  if (profile === "headphones") {
    if (allow("clear")) music.setMusicHeadphoneClear(Boolean(recommendation.clear));
    if (allow("neuralBass")) music.setMusicHeadphoneNeuralBass(Boolean(recommendation.neuralBass));
    if (allow("impactOrPunch")) music.setMusicHeadphoneImpact(Boolean(recommendation.impactOrPunch));
    if (allow("hdXpanderLevel")) music.setMusicHeadphoneHdXpander(Math.max(0, Math.min(3, Number(recommendation.hdXpanderLevel) || 0)));
    if (allow("analog")) music.setMusicHeadphoneAnalog(recommendation.analog || "off");
    if (allow("highOutput")) music.setMusicHeadphoneHighOutput(Boolean(recommendation.highOutput));
    if (runtimeState.venue === "off" && allow("wide")) music.setMusicHeadphoneMode(recommendation.wide ? "wide" : "off");
  } else {
    if (allow("clear")) music.setMusicSpeakerClear(Boolean(recommendation.clear));
    if (allow("neuralBass")) music.setMusicSpeakerNeuralBass(Boolean(recommendation.neuralBass));
    if (allow("impactOrPunch")) music.setMusicSpeakerPunch(Boolean(recommendation.impactOrPunch));
    if (allow("hdXpanderLevel")) music.setMusicSpeakerHdXpander(Math.max(0, Math.min(3, Number(recommendation.hdXpanderLevel) || 0)));
    if (allow("analog")) music.setMusicSpeakerAnalog(recommendation.analog || "off");
    if (allow("highOutput")) music.setMusicSpeakerMaxOutput(Boolean(recommendation.highOutput));
    if (runtimeState.venue === "off" && allow("wide")) music.setMusicSpeakerWide(Boolean(recommendation.wide));
  }

  expected = { ...recommendation };
  delete (expected as any).compatibilityNotes;
  if (runtimeState.venue !== "off") delete (expected as any).wide;
  graceUntil = Date.now() + 1600;
}

async function applyVenue(player: any) {
  if (runtimeState.venue === "off" || venueOverride) {
    venueExpected = null;
    return;
  }
  const profile = player.outputProfile;
  if (profile !== "headphones" && profile !== "speaker") return;
  const music: any = await import("./musicPlayer");
  const mode = runtimeState.venue;
  if (profile === "headphones") {
    const values: Record<Exclude<VenueMode, "off">, { mode: string; angle: number; distance: number; reflections: number; wet: number }> = {
      studio: { mode: "off", angle: 24, distance: 0.22, reflections: 0, wet: 0 },
      small_club: { mode: "spatial", angle: 32, distance: 0.34, reflections: 18, wet: 12 },
      concert_hall: { mode: "deep", angle: 38, distance: 0.58, reflections: 28, wet: 18 },
      arena: { mode: "stage", angle: 44, distance: 0.78, reflections: 34, wet: 22 },
      live_stage: { mode: "spatial", angle: 40, distance: 0.48, reflections: 22, wet: 14 },
    };
    const v = values[mode as Exclude<VenueMode, "off">];
    music.setMusicHeadphoneMode(v.mode);
    music.setMusicHeadphoneAdvancedEnabled(mode !== "studio");
    music.setMusicHeadphoneSpeakerAngle(v.angle);
    music.setMusicHeadphoneDistance(v.distance);
    music.setMusicHeadphoneReflections(v.reflections);
    music.setMusicHeadphoneWet(v.wet);
    venueExpected = v.mode;
  } else {
    const widths: Record<Exclude<VenueMode, "off">, number> = {
      studio: 100,
      small_club: 116,
      concert_hall: 126,
      arena: 138,
      live_stage: 130,
    };
    const width = widths[mode as Exclude<VenueMode, "off">];
    music.setMusicSpeakerWide(mode !== "studio");
    if (mode !== "studio") {
      music.setMusicStereoFieldEnabled(true);
      music.setMusicStereoWidth(width);
      music.setMusicBassMonoHz(105);
    }
    venueExpected = mode === "studio" ? "studio" : "wide";
  }
  graceUntil = Date.now() + 1600;
}

function updateUi(intelligence: any) {
  const prep = intelligence?.masterPrep;
  const overrideCount = Object.keys(runtimeState.overrides).filter((key) => runtimeState.overrides[key]).length;
  if (statusNode) statusNode.textContent = prep ? "MASTER PREP ACTIVE" : "MASTER PREP PENDING";
  if (detailNode) {
    const ai = runtimeState.autoEnabled ? `AI AUTO SOUND ON${overrideCount ? ` · ${overrideCount} MANUAL` : ""}` : "AI AUTO SOUND OFF";
    const venue = runtimeState.venue === "off" ? "VENUE OFF" : `${runtimeState.venue.replaceAll("_", " ").toUpperCase()}${venueOverride ? " · MANUAL OVERRIDE" : ""}`;
    detailNode.textContent = `${ai} · ${venue}`;
  }
  if (buttonNode) buttonNode.dataset.active = runtimeState.autoEnabled || runtimeState.venue !== "off" ? "true" : "false";
  if (panelNode) panelNode.querySelectorAll<HTMLButtonElement>("[data-venue]").forEach((node) => {
    node.dataset.active = node.dataset.venue === runtimeState.venue ? "true" : "false";
  });
  const toggle = panelNode?.querySelector<HTMLButtonElement>("[data-auto]");
  if (toggle) {
    toggle.dataset.active = runtimeState.autoEnabled ? "true" : "false";
    toggle.textContent = runtimeState.autoEnabled ? "AI AUTO SOUND · ON" : "AI AUTO SOUND · OFF";
  }
  const technical = intelligence?.audioAnalysis;
  const tech = panelNode?.querySelector<HTMLElement>("[data-tech]");
  if (tech) tech.textContent = technical
    ? `${technical.codec || "SOURCE"} · ${technical.truePeakDbtp?.toFixed?.(1) ?? "—"} dBTP · ${technical.crestFactorDb?.toFixed?.(1) ?? "—"} dB CREST · ${technical.correlation?.toFixed?.(2) ?? "—"} CORR`
    : "Run Enrich Library to create Master Prep for this song.";
}

async function poll() {
  try {
    const music: any = await import("./musicPlayer");
    const player = music.getMusicPlayerSnapshot();
    const trackId = String(player?.currentTrack?.id || "");
    const profile = String(player?.outputProfile || "");
    detectManualOverrides(player);

    if (!trackId) {
      if (lastTrackId) sink?.(null);
      lastTrackId = "";
      lastAppliedKey = "";
      updateUi(null);
      return;
    }

    const intelligenceModule: any = await import("./musicIntelligenceEnrichment");
    const intelligence = await intelligenceModule.getMusicTrackIntelligence(trackId).catch(() => null);
    const prepKey = `${trackId}:${intelligence?.updatedAt || "none"}`;
    if (prepKey !== lastAppliedKey) {
      sink?.(intelligence?.masterPrep || null);
      lastAppliedKey = prepKey;
    }

    if (trackId !== lastTrackId || profile !== lastProfile) {
      lastTrackId = trackId;
      lastProfile = profile;
      await applyAutoSound(player, intelligence);
      await applyVenue(music.getMusicPlayerSnapshot());
    }
    updateUi(intelligence);
  } catch (error) {
    if (statusNode) statusNode.textContent = "AI AUDIO READY";
    console.debug("MVP AI audio runtime", error);
  }
}

function createUi() {
  if (typeof document === "undefined" || document.getElementById("mvp-ai-audio-runtime")) return;
  const host = document.createElement("div");
  host.id = "mvp-ai-audio-runtime";
  host.innerHTML = `
    <button class="mvp-ai-audio-trigger" type="button" aria-label="Open AI Audio"><span>AI</span><b>AUDIO</b></button>
    <section class="mvp-ai-audio-panel" hidden>
      <header><div><small>MVP STUDIO</small><strong>AI AUDIO</strong><em>Master Prep · Auto Sound · Venue</em></div><button data-close type="button">×</button></header>
      <div class="mvp-ai-audio-state"><b data-status>MASTER PREP</b><span data-detail>AI AUTO SOUND OFF · VENUE OFF</span></div>
      <button class="mvp-ai-auto" data-auto type="button">AI AUTO SOUND · OFF</button>
      <div class="mvp-ai-venue-title"><b>AI SOUNDSTAGE / VENUE</b><small>Uses the existing real DSP controls</small></div>
      <div class="mvp-ai-venues">
        <button data-venue="off" type="button">OFF</button><button data-venue="studio" type="button">STUDIO</button><button data-venue="small_club" type="button">SMALL CLUB</button><button data-venue="concert_hall" type="button">CONCERT HALL</button><button data-venue="arena" type="button">ARENA</button><button data-venue="live_stage" type="button">LIVE STAGE</button>
      </div>
      <div class="mvp-ai-tech" data-tech>Run Enrich Library to create Master Prep for this song.</div>
      <div class="mvp-ai-actions"><button data-reset type="button">RESET MANUAL OVERRIDES</button></div>
    </section>
    <style>
      #mvp-ai-audio-runtime{position:fixed;right:14px;bottom:86px;z-index:2147483647;font-family:Inter,system-ui,sans-serif;color:#eefaff}
      .mvp-ai-audio-trigger{width:58px;height:58px;border:1px solid rgba(74,210,255,.46);border-radius:17px;background:linear-gradient(155deg,#0a2631,#071218 65%,#2a1506);box-shadow:0 12px 34px rgba(0,0,0,.42),inset 0 1px rgba(255,255,255,.08);color:#fff;display:grid;place-content:center;cursor:pointer}
      .mvp-ai-audio-trigger[data-active="true"]{border-color:#ff9c35;box-shadow:0 0 0 1px rgba(255,145,41,.2),0 0 24px rgba(255,130,30,.22),0 12px 34px rgba(0,0,0,.45)}
      .mvp-ai-audio-trigger span{font-size:15px;font-weight:1000;color:#60dfff;line-height:1}.mvp-ai-audio-trigger b{font-size:8px;letter-spacing:.12em;line-height:1.4}
      .mvp-ai-audio-panel{position:absolute;right:0;bottom:68px;width:min(390px,calc(100vw - 24px));border:1px solid rgba(90,204,238,.24);border-radius:16px;background:linear-gradient(160deg,rgba(5,18,25,.98),rgba(3,8,12,.99));box-shadow:0 22px 70px rgba(0,0,0,.65),inset 0 1px rgba(255,255,255,.04);overflow:hidden}
      .mvp-ai-audio-panel header{padding:14px 15px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(100,194,220,.12)}.mvp-ai-audio-panel header small,.mvp-ai-venue-title small{display:block;color:#59d7fa;font-size:7px;font-weight:1000;letter-spacing:.14em}.mvp-ai-audio-panel header strong{display:block;font-size:19px}.mvp-ai-audio-panel header em{display:block;color:#7898a4;font-size:8px;font-style:normal}.mvp-ai-audio-panel header button{width:34px;height:34px;border:0;border-radius:9px;background:#101b20;color:#fff;font-size:23px}
      .mvp-ai-audio-state{padding:11px 13px;display:grid;gap:3px;background:#06141b}.mvp-ai-audio-state b{color:#64e6af;font-size:8px;letter-spacing:.08em}.mvp-ai-audio-state span{color:#9bb3bc;font-size:7px;font-weight:800}
      .mvp-ai-auto{margin:12px;width:calc(100% - 24px);height:42px;border:1px solid rgba(77,203,241,.27);border-radius:10px;background:#09222c;color:#dff8ff;font-size:9px;font-weight:1000;letter-spacing:.05em}.mvp-ai-auto[data-active="true"]{border-color:#55e09a;background:linear-gradient(180deg,#15945d,#0a6e46);color:#fff}
      .mvp-ai-venue-title{padding:2px 13px 8px}.mvp-ai-venue-title b{font-size:9px}.mvp-ai-venue-title small{margin-top:3px;color:#7898a4;letter-spacing:.02em}
      .mvp-ai-venues{padding:0 12px 12px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.mvp-ai-venues button{height:36px;border:1px solid rgba(99,166,188,.16);border-radius:8px;background:#07151c;color:#b8cbd2;font-size:8px;font-weight:1000}.mvp-ai-venues button[data-active="true"]{border-color:#ff9c35;background:linear-gradient(180deg,#9d5511,#6d3508);color:#fff;box-shadow:0 0 14px rgba(255,139,38,.18)}
      .mvp-ai-tech{margin:0 12px 10px;padding:9px 10px;border:1px solid rgba(99,166,188,.1);border-radius:8px;background:#050d11;color:#7f9ba6;font-size:7px;line-height:1.45}.mvp-ai-actions{padding:0 12px 12px}.mvp-ai-actions button{width:100%;height:32px;border:1px solid rgba(255,153,64,.2);border-radius:8px;background:#1b1008;color:#eab77e;font-size:7px;font-weight:900}
      @media(max-width:650px){#mvp-ai-audio-runtime{right:9px;bottom:78px}.mvp-ai-audio-trigger{width:52px;height:52px;border-radius:15px}.mvp-ai-audio-panel{right:0;bottom:62px;width:min(360px,calc(100vw - 18px))}}
    </style>`;
  document.body.appendChild(host);
  buttonNode = host.querySelector(".mvp-ai-audio-trigger");
  panelNode = host.querySelector(".mvp-ai-audio-panel");
  statusNode = host.querySelector("[data-status]");
  detailNode = host.querySelector("[data-detail]");
  const setOpen = (open: boolean) => { if (panelNode) panelNode.hidden = !open; };
  buttonNode?.addEventListener("click", () => setOpen(Boolean(panelNode?.hidden)));
  host.querySelector("[data-close]")?.addEventListener("click", () => setOpen(false));
  host.querySelector("[data-auto]")?.addEventListener("click", async () => {
    runtimeState.autoEnabled = !runtimeState.autoEnabled;
    if (runtimeState.autoEnabled) runtimeState.overrides = {};
    saveState();
    lastTrackId = "";
    await poll();
  });
  host.querySelectorAll<HTMLElement>("[data-venue]").forEach((node) => node.addEventListener("click", async () => {
    runtimeState.venue = (node.dataset.venue || "off") as VenueMode;
    venueOverride = false;
    saveState();
    lastTrackId = "";
    await poll();
  }));
  host.querySelector("[data-reset]")?.addEventListener("click", async () => {
    runtimeState.overrides = {};
    venueOverride = false;
    saveState();
    lastTrackId = "";
    await poll();
  });
}

export function installMusicAiAudioRuntime(masterPrepSink: MusicMasterPrepSink) {
  sink = masterPrepSink;
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
