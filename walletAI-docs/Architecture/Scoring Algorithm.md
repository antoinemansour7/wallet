# Scoring Algorithm

How a ticker gets ranked before Claude ever sees it.

---

## Archetype Score Formula

```
archetypeScore =
    signalCount * 0.42
  + maxScore * 0.42
  + squeezeSignals * 2.4
  + volumeSignals * 1.8
  + breakoutSignals * 2.2
  + catalystSignals * 0.9
  + accountMentions * 0.5
  + convictionMentions * 0.75
  + searchMentions * 0.35
  + screenerMentions * 2.5
  + min(articleCount, 2) * 0.22
  + (repeatedAttention ? +2.0 : -1.25)
  + pricePreferenceScore(price)
```

## Bonuses

| Condition | Bonus |
|-----------|-------|
| Tech/semiconductor theme | +1.5 |
| Moderate dip (3-8%) + repeated attention + no negative signals | +1.2 |
| Repeated multi-day attention | +2.0 |

## Penalties

| Condition | Penalty |
|-----------|---------|
| Not quote-verified | -6.0 |
| Penny stock (<$5) | -3.25 |
| Context-heavy (0 conviction mentions) | -2.4 |
| Huge down day (<= -15%) | -5.5 |
| Moderate down (<= -8%) | -2.25 |
| Sector ETF <= -3% | -3.0 |
| Sector ETF <= -1.5% | -1.5 |
| Sector ETF <= -0.5% | -0.5 |
| Signal count >4 but <=1 source | -2.0 (noise penalty) |
| Signal count >3 with no catalyst/squeeze/breakout | -1.5 |
| News-heavy (articles > signals + 2) | -0.75 |
| Mega-cap crowd favorite | variable |
| Negative signals | -1.8 per signal |

## Price Band Preference

The `pricePreferenceScore()` function favors stocks in the $8-$150 range (starter to core-upside):
- **starter** ($5-$20): slight bonus
- **core-upside** ($20-$80): ideal range
- **growth** ($80-$150): still good
- **mega** ($150+): slight penalty

## Signal Volume Cap

Added to prevent "loud but empty" signals from dominating:
- If a ticker has >4 signals but only 1 source → -2.0 (one person spamming)
- If a ticker has >3 signals but zero catalyst/squeeze/breakout themes → -1.5 (no substance)

## Example Calculation

```
AMD:
  signalCount=5 * 0.42 = 2.1
  squeezeSignals=0
  breakoutSignals=1 * 2.2 = 2.2
  screenerMentions=1 * 2.5 = 2.5
  repeatedAttention=true → +2.0
  hasTechTheme → +1.5
  sectorTrend: XLK +1.56% → no penalty
  ≈ score 10+ → strong candidate
```
