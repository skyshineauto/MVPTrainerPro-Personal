import type { ReactNode } from "react";
function IconShell({ className, viewBox = "0 0 64 64", children }: { className: string; viewBox?: string; children: ReactNode }) {
  return <svg className={`mlv-premiumSvg ${className}`} viewBox={viewBox} fill="none" aria-hidden="true" focusable="false">{children}</svg>;
}

export function PreviewRenderIcon({ playing = false }: { playing?: boolean }) {
  return <IconShell className={`mlv-previewRenderIcon ${playing ? "is-playing" : "is-idle"}`}>
    <defs>
      <linearGradient id="mlvPreviewEdge" x1="11" y1="8" x2="53" y2="56" gradientUnits="userSpaceOnUse"><stop stopColor="#e7f4ff"/><stop offset=".46" stopColor="#1288f5"/><stop offset="1" stopColor="#f39a1f"/></linearGradient>
      <radialGradient id="mlvPreviewCore" cx="0" cy="0" r="1" gradientTransform="translate(22 17) rotate(47) scale(47)"><stop stopColor="#153948"/><stop offset=".58" stopColor="#07171f"/><stop offset="1" stopColor="#02080c"/></radialGradient>
      <filter id="mlvPreviewGlow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <circle cx="32" cy="32" r="27" fill="url(#mlvPreviewCore)" stroke="rgba(255,255,255,.08)" />
    <circle cx="32" cy="32" r="26" stroke="url(#mlvPreviewEdge)" strokeWidth="1.4" opacity=".9" />
    <path d="M15 17.5C21 11 29 8 37 9" stroke="#fff" strokeOpacity=".2" strokeWidth="1.5" strokeLinecap="round" />
    {playing ? <g filter="url(#mlvPreviewGlow)"><rect x="24" y="20" width="6" height="24" rx="2" fill="#dffaff"/><rect x="34" y="20" width="6" height="24" rx="2" fill="#6ebeff"/></g> : <path d="M26 20.5 43 32 26 43.5V20.5Z" fill="#e9fcff" stroke="#5bb1ff" strokeWidth="1" filter="url(#mlvPreviewGlow)"/>}
    {playing ? <g opacity=".75"><rect x="16" y="48" width="3" height="5" rx="1.5" fill="#1288f5"/><rect x="21" y="45" width="3" height="8" rx="1.5" fill="#65b8ff"/><rect x="26" y="47" width="3" height="6" rx="1.5" fill="#1288f5"/><rect x="31" y="43" width="3" height="10" rx="1.5" fill="#f4fdff"/><rect x="36" y="46" width="3" height="7" rx="1.5" fill="#68baff"/><rect x="41" y="44" width="3" height="9" rx="1.5" fill="#ffb64d"/><rect x="46" y="48" width="3" height="5" rx="1.5" fill="#f39a1f"/></g> : null}
  </IconShell>;
}

export function YouTubePremiumIcon() { return <IconShell className="mlv-youtubeRender"><rect x="9" y="17" width="46" height="30" rx="10" fill="#12070a" stroke="#ff5e6d" strokeWidth="2"/><path d="M28 24.5 42 32 28 39.5v-15Z" fill="#fff"/><path d="M14 19h25" stroke="#fff" strokeOpacity=".15" strokeLinecap="round"/></IconShell>; }
export function KeepPremiumIcon() { return <IconShell className="mlv-keepRender"><path d="M13 34 26 46 52 18" stroke="#63f0a2" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"/><path d="M14 31 26 42 48 20" stroke="#eafff3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity=".75"/></IconShell>; }
export function MaybePremiumIcon() { return <IconShell className="mlv-maybeRender"><path d="M14 15h36v27H31l-11 8v-8h-6V15Z" stroke="#f3bc55" strokeWidth="3" strokeLinejoin="round"/><path d="M24 28h16M24 34h10" stroke="#fff1c7" strokeWidth="2.5" strokeLinecap="round"/></IconShell>; }
export function PassPremiumIcon() { return <IconShell className="mlv-passRender"><path d="M18 18 46 46M46 18 18 46" stroke="#ff6674" strokeWidth="6" strokeLinecap="round"/><path d="M20 18 46 44" stroke="#ffd8dc" strokeWidth="1.5" strokeLinecap="round" opacity=".55"/></IconShell>; }
export function UploadPremiumIcon() { return <IconShell className="mlv-uploadRender"><path d="M32 43V14M20 26l12-12 12 12" stroke="#3aa7ff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/><path d="M14 39v9h36v-9" stroke="#ffb64d" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/></IconShell>; }
export function ChevronPremiumIcon({ direction }: { direction: "left" | "right" }) { return <IconShell className="mlv-chevronRender" viewBox="0 0 24 40"><path d={direction === "left" ? "M17 6 6 20l11 14" : "M7 6l11 14L7 34"} stroke="#d7ecff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/><path d={direction === "left" ? "M15 9 8 20l7 11" : "M9 9l7 11-7 11"} stroke="#1288f5" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity=".72"/></IconShell>; }
export function MorePremiumIcon() { return <IconShell className="mlv-moreRender" viewBox="0 0 72 24"><circle cx="12" cy="12" r="3" fill="#66baff"/><circle cx="36" cy="12" r="3" fill="#d7ecff"/><circle cx="60" cy="12" r="3" fill="#ffb64d"/></IconShell>; }
