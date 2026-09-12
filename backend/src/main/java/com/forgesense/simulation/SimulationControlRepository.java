package com.forgesense.simulation;

import com.forgesense.simulation.domain.SimulationControl;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface SimulationControlRepository extends JpaRepository<SimulationControl, UUID> {

    Optional<SimulationControl> findByMachineId(String machineId);

    List<SimulationControl> findByActiveTrue();
}