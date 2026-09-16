package com.forgesense.machine.domain;

import com.forgesense.common.domain.AbstractEntity;
import com.forgesense.factory.domain.ProductionLine;
import com.forgesense.factory.domain.Zone;
import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Index;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.HashSet;
import java.util.Set;

/**
 * A physical machine and its persisted operational state.
 * Sensor availability depends on machine type.
 */
@Entity
@Table(name = "machine", indexes = {
        @Index(columnList = "machine_id", unique = true),
        @Index(columnList = "zone_id"),
        @Index(columnList = "production_line_id"),
        @Index(columnList = "status")
})
@Getter
@Setter
@NoArgsConstructor
public class Machine extends AbstractEntity {

    private String machineId;

    @Column(nullable = false)
    private String name;

    @Enumerated(EnumType.STRING)
    private MachineType type;

    @ManyToOne(fetch = FetchType.EAGER, optional = false)
    @JoinColumn(name = "zone_id")
    private Zone zone;

    @ManyToOne(fetch = FetchType.EAGER, optional = false)
    @JoinColumn(name = "production_line_id")
    private ProductionLine productionLine;

    @Enumerated(EnumType.STRING)
    private MachineState status = MachineState.NORMAL;

    @Enumerated(EnumType.STRING)
    private Criticality criticality = Criticality.MEDIUM;

    private Double healthScore = 98.0;
    private Double failureRisk = 0.03;
    private Double anomalyScore = 0.05;
    private Double rulEstimate = 60.0;

    private Double operatingHours = 0.0;
    private Double throughputPerHour = 60.0;

    @Enumerated(EnumType.STRING)
    private MaintenanceStatus maintenanceStatus = MaintenanceStatus.NONE;

    private Instant lastMaintenance;
    private Instant nextMaintenance;

    private String connectivity = "ONLINE";
    private Instant lastTelemetryAt;

    private String modelVersion = "none";

    private Double posX = 0.0;
    private Double posY = 0.0;
    private Double posZ = 0.0;

    private String description;

    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "machine_sensor", joinColumns = @JoinColumn(name = "machine_fk"))
    @Enumerated(EnumType.STRING)
    private Set<SensorType> sensors = new HashSet<>();

    public void assignSensorsForType() {
        if (type != null) {
            this.sensors = defaultSensors(type);
        }
    }

    public static Set<SensorType> defaultSensors(MachineType t) {
        Set<SensorType> s = new HashSet<>();
        switch (t) {
            case CNC_MILL -> {
                s.addAll(Set.of(SensorType.TEMPERATURE, SensorType.VIBRATION, SensorType.RPM,
                        SensorType.TORQUE, SensorType.CURRENT, SensorType.POWER, SensorType.PRESSURE));
            }
            case INDUSTRIAL_MOTOR -> {
                s.addAll(Set.of(SensorType.TEMPERATURE, SensorType.VIBRATION, SensorType.RPM,
                        SensorType.CURRENT, SensorType.VOLTAGE, SensorType.POWER));
            }
            case HYDRAULIC_PUMP -> {
                s.addAll(Set.of(SensorType.TEMPERATURE, SensorType.VIBRATION, SensorType.PRESSURE,
                        SensorType.FLOW, SensorType.POWER));
            }
            case CONVEYOR_DRIVE_MOTOR -> {
                s.addAll(Set.of(SensorType.TEMPERATURE, SensorType.VIBRATION, SensorType.RPM,
                        SensorType.TORQUE, SensorType.CURRENT, SensorType.POWER));
            }
            case COMPRESSOR -> {
                s.addAll(Set.of(SensorType.TEMPERATURE, SensorType.VIBRATION, SensorType.PRESSURE,
                        SensorType.RPM, SensorType.CURRENT, SensorType.POWER));
            }
            case ROBOTIC_ARM -> {
                s.addAll(Set.of(SensorType.TEMPERATURE, SensorType.VIBRATION, SensorType.CURRENT,
                        SensorType.VOLTAGE, SensorType.TORQUE, SensorType.POWER));
            }
            case COOLING_UNIT -> {
                s.addAll(Set.of(SensorType.TEMPERATURE, SensorType.PRESSURE, SensorType.CURRENT,
                        SensorType.POWER, SensorType.VIBRATION, SensorType.FLOW));
            }
            case GENERATOR -> {
                s.addAll(Set.of(SensorType.TEMPERATURE, SensorType.VIBRATION, SensorType.RPM,
                        SensorType.VOLTAGE, SensorType.CURRENT, SensorType.FREQUENCY, SensorType.POWER));
            }
        }
        return s;
    }
}
