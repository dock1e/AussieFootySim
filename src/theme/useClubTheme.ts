import type { CSSProperties } from "react";
import { type ClubTokens, DEFAULT_TINT_CARD, pageTintFor } from "./clubTokens";

/**
 * Round 114 — Club Theme System. Turns a club's 5 tokens (+ optional tint
 * override) into the CSS custom properties every themed component reads via
 * `var(--…)`. Brief section 1, rule 2: "Tokens are CSS custom properties set
 * once on the app root… Changing clubs means swapping those values, with no
 * re-render of layout" — this is that one place. Spread the result onto a
 * wrapping element's `style` prop.
 *
 * React's CSSProperties type doesn't know about custom properties, hence the
 * cast — this is the standard, narrowly-scoped way to do it (see the React
 * TS docs on CSS variables) rather than loosening the type more broadly.
 */
export function clubThemeStyle(tokens: ClubTokens, tintCard: number = DEFAULT_TINT_CARD): CSSProperties {
  const tb = pageTintFor(tintCard);
  return {
    "--deep": tokens.deep,
    "--acc": tokens.acc,
    "--accT": tokens.accT,
    "--acc2": tokens.acc2,
    "--on": tokens.on,
    "--tc": `${tintCard}%`,
    "--tb": `${tb}%`,
  } as CSSProperties;
}

/** Page background recipe — brief section 2.2. Apply to the outermost app wrapper. */
export function pageBackgroundStyle(): CSSProperties {
  return {
    background: "color-mix(in oklch, var(--deep) var(--tb), #080b12)",
    minHeight: "100vh",
  };
}

/** The top wash gradient that sits behind the header — brief section 2.2. */
export const topWashStyle: CSSProperties = {
  background: "linear-gradient(180deg, color-mix(in oklch, var(--deep) 50%, transparent) 0, transparent 340px)",
};
