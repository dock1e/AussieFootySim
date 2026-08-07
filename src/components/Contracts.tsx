import { useMemo, useState } from "react";
import { useGameStore } from "../store/useGameStore";
import { useSaveStore } from "../store/useSaveStore";
import { useContractStore } from "../store/useContractStore";
import { useSeasonStore } from "../store/useSeasonStore";
import { ALL_PLAYERS } from "../data/loadPlayers";
import { clubById } from "../types/club";
import { top8 } from "../engine/ladder";
import { buildLeaguePlayersByClub, computeLeagueStrategies } from "../engine/listNeeds";
import {
  freeAgentsFor,
  allFreeAgents,
  freeAgencyStatus,
  allClubCapRows,
  interestScore,
  evaluateOffer,
  statedAsk,
  compensationPickBand,
  SALARY_CAP,
  FOOTBALL_DEPT_CEILING,
  type FreeAgencyStatus,
  type OfferOutcome,
  type ClubCapRow,
} from "../engine/contracts";
import type { Player } from "../types/player";
import { playerFullName } from "../types/player";
import { PlayerDetailModal, money } from "./PlayerDetailModal";
import { StatusPill, type PillTone } from "./StatusPill";

/**
 * Contracts, salary cap & free agency — Phase 4 Slice 3 (ROADMAP.md).
 * User Interface.md's "Contracts" screen: header commitment figures, Your
 * Out-of-Contract Players, Free Agency Market, a negotiation modal, the
 * Salary Cap Breakdown table, and a League Activity feed. Deliberately its
 * own always-available tab rather than gated behind a formal Off-Season
 * Hub — same reasoning ListNeeds.tsx already gave (see its own doc
 * comment): only some of the 8 Off-Season Hub steps exist so far.
 *
 * **Cap resolved, Aug 2026, Tyler's direct call**: the original $18.5m
 * reference-site figure left every real club reading over cap out of the
 * box (`totalValue` was never calibrated against a total-list constraint —
 * see ROADMAP.md gap #44). Rather than recalibrate the valuation model,
 * `engine/contracts.ts`'s `SALARY_CAP` was raised to $28m instead — enough
 * that even the richest real club (West Coast, $26.333m committed) has a
 * small amount of genuine headroom, not just the least-over-cap club. Cap
 * status still shows prominently (an OVER CAP pill if any club ever does
 * exceed it) and still doesn't block actions even if one does — matching
 * how real leagues actually handle a breach (penalties/scrutiny after the
 * fact, not a hard transactional block).
 */

const STATUS_TONE: Record<FreeAgencyStatus, PillTone> = {
  Signed: "good",
  RFA: "warn",
  OOC: "warn",
  UFA: "bad",
};

