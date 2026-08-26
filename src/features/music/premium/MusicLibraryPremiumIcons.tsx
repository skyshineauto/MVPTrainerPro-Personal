import previewPlay from "../../../assets/music-premium/preview-play.webp";
import previewPause from "../../../assets/music-premium/preview-pause.webp";

export function PreviewRenderIcon({ playing = false }: { playing?: boolean }) {
  return <img className="mlv-previewRenderIcon" src={playing ? previewPlay : previewPause} alt="" aria-hidden="true" draggable={false} />;
}

export function YouTubePremiumIcon() {
  return <svg className="mlv-premiumSvg mlv-youtubeSvg" viewBox="0 0 64 44" aria-hidden="true">
    <defs>
      <linearGradient id="ytRed" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#ff3353"/><stop offset="1" stopColor="#d90022"/></linearGradient>
      <filter id="ytGlow" x="-40%" y="-60%" width="180%" height="220%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <path filter="url(#ytGlow)" fill="url(#ytRed)" d="M61 9.6a8.2 8.2 0 0 0-5.8-5.8C50.1 2.4 32 2.4 32 2.4S13.9 2.4 8.8 3.8A8.2 8.2 0 0 0 3 9.6C1.6 14.7 1.6 22 1.6 22S1.6 29.3 3 34.4a8.2 8.2 0 0 0 5.8 5.8c5.1 1.4 23.2 1.4 23.2 1.4s18.1 0 23.2-1.4a8.2 8.2 0 0 0 5.8-5.8c1.4-5.1 1.4-12.4 1.4-12.4S62.4 14.7 61 9.6Z"/>
    <path fill="#fff" d="m26.2 31.1 15.1-9.1-15.1-9.1v18.2Z"/>
    <path fill="rgba(255,255,255,.35)" d="M10.5 7.3c8.8-1.9 34.1-1.9 43 0l-.9 2.1c-11.8-1.6-29.4-1.6-41.2 0l-.9-2.1Z"/>
  </svg>;
}

export function KeepPremiumIcon() {
  return <svg className="mlv-premiumSvg mlv-keepSvg" viewBox="0 0 64 52" aria-hidden="true">
    <defs>
      <linearGradient id="keepMetal" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#d9fff1"/><stop offset=".34" stopColor="#72ffbd"/><stop offset=".7" stopColor="#20d97a"/><stop offset="1" stopColor="#0a7b44"/></linearGradient>
      <filter id="keepGlow" x="-45%" y="-60%" width="190%" height="220%"><feGaussianBlur stdDeviation="2.1" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <path filter="url(#keepGlow)" d="M5 28.5 22.5 45 59 7" fill="none" stroke="url(#keepMetal)" strokeWidth="9" strokeLinecap="square" strokeLinejoin="miter"/>
    <path d="M8.5 26.4 23 39.8 54.2 8.3" fill="none" stroke="rgba(255,255,255,.58)" strokeWidth="2" strokeLinecap="square"/>
  </svg>;
}

export function MaybePremiumIcon() {
  return <svg className="mlv-premiumSvg mlv-maybeSvg" viewBox="0 0 72 54" aria-hidden="true">
    <defs>
      <linearGradient id="maybeGold" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fff7c7"/><stop offset=".28" stopColor="#ffd85b"/><stop offset=".7" stopColor="#ffae19"/><stop offset="1" stopColor="#b96a00"/></linearGradient>
      <filter id="maybeGlow" x="-30%" y="-45%" width="160%" height="190%"><feGaussianBlur stdDeviation="1.8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <path filter="url(#maybeGlow)" fill="none" stroke="url(#maybeGold)" strokeWidth="3.5" d="M9 6.5h54v31H31L20 47v-9.5H9z"/>
    <circle cx="27" cy="22" r="3.2" fill="url(#maybeGold)"/><circle cx="36" cy="22" r="3.2" fill="url(#maybeGold)"/><circle cx="45" cy="22" r="3.2" fill="url(#maybeGold)"/>
    <path d="M16 12h40" stroke="rgba(255,255,255,.38)" strokeWidth="1.3"/>
  </svg>;
}

export function PassPremiumIcon() {
  return <svg className="mlv-premiumSvg mlv-passSvg" viewBox="0 0 58 58" aria-hidden="true">
    <defs>
      <linearGradient id="passRed" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#ffb3b9"/><stop offset=".26" stopColor="#ff5566"/><stop offset=".7" stopColor="#ec2438"/><stop offset="1" stopColor="#8d0718"/></linearGradient>
      <filter id="passGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <path filter="url(#passGlow)" d="m9 9 40 40M49 9 9 49" stroke="url(#passRed)" strokeWidth="9" strokeLinecap="square"/>
    <path d="m12 10 36 36M46 10 10 46" stroke="rgba(255,255,255,.32)" strokeWidth="1.5"/>
  </svg>;
}

export function UploadPremiumIcon() {
  return <svg className="mlv-premiumSvg mlv-uploadSvg" viewBox="0 0 72 58" aria-hidden="true">
    <defs>
      <linearGradient id="uploadMetal" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#d9f9ff"/><stop offset=".32" stopColor="#55dcff"/><stop offset=".68" stopColor="#1a8dff"/><stop offset="1" stopColor="#0c3aa7"/></linearGradient>
      <linearGradient id="uploadArrow" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#fff4c2"/><stop offset=".35" stopColor="#ffbd36"/><stop offset="1" stopColor="#ff7a00"/></linearGradient>
      <filter id="uploadGlow" x="-35%" y="-45%" width="170%" height="190%"><feGaussianBlur stdDeviation="1.8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <path filter="url(#uploadGlow)" d="M20 45H14C7.9 45 3 40.1 3 34s4.9-11 11-11h1.2C17.9 13 27 6 37.6 6c11.6 0 21.2 8.4 23.2 19.5A10.8 10.8 0 0 1 69 36c0 6-4.8 10.9-10.8 10.9H51" fill="none" stroke="url(#uploadMetal)" strokeWidth="4.2" strokeLinecap="round"/>
    <path d="M36 49V22m0 0-10 10m10-10 10 10" fill="none" stroke="url(#uploadArrow)" strokeWidth="5" strokeLinecap="square" strokeLinejoin="miter"/>
    <path d="M12 28c3-7.3 9.3-11.7 17.2-12.8" stroke="rgba(255,255,255,.36)" strokeWidth="1.4" fill="none"/>
  </svg>;
}

export function ChevronPremiumIcon({ direction }: { direction: "left" | "right" }) {
  const path = direction === "left" ? "M30 5 10 24l20 19" : "M10 5l20 19-20 19";
  return <svg className="mlv-premiumSvg mlv-chevronSvg" viewBox="0 0 40 48" aria-hidden="true"><path d={path} fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="miter" strokeLinecap="square"/><path d={path} transform="translate(4 0)" fill="none" stroke="rgba(75,216,255,.28)" strokeWidth="1"/></svg>;
}

export function MorePremiumIcon() {
  return <svg className="mlv-premiumSvg mlv-moreSvg" viewBox="0 0 56 18" aria-hidden="true"><path d="M5 9h8M24 9h8M43 9h8" stroke="currentColor" strokeWidth="4" strokeLinecap="square"/></svg>;
}
