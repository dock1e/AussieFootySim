import { useMemo, useState } from "react";
import type { MatchResult, BoxScoreLine, MatchEvent } from "../engine/match";
import type { MatchTeam } from "../engine/team";
import { playerFullName, type Player } from "../types/player";
import type { Side } from "../engine/zones";
import { quarterlyPoints, sumTeam, playerLinesByQuarter, type QuarterPoints } from "../engine/summary";
import { computeAussieFootySimRatings, fantasyPointsFor } from "../engine/ratings";
import { isValidBallot, VOTE_VALUES, type CoachesVoteAllocation, type MatchCoachesVotes } from "../engine/coachesVotes";
import { ClubBadgeByName } from "./ClubBadge";
import { PlayerLink } from "./PlayerLink";
import { PlayerMatchDrawer } from "./PlayerMatchDrawer";

/**
 * Full-time result screen — Sep 2026 round 103, [[Full-Time Review and Unified Player Drawer]].
 * Rebuilt from a single long scrolling page into a self-contained fixed-height tabbed review (Tyler's
 * own "Prompt 4"), independent of whichever of the three real host contexts renders it (bare inside
 * `LiveMatch.tsx`, bare inside `SeasonHub.tsx`, or inside `Dashboard.tsx`'s `<Modal>`) — see that
 * design note for why a self-contained height beats hooking into App.tsx's cockpit shell.
 *
 * Every player click on this screen — Best on Ground, Top Performers, both stats tables, the leading
 * player named against each Team Totals bar — opens the shared `PlayerMatchDrawer` (Match Stats
 * first, never Career Profile) instead of the old `<PlayerLink>`-to-career-profile shortcut. That
 * shortcut was the actual "stats-click bug": this screen never had any OTHER click affordance wired
 * up, so clicking a name here always meant Career Profile, never a deliberate default — see the
 * design note's own diagnosis. `CoachesVotesCard`'s ballot names are the one deliberately unchanged
 * exception — naming who got voted for reads more like a leaderboard mention than inspecting this
 * match's performance, and it's outside Tyler's own named click-surface list.
 *
 * Scoped down from the full reference spec on purpose, same as before: this simulator has no "my
 * club"/save-game concept baked into this screen, so the header stays neutral rather than
 * VICTORY/DEFEAT-framed. Best on Ground/Top Performers still rank by the real event-weighted
 * AussieFootySim Rating (Player Ratings.md, engine/ratings.ts, Phase 5).
 */

interface RatedRow {
  player: Player;
  side: Side;
  line: BoxScoreLine;
  rating: number;
  fantasyPoints: number;
}

type ReviewTab = "overview" | "player-stats" | "by-quarter" | "team-totals" | "play-by-play";

const REVIEW_TABS: { key: ReviewTab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "player-stats", label: "Player stats" },
  { key: "by-quarter", label: "By quarter" },
  { key: "team-totals", label: "Team totals" },
  { key: "play-by-play", label: "Play by play" },
];

const STAT_ROWS: { key: keyof BoxScoreLine; label: string }[] = [
  { key: "disposals", label: "Disposals" },
  { key: "kicks", label: "Kicks" },
  { key: "handballs", label: "Handballs" },
  { key: "marks", label: "Marks" },
  { key: "tackles", label: "Tackles" },
  { key: "clearances", label: "Clearances" },
  { key: "hitouts", label: "Hitouts" },
  { key: "freeKicksFor", label: "Free Kicks" }, // a team's "freeKicksFor" total is, by construction, exactly the other team's "freeKicksAgainst" total, so one row reads cleanly as a genuine team-vs-team comparison.
  { key: "goals", label: "Goals" },
  { key: "behinds", label: "Behinds" },
];

