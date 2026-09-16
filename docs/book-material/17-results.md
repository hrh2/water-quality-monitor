# Chapter 17: Results

The results this chapter can honestly report are **technical pipeline
results on a synthetic dataset**, not field-validated real-world
accuracy - no field deployment of this system against real water sources
has occurred as of this writing (see Chapter 19,
`docs/limitations/ml-limitations.md`). With that scope stated up front,
the real, measured results are these: six candidate model families were
trained and 5-fold cross-validated on a 6000-row generated dataset
(`experiments/model_comparison/model_comparison.csv`); the deployed model
(`random_forest`, selected because it was the best cross-validated
performer within the set of model families exportable to the production
JavaScript inference format) achieved `accuracy = 0.93`,
`f1_macro = 0.9156`, `f1_weighted = 0.9306`, and
`roc_auc_ovr_macro = 0.9925` on the held-out test split
(`ml/models/model_metadata.json`). The full comparison table and the
close-to-tied performance of `gradient_boosting` and `random_forest` in
cross-validation are discussed in `docs/machine-learning/model-comparison.md`.

Beyond the model metrics, the system-level result is an end-to-end working
pipeline: a real ESP8266 device publishing readings over WebSocket, a
serverless backend that persists, predicts, and alerts on them within the
same request, and a JS re-implementation of the trained model verified to
match the Python original to four decimal places on representative inputs
(`docs/experiments/reports/js-python-parity.md`). This chapter's fuller
version should present both kinds of result side by side, clearly labeled
by what they actually validate.

## Outline

- Model comparison results (`docs/machine-learning/model-comparison.md`,
  `experiments/model_comparison/model_comparison.csv`)
- Deployed model's final test metrics
  (`ml/models/model_metadata.json`)
- Dataset/EDA findings (`docs/experiments/summary.md`)
- System-level result: a working end-to-end pipeline, JS/Python parity
  verification (`docs/experiments/reports/js-python-parity.md`)
- What is explicitly NOT a result yet: field accuracy, real-world
  generalization, lab-validated agreement (see Chapter 19) - stated here
  as a boundary, not deferred silently
