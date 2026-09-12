package com.forgesense.prediction;

import tools.jackson.databind.JsonNode;
import com.forgesense.common.config.ForgeSenseProperties;
import com.forgesense.prediction.domain.Assessment;
import com.forgesense.prediction.domain.Prediction;
import com.forgesense.telemetry.domain.TelemetrySample;
import io.micrometer.core.instrument.Timer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.net.URI;
import java.util.ArrayList;
import java.util.List;

/**
 * HTTP client for the FastAPI ML service. Maintains a circuit-style availability
 * flag decaying over time so a down ML service is not hammered on every sample.
 */
@Component
public class HttpMlClient implements MlClient {

    private static final Logger log = LoggerFactory.getLogger(HttpMlClient.class);

    private final RestClient rest;
    private final ForgeSenseProperties props;
    private final Timer inferenceTimer;

    private volatile boolean available = true;
    private final Object availabilityLock = new Object();

    public HttpMlClient(@Qualifier("mlRestClient") RestClient rest, ForgeSenseProperties props,
                        io.micrometer.core.instrument.MeterRegistry registry) {
        this.rest = rest;
        this.props = props;
        this.inferenceTimer = Timer.builder("forgesense.ml.inference.latency")
                .description("ML service inference latency")
                .publishPercentiles(0.5, 0.95, 0.99)
                .register(registry);
    }

    @Override
    public boolean isAvailable() {
        return available;
    }

    @Override
    public Assessment assess(TelemetrySample sample) {
        if (!available) {
            return unavailableHeuristic(sample);
        }
        try {
            JsonNode node = inferenceTimer.record(() ->
                    rest.post().uri("/assess").contentType(MediaType.APPLICATION_JSON)
                            .body(sample).retrieve().body(JsonNode.class));
            return parse(node, sample);
        } catch (Exception e) {
            markUnavailable(e);
            return unavailableHeuristic(sample);
        }
    }

    private Assessment parse(JsonNode n, TelemetrySample sample) {
        if (n == null) {
            return unavailableHeuristic(sample);
        }
        List<Prediction.Factor> factors = new ArrayList<>();
        if (n.has("factors") && n.get("factors").isArray()) {
            for (JsonNode f : n.get("factors")) {
                factors.add(new Prediction.Factor(
                        f.path("feature").asText(),
                        f.path("contribution").asDouble(0),
                        f.path("label").asText(""),
                        f.path("direction").asText("")));
            }
        }
        List<String> recs = new ArrayList<>();
        if (n.has("recommendations") && n.get("recommendations").isArray()) {
            n.get("recommendations").forEach(r -> recs.add(r.asText()));
        }
        return new Assessment(
                sample.machineId(),
                n.path("anomalyScore").asDouble(0),
                n.path("anomalyLabel").asText("NORMAL"),
                n.path("failureRisk").asDouble(0),
                n.path("healthScore").asDouble(100),
                n.path("rulEstimate").asDouble(0),
                n.path("modelVersion").asText(props.ml().failureModelVersion()),
                "MODEL",
                factors,
                recs);
    }

    private Assessment unavailableHeuristic(TelemetrySample sample) {
        throw new MlUnavailableException("ML service unavailable");
    }

    private void markUnavailable(Exception e) {
        if (available) {
            synchronized (availabilityLock) {
                if (available) {
                    available = false;
                    log.warn("ML service unavailable ({}). Falling back to HEURISTIC mode.", e.getMessage());
                }
            }
        }
    }

    public void probe() {
        try {
            JsonNode n = rest.get().uri("/health").retrieve().body(JsonNode.class);
            if (n != null && n.path("status").asText().equals("ok")) {
                synchronized (availabilityLock) {
                    available = true;
                }
            }
        } catch (Exception e) {
            synchronized (availabilityLock) {
                available = false;
            }
        }
    }

    public URI baseUri() {
        return URI.create(props.ml().url());
    }

    public static final class MlUnavailableException extends RuntimeException {
        public MlUnavailableException(String msg) {
            super(msg);
        }
    }
}