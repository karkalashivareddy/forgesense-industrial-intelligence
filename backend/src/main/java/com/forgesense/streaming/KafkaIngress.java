package com.forgesense.streaming;

import com.forgesense.common.domain.EventEnvelope;
import com.forgesense.common.errors.ApiException;
import org.springframework.context.annotation.Profile;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

/**
 * Kafka ingress. Active only in the docker profile. Forwards raw telemetry
 * envelopes received on the Kafka topic into the shared pipeline.
 */
@Component
@Profile("docker")
public class KafkaIngress {

    private final EventSink sink;

    public KafkaIngress(EventSink sink) {
        this.sink = sink;
    }

    @KafkaListener(
            topics = "${forgesense.streaming.topics.raw}",
            concurrency = "1",
            containerFactory = "rawTelemetryKafkaListenerContainerFactory")
    public void onRaw(EventEnvelope envelope) {
        sink.handle(envelope);
    }
}