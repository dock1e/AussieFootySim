import { useMemo, useState, type CSSProperties } from "react";
import type { MatchResult, BoxScoreLine, MatchEvent } from "../engine/match";
import type { MatchTeam } from "../engine/team";
import { playerFullName, type Player } from "../types/player";
import type { Side } from "../engine/zones";
import { sumTeam, playerLinesByQuarter, forwardEntryOriginThirds } from "../engine/summary";
import { computeAussieFootySimRatings, fantasyPointsFor } from "../engine/ratings";
import { isValidBallot, VOTE_VALUES, type CoachesVoteAllocation, type MatchCoachesVotes } from "../engine/coachesVotes";
import { bestSingleGameFor } from "../engine/benchmarking";
import { seasonPlayerTotals, toAverageMap } from "../engine/seasonSummary";
import { useSaveStore } from "../store/useSaveStore";
import { useSeasonStore } from "../store/useSeasonStore";
import { usePlayerProfileStore } from "../store/usePlayerProfileStore";
import type { MatchStory, MatchStoryTag } from "../store/useMatchStoryStore";
import { PlayerMatchDrawer } from "./PlayerMatchDrawer";
import { baselineFpAverage } from "./matchday/LiveWidgets";
import {
  BARLOW,
  CARD_BG,
  CARD_BORDER,
  COND,
  FALL,
  HERO_BG,
  MONO,
  RISE,
  Stripe,
  TeamChip,
  WARN,
  clubAbbr,
  clubVarsByName,
  eventClock,
  outlineButton,
  plural,
  primaryButton,
  quarterGoalsBehinds,
  sectionLabelStyle,
} from "./matchday/shared";

/**
 * Full time — Match Day v2 (`match-day-v2/02-implementation-spec.md` §3, visual source of truth
 * `Match Day v2.dc.html` "Full time"). Also rendered for past matches by SeasonHub and the Dashboard's
 * last-game modal: those callers don't pass `onContinue`/`onReplay`, so they get their own close
 * button in the hero instead, and the "From this game" feed is shown but not published anywhere.
 *
 * Reads from the coached club's side when `myClub` is one of the two teams (critique D3); otherwise
 * (an AI-vs-AI match) it stays neutral and reads from the home side. Every number is engine data: the
 * quarter table and worm from the event log, best on ground from the AussieFootySim rating, votes from
 * the match's coaches' ballots, the feed from this game's box score against the save's own history.
 */

interface RatedRow {
  player: Player;
  side: Side;
  line: BoxScoreLine;
  rating: number;
  fantasyPoints: number;
}

type ReviewTab = "player-stats" | "by-quarter" | "team-totals" | "play-by-play";

const REVIEW_TABS: { key: ReviewTab; label: string }[] = [
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
  { key: "freeKicksFor", label: "Free kicks" },
  { key: "goals", label: "Goals" },
  { key: "behinds", label: "Behinds" },
];

const PLAYER_STATS_COLUMNS: { key: keyof BoxScoreLine; label: string; title: string }[] = [
  { key: "kicks", label: "K", title: "Kicks" },
  { key: "handballs", label: "HB", title: "Handballs" },
  { key: "disposals", label: "D", title: "Disposals" },
  { key: "marks", label: "M", title: "Marks" },
  { key: "tackles", label: "T", title: "Tackles" },
  { key: "clearances", label: "CLR", title: "Clearances" },
  { key: "goals", label: "G", title: "Goals" },
];

const RTG_TITLE = "AussieFootySim rating: an event-weighted match rating that adjusts each action for where on the ground and when in the game it happened.";

const IS_DEV = import.meta.env.DEV;
const card: CSSProperties = { background: CARD_BG, border: CARD_BORDER, borderRadius: 14 };

/** Critique D4: pluralised, zeros left out, standout stat first. */
export function statLine(line: BoxScoreLine): string {
  const parts: { v: number; text: string; weight: number }[] = [
    { v: line.disposals, text: plural(line.disposals, "disposal"), weight: line.disposals / 25 },
    { v: line.goals, text: plural(line.goals, "goal"), weight: line.goals / 3 },
    { v: line.marks, text: plural(line.marks, "mark"), weight: line.marks / 8 },
    { v: line.tackles, text: plural(line.tackles, "tackle"), weight: line.tackles / 7 },
    { v: line.hitouts, text: plural(line.hitouts, "hitout"), weight: line.hitouts / 30 },
    { v: line.clearances, text: plural(line.clearances, "clearance"), weight: line.clearances / 7 },
  ].filter((p) => p.v > 0);
  parts.sort((a, b) => b.weight - a.weight);
  return parts
    .slice(0, 3)
    .map((p) => p.text)
    .join(" · ");
}

function ordinalQuarter(q: number): string {
  return q === 1 ? "first" : q === 2 ? "second" : q === 3 ? "third" : "last";
}

