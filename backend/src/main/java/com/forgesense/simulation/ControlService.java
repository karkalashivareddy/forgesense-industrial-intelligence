package com.forgesense.simulation;

import com.forgesense.common.errors.ApiException;
import com.forgesense.events.EventLogService;
import com.forgesense.machine.domain.Machine;
import com.forgesense.machine.domain.MachineState;
import com.forgesense.machine.twin.MachineTwin;
import com.forgesense.machine.twin.TwinService;
import com.forgesense.simulation.domain.ScenarioType;
import com.forgesense.simulation.domain.SimulationControl;
import com.forgesense.streaming.EventBus;
import com.forgesense.common.domain.EventEnvelope;
import com.forgesense.common.domain.EventType;
import com.forgesense.websocket.WsNotifier;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * Simulation Control Center. Every operator command here actually changes
 * state consumed by the simulator, the digital twin, and the UI:
 *  - scenario controls steer the telemetry simulator
 *  - pause/resume gate the whole stream
 *  - reset re-seeds machine state to baseline.
 */
@Service
public class ControlService {

    private final SimulationControlRepository controlRepository;
    private final com.forgesense.machine.MachineRepository machineRepository;
    private final TwinService twinService;
    private final EventBus eventBus;
    private final EventLogService eventLogService;
    private final WsNotifier ws;
    private final SystemState systemState;

    public ControlService(SimulationControlRepository controlRepository,
                          com.forgesense.machine.MachineRepository machineRepository,
                          TwinService twinService, EventBus eventBus,
                          EventLogService eventLogService, WsNotifier ws,
                          SystemState systemState) {
        this.controlRepository = controlRepository;
        this.machineRepository = machineRepository;
        this.twinService = twinService;
        this.eventBus = eventBus;
        this.eventLogService = eventLogService;
        this.ws = ws;
        this.systemState = systemState;
    }

    @Transactional
    public SimulationControl applyScenario(String machineId, ScenarioType scenario, double severity,
                                           Map<String, Object> parameters) {
        machineRepository.findByMachineId(machineId)
                .orElseThrow(() -> ApiException.notFound("Unknown machine: " + machineId));
        SimulationControl control = controlRepository.findByMachineId(machineId)
                .orElseGet(() -> {
                    SimulationControl c = new SimulationControl();
                    c.setMachineId(machineId);
                    return c;
                });
        control.setScenario(scenario);
        control.setSeverity(clamp01(severity));
        control.setActive(scenario != ScenarioType.NONE);
        control.setStartedAt(Instant.now());
        control.setUpdatedAt(Instant.now());
        if (parameters != null) {
            try {
                control.setParametersJson(new tools.jackson.databind.ObjectMapper().writeValueAsString(parameters));
            } catch (Exception ignored) {
            }
        }
        controlRepository.save(control);

        eventBus.publish(EventEnvelope.of(EventType.SIMULATION_STARTED, machineId, "operator",
                Map.of("scenario", scenario.name(), "severity", severity, "active", control.isActive())));
        eventLogService.append("SIMULATION_STARTED", machineId, "operator",
                "Scenario applied: " + scenario + " (" + Math.round(severity * 100) + "%)", null);
        ws.broadcast("simulation.control.updated", Map.of(
                "machineId", machineId, "scenario", scenario.name(), "active", control.isActive()));
        return control;
    }

    @Transactional
    public void clearScenario(String machineId) {
        applyScenario(machineId, ScenarioType.NONE, 0.0, null);
    }

    @Transactional
    public void clearAll() {
        List<SimulationControl> all = controlRepository.findAll();
        all.forEach(c -> applyScenario(c.getMachineId(), ScenarioType.NONE, 0.0, null));
    }

    public SimulationControl controlFor(String machineId) {
        return controlRepository.findByMachineId(machineId)
                .orElseGet(() -> {
                    SimulationControl c = new SimulationControl();
                    c.setMachineId(machineId);
                    return c;
                });
    }

    public List<SimulationControl> activeControls() {
        return controlRepository.findByActiveTrue();
    }

    public void setPaused(boolean paused) {
        systemState.setPaused(paused);
        eventLogService.append(paused ? "SIMULATION_PAUSED" : "SIMULATION_RESUMED", null, "operator",
                paused ? "Telemetry stream paused" : "Telemetry stream resumed", null);
        ws.broadcast("simulation.global.updated", Map.of("paused", paused));
    }

    public boolean paused() {
        return systemState.isPaused();
    }

    /** Factory reset: pause inputs, clear controls, normalize every machine. */
    @Transactional
    public int resetFactory() {
        clearAll();
        machineRepository.findAll().forEach(m -> {
            MachineTwin twin = twinService.twin(m.getMachineId());
            MachineState target = MachineState.NORMAL;
            MachineState previous = twin.getStatus();
            if (previous != target) {
                try {
                    twinService.emitStateChanged(twin, previous,
                            com.forgesense.machine.state.MachineStateMachine.apply(previous, target));
                } catch (IllegalStateException e) {
                    // offline units recover first
                    twinService.emitStateChanged(twin, previous, MachineState.RECOVERING);
                }
            }
            twin.setFailureRisk(0.03);
            twin.setAnomalyScore(0.05);
            twin.setHealthScore(98);
            if (m.getConnectivity() != null && m.getConnectivity().equals("ONLINE")) {
                twin.setConnectivity("ONLINE");
            }
            twinService.persistBudgets(twin);
        });
        eventLogService.append("FACTORY_RESET", null, "operator", "Factory Alpha reset to nominal baseline", null);
        ws.broadcast("simulation.global.updated", Map.of("reset", true));
        return (int) machineRepository.count();
    }

    private static double clamp01(double v) {
        return Math.max(0.0, Math.min(1.0, v));
    }
}