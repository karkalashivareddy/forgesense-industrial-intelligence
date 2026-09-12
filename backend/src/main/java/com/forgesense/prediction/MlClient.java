package com.forgesense.prediction;

import com.forgesense.prediction.domain.Assessment;
import com.forgesense.telemetry.domain.TelemetrySample;

/**
 * ML inference gateway contract. The FastAPI service is the primary
 * implementation; the heuristic scorer is the documented fallback.
 */
public interface MlClient {

    boolean isAvailable();

    Assessment assess(TelemetrySample sample);
}