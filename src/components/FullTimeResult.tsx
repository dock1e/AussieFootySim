import { useMemo } from "react";
import type { MatchResult, BoxScoreLine } from "../engine/match";
import type { MatchTeam } from "../engine/team";
import type { Player } from "../types/player";
import { ratingFor, quarterlyPoints, sumTeam } from "../engine/summary";

/**
 * Full-time result screen — User Interface.md "Full-time result": score,
 * quarter-by-quarter progression, team-stat comparison bars, Best on
 * Ground, a short auto-generated recap paragraph.
 *
 * Scoped down from the full spec on purpose (see ROADMAP.md): this
 * simulator has no "my club"/save-game concept yet, so the VICTORY/DEFEAT-
 * framed recap card doesn't have a perspective to frame itself from — shown
 * neutrally instead. "Best on Ground" uses a simple placeholder composite
 * (disposals + 2*marks + 2*tackles + 2*clearances + 0.5*hitouts + 6*goals),
 * not the real SimAFL Rating from Player Ratings.md, which needs the
 * zone/state-of-game multiplier plumbing that's a separate future pass.
 */

const STAT_ROWS: { key: keyof BoxScoreLine; label: string }[] = [
  { key: "disposals", label: "Disposals" },
  { key: "marks", label: "Marks" },
  { key: "tackles", label: "Tackles" },
  { key: "clearances", label: "Clearances" },
  { key: "hitouts", label: "Hitouts" },
  { key: "goals", label: "Goals" },
  { key: "behinds", label: "Behinds" },
];

export function FullTimeResult({
  result,
  homeTeam,
  awayTeam,
  onNewMatch,
  closeLabel = "New match-up",
}: {
  result: MatchResult;
  homeTeam: MatchTeam;
  awayTeam: MatchTeam;
  onNewMatch: () => void;
  /** Override the footer button's label — e.g. "Back to ladder" when this is reused to view a past season result rather than an ad-hoc exhibition match. */
  closeLabel?: string;
}) {
  const homeIds = useMemo(() => new Set(homeTeam.players.map((p) => p.PlayerID)), [homeTeam]);
  const awayIds = useMemo(() => new Set(awayTeam.players.map((p) => p.PlayerID)), [awayTeam]);

  const quarters = useMemo(() => quarterlyPoints(result, homeIds, awayIds), [result, homeIds, awayIds]);

  const margin = result.home.points - result.away.points;
  const winner = margin > 0 ? homeTeam.name : margin < 0 ? awayTeam.name : null;
  const marginAbs = Math.abs(margin);

  const rated = [...homeTeam.players, ...awayTeam.players]
    .map((p) => ({ player: p, line: result.boxScore[p.PlayerID], rating: ratingFor(result.boxScore[p.PlayerID]) }))
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
                {bestOnGround.player.fname} {bestOnGround.player.lname}
              </div>
              <div className="text-sm text-slate-400">{bestOnGround.player.Team}</div>
            </div>
            <div className="grid grid-cols-4 gap-4 text-center text-sm tabular-nums">
              <Stat label="D" value={bestOnGround.line.disposals} />
              <Stat label="M" value={bestOnGround.line.marks} />
              <Stat label="T" value={bestOnGround.line.tackles} />
              <Stat label="G" value={bestOnGround.line.goals} />
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="mb-3 text-xs uppercase tracking-wide text-slate-400">
          {homeTeam.name} <span className="text-slate-600">vs</span> {awayTeam.name}
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
                  <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
                  <div className="h-full bg-info" style={{ width: `${100 - pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <TopPerformers title={`${homeTeam.name} top performers`} rows={topHome} />
        <TopPerformers title={`${awayTeam.name} top performers`} rows={topAway} />
      </div>

      <button onClick={onNewMatch} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-dark">
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
      <div className="text-sm text-slate-400">{name}</div>
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
  rows,
}: {
  title: string;
  rows: { player: Player; line: BoxScoreLine; rating: number }[];
}) {
  return (
    <div className="card">
      <div className="mb-3 text-xs uppercase tracking-wide text-slate-400">{title}</div>
      <div className="space-y-1.5 text-sm">
        {rows.map(({ player, line }, i) => (
          <div key={player.PlayerID} className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span className="w-4 text-slate-500 tabular-nums">{i + 1}</span>
              <span>
                {player.fname} {player.lname}
              </span>
            </span>
            <span className="tabular-nums text-slate-400">
              {line.disposals}d {line.marks}m {line.tackles}t {line.goals}g
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
