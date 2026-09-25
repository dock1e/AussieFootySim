import { useMemo, useState } from "react";
import { useSaveStore } from "../store/useSaveStore";
import { useCombineStore } from "../store/useCombineStore";
import { combineHeadlines, formatTestValue, TEST_LABELS, type CombineTestResult } from "../engine/combine";
import { ARCHETYPE_LINE, LINES, type Line } from "../data/lines";
import type { Archetype } from "../types/archetype";
import { playerFullName, type Player } from "../types/player";
import { PlayerDetailModal } from "./PlayerDetailModal";
import { ASSISTANT_COACH_POOL } from "../data/assistantCoachPool";
import { gradeForOvr, type Coach, type ScoutFocusArea } from "../types/coach";

/**
 * The National Combine — Phase 4 "Slice 6" (ROADMAP.md, closes gap #55).
 * User Interface.md's own (short, complete — see combine.ts's doc comment)
 * spec: `Rank · Prospect · Pathway · Δ · Composite · 20m · Beep · Agility ·
 * Vert · Kick/20 · Drafted (projected slot)`, plus riser/faller callouts.
 * Everything numeric is computed by engine/combine.ts — this file is
 * presentation plus the same "Pathway -> State" disclosed substitution
 * Draft.tsx already made (no recruitment-pathway data exists anywhere in
 * this codebase — see draft.ts's own doc comment for why).
 *
 * **Round 97** — Tyler: "The Talent Scout section of this draft page should move under what is
 * currently called 'Combine'. We should then rename 'Combine' to 'Talent Scouting'." `TalentScoutPanel`
 * (moved from Draft.tsx verbatim, unchanged) rendered here — this tab was where a coach hired and
 * directed their Talent Scout, since the Combine board itself is one of the things that scout's own
 * accuracy affects.
 *
 * **Round 123** — [[Football Department Coach Market]] — superseded by Tyler's direct follow-up ask:
 * "Bring our Talent Scout recruiting into the Football Department Assistant Coaches section." The
 * hiring/focus-area UI that lived in `TalentScoutPanel` below has moved verbatim into
 * `AssistantCoaches.tsx`'s new Coach Market (all 6 `CoachRole`s, including Talent Scout, now hire and
 * negotiate through one unified screen) — mirroring, in reverse, round 122's own "relocate the real UI,
 * leave a pointer card behind" pattern for Line/Development Coach. The store actions
 * (`assignTalentScout`/`setScoutFocusArea`) never moved, only the screen that calls them — this tab now
 * shows a small read-only summary (`ScoutSummaryCard` below) with a pointer to where it's managed. This
 * screen's own draft-fog-of-war reads (`combineHeadlines`, `resultFor`, Draft.tsx's board) are computed
 * from `talentScout`/`ASSISTANT_COACH_POOL` directly via the store, completely unaffected by where the
 * hiring UI itself lives.
 */

const TEST_COLUMNS = ["sprint20m", "beepTest", "agility505", "verticalLeap", "kickEfficiency"] as const;
const TEST_COLUMN_HEADERS: Record<(typeof TEST_COLUMNS)[number], string> = {
  sprint20m: "20m",
  beepTest: "Beep",
  agility505: "Agility",
  verticalLeap: "Vert",
  kickEfficiency: "Kick/20",
};

