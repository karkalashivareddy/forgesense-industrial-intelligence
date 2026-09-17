package com.forgesense.profiles;

import com.forgesense.machine.domain.Criticality;
import com.forgesense.machine.domain.SensorType;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Loads the authoritative machine catalog and per-type sensor operating
 * profiles from {@code config/machine_profiles.json}. This file is the single
 * source of truth shared with the ML service (z-score profiles) and the
 * telemetry simulator (baselines). The catalog fails fast at startup when the
 * file cannot be located so a stale or divergent fleet definition never boots.
 *
 * File resolution order:
 *   1. {@code FORGESENSE_PROFILES_FILE} environment variable
 *   2. {@code <cwd>/config/machine_profiles.json}
 *   3. {@code <cwd>/../config/machine_profiles.json}  (repo root, when run
 *      from the backend/ module or CI)
 */
@Component
public class MachineProfileCatalog {

    private static final Logger log = LoggerFactory.getLogger(MachineProfileCatalog.class);

    public record SensorProfile(String label, String unit, double mean, double std,
                                double min, double max, Double warnHigh, Double critHigh) {
        public SensorProfile {
            if (std <= 0) {
                throw new IllegalArgumentException("sensor std must be > 0 for " + label);
            }
        }

        public double warnHighOrDefault() {
            return warnHigh != null ? warnHigh : mean + 3.0 * std;
        }

        public double critHighOrDefault() {
            return critHigh != null ? critHigh : mean + 5.0 * std;
        }
    }

    public record TypeProfile(String label, Map<String, SensorProfile> sensors) {}

    public record MachineSpec(String machineId, String name, String type, String zone,
                              String line, String criticality, double throughputPerHour,
                              double operatingHours, String description) {}

    public record DependencySpec(String upstream, String downstream, String relationType,
                                 double propagationFactor, double delayMinutes) {}

    public record ZoneSpec(String code, String name, int order) {}

    public record LineSpec(String code, String name, int order) {}

    public record ProfilesFile(int schemaVersion, String description,
                               Map<String, SensorProfile> ambient,
                               Map<String, TypeProfile> machineTypes,
                               List<ZoneSpec> zones, List<LineSpec> lines,
                               List<MachineSpec> machines,
                               List<DependencySpec> dependencies) {}

    private final ProfilesFile data;
    private final Map<String, MachineSpec> byMachineId;

    public MachineProfileCatalog(ObjectMapper objectMapper) {
        Path path = resolveProfilesPath();
        try {
            this.data = objectMapper.readValue(path.toFile(), ProfilesFile.class);
        } catch (RuntimeException e) {
            throw new IllegalStateException(
                    "Cannot load machine profile catalog from " + path + ": " + e.getMessage(), e);
        }
        Map<String, MachineSpec> map = new LinkedHashMap<>();
        for (MachineSpec spec : data.machines()) {
            if (!data.machineTypes().containsKey(spec.type())) {
                throw new IllegalStateException("Machine " + spec.machineId()
                        + " references unknown type " + spec.type());
            }
            map.put(spec.machineId(), spec);
        }
        this.byMachineId = Collections.unmodifiableMap(map);
        log.info("Machine profile catalog loaded from {} - {} machines, {} types",
                path, data.machines().size(), data.machineTypes().size());
    }

    public ProfilesFile data() {
        return data;
    }

    public List<MachineSpec> machines() {
        return data.machines();
    }

    public Optional<MachineSpec> machine(String machineId) {
        return Optional.ofNullable(byMachineId.get(machineId));
    }

    public boolean knows(String machineId) {
        return byMachineId.containsKey(machineId);
    }

    public TypeProfile typeProfile(String machineId) {
        MachineSpec spec = byMachineId.get(machineId);
        if (spec == null) {
            throw new IllegalArgumentException("Unknown machine: " + machineId);
        }
        return data.machineTypes().get(spec.type());
    }

    public List<ZoneSpec> zones() {
        return data.zones();
    }

    public List<LineSpec> lines() {
        return data.lines();
    }

    public List<DependencySpec> dependencies() {
        return data.dependencies();
    }

    public Map<String, SensorProfile> ambient() {
        return data.ambient();
    }

    /** Canonical sensor names for a machine (from its type profile). */
    public List<String> sensorNames(String machineId) {
        return typeProfile(machineId).sensors().keySet().stream().toList();
    }

    public Optional<SensorProfile> sensor(String machineId, String sensor) {
        return Optional.ofNullable(typeProfile(machineId).sensors().get(sensor));
    }

    /** Nominal value (profile mean) for a sensor of a machine, if the type provides it. */
    public Optional<Double> nominalValue(String machineId, String sensor) {
        return sensor(machineId, sensor).map(SensorProfile::mean);
    }

    public Double nominal(String machineId, String sensor, Double fallback) {
        return nominalValue(machineId, sensor).orElse(fallback);
    }

    public Criticality criticality(String machineId) {
        MachineSpec spec = byMachineId.get(machineId);
        if (spec == null || spec.criticality() == null) {
            return Criticality.MEDIUM;
        }
        try {
            return Criticality.valueOf(spec.criticality());
        } catch (IllegalArgumentException e) {
            return Criticality.MEDIUM;
        }
    }

    /** Maps a machine's type-profile sensors onto the backend SensorType enum. */
    public java.util.Set<SensorType> sensorsOf(String machineId) {
        java.util.Set<SensorType> out = new java.util.HashSet<>();
        for (String name : sensorNames(machineId)) {
            try {
                out.add(SensorType.valueOf(name.toUpperCase()));
            } catch (IllegalArgumentException e) {
                log.debug("Sensor {} not part of backend SensorType enum - skipped", name);
            }
        }
        return out;
    }

    private static Path resolveProfilesPath() {
        String env = System.getenv("FORGESENSE_PROFILES_FILE");
        if (env != null && !env.isBlank()) {
            return Path.of(env);
        }
        List<Path> candidates = List.of(
                Path.of("config/machine_profiles.json"),
                Path.of("../config/machine_profiles.json"));
        for (Path p : candidates) {
            if (Files.exists(p)) {
                return p;
            }
        }
        throw new IllegalStateException(
                "machine profiles file not found. Set FORGESENSE_PROFILES_FILE or run from a "
                        + "directory where config/machine_profiles.json (repo root) is reachable.");
    }
}