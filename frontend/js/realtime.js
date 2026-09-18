/**
 * Authenticated ForgeSense STOMP transport.
 *
 * The backend publishes one canonical envelope per event. This module is the
 * only boundary that parses, validates, orders, coalesces, and dispatches
 * realtime messages to the application state layer.
 */

export const ConnectionState = Object.freeze({
  CONNECTING: 'connecting',
  OPEN: 'open',
  RECONNECTING: 'reconnecting',
  CLOSED: 'closed',
});

export const LIVE_TOPICS = Object.freeze([
  'telemetry.updated', 'machine.updated', 'machine.state.changed',
  'prediction.updated', 'alert.created', 'alert.updated',
  'maintenance.created', 'maintenance.updated', 'simulation.updated',
  'simulation.control.updated', 'simulation.global.updated',
  'events.updated', 'impact.updated',
]);

const COALESCE_TOPICS = new Set([
  'telemetry.updated', 'machine.updated', 'machine.state.changed', 'prediction.updated',
]);
const MAX_PENDING = 240;
const MAX_DISCRETE = 1024;

function frame(command, headers = {}, body = '') {
  const lines = [command];
  for (const [key, value] of Object.entries(headers)) lines.push(`${key}:${String(value)}`);
  lines.push('');
  return lines.join('\n') + '\n' + body + '\0';
}

function parseFrames(buffer) {
  const frames = [];
  let rest = buffer;
  while (true) {
    const end = rest.indexOf('\0');
    if (end < 0) break;
    const raw = rest.slice(0, end);
    rest = rest.slice(end + 1);
    const normalized = raw.startsWith('\n') ? raw.slice(1) : raw;
    const split = normalized.indexOf('\n\n');
    if (split < 0) continue;
    const head = normalized.slice(0, split).split('\n');
    const command = head.shift();
    const headers = {};
    for (const line of head) {
      const colon = line.indexOf(':');
      if (colon > 0) headers[line.slice(0, colon)] = line.slice(colon + 1);
    }
    let body = normalized.slice(split + 2);
    const length = Number(headers['content-length']);
    if (Number.isFinite(length)) body = body.slice(0, length);
    frames.push({ command, headers, body });
  }
  return { frames, rest };
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validIsoTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

/** Validate the canonical envelope before it can reach application state. */
export function validateRealtimeEvent(topic, event) {
  if (!LIVE_TOPICS.includes(topic) || !isPlainObject(event)) return { ok: false, reason: 'unknown event or non-object envelope' };
  if (event.event !== topic) return { ok: false, reason: 'event/topic mismatch' };
  if (typeof event.eventId !== 'string' || event.eventId.length < 8 || event.eventId.length > 128) {
    return { ok: false, reason: 'invalid eventId' };
  }
  if (!validIsoTimestamp(event.timestamp)) return { ok: false, reason: 'invalid timestamp' };
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 0) return { ok: false, reason: 'invalid sequence' };
  if (event.assetId != null && (typeof event.assetId !== 'string' || event.assetId.length > 128)) {
    return { ok: false, reason: 'invalid assetId' };
  }
  if (!isPlainObject(event.payload)) return { ok: false, reason: 'payload must be an object' };
  const payload = event.payload;
  const machineTopics = ['telemetry.updated', 'machine.updated', 'machine.state.changed', 'prediction.updated'];
  if (machineTopics.includes(topic)) {
    const machineId = payload.machineId || event.assetId;
    if (typeof machineId !== 'string' || machineId.length === 0 || machineId.length > 128) {
      return { ok: false, reason: 'machineId required' };
    }
  }
  if (topic === 'telemetry.updated') {
    if (payload.timestamp != null && !validIsoTimestamp(payload.timestamp)) return { ok: false, reason: 'invalid telemetry timestamp' };
    for (const key of ['temperature', 'vibration', 'pressure', 'rpm', 'torque', 'current', 'voltage', 'power', 'flow', 'frequency']) {
      if (payload[key] != null && (typeof payload[key] !== 'number' || !Number.isFinite(payload[key]))) {
        return { ok: false, reason: `invalid telemetry field: ${key}` };
      }
    }
  }
  return { ok: true };
}

function entityKey(topic, event) {
  const p = event.payload || {};
  return `${topic}:${event.assetId || p.machineId || p.id || 'global'}`;
}

export class StompRealtimeClient {
  constructor(options = {}) {
    this.url = options.url;
    this.tokenProvider = options.tokenProvider || (() => null);
    this.onEvent = options.onEvent || (() => {});
    this.onState = options.onState || (() => {});
    this.onDiagnostic = options.onDiagnostic || (() => {});
    this.reconnectBaseDelay = options.reconnectBaseDelay || 1000;
    this.reconnectMaxDelay = options.reconnectMaxDelay || 30000;
    this.socket = null;
    this.state = ConnectionState.CLOSED;
    this.stopped = true;
    this.attempt = 0;
    this.timer = null;
    this.heartbeat = null;
    this.buffer = '';
    this.pending = new Map();
    this.discretePending = [];
    this.flushScheduled = false;
    this.connectPromise = null;
    this.connectResolve = null;
    this.connectReject = null;
  }

  setState(state, detail = null) {
    if (this.state === state && !detail) return;
    this.state = state;
    this.onState(state, detail);
  }

