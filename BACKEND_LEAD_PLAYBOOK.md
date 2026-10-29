# ClariFy — Backend Lead Architecture, Security & RESTful API Playbook

* **Project:** ClariFy (formerly USTP Connect) — Unified Campus Noticeboard & Scoped Communication Platform
* **Course & Section:** IT314 Software Engineering — IT3R2 Group 5 (USTP-CDO)
* **Backend Lead:** Jonathan Justiniani
* **Frontend Counterparts:** Archelle Aparici (FE-1), Zyra Nadine Flores (FE-2), Jazir Uzman Sambajon (FE-3), Zild Jan Abuga-a (FE-4)
* **SDLC Model:** Agile Development (2-Week Sprint & Stakeholder Feedback Cycles)
* **Architecture:** Decoupled Client-Server via RESTful API + Asynchronous Queue Workers & Real-Time Push Broadcasts
* **Backend Stack:** Laravel 13 REST API + PostgreSQL + Redis/Database Queues + Laravel Sanctum/JWT + Laravel Reverb / Expo Push API + Semaphore/Twilio SMS Gateway

---

## Purpose of This Document

This playbook is the **single source of truth for the ClariFy Backend (`clarify-api/`)**. It bridges our Software Requirements Analysis & System Design documentation with the **ClariFy Frontend Team Playbook & API Contract** used by FE-1 through FE-4. Both human developers and AI coding assistants (Cursor, GitHub Copilot, Claude, ChatGPT, and Gemini) working inside `clarify-api/` must strictly adhere to the database schemas, Eloquent relationships, middleware policies, security guards, and JSON response contracts defined in this document.

---

## 1. Agreed Architectural Approaches & Resolved Design Decisions

To guarantee 100% compatibility with our Requirement Traceability Matrix (Table D), Sequence Diagrams (Workflows 1–6), and the Frontend Team Playbook, the backend enforces the following architectural decisions:

### 1.1 Hybrid REST + Asynchronous Queue & Push Architecture (`NFR-02`)
* **Standard CRUD via REST:** All data fetching, filtering, publishing, Q&A ticketing, and admin operations run over stateless RESTful endpoints prefixed with `/api/v1/`.
* **Sub-2-Second Urgent Delivery ($\le 2.0\text{ seconds}$):** Pure HTTP polling fails during high-concurrency events like exam weeks or typhoon suspensions. Whenever an instructor or administrator publishes an announcement with `is_urgent = true`, `AnnouncementController@store` immediately returns `201 Created` to the client and dispatches two high-priority background jobs onto Laravel Queue workers:
  1. `DispatchUrgentPushAlerts`: Broadcasts real-time WebSocket events (via Laravel Reverb for `clarify-web`) and native push payloads (via Expo Push API / FCM for `clarify-mobile`) within $\le 2.0\text{ seconds}$ (`TC-NFR02`).
  2. `TriggerSmsFallbackBatch`: When `trigger_sms_fallback = true`, dispatches batched SMS advisories to the decrypted `contact_number` of all enrolled channel members (`NFR-02`, Stakeholder Review Table E).

### 1.2 Clean OOP-to-Relational Mapping (Single Table Auth + Scoped Profile)
* Our Class Diagram defines a parent `User` class inherited by `Student`, `Faculty`, `DepartmentChairDean`, and `ITAdministrator`.
* In PostgreSQL, we implement this using a single `users` table for authentication, RBAC role (`student`, `faculty`, `dept_head`, `it_admin`), and verification state, linked $1:1$ with an `academic_profiles` table storing USTP PRISMS organizational scopes (`college`, `department`, `program`, `year_level`, `section`).

### 1.3 Server-Side Anonymization & Data Privacy (`FR-07`, `NFR-05` / RA 10173)
* **1-Click FAQ Masking:** In Workflow 4 (`FR-07`), when an inquiry thread is converted into a Class FAQ (`is_pinned_faq = true`), `ThreadResource` strips the student's `sender_id`, `name`, and `avatar_url` on the server and serializes `"author": { "id": null, "name": "Anonymous Student", "role": "student" }` before the JSON payload ever leaves Laravel.
* **Private Inquiry Isolation:** In `FR-03_REV`, threads created with `is_private = true` are filtered at the SQL query level so only the original student author and instructors assigned to that channel can view them.
* **Field-Level Encryption at Rest:** User mobile numbers (`contact_number`) are encrypted at rest in PostgreSQL using Laravel's `'encrypted'` cast to comply with the Philippine Data Privacy Act of 2012 (RA 10173 / `NFR-05`).

### 1.4 Compatibility Route Alias for Automated Grading (`TC-NFR01`)
* Table D (`TC-NFR01`) specifies testing `POST /api/announcements/create` with a Student Bearer token to assert an `HTTP 403 Forbidden` response, while our frontend uses `POST /api/v1/announcements`.
* **Resolution:** `routes/api.php` registers **both** `POST /api/v1/announcements` and an alias `POST /api/announcements/create` pointing to `AnnouncementController@store` protected by the exact same `AnnouncementPolicy` middleware.

