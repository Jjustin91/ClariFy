# Real-Time Synchronization & PostgreSQL Persistence Plan

## 1. Root Cause Analysis
When running ClariFy locally, creating announcements or interacting with channels did not save to your local PostgreSQL database for three reasons:
1. **Hardcoded In-Memory Route Handler:** `/clarify-web/app/api/v1/[...slug]/route.ts` called the in-memory `handleClarifyApiRequest` store directly instead of forwarding requests to your Laravel backend (`LARAVEL_BACKEND_URL`) or executing SQL queries against your local PostgreSQL instance (`DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD`, or `DATABASE_URL`).
2. **Messenger Chat Storage:** `CourseHubChatView.tsx` stored messages only in browser `localStorage` rather than persisting them through `/api/v1/channels/{channelId}/chat` into PostgreSQL.
3. **No Live Push Channel:** Clients only fetched data on initial load or manual button clicks rather than subscribing to real-time server events when another session (Faculty, Student, or IT Admin) mutated data.

---

## 2. Dual PostgreSQL Persistence Architecture

### A. Direct PostgreSQL Adapter in Next.js (`/clarify-web/src/server/postgres-adapter.ts`)
- Install `pg` (`@types/pg`) in `clarify-web`.
- Automatically detect PostgreSQL configuration from environment variables (`DATABASE_URL` or `DB_HOST` / `DB_PORT` / `DB_DATABASE` / `DB_USERNAME` / `DB_PASSWORD`, defaulting to `127.0.0.1:5432`, database `clarify_db`, user `postgres` when running locally).
- **Auto-Schema & Seed Bootstrap:** On first connection, ensure the core tables (`users`, `academic_profiles`, `channels`, `channel_user`, `announcements`, `announcement_reads`, `announcement_audits`, `messages`, `prisms_sync_logs`, `device_tokens`) exist and seed the default CCS channels and accounts (`10492` Faculty, `2020202020` Student, `90001` IT Admin) if the tables are empty.
- **Direct SQL Execution:** Persist and query all Announcements (create, edit, delete, urgent toggle, read receipts, audit history), Scoped Channels (create, archive, roster enrollment), Isolated Q&A Threads (create, status update, replies, FAQ promotion), Messenger Course Chat messages & reactions, and Admin operations (user directory CRUD, PRISMS CSV sync, broadcast alerts) directly in PostgreSQL.

### B. Laravel Backend Proxy Support (`/clarify-web/app/api/v1/[...slug]/route.ts` & `/clarify-api`)
- When `LARAVEL_BACKEND_URL` (e.g., `http://127.0.0.1:8000`) is configured and reachable, proxy `/api/v1/*` requests directly to the Laravel 13 API server.
- Add a seamless token/session bridge and `ChannelChatController` in `/clarify-api` so both Sanctum tokens and role sessions (`10492`, `2020202020`, `90001`) authenticate cleanly against Laravel + PostgreSQL.
- **Automatic Fallback Chain:**
  1. **Laravel API (`LARAVEL_BACKEND_URL`)** if reachable
  2. **Direct PostgreSQL (`pg` connection pool)** if local PostgreSQL is reachable
  3. **In-Memory Fallback Engine** (for cloud preview environments without a local PostgreSQL server)
- Expose the active persistence driver (`postgresql-direct`, `laravel-postgresql`, or `memory-fallback`) in the header API status modal so you can immediately verify your local PostgreSQL connection status.

---

## 3. Real-Time Synchronization Across All Sessions

### A. Server-Sent Events (SSE) & Real-Time Event Bus
- **`/clarify-web/src/server/realtime-bus.ts`:** Central event emitter that broadcasts domain events whenever any mutation occurs (`announcement.created`, `announcement.updated`, `announcement.deleted`, `announcement.read`, `chat.message`, `chat.reaction`, `thread.created`, `thread.updated`, `thread.replied`, `channel.updated`, `admin.updated`).
- **`/clarify-web/app/api/v1/realtime/stream/route.ts`:** Streaming SSE endpoint that pushes live mutation events to all connected Student, Faculty, and Admin tabs/browsers in real time, paired with a lightweight database change-detection poll so external database or Laravel mutations also trigger instant UI updates.

### B. Full Feature Real-Time Sync
- **Announcements:** When Faculty posts, edits, deletes, or marks an announcement urgent—or when a Student acknowledges/reads it—all connected Student, Faculty, and Admin views update immediately without refreshing.
- **Messenger Chat (`CourseHubChatView.tsx`):** Move chat messages and reactions to `/api/v1/channels/{channelId}/chat` backed by PostgreSQL (`messages` table with `is_thread_root = false` and chat metadata) and stream new messages/reactions live across all channel members.
- **Isolated Q&A Threads:** New student inquiries, faculty replies, status changes (`open`, `in_progress`, `resolved`), and FAQ promotions sync live between Student and Faculty sessions.
- **Admin & Channel Actions:** Adding/archiving channels, managing roster members, creating/removing users, running PRISMS sync, and sending system broadcasts sync immediately across all active sessions.
