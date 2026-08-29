import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { MusicTrack } from "../../lib/musicStorage";
import { playMusicTrack, useMusicPlayer } from "../../lib/musicPlayer";
import {
  getActiveRadioMode,
  getAdaptiveDecisionPreview,
  getPlaybackCycleStatus,
  getSongDna,
  getWorkoutMusicStage,
  isAutoMixEnabled,
  radioModeLabel,
  setAutoMixEnabled,
} from "../../lib/musicIntelligence";
import { PlayPremiumIcon, SparkPremiumIcon } from "./premium/MusicLibraryPremiumIcons";
import { readMusicTodayContext, subscribeMusicTodayContext, type MusicTodayContext } from "../../lib/musicTodayContext";

const SETTINGS_KEY = "mvp_music_intelligence_settings_v2";

type IntelligenceSettings = {
  continuousLearning: boolean;
  learnLikes: boolean;
  learnSkips: boolean;
  learnSteering: boolean;
  workoutAware: boolean;
  todayInfluence: boolean;
  repeatProtection: boolean;
  artistRepeatLimit: number;
  recentSongCooldownHours: number;
  discoveryLevel: "focused" | "balanced" | "adventurous";
  rediscoveryStrength: "light" | "balanced" | "strong";
};

const DEFAULT_SETTINGS: IntelligenceSettings = {
  continuousLearning: true,
  learnLikes: true,
  learnSkips: true,
  learnSteering: true,
  workoutAware: true,
  todayInfluence: true,
  repeatProtection: true,
  artistRepeatLimit: 2,
  recentSongCooldownHours: 18,
  discoveryLevel: "balanced",
  rediscoveryStrength: "balanced",
};

function readSettings(): IntelligenceSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function candidateReason(track: MusicTrack, current: MusicTrack, mode: ReturnType<typeof getActiveRadioMode>) {
  const dna = getSongDna(track);
  const base = getSongDna(current);
  if (mode === "heavier") return `HEAVY ${dna.heavy} • FRESH THIS CYCLE`;
  if (mode === "harder") return `WORKOUT FIT ${dna.workoutFit} • FRESH THIS CYCLE`;
  if (mode === "faster") return `DRIVE ${dna.drive} • FRESH THIS CYCLE`;
  if (mode === "melodic") return `MELODIC ${dna.melodic} • FRESH THIS CYCLE`;
  if (mode === "darker") return `DARK ${dna.dark} • FRESH THIS CYCLE`;
  if (mode === "surprise") return `FRESH CONTRAST • WORKOUT FIT ${dna.workoutFit}`;
  const delta = Math.abs(dna.workoutFit - base.workoutFit);
  return `${dna.workoutFit} WORKOUT FIT • ${delta <= 12 ? "CLOSE ENERGY" : "FRESH VARIATION"}`;
}

function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (next: boolean) => void; label: string; description: string }) {
  return <button type="button" className={`m38-intelSetting ${checked ? "is-on" : ""}`} aria-pressed={checked} onClick={() => onChange(!checked)}>
    <span><strong>{label}</strong><small>{description}</small></span><i aria-hidden><b/></i>
  </button>;
}

