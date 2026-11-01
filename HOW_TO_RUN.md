# ClariFy — How to Run Locally with PostgreSQL

This guide walks you through running **ClariFy** locally with a real **PostgreSQL** database so that every Announcement, Course Hub Channel, Roster change, Messenger Chat message, Q&A Inquiry Thread, Faculty Reply, Class FAQ conversion, Profile update, and IT Administrator action is saved directly to your PostgreSQL tables and synced in real time across Student, Faculty, and IT Administrator sessions.

---

## 1. Prerequisites

Make sure you have the following installed on your machine:

- **PostgreSQL 14+** (`psql` or pgAdmin 4)
- **Node.js 20+** and `npm`
- **PHP 8.2+** and **Composer** (if running the Laravel 13 API backend alongside Next.js)

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

## 3. Option A: Run with Both Laravel 13 API + Next.js Frontend (Full Stack)

### Step 3.1 — Configure & Seed the Laravel 13 Backend (`/clarify-api`)

1. Open a terminal and navigate to `clarify-api`:
   ```bash
   cd clarify-api
   composer install
   cp .env.example .env
   php artisan key:generate
   ```

2. Edit `clarify-api/.env` so the database variables match your local PostgreSQL credentials:
   ```env
   DB_CONNECTION=pgsql
   DB_HOST=127.0.0.1
   DB_PORT=5432
   DB_DATABASE=clarify_db
   DB_USERNAME=postgres
   DB_PASSWORD=your_postgres_password
   ```

3. Run migrations and seed the baseline USTP users and initial course channel:
   ```bash
   php artisan migrate:fresh --seed
   ```

4. Start the Laravel API server on port `8000`:
   ```bash
   php artisan serve --host=127.0.0.1 --port=8000
   ```

### Step 3.2 — Configure & Start the Next.js Frontend (`/clarify-web`)

1. Open a second terminal and navigate to `clarify-web`:
   ```bash
   cd clarify-web
   npm install
   ```

2. Create `clarify-web/.env.local` with both your PostgreSQL connection and Laravel backend URL:
   ```env
   # Direct PostgreSQL connection for Next.js API routes
   DB_HOST=127.0.0.1
   DB_PORT=5432
   DB_DATABASE=clarify_db
   DB_USERNAME=postgres
   DB_PASSWORD=your_postgres_password

   # Optional: Forward /api/v1/* requests to Laravel 13 when running php artisan serve
   LARAVEL_BACKEND_URL=http://127.0.0.1:8000
   ```

3. Start the Next.js development server on port `3000`:
   ```bash
   npm run dev
   ```

4. Open **http://localhost:3000** in your browser.

---

## 4. Option B: Run Next.js Directly Connected to PostgreSQL (Single Command)

Next.js includes a direct PostgreSQL adapter (`src/server/postgres-adapter.ts`) that connects directly to your `clarify_db` database using the `pg` driver, automatically ensures all tables and the 4 baseline role accounts exist without overwriting your data, and executes `INSERT` / `UPDATE` / `DELETE` queries directly against PostgreSQL.

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

4. Open **http://localhost:3000** in your browser.

---

## 5. Seeded IT Admin & Student/Faculty Sign Up Workflow

Only the **IT Administrator** account is seeded in the database. **Student** and **Faculty** users create their own accounts via the **Sign Up** page (`/register`):

| Role Domain | Institutional ID | Password | How to Access |
| :--- | :--- | :--- | :--- |
| **IT Administrator (Seeded)** | `90001` | `ustp2026` | Pre-seeded in PostgreSQL (`DatabaseSeeder.php`). Approves/rejects pending Student & Faculty sign-ups, manages roles, triggers PRISMS sync, and reviews announcement audit logs. |
| **Student** | Created on `/register` | Created on `/register` | Register on `/register` &rarr; Account is saved as `pending` &rarr; IT Admin (`90001`) clicks **Approve** in `/admin` &rarr; Student can now sign in on `/login`. |
| **Faculty** | Created on `/register` | Created on `/register` | Register on `/register` &rarr; Account is saved as `pending` &rarr; IT Admin (`90001`) clicks **Approve** in `/admin` &rarr; Faculty can now sign in on `/login`. |

---

## 6. Verifying Registration & Database Persistence in PostgreSQL

1. Open `http://localhost:3000/register` and create a **Faculty** account and a **Student** account.
2. Open `http://localhost:3000/login` and sign in as the seeded **IT Administrator** (`90001` / `ustp2026`).
3. In the **IT Admin Console** (`/admin`), under **1. Account Verification Queue**, click **Approve** on your newly registered Faculty and Student accounts.
4. Sign in with your newly approved **Faculty** account in one browser window and your **Student** account in an Incognito window to test real-time Announcements, Course Hub Messenger Chat, and Q&A Threads.
5. Verify the saved records directly in `psql` or pgAdmin:
   ```sql
   SELECT id, institutional_id, name, email, role, verification_status FROM users ORDER BY id DESC;
   SELECT id, channel_id, publisher_id, title, is_urgent, status, published_at FROM announcements ORDER BY id DESC;
   SELECT id, channel_id, sender_id, subject_hashtag, content, is_resolved, is_pinned_faq FROM messages ORDER BY id DESC;
   SELECT id, course_code, name, channel_type, scope_section FROM channels ORDER BY id;
   ```

