# ClariFy — Frontend Team Plan, Collaboration Guide & API Integration Playbook

> **Project:** ClariFy (formerly USTP Connect) — Unified Campus Noticeboard & Scoped Communication Platform
>
> **Course & Section:** IT314 Software Engineering — IT3R2 Group 5 (USTP-CDO)
>
> **SDLC Model:** Agile Development (2-Week Sprint & Stakeholder Feedback Cycles)
>
> **Architecture:** Decoupled Client-Server via RESTful API
>
> **Backend Stack:** Laravel 13 REST API + PostgreSQL + Queue Workers (Push & SMS Fallback)
>
> **Frontend Stack:** Next.js (Web Portal & Admin Console) + React Native with Expo (Mobile App)

## Purpose of This Document

This playbook is the **single source of truth** for the ClariFy development team (**Flores, Abuga-a, Aparici, Justiniani, and Sambajon**). It is designed for **both human developers and AI coding assistants** (such as Cursor, GitHub Copilot, Claude, ChatGPT, and Gemini).

Every developer and AI tool working on this repository must follow the role boundaries, folder structures, naming rules, Git workflows, and Laravel 13 API contracts defined below. **Do not invent features, endpoints, database fields, or UI screens that are not documented here.**

## 1. Documented Facts vs. Missing Details & Assumptions

To prevent wasted effort and AI hallucinations, our team distinguishes between what is **explicitly confirmed** in our Software Requirements Analysis & System Design PDF and what is **missing or assumed**.

### 1.1 Confirmed Project Requirements (Source of Truth)

* **User Roles (`FR-09`, Class Diagram):** `student`, `faculty` (Instructor), `dept_head` (Department Chair / Dean), and `it_admin` (IT Administrator).

* **Core Functional Requirements:**

  * `FR-01_REV`: Automated 24-hour midnight batch sync (plus manual IT Admin trigger) with the USTP PRISMS database to auto-enroll users into role-scoped channels by college, department, program, and year level (`TC-FR01`).

  * `FR-02` & `Workflow 2`: Scoped announcement publishing. Instructors can only publish inside their assigned Course Hubs; university-wide or college-wide memos are restricted to Department Heads/Deans/Admins (`TC-FR02`). Supports drafts/archives, file/image attachments (`attachmentURL`), urgent pinning, push notifications, and offline SMS fallback.

  * `FR-03_REV` & `Workflow 4`: Isolated, collapsible Q&A discussion threads/tickets where students submit academic inquiries (with optional **private** visibility flag per Stakeholder Review Table E), edit/delete their own messages (`Workflow 3 Activity Diagram`), and instructors reply and toggle `Resolved` (`TC-FR03`).

  * `FR-04_REV` & `Workflow 3`: Read-only chronological noticeboard feed for students (no "Create Post" or delete buttons), with urgent notices pinned at the top (`TC-FR04`) and a live **Read Reach** acknowledgment counter (`0/42` / `"Mark as Read / Acknowledge"` button shown in MVP screenshots).

  * `FR-05`: Search and filter announcements by course code (e.g., `ES211a`, `IT314`), department (`CITC`, `CEA`, `COT`, `CSM`), year level, or tags (`URGENT NOTICE`, `OFFICIAL MEMO`, `CDO CAMPUS`, `MEMORANDUM`), plus sorting and pagination (`TC-FR05`).

  * `FR-06`: Profile settings allowing Students and Faculty to update their profile picture and contact number (`TC-FR06`).

  * `FR-07` & `Workflow 4`: 1-Click FAQ compilation (`Pin Ticket` / `Publish to FAQ`) that publishes a resolved student inquiry and instructor reply to the channel's Class FAQ board while masking the student's identity as `"Anonymous Student"` (`TC-FR07`).

  * `FR-08`, `FR-09`, `FR-10` & `Workflow 6`: IT Admin capabilities to verify/approve user accounts against registrar data (`TC-FR08`), assign/modify/revoke user roles (`TC-FR09`), trigger/monitor PRISMS database sync logs (`TC-FR10`), and monitor system performance metrics (`Workflow 5 Activity Diagram`).

* **Confirmed Non-Functional Requirements:**

  * `NFR-01_REV`: Role-Based Access Control (RBAC) + encrypted session tokens (JWT/Bearer), returning `HTTP 403 Forbidden` when a Student token attempts to create an announcement (`TC-NFR01`).

  * `NFR-02`: Urgent push alert delivery within $\le 2.0\text{ seconds}$ (`TC-NFR02`) + low-bandwidth SMS broadcast fallback during severe weather suspensions (`Table E`).

  * `NFR-03_REV`: Immutable `announcement_audits` logging every edit, editor ID, and timestamp, displaying an `(Edited)` badge and revised timestamp in the UI (`TC-NFR03`).

  * `NFR-04_REV`: USTP Design System compliance (`#1a1851` Navy, `#fcb315` Gold, `#ff9718` Orange, `#FFFAF2` Cream, `#031c2e` Dark Text), ensuring core tasks take $\le 3\text{ clicks}$ (`TC-NFR04`).

  * `NFR-05`: Compliance with the Philippine Data Privacy Act of 2012 (RA 10173) (`TC-NFR05`).

### 1.2 What Is Missing or Ambiguous in the PDF

1. **Missing Wireframes for IT Admin Panel (`FR-08`, `FR-09`, `FR-10`, `Workflow 5/6`):** The requirements and sequence diagrams mandate an `AdminDashboardUI`, but the Figma wireframes only depict Student and Faculty screens.

2. **Missing Wireframes for Account Registration (`FR-08`) & Profile Settings (`FR-06`):** `TC-FR08` references submitting a new account registration for IT Admin verification, and `TC-FR06` requires a screen to upload a profile picture and update a contact number, neither of which is drawn in the Figma wireframes.

