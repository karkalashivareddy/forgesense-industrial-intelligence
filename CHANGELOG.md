# Changelog

## Unreleased — 2026-10-09

- Pinned patched transitive Tomcat, Jackson 2/3 and lz4-java releases after the
  first full Maven OSV scan found advisories; Maven clean verification and the
  full local transitive rescan pass. The first pushed candidate's OSV workflow
  failed on these findings; corrective run 37908716485 passed all seven jobs,
  including the dependency scan.
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
  verification evidence; at that audit point Docker runtime and the remote
  workflow were not re-verified.
- Added a full-history Gitleaks check with one exact historical test-fixture
  fingerprint exception, an OSV manifest scan, and immutable SHA pins for CI
  actions. The local historical scan was reproduced; remote execution of these
  new CI steps remains pending.
