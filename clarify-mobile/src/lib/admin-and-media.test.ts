import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getApiOrigin,
  getPendingUsersApi,
  resolveApiAssetUrl,
} from './api-client.ts';
import {
  ADMIN_DEPARTMENT_TAGS,
  buildAnnouncementFormData,
  buildChatMessageFormData,
  buildProfileUpdateFormData,
  buildVoiceRecordingDescriptor,
  canManageAnnouncement,
  computeAdminMetricsSnapshot,
  extractRetryAfterSeconds,
  filterAnnouncementAudits,
  filterRbacUsers,
  filterSyncLogs,
  filterVerificationQueueUsers,
  formatAudioDuration,
  formatFileSize,
  formatMeasuredLatency,
  formatOtpCooldownLabel,
  getAdminSectionTitle,
  getRbacDepartmentOptions,
  MAX_ANNOUNCEMENT_ATTACHMENT_BYTES,
  MAX_CHAT_ATTACHMENT_BYTES,
  MAX_PROFILE_AVATAR_BYTES,
  normalizePickedChatImage,
  parseAdminSectionTab,
  parseAnnouncementAttachment,
  sanitizeOtpInput,
  validateAnnouncementAttachmentFile,
  validateChatAttachmentFile,
  validatePasswordResetFields,
  validateProfileAvatarFile,
} from './domain-logic.ts';
import type {
  AdminMetricsResponse,
  Announcement,
  AnnouncementAudit,
  Channel,
  PrismsSyncLog,
  User,
} from '../types/api.ts';

function makeUser(role: User['role'], id = 10): User {
  return {
    id,
    institutional_id: '2023300100',
    name: 'Test User',
    email: 'test@ustp.edu.ph',
    role,
    verification_status: 'approved',
  };
}

function makeAnnouncement(overrides: Partial<Announcement> = {}): Announcement {
  return {
    id: 50,
    channel_id: 2,
    channel_type: 'course_hub',
    title: 'Lab Submission Notice',
    content: 'Please submit before Friday 5 PM.',
    attachment_url: null,
    tags: [],
    is_urgent: false,
    is_pinned: false,
    is_edited: false,
    status: 'published',
    published_at: '2026-11-21T08:00:00Z',
    updated_at: '2026-11-21T08:00:00Z',
    publisher: {
      id: 10,
      name: 'Prof. Reyes',
      role: 'faculty',
      department: 'CITC',
    },
    read_reach: {
      acknowledged_count: 5,
      enrolled_total: 20,
      percentage: 25,
      has_current_user_acknowledged: false,
    },
    ...overrides,
  };
}

test('getApiOrigin & resolveApiAssetUrl resolve relative storage paths and preserve absolute/data URIs', () => {
  assert.equal(
    getApiOrigin('https://api.ustpclarify.tech/api/v1'),
    'https://api.ustpclarify.tech'
  );
  assert.equal(
    resolveApiAssetUrl(
      '/storage/announcements/2/memo.pdf',
      'https://api.ustpclarify.tech/api/v1'
    ),
    'https://api.ustpclarify.tech/storage/announcements/2/memo.pdf'
  );
  assert.equal(
    resolveApiAssetUrl(
      'https://api.ustpclarify.tech/storage/announcements/2/photo.jpg',
      'https://api.ustpclarify.tech/api/v1'
    ),
    'https://api.ustpclarify.tech/storage/announcements/2/photo.jpg'
  );
  assert.equal(
    resolveApiAssetUrl(
      'data:image/png;base64,AAAA',
      'https://api.ustpclarify.tech/api/v1'
    ),
    'data:image/png;base64,AAAA'
  );
  assert.equal(resolveApiAssetUrl(null), null);
  assert.equal(resolveApiAssetUrl('   '), null);
});

test('parseAnnouncementAttachment resolves dedicated columns and legacy embedded headers', () => {
  const fromColumns = parseAnnouncementAttachment({
    content: 'See attached syllabus.',
    attachment_url: '/storage/announcements/2/syllabus.pdf',
    attachment_name: 'IT314_Syllabus.pdf',
    attachment_type: 'document',
  });
  assert.equal(fromColumns.cleanContent, 'See attached syllabus.');
  assert.equal(
    fromColumns.attachmentUrl,
    '/storage/announcements/2/syllabus.pdf'
  );
  assert.equal(fromColumns.attachmentName, 'IT314_Syllabus.pdf');
  assert.equal(fromColumns.attachmentType, 'document');

  const fromLegacy = parseAnnouncementAttachment({
    content:
      '__CLARIFY_ANN_MEDIA__{"name":"campus.jpg","type":"image","url":"https://api.ustpclarify.tech/storage/campus.jpg"}\nCampus map attached.',
  });
  assert.equal(fromLegacy.cleanContent, 'Campus map attached.');
  assert.equal(
    fromLegacy.attachmentUrl,
    'https://api.ustpclarify.tech/storage/campus.jpg'
  );
  assert.equal(fromLegacy.attachmentName, 'campus.jpg');
  assert.equal(fromLegacy.attachmentType, 'image');
});