3. **Evolution from "Chat Bubbles" to "Isolated Q&A Cards":** Earlier wireframes (Sept 12–30) show a free-form chat bubble list (`Messages` tab) alongside a slide-over `Create Ticket` panel, whereas `FR-03_REV` and the October 22 Web MVP screenshots replace free-form chat with structured `Noticeboard Feed` and `Isolated Q&A Threads` tabs inside each Course Hub.

4. **Placeholder UI Elements in Wireframes & MVP:** The wireframes include two orange sidebar links labeled `"idk +"` (Wireframe PDF pp. 2–4), and the MVP screenshots include an `"Export Day 7 Data"` button and top-right demo role-switcher buttons (`Student View (Kobeni)` / `Faculty View (Aki)`).

### 1.3 Clearly Labeled Assumptions & Sensible Defaults

* **\[ASSUMPTION 1 — Web vs. Mobile Scope\]:** Because 4 frontend developers are splitting both Web (Next.js) and Mobile (React Native Expo), **Web (`clarify-web`)** is the primary platform for all 4 roles (including the IT Admin Dashboard), while **Mobile (`clarify-mobile`)** focuses on Student and Faculty workflows (Login, Scoped Noticeboard Feed, Push Alerts, Q&A Ticketing/FAQs, and Instructor Directory), matching the Mobile Wireframes on page 80/104 of the PDF.

* **\[ASSUMPTION 2 — Course Hub Q&A UI\]:** We default to the **October 22 Web MVP design** (tabbed `Noticeboard Feed` + `Isolated Q&A Threads` + right-hand `Class FAQs` panel) as the canonical implementation of `FR-03_REV` and `FR-04_REV`, rather than an open group chat stream, because `FR-04_REV` explicitly prohibits casual chat noise from burying announcements.

* **\[ASSUMPTION 3 — Token Mechanism\]:** To satisfy both `NFR-01_REV` ("encrypted JSON Web Tokens (JWT)") and `TC-NFR01` ("Student bearer token"), the Laravel 13 backend will issue Bearer tokens (`Authorization: Bearer <token>`) with role/scope claims that work identically for Next.js and React Native Expo.

## 2. Division of Frontend Work (4 Frontend Teammates + 1 Backend Lead)

To prevent merge conflicts, no two frontend developers will edit the same page routes at the same time. Each frontend developer owns a vertical feature domain across the UI and integrates with specific Laravel 13 controllers.

> **Note on Team Roster:** Group 5 consists of **Zyra Nadine Flores, Zild Jan Abuga-a, Archelle Aparici, Jonathan Justiniani, and Jazir Uzman Sambajon**. Fill in the assigned teammate names in the table below during Sprint 1 kickoff (for example, the PDF notes that *Archelle Aparici* authored the Figma wireframes and *Jonathan Justiniani* deployed the `ClariFy_MVP` web prototype).

| Role ID | Assigned Teammate | Primary Ownership Domain | Mapped Requirements & Workflows | Target Backend Controllers | 
| ----- | ----- | ----- | ----- | ----- | 
| **Backend Lead** | *\[Jonathan\]* | **Laravel 13 API, PostgreSQL, Queues, PRISMS Sync, Push/SMS & RBAC** | All Server-Side Logic (`FR-01`–`FR-10`, `NFR-01`–`NFR-05`) | All Controllers, Policies, Models & Jobs | 
| **Frontend Dev 1 (FE-1)** | *\[Archelle\]* | **Design System, App Shell, Auth, Profile & Channel Navigation** | `FR-01_REV`, `FR-06`, `NFR-01_REV`, `NFR-04_REV`, Workflows 1 & 5 | `AuthController`, `ProfileController`, `ChannelController` | 
| **Frontend Dev 2 (FE-2)** | *\[Zyra\]* | **Scoped Noticeboard Feed, Publisher Modal, Search/Filter, Read Reach & Audit UI** | `FR-02`, `FR-04_REV`, `FR-05`, `NFR-03_REV`, Workflows 2 & 3 | `AnnouncementController` | 
| **Frontend Dev 3 (FE-3)** | *\[Jazir Uzman Sambajon\]* | **Isolated Q&A Threads, Inquiry Ticketing, 1-Click Class FAQs & Instructor Directory** | `FR-03_REV`, `FR-07`, `NFR-05` (Anonymity), Workflow 4 + Instructor Grid | `ThreadController`, `FaqController`, `InstructorController` |
| **Frontend Dev 4 (FE-4)** | *\[Zild\]* | **IT Admin Console (Web) & Mobile App Adaptation / Push Integration (Expo)** | `FR-08`, `FR-09`, `FR-10`, `NFR-02`, Workflow 6 + Mobile Shell/Push | `AccountController`, `SyncController`, `DeviceTokenController` | 

### Detailed Responsibilities & Deliverables by Teammate

#### Frontend Dev 1 (FE-1): Design System, Auth, Profile & Scoped Channels (`Workflows 1 & 5`)

* **Responsibilities:**

  1. Set up the shared USTP Design System tokens (`#1a1851` Navy, `#fcb315` Gold, `#ff9718` Orange, `#FFFAF2` Cream, `#031c2e` Dark Text) in Tailwind CSS (`clarify-web`) and NativeWind (`clarify-mobile`).

  2. Build the **Universal Login View** (`LoginInterface`) and registration/verification pending state, storing the auth session token and routing users to their role-specific dashboard (`Workflow 1`).

  3. Build the **3-Column Desktop App Shell** (Left: `Scoped Channels` sidebar; Center: dynamic workspace; Right: collapsible orange `User Profile` & navigation drawer) ensuring all core features are reachable within $\le 3\text{ clicks}$ (`NFR-04_REV`).

  4. Build **Channel Management UI** (`ChannelPortalUI` for `Workflow 5`): browsing/searching channels, requesting to join a channel, creating a channel (Faculty/Admin only), and adding/removing channel roster members.

  5. Build **User Profile Settings (`FR-06`)**: modal/page to upload a new profile picture (`multipart/form-data`) and update the user's mobile contact number (for SMS fallback).

