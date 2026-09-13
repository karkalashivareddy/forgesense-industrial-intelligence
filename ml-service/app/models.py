"""Model registry and synthetic training data generator.

The ML service keeps three models: an anomaly detector (Isolation Forest on
healthy-only data), a failure-risk classifier (GradientBoosting on labelled
healthy/failing samples), and a remaining-useful-life regressor (same, targets
hours to failure).  All artefacts are persisted as joblib/npz files under
``models/`` and retrained deterministically on first boot if missing.

Synthetic training data is generated from a configurable procedural failure
injection script that is seeded (random_state=42) so every fresh clone gets
exactly the same model.  No fabricated field labels are used; raw sensor
deviations are the input.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import joblib
import numpy as np
from numpy.typing import NDArray

from .features import FEATURE_NAMES, MachineProfile, PROFILES, profile_for

logger = logging.getLogger(__name__)

_MODELS_DIR = Path(__file__).resolve().parent.parent / "models"
_ANOMALY_PATH = _MODELS_DIR / "anomaly-model.pkl"
_RISK_PATH = _MODELS_DIR / "failure-risk-model.pkl"
_RUL_PATH = _MODELS_DIR / "rul-model.pkl"
_BASELINE_PATH = _MODELS_DIR / "feature-baseline.npy"
_ANOMALY_REF_PATH = _MODELS_DIR / "anomaly-reference-scores.npy"

_ANOMALY_VERSION = "anomaly-model-v1"
_FAILURE_MODEL_VERSION = "failure-risk-v1"


@dataclass
class ModelBundle:
    anomaly_score_fn: object  # IsolationForest instance
    risk_predict_fn: object
    rul_predict_fn: object
    baseline: NDArray          # mean z-score per feature from training data
    anomaly_ref: NDArray       # decision_function scores on training healthy data
    feature_names: List[str] = field(default_factory=list)

    anomaly_version: str = _ANOMALY_VERSION
    failure_version: str = _FAILURE_MODEL_VERSION


def _get_models_dir() -> Path:
    _MODELS_DIR.mkdir(parents=True, exist_ok=True)
    return _MODELS_DIR


# ---------------------------------------------------------------------------
# Synthetic data generator
# ---------------------------------------------------------------------------

class _SyntheticDataset:
    """Generate training data from per-type nominal profiles.

    Each simulated machine runs through a timeline of sensor readings.  Healthy
    operation is modelled as nominal mean + Gaussian noise.  A degradation
    episode is injected at a random point in the timeline and ramps sensor
    values linearly towards a failure envelope over a configurable horizon.
    After failure the machine is inoperable for a rest period.

    Labels produced:
      - ``failure_label``: 1 when the sample is within *fail_horizon* steps of
        failure, 0 otherwise (for the classifier).
      - ``rul``: remaining steps to the failure point (for the regressor), clamped
        to 0–fail_horizon.
    """

    def __init__(self, rng: np.random.RandomState):
        self.rng = rng

    @staticmethod
    def _z_score_array(profile: MachineProfile) -> List[Tuple[float, float]]:
        """Return (mean, std) pairs for the fixed sensor order."""
        result: List[Tuple[float, float]] = []
        for name in FEATURE_NAMES:
            sp = profile.sensors.get(name)
            result.append((sp.mean, sp.std) if sp else (0.0, 1.0))
        return result

    def _generate_machine_type(self, machine_type: str, n_machines: int,
                               timeline_len: int = 600,
                               fail_horizon: int = 60,
                               fault_start_min: int = 300,
                               fault_ramp_steps: int = 180,
                               healthy_only_extra: int = 300,
                               ) -> Tuple[NDArray, NDArray, NDArray]:
        profile = PROFILES[machine_type]
        meta = self._z_score_array(profile)
        n_features = len(FEATURE_NAMES)
        all_features: List[NDArray] = []
        all_failure_labels: List[int] = []
        all_rul: List[float] = []
        all_clean: List[int] = []

        for _ in range(n_machines):
            baseline = np.array([m for m, _ in meta], dtype=np.float64)
            stds = np.array([s for _, s in meta], dtype=np.float64)
            # machines of a type sit near one healthy operating point with mild
            # variance; big per-machine offsets create a multimodal healthy
            # cloud that mis-centers the anomaly detector
            baseline = baseline + self.rng.uniform(-0.2, 0.2, n_features) * stds
            fault_start = self.rng.randint(fault_start_min, timeline_len - fault_ramp_steps - 1)
            fault_peak = fault_start + fault_ramp_steps

            timeline: List[List[float]] = []
            for t in range(timeline_len):
                reading = baseline + self.rng.normal(0, 1.0, n_features) * stds * 0.45
                if t >= fault_start:
                    progress = min((t - fault_start) / max(fault_ramp_steps, 1), 1.0)
                    for i, name in enumerate(FEATURE_NAMES):
                        if name in ("vibration", "temperature"):
                            reading[i] += progress * stds[i] * 2.5
                        elif name in ("current", "power", "rpm"):
                            reading[i] += progress * stds[i] * 1.2
                        elif name in ("pressure", "flow", "torque"):
                            reading[i] += progress * stds[i] * 0.8
                timeline.append(reading.tolist())

            for t in range(timeline_len):
                raw_row = np.array(timeline[t])
                z_row = (raw_row - np.array([m for m, _ in meta])) / np.array([sd for _, sd in meta])
                all_features.append(z_row)
                all_clean.append(1 if t < fault_start else 0)
                if fault_start <= t < timeline_len:
                    dist_to_peak = max(fault_peak - t, 0)
                    rul_val = float(dist_to_peak)
                    all_rul.append(rul_val)
                    all_failure_labels.append(1 if dist_to_peak <= fail_horizon else 0)
                else:
                    all_rul.append(float(fail_horizon))
                    all_failure_labels.append(0)

            for _ in range(healthy_only_extra):
                reading = baseline + self.rng.normal(0, 1.0, n_features) * stds * 0.45
                z_row = (reading - np.array([m for m, _ in meta])) / np.array([sd for _, sd in meta])
                all_features.append(z_row)
                all_rul.append(float(fail_horizon))
                all_failure_labels.append(0)
                all_clean.append(1)

        X = np.array(all_features, dtype=np.float64)
        y_risk = np.array(all_failure_labels, dtype=np.int32)
        y_rul = np.array(all_rul, dtype=np.float64)
        clean = np.array(all_clean, dtype=bool)
        return X, y_risk, y_rul, clean

    def generate(self) -> Tuple[NDArray, NDArray, NDArray, NDArray]:
        parts = [self._generate_machine_type(mt, n_machines=5) for mt in PROFILES]
        X = np.vstack([p[0] for p in parts])
        y_risk = np.concatenate([p[1] for p in parts])
        y_rul = np.concatenate([p[2] for p in parts])
        clean = np.concatenate([p[3] for p in parts])
        return X, y_risk, y_rul, clean


def _build_or_load() -> ModelBundle:
    d = _get_models_dir()
    from sklearn.ensemble import GradientBoostingClassifier, GradientBoostingRegressor
    from sklearn.ensemble import IsolationForest

    if all(p.exists() for p in [_ANOMALY_PATH, _RISK_PATH, _RUL_PATH, _BASELINE_PATH, _ANOMALY_REF_PATH]):
        logger.info("Loading pre-trained models from %s", d)
        return ModelBundle(
            anomaly_score_fn=joblib.load(_ANOMALY_PATH),
            risk_predict_fn=joblib.load(_RISK_PATH),
            rul_predict_fn=joblib.load(_RUL_PATH),
            baseline=np.load(_BASELINE_PATH),
            anomaly_ref=np.load(_ANOMALY_REF_PATH),
            feature_names=FEATURE_NAMES,
        )

    logger.info("Training models (this happens once on first boot)...")
    t0 = time.time()
    rng = np.random.RandomState(42)
    ds = _SyntheticDataset(rng)
    X, y_risk, y_rul, clean = ds.generate()

    # Z-scores are the native feature space; no second scaling.
    baseline = X.mean(axis=0)
    healthy_mask = clean == 1

    # --- anomaly (train on healthy rows only) ---
    iso = IsolationForest(n_estimators=200, contamination=0.08, random_state=42)
    iso.fit(X[healthy_mask])
    anomaly_ref = iso.decision_function(X[healthy_mask])

    # --- failure-risk classifier ---
    clf = GradientBoostingClassifier(
        n_estimators=250, max_depth=3, learning_rate=0.05,
        subsample=0.8, random_state=42,
    )
    clf.fit(X, y_risk)

    # --- RUL regressor (train on failure rows only) ---
    fail_mask = y_risk == 1
    reg = GradientBoostingRegressor(
        n_estimators=300, max_depth=3, learning_rate=0.05,
        subsample=0.8, random_state=42,
    )
    reg.fit(X[fail_mask], y_rul[fail_mask])

    # persist
    joblib.dump(iso, _ANOMALY_PATH)
    joblib.dump(clf, _RISK_PATH)
    joblib.dump(reg, _RUL_PATH)
    np.save(_BASELINE_PATH, baseline)
    np.save(_ANOMALY_REF_PATH, anomaly_ref)

    elapsed = time.time() - t0
    logger.info("Models trained in %.1fs -> %s", elapsed, d)
    return ModelBundle(
        anomaly_score_fn=iso,
        risk_predict_fn=clf,
        rul_predict_fn=reg,
        baseline=baseline,
        anomaly_ref=anomaly_ref,
        feature_names=FEATURE_NAMES,
    )


_bundle: Optional[ModelBundle] = None


def get_bundle() -> ModelBundle:
    global _bundle
    if _bundle is None:
        _bundle = _build_or_load()
    return _bundle
