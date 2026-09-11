# Pre-Claude attention priority v2

Version `attention-review-priority-v2` is the production attention admission score. It is deterministic, uses only information available before Claude review, and records every component in `/research/logs`.

The total review budget remains 30 with the existing allocation:

- Attention: 12
- Fundamentals: 10
- Filing changes: 5
- Insider: 3

Fundamentals, filing changes, and insider retain their existing evidence priority without rounding or other changes. They do not need social evidence. For candidates eligible in more than one stream, the overall admission priority remains the maximum of the stream scores; only the attention stream score is supplied by v2.

## Root cause of the former score

Each archived attention signal received `signal.score * 10`, clamped to 100. Admission then used the maximum priority of any eligible evidence item. One broad social post could therefore give every ticker it mentioned a 95–100 priority. Additional independent evidence, source diversity, and catalyst specificity did not affect admission.

The September 11 persisted run had 26 of 85 candidates at or above 95; 11 were exactly 100, including several candidates with one evidence item.

## V2 score

| Component | Range | Evidence used |
| --- | ---: | --- |
| Evidence quality | 0–20 | Distinct archived evidence documents, capped after four |
| Independent sources | 0–20 | Distinct publishers/domains, capped after four |
| Specific catalyst | 0–20 | Catalyst language, a concrete date, concrete numbers, and open-market insider buying |
| Technical confirmation | 0–10 | Finviz/screener or premarket evidence |
| Freshness | 0–10 | Age of the newest known evidence at the admission cutoff |
| Multiple evidence channels | 0–12 | Independent social, news, technical, or primary-disclosure channels |
| Original signal strength | 0–8 | The former signal score, bounded to a small share of v2 |
| Penalties | 0 to -40 | Publisher concentration/repetition, context-only evidence, routine insider events, unsupported hype, and negative evidence |

Long multi-company posts are evaluated using text near the candidate's own ticker/name so a catalyst about one company does not automatically credit every ticker in the post. No model output or future return enters the score.

Each candidate stores:

- `priority`: the active production admission score
- `priorityModel`: the explicit version, `usedForAdmission: true`, stream scores, component breakdown, and extracted feature counts
- `legacyPriority`: the former max-evidence score
- active and legacy overall/stream ranks

## Persisted-run validation

Run `npm run research:priority:compare -- --runs=5` with the normal Redis environment configured. The command loads persisted nightly candidate traces and their immutable evidence records, then reports legacy/production saturation, cutoff changes, and candidates entering or leaving the 12-name attention window. `--json` emits the full ordering.

The command was run read-only against the September 11, 2026 nightly run (`f7591fab-9e12-4885-89bf-c5a4f4a9d710`). All 198 referenced evidence records loaded; three candidate traces had been truncated at ten items.

| Result | Former priority | Production v2 |
| --- | ---: | ---: |
| Candidates scoring at least 95 | 26 | 0 |
| Attention cutoff | ADBE · 99.4 | AAPL · 63.9 |

V2 adds MS, GME, UBER, ORCL, M, and AAPL to the 12-name attention window and removes COHR, AAOI, LITE, GOOGL, RXT, and SNDK.

Candidate traces from older runs retain at most ten evidence IDs. The comparison reports truncated traces so historical results do not imply complete source coverage. Production admission now stores the full v2 breakdown at decision time.

Any later weight or feature change requires a new explicit version. Historical forward outcomes can evaluate this frozen version after the fact; they must not be used to retroactively tune `attention-review-priority-v2`.