* **Expected Deliverables:**

  * Reusable UI primitives (`Button`, `Badge`, `Modal`, `Input`, `Skeleton`, `EmptyState`, `ErrorBanner`).

  * `src/app/(auth)/login/page.tsx` and auth route-guard middleware (`src/middleware.ts`).

  * `ScopedChannelsSidebar`, `CollapsibleProfileDrawer`, `ChannelRosterModal`, and `ProfileSettingsModal`.

#### Frontend Dev 2 (FE-2): Noticeboard Feed, Scoped Publisher, Filtering & Read Reach (`Workflows 2 & 3`)

* **Responsibilities:**

  1. Build the **Student & Faculty Dashboard Overview** ("Welcome back!" banner, Latest Announcements preview cards, and Latest Messages summary list shown in Wireframes pp. 2 & 5).

  2. Build the **Pinned & Chronological Noticeboard Feed** (`StudentDashboardFeed` / `FR-04_REV`): display `URGENT NOTICE` pinned posts at the top, followed by chronological notices. Hide all create/edit/delete controls when `user.role === 'student'` (`TC-FR04`).

  3. Build the **Announcement Card** with category/scope tags (`OFFICIAL MEMO`, `CITC`, `CDO CAMPUS`, `URGENT NOTICE`), attachment preview/download (`attachmentURL`), the `(Edited)` badge with revised timestamp tooltip (`NFR-03_REV` / `TC-NFR03`), and the student **"Mark as Read / Acknowledge"** button that updates the channel's live `Read Reach (0/42)` progress bar.

  4. Build the **Faculty Create / Edit Announcement Modal** (`CourseHubConsole` / `FR-02`): title, body, target course/section/year-level scope selector, tag picker, file/photo attachment uploader, `Save as Draft` toggle (`Workflow 4 Activity Diagram`), `Mark as Urgent (Pin + Push Alert)` toggle, and `Trigger Offline SMS Fallback` checkbox (`Workflow 2`).

  5. Build the **Search, Tag Filter & Sort Bar (`FR-05`)**: keyword/course-code search input (e.g., `"ES211a"`), department/organization tag filters, sort dropdown, and pagination controls (`<< 1 2 ... 10 >>`).

* **Expected Deliverables:**

  * `DashboardHomeView`, `NoticeboardFeed`, `AnnouncementCard`, `AnnouncementFilterBar`, and `AnnouncementFormModal`.

#### Frontend Dev 3 (FE-3): Isolated Q&A Threads, Ticketing, 1-Click FAQs & Instructor Directory (`Workflow 4`)

* **Responsibilities:**

  1. Build the **Isolated Q&A Threads View** (`DiscussionFeedUI` / `FR-03_REV`): collapsible thread cards displaying the inquiry hashtag/subject (`#Defence`, `#grade_consultation`), author name (or `"Anonymous Student"`), timestamp, inquiry body, nested `Faculty Reply` block, `RESOLVED` badge, and `* Pinned to Class FAQs` indicator (matching MVP screenshots on pp. 105–106).

  2. Build the **Student Inquiry Submission Panel (`Create Ticket`)**: slide-over drawer or modal allowing students to enter a subject hashtag/title, question text, and a **"Make Inquiry Private (Visible only to Instructor)"** checkbox (`Table E`, p. 22), plus Edit/Delete controls for the student's own un-resolved message (`Workflow 3 Activity Diagram`, p. 33).

  3. Build the **Faculty Reply & Resolution Controls (`Answer Ticket`)**: reply text box, `"Mark as Resolved"` toggle (`TC-FR03`), and the 1-click **"Pin Ticket / Publish to Class FAQs"** action (`FR-07`, `TC-FR07`).

  4. Build the **Right-Sidebar Class FAQs Accordion (`1-Click Converted`)**: displays compiled channel FAQs with anonymized student identities (`Workflow 4`).

  5. Build the **View Instructors Directory** (Wireframes pp. 3 & 6): searchable, sortable, paginated grid of verified faculty cards showing avatar, name, campus, and department badge.

* **Expected Deliverables:**

  * `QaThreadList`, `QaThreadCard`, `CreateInquiryDrawer`, `FacultyReplyPanel`, `ClassFaqSidebar`, and `InstructorDirectoryGrid`.

#### Frontend Dev 4 (FE-4): IT Admin Console (Web) & Mobile App Adaptation / Push Integration (`Workflow 6` & `NFR-02`)

* **Responsibilities:**

  1. Build the **IT Administrator Panel (`AdminDashboardUI`)** in Next.js using the shared USTP Design System components from FE-1:

     * **Account Verification Queue (`FR-08`, `TC-FR08`):** Table of pending Student/Faculty accounts to cross-check against registrar credentials with `Approve / Verify` and `Reject` actions.

     * **RBAC Role Management (`FR-09`, `TC-FR09`):** Searchable user directory allowing IT Admins to assign, modify, or revoke roles (`student`, `faculty`, `dept_head`, `it_admin`) and department scopes.

     * **PRISMS Database Synchronization Console (`FR-10`, `Workflow 6`, `TC-FR10`):** Input for `semester_code`, `"Trigger Manual PRISMS Sync"` button, sync summary stats (`total_updated`), and a table of sync history/error logs.

     * **System Performance & Audit Log Monitor (`Workflow 5 Activity Diagram`, `NFR-03_REV`):** Read-only view of system metrics (active users, push queue latency, SMS batch status) and the immutable `announcement_audits` history.

  2. Coordinate the **React Native Expo Mobile App (`clarify-mobile`)**:

     * Set up Expo Router drawer/tab navigation matching the Mobile Wireframes (Universal Login, Burger Drawer, Mobile Feed, Create/Answer Ticket, View Instructors).

     * Integrate `expo-notifications` (`DeviceTokenController`) to register device push tokens on login and verify end-to-end urgent push alert receipt in $\le 2.0\text{ seconds}$ (`NFR-02`, `TC-NFR02`).

