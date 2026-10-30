# Sticky Fixed-Size Navigation & Course Hub Sidebars

Convert the ClariFy workspace layout so the top institutional header bar, the selected right-hand Profile & Navigation `<aside>` drawer, and the Course Hub `<aside>` sidebars (Scoped Channels and Class FAQs / Answer Ticket panel) maintain a fixed viewport-locked height (`calc(100vh - 3.5rem)`) and stay sticky (`top-14`) while scrolling through long announcement feeds, Q&A threads, or admin tables.

## User Review & Critical Decisions

> [!IMPORTANT]
> Both layout and scope decisions have been confirmed based on your preferences:

- **Confirmed Decision 1 (Vertical Positioning & Fixed Height)**: All sticky `<aside>` panels will lock directly beneath the `3.5rem` (`56px` / `h-14`) sticky top header bar using `sticky top-14 h-[calc(100vh-3.5rem)]` with internal `overflow-y-auto` scrolling so bottom actions (`Settings` and `Logout`) remain permanently visible in the viewport.
- **Confirmed Decision 2 (Application Scope)**: In addition to the selected right-hand orange Profile & Navigation `<aside>` drawer, we will make the top institutional header bar (`sticky top-0 z-30`) and both Course Hub `<aside>` sidebars (left Scoped Channels rail and right Class FAQs / Answer Ticket panel on desktop `lg:sticky lg:top-14 lg:h-[calc(100vh-3.5rem)]`) sticky with independent internal scrolling.

---

## 1. Overview & Core Concept

- **What It Does**: Anchors the primary navigation chrome and contextual Course Hub sidebars to the viewport so users never lose access to role switching, profile actions, channel switching, or pinned Class FAQs when scrolling deep into campus noticeboards or multi-reply academic inquiries.
- **Target Audience / Persona**: USTP students, faculty instructors, and IT administrators browsing multi-page announcements, managing Q&A tickets, and auditing PRISMS sync logs.
- **Key Value**: Eliminates vertical scroll fatigue—bottom-pinned drawer controls (`Settings`, `Logout`) and contextual course tools stay locked in place rather than stretching to the bottom of long document pages.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Scrolling Any Main Feed (Dashboard, Announcements, Instructors, Admin Console)**: As the user scrolls down the main workspace, the `3.5rem` (`h-14`) navy top bar stays pinned at `top-0`, and the right-hand `256px` (`w-64`) orange Profile & Navigation `<aside>` stays pinned at `top-14` with a fixed height of `calc(100vh - 3.5rem)`. The user's avatar, navigation links, and bottom `Settings` / `Logout` buttons remain continuously visible.
  2. **Collapsing & Re-Opening the Right Profile Drawer**: Clicking the collapse chevron smoothly collapses the sticky `<aside>` width to `0` (`w-0 border-l-0 overflow-hidden`) while keeping the floating re-open `Menu` tab fixed at `right-0 top-16`.
  3. **Scrolling Inside the 3-Column Course Hub**: On desktop (`1440px`), scrolling through long course announcements or Q&A threads scrolls only the center column while the left Scoped Channels `<aside>` (`w-60`), the right Class FAQs / Answer Ticket `<aside>` (`lg:w-72 xl:w-80`), and the outer Profile & Navigation `<aside>` (`w-64`) remain sticky below the header and scroll independently if their own content overflows.
- **Visual Identity & Theme**:
  - *Aesthetic Direction*: High-contrast institutional SaaS workspace adhering to USTP brand identity.
  - *Color Palette & Mood*: Deep USTP Navy (`#1a1851`) top header and channel rail, warm cream (`#FFFAF2`) main canvas, crisp white (`#FFFFFF`) card surfaces with `1px` slate hairline borders, and USTP Orange (`#ff9718` / `#ff6418`) profile drawer with USTP Gold (`#fcb315`) active highlights.
  - *Typography & Hierarchy*: `Plus Jakarta Sans` for structural navigation and headings paired with `JetBrains Mono` (`tabular-nums`) for student IDs, read-reach percentages, and metrics.
  - *Component Styling & Layout*: Full `1440px` desktop workspace presence with fixed sidebar widths (`240px`–`320px`), `items-start` flex alignment on sticky parent containers (preventing flexbox height stretching), and clean internal scrollbars (`overflow-y-auto`).
