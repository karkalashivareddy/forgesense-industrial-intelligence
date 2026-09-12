package com.forgesense.machine.domain;

import com.forgesense.common.domain.AbstractEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Index;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * Directed edge: upstream machine is a dependency of downstream machine.
 * Configurable at runtime (not hard-coded into the UI).
 */
@Entity
@Table(name = "machine_dependency",
        uniqueConstraints = @UniqueConstraint(columnNames = {"upstream_id", "downstream_id"}),
        indexes = @Index(columnList = "upstream_id"))
@Getter
@Setter
@NoArgsConstructor
public class MachineDependency extends AbstractEntity {

    @ManyToOne(fetch = FetchType.EAGER, optional = false)
    @JoinColumn(name = "upstream_id")
    private Machine upstream;

    @ManyToOne(fetch = FetchType.EAGER, optional = false)
    @JoinColumn(name = "downstream_id")
    private Machine downstream;

    private String relationType;

    @Column(nullable = false)
    private double propagationFactor = 0.8;

    private double delayMinutes = 10.0;

    public MachineDependency(Machine upstream, Machine downstream, String relationType,
                             double propagationFactor, double delayMinutes) {
        this.upstream = upstream;
        this.downstream = downstream;
        this.relationType = relationType;
        this.propagationFactor = propagationFactor;
        this.delayMinutes = delayMinutes;
    }
}