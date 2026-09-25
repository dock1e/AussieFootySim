import { useState, type CSSProperties } from "react";
import { Card, SectionLabel, Segmented, StatusChip } from "./theme/primitives";
import { useSaveStore } from "../store/useSaveStore";
import { ASSISTANT_COACH_POOL } from "../data/assistantCoachPool";
import { gradeForOvr, COACH_ROLES, SCOUT_FOCUS_AREAS, type Coach, type CoachRole, type ScoutFocusArea } from "../types/coach";
import { coachSalaryAsk, evaluateCoachOffer, committedStaffSpend, type CoachOfferOutcome } from "../engine/coachContracts";
import { FOOTBALL_DEPT_CEILING } from "../engine/contracts";

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-AU")}`;
}

/**
 * Round 123 — [[Football Department Coach Market]]. Rebuilt from round 122's simple per-role dropdown
 * into the "Coach market" the UI Redesign proposed — the reference mockup's own `fd.isStaffTab`
 * (`Club Theme System.dc.html` lines ~894-1010): a browse/filter table plus a detail/offer panel with
 * a real salary negotiation, replacing the old "pick from a sorted dropdown, no cost" hiring model.
 *
 * **Talent Scout relocated here.** Tyler's own round-123 ask: "Bring our Talent Scout recruiting into
 * the Football Department Assistant Coaches section." Round 97 had deliberately kept Talent Scout
 * hiring on `Combine.tsx`'s Talent Scouting tab, reasoning that screen's own fog-of-war accuracy is
 * what the scout affects. That reasoning is superseded by this direct ask — Talent Scout is now just
 * the 7th... no, the 6th `CoachRole` alongside the other 5 in one unified market, with `Combine.tsx`
 * left holding a read-only pointer card (see that file's own doc comment). The focus-area picker
 * (round 83) moves here too, since it's part of directing the same hire, not a separate concern.
 *
 * **The negotiation.** `engine/coachContracts.ts`'s `evaluateCoachOffer` — the real player free-agency
 * `evaluateOffer` math, reused verbatim (≥95% of ask accepts, <70% rejects, between counters at the
 * midpoint). Every hire is capped against `FOOTBALL_DEPT_CEILING` (this app's existing, previously
 * "informational only" salary-cap-style constant) via `committedStaffSpend` — the Send Offer button
 * disables itself the moment an offer would push the club's total coaching wage bill over that real
 * number, rather than silently accepting an offer the club can't actually afford.
 */
