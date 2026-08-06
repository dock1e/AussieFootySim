import { useMemo, useState } from "react";
import { useSeasonStore } from "../store/useSeasonStore";
import { useGameStore } from "../store/useGameStore";
import { CLUBS, clubById, clubByName } from "../types/club";
import { SEASON_ROUNDS, matchesInRound, type FixtureMatch } from "../engine/fixture";
import { nextUnplayedRound, isHomeAndAwayComplete, type PlayedMatch } from "../engine/season";
import type { MatchResult } from "../engine/match";
import type { MatchTeam } from "../engine/team";
import type { FinalsMatch, FinalsSeriesResult } from "../engine/finals";
import { LadderTable } from "./LadderTable";
import { FullTimeResult } from "./FullTimeResult";
import { CURRENT_SEASON_YEAR } from "../config";

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

  const [round, setRound] = useState(1);
  const [viewing, setViewing] = useState<Viewing | null>(null);

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
          className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-dark"
        >
          Start {CURRENT_SEASON_YEAR} Season
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
          <div className="font-display text-xl italic">{CURRENT_SEASON_YEAR} Season</div>
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
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-dark"
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
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-dark"
            >
              Run Finals Series
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
        <div className="font-display text-lg italic text-accent-light">
          Premiers: {clubById(premierClubId)?.name}
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
                  <div className="flex justify-between">
                    <span className={m.winnerClubId === m.homeClubId ? "font-semibold" : "text-slate-400"}>
                      {clubById(m.homeClubId)?.nickname}
                    </span>
                    <span className="tabular-nums">{m.result.home.points}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className={m.winnerClubId === m.awayClubId ? "font-semibold" : "text-slate-400"}>
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

function RoundFixture({
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
              <div className="flex justify-between">
                <span className={result && result.result.home.points > result.result.away.points ? "font-semibold" : ""}>
                  {home?.nickname}
                </span>
                <span className="tabular-nums text-slate-400">{result ? result.result.home.points : ""}</span>
              </div>
              <div className="flex justify-between">
                <span className={result && result.result.away.points > result.result.home.points ? "font-semibold" : ""}>
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
