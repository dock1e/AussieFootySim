import { useMemo } from "react";
import type { Player } from "../types/player";
import { playerFullName } from "../types/player";
import { CLUBS, clubByName, clubById } from "../types/club";
import { useGameStore } from "../store/useGameStore";
import { useSeasonStore } from "../store/useSeasonStore";
import { useSaveStore } from "../store/useSaveStore";
import { useSelectionStore } from "../store/useSelectionStore";
import { getPlayersByClub, leagueAverageOvr, averageOvr } from "../data/loadPlayers";
import { summariseLines } from "../data/lines";
import { gapBand } from "./StatusPill";
import { LadderTable } from "./LadderTable";
import { isLineupComplete, lineupPlayerIds } from "../engine/selection";
import { freeAgentsFor } from "../engine/contracts";
import {
  lastPlayedMatchFor,
  upcomingFixtureFor,
  topPerformersFor,
  previousLadder,
  seasonPlayerTotals,
  leagueLeaders,
  ourLeagueBest,
  type PerformerLine,
  type LeagueStat,
  type SeasonPlayerTotals,
} from "../engine/seasonSummary";
import type { PlayedMatch, Season } from "../engine/season";
import type { FixtureMatch } from "../engine/fixture";
import type { LadderRow } from "../engine/ladder";
import type { MatchTeam } from "../engine/team";

/**
 * The coach's landing page — Aug 2026 round 50, [[Dashboard Redesign]].
 * Tyler: "I want this to show things relevant to the AussieFootySim coach...
 * where we are on the ladder... who did we just play, which of our players
 * had great games... who we'll play next (next 3 or 4 games) and their best
 * recent players... a section on actions... key statistic leads for the
 * competition and where our best players are in relation to that."
 *
 * The original slice of this file (club picker, list-size/OVR tiles,
 * line-rating bars) predates the season engine entirely — see its own prior
 * doc comment, quoted in [[Dashboard Redesign]]'s "Current state" section —
 * and is kept as-is below the new season-aware sections, still a real,
 * honest "roster depth" reference even though it's no longer the whole page.
 *
 * Every new section degrades gracefully to a friendly notice, never a crash
 * or a fake number, when `season` is `null` (no season started yet this
 * save) — same "optional and additive, graceful fallback" convention this
 * project has used since round 8.
 */

interface DashboardProps {
  onGoToSelection?: () => void;
  onGoToContracts?: () => void;
  onGoToSeason?: () => void;
}

