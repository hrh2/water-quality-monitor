"""CLI for running the trained model directly (Python side), independent of
the Node.js portable export. Useful for manual verification that the JS
evaluator (api/_lib/predict.js) matches the original sklearn pipeline - see
docs/experiments/reports/js-python-parity.md for a recorded comparison.

Usage:
    ml/.venv/bin/python -m ml.inference.predict --ph 7.2 --turbidity-ntu 2.1 --tds-ppm 210
    ml/.venv/bin/python -m ml.inference.predict --turbidity-ntu 90 --tds-ppm 3000   # ph omitted -> imputed
"""
from __future__ import annotations

import argparse
import json
import os

import joblib
import pandas as pd

MODEL_PATH = os.path.join(os.path.dirname(__file__), "..", "models", "best_model_pipeline.joblib")


def predict(ph: float | None, turbidity_ntu: float, tds_ppm: float) -> dict:
    pipeline = joblib.load(MODEL_PATH)
    df = pd.DataFrame([{"ph": ph, "turbidity_ntu": turbidity_ntu, "tds_ppm": tds_ppm}])
    proba = pipeline.predict_proba(df)[0]
    classes = pipeline.named_steps["model"].classes_
    probabilities = dict(zip(classes, (float(p) for p in proba)))
    best = max(probabilities, key=probabilities.get)
    return {
        "water_quality_category": best,
        "prediction_confidence": probabilities[best],
        "class_probabilities": probabilities,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ph", type=float, default=None)
    parser.add_argument("--turbidity-ntu", type=float, required=True)
    parser.add_argument("--tds-ppm", type=float, required=True)
    args = parser.parse_args()

    result = predict(args.ph, args.turbidity_ntu, args.tds_ppm)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
