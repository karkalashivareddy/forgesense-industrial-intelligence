package com.forgesense.machine.twin;

import com.forgesense.factory.domain.ProductionLine;
import com.forgesense.factory.domain.Zone;
import com.forgesense.machine.MachineRepository;
import com.forgesense.machine.domain.Machine;
import com.forgesense.machine.domain.MachineState;
import com.forgesense.machine.domain.MachineType;
import com.forgesense.streaming.EventBus;
import com.forgesense.telemetry.domain.TelemetrySample;
import com.forgesense.websocket.WsNotifier;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

@ExtendWith(MockitoExtension.class)
class TwinServiceTest {

    @Mock
    private MachineRepository machineRepository;
    @Mock
    private WsNotifier ws;
    @Mock
    private EventBus eventBus;

    private TwinService twinService;

    @BeforeEach
    void setUp() {
        twinService = new TwinService(machineRepository, ws, eventBus);
    }

    private Machine machine(String id) {
        Machine m = new Machine();
        m.setMachineId(id);
        m.setName("Milling cell " + id);
        m.setType(MachineType.CNC_MILL);
        Zone zone = new Zone();
        zone.setCode("MACHINING");
        m.setZone(zone);
        ProductionLine line = new ProductionLine();
        line.setCode("LINE-A");
        m.setProductionLine(line);
        m.setStatus(MachineState.DEGRADED);
        m.setFailureRisk(0.42);
        m.setAnomalyScore(0.33);
        m.setHealthScore(71.0);
        m.setModelVersion("anomaly-model-v2");
        return m;
    }

    @Test
    void registerCopiesMachineStateIntoFreshTwinShell() {
        MachineTwin t = twinService.register(machine("M-101"));
        assertThat(t.getMachineId()).isEqualTo("M-101");
        assertThat(t.getName()).isEqualTo("Milling cell M-101");
        assertThat(t.getMachineType()).isEqualTo("CNC_MILL");
        assertThat(t.getZoneCode()).isEqualTo("MACHINING");
        assertThat(t.getLineCode()).isEqualTo("LINE-A");
        assertThat(t.getStatus()).isEqualTo(MachineState.DEGRADED);
        assertThat(t.getFailureRisk()).isEqualTo(0.42);
        assertThat(t.getAnomalyScore()).isEqualTo(0.33);
        assertThat(t.getHealthScore()).isEqualTo(71.0);
        assertThat(t.getModelVersion()).isEqualTo("anomaly-model-v2");
    }

    @Test
    void registerTwiceKeepsSameTwinInstance() {
        MachineTwin first = twinService.register(machine("M-102"));
        Machine m2 = machine("M-102");
        MachineTwin second = twinService.register(m2);
        assertThat(second).isSameAs(first);
    }

    @Test
    void applyTelemetryMarksOnlineAndStoresLatestSample() {
        MachineTwin t = twinService.register(machine("M-103"));
        Instant ts = Instant.parse("2026-09-12T10:05:00Z");
        TelemetrySample sample = TelemetrySample.of("M-103", ts, 77L,
                55.2, 0.86, null, 2400.0, 40.0, 18.0, 480.0, 8.6, 120.0, 60.0, 22.0, 112.0);
        twinService.applyTelemetry(sample);
        assertThat(t.getConnectivity()).isEqualTo("ONLINE");
        assertThat(t.getLastTelemetryAt()).isEqualTo(ts);
        assertThat(t.getLastSequence()).isEqualTo(77L);
        assertThat(t.latestSample()).isNotNull();
        assertThat(t.latestSample().temperature()).isEqualTo(55.2);
    }
}