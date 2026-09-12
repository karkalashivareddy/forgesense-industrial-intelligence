package com.forgesense.simulation.domain;

import com.forgesense.common.domain.AbstractEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;

/**
 * Live control state that steers the telemetry simulator for a machine.
 * Operators change this from the Simulation Control Center; the simulator
 * polls it and adjusts its generation accordingly.
 */
@Entity
@Table(name = "simulation_control", indexes = @Index(columnList = "machineId", unique = true))
@Getter
@Setter
@NoArgsConstructor
public class SimulationControl extends AbstractEntity {

    @Column(nullable = false)
    private String machineId;

    @Enumerated(EnumType.STRING)
    private ScenarioType scenario = ScenarioType.NONE;

    private double severity = 0.0;
    private boolean active = false;
    private Instant startedAt;
    private Instant updatedAt = Instant.now();
    @Column(length = 2000)
    private String parametersJson = "{}";
}