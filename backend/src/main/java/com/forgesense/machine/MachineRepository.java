package com.forgesense.machine;

import com.forgesense.machine.domain.Machine;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface MachineRepository extends JpaRepository<Machine, UUID> {

    Optional<Machine> findByMachineId(String machineId);

    List<Machine> findAllByOrderByMachineId();

    long countByConnectivity(String connectivity);

    List<Machine> findByStatus(com.forgesense.machine.domain.MachineState status);
}