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
