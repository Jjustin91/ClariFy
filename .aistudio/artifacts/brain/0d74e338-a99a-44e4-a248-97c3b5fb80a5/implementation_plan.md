# ClariFy — Favicon, Strict Course Hub Enrollment & Join Approval, Course Admin Roster Control, and Scoped Announcement Separation

This update adds the official ClariFy logo to the browser tab favicon, prevents unenrolled users from viewing Course Hub chats/FAQs until they join and are approved, restricts adding members and approving join requests to Course Admins, displays the publisher's department directly under announcement titles, and separates Department Head campus-wide announcements from Instructor course-specific Noticeboard Feed announcements.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following product and access-control decisions incorporate your prompt instructions and confirmed preferences:

- **Confirmed Decision 1 (Course Admin Member Management)**: Only **Course Admins** (the Course Hub creator and any Faculty / Department Head) can manually add or remove members in the Course Hub roster and approve or decline incoming join requests.
- **Confirmed Decision 2 (All Announcements vs. Course Hub Noticeboard Feed)**:
  - **All Announcements** (and Dashboard Latest Announcements) displays both Campus-Wide announcements and notices from the user's joined Course Hubs, while **only Department Heads (`dept_head`)** can publish Campus-Wide announcements across multiple departments without a class section selector.
  - **Course Hub Noticeboard Feed** displays only announcements posted specifically to that Course Hub, and **Instructors / Faculty** can publish multiple course-specific announcements fixed to their handled Course Hub.
- **Confirmed Decision 3 (Course Hub Join Approval & Strict Enrollment Gate)**:
  - Newly created or unenrolled accounts cannot view any Course Hub's chat stream, Noticeboard Feed, Q&A Threads, or Class FAQs—even if they visit `/channels/1` directly. Instead, they see the `"You Haven't Joined a Course Hub Yet"` screen.
  - Clicking **Join Course Hub** in **Browse Course Hubs** submits a **Pending Join Request** (unless the user is already a Course Admin / Faculty), which a **Course Admin** can approve or decline inside the Course Hub's settings and roster panel.

---

## 1. Overview & Core Concept

- **What It Does**:
  1. **Browser Tab Favicon (1st Image)**: Configures the ClariFy icon in the application metadata so the browser tab displays the ClariFy logo instead of a generic globe icon.
  2. **Strict Course Hub Access for Unenrolled Accounts (2nd Image)**: Ensures `resolveCourseHubSelection` only selects from the user's **joined and approved** Course Hubs. If a user has not joined any Course Hub (or navigates to a hub ID they are not enrolled in), no Course Hub chat, Q&A threads, or Class FAQs are loaded or displayed.
  3. **Course Hub Join Approval & Course Admin Roster Controls**:
     - When a student requests to join a Course Hub from **Browse Course Hubs**, their membership is recorded as **Pending Approval** (`pending_requests` on the Course Hub).
     - In **Browse Course Hubs**, the card shows a **Pending Approval** badge for that student until approved.
     - Inside the Course Hub's **Course Hub Settings & Channel Roster** menu (and header badge), **Course Admins** see a **Pending Join Requests** list with **Approve** and **Decline** buttons, and only **Course Admins** can use the **+ Add Member** form or remove roster members.
  4. **Publisher Department Subtitle on Announcement Cards (3rd Image)**: Displays the publisher's department (e.g., `CITC Department` or the multi-department scope) directly beneath the announcement title on every Announcement Card.
  5. **Campus-Wide (Dept Head) vs. Course Hub (Instructor) Announcements**:
     - **Campus-Wide Mode (`All Announcements` & `Dashboard`)**: The **Create Announcement** button on `All Announcements` and `Dashboard` is available exclusively to **Department Heads (`dept_head`)**. Opening the modal from these pages launches **Campus-Wide Announcement Mode**, which removes the course/section scope dropdown and lets the Department Head target one or more departments (`CITC`, `CEA`, `COT`, `CSM`, `CDO CAMPUS`).
     - **Course Hub Noticeboard Mode (`Course Hub -> Noticeboard Feed`)**: Inside a Course Hub's `Noticeboard Feed`, **Instructors / Faculty** (and Course Admins) can click **+ Create Announcement** to publish multiple announcements scoped directly to that Course Hub (`channel_id` locked to the current Course Hub, with optional multi-select across the instructor's handled Course Hubs).

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  - **Unenrolled User Flow**: A newly registered student opens **View Messages** (`/channels/1`) and sees `"You Haven't Joined a Course Hub Yet"` in the main workspace and an empty Class FAQs panel—never another class's messages or FAQs.
  - **Requesting & Approving Course Hub Membership**:
    1. Student opens **Browse Course Hubs** and clicks **Request to Join** on a Course Hub.
    2. The button updates to **Pending Approval (Cancel Request)**.
    3. A **Course Admin** opens the Course Hub, sees a notification badge on the top-right Settings gear icon, opens **Course Hub Settings & Channel Roster**, and clicks **Approve** next to the student's request.
    4. The student is immediately added to the active roster and the Course Hub appears in their left sidebar.
  - **Department Head Campus-Wide Announcement Flow**:
    1. A Department Head clicks **Create Announcement** on **All Announcements** or **Dashboard**.
    2. The modal opens in **Campus-Wide Announcement** mode without any class section selector, allowing selection of multiple department tags (`CITC`, `CEA`, `COT`, `CSM`, `CDO CAMPUS`).
    3. Once published, the announcement card displays the posting department right under the title.
  - **Instructor Course Hub Noticeboard Flow**:
    1. An Instructor opens a handled Course Hub, switches to **Noticeboard Feed**, and clicks **+ Create Announcement**.
    2. The modal opens locked to that Course Hub (with an option to also post to other Course Hubs handled by that instructor) and publishes directly to the course's Noticeboard Feed.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Strict Enrollment Gate in `resolveCourseHubSelection` and `CourseHubPage`**
  - *Chosen Approach*: Never fall back to `allCourseHubs[0]` or `channels[0]` when `user` is provided. If the requested `channelId` is not in the user's joined `courseHubs`, fall back to `courseHubs[0]` if the user has joined another hub, or `undefined` if they have joined none. Also skip fetching announcements/threads when `activeChannel` is `undefined`.
  - *Why*: Eliminates any data leakage of chat messages, announcements, or Class FAQs to unenrolled accounts.
