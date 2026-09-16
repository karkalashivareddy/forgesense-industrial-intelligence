package com.forgesense.prediction;

import com.forgesense.common.config.ForgeSenseProperties;
import com.forgesense.events.EventLogService;
import com.forgesense.machine.twin.MachineTwin;
import com.forgesense.machine.twin.TwinService;
import com.forgesense.observability.ForgeMetrics;
import com.forgesense.prediction.domain.Assessment;
import com.forgesense.prediction.domain.Prediction;
import com.forgesense.streaming.EventBus;
import com.forgesense.telemetry.domain.TelemetrySample;
import com.forgesense.websocket.WsNotifier;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Orchestrates ML assessment per machine, throttled to every predictEveryMs.
 * Updates the digital twin, persists the prediction snapshot, emits events,
 * and hands control to the decision engine.
 */
@Service
public class PredictionService {

    private final MlGateway mlGateway;
    private final TwinService twinService;
    private final PredictionRepository predictionRepository;
    private final DecisionEngine decisionEngine;
    private final EventBus eventBus;
    private final WsNotifier ws;
    private final ForgeMetrics metrics;
    private final EventLogService eventLogService;
    private final ForgeSenseProperties props;

    private final Map<String, Long> lastPredictAt = new ConcurrentHashMap<>();

    public PredictionService(MlGateway mlGateway, TwinService twinService,
                             PredictionRepository predictionRepository,
                             DecisionEngine decisionEngine, EventBus eventBus,
                             WsNotifier ws, ForgeMetrics metrics,
                             EventLogService eventLogService, ForgeSenseProperties props) {
        this.mlGateway = mlGateway;
        this.twinService = twinService;
        this.predictionRepository = predictionRepository;
        this.decisionEngine = decisionEngine;
        this.eventBus = eventBus;
        this.ws = ws;
        this.metrics = metrics;
        this.eventLogService = eventLogService;
        this.props = props;
    }

    /** Called on every sample but only actually infers on the throttle window. */
    public void assessIfNeeded(String machineId, TelemetrySample sample) {
        long now = System.currentTimeMillis();
        Long last = lastPredictAt.get(machineId);
        if (last != null && now - last < props.machine().predictEveryMs()) {
            return;
        }
        lastPredictAt.put(machineId, now);
        assess(sample);
    }

    public Assessment assess(TelemetrySample sample) {
        MachineTwin twin = twinService.twin(sample.machineId());
        Assessment a = mlGateway.assess(sample);

        twin.setAnomalyScore(a.anomalyScore());
        twin.setAnomalyLabel(a.anomalyLabel());
        twin.setFailureRisk(a.failureRisk());
        twin.setHealthScore(a.healthScore());
        twin.setRulEstimate(a.rulEstimate());
        twin.setModelVersion(a.modelVersion());
        twin.setModelMode(a.mode());

        Prediction p = new Prediction();
        p.setMachineId(sample.machineId());
        p.setTimestamp(Instant.now());
        p.setModelVersion(a.modelVersion());
        p.setAnomalyScore(a.anomalyScore());
        p.setAnomalyLabel(a.anomalyLabel());
        p.setFailureRisk(a.failureRisk());
        p.setHealthScore(a.healthScore());
        p.setMode(a.mode());
        p.setFactors(a.factors());
        predictionRepository.save(p);

        metrics.recordPrediction();
        eventLogService.append("PREDICTION_UPDATED", sample.machineId(), "ml-service",
                "Prediction updated - risk " + Math.round(a.failureRisk() * 100) + "%",
                Map.of("risk", a.failureRisk(), "anomaly", a.anomalyScore(), "mode", a.mode()), true);

        ws.broadcast("prediction.updated", Map.of(
                "machineId", sample.machineId(),
                "anomalyScore", a.anomalyScore(),
                "anomalyLabel", a.anomalyLabel(),
                "failureRisk", a.failureRisk(),
                "healthScore", a.healthScore(),
                "rulEstimate", a.rulEstimate(),
                "rulUnit", a.rulUnit(),
                "modelVersion", a.modelVersion(),
                "anomalyModelVersion", a.anomalyModelVersion(),
                "mode", a.mode()));

        decisionEngine.evaluate(twin, sample, a);
        twinService.persistBudgets(twin);
        twinService.broadcast(twin);
        return a;
    }
}
