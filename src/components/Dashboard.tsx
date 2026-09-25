import { useMemo, useState } from "react";
import type { Player } from "../types/player";
import { playerFullName } from "../types/player";
import { clubByName, clubById } from "../types/club";
import { useGameStore } from "../store/useGameStore";
import { DayOne, type DayOneTarget } from "./onboarding/DayOne";
import { useSeasonStore } from "../store/useSeasonStore";
import { useSaveStore } from "../store/useSaveStore";
import { useSelectionStore } from "../store/useSelectionStore";
import { getPlayersByClub, leagueAverageOvr, averageOvr } from "../data/loadPlayers";
import { summariseLines } from "../data/lines";
import { gapBand } from "./StatusPill";
import { LadderTable } from "./LadderTable";
import { ClubBadge } from "./ClubBadge";
import { PlayerLink } from "./PlayerLink";
import { Modal, ExpandHint } from "./Modal";
import { RoundFixture } from "./SeasonHub";
import { FullTimeResult } from "./FullTimeResult";
import { ClubScoutingModal } from "./ClubScouting";
import { isLineupComplete, lineupPlayerIds } from "../engine/selection";
import { freeAgentsFor } from "../engine/contracts";
import { Card, HeroCard, Watermark, KpiTile, StatusChip, PinStar, DivergingBar, TrendValue, Segmented } from "./theme/primitives";
import { recordWatchFeedFor, developmentBoardFor, type RecordWatchEntry, type DevelopmentEntry } from "../engine/dashboardInsights";
import { useMatchStoryStore, type MatchStory, type MatchStoryTag } from "../store/useMatchStoryStore";
import { usePlayerProfileStore } from "../store/usePlayerProfileStore";
import {
  lastPlayedMatchFor,
  upcomingFixtureFor,
  topPerformersFor,
  previousLadder,
  seasonPlayerTotals,
  seasonPlayerLast5Totals,
  toAverageMap,
  allTimePlayerTotals,
  leagueLeaders,
  ourLeagueBest,
  ALL_LEAGUE_STATS,
  type PerformerLine,
  type LeagueStat,
  type SeasonPlayerTotals,
  type SeasonArchiveEntry,
} from "../engine/seasonSummary";
import type { PlayedMatch, Season } from "../engine/season";
import type { FixtureMatch } from "../engine/fixture";
import { recentForm, type LadderRow, type RoundResult } from "../engine/ladder";
import type { MatchTeam } from "../engine/team";

/**
 * The coach's landing page. Round 115 rebuilds this onto the Club Theme System (see [[Club Theme
 * System]]) to match the brief's own reference mockup (`Club Theme System.dc.html`, `isDash` block):
 * a club hero strip, a "biggest story" hero card + Next Up card, a Watchlist (pin) section, a Record
 * Watch feed and Development board, then Coming Up + Line Ratings. Two of those — Record Watch and
 * Development — are genuinely new mechanics with no prior code to reuse; see `engine/dashboardInsights.ts`'s
 * own doc comment for exactly what's real data vs. a disclosed first-pass heuristic. The Watchlist pin
 * itself persists via `useSaveStore`'s new `watchlist`/`togglePin` (round 115).
 *
 * Everything Tyler originally asked for in round 50 (ladder position, last-game recap, coach actions,
 * competition leaders) is deliberately preserved, not dropped, just re-themed with the round-114
 * primitives and folded in alongside the brief's new sections — the brief's reference mockup doesn't
 * show these because it's a template, not a literal spec of what to remove.
 *
 * Every new section degrades gracefully to a friendly notice, never a crash or a fake number, when
 * `season` is `null` (no season started yet this save) — same "optional and additive, graceful
 * fallback" convention this project has used since round 8.
 */

type ActiveModal =
  | { type: "ladder" }
  | { type: "lastGame" }
  | { type: "leader"; stat: LeagueStat; label: string }
  | { type: "scouting"; clubId: number }
  | null;

interface DashboardProps {
  onGoToSelection?: () => void;
  onGoToContracts?: () => void;
  onGoToSeason?: () => void;
  /** New Game Onboarding — the Day one dashboard's links (shown until Round 1 is played). */
  onDayOne?: (target: DayOneTarget) => void;
}

