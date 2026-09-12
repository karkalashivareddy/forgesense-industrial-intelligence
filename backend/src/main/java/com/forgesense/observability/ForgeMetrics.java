package com.forgesense.observability;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Central metric registry. Every counter/gauge/histogram is registered once
 * here, preventing duplicates and keeping metric names canonical.
 */
@Component
public class ForgeMetrics {

    private final Counter telemetryReceived;
    private final Counter telemetryDropped;
    private final Counter predictionsTotal;
    private final Counter anomaliesTotal;
    private final Counter alertsTotal;
    private final Counter maintenanceTotal;
    private final Counter simulationRuns;
    private final Counter eventsTotal;
    private final Timer telemetryProcessingLatency;
    private final AtomicLong machinesOnline = new AtomicLong(0);
    private final AtomicLong websocketConnections = new AtomicLong(0);
    private final MeterRegistry registry;
    private final Map<String, Counter> perTypeAlerts = new ConcurrentHashMap<>();

    public ForgeMetrics(MeterRegistry registry) {
        this.registry = registry;
        this.telemetryReceived = Counter.builder("forgesense.telemetry.received.total")
                .description("Total telemetry samples received").register(registry);
        this.telemetryDropped = Counter.builder("forgesense.telemetry.dropped.total")
                .description("Telemetry samples dropped (stale/duplicate)").register(registry);
        this.predictionsTotal = Counter.builder("forgesense.predictions.total")
                .description("ML inference calls").register(registry);
        this.anomaliesTotal = Counter.builder("forgesense.anomalies.total")
                .description("Anomaly events persisted").register(registry);
        this.alertsTotal = Counter.builder("forgesense.alerts.total")
                .description("Alerts created").register(registry);
        this.maintenanceTotal = Counter.builder("forgesense.maintenance.total")
                .description("Maintenance records created").register(registry);
        this.simulationRuns = Counter.builder("forgesense.simulation.runs.total")
                .description("What-if simulation runs completed").register(registry);
        this.eventsTotal = Counter.builder("forgesense.events.total")
                .description("Operational events logged").register(registry);
        this.telemetryProcessingLatency = Timer.builder("forgesense.telemetry.processing.latency")
                .description("End-to-end telemetry processing latency").publishPercentiles(0.5, 0.95, 0.99)
                .register(registry);
        Gauge.builder("forgesense.machines.online", machinesOnline, AtomicLong::doubleValue)
                .description("Machines currently online").register(registry);
        Gauge.builder("forgesense.websocket.connections", websocketConnections, AtomicLong::doubleValue)
                .description("Active WebSocket connections").register(registry);
    }

    public void recordTelemetry() { telemetryReceived.increment(); }
    public void dropTelemetry() { telemetryDropped.increment(); }
    public void recordPrediction() { predictionsTotal.increment(); }
    public void recordAnomaly() { anomaliesTotal.increment(); }
    public void recordEvent() { eventsTotal.increment(); }
    public Counter alertsCounter() { return alertsTotal; }
    public Counter maintenanceCounter() { return maintenanceTotal; }
    public Counter simulationCounter() { return simulationRuns; }
    public Timer.Sample startProcessing() { return Timer.start(); }
    public void stopProcessing(Timer.Sample sample) { sample.stop(telemetryProcessingLatency); }
    public void setMachinesOnline(long n) { machinesOnline.set(n); }
    public void setWebsocketConnections(long n) { websocketConnections.set(n); }
    public Counter perTypeAlert(String type) {
        return perTypeAlerts.computeIfAbsent(type,
                t -> Counter.builder("forgesense.alerts.type." + t + ".total")
                        .description("Alerts of type " + t).register(registry));
    }
}