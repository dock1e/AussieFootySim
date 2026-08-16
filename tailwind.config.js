/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Visual design system — see ../User Interface.md "Visual design system"
        // Dark near-black/navy base + a single strong accent (orange-red),
        // reverse-engineered from aflclubmanager.com.
        base: {
          950: "#0a0e14",
          900: "#0f141c",
          800: "#161c27",
          700: "#212938",
          600: "#2e394d",
        },
        accent: {
          DEFAULT: "#ff5a36",
          light: "#ff7a5c",
          dark: "#e0431f",
        },
        // Round 16 (Aug 2026), Tyler: "our colour scheme is a bit mixed since
        // the rebrand... red is ok to use, but it should be used to highlight
        // players or stats of interest where players are excelling etc." —
        // `accent` (above) had been quietly doing double duty as both "the
        // brand colour" AND "every generic button/active-tab/comparison-bar,"
        // which is exactly why red stopped reading as meaningful anywhere:
        // when it's on every button, it's not telling you anything about any
        // particular one of them. `primary` takes over the generic-chrome
        // role (buttons, active nav/speed-toggle states, comparison bars) —
        // an indigo, deliberately a hue family none of `good`/`warn`/`bad`/
        // `info`/`accent` already uses, so it can't be mistaken for any of
        // them meaning something. `accent` stays in the palette for its
        // actual job now: a genuine "look at this" highlight (a stat that's
        // exceptional, the match leader, a selected/current choice) rather
        // than default UI wallpaper.
        primary: {
          DEFAULT: "#6d5ce8",
          light: "#8b7ded",
          dark: "#5443c4",
        },
        good: "#3fb950",
        warn: "#e0a626",
        bad: "#f0574b",
        info: "#4b8fe0",
      },
      fontFamily: {
        display: ["'Barlow Condensed'", "'Oswald'", "sans-serif"],
        sans: ["'Inter'", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "0.75rem",
      },
    },
  },
  plugins: [],
};
