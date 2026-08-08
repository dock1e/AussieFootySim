import { useMemo } from "react";
import { useGameStore } from "../store/useGameStore";
import { buildLeaguePlayersByClub, computeListNeeds, type ClubStrategy, type RecommendedAction } from "../engine/listNeeds";
import { gapBand, type PillTone } from "./StatusPill";

/**
 * List Needs report — Engine.md "List Needs report" / User Interface.md's
 * "Off-Season Hub, List Needs, Combine, Contracts, Trade, Draft" section.
 * Deliberately shipped as its own always-available tab rather than gated
 * behind a formal Off-Season Hub: that hub is speced as a linear checklist
 * threading 8 steps (Grand Final -> List Needs -> Combine -> Contracts ->
 * Trade -> Draft -> Pre-Season Draft -> Pre-Season Investment), and only
 * this first step exists so far (see ROADMAP.md Phase 4) — building a hub
 * shell around 7 dead links would be worse than just shipping the one real
 * step directly. The report itself doesn't actually need an "off-season has
 * started" gate to be useful; it's a read-only diagnosis of the current
 * list, meaningful to check any time.
 *
 * Footer shortcuts into Contracts, Trade, and the Draft are all real now
 * that all three exist (Phase 4 Slices 3, 4, and 5) — every step of the
 * Off-Season Hub sequence up to the Draft itself now has a real screen
 * behind it; only Pre-Season Draft/Pre-Season Investment remain open. A
 * separate, visually distinct shortcut into Position Switch sits below that
 * row — it's deliberately not styled as "step 5", since it isn't part of
 * the 8-step sequence at all (see PositionSwitch.tsx's own doc comment).
 */

const STRATEGY_TONE: Record<ClubStrategy, PillTone> = {
  Contend: "good",
  Balanced: "info",
  Rebuild: "warn",
};

const PRIORITY_TONE: Record<RecommendedAction["priority"], PillTone> = {
  "HIGH PRIORITY": "bad",
  PRIORITY: "warn",
};

