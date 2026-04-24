# Animation Reference

> Cinematic motion design extracted from live DOM. Follow these specs exactly to recreate the experience.

## Motion Technology Stack

| Library | Type | Notes |
|---------|------|-------|
| Canvas (1 elements) | WebGL/3D | WebGL context detected — likely Three.js or custom shader |

## Scroll Journey

The page is **10,342px** tall. Each frame below shows what the user sees at that scroll depth.

> **Use these screenshots to understand WHAT animates, WHEN it animates, and HOW it moves.**

### 0% — Top / Hero
Scroll position: 0px

![Scroll 0%](../screens/scroll/scroll-000.png)

### 17% — Opening Section
Scroll position: 1,605px

![Scroll 17%](../screens/scroll/scroll-017.png)

### 33% — First Feature Section
Scroll position: 3,116px

![Scroll 33%](../screens/scroll/scroll-033.png)

### 50% — Mid-Page
Scroll position: 4,721px

![Scroll 50%](../screens/scroll/scroll-050.png)

### 67% — Lower Content
Scroll position: 6,326px

![Scroll 67%](../screens/scroll/scroll-067.png)

### 83% — Near Footer
Scroll position: 7,837px

![Scroll 83%](../screens/scroll/scroll-083.png)

### 100% — Bottom / Footer
Scroll position: 9,442px

![Scroll 100%](../screens/scroll/scroll-100.png)

## Video Elements

| # | Role | Autoplay | Loop | Muted | Size | First Frame |
|---|------|----------|------|-------|------|-------------|
| 1 | background | ✓ | ✓ | ✓ | 1440×900 | [view](../screens/scroll/video-1-frame.png) |
| 2 | content | ✓ | ✓ | ✓ | — | — |
| 3 | background | ✓ | ✓ | ✓ | 1440×900 | — |
| 4 | content | ✓ | ✓ | ✓ | — | — |
| 5 | background | ✓ | ✓ | ✓ | 1440×900 | — |
| 6 | content | ✓ | ✓ | ✓ | — | — |

**Video 1 first frame:**

![Video 1 Frame](../screens/scroll/video-1-frame.png)

- **Source:** `https://videos.ctfassets.net/v44fuld738we/6CW8R3KTtYz9TyH2MSSa5V/cec3a270a9e585ece4b49091a86518c2/MoreIsMore_EN_Desktop_`
- **Poster:** `https://www.wealthsimple.com/cdn-cgi/image/format=auto,quality=75,width=2048,fit=scale-down/https://images.ctfassets.net`
- **Source:** `https://videos.ctfassets.net/v44fuld738we/40RNzJ92ydtVDxOEzG1HE2/4b53bb8d1cbda94ca366e1c797f788dd/MoreIsMore_EN_Mobile-h`
- **Poster:** `https://www.wealthsimple.com/cdn-cgi/image/format=auto,quality=75,width=1920,fit=scale-down/https://images.ctfassets.net`

## CSS Keyframes (41 extracted)

### `@keyframes Blobs_blobAnimation1__V7SsT`

Used by: `.Blobs_blobPrimaryVariant___bx90C:first-child`, `.Blobs_blobSecondaryVariant___IUuAH:first-child`

```css
@keyframes Blobs_blobAnimation1__V7SsT {
  0% {
    transform: rotate(45deg) scale(0.8);
  }
  100% {
    transform: rotate(90deg) scale(1.1);
  }
}
```

> Transform/motion animation

### `@keyframes Blobs_blobAnimation2__f_Cld`

Used by: `.Blobs_blobPrimaryVariant___bx90C:nth-child(2)`, `.Blobs_blobSecondaryVariant___IUuAH:nth-child(2)`

```css
@keyframes Blobs_blobAnimation2__f_Cld {
  0% {
    transform: skew(15deg) rotate(135deg) scale(0.8);
  }
  100% {
    transform: skew(0deg) rotate(90deg) scale(1.1);
  }
}
```

> Transform/motion animation

### `@keyframes AnchorNavigation_detectScroll__Evejw`

Duration: `auto` · Easing: `linear` · Delay: `0s` · Iteration: `1` · Fill: `none`

