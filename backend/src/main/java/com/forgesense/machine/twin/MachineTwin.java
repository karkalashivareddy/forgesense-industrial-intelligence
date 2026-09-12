package com.forgesense.machine.twin;

import com.forgesense.machine.domain.Criticality;
import com.forgesense.machine.domain.MachineState;
import com.forgesense.telemetry.domain.TelemetrySample;

import java.time.Instant;

/**
 * Synchronized software representation of a physical machine's operational
 * state — the digital twin. One instance per machine, owned by TwinService.
 */
public class MachineTwin {

    private final String machineId;
    private String name;
    private String machineType;
    private String zoneCode;
    private String lineCode;

    private volatile MachineState status = MachineState.NORMAL;
    private volatile String connectivity = "ONLINE";

    private volatile double anomalyScore;
    private volatile String anomalyLabel = "LOW";
    private volatile double failureRisk;
    private volatile double healthScore = 98;
    private volatile double rulEstimate = 900;

    private volatile String modelVersion = "none";
    private volatile String modelMode = "MODEL";

    private volatile Instant lastTelemetryAt;
    private volatile long lastSequence;
    private TelemetrySample latestSample;

    private final Object lock = new Object();

    public MachineTwin(String machineId) {
        this.machineId = machineId;
    }

    public void updateSample(TelemetrySample sample) {
        synchronized (lock) {
            this.latestSample = sample;
            this.lastTelemetryAt = sample.timestamp();
            this.lastSequence = sample.sequence();
        }
    }

    public TelemetrySample latestSample() {
        synchronized (lock) {
            return latestSample;
        }
    }

    public String getMachineId() { return machineId; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getMachineType() { return machineType; }
    public void setMachineType(String machineType) { this.machineType = machineType; }
    public String getZoneCode() { return zoneCode; }
    public void setZoneCode(String zoneCode) { this.zoneCode = zoneCode; }
    public String getLineCode() { return lineCode; }
    public void setLineCode(String lineCode) { this.lineCode = lineCode; }

    public MachineState getStatus() { return status; }
    public void setStatus(MachineState status) { this.status = status; }
    public String getConnectivity() { return connectivity; }
    public void setConnectivity(String connectivity) { this.connectivity = connectivity; }

    public double getAnomalyScore() { return anomalyScore; }
    public void setAnomalyScore(double anomalyScore) { this.anomalyScore = anomalyScore; }
    public String getAnomalyLabel() { return anomalyLabel; }
    public void setAnomalyLabel(String anomalyLabel) { this.anomalyLabel = anomalyLabel; }
    public double getFailureRisk() { return failureRisk; }
    public void setFailureRisk(double failureRisk) { this.failureRisk = failureRisk; }
    public double getHealthScore() { return healthScore; }
    public void setHealthScore(double healthScore) { this.healthScore = healthScore; }
    public double getRulEstimate() { return rulEstimate; }
    public void setRulEstimate(double rulEstimate) { this.rulEstimate = rulEstimate; }
    public String getModelVersion() { return modelVersion; }
    public void setModelVersion(String modelVersion) { this.modelVersion = modelVersion; }
    public String getModelMode() { return modelMode; }
    public void setModelMode(String modelMode) { this.modelMode = modelMode; }
    public Instant getLastTelemetryAt() { return lastTelemetryAt; }
    public long getLastSequence() { return lastSequence; }

    public double criticalityWeight() {
        return 1.0;
    }
}