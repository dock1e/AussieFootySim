import { useEffect, useMemo, useRef, useState } from "react";
import { useSeasonStore } from "../store/useSeasonStore";
import { useGameStore } from "../store/useGameStore";
import { useSaveStore } from "../store/useSaveStore";
import { CLUBS, clubById, clubByName } from "../types/club";
import { ClubBadge } from "./ClubBadge";
import { SEASON_ROUNDS, matchesInRound, type FixtureMatch } from "../engine/fixture";
import { nextUnplayedRound, isHomeAndAwayComplete, type PlayedMatch } from "../engine/season";
import type { MatchResult } from "../engine/match";
import type { MatchTeam } from "../engine/team";
import type { FinalsMatch, FinalsSeriesResult } from "../engine/finals";
import { LadderTable } from "./LadderTable";
import { FullTimeResult } from "./FullTimeResult";

/**
 * Season hub — Engine.md "Season lifecycle": `Pre-season -> [Round 1 ...
 * Round 23] -> Finals -> ...`. First pass covers the home-and-away rounds +
 * finals only (see src/engine/season.ts's own doc comment) — the
 * end-of-season sequence (List Needs, Combine, Contracts, Trade Period,
 * Draft, awards) is scoped separately as Phase 4.
 *
 * Rounds still simulate headlessly in one click rather than being played
 * one-by-one live — clicking any already-played match re-opens the existing
 * FullTimeResult screen to inspect it after the fact. Watching a specific
 * game live (via the Match tab's playback) is a natural follow-up, not built
 * into this first pass. What *is* wired in (see useSeasonStore.ts): the
 * user's own club fields its Selection Committee lineup (if complete) for
 * the whole season, and its Selection-tab Standing Game Plan (tactics/game
 * style) is re-applied fresh every round. Every other club is still an
 * auto-picked, no-tactics AI opponent (ROADMAP.md gap #22).
 */
type Viewing = { result: MatchResult; homeTeam: MatchTeam; awayTeam: MatchTeam; label: string };

