# Target Variable Methodology: `water_quality_category`

## 1. Why a derived label instead of a measured one

The firmware measures exactly three parameters: `ph`, `turbidity_ntu`,
`tds_ppm`. There is no lab-confirmed potability ground truth available (no
microbiological testing, no certified water-quality lab dataset tied to this
specific sensor rig). Therefore the label used to train the classifier is
**engineered from domain thresholds, not measured**. This is an explicit,
documented limitation, not a hidden assumption — see
`docs/limitations/ml-limitations.md`.

**Distinction enforced everywhere in this project:**

| Term | Meaning |
|---|---|
| Measured | Values that come directly from a sensor |
| Generated | Synthetic dataset values produced by `ml/data_generation/generate_dataset.py` |
| Predicted | The ML model's output class/probability |
| Simulated label | `water_quality_category` in the training set, computed by the rule below, not by a lab |
| Not yet experimentally validated | Anything the system has not measured against certified reference instruments/lab samples |

The system **never claims to certify drinking water potability**. It predicts
an *engineering water-quality category*, and separately raises a
*contamination risk flag* (`docs/machine-learning/contamination-detection.md`)
when values are anomalous. Actual potability requires certified laboratory
microbiological and chemical testing beyond this project's sensor scope.

## 2. Reference ranges used

Thresholds are informed by commonly cited WHO drinking-water guideline
values and US EPA secondary drinking water standards, used here as
*reasonable engineering reference points*, not as a claim that this system
implements or is certified against those standards:

- **pH**: WHO guidance range for drinking water is approximately 6.5–8.5
  (an aesthetic/operational range, not itself a direct health limit).
- **Turbidity**: WHO guidance targets under ~5 NTU for treated water, with
  <1 NTU desirable for effective disinfection; values above ~10 NTU are
  considered poor, above ~50 NTU severely degraded.
- **TDS**: WHO/EPA guidance treats <500 mg/L (ppm) as good, 500–1000 as
  acceptable-to-poor, 1000–2000 as poor, and >2000 as unacceptable for
  general use.

## 3. Composite scoring rule

Each parameter is assigned a **penalty score** based on its deviation from
the acceptable range:

| pH range | Penalty | Turbidity (NTU) | Penalty | TDS (ppm) | Penalty |
|---|---|---|---|---|---|
| 6.5 – 8.5 | 0 | ≤ 5 | 0 | ≤ 500 | 0 |
| 6.0–6.5 or 8.5–9.0 | 1 | 5 – 10 | 1 | 500 – 1000 | 1 |
| 5.5–6.0 or 9.0–9.5 | 2 | 10 – 50 | 2 | 1000 – 2000 | 2 |
| < 5.5 or > 9.5 | 3 | > 50 | 3 | > 2000 | 3 |

`total_penalty = ph_penalty + turbidity_penalty + tds_penalty` (range 0–9).

| `total_penalty` | `water_quality_category` |
|---|---|
| 0 – 1 | Safe |
| 2 – 3 | Moderate |
| 4 – 6 | Unsafe |
| 7 – 9 | Critical |

This is implemented once, in `ml/data_generation/generate_dataset.py`
(`assign_category()`), and must not be re-implemented differently elsewhere.

## 4. Why this avoids a trivially separable dataset

The label is computed from the *true* underlying parameter values generated
per sample. Independent Gaussian measurement noise is then added to produce
the *observed* sensor columns actually stored in the dataset. This means a
classifier trained on the observed (noisy) columns cannot achieve trivial
100% accuracy by re-deriving the deterministic rule — it must learn a
boundary from noisy evidence, the same way a real sensor deployment would
face measurement error. This is discussed further in
`docs/limitations/ml-limitations.md`.

## 5. Number of classes

Four classes (`Safe`, `Moderate`, `Unsafe`, `Critical`) were chosen instead of
a binary safe/unsafe split because:

- it matches the granularity the three-parameter composite score can support
  (10 possible penalty totals collapse naturally into 4 bands),
- it gives the dashboard and alerting system meaningful severity tiers
  (`docs/architecture/data-contract.md` §3), and
- it remains small enough to keep per-class sample sizes sufficient for
  reliable evaluation at the dataset size used
  (`docs/experiments/dataset_analysis`).
