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
        String db = kafka ? "postgres" : "h2";
        return Map.of(
                "application", "ForgeSense Backend",
                "demoMode", props.demoMode(),
                "streaming", kafka ? "KAFKA" : "IN-PROCESS",
                "database", db,
                "mlServiceAvailable", mlGateway.mlAvailable(),
                "mlModelVersion", mlGateway.anomalyModelVersion(),
                "simulationPaused", systemState.isPaused(),
                "webSocketConnections", ws.connections(),
                "definedMachines", machineService.all().size(),
                "dataBasis", List.of("LIVE", "SIMULATED"));
    }
}