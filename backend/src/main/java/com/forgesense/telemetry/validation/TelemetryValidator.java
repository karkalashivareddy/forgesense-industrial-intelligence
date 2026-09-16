package com.forgesense.telemetry.validation;

import com.forgesense.common.config.ForgeSenseProperties;
import com.forgesense.machine.domain.Machine;
import com.forgesense.machine.MachineRepository;
import com.forgesense.telemetry.domain.TelemetrySample;
import com.forgesense.telemetry.TelemetryRepository;
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
    private final TelemetryRepository telemetryRepository;

    public TelemetryValidator(ForgeSenseProperties props, MachineRepository machineRepository) {
        this(props, machineRepository, null);
    }

    @org.springframework.beans.factory.annotation.Autowired
    public TelemetryValidator(ForgeSenseProperties props, MachineRepository machineRepository,
                              TelemetryRepository telemetryRepository) {
        this.props = props;
        this.machineRepository = machineRepository;
        this.telemetryRepository = telemetryRepository;
    }

    public Optional<String> validate(TelemetrySample sample, Instant receivedAt) {
        if (sample.machineId() == null || sample.machineId().isBlank()) {
            return Optional.of("missing machineId");
        }
        Optional<Machine> machine = machineRepository.findByMachineId(sample.machineId());
        if (machine.isEmpty()) {
            return Optional.of("unknown machine: " + sample.machineId());
        }
        if (sample.timestamp() == null) {
            return Optional.of("missing measurement timestamp");
        }
        if (sample.sequence() <= 0) {
            return Optional.of("sequence must be positive");
        }
        if (sample.machineType() != null && machine.get().getType() != null
                && !machine.get().getType().name().equals(sample.machineType())) {
            return Optional.of("machineType does not match registered machine");
        }

        Instant received = receivedAt == null ? Instant.now() : receivedAt;
        Duration future = Duration.between(received, sample.timestamp());
        if (future.toSeconds() > props.telemetry().maxJitterSeconds()) {
            return Optional.of("future measurement timestamp exceeds " + props.telemetry().maxJitterSeconds() + "s jitter");
        }
        Duration staleness = Duration.between(sample.timestamp(), received);
        if (staleness.toSeconds() > props.telemetry().maxStalenessSeconds()) {
            return Optional.of("stale timestamp - older than " + props.telemetry().maxStalenessSeconds() + "s");
        }

        if (telemetryRepository != null) {
            if (telemetryRepository.existsByMachineIdAndSequence(sample.machineId(), sample.sequence())) {
                return Optional.of("duplicate sequence for machine: " + sample.sequence());
            }
            var latest = telemetryRepository.findFirstByMachineIdOrderBySequenceDesc(sample.machineId());
            if (latest != null && sample.sequence() <= latest.getSequence()) {
                return Optional.of("out-of-order sequence: " + sample.sequence());
            }
        }

        for (Double value : new Double[]{sample.temperature(), sample.vibration(), sample.pressure(), sample.rpm(),
                sample.torque(), sample.current(), sample.voltage(), sample.power(), sample.flow(),
                sample.frequency(), sample.airTemperature(), sample.operatingHours()}) {
            if (value != null && !Double.isFinite(value)) {
                return Optional.of("non-finite telemetry value");
            }
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
