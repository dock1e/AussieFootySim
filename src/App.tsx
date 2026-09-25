import { useEffect, useRef, useState } from "react";
import { Dashboard } from "./components/Dashboard";
import { List } from "./components/List";
import { LiveMatch } from "./components/LiveMatch";
import type { FlowStep } from "./components/matchday/flow/FlowChrome";
import { SeasonHub } from "./components/SeasonHub";
import { ListNeeds } from "./components/ListNeeds";
import { Combine } from "./components/Combine";
import { Contracts } from "./components/Contracts";
import { TradePeriod } from "./components/TradePeriod";
import { Draft } from "./components/Draft";
import { PositionSwitch } from "./components/PositionSwitch";
import { Records } from "./components/Records";
import { FootballDept } from "./components/FootballDept";
import { CareerProfile } from "./components/CareerProfile";
import { PlayerProfileModal } from "./components/PlayerProfileModal";
import { ThemeSystemScreen } from "./components/ThemeSystemScreen";
import { ClubStripe } from "./components/theme/primitives";
import { clubTokensFor } from "./theme/clubTokens";
import { clubThemeStyle, pageBackgroundStyle, topWashStyle } from "./theme/useClubTheme";
import { useGameStore } from "./store/useGameStore";
import { useSaveStore } from "./store/useSaveStore";
import { ALL_PLAYERS } from "./data/loadPlayers";
import { clubByName } from "./types/club";

type Screen =
  | "dashboard"
  | "squad"
  | "season"
  | "match"
  | "listNeeds"
  | "combine"
  | "contracts"
  | "trade"
  | "draft"
  | "positionSwitch"
  | "records"
  | "career"
  | "facilities"
  | "themeSystem";

/**
 * Nav consolidation — Aug 2026 round 52, [[UI Consolidation Review]]. Tyler:
 * "I am not a fan of how many different tabs we have currently, I would
 * prefer to consolidate a lot of that information." The previous flat
 * 11-button row (one button per `Screen`) had already wrapped the header
 * once and dropped SaveMenu onto its own low-contrast line — see the comment
 * on the header row below.
 *
 * Round 124 — [[Club Theme System]]'s own nav spec (`Club Theme System.dc.html`
 * line ~2079: `tabs:[dash, live('Match Day'), list('List'), player('Player
 * Career'), draft('Draft'), staff('Football Dept'), stats, theme]`) has
 * specified this exact flat 8-tab top-level nav since round 114 first read
 * the brief — every real screen gets its own top-level tab, no umbrella
 * groups. Rounds 115-123 retrofitted each screen's own CONTENT to the brief
 * without ever revisiting the nav's STRUCTURE, so the round-52 grouping
 * (Coaching / Future Planning / Player Mgmt) stayed in place underneath.
 * Tyler's own round-124 ask, prompted by a screenshot of the brief's flat nav
 * next to our grouped one, was explicit: "flatten the whole nav" to match.
 *
 * The mechanism is unchanged — a group with one screen navigates straight
 * there with no sub-tab row; a group with more than one still shows the
 * existing secondary pill row (see `activeGroup` below, and `FootballDept.tsx`'s
 * own internal 4-tab shell for the same one-nav-item/multiple-screens pattern
 * a level down). What changed is which top-level LABEL each screen sits
 * under: the brief's flat nav only names 8 destinations, but this app has 15
 * real screens, so the 6 screens the brief doesn't give their own top-level
 * slot — Selection, Position Switch, List Needs, Talent Scouting, Trade,
 * Contracts — needed a documented new home rather than an invented 9th tab
 * the brief never asked for:
 *   - Selection (pre-match team-sheet prep) joined Match Day's own group.
 *     Round 128 folded it into the Match Day flow itself (steps 1-3 of
 *     `LiveMatch`'s stepper), so Match Day is a single screen again.
 *   - Position Switch and Contracts join List's own group — round 117's own
 *     doc comment already treats both as List's natural companions (Position
 *     Switch is the batch review queue for the single-player Position Fit
 *     tab List already has; Contracts is the whole-league version of List's
 *     own per-player Contract tab), so this just gives that existing
 *     relationship a shared top-level home instead of two separate ones.
 *   - List Needs, Talent Scouting, and Trade join Draft's own group — these
 *     three plus the Draft board itself are the one off-season planning
 *     pipeline the old "Future Planning" umbrella already recognised;
 *     ordered with `draft` first so the top-level "Draft" button lands on
 *     the actual board, matching the label.
 *
 * `screen` itself is completely unchanged as the single source of truth for
 * which component renders (see `<main>` below), and every cross-nav callback
 * (`onGoToContracts`, `onGoToPositionSwitch`, etc.) still just calls
 * `setScreen(...)` — `activeGroup`'s lookup is generic over `screens`, so
 * jumping straight to a screen now under a different top-level label
 * highlights the correct new tab automatically, with no callback changes
 * needed anywhere in the app.
 *
 * `season` is deliberately absent from every group's `screens` list: it's no
 * longer reachable from top-level nav, but the screen/route itself is
 * completely untouched — its content now lives inline in Dashboard's
 * expandable ladder card (see Dashboard.tsx), and that card's own "Open full
 * Season page" link is how you still reach this standalone screen for the
 * deeper multi-round read the embedded card doesn't try to replace.
 */