* **Expected Deliverables:**

  * `src/app/(dashboard)/admin/verifications/page.tsx`, `users/page.tsx`, `sync/page.tsx`, and `metrics/page.tsx`.

  * Expo mobile screens in `clarify-mobile/src/app/` and native push notification registration hook (`usePushNotifications.ts`).

## 3. Team Workflow: Coordinating Tasks, Reviews & Blockers

Because we follow an **Agile SDLC with 2-week feedback cycles**, we use the following workflow to prevent duplicated effort and integration bottlenecks:

### 3.1 Avoiding Duplicated Effort

1. **Shared Component Rule:** Only **FE-1** creates base UI primitives inside `src/components/ui/`. If FE-2, FE-3, or FE-4 needs a new shared component, they request it in the group chat or build it inside their own feature folder (`src/components/announcements/`, `src/components/threads/`, `src/components/admin/`) first.

2. **Type-First Contract Rule:** All TypeScript interfaces for API requests and responses live in `src/types/api.ts`. Nobody writes inline `any` types or invents custom JSON property names inside components.

3. **Mock-First Parallel Development:** Frontend developers **never wait idly** for a Laravel 13 endpoint to be finished. At the start of each 2-week sprint, the Backend Lead and Frontend Devs agree on the endpoint URL and JSON shape in `src/types/api.ts`. Frontend developers use mock JSON fixtures (`src/mocks/`) until the Laravel endpoint is marked `Ready` by the Backend Lead.

### 3.2 Task Tracking & 2-Week Sprint Rhythm

* **Board Columns (GitHub Projects / Trello):** `Backlog` $\rightarrow$ `API Contract Defined` $\rightarrow$ `In Progress (UI/Backend)` $\rightarrow$ `Ready for API Integration` $\rightarrow$ `In PR Review` $\rightarrow$ `Done (Ready for 2-Week User Testing)`.

* **Sprint Priorities (from Table B of Requirements Analysis):**

  * **Sprint 1 (High Priority Core):** Auth & JWT (`NFR-01_REV`), App Shell & Design System (`NFR-04_REV`), Scoped Channels (`FR-01_REV`), Read-Only Pinned Feed & Scoped Publishing (`FR-02`, `FR-04_REV`), and IT Admin Verification/RBAC/PRISMS Sync (`FR-08`, `FR-09`, `FR-10`).

  * **Sprint 2 (High/Medium Priority Q&A & Audits):** Isolated Q&A Threads (`FR-03_REV`), 1-Click Anonymized FAQs (`FR-07`), Announcement Edit Audit Trail (`NFR-03_REV`), and Search/Filtering (`FR-05`).

  * **Sprint 3 (Medium Priority Mobile, Push/SMS & Polish):** Profile Settings (`FR-06`), View Instructors Grid, Expo Mobile screens, $\le 2.0\text{s}$ Push Notifications & SMS Fallback (`NFR-02`), and 3-click usability testing (`TC-NFR04`).

### 3.3 Code Review & Pull Request Process

* **Branch Protection:** Direct pushes to `main` and `develop` are disabled. All work happens in feature branches.

* **Review Matrix:**

  * UI-only PRs require **1 review from another Frontend Dev** (checking USTP Design System colors, responsive layout, loading/error states, and zero TypeScript errors).

  * API-integration PRs require **1 review from the Backend Lead** (verifying that endpoint paths, query params, HTTP methods, and error handling match the Laravel 13 routes and policies).

### 3.4 Handling Questions & Blockers (The 30-Minute Rule)

* If a developer is stuck on a bug, CORS error, or unclear requirement for **more than 30 minutes**, they must post in the Group 5 dev channel using this template:

  * **Context:** Which screen/requirement (`e.g., FR-03_REV Q&A Reply`) and branch name.

  * **Expected vs. Actual:** What the UI or API should do vs. the exact HTTP status code / console error.

  * **Question / Needed Action:** Whether they need a backend payload adjustment, a route fix, or a team design decision.

## 4. Separated Project File Structure

To keep the **Laravel 13 Backend**, **Next.js Web Portal**, and **React Native Expo Mobile App** cleanly isolated while sharing one repository (or organized side-by-side), follow this exact directory layout:

