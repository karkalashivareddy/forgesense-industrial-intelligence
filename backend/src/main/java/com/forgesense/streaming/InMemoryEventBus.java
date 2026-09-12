package com.forgesense.streaming;

import com.forgesense.common.domain.EventEnvelope;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;

/**
 * In-process event bus used for local development without Kafka.
 * Mirrors Kafka topic routing so the pipeline behaves identically.
 */
@Component
@Profile("!docker")
public class InMemoryEventBus implements EventBus {

    private final Map<String, List<Consumer<EventEnvelope>>> subscriptions = new ConcurrentHashMap<>();

    public void subscribe(String topic, Consumer<EventEnvelope> consumer) {
        subscriptions.computeIfAbsent(topic, k -> new CopyOnWriteArrayList<>()).add(consumer);
    }

    @Override
    public void publish(EventEnvelope envelope) {
        String topic = routeFor(envelope);
        List<Consumer<EventEnvelope>> listeners = subscriptions.get(topic);
        if (listeners != null) {
            for (Consumer<EventEnvelope> c : listeners) {
                try {
                    c.accept(envelope);
                } catch (Exception e) {
                    // one bad consumer must not kill the pipeline
                }
            }
        }
    }

    private String routeFor(EventEnvelope e) {
        String t = e.getEventType();
        if ("TELEMETRY_RECEIVED".equals(t)) return "forge.telemetry.raw";
        if (t.startsWith("TELEMETRY_")) return "forge.telemetry.normalized";
        if (t.startsWith("MACHINE_")) return "forge.machine.state";
        if (t.startsWith("ANOMALY_") || t.startsWith("PREDICTION_") || t.startsWith("FAILURE_RISK_"))
            return "forge.ml.predictions";
        if (t.startsWith("ALERT_")) return "forge.alerts";
        if (t.startsWith("MAINTENANCE_")) return "forge.maintenance";
        if (t.startsWith("SIMULATION_")) return "forge.simulation.commands";
        return "forge.machine.state";
    }
}