/** Tyler's exact trim for the Player Stats tab — drops every column DetailedStatsTable.tsx used to show beyond these, which is what forced that table's own horizontal scrollbars. */
const PLAYER_STATS_COLUMNS: { key: keyof BoxScoreLine; label: string; title: string }[] = [
  { key: "kicks", label: "K", title: "Kicks" },
  { key: "handballs", label: "HB", title: "Handballs" },
  { key: "disposals", label: "D", title: "Disposals" },
  { key: "marks", label: "M", title: "Marks" },
  { key: "tackles", label: "T", title: "Tackles" },
  { key: "clearances", label: "CLR", title: "Clearances" },
  { key: "goals", label: "G", title: "Goals" },
];

export function FullTimeResult({
  result,
  homeTeam,
  awayTeam,
  onNewMatch,
  closeLabel = "New match-up",
  coachesVotes,
  myClub,
  onSubmitBallot,
}: {
  result: MatchResult;
  homeTeam: MatchTeam;
  awayTeam: MatchTeam;
  onNewMatch: () => void;
  /** Override the header button's label — e.g. "Back to ladder" when this is reused to view a past season result rather than an ad-hoc exhibition match. */
  closeLabel?: string;
  /**
   * Sep 2026 round 90, [[Coaches Votes and MVP Award]] — undefined for an ad-hoc `LiveMatch.tsx`
   * friendly (no season/fixture to feed a tally) or a pre-round-90 archived match; present for every
   * season/finals match from round 90 on. When present, the Coaches Votes card renders read-only.
   */
  coachesVotes?: MatchCoachesVotes;
  /** The user's own club name (matching `homeTeam.name`/`awayTeam.name`) — which side, if either, gets a submit-your-ballot option. */
  myClub?: string;
  /** Presence gates a real submission FORM rather than a read-only display — absent for the archived-match review screen or an ad-hoc LiveMatch friendly, neither of which pass it. */
  onSubmitBallot?: (side: "home" | "away", allocations: CoachesVoteAllocation[]) => void;
}) {
  const [tab, setTab] = useState<ReviewTab>("overview");
  const [teamFilter, setTeamFilter] = useState<"home" | "away" | "both">("both");
  const [selectedPlayer, setSelectedPlayer] = useState<{ player: Player; side: Side } | null>(null);

  const homeIds = useMemo(() => new Set(homeTeam.players.map((p) => p.PlayerID)), [homeTeam]);
  const awayIds = useMemo(() => new Set(awayTeam.players.map((p) => p.PlayerID)), [awayTeam]);

  const quarters = useMemo(() => quarterlyPoints(result, homeIds, awayIds), [result, homeIds, awayIds]);
  const simRatings = useMemo(() => computeAussieFootySimRatings(result, homeTeam, awayTeam), [result, homeTeam, awayTeam]);

  const margin = result.home.points - result.away.points;
  const winner = margin > 0 ? homeTeam.name : margin < 0 ? awayTeam.name : null;
  const marginAbs = Math.abs(margin);

  const rated: RatedRow[] = useMemo(() => {
    const withSide: { player: Player; side: Side }[] = [
      ...homeTeam.players.map((player) => ({ player, side: "home" as Side })),
      ...awayTeam.players.map((player) => ({ player, side: "away" as Side })),
    ];
    return withSide
      .map(({ player, side }) => ({
        player,
        side,
        line: result.boxScore[player.PlayerID],
        rating: simRatings[player.PlayerID]?.rating ?? 0,
        fantasyPoints: fantasyPointsFor(result.boxScore[player.PlayerID]),
      }))
      .sort((a, b) => b.rating - a.rating);
  }, [homeTeam, awayTeam, result, simRatings]);

  const filteredRated = useMemo(
    () => (teamFilter === "both" ? rated : rated.filter((r) => r.side === teamFilter)),
    [rated, teamFilter],
  );

  const bestOnGround = rated[0];
  const homeTotals = sumTeam(result.boxScore, homeIds);
  const awayTotals = sumTeam(result.boxScore, awayIds);

  const headline = winner
    ? marginAbs >= 50
      ? `${winner} run away with it`
      : marginAbs <= 6
        ? `${winner} snatch a thriller`
        : `${winner} get the job done`
    : "Dead level — a draw";

  const recap = bestOnGround
    ? `${bestOnGround.player.fname} ${bestOnGround.player.lname} (${bestOnGround.player.Team}) was best afield, ` +
      `finishing with ${bestOnGround.line.disposals} disposals, ${bestOnGround.line.marks} marks, ` +
      `${bestOnGround.line.tackles} tackles and ${bestOnGround.line.goals} goal${bestOnGround.line.goals === 1 ? "" : "s"}.`
    : "";

  const glow = marginAbs > 0 && marginAbs <= 12;

  function openDrawer(player: Player, side: Side) {
    setSelectedPlayer({ player, side });
  }

  return (
    <div className="flex h-[min(78vh,820px)] min-h-[520px] flex-col gap-3">
      <div className={`card shrink-0 border-2 ${glow ? "border-amber-400/60 shadow-[0_0_24px_rgba(251,191,36,0.25)]" : "border-base-600"}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">Full time</div>
            <div className="font-display text-2xl italic">{headline}</div>
            <div className="mt-0.5 text-sm text-slate-400">
              {winner ? `${winner} by ${marginAbs}` : "Scores level"} &middot; seed {result.seed}
            </div>
          </div>
          <button onClick={onNewMatch} className="shrink-0 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark">
            {closeLabel}
          </button>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <FinalScoreBlock name={homeTeam.name} r={result.home} align="left" />
          <div className="px-4 text-3xl text-slate-600">&ndash;</div>
          <FinalScoreBlock name={awayTeam.name} r={result.away} align="right" />
        </div>
      </div>

      <div className="grid shrink-0 gap-3 sm:grid-cols-2">
        <BestOnGroundTile entry={bestOnGround} onOpen={openDrawer} />
        <QuarterMarginSparkline quarters={quarters} />
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {REVIEW_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                tab === t.key ? "bg-primary text-white" : "bg-base-800 text-slate-300 hover:bg-base-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 rounded-lg bg-base-800 p-0.5 text-xs">
          {(["home", "away", "both"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setTeamFilter(f)}
              className={`rounded px-2.5 py-1 font-medium ${teamFilter === f ? "bg-primary/30 text-primary-light" : "text-slate-400 hover:text-slate-200"}`}
            >
              {f === "both" ? "Both" : f === "home" ? homeTeam.name : awayTeam.name}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "overview" && (
          <div className="h-full space-y-4 overflow-y-auto pr-1">
            {recap && <p className="text-sm text-slate-300">{recap}</p>}
            <div className="card">
              <div className="mb-3 text-xs uppercase tracking-wide text-slate-400">Margin progression</div>
              <MarginChart quarters={quarters} />
              <div className="mt-2 flex justify-between text-xs tabular-nums text-slate-400">
                {quarters.map((q) => (
                  <span key={q.quarter}>
                    Q{q.quarter}: {q.homePoints}-{q.awayPoints}
                  </span>
                ))}
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <TopPerformers title="Top performers" clubName={homeTeam.name} rows={rated.filter((r) => r.side === "home").slice(0, 5)} onOpen={openDrawer} />
              <TopPerformers title="Top performers" clubName={awayTeam.name} rows={rated.filter((r) => r.side === "away").slice(0, 5)} onOpen={openDrawer} />
            </div>
            {coachesVotes && (
              <CoachesVotesCard votes={coachesVotes} homeTeam={homeTeam} awayTeam={awayTeam} myClub={myClub} onSubmitBallot={onSubmitBallot} />
            )}
          </div>
        )}

        {tab === "player-stats" && <PlayerStatsTable rows={filteredRated} onOpen={openDrawer} />}

        {tab === "by-quarter" && <ByQuarterTable rows={filteredRated} events={result.events} onOpen={openDrawer} />}

        {tab === "team-totals" && (
          <div className="h-full overflow-y-auto pr-1">
            <TeamTotalsContent homeTeam={homeTeam} awayTeam={awayTeam} homeIds={homeIds} awayIds={awayIds} homeTotals={homeTotals} awayTotals={awayTotals} boxScore={result.boxScore} onOpen={openDrawer} />
          </div>
        )}

        {tab === "play-by-play" && (
          <div className="h-full overflow-y-auto pr-1">
            <PlayByPlayList events={result.events} />
          </div>
        )}
      </div>

      {selectedPlayer && (
        <PlayerMatchDrawer
          player={selectedPlayer.player}
          side={selectedPlayer.side}
          line={result.boxScore[selectedPlayer.player.PlayerID]}
          events={result.events}
          position={(selectedPlayer.side === "home" ? homeTeam : awayTeam).positions?.get(selectedPlayer.player.PlayerID)}
          onGround={(selectedPlayer.side === "home" ? homeTeam : awayTeam).onGround?.has(selectedPlayer.player.PlayerID)}
          roster={rated.map((r) => ({ player: r.player, side: r.side }))}
          onSelect={openDrawer}
          onClose={() => setSelectedPlayer(null)}
        />
      )}
    </div>
  );
}

function FinalScoreBlock({
  name,
  r,
  align,
}: {
  name: string;
  r: { goals: number; behinds: number; points: number };
  align: "left" | "right";
}) {
  return (
    <div className={align === "left" ? "text-left" : "text-right"}>
      <div className={`flex items-center gap-1.5 text-sm text-slate-400 ${align === "left" ? "" : "justify-end"}`}>
        {align === "right" && name}
        <ClubBadgeByName name={name} size="sm" />
        {align === "left" && name}
      </div>
      <div className="text-4xl font-bold tabular-nums">{r.points}</div>
      <div className="text-xs text-slate-500 tabular-nums">
        {r.goals}.{r.behinds}
      </div>
    </div>
  );
}

/** Three key numbers, deliberately down from the old tile's six (D/M/T/G plus the Rating/FP pair) — keeps this project's own established "Rating+FP are the twin headline numbers" convention (Player Ratings.md) and adds the single most universally "how involved were they" raw stat alongside it. */
function BestOnGroundTile({ entry, onOpen }: { entry: RatedRow | undefined; onOpen: (player: Player, side: Side) => void }) {
  if (!entry) {
    return <div className="card flex items-center text-sm text-slate-500">No standout performance.</div>;
  }
  return (
    <div className="card">
      <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Best on ground</div>
      <div className="flex items-center justify-between gap-2">
        <button onClick={() => onOpen(entry.player, entry.side)} className="min-w-0 text-left hover:text-primary-light">
          <div className="truncate text-base font-semibold">
            #{entry.player.jumperNumber} {playerFullName(entry.player)}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400">
            <ClubBadgeByName name={entry.player.Team} size="sm" />
            {entry.player.Team}
          </div>
        </button>
        <div className="flex shrink-0 gap-3 text-center">
          <div>
            <div className="text-lg font-bold tabular-nums text-accent">{entry.rating.toFixed(0)}</div>
            <div className="text-[10px] uppercase tracking-wide text-slate-500">RTG</div>
          </div>
          <div>
            <div className="text-lg font-semibold tabular-nums text-slate-300">{entry.fantasyPoints}</div>
            <div className="text-[10px] uppercase tracking-wide text-slate-500">FP</div>
          </div>
          <div>
            <div className="text-lg font-semibold tabular-nums text-slate-200">{entry.line.disposals}</div>
            <div className="text-[10px] uppercase tracking-wide text-slate-500">D</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Tyler's "four-bar quarter margin sparkline" — each bar is that quarter's own ISOLATED margin (this quarter only), not the running/cumulative figure `MarginChart` below plots — derived from `quarterlyPoints`'s cumulative numbers (`this - previous`) rather than a new engine function. Neutral home-vs-away framing, same as the rest of this screen. */
function QuarterMarginSparkline({ quarters }: { quarters: QuarterPoints[] }) {
  const isolated = quarters.map((q, i) => q.margin - (quarters[i - 1]?.margin ?? 0));
  const maxAbs = Math.max(10, ...isolated.map((m) => Math.abs(m)));
  return (
    <div className="card">
      <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Margin by quarter</div>
      <div className="flex h-14 items-end gap-2">
        {isolated.map((m, i) => {
          const pct = Math.max((Math.abs(m) / maxAbs) * 100, 6);
          return (
            <div key={i} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex h-9 w-full items-end justify-center">
                <div className={`w-6 rounded-t ${m >= 0 ? "bg-good" : "bg-bad"}`} style={{ height: `${pct}%` }} />
              </div>
              <div className="text-[10px] tabular-nums text-slate-400">
                Q{i + 1} {m > 0 ? "+" : ""}
                {m}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MarginChart({ quarters }: { quarters: { quarter: number; margin: number }[] }) {
  const width = 600;
  const height = 140;
  const maxAbs = Math.max(40, ...quarters.map((q) => Math.abs(q.margin)));
  const points = [{ quarter: 0, margin: 0 }, ...quarters];
  const x = (i: number) => (i / (points.length - 1)) * (width - 20) + 10;
  const y = (margin: number) => height / 2 - (margin / maxAbs) * (height / 2 - 10);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.margin).toFixed(1)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-32 w-full">
      <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" />
      {points.slice(1).map((_, i) => (
        <line
          key={i}
          x1={x(i + 1)}
          y1={0}
          x2={x(i + 1)}
          y2={height}
          stroke="rgba(255,255,255,0.08)"
          strokeDasharray="2 4"
        />
      ))}
      <path d={path} fill="none" stroke="#ff5a36" strokeWidth={2.5} />
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.margin)} r={3.5} fill="#ff5a36" />
      ))}
    </svg>
  );
}

function TopPerformers({
  title,
  clubName,
  rows,
  onOpen,
}: {
  title: string;
  clubName?: string;
  rows: RatedRow[];
  onOpen: (player: Player, side: Side) => void;
}) {
  return (
    <div className="card">
      <div className="mb-3 flex items-center gap-1.5 text-xs uppercase tracking-wide text-slate-400">
        {clubName && <ClubBadgeByName name={clubName} size="sm" />}
        {title}
      </div>
      <div className="space-y-1.5 text-sm">
        {rows.map((r, i) => (
          <button
            key={r.player.PlayerID}
            onClick={() => onOpen(r.player, r.side)}
            className="flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-left hover:bg-base-700/50"
          >
            <span className="flex items-center gap-2 truncate">
              <span className="w-4 shrink-0 text-slate-500 tabular-nums">{i + 1}</span>
              <span className="truncate">{playerFullName(r.player)}</span>
            </span>
            <span className="flex shrink-0 items-center gap-3 tabular-nums">
              <span className="text-slate-500">
                {r.line.disposals}d {r.line.marks}m {r.line.tackles}t {r.line.goals}g
              </span>
              <span className="text-slate-400" title="Fantasy Points">
                {r.fantasyPoints}fp
              </span>
              <span className="w-10 text-right font-bold text-accent" title="AussieFootySim Rating">
                {r.rating.toFixed(0)}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Tyler's "single full-width table... only the table body scrolling." Sticky `thead` inside one
 * scrollable container — same pattern `PlayerProfileModal.tsx`'s own `ArchivedMatchView` full box
 * score table already uses for the identical "scroll the body, keep the header pinned" need.
 */
function PlayerStatsTable({ rows, onOpen }: { rows: RatedRow[]; onOpen: (player: Player, side: Side) => void }) {
  return (
    <div className="h-full overflow-y-auto rounded-card border border-base-700">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-base-900 text-xs text-slate-500">
          <tr>
            <th className="border-b border-base-700 py-2 pl-3 text-left font-medium">Player</th>
            {PLAYER_STATS_COLUMNS.map((c) => (
              <th key={c.key} className="border-b border-base-700 py-2 text-center font-medium" title={c.title}>
                {c.label}
              </th>
            ))}
            <th className="border-b border-base-700 py-2 text-center font-medium" title="Fantasy Points">
              FP
            </th>
            <th className="border-b border-base-700 py-2 pr-3 text-center font-medium" title="AussieFootySim Rating">
              RTG
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.player.PlayerID} onClick={() => onOpen(r.player, r.side)} className="h-10 cursor-pointer border-b border-base-800 hover:bg-base-800/60">
              <td className="pl-3 text-left">
                <span className="flex items-center gap-1.5 truncate">
                  <ClubBadgeByName name={r.player.Team} size="sm" />
                  <span className="truncate">
                    #{r.player.jumperNumber} {playerFullName(r.player)}
                  </span>
                </span>
              </td>
              {PLAYER_STATS_COLUMNS.map((c) => (
                <td key={c.key} className="text-center tabular-nums">
                  {r.line?.[c.key] ?? 0}
                </td>
              ))}
              <td className="text-center font-semibold tabular-nums">{r.fantasyPoints}</td>
              <td className="pr-3 text-center font-semibold tabular-nums text-accent">{r.rating.toFixed(0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Same unified-table-plus-toggle shape as Player Stats, scoped to fantasy points per quarter — a full K/HB/D/M/T/CLR/G breakdown × 4 quarters would be 28+ columns with no honest full-width single-table answer, so this stays focused on the one number that's genuinely useful to compare quarter-to-quarter at a glance. The drawer's own "By quarter" tab has the fuller per-stat breakdown for a single player. */
function ByQuarterTable({ rows, events, onOpen }: { rows: RatedRow[]; events: MatchEvent[]; onOpen: (player: Player, side: Side) => void }) {
  const byPlayer = playerLinesByQuarter(events, rows.map((r) => r.player.PlayerID));
  const quartersPresent = Object.values(byPlayer)[0]?.map((q) => q.quarter) ?? [];

  return (
    <div className="h-full overflow-y-auto rounded-card border border-base-700">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-base-900 text-xs text-slate-500">
          <tr>
            <th className="border-b border-base-700 py-2 pl-3 text-left font-medium">Player</th>
            {quartersPresent.map((q) => (
              <th key={q} className="border-b border-base-700 py-2 text-center font-medium" title={`Fantasy points, Q${q} only`}>
                Q{q}
              </th>
            ))}
            <th className="border-b border-base-700 py-2 pr-3 text-center font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const qLines = byPlayer[r.player.PlayerID] ?? [];
            const total = qLines.reduce((sum, q) => sum + q.fantasyPoints, 0);
            return (
              <tr key={r.player.PlayerID} onClick={() => onOpen(r.player, r.side)} className="h-10 cursor-pointer border-b border-base-800 hover:bg-base-800/60">
                <td className="pl-3 text-left">
                  <span className="flex items-center gap-1.5 truncate">
                    <ClubBadgeByName name={r.player.Team} size="sm" />
                    <span className="truncate">
                      #{r.player.jumperNumber} {playerFullName(r.player)}
                    </span>
                  </span>
                </td>
                {qLines.map((q) => (
                  <td key={q.quarter} className="text-center tabular-nums">
                    {Math.round(q.fantasyPoints)}
                  </td>
                ))}
                <td className="pr-3 text-center font-semibold tabular-nums text-primary-light">{Math.round(total)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Finds `team`'s own leading player at `key` — real per-stat leader, not a fabricated one, feeding the small clickable chip next to each Team Totals bar. */
function leaderFor(box: Record<number, BoxScoreLine>, ids: Set<number>, players: Player[], key: keyof BoxScoreLine): { player: Player; value: number } | null {
  let best: { player: Player; value: number } | null = null;
  for (const p of players) {
    if (!ids.has(p.PlayerID)) continue;
    const value = (box[p.PlayerID]?.[key] as number) ?? 0;
    if (value > 0 && (!best || value > best.value)) best = { player: p, value };
  }
  return best;
}

/** The existing home-vs-away bar comparison, extended with a real leading-player chip per side per stat — Tyler's click-surface list names "team totals" explicitly, and the old version had no per-player entity to click at all. */
function TeamTotalsContent({
  homeTeam,
  awayTeam,
  homeIds,
  awayIds,
  homeTotals,
  awayTotals,
  boxScore,
  onOpen,
}: {
  homeTeam: MatchTeam;
  awayTeam: MatchTeam;
  homeIds: Set<number>;
  awayIds: Set<number>;
  homeTotals: BoxScoreLine;
  awayTotals: BoxScoreLine;
  boxScore: Record<number, BoxScoreLine>;
  onOpen: (player: Player, side: Side) => void;
}) {
  return (
    <div className="card">
      <div className="mb-3 flex items-center gap-1.5 text-xs uppercase tracking-wide text-slate-400">
        <ClubBadgeByName name={homeTeam.name} size="sm" />
        {homeTeam.name} <span className="text-slate-600">vs</span> {awayTeam.name}
        <ClubBadgeByName name={awayTeam.name} size="sm" />
      </div>
      <div className="space-y-2.5">
        {STAT_ROWS.map(({ key, label }) => {
          const h = homeTotals[key];
          const a = awayTotals[key];
          const total = h + a;
          const pct = total === 0 ? 50 : (h / total) * 100;
          const homeLeader = leaderFor(boxScore, homeIds, homeTeam.players, key);
          const awayLeader = leaderFor(boxScore, awayIds, awayTeam.players, key);
          return (
            <div key={key}>
              <div className="mb-0.5 flex justify-between text-xs tabular-nums text-slate-400">
                <span>{h}</span>
                <span className="text-slate-500">{label}</span>
                <span>{a}</span>
              </div>
              <div className="flex h-1.5 overflow-hidden rounded-full bg-base-700">
                <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                <div className="h-full bg-info" style={{ width: `${100 - pct}%` }} />
              </div>
              <div className="mt-1 flex justify-between gap-2 text-[10px]">
                {homeLeader ? (
                  <button onClick={() => onOpen(homeLeader.player, "home")} className="truncate text-slate-500 hover:text-primary-light">
                    #{homeLeader.player.jumperNumber} {homeLeader.player.lname} ({homeLeader.value})
                  </button>
                ) : (
                  <span />
                )}
                {awayLeader ? (
                  <button onClick={() => onOpen(awayLeader.player, "away")} className="truncate text-slate-500 hover:text-primary-light">
                    #{awayLeader.player.jumperNumber} {awayLeader.player.lname} ({awayLeader.value})
                  </button>
                ) : (
                  <span />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Full finished-match event log, chronological (oldest first) — a genuine "read it like a record" recap, deliberately different from `LiveMatch.tsx`'s own live `PlayByPlay` (newest-first, capped at 40) which exists for a "what just happened" live feed, not a static post-match review. No spoiler concern here — the match is over. */
function PlayByPlayList({ events }: { events: MatchEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-slate-500">No events recorded for this match.</p>;
  }
  return (
    <div className="space-y-1 text-sm">
      {events.map((ev, i) => (
        <div key={i} className="flex gap-2 border-b border-base-800/60 py-1 text-slate-300">
          <span className="w-10 shrink-0 tabular-nums text-slate-500">Q{ev.quarter}</span>
          <span>{ev.description}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Sep 2026 round 90, [[Coaches Votes and MVP Award]] — undisturbed by round 103's rebuild, still
 * rendered once inside the Overview tab. Ballot names deliberately keep `<PlayerLink>`'s direct-to-
 * career-profile behaviour — see this file's own top doc comment for why that's a disclosed scope
 * exclusion, not a leftover instance of the bug the rest of this screen just fixed.
 */
function CoachesVotesCard({
  votes,
  homeTeam,
  awayTeam,
  myClub,
  onSubmitBallot,
}: {
  votes: MatchCoachesVotes;
  homeTeam: MatchTeam;
  awayTeam: MatchTeam;
  myClub?: string;
  onSubmitBallot?: (side: "home" | "away", allocations: CoachesVoteAllocation[]) => void;
}) {
  const pool = useMemo(() => [...homeTeam.players, ...awayTeam.players], [homeTeam, awayTeam]);
  const playerById = useMemo(() => new Map(pool.map((p) => [p.PlayerID, p])), [pool]);
  const mySide: "home" | "away" | null = homeTeam.name === myClub ? "home" : awayTeam.name === myClub ? "away" : null;
  const myBallot = mySide === "home" ? votes.homeCoachBallot : mySide === "away" ? votes.awayCoachBallot : null;
  const myBallotIsUser = mySide === "home" ? votes.homeBallotIsUser : mySide === "away" ? votes.awayBallotIsUser : false;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<(number | null)[]>([null, null, null, null, null]);

  function startEditing() {
    const sorted = myBallot ? [...myBallot].sort((a, b) => b.votes - a.votes) : [];
    setDraft(VOTE_VALUES.map((_, i) => sorted[i]?.playerId ?? null));
    setEditing(true);
  }

  const draftAllocations: CoachesVoteAllocation[] | null = draft.every((id): id is number => id !== null)
    ? draft.map((id, i) => ({ playerId: id, votes: VOTE_VALUES[i] }))
    : null;
  const canSubmitDraft = draftAllocations !== null && isValidBallot(draftAllocations);

  function submit() {
    if (!mySide || !onSubmitBallot || !draftAllocations || !isValidBallot(draftAllocations)) return;
    onSubmitBallot(mySide, draftAllocations);
    setEditing(false);
  }

  return (
    <div className="card">
      <div className="mb-3 text-xs uppercase tracking-wide text-slate-400">Coaches votes</div>
      <div className="grid gap-4 md:grid-cols-2">
        <BallotList
          ballot={votes.homeCoachBallot}
          playerById={playerById}
          label={`${homeTeam.name}'s coach${votes.homeBallotIsUser ? " — your ballot" : ""}`}
        />
        <BallotList
          ballot={votes.awayCoachBallot}
          playerById={playerById}
          label={`${awayTeam.name}'s coach${votes.awayBallotIsUser ? " — your ballot" : ""}`}
        />
      </div>

      {mySide && onSubmitBallot && !editing && (
        <button
          onClick={startEditing}
          className="mt-4 rounded-lg bg-base-700 px-4 py-2 text-sm font-medium hover:bg-base-600"
        >
          {myBallotIsUser ? "Edit your votes" : "Submit your votes"}
        </button>
      )}

      {mySide && onSubmitBallot && editing && (
        <div className="mt-4 space-y-2 border-t border-base-700 pt-4">
          <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">
            Your 5-4-3-2-1 for {mySide === "home" ? homeTeam.name : awayTeam.name}
          </div>
          {VOTE_VALUES.map((v, i) => (
            <div key={v} className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-center font-bold tabular-nums text-accent">{v}</span>
              <select
                value={draft[i] ?? ""}
                onChange={(e) => {
                  const id = e.target.value ? Number(e.target.value) : null;
                  setDraft((d) => d.map((x, j) => (j === i ? id : x)));
                }}
                className="flex-1 rounded bg-base-800 px-2 py-1.5 text-sm"
              >
                <option value="">Select a player…</option>
                {pool
                  .filter((p) => !draft.includes(p.PlayerID) || draft[i] === p.PlayerID)
                  .map((p) => (
                    <option key={p.PlayerID} value={p.PlayerID}>
                      {playerFullName(p)} ({p.Team})
                    </option>
                  ))}
              </select>
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <button
              onClick={submit}
              disabled={!canSubmitDraft}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              Submit votes
            </button>
            <button onClick={() => setEditing(false)} className="rounded-lg bg-base-800 px-4 py-2 text-sm text-slate-400 hover:bg-base-700">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function BallotList({ ballot, playerById, label }: { ballot: CoachesVoteAllocation[]; playerById: Map<number, Player>; label: string }) {
  const sorted = [...ballot].sort((a, b) => b.votes - a.votes);
  return (
    <div>
      <div className="mb-1.5 truncate text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="space-y-1 text-sm">
        {sorted.map((a) => {
          const player = playerById.get(a.playerId);
          return (
            <div key={a.playerId} className="flex items-center gap-2">
              <span className="w-4 shrink-0 text-center font-bold tabular-nums text-accent">{a.votes}</span>
              <span className="flex-1 truncate">{player ? <PlayerLink player={player} /> : "Unknown player"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
