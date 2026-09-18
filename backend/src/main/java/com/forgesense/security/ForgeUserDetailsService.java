package com.forgesense.security;

import com.forgesense.common.config.ForgeSenseProperties;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Demo user store. Credentials live in environment variables; roles are
 * fixed for the demo personas (operator/engineer/admin). In production this
 * would delegate to the organization's identity provider.
 */
@Service
public class ForgeUserDetailsService implements UserDetailsService {

    private final Map<String, String> passwords;
    private final PasswordEncoder passwordEncoder;

    public ForgeUserDetailsService(PasswordEncoder passwordEncoder, ForgeSenseProperties props) {
        this.passwordEncoder = passwordEncoder;
        boolean securityEnabled = props.security() == null || props.security().enabled();
        String base = System.getenv("FORGESENSE_DEV_PASSWORD");
        if (securityEnabled && (base == null || base.isBlank()) && !props.demoMode()) {
            throw new IllegalStateException("FORGESENSE_DEV_PASSWORD must be configured when security is enabled outside demo mode");
        }
        if (base == null || base.isBlank()) {
            base = props.demoMode() ? "forgesense-dev" : UUID.randomUUID().toString();
        }
        this.passwords = Map.of(
                "operator", base,
                "engineer", base,
                "admin", base);
    }

    @Override
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        if (!passwords.containsKey(username)) {
            throw new UsernameNotFoundException("Unknown user: " + username);
        }
        List<String> roles = switch (username) {
            case "operator" -> List.of("ROLE_OPERATOR");
            case "engineer" -> List.of("ROLE_OPERATOR", "ROLE_ENGINEER");
            case "admin" -> List.of("ROLE_OPERATOR", "ROLE_ENGINEER", "ROLE_ADMIN");
            default -> List.of();
        };
        return User.withUsername(username)
                .password(passwordEncoder.encode(passwords.get(username)))
                .authorities(roles.toArray(String[]::new))
                .build();
    }

    public List<String> rolesFor(String username) {
        return switch (username) {
            case "operator" -> List.of("ROLE_OPERATOR");
            case "engineer" -> List.of("ROLE_OPERATOR", "ROLE_ENGINEER");
            case "admin" -> List.of("ROLE_OPERATOR", "ROLE_ENGINEER", "ROLE_ADMIN");
            default -> List.of();
        };
    }
}
