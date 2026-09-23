# WallAI Options Algorithm Review

## Algorithm After Review

Reviewed the six requested modules, their tests, and the adjacent feature, calendar, contract-normalization, opening-revalidation and replay paths. Production changes are confined to the six algorithm modules; adjacent changes are tests. No weights were fitted to outcomes, and no real holdout results were used.

WallAI first freezes underlying features and ranks directional setups. It retains at most ten securities with a preferred call/put direction. No-evidence and equal-score directional ties are now rejected instead of defaulting to calls. Known earnings/catalysts are excluded through the actual **third subsequent trading session's close**, using the same event-date rule as contract scoring. An event after that close is outside the hold.

Contract acquisition retains the existing 7–60 calendar-DTE window, minimum $0.50 midpoint, maximum 10% bid/ask spread relative to midpoint, positive bid, unlocked/uncrossed option quote, displayed size ≥1 on each side, open interest ≥100, and either current volume ≥5 or previous-session volume ≥100. Option/stock quote age limits remain 30/10 seconds, with ≤10 seconds of timestamp skew. Upstream contract normalization admits standard American contracts with a 100-share deliverable and rejects adjusted contracts. Provider delta no longer decides eligibility: the synchronized midpoint is calibrated locally, and the resulting direction-correct delta must have magnitude **0.15–0.60**. Primary cohort labels use 14–45 DTE and local delta 0.25–0.50; the other eligible contracts are edge cases.

The model then reprices the option at explicit stock/time/IV states. The primary score uses the same three-session exit and +25% **net ask-entry/modeled-bid-exit return** for every contract. It can select a contract that gains while still OTM; reaching the strike or expiration breakeven is not required. The full matrix contains 135 cells: nine symmetric stock moves, three IV assumptions and five session horizons, less unavailable horizons.

Ranking remains deterministic, with ties broken by tighter relative spread and then contract ID. At most two contracts per underlying/direction are displayed. Opening quote revalidation and immutable evidence lineage remain in place. A score is neither probability of profit nor expected return.

## Problems Found

| Issue | Why it mattered in WallAI |
| --- | --- |
| Untimestamped provider delta controlled eligibility, while local delta controlled points | A valid contract could be discarded before calibration; a locally deep-ITM or lottery contract could pass on stale provider analytics. Wrong delta signs also passed the absolute-value gate. |
| The shortlist used a five-calendar-day event flag while scoring used three sessions | Tuesday scans could exclude events after Friday's exit; holiday-spanning holds could include an event that the shorter calendar window missed. |
| Equal setup scores selected calls, including when all evidence was missing | Neutral/missing evidence produced a directional choice without directional support. |
| `null <= maxAge` and negative ages passed freshness checks | Missing or future-dated quotes could look fresh. Acquisition order could also let the stock quote age during a chain fetch. |
| Premium targets inverted a midpoint gain | A reported +25% target did not actually earn 25% after buying the ask, selling the modeled bid and paying fees. |
| The OTM-gain flag used midpoint returns | Some flagged gains disappeared after trading costs. |
| The option's own calibrated IV enlarged its required-move denominator | More expensive IV could partly justify its own price by declaring a larger underlying move budget. |
| IV resilience used the entire unchanged-stock, IV-down return | It deducted the same horizon decay already assessed by theta efficiency. |
| Absolute-dollar spreads could override percentage-spread points | Multiplying stock, strike and premium by a common factor could lower liquidity points despite identical percentage friction. |
| Missing risk inputs removed deductions | Deleting expensive IV history, prior-volume evidence or event coverage could improve a score. Missing modeled decay could avoid the decay penalty. |
| Risk penalties jumped at 5 contracts, the 90th IV percentile, and 15% decay | An arbitrarily small change could move several points and reverse rankings. |
| The European call shortcut ignored negative interest rates | Reproduced a $120-stock/$100-strike call valued around $19.17 despite $20 immediate exercise value. |
| Dividends rounded to the first/last lattice boundary vanished | A near-immediate $2 dividend barely changed an ATM call, although the correct immediate-dividend limit reduced its value by about $1. |
| Dividend interpolation allowed a negative ex-dividend stock coordinate; exercise was checked only after mapping back to the cum-dividend state | Large cash flows could violate put bounds and omit the right to exercise a put immediately after the drop. |
| Fixed small spot bumps differentiated lattice kinks | At 256 steps, a zero-rate ATM put's gamma was about 0.04976 versus the analytic 0.03971. Neighboring strikes had different numerical errors. A fixed percentage floor also blurred low-volatility gamma. |
| Moving valuation time across a dividend differentiated the cash-flow jump and rounded date grid | Reported theta could describe a dividend transition or numerical noise rather than local time decay. |
| IV calibration treated exercise-floor prices as identified volatility | An interval of IVs can produce the same American intrinsic value. Returning the lower bracket as “calibrated IV” gave false precision. |
| Only entry convergence was checked | A converged entry could still produce an unconverged primary IV-loss or target valuation. |
| The declared 100 points included 10 unavailable catalyst points | Nominal weight and actual attainable influence differed. Production also supplies no historical-IV context. |

