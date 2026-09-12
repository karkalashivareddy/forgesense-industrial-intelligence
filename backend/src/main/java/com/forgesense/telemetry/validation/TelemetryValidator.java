package com.forgesense.telemetry.validation;

import com.forgesense.common.config.ForgeSenseProperties;
import com.forgesense.machine.domain.Machine;
import com.forgesense.machine.MachineRepository;
import com.forgesense.telemetry.domain.TelemetrySample;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

/**
 * Validates inbound telemetry for staleness, missing keys, and physically
 * impossible values.
 */
@Component
public class TelemetryValidator {

    private final ForgeSenseProperties props;
    private final MachineRepository machineRepository;

    public TelemetryValidator(ForgeSenseProperties props, MachineRepository machineRepository) {
        this.props = props;
        this.machineRepository = machineRepository;
    }

    public Optional<String> validate(TelemetrySample sample, Instant envelopeTimestamp) {
        if (sample.machineId() == null || sample.machineId().isBlank()) {
            return Optional.of("missing machineId");
        }
        if (machineRepository.findByMachineId(sample.machineId()).isEmpty()) {
            return Optional.of("unknown machine: " + sample.machineId());
        }

        Duration staleness = Duration.between(envelopeTimestamp, Instant.now());
        if (staleness.toSeconds() > props.telemetry().maxStalenessSeconds()) {
            return Optional.of("stale timestamp — older than " + props.telemetry().maxStalenessSeconds() + "s");
        }

        if (sample.temperature() != null && (sample.temperature() < -40 || sample.temperature() > 250)) {
            return Optional.of("temperature physically impossible: " + sample.temperature());
        }
        if (sample.vibration() != null && (sample.vibration() < 0 || sample.vibration() > 30)) {
            return Optional.of("vibration physically impossible: " + sample.vibration());
        }
        if (sample.rpm() != null && (sample.rpm() < 0 || sample.rpm() > 10000)) {
            return Optional.of("rpm physically impossible: " + sample.rpm());
        }
        if (sample.current() != null && (sample.current() < 0 || sample.current() > 200)) {
            return Optional.of("current physically impossible: " + sample.current());
        }
        if (sample.torque() != null && (sample.torque() < 0 || sample.torque() > 1000)) {
            return Optional.of("torque physically impossible: " + sample.torque());
        }
        if (sample.pressure() != null && (sample.pressure() < 0 || sample.pressure() > 20)) {
            return Optional.of("pressure physically impossible: " + sample.pressure());
        }
        if (sample.power() != null && (sample.power() < 0 || sample.power() > 500)) {
            return Optional.of("power physically impossible: " + sample.power());
        }

        return Optional.empty();
    }
}