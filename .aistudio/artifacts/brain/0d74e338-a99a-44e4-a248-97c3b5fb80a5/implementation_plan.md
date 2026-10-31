# Remove Next.js Mocks, Fix Database Persistence Across All Features & Add Run Guide

## Overview
We will remove all Next.js mock files and fallbacks, remove the top header API Mode toggle button, fix database persistence so every create/update/delete operation across Announcements, Channels, Q&A Threads, Messenger Chat, Profile Settings, and IT Admin Console writes directly to your PostgreSQL database (via either Next.js direct PostgreSQL or the Laravel 13 API), and provide a step-by-step Markdown guide on how to configure and run the application locally.

---

## Root Cause Analysis (Why Data Was Not Reaching PostgreSQL)
1. **Stale `localStorage` Mock Mode Flag (`clarify_use_mock_api`):**
   - `api-client.ts` checked `localStorage.getItem('clarify_use_mock_api')`. Whenever this flag was `'true'` in the browser, all API client functions mutated in-memory JavaScript arrays instead of sending HTTP requests to `/api/v1/*`.
2. **Silent Fallback to In-Memory Mock Engine (`clarify-api-engine.ts`):**
   - In `/clarify-web/app/api/v1/[...slug]/route.ts`, if `handlePostgresApiRequest` returned `null` (for instance, due to an `.env` credential mismatch or seed conflict), Next.js silently fell back to `handleClarifyApiRequest` (RAM store) instead of surfacing the database connection error or executing against the real database.
3. **Database Schema & User/Channel ID Resolution Between Laravel Migrations and Direct PostgreSQL:**
   - When `php artisan migrate --seed` was run in `clarify-api`, primary keys for Faculty (`Aki Hayakawa`, `id=2`), IT Admin (`Engr. Makima Cruz`, `id=3`), and `# IT314 SoftEng` (`id=1`) differed from hardcoded mock IDs (`10492`, `90001`, `7`).
   - Token resolution and default channel selection must dynamically resolve the authenticated user by `institutional_id` / Sanctum token and resolve valid database `channel_id` records so foreign key constraints (`publisher_id`, `channel_id`, `sender_id`) always succeed in PostgreSQL.

---

## Planned Changes

### 1. Remove Header API Mode Button (`focus-mode` Target)
- **`/clarify-web/src/components/layout/AppShell.tsx`**:
  - Remove the `<button>` (`div:nth-of-type(2) > header:nth-of-type(1) > div:nth-of-type(2) > button:nth-of-type(1)`) that toggles `useMock` / displays the API badge in the top-right header bar, leaving only the `USTP` badge in the top-right header.

### 2. Delete Next.js Mock Files & Strip All Mock Fallbacks
- **Delete `/clarify-web/src/mocks/seed-data.ts`** and **`/clarify-web/src/server/clarify-api-engine.ts`**.
- **`/clarify-web/src/lib/api-client.ts`**:
  - Remove all mock arrays, `USE_MOCK_API`, `getUseMockApi`, `setUseMockApi`, and in-memory mock branches.
  - Clear any legacy `clarify_use_mock_api` entry from `localStorage` automatically.
  - Route 100% of API calls (`loginApi`, `logoutApi`, `getMeApi`, `updateProfileApi`, `getChannelsApi`, `createChannelApi`, `joinChannelApi`, `manageChannelMemberApi`, `getAnnouncementsApi`, `createAnnouncementApi`, `updateAnnouncementApi`, `deleteAnnouncementApi`, `acknowledgeAnnouncementApi`, `getChannelThreadsApi`, `createThreadApi`, `updateThreadApi`, `deleteThreadApi`, `replyToThreadApi`, `convertThreadToFaqApi`, `getChannelChatMessagesApi`, `sendChannelChatMessageApi`, `getInstructorsApi`, `getPendingUsersApi`, `verifyUserAccountApi`, `getAllUsersApi`, `updateUserRoleApi`, `triggerPrismsSyncApi`, `getAdminMetricsApi`) strictly through `/api/v1/*`.
- **`/clarify-web/src/context/ClarifyContext.tsx`** & **`/clarify-web/src/components/threads/MessengerChatBox.tsx`**:
  - Remove `useMock`, `toggleApiMode`, and hardcoded `INITIAL_CHANNEL_CHAT_MESSAGES`.
  - Load user session, channels, announcements, Q&A threads, and chat messages strictly from the backend database.

### 3. Fix PostgreSQL & Laravel Persistence Across All Workflows
- **`/clarify-web/src/server/postgres-adapter.ts`**:
  - Remove dependency on `src/mocks/seed-data.ts` and remove automatic mock data seeding on connection; ensure schema creation (`CREATE TABLE IF NOT EXISTS` matching the exact Laravel migrations) is clean and non-destructive.
  - Dynamically resolve authenticated users from `Bearer` tokens by querying `users` by `institutional_id` or Laravel Sanctum `personal_access_tokens`, ensuring Faculty (`10492`), Student (`2020202020`), and IT Admin (`90001`) always map to their real PostgreSQL `users.id`.
  - Ensure `POST /announcements`, `PATCH /announcements/:id`, `DELETE /announcements/:id`, `POST /announcements/:id/acknowledge`, `POST /channels`, `POST /channels/:id/join`, `POST /channels/:id/members`, `POST /channels/:id/threads`, `PATCH /threads/:id`, `DELETE /threads/:id`, `POST /threads/:id/replies`, `POST /threads/:id/convert-faq`, `POST /channels/:id/chat`, `PATCH /profile`, and all `/admin/*` endpoints execute real SQL `INSERT`/`UPDATE`/`DELETE` statements and return clear error messages if the database connection is down.
- **`/clarify-web/app/api/v1/[...slug]/route.ts`** & **`/clarify-web/app/api/announcements/create/route.ts`**:
  - Remove the in-memory `handleClarifyApiRequest` fallback.
  - Support both **Laravel API proxy** (`LARAVEL_BACKEND_URL`) and **Direct PostgreSQL connection** (`postgres-adapter.ts`), returning an explicit `503 Database Connection Error` with diagnostic details if neither PostgreSQL nor the Laravel server is reachable.

### 4. Add Step-by-Step Setup & Run Instructions (`HOW_TO_RUN.md` & `README.md`)
- Create **`/HOW_TO_RUN.md`** (and update `/clarify-web/README.md`) covering:
  - Prerequisites (PostgreSQL, Node.js, PHP 8.2+ & Composer if running Laravel).
  - Configuring `.env` in both `/clarify-api/.env` and `/clarify-web/.env.local` (`DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD`, `LARAVEL_BACKEND_URL`).
  - Running database migrations and initial registrar seed (`php artisan migrate --seed`).
  - Starting the app in **Option A: Full Stack (Laravel API + Next.js + PostgreSQL)** or **Option B: Next.js Direct PostgreSQL Mode**.
  - Verifying real-time persistence in pgAdmin / `psql` across Student, Faculty, and IT Admin logins.
