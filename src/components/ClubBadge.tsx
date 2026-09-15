import { clubById, clubByName, type Club } from "../types/club";

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
export function ClubBadge({ club, size = "md" }: { club: Club | undefined; size?: "sm" | "md" | "lg" }) {
  if (!club) return null;
  const sizeClass = size === "sm" ? "px-1.5 py-0.5 text-[10px]" : size === "lg" ? "px-2.5 py-1 text-sm" : "px-2 py-0.5 text-xs";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded font-bold uppercase tracking-wide ${sizeClass}`}
      style={{ backgroundColor: club.primaryColor, color: club.secondaryColor }}
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
