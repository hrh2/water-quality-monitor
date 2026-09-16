# Chapter 8: Data Collection

Two distinct kinds of "data collection" exist in this project, and this
chapter's eventual full version needs to keep them clearly separated,
since conflating them is a common way this kind of project misrepresents
itself.

The first is **live sensor telemetry**: the firmware's real read/publish
loop, running every 3 seconds (`READ_INTERVAL_MS` in
`firmware/firmware.ino`), producing the exact wire message documented in
`docs/architecture/data-contract.md` §4, persisted into `sensor_readings`
(`db/migrations/0001_init.sql`). This is real, working data collection
from actual hardware, and is what `api/_lib/ingest.js` processes.

The second is the **synthetic training dataset**
(`data/generated/water_quality_dataset.csv`), produced entirely by
`ml/data_generation/generate_dataset.py` - 6000 rows of generated
(not collected) sensor-like values plus a rule-derived label, used only to
train the classifier (Chapter 9-11). No lab-confirmed or field-collected
labeled dataset backs the deployed model at this time. This chapter's
fuller version must state this distinction as clearly as the technical
docs already do (`docs/machine-learning/target-methodology.md` §1), since
it is the single most important scoping fact about this project's ML
component.

## Outline

- Live telemetry path: firmware read cadence, wire format, persistence
  (`docs/architecture/data-contract.md`, `docs/database/schema.md`)
- Synthetic dataset generation: why it exists, how it's generated, its
  documented limitations (Chapter 9,
  `docs/machine-learning/target-methodology.md`)
- Explicit statement: no lab-confirmed ground-truth dataset exists for
  this sensor rig as of this writing
- What real-world data collection (were it to happen) would need to look
  like (see Chapter 20, `docs/limitations/future-work.md`)