export function SeasonHub() {
  const { season, teams, startNewSeason, simulateNextRound, simulateAllRemaining, playFinals } = useSeasonStore();
  const myClub = useGameStore((s) => s.myClub);
  const myClubId = useMemo(() => clubByName(myClub)?.ClubID ?? CLUBS[0].ClubID, [myClub]);
  const year = useSaveStore((s) => s.year);
  const runOffSeason = useSaveStore((s) => s.runOffSeason);
  const [runningOffSeason, setRunningOffSeason] = useState(false);

  const [round, setRound] = useState(1);
  const [viewing, setViewing] = useState<Viewing | null>(null);

  // A successful off-season bumps useSaveStore's poolVersion, and App.tsx
  // keys <main> off it specifically so this whole screen remounts fresh
  // (round back to 1, viewing closed) — which very likely happens *before*
  // the awaited runOffSeason() call below resolves back into this closure.
  // This ref guards the finally block's setRunningOffSeason(false) against
  // firing on that now-unmounted instance (harmless if it did — just a dev
  // console warning — but cheap to avoid outright).
  const mountedRef = useRef(true);
  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  async function handleOffSeason() {
    setRunningOffSeason(true);
    try {
      await runOffSeason();
    } finally {
      if (mountedRef.current) setRunningOffSeason(false);
    }
  }

  if (viewing) {
    return (
      <FullTimeResult
        result={viewing.result}
        homeTeam={viewing.homeTeam}
        awayTeam={viewing.awayTeam}
        closeLabel={`Back to ${viewing.label}`}
        onNewMatch={() => setViewing(null)}
      />
    );
  }

  if (!season || !teams) {
    return (
      <div className="card text-center">
        <div className="mb-2 font-display text-2xl italic">No season in progress</div>
        <p className="mb-4 text-sm text-slate-400">
          Generates a full {SEASON_ROUNDS}-round home-and-away fixture across all 18 clubs (see
          ROADMAP.md for the fixture-draw simplification), plus a standard top-8 finals series
          once it's complete. Uses {myClub}'s Selection tab lineup and Standing Game Plan if
          you've set them up — every other club auto-picks its best 22 with no tactics.
        </p>
        <button
          onClick={() => startNewSeason()}
          className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark"
        >
          Start {year} Season
        </button>
      </div>
    );
  }

  const complete = isHomeAndAwayComplete(season);
  const upNext = nextUnplayedRound(season);

  function openResult(homeClubId: number, awayClubId: number, result: MatchResult, label: string) {
    const home = teams!.get(homeClubId);
    const away = teams!.get(awayClubId);
    if (!home || !away) return;
    setViewing({ result, homeTeam: home, awayTeam: away, label });
  }

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-3">
        <div>
          <div className="font-display text-xl italic">{year} Season</div>
          <div className="text-xs text-slate-400">
            {complete
              ? season.finals
                ? `Premiers: ${clubById(season.premierClubId!)?.name}`
                : "Home-and-away complete — finals ready"
              : `Round ${upNext} of ${SEASON_ROUNDS} up next`}
          </div>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {!complete && (
            <>
              <button
                onClick={simulateNextRound}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark"
              >
                Simulate Round {upNext}
              </button>
              <button
                onClick={simulateAllRemaining}
                className="rounded-lg bg-base-700 px-4 py-2 text-sm font-medium hover:bg-base-600"
              >
                Simulate to Finals
              </button>
            </>
          )}
          {complete && !season.finals && (
            <button
              onClick={playFinals}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark"
            >
              Run Finals Series
            </button>
          )}
          {complete && season.finals && (
            <button
              onClick={handleOffSeason}
              disabled={runningOffSeason}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
              title="Ages every player a year (see ROADMAP.md's persistence writeup), then opens up a fresh pre-season."
            >
              {runningOffSeason ? "Running Off-Season…" : `Start ${year + 1} Off-Season`}
            </button>
          )}
          <button
            onClick={() => {
              startNewSeason();
              setRound(1);
            }}
            className="rounded-lg bg-base-800 px-4 py-2 text-sm text-slate-400 hover:bg-base-700"
          >
            New Season
          </button>
        </div>
      </div>

      {season.finals && (
        <FinalsBracket
          finals={season.finals}
          premierClubId={season.premierClubId!}
          onSelect={(fm) => openResult(fm.homeClubId, fm.awayClubId, fm.result, "finals")}
        />
      )}

      <LadderTable ladder={season.ladder} highlightClubId={myClubId} />

      <RoundFixture
        round={round}
        setRound={setRound}
        fixture={season.fixture}
        played={season.played}
        myClubId={myClubId}
        onSelect={(m) => openResult(m.homeClubId, m.awayClubId, m.result, `Round ${round}`)}
      />
    </div>
  );
}

