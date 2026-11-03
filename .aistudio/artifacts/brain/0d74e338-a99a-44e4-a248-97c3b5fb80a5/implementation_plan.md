# Fix `channel_user.approval_status` Undefined Column Error on Course Hub Creation

This plan resolves the `SQLSTATE[42703]: Undefined column: 7 ERROR: column channel_user.approval_status does not exist` error when creating or fetching Course Hubs against the Supabase PostgreSQL database (`aws-0-eu-west-1.pooler.supabase.com` / Render API).

## User Review & Critical Decisions

> [!IMPORTANT]
> **Root Cause**: The `Channel::members()` relationship in Laravel (`clarify-api`) was updated to select `channel_user.approval_status` as a pivot column (`->withPivot(['can_publish', 'approval_status', 'joined_at'])`), but the existing `channel_user` table on Supabase was created by an earlier migration that did not include `approval_status`, and the auto-migration (`ALTER TABLE channel_user ADD COLUMN approval_status...`) only ran inside `ChannelController::join()` instead of before `ChannelController::store()` / `ChannelController::index()` or via a Laravel migration.

- **Database Migration + Self-Healing Guard**: We will add both a formal Laravel migration (`2026_11_03_000006_add_approval_status_to_channel_user_table.php`) for `php artisan migrate --force` and an automatic self-healing column check (`Channel::ensureApprovalStatusColumn()`) inside `Channel::members()` and `ChannelController` so any endpoint (`POST /api/v1/channels`, `GET /api/v1/channels`, etc.) creates the column on the fly if missing and never crashes with `SQLSTATE[42703]`.

---

## 1. Overview & Core Concept

- **What It Does**: Ensures the `channel_user.approval_status` column (`'approved' | 'pending'`) is always present in PostgreSQL before any Eloquent pivot query runs, and falls back gracefully if the column is not yet migrated.
- **Target Audience / Persona**: Students, Faculty, and Department Heads creating, browsing, or joining Course Hubs.
- **Key Value**: Eliminates the 500 SQL error on `POST /api/v1/channels` and `GET /api/v1/channels` immediately and permanently.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Create Course Hub (`POST /api/v1/channels`)**: When a user submits `+ Add Course Hub`, the backend ensures `channel_user.approval_status` exists, attaches the creator with `approval_status = 'approved'`, and returns the newly created `ChannelResource` with HTTP `201 Created`.
  2. **Browse & Join Course Hubs (`GET /api/v1/channels` & `POST /api/v1/channels/{id}/join`)**: Loads all Course Hubs and member rosters without pivot column errors.
- **Visual Identity & Theme**: Retains the existing USTP Navy (`#1a1851`), Gold (`#fdb913`), and Cream (`#fef8ec`) Course Hub modal and workspace design.
- **Interactive Feedback & Motion**: Course Hub creation immediately closes the modal, displays the success toast (`Course Hub created with Noticeboard Feed, Q&A Threads, and #general!`), and navigates to `/channels/{id}`.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Dual Migration + Runtime Self-Healing in `Channel::members()`**
  - *Chosen Approach*: Add a new incremental Laravel migration (`2026_11_03_000006_add_approval_status_to_channel_user_table.php`) AND a runtime `Channel::ensureApprovalStatusColumn()` helper called inside `Channel::members()`.
  - *Why*: In existing Supabase databases, previously executed migrations (`2026_10_22_000002_...`) are skipped by `php artisan migrate`. Adding a new timestamped migration ensures `render-start.sh` migrates existing databases, while the runtime check inside `Channel::members()` guarantees that even if `migrate` hasn't run yet, the first request automatically executes `ALTER TABLE channel_user ADD COLUMN IF NOT EXISTS approval_status VARCHAR(24) NOT NULL DEFAULT 'approved'` and only selects the pivot column when present.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     POST /api/v1/channels (Course Hub)                   │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│               Channel::ensureApprovalStatusColumn() Guard                │
│  1. Checks Schema::hasColumn('channel_user', 'approval_status')          │
│  2. Runs ALTER TABLE channel_user ADD COLUMN IF NOT EXISTS               │
│     approval_status VARCHAR(24) NOT NULL DEFAULT 'approved'              │
│  3. Dynamically configures ->withPivot(...) so Eloquent never queries    │
│     a non-existent column                                                │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                 ChannelController::store() & Migration                   │
│  • Attaches creator with approval_status = 'approved'                    │
│  • Loads members.academicProfile and returns ChannelResource (HTTP 201)  │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Data Model & State**:
  - `channel_user.approval_status`: `VARCHAR(24) NOT NULL DEFAULT 'approved'`.
- **Interactive Component & State Mapping**:
  - `Channel::ensureApprovalStatusColumn()` caches its check per PHP worker request and safely upgrades `channel_user` before any `Channel::with('members')` or `$channel->members()` pivot query is executed.
  - `ChannelController::store()` sets `'approval_status' => 'approved'` when attaching the Course Hub creator to `channel_user`.
