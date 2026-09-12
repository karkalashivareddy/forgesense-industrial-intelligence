package com.forgesense.simulation;

import com.forgesense.events.EventLogService;
import com.forgesense.impact.ImpactEngine;
import com.forgesense.impact.domain.ProductionImpact;
import com.forgesense.observability.ForgeMetrics;
import com.forgesense.simulation.domain.ScenarioType;
import com.forgesense.simulation.domain.SimulationScenario;
import com.forgesense.websocket.WsNotifier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * What-if simulation engine. Runs a scenario against the dependency graph and
 * compares BASELINE vs SCENARIO. Every figure is an estimate with transparent
 * assumptions (see docs/SIMULATION.md).
 */
@Service
public class SimulationService {

    private static final Logger log = LoggerFactory.getLogger(SimulationService.class);

    private final SimulationRepository scenarioRepository;
    private final com.forgesense.simulation.SimulationControlRepository controlRepository;
    private final ImpactEngine impactEngine;
    private final EventLogService eventLogService;
    private final WsNotifier ws;
    private final ForgeMetrics metrics;
    private final com.forgesense.machine.MachineRepository machineRepository;

    public SimulationService(SimulationRepository scenarioRepository,
                             SimulationControlRepository controlRepository,
                             ImpactEngine impactEngine,
                             EventLogService eventLogService,
                             WsNotifier ws,
                             ForgeMetrics metrics,
                             com.forgesense.machine.MachineRepository machineRepository) {
        this.scenarioRepository = scenarioRepository;
        this.controlRepository = controlRepository;
        this.impactEngine = impactEngine;
        this.eventLogService = eventLogService;
        this.ws = ws;
        this.metrics = metrics;
        this.machineRepository = machineRepository;
    }

    public record ScenarioRequest(String name, String machineId, ScenarioType scenarioType,
                                  double severity, int failureHorizonMinutes) {}

    @Transactional
    public SimulationScenario run(ScenarioRequest request) {
        String machineName = machineRepository.findByMachineId(request.machineId())
                .map(m -> m.getName()).orElse(request.machineId());
        double severity = clamp01(request.severity());

        String impactType = switch (request.scenarioType()) {
            case MACHINE_OFFLINE -> "OFFLINE";
            case OVERHEATING -> "OVERHEATING";
            case BEARING_FAILURE, VIBRATION_SPIKE -> "BEARING_VIBRATION";
            case SENSOR_FAILURE -> "SENSOR_FAILURE";
            case LOAD_INCREASE -> "LOAD_INCREASE";
            case DEGRADATION, RPM_INSTABILITY, CURRENT_SPIKE -> "DEGRADATION";
            case MAINTENANCE -> "MAINTENANCE_DELAY";
            default -> "SCENARIO";
        };

        eventLogService.append("SIMULATION_STARTED", request.machineId(), "operator",
                "Simulation started: " + request.scenarioType() + " on " + request.machineId(), Map.of(
                        "scenario", request.scenarioType().name(), "severity", severity));

        ProductionImpact scenario = impactEngine.computeScenario(request.machineId(), impactType, severity);

        SimulationScenario record = new SimulationScenario();
        record.setName(request.name() == null ? "What-if " + request.scenarioType() : request.name());
        record.setMachineId(request.machineId());
        record.setMachineName(machineName);
        record.setScenarioType(request.scenarioType());
        record.setSeverity(severity);
        record.setFailureHorizonMinutes(request.failureHorizonMinutes());
        record.markRunning();

        Map<String, Object> baseline = baselineView(request.machineId());
        Map<String, Object> scenarioView = scenario == null ? Map.of() : Map.of(
                "estimatedDowntimeMinutes", scenario.getEstimatedDowntimeMinutes(),
                "affectedMachines", scenario.getAffectedMachineIds(),
                "affectedMachineCount", scenario.getAffectedMachineCount(),
                "affectedLines", scenario.getAffectedLines(),
                "throughputLossUnits", scenario.getThroughputLossUnits(),
                "productionLossUnits", scenario.getProductionLossUnits(),
                "criticality", scenario.getCriticality(),
                "assumptions", scenario.getAssumptionsJson());

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("baseline", baseline);
        result.put("scenario", scenarioView);
        result.put("scenarioType", request.scenarioType().name());
        result.put("severity", severity);
        result.put("failureHorizonMinutes", request.failureHorizonMinutes());

        record.setAffectedMachineIds(scenario == null ? List.of() : scenario.getAffectedMachineIds());
        record.setAffectedMachineCount(scenario == null ? 0 : scenario.getAffectedMachineCount());
        record.setExpectedDowntimeMinutes(scenario == null ? 0 : scenario.getEstimatedDowntimeMinutes());
        record.setThroughputLossUnits(scenario == null ? 0 : scenario.getThroughputLossUnits());
        record.setProductionLossUnits(scenario == null ? 0 : scenario.getProductionLossUnits());
        record.setResult(result);
        record.markCompleted();
        scenarioRepository.save(record);

        metrics.simulationCounter().increment();
        eventLogService.append("SIMULATION_COMPLETED", request.machineId(), "backend",
                "Simulation completed: " + (scenario == null ? 0 : scenario.getAffectedMachineCount())
                        + " machines affected", result);
        ws.broadcast("simulation.updated", Map.of(
                "id", record.getId(),
                "machineId", request.machineId(),
                "scenarioType", request.scenarioType().name(),
                "downtimeMinutes", record.getExpectedDowntimeMinutes(),
                "affectedMachineCount", record.getAffectedMachineCount()));

        log.info("Simulation {} on {} → {} machines affected, ~{} min",
                request.scenarioType(), request.machineId(), record.getAffectedMachineCount(),
                record.getExpectedDowntimeMinutes());
        return record;
    }

    private Map<String, Object> baselineView(String machineId) {
        ProductionImpact clean = impactEngine.computeScenario(machineId, "BASELINE", 0.0);
        return Map.of(
                "downtimeMinutes", 0.0,
                "affectedMachines", 0,
                "throughputLossUnits", 0.0,
                "productionLossUnits", 0.0,
                "note", "Normal operation — no failure injected");
    }

    private static double clamp01(double v) {
        return Math.max(0.05, Math.min(1.0, v));
    }

    private static double round1(double v) {
        return Math.round(v * 10.0) / 10.0;
    }
}