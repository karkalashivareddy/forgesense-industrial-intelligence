package com.forgesense.analytics;

import com.forgesense.alert.AlertRepository;
import com.forgesense.alert.domain.AlertSeverity;
import com.forgesense.alert.domain.AlertStatus;
import com.forgesense.maintenance.MaintenanceRepository;
import com.forgesense.maintenance.domain.MaintenanceStatus;
import com.forgesense.machine.MachineRepository;
import com.forgesense.machine.domain.Machine;
import com.forgesense.telemetry.TelemetryRepository;
import com.forgesense.events.EventRepository;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Aggregated analytics endpoints. Every metric states its basis:
 * OBSERVED (counted from system state), ESTIMATED (modeled assumption),
 * SIMULATED (simulation origin). Metrics are never fabricated.
 */
@Service
public class AnalyticsService {

    private final MachineRepository machineRepository;
    private final AlertRepository alertRepository;
    private final MaintenanceRepository maintenanceRepository;
    private final TelemetryRepository telemetryRepository;
    private final EventRepository eventRepository;

    public AnalyticsService(MachineRepository machineRepository, AlertRepository alertRepository,
                            MaintenanceRepository maintenanceRepository,
                            TelemetryRepository telemetryRepository,
                            EventRepository eventRepository) {
        this.machineRepository = machineRepository;
        this.alertRepository = alertRepository;
        this.maintenanceRepository = maintenanceRepository;
        this.telemetryRepository = telemetryRepository;
        this.eventRepository = eventRepository;
    }

    public Map<String, Object> overview() {
        List<Machine> machines = machineRepository.findAllByOrderByMachineId();
        long online = machines.stream().filter(m -> "ONLINE".equals(m.getConnectivity())).count();
        long atRisk = machines.stream().filter(m -> m.getFailureRisk() != null && m.getFailureRisk() >= 0.5).count();
        long critical = alertRepository.countByStatusAndSeverity(AlertStatus.NEW, AlertSeverity.CRITICAL)
                + alertRepository.countByStatusAndSeverity(AlertStatus.ACKNOWLEDGED, AlertSeverity.CRITICAL)
                + alertRepository.countByStatusAndSeverity(AlertStatus.INVESTIGATING, AlertSeverity.CRITICAL);
        double avgHealth = machines.isEmpty() ? 0 : machines.stream()
                .mapToDouble(m -> m.getHealthScore() == null ? 0 : m.getHealthScore()).average().orElse(0);
        long activeMaintenance = maintenanceRepository.findByStatusOrderByCreatedAtDesc(MaintenanceStatus.ACTIVE).size();
        double avgRisk = machines.isEmpty() ? 0 : machines.stream()
                .mapToDouble(m -> m.getFailureRisk() == null ? 0 : m.getFailureRisk()).average().orElse(0);
        double efficiency = Math.max(0, 100 - avgRisk * 100);

        Instant rangeFrom = Instant.now().minusSeconds(60);
        long telemetryInLastMin = telemetryRepository.countByTimestampAfter(rangeFrom);

        Map<String, Object> kpis = new LinkedHashMap<>();
        kpis.put("machinesOnline", online);
        kpis.put("machinesTotal", machines.size());
        kpis.put("machinesAtRisk", atRisk);
        kpis.put("criticalAlerts", critical);
        kpis.put("averageFleetHealth", Math.round(avgHealth));
        kpis.put("activeMaintenance", activeMaintenance);
        kpis.put("productionEfficiency", Map.of(
                "value", Math.round(efficiency),
                "label", "ESTIMATED - derived from average fleet failure risk"));
        kpis.put("telemetryThroughputPerMinute", telemetryInLastMin);
        kpis.put("estimatedDowntimeRiskMinutes", Math.round(atRisk * 30.0));
        kpis.put("dataBasis", List.of("OBSERVED", "ESTIMATED"));
        return kpis;
    }

    public List<Map<String, Object>> riskRanking() {
        List<Machine> machines = new ArrayList<>(machineRepository.findAllByOrderByMachineId());
        machines.sort((a, b) -> Double.compare(b.getFailureRisk() == null ? 0 : b.getFailureRisk(),
                a.getFailureRisk() == null ? 0 : a.getFailureRisk()));
        List<Map<String, Object>> out = new ArrayList<>();
        for (Machine m : machines) {
            out.add(Map.of(
                    "machineId", m.getMachineId(),
                    "name", m.getName(),
                    "type", m.getType().name(),
                    "zone", m.getZone().getName(),
                    "failureRisk", m.getFailureRisk() == null ? 0 : m.getFailureRisk(),
                    "anomalyScore", m.getAnomalyScore() == null ? 0 : m.getAnomalyScore(),
                    "status", m.getStatus().name(),
                    "criticality", m.getCriticality().name(),
                    "healthScore", m.getHealthScore() == null ? 0 : m.getHealthScore()));
        }
        return out;
    }

    public Map<String, Object> alertStats() {
        return Map.of(
                "open", alertRepository.countByStatus(AlertStatus.NEW)
                        + alertRepository.countByStatus(AlertStatus.ACKNOWLEDGED)
                        + alertRepository.countByStatus(AlertStatus.INVESTIGATING),
                "new", alertRepository.countByStatus(AlertStatus.NEW),
                "investigating", alertRepository.countByStatus(AlertStatus.INVESTIGATING),
                "resolvedToday", alertRepository.countByResolvedAtAfter(Instant.now().minusSeconds(86400)),
                "basis", "OBSERVED");
    }

    public Map<String, Object> fleetHealth() {
        List<Machine> machines = machineRepository.findAllByOrderByMachineId();
        Map<String, Object> out = new LinkedHashMap<>();
        List<Map<String, Object>> rows = new ArrayList<>();
        for (Machine m : machines) {
            rows.add(Map.of(
                    "machineId", m.getMachineId(),
                    "healthScore", m.getHealthScore() == null ? 0 : m.getHealthScore(),
                    "failureRisk", m.getFailureRisk() == null ? 0 : m.getFailureRisk()));
        }
        out.put("machines", rows);
        out.put("basis", "OBSERVED - current twin state");
        return out;
    }

    public Map<String, Object> maintenanceStats() {
        return Map.of(
                "recommended", maintenanceRepository.findByStatusOrderByCreatedAtDesc(MaintenanceStatus.RECOMMENDED).size(),
                "scheduled", maintenanceRepository.findByStatusOrderByCreatedAtDesc(MaintenanceStatus.SCHEDULED).size(),
                "active", maintenanceRepository.findByStatusOrderByCreatedAtDesc(MaintenanceStatus.ACTIVE).size(),
                "completed", maintenanceRepository.findByStatusOrderByCreatedAtDesc(MaintenanceStatus.COMPLETED).size(),
                "basis", "OBSERVED");
    }

    public Map<String, Object> eventFrequency() {
        return Map.of(
                "telemetry", eventRepository.countByEventType("TELEMETRY_RECEIVED"),
                "alerts", eventRepository.countByEventType("ALERT_CREATED"),
                "maintenance", eventRepository.countByEventType("MAINTENANCE_CREATED"),
                "simulations", eventRepository.countByEventType("SIMULATION_STARTED"),
                "basis", "OBSERVED");
    }
}