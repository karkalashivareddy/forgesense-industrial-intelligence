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

## Evaluation boundary

The current generated evaluation report records anomaly ROC AUC `0.8859`,
failure-risk ROC AUC `0.9978`, and RUL RMSE `27.18` steps. It uses a random
20% sample split with seed 7; the final model artifacts are then trained on
the full generated dataset. The split is by row, so samples from one simulated
machine timeline may appear in both training and held-out partitions. It is
not an evaluation on unseen machines, trajectories, or a real plant.

These values describe performance only on samples from the same synthetic
generator. High held-out synthetic performance does not establish real-world
industrial predictive validity.

### Reproducing these numbers

The model artifacts are generated, not committed — `.gitignore` excludes
`ml-service/models/*.pkl`, `*.npy`, and `*.json`. The metrics therefore exist
only after a training run, so the values above are reproduced by generating them
rather than by reading a checked-in file:

```sh
cd ml-service
python -m venv .venv && . .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m pytest tests -q                        # 8 tests
```

Importing `app.models` and calling its artifact builder on a checkout with no
`models/` directory generates the artifacts and writes the report to
`ml-service/models/eval-metrics.json`. A from-scratch run on 2026-10-06
reproduced all three values exactly, which is what the seeded split exists to
guarantee:

```json
{
  "anomaly_auc": 0.8859,
  "risk_auc": 0.9978,
  "rul_rmse_steps": 27.18,
  "rul_unit": "steps"
}
```

Generation is deterministic but not fast: the same run took roughly 220 s on the
development machine, since it trains four models from the generated dataset.

## Missing and unknown data

The service rejects unknown machine IDs, mismatched machine types, invalid
timestamps, non-finite numeric values, and samples missing required sensors.
It does not turn missing sensors into nominal values at the API boundary.
