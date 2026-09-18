"""Feature engineering for the ForgeSense ML service.

Telemetry arrives as raw sensor readings from the backend. To make readings
comparable across very different machine types (a CNC mill runs far hotter and
spins faster than a cooling unit), every reading is converted to a z-score
against a per-type nominal profile. Sensors that do not apply to a given type
are encoded as a neutral 0.0 and excluded from attribution, matching how the
fleet simulator reports absent sensors.

The nominal profiles and the machine-to-type mapping are loaded from the
authoritative shared catalog ``config/machine_profiles.json`` (repo root) —
the same file the backend DataSeeder and the telemetry simulator consume, so
the ML service, the fleet and the simulated stream can never drift apart.
Profiles are engineering nameplate values, not measurements.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Set

SENSOR_FIELDS: List[tuple[str, str]] = [
    ("temperature", "Temperature"),
    ("vibration", "Vibration"),
    ("pressure", "Pressure"),
    ("rpm", "RPM"),
    ("torque", "Torque"),
    ("current", "Current"),
    ("voltage", "Voltage"),
    ("power", "Power"),
    ("flow", "Flow"),
    ("frequency", "Frequency"),
    ("airTemperature", "Ambient temperature"),
]

FEATURE_NAMES: List[str] = [name for name, _ in SENSOR_FIELDS]
FEATURE_LABELS: Dict[str, str] = {name: label for name, label in SENSOR_FIELDS}


@dataclass(frozen=True)
class SensorProfile:
    mean: float
    std: float


@dataclass(frozen=True)
class MachineProfile:
    machine_type: str
    sensors: Dict[str, SensorProfile]

    def has(self, sensor: str) -> bool:
        return sensor in self.sensors


def _default_config_path() -> Path:
    env = os.environ.get("FORGESENSE_PROFILES_FILE")
    if env:
        return Path(env)
    # ml-service/app/features.py -> ml-service -> repo root
    return Path(__file__).resolve().parents[2] / "config" / "machine_profiles.json"


def _load_catalog() -> dict:
    path = _default_config_path()
    if not path.exists():
        raise RuntimeError(
            "machine profiles file not found. Set FORGESENSE_PROFILES_FILE or run from a "
            f"location where config/machine_profiles.json is reachable (tried {path})."
        )
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


_CATALOG: Dict[str, object] = _load_catalog()

_AMBIENT: Dict[str, SensorProfile] = {
    name: SensorProfile(float(p["mean"]), float(p["std"]))
    for name, p in _CATALOG.get("ambient", {}).items()
}


def _type_profiles() -> Dict[str, MachineProfile]:
    profiles: Dict[str, MachineProfile] = {}
    for type_code, spec in _CATALOG["machineTypes"].items():
        sensors: Dict[str, SensorProfile] = dict(_AMBIENT)
        for name, p in spec["sensors"].items():
            sensors[name] = SensorProfile(float(p["mean"]), float(p["std"]))
        profiles[type_code] = MachineProfile(machine_type=type_code, sensors=sensors)
    return profiles


PROFILES: Dict[str, MachineProfile] = _type_profiles()

# Static fleet registry (mirrors the backend catalog). The ML service keeps its
# own mapping so it can score a reading without a round-trip to the backend.
MACHINE_TYPES: Dict[str, str] = {
    m["machineId"]: m["type"] for m in _CATALOG["machines"]
}

# Sensors that are genuinely part of a type's physical profile (everything
# except the shared ambient reading). Used for missing-sensor indicators.
_AMBIENT_NAMES: Set[str] = set(_AMBIENT.keys())
REQUIRED_SENSORS: Dict[str, List[str]] = {
    type_code: [name for name in prof.sensors if name not in _AMBIENT_NAMES]
    for type_code, prof in PROFILES.items()
}


def profile_for(machine_id: Optional[str], machine_type: Optional[str] = None) -> MachineProfile:
    """Resolve the profile for a machine.

    The machine registry is authoritative. An explicit type is accepted only
    when it agrees with the registered machine identity; unknown machines and
    mismatched type hints are rejected rather than silently defaulted.
    """
    resolved = MACHINE_TYPES.get(machine_id) if machine_id else None
    if machine_id and resolved is None:
        raise KeyError(f"unknown machine: {machine_id}")
    if machine_type is not None and machine_type not in PROFILES:
        raise KeyError(f"unknown machine type: {machine_type}")
    if resolved is not None and machine_type is not None and resolved != machine_type:
        raise ValueError(f"machineType {machine_type} does not match {machine_id} ({resolved})")
    if resolved is None and machine_type is None:
        raise KeyError("no machineId and no machineType provided")
    resolved = resolved or machine_type
    return PROFILES[resolved]


def machine_type_for(machine_id: Optional[str], machine_type: Optional[str] = None) -> str:
    return profile_for(machine_id, machine_type).machine_type


def known_machine(machine_id: str) -> bool:
    return machine_id in MACHINE_TYPES


def to_feature_vector(machine_id: Optional[str], sample: dict,
                      machine_type: Optional[str] = None) -> List[float]:
    """Convert a raw telemetry sample into the fixed-order z-score vector.

    Sensors absent from the sample or not provided by the type are encoded as a
    neutral 0.0; use :func:`missing_sensors_for` for explicit indicators.
    """
    profile = profile_for(machine_id, machine_type)
    vector: List[float] = []
    for name in FEATURE_NAMES:
        if not profile.has(name):
            vector.append(0.0)
            continue
        value = sample.get(name)
        if value is None:
            vector.append(0.0)
            continue
        sp = profile.sensors[name]
        vector.append((float(value) - sp.mean) / sp.std)
    return vector


def missing_sensors_for(machine_id: Optional[str], sample: dict,
                        machine_type: Optional[str] = None) -> List[str]:
    """Sensors the machine's type profile requires but that are absent from the sample."""
    profile = profile_for(machine_id, machine_type)
    missing: List[str] = []
    for name in REQUIRED_SENSORS.get(profile.machine_type, []):
        if sample.get(name) is None:
            missing.append(name)
    return missing


def applicable_sensors(machine_id: Optional[str], machine_type: Optional[str] = None) -> List[str]:
    profile = profile_for(machine_id, machine_type)
    return [name for name in FEATURE_NAMES if profile.has(name)]
