package com.forgesense.bootstrap;

import com.forgesense.common.config.ForgeSenseProperties;
import com.forgesense.machine.MachineRepository;
import com.forgesense.machine.domain.Machine;
import com.forgesense.prediction.PredictionRepository;
import com.forgesense.prediction.PredictionService;
import com.forgesense.telemetry.TelemetryRepository;
import com.forgesense.telemetry.domain.TelemetryRecord;
import com.forgesense.telemetry.domain.TelemetrySample;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Demo-mode startup seeding that gives every machine a real prediction history
 * immediately after boot.
 *
 * Predictions are produced only by the ML assessment pipeline, so on a cold
 * start there is nothing to render until telemetry flows. When the fleet and
 * its historic telemetry are already in the database but no prediction rows
 * exist, this runner replays the stored telemetry through
 * {@link PredictionService#assess} so the ML workspace, prediction history and
 * explanation endpoints are populated with honest, model-derived data right
 * away. Idempotent - runs only in demo mode and only when the prediction table
 * is empty.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 1)
public class DemoPredictionSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DemoPredictionSeeder.class);

    private static final int HISTORY_WINDOW = 40;
    private static final int SAMPLE_STEP = 5;

    private final ForgeSenseProperties props;
    private final MachineRepository machineRepository;
    private final TelemetryRepository telemetryRepository;
    private final PredictionRepository predictionRepository;
    private final PredictionService predictionService;

    public DemoPredictionSeeder(ForgeSenseProperties props,
                                MachineRepository machineRepository,
                                TelemetryRepository telemetryRepository,
                                PredictionRepository predictionRepository,
                                PredictionService predictionService) {
        this.props = props;
        this.machineRepository = machineRepository;
        this.telemetryRepository = telemetryRepository;
        this.predictionRepository = predictionRepository;
        this.predictionService = predictionService;
        log.info("DemoPredictionSeeder initialized - demoMode={}", props.demoMode());
    }

    @Override
    public void run(ApplicationArguments args) {
        if (!props.demoMode()) {
            return;
        }
        if (machineRepository.count() == 0) {
            return;
        }
        if (predictionRepository.count() > 0) {
            log.info("Prediction history already present - skipping demo prediction seeding.");
            return;
        }

        int created = 0;
        int saved = 0;
        for (Machine m : machineRepository.findAllByOrderByMachineId()) {
            List<TelemetryRecord> history = new ArrayList<>(
                    telemetryRepository
                            .findByMachineIdOrderByTimestampDesc(m.getMachineId(), PageRequest.of(0, HISTORY_WINDOW))
                            .getContent());
            Collections.reverse(history);
            if (history.isEmpty()) {
                continue;
            }
            for (int i = 0; i < history.size(); i += SAMPLE_STEP) {
                TelemetrySample sample = toSample(history.get(i));
                try {
                    predictionService.assess(sample);
                    created++;
                } catch (Exception e) {
                    log.debug("Prediction seeding skipped for {} {}: {}", m.getMachineId(), i, e.getMessage());
                }
            }
            saved++;
        }
        log.info("Demo prediction history seeded: {} predictions across {} machines.",
                created, saved);
    }

    private static TelemetrySample toSample(TelemetryRecord r) {
        return new TelemetrySample(
                r.getMachineId(), r.getTimestamp(), r.getSequence(),
                r.getTemperature(), r.getVibration(), r.getPressure(), r.getRpm(),
                r.getTorque(), r.getCurrent(), r.getVoltage(), r.getPower(),
                r.getFlow(), r.getFrequency(), r.getAirTemperature(), r.getOperatingHours());
    }
}