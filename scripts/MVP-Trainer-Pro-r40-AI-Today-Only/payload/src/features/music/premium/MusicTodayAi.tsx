import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
  type MouseEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { useMusicPlayer } from "../../../lib/musicPlayer";
import {
  activateMusicToday,
  ensureMusicTodayPlaybackMode,
  getMusicTodaySnapshot,
  isMusicTodayQueueName,
  subscribeMusicToday,
} from "../../../lib/musicToday";
import "./MusicTodayAi.css";

type Placement = {
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
  width: number;
};

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.6c.8 4.6 2.8 6.7 7.4 7.4-4.6.8-6.6 2.8-7.4 7.4-.8-4.6-2.8-6.6-7.4-7.4 4.6-.7 6.6-2.8 7.4-7.4Z" />
      <path d="M19.2 15.4c.3 1.9 1.2 2.8 3.1 3.1-1.9.3-2.8 1.2-3.1 3.1-.3-1.9-1.2-2.8-3.1-3.1 1.9-.3 2.8-1.2 3.1-3.1Z" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h13" />
      <path d="m13.5 6.5 5.5 5.5-5.5 5.5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

function useMobile() {
  const [mobile, setMobile] = useState(() => typeof window !== "undefined" && window.innerWidth <= 650);
  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth <= 650);
    window.addEventListener("resize", onResize, { passive: true });
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return mobile;
}

function usePlacement(rootRef: RefObject<HTMLDivElement | null>, mobile: boolean) {
  const [placement, setPlacement] = useState<Placement>({ right: 104, bottom: 12, width: 430 });

  useLayoutEffect(() => {
    const root = rootRef.current;
    const hero = root?.closest(".tr-playerHero") as HTMLElement | null;
    if (!root || !hero) return;

    let frame = 0;
    const calculate = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const heroRect = hero.getBoundingClientRect();
        const artwork = hero.querySelector(".tr-audioArtwork") as HTMLElement | null;
        const dsp = hero.querySelector(".tr-dspPlayerCornerDock") as HTMLElement | null;

        if (mobile && artwork) {
          const artRect = artwork.getBoundingClientRect();
          const artLeft = Math.max(0, artRect.left - heroRect.left);
          const available = Math.max(42, artLeft - 20);
          const width = Math.max(42, Math.min(138, available - 10));
          const top = Math.max(8, artRect.top - heroRect.top + Math.max(0, (artRect.height - 42) / 2));
          setPlacement({ left: 10, top, width });
          return;
        }

        if (dsp) {
          const dspRect = dsp.getBoundingClientRect();
          const dspLeft = dspRect.left - heroRect.left;
          const artRight = artwork ? artwork.getBoundingClientRect().right - heroRect.left : 0;
          const leftLimit = Math.max(artRight + 18, heroRect.width * 0.28);
          const available = Math.max(260, dspLeft - leftLimit - 14);
          const width = Math.min(520, available);
          const right = Math.max(92, heroRect.right - dspRect.left + 12);
          const bottom = Math.max(10, heroRect.bottom - dspRect.bottom);
          setPlacement({ right, bottom, width });
          return;
        }

        setPlacement({ right: 100, bottom: 12, width: Math.min(500, Math.max(280, heroRect.width * 0.46)) });
      });
    };

    calculate();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(calculate) : null;
    observer?.observe(hero);
    window.addEventListener("resize", calculate, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", calculate);
    };
  }, [mobile, rootRef]);

  return placement;
}

function placementStyle(placement: Placement): CSSProperties {
  return {
    left: placement.left,
    right: placement.right,
    top: placement.top,
    bottom: placement.bottom,
    width: placement.width,
  };
}

