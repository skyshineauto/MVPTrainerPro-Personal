// src/ui/Chip.tsx
import React from "react";

export function Chip({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "blue" | "orange" | "base";
}) {
  const cls =
    "tr-badge " +
    (tone === "orange"
      ? " tr-badge--warn"
      : tone === "blue"
      ? " tr-badge--blue"
      : "");

  return <span className={cls}>{children}</span>;
}