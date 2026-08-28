import type { ReactNode } from "react";

function IconShell({ className, viewBox = "0 0 64 64", children }: { className: string; viewBox?: string; children: ReactNode }) {
  return <svg className={`mlv-premiumSvg ${className}`} viewBox={viewBox} fill="none" aria-hidden="true" focusable="false">{children}</svg>;
}

export function TrackPlayIcon({ playing = false }: { playing?: boolean }) {
  return <IconShell className={`mlv-trackTransport ${playing ? "is-playing" : "is-idle"}`}>
    <circle cx="32" cy="32" r="24" fill="#050A0F" stroke="#20313D" strokeWidth="1.35" />
    <circle cx="32" cy="32" r="21.6" stroke={playing ? "#22A5ED" : "#7C919C"} strokeOpacity={playing ? ".72" : ".28"} strokeWidth="1" />
    <path d="M18.5 19.2c5.1-5.2 12.4-7.5 19.7-6.5" stroke="#fff" strokeOpacity=".13" strokeWidth="1.15" strokeLinecap="round" />
    {playing ? <g><rect x="23.2" y="20" width="6.2" height="24" rx="2" fill="#F4FAFD"/><rect x="34.6" y="20" width="6.2" height="24" rx="2" fill="#22A5ED"/></g> : <path d="M26.2 20.7 42.8 32 26.2 43.3V20.7Z" fill="#F5FAFD" />}
    <path d="M20 47.1c5.2 3 11.9 4 18.1 2.1" stroke="#0361DF" strokeOpacity=".38" strokeWidth="1" strokeLinecap="round" />
  </IconShell>;
}

export function InlinePlayIcon({ playing = false }: { playing?: boolean }) {
  return <IconShell className={`mlv-inlineTransport ${playing ? "is-playing" : "is-idle"}`} viewBox="0 0 24 24">
    {playing
      ? <g><rect x="6.4" y="5.2" width="3.6" height="13.6" rx="1.35" fill="currentColor"/><rect x="14" y="5.2" width="3.6" height="13.6" rx="1.35" fill="currentColor"/></g>
      : <path d="M8.3 5.6 18.2 12 8.3 18.4V5.6Z" fill="currentColor" stroke="currentColor" strokeWidth=".55" strokeLinejoin="round"/>}
  </IconShell>;
}

export function ShufflePremiumIcon() {
  return <IconShell className="mlv-inlineTransport" viewBox="0 0 24 24"><path d="M4.5 7h2.2c4.7 0 5.6 10 10.6 10h2.2M16.5 14l3 3-3 3M4.5 17h2.2c2.4 0 3.7-2.7 5-5.2 1.2-2.3 2.5-4.8 5.6-4.8h2.4M16.5 4l3 3-3 3" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round"/></IconShell>;
}

export function ExportPremiumIcon() {
  return <IconShell className="mlv-inlineTransport" viewBox="0 0 24 24"><path d="M12 15V4.5M8.2 8.2 12 4.4l3.8 3.8M5 12.5V19h14v-6.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></IconShell>;
}

export function ReorderPremiumIcon({ direction }: { direction: "up" | "down" }) {
  return <IconShell className="mlv-reorderIcon" viewBox="0 0 24 24"><path d={direction === "up" ? "M6.5 14.5 12 9l5.5 5.5" : "M6.5 9.5 12 15l5.5-5.5"} stroke="#9EB5C2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d={direction === "up" ? "M8.5 16.5h7" : "M8.5 7.5h7"} stroke="#22A5ED" strokeOpacity=".52" strokeWidth="1.25" strokeLinecap="round"/></IconShell>;
}