---

## 2. Backend-to-Frontend Integration Matrix

As Backend Lead, your controllers and API Resources directly power the vertical slices owned by your 4 frontend teammates:

| Teammate & Role | Frontend Domain | Backend Controllers You Provide | Key Middleware, Policies & Jobs |
| :--- | :--- | :--- | :--- |
| **Archelle Aparici (`FE-1`)** | Design System, Auth, Profile Settings (`FR-06`) & Scoped Channels (`FR-01_REV`, Workflows 1 & 5) | `AuthController`<br>`ProfileController`<br>`ChannelController` | `auth:sanctum`, `EnsureAccountVerified`, `EnforceChannelScope`, `ChannelPolicy` |
| **Zyra Nadine Flores (`FE-2`)** | Scoped Noticeboard Feed (`FR-04_REV`), Publisher Modal (`FR-02`), Search/Filter (`FR-05`), Read Reach & Audit UI (`NFR-03_REV`) | `AnnouncementController` | `AnnouncementPolicy` (403 for students & out-of-scope faculty), `AnnouncementObserver` (Audit log), `DispatchUrgentPushAlerts`, `TriggerSmsFallbackBatch` |
| **Jazir Uzman Sambajon (`FE-3`)** | Isolated Q&A Threads (`FR-03_REV`), Ticketing, 1-Click Class FAQs (`FR-07`) & Instructor Directory | `ThreadController`<br>`InstructorController` | `ThreadPolicy` (Private thread isolation, student edit/delete own unresolved post), `ThreadResource` (FAQ anonymization) |
| **Zild Jan Abuga-a (`FE-4`)** | IT Admin Console (`FR-08`, `FR-09`, `FR-10`, Workflow 6) & React Native Expo Push Integration (`NFR-02`) | `AccountController`<br>`SyncController` (or `AccountController@syncPrisms`)<br>`DeviceTokenController` | `role:it_admin` middleware, `SyncPrismsRoster` Artisan command, Expo Push Token registration |

---

## 3. Complete PostgreSQL Database Schema & Migration Blueprint

Use snake_case column names across all migrations so Eloquent models serialize directly to the snake_case JSON properties expected by `src/types/api.ts` in `clarify-web` and `clarify-mobile`.

### 3.1 `users` Table (`FR-06`, `FR-08`, `FR-09`, `NFR-01_REV`, `NFR-05`)
```php
Schema::create('users', function (Blueprint $table) {
    $table->id();
    $table->string('institutional_id', 32)->unique(); // e.g., "2020202020"
    $table->string('name');
    $table->string('email')->unique();
    $table->string('password');
    $table->text('contact_number')->nullable(); // Encrypted at rest via Eloquent cast (RA 10173)
    $table->string('avatar_url')->nullable();
    $table->enum('role', ['student', 'faculty', 'dept_head', 'it_admin'])->default('student');
    $table->enum('verification_status', ['pending', 'approved', 'rejected'])->default('pending');
    $table->timestamp('verified_at')->nullable();
    $table->foreignId('verified_by')->nullable()->constrained('users')->nullOnDelete();
    $table->rememberToken();
    $table->timestamps();
});
```

### 3.2 `academic_profiles` Table (`FR-01_REV`, `TC-FR01`)
```php
Schema::create('academic_profiles', function (Blueprint $table) {
    $table->id();
    $table->foreignId('user_id')->unique()->constrained()->cascadeOnDelete();
    $table->string('campus', 50)->default('CDO CAMPUS');
    $table->string('college', 50); // e.g., "CITC", "CEA", "COT", "CSM"
    $table->string('department', 100); // e.g., "Information Technology"
    $table->string('program', 50)->nullable(); // e.g., "BSIT"
    $table->unsignedTinyInteger('year_level')->nullable(); // 1, 2, 3, 4
    $table->string('section', 50)->nullable(); // e.g., "IT3R2"
    $table->string('semester_code', 32)->default('2026-1ST-SEM');
    $table->timestamps();
});
```

### 3.3 `channels` & `channel_user` Pivot Table (`FR-01_REV`, Workflow 5)
```php
Schema::create('channels', function (Blueprint $table) {
    $table->id();
    $table->string('course_code', 32)->nullable()->index(); // e.g., "IT314", "ES211a"
    $table->string('name'); // e.g., "#IT314 SoftEng"
    $table->text('description')->nullable();
    $table->enum('channel_type', ['university', 'college', 'department', 'course_hub'])->default('course_hub');
    $table->string('scope_college', 50)->nullable()->index();
    $table->string('scope_department', 100)->nullable();
    $table->string('scope_program', 50)->nullable();
    $table->unsignedTinyInteger('scope_year_level')->nullable();
    $table->string('scope_section', 50)->nullable();
    $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
    $table->timestamps();
});

Schema::create('channel_user', function (Blueprint $table) {
    $table->id();
    $table->foreignId('channel_id')->constrained()->cascadeOnDelete();
    $table->foreignId('user_id')->constrained()->cascadeOnDelete();
    $table->boolean('can_publish')->default(false); // True for assigned course instructor / dept_head
    $table->timestamp('joined_at')->useCurrent();
    $table->unique(['channel_id', 'user_id']);
});
```

