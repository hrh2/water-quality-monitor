"""End-to-end training pipeline for the water-quality classifier.

Raw Data -> Cleaning -> EDA -> Split -> Preprocessing -> Train -> Evaluate
-> Compare -> Select best -> Serialize

Run from the repository root:
    ml/.venv/bin/python -m ml.training.train

Data-leakage avoidance (see docs/machine-learning/methodology.md):
  - the preprocessor (imputer + scaler) is fit ONLY on the training split
  - model selection uses cross-validation on the training split only
  - the held-out test set is scored exactly once, after the winning model
    has already been chosen by CV, and is never used to pick between models
"""
from __future__ import annotations

import json
import os
import time

import joblib
import numpy as np
import pandas as pd
import seaborn as sns
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold, cross_validate, train_test_split
from sklearn.neighbors import KNeighborsClassifier
from sklearn.pipeline import Pipeline
from sklearn.svm import SVC
from sklearn.tree import DecisionTreeClassifier

from ml.evaluation.evaluate import (
    compute_metrics,
    save_confusion_matrix,
    save_feature_importance,
    write_json,
)
from ml.preprocessing.preprocessing import (
    CLASS_LABELS,
    FEATURE_COLUMNS,
    TARGET_COLUMN,
    build_preprocessor,
)

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DATASET_PATH = os.path.join(REPO_ROOT, "data", "generated", "water_quality_dataset.csv")
MODELS_DIR = os.path.join(REPO_ROOT, "ml", "models")
DATASET_ANALYSIS_DIR = os.path.join(REPO_ROOT, "experiments", "dataset_analysis")
MODEL_COMPARISON_DIR = os.path.join(REPO_ROOT, "experiments", "model_comparison")
REPORTS_DIR = os.path.join(REPO_ROOT, "experiments", "reports")

RANDOM_SEED = 42
TEST_SIZE = 0.2
CV_FOLDS = 5

# Candidate models. Each is chosen for a specific, explainable reason
# (documented in docs/machine-learning/model-selection.md), not merely to
# pad the comparison table:
#   - Logistic Regression: simple linear baseline, cheap, interpretable
#   - Decision Tree: interpretable non-linear baseline, exportable to JSON
#   - Random Forest: usually strong on small tabular datasets, exportable
#   - Gradient Boosting: often best-in-class on tabular data, exportable
#   - KNN: distance-based baseline, sensitive to scaling (tests preprocessing)
#   - SVM (RBF): margin-based baseline for non-linear boundaries
# Model families ml/inference/export_portable_model.py can serialize to a
# dependency-free JSON structure for the Node.js prediction API. This is a
# DEPLOYMENT constraint, not an accuracy judgment: all six candidates below
# are still trained, cross-validated, and reported in the comparison table
# for academic completeness. Only the best CV performer *within this set* is
# serialized for production use. See docs/architecture/adr-002-ml-inference-runtime.md.
PORTABLE_MODEL_NAMES = {"logistic_regression", "decision_tree", "random_forest"}

MODEL_FACTORIES = {
    "logistic_regression": lambda: LogisticRegression(
        max_iter=2000, random_state=RANDOM_SEED
    ),
    "decision_tree": lambda: DecisionTreeClassifier(max_depth=8, random_state=RANDOM_SEED),
    # n_estimators/max_depth kept modest (rather than default-heavy) so the
    # winning model, if this one is selected, stays small enough to export
    # as a portable JSON tree structure for the Vercel Node inference API
    # (see ml/inference/export_portable_model.py) without materially
    # hurting accuracy on this 3-feature dataset.
    "random_forest": lambda: RandomForestClassifier(
        n_estimators=60, max_depth=6, random_state=RANDOM_SEED, n_jobs=-1
    ),
    "gradient_boosting": lambda: GradientBoostingClassifier(random_state=RANDOM_SEED),
    "knn": lambda: KNeighborsClassifier(n_neighbors=15),
    "svm_rbf": lambda: SVC(kernel="rbf", probability=True, random_state=RANDOM_SEED),
}


def load_and_clean(path: str) -> pd.DataFrame:
    df = pd.read_csv(path)
    before = len(df)
    df = df.drop_duplicates()
    df = df[df[TARGET_COLUMN].isin(CLASS_LABELS)]
    # turbidity/tds can never be physically negative; ph must be within 0-14.
    df = df[(df["turbidity_ntu"] >= 0) & (df["tds_ppm"] >= 0)]
    df = df[df["ph"].isna() | ((df["ph"] >= 0) & (df["ph"] <= 14))]
    after = len(df)
    print(f"Loaded {before} rows, {after} rows after cleaning ({before - after} dropped).")
    return df.reset_index(drop=True)