export function Combine() {
  const currentYear = useSaveStore((s) => s.year);
  const runCombine = useSaveStore((s) => s.runCombine);
  const window_ = useCombineStore((s) => s.window);

  // Round 123 — hiring/focus-area UI relocated to AssistantCoaches.tsx's Coach Market (see this file's
  // own doc comment above). Still read here, read-only, for ScoutSummaryCard's display.
  const talentScout = useSaveStore((s) => s.talentScout);
  const assignedScout: Coach | null = talentScout ? (ASSISTANT_COACH_POOL.find((c) => c.id === talentScout.coachId) ?? null) : null;
  const focusArea: ScoutFocusArea | null = talentScout?.focusArea ?? null;
  const scoutPanel = <ScoutSummaryCard assignedScout={assignedScout} focusArea={focusArea} />;

  const [lineFilter, setLineFilter] = useState<Line | "All">("All");
  const [selected, setSelected] = useState<Player | null>(null);

  const invitees = useMemo(() => {
    if (!window_) return [];
    const invited = new Set(window_.invitedPlayerIds);
    return window_.pool.filter((p) => invited.has(p.PlayerID));
  }, [window_]);

  const headlines = useMemo(() => (window_ ? combineHeadlines(invitees, window_.results) : { risers: [], fallers: [] }), [window_, invitees]);

  const filtered = lineFilter === "All" ? invitees : invitees.filter((p) => ARCHETYPE_LINE[p.archetype as Archetype] === lineFilter);
  const sorted = window_ ? [...filtered].sort((a, b) => resultFor(window_.results, a).combineRank - resultFor(window_.results, b).combineRank) : [];

  if (!window_) {
    return (
      <div className="space-y-6">
        {scoutPanel}
        <div className="card text-center">
          <div className="mb-2 font-display text-xl italic">The {currentYear} National Combine hasn&rsquo;t run yet.</div>
          <p className="mx-auto mb-4 max-w-md text-sm text-slate-400">
            Invites the top {`80`} draft-eligible prospects to 5 physical tests (20m sprint, beep test, agility, vertical leap, kicking
            efficiency) and re-ranks them off a composite score — a real athletic gut-check ahead of the {currentYear} National Draft.
          </p>
          <button onClick={runCombine} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark">
            Run the {currentYear} National Combine
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {scoutPanel}
      <div className="card flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400">{currentYear} National Combine</div>
          <div className="font-display text-xl italic">{invitees.length} prospects tested</div>
        </div>
        <div className="text-xs text-slate-500">Composite: all-negative, closest to 0 = best</div>
      </div>

      {(headlines.risers.length > 0 || headlines.fallers.length > 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="card">
            <div className="mb-2 text-xs uppercase tracking-wide text-good">Risers</div>
            {headlines.risers.length === 0 ? (
              <div className="text-sm text-slate-500">No standout risers this class.</div>
            ) : (
              <div className="space-y-1.5 text-sm text-slate-300">
                {headlines.risers.map((h) => (
                  <div key={h.playerId}>{h.text}</div>
                ))}
              </div>
            )}
          </div>
          <div className="card">
            <div className="mb-2 text-xs uppercase tracking-wide text-bad">Fallers</div>
            {headlines.fallers.length === 0 ? (
              <div className="text-sm text-slate-500">No standout fallers this class.</div>
            ) : (
              <div className="space-y-1.5 text-sm text-slate-300">
                {headlines.fallers.map((h) => (
                  <div key={h.playerId}>{h.text}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="card">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-slate-400">Combine board ({sorted.length})</span>
          <div className="ml-auto flex flex-wrap gap-1">
            {(["All", ...LINES] as const).map((line) => (
              <button
                key={line}
                onClick={() => setLineFilter(line)}
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${lineFilter === line ? "bg-primary text-white" : "bg-base-700 text-slate-300 hover:bg-base-600"}`}
              >
                {line}
              </button>
            ))}
          </div>
        </div>
        <div className="max-h-[36rem] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-base-900">
              <tr className="text-xs uppercase tracking-wide text-slate-500">
                <th className="py-1.5 pr-2">Rank</th>
                <th className="py-1.5 pr-2">Prospect</th>
                <th className="py-1.5 pr-2">State</th>
                <th className="py-1.5 pr-2 text-right">Δ</th>
                <th className="py-1.5 pr-2 text-right">Composite</th>
                {TEST_COLUMNS.map((key) => (
                  <th key={key} className="py-1.5 pr-2 text-right">
                    {TEST_COLUMN_HEADERS[key]}
                  </th>
                ))}
                <th className="py-1.5 pr-2 text-right">Drafted (proj.)</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => {
                const r = resultFor(window_.results, p);
                return (
                  <tr key={p.PlayerID} onClick={() => setSelected(p)} className="cursor-pointer border-t border-base-700 hover:bg-base-800">
                    <td className="py-1.5 pr-2 text-slate-500 tabular-nums">{r.combineRank}</td>
                    <td className="py-1.5 pr-2 font-medium">{playerFullName(p)}</td>
                    <td className="py-1.5 pr-2 text-slate-400">{p.homeState}</td>
                    <td className={`py-1.5 pr-2 text-right tabular-nums ${r.delta > 0 ? "text-good" : r.delta < 0 ? "text-bad" : "text-slate-500"}`}>
                      {r.delta > 0 ? `+${r.delta}` : r.delta}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums font-semibold">{r.composite.toFixed(2)}</td>
                    {TEST_COLUMNS.map((key) => (
                      <td key={key} className="py-1.5 pr-2 text-right tabular-nums text-slate-300">
                        {formatTestValue(key, r)}
                      </td>
                    ))}
                    <td className="py-1.5 pr-2 text-right tabular-nums text-slate-400">Pick {r.projectedSlot}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-2 px-1 text-xs text-slate-500">
          Each test is grounded against real AFL Draft Combine results, then derived from this prospect&rsquo;s own rated attributes plus
          small jitter — see engine/combine.ts. Click a row for their full scouting profile ({TEST_LABELS.sprint20m}, {TEST_LABELS.beepTest},{" "}
          {TEST_LABELS.agility505}, {TEST_LABELS.verticalLeap}, {TEST_LABELS.kickEfficiency} feed the Composite; everything else on the
          profile is the same fogged read the Draft board itself uses.
        </div>
      </div>

      <PlayerDetailModal player={selected} currentYear={currentYear} onClose={() => setSelected(null)} />
    </div>
  );
}

function resultFor(results: Record<number, CombineTestResult>, p: Player): CombineTestResult {
  return (
    results[p.PlayerID] ?? {
      sprint20m: 0,
      agility505: 0,
      beepTest: 0,
      verticalLeap: 0,
      kickEfficiency: 0,
      composite: 0,
      reputationRank: 0,
      combineRank: 0,
      projectedSlot: 0,
      delta: 0,
      standoutTest: "sprint20m",
      weakestTest: "sprint20m",
    }
  );
}

/**
 * Round 123 — [[Football Department Coach Market]]. Replaces the old `TalentScoutPanel` (round
 * 83/97's real hiring UI, quoted in full in this round's own commit history) with a small read-only
 * summary + a pointer to where hiring now happens — see this file's own top-of-file doc comment for
 * why: the store actions never moved, only the screen that calls them. Mirrors, in reverse,
 * `AssistantCoaches.tsx`'s own round-122 pointer-card pattern for Line/Development Coach.
 */
function ScoutSummaryCard({ assignedScout, focusArea }: { assignedScout: Coach | null; focusArea: ScoutFocusArea | null }) {
  const accuracyPct = assignedScout ? Math.round((assignedScout.ratings["Talent Scout"].ovr / 99) * 100) : null;

  return (
    <div className="card">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-slate-400">Talent Scout</span>
        {assignedScout && <span className="text-xs font-semibold text-slate-200">{gradeForOvr(assignedScout.ratings["Talent Scout"].ovr)} · {assignedScout.name}</span>}
      </div>
      {assignedScout ? (
        <>
          <p className="mb-2 text-xs text-slate-400">{assignedScout.bio}</p>
          <p className="text-xs text-slate-500">
            {focusArea
              ? `Full ${accuracyPct}% accuracy applies to ${focusArea} prospects only — every other archetype falls back to baseline accuracy.`
              : `Full ${accuracyPct}% accuracy applies league-wide (no focus set).`}
          </p>
        </>
      ) : (
        <p className="text-xs text-slate-500">No Talent Scout hired — using your club&rsquo;s baseline recruiting accuracy.</p>
      )}
      <div className="mt-2 text-xs font-medium" style={{ color: "var(--accT)" }}>
        Hired, negotiated, and directed from the Football Department's Assistant Coaches tab — since a real salary and
        the other 5 coaching roles now live there too.
      </div>
    </div>
  );
}