export function Dashboard({ onGoToSelection, onGoToContracts, onGoToSeason }: DashboardProps) {
  const { myClub, setMyClub } = useGameStore();
  const club = clubByName(myClub);
  const myClubId = club?.ClubID;
  const season = useSeasonStore((s) => s.season);
  const teams = useSeasonStore((s) => s.teams);
  const year = useSaveStore((s) => s.year);
  const myLineup = useSelectionStore((s) => s.lineupFor(myClub));

  const players = useMemo(() => getPlayersByClub(myClub), [myClub]);
  const lines = useMemo(() => summariseLines(players, leagueAverageOvr()), [players]);
  const clubAvgOvr = useMemo(() => averageOvr(players), [players]);

  const lastMatch = useMemo(() => (season && myClubId !== undefined ? lastPlayedMatchFor(season, myClubId) : null), [season, myClubId]);
  const ourTopPerformers = useMemo(
    () => (season && teams && lastMatch && myClubId !== undefined ? topPerformersFor(lastMatch, teams, myClubId, 3) : []),
    [season, teams, lastMatch, myClubId],
  );

  const upcoming = useMemo(
    () => (season && myClubId !== undefined ? upcomingFixtureFor(season, myClubId, 4) : []),
    [season, myClubId],
  );

  const prevLadder = useMemo(() => (season ? previousLadder(season) : []), [season]);

  const totals = useMemo(() => (season ? seasonPlayerTotals(season) : null), [season]);

  // Reuses the exact same `freeAgentsFor` Contracts.tsx's own "Your Out-of-Contract Players" list
  // is built from (round 50, real bug caught live: an earlier `expired_year <= year` heuristic
  // here counted 9 against Contracts' own real 3, since `freeAgencyStatus` only treats a contract
  // as lapsed — not "Signed" — once `expired_year` has actually passed, not merely reached; see
  // engine/contracts.ts's own `freeAgencyStatus`) — this way the count shown here can never drift
  // from what clicking through to Contracts actually shows.
  const contractsOutThisYear = useMemo(() => freeAgentsFor(players, myClub, year).length, [players, myClub, year]);

  const lineupSet = myLineup ? isLineupComplete(myLineup) : false;

  const emergingTalent = useMemo(() => {
    const rostered = new Set(myLineup ? lineupPlayerIds(myLineup) : []);
    return players
      .filter((p) => p.Age <= 21 && !rostered.has(p.PlayerID))
      .sort((a, b) => b.POT - a.POT)
      .slice(0, 3);
  }, [players, myLineup]);

  return (
    <div className="space-y-6">
      {/* Left border in the club's own colour — Aug 2026 branding pass (ROADMAP.md item #13):
          the one moment on this screen that's most "this is YOUR club," styled the way a real
          broadcast product colour-codes team identity at a glance. */}
      <div
        className="card flex flex-wrap items-center justify-between gap-4 border-l-4"
        style={{ borderLeftColor: club?.primaryColor }}
      >
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400">Coaching</div>
          <div className="flex items-center gap-2 font-display text-2xl">
            <span className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: club?.primaryColor }} />
            {club?.name} <span className="text-slate-400">{club?.nickname}</span>
          </div>
          <div className="text-xs text-slate-500">
            {club?.colours} &middot; {club?.homeState} &middot; founded {club?.founded}
          </div>
        </div>
        <select
          className="rounded-lg border border-base-600 bg-base-900 px-3 py-2 text-sm"
          value={myClub}
          onChange={(e) => setMyClub(e.target.value)}
        >
          {CLUBS.map((c) => (
            <option key={c.ClubID} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {!season || myClubId === undefined ? (
        <div className="card text-sm text-slate-400">
          No season in progress yet — start one from the Season tab to see your ladder position, match recaps, upcoming
          opponents, coach actions, and league stat leaders here.
          {onGoToSeason && (
            <button onClick={onGoToSeason} className="ml-2 font-medium text-accent-light hover:underline">
              Go to Season →
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <div className="text-xs uppercase tracking-wide text-slate-400">Ladder</div>
                {onGoToSeason && (
                  <button onClick={onGoToSeason} className="text-xs font-medium text-accent-light hover:underline">
                    Full season →
                  </button>
                )}
              </div>
              <CompactLadder ladder={season.ladder} previousLadder={prevLadder} myClubId={myClubId} />
            </div>
            <div className="space-y-4">
              <LastGameCard match={lastMatch} performers={ourTopPerformers} myClubId={myClubId} />
              <ActionsCard
                lineupSet={lineupSet}
                contractsOutThisYear={contractsOutThisYear}
                emergingTalent={emergingTalent}
                lastMatchPerformers={ourTopPerformers}
                onGoToSelection={onGoToSelection}
                onGoToContracts={onGoToContracts}
              />
            </div>
          </div>

          <NextOpponentsCard upcoming={upcoming} season={season} teams={teams} />

          {totals && <LeagueLeadersCard totals={totals} myClub={myClub} />}
        </>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="card">
          <div className="text-xs uppercase tracking-wide text-slate-400">List size</div>
          <div className="text-2xl font-semibold tabular-nums">{players.length}</div>
        </div>
        <div className="card">
          <div className="text-xs uppercase tracking-wide text-slate-400">Club avg OVR</div>
          <div className="text-2xl font-semibold tabular-nums">{clubAvgOvr.toFixed(1)}</div>
        </div>
        <div className="card">
          <div className="text-xs uppercase tracking-wide text-slate-400">League avg OVR</div>
          <div className="text-2xl font-semibold tabular-nums">{leagueAverageOvr().toFixed(1)}</div>
        </div>
        <div className="card">
          <div className="text-xs uppercase tracking-wide text-slate-400">Elite (84+)</div>
          <div className="text-2xl font-semibold tabular-nums">{players.filter((p) => p.OVR >= 84).length}</div>
        </div>
      </div>

      <div className="card">
        <div className="mb-3 text-xs uppercase tracking-wide text-slate-400">Line ratings vs league average</div>
        <div className="space-y-3">
          {lines.map((line) => {
            const band = gapBand(line.gapToLeague);
            const pct = Math.min(100, Math.max(0, (line.avgOvr / 99) * 100));
            return (
              <div key={line.line}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span>
                    {line.line} <span className="text-slate-500">({line.players.length})</span>
                  </span>
                  <span className="flex items-center gap-2 tabular-nums">
                    {line.avgOvr.toFixed(1)}
                    <span className={`stat-pill stat-pill-${band.tone}`}>{band.label}</span>
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-base-700">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * A trimmed ladder view for the Dashboard — the 3 rows above and below
 * `myClubId`'s own position (clamped to the table's edges), rather than the
 * full 18-row `LadderTable` SeasonHub already shows in full. Tyler asked for
 * "where we are on the ladder," which is best answered by nearby context
 * (who's just above/below), not a repeat of the whole competition table this
 * page would otherwise duplicate — a "Full season →" link (above, when
 * `onGoToSeason` is supplied) is where the complete ladder lives.
 */
function CompactLadder({ ladder, previousLadder: prev, myClubId }: { ladder: LadderRow[]; previousLadder: LadderRow[]; myClubId: number }) {
  const myIndex = ladder.findIndex((r) => r.clubId === myClubId);
  const start = Math.max(0, Math.min(myIndex - 3, ladder.length - 7));
  const end = Math.min(ladder.length, start + 7);
  // Real bug caught live this round: rank numbers, the finals marker, and the movement arrow all
  // need each row's TRUE league-wide index — passing a pre-sliced array reset that index to 0 at
  // the top of the slice (Melbourne, actually 9th, rendered as "4" with an inflated movement
  // figure). Fixed by handing `LadderTable` the FULL ladder plus which club IDs to actually
  // render (`windowClubIds`), so `i` in its own row map always reflects the true rank — see that
  // component's own doc comment.
  const windowClubIds = new Set(ladder.slice(Math.max(0, start), end).map((r) => r.clubId));
  // `prev` is never windowed either — movement needs each club's full league-wide rank at both
  // points in time, not just its rank within this trimmed view.
  const prevFull = prev.length ? prev : ladder;
  return <LadderTable ladder={ladder} previousLadder={prevFull} highlightClubId={myClubId} windowClubIds={windowClubIds} />;
}

function LastGameCard({ match, performers, myClubId }: { match: PlayedMatch | null; performers: PerformerLine[]; myClubId: number }) {
  if (!match) {
    return (
      <div className="card">
        <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">Last game</div>
        <div className="text-sm text-slate-500">No games played yet this season.</div>
      </div>
    );
  }
  const weAreHome = match.homeClubId === myClubId;
  const opponentId = weAreHome ? match.awayClubId : match.homeClubId;
  const opponent = clubById(opponentId);
  const ourPoints = weAreHome ? match.result.home.points : match.result.away.points;
  const theirPoints = weAreHome ? match.result.away.points : match.result.home.points;
  const outcome = ourPoints > theirPoints ? "Won" : ourPoints < theirPoints ? "Lost" : "Drew";
  const tone = ourPoints > theirPoints ? "text-good" : ourPoints < theirPoints ? "text-bad" : "text-slate-400";

  return (
    <div className="card">
      <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">Last game &middot; Round {match.round}</div>
      <div className="mb-2 flex items-baseline justify-between">
        <div className="text-sm">
          <span className={`font-semibold ${tone}`}>{outcome}</span> {weAreHome ? "vs" : "@"} {opponent?.name ?? `Club ${opponentId}`}
        </div>
        <div className="tabular-nums text-sm text-slate-400">
          {ourPoints} - {theirPoints}
        </div>
      </div>
      {performers.length > 0 && (
        <div className="space-y-1 text-sm">
          <div className="text-xs text-slate-500">Best afield for us</div>
          {performers.map((p, i) => (
            <div key={p.player.PlayerID} className="flex items-center justify-between gap-2">
              <span className="truncate">
                <span className="mr-1.5 text-slate-500 tabular-nums">{i + 1}</span>
                {playerFullName(p.player)}
              </span>
              <span className="tabular-nums text-slate-400">
                {p.rating.toFixed(0)} RTG &middot; {p.fantasyPoints.toFixed(0)} FP
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NextOpponentsCard({
  upcoming,
  season,
  teams,
}: {
  upcoming: FixtureMatch[];
  season: Season;
  teams: Map<number, MatchTeam> | null;
}) {
  const myClub = useGameStore((s) => s.myClub);
  const myClubId = clubByName(myClub)?.ClubID;

  return (
    <div className="card">
      <div className="mb-3 text-xs uppercase tracking-wide text-slate-400">Coming up</div>
      {upcoming.length === 0 ? (
        <div className="text-sm text-slate-500">
          Season's home-and-away fixture is complete — check the Season tab for finals.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {upcoming.map((fx) => {
            const opponentId = fx.homeClubId === myClubId ? fx.awayClubId : fx.homeClubId;
            const opponent = clubById(opponentId);
            const opponentLastMatch = lastPlayedMatchFor(season, opponentId);
            const opponentTop = opponentLastMatch && teams ? topPerformersFor(opponentLastMatch, teams, opponentId, 2) : [];
            return (
              <div key={`${fx.round}-${opponentId}`} className="rounded-lg bg-base-800 p-3">
                <div className="text-xs text-slate-500">
                  Round {fx.round} &middot; {fx.homeClubId === myClubId ? "Home" : "Away"}
                </div>
                <div className="mb-2 flex items-center gap-2 font-medium">
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: opponent?.primaryColor ?? "#666" }}
                  />
                  {opponent?.name ?? `Club ${opponentId}`}
                </div>
                {opponentTop.length > 0 ? (
                  <div className="space-y-0.5 text-xs text-slate-400">
                    <div className="text-slate-500">Their best recent form</div>
                    {opponentTop.map((p) => (
                      <div key={p.player.PlayerID} className="truncate">
                        {playerFullName(p.player)} &middot; {p.rating.toFixed(0)} RTG
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-slate-500">No games played yet this season.</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ActionsCard({
  lineupSet,
  contractsOutThisYear,
  emergingTalent,
  lastMatchPerformers,
  onGoToSelection,
  onGoToContracts,
}: {
  lineupSet: boolean;
  contractsOutThisYear: number;
  emergingTalent: Player[];
  lastMatchPerformers: PerformerLine[];
  onGoToSelection?: () => void;
  onGoToContracts?: () => void;
}) {
  return (
    <div className="card">
      <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Coach actions</div>

      {lastMatchPerformers.length > 0 && (
        <div className="mb-3 rounded-lg bg-base-800 p-2.5 text-sm">
          <span className="font-medium text-accent-light">Worth acknowledging: </span>
          {lastMatchPerformers.map((p) => playerFullName(p.player)).join(", ")} had great games last round.
        </div>
      )}

      <div className="space-y-2">
        {!lineupSet && (
          <ActionRow label="Team not finalised for next round" onClick={onGoToSelection} cta="Set lineup" />
        )}
        {contractsOutThisYear > 0 && (
          <ActionRow
            label={`${contractsOutThisYear} player${contractsOutThisYear === 1 ? "" : "s"} out of contract this year`}
            onClick={onGoToContracts}
            cta="Review contracts"
          />
        )}
        {emergingTalent.length > 0 && (
          <div className="rounded-lg bg-base-800 p-2.5 text-sm">
            <span className="font-medium">Emerging talent to watch: </span>
            {emergingTalent.map((p) => `${playerFullName(p)} (${p.Age}, ${p.POT} POT)`).join(", ")}
          </div>
        )}
        {lineupSet && contractsOutThisYear === 0 && emergingTalent.length === 0 && (
          <div className="text-sm text-slate-500">Nothing urgent on your list right now.</div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-base-700 pt-3">
        <span className="text-xs text-slate-500">Coming soon:</span>
        {["Injury management", "Media commitments", "Player happiness alerts"].map((label) => (
          <span key={label} className="rounded-full bg-base-800 px-2 py-0.5 text-xs text-slate-500">
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function ActionRow({ label, onClick, cta }: { label: string; onClick?: () => void; cta: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-base-800 p-2.5 text-sm">
      <span>{label}</span>
      {onClick && (
        <button onClick={onClick} className="shrink-0 font-medium text-accent-light hover:underline">
          {cta} →
        </button>
      )}
    </div>
  );
}

const LEAGUE_STATS: { key: LeagueStat; label: string }[] = [
  { key: "disposals", label: "Disposals" },
  { key: "goals", label: "Goals" },
  { key: "tackles", label: "Tackles" },
  { key: "fantasyPoints", label: "Fantasy Points" },
];

function LeagueLeadersCard({ totals, myClub }: { totals: Map<number, SeasonPlayerTotals>; myClub: string }) {
  return (
    <div className="card">
      <div className="mb-3 text-xs uppercase tracking-wide text-slate-400">Competition leaders this season</div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {LEAGUE_STATS.map(({ key, label }) => {
          const top = leagueLeaders(totals, key, 5);
          const weAreInTop5 = top.some((r) => r.player.Team === myClub);
          const ourBest = weAreInTop5 ? null : ourLeagueBest(totals, key, myClub);
          return (
            <div key={key}>
              <div className="mb-1.5 text-xs font-medium text-slate-400">{label}</div>
              <div className="space-y-0.5 text-sm">
                {top.length === 0 ? (
                  <div className="text-slate-500">No games played yet.</div>
                ) : (
                  top.map((r, i) => (
                    <div
                      key={r.player.PlayerID}
                      className={`flex items-center justify-between gap-2 ${r.player.Team === myClub ? "font-semibold text-accent-light" : "text-slate-300"}`}
                    >
                      <span className="truncate">
                        <span className="mr-1 text-slate-500 tabular-nums">{i + 1}</span>
                        {playerFullName(r.player)}
                      </span>
                      <span className="tabular-nums">{Math.round(r.value)}</span>
                    </div>
                  ))
                )}
              </div>
              {ourBest && (
                <div className="mt-1.5 text-xs text-slate-500">
                  Our best: {playerFullName(ourBest.player)}, {Math.round(ourBest.value)} ({ourBest.rank}
                  {ordinalSuffix(ourBest.rank)})
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ordinalSuffix(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}
