"""Train and persist the ForgeSense ML models.

Usage (from repository root):

    python -m scripts.train

Deterministic (random_state=42) so CI and local devs produce byte-identical
models. The application also trains lazily on first boot if the artefacts are
missing, so this script is mainly for explicit regeneration and CI checks.
"""

from __future__ import annotations

import logging
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("forgesense.ml.train")


def main() -> None:
    t0 = time.time()
    from app.models import _build_or_load

    bundle = _build_or_load()
    elapsed = time.time() - t0
    logger.info(
        "Models ready: anomaly=%s failure=%s (took %.1fs)",
        bundle.anomaly_version,
        bundle.failure_version,
        elapsed,
    )


if __name__ == "__main__":
    main()