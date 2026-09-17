package com.forgesense.telemetry.web;

import com.forgesense.common.config.ForgeSenseProperties;
import com.forgesense.common.domain.EventEnvelope;
import com.forgesense.common.domain.EventType;
import com.forgesense.common.errors.ApiException;
import com.forgesense.streaming.EventBus;
import com.forgesense.telemetry.TelemetryRepository;
import com.forgesense.telemetry.domain.TelemetrySample;
import com.forgesense.telemetry.validation.TelemetryNormalizer;
import com.forgesense.telemetry.validation.TelemetryValidator;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Telemetry ingest endpoint. In the docker profile the simulator's Kafka
 * producer is the canonical path; this HTTP path is the equivalent dev-mode
 * ingress and a clean fallback for integration tools. Records that fail
 * validation are rejected with a 400 and never pollute the pipeline.
 */
@RestController
@RequestMapping("/api/v1/telemetry")
public class TelemetryIngestController {

    private final EventBus eventBus;
    private final TelemetryValidator validator;
    private final TelemetryNormalizer normalizer;
    private final TelemetryRepository telemetryRepository;
    private final ForgeSenseProperties props;

    public TelemetryIngestController(EventBus eventBus, TelemetryValidator validator,
                                     TelemetryNormalizer normalizer,
                                     TelemetryRepository telemetryRepository,
                                     ForgeSenseProperties props) {
        this.eventBus = eventBus;
        this.validator = validator;
        this.normalizer = normalizer;
        this.telemetryRepository = telemetryRepository;
        this.props = props;
    }

    @PostMapping("/ingest")
    public Map<String, Object> ingest(@RequestBody TelemetrySample sample) {
        Optional<String> rejection = validator.validate(sample, Instant.now());
        if (rejection.isPresent()) {
            throw ApiException.badRequest("Telemetry rejected: " + rejection.get());
        }
        TelemetrySample normalized = normalizer.normalize(sample);
        eventBus.publish(EventEnvelope.of(EventType.TELEMETRY_RECEIVED, sample.machineId(),
                "simulator-http", payload(normalized)));
        return Map.of("accepted", true, "machineId", sample.machineId(),
                "sequence", sample.sequence(), "normalized", true);
    }

    @PostMapping("/ingest/batch")
    public Map<String, Object> ingestBatch(@RequestBody List<TelemetrySample> batch) {
        int accepted = 0;
        for (TelemetrySample s : batch) {
            if (validator.validate(s, Instant.now()).isEmpty()) {
                eventBus.publish(EventEnvelope.of(EventType.TELEMETRY_RECEIVED, s.machineId(),
                        "simulator-http", payload(normalizer.normalize(s))));
                accepted++;
            }
        }
        return Map.of("received", batch.size(), "accepted", accepted);
    }

    @GetMapping("/status")
    public Map<String, Object> status() {
        Instant from = Instant.now().minusSeconds(60);
        boolean kafka = props.streaming().kafka().enabled();
        boolean streaming = kafka;
        String transport = kafka ? "KAFKA" : "REST_POLL";
        return Map.of(
                "streaming", streaming,
                "transport", transport,
                "inputTransport", kafka ? "KAFKA" : "IN_PROCESS",
                "pollIntervalSeconds", 3,
                "telemetryPerMinute", telemetryRepository.countByTimestampAfter(from),
                "source", kafka ? "kafka:forge.telemetry.raw" : "http:ingest,in-memory-bus",
                "dataBasis", props.demoMode() ? "SYNTHETIC" : "OBSERVED");
    }

    private Map<String, Object> payload(TelemetrySample s) {
        Map<String, Object> m = new java.util.HashMap<>();
        m.put("machineId", s.machineId());
        m.put("timestamp", s.timestamp());
        m.put("sequence", s.sequence());
        m.put("temperature", s.temperature());
        m.put("vibration", s.vibration());
        m.put("pressure", s.pressure());
        m.put("rpm", s.rpm());
        m.put("torque", s.torque());
        m.put("current", s.current());
        m.put("voltage", s.voltage());
        m.put("power", s.power());
        m.put("flow", s.flow());
        m.put("frequency", s.frequency());
        m.put("airTemperature", s.airTemperature());
        m.put("operatingHours", s.operatingHours());
        m.put("machineType", s.machineType());
        return m;
    }
}
