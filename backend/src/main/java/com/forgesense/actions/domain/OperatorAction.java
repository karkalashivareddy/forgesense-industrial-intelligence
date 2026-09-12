package com.forgesense.actions.domain;

import com.forgesense.common.domain.AbstractEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;

@Entity
@Table(name = "operator_action", indexes = @Index(columnList = "operatorName,performedAt"))
@Getter
@Setter
@NoArgsConstructor
public class OperatorAction extends AbstractEntity {

    @Column(nullable = false)
    private String operatorName;

    @Column(nullable = false)
    private String action;

    private String targetType;
    private String targetId;
    @Column(length = 2000)
    private String details;
    private Instant performedAt = Instant.now();
}