package com.forgesense.machine;

import com.forgesense.common.errors.ApiException;
import com.forgesense.factory.domain.ProductionLine;
import com.forgesense.factory.domain.Zone;
import com.forgesense.machine.domain.Machine;
import com.forgesense.machine.domain.MachineDependency;
import com.forgesense.machine.domain.MachineState;
import com.forgesense.machine.twin.MachineTwin;
import com.forgesense.machine.twin.TwinService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;

@Service
public class MachineService {

    private final MachineRepository machineRepository;
    private final MachineDependencyRepository dependencyRepository;
    private final TwinService twinService;

    public MachineService(MachineRepository machineRepository,
                          MachineDependencyRepository dependencyRepository,
                          TwinService twinService) {
        this.machineRepository = machineRepository;
        this.dependencyRepository = dependencyRepository;
        this.twinService = twinService;
    }

    public List<Machine> all() {
        return machineRepository.findAllByOrderByMachineId();
    }

    public Machine machine(String machineId) {
        return machineRepository.findByMachineId(machineId)
                .orElseThrow(() -> ApiException.notFound("Machine not found: " + machineId));
    }

    public MachineTwin twin(String machineId) {
        return twinService.twin(machineId);
    }

    public List<MachineDependency> dependencies() {
        return dependencyRepository.findAllByOrderByCreatedAt();
    }

    public List<MachineDependency> dependenciesOf(String machineId) {
        return dependencyRepository.findByUpstreamMachineId(machineId);
    }

    /** Route a machine through the validated state machine, applying + persisting. */
    @Transactional
    public MachineState transition(String machineId, MachineState target) {
        Machine m = machine(machineId);
        MachineTwin twin = twinService.twin(machineId);
        MachineState from = twin.getStatus();
        MachineState next;
        try {
            next = com.forgesense.machine.state.MachineStateMachine.apply(from, target);
        } catch (IllegalStateException e) {
            if (from == MachineState.OFFLINE && target == MachineState.NORMAL) {
                next = com.forgesense.machine.state.MachineStateMachine.apply(from, MachineState.RECOVERING);
                twinService.emitStateChanged(twin, twin.getStatus(), next);
                twinService.persistBudgets(twin);
                throw ApiException.badRequest("Offline machines must recover before returning to NORMAL.");
            }
            throw ApiException.badRequest("Illegal transition " + from + " -> " + target);
        }
        twinService.emitStateChanged(twin, twin.getStatus(), next);
        twinService.persistBudgets(twin);
        return next;
    }

    /** Used by connectivity monitor: move twin to offline/recovered states. */
    @Transactional
    public void setStatusQuiet(String machineId, MachineState status) {
        MachineTwin twin = twinService.twin(machineId);
        if (twin.getStatus() != status) {
            MachineState from = twin.getStatus();
            twin.setStatus(status);
            twinService.persistBudgets(twin);
            twinService.emitStateChanged(twin, from, status);
        }
    }

    public Map<String, Object> zoneCodes() {
        return Map.of();
    }
}
