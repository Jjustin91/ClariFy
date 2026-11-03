# Course Hub CRUD, Opt-In Browse & Join, Accurate Notification Counts & Rich Media Chat

Add Edit and Delete controls for Course Hubs (for both Students and Faculty), remove automatic Course Hub enrollment for new accounts so users join via **Browse Course Hubs**, fix the Q&A and chat notification badges/timestamps so they reflect real database counts, and implement real image, file, and voice-note sending and playback in chat.

## User Review & Critical Decisions

> [!IMPORTANT]
> Confirmed decisions from your answers and requirements:

- **Course Hub Edit & Delete (Students & Faculty)**: Both Students and Faculty will have **Edit** (pencil icon) and **Delete** (trash icon) actions on Course Hubs to update Course Hub details (Course Code, Name, Section, Department, Description) or delete a Course Hub and its sub-channels.
- **No Auto-Enrollment + Working Browse Course Hubs**:
  - Newly registered/verified Students and Faculty will no longer be automatically added to any Course Hub.
  - Creating a Course Hub only enrolls its creator (not the entire section automatically).
  - The left sidebar and Dashboard will display only the Course Hubs the user has joined, while **Browse Course Hubs** lists all campus Course Hubs with working **Join Course Hub** and **Open Hub** buttons.
- **Accurate Notification Counts & Real Timestamps**:
  - Fixes the bug where regular chat messages (`__CHAT__`) were counted as open Q&A threads in `Channel::threads()` (which caused `30` and `30 inquiries` to appear even when there were 0 Q&A threads).
  - Replaces hardcoded `'9+ chats'` and `'30 mins'` with real open Q&A thread counts, real chat message counts, and actual relative timestamps from the latest activity.
- **Working Image Sending, File Sending & Voice Recording**:
  - **Images**: Selecting an image previews the thumbnail and sends an inline image attachment rendered directly inside the chat bubble.
  - **Files**: Selecting a document/file sends a downloadable file card (`<a download>`) inside the chat bubble.
  - **Voice Recording**: Clicking the microphone starts live audio recording (`MediaRecorder`) with a recording timer and stop/send controls, rendering a playable `<audio controls>` element inside the chat bubble.

---

## 1. Overview & Core Concept

- **What It Does**:
  1. Empowers both Students and Faculty to create, edit, and delete Course Hubs, as well as browse and join existing Course Hubs on demand.
  2. Stops auto-enrolling newly created Student and Faculty accounts into default or section Course Hubs.
  3. Calculates accurate notification counts and activity timestamps across the Course Hub sidebar and the Dashboard **Latest Messages** section.
  4. Upgrades the Course Hub chat composer and message stream to support real image uploads, downloadable file attachments, and playable voice recordings.
- **Target Audience / Persona**: USTP Students and Faculty collaborating in Course Hubs.
- **Key Value**: Full lifecycle control over Course Hubs, accurate real-time counters, and rich multimedia messaging.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Edit & Delete Course Hub**:
     - Each Course Hub in the left sidebar (and in the Course Hub header/modal) provides **Edit** and **Delete** buttons for both Students and Faculty.
     - Clicking **Edit** opens the Course Hub Edit form pre-filled with the hub's Course Code, Name, Section, Department, and Description.
     - Clicking **Delete** prompts an inline confirmation and deletes the Course Hub along with its inner sub-channels.
  2. **Opt-In Course Hub Membership & Browse Course Hubs**:
     - A newly registered and approved Student or Faculty member starts with an empty Course Hub list and a prompt to **Browse Course Hubs** or **+ Add Course Hub**.
     - Opening **Browse Course Hubs** displays a search bar and all available Course Hubs on campus, showing a **Join Course Hub** button if not yet joined, or **Joined · Open Hub** if already a member.
  3. **Accurate Sidebar & Dashboard Notifications**:
     - In the left sidebar (`image_18b85ab9.png`), the badge on `Isolated Q&A Threads` and on the Course Hub header counts **only** actual unresolved Q&A threads (hiding the badge when 0).
     - On the Dashboard **Latest Messages** cards (`image_c57263ab.png`), each joined Course Hub displays its real open inquiry count and/or real chat message count (e.g., `2 inquiries`, `5 chats`, or `No messages yet`) along with the actual relative time of the latest message or announcement (e.g., `Just now`, `5m ago`, `2h ago`).
  4. **Multimedia Chat (Image, File & Voice Record)**:
     - **Image Button**: Opens file picker (`image/*`), resizes/encodes the image as a data URL, displays a thumbnail preview in the staging bar, and renders the full image inside the chat bubble.
     - **File Button**: Opens file picker for documents/archives, encodes the file payload, displays the filename + size in the staging bar, and renders a clickable download card in the chat bubble.
     - **Voice Record Button**: Starts live microphone recording with a pulsing red indicator and elapsed timer (`0:04`), lets the user stop and preview the audio clip before sending, and renders an HTML5 `<audio controls>` player inside the chat bubble.
