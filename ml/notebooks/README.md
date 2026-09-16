# Notebooks

Reserved for exploratory analysis. Currently empty: all EDA in this project
is produced reproducibly by `ml/training/train.py` (see the
`experiments/dataset_analysis/` artifacts it writes) rather than in
ad-hoc notebooks, so every chart/statistic in the documentation traces back
to a script that can be re-run, instead of a notebook that can silently
drift from the code that generated it.

If exploratory notebooks are added later, keep the source of truth for any
number or chart referenced in `docs/` in a script under `ml/`, not only in
a notebook cell's output.
