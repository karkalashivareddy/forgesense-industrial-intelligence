package com.forgesense.events;

import com.forgesense.events.domain.EventLog;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.List;

public interface EventRepository extends JpaRepository<EventLog, Long> {

    Page<EventLog> findAllByOrderByEventTimeDesc(Pageable pageable);

    Page<EventLog> findByMachineIdOrderByEventTimeDesc(String machineId, Pageable pageable);

    List<EventLog> findTop200ByOrderByEventTimeDesc();

    long countByEventTimeAfter(Instant after);

    long countByEventType(String eventType);
}