import { useEffect, useRef, useState } from "react";
import { Dashboard } from "./components/Dashboard";
import { SquadList } from "./components/SquadList";
import { LiveMatch } from "./components/LiveMatch";
import { SeasonHub } from "./components/SeasonHub";
import { SelectionCommittee } from "./components/SelectionCommittee";
import { ListNeeds } from "./components/ListNeeds";
import { Combine } from "./components/Combine";
import { Contracts } from "./components/Contracts";
import { TradePeriod } from "./components/TradePeriod";
import { Draft } from "./components/Draft";
import { PositionSwitch } from "./components/PositionSwitch";
import { Records } from "./components/Records";
import { useGameStore } from "./store/useGameStore";
import { useSeasonStore } from "./store/useSeasonStore";
import { useSaveStore } from "./store/useSaveStore";
import { ALL_PLAYERS, getPlayersByClub } from "./data/loadPlayers";

type Screen = "dashboard" | "squad" | "selection" | "season" | "match" | "listNeeds" | "combine" | "contracts" | "trade" | "draft" | "positionSwitch" | "records";

/**
 * Nav consolidation — Aug 2026 round 52, [[UI Consolidation Review]]. Tyler:
 * "I am not a fan of how many different tabs we have currently, I would
 * prefer to consolidate a lot of that information." The previous flat
 * 11-button row (one button per `Screen`) had already wrapped the header
 * once and dropped SaveMenu onto its own low-contrast line — see the comment
 * on the header row below. Groups map onto Tyler's own named categories
 * (Match Day / Coaching Decisions / Future Planning / Player Management).
 *
 * `screen` itself is completely unchanged as the single source of truth for
 * which component renders (see `<main>` below) — only the nav chrome
 * changes, so no screen component or cross-nav callback needed to change for
 * this part of the work. A group with exactly one screen (Dashboard, Match
 * Day) navigates straight there with no sub-tab row; a group with more than
 * one shows a secondary pill row for its own screens (see `activeGroup`
 * below).
 *
 * `season` is deliberately absent from every group's `screens` list: it's no
 * longer reachable from top-level nav, but the screen/route itself is
 * completely untouched — its content now lives inline in Dashboard's
 * expandable ladder card (see Dashboard.tsx), and that card's own "Open full
 * Season page" link is how you still reach this standalone screen for the
 * deeper multi-round read the embedded card doesn't try to replace.
 */
const NAV_GROUPS: { key: string; label: string; screens: Screen[] }[] = [
  { key: "dashboard", label: "Dashboard", screens: ["dashboard"] },
  { key: "matchDay", label: "Match Day", screens: ["match"] },
  { key: "coaching", label: "Coaching", screens: ["selection", "positionSwitch"] },
  { key: "futurePlanning", label: "Future Planning", screens: ["listNeeds", "combine", "trade", "draft"] },
  { key: "playerMgmt", label: "Player Mgmt", screens: ["squad", "contracts"] },
  { key: "records", label: "Statistics", screens: ["records"] },
];

const SCREEN_LABELS: Record<Screen, string> = {
  dashboard: "Dashboard",
  squad: "Squad",
  selection: "Selection",
  season: "Season",
  match: "Match",
  listNeeds: "List Needs",
  combine: "Combine",
  contracts: "Contracts",
  trade: "Trade",
  draft: "Draft",
  positionSwitch: "Position Switch",
  records: "Statistics",
};

