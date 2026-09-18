package com.forgesense.impact.web;

import com.forgesense.impact.ImpactEngine;
import com.forgesense.impact.ImpactRepository;
import com.forgesense.impact.domain.ProductionImpact;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.security.access.prepost.PreAuthorize;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/impact")
public class ImpactController {

    private final ImpactEngine impactEngine;
    private final ImpactRepository impactRepository;

    public ImpactController(ImpactEngine impactEngine, ImpactRepository impactRepository) {
        this.impactEngine = impactEngine;
        this.impactRepository = impactRepository;
    }

    @GetMapping("/{machineId}")
    public Map<String, Object> impact(@PathVariable String machineId) {
        List<ProductionImpact> history = impactRepository.findTop20ByOriginMachineIdOrderByCreatedAtDesc(machineId);
        ProductionImpact latest = history.stream().filter(i -> !i.isSimulated()).findFirst()
                .orElse(history.stream().findFirst().orElse(null));
        if (latest == null) {
            return Map.of("machineId", machineId, "hasImpact", false,
                    "message", "No impact analysis recorded yet.");
        }
        return Map.of(
                "machineId", machineId,
                "hasImpact", true,
                "latest", row(latest),
                "history", history.stream().map(ImpactController::row).toList());
    }

    @PostMapping("/analyze")
    @PreAuthorize("hasAnyRole('ENGINEER', 'ADMIN')")
    public Map<String, Object> analyze(@RequestBody Map<String, Object> body) {
        String machineId = (String) body.get("machineId");
        ProductionImpact impact = impactEngine.computeReal(machineId, "MANUAL_REQUEST");
        if (impact == null) {
            return Map.of("machineId", machineId, "hasImpact", false);
        }
        return Map.of("machineId", machineId, "hasImpact", true, "latest", row(impact));
    }

    static Map<String, Object> row(ProductionImpact i) {
        Map<String, Object> m = new java.util.HashMap<>();
        m.put("id", i.getId());
        m.put("originMachineId", i.getOriginMachineId());
        m.put("impactType", i.getImpactType());
        m.put("simulated", i.isSimulated());
        m.put("affectedMachineIds", i.getAffectedMachineIds());
        m.put("affectedMachineCount", i.getAffectedMachineCount());
        m.put("affectedLines", i.getAffectedLines());
        m.put("affectedZones", i.getAffectedZones());
        m.put("estimatedDowntimeMinutes", i.getEstimatedDowntimeMinutes());
        m.put("throughputLossUnits", i.getThroughputLossUnits());
        m.put("productionLossUnits", i.getProductionLossUnits());
        m.put("criticality", i.getCriticality());
        m.put("recoveryAssumption", i.getRecoveryAssumption());
        m.put("assumptionsJson", i.getAssumptionsJson());
        m.put("createdAt", i.getCreatedAt() == null ? null : i.getCreatedAt().toString());
        m.put("dataLabel", "ESTIMATED - modeled assumption, not a measurement");
        return m;
    }
}
