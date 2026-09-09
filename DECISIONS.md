# WallAI decisions

## Scope and repository reconciliation

- The requested app/page.tsx does not exist because this is Vite, not Next.js. Create it as a normal React module and make the minimal import/root-route edit in src/App.jsx. An unmounted page would not fulfill the landing request. Do not migrate frameworks.
- package.json and package-lock.json must change to install the two explicitly permitted packages. DECISIONS.md is explicitly requested despite its omission from the file allowlist. Shared fonts, CSS and motion utilities live under src/components/landing. Login.jsx and Login.css count as the login page. These are the only scope exceptions.
- The exact import `motion/react` requires a package named motion, conflicting with the dependency allowlist. Keep the explicitly allowed framer-motion package and its equivalent React API; do not add motion or invent a module alias.
- There is no TypeScript dependency or configuration. Validate new TSX using a temporary TypeScript CLI outside the project, strict/noEmit with React JSX and bundler resolution; add no project dependency. Build after every landing section before committing or starting the next.

## Identity

- Retain the existing Tiempos serif for display: it distinguishes WallAI and reads like a considered financial publication. Pair it with self-hosted Geist Sans for crisp UI and tabular numbers. Do not acquire Aeonik. Geist is free under SIL OFL, with compact grotesque proportions; exact metric equivalence is not asserted. Preserve the existing serif asset rather than rebrand.
- Canonical forest #203c2d comes from existing brand-ground; cream #f8f7f3 and ink #23382d come from login; sage #d8e4bb consolidates its pale green accents. Preserve warm error colors, only for feedback. Use alpha variants of these tokens for gradients and shadows. The broad legacy app palette stays untouched.
- Use one soft card shadow, rejecting the reference's absolute prohibition: stacked accounts need gentle separation. Other depth comes from surface contrast and borders.
- Existing login already caps its form at 370/390px and includes pending/error logic. Honor the user's intended result with a single 400px cap, stronger border/focus treatment and accessible status wiring; retain tested auth behavior.

## Layout and motion

- Hero is a responsive two-column composition, serif headline left and a flat legible sample portfolio right. Use a 48–96px fluid headline instead of fixed 136px so it fits 375px. Full viewport is a minimum, allowing content to grow on short/mobile screens.
- Standard motion is 150/300/600ms. The user's 80ms headline stagger, 1.2s count and 1.5s chart are deliberate exceptions. Bento uses 60ms stagger. Spring values and Lenis .6s settling are defined in DESIGN.md. Cursor lag is a spring, never React state per pointer event.
- Brokerage names come from src/utils/currencyConversion.js profiles. Profiles do not establish live Plaid support for every institution/account. Label the band “Connect or import” and explain that direct connections depend on institution; do not claim partnerships or guaranteed integration. Use text names, not invented logos.
- Desktop accounts reorder through three scroll states with the text pinned; mobile and reduced motion show a static ordered stack. Breakpoint is 760px, matching existing login. Keyboard/screen readers always see all three account summaries.
- Bento uses 7/5 and 4/8 column proportions to avoid the requested-against three-column row. Financial sample diagrams use SVG/CSS, not images or extra dependencies.
- Agent pipeline is an illustrative ticker moving through Catalyst, Contrarian and Position Sizing, backed by existing agent modules. Describe research workflow, not performance promises or automatic trade execution.
- Login keeps only a short 300ms entrance. Remove its 2.4s sculpture arrival, chart drawing and preview hover rotations. Loading is announced by text; no infinite decorative motion is needed.
- Reduced motion removes the animated mechanisms, not just their duration: static numbers/paths/cards, normal scrolling, no marquee or pointer listener. Mobile uses native touch scroll and no gradient.

## Verification log

- 2A: `npm run build` passed. Strict TypeScript noEmit passed for app/page.tsx and all shared landing TS/TSX, using temporary TypeScript 7.0.2 and Vite CSS declarations. Vite reports the existing application bundle-size advisory; no compile failures.
- 2B: strict noEmit and production build passed. Marquee pauses on hover, keyboard focus and its explicit control; reduced motion shows a wrapping, unduplicated institution list.
- 2C: strict noEmit and production build passed. Three scroll states keep the narrative pinned and reorder the account cards. The static branch never mounts scroll subscriptions.
- 2D: strict noEmit and production build passed. Four unequal cards use a 7/5 then 4/8 desktop grid, 2 columns on tablet and 1 on mobile; fine-pointer hover lifts 4px and increases border contrast.
- 2E: strict noEmit and production build passed. The ticker and both connector dash offsets follow section scroll progress; mobile uses a vertical rail, reduced motion a static labelled sequence.
- 2F: strict noEmit and production build passed. Closing CTA and footer complete all six sections. Every conversion link reaches /login?mode=signup, and all navigation anchors have real targets.

## Final reconciliation and review adjustments

