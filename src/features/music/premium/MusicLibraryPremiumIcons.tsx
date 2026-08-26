import previewIdlePlay from "../../../assets/music-premium/preview-idle-play.webp";
import previewActivePause from "../../../assets/music-premium/preview-active-pause.webp";
import keepPremium from "../../../assets/music-premium/keep-premium.png";
import maybePremium from "../../../assets/music-premium/maybe-premium.png";
import passPremium from "../../../assets/music-premium/pass-premium.png";
import youtubePremium from "../../../assets/music-premium/youtube-premium.png";
import addToMvpPremium from "../../../assets/music-premium/add-to-mvp-premium.png";
import chevronLeftPremium from "../../../assets/music-premium/chevron-left-premium.png";
import chevronRightPremium from "../../../assets/music-premium/chevron-right-premium.png";

function AssetIcon({ src, className }: { src: string; className: string }) {
  return <img className={`mlv-premiumAsset ${className}`} src={src} alt="" aria-hidden="true" draggable={false} />;
}

export function PreviewRenderIcon({ playing = false }: { playing?: boolean }) {
  return (
    <img
      className={`mlv-previewRenderIcon ${playing ? "is-playing" : "is-idle"}`}
      src={playing ? previewActivePause : previewIdlePlay}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}

export function YouTubePremiumIcon() { return <AssetIcon src={youtubePremium} className="mlv-youtubeRender" />; }
export function KeepPremiumIcon() { return <AssetIcon src={keepPremium} className="mlv-keepRender" />; }
export function MaybePremiumIcon() { return <AssetIcon src={maybePremium} className="mlv-maybeRender" />; }
export function PassPremiumIcon() { return <AssetIcon src={passPremium} className="mlv-passRender" />; }
export function UploadPremiumIcon() { return <AssetIcon src={addToMvpPremium} className="mlv-uploadRender" />; }
export function ChevronPremiumIcon({ direction }: { direction: "left" | "right" }) {
  return <AssetIcon src={direction === "left" ? chevronLeftPremium : chevronRightPremium} className="mlv-chevronRender" />;
}

export function MorePremiumIcon() {
  return (
    <svg className="mlv-moreRender" viewBox="0 0 72 24" aria-hidden="true">
      <defs><linearGradient id="mlvMore" x1="0" x2="1"><stop stopColor="#6be8ff"/><stop offset="1" stopColor="#d6faff"/></linearGradient></defs>
      <rect x="4" y="10" width="12" height="4" rx="2" fill="url(#mlvMore)" />
      <rect x="30" y="10" width="12" height="4" rx="2" fill="url(#mlvMore)" />
      <rect x="56" y="10" width="12" height="4" rx="2" fill="url(#mlvMore)" />
    </svg>
  );
}
