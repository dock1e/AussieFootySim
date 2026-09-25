/**
 * Round 114 — Club Theme System (`cowork-brief-club-theme-system.md`, reference
 * `Club Theme System.dc.html`). "One theme, 18 skins": every screen's layout,
 * type and neutral palette stay identical; only these five tokens change per
 * club. Values copied verbatim from the brief's section 2.1 table (itself
 * sourced from the reference file) — do not eyeball or re-derive these from
 * `Club.primaryColor`/`secondaryColor` (types/club.ts), which is a different,
 * older, single-accent system (round 51, [[Club Branding and Colours]]) used
 * for `ClubBadge` pills. The two systems intentionally coexist: `ClubBadge`
 * keeps using primary/secondaryColor for its solid pill; every screen touched
 * by this round's theme rebuild reads `ClubTokens` instead.
 *
 * Keyed by `Club.abbreviation` (types/club.ts) — confirmed identical to the
 * brief's `id` column for all 18 clubs (ADEL, BL, CARL, COLL, ESS, FRE, GEEL,
 * GCFC, GWS, HAW, MELB, NMFC, PORT, RICH, STK, SYD, WCE, WB), so no separate
 * id-mapping table is needed.
 */

export interface ClubTokens {
  /** Mixed into every surface; the header wash; chip backgrounds. */
  deep: string;
  /** Fills: primary button, active states, bars, "yours" chart series, club stripe. */
  acc: string;
  /** Accent as text/stroke on dark surfaces (labels, highlighted numbers, links). */
  accT: string;
  /** Second series: projections, comparison ghosts, middle of the club stripe. */
  acc2: string;
  /** Text colour on an `acc`-filled surface. */
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

/** Fallback for an unrecognised id — Carlton's palette, arbitrarily, just so nothing renders blank. */
export const DEFAULT_CLUB_TOKENS: ClubTokens = CLUB_TOKENS.CARL;

export function clubTokensFor(abbreviation: string | undefined): ClubTokens {
  if (!abbreviation) return DEFAULT_CLUB_TOKENS;
  return CLUB_TOKENS[abbreviation] ?? DEFAULT_CLUB_TOKENS;
}

/**
 * Meaning tokens that never depend on club colour (brief section 1, rule 5) —
 * rises/falls/warnings/medals stay these exact colours for every club,
 * including the red clubs (Melbourne, Essendon, Sydney, St Kilda, Western
 * Bulldogs, Adelaide, Gold Coast) where a club accent could otherwise be
 * mistaken for "bad".
 */
export const MEANING_TOKENS = {
  rise: "#4fd69a",
  fall: "#ffa37a",
  warn: "#f0c04a",
  gold: "#e7c04e",
  silver: "#c3cad6",
  bronze: "#d08b5b",
} as const;

/** Tint strength — brief section 2.2. `tc` = card tint %, `tb` = page background tint %. */
export const DEFAULT_TINT_CARD = 14;
export function pageTintFor(cardTint: number): number {
  return Math.round(cardTint * 0.6);
}
