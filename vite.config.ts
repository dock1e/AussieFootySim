/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// AussieFootySim — see ../ROADMAP.md and ../Engine.md / ../User Interface.md / ../Configuration.md
// (the Obsidian vault one level up) for the full design spec this app implements.
//
// `base` is set only for `vite build` (used by .github/workflows/deploy.yml to publish to GitHub
// Pages at github.com/dock1e/AussieFootySim -> a /AussieFootySim/ subpath), not for `vite dev` — so
// the local dev server keeps serving from "/" exactly as before and nothing about the day-to-day
// `npm run dev` workflow changes.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/AussieFootySim/" : "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@": "/src",
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
}));
