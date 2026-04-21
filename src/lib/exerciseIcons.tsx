import React from "react";

export function CheckIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden style={{ flex: "0 0 auto" }}>
      <path d="M20 6L9 17l-5-5" stroke="rgba(34,197,94,1)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AlertIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden style={{ flex: "0 0 auto" }}>
      <path d="M12 3l10 18H2L12 3z" stroke="rgba(239,68,68,1)" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M12 9v5" stroke="rgba(239,68,68,1)" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M12 17h.01" stroke="rgba(239,68,68,1)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}