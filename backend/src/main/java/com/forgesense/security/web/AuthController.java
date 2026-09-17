package com.forgesense.security.web;

import com.forgesense.common.config.ForgeSenseProperties;
import com.forgesense.common.errors.ApiException;
import com.forgesense.security.ForgeUserDetailsService;
import com.forgesense.security.JwtService;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * Issues JWT tokens for the demo personas (operator/engineer/admin).
 */
@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private final AuthenticationManager authenticationManager;
    private final JwtService jwtService;
    private final ForgeUserDetailsService userDetailsService;
    private final ForgeSenseProperties props;

    public AuthController(AuthenticationManager authenticationManager, JwtService jwtService,
                          ForgeUserDetailsService userDetailsService, ForgeSenseProperties props) {
        this.authenticationManager = authenticationManager;
        this.jwtService = jwtService;
        this.userDetailsService = userDetailsService;
        this.props = props;
    }

    @PostMapping("/login")
    public Map<String, Object> login(@RequestBody Map<String, String> body) {
        String username = body.get("username");
        String password = body.get("password");
        if (username == null || password == null) {
            throw ApiException.badRequest("username and password are required");
        }
        Authentication auth = authenticationManager.authenticate(
                new UsernamePasswordAuthenticationToken(username, password));
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
    }
}