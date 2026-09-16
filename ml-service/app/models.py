"""Model registry and synthetic training data generator.

The ML service keeps three models: an anomaly detector (Isolation Forest on
healthy-only data), a failure-risk classifier (GradientBoosting on labelled
healthy/failing samples), and a degradation-horizon regressor (same, targets
remaining synthetic steps). All artefacts are persisted as joblib/npz files under
``models/`` and retrained deterministically on first boot if missing.

Synthetic training data is generated from the authoritative per-type nominal
profiles (``config/machine_profiles.json``) via a configurable procedural
failure-injection script seeded so every fresh clone gets exactly the same
model.  A SHA-256 of the profile catalog is persisted alongside the artefacts:
whenever the catalog changes, the models are deterministically retrained so
the fleet and the model can never disagree.  No fabricated field labels are
used; raw sensor deviations are the input.

At training time a holdout (20% of generated samples) is used only to compute
honest evaluation metrics (anomaly ranking AUC, failure-risk AUC, RUL RMSE)
which are persisted to ``models/eval-metrics.json``; the final artefacts are
always trained on the full generated dataset.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from datetime import datetime, timezone
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import joblib
import numpy as np
from numpy.typing import NDArray

from .features import (
    FEATURE_NAMES,
    PROFILES,
    MachineProfile,
    profile_for,
)

logger = logging.getLogger(__name__)

_MODELS_DIR = Path(__file__).resolve().parent.parent / "models"
_ANOMALY_PATH = _MODELS_DIR / "anomaly-model.pkl"
_RISK_PATH = _MODELS_DIR / "failure-risk-model.pkl"
_RUL_PATH = _MODELS_DIR / "rul-model.pkl"
_BASELINE_PATH = _MODELS_DIR / "feature-baseline.npy"
_ANOMALY_REF_PATH = _MODELS_DIR / "anomaly-reference-scores.npy"
_HASH_PATH = _MODELS_DIR / "profiles-hash.txt"
_EVAL_PATH = _MODELS_DIR / "eval-metrics.json"
_METADATA_PATH = _MODELS_DIR / "model-metadata.json"

# Bumped whenever the feature schema or model architecture changes.
_ANOMALY_VERSION = "anomaly-model-v2"
_FAILURE_MODEL_VERSION = "failure-risk-v2"

# Bumped if the synthetic-data generator parameters change (forces retrain).
_GENERATOR_SCHEMA = 2
_FEATURE_SCHEMA_VERSION = "instantaneous-zscore-v1"
_TRAINING_DATA_VERSION = "synthetic-generator-v2"
_RUL_UNIT = "steps"
_RUL_HORIZON_STEPS = 60


@dataclass
class ModelBundle:
    anomaly_score_fn: object  # IsolationForest instance
    risk_predict_fn: object
    rul_predict_fn: object
    baseline: NDArray          # mean z-score per feature from training data
    anomaly_ref: NDArray       # decision_function scores on training healthy data
    feature_names: List[str] = field(default_factory=list)
    eval_metrics: Dict[str, object] = field(default_factory=dict)
    metadata: Dict[str, object] = field(default_factory=dict)

    anomaly_version: str = _ANOMALY_VERSION
    failure_version: str = _FAILURE_MODEL_VERSION


def _get_models_dir() -> Path:
    _MODELS_DIR.mkdir(parents=True, exist_ok=True)
    return _MODELS_DIR


def _catalog_hash() -> str:
    env = os.environ.get("FORGESENSE_PROFILES_FILE")
    path = Path(env) if env else Path(__file__).resolve().parents[2] / "config" / "machine_profiles.json"
    if not path.exists():
        raise RuntimeError(f"machine profiles file not found: {path}")
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    digest.update(f"generator-schema-{_GENERATOR_SCHEMA}".encode())
    return digest.hexdigest()


def _artifact_hash() -> str:
    """Hash the loaded model files, excluding metadata that contains this hash."""
    digest = hashlib.sha256()
    for path in (_ANOMALY_PATH, _RISK_PATH, _RUL_PATH, _BASELINE_PATH,
                 _ANOMALY_REF_PATH, _HASH_PATH, _EVAL_PATH):
        digest.update(path.name.encode("utf-8"))
        digest.update(path.read_bytes())
    return digest.hexdigest()


def _metadata_is_current(metadata: Dict[str, object], profile_hash: str) -> bool:
    return (
        metadata.get("model_version") == _FAILURE_MODEL_VERSION
        and metadata.get("anomaly_model_version") == _ANOMALY_VERSION
        and metadata.get("profiles_hash") == profile_hash
        and metadata.get("feature_schema_version") == _FEATURE_SCHEMA_VERSION
        and metadata.get("training_data_version") == _TRAINING_DATA_VERSION
        and metadata.get("rul_unit") == _RUL_UNIT
        and metadata.get("rul_horizon_steps") == _RUL_HORIZON_STEPS
        and metadata.get("artifact_hash") == _artifact_hash()
    )


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
                               ) -> Tuple[NDArray, NDArray, NDArray, NDArray]:
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


def _evaluate(iso, clf, reg, X_test, y_test, y_rul_test, clean_test) -> Dict[str, object]:
    """Holdout metrics for the report; never used to train production artefacts."""
    from sklearn.metrics import mean_squared_error, roc_auc_score

    anomaly_scores = iso.decision_function(X_test)
    # anomaly detector scores HIGHER = more normal; AUC = probability that a
    # normal sample ranks above a degraded one
    anomaly_auc = roc_auc_score((clean_test == 1).astype(int), anomaly_scores)

    risk_proba = clf.predict_proba(X_test)[:, 1]
    risk_auc = roc_auc_score(y_test, risk_proba)

    fail = y_rul_test > 0
    rul_rmse = float(np.sqrt(mean_squared_error(
        y_rul_test[fail], reg.predict(X_test[fail])))) if np.any(fail) else None

    return {
        "anomaly_auc": round(float(anomaly_auc), 4),
        "risk_auc": round(float(risk_auc), 4),
        "rul_rmse_steps": None if rul_rmse is None else round(rul_rmse, 3),
        "method": "held-out 20% of generated samples (random split, seed 7); "
                  "final artefacts train on the full dataset",
        "rul_unit": _RUL_UNIT,
    }


def _build_or_load() -> ModelBundle:
    from sklearn.ensemble import GradientBoostingClassifier, GradientBoostingRegressor
    from sklearn.ensemble import IsolationForest

    d = _get_models_dir()
    current_hash = _catalog_hash()
    artifacts_present = all(p.exists() for p in
                            [_ANOMALY_PATH, _RISK_PATH, _RUL_PATH, _BASELINE_PATH, _ANOMALY_REF_PATH])
    hash_ok = _HASH_PATH.exists() and _HASH_PATH.read_text().strip() == current_hash

    metadata = {}
    if _METADATA_PATH.exists():
        try:
            metadata = json.loads(_METADATA_PATH.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            metadata = {}
    metadata_ok = artifacts_present and hash_ok and bool(metadata) and _metadata_is_current(metadata, current_hash)

    if metadata_ok:
        logger.info("Loading pre-trained models from %s (profiles hash %s…)", d, current_hash[:8])
        eval_metrics = {}
        if _EVAL_PATH.exists():
            with _EVAL_PATH.open("r", encoding="utf-8") as fh:
                eval_metrics = json.load(fh)
        return ModelBundle(
            anomaly_score_fn=joblib.load(_ANOMALY_PATH),
            risk_predict_fn=joblib.load(_RISK_PATH),
            rul_predict_fn=joblib.load(_RUL_PATH),
            baseline=np.load(_BASELINE_PATH),
            anomaly_ref=np.load(_ANOMALY_REF_PATH),
            feature_names=FEATURE_NAMES,
            eval_metrics=eval_metrics,
            metadata=metadata,
            anomaly_version=str(metadata["anomaly_model_version"]),
            failure_version=str(metadata["model_version"]),
        )

    logger.info("Training models (profiles hash %s%s)...",
                current_hash[:8], "" if artifacts_present else ", no cached artefacts")
    t0 = time.time()
    rng = np.random.RandomState(42)
    ds = _SyntheticDataset(rng)
    X, y_risk, y_rul, clean = ds.generate()

    # --- holdout evaluation report (not used for final artefacts) ---
    rng_eval = np.random.RandomState(7)
    n = X.shape[0]
    test_idx = rng_eval.choice(n, size=int(0.2 * n), replace=False)
    train_idx = np.array([i for i in range(n) if i not in set(test_idx.tolist())])

    eval_iso = IsolationForest(n_estimators=200, contamination=0.08, random_state=42)
    eval_iso.fit(X[train_idx][clean[train_idx]])
    eval_clf = GradientBoostingClassifier(
        n_estimators=250, max_depth=3, learning_rate=0.05, subsample=0.8, random_state=42,
    )
    eval_clf.fit(X[train_idx], y_risk[train_idx])
    eval_reg = GradientBoostingRegressor(
        n_estimators=300, max_depth=3, learning_rate=0.05, subsample=0.8, random_state=42,
    )
    eval_reg.fit(X[train_idx][y_risk[train_idx] == 1], y_rul[train_idx][y_risk[train_idx] == 1])
    eval_metrics = _evaluate(eval_iso, eval_clf, eval_reg,
                             X[test_idx], y_risk[test_idx], y_rul[test_idx], clean[test_idx])
    logger.info("Holdout evaluation: %s", eval_metrics)

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
    _HASH_PATH.write_text(current_hash, encoding="utf-8")
    with _EVAL_PATH.open("w", encoding="utf-8") as fh:
        json.dump(eval_metrics, fh, indent=2)

    metadata = {
        "model_version": _FAILURE_MODEL_VERSION,
        "anomaly_model_version": _ANOMALY_VERSION,
        "training_timestamp": datetime.now(timezone.utc).isoformat(),
        "feature_schema_version": _FEATURE_SCHEMA_VERSION,
        "training_data_version": _TRAINING_DATA_VERSION,
        "artifact_hash": _artifact_hash(),
        "profiles_hash": current_hash,
        "evaluation_reference": _EVAL_PATH.name,
        "code_version": os.environ.get("FORGESENSE_ML_CODE_VERSION", "unversioned"),
        "rul_unit": _RUL_UNIT,
        "rul_horizon_steps": _RUL_HORIZON_STEPS,
    }
    with _METADATA_PATH.open("w", encoding="utf-8") as fh:
        json.dump(metadata, fh, indent=2)

    elapsed = time.time() - t0
    logger.info("Models trained in %.1fs -> %s", elapsed, d)
    return ModelBundle(
        anomaly_score_fn=iso,
        risk_predict_fn=clf,
        rul_predict_fn=reg,
        baseline=baseline,
        anomaly_ref=anomaly_ref,
        feature_names=FEATURE_NAMES,
        eval_metrics=eval_metrics,
        metadata=metadata,
    )


_bundle: Optional[ModelBundle] = None


def get_bundle() -> ModelBundle:
    global _bundle
    if _bundle is None:
        _bundle = _build_or_load()
    return _bundle


def get_eval_metrics(bundle: Optional[ModelBundle] = None) -> Dict[str, object]:
    b = bundle or get_bundle()
    return b.eval_metrics
