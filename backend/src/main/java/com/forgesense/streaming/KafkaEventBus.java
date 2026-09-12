package com.forgesense.streaming;

import com.forgesense.common.config.ForgeSenseProperties;
import com.forgesense.common.domain.EventEnvelope;
import org.springframework.context.annotation.Profile;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

import java.util.concurrent.CompletableFuture;

/**
 * Kafka-backed event bus (used by the docker profile).
 */
@Component
@Profile("docker")
public class KafkaEventBus implements EventBus {

    private final KafkaTemplate<String, EventEnvelope> kafka;
    private final EventRoutes routes;

    public KafkaEventBus(KafkaTemplate<String, EventEnvelope> kafka, EventRoutes routes) {
        this.kafka = kafka;
        this.routes = routes;
    }

    @Override
    public void publish(EventEnvelope envelope) {
        String topic = routes.topicFor(envelope.getEventType());
        CompletableFuture<Void> sent = kafka.send(topic, envelope.getMachineId(), envelope)
                .thenAccept(meta -> { /* nothing */ });
        sent.exceptionally(ex -> {
            throw new IllegalStateException("Kafka publish failed on " + topic, ex);
        });
    }
}