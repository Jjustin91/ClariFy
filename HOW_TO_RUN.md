# ClariFy — How to Run Locally on Windows (PowerShell & Command Prompt)

This guide explains what to install and run after cloning or pulling **ClariFy** from GitHub on **Windows** using **Windows PowerShell** or **Command Prompt (`cmd.exe`)**, including **PostgreSQL**, **Laravel Reverb** WebSockets, and **Next.js**.

---

## 1. Prerequisites (Windows)

Make sure the following are installed and added to your Windows `PATH`:

- **Git for Windows** (`git --version`)
- **PostgreSQL 14+** (`psql --version` or **pgAdmin 4**)
- **Node.js 20+ & npm** (`node -v` and `npm -v`)
- **PHP 8.2+** with the `pdo_pgsql` and `pgsql` extensions enabled in `php.ini` (`php -v`)
- **Composer 2.x** (`composer -V`)

> **Tip for PHP PostgreSQL Extensions on Windows:** Open your `php.ini` file and ensure `extension=pdo_pgsql` and `extension=pgsql` are uncommented (remove the leading `;`).

---

## 2. What to Install After Pulling or Cloning from GitHub

Whenever you `git clone` the repository for the first time or run `git pull` to fetch new updates (such as **Laravel Reverb**, **Laravel Echo**, and **Pusher JS**), run these installation steps from the project root:

### Step 2.1 — Pull Latest Changes from GitHub

**Windows PowerShell or Command Prompt (`cmd.exe`):**
```powershell
git pull origin main
```

### Step 2.2 — Install Backend PHP & Laravel Reverb Dependencies (`/clarify-api`)

`clarify-api/composer.json` includes `laravel/framework` and `laravel/reverb`. Install them via Composer:

**Windows PowerShell or Command Prompt (`cmd.exe`):**
```powershell
cd clarify-api
composer install
```

*(If you are adding Laravel Reverb to a fresh Laravel installation manually, Composer uses `composer require laravel/reverb` and `php artisan install:broadcasting --reverb`, which are already pre-configured in this repository.)*

### Step 2.3 — Install Frontend Next.js & Reverb Client Packages (`/clarify-web`)

`clarify-web/package.json` includes `laravel-echo`, `pusher-js`, and `pg`. Install them via `npm`:

**Windows PowerShell or Command Prompt (`cmd.exe`):**
```powershell
cd ..\clarify-web
npm install
```

*(If you also use the root proxy runner, run `npm install` in the workspace root directory as well.)*

---

## 3. Create the PostgreSQL Database (`clarify_db`)

Open **pgAdmin 4** or run the following command in **Windows PowerShell** or **Command Prompt (`cmd.exe`)**:

```powershell
psql -U postgres -c "CREATE DATABASE clarify_db;"
```

*(Enter your local `postgres` user password when prompted.)*

---

## 4. Option A: Full Stack with Laravel API + Laravel Reverb WebSockets + Next.js (Recommended)

### Step 4.1 — Configure & Seed the Laravel Backend (`/clarify-api`)

1. Navigate to `clarify-api` and create your `.env` file from `.env.example`:

   **In Windows PowerShell:**
   ```powershell
   cd clarify-api
   Copy-Item .env.example .env
   php artisan key:generate
   ```

   **In Command Prompt (`cmd.exe`):**
   ```cmd
   cd clarify-api
   copy .env.example .env
   php artisan key:generate
   ```

2. Open `clarify-api\.env` in VS Code or Notepad and verify your PostgreSQL and **Laravel Reverb** credentials:
   ```env
   DB_CONNECTION=pgsql
   DB_HOST=127.0.0.1
   DB_PORT=5432
   DB_DATABASE=clarify_db
   DB_USERNAME=postgres
   DB_PASSWORD=your_postgres_password

   BROADCAST_CONNECTION=reverb

   REVERB_APP_ID=clarify-app-id
   REVERB_APP_KEY=clarify-reverb-key
   REVERB_APP_SECRET=clarify-reverb-secret
   REVERB_HOST="127.0.0.1"
   REVERB_PORT=8080
   REVERB_SCHEME=http
   ```

3. Run database migrations and seed the IT Administrator account (`90001` / `ustp2026`) and default course channels:

   **Windows PowerShell or Command Prompt (`cmd.exe`):**
   ```powershell
   php artisan migrate:fresh --seed
   ```

### Step 4.2 — Configure the Next.js Frontend (`/clarify-web`)

1. Navigate to `clarify-web` and create `.env.local` from `.env.example`:

   **In Windows PowerShell:**
   ```powershell
   cd ..\clarify-web
   Copy-Item .env.example .env.local
   ```

   **In Command Prompt (`cmd.exe`):**
   ```cmd
   cd ..\clarify-web
   copy .env.example .env.local
   ```

2. Open `clarify-web\.env.local` and verify your PostgreSQL connection, Laravel backend URL, and **Laravel Reverb** WebSocket keys:
   ```env
   # Direct PostgreSQL connection for Next.js API routes
   DB_HOST=127.0.0.1
   DB_PORT=5432
   DB_DATABASE=clarify_db
   DB_USERNAME=postgres
   DB_PASSWORD=your_postgres_password

   # Forward /api/v1/* requests to Laravel when running php artisan serve
   LARAVEL_BACKEND_URL=http://127.0.0.1:8000

   # Laravel Reverb WebSocket Client Configuration (Laravel Echo + Pusher JS)
   NEXT_PUBLIC_REVERB_APP_ID=clarify-app-id
   NEXT_PUBLIC_REVERB_APP_KEY=clarify-reverb-key
   NEXT_PUBLIC_REVERB_HOST=127.0.0.1
   NEXT_PUBLIC_REVERB_PORT=8080
   NEXT_PUBLIC_REVERB_SCHEME=http
   ```

