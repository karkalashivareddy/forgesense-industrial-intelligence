package com.forgesense.security;

import io.jsonwebtoken.Claims;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/** Creates the same authenticated principal for HTTP and STOMP JWT requests. */
@Component
public class JwtAuthenticationFactory {

    private final JwtService jwtService;

    public JwtAuthenticationFactory(JwtService jwtService) {
        this.jwtService = jwtService;
    }

    public UsernamePasswordAuthenticationToken fromBearerHeader(String header) {
        if (header == null || !header.startsWith("Bearer ")) {
            throw new IllegalArgumentException("Bearer token required");
        }
        return fromToken(header.substring(7));
    }

    public UsernamePasswordAuthenticationToken fromToken(String token) {
        if (token == null || token.isBlank()) {
            throw new IllegalArgumentException("JWT token required");
        }
        Claims claims = jwtService.parse(token);
        String username = claims.getSubject();
        if (username == null || username.isBlank()) {
            throw new IllegalArgumentException("JWT subject required");
        }
        List<SimpleGrantedAuthority> authorities = new ArrayList<>();
        Object rawRoles = claims.get("roles");
        if (rawRoles instanceof List<?> roles) {
            for (Object role : roles) {
                if (role != null && !String.valueOf(role).isBlank()) {
                    authorities.add(new SimpleGrantedAuthority(String.valueOf(role)));
                }
            }
        }
        return new UsernamePasswordAuthenticationToken(username, null, authorities);
    }
}
