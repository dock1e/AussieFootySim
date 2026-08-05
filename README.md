# SimAFL — app

The coded implementation of the design in the vault one level up (`../SimAFL.md`,
`../Engine.md`, `../User Interface.md`, `../Configuration.md`, `../Player Database/`).
See `../ROADMAP.md` for what's built vs. what's next.

## Stack

React + Vite + TypeScript + Tailwind + Zustand + Vitest — the exact combination decided
in `../Configuration.md` ("Tech stack decision record") and `../Engine.md` ("Tech stack"),
re-checked there against 2026 alternatives.

## Getting started

```bash
npm install
npm run build:data   # regenerate src/data/generated/players.json from ../Player Database/players_master.csv
npm run dev           # start the Vite dev server
npm test               # run the Vitest suite
npm run build          # type-check + production build
```

Re-run `npm run build:data` any time the vault's `players_master.csv` changes — the
generated JSON is gitignored on purpose (it's a build artifact, not a source file).

## A note on how this was built

This app was scaffolded and coded inside a sandboxed Cowork session whose network access
is allowlisted and does **not** include the npm registry (`registry.npmjs.org`,
`unpkg.com`, `cdnjs.cloudflare.com` all returned `403 blocked-by-allowlist`). That means:

- **`npm install` has never actually been run against this `package.json`.** Every config
  file and source file was written by hand and carefully proofread, but the React/Tailwind/
  Vite/Zustand/Vitest layer has not been executed or type-checked with the real toolchain —
  see `../ROADMAP.md` "Known gaps" for exactly what that does and doesn't cover.
- **The engine and data-pipeline layers are the exception** — `src/engine/`, `src/types/`,
  `scripts/buildData.ts` and `scripts/csv.ts` have zero npm dependencies by design (Engine.md
  specifies the engine as "a plain TypeScript module, zero DOM/browser dependencies" so it
  can run headless in Node for the balance simulator — see `#Balance simulator`). Those
  files were actually run and tested for real using Node 22's built-in
  `--experimental-strip-types` flag, with no install step needed. `npm run build:data`
  above is genuinely proven to work — it's what generated the `players.json` this app reads.

First `npm install` on a machine with normal internet access should surface any real
compile errors quickly; nothing here is expected to need major surgery, but treat the
UI layer as "written and reasoned through, not yet compiler-verified."
