# Model Comparison

Transcribed from `experiments/model_comparison/model_comparison.csv`
(identical data also in `model_comparison.json`), produced by
`ml/training/train.py` against the 6000-row generated dataset. Sorted by
`cv_f1_macro_mean` descending, matching the file's own sort order.

| model | cv_accuracy_mean | cv_accuracy_std | cv_f1_macro_mean | cv_f1_macro_std | test_accuracy | test_precision_macro | test_recall_macro | test_f1_macro | test_roc_auc_ovr_macro |
|---|---|---|---|---|---|---|---|---|---|
| gradient_boosting | 0.9283 | 0.0050 | 0.9102 | 0.0062 | 0.9225 | 0.9050 | 0.9093 | 0.9068 | 0.9927 |
| random_forest | 0.9281 | 0.0051 | 0.9101 | 0.0051 | **0.9300** | **0.9139** | **0.9182** | **0.9156** | 0.9925 |
| decision_tree | 0.9200 | 0.0087 | 0.8987 | 0.0094 | 0.9167 | 0.8967 | 0.9029 | 0.8995 | 0.9649 |
| knn | 0.9171 | 0.0052 | 0.8938 | 0.0088 | 0.9158 | 0.8966 | 0.9096 | 0.9023 | 0.9882 |
| svm_rbf | 0.9117 | 0.0057 | 0.8896 | 0.0066 | 0.9250 | 0.9114 | 0.9206 | 0.9143 | 0.9899 |
| logistic_regression | 0.9000 | 0.0081 | 0.8731 | 0.0109 | 0.9142 | 0.8950 | 0.8941 | 0.8939 | 0.9859 |

(Bolded row = the model actually selected for production deployment.)

## Why each family was included

From `ml/training/train.py`'s own comments on `MODEL_FACTORIES`:

- **Logistic Regression**: simple linear baseline, cheap, interpretable.
- **Decision Tree**: interpretable non-linear baseline, exportable to JSON.
- **Random Forest**: usually strong on small tabular datasets, exportable.
- **Gradient Boosting**: often best-in-class on tabular data, exportable
  *in principle* but not implemented in the export tool (see below).
- **KNN**: distance-based baseline, sensitive to feature scaling (a useful
  check that the preprocessing pipeline actually matters).
- **SVM (RBF)**: margin-based baseline for non-linear decision boundaries.

## Final decision

`gradient_boosting` scored marginally higher on CV `f1_macro` (0.9102 vs
0.9101 for `random_forest` - a ~0.0001 difference, well within the
`cv_f1_macro_std` of both), but is **excluded from the deployable set**
(`PORTABLE_MODEL_NAMES = {logistic_regression, decision_tree,
random_forest}` in `train.py`) because
`ml/inference/export_portable_model.py` has no implementation for
exporting a `GradientBoostingClassifier` to the portable JSON format the
Node.js inference API (`api/_lib/predict.js`) evaluates. The full reasoning
for why gradient boosting, KNN, and RBF-SVM are excluded from the portable
set is in `docs/architecture/adr-002-ml-inference-runtime.md` - not
repeated here.

**`random_forest` was selected and deployed** - it is the best CV
`f1_macro` performer *within* the exportable set, and in this run also has
the best held-out test metrics of all six candidates
(`test_accuracy = 0.93`, `test_f1_macro = 0.9156`). Final deployed-model
test metrics (from `ml/models/model_metadata.json`):

| Metric | Value |
|---|---|
| accuracy | 0.93 |
| precision_macro | 0.9139 |
| recall_macro | 0.9182 |
| f1_macro | 0.9156 |
| f1_weighted | 0.9306 |
| roc_auc_ovr_macro | 0.9925 |

Random Forest hyperparameters were deliberately kept modest
(`n_estimators=60, max_depth=6`) rather than default-heavy, trading a small
amount of headroom accuracy for a meaningfully smaller portable JSON
export - a conscious tradeoff documented in ADR-002.

## Supporting artifacts

Per-model confusion matrices:
`experiments/reports/confusion_matrix_{decision_tree,gradient_boosting,knn,logistic_regression,random_forest,svm_rbf}.png`.
Feature importance (tree/coefficient-based models only):
`experiments/reports/feature_importance_{random_forest,gradient_boosting}.png`.
Deployed-model final metrics JSON:
`experiments/reports/final_metrics_random_forest.json` (also
`final_metrics_gradient_boosting.json` exists from an earlier/comparison
run - the currently *deployed* metrics are the ones in
`ml/models/model_metadata.json`).
