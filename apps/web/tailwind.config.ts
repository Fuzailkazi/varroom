import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        lime: {
          DEFAULT: "var(--lime)",
          hover: "var(--lime-hover)",
          on: "var(--on-lime)",
        },
        paper: "var(--paper)",
        surface: "var(--surface)",
        sunken: "var(--sunken)",
        ink: {
          DEFAULT: "var(--ink)",
          2: "var(--ink-2)",
          3: "var(--ink-3)",
        },
        line: "var(--line)",
        success: {
          DEFAULT: "var(--success)",
          soft: "var(--success-soft)",
        },
        warning: {
          DEFAULT: "var(--warning)",
          soft: "var(--warning-soft)",
        },
        danger: {
          DEFAULT: "var(--danger)",
          soft: "var(--danger-soft)",
        },
        violet: {
          DEFAULT: "var(--violet)",
          soft: "var(--violet-soft)",
        },
      },
      fontFamily: {
        display: ["'Bricolage Grotesque'", "sans-serif"],
        sans: ["'Schibsted Grotesk'", "-apple-system", "sans-serif"],
        mono: ["'Space Mono'", "monospace"],
      },
      boxShadow: {
        hard: "3px 3px 0 var(--ink)",
        "hard-lg": "5px 5px 0 var(--ink)",
        collapse: "1px 1px 0 var(--ink)",
      },
      borderWidth: {
        chunky: "1.5px",
        bold: "2.5px",
      },
      borderRadius: {
        sm: "8px",
        md: "14px",
        lg: "20px",
        pill: "999px",
      },
      zIndex: {
        30: "30",
        40: "40",
        50: "50",
        60: "60",
      },
    },
  },
  plugins: [],
} satisfies Config;