test('validateAnnouncementAttachmentFile enforces allowed extensions, 10 MB limit, and rejects scripts', () => {
  const validImg = validateAnnouncementAttachmentFile(
    { name: 'poster.png', size: 1024 * 500, type: 'image/png' },
    'image'
  );
  assert.deepEqual(validImg, { valid: true, attachmentType: 'image' });

  const validDoc = validateAnnouncementAttachmentFile({
    name: 'midterm_guide.pdf',
    size: 2 * 1024 * 1024,
    type: 'application/pdf',
  });
  assert.deepEqual(validDoc, { valid: true, attachmentType: 'document' });

  const oversized = validateAnnouncementAttachmentFile({
    name: 'huge.pdf',
    size: MAX_ANNOUNCEMENT_ATTACHMENT_BYTES + 1,
    type: 'application/pdf',
  });
  assert.equal(oversized.valid, false);

  const scriptFile = validateAnnouncementAttachmentFile({
    name: 'exploit.php',
    size: 512,
    type: 'application/x-php',
  });
  assert.equal(scriptFile.valid, false);

  const emptyFile = validateAnnouncementAttachmentFile({
    name: 'empty.txt',
    size: 0,
    type: 'text/plain',
  });
  assert.equal(emptyFile.valid, false);
});

test('validateProfileAvatarFile enforces jpg/png/webp and 5 MB limit', () => {
  assert.deepEqual(
    validateProfileAvatarFile({
      name: 'profile.webp',
      size: 400_000,
      type: 'image/webp',
    }),
    { valid: true }
  );

  const tooBig = validateProfileAvatarFile({
    name: 'portrait.jpg',
    size: MAX_PROFILE_AVATAR_BYTES + 100,
    type: 'image/jpeg',
  });
  assert.equal(tooBig.valid, false);

  const wrongType = validateProfileAvatarFile({
    name: 'notes.pdf',
    size: 1200,
    type: 'application/pdf',
  });
  assert.equal(wrongType.valid, false);
});

test('canManageAnnouncement uses server can_manage first and enforces ownership & non-course_hub dept_head scope', () => {
  const campusChannel: Channel = {
    id: 1,
    name: '# USTP Campus-Wide',
    channel_type: 'university',
    course_code: 'CAMPUS',
    description: 'Campus-wide notices',
    scope_college: 'USTP',
    scope_department: 'CITC',
    scope_section: null,
  };
  const deptChannel: Channel = {
    id: 3,
    name: '# CITC Department',
    channel_type: 'department',
    course_code: 'CITC',
    description: 'Department notices',
    scope_college: 'CITC',
    scope_department: 'CITC',
    scope_section: null,
  };
  const courseChannel: Channel = {
    id: 2,
    name: 'IT314 Software Engineering',
    channel_type: 'course_hub',
    course_code: 'IT314',
    description: 'IT314 Course Hub',
    scope_college: 'CITC',
    scope_department: 'CITC',
    scope_section: 'IT3R2',
  };
  const facultyOwner = makeUser('faculty', 10);
  const otherFaculty = makeUser('faculty', 20);
  const deptHeadUser = makeUser('dept_head', 30);

  const campusAnn = makeAnnouncement({
    channel_id: 1,
    channel_type: 'university',
    publisher: { id: 30, name: 'Dr. Chair', role: 'dept_head', department: 'CITC' },
  });
  const deptAnn = makeAnnouncement({
    channel_id: 3,
    channel_type: 'department',
    publisher: { id: 10, name: 'Prof. Reyes', role: 'faculty', department: 'CITC' },
  });
  const facultyCourseAnn = makeAnnouncement({
    channel_id: 2,
    channel_type: 'course_hub',
    publisher: { id: 10, name: 'Prof. Reyes', role: 'faculty', department: 'CITC' },
  });
  const deptHeadCourseAnn = makeAnnouncement({
    channel_id: 2,
    channel_type: 'course_hub',
    publisher: { id: 30, name: 'Dr. Chair', role: 'dept_head', department: 'CITC' },
  });

  // Students and IT admins NEVER see manage controls
  assert.equal(
    canManageAnnouncement(facultyCourseAnn, makeUser('student', 99), [courseChannel]),
    false
  );
  assert.equal(
    canManageAnnouncement(campusAnn, makeUser('student', 99), [campusChannel]),
    false
  );
  assert.equal(
    canManageAnnouncement(campusAnn, makeUser('it_admin', 1), [campusChannel]),
    false
  );

  // Faculty can manage ONLY their own announcements, NEVER another faculty's or campus-wide memos
  assert.equal(
    canManageAnnouncement(facultyCourseAnn, facultyOwner, [courseChannel]),
    true
  );
  assert.equal(
    canManageAnnouncement(facultyCourseAnn, otherFaculty, [courseChannel]),
    false
  );
  assert.equal(
    canManageAnnouncement(campusAnn, facultyOwner, [campusChannel]),
    false
  );

  // Dept Head can manage university/department announcements and their OWN course_hub posts,
  // but NOT another faculty's course_hub post
  assert.equal(
    canManageAnnouncement(campusAnn, deptHeadUser, [campusChannel]),
    true
  );
  assert.equal(
    canManageAnnouncement(deptAnn, deptHeadUser, [deptChannel]),
    true
  );
  assert.equal(
    canManageAnnouncement(deptHeadCourseAnn, deptHeadUser, [courseChannel]),
    true
  );
  assert.equal(
    canManageAnnouncement(facultyCourseAnn, deptHeadUser, [courseChannel]),
    false
  );

  // Server-authoritative `can_manage` takes precedence when present
  assert.equal(
    canManageAnnouncement(
      { ...facultyCourseAnn, can_manage: false },
      facultyOwner,
      [courseChannel]
    ),
    false
  );
  assert.equal(
    canManageAnnouncement(
      { ...facultyCourseAnn, can_manage: true },
      otherFaculty,
      [courseChannel]
    ),
    true
  );
  // Student still denied even if can_manage were true
  assert.equal(
    canManageAnnouncement(
      { ...facultyCourseAnn, can_manage: true },
      makeUser('student', 99),
      [courseChannel]
    ),
    false
  );
});

