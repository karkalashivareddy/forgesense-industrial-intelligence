"""FastAPI application for the ForgeSense ML Service.

Provides /health and /assess endpoints consumed by the Spring Boot backend.
Model training happens once on first boot if artefacts are not present; the
deterministic seed ensures any clone produces the same models.
"""

from __future__ import annotations

import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Optional

import numpy as np
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .explanation import _recommendations, compute_factors
from .features import (
    FEATURE_NAMES,
    MACHINE_TYPES,
    applicable_sensors,
    machine_type_for,
    profile_for,
    to_feature_vector,
)
from .models import ModelBundle, get_bundle
from .schemas import AssessmentResponse, Factor, HealthResponse, TelemetrySampleRequest

logger = logging.getLogger("forgesense.ml")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

_bundle: Optional[ModelBundle] = None
_start_time: float = 0.0


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _bundle, _start_time
    _start_time = time.time()
    _bundle = get_bundle()
    logger.info("ML service ready in %.2fs", time.time() - _start_time)
    yield


app = FastAPI(
    title="ForgeSense ML Service",
    version="0.1.0",
    lifespan=lifespan,
)

# The ML service is consumed server-to-server by the Spring Boot backend, so
# credentials/CORS are only enabled for explicitly configured origins
# (defaults to the Vue/Dev-origins used when running everything locally).
_app_origins = [
    o.strip()
    for o in os.environ.get("FORGESENSE_ML_CORS_ORIGINS", "http://localhost:5173,http://localhost:5174").split(",")
    if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_app_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _anomaly_score(bundle: ModelBundle, x: np.ndarray) -> float:
    """Empirically calibrated anomaly score in [0, 1].

    The IsolationForest decision_function is compared against its own training
    distribution (healthy data): the score is the fraction of healthy training
    samples that scored *more normal* than this sample. 1.0 = most anomalous.
    """
    raw = float(bundle.anomaly_score_fn.decision_function(x.reshape(1, -1))[0])
    ref = bundle.anomaly_ref
    return float(np.clip(np.count_nonzero(ref > raw) / ref.size, 0.0, 1.0))


def _anomaly_label(score: float) -> str:
    if score > 0.85:
        return "ANOMALY"
    if score > 0.60:
        return "WATCH"
    return "NORMAL"


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health() -> HealthResponse:
    models_loaded = _bundle is not None
    return HealthResponse(
        status="ok" if models_loaded else "training",
        model_version="failure-risk-v1",
        models_loaded=models_loaded,
    )


@app.post("/assess")
def assess(req: TelemetrySampleRequest) -> AssessmentResponse:
    assert _bundle is not None, "Models not loaded"

    mtype = machine_type_for(req.machineId, req.machineType)
    raw = req.model_dump()
    x = np.array(to_feature_vector(req.machineId, raw, mtype), dtype=np.float64)

    # --- anomaly ---
    anomaly_score = _anomaly_score(_bundle, x)
    anomaly_label = _anomaly_label(anomaly_score)

    # --- failure risk ---
    failure_risk = round(float(_bundle.risk_predict_fn.predict_proba(x.reshape(1, -1))[0, 1]), 4)

    # --- health score ---
    health_score = round(100.0 * (1.0 - failure_risk) * (1.0 - 0.30 * anomaly_score), 1)

    # --- RUL ---
    if failure_risk > 0.5:
        rul_raw = float(_bundle.rul_predict_fn.predict(x.reshape(1, -1))[0])
        rul_hours = min(max(rul_raw * 20.0, 10.0), 900.0)
    else:
        rul_hours = 900.0
    rul_est = round(rul_hours, 1)

    # --- explanations ---
    factors_raw, _ = compute_factors(_bundle, x, req.machineId, mtype, top_n=5)
    recs = _recommendations(factors_raw, anomaly_label, failure_risk, mtype)

    factors = [Factor(**f) for f in factors_raw]

    return AssessmentResponse(
        anomalyScore=round(anomaly_score, 4),
        anomalyLabel=anomaly_label,
        failureRisk=failure_risk,
        healthScore=health_score,
        rulEstimate=rul_est,
        modelVersion=_bundle.failure_version,
        factors=factors,
        recommendations=recs,
    )