# Contamination Detection

Implemented in `api/_lib/contamination.js`, invoked from
`api/_lib/ingest.js::ingestReading` on every accepted reading. This is
**independent of the ML classifier** (`api/_lib/predict.js`) - it combines
three separate signals into one `contamination_risk` boolean plus a list
of human-readable reasons.

## 1. Rule-based hard thresholds (`ruleBasedContaminationFlag`)

Absolute thresholds, informed by the same WHO/EPA reference points used in
`docs/machine-learning/target-methodology.md`:

| Field | Threshold | Source comment |
|---|---|---|
| `turbidity_ntu` | `> 50` | "WHO: severely degraded above this" |
| `tds_ppm` | `> 2000` | "WHO/EPA: unacceptable above this" |
| `ph` | `< 5.5` or `> 9.5` | matches the outer band of the target-methodology penalty table |

Any one of these being true sets `flagged: true` with a specific reason
string (e.g. `"turbidity_ntu 92.3 exceeds 50 NTU"`).

## 2. Statistical anomaly check (`statisticalAnomalyFlag`)

Compares the incoming reading against **the same device's own recent
history** (the last 30 readings, fetched in `ingestReading` and passed in),
requiring at least 10 data points before it will flag anything
(`"insufficient history for statistical check"` otherwise). For
`turbidity_ntu` and `tds_ppm` independently: computes the mean and
population standard deviation of the recent values, then a z-score for the
new reading; `|z| > 3` triggers a flag
(`"<field> z-score <z> exceeds +-3 vs recent device history"`). This
catches sudden shifts even when a value hasn't crossed an absolute
threshold yet - e.g. a device whose baseline turbidity is unusually high
but stable would not trip the hard threshold, but a sudden further jump
would trip the z-score check.

## 3. Predicted category (`assessContaminationRisk`)

`water_quality_category === 'Critical' || 'Unsafe'` alone is treated as a
contamination-risk trigger (reason: `"predicted category is <category>"`),
independent of whether the rule or statistical checks also fired.

## 4. Combination

```js
contamination_risk = ruleResult.flagged || statResult.flagged || categoryTriggered
```

All matched reasons across all three checks are concatenated into one
`reasons` array, which flows into `predictions.contamination_risk` and, if
severity warrants it, into an `alerts.reason` string
(`api/_lib/alerts.js::createAlertsIfNeeded`, `docs/database/schema.md`).

## 5. Terminology rule

Enforced throughout this module and its callers, matching
`docs/architecture/data-contract.md` §3: output language is always
**"potential contamination risk"**, never a claim of having identified a
specific pathogen, chemical, or microbiological agent. The sensors
installed (`ph`, `turbidity_ntu`, `tds_ppm`) cannot measure any of those
directly, so the system does not claim to. This is a hard terminology
constraint, not a phrasing preference - see
`docs/limitations/ml-limitations.md` for the fuller discussion of what the
system can and cannot actually determine about water safety.
