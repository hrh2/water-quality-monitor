# ADR-002: ML Inference Runtime on Vercel

## Status
Accepted.

## Context

The project trains its classifier in Python (`ml/training/train.py`, using
pandas/scikit-learn - see `docs/machine-learning/`), which is the right tool
for a real train/evaluate/compare pipeline. The production backend, however,
is deployed as Vercel Node.js Serverless Functions (`api/*.js`), matching
the project's existing stack (`api/ws.js` already used Node + `ws`/`express`
before this project began).

Running the trained model in production has three realistic options:

1. **Bundle a Python runtime into the Vercel deployment** (e.g. a separate
   Python Serverless Function calling scikit-learn). Vercel does support
   Python functions, but this means maintaining two runtimes, two
   dependency trees, and cross-language request plumbing for what is, on
   this 3-feature dataset, a very small model.
2. **Run inference via a native/binary Node ML library** (e.g. an ONNX
   runtime binding). This reintroduces native binary dependencies into a
   serverless function bundle, which has historically been a source of
   Vercel deployment friction (platform-specific binaries, cold start
   size), for a benefit (broad model-format support) this project doesn't
   need.
3. **Export the trained model's parameters to a small, dependency-free JSON
   file and evaluate it with plain JavaScript.**

## Decision

Option 3. `ml/inference/export_portable_model.py` serializes the winning
scikit-learn pipeline (preprocessor + model) into `ml/models/portable_model.json`,
and `api/_lib/predict.js` is a small, dependency-free evaluator for it. No
native dependency, no second runtime, no extra cold-start weight beyond a
plain JSON file the function already needs to read.

This works cleanly for three model families, each with a straightforward
JSON representation and a short, auditable JS evaluation function:

| Model family | Portable representation | JS evaluation |
|---|---|---|
| `RandomForestClassifier` | list of trees, each as flat node arrays (`feature`, `threshold`, `left`, `right`, leaf `proba`) | traverse each tree, average leaf probabilities |
| `DecisionTreeClassifier` | same, single tree | traverse once |
| `LogisticRegression` | `coef_`, `intercept_` | dot product + softmax/sigmoid |

`GradientBoostingClassifier`, `KNeighborsClassifier`, and `SVC(kernel="rbf")`
are **intentionally excluded** from the exportable set, even though
`ml/training/train.py` still trains, cross-validates, and reports all six
in the model comparison table (`experiments/model_comparison/`) for
academic completeness:

- **GradientBoostingClassifier** would require exporting per-class staged
  regression trees plus the learning-rate/log-odds accumulation logic -
  more moving parts to keep correct in a hand-written JS evaluator than the
  marginal accuracy gain (in this project's runs, within ~0.01 CV
  f1_macro of Random Forest) justifies.
- **KNeighborsClassifier** would require shipping the entire training set
  to the inference layer, which defeats the point of a small portable
  artifact.
- **SVC(kernel="rbf")** would require shipping all support vectors and
  implementing the RBF kernel computation - viable, but not done here
  since it never outperformed the exportable set in testing.

`ml/training/train.py` reflects this constraint explicitly: model
*selection for deployment* is restricted to the exportable set
(`PORTABLE_MODEL_NAMES`), while the *comparison table* still reports every
candidate. If a future dataset/feature change makes an excluded family the
clearly best performer, the documented fallback is to revisit this ADR and
either (a) implement its export format, or (b) split prediction out to a
separate Python inference service that the Vercel app calls over HTTP,
keeping this same JSON contract (`docs/architecture/data-contract.md`) at
the boundary.

## Consequences

- Production inference has zero additional runtime dependencies and a
  single ~450 KB JSON artifact (`ml/models/portable_model.json`) checked
  into the repo alongside the trained `.joblib` pipeline (kept for
  reproducibility/retraining, not used in production).
- `ml/training/train.py`'s Random Forest hyperparameters
  (`n_estimators=60, max_depth=6`) were deliberately kept modest rather
  than default-heavy, trading a small amount of headroom accuracy for a
  meaningfully smaller portable export - a conscious, documented tradeoff.
- Retraining requires re-running both `ml/training/train.py` and
  `ml/inference/export_portable_model.py`, then
  `scripts/seed_model_version.js` to register the new version in the
  database (see `docs/machine-learning/retraining.md`).
- Parity between the Python model and its JS re-implementation was
  manually verified against several sample inputs (identical class
  probabilities to 4 decimal places) and is additionally covered by
  `tests/backend/predict.test.js`, which exercises the actual exported
  JSON against the live evaluator.