export function MusicIntelligencePanel({ tracks }: { tracks: MusicTrack[] }) {
  const player = useMusicPlayer();
  const [autoMix, setAutoMix] = useState(() => isAutoMixEnabled());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<IntelligenceSettings>(() => readSettings());
  const [todayContext, setTodayContext] = useState<MusicTodayContext | null>(() => readMusicTodayContext());
  const current = player.currentTrack;
  const mode = getActiveRadioMode();
  const stage = getWorkoutMusicStage();
  const cycle = useMemo(() => getPlaybackCycleStatus(tracks), [tracks, player.currentTrack?.id]);
  const candidates = useMemo(() => current ? getAdaptiveDecisionPreview(current, tracks, 5) : [], [current?.id, current?.updated_at, tracks, mode]);
  const liked = useMemo(() => tracks.filter((track) => track.favorite), [tracks]);
  const dna = current ? getSongDna(current) : null;

  useEffect(() => {
    try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* optional */ }
    window.dispatchEvent(new CustomEvent("mvp:music-intelligence-settings", { detail: settings }));
  }, [settings]);

  useEffect(() => subscribeMusicTodayContext(setTodayContext), []);

  const why = current && dna ? [
    { label: "TASTE MATCH", value: `${Math.min(99, Math.max(55, Math.round((dna.workoutFit + dna.melodic + dna.heavy) / 3)))}%` },
    { label: "WORKOUT FIT", value: `${dna.workoutFit}%` },
    { label: "STAGE", value: stage === "off" ? "LIBRARY" : stage.toUpperCase() },
    { label: "VARIETY", value: "FRESH" },
  ] : [];

  const learnedSignals = [
    `${liked.length} liked`,
    `${cycle.played} heard this cycle`,
    mode ? `${radioModeLabel(mode)} steering` : "taste steering neutral",
  ];

  return <section className="m38-intel" aria-label="MVP Music Intelligence">
    <header className="m38-intelHead">
      <div className="m38-intelTitle"><span>MVP INTELLIGENCE</span><h2>Music Decision Engine</h2><p>Long-term taste, recent rotation and what you want right now.</p></div>
      <div className="m38-intelHeadActions">
        <motion.button type="button" className={`m38-autoMix ${autoMix ? "is-active" : ""}`} aria-pressed={autoMix} onClick={() => { const next = !autoMix; setAutoMix(next); setAutoMixEnabled(next); }} whileTap={{scale:.97}}><SparkPremiumIcon/><span><b>AUTOMIX</b><small>{autoMix ? "LIVE" : "OFF"}</small></span></motion.button>
        <motion.button type="button" className="m38-intelSettingsButton" onClick={() => setSettingsOpen(true)} whileTap={{scale:.97}} aria-label="Open Intelligence settings"><svg viewBox="0 0 24 24" aria-hidden><path d="M4 7h10M18 7h2M4 17h2M10 17h10M8 14v6M16 4v6"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg><b>SETTINGS</b></motion.button>
      </div>
    </header>

    <section className="m38-intelDecision">
      <div className="m38-intelCurrent">
        <span className="m38-intelEyebrow">NOW / MVP DECISION</span>
        <h3>{current?.title || "Nothing playing"}</h3>
        <p>{current?.artist || "Start a song to activate the decision engine"}</p>
        <div className="m38-intelTags">
          {stage !== "off" ? <b>{stage.toUpperCase()}</b> : <b>LIBRARY</b>}
          <b>{mode ? radioModeLabel(mode).toUpperCase() : "TASTE + VARIETY"}</b>
          <b>{settings.repeatProtection ? "REPEAT PROTECTION" : "REPEATS OPEN"}</b>
        </div>
      </div>
      <div className="m38-intelWhy">
        <span className="m38-intelEyebrow">WHY MVP CHOSE IT</span>
        {why.length ? <div className="m38-intelWhyGrid">{why.map((item) => <div key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>)}</div> : <p>Waiting for playback.</p>}
      </div>
      <div className={`m38-intelToday ${todayContext && settings.todayInfluence ? "has-context" : ""}`}>
        <span className="m38-intelEyebrow">TODAY / PLAYER CONTEXT</span>
        <strong>{todayContext && settings.todayInfluence ? todayContext.summary : settings.todayInfluence ? "Waiting for check-in" : "Paused"}</strong>
        {todayContext && settings.todayInfluence ? <>
          <p>{todayContext.directionLabel}</p>
          <div className="m38-intelTodayChips">{[...todayContext.bodyTags, ...todayContext.moodTags, ...todayContext.intentTags].filter((value,index,values)=>values.indexOf(value)===index).slice(0,4).map((tag)=><b key={tag}>{tag}</b>)}</div>
          <small>Temporary steering for today • long-term taste stays intact</small>
        </> : <p>{settings.todayInfluence ? "Answer the player’s How are you feeling today? prompt to add temporary mood, energy and intent steering." : "Today mood influence is paused in Intelligence settings."}</p>}
      </div>
    </section>

    <section className="m38-intelNext">
      <header><div><span>NEXT</span><h3>Top candidates</h3></div><b>{mode ? `${radioModeLabel(mode)} ACTIVE` : "LIVE RANKING"}</b></header>
      <div className="m38-intelCandidates">
        {current && candidates.length ? candidates.map((entry, index) => {
          const entryDna = getSongDna(entry.track);
          return <motion.article key={entry.track.id} layout transition={{ type:"spring", stiffness:420, damping:38 }}>
            <b className="m38-intelRank">{String(index+1).padStart(2,"0")}</b>
            <div className="m38-intelCandidateCopy"><strong>{entry.track.title}</strong><span>{entry.track.artist || "Unknown Artist"}</span><small>{candidateReason(entry.track,current,mode)}</small></div>
            <div className="m38-intelCandidateSignals"><span>TASTE <b>{Math.round((entryDna.melodic + entryDna.heavy + entryDna.workoutFit) / 3)}</b></span><span>FIT <b>{entryDna.workoutFit}</b></span></div>
            <em><small>MVP SCORE</small>{Math.round(entry.score)}</em>
            <motion.button type="button" onClick={() => void playMusicTrack(entry.track.id,0)} aria-label={`Play ${entry.track.title}`} whileTap={{scale:.94}}><PlayPremiumIcon/></motion.button>
          </motion.article>;
        }) : <p className="m38-intelEmpty">No candidates yet.</p>}
      </div>
    </section>

    <section className="m38-intelMemory">
      <div><span>ACTIVE STEERING</span><strong>{mode ? radioModeLabel(mode) : "Neutral"}</strong><small>Ranks remaining eligible songs</small></div>
      <div><span>REPEAT PROTECTION</span><strong>{cycle.remaining}</strong><small>{cycle.played} played • {cycle.eligible} eligible</small></div>
      <div><span>WHAT MVP LEARNED</span><strong>{learnedSignals[0]}</strong><small>{learnedSignals.slice(1).join(" • ")}</small></div>
    </section>

    <AnimatePresence>
      {settingsOpen ? <motion.div className="m38-intelBackdrop" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onMouseDown={(event) => { if (event.currentTarget === event.target) setSettingsOpen(false); }}>
        <motion.aside className="m38-intelDrawer" initial={{x:34,opacity:0}} animate={{x:0,opacity:1}} exit={{x:26,opacity:0}} transition={{type:"spring",stiffness:420,damping:40}} aria-label="Music Intelligence settings">
          <header><div><span>MVP INTELLIGENCE</span><h3>Learning Settings</h3><p>MVP manages the weighting automatically. These controls define how it is allowed to learn and vary your music.</p></div><button type="button" onClick={() => setSettingsOpen(false)} aria-label="Close settings">×</button></header>
          <div className="m38-intelSettingsList">
            <Toggle checked={settings.continuousLearning} onChange={(value) => setSettings((s)=>({...s,continuousLearning:value}))} label="Continuous Learning" description="Keep adapting to listening behavior over time."/>
            <Toggle checked={settings.learnLikes} onChange={(value) => setSettings((s)=>({...s,learnLikes:value}))} label="Learn From Likes" description="Use likes as strong positive taste signals."/>
            <Toggle checked={settings.learnSkips} onChange={(value) => setSettings((s)=>({...s,learnSkips:value}))} label="Learn From Skips" description="Repeated quick skips reduce similar choices."/>
            <Toggle checked={settings.learnSteering} onChange={(value) => setSettings((s)=>({...s,learnSteering:value}))} label="Learn From Steering" description="Harder, Heavier, Faster, Melodic and other controls guide taste."/>
            <Toggle checked={settings.workoutAware} onChange={(value) => setSettings((s)=>({...s,workoutAware:value}))} label="Workout-Aware Selection" description="Use warm-up, working sets, heavy sets and finishers."/>
            <Toggle checked={settings.todayInfluence} onChange={(value) => setSettings((s)=>({...s,todayInfluence:value}))} label="Today Mood Influence" description="Let today's check-in temporarily steer music direction."/>
            <Toggle checked={settings.repeatProtection} onChange={(value) => setSettings((s)=>({...s,repeatProtection:value}))} label="Repeat Protection" description="Prefer unheard eligible tracks before repeating."/>
          </div>
          <section className="m38-intelTuning">
            <label><span>ARTIST REPEAT LIMIT</span><select value={settings.artistRepeatLimit} onChange={(e)=>setSettings((s)=>({...s,artistRepeatLimit:Number(e.target.value)}))}><option value={1}>1 track</option><option value={2}>2 tracks</option><option value={3}>3 tracks</option><option value={4}>4 tracks</option></select></label>
            <label><span>RECENT SONG COOLDOWN</span><select value={settings.recentSongCooldownHours} onChange={(e)=>setSettings((s)=>({...s,recentSongCooldownHours:Number(e.target.value)}))}><option value={6}>6 hours</option><option value={12}>12 hours</option><option value={18}>18 hours</option><option value={24}>24 hours</option><option value={48}>48 hours</option></select></label>
            <label><span>DISCOVERY LEVEL</span><select value={settings.discoveryLevel} onChange={(e)=>setSettings((s)=>({...s,discoveryLevel:e.target.value as IntelligenceSettings["discoveryLevel"]}))}><option value="focused">Focused</option><option value="balanced">Balanced</option><option value="adventurous">Adventurous</option></select></label>
            <label><span>REDISCOVERY STRENGTH</span><select value={settings.rediscoveryStrength} onChange={(e)=>setSettings((s)=>({...s,rediscoveryStrength:e.target.value as IntelligenceSettings["rediscoveryStrength"]}))}><option value="light">Light</option><option value="balanced">Balanced</option><option value="strong">Strong</option></select></label>
          </section>
          <footer><button type="button" onClick={() => setSettings(DEFAULT_SETTINGS)}>RESET DEFAULTS</button><button type="button" className="is-done" onClick={() => setSettingsOpen(false)}>DONE</button></footer>
        </motion.aside>
      </motion.div> : null}
    </AnimatePresence>
  </section>;
}
