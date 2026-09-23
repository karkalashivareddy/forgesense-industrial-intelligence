package com.forgesense.simulation;

import com.forgesense.common.config.ForgeSenseProperties;
import com.forgesense.common.domain.EventEnvelope;
import com.forgesense.common.domain.EventType;
import com.forgesense.machine.MachineRepository;
import com.forgesense.machine.domain.Machine;
import com.forgesense.machine.domain.MachineState;
import com.forgesense.machine.twin.MachineTwin;
import com.forgesense.machine.twin.TwinService;
import com.forgesense.profiles.MachineProfileCatalog;
import com.forgesense.simulation.domain.ScenarioType;
import com.forgesense.simulation.domain.SimulationControl;
import com.forgesense.streaming.EventBus;
import com.forgesense.telemetry.TelemetryRepository;
import com.forgesense.telemetry.domain.TelemetryRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import jakarta.annotation.PostConstruct;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Demo-mode telemetry producer. In dev/a demo deployment the platform must be
 * self-sufficient: control-center commands (scenarios, pause/resume) have to be
 * observable, and the ML pipeline needs live sensor input. This component
 * generates physically-plausible telemetry for every catalog machine and feeds
 * it through the SAME validation -> twin -> persistence -> prediction pipeline
 * as the external simulator, so nothing downstream can tell the difference and
 * every number a dashboard shows is genuinely derived.
 *
 * The producer is self-regulating:
 *  - it honors {@link SystemState#isPaused()} (pause gates the whole stream, and
 *    the connectivity monitor then honestly marks machines STALE -> OFFLINE);
 *  - it honors active {@link SimulationControl}s, applying scenario-specific
 *    sensor signatures and ramping drive level toward the control severity;
 *  - it always matches the machine's current twin status, so an operator state
 *    order is backed by telemetry that justifies it (nominal streams keep a
 *    machine NORMAL, elevated streams keep it WARNING/CRITICAL);
 *  - when an EXTERNAL source (the simulator feed / a real ingest) is already
 *    writing telemetry, the producer steps aside by sequence tracking so the
 *    stream is never double-driven.
 */
@Component
public class DemoTelemetryProducer {

    private static final Logger log = LoggerFactory.getLogger(DemoTelemetryProducer.class);

    private static final long DEFAULT_TICK_MS = 5000L;
    private static final double RAMP_INTERVAL = 0.35;
    private static final double CONTROL_LEVEL_FLOOR = 0.30;

    private final ForgeSenseProperties props;
    private final MachineRepository machineRepository;
    private final TelemetryRepository telemetryRepository;
    private final TwinService twinService;
    private final ControlService controlService;
    private final SystemState systemState;
    private final EventBus eventBus;
    private final MachineProfileCatalog catalog;

    private final Map<String, Double> driveLevel = new ConcurrentHashMap<>();
    private final Map<String, Long> writtenSequence = new ConcurrentHashMap<>();
    private final Map<String, java.util.Random> randoms = new ConcurrentHashMap<>();
    private final Map<String, Double> phase = new ConcurrentHashMap<>();
    private final Map<String, Integer> tickParity = new ConcurrentHashMap<>();

    private final Instant startedAt = Instant.now();

    public DemoTelemetryProducer(ForgeSenseProperties props,
                                 MachineRepository machineRepository,
                                 TelemetryRepository telemetryRepository,
                                 TwinService twinService,
                                 ControlService controlService,
                                 SystemState systemState,
                                 EventBus eventBus,
                                 MachineProfileCatalog catalog) {
        this.props = props;
        this.machineRepository = machineRepository;
        this.telemetryRepository = telemetryRepository;
        this.twinService = twinService;
        this.controlService = controlService;
        this.systemState = systemState;
        this.eventBus = eventBus;
        this.catalog = catalog;
    }

    @PostConstruct
    public void init() {
        log.info("DemoTelemetryProducer started - demoMode={}, tick={}ms", props.demoMode(), DEFAULT_TICK_MS);
    }

    @Scheduled(fixedDelayString = "${forgesense.demo.telemetry-tick-ms:" + DEFAULT_TICK_MS + "}")
    public void tick() {
        if (!props.demoMode()) {
            return;
        }
        if (systemState.isPaused()) {
            return;
        }
        log.info("DemoTelemetryProducer tick running");
        Instant now = Instant.now();
        for (Machine machine : machineRepository.findAllByOrderByMachineId()) {
            String id = machine.getMachineId();
            if (!catalog.knows(id)) {
                continue;
            }
            MachineTwin twin = twinService.twin(id);

            SimulationControl control = controlService.controlFor(id);
            if (control.getScenario() == ScenarioType.MACHINE_OFFLINE) {
                continue;
            }

            // If anything else wrote telemetry since we last did, an external
            // source is driving this machine - step aside and resync.
            TelemetryRecord latest = telemetryRepository.findFirstByMachineIdOrderBySequenceDesc(id);
            long persistedSeq = latest == null ? 0L : latest.getSequence();
            long myLast = writtenSequence.getOrDefault(id, 0L);
            if (persistedSeq > myLast) {
                writtenSequence.put(id, persistedSeq);
                continue;
            }

            double level = nextLevel(id, twin.getStatus(), control);
            long nextSeq = persistedSeq + 1;
            Map<String, Object> payload = sample(machine, level, control, nextSeq, now);
            if (payload == null) {
                continue;
            }
            eventBus.publish(EventEnvelope.of(EventType.TELEMETRY_RECEIVED, id, "demo-producer", payload));
            writtenSequence.put(id, nextSeq);
            if (nextSeq <= 45) {
                log.info("DemoTelemetryProducer emitted seq={} for {}", nextSeq, id);
            }
        }
    }

