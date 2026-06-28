/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: "#16181D", soft: "#1E2128", line: "#2A2E37" },
        paper: "#F5F2EC",
        lamp: { DEFAULT: "#E8A33D", glow: "#F2C078", deep: "#C77F2B" },
        sage: "#7A9B8E",
        clay: "#C76B5A",
        mist: "#8A909C",
      },
      fontFamily: {
        display: ['"Fraunces"', "serif"],
        sans: ['"Inter"', "system-ui", "sans-serif"],
        mono: ['"IBM Plex Mono"', "monospace"],
      },
    },
  },
  plugins: [],
};
