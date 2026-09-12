package com.forgesense.observability;

import com.forgesense.prediction.MlGateway;
import org.springframework.boot.health.contributor.Health;
import org.springframework.boot.health.contributor.HealthIndicator;
import org.springframework.stereotype.Component;

/**
 * Actuator health indicator reflecting real ML service availability
 * (probed every 15s by MlGateway). The readiness group includes mlService.
 */
@Component("mlService")
public class MlHealthIndicator implements HealthIndicator {

    private final MlGateway mlGateway;

    public MlHealthIndicator(MlGateway mlGateway) {
        this.mlGateway = mlGateway;
    }

    @Override
    public Health health() {
        if (mlGateway.mlAvailable()) {
            return Health.up().withDetail("mode", "MODEL")
                    .withDetail("version", mlGateway.anomalyModelVersion()).build();
        }
        return Health.down().withDetail("mode", "HEURISTIC")
                .withDetail("reason", "ML service not reachable — heuristic scorer active").build();
    }
}