import type { Player } from "../types/player";
import { playerFullName } from "../types/player";
import { usePlayerProfileStore } from "../store/usePlayerProfileStore";

/**
 * Round 64 — [[Player Profile and Benchmarking]]'s shared "click any player,
 * anywhere" primitive, matching how `ClubBadge` (round 51) became the one
 * reusable club-rendering component rather than 8 one-off implementations.
 * Renders `children` (defaults to the player's own full name) as a styled
 * clickable element that opens their Player Profile via
 * `usePlayerProfileStore` — no prop-drilling needed, since the store is
 * global and `<PlayerProfileModal>` is mounted once at App.tsx's top level.
 *
 * `stopPropagation` on click is load-bearing, not defensive filler — every
 * intended usage site (a leaderboard row, a squad list row, a records row)
 * is itself commonly already clickable for some OTHER purpose (row expand,
 * row select), so a `PlayerLink` nested inside one must not also trigger
 * that outer handler.
 *
 * `as="span"` (default `"button"`) renders a keyboard-accessible
 * `role="button"` span instead of a real `<button>` — for the one real
 * constraint a bare button can't handle: nesting inside an ALREADY-`<button>`
 * row (e.g. Records.tsx's own expand-on-click rows). A `<button>` nested
 * inside another `<button>` is invalid HTML that browsers silently
 * reparent/break, so any usage site that's itself a `<button>` must pass
 * `as="span"` rather than nest the default.
 */
export function PlayerLink({ player, children, className = "", as = "button" }: { player: Player; children?: React.ReactNode; className?: string; as?: "button" | "span" }) {
  const classes = `text-left hover:text-primary-light hover:underline ${className}`;
  function open(e: { stopPropagation: () => void }) {
    e.stopPropagation();
    usePlayerProfileStore.getState().openPlayer(player.PlayerID);
  }

  if (as === "span") {
    return (
      <span
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open(e);
          }
        }}
        className={`cursor-pointer ${classes}`}
      >
        {children ?? playerFullName(player)}
      </span>
    );
  }

  return (
    <button type="button" onClick={open} className={classes}>
      {children ?? playerFullName(player)}
    </button>
  );
}
