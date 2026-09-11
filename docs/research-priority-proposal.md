# Pre-Claude attention priority proposal

Ticket #176 starts as an investigation and shadow proposal. Version `attention-review-priority-v2-shadow.1` is recorded with admission diagnostics, but `usedForAdmission` remains `false`. The production 30-name review budget, its 12/10/5/3 strategy allocation, ranking logic, and research behavior are unchanged.

## Root cause

Each archived attention signal currently receives `signal.score * 10`, clamped to 100. Admission then sets a candidate's priority to the maximum priority of any eligible evidence item. One broad social post can therefore give every ticker it mentions a 95–100 priority. Additional independent evidence, source diversity, and catalyst specificity do not affect that admission score. The September 11 persisted run had 26 of 85 candidates at or above 95; 11 were exactly 100, including several candidates with one evidence item.

## Shadow score

The proposal uses only fields available before Claude and records each component in `/research/logs`:

| Component | Range | Evidence used |
| --- | ---: | --- |
| Evidence quality | 0–20 | Distinct archived evidence documents, capped after four |
| Independent sources | 0–20 | Distinct publishers/domains, capped after four |
| Specific catalyst | 0–20 | Catalyst language, a concrete date, concrete numbers, and open-market insider buying |
| Technical confirmation | 0–10 | Finviz/screener or premarket evidence |
| Freshness | 0–10 | Age of the newest known evidence at the admission cutoff |
| Multiple evidence channels | 0–12 | Independent social, news, technical, or primary-disclosure channels |
| Original signal strength | 0–8 | The existing signal score, deliberately bounded to a small share |
| Penalties | 0 to -40 | Publisher concentration/repetition, context-only evidence, routine insider events, unsupported hype, and negative evidence |

Long multi-company posts are evaluated using text near the candidate's own ticker/name so a catalyst about one company does not automatically credit every ticker in the post. Scores and feature counts are persisted with an explicit version, and no model or future return enters the calculation.

Non-attention strategies retain their existing deterministic priority in the proposal. SEC and fundamentals candidates do not need social evidence. For candidates present in more than one stream, the proposed overall score is the maximum of the attention shadow score and the unchanged score for their other streams.

## Evaluation workflow

Run `npm run research:priority:compare -- --runs=5` with the normal Redis environment configured. The command loads persisted nightly candidate traces and their immutable evidence records, then reports current/proposed saturation, the attention cutoff, and candidates that would enter or leave the 12-name attention window. `--json` emits the full ordering for analysis.

Candidate traces retain at most ten evidence IDs. The command reports how many traces were truncated so historical comparisons do not imply complete source coverage. New admission records store the full shadow breakdown at decision time and remove that limitation for future evaluation.

The proposal was run read-only against the September 11, 2026 persisted nightly run (`f7591fab-9e12-4885-89bf-c5a4f4a9d710`). All 198 referenced evidence records loaded; three candidate traces had been truncated at ten items. The current score had 26 candidates at or above 95, while the proposal had zero. At the 12-name attention cutoff, the current ordering ended at ADBE with 99.4; the proposal ended at AAPL with 63.9. The proposed window added MS, GME, UBER, ORCL, M, and AAPL and removed COHR, AAOI, LITE, GOOGL, RXT, and SNDK. This comparison is diagnostic evidence about ordering and saturation, not a decision to adopt the weights.

Promoting a proposal version into admission policy requires a separate, reviewed change with a version bump and evaluation tests. Historical forward outcomes can evaluate a frozen version after the fact; they must not be used to tune this version's weights.