export function FullTimeResult({
  result,
  homeTeam,
  awayTeam,
  onNewMatch,
  closeLabel = "New match-up",
  coachesVotes,
  myClub,
  onSubmitBallot,
  venueName,
  onContinue,
  onReplay,
}: {
  result: MatchResult;
  homeTeam: MatchTeam;
  awayTeam: MatchTeam;
  /** Close/back action for callers that host this screen (SeasonHub, Dashboard); a dev-only "New match-up" on Match Day. */
  onNewMatch: () => void;
  closeLabel?: string;
  coachesVotes?: MatchCoachesVotes;
  /** The coach's own club name — decides whose perspective the result reads from, and who gets a submit-your-ballot option. */
  myClub?: string;
  onSubmitBallot?: (side: "home" | "away", allocations: CoachesVoteAllocation[]) => void;
  venueName?: string;
  /** Match Day v2 primary action. Receives the "From this game" items so the caller can send them to the Dashboard. */
  onContinue?: (stories: MatchStory[]) => void;
  onReplay?: () => void;
}) {
  const [tab, setTab] = useState<ReviewTab>("player-stats");
  const [teamFilter, setTeamFilter] = useState<"home" | "away" | "both">("both");
  const [selectedPlayer, setSelectedPlayer] = useState<{ player: Player; side: Side } | null>(null);

  const homeIds = useMemo(() => new Set(homeTeam.players.map((p) => p.PlayerID)), [homeTeam]);
  const awayIds = useMemo(() => new Set(awayTeam.players.map((p) => p.PlayerID)), [awayTeam]);
  const simRatings = useMemo(() => computeAussieFootySimRatings(result, homeTeam, awayTeam), [result, homeTeam, awayTeam]);

  const mySide: Side | null = homeTeam.name === myClub ? "home" : awayTeam.name === myClub ? "away" : null;
  const ourSide: Side = mySide ?? "home";
  const ourTeam = ourSide === "home" ? homeTeam : awayTeam;
  const theirTeam = ourSide === "home" ? awayTeam : homeTeam;
  const ourPts = ourSide === "home" ? result.home.points : result.away.points;
  const theirPts = ourSide === "home" ? result.away.points : result.home.points;
  const margin = ourPts - theirPts;

  const rated: RatedRow[] = useMemo(() => {
    const withSide: { player: Player; side: Side }[] = [
      ...homeTeam.players.map((player) => ({ player, side: "home" as Side })),
      ...awayTeam.players.map((player) => ({ player, side: "away" as Side })),
    ];
    return withSide
      .filter(({ player }) => !!result.boxScore[player.PlayerID])
      .map(({ player, side }) => ({
        player,
        side,
        line: result.boxScore[player.PlayerID],
        rating: simRatings[player.PlayerID]?.rating ?? 0,
        fantasyPoints: fantasyPointsFor(result.boxScore[player.PlayerID]),
      }))
      .sort((a, b) => b.rating - a.rating);
  }, [homeTeam, awayTeam, result, simRatings]);

  const filteredRated = teamFilter === "both" ? rated : rated.filter((r) => r.side === teamFilter);
  const bestOnGround = rated[0];

  // --- Quarter table + summary ----------------------------------------------------------------------
  const gb = useMemo(() => quarterGoalsBehinds(result.events, homeIds, awayIds), [result.events, homeIds, awayIds]);
  const ourGB = (i: number) => (gb[i] ? (ourSide === "home" ? { g: gb[i].hg, b: gb[i].hb } : { g: gb[i].ag, b: gb[i].ab }) : null);
  const theirGB = (i: number) => (gb[i] ? (ourSide === "home" ? { g: gb[i].ag, b: gb[i].ab } : { g: gb[i].hg, b: gb[i].hb }) : null);
  const breakMargin = (i: number) => {
    const o = ourGB(i);
    const t = theirGB(i);
    return o && t ? o.g * 6 + o.b - (t.g * 6 + t.b) : 0;
  };

  const venue = venueName ? ` at the ${venueName.replace(/^The /, "")}` : "";
  const pts = plural(Math.abs(margin), "point");
  const headline = mySide
    ? margin === 0
      ? `All square${venue}`
      : margin > 0
        ? margin <= 6
          ? `Held on by ${pts}${venue}`
          : margin <= 24
            ? `${clubAbbr(ourTeam.name)} win by ${pts}`
            : `Too strong by ${pts}`
        : -margin <= 6
          ? `Pipped by ${pts}${venue}`
          : -margin <= 24
            ? `Beaten by ${pts}`
            : `Outclassed by ${pts}`
    : margin === 0
      ? "A draw"
      : `${margin > 0 ? ourTeam.name : theirTeam.name} by ${pts}`;

  const summary = useMemo(() => {
    if (gb.length < 4) return "";
    // The quarter with the biggest swing toward the eventual winner (or the last quarter in a draw).
    const isolated = [0, 1, 2, 3].map((i) => breakMargin(i) - (i > 0 ? breakMargin(i - 1) : 0));
    const winnerIsUs = margin > 0;
    const decisive = margin === 0 ? 3 : isolated.reduce((best, v, i) => ((winnerIsUs ? v : -v) > (winnerIsUs ? isolated[best] : -isolated[best]) ? i : best), 0);
    const oq = ourGB(decisive)!;
    const tq = theirGB(decisive)!;
    const oPrev = decisive > 0 ? ourGB(decisive - 1)! : { g: 0, b: 0 };
    const tPrev = decisive > 0 ? theirGB(decisive - 1)! : { g: 0, b: 0 };
    const ourQ = `${oq.g - oPrev.g}.${oq.b - oPrev.b}`;
    const theirQ = `${tq.g - tPrev.g}.${tq.b - tPrev.b}`;
    const we = mySide ? "our" : `${ourTeam.name}'s`;
    const s1 =
      margin === 0
        ? `${theirTeam.name} kicked ${theirQ} to ${we} ${ourQ} in the last quarter to level it.`
        : winnerIsUs
          ? `${mySide ? "We" : ourTeam.name} kicked ${ourQ} to ${theirTeam.name}'s ${theirQ} in the ${ordinalQuarter(decisive)} quarter${decisive === 3 && breakMargin(2) <= 0 ? " to steal it" : ""}.`
          : `${theirTeam.name} kicked ${theirQ} to ${we} ${ourQ} in the ${ordinalQuarter(decisive)} quarter${decisive === 3 && breakMargin(2) >= 0 ? " to steal it" : ""}.`;
    const phrase = (m: number, when: string) => (m === 0 ? `level at ${when}` : mySide ? `${m > 0 ? "up" : "down"} ${Math.abs(m)} at ${when}` : `${m > 0 ? ourTeam.name : theirTeam.name} by ${Math.abs(m)} at ${when}`);
    const s2 = `${phrase(breakMargin(1), "half time")}, ${phrase(breakMargin(2), "the final change")}.`;
    return `${s1} ${s2[0].toUpperCase()}${s2.slice(1)}`;
  }, [gb, margin, mySide, ourTeam, theirTeam]); // eslint-disable-line react-hooks/exhaustive-deps

  const resultChip = !mySide
    ? { text: margin === 0 ? "DRAW" : `${clubAbbr(margin > 0 ? ourTeam.name : theirTeam.name)} WIN · BY ${plural(Math.abs(margin), "POINT").toUpperCase()}`, color: "#10151f", bg: "#c3ccdd" }
    : margin > 0
      ? { text: `WIN · BY ${plural(margin, "POINT").toUpperCase()}`, color: "#0b2a1c", bg: RISE }
      : margin < 0
        ? { text: `LOSS · BY ${plural(-margin, "POINT").toUpperCase()}`, color: "#2a120a", bg: FALL }
        : { text: "DRAW", color: "#2a1c00", bg: WARN };

  // --- From this game (critique D6) -----------------------------------------------------------------
  const seasonArchives = useSaveStore((s) => s.seasonArchives);
  const year = useSaveStore((s) => s.year);
  const watchlist = useSaveStore((s) => s.watchlist);
  const season = useSeasonStore((s) => s.season);
  const stories = useMemo((): MatchStory[] => {
    if (!mySide) return [];
    const avgMap = season ? toAverageMap(seasonPlayerTotals(season)) : new Map();
    const avgOf = (p: Player) => {
      const inSave = avgMap.get(p.PlayerID)?.fantasyPoints;
      return inSave && inSave > 0 ? inSave : baselineFpAverage(p);
    };
    const out: MatchStory[] = [];
    const ours = rated.filter((r) => r.side === ourSide);
    const BEST_STATS: { key: "disposals" | "goals" | "marks" | "tackles" | "hitouts" | "clearances"; noun: string; min: number }[] = [
      { key: "disposals", noun: "disposal", min: 15 },
      { key: "goals", noun: "goal", min: 3 },
      { key: "marks", noun: "mark", min: 7 },
      { key: "tackles", noun: "tackle", min: 6 },
      { key: "clearances", noun: "clearance", min: 6 },
      { key: "hitouts", noun: "hitout", min: 20 },
    ];
    for (const r of ours) {
      for (const s of BEST_STATS) {
        const v = r.line[s.key];
        if (v < s.min) continue;
        const prev = bestSingleGameFor(r.player.PlayerID, s.key, seasonArchives, season, year);
        if (!prev || v <= prev.value) continue;
        out.push({
          tag: "CAREER BEST",
          playerId: r.player.PlayerID,
          text: `${playerFullName(r.player)} had ${plural(v, s.noun)}, his best in this save`,
          sub: `Previous best was ${prev.value}, against ${prev.opponent}.`,
        });
        break;
      }
    }
    for (const r of ours) {
      if (r.player.Age > 23) continue;
      const avg = avgOf(r.player);
      if (r.fantasyPoints < 40 || r.fantasyPoints < avg * 1.25) continue;
      out.push({
        tag: "DEVELOPMENT",
        playerId: r.player.PlayerID,
        text: `${playerFullName(r.player)} (${r.player.Age}): ${r.fantasyPoints} FP`,
        sub: `${Math.round(r.fantasyPoints - avg)} above his average. ${statLine(r.line) || "Quiet on the stats sheet otherwise"}.`,
      });
    }
    for (const id of watchlist) {
      const r = ours.find((x) => x.player.PlayerID === id);
      if (!r) continue;
      const diff = Math.round(r.fantasyPoints - avgOf(r.player));
      out.push({
        tag: "WATCHLIST",
        playerId: id,
        text: `${playerFullName(r.player)} ${diff >= 0 ? "had" : "managed"} ${r.fantasyPoints} FP`,
        sub: `${diff === 0 ? "Right on" : `${Math.abs(diff)} ${diff > 0 ? "above" : "below"}`} his average. ${statLine(r.line) || "No disposals, marks or tackles"}.`,
      });
    }
    const order: MatchStoryTag[] = ["MILESTONE", "CAREER BEST", "DEVELOPMENT", "WATCHLIST", "INJURY"];
    return out.sort((a, b) => order.indexOf(a.tag) - order.indexOf(b.tag)).slice(0, 6);
  }, [mySide, rated, ourSide, seasonArchives, season, year, watchlist]);

  // --- Totals, votes, performers ---------------------------------------------------------------------
  const ourIds = ourSide === "home" ? homeIds : awayIds;
  const theirIds = ourSide === "home" ? awayIds : homeIds;
  const theirSide: Side = ourSide === "home" ? "away" : "home";
  const ourTotals = sumTeam(result.boxScore, ourIds);
  const theirTotals = sumTeam(result.boxScore, theirIds);
  const inside50s = (side: Side) => [1, 2, 3, 4].reduce((sum, q) => sum + forwardEntryOriginThirds(result.events, q, side).total, 0);
  const totals: { label: string; h: number; a: number }[] = [
    { label: "Disposals", h: ourTotals.disposals, a: theirTotals.disposals },
    { label: "Contested possessions", h: ourTotals.contestedPoss, a: theirTotals.contestedPoss },
    { label: "Clearances", h: ourTotals.clearances, a: theirTotals.clearances },
    { label: "Inside 50s", h: inside50s(ourSide), a: inside50s(theirSide) },
    { label: "Marks inside 50", h: ourTotals.marksInside50, a: theirTotals.marksInside50 },
    { label: "Tackles", h: ourTotals.tackles, a: theirTotals.tackles },
    { label: "Hitouts", h: ourTotals.hitouts, a: theirTotals.hitouts },
    { label: "Scoring shots", h: ourTotals.goals + ourTotals.behinds, a: theirTotals.goals + theirTotals.behinds },
  ];

  const votes = useMemo(() => {
    if (!coachesVotes) return [];
    const byId = new Map<number, number>();
    for (const a of [...coachesVotes.homeCoachBallot, ...coachesVotes.awayCoachBallot]) byId.set(a.playerId, (byId.get(a.playerId) ?? 0) + a.votes);
    return [...byId.entries()]
      .map(([id, v]) => ({ row: rated.find((r) => r.player.PlayerID === id), v }))
      .filter((x): x is { row: RatedRow; v: number } => !!x.row)
      .sort((a, b) => b.v - a.v)
      .slice(0, 6);
  }, [coachesVotes, rated]);

  function openDrawer(player: Player, side: Side) {
    setSelectedPlayer({ player, side });
  }

  const winnerSide: Side | null = result.home.points === result.away.points ? null : result.home.points > result.away.points ? "home" : "away";

  return (
    <div className="flex flex-col gap-3">
      {/* Hero (critique D3): result chip from your side, club stripe, no gold border, no seed. */}
      <section data-screen-label="Full time hero" style={{ position: "relative", overflow: "hidden", background: HERO_BG, border: "1px solid color-mix(in oklch, var(--acc) 30%, transparent)", borderRadius: 16 }}>
        <Stripe />
        <div style={{ padding: "20px 22px", display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: "1.2 1 300px", minWidth: 0 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ font: `700 11px ${MONO}`, letterSpacing: "1.2px", padding: "4px 8px", borderRadius: 5, color: resultChip.color, background: resultChip.bg }}>{resultChip.text}</span>
              <span style={{ ...sectionLabelStyle(), color: "#aab3c3" }}>FULL TIME{venueName ? ` · ${venueName.toUpperCase()}` : ""}</span>
            </div>
            <h1 style={{ margin: "10px 0 4px", font: `700 40px/1 ${COND}`, color: "#fff", textWrap: "balance" } as CSSProperties}>{headline}</h1>
            {summary && <div style={{ font: `500 14px/1.45 ${BARLOW}`, color: "#c3ccdd" }}>{summary}</div>}
          </div>
          <div style={{ flex: "1.4 1 380px", minWidth: 0, display: "grid", gridTemplateColumns: "minmax(110px,1fr) repeat(4,48px) 64px", gap: 8, alignItems: "center", font: `500 13px ${MONO}`, color: "#aab3c3", textAlign: "center" }}>
            <span />
            {["QT", "HT", "3QT", "FT"].map((l) => (
              <span key={l} style={{ fontSize: 10, color: "#8f9ab0" }}>
                {l}
              </span>
            ))}
            <span />
            {(["home", "away"] as Side[]).map((side) => {
              const team = side === "home" ? homeTeam : awayTeam;
              const win = winnerSide === null || winnerSide === side;
              const final = side === "home" ? result.home.points : result.away.points;
              return (
                <FragmentRow key={side}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8, textAlign: "left", minWidth: 0 }}>
                    <TeamChip name={team.name} />
                    <span style={{ font: `${win ? 700 : 500} 15px ${BARLOW}`, color: win ? "#fff" : "#8f9ab0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{team.name}</span>
                  </span>
                  {[0, 1, 2, 3].map((i) => (
                    <span key={i} style={{ font: `500 13px ${MONO}`, color: win ? "#dfe5ee" : "#8f9ab0" }}>
                      {gb[i] ? (side === "home" ? `${gb[i].hg}.${gb[i].hb}` : `${gb[i].ag}.${gb[i].ab}`) : "–"}
                    </span>
                  ))}
                  <span style={{ textAlign: "right", font: `700 34px/1 ${COND}`, color: win ? "#fff" : "#8f9ab0" }}>{final}</span>
                </FragmentRow>
              );
            })}
          </div>
          <div style={{ flex: "0 1 200px", display: "flex", flexDirection: "column", gap: 8 }}>
            {onContinue ? (
              <button onClick={() => onContinue(stories)} style={{ ...primaryButton, padding: "12px 16px" }}>
                Continue
              </button>
            ) : (
              <button onClick={onNewMatch} style={{ ...primaryButton, padding: "12px 16px" }}>
                {closeLabel}
              </button>
            )}
            {onReplay && (
              <button onClick={onReplay} style={{ ...outlineButton, borderRadius: 9, padding: "10px 14px" }}>
                Replay from Q1
              </button>
            )}
            {onContinue && IS_DEV && (
              <button onClick={onNewMatch} style={{ background: "none", border: 0, color: "#5d6880", font: `500 11px ${MONO}`, cursor: "pointer" }}>
                New match-up · dev
              </button>
            )}
          </div>
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: 12, alignItems: "start" }}>
        <MarginWorm result={result} homeIds={homeIds} ourSide={ourSide} ourName={ourTeam.name} theirName={theirTeam.name} />
        <section data-screen-label="Votes" style={{ ...card, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={sectionLabelStyle()}>BEST ON GROUND · COACHES' VOTES</div>
          {bestOnGround && (
            <button onClick={() => openDrawer(bestOnGround.player, bestOnGround.side)} style={{ ...clubVarsByName(bestOnGround.player.Team), textAlign: "left", background: "none", border: 0, padding: 0, cursor: "pointer" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, padding: 12, borderRadius: 10, background: "rgba(0,0,0,.22)", border: "1px solid rgba(255,255,255,.08)" }}>
                <div style={{ width: 48, height: 48, flex: "none", borderRadius: 10, background: "var(--deep)", border: "1px solid color-mix(in oklch, var(--acc) 55%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", font: `700 20px ${COND}`, color: "var(--accT)" }}>
                  {bestOnGround.player.jumperNumber}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ font: `700 22px/1.1 ${COND}`, color: "#fff" }}>{playerFullName(bestOnGround.player)}</div>
                  <div style={{ font: `500 12px ${BARLOW}`, color: "#aab3c3" }}>
                    {[statLine(bestOnGround.line), bestOnGround.player.Team].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ font: `700 28px/1 ${COND}`, color: "#fff" }}>{bestOnGround.fantasyPoints}</div>
                  <div style={{ font: `600 9px ${MONO}`, letterSpacing: ".8px", color: "#8f9ab0" }}>FP</div>
                </div>
              </div>
            </button>
          )}
          {votes.length === 0 && <div style={{ font: `500 13px ${BARLOW}`, color: "#8f9ab0" }}>No coaches' votes were recorded for this match.</div>}
          {votes.map(({ row, v }) => {
            const ours = row.side === ourSide && !!mySide;
            return (
              <button
                key={row.player.PlayerID}
                onClick={() => openDrawer(row.player, row.side)}
                style={{ display: "grid", gridTemplateColumns: "44px minmax(0,1fr) 110px 24px", gap: 10, alignItems: "center", background: "none", border: 0, padding: 0, cursor: "pointer", textAlign: "left" }}
              >
                <TeamChip name={row.player.Team} />
                <span style={{ font: `600 14px ${BARLOW}`, color: ours ? "var(--accT)" : "#eef2f8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{playerFullName(row.player)}</span>
                <span style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,.07)", overflow: "hidden" }}>
                  <span style={{ display: "block", height: "100%", width: `${(v / 10) * 100}%`, background: ours ? "var(--acc)" : "rgba(223,227,234,.6)" }} />
                </span>
                <span style={{ textAlign: "right", font: `700 14px ${MONO}`, color: "#fff" }}>{v}</span>
              </button>
            );
          })}
          {coachesVotes && myClub && onSubmitBallot && <BallotEditor votes={coachesVotes} homeTeam={homeTeam} awayTeam={awayTeam} myClub={myClub} onSubmitBallot={onSubmitBallot} />}
        </section>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: 12, alignItems: "start" }}>
        <section data-screen-label="Your stories" style={{ ...card, padding: "14px 16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 4 }}>
            <span style={sectionLabelStyle(true)}>FROM THIS GAME · YOUR LIST</span>
            <span style={{ font: `500 10px ${MONO}`, color: "#8f9ab0" }}>FEEDS RECORD WATCH</span>
          </div>
          {!mySide && <div style={{ padding: "10px 0", font: `500 13px ${BARLOW}`, color: "#8f9ab0" }}>Neither side is your club, so there's nothing for your list here.</div>}
          {mySide && stories.length === 0 && <div style={{ padding: "10px 0", font: `500 13px ${BARLOW}`, color: "#8f9ab0" }}>No career bests, breakout games or watchlist news from this one.</div>}
          {stories.map((s, i) => (
            <button
              key={i}
              onClick={() => usePlayerProfileStore.getState().openPlayer(s.playerId)}
              style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 0", borderTop: "1px solid rgba(255,255,255,.06)", width: "100%", background: "none", borderLeft: 0, borderRight: 0, borderBottom: 0, cursor: "pointer", textAlign: "left" }}
            >
              <span style={{ flex: "none", minWidth: 92, font: `600 10px ${MONO}`, letterSpacing: "1px", color: STORY_TAG_COLOR[s.tag], paddingTop: 3 }}>{s.tag}</span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", font: `600 15px/1.35 ${BARLOW}`, color: "#eef2f8" }}>{s.text}</span>
                <span style={{ display: "block", font: `400 13px/1.4 ${BARLOW}`, color: "#9aa4b5", marginTop: 2 }}>{s.sub}</span>
              </span>
            </button>
          ))}
        </section>
        <section data-screen-label="Team totals" style={{ ...card, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", ...sectionLabelStyle() }}>
            <span>TEAM TOTALS</span>
            <span>
              <span style={{ color: "var(--accT)" }}>{clubAbbr(ourTeam.name)}</span> · {clubAbbr(theirTeam.name)}
            </span>
          </div>
          {totals.map((d) => {
            const total = d.h + d.a;
            return (
              <div key={d.label} style={{ display: "grid", gridTemplateColumns: "44px minmax(0,1fr) 44px", gap: 10, alignItems: "center" }}>
                <span style={{ font: `600 14px ${MONO}`, color: d.h > d.a ? "#fff" : "#aab3c3" }}>{d.h}</span>
                <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ font: `500 11px ${BARLOW}`, color: "#aab3c3", textAlign: "center" }}>{d.label}</span>
                  <span style={{ display: "flex", height: 5, borderRadius: 3, overflow: "hidden", gap: 2 }}>
                    <span style={{ width: `${total ? (d.h / total) * 100 : 50}%`, background: "var(--acc)" }} />
                    <span style={{ flex: 1, background: "#dfe3ea", opacity: 0.55 }} />
                  </span>
                </span>
                <span style={{ textAlign: "right", font: `600 14px ${MONO}`, color: d.a > d.h ? "#fff" : "#aab3c3" }}>{d.a}</span>
              </div>
            );
          })}
        </section>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 520px), 1fr))", gap: 12, alignItems: "start" }}>
        {[ourSide, theirSide].map((side) => (
          <TopPerformers key={side} team={side === "home" ? homeTeam : awayTeam} rows={rated.filter((r) => r.side === side)} ours={side === ourSide && !!mySide} onOpen={openDrawer} />
        ))}
      </div>

      {/* The deeper tabs, kept and restyled (spec §3.5): active tab is an --acc pill. */}
      <section style={{ ...card, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1">
            {REVIEW_TABS.map((t) => {
              const on = tab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  style={{ borderRadius: 999, padding: "6px 12px", border: 0, cursor: "pointer", background: on ? "var(--acc)" : "rgba(255,255,255,.05)", color: on ? "var(--on)" : "#c3ccdd", font: `${on ? 700 : 600} 12px ${BARLOW}` }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          {(tab === "player-stats" || tab === "by-quarter") && (
            <div style={{ display: "flex", gap: 2, padding: 2, borderRadius: 8, background: "rgba(0,0,0,.25)" }}>
              {(["home", "away", "both"] as const).map((f) => {
                const on = teamFilter === f;
                return (
                  <button key={f} onClick={() => setTeamFilter(f)} style={{ border: 0, borderRadius: 6, padding: "5px 10px", cursor: "pointer", background: on ? "var(--acc)" : "transparent", color: on ? "var(--on)" : "#aab3c3", font: `600 12px ${BARLOW}` }}>
                    {f === "both" ? "Both" : clubAbbr(f === "home" ? homeTeam.name : awayTeam.name)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div style={{ maxHeight: 560, overflowY: "auto" }}>
          {tab === "player-stats" && <PlayerStatsTable rows={filteredRated} onOpen={openDrawer} />}
          {tab === "by-quarter" && <ByQuarterTable rows={filteredRated} events={result.events} onOpen={openDrawer} />}
          {tab === "team-totals" && <TeamTotalsContent homeTeam={homeTeam} awayTeam={awayTeam} homeIds={homeIds} awayIds={awayIds} boxScore={result.boxScore} onOpen={openDrawer} />}
          {tab === "play-by-play" && <PlayByPlayList events={result.events} ticksPerQuarter={result.ticksPerQuarter} homeIds={homeIds} homeTeam={homeTeam} awayTeam={awayTeam} />}
        </div>
      </section>

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

const STORY_TAG_COLOR: Record<MatchStoryTag, string> = {
  MILESTONE: "var(--accT)",
  "CAREER BEST": "var(--accT)",
  DEVELOPMENT: RISE,
  WATCHLIST: "#b3bccb",
  INJURY: WARN,
};

/** Grid children without a wrapper element (the quarter table is one CSS grid). */
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

// --- Margin worm (critiques D1, D2) ----------------------------------------------------------------

function MarginWorm({ result, homeIds, ourSide, ourName, theirName }: { result: MatchResult; homeIds: Set<number>; ourSide: Side; ourName: string; theirName: string }) {
  const T = result.ticksPerQuarter * 4;
  const points: { t: number; m: number; q: number }[] = [{ t: 0, m: 0, q: 1 }];
  const atBreak: number[] = [0, 0, 0, 0];
  let m = 0;
  for (const ev of result.events) {
    for (const d of ev.statDeltas) {
      if (d.stat !== "goals" && d.stat !== "behinds") continue;
      const pts = (d.stat === "goals" ? 6 : 1) * d.delta;
      const forUs = homeIds.has(d.playerId) === (ourSide === "home");
      m += forUs ? pts : -pts;
      points.push({ t: ev.tick, m, q: ev.quarter });
    }
    atBreak[ev.quarter - 1] = m;
  }
  for (let q = 1; q < 4; q++) if (!result.events.some((e) => e.quarter === q + 1)) atBreak[q] = atBreak[q - 1];
  points.push({ t: T, m, q: 4 });

  const maxAbs = Math.max(6, ...points.map((p) => Math.abs(p.m)));
  const fx = (t: number) => 40 + (Math.min(t, T) / T) * 740;
  const fy = (v: number) => 120 - (v / maxAbs) * 100;
  // Step shape: the margin holds until the next score.
  const stepped: string[] = [];
  points.forEach((p, i) => {
    if (i > 0) stepped.push(`${fx(p.t).toFixed(1)},${fy(points[i - 1].m).toFixed(1)}`);
    stepped.push(`${fx(p.t).toFixed(1)},${fy(p.m).toFixed(1)}`);
  });
  const line = stepped.join(" ");
  const area = `${fx(0)},120 ${line} ${fx(T)},120`;

  const ours = clubAbbr(ourName);
  const theirs = clubAbbr(theirName);
  const label = (v: number) => (v > 0 ? `${ours} +${v}` : v < 0 ? `${theirs} +${-v}` : "Level");
  const breaks = [
    { q: 1, l: "QT" },
    { q: 2, l: "HT" },
    { q: 3, l: "3QT" },
    { q: 4, l: "FT" },
  ].map((b) => ({ ...b, x: fx((b.q * T) / 4), v: atBreak[b.q - 1] }));

  const peak = (sign: 1 | -1) => {
    let best = 0;
    let qs: number[] = [];
    for (const p of points) {
      const v = p.m * sign;
      if (v > best) {
        best = v;
        qs = [p.q];
      } else if (v === best && best > 0 && !qs.includes(p.q)) qs.push(p.q);
    }
    return best > 0 ? `${sign > 0 ? ours : theirs} +${best} (${qs.map((q) => `Q${q}`).join(", ")})` : null;
  };
  const leads = [peak(1), peak(-1)].filter(Boolean).join(" · ");

  const overlay = (x: number, y: number, _text: string, color: string, transform: string, weight = 500): CSSProperties & { key?: string } => ({
    position: "absolute",
    left: `${(x / 800) * 100}%`,
    top: `${(y / 250) * 100}%`,
    transform,
    font: `${weight} max(9px, 1.375cqw) 'IBM Plex Mono', monospace`,
    color,
    whiteSpace: "nowrap",
    lineHeight: 1,
  });

  return (
    <section data-screen-label="Margin worm" style={{ ...card, padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
        <span style={sectionLabelStyle()}>MARGIN · WHOLE GAME</span>
        <span style={{ font: `500 11px ${MONO}`, color: "#aab3c3" }}>{leads ? `Biggest lead: ${leads}` : "Never more than a point in it"}</span>
      </div>
      <div style={{ position: "relative", containerType: "inline-size" } as CSSProperties}>
        <svg viewBox="0 0 800 250" style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label={`Margin through the game, ${ours} above the line, ${theirs} below`}>
          <defs>
            <clipPath id="ftw-top">
              <rect x="0" y="0" width="800" height="120" />
            </clipPath>
            <clipPath id="ftw-bot">
              <rect x="0" y="120" width="800" height="130" />
            </clipPath>
          </defs>
          {breaks.map((b) => (
            <line key={b.l} x1={b.x} x2={b.x} y1={12} y2={228} style={{ stroke: "rgba(255,255,255,.08)", strokeDasharray: "3 4" }} />
          ))}
          <line x1={40} x2={780} y1={120} y2={120} style={{ stroke: "rgba(255,255,255,.25)" }} />
          <polygon points={area} clipPath="url(#ftw-top)" style={{ fill: "color-mix(in oklch, var(--acc) 35%, transparent)" }} />
          <polygon points={area} clipPath="url(#ftw-bot)" style={{ fill: "rgba(223,227,234,.22)" }} />
          <polyline points={line} style={{ fill: "none", stroke: "#eef2f8", strokeWidth: 2, strokeLinejoin: "round" }} />
          {breaks.map((b) => (
            <circle key={b.l} cx={b.x} cy={fy(b.v)} r={4} style={{ fill: "#10151f", stroke: "#fff", strokeWidth: 2 }} />
          ))}
        </svg>
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          <span style={overlay(34, 124, "0", "#8f9ab0", "translate(-100%,-50%)")}>0</span>
          <span style={overlay(34, 20, ours, "var(--accT)", "translate(-100%,-50%)")}>{ours}</span>
          <span style={overlay(34, 220, theirs, "#dfe3ea", "translate(-100%,-50%)")}>{theirs}</span>
          {breaks.map((b) => {
            const anchor = b.q === 4 ? "translate(-100%,-50%)" : "translate(-50%,-50%)";
            const y = fy(b.v);
            return (
              <span key={b.l}>
                <span style={overlay(b.x, 240, b.l, "#8f9ab0", anchor)}>{b.l}</span>
                <span style={overlay(b.x, b.v >= 0 ? y - 14 : y + 16, label(b.v), "#fff", anchor, 600)}>{label(b.v)}</span>
              </span>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// --- Top performers (critique D5) -------------------------------------------------------------------

function TopPerformers({ team, rows, ours, onOpen }: { team: MatchTeam; rows: RatedRow[]; ours: boolean; onOpen: (player: Player, side: Side) => void }) {
  const [all, setAll] = useState(false);
  const sorted = [...rows].sort((a, b) => b.fantasyPoints - a.fantasyPoints);
  const shown = all ? sorted : sorted.slice(0, 6);
  const grid = "22px minmax(0,1fr) repeat(5,34px) 40px 40px";
  return (
    <section style={{ ...card, padding: "12px 6px 8px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 10px 8px" }}>
        <TeamChip name={team.name} />
        <span style={sectionLabelStyle()}>TOP PERFORMERS</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: grid, gap: 6, padding: "0 10px", height: 26, alignItems: "center", font: `600 9px ${MONO}`, letterSpacing: ".7px", color: "#8f9ab0", borderBottom: "1px solid rgba(255,255,255,.08)" }}>
        <span>#</span>
        <span>PLAYER</span>
        <span style={{ textAlign: "right" }}>D</span>
        <span style={{ textAlign: "right" }}>M</span>
        <span style={{ textAlign: "right" }}>T</span>
        <span style={{ textAlign: "right" }}>G</span>
        <span style={{ textAlign: "right" }}>HO</span>
        <span style={{ textAlign: "right", color: "var(--accT)" }}>FP ▾</span>
        <span style={{ textAlign: "right", cursor: "help" }} title={RTG_TITLE}>
          RTG
        </span>
      </div>
      {shown.map((r, i) => (
        <div
          key={r.player.PlayerID}
          role="button"
          tabIndex={0}
          onClick={() => onOpen(r.player, r.side)}
          onKeyDown={(e) => e.key === "Enter" && onOpen(r.player, r.side)}
          style={{ display: "grid", gridTemplateColumns: grid, gap: 6, padding: "0 10px", height: 34, alignItems: "center", borderBottom: "1px solid rgba(255,255,255,.04)", font: `400 13px ${MONO}`, color: "#c3ccdd", fontVariantNumeric: "tabular-nums", cursor: "pointer" }}
        >
          <span style={{ color: "#8f9ab0", fontSize: 11 }}>{i + 1}</span>
          <span style={{ font: `600 14px ${BARLOW}`, color: ours ? "#fff" : "#eef2f8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{playerFullName(r.player)}</span>
          <span style={{ textAlign: "right" }}>{r.line.disposals}</span>
          <span style={{ textAlign: "right" }}>{r.line.marks}</span>
          <span style={{ textAlign: "right" }}>{r.line.tackles}</span>
          <span style={{ textAlign: "right" }}>{r.line.goals}</span>
          <span style={{ textAlign: "right" }}>{r.line.hitouts}</span>
          <span style={{ textAlign: "right", color: "#fff", fontWeight: 600 }}>{r.fantasyPoints}</span>
          <span style={{ textAlign: "right" }} title={RTG_TITLE}>
            {r.rating.toFixed(0)}
          </span>
        </div>
      ))}
      {sorted.length > 6 && (
        <button onClick={() => setAll((a) => !a)} style={{ margin: "6px 10px 0", background: "none", border: 0, padding: "4px 0", cursor: "pointer", font: `600 12px ${BARLOW}`, color: "var(--accT)" }}>
          {all ? "Show top 6" : `Show all ${sorted.length}`}
        </button>
      )}
    </section>
  );
}

// --- Deeper tabs ------------------------------------------------------------------------------------

const TH: CSSProperties = { padding: "8px 6px", font: `600 9px ${MONO}`, letterSpacing: ".7px", color: "#8f9ab0", borderBottom: "1px solid rgba(255,255,255,.08)", textAlign: "center", position: "sticky", top: 0, background: CARD_BG };
const TD: CSSProperties = { padding: "0 6px", height: 34, font: `400 13px ${MONO}`, color: "#c3ccdd", textAlign: "center", borderBottom: "1px solid rgba(255,255,255,.04)", fontVariantNumeric: "tabular-nums" };

function NameCell({ player }: { player: Player }) {
  return (
    <td style={{ ...TD, textAlign: "left" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <TeamChip name={player.Team} size={10} />
        <span style={{ font: `600 13px ${BARLOW}`, color: "#eef2f8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          #{player.jumperNumber} {playerFullName(player)}
        </span>
      </span>
    </td>
  );
}

function PlayerStatsTable({ rows, onOpen }: { rows: RatedRow[]; onOpen: (player: Player, side: Side) => void }) {
  return (
    <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
      <thead>
        <tr>
          <th style={{ ...TH, textAlign: "left" }}>PLAYER</th>
          {PLAYER_STATS_COLUMNS.map((c) => (
            <th key={c.key} style={TH} title={c.title}>
              {c.label}
            </th>
          ))}
          <th style={TH} title="Fantasy points">
            FP
          </th>
          <th style={TH} title={RTG_TITLE}>
            RTG
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.player.PlayerID} onClick={() => onOpen(r.player, r.side)} style={{ cursor: "pointer" }}>
            <NameCell player={r.player} />
            {PLAYER_STATS_COLUMNS.map((c) => (
              <td key={c.key} style={TD}>
                {r.line?.[c.key] ?? 0}
              </td>
            ))}
            <td style={{ ...TD, color: "#fff", fontWeight: 600 }}>{r.fantasyPoints}</td>
            <td style={TD}>{r.rating.toFixed(0)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ByQuarterTable({ rows, events, onOpen }: { rows: RatedRow[]; events: MatchEvent[]; onOpen: (player: Player, side: Side) => void }) {
  const byPlayer = playerLinesByQuarter(events, rows.map((r) => r.player.PlayerID));
  const quartersPresent = Object.values(byPlayer)[0]?.map((q) => q.quarter) ?? [];
  return (
    <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
      <thead>
        <tr>
          <th style={{ ...TH, textAlign: "left" }}>PLAYER · FP BY QUARTER</th>
          {quartersPresent.map((q) => (
            <th key={q} style={TH}>
              Q{q}
            </th>
          ))}
          <th style={TH}>TOTAL</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const qLines = byPlayer[r.player.PlayerID] ?? [];
          const total = qLines.reduce((sum, q) => sum + q.fantasyPoints, 0);
          return (
            <tr key={r.player.PlayerID} onClick={() => onOpen(r.player, r.side)} style={{ cursor: "pointer" }}>
              <NameCell player={r.player} />
              {qLines.map((q) => (
                <td key={q.quarter} style={TD}>
                  {Math.round(q.fantasyPoints)}
                </td>
              ))}
              <td style={{ ...TD, color: "#fff", fontWeight: 600 }}>{Math.round(total)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function leaderFor(box: Record<number, BoxScoreLine>, ids: Set<number>, players: Player[], key: keyof BoxScoreLine): { player: Player; value: number } | null {
  let best: { player: Player; value: number } | null = null;
  for (const p of players) {
    if (!ids.has(p.PlayerID)) continue;
    const value = (box[p.PlayerID]?.[key] as number) ?? 0;
    if (value > 0 && (!best || value > best.value)) best = { player: p, value };
  }
  return best;
}

function TeamTotalsContent({
  homeTeam,
  awayTeam,
  homeIds,
  awayIds,
  boxScore,
  onOpen,
}: {
  homeTeam: MatchTeam;
  awayTeam: MatchTeam;
  homeIds: Set<number>;
  awayIds: Set<number>;
  boxScore: Record<number, BoxScoreLine>;
  onOpen: (player: Player, side: Side) => void;
}) {
  const homeTotals = sumTeam(boxScore, homeIds);
  const awayTotals = sumTeam(boxScore, awayIds);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "4px 2px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", ...sectionLabelStyle() }}>
        <span>{homeTeam.name}</span>
        <span>{awayTeam.name}</span>
      </div>
      {STAT_ROWS.map(({ key, label }) => {
        const h = homeTotals[key] as number;
        const a = awayTotals[key] as number;
        const total = h + a;
        const homeLeader = leaderFor(boxScore, homeIds, homeTeam.players, key);
        const awayLeader = leaderFor(boxScore, awayIds, awayTeam.players, key);
        return (
          <div key={key}>
            <div style={{ display: "flex", justifyContent: "space-between", font: `600 13px ${MONO}`, marginBottom: 3 }}>
              <span style={{ color: h > a ? "#fff" : "#aab3c3" }}>{h}</span>
              <span style={{ font: `500 11px ${BARLOW}`, color: "#aab3c3" }}>{label}</span>
              <span style={{ color: a > h ? "#fff" : "#aab3c3" }}>{a}</span>
            </div>
            <div style={{ display: "flex", height: 5, borderRadius: 3, overflow: "hidden", gap: 2 }}>
              <span style={{ width: `${total ? (h / total) * 100 : 50}%`, background: "var(--acc)" }} />
              <span style={{ flex: 1, background: "#dfe3ea", opacity: 0.55 }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 4, font: `500 11px ${BARLOW}` }}>
              {homeLeader ? (
                <button onClick={() => onOpen(homeLeader.player, "home")} style={{ background: "none", border: 0, padding: 0, cursor: "pointer", color: "#8f9ab0" }}>
                  #{homeLeader.player.jumperNumber} {homeLeader.player.lname} ({homeLeader.value})
                </button>
              ) : (
                <span />
              )}
              {awayLeader ? (
                <button onClick={() => onOpen(awayLeader.player, "away")} style={{ background: "none", border: 0, padding: 0, cursor: "pointer", color: "#8f9ab0" }}>
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
  );
}

/** Full event log, oldest first, with the game clock and team chip (never tick counts). */
function PlayByPlayList({ events, ticksPerQuarter, homeIds, homeTeam, awayTeam }: { events: MatchEvent[]; ticksPerQuarter: number; homeIds: Set<number>; homeTeam: MatchTeam; awayTeam: MatchTeam }) {
  if (events.length === 0) return <p style={{ font: `500 13px ${BARLOW}`, color: "#8f9ab0" }}>No events recorded for this match.</p>;
  return (
    <div>
      {events.map((ev, i) => {
        const scorer = ev.statDeltas.find((d) => d.stat === "goals" || d.stat === "behinds");
        const side: Side = scorer ? (homeIds.has(scorer.playerId) ? "home" : "away") : ev.possession;
        const goal = scorer?.stat === "goals";
        return (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "64px 44px minmax(0,1fr)", gap: 8, alignItems: "start", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,.04)" }}>
            <span style={{ font: `500 11px ${MONO}`, color: "#8f9ab0", whiteSpace: "nowrap" }}>{eventClock(ev, ticksPerQuarter)}</span>
            <TeamChip name={side === "home" ? homeTeam.name : awayTeam.name} size={10} />
            <span style={{ font: `${goal ? 700 : 500} 13px/1.35 ${BARLOW}`, color: goal ? "#fff" : "#c3ccdd" }}>
              {goal ? "GOAL · " : scorer ? "BEHIND · " : ""}
              {ev.description}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// --- Coaches' ballot editor (season/finals matches, round 90) ------------------------------------------

function BallotEditor({
  votes,
  homeTeam,
  awayTeam,
  myClub,
  onSubmitBallot,
}: {
  votes: MatchCoachesVotes;
  homeTeam: MatchTeam;
  awayTeam: MatchTeam;
  myClub: string;
  onSubmitBallot: (side: "home" | "away", allocations: CoachesVoteAllocation[]) => void;
}) {
  const pool = useMemo(() => [...homeTeam.players, ...awayTeam.players], [homeTeam, awayTeam]);
  const mySide: "home" | "away" | null = homeTeam.name === myClub ? "home" : awayTeam.name === myClub ? "away" : null;
  const myBallot = mySide === "home" ? votes.homeCoachBallot : mySide === "away" ? votes.awayCoachBallot : null;
  const myBallotIsUser = mySide === "home" ? votes.homeBallotIsUser : mySide === "away" ? votes.awayBallotIsUser : false;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<(number | null)[]>([null, null, null, null, null]);
  if (!mySide) return null;

  function startEditing() {
    const sorted = myBallot ? [...myBallot].sort((a, b) => b.votes - a.votes) : [];
    setDraft(VOTE_VALUES.map((_, i) => sorted[i]?.playerId ?? null));
    setEditing(true);
  }
  const draftAllocations: CoachesVoteAllocation[] | null = draft.every((id): id is number => id !== null) ? draft.map((id, i) => ({ playerId: id, votes: VOTE_VALUES[i] })) : null;
  const canSubmit = draftAllocations !== null && isValidBallot(draftAllocations);

  if (!editing) {
    return (
      <button onClick={startEditing} style={{ ...outlineButton, alignSelf: "flex-start" }}>
        {myBallotIsUser ? "Edit your votes" : "Submit your votes"}
      </button>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid rgba(255,255,255,.06)", paddingTop: 10 }}>
      <div style={sectionLabelStyle()}>YOUR 5-4-3-2-1 FOR {clubAbbr(mySide === "home" ? homeTeam.name : awayTeam.name)}</div>
      {VOTE_VALUES.map((v, i) => (
        <div key={v} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 18, textAlign: "center", font: `700 14px ${MONO}`, color: "var(--accT)" }}>{v}</span>
          <select
            value={draft[i] ?? ""}
            onChange={(e) => {
              const id = e.target.value ? Number(e.target.value) : null;
              setDraft((d) => d.map((x, j) => (j === i ? id : x)));
            }}
            style={{ flex: 1, background: "rgba(0,0,0,.25)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 8, color: "#e9edf4", padding: "7px 10px", font: `600 13px ${BARLOW}` }}
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
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => {
            if (!draftAllocations || !isValidBallot(draftAllocations)) return;
            onSubmitBallot(mySide, draftAllocations);
            setEditing(false);
          }}
          disabled={!canSubmit}
          style={{ ...primaryButton, padding: "9px 14px", opacity: canSubmit ? 1 : 0.5 }}
        >
          Submit votes
        </button>
        <button onClick={() => setEditing(false)} style={outlineButton}>
          Cancel
        </button>
      </div>
    </div>
  );
}
