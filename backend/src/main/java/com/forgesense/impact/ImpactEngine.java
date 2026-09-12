package com.forgesense.impact;

import com.forgesense.impact.domain.ProductionImpact;
import com.forgesense.machine.MachineDependencyRepository;
import com.forgesense.machine.MachineRepository;
import com.forgesense.machine.domain.Criticality;
import com.forgesense.machine.domain.Machine;
import com.forgesense.machine.domain.MachineDependency;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;
import java.util.stream.Collectors;

/**
 * Estimates the operational consequence of a (predicted or simulated) failure.
 *
 * Method: BFS over the downstream dependency graph, applying per-edge
 * propagation factors and delay minutes, weighted by severity. All outputs are
 * clearly modeled ESTIMATES, never presented as measurement.
 */
@Service
public class ImpactEngine {

    private static final Logger log = LoggerFactory.getLogger(ImpactEngine.class);

    private static final double BASE_FAILURE_DOWNTIME_MIN = 30.0;

    private final MachineRepository machineRepository;
    private final MachineDependencyRepository dependencyRepository;
    private final ImpactRepository impactRepository;

    public ImpactEngine(MachineRepository machineRepository,
                        MachineDependencyRepository dependencyRepository,
                        ImpactRepository impactRepository) {
        this.machineRepository = machineRepository;
        this.dependencyRepository = dependencyRepository;
        this.impactRepository = impactRepository;
    }

    /** Model-based impact for a predicted (real-time) failure. */
    public ProductionImpact computeReal(String originMachineId, String impactType) {
        return compute(originMachineId, impactType, false, 1.0);
    }

    /** Model-based impact for a what-if scenario with a given severity (0..1). */
    public ProductionImpact computeScenario(String originMachineId, String impactType, double severity) {
        return compute(originMachineId, impactType, true, clamp01(severity));
    }

    public ProductionImpact compute(String originMachineId, String impactType, boolean simulated, double severity) {
        Machine origin = machineRepository.findByMachineId(originMachineId).orElse(null);
        if (origin == null) {
            log.warn("Impact requested for unknown machine {}", originMachineId);
            return null;
        }

        List<ImpactedNode> nodes = new ArrayList<>();
        Set<String> visited = new LinkedHashSet<>();
        Deque<ImpactedNode> queue = new ArrayDeque<>();
        visited.add(originMachineId);
        queue.add(new ImpactedNode(originMachineId, 1.0, 0));

        while (!queue.isEmpty()) {
            ImpactedNode node = queue.poll();
            List<MachineDependency> edges = dependencyRepository.findByUpstreamMachineId(node.machineId());
            for (MachineDependency edge : edges) {
                String downstreamId = edge.getDownstream().getMachineId();
                if (visited.contains(downstreamId)) continue;
                visited.add(downstreamId);
                double factor = node.factor() * clamp01(edge.getPropagationFactor());
                double delay = edge.getDelayMinutes() * Math.max(0.5, severity) * factor;
                ImpactedNode dn = new ImpactedNode(downstreamId, factor, delay);
                nodes.add(dn);
                queue.add(dn);
            }
        }

        double originDowntime = BASE_FAILURE_DOWNTIME_MIN * Math.max(0.5, severity);
        Map<String, ImpactedNode> byId = nodes.stream().collect(java.util.stream.Collectors.toMap(
                ImpactedNode::machineId, n -> n));

        double downtime = originDowntime;
        double throughputLoss = origin.getThroughputPerHour() == null ? 0 : origin.getThroughputPerHour() *
                (originDowntime / 60.0);
        for (ImpactedNode n : nodes) {
            double d = BASE_FAILURE_DOWNTIME_MIN * severity * n.factor() + n.delay();
            downtime += d;
            throughputLoss += machineOf(n.machineId()).map(m -> m.getThroughputPerHour() == null ? 0
                    : m.getThroughputPerHour() * (d / 60.0)).orElse(0.0);
        }

        List<String> affectedMachines = new ArrayList<>(visited);
        List<String> affectedLines = affectedMachines.stream()
                .map(m -> machineOf(m).map(mm -> mm.getProductionLine().getName()).orElse(""))
                .filter(s -> !s.isEmpty()).distinct().collect(Collectors.toList());
        List<String> affectedZones = affectedMachines.stream()
                .map(m -> machineOf(m).map(mm -> mm.getZone().getName()).orElse(""))
                .filter(s -> !s.isEmpty()).distinct().collect(Collectors.toList());

        ProductionImpact impact = new ProductionImpact();
        impact.setOriginMachineId(originMachineId);
        impact.setImpactType(impactType);
        impact.setSimulated(simulated);
        impact.setAffectedMachineIds(affectedMachines);
        impact.setAffectedLines(affectedLines);
        impact.setAffectedZones(affectedZones);
        impact.setAffectedMachineCount(affectedMachines.size());
        impact.setEstimatedDowntimeMinutes(round1(downtime));
        impact.setThroughputLossUnits(round1(throughputLoss));
        impact.setProductionLossUnits(round1(throughputLoss));
        impact.setCriticality(origin.getCriticality() == null ? Criticality.MEDIUM.name() : origin.getCriticality().name());
        impact.setRecoveryAssumption("Recovery begins immediately after maintenance completes; "
                + "downstream machines resume as production restarts.");
        impact.setAssumptionsJson(ProductionImpact.assumptionsDescriptions());
        impact.setBaselineAt(java.time.Instant.now());
        impact.setScenarioAt(java.time.Instant.now());

        impactRepository.save(impact);
        log.debug("Impact for {}: {} affected machines, ~{} min downtime (simulated={})",
                originMachineId, affectedMachines.size(), impact.getEstimatedDowntimeMinutes(), simulated);
        return impact;
    }

    private java.util.Optional<Machine> machineOf(String id) {
        return machineRepository.findByMachineId(id);
    }

    private static double clamp01(double v) {
        return Math.max(0.05, Math.min(1.0, v));
    }

    private static double round1(double v) {
        return Math.round(v * 10.0) / 10.0;
    }

    public record ImpactedNode(String machineId, double factor, double delay) {}
}