    private double nextLevel(String machineId, MachineState status, SimulationControl control) {
        double desired = levelForStatus(status);
        if (control.isActive() && control.getScenario() != ScenarioType.NONE) {
            double controlLevel = CONTROL_LEVEL_FLOOR + control.getSeverity() * 0.55;
            if (control.getScenario() == ScenarioType.MAINTENANCE) {
                controlLevel = levelForStatus(MachineState.MAINTENANCE);
            }
            desired = Math.max(desired, Math.min(controlLevel, 0.90));
        }
        double current = driveLevel.getOrDefault(machineId, levelForStatus(MachineState.NORMAL));
        double next = current + (desired - current) * RAMP_INTERVAL;
        driveLevel.put(machineId, next);
        return next;
    }

    private static double levelForStatus(MachineState status) {
        if (status == null) {
            return 0.05;
        }
        return switch (status) {
            case CRITICAL -> 0.85;
            case WARNING -> 0.60;
            case DEGRADED -> 0.30;
            case RECOVERING -> 0.18;
            case MAINTENANCE -> 0.05;
            default -> 0.05;
        };
    }

    /**
     * Build a telemetry payload for one machine tick. Returns null when the
     * machine should stay silent this tick (offline scenario).
     */
    private Map<String, Object> sample(Machine machine, double level,
                                       SimulationControl control, long sequence, Instant now) {
        String id = machine.getMachineId();
        Map<String, Object> payload = new HashMap<>();
        payload.put("machineId", id);
        payload.put("machineType", machine.getType().name());
        payload.put("timestamp", now);
        payload.put("sequence", sequence);
        payload.put("operatingHours", Math.round((machine.getOperatingHours()
                + Duration.between(startedAt, now).toMillis() / 3600_000.0) * 100.0) / 100.0);

        ScenarioType scenario = control.isActive() ? control.getScenario() : ScenarioType.NONE;
        String failingSensor = failingSensor(id, scenario);
        double timeSeconds = Duration.between(startedAt, now).toMillis() / 1000.0;
        double parity = tickParity.merge(id, 1, (a, b) -> a + 1) % 2 == 0 ? 1.0 : -1.0;

        for (String key : catalog.sensorNames(id)) {
            if (key.equals(failingSensor)) {
                continue;
            }
            MachineProfileCatalog.SensorProfile sensor = catalog.sensor(id, key).orElse(null);
            if (sensor == null) {
                continue;
            }
            double seasonal = Math.sin(timeSeconds / 17.0 + phase.computeIfAbsent(id, k -> (double) (k.hashCode() % 360))) * 0.20;
            double noise = random(id).nextGaussian() * (0.12 + level);
            double offset = scenarioOffset(key, scenario, level, parity);
            double value = sensor.mean() + noise * sensor.std() + seasonal * sensor.std() * 0.15 + offset * sensor.std();
            value = Math.max(sensor.min(), Math.min(sensor.max(), value));
            payload.put(key, round(value, key));
        }
        return payload;
    }

    private String failingSensor(String machineId, ScenarioType scenario) {
        if (scenario != ScenarioType.SENSOR_FAILURE) {
            return null;
        }
        var sensors = catalog.sensorNames(machineId);
        if (sensors.isEmpty()) {
            return null;
        }
        int idx = Math.floorMod(tickParity.getOrDefault(machineId, 0), sensors.size());
        return sensors.get(idx);
    }

    private static double scenarioOffset(String key, ScenarioType scenario, double level, double parity) {
        if (scenario == ScenarioType.NONE) {
            return 0.0;
        }
        return switch (scenario) {
            case OVERHEATING -> switch (key) {
                case "temperature" -> 2.6 * level;
                case "airTemperature" -> 1.1 * level;
                default -> 0.0;
            };
            case BEARING_FAILURE -> "vibration".equals(key) ? 3.0 * level : 0.0;
            case VIBRATION_SPIKE -> "vibration".equals(key) ? 4.2 * level : 0.0;
            case RPM_INSTABILITY -> "rpm".equals(key) ? 2.5 * level * parity : 0.0;
            case CURRENT_SPIKE -> "current".equals(key) ? 2.5 * level : 0.0;
            case LOAD_INCREASE -> switch (key) {
                case "power" -> 1.6 * level;
                case "rpm" -> 0.9 * level;
                case "current" -> 1.0 * level;
                default -> 0.0;
            };
            case DEGRADATION -> switch (key) {
                case "temperature" -> 1.2 * level;
                case "vibration" -> 1.4 * level;
                default -> 0.0;
            };
            default -> 0.0;
        };
    }

    private java.util.Random random(String machineId) {
        return randoms.computeIfAbsent(machineId, id -> new java.util.Random(id.hashCode() * 31L));
    }

    private static double round(double value, String key) {
        return ("vibration".equals(key) || "airTemperature".equals(key))
                ? Math.round(value * 100.0) / 100.0
                : Math.round(value * 10.0) / 10.0;
    }
}