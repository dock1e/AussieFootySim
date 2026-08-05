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
