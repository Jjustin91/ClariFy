import type {
  AdminMetricsResponse,
  Announcement,
  Channel,
  Instructor,
  PrismsSyncLog,
  QaThread,
  User,
  UserRole,
} from '../types/api';
import {
  DEMO_USERS,
  INITIAL_ADMIN_METRICS,
  INITIAL_ALL_USERS,
  INITIAL_ANNOUNCEMENTS,
  INITIAL_CHANNELS,
  INITIAL_INSTRUCTORS,
  INITIAL_PENDING_USERS,
  INITIAL_THREADS,
} from '../mocks/seed-data';
import {
  canPublishOrManageAnnouncements,
  canResolveOrPinThreads,
  enforceFaqAnonymity,
  filterAndSortAnnouncements,
  formatSubjectHashtag,
} from '../lib/domain-logic';

export interface ApiEngineRequest {
  method: string;
  path: string; // e.g., "/auth/login", "/announcements", "/channels/7/threads"
  query?: Record<string, string | undefined>;
  headers?: Record<string, string | undefined>;
  body?: Record<string, unknown>;
}

export interface ApiEngineResponse {
  status: number;
  body: Record<string, unknown>;
}

interface ServerStore {
  users: User[];
  pendingUsers: User[];
  channels: Channel[];
  announcements: Announcement[];
  announcementReadsByUser: Record<number, number[]>; // announcementId -> array of userIds
  threads: QaThread[];
  instructors: Instructor[];
  metrics: AdminMetricsResponse;
  tokens: Record<string, number>; // bearer token -> userId
  deviceTokens: Array<{
    id: number;
    user_id: number;
    expo_push_token: string;
    platform: 'android' | 'ios' | 'web';
    last_registered_at: string;
  }>;
}

const globalForClarify = globalThis as unknown as {
  __clarifyApiStore?: ServerStore;
};

function createInitialStore(): ServerStore {
  const users = structuredClone(INITIAL_ALL_USERS);
  const pendingUsers = structuredClone(INITIAL_PENDING_USERS);
  const channels = structuredClone(INITIAL_CHANNELS);
  const announcements = structuredClone(INITIAL_ANNOUNCEMENTS);
  const threads = structuredClone(INITIAL_THREADS);
  const instructors = structuredClone(INITIAL_INSTRUCTORS);
  const metrics = structuredClone(INITIAL_ADMIN_METRICS);

  // Track per-user read acknowledgments matching DatabaseSeeder.php
  const announcementReadsByUser: Record<number, number[]> = {
    42: [10492], // Aki acknowledged #42; Student Kobeni (id=1) has not yet acknowledged #42
    41: [10492],
    40: [1, 10492],
    39: [1, 10496],
    38: [1, 10493],
    37: [1, 90001],
  };

  const tokens: Record<string, number> = {
    'clarify-jwt-student-2020202020': DEMO_USERS.student.id,
    'clarify-jwt-faculty-10492': DEMO_USERS.faculty.id,
    'clarify-jwt-it_admin-90001': DEMO_USERS.it_admin.id,
    '1|clarify-sanctum-student-2020202020': DEMO_USERS.student.id,
    '2|clarify-sanctum-faculty-10492': DEMO_USERS.faculty.id,
    '3|clarify-sanctum-admin-90001': DEMO_USERS.it_admin.id,
  };

  return {
    users,
    pendingUsers,
    channels,
    announcements,
    announcementReadsByUser,
    threads,
    instructors,
    metrics,
    tokens,
    deviceTokens: [],
  };
}

export function getServerStore(): ServerStore {
  if (!globalForClarify.__clarifyApiStore) {
    globalForClarify.__clarifyApiStore = createInitialStore();
  }
  return globalForClarify.__clarifyApiStore;
}

export function resetServerStore(): void {
  globalForClarify.__clarifyApiStore = createInitialStore();
}

function resolveUserFromBearer(
  store: ServerStore,
  authHeader?: string
): { user: User | null; pendingUser: User | null } {
  if (!authHeader) {
    return { user: null, pendingUser: null };
  }
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return { user: null, pendingUser: null };
  }

  const mappedUserId = store.tokens[token];
  if (mappedUserId !== undefined) {
    const approved = store.users.find((u) => u.id === mappedUserId) || null;
    const pending =
      store.pendingUsers.find((u) => u.id === mappedUserId) || null;
    return { user: approved, pendingUser: pending };
  }

  // Fallback pattern matching for demo JWT tokens: clarify-jwt-<role>-<institutional_id>
  const demoMatch = token.match(/^clarify-jwt-([a-z_]+)-(.+)$/i);
  if (demoMatch) {
    const role = demoMatch[1] as UserRole;
    const instId = demoMatch[2];
    const byId =
      store.users.find((u) => u.institutional_id === instId) ||
      (role === 'faculty'
        ? store.users.find((u) => u.role === 'faculty')
        : role === 'it_admin'
        ? store.users.find((u) => u.role === 'it_admin')
        : store.users.find((u) => u.role === 'student')) ||
      null;
    const pending =
      store.pendingUsers.find((u) => u.institutional_id === instId) || null;
    return { user: byId, pendingUser: pending };
  }

  return { user: null, pendingUser: null };
}

