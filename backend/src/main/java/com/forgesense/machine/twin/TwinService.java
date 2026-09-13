package com.forgesense.machine.twin;

import com.forgesense.common.domain.EventEnvelope;
import com.forgesense.common.domain.EventType;
import com.forgesense.machine.MachineRepository;
import com.forgesense.machine.domain.Machine;
import com.forgesense.machine.domain.MachineState;
import com.forgesense.streaming.EventBus;
import com.forgesense.telemetry.domain.TelemetrySample;
import com.forgesense.websocket.WsNotifier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Owns the fleet of machine digital twins. The 3D scene and all dashboards
 * render from these twins, which are updated only as events flow in.
 */
@Service
public class TwinService {

    private static final Logger log = LoggerFactory.getLogger(TwinService.class);

    private final Map<String, MachineTwin> twins = new ConcurrentHashMap<>();
    private final MachineRepository machineRepository;
    private final WsNotifier ws;
    private final EventBus eventBus;

    public TwinService(MachineRepository machineRepository, WsNotifier ws, EventBus eventBus) {
        this.machineRepository = machineRepository;
        this.ws = ws;
        this.eventBus = eventBus;
    }

    private void copyFrom(Machine m, MachineTwin t) {
        t.setName(m.getName());
        t.setMachineType(m.getType().name());
        t.setZoneCode(m.getZone().getCode());
        t.setLineCode(m.getProductionLine().getCode());
        t.setStatus(m.getStatus() != null ? m.getStatus() : MachineState.NORMAL);
        t.setFailureRisk(m.getFailureRisk() == null ? 0.03 : m.getFailureRisk());
        t.setAnomalyScore(m.getAnomalyScore() == null ? 0.05 : m.getAnomalyScore());
        t.setHealthScore(m.getHealthScore() == null ? 98 : m.getHealthScore());
        t.setModelVersion(m.getModelVersion());
    }

    /** Rebuild/refresh the twin shell from the persisted machine. */
    public MachineTwin register(Machine m) {
        return twins.compute(m.getMachineId(), (k, existing) -> {
            MachineTwin t = existing != null ? existing : new MachineTwin(m.getMachineId());
            copyFrom(m, t);
            return t;
        });
    }

    public MachineTwin twin(String machineId) {
        return twins.computeIfAbsent(machineId, id -> {
            Machine m = machineRepository.findByMachineId(id)
                    .orElseThrow(() -> new IllegalArgumentException("Unknown machine: " + id));
            MachineTwin t = new MachineTwin(m.getMachineId());
            copyFrom(m, t);
            return t;
        });
    }

    public List<MachineTwin> all() {
        return List.copyOf(twins.values());
    }

    public MachineTwin applyTelemetry(TelemetrySample sample) {
        MachineTwin t = twin(sample.machineId());
        t.updateSample(sample);
        t.setConnectivity("ONLINE");
        return t;
    }

    /** Persist twin risk/health/status into the Machine entity. */
    public void persistBudgets(MachineTwin twin) {
        machineRepository.findByMachineId(twin.getMachineId()).ifPresent(m -> {
            m.setFailureRisk(twin.getFailureRisk());
            m.setAnomalyScore(twin.getAnomalyScore());
            m.setHealthScore(twin.getHealthScore());
            m.setStatus(twin.getStatus());
            m.setConnectivity(twin.getConnectivity());
            m.setLastTelemetryAt(twin.getLastTelemetryAt());
            m.setModelVersion(twin.getModelVersion());
            machineRepository.save(m);
        });
    }

    public void broadcast(MachineTwin twin) {
        Map<String, Object> payload = new java.util.HashMap<>();
        payload.put("machineId", twin.getMachineId());
        payload.put("name", twin.getName());
        payload.put("status", twin.getStatus().name());
        payload.put("healthScore", twin.getHealthScore());
        payload.put("failureRisk", twin.getFailureRisk());
        payload.put("anomalyScore", twin.getAnomalyScore());
        payload.put("anomalyLabel", twin.getAnomalyLabel());
        payload.put("rulEstimate", twin.getRulEstimate());
        payload.put("connectivity", twin.getConnectivity());
        payload.put("modelMode", twin.getModelMode());
        payload.put("modelVersion", twin.getModelVersion());
        payload.put("lastTelemetryAt", twin.getLastTelemetryAt() == null ? null : twin.getLastTelemetryAt().toString());
        ws.broadcast("machine.updated", payload);
    }

    public void emitStateChanged(MachineTwin twin, MachineState from, MachineState to) {
        eventBus.publish(EventEnvelope.of(EventType.MACHINE_STATE_CHANGED, twin.getMachineId(), "backend",
                Map.of("from", from.name(), "to", to.name())));
        ws.broadcast("machine.state.changed", Map.of(
                "machineId", twin.getMachineId(), "from", from.name(), "to", to.name()));
    }
}