#!/usr/bin/env python3
"""Regenerate the independent option-pricing oracle fixture (epic #201, story #210).

This script is a DEVELOPMENT tool, never imported at runtime. It produces
`src/server/options/fixtures/pricing/oracle.json`, the independently sourced
expectations that `src/server/options/pricing.js` is tested against.

The oracle is QuantLib's finite-difference Black-Scholes engine -- the benchmark
the epic names explicitly -- plus QuantLib's closed-form analytic European engine
for the no-dividend Black-Scholes reference cases. The production pricer is a
Cox-Ross-Rubinstein binomial lattice with Vellekoop-Nieuwenhuis discrete-dividend
handling, so the two sides share no numerical method, no code and no library.

Usage (QuantLib is NOT a repository dependency -- install it in a throwaway venv):

    python3 -m venv /tmp/qlvenv
    /tmp/qlvenv/bin/pip install QuantLib
    /tmp/qlvenv/bin/python scripts/options-pricing-oracle.py

Conventions written into the fixture, matching src/server/options/pricing.js:
  * time            Actual/365 fixed; every case is an integer number of days
                    so both sides derive the same year fraction exactly.
  * rates           continuously compounded.
  * dividendYield   continuous carry, i.e. continuous yield + borrow assumption.
  * dividends       discrete cash amounts on integer ex-dividend day offsets.
  * price/greeks    per share (multiply by the 100-share multiplier for a contract).
  * vega            per 1.00 volatility POINT (a 0.01 change in sigma).
  * theta           per calendar day.
  * rho             per 1.00 percentage point of rate (a 0.01 change in r).
"""

import json
import os
from datetime import date

import QuantLib as ql

DAY_COUNT = ql.Actual365Fixed()
CALENDAR = ql.NullCalendar()
TODAY = ql.Date(22, 9, 2026)

# Grid resolution for the finite-difference oracle. `COARSE` exists only to
# record a convergence delta in the fixture, so a future reader can see the
# oracle itself was converged before it was trusted as an expectation.
FINE = dict(t_grid=4000, x_grid=4000, damping=2)
COARSE = dict(t_grid=2000, x_grid=2000, damping=2)

OUTPUT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "src", "server", "options", "fixtures", "pricing", "oracle.json",
)


def process(spot, vol, rate, yield_):
    spot_handle = ql.QuoteHandle(ql.SimpleQuote(spot))
    rate_handle = ql.YieldTermStructureHandle(ql.FlatForward(TODAY, rate, DAY_COUNT))
    yield_handle = ql.YieldTermStructureHandle(ql.FlatForward(TODAY, yield_, DAY_COUNT))
    vol_handle = ql.BlackVolTermStructureHandle(
        ql.BlackConstantVol(TODAY, CALENDAR, vol, DAY_COUNT)
    )
    return ql.BlackScholesMertonProcess(spot_handle, yield_handle, rate_handle, vol_handle)


def dividend_schedule(dividends):
    schedule = ql.DividendSchedule()
    for dividend in dividends:
        when = TODAY + int(dividend["daysFromNow"])
        schedule.append(ql.FixedDividend(float(dividend["amount"]), when))
    return schedule


def build(case, spot=None, vol=None, rate=None, days=None):
    """Build a priced QuantLib option for `case`, optionally with bumped inputs."""
    spot = case["spot"] if spot is None else spot
    vol = case["volatility"] if vol is None else vol
    rate = case["riskFreeRate"] if rate is None else rate
    days = case["daysToExpiry"] if days is None else days

    payoff = ql.PlainVanillaPayoff(
        ql.Option.Call if case["type"] == "call" else ql.Option.Put, case["strike"]
    )
    expiry = TODAY + int(days)
    exercise = (
        ql.AmericanExercise(TODAY, expiry)
        if case["exercise"] == "american"
        else ql.EuropeanExercise(expiry)
    )
    option = ql.VanillaOption(payoff, exercise)
    underlying = process(spot, vol, rate, case.get("dividendYield", 0.0))
    dividends = [d for d in case.get("dividends", []) if d["daysFromNow"] <= days]

    if case["engine"] == "analytic":
        option.setPricingEngine(ql.AnalyticEuropeanEngine(underlying))
        return option

    grid = case.get("grid", FINE)
    # CashDividendModel defaults to Spot: the dividend is a genuine downward
    # jump in the spot at the ex-date, not an escrowed present-value fudge.
    option.setPricingEngine(
        ql.FdBlackScholesVanillaEngine(
            underlying, dividend_schedule(dividends),
            grid["t_grid"], grid["x_grid"], grid["damping"],
        )
    )
    return option