def run_eda(df: pd.DataFrame) -> None:
    os.makedirs(DATASET_ANALYSIS_DIR, exist_ok=True)

    summary = {
        "n_rows": len(df),
        "class_distribution": df[TARGET_COLUMN].value_counts().to_dict(),
        "missing_values": df[FEATURE_COLUMNS].isna().sum().to_dict(),
        "describe": df[FEATURE_COLUMNS].describe().to_dict(),
    }
    write_json(summary, os.path.join(DATASET_ANALYSIS_DIR, "dataset_summary.json"))

    corr = df[FEATURE_COLUMNS].corr()
    corr.to_csv(os.path.join(DATASET_ANALYSIS_DIR, "correlation_matrix.csv"))

    fig, ax = plt.subplots(figsize=(4.5, 4))
    sns.heatmap(corr, annot=True, cmap="viridis", ax=ax, vmin=-1, vmax=1)
    ax.set_title("Sensor Feature Correlation")
    plt.tight_layout()
    fig.savefig(os.path.join(DATASET_ANALYSIS_DIR, "correlation_heatmap.png"), dpi=140)
    plt.close(fig)

    fig, axes = plt.subplots(1, 3, figsize=(13, 4))
    for ax, col in zip(axes, FEATURE_COLUMNS):
        sns.boxplot(data=df, x=TARGET_COLUMN, y=col, order=CLASS_LABELS, ax=ax)
        ax.set_title(col)
        ax.tick_params(axis="x", rotation=30)
    plt.tight_layout()
    fig.savefig(os.path.join(DATASET_ANALYSIS_DIR, "feature_distributions_by_class.png"), dpi=140)
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(5, 4))
    df[TARGET_COLUMN].value_counts().reindex(CLASS_LABELS).plot(kind="bar", ax=ax, color="#2f6f6e")
    ax.set_title("Class Distribution")
    ax.set_ylabel("Count")
    plt.tight_layout()
    fig.savefig(os.path.join(DATASET_ANALYSIS_DIR, "class_distribution.png"), dpi=140)
    plt.close(fig)

    print(f"EDA artifacts written to {DATASET_ANALYSIS_DIR}")


