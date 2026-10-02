# Security

ForgeSense is an industrial-operations console. It authenticates operators,
separates read and control capability by role, and refuses to invent authority
it does not enforce.

## What this system is not

ForgeSense **cannot control physical machinery**. There is no OPC-UA client, no
MQTT client, and no fieldbus driver anywhere in the repository. The simulator
generates telemetry in-process; the console reads it. Authorization protects
*console actions*, not equipment.

Any statement implying the system commands a machine would be false.

## Authentication

- `POST /api/v1/auth/login` exchanges credentials for a signed JWT.
- The JWT is held in `sessionStorage`: tab-scoped, discarded when the tab
  closes, never written to `localStorage`, never placed in a JS-readable cookie.
  See [FRONTEND_ARCHITECTURE.md](FRONTEND_ARCHITECTURE.md) for the session model.
- The signing key is supplied by configuration. In `dev` demo mode a key is
  generated at startup and **must not** be relied on across restarts.

## Roles

| Role | Capability |
|---|---|
| `viewer` | Read-only: dashboards, telemetry, reports |
| `operator` | Viewer plus acknowledging alerts and recording work |
| `engineer` | Operator plus scenario injection and machine control actions |
| `admin` | Engineer plus configuration and administrative operations |

Control-plane endpoints are protected server-side with `@PreAuthorize`, for
example:

```java
@PreAuthorize("hasAnyRole('ENGINEER', 'ADMIN')")
```

The frontend hides controls an operator cannot use, but **the backend is
authoritative**. Hiding a button is a usability affordance, not a security
boundary; every protected endpoint re-checks the role on the server. Role
enforcement is covered by `SecurityRbacIntegrationTest`.

## Realtime

The STOMP WebSocket is authenticated: the client supplies its JWT when
connecting, and `StompAuthenticationInterceptor` rejects unauthenticated
subscriptions. Anonymous socket access is not permitted.

## Secrets

- No real credential is committed. The CI hygiene job fails the build if a
  tracked credential default appears in the tree.
- Development credentials are development-only. Override them via `.env`:
  `FORGESENSE_DEV_PASSWORD`, `FORGESENSE_SECURITY_JWT_SECRET`,
  `POSTGRES_PASSWORD`.
- Never reuse a development secret in a real deployment.

## Known security limitations

Stated plainly rather than implied:

- The H2 console and actuator are development-profile conveniences and are not
  intended for an exposed deployment.
- The simulator's authenticated endpoints can be used to inject scenarios. That
  is the product's purpose; it is gated to engineer and admin roles.

## Reporting

Report suspected vulnerabilities privately to the repository owner rather than
opening a public issue.
