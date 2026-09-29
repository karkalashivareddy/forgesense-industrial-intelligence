#!/usr/bin/env bash
#
# Boot the minimum ForgeSense stack required for a Playwright browser run.
#
# The console needs a reachable backend and a reachable ML service. Postgres,
# Redis and Kafka are started too because the docker profile wires the backend
# to them, but nothing in the E2E suite asserts on them directly.
#
# Deliberately not a full `docker compose up`: starting the simulator would
# make assertions about a *changing* fleet non-deterministic, and the console is
# explicitly designed to render correctly with no incoming telemetry.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

: "${POSTGRES_PASSWORD:=ci-postgres-password}"
: "${FORGESENSE_SECURITY_JWT_SECRET:=ci-jwt-signing-secret-for-browser-tests-only}"
: "${FORGESENSE_DEV_PASSWORD:=forgesense-dev}"
export POSTGRES_PASSWORD FORGESENSE_SECURITY_JWT_SECRET FORGESENSE_DEV_PASSWORD

log() { printf '\n[boot-stack] %s\n' "$1"; }

cleanup() {
  log "Tearing down"
  docker compose down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

log "Starting postgres, redis, kafka, ml-service and backend"
docker compose up -d --wait postgres redis kafka ml-service backend

log "Waiting for the backend to become ready"
# Probe /actuator/health, not /api/v1/factories. The browser run needs security
# ON (the Playwright fixtures sign in), and SecurityConfig permits only
# /api/v1/auth/**, /actuator/health/**, /ws/** and /error anonymously. Probing
# an authenticated endpoint anonymously returns 401, so `curl -sf` never
# succeeded and this script always timed out. /actuator/health is also the
# genuine readiness signal: it stays 503 until ApplicationReadyEvent completes.
ready=0
for i in $(seq 1 120); do
  if curl -sf http://localhost:8080/actuator/health >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done

if [ "$ready" -ne 1 ]; then
  log "Backend did not become ready in time"
  log "last health status: $(curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/actuator/health 2>/dev/null || echo unreachable)"
  log "last health body:   $(curl -s http://localhost:8080/actuator/health 2>/dev/null || echo unreachable)"
  docker compose logs --tail 60 backend
  exit 1
fi

log "Backend is ready after ${i}s"
log "health: $(curl -s http://localhost:8080/actuator/health)"
exit 0