Used by: `.AnchorNavigation_anchorNavigation___sH4cF`

```css
@keyframes AnchorNavigation_detectScroll__Evejw {
  0%, 100% {
    --can-scroll: 1;
  }
}
```

### `@keyframes Tabs_detectScroll__ocB4G`

Duration: `auto` · Easing: `linear` · Delay: `0s` · Iteration: `1` · Fill: `none`

Used by: `.Tabs_tabBar___H987V`

```css
@keyframes Tabs_detectScroll__ocB4G {
  0%, 100% {
    --can-scroll: 1;
  }
}
```

### `@keyframes GoldSVGPill_fadeIn__VIJnj`

Duration: `0.3s` · Easing: `ease-in` · Delay: `0s` · Iteration: `1` · Fill: `forwards`

Used by: `.GoldSVGPill_pill___Y1WfJ[data-animate="true"]`

```css
@keyframes GoldSVGPill_fadeIn__VIJnj {
  0% {
    opacity: 0;
  }
  100% {
    opacity: 1;
  }
}
```

> Opacity fade

### `@keyframes InternationalTransferCalculator_rotation__s8z_Y`

Duration: `1s` · Easing: `linear` · Delay: `0s` · Iteration: `infinite` · Fill: `none`

Used by: `.InternationalTransferCalculator_loader___vjFrH`

```css
@keyframes InternationalTransferCalculator_rotation__s8z_Y {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(1turn);
  }
}
```

> Transform/motion animation

### `@keyframes detectScroll`

```css
@keyframes detectScroll {
  0%, 100% {
    --can-scroll: 1;
  }
}
```

### `@keyframes Hero_detectScroll__8QKN5`

```css
@keyframes Hero_detectScroll__8QKN5 {
  0%, 100% {
    --can-scroll: 1;
  }
}
```

### `@keyframes NotificationBannerContentV2_detectScroll__dSNyb`

```css
@keyframes NotificationBannerContentV2_detectScroll__dSNyb {
  0%, 100% {
    --can-scroll: 1;
  }
}
```

### `@keyframes Button_detectScroll__RFKO6`

```css
@keyframes Button_detectScroll__RFKO6 {
  0%, 100% {
    --can-scroll: 1;
  }
}
```

### `@keyframes MediaControls_detectScroll__ysJWg`

```css
@keyframes MediaControls_detectScroll__ysJWg {
  0%, 100% {
    --can-scroll: 1;
  }
}
```

### `@keyframes TLDRSection_detectScroll__vhqcb`

```css
@keyframes TLDRSection_detectScroll__vhqcb {
  0%, 100% {
    --can-scroll: 1;
  }
}
```

### `@keyframes WealthsimpleEyebrowContent_detectScroll__1Lkgl`

```css
@keyframes WealthsimpleEyebrowContent_detectScroll__1Lkgl {
  0%, 100% {
    --can-scroll: 1;
  }
}
```

### `@keyframes CategoryHero_detectScroll__1zbMa`

```css
@keyframes CategoryHero_detectScroll__1zbMa {
  0%, 100% {
    --can-scroll: 1;
  }
}
```

### `@keyframes Thesis_detectScroll__lmnrJ`

```css
@keyframes Thesis_detectScroll__lmnrJ {
  0%, 100% {
    --can-scroll: 1;
  }
}
```

### `@keyframes Spotlight_detectScroll__HQfyM`

```css
@keyframes Spotlight_detectScroll__HQfyM {
  0%, 100% {
    --can-scroll: 1;
  }
}
```

### `@keyframes Footer_detectScroll___Gu71`

```css
@keyframes Footer_detectScroll___Gu71 {
  0%, 100% {
    --can-scroll: 1;
  }
}
```

### `@keyframes AccountTile_detectScroll__06QZM`

```css
@keyframes AccountTile_detectScroll__06QZM {
  0%, 100% {
    --can-scroll: 1;
  }
}
```

### `@keyframes AccountTiles_detectScroll__nJ5o4`

```css
@keyframes AccountTiles_detectScroll__nJ5o4 {
  0%, 100% {
    --can-scroll: 1;
  }
}
```

