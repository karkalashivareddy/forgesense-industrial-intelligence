/**
 * STOMP-over-WebSocket transport.
 *
 * The backend publishes one canonical envelope per event (see
 * common/domain/EventEnvelope.java). This client is the ONLY place that
 * speaks the STOMP wire protocol. Its jobs are:
 *
 *   1. frame / unframe STOMP messages
 *   2. validate every envelope before it can reach application state
 *   3. deduplicate by eventId and order by the monotonic envelope sequence
 *   4. coalesce high-frequency per-asset deltas, batched to one flush per frame
 *   5. bound memory: capped pending maps, capped dedupe set
 *   6. reconnect with exponential backoff and jitter
 *   7. emit heartbeats so the UI can prove the feed is alive
 *
 * Performance contract: a telemetry storm at 18 machines x 5 s produces a
 * handful of dispatches per animation frame, not 18 store writes per frame,
 * and never a full application render.
 */

import { LIVE_TOPICS, type LiveTopic, type RealtimeEnvelope } from '../api/types';

export type TransportState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'stale'
  | 'closed';

export interface TransportStatus {
  state: TransportState;
  /** Human-readable reason, shown verbatim in the UI. */
  detail: string | null;
  attempt: number;
  lastEventAt: number | null;
  lastConnectAt: number | null;
  eventsApplied: number;
  duplicatesDropped: number;
  invalidDropped: number;
}

export interface RealtimeHandlers {
  onEvents(events: { topic: LiveTopic; event: RealtimeEnvelope }[]): void;
  onStatus(status: TransportStatus): void;
  onDiagnostic(code: string, detail?: string): void;
}

/* ------------------------------------------------------------------ *
 * STOMP framing
 * ------------------------------------------------------------------ */

/** Encoded as the STOMP 1.2 wire format requires. Exported for protocol tests. */
export function encodeFrame(command: string, headers: Record<string, string>, body = ''): string {
  const lines = [command];
  for (const [key, value] of Object.entries(headers)) lines.push(`${key}:${value}`);
  lines.push('');
  return `${lines.join('\n')}\n${body}\0`;
}

interface StompFrame {
  command: string;
  headers: Record<string, string>;
  body: string;
}

export type { StompFrame };

/** Incremental decoder: tolerates partial frames across WebSocket chunks. */
export function decodeFrames(buffer: string): { frames: StompFrame[]; rest: string } {
  const frames: StompFrame[] = [];
  let rest = buffer;

  while (true) {
    const end = rest.indexOf('\0');
    if (end < 0) break;
    const raw = rest.slice(0, end);
    rest = rest.slice(end + 1);

    const normalised = raw.startsWith('\n') ? raw.slice(1) : raw;
    const split = normalised.indexOf('\n\n');
    if (split < 0) continue;

    const head = normalised.slice(0, split).split('\n');
    const command = head.shift() ?? '';
    const headers: Record<string, string> = {};
    for (const line of head) {
      const colon = line.indexOf(':');
      if (colon > 0) headers[line.slice(0, colon)] = line.slice(colon + 1);
    }
    let body = normalised.slice(split + 2);
    const length = Number(headers['content-length']);
    if (Number.isFinite(length)) body = body.slice(0, length);
    frames.push({ command, headers, body });
  }

  return { frames, rest };
}

/* ------------------------------------------------------------------ *
 * Envelope validation
 * ------------------------------------------------------------------ */

const TOPIC_SET = new Set<string>(LIVE_TOPICS);

/** Machine-scoped topics always need a resolvable machine id. */
const MACHINE_TOPICS = new Set<string>([
  'telemetry.updated',
  'machine.updated',
  'machine.state.changed',
  'prediction.updated',
]);

/** Telemetry sensor keys whose payload values must be finite numbers. */
const NUMERIC_TELEMETRY_KEYS = [
  'temperature',
  'vibration',
  'pressure',
  'rpm',
  'torque',
  'current',
  'voltage',
  'power',
  'flow',
  'frequency',
] as const;

