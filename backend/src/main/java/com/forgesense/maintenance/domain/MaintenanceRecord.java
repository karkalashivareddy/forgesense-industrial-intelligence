package com.forgesense.maintenance.domain;

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

@Entity
@Table(name = "maintenance_record", indexes = {
        @Index(name = "idx_maint_status", columnList = "status"),
        @Index(name = "idx_maint_machine", columnList = "machineId")
})
@Getter
@Setter
@NoArgsConstructor
public class MaintenanceRecord extends AbstractEntity {

    @Column(nullable = false)
    private String machineId;

    private String machineName;

    private String title;
    @Column(length = 2000)
    private String description;
    @Column(length = 2000)
    private String recommendedAction;

    @Enumerated(EnumType.STRING)
    private MaintenancePriority priority = MaintenancePriority.MEDIUM;

    @Enumerated(EnumType.STRING)
    private MaintenanceStatus status = MaintenanceStatus.RECOMMENDED;

    private String reason;
    private String assignedRole;
    private Integer estimatedDurationMinutes;
    private String sourceType;

    private Instant scheduledAt;
    private Instant startedAt;
    private Instant completedAt;
    private String completedBy;
    private String resultSummary;

    private double riskAtCreation;
}