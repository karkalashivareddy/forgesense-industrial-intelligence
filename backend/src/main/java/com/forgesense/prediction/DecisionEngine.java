package com.forgesense.prediction;

import com.forgesense.alert.AlertService;
import com.forgesense.machine.domain.Criticality;
import com.forgesense.machine.MachineRepository;
import com.forgesense.machine.domain.Machine;
import com.forgesense.machine.domain.MachineState;
import com.forgesense.machine.state.MachineStateMachine;
import com.forgesense.machine.twin.MachineTwin;
import com.forgesense.machine.twin.TwinService;
import com.forgesense.prediction.domain.Assessment;
import com.forgesense.telemetry.domain.TelemetrySample;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * Maps a model prediction to operational state:
 * - computes the machine-status *intent* from risk/anomaly thresholds
 * - validates the transition through the state machine
 * - triggers alerts, impact analysis and maintenance recommendations.
 *
 * This layer answers "what do we DO about the prediction" - it is deliberately
 * separated from ML inference (see docs/SYSTEM_DESIGN.md decision engine).
 */
@Service
public class DecisionEngine {

    private static final Logger log = LoggerFactory.getLogger(DecisionEngine.class);

    private final TwinService twinService;
    private final AlertService alertService;
    private final MachineRepository machineRepository;
    private final com.forgesense.maintenance.MaintenanceService maintenanceService;

    public DecisionEngine(TwinService twinService, AlertService alertService,
                          MachineRepository machineRepository,
                          com.forgesense.maintenance.MaintenanceService maintenanceService) {
        this.twinService = twinService;
        this.alertService = alertService;
        this.machineRepository = machineRepository;
        this.maintenanceService = maintenanceService;
    }

    /** Derive the desired MachineState from model signals. */
    public MachineState intent(MachineTwin twin) {
        double risk = twin.getFailureRisk();
        double anomaly = twin.getAnomalyScore();
        if (risk >= 0.80 || anomaly >= 0.70) return MachineState.CRITICAL;
        if (risk >= 0.50 || anomaly >= 0.45) return MachineState.WARNING;
        if (risk >= 0.30 || anomaly >= 0.25) return MachineState.DEGRADED;
        return MachineState.NORMAL;
    }

    public void evaluate(MachineTwin twin, TelemetrySample sample, Assessment a) {
        MachineState current = twin.getStatus();

        // Machines under maintenance stay in MAINTENANCE until the work order is
        // completed. The automated risk loop would otherwise snap a healthy
        // machine straight back to NORMAL the moment maintenance starts.
        if (current != MachineState.MAINTENANCE) {
            MachineState target = intent(twin);
            if (current != target) {
                try {
                    MachineState from = current;
                    MachineState to = MachineStateMachine.walk(current, target);
                    twin.setStatus(to);
                    twinService.emitStateChanged(twin, from, to);
                    log.info("{} state {} -> {}", twin.getMachineId(), from, to);
                } catch (IllegalStateException ex) {
                    log.debug("State transition rejected for {}: {}", twin.getMachineId(), ex.getMessage());
                }
            }
        }

        // never raise alerts while machine is in maintenance (work in progress)
        if (current == MachineState.MAINTENANCE) {
            return;
        }

        double risk = twin.getFailureRisk();
        boolean critical = risk >= 0.80 || a.anomalyScore() >= 0.70;
        boolean warning = risk >= 0.50 || a.anomalyScore() >= 0.45;

        if (critical) {
            alertService.ensureAlert(twin, com.forgesense.alert.domain.AlertSeverity.CRITICAL, "FAILURE_RISK",
                    "Failure risk threshold crossed for " + twin.getMachineId(),
                    buildDescription(twin, a), a, sample.machineId());
        } else if (warning) {
            alertService.ensureAlert(twin, com.forgesense.alert.domain.AlertSeverity.WARNING, "RISK_ELEVATED",
                    "Elevated failure risk for " + twin.getMachineId(),
                    buildDescription(twin, a), a, sample.machineId());
        }

        // maintenance recommendation when risk high
        machineRepository.findByMachineId(twin.getMachineId()).ifPresent(m -> {
            if (risk >= 0.7) {
                maintenanceService.recommendFromRisk(m, twin);
            }
        });
    }

    private String buildDescription(MachineTwin twin, Assessment a) {
        StringBuilder sb = new StringBuilder();
        sb.append("Machine ").append(twin.getMachineId()).append(" (").append(twin.getMachineType()).append(") ");
        sb.append("failure risk ").append(Math.round(twin.getFailureRisk() * 100)).append("%, ");
        sb.append("anomaly score ").append(Math.round(a.anomalyScore() * 100)).append("% (")
                .append(a.anomalyLabel()).append(").");
        if (!a.factors().isEmpty()) {
            sb.append(" Top contributing factors: ");
            for (int i = 0; i < Math.min(3, a.factors().size()); i++) {
                sb.append(a.factors().get(i).label()).append(" (+")
                        .append(Math.round(a.factors().get(i).contribution() * 100)).append("%), ");
            }
            sb.setLength(sb.length() - 2);
        }
        return sb.toString();
    }
}