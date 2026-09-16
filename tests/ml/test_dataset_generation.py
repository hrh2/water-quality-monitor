"""Tests for ml/data_generation/generate_dataset.py.

Run with: ml/.venv/bin/pytest tests/ml -v  (from the repository root, with
ml on the Python path - see tests/README.md).
"""
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from ml.data_generation.generate_dataset import (
    assign_category,
    generate,
    ph_penalty,
    turbidity_penalty,
    tds_penalty,
)


def test_generation_is_reproducible_with_fixed_seed():
    df1 = generate(n_samples=200, seed=42)
    df2 = generate(n_samples=200, seed=42)
    assert df1.equals(df2)


def test_different_seeds_produce_different_data():
    df1 = generate(n_samples=200, seed=1)
    df2 = generate(n_samples=200, seed=2)
    assert not df1.equals(df2)


def test_all_four_categories_are_represented():
    df = generate(n_samples=3000, seed=42)
    assert set(df["water_quality_category"].unique()) == {"Safe", "Moderate", "Unsafe", "Critical"}


def test_dataset_has_missing_ph_values_but_no_missing_turbidity_or_tds():
    df = generate(n_samples=2000, seed=42)
    assert df["ph"].isna().sum() > 0
    assert df["turbidity_ntu"].isna().sum() == 0
    assert df["tds_ppm"].isna().sum() == 0


def test_penalty_boundaries():
    assert ph_penalty(7.0) == 0
    assert ph_penalty(6.2) == 1
    assert ph_penalty(5.7) == 2
    assert ph_penalty(4.0) == 3
    assert turbidity_penalty(3) == 0
    assert turbidity_penalty(60) == 3
    assert tds_penalty(400) == 0
    assert tds_penalty(2500) == 3


def test_assign_category_matches_documented_thresholds():
    # total_penalty 0 -> Safe
    assert assign_category(7.0, 2, 200) == "Safe"
    # total_penalty in [2,3] -> Moderate
    assert assign_category(6.3, 7, 200) == "Moderate"
    # total_penalty in [4,6] -> Unsafe
    assert assign_category(5.8, 20, 1200) == "Unsafe"
    # total_penalty in [7,9] -> Critical
    assert assign_category(4.5, 100, 3000) == "Critical"


def test_no_negative_sensor_values():
    df = generate(n_samples=2000, seed=7)
    assert (df["turbidity_ntu"] >= 0).all()
    assert (df["tds_ppm"] >= 0).all()
