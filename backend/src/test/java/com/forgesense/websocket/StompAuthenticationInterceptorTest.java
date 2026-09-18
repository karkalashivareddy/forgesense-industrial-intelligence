package com.forgesense.websocket;

import com.forgesense.common.config.ForgeSenseProperties;
import com.forgesense.security.JwtAuthenticationFactory;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.MessageDeliveryException;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;

import java.util.HashMap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class StompAuthenticationInterceptorTest {

    private final JwtAuthenticationFactory factory = mock(JwtAuthenticationFactory.class);
    private final ForgeSenseProperties props = mock(ForgeSenseProperties.class);
    private final StompAuthenticationInterceptor interceptor = new StompAuthenticationInterceptor(factory, props);
    private final MessageChannel channel = mock(MessageChannel.class);

    StompAuthenticationInterceptorTest() {
        when(props.security()).thenReturn(new ForgeSenseProperties.Security(true, "", 86400));
    }

    private Message<byte[]> connect(String authorization) {
        StompHeaderAccessor accessor = StompHeaderAccessor.create(StompCommand.CONNECT);
        if (authorization != null) accessor.setNativeHeader("Authorization", authorization);
        return MessageBuilder.createMessage(new byte[0], accessor.getMessageHeaders());
    }

    @Test
    void validBearerHeaderEstablishesPrincipal() {
        var principal = new UsernamePasswordAuthenticationToken("operator", null);
        when(factory.fromBearerHeader("Bearer token-12345678")).thenReturn(principal);

        Message<?> result = interceptor.preSend(connect("Bearer token-12345678"), channel);

        assertThat(StompHeaderAccessor.wrap(result).getUser()).isSameAs(principal);
    }

    @Test
    void sessionPrincipalIsRestoredForSubsequentSubscribe() {
        var principal = new UsernamePasswordAuthenticationToken("operator", null);
        when(factory.fromBearerHeader("Bearer token-12345678")).thenReturn(principal);

        StompHeaderAccessor connectAccessor = StompHeaderAccessor.create(StompCommand.CONNECT);
        connectAccessor.setSessionId("session-1");
        connectAccessor.setSessionAttributes(new HashMap<>());
        connectAccessor.setNativeHeader("Authorization", "Bearer token-12345678");
        interceptor.preSend(MessageBuilder.createMessage(new byte[0], connectAccessor.getMessageHeaders()), channel);

        StompHeaderAccessor subscribeAccessor = StompHeaderAccessor.create(StompCommand.SUBSCRIBE);
        subscribeAccessor.setSessionId("session-1");
        subscribeAccessor.setSessionAttributes(connectAccessor.getSessionAttributes());
        subscribeAccessor.setDestination("/topic/telemetry.updated");
        Message<?> result = interceptor.preSend(
                MessageBuilder.createMessage(new byte[0], subscribeAccessor.getMessageHeaders()), channel);

        assertThat(StompHeaderAccessor.wrap(result).getUser()).isSameAs(principal);
    }

    @Test
    void invalidTokenIsRejected() {
        when(factory.fromBearerHeader("Bearer invalid-token"))
                .thenThrow(new IllegalArgumentException("invalid"));

        assertThatThrownBy(() -> interceptor.preSend(connect("Bearer invalid-token"), channel))
                .isInstanceOf(MessageDeliveryException.class)
                .hasCauseInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void missingTokenIsRejected() {
        when(factory.fromBearerHeader(null)).thenThrow(new IllegalArgumentException("required"));

        assertThatThrownBy(() -> interceptor.preSend(connect(null), channel))
                .isInstanceOf(MessageDeliveryException.class);
    }

    @Test
    void unauthenticatedSubscribeIsRejected() {
        StompHeaderAccessor accessor = StompHeaderAccessor.create(StompCommand.SUBSCRIBE);
        accessor.setDestination("/topic/telemetry.updated");
        Message<byte[]> message = MessageBuilder.createMessage(new byte[0], accessor.getMessageHeaders());

        assertThatThrownBy(() -> interceptor.preSend(message, channel))
                .isInstanceOf(MessageDeliveryException.class);
    }
}
