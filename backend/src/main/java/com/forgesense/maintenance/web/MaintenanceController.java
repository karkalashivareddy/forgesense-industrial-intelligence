package com.forgesense.maintenance.web;

import com.forgesense.maintenance.MaintenanceService;
import com.forgesense.maintenance.domain.MaintenanceRecord;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/maintenance")
public class MaintenanceController {

    private final MaintenanceService maintenanceService;

    public MaintenanceController(MaintenanceService maintenanceService) {
        this.maintenanceService = maintenanceService;
    }

    @GetMapping
    public Map<String, Object> list() {
        List<Map<String, Object>> items = maintenanceService.all().stream()
                .map(MaintenanceController::row).toList();
        return Map.of("items", items, "total", items.size());
    }

    @PostMapping("/{id}/schedule")
    public Map<String, Object> schedule(@PathVariable UUID id,
                                        @RequestBody(required = false) Map<String, String> body) {
        Instant at = body == null || !body.containsKey("scheduledAt") ? null : Instant.parse(body.get("scheduledAt"));
        return row(maintenanceService.schedule(id, at));
    }

    @PostMapping("/{id}/start")
    public Map<String, Object> start(@PathVariable UUID id, Authentication auth) {
        String operator = auth == null ? "operator" : auth.getName();
        return row(maintenanceService.start(id, operator));
    }

    @PostMapping("/{id}/complete")
    public Map<String, Object> complete(@PathVariable UUID id,
                                        @RequestBody(required = false) Map<String, String> body,
                                        Authentication auth) {
        String operator = auth == null ? "operator" : auth.getName();
        String notes = body == null ? null : body.get("notes");
        return row(maintenanceService.complete(id, operator, notes));
    }

    @PostMapping("/{id}/cancel")
    public Map<String, Object> cancel(@PathVariable UUID id, Authentication auth) {
        String operator = auth == null ? "operator" : auth.getName();
        return row(maintenanceService.cancel(id, operator));
    }

    static Map<String, Object> row(MaintenanceRecord r) {
        Map<String, Object> m = new java.util.HashMap<>();
        m.put("id", r.getId());
        m.put("machineId", r.getMachineId());
        m.put("machineName", r.getMachineName());
        m.put("title", r.getTitle());
        m.put("description", r.getDescription());
        m.put("recommendedAction", r.getRecommendedAction());
        m.put("priority", r.getPriority().name());
        m.put("status", r.getStatus().name());
        m.put("reason", r.getReason());
        m.put("assignedRole", r.getAssignedRole());
        m.put("estimatedDurationMinutes", r.getEstimatedDurationMinutes());
        m.put("scheduledAt", r.getScheduledAt() == null ? null : r.getScheduledAt().toString());
        m.put("startedAt", r.getStartedAt() == null ? null : r.getStartedAt().toString());
        m.put("completedAt", r.getCompletedAt() == null ? null : r.getCompletedAt().toString());
        m.put("resultSummary", r.getResultSummary());
        m.put("riskAtCreation", r.getRiskAtCreation());
        m.put("createdAt", r.getCreatedAt() == null ? null : r.getCreatedAt().toString());
        return m;
    }
}