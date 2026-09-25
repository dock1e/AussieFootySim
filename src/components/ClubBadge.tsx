import { clubById, clubByName, type Club } from "../types/club";
import { clubTokensFor } from "../theme/clubTokens";

/**
 * A club's real colours as a solid pill (`abbreviation` on a
 * `primaryColor` background, `secondaryColor` text) — round 51,
 * [[Club Branding and Colours]]. Matches the reference screenshots Tyler
 * gave this round (a stack of solid club-colour abbreviation pills, plus
 * player-monogram badges styled the same way) rather than the earlier,
 * more minimal colour-dot treatment (ROADMAP.md item #13) it replaces in
 * `LadderTable` and elsewhere.
 *
 * Deliberately text-only, no crest/logo artwork — consistent with this
 * project's standing copyright stance (see the design note): real colours
 * and abbreviation codes are factual data, not AFL-owned trade dress.
 *
 * Renders nothing (not a placeholder box) when `club` is `undefined`, so a
 * bad/missing id degrades the same way the old dot did rather than
 * crashing or showing a confusing empty swatch.
 */
/**
 * Sep 2026 — [[LiveMatch Cockpit Rebuild]]: added `"lg"` for the new
 * scoreboard band's 40px Barlow Condensed score, which otherwise dwarfs the
 * old `"md"` badge (`text-xs`) sitting next to it. Purely additive — every
 * existing `"sm"`/`"md"` call site (and the `md` default) renders
 * byte-identically to before this size existed.
 */
/**
 * Round 126 — Cowork fix pass 1, item 4: every club chip is exactly ONE fill + ONE hairline border,
 * drawn from that club's own theme tokens (brief 2.6 monogram chip): solid `deep` fill, a 1px
 * `acc`-at-55% border, `accT` text, no gradient/shadow/ring. Replaces the old solid
 * `primaryColor`/`secondaryColor` pill, which read as a second, clashing shade whenever it sat on a
 * themed surface (e.g. Melbourne's navy chip inside the Dashboard's navy club tile). The tokens are
 * applied inline per club, so an opponent's chip still shows its own colours whatever club you coach.
 */
export function ClubBadge({ club, size = "md" }: { club: Club | undefined; size?: "sm" | "md" | "lg" }) {
  if (!club) return null;
  const t = clubTokensFor(club.abbreviation);
  const sizeStyle = size === "sm" ? { padding: "1px 5px", fontSize: 10 } : size === "lg" ? { padding: "3px 9px", fontSize: 14 } : { padding: "2px 6px", fontSize: 11 };
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center uppercase"
      style={{
        ...sizeStyle,
        borderRadius: 5,
        background: t.deep,
        border: `1px solid color-mix(in oklch, ${t.acc} 55%, transparent)`,
        color: t.accT,
        boxShadow: "none",
        fontFamily: "'Barlow Condensed', sans-serif",
        fontWeight: 700,
        letterSpacing: ".3px",
        lineHeight: 1.2,
      }}
      title={club.name}
    >
      {club.abbreviation}
    </span>
  );
}

/** Convenience wrapper for the common case of only having a `ClubID` (ladder rows, fixtures). */
export function ClubBadgeById({ clubId, size }: { clubId: number | undefined; size?: "sm" | "md" | "lg" }) {
  return <ClubBadge club={clubId !== undefined ? clubById(clubId) : undefined} size={size} />;
}

/** Convenience wrapper for the common case of only having a club name string (match-sim `MatchTeam.name`, `Player.Team`). */
export function ClubBadgeByName({ name, size }: { name: string | undefined; size?: "sm" | "md" | "lg" }) {
  return <ClubBadge club={name !== undefined ? clubByName(name) : undefined} size={size} />;
}
