package com.forgesense.common.domain;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * Versioned event envelope published over Kafka (and the in-process bus).
 * Every event in the system travels in this shape.
 */
public class EventEnvelope {

    private String eventId;
    private String eventType;
    private String machineId;
    private Instant timestamp;
    private long sequence;
    private String source;
    private String schemaVersion = "1.0";
    private String correlationId;
    private Map<String, Object> payload;

    public EventEnvelope() {
    }

    public static EventEnvelope of(EventType type, String machineId, String source, Map<String, Object> payload) {
        EventEnvelope e = new EventEnvelope();
        e.setEventId(UUID.randomUUID().toString());
        e.setEventType(type.name());
        e.setMachineId(machineId);
        e.setTimestamp(Instant.now());
        e.setSource(source);
        e.setSchemaVersion("1.0");
        e.setCorrelationId(UUID.randomUUID().toString());
        e.setPayload(payload);
        return e;
    }

    public String getEventId() { return eventId; }
    public void setEventId(String eventId) { this.eventId = eventId; }
    public String getEventType() { return eventType; }
    public void setEventType(String eventType) { this.eventType = eventType; }
    public String getMachineId() { return machineId; }
    public void setMachineId(String machineId) { this.machineId = machineId; }
    public Instant getTimestamp() { return timestamp; }
    public void setTimestamp(Instant timestamp) { this.timestamp = timestamp; }
    public long getSequence() { return sequence; }
    public void setSequence(long sequence) { this.sequence = sequence; }
    public String getSource() { return source; }
    public void setSource(String source) { this.source = source; }
    public String getSchemaVersion() { return schemaVersion; }
    public void setSchemaVersion(String schemaVersion) { this.schemaVersion = schemaVersion; }
    public String getCorrelationId() { return correlationId; }
    public void setCorrelationId(String correlationId) { this.correlationId = correlationId; }
    public Map<String, Object> getPayload() { return payload; }
    public void setPayload(Map<String, Object> payload) { this.payload = payload; }
}