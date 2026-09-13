package com.forgesense.prediction;

import com.forgesense.alert.AlertService;
import com.forgesense.alert.domain.AlertSeverity;
import com.forgesense.machine.MachineRepository;
import com.forgesense.machine.domain.Machine;
import com.forgesense.machine.domain.MachineState;
import com.forgesense.machine.twin.MachineTwin;
import com.forgesense.machine.twin.TwinService;
import com.forgesense.maintenance.MaintenanceService;
import com.forgesense.prediction.domain.Assessment;
import com.forgesense.telemetry.domain.TelemetrySample;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class DecisionEngineTest {

    @Mock
    private TwinService twinService;
    @Mock
    private AlertService alertService;
    @Mock
    private MachineRepository machineRepository;
    @Mock
    private MaintenanceService maintenanceService;

    private DecisionEngine engine;
    private final MachineTwin twin = new MachineTwin("M-101");
    private final TelemetrySample sample = TelemetrySample.of("M-101", Instant.now(), 1L,
            70.0, 2.0, 6.2, 1750.0, 30.0, 30.0, 480.0, 14.5, 120.0, 60.0, 22.0, 20000.0);

    @BeforeEach
    void setUp() {
        twin.setStatus(MachineState.NORMAL);
        engine = new DecisionEngine(twinService, alertService, machineRepository, maintenanceService);
    }

    private Assessment assessment(double anomaly, double risk) {
        return new Assessment("M-101", anomaly, "ANOMALY", risk, 40.0, 120.0,
                "failure-risk-v2", "MODEL", List.of(), List.of("Inspect bearings"));
    }

    private static void setRisk(MachineTwin t, double risk, double anomaly) {
        t.setFailureRisk(risk);
        t.setAnomalyScore(anomaly);
    }

    @Test
    void intentMapsSignalBandsToState() {
        setRisk(twin, 0.05, 0.02);
        assertThat(engine.intent(twin)).isEqualTo(MachineState.NORMAL);
        setRisk(twin, 0.40, 0.30);
        assertThat(engine.intent(twin)).isEqualTo(MachineState.DEGRADED);
        setRisk(twin, 0.60, 0.50);
        assertThat(engine.intent(twin)).isEqualTo(MachineState.WARNING);
        setRisk(twin, 0.90, 0.80);
        assertThat(engine.intent(twin)).isEqualTo(MachineState.CRITICAL);
    }

    @Test
    void criticalRiskRaisesCriticalAlert_andRecommendsMaintenance() {
        setRisk(twin, 0.85, 0.10);
        when(machineRepository.findByMachineId("M-101")).thenReturn(Optional.of(new Machine()));
        engine.evaluate(twin, sample, assessment(0.10, 0.85));
        verify(alertService).ensureAlert(eq(twin), eq(AlertSeverity.CRITICAL), eq("FAILURE_RISK"),
                any(), any(), any(), eq("M-101"));
        verify(maintenanceService).recommendFromRisk(any(), any());
    }

    @Test
    void elevatedRiskRaisesWarningAlert() {
        setRisk(twin, 0.55, 0.05);
        when(machineRepository.findByMachineId("M-101")).thenReturn(Optional.empty());
        engine.evaluate(twin, sample, assessment(0.05, 0.55));
        verify(alertService).ensureAlert(eq(twin), eq(AlertSeverity.WARNING), eq("RISK_ELEVATED"),
                any(), any(), any(), eq("M-101"));
        verify(maintenanceService, never()).recommendFromRisk(any(), any());
    }

    @Test
    void riskyMachineStepsUpOneLegalState_andRaisesAlert() {
        // NORMAL -> CRITICAL is not a legal edge; evaluate walks one step (DEGRADED)
        // while still raising the alert for the critical signal
        setRisk(twin, 0.85, 0.10);
        when(machineRepository.findByMachineId("M-101")).thenReturn(Optional.empty());
        engine.evaluate(twin, sample, assessment(0.10, 0.85));
        assertThat(twin.getStatus()).isEqualTo(MachineState.DEGRADED);
        verify(alertService).ensureAlert(eq(twin), eq(AlertSeverity.CRITICAL), eq("FAILURE_RISK"),
                any(), any(), any(), eq("M-101"));
    }

    @Test
    void healthyMachineRaisesNoAlert() {
        setRisk(twin, 0.03, 0.02);
        when(machineRepository.findByMachineId("M-101")).thenReturn(Optional.empty());
        engine.evaluate(twin, sample, assessment(0.02, 0.03));
        verify(alertService, never()).ensureAlert(any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void alertsAreSuppressedDuringMaintenance() {
        twin.setStatus(MachineState.MAINTENANCE);
        setRisk(twin, 0.99, 0.99);
        engine.evaluate(twin, sample, assessment(0.99, 0.99));
        verify(alertService, never()).ensureAlert(any(), any(), any(), any(), any(), any(), any());
    }
}