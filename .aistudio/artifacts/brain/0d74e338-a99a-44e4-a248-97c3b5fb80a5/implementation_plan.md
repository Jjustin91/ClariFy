# Fix Account Verification PostgreSQL Error & Isolate IT Admin Role

## 1. Fix PostgreSQL Parameter Type Error on Account Verification
- **Root Cause**: In `PATCH /api/v1/admin/users/{id}/verify` (`/clarify-web/src/server/postgres-adapter.ts`), parameter `$1` is used both in `SET verification_status = $1` (`VARCHAR(20)`) and in `CASE WHEN $1 = 'approved'` (inferred as `TEXT`), causing PostgreSQL's prepared statement parser to throw `inconsistent types deduced for parameter $1`.
- **Database Adapter Fix (`/clarify-web/src/server/postgres-adapter.ts`)**:
  - Explicitly cast `$1::varchar` (or pass a precomputed `verifiedAt` timestamp parameter from TypeScript) in the `UPDATE users` statement inside `PATCH /admin/users/{id}/verify`.
  - Audit all other parameterized SQL statements in `postgres-adapter.ts` to ensure no `$n` parameter is reused across `SET` and `CASE`/`WHERE` clauses without explicit type casting.

## 2. Strict IT Admin Domain Isolation (Backend & Domain Logic)
- **Domain Logic (`/clarify-web/src/lib/domain-logic.ts`)**:
  - Update `canPublishOrManageAnnouncements`, `canManageChannels`, and `canResolveOrPinThreads` so they return `true` **only** for `faculty` and `dept_head` (removing `it_admin` from academic/faculty permissions).
- **API Enforcement (`/clarify-web/src/server/postgres-adapter.ts` & `/clarify-api`)**:
  - Restrict Student/Faculty endpoints (publishing/updating/deleting/acknowledging announcements, creating/modifying channels, posting channel chat messages, creating/replying/resolving Q&A threads) so `it_admin` is blocked with `403 Forbidden`, keeping `it_admin` strictly scoped to `/api/v1/admin/*` and `/api/v1/auth/*`.
  - In `ClarifyContext.tsx`, when `user.role === 'it_admin'`, skip fetching Student/Faculty announcements and channels so unnecessary academic queries are not triggered.

## 3. Strict IT Admin UI & Navigation Isolation
- **Login Redirect (`/clarify-web/app/login/page.tsx`)**:
  - Redirect `it_admin` users directly to `/admin` upon sign-in instead of `/`.
- **Right-Hand Profile Drawer & Header (`/clarify-web/src/components/layout/AppShell.tsx`)**:
  - When `user.role === 'it_admin'`, display **only** the `Admin Console` navigation item (plus `Settings` and `Logout` at the bottom), removing `Dashboard`, `All Announcements`, `View Faculty`, and `View Messages`.
  - Point the top-left `ClariFy` header brand link to `/admin` when logged in as `it_admin`.
  - Do not mount the Faculty `AnnouncementFormModal` or `ChannelRosterModal` for `it_admin`.
- **Route Guards on Student/Faculty Pages**:
  - In `/clarify-web/app/page.tsx`, `/clarify-web/app/announcements/page.tsx`, `/clarify-web/app/instructors/page.tsx`, and `/clarify-web/app/channels/[channelId]/page.tsx`, automatically redirect `user.role === 'it_admin'` to `/admin` so the IT Admin only interacts with the IT Admin Console.