export function Contracts() {
  const myClub = useGameStore((s) => s.myClub);
  const currentYear = useSaveStore((s) => s.year);
  const poolVersion = useSaveStore((s) => s.poolVersion);
  const reSignPlayer = useSaveStore((s) => s.reSignPlayer);
  const delistPlayer = useSaveStore((s) => s.delistPlayer);
  const signPlayerAsFreeAgent = useSaveStore((s) => s.signPlayerAsFreeAgent);
  const letAssistantManage = useSaveStore((s) => s.letAssistantManage);
  const window_ = useContractStore((s) => s.window);
  const ladder = useSeasonStore((s) => s.season?.ladder);

  const [viewingPlayer, setViewingPlayer] = useState<Player | null>(null);
  const [negotiating, setNegotiating] = useState<{ player: Player; isOwnPlayer: boolean } | null>(null);
  const [expandedClub, setExpandedClub] = useState<string | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const players = useMemo(() => ALL_PLAYERS, [poolVersion]);

  const ownFreeAgents = useMemo(() => freeAgentsFor(players, myClub, currentYear), [players, myClub, currentYear]);
  const marketFreeAgents = useMemo(() => allFreeAgents(players, myClub, currentYear), [players, myClub, currentYear]);

  const strategies = useMemo(() => computeLeagueStrategies(buildLeaguePlayersByClub()), [poolVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const top8Names = useMemo(() => {
    if (!ladder) return null;
    return new Set(top8(ladder).map((r) => clubById(r.clubId)?.name).filter((n): n is string => !!n));
  }, [ladder]);

  const sortedMarket = useMemo(
    () => [...marketFreeAgents].sort((a, b) => interestScore(b, myClub, currentYear, strategies, top8Names).score - interestScore(a, myClub, currentYear, strategies, top8Names).score),
    [marketFreeAgents, myClub, currentYear, strategies, top8Names],
  );

  const capRows = useMemo(() => allClubCapRows(players, currentYear), [players, currentYear]);
  const myCapRow = capRows.find((r) => r.clubName === myClub);

  const dayDisplay = Math.min(5, window_?.daysElapsed ?? 0);
  const activity = window_?.activity ?? [];

  return (
    <div className="space-y-6">
      <div className="card flex flex-wrap items-center gap-4">
        <div>
          <div className="font-display text-xl italic">{myClub} &mdash; Contracts</div>
          <div className="text-xs text-slate-400">Contract Day {dayDisplay}/5</div>
        </div>
        {myCapRow && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="tabular-nums">
              {money(myCapRow.wages)} / {money(SALARY_CAP)} cap
            </span>
            <StatusPill label={`${(myCapRow.capPct * 100).toFixed(1)}%`} tone={myCapRow.capPct > 1 ? "bad" : myCapRow.capPct > 0.9 ? "warn" : "good"} />
            {myCapRow.capPct > 1 && <StatusPill label="OVER CAP" tone="bad" />}
            {!myCapRow.floorMet && <StatusPill label="BELOW FLOOR" tone="warn" />}
            <span className="text-xs text-slate-500">Football Dept ceiling: {money(FOOTBALL_DEPT_CEILING)} (informational — no staff spend tracked yet)</span>
          </div>
        )}
        <button
          onClick={() => letAssistantManage()}
          className="ml-auto rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-dark"
          title="Simulates one more day of every rival club's contract activity"
        >
          Let Assistant Manage
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <FreeAgentList
          title="Your Out-of-Contract Players"
          empty="Every contracted player at this club is currently signed."
          players={ownFreeAgents}
          currentYear={currentYear}
          myClub={myClub}
          strategies={strategies}
          top8Names={top8Names}
          onView={setViewingPlayer}
          onAction={(p) => setNegotiating({ player: p, isOwnPlayer: true })}
          onDelist={(p) => delistPlayer(p.PlayerID)}
          actionLabel="Re-sign"
        />
        <FreeAgentList
          title="Free Agency Market"
          empty="No other club currently has an out-of-contract player."
          players={sortedMarket}
          currentYear={currentYear}
          myClub={myClub}
          strategies={strategies}
          top8Names={top8Names}
          onView={setViewingPlayer}
          onAction={(p) => setNegotiating({ player: p, isOwnPlayer: false })}
          actionLabel="Make Offer"
          showInterest
        />
      </div>

      <div className="card overflow-x-auto">
        <div className="mb-3 text-xs uppercase tracking-wide text-slate-400">Salary Cap Breakdown</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-base-600 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-2 py-2">Club</th>
              <th className="px-2 py-2 text-right">List</th>
              <th className="px-2 py-2 text-right">Wages</th>
              <th className="px-2 py-2 text-right">Cap %</th>
              <th className="px-2 py-2 text-center">Floor</th>
              <th className="px-2 py-2 text-right">Headroom</th>
              <th className="px-2 py-2 text-right">YR+1</th>
              <th className="px-2 py-2 text-right">YR+2</th>
            </tr>
          </thead>
          <tbody>
            {capRows.map((row) => (
              <CapRow
                key={row.clubName}
                row={row}
                isMyClub={row.clubName === myClub}
                expanded={expandedClub === row.clubName}
                onToggle={() => setExpandedClub((cur) => (cur === row.clubName ? null : row.clubName))}
                players={players}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="mb-3 text-xs uppercase tracking-wide text-slate-400">League Activity</div>
        {activity.length === 0 ? (
          <div className="text-sm text-slate-500">Nothing's happened yet this contract window.</div>
        ) : (
          <div className="max-h-72 space-y-1.5 overflow-y-auto text-sm">
            {[...activity].reverse().map((entry) => (
              <div key={entry.id} className="flex items-start gap-2 border-b border-base-700/60 pb-1.5 last:border-0">
                <span className="mt-0.5 shrink-0 text-[10px] text-slate-500">Day {entry.day}</span>
                <span className="text-slate-300">{entry.detail}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <PlayerDetailModal player={viewingPlayer} currentYear={currentYear} onClose={() => setViewingPlayer(null)} />

      {negotiating && (
        <NegotiationModal
          player={negotiating.player}
          isOwnPlayer={negotiating.isOwnPlayer}
          onClose={() => setNegotiating(null)}
          onFinalize={(terms) => {
            if (negotiating.isOwnPlayer) reSignPlayer(negotiating.player.PlayerID, terms);
            else signPlayerAsFreeAgent(negotiating.player.PlayerID, terms);
            setNegotiating(null);
          }}
        />
      )}
    </div>
  );
}

function CapRow({ row, isMyClub, expanded, onToggle, players }: { row: ClubCapRow; isMyClub: boolean; expanded: boolean; onToggle: () => void; players: Player[] }) {
  const top5 = useMemo(
    () =>
      expanded
        ? [...players]
            .filter((p) => p.Team === row.clubName && !p.delisted)
            .sort((a, b) => b.totalValue - a.totalValue)
            .slice(0, 5)
        : [],
    [expanded, players, row.clubName],
  );
  return (
    <>
      <tr className={`cursor-pointer border-b border-base-700/60 last:border-0 hover:bg-base-700/40 ${isMyClub ? "bg-accent/5" : ""}`} onClick={onToggle}>
        <td className="px-2 py-2 font-medium">{row.clubName}</td>
        <td className="px-2 py-2 text-right tabular-nums">{row.listSize}</td>
        <td className="px-2 py-2 text-right tabular-nums">{money(row.wages)}</td>
        <td className="px-2 py-2 text-right tabular-nums">
          <span className={row.capPct > 1 ? "text-bad" : row.capPct > 0.9 ? "text-warn" : ""}>{(row.capPct * 100).toFixed(1)}%</span>
        </td>
        <td className="px-2 py-2 text-center">
          <StatusPill label={row.floorMet ? "OK" : "LOW"} tone={row.floorMet ? "good" : "warn"} />
        </td>
        <td className="px-2 py-2 text-right tabular-nums">{money(row.headroom)}</td>
        <td className="px-2 py-2 text-right tabular-nums text-slate-400">{money(row.yr1)}</td>
        <td className="px-2 py-2 text-right tabular-nums text-slate-400">{money(row.yr2)}</td>
      </tr>
      {expanded && (
        <tr className="border-b border-base-700/60 bg-base-900/40 last:border-0">
          <td colSpan={8} className="px-4 py-2 text-xs text-slate-400">
            Top 5 cap hits: {top5.map((p) => `${p.lname} (${money(p.totalValue)})`).join(", ") || "—"}
          </td>
        </tr>
      )}
    </>
  );
}

function FreeAgentList({
  title,
  empty,
  players,
  currentYear,
  myClub,
  strategies,
  top8Names,
  onView,
  onAction,
  onDelist,
  actionLabel,
  showInterest,
}: {
  title: string;
  empty: string;
  players: Player[];
  currentYear: number;
  myClub: string;
  strategies: ReturnType<typeof computeLeagueStrategies>;
  top8Names: Set<string> | null;
  onView: (p: Player) => void;
  onAction: (p: Player) => void;
  onDelist?: (p: Player) => void;
  actionLabel: string;
  showInterest?: boolean;
}) {
  return (
    <div className="card">
      <div className="mb-3 text-xs uppercase tracking-wide text-slate-400">{title}</div>
      {players.length === 0 ? (
        <div className="text-sm text-slate-500">{empty}</div>
      ) : (
        <div className="space-y-2">
          {players.map((p) => {
            const status = freeAgencyStatus(p, currentYear);
            const interest = showInterest ? interestScore(p, myClub, currentYear, strategies, top8Names) : null;
            const comp = status === "UFA" ? compensationPickBand(p.totalValue) : null;
            return (
              <div key={p.PlayerID} className="flex flex-wrap items-center gap-2 rounded-lg bg-base-700/40 px-3 py-2 text-sm">
                <button className="font-medium hover:underline" onClick={() => onView(p)}>
                  {playerFullName(p)}
                </button>
                <span className="text-xs text-slate-500">
                  {p.archetype} &middot; {p.Age}y &middot; {p.OVR} OVR
                </span>
                {!showInterest && <span className="text-xs text-slate-500">{p.Team}</span>}
                <StatusPill label={status} tone={STATUS_TONE[status]} />
                <span className="text-xs tabular-nums text-slate-400">{money(statedAsk(p))}/yr ask</span>
                {showInterest && interest && <span className="text-xs tabular-nums text-accent-light">Interest {interest.score >= 0 ? "+" : ""}{interest.score}</span>}
                {comp && <span className="text-[10px] text-slate-500">Losing them: {comp} comp pick (notional)</span>}
                <div className="ml-auto flex gap-1.5">
                  <button onClick={() => onAction(p)} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-dark">
                    {actionLabel}
                  </button>
                  {onDelist && (
                    <button onClick={() => onDelist(p)} className="rounded-lg bg-base-800 px-3 py-1.5 text-xs text-slate-400 hover:bg-base-600">
                      Delist
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NegotiationModal({
  player,
  isOwnPlayer,
  onClose,
  onFinalize,
}: {
  player: Player;
  isOwnPlayer: boolean;
  onClose: () => void;
  onFinalize: (terms: { years: number; salaryPerYear: number }) => void;
}) {
  const ask = statedAsk(player);
  const [years, setYears] = useState(3);
  const [salary, setSalary] = useState(ask);
  const [playerOption, setPlayerOption] = useState(false);
  const [offersUsed, setOffersUsed] = useState(0);
  const [outcome, setOutcome] = useState<OfferOutcome | null>(null);

  const maxOffers = 3;
  const offersLeft = maxOffers - offersUsed;

  function submitOffer() {
    const result = evaluateOffer(player, salary, offersUsed, maxOffers);
    setOffersUsed((n) => n + 1);
    setOutcome(result);
    if (result.result === "accepted") {
      onFinalize({ years, salaryPerYear: salary });
    }
  }

  function acceptCounter(counter: number) {
    onFinalize({ years, salaryPerYear: counter });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-card border border-base-600 bg-base-800 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 font-display text-xl italic">
          {isOwnPlayer ? "Re-sign" : "Make Offer to"} {playerFullName(player)}
        </div>
        <div className="mb-4 text-xs text-slate-400">
          Stated ask: <span className="tabular-nums font-semibold text-slate-200">{money(ask)}/yr</span> &middot; Offers used: {offersUsed}/{maxOffers}
        </div>

        <div className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block text-slate-400">Years</span>
            <input
              type="number"
              min={1}
              max={6}
              value={years}
              onChange={(e) => setYears(Math.min(6, Math.max(1, Number(e.target.value) || 1)))}
              className="w-full rounded-lg bg-base-700 px-3 py-2 tabular-nums"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-400">Salary / yr</span>
            <input
              type="number"
              min={140_000}
              step={5000}
              value={salary}
              onChange={(e) => setSalary(Number(e.target.value) || 0)}
              className="w-full rounded-lg bg-base-700 px-3 py-2 tabular-nums"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <input type="checkbox" checked={playerOption} onChange={(e) => setPlayerOption(e.target.checked)} />
            Player option on final year (flavour only this slice — doesn't yet change anything mechanically)
          </label>
        </div>

        {outcome?.result === "countered" && (
          <div className="mt-3 rounded-lg bg-base-700/60 p-3 text-sm">
            <div className="mb-2">
              {playerFullName(player)} counters at <span className="tabular-nums font-semibold">{money(outcome.counterSalaryPerYear)}/yr</span>.
            </div>
            <div className="flex gap-2">
              <button onClick={() => acceptCounter(outcome.counterSalaryPerYear)} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-dark">
                Accept Counter
              </button>
              <button
                onClick={() => {
                  setSalary(outcome.counterSalaryPerYear);
                  setOutcome(null);
                }}
                className="rounded-lg bg-base-800 px-3 py-1.5 text-xs text-slate-300 hover:bg-base-600"
              >
                Adjust &amp; Resubmit
              </button>
            </div>
          </div>
        )}

        {outcome?.result === "rejected" && (
          <div className="mt-3 rounded-lg bg-bad/10 p-3 text-sm text-bad">
            {offersLeft > 0 ? "Offer rejected — too far below their ask. You can try again with an improved offer." : "Offer rejected — no offers left this window."}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg bg-base-700 px-4 py-2 text-sm text-slate-300 hover:bg-base-600">
            {outcome?.result === "rejected" || outcome === null ? "Cancel" : "Close"}
          </button>
          {outcome?.result !== "countered" && offersLeft > 0 && (
            <button onClick={submitOffer} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-dark">
              Submit Offer
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
