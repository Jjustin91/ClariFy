# Student & Faculty Channel Management (`+ Create Course Hub` & Roster Form)

Enable the **+ Create Course Hub** tab and form, a quick **+ Add Channel** action, and the **Add / Remove Channel Roster Member** form in the Scoped Channel Management modal for all verified roles—including **Student** accounts—and update the backend API and client store so students can save new channels and roster changes end-to-end.

## User Review & Critical Decisions

> [!IMPORTANT]
> Both functional and permission decisions have been confirmed based on your answers:

- **Confirmed Decision 1 (End-to-End Channel & Roster Persistence for Students)**: Both the UI forms (`+ Create Course Hub` and `Add Student / Faculty to Channel Roster`) and the underlying `/api/v1/channels` and `/api/v1/channels/:id/members` endpoints will permit verified Student accounts to create channels and add members directly.
- **Confirmed Decision 2 (Full Roster Management in Channel Roster Tab)**: Students will have access to both the **Add to Roster** form and the **Remove Member** action inside the `Channel Roster` tab.

---

## 1. Overview & Core Concept

- **What It Does**: Opens up the full Scoped Channel Management & Roster Portal (`Workflow 5`) to Student accounts alongside Faculty and IT Administrators, allowing any verified user to create a new Course Hub channel, add members by Institutional ID and name, and remove members from a channel roster.
- **Target Audience / Persona**: USTP students (e.g., study group leads, class representatives like Kobeni Higashiyama), faculty instructors, and IT administrators organizing course hubs and section rosters.
- **Key Value**: Removes role friction when provisioning new course or study channels and managing section rosters during live evaluations and student-led collaborations.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Opening Channel Management (`Channel Management +` in Right Drawer or `Roster` in Course Hub Sidebar)**: The modal opens displaying three tabs for all roles: `Browse & Join Channels`, `Channel Roster (<count>)`, and `+ Create Course Hub`.
  2. **Quick `+ Add Channel` Action in Browse Tab**: A top header bar inside `Browse & Join Channels` provides a `+ Add Channel / Course Hub` button that switches directly to the `+ Create Course Hub` tab.
  3. **Adding & Removing Roster Members (`Channel Roster` Tab)**: Any user (including Student view) sees the selected `Add Student / Faculty to Channel Roster` form (`ID e.g. 2020201199`, `Full Name (optional)`, `+ Add to Roster` submit button) as well as the remove icon button next to roster entries. Submitting adds the member immediately, increments the enrolled count, and shows a confirmation toast.
  4. **Creating a New Course Hub (`+ Create Course Hub` Tab)**: Any user fills in `Course Code` (e.g., `IT315`), `Channel Display Name`, `Department Scope`, `Target Section`, and `Channel Description`, then clicks `Create Scoped Channel`. The new channel is immediately added to the Scoped Channels sidebar and Dashboard list.
- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Consistent USTP institutional modal and form styling.
  - *Color Palette & Mood*: USTP Navy (`#1a1851`) modal header and primary submit buttons, USTP Cream (`#FFFAF2`) tab bar, crisp white inputs with slate hairline borders, and red (`#dc2626`) validation alerts and remove actions.
  - *Typography & Hierarchy*: `Plus Jakarta Sans` for labels and buttons paired with `JetBrains Mono` (`tabular-nums`) for Institutional IDs, course codes, and enrollment counters.
  - *Component Styling & Layout*: Responsive 3-column grid (`grid-cols-1 sm:grid-cols-3`) for the inline roster addition form and 2-column grid for course hub creation fields.
- **Interactive Feedback & Motion**: Inline `422` field validation messages when required fields (`institutional_id`, `course_code`, `name`) are empty, plus toast notifications on creation, addition, or removal.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Unifying Channel & Roster Permissions While Preserving Announcement RBAC (`TC-NFR01`)**
  - *Chosen Approach*: Remove the faculty-only role gate on `POST /api/v1/channels` and `POST /api/v1/channels/:id/members` (and their client-side mock counterparts) while keeping `canPublishOrManageAnnouncements` strictly enforced on announcement creation/editing (`POST /api/announcements/create`, `POST /api/v1/announcements`).
  - *Why*: Fulfils your request for students to create channels and manage channel rosters end-to-end while keeping existing automated security tests (`TC-NFR01` student `403` on announcement publishing) 100% passing.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Scoped Channel Management & Roster Modal (All Roles: Student/Faculty/Admin)│
├────────────────────────┬─────────────────────────┬─────────────────────────┤
│ Tab 1: Browse & Join   │ Tab 2: Channel Roster   │ Tab 3: + Create Course  │
│  • Channel list        │  • Channel selector     │         Hub             │
│  • Verify/Sync Access  │  • Add Member <form>    │  • Course Code & Name   │
│  • [+ Add Channel] CTA │  • Roster list + Remove │  • Dept & Section Scope │
└───────────┬────────────┴────────────┬────────────┴────────────┬────────────┘
            │                         │                         │
            ▼                         ▼                         ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ Client API Layer & Embedded ClariFy API v1 Engine (/api/v1/channels/*)     │
│  • POST /api/v1/channels/:id/join    -> Enrolls current user               │
│  • POST /api/v1/channels/:id/members -> Adds or removes roster member      │
│  • POST /api/v1/channels             -> Creates new scoped Course Hub      │
└────────────────────────────────────────────────────────────────────────────┘
```

- **Data Model & State**:
  - `channels` array in `ClarifyContext` and `ServerStore` holds each `Channel` object along with its `roster` array (`id`, `institutional_id`, `name`, `role`, `section`, `department`) and `members_count`.
- **Interactive Component & State Mapping**:
  - **Add Member Form (`handleAddMember`)**: Validates `newMemberId`, calls `manageChannelMemberApi(currentChannel.id, { institutional_id, name, section, action: 'add' })`, refreshes `channels` state, resets inputs, and triggers a success toast.
  - **Remove Member Button (`handleRemoveMember`)**: Calls `manageChannelMemberApi(currentChannel.id, { institutional_id, action: 'remove' })`, updates roster list and count, and triggers an info toast.
  - **Create Course Hub Form (`handleCreateChannel`)**: Validates `courseCode` and `channelName`, calls `createChannelApi(...)`, prepends the new channel to the active list, switches back to `Browse & Join Channels`, and shows a confirmation toast.
