# ClariFy Web (`clarify-web`) — USTP Centralized Academic Communication Platform

This directory contains the Next.js 15 App Router frontend and direct PostgreSQL API adapter for **ClariFy**. All mock files and in-memory mock toggles have been removed so that all features persist directly to your PostgreSQL database (`clarify_db`) and synchronize in real time via Server-Sent Events (`/api/v1/realtime`).

For full setup instructions covering both **Direct PostgreSQL** and **Laravel 13 API + PostgreSQL**, see [`../HOW_TO_RUN.md`](../HOW_TO_RUN.md).

## Quick Start (PostgreSQL)

1. Ensure PostgreSQL is running and create the database:
   ```sql
   CREATE DATABASE clarify_db;
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create `.env.local` in `clarify-web/`:
   ```env
   DB_HOST=127.0.0.1
   DB_PORT=5432
   DB_DATABASE=clarify_db
   DB_USERNAME=postgres
   DB_PASSWORD=your_postgres_password

   # Optional: If you also run `php artisan serve --port=8000` in ../clarify-api
   # LARAVEL_BACKEND_URL=http://127.0.0.1:8000
   ```

4. Start the development server on port `3000`:
   ```bash
   npm run dev
   ```

5. Log in at `http://localhost:3000/login` using one of the role accounts:
   - **Student**: `2020202020` / `ustp2026`
   - **Faculty**: `10492` / `ustp2026`
   - **IT Administrator**: `90001` / `ustp2026`
