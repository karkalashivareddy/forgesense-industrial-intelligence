"""Pydantic request/response schemas for the ForgeSense ML service.

The request mirrors the ``TelemetrySample`` record emitted by the backend.
The response matches the shape expected by ``HttpMlClient.parse()`` in the
backend.
"""

from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field, FiniteFloat, field_validator


# ---------------------------------------------------------------------------
# Request
# ---------------------------------------------------------------------------

class TelemetrySampleRequest(BaseModel):
    machineId: str
    timestamp: str
    sequence: int = Field(default=1, ge=1)
    temperature: Optional[FiniteFloat] = None
    vibration: Optional[FiniteFloat] = None
    pressure: Optional[FiniteFloat] = None
    rpm: Optional[FiniteFloat] = None
    torque: Optional[FiniteFloat] = None
    current: Optional[FiniteFloat] = None
    voltage: Optional[FiniteFloat] = None
    power: Optional[FiniteFloat] = None
    flow: Optional[FiniteFloat] = None
    frequency: Optional[FiniteFloat] = None
    airTemperature: Optional[FiniteFloat] = None
    operatingHours: Optional[FiniteFloat] = None
    machineType: Optional[str] = None

    @field_validator("timestamp")
    @classmethod
    def timestamp_must_be_aware_iso(cls, value: str) -> str:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError("timestamp must include a timezone")
        return value


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
    rulUnit: str = Field(pattern="^steps$")
    modelVersion: str
    anomalyModelVersion: str
    missingSensors: List[str] = Field(default_factory=list)
    factors: List[Factor] = Field(default_factory=list)
    recommendations: List[str] = Field(default_factory=list)


class HealthResponse(BaseModel):
    status: str
    model_version: str
    anomaly_model_version: str = "unavailable"
    models_loaded: bool
    evaluation: dict = Field(default_factory=dict)
    metadata: dict = Field(default_factory=dict)
