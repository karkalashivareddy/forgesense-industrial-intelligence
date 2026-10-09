package com.forgesense.security;

import com.forgesense.common.config.ForgeSenseProperties;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class JwtServiceTest {

    private ForgeSenseProperties properties(boolean demoMode, String secret) {
        return new ForgeSenseProperties(
                demoMode, null, null, null, null, null, null,
                new ForgeSenseProperties.Security(true, secret, 3600), List.of());
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
        String secret = "0123456789abcdef0123456789abcdef0123456789abcdef";
        JwtService service = new JwtService(properties(false, secret));

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
