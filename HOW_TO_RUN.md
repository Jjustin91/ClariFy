# ClariFy — How to Run Locally with PostgreSQL & Laravel Reverb

This guide walks you through running **ClariFy** locally with a real **PostgreSQL** database and **Laravel Reverb** WebSockets so that every Announcement, Urgent Announcement Popup, Live Acknowledgment Counter, Course Hub Channel, Messenger Chat message, Q&A Inquiry Thread, Faculty Reply, Class FAQ conversion, and IT Administrator action is saved directly to PostgreSQL and broadcast in real time across multiple concurrent Student, Faculty, and IT Administrator sessions.

---

## 1. Prerequisites

Make sure you have the following installed on your machine:

- **PostgreSQL 14+** (`psql` or pgAdmin 4)
- **Node.js 20+** and `npm`
- **PHP 8.2+** and **Composer** (when running the Laravel 12/13 API backend + Laravel Reverb WebSocket server)

---

## 2. Create the PostgreSQL Database

Open **pgAdmin 4** or your terminal (`psql`) and create the `clarify_db` database:

```sql
CREATE DATABASE clarify_db;
```

Or via terminal:

```bash
psql -U postgres -c "CREATE DATABASE clarify_db;"
```

---

## 3. Option A: Run Full Stack with Laravel API + Laravel Reverb WebSockets + Next.js Frontend

### Step 3.1 — Configure & Seed the Laravel Backend (`/clarify-api`)

1. Open a terminal and navigate to `clarify-api`:
   ```bash
   cd clarify-api
   composer install
   cp .env.example .env
   php artisan key:generate
   ```

2. Edit `clarify-api/.env` so the PostgreSQL and Laravel Reverb variables match your local setup:
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

3. Run migrations and seed the baseline IT Administrator account (`90001`) and initial course channel:
   ```bash
   php artisan migrate:fresh --seed
   ```

4. Start the Laravel HTTP API server on port `8000` (Terminal 1):
   ```bash
   php artisan serve --host=127.0.0.1 --port=8000
   ```

5. Start the **Laravel Reverb WebSocket Server** on port `8080` (Terminal 2):
   ```bash
   php artisan reverb:start --host=0.0.0.0 --port=8080
   ```

### Step 3.2 — Configure & Start the Next.js Frontend (`/clarify-web`)

1. Open a third terminal and navigate to `clarify-web`:
   ```bash
   cd clarify-web
   npm install
   ```

2. Create `clarify-web/.env.local` with your PostgreSQL connection, Laravel backend URL, and Laravel Reverb client keys:
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

3. Start the Next.js development server on port `3000`:
   ```bash
   npm run dev
   ```

4. Open **http://localhost:3000** in your browser. Unauthenticated sessions automatically start at **/login**.

---

## 4. Option B: Run Next.js Directly Connected to PostgreSQL (Single Command)

Next.js includes a direct PostgreSQL adapter (`src/server/postgres-adapter.ts`) and an automatic real-time SSE + `BroadcastChannel` stream fallback (`/api/v1/realtime/stream`). Even if `php artisan reverb:start` is not running, all 4 real-time features work out of the box across multiple browser tabs and windows.

1. Navigate to `clarify-web`:
   ```bash
   cd clarify-web
   npm install
   ```

2. Create `clarify-web/.env.local` with your PostgreSQL credentials:
   ```env
   DB_HOST=127.0.0.1
   DB_PORT=5432
   DB_DATABASE=clarify_db
   DB_USERNAME=postgres
   DB_PASSWORD=your_postgres_password
   ```
   *(Or use a single connection string: `DATABASE_URL=postgresql://postgres:your_postgres_password@127.0.0.1:5432/clarify_db`)*

3. Start the app:
   ```bash
   npm run dev
   ```

4. Open **http://localhost:3000** in your browser (starts at **/login**).

---

## 5. Seeded IT Admin & Student/Faculty Sign Up Workflow

