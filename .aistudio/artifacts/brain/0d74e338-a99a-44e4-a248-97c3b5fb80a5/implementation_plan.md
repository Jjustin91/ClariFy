# ClariFy Logo Branding & Discord-Style Course Hub Hierarchy Plan

## 1. Overview & Goals
1. **Official ClariFy Logo Integration**:
   - Replace the plain text `ClariFy` wordmark with the official ClariFy logo (`/assets/aistudio/image_07899ab9.png`) in the persistent top navigation bar (`AppShell.tsx`), the Login page (`app/login/page.tsx`), and the Account Registration page (`app/register/page.tsx`).
   - Copy the logo asset into `clarify-web/public/assets/aistudio/image_07899ab9.png` so Next.js serves it reliably both locally and on Vercel.
2. **Discord-Style Course Hub & Inner Channel Hierarchy (`View Messages`)**:
   - Rework the left sidebar in `/channels/[channelId]` from a flat channel list into an **expandable Course Hub tree** inspired by Discord.
   - Change the top-level sidebar action button from `Add Channel` to **`+ Add Course Hub`**, allowing both **Faculty and Students** to create new Course Hubs (e.g., `IT314 SoftEng`, `IT315 Elective`).
   - Inside each expanded Course Hub, automatically provide the **given/built-in items**:
     - **Noticeboard Feed** (scoped announcements for the Course Hub)
     - **Isolated Q&A Threads** (structured academic inquiries and tickets for the Course Hub)
     - **`# general`** (default live chat channel for the Course Hub)
   - Include an inline **`+ Add Channel`** button inside each Course Hub so both **Faculty and Students** can create custom text channels (e.g., `# project-groups`, `# lecture-notes`, `# exam-review`) nested under that Course Hub, each with its own isolated real-time chat stream.

---

## 2. Visual & UX Architecture

### A. Official ClariFy Logo Placement
- **Top Navigation Bar (`AppShell.tsx`)**:
  - Replace the text-only `ClariFy` link on the top-left of the `#1a1851` (`ustp-navy`) header with the official ClariFy logo image (`h-8 sm:h-9 w-auto object-contain`), blending seamlessly against the dark navy header bar alongside the vertical divider `|` and active page title.
- **Login & Registration Pages (`app/login/page.tsx`, `app/register/page.tsx`)**:
  - Display the official ClariFy logo badge in the institutional branding card on the left navy panel and in the sign-in/registration header emblem on the right panel.

### B. Discord-Style Course Hub Sidebar Tree (`app/channels/[channelId]/page.tsx`)
- **Top Sidebar Controls**:
  - Sidebar section header updated to **`COURSE HUBS`**.
  - Search input filters both Course Hubs and their inner channels (`Search course hubs or #channels...`).
  - Top primary button updated to **`+ Add Course Hub`**, opening the Course Hub creation/browse modal.
- **Expandable Course Hub Accordion Tree**:
  - Each top-level **Course Hub** (e.g., `IT314 SoftEng`, `IT311 InfoAssurance`) renders as a collapsible category row with a chevron indicator, course code/name, and unread badge.
  - When expanded, the Course Hub reveals two organized groups underneath:
    1. **Built-In Hub Spaces (Always Given)**:
       - `Noticeboard Feed` — switches the center workspace to the Course Hub's official announcement feed.
       - `Isolated Q&A Threads` — switches the center workspace to the Course Hub's Q&A ticket board (with badge count for open tickets).
    2. **Hub Chat Channels (`CHANNELS` header + inline `+ Add Channel` button)**:
       - `# general` — built-in default Messenger Chat for the Course Hub.
       - Custom sub-channels (`# project-groups`, `# lab-help`, etc.) created inside this Course Hub, each loading its own dedicated real-time Messenger Chat stream in the center column.
- **Center Workspace & Top Header Synchronization**:
  - Selecting `Noticeboard Feed`, `Isolated Q&A Threads`, `# general`, or any custom `# sub-channel` inside the sidebar immediately updates the center workspace and top header bar to show the active Course Hub + active channel/view name.
  - The top bar tabs inside `MessengerChatBox.tsx` stay synchronized with the sidebar selection so users can switch between the active `# channel` chat, `Noticeboard Feed`, and `Isolated Q&A Threads` from either the sidebar tree or the top workspace bar.

---

## 3. Data & Persistence Strategy (Zero-Downtime Supabase + Render + Vercel Compatible)
- **Parent Course Hub & Sub-Channel Linking**:
  - Top-level Course Hubs are stored in PostgreSQL `channels` with `channel_type = 'course_hub'`.
  - Sub-channels created inside a Course Hub are stored in PostgreSQL `channels` linked to their parent Course Hub ID via a metadata tag prefix `[HUB:{parentHubId}]` in `description` (and optional `parent_id` property in `Channel` type/resource).
  - Because each sub-channel is a real row in `channels` with its own `id`, existing endpoints (`GET/POST /api/v1/channels/{id}/chat`) automatically isolate chat messages per sub-channel in the `messages` table without requiring destructive database migrations on the live Supabase instance.
  - Announcements (`Noticeboard Feed`), Q&A Inquiries (`Isolated Q&A Threads`), Class FAQs, and Course Hub Roster remain scoped to the parent Course Hub ID so all channels inside a Course Hub share the same class roster, announcements, and FAQs.

---

## 4. Files to Create / Modify
1. **`/clarify-web/public/assets/aistudio/image_07899ab9.png`**
   - Copy the attached ClariFy logo into `clarify-web/public/assets/aistudio/image_07899ab9.png` so Next.js serves it as a static asset.
2. **`/clarify-web/src/components/layout/AppShell.tsx`**
   - Replace the plain text `ClariFy` link in the top header and loading screen with the official ClariFy logo image.
3. **`/clarify-web/app/login/page.tsx` & `/clarify-web/app/register/page.tsx`**
   - Replace the plain text `ClariFy` title/badge with the official ClariFy logo image.
4. **`/clarify-web/src/types/api.ts`**
   - Add optional `parent_hub_id?: number | null` helper typing on `Channel` and modal state support for creating either a top-level **Course Hub** or a **Sub-Channel** inside a specific Course Hub.
5. **`/clarify-web/src/components/modals/ChannelRosterModal.tsx` & `/clarify-web/src/context/ClarifyContext.tsx`**
   - Update modal titles and actions from `Add Channel` to **`+ Add Course Hub`** (when adding/browsing top-level Course Hubs) and support a dedicated **`+ Add Channel`** mode when triggered inside a specific Course Hub (pre-filling the parent Course Hub's course code, department, and section).
6. **`/clarify-web/app/channels/[channelId]/page.tsx` & `/clarify-web/src/components/threads/MessengerChatBox.tsx`**
   - Implement the Discord-style expandable Course Hub tree in the left sidebar with `+ Add Course Hub` at the top, built-in `Noticeboard Feed` and `Isolated Q&A Threads` items, default `# general` chat channel, custom `# sub-channels`, and an inline `+ Add Channel` button per Course Hub.
7. **`/clarify-api/app/Http/Controllers/Api/V1/ChannelController.php` & `/clarify-web/src/server/postgres-adapter.ts`**
   - Ensure both Students and Faculty can create Course Hubs and sub-channels, and preserve parent Course Hub association smoothly.
