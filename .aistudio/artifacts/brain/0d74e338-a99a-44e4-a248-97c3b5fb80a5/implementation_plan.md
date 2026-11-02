# Mobile Sticky Course Hub Layout & Accurate Pagination Plan

## 1. Overview
This plan addresses both parts of your request:
1. **Mobile Course Hub Sticky Layout**:
   - **Image 1 (Main Chat / Tab Stream)**: Make the center chat message stream (and active workspace tab content) the **only scrollable area** on mobile and desktop viewports.
   - **Image 2 (Course Hub Header & Tabs Bar)**: Keep the Course Hub title, Settings gear icon, and workspace tabs (`Messenger Chat`, `Noticeboard Feed`, `Isolated Q&A Threads`, `+ Ask in Q&A Thread`) **sticky at the top**.
   - **Image 3 (Bottom Message Composer)**: Keep the voice/photo/file attachment buttons, message input pill, and send arrow **sticky at the bottom**.
2. **Accurate Pagination**:
   - Replace the hardcoded `2 ... 10` placeholder buttons on **All Announcements** (`/announcements`) and **View Faculty / Instructors** (`/instructors`) with real, data-driven pagination based on `meta.current_page`, `meta.last_page`, and `meta.total`.

---

## 2. Planned Changes

### A. Mobile Viewport Lock & Sticky Chat Bars
- **`/clarify-web/src/components/layout/AppShell.tsx`**:
  - On `/channels/*` routes, lock the shell to `h-dvh overflow-hidden` and set `<main>` to `flex-1 min-h-0 overflow-hidden` so the mobile browser page itself never scrolls.
- **`/clarify-web/app/channels/[channelId]/page.tsx`**:
  - Replace static `100vh` height calculations (`min-h-[calc(100vh-6.25rem)]`, `h-[calc(100vh-6.25rem)]`) with `flex-1 min-h-0 overflow-hidden` so the Course Hub workspace fits the exact remaining mobile viewport height below the top header and mobile quick drawer bar.
- **`/clarify-web/src/components/threads/MessengerChatBox.tsx`**:
  - Keep the top Course Hub header & tabs bar `shrink-0 sticky top-0 z-20`.
  - Set the center chat stream (`ref={streamContainerRef}`) and tab content wrapper to `flex-1 min-h-0 overflow-y-auto overscroll-contain`.
  - Keep the staged attachment chip and bottom message composer form `shrink-0 sticky bottom-0 z-20`.

### B. Accurate Pagination Controls (`/clarify-web/app/announcements/page.tsx` & `/clarify-web/app/instructors/page.tsx`)
- Remove hardcoded `2`, `...`, and `10` page buttons.
- Dynamically render actual page numbers from `1` to `meta.last_page` (with smart ellipsis when `meta.last_page > 7`).
- Ensure `<<` (Previous) and `>>` (Next) buttons accurately navigate between valid pages and disable when at page `1` or `meta.last_page`.
- Reset `page` to `1` whenever search, tag/department filter, or sort order changes, and automatically clamp `page` if `meta.last_page` decreases after filtering or deleting items.
- Display an accurate item/page summary (`Page X of Y • Z total`) alongside the page buttons.

---

## 3. Files to Modify
1. `/clarify-web/src/components/layout/AppShell.tsx`
2. `/clarify-web/app/channels/[channelId]/page.tsx`
3. `/clarify-web/src/components/threads/MessengerChatBox.tsx`
4. `/clarify-web/app/announcements/page.tsx`
5. `/clarify-web/app/instructors/page.tsx`
