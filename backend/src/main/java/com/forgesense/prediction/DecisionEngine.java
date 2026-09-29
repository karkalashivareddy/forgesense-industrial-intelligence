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

    /**
     * Human-readable alert narrative.
     *
     * Two unit traps are avoided here deliberately:
     *
     *  1. A factor contribution is a SIGNED delta on model output probability
     *     (see ml-service/app/explanation.py), not a percentage. Rendering it
     *     with a "%" suffix, or concatenating a literal "+" in front of it,
     *     produced text such as "NEUTRAL (+-2%)" for a negative contribution.
     *     It is now formatted with an explicit sign and no percent sign.
     *  2. A probability is formatted with enough precision that a small
     *     non-zero value is never rounded to "0%".
     */
    private String buildDescription(MachineTwin twin, Assessment a) {
        StringBuilder sb = new StringBuilder();
        sb.append("Machine ").append(twin.getMachineId()).append(" (").append(twin.getMachineType()).append(") ");
        sb.append("failure risk ").append(formatProbability(twin.getFailureRisk())).append(", ");
        sb.append("anomaly score ").append(formatProbability(a.anomalyScore()))
                .append(" (").append(a.anomalyLabel()).append(").");
        if (a.factors() != null && !a.factors().isEmpty()) {
            sb.append(" Top contributing factors: ");
            int shown = Math.min(3, a.factors().size());
            for (int i = 0; i < shown; i++) {
                var factor = a.factors().get(i);
                if (i > 0) sb.append(", ");
                sb.append(factor.feature())
                        .append(" (").append(factor.label())
                        .append(" ").append(formatSignedDelta(factor.contribution())).append(")");
            }
            sb.append(".");
        }
        return sb.toString();
    }

    /** Probability in [0,1] with enough precision that small values survive. */
    static String formatProbability(double value) {
        double percent = value * 100.0;
        if (percent == 0.0) return "0%";
        if (Math.abs(percent) < 0.01) return "<0.01%";
        if (Math.abs(percent) < 1.0) return String.format(java.util.Locale.ROOT, "%.3f%%", percent);
        return String.format(java.util.Locale.ROOT, "%.1f%%", percent);
    }

    /**
     * Signed model-output delta. Deliberately carries no percent sign: it is a
     * probability change, not a percentage.
     */
    static String formatSignedDelta(double contribution) {
        if (contribution > 0) {
            return String.format(java.util.Locale.ROOT, "+%.4f", contribution);
        }
        if (contribution < 0) {
            return String.format(java.util.Locale.ROOT, "−%.4f", contribution);
        }
        return "0.0000";
    }
}