package com.forgesense.system;

import com.forgesense.machine.MachineService;
import com.forgesense.prediction.MlGateway;
import com.forgesense.simulation.SystemState;
import com.forgesense.common.config.ForgeSenseProperties;
import com.forgesense.websocket.WsNotifier;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.info.BuildProperties;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.sql.DataSource;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Platform status.
 *
 * Transport semantics are kept distinct because conflating them is how a UI ends
 * up claiming a healthy live feed that does not exist:
 *
 *   inputTransport — how telemetry ENTERS the backend (KAFKA | IN_PROCESS)
 *   transport      — how a CLIENT receives updates (WEBSOCKET_STOMP | REST_POLL)
 *   streaming      — whether the server-side realtime channel is enabled
 *
 * The database field reports what is actually connected, resolved from the
 * DataSource, rather than inferring it from demo mode.
 */
@RestController
@RequestMapping("/api/v1/system")
public class SystemController {

    private final ForgeSenseProperties props;
    private final MlGateway mlGateway;
    private final SystemState systemState;
    private final WsNotifier ws;
    private final MachineService machineService;
    private final ObjectProvider<DataSource> dataSource;

    public SystemController(ForgeSenseProperties props, MlGateway mlGateway,
                            SystemState systemState, WsNotifier ws,
                            MachineService machineService, ObjectProvider<DataSource> dataSource) {
        this.props = props;
        this.mlGateway = mlGateway;
        this.systemState = systemState;
        this.ws = ws;
        this.machineService = machineService;
        this.dataSource = dataSource;
    }

    @GetMapping("/status")
    public Map<String, Object> status() {
        boolean kafka = props.streaming().kafka().enabled();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("application", "ForgeSense Backend");
        result.put("demoMode", props.demoMode());
        // STOMP over WebSocket is always available server-side; clients that
        // cannot hold a socket fall back to REST polling on their own.
        result.put("streaming", true);
        result.put("transport", "WEBSOCKET_STOMP");
        result.put("pollIntervalSeconds", 3);
        result.put("inputTransport", kafka ? "KAFKA" : "IN_PROCESS");
        result.put("database", describeDatabase());
        result.put("mlServiceAvailable", mlGateway.mlAvailable());
        result.put("mlModelVersion", mlGateway.failureModelVersion());
        result.put("anomalyModelVersion", mlGateway.anomalyModelVersion());
        result.put("simulationPaused", systemState.isPaused());
        result.put("webSocketConnections", ws.connections());
        result.put("definedMachines", machineService.all().size());
        result.put("dataBasis", List.of(props.demoMode() ? "SYNTHETIC" : "OBSERVED"));
        return result;
    }

    /**
     * Resolve the connected database from the DataSource URL. Reporting
     * "H2_DEV" while actually connected to PostgreSQL would be a false claim
     * about the running system.
     */
    private String describeDatabase() {
        DataSource ds;
        try {
            ds = dataSource.getIfAvailable();
        } catch (RuntimeException ex) {
            return "UNAVAILABLE";
        }
        if (ds == null) return "UNAVAILABLE";

        String url = null;
        try {
            // A pooled datasource does not expose a URL, so go through the
            // connection metadata which every JDBC driver implements.
            url = resolveUrlFromConnection(ds);
        } catch (RuntimeException ignored) {
            url = null;
        }
        if (url == null) return "UNKNOWN";

        String lower = url.toLowerCase();
        if (lower.startsWith("jdbc:postgresql")) return "POSTGRESQL";
        if (lower.startsWith("jdbc:h2")) return "H2";
        if (lower.startsWith("jdbc:mysql")) return "MYSQL";
        if (lower.startsWith("jdbc:sqlserver")) return "SQLSERVER";
        if (lower.startsWith("jdbc:mariadb")) return "MARIADB";
        return "OTHER";
    }

    private String resolveUrlFromConnection(DataSource ds) {
        try (java.sql.Connection connection = ds.getConnection()) {
            return connection.getMetaData().getURL();
        } catch (Exception ex) {
            return null;
        }
    }
}
