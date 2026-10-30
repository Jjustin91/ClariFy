# Implementation Plan: Isolate User Role Domains & Remove Header Role Switcher

## 1. Remove Top Header Role Switcher (`AppShell.tsx`)
- **Remove Selected Header Element (`CSS selector 1`)**: Remove the `Demo Role Switcher` pill group (`Student View (Kobeni)`, `Faculty View (Aki)`, `IT Admin View`) from the top navigation header in `/clarify-web/src/components/layout/AppShell.tsx`.
- **Retain Header Controls**: Keep the left `ClariFy | {title}` branding, the green `API: Connected (/api/v1)` status toggle button, and the `USTP` badge in the top-right header.

## 2. Isolate Student, Faculty, and IT Admin User Domains via `/login` (`app/login/page.tsx`, `ClarifyContext.tsx`, `api-client.ts`)
- **Role-Based Session Isolation**:
  - Users authenticate into their dedicated role domain on `/login` (`2020202020` for Student Kobeni Higashiyama, `10492` for Faculty Aki Hayakawa, `90001` for IT Admin Engr. Makima Cruz).
  - Update `loginApi` in `/clarify-web/src/lib/api-client.ts` and `setUser` in `/clarify-web/src/context/ClarifyContext.tsx` so logging in via `/login` (in both Connected `/api/v1` and Mock modes) persists the authenticated user profile and active role token in storage, refreshes scoped channels and announcements, and routes the user into their role-specific workspace:
    - **Student Domain (`student`)**: Scoped Dashboard feed, Announcements, Faculty Directory, and Course Hub (`Messenger Chat`, `Noticeboard Feed`, `Isolated Q&A Threads`, `+ Ask in Q&A Thread`, `Add Channel +`, `Roster`).
    - **Faculty Domain (`faculty`)**: Scoped Dashboard with `+ New Post` announcement publishing, Announcements management, Faculty Directory (with consultation status editor), and Course Hub (`Messenger Chat`, `Noticeboard Feed`, `Isolated Q&A Threads` with `Official Faculty Answer` & `Pin to FAQ`, `+ Create Announcement`, `Add Channel +`, `Roster`).
    - **IT Admin Domain (`it_admin`)**: Full campus scope plus dedicated `Admin Console +` navigation link and `/admin` portal (Registrar Verification Queue, RBAC Manager, PRISMS Sync, System Telemetry), while redirecting IT Admin logins directly to `/admin` (or Dashboard) and guarding `/admin` so non-admin roles see a clean domain restriction notice with a link to sign in as IT Admin on `/login`.
- **Clean Logout & Role Switching on `/login`**:
  - Clicking `Logout` in the right-hand orange sidebar clears the active session token and redirects to `/login`, where users can sign in to any isolated role domain (`Student`, `Faculty`, or `IT Admin`).

## 3. Verification
- Run domain unit tests (`npx --yes tsx --test clarify-web/src/lib/domain-logic.test.ts`) and `compile_applet`.
- Verify in headless Chromium (`playwright-cli`) that the top header role switcher is removed, the API status button remains visible, and logging in as Student, Faculty, and IT Admin on `/login` isolates each role's domain while retaining all role-specific features.
