import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateReadingPayload } from '../../api/_lib/validation.js';

test('accepts a well-formed reading', () => {
  const { ok, errors } = validateReadingPayload({
    device_id: 'd1', token: 't1', ts: 1, ph: 7.1, turbidity_ntu: 2.0, tds_ppm: 150,
  });
  assert.equal(ok, true);
  assert.deepEqual(errors, []);
});

test('allows ph to be null (Modbus read failure)', () => {
  const { ok, errors } = validateReadingPayload({
    device_id: 'd1', token: 't1', ts: 1, ph: null, turbidity_ntu: 2.0, tds_ppm: 150,
  });
  assert.equal(ok, true);
  assert.deepEqual(errors, []);
});

test('rejects missing device_id', () => {
  const { ok, errors } = validateReadingPayload({ token: 't1', turbidity_ntu: 1, tds_ppm: 1 });
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes('device_id')));
});

test('rejects missing turbidity_ntu/tds_ppm', () => {
  const { ok, errors } = validateReadingPayload({ device_id: 'd1', token: 't1' });
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes('turbidity_ntu')));
  assert.ok(errors.some((e) => e.includes('tds_ppm')));
});

test('flags (does not reject) an out-of-range but well-typed ph', () => {
  const { ok, notes } = validateReadingPayload({
    device_id: 'd1', token: 't1', ph: 20, turbidity_ntu: 1, tds_ppm: 1,
  });
  assert.equal(ok, true); // engineering flag, not a rejection
  assert.ok(notes.some((n) => n.includes('ph')));
});

test('rejects non-numeric ph', () => {
  const { ok, errors } = validateReadingPayload({
    device_id: 'd1', token: 't1', ph: 'seven', turbidity_ntu: 1, tds_ppm: 1,
  });
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes('ph')));
});
