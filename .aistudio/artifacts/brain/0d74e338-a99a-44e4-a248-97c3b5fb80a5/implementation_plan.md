# ClariFy — Production Cloud Connectivity Plan (Vercel + Render + Supabase)

Resolve the `503 (Service Unavailable)` error on `clarify-web` when deployed on Vercel by supporting both the **Render Laravel API proxy (`NEXT_PUBLIC_API_URL` / `LARAVEL_BACKEND_URL`)** and **direct Supabase PostgreSQL connections (`DATABASE_URL` / `POSTGRES_URL`)** with proper SSL certificate handling, URL normalization, and cold-start timeouts.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> The choices below incorporate your confirmed Vercel, Render, and Supabase setup.

- **Confirmed Decision 1 (Environment Variable Discovery)**: Support `NEXT_PUBLIC_API_URL` (as well as `LARAVEL_BACKEND_URL`, `NEXT_PUBLIC_BACKEND_URL`, and `BACKEND_URL`) for the Render backend URL, and support `DATABASE_URL`, `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING`, and `SUPABASE_DB_URL` for Supabase PostgreSQL.
- **Confirmed Decision 2 (Dual-Path Cloud Resilience)**: Support both direct Supabase PostgreSQL execution with TLS/SSL (`rejectUnauthorized: false`) and Render backend proxying with normalized `/api/v1` paths and extended cold-start timeouts.

---

## 1. Overview & Core Concept

- **What It Does**: Eliminates the `503 Service Unavailable` failure during account registration, login, and workspace operations when `clarify-web` runs on Vercel alongside Render (`clarify-api`) and Supabase PostgreSQL.
- **Target Audience / Persona**: Students, Faculty, Department Heads, and IT Administrators accessing the live Vercel deployment.
- **Key Value**: Guarantees that authentication and database mutations succeed whether handled directly by Vercel's PostgreSQL adapter against Supabase or proxied to the Render Laravel service—even during Render container cold starts or when Supabase connection strings include `sslmode=require`.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Seamless Login & Account Registration**: Submitting credentials or registering a new account on the live Vercel URL (`https://...vercel.app/login`) connects immediately to Supabase PostgreSQL or the Render backend without throwing a 503 error.
  2. **Cold-Start Tolerance**: If Render or Supabase takes several seconds to wake from idle, the request waits gracefully (up to 25s for Render proxy, 10s for Supabase TLS handshake) instead of aborting after 2–3.5 seconds.
  3. **Clear Diagnostics on Misconfiguration**: If both cloud endpoints are unreachable, the error banner reports both the Supabase connection status and the Render proxy status so any missing credential can be identified at a glance.
- **Visual Identity & Theme**:
  - Preserves the existing USTP institutional identity (`#1a1851` Navy, `#fcb315` Gold, `#e89c31` Orange, `#FFFAF2` Cream, `#031c2e` Dark Text).

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Supabase TLS/SSL Certificate & Query Parameter Sanitization**
  - *Chosen Approach*: Automatically enable `ssl: { rejectUnauthorized: false }` for all non-local PostgreSQL connections (`DATABASE_URL`, `POSTGRES_URL`, or remote `DB_HOST`) and strip conflicting `?sslmode=require` / `sslmode=verify-full` parameters from the connection URL before passing it to Node's `pg` Pool.
  - *Why*: By default, Node's `pg-connection-string` parser overrides `ssl: { rejectUnauthorized: false }` whenever `?sslmode=require` is present in a Supabase URL, causing `Error: self-signed certificate in certificate chain` on Vercel serverless functions.
- **Decision 2: Render Proxy URL Normalization & Extended Timeout**
  - *Chosen Approach*: Read `NEXT_PUBLIC_API_URL` (in addition to `LARAVEL_BACKEND_URL`), strip any trailing `/api/v1` or `/api` suffix before constructing `/api/v1/...` target URLs so paths are never doubled (`/api/v1/api/v1/...`), and extend the proxy timeout from 3.5 seconds to 25 seconds.
  - *Why*: Users frequently set `NEXT_PUBLIC_API_URL` to either `https://<service>.onrender.com` or `https://<service>.onrender.com/api/v1`, and Render free/starter instances require more than 3.5 seconds on initial wake-up.
- **Decision 3: Non-Blocking Schema Verification for PgBouncer / Supabase Poolers**
  - *Chosen Approach*: Wrap table initialization and sequence alignment statements in fault-tolerant blocks and configure serverless-friendly pool limits (`max: 5`, `idleTimeoutMillis: 10000`, `connectionTimeoutMillis: 10000`).
  - *Why*: Prevents Supabase transaction poolers (port `6543`) or pre-existing Laravel migration schemas from rejecting connection pool initialization.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Request Routing Diagram

```
┌───────────────────────────────────────────────────────────────────────────┐
│                   Browser Client (Vercel Web Portal)                      │
│         Calls same-origin /api/v1/* (or fallback Render endpoint)         │
└─────────────────────────────────────┬─────────────────────────────────────┘
                                      │
                                      ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                  Next.js API Gateway (/api/v1/[...slug])                  │
│   ┌───────────────────────────────────────────────────────────────────┐   │
│   │ Path 1: Direct Supabase PostgreSQL Adapter                        │   │
│   │ • Reads DATABASE_URL / POSTGRES_URL / POSTGRES_PRISMA_URL / DB_*  │   │
│   │ • Strips conflicting ?sslmode= params & sets rejectUnauthorized   │   │
│   │ • 10s connection timeout + serverless pool sizing (max: 5)        │   │
│   └─────────────────────────────────┬─────────────────────────────────┘   │
│                                     │ (If DB env not set or unreachable)  │
│                                     ▼                                     │
│   ┌───────────────────────────────────────────────────────────────────┐   │
│   │ Path 2: Render Laravel 13 Proxy                                   │   │
│   │ • Reads NEXT_PUBLIC_API_URL / LARAVEL_BACKEND_URL / BACKEND_URL   │   │
│   │ • Normalizes base URL (removes duplicate /api/v1 or /api suffix)  │   │
│   │ • 25s timeout to accommodate Render container cold starts         │   │
│   └───────────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────────────┘
```

### Interactive Component & State Mapping

1. **Supabase Connection Resolution**:
   - Inspects `DATABASE_URL`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_PRISMA_URL`, `SUPABASE_DB_URL`, and `DB_HOST` / `DB_PORT` / `DB_DATABASE` / `DB_USERNAME` / `DB_PASSWORD`.
   - Sanitizes `sslmode` query parameters in connection strings and attaches `ssl: { rejectUnauthorized: false }` whenever connecting to Supabase or any remote host.
   - Reduces retry lockouts so transient serverless cold-start hiccups do not block subsequent requests.
2. **Render Proxy Resolution**:
   - Inspects `LARAVEL_BACKEND_URL`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_LARAVEL_URL`, `NEXT_PUBLIC_BACKEND_URL`, and `BACKEND_URL`.
   - Normalizes the base URL so `https://service.onrender.com`, `https://service.onrender.com/api`, and `https://service.onrender.com/api/v1` all resolve cleanly to `https://service.onrender.com/api/v1/<endpoint>`.
   - Forwards `Authorization`, `X-Clarify-Institutional-Id`, and `X-Clarify-User-Id` headers with a 25-second timeout and returns structured Laravel validation/auth responses (`200`, `201`, `401`, `403`, `422`) directly to the client.
