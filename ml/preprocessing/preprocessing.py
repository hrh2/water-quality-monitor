"""Preprocessing pipeline shared by training and inference.

Feature names here (ph, turbidity_ntu, tds_ppm) must match
docs/architecture/data-contract.md exactly.

Fitting rule (avoids data leakage, see docs/machine-learning/methodology.md
"Avoiding data leakage"): this module only ever DEFINES the transformer.
It is fit exclusively on the training split inside ml/training/train.py, and
the fitted object is reused (never refit) for validation, test, and
production inference.
"""
from __future__ import annotations

from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

FEATURE_COLUMNS = ["ph", "turbidity_ntu", "tds_ppm"]
TARGET_COLUMN = "water_quality_category"
CLASS_LABELS = ["Safe", "Moderate", "Unsafe", "Critical"]


def build_preprocessor() -> ColumnTransformer:
    """Median-impute missing `ph` (the only feature with real-world missing
    values, from Modbus read failures) then standard-scale all three
    features. Returns an UNFITTED transformer."""
    numeric_pipeline = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
        ]
    )
    return ColumnTransformer(
        transformers=[("numeric", numeric_pipeline, FEATURE_COLUMNS)],
        remainder="drop",
    )
