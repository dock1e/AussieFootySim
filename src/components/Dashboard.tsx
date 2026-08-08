import { useMemo } from "react";
import { CLUBS, clubByName } from "../types/club";
import { useGameStore } from "../store/useGameStore";
import { getPlayersByClub, leagueAverageOvr, averageOvr } from "../data/loadPlayers";
import { summariseLines } from "../data/lines";
import { gapBand } from "./StatusPill";

/**
 * A first slice of User Interface.md's Dashboard spec — club picker,
 * roster-size summary, and the positional rating bars (Midfield / Forwards
 * / Defence / Ruck vs league average), which is real, honestly-computable
 * logic from static player data alone (it's the same computation Engine.md
 * specs for the List Needs report). Everything else on the full Dashboard
 * spec (budget, club health, upcoming fixture, news feed) needs season/save
 * state that doesn't exist until the Engine's season loop is built — see
 * ROADMAP.md rather than faking those numbers here.
 */
export function Dashboard() {
  const { myClub, setMyClub } = useGameStore();
  const club = clubByName(myClub);
  const players = useMemo(() => getPlayersByClub(myClub), [myClub]);
  const lines = useMemo(() => summariseLines(players, leagueAverageOvr()), [players]);
  const clubAvgOvr = useMemo(() => averageOvr(players), [players]);

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
                  <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