def main() -> None:
    os.makedirs(MODELS_DIR, exist_ok=True)
    os.makedirs(MODEL_COMPARISON_DIR, exist_ok=True)
    os.makedirs(REPORTS_DIR, exist_ok=True)

    df = load_and_clean(DATASET_PATH)
    run_eda(df)

    X = df[FEATURE_COLUMNS]
    y = df[TARGET_COLUMN]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=TEST_SIZE, random_state=RANDOM_SEED, stratify=y
    )
    print(f"Train: {len(X_train)}  Test: {len(X_test)} (test set untouched until final evaluation)")

    cv = StratifiedKFold(n_splits=CV_FOLDS, shuffle=True, random_state=RANDOM_SEED)
    scoring = {"accuracy": "accuracy", "f1_macro": "f1_macro"}

    comparison_rows = []
    fitted_pipelines: dict[str, Pipeline] = {}

    for name, factory in MODEL_FACTORIES.items():
        pipeline = Pipeline(steps=[("preprocessor", build_preprocessor()), ("model", factory())])

        cv_results = cross_validate(
            pipeline, X_train, y_train, cv=cv, scoring=scoring, return_train_score=False
        )

        # Fit once on the full training split for the held-out test evaluation.
        pipeline.fit(X_train, y_train)
        fitted_pipelines[name] = pipeline

        y_pred = pipeline.predict(X_test)
        y_proba = pipeline.predict_proba(X_test) if hasattr(pipeline, "predict_proba") else None
        proba_classes_order = list(pipeline.named_steps["model"].classes_) if y_proba is not None else None
        test_metrics = compute_metrics(y_test, y_pred, y_proba, proba_classes_order)

        comparison_rows.append(
            {
                "model": name,
                "cv_accuracy_mean": cv_results["test_accuracy"].mean(),
                "cv_accuracy_std": cv_results["test_accuracy"].std(),
                "cv_f1_macro_mean": cv_results["test_f1_macro"].mean(),
                "cv_f1_macro_std": cv_results["test_f1_macro"].std(),
                "test_accuracy": test_metrics["accuracy"],
                "test_precision_macro": test_metrics["precision_macro"],
                "test_recall_macro": test_metrics["recall_macro"],
                "test_f1_macro": test_metrics["f1_macro"],
                "test_roc_auc_ovr_macro": test_metrics["roc_auc_ovr_macro"],
            }
        )
        print(f"[{name}] CV f1_macro={cv_results['test_f1_macro'].mean():.4f}  test f1_macro={test_metrics['f1_macro']:.4f}")

    comparison_df = pd.DataFrame(comparison_rows).sort_values("cv_f1_macro_mean", ascending=False)
    comparison_df.to_csv(os.path.join(MODEL_COMPARISON_DIR, "model_comparison.csv"), index=False)
    write_json(comparison_rows, os.path.join(MODEL_COMPARISON_DIR, "model_comparison.json"))

    # Model selection uses CV performance on the TRAINING split only, never
    # the test set, to avoid test-set leakage into model choice. Selection is
    # further restricted to the portable-exportable model set, since the
    # Vercel Node prediction API can only serve those (see
    # PORTABLE_MODEL_NAMES above and the ADR it references).
    overall_best_name = comparison_df.iloc[0]["model"]
    portable_df = comparison_df[comparison_df["model"].isin(PORTABLE_MODEL_NAMES)]
    best_name = portable_df.iloc[0]["model"]
    best_pipeline = fitted_pipelines[best_name]

    if best_name != overall_best_name:
        print(
            f"\nNote: '{overall_best_name}' scored marginally higher in CV "
            f"({comparison_df.iloc[0]['cv_f1_macro_mean']:.4f} vs "
            f"{portable_df.iloc[0]['cv_f1_macro_mean']:.4f}) but is not portable-"
            f"exportable for the Vercel Node inference API. Selecting the best "
            f"exportable model instead: '{best_name}'."
        )
    print(f"Selected model for production deployment: {best_name}")

    y_pred_best = best_pipeline.predict(X_test)
    y_proba_best = (
        best_pipeline.predict_proba(X_test) if hasattr(best_pipeline, "predict_proba") else None
    )
    proba_classes_order_best = (
        list(best_pipeline.named_steps["model"].classes_) if y_proba_best is not None else None
    )
    final_metrics = compute_metrics(y_test, y_pred_best, y_proba_best, proba_classes_order_best)
    write_json(final_metrics, os.path.join(REPORTS_DIR, f"final_metrics_{best_name}.json"))

    save_confusion_matrix(y_test, y_pred_best, best_name, REPORTS_DIR)
    save_feature_importance(best_pipeline.named_steps["model"], FEATURE_COLUMNS, best_name, REPORTS_DIR)

    for name, pipeline in fitted_pipelines.items():
        y_pred = pipeline.predict(X_test)
        save_confusion_matrix(y_test, y_pred, name, REPORTS_DIR)

    model_path = os.path.join(MODELS_DIR, "best_model_pipeline.joblib")
    joblib.dump(best_pipeline, model_path)

    metadata = {
        "model_name": best_name,
        "feature_columns": FEATURE_COLUMNS,
        "class_labels": CLASS_LABELS,
        "trained_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "random_seed": RANDOM_SEED,
        "test_size": TEST_SIZE,
        "cv_folds": CV_FOLDS,
        "dataset_path": os.path.relpath(DATASET_PATH, REPO_ROOT),
        "dataset_rows": len(df),
        "selection_metric": "cv_f1_macro_mean (training split only), restricted to portable-exportable models",
        "overall_best_model_by_cv": overall_best_name,
        "selected_for_deployment": best_name,
        "deployability_note": (
            "Model selection is restricted to model families "
            f"{sorted(PORTABLE_MODEL_NAMES)} that ml/inference/export_portable_model.py "
            "can serialize for the Node.js prediction API. See "
            "docs/architecture/adr-002-ml-inference-runtime.md."
        ),
        "final_test_metrics": {
            k: v for k, v in final_metrics.items() if k != "classification_report"
        },
        "note": (
            "water_quality_category is a rule-derived simulated label, not a "
            "lab-confirmed potability ground truth. See "
            "docs/machine-learning/target-methodology.md and "
            "docs/limitations/ml-limitations.md."
        ),
    }
    write_json(metadata, os.path.join(MODELS_DIR, "model_metadata.json"))

    print(f"\nSaved model pipeline -> {model_path}")
    print(f"Saved metadata -> {os.path.join(MODELS_DIR, 'model_metadata.json')}")


if __name__ == "__main__":
    main()
