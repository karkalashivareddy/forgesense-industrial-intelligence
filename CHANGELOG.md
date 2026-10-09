# Changelog

## Unreleased — 2026-10-09

- Replaced row-random ML evaluation with deterministic machine-trajectory
  holdout; aligned RUL evaluation to the regressor's positive target cohort and
  documented the resulting synthetic-only metrics and limits.
- Removed host publication of the unauthenticated ML API and isolated it with
  the backend on an internal Compose network; added a CI topology assertion
  and per-run generated, masked CI credentials. Published demo ports bind to
  loopback, and CI asserts that network policy.
- Fixed Windows Maven wrapper handling of a regular local cache directory.
- Made explicitly configured JWT keys shorter than 48 bytes fail closed and
  added signing/verification and missing-key regression tests. Test signing
  keys are generated ephemerally rather than stored as literals.
- Updated the vulnerable pytest constraint to a fixed release and added npm
  and Python advisory checks, read-only workflow permissions, and finite CI job
  timeouts. CI now uses Maven clean verification, builds every Compose
  application image, and uploads the Playwright report from its workspace path.
- Added the current engineering audit, security trust boundaries, and
  verification evidence. Docker runtime and remote CI remain unverified.
