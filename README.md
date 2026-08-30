# AussieFootySim — app

The coded implementation of the design in the vault one level up (`../AussieFootySim.md`,
`../Engine.md`, `../User Interface.md`, `../Configuration.md`, `../Player Database/`).
See `../ROADMAP.md` for what's built vs. what's next.

## Stack

React + Vite + TypeScript + Tailwind + Zustand + Vitest — the exact combination decided
in `../Configuration.md` ("Tech stack decision record") and `../Engine.md` ("Tech stack"),
re-checked there against 2026 alternatives.

## Getting started

New to GitHub and Node.js? No problem — follow these steps in order and you'll have the
game running in your browser in about 10 minutes. You only need to do this once; after
that, starting the app again is a single command (see "Running it again later" below).

### Step 1: Install Node.js

Node.js is the free program that runs the app on your computer — it also installs `npm`,
which the next steps use.

1. Go to https://nodejs.org/en/download
2. Download the version labelled **LTS** ("Recommended For Most Users") for your operating
   system, then run the installer, accepting all the default options.
3. Check it worked: open a terminal (Step 3 below explains how) and type:
   ```bash
   node -v
   npm -v
   ```
   Each should print a version number, e.g. `v22.11.0`. If you instead see something like
   "command not found" or "not recognized," restart your computer and try again — Windows
   and Mac sometimes need a restart to pick up a newly installed program.

### Step 2: Download the AussieFootySim code

1. Go to https://github.com/dock1e/AussieFootySim
2. Click the green **Code** button, then **Download ZIP**.
3. Find the downloaded ZIP file (usually in your Downloads folder) and extract it — on
   Windows, right-click it and choose **Extract All**; on Mac, just double-click it. You'll
   get a folder named something like `AussieFootySim-master` — move it somewhere easy to
   find, like your Desktop. (The exact name doesn't matter, just remember where you put it.)

### Step 3: Open a terminal inside that folder

A terminal is just a window where you type commands instead of clicking things.

- **Windows**: open the extracted folder in File Explorer, hold **Shift**, right-click an
  empty area inside it, and choose **Open PowerShell window here** (Windows 11: **Open in
  Terminal**).
- **Mac**: open the extracted folder in Finder, right-click it and choose
  **Services → New Terminal at Folder** — or open the Terminal app, type `cd ` (with a
  trailing space), drag the folder onto the window, and press Enter.

Double-check you're in the right place:
```bash
dir     # Windows
ls      # Mac
```
You should see `package.json` and folders like `src` listed. If you don't, look inside for a
further subfolder (occasionally an unzip tool adds an extra nested layer) and open a terminal
in that one instead.

### Step 4: Install the app's building blocks

Only needed once (or after the code updates):
```bash
npm install
```
This downloads everything the app depends on — it can take a minute or two, and a lot of
text will scroll past. That's normal.

### Step 5: Generate the player data

```bash
npm run build:data
```
This builds the 751-player roster the game uses from the underlying data file.

### Step 6: Start the app

```bash
npm run dev
```
After a few seconds you'll see something like:
```
  VITE ready in 300 ms
  ➜  Local:   http://localhost:5173/
```
Open your web browser (Chrome, Edge, or Firefox) and go to that address —
**http://localhost:5173/** — and the game will load.

To stop it, click back into the terminal window and press **Ctrl+C**. Closing the terminal
also stops it.

### Running it again later

Once Steps 1-5 are done, you won't need to repeat them. Next time, just open a terminal
inside that same folder (Step 3) and run:
```bash
npm run dev
```

### Troubleshooting

- **"npm is not recognized" / "command not found"**: Node.js isn't installed, or your
  terminal was already open before you installed it — close the terminal window completely,
  open a fresh one, and try again.
- **"Cannot find module ..." or "no such file or directory"**: you're not in the right
  folder — redo Step 3 and confirm `dir`/`ls` shows `package.json` before running anything else.
- **The page won't load, or goes blank**: make sure the terminal from Step 6 is still open
  and running — closing it stops the app. Re-run `npm run dev` if needed.
- **Nothing above helps**: open an "Issue" on the GitHub page
  (https://github.com/dock1e/AussieFootySim/issues) describing what you see — screenshots help.

Re-run `npm run build:data` any time the underlying `players_master.csv` data changes — the
generated JSON is gitignored on purpose (it's a build artifact, not a source file). If you
want a production-style build instead of the dev server, `npm run build` type-checks and
builds an optimized version into `dist/`.

## A note on how this was built

Early on, this app was scaffolded and coded inside a sandboxed Cowork session whose network
access is allowlisted and didn't include the npm registry — so for a while, the React/
Tailwind/Vite/Zustand layer was written and carefully proofread by hand but genuinely
untested against the real toolchain, while `src/engine/`, `src/types/`, and the data-pipeline
scripts (which have zero npm dependencies by design — see Engine.md's "plain TypeScript
module, zero DOM/browser dependencies" requirement) were the only parts actually run, via
Node's built-in `--experimental-strip-types` flag.

That's since been fully closed out: `npm install`, `npm run build` (type-check + production
build), and `npm run dev` all run clean, and every round of work now gets `tsc`-verified plus
a real browser check before it ships — see `../ROADMAP.md` for the full build history.
