# Move Channel Roster to Course Hub Settings Popover & Show Current Faculty in Sidebar

## 1. Overview
Refine the Course Hub layout so that:
1. The **left Scoped Channels sidebar footer** displays only the **current Faculty** in that Course Hub along with the **total Enrolled Roster count** (instead of listing all members).
2. Clicking the **Settings gear icon** in the Course Hub top header opens the **Course Hub Settings & Channel Roster** popover panel directly, where Students and Faculty can inspect the full enrolled member list, add members, remove members, or sync section access.

---

## 2. Planned Changes

### A. Left Scoped Channels Sidebar (`/clarify-web/app/channels/[channelId]/page.tsx`)
- **Remove Top `Roster` Button**: Remove the `Roster` trigger button from the `SCOPED CHANNELS` sidebar header since the Channel Roster now lives under the Course Hub Settings gear icon.
- **Footer Faculty + Enrolled Count**:
  - Replace the full member list in the bottom sidebar footer with:
    - Scope badge (`CITC • IT3R2`)
    - **Current Faculty**: Displays the faculty/department head member(s) enrolled in `activeChannel.roster` (or the faculty creator), with a clean fallback if no faculty member has joined yet.
    - **Enrolled Roster**: Displays the accurate total member count (`Enrolled Roster: X members`).

### B. Course Hub Settings Popover with Embedded Channel Roster (`/clarify-web/src/components/threads/MessengerChatBox.tsx`)
- Upgrade the `showSettingsMenu` gear popover in the Course Hub top bar into a responsive **Course Hub Settings & Channel Roster** panel:
  - Shows active Course Hub metadata (`Course`, `Section`, `Current Faculty`, and `Enrolled Roster` count badge).
  - Includes a quick **Verify / Sync Section Roster** button (`joinChannelApi`).
  - Includes an inline **Add Member to Roster** form (Institutional ID + optional Full Name) and a scrollable list of all enrolled members with their name, Institutional ID, role/section badge, and **Remove** button for both Students and Faculty.

### C. Streamline Channel Management Modal (`/clarify-web/src/components/modals/ChannelRosterModal.tsx`)
- Keep the `+ Add Channel` modal focused on **Browse & Join Channels** and **+ Create Course Hub** since the Channel Roster is now managed directly inside the Course Hub Settings gear popover.

---

## 3. Files to Modify
1. `/clarify-web/app/channels/[channelId]/page.tsx`
2. `/clarify-web/src/components/threads/MessengerChatBox.tsx`
3. `/clarify-web/src/components/modals/ChannelRosterModal.tsx`
