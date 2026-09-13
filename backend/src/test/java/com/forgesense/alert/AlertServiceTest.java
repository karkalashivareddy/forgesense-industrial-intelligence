package com.forgesense.alert;

import com.forgesense.alert.domain.Alert;
import com.forgesense.alert.domain.AlertSeverity;
import com.forgesense.alert.domain.AlertStatus;
import com.forgesense.events.EventLogService;
import com.forgesense.impact.ImpactEngine;
import com.forgesense.machine.twin.MachineTwin;
import com.forgesense.observability.ForgeMetrics;
import com.forgesense.prediction.domain.Assessment;
import com.forgesense.websocket.WsNotifier;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.invocation.InvocationOnMock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AlertServiceTest {

    @Mock
    private AlertRepository alertRepository;
    @Mock
    private EventLogService eventLogService;
    @Mock
    private WsNotifier ws;
    @Mock
    private ImpactEngine impactEngine;

    private AlertService service;

    @BeforeEach
    void setUp() {
        service = new AlertService(alertRepository, eventLogService, ws,
                new ForgeMetrics(new SimpleMeterRegistry()), impactEngine);
    }

    private MachineTwin twin() {
        MachineTwin t = new MachineTwin("M-101");
        t.setName("Milling cell M-101");
        t.setMachineType("CNC_MILL");
        t.setFailureRisk(0.9);
        return t;
    }

    private Assessment assessment() {
        return new Assessment("M-101", 0.9, "ANOMALY", 0.9, 30.0, 90.0,
                "failure-risk-v2", "MODEL", List.of(), List.of("Inspect bearings"));
    }

    private void assignIdOnSave() {
        when(alertRepository.save(any(Alert.class))).thenAnswer(inv -> {
            Alert saved = inv.getArgument(0);
            if (saved.getId() == null) {
                saved.setId(UUID.randomUUID());
            }
            return saved;
        });
    }

    private Alert openAlert(AlertStatus status) {
        Alert a = new Alert();
        a.setId(UUID.randomUUID());
        a.setMachineId("M-101");
        a.setMachineName("Milling cell M-101");
        a.setMachineType("CNC_MILL");
        a.setSeverity(AlertSeverity.CRITICAL);
        a.setType("FAILURE_RISK");
        a.setHeadline("headline");
        a.setStatus(status);
        return a;
    }

    @Test
    void ensureAlertCreatesNewAlertWhenNoneOpen() {
        when(alertRepository.findFirstByMachineIdAndStatusInOrderByOpenedAtDesc(
                anyString(), anyList())).thenReturn(Optional.empty());
        assignIdOnSave();
        Alert created = service.ensureAlert(twin(), AlertSeverity.CRITICAL, "FAILURE_RISK",
                "headline", "description", assessment(), "simulator");
        assertThat(created.getStatus()).isEqualTo(AlertStatus.NEW);
        assertThat(created.getMachineId()).isEqualTo("M-101");
        assertThat(created.getRecommendedAction()).isEqualTo("Inspect bearings");
        verify(alertRepository).save(any(Alert.class));
    }

    @Test
    void ensureAlertDedupesSameOpenSeverity() {
        Alert existing = openAlert(AlertStatus.ACKNOWLEDGED);
        when(alertRepository.findFirstByMachineIdAndStatusInOrderByOpenedAtDesc(
                anyString(), anyList())).thenReturn(Optional.of(existing));
        Alert result = service.ensureAlert(twin(), AlertSeverity.CRITICAL, "FAILURE_RISK",
                "headline", "description", assessment(), "simulator");
        assertThat(result).isSameAs(existing);
        verify(alertRepository, never()).save(any(Alert.class));
    }

    @Test
    void ensureAlertUpdatesOpenAlertInPlace_whenSeverityFlips() {
        Alert existing = openAlert(AlertStatus.NEW);
        when(alertRepository.findFirstByMachineIdAndStatusInOrderByOpenedAtDesc(
                anyString(), anyList())).thenReturn(Optional.of(existing));
        Alert warning = service.ensureAlert(twin(), AlertSeverity.WARNING, "RISK_ELEVATED",
                "headline", "description", assessment(), "simulator");
        assertThat(warning).isSameAs(existing);
        assertThat(warning.getSeverity()).isEqualTo(AlertSeverity.WARNING);
        assertThat(warning.getType()).isEqualTo("RISK_ELEVATED");
        assertThat(warning.getStatus()).isEqualTo(AlertStatus.NEW);
        verify(alertRepository, never()).save(any(Alert.class));
    }

    @Test
    void acknowledgeMovesNewToAcknowledged() {
        Alert a = openAlert(AlertStatus.NEW);
        when(alertRepository.findById(a.getId())).thenReturn(Optional.of(a));
        Alert out = service.acknowledge(a.getId(), "operator1");
        assertThat(out.getStatus()).isEqualTo(AlertStatus.ACKNOWLEDGED);
        assertThat(out.getAcknowledgedBy()).isEqualTo("operator1");
        assertThat(out.getAcknowledgedAt()).isNotNull();
    }

    @Test
    void acknowledgeIsNoopForAlreadyAcknowledged() {
        Alert a = openAlert(AlertStatus.ACKNOWLEDGED);
        when(alertRepository.findById(a.getId())).thenReturn(Optional.of(a));
        Alert out = service.acknowledge(a.getId(), "operator2");
        assertThat(out.getStatus()).isEqualTo(AlertStatus.ACKNOWLEDGED);
        verify(alertRepository, never()).save(any(Alert.class));
    }

    @Test
    void startInvestigationPromotesNewOrAcknowledged() {
        for (AlertStatus from : List.of(AlertStatus.NEW, AlertStatus.ACKNOWLEDGED)) {
            Alert a = openAlert(from);
            when(alertRepository.findById(a.getId())).thenReturn(Optional.of(a));
            Alert out = service.startInvestigation(a.getId(), "engineer1");
            assertThat(out.getStatus()).isEqualTo(AlertStatus.INVESTIGATING);
            assertThat(out.getInvestigatingAt()).isNotNull();
        }
    }

    @Test
    void resolveClosesAlertWithNotes() {
        Alert a = openAlert(AlertStatus.INVESTIGATING);
        when(alertRepository.findById(a.getId())).thenReturn(Optional.of(a));
        Alert out = service.resolve(a.getId(), "engineer1", "Replaced bearing");
        assertThat(out.getStatus()).isEqualTo(AlertStatus.RESOLVED);
        assertThat(out.getResolvedBy()).isEqualTo("engineer1");
        assertThat(out.getResolvedAt()).isNotNull();
        assertThat(out.getResolutionNotes()).isEqualTo("Replaced bearing");
    }
}