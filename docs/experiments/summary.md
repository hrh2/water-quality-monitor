# Experiments Summary

Narrative summary of the real contents of `experiments/dataset_analysis/`
and `experiments/model_comparison/`. Full tables live in
`docs/machine-learning/model-comparison.md`; this document links to the
underlying files rather than repeating them.

## Dataset analysis

Source: `experiments/dataset_analysis/dataset_summary.json`,
`correlation_matrix.csv`, and the PNGs in the same directory, all produced
by `ml/training/train.py::run_eda` from the cleaned 6000-row generated
dataset (`data/generated/water_quality_dataset.csv`).

**Class distribution** (`dataset_summary.json`, `class_distribution.png`):
`Safe: 3099`, `Moderate: 1243`, `Unsafe: 973`, `Critical: 685` - out of
6000 total rows. This is intentionally imbalanced toward `Safe`
(`CLASS_WEIGHTS` in `generate_dataset.py`: 0.45/0.30/0.18/0.07), modeling
the assumption that a real deployment sees mostly-safe water with
progressively rarer degraded conditions. This imbalance is why the model
comparison uses macro-averaged metrics (`precision_macro`, `recall_macro`,
`f1_macro`) rather than relying on plain accuracy alone, so that
performance on the rarer `Critical`/`Unsafe` classes isn't masked by the
`Safe` majority.

**Missing values** (`dataset_summary.json`): only `ph` has missing values
(115 out of 6000, ~1.9%), matching the firmware's real Modbus-failure
behavior (`phOk == false` -> null) that `generate_dataset.py` deliberately
mirrors. `turbidity_ntu` and `tds_ppm` have zero missing values, since the
ADS1115 channels always produce *some* voltage reading.

**Feature ranges** (`dataset_summary.json`'s `describe` block): `ph` mean
6.65 (std 0.97, observed range 1.93-9.08 in the generated dataset after
cleaning); `turbidity_ntu` mean 12.65 NTU (std 21.98, max 316.2 - a long
right tail, consistent with the gamma-distributed generating process used
for the `Critical` class); `tds_ppm` mean 745.2 ppm (std 686.5, max 5602 -
similarly long-tailed).

**Correlation** (`correlation_heatmap.png`, `correlation_matrix.csv`): the
three sensor features' pairwise correlation structure as actually observed
in the generated dataset. Refer to `correlation_matrix.csv` directly for
exact coefficients rather than restating them here from a rendered image.

**Feature distributions by class** (`feature_distributions_by_class.png`):
per-class boxplots for `ph`, `turbidity_ntu`, `tds_ppm`, showing the
intentional overlap between adjacent classes (e.g. `Moderate` vs `Unsafe`
turbidity) that keeps the classification task non-trivial - see
`docs/machine-learning/target-methodology.md` §4 for why this overlap is
deliberate.

## Model comparison

Source: `experiments/model_comparison/model_comparison.csv` /
`.json`, full table already transcribed in
`docs/machine-learning/model-comparison.md` - not repeated here.

In summary: six model families were trained and 5-fold cross-validated on
the training split (`gradient_boosting`, `random_forest`, `decision_tree`,
`knn`, `svm_rbf`, `logistic_regression`, in descending order of CV
`f1_macro`). The top two, `gradient_boosting` (CV f1_macro 0.9102) and
`random_forest` (0.9101), are separated by a difference well within one
standard deviation of either's CV score - effectively a statistical tie.
Because model selection for production deployment is restricted to models
`ml/inference/export_portable_model.py` can serialize
(`docs/architecture/adr-002-ml-inference-runtime.md`), `random_forest` -
the best performer within that exportable set, and in this run also the
best on every held-out test metric among all six candidates - was selected
and deployed. Per-model confusion matrices and (for tree/coefficient-based
models) feature-importance plots are in `experiments/reports/`.

## Where to look for more

- Exact numbers: `experiments/model_comparison/model_comparison.csv`,
  `experiments/dataset_analysis/dataset_summary.json`,
  `experiments/dataset_analysis/correlation_matrix.csv`.
- Images: `experiments/dataset_analysis/*.png`,
  `experiments/reports/*.png`.
- Deployed-model final metrics: `ml/models/model_metadata.json`,
  `experiments/reports/final_metrics_random_forest.json`.
- Narrative methodology and leakage-avoidance discussion:
  `docs/machine-learning/methodology.md`.
- The real bug found and fixed in the evaluation code:
  `docs/machine-learning/pitfalls-and-lessons.md`.
