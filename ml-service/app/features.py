"""Feature engineering for the ForgeSense ML service.

Telemetry arrives as raw sensor readings from the backend. To make readings
comparable across very different machine types (a CNC mill runs far hotter and
spins faster than a cooling unit), every reading is converted to a z-score
against a per-type nominal profile. Sensors that do not apply to a given type
(e.g. pressure on a motor) are encoded as a neutral 0.0 and excluded from
attribution, matching how the fleet simulator reports absent sensors.

The nominal profiles mirror the fleet defined in the backend DataSeeder; they
are engineering nameplate values, not measurements.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional

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


_COMMON: Dict[str, SensorProfile] = {
    "airTemperature": SensorProfile(22.0, 3.0),
    "frequency": SensorProfile(60.0, 0.4),
    "voltage": SensorProfile(480.0, 8.0),
}


def _profile(machine_type: str, **sensors: tuple) -> MachineProfile:
    merged = dict(_COMMON)
    for name, (mean, std) in sensors.items():
        merged[name] = SensorProfile(float(mean), float(std))
    return MachineProfile(machine_type=machine_type, sensors=merged)


# Nameplate nominal operating points per machine type (engineering values).
PROFILES: Dict[str, MachineProfile] = {
    "CNC_MILL": _profile(
        "CNC_MILL",
        temperature=(55.0, 4.0), vibration=(0.85, 0.12), rpm=(2400.0, 90.0),
        torque=(40.0, 6.0), current=(18.0, 2.5), power=(8.6, 1.2),
    ),
    "INDUSTRIAL_MOTOR": _profile(
        "INDUSTRIAL_MOTOR",
        temperature=(68.0, 4.5), vibration=(0.60, 0.10), rpm=(1470.0, 35.0),
        torque=(55.0, 8.0), current=(24.0, 3.0), power=(11.5, 1.5),
    ),
    "HYDRAULIC_PUMP": _profile(
        "HYDRAULIC_PUMP",
        temperature=(58.0, 4.0), vibration=(1.35, 0.18), pressure=(6.2, 0.35),
        rpm=(1750.0, 45.0), current=(30.0, 3.5), power=(14.5, 2.0), flow=(120.0, 14.0),
    ),
    "CONVEYOR_DRIVE_MOTOR": _profile(
        "CONVEYOR_DRIVE_MOTOR",
        temperature=(56.0, 4.0), vibration=(0.80, 0.12), rpm=(960.0, 25.0),
        torque=(70.0, 9.0), current=(22.0, 3.0), power=(8.0, 1.2),
    ),
    "COMPRESSOR": _profile(
        "COMPRESSOR",
        temperature=(62.0, 4.5), vibration=(1.10, 0.15), pressure=(8.4, 0.40),
        rpm=(1200.0, 30.0), current=(41.0, 4.0), power=(26.0, 3.0), flow=(95.0, 12.0),
    ),
    "ROBOTIC_ARM": _profile(
        "ROBOTIC_ARM",
        temperature=(45.0, 3.5), vibration=(0.50, 0.08), torque=(28.0, 4.0),
        current=(8.0, 1.2), power=(3.2, 0.6),
    ),
    "COOLING_UNIT": _profile(
        "COOLING_UNIT",
        temperature=(42.0, 3.5), vibration=(0.70, 0.10), pressure=(2.4, 0.25),
        current=(15.0, 2.0), power=(6.5, 1.0), flow=(420.0, 40.0),
    ),
    "GENERATOR": _profile(
        "GENERATOR",
        temperature=(75.0, 5.0), vibration=(1.55, 0.20), rpm=(1500.0, 30.0),
        current=(55.0, 6.0), power=(24.0, 3.0), voltage=(440.0, 8.0),
        frequency=(60.0, 0.3),
    ),
}

# Static fleet registry (mirrors backend DataSeeder). The ML service keeps its
# own mapping so it can score a reading without a round-trip to the backend.
MACHINE_TYPES: Dict[str, str] = {
    "M-101": "CNC_MILL",
    "M-102": "INDUSTRIAL_MOTOR",
    "M-103": "HYDRAULIC_PUMP",
    "M-104": "CONVEYOR_DRIVE_MOTOR",
    "M-105": "COMPRESSOR",
    "M-106": "ROBOTIC_ARM",
    "M-107": "COOLING_UNIT",
    "M-108": "GENERATOR",
}

_DEFAULT_TYPE = "INDUSTRIAL_MOTOR"


def profile_for(machine_id: Optional[str], machine_type: Optional[str] = None) -> MachineProfile:
    resolved = machine_type or MACHINE_TYPES.get(machine_id or "", None) or _DEFAULT_TYPE
    return PROFILES.get(resolved, PROFILES[_DEFAULT_TYPE])


def machine_type_for(machine_id: Optional[str], machine_type: Optional[str] = None) -> str:
    profile = profile_for(machine_id, machine_type)
    return profile.machine_type


def to_feature_vector(machine_id: Optional[str], sample: dict,
                      machine_type: Optional[str] = None) -> List[float]:
    """Convert a raw telemetry sample into the fixed-order z-score vector."""
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


def applicable_sensors(machine_id: Optional[str], machine_type: Optional[str] = None) -> List[str]:
    profile = profile_for(machine_id, machine_type)
    return [name for name in FEATURE_NAMES if profile.has(name)]
