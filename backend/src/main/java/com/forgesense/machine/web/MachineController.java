package com.forgesense.machine.web;

import com.forgesense.common.errors.ApiException;
import com.forgesense.events.EventRepository;
import com.forgesense.impact.ImpactRepository;
import com.forgesense.impact.domain.ProductionImpact;
import com.forgesense.machine.MachineService;
import com.forgesense.machine.domain.Machine;
import com.forgesense.machine.domain.MachineDependency;
import com.forgesense.machine.domain.MachineState;
import com.forgesense.machine.domain.SensorType;
import com.forgesense.machine.twin.MachineTwin;
import com.forgesense.prediction.PredictionRepository;
import com.forgesense.prediction.domain.Prediction;
import com.forgesense.telemetry.TelemetryRepository;
import com.forgesense.telemetry.domain.TelemetryRecord;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/machines")
public class MachineController {

    private final MachineService machineService;
    private final PredictionRepository predictionRepository;
    private final TelemetryRepository telemetryRepository;
    private final EventRepository eventRepository;
    private final com.forgesense.machine.MachineDependencyRepository dependencyRepository;
    private final ImpactRepository impactRepository;

    public MachineController(MachineService machineService,
                             PredictionRepository predictionRepository,
                             TelemetryRepository telemetryRepository,
                             EventRepository eventRepository,
                             com.forgesense.machine.MachineDependencyRepository dependencyRepository,
                             ImpactRepository impactRepository) {
        this.machineService = machineService;
        this.predictionRepository = predictionRepository;
        this.telemetryRepository = telemetryRepository;
        this.eventRepository = eventRepository;
        this.dependencyRepository = dependencyRepository;
        this.impactRepository = impactRepository;
    }

    @GetMapping
    public List<Map<String, Object>> list() {
        return machineService.all().stream().map(m -> summary(m, machineService.twin(m.getMachineId()))).toList();
    }

    @GetMapping("/{machineId}")
    public Map<String, Object> get(@PathVariable String machineId) {
        Machine m = machineService.machine(machineId);
        MachineTwin twin = machineService.twin(machineId);
        Map<String, Object> out = new java.util.HashMap<>(summary(m, twin));
        out.put("operatingHours", m.getOperatingHours());
        out.put("throughputPerHour", m.getThroughputPerHour());
        out.put("lastMaintenance", m.getLastMaintenance() == null ? null : m.getLastMaintenance().toString());
        out.put("nextMaintenance", m.getNextMaintenance() == null ? null : m.getNextMaintenance().toString());
        out.put("maintenanceStatus", m.getMaintenanceStatus().name());
        out.put("sensors", m.getSensors().stream().map(s -> s.name()).toList());
        out.put("modelVersion", m.getModelVersion());
        out.put("description", m.getDescription());
        // Map.of rejects null values; a machine seeded without coordinates would
        // have thrown a 500 here instead of reporting a null position.
        Map<String, Object> position = new java.util.LinkedHashMap<>();
        position.put("x", m.getPosX());
        position.put("y", m.getPosY());
        position.put("z", m.getPosZ());
        out.put("position", position);
        return out;
    }

    /**
     * Resolve the machine or fail with a 404.
     *
     * Every sub-resource endpoint below routes through here. They previously
     * queried by machine id alone, so an unknown id returned `200` with an empty
     * collection - indistinguishable from "this machine has no telemetry", which
     * is the `error -&gt; empty` confusion the console is explicitly built to
     * avoid. A wrong id is now an error; a real absence is still an empty list.
     */
    private Machine require(String machineId) {
        return machineService.machine(machineId);
    }

