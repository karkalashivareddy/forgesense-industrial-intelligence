package com.forgesense.alert;

import com.forgesense.alert.domain.Alert;
import com.forgesense.alert.domain.AlertStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface AlertRepository extends JpaRepository<Alert, UUID> {

    Page<Alert> findByStatusOrderByOpenedAtDesc(AlertStatus status, Pageable pageable);

    Page<Alert> findAllByOrderByOpenedAtDesc(Pageable pageable);

    List<Alert> findTop20ByOrderByOpenedAtDesc();

    long countByStatus(AlertStatus status);

    long countByStatusAndSeverity(AlertStatus status, com.forgesense.alert.domain.AlertSeverity severity);

    long countByOpenedAtAfter(Instant after);

    Optional<Alert> findFirstByMachineIdAndStatusInOrderByOpenedAtDesc(String machineId, List<AlertStatus> statuses);

    Optional<Alert> findFirstByMachineIdAndTypeAndStatusInOrderByOpenedAtDesc(
            String machineId, String type, List<AlertStatus> statuses);
}
