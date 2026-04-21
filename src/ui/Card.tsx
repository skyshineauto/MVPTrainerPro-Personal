import React from "react";

export function Card({
  title,
  right,
  children,
  tone,
  clip = "clip",
}: {
  title?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  tone?: "base" | "blue";
  clip?: "clip" | "no-clip";
}) {
  const cls = [
    "tr-card",
    tone === "blue" ? "tr-card--blue" : "",
    clip === "no-clip" ? "tr-card--noClip" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={cls}>
      {title ? (
        <header className="tr-card-head">
          <div className="tr-card-title">{title}</div>
          {right ? <div className="tr-card-right">{right}</div> : null}
        </header>
      ) : null}
      <div className="tr-card-body">{children}</div>
    </section>
  );
}