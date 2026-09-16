# Chapter 12: Model Evaluation

Evaluation happens in two places: `ml/evaluation/evaluate.py` (metric
computation, confusion matrices, feature importance - all operating on
already-fitted models, fitting nothing itself) and `ml/training/train.py`
(which decides what to evaluate and when). The full, real comparison
table across all six candidate models -
`experiments/model_comparison/model_comparison.csv` - is transcribed and
discussed in `docs/machine-learning/model-comparison.md`; this chapter's
fuller version should walk through *how* those numbers were produced, not
just what they are.

This chapter should also carry, honestly and without embellishment, the
real evaluation bug found and fixed during this project's development: an
earlier version of the multiclass ROC-AUC computation mismatched the
column order between `label_binarize` and `predict_proba`'s output,
silently producing a near-chance ROC-AUC (~0.43-0.49) instead of raising
an error, for a model that was simultaneously reporting 93% accuracy. It
was caught by exactly that inconsistency, not by an automated check, and
fixed by requiring the caller to pass the model's actual `classes_`
order explicitly. The full account is in
`docs/machine-learning/pitfalls-and-lessons.md` and is a genuine example
of the class of bug worth teaching from, not a hypothetical one.

## Outline

- Metrics used and why: accuracy, macro precision/recall/f1 (chosen over
  plain accuracy given class imbalance), ROC-AUC (one-vs-rest, macro)
- Confusion matrices and feature importance plots, and where to find them
  (`experiments/reports/`)
- The deployed model's final held-out test metrics
  (`ml/models/model_metadata.json`)
- The ROC-AUC column-order bug: what happened, why it was silent, how it
  was caught, and the fix (`docs/machine-learning/pitfalls-and-lessons.md`)
- What these metrics do and do not validate (see Chapter 19,
  `docs/limitations/ml-limitations.md` §4)