export function Dashboard({ onGoToSelection, onGoToContracts, onGoToSeason, onDayOne }: DashboardProps) {
  const myClub = useGameStore((s) => s.myClub);
  const club = clubByName(myClub);
  const myClubId = club?.ClubID;
  const season = useSeasonStore((s) => s.season);
  const teams = useSeasonStore((s) => s.teams);
  const year = useSaveStore((s) => s.year);
  const seasonArchives = useSaveStore((s) => s.seasonArchives);
  const watchlist = useSaveStore((s) => s.watchlist);
  const togglePin = useSaveStore((s) => s.togglePin);
  const myLineup = useSelectionStore((s) => s.lineupFor(myClub));
  const [fixtureRound, setFixtureRound] = useState(1);
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [devSort, setDevSort] = useState<"movers" | "ceiling" | "youngest">("movers");

  const players = useMemo(() => getPlayersByClub(myClub), [myClub]);
  const lines = useMemo(() => summariseLines(players, leagueAverageOvr()), [players]);
  const clubAvgOvr = useMemo(() => averageOvr(players), [players]);
  const eliteCount = players.filter((p) => p.OVR >= 84).length;

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

  const formMap = useMemo(() => {
    if (!season) return new Map<number, ("W" | "L" | "D")[]>();
    const results: RoundResult[] = season.played.map((p) => ({
      round: p.round,
      homeClubId: p.homeClubId,
      awayClubId: p.awayClubId,
      homePoints: p.result.home.points,
      awayPoints: p.result.away.points,
    }));
    return new Map(season.ladder.map((r) => [r.clubId, recentForm(r.clubId, results)]));
  }, [season]);

  const totals = useMemo(() => (season ? seasonPlayerTotals(season) : null), [season]);

  const contractsOutThisYear = useMemo(() => freeAgentsFor(players, myClub, year).length, [players, myClub, year]);
  const lineupSet = myLineup ? isLineupComplete(myLineup) : false;

  const emergingTalent = useMemo(() => {
    const rostered = new Set(myLineup ? lineupPlayerIds(myLineup) : []);
    return players
      .filter((p) => p.Age <= 21 && !rostered.has(p.PlayerID))
      .sort((a, b) => b.POT - a.POT)
      .slice(0, 3);
  }, [players, myLineup]);

  // Match Day v2 (critique D6): the last Match Day game's "From this game" items, sent here on Continue.
  const lastGameStories = useMatchStoryStore((s) => s.latest);
  // Round 115 — Record Watch + Development board, see engine/dashboardInsights.ts.
  const recordWatch = useMemo(() => recordWatchFeedFor(myClub, seasonArchives, season, year), [myClub, seasonArchives, season, year]);
  const developmentBoard = useMemo(() => developmentBoardFor(players, myClub, season, devSort), [players, myClub, season, devSort]);

  // Round 115 — "biggest story on your list": the single most compelling, real, already-computed
  // headline available this round, in priority order (best last-game performance this round, else
  // the top Record Watch entry, else the top BREAKOUT development entry). A genuine editorial ranking
  // across story TYPES is a bigger, separate piece of work — this is a disclosed, simple first pass,
  // same "calibrated not specified" convention as the rest of this round's new mechanics.
  const heroStory = useMemo(() => {
    if (ourTopPerformers.length > 0 && lastMatch) {
      const best = ourTopPerformers[0];
      return {
        tag: "TOP PERFORMER",
        heading: `${playerFullName(best.player)} was best afield last round`,
        sub: `${best.rating.toFixed(0)} rating, ${best.fantasyPoints.toFixed(0)} fantasy points in Round ${lastMatch.round}.`,
        chips: [
          { k: "RATING", v: best.rating.toFixed(0) },
          { k: "FANTASY PTS", v: best.fantasyPoints.toFixed(0) },
          { k: "ROUND", v: String(lastMatch.round) },
          { k: "OVR", v: String(best.player.OVR) },
        ],
        big: String(best.player.OVR),
        player: best.player,
      };
    }
    if (recordWatch.length > 0) {
      const top = recordWatch[0];
      return {
        tag: "RECORD WATCH",
        heading: `${playerFullName(top.player)} is closing in on the ${top.categoryLabel} all-time list`,
        sub: top.text,
        chips: [
          { k: "RANK", v: `${top.row.rank}` },
          { k: "VALUE", v: `${Math.round(top.row.value)}` },
          { k: "OVR", v: String(top.player.OVR) },
          { k: "AGE", v: String(top.player.Age) },
        ],
        big: `${top.row.rank}`,
        player: top.player,
      };
    }
    const breakout = developmentBoard.find((d) => d.status === "BREAKOUT");
    if (breakout) {
      return {
        tag: "BREAKOUT",
        heading: `${playerFullName(breakout.player)} is trending well above their own season average`,
        sub: breakout.action,
        chips: [
          { k: "OVR", v: String(breakout.player.OVR) },
          { k: "CEILING", v: String(breakout.player.POT) },
          { k: "AGE", v: String(breakout.player.Age) },
          { k: "VS AVG", v: breakout.vsProjection.toFixed(1) },
        ],
        big: String(breakout.player.POT),
        player: breakout.player,
      };
    }
    return null;
  }, [ourTopPerformers, lastMatch, recordWatch, developmentBoard]);

  const closeModal = () => setActiveModal(null);

  // New Game Onboarding: until Round 1 is played, the Dashboard is the Day one screen (it replaces the
  // old "No season in progress" empty state).
  if (myClubId !== undefined && (!season || season.played.length === 0)) {
    return <DayOne myClub={myClub} onGo={(t) => onDayOne?.(t)} />;
  }

  return (
    <div className="space-y-4">
      <Card padding="18px 22px" style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
        <div style={{ width: 64, height: 64, flex: "none", borderRadius: 13, background: "var(--deep)", border: "1px solid color-mix(in oklch, var(--acc) 55%, transparent)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {/* Round 126 — fix pass 1, item 4: the tile IS the badge (one fill + one hairline border); no nested chip. */}
          <span style={{ font: "700 20px 'Barlow Condensed',sans-serif", color: "var(--accT)", letterSpacing: ".3px" }}>{club?.abbreviation}</span>
        </div>
        <div style={{ flex: "1 1 280px", minWidth: 0 }}>
          <div style={{ font: "500 11px 'IBM Plex Mono',monospace", letterSpacing: "1.5px", color: "#9aa4b5" }}>
            YOUR CLUB · {year} {season ? `· AFTER ROUND ${season.played.length}` : "· NO SEASON IN PROGRESS"}
          </div>
          <h1 style={{ margin: "4px 0 2px", font: "700 34px/1 'Barlow Condensed',sans-serif", color: "#fff" }}>
            {club?.name} <span style={{ color: "var(--accT)" }}>{club?.nickname}</span>
          </h1>
        </div>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <KpiTile value={clubAvgOvr.toFixed(1)} label="List avg OVR" />
          <KpiTile value={eliteCount} label="Elite 84+" tone="accent" />
          <KpiTile value={players.length} label="List size" />
        </div>
      </Card>

      {!season || myClubId === undefined ? (
        <Card>
          <div className="text-sm text-slate-400">
            No season in progress yet — start one to see your ladder position, match recaps, record watch,
            development board, upcoming opponents, and league stat leaders here.
            {onGoToSeason && (
              <button onClick={onGoToSeason} className="ml-2 font-medium text-accent-light hover:underline" style={{ color: "var(--accT)" }}>
                Go to Season →
              </button>
            )}
          </div>
        </Card>
      ) : null}
      {(!season || myClubId === undefined) && lastGameStories && (
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
            <div style={{ font: "500 11px 'IBM Plex Mono',monospace", letterSpacing: "1.5px", color: "#9aa4b5" }}>RECORD WATCH · FROM YOUR LAST GAME</div>
            <div style={{ font: "500 10px 'IBM Plex Mono',monospace", letterSpacing: "1px", color: "#8f9ab0" }}>{lastGameStories.matchLabel.toUpperCase()}</div>
          </div>
          {lastGameStories.stories.map((st, i) => (
            <MatchStoryRow key={i} story={st} />
          ))}
        </Card>
      )}
      {!season || myClubId === undefined ? null : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <button
                onClick={() => setActiveModal({ type: "ladder" })}
                className="mb-1.5 flex w-full items-center justify-between text-left"
              >
                <div style={{ font: "500 11px 'IBM Plex Mono',monospace", letterSpacing: "1.5px", color: "#9aa4b5", textTransform: "uppercase" }}>Ladder</div>
                <ExpandHint label="Full ladder + fixtures" />
              </button>
              <CompactLadder ladder={season.ladder} previousLadder={prevLadder} myClubId={myClubId} recentForm={formMap} />
            </div>
            <div className="space-y-4">
              <LastGameCard
                match={lastMatch}
                performers={ourTopPerformers}
                myClubId={myClubId}
                onExpand={() => setActiveModal({ type: "lastGame" })}
              />
              <ActionsCard
                lineupSet={lineupSet}
                contractsOutThisYear={contractsOutThisYear}
                emergingTalent={emergingTalent}
                lastMatch={lastMatch}
                myClubId={myClubId}
                onGoToSelection={onGoToSelection}
                onGoToContracts={onGoToContracts}
                onOpenLastGame={() => setActiveModal({ type: "lastGame" })}
              />
            </div>
          </div>

          {heroStory && (
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "stretch" }}>
              <HeroCard style={{ flex: "2 1 540px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
                <Watermark>{heroStory.big}</Watermark>
                <div style={{ position: "relative", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ font: "600 10px 'IBM Plex Mono',monospace", letterSpacing: "1.5px", color: "var(--on)", background: "var(--acc)", padding: "3px 7px", borderRadius: 4 }}>
                    {heroStory.tag}
                  </span>
                  <span style={{ font: "500 11px 'IBM Plex Mono',monospace", letterSpacing: "1.5px", color: "#b3bccb" }}>
                    ROUND {season.played.length} · BIGGEST STORY ON YOUR LIST
                  </span>
                </div>
                <div style={{ position: "relative" }}>
                  <h2 style={{ margin: 0, font: "700 34px/1.1 'Barlow Condensed',sans-serif", color: "#fff" }}>{heroStory.heading}</h2>
                  <div style={{ font: "500 15px/1.45 Barlow,sans-serif", color: "#dfe5ee", marginTop: 8, maxWidth: 580 }}>{heroStory.sub}</div>
                </div>
                <div style={{ position: "relative", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))", gap: 8 }}>
                  {heroStory.chips.map((c) => (
                    <div key={c.k} style={{ background: "rgba(0,0,0,.28)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 10, padding: "10px 12px" }}>
                      <div style={{ font: "700 26px/1 'Barlow Condensed',sans-serif", color: "#fff" }}>{c.v}</div>
                      <div style={{ font: "500 9px 'IBM Plex Mono',monospace", letterSpacing: "1px", color: "#aab3c3", marginTop: 4 }}>{c.k}</div>
                    </div>
                  ))}
                </div>
                <div style={{ position: "relative", display: "flex", gap: 10, flexWrap: "wrap", marginTop: "auto" }}>
                  <PlayerLink player={heroStory.player} as="span">
                    <span style={{ background: "var(--acc)", color: "var(--on)", borderRadius: 9, padding: "11px 18px", font: "700 14px Barlow,sans-serif", cursor: "pointer", display: "inline-block" }}>
                      Open career
                    </span>
                  </PlayerLink>
                  <button
                    type="button"
                    onClick={() => togglePin(heroStory.player.PlayerID)}
                    style={{ background: "transparent", color: watchlist.includes(heroStory.player.PlayerID) ? "var(--accT)" : "#dfe5ee", border: "1px solid rgba(255,255,255,.18)", borderRadius: 9, padding: "11px 16px", font: "600 14px Barlow,sans-serif", cursor: "pointer" }}
                  >
                    {watchlist.includes(heroStory.player.PlayerID) ? "★ On your watchlist" : "☆ Pin to watchlist"}
                  </button>
                </div>
              </HeroCard>

              <NextUpCard club={club} upcoming={upcoming} onGoToSeason={onGoToSeason} />
            </div>
          )}

          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
              <div style={{ font: "500 11px 'IBM Plex Mono',monospace", letterSpacing: "1.5px", color: "#9aa4b5" }}>WATCHLIST · {watchlist.length}/5</div>
              <div style={{ font: "400 13px Barlow,sans-serif", color: "#9aa4b5" }}>Pinned players get priority in Record Watch.</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,210px),1fr))", gap: 10 }}>
              {watchlist.map((playerId) => {
                const p = players.find((pl) => pl.PlayerID === playerId) ?? getPlayersByClub(myClub).find((pl) => pl.PlayerID === playerId);
                if (!p) return null;
                return (
                  <div key={playerId} style={{ background: "rgba(0,0,0,.2)", border: "1px solid color-mix(in oklch, var(--acc) 28%, transparent)", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <PlayerLink player={p}>
                          <span style={{ font: "700 16px/1.1 'Barlow Condensed',sans-serif", color: "#fff" }}>{playerFullName(p)}</span>
                        </PlayerLink>
                        <div style={{ font: "500 11px Barlow,sans-serif", color: "#9aa4b5" }}>{p.archetype} · {p.Age}</div>
                      </div>
                      <PinStar pinned onToggle={() => togglePin(playerId)} title="Unpin" />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <div style={{ font: "700 24px/1 'Barlow Condensed',sans-serif", color: "#fff" }}>
                        {p.OVR} <span style={{ color: "#7e889a", fontSize: 16 }}>→</span> <span style={{ color: "var(--accT)" }}>{p.POT}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
              {Array.from({ length: Math.max(0, 3 - watchlist.length) }, (_, i) => (
                <div key={`empty-${i}`} style={{ border: "1px dashed rgba(255,255,255,.14)", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", justifyContent: "center", gap: 4, minHeight: 110 }}>
                  <div style={{ font: "600 14px Barlow,sans-serif", color: "#aab3c3" }}>Empty slot</div>
                  <div style={{ font: "400 12px/1.4 Barlow,sans-serif", color: "#8f9ab0" }}>Pin a player from anywhere their name appears.</div>
                </div>
              ))}
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
                <div style={{ font: "500 11px 'IBM Plex Mono',monospace", letterSpacing: "1.5px", color: "#9aa4b5" }}>RECORD WATCH · WHOLE LIST</div>
                <div style={{ font: "500 10px 'IBM Plex Mono',monospace", letterSpacing: "1px", color: "#8f9ab0" }}>RANKED BY SIGNIFICANCE</div>
              </div>
              {lastGameStories?.stories.map((st, i) => (
                <MatchStoryRow key={`story-${i}`} story={st} caption={lastGameStories.matchLabel} />
              ))}
              {recordWatch.length === 0 ? (
                !lastGameStories && <div className="text-sm text-slate-500">No one on your list is close to an all-time top-25 yet.</div>
              ) : (
                recordWatch.map((entry) => <RecordWatchRow key={`${entry.player.PlayerID}-${entry.category}`} entry={entry} />)
              )}
            </Card>

            <Card padding="18px 16px 12px">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "0 4px 10px" }}>
                <div style={{ font: "500 11px 'IBM Plex Mono',monospace", letterSpacing: "1.5px", color: "#9aa4b5" }}>DEVELOPMENT · {developmentBoard.length} PLAYERS 23 & UNDER</div>
                <Segmented
                  options={[
                    { value: "movers", label: "Movers" },
                    { value: "ceiling", label: "Ceiling" },
                    { value: "youngest", label: "Youngest" },
                  ]}
                  value={devSort}
                  onChange={setDevSort}
                />
              </div>
              {developmentBoard.length === 0 ? (
                <div className="px-1 text-sm text-slate-500">No players 23-or-under (or drafted since 2024) on your list.</div>
              ) : (
                developmentBoard.map((entry) => <DevelopmentRow key={entry.player.PlayerID} entry={entry} pinned={watchlist.includes(entry.player.PlayerID)} onTogglePin={() => togglePin(entry.player.PlayerID)} />)
              )}
            </Card>
          </div>

          <NextOpponentsCard
            upcoming={upcoming}
            season={season}
            teams={teams}
            onScoutClub={(clubId) => setActiveModal({ type: "scouting", clubId })}
          />

          {totals && (
            <LeagueLeadersCard
              totals={totals}
              myClub={myClub}
              onExpandStat={(stat, label) => setActiveModal({ type: "leader", stat, label })}
            />
          )}
        </>
      )}

      <Card>
        <div style={{ marginBottom: 12, font: "500 11px 'IBM Plex Mono',monospace", letterSpacing: "1.5px", color: "#9aa4b5" }}>LINE RATINGS VS LEAGUE</div>
        <div className="space-y-3">
          {lines.map((line) => {
            const band = gapBand(line.gapToLeague);
            const pct = Math.min(100, Math.max(0, (line.avgOvr / 99) * 100));
            return (
              <div key={line.line}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span style={{ font: "600 14px Barlow,sans-serif", color: "#eef2f8" }}>
                    {line.line} <span style={{ color: "#8f9ab0", fontWeight: 400 }}>({line.players.length})</span>
                  </span>
                  <span className="flex items-center gap-2 tabular-nums" style={{ font: "600 13px 'IBM Plex Mono',monospace", color: "#fff" }}>
                    {line.avgOvr.toFixed(1)}
                    <span className={`stat-pill stat-pill-${band.tone}`}>{band.label}</span>
                  </span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,.07)", overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 3, background: "var(--acc)", width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {activeModal?.type === "ladder" && season && myClubId !== undefined && (
        <Modal title="Full season" onClose={closeModal}>
          <div className="space-y-4">
            <LadderTable
              ladder={season.ladder}
              previousLadder={prevLadder.length ? prevLadder : season.ladder}
              highlightClubId={myClubId}
              recentForm={formMap}
            />
            <RoundFixture
              round={fixtureRound}
              setRound={setFixtureRound}
              fixture={season.fixture}
              played={season.played}
              myClubId={myClubId}
              onSelect={() => onGoToSeason?.()}
            />
            {onGoToSeason && (
              <button onClick={onGoToSeason} className="text-xs font-medium text-accent-light hover:underline">
                Open full Season page ↗
              </button>
            )}
          </div>
        </Modal>
      )}

      {activeModal?.type === "lastGame" && lastMatch && teams && myClubId !== undefined && (
        <LastGameModal match={lastMatch} teams={teams} onClose={closeModal} />
      )}

      {activeModal?.type === "leader" && (
        <LeaderModal
          stat={activeModal.stat}
          label={activeModal.label}
          season={season}
          seasonArchives={seasonArchives}
          myClub={myClub}
          onClose={closeModal}
        />
      )}

      {activeModal?.type === "scouting" && (
        <ClubScoutingModal clubId={activeModal.clubId} season={season} onClose={closeModal} />
      )}
    </div>
  );
}

function NextUpCard({ club, upcoming, onGoToSeason }: { club: ReturnType<typeof clubByName>; upcoming: FixtureMatch[]; onGoToSeason?: () => void }) {
  const myClubId = club?.ClubID;
  const next = upcoming[0];
  const opponentId = next ? (next.homeClubId === myClubId ? next.awayClubId : next.homeClubId) : undefined;
  const opponent = opponentId !== undefined ? clubById(opponentId) : undefined;
  return (
    <Card style={{ flex: "1 1 300px", minWidth: 0, display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ font: "500 11px 'IBM Plex Mono',monospace", letterSpacing: "1.5px", color: "#9aa4b5" }}>
        {next ? `NEXT UP · ROUND ${next.round}` : "NEXT UP"}
      </div>
      {next ? (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, flex: 1 }}>
              <ClubBadge club={club} size="lg" />
              <div style={{ font: "700 15px Barlow,sans-serif", color: "#fff", textAlign: "center" }}>{club?.name}</div>
            </div>
            <div style={{ font: "600 13px 'IBM Plex Mono',monospace", color: "#7e889a" }}>VS</div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, minWidth: 110 }}>
              <ClubBadge club={opponent} size="lg" />
              <div style={{ font: "700 15px Barlow,sans-serif", color: "#fff", textAlign: "center" }}>{opponent?.name}</div>
            </div>
          </div>
          <div style={{ font: "400 13px Barlow,sans-serif", color: "#aab3c3", textAlign: "center" }}>
            {next.homeClubId === myClubId ? "Home" : "Away"}
          </div>
        </>
      ) : (
        <div className="text-sm text-slate-500">Season's home-and-away fixture is complete — check the Season tab for finals.</div>
      )}
      {onGoToSeason && (
        <button
          type="button"
          onClick={onGoToSeason}
          style={{ marginTop: "auto", background: "var(--acc)", color: "var(--on)", border: 0, borderRadius: 9, padding: "12px 18px", font: "700 15px Barlow,sans-serif", cursor: "pointer" }}
        >
          Go to Season
        </button>
      )}
    </Card>
  );
}

const STORY_TAG_COLOR: Record<MatchStoryTag, string> = {
  MILESTONE: "var(--accT)",
  "CAREER BEST": "var(--accT)",
  DEVELOPMENT: "#4fd69a",
  WATCHLIST: "#b3bccb",
  INJURY: "#f0c04a",
};

/** A "From this game" item from the last Match Day game — same row shape as `RecordWatchRow`; opens the player's career profile. */
function MatchStoryRow({ story, caption }: { story: MatchStory; caption?: string }) {
  return (
    <button
      onClick={() => usePlayerProfileStore.getState().openPlayer(story.playerId)}
      style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "11px 0", borderTop: "1px solid rgba(255,255,255,.06)", width: "100%", background: "none", borderLeft: 0, borderRight: 0, borderBottom: 0, cursor: "pointer", textAlign: "left" }}
    >
      <span style={{ flex: "none", minWidth: 92, font: "600 10px 'IBM Plex Mono',monospace", letterSpacing: "1px", color: STORY_TAG_COLOR[story.tag], paddingTop: 3 }}>{story.tag}</span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: "block", font: "600 14px/1.35 Barlow,sans-serif", color: "#eef2f8" }}>{story.text}</span>
        <span style={{ display: "block", font: "400 13px/1.4 Barlow,sans-serif", color: "#9aa4b5", marginTop: 2 }}>
          {story.sub}
          {caption ? ` · ${caption}` : ""}
        </span>
      </span>
    </button>
  );
}

