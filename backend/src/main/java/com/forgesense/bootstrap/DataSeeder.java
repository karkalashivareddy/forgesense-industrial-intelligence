package com.forgesense.bootstrap;

import com.forgesense.factory.FactoryRepository;
import com.forgesense.factory.ProductionLineRepository;
import com.forgesense.factory.ZoneRepository;
import com.forgesense.factory.domain.Factory;
import com.forgesense.factory.domain.ProductionLine;
import com.forgesense.factory.domain.Zone;
import com.forgesense.machine.MachineDependencyRepository;
import com.forgesense.machine.MachineRepository;
import com.forgesense.machine.domain.Machine;
import com.forgesense.machine.domain.MachineDependency;
import com.forgesense.machine.domain.MachineType;
import com.forgesense.machine.domain.MaintenanceStatus;
import com.forgesense.machine.twin.TwinService;
import com.forgesense.profiles.MachineProfileCatalog;
import com.forgesense.telemetry.TelemetryRepository;
import com.forgesense.telemetry.domain.TelemetryRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Seeds Factory Alpha from the authoritative catalog (config/machine_profiles.json):
 * zones, lines, the 8 machine fleet, dependency graph, twin registration, and a
 * handful of historic telemetry samples generated around each machine's nominal
 * operating point - so the UI has real data on a cold start. Idempotent - runs
 * only when the machine table is empty.
 */
