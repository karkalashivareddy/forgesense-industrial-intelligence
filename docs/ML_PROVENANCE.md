# ForgeSense ML provenance and output contract

The ML service is a private backend dependency. Its `/health` response is the
authoritative runtime record for the loaded artifacts; the Spring backend does
not invent or override those versions.

The response includes:

- `model_version` and `anomaly_model_version`
- `training_timestamp`
- `feature_schema_version`
- `training_data_version`
- `artifact_hash` and `profiles_hash`
- `evaluation_reference`
- `code_version`
- `rul_unit` and `rul_horizon_steps`

Artifacts are generated deterministically from `config/machine_profiles.json`
and the synthetic generator seed. A metadata file is written beside the
artifacts. If it is missing, stale, or its hashes do not match, the service
rebuilds the artifacts before serving assessments. Generated files are not a
production deployment claim and are not physical-machine measurements.

## RUL semantics

`rulEstimate` is an estimated remaining degradation **step count**. The target
is the simulator's synthetic 60-step degradation horizon. It is not hours, and
the service performs no arbitrary step-to-hour conversion. No physical RUL
accuracy is claimed.

## Model cards

| Model | Target and horizon | Inputs and units | Evaluation population |
|---|---|---|---|
| Anomaly detector | Distinguish nominal (`clean`) from samples after the synthetic degradation ramp begins; no physical time horizon | Instantaneous sensor readings converted to profile-relative z-scores; fixed `FEATURE_NAMES` order | IsolationForest fitted on healthy rows from training trajectories; threshold is the 95th percentile of training healthy anomaly scores |
| Failure risk | Synthetic label is positive within 60 simulator steps of the generated failure peak | Same instantaneous profile-relative sensor z-scores; no sequence or future telemetry features | GradientBoosting classifier; reported threshold is fixed at 0.5 and is not selected on the test set |
| Remaining degradation | Remaining simulator steps to the synthetic failure peak, clamped to the 60-step target horizon | Same sensor vector; output unit is `steps` only | GradientBoosting regressor fitted and evaluated only on failure-risk-positive samples |

Generator label structure is intentionally simplified and creates strong
degradation patterns. In particular, classifier output is not validated as a
real-world calibrated failure probability. The Brier score is a single
synthetic holdout summary, not a calibration study. No uncertainty intervals
are reported; 8 held-out machine groups are too few to support stable claims
across industrial populations. The 7,200 rows are correlated within those
groups and must not be interpreted as 7,200 independent machines.

## Evaluation boundary

The previously published metric values came from a random row split and are
withdrawn: rows from one simulated machine timeline appeared in both train and
test partitions. Evaluation now uses a deterministic `GroupShuffleSplit` over
synthetic machine trajectories (seed 7). Feature transformations are fixed
profile z-scores, not fitted on the holdout. The anomaly threshold is selected
from training healthy scores only; the failure-risk threshold is fixed at 0.5.
The final model artifacts are trained on all generated data after evaluation.

The report records anomaly ROC AUC and PR AUC, thresholded precision/recall,
failure-risk ROC AUC and PR AUC, confusion matrix/precision/recall/F1 at 0.5,
Brier score, class prevalence and majority-class accuracy baselines, RUL MAE
and RMSE in simulator steps, row counts, held-out trajectory count, and the
split method.
Evaluation stops with an error if the holdout lacks either class. The
2026-10-09 run produced:

| Metric | Result |
|---|---:|
| Holdout | 8 machine trajectories; 7,200 rows; 926 risk-positive rows (12.86%) |
| Anomaly ROC AUC / PR AUC | 0.9037 / 0.8729 |
| Anomaly threshold / precision / recall | 0.009576 / 0.8654 / 0.7466 |
| Anomaly prevalence / majority accuracy baseline | 0.2619 / 0.7381 |
| Failure-risk ROC AUC / PR AUC | 0.9976 / 0.9843 |
| Failure-risk precision / recall / F1 at 0.5 | 0.9190 / 0.9309 / 0.9249 |
| Failure-risk confusion matrix (true rows, predicted columns) | `[[6198, 76], [64, 862]]` |
| Failure-risk Brier score / accuracy | 0.013485 / 0.9806 |
| Failure-risk majority accuracy baseline | 0.8714 |
| RUL MAE / RMSE | 10.163 / 13.603 simulator steps |

Evaluation timestamp: `2026-10-09T05:39:44.688366+00:00`; generator version
`synthetic-generator-v4`; generator seed 42; feature schema
`instantaneous-zscore-v1`; split seed 7; Python 3.14.6, NumPy 2.5.3,
scikit-learn 1.9.1. The project documents Python 3.13; this run used the local
Python 3.14 virtual environment. These metrics describe generated held-out machines only. This repository
contains no independently collected industrial failure dataset and no
production performance evidence.

### Reproducing these numbers

The model artifacts are generated, not committed — `.gitignore` excludes
`ml-service/models/*.pkl`, `*.npy`, and `*.json`. The metrics therefore exist
only after a training run, so the values above are reproduced by generating them
rather than by reading a checked-in file:

```sh
cd ml-service
python -m venv .venv
# Activate the environment, then:
python -m pip install -r requirements.txt
python -m pytest tests -q
python scripts/train.py
```

The training command generates `ml-service/models/eval-metrics.json` and
versioned model metadata locally. It is deterministic for the current
generator and library versions, but generated joblib artifacts are not
committed. Record the emitted report when making a new metric claim; never
reuse values from the withdrawn row-level split.

## Missing and unknown data

The service rejects unknown machine IDs, mismatched machine types, invalid
timestamps, non-finite numeric values, and samples missing required sensors.
It does not turn missing sensors into nominal values at the API boundary.
