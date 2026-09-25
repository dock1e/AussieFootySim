import type { CSSProperties } from "react";
import { clubByName } from "../types/club";

/**
 * Club theme tokens — UI Redesign3 (`Club Theme System.dc.html` + `cowork-brief-club-theme-system.md`
 * §2.1). One layout, 18 skins: every themed surface reads these five CSS custom properties, never a
 * per-club class. Copied verbatim from the brief's token table, keyed by `Club.abbreviation`.
 *
 * - `deep`: mixed into every surface, chip backgrounds.
 * - `acc`: fills (primary button, active states, sorted column, your rows).
 * - `accT`: accent lifted for text/strokes on dark surfaces (≥4.5:1).
 * - `acc2`: second series, middle of the club stripe.
 * - `on`: text on an `acc` fill.
 */
export interface ClubTokens {
  deep: string;
  acc: string;
  accT: string;
  acc2: string;
  on: string;
}

export const CLUB_TOKENS: Record<string, ClubTokens> = {
  ADEL: { deep: "#002b5c", acc: "#e21937", accT: "#ff6b7c", acc2: "#ffd200", on: "#ffffff" },
  BL: { deep: "#6a0032", acc: "#fdbe57", accT: "#fdbe57", acc2: "#3b8fe0", on: "#3a0019" },
  CARL: { deep: "#0b2340", acc: "#8fb8e8", accT: "#a9c9ef", acc2: "#ffffff", on: "#0b2340" },
  COLL: { deep: "#1c1c1c", acc: "#f2f2f2", accT: "#f2f2f2", acc2: "#8a8a8a", on: "#000000" },
  ESS: { deep: "#2e0a0f", acc: "#e4273a", accT: "#ff6270", acc2: "#bdbdbd", on: "#ffffff" },
  FRE: { deep: "#2a0d54", acc: "#a88be6", accT: "#bba4ef", acc2: "#ffffff", on: "#1a0736" },
  GEEL: { deep: "#102a4c", acc: "#6fa8e6", accT: "#8dbbef", acc2: "#ffffff", on: "#0a1a30" },
  GCFC: { deep: "#6e1414", acc: "#f4c20d", accT: "#f4c20d", acc2: "#e8423b", on: "#2b1a00" },
  GWS: { deep: "#3a3f45", acc: "#f47920", accT: "#ff9a4d", acc2: "#c9ccd0", on: "#1e1000" },
  HAW: { deep: "#4d2004", acc: "#fbbf15", accT: "#fbbf15", acc2: "#c07a3c", on: "#2a1402" },
  MELB: { deep: "#101746", acc: "#e0213a", accT: "#ff6474", acc2: "#6a86ea", on: "#ffffff" },
  NMFC: { deep: "#06296e", acc: "#3d7cf0", accT: "#86aeff", acc2: "#ffffff", on: "#ffffff" },
  PORT: { deep: "#003b4a", acc: "#00a3c4", accT: "#2cc6e4", acc2: "#ffffff", on: "#00161c" },
  RICH: { deep: "#241f00", acc: "#ffd200", accT: "#ffd200", acc2: "#9a9a9a", on: "#1a1600" },
  STK: { deep: "#3a0a08", acc: "#ed1b2f", accT: "#ff6068", acc2: "#ffffff", on: "#ffffff" },
  SYD: { deep: "#4a0a0c", acc: "#ed171f", accT: "#ff5f63", acc2: "#ffffff", on: "#ffffff" },
  WCE: { deep: "#0a2168", acc: "#f2a900", accT: "#f5b928", acc2: "#5a86f0", on: "#1e1400" },
  WB: { deep: "#0a2c66", acc: "#e31937", accT: "#ff6474", acc2: "#5a8ee6", on: "#ffffff" },
};

/** Neutral fallback for a row with no known club (a handful of legacy real-world rows) — the reference's own `chipVars` default. */
const NEUTRAL_TOKENS: ClubTokens = { deep: "#2a2f38", acc: "#8f9ab0", accT: "#b3bccb", acc2: "#8f9ab0", on: "#000000" };

export function clubTokensByName(name: string | undefined): ClubTokens {
  const club = name ? clubByName(name) : undefined;
  return (club && CLUB_TOKENS[club.abbreviation]) || NEUTRAL_TOKENS;
}

/** The five club vars as an inline style — spread onto a wrapper to scope a club's colours (an opponent's chip, or a whole themed screen). */
export function clubVars(name: string | undefined): CSSProperties {
  const t = clubTokensByName(name);
  return { "--deep": t.deep, "--acc": t.acc, "--accT": t.accT, "--acc2": t.acc2, "--on": t.on } as CSSProperties;
}

/** Card tint strength (brief §2.2): `--tc` 14% by default, page tint `--tb` = round(tc × 0.6). */
export const DEFAULT_TINT = 14;

/** Your club's vars plus tint strength — set once on a screen root so every card/row below it re-themes. */
export function themeRootVars(myClubName: string, tint = DEFAULT_TINT): CSSProperties {
  return { ...clubVars(myClubName), "--tc": `${tint}%`, "--tb": `${Math.round(tint * 0.6)}%` } as CSSProperties;
}

/** Brief §2.3 surfaces, as ready-to-use CSS values (all read the vars above). */
export const SURFACE = {
  card: "color-mix(in oklch, var(--deep) var(--tc), #10151f)",
  hero: "color-mix(in oklch, var(--deep) calc(var(--tc) * 2.4), #10151f)",
  panel: "color-mix(in oklch, var(--deep) calc(var(--tc) * 1.6), #0d121b)",
  inset: "rgba(0,0,0,.25)",
  border: "rgba(255,255,255,.07)",
  divider: "rgba(255,255,255,.05)",
} as const;

/** Brief §1.5 — meaning never depends on club colour. */
export const MEANING = {
  rise: "#4fd69a",
  fall: "#ffa37a",
  warn: "#f0c04a",
  gold: "#e7c04e",
  silver: "#c3cad6",
  bronze: "#d08b5b",
} as const;

export const MEDALS = [MEANING.gold, MEANING.silver, MEANING.bronze] as const;
