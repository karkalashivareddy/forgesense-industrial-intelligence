package com.forgesense.telemetry.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;

/**
 * A normalized telemetry sample. Sensor columns are nullable — a machine only
 * reports the sensors its type provides.
 */
@Entity
@Table(name = "telemetry", indexes = {
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