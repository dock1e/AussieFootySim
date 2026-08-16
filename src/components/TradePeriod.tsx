import { useMemo, useState } from "react";
import { useGameStore } from "../store/useGameStore";
import { useSaveStore } from "../store/useSaveStore";
import { useTradeStore } from "../store/useTradeStore";
import { ALL_PLAYERS } from "../data/loadPlayers";
import { CLUBS } from "../types/club";
import { computeLeagueStrategies, buildLeaguePlayersByClub } from "../engine/listNeeds";
import {
  buildTradeContext,
  evaluateTrade,
  tradeVolumePenalty,
  hasListInstability,
  isLegalListSize,
  projectedListSize,
  MIN_LEGAL_LIST_SIZE,
  MAX_LEGAL_LIST_SIZE,
  type TradeVerdict,
  type TradeOutcome,
  type TradeOffer,
} from "../engine/trade";
import type { Player } from "../types/player";
import { playerFullName } from "../types/player";
import { PlayerDetailModal, money } from "./PlayerDetailModal";
import { StatusPill, type PillTone } from "./StatusPill";

/**
 * Trade Period — Phase 4 Slice 4 (ROADMAP.md). User Interface.md's "Trade
 * Period" screen: header (day counter, both clubs' list size before/after),
 * Inbox (AI-initiated offers with dual verdict cards), Build an Offer
 * (partner picker, YOU GIVE/YOU GET panels, a live value/verdict strip,
 * Confirm modal disclosing the culture-penalty consequence), and a
 * Completed Trades log. engine/trade.ts is the load-bearing module; see its
 * own doc comments for the two real calibration bugs found and fixed while
 * building it (consent-tier thresholds, the AI-matching heuristic).
 *
 * **Disclosed simplification vs. the spec's roster browser**: User
 * Interface.md describes selecting a player by name from a browsable list
 * ("a second tap adds them"). This build uses a `<select>` dropdown + Add
 * button instead of a full searchable roster browser component (nothing
 * like that exists anywhere else in this codebase yet, and building one
 * would be a UI-component project of its own, not a Trade Period detail).
 * Inspection is still fully real: every player already added to either side
 * is a clickable name that opens the exact same `PlayerDetailModal` every
 * other screen uses.
 *
 * **Scope cuts carried over from ROADMAP.md's Slice 4 write-up**: no draft
 * picks as tradeable assets at all (the National Draft doesn't exist yet —
 * the YOU GIVE/YOU GET panels are players-only, and the "Draft Picks by
 * Club" reference grid is omitted rather than faked); no
 * trade-request-honouring flow (a player unprompted wanting out — deferred
 * as a separate mechanic); "club culture" has no persisted club-level stat
 * anywhere in this app's data model, so the culture-penalty numbers shown
 * before confirming are real and disclosed but not mechanically wired to
 * anything else yet — only the morale half of trade-volume fatigue is.
 */

const VERDICT_TONE: Record<TradeVerdict, PillTone> = {
  Overpay: "good",
  "Fair value with good fit": "good",
  "Close but short": "warn",
  "Below fair value": "bad",
};

