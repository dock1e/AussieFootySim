import { useMemo, useState } from "react";
import type { MatchResult, BoxScoreLine } from "../engine/match";
import type { MatchTeam } from "../engine/team";
import { playerFullName, type Player } from "../types/player";
import { quarterlyPoints, sumTeam } from "../engine/summary";
import { computeAussieFootySimRatings, fantasyPointsFor } from "../engine/ratings";
import { isValidBallot, VOTE_VALUES, type CoachesVoteAllocation, type MatchCoachesVotes } from "../engine/coachesVotes";
import { DetailedStatsTable } from "./DetailedStatsTable";
import { ClubBadgeByName } from "./ClubBadge";
import { PlayerLink } from "./PlayerLink";

/**
 * Full-time result screen — User Interface.md "Full-time result": score,
 * quarter-by-quarter progression, team-stat comparison bars, Best on
 * Ground, a short auto-generated recap paragraph.
 *
 * Scoped down from the full spec on purpose (see ROADMAP.md): this
 * simulator has no "my club"/save-game concept yet, so the VICTORY/DEFEAT-
 * framed recap card doesn't have a perspective to frame itself from — shown
 * neutrally instead. Best on Ground/Top Performers are now ranked by the
 * real event-weighted AussieFootySim Rating (Player Ratings.md, engine/ratings.ts,
 * Phase 5) rather than the old placeholder box-score composite — shown
 * alongside Fantasy Points as twin numbers per Player Ratings.md's own UI
 * research ("showing Fantasy Points and AussieFootySim Rating as twin columns makes
 * the difference between volume and quality visible at a glance").
 */

