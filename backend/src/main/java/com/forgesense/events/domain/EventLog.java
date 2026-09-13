package com.forgesense.events.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;

/**
 * Operational event timeline entry, backed by real system events.
 */
@Entity
@Table(name = "event_log", indexes = {
        @Index(name = "idx_event_machine_time", columnList = "machineId,eventTime"),
        @Index(name = "idx_event_type", columnList = "eventType"),
        @Index(name = "idx_event_time", columnList = "eventTime")
})
@Getter
@Setter
@NoArgsConstructor
public class EventLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String eventType;

    private String machineId;

    @Column(nullable = false)
    private Instant eventTime;

    private String source;

    @JdbcTypeCode(SqlTypes.LONGVARCHAR)
    @Column(columnDefinition = "text")
    private String payloadJson;

    private String detail;
}