- Browser inspection showed “Your investments.” wraps into two visual lines at both target sizes. Give each of the three visual headline lines its own mask and 80ms stagger instead of letting two lines share one animation.
- Bento intersection inset is measured in viewport-height pixels. IntersectionObserver percentage root margins are width-relative, which would trigger at the wrong height on a wide monitor.
- Show sample account weights to two decimals (37.56%, 48.58%, 13.86%) so the labels total 100%. Values still total the hero's $128,450.
- Lazy-load the root landing route so /login does not fetch Motion or Lenis. This adds Suspense to the already necessary routing edit, without changing other destinations.
- Reuse the same shared wordmark on login and landing. Existing login's Navbar logo depended on unrelated app styling; a dedicated brand component keeps both public pages consistent.
- All signup CTAs use /login?mode=signup; login now initializes its existing signup mode from that query parameter. Returning users still enter signin at /login.
- Pending actions retain the existing authentication methods, with a synchronous in-flight guard against duplicate requests, a live progress message and disabled controls. Error text is associated with the fields. Local email and signup-password checks avoid avoidable failed requests.
- Login uses static sample charts and a static loading mark alongside live status text. There is no timer, animated chart, hover travel, Lenis or cursor subscription on that route.
- When the OS reduced-motion setting changes, remount only the landing content into its static/animated variant. This prevents interrupted count-ups or offscreen reveals from leaving partial values/hidden content.
- Final visual/contrast review: the paragraph reset overrode the brokerage note's automatic side margins; restore its container alignment. Muted #686f63 on sage measures 3.89:1, so the sage bento card uses ink for its small copy. The input border against cream measures 3.19:1; mist text on the green panel measures 6.19:1.

## Completed validation

- All six section gates passed strict TypeScript noEmit and Vite production build before their commits.
- Final app build passes; the landing now ships as a separate ~182kB (58kB gzip) JavaScript chunk. Vite still reports the pre-existing large authenticated-app bundle advisory.
- Existing full test suite: 74 files, 950 tests passed. Existing login/auth behavior and global motion rules remain covered. ESLint passes for src/App.jsx and src/pages/Login.jsx.
- Playwright/Chromium: widths 375, 760, 768, 1024 and 1440 have no document overflow. Form measures at most 400px. Focus outline is visibly 2px. Screenshots reviewed at desktop and mobile.
- Browser interaction checks: marquee hover pause and explicit pause; all three sticky account states; bento reveal and -4px lift; both pipeline lines finish drawing; switching reduced motion live removes Lenis, pointer layer and pinning; static content shows all values/cards immediately.
- Browser login checks: signup query selects signup; invalid email gets local feedback; intercepted Firebase request shows pending/disabled state, maps the error, and associates it with inputs. Exactly one request was intercepted. No real authentication mutation was sent; no browser exceptions occurred.

## Tax-first positioning (follow-up; supersedes the portfolio/research story above)

- Keep the approved green/cream/sage design, font pairing, layouts and motion. Change the product story to the existing Tax & costs workspace; leave the authenticated Tax implementation untouched.
- Feature audit: TaxView.jsx exposes dividend withholding (recorded 12-month totals or annual estimates), annual fund expenses, FX costs vs a daily reference, entered TFSA/RRSP room less recorded deposits, account-type withholding comparisons, and sale review. Lead with these capabilities rather than the research agents.
- Hero becomes “Your money. Your costs. Made clear.” The portfolio-return chart becomes account-level withholding bars. Preserve the spring entrance, 1.2s count, 1.5s SVG draw and 80ms headline stagger, without implying that higher costs are a positive investment return.
- The shared TaxSnapshot is a static presentational component so login can reuse it without importing Motion/Lenis. The hero opts into bar animation and supplies its animated count. No dependency additions.
- Illustrative annual withholding is $312 (TFSA $156 + RRSP $104 + non-registered $52), annual fund expenses $184, and measured FX costs $96 year to date. These are fabricated preview records, not calculated promises, published tax rates or savings. Keep currencies, time periods and measured/estimated labels separate; do not sum incompatible metrics into a “tax bill.” Account registration alone does not determine withholding.
- Contribution room previews will explicitly derive from entered starting room and sample recorded deposits, not claim an automatic CRA connection or a statutory limit. Account comparison will describe dividend withholding only, not a recommendation to move investments or a total tax optimization calculation.
- CTAs continue through the existing signup/login flow to account setup. No fictitious direct Tax route or automatic tax filing is introduced.
- Account illustrations use entered room of $8,250 less $2,000 deposits for TFSA ($6,250 remaining), and $22,400 less $4,000 for RRSP ($18,400 remaining). The bento's planned $1,000 TFSA contribution leaves $5,250. These are sample records, not annual statutory limits. The stack stage gains 80px to keep the extra basis labels clear.
- Fee examples use generic Fund A ($12,000 × 0.20% = $24/year) and Fund B ($80,000 × 0.20% = $160/year), totalling the preview's $184. Avoid naming real funds with potentially stale expense ratios. Withholding amounts retain the same account breakdown across hero and bento.

### Scroll responsiveness follow-up

- The user reports a laggy feel. The prior Lenis configuration applies a 600ms easing tail to wheel input. Switch wheel and touch to native scrolling (`smoothWheel: false`, `syncTouch: false`); retain Lenis only for deliberate anchor navigation at the 300ms base duration. This supersedes the earlier smooth-wheel choice while preserving the section animations and reduced-motion behavior.
- The stacked cards now change z-index only at the three narrative boundaries; interpolated fractional z-index values are invalid CSS and needlessly update a paint-affecting property. Their continuous movement remains transform-only. Add a compositor hint only to the three animated cards, and update the active-copy React state only when its index actually changes.