    /**
     * Engineer/Admin operator command: move a machine through the validated
     * state machine. The twin (and persisted machine) actually change state
     * and the move is broadcast over {@code machine.state.changed}; the
     * telemetry/ML loop then reconciles the machine against live signals.
     */
    @PostMapping("/{machineId}/state")
    @ResponseStatus(HttpStatus.OK)
    @PreAuthorize("hasAnyRole('ENGINEER', 'ADMIN')")
    public Map<String, Object> changeState(@PathVariable String machineId,
                                           @RequestBody Map<String, Object> body) {
        Object targetValue = body.get("target") != null ? body.get("target") : body.get("state");
        if (targetValue == null || String.valueOf(targetValue).isBlank()) {
            throw ApiException.badRequest("target state is required");
        }
        MachineState target = parseState(String.valueOf(targetValue));
        MachineTwin twin = machineService.twin(machineId);
        MachineState from = twin.getStatus();
        MachineState next = machineService.transition(machineId, target);

        Map<String, Object> out = new java.util.HashMap<>();
        out.put("machineId", machineId);
        out.put("from", from.name());
        out.put("to", next.name());
        out.put("status", next.name());
        out.put("healthScore", twin.getHealthScore());
        out.put("failureRisk", twin.getFailureRisk());
        out.put("anomalyScore", twin.getAnomalyScore());
        out.put("anomalyLabel", twin.getAnomalyLabel());
        out.put("changedAt", java.time.Instant.now().toString());
        return out;
    }

    private static MachineState parseState(String value) throws ApiException {
        try {
            return MachineState.valueOf(value.toUpperCase());
        } catch (IllegalArgumentException e) {
            throw ApiException.badRequest("Invalid target state: " + value);
        }
    }

    @GetMapping("/{machineId}/telemetry")
    public Map<String, Object> telemetry(@PathVariable String machineId,
                                         @RequestParam(defaultValue = "120") int limit) {
        require(machineId);
        List<Map<String, Object>> rows = telemetryRepository
                .findByMachineIdOrderByTimestampDesc(machineId, PageRequest.of(0, limit))
                .getContent().stream().map(MachineController::telemetryRow).toList();
        return Map.of("machineId", machineId, "rows", rows, "basis", "OBSERVED");
    }

    @GetMapping("/{machineId}/telemetry/range")
    public Map<String, Object> telemetryRange(@PathVariable String machineId,
                                              @RequestParam(defaultValue = "300") int seconds) {
        require(machineId);
        var from = java.time.Instant.now().minusSeconds(seconds);
        List<Map<String, Object>> rows = telemetryRepository
                .findRange(machineId, from, java.time.Instant.now()).stream()
                .map(MachineController::telemetryRow).toList();
        return Map.of("machineId", machineId, "from", from.toString(), "rows", rows, "basis", "OBSERVED");
    }

    private static Map<String, Object> telemetryRow(TelemetryRecord t) {
        Map<String, Object> row = new java.util.HashMap<>();
        row.put("timestamp", t.getTimestamp().toString());
        row.put("sequence", t.getSequence());
        row.put("temperature", t.getTemperature());
        row.put("vibration", t.getVibration());
        row.put("pressure", t.getPressure());
        row.put("rpm", t.getRpm());
        row.put("torque", t.getTorque());
        row.put("current", t.getCurrent());
        row.put("voltage", t.getVoltage());
        row.put("power", t.getPower());
        row.put("flow", t.getFlow());
        row.put("frequency", t.getFrequency());
        row.put("airTemperature", t.getAirTemperature());
        row.put("operatingHours", t.getOperatingHours());
        return row;
    }

    @GetMapping("/{machineId}/predictions")
    public List<Map<String, Object>> predictions(@PathVariable String machineId) {
        require(machineId);
        return predictionRepository.findTop50ByMachineIdOrderByTimestampDesc(machineId).stream()
                .map(MachineController::predictionRow).toList();
    }