export function TradePeriod() {
  const myClub = useGameStore((s) => s.myClub);
  const currentYear = useSaveStore((s) => s.year);
  const poolVersion = useSaveStore((s) => s.poolVersion);
  const confirmTrade = useSaveStore((s) => s.confirmTrade);
  const acceptInboundOffer = useSaveStore((s) => s.acceptInboundOffer);
  const rejectInboundOffer = useSaveStore((s) => s.rejectInboundOffer);
  const simulateTradeDay = useSaveStore((s) => s.simulateTradeDay);
  const window_ = useTradeStore((s) => s.window);

  const [viewingPlayer, setViewingPlayer] = useState<Player | null>(null);
  const [partnerClub, setPartnerClub] = useState<string>(() => CLUBS.find((c) => c.name !== myClub)?.name ?? "");
  const [giveIds, setGiveIds] = useState<number[]>([]);
  const [getIds, setGetIds] = useState<number[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [lastOutcome, setLastOutcome] = useState<TradeOutcome | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const players = useMemo(() => ALL_PLAYERS, [poolVersion]);
  const strategies = useMemo(() => computeLeagueStrategies(buildLeaguePlayersByClub()), [poolVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const ctx = useMemo(() => buildTradeContext(players, currentYear, strategies), [players, currentYear, strategies]);

  const myRoster = useMemo(() => players.filter((p) => p.Team === myClub && !p.delisted), [players, myClub]);
  const partnerRoster = useMemo(() => players.filter((p) => p.Team === partnerClub && !p.delisted), [players, partnerClub]);

  const givePlayers = useMemo(() => giveIds.map((id) => myRoster.find((p) => p.PlayerID === id)).filter((p): p is Player => !!p), [giveIds, myRoster]);
  const getPlayers = useMemo(() => getIds.map((id) => partnerRoster.find((p) => p.PlayerID === id)).filter((p): p is Player => !!p), [getIds, partnerRoster]);

  const liveEvaluation = useMemo(() => {
    if (givePlayers.length === 0 || getPlayers.length === 0) return null;
    return evaluateTrade(myClub, partnerClub, givePlayers, getPlayers, ctx);
  }, [myClub, partnerClub, givePlayers, getPlayers, ctx]);

  const tradesThisWindow = (window_?.activity ?? []).filter((a) => a.kind === "traded" && (a.clubName === myClub || a.fromClubName === myClub)).length;
  const nextTradePenalty = tradeVolumePenalty(tradesThisWindow);
  const dayDisplay = Math.min(10, window_?.daysElapsed ?? 0);
  const inbox = window_?.inbox ?? [];
  const activity = window_?.activity ?? [];

  const myListSize = myRoster.length;
  const partnerListSize = partnerRoster.length;
  const myAfter = projectedListSize(myListSize, giveIds.length, getIds.length);
  const partnerAfter = projectedListSize(partnerListSize, getIds.length, giveIds.length);
  const listSizeOk = isLegalListSize(myAfter) && isLegalListSize(partnerAfter);

  function switchPartner(next: string) {
    setPartnerClub(next);
    setGetIds([]); // spec: switching trade partner mid-build clears only the YOU GET side
    setLastOutcome(null);
  }

  function handleConfirm() {
    const outcome = confirmTrade(giveIds, getIds, partnerClub);
    setLastOutcome(outcome);
    setConfirming(false);
    if (outcome.result === "accepted") {
      setGiveIds([]);
      setGetIds([]);
    }
  }

  return (
    <div className="space-y-6">
      <div className="card flex flex-wrap items-center gap-4">
        <div>
          <div className="font-display text-xl italic">{myClub} &mdash; Trade Period</div>
          <div className="text-xs text-slate-400">
            Trade Day {dayDisplay}/10
            {hasListInstability(tradesThisWindow) && <span className="ml-2 text-warn">&middot; list instability</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="tabular-nums">
            {myClub}: {myListSize} &rarr; <span className={isLegalListSize(myAfter) ? "" : "text-bad"}>{myAfter}</span>
          </span>
          <span className="tabular-nums text-slate-400">
            {partnerClub}: {partnerListSize} &rarr; <span className={isLegalListSize(partnerAfter) ? "" : "text-bad"}>{partnerAfter}</span>
          </span>
          <span className="text-[10px] text-slate-500">Legal band: {MIN_LEGAL_LIST_SIZE}-{MAX_LEGAL_LIST_SIZE}</span>
        </div>
        <button
          onClick={() => simulateTradeDay()}
          className="ml-auto rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark"
          title="Simulates one more day of AI-vs-AI background trading, plus a fresh batch of inbound offers"
        >
          Simulate a Day
        </button>
      </div>

      <div className="card">
        <div className="mb-3 text-xs uppercase tracking-wide text-slate-400">Inbox</div>
        {inbox.length === 0 ? (
          <div className="text-sm text-slate-500">No incoming offers right now — try Simulate a Day.</div>
        ) : (
          <div className="space-y-3">
            {inbox.map((offer) => (
              <InboxOfferCard key={offer.id} offer={offer} myClub={myClub} players={players} ctx={ctx} onAccept={() => acceptInboundOffer(offer.id)} onReject={() => rejectInboundOffer(offer.id)} onViewPlayer={setViewingPlayer} />
            ))}
          </div>
        )}
      </div>

      <div className="card space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-xs uppercase tracking-wide text-slate-400">Build an Offer with</div>
          <select
            value={partnerClub}
            onChange={(e) => switchPartner(e.target.value)}
            className="rounded-lg bg-base-700 px-3 py-1.5 text-sm"
          >
            {CLUBS.filter((c) => c.name !== myClub).map((c) => (
              <option key={c.ClubID} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <TradeSidePanel
            label="YOU GIVE"
            roster={myRoster}
            selectedIds={giveIds}
            onAdd={(id) => setGiveIds((ids) => [...ids, id])}
            onRemove={(id) => setGiveIds((ids) => ids.filter((x) => x !== id))}
            onView={setViewingPlayer}
          />
          <TradeSidePanel
            label="YOU GET"
            roster={partnerRoster}
            selectedIds={getIds}
            onAdd={(id) => setGetIds((ids) => [...ids, id])}
            onRemove={(id) => setGetIds((ids) => ids.filter((x) => x !== id))}
            onView={setViewingPlayer}
          />
        </div>

        {liveEvaluation && (
          <div className="rounded-lg bg-base-700/40 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-slate-400">Their read:</span>
              <StatusPill label={liveEvaluation.recipientView.verdict} tone={VERDICT_TONE[liveEvaluation.recipientView.verdict]} />
              <span className="tabular-nums text-slate-400">
                ({liveEvaluation.recipientView.adjustedValueDelta >= 0 ? "+" : ""}
                {money(liveEvaluation.recipientView.adjustedValueDelta)} to them)
              </span>
              <span className="mx-1 text-slate-600">&middot;</span>
              <span className="text-slate-400">Your read:</span>
              <StatusPill label={liveEvaluation.proposerView.verdict} tone={VERDICT_TONE[liveEvaluation.proposerView.verdict]} />
            </div>
            {(liveEvaluation.recipientView.blocked || liveEvaluation.proposerView.blocked) && (
              <div className="mt-2 text-bad">
                {[...liveEvaluation.recipientView.factors, ...liveEvaluation.proposerView.factors].filter((f) => f.label.includes("REFUSES")).map((f) => f.label)[0] ?? "A player involved refuses this move."}
              </div>
            )}
          </div>
        )}

        {lastOutcome && lastOutcome.result !== "accepted" && (
          <div className="rounded-lg bg-warn/10 p-3 text-sm text-warn">
            {lastOutcome.result === "countered" ? (
              <>
                {partnerClub} counters — they also want <span className="font-semibold">{lastOutcome.addPlayerName}</span> added.{" "}
                <button className="underline" onClick={() => setGiveIds((ids) => [...ids, lastOutcome.addPlayerId])}>
                  Add them
                </button>
              </>
            ) : (
              <>Offer rejected — {lastOutcome.reason}</>
            )}
          </div>
        )}

        <div className="flex justify-end">
          <button
            disabled={giveIds.length === 0 || getIds.length === 0 || !listSizeOk}
            onClick={() => setConfirming(true)}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-40"
          >
            Confirm Offer
          </button>
        </div>
      </div>

      <div className="card">
        <div className="mb-3 text-xs uppercase tracking-wide text-slate-400">Completed Trades</div>
        {activity.length === 0 ? (
          <div className="text-sm text-slate-500">Nothing's happened yet this trade window.</div>
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
        <div className="mt-2 text-[11px] text-slate-500">
          Draft picks aren&rsquo;t tradeable yet — the National Draft and its pick-inventory system don&rsquo;t exist in this app.
        </div>
      </div>

      <PlayerDetailModal player={viewingPlayer} currentYear={currentYear} onClose={() => setViewingPlayer(null)} />

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setConfirming(false)}>
          <div className="w-full max-w-md rounded-card border border-base-600 bg-base-800 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 font-display text-xl italic">Confirm Offer</div>
            <div className="mb-3 space-y-1 text-sm">
              <div>
                <span className="text-slate-400">You give:</span> {givePlayers.map(playerFullName).join(", ") || "—"}
              </div>
              <div>
                <span className="text-slate-400">You get:</span> {getPlayers.map(playerFullName).join(", ") || "—"}
              </div>
            </div>
            <div className={`rounded-lg p-3 text-sm ${nextTradePenalty.cultureImpact !== 0 ? "bg-warn/10 text-warn" : "bg-base-700/40 text-slate-400"}`}>
              {nextTradePenalty.cultureImpact !== 0 ? nextTradePenalty.message : "No cultural impact from this trade."}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setConfirming(false)} className="rounded-lg bg-base-700 px-4 py-2 text-sm text-slate-300 hover:bg-base-600">
                Cancel
              </button>
              <button onClick={handleConfirm} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark">
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TradeSidePanel({
  label,
  roster,
  selectedIds,
  onAdd,
  onRemove,
  onView,
}: {
  label: string;
  roster: Player[];
  selectedIds: number[];
  onAdd: (id: number) => void;
  onRemove: (id: number) => void;
  onView: (p: Player) => void;
}) {
  const available = useMemo(() => roster.filter((p) => !selectedIds.includes(p.PlayerID)), [roster, selectedIds]);
  const [candidateId, setCandidateId] = useState<number | "">("");

  return (
    <div className="rounded-lg bg-base-700/30 p-3">
      <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">{label}</div>
      {selectedIds.length === 0 ? (
        <div className="mb-2 text-sm text-slate-500">Nobody added yet.</div>
      ) : (
        <div className="mb-2 space-y-1.5">
          {selectedIds.map((id) => {
            const p = roster.find((x) => x.PlayerID === id);
            if (!p) return null;
            return (
              <div key={id} className="flex items-center gap-2 rounded-lg bg-base-700/60 px-2.5 py-1.5 text-sm">
                <button className="font-medium hover:underline" onClick={() => onView(p)}>
                  {playerFullName(p)}
                </button>
                <span className="text-xs text-slate-500">
                  {p.archetype} &middot; {p.OVR} OVR &middot; {money(p.totalValue)}
                </span>
                <button onClick={() => onRemove(id)} className="ml-auto rounded-lg bg-base-800 px-2 py-1 text-xs text-slate-400 hover:bg-base-600" aria-label={`Remove ${playerFullName(p)}`}>
                  &times;
                </button>
              </div>
            );
          })}
        </div>
      )}
      <div className="flex gap-1.5">
        <select
          value={candidateId}
          onChange={(e) => setCandidateId(e.target.value ? Number(e.target.value) : "")}
          className="min-w-0 flex-1 rounded-lg bg-base-700 px-2 py-1.5 text-sm"
        >
          <option value="">Add a player&hellip;</option>
          {available.map((p) => (
            <option key={p.PlayerID} value={p.PlayerID}>
              {playerFullName(p)} &mdash; {p.archetype}, {p.OVR} OVR, {money(p.totalValue)}
            </option>
          ))}
        </select>
        <button
          disabled={candidateId === ""}
          onClick={() => {
            if (candidateId !== "") {
              onAdd(candidateId);
              setCandidateId("");
            }
          }}
          className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </div>
  );
}

function InboxOfferCard({
  offer,
  myClub,
  players,
  ctx,
  onAccept,
  onReject,
  onViewPlayer,
}: {
  offer: TradeOffer;
  myClub: string;
  players: Player[];
  ctx: ReturnType<typeof buildTradeContext>;
  onAccept: () => void;
  onReject: () => void;
  onViewPlayer: (p: Player) => void;
}) {
  const theyGive = offer.theyGivePlayerIds.map((id) => players.find((p) => p.PlayerID === id)).filter((p): p is Player => !!p);
  const theyWant = offer.theyWantPlayerIds.map((id) => players.find((p) => p.PlayerID === id)).filter((p): p is Player => !!p);
  const evaluation = theyGive.length > 0 && theyWant.length > 0 ? evaluateTrade(offer.fromClub, myClub, theyGive, theyWant, ctx) : null;

  return (
    <div className="rounded-lg bg-base-700/40 p-3 text-sm">
      <div className="mb-1 font-semibold">{offer.fromClub}</div>
      <div className="mb-1 text-slate-300">
        They give:{" "}
        {theyGive.map((p) => (
          <button key={p.PlayerID} className="mr-1 hover:underline" onClick={() => onViewPlayer(p)}>
            {playerFullName(p)}
          </button>
        ))}
      </div>
      <div className="mb-2 text-slate-300">
        They want:{" "}
        {theyWant.map((p) => (
          <button key={p.PlayerID} className="mr-1 hover:underline" onClick={() => onViewPlayer(p)}>
            {playerFullName(p)}
          </button>
        ))}
      </div>
      <div className="mb-2 text-xs italic text-slate-500">&ldquo;{offer.flavourLine}&rdquo;</div>

      {evaluation && (
        <div className="mb-2 flex flex-wrap gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500">{offer.fromClub} thinks:</span>
            <StatusPill label={evaluation.proposerView.verdict} tone={VERDICT_TONE[evaluation.proposerView.verdict]} />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500">You&rsquo;d read this as:</span>
            <StatusPill label={evaluation.recipientView.verdict} tone={VERDICT_TONE[evaluation.recipientView.verdict]} />
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={onAccept} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark">
          Accept
        </button>
        <button onClick={onReject} className="rounded-lg bg-base-800 px-3 py-1.5 text-xs text-slate-400 hover:bg-base-600">
          Reject
        </button>
      </div>
    </div>
  );
}
