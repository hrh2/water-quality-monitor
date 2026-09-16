# Chapter 1: Introduction

Access to safe water is monitored, in most real-world settings, by
infrequent manual sampling and laboratory analysis - a process that is
accurate but slow, and structurally unable to catch a sudden contamination
event between sampling visits. This project, the Smart Water Quality
Prediction and Contamination Detection System, explores a narrower but
concrete alternative: a low-cost ESP8266-based sensor node that measures
three physically real parameters - pH, turbidity, and total dissolved
solids (TDS) - continuously, streams them to a cloud backend in real time,
and uses a trained machine-learning classifier to categorize water quality
into one of four engineering severity bands, while separately flagging
statistically or physically anomalous readings as a potential
contamination risk.

The system as built is intentionally modest in scope. It measures exactly
three sensor parameters, no more (`docs/architecture/data-contract.md`);
its predictive label is derived from a documented engineering rule rather
than certified laboratory potability testing
(`docs/machine-learning/target-methodology.md`); and its ML inference,
rather than requiring a second Python runtime in production, is
re-implemented as a small, auditable JavaScript evaluator running inside
the same Vercel Node.js serverless stack as the rest of the backend
(`docs/architecture/adr-002-ml-inference-runtime.md`). Each of these
constraints is a deliberate, documented engineering decision, not an
oversight - and each is treated honestly in this documentation set rather
than glossed over.

This book-material chapter set exists to turn the project's working
implementation and its accompanying technical documentation
(`docs/architecture/`, `docs/backend/`, `docs/machine-learning/`, etc.)
into a connected narrative suitable for a thesis- or capstone-style
writeup. Each chapter here is a skeleton: a real introduction grounded in
what was actually built, plus an outline of what the fuller chapter will
eventually cover, with pointers to the detailed technical documents that
already exist.

## Outline

- Motivation: why continuous, low-cost water-quality monitoring is a
  useful complement to (not a replacement for) laboratory testing
- What this specific system does and does not measure or claim
  (see Chapter 2, `docs/limitations/ml-limitations.md`)
- Document roadmap: how this chapter set maps onto the technical docs in
  `docs/architecture/`, `docs/hardware/`, `docs/firmware/`,
  `docs/backend/`, `docs/database/`, `docs/machine-learning/`,
  `docs/deployment/`, `docs/testing/`, `docs/limitations/`
- Scope boundaries stated up front: no field deployment has occurred yet
  (see Chapter 17, `docs/limitations/future-work.md`)