    private static Map<String, Object> predictionRow(Prediction p) {
        // `mode` is null-safe by contract, not by optimistic default: a record
        // with no recorded inference mode is reported as UNAVAILABLE, because
        // defaulting it to MODEL would claim a model produced a number it may
        // not have.
        return Map.of(
                "id", p.getId(),
                "machineId", p.getMachineId() == null ? "" : p.getMachineId(),
                "timestamp", p.getTimestamp().toString(),
                "anomalyScore", p.getAnomalyScore(),
                "anomalyLabel", p.getAnomalyLabel() == null ? "LOW" : p.getAnomalyLabel(),
                "failureRisk", p.getFailureRisk(),
                "healthScore", p.getHealthScore(),
                "mode", p.getMode() == null ? "UNAVAILABLE" : p.getMode(),
                "modelVersion", p.getModelVersion() == null ? "none" : p.getModelVersion(),
                "factors", p.getFactors() == null ? List.of() : p.getFactors());
    }

    @GetMapping("/{machineId}/events")
    public List<Map<String, Object>> events(@PathVariable String machineId,
                                            @RequestParam(defaultValue = "50") int limit) {
        require(machineId);
        return eventRepository.findByMachineIdOrderByEventTimeDesc(machineId, PageRequest.of(0, limit))
                .getContent().stream()
                .map(e -> Map.<String, Object>of(
                        "id", e.getId(), "eventType", e.getEventType(),
                        "machineId", e.getMachineId() == null ? "" : e.getMachineId(),
                        "eventTime", e.getEventTime().toString(),
                        "source", e.getSource() == null ? "" : e.getSource(),
                        "detail", e.getDetail() == null ? "" : e.getDetail()))
                .toList();
    }

    /**
     * Baseline-perturbation attribution for one asset.
     *
     * Each factor is enriched with the physical quantity behind it: the sensor
     * key, its engineering unit, and the current observed value. Without these
     * the console could show "Vibration, +0.0031" with no way to answer "of what,
     * by how much, from what baseline" - the three questions an engineer asks
     * first. The unit comes from the shared {@link SensorType} catalog and the
     * value from the latest persisted telemetry row, so both are real
     * observations rather than re-derived guesses.
     */
    @GetMapping("/{machineId}/explanation")
    public Map<String, Object> explanation(@PathVariable String machineId) {
        require(machineId);
        Prediction latest = predictionRepository.findFirstByMachineIdOrderByTimestampDesc(machineId);
        if (latest == null) {
            throw ApiException.notFound("No predictions recorded for " + machineId + " yet");
        }
        return Map.of(
                "machineId", machineId,
                "failureRisk", latest.getFailureRisk(),
                "anomalyScore", latest.getAnomalyScore(),
                "anomalyLabel", latest.getAnomalyLabel() == null ? "LOW" : latest.getAnomalyLabel(),
                "mode", latest.getMode() == null ? "UNAVAILABLE" : latest.getMode(),
                "modelVersion", latest.getModelVersion() == null ? "none" : latest.getModelVersion(),
                "method", "BASELINE_PERTURBATION",
                "factors", enrichFactors(machineId, latest.getFactors()),
                "timestamp", latest.getTimestamp().toString());
    }

    /** Reverse lookup of the ML service's display labels back to a sensor. */
    private static final Map<String, SensorType> LABEL_TO_SENSOR = java.util.Arrays.stream(SensorType.values())
            .collect(java.util.stream.Collectors.toMap(
                    s -> s.name().charAt(0) + s.name().substring(1).toLowerCase(), s -> s, (a, b) -> a));

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> enrichFactors(String machineId, List<Prediction.Factor> factors) {
        if (factors == null || factors.isEmpty()) return List.of();
        TelemetryRecord latest = telemetryRepository
                .findByMachineIdOrderByTimestampDesc(machineId, PageRequest.of(0, 1))
                .getContent().stream().findFirst().orElse(null);

        List<Map<String, Object>> out = new java.util.ArrayList<>();
        for (Prediction.Factor f : factors) {
            Map<String, Object> row = new java.util.LinkedHashMap<>();
            row.put("feature", f.feature());
            row.put("contribution", f.contribution());
            row.put("label", f.label());
            row.put("direction", f.direction());
            SensorType sensor = f.feature() == null ? null : LABEL_TO_SENSOR.get(f.feature());
            if (sensor != null) {
                row.put("sensor", sensor.name());
                row.put("unit", sensor.unit());
                row.put("currentValue", observedValue(latest, sensor));
            }
            out.add(row);
        }
        return out;
    }

