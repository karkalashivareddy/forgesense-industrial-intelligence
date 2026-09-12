package com.forgesense.streaming;

import com.forgesense.common.config.ForgeSenseProperties;
import org.springframework.stereotype.Component;

import java.util.Map;

/**
 * Maps canonical event types to Kafka topics (or in-process bus topics).
 * Central place so topic names stay consistent everywhere.
 */
@Component
public class EventRoutes {

    private final Map<String, String> topics;

    public EventRoutes(ForgeSenseProperties props) {
        this.topics = props.streaming().topics();
    }

    public String topicFor(String eventType) {
        if ("TELEMETRY_RECEIVED".equals(eventType)) return topics.get("raw");
        if (eventType.startsWith("TELEMETRY_")) return topics.get("normalized");
        if (eventType.startsWith("MACHINE_")) return topics.get("machine-state");
        if (eventType.startsWith("ANOMALY_") || eventType.startsWith("PREDICTION_") || eventType.startsWith("FAILURE_RISK_"))
            return topics.get("predictions");
        if (eventType.startsWith("ALERT_")) return topics.get("alerts");
        if (eventType.startsWith("MAINTENANCE_")) return topics.get("maintenance");
        if (eventType.startsWith("SIMULATION_")) return topics.get("simulation-commands");
        return topics.get("machine-state");
    }

    public String rawTopic() {
        return topics.get("raw");
    }
}