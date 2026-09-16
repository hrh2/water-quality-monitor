"""Exports the trained sklearn pipeline to a portable JSON format that the
Node.js prediction API (api/_lib/predict.js) can evaluate without a Python
runtime.

Why this exists (see docs/architecture/adr-002-ml-inference-runtime.md):
Vercel Serverless Functions in this project run Node.js, matching the rest
of the stack (api/ws.js). Rather than bundling a Python runtime or a native
ML inference library into the API just to run one small model, the winning
model's parameters are exported to plain JSON and evaluated with a small,
dependency-free JS function. This works cleanly for the model families
below; if training ever selects a model outside that set, this script
raises a clear error rather than silently producing a wrong export.

Supported exportable model types:
  - RandomForestClassifier / DecisionTreeClassifier (tree threshold export)
  - LogisticRegression (linear weights + softmax)

Not supported (documented limitation, see ADR):
  - GradientBoostingClassifier, KNeighborsClassifier, SVC(kernel="rbf")
    would require either shipping the full training set (KNN/SVM) or a
    more involved staged-tree/log-odds export (GradientBoosting). If one
    of these is ever selected as best by ml/training/train.py, the project
    falls back to a separate Python inference service instead of Vercel
    Node functions for prediction, as documented in the ADR.
"""
from __future__ import annotations

import json
import os

import joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.tree import DecisionTreeClassifier

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
MODEL_PATH = os.path.join(REPO_ROOT, "ml", "models", "best_model_pipeline.joblib")
OUT_PATH = os.path.join(REPO_ROOT, "ml", "models", "portable_model.json")


def export_tree(tree, classes: list[str]) -> dict:
    t = tree.tree_
    nodes = []
    for i in range(t.node_count):
        if t.children_left[i] == -1:  # leaf
            counts = t.value[i][0]
            total = counts.sum()
            proba = (counts / total).tolist() if total > 0 else [1.0 / len(classes)] * len(classes)
            nodes.append({"leaf": True, "proba": proba})
        else:
            nodes.append(
                {
                    "leaf": False,
                    "feature": int(t.feature[i]),
                    "threshold": float(t.threshold[i]),
                    "left": int(t.children_left[i]),
                    "right": int(t.children_right[i]),
                }
            )
    return {"nodes": nodes}


def export_preprocessor(preprocessor) -> dict:
    numeric_pipeline = preprocessor.named_transformers_["numeric"]
    imputer = numeric_pipeline.named_steps["imputer"]
    scaler = numeric_pipeline.named_steps["scaler"]
    return {
        "impute_values": imputer.statistics_.tolist(),
        "scale_mean": scaler.mean_.tolist(),
        "scale_std": scaler.scale_.tolist(),
    }


def main() -> None:
    pipeline = joblib.load(MODEL_PATH)
    preprocessor = pipeline.named_steps["preprocessor"]
    model = pipeline.named_steps["model"]
    classes = list(model.classes_)

    export: dict = {
        "feature_order": ["ph", "turbidity_ntu", "tds_ppm"],
        "class_labels": classes,
        "preprocessor": export_preprocessor(preprocessor),
    }

    if isinstance(model, RandomForestClassifier):
        export["model_type"] = "random_forest"
        export["trees"] = [export_tree(est, classes) for est in model.estimators_]
    elif isinstance(model, DecisionTreeClassifier):
        export["model_type"] = "decision_tree"
        export["trees"] = [export_tree(model, classes)]
    elif isinstance(model, LogisticRegression):
        export["model_type"] = "logistic_regression"
        export["coef"] = model.coef_.tolist()
        export["intercept"] = model.intercept_.tolist()
    else:
        raise ValueError(
            f"Model type {type(model).__name__} is not portable-exportable. "
            "See the module docstring and docs/architecture/adr-002-ml-inference-runtime.md "
            "for the documented fallback (separate Python inference service)."
        )

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(export, f)

    print(f"Exported {export['model_type']} model -> {OUT_PATH}")


if __name__ == "__main__":
    main()