export default function App() {
  const [screen, setScreen] = useState<Screen>("dashboard");
  // The group containing the current screen — falls back to the Dashboard
  // group when on a screen no group lists (just `season`, reached only via
  // Dashboard's own link, see NAV_GROUPS's doc comment above), so nav
  // highlighting always has a sane default rather than highlighting nothing.
  const activeGroup = NAV_GROUPS.find((g) => g.screens.includes(screen)) ?? NAV_GROUPS[0];
  function selectGroup(group: (typeof NAV_GROUPS)[number]) {
    // Re-entering a group you're already in keeps whichever of its screens
    // you were last on (e.g. Combine within Future Planning) rather than
    // resetting to that group's first screen every click.
    setScreen((prev) => (group.screens.includes(prev) ? prev : group.screens[0]));
  }
  const myClub = useGameStore((s) => s.myClub);
  const status = useSaveStore((s) => s.status);
  const initialize = useSaveStore((s) => s.initialize);
  // Re-reading getPlayersByClub whenever the live pool is swapped wholesale
  // (a load, a new game, an off-season step) — see useSaveStore.ts's
  // `poolVersion` doc comment. Not memoized: this is the one call site that
  // has to stay correct with zero risk of a stale dependency array, and
  // getPlayersByClub is a cheap filter over <1000 players.
  const poolVersion = useSaveStore((s) => s.poolVersion);
  const squad = getPlayersByClub(myClub);
  // Live, round-by-round condition from the active season (see season.ts's
  // doc comment) — undefined with no season in progress, in which case
  // SquadList quietly falls back to each player's static condition snapshot.
  const liveCondition = useSeasonStore((s) => s.season?.condition);

  useEffect(() => {
    void initialize();
    // Runs once on mount, deliberately — see useSaveStore.ts's own
    // idempotency guard for why calling this twice (e.g. React 18
    // StrictMode's dev-only double-invoke) is harmless regardless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
        Loading save…
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-6xl px-4 py-6">
      <header className="mb-6">
        {/* Logo + SaveMenu get their own row, deliberately separate from nav
            below — see the regression this fixed: with both in one
            `flex-wrap` row, nav growing to 11 tabs (Position Switch) was
            enough to wrap the whole header, dropping SaveMenu onto its own
            line in small `text-slate-500` text with nothing to its right
            forcing it into view (a single flex child on a wrapped line just
            sits at the line's start under `justify-between`) — easy to read
            as "the save button is gone" even though Export/Import/New Game
            were still there. Splitting the row means nav can keep growing
            and wrapping freely without ever touching this row again. */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Logo />
            <div className="font-display text-3xl italic tracking-tight">
              AussieFooty<span className="text-accent">Sim</span>
            </div>
          </div>
          <SaveMenu />
        </div>
        <nav>
          <div className="flex flex-wrap gap-2">
            {NAV_GROUPS.map((group) => (
              <button
                key={group.key}
                onClick={() => selectGroup(group)}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                  activeGroup.key === group.key ? "bg-primary text-white" : "bg-base-800 text-slate-300 hover:bg-base-700"
                }`}
              >
                {group.label}
              </button>
            ))}
          </div>
          {activeGroup.screens.length > 1 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {activeGroup.screens.map((s) => (
                <button
                  key={s}
                  onClick={() => setScreen(s)}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                    screen === s ? "bg-primary/20 text-primary-light" : "bg-base-900 text-slate-400 hover:bg-base-800"
                  }`}
                >
                  {SCREEN_LABELS[s]}
                </button>
              ))}
            </div>
          )}
        </nav>
      </header>

      <main key={poolVersion}>
        {screen === "dashboard" && (
          <Dashboard
            onGoToSelection={() => setScreen("selection")}
            onGoToContracts={() => setScreen("contracts")}
            onGoToSeason={() => setScreen("season")}
          />
        )}
        {screen === "squad" && <SquadList players={squad} liveCondition={liveCondition} />}
        {screen === "selection" && <SelectionCommittee />}
        {screen === "season" && <SeasonHub />}
        {screen === "match" && <LiveMatch />}
        {screen === "listNeeds" && (
          <ListNeeds
            onGoToCombine={() => setScreen("combine")}
            onGoToContracts={() => setScreen("contracts")}
            onGoToTrade={() => setScreen("trade")}
            onGoToDraft={() => setScreen("draft")}
            onGoToPositionSwitch={() => setScreen("positionSwitch")}
          />
        )}
        {screen === "combine" && <Combine />}
        {screen === "contracts" && <Contracts />}
        {screen === "trade" && <TradePeriod />}
        {screen === "draft" && <Draft />}
        {screen === "positionSwitch" && <PositionSwitch />}
        {screen === "records" && <Records />}
      </main>
    </div>
  );
}

