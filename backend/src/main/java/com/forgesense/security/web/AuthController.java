package com.forgesense.security.web;

import com.forgesense.common.config.ForgeSenseProperties;
import com.forgesense.common.errors.ApiException;
import com.forgesense.security.ForgeUserDetailsService;
import com.forgesense.security.JwtService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.LockedException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Issues JWT tokens for the demo personas (operator/engineer/admin).
 * Failed attempts are throttled per client+username to damp brute force.
 */
@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private static final int MAX_FAILED_ATTEMPTS = 5;
    private static final long LOCKOUT_MILLIS = 5 * 60_000L;

    private final AuthenticationManager authenticationManager;
    private final JwtService jwtService;
    private final ForgeUserDetailsService userDetailsService;
    private final ForgeSenseProperties props;
    private final Map<String, int[]> failures = new ConcurrentHashMap<>();

    public AuthController(AuthenticationManager authenticationManager, JwtService jwtService,
                          ForgeUserDetailsService userDetailsService, ForgeSenseProperties props) {
        this.authenticationManager = authenticationManager;
        this.jwtService = jwtService;
        this.userDetailsService = userDetailsService;
        this.props = props;
    }

    private String keyFor(String username, HttpServletRequest request) {
        String ip = request.getRemoteAddr();
        return (username == null ? "?" : username) + "@" + (ip == null ? "?" : ip);
    }

    private void recordFailure(String key) {
        int[] state = failures.computeIfAbsent(key, k -> new int[]{0, 0});
        synchronized (state) {
            state[0]++;
            state[1] = (int) (System.currentTimeMillis() / 1000L);
        }
    }

    private void assertNotLocked(String key) {
        int[] state = failures.get(key);
        if (state == null) return;
        synchronized (state) {
            long ageMs = System.currentTimeMillis() - state[1] * 1000L;
            if (state[0] >= MAX_FAILED_ATTEMPTS && ageMs < LOCKOUT_MILLIS) {
                long retryInSec = (LOCKOUT_MILLIS - ageMs + 999) / 1000;
                throw new ApiException(HttpStatus.TOO_MANY_REQUESTS,
                        "Too many failed attempts — retry in " + retryInSec + "s");
            }
            if (ageMs >= LOCKOUT_MILLIS) {
                failures.remove(key);
            }
        }
    }

    @PostMapping("/login")
    public Map<String, Object> login(@RequestBody Map<String, String> body, HttpServletRequest request) {
        String username = body.get("username");
        String password = body.get("password");
        if (username == null || password == null) {
            throw ApiException.badRequest("username and password are required");
        }
String key = keyFor(username, request);
        assertNotLocked(key);
        try {
            Authentication auth = authenticationManager.authenticate(
                    new UsernamePasswordAuthenticationToken(username, password));
            failures.remove(key);
            String name = auth.getName();
            List<String> roles = userDetailsService.rolesFor(name);
            String token = jwtService.generate(name, roles);
            long expires = props.security() == null ? 86400L : props.security().jwtExpirationSeconds();
            return Map.of(
                    "accessToken", token,
                    "tokenType", "Bearer",
                    "username", name,
                    "roles", roles,
                    "expiresInSeconds", expires);
        } catch (LockedException e) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS,
                    "Too many failed attempts — retry shortly");
        } catch (AuthenticationException e) {
            recordFailure(key);
            throw ApiException.badRequest("invalid username or password");
        }
    }
}