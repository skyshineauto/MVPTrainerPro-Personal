import type { ReactNode, SVGProps } from "react";

type BaseIconProps = SVGProps<SVGSVGElement> & { title?: string };

function Icon({ children, title, className = "", viewBox = "0 0 24 24", ...props }: BaseIconProps & { children: ReactNode; viewBox?: string }) {
  return (
    <svg
      viewBox={viewBox}
      fill="none"
      aria-hidden={title ? undefined : true}
      aria-label={title}
      role={title ? "img" : undefined}
      focusable="false"
      className={`mlv-icon ${className}`.trim()}
      {...props}
    >
      {children}
    </svg>
  );
}

const line = { stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export function PlayPremiumIcon(props: BaseIconProps) {
  return <Icon {...props}><path d="M9 7.25 17 12l-8 4.75V7.25Z" fill="currentColor" /><circle cx="12" cy="12" r="9" {...line} opacity=".35" /></Icon>;
}
export function PausePremiumIcon(props: BaseIconProps) {
  return <Icon {...props}><rect x="8.2" y="7" width="2.6" height="10" rx="1" fill="currentColor"/><rect x="13.2" y="7" width="2.6" height="10" rx="1" fill="currentColor"/><circle cx="12" cy="12" r="9" {...line} opacity=".35" /></Icon>;
}
export function HeartPremiumIcon({ filled = false, ...props }: BaseIconProps & { filled?: boolean }) {
  return <Icon {...props}><path d="M20.2 8.8c0 5-8.2 9.6-8.2 9.6S3.8 13.8 3.8 8.8A4.2 4.2 0 0 1 12 7.45 4.2 4.2 0 0 1 20.2 8.8Z" {...line} fill={filled ? "currentColor" : "none"}/></Icon>;
}
export function PlayLessPremiumIcon(props: BaseIconProps) {
  return <Icon {...props}><path d="M5.2 8.2h13.6" {...line}/><path d="m8.1 12.1 3.9 3.9 3.9-3.9" {...line}/></Icon>;
}
export function NextPremiumIcon(props: BaseIconProps) {
  return <Icon {...props}><path d="m7.5 6.8 7.1 5.2-7.1 5.2V6.8Z" fill="currentColor"/><path d="M16.8 7.2v9.6" {...line}/></Icon>;
}
export function QueuePremiumIcon(props: BaseIconProps) {
  return <Icon {...props}><path d="M5 7h10M5 12h10M5 17h7" {...line}/><path d="m16.5 14.5 3 2-3 2v-4Z" fill="currentColor"/></Icon>;
}
export function PlaylistPremiumIcon(props: BaseIconProps) {
  return <Icon {...props}><path d="M5 7h8M5 11h8M5 15h5" {...line}/><path d="M17 10v8M13 14h8" {...line}/></Icon>;
}
export function EditPremiumIcon(props: BaseIconProps) {
  return <Icon {...props}><path d="m6 17 1-4 8.9-8.9a1.6 1.6 0 0 1 2.3 0l1.7 1.7a1.6 1.6 0 0 1 0 2.3L11 17l-5 1Z" {...line}/><path d="m14.8 5.2 4 4" {...line}/></Icon>;
}
export function ChevronUpPremiumIcon(props: BaseIconProps) {
  return <Icon {...props}><path d="m7 14.5 5-5 5 5" {...line}/></Icon>;
}
export function ChevronDownPremiumIcon(props: BaseIconProps) {
  return <Icon {...props}><path d="m7 9.5 5 5 5-5" {...line}/></Icon>;
}
export function ShufflePremiumIcon(props: BaseIconProps) {
  return <Icon {...props}><path d="M4 7h2.2c4.7 0 4.9 10 9.6 10H20" {...line}/><path d="m17 14 3 3-3 3M4 17h2.2c1.1 0 2-.55 2.8-1.35M15.2 7.5c.25-.25.5-.5.8-.5H20" {...line}/><path d="m17 4 3 3-3 3" {...line}/></Icon>;
}
export function SparkPremiumIcon(props: BaseIconProps) {
  return <Icon {...props}><path d="M12 3.8 13.5 9l4.7 1.5-4.7 1.5L12 17.2 10.5 12l-4.7-1.5L10.5 9 12 3.8Z" {...line}/><path d="m18.2 15.8.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7.7-2.1Z" {...line} opacity=".65"/></Icon>;
}
export function MorePremiumIcon(props: BaseIconProps) {
  return <Icon {...props}><circle cx="5" cy="12" r="1.35" fill="currentColor"/><circle cx="12" cy="12" r="1.35" fill="currentColor"/><circle cx="19" cy="12" r="1.35" fill="currentColor"/></Icon>;
}
export function ClosePremiumIcon(props: BaseIconProps) {
  return <Icon {...props}><path d="m7 7 10 10M17 7 7 17" {...line}/></Icon>;
}

export function PreviewRenderIcon({ playing = false, ...props }: BaseIconProps & { playing?: boolean }) {
  return playing ? <PausePremiumIcon {...props} className={`mlv-previewRenderIcon ${props.className ?? ""}`} /> : <PlayPremiumIcon {...props} className={`mlv-previewRenderIcon ${props.className ?? ""}`} />;
}
export function YouTubePremiumIcon(props: BaseIconProps) {
  return <Icon {...props} className={`mlv-youtubeRender ${props.className ?? ""}`}><rect x="3.1" y="6.1" width="17.8" height="11.8" rx="4" {...line}/><path d="m10 9.2 5 2.8-5 2.8V9.2Z" fill="currentColor"/></Icon>;
}
export function KeepPremiumIcon(props: BaseIconProps) {
  return <Icon {...props} className={`mlv-keepRender ${props.className ?? ""}`}><path d="m5 12.4 4.2 4.1L19.3 6.8" {...line}/></Icon>;
}
export function MaybePremiumIcon(props: BaseIconProps) {
  return <Icon {...props} className={`mlv-maybeRender ${props.className ?? ""}`}><path d="M5 5.5h14v10H11l-4.5 3v-3H5v-10Z" {...line}/><path d="M9 9h6M9 12h4" {...line}/></Icon>;
}
export function PassPremiumIcon(props: BaseIconProps) {
  return <Icon {...props} className={`mlv-passRender ${props.className ?? ""}`}><path d="m6.2 6.2 11.6 11.6M17.8 6.2 6.2 17.8" {...line}/></Icon>;
}
export function UploadPremiumIcon(props: BaseIconProps) {
  return <Icon {...props} className={`mlv-uploadRender ${props.className ?? ""}`}><path d="M12 16V5m0 0L8.4 8.6M12 5l3.6 3.6M5 15v4h14v-4" {...line}/></Icon>;
}
export function ChevronPremiumIcon({ direction, ...props }: BaseIconProps & { direction: "left" | "right" }) {
  return <Icon {...props} className={`mlv-chevronRender ${props.className ?? ""}`}><path d={direction === "left" ? "m14.5 6-6 6 6 6" : "m9.5 6 6 6-6 6"} {...line}/></Icon>;
}
