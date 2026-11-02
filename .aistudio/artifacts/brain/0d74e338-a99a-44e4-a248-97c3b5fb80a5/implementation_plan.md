# Responsive Web App, Messenger Chat Redesign & Windows Setup Guide Plan

## 1. Messenger-Style Chat Redesign (`clarify-web/src/components/threads/MessengerChatBox.tsx`)
Redesign the Course Hub Messenger Chat to match the attached reference screenshot and your preferences:
- **Current User Bubbles (Right-Aligned & Blue)**:
  - Detect current user messages via `Number(msg.author.id) === Number(currentUser.id)`.
  - Align bubbles to the right (`justify-end`) with Messenger blue styling (`bg-[#0084ff] text-white rounded-2xl rounded-br-xs px-4 py-2.5 shadow-xs max-w-[82%] sm:max-w-[70%]`).
- **Respondent Bubbles (Left-Aligned & Light Gray with Avatar + Name/Role)**:
  - Align other students' and faculty members' messages to the left (`justify-start`) with their circular avatar anchored at the bottom-left of the message row.
  - Display the sender's name and role badge subtly above the bubble (`msg.author.name` + `Faculty` / `Student` label).
  - Style the respondent bubble in clean neutral gray (`bg-[#f0f0f0] text-slate-900 rounded-2xl rounded-bl-xs px-4 py-2.5 max-w-[82%] sm:max-w-[70%]`).
- **Centered Timestamp Dividers**:
  - Render centered uppercase timestamp dividers above messages (e.g., `NOV 1, 2026 AT 5:30 PM`) in muted uppercase typography (`text-[11px] font-semibold tracking-wider uppercase text-slate-400 text-center my-3`), plus a subtle bottom-right delivery/seen avatar indicator.
- **Touch-Friendly Composer & Mode Tabs**:
  - Make the top Course Hub header and mode switcher tabs (`Messenger Chat`, `Noticeboard Feed`, `Isolated Q&A Threads`, `+ Ask in Q&A Thread`) horizontally scrollable and wrap cleanly on narrow mobile viewports (`375px+`).

---

## 2. Full Responsiveness Across All Screen Sizes (Mobile, Tablet & Desktop)
- **Top Hamburger Button & Slide-Out Navigation Drawer (`AppShell.tsx` & `ClarifyContext.tsx`)**:
  - Add a top hamburger menu button in the sticky `ustp-navy` header bar (`min-h-[44px] min-w-[44px]`).
  - Default the right-hand `ustp-orange` profile & navigation drawer to closed on mobile/tablet (`< 1024px`) and open on desktop (`>= 1024px`).
  - Render the drawer on mobile/tablet as a fixed slide-out overlay (`fixed right-0 top-14 z-40 h-[calc(100vh-3.5rem)] w-72 shadow-2xl`) with a dim backdrop (`bg-black/40 backdrop-blur-xs lg:hidden`) that closes automatically on link selection or backdrop tap.
- **Course Hub Slide-Out Channel & FAQ Drawers on Mobile (`app/channels/[channelId]/page.tsx`)**:
  - On mobile/tablet (`< 1024px`), provide a slide-out **Channels & Roster Drawer** (left slide-out) and a toggleable **Class FAQs / Answer Ticket Drawer** so the Messenger Chat and Q&A workspace occupy the full mobile viewport height without forcing users to scroll past sidebars.
  - Preserve the 3-column sticky layout on desktop (`lg:flex-row`).
- **Responsive Pages & Modals (`app/page.tsx`, `app/announcements/page.tsx`, `app/instructors/page.tsx`, `app/admin/page.tsx`, `app/login/page.tsx`, `app/register/page.tsx`)**:
  - Adjust container paddings (`p-4 sm:p-6 lg:p-8`), make the IT Admin Console tables and tabs horizontally scrollable on small screens, and ensure all modals fit cleanly within mobile viewports (`max-h-[90vh] overflow-y-auto`).

---

## 3. Updated `HOW_TO_RUN.md` (Windows PowerShell & Command Prompt Guide)
Update `HOW_TO_RUN.md` with a step-by-step **Windows PowerShell & Command Prompt (`cmd.exe`)** guide detailing everything required immediately after running `git clone` or `git pull` from GitHub:
- **Post-Pull Dependency Installation Checklist**:
  - Installing root and frontend packages (`npm install` in workspace root and `cd clarify-web && npm install`, including `laravel-echo` and `pusher-js`).
  - Installing backend Composer packages and Laravel Reverb (`cd clarify-api`, `composer install`, `php artisan reverb:install` / `php artisan key:generate`).
- **Windows `.env` & `.env.local` Setup**:
  - Exact PowerShell (`Copy-Item .env.example .env`) and CMD (`copy .env.example .env`) commands, plus required PostgreSQL (`clarify_db`) and Reverb (`REVERB_APP_ID`, `REVERB_APP_KEY`, `REVERB_PORT=8080`) environment variables.
- **Running the Stack on Windows**:
  - Step-by-step commands for opening 3 Windows PowerShell / CMD terminals (`php artisan serve`, `php artisan reverb:start`, and `npm run dev`), plus the single-command Next.js + PostgreSQL option.