test('buildAnnouncementFormData encodes create (campus_wide & multi-hub) and edit (remove_attachment)', () => {
  const campusForm = buildAnnouncementFormData({
    title: 'Class Suspension',
    content: 'Classes suspended due to weather.',
    isCampusWide: true,
    isEditing: false,
    tags: ['URGENT NOTICE', 'CDO CAMPUS', 'CITC'],
    isUrgent: true,
    triggerSmsFallback: true,
    status: 'published',
  });
  assert.equal(campusForm.get('scope_mode'), 'campus_wide');
  assert.equal(campusForm.get('is_urgent'), '1');
  assert.equal(campusForm.get('trigger_sms_fallback'), '1');
  assert.equal(
    campusForm.get('tags'),
    JSON.stringify(['URGENT NOTICE', 'CDO CAMPUS', 'CITC'])
  );
  assert.equal(campusForm.get('channel_id'), null);

  const multiHubForm = buildAnnouncementFormData({
    title: 'Quiz 2 Schedule',
    content: 'Quiz 2 will be held Monday.',
    isCampusWide: false,
    isEditing: false,
    tags: ['IGNORED_FOR_HUB'],
    isUrgent: false,
    triggerSmsFallback: false,
    status: 'draft',
    selectedChannelIds: [5, 8],
  });
  assert.equal(multiHubForm.get('scope_mode'), 'course_hub');
  assert.equal(multiHubForm.get('channel_id'), '5');
  assert.equal(multiHubForm.get('channel_ids'), JSON.stringify([5, 8]));
  assert.equal(multiHubForm.get('tags'), JSON.stringify([]));
  assert.equal(multiHubForm.get('status'), 'draft');

  const editRemoveForm = buildAnnouncementFormData({
    title: 'Updated Notice',
    content: 'Attachment removed.',
    isCampusWide: false,
    isEditing: true,
    tags: [],
    isUrgent: false,
    triggerSmsFallback: false,
    status: 'published',
    removeExistingAttachment: true,
  });
  assert.equal(editRemoveForm.get('remove_attachment'), '1');
  assert.equal(editRemoveForm.get('scope_mode'), null);
});

test('buildProfileUpdateFormData sets empty avatar_preview_url when removing photo and preserves existing otherwise', () => {
  const removeForm = buildProfileUpdateFormData({
    contactNumber: '+639171234567',
    removeAvatar: true,
    existingAvatarUrl: 'data:image/png;base64,OLD',
  });
  assert.equal(removeForm.get('contact_number'), '+639171234567');
  assert.equal(removeForm.get('avatar_preview_url'), '');

  const keepForm = buildProfileUpdateFormData({
    contactNumber: '09171234567',
    removeAvatar: false,
    existingAvatarUrl: 'data:image/png;base64,KEEP',
  });
  assert.equal(keepForm.get('avatar_preview_url'), 'data:image/png;base64,KEEP');
});

test('formatFileSize formats bytes cleanly', () => {
  assert.equal(formatFileSize(500), '500 B');
  assert.equal(formatFileSize(1024 * 250), '250 KB');
  assert.equal(formatFileSize(2.5 * 1024 * 1024), '2.5 MB');
  assert.equal(formatFileSize(0), '');
});

test('formatAudioDuration formats seconds safely into M:SS', () => {
  assert.equal(formatAudioDuration(0), '0:00');
  assert.equal(formatAudioDuration(7), '0:07');
  assert.equal(formatAudioDuration(65.9), '1:05');
  assert.equal(formatAudioDuration(-5), '0:00');
  assert.equal(formatAudioDuration(Number.NaN), '0:00');
  assert.equal(formatAudioDuration(null), '0:00');
});

