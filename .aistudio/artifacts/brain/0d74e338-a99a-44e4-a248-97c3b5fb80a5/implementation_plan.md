# Course Hub Creation for Students & Accurate Enrolled Roster Plan

## 1. Overview
Update the ClariFy Course Hub and Roster system so that **Students, Faculty, and Department Heads** can create Course Hub channels and manage channel rosters, and ensure every Course Hub displays an **accurate Enrolled Roster** and member count based on real enrolled users rather than a hardcoded `42` placeholder.

---

## 2. Key Functional Changes

### A. Allow Students to Create Course Hub Channels
- **Direct PostgreSQL Engine (`/clarify-web/src/server/postgres-adapter.ts`)**:
  - Update `POST /api/v1/channels` so authenticated `student`, `faculty`, and `dept_head` accounts can create Course Hub channels (removing the `"HTTP 403 Forbidden: Only Faculty and Department Heads can create Course Hub channels."` block for students).
  - Automatically enroll the creator and all approved users whose academic profile matches the channel's `scope_section` into `channel_user`.
- **Laravel 13 Backend (`/clarify-api/app/Http/Controllers/Api/V1/ChannelController.php`)**:
  - Update `ChannelController@store` to permit authenticated students as well as faculty and department heads to create Course Hub channels, and auto-sync matching section users into the channel roster.

### B. Accurate Enrolled Roster & Member Counts (Auto-Sync Section + Joined Users)
- **Auto-Sync Section & Activity Members**:
  - Synchronize approved users whose `academic_profiles.section` matches a Course Hub's `scope_section` (along with the channel creator, explicitly joined users, and chat/thread participants) into the channel's `channel_user` roster.
  - Ensure newly registered or newly approved users are automatically added to Course Hubs matching their section.
- **Remove Hardcoded `42` Member Counts**:
  - In `/clarify-web/src/server/postgres-adapter.ts`:
    - Change `members_count: Math.max(roster.length, 42)` to `members_count: roster.length`.
    - Update announcement `read_reach.enrolled_total` in `fetchAnnouncementsFromPg` to use the channel's actual enrolled member count (minimum `1` to prevent division by zero) instead of hardcoded `42`.
  - In `/clarify-api/app/Http/Resources/ChannelResource.php`:
    - Change `'members_count' => max(42, $members->count())` to `'members_count' => $members->count()`.
  - In `/clarify-web/src/components/modals/ChannelRosterModal.tsx` and `/clarify-web/app/channels/[channelId]/page.tsx`:
    - Replace all `members_count || 42` fallbacks with the actual `roster?.length ?? members_count ?? 0` count, and display the real member count in the sidebar (`Enrolled Roster: X members`) and modal tabs.

### C. Full Roster Add & Remove Permissions for Students and Faculty
- **Backend (`postgres-adapter.ts` & `ChannelController.php`)**:
  - Allow both Students and Faculty/Department Heads to add and remove members via `POST /api/v1/channels/{id}/members`.
  - Prevent removing a member from being undone by section auto-sync by allowing explicit removal of any roster entry (and allowing any member role in the roster list to be removed).
- **Frontend (`/clarify-web/src/components/modals/ChannelRosterModal.tsx`)**:
  - Enable the remove button across roster entries for both Student and Faculty users and show clear role/section badges and empty-state feedback when a roster has no members.

---

## 3. Files to Modify
1. `/clarify-web/src/server/postgres-adapter.ts`
2. `/clarify-api/app/Http/Controllers/Api/V1/ChannelController.php`
3. `/clarify-api/app/Http/Resources/ChannelResource.php`
4. `/clarify-web/src/components/modals/ChannelRosterModal.tsx`
5. `/clarify-web/app/channels/[channelId]/page.tsx`
