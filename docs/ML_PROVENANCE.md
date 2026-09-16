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

## Missing and unknown data

The service rejects unknown machine IDs, mismatched machine types, invalid
timestamps, non-finite numeric values, and samples missing required sensors.
It does not turn missing sensors into nominal values at the API boundary.
