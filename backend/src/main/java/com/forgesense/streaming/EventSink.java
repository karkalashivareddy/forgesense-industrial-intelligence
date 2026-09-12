package com.forgesense.streaming;

import com.forgesense.common.domain.EventEnvelope;

/**
 * Anything that can consume an inbound event (Kafka listener or in-process bus).
 */
public interface EventSink {

    void handle(EventEnvelope envelope);
}