```
clarify-ustp/
├── README.md
├── FRONTEND_TEAM_PLAYBOOK.md          # <-- This file (Read by humans & AI tools)
│
├── clarify-api/                       # [BACKEND LEAD] Laravel 13 RESTful API
│   ├── app/
│   │   ├── Console/Commands/
│   │   │   └── SyncPrismsRoster.php   # Automated 24h midnight PRISMS sync (FR-01_REV)
│   │   ├── Http/
│   │   │   ├── Controllers/Api/V1/
│   │   │   │   ├── AuthController.php         # Workflow 1: Login, Logout, Me
│   │   │   │   ├── AnnouncementController.php # Workflows 2 & 3: Feed, Publish, Edit, Read Reach
│   │   │   │   ├── ThreadController.php       # Workflow 4: Inquiries, Replies, Resolve, 1-Click FAQ
│   │   │   │   ├── ChannelController.php      # Workflow 5: Scoped Channels, Join, Roster CRUD
│   │   │   │   ├── AccountController.php      # Workflow 6: Verify Users, RBAC Roles, PRISMS Sync
│   │   │   │   ├── ProfileController.php      # FR-06: Avatar upload & contact number update
│   │   │   │   └── InstructorController.php   # Directory of verified faculty members
│   │   │   ├── Middleware/
│   │   │   │   ├── EnsureAccountVerified.php  # Blocks unverified accounts (FR-08)
│   │   │   │   └── EnforceChannelScope.php    # Enforces CITC/CEA/Course Hub boundaries (FR-01)
│   │   │   ├── Requests/                      # FormRequest validation classes (returns HTTP 422)
│   │   │   └── Resources/                     # JSON serializers (ThreadResource masks FAQ authors)
│   │   ├── Jobs/
│   │   │   ├── DispatchUrgentPushAlerts.php   # Queued push alert <= 2.0s (NFR-02)
│   │   │   └── TriggerSmsFallbackBatch.php    # Queued SMS broadcast for suspensions (NFR-02)
│   │   ├── Models/
│   │   │   ├── User.php
│   │   │   ├── AcademicProfile.php
│   │   │   ├── Channel.php
│   │   │   ├── Announcement.php
│   │   │   ├── AnnouncementAudit.php          # Append-only audit table (NFR-03_REV)
│   │   │   ├── AnnouncementRead.php           # Tracks 0/42 Read Reach acknowledgments
│   │   │   └── Message.php                    # Threaded inquiries & replies (FR-03_REV)
│   │   ├── Observers/
│   │   │   └── AnnouncementObserver.php       # Auto-writes to announcement_audits on update
│   │   └── Policies/
│   │       └── AnnouncementPolicy.php         # Blocks Students (HTTP 403) & checks Faculty course scope
│   ├── database/migrations/
│   └── routes/api.php                         # All /api/v1/* endpoints
│
├── clarify-web/                       # [FE-1, FE-2, FE-3, FE-4] Next.js Web Application
│   ├── src/
│   │   ├── app/
│   │   │   ├── (auth)/
│   │   │   │   └── login/page.tsx             # [FE-1] Universal Login View
│   │   │   ├── (dashboard)/
│   │   │   │   ├── layout.tsx                 # [FE-1] 3-Col Shell: Left Channels + Right Profile Drawer
│   │   │   │   ├── page.tsx                   # [FE-2] Dashboard Overview ("Welcome back!")
│   │   │   │   ├── announcements/page.tsx     # [FE-2] Global/Scoped Noticeboard & Search/Filter
│   │   │   │   ├── channels/[channelId]/
│   │   │   │   │   └── page.tsx               # [FE-2 & FE-3] Course Hub: Noticeboard & Q&A Tabs + FAQs
│   │   │   │   ├── instructors/page.tsx       # [FE-3] View Instructors Directory Grid
│   │   │   │   ├── settings/page.tsx          # [FE-1] FR-06 Profile Picture & Contact Number
│   │   │   │   └── admin/                     # [FE-4] IT Administrator Console
│   │   │   │       ├── verifications/page.tsx # FR-08 Registrar Account Verification
│   │   │   │       ├── users/page.tsx         # FR-09 RBAC Role Assignment
│   │   │   │       ├── sync/page.tsx          # FR-10 PRISMS Sync Trigger & Logs
│   │   │   │       └── metrics/page.tsx       # Workflow 5 System Metrics & Audit Trail
│   │   ├── components/
│   │   │   ├── ui/                            # [FE-1] Shared USTP Design System primitives
│   │   │   ├── layout/                        # [FE-1] Sidebar, Topbar, ProfileDrawer, ChannelModals
│   │   │   ├── announcements/                 # [FE-2] AnnouncementCard, FilterBar, PublishModal
│   │   │   ├── threads/                       # [FE-3] QaThreadCard, InquiryDrawer, ClassFaqSidebar
│   │   │   ├── instructors/                   # [FE-3] InstructorCard, InstructorFilter
│   │   │   └── admin/                         # [FE-4] VerificationTable, RoleSelector, SyncLogTable
│   │   ├── lib/
│   │   │   ├── api-client.ts                  # Centralized HTTP wrapper (attaches Bearer token)
│   │   │   └── constants.ts                   # USTP colors, role constants, tag enums
│   │   ├── hooks/                             # Custom data-fetching hooks (useAnnouncements, etc.)
│   │   ├── mocks/                             # Mock JSON responses for parallel UI work
│   │   ├── types/
│   │   │   └── api.ts                         # Single source of truth for API TypeScript interfaces
│   │   └── middleware.ts                      # Role-based route protection
│   └── tailwind.config.ts
│
└── clarify-mobile/                    # [FE-4 + FE-1/2/3] React Native (Expo) Mobile App
    ├── src/
    │   ├── app/
    │   │   ├── (auth)/login.tsx               # Mobile Universal Login
    │   │   └── (drawer)/                      # Mobile Burger Menu Navigation
    │   │       ├── index.tsx                  # Mobile Dashboard ("Welcome back!")
    │   │       ├── announcements.tsx          # Mobile Noticeboard + Faculty Create Notice
    │   │       ├── instructors.tsx            # Mobile View Instructors Grid
    │   │       └── channels/[channelId].tsx   # Mobile Course Hub, Create Ticket, Answer/Pin Ticket
    │   ├── components/                        # Mobile UI components styled with NativeWind
    │   ├── lib/api-client.ts                  # Uses expo-secure-store for Bearer token
    │   └── types/api.ts                       # Synced copy of clarify-web/src/types/api.ts
    └── app.json

```

## 5. Shared Coding, Git & Collaboration Conventions

### 5.1 Naming & Formatting Conventions

* **Language:** Strict TypeScript (`strict: true`) across both `clarify-web` and `clarify-mobile`. Never use `any`.

* **Components & Files:**

  * React Components: `PascalCase` (`AnnouncementCard.tsx`, `ClassFaqSidebar.tsx`).

  * Hooks: `camelCase` prefixed with `use` (`useChannelThreads.ts`, `useAuthSession.ts`).

  * Utilities & API services: `kebab-case` (`api-client.ts`, `format-date.ts`).

