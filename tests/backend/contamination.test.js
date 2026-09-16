import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ruleBasedContaminationFlag, statisticalAnomalyFlag, assessContaminationRisk } from '../../api/_lib/contamination.js';

test('rule-based flag catches high turbidity', () => {
  const { flagged, reasons } = ruleBasedContaminationFlag({ turbidity_ntu: 80, tds_ppm: 100, ph: 7 });
  assert.equal(flagged, true);
  assert.ok(reasons.some((r) => r.includes('turbidity_ntu')));
});

test('rule-based flag is clean for normal values', () => {
  const { flagged } = ruleBasedContaminationFlag({ turbidity_ntu: 2, tds_ppm: 200, ph: 7.2 });
  assert.equal(flagged, false);
});

test('statistical flag requires sufficient history', () => {
  const { flagged, reasons } = statisticalAnomalyFlag({ turbidity_ntu: 10, tds_ppm: 300 }, []);
  assert.equal(flagged, false);
  assert.ok(reasons[0].includes('insufficient history'));
});

test('statistical flag catches a sharp deviation from stable history', () => {
  const history = Array.from({ length: 20 }, () => ({ turbidity_ntu: 2 + Math.random() * 0.2, tds_ppm: 200 }));
  const { flagged, reasons } = statisticalAnomalyFlag({ turbidity_ntu: 50, tds_ppm: 200 }, history);
  assert.equal(flagged, true);
  assert.ok(reasons.some((r) => r.includes('turbidity_ntu')));
});

test('assessContaminationRisk does not leak an unflagged statistical placeholder reason', () => {
  const { contamination_risk, reasons } = assessContaminationRisk(
    { turbidity_ntu: 2, tds_ppm: 200, ph: 7.2 },
    'Safe',
    []
  );
  assert.equal(contamination_risk, false);
  assert.deepEqual(reasons, []);
});

test('assessContaminationRisk is triggered by category alone', () => {
  const { contamination_risk, reasons } = assessContaminationRisk(
    { turbidity_ntu: 2, tds_ppm: 200, ph: 7.2 },
    'Critical',
    []
  );
  assert.equal(contamination_risk, true);
  assert.ok(reasons.some((r) => r.includes('Critical')));
});