### 3.4 `announcements`, `announcement_reads` & `announcement_audits` Tables (`FR-02`, `FR-04_REV`, `FR-05`, `NFR-03_REV`)
```php
Schema::create('announcements', function (Blueprint $table) {
    $table->id();
    $table->foreignId('channel_id')->constrained()->cascadeOnDelete();
    $table->foreignId('publisher_id')->constrained('users')->cascadeOnDelete();
    $table->string('title');
    $table->text('content');
    $table->string('attachment_url')->nullable();
    $table->jsonb('tags')->default('[]'); // e.g., ["URGENT NOTICE", "OFFICIAL MEMO", "CITC"]
    $table->boolean('is_urgent')->default(false)->index();
    $table->boolean('is_pinned')->default(false)->index();
    $table->boolean('trigger_sms_fallback')->default(false);
    $table->enum('status', ['draft', 'published', 'archived'])->default('published')->index();
    $table->boolean('is_edited')->default(false);
    $table->timestamp('published_at')->nullable()->index();
    $table->timestamps();
    $table->softDeletes(); // Supports Workflow 4 Activity Diagram archive/delete
});

Schema::create('announcement_reads', function (Blueprint $table) {
    $table->id();
    $table->foreignId('announcement_id')->constrained()->cascadeOnDelete();
    $table->foreignId('user_id')->constrained()->cascadeOnDelete();
    $table->timestamp('acknowledged_at')->useCurrent();
    $table->unique(['announcement_id', 'user_id']);
});

Schema::create('announcement_audits', function (Blueprint $table) {
    $table->id();
    $table->foreignId('announcement_id')->constrained()->cascadeOnDelete();
    $table->foreignId('editor_id')->constrained('users')->cascadeOnDelete();
    $table->string('previous_title');
    $table->text('previous_content');
    $table->string('new_title');
    $table->text('new_content');
    $table->timestamp('edited_at')->useCurrent();
});
```

### 3.5 `messages` Table (Isolated Q&A Threads & Replies — `FR-03_REV`, `FR-07`)
```php
Schema::create('messages', function (Blueprint $table) {
    $table->id();
    $table->foreignId('channel_id')->constrained()->cascadeOnDelete();
    $table->foreignId('announcement_id')->nullable()->constrained()->nullOnDelete();
    $table->foreignId('sender_id')->constrained('users')->cascadeOnDelete();
    $table->foreignId('parent_id')->nullable()->constrained('messages')->cascadeOnDelete(); // Null = root thread ticket; Not null = reply
    $table->string('subject_hashtag', 100)->nullable(); // e.g., "#Defence", "#grade_consultation"
    $table->text('content');
    $table->boolean('is_private')->default(false); // Table E: visible only to author & channel instructor
    $table->boolean('is_resolved')->default(false)->index();
    $table->boolean('is_pinned_faq')->default(false)->index(); // FR-07 1-Click FAQ
    $table->timestamps();
});
```

### 3.6 `device_tokens` & `prisms_sync_logs` Tables (`NFR-02`, `FR-10`)
```php
Schema::create('device_tokens', function (Blueprint $table) {
    $table->id();
    $table->foreignId('user_id')->constrained()->cascadeOnDelete();
    $table->string('expo_push_token')->unique();
    $table->enum('platform', ['android', 'ios', 'web'])->default('android');
    $table->timestamp('last_registered_at')->useCurrent();
    $table->timestamps();
});

Schema::create('prisms_sync_logs', function (Blueprint $table) {
    $table->id();
    $table->foreignId('admin_id')->nullable()->constrained('users')->nullOnDelete();
    $table->string('semester_code', 32);
    $table->enum('trigger_type', ['automated_cron', 'manual_admin'])->default('manual_admin');
    $table->unsignedInteger('total_updated')->default(0);
    $table->enum('status', ['success', 'partial_failure', 'failed'])->default('success');
    $table->jsonb('error_log')->nullable();
    $table->unsignedInteger('duration_ms')->default(0);
    $table->timestamps();
});
```

---

## 4. Laravel 13 Directory Structure & Core Class Blueprints

Organize `clarify-api/` exactly as mapped in Section 4 of the Team Playbook:

