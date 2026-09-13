# syntax=docker/dockerfile:1
# Build context is the repository root so the authoritative profile catalog
# (config/machine_profiles.json) is available to the feed process.
FROM python:3.13-slim

WORKDIR /opt/forgesense-simulator

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FORGESENSE_PROFILES_FILE=/config/machine_profiles.json

COPY simulator/profiles.py .
COPY simulator/telemetry_feed.py .
COPY config/machine_profiles.json /config/machine_profiles.json

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD python -c "import json,os;from profiles import load_catalog;load_catalog();print('profiles ok')" || exit 1

CMD ["python", "-u", "telemetry_feed.py"]