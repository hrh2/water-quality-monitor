# JS/Python Inference Parity Check

`api/_lib/predict.js` re-implements evaluation of the exported
`ml/models/portable_model.json` in plain JavaScript (see
`docs/architecture/adr-002-ml-inference-runtime.md` for why). Since this is
a hand-written re-implementation of scikit-learn's `RandomForestClassifier.predict_proba`
(averaging per-tree leaf class-count distributions), it was manually
verified against the original Python pipeline before being relied on.

## Method

Four representative feature vectors were run through both:
- the original fitted pipeline (`ml/models/best_model_pipeline.joblib`) via `pipeline.predict_proba`, and
- the exported JSON + `predictWaterQuality()` in `api/_lib/predict.js`,

including one case with `ph: null` to exercise the median-imputation path.

## Result

All four cases produced identical class probabilities to 4 decimal places
and identical predicted classes:

| Input | Python `predict_proba` | JS `predictWaterQuality` | Match |
|---|---|---|---|
| ph=7.2, turbidity_ntu=2.1, tds_ppm=210 | Safe 0.9986 | Safe 0.9986 | Yes |
| ph=5.9, turbidity_ntu=15.0, tds_ppm=900 | Unsafe 0.8297 | Unsafe 0.8297 | Yes |
| ph=null, turbidity_ntu=90.0, tds_ppm=3000 | Critical 0.6058 | Critical 0.6058 | Yes |
| ph=6.6, turbidity_ntu=6.0, tds_ppm=550 | Moderate 0.8527 | Moderate 0.8527 | Yes |

## Status

**Experimentally verified** for the model family currently deployed
(`random_forest`). This is a point-in-time manual check, not a continuously
running property test; `tests/backend/predict.test.js` provides ongoing
regression coverage (probabilities sum to 1, argmax matches
`prediction_confidence`, extreme/clean inputs map to the expected
category) against the live exported model, but does not re-verify parity
against the Python pipeline on every run. If the deployed model family
changes (e.g. to `logistic_regression`), this check should be re-run and
this table updated - **not** assumed to still hold.
