import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { clubById, clubByName } from "../../types/club";
import { getPlayerById } from "../../data/loadPlayers";
import { playerFullName } from "../../types/player";
import { groundForMatch } from "../../data/clubGrounds";
import { STADIUM_CONFIGS, type AFLStadium } from "../../data/stadiums";
import { SPECIAL_EVENTS } from "../../data/specialEvents";
import { finalsPlayed, type Season } from "../../engine/season";
import { awardsFor } from "../../engine/medalVotes";
import type { MatchResult } from "../../engine/match";
import type { MatchTeam } from "../../engine/team";
import { buildSplash, type SpecialMatch } from "../../narrative/splashData";
import type { NarrativeHistory } from "../../narrative/phraseEngine";
import { useCareerStore, DEFAULT_COACH_NAME } from "../../store/useCareerStore";
import { useGameStore } from "../../store/useGameStore";
import { useSaveStore } from "../../store/useSaveStore";
import { useSeasonStore, type CoachesVoteMatchRef } from "../../store/useSeasonStore";
import { clubTokensFor } from "../../theme/clubTokens";
import { clubThemeStyle } from "../../theme/useClubTheme";
import { BARLOW, COND, MONO } from "../matchday/shared";
import { BigGameSplash } from "./BigGameSplash";

/**
 * Big Game Splash — wiring between the season and the splash: finds a recorded special match, builds
 * its splash from the save (copy picked once and stored on the match), and marks it seen.
 */

export function findSpecialMatch(season: Season | null, ref: CoachesVoteMatchRef | null): SpecialMatch | null {
  if (!season || !ref) return null;
  const m =
    ref.kind === "round"
      ? season.played.find((x) => x.round === ref.round && x.homeClubId === ref.homeClubId && x.awayClubId === ref.awayClubId)
      : finalsPlayed(season).find((x) => x.key === ref.key);
  return m?.awards ? m : null;
}

function venueFor(season: Season, m: SpecialMatch): string {
  if (m.key === "GF" || m.awards?.event === "grandFinal") return STADIUM_CONFIGS["mcg"].commonName;
  return groundForMatch(m.homeClubId, m.round, season.fixture).commonName;
}

/** The splash for one recorded special match. On first showing it records its copy's picks in the save's phrase history. */
export function SplashHost({
  matchRef,
  onContinue,
  onReplay,
  onClose,
}: {
  matchRef: CoachesVoteMatchRef;
  onContinue: () => void;
  onReplay?: () => void;
  onClose?: () => void;
}) {
  const season = useSeasonStore((s) => s.season);
  const markSplashSeen = useSeasonStore((s) => s.markSplashSeen);
  const seasonArchives = useSaveStore((s) => s.seasonArchives);
  const year = useSaveStore((s) => s.year);
  const myClub = useGameStore((s) => s.myClub);
  const myClubId = clubByName(myClub)?.ClubID ?? -1;
  const match = findSpecialMatch(season, matchRef);

  // Built once per match (the copy mustn't change under the coach while it's on screen).
  const history = useRef<NarrativeHistory | null>(null);
  const [vm] = useState(() => {
    if (!season || !match) return null;
    const career = useCareerStore.getState();
    history.current = structuredClone(career.narrative.history) as NarrativeHistory;
    return buildSplash(
      {
        match,
        myClubId,
        season,
        seasonArchives,
        year,
        coach: career.coach ?? { name: DEFAULT_COACH_NAME },
        saveId: career.saveId ?? "legacy",
        venue: venueFor(season, match),
        history: history.current,
      },
      (match as { splashPicks?: Record<string, string> }).splashPicks,
    );
  });

  // First showing: the picks go into the phrase history (so the next big game doesn't open with the same
  // lines), and leaving the splash marks it seen with its picks saved on the match. Reopening changes nothing.
  const firstShow = useRef(!match?.splashSeen);
  useEffect(() => {
    if (!vm || !firstShow.current || !history.current) return;
    useCareerStore.getState().setNarrative({ history: history.current as Record<string, string[]> });
  }, [vm]);
  const leave = (then?: () => void) => () => {
    if (vm && firstShow.current) {
      firstShow.current = false;
      markSplashSeen(matchRef, vm.picks);
    }
    then?.();
  };

  if (!vm) return null;
  return (
    <BigGameSplash
      vm={vm}
      myAbbr={clubById(myClubId)?.abbreviation ?? ""}
      onContinue={leave(onContinue)}
      onReplay={onReplay ? leave(onReplay) : undefined}
      onClose={onClose ? leave(onClose) : undefined}
    />
  );
}

/**
 * Big Game Splash — Grand Final exhibition variant (round 133). Round 128's GF exhibition mode
 * deliberately has no season/finals fixture entry for `findSpecialMatch` to find (see that round's own
 * doc comment in `LiveMatch.tsx`'s `kickOffGrandFinal`) — it's an isolated one-off match that never
 * touches `useSeasonStore`. So this builds a fully synthetic, ephemeral `SpecialMatch` + `SplashVM`
 * directly from the exhibition's own result, in memory only: no `markSplashSeen`, no phrase-history
 * write-back, and no season/save mutation of any kind. `applyBigGameHonours` (which writes medals/
 * premiership-player flags to player career records) only ever walks `season.played`/`season.finals`,
 * so an exhibition match that's never added to season state already can't reach it — nothing extra to
 * guard against there. If no season is loaded at all, this renders nothing (matching `SplashHost`'s own
 * `if (!season || !match) return null`), and the exhibition falls through to its ordinary full-time
 * screen instead of a broken splash.
 */