## Improvements Made

| Module/change | Old behavior → new behavior; justification |
| --- | --- |
| `chainGates.js`: delta | Provider analytics excluded contracts → analytics remain diagnostic and the unchanged delta window is enforced in `scoring.js` on calibrated, correctly signed delta. Cohorts are recomputed from that same delta. |
| `chainGates.js`: input/freshness checks | Coercible or nonfinite prices, sizes, OI, ages and timestamps could pass → invalid data fails closed. Future quotes/OI, quotes from another session, wrong volume dates, crossed stock quotes and direction mismatches are rejected. When both acquisition timestamps exist, age is recomputed at the later acquisition. Locked stock quotes remain usable; locked option quotes remain excluded. |
| `publication.js`: entry boundary | A flattened chain was trusted → direct scoring calls also recheck hard gates. This prevents bypassing freshness/liquidity through an alternate caller. |
| `shortlist.js`: events and direction | Legacy calendar flag and call-favoring ties → shared calendar-resolved exit/event rules, plus explicit no-setup/tie rejections. Invalid numeric setup inputs earn zero. No directional weight changed. |
| `scenarios.js`: target economics | `mid × (1 + target)` → invert the exact modeled round-trip cash flows. The original frictionless target remains separately labeled for comparison. |
| `scenarios.js`: OTM claims and symmetry | Mid-only gain flag and an asymmetric −3%/+2% grid → separate mid/net gain flags and both signs of 2%, 3%, 5%, 8%. Expiry rows now report the correct ITM delta sign. |
| `scoring.js`: move compatibility | Required move divided by that contract's own IV budget → required favorable move divided by frozen 20-session underlying RV over the same elapsed calendar time. Missing RV earns zero; a target already reached without a favorable move has zero required favorable move. Implied-move multiples remain scenario diagnostics. |
| `scoring.js`: IV resilience | Shocked total return → shocked return minus the unchanged-IV return at the same horizon. This isolates incremental IV loss without rewarding carry twice. |
| `scoring.js`: spread units | Minimum of relative and dollar-spread points → relative-spread points only, with dollar spread retained as a zero-point diagnostic. The existing eight-point spread allocation is unchanged. |
| `scoring.js`: missing data | Missing risk evidence could remove penalties → unknown IV/event risk receives the existing worst-case deduction; unknown/low current volume cannot escape its deduction by losing prior-volume data. Required decay/IV-loss attribution is mandatory. Out-of-range or future IV history is treated as unavailable. |
| `scoring.js`: penalty continuity | Binary deductions → clipped ramps using the existing thresholds and maximum deductions. Volume runs from −3 at zero to zero at five; IV runs from zero at percentile 90 to −5 at 100; decay continues the existing theta shoulder's slope from 15% to a −5 cap at 21%. No component weight or penalty cap changed. |
| `scoring.js`: score interpretation | Unattainable points only visible in individual traces → explicit `attainableComponentPoints: 90` in policy and scored records. Scores are not rescaled or inflated. |
| `pricing.js`: American exercise | Unconditional no-dividend call shortcut → shortcut also requires nonnegative rates. The lattice checks exercise on both sides of a cash-dividend jump. |
| `pricing.js`: cash dividends/bounds | Boundary cash flows dropped and negative interpolation coordinates possible → retain near-root dividends through the immediate-dividend limit, retain near-expiry dividends at the last interior step, and floor ex-dividend stock at zero. Call bounds account for remaining continuous carry; put lower bounds conservatively avoid assuming full cash dividends can be paid in every state. Upper bounds handle negative rates/carry. |
| `pricing.js`: Greeks | Fixed spot/volatility bumps and time shifts → spot bumps span a lattice cell in relative units; low-volatility vega uses a symmetric feasible bump and matching denominator; theta uses the continuation pricing PDE, or zero in immediate exercise. |
| `pricing.js`: solver/input validity | Nonfinite positive-looking inputs and exercise-floor IV accepted → finite numeric inputs required, and price-floor IV is explicitly unidentifiable. |
| `scenarios.js`: valuation validity | Entry-only convergence → additional checks at primary unchanged-stock/IV, IV-down and solved net-target states. A failed primary check blocks the scenario set. Invalid times, grid values, costs, carry or dividend amounts fail instead of becoming favorable assumptions. |
| `publication.js`: rates | Last array element chosen → latest visible dated observation, sorted deterministically and excluding future observations. The explicit 4% fallback is unchanged. |
| Versions/tests | Old policy/model identifiers → new identifiers for all six affected modules. Synthetic integration fixtures now describe valid local delta and acquisition timestamps. Tests construct a new synthetic replay archive while leaving the original versioned fixture and production version rejection intact. |

