# Pitfalls and Lessons Learned

An honest engineering-lessons record from this project's real development
history. This is not a hypothetical example - it happened, was caught, and
was fixed, in `ml/evaluation/evaluate.py`.

## The ROC-AUC column-order bug

### What happened

An earlier version of `compute_metrics()` in `ml/evaluation/evaluate.py`
computed multiclass ROC-AUC like this (conceptually):

```python
y_true_bin = label_binarize(y_true, classes=CLASS_LABELS)  # ["Safe","Moderate","Unsafe","Critical"]
roc_auc_score(y_true_bin, y_proba, average="macro", multi_class="ovr")
```

`y_proba` comes from `pipeline.predict_proba(X_test)`, whose **columns are
always ordered alphabetically by class name** by scikit-learn convention
(`model.classes_`) - for these four labels, that order is `["Critical",
"Moderate", "Safe", "Unsafe"]`, not the `CLASS_LABELS` declaration order
`["Safe", "Moderate", "Unsafe", "Critical"]` used for `label_binarize`.

The two arrays passed into `roc_auc_score` therefore had **mismatched
column orders**: column 0 of `y_true_bin` meant "is this row actually
Safe?" while column 0 of `y_proba` meant "predicted probability of
Critical." Every column was comparing the wrong pair of things.

### Why it was silent

`roc_auc_score` does not validate that the two inputs' columns refer to
the same classes in the same order - it just computes AUC per column
positionally and averages. A shape mismatch would raise; a **column-order**
mismatch does not. The function ran to completion and returned a number
that looked like a valid metric.

### How it was caught

The resulting ROC-AUC values were roughly **0.43-0.49** - at or below
random-chance level (0.5) for a well-separated multiclass problem. This
didn't raise an exception, but it was caught by a manual sanity check: a
model simultaneously reporting **93% accuracy** and **~0.45 ROC-AUC** is
internally inconsistent - a classifier that confidently and correctly
separates classes 93% of the time cannot simultaneously have
near-chance-level ranking ability. That contradiction was the signal that
something in the ROC-AUC computation itself was broken, not the model.

### The fix

`compute_metrics()` now takes a required `proba_classes_order` parameter -
the actual column order of `y_proba`, obtained directly from
`model.classes_` at the call site in `ml/training/train.py`:

```python
proba_classes_order = list(pipeline.named_steps["model"].classes_) if y_proba is not None else None
test_metrics = compute_metrics(y_test, y_pred, y_proba, proba_classes_order)
```

and inside `compute_metrics`, `label_binarize` is called with that exact
order, not `CLASS_LABELS`:

```python
y_true_bin = label_binarize(y_true, classes=proba_classes_order)
```

If `y_proba` is provided without `proba_classes_order`, the function now
**raises `ValueError`** instead of silently defaulting to a possibly-wrong
order - turning this specific class of bug from "silently wrong number"
into "loud failure at the call site," which is the more valuable fix: it
prevents the same mistake from being reintroduced elsewhere without
noticing, not just fixing this one call site.

### Why this is worth documenting

Multiclass ROC-AUC in scikit-learn requires the caller to align
`label_binarize`'s `classes=` argument with the probability matrix's own
column order, and those two orders are easy to assume are the same
(`CLASS_LABELS` declaration order) when they are not (scikit-learn's
alphabetical `classes_` order) unless a model's own `.classes_` is
consulted explicitly. This is a realistic, easy-to-reintroduce class of
bug in any multiclass-probability evaluation code, not specific to this
project's model - which is exactly why it's recorded here rather than just
silently fixed and forgotten.

## Status

Fixed in the current `ml/evaluation/evaluate.py` /
`ml/training/train.py`. The final reported `roc_auc_ovr_macro = 0.9925`
for the deployed `random_forest` model
(`ml/models/model_metadata.json`) reflects the corrected computation.
