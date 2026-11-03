# Course Admin Role, Leave Course Hub, Real Avatar Upload & Navigation Fixes

Fix input typing in the **+ Add Course Hub** and **Edit Course Hub** modals, introduce the **Course Admin** role (granted automatically to all Faculty and to the creator of a Course Hub) with **Delete Course Hub** moved inside **Edit Course Hub**, add a **Leave Course Hub** action inside the Course Hub top header settings menu, enable real image file uploads for user profile avatars, and fix first-click navigation to **Noticeboard Feed** and **Isolated Q&A Threads**.

## User Review & Critical Decisions

> [!IMPORTANT]
> Summary of confirmed product decisions:
> - **Course Admin Role**: All Faculty automatically hold the **Course Admin** role, and any Student who creates a Course Hub is the **Course Admin** for that Course Hub. Only Course Admins can **Edit** and **Delete** a Course Hub.
> - **Delete Inside Edit Course Hub**: The standalone Delete buttons on the sidebar and Browse modal are removed; **Delete Course Hub** (with inline confirmation) lives inside the **Edit Course Hub** modal.
> - **Leave Course Hub Placement**: Placed inside the Course Hub top header settings menu (`Course Hub Settings & Channel Roster`).

## 1. Overview & Core Concept

- **What It Does**:
  1. **Fixes Unresponsive Inputs in Add/Edit Course Hub**: Prevents `useEffect` in `ChannelRosterModal` from re-running on every keystroke by removing the unstable `courseHubs` array reference from its dependency list.
  2. **Course Admin Permissions & Delete Relocation**: Restricts editing and deleting a Course Hub to **Course Admins** (`user.role === 'faculty' | 'dept_head'` or `hub.created_by === user.id`) and moves the **Delete Course Hub** action inside the **Edit Course Hub** modal.
  3. **Leave Course Hub**: Adds a **Leave Course Hub** button inside the Course Hub top header settings menu so any member can leave a joined Course Hub.
  4. **Real Profile Picture (PFP) Upload**: Replaces the placeholder avatar button with a real image file picker that resizes/encodes the selected photo and displays the uploaded avatar across the profile drawer, settings modal, and chat messages.
  5. **Direct First-Click Navigation to Noticeboard Feed & Q&A Threads**: Syncs the active Course Hub tab with the `?tab=` URL query parameter (`?tab=feed`, `?tab=threads`) so clicking **Noticeboard Feed** or **Isolated Q&A Threads** from any Course Hub or sub-channel opens that view immediately on the first click.

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Adding & Editing a Course Hub**:
     - Modal form fields initialize only once when the modal opens, allowing uninterrupted typing across Course Code, Course Hub Name, Target Class Section, and Description.
  2. **Course Admin Controls & Deleting a Course Hub**:
     - Course Admins see the **Edit** pencil icon on the Course Hub and a `Course Admin` badge in the Course Hub settings.
     - Inside **Edit Course Hub**, a **Delete Course Hub** button on the bottom-left opens an inline confirmation prompt before deleting the hub.
  3. **Leaving a Course Hub**:
     - Opening the gear icon (`Course Hub Settings & Channel Roster`) in the top header displays a **Leave Course Hub** button that removes the user from the hub's roster and redirects to their next joined hub or Dashboard.
  4. **Uploading a Profile Avatar**:
     - In **Settings -> Profile & SMS Fallback Settings**, clicking **Upload Avatar** opens the device file picker (`accept="image/*"`), previews the cropped/compressed photo immediately, and persists it to the database on **Save Profile**.
  5. **Switching to Noticeboard Feed or Isolated Q&A Threads**:
     - Clicking **Noticeboard Feed** or **Isolated Q&A Threads** under any Course Hub in the left sidebar navigates to `/channels/{hubId}?tab=feed` or `/channels/{hubId}?tab=threads` so the view opens on the first click without landing on `# general` first.

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: URL Query Parameter (`?tab=`) for Course Hub Views**
  - *Chosen Approach*: Read and update `?tab=feed` and `?tab=threads` in `CourseHubPage`.
  - *Why*: Previously, navigating from a sub-channel or another Course Hub triggered `router.push('/channels/' + hub.id)` which mounted the new route with the default `'messenger'` (`# general`) state, requiring a second click.
- **Decision 2: Roster-Based Enrollment + Creator-Based Course Admin**
  - *Chosen Approach*: Check `hub.roster` for whether a user is currently joined in a Course Hub, and check `user.role === 'faculty' || user.role === 'dept_head' || Number(hub.created_by) === Number(user.id)` for **Course Admin** privileges.
  - *Why*: Allows even a Course Hub creator or faculty member to leave a Course Hub and re-join later via Browse Course Hubs while preserving Course Admin permissions.

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Course Hub & Profile Architecture                   │
├─────────────────────────────────────────────────────────────────────────┤
│ 1. Course Admin & Leave Flow                                            │
│    ├─ isUserCourseAdmin(hub, user):                                     │
│    │    true if user.role in ['faculty', 'dept_head']                   │
│    │         or Number(hub.created_by) === Number(user.id)              │
│    ├─ Edit Course Hub Modal (Course Admins only):                       │
│    │    ├─ PATCH /api/v1/channels/{id} (Save Changes)                   │
│    │    └─ DELETE /api/v1/channels/{id} (Delete Course Hub)             │
│    └─ Top Header Settings Menu:                                         │
│         └─ POST /api/v1/channels/{id}/leave -> removes user from roster │
├─────────────────────────────────────────────────────────────────────────┤
│ 2. First-Click Sidebar Navigation                                       │
│    ├─ Click "Noticeboard Feed"     -> /channels/{hub.id}?tab=feed       │
│    ├─ Click "Isolated Q&A Threads" -> /channels/{hub.id}?tab=threads    │
│    └─ Click "# general"            -> /channels/{hub.id}                │
├─────────────────────────────────────────────────────────────────────────┤
│ 3. Real Avatar Upload (PFP)                                             │
│    └─ File Input -> 256x256 Canvas Data URL -> POST /api/v1/profile     │
│       -> Rendered in AppShell Drawer, ProfileModal, & MessengerChatBox  │
└─────────────────────────────────────────────────────────────────────────┘
```