- **Visual Identity & Theme**:
  - Maintains USTP Navy (`#1a1851`), USTP Gold (`#fab417`), USTP Orange (`#ff9718`), and USTP Cream (`#FFFAF2`) with `tabular-nums` on all counters and timers.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Self-Contained JSON/Data-URL Media Encoding in `messages.content`**
  - *Chosen Approach*: Encode chat attachments (compressed images, small documents, and WebM/WAV voice notes) inside structured JSON/tagged payloads within `messages.content`.
  - *Why*: Works immediately across both the Render Laravel API and direct Supabase PostgreSQL without requiring external S3 bucket credentials or destructive database column migrations.
- **Decision 2: Strict Opt-In Course Hub Enrollment**
  - *Chosen Approach*: Remove automatic `channel_user` insertion during account registration, channel creation section-sweeps, and adapter boot syncs. Only the creator is enrolled when creating a hub, and other users join explicitly via `POST /api/v1/channels/{id}/join` in **Browse Course Hubs** (or via manual roster addition).
  - *Why*: Directly fulfills the requirement that newly created students and faculty are not automatically placed in any Course Hub.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:
```
┌──────────────────────────────────────────────────────────────────────────┐
│                     Course Hub Lifecycle & Membership                    │
├────────────────────────────────────┬─────────────────────────────────────┤
│ Registration / Verification        │ Browse Course Hubs Modal            │
│  • Creates User + AcademicProfile  │  • Lists all Campus Course Hubs     │
│  • Zero auto-enrolled channels     │  • [Join Course Hub] -> POST /join  │
│                                    │  • [Open Hub] -> /channels/[id]     │
└────────────────────────────────────┴─────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                 View Messages (/channels/[channelId])                    │
├────────────────────────────────────┬─────────────────────────────────────┤
│ Left Sidebar (Joined Course Hubs)  │ Center Chat & Media Composer        │
│  • [Edit Hub] -> PATCH /channels   │  • Image Picker -> Inline <img>     │
│  • [Delete Hub] -> DELETE /channels│  • File Picker -> Download Card     │
│  • Accurate Q&A Badge ( excludes   │  • Mic Recorder -> <audio controls> │
│    __CHAT__ messages )             │  • Real-time Reverb / SSE sync      │
└────────────────────────────────────┴─────────────────────────────────────┘
```

- **Data Model & State**:
  - **Backend Endpoints (`clarify-api` & `postgres-adapter.ts`)**:
    - `PATCH /api/v1/channels/{id}`: Updates Course Hub `course_code`, `name`, `description`, `scope_college`, `scope_department`, and `scope_section` (accessible to both Students and Faculty).
    - `DELETE /api/v1/channels/{id}`: Deletes the Course Hub and any child sub-channels (`description LIKE '[HUB:{id}]%'`) along with associated messages and announcements (accessible to both Students and Faculty).
    - `POST /api/v1/channels/{id}/join`: Enrolls **only** the requesting user (`activeUser.id`) into the Course Hub (and its parent/sub-channels) without sweeping the entire section.
  - **Channel Resource Fields**:
    - `unread_count`: Count of unresolved root Q&A threads (`parent_id IS NULL AND is_resolved = false AND (subject_hashtag IS NULL OR subject_hashtag != '__CHAT__')`).
    - `chat_messages_count`: Count of chat messages (`parent_id IS NULL AND subject_hashtag = '__CHAT__'`) across the Course Hub and its sub-channels.
    - `latest_activity_preview` & `latest_activity_at`: Computed from the most recent announcement, Q&A thread, or chat message in that Course Hub.
