package com.forgesense.events.web;

import com.forgesense.events.EventRepository;
import com.forgesense.events.domain.EventLog;
import org.springframework.data.domain.PageRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * Operational event timeline (non-financial operational events), backed by
 * real system events.
 */
@RestController
@RequestMapping("/api/v1/events")
public class EventController {

    private final EventRepository eventRepository;

    public EventController(EventRepository eventRepository) {
        this.eventRepository = eventRepository;
    }

    @GetMapping
    public Map<String, Object> timeline(@RequestParam(required = false) String machineId,
                                        @RequestParam(defaultValue = "50") int limit) {
        List<Map<String, Object>> items = (machineId == null || machineId.isBlank()
                ? eventRepository.findTop200ByOrderByEventTimeDesc()
                : eventRepository.findByMachineIdOrderByEventTimeDesc(machineId,
                        PageRequest.of(0, limit)).getContent()).stream()
                .map(EventController::row).toList();
        return Map.of("items", items, "count", items.size());
    }

    static Map<String, Object> row(EventLog e) {
        return Map.of(
                "id", e.getId(),
                "eventType", e.getEventType(),
                "machineId", e.getMachineId() == null ? "" : e.getMachineId(),
                "eventTime", e.getEventTime().toString(),
                "source", e.getSource() == null ? "" : e.getSource(),
                "detail", e.getDetail() == null ? "" : e.getDetail());
    }
}