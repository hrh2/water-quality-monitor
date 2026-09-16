import { test } from 'node:test';
import assert from 'node:assert/strict';
import { predictWaterQuality, getModelMetadata } from '../../api/_lib/predict.js';

test('model metadata is loadable and matches the data contract feature order', () => {
  const meta = getModelMetadata();
  assert.deepEqual(meta.feature_order, ['ph', 'turbidity_ntu', 'tds_ppm']);
  assert.deepEqual([...meta.class_labels].sort(), ['Critical', 'Moderate', 'Safe', 'Unsafe']);
});

test('predicted class probabilities sum to ~1 and pick the argmax', () => {
  const result = predictWaterQuality({ ph: 7.1, turbidity_ntu: 2.0, tds_ppm: 200 });
  const sum = Object.values(result.class_probabilities).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-6, `probabilities should sum to 1, got ${sum}`);

  const maxLabel = Object.entries(result.class_probabilities).sort((a, b) => b[1] - a[1])[0][0];
  assert.equal(result.water_quality_category, maxLabel);
  assert.equal(result.prediction_confidence, result.class_probabilities[maxLabel]);
});

test('a null ph (Modbus failure) is imputed, not rejected', () => {
  const result = predictWaterQuality({ ph: null, turbidity_ntu: 5, tds_ppm: 300 });
  assert.ok(['Safe', 'Moderate', 'Unsafe', 'Critical'].includes(result.water_quality_category));
});

test('extreme values push the prediction toward Critical', () => {
  const result = predictWaterQuality({ ph: 3.5, turbidity_ntu: 200, tds_ppm: 5000 });
  assert.equal(result.water_quality_category, 'Critical');
});

test('clean values push the prediction toward Safe', () => {
  const result = predictWaterQuality({ ph: 7.2, turbidity_ntu: 1.5, tds_ppm: 180 });
  assert.equal(result.water_quality_category, 'Safe');
});
