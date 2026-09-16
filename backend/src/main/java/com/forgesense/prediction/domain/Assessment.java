package com.forgesense.prediction.domain;

import java.util.List;

/**
 * Complete model assessment for a machine at a point in time.
 * mode = MODEL (FastAPI) | HEURISTIC (documented fallback).
 */
public record Assessment(
        String machineId,
        double anomalyScore,
        String anomalyLabel,
        double failureRisk,
        double healthScore,
        double rulEstimate,
        String rulUnit,
        String modelVersion,
        String anomalyModelVersion,
        String mode,
        List<Prediction.Factor> factors,
        List<String> recommendations
) {
    /** Compatibility constructor for existing heuristic/test callers. */
    public Assessment(String machineId, double anomalyScore, String anomalyLabel,
                      double failureRisk, double healthScore, double rulEstimate,
                      String modelVersion, String mode, List<Prediction.Factor> factors,
                      List<String> recommendations) {
        this(machineId, anomalyScore, anomalyLabel, failureRisk, healthScore, rulEstimate,
                "steps", modelVersion, "unavailable", mode, factors, recommendations);
    }
}