def european_equivalent(case):
    """True where early exercise is provably never optimal, so the closed form is exact.

    A call with no discrete dividend and no positive carry is never worth
    exercising early: there is no moment at which giving up the remaining time
    value pays. Its American value IS its European value, Greeks included.
    """
    if any(d["daysFromNow"] < case["daysToExpiry"] for d in case.get("dividends", [])):
        return False
    if case["exercise"] == "european":
        return True
    return case["type"] == "call" and case.get("dividendYield", 0.0) <= 0.0


def analytic_twin(case):
    """The closed-form European option matching `case`."""
    twin = dict(case, engine="analytic", exercise="european")
    return build(twin)


def greeks(case):
    """Price and Greeks for one case, all in the fixture's documented units."""
    option = build(case)
    price = option.NPV()

    if european_equivalent(case):
        # Closed form, and exact. Worth preferring even for the finite-difference
        # cases: QuantLib's FD theta() differences the value over the grid's
        # first time step, which is a poor estimate of an instantaneous rate when
        # the whole maturity is a day or two. The FD PRICE is still checked
        # against the closed form below, so nothing is taken on trust.
        twin = analytic_twin(case)
        delta, gamma = twin.delta(), twin.gamma()
        vega, theta = twin.vega() / 100.0, twin.thetaPerDay()
        rho = twin.rho() / 100.0
        engine = "analytic-european"
        if case["engine"] != "analytic":
            gap = abs(price - twin.NPV())
            assert gap < 1e-4, f"{case['id']}: FD {price} vs closed form {twin.NPV()} differ by {gap}"
    else:
        # Genuine early exercise: no closed form exists. Delta/gamma/theta come
        # off the finite-difference grid itself; vega and rho are not available
        # from this engine, so bump the oracle's own inputs.
        delta, gamma = option.delta(), option.gamma()
        theta = option.theta() / 365.0
        vol_bump = 0.005
        vega = (
            build(case, vol=case["volatility"] + vol_bump).NPV()
            - build(case, vol=case["volatility"] - vol_bump).NPV()
        ) / (2 * vol_bump) / 100.0
        rate_bump = 0.0005
        rho = (
            build(case, rate=case["riskFreeRate"] + rate_bump).NPV()
            - build(case, rate=case["riskFreeRate"] - rate_bump).NPV()
        ) / (2 * rate_bump) / 100.0
        engine = "finite-difference"

    return dict(
        price=round(price, 6), delta=round(delta, 6), gamma=round(gamma, 6),
        vega=round(vega, 6), theta=round(theta, 6), rho=round(rho, 6),
    ), engine


def convergence(case):
    """|fine - coarse| for the FD cases, so the oracle's own error is on record."""
    if case["engine"] == "analytic":
        return 0.0
    coarse = dict(case, grid=COARSE)
    return round(abs(build(case).NPV() - build(coarse).NPV()), 8)


# --- Cases -------------------------------------------------------------------
# Every case states what it is there to prove. Day counts are integers so the
# JS side derives an identical year fraction; nothing here depends on a session
# calendar, which is exercised separately by the horizon tests.

