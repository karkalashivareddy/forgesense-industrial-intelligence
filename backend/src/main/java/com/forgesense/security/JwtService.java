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
import java.util.UUID;

/**
 * Signs and verifies JWT access tokens. Secure profiles require an explicit
 * environment-provided secret. Security-disabled test/dev profiles use an
 * ephemeral in-memory key so no reusable credential is shipped in source.
 */
@Service
public class JwtService {

    private final ForgeSenseProperties props;
    private final SecretKey ephemeralKey = Keys.hmacShaKeyFor(
            UUID.randomUUID().toString().replace("-", "").repeat(2).getBytes(StandardCharsets.UTF_8));

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
        boolean securityEnabled = props.security() == null || props.security().enabled();
        if (secret == null || secret.isBlank()) {
            if (!securityEnabled) return ephemeralKey;
            throw new IllegalStateException("FORGESENSE_JWT_SECRET must be configured when security is enabled");
        }
        if (secret.length() < 32) {
            throw new IllegalStateException("FORGESENSE_JWT_SECRET must contain at least 32 characters");
        }
        return Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
    }
}
