package com.forgesense.simulation.domain;

import com.forgesense.common.domain.AbstractEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.List;

/**
 * A what-if simulation run record: scenario definition + baseline vs scenario
 * result. Persisted for history/audit and retrievable via the API.
 */
@Entity
@Table(name = "simulation_scenario")
@Getter
@Setter
@NoArgsConstructor
public class SimulationScenario extends AbstractEntity {

    private String name;
    private String machineId;
    private String machineName;

    @Enumerated(EnumType.STRING)
    private ScenarioType scenarioType;

    private double severity;
    private int failureHorizonMinutes;

    private String status = "COMPLETED";

    @JdbcTypeCode(SqlTypes.JSON)
    private List<String> affectedMachineIds = List.of();

    private double expectedDowntimeMinutes;
    private double throughputLossUnits;
    private double productionLossUnits;
    private int affectedMachineCount;

    @JdbcTypeCode(SqlTypes.JSON)
    private java.util.Map<String, Object> result = new java.util.HashMap<>();

    private Instant startedAt;
    private Instant completedAt;

    public void markRunning() {
        this.status = "RUNNING";
        this.startedAt = Instant.now();
    }

    public void markCompleted() {
        this.status = "COMPLETED";
        this.completedAt = Instant.now();
    }
}