test('buildVoiceRecordingDescriptor normalizes m4a/wav/extensionless URIs for Laravel validation', () => {
  const m4a = buildVoiceRecordingDescriptor({
    uri: 'file:///cache/Audio/rec-123.m4a',
    durationSec: 12,
    fileSize: 48_000,
  });
  assert.equal(m4a.name, 'Voice_Note_0m12s.m4a');
  assert.equal(m4a.type, 'audio/mp4');
  assert.equal(m4a.size, 48_000);
  assert.equal(m4a.durationSec, 12);

  const fallback = buildVoiceRecordingDescriptor({
    uri: 'file:///cache/Audio/recording_temp',
    durationSec: 65,
  });
  assert.equal(fallback.name, 'Voice_Note_1m05s.m4a');
  assert.equal(fallback.type, 'audio/mp4');
  assert.ok(fallback.size >= 1024);

  const wav = buildVoiceRecordingDescriptor({
    uri: 'file:///cache/Audio/clip.wav?v=1',
    durationSec: 3,
    fileSize: 12_000,
  });
  assert.equal(wav.name, 'Voice_Note_0m03s.wav');
  assert.equal(wav.type, 'audio/wav');
});

test('normalizePickedChatImage ensures valid image extensions and MIME types', () => {
  const png = normalizePickedChatImage({
    uri: 'file:///cache/image_123',
    fileName: null,
    mimeType: 'image/png',
    fileSize: 120_000,
  });
  assert.ok(png.name.endsWith('.png'));
  assert.equal(png.type, 'image/png');
  assert.equal(png.size, 120_000);

  const jpg = normalizePickedChatImage({
    uri: 'file:///cache/camera/IMG_001.heic',
    fileName: 'IMG_001.heic',
    mimeType: 'image/jpeg',
    fileSize: 85_000,
  });
  assert.equal(jpg.name, 'IMG_001.jpg');
  assert.equal(jpg.type, 'image/jpeg');
});

test('validateChatAttachmentFile classifies image, document, and voice while blocking scripts and >10 MB files', () => {
  assert.deepEqual(
    validateChatAttachmentFile({
      name: 'whiteboard.jpg',
      size: 250_000,
      type: 'image/jpeg',
    }),
    { valid: true, attachmentType: 'image' }
  );

  assert.deepEqual(
    validateChatAttachmentFile({
      name: 'Voice_Note_0m09s.m4a',
      size: 90_000,
      type: 'audio/mp4',
    }),
    { valid: true, attachmentType: 'voice' }
  );

  assert.deepEqual(
    validateChatAttachmentFile({
      name: 'Lab4_Submission.pdf',
      size: 1_500_000,
      type: 'application/pdf',
    }),
    { valid: true, attachmentType: 'document' }
  );

  const tooLarge = validateChatAttachmentFile({
    name: 'slides.pptx',
    size: MAX_CHAT_ATTACHMENT_BYTES + 1,
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  });
  assert.equal(tooLarge.valid, false);

  const forbidden = validateChatAttachmentFile({
    name: 'payload.php',
    size: 1024,
    type: 'application/x-php',
  });
  assert.equal(forbidden.valid, false);
});

test('buildChatMessageFormData serializes optional caption, temp_id, and attachment file cleanly', () => {
  const voiceOnly = buildChatMessageFormData({
    content: '',
    tempId: 'temp-voice-1',
    attachment: new Blob(['audio-bytes'], { type: 'audio/mp4' }),
    attachmentFileName: 'Voice_Note_0m05s.m4a',
  });
  assert.equal(voiceOnly.get('content'), '');
  assert.equal(voiceOnly.get('temp_id'), 'temp-voice-1');
  assert.ok(voiceOnly.get('attachment') !== null);

  const captionedDoc = buildChatMessageFormData({
    content: 'Here is our group report.',
    tempId: 'temp-doc-2',
    attachment: new Blob(['pdf-bytes'], { type: 'application/pdf' }),
    attachmentFileName: 'Group5_Report.pdf',
  });
  assert.equal(captionedDoc.get('content'), 'Here is our group report.');
  assert.equal(captionedDoc.get('temp_id'), 'temp-doc-2');
  assert.ok(captionedDoc.get('attachment') !== null);
});

