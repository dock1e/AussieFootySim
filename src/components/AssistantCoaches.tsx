import { Card, SectionLabel, StatusChip } from "./theme/primitives";
import { useSaveStore } from "../store/useSaveStore";
import { ASSISTANT_COACH_POOL } from "../data/assistantCoachPool";
import { gradeForOvr, MATCH_DAY_COACH_ROLES, type Coach, type CoachRole } from "../types/coach";

/**
 * Round 122 — [[Club Finance, Facilities, and Marketing]] part 2 / the Football Department screen's
 * "Assistant Coaches" sub-tab (renamed from "Coaching & Scouting" per Tyler's own steer, matching the
 * uploaded UI redesign's tab naming). The Line Coach + Development Coach hiring UI lived in
 * `SelectionCommittee.tsx` since round 85 — this tab is a genuine relocation, not a duplicate: those two
 * sections (and the `LineCoachHiringCard` component itself) moved here verbatim, and
 * `SelectionCommittee.tsx` now just points here instead of hosting its own copy. Tyler's own round-85
 * rule ("hire only out of match, takes effect from your next match/off-season") is completely unchanged
 * — the store actions (`assignLineCoach`/`assignDevelopmentCoach`) never moved, only the screen that
 * calls them.
 *
 * The Talent Scout is deliberately NOT relocated here — round 97 moved that hiring UI onto the "Talent
 * Scouting" tab specifically because the Combine board it feeds lives there too (see `Combine.tsx`'s own
 * doc comment). Duplicating a second hiring surface for the exact same store state would just create two
 * places that can go out of sync in a reader's head, even though the underlying data can't actually
 * desync. Instead this tab shows a small read-only summary card with a pointer to where it's managed.
 */
export function AssistantCoaches() {
  const lineCoaches = useSaveStore((s) => s.lineCoaches);
  const assignLineCoach = useSaveStore((s) => s.assignLineCoach);
  const developmentCoach = useSaveStore((s) => s.developmentCoach);
  const assignDevelopmentCoach = useSaveStore((s) => s.assignDevelopmentCoach);
  const talentScout = useSaveStore((s) => s.talentScout);
  const scoutCoach: Coach | null = talentScout ? (ASSISTANT_COACH_POOL.find((c) => c.id === talentScout.coachId) ?? null) : null;

  const filled = MATCH_DAY_COACH_ROLES.filter((r) => lineCoaches[r] != null).length + (developmentCoach != null ? 1 : 0) + (scoutCoach ? 1 : 0);

  return (
    <div className="flex flex-col gap-5">
      <Card padding="14px 18px">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ font: "700 30px/1 'Barlow Condensed',sans-serif", color: "#fff" }}>{filled}</span>
          <span style={{ font: "600 14px Barlow,sans-serif", color: "#aab3c3" }}>of 6 coaching roles filled</span>
        </div>
        <div style={{ font: "500 12px Barlow,sans-serif", color: "#8f9ab0", marginTop: 4 }}>
          4 Line Coaches (Defensive Line, Forward Line, Midfield, Ruck &amp; Stoppage), a Development Coach, and a Talent
          Scout. A hire below takes effect from your next match (Line Coaches) or off-season (Development Coach) — it
          can't reach back into anything already underway.
        </div>
      </Card>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <SectionLabel>Line Coaches</SectionLabel>
        <div className="grid gap-3 sm:grid-cols-2">
          {MATCH_DAY_COACH_ROLES.map((role) => (
            <LineCoachHiringCard key={role} role={role} assignedCoachId={lineCoaches[role] ?? null} onAssign={(coachId) => assignLineCoach(role, coachId)} />
          ))}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <SectionLabel>Development Coach</SectionLabel>
        <div className="grid gap-3 sm:grid-cols-2">
          <LineCoachHiringCard role="Development" assignedCoachId={developmentCoach} onAssign={assignDevelopmentCoach} />
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <SectionLabel>Talent Scout</SectionLabel>
        <Card padding="14px 16px" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {scoutCoach ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ font: "700 15px Barlow,sans-serif", color: "#fff" }}>{scoutCoach.name}</span>
                <StatusChip tone="accent">{gradeForOvr(scoutCoach.ratings["Talent Scout"].ovr)}</StatusChip>
                {talentScout?.focusArea && <StatusChip tone="neutral">{talentScout.focusArea}</StatusChip>}
              </div>
              <p style={{ font: "500 12px/1.4 Barlow,sans-serif", color: "#aab3c3" }}>{scoutCoach.bio}</p>
            </>
          ) : (
            <p style={{ font: "500 13px Barlow,sans-serif", color: "#8f9ab0" }}>No Talent Scout hired — draft fog-of-war reads at baseline accuracy.</p>
          )}
          <div style={{ font: "500 12px Barlow,sans-serif", color: "var(--accT)" }}>
            Hired and directed from the Talent Scouting tab (Future Planning), since it's the screen its own accuracy affects.
          </div>
        </Card>
      </div>
    </div>
  );
}

/**
 * Moved verbatim from `SelectionCommittee.tsx` (round 85's own doc comment there explains the original
 * design: a dropdown sorted by THIS role's own OVR descending, an "unassign" baseline option, bio
 * display, no focus-area buttons since line-coach focus is `LineCoachPanel.tsx`'s own live per-match
 * state, not a standing roster decision).
 */
function LineCoachHiringCard({
  role,
  assignedCoachId,
  onAssign,
}: {
  role: CoachRole;
  assignedCoachId: number | null;
  onAssign: (coachId: number | null) => void;
}) {
  const sortedCoaches = [...ASSISTANT_COACH_POOL].sort((a, b) => b.ratings[role].ovr - a.ratings[role].ovr);
  const assignedCoach: Coach | null = assignedCoachId !== null ? (ASSISTANT_COACH_POOL.find((c) => c.id === assignedCoachId) ?? null) : null;

  return (
    <div className="card">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-slate-400">{role}</span>
        <select
          value={assignedCoach?.id ?? ""}
          onChange={(e) => onAssign(e.target.value === "" ? null : Number(e.target.value))}
          className="rounded-lg bg-base-700 px-2 py-1 text-xs font-semibold text-slate-200"
        >
          <option value="">No coach hired (baseline)</option>
          {sortedCoaches.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} — {gradeForOvr(c.ratings[role].ovr)} ({c.ratings[role].ovr} OVR)
            </option>
          ))}
        </select>
      </div>
      {assignedCoach ? (
        <p className="text-xs text-slate-400">{assignedCoach.bio}</p>
      ) : (
        <p className="text-xs text-slate-500">Using baseline effectiveness for this line. Hire a coach above to lift it — or, with a poor hire, blunt it.</p>
      )}
    </div>
  );
}