### `@keyframes AccountFilter_detectScroll__OwMX2`

```css
@keyframes AccountFilter_detectScroll__OwMX2 {
  0%, 100% {
    --can-scroll: 1;
  }
}
```

### `@keyframes Grid_detectScroll__g70aS`

```css
@keyframes Grid_detectScroll__g70aS {
  0%, 100% {
    --can-scroll: 1;
  }
}
```

### `@keyframes Benefits_detectScroll__FHXZk`

```css
@keyframes Benefits_detectScroll__FHXZk {
  0%, 100% {
    --can-scroll: 1;
  }
}
```

### `@keyframes ProductHero_detectScroll__QfjSm`

```css
@keyframes ProductHero_detectScroll__QfjSm {
  0%, 100% {
    --can-scroll: 1;
  }
}
```

### `@keyframes ProductDemo_detectScroll__LNvle`

```css
@keyframes ProductDemo_detectScroll__LNvle {
  0%, 100% {
    --can-scroll: 1;
  }
}
```

### `@keyframes KeyStat_detectScroll__4pvlr`

```css
@keyframes KeyStat_detectScroll__4pvlr {
  0%, 100% {
    --can-scroll: 1;
  }
}
```

### `@keyframes Countdown_detectScroll__e0Wx2`

```css
@keyframes Countdown_detectScroll__e0Wx2 {
  0%, 100% {
    --can-scroll: 1;
  }
}
```

### `@keyframes Carousel_fadeInSlideUp__6TUNL`

```css
@keyframes Carousel_fadeInSlideUp__6TUNL {
  0% {
    opacity: 0;
    translate: 0px 0.5rem;
  }
  100% {
    opacity: 1;
    translate: 0px;
  }
}
```

> Opacity fade

### `@keyframes Carousel_fadeIn__DVCOT`

```css
@keyframes Carousel_fadeIn__DVCOT {
  0% {
    opacity: 0;
  }
  100% {
    opacity: 1;
  }
}
```

> Opacity fade

### `@keyframes ExplodedMenu_detectScroll__QDLN9`

```css
@keyframes ExplodedMenu_detectScroll__QDLN9 {
  0%, 100% {
    --can-scroll: 1;
  }
}
```

### `@keyframes FinalCTA_detectScroll__LbvqE`

```css
@keyframes FinalCTA_detectScroll__LbvqE {
  0%, 100% {
    --can-scroll: 1;
  }
}
```

### `@keyframes FeatureUi_detectScroll__cXqVQ`

```css
@keyframes FeatureUi_detectScroll__cXqVQ {
  0%, 100% {
    --can-scroll: 1;
  }
}
```

### `@keyframes SearchDrawer_detectScroll__wDqkN`

```css
@keyframes SearchDrawer_detectScroll__wDqkN {
  0%, 100% {
    --can-scroll: 1;
  }
}
```

### `@keyframes SearchDrawer_fadeInUp__0jtHJ`

```css
@keyframes SearchDrawer_fadeInUp__0jtHJ {
  0% {
    opacity: 0;
    transform: translateY(8px);
  }
  100% {
    opacity: 1;
    transform: translateY(0px);
  }
}
```

> Fade + motion enter animation

### `@keyframes Navigation_detectScroll__Ox_w1`

```css
@keyframes Navigation_detectScroll__Ox_w1 {
  0%, 100% {
    --can-scroll: 1;
  }
}
```

### `@keyframes NavPromoCard_detectScroll__KBdMv`

```css
@keyframes NavPromoCard_detectScroll__KBdMv {
  0%, 100% {
    --can-scroll: 1;
  }
}
```

### `@keyframes NavPromoCarousel_detectScroll__jcDwi`

```css
@keyframes NavPromoCarousel_detectScroll__jcDwi {
  0%, 100% {
    --can-scroll: 1;
  }
}
```

### `@keyframes Header_detectScroll__40n99`

```css
@keyframes Header_detectScroll__40n99 {
  0%, 100% {
    --can-scroll: 1;
  }
}
```

### `@keyframes SkipToMainContent_detectScroll__kbcvi`

