package com.forgesense.prediction;

import com.forgesense.common.config.ForgeSenseProperties;
import com.forgesense.prediction.domain.Assessment;
import com.forgesense.prediction.domain.Prediction;
import com.forgesense.telemetry.domain.TelemetrySample;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Routes inference to the FastAPI ML service, transparently degrading to the
 * documented heuristic scorer when the ML service is unavailable (probed
 * periodically by the availability probe).
 */
@Component
public class MlGateway {

    private static final Logger log = LoggerFactory.getLogger(MlGateway.class);

    private final HttpMlClient http;
    private final HeuristicMlClient heuristic;
    private final ForgeSenseProperties props;

    public MlGateway(HttpMlClient http, HeuristicMlClient heuristic, ForgeSenseProperties props) {
        this.http = http;
        this.heuristic = heuristic;
        this.props = props;
    }

    public Assessment assess(TelemetrySample sample) {
        if (http.isAvailable()) {
            try {
                Assessment a = http.assess(sample);
                if (a.mode().equals("MODEL")) {
                    return a;
                }
            } catch (HttpMlClient.MlUnavailableException ignored) {
                // fall through to heuristic
            } catch (Exception e) {
                log.warn("ML assessment failed: {}", e.getMessage());
            }
        }
        return heuristic.assess(sample);
    }

    @Scheduled(fixedDelay = 15_000)
    public void probeRoutine() {
        http.probe();
    }

    public boolean mlAvailable() {
        return http.isAvailable();
    }

    public String anomalyModelVersion() {
        return http.isAvailable() ? http.anomalyModelVersion() : "unavailable";
    }

    public String failureModelVersion() {
        return http.isAvailable() ? http.failureModelVersion() : "unavailable";
    }
}
