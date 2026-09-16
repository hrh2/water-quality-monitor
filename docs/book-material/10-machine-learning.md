# Chapter 10: Machine Learning

This chapter introduces the ML component as a whole: a supervised
multiclass classifier predicting `water_quality_category`
(`Safe`/`Moderate`/`Unsafe`/`Critical`) from three numeric sensor
features, plus an entirely separate, non-ML contamination-risk assessment
that combines fixed engineering thresholds with a statistical
deviation-from-recent-history check. The two are complementary by design:
the classifier answers "what severity band does this reading fall in,"
while the contamination check answers "is this specific reading anomalous
relative to physical limits or this device's own recent behavior" -
neither subsumes the other (`api/_lib/contamination.js::assessContaminationRisk`
does incorporate the predicted category as one of three signals, but the
rule-based and statistical checks fire independently of it).

Six model families were trained, cross-validated, and compared
(logistic regression, decision tree, random forest, gradient boosting,
KNN, and RBF-SVM), with the final production model chosen not purely by
predictive performance but by a real deployment constraint: only three of
the six families can be exported to the dependency-free JSON format the
Vercel Node.js backend can evaluate without a Python runtime
(`docs/architecture/adr-002-ml-inference-runtime.md`). This
performance-vs-deployability tradeoff, and the model comparison numbers
behind it, are detailed in Chapters 11-12 and
`docs/machine-learning/model-comparison.md`.

## Outline

- Two complementary ML/rule-based components: classification and
  contamination risk assessment
- Why six model families were compared, not just one
  (`docs/machine-learning/model-comparison.md`)
- The deployability constraint on model selection (ADR-002)
- Where training happens (Python, `ml/`) vs. where inference happens
  (JavaScript, `api/_lib/predict.js`) and why they're split
- Terminology discipline: predicted category and contamination risk, never
  a potability certification (see Chapter 2, Chapter 19)