CASES = [
    # 1. The epic's own illustrative case (section 4) and the scenario points it
    #    quotes. These are the numbers a reader will check by hand first.
    dict(id="epic-illustration-entry", engine="analytic", exercise="european", type="call",
         spot=180.0, strike=200.0, daysToExpiry=30, volatility=0.597554, riskFreeRate=0.04,
         dividendYield=0.0, dividends=[],
         note="Epic #201 section 4 illustration: expected ~$5.50 entry premium."),
    dict(id="epic-illustration-up-3-days", engine="analytic", exercise="european", type="call",
         spot=189.0, strike=200.0, daysToExpiry=27, volatility=0.597554, riskFreeRate=0.04,
         dividendYield=0.0, dividends=[],
         note="S=$189 after 3 calendar days, unchanged IV: expected ~$8.05, still OTM."),
    dict(id="epic-illustration-up-3-days-iv-down-10pct", engine="analytic", exercise="european",
         type="call", spot=189.0, strike=200.0, daysToExpiry=27, volatility=0.597554 * 0.9,
         riskFreeRate=0.04, dividendYield=0.0, dividends=[],
         note="Relative IV -10% is 53.78%, not 49.76%: expected ~$6.87."),
    dict(id="epic-illustration-up-3-days-iv-up-10pct", engine="analytic", exercise="european",
         type="call", spot=189.0, strike=200.0, daysToExpiry=27, volatility=0.597554 * 1.1,
         riskFreeRate=0.04, dividendYield=0.0, dividends=[],
         note="Relative IV +10% is 65.73%: expected ~$9.24."),
    dict(id="epic-illustration-unchanged-3-days", engine="analytic", exercise="european",
         type="call", spot=180.0, strike=200.0, daysToExpiry=27, volatility=0.597554,
         riskFreeRate=0.04, dividendYield=0.0, dividends=[],
         note="Stock unchanged for 3 calendar days: time-only decay, expected ~$4.94."),

    # 2. No-dividend Black-Scholes reference cases across moneyness.
    dict(id="bs-european-call-atm", engine="analytic", exercise="european", type="call",
         spot=100.0, strike=100.0, daysToExpiry=30, volatility=0.30, riskFreeRate=0.05,
         dividendYield=0.0, dividends=[], note="Closed-form ATM call reference."),
    dict(id="bs-european-put-atm", engine="analytic", exercise="european", type="put",
         spot=100.0, strike=100.0, daysToExpiry=30, volatility=0.30, riskFreeRate=0.05,
         dividendYield=0.0, dividends=[], note="Closed-form ATM put reference (put-call parity anchor)."),
    dict(id="bs-european-call-otm-low-vol", engine="analytic", exercise="european", type="call",
         spot=100.0, strike=120.0, daysToExpiry=45, volatility=0.18, riskFreeRate=0.04,
         dividendYield=0.0, dividends=[], note="Far OTM, low vol: small premium, tolerance floor dominates."),
    dict(id="bs-european-put-itm-high-vol", engine="analytic", exercise="european", type="put",
         spot=100.0, strike=125.0, daysToExpiry=60, volatility=0.75, riskFreeRate=0.04,
         dividendYield=0.0, dividends=[], note="Deep ITM, high vol."),

    # 3. A no-dividend American CALL must equal its European twin: early exercise
    #    is never optimal. This is the fast path the production pricer takes.
    dict(id="american-call-no-dividend-equals-european", engine="fd", exercise="american",
         type="call", spot=100.0, strike=105.0, daysToExpiry=40, volatility=0.35,
         riskFreeRate=0.05, dividendYield=0.0, dividends=[],
         note="No dividend: American call value equals the European value."),

    # 4. American PUTS carry a genuine early-exercise premium; higher rates and
    #    deeper moneyness make it larger.
    dict(id="american-put-atm", engine="fd", exercise="american", type="put",
         spot=100.0, strike=100.0, daysToExpiry=45, volatility=0.30, riskFreeRate=0.05,
         dividendYield=0.0, dividends=[], note="American put, ATM, early-exercise premium present."),
    dict(id="american-put-itm-high-rate", engine="fd", exercise="american", type="put",
         spot=90.0, strike=110.0, daysToExpiry=60, volatility=0.25, riskFreeRate=0.08,
         dividendYield=0.0, dividends=[], note="Deep ITM at a high rate: large early-exercise premium."),
    dict(id="american-put-otm-short-dated", engine="fd", exercise="american", type="put",
         spot=100.0, strike=92.0, daysToExpiry=10, volatility=0.45, riskFreeRate=0.04,
         dividendYield=0.0, dividends=[], note="Short-dated OTM put: convexity and fast decay."),

    # 5. Discrete dividends. An American call on a dividend payer CAN be worth
    #    exercising just before an ex-date, which is the case a Black-Scholes
    #    valuation gets wrong.
    dict(id="american-call-one-discrete-dividend", engine="fd", exercise="american", type="call",
         spot=100.0, strike=95.0, daysToExpiry=40, volatility=0.25, riskFreeRate=0.05,
         dividendYield=0.0, dividends=[dict(daysFromNow=20, amount=2.0)],
         note="ITM call over a $2.00 ex-dividend at day 20: early exercise can bind."),
    dict(id="american-call-large-dividend-before-expiry", engine="fd", exercise="american",
         type="call", spot=100.0, strike=90.0, daysToExpiry=30, volatility=0.20,
         riskFreeRate=0.03, dividendYield=0.0, dividends=[dict(daysFromNow=25, amount=4.0)],
         note="Large late dividend: exercise just before the ex-date is clearly optimal."),
    dict(id="american-put-with-discrete-dividend", engine="fd", exercise="american", type="put",
         spot=100.0, strike=105.0, daysToExpiry=50, volatility=0.30, riskFreeRate=0.04,
         dividendYield=0.0, dividends=[dict(daysFromNow=15, amount=1.5)],
         note="A dividend raises a put's value and delays early exercise."),
    dict(id="american-put-two-discrete-dividends", engine="fd", exercise="american", type="put",
         spot=50.0, strike=55.0, daysToExpiry=60, volatility=0.35, riskFreeRate=0.05,
         dividendYield=0.0, dividends=[dict(daysFromNow=12, amount=0.6), dict(daysFromNow=47, amount=0.6)],
         note="Two ex-dates inside the option's life."),
    dict(id="european-call-with-discrete-dividend", engine="fd", exercise="european", type="call",
         spot=100.0, strike=100.0, daysToExpiry=35, volatility=0.28, riskFreeRate=0.05,
         dividendYield=0.0, dividends=[dict(daysFromNow=18, amount=1.25)],
         note="European with a discrete dividend: isolates the dividend jump from early exercise."),

    # 6. A continuous carry rate standing in for a borrow assumption.
    dict(id="american-put-with-borrow-carry", engine="fd", exercise="american", type="put",
         spot=100.0, strike=100.0, daysToExpiry=30, volatility=0.40, riskFreeRate=0.04,
         dividendYield=0.06, dividends=[],
         note="Hard-to-borrow name: a 6% continuous carry lowers the forward."),

    # 7. Expiry boundaries. One day left, and intrinsic-value floors.
    dict(id="expiry-boundary-one-day-call", engine="fd", exercise="american", type="call",
         spot=100.0, strike=98.0, daysToExpiry=1, volatility=0.35, riskFreeRate=0.05,
         dividendYield=0.0, dividends=[], note="One day to expiry: value is close to intrinsic."),
    dict(id="expiry-boundary-deep-itm-put", engine="fd", exercise="american", type="put",
         spot=40.0, strike=100.0, daysToExpiry=20, volatility=0.30, riskFreeRate=0.05,
         dividendYield=0.0, dividends=[],
         note="Deep ITM American put sits on its exercise boundary: value equals intrinsic."),
]


