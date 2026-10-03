# Phase 1 runtime contracts

## Telemetry time

- `timestamp` is the sensor measurement/event timestamp supplied by the
  producer.
- `ingestedAt` is the event-boundary arrival timestamp.
- `processedAt` is the time normalized processing completed.

Freshness and stale-event validation use the measurement `timestamp` compared
with the backend receipt time. A future timestamp is rejected beyond the
configured jitter. Sequence numbers are positive, unique per machine, and
monotonic; duplicates and out-of-order samples are rejected.

## Alerts

The authoritative lifecycle is:

`NEW -> ACKNOWLEDGED -> INVESTIGATING -> RESOLVED`

Open-alert correlation is scoped to machine and alert type. Resolved records
remain queryable as history. Each created alert carries source and a stable
correlation ID.

## Transport and freshness claims

The browser's primary transport is STOMP over WebSocket; the UI reports the
live transport and the connection quality, and it never claims `LIVE` for a
synthetic feed. A REST snapshot poll every 3 s remains the authoritative
reconciliation path and the fallback when the broker is unavailable. Kafka,
when enabled, is an internal backend input transport and is reported
separately.

## Connectivity

`WAITING`, `ONLINE`, `STALE`, and `OFFLINE` describe telemetry connectivity;
the persisted machine state separately records the operational state. Offline
and recovery transitions are written to the machine record, so a process
restart does not silently recreate a healthy in-memory twin.

## Security

JWT security is enabled outside explicit demo mode. Wildcard credentialed CORS
is not allowed, internal actuator details are not exposed anonymously, and
development credentials/signing keys are rejected when demo mode is disabled.
