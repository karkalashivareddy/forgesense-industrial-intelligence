"""API tests for the ForgeSense ML service using FastAPI TestClient."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.main import app


@pytest.fixture(scope="module")
def client() -> TestClient:
    with TestClient(app) as c:
        assert c.app and True
        yield c


def test_health(client: TestClient) -> None:
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["model_version"] == "failure-risk-v2"
    assert body["anomaly_model_version"] == "anomaly-model-v2"
    assert body["models_loaded"] is True
    assert "evaluation" in body
    assert "risk_auc" in body["evaluation"]
    assert "anomaly_auc" in body["evaluation"]
    assert body["metadata"]["artifact_hash"]
    assert body["metadata"]["rul_unit"] == "steps"
    assert body["metadata"]["rul_horizon_steps"] == 60


def test_assess_normal_machine(client: TestClient) -> None:
    payload = {
        "machineId": "M-101",
        "timestamp": "2026-09-12T10:00:00Z",
        "sequence": 1,
        "temperature": 55.2,
        "vibration": 0.86,
        "rpm": 2410,
        "torque": 41.0,
        "current": 18.1,
        "power": 8.7,
        "voltage": 480.0,
        "frequency": 60.0,
        "airTemperature": 22.5,
        "operatingHours": 12450,
    }
    resp = client.post("/assess", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert 0.0 <= body["anomalyScore"] <= 0.6
    assert body["failureRisk"] <= 0.35
    assert 0.0 < body["healthScore"] <= 100.0
    assert body["modelVersion"] == "failure-risk-v2"
    assert body["anomalyModelVersion"] == "anomaly-model-v2"
    assert body["rulUnit"] == "steps"
    assert 0.0 <= body["rulEstimate"] <= 60.0
    assert len(body["factors"]) == 5
    assert body["factors"][0]["feature"]


def test_assess_all_machines_healthy_at_nominal(client: TestClient) -> None:
    """Every fleet machine scored at its profile nominal must look healthy."""
    nominals = {
        "M-101": {"temperature": 55, "vibration": 0.85, "rpm": 2400, "torque": 40, "current": 18, "power": 8.6, "voltage": 480, "frequency": 60},
        "M-102": {"temperature": 68, "vibration": 0.60, "rpm": 1470, "current": 24, "power": 11.5, "voltage": 480, "frequency": 60},
        "M-103": {"temperature": 58, "vibration": 1.35, "pressure": 6.2, "rpm": 1750, "current": 30, "power": 14.5, "flow": 120, "voltage": 480, "frequency": 60},
        "M-104": {"temperature": 56, "vibration": 0.80, "rpm": 960, "torque": 70, "current": 22, "power": 8.0, "voltage": 480, "frequency": 60},
        "M-105": {"temperature": 62, "vibration": 1.10, "pressure": 8.4, "rpm": 1200, "current": 41, "power": 26, "flow": 95, "voltage": 480, "frequency": 60},
        "M-106": {"temperature": 45, "vibration": 0.50, "torque": 28, "current": 8, "power": 3.2, "voltage": 480, "frequency": 60},
        "M-107": {"temperature": 42, "vibration": 0.70, "pressure": 2.4, "current": 15, "power": 6.5, "flow": 420, "voltage": 480, "frequency": 60},
        "M-108": {"temperature": 75, "vibration": 1.55, "rpm": 1500, "current": 55, "power": 24, "voltage": 440, "frequency": 60},
    }
    for machine_id, sensors in nominals.items():
        payload = {"machineId": machine_id, "timestamp": "2026-09-12T10:00:00Z", "sequence": 1, **sensors,
                   "airTemperature": 22.0}
        resp = client.post("/assess", json=payload)
        assert resp.status_code == 200, (machine_id, resp.text)
        body = resp.json()
        assert body["anomalyLabel"] in ("NORMAL", "WATCH"), (machine_id, body)
        assert body["failureRisk"] < 0.5, (machine_id, body)
        assert body["missingSensors"] == [], (machine_id, body)


def test_assess_degraded_machine_raises_anomaly(client: TestClient) -> None:
    payload = {
        "machineId": "M-103",
        "timestamp": "2026-09-12T10:00:00Z",
        "sequence": 1,
        "temperature": 74.0,
        "vibration": 3.4,
        "pressure": 7.1,
        "rpm": 2130,
        "current": 46.0,
        "power": 21.0,
        "flow": 160.0,
        "voltage": 480.0,
        "frequency": 60.0,
        "airTemperature": 24.0,
        "operatingHours": 20110,
    }
    resp = client.post("/assess", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert body["anomalyLabel"] in ("WATCH", "ANOMALY")
    assert body["failureRisk"] > 0.25
    assert body["healthScore"] < 100.0


def test_missing_sensor_is_reported(client: TestClient) -> None:
    """A required sensor omitted from a sample is surfaced, not silently zeroed."""
    payload = {
        "machineId": "M-101",
        "timestamp": "2026-09-12T10:00:00Z",
        "sequence": 1,
        "temperature": 55.2,
        "vibration": 0.86,
        "current": 18.1,
    }
    resp = client.post("/assess", json=payload)
    assert resp.status_code == 422
    body = resp.json()
    assert any(s in body["detail"]["missingSensors"] for s in ("torque", "rpm", "power"))


def test_machine_type_mismatch_is_rejected(client: TestClient) -> None:
    payload = {
        "machineId": "M-101", "machineType": "INDUSTRIAL_MOTOR",
        "timestamp": "2026-09-12T10:00:00Z", "sequence": 1,
        "temperature": 55.0, "vibration": 0.85, "rpm": 2400,
        "torque": 40.0, "current": 18.0, "power": 8.6,
    }
    resp = client.post("/assess", json=payload)
    assert resp.status_code == 400
    assert "does not match" in resp.json()["detail"]


def test_invalid_timestamp_and_non_finite_value_are_rejected(client: TestClient) -> None:
    base = {"machineId": "M-101", "timestamp": "2026-09-12T10:00:00Z", "sequence": 1,
            "temperature": 55.0, "vibration": 0.85, "rpm": 2400,
            "torque": 40.0, "current": 18.0, "power": 8.6}
    assert client.post("/assess", json={**base, "timestamp": "2026-09-12T10:00:00"}).status_code == 422
    assert client.post("/assess", json={**base, "temperature": "NaN"}).status_code == 422


def test_unknown_machine_returns_404(client: TestClient) -> None:
    payload = {
        "machineId": "M-999",
        "timestamp": "2026-09-12T10:00:00Z",
        "sequence": 1,
        "temperature": 66.0,
        "vibration": 0.58,
        "rpm": 1470,
        "current": 24.0,
        "power": 11.0,
    }
    resp = client.post("/assess", json=payload)
    assert resp.status_code == 404
    assert "unknown machine" in resp.json()["detail"]
