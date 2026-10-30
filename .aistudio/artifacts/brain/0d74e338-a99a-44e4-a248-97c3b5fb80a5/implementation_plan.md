# Standalone Course Hub Messenger Chat Box Plan

## 1. Remove Selected Hashtag & Ticket Elements from `MessengerChatBox.tsx`
- **Remove Hashtag Selector Bar (`section > div:nth-of-type(2)`)**: Delete the navy sub-header bar containing `#When_po_defence_maam`, `#grade_consultation`, `#PIT`, `#Defence`, and `Send an Inquiry +` from `/clarify-web/src/components/threads/MessengerChatBox.tsx`.
- **Remove Hashtag & Resolved Badges from Header (`span:nth-of-type(1)` & `span:nth-of-type(2)`)**: Delete the `#When_po_defence_maam` gold badge, the `Resolved` green badge, and the `Pin FAQ` button from the top gray header bar so it displays only the Course Hub title (`IT3R2-IT314 SoftEng`), the settings gear icon (`⚙`), and the workspace tab switcher (`Messenger Chat`, `Noticeboard Feed`, `Isolated Q&A Threads`, and `+ Ask in Q&A Thread` / `+ Create Announcement`).

## 2. Independent Course Hub Chat State & Message Stream
- **Standalone Channel Chat Room**:
  - Maintain a dedicated per-channel Messenger chat stream (seeded with the 4-turn Student/Faculty conversation from the wireframe: *"When po defence maam? and what possible need i bring?"* → *"Inig date date date..."* → *"Naa bay specific na format maam?..."* → *"A4, Times New Roman, 12 fontsize..."*) completely independent of the Q&A inquiry tickets in `Isolated Q&A Threads`.
  - Allow both Students and Faculty to send new chat messages and attachments (`Mic +`, `Image`, `File`) directly into the channel's Messenger chat stream without modifying or resolving Q&A tickets.

## 3. Clean Separation in `Isolated Q&A Threads`
- **Remove `Open in Messenger Chat` Button**: In `/clarify-web/app/channels/[channelId]/page.tsx`, remove the `Open in Messenger Chat →` button from the Q&A ticket cards inside the `Isolated Q&A Threads` tab so that `Messenger Chat` and `Isolated Q&A Threads` are completely separate.

## 4. Verification
- Run unit tests (`npx --yes tsx --test clarify-web/src/lib/domain-logic.test.ts`), `compile_applet`, and verify in headless Chromium (`playwright-cli`) that the hashtag selector bar and header badges are removed and the Messenger chat box operates as a clean, standalone Course Hub chat room.
