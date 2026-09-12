package com.forgesense.telemetry;

import com.forgesense.telemetry.domain.TelemetryRecord;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;

public interface TelemetryRepository extends JpaRepository<TelemetryRecord, Long> {

    Page<TelemetryRecord> findByMachineIdOrderByTimestampDesc(String machineId, Pageable pageable);

    @Query("select t from TelemetryRecord t where t.machineId = :machineId and t.timestamp between :from and :to " +
            "order by t.timestamp asc")
    List<TelemetryRecord> findRange(@Param("machineId") String machineId,
                                    @Param("from") Instant from,
                                    @Param("to") Instant to);

    long countByTimestampAfter(Instant after);
}