  connect() {
    this.stopped = false;
    if (this.socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(this.socket.readyState)) {
      return this.connectPromise || Promise.resolve();
    }
    if (this.timer) clearTimeout(this.timer);
    const token = this.tokenProvider();
    if (!token) {
      this.setState(ConnectionState.CLOSED, 'waiting for authenticated session');
      return Promise.reject(new Error('Authenticated session required for live transport'));
    }
    this.setState(this.attempt ? ConnectionState.RECONNECTING : ConnectionState.CONNECTING);
    this.connectPromise = new Promise((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
      try {
        this.socket = new WebSocket(this.url);
        this.socket.onopen = () => {
          const headers = {
            'accept-version': '1.2',
            host: location.host || 'forgesense',
            'heart-beat': '10000,10000',
            Authorization: `Bearer ${token}`,
          };
          this.socket?.send(frame('CONNECT', headers));
        };
        this.socket.onmessage = event => this.receive(String(event.data));
        this.socket.onerror = () => {
          this.onDiagnostic('transport-error');
          this.connectReject?.(new Error('Live telemetry transport unavailable'));
          this.connectReject = null;
        };
        this.socket.onclose = () => {
          this.stopHeartbeat();
          this.socket = null;
          this.connectReject?.(new Error('Live telemetry transport closed'));
          this.connectReject = null;
          this.connectPromise = null;
          if (!this.stopped) this.scheduleReconnect();
          else this.setState(ConnectionState.CLOSED);
        };
      } catch (error) {
        this.connectReject?.(error);
        this.connectReject = null;
        this.scheduleReconnect();
      }
    });
    return this.connectPromise;
  }

  receive(data) {
    this.buffer += data;
    const parsed = parseFrames(this.buffer);
    this.buffer = parsed.rest;
    for (const message of parsed.frames) this.handleFrame(message);
  }

  handleFrame(message) {
    if (message.command === 'CONNECTED') {
      this.attempt = 0;
      this.setState(ConnectionState.OPEN);
      this.startHeartbeat();
      for (const topic of LIVE_TOPICS) {
        this.socket?.send(frame('SUBSCRIBE', {
          id: `forgesense-${topic}`,
          destination: `/topic/${topic}`,
          ack: 'auto',
        }));
      }
      this.connectResolve?.();
      this.connectResolve = null;
      this.connectReject = null;
      this.connectPromise = null;
      return;
    }
    if (message.command === 'ERROR') {
      this.onDiagnostic('broker-error');
      this.connectReject?.(new Error('STOMP broker rejected the connection'));
      this.connectReject = null;
      this.socket?.close();
      return;
    }
    if (message.command !== 'MESSAGE') return;
    const topic = (message.headers.destination || '').replace(/^\/topic\//, '');
    if (!LIVE_TOPICS.includes(topic)) return;
    let event;
    try { event = JSON.parse(message.body || '{}'); } catch {
      this.onDiagnostic('invalid-json');
      return;
    }
    const checked = validateRealtimeEvent(topic, event);
    if (!checked.ok) {
      this.onDiagnostic(`invalid-event:${checked.reason}`);
      return;
    }
    if (COALESCE_TOPICS.has(topic)) {
      this.pending.set(entityKey(topic, event), { topic, event });
      if (this.pending.size > MAX_PENDING) this.pending.delete(this.pending.keys().next().value);
    } else {
      if (this.discretePending.length >= MAX_DISCRETE) this.flushPending();
      this.discretePending.push({ topic, event });
    }
    this.scheduleFlush();
  }

  scheduleFlush() {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    const flush = () => this.flushPending();
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flush);
    else setTimeout(flush, 16);
  }

  flushPending() {
    this.flushScheduled = false;
    const events = [...this.pending.values(), ...this.discretePending]
      .sort((a, b) => a.event.sequence - b.event.sequence);
    this.pending.clear();
    this.discretePending.length = 0;
    for (const item of events) {
      try { this.onEvent(item.topic, item.event); } catch (error) {
        this.onDiagnostic('event-handler-error');
        console.error('[ForgeSense] live event handler failed', error);
      }
    }
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) this.socket.send('\n');
    }, 10000);
  }

  stopHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  scheduleReconnect() {
    if (this.stopped || this.timer) return;
    this.attempt += 1;
    const delay = Math.min(this.reconnectBaseDelay * (2 ** Math.min(this.attempt - 1, 5)), this.reconnectMaxDelay);
    this.setState(ConnectionState.RECONNECTING, { attempt: this.attempt, delay });
    this.timer = setTimeout(() => {
      this.timer = null;
      this.connect().catch(() => {});
    }, delay);
  }

  disconnect() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.stopHeartbeat();
    this.pending.clear();
    this.discretePending.length = 0;
    const socket = this.socket;
    this.socket = null;
    this.connectResolve = null;
    this.connectReject = null;
    this.connectPromise = null;
    if (socket && socket.readyState < WebSocket.CLOSING) {
      try { socket.close(); } catch { /* already closing */ }
    }
    this.setState(ConnectionState.CLOSED);
  }

  isConnected() { return this.state === ConnectionState.OPEN; }
}

let singleton = null;

export function getRealtimeClient(options) {
  if (!singleton) singleton = new StompRealtimeClient(options);
  return singleton;
}

export function destroyRealtimeClient() {
  singleton?.disconnect();
  singleton = null;
}
