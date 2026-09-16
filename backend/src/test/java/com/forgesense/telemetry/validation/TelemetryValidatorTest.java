package com.forgesense.telemetry.validation;

import com.forgesense.common.config.ForgeSenseProperties;
import com.forgesense.machine.MachineRepository;
import com.forgesense.machine.domain.Machine;
import com.forgesense.telemetry.domain.TelemetrySample;
import com.forgesense.telemetry.TelemetryRepository;
import com.forgesense.telemetry.domain.TelemetryRecord;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.time.Instant;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class TelemetryValidatorTest {

    @Mock
    private MachineRepository machineRepository;
    @Mock
    private TelemetryRepository telemetryRepository;

    private TelemetryValidator validator;

    @BeforeEach
    void setUp() {
        ForgeSenseProperties props = mock(ForgeSenseProperties.class);
        ForgeSenseProperties.Telemetry telemetry = new ForgeSenseProperties.Telemetry(60, 5, 200L);
        when(props.telemetry()).thenReturn(telemetry);
        when(machineRepository.findByMachineId(anyString())).thenReturn(Optional.empty());
        when(machineRepository.findByMachineId("M-101")).thenReturn(Optional.of(new Machine()));
        validator = new TelemetryValidator(props, machineRepository, telemetryRepository);
    }

    private TelemetrySample sample(Instant ts, Double temperature, Double vibration, Double rpm,
                                   Double current, Double torque, Double pressure, Double power) {
        return new TelemetrySample("M-101", ts, 1L, temperature, vibration, pressure, rpm,
                torque, current, 480.0, power, 120.0, 60.0, 22.0, 100.0);
    }

    @Test
    void validSamplePasses() {
        assertThat(validator.validate(sample(Instant.now(), 55.0, 0.85, 2400.0, 18.0, 40.0, null, 8.6),
                Instant.now())).isEmpty();
    }

    @Test
    void missingMachineIdIsRejected() {
        TelemetrySample s = new TelemetrySample(null, Instant.now(), 1L, 55.0, null, null, null,
                null, null, null, null, null, null, null, null);
        assertThat(validator.validate(s, Instant.now())).isPresent();
    }

    @Test
    void unknownMachineIsRejected() {
        TelemetrySample s = new TelemetrySample("M-999", Instant.now(), 1L, 55.0, null, null, null,
                null, null, null, null, null, null, null, null);
        assertThat(validator.validate(s, Instant.now())).hasValueSatisfying(m -> assertThat(m)
                .contains("unknown machine"));
    }

    @Test
    void staleTimestampIsRejected() {
        Instant old = Instant.now().minusSeconds(120);
        assertThat(validator.validate(sample(old, 55.0, null, null, null, null, null, null), Instant.now()))
                .hasValueSatisfying(m -> assertThat(m).contains("stale"));
    }

    @Test
    void futureTimestampBeyondJitterIsRejected() {
        Instant future = Instant.now().plusSeconds(10);
        assertThat(validator.validate(sample(future, 55.0, null, null, null, null, null, null), Instant.now()))
                .hasValueSatisfying(m -> assertThat(m).contains("future"));
    }

    @Test
    void duplicateAndOutOfOrderSequencesAreRejected() {
        when(telemetryRepository.existsByMachineIdAndSequence("M-101", 1L)).thenReturn(true);
        assertThat(validator.validate(sample(Instant.now(), 55.0, null, null, null, null, null, null), Instant.now()))
                .hasValueSatisfying(m -> assertThat(m).contains("duplicate"));

        when(telemetryRepository.existsByMachineIdAndSequence("M-101", 2L)).thenReturn(false);
        TelemetryRecord latest = new TelemetryRecord();
        latest.setSequence(2L);
        when(telemetryRepository.findFirstByMachineIdOrderBySequenceDesc("M-101")).thenReturn(latest);
        TelemetrySample outOfOrder = new TelemetrySample("M-101", Instant.now(), 2L, 55.0, null, null,
                null, null, null, null, null, null, null, null, null);
        assertThat(validator.validate(outOfOrder, Instant.now()))
                .hasValueSatisfying(m -> assertThat(m).contains("out-of-order"));
    }

    @Test
    void physicallyImpossibleValuesAreRejected() {
        assertThat(validator.validate(sample(Instant.now(), 500.0, null, null, null, null, null, null),
                Instant.now())).hasValueSatisfying(m -> assertThat(m).contains("temperature"));
        assertThat(validator.validate(sample(Instant.now(), null, 40.0, null, null, null, null, null),
                Instant.now())).hasValueSatisfying(m -> assertThat(m).contains("vibration"));
        assertThat(validator.validate(sample(Instant.now(), null, null, 12000.0, null, null, null, null),
                Instant.now())).hasValueSatisfying(m -> assertThat(m).contains("rpm"));
        assertThat(validator.validate(sample(Instant.now(), null, null, null, 300.0, null, null, null),
                Instant.now())).hasValueSatisfying(m -> assertThat(m).contains("current"));
        assertThat(validator.validate(sample(Instant.now(), null, null, null, null, 2000.0, null, null),
                Instant.now())).hasValueSatisfying(m -> assertThat(m).contains("torque"));
        assertThat(validator.validate(sample(Instant.now(), null, null, null, null, null, 40.0, null),
                Instant.now())).hasValueSatisfying(m -> assertThat(m).contains("pressure"));
        assertThat(validator.validate(sample(Instant.now(), null, null, null, null, null, null, 900.0),
                Instant.now())).hasValueSatisfying(m -> assertThat(m).contains("power"));
    }

    @Test
    void nullSensorsAreAllowed() {
        assertThat(validator.validate(sample(Instant.now(), null, null, null, null, null, null, null),
                Instant.now())).isEmpty();
        assertThat(validator.validate(sample(Instant.now(), 55.0, null, null, null, null, null, null),
                Instant.now())).isEmpty();
    }
}
