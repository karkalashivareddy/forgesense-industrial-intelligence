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

## Secrets

- No real credential is committed. The CI hygiene job fails the build if a
  tracked credential default appears in the tree.
- Development credentials are development-only and must be overridden via
  `.env` for any real deployment.
- Never reuse a development secret elsewhere.

| Variable | Purpose |
|---|---|
| `FORGESENSE_SECURITY_JWT_SECRET` | JWT signing key |
| `FORGESENSE_DEV_PASSWORD` | Seeded account password (demo only) |
| `POSTGRES_PASSWORD` | Container database password |
| `FORGESENSE_ALLOWED_ORIGINS` | CORS allow-list |

## Known limitations

Stated plainly rather than implied:

- The H2 console and actuator endpoints are development-profile conveniences
  and are not intended for an exposed deployment.
- The simulator's authenticated endpoints can inject scenarios into the feed.
  That is the product's purpose; it is restricted to engineer and admin.
- Model output is decision support, not an authoritative maintenance or safety
  instruction.