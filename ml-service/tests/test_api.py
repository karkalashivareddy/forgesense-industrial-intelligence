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
    assert body["model_version"] == "failure-risk-v1"
    assert body["models_loaded"] is True


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
        "airTemperature": 22.5,
        "operatingHours": 12450,
    }
    resp = client.post("/assess", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert body["anomalyScore"] >= 0.0
    assert body["anomalyScore"] <= 1.0
    assert body["failureRisk"] >= 0.0
    assert 0.0 < body["healthScore"] <= 100.0
    assert body["modelVersion"] == "failure-risk-v1"
    assert len(body["factors"]) == 5
    assert body["factors"][0]["feature"]


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
        "airTemperature": 24.0,
        "operatingHours": 20110,
    }
    resp = client.post("/assess", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert body["anomalyLabel"] in ("WATCH", "ANOMALY")
    assert body["failureRisk"] > 0.25
    assert body["healthScore"] < 100.0


def test_unknown_machine_falls_back_to_default_type(client: TestClient) -> None:
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
    assert resp.status_code == 200
    assert resp.json()["modelVersion"] == "failure-risk-v1"