    private static Double observedValue(TelemetryRecord t, SensorType sensor) {
        if (t == null) return null;
        return switch (sensor) {
            case TEMPERATURE -> t.getTemperature();
            case VIBRATION -> t.getVibration();
            case PRESSURE -> t.getPressure();
            case RPM -> t.getRpm();
            case TORQUE -> t.getTorque();
            case CURRENT -> t.getCurrent();
            case VOLTAGE -> t.getVoltage();
            case POWER -> t.getPower();
            case FLOW -> t.getFlow();
            case FREQUENCY -> t.getFrequency();
        };
    }

    @GetMapping("/{machineId}/dependencies")
    public List<Map<String, Object>> dependencies(@PathVariable String machineId) {
        require(machineId);
        return dependencyRepository.findByUpstreamMachineId(machineId).stream()
                .map(MachineController::dependencyRow).toList();
    }

    @GetMapping("/dependencies/edge")
    public List<Map<String, Object>> allDependencies() {
        return dependencyRepository.findAllByOrderByCreatedAt().stream()
                .map(MachineController::dependencyRow).toList();
    }

    private static Map<String, Object> dependencyRow(MachineDependency d) {
        return Map.of(
                "id", d.getId(),
                "upstream", d.getUpstream().getMachineId(),
                "downstream", d.getDownstream().getMachineId(),
                "relation", d.getRelationType() == null ? "" : d.getRelationType(),
                "propagationFactor", d.getPropagationFactor(),
                "delayMinutes", d.getDelayMinutes());
    }

    @GetMapping("/{machineId}/impact")
    public List<Map<String, Object>> impacts(@PathVariable String machineId) {
        require(machineId);
        return impactRepository.findTop20ByOriginMachineIdOrderByCreatedAtDesc(machineId).stream()
                .map(i -> Map.<String, Object>of(
                        "id", i.getId(),
                        "originMachineId", i.getOriginMachineId(),
                        "impactType", i.getImpactType() == null ? "" : i.getImpactType(),
                        "simulated", i.isSimulated(),
                        "estimatedDowntimeMinutes", i.getEstimatedDowntimeMinutes(),
                        "affectedMachines", i.getAffectedMachineIds(),
                        "affectedMachineCount", i.getAffectedMachineCount(),
                        "affectedLines", i.getAffectedLines(),
                        "productionLossUnits", i.getProductionLossUnits(),
                        "createdAt", i.getCreatedAt() == null ? null : i.getCreatedAt().toString()))
                .toList();
    }

    private Map<String, Object> summary(Machine m, MachineTwin twin) {
        Map<String, Object> s = new java.util.HashMap<>();
        s.put("machineId", m.getMachineId());
        s.put("name", m.getName());
        s.put("type", m.getType().name());
        s.put("typeLabel", m.getType().label());
        s.put("zone", m.getZone().getCode());
        s.put("line", m.getProductionLine().getCode());
        s.put("status", twin.getStatus().name());
        s.put("connectivity", twin.getConnectivity());
        s.put("healthScore", twin.getHealthScore());
        s.put("failureRisk", twin.getFailureRisk());
        s.put("anomalyScore", twin.getAnomalyScore());
        s.put("anomalyLabel", twin.getAnomalyLabel());
        s.put("rulEstimate", twin.getRulEstimate());
        s.put("rulUnit", "steps");
        s.put("modelMode", twin.getModelMode());
        s.put("modelVersion", twin.getModelVersion());
        s.put("lastTelemetryAt", twin.getLastTelemetryAt() == null ? null : twin.getLastTelemetryAt().toString());
        s.put("criticality", m.getCriticality().name());
        return s;
    }
}
