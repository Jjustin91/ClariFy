import assert from 'node:assert/strict';
import test from 'node:test';

import { getApiOrigin, resolveApiAssetUrl } from './api-client.ts';
import {
  buildAnnouncementFormData,
  buildProfileUpdateFormData,
  canManageAnnouncement,
  formatFileSize,
  MAX_ANNOUNCEMENT_ATTACHMENT_BYTES,
  MAX_PROFILE_AVATAR_BYTES,
  parseAnnouncementAttachment,
  validateAnnouncementAttachmentFile,
  validateProfileAvatarFile,
} from './domain-logic.ts';
import type { Announcement, Channel, User } from '../types/api.ts';

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

test('canManageAnnouncement strictly hides edit/delete for students and scopes campus-wide to dept_head', () => {
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
  const campusAnn = makeAnnouncement({
    channel_id: 1,
    channel_type: 'university',
  });
  const courseAnn = makeAnnouncement({
    channel_id: 2,
    channel_type: 'course_hub',
  });

  // Students and IT admins NEVER see manage controls
  assert.equal(
    canManageAnnouncement(courseAnn, makeUser('student'), [courseChannel]),
    false
  );
  assert.equal(
    canManageAnnouncement(campusAnn, makeUser('student'), [campusChannel]),
    false
  );
  assert.equal(
    canManageAnnouncement(campusAnn, makeUser('it_admin'), [campusChannel]),
    false
  );

  // Faculty can manage Course Hub announcements, not Campus-Wide memos
  assert.equal(
    canManageAnnouncement(courseAnn, makeUser('faculty'), [courseChannel]),
    true
  );
  assert.equal(
    canManageAnnouncement(campusAnn, makeUser('faculty'), [campusChannel]),
    false
  );

  // Dept Head can manage both Campus-Wide and Course Hub announcements
  assert.equal(
    canManageAnnouncement(campusAnn, makeUser('dept_head'), [campusChannel]),
    true
  );
  assert.equal(
    canManageAnnouncement(courseAnn, makeUser('dept_head'), [courseChannel]),
    true
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
