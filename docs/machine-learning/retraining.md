# Retraining

Exact commands to retrain the model and register the result, run from the
repository root.

## 1. (Optional) regenerate the dataset

Only needed if you want a fresh synthetic dataset (different seed/size);
otherwise the existing `data/generated/water_quality_dataset.csv` is
reused by `ml/training/train.py`.

```
ml/.venv/bin/python -m ml.data_generation.generate_dataset --n-samples 6000 --seed 42
```

Writes `data/generated/water_quality_dataset.csv` and prints the class
distribution and missing-`ph` count.

## 2. Train and select a model

```
ml/.venv/bin/python -m ml.training.train
```

What this does (see `docs/machine-learning/methodology.md` for the full
narrative):

- loads and cleans the dataset, writes EDA artifacts to
  `experiments/dataset_analysis/`,
- splits train/test (80/20, stratified, seed 42),
- trains and cross-validates all six candidate models,
- writes `experiments/model_comparison/model_comparison.csv` and `.json`,
- selects the best CV performer restricted to the portable-exportable set
  (`logistic_regression`, `decision_tree`, `random_forest`),
- writes `experiments/reports/final_metrics_<model>.json`, a confusion
  matrix per model, and feature-importance plots where applicable,
- saves `ml/models/best_model_pipeline.joblib` (the fitted sklearn
  pipeline - kept for reproducibility/retraining, not used in production),
- saves `ml/models/model_metadata.json`.

## 3. Export the portable model for production inference

```
ml/.venv/bin/python -m ml.inference.export_portable_model
```

Reads `ml/models/best_model_pipeline.joblib`, writes
`ml/models/portable_model.json` - the file `api/_lib/predict.js` actually
loads at request time. Raises a clear error instead of a silent bad export
if the selected model type isn't one of the three supported exportable
families (see `docs/architecture/adr-002-ml-inference-runtime.md`).

## 4. Register the new model version in the database

```
node scripts/seed_model_version.js
```

Reads `ml/models/model_metadata.json`, deactivates any currently-active
`model_versions` row, and inserts the new one as `is_active = true` - all
inside one transaction. Requires `DATABASE_URL` to be set.

## 5. What changes on disk / in the database

| Artifact | Changed by step |
|---|---|
| `data/generated/water_quality_dataset.csv` | 1 (optional) |
| `experiments/dataset_analysis/*` | 2 |
| `experiments/model_comparison/*` | 2 |
| `experiments/reports/*` | 2 |
| `ml/models/best_model_pipeline.joblib` | 2 |
| `ml/models/model_metadata.json` | 2 |
| `ml/models/portable_model.json` | 3 |
| `model_versions` table (Postgres) | 4 |

After step 4, the next accepted reading will be scored by the newly
exported model (`api/_lib/predict.js` reads `portable_model.json` fresh per
cold start, caching it in module memory - see the `cachedModel` variable),
and new `predictions` rows will reference the new `model_version_id`.

## 6. Verifying parity after a model-family change

If retraining ever changes which model family is deployed (e.g. from
`random_forest` to `logistic_regression`), re-run the manual JS/Python
parity check described in
`docs/experiments/reports/js-python-parity.md` and update that document -
it explicitly states its prior result should not be assumed to still hold
across a model-family change.
