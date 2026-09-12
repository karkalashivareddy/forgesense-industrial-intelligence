package com.forgesense.machine.twin;

import com.forgesense.common.config.ForgeSenseProperties;
import com.forgesense.machine.MachineService;
import com.forgesense.machine.domain.MachineState;
import com.forgesense.observability.ForgeMetrics;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Background monitor implementing graceful degradation:
 * - machines with no stream yet → WAITING (never alerted for being quiet)
 * - machines whose telemetry stopped → STALE, then OFFLINE
 * - offline machines that resume → RECOVERING → NORMAL once risk is low
 */
@Component
public class ConnectivityMonitor {

    private static final Logger log = LoggerFactory.getLogger(ConnectivityMonitor.class);

    private final TwinService twinService;
    private final MachineService machineService;
    private final ForgeSenseProperties props;
    private final ForgeMetrics metrics;
    private final Map<String, Instant> recoverySince = new ConcurrentHashMap<>();

    public ConnectivityMonitor(TwinService twinService, MachineService machineService,
                               ForgeSenseProperties props, ForgeMetrics metrics) {
        this.twinService = twinService;
        this.machineService = machineService;
        this.props = props;
        this.metrics = metrics;
    }

    @Scheduled(fixedDelay = 5_000)
    public void monitor() {
        int online = 0;
        int offline = 0;
        int recovering = 0;
        for (MachineTwin twin : twinService.all()) {
            Instant last = twin.getLastTelemetryAt();
            String id = twin.getMachineId();
            long age = last == null ? Long.MAX_VALUE : Duration.between(last, Instant.now()).toSeconds();
            int offlineAfter = props.machine().offlineAfterSeconds();

            if (last == null) {
                twin.setConnectivity("WAITING");
            } else if (age > (long) offlineAfter * 3) {
                twin.setConnectivity("OFFLINE");
                if (twin.getStatus() != MachineState.OFFLINE) {
                    safeState(id, MachineState.OFFLINE);
                }
                offline++;
            } else if (age > offlineAfter) {
                twin.setConnectivity("STALE");
                offline++;
            } else {
                twin.setConnectivity("ONLINE");
                if (twin.getStatus() == MachineState.OFFLINE) {
                    safeState(id, MachineState.RECOVERING);
                    recoverySince.putIfAbsent(id, Instant.now());
                }
                if (twin.getStatus() == MachineState.RECOVERING) {
                    recoverySince.putIfAbsent(id, Instant.now());
                }
                online++;
            }

            if (twin.getStatus() == MachineState.RECOVERING && twin.getConnectivity().equals("ONLINE")) {
                Instant since = recoverySince.computeIfAbsent(id, k -> Instant.now());
                boolean stable = Duration.between(since, Instant.now()).getSeconds() >= 15
                        && twin.getFailureRisk() < 0.35;
                if (stable) {
                    recovering++;
                    safeState(id, MachineState.NORMAL);
                    recoverySince.remove(id);
                }
            }
        }
        metrics.setMachinesOnline(online);
    }

    private void safeState(String id, MachineState target) {
        try {
            machineService.setStatusQuiet(id, target);
        } catch (Exception e) {
            log.debug("monitor state change skipped for {}: {}", id, e.getMessage());
        }
    }
}