package com.forgesense.websocket;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

import java.util.concurrent.atomic.AtomicLong;

/**
 * Broadcasts typed events to all connected STOMP clients.
 * Every notify is guarded to never kill the caller even if no client is active.
 */
@Component
public class WsNotifier {

    private static final Logger log = LoggerFactory.getLogger(WsNotifier.class);

    private final SimpMessagingTemplate template;
    private final AtomicLong connections = new AtomicLong(0);

    public WsNotifier(SimpMessagingTemplate template) {
        this.template = template;
    }

    /**
     * Broadcast to the ForgeSense event topic namespace:
     * /topic/{eventTopic}  (e.g. /topic/machine.updated)
     */
    public void broadcast(String eventTopic, Object payload) {
        try {
            template.convertAndSend("/topic/" + eventTopic, payload);
        } catch (Exception e) {
            log.debug("Ws broadcast to {} failed (likely no clients): {}", eventTopic, e.getMessage());
        }
    }

    public long connections() {
        return connections.get();
    }

    public void increment() {
        connections.incrementAndGet();
    }

    public void decrement() {
        connections.decrementAndGet();
    }
}