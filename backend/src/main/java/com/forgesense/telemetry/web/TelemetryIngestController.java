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
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
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
    @PreAuthorize("hasAnyRole('OPERATOR','ENGINEER','ADMIN')")
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
    @PreAuthorize("hasAnyRole('OPERATOR','ENGINEER','ADMIN')")
    public Map<String, Object> ingestBatch(@RequestBody List<TelemetrySample> batch) {
        int accepted = 0;
        List<Map<String, Object>> rejected = new ArrayList<>();
        for (int i = 0; i < batch.size(); i++) {
            TelemetrySample s = batch.get(i);
            Optional<String> rejection = validator.validate(s, Instant.now());
            if (rejection.isEmpty()) {
                eventBus.publish(EventEnvelope.of(EventType.TELEMETRY_RECEIVED, s.machineId(),
                        "simulator-http", payload(normalizer.normalize(s))));
                accepted++;
            } else {
                /*
                 * Rejections are reported per sample rather than silently
                 * discarded. A caller that sent 18 records and received
                 * `{received: 18, accepted: 12}` with no explanation had no way
                 * to tell a deliberate filter from a broken pipeline, and a
                 * partial ingest that looks identical to a successful one.
                 */
                rejected.add(Map.of("index", i,
                        "machineId", s == null ? null : s.machineId(),
                        "reason", rejection.get()));
            }
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("received", batch.size());
        result.put("accepted", accepted);
        result.put("rejected", rejected.size());
        result.put("rejections", rejected);
        return result;
    }

    @GetMapping("/status")
    public Map<String, Object> status() {
        Instant from = Instant.now().minusSeconds(60);
        boolean kafka = props.streaming().kafka().enabled();
        long recent = telemetryRepository.countByTimestampAfter(from);
        /*
         * One transport name, one meaning.
         *
         * This endpoint previously reported `transport: "REST_POLL"` and
         * `inputTransport: "IN_PROCESS"` for the same running configuration,
         * because it reused a client-side delivery label to describe a
         * server-side ingestion path. A console reading both fields had no way
         * to tell which one it was being told, which is exactly the
         * contradictory-transport defect the System workspace exists to
         * surface. `transport` now names the inbound path only, and
         * `streaming` reports whether records are arriving at all rather than
         * restating the configured mode as a constant.
         *
         * `pollIntervalSeconds` was a hard-coded 3. There is no configurable
         * poll interval anywhere in the system - clients reconcile over the
         * realtime link - so the field is removed rather than invented.
         */
        return Map.of(
                "inputTransport", kafka ? "KAFKA" : "IN_PROCESS_HTTP_INGEST",
                "streaming", recent > 0,
                "telemetryPerMinute", recent,
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