test('password reset OTP helpers sanitize 6-digit input, extract retry_after, validate min-8 passwords, and format cooldown labels', () => {
  assert.equal(sanitizeOtpInput('123-456'), '123456');
  assert.equal(sanitizeOtpInput('  98a7b6c54321 '), '987654');
  assert.equal(sanitizeOtpInput(''), '');

  assert.equal(extractRetryAfterSeconds({ retryAfter: 45 }), 45);
  assert.equal(extractRetryAfterSeconds({ retry_after: 31.2 }), 32);
  assert.equal(extractRetryAfterSeconds({ data: { retry_after: 18 } }), 18);
  assert.equal(extractRetryAfterSeconds({ retryAfter: 0 }), 0);
  assert.equal(extractRetryAfterSeconds(null), 0);

  const emptyErrs = validatePasswordResetFields('', '');
  assert.ok(emptyErrs.password?.[0]);
  assert.ok(emptyErrs.password_confirmation?.[0]);

  const shortErrs = validatePasswordResetFields('short7', 'short7');
  assert.match(shortErrs.password?.[0] || '', /at least 8 characters/i);
  assert.equal(shortErrs.password_confirmation, undefined);

  const mismatchErrs = validatePasswordResetFields('Password123', 'Password999');
  assert.equal(mismatchErrs.password, undefined);
  assert.match(mismatchErrs.password_confirmation?.[0] || '', /does not match/i);

  assert.deepEqual(
    validatePasswordResetFields('StrongPass88', 'StrongPass88'),
    {}
  );

  assert.equal(formatOtpCooldownLabel(0), 'Resend SMS Code');
  assert.equal(formatOtpCooldownLabel(-3), 'Resend SMS Code');
  assert.equal(formatOtpCooldownLabel(29.1), 'Resend code in 30s');
});

test('parseAdminSectionTab and getAdminSectionTitle match clarify-web tabs, aliases, and titles', () => {
  assert.equal(parseAdminSectionTab('verifications'), 'verifications');
  assert.equal(parseAdminSectionTab('  RBAC '), 'rbac');
  assert.equal(parseAdminSectionTab('roster-sync'), 'roster-sync');
  assert.equal(parseAdminSectionTab('prisms'), 'roster-sync');
  assert.equal(parseAdminSectionTab('metrics'), 'metrics');
  assert.equal(parseAdminSectionTab('audits'), 'metrics');
  assert.equal(parseAdminSectionTab('unknown'), 'verifications');
  assert.equal(parseAdminSectionTab(''), 'verifications');
  assert.equal(parseAdminSectionTab(null), 'verifications');
  assert.equal(parseAdminSectionTab(undefined), 'verifications');

  assert.equal(
    getAdminSectionTitle('verifications'),
    'IT Admin — Account Verification Queue'
  );
  assert.equal(
    getAdminSectionTitle('rbac'),
    'IT Admin — RBAC Role Management'
  );
  assert.equal(
    getAdminSectionTitle('roster-sync'),
    'IT Admin — Account & Roster Sync Console'
  );
  assert.equal(
    getAdminSectionTitle('metrics'),
    'IT Admin — System Metrics & Audit Trail'
  );
});

test('filterVerificationQueueUsers filters by status, role, department, and search across name/ID/email/mobile/section', () => {
  const queue: User[] = [
    {
      id: 101,
      institutional_id: '2024300111',
      name: 'Denji Hayakawa',
      email: 'denji@ustp.edu.ph',
      contact_number: '+639171112222',
      role: 'student',
      verification_status: 'pending',
      academic_profile: {
        campus: 'CDO',
        college: 'CITC',
        department: 'CITC',
        program: 'BSIT',
        year_level: 3,
        section: 'IT3R2',
        semester_code: '2026-1ST-SEM',
      },
    },
    {
      id: 102,
      institutional_id: 'FAC-2024-09',
      name: 'Prof. Reze Ivanova',
      email: 'reze@ustp.edu.ph',
      contact_number: '+639189998888',
      role: 'faculty',
      verification_status: 'pending',
      academic_profile: {
        campus: 'CDO',
        college: 'CEA',
        department: 'CEA',
        program: null,
        year_level: null,
        section: 'CE2A',
        semester_code: '2026-1ST-SEM',
      },
    },
    {
      id: 103,
      institutional_id: '2024300222',
      name: 'Power Fiend',
      email: 'power@ustp.edu.ph',
      contact_number: '+639193334444',
      role: 'student',
      verification_status: 'rejected',
      academic_profile: {
        campus: 'CDO',
        college: 'CSM',
        department: 'CSM',
        program: 'BSCS',
        year_level: 2,
        section: 'CS2R1',
        semester_code: '2026-1ST-SEM',
      },
    },
    {
      id: 104,
      institutional_id: '2024300333',
      name: 'Already Approved Student',
      email: 'approved@ustp.edu.ph',
      role: 'student',
      verification_status: 'approved',
      academic_profile: {
        campus: 'CDO',
        college: 'CITC',
        department: 'CITC',
        program: 'BSIT',
        year_level: 3,
        section: 'IT3R2',
        semester_code: '2026-1ST-SEM',
      },
    },
  ];

  // Default status='pending'
  assert.deepEqual(
    filterVerificationQueueUsers(queue).map((u) => u.id),
    [101, 102]
  );

  // Rejected archive only
  assert.deepEqual(
    filterVerificationQueueUsers(queue, { status: 'rejected' }).map((u) => u.id),
    [103]
  );

  // All Queue includes pending + rejected, never approved
  assert.deepEqual(
    filterVerificationQueueUsers(queue, { status: 'all' }).map((u) => u.id),
    [101, 102, 103]
  );

  // Role filter
  assert.deepEqual(
    filterVerificationQueueUsers(queue, {
      status: 'all',
      role: 'faculty',
    }).map((u) => u.id),
    [102]
  );

  // Department filter
  assert.deepEqual(
    filterVerificationQueueUsers(queue, {
      status: 'all',
      department: 'csm',
    }).map((u) => u.id),
    [103]
  );

  // Search by mobile number and section
  assert.deepEqual(
    filterVerificationQueueUsers(queue, {
      status: 'all',
      search: '9189998888',
    }).map((u) => u.id),
    [102]
  );
  assert.deepEqual(
    filterVerificationQueueUsers(queue, {
      status: 'all',
      search: 'it3r2',
    }).map((u) => u.id),
    [101]
  );
});

