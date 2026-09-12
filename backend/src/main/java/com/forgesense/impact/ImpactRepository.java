package com.forgesense.impact;

import com.forgesense.impact.domain.ProductionImpact;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public interface ImpactRepository extends JpaRepository<ProductionImpact, UUID> {

    List<ProductionImpact> findTop20ByOriginMachineIdOrderByCreatedAtDesc(String machineId);

    long countBySimulatedAndCreatedAtAfter(boolean simulated, Instant after);
}