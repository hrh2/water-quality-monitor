"""Reproducible dataset generator for the Smart Water Quality Prediction system.

Produces synthetic-but-principled samples of the three real sensor features
(ph, turbidity_ntu, tds_ppm) plus a rule-derived `water_quality_category`
label. The methodology is documented in
docs/machine-learning/target-methodology.md — this script is the single
implementation of that methodology and must stay in sync with that document.

Design goals (see docs/machine-learning/target-methodology.md):
  - realistic distributions per class, not uniform random noise
  - the label is computed from *true* underlying values; independent
    measurement noise is then added to produce the *observed* columns,
    so the dataset is not trivially/perfectly separable
  - reproducible via a fixed random seed
  - includes normal and abnormal (contamination-like) observations

Usage:
    python ml/data_generation/generate_dataset.py --n-samples 6000 --seed 42
"""
from __future__ import annotations

import argparse
import os

import numpy as np
import pandas as pd

RANDOM_SEED_DEFAULT = 42

CATEGORIES = ["Safe", "Moderate", "Unsafe", "Critical"]

# Class mixture weights: real deployments see mostly-safe water with
# progressively rarer degraded conditions.
CLASS_WEIGHTS = {"Safe": 0.45, "Moderate": 0.30, "Unsafe": 0.18, "Critical": 0.07}

# Per-class generating distributions for the *true* underlying parameter
# values (before measurement noise). Centers/spreads are chosen so that the
# resulting penalty-score rule (assign_category) recovers the intended class
# on average, while still producing overlap between adjacent classes.
PH_PARAMS = {
    "Safe": (7.3, 0.4),
    "Moderate": (6.6, 0.5),
    "Unsafe": (5.8, 0.8),
    "Critical": (4.6, 1.1),
}
TURBIDITY_PARAMS = {  # lognormal-ish via gamma, in NTU
    "Safe": (2.0, 1.0),
    "Moderate": (7.0, 2.5),
    "Unsafe": (25.0, 10.0),
    "Critical": (80.0, 35.0),
}
TDS_PARAMS = {  # ppm
    "Safe": (280.0, 90.0),
    "Moderate": (650.0, 150.0),
    "Unsafe": (1400.0, 350.0),
    "Critical": (2600.0, 700.0),
}

# Measurement noise applied on top of the "true" value to produce the
# observed sensor reading, modeling ADC/probe imprecision.
PH_SENSOR_NOISE_STD = 0.15
TURBIDITY_SENSOR_NOISE_STD = 1.2
TDS_SENSOR_NOISE_STD = 25.0

DEVICE_IDS = ["soil-water-monitor-1", "soil-water-monitor-2", "soil-water-monitor-3"]


def ph_penalty(ph: float) -> int:
    if 6.5 <= ph <= 8.5:
        return 0
    if (6.0 <= ph < 6.5) or (8.5 < ph <= 9.0):
        return 1
    if (5.5 <= ph < 6.0) or (9.0 < ph <= 9.5):
        return 2
    return 3


def turbidity_penalty(ntu: float) -> int:
    if ntu <= 5:
        return 0
    if ntu <= 10:
        return 1
    if ntu <= 50:
        return 2
    return 3


def tds_penalty(ppm: float) -> int:
    if ppm <= 500:
        return 0
    if ppm <= 1000:
        return 1
    if ppm <= 2000:
        return 2
    return 3


def assign_category(ph: float, turbidity_ntu: float, tds_ppm: float) -> str:
    """Implements the composite-threshold rule from
    docs/machine-learning/target-methodology.md section 3. Operates on the
    *true* underlying values, not the noisy observed sensor readings."""
    total = ph_penalty(ph) + turbidity_penalty(turbidity_ntu) + tds_penalty(tds_ppm)
    if total <= 1:
        return "Safe"
    if total <= 3:
        return "Moderate"
    if total <= 6:
        return "Unsafe"
    return "Critical"


def generate(n_samples: int, seed: int) -> pd.DataFrame:
    rng = np.random.default_rng(seed)

    intended_classes = rng.choice(
        CATEGORIES, size=n_samples, p=[CLASS_WEIGHTS[c] for c in CATEGORIES]
    )

    rows = []
    for intended in intended_classes:
        ph_mu, ph_sigma = PH_PARAMS[intended]
        true_ph = float(np.clip(rng.normal(ph_mu, ph_sigma), 0.0, 14.0))

        turb_mu, turb_sigma = TURBIDITY_PARAMS[intended]
        shape = (turb_mu / turb_sigma) ** 2
        scale = (turb_sigma ** 2) / turb_mu
        true_turbidity = float(max(0.0, rng.gamma(shape, scale)))

        tds_mu, tds_sigma = TDS_PARAMS[intended]
        shape_t = (tds_mu / tds_sigma) ** 2
        scale_t = (tds_sigma ** 2) / tds_mu
        true_tds = float(max(0.0, rng.gamma(shape_t, scale_t)))

        # Label is derived from TRUE values (methodology's ground truth).
        category = assign_category(true_ph, true_turbidity, true_tds)

        # Observed sensor readings = true value + independent sensor noise,
        # matching the firmware's actual measurement chain (RS485 probe /
        # ADS1115 ADC + calibration curve), each with its own imprecision.
        observed_ph = float(np.clip(rng.normal(true_ph, PH_SENSOR_NOISE_STD), 0.0, 14.0))
        observed_turbidity = float(max(0.0, rng.normal(true_turbidity, TURBIDITY_SENSOR_NOISE_STD)))
        observed_tds = float(max(0.0, rng.normal(true_tds, TDS_SENSOR_NOISE_STD)))

        rows.append(
            {
                "device_id": rng.choice(DEVICE_IDS),
                "ph": round(observed_ph, 2),
                "turbidity_ntu": round(observed_turbidity, 2),
                "tds_ppm": round(observed_tds, 1),
                "water_quality_category": category,
            }
        )

    df = pd.DataFrame(rows)

    # A small fraction of missing pH readings, mirroring real Modbus read
    # failures the firmware already handles (`phOk == false` -> null).
    missing_mask = rng.random(len(df)) < 0.02
    df.loc[missing_mask, "ph"] = np.nan

    # Shuffle row order so class blocks aren't contiguous.
    df = df.sample(frac=1.0, random_state=seed).reset_index(drop=True)
    return df


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--n-samples", type=int, default=6000)
    parser.add_argument("--seed", type=int, default=RANDOM_SEED_DEFAULT)
    parser.add_argument(
        "--out",
        type=str,
        default=os.path.join(
            os.path.dirname(__file__), "..", "..", "data", "generated", "water_quality_dataset.csv"
        ),
    )
    args = parser.parse_args()

    df = generate(args.n_samples, args.seed)
    out_path = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    df.to_csv(out_path, index=False)

    print(f"Generated {len(df)} rows -> {out_path}")
    print("\nClass distribution:")
    print(df["water_quality_category"].value_counts())
    print(f"\nMissing ph values: {df['ph'].isna().sum()} ({df['ph'].isna().mean():.1%})")


if __name__ == "__main__":
    main()
