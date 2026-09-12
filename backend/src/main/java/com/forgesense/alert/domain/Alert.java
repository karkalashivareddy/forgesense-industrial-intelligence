package com.forgesense.alert.domain;

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
@Table(name = "alert", indexes = {
        @Index(name = "idx_alert_status", columnList = "status"),
        @Index(name = "idx_alert_machine", columnList = "machineId"),
        @Index(name = "idx_alert_severity", columnList = "severity"),
        @Index(name = "idx_alert_created", columnList = "createdAt")
})
@Getter
@Setter
@NoArgsConstructor
public class Alert extends AbstractEntity {

    @Column(nullable = false)
    private String machineId;

    private String machineName;
    private String machineType;

    @Enumerated(EnumType.STRING)
    private AlertSeverity severity;

    @Enumerated(EnumType.STRING)
    private AlertStatus status = AlertStatus.NEW;

    private String type;
    private String headline;
    @Column(length = 2000)
    private String description;
    @Column(length = 4000)
    private String factorsSummary;
    @Column(length = 2000)
    private String recommendedAction;

    private double riskAtCreation;

    private Instant openedAt = Instant.now();
    private Instant acknowledgedAt;
    private Instant investigatingAt;
    private Instant resolvedAt;
    private String acknowledgedBy;
    private String resolvedBy;
    @Column(length = 2000)
    private String resolutionNotes;
}