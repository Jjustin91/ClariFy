# ClariFy — Laravel Reverb Real-Time Broadcasting, Multi-User Session Isolation & Login-First Auth Guard

This update integrates **Laravel Reverb** WebSocket broadcasting and **Laravel Echo** across ClariFy for instant real-time updates (Live Channel Chat & Messaging, Urgent Announcement Popups, Discussion Threads & Q&A, and Live Acknowledgment Counters), replaces shared browser storage with **per-tab session isolation** so multiple accounts can run simultaneously in side-by-side tabs, enforces a **login-first route guard** starting at `/login`, and updates the project run guide.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural choices were confirmed during Phase 1 clarification and govern this implementation:

- **Confirmed Decision 1 — Per-Tab Multi-User Session Isolation (`sessionStorage`)**: Each browser tab maintains its own isolated authentication token and user profile in `window.sessionStorage` instead of shared `window.localStorage` or a hardcoded fallback user. Users can sign in as IT Admin in Tab 1, Faculty in Tab 2, and multiple Students in Tabs 3+ simultaneously without overwriting each other's active sessions.
- **Confirmed Decision 2 — Login-First Default Route (`/login`)**: Opening the app without an active authenticated session in the current tab no longer auto-authenticates as the IT Administrator (`90001`). Unauthenticated visits to `/` or any protected route immediately redirect to `/login` (while allowing `/login` and `/register`).
- **Confirmed Decision 3 — Full Laravel Reverb WebSockets + Automatic Local Stream Fallback**: The backend configures **Laravel Reverb** (`laravel/reverb`, broadcasting channels, and `ShouldBroadcastNow` events) while the frontend connects via **Laravel Echo + `pusher-js`** and automatically pairs with the built-in Server-Sent Events (SSE) stream and `BroadcastChannel` bridge so real-time events work seamlessly in both Full-Stack Laravel Reverb mode and Next.js Direct PostgreSQL mode.

---

## 1. Overview & Core Concept

- **What It Does**:
  1. **Real-Time Event Broadcasting with Laravel Reverb**: Broadcasts instant WebSocket events across all connected clients for:
     - **Live Channel Chat & Direct Messaging**: Instant delivery of Course Hub chat messages, file attachments, reactions, pins, and direct messages.
     - **Urgent Announcement Popups**: Real-time delivery of newly published or moderator-approved urgent announcements, immediately triggering the Urgent Safety Popup modal on targeted Student and Faculty screens.
     - **Discussion Threads & Q&A**: Live synchronization of new student inquiry threads, faculty replies, resolved status badges, and Class FAQ conversions.
     - **Live Acknowledgment Counters**: Real-time progress bar and counter updates whenever a student clicks **"I Understand & Acknowledge"** on an announcement.
  2. **Concurrent Multi-User Sessions**: Eliminates the single-session bottleneck so students, faculty, moderators, and the IT Administrator can sign up, get approved, log in, and interact simultaneously from different browser tabs on the same machine.
  3. **Strict Login-First Entry**: Starts every new browser tab at `/login` unless that specific tab already holds a valid authenticated session.
  4. **Updated `HOW_TO_RUN.md`**: Documents step-by-step instructions for starting the Laravel Reverb server (`php artisan reverb:start`), configuring Reverb `.env` variables, and testing multi-tab real-time interactions.
