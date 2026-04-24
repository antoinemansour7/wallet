# wealthsimple DESIGN.md

> Auto-generated design system — reverse-engineered via static analysis by skillui.
> Frameworks: None detected
> Colors: 20 · Fonts: 2 · Components: 7
> Icon library: not detected · State: not detected
> Primary theme: dark · Dark mode toggle: no · Motion: expressive

## Visual Reference

**Match this design exactly** — study colors, fonts, spacing, and component shapes before writing any UI code.

![wealthsimple Homepage](../screenshots/homepage.png)

---

## 1. Visual Theme & Atmosphere

This is a **dark-themed** interface with a warm tone. Depth is expressed through layered shadows and subtle surface color variation. Typography pairs **the-future** for display/headings with **tiempos** for body text, creating clear visual hierarchy through type contrast. Spacing follows a **4px base grid** (compact density), with scale: 2, 4, 6, 8, 10, 12, 14, 16px. The accent color **#ff8a71** anchors interactive elements (buttons, links, focus rings). Motion is expressive — spring physics, layout animations, and staggered reveals are part of the visual language.

---

## 2. Color Palette & Roles

| Token | Hex | Role | Use |
|---|---|---|---|
| color-text | `#32302f` | background | Page background, darkest surface |
| blobs-background-color | `#000000` | surface | Card and panel backgrounds |
| color-text-button-primary | `#ffffff` | text-primary | Headings and body text |
| color-text-light | `#686664` | text-muted | Captions, placeholders, secondary info |
| color-text-error-secondary | `#753323` | text-muted | Captions, placeholders, secondary info |
| color-hover-border-media-controls | `#564c47` | border | Dividers, card borders, outlines |
| color-text-error | `#ff8a71` | accent | CTAs, links, focus rings, active states |
| color-text-error | `#a43d12` | danger | Error states, destructive actions |
| color-text-success | `#486635` | success | Success states, positive indicators |
| warning | `#e3b94d` | warning | Warning states, caution indicators |
| color-scrollbar-track | `#f5f3ef` | unknown | Palette color |
| nav-border-color | `#e4e2e1` | unknown | Palette color |
| ws-color-midnight | `#09090a` | unknown | Palette color |
| color-text-light | `#c9c6c4` | unknown | Palette color |
| color-scrollbar-thumb | `#afaaa7` | unknown | Palette color |
| ws-color-slate-60 | `#9a9694` | unknown | Palette color |
| color-text-success | `#99b56e` | unknown | Palette color |
| ws-color-slate-10 | `#1c1b1b` | unknown | Palette color |
| unknown | `#f6edd0` | unknown | Palette color |
| calculator-slider-button-bg-color | `#e4e9d3` | unknown | Palette color |

### CSS Variable Tokens

```css
--nav-background-color: #fcfcfc;
--nav-border-color: #e4e2e1;
--color-text-muted: #32302f;
--color-text-success-secondary: #486635;
--color-text-error-secondary: #a43d12;
--color-outlines-secondary: #32302f;
--color-borders: #32302f;
--color-button-primary: #32302f;
--color-text-button-primary: #fff;
--color-hover-button-primary: rgba(252,252,252,0.2);
--color-button-secondary: #fcfcfc;
--color-text-button-secondary: #32302f;
--color-hover-button-secondary: rgba(50,48,47,0.2);
--color-border-button-secondary: #32302f;
--color-focus-ring-button-secondary: #e4e2e1;
--color-text-input-secondary: #32302f;
--color-text-placeholder-secondary: #686664;
--color-border-media-controls: #e4e2e1;
--color-hover-border-media-controls: currentColor;
--color-table-border: #e4e2e1;
```


---

## 3. Typography Rules

**Font Stack:**
- **tiempos** — Heading 1, Heading 2, Heading 3
- **the-future** — Body, Caption

**Font Sources:**

