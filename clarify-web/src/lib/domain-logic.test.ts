import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChatMessageFormData,
  calculateAcknowledgedReadReach,
  canPublishOrManageAnnouncements,
  canResolveOrPinThreads,
  canStudentModifyOwnInquiry,
  createRetryableChatFileStore,
  enforceFaqAnonymity,
  filterAndSortAnnouncements,
  formatEnrolledRosterSummary,
  formatSubjectHashtag,
  getChannelFacultyLabel,
  getFieldValidationError,
  getUnsentMessagePlaceholder,
  isThreadVisibleToUser,
  validateChatAttachmentFile,
} from './domain-logic';
import type { Announcement, Channel, QaThread, User } from '../types/api';

test('getUnsentMessagePlaceholder returns null for active messages and appropriate sender/viewer label when unsent', () => {
  assert.equal(
    getUnsentMessagePlaceholder(
      { is_unsent: false, author: { id: 10, name: 'Kobeni Higashiyama' } },
      10
    ),
    null
  );

  assert.equal(
    getUnsentMessagePlaceholder(
      { is_unsent: true, author: { id: 10, name: 'Kobeni Higashiyama' } },
      10
    ),
    'You unsent a message'
  );

  assert.equal(
    getUnsentMessagePlaceholder(
      { is_unsent: true, author: { id: 10, name: 'Kobeni Higashiyama' } },
      99
    ),
    'Kobeni Higashiyama unsent a message'
  );

  assert.equal(
    getUnsentMessagePlaceholder(
      { is_unsent: true, sender_id: 10, author: { id: null, name: '' } },
      99
    ),
    'Campus Member unsent a message'
  );
});

test('calculateAcknowledgedReadReach increments count, clamps to enrolled_total, and handles zero enrolled students', () => {
  const initial = {
    acknowledged_count: 1,
    enrolled_total: 6,
    percentage: 16.7,
    has_current_user_acknowledged: false,
  };

  const updated = calculateAcknowledgedReadReach(initial);
  assert.equal(updated.acknowledged_count, 2);
  assert.equal(updated.enrolled_total, 6);
  assert.equal(updated.percentage, 33.3);
  assert.equal(updated.has_current_user_acknowledged, true);

  // Calling again should be idempotent
  const duplicate = calculateAcknowledgedReadReach(updated);
  assert.equal(duplicate.acknowledged_count, 2);
  assert.equal(duplicate.percentage, 33.3);

  // Clamping: acknowledged_count never exceeds enrolled_total
  const clamped = calculateAcknowledgedReadReach({
    acknowledged_count: 6,
    enrolled_total: 6,
    percentage: 100,
    has_current_user_acknowledged: false,
  });
  assert.equal(clamped.acknowledged_count, 6);
  assert.equal(clamped.percentage, 100);

  // Zero enrolled students returns 0 / 0% with no artificial floor
  const zeroEnrolled = calculateAcknowledgedReadReach({
    acknowledged_count: 0,
    enrolled_total: 0,
    percentage: 0,
    has_current_user_acknowledged: false,
  });
  assert.equal(zeroEnrolled.acknowledged_count, 0);
  assert.equal(zeroEnrolled.enrolled_total, 0);
  assert.equal(zeroEnrolled.percentage, 0);
  assert.equal(zeroEnrolled.has_current_user_acknowledged, true);
});

test('getChannelFacultyLabel and formatEnrolledRosterSummary use channel.faculty, members_count, and students_count', () => {
  const hubWithFaculty: Channel = {
    id: 7,
    course_code: 'IT314',
    name: '# IT314 SoftEng',
    description: 'IT3R2 Scoped Course Hub',
    channel_type: 'course_hub',
    scope_college: 'CITC',
    scope_department: 'CITC',
    scope_section: 'IT3R2',
    members_count: 7,
    students_count: 6,
    faculty: [{ id: 10492, name: 'Aki Hayakawa', role: 'faculty' }],
    roster: [], // Even when roster is empty/self-only, faculty and counts are accurate
  };

  assert.equal(getChannelFacultyLabel(hubWithFaculty), 'Aki Hayakawa');
  assert.equal(formatEnrolledRosterSummary(hubWithFaculty), '7 members (6 students)');

  const hubWithoutFaculty: Channel = {
    ...hubWithFaculty,
    members_count: 1,
    students_count: 1,
    faculty: [],
    instructor_name: 'Student Creator Name',
  };
  assert.equal(getChannelFacultyLabel(hubWithoutFaculty), 'No Faculty Assigned Yet');
  assert.equal(formatEnrolledRosterSummary(hubWithoutFaculty), '1 member (1 student)');
});

