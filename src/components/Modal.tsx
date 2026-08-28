import { useEffect } from "react";

/**
 * Generic centered overlay — Aug 2026 round 53, Tyler's direct follow-up on
 * round 52's `ExpandableCard`: he wants the expanded ladder to be "like a
 * 'pop up' style expansion where it takes up the centre of the screen and
 * shows much more detail with the extra width real estate." Round 52's
 * inline-grow accordion also had a real bug — the collapsed preview
 * stayed on screen above the expanded content, reading as a second section
 * rather than the same one expanding (Tyler's screenshot showed the 7-row
 * compact ladder sitting directly above a second, full 18-row table). A
 * centered modal sidesteps both complaints at once: only one version of the
 * content is ever on screen, and it isn't constrained to whatever column
 * width its trigger card happens to sit in — see `max-w-6xl` below, wider
 * than half of the Dashboard's `lg:grid-cols-2` row it's typically opened
 * from.
 *
 * This replaces `ExpandableCard` (deleted this round — nothing else used it)
 * as the standard "show me more" primitive for Dashboard cards: the Ladder,
 * Last Game, Competition Leaders, and Coming Up → club scouting all open one
 * of these now rather than growing in place.
 */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    // Locks background scroll while open — without this, scrolling the
    // (taller) modal content also scrolls the Dashboard underneath it once
    // the modal's own content is short enough not to need its own scrollbar.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 py-10 sm:py-16"
      onClick={onClose}
    >
      <div
        className="w-full max-w-6xl rounded-card border border-base-600 bg-base-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-card border-b border-base-700 bg-base-900 px-5 py-3.5">
          <div className="font-display text-xl italic">{title}</div>
          <button
            onClick={onClose}
            className="rounded-lg bg-base-800 px-2.5 py-1.5 text-sm text-slate-400 hover:bg-base-700 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/**
 * The small "there's more in here" affordance every modal-triggering card
 * uses, so the interaction is discoverable rather than relying on an
 * implicit whole-card click. Deliberately tiny/quiet (`text-xs`) — it's a
 * corner hint, not competing with the card's own real content for attention.
 */
export function ExpandHint({ label = "Expand" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-accent-light">
      {label} <span aria-hidden="true">⤢</span>
    </span>
  );
}
