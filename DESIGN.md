# WallAI design system

WallAI gives Canadian investors a calm, editorial view of investment tax and costs. The public story leads with the existing Tax & costs workspace: withholding, fund expenses, FX costs, contribution room and account comparisons. Forest green, warm cream, sage, and serif headlines are its identity. This document replaces the Revolut reference; reference-brand values are not implementation tokens.

## 1. Current implementation and reconciliation

The app is Vite + React 18 + React Router, using Tailwind 3 semantic CSS variables, component CSS, and inline SVG styles. There is no Next.js app router. Login already supplies the closest expression of WallAI: local Tiempos serif, The Future sans, forest gradients, paper, sage charts. Elsewhere Inter is loaded from Google Fonts; Tailwind's display alias is also Inter. SFMono-Regular is the mono fallback. This inconsistency is historical, not a reason to replace the serif.

The source has 196 distinct authored/normalized color literals (Appendix A). Main app light tokens are paper #f5f7f4, ink #17211d, accent #216b50, border #dfe6e1; brand-ground is #203c2d. App dark mode retains legacy #0a0a0c, #141417 and white. Those legacy neutrals are not the marketing identity, and this task does not restyle authenticated screens.

Near-duplicates to consolidate on the two public pages:

| Existing cluster | Canonical role | Reason |
|---|---|---|
| #163629, #20382b, #203a2e, #203c2d, #243f32, #263f30 | forest #203c2d / panel #2c4a35 | One ground and one elevated green, instead of indistinguishable one-offs |
| #23382d, #24392f, #263d2b, #2c4232 | ink #23382d | Preserve warm green text |
| #f8f7f3, #f5f4e9, #f5f6eb, #fcfcf9, #fffefa | cream #f8f7f3 | Consistent paper and inverse text |
| #d6e8aa, #d7e8b2, #d7e2bb, #d8e4bb, #dce8bd | sage #d8e4bb | Quiet highlight and chart line |
| #c1cebd, #c6d0c6, #cbd7bc, #ced7c2 | mist #c6d0c6 | Readable secondary text on forest |
| #686f63, #6c7464, #6d7468 | muted #686f63 | One secondary text color on cream |
| #d8dbd2, #d6dccb, #e0e2da | line #d8dbd2 | Structural borders; stronger input border below |

Existing type is fluid in login (38–78px story, 34–43px form, 30–43px balance), with 8–16px small UI; the app uses Tailwind's default 12/14/16/18/20/24/30/36px ladder plus arbitrary values. Existing spacing combines Tailwind's 4px ladder and custom 3/7/9/11/13/17/23/25px values. Radii include 3/6/8/9/11/12/16/20/30px and pills. Shadows include layered dark Tailwind cards, modal shadows, login's tilted preview and inset sculpture rings. Existing global motion is 150/300ms with cubic-bezier(.76,0,.24,1). Login adds 180–2400ms bespoke transitions, chart drawing and hover rotation; those are reconciled below. Full authored values and color locations are in Appendix A.

### Reference principle disposition

Repeated rules in the old characteristic lists, do/don't list and prompt guide are grouped with their source sections here; every distinct prescription is covered.

| Former principle (source) | Disposition | WallAI rule / reasoning |
|---|---|---|
| Confidence, strong hierarchy, generous whitespace (1) | ADOPT | Readable content with breathing room |
| Aeonik Pro and geometric display identity (1,3,7,9) | REJECT | Keep existing Tiempos serif display; use free Geist Sans for UI |
| Fixed 136px billboard typography (1,3,9) | ADAPT | Fluid 48–96px hero; never overflow a 375px viewport |
| Medium 500 for every heading; never 700 (3,7,9) | ADAPT | Serif 400, UI headings 500/600; size supplies hierarchy |
| Aggressive -2.72px display tracking (1,3) | ADAPT | Serif-friendly -.035em and 1.06 line-height |
| Inter body with mandatory positive tracking (1,3,7) | ADAPT | Geist UI with normal tracking; small uppercase labels .12em |
| Relaxed 1.50–1.56 body leading (1,3) | ADOPT | Body 1.6 for legibility |
| Near-black / pure-white binary (1,2,7,9) | REJECT | Forest / cream / sage |
| Revolut blue, teal, pink and broad semantic spectrum (1,2,9) | REJECT | No imported brand hues; existing muted error colors only in forms |
| Semantic naming and reserved feedback colors (1,2,7) | ADOPT | Role tokens; errors retain text and icon/context |
| Universal pill buttons (1,4,7,9) | ADAPT | Primary and secondary CTAs are pills; inputs and icon controls remain rounded rectangles |
| Generous 14px 32px button padding; no small buttons (4,7) | ADOPT | Minimum 44px targets, normal CTA 52px |
| Hover opacity .85 for all buttons (4) | ADAPT | Explicit surface/border changes preserve text contrast |
| Visible 2px focus ring (4,6) | ADAPT | 2px outline with 4px offset, strong green on cream and sage on dark |
| Dark/light section alternation (4) | ADOPT | Forest hero, cream middle, forest walkthrough and closing |
| Cards at 12/20px radius (4,5) | ADAPT | 12px controls, 20px content, 28px hero preview |
| Zero shadows, depth only through contrast (1,4,6,7,9) | ADAPT | Mostly flat; one subtle forest shadow for lifted illustrative cards |
| Clean navigation, right-aligned pill, hamburger (4) | ADAPT | Simple anchor navigation; mobile retains brand and CTA without a needless menu |
| 20px navigation (4) | ADAPT | 14px UI navigation with 44px touch targets |
| 8px base with half-steps, 80–120px sections (5) | ADOPT | 4px base, 8px rhythm, fluid 80–120px sections |
| Compact mobile; two-column tablet; full desktop (8) | ADAPT | 760px / 1024px breakpoints; static mobile account stack |
| Quick-reference colors and literal component prompts (9) | REJECT | Use the WallAI tokens and patterns in this document |

