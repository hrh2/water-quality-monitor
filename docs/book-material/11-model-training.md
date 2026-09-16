# Chapter 11: Model Training

Training is implemented end to end in `ml/training/train.py`, run as
`ml/.venv/bin/python -m ml.training.train` from the repository root. The
script's own structure states its methodology directly in its module
docstring: "Raw Data -> Cleaning -> EDA -> Split -> Preprocessing -> Train
-> Evaluate -> Compare -> Select best -> Serialize." The full narrative,
including the three specific data-leakage-avoidance rules enforced in
code (preprocessor fit only on train, test set touched exactly once,
model selection uses CV on train only), is in
`docs/machine-learning/methodology.md` and is the primary source this
chapter should expand from.

A detail worth foregrounding for a training-methodology chapter
specifically: the preprocessing pipeline
(`ml/preprocessing/preprocessing.py::build_preprocessor`) is a single
shared definition used identically by every one of the six candidate
models, by cross-validation, by the final test evaluation, and - via the
portable JSON export - by production inference. There is exactly one
implementation of "how a raw reading becomes a model input," not one per
consumer, which is what prevents training-serving skew.

## Outline

- Training script structure and CLI invocation
  (`ml/.venv/bin/python -m ml.training.train`)
- Preprocessing: median imputation (ph only) + standard scaling, fit once
  on train, reused everywhere else
- The six candidate models and their hyperparameters
  (`MODEL_FACTORIES` in `ml/training/train.py`)
- Cross-validation setup: `StratifiedKFold`, 5 folds, on the training
  split only
- Data-leakage-avoidance rules, stated explicitly (full detail:
  `docs/machine-learning/methodology.md` §2)
- Reproducibility: fixed random seed (42) used throughout
  (`docs/machine-learning/methodology.md` §3, `docs/machine-learning/retraining.md`)
