package com.forgesense.prediction.domain;

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
import java.util.ArrayList;
import java.util.List;

/**
 * A prediction snapshot: anomaly + failure risk + contributing factors
 * (SHAP attribution when the ML service is available).
 */
@Entity
@Table(name = "prediction", indexes = {
        @Index(name = "idx_pred_machine_time", columnList = "machineId,timestamp"),
        @Index(name = "idx_pred_time", columnList = "timestamp")
})
@Getter
@Setter
@NoArgsConstructor
public class Prediction extends AbstractEntity {

    @Column(nullable = false)
    private String machineId;

    @Column(nullable = false)
    private Instant timestamp;

    private String modelVersion;

    private double anomalyScore;
    private String anomalyLabel;

    private double failureRisk;
    private double healthScore;

    private String mode;

    @JdbcTypeCode(SqlTypes.JSON)
    private List<Factor> factors = new ArrayList<>();

    public record Factor(String feature, double contribution, String label, String direction) {}
}