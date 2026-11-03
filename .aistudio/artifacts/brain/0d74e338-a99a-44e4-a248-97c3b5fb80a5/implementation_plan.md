# Fix `Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL` Crash on Vercel

This plan resolves the runtime crash shown in the browser console (`Uncaught Error: Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL`) when loading the deployed Next.js app on Vercel.

## User Review & Critical Decisions

> [!IMPORTANT]
> The console screenshot pinpoints the exact root cause. Please review the fix below and click **Proceed** to apply it.

- **Why the Crash Happened**:
  - `@supabase/supabase-js` throws `Uncaught Error: Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL` inside `createClient()` whenever `NEXT_PUBLIC_SUPABASE_URL` is either missing, contains quotes/whitespace, lacks the `https://` protocol (e.g., `xyz.supabase.co`), is set to a `postgresql://...` database connection URI instead of the Supabase Project URL, or is a non-URL string.
  - Because `createClient()` was called eagerly at module import time in `clarify-web/lib/supabase.ts`, any non-HTTP/HTTPS value in `NEXT_PUBLIC_SUPABASE_URL` crashed the client bundle on load.
- **How We Will Fix It**:
  1. **Smart URL Normalization & Strict HTTP/HTTPS Validation**:
     - Trim surrounding whitespace and quotes from `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
     - If `NEXT_PUBLIC_SUPABASE_URL` was set to a `postgresql://` connection string (e.g. `postgres.<project-ref>` or `db.<project-ref>.supabase.co`), automatically extract `<project-ref>` and derive `https://<project-ref>.supabase.co`.
     - If `NEXT_PUBLIC_SUPABASE_URL` is a bare domain like `<project-ref>.supabase.co`, automatically prefix `https://`.
     - Validate the final URL with `new URL(...)` to confirm its protocol is `http:` or `https:`.
  2. **Crash-Proof Lazy Client Initialization**:
     - Only instantiate `createClient()` inside a `try / catch` block when both a validated `https://` URL and anon key are present (`getSupabaseClient()`), returning `null` safely if unconfigured or invalid so the application never crashes on startup.

---

## Technical Changes

### 1. Crash-Proof Supabase Helper (`clarify-web/lib/supabase.ts`)
- Export `resolveValidSupabaseUrl(raw?: string): string | null` to normalize and validate `NEXT_PUBLIC_SUPABASE_URL`.
- Export `getSupabaseClient(): SupabaseClient | null` and `isSupabaseConfigured: boolean` wrapped in a `try / catch` guard so `createClient` can never throw an unhandled exception at module load time.

### 2. Safe Realtime Subscription Guard (`clarify-web/src/components/threads/MessengerChatBox.tsx`)
- Retrieve the validated client via `const supabaseClient = getSupabaseClient();` inside the `useEffect` hook.
- Only subscribe and call `supabaseClient.removeChannel(realtimeChannel)` when `supabaseClient` is non-null, while Optimistic UI updates and REST/SSE messaging continue to work regardless of whether Supabase Realtime environment variables are configured on Vercel.