/**
 * Header wordmark badge — Aug 2026 rebrand (SimAFL -> AussieFootySim, Tyler:
 * "rebrand the logo in the top left... Use supercoach logo as a subtle (no
 * copyright infringement) reference point as I want the platform to feel
 * familiar to supercoach players"). A rounded-square green badge with a
 * bold white monogram, next to the wordmark — the same *category* of mark
 * SuperCoach's own logo uses (green badge + bold lettering next to a
 * wordmark, visible in Tyler's own attached screenshots of the SC UI), not
 * a copy of its actual shield artwork, palette, or typeface: original
 * shape, this app's own `good` green (already the palette's green token,
 * see tailwind.config.js) rather than SC's specific shade, and "AFS" —
 * Tyler's own shorthand for AussieFootySim from this same message — rather
 * than "SC". Kept as a small standalone component (not inlined in the
 * header) so it's reusable if a favicon/app-icon ever wants the same mark.
 */
function Logo() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" className="shrink-0" aria-hidden="true">
      <rect x="1" y="1" width="38" height="38" rx="11" fill="#3fb950" stroke="#2b8a37" strokeWidth="1.5" />
      <text x="20" y="26" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontWeight="800" fontSize="14" fill="#ffffff" letterSpacing="0.5">
        AFS
      </text>
    </svg>
  );
}

/**
 * Compact save affordances — Engine.md's persistence spec explicitly wants
 * "JSON export/import for backup/sharing" as a real feature, not just an
 * internal implementation detail, alongside the automatic IndexedDB
 * auto-save every other action already triggers (see useSaveStore.ts).
 * Deliberately three plain buttons rather than a dropdown menu — nothing
 * else in this codebase has a dropdown component yet, and three buttons is
 * simple enough not to need one.
 *
 * There has never been a manual "Save" button — saving has always been
 * fully automatic (a debounced write on every store change). Added a live
 * "Saved HH:MM:SS" / dot indicator (`useSaveStore.ts`'s new `lastSavedAt`)
 * after Tyler went looking for one and, reasonably, read its absence as a
 * bug rather than a design choice — this makes the automatic behaviour
 * actually visible instead of invisible-by-default. Also see App.tsx's
 * header comment: this whole row was independently found to be dropping
 * onto its own low-contrast line once nav grew past 10 tabs, which was the
 * more likely real cause of "the save button disappeared" — both fixed
 * together.
 */
function SaveMenu() {
  const year = useSaveStore((s) => s.year);
  const lastSavedAt = useSaveStore((s) => s.lastSavedAt);
  const newGame = useSaveStore((s) => s.newGame);
  const exportJSON = useSaveStore((s) => s.exportJSON);
  const importJSON = useSaveStore((s) => s.importJSON);
  const myClub = useGameStore((s) => s.myClub);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);

  function handleExport() {
    const json = exportJSON();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aussiefootysim-save-${year}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportFile(file: File) {
    setImportError(null);
    try {
      await importJSON(await file.text());
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Could not import that file.");
    }
  }

  function handleNewGame() {
    if (!window.confirm(`Start a fresh ${myClub} save? This discards your current progress (aged players, season, lineups, plans).`)) {
      return;
    }
    void newGame(myClub);
  }

  return (
    <div className="flex items-center gap-2 text-xs text-slate-500">
      <span className="tabular-nums">
        {year} &middot; {ALL_PLAYERS.length} players
      </span>
      <span className="flex items-center gap-1.5 tabular-nums" title="Saving is automatic — there's no manual Save button, this confirms it's actually happening">
        <span className={`h-1.5 w-1.5 rounded-full ${lastSavedAt ? "bg-good" : "bg-base-600"}`} />
        {lastSavedAt ? `Saved ${new Date(lastSavedAt).toLocaleTimeString()}` : "Not saved yet"}
      </span>
      <button onClick={handleExport} className="rounded-lg bg-base-800 px-3 py-1.5 text-slate-400 hover:bg-base-700" title="Download your save as a JSON file">
        Export
      </button>
      <button
        onClick={() => fileInputRef.current?.click()}
        className="rounded-lg bg-base-800 px-3 py-1.5 text-slate-400 hover:bg-base-700"
        title="Load a previously-exported JSON save"
      >
        Import
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleImportFile(file);
          e.target.value = "";
        }}
      />
      <button onClick={handleNewGame} className="rounded-lg bg-base-800 px-3 py-1.5 text-slate-400 hover:bg-base-700" title="Wipe progress and start over">
        New Game
      </button>
      {importError && <span className="text-red-400">{importError}</span>}
    </div>
  );
}