* **Variables & JSON Properties:**

  * Frontend local variables/props: `camelCase` (`isUrgent`, `channelId`, `readReachCount`).

  * API Request & Response JSON keys: **`snake_case`** (`is_urgent`, `channel_id`, `attachment_url`, `is_pinned_faq`) to match Laravel 13 Eloquent attributes and PostgreSQL columns directly without error-prone key-remapping layers.

* **USTP Design System Tokens (`tailwind.config.ts`):**
  Always use semantic Tailwind classes mapped to our wireframe palette (Page 1 of Wireframe PDF)—never hardcode arbitrary hex values inside JSX:

  * `ustp-navy`: `#1a1851` (Primary headers, left channel sidebar, primary action buttons)

  * `ustp-gold`: `#fcb315` ( Brand accents, active badges, secondary highlights)

  * `ustp-orange`: `#ff9718` / `#ff6418` (Right profile drawer, urgent highlights)

  * `ustp-cream`: `#FFFAF2` (Main feed background surface)

  * `ustp-text`: `#031c2e` (Primary body typography)

  * `ustp-blue`: `#0d4a77` & `#329dea` (Department/Course tag pills)

### 5.2 Git Branching, Commits & Pull Requests

* **Branch Naming Format:** `<type>/<role>-<req-id>-<short-description>`

  * Examples:

    * `feat/fe1-fr01-scoped-channels-sidebar`

    * `feat/fe2-fr02-faculty-publish-modal`

    * `feat/fe3-fr07-one-click-faq-conversion`

    * `feat/fe4-fr10-prisms-sync-dashboard`

    * `feat/be-nfr03-announcement-audit-observer`

* **Commit Message Format (Conventional Commits):**

  * `feat(FR-03): add private inquiry checkbox to student ticket drawer`

  * `fix(NFR-03): display edited badge and revised timestamp on announcement card`

  * `chore(types): sync Announcement interface with Laravel 13 Resource`

* **Pull Request Checklist (Required in every PR description):**

  1. Which Requirement ID (`FR-XX` / `NFR-XX`) or Workflow (`1–6`) does this PR implement?

  2. Screenshot or screen recording of desktop/mobile view.

  3. Confirmation that **Loading**, **Empty**, **Validation Error (`422`)**, and **Permission Denied (`403`)** states are handled.

## 6. API Integration Expectations & Contract

All frontend requests target the Laravel 13 base URL defined in environment variables:

* Next.js (`.env.local`): `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api/v1`

* Expo (`.env`): `EXPO_PUBLIC_API_BASE_URL=http://<LOCAL_LAN_IP>:8000/api/v1`

### 6.1 Required Request Headers & Authentication (`NFR-01_REV`)

Every HTTP request to Laravel 13 **must** include `Accept: application/json` so Laravel always returns structured JSON errors instead of HTML redirects:

```
Accept: application/json
Content-Type: application/json
Authorization: Bearer <jwt_or_sanctum_token>

```

*(Note: When uploading files for `FR-02` announcement attachments or `FR-06` profile avatars, use `FormData` and let the browser/Expo set the `multipart/form-data; boundary=...` header automatically).*

### 6.2 Standard JSON Response Envelopes (Laravel 13 API Resources)

#### Single Resource / Action Success (`200 OK` or `201 Created`)

```
{
  "message": "Announcement published and push alerts queued.",
  "data": {
    "id": 42,
    "channel_id": 7,
    "title": "CITC Lab Room Reassignment: IT314 moved to CEA",
    "content": "Please be advised that all IT3R2 Software Engineering laboratory consultations...",
    "attachment_url": "https://api.clarify.ustp.edu.ph/storage/memos/lab-move.pdf",
    "tags": ["URGENT NOTICE", "OFFICIAL MEMO", "CDO CAMPUS", "CITC", "MEMORANDUM"],
    "is_urgent": true,
    "is_pinned": true,
    "status": "published",
    "is_edited": true,
    "published_at": "2026-10-22T12:35:00+08:00",
    "updated_at": "2026-10-22T12:50:00+08:00",
    "read_reach": {
      "acknowledged_count": 1,
      "enrolled_total": 42,
      "percentage": 2.4,
      "has_current_user_acknowledged": false
    },
    "publisher": {
      "id": 10492,
      "name": "Aki Hayakawa",
      "role": "faculty",
      "department": "CITC"
    }
  }
}

```

#### Paginated List Response (`200 OK` — Used by `FR-04_REV`, `FR-05`, Instructor Grid, Admin Tables)

```
{
  "data": [ /* Array of Resource Objects */ ],
  "meta": {
    "current_page": 1,
    "last_page": 10,
    "per_page": 10,
    "total": 96
  }
}

```

### 6.3 Error Handling Rules (Validation, Auth & Server Failures)

Frontend components **must never fail silently** or use `console.log(err)` as error handling. All API calls go through `src/lib/api-client.ts` and handle status codes as follows:

1. **`422 Unprocessable Content` (Laravel FormRequest Validation Errors):**
   Laravel 13 returns field-level validation messages in this exact format:

   ```
   {
     "message": "The title field is required. (and 1 more error)",
     "errors": {
       "title": ["The title field is required."],
       "channel_id": ["You are not assigned to publish in this course hub."]
     }
   }
   
   ```

   **Frontend Requirement:** Map `error.errors[fieldName][0]` directly beneath the corresponding form input in red text.

2. **`401 Unauthorized` (Expired or Missing Token):**
   Clear the stored token and redirect the user to `/login` with a toast notification: *"Your session has expired. Please log in again."*

