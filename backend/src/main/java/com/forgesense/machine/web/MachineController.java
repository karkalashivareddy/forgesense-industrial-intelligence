package com.forgesense.machine.web;

import com.forgesense.common.errors.ApiException;
import com.forgesense.events.EventRepository;
import com.forgesense.impact.ImpactRepository;
import com.forgesense.impact.domain.ProductionImpact;
import com.forgesense.machine.MachineService;
import com.forgesense.machine.domain.Machine;
import com.forgesense.machine.domain.MachineDependency;
import com.forgesense.machine.twin.MachineTwin;
import com.forgesense.prediction.PredictionRepository;
import com.forgesense.prediction.domain.Prediction;
import com.forgesense.telemetry.TelemetryRepository;
import com.forgesense.telemetry.domain.TelemetryRecord;
import org.springframework.data.domain.PageRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
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
        out.put("position", Map.of("x", m.getPosX(), "y", m.getPosY(), "z", m.getPosZ()));
        return out;
    }

    @GetMapping("/{machineId}/telemetry")
    public Map<String, Object> telemetry(@PathVariable String machineId,
                                         @RequestParam(defaultValue = "120") int limit) {
        List<Map<String, Object>> rows = telemetryRepository
                .findByMachineIdOrderByTimestampDesc(machineId, PageRequest.of(0, limit))
                .getContent().stream().map(MachineController::telemetryRow).toList();
        return Map.of("machineId", machineId, "rows", rows, "basis", "OBSERVED");
    }

    @GetMapping("/{machineId}/telemetry/range")
    public Map<String, Object> telemetryRange(@PathVariable String machineId,
                                              @RequestParam(defaultValue = "300") int seconds) {
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
        return row;
    }

    @GetMapping("/{machineId}/predictions")
    public List<Map<String, Object>> predictions(@PathVariable String machineId) {
        return predictionRepository.findTop50ByMachineIdOrderByTimestampDesc(machineId).stream()
                .map(MachineController::predictionRow).toList();
    }

    private static Map<String, Object> predictionRow(Prediction p) {
        return Map.of(
                "id", p.getId(),
                "machineId", p.getMachineId() == null ? "" : p.getMachineId(),
                "timestamp", p.getTimestamp().toString(),
                "anomalyScore", p.getAnomalyScore(),
                "anomalyLabel", p.getAnomalyLabel() == null ? "LOW" : p.getAnomalyLabel(),
                "failureRisk", p.getFailureRisk(),
                "healthScore", p.getHealthScore(),
                "mode", p.getMode() == null ? "MODEL" : p.getMode(),
                "modelVersion", p.getModelVersion() == null ? "none" : p.getModelVersion(),
                "factors", p.getFactors() == null ? List.of() : p.getFactors());
    }

    @GetMapping("/{machineId}/events")
    public List<Map<String, Object>> events(@PathVariable String machineId,
                                            @RequestParam(defaultValue = "50") int limit) {
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

    @GetMapping("/{machineId}/explanation")
    public Map<String, Object> explanation(@PathVariable String machineId) {
        Prediction latest = predictionRepository.findFirstByMachineIdOrderByTimestampDesc(machineId);
        if (latest == null) {
            throw ApiException.notFound("No predictions recorded for " + machineId + " yet");
        }
        return Map.of(
                "machineId", machineId,
                "failureRisk", latest.getFailureRisk(),
                "anomalyScore", latest.getAnomalyScore(),
                "mode", latest.getMode(),
                "factors", latest.getFactors() == null ? List.of() : latest.getFactors(),
                "timestamp", latest.getTimestamp().toString());
    }

    @GetMapping("/{machineId}/dependencies")
    public List<Map<String, Object>> dependencies(@PathVariable String machineId) {
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
        s.put("modelMode", twin.getModelMode());
        s.put("modelVersion", twin.getModelVersion());
        s.put("lastTelemetryAt", twin.getLastTelemetryAt() == null ? null : twin.getLastTelemetryAt().toString());
        s.put("criticality", m.getCriticality().name());
        return s;
    }
}