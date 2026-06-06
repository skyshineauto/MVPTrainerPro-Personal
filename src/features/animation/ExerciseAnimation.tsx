import { useEffect, useMemo, useRef, useState } from "react";
import { poseFor } from "./templates";

type Media = {
  video?: string;
  gif?: string;
  poster?: string;
};

export function ExerciseAnimation({
  templateId,
  media,
}: {
  templateId: string;
  media?: Media | null;
}) {
  const src = useMemo(() => {
    const m = media ?? {};
    return m.video || m.gif || m.poster || "";
  }, [media]);

  const isVideo = !!src && /\.(mp4|webm|ogg)(\?|#|$)/i.test(src);

  if (src) {
    return (
      <div
        style={{
          width: "100%",
          height: 240,
          borderRadius: 14,
          border: "1px solid rgba(255,255,255,.10)",
          overflow: "hidden",
          background: "rgba(0,170,255,0.06)",
        }}
      >
        {isVideo ? (
          <video
            src={src}
            autoPlay
            muted
            loop
            playsInline
            controls={false}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <img
            src={src}
            alt="Exercise"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        )}
      </div>
    );
  }

  return <StickCanvas templateId={templateId} />;
}

function StickCanvas({ templateId }: { templateId: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [t, setT] = useState(0);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setT((prev) => (prev + 0.012) % 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = "rgba(0,170,255,0.06)";
    ctx.fillRect(0, 0, w, h);

    const pose = poseFor(templateId || "generic", t);

    const cx = w / 2;
    const cy = h / 2 + 30;
    const P = (pt: [number, number]) =>
      [cx + pt[0] * 2, cy + pt[1] * 2] as const;

    const line = (
      a: [number, number],
      b: [number, number],
      lw = 6,
      col = "rgba(255,255,255,.85)"
    ) => {
      const A = P(a);
      const B = P(b);
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(A[0], A[1]);
      ctx.lineTo(B[0], B[1]);
      ctx.stroke();
    };

    line(pose.neck, pose.hip, 10, "rgba(255,255,255,.75)");

    const H = P(pose.head);
    ctx.fillStyle = "rgba(255,255,255,.8)";
    ctx.beginPath();
    ctx.arc(H[0], H[1], 14, 0, Math.PI * 2);
    ctx.fill();

    line(pose.neck, pose.shL, 8);
    line(pose.shL, pose.elL, 7);
    line(pose.elL, pose.wrL, 7);

    line(pose.neck, pose.shR, 8);
    line(pose.shR, pose.elR, 7);
    line(pose.elR, pose.wrR, 7);

    line(pose.hip, pose.knL, 9);
    line(pose.knL, pose.anL, 9);

    line(pose.hip, pose.knR, 9);
    line(pose.knR, pose.anR, 9);
  }, [t, templateId]);

  return (
    <canvas
      ref={ref}
      width={420}
      height={240}
      style={{
        width: "100%",
        height: 240,
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,.10)",
      }}
    />
  );
}
