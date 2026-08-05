/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// SimAFL — see ../ROADMAP.md and ../Engine.md / ../User Interface.md / ../Configuration.md
// (the Obsidian vault one level up) for the full design spec this app implements.
export default defineConfig({
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
});