test('filterRbacUsers and getRbacDepartmentOptions match clarify-web RBAC directory filtering and options', () => {
  const users: User[] = [
    {
      id: 1,
      institutional_id: 'ADM-001',
      name: 'ICTO System Admin',
      email: 'icto@ustp.edu.ph',
      contact_number: '+639170000001',
      role: 'it_admin',
      verification_status: 'approved',
      academic_profile: {
        campus: 'CDO',
        college: 'CITC',
        department: 'ICTO',
        program: null,
        year_level: null,
        section: null,
        semester_code: '2026-1ST-SEM',
      },
    },
    {
      id: 2,
      institutional_id: 'DH-002',
      name: 'Dr. Makima Reyes',
      email: 'makima@ustp.edu.ph',
      contact_number: '+639170000002',
      role: 'dept_head',
      verification_status: 'approved',
      academic_profile: {
        campus: 'CDO',
        college: 'CITC',
        department: 'CITC',
        program: null,
        year_level: null,
        section: null,
        semester_code: '2026-1ST-SEM',
      },
    },
    {
      id: 3,
      institutional_id: '2023300555',
      name: 'Asa Mitaka',
      email: 'asa@ustp.edu.ph',
      contact_number: '+639170000003',
      role: 'student',
      verification_status: 'approved',
      academic_profile: {
        campus: 'CDO',
        college: 'COT',
        department: 'COT',
        program: 'BSET',
        year_level: 3,
        section: 'ET3R1',
        semester_code: '2026-1ST-SEM',
      },
    },
  ];

  assert.equal(filterRbacUsers(users).length, 3);
  assert.deepEqual(
    filterRbacUsers(users, { role: 'dept_head' }).map((u) => u.id),
    [2]
  );
  assert.deepEqual(
    filterRbacUsers(users, { department: 'COT' }).map((u) => u.id),
    [3]
  );
  assert.deepEqual(
    filterRbacUsers(users, { search: 'ET3R1' }).map((u) => u.id),
    [3]
  );
  assert.deepEqual(
    filterRbacUsers(users, { search: '9170000001' }).map((u) => u.id),
    [1]
  );

  assert.deepEqual(getRbacDepartmentOptions('CITC'), [...ADMIN_DEPARTMENT_TAGS]);
  assert.deepEqual(getRbacDepartmentOptions('icto'), [
    ...ADMIN_DEPARTMENT_TAGS,
    'ICTO',
  ]);
});

test('filterSyncLogs filters by syncType, status, and search over #id, semester_code, and triggered_by', () => {
  const logs: PrismsSyncLog[] = [
    {
      id: 14,
      semester_code: '2026-1ST-SEM',
      triggered_by: 'ICTO Admin (ADM-001)',
      sync_type: 'manual_admin',
      total_updated: 48,
      channels_provisioned: 6,
      status: 'completed',
      duration_ms: 185,
      executed_at: '2026-11-24T08:00:00Z',
    },
    {
      id: 13,
      semester_code: '2025-2ND-SEM',
      triggered_by: 'System Scheduler',
      sync_type: 'scheduled_midnight',
      total_updated: 45,
      channels_provisioned: 5,
      status: 'partial_warning',
      duration_ms: 240,
      executed_at: '2026-11-23T00:00:00Z',
    },
    {
      id: 12,
      semester_code: '2025-2ND-SEM',
      triggered_by: 'System Scheduler',
      sync_type: 'scheduled_midnight',
      total_updated: 0,
      channels_provisioned: 0,
      status: 'failed',
      duration_ms: 52,
      executed_at: '2026-11-22T00:00:00Z',
    },
  ];

  assert.equal(filterSyncLogs(logs).length, 3);
  assert.deepEqual(
    filterSyncLogs(logs, { syncType: 'manual_admin' }).map((l) => l.id),
    [14]
  );
  assert.deepEqual(
    filterSyncLogs(logs, { status: 'partial_warning' }).map((l) => l.id),
    [13]
  );
  assert.deepEqual(
    filterSyncLogs(logs, { status: 'failed' }).map((l) => l.id),
    [12]
  );
  assert.deepEqual(
    filterSyncLogs(logs, { search: '#14' }).map((l) => l.id),
    [14]
  );
  assert.deepEqual(
    filterSyncLogs(logs, {
      syncType: 'scheduled_midnight',
      search: '2025-2nd-sem',
      status: 'completed',
    }),
    []
  );
});

