# Implementation Plan: Remove FR/NFR Labels, Add Student & Faculty Sign Up, and Restrict Seeders to IT Admin

## 1. Remove All `FR-*` and `NFR-*` Texts Across the Application
We will clean up all Functional Requirement (`FR-01` through `FR-10`, `FR-03_REV`, etc.) and Non-Functional Requirement (`NFR-01` through `NFR-05`, `NFR-01_REV`, `TC-NFR01`, etc.) labels from user-facing UI components, modal headers, subtitles, badges, error messages, and API response messages so the interface reads like a clean production campus platform:
- **Pages**:
  - `/clarify-web/app/page.tsx` (Noticeboard headers, scoping descriptions, urgent/pinned badges)
  - `/clarify-web/app/announcements/page.tsx` (Full-page noticeboard descriptions and empty states)
  - `/clarify-web/app/channels/[id]/page.tsx` (Course Hub Messenger & Q&A Forum tabs, FAQ conversion labels)
  - `/clarify-web/app/instructors/page.tsx` (Instructor Directory descriptions and consultation hours labels)
  - `/clarify-web/app/admin/page.tsx` (IT Admin Console verification queue, role assignment, PRISMS sync, and system telemetry labels)
  - `/clarify-web/app/login/page.tsx` (Pending verification alert and login form subtitles)
- **Components & Modals**:
  - `/clarify-web/src/components/layout/TopHeader.tsx` & `LeftSidebar.tsx`
  - `/clarify-web/src/components/announcements/AnnouncementCard.tsx`
  - `/clarify-web/src/components/threads/ThreadList.tsx`
  - `/clarify-web/src/components/modals/CreateAnnouncementModal.tsx`, `EditProfileModal.tsx`, `AuditHistoryModal.tsx`, `CreateChannelModal.tsx`, `ManageMembersModal.tsx`
- **API & Validation Messages**:
  - `/clarify-web/src/server/postgres-adapter.ts` & `/clarify-api/app/Http/Controllers/Api/V1/*.php` & `EnsureAccountVerified.php` (Remove `(FR-08)`, `(FR-09)`, `(NFR-03)` suffixes from HTTP messages).

---

## 2. Student & Faculty Sign Up Page (`/register`) & Registration API
We will build a dedicated Sign Up page (`/clarify-web/app/register/page.tsx`) and link it directly from the Login page (`/clarify-web/app/login/page.tsx`):
- **Sign Up Form Fields**:
  - **Role Selection**: `Student` or `Faculty` (IT Admin accounts cannot be self-registered and are provisioned strictly via the database seeder)
  - **Full Name**: e.g., `Juan Dela Cruz`
  - **Institutional ID**: e.g., `2024101234` (validated for uniqueness)
  - **Institutional Email**: e.g., `juan.delacruz@ustp.edu.ph` (validated for uniqueness and email format)
  - **Department & Section**:
    - Department selector (e.g., `CITC`, `CEA`, `CSM`, `COT`, `CSTE`, `SHS`)
    - Section / Academic Unit input (e.g., `IT3R2` for Students or `CITC Dept` for Faculty)
  - **Password & Confirm Password**: Minimum 6 characters
- **Pending Verification Workflow**:
  - Submitting the Sign Up form calls `POST /api/v1/auth/register`.
  - The newly created Student or Faculty account is saved to PostgreSQL (`users` + `academic_profiles`) and auto-enrolled in matching default/department channels with `verification_status = 'pending'`.
  - Upon registration, the user sees a clear confirmation screen explaining that their account has been created with **Pending Verification** status and must be approved by the **IT Administrator** before signing in.
  - When the IT Admin signs in (`90001`), the newly registered Student or Faculty account immediately appears in the **Pending Registrar Verification Queue** on `/admin` (and syncs in real time), where the IT Admin can click **Approve** to grant login access.
- **Backend Registration Endpoints**:
  - **Next.js Direct PostgreSQL Adapter** (`/clarify-web/src/server/postgres-adapter.ts`): Handle `POST /api/v1/auth/register`, validate required fields and uniqueness of `institutional_id` and `email`, insert into `users` (`verification_status = 'pending'`) and `academic_profiles`, and enroll the user into matching channels.
  - **Laravel 13 Backend** (`/clarify-api/app/Http/Controllers/Api/V1/AuthController.php` & `/clarify-api/routes/api.php`): Add `POST /api/v1/auth/register` with `Hash::make($password)`, `AcademicProfile::create(...)`, and channel membership sync.
  - **Frontend API Client** (`/clarify-web/src/lib/api-client.ts`): Add `registerApi(payload)` helper.

---

## 3. Restrict Seeders to IT Administrator Only & Update Login Quick-Fill
- **Laravel Seeder (`/clarify-api/database/seeders/DatabaseSeeder.php`)**:
  - Seed **only** the IT Administrator account (`institutional_id: '90001'`, `name: 'Engr. Makima Cruz'`, `role: 'it_admin'`, `verification_status: 'approved'`) and its `AcademicProfile`, plus the initial default `# IT314 SoftEng` Course Hub channel and initial PRISMS sync log so the campus workspace is ready for newly registered Faculty and Students.
  - Remove the pre-seeded Student (`2020202020`), Faculty (`10492`), and Pending Student (`2023309999`) accounts from the seeder.
- **Next.js PostgreSQL Bootstrap (`/clarify-web/src/server/postgres-adapter.ts`)**:
  - Update `ensurePostgresSchema` so that only the IT Administrator account (`90001`) and default `# IT314 SoftEng` channel are seeded on bootstrap, and remove any existing pre-seeded demo users (`2020202020`, `10492`, `2023309999`) if they were auto-created by previous bootstrap runs.
- **Login Page (`/clarify-web/app/login/page.tsx`)**:
  - Keep **only** the **IT Admin (`90001`)** quick-fill demo button on the left institutional panel.
  - Add a prominent **"Create Student or Faculty Account (Sign Up)"** button/link on both the left institutional card and below the Sign In form to navigate to `/register`.
