package com.forgesense.alert.web;

import com.forgesense.actions.OperatorActionRepository;
import com.forgesense.actions.domain.OperatorAction;
import com.forgesense.alert.AlertService;
import com.forgesense.alert.domain.Alert;
import com.forgesense.alert.domain.AlertStatus;
import com.forgesense.alert.AlertRepository;
import org.springframework.data.domain.PageRequest;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import com.forgesense.common.errors.ApiException;

@RestController
@RequestMapping("/api/v1/alerts")
public class AlertController {

    private final AlertService alertService;
    private final AlertRepository alertRepository;
    private final OperatorActionRepository actionRepository;

    public AlertController(AlertService alertService, AlertRepository alertRepository,
                           OperatorActionRepository actionRepository) {
        this.alertService = alertService;
        this.alertRepository = alertRepository;
        this.actionRepository = actionRepository;
    }

    @GetMapping
    public Map<String, Object> list(@RequestParam(required = false) String status,
                                    @RequestParam(defaultValue = "50") int limit) {
        List<Alert> alerts;
        if (status != null && !status.isBlank()) {
            try {
                alerts = alertRepository.findByStatusOrderByOpenedAtDesc(AlertStatus.valueOf(status.toUpperCase()),
                        PageRequest.of(0, limit)).getContent();
            } catch (IllegalArgumentException e) {
                throw ApiException.badRequest("Unknown alert status: " + status);
            }
        } else {
            alerts = alertRepository.findAllByOrderByOpenedAtDesc(PageRequest.of(0, limit)).getContent();
        }
        return Map.of("items", alerts.stream().map(AlertController::row).toList(),
                "total", alerts.size(), "statusFilter", status == null ? "ALL" : status);
    }

    @GetMapping("/{id}")
    public Map<String, Object> get(@PathVariable java.util.UUID id) {
        Alert a = alertRepository.findById(id)
                .orElseThrow(() -> com.forgesense.common.errors.ApiException.notFound("Alert not found"));
        return row(a);
    }

    @PostMapping("/{id}/acknowledge")
    @PreAuthorize("hasAnyRole('OPERATOR', 'ENGINEER', 'ADMIN')")
    public Map<String, Object> acknowledge(@PathVariable java.util.UUID id, Authentication auth) {
        String operator = name(auth);
        audit(operator, "ACKNOWLEDGE_ALERT", "alert", id.toString());
        return row(alertService.acknowledge(id, operator));
    }

    @PostMapping("/{id}/investigate")
    @PreAuthorize("hasAnyRole('ENGINEER', 'ADMIN')")
    public Map<String, Object> investigate(@PathVariable java.util.UUID id, Authentication auth) {
        String operator = name(auth);
        audit(operator, "INVESTIGATE_ALERT", "alert", id.toString());
        return row(alertService.startInvestigation(id, operator));
    }

    @PostMapping("/{id}/resolve")
    @PreAuthorize("hasAnyRole('ENGINEER', 'ADMIN')")
    public Map<String, Object> resolve(@PathVariable java.util.UUID id,
                                       @RequestBody(required = false) Map<String, String> body,
                                       Authentication auth) {
        String operator = name(auth);
        String notes = body == null ? null : body.get("notes");
        audit(operator, "RESOLVE_ALERT", "alert", id.toString());
        return row(alertService.resolve(id, operator, notes));
    }

    static Map<String, Object> row(Alert a) {
        Map<String, Object> m = new java.util.HashMap<>();
        m.put("id", a.getId());
        m.put("machineId", a.getMachineId());
        m.put("machineName", a.getMachineName());
        m.put("machineType", a.getMachineType());
        m.put("severity", a.getSeverity().name());
        m.put("status", a.getStatus().name());
        m.put("type", a.getType());
        m.put("source", a.getSource());
        m.put("correlationId", a.getCorrelationId());
        m.put("headline", a.getHeadline());
        m.put("description", a.getDescription());
        m.put("factorsSummary", a.getFactorsSummary());
        m.put("recommendedAction", a.getRecommendedAction());
        m.put("riskAtCreation", a.getRiskAtCreation());
        m.put("openedAt", a.getOpenedAt() == null ? null : a.getOpenedAt().toString());
        m.put("updatedAt", a.getUpdatedAt() == null ? null : a.getUpdatedAt().toString());
        m.put("acknowledgedAt", a.getAcknowledgedAt() == null ? null : a.getAcknowledgedAt().toString());
        m.put("acknowledgedBy", a.getAcknowledgedBy());
        m.put("investigatingAt", a.getInvestigatingAt() == null ? null : a.getInvestigatingAt().toString());
        m.put("resolvedAt", a.getResolvedAt() == null ? null : a.getResolvedAt().toString());
        m.put("resolvedBy", a.getResolvedBy());
        m.put("resolutionNotes", a.getResolutionNotes());
        return m;
    }

    private String name(Authentication auth) {
        Object p = auth == null ? null : auth.getPrincipal();
        if (p instanceof org.springframework.security.core.userdetails.UserDetails ud) {
            return ud.getUsername();
        }
        if (p instanceof String s) {
            return s;
        }
        return p == null ? "operator" : p.toString();
    }

    private void audit(String operator, String action, String targetType, String targetId) {
        OperatorAction oa = new OperatorAction();
        oa.setOperatorName(operator);
        oa.setAction(action);
        oa.setTargetType(targetType);
        oa.setTargetId(targetId);
        actionRepository.save(oa);
    }
}
