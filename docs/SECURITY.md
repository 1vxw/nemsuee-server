# Security Documentation

This document summarizes current backend security controls and operational recommendations.

## 1) Authentication and Session Security

- JWT is used for authentication.
- Tokens are accepted from:
  - `Authorization: Bearer <token>`
  - `nemsuee_auth` cookie
- Cookie settings:
  - `httpOnly: true`
  - `secure: true` outside localhost
  - `sameSite: none` (secure contexts) or `lax` (localhost)

Recommendations:

- Keep `JWT_SECRET` long/random and rotate periodically.
- Use HTTPS in all non-local environments.
- Consider refresh-token strategy and shorter access token TTL for stricter security posture.

## 2) Authorization

- Role checks are applied in middleware and route handlers.
- Roles in use:
  - `STUDENT`, `INSTRUCTOR`, `ADMIN`, `REGISTRAR`, `DEAN`, `GUEST`
- Access checks also validate ownership/membership for many course, section, and submission operations.

Recommendations:

- Add integration tests for each sensitive route role matrix.
- Review any `requireAuth`-only endpoints for role leakage risk.

## 3) API Access Gate

The backend supports an admin-managed API access gate:

- Allows trusted website-origin requests, or
- Allows valid API-key requests
- Configured under `/api/admin/settings/security*`

Implementation details:

- API keys are stored hashed (`sha256`) in app settings
- Key comparison uses constant-time equality check
- Key rotation/revocation available through admin API

Important:

- Origin checks are a browser-hardening layer, not a cryptographic identity proof.
- For server-to-server calls, use API keys.

## 4) CORS and CSRF

- CORS is enforced using configured trusted origins.
- Unsafe methods (`POST`, `PUT`, `PATCH`, `DELETE`) include origin validation guard.

Recommendations:

- Always set `ALLOWED_ORIGINS` in production.
- Keep frontend and API domains explicit; avoid wildcard patterns.

## 5) Input Validation

- Zod schemas are used heavily across auth and feature routes.
- Invalid payloads return `400`.

Recommendations:

- Keep schema rules centralized per module.
- Add unit tests for schema edge cases.

## 6) Password and Account Security

- Passwords are hashed with `bcryptjs`.
- Email verification flow is enforced before full account activation.
- Password reset uses opaque tokens hashed server-side.

Recommendations:

- Add lockout/backoff after repeated failed logins.
- Add bot mitigation (captcha/risk checks) on public auth endpoints.

## 7) Rate Limiting

- In-memory rate limiting is active for API and auth paths.
- Additional limits for login/register/promote-admin/account-status.

Recommendations:

- For multi-instance production, move rate limiting to shared store (Redis) to avoid per-instance bypass.

## 8) Data Protection

- Sensitive secrets should be environment variables only.
- Avoid committing `.env` files or tokens.

Incident response reminder:

- If any token/secret is exposed, rotate immediately and invalidate affected credentials.

## 9) Operational Hardening Checklist

- [ ] `NODE_ENV=production`
- [ ] `JWT_SECRET` set and rotated policy defined
- [ ] `ALLOWED_ORIGINS`/`FRONTEND_URL` set correctly
- [ ] HTTPS enforced end-to-end
- [ ] SMTP and Google credentials stored in secret manager
- [ ] Logs do not contain secrets or PII
- [ ] Backup and restore process documented
- [ ] Health and alerting configured (`/api/health`)

## 10) Future Improvements

- Centralized audit log for privilege changes/admin actions
- Shared distributed rate limiter
- Threat-model review for origin-based access gate assumptions
- Formal migration strategy replacing runtime schema guards