### Step 4.3 — Start All 3 Servers on Windows

Open **3 separate Windows PowerShell or Command Prompt (`cmd.exe`) windows**:

- **Terminal 1 — Laravel HTTP API Server (Port `8000`):**
  ```powershell
  cd clarify-api
  php artisan serve --host=127.0.0.1 --port=8000
  ```

- **Terminal 2 — Laravel Reverb WebSocket Server (Port `8080`):**
  ```powershell
  cd clarify-api
  php artisan reverb:start --host=0.0.0.0 --port=8080
  ```

- **Terminal 3 — Next.js Frontend Server (Port `3000`):**
  ```powershell
  cd clarify-web
  npm run dev
  ```

Open **http://localhost:3000** in your browser. Unauthenticated sessions automatically start at **/login**.

---

## 5. Option B: Run Next.js Directly Connected to PostgreSQL (Single Terminal)

`clarify-web` also includes a built-in PostgreSQL adapter (`src/server/postgres-adapter.ts`) and an automatic real-time SSE + `BroadcastChannel` fallback (`/api/v1/realtime/stream`). If you only want to run a single terminal without PHP/Laravel:

1. Open **Windows PowerShell** or **Command Prompt (`cmd.exe`)**:
   ```powershell
   cd clarify-web
   npm install
   ```

2. Ensure `clarify-web\.env.local` has your PostgreSQL credentials:
   ```env
   DB_HOST=127.0.0.1
   DB_PORT=5432
   DB_DATABASE=clarify_db
   DB_USERNAME=postgres
   DB_PASSWORD=your_postgres_password
   ```

3. Start the server:
   ```powershell
   npm run dev
   ```

4. Open **http://localhost:3000** in your browser (starts at **/login**).

---

## 6. Seeded IT Admin & Student/Faculty Sign Up Workflow

Only the **IT Administrator** account is pre-seeded in PostgreSQL. **Student** and **Faculty** users register their own accounts on **/register**:

| Role Domain | Institutional ID | Password | How to Access |
| :--- | :--- | :--- | :--- |
| **IT Administrator (Seeded)** | `90001` | `ustp2026` | Pre-seeded in PostgreSQL. Restricted strictly to the **IT Admin Console** (`/admin`) to approve/reject pending Student & Faculty sign-ups, manage RBAC roles, trigger PRISMS sync, and inspect announcement audit logs. |
| **Student** | Created on `/register` | Created on `/register` | Register on `/register` &rarr; Account is saved as `pending` &rarr; IT Admin (`90001`) clicks **Approve** in `/admin` &rarr; Student can now sign in on `/login`. |
| **Faculty** | Created on `/register` | Created on `/register` | Register on `/register` &rarr; Account is saved as `pending` &rarr; IT Admin (`90001`) clicks **Approve** in `/admin` &rarr; Faculty can now sign in on `/login`. |

---

## 7. Testing Multi-User Real-Time Features & Messenger Chat

Each browser tab uses isolated `sessionStorage` credentials (`clarify-jwt-{role}-{institutional_id}-{session_id}`), allowing you to sign in as **IT Admin**, **Faculty**, and multiple **Students** simultaneously in separate tabs of the same browser window:

1. **Tab 1 (IT Administrator)**:
   - Open `http://localhost:3000` (redirects to `/login`) and sign in as IT Admin (`90001` / `ustp2026`).
2. **Tab 2 (Faculty) & Tab 3 (Student)**:
   - Open `http://localhost:3000/register` in Tab 2 (Faculty) and Tab 3 (Student) to create accounts.
   - Approve both accounts in **Tab 1** (`/admin`), then sign in on Tab 2 and Tab 3.
3. **Verify Real-Time Broadcasting & Messenger Layout**:
   - **Live Course Hub Messenger Chat**: Open `/channels/1` in Tab 2 (Faculty) and Tab 3 (Student). Messages sent by the current user appear on the **right side in vibrant blue bubbles**, while replies from other students and faculty appear on the **left side in light gray bubbles** with their circular avatar and name/role header above the bubble.
   - **Urgent Announcement Popups**: Publish an Urgent Announcement in Tab 2 (Faculty) — Tab 3 (Student) immediately receives the **Urgent Announcement Popup Modal**.
   - **Live Acknowledgment Counters**: Click **Acknowledge Receipt** in Tab 3 (Student) — Tab 2 (Faculty) sees the `acknowledged_count / total_scoped_students` progress bar update live.
   - **Discussion Threads & Q&A**: Submit an inquiry under **+ Ask in Q&A Thread** in Tab 3 (Student), answer it in Tab 2 (Faculty), and convert it to **Class FAQs** in real time.

---

## 8. Useful PostgreSQL Verification Queries

Run these queries in **Windows PowerShell / CMD (`psql -U postgres -d clarify_db`)** or **pgAdmin 4**:

```sql
SELECT id, institutional_id, name, email, role, verification_status FROM users ORDER BY id DESC;
SELECT id, channel_id, publisher_id, title, is_urgent, status, published_at FROM announcements ORDER BY id DESC;
SELECT id, channel_id, sender_id, subject_hashtag, content, is_resolved, is_pinned_faq FROM messages ORDER BY id DESC;
SELECT id, course_code, name, channel_type, scope_section FROM channels ORDER BY id;
```
