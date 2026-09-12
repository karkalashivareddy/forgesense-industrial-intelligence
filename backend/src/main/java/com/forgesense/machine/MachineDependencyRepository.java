package com.forgesense.machine;

import com.forgesense.machine.domain.MachineDependency;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface MachineDependencyRepository extends JpaRepository<MachineDependency, UUID> {

    List<MachineDependency> findByUpstreamMachineId(String machineId);

    List<MachineDependency> findByDownstreamMachineId(String machineId);

    List<MachineDependency> findAllByOrderByCreatedAt();
}