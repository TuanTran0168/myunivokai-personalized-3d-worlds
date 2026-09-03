import type { Config } from "tailwindcss";

// House design system — "The Vitrine + Liquid Glass" (agent-system/memory/execution-records/frontend-refactor-plan.md §V).
//
// V1 (feat/fe/v-foundation-tokens) is a SHIM migration: the legacy Material-Design-3
// token NAMES (surface / on-surface / primary-container / *-fixed / secondary ...)
// are kept so existing components keep compiling, but their VALUES are remapped to
// the warm-true-black + single-brass house palette. Later V-branches migrate call
// sites onto the new house names below, and a final cleanup deletes the legacy
// aliases. Until then nothing reflows mid-migration — only the look changes.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // ---- House palette (new names; prefer these going forward) ----
        void: "#08080A", // page ground behind the full-bleed world
        mount: "#0B0B0E", // warm near-black island base (under the glass tint)
        card: "#131217",
        "card-hover": "#1A181E",
        paper: "#F2EEE6", // warm gallery-white
        // Raised 2026-08-01 with the glass tint drop: these were tuned against a
        // dark wash behind them. With the material near-clear they sit straight
        // on the live world, and a bright forest canopy ate them.
        grey: "#DCD7CB",
        faint: "#A79D8A",
        // The single metallic accent, taken from a CSS variable so a world
        // family can retint the whole interface (see body[data-world-family] in
        // globals.css). The <alpha-value> form is what keeps bg-brass/10,
        // ring-brass/40 and friends working.
        brass: "rgb(var(--brass-rgb) / <alpha-value>)",
        "brass-deep": "rgb(var(--brass-deep-rgb) / <alpha-value>)",
        vermillion: "#E0573A", // the live dot only
        ink: "#1B1402", // engraved dark label on brass fills
        hairline: "rgba(255,255,255,0.10)",

        // ---- Legacy MD3 names (SHIM: remapped to the house palette) ----
        surface: "#0B0B0E",
        "surface-lowest": "#08080A",
        "surface-low": "#131217",
        "surface-container": "#15141A",
        "surface-high": "#1A181E",
        "surface-bright": "#222028",
        "on-surface": "#F2EEE6",
        "on-surface-variant": "#DCD7CB",
        outline: "#A79D8A",
        "outline-variant": "#2A2730",
        // These legacy aliases follow the accent variable too, or the chips and
        // rings they colour would stay brass while the rest of a forest went
        // copper.
        primary: "rgb(var(--brass-rgb) / <alpha-value>)",
        "primary-container": "rgb(var(--brass-rgb) / <alpha-value>)",
        "primary-fixed": "#E7D6AE",
        "on-primary-fixed": "#1B1402",
        secondary: "rgb(var(--brass-rgb) / <alpha-value>)",
        "secondary-container": "rgb(var(--brass-deep-rgb) / <alpha-value>)",
        "secondary-fixed": "#E7D6AE",
        "on-secondary-fixed": "#1B1402",
        tertiary: "rgb(var(--brass-rgb) / <alpha-value>)",
        error: "#E86A52",
        "error-container": "#5A1B10"
      },
      fontSize: {
        "display-lg": ["48px", { lineHeight: "1.05", letterSpacing: "0", fontWeight: "600" }],
        "display-lg-mobile": ["32px", { lineHeight: "1.1", letterSpacing: "0", fontWeight: "600" }],
        "headline-md": ["24px", { lineHeight: "1.2", letterSpacing: "0", fontWeight: "600" }],
        "body-lg": ["18px", { lineHeight: "1.6", fontWeight: "400" }],
        // Engraved brass small-caps label — kept (on-brand for the gallery voice).
        "label-caps": ["11px", { lineHeight: "1", letterSpacing: "0.2em", fontWeight: "600" }],
        "stat-lg": ["28px", { lineHeight: "1", fontWeight: "600" }]
      },
      maxWidth: {
        "container-max": "1440px"
      },
      spacing: {
        "margin-mobile": "16px",
        "margin-desktop": "48px",
        gutter: "24px",
        // What a scrolling page needs so its first and last lines are not
        // underneath the fixed chrome. Both derive from the 57px
        // --header-height / --footer-height contract in globals.css rather than
        // from the 76 and 12 and 16 that were written out at each call site —
        // which is how the gallery's last row of cards ended up sitting under
        // the footer while the profile page's did not.
        "header-clear": "calc(var(--header-height) + 19px)",
        "footer-clear": "calc(var(--footer-height) + 19px)",
        // The bar heights exactly, for a screen that CENTRES one panel between
        // the two rather than scrolling under them: there the clearance would
        // shift the panel off centre.
        "header-height": "var(--header-height)",
        "footer-height": "var(--footer-height)"
      },
      borderRadius: {
        glass: "22px"
      },
      boxShadow: {
        // Emphasis is value contrast + brass rule + a soft LIFT, never neon glow.
        lift: "0 30px 70px -22px rgba(0,0,0,0.7)",
        "brass-lift": "0 8px 22px -8px rgb(var(--brass-rgb) / 0.55)"
        // The legacy `glow` and `cyan` aliases are gone. They had been remapped
        // to the neutral lift, which meant every chip and option card was
        // carrying a 70px island shadow — lift belongs to a floating island, not
        // to a control inside one. Removing the call sites orphaned them.
      },
      fontFamily: {
        // Editorial serif masthead (production self-hosts a Didone via next/font;
        // until then a high-quality serif system stack carries the voice).
        display: ['"Iowan Old Style"', '"Palatino Linotype"', "Palatino", '"Book Antiqua"', "Georgia", "serif"],
        serif: ['"Iowan Old Style"', '"Palatino Linotype"', "Palatino", '"Book Antiqua"', "Georgia", "serif"],
        body: ["var(--font-inter)", "sans-serif"],
        mono: ["var(--font-jetbrains-mono)", "monospace"]
      }
    }
  },
  plugins: []
};

export default config;