/**
 * Round 114 — Club Theme System: `themeSystem` is the brief's screen 8, "a
 * dev/QA screen… keep it in dev builds." `import.meta.env.DEV` is Vite's own
 * build-mode flag (true for `npm run dev`, false for `npm run build`'s
 * production bundle), so this group — and the only route to the screen —
 * simply doesn't exist in what ships to GitHub Pages, with no separate
 * feature-flag plumbing needed.
 */
const NAV_GROUPS: { key: string; label: string; screens: Screen[] }[] = [
  { key: "dashboard", label: "Dashboard", screens: ["dashboard"] },
  { key: "matchDay", label: "Match Day", screens: ["match"] },
  { key: "list", label: "List", screens: ["squad", "contracts", "positionSwitch"] },
  { key: "career", label: "Player Career", screens: ["career"] },
  { key: "draft", label: "Draft", screens: ["draft", "listNeeds", "combine", "trade"] },
  { key: "facilities", label: "Football Dept", screens: ["facilities"] },
  { key: "records", label: "Statistics", screens: ["records"] },
  ...(import.meta.env.DEV ? [{ key: "themeSystem", label: "Theme System", screens: ["themeSystem"] as Screen[] }] : []),
];

const SCREEN_LABELS: Record<Screen, string> = {
  dashboard: "Dashboard",
  squad: "Squad",
  season: "Season",
  match: "Match",
  listNeeds: "List Needs",
  // Round 97, Tyler: the Talent Scout hiring/focus panel moved here from the Draft screen (see
  // Combine.tsx's own doc comment) — "Combine" no longer names everything this tab now covers, so it's
  // relabelled the same way "records" was relabelled "Statistics" back in round 58: the `Screen` key
  // stays `combine` (no route/state churn), only the user-facing label changes.
  combine: "Talent Scouting",
  contracts: "Contracts",
  trade: "Trade",
  draft: "Draft",
  positionSwitch: "Position Switch",
  records: "Statistics",
  career: "Career",
  // Round 121 built just the Facilities sub-tab under this label; round 122 unified all 4 of the
  // brief's own sub-tabs (Overview/Assistant Coaches/Facilities/Marketing) into one screen with
  // internal tab state (`FootballDept.tsx`) — the `Screen` key stays `facilities` (no route churn),
  // it just now renders the full 4-tab screen rather than Facilities alone.
  facilities: "Football Dept",
  themeSystem: "Theme System",
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
    setMatchEntryStep(undefined);
    setScreen((prev) => (group.screens.includes(prev) ? prev : group.screens[0]));
  }
  // Round 99 — the Draft screen's new "three-column cockpit" layout (Draft.tsx's own doc comment)
  // needs a full-height, non-scrolling shell (Tyler: "no page scroll... no dead space to the right")
  // that the shared width-capped, `min-h-screen`-scrollable shell below can't provide. Gated
  // specifically on `screen === "draft"` (not on draft-window state) so every other screen's shell is
  // completely untouched, and only active at `lg:` and above — below that this screen falls back to
  // the exact same scrollable, capped-width shell every other screen already uses.
  //
  // Sep 2026 — [[LiveMatch Cockpit Rebuild]] needs the identical shell for the live in-match screen,
  // but a bare `screen === "match"` check (mirroring the line above verbatim) would be wrong: unlike
  // Draft's cockpit, which was built to house every one of Draft's own internal states, only ONE of
  // LiveMatch's states (a live/paused/break in-progress match) is the new cockpit — the club-picker
  // setup screen, MatchPreparation, and FullTimeResult are untouched, ordinary scrollable screens, and
  // FullTimeResult in particular is genuinely long (full box score, margin chart). Clipping all three
  // under `overflow-hidden` would be a real regression nobody asked for. `matchCockpitActive` is set by
  // LiveMatch itself (`onCockpitActiveChange`) only while it's actually rendering the cockpit JSX, off
  // for every other one of its states and on unmount — so this stays a precise, per-state gate rather
  // than the Draft screen's coarser whole-screen one.
  //
  // Round 126 — Cowork fix pass 1, item 5 ("Page jumps when switching tabs"): every tab, cockpit or
  // not, now renders inside ONE identical shell — same 1440px max-width, same 16px/20px padding, same
  // fixed-height header rows (56px logo row, 44px tabs, 36px sub-tab row that is ALWAYS rendered,
  // empty when a tab has no sub-tabs). The cockpit screens (Draft, live match) keep their full-height,
  // non-scrolling layout at `lg:`, but no longer vary width, top padding or header spacing, so the
  // logo, tab bar and first card's top edge sit on identical pixels across every tab. (Supersedes
  // Round 125's 1280px cap and its full-width live-match exception.)
  const [matchCockpitActive, setMatchCockpitActive] = useState(false);
  /** Round 128 — the Match Day flow's opening step when arriving from a Dashboard link (e.g. "go to selection"); the tab itself picks its own default. */
  const [matchEntryStep, setMatchEntryStep] = useState<FlowStep | undefined>(undefined);
  const isCockpitScreen = screen === "draft" || (screen === "match" && matchCockpitActive);
  const myClub = useGameStore((s) => s.myClub);
  // Round 114 — Club Theme System: the 5 CSS custom properties every themed
  // component/screen reads via `var(--…)`, set once here from the coached
  // club's `abbreviation` (confirmed identical to the brief's token-table
  // ids) and applied to the whole app via the root `<div>`'s style below.
  // Screens not yet migrated to the token system (everything except the
  // Theme System QA screen, this round) simply don't reference these vars
  // yet, so this is additive and changes nothing about how they render.
  const clubTokens = clubTokensFor(clubByName(myClub)?.abbreviation);
  const status = useSaveStore((s) => s.status);
  const initialize = useSaveStore((s) => s.initialize);
  const poolVersion = useSaveStore((s) => s.poolVersion);

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
    // Round 114 — Club Theme System: `clubThemeStyle` sets the 5 CSS custom
    // properties + tint vars app-wide from here down. Round 126 (fix pass 1,
    // item 1): two background layers, as in the reference — the root carries
    // the `--tb` page tint, and `.wash` over it fades the club's deep colour
    // into that base across the top 340px. The club stripe sits above the
    // header, full width.
    <div
      className={`app-root ${isCockpitScreen ? "lg:flex lg:h-screen lg:flex-col lg:overflow-hidden" : ""}`}
      style={{ ...clubThemeStyle(clubTokens), ...pageBackgroundStyle() }}
    >
      <div className={`wash ${isCockpitScreen ? "lg:flex lg:min-h-0 lg:flex-1 lg:flex-col" : ""}`} style={{ ...topWashStyle, minHeight: "100vh" }}>
      <ClubStripe />
      <div
        className={`app-shell ${isCockpitScreen ? "lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-hidden lg:!pb-4" : ""}`}
      >
      <header className={isCockpitScreen ? "lg:shrink-0" : ""} style={{ marginBottom: 20 }}>
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
        <div className="flex flex-wrap items-center justify-between gap-3" style={{ minHeight: 56 }}>
          <div className="flex items-center gap-2.5">
            <Logo />
            <div className="font-display text-3xl italic tracking-tight">
              AussieFooty<span style={{ color: "var(--accT)" }}>Sim</span>
            </div>
          </div>
          <SaveMenu />
        </div>
        {/* Round 123 — [[Football Department Coach Market]]'s companion nav-styling ask: Tyler's own
            comparison screenshots flagged this row (and the screen-picker row below it) as "the purple
            pills" that don't match the Club Theme System reference's flat underline-tab nav (that
            mockup's own `<nav>` — `border-bottom:2px solid var(--acc)` on the active tab, transparent
            border + slate text otherwise, no pill background at all). Restyled to that same underline
            language, driven by the coached club's own `var(--acc)`/`var(--accT)` tokens instead of the
            hardcoded `bg-primary` purple — so "yours/selected" now reads in the SAME accent colour as
            every themed screen this app already has (Dashboard, Football Dept, Draft, etc.), not a
            fixed purple that fights whichever club's colours are actually on screen. The two-tier
            group+screen structure itself is unchanged (this app has far more screens than the
            mockup's single flat row ever needed to hold) — only the visual treatment of each tier. */}
        <nav style={{ borderBottom: "1px solid rgba(255,255,255,.08)" }}>
          <div className="flex flex-wrap items-stretch gap-1" style={{ minHeight: 44, marginBottom: -1 }}>
            {NAV_GROUPS.map((group) => {
              const active = activeGroup.key === group.key;
              return (
                <button
                  key={group.key}
                  onClick={() => selectGroup(group)}
                  style={{
                    background: "transparent",
                    border: 0,
                    borderBottom: active ? "2px solid var(--acc)" : "2px solid transparent",
                    color: active ? "#fff" : "#9aa4b5",
                    padding: "10px 14px",
                    font: active ? "700 14px Barlow,sans-serif" : "600 14px Barlow,sans-serif",
                    cursor: "pointer",
                  }}
                >
                  {group.label}
                </button>
              );
            })}
          </div>
          {/* Always rendered (36px), empty on a tab with no sub-tabs, so every tab's header is the same height. */}
          <div className="flex flex-wrap items-center gap-1" style={{ minHeight: 36 }}>
            {activeGroup.screens.length > 1 &&
              activeGroup.screens.map((s) => {
                const active = screen === s;
                return (
                  <button
                    key={s}
                    onClick={() => setScreen(s)}
                    style={{
                      background: active ? "color-mix(in oklch, var(--acc) 16%, transparent)" : "transparent",
                      border: 0,
                      borderRadius: 6,
                      color: active ? "var(--accT)" : "#7e889a",
                      padding: "5px 10px",
                      font: active ? "700 12px Barlow,sans-serif" : "500 12px Barlow,sans-serif",
                      cursor: "pointer",
                    }}
                  >
                    {SCREEN_LABELS[s]}
                  </button>
                );
              })}
          </div>
        </nav>
      </header>

      <main key={poolVersion} className={isCockpitScreen ? "lg:min-h-0 lg:flex-1 lg:overflow-hidden" : undefined}>
        {screen === "dashboard" && (
          <Dashboard
            onGoToSelection={() => {
              setMatchEntryStep(0);
              setScreen("match");
            }}
            onGoToContracts={() => setScreen("contracts")}
            onGoToSeason={() => setScreen("season")}
          />
        )}
        {screen === "squad" && <List />}
        {screen === "season" && <SeasonHub />}
        {screen === "match" && <LiveMatch onCockpitActiveChange={setMatchCockpitActive} onContinue={() => setScreen("dashboard")} initialStep={matchEntryStep} />}
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
        {screen === "career" && <CareerProfile />}
        {screen === "facilities" && <FootballDept />}
        {screen === "themeSystem" && <ThemeSystemScreen />}
      </main>
      <PlayerProfileModal />
      </div>
      </div>
    </div>
  );
}

