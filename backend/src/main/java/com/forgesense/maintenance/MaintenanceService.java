package com.forgesense.maintenance;

import com.forgesense.common.errors.ApiException;
import com.forgesense.events.EventLogService;
import com.forgesense.maintenance.domain.MaintenancePriority;
import com.forgesense.maintenance.domain.MaintenanceRecord;
import com.forgesense.maintenance.domain.MaintenanceStatus;
import com.forgesense.machine.domain.Machine;
import com.forgesense.machine.domain.MachineState;
import com.forgesense.machine.state.MachineStateMachine;
import com.forgesense.machine.twin.MachineTwin;
import com.forgesense.machine.twin.TwinService;
import com.forgesense.observability.ForgeMetrics;
import com.forgesense.websocket.WsNotifier;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Maintenance work-order workflow: RECOMMENDED -> SCHEDULED -> ACTIVE -> COMPLETED
 * (or CANCELLED). Starting/Completing moves the machine through the state
 * machine (MAINTENANCE -> RECOVERING) - never applied outside the state rules.
 */
@Service
public class MaintenanceService {

    private final MaintenanceRepository maintenanceRepository;
    private final com.forgesense.machine.MachineRepository machineRepository;
    private final TwinService twinService;
    private final EventLogService eventLogService;
    private final WsNotifier ws;
    private final ForgeMetrics metrics;

    public MaintenanceService(MaintenanceRepository maintenanceRepository,
                              com.forgesense.machine.MachineRepository machineRepository,
                              TwinService twinService, EventLogService eventLogService,
                              WsNotifier ws, ForgeMetrics metrics) {
        this.maintenanceRepository = maintenanceRepository;
        this.machineRepository = machineRepository;
        this.twinService = twinService;
        this.eventLogService = eventLogService;
        this.ws = ws;
        this.metrics = metrics;
    }

    /** Decision-engine hook: create a maintenance recommendation when risk warrants it. */
    @Transactional
    public MaintenanceRecord recommendFromRisk(Machine machine, MachineTwin twin) {
        boolean open = maintenanceRepository.findAll().stream().anyMatch(m ->
                m.getMachineId().equals(machine.getMachineId())
                        && List.of(MaintenanceStatus.RECOMMENDED, MaintenanceStatus.SCHEDULED, MaintenanceStatus.ACTIVE)
                        .contains(m.getStatus()));
        if (open) {
            return null;
        }
        MaintenanceRecord r = new MaintenanceRecord();
        r.setMachineId(machine.getMachineId());
        r.setMachineName(machine.getName());
        r.setTitle("Recommended inspection - " + machine.getMachineId());
        r.setDescription("Model failure risk reached " + Math.round(twin.getFailureRisk() * 100)
                + "%. Recommend technical inspection per operating procedures.");
        r.setRecommendedAction(machine.getType().label() + " - inspect drive assembly, bearings, vibration mounts.");
        r.setPriority(twin.getFailureRisk() >= 0.8 ? MaintenancePriority.URGENT : MaintenancePriority.HIGH);
        r.setStatus(MaintenanceStatus.RECOMMENDED);
        r.setReason("PREDICTED_RISK_" + Math.round(twin.getFailureRisk() * 100));
        r.setAssignedRole("ENGINEER");
        r.setEstimatedDurationMinutes(60);
        r.setSourceType("decision-engine");
        r.setRiskAtCreation(twin.getFailureRisk());
        maintenanceRepository.save(r);

        machine.setMaintenanceStatus(com.forgesense.machine.domain.MaintenanceStatus.REQUIRED);
        machineRepository.save(machine);

        metrics.maintenanceCounter().increment();
        eventLogService.append("MAINTENANCE_CREATED", machine.getMachineId(), "decision-engine",
                "Maintenance recommendation created for " + machine.getMachineId(), Map.of("id", r.getId()));
        ws.broadcast("maintenance.created", Map.of(
                "id", r.getId(), "machineId", machine.getMachineId(),
                "status", r.getStatus().name(), "priority", r.getPriority().name()));
        return r;
    }

    @Transactional
    public MaintenanceRecord schedule(UUID id, Instant scheduledAt) {
        MaintenanceRecord r = require(id);
        if (r.getStatus() != MaintenanceStatus.RECOMMENDED) {
            throw ApiException.badRequest("Only RECOMMENDED maintenance can be scheduled");
        }
        r.setStatus(MaintenanceStatus.SCHEDULED);
        r.setScheduledAt(scheduledAt != null ? scheduledAt : Instant.now().plus(1, ChronoUnit.HOURS));
        maintenanceRepository.save(r);
        machineRepository.findByMachineId(r.getMachineId()).ifPresent(m -> {
            m.setNextMaintenance(r.getScheduledAt());
            m.setMaintenanceStatus(com.forgesense.machine.domain.MaintenanceStatus.SCHEDULED);
            machineRepository.save(m);
        });
        eventLogService.append("MAINTENANCE_SCHEDULED", r.getMachineId(), "operator",
                "Maintenance scheduled", null);
        ws.broadcast("maintenance.updated", toPayload(r));
        return r;
    }

