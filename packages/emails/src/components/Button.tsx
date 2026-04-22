import { Button as RButton } from "react-email";
import { colors, spacing } from "./tokens";
import type { ReactNode } from "react";

// `variant` is reserved for future template-specific styles (e.g., secondary
// outline button). v0.1 only implements `primary`, but the prop is declared so
// call sites don't have to be rewritten when we add the second variant.
interface Props {
  href: string;
  children: ReactNode;
  variant?: "primary";
}

export function Button({ href, children }: Props) {
  return (
    <RButton
      href={href}
      style={{
        backgroundColor: colors.primary,
        color: colors.primaryText,
        padding: `${spacing.md} ${spacing.lg}`,
        borderRadius: "6px",
        fontSize: "14px",
        fontWeight: 500,
        textDecoration: "none",
        display: "inline-block",
      }}
    >
      {children}
    </RButton>
  );
}
