# Diagram 05: ML Pipeline

Mirrors the real structure of `ml/training/train.py`, from raw synthetic
data generation through to the artifact consumed in production. Full
narrative in `docs/machine-learning/methodology.md`.

```mermaid
flowchart LR
    A[ml/data_generation/generate_dataset.py\n6000 rows, 4-class rule label] --> B[load_and_clean\ndrop dupes, drop out-of-range rows]
    B --> C[run_eda\ndataset_summary.json, correlation heatmap,\nclass distribution, feature distributions]
    C --> D[train_test_split\nstratified, test_size=0.2, seed=42]
    D --> E[build_preprocessor\nmedian-impute ph + StandardScaler\nFIT ON TRAIN ONLY]
    E --> F[Train 6 candidate models\nlogreg, decision_tree, random_forest,\ngradient_boosting, knn, svm_rbf]
    F --> G[StratifiedKFold CV, 5 folds\non TRAIN split only]
    G --> H[Fit each model once on full train split]
    H --> I[Score all 6 on the held-out test split\nexactly once, after CV selection]
    I --> J[experiments/model_comparison/\nmodel_comparison.csv + .json]
    G --> K{Best CV f1_macro\nwithin portable-exportable set?}
    K --> L[random_forest selected\nml/models/best_model_pipeline.joblib\nml/models/model_metadata.json]
    L --> M[export_portable_model.py\nml/models/portable_model.json]
    M --> N[api/_lib/predict.js\nJS evaluator, production inference]
    L --> O[scripts/seed_model_version.js\nmodel_versions table]
```

Key sequencing facts, all enforced in code (`ml/training/train.py`):

- The preprocessor (imputer + scaler) is fit **only** on the training
  split; it is reused, never refit, for CV folds, the test set, and
  production inference.
- Model selection uses cross-validation **on the training split only**;
  the test set is scored exactly once, after the winning model is already
  chosen, and never used to pick between candidates.
- Selection for **deployment** is restricted to
  `PORTABLE_MODEL_NAMES = {logistic_regression, decision_tree,
  random_forest}` - the families `ml/inference/export_portable_model.py`
  can serialize to JSON. `gradient_boosting` scored marginally higher in
  CV in this project's run but isn't exportable, so `random_forest` was
  deployed instead. See
  `docs/architecture/adr-002-ml-inference-runtime.md` and
  `docs/machine-learning/model-comparison.md`.
