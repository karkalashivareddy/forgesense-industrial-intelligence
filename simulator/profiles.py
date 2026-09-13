"""Loader for the authoritative ForgeSense machine profile catalog.

Single source of truth shared with the backend (MachineProfileCatalog) and
the ML service (app/features.py): ``config/machine_profiles.json``.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

_CANONICAL_SENSOR_KEYS = {
    "temperature": "temperature",
    "vibration": "vibration",
    "pressure": "pressure",
    "rpm": "rpm",
    "torque": "torque",
    "current": "current",
    "voltage": "voltage",
    "power": "power",
    "flow": "flow",
    "frequency": "frequency",
    "airTemperature": "airTemperature",
}


def profiles_path() -> Path:
    env = os.environ.get("FORGESENSE_PROFILES_FILE")
    if env:
        return Path(env)
    return Path(__file__).resolve().parent.parent / "config" / "machine_profiles.json"


def load_catalog() -> dict:
    path = profiles_path()
    if not path.exists():
        raise RuntimeError(f"machine profiles file not found: {path} "
                           "(set FORGESENSE_PROFILES_FILE or run from the repo root)")
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


class Catalog:
    def __init__(self, raw: dict, source: Path):
        self.raw = raw
        self.profile_source = source
        self.ambient = raw["ambient"]
        self.machine_types = raw["machineTypes"]
        self.machines = {m["machineId"]: m for m in raw["machines"]}
        self.by_key = {m["machineId"]: _machine_baseline(m, self.machine_types, self.ambient) for m in raw["machines"]}

    def keys(self):
        return list(self.machines)

    def type_of(self, machine_id: str) -> str:
        return self.machines[machine_id]["type"]

    def machine(self, machine_id: str) -> dict:
        return self.machines[machine_id]

    def type_config(self, machine_type: str) -> dict:
        return self.machine_types[machine_type]

    def baseline(self, machine_id: str) -> dict:
        return self.by_key[machine_id]["values"]

    def meta(self, machine_id: str) -> dict:
        return self.by_key[machine_id]["meta"]


def _machine_baseline(machine: dict, machine_types: dict, ambient: dict) -> dict:
    tid = machine["type"]
    values: dict = {}
    meta: dict = {}
    for sname, sp in machine_types[tid]["sensors"].items():
        values[sname] = float(sp["mean"])
        meta[sname] = {"mean": float(sp["mean"]), "std": float(sp["std"]),
                       "min": float(sp["min"]), "max": float(sp["max"])}
    values["airTemperature"] = float(ambient["airTemperature"]["mean"])
    meta["airTemperature"] = {"mean": values["airTemperature"],
                              "std": float(ambient["airTemperature"]["std"]),
                              "min": float(ambient["airTemperature"]["min"]),
                              "max": float(ambient["airTemperature"]["max"])}
    return {"values": values, "meta": meta}