export function MusicTodayAi() {
  const player = useMusicPlayer();
  const today = useSyncExternalStore(subscribeMusicToday, getMusicTodaySnapshot, getMusicTodaySnapshot);
  const mobile = useMobile();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const placement = usePlacement(rootRef, mobile);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const mobileInputRef = useRef<HTMLTextAreaElement | null>(null);
  const responseTimer = useRef<number | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showResponse, setShowResponse] = useState(false);

  const active = isMusicTodayQueueName(player.activePlaylistName) && Boolean(today.prompt);
  const compactTags = today.tags.slice(0, mobile ? 2 : 3).join(" · ");

  useEffect(() => {
    if (!isMusicTodayQueueName(player.activePlaylistName)) return;
    if (player.shuffle || player.repeat !== "all") ensureMusicTodayPlaybackMode();
  }, [player.activePlaylistName, player.repeat, player.shuffle]);

  useEffect(() => {
    if (!editing || mobile) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(timer);
  }, [editing, mobile]);

  useEffect(() => {
    if (!sheetOpen) return;
    const timer = window.setTimeout(() => mobileInputRef.current?.focus(), 140);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSheetOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [sheetOpen]);

  useEffect(() => () => {
    if (responseTimer.current != null) window.clearTimeout(responseTimer.current);
  }, []);

  const runToday = async (value: string) => {
    const prompt = value.trim();
    if (!prompt || busy) return;
    setBusy(true);
    setError("");
    try {
      await activateMusicToday(prompt);
      setDraft("");
      setEditing(false);
      setShowResponse(true);
      if (responseTimer.current != null) window.clearTimeout(responseTimer.current);
      responseTimer.current = window.setTimeout(() => {
        setShowResponse(false);
        responseTimer.current = null;
      }, 5200);
      if (mobile) {
        window.setTimeout(() => setSheetOpen(false), 2200);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "MVP could not build Today right now.");
    } finally {
      setBusy(false);
    }
  };

  const submitDesktop = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runToday(draft);
  };

  const openChange = () => {
    setDraft(today.prompt || "");
    setError("");
    if (mobile) setSheetOpen(true);
    else setEditing(true);
  };

  const mobileTriggerLabel = active && compactTags ? compactTags : "AI Today";

  return (
    <>
      <div
        ref={rootRef}
        className={`mvp-today-root ${mobile ? "is-mobile" : "is-desktop"} ${active ? "is-active" : ""}`}
        style={placementStyle(placement)}
        data-mvp-today-ai="r40"
      >
        {mobile ? (
          <motion.button
            type="button"
            className="mvp-today-mobileTrigger"
            onClick={openChange}
            whileTap={{ scale: 0.97 }}
            aria-label={active ? `AI Today: ${compactTags}. Change how you feel.` : "Tell MVP how you are feeling today"}
          >
            <span className="mvp-today-spark"><SparkIcon /></span>
            <span>{mobileTriggerLabel}</span>
          </motion.button>
        ) : (
          <div className="mvp-today-desktopShell">
            <AnimatePresence>
              {showResponse && today.reply ? (
                <motion.div
                  className="mvp-today-response"
                  initial={{ opacity: 0, y: 8, scale: 0.985 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6, scale: 0.99 }}
                  transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
                  role="status"
                >
                  <span className="mvp-today-responseSpark"><SparkIcon /></span>
                  <div>
                    <strong>MVP TODAY</strong>
                    <p>{today.reply}</p>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>

            {active && !editing ? (
              <motion.div
                className="mvp-today-activeBar"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <span className="mvp-today-spark"><SparkIcon /></span>
                <div className="mvp-today-activeCopy">
                  <small>PLAYING FOR TODAY</small>
                  <strong>{compactTags || "Your mood"}</strong>
                </div>
                <span className="mvp-today-direction">{today.direction}</span>
                <button type="button" onClick={openChange}>Change</button>
              </motion.div>
            ) : (
              <motion.form
                className="mvp-today-command"
                onSubmit={submitDesktop}
                initial={false}
                animate={{ scale: editing ? 1.006 : 1 }}
                transition={{ duration: 0.16 }}
              >
                <span className="mvp-today-spark"><SparkIcon /></span>
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setDraft(event.target.value)}
                  onFocus={() => setEditing(true)}
                  placeholder="How are you feeling today?"
                  aria-label="How are you feeling today?"
                  maxLength={220}
                  disabled={busy}
                />
                {editing && active ? (
                  <button type="button" className="mvp-today-cancel" onClick={() => { setEditing(false); setDraft(""); setError(""); }}>
                    Cancel
                  </button>
                ) : null}
                <button className="mvp-today-send" type="submit" disabled={busy || !draft.trim()} aria-label="Build and play my AI Today queue">
                  {busy ? <span className="mvp-today-loader" /> : <ArrowIcon />}
                </button>
              </motion.form>
            )}
            {error ? <div className="mvp-today-error" role="alert">{error}</div> : null}
          </div>
        )}
      </div>

      {mobile && typeof document !== "undefined" ? createPortal(
        <AnimatePresence>
          {sheetOpen ? (
            <motion.div
              className="mvp-today-sheetBack"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onMouseDown={() => setSheetOpen(false)}
            >
              <motion.section
                className="mvp-today-sheet"
                role="dialog"
                aria-modal="true"
                aria-label="AI Today"
                initial={{ y: 42, opacity: 0, scale: 0.985 }}
                animate={{ y: 0, opacity: 1, scale: 1 }}
                exit={{ y: 28, opacity: 0, scale: 0.99 }}
                transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
                onMouseDown={(event: MouseEvent<HTMLElement>) => event.stopPropagation()}
              >
                <header>
                  <span className="mvp-today-sheetMark"><SparkIcon /></span>
                  <div>
                    <small>MVP AI TODAY</small>
                    <h3>How are you feeling today?</h3>
                  </div>
                  <button type="button" onClick={() => setSheetOpen(false)} aria-label="Close AI Today"><CloseIcon /></button>
                </header>

                {active && today.tags.length ? (
                  <div className="mvp-today-sheetCurrent">
                    <small>PLAYING FOR TODAY</small>
                    <strong>{today.tags.slice(0, 3).join(" · ")}</strong>
                    <span>{today.direction}</span>
                  </div>
                ) : null}

                <form onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void runToday(draft); }}>
                  <textarea
                    ref={mobileInputRef}
                    value={draft}
                    onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setDraft(event.target.value)}
                    placeholder="Example: sore but relaxed, clear minded and motivated"
                    maxLength={220}
                    rows={3}
                    disabled={busy}
                  />
                  <button type="submit" disabled={busy || !draft.trim()}>
                    {busy ? <span className="mvp-today-loader" /> : <SparkIcon />}
                    <span>{busy ? "BUILDING TODAY…" : active ? "CHANGE & PLAY" : "BUILD & PLAY"}</span>
                    {!busy ? <ArrowIcon /> : null}
                  </button>
                </form>

                {error ? <div className="mvp-today-sheetError" role="alert">{error}</div> : null}
                {showResponse && today.reply ? <p className="mvp-today-sheetReply">{today.reply}</p> : null}
              </motion.section>
            </motion.div>
          ) : null}
        </AnimatePresence>,
        document.body,
      ) : null}
    </>
  );
}
