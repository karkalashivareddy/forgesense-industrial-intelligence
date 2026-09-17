package com.forgesense.websocket;

import com.forgesense.common.config.ForgeSenseProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;

import java.util.List;

/**
 * Spring WebSocket/STOMP broker. The endpoint accepts cross-origin browser
 * connections; messages are broadcast via WsNotifier to destination prefixes.
 */
@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    private final ForgeSenseProperties props;

    public WebSocketConfig(ForgeSenseProperties props) {
        this.props = props;
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry config) {
        config.enableSimpleBroker("/topic");
        config.setApplicationDestinationPrefixes("/app");
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        List<String> origins = props.allowedOrigins() == null || props.allowedOrigins().isEmpty()
                ? List.of("*") : props.allowedOrigins();
        registry.addEndpoint("/ws", "/ws/telemetry")
                .setAllowedOriginPatterns(origins.toArray(String[]::new))
                .withSockJS();
    }
}