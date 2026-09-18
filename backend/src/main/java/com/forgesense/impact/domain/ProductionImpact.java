package com.forgesense.impact.domain;

import com.forgesense.common.domain.AbstractEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.List;

/**
 * Estimated operational consequence of a (simulated or predicted) failure.
 * All values are ESTIMATES built from modeled assumptions - never presented
 * as measured fact.
 */
@Entity
@Table(name = "production_impact", indexes = {
        @Index(name = "idx_impact_origin", columnList = "originMachineId"),
        @Index(name = "idx_impact_simulated", columnList = "simulated")
})
@Getter
@Setter
@NoArgsConstructor
public class ProductionImpact extends AbstractEntity {

    @Column(nullable = false)
    private String originMachineId;

    private String impactType;
    private boolean simulated;

    @JdbcTypeCode(SqlTypes.JSON)
    private List<String> affectedMachineIds = List.of();

    @JdbcTypeCode(SqlTypes.JSON)
    private List<String> affectedLines = List.of();

    @JdbcTypeCode(SqlTypes.JSON)
    private List<String> affectedZones = List.of();

    private int affectedMachineCount;
    private double estimatedDowntimeMinutes;
    private double throughputLossUnits;
    private double productionLossUnits;

    private String criticality;
    private String recoveryAssumption;
    @Column(length = 2000)
    private String assumptionsJson;

    private Instant baselineAt;
    private Instant scenarioAt;

    public static String assumptionsDescriptions() {
        return "Assumptions: per-edge downtime propagation factors; per-machine throughput; "
                + "recovery starts immediately after maintenance completes. These are modeled estimates, not measurements.";
    }
}