Only the **IT Administrator** account is seeded in the database. **Student** and **Faculty** users create their own accounts via the **Sign Up** page (`/register`):

| Role Domain | Institutional ID | Password | How to Access |
| :--- | :--- | :--- | :--- |
| **IT Administrator (Seeded)** | `90001` | `ustp2026` | Pre-seeded in PostgreSQL (`DatabaseSeeder.php`). Restricted strictly to the **IT Admin Console** (`/admin`) to approve/reject pending Student & Faculty sign-ups, manage RBAC roles, trigger PRISMS sync, and inspect announcement audit logs. |
| **Student** | Created on `/register` | Created on `/register` | Register on `/register` &rarr; Account is saved as `pending` &rarr; IT Admin (`90001`) clicks **Approve** in `/admin` &rarr; Student can now sign in on `/login`. |
| **Faculty** | Created on `/register` | Created on `/register` | Register on `/register` &rarr; Account is saved as `pending` &rarr; IT Admin (`90001`) clicks **Approve** in `/admin` &rarr; Faculty can now sign in on `/login`. |

---

## 6. Testing Multi-User Real-Time Features (Laravel Reverb + Per-Tab Session Isolation)

Each browser tab uses isolated `sessionStorage` credentials and unique session tokens (`clarify-jwt-{role}-{institutional_id}-{session_id}`), allowing you to sign in as **IT Admin**, **Faculty**, and multiple **Students** simultaneously in separate tabs of the same browser window without overwriting each other's session:

1. **Tab 1 (IT Administrator)**:
   - Open `http://localhost:3000` (redirects to `/login`) and sign in as IT Admin (`90001` / `ustp2026`).
2. **Tab 2 (Faculty) & Tab 3 (Student)**:
   - Open `http://localhost:3000/register` in Tab 2 and create a **Faculty** account (e.g., CITC).
   - Open `http://localhost:3000/register` in Tab 3 and create a **Student** account (e.g., IT3R2).
   - In **Tab 1** (`/admin`), watch the **Account Verification Queue** update automatically in real time and click **Approve** on both accounts.
   - Sign in as **Faculty** in Tab 2 and as **Student** in Tab 3.
3. **Verify Real-Time Broadcasting**:
   - **Urgent Announcement Popups**: In Tab 2 (Faculty), click **Create Announcement**, toggle **Urgent High-Priority Override**, and publish. Tab 3 (Student) immediately displays the **Urgent Announcement Popup Modal**.
   - **Live Acknowledgment Counters**: In Tab 3 (Student), click **Acknowledge Receipt** inside the urgent popup or on an announcement card. Tab 2 (Faculty) immediately updates the `acknowledged_count / total_scoped_students` progress bar and percentage in real time.
   - **Live Channel Chat & Messaging**: Open the same Course Hub (`/channels/1`) in Tab 2 (Faculty) and Tab 3 (Student) and send messages in **Messenger Chat** — bubbles appear instantly across tabs without page reloads.
   - **Discussion Threads & Q&A**: In Tab 3 (Student), submit a question under **+ Ask in Q&A Thread**. In Tab 2 (Faculty), watch the ticket appear live in **Isolated Q&A Threads**, click **Answer**, and pin it to **Class FAQs** — Tab 3 updates immediately.

---

## 7. Verifying Records Directly in PostgreSQL

Run the following queries in `psql` or pgAdmin to inspect your live database state:

```sql
SELECT id, institutional_id, name, email, role, verification_status FROM users ORDER BY id DESC;
SELECT id, channel_id, publisher_id, title, is_urgent, status, published_at FROM announcements ORDER BY id DESC;
SELECT id, channel_id, sender_id, subject_hashtag, content, is_resolved, is_pinned_faq FROM messages ORDER BY id DESC;
SELECT id, course_code, name, channel_type, scope_section FROM channels ORDER BY id;
```
