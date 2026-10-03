package com.forgesense.prediction;

import com.forgesense.prediction.domain.Assessment;
import com.forgesense.prediction.domain.Prediction;
import com.forgesense.profiles.MachineProfileCatalog;
import com.forgesense.telemetry.domain.TelemetrySample;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

/**
 * Deterministic heuristic scorer used ONLY when the ML service is unreachable.
 * Clearly labeled HEURISTIC.
 *
 * <p>Baselines come from {@code config/machine_profiles.json} - the same
 * per-machine-type sensor means and standard deviations the simulator itself
 * generates from. They are modelled engineering defaults, not learned
 * parameters, and the result is labelled {@code HEURISTIC} so no consumer can
 * mistake it for model inference.
 *
 * <p>This previously scored against a single hardcoded table shared by every
 * machine type, which was wrong in both directions: a robotic arm running at its
 * normal speed, or a cooling unit drawing its normal current, landed many
 * standard deviations from a baseline written for some other asset, so healthy
 * machines were reported as anomalies. In degraded mode that made an entire
 * healthy fleet read as CRITICAL. Scoring against the asset's own profile is
 * what makes the fallback a usable substitute rather than noise.
 */
@Component
public class HeuristicMlClient implements MlClient {

    /**
     * Used only when an asset's type is absent from the catalog, so the scorer
     * still returns a labelled result rather than refusing to score. These are
     * deliberately conservative mid-range defaults, not a general model.
     */
    private static final Map<String, double[]> FALLBACK_BASELINES = Map.ofEntries(
            Map.entry("temperature", new double[]{60.0, 5.0}),
            Map.entry("vibration", new double[]{1.0, 0.5}),
            Map.entry("pressure", new double[]{5.0, 1.0}),
            Map.entry("rpm", new double[]{1500.0, 300.0}),
            Map.entry("torque", new double[]{60.0, 25.0}),
            Map.entry("current", new double[]{20.0, 10.0}),
            Map.entry("voltage", new double[]{470.0, 20.0}),
            Map.entry("power", new double[]{12.0, 8.0}),
            Map.entry("flow", new double[]{150.0, 80.0}),
            Map.entry("frequency", new double[]{60.0, 1.0}));

    /** Display label per sensor key, used in attribution factors. */
    private static final Map<String, String> SENSOR_LABELS = Map.ofEntries(
            Map.entry("temperature", "Temperature"),
            Map.entry("vibration", "Vibration"),
            Map.entry("pressure", "Pressure"),
            Map.entry("rpm", "Rotational speed"),
            Map.entry("torque", "Torque"),
            Map.entry("current", "Current"),
            Map.entry("voltage", "Voltage"),
            Map.entry("power", "Power"),
            Map.entry("flow", "Flow"),
            Map.entry("frequency", "Frequency"));

    private final MachineProfileCatalog catalog;

    public HeuristicMlClient(MachineProfileCatalog catalog) {
        this.catalog = catalog;
    }

    private record SensorHit(String feature, String label, double value, double mean, double z) {}

    @Override
    public boolean isAvailable() {
        return true;
    }

    @Override
    public Assessment assess(TelemetrySample s) {
        Map<String, MachineProfileCatalog.SensorProfile> baselines = baselinesFor(s);

        List<SensorHit> hits = new ArrayList<>();
        add(hits, s.temperature(), "temperature", baselines);
        add(hits, s.vibration(), "vibration", baselines);
        add(hits, s.pressure(), "pressure", baselines);
        add(hits, s.rpm(), "rpm", baselines);
        add(hits, s.torque(), "torque", baselines);
        add(hits, s.current(), "current", baselines);
        add(hits, s.voltage(), "voltage", baselines);
        add(hits, s.power(), "power", baselines);
        add(hits, s.flow(), "flow", baselines);
        add(hits, s.frequency(), "frequency", baselines);

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
        double rul = Math.max(0, Math.round((1 - failureRisk) * 60));
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
                "steps", "heuristic-v2", "heuristic-v2", "HEURISTIC",
                factors.size() > 5 ? factors.subList(0, 5) : factors, recs);
    }

    /**
     * Resolve the sensor baselines for this asset's own machine type.
     *
     * <p>The catalog maps machine ID to type, so the profile is correct even
     * when the sample omits {@code machineType}. Falls back to the conservative
     * table only for an unknown asset, so an unrecognised machine is scored
     * against wide bounds rather than being reported as anomalous by
     * construction.
     */
    private Map<String, MachineProfileCatalog.SensorProfile> baselinesFor(TelemetrySample s) {
        String typeKey = null;
        if (s.machineId() != null) {
            // Preferred: the catalog already maps machine ID to type, so the
            // profile is right even when the sample omits machineType.
            typeKey = catalog.machine(s.machineId()).map(MachineProfileCatalog.MachineSpec::type).orElse(null);
        }
        if (typeKey == null) {
            typeKey = s.machineType();
        }
        if (typeKey == null) {
            return null;
        }
        MachineProfileCatalog.TypeProfile type = catalog.data().machineTypes().get(typeKey);
        if (type == null || type.sensors() == null || type.sensors().isEmpty()) {
            return null;
        }
        return type.sensors();
    }

    private void add(List<SensorHit> hits, Double val, String feature,
                     Map<String, MachineProfileCatalog.SensorProfile> baselines) {
        if (val == null) return;
        double mean;
        double std;
        if (baselines != null) {
            MachineProfileCatalog.SensorProfile profile = baselines.get(feature);
            // A type that does not carry this sensor must not be scored on it.
            if (profile == null) return;
            mean = profile.mean();
            std = profile.std() <= 0 ? 1.0 : profile.std();
        } else {
            double[] base = FALLBACK_BASELINES.get(feature);
            if (base == null) return;
            mean = base[0];
            std = base[1];
        }
        hits.add(new SensorHit(feature, SENSOR_LABELS.getOrDefault(feature, feature),
                val, mean, Math.abs(val - mean) / std));
    }

    private static List<String> recommendations(double risk, double anomaly, TelemetrySample s) {
        List<String> recs = new ArrayList<>();
        if (risk >= 0.8) recs.add("Critical risk: inspect drive assembly and bearing condition.");
        else if (risk >= 0.5) recs.add("Elevated risk: plan technical inspection within 24 hours.");
        if (anomaly >= 0.6) recs.add("Anomaly signature detected: verify sensor cabling and mounting.");
        if (s.temperature() != null && s.temperature() > 88) recs.add("Temperature elevated: increase cooling flow.");
        if (s.vibration() != null && s.vibration() > 5.0) recs.add("Vibration elevated: check bearing wear and balance.");
        return recs.isEmpty() ? List.of("No action required - all signals within normal bounds.") : recs;
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
