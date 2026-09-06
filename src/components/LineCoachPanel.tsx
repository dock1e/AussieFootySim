import { ASSISTANT_COACH_POOL } from "../data/assistantCoachPool";
import { gradeForOvr, MATCH_DAY_COACH_ROLES, type MatchDayCoachRole } from "../types/coach";
import { focusesFor, type LineCoachFocus } from "../engine/lineCoaching";

/**
 * Sep 2026 round 84 — [[Match-Day Line Coach Direction]]. Tyler's own ask: at
 * Quarter/Half/Three-Quarter Time, review the game with each of the 4
 * match-day line coaches (Defensive Line/Forward Line/Midfield/Ruck and
 * Stoppage — the Development Coach is deliberately excluded, per Tyler's own
 * instruction: "I dont think we should have our development coach as a match
 * day contributor"), hear their one-sentence read on how their line is
 * performing, and either leave them on Default or direct them to a named
 * focus (or "Demand They Dig Deeper"). Rendered in `LiveMatch.tsx` alongside
 * `QuarterTimeInterchange`/`CoachsCall` at every break, same "one card per
 * concern, all shown together at the same pause" layout those two already
 * establish.
 *
 * Coach assignment mirrors `Draft.tsx`'s `TalentScoutPanel` almost exactly
 * (same dropdown-of-84-coaches-sorted-by-role-OVR pattern, same "no coach
 * hired = baseline" framing) — deliberately not a shared component, since
 * this one needs 4 independent role dropdowns plus a live feedback sentence
 * and focus-button row that TalentScoutPanel has no equivalent of.
 */
export interface LineCoachPanelProps {
  lineCoaches: Partial<Record<MatchDayCoachRole, number>>;
  /** One-sentence feedback per role for THIS side, already resolved by the caller (`engine/match.ts`'s `lineFeedbackFor`) — kept out of this component so it stays presentation-only, same split `CoachsCall`/`QuarterTimeInterchange` already use. */
  feedbackFor: (role: MatchDayCoachRole) => string;
  /** This side's current focus per role, already resolved by the caller (`engine/match.ts`'s `getLineFocus`). */
  focusFor: (role: MatchDayCoachRole) => LineCoachFocus;
  onAssign: (role: MatchDayCoachRole, coachId: number | null) => void;
  onFocusChange: (role: MatchDayCoachRole, focus: LineCoachFocus) => void;
}

export function LineCoachPanel({ lineCoaches, feedbackFor, focusFor, onAssign, onFocusChange }: LineCoachPanelProps) {
  return (
    <div className="card">
      <div className="mb-1 font-display text-xl italic">Line Coach Direction</div>
      <div className="mb-3 text-xs text-slate-400">
        Hear how each line is reading the game so far, then leave them on their default path or direct
        them to a focus for the rest of the match. "Demand They Dig Deeper" lifts every one of a line's
        stats, but the extra intensity costs more fitness over the rest of the game.
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {MATCH_DAY_COACH_ROLES.map((role) => (
          <LineCoachCard
            key={role}
            role={role}
            feedback={feedbackFor(role)}
            currentFocus={focusFor(role)}
            assignedCoachId={lineCoaches[role] ?? null}
            onAssign={(coachId) => onAssign(role, coachId)}
            onFocusChange={(focus) => onFocusChange(role, focus)}
          />
        ))}
      </div>
    </div>
  );
}

function LineCoachCard({
  role,
  feedback,
  currentFocus,
  assignedCoachId,
  onAssign,
  onFocusChange,
}: {
  role: MatchDayCoachRole;
  feedback: string;
  currentFocus: LineCoachFocus;
  assignedCoachId: number | null;
  onAssign: (coachId: number | null) => void;
  onFocusChange: (focus: LineCoachFocus) => void;
}) {
  // Sorted once per render by this role's own OVR descending — same reasoning TalentScoutPanel's
  // own sortedScouts comment gives: the strongest real fits surface first rather than the coach
  // hunting through 84 names in pool-authoring order.
  const sortedCoaches = [...ASSISTANT_COACH_POOL].sort((a, b) => b.ratings[role].ovr - a.ratings[role].ovr);
  const assignedCoach = assignedCoachId !== null ? (ASSISTANT_COACH_POOL.find((c) => c.id === assignedCoachId) ?? null) : null;

  return (
    <div className="rounded-lg border border-base-600 bg-base-900 p-3">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">{role}</span>
        <select
          value={assignedCoachId ?? ""}
          onChange={(e) => onAssign(e.target.value === "" ? null : Number(e.target.value))}
          className="rounded-lg bg-base-700 px-2 py-1 text-[11px] font-semibold text-slate-200"
        >
          <option value="">No coach hired (baseline)</option>
          {sortedCoaches.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} — {gradeForOvr(c.ratings[role].ovr)} ({c.ratings[role].ovr} OVR)
            </option>
          ))}
        </select>
      </div>
      {assignedCoach && <p className="mb-1.5 text-[11px] text-slate-500">{assignedCoach.bio}</p>}
      <p className="mb-2 text-sm italic text-slate-300">&ldquo;{feedback}&rdquo;</p>
      <div className="flex flex-wrap gap-1.5">
        {focusesFor(role).map((focus) => {
          const isCurrent = currentFocus === focus;
          const isDigDeeper = focus === "Demand They Dig Deeper";
          return (
            <button
              key={focus}
              onClick={() => onFocusChange(focus)}
              title={isDigDeeper ? "Bigger boost across every stat this line tracks, but faster fitness drain for the rest of the match." : undefined}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                isCurrent ? (isDigDeeper ? "bg-bad text-white" : "bg-primary text-white") : "bg-base-700 text-slate-300 hover:bg-base-600"
              }`}
            >
              {focus}
              {isCurrent && <span className="ml-1 font-normal opacity-80">(current)</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