    @Transactional
    public MaintenanceRecord start(UUID id, String operator) {
        MaintenanceRecord r = require(id);
        if (r.getStatus() != MaintenanceStatus.SCHEDULED) {
            throw ApiException.badRequest("Only SCHEDULED maintenance can be started");
        }
        r.setStatus(MaintenanceStatus.ACTIVE);
        r.setStartedAt(Instant.now());
        maintenanceRepository.save(r);

        machineRepository.findByMachineId(r.getMachineId()).ifPresent(m -> {
            MachineTwin twin = twinService.twin(m.getMachineId());
            transitionTo(twin, MachineState.MAINTENANCE, m);
            m.setMaintenanceStatus(com.forgesense.machine.domain.MaintenanceStatus.IN_PROGRESS);
            machineRepository.save(m);
        });
        eventLogService.append("MAINTENANCE_STARTED", r.getMachineId(), operator, "Maintenance in progress", null);
        ws.broadcast("maintenance.updated", toPayload(r));
        return r;
    }

    @Transactional
    public MaintenanceRecord complete(UUID id, String operator, String notes) {
        MaintenanceRecord r = require(id);
        if (r.getStatus() != MaintenanceStatus.ACTIVE) {
            throw ApiException.badRequest("Only ACTIVE maintenance can be completed");
        }
        r.setStatus(MaintenanceStatus.COMPLETED);
        r.setCompletedAt(Instant.now());
        r.setCompletedBy(operator);
        r.setResultSummary(notes);
        maintenanceRepository.save(r);

        machineRepository.findByMachineId(r.getMachineId()).ifPresent(m -> {
            MachineTwin twin = twinService.twin(m.getMachineId());
            transitionTo(twin, MachineState.RECOVERING, m);
            m.setMaintenanceStatus(com.forgesense.machine.domain.MaintenanceStatus.NONE);
            m.setLastMaintenance(Instant.now());
            m.setNextMaintenance(Instant.now().plus(30, ChronoUnit.DAYS));
            machineRepository.save(m);
        });
        eventLogService.append("MAINTENANCE_COMPLETED", r.getMachineId(), operator,
                "Maintenance completed" + (notes == null ? "" : ": " + notes), null);
        ws.broadcast("maintenance.updated", toPayload(r));
        return r;
    }

    @Transactional
    public MaintenanceRecord cancel(UUID id, String operator) {
        MaintenanceRecord r = require(id);
        if (r.getStatus() == MaintenanceStatus.COMPLETED || r.getStatus() == MaintenanceStatus.CANCELLED) {
            throw ApiException.badRequest("Maintenance already finished");
        }
        r.setStatus(MaintenanceStatus.CANCELLED);
        maintenanceRepository.save(r);
        machineRepository.findByMachineId(r.getMachineId()).ifPresent(m -> {
            m.setMaintenanceStatus(com.forgesense.machine.domain.MaintenanceStatus.NONE);
            machineRepository.save(m);
        });
        eventLogService.append("MAINTENANCE_CANCELLED", r.getMachineId(), operator, "Maintenance cancelled", null);
        ws.broadcast("maintenance.updated", toPayload(r));
        return r;
    }

    private void transitionTo(MachineTwin twin, MachineState target, Machine m) {
        MachineState from = twin.getStatus();
        try {
            twinService.emitStateChanged(twin, from, MachineStateMachine.apply(from, target));
        } catch (IllegalStateException e) {
            // state machine may reject weird combos (e.g. OFFLINE -> MAINTENANCE);
            // fall back to a recovery path if maintenance applies from OFFLINE
            if (from == MachineState.OFFLINE) {
                MachineState via = MachineStateMachine.apply(from, MachineState.RECOVERING);
                twinService.emitStateChanged(twin, from, via);
                twinService.emitStateChanged(twin, via, MachineStateMachine.apply(via, target));
            }
        }
    }

    private List<MaintenanceRecord> listAll() {
        return maintenanceRepository.findAllByOrderByCreatedAtDesc();
    }

    public List<MaintenanceRecord> recommendations() {
        return maintenanceRepository.findByStatusOrderByCreatedAtDesc(MaintenanceStatus.RECOMMENDED);
    }

    public List<MaintenanceRecord> active() {
        return maintenanceRepository.findByStatusOrderByCreatedAtDesc(MaintenanceStatus.ACTIVE);
    }

    public List<MaintenanceRecord> all() {
        return listAll();
    }

    private static Map<String, Object> toPayload(MaintenanceRecord r) {
        return Map.of("id", r.getId(), "machineId", r.getMachineId(),
                "status", r.getStatus().name(), "priority", r.getPriority().name());
    }

    private MaintenanceRecord require(UUID id) {
        return maintenanceRepository.findById(id)
                .orElseThrow(() -> ApiException.notFound("Maintenance not found: " + id));
    }
}
