# Ownership and authorship

The documentation index lives in [README.md](README.md). This file records who
owns the work.

## Author

**Karkala Shiva Reddy** — design, implementation, documentation and release
engineering for ForgeSense Industrial Intelligence.

## Repository-wide conventions

- Documentation states what the code does. Where a document and the source
  disagree, the source is authoritative and the document is a defect.
- ForgeSense renders synthetic telemetry from the simulator in this repository.
  It does not monitor or control physical machinery.
- Generated model artifacts are derived from `config/machine_profiles.json` and
  are not hand-edited. See [ML_PROVENANCE.md](ML_PROVENANCE.md).
- Every release change is verified by the gate in
  [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).
