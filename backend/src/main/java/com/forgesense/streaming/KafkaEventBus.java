package com.forgesense.streaming;

import com.forgesense.common.config.ForgeSenseProperties;
import com.forgesense.common.domain.EventEnvelope;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Profile;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

/**
 * Kafka-backed event bus (used by the docker profile).
 */
@Component
@Profile("docker")
public class KafkaEventBus implements EventBus {

    private static final Logger log = LoggerFactory.getLogger(KafkaEventBus.class);

    private final KafkaTemplate<String, EventEnvelope> kafka;
    private final EventRoutes routes;

    public KafkaEventBus(KafkaTemplate<String, EventEnvelope> kafka, EventRoutes routes) {
        this.kafka = kafka;
        this.routes = routes;
    }

    @Override
    public void publish(EventEnvelope envelope) {
        String topic = routes.topicFor(envelope.getEventType());
        kafka.send(topic, envelope.getMachineId(), envelope)
                .whenComplete((meta, ex) -> {
                    if (ex != null) {
                        log.error("Kafka publish failed on {} for machine {}: {}",
                                topic, envelope.getMachineId(), ex.getMessage());
                    }
                });
    }
}