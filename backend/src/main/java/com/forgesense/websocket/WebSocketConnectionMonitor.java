package com.forgesense.websocket;

import com.forgesense.observability.ForgeMetrics;
import org.springframework.context.ApplicationListener;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.messaging.SessionConnectEvent;
import org.springframework.web.socket.messaging.SessionConnectedEvent;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

/**
 * Tracks active STOMP/WebSocket connections so the WsNotifier counter and the
 * Prometheus gauge (forgesense.websocket.connections) reflect reality.
 */
@Component
public class WebSocketConnectionMonitor
        implements ApplicationListener<org.springframework.context.ApplicationEvent> {

    private final WsNotifier ws;
    private final ForgeMetrics metrics;

    public WebSocketConnectionMonitor(WsNotifier ws, ForgeMetrics metrics) {
        this.ws = ws;
        this.metrics = metrics;
    }

    @Override
    public void onApplicationEvent(org.springframework.context.ApplicationEvent event) {
        if (event instanceof SessionConnectedEvent || event instanceof SessionConnectEvent) {
            ws.increment();
            metrics.setWebsocketConnections(ws.connections());
        } else if (event instanceof SessionDisconnectEvent) {
            ws.decrement();
            metrics.setWebsocketConnections(ws.connections());
        }
    }
}