```text
clarify-api/
├── app/
│   ├── Console/Commands/
│   │   └── SyncPrismsRoster.php            # Automated 24h midnight PRISMS sync (FR-01_REV)
│   ├── Http/
│   │   ├── Controllers/Api/V1/
│   │   │   ├── AuthController.php          # Workflow 1: login, logout, me
│   │   │   ├── ProfileController.php       # FR-06: avatar upload & encrypted contact_number
│   │   │   ├── ChannelController.php       # Workflow 5: index, store, join, manageMembers
│   │   │   ├── AnnouncementController.php  # Workflows 2 & 3: index, store, update, destroy, acknowledge
│   │   │   ├── ThreadController.php        # Workflow 4: index, store, update, destroy, storeReply, convertFaq
│   │   │   ├── InstructorController.php    # Paginated directory of verified faculty
│   │   │   ├── AccountController.php       # Workflow 6: pending, verify, updateRole, syncPrisms, metrics
│   │   │   └── DeviceTokenController.php   # NFR-02: store Expo push token
│   │   ├── Middleware/
│   │   │   ├── EnsureAccountVerified.php   # Blocks unverified users (FR-08)
│   │   │   ├── EnforceChannelScope.php     # Validates user membership/scope in channel (FR-01_REV)
│   │   │   └── EnsureRole.php              # Lightweight RBAC gate (e.g., role:it_admin)
│   │   ├── Requests/
│   │   │   ├── StoreAnnouncementRequest.php
│   │   │   ├── UpdateAnnouncementRequest.php
│   │   │   ├── StoreThreadRequest.php
│   │   │   └── UpdateProfileRequest.php
│   │   └── Resources/
│   │       ├── UserResource.php
│   │       ├── ChannelResource.php
│   │       ├── AnnouncementResource.php
│   │       └── ThreadResource.php          # Masks student author when is_pinned_faq = true
│   ├── Jobs/
│   │   ├── DispatchUrgentPushAlerts.php    # High-priority queue job (<= 2.0s SLA, NFR-02)
│   │   └── TriggerSmsFallbackBatch.php     # Batched SMS fallback job (NFR-02)
│   ├── Models/
│   │   ├── User.php
│   │   ├── AcademicProfile.php
│   │   ├── Channel.php
│   │   ├── Announcement.php
│   │   ├── AnnouncementAudit.php           # Disables update() and delete() for immutability
│   │   ├── AnnouncementRead.php
│   │   ├── Message.php
│   │   ├── DeviceToken.php
│   │   └── PrismsSyncLog.php
│   ├── Observers/
│   │   └── AnnouncementObserver.php        # Logs edits to announcement_audits (NFR-03_REV)
│   └── Policies/
│       ├── AnnouncementPolicy.php          # Enforces FR-02, FR-04_REV & TC-NFR01
│       ├── ChannelPolicy.php
│       └── ThreadPolicy.php
├── database/
│   ├── migrations/
│   └── seeders/
│       └── ClarifyDemoSeeder.php           # Seeds Kobeni (Student), Aki (Faculty), IT314, ES211a, CITC
└── routes/
    ├── api.php                             # /api/v1/* routes + /api/announcements/create alias
    └── console.php                         # Schedule::command('prisms:sync')->dailyAt('00:00');
```

### 4.1 Immutable Audit Trail Blueprint (`NFR-03_REV` / `TC-NFR03`)
Register `AnnouncementObserver` on the `Announcement` model using the `#[ObservedBy([AnnouncementObserver::class])]` attribute:

```php
// app/Observers/AnnouncementObserver.php
namespace App\Observers;

use App\Models\Announcement;
use App\Models\AnnouncementAudit;
use Illuminate\Support\Facades\Auth;

class AnnouncementObserver
{
    public function updating(Announcement $announcement): void
    {
        if ($announcement->isDirty(['title', 'content'])) {
            $announcement->is_edited = true;

            AnnouncementAudit::create([
                'announcement_id'  => $announcement->id,
                'editor_id'        => Auth::id() ?? $announcement->publisher_id,
                'previous_title'   => $announcement->getOriginal('title'),
                'previous_content' => $announcement->getOriginal('content'),
                'new_title'        => $announcement->title,
                'new_content'      => $announcement->content,
                'edited_at'        => now(),
            ]);
        }
    }
}
```

And lock down `AnnouncementAudit.php` so audit records can never be modified or deleted:
```php
// app/Models/AnnouncementAudit.php
public function update(array $attributes = [], array $options = [])
{
    throw new \LogicException('NFR-03_REV Violation: Announcement audit logs are immutable.');
}

public function delete()
{
    throw new \LogicException('NFR-03_REV Violation: Announcement audit logs cannot be deleted.');
}
```