function RecordWatchRow({ entry }: { entry: RecordWatchEntry }) {
  const tone = entry.row.rank === 1 ? "accent" : "neutral";
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "11px 0", borderTop: "1px solid rgba(255,255,255,.06)" }}>
      <StatusChip tone={tone}>#{entry.row.rank}</StatusChip>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ font: "600 14px/1.35 Barlow,sans-serif", color: "#eef2f8" }}>
          <PlayerLink player={entry.player} as="span">
            {playerFullName(entry.player)}
          </PlayerLink>{" "}
          — {entry.categoryLabel}
        </div>
        <div style={{ font: "400 13px/1.4 Barlow,sans-serif", color: "#9aa4b5", marginTop: 2 }}>{entry.text}</div>
      </div>
    </div>
  );
}

const STATUS_TONE: Record<DevelopmentEntry["status"], "good" | "warn" | "bad" | "neutral"> = {
  BREAKOUT: "good",
  "NEEDS GAMES": "warn",
  STALLING: "bad",
  "ON TRACK": "neutral",
};

function DevelopmentRow({ entry, pinned, onTogglePin }: { entry: DevelopmentEntry; pinned: boolean; onTogglePin: () => void }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 34px 110px 50px 92px 24px", gap: 10, alignItems: "center", padding: "9px 4px", borderBottom: "1px solid rgba(255,255,255,.05)" }}>
      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={{ display: "flex", gap: 6, alignItems: "baseline", minWidth: 0 }}>
          <PlayerLink player={entry.player} as="span">
            <span style={{ font: "600 14px Barlow,sans-serif", color: "#eef2f8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{playerFullName(entry.player)}</span>
          </PlayerLink>
          <span style={{ font: "500 10px 'IBM Plex Mono',monospace", color: "#8f9ab0", whiteSpace: "nowrap" }}>{entry.player.Age}</span>
        </span>
        <span style={{ font: "500 12px Barlow,sans-serif", color: "#aab3c3", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{entry.action}</span>
      </span>
      <span style={{ textAlign: "right", font: "600 14px 'IBM Plex Mono',monospace", color: "#fff" }}>{entry.player.OVR}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <DivergingBar value={entry.vsProjection} max={8} />
        <TrendValue value={entry.vsProjection} decimals={0} />
      </span>
      <span style={{ textAlign: "right", font: "600 14px 'IBM Plex Mono',monospace", color: "var(--accT)", whiteSpace: "nowrap" }}>{entry.player.POT}</span>
      <span><StatusChip tone={STATUS_TONE[entry.status]}>{entry.status}</StatusChip></span>
      <span><PinStar pinned={pinned} onToggle={onTogglePin} /></span>
    </div>
  );
}

/**
 * A trimmed ladder view for the Dashboard — the 3 rows above and below `myClubId`'s own position
 * (clamped to the table's edges), rather than the full 18-row `LadderTable` SeasonHub already shows
 * in full. See this file's own round-53/89 history for why this stays a compact preview.
 */
function CompactLadder({
  ladder,
  previousLadder: prev,
  myClubId,
  recentForm,
}: {
  ladder: LadderRow[];
  previousLadder: LadderRow[];
  myClubId: number;
  recentForm?: Map<number, ("W" | "L" | "D")[]>;
}) {
  const myIndex = ladder.findIndex((r) => r.clubId === myClubId);
  const start = Math.max(0, Math.min(myIndex - 3, ladder.length - 7));
  const end = Math.min(ladder.length, start + 7);
  const windowClubIds = new Set(ladder.slice(Math.max(0, start), end).map((r) => r.clubId));
  const prevFull = prev.length ? prev : ladder;
  return (
    <LadderTable
      ladder={ladder}
      previousLadder={prevFull}
      highlightClubId={myClubId}
      windowClubIds={windowClubIds}
      compact
      recentForm={recentForm}
    />
  );
}

function LastGameCard({
  match,
  performers,
  myClubId,
  onExpand,
}: {
  match: PlayedMatch | null;
  performers: PerformerLine[];
  myClubId: number;
  onExpand: () => void;
}) {
  if (!match) {
    return (
      <Card>
        <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">Last game</div>
        <div className="text-sm text-slate-500">No games played yet this season.</div>
      </Card>
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
    <Card>
      <button onClick={onExpand} className="mb-1 flex w-full items-center justify-between text-left">
        <div className="text-xs uppercase tracking-wide text-slate-400">Last game · Round {match.round}</div>
        <ExpandHint label="Full stats" />
      </button>
      <div className="mb-2 flex items-baseline justify-between">
        <div className="flex items-center gap-1.5 text-sm">
          <span className={`font-semibold ${tone}`}>{outcome}</span> {weAreHome ? "vs" : "@"}
          <ClubBadge club={opponent} size="sm" />
          {opponent?.name ?? `Club ${opponentId}`}
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
                <PlayerLink player={p.player} />
              </span>
              <span className="tabular-nums text-slate-400">
                {p.rating.toFixed(0)} RTG · {p.fantasyPoints.toFixed(0)} FP
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function LastGameModal({ match, teams, onClose }: { match: PlayedMatch; teams: Map<number, MatchTeam>; onClose: () => void }) {
  const home = teams.get(match.homeClubId);
  const away = teams.get(match.awayClubId);
  const myClub = useGameStore((s) => s.myClub);
  const submitCoachesVotes = useSeasonStore((s) => s.submitCoachesVotes);
  if (!home || !away) return null;
  return (
    <Modal title={`Round ${match.round} — ${home.name} vs ${away.name}`} onClose={onClose}>
      <FullTimeResult
        result={match.result}
        homeTeam={home}
        awayTeam={away}
        onNewMatch={onClose}
        closeLabel="Close"
        coachesVotes={match.coachesVotes}
        myClub={myClub}
        onSubmitBallot={(side, allocations) =>
          submitCoachesVotes({ kind: "round", round: match.round, homeClubId: match.homeClubId, awayClubId: match.awayClubId }, side, allocations)
        }
      />
    </Modal>
  );
}

function NextOpponentsCard({
  upcoming,
  season,
  teams,
  onScoutClub,
}: {
  upcoming: FixtureMatch[];
  season: Season;
  teams: Map<number, MatchTeam> | null;
  onScoutClub: (clubId: number) => void;
}) {
  const myClub = useGameStore((s) => s.myClub);
  const myClubId = clubByName(myClub)?.ClubID;

  return (
    <Card>
      <div style={{ marginBottom: 12, font: "500 11px 'IBM Plex Mono',monospace", letterSpacing: "1.5px", color: "#9aa4b5" }}>COMING UP</div>
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
              <button
                key={`${fx.round}-${opponentId}`}
                onClick={() => onScoutClub(opponentId)}
                className="rounded-lg p-3 text-left"
                style={{ background: "rgba(0,0,0,.2)", border: "1px solid rgba(255,255,255,.06)" }}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-xs text-slate-500">
                    Round {fx.round} · {fx.homeClubId === myClubId ? "Home" : "Away"}
                  </div>
                  <ExpandHint label="Scout" />
                </div>
                <div className="mb-2 flex items-center gap-2 font-medium">
                  <ClubBadge club={opponent} size="sm" />
                  {opponent?.name ?? `Club ${opponentId}`}
                </div>
                {opponentTop.length > 0 ? (
                  <div className="space-y-0.5 text-xs text-slate-400">
                    <div className="text-slate-500">Their best recent form</div>
                    {opponentTop.map((p) => (
                      <div key={p.player.PlayerID} className="truncate">
                        <PlayerLink player={p.player} as="span">
                          {playerFullName(p.player)}
                        </PlayerLink>{" "}
                        · {p.rating.toFixed(0)} RTG
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-slate-500">No games played yet this season.</div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function ActionsCard({
  lineupSet,
  contractsOutThisYear,
  emergingTalent,
  lastMatch,
  myClubId,
  onGoToSelection,
  onGoToContracts,
  onOpenLastGame,
}: {
  lineupSet: boolean;
  contractsOutThisYear: number;
  emergingTalent: Player[];
  lastMatch: PlayedMatch | null;
  myClubId: number;
  onGoToSelection?: () => void;
  onGoToContracts?: () => void;
  onOpenLastGame?: () => void;
}) {
  const mySide: "home" | "away" | null = lastMatch ? (lastMatch.homeClubId === myClubId ? "home" : lastMatch.awayClubId === myClubId ? "away" : null) : null;
  const myBallotIsUser = mySide === "home" ? lastMatch?.coachesVotes?.homeBallotIsUser : mySide === "away" ? lastMatch?.coachesVotes?.awayBallotIsUser : undefined;
  const needsVote = !!lastMatch?.coachesVotes && mySide !== null && !myBallotIsUser;
  const opponentId = lastMatch ? (mySide === "home" ? lastMatch.awayClubId : lastMatch.homeClubId) : undefined;

  return (
    <Card>
      <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Coach actions</div>

      {needsVote && lastMatch && (
        <div className="mb-3 flex items-center justify-between gap-2 rounded-lg p-2.5 text-sm" style={{ background: "rgba(0,0,0,.2)" }}>
          <span>
            <span className="font-medium" style={{ color: "var(--accT)" }}>Coaches votes: </span>
            Submit your 5-4-3-2-1 for Round {lastMatch.round} vs {clubById(opponentId ?? -1)?.name ?? "your last opponent"}.
          </span>
          {onOpenLastGame && (
            <button
              onClick={onOpenLastGame}
              className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold"
              style={{ background: "var(--acc)", color: "var(--on)" }}
            >
              Submit votes
            </button>
          )}
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
          <div className="rounded-lg p-2.5 text-sm" style={{ background: "rgba(0,0,0,.2)" }}>
            <span className="font-medium">Emerging talent to watch: </span>
            {emergingTalent.map((p, i) => (
              <span key={p.PlayerID}>
                <PlayerLink player={p}>{playerFullName(p)}</PlayerLink> ({p.Age}, {p.POT} POT)
                {i < emergingTalent.length - 1 ? ", " : ""}
              </span>
            ))}
          </div>
        )}
        {lineupSet && contractsOutThisYear === 0 && emergingTalent.length === 0 && (
          <div className="text-sm text-slate-500">Nothing urgent on your list right now.</div>
        )}
      </div>
    </Card>
  );
}

function ActionRow({ label, onClick, cta }: { label: string; onClick?: () => void; cta: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg p-2.5 text-sm" style={{ background: "rgba(0,0,0,.2)" }}>
      <span>{label}</span>
      {onClick && (
        <button onClick={onClick} className="shrink-0 font-medium hover:underline" style={{ color: "var(--accT)" }}>
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

const LEADER_CARD_LIMIT = 5;
const LEADER_MODAL_LIMIT = 100;

function LeagueLeadersCard({
  totals,
  myClub,
  onExpandStat,
}: {
  totals: Map<number, SeasonPlayerTotals>;
  myClub: string;
  onExpandStat: (stat: LeagueStat, label: string) => void;
}) {
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <div style={{ font: "500 11px 'IBM Plex Mono',monospace", letterSpacing: "1.5px", color: "#9aa4b5" }}>Competition leaders this season</div>
        <button onClick={() => onExpandStat("fantasyPoints", "Fantasy Points")} className="text-xs font-medium hover:underline" style={{ color: "var(--accT)" }}>
          Browse all stats →
        </button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {LEAGUE_STATS.map(({ key, label }) => {
          const top = leagueLeaders(totals, key, LEADER_CARD_LIMIT);
          const weAreInTopN = top.some((r) => r.player.Team === myClub);
          const ourBest = weAreInTopN ? null : ourLeagueBest(totals, key, myClub);
          return (
            <div key={key}>
              <button onClick={() => onExpandStat(key, label)} className="mb-1.5 flex w-full items-center justify-between text-left">
                <div className="text-xs font-medium text-slate-400">{label}</div>
                <ExpandHint label={`Top ${LEADER_MODAL_LIMIT}`} />
              </button>
              <div className="space-y-0.5 text-sm">
                {top.length === 0 ? (
                  <div className="text-slate-500">No games played yet.</div>
                ) : (
                  top.map((r, i) => (
                    <div
                      key={r.player.PlayerID}
                      className="flex items-center justify-between gap-2"
                      style={r.player.Team === myClub ? { color: "var(--accT)", fontWeight: 600 } : { color: "#c3ccdd" }}
                    >
                      <span className="truncate">
                        <span className="mr-1 text-slate-500 tabular-nums">{i + 1}</span>
                        <PlayerLink player={r.player} />
                      </span>
                      <span className="tabular-nums">{Math.round(r.value)}</span>
                    </div>
                  ))
                )}
              </div>
              {ourBest && (
                <div className="mt-1.5 text-xs text-slate-500">
                  Our best: <PlayerLink player={ourBest.player}>{playerFullName(ourBest.player)}</PlayerLink>, {Math.round(ourBest.value)} ({ourBest.rank}
                  {ordinalSuffix(ourBest.rank)})
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

type LeaderViewMode = "seasonTotal" | "seasonAverage" | "last5" | "allTimeTotal" | "allTimeAverage";

const VIEW_MODES: { key: LeaderViewMode; label: string; isAverage: boolean }[] = [
  { key: "seasonTotal", label: "Total (Season)", isAverage: false },
  { key: "seasonAverage", label: "Average (Season)", isAverage: true },
  { key: "last5", label: "Last 5 (Season)", isAverage: true },
  { key: "allTimeTotal", label: "Total (All Time)", isAverage: false },
  { key: "allTimeAverage", label: "Average (All Time)", isAverage: true },
];

function LeaderModal({
  stat: initialStat,
  label: initialLabel,
  season,
  seasonArchives,
  myClub,
  onClose,
}: {
  stat: LeagueStat;
  label: string;
  season: Season | null;
  seasonArchives: SeasonArchiveEntry[];
  myClub: string;
  onClose: () => void;
}) {
  const [stat, setStat] = useState(initialStat);
  const [label, setLabel] = useState(initialLabel);
  const [viewMode, setViewMode] = useState<LeaderViewMode>("seasonTotal");
  const activeView = VIEW_MODES.find((v) => v.key === viewMode)!;

  const totals = useMemo((): Map<number, SeasonPlayerTotals> => {
    switch (viewMode) {
      case "seasonTotal":
        return season ? seasonPlayerTotals(season) : new Map<number, SeasonPlayerTotals>();
      case "seasonAverage":
        return season ? toAverageMap(seasonPlayerTotals(season)) : new Map<number, SeasonPlayerTotals>();
      case "last5":
        return season ? toAverageMap(seasonPlayerLast5Totals(season)) : new Map<number, SeasonPlayerTotals>();
      case "allTimeTotal":
        return allTimePlayerTotals(seasonArchives, season);
      case "allTimeAverage":
        return toAverageMap(allTimePlayerTotals(seasonArchives, season));
    }
  }, [viewMode, season, seasonArchives]);

  const top = leagueLeaders(totals, stat, LEADER_MODAL_LIMIT);

  return (
    <Modal title={`${label} — top ${LEADER_MODAL_LIMIT}, ${activeView.label}`} onClose={onClose}>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {VIEW_MODES.map((v) => (
          <button
            key={v.key}
            onClick={() => setViewMode(v.key)}
            className="rounded-full px-3 py-1 text-xs font-medium"
            style={viewMode === v.key ? { background: "var(--acc)", color: "var(--on)" } : { background: "rgba(0,0,0,.2)", color: "#9aa4b5" }}
          >
            {v.label}
          </button>
        ))}
      </div>
      <select
        className="mb-3 w-full rounded-lg border border-base-600 bg-base-900 px-3 py-2 text-sm"
        value={stat}
        onChange={(e) => {
          const next = ALL_LEAGUE_STATS.find((s) => s.key === e.target.value);
          if (next) {
            setStat(next.key);
            setLabel(next.label);
          }
        }}
      >
        {ALL_LEAGUE_STATS.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </select>
      <div className="space-y-1 text-sm">
        {top.length === 0 ? (
          <div className="text-slate-500">No data yet for this view.</div>
        ) : (
          top.map((r, i) => (
            <div
              key={r.player.PlayerID}
              className="flex items-center justify-between gap-2 rounded-lg px-3 py-1.5"
              style={r.player.Team === myClub ? { background: "color-mix(in oklch, var(--acc) 12%, transparent)", color: "var(--accT)", fontWeight: 600 } : {}}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="w-6 text-slate-500 tabular-nums">{i + 1}</span>
                <ClubBadge club={clubByName(r.player.Team)} size="sm" />
                <span className="truncate">
                  <PlayerLink player={r.player} />
                </span>
              </span>
              <span className="tabular-nums">{activeView.isAverage ? r.value.toFixed(1) : Math.round(r.value)}</span>
            </div>
          ))
        )}
      </div>
    </Modal>
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
