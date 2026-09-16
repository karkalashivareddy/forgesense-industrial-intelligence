package com.forgesense.security;

import com.forgesense.common.config.ForgeSenseProperties;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.List;

/**
 * Signs and verifies JWT access tokens. The dev secret comes from config; a
 * fresh key is used when the configured secret is too short so the demo always
 * boots. Tokens carry username + roles as claims.
 */
@Service
public class JwtService {

    private final ForgeSenseProperties props;

    public JwtService(ForgeSenseProperties props) {
        this.props = props;
    }

    public String generate(String username, List<String> roles) {
        long expSeconds = props.security() == null ? 86400 : props.security().jwtExpirationSeconds();
        Instant issued = Instant.now();
        Instant expires = issued.plusSeconds(expSeconds);
        return Jwts.builder()
                .subject(username)
                .claim("roles", roles)
                .issuedAt(Date.from(issued))
                .expiration(Date.from(expires))
                .signWith(key())
                .compact();
    }

    public Claims parse(String token) {
        return Jwts.parser().verifyWith(key()).build()
                .parseSignedClaims(token).getPayload();
    }

    private SecretKey key() {
        String secret = props.security() == null ? null : props.security().jwtSecret();
        if (secret == null || secret.length() < 32) {
            if (!props.demoMode()) {
                throw new IllegalStateException("FORGESENSE_SECURITY_JWT_SECRET must be at least 32 characters outside demo mode");
            }
            // Deterministic key is permitted only for the explicitly labeled demo profile.
            secret = "forgesense-demo-jwt-signing-key-do-not-use-in-production-0123456789";
        }
        return Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
    }
}