### 4.2 Role & Scope Authorization Blueprint (`FR-02`, `FR-04_REV`, `TC-NFR01`)
```php
// app/Policies/AnnouncementPolicy.php
namespace App\Policies;

use App\Models\Announcement;
use App\Models\Channel;
use App\Models\User;
use Illuminate\Auth\Access\Response;

class AnnouncementPolicy
{
    public function create(User $user, ?Channel $channel = null): Response
    {
        // 1. Block all students immediately (TC-NFR01 / FR-04_REV)
        if ($user->role === 'student') {
            return Response::deny('Access Denied: Students have read-only permissions on the noticeboard.', 403);
        }

        // 2. If channel is provided, validate scope boundaries (Workflow 2 / FR-02)
        if ($channel) {
            if (in_array($channel->channel_type, ['university', 'college', 'department'])) {
                return in_array($user->role, ['dept_head', 'it_admin'])
                    ? Response::allow()
                    : Response::deny('Only Department Heads, Deans, or IT Admins can publish campus/college-wide memos.', 403);
            }

            // Course Hub check: Faculty must be assigned to this channel with can_publish = true
            $isAssignedInstructor = $channel->members()
                ->where('users.id', $user->id)
                ->wherePivot('can_publish', true)
                ->exists();

            if (!$isAssignedInstructor && !in_array($user->role, ['dept_head', 'it_admin'])) {
                return Response::deny('You are not assigned to publish in this course hub.', 403);
            }
        }

        return Response::allow();
    }
}
```

### 4.3 Server-Side FAQ Anonymization Blueprint (`FR-07`, `NFR-05`)
```php
// app/Http/Resources/ThreadResource.php
namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ThreadResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $viewer = $request->user();
        $shouldMaskAuthor = $this->is_pinned_faq && ($viewer?->role === 'student' && $viewer?->id !== $this->sender_id);

        return [
            'id'              => $this->id,
            'channel_id'      => $this->channel_id,
            'announcement_id' => $this->announcement_id,
            'subject_hashtag' => $this->subject_hashtag,
            'content'         => $this->content,
            'is_private'      => (bool) $this->is_private,
            'is_resolved'     => (bool) $this->is_resolved,
            'is_pinned_faq'   => (bool) $this->is_pinned_faq,
            'created_at'      => $this->created_at?->toIso8601String(),
            'updated_at'      => $this->updated_at?->toIso8601String(),
            'author'          => $shouldMaskAuthor ? [
                'id'         => null,
                'name'       => 'Anonymous Student',
                'role'       => 'student',
                'avatar_url' => null,
            ] : [
                'id'         => $this->sender->id,
                'name'       => $this->sender->name,
                'role'       => $this->sender->role,
                'avatar_url' => $this->sender->avatar_url,
            ],
            'replies'         => ThreadReplyResource::collection($this->whenLoaded('replies')),
        ];
    }
}
```

---

## 5. Security, RBAC & RA 10173 Compliance Checklist

1. **Unified Bearer Token Authentication (`NFR-01_REV`):**
   * Configure **Laravel Sanctum** API tokens (or `tymon/jwt-auth`) with role abilities (`role:student`, `role:faculty`, `role:dept_head`, `role:it_admin`).
   * Both Next.js (`clarify-web`) and React Native Expo (`clarify-mobile`) authenticate via `Authorization: Bearer <token>`, ensuring identical security enforcement across Web and Mobile.
2. **Strict Mass-Assignment Protection:**
   * In `app/Models/User.php`, guard sensitive columns:
     ```php
     protected $fillable = ['institutional_id', 'name', 'email', 'password', 'contact_number', 'avatar_url'];
     protected $guarded = ['id', 'role', 'verification_status', 'verified_at', 'verified_by'];
     ```
   * This prevents privilege escalation via `POST /api/v1/profile` (`FR-06`).
3. **RA 10173 Field-Level Encryption (`NFR-05`):**
   * In `app/Models/User.php`, cast `contact_number` as encrypted:
     ```php
     protected function casts(): array
     {
         return [
             'password'       => 'hashed',
             'contact_number' => 'encrypted',
             'verified_at'    => 'datetime',
         ];
     }
     ```
4. **Private Inquiry Query Scoping (`FR-03_REV`, Table E):**
   * In `ThreadController@index`, always apply a scope filter so students never receive other students' private tickets in the JSON response:
     ```php
     $query->whereNull('parent_id')
           ->when($request->user()->role === 'student', function ($q) use ($request) {
               $q->where(function ($sub) use ($request) {
                   $sub->where('is_private', false)
                       ->orWhere('sender_id', $request->user()->id);
               });
           });
     ```

---

## 6. Complete RESTful API Blueprint & Implementation Specifications

Every endpoint below matches **Section 6.5 of the Frontend Team Playbook**.

### 6.1 Workflow 1 & `FR-06`: Authentication & User Profile (For `FE-1` & `FE-4`)

