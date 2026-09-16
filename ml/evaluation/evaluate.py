"""Evaluation helpers shared by ml/training/train.py.

All functions here operate on already-fitted models and held-out data;
none of them fit anything, to keep the training script the single place
where fitting happens (data-leakage avoidance).
"""
from __future__ import annotations

import json
import os
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import seaborn as sns
from sklearn.metrics import (
    ConfusionMatrixDisplay,
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.preprocessing import label_binarize

from ml.preprocessing.preprocessing import CLASS_LABELS


def compute_metrics(
    y_true, y_pred, y_proba: np.ndarray | None, proba_classes_order: list[str] | None = None
) -> dict[str, Any]:
    """`proba_classes_order` MUST be the column order of `y_proba` (i.e.
    `model.classes_`), which scikit-learn sorts alphabetically and which is
    generally NOT the same order as CLASS_LABELS. Passing the wrong order
    silently misaligns label_binarize's columns against y_proba's columns
    and produces a meaningless ROC-AUC score without raising an error -
    this parameter exists specifically to prevent that bug."""
    metrics: dict[str, Any] = {
        "accuracy": accuracy_score(y_true, y_pred),
        "precision_macro": precision_score(y_true, y_pred, average="macro", zero_division=0),
        "recall_macro": recall_score(y_true, y_pred, average="macro", zero_division=0),
        "f1_macro": f1_score(y_true, y_pred, average="macro", zero_division=0),
        "f1_weighted": f1_score(y_true, y_pred, average="weighted", zero_division=0),
        "classification_report": classification_report(
            y_true, y_pred, labels=CLASS_LABELS, output_dict=True, zero_division=0
        ),
    }

    if y_proba is not None:
        if proba_classes_order is None:
            raise ValueError("proba_classes_order is required when y_proba is provided")
        try:
            y_true_bin = label_binarize(y_true, classes=proba_classes_order)
            metrics["roc_auc_ovr_macro"] = roc_auc_score(
                y_true_bin, y_proba, average="macro", multi_class="ovr"
            )
        except ValueError:
            metrics["roc_auc_ovr_macro"] = None
    else:
        metrics["roc_auc_ovr_macro"] = None

    return metrics


def save_confusion_matrix(y_true, y_pred, model_name: str, out_dir: str) -> str:
    os.makedirs(out_dir, exist_ok=True)
    cm = confusion_matrix(y_true, y_pred, labels=CLASS_LABELS)
    fig, ax = plt.subplots(figsize=(5.5, 4.5))
    disp = ConfusionMatrixDisplay(confusion_matrix=cm, display_labels=CLASS_LABELS)
    disp.plot(ax=ax, cmap="Blues", colorbar=False)
    ax.set_title(f"Confusion Matrix - {model_name}")
    plt.tight_layout()
    out_path = os.path.join(out_dir, f"confusion_matrix_{model_name}.png")
    fig.savefig(out_path, dpi=140)
    plt.close(fig)
    return out_path


def save_feature_importance(model, feature_names: list[str], model_name: str, out_dir: str) -> str | None:
    importances = None
    if hasattr(model, "feature_importances_"):
        importances = model.feature_importances_
    elif hasattr(model, "coef_"):
        importances = np.mean(np.abs(model.coef_), axis=0)

    if importances is None:
        return None

    os.makedirs(out_dir, exist_ok=True)
    fig, ax = plt.subplots(figsize=(5, 3.5))
    sns.barplot(x=list(importances), y=feature_names, ax=ax, orient="h")
    ax.set_title(f"Feature Importance - {model_name}")
    ax.set_xlabel("Importance")
    plt.tight_layout()
    out_path = os.path.join(out_dir, f"feature_importance_{model_name}.png")
    fig.savefig(out_path, dpi=140)
    plt.close(fig)
    return out_path


def write_json(data: Any, path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2, default=float)
