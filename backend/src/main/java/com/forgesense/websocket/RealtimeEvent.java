package com.forgesense.websocket;

import java.time.Instant;

/** Canonical envelope shared by every outbound STOMP event. */
public record RealtimeEvent(
        String event,
        String eventId,
        String assetId,
        Instant timestamp,
        long sequence,
        Object payload
) {}
