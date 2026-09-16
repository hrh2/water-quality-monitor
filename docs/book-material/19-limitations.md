# Chapter 19: Limitations

This project's limitations fall into two categories that should not be
conflated: ML/data limitations (what the model can legitimately claim to
predict) and security/engineering limitations (real gaps in the current
implementation). Both are documented in full, honestly, in
`docs/limitations/ml-limitations.md` and
`docs/limitations/security-limitations.md` respectively - this chapter's
fuller version should synthesize both into one coherent limitations
narrative for a thesis/capstone audience, not merely restate them.

The single most important ML limitation to state plainly: the training
label, `water_quality_category`, is derived from a documented engineering
rule applied to a synthetic dataset, not from lab-confirmed potability
testing - so the model's strong reported metrics (93% test accuracy,
0.9925 ROC-AUC) measure how well the classifier recovers that rule on
synthetic data, not how well it predicts real-world water safety. Equally
important on the hardware side: only three sensor parameters exist
(`ph`, `turbidity_ntu`, `tds_ppm`) - no temperature, no dissolved oxygen -
despite an earlier project abstract mentioning such parameters
aspirationally.

On the engineering side, the honest list includes: no rate limiting
anywhere, a JWT stored in browser localStorage (an accepted XSS-exposure
tradeoff for this project's scope), no refresh-token rotation, a
single-admin-account model with no RBAC, a firmware-documented hijack risk
around unauthenticated-at-handshake-time `set_config` messages, and
reduced-rigor TLS certificate validation
(`rejectUnauthorized: false`) against the database. None of these are
exploited or demonstrated as vulnerabilities in this repository - they are
documented as known, present gaps.

## Outline

- ML/data limitations: simulated label, three-sensor scope, synthetic
  dataset, what the metrics do and don't validate
  (`docs/limitations/ml-limitations.md`)
- Security/engineering limitations: rate limiting, token storage,
  RBAC, remote-config hijack risk, TLS validation tradeoff
  (`docs/limitations/security-limitations.md`)
- Testing coverage gaps, stated honestly
  (`docs/requirements-traceability.md`)
- Why these are documented rather than hidden: this project's stated
  anti-fabrication and honesty principle