@Component
public class DataSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DataSeeder.class);

    private static final Map<String, double[]> POSITIONS = Map.of(
            "M-101", new double[]{-12.0, 3.0, 0.0},
            "M-102", new double[]{12.0, 3.0, 0.0},
            "M-103", new double[]{-6.0, 7.2, 0.0},
            "M-104", new double[]{-18.0, 1.5, 0.0},
            "M-105", new double[]{0.0, 7.2, 0.0},
            "M-106", new double[]{-22.0, 5.0, 0.0},
            "M-107", new double[]{6.0, 7.2, 0.0},
            "M-108", new double[]{0.0, 9.5, 0.0});

    private final FactoryRepository factoryRepository;
    private final ZoneRepository zoneRepository;
    private final ProductionLineRepository lineRepository;
    private final MachineRepository machineRepository;
    private final MachineDependencyRepository dependencyRepository;
    private final TwinService twinService;
    private final TelemetryRepository telemetryRepository;
    private final MachineProfileCatalog catalog;

    public DataSeeder(FactoryRepository factoryRepository, ZoneRepository zoneRepository,
                      ProductionLineRepository lineRepository, MachineRepository machineRepository,
                      MachineDependencyRepository dependencyRepository, TwinService twinService,
                      TelemetryRepository telemetryRepository, MachineProfileCatalog catalog) {
        this.factoryRepository = factoryRepository;
        this.zoneRepository = zoneRepository;
        this.lineRepository = lineRepository;
        this.machineRepository = machineRepository;
        this.dependencyRepository = dependencyRepository;
        this.twinService = twinService;
        this.telemetryRepository = telemetryRepository;
        this.catalog = catalog;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        if (machineRepository.count() > 0) {
            log.info("Database already seeded ({} machines) - skipping.", machineRepository.count());
            return;
        }

        Factory alpha = factoryRepository.save(new Factory("Alpha Plant", "ALPHA-01", "Northfield, MI"));
        Map<String, Zone> zones = new HashMap<>();
        for (MachineProfileCatalog.ZoneSpec z : catalog.zones()) {
            zones.put(z.code(), zoneRepository.save(new Zone(alpha, z.name(), z.code(), z.order())));
        }
        Map<String, ProductionLine> lines = new HashMap<>();
        for (MachineProfileCatalog.LineSpec l : catalog.lines()) {
            lines.put(l.code(), lineRepository.save(new ProductionLine(alpha, l.name(), l.code(), l.order())));
        }

        for (MachineProfileCatalog.MachineSpec spec : catalog.machines()) {
            Machine m = machine(spec, zones.get(spec.zone()), lines.get(spec.line()));
            machineRepository.save(m);
        }

        for (MachineProfileCatalog.DependencySpec d : catalog.dependencies()) {
            Machine up = machineRepository.findByMachineId(d.upstream()).orElseThrow();
            Machine down = machineRepository.findByMachineId(d.downstream()).orElseThrow();
            dependencyRepository.save(new MachineDependency(up, down,
                    d.relationType(), d.propagationFactor(), d.delayMinutes()));
        }

        machineRepository.findAll().forEach(twinService::register);
        seedHistoricTelemetry();

        log.info("Factory Alpha seeded: {} machines, {} dependencies, twins registered.",
                machineRepository.count(), dependencyRepository.count());
    }

    private Machine machine(MachineProfileCatalog.MachineSpec spec, Zone zone, ProductionLine line) {
        Machine m = new Machine();
        m.setMachineId(spec.machineId());
        m.setName(spec.name());
        m.setType(MachineType.valueOf(spec.type()));
        m.setZone(zone);
        m.setProductionLine(line);
        m.setCriticality(catalog.criticality(spec.machineId()));
        m.setThroughputPerHour(spec.throughputPerHour());
        m.setOperatingHours(spec.operatingHours());
        m.setHealthScore(96.0);
        m.setFailureRisk(0.03);
        m.setAnomalyScore(0.05);
        m.setRulEstimate(60.0);
        m.setMaintenanceStatus(MaintenanceStatus.NONE);
        m.setLastMaintenance(Instant.now().minus(45, ChronoUnit.DAYS));
        m.setNextMaintenance(Instant.now().plus(15, ChronoUnit.DAYS));
        m.setModelVersion("anomaly-model-v2");
        m.setSensors(catalog.sensorsOf(spec.machineId()));
        double[] pos = POSITIONS.getOrDefault(spec.machineId(), new double[]{0.0, 0.0, 0.0});
        m.setPosX(pos[0]);
        m.setPosY(pos[1]);
        m.setPosZ(pos[2]);
        m.setDescription(spec.description());
        return m;
    }

    /**
     * A compact history of realistic sample telemetry per machine around its
     * profile nominal values so charts have a baseline immediately. Clearly
     * labeled simulated input; the simulator continues this stream in real time.
     */
    private void seedHistoricTelemetry() {
        Instant end = Instant.now().minusSeconds(30);
        List<String> sensors = List.of(
                "temperature", "vibration", "pressure", "rpm", "torque",
                "current", "power", "flow", "voltage", "frequency");
        for (Machine m : machineRepository.findAllByOrderByMachineId()) {
            var r = new java.util.Random(m.getMachineId().hashCode() * 31L);
            for (int i = 39; i >= 0; i--) {
                TelemetryRecord rec = new TelemetryRecord();
                rec.setMachineId(m.getMachineId());
                rec.setTimestamp(end.minusSeconds(30L * (39 - i)));
                rec.setSequence(1000L - i);
                for (String sensor : sensors) {
                    catalog.nominalValue(m.getMachineId(), sensor).ifPresent(nominal -> {
                        double value = nominal + r.nextGaussian() * 0.3
                                * catalog.sensor(m.getMachineId(), sensor).orElseThrow().std();
                        set(rec, sensor, sensor.equals("vibration") ? round2(value) : round1(value));
                    });
                }
                telemetryRepository.save(rec);
            }
        }
    }

    private static void set(TelemetryRecord rec, String sensor, double value) {
        switch (sensor) {
            case "temperature" -> rec.setTemperature(value);
            case "vibration" -> rec.setVibration(value);
            case "pressure" -> rec.setPressure(value);
            case "rpm" -> rec.setRpm(value);
            case "torque" -> rec.setTorque(value);
            case "current" -> rec.setCurrent(value);
            case "power" -> rec.setPower(value);
            case "flow" -> rec.setFlow(value);
            case "voltage" -> rec.setVoltage(value);
            case "frequency" -> rec.setFrequency(value);
            default -> { }
        }
    }

    private static double round1(double v) {
        return Math.round(v * 10.0) / 10.0;
    }

    private static double round2(double v) {
        return Math.round(v * 100.0) / 100.0;
    }
}
