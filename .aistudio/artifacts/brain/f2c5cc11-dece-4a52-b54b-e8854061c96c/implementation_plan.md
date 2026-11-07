# Rework Course Hub Creation (No Auto `#general` Chat) & Add ClariFy Logo Icon

This plan reworks Course Hubs so creating a Course Hub no longer automatically creates or renders a default `# general` chat channel (opening directly to the **Noticeboard Feed** until custom channels are added), and applies the official ClariFy `C` speech-bubble logo (`/assets/aistudio/image_87b1a0fe.png`) to both the browser tab title favicon and the circular badge on the Login screen.

## User Review & Critical Decisions

> [!IMPORTANT]
> Confirmed design and workflow decisions from your answers:

- **Confirmed Decision 1 (No Automatic `# general` Chat & Default View)**: Creating a Course Hub only provisions the built-in **Noticeboard Feed** and **Isolated Q&A Threads** views, opening **Noticeboard Feed** by default. The **Channels** section starts empty until a user clicks **+ Add Channel** to create a custom chat channel.
- **Confirmed Decision 2 (ClariFy `C` Speech-Bubble Logo Placement)**: Use the uploaded ClariFy `C` speech-bubble icon (`/assets/aistudio/image_87b1a0fe.png`) for both the browser tab favicon (next to the `ClariFy` tab title) and the circular emblem on the right-hand **Institutional Sign In** panel of the Login page.

---

## 1. Overview & Core Concept

- **What It Does**:
  1. Removes the automatic/built-in `# general` chat channel from Course Hubs so Course Hubs stay focused on official announcements (**Noticeboard Feed**) and structured inquiries (**Isolated Q&A Threads**) until custom chat sub-channels are explicitly created.
  2. Sets the ClariFy `C` speech-bubble mark as the web application's browser tab icon and Login screen emblem.
- **Target Audience / Persona**: USTP-CDO students, faculty members, and department heads managing Course Hubs and signing into ClariFy.
- **Key Value**: Gives instructors and course creators clean control over which chat channels exist in a Course Hub and establishes consistent ClariFy brand recognition in the browser tab and login portal.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Creating & Opening a Course Hub**:
     - When a user creates a new Course Hub in the **+ Add Course Hub** modal, the onboarding callout and confirmation toast state that the Course Hub includes **Noticeboard Feed** and **Isolated Q&A Threads**, with the option to add custom chat channels anytime.
     - Upon creation or navigation to `/channels/[hubId]`, the workspace opens directly to the **Noticeboard Feed** (`activeHubTab = 'feed'`).
     - In the left Course Hub sidebar under **Channels**, no `# general` link is auto-generated. If no sub-channels have been added yet, a subtle helper note invites users to click **+ Add Channel** to create their first chat channel.
     - Clicking any user-created `#sub-channel` opens that sub-channel's live Messenger Chat view.
  2. **Browser Tab Favicon & Login Emblem**:
     - The browser tab displays the orange-and-navy ClariFy `C` speech-bubble icon alongside the `ClariFy` page title.
     - On `/login`, the circular badge above **Institutional Sign In** displays the ClariFy `C` speech-bubble logo inside the gold-bordered navy circle.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Course Hub Default Tab & Sub-Channel Routing**
  - *Chosen Approach*: Default `activeHubTab` to `'feed'` in `ClarifyContext` and when navigating to a top-level Course Hub URL (`/channels/[hubId]`). Only switch `activeHubTab` to `'messenger'` when navigating to an explicit custom sub-channel URL (`/channels/[subChannelId]`).
  - *Why*: Ensures users never land on a phantom `# general` chat box when a Course Hub has no chat channels, while keeping custom sub-channel chat fully functional.
- **Decision 2: Serving the Favicon Asset in Next.js Standalone Builds**
  - *Chosen Approach*: Copy `/public/assets/aistudio/image_87b1a0fe.png` into `clarify-web/public/assets/aistudio/image_87b1a0fe.png` and reference `/assets/aistudio/image_87b1a0fe.png` in both the Next.js `Metadata.icons` configuration (`icon`, `shortcut`, `apple`) and an explicit `<link rel="icon">` tag in RootLayout.
  - *Why*: Guarantees the browser tab icon loads reliably in both local development and the Hostinger standalone production build.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        Course Hub Navigation Flow                        │
│                                                                          │
│  [+ Add Course Hub] ──▶ Creates Top-Level Hub (Noticeboard + Q&A only)   │
│         │                                                                │
│         ├──▶ Default View: Noticeboard Feed (activeHubTab = 'feed')      │
│         ├──▶ Built-in View: Isolated Q&A Threads (activeHubTab='threads')│
│         └──▶ [+ Add Channel] ──▶ Creates Custom Sub-Channel (#topic)     │
│                                        │                                 │
│                                        └──▶ Opens Messenger Chat View    │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Interactive Component & State Mapping**:
  - **Global Context & Default Hub Tab**:
    - Initialize `activeHubTab` to `'feed'` instead of `'messenger'`.
  - **Course Hub Sidebar & Routing**:
    - Remove the hardcoded `# general` `<Link>` from the Course Hub tree in the left sidebar.
    - When `hubSubChannels.length === 0`, display a compact empty-channels prompt under the `Channels` header so users know they can click **+ Add Channel** to create a chat channel.
    - When navigating to a top-level Course Hub (`/channels/[hubId]`) without a `?tab=` query param, default to `'feed'` if `activeTab === 'messenger'` and no `activeSubChannel` is selected.
    - When deleting a custom sub-channel, redirect back to `/channels/[parentHubId]?tab=feed`.
  - **Course Hub Creation Modal & Dashboard**:
    - Update the description, onboarding banner, and toast copy in the Course Hub creation modal and dashboard empty state to remove `#general chat` references.
    - Navigate to `/channels/${res.data.id}?tab=feed` upon Course Hub creation.
  - **ClariFy Logo Icon Integration**:
    - Copy `/public/assets/aistudio/image_87b1a0fe.png` to `clarify-web/public/assets/aistudio/image_87b1a0fe.png`.
    - Configure `icons` in `RootLayout` metadata and `<head>` to use `/assets/aistudio/image_87b1a0fe.png`.
    - Replace the text-only `C / USTP` circle on the Login page with the ClariFy `C` speech-bubble logo image inside the circular badge.