3. **`403 Forbidden` (RBAC or Scope Violation — `NFR-01_REV` / `TC-NFR01`):**
   Display a clear permission error banner/toast (e.g., *"Access Denied: Only authorized faculty assigned to this Course Hub can publish announcements."*). Note: Students must also have publishing buttons hidden in the UI (`FR-04_REV`).

4. **`500 Internal Server Error` / Network Offline Failure:**
   Display a non-destructive `ErrorBanner` with a **"Retry"** button (`Workflow 1 Activity Diagram`). Never crash the React component tree.

### 6.4 Loading & Empty States

* **Loading State:** While a `GET` request is pending, render a layout-matching `Skeleton` component. While a `POST`/`PATCH`/`DELETE` request is pending, disable the submit button and show a spinner (`"Publishing..."`) to prevent duplicate submissions.

* **Empty State:** If `data.length === 0`, display a clear message matching the context (e.g., *"No announcements match your filter tags"* or *"No Class FAQs published for #IT314 SoftEng yet"*).

### 6.5 Complete REST API Endpoint Map (Workflows 1–6)

| Workflow / Req ID | HTTP Method & Endpoint | Request Payload / Query Params | Used By | 
| ----- | ----- | ----- | ----- | 
| **Workflow 1** (`NFR-01_REV`) | `POST /api/v1/auth/login` | `{ "institutional_id": "2020202020", "password": "***" }` | FE-1 (Web) / FE-4 (Mobile) | 
| **Workflow 1** | `POST /api/v1/auth/logout` | *(Bearer Header)* | FE-1 / FE-4 | 
| **Workflow 1** | `GET /api/v1/auth/me` | *(Bearer Header)* $\rightarrow$ Returns `user`, `role`, `academic_profile` | All Devs | 
| **`FR-06`** (`TC-FR06`) | `POST /api/v1/profile` | `FormData`: `contact_number`, `avatar` (File), `_method: "PATCH"` | FE-1 | 
| **Workflow 5** (`FR-01_REV`) | `GET /api/v1/channels` | `?search=&type=course_hub` $\rightarrow$ Scoped channel list | FE-1 | 
| **Workflow 5** | `POST /api/v1/channels` | `{ "name": "#IT314 SoftEng", "description": "...", "channel_type": "course_hub", "scope": {...} }` | FE-1 (Faculty/Admin) | 
| **Workflow 5** | `POST /api/v1/channels/{id}/join` | *(Bearer Header)* $\rightarrow$ Validates access & adds to roster | FE-1 | 
| **Workflow 5** | `POST /api/v1/channels/{id}/members` | `{ "user_id": 123, "action": "add" | "remove" }` | FE-1 (Faculty/Admin) | 
| **Workflow 3** (`FR-04_REV`, `FR-05`) | `GET /api/v1/announcements` | `?channel_id=7&search=ES211a&department=CITC&tag=URGENT&sort=latest&page=1` | FE-2 | 
| **Workflow 2** (`FR-02`, `NFR-02`) | `POST /api/v1/announcements` | `FormData`: `channel_id`, `title`, `content`, `tags[]`, `is_urgent`, `trigger_sms_fallback`, `status` (`published`|`draft`), `attachment` | FE-2 (Faculty/Admin) | 
| **`NFR-03_REV`** (`TC-NFR03`) | `PATCH /api/v1/announcements/{id}` | `{ "title": "...", "content": "...", "is_urgent": true }` $\rightarrow$ Logs audit & sets `is_edited = true` | FE-2 (Faculty/Admin) | 
| **Workflow 4 Act.** | `DELETE /api/v1/announcements/{id}` | *(Bearer Header)* $\rightarrow$ Archives/removes post from feed | FE-2 (Faculty/Admin) | 
| **MVP Read Reach** | `POST /api/v1/announcements/{id}/acknowledge` | *(Bearer Header)* $\rightarrow$ Increments `read_reach.acknowledged_count` | FE-2 (Student) | 
| **Workflow 4** (`FR-03_REV`) | `GET /api/v1/channels/{id}/threads` | `?announcement_id=&status=resolved|open` | FE-3 | 
| **Workflow 4** (`FR-03_REV`, `Table E`) | `POST /api/v1/channels/{id}/threads` | `{ "announcement_id": null, "subject_hashtag": "#Defence", "content": "...", "is_private": false }` | FE-3 (Student) | 
| **Workflow 3 Act.** | `PATCH /api/v1/threads/{id}` / `DELETE` | `{ "content": "..." }` $\rightarrow$ Student edits/deletes own inquiry | FE-3 (Student) | 
| **Workflow 4** (`TC-FR03`) | `POST /api/v1/threads/{id}/replies` | `{ "content": "f2f", "mark_resolved": true, "pin_to_faq": false }` | FE-3 (Faculty) | 
| **Workflow 4** (`FR-07`, `TC-FR07`) | `POST /api/v1/threads/{id}/convert-faq` | *(Bearer Header)* $\rightarrow$ Masks student as `"Anonymous Student"` & pins to Class FAQs | FE-3 (Faculty) | 
| **Wireframes p.3/6** | `GET /api/v1/instructors` | `?search=&department=CITC&sort=name&page=1` | FE-3 | 
| **`FR-08`** (`TC-FR08`) | `GET /api/v1/admin/users/pending` | `?search=&page=1` $\rightarrow$ Lists unverified accounts | FE-4 (IT Admin) | 
| **`FR-08`** (`TC-FR08`) | `PATCH /api/v1/admin/users/{id}/verify` | `{ "verification_status": "approved" | "rejected" }` | FE-4 (IT Admin) | 
| **`FR-09`** (`TC-FR09`) | `PATCH /api/v1/admin/users/{id}/role` | `{ "role": "student" | "faculty" | "dept_head" | "it_admin", "department": "CITC" }` | FE-4 (IT Admin) | 
| **Workflow 6** (`FR-10`, `TC-FR10`) | `POST /api/v1/admin/sync-prisms` | `{ "semester_code": "2026-1ST-SEM" }` $\rightarrow$ Returns `total_updated` & sync log | FE-4 (IT Admin) | 
| **`FR-10` & `NFR-03`** | `GET /api/v1/admin/metrics` | Returns sync logs, system health metrics, and `announcement_audits` | FE-4 (IT Admin) | 
| **`NFR-02`** (`TC-NFR02`) | `POST /api/v1/devices/token` | `{ "expo_push_token": "ExponentPushToken[...]", "platform": "android" | "ios" }` | FE-4 (Mobile) | 