- **Target Audience / Persona**: USTP Students, Faculty Instructors, Departmental Moderators, and IT Administrators testing or operating ClariFy concurrently across multiple tabs and devices.
- **Key Value**: True multi-user concurrency and zero-refresh real-time responsiveness for campus-critical announcements, acknowledgments, Q&A threads, and course chat.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Initial Visit & Login Redirect**:
     - Opening `http://localhost:3000/` in a fresh browser tab checks the tab's `sessionStorage` token. With no active session, the route guard cleanly redirects to `/login`.
     - From `/login`, a user can sign in with their approved credentials, use the quick-fill IT Admin demo button (`90001`), or navigate to `/register` to create a new Student or Faculty account.
  2. **Concurrent Multi-Tab Workflow**:
     - **Tab 1 (IT Admin)**: Sign in as `90001` &rarr; redirected to `/admin` &rarr; approve newly registered Faculty and Student accounts in real time.
     - **Tab 2 (Faculty)**: Sign in as the newly approved Faculty account &rarr; create a Course Hub channel, post an **Urgent Announcement**, or reply to a Student Q&A thread.
     - **Tab 3 (Student)**: Sign in as the newly approved Student account &rarr; immediately see the **Urgent Announcement Popup** appear without refreshing, click **"I Understand & Acknowledge"** (updating Tab 2's **Live Acknowledgment Counter** in real time), and exchange live messages in the Course Hub chat and Q&A discussion threads.
- **Visual Identity & Theme**:
  - Preserves ClariFy's established **USTP Institutional Academic Identity** (`#1a194d` Navy Primary, `#f7b71d` Gold Accent, `#fdfdff` Crisp Surface, Plus Jakarta Sans display typography, and JetBrains Mono for course codes and institutional IDs).
  - Clean authentication loading transition while verifying tab session state so protected pages never flash unauthenticated content before redirecting to `/login`.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Tab-Scoped `sessionStorage` with Multi-Token Support**
  - *Chosen Approach*: Store `clarify_active_user`, `clarify_bearer_token`, and `clarify_active_role` in `window.sessionStorage` (with no fallback to a default IT Admin user), and pass the authenticated user's exact `X-Clarify-User-Id`, `X-Clarify-Institutional-Id`, and `Authorization: Bearer` headers on every API request.
  - *Why*: `window.localStorage` is shared across all tabs of the same origin, causing a login in Tab 2 to overwrite Tab 1's active user. `sessionStorage` is natively isolated per browser tab, enabling unlimited concurrent user sessions in a single browser window.
  - *Alternatives Considered*: Separate browser profiles or Incognito windows only—passed over because developers and evaluators frequently open multiple tabs in the same browser window to test multi-role interactions.

- **Decision 2: Dual-Transport Real-Time Engine (Laravel Reverb WebSockets + SSE/BroadcastChannel Fallback)**
  - *Chosen Approach*: Configure `laravel/reverb` on the Laravel backend (`ShouldBroadcastNow` events over `clarify.global`, `clarify.channel.{id}`, and `clarify.user.{id}`) and connect the Next.js frontend using `laravel-echo` and `pusher-js`, while keeping the SSE stream (`/api/v1/realtime/stream`) and cross-tab `BroadcastChannel('clarify_realtime_sync')` active in parallel.
  - *Why*: When running the full Laravel stack (`php artisan serve` + `php artisan reverb:start`), WebSocket frames push directly from Reverb to Laravel Echo. When running in Next.js direct PostgreSQL mode (`npm run dev`), the SSE stream and `BroadcastChannel` deliver identical real-time responsiveness without requiring a separate WebSocket daemon.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Component Diagram

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│                    BROWSER WINDOW (CONCURRENT MULTI-TAB SESSIONS)                 │
├──────────────────────────┬───────────────────────────┬────────────────────────────┤
│   Tab 1: IT Admin        │   Tab 2: Faculty          │   Tab 3: Student           │
│   sessionStorage (90001) │   sessionStorage (Fac)    │   sessionStorage (Stu)     │
│   /admin (Admin Console) │   / , /channels/[id]      │   / , /channels/[id]       │
└────────────┬─────────────┴─────────────┬─────────────┴──────────────┬─────────────┘
             │                           │                            │
             ▼                           ▼                            ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                  ClarifyContext & Auth Route Guard (Client State)                 │
│  • Verifies tab session on mount; redirects unauthenticated tabs to /login        │
│  • Subscribes to Laravel Echo (Reverb WS) + SSE Stream + BroadcastChannel         │
│  • Reconciles live state for Chat, Urgent Popups, Q&A Threads & Ack Counters      │
└──────────────────────────┬──────────────────────────────────────────┬─────────────┘
                           │ REST API (Bearer + X-Clarify-*)          │ WebSockets / SSE
                           ▼                                          ▼
┌──────────────────────────────────────────────────────┐   ┌────────────────────────┐
│     API Layer (Laravel 13 API / Next.js PG Adapter)  │   │  Laravel Reverb Server │
│  • Multi-user token & header resolution per request  │   │  ws://127.0.0.1:8080   │
│  • Announcement, Ack, Chat, Q&A & Admin mutations    ├──►│  Broadcasts:           │
│  • Dispatches ShouldBroadcastNow Reverb Events       │   │  • announcement.urgent │
└──────────────────────────┬───────────────────────────┘   │  • announcement.ack    │
                           │                               │  • channel.chat        │
                           ▼                               │  • thread.updated      │
┌──────────────────────────────────────────────────────┐   │  • realtime.updated    │
│              PostgreSQL Database (clarify_db)        │   └────────────────────────┘
│  users, channels, channel_user, announcements,       │
│  announcement_acknowledgments, messages, replies,    │
│  direct_messages, notifications                      │
└──────────────────────────────────────────────────────┘
```

### Data Model & Real-Time Event Payloads

1. **Laravel Reverb Broadcast Events (`ShouldBroadcastNow`)**:
   - **Channel**: `clarify.global` (public campus-wide real-time sync channel) and `clarify.channel.{channelId}` (course hub channel).
   - **Event Name**: `.realtime.updated` (plus domain metadata for `announcement.urgent`, `announcement.acknowledged`, `chat.message`, `thread.created`, `thread.replied`, and `user.verified`).
   - **Payload**: `{ domain: string, action: string, entity_id?: number, channel_id?: number, timestamp: string }` — triggers immediate, idempotent state reconciliation across all active tabs and connected clients.
2. **Per-Tab Authentication State**:
   - Stored exclusively in `window.sessionStorage` under `clarify_active_user` and `clarify_bearer_token`.
   - Server-side `/api/v1/auth/me` validates the incoming `Authorization: Bearer` token or `X-Clarify-User-Id` / `X-Clarify-Institutional-Id` headers and returns `401 Unauthorized` when no session is present (preventing silent fallback to User #1).

### Interactive Component & State Mapping

- **Auth Route Guard (`AppShell` & `ClarifyContext`)**:
  - Tracks `isAuthResolved` and `user: User | null`.
  - When `isAuthResolved && !user` on any route other than `/login` or `/register`, navigates immediately to `/login`.
  - When `user` is authenticated and visits `/login` or `/register`, redirects to `/admin` (for `it_admin`) or `/` (for `student`, `faculty`, and `moderator`).
- **Live Acknowledgment Counter (`FeedCard` & `ClarifyContext`)**:
  - Student clicks **"I Understand & Acknowledge"** &rarr; `POST /api/v1/announcements/{id}/acknowledge` inserts row into `announcement_acknowledgments`, increments `acknowledgments_count`, and broadcasts `announcement.acknowledged` via Reverb/SSE &rarr; Faculty and Moderator tabs immediately see the updated acknowledgment count and progress bar.
- **Urgent Announcement Popup (`UrgentSafetyModal` & `ClarifyContext`)**:
  - Faculty publishes an urgent announcement (or Moderator approves a queued urgent post) &rarr; Backend broadcasts `announcement.urgent` via Reverb/SSE &rarr; Connected Student tabs in that channel/scope immediately display the blocking `UrgentSafetyModal` until acknowledged.
- **Live Channel Chat & Discussion Threads (`/channels/[id]`, `/threads/[id]`, `/messages`)**:
  - Sending a Course Hub chat message, posting a Q&A thread, adding a reply, marking a thread resolved, or converting a thread to a Class FAQ broadcasts over Reverb/SSE so all open tabs viewing that channel or thread update in real time without page reload.
