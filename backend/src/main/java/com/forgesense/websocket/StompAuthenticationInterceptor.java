package com.forgesense.websocket;

import com.forgesense.common.config.ForgeSenseProperties;
import com.forgesense.security.JwtAuthenticationFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.MessageDeliveryException;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Component;

import java.util.Map;

/** Authenticates JWT carried in the native STOMP CONNECT header. */
@Component
public class StompAuthenticationInterceptor implements ChannelInterceptor {

    private static final String AUTHENTICATION_SESSION_ATTRIBUTE =
            StompAuthenticationInterceptor.class.getName() + ".authentication";

    private final JwtAuthenticationFactory authenticationFactory;
    private final ForgeSenseProperties props;

    public StompAuthenticationInterceptor(JwtAuthenticationFactory authenticationFactory,
                                          ForgeSenseProperties props) {
        this.authenticationFactory = authenticationFactory;
        this.props = props;
    }

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor accessor = StompHeaderAccessor.wrap(message);
        StompCommand command = accessor.getCommand();
        if (command == null) return message;

        if (command == StompCommand.CONNECT || command == StompCommand.STOMP) {
            if (!securityEnabled()) return message;
            String header = accessor.getFirstNativeHeader(HttpHeaders.AUTHORIZATION);
            if (header == null) header = accessor.getFirstNativeHeader("authorization");
            try {
                Authentication authentication = authenticationFactory.fromBearerHeader(header);
                accessor.setUser(authentication);
                Map<String, Object> sessionAttributes = accessor.getSessionAttributes();
                if (sessionAttributes != null) {
                    sessionAttributes.put(AUTHENTICATION_SESSION_ATTRIBUTE, authentication);
                }
            } catch (RuntimeException ex) {
                throw new MessageDeliveryException(message, ex);
            }
        } else if (securityEnabled()) {
            if (accessor.getUser() == null) {
                Map<String, Object> sessionAttributes = accessor.getSessionAttributes();
                Object sessionAuthentication = sessionAttributes == null
                        ? null : sessionAttributes.get(AUTHENTICATION_SESSION_ATTRIBUTE);
                if (sessionAuthentication instanceof Authentication authentication) {
                    accessor.setUser(authentication);
                }
            }
            if ((command == StompCommand.SUBSCRIBE || command == StompCommand.SEND)
                    && accessor.getUser() == null) {
                throw new MessageDeliveryException(message, "Authenticated STOMP session required");
            }
        }
        return MessageBuilder.createMessage(message.getPayload(), accessor.getMessageHeaders());
    }

    private boolean securityEnabled() {
        boolean configured = props.security() == null || props.security().enabled();
        return configured && !"false".equalsIgnoreCase(System.getenv("FORGESENSE_SECURITY_ENABLED"));
    }
}