| Method & URI | Controller Action | Implementation Details & Validation Rules |
| :--- | :--- | :--- |
| `POST /api/v1/auth/login` | `AuthController@login` | Validates `institutional_id` (required, string) and `password` (required, string). Checks `verification_status === 'approved'` (`FR-08`); if `pending`, returns `403` with `{"message": "Your account is pending IT Administrator verification."}`. Returns `{ "message": "Login successful.", "token": "<bearer_token>", "data": UserResource }`. |
| `POST /api/v1/auth/logout` | `AuthController@logout` | Revokes `$request->user()->currentAccessToken()->delete()`. Returns `200 OK`. |
| `GET /api/v1/auth/me` | `AuthController@me` | Eager-loads `academicProfile` and `channels` and returns `new UserResource($request->user())`. |
| `POST /api/v1/profile`<br>*(with `_method: "PATCH"`)* | `ProfileController@update` | Accepts `multipart/form-data`. Validates `contact_number` (`nullable|string|regex:/^(\+63|0)9\d{9}$/`) and `avatar` (`nullable|image|mimes:jpg,jpeg,png,webp|max:2048`). Stores file in `storage/app/public/avatars` and updates `avatar_url`. |

### 6.2 Workflow 5 & `FR-01_REV`: Scoped Channels & Roster Management (For `FE-1`)

| Method & URI | Controller Action | Implementation Details & Validation Rules |
| :--- | :--- | :--- |
| `GET /api/v1/channels` | `ChannelController@index` | Supports `?search=&type=course_hub`. Returns channels where the user is enrolled or that match their `academic_profiles` scope (`college`, `department`, `program`, `year_level`, `section`). Includes `members_count` and `unread_announcements_count`. |
| `POST /api/v1/channels` | `ChannelController@store` | Restricted to `faculty`, `dept_head`, `it_admin`. Validates `name`, `course_code`, `description`, `channel_type`, and `scope` object. Attaches creator to `channel_user` with `can_publish = true`. |
| `POST /api/v1/channels/{id}/join` | `ChannelController@join` | Verifies the user's `AcademicProfile` matches the channel's college/department scope (`EnforceChannelScope`), then attaches user to `channel_user` (`can_publish = false`). |
| `POST /api/v1/channels/{id}/members` | `ChannelController@manageMembers` | Restricted to channel instructor or `it_admin`. Validates `user_id` (`required|exists:users,id`) and `action` (`required|in:add,remove`). Syncs or detaches member in `channel_user`. |

### 6.3 Workflows 2 & 3 (`FR-02`, `FR-04_REV`, `FR-05`, `NFR-02`, `NFR-03_REV`): Noticeboard Feed & Scoped Publishing (For `FE-2`)

| Method & URI | Controller Action | Implementation Details & Validation Rules |
| :--- | :--- | :--- |
| `GET /api/v1/announcements` | `AnnouncementController@index` | Supports `?channel_id=&search=&department=&tag=&sort=latest&page=1`.<br>**Ordering (`FR-04_REV`):** Always order by `is_pinned DESC, is_urgent DESC, published_at DESC`.<br>**Filtering (`FR-05`):** Filters by `channel.course_code` or `title`/`content` (`search`), `channel.scope_college` (`department`), and JSONB containment `whereJsonContains('tags', $tag)`. Paginates `per_page = 10`. |
| `POST /api/v1/announcements`<br>*(Alias: `POST /api/announcements/create`)* | `AnnouncementController@store` | Enforces `AnnouncementPolicy@create` (returns `403 Forbidden` for `student` tokens — `TC-NFR01`). Accepts `multipart/form-data`: `channel_id`, `title`, `content`, `tags[]`, `is_urgent`, `trigger_sms_fallback`, `status` (`published`\|`draft`), `attachment` (`nullable|file|mimes:pdf,png,jpg,jpeg,docx|max:10240`). If `status === 'published'` and `is_urgent === true`, dispatches `DispatchUrgentPushAlerts::dispatch($announcement)` and (if `trigger_sms_fallback`) `TriggerSmsFallbackBatch::dispatch($announcement)`. |
| `PATCH /api/v1/announcements/{id}` | `AnnouncementController@update` | Enforces `AnnouncementPolicy@update`. Updates `title`, `content`, `tags`, `is_urgent`, `is_pinned`. Automatically triggers `AnnouncementObserver@updating` to insert an immutable row in `announcement_audits` and set `is_edited = true` (`TC-NFR03`). |
| `DELETE /api/v1/announcements/{id}` | `AnnouncementController@destroy` | Enforces `AnnouncementPolicy@delete`. Sets `status = 'archived'` and soft-deletes the announcement. |
| `POST /api/v1/announcements/{id}/acknowledge` | `AnnouncementController@acknowledge` | Uses `AnnouncementRead::firstOrCreate(['announcement_id' => $id, 'user_id' => auth()->id()])`. Returns updated `read_reach` object (`acknowledged_count`, `enrolled_total`, `percentage`, `has_current_user_acknowledged: true`). |

### 6.4 Workflow 4 (`FR-03_REV`, `FR-07`): Isolated Q&A Threads, Replies & 1-Click FAQs (For `FE-3`)

