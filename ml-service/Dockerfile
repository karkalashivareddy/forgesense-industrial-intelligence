# syntax=docker/dockerfile:1
# Build context is the repository root so the authoritative profile catalog
# (config/machine_profiles.json) can be baked into the image and the models
# trained at image build time against it.
FROM python:3.13-slim

WORKDIR /opt/forgesense-ml

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FORGESENSE_PROFILES_FILE=/config/machine_profiles.json

COPY ml-service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY config/machine_profiles.json /config/machine_profiles.json
COPY ml-service/app ./app
COPY ml-service/scripts ./scripts

RUN mkdir -p /opt/forgesense-ml/models \
    && python -m scripts.train

EXPOSE 8001

HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
    CMD python -c "import urllib.request;urllib.request.urlopen('http://localhost:8001/health')" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]