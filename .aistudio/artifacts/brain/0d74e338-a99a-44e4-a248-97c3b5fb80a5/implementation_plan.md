# Remove Tags from Course Hub Announcements & Fix Immediate Noticeboard Visibility

This plan removes tag selection/badges from Course Hub announcements and fixes the issue where newly created Course Hub announcements only appeared in **All Announcements** until acknowledged.

## Root Cause Analysis

1. **Why Course Hub Announcements Only Appeared After Acknowledging in All Announcements**:
   - When opening a Course Hub's **Noticeboard Feed**, `AnnouncementController@index` caches the channel's announcement list under `announcements.channel.{channelId}.{hash}` for 10 minutes.
   - In `AnnouncementController`, `acknowledge()` explicitly called `ApiCache::forgetChannelAnnouncements((int) $announcement->channel_id)`, whereas `store()`, `update()`, and `destroy()` did not call `ApiCache::forgetChannelAnnouncements(...)` directly in the controller.
   - As a result, creating a Course Hub announcement saved it to PostgreSQL (so it appeared on **All Announcements** via a separate feed cache key), while the Course Hub's `channel_id` endpoint continued serving the cached pre-creation list until `acknowledge()` was triggered in **All Announcements**.
   - Additionally, on the frontend (`clarify-web`), `BroadcastChannel` only fires in other browser tabs, so the active tab relied solely on re-fetching `GET /api/v1/announcements?channel_id={id}`.

---

## Proposed Changes

### 1. Remove Tags from Course Hub Announcements
- **Create / Edit Announcement Modal (`clarify-web/src/components/modals/AnnouncementFormModal.tsx`)**:
  - Hide the tag pills (`OFFICIAL MEMO`, `CDO CAMPUS`, `CITC`), the `Add tags +` button, and the expandable tag picker when creating or editing a **Course Hub Announcement** (`!isCampusWideMode`).
  - Keep the **Target Handled Course Hub(s)** selector for Course Hub announcements, and send `tags: []` for Course Hub announcements.
  - Retain the tag & department selectors exclusively for **Campus-Wide Announcements** (`isCampusWideMode`).
- **Announcement Cards (`clarify-web/src/components/announcements/AnnouncementCard.tsx`)**:
  - Hide the tag pills row on Course Hub announcements (`announcement.channel_type === 'course_hub'`), displaying tags only on Campus-Wide announcements.
- **Backend Default Tags (`clarify-api/app/Http/Controllers/Api/V1/AnnouncementController.php` & `clarify-web/src/server/postgres-adapter.ts`)**:
  - Default `$tags` to `[]` for Course Hub announcements (`!$isCampusWide`) instead of auto-assigning `['OFFICIAL MEMO', 'CDO CAMPUS', $pubDept]`.

### 2. Fix Course Hub Noticeboard Immediate Display & Cache Invalidation
- **Laravel Controller Cache Invalidation (`clarify-api/app/Http/Controllers/Api/V1/AnnouncementController.php`)**:
  - Explicitly call `ApiCache::forgetChannelAnnouncements((int) $cid)` and `ApiCache::forgetChannels((int) $cid)` inside `store()`, `update()`, and `destroy()` (matching `acknowledge()`), ensuring the channel's cached Noticeboard Feed is invalidated immediately upon creation, edit, or deletion.
- **Frontend Immediate State Sync & Stale-Cache Protection (`clarify-web/src/lib/api-client.ts`, `clarify-web/src/context/ClarifyContext.tsx`, `clarify-web/app/channels/[channelId]/page.tsx`)**:
  - Maintain a session-level mutation overlay in `api-client.ts` for newly created, updated, acknowledged, and deleted announcements across all target `channel_ids` so `getAnnouncementsApi({ channel_id })` immediately merges newly created Course Hub announcements even if a remote server returns a cached list.
  - Dispatch same-tab realtime events inside `ClarifyContext` when `createAnnouncementApi`, `updateAnnouncementApi`, or `deleteAnnouncementApi` completes so `CourseHubPage` updates its Noticeboard Feed instantaneously.
