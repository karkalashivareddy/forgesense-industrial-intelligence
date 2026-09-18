"""Transparent local feature attribution via replace-with-baseline.

For every active feature the baseline value (the average of the training
data) is substituted one-at-a-time.  The change in the model output is
attributed to that feature.  This is a local *baseline-perturbation* method:
any resemblance to KernelSHAP is only in spirit (both measure the effect of
replacing a feature value), and no SHAP library or axioms are involved.  It
runs in O(F) model evaluations rather than 2^F or Monte Carlo samples, making
it suitable for real-time inference.  The approximation is local and
first-order; it does not capture interactions but is well-understood,
deterministic, and honest.
"""

from __future__ import annotations

from typing import Dict, List, Optional, Tuple

import numpy as np
from numpy.typing import NDArray

from .features import FEATURE_LABELS, FEATURE_NAMES, applicable_sensors
from .models import ModelBundle


def _anomaly_contributions(bundle: ModelBundle, x: NDArray, baseline: NDArray,
                           applicable_indices: List[int]) -> List[Tuple[str, float]]:
    """Return per-feature contribution to anomaly score (lower = more anomalous).

    IsolationForest ``decision_function`` returns higher scores for inliers.
    A feature whose removal (replacement with baseline) makes the score go
    UP means the feature was *pulling* the score down → anomalous.
    """
    base_score = float(bundle.anomaly_score_fn.decision_function(x.reshape(1, -1))[0])
    contributions: List[Tuple[str, float]] = []
    for idx in applicable_indices:
        x_perturbed = x.copy()
        x_perturbed[idx] = baseline[idx]
        perturbed_score = float(bundle.anomaly_score_fn.decision_function(x_perturbed.reshape(1, -1))[0])
        contribution = base_score - perturbed_score  # positive = pulls score down = anomalous
        contributions.append((FEATURE_NAMES[idx], contribution))
    contributions.sort(key=lambda c: abs(c[1]), reverse=True)
    return contributions


def _risk_contributions(bundle: ModelBundle, x: NDArray, baseline: NDArray,
                        applicable_indices: List[int]) -> List[Tuple[str, float]]:
    """Return per-feature contribution to failure-risk probability."""
    base_risk = float(bundle.risk_predict_fn.predict_proba(x.reshape(1, -1))[0, 1])
    contributions: List[Tuple[str, float]] = []
    for idx in applicable_indices:
        x_perturbed = x.copy()
        x_perturbed[idx] = baseline[idx]
        perturbed_risk = float(bundle.risk_predict_fn.predict_proba(x_perturbed.reshape(1, -1))[0, 1])
        contributions.append((FEATURE_NAMES[idx], base_risk - perturbed_risk))
    contributions.sort(key=lambda c: abs(c[1]), reverse=True)
    return contributions


def _label(contribution: float, threshold: float = 0.05) -> str:
    if contribution > threshold:
        return "ELEVATED"
    elif contribution < -threshold:
        return "REDUCED"
    return "NEUTRAL"


def _direction(contribution: float) -> str:
    return "up" if contribution > 0 else "down" if contribution < 0 else "flat"


def compute_factors(bundle: ModelBundle, x: NDArray, machine_id: Optional[str],
                    machine_type: Optional[str],
                    top_n: int = 5) -> Tuple[List[Dict], List[Tuple[str, float, float]]]:
    """Compute attribution factors and return both structured dicts and raw contributions."""
    applicable = applicable_sensors(machine_id, machine_type)
    indices = [FEATURE_NAMES.index(n) for n in applicable if n in FEATURE_NAMES]

    anomaly_contri = _anomaly_contributions(bundle, x, bundle.baseline, indices)
    risk_contri = _risk_contributions(bundle, x, bundle.baseline, indices)

    # combine: weight anomaly by 0.4 and risk by 0.6 for overall attribution
    contra_map: Dict[str, float] = {}
    for name, val in risk_contri:
        contra_map[name] = contra_map.get(name, 0.0) + val * 0.6
    for name, val in anomaly_contri:
        contra_map[name] = contra_map.get(name, 0.0) + val * 0.4

    combined = sorted(contra_map.items(), key=lambda c: abs(c[1]), reverse=True)[:top_n]

    factors: List[Dict] = []
    for name, value in combined:
        factors.append({
            "feature": FEATURE_LABELS.get(name, name),
            "contribution": round(float(value), 4),
            "label": _label(float(value)),
            "direction": _direction(float(value)),
        })

    return factors, [(n, v, 0.0) for n, v in combined]


def _recommendations(factors: List[Dict], anomaly_label: str,
                     risk: float, machine_type: str) -> List[str]:
    recs: List[str] = []
    elevated = [f for f in factors if f["label"] == "ELEVATED"]

    if risk > 0.85:
        recs.append(f"Critical risk ({risk:.0%}): immediate inspection recommended.")
    elif risk > 0.6:
        recs.append(f"Elevated risk ({risk:.0%}): schedule technical inspection.")

    if anomaly_label == "ANOMALY":
        recs.append("Anomaly signature detected: verify sensor cabling and mounting.")
    elif anomaly_label == "WATCH":
        recs.append("Elevated deviation from nominal: monitor closely over next shifts.")

    for f in elevated:
        feat = f["feature"]
        if feat == "Vibration":
            recs.append("Vibration elevated: check bearings, mounts, or alignment.")
        elif feat == "Temperature":
            recs.append("Temperature elevated: inspect lubrication and cooling paths.")
        elif feat == "Current":
            recs.append("Current draw elevated: check motor load and mechanical binding.")
        elif feat in ("Pressure", "Flow"):
            recs.append("Fluid system deviation: inspect seals, filters, or valve settings.")
        elif feat in ("RPM", "Torque"):
            recs.append("Mechanical output deviation: check drive coupling and load.")

    if not recs:
        recs.append("Operating within normal parameters.")

    return recs
