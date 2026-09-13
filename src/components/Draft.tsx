import { useMemo, useState } from "react";
import { useGameStore } from "../store/useGameStore";
import { useSaveStore } from "../store/useSaveStore";
import { useDraftStore } from "../store/useDraftStore";
import { useCombineStore } from "../store/useCombineStore";
import { useSeasonStore } from "../store/useSeasonStore";
import { buildLeaguePlayersByClub } from "../engine/listNeeds";
import {
  potentialLetterGrade,
  scoutOvrBand,
  scoutConfidence,
  scoutAccuracyFor,
  mockProjection,
  MOCK_OUTLETS,
  likelyNeedForClub,
  SCOUT_HEADLINE_ATTRIBUTES,
  DRAFT_ROUNDS,
  scoutingTiersForPool,
  scoutingReportFor,
  scoutingSummaryFor,
  playsLikeFor,
  playsLikeConfidenceLabel,
  predictedDraftRange,
  primaryTieFor,
  type MockOutlet,
  type ScoutingTier,
  type PredictedDraftRange,
} from "../engine/draft";
import type { DraftWindow } from "../engine/saveGame";
import type { RealProspectTie } from "../data/realProspects";
import { ARCHETYPE_LINE, LINES, type Line } from "../data/lines";
import type { Archetype } from "../types/archetype";
import { CLUBS } from "../types/club";
import { ALL_PLAYERS } from "../data/loadPlayers";
import { ASSISTANT_COACH_POOL } from "../data/assistantCoachPool";
import { gradeForOvr, SCOUT_FOCUS_AREAS, type Coach, type ScoutFocusArea } from "../types/coach";
import { playerFullName, type Player, type RatedAttribute } from "../types/player";
import { StatusPill, type PillTone } from "./StatusPill";
import { Modal } from "./Modal";

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
 * - **The `COMBINE` tag + `COMBINE ONLY` filter** (User Interface.md names
 *   both) now do something real, closing that gap from this slice's own
 *   original scope note: if this year's National Combine has been run (see
 *   engine/combine.ts, Phase 4 "Slice 6"), whichever of this board's
 *   prospects were among its `COMBINE_INVITE_COUNT` (80) tested invitees get
 *   a small tag next to their name, and the toggle filters the board down to
 *   just them. Reads directly off `useCombineStore`'s window for the current
 *   year — no combine, or a stale prior-year one, and the tag/toggle simply
 *   don't appear (this board works exactly as it always did if Combine was
 *   skipped this off-season).
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
 *
 * **Round 77**: the board's default sort is now `engine/draft.ts`'s new
 * `predictedDraftRange` (a "Predicted pick" column, e.g. "5-8"), with an
 * explicit 3-way toggle (Predicted/Overall/Potential) replacing the old
 * fixed `scoutOvrBand`-midpoint sort — Tyler's own instruction. "Predicted
 * pick" is deliberately NOT gated behind the scouting-reveal fog the same
 * way `mockProjection`'s 3 outlet cards already aren't: it's presented as
 * external/in-house draft-stock analysis, not something the coach's own
 * scouting spend reveals, so it (like the mock outlets) is visible for every
 * prospect regardless of `revealedAttrs`.
 *
 * **Round 83**: the Talent Scout half of [[Assistant Coaching System]] is now
 * live — `TalentScoutPanel` (new this round) lets the coach assign anyone
 * from `data/assistantCoachPool.ts` as their club's Talent Scout and
 * optionally direct them at one of the 6 `SCOUT_FOCUS_AREAS`. The resolved
 * per-prospect accuracy (`engine/draft.ts`'s `scoutAccuracyFor`) now feeds
 * every fog-of-war surface on this screen — the board's Scout OVR/Conf
 * columns, the Prospect Profile panel's own band/confidence/predicted range,
 * and the `predictedRangeByPlayerId` sort map — replacing the flat
 * `DEFAULT_SCOUT_ACCURACY` every one of those call sites used through round
 * 82. No scout assigned still reads byte-identical to every prior round.
 *
 * **Round 94 Part 2** — [[Season Grading, Post-Season Awards, and Player History]]'s own Player
 * Profile redesign round bundled two more Tyler asks: "our draft talent pool will also need a player
 * profile which can be opened and purveyed by the player" and "a section which shows the 1 or 2
 * sentence player writeup summary." `ProspectProfile` below gains a new "Summary" section
 * (`scoutingSummaryFor`, a truncation of the exact same `scoutingReportFor` text the fuller "Scouting
 * report" section already shows — one source of truth, never two disagreeing write-ups) and an
 * optional `onOpenProfile` button. `ProspectProfileModal` (new) is the "player profile which can be
 * opened" itself — a genuine modal overlay, reusing `ProspectProfile`'s exact content rather than a
 * parallel implementation, opened via that new button. Deliberately does NOT replace the existing
 * always-visible sidebar `ProspectProfile` (the interactive scouting/drafting workstation stays
 * exactly as fast to use — no modal round-trip needed just to spend one more scouting-budget reveal);
 * the modal is a bigger, considered "look this prospect over" view layered on top, matching how
 * rostered players already get both a click-to-select context AND a dedicated `PlayerProfileModal`.
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

/** Round 77 board sort modes — "predicted" (the new default) sorts by `predictedDraftRange`'s own midpoint; "overall"/"potential" sort by the prospect's true (unfogged) OVR/POT directly, same "sort key is the true value, DISPLAY stays fogged" split the old default sort already used via `scoutOvrBand`. */
type SortMode = "predicted" | "overall" | "potential";

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
  const talentScout = useSaveStore((s) => s.talentScout);
  const assignTalentScout = useSaveStore((s) => s.assignTalentScout);
  const setScoutFocusArea = useSaveStore((s) => s.setScoutFocusArea);
  const window_ = useDraftStore((s) => s.window);
  const combineWindow_ = useCombineStore((s) => s.window);
  const ladder = useSeasonStore((s) => s.season?.ladder);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [lineFilter, setLineFilter] = useState<Line | "All">("All");
  const [combineOnly, setCombineOnly] = useState(false);
  // Round 77 — Tyler's own instruction: "the default sort should be on their
  // predicted draft order and players should be able to sort the list by
  // Overall and Potential too."
  const [sortMode, setSortMode] = useState<SortMode>("predicted");
  // Round 94 Part 2 — which prospect's full profile modal is open, if any. Independent of
  // `selectedId` (the sidebar's own compact scouting-workstation selection) — a coach can browse the
  // fuller modal without losing or changing their board selection underneath it.
  const [profileModalId, setProfileModalId] = useState<number | null>(null);

  // Round 83 — [[Assistant Coaching System]]'s Talent Scout integration.
  // `assignedScout`/`focusArea` are resolved once here and threaded into
  // every scoutOvrBand/scoutConfidence/predictedDraftRange call below via
  // `accuracyFor`, rather than each call site re-deriving them.
  const assignedScout: Coach | null = talentScout ? (ASSISTANT_COACH_POOL.find((c) => c.id === talentScout.coachId) ?? null) : null;
  const focusArea: ScoutFocusArea | null = talentScout?.focusArea ?? null;
  const accuracyFor = (p: Player) => scoutAccuracyFor(p, assignedScout, focusArea);
  const scoutPanel = <TalentScoutPanel assignedScout={assignedScout} focusArea={focusArea} onAssign={assignTalentScout} onFocus={setScoutFocusArea} />;

  // Only meaningful if this year's Combine actually ran — a stale prior-year
  // window (or none at all) just means no prospect gets tagged, same as if
  // Combine had never been built.
  const combineInvitedIds = useMemo(
    () => (combineWindow_ && combineWindow_.year === currentYear ? new Set(combineWindow_.invitedPlayerIds) : null),
    [combineWindow_, currentYear],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const playersByClub = useMemo(() => buildLeaguePlayersByClub(), [poolVersion]);

  // Sep 2026 — real prospect pool round. Computed once per draft night
  // (`window_.pool` is fixed for the whole night, see DraftWindow's own doc
  // comment), not once per rendered board row — matches
  // `scoutingTiersForPool`'s own doc comment on why it's a whole-pool
  // function rather than a per-prospect one.
  const tierByPlayerId = useMemo(() => (window_ ? scoutingTiersForPool(window_.pool) : new Map<number, ScoutingTier>()), [window_]);

  // Round 77 — same "computed once per draft night off the fixed window_.pool,
  // not once per rendered row" convention as tierByPlayerId above.
  // predictedDraftRange internally re-sorts the whole pool per call, so this
  // is O(n^2 log n) for n≈195 (~ok once per pool, not per keystroke).
  // Round 83 — depends on assignedScout/focusArea too now, so a scout
  // (re)assignment or focus change recomputes every prospect's range.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const predictedRangeByPlayerId = useMemo(() => {
    const map = new Map<number, PredictedDraftRange>();
    if (!window_) return map;
    for (const p of window_.pool) map.set(p.PlayerID, predictedDraftRange(p, window_.pool, accuracyFor(p)));
    return map;
  }, [window_, assignedScout, focusArea]);

  if (!window_) {
    return (
      <div className="space-y-6">
        {scoutPanel}
        <div className="card text-center">
          <div className="mb-2 font-display text-xl italic">The {currentYear} National Draft hasn&rsquo;t started yet.</div>
          <p className="mx-auto mb-4 max-w-md text-sm text-slate-400">
            {ladder && ladder.length > 0
              ? "Draft order is set from this season's final ladder — last place picks first, 5 rounds, 90 picks total."
              : "No season's been completed yet, so draft order falls back to a fixed club order for now — play a season first if you want a real reverse-ladder order."}
          </p>
          <button onClick={startDraft} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark">
            Start the {currentYear} National Draft
          </button>
        </div>
      </div>
    );
  }

  const isComplete = window_.currentPickIndex >= window_.order.length;
  const clubOnClock = isComplete ? null : window_.order[window_.currentPickIndex];
  const isMyTurn = clubOnClock === myClub;
  const round = Math.min(DRAFT_ROUNDS, Math.floor(window_.currentPickIndex / CLUBS.length) + 1);

  const pickedIds = new Set(window_.picks.map((p) => p.playerId));
  const remaining = window_.pool.filter((p) => !pickedIds.has(p.PlayerID));
  const lineFiltered = lineFilter === "All" ? remaining : remaining.filter((p) => ARCHETYPE_LINE[p.archetype as Archetype] === lineFilter);
  const filteredRemaining = combineOnly && combineInvitedIds ? lineFiltered.filter((p) => combineInvitedIds.has(p.PlayerID)) : lineFiltered;
  const sortedRemaining = [...filteredRemaining].sort((a, b) => {
    if (sortMode === "overall") return b.OVR - a.OVR;
    if (sortMode === "potential") return b.POT - a.POT;
    const rangeA = predictedRangeByPlayerId.get(a.PlayerID);
    const rangeB = predictedRangeByPlayerId.get(b.PlayerID);
    const midA = rangeA ? (rangeA.low + rangeA.high) / 2 : Number.MAX_SAFE_INTEGER;
    const midB = rangeB ? (rangeB.low + rangeB.high) / 2 : Number.MAX_SAFE_INTEGER;
    return midA - midB;
  });
  const selected = selectedId !== null ? (remaining.find((p) => p.PlayerID === selectedId) ?? null) : null;

  const myPicks = window_.picks.filter((p) => p.clubName === myClub);
  const upcoming = window_.order.slice(window_.currentPickIndex, window_.currentPickIndex + 5);

  return (
    <div className="space-y-6">
      {scoutPanel}
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
              <button onClick={skipToMyPick} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark">
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
              <div className="ml-auto flex flex-wrap items-center gap-1">
                {combineInvitedIds && (
                  <button
                    onClick={() => setCombineOnly((v) => !v)}
                    title="Show only this year's National Combine invitees"
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${combineOnly ? "bg-primary text-white" : "bg-base-700 text-slate-300 hover:bg-base-600"}`}
                  >
                    COMBINE ONLY
                  </button>
                )}
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
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <span className="text-xs uppercase tracking-wide text-slate-500">Sort:</span>
              {(
                [
                  ["predicted", "Predicted"],
                  ["overall", "Overall"],
                  ["potential", "Potential"],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  onClick={() => setSortMode(mode)}
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${sortMode === mode ? "bg-primary text-white" : "bg-base-700 text-slate-300 hover:bg-base-600"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="max-h-[32rem] overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-base-900">
                  <tr className="text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-1.5 pr-2">#</th>
                    <th className="py-1.5 pr-2">Predicted pick</th>
                    <th className="py-1.5 pr-2">Prospect</th>
                    <th className="py-1.5 pr-2">State</th>
                    <th className="py-1.5 pr-2">Archetype</th>
                    <th className="py-1.5 pr-2 text-right">Scout OVR</th>
                    <th className="py-1.5 pr-2 text-right">Pot.</th>
                    <th className="py-1.5 pr-2">Scouting tier</th>
                    <th className="py-1.5 pr-2 text-right">Conf</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRemaining.map((p, i) => {
                    const revealed = revealedFor(window_, p.PlayerID);
                    const accuracy = accuracyFor(p);
                    const band = scoutOvrBand(p, revealed.length, accuracy);
                    const conf = scoutConfidence(p, revealed.length, accuracy);
                    const tie = primaryTieFor(p);
                    return (
                      <tr
                        key={p.PlayerID}
                        onClick={() => setSelectedId(p.PlayerID)}
                        className={`cursor-pointer border-t border-base-700 hover:bg-base-800 ${selectedId === p.PlayerID ? "bg-base-800" : ""}`}
                      >
                        <td className="py-1.5 pr-2 text-slate-500">{i + 1}</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums text-accent-light">
                          {(() => {
                            const range = predictedRangeByPlayerId.get(p.PlayerID);
                            if (!range) return "—";
                            return range.low === range.high ? range.low : `${range.low}-${range.high}`;
                          })()}
                        </td>
                        <td className="py-1.5 pr-2 font-medium">
                          <span className="inline-flex items-center gap-1.5">
                            {playerFullName(p)}
                            {combineInvitedIds?.has(p.PlayerID) && <StatusPill label="COMBINE" tone="info" />}
                            {tie && <TieBadge tie={tie} />}
                          </span>
                        </td>
                        <td className="py-1.5 pr-2 text-slate-400">{p.homeState}</td>
                        <td className="py-1.5 pr-2 text-slate-400">{p.archetype}</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">
                          {band.low}-{band.high}
                        </td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">{revealed.length === 0 ? "?" : potentialLetterGrade(p.POT)}</td>
                        <td className="py-1.5 pr-2">
                          {revealed.length === 0 ? <span className="text-slate-500">?</span> : <ScoutingTierLabel tier={tierByPlayerId.get(p.PlayerID)} />}
                        </td>
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
                tier={tierByPlayerId.get(selected.PlayerID)}
                revealedAttrs={revealedFor(window_, selected.PlayerID)}
                budgetRemaining={window_.scoutingBudgetRemaining}
                scoutAccuracy={accuracyFor(selected)}
                onScout={(attr) => scoutAttribute(selected.PlayerID, attr)}
                onDraft={
                  isMyTurn
                    ? () => {
                        confirmDraftPick(selected.PlayerID);
                        setSelectedId(null);
                      }
                    : undefined
                }
                onOpenProfile={() => setProfileModalId(selected.PlayerID)}
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

      {profileModalId !== null &&
        (() => {
          const modalProspect = window_.pool.find((p) => p.PlayerID === profileModalId) ?? null;
          if (!modalProspect) return null;
          return (
            <ProspectProfileModal
              prospect={modalProspect}
              pool={window_.pool}
              tier={tierByPlayerId.get(modalProspect.PlayerID)}
              revealedAttrs={revealedFor(window_, modalProspect.PlayerID)}
              budgetRemaining={window_.scoutingBudgetRemaining}
              scoutAccuracy={accuracyFor(modalProspect)}
              onScout={(attr) => scoutAttribute(modalProspect.PlayerID, attr)}
              onDraft={
                isMyTurn
                  ? () => {
                      confirmDraftPick(modalProspect.PlayerID);
                      setProfileModalId(null);
                      setSelectedId(null);
                    }
                  : undefined
              }
              onClose={() => setProfileModalId(null)}
            />
          );
        })()}
    </div>
  );
}

/** Sep 2026 — real prospect pool round. Maps a `ScoutingTier` to `StatusPill`'s existing tone language rather than inventing new colours; Generational Talent/Superstar render `solid` so the two tiers Tyler explicitly said are worth "really going for" visually pop more than the rest. */
const TIER_TONE: Record<ScoutingTier, PillTone> = {
  "Generational Talent": "good",
  Superstar: "good",
  Elite: "good",
  Great: "info",
  Good: "info",
  Average: "warn",
  "Sub-par": "bad",
};

function ScoutingTierLabel({ tier }: { tier: ScoutingTier | undefined }) {
  if (!tier) return <span className="text-slate-500">?</span>;
  const solid = tier === "Generational Talent" || tier === "Superstar";
  return <StatusPill label={tier} tone={TIER_TONE[tier]} variant={solid ? "solid" : "soft"} />;
}

/** Round 88 — abbreviated type label for the compact `TieBadge`; spelled out in full wherever space allows instead (see `ProspectProfile`'s own tie line). */
const TIE_TYPE_ABBR: Record<RealProspectTie["type"], string> = {
  "Father-Son": "F/S",
  Academy: "Academy",
  NGA: "NGA",
};

/**
 * Round 88 — real Father-Son/Academy/NGA recruitment-pathway tie, surfaced via
 * `primaryTieFor` (engine/draft.ts). Shown regardless of scouting progress —
 * unlike `ScoutingTierLabel`, a tie isn't something scouting reveals, it's a
 * fact about the prospect's eligibility that determines who can bid-match for
 * them at pick time (see `applyFatherSonRedirect` in useSaveStore.ts). Reuses
 * `StatusPill`'s "info" tone, the same one already used for the COMBINE pill,
 * so this reads as informational rather than competing with the tier pills'
 * good/warn/bad language.
 */
function TieBadge({ tie }: { tie: RealProspectTie }) {
  return <StatusPill label={`${TIE_TYPE_ABBR[tie.type]} → ${tie.club}`} tone="info" />;
}

/**
 * Round 70 — backlog #42. `ALL_PLAYERS` (the live established/drafted
 * population, imported directly the same way Contracts.tsx/TradePeriod.tsx
 * already do for their own real-data reads) is the comp pool, never
 * `window_.pool` — comping a prospect to another undrafted prospect on the
 * same board would be nonsensical. `playsLikeFor` is a pure, cheap-enough
 * O(pool) scan — recomputed on render, same "cheap enough, recompute rather
 * than cache" convention `trueProspectRank`/`scoutingTierFor` already use,
 * not memoized separately here.
 */
function PlaysLikeLine({ prospect }: { prospect: Player }) {
  const comp = playsLikeFor(prospect, ALL_PLAYERS);
  if (!comp) return <p className="text-sm text-slate-500">No comparable real player found yet.</p>;
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="font-medium">{playerFullName(comp.player)}</span>
      <span className="text-xs text-slate-500">
        {comp.player.archetype} · {playsLikeConfidenceLabel(comp.distance)}
      </span>
    </div>
  );
}

function ProspectProfile({
  prospect,
  pool,
  tier,
  revealedAttrs,
  budgetRemaining,
  scoutAccuracy,
  onScout,
  onDraft,
  onOpenProfile,
}: {
  prospect: Player;
  pool: Player[];
  tier: ScoutingTier | undefined;
  revealedAttrs: RatedAttribute[];
  budgetRemaining: number;
  /** Round 83 — resolved by the caller via `scoutAccuracyFor` against the club's assigned Talent Scout (or `DEFAULT_SCOUT_ACCURACY` if none). */
  scoutAccuracy: number;
  onScout: (attr: RatedAttribute) => void;
  onDraft?: () => void;
  /** Round 94 Part 2 — opens `ProspectProfileModal` for this same prospect. Omitted (not just falsy) when `ProspectProfile` is itself already being rendered AS that modal's own body — a "view full profile" button that reopens the modal it's already inside of would be nonsensical. */
  onOpenProfile?: () => void;
}) {
  const band = scoutOvrBand(prospect, revealedAttrs.length, scoutAccuracy);
  const conf = scoutConfidence(prospect, revealedAttrs.length, scoutAccuracy);
  const width = Math.round((band.high - band.low) / 2);
  const scouted = revealedAttrs.length > 0;
  const tie = primaryTieFor(prospect);

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-start justify-between gap-2">
          <div className="font-display text-lg italic">{playerFullName(prospect)}</div>
          {onOpenProfile && (
            <button onClick={onOpenProfile} className="shrink-0 rounded-lg bg-base-700 px-2.5 py-1 text-xs font-semibold hover:bg-base-600">
              View full profile
            </button>
          )}
        </div>
        <div className="text-xs text-slate-400">
          {prospect.archetype} · {prospect.homeState} · Age {prospect.Age} · {prospect.height}cm / {prospect.weight}kg
        </div>
        <div className="mt-1 text-xs text-accent-light">
          ±{width} OVR read · {conf}% scouting confidence
        </div>
        {tie && (
          <div className="mt-2 flex items-center gap-1.5">
            <TieBadge tie={tie} />
            <span className="text-xs text-slate-500">
              {tie.type === "Father-Son" ? "Father-Son selection" : tie.type === "NGA" ? "Next Generation Academy" : "Academy"} tie to {tie.club} —
              that club can bid-match to secure this pick.
            </span>
          </div>
        )}
      </div>

      <div>
        {/* Round 94 Part 2, Tyler: "a section which shows the 1 or 2 sentence player writeup summary."
            `scoutingSummaryFor` truncates the exact same text `scoutingReportFor` shows in full further
            down this panel — one source of truth, so the two can never disagree. */}
        <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">Summary</div>
        <p className="text-sm leading-relaxed text-slate-300">
          {scouted ? scoutingSummaryFor(prospect, tier) : "Scout at least one attribute to unlock a summary."}
        </p>
      </div>

      <div>
        <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">Scouting tier</div>
        {scouted ? <ScoutingTierLabel tier={tier} /> : <span className="text-sm text-slate-500">Unknown until scouted</span>}
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
        <div className="mb-1.5 text-xs uppercase tracking-wide text-slate-400">Scouting report</div>
        {scouted ? (
          <p className="whitespace-pre-line text-sm leading-relaxed text-slate-300">{scoutingReportFor(prospect, tier)}</p>
        ) : (
          <p className="text-sm text-slate-500">Scout at least one attribute to unlock this prospect's scouting report.</p>
        )}
      </div>

      <div>
        <div className="mb-1.5 text-xs uppercase tracking-wide text-slate-400">Plays like</div>
        {scouted ? <PlaysLikeLine prospect={prospect} /> : <p className="text-sm text-slate-500">Scout at least one attribute to unlock a comp.</p>}
      </div>

      <div>
        <div className="mb-1.5 text-xs uppercase tracking-wide text-slate-400">Predicted draft range</div>
        {(() => {
          const range = predictedDraftRange(prospect, pool, scoutAccuracy);
          return (
            <div className="text-lg font-semibold tabular-nums text-accent-light">{range.low === range.high ? `Pick ${range.low}` : `Picks ${range.low}-${range.high}`}</div>
          );
        })()}
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
        <button onClick={onDraft} className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark">
          Draft {playerFullName(prospect)}
        </button>
      )}
    </div>
  );
}

/**
 * Round 94 Part 2 — Tyler: "our draft talent pool will also need a player profile which can be opened
 * and purveyed by the player when determining which players they want to scout and which players to
 * draft." A thin `<Modal>` wrapper around `ProspectProfile`'s own content (no `onOpenProfile`, and thus
 * no "view full profile" button rendered inside itself) — the same "give this kind of entity a genuine
 * modal, not just an inline panel" treatment `PlayerProfileModal.tsx` already gives a rostered player.
 * Deliberately does not duplicate any of that component's scouting-tier/band/report/comp/range/mock-
 * outlet logic — it IS that component, just framed by a `Modal` instead of the sidebar `<div className="card">`.
 */
function ProspectProfileModal({
  prospect,
  pool,
  tier,
  revealedAttrs,
  budgetRemaining,
  scoutAccuracy,
  onScout,
  onDraft,
  onClose,
}: {
  prospect: Player;
  pool: Player[];
  tier: ScoutingTier | undefined;
  revealedAttrs: RatedAttribute[];
  budgetRemaining: number;
  scoutAccuracy: number;
  onScout: (attr: RatedAttribute) => void;
  onDraft?: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={playerFullName(prospect)} onClose={onClose}>
      <ProspectProfile
        prospect={prospect}
        pool={pool}
        tier={tier}
        revealedAttrs={revealedAttrs}
        budgetRemaining={budgetRemaining}
        scoutAccuracy={scoutAccuracy}
        onScout={onScout}
        onDraft={onDraft}
      />
    </Modal>
  );
}

/**
 * Round 83 — [[Assistant Coaching System]]'s Talent Scout integration. Lets
 * the coach assign anyone from the full `ASSISTANT_COACH_POOL` (84 coaches —
 * every one of them has SOME Talent Scout rating, not just the 3 whose
 * primary role is Talent Scout, per that pool's own "every role gets a
 * rating" design) as the club's Talent Scout, and optionally direct them at
 * one of the 6 `SCOUT_FOCUS_AREAS`. Deliberately a standalone panel here
 * rather than part of a general coaching-staff screen — no such screen
 * exists yet (the other 5 coaching roles have no gameplay hook at all this
 * round), so this is scoped to exactly the one save-state field
 * (`SaveGameData.talentScout`) round 83 actually adds.
 */
function TalentScoutPanel({
  assignedScout,
  focusArea,
  onAssign,
  onFocus,
}: {
  assignedScout: Coach | null;
  focusArea: ScoutFocusArea | null;
  onAssign: (coachId: number | null) => void;
  onFocus: (focusArea: ScoutFocusArea | null) => void;
}) {
  // Sorted once per render by Talent Scout OVR descending, purely so the
  // strongest real fits (Andy Collins, Murray Davis, Toby Windsor — the 3
  // with Talent Scout as their primary role — and any other well-graded
  // generalist) surface at the top of the dropdown rather than the coach
  // hunting through 84 names in pool-authoring order.
  const sortedScouts = [...ASSISTANT_COACH_POOL].sort((a, b) => b.ratings["Talent Scout"].ovr - a.ratings["Talent Scout"].ovr);
  const accuracyPct = assignedScout ? Math.round((assignedScout.ratings["Talent Scout"].ovr / 99) * 100) : null;

  return (
    <div className="card">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-slate-400">Talent Scout</span>
        <select
          value={assignedScout?.id ?? ""}
          onChange={(e) => onAssign(e.target.value === "" ? null : Number(e.target.value))}
          className="rounded-lg bg-base-700 px-2 py-1 text-xs font-semibold text-slate-200"
        >
          <option value="">No scout hired (baseline accuracy)</option>
          {sortedScouts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} — {gradeForOvr(c.ratings["Talent Scout"].ovr)} ({c.ratings["Talent Scout"].ovr} OVR)
            </option>
          ))}
        </select>
      </div>
      {assignedScout ? (
        <>
          <p className="mb-2 text-xs text-slate-400">{assignedScout.bio}</p>
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span className="text-xs uppercase tracking-wide text-slate-500">Focus:</span>
            <button
              onClick={() => onFocus(null)}
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${focusArea === null ? "bg-primary text-white" : "bg-base-700 text-slate-300 hover:bg-base-600"}`}
            >
              General (league-wide)
            </button>
            {SCOUT_FOCUS_AREAS.map((area) => (
              <button
                key={area}
                onClick={() => onFocus(area)}
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${focusArea === area ? "bg-primary text-white" : "bg-base-700 text-slate-300 hover:bg-base-600"}`}
              >
                {area}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-500">
            {focusArea
              ? `Full ${accuracyPct}% accuracy applies to ${focusArea} prospects only — every other archetype falls back to baseline accuracy.`
              : `Full ${accuracyPct}% accuracy applies league-wide (no focus set). Setting a focus concentrates it into one area at the cost of the rest.`}
          </p>
        </>
      ) : (
        <p className="text-xs text-slate-500">Using your club&rsquo;s baseline recruiting accuracy. Hire a Talent Scout above to sharpen your scouting reads — or, with a poor hire, blunt them.</p>
      )}
    </div>
  );
}