def main():
    cases = []
    for case in CASES:
        result, greeks_engine = greeks(case)
        inputs = {key: case[key] for key in (
            "type", "exercise", "spot", "strike", "daysToExpiry", "volatility",
            "riskFreeRate", "dividendYield", "dividends",
        )}
        cases.append(dict(
            id=case["id"], note=case["note"], inputs=inputs, expected=result,
            priceEngine="analytic-european" if case["engine"] == "analytic" else "finite-difference",
            greeksEngine=greeks_engine,
            oracleConvergenceDelta=convergence(case),
        ))
        print(f"{case['id']:<44} price={result['price']:.6f}")

    fixture = dict(
        version="options-pricing-oracle-quantlib-1.43-v1",
        generatedOn=str(date.today()),
        generator="scripts/options-pricing-oracle.py",
        oracle=dict(
            library="QuantLib", libraryVersion=ql.__version__,
            engines=dict(
                analytic="AnalyticEuropeanEngine (closed-form Black-Scholes-Merton)",
                fd=f"FdBlackScholesVanillaEngine, CashDividendModel.Spot, "
                   f"tGrid={FINE['t_grid']} xGrid={FINE['x_grid']} damping={FINE['damping']}",
            ),
            url="https://github.com/lballabio/QuantLib/blob/master/ql/pricingengines/vanilla/fdblackscholesvanillaengine.hpp",
        ),
        conventions=dict(
            dayCount="Actual/365 fixed; daysToExpiry/365 is the year fraction",
            rates="continuously compounded",
            dividendYield="continuous carry: continuous dividend yield plus borrow assumption",
            dividends="discrete cash amounts at integer ex-dividend day offsets",
            units="per share; vega per 1.00 volatility point; theta per calendar day; "
                  "rho per 1.00 percentage point of rate",
        ),
        cases=cases,
    )

    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    with open(OUTPUT, "w") as handle:
        json.dump(fixture, handle, indent=2)
        handle.write("\n")
    print(f"\nWrote {len(cases)} cases to {OUTPUT}")


if __name__ == "__main__":
    main()
