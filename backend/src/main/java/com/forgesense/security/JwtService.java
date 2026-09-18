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
 * Signs and verifies JWT access tokens. Secure profiles require an explicit
 * environment-provided secret. In demo/security-disabled profiles a fresh
 * random key is generated at boot so no reusable credential is shipped.
 */
@Service
public class JwtService {

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

private SecretKey key() {
        if (cachedKey != null) {
            return cachedKey;
        }
        String secret = props.security() == null ? null : props.security().jwtSecret();
        boolean securityEnabled = props.security() == null || props.security().enabled();
        if (secret != null && secret.length() >= 32) {
            cachedKey = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
            return cachedKey;
        }
        if (securityEnabled && !props.demoMode()) {
            throw new IllegalStateException(
                    "FORGESENSE_SECURITY_JWT_SECRET must be at least 32 characters when security is enabled outside demo mode");
        }
        // Demo-only: fresh random key per boot so tokens cannot be forged with a known value.
        cachedKey = randomKey();
        return cachedKey;
    }

    private SecretKey randomKey() {
        byte[] bytes = new byte[48];
        new SecureRandom().nextBytes(bytes);
        return Keys.hmacShaKeyFor(Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
                .getBytes(StandardCharsets.UTF_8));
    }
}