```css
@keyframes SkipToMainContent_detectScroll__kbcvi {
  0%, 100% {
    --can-scroll: 1;
  }
}
```

### `@keyframes AboutUs_detectScroll__DkKA4`

```css
@keyframes AboutUs_detectScroll__DkKA4 {
  0%, 100% {
    --can-scroll: 1;
  }
}
```

### `@keyframes AnimatedText_tittle-rise__ShAND`

```css
@keyframes AnimatedText_tittle-rise__ShAND {
  0% {
    transform: translateY(0px);
  }
  100% {
    transform: translateY(-0.2em);
  }
}
```

> Transform/motion animation

### `@keyframes AnimatedText_tittle-fall__5eIYw`

```css
@keyframes AnimatedText_tittle-fall__5eIYw {
  0% {
    transform: translateY(-0.2em);
  }
  100% {
    transform: translateY(0px);
  }
}
```

> Transform/motion animation

## Motion Tokens (CSS Variables)

### Duration Tokens

```css
--ws-transition-duration: 0.35s;
```

### Other Tokens

```css
--ws-transition-easing1: cubic-bezier(0.241,0.969,0.635,0.997);
```

## Global Transition Declarations

These `transition` values were extracted from CSS rules across the site:

```css
transition: transform 1s ease-out, opacity 1s ease-out;
transition: visibility cubic-bezier(0.76, 0, 0.24, 1) 0.35s;
transition: grid-template-rows 0.35s cubic-bezier(0.76, 0, 0.24, 1);
transition: visibility 0s var(--ws-transition-duration) var(--ws-transition-easing1);
transition: grid-template-rows var(--ws-transition-duration) var(--ws-transition-easing1),margin-bottom var(--ws-transition-duration) var(--ws-transition-easing1);
transition: border-color var(--ws-transition-duration) var(--ws-transition-easing1),background-color var(--ws-transition-duration) var(--ws-transition-easing1);
transition: opacity var(--ws-transition-duration) var(--ws-transition-easing1);
transition: opacity 0.35s cubic-bezier(0.76, 0, 0.24, 1);
transition: opacity 0.35s linear, visibility linear 0.35s;
transition: background-color 0.35s cubic-bezier(0.76, 0, 0.24, 1);
transition: transform 0.35s cubic-bezier(0.76, 0, 0.24, 1);
transition: transform .3s var(--pill-easing),opacity .3s var(--pill-easing);
```

## How to Recreate This Motion Design

### Step 2 — Scroll-Reveal Pattern

Elements that animate into view follow this pattern:

```css
/* Initial hidden state */
.reveal {
  opacity: 0;
  transform: translateY(40px);
  transition: opacity 0.35s cubic-bezier(0.4, 0, 0.2, 1),
              transform 0.35s cubic-bezier(0.4, 0, 0.2, 1);
}
.reveal.visible {
  opacity: 1;
  transform: translateY(0);
}
```

### Step 3 — Key Motion Principles

- **WebGL/3D layer detected** — product visualizations use Three.js or custom WebGL. Use `<canvas>` with Three.js for 3D product renders
- **Video backgrounds** — use `<video autoplay loop muted playsinline>` for background videos. Always include a poster image fallback
- **Canvas elements (1)** — animated via requestAnimationFrame loop. Use canvas for particle effects, gradient animations, and WebGL scenes
- **Duration scale:** `0.35s` · `1s` · `0s` — use these values, never invent new durations
- **Always add** `@media (prefers-reduced-motion: reduce) { * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }`

### Step 4 — Scroll Journey Reference

Match what happens at each scroll position:

- **0%** (`0px`) → `screens/scroll/scroll-000.png`
- **17%** (`1605px`) → `screens/scroll/scroll-017.png`
- **33%** (`3116px`) → `screens/scroll/scroll-033.png`
- **50%** (`4721px`) → `screens/scroll/scroll-050.png`
- **67%** (`6326px`) → `screens/scroll/scroll-067.png`
- **83%** (`7837px`) → `screens/scroll/scroll-083.png`
- **100%** (`9442px`) → `screens/scroll/scroll-100.png`