- **Decision 2: Self-Contained Join Approval State in PostgreSQL & Laravel**
  - *Chosen Approach*: Add an `approval_status` column (`'approved' | 'pending'`) on `channel_user` (auto-migrated via `ALTER TABLE channel_user ADD COLUMN IF NOT EXISTS approval_status VARCHAR(24) NOT NULL DEFAULT 'approved'`). Existing members and Course Admins default to `'approved'`, while students joining via **Browse Course Hubs** insert with `approval_status = 'pending'` until approved by a Course Admin.
  - *Why*: Persists join requests across refreshes and sessions in PostgreSQL while keeping active roster queries (`approval_status = 'approved'`) fast and accurate.
- **Decision 3: Context-Aware Announcement Modal (`campus_wide` vs. `course_hub`)**
  - *Chosen Approach*: Open the announcement modal in `'campus_wide'` mode when triggered from **Dashboard** or **All Announcements** (restricted to `dept_head`), and in `'course_hub'` mode when triggered from a Course Hub's **Noticeboard Feed** (available to Faculty/Instructors).
  - *Why*: Enforces the organizational boundary between university/department-wide memos and course-level instructor updates.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        Browser Tab & App Metadata                            │
│  • Favicon / Apple Touch Icon -> /assets/aistudio/image_07899ab9.png         │
└──────────────────────────────────────────────────────────────────────────────┘
                                       │
         ┌─────────────────────────────┴─────────────────────────────┐
         ▼                                                           ▼
┌─────────────────────────────────────────┐   ┌─────────────────────────────────────────┐
│     Scoped Course Hub & Join Gate       │   │   Dual-Scope Announcement Architecture  │
│                                         │   │                                         │
│ 1. Unenrolled Guard:                    │   │ 1. All Announcements / Dashboard:       │
│    • Active channel resolves ONLY from  │   │    • Only Dept Head can create          │
│      approved joined hubs (`roster`)    │   │    • No section scope selector          │
│    • Hides chat, feed & Class FAQs      │   │    • Multi-department tag selection     │
│      when `activeChannel === undefined` │   │    • Shows Campus-Wide + Joined Course  │
│                                         │   │      announcements                      │
│ 2. Browse Course Hubs Join Request:     │   │                                         │
│    • Student clicks "Request to Join"   │   │ 2. Course Hub Noticeboard Feed:         │
│    • Stored in `channel_user` with      │   │    • Instructors / Faculty can create   │
│      `approval_status = 'pending'`      │   │      multiple announcements for their   │
│                                         │   │      handled Course Hub(s)              │
│ 3. Course Admin Roster & Approval:      │   │    • Feed shows ONLY announcements      │
│    • Only Course Admins see "+ Add      │   │      for that specific Course Hub       │
│      Member" & "Pending Join Requests"  │   │                                         │
│    • Approve -> `approval_status =      │   │ 3. Announcement Card Header:            │
│      'approved'`                        │   │    • Subtitle under Title displays      │
│    • Decline -> removes pending row     │   │      publisher's Department             │
└─────────────────────────────────────────┘   └─────────────────────────────────────────┘
```

- **Data Model & State**:
  - `Channel`: Includes `roster: ChannelMember[]` (approved members) and `pending_requests?: ChannelMember[]` (users awaiting Course Admin approval).
  - `Announcement`: `channel_id` is `0` / campus-level (or flagged with `CAMPUS_WIDE` metadata) for Department Head campus-wide notices, and set to the specific Course Hub `id` for instructor course notices. Under the card's title, the subtitle displays the publisher's department (e.g., `CITC Department` or `CEA Department`).
- **Interactive Component & State Mapping**:
  - **Browse Course Hubs Modal**: Displays `Request to Join` for unenrolled students, `Pending Approval` when a request is awaiting Course Admin action, and `Joined / Open Hub` once approved (Course Admins who click Join are approved immediately).
  - **Course Hub Settings & Roster Popover**: Hides the `+ Add Member` form and member removal buttons for non-admins; displays a **Pending Join Requests** section for Course Admins with **Approve** and **Decline** buttons.
  - **Announcement Form Modal**: Adapts between Campus-Wide mode (no section selector, multi-department tags, `dept_head` only) and Course Hub mode (locked to the current Course Hub or multi-select across the instructor's handled Course Hubs).
