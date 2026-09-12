package com.forgesense.streaming;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;

/**
 * Wires the shared pipeline to the in-process bus on the raw topic (dev mode).
 * Duplicate event guards live in the sink itself, so Kafka and bus behave alike.
 */
@Configuration
@Profile("!docker")
public class InMemoryIngressConfig {

    @Bean
    public InMemoryIngress inMemoryIngress(InMemoryEventBus bus, EventSink sink) {
        InMemoryIngress ingress = new InMemoryIngress(bus, sink);
        ingress.bind();
        return ingress;
    }

    static class InMemoryIngress {
        private final InMemoryEventBus bus;
        private final EventSink sink;

        InMemoryIngress(InMemoryEventBus bus, EventSink sink) {
            this.bus = bus;
            this.sink = sink;
        }

        void bind() {
            bus.subscribe("forge.telemetry.raw", sink::handle);
        }
    }
}