| Method & URI | Controller Action | Implementation Details & Validation Rules |
| :--- | :--- | :--- |
| `GET /api/v1/channels/{id}/threads` | `ThreadController@index` | Supports `?announcement_id=&status=resolved|open|faq`. Filters out `is_private = true` threads for other students. Eager-loads `sender` and nested `replies.sender`. Serializes via `ThreadResource`. |
| `POST /api/v1/channels/{id}/threads` | `ThreadController@store` | Validates `announcement_id` (`nullable|exists:announcements,id`), `subject_hashtag` (`required|string|max:100`), `content` (`required|string`), `is_private` (`boolean`). Creates root `Message` (`parent_id = null`). |
| `PATCH /api/v1/threads/{id}`<br>`DELETE /api/v1/threads/{id}` | `ThreadController@update`<br>`ThreadController@destroy` | Workflow 3 Activity Diagram: Allows a student to edit or delete their own inquiry **only if** `is_resolved === false` and `sender_id === auth()->id()`. |
| `POST /api/v1/threads/{id}/replies` | `ThreadController@storeReply` | Validates `content` (`required|string`), `mark_resolved` (`boolean`), `pin_to_faq` (`boolean`). Creates child `Message` (`parent_id = $id`). If user is `faculty`/`dept_head`, updates parent thread's `is_resolved` and `is_pinned_faq` flags (`TC-FR03`). |
| `POST /api/v1/threads/{id}/convert-faq` | `ThreadController@convertFaq` | Restricted to channel instructor / `dept_head`. Sets `is_resolved = true` and `is_pinned_faq = true` on the root thread. Returns `new ThreadResource($thread)` which masks the student author as `"Anonymous Student"` (`TC-FR07`). |
| `GET /api/v1/instructors` | `InstructorController@index` | Supports `?search=&department=CITC&sort=name&page=1`. Queries `User::whereIn('role', ['faculty', 'dept_head'])->where('verification_status', 'approved')` with `academicProfile`, paginated (`per_page = 12`). |

### 6.5 Workflow 6 (`FR-08`, `FR-09`, `FR-10`, `NFR-02`): IT Admin Console & Push Registration (For `FE-4`)

| Method & URI | Controller Action | Implementation Details & Validation Rules |
| :--- | :--- | :--- |
| `GET /api/v1/admin/users/pending` | `AccountController@pending` | Restricted to `role:it_admin`. Lists users with `verification_status = 'pending'`, supporting `?search=&page=1` (`TC-FR08`). |
| `PATCH /api/v1/admin/users/{id}/verify` | `AccountController@verify` | Restricted to `role:it_admin`. Validates `verification_status` (`required|in:approved,rejected`). Sets `verified_at = now()` and `verified_by = auth()->id()` (`TC-FR08`). |
| `PATCH /api/v1/admin/users/{id}/role` | `AccountController@updateRole` | Restricted to `role:it_admin`. Validates `role` (`required|in:student,faculty,dept_head,it_admin`). Updates user role and revokes existing tokens if downgraded (`TC-FR09`). |
| `POST /api/v1/admin/sync-prisms` | `AccountController@syncPrisms` | Restricted to `role:it_admin`. Validates `semester_code` (`required|string`). Invokes `Artisan::call('prisms:sync', ['semester' => $semester_code, '--trigger' => 'manual_admin'])`. Returns latest `PrismsSyncLog` with `total_updated` (`TC-FR10`). |
| `GET /api/v1/admin/metrics` | `AccountController@metrics` | Restricted to `role:it_admin`. Returns JSON containing `system_health` (active users count, queue worker latency, pending SMS jobs), `recent_sync_logs` (`PrismsSyncLog::latest()->take(10)`), and `recent_audits` (`AnnouncementAudit::with(['editor', 'announcement'])->latest()->take(20)`). |
| `POST /api/v1/devices/token` | `DeviceTokenController@store` | Authenticated users (`FE-4` Mobile App). Validates `expo_push_token` (`required|string`) and `platform` (`required|in:android,ios,web`). Upserts into `device_tokens` for $\le 2.0\text{s}$ urgent push dispatch (`TC-NFR02`). |

---

## 7. Backend 2-Week Sprint Execution Plan & Automated Test Matrix

To keep FE-1, FE-2, FE-3, and FE-4 unblocked during parallel development, deliver the backend in this order and verify each milestone with Pest / PHPUnit feature tests mapped to **Table D (RTM)**:

### Sprint 1: Core Auth, PRISMS Sync, Scoped Channels & Noticeboard CRUD (High Priority)
1. **Day 1–2:** Initialize `clarify-api` (Laravel 13 + PostgreSQL), run all migrations in Section 3, and create `ClarifyDemoSeeder.php` (seeding Student *Kobeni*, Faculty *Aki Hayakawa*, IT Admin, Department Head, `#IT314 SoftEng`, `#ES211a`, and `CITC` channels).
2. **Day 3–4:** Implement `AuthController`, `EnsureAccountVerified`, and `ChannelController` (unblocks **Archelle / FE-1**).
3. **Day 5–7:** Implement `AnnouncementController`, `AnnouncementPolicy`, `AnnouncementObserver`, and `AnnouncementResource` with `read_reach` computation (unblocks **Zyra / FE-2**).
4. **Day 8–10:** Implement `AccountController` (`pending`, `verify`, `updateRole`, `syncPrisms`, `metrics`) and `SyncPrismsRoster` command (unblocks **Zild / FE-4**).

