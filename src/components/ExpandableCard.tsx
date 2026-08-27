import { useState } from "react";

/**
 * Shared expand-in-place primitive — Aug 2026 round 52, [[UI Consolidation
 * Review]]. Tyler: "Currently our interface does not utilize features such
 * as expandable sections, ie clicking on the Full Season tab takes us
 * through to a Full Season tab rather than just expanding the ladder within
 * the UI." This is that primitive: a label + toggle header (visually
 * matching the existing "Full season →" link pattern it replaces), always-
 * visible `children` (the collapsed/preview content), and `expandedContent`
 * that mounts only once the user opts in.
 *
 * `expandedContent` is only rendered while `expanded` is true (not just
 * hidden via CSS) — deliberately, so a heavier embed (e.g. Dashboard's full
 * 18-row ladder + round fixture browser) doesn't pay any render cost until
 * the user actually asks for it.
 *
 * First applied to Dashboard's Ladder card; [[UI Consolidation Review]]'s
 * Phase 3 names Competition Leaders as the next candidate — built generic
 * from the start so that's a drop-in, not a rewrite.
 */
export function ExpandableCard({
  label,
  expandLabel = "Show more",
  collapseLabel = "Show less",
  defaultExpanded = false,
  children,
  expandedContent,
}: {
  label: string;
  expandLabel?: string;
  collapseLabel?: string;
  defaultExpanded?: boolean;
  children?: React.ReactNode;
  expandedContent: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
        <button
          onClick={() => setExpanded((e) => !e)}
          className="flex items-center gap-1 text-xs font-medium text-accent-light hover:underline"
          aria-expanded={expanded}
        >
          {expanded ? collapseLabel : expandLabel}
          <span className={`inline-block transition-transform ${expanded ? "-rotate-180" : ""}`}>▾</span>
        </button>
      </div>
      {children}
      {expanded && <div className="mt-3 space-y-3">{expandedContent}</div>}
    </div>
  );
}