## Final Scoring Model

`score = round3(clamp(sum(component points) − sum(deductions), 0, 100))`.

All positive component allocations are unchanged. Ramps clip at their stated endpoints; log ramps operate on `log10(value)`.

| Component | Nominal maximum | Final transformation |
| --- | ---: | --- |
| Underlying setup | 15 | Directional 20-session relative strength: 0→10 points over 0→10%; direction-aligned regime: 0→5 over 4→8. Puts mirror the regime. |
| Technical confirmation | 10 | Directional five-session return: 0→5 over 0→5%; directional distance from SMA20: 0→5 over 0→5%. |
| Catalyst quality | 10 | **Zero attainable** in the implemented non-event cohort. Events in the holding horizon exclude; there is no implemented positive catalyst-quality factor. |
| Delta exposure | 10 | Absolute local delta plateaus at 10 over 0.25–0.45; linear shoulders reach zero at 0.15/0.60. Outside the eligibility window is excluded, not compensated by other points. |
| Convexity | 10 | `x = 0.5 × gamma × (0.01 × spot)^2 / mid`; points `10x / (x + 0.01)` for positive x. Scale invariant and bounded; raw gamma is never compared directly. |
| Theta efficiency | 10 | Full unchanged-stock/IV repricing loss as % of entry midpoint. Ten points at ≤3% loss, declining linearly to zero at 15%. No theta-times-days shortcut. |
| IV/vega | 10 | Own comparable-history IV percentile: 4 points at ≤30, zero at ≥70. IV/RV: 3 at ≤1, zero at ≥1.6. Incremental horizon IV-down loss: 3 at ≥−5% of entry mid, zero at ≤−25%. |
| Liquidity | 15 | Relative spread: 8 points at ≤2%, zero at 10%; OI log ramp 100→10,000: 4; current volume log ramp 5→500: 2; thinner displayed size log ramp 1→25: 1. |
| Move compatibility | 10 | `budgetPct = RV20dPct × sqrt(elapsedCalendarDays / 365)`; `x = max(0, directionSign × requiredNetTargetMovePct) / budgetPct`. Ten points at ≤0.25 budgets, zero at ≥1 budget. |

RV is annualized from lagged daily log returns using 252 sessions in the existing feature builder. Mapping that annualized estimate to elapsed calendar time assumes variance is distributed over the year; it is an explicit scale convention, not a calibrated weekend/overnight volatility forecast.

Deductions are: relative spread 0→5 over 5→10%; current volume 3→0 over 0→5 contracts; IV percentile 0→5 over 90→100; decay 0→5 over 15→21%; event after exit but before expiry 5. Unknown historical IV takes the existing maximum 5; incomplete event coverage takes the existing event deduction 5. Missing positive factors earn zero. Missing required model attribution excludes.

**Actual influence:** the spread's eight positive points and five-point upper-band deduction form one piecewise friction preference with a 13-point span. Spread also changes the real net-target economics. Theta spans +10 to −5, IV history +4 to −5, and current volume +2 to −3. These are not independent extra observations. Correlation and component-ablation diagnostics remain; correlated delta/gamma/target exposure has not been statistically reweighted.

The structural component ceiling is **90**, not an attainable 100. With no historical-IV context in today's publication path, the arithmetic upper bound becomes **81**: lose four positive points and reserve five for unknown IV expense. Incomplete event coverage lowers it further to 76. Joint economic constraints may make even these bounds unreachable. Changing the score scale or redistributing the unused catalyst allocation is deferred to #214.