export function AssistantCoaches() {
  const lineCoaches = useSaveStore((s) => s.lineCoaches);
  const developmentCoach = useSaveStore((s) => s.developmentCoach);
  const talentScout = useSaveStore((s) => s.talentScout);
  const coachContracts = useSaveStore((s) => s.coachContracts);
  const hireCoach = useSaveStore((s) => s.hireCoach);
  const releaseCoachRole = useSaveStore((s) => s.releaseCoachRole);
  const setScoutFocusArea = useSaveStore((s) => s.setScoutFocusArea);

  const [role, setRole] = useState<CoachRole>("Talent Scout");
  const [selectedCoachId, setSelectedCoachId] = useState<number | null>(null);
  const [offer, setOffer] = useState<number>(0);
  const [offersUsed, setOffersUsed] = useState(0);
  const [outcome, setOutcome] = useState<CoachOfferOutcome | null>(null);

  const assignedIdFor = (r: CoachRole): number | null => {
    if (r === "Talent Scout") return talentScout?.coachId ?? null;
    if (r === "Development") return developmentCoach;
    return lineCoaches[r] ?? null;
  };

  const filled = COACH_ROLES.filter((r) => assignedIdFor(r) != null).length;
  const staffSpend = committedStaffSpend(coachContracts);
  const staffPct = Math.min(100, Math.round((staffSpend / FOOTBALL_DEPT_CEILING) * 100));

  const sortedCoaches = [...ASSISTANT_COACH_POOL].sort((a, b) => b.ratings[role].ovr - a.ratings[role].ovr);
  const selectedCoach: Coach | null = selectedCoachId != null ? (ASSISTANT_COACH_POOL.find((c) => c.id === selectedCoachId) ?? null) : null;
  const ask = selectedCoach ? coachSalaryAsk(selectedCoach.ratings[role].ovr) : 0;
  const spendWithoutThisRole = committedStaffSpend(coachContracts, role);
  const overCap = spendWithoutThisRole + offer > FOOTBALL_DEPT_CEILING;

  function openDetail(coach: Coach) {
    setSelectedCoachId(coach.id);
    setOffersUsed(0);
    setOutcome(null);
    setOffer(Math.round((coachSalaryAsk(coach.ratings[role].ovr) * 0.85) / 1000) * 1000);
  }

  function sendOffer() {
    if (!selectedCoach || overCap) return;
    const result = evaluateCoachOffer(ask, offer, offersUsed);
    setOutcome(result);
    if (result.result === "accepted") {
      hireCoach(role, selectedCoach.id, offer);
    } else if (result.result === "countered") {
      setOffersUsed((n) => n + 1);
      setOffer(result.counterSalaryPerYear);
    } else {
      setOffersUsed((n) => n + 1);
    }
  }

  function acceptCounter() {
    if (!selectedCoach || overCap) return;
    hireCoach(role, selectedCoach.id, offer);
    setOutcome({ result: "accepted" });
  }

  const assignedCoachId = assignedIdFor(role);
  const assignedCoach: Coach | null = assignedCoachId != null ? (ASSISTANT_COACH_POOL.find((c) => c.id === assignedCoachId) ?? null) : null;
  const assignedSalary = coachContracts[role]?.salaryPerYear ?? null;

  return (
    <div className="flex flex-col gap-5">
      <Card padding="14px 18px">
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ font: "700 30px/1 'Barlow Condensed',sans-serif", color: "#fff" }}>{filled}</span>
            <span style={{ font: "600 14px Barlow,sans-serif", color: "#aab3c3" }}>of {COACH_ROLES.length} coaching roles filled</span>
          </div>
          <div style={{ minWidth: 220 }}>
            <div style={{ display: "flex", justifyContent: "space-between", font: "600 11px 'IBM Plex Mono',monospace", color: "#8f9ab0", marginBottom: 4 }}>
              <span>STAFF SPEND</span>
              <span style={{ color: staffPct >= 100 ? "#e5484d" : "var(--accT)" }}>
                {money(staffSpend)} / {money(FOOTBALL_DEPT_CEILING)}
              </span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,.08)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${staffPct}%`, background: staffPct >= 100 ? "#e5484d" : "var(--acc)" }} />
            </div>
          </div>
        </div>
        <div style={{ font: "500 12px Barlow,sans-serif", color: "#8f9ab0", marginTop: 8 }}>
          4 Line Coaches (Defensive Line, Forward Line, Midfield, Ruck &amp; Stoppage), a Development Coach, and a Talent
          Scout — negotiate a real salary for each below, capped against the Football Department's total staff-spend
          ceiling.
        </div>
      </Card>

      <div className="grid gap-2 sm:grid-cols-3">
        {COACH_ROLES.map((r) => {
          const id = assignedIdFor(r);
          const coach = id != null ? ASSISTANT_COACH_POOL.find((c) => c.id === id) ?? null : null;
          const salary = coachContracts[r]?.salaryPerYear ?? null;
          return (
            <button
              key={r}
              onClick={() => {
                setRole(r);
                setSelectedCoachId(null);
                setOutcome(null);
              }}
              style={{
                textAlign: "left",
                border: role === r ? "1px solid color-mix(in oklch, var(--acc) 55%, transparent)" : "1px solid rgba(255,255,255,.08)",
                borderRadius: 10,
                background: role === r ? "color-mix(in oklch, var(--acc) 10%, transparent)" : "rgba(255,255,255,.02)",
                padding: "8px 10px",
                cursor: "pointer",
              }}
            >
              <div style={{ font: "600 11px Barlow,sans-serif", color: "#8f9ab0", marginBottom: 2 }}>{r}</div>
              {coach ? (
                <>
                  <div style={{ font: "700 13px Barlow,sans-serif", color: "#fff" }}>{coach.name}</div>
                  <div style={{ font: "500 11px 'IBM Plex Mono',monospace", color: "var(--accT)" }}>{salary != null ? `${money(salary)}/yr` : ""}</div>
                </>
              ) : (
                <div style={{ font: "500 12px Barlow,sans-serif", color: "#5d6880" }}>Unfilled</div>
              )}
            </button>
          );
        })}
      </div>

      <SectionLabel>{role} market</SectionLabel>

      <Card padding="10px 14px" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <Segmented options={COACH_ROLES.map((r) => ({ value: r, label: r }))} value={role} onChange={(v) => { setRole(v); setSelectedCoachId(null); setOutcome(null); }} />
          {assignedCoach && (
            <button
              onClick={() => releaseCoachRole(role)}
              style={{ background: "none", border: "1px solid rgba(255,255,255,.18)", borderRadius: 7, color: "#c5cbd6", font: "600 12px Barlow,sans-serif", padding: "5px 10px", cursor: "pointer" }}
            >
              Release {assignedCoach.name}
              {assignedSalary != null ? ` (${money(assignedSalary)}/yr)` : ""}
            </button>
          )}
        </div>

        <div style={{ maxHeight: 320, overflowY: "auto", border: "1px solid rgba(255,255,255,.06)", borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", font: "500 12px Barlow,sans-serif" }}>
            <thead>
              <tr style={{ color: "#7e889a", textAlign: "left", font: "600 10px 'IBM Plex Mono',monospace", letterSpacing: ".5px" }}>
                <th style={{ padding: "6px 10px" }}>NAME</th>
                <th style={{ padding: "6px 10px" }}>GRADE</th>
                <th style={{ padding: "6px 10px" }}>OVR</th>
                <th style={{ padding: "6px 10px" }}>ASK/YR</th>
                <th style={{ padding: "6px 10px" }} />
              </tr>
            </thead>
            <tbody>
              {sortedCoaches.map((c) => {
                const isAssignedHere = c.id === assignedCoachId;
                const rating = c.ratings[role];
                return (
                  <tr
                    key={c.id}
                    onClick={() => openDetail(c)}
                    style={{
                      cursor: "pointer",
                      background: c.id === selectedCoachId ? "color-mix(in oklch, var(--acc) 12%, transparent)" : "transparent",
                      borderTop: "1px solid rgba(255,255,255,.05)",
                    }}
                  >
                    <td style={{ padding: "6px 10px", color: "#fff", fontWeight: 600 }}>
                      {c.name}
                      {isAssignedHere && <StatusChip tone="accent">HIRED</StatusChip>}
                    </td>
                    <td style={{ padding: "6px 10px", color: "#aab3c3" }}>{gradeForOvr(rating.ovr)}</td>
                    <td style={{ padding: "6px 10px", color: "#aab3c3" }}>{rating.ovr}</td>
                    <td style={{ padding: "6px 10px", color: "var(--accT)" }}>{money(coachSalaryAsk(rating.ovr))}</td>
                    <td style={{ padding: "6px 10px", textAlign: "right", color: "#5d6880" }}>{c.id === selectedCoachId ? "▾" : "▸"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {selectedCoach && (
          <div style={{ borderTop: "1px solid rgba(255,255,255,.08)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ font: "700 15px Barlow,sans-serif", color: "#fff" }}>{selectedCoach.name}</span>
              <StatusChip tone="accent">{gradeForOvr(selectedCoach.ratings[role].ovr)} · {role}</StatusChip>
            </div>
            <p style={{ font: "500 12px/1.4 Barlow,sans-serif", color: "#aab3c3", margin: 0 }}>{selectedCoach.bio}</p>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {COACH_ROLES.map((r) => (
                <span key={r} style={{ font: "500 11px 'IBM Plex Mono',monospace", color: r === role ? "var(--accT)" : "#5d6880", padding: "3px 7px", borderRadius: 6, background: "rgba(255,255,255,.04)" }}>
                  {r}: {selectedCoach.ratings[r].ovr}
                </span>
              ))}
            </div>

            {role === "Talent Scout" && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                <span style={{ font: "600 11px Barlow,sans-serif", color: "#8f9ab0" }}>Focus (once hired):</span>
                {SCOUT_FOCUS_AREAS.map((area: ScoutFocusArea) => (
                  <button
                    key={area}
                    disabled={!isAssignedHere(selectedCoach.id, assignedCoachId)}
                    onClick={() => setScoutFocusArea(talentScout?.focusArea === area ? null : area)}
                    style={{
                      opacity: isAssignedHere(selectedCoach.id, assignedCoachId) ? 1 : 0.4,
                      cursor: isAssignedHere(selectedCoach.id, assignedCoachId) ? "pointer" : "default",
                      borderRadius: 999,
                      border: 0,
                      padding: "3px 9px",
                      font: "600 11px Barlow,sans-serif",
                      background: talentScout?.focusArea === area ? "var(--acc)" : "rgba(255,255,255,.06)",
                      color: talentScout?.focusArea === area ? "var(--on)" : "#aab3c3",
                    }}
                  >
                    {area}
                  </button>
                ))}
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ font: "600 11px 'IBM Plex Mono',monospace", color: "#8f9ab0" }}>ASK: {money(ask)}/yr</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button onClick={() => setOffer((o) => Math.max(0, o - 5000))} style={stepperBtnStyle}>−</button>
                <span style={{ font: "700 14px 'IBM Plex Mono',monospace", color: "#fff", minWidth: 90, textAlign: "center" }}>{money(offer)}</span>
                <button onClick={() => setOffer((o) => o + 5000)} style={stepperBtnStyle}>+</button>
              </div>
              <button
                onClick={sendOffer}
                disabled={overCap}
                style={{
                  background: overCap ? "rgba(255,255,255,.06)" : "var(--acc)",
                  color: overCap ? "#5d6880" : "var(--on)",
                  border: 0,
                  borderRadius: 8,
                  padding: "7px 14px",
                  font: "700 12px Barlow,sans-serif",
                  cursor: overCap ? "not-allowed" : "pointer",
                }}
              >
                Send Offer
              </button>
            </div>
            {overCap && (
              <p style={{ font: "600 11px Barlow,sans-serif", color: "#e5484d", margin: 0 }}>
                This offer would push the Football Department's staff spend over the {money(FOOTBALL_DEPT_CEILING)} ceiling.
              </p>
            )}
            {outcome && (
              <p style={{ font: "600 12px Barlow,sans-serif", margin: 0, color: outcome.result === "accepted" ? "#3fb950" : outcome.result === "rejected" ? "#e5484d" : "var(--accT)" }}>
                {outcome.result === "accepted" && `${selectedCoach.name} signs at ${money(offer)}/yr.`}
                {outcome.result === "countered" && (
                  <>
                    {selectedCoach.name} counters at {money(outcome.counterSalaryPerYear)}/yr.{" "}
                    <button onClick={acceptCounter} style={{ background: "none", border: 0, color: "var(--accT)", textDecoration: "underline", cursor: "pointer", font: "700 12px Barlow,sans-serif" }}>
                      Accept
                    </button>
                  </>
                )}
                {outcome.result === "rejected" && `${selectedCoach.name} isn't interested at that price — the offer window has closed.`}
              </p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

function isAssignedHere(coachId: number, assignedCoachId: number | null): boolean {
  return coachId === assignedCoachId;
}

const stepperBtnStyle: CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,.15)",
  background: "rgba(255,255,255,.04)",
  color: "#c5cbd6",
  font: "700 14px Barlow,sans-serif",
  cursor: "pointer",
};
