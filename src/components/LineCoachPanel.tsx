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
 * Sep 2026 round 85 — coach ASSIGNMENT moved out of this panel entirely.
 * Round 84's own first build let you hire/swap a coach right here mid-match,
 * but that assignment had no retroactive effect on the match you were
 * actually playing (effectiveness is resolved once, at kickoff) — a real,
 * disclosed gap between what the UI let you do and what it actually did.
 * Tyler's own fix, verbatim: "Coaches should not be able to be hired
 * mid-match, and if they are they should only apply from the next match
 * onwards." Hiring/swapping now lives on the Coaching tab's Selection
 * Committee screen (`SelectionCommittee.tsx`'s own `LineCoachHiringPanel`,
 * mirroring `Draft.tsx`'s `TalentScoutPanel`) — a standing, between-matches
 * roster decision, not a quarter-time one. This panel is now read-only for
 * assignment (see `LineCoachCard` below) and keeps only what genuinely IS
 * live, in-match state: the feedback sentence and the focus buttons.
 */
export interface LineCoachPanelProps {
  lineCoaches: Partial<Record<MatchDayCoachRole, number>>;
  /** One-sentence feedback per role for THIS side, already resolved by the caller (`engine/match.ts`'s `lineFeedbackFor`) — kept out of this component so it stays presentation-only, same split `CoachsCall`/`QuarterTimeInterchange` already use. */
  feedbackFor: (role: MatchDayCoachRole) => string;
  /** This side's current focus per role, already resolved by the caller (`engine/match.ts`'s `getLineFocus`). */
  focusFor: (role: MatchDayCoachRole) => LineCoachFocus;
  onFocusChange: (role: MatchDayCoachRole, focus: LineCoachFocus) => void;
}

export function LineCoachPanel({ lineCoaches, feedbackFor, focusFor, onFocusChange }: LineCoachPanelProps) {
  return (
    <div className="card">
      <div className="mb-1 font-display text-xl italic">Line Coach Direction</div>
      <div className="mb-3 text-xs text-slate-400">
        Hear how each line is reading the game so far, then leave them on their default path or direct
        them to a focus for the rest of the match. "Demand They Dig Deeper" lifts every one of a line's
        stats, but the extra intensity costs more fitness over the rest of the game. Hiring or swapping
        a line coach is a Selection Committee decision (Coaching tab) that takes effect from your next
        match — not something you can change here.
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {MATCH_DAY_COACH_ROLES.map((role) => (
          <LineCoachCard key={role} role={role} feedback={feedbackFor(role)} currentFocus={focusFor(role)} assignedCoachId={lineCoaches[role] ?? null} onFocusChange={(focus) => onFocusChange(role, focus)} />
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
  onFocusChange,
}: {
  role: MatchDayCoachRole;
  feedback: string;
  currentFocus: LineCoachFocus;
  assignedCoachId: number | null;
  onFocusChange: (focus: LineCoachFocus) => void;
}) {
  const assignedCoach = assignedCoachId !== null ? (ASSISTANT_COACH_POOL.find((c) => c.id === assignedCoachId) ?? null) : null;

  return (
    <div className="rounded-lg border border-base-600 bg-base-900 p-3">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">{role}</span>
        {/* Read-only, round 85 — see this file's own top comment. Hiring/swapping lives on the
            Selection Committee screen now; showing (rather than hiding) who's assigned here still
            matters, since it's exactly the coach whose feedback sentence is right below. */}
        <span className="text-[11px] font-semibold text-slate-400" title="Hire or swap this coach from the Coaching tab's Selection Committee — takes effect from your next match, not this one.">
          {assignedCoach ? (
            <>
              {assignedCoach.name} — {gradeForOvr(assignedCoach.ratings[role].ovr)} ({assignedCoach.ratings[role].ovr} OVR)
            </>
          ) : (
            "No coach hired (baseline)"
          )}
        </span>
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
