package com.forgesense.simulation;

import com.forgesense.simulation.domain.SimulationScenario;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface SimulationRepository extends JpaRepository<SimulationScenario, UUID> {

    List<SimulationScenario> findTop50ByOrderByCreatedAtDesc();

    List<SimulationScenario> findByMachineIdOrderByCreatedAtDesc(String machineId);
}