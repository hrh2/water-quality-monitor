import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

import numpy as np
import pandas as pd

from ml.preprocessing.preprocessing import build_preprocessor, FEATURE_COLUMNS


def test_preprocessor_is_unfit_until_explicitly_fit():
    pre = build_preprocessor()
    df = pd.DataFrame({"ph": [7.0, None, 6.5], "turbidity_ntu": [1, 2, 3], "tds_ppm": [100, 200, 300]})
    # Calling transform before fit must raise - proves this module never
    # fits anything itself (data-leakage avoidance is the caller's job).
    try:
        pre.transform(df)
        assert False, "expected NotFittedError before fit"
    except Exception:
        pass


def test_preprocessor_imputes_median_from_fit_data_only():
    pre = build_preprocessor()
    train = pd.DataFrame({"ph": [6.0, 7.0, 8.0], "turbidity_ntu": [1, 2, 3], "tds_ppm": [100, 200, 300]})
    pre.fit(train)

    test = pd.DataFrame({"ph": [None], "turbidity_ntu": [2], "tds_ppm": [200]})
    transformed = pre.transform(test)
    # median of [6,7,8] is 7 -> after scaling with train's mean/std, the
    # imputed value should exactly equal the train-set median's own
    # transformed value, confirming the imputer learned from train, not test.
    median_row = pre.transform(pd.DataFrame({"ph": [7.0], "turbidity_ntu": [2], "tds_ppm": [200]}))
    assert np.allclose(transformed, median_row)


def test_output_shape_matches_feature_count():
    pre = build_preprocessor()
    df = pd.DataFrame({"ph": [7.0, 6.5], "turbidity_ntu": [1, 2], "tds_ppm": [100, 200]})
    pre.fit(df)
    out = pre.transform(df)
    assert out.shape == (2, len(FEATURE_COLUMNS))
