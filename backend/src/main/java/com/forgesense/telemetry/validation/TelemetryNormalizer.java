package com.forgesense.telemetry.validation;

import com.forgesense.common.config.ForgeSenseProperties;
import com.forgesense.telemetry.domain.TelemetrySample;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * Clamps values into physically feasible ranges and rounds to sane precision,
 * producing a canonical, normalized sample that downstream stages can trust.
 */
@Component
public class TelemetryNormalizer {

    private final ForgeSenseProperties props;

    public TelemetryNormalizer(ForgeSenseProperties props) {
        this.props = props;
    }

    public TelemetrySample normalize(TelemetrySample s) {
        return new TelemetrySample(
                s.machineId(),
                s.timestamp(),
                s.sequence(),
                rng(s.temperature(), 0, 250),
                rng(s.vibration(), 0, 20),
                rng(s.pressure(), 0, 12),
                rng(s.rpm(), 0, 6000),
                rng(s.torque(), 0, 500),
                rng(s.current(), 0, 100),
                rng(s.voltage(), 0, 600),
                rng(s.power(), 0, 300),
                rng(s.flow(), 0, 300),
                rng(s.frequency(), 0, 100),
                rng(s.airTemperature(), -40, 120),
                s.operatingHours(),
                s.machineType()
        );
    }

    private static Double rng(Double v, double lo, double hi) {
        if (v == null) return null;
        double clamped = Math.max(lo, Math.min(hi, v));
        return BigDecimal.valueOf(clamped).setScale(2, RoundingMode.HALF_UP).doubleValue();
    }
}
