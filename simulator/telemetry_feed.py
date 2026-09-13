"""ForgeSense factory-floor telemetry feed (v2).

Streams synthetic-but-physically-plausible telemetry for every machine in the
fleet from the authoritative ``config/machine_profiles.json`` catalog.  Each
machine reads its per-type nominal sensor values (mean/mu, sigma, operating
limits) from that catalog and drifts slowly around them with Gaussian noise
and a mild seasonal component.

Field names use the canonical long keys consumed by the backend ingest API
(temperature, vibration, pressure, rpm, torque, current, voltage, power,
flow, frequency, airTemperature, operatingHours) — never the short aliases.

Usage:

    python -m telemetry_feed                 # steady-state healthy feed
    python -m telemetry_feed --degrade M-101  # trend one machine to failure
    python -m telemetry_feed --bare          # omit optional sensors (drives
                                             # missing-sensor handling)
Runs forever until Ctrl+C.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import signal
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from profiles import Catalog, load_catalog, profiles_path  # noqa: E402

# canonical JSON keys understood by the backend TelemetrySample
SENSOR_KEYS = [
    "temperature", "vibration", "pressure", "rpm", "torque", "current",
    "voltage", "power", "flow", "frequency", "airTemperature",
]

_AUTH = {"username": "admin", "password": os.environ.get("FORGESENSE_DEV_PASSWORD", "forgesense-dev")}
_BASE = os.environ.get("FORGESENSE_BACKEND", "http://localhost:8080")


def _post(path, payload, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(f"{_BASE}{path}", data=json.dumps(payload).encode(),
                                 headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


def login():
    return _post("/api/v1/auth/login", _AUTH)["accessToken"]


def _round_value(key, value):
    return round(value, 2) if key in ("vibration", "airTemperature") else round(value, 1)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--interval", type=float, default=5.0, help="seconds between batches")
    ap.add_argument("--degrade", nargs="*", default=[], help="machine ids to trend toward failure")
    ap.add_argument("--degrade-seconds", type=float, default=90.0,
                    help="time to ramp a degraded machine to its failure envelope")
    ap.add_argument("--bare", action="store_true",
                    help="omit optional sensors so the backend/ML report missingSensors")
    ap.add_argument("--omit", nargs="*", default=[], help="extra sensor keys to omit")
    args = ap.parse_args()

    catalog = Catalog(load_catalog(), profiles_path())
    machines = catalog.keys()
    if args.degrade:
        unknown = [m for m in args.degrade if m not in machines]
        if unknown:
            print(f"unknown machine ids: {unknown}; known: {machines}", file=sys.stderr)
            return 2

    token = login()
    print(f"Feed started -> {_BASE}/api/v1/telemetry/ingest (interval {args.interval}s, "
          f"{len(machines)} machines from {catalog.profile_source})", flush=True)

    omit = set(args.omit) | ({"airTemperature", "frequency", "voltage"} if args.bare else set())
    state = {mid: dict(catalog.baseline(mid)) for mid in machines}
    degrade = {mid: 0.0 for mid in args.degrade}
    seq = {mid: 0 for mid in machines}
    t0 = time.time()
    phase = {mid: i * 1.7 for i, mid in enumerate(machines)}
    stop = False

    def _sigint(_s, _f):
        nonlocal stop
        stop = True

    signal.signal(signal.SIGINT, _sigint)

    while not stop:
        for mid in machines:
            meta = catalog.meta(mid)
            t = time.time() - t0
            seasonal = math.sin(t / 17 + phase[mid]) * 0.30
            d = 0.0
            if mid in degrade:
                degrade[mid] = min(degrade[mid] + args.interval / max(args.degrade_seconds, 1.0), 1.0)
                d = degrade[mid]

            for key in SENSOR_KEYS:
                if key not in meta or key in omit:
                    continue
                m = meta[key]["mean"]
                s = meta[key]["std"]
                lo, hi = meta[key]["min"], meta[key]["max"]
                value = m + random.gauss(0, s) * 0.25 + seasonal * s
                if d > 0.0:
                    if key in ("vibration", "temperature"):
                        value += d * 3.2 * s
                    elif key in ("rpm", "current", "power"):
                        value += d * 1.2 * s
                    elif key in ("pressure", "flow", "torque"):
                        value += d * 0.8 * s
                state[mid][key] = min(max(value, lo), hi)

            seq[mid] += 1
            payload = {
                "machineId": mid,
                "machineType": catalog.type_of(mid),
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "sequence": seq[mid],
                "operatingHours": round(
                    catalog.machine(mid).get("operatingHours", 10000.0) + t / 3600.0, 2),
            }
            for key in SENSOR_KEYS:
                if key in omit or key not in state[mid]:
                    continue
                payload[key] = _round_value(key, state[mid][key])

            try:
                r = _post("/api/v1/telemetry/ingest", payload, token)
                print(f"{mid} seq={seq[mid]} accepted={r.get('accepted')}", flush=True)
            except Exception as exc:  # noqa: BLE001 - feed must keep running
                print(f"{mid} failed: {exc}", flush=True)
                time.sleep(2)

        time.sleep(args.interval)

    print("Stopped.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())