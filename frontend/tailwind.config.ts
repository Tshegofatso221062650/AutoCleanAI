import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "Cascadia Code", "Consolas", "monospace"],
      },
      fontSize: {
        "fluid-2xs": "var(--fs-2xs)",
        "fluid-xs":  "var(--fs-xs)",
        "fluid-sm":  "var(--fs-sm)",
        "fluid-base": "var(--fs-base)",
        "fluid-md":  "var(--fs-md)",
        "fluid-lg":  "var(--fs-lg)",
        "fluid-xl":  "var(--fs-xl)",
        "fluid-2xl": "var(--fs-2xl)",
        "fluid-3xl": "var(--fs-3xl)",
      },
      colors: {
        void:  "var(--app-bg)",
        panel: "var(--app-panel)",
        edge:  "var(--app-edge)",
        "app-text":   "var(--app-text)",
        "app-muted":  "var(--app-text-muted)",
        "app-subtle": "var(--app-text-subtle)",
        accent:  "#00d9a5",
        accent2: "#00b8ff",
        warn:    "#ffb020",
        danger:  "#ff5c5c",
      },
      keyframes: {
        "fade-in": {
          "0%":   { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "fade-in-up": {
          "0%":   { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "none" },
        },
        "fade-in-down": {
          "0%":   { opacity: "0", transform: "translateY(-8px)" },
          "100%": { opacity: "1", transform: "none" },
        },
        "scale-in": {
          "0%":   { opacity: "0", transform: "scale(0.96)" },
          "100%": { opacity: "1", transform: "none" },
        },
        "slide-in-left": {
          "0%":   { opacity: "0", transform: "translateX(-16px)" },
          "100%": { opacity: "1", transform: "none" },
        },
        "shimmer": {
          "0%":   { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "pulse-glow": {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(0, 217, 165, 0)" },
          "50%":       { boxShadow: "0 0 0 6px rgba(0, 217, 165, 0.12)" },
        },
        "count-up": {
          "0%":   { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "none" },
        },
        "spin-slow": {
          "0%":   { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
      },
      animation: {
        "fade-in":       "fade-in 0.25s ease-out both",
        "fade-in-up":    "fade-in-up 0.3s ease-out both",
        "fade-in-down":  "fade-in-down 0.25s ease-out both",
        "scale-in":      "scale-in 0.2s ease-out both",
        "slide-in-left": "slide-in-left 0.25s ease-out both",
        "shimmer":       "shimmer 2s linear infinite",
        "pulse-glow":    "pulse-glow 2.5s ease-in-out infinite",
        "count-up":      "count-up 0.4s ease-out both",
        "spin-slow":     "spin-slow 8s linear infinite",
      },
      transitionTimingFunction: {
        "spring": "cubic-bezier(0.34, 1.56, 0.64, 1)",
        "smooth": "cubic-bezier(0.4, 0, 0.2, 1)",
      },
      boxShadow: {
        "glow-accent":  "0 0 20px rgba(0, 217, 165, 0.15), 0 0 60px rgba(0, 217, 165, 0.05)",
        "glow-accent2": "0 0 20px rgba(0, 184, 255, 0.15), 0 0 60px rgba(0, 184, 255, 0.05)",
        "card":   "0 1px 3px rgba(0,0,0,0.3), 0 4px 12px rgba(0,0,0,0.2)",
        "card-lg": "0 4px 24px rgba(0,0,0,0.35), 0 1px 4px rgba(0,0,0,0.25)",
        "inset-top": "inset 0 1px 0 rgba(255,255,255,0.06)",
      },
    },
  },
  plugins: [],
};

export default config;
