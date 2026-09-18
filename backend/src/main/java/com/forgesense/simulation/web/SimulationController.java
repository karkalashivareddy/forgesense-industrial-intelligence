package com.forgesense.simulation.web;

import com.forgesense.machine.MachineService;
import com.forgesense.machine.domain.Machine;
import com.forgesense.simulation.ControlService;
import com.forgesense.simulation.SimulationControlRepository;
import com.forgesense.simulation.SimulationRepository;
import com.forgesense.simulation.SimulationService;
import com.forgesense.simulation.SystemState;
import com.forgesense.simulation.domain.ScenarioType;
import com.forgesense.simulation.domain.SimulationControl;
import com.forgesense.simulation.domain.SimulationScenario;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1")
public class SimulationController {

    private final SimulationService simulationService;
    private final SimulationRepository scenarioRepository;
    private final ControlService controlService;
    private final SimulationControlRepository controlRepository;
    private final MachineService machineService;
    private final SystemState systemState;

    public SimulationController(SimulationService simulationService,
                                SimulationRepository scenarioRepository,
                                ControlService controlService,
                                SimulationControlRepository controlRepository,
                                MachineService machineService,
                                SystemState systemState) {
        this.simulationService = simulationService;
        this.scenarioRepository = scenarioRepository;
        this.controlService = controlService;
        this.controlRepository = controlRepository;
        this.machineService = machineService;
        this.systemState = systemState;
    }

    @GetMapping("/simulation/scenarios")
    public List<Map<String, Object>> scenarios() {
        return scenarioRepository.findTop50ByOrderByCreatedAtDesc().stream()
                .map(SimulationController::scenarioRow).toList();
    }

    @GetMapping("/simulation/scenarios/{id}")
    public Map<String, Object> scenario(@PathVariable UUID id) {
        SimulationScenario s = scenarioRepository.findById(id)
                .orElseThrow(() -> com.forgesense.common.errors.ApiException.notFound("Scenario not found"));
        return scenarioRow(s);
    }

    @PostMapping("/simulation/run")
    @PreAuthorize("hasAnyRole('ENGINEER', 'ADMIN')")
    public Map<String, Object> run(@RequestBody Map<String, Object> body) {
        String machineId = (String) body.get("machineId");
        ScenarioType type = ScenarioType.valueOf((String) body.get("scenarioType"));
        double severity = body.get("severity") instanceof Number n ? n.doubleValue() : 0.6;
        int horizon = body.get("failureHorizonMinutes") instanceof Number n ? n.intValue() : 120;
        String name = (String) body.get("name");
        SimulationScenario result = simulationService.run(
                new SimulationService.ScenarioRequest(name, machineId, type, severity, horizon));
        return scenarioRow(result);
    }

    @PostMapping("/simulation/control")
    @PreAuthorize("hasAnyRole('ENGINEER', 'ADMIN')")
    public SimulationControl applyControl(@RequestBody Map<String, Object> body) {
        String machineId = (String) body.get("machineId");
        ScenarioType type = body.get("scenario") == null ? ScenarioType.NONE
                : ScenarioType.valueOf((String) body.get("scenario"));
        double severity = body.get("severity") instanceof Number n ? n.doubleValue() : 0.6;
        @SuppressWarnings("unchecked")
        Map<String, Object> parameters = (Map<String, Object>) body.get("parameters");
        return controlService.applyScenario(machineId, type, severity, parameters);
    }

    @PostMapping("/simulation/control/{machineId}/clear")
    @PreAuthorize("hasAnyRole('ENGINEER', 'ADMIN')")
    public Map<String, Object> clear(@PathVariable String machineId) {
        controlService.clearScenario(machineId);
        return Map.of("cleared", true, "machineId", machineId);
    }

    @GetMapping("/simulation/control")
    public List<SimulationControl> controls() {
        return controlRepository.findByActiveTrue();
    }

    @GetMapping("/simulation/control/{machineId}")
    public SimulationControl control(@PathVariable String machineId) {
        return controlService.controlFor(machineId);
    }

    @PostMapping("/simulation/pause")
    @PreAuthorize("hasAnyRole('ENGINEER', 'ADMIN')")
    public Map<String, Object> pause() {
        controlService.setPaused(true);
        return Map.of("paused", true);
    }

    @PostMapping("/simulation/resume")
    @PreAuthorize("hasAnyRole('ENGINEER', 'ADMIN')")
    public Map<String, Object> resume() {
        controlService.setPaused(false);
        return Map.of("paused", false);
    }

    @PostMapping("/simulation/reset")
    @PreAuthorize("hasAnyRole('ENGINEER', 'ADMIN')")
    public Map<String, Object> reset() {
        int machines = controlService.resetFactory();
        return Map.of("reset", true, "machines", machines);
    }

    /** Polled by the telemetry simulator to learn its current scenario config. */
    @GetMapping("/simulator/config")
    public Map<String, Object> simulatorConfig() {
        List<Map<String, Object>> machines = machineService.all().stream()
                .map(m -> {
                    SimulationControl control = controlService.controlFor(m.getMachineId());
                    return Map.<String, Object>of(
                            "machineId", m.getMachineId(),
                            "scenario", control.getScenario().name(),
                            "severity", control.getSeverity(),
                            "active", control.isActive(),
                            "paused", systemState.isPaused());
                }).toList();
        return Map.of("paused", systemState.isPaused(), "machines", machines);
    }

    /** Machine nominal configuration for the simulator (sensors, type, zone). */
    @GetMapping("/simulator/machines")
    public List<Map<String, Object>> simulatorMachines() {
        return machineService.all().stream().map(this::machineRow).toList();
    }

    private Map<String, Object> machineRow(Machine m) {
        return Map.of(
                "machineId", m.getMachineId(),
                "machineType", m.getType().name(),
                "zone", m.getZone().getCode(),
                "sensors", m.getSensors().stream().map(s -> s.name()).toList());
    }

    private static Map<String, Object> scenarioRow(SimulationScenario s) {
        Map<String, Object> m = new java.util.HashMap<>();
        m.put("id", s.getId());
        m.put("name", s.getName());
        m.put("machineId", s.getMachineId());
        m.put("machineName", s.getMachineName());
        m.put("scenarioType", s.getScenarioType().name());
        m.put("severity", s.getSeverity());
        m.put("status", s.getStatus());
        m.put("affectedMachineCount", s.getAffectedMachineCount());
        m.put("affectedMachineIds", s.getAffectedMachineIds());
        m.put("expectedDowntimeMinutes", s.getExpectedDowntimeMinutes());
        m.put("productionLossUnits", s.getProductionLossUnits());
        m.put("result", s.getResult());
        m.put("startedAt", s.getStartedAt() == null ? null : s.getStartedAt().toString());
        m.put("completedAt", s.getCompletedAt() == null ? null : s.getCompletedAt().toString());
        m.put("createdAt", s.getCreatedAt() == null ? null : s.getCreatedAt().toString());
        return m;
    }
}