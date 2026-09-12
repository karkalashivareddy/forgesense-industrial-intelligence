package com.forgesense.streaming;

import com.forgesense.common.domain.EventEnvelope;

/**
 * Abstraction over the streaming transport. Production uses Kafka; dev uses an
 * in-process bus. Producers depend only on this interface.
 */
public interface EventBus {

    void publish(EventEnvelope envelope);
}