## American Option Model

The model remains an early-exercise CRR lattice with cash-dividend value-function interpolation, averaging adjacent step counts. It is not replaced with a European approximation. The Black–Scholes fast path is exact only where its exercise conditions hold. Default pricing uses 512 steps; scenario pricing uses 256. Calibration brackets remain 1%–500% annualized volatility with a $0.001 residual tolerance. Rates are continuously compounded model inputs; time is Actual/365.

For continuation states, local calendar-day theta is now:

`(r × V − (r − q) × S × delta − 0.5 × sigma² × S² × gamma) / 365`.

This is evaluated from the American model's price and spatial derivatives, with theta zero inside immediate exercise. It avoids crossing an ex-date when estimating a local derivative. This approach is consistent with [QuantLib's binomial engine and theta recovery](https://github.com/lballabio/QuantLib/blob/master/ql/pricingengines/vanilla/binomialengine.hpp). The cash-flow/exercise distinction was also checked against [OIC's exercise guidance](https://www.optionseducation.org/referencelibrary/faq/options-exercise). These references support mechanics, not the score weights.

Discrete dividends stay dated, are removed after going ex, and remain in valuations while still ahead. Boundary handling is a numerical approximation: a dividend within half a time step of valuation uses its immediate limit; one next to expiry is placed on the last interior step. Step convergence is therefore still essential. Scenario stock moves describe the actual terminal stock price; an ex-dividend stock drop is not automatically added to the requested move. An unchanged-stock scenario across an ex-date is consequently not a total-return-neutral stock path.

Entry and primary scoring states must satisfy the existing convergence tolerance `max($0.02, 1% of value)`. Calibration and pricing failures block ranking. Provider IV remains separately attributed and never substitutes for local calibration.

For multiplier `M=100`, fee per side `f=$0.70`, entry ask `A`, entry relative spread `s`, and target return fraction `g`, the required theoretical exit value is:

`Vtarget = ((M × A + f) × (1 + g) + f) / (M × (1 − s/2))`.

The modeled bid is `max(V × (1 − s/2), 0)`. Solving the American model for that value produces the required signed stock move. At expiry, inversion uses intrinsic value directly. Calls and puts both use these same cash flows. Relative IV shocks remain 0.9/1.0/1.1, so a 60% starting IV becomes 54% in the down case. Full repricing includes remaining time and all still-live dividends; theta is never subtracted again.

Session exits already respected weekends, holidays, early closes and last trading dates; that machinery was retained and reused by the shortlist. All historical feature selection remains bounded by the frozen record, with current option/stock data bounded by their opening observations. New rate/history validation does not consult future data or a live clock.

## Improvements Not Yet Made

These belong in **#214 / forward testing**, with new policy versions and untouched evaluation periods:

- Reweight or combine delta, convexity, theta and target compatibility. They share model inputs and are economically correlated; mathematical correlation alone does not establish the best ranking weights.
- Test stronger severe-decay protection. The existing five-point deduction saturates at 21% carry loss, so 30% and 60% losses receive the same maximum deduction. A higher cap or hard exclusion needs evidence, not intuition.
- Calibrate the 0.15–0.60 delta and 7–60 DTE gates, including whether primary/edge contracts should be ranked separately. These are retained strategy hypotheses, not optimality results.
- Test both directions per underlying, alternative shortlist sizes, benchmark comparisons, and alternatives to raw percentage momentum/SMA transforms across different underlying volatilities.
- Replace the uniform-calendar RV move scale with tested intraday/overnight/weekend variance, forward volatility forecasts or event-specific move distributions. Twenty-session RV is noisy and not a forecast.
- Supply genuine point-in-time same-tenor/moneyness IV history, IV term structure and skew; validate the effect of the current conservative unknown-data deductions.
- Implement a separately evaluated catalyst/event cohort. A ±10% relative IV grid is not an earnings-crush model. Test larger calibrated stress shocks and event-specific IV term decay before scoring earnings exposure.
- Estimate exit spread/tick floors, adverse selection, fill probabilities, slippage and fees from observed executable data. Test notional liquidity and displayed-depth stability; OI is not executable liquidity.
- Validate rates by tenor and compounding convention, borrow/carry data, and dividend coverage/amount accuracy. Do not silently treat absence of an observed dividend as proof of no dividend.
- Reallocate unused catalyst points or present a different normalized score scale only alongside a versioned evaluation. Do not relabel existing historical scores as comparable.

## Validation

`algorithmReview.test.js` constructs contracts from a specified model IV, then sends their quotes through production publication/calibration/scoring. Each comparison holds the other inputs fixed. Representative results use a $100 stock, $103 call, September 22 valuation, October 16 expiry, 35% frozen underlying RV, zero rates, identical directional setup and complete event coverage. Historical-IV context is absent in all rows.

| Synthetic change | Result |
| --- | --- |
| Spread 2% → 9%, identical midpoint | Score 56.126 → 43.317; required net +25% stock move 2.111% → 2.559%. |
| IV 25% → 35% → 50% → 70%, same strike/expiry | Scores 58.950 → 56.126 → 49.555 → 45.547; required target moves increase. |
| Strike 100 → 103 → 107, same IV/expiry | Scores 53.590 → 56.126 → 50.954. The farther strike earns more convexity but loses carry/delta quality. |
| Strike 120 or 85 | Excluded by locally calibrated delta; the far OTM quote also fails minimum premium. |
| Same strike, 7 / 24 / 45 / 59 DTE | Scores 50.606 / 56.126 / 57.188 / 56.599. Longer life reduces carry loss but increases the move needed to appreciate the larger premium. |
| Equivalent zero-carry put with stock/strike exchanged | Score 55.753 versus call 56.126; correct downward target. Equal percentage shocks are not exact lognormal call/put duals. Hand-mirrored scoring features produce exactly equal scores. |
| Stock, strike and premium multiplied by four | Dimensionless delta, convexity, carry, IV and liquidity components are unchanged. Fixed-dollar fees slightly improve net-target compatibility at the larger scale. |

Additional tests cover higher carry with unchanged incremental IV loss, current volume/OI, missing and future data, continuity around penalty thresholds, invalid ages/timestamps/prices, provider/local delta disagreement, calendar/holiday event windows, net-target inversion under unchanged/crushed IV for both types, and gains of at least 25% while still OTM. The tests do not assume every longer DTE or every closer strike must always rank higher.

Pricing validation retains the checked-in independent QuantLib finite-difference oracle and analytic benchmarks, including discrete dividends, exercise style, price bounds, put–call parity, Greeks and step convergence. The oracle was not regenerated to match this implementation. New regressions cover negative rates, first/last-step dividends, nonnegative ex-dividend stock, gamma across adjacent strikes and low volatility, local theta near dividends, and unidentifiable IV. A separate case verifies that a passing entry can still be blocked by an unconverged primary IV-down state.

Automated verification: `npm run test:run` passed **1,910 tests in 147 files**; the options/API suite passed **413 tests in 28 files**. Targeted follow-up checks cover the final low-volatility gamma, session-date and resolved event-coverage regressions. Targeted ESLint and `git diff --check` also passed. Legacy replay-version rejection, future-input exclusion, deterministic score generation, stable ranking and immutable archive hash verification remain tested. Synthetic fixture version changes are confined to test construction, never applied to observed archives.

## Remaining Weaknesses

This is a more internally consistent ranking hypothesis, **not yet a highly reliable ranking algorithm**. No forward evidence establishes score calibration, economic superiority over simpler baselines, expected return, fillability, or an optimal weighting scheme.

The most material remaining limits are the unimplemented catalyst component; absent production IV history; partially observed event/dividend coverage; correlated setup/model factors; bounded severe-decay deductions; and selection of only one direction for ten underlying setups. The seven-day synthetic contract still slightly outranks the fourteen-day version despite much worse carry, because convexity offsets the capped deduction. That tradeoff is exposed, not silently tuned away.

Pricing assumes constant volatility and carry between discrete events. It does not model stochastic volatility, jumps, smile dynamics, stochastic rates, dividend uncertainty or broker exercise procedures. Price convergence is tested at entry and primary scoring states, not every auxiliary matrix cell; Greek convergence near every exercise/dividend boundary is not independently guaranteed. The penny-based absolute tolerance is material for cheap options. The fast path is analytically exact only within its stated conditions.

The proportional exit-spread assumption can be optimistic for cheap, distressed or illiquid contracts. Displayed size and OI can disappear or be stale; the gates are snapshot checks, not a liquidity forecast. Dividend absence may reflect incomplete coverage, and a generic observed rate is not necessarily a correctly compounded tenor-matched discount curve. The embedded exchange calendar covers 2026 only. These limitations must stay visible in #214; synthetic coherence and an independent pricing oracle do not prove profitable contract selection.
