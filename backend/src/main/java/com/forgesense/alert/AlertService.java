package com.forgesense.alert;

import com.forgesense.alert.domain.Alert;
import com.forgesense.alert.domain.AlertSeverity;
import com.forgesense.alert.domain.AlertStatus;
import com.forgesense.common.errors.ApiException;
import com.forgesense.events.EventLogService;
import com.forgesense.impact.ImpactEngine;
import com.forgesense.impact.domain.ProductionImpact;
import com.forgesense.machine.domain.Machine;
import com.forgesense.machine.twin.MachineTwin;
import com.forgesense.observability.ForgeMetrics;
import com.forgesense.prediction.domain.Assessment;
import com.forgesense.websocket.WsNotifier;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Alert lifecycle:
 * NEW -> ACKNOWLEDGED -> INVESTIGATING -> RESOLVED
 * Persists every transition, broadcasts over WebSocket and appends to the
 * operational timeline.
 */
@Service
public class AlertService {

    private final AlertRepository alertRepository;
    private final EventLogService eventLogService;
    private final WsNotifier ws;
    private final ForgeMetrics metrics;
    private final ImpactEngine impactEngine;

    public AlertService(AlertRepository alertRepository, EventLogService eventLogService,
                        WsNotifier ws, ForgeMetrics metrics, ImpactEngine impactEngine) {
        this.alertRepository = alertRepository;
        this.eventLogService = eventLogService;
        this.ws = ws;
        this.metrics = metrics;
        this.impactEngine = impactEngine;
    }

    @Transactional
    public Alert ensureAlert(MachineTwin twin, AlertSeverity severity, String type, String headline,
                             String description, Assessment assessment, String triggeredBy) {
        Alert existing = alertRepository.findFirstByMachineIdAndStatusInOrderByOpenedAtDesc(
                        twin.getMachineId(),
                        List.of(AlertStatus.NEW, AlertStatus.ACKNOWLEDGED, AlertStatus.INVESTIGATING))
                .orElse(null);
        if (existing != null) {
            existing.setSeverity(severity);
            existing.setType(type);
            existing.setHeadline(headline);
            existing.setDescription(description);
            existing.setRiskAtCreation(twin.getFailureRisk());
            existing.setFactorsSummary(serializeFactors(assessment));
            existing.setRecommendedAction(assessment == null
                    ? "Investigate contributing factors and schedule inspection."
                    : assessment.recommendations() == null || assessment.recommendations().isEmpty()
                    ? "Investigate contributing factors and schedule inspection."
                    : String.join(" ", assessment.recommendations()));
            return existing;
        }

        Alert alert = new Alert();
        alert.setMachineId(twin.getMachineId());
        alert.setMachineName(twin.getName());
        alert.setMachineType(twin.getMachineType());
        alert.setSeverity(severity);
        alert.setType(type);
        alert.setHeadline(headline);
        alert.setDescription(description);
        alert.setRiskAtCreation(twin.getFailureRisk());
        alert.setFactorsSummary(serializeFactors(assessment));
        alert.setRecommendedAction(assessment.recommendations() == null || assessment.recommendations().isEmpty()
                ? "Investigate contributing factors and schedule inspection." : String.join(" ", assessment.recommendations()));
        alert.setOpenedAt(Instant.now());
        alertRepository.save(alert);

        metrics.alertsCounter().increment();
        metrics.perTypeAlert(type).increment();
        if (severity == AlertSeverity.CRITICAL) {
            metrics.recordAnomaly();
        }

        eventLogService.append("ALERT_CREATED", twin.getMachineId(), triggeredBy == null ? "decision-engine" : triggeredBy,
                alert.getHeadline(), Map.of("alertId", alert.getId(), "severity", severity.name()));

        ws.broadcast("alert.created", toPayload(alert));

        if (severity == AlertSeverity.CRITICAL) {
            ProductionImpact impact = impactEngine.computeReal(twin.getMachineId(), "PREDICTED_FAILURE");
            if (impact != null) {
                ws.broadcast("impact.updated", Map.of(
                        "machineId", twin.getMachineId(),
                        "downtimeMinutes", impact.getEstimatedDowntimeMinutes(),
                        "affectedMachines", impact.getAffectedMachineCount(),
                        "lossUnits", impact.getProductionLossUnits()));
            }
        }
        return alert;
    }

    @Transactional
    public Alert acknowledge(UUID id, String operator) {
        Alert a = require(id);
        if (a.getStatus() == AlertStatus.NEW) {
            a.setStatus(AlertStatus.ACKNOWLEDGED);
            a.setAcknowledgedAt(Instant.now());
            a.setAcknowledgedBy(operator);
            alertRepository.save(a);
            eventLogService.append("ALERT_ACKNOWLEDGED", a.getMachineId(), operator,
                    "Operator acknowledged alert " + truncate(a.getHeadline()), null);
            ws.broadcast("alert.updated", toPayload(a));
        }
        return a;
    }

    @Transactional
    public Alert startInvestigation(UUID id, String operator) {
        Alert a = require(id);
        if (a.getStatus() == AlertStatus.NEW || a.getStatus() == AlertStatus.ACKNOWLEDGED) {
            a.setStatus(AlertStatus.INVESTIGATING);
            a.setInvestigatingAt(Instant.now());
            alertRepository.save(a);
            eventLogService.append("ALERT_INVESTIGATING", a.getMachineId(), operator,
                    "Engineer started investigation", null);
            ws.broadcast("alert.updated", toPayload(a));
        }
        return a;
    }

    @Transactional
    public Alert resolve(UUID id, String operator, String notes) {
        Alert a = require(id);
        a.setStatus(AlertStatus.RESOLVED);
        a.setResolvedAt(Instant.now());
        a.setResolvedBy(operator);
        a.setResolutionNotes(notes);
        alertRepository.save(a);
        eventLogService.append("ALERT_RESOLVED", a.getMachineId(), operator,
                "Alert resolved: " + truncate(notes), null);
        ws.broadcast("alert.updated", toPayload(a));
        return a;
    }

    private static String serializeFactors(Assessment a) {
        if (a.factors() == null || a.factors().isEmpty()) return "";
        StringBuilder sb = new StringBuilder();
        for (var f : a.factors()) {
            sb.append(f.feature()).append(":").append(Math.round(f.contribution() * 100)).append("% ");
        }
        return sb.toString().trim();
    }

    private static Map<String, Object> toPayload(Alert a) {
        return Map.of(
                "id", a.getId(),
                "machineId", a.getMachineId(),
                "machineName", a.getMachineName(),
                "severity", a.getSeverity().name(),
                "status", a.getStatus().name(),
                "type", a.getType(),
                "headline", a.getHeadline(),
                "riskAtCreation", a.getRiskAtCreation(),
                "openedAt", a.getOpenedAt() == null ? null : a.getOpenedAt().toString());
    }

    private static String truncate(String s) {
        if (s == null || s.length() <= 80) return s == null ? "" : s;
        return s.substring(0, 80) + "...";
    }

    private Alert require(UUID id) {
        return alertRepository.findById(id)
                .orElseThrow(() -> ApiException.notFound("Alert not found: " + id));
    }
}