## 2. Approved tokens

Implementation mirror: `src/components/landing/tokens.css` and `motion.ts`. Public styles are scoped to `.wallai-system`, independent of app theme. No new literal color outside the token file (brand-owned Google sign-in icon excepted).

| Token (`--wa-…`) | Value | Role |
|---|---|---|
| forest | #203c2d | Dark sections, primary button |
| panel | #2c4a35 | Elevated dark cards |
| ink | #23382d | Text on cream |
| cream | #f8f7f3 | Main light surface, inverse text |
| sage | #d8e4bb | Accent, primary CTA on forest, chart |
| soft | #eaf1e3 | Secondary light card |
| mist | #c6d0c6 | Muted text on dark |
| muted | #686f63 | Muted text on cream/soft (use ink on sage) |
| line | #d8dbd2 | Light dividers |
| border | #858e79 | Visible control border |
| focus | #64806a | Focus ring on light |
| error | #96482e | Form error text |
| error-bg | #f7eeea | Form error surface |
| error-border | #dec4ba | Form error border |
| dark-line | sage at 22% | Dark card borders |
| glow | sage at 12% | Pointer spotlight; no new hue |
| shadow | 0 24px 64px -24px forest at 28% | Floating sample card only |

Typography: display `'WallAI Tiempos', Georgia, serif` (reuse `/fonts/tiempos-Regular.woff2`); UI `'WallAI Geist', 'Inter', system-ui, sans-serif`. Geist Sans is SIL OFL 1.1, self-hosted as a shared landing asset with its license. Its compact grotesque proportions, large x-height and readable figures are a practical Aeonik substitute for UI. This is a visual/functional judgment, not a claim of identical measured advance widths. Tiempos's existing asset is retained; no new commercial font is introduced. See [Geist's upstream repository and license](https://github.com/vercel/geist-font).

| Type token | Value | Usage |
|---|---|---|
| hero | clamp(48px, 6.6vw, 96px) / 1.06, 400, -.035em | Serif hero |
| heading | clamp(36px, 4.5vw, 64px) / 1.1, 400, -.03em | Serif section headings |
| title | clamp(24px, 2.6vw, 36px) / 1.2, 400 | Serif card headings |
| balance | clamp(36px, 4vw, 56px) / 1.1, 500, -.04em | Tabular portfolio total |
| body-lg | 18px / 1.6 | Introductory copy |
| body | 16px / 1.6 | Reading and inputs (prevents iOS zoom) |
| small | 14px / 1.5 | UI / secondary copy |
| label | 12px / 1.5 | Labels; uppercase labels track .12em |

Spacing tokens: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 120px. Gutter clamp(24px, 5vw, 80px); content max 1280px; section padding clamp(80px, 9vw, 120px); form max 400px. Radii: control 12px, card 20px, showcase 28px, pill 9999px. Borders 1px; focus 2px with 4px offset. CTA padding 14px 32px, minimum height 52px; all interactive targets at least 44px.

## 3. Layout and components

Hero restores the original three independently masked lines (Your / investments. / All together.) and portfolio preview: $128,450 CAD, an illustrative one-year gain, a 1.5s rising chart stroke, and the attached three-account strip. Preserve the original composition, spring entrance, count-up and orbital linework. Supporting copy and CTA explain Tax & costs. The rising line represents illustrative portfolio value, not tax savings or rising tax costs.

The cream brokerage band qualifies connection/import availability. One view retains the three-card scroll stack, now explaining TFSA room, RRSP room and non-registered withholding. Contribution illustrations start with entered room, deduct sample deposits and explicitly say “based on your records.” Bento keeps its 7/5 then 4/8 grid (two-column tablet, one-column mobile), featuring withholding, contribution room, FX costs and fund expenses. Section 03 uses the original three-agent card composition and scroll sequence to describe the research engine: Nightly search (multi-source discovery), Agent review (Contrarian and Catalyst checks), and Research shortlist (ranking and reports). Retain the connecting lines, scroll-driven entrances and travelling SHOP ticker, explicitly illustrative. The other marketing sections remain tax-focused. “Nightly research” is the existing product/pipeline name; do not add an exact overnight delivery promise. Closing invites visitors to understand their investment costs.

Keep the distinction between available measured data and estimates. Do not promise guaranteed savings, complete coverage, CRA synchronization, filing a tax return, or total tax optimization. The actual account simulator compares dividend withholding only. No statutory rates or annual limits are presented in marketing examples.

Login shares the same static TaxSnapshot and tax-focused supporting copy. The form remains at most 400px with its existing authentication, error/loading feedback, visible borders and focus rings. It introduces no scroll/cursor animation and no Motion/Lenis import. Signup remains the existing account-setup flow; the user can then open Tax & costs.

## 4. Motion

| Token | Value | Use |
|---|---|---|
| fast | 150ms | Hover/focus paint changes |
| base | 300ms | Entrances, transitions, hero card delay |
| slow | 600ms | Headline reveal, larger reveals, connector draw |
| ease-out | cubic-bezier(.22,1,.36,1) | Editorial entrance and scroll settling |
| ease-in-out | cubic-bezier(.76,0,.24,1) | State changes, existing app curve |
| linear | linear | Marquee and chart stroke |
| stagger | 60ms | Bento entries |
| headline-stagger | 80ms | Masked headline lines |
| count | 1200ms | Hero sample dollar count only |
| chart | 1500ms | Hero portfolio-chart SVG dash offset only |
| marquee | 32s | Seamless brokerage loop |
| spring | stiffness 120, damping 22, mass 1 | Hero card, 24px rise after 300ms |
| cursor-spring | stiffness 70, damping 24, mass 1 | Pointer gradient lag |
| lenis | duration .3s, ease-out; native wheel and touch | Explicit section-link navigation only |

Bento lifts 4px and brightens its border; enters at the viewport's lower 80% boundary (20% viewport penetration), 60ms apart. Sticky account shuffling follows scroll progress, never a timer. The illustrative SHOP marker advances through Search, Review and Research; connectors draw on scroll. Hero reveal and decorative effects run once, except the marquee; it pauses on hover/focus and has an explicit pause control.

Reduced motion is an alternate static layout: no Lenis instance, no count-up, no mask/slide, no stroke animation, no marquee, no cursor effect and no pinned account section. Values and SVG paths show their final state immediately. Media query changes are observed while mounted. Mobile also disables pointer tracking and pinning. Login form heading uses clamp(36px, 3.2vw, 48px), within the approved display ladder. Brand text is 24px and the mark 28px, inside a 40px tile. Login uses only a 300ms entrance; chart data and account previews are immediate, no hover travel/cursor/scroll effects. Loading uses text (a static status mark under reduced motion).

## 5. Implementation boundaries

Do not apply this system retroactively to authenticated portfolio screens in this task. Preserve authentication and routing destinations. New landing styles use these tokens, plain scoped CSS, React Motion and Lenis. Because only `framer-motion` and `lenis` may be added, use the `framer-motion` entrypoint rather than install the separate `motion` package required for `motion/react`; the React animation API is the same. See [Motion installation](https://motion.dev/docs/react-installation) and [Motion's framer-motion import guidance](https://motion.dev/docs/framer). Lenis lifecycle follows its [official documentation](https://github.com/darkroomengineering/lenis).

## Appendix A — Baseline audit (before this change)

Snapshot of authored source, excluding tests, build output, vendor reference folders, and dependencies. RGB theme tokens are normalized to hex; alpha hex values retain their alpha. References point to the pre-change files, so login line numbers may move. CSS values below are descriptive, not approved tokens.

### Color inventory

| Hex | Occurrences (file:line) |
|---|---|
| `#05170ab3` | `src/pages/Login.css:154` |
| `#0a0a0c` | `src/components/Navbar.jsx:41`, `src/index.css:112 (--color-brand)`, `src/index.css:136 (--color-wall-bg)`, `src/index.css:139`, `src/pages/portfolio/PerformanceChart.jsx:417`, `src/pages/portfolio/PerformanceChart.jsx:424` |
| `#0b201a` | `src/index.css:132 (--color-gain-bg)` |
| `#0d9488` | `src/pages/portfolio/helpers.js:104` |
| `#0f27120a` | `src/pages/Login.css:138` |
| `#0f766e` | `src/pages/portfolio/helpers.js:104` |
| `#10231930` | `src/pages/Login.css:209` |
| `#10261720` | `src/pages/portfolio/Accounts.css:35` |
| `#137` | `src/utils/conversionCost.js:227` |
| `#141417` | `src/components/illustrations.jsx:22`, `src/components/illustrations.jsx:70`, `src/index.css:114 (--color-surface)`, `src/index.css:115 (--color-card)`, `src/index.css:123 (--color-brand-on)`, `src/index.css:137 (--color-wall-surface)` |
| `#16171a` | `src/index.css:125 (--color-brand-ground)`, `src/pages/portfolio/Accounts.css:17` |
| `#163629` | `src/pages/Login.css:77` |
| `#17211d` | `src/components/Navbar.jsx:11`, `src/index.css:22 (--color-ink)`, `src/index.css:269`, `src/index.css:272`, `src/index.css:281`, `src/index.css:296`, `src/index.css:39 (--color-text-primary)`, `src/index.css:51` |
| `#1834200a` | `src/pages/portfolio/Accounts.css:72` |
| `#1a1a1f` | `src/index.css:138 (--color-wall-elevated)` |
| `#1c1c21` | `src/index.css:127 (--color-border-subtle)` |
| `#1e1f24` | `src/pages/portfolio/Accounts.css:18` |
| `#20352a` | `src/pages/portfolio/Accounts.css:4` |
| `#20382b` | `src/pages/Login.css:36` |
| `#203a2ee8` | `src/pages/Login.css:153` |
| `#203c2d` | `src/index.css:36 (--color-brand-ground)` |
| `#216b50` | `src/index.css:27 (--color-accent)`, `src/index.css:288`, `src/index.css:292`, `src/index.css:295` |
| `#23382d` | `src/pages/Login.css:12`, `src/pages/Login.css:259`, `src/pages/Login.css:270` |
| `#24392f` | `src/pages/Login.css:327`, `src/pages/Login.css:52` |
| `#243f32` | `src/pages/Login.css:77` |
| `#24714e` | `src/pages/portfolio/Charts.css:8`, `src/pages/portfolio/CompositionPanel.css:7` |
| `#251218` | `src/index.css:134 (--color-loss-bg)` |
| `#26262b` | `src/components/illustrations.jsx:22`, `src/components/illustrations.jsx:23`, `src/components/illustrations.jsx:70`, `src/components/illustrations.jsx:71`, `src/index.css:124 (--color-brand-soft)`, `src/index.css:126 (--color-border)`, `src/index.css:144` |
| `#263d2b` | `src/pages/Login.css:195` |
| `#263f30` | `src/pages/Login.css:273` |
| `#263f3012` | `src/pages/Login.css:276` |
| `#27272a` | `src/pages/portfolio/constants.js:31` |
| `#2a2b2f` | `src/pages/portfolio/Accounts.css:21`, `src/pages/portfolio/Accounts.css:49` |
| `#2c4232` | `src/pages/Login.css:208` |
| `#2c4634` | `src/pages/Login.css:284` |
| `#2c4a35` | `src/index.css:33 (--color-brand-accent)` |
| `#32211e` | `src/pages/portfolio/Accounts.css:23` |
| `#32614e` | `src/pages/portfolio/tax/Tax.css:7` |
| `#33302b` | `src/index.css:83` |
| `#34a853` | `src/pages/Login.jsx:331` |
| `#34d399` | `src/components/illustrations.jsx:52`, `src/index.css:131 (--color-gain)`, `src/index.css:42 (--color-gain)`, `src/pages/portfolio/PerformanceChart.jsx:315` |
| `#354b38` | `src/pages/Login.css:223` |
| `#35573e` | `src/pages/Login.css:276` |
| `#36563c` | `src/pages/portfolio/Accounts.css:48` |
| `#3a372f` | `src/index.css:110` |
| `#3a3a42` | `src/components/illustrations.jsx:48` |
| `#3a503b` | `src/pages/Login.css:77` |
| `#3e6033` | `src/pages/Login.css:290` |
| `#3f3f46` | `src/pages/portfolio/constants.js:23`, `src/pages/portfolio/constants.js:30` |
| `#3f7d6b` | `src/index.css:72` |
| `#425a45` | `src/pages/Login.css:229` |
| `#4285f4` | `src/pages/Login.jsx:331` |
| `#4d4842` | `src/index.css:84` |
| `#524e46` | `src/index.css:109` |
| `#52525b` | `src/pages/portfolio/constants.js:23`, `src/pages/portfolio/constants.js:29`, `src/pages/portfolio/constants.js:31` |
| `#52734d` | `src/pages/Login.css:249` |
| `#56b096` | `src/index.css:95` |
| `#5a715335` | `src/pages/Login.css:77` |
| `#5b7c9e` | `src/index.css:74` |
| `#5c6b63` | `src/index.css:273`, `src/index.css:282`, `src/index.css:40 (--color-text-secondary)` |
| `#5e785c` | `src/pages/Login.css:265` |
| `#5e785c12` | `src/pages/Login.css:265` |
| `#5f6a55` | `src/pages/Login.css:231` |
| `#64806a` | `src/pages/Login.css:32` |
| `#66715c` | `src/pages/Login.css:328` |
| `#67615a` | `src/index.css:85` |
| `#68645d` | `src/pages/portfolio/Charts.css:13` |
| `#686f63` | `src/pages/Login.css:13`, `src/pages/Login.css:285` |
| `#68776a` | `src/pages/portfolio/Accounts.css:5` |
| `#696e79` | `src/index.css:130 (--color-text-muted)`, `src/index.css:145` |
| `#6b665c` | `src/index.css:108` |
| `#6c7464` | `src/pages/Login.css:237`, `src/pages/Login.css:263`, `src/pages/Login.css:279`, `src/pages/Login.css:283`, `src/pages/Login.css:287` |
| `#6d7468` | `src/pages/Login.css:250` |
| `#708252` | `src/pages/Login.css:329` |
| `#71717a` | `src/components/illustrations.jsx:10`, `src/components/illustrations.jsx:37`, `src/components/illustrations.jsx:75`, `src/pages/portfolio/constants.js:23`, `src/pages/portfolio/constants.js:30`, `src/pages/portfolio/helpers.js:106` |
| `#7ba0d0` | `src/index.css:97` |
| `#818188` | `src/pages/portfolio/constants.js:28`, `src/pages/portfolio/constants.js:29` |
| `#829087` | `src/index.css:41 (--color-text-muted)`, `src/index.css:58` |
| `#837c73` | `src/index.css:86` |
| `#857f74` | `src/index.css:107` |
| `#858b7e` | `src/pages/Login.css:269` |
| `#858e79` | `src/pages/Login.css:238` |
| `#85904f` | `src/index.css:77` |
| `#8bb79e` | `src/index.css:295` |
| `#96482e` | `src/pages/Login.css:289` |
| `#9a6a86` | `src/index.css:75` |
| `#9a7a50` | `src/pages/portfolio/Charts.css:7` |
| `#9b6b18` | `src/index.css:46 (--color-warning)` |
| `#9ca0a8` | `src/index.css:129 (--color-text-secondary)` |
| `#9ca1a9` | `src/pages/portfolio/Accounts.css:20` |
| `#a09990` | `src/index.css:87` |
| `#a09a8d` | `src/index.css:106` |
| `#a1a1aa` | `src/components/illustrations.jsx:32`, `src/components/illustrations.jsx:33`, `src/components/illustrations.jsx:74`, `src/components/illustrations.jsx:9`, `src/index.css:55`, `src/pages/portfolio/constants.js:23`, `src/pages/portfolio/constants.js:27`, `src/pages/portfolio/constants.js:28`, `src/pages/portfolio/helpers.js:106` |
| `#a3c6b3` | `src/pages/portfolio/tax/Tax.css:11` |
| `#a86a54` | `src/index.css:76` |
| `#aa493d` | `src/pages/portfolio/Accounts.css:10` |
| `#aab7b0` | `src/index.css:57` |
| `#aab86a` | `src/index.css:100` |
| `#aebfaa` | `src/pages/Login.css:182` |
| `#aecda62b` | `src/pages/portfolio/Accounts.css:56` |
| `#afbba9` | `src/pages/Login.css:264` |
| `#b7cab2` | `src/pages/portfolio/Accounts.css:52` |
| `#b84c49` | `src/index.css:44 (--color-loss)` |
| `#b9c8b6` | `src/pages/Login.css:171` |
| `#b9c9a7` | `src/pages/Login.css:222` |
| `#bcb5a8` | `src/index.css:105` |
| `#bccbb9` | `src/pages/Login.css:172` |
| `#bd863f` | `src/index.css:73` |
| `#bdb6ac` | `src/index.css:88` |
| `#bdc9ac` | `src/pages/Login.css:232` |
| `#bdc9b9` | `src/pages/Login.css:175` |
| `#becbb9` | `src/pages/Login.css:184` |
| `#bfd8c9` | `src/components/Navbar.jsx:11` |
| `#c1cebd` | `src/pages/Login.css:161`, `src/pages/Login.css:190` |
| `#c391b0` | `src/index.css:98` |
| `#c3d2be` | `src/pages/portfolio/Accounts.css:51`, `src/pages/portfolio/Accounts.css:59` |
| `#c4d1b9` | `src/pages/Login.css:290` |
| `#c5d5bd` | `src/pages/portfolio/Accounts.css:55` |
| `#c5d9af14` | `src/pages/portfolio/Accounts.css:61` |
| `#c6d0c6` | `src/pages/Login.css:120` |
| `#c7af89` | `src/pages/portfolio/Charts.css:13` |
| `#c9c0ad` | `src/pages/portfolio/Charts.css:10` |
| `#cadbbd` | `src/pages/portfolio/Accounts.css:57` |
| `#cbd7bc` | `src/pages/Login.css:105`, `src/pages/Login.css:110` |
| `#ced7c2` | `src/pages/Login.css:233` |
| `#d18f72` | `src/index.css:99` |
| `#d3dfb2` | `src/pages/Login.css:234` |
| `#d4d4d8` | `src/components/illustrations.jsx:36`, `src/components/illustrations.jsx:8`, `src/index.css:117 (--color-accent-2)`, `src/pages/portfolio/constants.js:23`, `src/pages/portfolio/constants.js:26`, `src/pages/portfolio/constants.js:27` |
| `#d4e2be30` | `src/pages/Login.css:151` |
| `#d4e2be60` | `src/pages/Login.css:301` |
| `#d5c7a7` | `src/pages/Login.css:228` |
| `#d6cfc4` | `src/index.css:89` |
| `#d6dccb` | `src/pages/Login.css:328` |
| `#d6dfae24` | `src/pages/Login.css:136` |
| `#d6dfd2` | `src/pages/Login.css:159` |
| `#d6e5cb15` | `src/pages/Login.css:178` |
| `#d6e8aa` | `src/pages/Login.jsx:294`, `src/pages/Login.jsx:295`, `src/pages/Login.jsx:301`, `src/pages/Login.jsx:302` |
| `#d7d0c4` | `src/index.css:104` |
| `#d7e2bb` | `src/pages/Login.css:119` |
| `#d7e6b5` | `src/pages/Login.css:160` |
| `#d7e8b2` | `src/pages/Login.css:174` |
| `#d8dbd2` | `src/pages/Login.css:255`, `src/pages/Login.css:281` |
| `#d8e0d5` | `src/pages/Login.css:64` |
| `#d8e4bb` | `src/pages/Login.css:195`, `src/pages/Login.css:196` |
| `#d8e6dd` | `src/index.css:28 (--color-accent-2)` |
| `#d9e5af` | `src/pages/Login.css:67` |
| `#dae2ae04` | `src/pages/Login.css:138` |
| `#dc2626` | `src/pages/portfolio/helpers.js:105` |
| `#dca758` | `src/index.css:96` |
| `#dce7ca` | `src/pages/Login.css:49` |
| `#dce8bd` | `src/pages/Login.css:36` |
| `#dcebe2` | `src/components/Navbar.jsx:11` |
| `#dec4ba` | `src/pages/Login.css:289` |
| `#dfe6e1` | `src/index.css:274`, `src/index.css:283`, `src/index.css:285`, `src/index.css:37 (--color-border)` |
| `#e0e2da` | `src/pages/Login.css:280` |
| `#e0e7df` | `src/pages/portfolio/Accounts.css:6` |
| `#e3efc4` | `src/pages/Login.jsx:303` |
| `#e4ded4` | `src/index.css:90` |
| `#e5f1eb` | `src/index.css:43 (--color-gain-bg)` |
| `#e7e8ea` | `src/pages/portfolio/Accounts.css:19` |
| `#e9eeea` | `src/index.css:38 (--color-border-subtle)` |
| `#ea4335` | `src/pages/Login.jsx:331` |
| `#eaf1e3` | `src/index.css:35 (--color-brand-soft)` |
| `#ecedde` | `src/pages/Login.css:207`, `src/pages/Login.css:220` |
| `#ededed` | `tailwind.config.js:68` |
| `#edf2e6` | `src/pages/Login.css:290` |
| `#edf3e6` | `src/pages/portfolio/Accounts.css:48` |
| `#edf3ee` | `src/index.css:275`, `src/index.css:284`, `src/index.css:49 (--color-wall-elevated)` |
| `#eeeee7` | `src/pages/Login.css:282` |
| `#eef2de` | `src/pages/Login.css:229` |
| `#ef4444` | `src/pages/portfolio/helpers.js:105` |
| `#efe9df` | `src/index.css:103` |
| `#f0a599` | `src/pages/portfolio/Accounts.css:22` |
| `#f1f5ef` | `src/pages/portfolio/Accounts.css:3` |
| `#f4f7e408` | `src/pages/Login.css:154` |
| `#f5f4e9` | `src/pages/Login.css:78` |
| `#f5f6eb` | `src/pages/Login.css:273` |
| `#f5f7f4` | `src/components/Navbar.jsx:41`, `src/index.css:23 (--color-brand)`, `src/index.css:269`, `src/index.css:47 (--color-wall-bg)`, `src/index.css:50` |
| `#f5f8e003` | `src/pages/Login.css:153` |
| `#f5f8e00e` | `src/pages/Login.css:153` |
| `#f7e9e7` | `src/index.css:45 (--color-loss-bg)` |
| `#f7eeea` | `src/pages/Login.css:289` |
| `#f8f7f3` | `src/pages/Login.css:11` |
| `#f8fbf3` | `src/index.css:34 (--color-brand-on)` |
| `#fafafa` | `src/index.css:113 (--color-brand-light)`, `src/index.css:55`, `src/pages/portfolio/constants.js:23`, `src/pages/portfolio/constants.js:26` |
| `#fb7185` | `src/components/illustrations.jsx:54`, `src/index.css:133 (--color-loss)`, `src/pages/portfolio/PerformanceChart.jsx:315` |
| `#fbbc05` | `src/pages/Login.jsx:331` |
| `#fbbf24` | `src/index.css:135 (--color-warning)` |
| `#fbfbf150` | `src/pages/Login.css:205` |
| `#fcf1ed` | `src/pages/portfolio/Accounts.css:11` |
| `#fcfcf9` | `src/pages/Login.css:258` |
| `#fff` | `src/pages/Login.css:194`, `src/pages/portfolio/Accounts.css:2` |
| `#fffefa` | `src/pages/Login.css:265` |
| `#ffffff` | `src/index.css:111 (--color-ink)`, `src/index.css:116 (--color-accent)`, `src/index.css:122 (--color-brand-accent)`, `src/index.css:128 (--color-text-primary)`, `src/index.css:140`, `src/index.css:24 (--color-brand-light)`, `src/index.css:25 (--color-surface)`, `src/index.css:26 (--color-card)`, `src/index.css:271`, `src/index.css:288`, `src/index.css:294`, `src/index.css:48 (--color-wall-surface)`, `tailwind.config.js:68` |
| `#ffffff0e` | `src/pages/Login.css:194` |
| `#ffffff24` | `src/pages/Login.css:62` |

### Authored CSS scale inventory

**font-family**: `'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif`; `'Login Tiempos'`; `'Login Tiempos', Georgia, serif`; `'the-future'`; `'the-future', 'Inter', sans-serif`; `'the-future', Inter, sans-serif`; `'the-future', sans-serif`

**letter-spacing**: `-.15px`; `-.25px`; `-.2px`; `-.35px`; `-.45px`; `-.5px`; `-.65px`; `-.6px`; `-.7px`; `-.8px`; `-.9px`; `-0.02em`; `-1.2px`; `-1.3px`; `-1.4px`; `-1.7px`; `-1.8px`; `-1px`; `-2.8px`; `0`; `0.2px`; `0.3px`; `1.2px`; `1.5px`; `1.6px`; `1.8px`; `1px`

**border-radius**: `0 0 14px 14px`; `0 0 18px 18px`; `0 7px 7px 0`; `10px`; `11px`; `12px`; `13px`; `14px`; `16px`; `17px`; `18px`; `19px`; `20px 20px 0 0`; `2px`; `30px`; `3px`; `4px`; `50%`; `5px`; `6px`; `7px`; `7px 0 0 7px`; `8px`; `9999px`; `9px`

**animation**: `ac-enter 400ms ease both`; `ac-spin 850ms linear infinite`; `comparison-appear 450ms ease-out`; `comparison-spin 800ms linear infinite`; `login-account-arrive 1000ms 500ms var(--login-ease) both`; `login-chart-draw 1500ms 200ms var(--login-ease) both`; `login-fade 1500ms 350ms both`; `login-fade 400ms 1300ms both`; `login-rise 1100ms 150ms var(--login-ease) both`; `login-rise 250ms var(--login-ease)`; `login-rise 600ms var(--login-ease) both`; `login-rise 900ms var(--login-ease) both`; `login-sculpture-arrive 2400ms var(--login-ease) both`; `login-spin 700ms linear infinite`; `modal-backdrop-in var(--motion-duration-long) var(--motion-ease) both`; `modal-backdrop-out var(--motion-duration-long) var(--motion-ease) both`; `modal-panel-in var(--motion-duration-long) var(--motion-ease) both`; `modal-panel-out var(--motion-duration-long) var(--motion-ease) both`; `modal-step-in var(--motion-duration-long) var(--motion-ease) both`; `motion-enter var(--motion-duration-long) var(--motion-ease) both`; `motion-select var(--motion-duration-short) var(--motion-ease) both`; `motion-value-change var(--motion-duration-long) var(--motion-ease)`; `none !important`; `own-reveal 220ms ease-out`; `tax-enter 180ms ease both`; `tax-enter 200ms ease both`

**padding**: `0`; `0 0 24px 56px`; `0 10px 12px`; `0 15px 15px`; `0 28px 20px`; `0 2px 0 0`; `0 8px 0 0`; `10px 0`; `10px 12px`; `10px 14px`; `10px 15px`; `11px 3px`; `12px`; `12px 0`; `12px 0 12px 5px`; `12px 0 16px`; `12px 14px`; `12px 15px`; `12px 18px`; `12px 18px 24px`; `12px 2px`; `12px 6px`; `12px 9px`; `13px 0`; `13px 12px`; `14px 0`; `14px 10px`; `14px 16px`; `14px 20px`; `14px 24px 28px`; `14px 8px 14px 13px`; `15px`; `15px 0 22px`; `15px 10px`; `15px 3px`; `16px`; `16px 0`; `16px 17px 5px`; `16px 18px`; `16px 23px 22px`; `17px`; `17px 15px`; `17px 23px 24px`; `17px 28px`; `17px 9px`; `18px`; `18px 0`; `18px 0 0`; `18px 0 12px`; `18px 0 14px`; `18px 14px 0`; `18px 20px 0`; `18px 22px`; `18px 30px 23px`; `18px 30px 26px`; `19px`; `19px 10px`; `19px 23px 6px`; `19px 3px`; `1px 4px`; `1px 5px`; `20px`; `20px 0`; `20px 17px`; `20px 17px 13px`; `20px 18px 0`; `20px 4px`; `21px`; `21px 15px 0`; `21px 17px`; `22px`; `22px 17px 14px`; `23px`; `24px`; `24px 0`; `24px 17px`; `24px 24px 0`; `24px 25px 15px`; `25px 28px`; `27px`; `27px 28px 0`; `28px`; `28px 12px`; `2px 12px`; `2px 6px`; `30px 22px`; `30px 38px`; `32px`; `35px 0`; `35px 20px`; `35px clamp(28px, 4.5vw, 80px) 22px`; `39px 20px`; `3px`; `3px 5.7% 0 0`; `3px 7px`; `44px 32px 30px`; `4px 10px`; `4px 2px`; `4px 7px`; `4px 8px`; `54px 30px`; `5px 0`; `5px 10px`; `5px 23px 5px 9px`; `5px 8px`; `6px 0`; `6px 11px`; `6px 17px`; `6px 28px 6px 12px`; `7px`; `7px 0 25px`; `7px 12px`; `7px 5px`; `88px 28px 20px`; `8px`; `8px 0`; `8px 0 0`; `8px 12px`; `8px 16px`; `9px`; `9px 0`; `9px 0 40px`; `clamp(96px, 13vh, 128px) 30px 24px`; `clamp(96px, 13vh, 145px) clamp(36px, 4.5vw, 78px) 26px`

**box-shadow**: `0 0 0 3px #5e785c12`; `0 18px 50px -25px #05170ab3, inset 0 1px 0 #f4f7e408`; `0 1px 4px rgb(0 0 0 / .06)`; `0 1px 4px rgb(var(--color-ink) / .06)`; `0 1px 4px rgb(var(--color-ink) / .08)`; `0 3px 12px -9px rgb(var(--color-ink) / .12)`; `0 3px 8px -6px rgb(var(--color-ink) / .08)`; `0 4px 12px #263f3012`; `0 4px 16px #10261720`; `0 7px 30px rgb(var(--color-ink) / .08)`; `0 8px 20px #1834200a`; `0 8px 30px #10231930`; `inset 7px 5px 12px #dae2ae04, -3px -1px 8px #0f27120a`; `none`

**font-size**: `0`; `10px`; `11px`; `12.5px`; `12px`; `13px`; `14px`; `15px`; `16px`; `17px`; `18px`; `19px`; `20px`; `21px`; `22px`; `23px`; `24px`; `25px`; `26px`; `27px`; `28px`; `29px`; `30px`; `32px`; `33px`; `34px`; `35px`; `36px`; `37px`; `38px`; `39px`; `40px`; `8px`; `9px`; `clamp(20px, 2vw, 25px)`; `clamp(28px, 3vw, 36px)`; `clamp(30px, 3vw, 42px)`; `clamp(30px, 3vw, 43px)`; `clamp(34px, 3.2vw, 43px)`; `clamp(38px, 4.75vw, 52px)`; `clamp(38px, 8vw, 55px)`; `clamp(38px, min(4.85vw, 7.3vh), 78px)`

**gap**: `0 20px`; `10px`; `11px`; `12px`; `12px 28px`; `13px`; `14px`; `15px`; `16px`; `17px`; `17px 12px`; `18px`; `19px`; `20px`; `22px`; `23px`; `24px`; `25px`; `28px`; `2px`; `30px`; `3px`; `40px`; `4px`; `4px 24px`; `54px`; `5px`; `6px`; `7px`; `8px`; `9px`

**margin**: `-6px 0`; `0`; `0 -15px`; `0 -28px`; `0 -4px`; `0 0 23px`; `0 0 28px`; `0 0 9px`; `0 8px`; `0 92px 6px 91px`; `0 auto`; `0 auto 14px`; `0 auto 18px`; `10px 0 8px`; `12px 0`; `12px 0 25px`; `13px 0 8px`; `14px 0`; `14px 0 4px`; `17px 0`; `18px 0`; `18px 2px`; `22px 0`; `23px 0`; `24px 0 10px`; `25px 0 27px`; `26px 0 7px`; `27px 0 28px`; `2px 0 0`; `30px 0 28px`; `32px 0`; `32px 0 18px`; `34px 0 26px`; `3px 0 15px`; `5px 0 0`; `5px 0 0 auto`; `6px 0`; `6px 0 0`; `8px 0`; `8px auto 0`; `9px 0 8px`; `auto`; `clamp(20px, 3vh, 40px) -3px clamp(15px, 2.4vh, 30px)`

**line-height**: `1`; `1.08`; `1.1`; `1.15`; `1.2`; `1.25`; `1.3`; `1.35`; `1.4`; `1.5`; `1.6`; `1.65`; `1.7`; `1.75`; `1.8`

**transition**: `background 160ms`; `background 160ms, color 160ms`; `background 180ms`; `background 180ms, color 180ms`; `background 180ms, transform 180ms, box-shadow 180ms`; `background 200ms, border-color 200ms`; `background 200ms, transform 200ms, box-shadow 200ms`; `border-color 160ms, background 160ms`; `border-color 200ms, background 200ms`; `border-color 200ms, box-shadow 200ms, background 200ms`; `color 160ms`; `color 180ms`; `none !important`; `opacity 150ms`; `opacity 180ms`; `transform 180ms`; `transform 220ms, border-color 220ms, box-shadow 220ms`; `transform 250ms var(--login-ease)`; `transform 700ms var(--login-ease), border-color 400ms`; `width 350ms ease`; `width 350ms ease, left 350ms ease`