### Sprint 2: Isolated Q&A Threads, 1-Click FAQs & Search/Filter (High/Medium Priority)
1. **Day 1–4:** Implement `ThreadController` (`index`, `store`, `update`, `destroy`, `storeReply`, `convertFaq`) and `ThreadResource` with `"Anonymous Student"` masking (unblocks **Jazir / FE-3**).
2. **Day 5–7:** Implement `InstructorController@index` and refine `AnnouncementController@index` multi-parameter search (`course_code`, `department`, `tags`, `sort`) (`FR-05`).
3. **Day 8–10:** Write automated Feature Tests for `TC-FR01` through `TC-NFR03`.

### Sprint 3: Profile Upload, $\le 2.0\text{s}$ Real-Time Push & SMS Fallback (Medium Priority)
1. **Day 1–3:** Implement `ProfileController@update` with avatar storage and encrypted `contact_number` (`FR-06`, `NFR-05`).
2. **Day 4–7:** Implement `DeviceTokenController`, `DispatchUrgentPushAlerts` (Reverb WebSockets + Expo Push API), and `TriggerSmsFallbackBatch` (Semaphore/Twilio HTTP client) (`NFR-02`).
3. **Day 8–10:** End-to-end integration testing with `clarify-web` and `clarify-mobile`, verifying $\le 2.0\text{ seconds}$ push latency (`TC-NFR02`).

### Automated Feature Test Checklist (`tests/Feature/ClarifyRtmTest.php`)
* `test_tc_fr01_prisms_sync_enrolls_student_in_scoped_channels()` $\rightarrow$ Asserts `BSIT 3rd Year` student is auto-attached to `CITC` and `IT314` channels.
* `test_tc_fr02_faculty_cannot_publish_outside_assigned_course_hub()` $\rightarrow$ Asserts `HTTP 403` when Faculty *Aki* attempts to post in an unassigned course hub or university-wide channel.
* `test_tc_fr03_student_inquiry_and_instructor_resolution()` $\rightarrow$ Asserts reply creation and `is_resolved === true`.
* `test_tc_fr04_feed_orders_pinned_urgent_announcements_first()` $\rightarrow$ Asserts `is_pinned = true` posts appear at index `0` regardless of creation timestamp.
* `test_tc_fr07_convert_faq_masks_student_identity()` $\rightarrow$ Asserts `GET /api/v1/channels/{id}/threads?status=faq` returns `"author.name": "Anonymous Student"` and `"author.id": null`.
* `test_tc_nfr01_student_bearer_token_receives_403_on_announcement_create()` $\rightarrow$ Sends `POST /api/announcements/create` and `POST /api/v1/announcements` with Student token and asserts `HTTP 403 Forbidden`.
* `test_tc_nfr03_editing_announcement_creates_immutable_audit_log()` $\rightarrow$ Sends `PATCH /api/v1/announcements/{id}` and asserts `is_edited === true` and `assertDatabaseHas('announcement_audits', [...])`.

---

## 8. Rules for AI Coding Tools Working in `clarify-api/`

> **AI SYSTEM INSTRUCTION (BACKEND):** If you are an AI coding assistant (Cursor, GitHub Copilot, Claude, ChatGPT, or Gemini) generating or modifying code inside `clarify-api/`, you must obey these rules on every prompt:
> 1. **Match the Frontend JSON Contract Exactly:** Never rename JSON keys in API Resources. Always serialize `snake_case` keys matching Section 6 of the Playbook (`is_urgent`, `is_pinned`, `is_edited`, `attachment_url`, `read_reach`, `is_private`, `is_resolved`, `is_pinned_faq`, `subject_hashtag`).
> 2. **Enforce All 3 Authorization Layers:** Every mutating endpoint (`POST`, `PATCH`, `DELETE`) must verify (a) `auth:sanctum` + `EnsureAccountVerified`, (b) Role permission (`AnnouncementPolicy` / `ThreadPolicy` / `EnsureRole`), and (c) Channel scope assignment (`can_publish` pivot check).
> 3. **Never Expose Student Identity on Public FAQs:** Whenever `is_pinned_faq === true`, `ThreadResource` must mask the student's identity as `"Anonymous Student"` (`FR-07`, `NFR-05`).
> 4. **Keep Audit Logs Append-Only:** Never add update or delete routes/methods for `AnnouncementAudit` (`NFR-03_REV`).
> 5. **Queue External I/O:** Never send push notifications or SMS HTTP requests synchronously inside a controller action; always dispatch `DispatchUrgentPushAlerts` and `TriggerSmsFallbackBatch` onto the queue so API response times stay fast (`NFR-02`).