function FinalsBracket({
  finals,
  premierClubId,
  onSelect,
}: {
  finals: FinalsSeriesResult;
  premierClubId: number;
  onSelect: (m: FinalsMatch) => void;
}) {
  const byWeek = [1, 2, 3, 4].map((w) => finals.matches.filter((m) => m.week === w));
  const weekLabel = ["Week 1", "Week 2 — Semis", "Week 3 — Prelims", "Grand Final"];
  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-slate-400">Finals series</div>
        <div className="flex items-center gap-1.5 font-display text-lg italic text-accent-light">
          Premiers: <ClubBadge club={clubById(premierClubId)} size="sm" /> {clubById(premierClubId)?.name}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        {byWeek.map((matches, i) => (
          <div key={i}>
            <div className="mb-1.5 text-xs text-slate-500">{weekLabel[i]}</div>
            <div className="space-y-1.5">
              {matches.map((m) => (
                <button
                  key={m.key}
                  onClick={() => onSelect(m)}
                  className="w-full rounded-lg bg-base-800 px-2.5 py-2 text-left text-xs hover:bg-base-700"
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <span className={`flex items-center gap-1.5 ${m.winnerClubId === m.homeClubId ? "font-semibold" : "text-slate-400"}`}>
                      <ClubBadge club={clubById(m.homeClubId)} size="sm" />
                      {clubById(m.homeClubId)?.nickname}
                    </span>
                    <span className="tabular-nums">{m.result.home.points}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-1.5">
                    <span className={`flex items-center gap-1.5 ${m.winnerClubId === m.awayClubId ? "font-semibold" : "text-slate-400"}`}>
                      <ClubBadge club={clubById(m.awayClubId)} size="sm" />
                      {clubById(m.awayClubId)?.nickname}
                    </span>
                    <span className="tabular-nums">{m.result.away.points}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Exported (Aug 2026 round 52, [[UI Consolidation Review]]) so Dashboard's
 * Ladder modal can embed the exact same round-by-round fixture browser
 * rather than duplicating this logic — see Dashboard.tsx's `LadderTable` +
 * `RoundFixture` pairing inside its `activeModal?.type === "ladder"` block
 * (round 53 moved this from an inline accordion to a centered modal, but the
 * reuse of this component is unchanged). Behaviour here is completely
 * unchanged for this screen's own use.
 */
export function RoundFixture({
  round,
  setRound,
  fixture,
  played,
  myClubId,
  onSelect,
}: {
  round: number;
  setRound: (r: number) => void;
  fixture: FixtureMatch[];
  played: PlayedMatch[];
  myClubId: number;
  onSelect: (m: PlayedMatch) => void;
}) {
  const matches = matchesInRound(fixture, round);
  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={() => setRound(Math.max(1, round - 1))}
          disabled={round <= 1}
          className="rounded-lg bg-base-800 px-3 py-1.5 text-sm hover:bg-base-700 disabled:opacity-30"
        >
          ←
        </button>
        <div className="text-xs uppercase tracking-wide text-slate-400">Round {round}</div>
        <button
          onClick={() => setRound(Math.min(SEASON_ROUNDS, round + 1))}
          disabled={round >= SEASON_ROUNDS}
          className="rounded-lg bg-base-800 px-3 py-1.5 text-sm hover:bg-base-700 disabled:opacity-30"
        >
          →
        </button>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-3">
        {matches.map((m) => {
          const result = played.find((p) => p.round === round && p.homeClubId === m.homeClubId);
          const isMine = m.homeClubId === myClubId || m.awayClubId === myClubId;
          const home = clubById(m.homeClubId);
          const away = clubById(m.awayClubId);
          const content = (
            <>
              <div className="flex items-center justify-between gap-1.5">
                <span className={`flex items-center gap-1.5 ${result && result.result.home.points > result.result.away.points ? "font-semibold" : ""}`}>
                  <ClubBadge club={home} size="sm" />
                  {home?.nickname}
                </span>
                <span className="tabular-nums text-slate-400">{result ? result.result.home.points : ""}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-1.5">
                <span className={`flex items-center gap-1.5 ${result && result.result.away.points > result.result.home.points ? "font-semibold" : ""}`}>
                  <ClubBadge club={away} size="sm" />
                  {away?.nickname}
                </span>
                <span className="tabular-nums text-slate-400">{result ? result.result.away.points : ""}</span>
              </div>
            </>
          );
          const base = `rounded-lg px-2.5 py-2 text-xs ${isMine ? "bg-accent/10 ring-1 ring-accent/40" : "bg-base-800"}`;
          return result ? (
            <button key={`${m.homeClubId}-${m.awayClubId}`} onClick={() => onSelect(result)} className={`${base} text-left hover:bg-base-700`}>
              {content}
            </button>
          ) : (
            <div key={`${m.homeClubId}-${m.awayClubId}`} className={base}>
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
