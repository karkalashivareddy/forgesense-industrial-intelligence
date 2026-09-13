"""ForgeSense factory-floor telemetry feed.

Streams synthetic-but-physically-plausible telemetry for every machine in
the fleet to the backend ingest endpoint. Runs forever until Ctrl+C; each
machine drifts slowly with a sinusoidal seasonal component and small noise,
and can be given a degradation trend via --degrade M-101.
"""
import argparse
import json
import math
import os
import random
import signal
import sys
import time
import urllib.request

MACHINES = {
    "M-101": {"type": "CNC_MILL", "temp": 55.0, "vib": 0.85, "rpm": 2400, "torque": 40.0,
              "current": 18.0, "voltage": 480, "power": 8.6, "frequency": 60.0, "airTemp": 22.0},
    "M-102": {"type": "INDUSTRIAL_MOTOR", "temp": 62.0, "vib": 1.0, "rpm": 1750, "current": 24.0,
              "voltage": 480, "power": 11.2, "frequency": 60.0, "airTemp": 24.0},
    "M-103": {"type": "HYDRAULIC_PUMP", "temp": 48.0, "vib": 1.2, "pressure": 4.6, "rpm": 1450,
              "current": 17.0, "power": 8.0, "flow": 92.0, "airTemp": 22.0},
    "M-104": {"type": "CONVEYOR_DRIVE_MOTOR", "temp": 55.0, "vib": 0.6, "rpm": 1760, "current": 7.0,
              "voltage": 480, "power": 3.2, "frequency": 60.0, "airTemp": 21.0},
    "M-105": {"type": "COMPRESSOR", "temp": 72.0, "vib": 1.8, "pressure": 7.1, "rpm": 1480,
              "current": 32.0, "power": 17.8, "flow": 150.0, "airTemp": 24.0},
    "M-106": {"type": "ROBOTIC_ARM", "temp": 38.0, "vib": 0.4, "rpm": 2100, "torque": 12.0,
              "current": 6.5, "voltage": 230, "power": 1.8, "airTemp": 21.0},
    "M-107": {"type": "COOLING_UNIT", "temp": 33.0, "vib": 0.3, "rpm": 1200, "current": 9.0,
              "voltage": 480, "power": 4.4, "frequency": 60.0, "airTemp": 25.0},
    "M-108": {"type": "GENERATOR", "temp": 68.0, "vib": 0.7, "rpm": 1800, "current": 58.0,
              "voltage": 480, "power": 27.0, "frequency": 60.0, "airTemp": 23.0},
}

NOISE = 0.02
AUTH = {"username": "admin", "password": os.environ.get("FORGESENSE_DEV_PASSWORD", "forgesense-dev")}
BASE = os.environ.get("FORGESENSE_BACKEND", "http://localhost:8080")


def _post(path, payload, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(f"{BASE}{path}", data=json.dumps(payload).encode(),
                                 headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


def login():
    return _post("/api/v1/auth/login", AUTH)["accessToken"]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--interval", type=float, default=5.0, help="seconds between batches")
    ap.add_argument("--degrade", nargs="*", default=[], help="machine ids to trend toward failure")
    args = ap.parse_args()
    token = login()
    print(f"Feed started -> {BASE}/api/v1/telemetry/ingest (interval {args.interval}s). Ctrl+C to stop.",
          flush=True)

    state = {mid: dict(cfg) for mid, cfg in MACHINES.items()}
    degrade = {mid: 0.0 for mid in args.degrade}
    seq = {mid: 0 for mid in MACHINES}
    t0 = time.time()
    phase = {mid: i * 1.7 for i, mid in enumerate(MACHINES)}
    stop = False

    def _sigint(_s, _f):
        nonlocal stop
        stop = True

    signal.signal(signal.SIGINT, _sigint)

    while not stop:
        for mid, s in state.items():
            t = time.time() - t0
            seasonal = math.sin(t / 17 + phase[mid]) * 0.04
            for key in ("temp", "vib", "pressure", "rpm", "current", "power", "flow", "torque"):
                if key not in s:
                    continue
                base = MACHINES[mid].get(key, 0.0)
                if base == 0.0:
                    continue
                s[key] = base * (1.0 + seasonal + random.gauss(0, NOISE))
            if mid in degrade:
                degrade[mid] += args.interval / 90.0  # full failure over ~90s
                d = min(degrade[mid], 1.0)
                s["temp"] = MACHINES[mid]["temp"] * (1 + seasonal + 0.55 * d)
                s["vib"] = MACHINES[mid]["vib"] * (1 + seasonal + 3.2 * d)

            seq[mid] += 1
            payload = {"machineId": mid, "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                       "sequence": seq[mid]}
            payload.update({k: round(v, 4) if isinstance(v, float) else v
                            for k, v in s.items() if k != "type" and v != 0.0})
            try:
                r = _post("/api/v1/telemetry/ingest", payload, token)
                print(f"{mid} seq={seq[mid]} ok={r.get('accepted')}", flush=True)
            except Exception as exc:  # noqa: BLE001 - feed must keep running
                print(f"{mid} failed: {exc}", flush=True)
                time.sleep(2)

        time.sleep(args.interval)

    print("Stopped.", flush=True)


if __name__ == "__main__":
    sys.exit(main())