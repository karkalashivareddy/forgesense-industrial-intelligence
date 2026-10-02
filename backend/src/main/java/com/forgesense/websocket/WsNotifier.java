package com.forgesense.websocket;

import com.forgesense.observability.ForgeMetrics;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.messaging.SessionConnectedEvent;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

import java.util.concurrent.atomic.AtomicLong;
import java.util.Map;
import java.util.UUID;
import java.time.Instant;

/**
 * Broadcasts typed events to all connected STOMP clients.
 * Every notify is guarded to never kill the caller even if no client is active.
 *
 * Owns the active-connection count. `SessionConnectedEvent` is the single
 * source of truth: it fires exactly once per established STOMP session, after
 * the CONNECT frame is accepted. `SessionConnectEvent` fires earlier and can be
 * followed by a rejection (bad token, no principal), which would permanently
 * leak a phantom connection. Counting on both events doubled the gauge and
 * drifted upward on every reconnect, so the count is read only from
 * `SessionConnectedEvent` and only `SessionDisconnectEvent` decrements it.
 */
@Component
public class WsNotifier {

    private static final Logger log = LoggerFactory.getLogger(WsNotifier.class);

    private final SimpMessagingTemplate template;
    private final ForgeMetrics metrics;
    private final AtomicLong connections = new AtomicLong(0);
    private final AtomicLong sequence = new AtomicLong(0);

    public WsNotifier(SimpMessagingTemplate template, ForgeMetrics metrics) {
        this.template = template;
        this.metrics = metrics;
    }

    @EventListener
    public void onConnect(SessionConnectedEvent event) {
        connections.incrementAndGet();
        metrics.setWebsocketConnections(connections.get());
    }

    @EventListener
    public void onDisconnect(SessionDisconnectEvent event) {
        decrement();
    }

    /**
     * Broadcast to the ForgeSense event topic namespace:
     * /topic/{eventTopic}  (e.g. /topic/machine.updated)
     */
    public void broadcast(String eventTopic, Object payload) {
        try {
            template.convertAndSend("/topic/" + eventTopic,
                    new RealtimeEvent(eventTopic, UUID.randomUUID().toString(), assetId(payload),
                            Instant.now(), sequence.incrementAndGet(), payload));
        } catch (Exception e) {
            log.debug("Ws broadcast to {} failed (likely no clients): {}", eventTopic, e.getMessage());
        }
    }

    private static String assetId(Object payload) {
        if (!(payload instanceof Map<?, ?> map)) return null;
        Object value = map.containsKey("assetId") ? map.get("assetId") : map.get("machineId");
        return value == null ? null : String.valueOf(value);
    }

    public long connections() {
        return connections.get();
    }

    /** Clamped decrement, so a duplicate disconnect can never drive the gauge negative. */
    public void decrement() {
        connections.updateAndGet(current -> current > 0 ? current - 1 : 0);
        metrics.setWebsocketConnections(connections.get());
    }
}
