# Implementation Plan: Differentiate Course Hub vs. Campus-Wide Announcements

## 1. Overview & Goals
- **Visual Origin Differentiation**: Clearly distinguish **Course Hub** announcements from **Campus-Wide** announcements on the **All Announcements** (`/announcements`) and **Dashboard** (`/`) views by displaying the Course Hub badge/subtitle (e.g., `COURSE HUB` badge and Course Hub name/code) instead of generic department memo labels.
- **Remove `"USTP Official Memo"` from Course Hub Announcements**: In the announcement card left box, replace the default `"USTP Official Memo"` fallback label with **`"Course Hub Announcement"`** whenever an announcement belongs to a Course Hub (`channel_type !== 'university'`) and has no file attachment.
- **Add `COURSE HUB` Filter Tag**: Add a **`COURSE HUB`** filter button to the **All Announcements** tag filter bar (`All Tags`, `COURSE HUB`, `URGENT NOTICE`, `OFFICIAL MEMO`, `CDO CAMPUS`, `CITC`, `CEA`, `MEMORANDUM`) and support filtering by `COURSE HUB` across both the Laravel API and the frontend/PostgreSQL adapter.

---

## 2. Planned Changes

### A. Backend API & Data Resource (`clarify-api` & `postgres-adapter.ts`)
1. **`/clarify-api/app/Http/Resources/AnnouncementResource.php` & `/clarify-web/src/server/postgres-adapter.ts`**:
   - Include `course_code` and `channel_name` from the announcement's associated `channel` in the serialized announcement payload (`src/types/api.ts`).
   - When an announcement belongs to a Course Hub (`channel_type === 'course_hub'`), format its `subtitle` with the Course Hub's name/course code (e.g., `IT314 SoftEng • CITC Department` or the Course Hub title) so users can immediately see which Course Hub it came from.
2. **`/clarify-api/app/Http/Controllers/Api/V1/AnnouncementController.php` & `/clarify-web/src/lib/domain-logic.ts`**:
   - Update tag filtering in `AnnouncementController::index` and `filterAndSortAnnouncements` so selecting `tag=COURSE HUB` filters announcements where `channel_type === 'course_hub'` (or `tags` contains `COURSE HUB`), while Campus-Wide tags (`OFFICIAL MEMO`, `CDO CAMPUS`, etc.) continue matching Campus-Wide announcements.

### B. All Announcements Filter Bar & Card UI (`clarify-web`)
1. **`/clarify-web/app/announcements/page.tsx`**:
   - Add `'COURSE HUB'` to `FILTER_TAGS` right after `'ALL'` so users can filter the All Announcements feed to Course Hub announcements in one click.
2. **`/clarify-web/src/components/ui/StateViews.tsx` (`TagBadge`)**:
   - Add styling support for the `COURSE HUB` badge using the USTP palette (`bg-ustp-navy/10 text-ustp-navy border-ustp-navy/25`).
3. **`/clarify-web/src/components/announcements/AnnouncementCard.tsx`**:
   - Differentiate the card header and badges between Campus-Wide (`OFFICIAL MEMO` / department tags) and Course Hub announcements (`COURSE HUB` badge + course code pill if available, and Course Hub name in the subtitle).
   - In the grid card's left box, when `announcement.attachment_url` is not present:
     - Render **`"USTP Official Memo"`** only for Campus-Wide announcements (`channel_type === 'university'`).
     - Render **`"Course Hub Announcement"`** (with the Course Hub's course code or department in the badge icon) for Course Hub announcements.

---

## 3. Verification Plan
- Run `compile_applet` and `lint_applet` to verify zero TypeScript or build errors across `clarify-web`.
- Verify that Course Hub announcements on `/announcements` and `/` display `"Course Hub Announcement"` instead of `"USTP Official Memo"`, show their Course Hub origin badge/subtitle, and filter accurately when clicking the `COURSE HUB` tag button.
