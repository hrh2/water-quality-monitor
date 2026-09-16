# Chapter 21: Conclusion

This project set out to build a working, end-to-end low-cost water-quality
monitoring pipeline - from a physical ESP8266 sensor node through a
serverless backend to a trained ML classifier and dashboard - and, on the
evidence in this repository, it did: real firmware handling real sensor
hardware and real network failure modes (`firmware/firmware.ino`), a
backend with a single shared ingestion pipeline used identically by both
its real and manual entry points (`api/_lib/ingest.js`), a rigorously
evaluated (leakage-avoided, cross-validated) ML pipeline whose production
inference runs with zero native runtime dependencies
(`docs/architecture/adr-002-ml-inference-runtime.md`), and a database
layer portable across any standard Postgres provider
(`docs/architecture/adr-001-database-choice.md`).

What this project did not set out to prove, and does not claim to have
proven, is that its predictions are accurate against real-world,
lab-confirmed water quality - the training label is a documented
engineering simulation, not measured ground truth, and no field deployment
has occurred (Chapter 19). This is not a hedge added defensively at the
end; it is a scope boundary that was designed into the system's
terminology from the start (`docs/architecture/data-contract.md` §3),
and this documentation set has tried to hold that same line consistently
across every chapter and technical document, rather than letting a
polished pipeline narrative imply more than the evidence supports.

The value of the project, as actually delivered, is as a demonstration
that this class of system - continuous IoT sensing, real-time serverless
ingestion, rigorous (if synthetic-data-bounded) ML methodology, and
honest documentation of exactly where the evidence stops - can be built
coherently and end-to-end on a small, realistic budget. The path from here
to a system whose predictions can be trusted against real water sources is
the future-work chapter (Chapter 20), not a footnote.

## Outline

- Summary of what was actually built and verified (pipeline, ML
  methodology, deployment)
- Restatement of the core scope boundary: synthetic label, no field
  validation, three real sensors only
- The project's actual contribution: a coherent, honestly-documented
  end-to-end system, not a validated water-safety product
- Closing pointer to Chapter 20 as the real next step, not a formality
