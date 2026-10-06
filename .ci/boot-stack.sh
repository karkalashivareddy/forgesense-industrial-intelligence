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

# Every secret below is a throwaway CI placeholder, scoped to an ephemeral
# runner with no exposed port. They are defined here rather than in the workflow
# because docker-compose.yml reads them with the `:?` form, which refuses to
# interpolate at all when a value is missing. GRAFANA_ADMIN_PASSWORD is included
# for the same reason: Compose parses the whole file before it runs anything, so
# a required variable anywhere in it must be set even by a job that only builds
# the frontend image.
: "${POSTGRES_PASSWORD:=ci-postgres-password}"
: "${FORGESENSE_SECURITY_JWT_SECRET:=ci-jwt-signing-secret-for-browser-tests-only}"
: "${FORGESENSE_DEV_PASSWORD:=ci-browser-run-password}"
: "${GRAFANA_ADMIN_PASSWORD:=ci-grafana-password}"
# The Playwright fixtures read E2E_PASSWORD and deliberately have no default of
# their own, so the credential the browser signs in with must be the same one
# the backend was seeded with.
export E2E_PASSWORD="$FORGESENSE_DEV_PASSWORD"
# The Playwright config serves the console with `vite preview` on port 4173, so
# the browser origin is http://127.0.0.1:4173. The frontend calls the backend
# cross-origin (VITE_API_BASE_URL defaults to http://localhost:8080), so this
# origin has to be in the backend allowlist or the browser blocks every API
# call and sign-in never completes. 5173 is kept for the compose-served console.
: "${FORGESENSE_ALLOWED_ORIGINS:=http://localhost:5173,http://127.0.0.1:5173,http://127.0.0.1:4173}"
export POSTGRES_PASSWORD FORGESENSE_SECURITY_JWT_SECRET FORGESENSE_DEV_PASSWORD \
  GRAFANA_ADMIN_PASSWORD FORGESENSE_ALLOWED_ORIGINS

log() { printf '\n[boot-stack] %s\n' "$1"; }

# Tear down ONLY when booting failed. On success the stack must outlive this
# script: it is the backend the Playwright run talks to. A blanket
# `trap cleanup EXIT` combined with `exit 0` tore the whole stack down the
# moment the backend became ready, so the browser run got a dead backend and
# every sign-in timed out. The workflow tears the stack down in an
# `if: always()` step after the tests instead.
cleanup_on_failure() {
  status=$?
  if [ "$status" -ne 0 ]; then
    log "Boot failed (exit $status) - tearing down"
    docker compose down -v --remove-orphans >/dev/null 2>&1 || true
  fi
}
trap cleanup_on_failure EXIT

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
