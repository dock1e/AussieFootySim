import type { ReactNode } from "react";
import { clubTokensFor } from "../../theme/clubTokens";
import { clubThemeStyle } from "../../theme/useClubTheme";

/**
 * Round 114 — Club Theme System, brief section 1 rule 6: "Other clubs appear
 * only as chips… Scope this by setting that club's five vars on a wrapper
 * element around the chip." Use this to render an opponent's monogram chip,
 * badge, or (on Match Day) player dots in their own colours without touching
 * the app-wide `--acc`/`--deep`/etc. set by the coached club's theme.
 *
 * Deliberately a plain `<span>` (inline-block via style) rather than a `<div>`
 * so it drops into inline contexts (a name next to a badge) without forcing
 * a layout break — pass `display: "flex"`-style children-level styling on
 * the child itself if a block layout is needed inside.
 */
export function ScopedClub({ abbreviation, children }: { abbreviation: string | undefined; children: ReactNode }) {
  const tokens = clubTokensFor(abbreviation);
  return <span style={{ ...clubThemeStyle(tokens), display: "contents" }}>{children}</span>;
}
