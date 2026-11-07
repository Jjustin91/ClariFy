# Hostinger Migration Cleanup, Login Hardening & Error Resolution Plan

This plan removes legacy Render and Vercel deployment files, updates the backend CORS configuration for the `ustpclarify.tech` Hostinger domain, removes the pre-filled/seeded IT Administrator credentials from the authentication screens, and resolves runtime errors between the Hostinger Web frontend and Hostinger VPS backend.

## User Review & Critical Decisions

> [!IMPORTANT]
> Confirmed configuration and scope based on your answers:

- **Confirmed Decision 1 (Hostinger CORS Domain)**: Replace all `vercel.app` origins and regex patterns in the backend CORS configuration with `https://ustpclarify.tech`, `https://www.ustpclarify.tech`, and `*.ustpclarify.tech`.
- **Confirmed Decision 2 (Legacy Deployment Files)**: Delete `render-start.sh`, `Dockerfile`, and `.dockerignore` from the Laravel API directory since deployment now runs directly on the Hostinger VPS via GitHub Actions SSH.
- **Confirmed Decision 3 (Login Screen Hardening)**: Remove the pre-filled `90001` / `ustp2026` default input values and remove the "Seeded System Administrator Account" quick-login card from the Sign In page.

---

## 1. Overview & Core Concept

- **What It Does**: Cleans up all legacy cloud-platform artifacts (Render and Vercel), secures the institutional login experience so no credentials are exposed in the UI, and eliminates frontend-to-VPS connection/polling errors in production.
- **Target Audience / Persona**: USTP-CDO students, faculty members, department heads, and ICTO system administrators accessing ClariFy at `https://ustpclarify.tech`.
- **Key Value**: Ensures a production-ready, error-free deployment across Hostinger Web (Next.js frontend) and Hostinger VPS (Laravel 13 API) with clean authentication UX.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Institutional Sign In (`/login`)**: Users arrive at a clean split-screen USTP portal with blank Institutional ID and Password fields. The left branding card displays the ClariFy emblem, USTP-CDO institutional header, and a direct "Student or Faculty Member? Sign Up" call-to-action without any exposed admin credentials.
  2. **Account Registration (`/register`)**: New students and faculty register their accounts and see clear 3-step verification instructions referencing IT Administrator approval without exposing internal administrator IDs.
  3. **Scoped Noticeboard & Course Hubs (`/`, `/announcements`, `/channels/[channelId]`)**: Seamless communication with `https://api.ustpclarify.tech/api/v1` without CORS blocks, `undefined` persistence status crashes, or failing background stream polls.
- **Visual Identity & Theme**:
  - Preserves the official USTP brand system (`#1a1851` Navy structural chrome, `#fcb315` Gold highlights, `#ff9718` Orange authentication/drawer panel, `#FFFAF2` Cream workspace canvas, and `#031c2e` high-contrast typography in `Plus Jakarta Sans`).
  - Uses crisp 1px structural borders and tabular numerals (`tabular-nums`) for all IDs, counters, and metrics.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Removing Seeded Admin UI Exposure While Preserving Backend Auth**
  - *Chosen Approach*: Initialize the login inputs to empty strings (`""`), remove the `fillDemoAccount` helper and quick-login card from the Login page, and generalize the verification note on the Register page.
  - *Why*: Exposing administrator credentials on a public production domain (`ustpclarify.tech`) is a security risk; administrators can still sign in normally by typing their credentials.
- **Decision 2: Hostinger CORS & Custom Header Support**
  - *Chosen Approach*: Configure `allowed_origins` and `allowed_origins_patterns` to explicitly trust `https://ustpclarify.tech` and `https://*.ustpclarify.tech` while keeping `localhost:3000` for local development.
  - *Why*: Prevents browser preflight (`OPTIONS`) and cross-origin `fetch` failures when the frontend on Hostinger Web calls `https://api.ustpclarify.tech/api/v1`.
- **Decision 3: Eliminating Unnecessary Local DB Polling & Fixing `/persistence/status` Payload**
  - *Chosen Approach*: Align the `/api/v1/persistence/status` JSON structure in the Laravel backend with the `{ data: { connected, revision, ... } }` contract expected by the frontend context, and disable local `/api/v1/realtime/stream` EventSource/polling when `API_BASE_URL` points to the remote Hostinger VPS API.
  - *Why*: Prevents `TypeError: Cannot read properties of undefined (reading 'revision')` in `ClarifyContext` and stops the Next.js frontend server from repeatedly attempting local PostgreSQL connections when all data lives on the Hostinger VPS.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

```
┌──────────────────────────────────────────────────────────────────────────┐
│                 Hostinger Web Frontend (ustpclarify.tech)                │
│                                                                          │
│  ┌─────────────────────────┐       ┌──────────────────────────────────┐  │
│  │  /login & /register     │       │  ClarifyContext & API Client     │  │
│  │  • Blank initial inputs │       │  • Safe persistenceStatus guard  │  │
│  │  • No seeded admin card │       │  • Remote API detection (no SSE  │  │
│  │  • Clean USTP branding  │       │    spam on local Next.js route)  │  │
│  └───────────┬─────────────┘       └────────────────┬─────────────────┘  │
└──────────────┼──────────────────────────────────────┼────────────────────┘
               │ HTTPS (CORS: *.ustpclarify.tech)     │
               ▼                                      ▼
┌──────────────────────────────────────────────────────────────────────────┐
│              Hostinger VPS Backend (api.ustpclarify.tech)                │
│                                                                          │
│  ┌─────────────────────────┐       ┌──────────────────────────────────┐  │
│  │  CORS Middleware        │       │  REST API v1 (/api/v1/*)         │  │
│  │  • ustpclarify.tech     │──────▶│  • Standardized /persistence     │  │
│  │  • No Vercel/Render cfg │       │  • Channel & Feed Cache Sync     │  │
│  └─────────────────────────┘       └──────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Interactive Component & State Mapping**:
  - **Deployment Artifacts Cleanup**: Remove `clarify-api/render-start.sh`, `clarify-api/Dockerfile`, and `clarify-api/.dockerignore`.
  - **Backend CORS Configuration**: Update `clarify-api/config/cors.php` default `FRONTEND_URL` fallback to `https://ustpclarify.tech`, include `https://www.ustpclarify.tech`, and replace the `*.vercel.app` regex pattern with `#^https?://([a-z0-9-]+\.)?ustpclarify\.tech(:\d+)?$#`.
  - **Authentication Screens**: Update `LoginPage` to start with empty `institutionalId` and `password` states, remove the seeded IT Admin button block, and update `RegisterPage` instructions so no admin ID is displayed.
  - **Runtime & API Error Fixes**:
    1. Standardize `GET /api/v1/persistence/status` in `clarify-api/routes/api.php` to return `{ data: { driver, database, host, connected, revision } }` and add null-safe optional chaining (`res?.data?.revision`) in `ClarifyContext`.
    2. Guard `/api/v1/realtime/stream` SSE and 2-second polling in `ClarifyContext` so it only runs when using the local Next.js API route, preventing failed requests and console errors on Hostinger Web.
    3. Update Next.js API route proxy fallback (`LARAVEL_BACKEND_URL`) to default to `https://api.ustpclarify.tech` if invoked without a local PostgreSQL instance.
