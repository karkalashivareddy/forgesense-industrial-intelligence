package com.forgesense.prediction;

import com.forgesense.prediction.domain.Assessment;
import com.forgesense.prediction.domain.Prediction;
import com.forgesense.telemetry.domain.TelemetrySample;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

/**
 * Deterministic heuristic scorer used ONLY when the ML service is unreachable.
 * Clearly labeled HEURISTIC. Assumptions: sensor baselines below are modeled
 * engineering defaults, not learned parameters. See docs/EXPLAINABILITY.md.
 */
@Component
public class HeuristicMlClient implements MlClient {

    private static final Map<String, double[]> BASELINES = Map.ofEntries(
            Map.entry("temperature", new double[]{75.0, 6.0, 1.0}),
            Map.entry("vibration", new double[]{2.2, 0.7, 2.0}),
            Map.entry("pressure", new double[]{4.5, 0.6, 3.0}),
            Map.entry("rpm", new double[]{1400.0, 90.0, 4.0}),
            Map.entry("torque", new double[]{180.0, 28.0, 5.0}),
            Map.entry("current", new double[]{12.0, 2.2, 6.0}),
            Map.entry("voltage", new double[]{415.0, 12.0, 7.0}),
            Map.entry("power", new double[]{55.0, 9.0, 8.0}),
            Map.entry("flow", new double[]{120.0, 14.0, 9.0}),
            Map.entry("frequency", new double[]{50.0, 1.5, 10.0}));

    private record SensorHit(String feature, String label, double value, double mean, double z) {}

    @Override
    public boolean isAvailable() {
        return true;
    }

    @Override
    public Assessment assess(TelemetrySample s) {
        List<SensorHit> hits = new ArrayList<>();
        add(hits, s.temperature(), "temperature", "Temperature");
        add(hits, s.vibration(), "vibration", "Vibration");
        add(hits, s.pressure(), "pressure", "Pressure");
        add(hits, s.rpm(), "rpm", "Rotational speed");
        add(hits, s.torque(), "torque", "Torque");
        add(hits, s.current(), "current", "Current");
        add(hits, s.voltage(), "voltage", "Voltage");
        add(hits, s.power(), "power", "Power");
        add(hits, s.flow(), "flow", "Flow");
        add(hits, s.frequency(), "frequency", "Frequency");

        double maxAnomaly = 0.05;
        double sumDev = 0;
        for (SensorHit h : hits) {
            double anomaly = sigmoid(h.z(), 2.2, 0.85);
            maxAnomaly = Math.max(maxAnomaly, anomaly);
            sumDev += h.z();
        }
        double meanDev = hits.isEmpty() ? 0 : sumDev / hits.size();

        double age = s.operatingHours() == null ? 0 : Math.min(1.0, s.operatingHours() / 5000.0);
        double failureRisk = clamp(0.45 * maxAnomaly + 0.35 * sigmoid(meanDev, 2.5, 0.8) + 0.20 * age, 0.02, 0.97);
        double health = clamp(100 - (failureRisk * 65 + maxAnomaly * 35), 5, 100);
        double rul = Math.max(24, Math.round((1 - failureRisk) * 800));
        String label = maxAnomaly > 0.7 ? "CRITICAL" : maxAnomaly > 0.45 ? "HIGH" : maxAnomaly > 0.25 ? "MEDIUM" : "LOW";

        List<Prediction.Factor> factors = new ArrayList<>();
        for (SensorHit h : hits) {
            if (h.z() > 1.5) {
                factors.add(new Prediction.Factor(h.feature(), round(sigmoid(h.z(), 2.2, 0.85)),
                        h.label(), h.value() > h.mean() ? "increased" : "decreased"));
            }
        }
        factors.sort(Comparator.comparingDouble(Prediction.Factor::contribution).reversed());

        List<String> recs = recommendations(failureRisk, maxAnomaly, s);

        return new Assessment(s.machineId(), round(maxAnomaly), label, round(failureRisk), health, rul,
                "heuristic-v1", "HEURISTIC", factors.size() > 5 ? factors.subList(0, 5) : factors, recs);
    }

    private void add(List<SensorHit> hits, Double val, String feature, String label) {
        if (val == null) return;
        double[] base = BASELINES.get(feature);
        if (base == null) return;
        hits.add(new SensorHit(feature, label, val, base[0], Math.abs(val - base[0]) / base[1]));
    }

    private static List<String> recommendations(double risk, double anomaly, TelemetrySample s) {
        List<String> recs = new ArrayList<>();
        if (risk >= 0.8) recs.add("Critical risk: inspect drive assembly and bearing condition.");
        else if (risk >= 0.5) recs.add("Elevated risk: plan technical inspection within 24 hours.");
        if (anomaly >= 0.6) recs.add("Anomaly signature detected: verify sensor cabling and mounting.");
        if (s.temperature() != null && s.temperature() > 88) recs.add("Temperature elevated: increase cooling flow.");
        if (s.vibration() != null && s.vibration() > 5.0) recs.add("Vibration elevated: check bearing wear and balance.");
        return recs.isEmpty() ? List.of("No action required — all signals within normal bounds.") : recs;
    }

    private static double sigmoid(double x, double midpoint, double steepness) {
        return 1.0 / (1.0 + Math.exp(-steepness * (x - midpoint)));
    }

    private static double clamp(double v, double lo, double hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    private static double round(double v) {
        return Math.round(v * 1000.0) / 1000.0;
    }
}