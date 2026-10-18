/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: { center: true, padding: "2rem", screens: { "2xl": "1400px" } },
    extend: {
      screens: {
        // Phones on their side: wide but very short. Focus mode switches to
        // a side-by-side layout here so the timer isn't pushed off screen.
        // An aspect ratio rather than orientation:landscape: some Android
        // browsers shrink the page for the on-screen keyboard, and a portrait
        // phone typing in chat (~1:1) must not flip into this layout. Phones
        // on their side are 1.8:1 to 3:1 (with or without browser bars).
        ls: { raw: "(min-aspect-ratio: 3/2) and (max-height: 540px) and (max-width: 1023px)" },
        // The shortest landscape (a phone on its side with Safari's bars).
        lstiny: { raw: "(min-aspect-ratio: 3/2) and (max-height: 360px) and (max-width: 1023px)" },
        // Samsung Internet on its side shows bars top AND bottom (~256px left).
        lsmicro: { raw: "(min-aspect-ratio: 3/2) and (max-height: 280px) and (max-width: 1023px)" },
        // Shorter portrait phones (SE, mini, or with browser chrome showing).
        // ...and narrow ones (foldable cover screens, ~344px), where the control
        // row would otherwise wrap however tall the screen is.
        short: { raw: "(orientation: portrait) and (max-height: 780px), (orientation: portrait) and (max-width: 359px)" },
        // Very short portrait (iPhone SE with Safari's toolbars, 720p Android).
        tiny: { raw: "(orientation: portrait) and (max-height: 680px)" },
        // Desktop-width but short (iPad landscape, small laptops).
        lgshort: { raw: "(min-width: 1024px) and (max-height: 860px)" },
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        roamly: {
          purple: "hsl(var(--roamly-purple))",
          coral: "hsl(var(--roamly-coral))",
          blue: "hsl(var(--roamly-blue))",
          green: "hsl(var(--roamly-green))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        display: ['"Fraunces"', "serif"],
        sans: ['"Inter"', "system-ui", "sans-serif"],
        mono: ['"IBM Plex Mono"', "monospace"],
      },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up": { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