/**
 * Header wordmark badge — Aug 2026 rebrand (SimAFL -> AussieFootySim, Tyler:
 * "rebrand the logo in the top left... Use supercoach logo as a subtle (no
 * copyright infringement) reference point as I want the platform to feel
 * familiar to supercoach players"). Originally a green rounded-square badge;
 * Round 123 — [[Football Department Coach Market]] — re-skinned to match the
 * exact badge treatment in the Club Theme System reference mockup itself
 * (`Club Theme System.dc.html` line ~13: a light `#eef2f8` rounded-square
 * with dark `#0a0e17` "AFS" lettering, sized 34px, next to an italic wordmark
 * whose "Sim" half now reads in the coached club's own `var(--accT)` token
 * rather than a fixed green) — Tyler's own round-123 ask ("rebrand the AFS
 * logo... to better align to the UI redesign") pointed straight at this
 * mockup's own header markup as the target, not a fresh design. Still
 * original artwork (a plain rounded square + monogram, no shield/crest), and
 * still "AFS" rather than "SC" — same non-infringement reasoning as the
 * original rebrand, just now pixel-matched to the brief instead of freely
 * interpreted. Kept as a small standalone component (not inlined in the
 * header) so it's reusable if a favicon/app-icon ever wants the same mark.
 */
function Logo() {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" className="shrink-0" aria-hidden="true">
      <rect x="0" y="0" width="34" height="34" rx="9" fill="#eef2f8" />
      <text x="17" y="21.5" textAnchor="middle" fontFamily="'Barlow Condensed', Arial, sans-serif" fontWeight="700" fontSize="13" fill="#0a0e17" letterSpacing="0.5">
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
