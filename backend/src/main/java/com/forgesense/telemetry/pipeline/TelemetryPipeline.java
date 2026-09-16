package com.forgesense.telemetry.pipeline;

import com.forgesense.common.config.ForgeSenseProperties;
import com.forgesense.common.domain.EventEnvelope;
import com.forgesense.common.domain.EventType;
import com.forgesense.events.EventLogService;
import com.forgesense.machine.domain.Machine;
import com.forgesense.machine.MachineRepository;
import com.forgesense.machine.twin.MachineTwin;
import com.forgesense.machine.twin.TwinService;
import com.forgesense.observability.ForgeMetrics;
import com.forgesense.prediction.PredictionService;
import com.forgesense.streaming.EventBus;
import com.forgesense.streaming.EventSink;
import com.forgesense.telemetry.TelemetryRepository;
import com.forgesense.telemetry.domain.TelemetryRecord;
import com.forgesense.telemetry.domain.TelemetrySample;
import com.forgesense.telemetry.validation.TelemetryNormalizer;
import com.forgesense.telemetry.validation.TelemetryValidator;
import com.forgesense.websocket.WsNotifier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;

/**
 * Hot-path pipeline processing inbound telemetry events. Each sample:
 * 1) validate → 2) normalize → 3) update digital twin → 4) persist
 * 5) throttled ML assessment → 6) broadcast live telemetry.
 *
 * Designed as a non-blocking hot path: ML inference is decoupled behind a
 * per-machine throttle, so a backlog of samples does not stall the twin.
 */
@Component
public class TelemetryPipeline implements EventSink {

    private static final Logger log = LoggerFactory.getLogger(TelemetryPipeline.class);

    private final TelemetryRepository telemetryRepository;
    private final TelemetryValidator validator;
    private final TelemetryNormalizer normalizer;
    private final TwinService twinService;
    private final PredictionService predictionService;
    private final EventLogService eventLogService;
    private final EventBus eventBus;
    private final WsNotifier ws;
    private final ForgeMetrics metrics;
    private final ForgeSenseProperties props;
    private final MachineRepository machineRepository;

    public TelemetryPipeline(TelemetryRepository telemetryRepository,
                             TelemetryValidator validator,
                             TelemetryNormalizer normalizer,
                             TwinService twinService,
                             PredictionService predictionService,
                             EventLogService eventLogService,
                             EventBus eventBus, WsNotifier ws,
                             ForgeMetrics metrics,
                             ForgeSenseProperties props,
                             MachineRepository machineRepository) {
        this.telemetryRepository = telemetryRepository;
        this.validator = validator;
        this.normalizer = normalizer;
        this.twinService = twinService;
        this.predictionService = predictionService;
        this.eventLogService = eventLogService;
        this.eventBus = eventBus;
        this.ws = ws;
        this.metrics = metrics;
        this.props = props;
        this.machineRepository = machineRepository;
    }

    @Override
    public void handle(EventEnvelope envelope) {
        try {
            Map<String, Object> data = envelope.getPayload();
            if (data == null) return;
            TelemetrySample raw = toSample(data);
            if (raw == null) return;

            Optional<String> reject = validator.validate(raw, envelope.getTimestamp());
            if (reject.isPresent()) {
                metrics.dropTelemetry();
                return;
            }
            TelemetrySample sample = normalizer.normalize(raw);

            // publish normalized telemetry onward (traceable event chain)
            eventBus.publish(EventEnvelope.of(EventType.TELEMETRY_NORMALIZED, sample.machineId(), "backend",
                    Map.of("sequence", sample.sequence(), "machineId", sample.machineId())));

            var processing = metrics.startProcessing();
            MachineTwin twin = twinService.applyTelemetry(sample);

            // persist telemetry (fast sync; could be async for high volume)
            TelemetryRecord rec = toRecord(sample);
            if (rec != null) {
                telemetryRepository.save(rec);
            }
            metrics.stopProcessing(processing);
            metrics.recordTelemetry();

            // event log — throttled
            eventLogService.appendEnvelope(
                    EventEnvelope.of(EventType.TELEMETRY_RECEIVED, sample.machineId(), "simulator",
                            Map.of("sequence", sample.sequence(), "temperature", sample.temperature(),
                                    "vibration", sample.vibration())));

            // throttled ML inference
            predictionService.assessIfNeeded(sample.machineId(), sample);

            // live WS broadcast
            ws.broadcast("telemetry.updated", Map.of(
                    "machineId", sample.machineId(),
                    "timestamp", sample.timestamp().toString(),
                    "temperature", sample.temperature(),
                    "vibration", sample.vibration(),
                    "rpm", sample.rpm(),
                    "torque", sample.torque(),
                    "current", sample.current(),
                    "pressure", sample.pressure(),
                    "power", sample.power()));

        } catch (Exception e) {
            log.debug("Telemetry processing failed for machine {}: {}", envelope.getMachineId(), e.getMessage());
        }
    }

    TelemetrySample toSample(Map<String, Object> d) {
        try {
            return new TelemetrySample(
                    (String) d.get("machineId"),
                    d.get("timestamp") == null ? Instant.now()
                            : d.get("timestamp") instanceof Instant i ? i
                            : Instant.parse((String) d.get("timestamp")),
                    d.get("sequence") instanceof Number n ? n.longValue() : 0L,
                    toDouble(d.get("temperature")), toDouble(d.get("vibration")),
                    toDouble(d.get("pressure")), toDouble(d.get("rpm")),
                    toDouble(d.get("torque")), toDouble(d.get("current")),
                    toDouble(d.get("voltage")), toDouble(d.get("power")),
                    toDouble(d.get("flow")), toDouble(d.get("frequency")),
                    toDouble(d.get("airTemperature")), toDouble(d.get("operatingHours")));
        } catch (Exception e) {
            return null;
        }
    }

    private TelemetryRecord toRecord(TelemetrySample s) {
        TelemetryRecord r = new TelemetryRecord();
        r.setMachineId(s.machineId());
        r.setTimestamp(s.timestamp());
        r.setSequence(s.sequence());
        r.setTemperature(s.temperature());
        r.setVibration(s.vibration());
        r.setPressure(s.pressure());
        r.setRpm(s.rpm());
        r.setTorque(s.torque());
        r.setCurrent(s.current());
        r.setVoltage(s.voltage());
        r.setPower(s.power());
        r.setFlow(s.flow());
        r.setFrequency(s.frequency());
        return r;
    }

    private static Double toDouble(Object o) {
        if (o == null) return null;
        if (o instanceof Double d) return d;
        if (o instanceof Number n) return n.doubleValue();
        try {
            return Double.parseDouble((String) o);
        } catch (Exception e) {
            return null;
        }
    }
}