package com.forgesense.system;

import com.forgesense.machine.MachineService;
import com.forgesense.prediction.MlGateway;
import com.forgesense.simulation.SystemState;
import com.forgesense.common.config.ForgeSenseProperties;
import com.forgesense.websocket.WsNotifier;
import org.springframework.boot.info.BuildProperties;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/system")
public class SystemController {

    private final ForgeSenseProperties props;
    private final MlGateway mlGateway;
    private final SystemState systemState;
    private final WsNotifier ws;
    private final MachineService machineService;

    public SystemController(ForgeSenseProperties props, MlGateway mlGateway,
                            SystemState systemState, WsNotifier ws,
                            MachineService machineService) {
        this.props = props;
        this.mlGateway = mlGateway;
        this.systemState = systemState;
        this.ws = ws;
        this.machineService = machineService;
    }

    @GetMapping("/status")
    public Map<String, Object> status() {
        boolean kafka = props.streaming().kafka().enabled();
        String db = props.demoMode() ? "H2_DEV" : "POSTGRES_CONFIGURED";
        Map<String, Object> result = new java.util.HashMap<>();
        result.put("application", "ForgeSense Backend");
        result.put("demoMode", props.demoMode());
        result.put("streaming", false);
        result.put("transport", "REST_POLL");
        result.put("pollIntervalSeconds", 3);
        result.put("inputTransport", kafka ? "KAFKA" : "IN_PROCESS");
        result.put("database", db);
        result.put("mlServiceAvailable", mlGateway.mlAvailable());
        result.put("mlModelVersion", mlGateway.failureModelVersion());
        result.put("anomalyModelVersion", mlGateway.anomalyModelVersion());
        result.put("simulationPaused", systemState.isPaused());
        result.put("webSocketConnections", ws.connections());
        result.put("definedMachines", machineService.all().size());
        result.put("dataBasis", List.of(props.demoMode() ? "SYNTHETIC" : "OBSERVED"));
        return result;
    }
}
