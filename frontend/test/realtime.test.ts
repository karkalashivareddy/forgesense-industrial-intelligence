/**
 * Realtime pipeline tests.
 *
 * Envelope validation is the security boundary between the network and
 * application state: nothing reaches the stores until it has been validated,
 * ordered and deduplicated.
 */

import { describe, expect, it } from 'vitest';
import { decodeFrames, encodeFrame, isValidIso, validateEnvelope } from '../src/realtime/stomp';
import { deriveConnectionQuality } from '../src/realtime/store';
import type { TransportStatus } from '../src/realtime/stomp';

describe('STOMP framing', () => {
  it('round-trips a frame', () => {
    const wire = encodeFrame('MESSAGE', { destination: '/topic/telemetry.updated' }, '{"a":1}');
    const { frames, rest } = decodeFrames(wire);
    expect(rest).toBe('');
    expect(frames).toHaveLength(1);
    expect(frames[0]?.command).toBe('MESSAGE');
    expect(frames[0]?.headers.destination).toBe('/topic/telemetry.updated');
    expect(frames[0]?.body).toBe('{"a":1}');
  });

  it('buffers a partial frame and completes it on the next chunk', () => {
    const wire = encodeFrame('MESSAGE', { destination: '/topic/x' }, 'body');
    const cut = Math.floor(wire.length / 2);

    const first = decodeFrames(wire.slice(0, cut));
    expect(first.frames).toHaveLength(0);
    expect(first.rest.length).toBeGreaterThan(0);

    const second = decodeFrames(first.rest + wire.slice(cut));
    expect(second.frames).toHaveLength(1);
    expect(second.frames[0]?.body).toBe('body');
  });

  it('decodes several frames delivered in one chunk', () => {
    const wire = encodeFrame('CONNECTED', { version: '1.2' }) + encodeFrame('MESSAGE', { destination: '/topic/a' }, '{}');
    const { frames } = decodeFrames(wire);
    expect(frames.map((frame) => frame.command)).toEqual(['CONNECTED', 'MESSAGE']);
  });
});

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    event: 'telemetry.updated',
    eventId: 'evt-00000001',
    sequence: 42,
    timestamp: '2026-09-19T12:00:00Z',
    assetId: 'M-101',
    payload: { machineId: 'M-101', temperature: 54.6, timestamp: '2026-09-19T12:00:00Z' },
    ...overrides,
  };
}

describe('validateEnvelope', () => {
  it('accepts a well-formed envelope', () => {
    const result = validateEnvelope('telemetry.updated', envelope());
    expect(result.ok).toBe(true);
  });

  it('rejects an unknown topic', () => {
    expect(validateEnvelope('evil.topic', envelope({ event: 'evil.topic' })).ok).toBe(false);
  });

  it('rejects a topic/payload mismatch', () => {
    const result = validateEnvelope('telemetry.updated', envelope({ event: 'alert.created' }));
    expect(result.ok).toBe(false);
  });

  it('rejects a missing or malformed eventId', () => {
    expect(validateEnvelope('telemetry.updated', envelope({ eventId: undefined })).ok).toBe(false);
    expect(validateEnvelope('telemetry.updated', envelope({ eventId: 'short' })).ok).toBe(false);
  });

  it('rejects an invalid timestamp', () => {
    expect(validateEnvelope('telemetry.updated', envelope({ timestamp: 'yesterday' })).ok).toBe(false);
  });

  it('rejects a non-monotonic-safe sequence', () => {
    expect(validateEnvelope('telemetry.updated', envelope({ sequence: -1 })).ok).toBe(false);
    expect(validateEnvelope('telemetry.updated', envelope({ sequence: 1.5 })).ok).toBe(false);
  });

  it('requires a machineId for machine-scoped topics', () => {
    const result = validateEnvelope(
      'telemetry.updated',
      envelope({ payload: { temperature: 1 }, assetId: undefined }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a non-finite sensor value', () => {
    const result = validateEnvelope(
      'telemetry.updated',
      envelope({ payload: { machineId: 'M-101', temperature: Number.NaN } }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a non-object payload', () => {
    expect(validateEnvelope('telemetry.updated', envelope({ payload: 'nope' })).ok).toBe(false);
    expect(validateEnvelope('telemetry.updated', envelope({ payload: [1, 2] })).ok).toBe(false);
  });

  it('rejects a non-object envelope', () => {
    expect(validateEnvelope('telemetry.updated', 'a string').ok).toBe(false);
    expect(validateEnvelope('telemetry.updated', null).ok).toBe(false);
  });
});

describe('isValidIso', () => {
  it('accepts parseable ISO timestamps and rejects junk', () => {
    expect(isValidIso('2026-09-19T12:00:00Z')).toBe(true);
    expect(isValidIso('not a date')).toBe(false);
    expect(isValidIso(12345)).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Connection quality — the honesty contract
 * ------------------------------------------------------------------ */

const NOW = Date.parse('2026-09-19T12:00:00Z');

function transport(overrides: Partial<TransportStatus> = {}): TransportStatus {
  return {
    state: 'open',
    detail: null,
    attempt: 0,
    lastEventAt: NOW - 1000,
    lastConnectAt: NOW - 10_000,
    eventsApplied: 10,
    duplicatesDropped: 0,
    invalidDropped: 0,
    ...overrides,
  };
}

describe('deriveConnectionQuality', () => {
  const healthy = { dataBasis: 'SYNTHETIC', demoMode: true, restOk: true, restAgeSec: 2, now: NOW };

  it('never calls a synthetic feed LIVE', () => {
    const quality = deriveConnectionQuality(transport(), healthy);
    expect(quality.label).toBe('SYNTHETIC');
    expect(quality.label).not.toBe('LIVE');
  });

  it('reports LIVE only when the feed is genuinely observed', () => {
    const quality = deriveConnectionQuality(transport(), { ...healthy, dataBasis: 'OBSERVED', demoMode: false });
    expect(quality.label).toBe('LIVE');
  });

  it('reports OFFLINE when REST snapshots fail, even if the socket is open', () => {
    const quality = deriveConnectionQuality(transport(), { ...healthy, restOk: false });
    expect(quality.label).toBe('OFFLINE');
  });

  it('reports STALE when the socket is open but silent', () => {
    const quality = deriveConnectionQuality(
      transport({ lastEventAt: NOW - 120_000 }),
      healthy,
    );
    expect(quality.label).toBe('STALE');
  });

  it('reports SYNCING while the transport is connecting', () => {
    const quality = deriveConnectionQuality(transport({ state: 'connecting' }), healthy);
    expect(quality.label).toBe('SYNCING');
  });

  it('reports DEGRADED and names the fallback when the socket is down', () => {
    const quality = deriveConnectionQuality(transport({ state: 'closed' }), healthy);
    expect(quality.label).toBe('DEGRADED');
    expect(quality.detail).toContain('REST');
  });
});
