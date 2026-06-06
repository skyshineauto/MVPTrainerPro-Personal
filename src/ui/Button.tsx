import { CSSProperties, ReactNode } from "react";

export function Button({
  children,
  onClick,
  disabled,
  type = "button",
  style,
  variant = "primary",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary";
  type?: "button" | "submit";
  style?: CSSProperties;
}) {
  const className =
    variant === "secondary" ? "tr-btn tr-btn--secondary" : "tr-btn tr-btn--primary";

  return (
    <button
      type={type}
      className={className}
      onClick={onClick}
      disabled={disabled}
      style={style}
    >
      {children}
    </button>
  );
}