```css
@font-face {
  font-family: "the-future";
  src: url("fonts/the-future-Regular.woff2") format("woff2");
  font-weight: 400;
}
@font-face {
  font-family: "tiempos";
  src: url("fonts/tiempos-Regular.woff2") format("woff2");
  font-weight: 400;
}
@font-face {
  font-family: "futura-pt-condensed";
  src: url("fonts/futura-pt-condensed-800.woff2") format("woff2");
  font-weight: 800;
}
@font-face {
  font-family: "futura-pt-light";
  src: url("fonts/futura-pt-light-200.woff2") format("woff2");
  font-weight: 200;
}
@font-face {
  font-family: "wealthsimple-sans";
  src: url("fonts/wealthsimple-sans-500.woff2") format("woff2");
  font-weight: 500;
}
@font-face {
  font-family: "wealthsimple-display-sans";
  src: url("fonts/wealthsimple-display-sans-Regular.woff2") format("woff2");
  font-weight: 400;
}
```

| Role | Font | Size | Weight |
|---|---|---|---|
| Heading 1 | tiempos | 12.5rem | 700 |
| Heading 2 | tiempos | 8rem | 700 |
| Heading 3 | tiempos | clamp(8rem,6.77vw + 6.68rem,12.5rem) | 700 |
| Body | the-future | 1.125rem | 400 |
| Caption | the-future | 1.25rem | 400 |

**Typographic Rules:**
- Limit to 2 font families max per screen
- Use **tiempos** for body/UI text, **the-future** for display/headings
- Maintain consistent hierarchy: no more than 3-4 font sizes per screen
- Headings use bold (600-700), body uses regular (400)
- Line height: 1.5 for body text, 1.2 for headings
- Use color and opacity for secondary hierarchy, not additional font sizes


---

## 4. Component Stylings

### Layout (1)

**Footer** — `html`

### Navigation (1)

**Navigation** — `html`

### Data Input (2)

**Button** — `html`
- Animation: 

**Input** — `html`
- State: :focus, :placeholder

### Media (3)

**Image** — `html`

**Icon** — `html`

**Map/Canvas** — `html`



---

## 5. Layout Principles

- **Base spacing unit:** 4px
- **Spacing scale:** 2, 4, 6, 8, 10, 12, 14, 16, 20, 22, 24, 28
- **Border radius:** 0px 12px, .125rem, .25rem, .3125rem, .375rem, .5rem, .75rem, 1rem, 1px, 1.25rem, 1.5rem, 1.625rem, 2rem, 2px, 2.19rem, 2.5rem, 3.5rem, 4px, 6.25rem, 9.1875rem, 10%, 12px, 16px, 20%, 24px, 100rem, 100%, 100px, 500px, 1000px
- **Max content width:** 1280px

**Spacing as Meaning:**
| Spacing | Use |
|---|---|
| 4-8px | Tight: related items within a group |
| 12-16px | Medium: between groups |
| 24-32px | Wide: between sections |
| 48px+ | Vast: major section breaks |


---

## 6. Depth & Elevation

### Raised — cards, buttons, interactive elements

- `0 4px 8px -2px rgba(16,24,40,.1),0 2px 4px -2px rgba(16,24,40,.06)`
- `0 1.5rem 3rem -.75rem rgba(16,24,40,.08)`
- `0 2px 5px 0 rgba(0,0,0,.18)`

### Floating — dropdowns, popovers, modals

- `0 12px 16px -4px rgba(16,24,40,.08),0 4px 6px -2px rgba(16,24,40,.03)`
- `0 2px 10px rgba(0,0,0,.07)`

### Overlay — full-screen overlays, top-level dialogs

- `0 0 206px 98px var(--blobs-blob-color)`
- `0 4px 64px 0#978b7c`

### Z-Index Scale

`0, 1, 2, 3, 10, 15, 16, 20, 25, 100, 1000, 9999, 10000`



---

## 7. Animation & Motion

This project uses **expressive motion**. Animations are an integral part of the experience.

### CSS Animations

