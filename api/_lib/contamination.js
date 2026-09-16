// Rule-based contamination-risk detection, independent of the ML
// classifier (see docs/machine-learning/contamination-detection.md).
//
// Terminology rule (data contract section 3): this module only ever
// produces "potential contamination risk detected" style output. It never
// claims to identify a specific pathogen or chemical, because the sensors
// installed cannot measure those.

const HARD_THRESHOLDS = {
  turbidity_ntu: 50, // WHO: severely degraded above this
  tds_ppm: 2000, // WHO/EPA: unacceptable above this
};

/** Immediate rule-based check against absolute thresholds. */
export function ruleBasedContaminationFlag(reading) {
  const reasons = [];
  if (typeof reading.turbidity_ntu === 'number' && reading.turbidity_ntu > HARD_THRESHOLDS.turbidity_ntu) {
    reasons.push(`turbidity_ntu ${reading.turbidity_ntu} exceeds ${HARD_THRESHOLDS.turbidity_ntu} NTU`);
  }
  if (typeof reading.tds_ppm === 'number' && reading.tds_ppm > HARD_THRESHOLDS.tds_ppm) {
    reasons.push(`tds_ppm ${reading.tds_ppm} exceeds ${HARD_THRESHOLDS.tds_ppm} ppm`);
  }
  if (typeof reading.ph === 'number' && (reading.ph < 5.5 || reading.ph > 9.5)) {
    reasons.push(`ph ${reading.ph} outside [5.5, 9.5]`);
  }
  return { flagged: reasons.length > 0, reasons };
}

/** Statistical anomaly check: flags a reading that deviates from the
 * device's own recent history by more than 3 standard deviations, catching
 * sudden shifts even when individual values stay within absolute
 * thresholds. `recentReadings` should be the last N readings for the same
 * device (N >= ~10 recommended for a meaningful mean/std). */
export function statisticalAnomalyFlag(reading, recentReadings) {
  if (!recentReadings || recentReadings.length < 10) {
    return { flagged: false, reasons: ['insufficient history for statistical check'] };
  }

  const reasons = [];
  for (const feature of ['turbidity_ntu', 'tds_ppm']) {
    const values = recentReadings.map((r) => r[feature]).filter((v) => typeof v === 'number');
    if (values.length < 10) continue;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
    const std = Math.sqrt(variance);
    if (std === 0) continue;
    const z = (reading[feature] - mean) / std;
    if (Math.abs(z) > 3) {
      reasons.push(`${feature} z-score ${z.toFixed(2)} exceeds +-3 vs recent device history`);
    }
  }
  return { flagged: reasons.length > 0, reasons };
}

/** Combines the ML category, rule-based check, and statistical check into
 * a single contamination_risk boolean + explanation used for alerts. */
export function assessContaminationRisk(reading, waterQualityCategory, recentReadings) {
  const ruleResult = ruleBasedContaminationFlag(reading);
  const statResult = statisticalAnomalyFlag(reading, recentReadings);
  const categoryTriggered = waterQualityCategory === 'Critical' || waterQualityCategory === 'Unsafe';

  const reasons = [...ruleResult.reasons];
  if (statResult.flagged) reasons.push(...statResult.reasons);
  if (categoryTriggered) reasons.push(`predicted category is ${waterQualityCategory}`);

  return {
    contamination_risk: ruleResult.flagged || statResult.flagged || categoryTriggered,
    reasons,
  };
}
