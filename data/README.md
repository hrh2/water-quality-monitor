# Data Directory

| Directory | Contents |
|---|---|
| `raw/` | Reserved for any future raw external data (e.g. a real lab-confirmed water-quality dataset, if one is ever obtained). Currently empty - see "Dataset provenance" below. |
| `processed/` | Reserved for intermediate cleaned data if a future pipeline stage needs to persist it separately from `generated/`. Currently empty - `ml/training/train.py` currently cleans in-memory and writes analysis artifacts straight to `experiments/dataset_analysis/`, so no separate processed file exists yet. |
| `generated/` | `water_quality_dataset.csv` - the reproducible synthetic dataset produced by `ml/data_generation/generate_dataset.py`. This is a generated file (see `.gitignore`-adjacent note below); regenerate it any time with the command below. |

## Dataset provenance

**This project does not use a third-party or public dataset.** No such
claim is made anywhere in the codebase or documentation. The dataset in
`generated/water_quality_dataset.csv` is synthetic, produced entirely by
`ml/data_generation/generate_dataset.py` from documented per-class
distributions and a documented rule-based labeling function. Full
methodology, including why this approach was chosen and its limitations,
is in `docs/machine-learning/target-methodology.md` and
`docs/limitations/ml-limitations.md`.

## Regenerating the dataset

```bash
ml/.venv/bin/python ml/data_generation/generate_dataset.py --n-samples 6000 --seed 42
```

`--seed` controls reproducibility (same seed -> byte-identical output,
verified in `tests/ml/test_dataset_generation.py`). `--n-samples` controls
size. The three feature columns (`ph`, `turbidity_ntu`, `tds_ppm`) and the
target (`water_quality_category`) match
`docs/architecture/data-contract.md` exactly.
