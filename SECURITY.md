# Security Policy

## Supported versions

Security fixes are applied to the `main` branch, which carries the current
release. There are no separate long-term-support branches.

## Reporting a vulnerability

Please report suspected vulnerabilities privately to the repository owner
rather than opening a public issue. Include the affected component, the
reproduction steps, and the impact you observed.

## What this system is — and is not

ForgeSense is an industrial-operations console that authenticates operators,
separates read from control capability by role, and refuses to imply authority
it does not enforce.

ForgeSense **cannot control physical machinery**. There is no OPC-UA client, no
MQTT client, and no fieldbus driver anywhere in the codebase. The simulator
generates telemetry in-process; the console reads it. Authorization protects
*console actions*, not equipment. Any statement implying the system commands a
machine would be false.

## Authentication

- `POST /api/v1/auth/login` exchanges credentials for a signed JWT.
- The JWT is held in `sessionStorage`: tab-scoped, discarded when the tab
  closes, never written to `localStorage`, and never placed in a JS-readable
  cookie.
- The signing key is supplied by configuration. In `dev` demo mode a key is
  generated at startup and **must not** be relied on across restarts.

## Roles

| Role | Granted authorities | Capability |
|---|---|---|
| `operator` | `ROLE_OPERATOR` | Read dashboards, telemetry and predictions; acknowledge alerts |
| `engineer` | `ROLE_OPERATOR`, `ROLE_ENGINEER` | Operator plus scenario injection and simulator control |
| `admin` | `ROLE_OPERATOR`, `ROLE_ENGINEER`, `ROLE_ADMIN` | Engineer plus configuration and administration |

Roles are cumulative. Three accounts are seeded in demo mode: `operator`,
`engineer`, `admin`. There is no separate read-only role.

## Authorization is enforced server-side

Control-plane endpoints carry `@PreAuthorize("hasAnyRole('ENGINEER', 'ADMIN')")`
on every state-changing operation — scenario run, scenario apply, scenario
clear, pause, resume and reset. The frontend hides controls an operator cannot
use, but **hiding a button is a usability affordment, not a security boundary**.
Role enforcement is covered by `SecurityRbacIntegrationTest`.

Measured behaviour:

| Request | Result |
|---|---|
| `operator` → `POST /api/v1/simulation/control` | `403 Forbidden` |
| `admin` → `POST /api/v1/simulation/control` | accepted |

## Realtime

The STOMP WebSocket is authenticated: the client supplies its JWT when
connecting, and `StompAuthenticationInterceptor` rejects unauthenticated
subscriptions. Anonymous socket access is not permitted.

## Threat model and trust boundaries

Protected assets include user credentials and JWT signing material, machine
state and telemetry, alert/maintenance records, scenario controls, model
artifacts, and service availability. Browser clients are untrusted. The backend
is the authorization boundary for REST and STOMP operations. The ML API is a
server-to-server dependency; it has no request authentication and must only be
reachable from a trusted service network. Compose no longer publishes its
port on the host. Compose places it and the backend on a dedicated internal
network; the backend also remains on the application network for its other
dependencies. This is network scoping rather than per-service authentication.

The development Compose topology publishes the frontend, backend, Prometheus,
and Grafana on loopback only. PostgreSQL, Redis, Kafka, and ML inference have no
host-published ports. Do not expose that topology directly to the public
internet. A real deployment still needs a reviewed firewall and TLS terminator,
restricted management and monitoring access, and unique deployment credentials.
Compose is a local integrated demo, not a hardened production deployment.

## Secrets

- The CI workflow is configured to run Gitleaks against the full Git history.
  A local full-history run reproduced one historical synthetic JWT test-key
  pattern in commit `994183f`; after adding its exact fingerprint to the
  ignore file, the scan returned no other findings. The fixture was removed
  from current source and replaced by an ephemeral key. The exception does not
  cover other findings in that file, rule, or commit. The new CI action has
  not yet run for this candidate. History was not rewritten because this was
  not a deployed credential.
- CI database, demo-account, Grafana and JWT test credentials are generated
  per job, masked by the runner, and never reused as deployment credentials.
- The CI workflow audits npm and Python dependencies and scans supported
  manifests, including the Maven `pom.xml`, against OSV advisories. The new OSV
  job has not yet run remotely. Its local Maven query stalled before results;
  see `docs/ENGINEERING_AUDIT.md` for the exact result and limitation.
- Development credentials are development-only and must be overridden via
  `.env` for any real deployment.
- Never reuse a development secret elsewhere.

`.env` itself is git-ignored and is never committed. `.env.example` contains
placeholders only, so a value there is not a deployed credential.

The Docker Compose profile does not fall back to a baked-in password. The
backend, PostgreSQL, and Grafana services all read their secret with Compose's
`:?` form, so `docker compose up` **refuses to start** rather than silently
running on `forgesense-dev`. Supply the values in `.env` first:

| Variable | Purpose | Compose behaviour if unset |
|---|---|---|
| `FORGESENSE_SECURITY_JWT_SECRET` | JWT signing key (min. 48 bytes) | **required**, startup fails |
| `FORGESENSE_DEV_PASSWORD` | Seeded demo account password | **required**, startup fails |
| `POSTGRES_PASSWORD` | Container database password | **required**, startup fails |
| `GRAFANA_ADMIN_PASSWORD` | Grafana admin password | **required**, startup fails |
| `FORGESENSE_ALLOWED_ORIGINS` | CORS allow-list | has a documented local default |

Any explicitly supplied JWT signing key shorter than 48 UTF-8 bytes is rejected
at startup, including in demo mode; an invalid configured key is never silently
replaced with a random one. With no key, only the documented demo mode may
generate a fresh per-process key.

`.env.example` shows `change-me-in-production-48-bytes-minimum-change-me` for the
JWT secret. That is a visible placeholder, not a key, and it is deliberately
recognisable so a deployment that keeps it is obvious in review. Generate a
unique value, for example:

```sh
openssl rand -base64 48
```

## Known limitations

Stated plainly rather than implied:

- The H2 console and actuator endpoints are development-profile conveniences
  and are not intended for an exposed deployment.
- The simulator's authenticated endpoints can inject scenarios into the feed.
  That is the product's purpose; it is restricted to engineer and admin.
- Model output is decision support, not an authoritative maintenance or safety
  instruction.

## Incident response and secret rotation

1. Restrict network access to the affected deployment and preserve relevant
   access/application logs without copying tokens or credentials into tickets.
2. Rotate the JWT signing key and affected database, Grafana, or seeded demo
   credentials through the deployment secret manager; do not place replacements
   in source control or image build arguments.
3. Recreate affected services. JWT key rotation invalidates active sessions;
   users must authenticate again. Rotate database credentials in the database
   and application configuration as one coordinated change.
4. Review access logs and persisted operator actions for unauthorized changes,
   restore from a verified backup if integrity is affected, and document impact
   and recovery actions.
5. Report suspected vulnerabilities privately to the repository owner.
