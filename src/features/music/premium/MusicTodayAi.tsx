import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { startMvpNeuralRadio, useMusicPlayer } from "../../../lib/musicPlayer";
import {
  parseMusicTodayInput,
  readMusicTodayContext,
  saveMusicTodayContext,
  subscribeMusicTodayContext,
  type MusicTodayContext,
} from "../../../lib/musicTodayContext";
import "./MusicTodayAi.css";

function SparkIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden><path d="M12 2.8 13.7 8l5.2 1.7-5.2 1.7L12 16.6l-1.7-5.2-5.2-1.7L10.3 8 12 2.8Zm6.2 11.6.9 2.7 2.7.9-2.7.9-.9 2.7-.9-2.7-2.7-.9 2.7-.9.9-2.7Z"/></svg>;
}

function ArrowIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden><path d="M5 12h13M14 7l5 5-5 5"/></svg>;
}

function EditIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden><path d="m4.5 16.7-.8 3.6 3.6-.8L18.6 8.2l-2.8-2.8L4.5 16.7Zm9.7-9.7 2.8 2.8M15.8 5.4l1.3-1.3a1.6 1.6 0 0 1 2.3 0l.5.5a1.6 1.6 0 0 1 0 2.3l-1.3 1.3"/></svg>;
}

function SendIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden><path d="m3.2 4 17.6 8-17.6 8 3-7.1L15 12 6.2 11.1 3.2 4Z"/></svg>;
}

const EXAMPLES = [
  "Sore but relaxed and motivated",
  "Tired, low energy, keep it familiar",
  "Stressed, but I still want something heavy",
  "High energy. Faster and harder today",
];

export function MusicTodayAi() {
  const player = useMusicPlayer();
  const [context, setContext] = useState<MusicTodayContext | null>(() => readMusicTodayContext());
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [reply, setReply] = useState<MusicTodayContext | null>(null);
  const [steeringState, setSteeringState] = useState<"idle" | "applying" | "applied" | "waiting">("idle");
  const [mounted, setMounted] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => subscribeMusicTodayContext(setContext), []);
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => textareaRef.current?.focus(), 180);
    return () => window.clearTimeout(timer);
  }, [open]);

  const displayTags = useMemo(() => {
    if (!context) return [];
    return [...context.bodyTags, ...context.moodTags, ...context.intentTags].filter((value, index, values) => values.indexOf(value) === index).slice(0, 3);
  }, [context]);

  function beginChange() {
    setDraft(context?.rawInput ?? "");
    setReply(null);
    setSteeringState("idle");
    setOpen(true);
  }

  async function submit() {
    const value = draft.trim();
    if (!value) return;
    const next = saveMusicTodayContext(parseMusicTodayInput(value));
    setContext(next);
    setReply(next);
    if (!player.currentTrack) {
      setSteeringState("waiting");
      return;
    }
    setSteeringState("applying");
    try {
      startMvpNeuralRadio(player.currentTrack.id, next.radioMode);
      setSteeringState("applied");
    } catch {
      setSteeringState("waiting");
    }
  }

  function close() {
    setOpen(false);
    setReply(null);
    setSteeringState("idle");
  }

  const dialog = mounted ? createPortal(
    <AnimatePresence>
      {open ? <motion.div className="m39-todayBackdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.currentTarget === event.target) close(); }}>
        <motion.section className="m39-todayDialog" role="dialog" aria-modal="true" aria-label="Tell MVP how you feel today" initial={{ opacity: 0, y: 20, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 14, scale: .99 }} transition={{ type: "spring", stiffness: 420, damping: 38 }}>
          <div className="m39-todayAmbient" aria-hidden><i/><i/><i/></div>
          <header className="m39-todayDialogHead">
            <div className="m39-todayAiMark"><SparkIcon/></div>
            <div><span>MVP MUSIC AI</span><h3>How are you feeling today?</h3></div>
            <button type="button" onClick={close} aria-label="Close today music check-in">×</button>
          </header>

          <div className="m39-todayConversation">
            <motion.div className="m39-todayBubble is-ai" initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }}>
              <SparkIcon/><p>Tell me naturally. Mood, energy, soreness, stress, weather, what kind of workout you want, or exactly how you want the music to feel. I’ll use it for today without replacing what I already know you like.</p>
            </motion.div>
            {reply ? <motion.div className="m39-todayBubble is-user" initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }}><p>{reply.rawInput}</p></motion.div> : null}
            {reply ? <motion.div className="m39-todayBubble is-ai is-result" initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .05 }}>
              <SparkIcon/><div><p>{reply.response}</p><div className="m39-todayResultTags">{reply.directionTags.map((tag) => <b key={tag}>{tag}</b>)}</div><small>{steeringState === "applying" ? "RESHAPING THE QUEUE…" : steeringState === "applied" ? "TODAY’S STEERING IS LIVE" : "SAVED FOR TODAY • PLAY A SONG TO APPLY IT"}</small></div>
            </motion.div> : null}
          </div>

          {!reply ? <>
            <div className="m39-todayExamples" aria-label="Example today check-ins">
              {EXAMPLES.map((example) => <button type="button" key={example} onClick={() => { setDraft(example); textareaRef.current?.focus(); }}>{example}</button>)}
            </div>
            <div className="m39-todayComposer">
              <textarea ref={textareaRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void submit(); }} placeholder="Example: Sore from an injury, but relaxed and motivated…" rows={3}/>
              <motion.button type="button" disabled={!draft.trim()} onClick={() => void submit()} whileTap={{ scale: .94 }} aria-label="Send today music check-in"><SendIcon/></motion.button>
            </div>
          </> : <footer className="m39-todayDialogFooter"><button type="button" onClick={() => { setReply(null); setDraft(context?.rawInput ?? ""); setSteeringState("idle"); }}><EditIcon/> CHANGE IT</button><button type="button" className="is-done" onClick={close}>DONE <ArrowIcon/></button></footer>}
        </motion.section>
      </motion.div> : null}
    </AnimatePresence>, document.body) : null;

  return <>
    <div className={`m39-todayDock ${context ? "has-context" : ""}`} data-mvp-today-ai="r39">
      {!context ? <motion.button type="button" className="m39-todayAsk" onClick={beginChange} whileTap={{ scale: .985 }}>
        <span className="m39-todayAskIcon"><SparkIcon/></span>
        <span className="m39-todayAskCopy"><small>MVP MUSIC AI</small><strong>How are you feeling today?</strong></span>
        <span className="m39-todayAskAction">TELL MVP <ArrowIcon/></span>
      </motion.button> : <div className="m39-todayActive">
        <span className="m39-todayPulse" aria-hidden><i/></span>
        <div className="m39-todayActiveCopy"><small>PLAYING FOR TODAY</small><strong>{context.summary}</strong><span>{context.directionLabel}</span></div>
        <div className="m39-todayActiveTags">{displayTags.map((tag) => <b key={tag}>{tag}</b>)}</div>
        <motion.button type="button" onClick={beginChange} whileTap={{ scale: .96 }}><EditIcon/>CHANGE</motion.button>
      </div>}
    </div>
    {dialog}
  </>;
}
