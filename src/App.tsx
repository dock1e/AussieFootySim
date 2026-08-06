import { useState } from "react";
import { Dashboard } from "./components/Dashboard";
import { SquadList } from "./components/SquadList";
import { LiveMatch } from "./components/LiveMatch";
import { SeasonHub } from "./components/SeasonHub";
import { SelectionCommittee } from "./components/SelectionCommittee";
import { useGameStore } from "./store/useGameStore";
import { ALL_PLAYERS, getPlayersByClub } from "./data/loadPlayers";

type Screen = "dashboard" | "squad" | "selection" | "season" | "match";

export default function App() {
  const [screen, setScreen] = useState<Screen>("dashboard");
  const myClub = useGameStore((s) => s.myClub);
  const squad = getPlayersByClub(myClub);

  return (
    <div className="mx-auto min-h-screen max-w-6xl px-4 py-6">
      <header className="mb-6 flex items-center justify-between">
        <div className="font-display text-3xl italic tracking-tight">
          Sim<span className="text-accent">AFL</span>
        </div>
        <nav className="flex gap-2">
          {(
            [
              ["dashboard", "Dashboard"],
              ["squad", "Squad"],
              ["selection", "Selection"],
              ["season", "Season"],
              ["match", "Match"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setScreen(key)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                screen === key ? "bg-accent text-white" : "bg-base-800 text-slate-300 hover:bg-base-700"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="text-xs text-slate-500 tabular-nums">{ALL_PLAYERS.length} players loaded</div>
      </header>

      <main>
        {screen === "dashboard" && <Dashboard />}
        {screen === "squad" && <SquadList players={squad} />}
        {screen === "selection" && <SelectionCommittee />}
        {screen === "season" && <SeasonHub />}
        {screen === "match" && <LiveMatch />}
      </main>
    </div>
  );
}
