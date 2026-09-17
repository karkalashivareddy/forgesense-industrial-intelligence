package com.forgesense.telemetry.validation;

import com.forgesense.common.config.ForgeSenseProperties;
import com.forgesense.telemetry.domain.TelemetrySample;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

@ExtendWith(MockitoExtension.class)
class TelemetryNormalizerTest {

    @Mock
    private ForgeSenseProperties props;

    private TelemetryNormalizer normalizer() {
        return new TelemetryNormalizer(props);
    }

    private TelemetrySample sample(Double temperature, Double vibration, Double rpm, Double pressure) {
        return new TelemetrySample("M-101", Instant.now(), 1L,
                temperature, vibration, pressure, rpm, 40.0, 18.0, 480.0, 8.6, 60.0, 0.0, 22.0, 100.0);
    }

    @Test
    void clampsTemperature_toPhysicalRange() {
        assertThat(normalizer().normalize(sample(300.0, null, null, null)).temperature()).isEqualTo(250.0);
        assertThat(normalizer().normalize(sample(-50.0, null, null, null)).temperature()).isEqualTo(0.0);
    }

    @Test
    void clampsVibrationAndRpmNegativeToZero() {
        TelemetrySample out = normalizer().normalize(sample(null, -2.0, -100.0, null));
        assertThat(out.vibration()).isZero();
        assertThat(out.rpm()).isZero();
    }

    @Test
    void clampsHighRpmAndPressure() {
        TelemetrySample out = normalizer().normalize(sample(null, null, 9000.0, 30.0));
        assertThat(out.rpm()).isEqualTo(6000.0);
        assertThat(out.pressure()).isEqualTo(12.0);
    }

    @Test
    void nullSensorsStayNull() {
        TelemetrySample out = normalizer().normalize(sample(null, null, null, null));
        assertThat(out.temperature()).isNull();
        assertThat(out.vibration()).isNull();
        assertThat(out.airTemperature()).isEqualTo(22.0);
    }

    @Test
    void roundsToTwoDecimalsHalfUp() {
        TelemetrySample out = normalizer().normalize(sample(55.3456, 0.85999, null, null));
        assertThat(out.temperature()).isEqualTo(55.35);
        assertThat(out.vibration()).isEqualTo(0.86);
    }

    @Test
    void preservesIdentityFields() {
        Instant ts = Instant.parse("2026-09-12T10:00:00Z");
        TelemetrySample out = new TelemetryNormalizer(props).normalize(
                new TelemetrySample("M-101", ts, 42L,
                        55.0, 0.85, null, 2400.0, 40.0, 18.0, 480.0, 8.6, 120.0, 60.0, 22.0, 100.0));
        assertThat(out.machineId()).isEqualTo("M-101");
        assertThat(out.timestamp()).isEqualTo(ts);
        assertThat(out.sequence()).isEqualTo(42L);
        assertThat(out.operatingHours()).isEqualTo(100.0);
    }
}