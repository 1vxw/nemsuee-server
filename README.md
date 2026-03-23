# NEMSUEE Backend API

Production-ready Express + TypeScript backend for the NEMSU E-Learning Environment.

## Overview

This service provides:

- Authentication and session management
- Role-based authorization (`STUDENT`, `INSTRUCTOR`, `ADMIN`, `REGISTRAR`, `DEAN`, `GUEST`)
- Course, quiz, task, term, and grade-computation APIs
- Notification APIs
- Google Drive integration (OAuth or Service Account mode)
- Admin settings and API security gate management

Core stack:

- Node.js + Express 5
- TypeScript
- Prisma client (SQLite datasource)
- Zod validation
- JWT auth (cookie + bearer)

## Project Structure

```text
backend/
  src/
    app.ts                 # Express app/middleware setup
    server.ts              # Startup entrypoint
    bootstrap.ts           # DB bootstrap/compat table setup
    middleware/            # auth, rate limiter, API gate
    routes/                # API route groups
    modules/               # domain modules (auth, courses, terms, offerings)
    services/              # shared services (mailer, drive, notifications, settings)
  prisma/
    schema.prisma
    seed.ts
```

## Quick Start

### 1) Install

```bash
cd backend
npm install
```

### 2) Configure env

Copy `.env.example` to `.env` and fill required values:

```env
DATABASE_URL="file:./dev.db"
PORT=5000
JWT_SECRET="replace-me-with-a-strong-secret"
FRONTEND_URL="http://localhost:5173"
```

### 3) Generate Prisma client

```bash
npm run prisma:generate
```

### 4) Run dev server

```bash
npm run dev
```

API base: `http://localhost:5000/api`

Health check: `GET /api/health`

## Scripts

- `npm run dev` - start in watch mode (`tsx`)
- `npm run build` - compile TypeScript to `dist/`
- `npm run start` - generate Prisma client then run compiled server
- `npm run test` - run Vitest
- `npm run prisma:generate` - generate Prisma client
- `npm run prisma:migrate` - run Prisma migrate dev
- `npm run prisma:deploy` - run Prisma migrate deploy
- `npm run db:seed` - execute seed script

## Environment Variables

### Required

- `DATABASE_URL` - Prisma datasource URL
- `JWT_SECRET` - signing key for auth JWT and storage OAuth state
- `FRONTEND_URL` - frontend origin used for links/CORS

### Network / API Security

- `ALLOWED_ORIGINS` - comma-separated trusted origins (recommended in production)
- `ADMIN_SETTINGS_CACHE_TTL_MS` - cache TTL for admin settings reads (default `30000`)

### Auth / Bootstrap

- `ADMIN_BOOTSTRAP_KEY` - required for `/api/auth/promote-admin`

### Mail (optional)

If `SMTP_HOST` is not configured, mail is logged to server console (dev behavior).

Primary keys:

- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`

Supported aliases:

- `APPSETTING_SMTP_*`, `AZURE_SMTP_*`, `MAIL_*`

### Google Drive (optional)

- `GOOGLE_DRIVE_MODE` - `oauth` or `service_account`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (OAuth mode)
- `GOOGLE_APPLICATION_CREDENTIALS` (Service Account mode)
- `GOOGLE_DRIVE_FOLDER_ID` (optional shared folder target)
- `GOOGLE_DRIVE_PUBLIC_FILES=true|false` (whether uploaded files are made public)

## API Routing

All endpoints are under `/api`.

Primary route groups:

- `/api/auth`
- `/api/public`
- `/api/courses`
- `/api/quizzes`
- `/api/tasks`
- `/api/grade-computation`
- `/api/terms`
- `/api/admin`
- `/api/storage`
- `/api/notifications`

See detailed endpoint documentation in [docs/API.md](./docs/API.md).

## Security Model

- JWT auth via secure httpOnly cookie (`nemsuee_auth`) or Bearer token
- Role-based route guards in middleware
- Request rate limiting by endpoint group
- Origin/CORS controls + unsafe-method CSRF origin check
- Optional API access gate:
  - allow trusted website origin requests, or
  - require valid admin-managed API key

More details: [docs/SECURITY.md](./docs/SECURITY.md)

## Database Notes

- Current datasource: SQLite
- Service bootstraps compatibility tables/columns in startup/runtime guard code
- For production scale, migrate to managed SQL and formal migration flow

## Deployment Notes

### Azure App Service

Set app settings for at least:

- `NODE_ENV=production`
- `PORT`
- `DATABASE_URL`
- `JWT_SECRET`
- `FRONTEND_URL`
- `ALLOWED_ORIGINS`

If using Google OAuth:

- Ensure `GOOGLE_REDIRECT_URI` points to:
  - `https://<your-api-domain>/api/storage/google/callback`

If using App Service env keys, `APPSETTING_*` SMTP aliases are supported.

## Troubleshooting

### `Cannot POST /api/...` in production

Usually means older backend build is deployed or wrong service/domain is behind the URL.

### `Forbidden: request must originate...`

API gate is enabled and request has neither trusted origin nor valid API key.

### `JWT_SECRET is not configured`

Set `JWT_SECRET` for the running environment; required for auth and OAuth state signing.

---

If you need diagrams or contributor-facing architecture docs, start with [docs/API.md](./docs/API.md) and [docs/SECURITY.md](./docs/SECURITY.md).
