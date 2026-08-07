import { useMemo, useState } from "react";
import { useGameStore } from "../store/useGameStore";
import { useSaveStore } from "../store/useSaveStore";
import { useDraftStore } from "../store/useDraftStore";
import { useSeasonStore } from "../store/useSeasonStore";
import { buildLeaguePlayersByClub } from "../engine/listNeeds";
import {
  potentialLetterGrade,
  scoutOvrBand,
  scoutConfidence,
  mockProjection,
  MOCK_OUTLETS,
  likelyNeedForClub,
  SCOUT_HEADLINE_ATTRIBUTES,
  DRAFT_ROUNDS,
  type MockOutlet,
} from "../engine/draft";
import type { DraftWindow } from "../engine/saveGame";
import { ARCHETYPE_LINE, LINES, type Line } from "../data/lines";
import type { Archetype } from "../types/archetype";
import { CLUBS } from "../types/club";
import { playerFullName, type Player, type RatedAttribute } from "../types/player";

/**
 * National Draft — Phase 4 Slice 5 (ROADMAP.md). User Interface.md's Draft
 * screen: header (on-the-clock + Skip to My Pick/Next Pick/Finish Draft),
 * the fogged draft board, a Prospect Profile side panel, Recent Picks,
 * Upcoming Selections, and "Your Draft Picks Tonight." Reuses engine/draft.ts
 * for everything — this file is purely presentation + the 3 local UI-only
 * decisions the spec doesn't pin down:
 *
 * - **"Pathway"** (spec's own board column) is shown as **State** instead —
 *   no recruitment-pathway data (Academy/NAB League/international/etc.) is
 *   modelled anywhere in this codebase (Academy bids are an explicit,
 *   disclosed cut, see draft.ts's own doc comment), but home state is real,
 *   generated data and serves a similar "where'd they come from" role.
 * - **No standalone Combine screen** — this board's own fogged view (Scout
 *   OVR band, POTENTIAL letter grade, CONF%, the reveal budget) *is* the
 *   scouting deliverable for this slice, per draft.ts's own scope note.
 * - **POTENTIAL reads as a bare "?" until at least one headline attribute
 *   has been scouted on that prospect**, not just before the coach has
 *   opened their profile — a deliberate choice (not spec-literal, which just
 *   says "A+ to D- or ?") that gives the scouting budget a second real
 *   purpose beyond narrowing the OVR band: without spending at least one
 *   reveal, a prospect's ceiling is a genuine unknown, not just a fuzzy one.
 *
 * No `VIA {CLUB}`/`SLIPPED -N` provenance tags anywhere (Trade Period
 * doesn't support trading picks yet, so every pick's provenance is trivially
 * "their own"), and no Academy `MATCH` tags in Recent Picks (Academy bids are
 * cut) — both omissions, not oversights.
 */

const HEADLINE_ATTR_LABELS: Record<RatedAttribute, string> = {
  manMarking: "Man Marking",
  verticalLeap: "Vertical Leap",
  tenacity: "Tenacity",
  skill: "Skill",
  agility: "Agility",
  courage: "Courage",
  aggression: "Aggression",
  xFactor: "X-Factor",
  strengthGroundLevel: "Strength (Ground)",
  strengthOverhead: "Strength (Overhead)",
  strengthManOnMan: "Strength (Man-on-Man)",
  acceleration: "Acceleration",
  speed: "Speed",
  endurance: "Endurance",
  confidence: "Confidence",
  readPlay: "Read Play",
  consistancy: "Consistency",
  positioning: "Positioning",
  copeWithPressure: "Copes With Pressure",
  kickMaxDistance: "Kick Max Distance",
};

function revealedFor(window: DraftWindow, playerId: number): RatedAttribute[] {
  return (window.revealed[playerId] ?? []) as RatedAttribute[];
}