## 7. Process for Coordinating Frontend & Backend Changes

Whenever an endpoint needs a new field, filter parameter, or route change:

1. **Propose the Contract First:** Open a quick issue or message in the team channel titled `[API CHANGE] <Endpoint> — <Reason>`.

2. **Update `src/types/api.ts` and Mock Data:** Before touching UI components, update the TypeScript interface in `clarify-web/src/types/api.ts` (and `clarify-mobile/src/types/api.ts`).

3. **Non-Breaking Additions:** Adding a new optional field to a Laravel 13 `JsonResource` is non-breaking and can be merged immediately by the Backend Lead.

4. **Breaking Changes (Renaming/Removing Fields or Changing Status Codes):** Must be announced in the group chat first, and the Backend Lead will tag the affected Frontend Dev (`FE-1` through `FE-4`) on the PR so both frontend and backend branches merge in sync.

## 8. Rules for AI Coding Tools (Cursor, Copilot, ChatGPT, Claude, Gemini)

> **AI SYSTEM INSTRUCTION:** If you are an AI coding assistant reading this repository, you **must** obey the following constraints on every prompt:

1. **Do Not Invent Requirements or Features:** Only build features traced to `FR-01` through `FR-10`, `NFR-01` through `NFR-05`, Workflows `1–6`, and the wireframes documented in this playbook. Do **not** add unrequested social media features (such as user-to-user direct messaging, emoji reaction bars, student top-level post creation, or grading calculators—our Agile Risk Analysis on page 47 explicitly prohibits scope creep into casual chat or grading tools).

2. **Do Not Hallucinate Endpoints or JSON Keys:** Only call the exact `/api/v1/...` endpoints listed in **Section 6.5** and use the `snake_case` property names defined in `src/types/api.ts`. If a required field is missing from `src/types/api.ts`, **stop and ask the developer** before writing the fetch logic.

3. **Enforce Role-Based UI & Security Boundaries (`FR-04_REV`, `FR-07`, `NFR-01_REV`):**

   * Never render "Create Announcement", "Edit", "Delete", "Resolve", or "Pin to FAQ" buttons for users with `role === 'student'`.

   * Never expose the original `sender_id` or student name on public Class FAQ items (`is_pinned_faq === true`); always display `"Anonymous Student"` (`Workflow 4`).

4. **Respect Folder & Role Ownership:** Place new files strictly inside the directories shown in **Section 4**. Do not install new npm UI libraries, state managers, or CSS frameworks without explicit developer approval.

5. **Always Include All 4 UI States:** Every data-driven component generated by AI must include: (a) `Skeleton` loading state, (b) `ErrorBanner` with retry button, (c) `EmptyState` when the array is empty, and (d) populated data state using USTP Design System colors.

## 9. Open Questions for the Team to Resolve Before Sprint 1 Implementation

Before writing production code, our 5-member team should take 15 minutes to confirm and lock in answers to these **6 open questions** arising from gaps in our PDF documentation:

1. **Final Teammate-to-Role Mapping:** For this implementation, the mapping is **Jonathan Justiniani (Backend Lead), Archelle Aparici (FE-1), Zyra Nadine Flores (FE-2), Jazir Uzman Sambajon (FE-3), and Zild Jan Abuga-a (FE-4)**.

2. **Account Onboarding Flow (`FR-08` vs. `FR-01_REV`):** Does a new user fill out a **Self-Registration Sign-Up form** on the Login screen that goes into the IT Admin verification queue (`TC-FR08`), OR are accounts pre-imported via PRISMS (`FR-01_REV`) and held in an `"Unverified"` state until the IT Admin approves them?

3. **Course Hub Discussion Layout (Chat Stream vs. Q&A Thread Cards):** Do we completely retire the early Sept wireframe's free-form chat bubble window in favor of the **October 22 MVP's `Noticeboard Feed` + `Isolated Q&A Threads` tabs** (pp. 105–106), or do we keep both? *(Recommendation: Use the Oct 22 MVP tabbed layout, as it directly satisfies `FR-03_REV` and `FR-04_REV`).*

4. **Route URI for `TC-NFR01`:** Table D (`TC-NFR01`, p. 20) mentions `POST /api/announcements/create`, while standard REST conventions use `POST /api/v1/announcements`. Should the Laravel 13 backend register an alias route at `/api/announcements/create` so automated or instructor grading scripts running `TC-NFR01` verbatim still receive `HTTP 403 Forbidden`? *(Recommendation: Yes, alias `/api/announcements/create` to `AnnouncementController@store` in `routes/api.php`).*

5. **Wireframe Sidebar Placeholders (`"idk +"` & `"Export Day 7 Data"`):** Should we remove the two `"idk +"` placeholder buttons from the orange profile drawer and remove the `"Export Day 7 Data"` button from the MVP sidebar, or repurpose them (e.g., for `Channel Management` and `Admin Console` links)?

6. **Real-Time Delivery Transport (`NFR-02`** $\le 2.0\text{s}$**):** For the web portal's `"Live Delivery Tracking Active"` and `< 2.0s` urgent alerts, will we use **Laravel Reverb (WebSockets)** or **Firebase Cloud Messaging (FCM) + Expo Push API**?