test('enforceFaqAnonymity masks student author as Anonymous Student when is_pinned_faq is true', () => {
  const rawThread: QaThread = {
    id: 101,
    channel_id: 7,
    announcement_id: null,
    subject_hashtag: '#When_po_defence_maam',
    content: 'When po defence maam? and what possible need i bring?',
    is_private: true,
    is_resolved: false,
    is_pinned_faq: true,
    created_at: '2026-10-22T13:05:00+08:00',
    updated_at: '2026-10-22T13:15:00+08:00',
    author: {
      id: 2020202020,
      name: 'Kobeni Higashiyama',
      role: 'student',
      avatar_url: '/avatars/kobeni.png',
    },
    replies: [],
  };

  const masked = enforceFaqAnonymity(rawThread);
  assert.equal(masked.author.name, 'Anonymous Student');
  assert.equal(masked.author.id, null);
  assert.equal(masked.author.avatar_url, null);
  assert.equal(masked.is_resolved, true);
  assert.equal(masked.is_private, false);
});

test('RBAC role helpers strictly enforce student vs faculty/admin boundaries', () => {
  assert.equal(canPublishOrManageAnnouncements('student'), false);
  assert.equal(canPublishOrManageAnnouncements('faculty'), true);
  assert.equal(canPublishOrManageAnnouncements('dept_head'), true);
  assert.equal(canPublishOrManageAnnouncements('it_admin'), false);

  assert.equal(canResolveOrPinThreads('student'), false);
  assert.equal(canResolveOrPinThreads('faculty'), true);
});

test('canStudentModifyOwnInquiry allows editing only when unresolved and authored by student', () => {
  const kobeni: User = {
    id: 1,
    institutional_id: '2020202020',
    name: 'Kobeni Higashiyama',
    email: 'kobeni@ustp.edu.ph',
    role: 'student',
    verification_status: 'approved',
  };

  const openThread: QaThread = {
    id: 10,
    channel_id: 7,
    announcement_id: null,
    subject_hashtag: '#Defence',
    content: 'Question body',
    is_private: false,
    is_resolved: false,
    is_pinned_faq: false,
    created_at: '2026-10-22T13:00:00+08:00',
    updated_at: '2026-10-22T13:00:00+08:00',
    author: { id: 1, name: 'Kobeni Higashiyama', role: 'student', avatar_url: null },
    replies: [],
  };

  assert.equal(canStudentModifyOwnInquiry(kobeni, openThread), true);
  assert.equal(
    canStudentModifyOwnInquiry(kobeni, { ...openThread, is_resolved: true }),
    false
  );
  assert.equal(
    canStudentModifyOwnInquiry(
      { ...kobeni, id: 999 },
      openThread
    ),
    false
  );
});

test('isThreadVisibleToUser hides private threads from other students but shows to author and faculty', () => {
  const authorStudent: User = {
    id: 1,
    institutional_id: '2020202020',
    name: 'Kobeni',
    email: 'k@ustp.edu.ph',
    role: 'student',
    verification_status: 'approved',
  };
  const otherStudent: User = { ...authorStudent, id: 2, name: 'Denji' };
  const facultyUser: User = { ...authorStudent, id: 10492, role: 'faculty' };

  const privateThread: QaThread = {
    id: 55,
    channel_id: 7,
    announcement_id: null,
    subject_hashtag: '#grade_consultation',
    content: 'Private grade inquiry',
    is_private: true,
    is_resolved: false,
    is_pinned_faq: false,
    created_at: '2026-10-22T13:00:00+08:00',
    updated_at: '2026-10-22T13:00:00+08:00',
    author: { id: 1, name: 'Kobeni', role: 'student', avatar_url: null },
    replies: [],
  };

  assert.equal(isThreadVisibleToUser(privateThread, authorStudent), true);
  assert.equal(isThreadVisibleToUser(privateThread, otherStudent), false);
  assert.equal(isThreadVisibleToUser(privateThread, facultyUser), true);
});

test('formatSubjectHashtag normalizes hashtag prefix', () => {
  assert.equal(formatSubjectHashtag('Defence'), '#Defence');
  assert.equal(formatSubjectHashtag('###When_po_defence_maam'), '#When_po_defence_maam');
  assert.equal(formatSubjectHashtag('   '), '');
});