export function Draft() {
  const myClub = useGameStore((s) => s.myClub);
  const currentYear = useSaveStore((s) => s.year);
  const poolVersion = useSaveStore((s) => s.poolVersion);
  const startDraft = useSaveStore((s) => s.startDraft);
  const confirmDraftPick = useSaveStore((s) => s.confirmDraftPick);
  const autoResolveNextPick = useSaveStore((s) => s.autoResolveNextPick);
  const skipToMyPick = useSaveStore((s) => s.skipToMyPick);
  const finishDraft = useSaveStore((s) => s.finishDraft);
  const scoutAttribute = useSaveStore((s) => s.scoutAttribute);
  const window_ = useDraftStore((s) => s.window);
  const ladder = useSeasonStore((s) => s.season?.ladder);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [lineFilter, setLineFilter] = useState<Line | "All">("All");

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const playersByClub = useMemo(() => buildLeaguePlayersByClub(), [poolVersion]);

  if (!window_) {
    return (
      <div className="card text-center">
        <div className="mb-2 font-display text-xl italic">The {currentYear} National Draft hasn&rsquo;t started yet.</div>
        <p className="mx-auto mb-4 max-w-md text-sm text-slate-400">
          {ladder && ladder.length > 0
            ? "Draft order is set from this season's final ladder — last place picks first, 5 rounds, 90 picks total."
            : "No season's been completed yet, so draft order falls back to a fixed club order for now — play a season first if you want a real reverse-ladder order."}
        </p>
        <button onClick={startDraft} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-dark">
          Start the {currentYear} National Draft
        </button>
      </div>
    );
  }

  const isComplete = window_.currentPickIndex >= window_.order.length;
  const clubOnClock = isComplete ? null : window_.order[window_.currentPickIndex];
  const isMyTurn = clubOnClock === myClub;
  const round = Math.min(DRAFT_ROUNDS, Math.floor(window_.currentPickIndex / CLUBS.length) + 1);

  const pickedIds = new Set(window_.picks.map((p) => p.playerId));
  const remaining = window_.pool.filter((p) => !pickedIds.has(p.PlayerID));
  const filteredRemaining = lineFilter === "All" ? remaining : remaining.filter((p) => ARCHETYPE_LINE[p.archetype as Archetype] === lineFilter);
  const sortedRemaining = [...filteredRemaining].sort((a, b) => {
    const bandB = scoutOvrBand(b, revealedFor(window_, b.PlayerID).length);
    const bandA = scoutOvrBand(a, revealedFor(window_, a.PlayerID).length);
    return bandB.high + bandB.low - (bandA.high + bandA.low);
  });
  const selected = selectedId !== null ? (remaining.find((p) => p.PlayerID === selectedId) ?? null) : null;

  const myPicks = window_.picks.filter((p) => p.clubName === myClub);
  const upcoming = window_.order.slice(window_.currentPickIndex, window_.currentPickIndex + 5);

  return (
    <div className="space-y-6">
      <div className="card flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400">
            {currentYear} National Draft · Round {round}/{DRAFT_ROUNDS}
          </div>
          <div className="font-display text-xl italic">{isComplete ? "Draft complete" : `ON THE CLOCK — Pick ${window_.currentPickIndex + 1} · ${clubOnClock}`}</div>
        </div>
        {!isComplete && (
          <div className="flex flex-wrap gap-2">
            {!isMyTurn && (
              <button onClick={autoResolveNextPick} className="rounded-lg bg-base-700 px-3 py-1.5 text-xs font-semibold hover:bg-base-600">
                Next Pick
              </button>
            )}
            {!isMyTurn && (
              <button onClick={skipToMyPick} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-dark">
                Skip to My Pick
              </button>
            )}
            <button onClick={finishDraft} className="rounded-lg bg-base-700 px-3 py-1.5 text-xs font-semibold hover:bg-base-600">
              Finish Draft
            </button>
          </div>
        )}
      </div>

      {isComplete ? (
        <div className="card text-center">
          <div className="mb-1 font-display text-xl italic">The {currentYear} National Draft is complete.</div>
          <div className="text-sm text-slate-400">
            {myClub} made {myPicks.length} pick{myPicks.length === 1 ? "" : "s"}. Pre-Season Draft and Pre-Season Investment aren&rsquo;t built yet.
          </div>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
          <div className="card">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-slate-400">Draft board ({remaining.length} available)</span>
              <div className="ml-auto flex flex-wrap gap-1">
                {(["All", ...LINES] as const).map((line) => (
                  <button
                    key={line}
                    onClick={() => setLineFilter(line)}
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${lineFilter === line ? "bg-accent text-white" : "bg-base-700 text-slate-300 hover:bg-base-600"}`}
                  >
                    {line}
                  </button>
                ))}
              </div>
            </div>
            <div className="max-h-[32rem] overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-base-900">
                  <tr className="text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-1.5 pr-2">#</th>
                    <th className="py-1.5 pr-2">Prospect</th>
                    <th className="py-1.5 pr-2">State</th>
                    <th className="py-1.5 pr-2">Archetype</th>
                    <th className="py-1.5 pr-2 text-right">Scout OVR</th>
                    <th className="py-1.5 pr-2 text-right">Pot.</th>
                    <th className="py-1.5 pr-2 text-right">Conf</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRemaining.map((p, i) => {
                    const revealed = revealedFor(window_, p.PlayerID);
                    const band = scoutOvrBand(p, revealed.length);
                    const conf = scoutConfidence(p, revealed.length);
                    return (
                      <tr
                        key={p.PlayerID}
                        onClick={() => setSelectedId(p.PlayerID)}
                        className={`cursor-pointer border-t border-base-700 hover:bg-base-800 ${selectedId === p.PlayerID ? "bg-base-800" : ""}`}
                      >
                        <td className="py-1.5 pr-2 text-slate-500">{i + 1}</td>
                        <td className="py-1.5 pr-2 font-medium">{playerFullName(p)}</td>
                        <td className="py-1.5 pr-2 text-slate-400">{p.homeState}</td>
                        <td className="py-1.5 pr-2 text-slate-400">{p.archetype}</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">
                          {band.low}-{band.high}
                        </td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">{revealed.length === 0 ? "?" : potentialLetterGrade(p.POT)}</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">{conf}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            {selected ? (
              <ProspectProfile
                prospect={selected}
                pool={window_.pool}
                revealedAttrs={revealedFor(window_, selected.PlayerID)}
                budgetRemaining={window_.scoutingBudgetRemaining}
                onScout={(attr) => scoutAttribute(selected.PlayerID, attr)}
                onDraft={
                  isMyTurn
                    ? () => {
                        confirmDraftPick(selected.PlayerID);
                        setSelectedId(null);
                      }
                    : undefined
                }
              />
            ) : (
              <div className="text-sm text-slate-500">Select a prospect from the board to see their scouting profile.</div>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="card">
          <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Recent picks</div>
          {window_.picks.length === 0 ? (
            <div className="text-sm text-slate-500">No picks yet.</div>
          ) : (
            <div className="space-y-1.5 text-sm">
              {[...window_.picks]
                .slice(-6)
                .reverse()
                .map((rec) => (
                  <div key={rec.pickNumber} className="flex justify-between gap-2">
                    <span className="shrink-0 text-slate-400">
                      Pick {rec.pickNumber} · {rec.clubName}
                    </span>
                    <span className="truncate text-right font-medium">{rec.playerName}</span>
                  </div>
                ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Upcoming selections</div>
          {upcoming.length === 0 ? (
            <div className="text-sm text-slate-500">Draft&rsquo;s finished.</div>
          ) : (
            <div className="space-y-1.5 text-sm">
              {upcoming.map((club, i) => {
                const need = likelyNeedForClub(club, playersByClub);
                return (
                  <div key={i} className="flex justify-between gap-2">
                    <span className="shrink-0 text-slate-400">
                      Pick {window_.currentPickIndex + i + 1} · {club}
                    </span>
                    <span className="text-right text-xs text-slate-500">{need ? `Likely: ${need}` : "Best available"}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card">
          <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Your draft picks tonight ({myClub})</div>
          {myPicks.length === 0 ? (
            <div className="text-sm text-slate-500">No picks made yet.</div>
          ) : (
            <div className="space-y-1.5 text-sm">
              {myPicks.map((rec) => (
                <div key={rec.pickNumber} className="flex justify-between gap-2">
                  <span className="shrink-0 text-slate-400">
                    Round {rec.round} · Pick {rec.pickNumber}
                  </span>
                  <span className="truncate text-right font-medium">{rec.playerName}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProspectProfile({
  prospect,
  pool,
  revealedAttrs,
  budgetRemaining,
  onScout,
  onDraft,
}: {
  prospect: Player;
  pool: Player[];
  revealedAttrs: RatedAttribute[];
  budgetRemaining: number;
  onScout: (attr: RatedAttribute) => void;
  onDraft?: () => void;
}) {
  const band = scoutOvrBand(prospect, revealedAttrs.length);
  const conf = scoutConfidence(prospect, revealedAttrs.length);
  const width = Math.round((band.high - band.low) / 2);

  return (
    <div className="space-y-4">
      <div>
        <div className="font-display text-lg italic">{playerFullName(prospect)}</div>
        <div className="text-xs text-slate-400">
          {prospect.archetype} · {prospect.homeState} · Age {prospect.Age} · {prospect.height}cm / {prospect.weight}kg
        </div>
        <div className="mt-1 text-xs text-accent-light">
          ±{width} OVR read · {conf}% scouting confidence
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-center text-sm">
        <div>
          <div className="text-lg font-semibold tabular-nums">
            {band.low}-{band.high}
          </div>
          <div className="text-xs text-slate-500">Scout OVR</div>
        </div>
        <div>
          <div className="text-lg font-semibold tabular-nums">{revealedAttrs.length === 0 ? "?" : potentialLetterGrade(prospect.POT)}</div>
          <div className="text-xs text-slate-500">Potential</div>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
          <span>
            Attributes ({revealedAttrs.length}/{SCOUT_HEADLINE_ATTRIBUTES.length} revealed)
          </span>
          <span className="text-slate-500">Scout budget: {budgetRemaining} left</span>
        </div>
        <div className="space-y-1.5">
          {SCOUT_HEADLINE_ATTRIBUTES.map((attr) => {
            const isRevealed = revealedAttrs.includes(attr);
            return (
              <div key={attr} className="flex items-center justify-between text-sm">
                <span className="text-slate-400">{HEADLINE_ATTR_LABELS[attr]}</span>
                {isRevealed ? (
                  <span className="tabular-nums font-semibold">{prospect[attr]}</span>
                ) : (
                  <button
                    disabled={budgetRemaining <= 0}
                    onClick={() => onScout(attr)}
                    className="rounded bg-base-700 px-2 py-0.5 text-xs font-semibold hover:bg-base-600 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Scout +1
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-xs uppercase tracking-wide text-slate-400">Mock draft outlets</div>
        <div className="space-y-1 text-sm">
          {MOCK_OUTLETS.map((outlet: MockOutlet) => {
            const range = mockProjection(prospect, pool, outlet);
            return (
              <div key={outlet} className="flex justify-between">
                <span className="text-slate-400">{outlet}</span>
                <span className="tabular-nums">
                  Picks {range.low}-{range.high}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {onDraft && (
        <button onClick={onDraft} className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-dark">
          Draft {playerFullName(prospect)}
        </button>
      )}
    </div>
  );
}
