import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveDeviceStatus, ONLINE_THRESHOLD_MS } from '../../api/_lib/devices.js';

test('never connected when last_seen_at is null', () => {
  assert.equal(deriveDeviceStatus(null), 'Never connected');
});

test('online when last seen recently', () => {
  const recent = new Date(Date.now() - 1000).toISOString();
  assert.equal(deriveDeviceStatus(recent), 'Online');
});

test('offline when last seen beyond the threshold', () => {
  const stale = new Date(Date.now() - (ONLINE_THRESHOLD_MS + 60_000)).toISOString();
  assert.equal(deriveDeviceStatus(stale), 'Offline');
});

test('connection error when stale AND a recent ws error was recorded', () => {
  const stale = new Date(Date.now() - (ONLINE_THRESHOLD_MS + 60_000)).toISOString();
  assert.equal(deriveDeviceStatus(stale, true), 'Connection error');
});
