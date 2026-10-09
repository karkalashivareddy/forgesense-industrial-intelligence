package com.forgesense.security;

import com.forgesense.common.config.ForgeSenseProperties;
import org.junit.jupiter.api.Test;

import java.security.SecureRandom;
import java.util.Base64;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class JwtServiceTest {

    private ForgeSenseProperties properties(boolean demoMode, String secret) {
        return new ForgeSenseProperties(
                demoMode, null, null, null, null, null, null,
                new ForgeSenseProperties.Security(true, secret, 3600), List.of());
    }

    private String ephemeralStrongSecret() {
        byte[] key = new byte[48];
        new SecureRandom().nextBytes(key);
        return Base64.getEncoder().withoutPadding().encodeToString(key);
    }

    @Test
    void explicitlyConfiguredShortSecretFailsClosedEvenInDemoMode() {
        JwtService service = new JwtService(properties(true, "short-secret"));

        assertThatThrownBy(() -> service.generate("operator", List.of("ROLE_OPERATOR")))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("at least 48 bytes");
    }

    @Test
    void strongConfiguredSecretSignsAndVerifiesToken() {
        JwtService service = new JwtService(properties(false, ephemeralStrongSecret()));

        String token = service.generate("operator", List.of("ROLE_OPERATOR"));

        assertThat(service.parse(token).getSubject()).isEqualTo("operator");
    }

    @Test
    void secureNonDemoModeRejectsMissingSecret() {
        JwtService service = new JwtService(properties(false, ""));

        assertThatThrownBy(() -> service.generate("operator", List.of("ROLE_OPERATOR")))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("must be configured");
    }
}
