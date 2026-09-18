package com.forgesense.common.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;
import java.util.List;
import java.util.Map;

/**
 * Central ForgeSense configuration, bound from application.yml / environment.
 */
@ConfigurationProperties(prefix = "forgesense")
public record ForgeSenseProperties(
        boolean demoMode,
        Ml ml,
        Streaming streaming,
        Telemetry telemetry,
        Machine machine,
        Simulation simulation,
        Cache cache,
        Security security,
        List<String> allowedOrigins
) {

    public record Ml(String url, Duration timeoutMs, String anomalyModelVersion, String failureModelVersion) {}

    public record Streaming(Kafka kafka, Map<String, String> topics) {
        public record Kafka(boolean enabled, String bootstrapServers, String groupId) {}
    }

    public record Telemetry(int maxStalenessSeconds, int maxJitterSeconds, long heartbeatIntervalMs) {}

    public record Machine(int offlineAfterSeconds, long predictEveryMs) {}

    public record Simulation(boolean pollEnabled) {}

    public record Cache(String adapter) {}

    public record Security(boolean enabled, String jwtSecret, long jwtExpirationSeconds) {}
}