test('formatMeasuredLatency and computeAdminMetricsSnapshot compute web-matching KPI/health values and render "—" when fields are missing', () => {
  // 1. Completely missing snapshot renders "—" with zero fake numbers
  const emptySnap = computeAdminMetricsSnapshot({});
  assert.equal(emptySnap.kpi.pendingDisplay, '—');
  assert.equal(emptySnap.kpi.pendingSubline, '—');
  assert.equal(emptySnap.kpi.isPendingWarning, false);
  assert.equal(emptySnap.kpi.registeredDisplay, '—');
  assert.equal(emptySnap.kpi.registeredSubline, '—');
  assert.equal(emptySnap.kpi.latencyDisplay, '—');
  assert.equal(emptySnap.kpi.latencySubline, '—');
  assert.equal(emptySnap.kpi.auditsDisplay, '—');
  assert.equal(emptySnap.kpi.auditsSubline, '—');
  assert.equal(emptySnap.rosterSummary.departmentDisplayByTag.CITC, '—');
  assert.equal(emptySnap.rosterSummary.scopedChannelsDisplay, '—');
  assert.equal(emptySnap.rosterSummary.courseHubsSubline, '—');
  assert.equal(emptySnap.health.verificationRatioDisplay, '—');
  assert.equal(emptySnap.health.overallReadReachDisplay, '—');
  assert.equal(emptySnap.health.urgentNoticesDisplay, '—');
  assert.equal(emptySnap.health.activeChannelsDisplay, '—');

  // 2. Full AdminMetricsResponse matches clarify-web formulas & SLA check
  const fullMetrics: AdminMetricsResponse = {
    active_users_count: 40,
    total_registered_users_count: 45,
    verified_accounts_count: 40,
    pending_verifications_count: 3,
    rejected_verifications_count: 2,
    role_breakdown: {
      student: 34,
      faculty: 4,
      dept_head: 1,
      it_admin: 1,
    },
    department_breakdown: {
      CITC: 25,
      CEA: 8,
      COT: 4,
      CSM: 3,
    },
    active_channels_count: 9,
    course_hubs_count: 6,
    published_announcements_count: 18,
    urgent_announcements_count: 4,
    push_queue_latency_seconds: 0.12,
    api_latency_ms: 184,
    sms_fallback_dispatched_count: 2,
    overall_read_reach_percentage: 87.5,
    announcement_audits_total: 11,
    sync_logs: [],
    announcement_audits: [],
  };

  const fullSnap = computeAdminMetricsSnapshot({
    metrics: fullMetrics,
    clientRoundTripMs: 310,
  });
  assert.equal(fullSnap.kpi.pendingDisplay, '3');
  assert.equal(fullSnap.kpi.pendingSubline, '2 rejected in archive');
  assert.equal(fullSnap.kpi.isPendingWarning, true);
  assert.equal(fullSnap.kpi.registeredDisplay, '40');
  assert.equal(
    fullSnap.kpi.registeredSubline,
    '45 total • 34 students, 5 faculty'
  );
  assert.equal(fullSnap.kpi.latencyDisplay, '184ms');
  assert.equal(fullSnap.kpi.latencySubline, '4 urgent alerts sent');
  assert.equal(fullSnap.kpi.isLatencySlaMet, true);
  assert.equal(fullSnap.kpi.auditsDisplay, '11');
  assert.equal(fullSnap.kpi.auditsSubline, '18 published notices');
  assert.equal(fullSnap.rosterSummary.departmentDisplayByTag.CITC, '25');
  assert.equal(fullSnap.rosterSummary.scopedChannelsDisplay, '9');
  assert.equal(fullSnap.rosterSummary.courseHubsSubline, '6 course hubs');
  assert.equal(fullSnap.health.verificationRatioDisplay, '89%');
  assert.equal(
    fullSnap.health.verificationRatioSubline,
    '40 approved of 45 registered'
  );
  assert.equal(fullSnap.health.overallReadReachDisplay, '87.5%');
  assert.equal(fullSnap.health.urgentNoticesDisplay, '4');
  assert.equal(fullSnap.health.urgentNoticesSubline, '2 with SMS fallback');
  assert.equal(fullSnap.health.activeChannelsDisplay, '9');
  assert.equal(
    fullSnap.health.activeChannelsSubline,
    '6 top-level Course Hubs'
  );

  // 3. Fallback to queueUsers / allUsers / clientRoundTripMs & SLA breach (>2.0s)
  const slowLatency = formatMeasuredLatency({
    apiLatencyMs: null,
    clientRoundTripMs: 2450,
  });
  assert.equal(slowLatency.primaryDisplay, '2.45s');
  assert.equal(slowLatency.withinSla, false);

  const fallbackSnap = computeAdminMetricsSnapshot({
    metrics: null,
    queueUsers: [
      { ...makeUser('student', 1), verification_status: 'pending' },
      { ...makeUser('faculty', 2), verification_status: 'rejected' },
    ],
    allUsers: [
      {
        ...makeUser('student', 3),
        academic_profile: {
          campus: 'CDO',
          college: 'CITC',
          department: 'CITC',
          program: 'BSIT',
          year_level: 3,
          section: 'IT3R2',
          semester_code: '2026-1ST-SEM',
        },
      },
      {
        ...makeUser('dept_head', 4),
        academic_profile: {
          campus: 'CDO',
          college: 'CEA',
          department: 'CEA',
          program: null,
          year_level: null,
          section: null,
          semester_code: '2026-1ST-SEM',
        },
      },
    ],
    clientRoundTripMs: 2450,
  });
  assert.equal(fallbackSnap.kpi.pendingDisplay, '1');
  assert.equal(fallbackSnap.kpi.pendingSubline, '1 rejected in archive');
  assert.equal(fallbackSnap.kpi.registeredDisplay, '2');
  assert.equal(
    fallbackSnap.kpi.registeredSubline,
    '4 total • 1 students, 1 faculty'
  );
  assert.equal(fallbackSnap.kpi.latencyDisplay, '2.45s');
  assert.equal(fallbackSnap.kpi.isLatencySlaMet, false);
  assert.equal(fallbackSnap.rosterSummary.departmentDisplayByTag.CITC, '1');
  assert.equal(fallbackSnap.rosterSummary.departmentDisplayByTag.CEA, '1');
  assert.equal(fallbackSnap.rosterSummary.scopedChannelsDisplay, '—');
});

