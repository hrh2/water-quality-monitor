# ML Methodology

Full pipeline narrative for `ml/training/train.py`. For the label
derivation rule itself, see `docs/machine-learning/target-methodology.md`
(not duplicated here). For the inference-runtime split, see
`docs/architecture/adr-002-ml-inference-runtime.md`.

## 1. Pipeline stages, in order

1. **Raw data**: `ml/data_generation/generate_dataset.py` generates
   `data/generated/water_quality_dataset.csv` - 6000 rows (per
   `ml/models/model_metadata.json`'s `dataset_rows`), three sensor features
   (`ph`, `turbidity_ntu`, `tds_ppm`) plus the rule-derived
   `water_quality_category` label, with realistic per-class distributions
   and independent measurement noise added on top of the "true" generating
   values (see `docs/machine-learning/target-methodology.md` §4).
2. **Cleaning** (`load_and_clean` in `train.py`): drops exact duplicate
   rows, drops rows whose label isn't one of the four valid classes, drops
   physically impossible rows (`turbidity_ntu < 0`, `tds_ppm < 0`, `ph`
   outside `[0, 14]` when present). Row counts before/after are printed.
3. **EDA** (`run_eda`): writes `experiments/dataset_analysis/dataset_summary.json`
   (row count, class distribution, missing-value counts, per-feature
   `describe()`), `correlation_matrix.csv` + `correlation_heatmap.png`,
   `feature_distributions_by_class.png` (boxplots per class), and
   `class_distribution.png`. See `docs/experiments/summary.md` for what
   these actually show.
4. **Split**: `train_test_split(..., test_size=0.2, random_state=42,
   stratify=y)` - stratified so all four classes (including the rarest,
   `Critical`) are proportionally represented in both splits.
5. **Preprocessing** (`ml/preprocessing/preprocessing.py::build_preprocessor`):
   a `ColumnTransformer` wrapping a `Pipeline` of `SimpleImputer(strategy="median")`
   (only `ph` ever has missing values, from real Modbus read failures) then
   `StandardScaler` over all three features.
6. **Train 6 candidate models**, each in its own freshly-built
   `Pipeline(preprocessor, model)`: `logistic_regression`,
   `decision_tree`, `random_forest`, `gradient_boosting`, `knn`, `svm_rbf`.
   See `docs/machine-learning/model-comparison.md` for why each was
   included and the full numbers.
7. **CV-based comparison**: `StratifiedKFold(n_splits=5, shuffle=True,
   random_state=42)`, scoring `accuracy` and `f1_macro`, run on the
   **training split only** for every candidate.
8. **Deployability-constrained selection**: the best CV `f1_macro` overall
   is compared against the best CV `f1_macro` **restricted to
   `PORTABLE_MODEL_NAMES = {logistic_regression, decision_tree,
   random_forest}`** - the model families
   `ml/inference/export_portable_model.py` can serialize to JSON for the
   Node.js inference API. Only the best exportable model is selected for
   deployment; if a non-exportable model (e.g. `gradient_boosting`) wins
   CV overall, the script prints a note explaining the tradeoff and selects
   the best exportable one instead.
9. **Held-out test evaluation**: every fitted pipeline (all six) is scored
   once against the untouched test split; results go into
   `experiments/model_comparison/model_comparison.csv`/`.json`. The
   selected deployment model's test metrics additionally get their own
   `experiments/reports/final_metrics_<name>.json`, confusion matrix, and
   (where applicable) feature-importance plot.
10. **Export**: `ml/inference/export_portable_model.py` serializes the
    selected pipeline's fitted preprocessor + model into
    `ml/models/portable_model.json`.
11. **Serving**: `api/_lib/predict.js` loads that JSON and evaluates it in
    plain JavaScript at request time - no Python runtime in production.

## 2. Avoiding data leakage

Three specific rules are enforced in `ml/training/train.py`'s structure,
not just stated as intent:

- **The preprocessor is fit only on the training split.** `build_preprocessor()`
  returns an *unfitted* transformer every time it's called; each
  candidate model's own `Pipeline.fit(X_train, y_train)` is the only place
  fitting happens. Cross-validation folds, the test split, and production
  inference all reuse an already-fitted transformer - they never refit it
  on data that includes what they're being evaluated against.
  `tests/ml/test_preprocessing.py::test_preprocessor_imputes_median_from_fit_data_only`
  is a real, passing regression test for exactly this property: it fits on
  a training set, transforms an unrelated test row with a missing `ph`,
  and asserts the imputed value matches the *training* median, not
  anything derived from the test row.
- **The test set is touched exactly once.** `X_test`/`y_test` are held out
  from the very first `train_test_split` call and are not referenced again
  until each pipeline's single `.predict(X_test)`/`.predict_proba(X_test)`
  call inside the main comparison loop, used only to *report* metrics -
  never to pick a winner.
- **Model selection uses CV on the training split only.** The comparison
  table's `cv_accuracy_mean`/`cv_f1_macro_mean` columns (from
  `cross_validate(pipeline, X_train, y_train, cv=cv, ...)`) are what
  determines `overall_best_name` and `best_name` - the `test_*` columns in
  the same table are recorded for transparency but are explicitly not
  used for selection, exactly as the file's own module docstring states.

## 3. Reproducibility

`RANDOM_SEED = 42` is used consistently for the train/test split, the
`StratifiedKFold`, and every model constructor that accepts a
`random_state`. `ml/models/model_metadata.json` records `random_seed`,
`test_size`, `cv_folds`, `dataset_path`, and `dataset_rows` alongside the
final metrics, so a given trained artifact can be traced back to the
exact dataset and split configuration that produced it. See
`docs/machine-learning/retraining.md` for the exact commands to reproduce
this from scratch.
