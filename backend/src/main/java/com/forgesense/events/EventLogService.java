package com.forgesense.events;

import com.forgesense.common.domain.EventEnvelope;
import com.forgesense.events.domain.EventLog;
import com.forgesense.observability.ForgeMetrics;
import com.forgesense.websocket.WsNotifier;
import tools.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Appends operational events to the persisted timeline and broadcasts to
 * WebSocket. Keeps a throttle map so telemetry floods don't produce one
 * event per sample at the debug level.
 */
@Service
public class EventLogService {

    private static final Logger log = LoggerFactory.getLogger(EventLogService.class);

    private final EventRepository eventRepository;
    private final WsNotifier ws;
    private final ObjectMapper objectMapper;
    private final ForgeMetrics metrics;

    // throttle: per machineId+eventType, minimum interval
    private final Map<String, Long> lastEmitted = new ConcurrentHashMap<>();

    public EventLogService(EventRepository eventRepository, WsNotifier ws, ObjectMapper objectMapper,
                           ForgeMetrics metrics) {
        this.eventRepository = eventRepository;
        this.ws = ws;
        this.objectMapper = objectMapper;
        this.metrics = metrics;
    }

    /**
     * Persist an operational event to the timeline and broadcast over WS.
     * Throttles low-value events (e.g. telemetry received) to at most one per
     * machine per 5 seconds to avoid bloating the DB and WS.
     */
    public void append(String eventType, String machineId, String source, String detail,
                       Map<String, Object> payload) {
        append(eventType, machineId, source, detail, payload, false);
    }

    public void append(String eventType, String machineId, String source, String detail,
                       Map<String, Object> payload, boolean throttle) {
        if (throttle) {
            String key = machineId + ":" + eventType;
            long now = System.currentTimeMillis();
            Long last = lastEmitted.get(key);
            if (last != null && now - last < 5000) {
                return;
            }
            lastEmitted.put(key, now);
        }

        EventLog e = new EventLog();
        e.setEventType(eventType);
        e.setMachineId(machineId);
        e.setEventTime(java.time.Instant.now());
        e.setSource(source);
        e.setDetail(detail);
        try {
            e.setPayloadJson(payload == null ? null : objectMapper.writeValueAsString(payload));
        } catch (Exception ex) {
            e.setPayloadJson(null);
        }
        eventRepository.save(e);
        metrics.recordEvent();

        ws.broadcast("events.updated", Map.of(
                "eventType", eventType,
                "machineId", machineId == null ? "" : machineId,
                "eventTime", e.getEventTime().toString(),
                "detail", detail == null ? "" : detail
        ));
    }

    public void appendEnvelope(EventEnvelope envelope) {
        String detail = envelope.getEventType() + " on " + (envelope.getMachineId() == null ? "system" : envelope.getMachineId());
        append(envelope.getEventType(), envelope.getMachineId(), envelope.getSource(), detail,
                envelope.getPayload(), true);
    }

    public List<EventLog> timeline(String machineId, int limit) {
        if (machineId != null && !machineId.isBlank()) {
            return eventRepository.findByMachineIdOrderByEventTimeDesc(machineId,
                    org.springframework.data.domain.PageRequest.of(0, limit)).getContent();
        }
        return eventRepository.findTop200ByOrderByEventTimeDesc();
    }
}