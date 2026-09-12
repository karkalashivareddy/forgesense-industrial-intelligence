package com.forgesense.maintenance;

import com.forgesense.maintenance.domain.MaintenanceRecord;
import com.forgesense.maintenance.domain.MaintenanceStatus;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public interface MaintenanceRepository extends JpaRepository<MaintenanceRecord, UUID> {

    List<MaintenanceRecord> findByStatusOrderByCreatedAtDesc(MaintenanceStatus status);

    List<MaintenanceRecord> findAllByOrderByCreatedAtDesc();

    long countByStatusAndCreatedAtAfter(MaintenanceStatus status, Instant after);

    long countByCreatedAtAfter(Instant after);
}