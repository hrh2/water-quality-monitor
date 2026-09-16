# ML Limitations

Honest, specific limitations of the machine-learning component. See
`docs/machine-learning/target-methodology.md` for the label rule itself and
`docs/machine-learning/model-comparison.md` for the real numbers referenced
below.

## 1. The label is simulated, not lab-confirmed

`water_quality_category` in the training dataset
(`data/generated/water_quality_dataset.csv`) is computed by a documented
composite-threshold rule (`assign_category()` in
`ml/data_generation/generate_dataset.py`) applied to synthetically
generated parameter values, informed by commonly cited WHO/EPA reference
ranges. It is **not** a lab-confirmed potability result - there is no
microbiological testing, no certified water-quality lab dataset tied to
this sensor rig anywhere in this project. The model is therefore trained
to recover an engineering rule, not to predict a clinically or
regulatorily validated potability outcome.

## 2. Only three real sensor features exist

The firmware measures exactly `ph`, `turbidity_ntu`, `tds_ppm`
(`firmware/firmware.ino`). There is **no temperature sensor and no
dissolved-oxygen sensor installed**, despite the project abstract
mentioning such parameters aspirationally. `ASSUMED_WATER_TEMP_C` is a
hardcoded constant used only to compensate the TDS calibration curve
internally - it is never measured, never transmitted, and never used as a
model feature. See `docs/hardware/sensors-and-wiring.md` §4. Any future
claim that this system uses temperature or dissolved oxygen as a
predictive feature would be false as of this writing.

## 3. Synthetic dataset means real-world generalization is unvalidated

The entire training/test dataset is generated, not collected from a real
deployed sensor over time. While measurement noise is deliberately added
on top of "true" generating values so the classifier can't trivially
re-derive the deterministic labeling rule (see
`docs/machine-learning/target-methodology.md` §4), the noise model itself
(independent Gaussian noise with fixed standard deviations per feature) is
a simplification of whatever real sensor drift, calibration error, and
correlated noise this specific hardware would actually exhibit in the
field (`docs/hardware/sensors-and-wiring.md` §5 documents that the
turbidity/TDS calibration curves themselves are generic, uncalibrated-per-device
curves). **How well this model generalizes to real sensor data from this
specific rig has not yet been experimentally validated** - there is no
field dataset in this repository to test it against.

## 4. What the reported metrics do and do not mean

The deployed model's reported metrics
(`accuracy = 0.93`, `f1_macro = 0.9156`, `roc_auc_ovr_macro = 0.9925` -
`ml/models/model_metadata.json`) reflect how well a classifier can recover
a partially-noised **synthetic rule** on a held-out synthetic test split. They
are a legitimate measure of the ML pipeline's technical correctness
(preprocessing, training, evaluation methodology - see
`docs/machine-learning/methodology.md`), but they are **not** a validated
real-world clinical or regulatory outcome, and must not be presented as
one. "93% accuracy" here means "93% agreement with the synthetic labeling
rule on synthetic test data," not "93% agreement with certified lab
potability results."

## 5. Terminology discipline

Because of the above, the system's language is deliberately restrained
throughout (`docs/architecture/data-contract.md` §3): it predicts a
"water-quality category" and raises a "contamination risk" flag, and never
claims to "detect contamination," identify a specific pathogen/chemical,
or certify water as "safe to drink." This is enforced in the actual output
strings, not just in this document.