function serializeAnnouncementForUser(
  store: ServerStore,
  ann: Announcement,
  user: User | null
): Announcement {
  const userIds = store.announcementReadsByUser[ann.id] || [];
  const hasAck = user ? userIds.includes(user.id) : false;

  // Compute read_reach dynamically if student acknowledged
  let ackCount = ann.read_reach.acknowledged_count;
  if (ann.id === 42) {
    ackCount = userIds.length;
  } else if (hasAck && !ann.read_reach.has_current_user_acknowledged) {
    ackCount = Math.min(ann.read_reach.enrolled_total, ackCount + 1);
  }
  const enrolledTotal = ann.read_reach.enrolled_total || 42;
  const percentage =
    enrolledTotal > 0 ? Number(((ackCount / enrolledTotal) * 100).toFixed(1)) : 0;

  return {
    ...ann,
    read_reach: {
      acknowledged_count: ackCount,
      enrolled_total: enrolledTotal,
      percentage,
      has_current_user_acknowledged:
        hasAck || ann.read_reach.has_current_user_acknowledged,
    },
  };
}

export function handleClarifyApiRequest(req: ApiEngineRequest): ApiEngineResponse {
  const store = getServerStore();
  const method = req.method.toUpperCase();
  const cleanPath = req.path.replace(/^\/api\/v1/, '').replace(/^\/api/, '') || '/';
  const query = req.query || {};
  const body = req.body || {};
  const authHeader =
    req.headers?.authorization || req.headers?.Authorization || undefined;

  // ---------------------------------------------------------------------------
  // HEALTH CHECK: GET /health
  // ---------------------------------------------------------------------------
  if (method === 'GET' && cleanPath === '/health') {
    return {
      status: 200,
      body: {
        status: 'ok',
        service: 'clarify-api',
        version: 'v1',
        framework: 'Laravel 13 Contract Engine',
      },
    };
  }

  // ---------------------------------------------------------------------------
  // PUBLIC ROUTE: POST /auth/login (Workflow 1, NFR-01_REV, FR-08)
  // ---------------------------------------------------------------------------
  if (method === 'POST' && cleanPath === '/auth/login') {
    const institutionalId = String(body.institutional_id || '').trim();
    const password = String(body.password || '').trim();

    const errors: Record<string, string[]> = {};
    if (!institutionalId) {
      errors.institutional_id = ['The institutional ID field is required.'];
    }
    if (!password) {
      errors.password = ['The password field is required.'];
    }
    if (Object.keys(errors).length > 0) {
      return {
        status: 422,
        body: {
          status: 422,
          message: 'The given data was invalid.',
          errors,
        },
      };
    }

    // Check pending queue (FR-08 / TC-FR08)
    const pendingMatch = store.pendingUsers.find(
      (u) =>
        u.institutional_id === institutionalId &&
        u.verification_status === 'pending'
    );
    if (pendingMatch || institutionalId.toLowerCase() === 'pending') {
      return {
        status: 403,
        body: {
          status: 403,
          verification_status: 'pending',
          message:
            'Your account is pending IT Administrator registrar verification (FR-08).',
        },
      };
    }

    let matchedUser = store.users.find(
      (u) => u.institutional_id === institutionalId
    );

    if (!matchedUser) {
      if (institutionalId === '10492' || institutionalId.toLowerCase().includes('aki')) {
        matchedUser = DEMO_USERS.faculty;
      } else if (
        institutionalId === '90001' ||
        institutionalId.toLowerCase().includes('admin')
      ) {
        matchedUser = DEMO_USERS.it_admin;
      } else {
        matchedUser = {
          ...DEMO_USERS.student,
          institutional_id: institutionalId,
        };
      }
    }

    if (matchedUser.verification_status !== 'approved') {
      return {
        status: 403,
        body: {
          status: 403,
          verification_status: matchedUser.verification_status,
          message:
            'Your account is pending IT Administrator registrar verification (FR-08).',
        },
      };
    }

    const token = `clarify-jwt-${matchedUser.role}-${matchedUser.institutional_id}`;
    store.tokens[token] = matchedUser.id;

    return {
      status: 200,
      body: {
        message: 'Authenticated successfully.',
        token,
        data: matchedUser,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // AUTHENTICATION & VERIFIED ACCOUNT MIDDLEWARE (auth:sanctum + verified.account)
  // ---------------------------------------------------------------------------
  const { user, pendingUser } = resolveUserFromBearer(store, authHeader);

  if (pendingUser && pendingUser.verification_status !== 'approved') {
    return {
      status: 403,
      body: {
        status: 403,
        verification_status: pendingUser.verification_status,
        message:
          'Your account is pending IT Administrator registrar verification (FR-08).',
      },
    };
  }

  // Default to student session if no header provided on read routes, but strictly enforce on mutating routes
  const activeUser: User = user || DEMO_USERS.student;

  // ---------------------------------------------------------------------------
  // WORKFLOW 1: AUTH & PROFILE
  // ---------------------------------------------------------------------------
  if (method === 'POST' && cleanPath === '/auth/logout') {
    if (authHeader) {
      const rawToken = authHeader.replace(/^Bearer\s+/i, '').trim();
      delete store.tokens[rawToken];
    }
    return {
      status: 200,
      body: { message: 'Logged out successfully.' },
    };
  }

  if (method === 'GET' && cleanPath === '/auth/me') {
    return {
      status: 200,
      body: { data: activeUser },
    };
  }

  if ((method === 'POST' || method === 'PATCH') && cleanPath === '/profile') {
    const contactNumber = String(body.contact_number || '').trim();
    const name = String(body.name || activeUser.name).trim();
    const avatarPreviewUrl = body.avatar_preview_url
      ? String(body.avatar_preview_url)
      : undefined;

    if (!contactNumber) {
      return {
        status: 422,
        body: {
          status: 422,
          message: 'The contact number field is required.',
          errors: {
            contact_number: [
              'Please provide a valid mobile number for SMS fallback alerts (FR-06).',
            ],
          },
        },
      };
    }

    const updatedUser: User = {
      ...activeUser,
      name: name || activeUser.name,
      contact_number: contactNumber,
      ...(avatarPreviewUrl ? { avatar_url: avatarPreviewUrl } : {}),
    };

    const userIdx = store.users.findIndex((u) => u.id === activeUser.id);
    if (userIdx !== -1) {
      store.users[userIdx] = updatedUser;
    }

    return {
      status: 200,
      body: {
        message: 'Profile settings and SMS fallback number updated (FR-06).',
        data: updatedUser,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // WORKFLOW 5: SCOPED CHANNELS & ROSTER
  // ---------------------------------------------------------------------------
  if (method === 'GET' && cleanPath === '/channels') {
    const search = (query.search || '').trim().toLowerCase();
    const type = query.type || 'all';

    const filtered = store.channels.filter((ch) => {
      if (type !== 'all' && ch.channel_type !== type) {
        return false;
      }
      if (search) {
        const hay = `${ch.name} ${ch.course_code || ''} ${ch.description || ''} ${
          ch.scope_department || ''
        }`.toLowerCase();
        return hay.includes(search);
      }
      return true;
    });

    return {
      status: 200,
      body: { data: filtered },
    };
  }

  if (method === 'POST' && cleanPath === '/channels') {
    if (!canPublishOrManageAnnouncements(activeUser.role)) {
      return {
        status: 403,
        body: {
          status: 403,
          message:
            'Access Denied: Students cannot create Course Hub channels (NFR-01_REV).',
        },
      };
    }

    const courseCode = String(body.course_code || '').trim();
    const name = String(body.name || '').trim();
    const description = String(body.description || '').trim();
    const channelType =
      (body.channel_type as Channel['channel_type']) || 'course_hub';
    const scopeCollege = String(body.scope_college || 'CITC');
    const scopeDepartment = String(body.scope_department || 'CITC');
    const scopeSection = String(body.scope_section || 'IT3R2');

    const errors: Record<string, string[]> = {};
    if (!name) {
      errors.name = ['The channel name field is required.'];
    }
    if (!courseCode) {
      errors.course_code = ['The course code field is required (e.g., IT315).'];
    }
    if (Object.keys(errors).length > 0) {
      return {
        status: 422,
        body: {
          status: 422,
          message: 'Channel validation failed.',
          errors,
        },
      };
    }

    const formattedName = name.startsWith('#') ? name : `# ${name}`;
    const newChannel: Channel = {
      id: Math.max(0, ...store.channels.map((c) => c.id)) + 1,
      course_code: courseCode.toUpperCase(),
      name: formattedName,
      description: description || `${scopeSection} Scoped Course Hub`,
      channel_type: channelType,
      scope_college: scopeCollege,
      scope_department: scopeDepartment,
      scope_section: scopeSection,
      unread_count: 0,
      members_count: 1,
      instructor_name: activeUser.name,
      latest_activity_preview: `${activeUser.name}: Channel provisioned and ready for scoped notices.`,
      latest_activity_at: 'Just now',
      roster: [
        {
          id: activeUser.id,
          institutional_id: activeUser.institutional_id,
          name: activeUser.name,
          role: activeUser.role,
          section: scopeSection,
          department: scopeDepartment,
        },
      ],
    };

    store.channels = [newChannel, ...store.channels];

    return {
      status: 201,
      body: {
        message: 'Scoped channel created successfully.',
        data: newChannel,
      },
    };
  }

  const joinMatch = cleanPath.match(/^\/channels\/(\d+)\/join$/);
  if (method === 'POST' && joinMatch) {
    const channelId = Number(joinMatch[1]);
    const idx = store.channels.findIndex((c) => c.id === channelId);
    if (idx === -1) {
      return {
        status: 422,
        body: {
          status: 422,
          message: 'Channel not found.',
          errors: { channel_id: ['Selected channel does not exist.'] },
        },
      };
    }

    const channel = store.channels[idx];
    const roster = channel.roster || [];
    const exists = roster.some(
      (m) => m.institutional_id === activeUser.institutional_id
    );

    if (!exists) {
      store.channels[idx] = {
        ...channel,
        roster: [
          ...roster,
          {
            id: activeUser.id,
            institutional_id: activeUser.institutional_id,
            name: activeUser.name,
            role: activeUser.role,
            section: activeUser.academic_profile?.section || 'IT3R2',
            department: activeUser.academic_profile?.department || 'CITC',
          },
        ],
        members_count: (channel.members_count || 41) + 1,
      };
    }

    return {
      status: 200,
      body: {
        message: `Enrolled in ${channel.name} roster.`,
        data: store.channels[idx],
      },
    };
  }

  const membersMatch = cleanPath.match(/^\/channels\/(\d+)\/members$/);
  if (method === 'POST' && membersMatch) {
    if (!canPublishOrManageAnnouncements(activeUser.role)) {
      return {
        status: 403,
        body: {
          status: 403,
          message:
            'Only Faculty or IT Administrators can modify channel rosters.',
        },
      };
    }

    const channelId = Number(membersMatch[1]);
    const idx = store.channels.findIndex((c) => c.id === channelId);
    if (idx === -1) {
      return {
        status: 422,
        body: {
          status: 422,
          message: 'Channel not found.',
          errors: { channel_id: ['Channel not found.'] },
        },
      };
    }

    const institutionalId = String(body.institutional_id || '').trim();
    const action = String(body.action || 'add') as 'add' | 'remove';
    const target = store.channels[idx];
    const currentRoster = target.roster || [];

    if (action === 'add') {
      if (!institutionalId) {
        return {
          status: 422,
          body: {
            status: 422,
            message: 'Institutional ID is required.',
            errors: {
              institutional_id: [
                'Please enter a valid student or faculty Institutional ID.',
              ],
            },
          },
        };
      }
      const newMember = {
        id: Date.now(),
        institutional_id: institutionalId,
        name:
          String(body.name || '').trim() ||
          `USTP Student (${institutionalId})`,
        role: 'student' as UserRole,
        section: String(body.section || target.scope_section || 'IT3R2'),
        department: target.scope_department || 'CITC',
      };
      store.channels[idx] = {
        ...target,
        roster: [...currentRoster, newMember],
        members_count: (target.members_count || currentRoster.length) + 1,
      };
    } else {
      store.channels[idx] = {
        ...target,
        roster: currentRoster.filter(
          (m) => m.institutional_id !== institutionalId
        ),
        members_count: Math.max(
          1,
          (target.members_count || currentRoster.length) - 1
        ),
      };
    }

    return {
      status: 200,
      body: {
        message:
          action === 'add'
            ? 'Member added to channel roster.'
            : 'Member removed from channel roster.',
        data: store.channels[idx],
      },
    };
  }

  // ---------------------------------------------------------------------------
  // WORKFLOWS 2 & 3: SCOPED ANNOUNCEMENTS, READ REACH & AUDITS
  // ---------------------------------------------------------------------------
  if (method === 'GET' && cleanPath === '/announcements') {
    const includeDrafts = canPublishOrManageAnnouncements(activeUser.role);
    const channelId = query.channel_id ? Number(query.channel_id) : undefined;
    const serialized = store.announcements.map((a) =>
      serializeAnnouncementForUser(store, a, activeUser)
    );

    const sorted = filterAndSortAnnouncements(serialized, {
      channelId,
      search: query.search,
      department: query.department,
      tag: query.tag,
      sort: (query.sort as 'latest' | 'oldest' | 'urgent_first' | 'read_reach') || 'latest',
      includeDrafts,
    });

    const page = Math.max(1, Number(query.page || 1));
    const perPage = Math.max(1, Number(query.per_page || 4));
    const total = sorted.length;
    const lastPage = Math.max(1, Math.ceil(total / perPage));
    const start = (page - 1) * perPage;
    const sliced = sorted.slice(start, start + perPage);

    return {
      status: 200,
      body: {
        data: sliced,
        meta: {
          current_page: page,
          last_page: lastPage,
          per_page: perPage,
          total,
        },
      },
    };
  }

  // POST /announcements & alias POST /announcements/create (TC-NFR01)
  if (
    method === 'POST' &&
    (cleanPath === '/announcements' || cleanPath === '/announcements/create')
  ) {
    if (!canPublishOrManageAnnouncements(activeUser.role)) {
      return {
        status: 403,
        body: {
          status: 403,
          message:
            'HTTP 403 Forbidden: Students are not authorized to publish announcements (TC-NFR01).',
        },
      };
    }

    const title = String(body.title || '').trim();
    const content = String(body.content || '').trim();
    const channelId = Number(body.channel_id || 7);
    const isUrgent =
      body.is_urgent === true || String(body.is_urgent) === 'true';
    const triggerSms =
      body.trigger_sms_fallback === true ||
      String(body.trigger_sms_fallback) === 'true';
    const status =
      (body.status as 'published' | 'draft' | 'archived') || 'published';
    const attachmentName = body.attachment_name
      ? String(body.attachment_name)
      : null;
    const attachmentType = body.attachment_type as
      | 'image'
      | 'document'
      | null;

    // Check channel scope for faculty vs university/college channels (FR-02)
    const targetChannel = store.channels.find((c) => c.id === channelId);
    if (
      targetChannel &&
      (targetChannel.channel_type === 'university' ||
        targetChannel.channel_type === 'college') &&
      activeUser.role === 'faculty'
    ) {
      return {
        status: 403,
        body: {
          status: 403,
          message:
            'HTTP 403 Forbidden: University-wide and College-wide memos are restricted to Department Heads, Deans, and IT Administrators (FR-02).',
        },
      };
    }

    const errors: Record<string, string[]> = {};
    if (!title) {
      errors.title = ['The title field is required.'];
    }
    if (!content) {
      errors.content = ['The announcement content field is required.'];
    }
    if (Object.keys(errors).length > 0) {
      return {
        status: 422,
        body: {
          status: 422,
          message:
            'The title field is required. Please complete all mandatory fields.',
          errors,
        },
      };
    }

    let parsedTags: string[] = ['OFFICIAL MEMO', 'CDO CAMPUS', 'CITC'];
    if (Array.isArray(body.tags)) {
      parsedTags = body.tags.map((t) => String(t));
    } else if (typeof body.tags === 'string' && body.tags.trim()) {
      try {
        parsedTags = JSON.parse(body.tags);
      } catch {
        parsedTags = body.tags.split(',').map((t) => t.trim());
      }
    }
    if (isUrgent && !parsedTags.includes('URGENT NOTICE')) {
      parsedTags = ['URGENT NOTICE', ...parsedTags];
    }

    const nowIso = new Date().toISOString();
    const newId = Math.max(0, ...store.announcements.map((a) => a.id)) + 1;
    const newAnnouncement: Announcement = {
      id: newId,
      channel_id: channelId,
      title,
      subtitle: 'USTP Digital Transformation',
      content,
      attachment_url: attachmentName ? `/storage/memos/${attachmentName}` : null,
      attachment_name: attachmentName,
      attachment_type: attachmentType || null,
      tags: parsedTags,
      is_urgent: isUrgent,
      is_pinned: isUrgent,
      trigger_sms_fallback: triggerSms,
      status: status === 'draft' ? 'draft' : 'published',
      is_edited: false,
      published_at: nowIso,
      updated_at: nowIso,
      read_reach: {
        acknowledged_count: 1,
        enrolled_total: 42,
        percentage: 2.4,
        has_current_user_acknowledged: true,
      },
      publisher: {
        id: activeUser.id,
        name: activeUser.name,
        role: activeUser.role,
        department: activeUser.academic_profile?.department || 'CITC',
      },
    };

    store.announcementReadsByUser[newId] = [activeUser.id];
    store.announcements = [newAnnouncement, ...store.announcements];

    if (triggerSms) {
      store.metrics.sms_fallback_dispatched_count += 42;
    }

    return {
      status: 201,
      body: {
        message: isUrgent
          ? 'Urgent Announcement published! Push alerts queued (<= 2.0s) and pinned to top.'
          : 'Announcement published to Course Hub.',
        data: serializeAnnouncementForUser(store, newAnnouncement, activeUser),
      },
    };
  }

  const announcementIdMatch = cleanPath.match(/^\/announcements\/(\d+)$/);
  if (
    (method === 'PATCH' || method === 'POST') &&
    announcementIdMatch
  ) {
    if (!canPublishOrManageAnnouncements(activeUser.role)) {
      return {
        status: 403,
        body: {
          status: 403,
          message: 'HTTP 403 Forbidden: Students cannot edit announcements.',
        },
      };
    }

    const id = Number(announcementIdMatch[1]);
    const idx = store.announcements.findIndex((a) => a.id === id);
    if (idx === -1) {
      return {
        status: 422,
        body: {
          status: 422,
          message: 'Announcement not found.',
          errors: { title: ['Target announcement does not exist.'] },
        },
      };
    }

    const title = String(body.title || '').trim();
    const content = String(body.content || '').trim();
    const errors: Record<string, string[]> = {};
    if (!title) {
      errors.title = ['The title field is required.'];
    }
    if (!content) {
      errors.content = ['The announcement content field is required.'];
    }
    if (Object.keys(errors).length > 0) {
      return {
        status: 422,
        body: {
          status: 422,
          message: 'Validation failed.',
          errors,
        },
      };
    }

    const prev = store.announcements[idx];
    const nowIso = new Date().toISOString();

    // AnnouncementObserver: log immutable audit entry (NFR-03_REV / TC-NFR03)
    store.metrics.announcement_audits = [
      {
        id:
          Math.max(
            700,
            ...store.metrics.announcement_audits.map((a) => a.id)
          ) + 1,
        announcement_id: prev.id,
        previous_title: prev.title,
        new_title: title,
        previous_content: prev.content,
        new_content: content,
        editor_id: activeUser.id,
        editor_name: activeUser.name,
        editor_role: activeUser.role,
        edited_at: nowIso,
      },
      ...store.metrics.announcement_audits,
    ];

    const isUrgent =
      body.is_urgent !== undefined ? Boolean(body.is_urgent) : prev.is_urgent;
    const updated: Announcement = {
      ...prev,
      title,
      content,
      tags: Array.isArray(body.tags)
        ? body.tags.map((t) => String(t))
        : prev.tags,
      is_urgent: isUrgent,
      is_pinned: isUrgent ? true : prev.is_pinned,
      trigger_sms_fallback:
        body.trigger_sms_fallback !== undefined
          ? Boolean(body.trigger_sms_fallback)
          : prev.trigger_sms_fallback,
      status:
        (body.status as 'published' | 'draft' | 'archived') || prev.status,
      is_edited: true,
      updated_at: nowIso,
    };

    store.announcements[idx] = updated;

    return {
      status: 200,
      body: {
        message: 'Announcement updated and audit trail logged (NFR-03_REV).',
        data: serializeAnnouncementForUser(store, updated, activeUser),
      },
    };
  }

  if (method === 'DELETE' && announcementIdMatch) {
    if (!canPublishOrManageAnnouncements(activeUser.role)) {
      return {
        status: 403,
        body: {
          status: 403,
          message: 'HTTP 403 Forbidden: Students cannot delete announcements.',
        },
      };
    }

    const id = Number(announcementIdMatch[1]);
    store.announcements = store.announcements.filter((a) => a.id !== id);
    return {
      status: 200,
      body: {
        message: 'Announcement archived and removed from active noticeboard.',
      },
    };
  }

  const ackMatch = cleanPath.match(/^\/announcements\/(\d+)\/acknowledge$/);
  if (method === 'POST' && ackMatch) {
    const id = Number(ackMatch[1]);
    const idx = store.announcements.findIndex((a) => a.id === id);
    if (idx === -1) {
      return {
        status: 422,
        body: {
          status: 422,
          message: 'Announcement not found.',
        },
      };
    }

    const existingReaders = store.announcementReadsByUser[id] || [];
    if (!existingReaders.includes(activeUser.id)) {
      store.announcementReadsByUser[id] = [...existingReaders, activeUser.id];
    }

    const serialized = serializeAnnouncementForUser(
      store,
      store.announcements[idx],
      activeUser
    );
    store.announcements[idx] = serialized;

    return {
      status: 200,
      body: {
        message: 'Announcement marked as read and acknowledged.',
        data: serialized,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // WORKFLOW 4: ISOLATED Q&A THREADS & 1-CLICK ANONYMIZED FAQS
  // ---------------------------------------------------------------------------
  const channelThreadsMatch = cleanPath.match(/^\/channels\/(\d+)\/threads$/);
  if (method === 'GET' && channelThreadsMatch) {
    const channelId = Number(channelThreadsMatch[1]);
    const statusFilter = query.status || 'all';

    const list = store.threads
      .filter((t) => t.channel_id === channelId)
      .filter((t) => {
        if (statusFilter === 'resolved') return t.is_resolved;
        if (statusFilter === 'open') return !t.is_resolved;
        return true;
      })
      .filter((t) => {
        // Private inquiry isolation (Stakeholder Table E)
        if (!t.is_private || t.is_pinned_faq) return true;
        if (activeUser.role !== 'student') return true;
        return t.author.id === activeUser.id;
      })
      .map((t) => enforceFaqAnonymity(t));

    return {
      status: 200,
      body: { data: list },
    };
  }

  if (method === 'POST' && channelThreadsMatch) {
    const channelId = Number(channelThreadsMatch[1]);
    const formattedHashtag = formatSubjectHashtag(
      String(body.subject_hashtag || '')
    );
    const content = String(body.content || '').trim();
    const isPrivate = Boolean(body.is_private);
    const announcementId = body.announcement_id
      ? Number(body.announcement_id)
      : null;

    const errors: Record<string, string[]> = {};
    if (!formattedHashtag) {
      errors.subject_hashtag = [
        'Please enter a subject hashtag (e.g., #Defence).',
      ];
    }
    if (!content) {
      errors.content = [
        'Please enter your inquiry or clarification details.',
      ];
    }
    if (Object.keys(errors).length > 0) {
      return {
        status: 422,
        body: {
          status: 422,
          message: 'Please complete all required inquiry fields.',
          errors,
        },
      };
    }

    const nowIso = new Date().toISOString();
    const newThread: QaThread = {
      id: Math.max(200, ...store.threads.map((t) => t.id)) + 1,
      channel_id: channelId,
      announcement_id: announcementId,
      subject_hashtag: formattedHashtag,
      content,
      is_private: isPrivate,
      is_resolved: false,
      is_pinned_faq: false,
      created_at: nowIso,
      updated_at: nowIso,
      author: {
        id: activeUser.id,
        name: activeUser.name,
        role: activeUser.role,
        avatar_url: activeUser.avatar_url || null,
      },
      replies: [],
    };

    store.threads = [newThread, ...store.threads];

    return {
      status: 201,
      body: {
        message: 'Academic inquiry ticket submitted to Course Hub.',
        data: newThread,
      },
    };
  }

  const threadIdMatch = cleanPath.match(/^\/threads\/(\d+)$/);
  if (method === 'PATCH' && threadIdMatch) {
    const threadId = Number(threadIdMatch[1]);
    const idx = store.threads.findIndex((t) => t.id === threadId);
    if (idx === -1) {
      return {
        status: 422,
        body: { status: 422, message: 'Inquiry thread not found.' },
      };
    }

    const existing = store.threads[idx];
    if (existing.is_resolved) {
      return {
        status: 403,
        body: {
          status: 403,
          message: 'Resolved inquiries can no longer be edited.',
        },
      };
    }

    const content = String(body.content || '').trim();
    if (!content) {
      return {
        status: 422,
        body: {
          status: 422,
          message: 'The inquiry content cannot be empty.',
          errors: { content: ['The inquiry content cannot be empty.'] },
        },
      };
    }

    store.threads[idx] = {
      ...existing,
      subject_hashtag: body.subject_hashtag
        ? formatSubjectHashtag(String(body.subject_hashtag))
        : existing.subject_hashtag,
      content,
      updated_at: new Date().toISOString(),
    };

    return {
      status: 200,
      body: {
        message: 'Inquiry updated.',
        data: store.threads[idx],
      },
    };
  }

  if (method === 'DELETE' && threadIdMatch) {
    const threadId = Number(threadIdMatch[1]);
    store.threads = store.threads.filter((t) => t.id !== threadId);
    return {
      status: 200,
      body: { message: 'Inquiry ticket deleted.' },
    };
  }

  const replyMatch = cleanPath.match(/^\/threads\/(\d+)\/replies$/);
  if (method === 'POST' && replyMatch) {
    if (!canResolveOrPinThreads(activeUser.role)) {
      return {
        status: 403,
        body: {
          status: 403,
          message:
            'HTTP 403 Forbidden: Only instructors can answer and resolve tickets.',
        },
      };
    }

    const threadId = Number(replyMatch[1]);
    const idx = store.threads.findIndex((t) => t.id === threadId);
    if (idx === -1) {
      return {
        status: 422,
        body: { status: 422, message: 'Thread not found.' },
      };
    }

    const content = String(body.content || '').trim();
    if (!content) {
      return {
        status: 422,
        body: {
          status: 422,
          message: 'The reply content field is required.',
          errors: {
            content: ['Please enter a faculty response before submitting.'],
          },
        },
      };
    }

    const markResolved =
      body.mark_resolved !== undefined ? Boolean(body.mark_resolved) : true;
    const pinToFaq = Boolean(body.pin_to_faq);
    const nowIso = new Date().toISOString();
    const target = store.threads[idx];

    const newReply = {
      id: Date.now(),
      thread_id: threadId,
      content,
      created_at: nowIso,
      author: {
        id: activeUser.id,
        name: activeUser.name,
        role: activeUser.role,
      },
    };

    const updatedThread = enforceFaqAnonymity({
      ...target,
      is_resolved: markResolved || pinToFaq || target.is_resolved,
      is_pinned_faq: pinToFaq || target.is_pinned_faq,
      updated_at: nowIso,
      replies: [...target.replies, newReply],
    });

    store.threads[idx] = updatedThread;

    return {
      status: 200,
      body: {
        message: pinToFaq
          ? 'Reply posted, ticket resolved, and converted to anonymized Class FAQ (FR-07).'
          : 'Faculty reply posted.',
        data: updatedThread,
      },
    };
  }

  const convertFaqMatch = cleanPath.match(/^\/threads\/(\d+)\/convert-faq$/);
  if (method === 'POST' && convertFaqMatch) {
    if (!canResolveOrPinThreads(activeUser.role)) {
      return {
        status: 403,
        body: {
          status: 403,
          message:
            'HTTP 403 Forbidden: Only instructors can publish Class FAQs (FR-07).',
        },
      };
    }

    const threadId = Number(convertFaqMatch[1]);
    const idx = store.threads.findIndex((t) => t.id === threadId);
    if (idx === -1) {
      return {
        status: 422,
        body: { status: 422, message: 'Thread not found.' },
      };
    }

    const updated = enforceFaqAnonymity({
      ...store.threads[idx],
      is_resolved: true,
      is_pinned_faq: true,
      updated_at: new Date().toISOString(),
    });

    store.threads[idx] = updated;

    return {
      status: 200,
      body: {
        message:
          'Pinned to Class FAQs with student identity masked as "Anonymous Student" (RA 10173).',
        data: updated,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // INSTRUCTOR DIRECTORY: GET /instructors
  // ---------------------------------------------------------------------------
  if (method === 'GET' && cleanPath === '/instructors') {
    const q = (query.search || '').trim().toLowerCase();
    const dept = query.department || 'ALL';
    const sort = query.sort || 'name';

    const filtered = store.instructors
      .filter((inst) => {
        if (dept !== 'ALL' && inst.department !== dept) return false;
        if (q) {
          const hay = `${inst.name} ${inst.department} ${inst.specialization} ${inst.courses_handled.join(
            ' '
          )}`.toLowerCase();
          return hay.includes(q);
        }
        return true;
      })
      .sort((a, b) => {
        if (sort === 'department') {
          return (
            a.department.localeCompare(b.department) ||
            a.name.localeCompare(b.name)
          );
        }
        return a.name.localeCompare(b.name);
      });

    const page = Math.max(1, Number(query.page || 1));
    const perPage = Math.max(1, Number(query.per_page || 12));
    const total = filtered.length;
    const lastPage = Math.max(1, Math.ceil(total / perPage));
    const start = (page - 1) * perPage;

    return {
      status: 200,
      body: {
        data: filtered.slice(start, start + perPage),
        meta: {
          current_page: page,
          last_page: lastPage,
          per_page: perPage,
          total,
        },
      },
    };
  }

  // ---------------------------------------------------------------------------
  // WORKFLOW 6: IT ADMIN CONSOLE & PUSH TOKENS
  // ---------------------------------------------------------------------------
  if (method === 'GET' && cleanPath === '/admin/users/pending') {
    const q = (query.search || '').trim().toLowerCase();
    const filtered = store.pendingUsers.filter((u) => {
      if (!q) return true;
      return `${u.name} ${u.institutional_id} ${u.email} ${
        u.academic_profile?.department || ''
      }`
        .toLowerCase()
        .includes(q);
    });

    return {
      status: 200,
      body: {
        data: filtered,
        meta: {
          current_page: 1,
          last_page: 1,
          per_page: 20,
          total: filtered.length,
        },
      },
    };
  }

  const verifyMatch = cleanPath.match(/^\/admin\/users\/(\d+)\/verify$/);
  if (method === 'PATCH' && verifyMatch) {
    const userId = Number(verifyMatch[1]);
    const verificationStatus = String(
      body.verification_status || 'approved'
    ) as 'approved' | 'rejected';

    const idx = store.pendingUsers.findIndex((u) => u.id === userId);
    if (idx === -1) {
      return {
        status: 422,
        body: { status: 422, message: 'Pending account not found.' },
      };
    }

    const updated: User = {
      ...store.pendingUsers[idx],
      verification_status: verificationStatus,
    };

    store.pendingUsers = store.pendingUsers.filter((u) => u.id !== userId);
    if (verificationStatus === 'approved') {
      store.users = [updated, ...store.users];
      store.metrics.verified_accounts_count += 1;
    }
    store.metrics.pending_verifications_count = store.pendingUsers.length;

    return {
      status: 200,
      body: {
        message:
          verificationStatus === 'approved'
            ? `Account ${updated.institutional_id} verified against registrar records (FR-08).`
            : `Account ${updated.institutional_id} registration rejected.`,
        data: updated,
      },
    };
  }

  if (method === 'GET' && cleanPath === '/admin/users') {
    const q = (query.search || '').trim().toLowerCase();
    const filtered = store.users.filter((u) => {
      if (!q) return true;
      return `${u.name} ${u.institutional_id} ${u.role} ${
        u.academic_profile?.department || ''
      }`
        .toLowerCase()
        .includes(q);
    });

    return {
      status: 200,
      body: { data: filtered },
    };
  }

  const roleMatch = cleanPath.match(/^\/admin\/users\/(\d+)\/role$/);
  if (method === 'PATCH' && roleMatch) {
    const userId = Number(roleMatch[1]);
    const idx = store.users.findIndex((u) => u.id === userId);
    if (idx === -1) {
      return {
        status: 422,
        body: { status: 422, message: 'User not found.' },
      };
    }

    const newRole = (body.role as UserRole) || store.users[idx].role;
    const department = String(
      body.department ||
        store.users[idx].academic_profile?.department ||
        'CITC'
    );

    const target = store.users[idx];
    const updated: User = {
      ...target,
      role: newRole,
      academic_profile: {
        campus: target.academic_profile?.campus || 'CDO Campus',
        college: department,
        department,
        program: target.academic_profile?.program || null,
        year_level: target.academic_profile?.year_level || null,
        section: target.academic_profile?.section || `${department} Scope`,
        semester_code:
          target.academic_profile?.semester_code || '2026-1ST-SEM',
      },
    };

    store.users[idx] = updated;

    return {
      status: 200,
      body: {
        message: `Updated ${updated.name} role to ${updated.role.toUpperCase()} (${department}) (FR-09).`,
        data: updated,
      },
    };
  }

  if (method === 'POST' && cleanPath === '/admin/sync-prisms') {
    const semesterCode = String(body.semester_code || '').trim();
    if (!semesterCode) {
      return {
        status: 422,
        body: {
          status: 422,
          message: 'The semester_code field is required.',
          errors: {
            semester_code: [
              'Please specify a target PRISMS semester code (e.g., 2026-1ST-SEM).',
            ],
          },
        },
      };
    }

    const logEntry: PrismsSyncLog = {
      id: Math.max(900, ...store.metrics.sync_logs.map((l) => l.id)) + 1,
      semester_code: semesterCode,
      triggered_by: `${activeUser.name} (${activeUser.institutional_id})`,
      sync_type: 'manual_admin',
      total_updated: 1432,
      channels_provisioned: 39,
      status: 'completed',
      duration_ms: 810,
      executed_at: new Date().toISOString(),
    };

    store.metrics.sync_logs = [logEntry, ...store.metrics.sync_logs];
    store.metrics.active_users_count = 1432;

    return {
      status: 200,
      body: {
        message: `PRISMS batch synchronization completed for ${semesterCode} (FR-10).`,
        total_updated: logEntry.total_updated,
        log: logEntry,
      },
    };
  }

  if (method === 'GET' && cleanPath === '/admin/metrics') {
    return {
      status: 200,
      body: {
        data: store.metrics,
      },
    };
  }

  if (method === 'POST' && cleanPath === '/devices/token') {
    const expoPushToken = String(body.expo_push_token || '').trim();
    const platform = (body.platform as 'android' | 'ios' | 'web') || 'android';

    if (!expoPushToken) {
      return {
        status: 422,
        body: {
          status: 422,
          message: 'The expo_push_token field is required.',
          errors: {
            expo_push_token: ['The expo_push_token field is required.'],
          },
        },
      };
    }

    const tokenRecord = {
      id: store.deviceTokens.length + 1,
      user_id: activeUser.id,
      expo_push_token: expoPushToken,
      platform,
      last_registered_at: new Date().toISOString(),
    };
    store.deviceTokens.push(tokenRecord);

    return {
      status: 201,
      body: {
        message:
          'Device push token registered for <= 2.0s urgent alerts (NFR-02).',
        data: tokenRecord,
      },
    };
  }

  return {
    status: 404,
    body: {
      status: 404,
      message: `Clarify API endpoint not found: ${method} /api/v1${cleanPath}`,
    },
  };
}
