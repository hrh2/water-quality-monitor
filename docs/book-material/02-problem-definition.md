# Chapter 2: Problem Definition

The problem this project addresses is narrower than "detect water
contamination" in the general sense - it is, specifically: given
continuous readings of three measurable physical/chemical parameters (pH,
turbidity, TDS) from a single low-cost sensor node, produce (a) a
real-time predicted water-quality category, and (b) a separate,
independent flag for statistically or physically anomalous readings, both
delivered to a dashboard operator with low latency and without requiring
a human to manually sample and lab-test the water first.

This framing matters because it is easy to over-claim. The system does
**not** detect specific pathogens, does not perform microbiological
testing, and does not certify potability - it cannot, given the sensors
installed (`docs/hardware/sensors-and-wiring.md`,
`docs/architecture/data-contract.md` §3). The actual problem solved is an
engineering triage problem: surface a continuously-updated, four-tier
severity signal (`Safe`/`Moderate`/`Unsafe`/`Critical`) and a
contamination-risk flag, cheaply and in real time, to help decide when a
human-supervised lab test is warranted - not to replace one.

A second, equally real sub-problem this project had to solve is purely
data-related: no lab-confirmed, sensor-matched ground-truth dataset for
this specific sensor rig exists. The chosen solution - a documented,
rule-derived synthetic label
(`docs/machine-learning/target-methodology.md`) - is itself part of the
problem definition's honest scope: the project demonstrates that a
classifier can be trained, evaluated rigorously (without data leakage),
and deployed end-to-end on a resource-constrained real hardware/serverless
stack, using a label whose limitations are explicitly documented rather
than hidden.

## Outline

- Formal problem statement: inputs (`ph`, `turbidity_ntu`, `tds_ppm`),
  outputs (`water_quality_category`, `prediction_confidence`,
  `contamination_risk`)
- Why continuous monitoring, not periodic lab sampling, is the target use
  case
- What is explicitly out of scope (pathogen identification, potability
  certification) and why (see `docs/machine-learning/contamination-detection.md`
  §5, `docs/limitations/ml-limitations.md`)
- The ground-truth-label problem and the chosen mitigation (see Chapter 9,
  `docs/machine-learning/target-methodology.md`)
- Success criteria for this project as actually evaluated (technical
  correctness of the pipeline, not field-validated real-world accuracy -
  see Chapter 17)