const STAT_ROWS: { key: keyof BoxScoreLine; label: string }[] = [
  { key: "disposals", label: "Disposals" },
  { key: "kicks", label: "Kicks" },
  { key: "handballs", label: "Handballs" },
  { key: "marks", label: "Marks" },
  { key: "tackles", label: "Tackles" },
  { key: "clearances", label: "Clearances" },
  { key: "hitouts", label: "Hitouts" },
  { key: "freeKicksFor", label: "Free Kicks" }, // Aug 2026 round 19 — a team's "freeKicksFor" total is, by construction, exactly the other team's "freeKicksAgainst" total, so one row (not a for/against pair) reads cleanly as a genuine team-vs-team comparison, same as every other row here.
  { key: "goals", label: "Goals" },
  { key: "behinds", label: "Behinds" },
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
  /** Override the footer button's label — e.g. "Back to ladder" when this is reused to view a past season result rather than an ad-hoc exhibition match. */
  closeLabel?: string;
  /**
   * Sep 2026 round 90, [[Coaches Votes and MVP Award]] — undefined for an ad-hoc `LiveMatch.tsx`
   * friendly (no season/fixture to feed a tally) or a pre-round-90 archived match; present for every
   * season/finals match from round 90 on. When present, the Coaches Votes card renders read-only.
   */
  coachesVotes?: MatchCoachesVotes;
  /** The user's own club name (matching `homeTeam.name`/`awayTeam.name` — same comparison `LiveMatch.tsx`'s own `mySide` already uses) — which side, if either, gets a submit-your-ballot option. */
  myClub?: string;
  /** Presence (not just `myClub` matching a side) is what gates a real submission FORM rather than a read-only display — absent for the archived-match review screen, where you can look back but not retroactively vote. */
  onSubmitBallot?: (side: "home" | "away", allocations: CoachesVoteAllocation[]) => void;
}) {
  const homeIds = useMemo(() => new Set(homeTeam.players.map((p) => p.PlayerID)), [homeTeam]);
  const awayIds = useMemo(() => new Set(awayTeam.players.map((p) => p.PlayerID)), [awayTeam]);

  const quarters = useMemo(() => quarterlyPoints(result, homeIds, awayIds), [result, homeIds, awayIds]);
  const simRatings = useMemo(() => computeAussieFootySimRatings(result, homeTeam, awayTeam), [result, homeTeam, awayTeam]);

  const margin = result.home.points - result.away.points;
  const winner = margin > 0 ? homeTeam.name : margin < 0 ? awayTeam.name : null;
  const marginAbs = Math.abs(margin);

  const rated = [...homeTeam.players, ...awayTeam.players]
    .map((p) => ({
      player: p,
      line: result.boxScore[p.PlayerID],
      rating: simRatings[p.PlayerID]?.rating ?? 0,
      fantasyPoints: fantasyPointsFor(result.boxScore[p.PlayerID]),
    }))
    .sort((a, b) => b.rating - a.rating);
  const bestOnGround = rated[0];
  const topHome = rated.filter((r) => homeIds.has(r.player.PlayerID)).slice(0, 5);
  const topAway = rated.filter((r) => awayIds.has(r.player.PlayerID)).slice(0, 5);

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

  return (
    <div className="space-y-4">
      <div className={`card border-2 ${glow ? "border-amber-400/60 shadow-[0_0_24px_rgba(251,191,36,0.25)]" : "border-base-600"}`}>
        <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">Full time</div>
        <div className="font-display text-2xl italic">{headline}</div>
        <div className="mt-0.5 text-sm text-slate-400">
          {winner ? `${winner} by ${marginAbs}` : "Scores level"} &middot; seed {result.seed}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <FinalScoreBlock name={homeTeam.name} r={result.home} align="left" />
          <div className="px-4 text-3xl text-slate-600">&ndash;</div>
          <FinalScoreBlock name={awayTeam.name} r={result.away} align="right" />
        </div>

        {recap && <p className="mt-4 text-sm text-slate-300">{recap}</p>}
      </div>

      <div className="card">
        <div className="mb-3 text-xs uppercase tracking-wide text-slate-400">Margin by quarter</div>
        <MarginChart quarters={quarters} />
        <div className="mt-2 flex justify-between text-xs tabular-nums text-slate-400">
          {quarters.map((q) => (
            <span key={q.quarter}>
              Q{q.quarter}: {q.homePoints}-{q.awayPoints}
            </span>
          ))}
        </div>
      </div>

      {bestOnGround && (
        <div className="card">
          <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Best on ground</div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-lg font-semibold">
                <PlayerLink player={bestOnGround.player} />
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-400">
                <ClubBadgeByName name={bestOnGround.player.Team} size="sm" />
                {bestOnGround.player.Team}
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="grid grid-cols-4 gap-4 text-center text-sm tabular-nums">
                <Stat label="D" value={bestOnGround.line.disposals} />
                <Stat label="M" value={bestOnGround.line.marks} />
                <Stat label="T" value={bestOnGround.line.tackles} />
                <Stat label="G" value={bestOnGround.line.goals} />
              </div>
              <div className="flex gap-3 border-l border-base-600 pl-4 text-center">
                <div>
                  <div className="text-xl font-bold tabular-nums text-accent">{bestOnGround.rating.toFixed(0)}</div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">AussieFootySim Rating</div>
                </div>
                <div>
                  <div className="text-xl font-semibold tabular-nums text-slate-300">{bestOnGround.fantasyPoints}</div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">Fantasy Pts</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="mb-3 flex items-center gap-1.5 text-xs uppercase tracking-wide text-slate-400">
          <ClubBadgeByName name={homeTeam.name} size="sm" />
          {homeTeam.name} <span className="text-slate-600">vs</span> {awayTeam.name}
          <ClubBadgeByName name={awayTeam.name} size="sm" />
        </div>
        <div className="space-y-2">
          {STAT_ROWS.map(({ key, label }) => {
            const h = homeTotals[key];
            const a = awayTotals[key];
            const total = h + a;
            const pct = total === 0 ? 50 : (h / total) * 100;
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
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <TopPerformers title="Top performers" clubName={homeTeam.name} rows={topHome} />
        <TopPerformers title="Top performers" clubName={awayTeam.name} rows={topAway} />
      </div>

      {coachesVotes && (
        <CoachesVotesCard votes={coachesVotes} homeTeam={homeTeam} awayTeam={awayTeam} myClub={myClub} onSubmitBallot={onSubmitBallot} />
      )}

      {/* Aug 2026 round 49, [[Detailed Match Statistics]] — Tyler: "a much more detailed view of
          player statistics... at the end of the game." The two TopPerformers lists above are a
          5-a-side quick glance (unchanged); this is the actual full squad, every column, both teams
          — nothing like it existed anywhere in this app before this round. No `fitnessFor` passed
          through: the match is over, live in-match fitness isn't a decision input anymore, and
          FullTimeResult doesn't otherwise need `matchInProgress` threaded into its props. */}
      <DetailedStatsTable homeTeam={homeTeam} awayTeam={awayTeam} result={result} showRating />

      <button onClick={onNewMatch} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark">
        {closeLabel}
      </button>
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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-slate-500">{label}</div>
      <div className="font-semibold">{value}</div>
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
}: {
  title: string;
  clubName?: string;
  rows: { player: Player; line: BoxScoreLine; rating: number; fantasyPoints: number }[];
}) {
  return (
    <div className="card">
      <div className="mb-3 flex items-center gap-1.5 text-xs uppercase tracking-wide text-slate-400">
        {clubName && <ClubBadgeByName name={clubName} size="sm" />}
        {title}
      </div>
      <div className="space-y-1.5 text-sm">
        {rows.map(({ player, line, rating, fantasyPoints }, i) => (
          <div key={player.PlayerID} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 truncate">
              <span className="w-4 shrink-0 text-slate-500 tabular-nums">{i + 1}</span>
              <span className="truncate">
                <PlayerLink player={player} />
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-3 tabular-nums">
              <span className="text-slate-500">
                {line.disposals}d {line.marks}m {line.tackles}t {line.goals}g
              </span>
              <span className="text-slate-400" title="Fantasy Points">
                {fantasyPoints}fp
              </span>
              <span className="w-10 text-right font-bold text-accent" title="AussieFootySim Rating">
                {rating.toFixed(0)}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Sep 2026 round 90, [[Coaches Votes and MVP Award]] — Tyler: "As a coach at the end of the game I
 * want to have the option to submit my 5,4,3,2,1 coaches votes for best afield be it from my team
 * or the opposition team." Shown for every season/finals match (own club or not — real supporters
 * follow the weekly votes regardless of who played); the submit form only appears for `mySide`, and
 * only when `onSubmitBallot` is actually wired up (SeasonHub's live review, not the read-only
 * archived-match screen or an ad-hoc LiveMatch friendly, neither of which pass it).
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
