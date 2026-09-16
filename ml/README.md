# ML Pipeline

Trains and exports the water-quality classifier used by the production
prediction API (`api/_lib/predict.js`). Runs entirely offline/locally in
Python - it is not executed on Vercel; see
`docs/architecture/adr-002-ml-inference-runtime.md` for why.

## Setup

```bash
cd water-quality-monitor
python3 -m venv ml/.venv
ml/.venv/bin/pip install -r ml/requirements.txt
```

## Pipeline stages (run in order from the repository root)

```bash
# 1. Generate the reproducible synthetic dataset (data/generated/water_quality_dataset.csv)
ml/.venv/bin/python ml/data_generation/generate_dataset.py --n-samples 6000 --seed 42

# 2. Clean, run EDA, train all 6 candidate models, evaluate, select, serialize
ml/.venv/bin/python -m ml.training.train

# 3. Export the winning model to a portable JSON for the Node.js prediction API
ml/.venv/bin/python -m ml.inference.export_portable_model

# 4. Register the newly trained model version in the database
node scripts/seed_model_version.js   # requires DATABASE_URL
```

Step 2 writes:
- `experiments/dataset_analysis/` - class distribution, correlation matrix/heatmap, per-class feature distributions, summary JSON
- `experiments/model_comparison/` - CV + held-out test metrics for all 6 candidate models
- `experiments/reports/` - confusion matrices for every model, feature importance for the winner, final metrics JSON
- `ml/models/best_model_pipeline.joblib` - the full fitted sklearn pipeline (preprocessor + model), kept for reproducibility/retraining, not used in production
- `ml/models/model_metadata.json` - training run metadata (seed, dataset size, selected model, final metrics)

Step 3 writes `ml/models/portable_model.json`, the only ML artifact the
production API actually reads at request time.

## Directory layout

```
ml/
├── data_generation/generate_dataset.py   # synthetic dataset + label rule
├── preprocessing/preprocessing.py        # shared imputer+scaler definition (unfit)
├── training/train.py                     # full pipeline orchestrator
├── evaluation/evaluate.py                # metrics/plots used by train.py
├── inference/
│   ├── export_portable_model.py          # sklearn -> portable JSON
│   └── predict.py                        # Python-side CLI for manual verification
├── models/                                # trained artifacts (see above)
└── notebooks/                             # (reserved for exploratory analysis; empty)
```

## Retraining

See `docs/machine-learning/retraining.md` for the full explanation of what
changes on disk and downstream (portable model, database `model_versions`
row) when you retrain.

## Testing

```bash
ml/.venv/bin/pytest tests/ml -v
```

Covers dataset-generation determinism/label-rule correctness and
preprocessing data-leakage properties. See `docs/testing/testing.md`.
