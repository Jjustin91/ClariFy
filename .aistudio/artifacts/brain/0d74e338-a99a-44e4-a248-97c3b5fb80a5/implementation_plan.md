# USTP System Palette & Branding Refinement Plan

## Overview
Update the ClariFy interface across three targeted areas to ensure cohesive USTP institutional branding and color palette alignment:
1. **Messenger Chat Widget (`MessengerChatBox.tsx`)**: Replace generic `#0084ff` and `#f0f0f0` colors with the USTP system palette (`ustp-navy`, `ustp-gold`, `ustp-cream`, `ustp-text`, `ustp-blue`).
2. **Login Badge (`app/login/page.tsx`)**: Replace `PRISMS SSO` inside the circular emblem with `ClariFy`.
3. **Top Navigation Brand (`AppShell.tsx`)**: Convert the white rectangular `USTP` button in the top header into plain `USTP` letters styled in bold `ustp-gold` (`#fcb315`), removing the link to the login screen.

---

## Planned Changes

### 1. Messenger Chat System Palette (`src/components/threads/MessengerChatBox.tsx`)
- **Floating Trigger Button & Chat Header**:
  - Restyle the floating Messenger button and active chat header bar in `bg-ustp-navy` (`#1a1851`) with `border-ustp-gold` accents and `text-ustp-gold` / `text-white` typography.
  - Style active status indicators and unread badges with `bg-ustp-gold` (`#fcb315`) and `text-ustp-navy`.
- **Chat Message Bubbles**:
  - **Outgoing Messages (`isMe`)**: Style bubbles with `bg-ustp-navy` (`#1a1851`), `text-white`, and a subtle `border-ustp-navy` edge.
  - **Incoming Messages**: Style bubbles with `bg-ustp-cream` (`#FFFAF2`), `text-ustp-text` (`#031c2e`), and `border-amber-200/80` border for crisp legibility against the message canvas.
  - **Official Endorsed Replies**: Highlight endorsed faculty/admin answers with a `ring-2 ring-ustp-gold` accent and a `bg-ustp-gold/20 text-ustp-navy` badge.
- **Avatars, Composer & Controls**:
  - Style sender avatars using `bg-ustp-navy text-ustp-gold` (or `bg-ustp-blue text-white` for peers) instead of generic blue gradients.
  - Style the bottom message input bar with `bg-ustp-cream` input field, `focus:ring-ustp-navy/30 focus:border-ustp-navy`, and a `bg-ustp-navy text-ustp-gold` send button.

### 2. Login Emblem Text (`app/login/page.tsx`)
- In the right-side login panel emblem, replace the label `PRISMS SSO` under the `ShieldCheck` icon with `ClariFy`.

### 3. Top Header USTP Branding (`src/components/layout/AppShell.tsx`)
- Replace `<Link href="/login" title="Universal Login Screen" className="px-3.5 py-1.5 bg-white text-ustp-navy ...">USTP</Link>` with a non-clickable `<span className="text-lg sm:text-xl font-extrabold text-ustp-gold tracking-wider select-none">USTP</span>` so it renders purely as bold USTP Gold letters without a surrounding box or redirect link.

---

## Verification
- Run `compile_applet` and `lint_applet` to verify there are no TypeScript or ESLint errors.
