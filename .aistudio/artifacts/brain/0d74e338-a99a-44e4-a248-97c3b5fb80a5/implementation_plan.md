# Add Channel Button for Students & Remove Channel Management from Right Sidebar Plan

## 1. Enable `Add Channel +` Button for Students in Left Scoped Channels Sidebar
- **File**: `/clarify-web/app/channels/[channelId]/page.tsx`
- **Target (`CSS selector 1: ... > aside:nth-of-type(1) > div:nth-of-type(1) > button:nth-of-type(1)`)**:
  - Remove the `{canPublish && (...)}` conditional wrapper around the `Add Channel +` button in the left **Scoped Channels** `<aside>` sidebar so that both **Students** and **Faculty/Admin** see and can click `Add Channel +` to open `ChannelRosterModal`.
  - Retain the `Roster` button next to the `SCOPED CHANNELS` header.

## 2. Remove `Channel Management +` from Right-Hand Orange Navigation Sidebar
- **File**: `/clarify-web/src/components/layout/AppShell.tsx`
- **Target (`CSS selector 2: ... > aside:nth-of-type(1) > div:nth-of-type(1) > nav:nth-of-type(1) > button:nth-of-type(1)`)**:
  - Remove the `Channel Management +` `<button>` from the `<nav aria-label="Primary Navigation">` inside the right-hand orange Profile & Navigation drawer (`AppShell.tsx`).

## 3. Verification
- Run unit tests (`npx --yes tsx --test clarify-web/src/lib/domain-logic.test.ts`), `compile_applet`, and verify in headless Chromium (`playwright-cli`) under Student View that `Add Channel +` appears in the left Scoped Channels sidebar and `Channel Management +` is removed from the right orange sidebar.
