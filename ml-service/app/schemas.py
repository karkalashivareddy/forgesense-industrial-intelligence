"""Pydantic request/response schemas for the ForgeSense ML service.

The request mirrors the ``TelemetrySample`` record emitted by the backend.
The response matches the shape expected by ``HttpMlClient.parse()`` in the
backend.
"""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Request
# ---------------------------------------------------------------------------

class TelemetrySampleRequest(BaseModel):
    machineId: str
    timestamp: str
    sequence: int = 0
    temperature: Optional[float] = None
    vibration: Optional[float] = None
    pressure: Optional[float] = None
    rpm: Optional[float] = None
    torque: Optional[float] = None
    current: Optional[float] = None
    voltage: Optional[float] = None
    power: Optional[float] = None
    flow: Optional[float] = None
    frequency: Optional[float] = None
    airTemperature: Optional[float] = None
    operatingHours: Optional[float] = None
    machineType: Optional[str] = None


# ---------------------------------------------------------------------------
# Response
# ---------------------------------------------------------------------------

class Factor(BaseModel):
    feature: str
    contribution: float = Field(ge=-10.0, le=10.0)
    label: str = Field(pattern="^(ELEVATED|REDUCED|NEUTRAL)$")
    direction: str = Field(pattern="^(up|down|flat)$")


class AssessmentResponse(BaseModel):
    anomalyScore: float = Field(ge=0.0, le=1.0)
    anomalyLabel: str = Field(pattern="^(NORMAL|WATCH|ANOMALY)$")
    failureRisk: float = Field(ge=0.0, le=1.0)
    healthScore: float = Field(ge=0.0, le=100.0)
    rulEstimate: float = Field(ge=0.0)
    modelVersion: str
    factors: List[Factor] = []
    recommendations: List[str] = []


class HealthResponse(BaseModel):
    status: str
    model_version: str
    models_loaded: bool