export function isValidIso(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

export function validateEnvelope(
  topic: string,
  raw: unknown,
): { ok: true; event: RealtimeEnvelope } | { ok: false; reason: string } {
  if (!TOPIC_SET.has(topic)) return { ok: false, reason: 'unknown topic' };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'envelope not an object' };

  const event = raw as Record<string, unknown>;
  if (event.event !== topic) return { ok: false, reason: 'event/topic mismatch' };
  if (typeof event.eventId !== 'string' || event.eventId.length < 8 || event.eventId.length > 128) {
    return { ok: false, reason: 'invalid eventId' };
  }
  if (!isValidIso(event.timestamp)) return { ok: false, reason: 'invalid timestamp' };
  if (typeof event.sequence !== 'number' || !Number.isSafeInteger(event.sequence) || event.sequence < 0) {
    return { ok: false, reason: 'invalid sequence' };
  }
  if (event.assetId != null && (typeof event.assetId !== 'string' || event.assetId.length > 128)) {
    return { ok: false, reason: 'invalid assetId' };
  }

  const payload = event.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, reason: 'payload must be an object' };
  }

  const record = payload as Record<string, unknown>;

  if (MACHINE_TOPICS.has(topic)) {
    const machineId = record.machineId ?? event.assetId;
    if (typeof machineId !== 'string' || machineId.length === 0 || machineId.length > 128) {
      return { ok: false, reason: 'machineId required' };
    }
  }

  if (topic === 'telemetry.updated') {
    if (record.timestamp != null && !isValidIso(record.timestamp)) {
      return { ok: false, reason: 'invalid telemetry timestamp' };
    }
    for (const key of NUMERIC_TELEMETRY_KEYS) {
      const value = record[key];
      if (value != null && (typeof value !== 'number' || !Number.isFinite(value))) {
        return { ok: false, reason: `invalid telemetry field: ${key}` };
      }
    }
  }

  return {
    ok: true,
    event: {
      event: topic as LiveTopic,
      eventId: event.eventId,
      sequence: event.sequence,
      timestamp: event.timestamp,
      assetId: event.assetId as string | undefined,
      payload: record,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Client
 * ------------------------------------------------------------------ */

/** Topics coalesced per entity. Telemetry for one asset only needs its newest value. */
const COALESCE_TOPICS = new Set<string>([
  'telemetry.updated',
  'machine.updated',
  'machine.state.changed',
  'prediction.updated',
]);

const MAX_COALESCED = 240;
const MAX_DISCRETE_PER_FLUSH = 256;
const HEARTBEAT_MS = 10_000;

function entityKey(topic: string, event: RealtimeEnvelope): string {
  const p = event.payload;
  const id = event.assetId ?? p.machineId ?? p.id ?? 'global';
  return `${topic}:${String(id)}`;
}

export class StompRealtimeClient {
  private socket: WebSocket | null = null;
  private state: TransportState = 'idle';
  private stopped = true;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private buffer = '';
  private flushScheduled = false;

  /** Per-entity latest delta awaiting the next frame flush. */
  private coalesced = new Map<string, { topic: LiveTopic; event: RealtimeEnvelope }>();
  /** Discrete events (alerts, maintenance, simulation) — order matters. */
  private discrete: { topic: LiveTopic; event: RealtimeEnvelope }[] = [];

  private seenEventIds = new Set<string>();
  private seenOrder: string[] = [];

  private detail: string | null = null;
  private lastSequence = -1;
  private maxDedupe: number;
  private lastEventAt: number | null = null;
  private lastConnectAt: number | null = null;
  private eventsApplied = 0;
  private duplicatesDropped = 0;
  private invalidDropped = 0;
  private consecutiveFailures = 0;

  constructor(
    private readonly url: string,
    private readonly tokenProvider: () => string | null,
    private readonly handlers: RealtimeHandlers,
    options: { maxDedupe?: number; reconnectBaseMs?: number; reconnectMaxMs?: number } = {},
  ) {
    this.maxDedupe = options.maxDedupe ?? 2048;
    this.reconnectBaseMs = options.reconnectBaseMs ?? 1000;
    this.reconnectMaxMs = options.reconnectMaxMs ?? 30_000;
  }

  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;

  getState(): TransportState {
    return this.state;
  }

  connect(): void {
    this.stopped = false;

    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const token = this.tokenProvider();
    if (!token) {
      this.transition('closed', 'waiting for an authenticated session');
      return;
    }

    this.transition(this.attempt > 0 ? 'reconnecting' : 'connecting', null);

    try {
      const socket = new WebSocket(this.url);
      this.socket = socket;

      socket.onopen = () => {
        socket.send(
          encodeFrame('CONNECT', {
            'accept-version': '1.2',
            host: window.location.host || 'forgesense',
            'heart-beat': `${HEARTBEAT_MS},${HEARTBEAT_MS}`,
            Authorization: `Bearer ${token}`,
          }),
        );
      };

      socket.onmessage = (message) => this.receive(String(message.data));

      socket.onerror = () => {
        this.handlers.onDiagnostic('transport-error');
      };

      socket.onclose = () => {
        this.stopHeartbeat();
        if (this.socket === socket) this.socket = null;
        if (!this.stopped) this.scheduleReconnect();
        else this.transition('closed', 'disconnected');
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.stopped = true;
    this.attempt = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    this.coalesced.clear();
    this.discrete.length = 0;
    this.buffer = '';

    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) {
      try {
        socket.close();
      } catch {
        /* already closing */
      }
    }
    this.transition('closed', null);
  }

  /* ---------------- internals ---------------- */

  private receive(data: string): void {
    this.buffer += data;
    const { frames, rest } = decodeFrames(this.buffer);
    this.buffer = rest;
    for (const frame of frames) this.handleFrame(frame);
  }

  private handleFrame(frame: StompFrame): void {
    if (frame.command === 'CONNECTED') {
      this.attempt = 0;
      this.consecutiveFailures = 0;
      this.lastConnectAt = Date.now();
      this.startHeartbeat();
      for (const topic of LIVE_TOPICS) {
        this.socket?.send(
          encodeFrame('SUBSCRIBE', {
            id: `forgesense-${topic}`,
            destination: `/topic/${topic}`,
            ack: 'auto',
          }),
        );
      }
      this.transition('open', null);
      return;
    }

    if (frame.command === 'ERROR') {
      this.handlers.onDiagnostic('broker-rejected-connection', frame.headers.message);
      this.socket?.close();
      return;
    }

    if (frame.command !== 'MESSAGE') return;

    const topic = (frame.headers.destination ?? '').replace(/^\/topic\//, '');
    if (!TOPIC_SET.has(topic)) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(frame.body || '{}');
    } catch {
      this.invalidDropped += 1;
      this.handlers.onDiagnostic('invalid-json', topic);
      return;
    }

    const result = validateEnvelope(topic, parsed);
    if (!result.ok) {
      this.invalidDropped += 1;
      this.handlers.onDiagnostic('invalid-envelope', `${topic}: ${result.reason}`);
      return;
    }

    const { event } = result;

    // Duplicate suppression.
    if (this.seenEventIds.has(event.eventId)) {
      this.duplicatesDropped += 1;
      return;
    }
    this.remember(event.eventId);

    // Ordering: a regression in the global sequence means a dropped or
    // replayed envelope while the socket stayed up. Surface it so the store
    // can request a REST reconciliation instead of drifting.
    if (event.sequence < this.lastSequence) {
      this.handlers.onDiagnostic('sequence-regression', `${this.lastSequence} -> ${event.sequence}`);
    } else {
      this.lastSequence = event.sequence;
    }

    this.lastEventAt = Date.now();

    if (COALESCE_TOPICS.has(topic)) {
      const key = entityKey(topic, event);
      this.coalesced.set(key, { topic: topic as LiveTopic, event });
      // Bound memory: drop the oldest entity when the map grows past the cap.
      if (this.coalesced.size > MAX_COALESCED) {
        const oldest = this.coalesced.keys().next();
        if (!oldest.done) this.coalesced.delete(oldest.value);
      }
    } else {
      if (this.discrete.length >= MAX_DISCRETE_PER_FLUSH) this.flush();
      this.discrete.push({ topic: topic as LiveTopic, event });
    }

    this.scheduleFlush();
  }

  private remember(eventId: string): void {
    this.seenEventIds.add(eventId);
    this.seenOrder.push(eventId);
    while (this.seenOrder.length > this.maxDedupe) {
      const evicted = this.seenOrder.shift();
      if (evicted !== undefined) this.seenEventIds.delete(evicted);
    }
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    const run = () => this.flush();
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 16);
  }

  /**
   * Dispatch at most once per animation frame. This is the single point that
   * keeps an 18-machine telemetry storm from producing 18 store writes.
   */
  private flush(): void {
    this.flushScheduled = false;
    if (this.coalesced.size === 0 && this.discrete.length === 0) return;

    const batch = [...this.coalesced.values(), ...this.discrete].sort(
      (a, b) => a.event.sequence - b.event.sequence,
    );
    this.coalesced.clear();
    this.discrete.length = 0;

    this.eventsApplied += batch.length;
    this.consecutiveFailures = 0;
    try {
      this.handlers.onEvents(batch);
    } catch (error) {
      this.handlers.onDiagnostic('event-handler-error', String(error));
    }
    this.emitStatus();
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) this.socket.send('\n');
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.attempt += 1;
    this.consecutiveFailures += 1;

    // Exponential backoff with jitter so a backend restart doesn't produce a
    // synchronised reconnect stampede from every open browser tab.
    const exponential = this.reconnectBaseMs * 2 ** Math.min(this.attempt - 1, 5);
    const capped = Math.min(exponential, this.reconnectMaxMs);
    const jitter = capped * 0.25 * Math.random();
    const delay = Math.round(capped + jitter);

    this.transition('reconnecting', `retry in ${Math.round(delay / 1000)}s (attempt ${this.attempt})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private transition(state: TransportState, detail: string | null): void {
    const unchanged = this.state === state && this.detail === detail;
    this.state = state;
    this.detail = detail;
    if (unchanged) return;
    this.emitStatus();
  }

  private emitStatus(): void {
    this.handlers.onStatus(this.getStatus());
  }

  getStatus(): TransportStatus {
    return {
      state: this.state,
      detail: this.detail,
      attempt: this.attempt,
      lastEventAt: this.lastEventAt,
      lastConnectAt: this.lastConnectAt,
      eventsApplied: this.eventsApplied,
      duplicatesDropped: this.duplicatesDropped,
      invalidDropped: this.invalidDropped,
    };
  }
}

/**
 * Mark the transport STALE when no delta has arrived for `thresholdSec` while
 * the socket still reports open. Returns true when the state changed.
 */
export function evaluateTransportStaleness(
  status: TransportStatus,
  thresholdSec: number,
  now: number = Date.now(),
): boolean {
  if (status.state !== 'open') return false;
  if (status.lastEventAt === null) return false;
  const silentSec = (now - status.lastEventAt) / 1000;
  return silentSec > thresholdSec;
}
