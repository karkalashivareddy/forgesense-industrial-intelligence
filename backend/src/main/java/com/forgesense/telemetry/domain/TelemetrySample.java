package com.forgesense.telemetry.domain;

import java.time.Instant;

/**
 * A raw telemetry sample as submitted by the simulator. Nullable sensors —
 * a machine only reports the sensors its type provides.
 */
public record TelemetrySample(
        String machineId,
        Instant timestamp,
        long sequence,
        Double temperature,
        Double vibration,
        Double pressure,
        Double rpm,
        Double torque,
        Double current,
        Double voltage,
        Double power,
        Double flow,
        Double frequency,
        Double airTemperature,
        Double operatingHours
) {

    public static TelemetrySample of(String machineId, Instant timestamp, long sequence,
                                     Double temperature, Double vibration, Double pressure,
                                     Double rpm, Double torque, Double current, Double voltage,
                                     Double power, Double flow, Double frequency,
                                     Double airTemperature, Double operatingHours) {
        return new TelemetrySample(machineId, timestamp, sequence, temperature, vibration, pressure,
                rpm, torque, current, voltage, power, flow, frequency, airTemperature, operatingHours);
    }
}