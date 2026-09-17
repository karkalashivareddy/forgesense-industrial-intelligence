package com.forgesense.security;

import com.forgesense.common.config.ForgeSenseProperties;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.List;

/**
 * Signs and verifies JWT access tokens. When no explicit secret is configured,
 * demo mode generates a fresh random key at boot; outside demo mode boot fails
 * so a predictable signing key can never be used.
 */
@Service
public class JwtService {

    private static final String DEMO_PLACEHOLDER = "forgesense-demo-jwt-signing-key";
    private final ForgeSenseProperties props;
    private volatile SecretKey cachedKey;

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

    synchronized SecretKey key() {
        if (cachedKey != null) {
            return cachedKey;
        }
        String secret = props.security() == null ? null : props.security().jwtSecret();
        if (secret != null && !secret.isBlank() && !secret.startsWith(DEMO_PLACEHOLDER)) {
            if (secret.length() < 32) {
                if (!props.demoMode()) {
                    throw new IllegalStateException("FORGESENSE_SECURITY_JWT_SECRET must be at least 32 characters outside demo mode");
                }
            } else {
                cachedKey = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
                return cachedKey;
            }
        }
        if (!props.demoMode()) {
            throw new IllegalStateException(
                    "FORGESENSE_SECURITY_JWT_SECRET is not configured; refusing to start outside demo mode with a predictable key");
        }
        // Demo-only: fresh random key per boot so tokens cannot be forged with a known value.
        byte[] bytes = new byte[48];
        new SecureRandom().nextBytes(bytes);
        cachedKey = Keys.hmacShaKeyFor(Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
                .getBytes(StandardCharsets.UTF_8));
        return cachedKey;
    }
}
