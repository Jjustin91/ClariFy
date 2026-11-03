# Announcement Form Input Fix & Zero-Latency Real-Time Channel Chat

This plan resolves the input reset bug in the **Create / Edit Announcement Modal** and upgrades the **Course Hub Channel Chat** (`clarify-web`) with zero-latency optimistic UI updates, retryable error states, multi-line `Enter` / `Shift+Enter` keyboard UX, and a live Supabase Realtime WebSocket subscription (`@supabase/supabase-js`).

## User Review & Critical Decisions

> [!IMPORTANT]
> All functional and architectural requirements were specified in the prompt. Please review the summary below and click **Proceed** to execute.

- **Announcement Modal Input Stability**: Stabilize the modal initialization `useEffect` in the Announcement Form so typing into the **Title** or **Content** fields never triggers a form state reset when derived Course Hub lists re-evaluate on render.
- **Zero-Latency Optimistic Messaging**: Immediately append outgoing messages with a temporary ID (`temp-${Date.now()}`), current ISO timestamp, sender profile, and `status: 'sending'`, clear the composer input, and smoothly scroll to the bottom while the `POST /channels/${channelId}/messages` request executes in the background.
- **Supabase Realtime Subscription (`messages` Table)**: Subscribe to `postgres_changes` (`INSERT` on `public.messages` filtered by `channel_id=eq.${channelId}`) via `@supabase/supabase-js` and deduplicate incoming payloads against existing confirmed `id` or optimistic `temp_id` entries.

---

## 1. Overview & Core Concept

- **What It Does**:
  1. Fixes the **Create / Edit Announcement** modal so Department Heads and Faculty can type freely into the Title and Content inputs without characters being wiped on re-render.
  2. Delivers instant, zero-latency message sending in Course Hub channels (`#general` and custom sub-channels) with optimistic status indicators (`Sending...`, `Sent`, `Failed — Tap to retry`) and live WebSocket message delivery via Supabase Realtime.
- **Target Audience / Persona**: USTP Students, Faculty Instructors, and Department Heads collaborating in Course Hub channels and publishing official announcements.
- **Key Value**: Eliminates perceived network latency when chatting and ensures multi-participant messages appear live without page refreshes.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Creating an Announcement**:
     - Opening the modal initializes the form fields once per open session (`isOpen` transition / `editingAnnouncement?.id`).
     - Typing into **Title** and **Type here** updates state smoothly without re-running initialization logic.
  2. **Optimistic Channel Messaging**:
     - Pressing `Enter` (without `Shift`) or clicking the Send button immediately appends the message bubble into the chat stream with a subtle `Sending...` status indicator, clears the composer input, and smoothly scrolls the chat container to the latest message.
     - Pressing `Shift + Enter` inserts a newline in the auto-expanding composer textarea.
     - The composer remains active and responsive while background requests are in flight (only disabled during the initial channel load).
     - When the API responds with `201 Created`, the temporary optimistic record (`temp-...`) is seamlessly replaced in-place by the confirmed database record.
     - If the API request fails, the message bubble remains visible with a red `Failed to send • Retry` action button that re-submits the payload on click.
  3. **Live Incoming Messages (Supabase Realtime)**:
     - When another participant posts a message to the same channel, the Supabase Realtime `postgres_changes` listener receives the `INSERT` event on `messages`, checks that the message is not already present in local state (by confirmed `id` or matching `temp_id`), appends it to the conversation, and smoothly scrolls to the bottom.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Optimistic Reconciliation & Deduplication Strategy**
  - *Chosen Approach*: Attach both `id` (`temp-${Date.now()}`) and `temp_id` to optimistic messages. Reconcile on API completion by replacing the matching `temp_id` item with the confirmed server record, and guard the Realtime `INSERT` handler against both `msg.id === incoming.id` and `msg.temp_id === incoming.temp_id` (plus matching sender + content + pending status if the WebSocket event arrives before the HTTP response returns).
  - *Why*: Prevents duplicate bubbles when both the HTTP response and the Supabase Realtime WebSocket broadcast arrive within milliseconds of each other.
- **Decision 2: Dual Endpoint Route Compatibility (`/channels/{channelId}/messages` & `/channels/{channelId}/chat`)**
  - *Chosen Approach*: Register `GET` and `POST /api/v1/channels/{channelId}/messages` alongside `/channels/{channelId}/chat` in the Laravel API, and configure the Next.js API client to post to `/channels/${channelId}/messages` with automatic fallback to `/channels/${channelId}/chat`.
  - *Why*: Guarantees compatibility with both the `/channels/${channelId}/messages` endpoint contract and any existing `/chat` callers.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Data Flow Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     Next.js Channel Chat Component                       │
│  ┌─────────────────────────┐        ┌─────────────────────────────────┐  │
│  │ Composer Textarea       │        │ Optimistic Message State        │  │
│  │ • Enter = Submit        │───────▶│ • id: "temp-173065..."          │  │
│  │ • Shift+Enter = Newline │        │ • status: 'sending' | 'failed'  │  │
│  └─────────────────────────┘        └───────────┬─────────────────────┘  │
│                                                 │                        │
│               ┌─────────────────────────────────┴───────────────┐        │
│               ▼                                                 ▼        │
│  ┌────────────────────────────────────┐   ┌───────────────────────────┐  │
│  │ POST /channels/{id}/messages       │   │ Supabase Realtime Client  │  │
│  │ • Background async request         │   │ • channel_id=eq.{id}      │  │
│  │ • Success: swap temp_id -> DB row  │   │ • Deduplicate id/temp_id  │  │
│  │ • Error: status='failed' + Retry   │   │ • Auto-scroll on insert   │  │
│  └────────────────┬───────────────────┘   └─────────────▲─────────────┘  │
└───────────────────┼─────────────────────────────────────┼────────────────┘
                    ▼                                     │
       ┌─────────────────────────┐           ┌────────────┴────────────┐
       │ Laravel 11 REST API     │──────────▶│ Supabase PostgreSQL     │
       │ ChannelChatController   │  INSERT   │ Table: public.messages  │
       └─────────────────────────┘           └─────────────────────────┘
```

### Interactive Component & State Mapping
- **Announcement Modal (`AnnouncementFormModal`)**:
  - Track modal open lifecycle so form reset only executes when opening the modal or switching the target announcement being edited, never on keystrokes.
- **Supabase Client Helper (`clarify-web/lib/supabase.ts`)**:
  - Initialize `@supabase/supabase-js` client with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, providing a safe no-op guard if environment variables are not configured in local preview.
- **Channel Chat (`MessengerChatBox` / `ChannelChat`)**:
  - Maintain `messagesByChannel` with `status?: 'sending' | 'sent' | 'failed'` and `temp_id?: string`.
  - Provide `handleRetryMessage(failedMsg)` to re-dispatch failed optimistic messages without re-typing.
  - Clean up the Supabase Realtime subscription via `supabase.removeChannel(realtimeChannel)` on unmount or `channelId` change.
