package com.forgesense.bootstrap;

import com.forgesense.factory.FactoryRepository;
import com.forgesense.factory.ProductionLineRepository;
import com.forgesense.factory.ZoneRepository;
import com.forgesense.factory.domain.Factory;
import com.forgesense.factory.domain.ProductionLine;
import com.forgesense.factory.domain.Zone;
import com.forgesense.machine.MachineDependencyRepository;
import com.forgesense.machine.MachineRepository;
import com.forgesense.machine.domain.Criticality;
import com.forgesense.machine.domain.Machine;
import com.forgesense.machine.domain.MachineDependency;
import com.forgesense.machine.domain.MachineType;
import com.forgesense.machine.domain.MaintenanceStatus;
import com.forgesense.machine.twin.TwinService;
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

/**
 * Seeds Factory Alpha with zones, lines, the 8 machine fleet, dependency
 * graph, twin registration, and a handful of historic telemetry samples so
 * the UI has real data on a cold start. Idempotent — runs only when the
 * machine table is empty.
 */
@Component
public class DataSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DataSeeder.class);

    private final FactoryRepository factoryRepository;
    private final ZoneRepository zoneRepository;
    private final ProductionLineRepository lineRepository;
    private final MachineRepository machineRepository;
    private final MachineDependencyRepository dependencyRepository;
    private final TwinService twinService;
    private final TelemetryRepository telemetryRepository;

    public DataSeeder(FactoryRepository factoryRepository, ZoneRepository zoneRepository,
                      ProductionLineRepository lineRepository, MachineRepository machineRepository,
                      MachineDependencyRepository dependencyRepository, TwinService twinService,
                      TelemetryRepository telemetryRepository) {
        this.factoryRepository = factoryRepository;
        this.zoneRepository = zoneRepository;
        this.lineRepository = lineRepository;
        this.machineRepository = machineRepository;
        this.dependencyRepository = dependencyRepository;
        this.twinService = twinService;
        this.telemetryRepository = telemetryRepository;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        if (machineRepository.count() > 0) {
            log.info("Database already seeded ({} machines) — skipping.", machineRepository.count());
            return;
        }

        Factory alpha = factoryRepository.save(new Factory("Alpha Plant", "ALPHA-01", "Northfield, MI"));
        Zone machining = zoneRepository.save(new Zone(alpha, "Machining", "MACHINING", 1));
        Zone assembly = zoneRepository.save(new Zone(alpha, "Assembly", "ASSEMBLY", 2));
        Zone packaging = zoneRepository.save(new Zone(alpha, "Packaging", "PACKAGING", 3));
        Zone utilities = zoneRepository.save(new Zone(alpha, "Utilities", "UTILITIES", 4));

        ProductionLine lineA = lineRepository.save(new ProductionLine(alpha, "Machining → Assembly", "LINE-A", 1));
        ProductionLine lineB = lineRepository.save(new ProductionLine(alpha, "Packaging & Utilities", "LINE-B", 2));

        Machine m101 = machine(machining, lineA, "M-101", "CNC Mill A", MachineType.CNC_MILL,
                Criticality.CRITICAL, 80.0, 12450.0, -12.0, 3.0, 0.0,
                "High-speed vertical machining center (CNC Mill).");
        Machine m102 = machine(packaging, lineB, "M-102", "Packaging Motor", MachineType.INDUSTRIAL_MOTOR,
                Criticality.MEDIUM, 120.0, 8920.0, 12.0, 3.0, 0.0,
                "Packaging line drive motor.");
        Machine m103 = machine(utilities, lineB, "M-103", "Hydraulic Pump", MachineType.HYDRAULIC_PUMP,
                Criticality.HIGH, 90.0, 20110.0, -6.0, 7.2, 0.0,
                "Central hydraulic power unit.");
        Machine m104 = machine(machining, lineA, "M-104", "Conveyor Drive Motor", MachineType.CONVEYOR_DRIVE_MOTOR,
                Criticality.HIGH, 200.0, 30550.0, -18.0, 1.5, 0.0,
                "Main conveyor drive motor feeding assembly.");
        Machine m105 = machine(utilities, lineB, "M-105", "Compressor", MachineType.COMPRESSOR,
                Criticality.HIGH, 60.0, 16420.0, 0.0, 7.2, 0.0,
                "Air compressor supplying pneumatic systems.");
        Machine m106 = machine(assembly, lineA, "M-106", "Robotic Arm", MachineType.ROBOTIC_ARM,
                Criticality.CRITICAL, 150.0, 13800.0, -22.0, 5.0, 0.0,
                "Assembly robotic arm (4-axis).");
        Machine m107 = machine(utilities, lineB, "M-107", "Cooling Unit", MachineType.COOLING_UNIT,
                Criticality.HIGH, 40.0, 24880.0, 6.0, 7.2, 0.0,
                "Coolant circulation unit for CNC and drive motors.");
        Machine m108 = machine(utilities, lineB, "M-108", "Generator", MachineType.GENERATOR,
                Criticality.CRITICAL, 100.0, 41330.0, 0.0, 9.5, 0.0,
                "Backup generator supplying critical loads.");

        machineRepository.save(m101);
        machineRepository.save(m102);
        machineRepository.save(m103);
        machineRepository.save(m104);
        machineRepository.save(m105);
        machineRepository.save(m106);
        machineRepository.save(m107);
        machineRepository.save(m108);

        dependency("MATERIAL", 0.90, 12.0, m101, m104);
        dependency("MATERIAL", 0.80, 8.0, m104, m106);
        dependency("MATERIAL", 0.85, 15.0, m103, m102);
        dependency("MATERIAL", 0.70, 10.0, m104, m102);
        dependency("SERVICE", 0.60, 6.0, m105, m106);
        dependency("POWER", 0.95, 2.0, m108, m105);
        dependency("POWER", 0.90, 2.0, m108, m107);
        dependency("COOLING", 0.75, 20.0, m107, m101);
        dependency("COOLING", 0.65, 20.0, m107, m104);

        machineRepository.findAll().forEach(twinService::register);
        seedHistoricTelemetry();

        log.info("Factory Alpha seeded: 8 machines, {} dependencies, twins registered.",
                dependencyRepository.count());
    }

    private Machine machine(Zone zone, ProductionLine line, String machineId, String name,
                            MachineType type, Criticality criticality, double throughput,
                            double operatingHours, double posX, double posY, double posZ,
                            String description) {
        Machine m = new Machine();
        m.setMachineId(machineId);
        m.setName(name);
        m.setType(type);
        m.setZone(zone);
        m.setProductionLine(line);
        m.setCriticality(criticality);
        m.setThroughputPerHour(throughput);
        m.setOperatingHours(operatingHours);
        m.setHealthScore(96.0);
        m.setFailureRisk(0.03);
        m.setAnomalyScore(0.05);
        m.setRulEstimate(900.0);
        m.setMaintenanceStatus(MaintenanceStatus.NONE);
        m.setLastMaintenance(Instant.now().minus(45, ChronoUnit.DAYS));
        m.setNextMaintenance(Instant.now().plus(15, ChronoUnit.DAYS));
        m.setModelVersion("anomaly-model-v1");
        m.setPosX(posX);
        m.setPosY(posY);
        m.setPosZ(posZ);
        m.setDescription(description);
        m.assignSensorsForType();
        return m;
    }

    private void dependency(String relationType, double factor, double delay,
                            Machine upstream, Machine downstream) {
        dependencyRepository.save(new MachineDependency(upstream, downstream,
                relationType, factor, delay));
    }

    /**
     * A compact history of realistic sample telemetry per machine so charts
     * have a baseline immediately. Clearly labeled simulated input; the
     * simulator continues this stream in real time.
     */
    private void seedHistoricTelemetry() {
        Instant end = Instant.now().minusSeconds(30);
        for (Machine m : machineRepository.findAllByOrderByMachineId()) {
            var r = new java.util.Random(m.getMachineId().hashCode() * 31L);
            for (int i = 39; i >= 0; i--) {
                double tempBase = 24.0 + 10.0 * nominalTemp(m.getType());
                double vibBase = 0.55 + 0.4 * nominalVib(m.getType());
                TelemetryRecord rec = new TelemetryRecord();
                rec.setMachineId(m.getMachineId());
                rec.setTimestamp(end.minusSeconds(30L * (39 - i)));
                rec.setSequence(1000L - i);
                rec.setTemperature(round1(tempBase + r.nextGaussian() * 1.4));
                rec.setVibration(round2(vibBase + Math.abs(r.nextGaussian()) * 0.09));
                if (m.getType() == MachineType.HYDRAULIC_PUMP || m.getType() == MachineType.COMPRESSOR
                        || m.getType() == MachineType.COOLING_UNIT) {
                    rec.setPressure(round1(6.0 + r.nextGaussian() * 0.4));
                }
                if (m.getType() == MachineType.INDUSTRIAL_MOTOR || m.getType() == MachineType.CONVEYOR_DRIVE_MOTOR
                        || m.getType() == MachineType.COMPRESSOR || m.getType() == MachineType.GENERATOR
                        || m.getType() == MachineType.CNC_MILL) {
                    rec.setRpm((double) Math.round(1450 + r.nextGaussian() * 30));
                }
                telemetryRepository.save(rec);
            }
        }
    }

    private static double nominalTemp(MachineType t) {
        return switch (t) {
            case CNC_MILL -> 12.0;
            case INDUSTRIAL_MOTOR -> 8.0;
            case HYDRAULIC_PUMP -> 14.0;
            case CONVEYOR_DRIVE_MOTOR -> 11.0;
            case COMPRESSOR -> 9.0;
            case ROBOTIC_ARM -> 7.0;
            case COOLING_UNIT -> 16.0;
            case GENERATOR -> 18.0;
        };
    }

    private static double nominalVib(MachineType t) {
        return switch (t) {
            case CNC_MILL -> 0.30;
            case INDUSTRIAL_MOTOR -> 0.20;
            case HYDRAULIC_PUMP -> 0.45;
            case CONVEYOR_DRIVE_MOTOR -> 0.25;
            case COMPRESSOR -> 0.35;
            case ROBOTIC_ARM -> 0.18;
            case COOLING_UNIT -> 0.40;
            case GENERATOR -> 0.30;
        };
    }

    private static double round1(double v) {
        return Math.round(v * 10.0) / 10.0;
    }

    private static double round2(double v) {
        return Math.round(v * 100.0) / 100.0;
    }
}