test('filterAndSortAnnouncements orders urgent/pinned first and filters by keyword and tag', () => {
  const sampleAnnouncements: Announcement[] = [
    {
      id: 1,
      channel_id: 7,
      title: 'Regular Schedule Update',
      content: 'Normal lecture in CITC Building',
      attachment_url: null,
      tags: ['CITC', 'CDO CAMPUS'],
      is_urgent: false,
      is_pinned: false,
      status: 'published',
      is_edited: false,
      published_at: '2026-10-22T14:00:00+08:00',
      updated_at: '2026-10-22T14:00:00+08:00',
      read_reach: {
        acknowledged_count: 10,
        enrolled_total: 42,
        percentage: 23.8,
        has_current_user_acknowledged: false,
      },
      publisher: { id: 10492, name: 'Aki Hayakawa', role: 'faculty', department: 'CITC' },
    },
    {
      id: 2,
      channel_id: 7,
      title: 'CITC Lab Room Reassignment: IT314 moved to CEA',
      content: 'Urgent reassignment to CEA Room 302',
      attachment_url: null,
      tags: ['URGENT NOTICE', 'OFFICIAL MEMO', 'CITC', 'MEMORANDUM'],
      is_urgent: true,
      is_pinned: true,
      status: 'published',
      is_edited: true,
      published_at: '2026-10-22T12:35:00+08:00',
      updated_at: '2026-10-22T12:50:00+08:00',
      read_reach: {
        acknowledged_count: 1,
        enrolled_total: 42,
        percentage: 2.4,
        has_current_user_acknowledged: false,
      },
      publisher: { id: 10492, name: 'Aki Hayakawa', role: 'faculty', department: 'CITC' },
    },
  ];

  const sorted = filterAndSortAnnouncements(sampleAnnouncements);
  assert.equal(sorted[0].id, 2); // Urgent/Pinned is ordered first despite earlier timestamp

  const byTag = filterAndSortAnnouncements(sampleAnnouncements, { tag: 'URGENT NOTICE' });
  assert.equal(byTag.length, 1);
  assert.equal(byTag[0].id, 2);

  const bySearch = filterAndSortAnnouncements(sampleAnnouncements, { search: 'CEA Room 302' });
  assert.equal(bySearch.length, 1);
  assert.equal(bySearch[0].id, 2);
});

test('getFieldValidationError extracts Laravel 422 field error message', () => {
  const errors = {
    title: ['The title field is required.'],
    channel_id: ['You are not assigned to publish in this course hub.'],
  };
  assert.equal(getFieldValidationError(errors, 'title'), 'The title field is required.');
  assert.equal(getFieldValidationError(errors, 'content'), null);
});

test('validateChatAttachmentFile accepts image, document, and voice up to 10 MB and rejects >10 MB or executables', () => {
  assert.deepEqual(
    validateChatAttachmentFile({
      name: 'lecture-slide.png',
      size: 512 * 1024,
      type: 'image/png',
    }),
    { valid: true, attachmentType: 'image' }
  );

  assert.deepEqual(
    validateChatAttachmentFile({
      name: 'syllabus.pdf',
      size: 2 * 1024 * 1024,
      type: 'application/pdf',
    }),
    { valid: true, attachmentType: 'document' }
  );

  assert.deepEqual(
    validateChatAttachmentFile({
      name: 'voice-note.webm',
      size: 120 * 1024,
      type: 'audio/webm',
    }),
    { valid: true, attachmentType: 'voice' }
  );

  const over10Mb = validateChatAttachmentFile({
    name: 'archive.zip',
    size: 11 * 1024 * 1024,
    type: 'application/zip',
  });
  assert.equal(over10Mb.valid, false);

  const phpScript = validateChatAttachmentFile({
    name: 'shell.php',
    size: 1024,
    type: 'application/x-php',
  });
  assert.equal(phpScript.valid, false);

  const exeBinary = validateChatAttachmentFile({
    name: 'setup.exe',
    size: 4096,
    type: 'application/x-msdownload',
  });
  assert.equal(exeBinary.valid, false);
});

test('buildChatMessageFormData builds multipart fields without base64-encoding content and createRetryableChatFileStore retains File for retry', () => {
  const sampleBlob = new Blob(['PDF binary bytes'], { type: 'application/pdf' });
  const formData = buildChatMessageFormData({
    content: 'Here is the lab manual',
    tempId: 'temp-12345',
    attachment: sampleBlob,
    attachmentFileName: 'lab-manual.pdf',
  });

  assert.equal(formData.get('content'), 'Here is the lab manual');
  assert.equal(formData.get('temp_id'), 'temp-12345');

  const attachedEntry = formData.get('attachment') as File | null;
  assert.ok(attachedEntry);
  assert.equal(attachedEntry.name, 'lab-manual.pdf');
  assert.equal(attachedEntry.size, 16);
  assert.equal(String(formData.get('content')).includes('data:'), false);

  // Verify retry path retains the exact File reference across failed attempt -> retry -> clear on success
  const retryStore = createRetryableChatFileStore<{ name: string; size: number }>();
  const stagedFile = { name: 'voice-note.webm', size: 8192 };
  retryStore.stage('temp-retry-99', stagedFile);

  assert.equal(retryStore.has('temp-retry-99'), true);
  assert.strictEqual(retryStore.getForRetry('temp-retry-99'), stagedFile);

  // After retry succeeds, clear removes it
  retryStore.clear('temp-retry-99');
  assert.equal(retryStore.has('temp-retry-99'), false);
  assert.equal(retryStore.getForRetry('temp-retry-99'), undefined);
});