- **Interactive Feedback & Motion**: Drawer collapse/expand transitions complete within `200ms` (`ease-out`), maintaining immediate access to all navigation controls without layout shift.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Removing `overflow-x-hidden` on the Sticky Flex Wrapper in Favor of `overflow-x-clip` / `items-start`**
  - *Chosen Approach*: Configure the parent workspace flex container without scroll-container side effects that break CSS `position: sticky`, and align flex children with `items-start` (or explicit `h-[calc(100vh-3.5rem)]`) so sticky `<aside>` elements do not stretch to the full document height.
  - *Why*: In CSS, setting `overflow-x: hidden` on a flex container implicitly computes `overflow-y: auto`, which traps `position: sticky` descendants inside an unintended scroll context. Using `items-start` + `sticky top-14 h-[calc(100vh-3.5rem)]` guarantees browser-native, zero-jitter sticky positioning.
  - *Alternatives Considered*: Using `position: fixed` with manual right/left padding offsets on `<main>`, which was rejected because it complicates responsive widths when the Course Hub's multiple sidebars and collapsible drawer are combined.
- **Decision 2: Responsive Behavior on Mobile Viewports (`< 1024px`)**
  - *Chosen Approach*: Keep the right-hand Profile & Navigation `<aside>` sticky at `top-14 h-[calc(100vh-3.5rem)]`, while applying sticky fixed height to the Course Hub's inner Scoped Channels and Class FAQs sidebars only at desktop breakpoints (`lg:sticky lg:top-14 lg:h-[calc(100vh-3.5rem)] lg:overflow-y-auto`).
  - *Why*: On mobile screens where Course Hub columns stack vertically (`flex-col`), making stacked full-width sidebars sticky would cover the viewport and violate the 15% mobile sticky cap.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ Sticky Top Institutional Header Bar (sticky top-0 z-30 h-14)                         │
│ [ClariFy | Active View Title]        [API Mode] [Role Switcher Pills] [USTP Badge]   │
├──────────────────────┬────────────────────────────────────────┬──────────────────────┤
│ Left Course Hub      │ Center Scrollable Workspace (<main>)   │ Right Profile & Nav  │
│ Sidebar (<aside>)    │ (Natural document scroll, flex-1)      │ Drawer (<aside>)     │
│                      │                                        │                      │
│ lg:sticky lg:top-14  │  • Dashboard / Noticeboard Grid        │ sticky top-14        │
│ lg:h-[calc(100vh-    │  • Course Hub Feed & Q&A Threads       │ h-[calc(100vh-       │
│   3.5rem)]           │  • Verified Faculty Directory          │   3.5rem)]           │
│ lg:overflow-y-auto   │  • IT Admin Console Tabs               │ w-60 sm:w-64         │
│ w-full lg:w-60       │                                        │ overflow-y-auto      │
│ shrink-0             ├────────────────────────────────────────┤ shrink-0             │
│                      │ Inner-Right Course Hub FAQ (<aside>)   │                      │
│                      │ lg:sticky lg:top-14                    │ [Avatar & Scope]     │
│                      │ lg:h-[calc(100vh-3.5rem)]              │ [Primary Nav Stack]  │
│                      │ lg:w-72 xl:w-80 lg:overflow-y-auto     │ [Settings / Logout]  │
└──────────────────────┴────────────────────────────────────────┴──────────────────────┘
```

- **Data Model & State**:
  - `isDrawerOpen` boolean in `ClarifyContext` governs whether the sticky right-hand `<aside>` renders at its fixed width (`w-60 sm:w-64`) or collapsed (`w-0 border-l-0 overflow-hidden`).
- **Interactive Component & State Mapping**:
  - **Sticky Header (`<header>`)**: Uses `sticky top-0 z-30 h-14` so role switching, API mode toggling, and navigation context remain pinned at the top of the viewport.
  - **Selected Profile & Navigation Drawer (`<aside aria-label="User Profile and Navigation Drawer">`)**: Uses `sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto shrink-0 self-start` with fixed width (`w-60 sm:w-64` when open, `w-0` when collapsed), keeping the top profile card, navigation stack, and bottom `Settings` / `Logout` actions fitted cleanly inside the viewport height.
  - **Course Hub Left Scoped Channels (`<aside aria-label="Scoped Channels Sidebar">`) & Right Class FAQs (`<aside aria-label="Class FAQs and Answer Ticket Panel">`)**: Use `lg:sticky lg:top-14 lg:h-[calc(100vh-3.5rem)] lg:overflow-y-auto lg:self-start shrink-0` so both panels stay locked in place while scrolling the center Course Hub feed.
