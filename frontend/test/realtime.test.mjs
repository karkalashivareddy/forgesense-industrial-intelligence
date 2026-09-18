import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StompRealtimeClient, validateRealtimeEvent } from '../js/realtime.js';

const envelope = (topic, sequence, payload = { machineId: 'M-101', temperature: 72 }) => ({
  event: topic,
  eventId: `event-${sequence}-1234`,
  assetId: 'M-101',
  timestamp: new Date(1700000000000 + sequence * 1000).toISOString(),
  sequence,
  payload,
});

test('realtime validator rejects malformed and mismatched envelopes', () => {
  assert.equal(validateRealtimeEvent('telemetry.updated', envelope('telemetry.updated', 1)).ok, true);
  assert.equal(validateRealtimeEvent('telemetry.updated', { ...envelope('machine.updated', 1) }).ok, false);
  assert.equal(validateRealtimeEvent('telemetry.updated', { ...envelope('telemetry.updated', 1), sequence: -1 }).ok, false);
  assert.equal(validateRealtimeEvent('telemetry.updated', { ...envelope('telemetry.updated', 1), payload: { machineId: 'M-101', temperature: 'hot' } }).ok, false);
});

test('realtime transport coalesces telemetry but preserves discrete events', () => {
  const received = [];
  const client = new StompRealtimeClient({ onEvent: (topic, event) => received.push({ topic, event }) });
  client.handleFrame({ command: 'MESSAGE', headers: { destination: '/topic/telemetry.updated' }, body: JSON.stringify(envelope('telemetry.updated', 1, { machineId: 'M-101', temperature: 70 })) });
  client.handleFrame({ command: 'MESSAGE', headers: { destination: '/topic/telemetry.updated' }, body: JSON.stringify(envelope('telemetry.updated', 2, { machineId: 'M-101', temperature: 72 })) });
  client.handleFrame({ command: 'MESSAGE', headers: { destination: '/topic/alert.created' }, body: JSON.stringify(envelope('alert.created', 3, { id: 'A-1', machineId: 'M-101', severity: 'CRITICAL' })) });
  client.flushPending();
  assert.equal(received.length, 2);
  assert.equal(received[0].event.sequence, 2);
  assert.equal(received[1].topic, 'alert.created');
});