export function ExhibitionSplashHost({
  result,
  home,
  away,
  venue,
  gfSide,
  seed,
  onContinue,
  onReplay,
}: {
  result: MatchResult;
  home: MatchTeam;
  away: MatchTeam;
  venue: AFLStadium;
  /** The real club name the coach is playing as in the exhibition. */
  gfSide: string;
  seed: number | null;
  onContinue: () => void;
  onReplay?: () => void;
}) {
  const season = useSeasonStore((s) => s.season);
  const seasonArchives = useSaveStore((s) => s.seasonArchives);
  const year = useSaveStore((s) => s.year);
  const myClubId = clubByName(gfSide)?.ClubID ?? -1;

  // Built once per match, same "picked once, don't reshuffle under the coach" rule as SplashHost's own
  // `vm` — but never written back anywhere, since there's no season match record to attach picks to.
  const [vm] = useState(() => {
    if (!season) return null;
    const homeClubId = clubByName(home.name)?.ClubID ?? -1;
    const awayClubId = clubByName(away.name)?.ClubID ?? -1;
    const awards = awardsFor({
      event: "grandFinal",
      matchId: `gf-exhibition:${seed ?? 0}:${homeClubId}-${awayClubId}`,
      result,
      home,
      away,
      stadium: venue,
    });
    const match: SpecialMatch = { key: "GF", homeClubId, awayClubId, result, awards, splashSeen: false };
    const career = useCareerStore.getState();
    const history = structuredClone(career.narrative.history) as NarrativeHistory;
    return buildSplash({
      match,
      myClubId,
      season,
      seasonArchives,
      year,
      coach: career.coach ?? { name: DEFAULT_COACH_NAME },
      saveId: career.saveId ?? "legacy",
      venue: venue.commonName,
      history,
    });
  });

  if (!vm) return null;
  return <BigGameSplash vm={vm} myAbbr={clubById(myClubId)?.abbreviation ?? ""} onContinue={onContinue} onReplay={onReplay} />;
}

/** "Medal" chip for a match report the coach's club played in: reopens the splash. */
export function MedalChip({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      title="Reopen the big-game splash"
      style={{ display: "inline-flex", alignItems: "center", gap: 6, font: `700 11px ${MONO}`, letterSpacing: "1.2px", padding: "4px 9px", borderRadius: 5, color: "#3d2c05", background: "linear-gradient(135deg,#fff3c4,#e8c25a 45%,#a8801f)", border: 0, cursor: "pointer" }}
    >
      ● MEDAL
    </button>
  );
}

/** Compact medal card for a special match the coach's club didn't play (top of that match's report). */
export function CompactMedalCard({ match }: { match: SpecialMatch }) {
  const awards = match.awards!;
  const event = SPECIAL_EVENTS[awards.event];
  const medallist = getPlayerById(awards.medallistId);
  const homeSquad = new Set(awards.homeSquad);
  const club = clubById(homeSquad.has(awards.medallistId) ? match.homeClubId : match.awayClubId);
  const top = awards.votes[0];
  const card: CSSProperties = {
    ...clubThemeStyle(clubTokensFor(club?.abbreviation)),
    display: "flex",
    alignItems: "center",
    gap: 16,
    padding: "14px 18px",
    borderRadius: 14,
    border: "1px solid color-mix(in oklch, var(--acc) 45%, transparent)",
    background: "radial-gradient(120% 90% at 20% 0%, color-mix(in oklch, var(--deep) 85%, #1a1a10) 0, #0d1119 70%)",
  };
  return (
    <div data-testid="compact-medal" style={card}>
      <div
        style={{ width: 54, height: 54, flex: "none", borderRadius: "50%", background: "radial-gradient(circle at 35% 30%, #fff3c4 0, #e8c25a 30%, #a8801f 70%, #6e5210 100%)", display: "flex", alignItems: "center", justifyContent: "center", font: `700 20px ${COND}`, color: "#3d2c05" }}
      >
        {medallist?.jumperNumber ?? "–"}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ font: `600 10px ${MONO}`, letterSpacing: "1.6px", color: "#e8c25a" }}>{event.medal}</div>
        <div style={{ font: `700 24px/1.05 ${COND}`, color: "#fff" }}>{medallist ? playerFullName(medallist) : "—"}</div>
        <div style={{ font: `500 13px ${BARLOW}`, color: "#c3cbd8" }}>
          {club?.name} · {top.total} votes from the judges
        </div>
      </div>
    </div>
  );
}

/** A match report's splash affordances: the Medal chip (reopens the splash) for the coach's own games, or the compact medal card for anyone else's. */
export function useSpecialMatchFor(season: Season | null, ref: CoachesVoteMatchRef | null, myClubId: number) {
  return useMemo(() => {
    const match = findSpecialMatch(season, ref);
    if (!match) return null;
    const mine = match.homeClubId === myClubId || match.awayClubId === myClubId;
    return { match, mine };
  }, [season, ref, myClubId]);
}
