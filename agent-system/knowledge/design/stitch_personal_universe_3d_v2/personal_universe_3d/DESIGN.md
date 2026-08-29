---
name: Personal Universe 3D
document_status: superseded-visual-reference
last_source_review: '2026-07-18'
colors:
  surface: '#0e1323'
  surface-dim: '#0e1323'
  surface-bright: '#34394a'
  surface-container-lowest: '#080d1d'
  surface-container-low: '#161b2b'
  surface-container: '#1a1f30'
  surface-container-high: '#25293a'
  surface-container-highest: '#2f3446'
  on-surface: '#dee1f9'
  on-surface-variant: '#cbc3d7'
  inverse-surface: '#dee1f9'
  inverse-on-surface: '#2b3041'
  outline: '#958ea0'
  outline-variant: '#494454'
  surface-tint: '#d0bcff'
  primary: '#d0bcff'
  on-primary: '#3c0091'
  primary-container: '#a078ff'
  on-primary-container: '#340080'
  inverse-primary: '#6d3bd7'
  secondary: '#4cd7f6'
  on-secondary: '#003640'
  secondary-container: '#03b5d3'
  on-secondary-container: '#00424e'
  tertiary: '#eec200'
  on-tertiary: '#3c2f00'
  tertiary-container: '#cea700'
  on-tertiary-container: '#4e3e00'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e9ddff'
  primary-fixed-dim: '#d0bcff'
  on-primary-fixed: '#23005c'
  on-primary-fixed-variant: '#5516be'
  secondary-fixed: '#acedff'
  secondary-fixed-dim: '#4cd7f6'
  on-secondary-fixed: '#001f26'
  on-secondary-fixed-variant: '#004e5c'
  tertiary-fixed: '#ffe083'
  tertiary-fixed-dim: '#eec200'
  on-tertiary-fixed: '#231b00'
  on-tertiary-fixed-variant: '#574500'
  background: '#0e1323'
  on-background: '#dee1f9'
  surface-variant: '#2f3446'
typography:
  display-lg:
    fontFamily: Space Grotesk
    fontSize: 48px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: 0.05em
  display-lg-mobile:
    fontFamily: Space Grotesk
    fontSize: 32px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: 0.05em
  headline-md:
    fontFamily: Space Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
    letterSpacing: 0.02em
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
  label-caps:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1'
    letterSpacing: 0.1em
  stat-lg:
    fontFamily: JetBrains Mono
    fontSize: 28px
    fontWeight: '600'
    lineHeight: '1'
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 48px
  container-max: 1440px
---

> This v2 mockup remains a layout reference, but its purple/cyan visual
> language is superseded by the Vitrine/Liquid-Glass system implemented in
> the frontend and recorded in `agent-system/memory/execution-records/frontend-refactor-plan.md`.

## Brand & Style

The design system is a premium, cosmic-inspired interface designed for high-end AI monitoring and personal data exploration. It evokes the feeling of a futuristic command deck, blending deep celestial tones with vibrant neon accents. 

The aesthetic is rooted in **Glassmorphism** and **Futuristic Minimalism**. It prioritizes depth through translucent layers, background blurs, and luminous highlights. Every interaction should feel like manipulating light and data in a weightless environment. The visual narrative focuses on clarity amidst complexity, using glow and transparency to guide the user's focus toward critical AI-driven insights.

## Colors

This design system utilizes a "Deep Space" palette. The foundation is a rich, near-black navy to provide maximum contrast for neon elements. 

- **Primary Neon Purple** is used for core brand actions and primary focus states.
- **Secondary Cyan** represents active AI processes, data streams, and secondary interactions.
- **Accent Gold** is reserved for high-priority alerts, achievements, or premium tier features.
- **Surface Glass** uses a semi-transparent slate blue with a high backdrop blur (20px+) to create the signature cosmic depth.
- **Border Glow** is a functional token for subtle luminance on component edges, simulating a light-leak effect from the internal neon UI.

## Typography

The typographic hierarchy balances technical precision with editorial flair. 

- **Headlines:** Use **Space Grotesk** with wide tracking. This geometric sans-serif provides the "sci-fi dashboard" feel. All-caps should be used sparingly for section headers to enhance the architectural look.
- **Body:** **Inter** is used for all long-form content and UI labels to ensure maximum legibility against dark, blurred backgrounds.
- **Data/Stats:** **JetBrains Mono** is utilized for numerical data, coordinates, and system status labels. The monospaced nature reinforces the AI/coding narrative of the product.

## Layout & Spacing

This design system employs a **Fluid Grid** with generous inner padding to allow the glassmorphic surfaces to "breathe." 

- **Grid:** 12-column system on desktop, 4-column on mobile.
- **Rhythm:** An 8px base scaling system is used for most components, but 4px increments are allowed for tight data-heavy tables.
- **Margins:** Desktop layouts should maintain significant outer margins (48px+) to create a "floating" viewport effect, as if the UI is a HUD (Heads-Up Display) overlaying a 3D environment.
- **Mobile Reflow:** On mobile, glass cards should lose their external glow to save performance, transitioning to simple high-contrast borders.

## Elevation & Depth

Hierarchy is established through **Backdrop Blurs** and **Luminous Outlines** rather than traditional shadows.

1.  **Level 0 (Background):** Deep `#050816` with a faint noise texture to prevent banding.
2.  **Level 1 (Cards/Panels):** Surface Glass (`rgba(15, 23, 42, 0.72)`) with a 20px blur and a 1px solid border of `rgba(255, 255, 255, 0.1)`.
3.  **Level 2 (Active/Hover):** Add the **Border Glow** (`rgba(139, 92, 246, 0.35)`) and increase the backdrop saturation.
4.  **Level 3 (Floating Modals):** Highest elevation. Uses a dual-border technique: a 1px white-to-transparent gradient border and a thick 100px-spread soft purple shadow (opacity 10%) to simulate light emission.

## Shapes

The design system uses a distinctive **24px (rounded-xl)** corner radius for all primary containers and cards. This large radius softens the technical aesthetic, making the futuristic interface feel more approachable and "liquid."

- **Primary Cards:** 24px (1.5rem)
- **Buttons & Inputs:** 12px (0.75rem)
- **Small Chips/Labels:** 8px (0.5rem) or fully rounded (pill).

## Components

### Buttons
Primary buttons use a linear gradient from **Neon Purple** to **Secondary Cyan** (45 degrees). They must feature a `drop-shadow` that matches the gradient color at 40% opacity to create a "glowing" effect. Hover states should increase the brightness and scale slightly (1.02x).

### Floating Glass Cards
The signature component. Must have `backdrop-filter: blur(20px)` and a thin, 1px top-down gradient stroke. The top-left corner of the stroke should be more opaque than the bottom-right to simulate a distant light source.

### Inputs & Form Fields
Fields are dark and recessed. Use a subtle inner-shadow to suggest depth. The focus state replaces the border with a solid **Secondary Cyan** and a subtle outer glow.

### Chips & Tags
Small, semi-transparent badges. For AI-generated content, use a "Shimmer" animation on the background of the chip to signify active processing.

### Data Visualization
Charts should use neon line weights (2px) with area fills that use a vertical gradient fading to 0% opacity. Data points should be small glowing circles.

### AI Pulse
A specialized component: A circular or amorphous gradient blur that pulses slowly in the background of the screen or behind specific AI-suggested actions to indicate system "thought" or activity.