test('getPendingUsersApi serializes status=all and per_page=100 query params', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';

  try {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return {
        ok: true,
        status: 200,
        headers: { get: () => null } as unknown as Headers,
        json: async () => ({
          data: [],
          meta: { current_page: 1, last_page: 1, per_page: 100, total: 0 },
        }),
      } as Response;
    }) as typeof fetch;

    await getPendingUsersApi({ status: 'all', per_page: 100 });
    assert.match(requestedUrl, /\/admin\/users\/pending\?status=all&per_page=100$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('filterAnnouncementAudits filters by search query, editorRole, changeType, and combined criteria', () => {
  const audits: AnnouncementAudit[] = [
    {
      id: 1,
      announcement_id: 101,
      previous_title: 'Midterm Room 201',
      new_title: 'Midterm Room 305',
      previous_content: 'Bring bluebook.',
      new_content: 'Bring bluebook.',
      editor_id: 12,
      editor_name: 'Prof. Aki Hayakawa',
      editor_role: 'faculty',
      edited_at: '2026-11-20T09:00:00Z',
    },
    {
      id: 2,
      announcement_id: 102,
      previous_title: 'Class Suspension',
      new_title: 'Class Suspension',
      previous_content: 'Afternoon classes only.',
      new_content: 'All CDO campus classes suspended.',
      editor_id: 5,
      editor_name: 'Dr. Makima Reyes',
      editor_role: 'dept_head',
      edited_at: '2026-11-21T10:00:00Z',
    },
    {
      id: 3,
      announcement_id: 103,
      previous_title: 'Old Portal Notice',
      new_title: 'Updated Portal Maintenance',
      previous_content: 'Maintenance at 10 PM.',
      new_content: 'Maintenance moved to 11 PM.',
      editor_id: 1,
      editor_name: 'ICTO Admin',
      editor_role: 'it_admin',
      edited_at: '2026-11-22T11:00:00Z',
    },
  ];

  // Unfiltered returns all
  assert.equal(filterAnnouncementAudits(audits, {}).length, 3);

  // Filter by editorRole
  assert.deepEqual(
    filterAnnouncementAudits(audits, { editorRole: 'faculty' }).map((a) => a.id),
    [1]
  );
  assert.deepEqual(
    filterAnnouncementAudits(audits, { editorRole: 'dept_head' }).map((a) => a.id),
    [2]
  );

  // Filter by changeType (matching clarify-web's title_changed / content_changed)
  assert.deepEqual(
    filterAnnouncementAudits(audits, { changeType: 'title_changed' }).map(
      (a) => a.id
    ),
    [1, 3]
  );
  assert.deepEqual(
    filterAnnouncementAudits(audits, { changeType: 'content_changed' }).map(
      (a) => a.id
    ),
    [2, 3]
  );

  // Filter by search (post ID, #id, editor name, content text)
  assert.deepEqual(
    filterAnnouncementAudits(audits, { search: 'post #102' }).map((a) => a.id),
    [2]
  );
  assert.deepEqual(
    filterAnnouncementAudits(audits, { search: 'hayakawa' }).map((a) => a.id),
    [1]
  );

  // Combined filters
  assert.deepEqual(
    filterAnnouncementAudits(audits, {
      editorRole: 'it_admin',
      changeType: 'title_changed',
      search: 'maintenance',
    }).map((a) => a.id),
    [3]
  );
  assert.equal(
    filterAnnouncementAudits(audits, {
      editorRole: 'faculty',
      changeType: 'content_changed',
    }).length,
    0
  );
});


