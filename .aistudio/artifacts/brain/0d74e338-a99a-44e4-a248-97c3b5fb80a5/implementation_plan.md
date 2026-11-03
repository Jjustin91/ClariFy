# Lightweight File-Based API Caching for ClariFy (`clarify-api`)

This plan implements zero-dependency, file-based caching (`CACHE_STORE=file`) in `clarify-api` to reduce redundant Supabase PostgreSQL round-trips across announcements, course hub channels, and the verified faculty directory, complete with automatic cache invalidation on writes.

## User Review & Critical Decisions

> [!IMPORTANT]
> **Why Registry-Backed Keys Instead of `Cache::tags()`**: Laravel's `file` cache driver does not support `Cache::tags()` (which throws a `BadMethodCallException` without Redis/Memcached). To achieve targeted per-channel and per-resource invalidation using only the native `file` driver, we use deterministic cache key conventions paired with a lightweight file-cached key index (`Cache::forget()`) so every parameterized query variant for a specific `channel_id` is cleanly invalidated on create/update/delete.

- **Confirmed TTLs & Store**:
  - `AnnouncementController@index`: **10 minutes** (`600` seconds) via `Cache::remember()`
  - `ChannelController@index`: **10 minutes** (`600` seconds) via `Cache::remember()`
  - `InstructorController@index`: **30 minutes** (`1800` seconds) via `Cache::remember()`
  - Default Store: `'file'` in `config/cache.php` and `CACHE_STORE=file` / `CACHE_DRIVER=file` in `.env.example`
  - Preflight Caching: `'max_age' => 86400` (24 hours) in `config/cors.php`

---

## 1. Overview & Core Concept

- **What It Does**: Caches serialized JSON-ready resource payloads for the three highest-traffic read endpoints in `clarify-api` on local disk (`storage/framework/cache/data`) while immediately invalidating affected channel or directory keys when announcements, channels, or rosters change.
- **Target Audience / Persona**: Students, Faculty, Department Heads, and mobile/web clients communicating with the Render/Supabase Laravel API.
- **Key Value**: Eliminates costly cross-region PostgreSQL pooler queries on repeated page loads and caches CORS preflight `OPTIONS` requests for 24 hours.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Course Hub Noticeboard & All Announcements (`GET /api/v1/announcements`)**: First request queries Supabase and caches the resolved response under the channel-scoped key for 10 minutes; subsequent requests serve directly from the local file cache until an announcement is created, updated, acknowledged, or deleted.
  2. **Course Hub Sidebar & Browse Modal (`GET /api/v1/channels`)**: Caches the user's visible channel list for 10 minutes; creating, editing, deleting, joining, leaving, or managing members immediately invalidates the channel cache so the UI reflects roster and metadata changes right away.
  3. **Verified Faculty Directory (`GET /api/v1/instructors`)**: Caches the approved faculty directory for 30 minutes per filter/pagination combination.
- **Visual Identity & Theme**: Backend performance enhancement; preserves existing ClariFy USTP Navy (`#1a1851`) and Gold (`#fdb913`) UI behavior and real-time synchronization.
- **Interactive Feedback & Motion**: Mutations immediately invalidate stale cache entries before returning the response and broadcasting real-time events, preventing any stale UI reads on follow-up fetches.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Cache Key Naming Convention & Index-Based `Cache::forget()`**
  - *Chosen Approach*:
    - **Channel Announcements**: `announcements.channel.{channel_id}.{query_hash}` (tracked under index key `announcements.channel.{channel_id}.keys`) and `announcements.feed.user.{user_id}.{query_hash}` (tracked under `announcements.feed.keys`).
    - **User Visible Channels**: `channels.user.{user_id}.{query_hash}` (tracked under index key `channels.keys`).
    - **Instructor Directory**: `instructors.directory.{query_hash}` (tracked under index key `instructors.keys`).
  - *Why*: Allows `AnnouncementObserver` (`created`, `updated`, `deleted`) to invalidate all cached pages/filters for a specific `$announcement->channel_id` (plus the combined campus/enrolled feed) using standard `Cache::forget()`, which works natively with the `'file'` driver.
- **Decision 2: Caching Resolved Array Payloads Inside `Cache::remember()`**
  - *Chosen Approach*: Cache the resolved `['data' => ..., 'meta' => ...]` array inside `Cache::remember()`, then return `response()->json($payload)`.
  - *Why*: Avoids serializing Eloquent model connections or lazy-loaded relations while caching the full resource transformation and pagination metadata.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

```
┌──────────────────────────────────────────────────────────────────────────┐
│                   Incoming GET Request (API v1)                          │
│  • GET /api/v1/announcements   (TTL: 10 mins)                            │
│  • GET /api/v1/channels        (TTL: 10 mins)                            │
│  • GET /api/v1/instructors     (TTL: 30 mins)                            │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                 Laravel File Cache (config/cache.php)                    │
│  • Store: 'file' (storage/framework/cache/data)                          │
│  • Cache::remember($cacheKey, $ttl, fn () => ...)                        │
│  • Registers $cacheKey in per-channel / per-resource index key           │
└───────────────┬──────────────────────────────────────────┬───────────────┘
                │ Cache Hit                                │ Cache Miss
                ▼                                          ▼
┌───────────────────────────────┐          ┌───────────────────────────────┐
│ Return Cached JSON Payload    │          │ Query Supabase PostgreSQL,    │
│ (< 5ms disk read, 0 DB query) │          │ Transform Resource & Store    │
└───────────────────────────────┘          └───────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│                        Cache Invalidation Triggers                       │
│  • AnnouncementObserver (created / updated / deleted):                   │
│    -> ApiCache::forgetChannelAnnouncements($announcement->channel_id)    │
│  • ChannelController (store / update / destroy / join / leave / members):│
│    -> ApiCache::forgetChannels()                                         │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Data Model & State**:
  - `config/cache.php`: Configures `'default' => env('CACHE_STORE', env('CACHE_DRIVER', 'file'))` and `'stores.file'` pointing to `storage_path('framework/cache/data')`.
  - `.env.example`: Sets `CACHE_STORE=file` and `CACHE_DRIVER=file`.
  - `config/cors.php`: Ensures `'max_age' => 86400` for browser/mobile preflight `OPTIONS` caching.
- **Interactive Component & State Mapping**:
  - `AnnouncementObserver`: Implements `created(Announcement $announcement)`, `updated(Announcement $announcement)`, and `deleted(Announcement $announcement)` (alongside existing `updating()` audit logging) to invalidate the channel's announcement cache keys.
  - `ChannelController`: Calls `ApiCache::forgetChannels()` on channel creation (`store`), update (`update`), deletion (`destroy`), and roster changes (`join`, `leave`, `manageMembers`).
