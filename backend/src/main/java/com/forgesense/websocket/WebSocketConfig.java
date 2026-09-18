package com.forgesense.websocket;

import com.forgesense.common.config.ForgeSenseProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;
import org.springframework.security.messaging.context.SecurityContextChannelInterceptor;

import java.util.List;

/**
 * Spring WebSocket/STOMP broker. The endpoint accepts cross-origin browser
 * connections; messages are broadcast via WsNotifier to destination prefixes.
 */
@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    private final ForgeSenseProperties props;
    private final StompAuthenticationInterceptor authenticationInterceptor;

    public WebSocketConfig(ForgeSenseProperties props,
                           StompAuthenticationInterceptor authenticationInterceptor) {
        this.props = props;
        this.authenticationInterceptor = authenticationInterceptor;
    }

    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(authenticationInterceptor, new SecurityContextChannelInterceptor());
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry config) {
        config.enableSimpleBroker("/topic");
        config.setApplicationDestinationPrefixes("/app");
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        List<String> origins = props.allowedOrigins() == null || props.allowedOrigins().isEmpty()
                ? List.of("http://localhost:5173", "http://127.0.0.1:5173") : props.allowedOrigins();
        // The browser transport is a native STOMP WebSocket. Do not add
        // SockJS framing here: SockJS clients require a different protocol
        // adapter and would not be compatible with frontend/js/realtime.js.
        registry.addEndpoint("/ws", "/ws/telemetry")
                .setAllowedOriginPatterns(origins.toArray(String[]::new));
    }
}
