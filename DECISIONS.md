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
- Final visual review: compact the login preview by omitting the account bars there; keep the same labelled withholding/fund/FX figures, without bringing Motion into login. Shorten the hero intro to avoid an awkward standalone “conversion” line. Remove the stack's redundant external sample note, which the cards could overlap; each card already carries its sample/basis labels.

### Tax-focused follow-up validation

- Each changed landing section passed strict TypeScript noEmit and production build before its commit. Login/auth and global reduced-motion tests: 19 passed. Login ESLint and git whitespace checks pass. No dependencies or authenticated Tax files changed.
- Production-browser checks at 375, 760, 768, 1024 and 1440px confirm no horizontal overflow, form width at most 400px, visible 2px input focus outlines, three static account cards under reduced motion, four tax features, three walkthrough steps, and valid section links.
- Native scrolling check: a trusted 500px wheel input is not prevented, reaches scrollY=500 by the 100ms observation, and remains there after another 650ms. This confirms removal of the former easing tail in Chromium; it is not a hardware-independent frame-rate guarantee.
- Final browser pass also verifies section-link navigation, all three stack orders, the 4px bento hover lift, finished walkthrough connectors, live reduced-motion switching, and signup routing. No browser exceptions. Desktop/mobile screenshots reviewed; the login preview stays static and compact.

## Restore the original visuals, with Tax component content

- User correction: the first design and animations were preferred. Restore the original hero portfolio card verbatim from cda2889, including the $128,450 count, one-year rising stock/portfolio chart, 1.5s line draw, spring entrance, account strip and orbital framing. Restore the original headline treatment and wording; keep tax-focused supporting copy and CTA. The chart remains explicitly an illustrative portfolio, never a claimed tax saving.
- Replace Connect/Understand/Compare with actual Tax components—Withholding, Fund expenses and FX costs—in the original three-agent card design. Preserve the original scroll progress mapping, individual card entrances, connecting strokes and moving pill. Label the pill CAD rather than presenting a stock recommendation; call these components, not new autonomous agents.
- Keep the native wheel/touch scrolling fix, reduced-motion alternatives, tax-focused bento/account content and compact login. This is a targeted visual restoration, not a reset of the responsiveness or authentication improvements.
- Restoration checks: both changed sections pass strict TypeScript and production build. Chromium verifies the original hero chart starts undrawn and completes, the balance reaches $128,450, all three Tax cards and connector stages render, 375/768/1440px layouts do not overflow, and reduced motion remains static. Native wheel input still reaches 500px directly without subsequent drift. Section links resolve; no browser exceptions. Screenshots reviewed against the original hero composition.

## Section 03: nightly research engine

- Latest request changes only the three-card story to the research engine. Keep its existing appearance, motion, original stock-chart hero, tax-focused bento/accounts/login and native scrolling.
- Describe three actual pipeline stages: Nightly search, Agent review and Research shortlist. Source: api/nightly-research.js collects X signals, news, technical screens and Exa discovery, extracts candidates, runs Contrarian then Catalyst checks, reranks, generates reports and stores results. src/pages/Research.jsx displays those ideas and their details.
- Use the existing “nightly research” product name. Current vercel.json schedules the route daily at 13:00 UTC, so avoid “while you sleep,” fixed delivery times, guaranteed overnight completion or a claim that every run produces picks. This change does not invoke or reschedule the engine.
- Do not put Position Sizing in the scheduled three-stage sequence: it is invoked separately on demand from Research.jsx through api/position-sizing.js. The two agents named in the middle card actually run in the research pipeline.
- Restore the illustrative SHOP ticker for the research sequence; it is not a live recommendation. Link the footer to Research engine and the header's Tax & costs link to the tax bento. Preserve the existing signup flow.
- Verification: strict TypeScript, production build and whitespace checks pass. Chromium checks at 1440/768/375px confirm the three research-stage cards, correct navigation anchors, no horizontal overflow, preserved portfolio hero and tax bento, static reduced-motion content, and the original animated card/connector/ticker sequence. No browser errors.

## Authenticated Research: editorial workspace (September 2026)

- Scope is presentation: Research.jsx, its idea/market components, a source-notebook component, scoped CSS and UI tests. Research ranking, pipeline, API handlers, request/response contracts and dependencies stay unchanged. The supplied brief ended at the header example; the remaining layout follows the stated research-workspace questions.
- Reuse the actual landing/login Tiempos and Geist assets and forest/cream/sage tokens. The forest header is a compact briefing masthead, not a full-viewport marketing hero. A 1,180px reading area pairs the leading argument with a 292px context rail; mobile reads ideas first, with context accessible through a section link.
- The first qualifying idea in server order opens automatically. Other ideas become editorial rows separated by rules. Filtering at the existing 6/10 threshold does not sort either group; displayed ranks refer to the original server array. Unscored items remain discoverable in the below-threshold group instead of disappearing.
- Organize existing fields as thesis, catalyst/chart evidence, opposing case, trade plan and provenance. Risk can appear even without bear-case prose. Technical observations can appear without a trend label. Keep all source names and themes accessible, explicitly show zero mentions, and use the supplied sourceCount when available. No client-side score synthesis or summary generation.
- Keep market scoring separate from idea conviction. The sage market summary always exposes score, label and weakest component; the full breakdown is one disclosure away. Portfolio sizing remains an explicit request with loading, error, retry, overlap and warning feedback.
- Source-notebook counts come directly from the run. The payload does not provide a separate total of screened securities, so do not fabricate one or sum overlapping discovery counts. Article links use existing title/link/source fields and allow only HTTP(S) destinations. Missing article details are labelled rather than invented.
- Live prices still load for every returned ticker and refresh every 300,000ms. Live, stored and unavailable values are visibly distinct. True zero stays 0.00%; absent change stays unknown. A failed refresh returns to labelled run values instead of continuing to claim the old quote is live. Valid trade-plan fields retain the existing presentation behavior.
- Data-load failure has its own retry state; a completed scan with no qualifying ideas stays an explicit successful-empty result. Malformed or unavailable market context does not suppress usable research.
- Motion is limited to a 300ms, 4px disclosure entrance and 150ms interaction paint changes. Financial values update immediately using the existing ChangedValue component. Native scrolling, no cursor effects or scroll listeners, and a complete reduced-motion override keep this a working application.
- The app theme toggle remains useful: light mode uses cream paper and sage context. No global navigation or other product-page styling changes.
- Superseded (September 2026): dark mode originally mapped the same landing family to forest/panel surfaces with cream/mist text. In the product that read as a green slab under a black navbar — the page painted `#203c2d` over the app's `#0a0a0c` ground, while every other page uses near-black. `src/index.css` already settles this for the product: brand green is a light-mode identity, and on dark the brand roles resolve to neutral so colour is left to gain/loss, which is data rather than chrome. The research workspace now takes the app's dark tokens (`--color-wall-bg`, `--color-wall-elevated`, `--color-accent`, `--color-text-*`, `--color-border`). The briefing masthead cannot invert against a near-black page, so it lifts instead: `wall-surface` over `wall-bg`, the same step the portfolio cards use. Light mode is unchanged.
