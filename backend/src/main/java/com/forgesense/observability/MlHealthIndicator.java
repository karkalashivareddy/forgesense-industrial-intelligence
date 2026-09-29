package com.forgesense.observability;

import com.forgesense.prediction.MlGateway;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.health.contributor.Health;
import org.springframework.boot.health.contributor.HealthIndicator;
import org.springframework.stereotype.Component;

/**
 * Actuator health indicator reflecting real ML service availability
 * (probed every 15s by MlGateway). The readiness group includes mlService.
 * Profiles where the ML service is optional set forgesense.ml.health-indicator.required=false,
 * so an absent ML service no longer degrades aggregate health.
 */
@Component("mlService")
public class MlHealthIndicator implements HealthIndicator {

    private final MlGateway mlGateway;
    private final boolean required;

    public MlHealthIndicator(MlGateway mlGateway,
            @Value("${forgesense.ml.health-indicator.required:true}") boolean required) {
        this.mlGateway = mlGateway;
        this.required = required;
    }

    @Override
    public Health health() {
        if (mlGateway.mlAvailable()) {
            return Health.up().withDetail("mode", "MODEL")
                    .withDetail("failureModelVersion", mlGateway.failureModelVersion())
                    .withDetail("anomalyModelVersion", mlGateway.anomalyModelVersion()).build();
        }
        if (!required) {
            return Health.up().withDetail("mode", "HEURISTIC")
                    .withDetail("reason", "ML service optional in this profile - heuristic scorer active").build();
        }
        return Health.down().withDetail("mode", "HEURISTIC")
                .withDetail("reason", "ML service not reachable - heuristic scorer active").build();
    }
}