export function LikeActionIcon() { return <IconShell className="mlv-actionIcon" viewBox="0 0 24 24"><path d="M12 20.1 4.9 13.4C1.4 10.1 3.1 5.4 7.2 5.4c2 0 3.4 1.2 4.8 2.9 1.4-1.7 2.8-2.9 4.8-2.9 4.1 0 5.8 4.7 2.3 8L12 20.1Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></IconShell>; }
export function PlayLessActionIcon() { return <IconShell className="mlv-actionIcon" viewBox="0 0 24 24"><path d="M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M8 7.5 4 12l4 4.5" stroke="currentColor" strokeOpacity=".52" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></IconShell>; }
export function PlayNextActionIcon() { return <IconShell className="mlv-actionIcon" viewBox="0 0 24 24"><path d="m7 5.5 9 6.5-9 6.5v-13Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><path d="M18 6v12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></IconShell>; }
export function QueueActionIcon() { return <IconShell className="mlv-actionIcon" viewBox="0 0 24 24"><path d="M4.5 7h10M4.5 12h10M4.5 17h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><path d="m17 13.5 3 2.5-3 2.5v-5Z" fill="currentColor"/></IconShell>; }
export function PlaylistActionIcon() { return <IconShell className="mlv-actionIcon" viewBox="0 0 24 24"><path d="M5 6.5h8M5 11.5h8M5 16.5h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/><path d="M18 7.5v9M13.5 12h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></IconShell>; }
export function EditActionIcon() { return <IconShell className="mlv-actionIcon" viewBox="0 0 24 24"><path d="M6 17.8 6.7 14 15.9 4.8l3.3 3.3-9.2 9.2L6 17.8Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><path d="M14.7 6l3.3 3.3M5 20h14" stroke="currentColor" strokeOpacity=".55" strokeWidth="1.25" strokeLinecap="round"/></IconShell>; }

export function PreviewRenderIcon({ playing = false }: { playing?: boolean }) {
  return <IconShell className={`mlv-previewRenderIcon ${playing ? "is-playing" : "is-idle"}`}>
    <circle cx="32" cy="32" r="24" fill="#050b11" stroke="#1E3B50" strokeWidth="1.4" />
    <circle cx="32" cy="32" r="22.5" stroke="#0361DF" strokeOpacity=".58" strokeWidth="1" />
    <path d="M17 18.5C22.5 12.8 30.5 10.2 38.4 11.2" stroke="#fff" strokeOpacity=".18" strokeWidth="1.3" strokeLinecap="round" />
    {playing ? <g><rect x="23" y="20" width="6.6" height="24" rx="2" fill="#F5FBFF"/><rect x="35" y="20" width="6.6" height="24" rx="2" fill="#22A5ED"/></g> : <path d="M26 20.5 43 32 26 43.5V20.5Z" fill="#F5FBFF" stroke="#22A5ED" strokeWidth="1.2" />}
    <path d="M15.5 42.5c5.8 7.6 17.6 10.7 27.3 5.8" stroke="#EB8B0F" strokeOpacity=".58" strokeWidth="1.3" strokeLinecap="round" />
  </IconShell>;
}

export function YouTubePremiumIcon() { return <IconShell className="mlv-youtubeRender"><rect x="10" y="18" width="44" height="28" rx="9" fill="#08090B" stroke="#E65A63" strokeWidth="1.7"/><path d="M28 24.5 42 32 28 39.5v-15Z" fill="#F7FAFC"/></IconShell>; }
export function KeepPremiumIcon() { return <IconShell className="mlv-keepRender"><path d="M14 34 26 45 50 19" stroke="#62D79A" strokeWidth="5.2" strokeLinecap="round" strokeLinejoin="round"/><path d="M17 31.5 26 40 46 20.5" stroke="#E8FFF3" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" opacity=".6"/></IconShell>; }
export function MaybePremiumIcon() { return <IconShell className="mlv-maybeRender"><path d="M15 16h34v26H31l-10 7v-7h-6V16Z" stroke="#E3B054" strokeWidth="2.6" strokeLinejoin="round"/><path d="M24 28h16M24 34h10" stroke="#FFF1CF" strokeWidth="2" strokeLinecap="round"/></IconShell>; }
export function PassPremiumIcon() { return <IconShell className="mlv-passRender"><path d="M19 19 45 45M45 19 19 45" stroke="#E56B77" strokeWidth="4.8" strokeLinecap="round"/><path d="M20.5 19 45 43.5" stroke="#FFDCE0" strokeWidth="1.2" strokeLinecap="round" opacity=".48"/></IconShell>; }
export function UploadPremiumIcon() { return <IconShell className="mlv-uploadRender"><path d="M32 42V15M21 26l11-11 11 11" stroke="#22A5ED" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"/><path d="M15 39v9h34v-9" stroke="#EB8B0F" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></IconShell>; }
export function ChevronPremiumIcon({ direction }: { direction: "left" | "right" }) { return <IconShell className="mlv-chevronRender" viewBox="0 0 24 40"><path d={direction === "left" ? "M17 7 7 20l10 13" : "M7 7l10 13L7 33"} stroke="#DDEAF2" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/><path d={direction === "left" ? "M15 10 9 20l6 10" : "M9 10l6 10-6 10"} stroke="#22A5ED" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" opacity=".66"/></IconShell>; }
export function MorePremiumIcon() { return <IconShell className="mlv-moreRender" viewBox="0 0 72 24"><circle cx="12" cy="12" r="2.8" fill="#22A5ED"/><circle cx="36" cy="12" r="2.8" fill="#DDEAF2"/><circle cx="60" cy="12" r="2.8" fill="#EB8B0F"/></IconShell>; }
