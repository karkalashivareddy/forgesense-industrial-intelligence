package com.forgesense.telemetry.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;

/**
 * A normalized telemetry sample. Sensor columns are nullable - a machine only
 * reports the sensors its type provides.
 */
@Entity
@Table(name = "telemetry", uniqueConstraints = {
        @UniqueConstraint(name = "uk_telemetry_machine_sequence", columnNames = {"machineId", "sequence"})
}, indexes = {
        @Index(name = "idx_telemetry_machine_time", columnList = "machineId,timestamp"),
        @Index(name = "idx_telemetry_time", columnList = "timestamp")
})
@Getter
@Setter
@NoArgsConstructor
public class TelemetryRecord {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String machineId;

    @Column(nullable = false)
    private Instant timestamp;

    /** Event creation time, distinct from the sensor measurement timestamp. */
    private Instant eventTimestamp;

    /** Backend/event-boundary ingestion time. */
    private Instant ingestedAt;

    /** Time the normalized sample completed backend processing. */
    private Instant processedAt;

    private String eventId;
    private String correlationId;
    private String schemaVersion;

    private long sequence;

    private Double temperature;
    private Double vibration;
    private Double pressure;
    private Double rpm;
    private Double torque;
    private Double current;
    private Double voltage;
    private Double power;
    private Double flow;
    private Double frequency;
}