- `@keyframes detectScroll`
- `@keyframes Hero_detectScroll__8QKN5`
- `@keyframes NotificationBannerContentV2_detectScroll__dSNyb`
- `@keyframes Button_detectScroll__RFKO6`
- `@keyframes MediaControls_detectScroll__ysJWg`
- `@keyframes TLDRSection_detectScroll__vhqcb`
- `@keyframes WealthsimpleEyebrowContent_detectScroll__1Lkgl`
- `@keyframes CategoryHero_detectScroll__1zbMa`

### Animated Components

- **Button**: 

### Motion Guidelines

- Duration: 150-300ms for micro-interactions, 300-500ms for page transitions
- Easing: `ease-out` for enters, `ease-in` for exits
- Always respect `prefers-reduced-motion`


---

## 8. Do's and Don'ts

### Do's

- Use `#ff8a71` for interactive elements (buttons, links, focus rings)
- Use `#32302f` as the primary page background
- Pair **tiempos** (body) with **the-future** (display) — these are the only allowed fonts
- Follow the **4px** spacing grid for all margins, padding, and gaps
- Use the defined shadow tokens for elevation — see Section 6
- Use border-radius from the scale: 0px 12px, .125rem, .25rem, .3125rem, .375rem
- Reuse existing components from Section 4 before creating new ones

### Don'ts

- Don't introduce colors outside this palette — extend the design tokens first
- Don't introduce additional font families beyond tiempos and the-future
- Don't use arbitrary spacing values — stick to multiples of 4px
- Don't create custom box-shadow values outside the system tokens
- Don't use arbitrary border-radius values — pick from the defined scale
- Don't duplicate component patterns — check Section 4 first
- Don't use backdrop-blur or blur effects

### Anti-Patterns (detected from codebase)

- No blur or backdrop-blur effects
- No zebra striping on tables/lists


---

## 9. Responsive Behavior

| Name | Value | Source |
|---|---|---|
| xs | 27.3333125rem | css |
| xs | 30rem | css |
| xl | 80rem | css |
| xs | 375px | css |
| xs | 480px | css |
| sm | 482px | css |
| sm | 600px | css |
| sm | 640px | css |
| md | 767px | css |
| md | 768px | css |
| lg | 769px | css |
| lg | 960px | css |
| lg | 1023px | css |
| lg | 1024px | css |
| xl | 1150px | css |
| xl | 1250px | css |
| xl | 1280px | css |
| 2xl | 1380px | css |
| 2xl | 1440px | css |
| 2xl | 1800px | css |

**Approach:** Use `@media (min-width: ...)` queries matching the breakpoints above.


---

## 10. Agent Prompt Guide

Use these as starting points when building new UI:

### Build a Card

```
Background: #000000
Border: 1px solid #564c47
Radius: 2.5rem
Padding: 16px
Font: tiempos
Use shadow tokens from Section 6.
```

### Build a Button

```
Primary: bg #ff8a71, text white
Ghost: bg transparent, border #564c47
Padding: 8px 16px
Radius: 2.5rem
Hover: opacity 0.9 or lighter shade
Focus: ring with #ff8a71
```

### Build a Page Layout

```
Background: #32302f
Max-width: 1280px, centered
Grid: 4px base
Responsive: mobile-first, breakpoints from Section 9
```

### Build a Stats Card

```
Surface: #000000
Label: #686664 (muted, 12px, uppercase)
Value: #ffffff (primary, 24-32px, bold)
Status: use success/warning/danger from Section 2
```

### Build a Form

```
Input bg: #32302f
Input border: 1px solid #564c47
Focus: border-color #ff8a71
Label: #686664 12px
Spacing: 16px between fields
Radius: 2.5rem
```

### General Component

```
1. Read DESIGN.md Sections 2-6 for tokens
2. Colors: only from palette
3. Font: tiempos, type scale from Section 3
4. Spacing: 4px grid
5. Components: match patterns from Section 4
6. Elevation: shadow tokens
```