export function ListNeeds({
  onGoToCombine,
  onGoToContracts,
  onGoToTrade,
  onGoToDraft,
  onGoToPositionSwitch,
}: {
  onGoToCombine?: () => void;
  onGoToContracts?: () => void;
  onGoToTrade?: () => void;
  onGoToDraft?: () => void;
  onGoToPositionSwitch?: () => void;
}) {
  const myClub = useGameStore((s) => s.myClub);
  const league = useMemo(() => buildLeaguePlayersByClub(), []);
  const report = useMemo(() => computeListNeeds(myClub, league), [myClub, league]);

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-slate-400">Strategy</span>
          <span className={`stat-pill stat-pill-${STRATEGY_TONE[report.strategy]}`}>{report.strategy}</span>
        </div>
        <div className="font-display text-xl italic">{report.headline}</div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {report.lines.map((line) => {
          const band = gapBand(line.gapToLeague);
          const pct = Math.min(100, Math.max(0, (line.avgOvr / 99) * 100));
          return (
            <div key={line.line} className="card">
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="font-semibold">{line.line}</span>
                <span className="flex items-center gap-2 tabular-nums">
                  {line.avgOvr.toFixed(1)}
                  <span className={`stat-pill stat-pill-${band.tone}`}>{band.label}</span>
                </span>
              </div>
              <div className="mb-3 h-2 overflow-hidden rounded-full bg-base-700">
                <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
              </div>

              <div className="mb-3 grid grid-cols-3 gap-2 text-center text-xs">
                <div>
                  <div className="tabular-nums text-base font-semibold">
                    {line.listed}/{line.ideal}
                  </div>
                  <div className="text-slate-500">Listed</div>
                </div>
                <div>
                  <div className="tabular-nums text-base font-semibold">
                    {line.qualityCount}/{line.starterQuota}
                  </div>
                  <div className="text-slate-500">Best-23 quality</div>
                </div>
                <div>
                  <div className="tabular-nums text-base font-semibold">{line.elite.length}</div>
                  <div className="text-slate-500">Elite 84+</div>
                </div>
                <div>
                  <div className="tabular-nums text-base font-semibold">{line.avgAge.toFixed(1)}</div>
                  <div className="text-slate-500">Avg age</div>
                </div>
                <div>
                  <div className="tabular-nums text-base font-semibold">{line.young.length}</div>
                  <div className="text-slate-500">Young ≤22</div>
                </div>
                <div>
                  <div className="tabular-nums text-base font-semibold">{line.veteran.length}</div>
                  <div className="text-slate-500">Veteran 30+</div>
                </div>
              </div>

              <div className={`text-sm ${line.verdict === "Healthy" ? "text-good" : "text-slate-300"}`}>{line.verdict}</div>
            </div>
          );
        })}
      </div>

      <div className="card">
        <div className="mb-3 text-xs uppercase tracking-wide text-slate-400">Age profile</div>
        <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-5">
          <div>
            <div className="text-lg font-semibold tabular-nums">{report.ageProfile.listSize}</div>
            <div className="text-xs text-slate-500">List size</div>
          </div>
          <div>
            <div className="text-lg font-semibold tabular-nums">{report.ageProfile.avgAge.toFixed(1)}</div>
            <div className="text-xs text-slate-500">Avg age</div>
          </div>
          <div>
            <div className="text-lg font-semibold tabular-nums">{report.ageProfile.young}</div>
            <div className="text-xs text-slate-500">Young ≤22</div>
          </div>
          <div>
            <div className="text-lg font-semibold tabular-nums">{report.ageProfile.prime}</div>
            <div className="text-xs text-slate-500">Prime 23-29</div>
          </div>
          <div>
            <div className="text-lg font-semibold tabular-nums">{report.ageProfile.veteran}</div>
            <div className="text-xs text-slate-500">Veteran 30+</div>
          </div>
        </div>
        <div className="mt-3 text-center text-xs">
          <span className={`stat-pill stat-pill-${report.ageProfile.legalSize ? "good" : "bad"}`}>
            {report.ageProfile.legalSize ? "Legal list size (24-46)" : "Outside the 24-46 legal list-size band"}
          </span>
        </div>
      </div>

      <div className="card">
        <div className="mb-3 text-xs uppercase tracking-wide text-slate-400">Recommended actions</div>
        {report.recommendedActions.length === 0 ? (
          <div className="text-sm text-good">No pressing needs — every line reads Healthy.</div>
        ) : (
          <div className="space-y-3">
            {report.recommendedActions.map((action, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className={`stat-pill stat-pill-${PRIORITY_TONE[action.priority]} mt-0.5 shrink-0`}>{action.priority}</span>
                <span className="text-sm text-slate-300">{action.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* User Interface.md specs footer shortcuts into Combine/Contracts/Trade/Draft —
          all four are real now (Phase 4 Slices 3/4/5 plus "Slice 6"'s Combine), so they
          all get real buttons, in the same order the Off-Season Hub sequence lists them. */}
      <div className="flex flex-col items-center gap-2 text-center text-xs text-slate-500">
        <div className="flex flex-wrap justify-center gap-2">
          {onGoToCombine && (
            <button onClick={onGoToCombine} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-dark">
              Go to the Combine
            </button>
          )}
          {onGoToContracts && (
            <button onClick={onGoToContracts} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-dark">
              Go to Contracts
            </button>
          )}
          {onGoToTrade && (
            <button onClick={onGoToTrade} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-dark">
              Go to Trade Period
            </button>
          )}
          {onGoToDraft && (
            <button onClick={onGoToDraft} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-dark">
              Go to the Draft
            </button>
          )}
        </div>
        <span>Pre-Season Draft and Pre-Season Investment aren&rsquo;t built yet.</span>
        {onGoToPositionSwitch && (
          <>
            <span className="pt-1">
              Position Switch isn&rsquo;t part of this sequence — Engine.md frames it as a check worth making any
              time, not a Hub step.
            </span>
            <button onClick={onGoToPositionSwitch} className="rounded-lg bg-base-800 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-base-700">
              Review Position Switches
            </button>
          </>
        )}
      </div>
    </div>
  );
}
