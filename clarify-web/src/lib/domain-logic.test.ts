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
  filterQaThreads,
  formatEnrolledRosterSummary,
  formatHubActivityBreakdownChips,
  formatSubjectHashtag,
  getChannelFacultyLabel,
  getFieldValidationError,
  getQaThreadFilterCounts,
  getThreadStatusLabel,
  getUnsentMessagePlaceholder,
  isThreadResolved,
  isThreadUnresolved,
  isThreadUnread,
  isThreadVisibleToUser,
  isValidUstpEmail,
  normalizePhilippineMobileNumber,
  normalizeUstpEmail,
  resolveHubUpdateDestination,
  USTP_EMAIL_ERROR_MESSAGE,
  validateChatAttachmentFile,
  validateUstpEmail,
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

test('isValidUstpEmail and validateUstpEmail accept only exact @ustp.edu.ph addresses and normalize case/whitespace', () => {
  assert.equal(normalizeUstpEmail('  USER.NAME@USTP.EDU.PH  '), 'user.name@ustp.edu.ph');
  assert.equal(isValidUstpEmail('student@ustp.edu.ph'), true);
  assert.equal(isValidUstpEmail('USER@USTP.EDU.PH'), true);
  assert.equal(isValidUstpEmail('  faculty.10492@ustp.edu.ph  '), true);
  assert.equal(validateUstpEmail('  USER@USTP.EDU.PH  '), null);

  // Rejections: wrong domain, lookalike domain, subdomain, empty local part
  assert.equal(isValidUstpEmail('student@gmail.com'), false);
  assert.equal(isValidUstpEmail('student@ustp.edu.ph.evil.com'), false);
  assert.equal(isValidUstpEmail('student@mail.ustp.edu.ph'), false);
  assert.equal(isValidUstpEmail('@ustp.edu.ph'), false);
  assert.equal(isValidUstpEmail(''), false);

  assert.equal(
    validateUstpEmail('student@gmail.com'),
    USTP_EMAIL_ERROR_MESSAGE
  );
  assert.equal(
    validateUstpEmail('student@ustp.edu.ph.evil.com'),
    USTP_EMAIL_ERROR_MESSAGE
  );
  assert.equal(
    validateUstpEmail('student@mail.ustp.edu.ph'),
    USTP_EMAIL_ERROR_MESSAGE
  );
});

test('normalizePhilippineMobileNumber normalizes valid PH mobile numbers to +639XXXXXXXXX and rejects invalid inputs', () => {
  assert.equal(normalizePhilippineMobileNumber('09171234567'), '+639171234567');
  assert.equal(normalizePhilippineMobileNumber('9171234567'), '+639171234567');
  assert.equal(normalizePhilippineMobileNumber('639171234567'), '+639171234567');
  assert.equal(normalizePhilippineMobileNumber('+63 917 123 4567'), '+639171234567');
  assert.equal(normalizePhilippineMobileNumber('  +63-917-123-4567  '), '+639171234567');

  assert.equal(normalizePhilippineMobileNumber(''), null);
  assert.equal(normalizePhilippineMobileNumber('12345'), null);
  assert.equal(normalizePhilippineMobileNumber('+14155552671'), null);
  assert.equal(normalizePhilippineMobileNumber('08171234567'), null);
  assert.equal(normalizePhilippineMobileNumber('+63917123456789'), null);
});

test('resolveHubUpdateDestination routes single-category, highest-count, tie-breaks (qa > chat > announcements), and fallback correctly', () => {
  const baseHub: Channel = {
    id: 10,
    course_code: 'IT314',
    name: '# IT314 SoftEng',
    description: 'Scoped Hub',
    channel_type: 'course_hub',
    scope_college: 'CITC',
    scope_department: 'CITC',
    scope_section: 'IT3R2',
  };
  const subGeneral: Channel = {
    ...baseHub,
    id: 101,
    parent_hub_id: 10,
    name: '# general',
  };
  const subLabs: Channel = {
    ...baseHub,
    id: 102,
    parent_hub_id: 10,
    name: '# labs',
  };

  // 1. Fallback when new_activity_breakdown is absent or all 0
  assert.equal(resolveHubUpdateDestination(baseHub, [subGeneral, subLabs]), '/channels/10');
  assert.equal(
    resolveHubUpdateDestination(
      {
        ...baseHub,
        new_activity_breakdown: { chat: 0, announcements: 0, qa: 0 },
      },
      [subGeneral, subLabs]
    ),
    '/channels/10'
  );

  // 2. Single category: Q&A -> ?tab=threads
  assert.equal(
    resolveHubUpdateDestination({
      ...baseHub,
      new_activity_breakdown: { chat: 0, announcements: 0, qa: 1 },
    }),
    '/channels/10?tab=threads'
  );

  // 3. Single category: Announcements -> ?tab=feed
  assert.equal(
    resolveHubUpdateDestination({
      ...baseHub,
      new_activity_breakdown: { chat: 0, announcements: 2, qa: 0 },
    }),
    '/channels/10?tab=feed'
  );

  // 4. Single category: Chat with new_activity_sub_channel_id -> /channels/{subId}
  assert.equal(
    resolveHubUpdateDestination(
      {
        ...baseHub,
        new_activity_breakdown: { chat: 3, announcements: 0, qa: 0 },
        new_activity_sub_channel_id: 102,
      },
      [subGeneral, subLabs]
    ),
    '/channels/102'
  );

  // 5. Single category: Chat without new_activity_sub_channel_id falls back to first subChannel or ?tab=messenger
  assert.equal(
    resolveHubUpdateDestination(
      {
        ...baseHub,
        new_activity_breakdown: { chat: 1, announcements: 0, qa: 0 },
        new_activity_sub_channel_id: null,
      },
      [subGeneral, subLabs]
    ),
    '/channels/101'
  );
  assert.equal(
    resolveHubUpdateDestination(
      {
        ...baseHub,
        new_activity_breakdown: { chat: 1, announcements: 0, qa: 0 },
        new_activity_sub_channel_id: null,
      },
      []
    ),
    '/channels/10?tab=messenger'
  );

  // 6. Multiple categories: highest count wins
  assert.equal(
    resolveHubUpdateDestination(
      {
        ...baseHub,
        new_activity_breakdown: { chat: 4, announcements: 1, qa: 2 },
        new_activity_sub_channel_id: 102,
      },
      [subGeneral, subLabs]
    ),
    '/channels/102'
  );

  // 7. Tie-break order: qa > chat > announcements
  assert.equal(
    resolveHubUpdateDestination(
      {
        ...baseHub,
        new_activity_breakdown: { chat: 2, announcements: 2, qa: 2 },
        new_activity_sub_channel_id: 102,
      },
      [subGeneral, subLabs]
    ),
    '/channels/10?tab=threads'
  );
  assert.equal(
    resolveHubUpdateDestination(
      {
        ...baseHub,
        new_activity_breakdown: { chat: 2, announcements: 2, qa: 0 },
        new_activity_sub_channel_id: 102,
      },
      [subGeneral, subLabs]
    ),
    '/channels/102'
  );

  // 8. Breakdown chips formatting
  assert.deepEqual(
    formatHubActivityBreakdownChips({ chat: 2, announcements: 1, qa: 1 }),
    [
      { key: 'qa', label: '1 Q&A', count: 1 },
      { key: 'chat', label: '2 chat', count: 2 },
      { key: 'announcements', label: '1 announcement', count: 1 },
    ]
  );
});

test('Q&A resolved/unresolved/unread markers and filter helpers enforce resolution rules and student privacy', () => {
  const studentA: User = {
    id: 21,
    institutional_id: '2020202020',
    name: 'Kobeni Higashiyama',
    email: 'kobeni@ustp.edu.ph',
    contact_number: null,
    role: 'student',
    verification_status: 'approved',
  };
  const studentB: User = {
    ...studentA,
    id: 22,
    institutional_id: '2020303030',
    name: 'Denji Hayakawa',
  };
  const faculty: User = {
    ...studentA,
    id: 99,
    institutional_id: '10492',
    name: 'Aki Hayakawa',
    role: 'faculty',
  };

  const prevSeenAt = '2026-11-16T10:00:00.000Z';

  // Thread 1: Public unresolved thread with a faculty reply (reply alone does NOT mark it resolved!)
  const unresolvedWithReply: QaThread = {
    id: 1,
    channel_id: 10,
    announcement_id: null,
    subject_hashtag: '#MidtermScope',
    content: 'Is Chapter 5 included?',
    is_private: false,
    is_resolved: false,
    is_pinned_faq: false,
    created_at: '2026-11-16T09:00:00.000Z',
    updated_at: '2026-11-16T10:05:00.000Z',
    author: { id: 21, name: 'Kobeni Higashiyama', role: 'student', avatar_url: null },
    replies: [
      {
        id: 101,
        thread_id: 1,
        content: 'Let me check the syllabus and confirm.',
        created_at: '2026-11-16T10:05:00.000Z',
        author: { id: 99, name: 'Aki Hayakawa', role: 'faculty', avatar_url: null },
      },
    ],
  };

  // Thread 2: Public resolved thread created before prevSeenAt with no new replies
  const resolvedReadThread: QaThread = {
    id: 2,
    channel_id: 10,
    announcement_id: null,
    subject_hashtag: '#LabSubmission',
    content: 'Where do we upload Lab 2?',
    is_private: false,
    is_resolved: true,
    is_pinned_faq: true,
    created_at: '2026-11-16T08:00:00.000Z',
    updated_at: '2026-11-16T08:30:00.000Z',
    author: { id: 0, name: 'Anonymous Student', role: 'student', avatar_url: null },
    replies: [
      {
        id: 102,
        thread_id: 2,
        content: 'Upload to USTP STEP.',
        created_at: '2026-11-16T08:30:00.000Z',
        author: { id: 99, name: 'Aki Hayakawa', role: 'faculty', avatar_url: null },
      },
    ],
  };

  // Thread 3: Private thread owned by Student A, created after prevSeenAt
  const privateStudentAThread: QaThread = {
    id: 3,
    channel_id: 10,
    announcement_id: null,
    subject_hashtag: '#MedicalExcuse',
    content: 'Private medical certificate question.',
    is_private: true,
    is_resolved: false,
    is_pinned_faq: false,
    created_at: '2026-11-16T10:10:00.000Z',
    updated_at: '2026-11-16T10:10:00.000Z',
    author: { id: 21, name: 'Kobeni Higashiyama', role: 'student', avatar_url: null },
    replies: [],
  };

  // 1. Resolved vs Unresolved rules
  assert.equal(isThreadResolved(unresolvedWithReply), false);
  assert.equal(isThreadUnresolved(unresolvedWithReply), true);
  assert.equal(getThreadStatusLabel(unresolvedWithReply), 'UNRESOLVED');

  assert.equal(isThreadResolved(resolvedReadThread), true);
  assert.equal(isThreadUnresolved(resolvedReadThread), false);
  assert.equal(getThreadStatusLabel(resolvedReadThread), 'RESOLVED');

  // 2. Unread rules:
  // - Thread 1 has a faculty reply after prevSeenAt -> unread for Student A & Student B, but NOT unread for Faculty (who authored the reply after prevSeenAt)
  assert.equal(isThreadUnread(unresolvedWithReply, studentA.id, prevSeenAt), true);
  assert.equal(isThreadUnread(unresolvedWithReply, studentB.id, prevSeenAt), true);
  assert.equal(isThreadUnread(unresolvedWithReply, faculty.id, prevSeenAt), false);
  assert.equal(isThreadUnread(unresolvedWithReply, studentA.id, null), false);

  // - Thread 2 was created and replied before prevSeenAt -> read for everyone
  assert.equal(isThreadUnread(resolvedReadThread, studentA.id, prevSeenAt), false);

  // - Thread 3 was created by Student A after prevSeenAt -> unread for Faculty, NOT unread for Student A (author)
  assert.equal(isThreadUnread(privateStudentAThread, studentA.id, prevSeenAt), false);
  assert.equal(isThreadUnread(privateStudentAThread, faculty.id, prevSeenAt), true);

  // 3. Filter counts and privacy for Student B vs Faculty:
  // Student B MUST NOT see Thread 3 (Student A's private thread) in `all`, `unresolved`, or `unread`!
  const allThreads = [unresolvedWithReply, resolvedReadThread, privateStudentAThread];
  const studentBCounts = getQaThreadFilterCounts(allThreads, studentB, prevSeenAt);
  assert.deepEqual(studentBCounts, {
    all: 2,
    unresolved: 1,
    resolved: 1,
    unread: 1,
  });

  const facultyCounts = getQaThreadFilterCounts(allThreads, faculty, prevSeenAt);
  assert.deepEqual(facultyCounts, {
    all: 3,
    unresolved: 2,
    resolved: 1,
    unread: 1, // Thread 3 is unread for faculty; Thread 1 reply was authored by faculty
  });

  // 4. filterQaThreads combinations
  assert.deepEqual(
    filterQaThreads(allThreads, studentB, {
      statusFilter: 'unresolved',
      unreadOnly: true,
      previousSeenAt: prevSeenAt,
    }).map((t) => t.id),
    [1]
  );
  assert.deepEqual(
    filterQaThreads(allThreads, faculty, {
      statusFilter: 'unresolved',
      unreadOnly: false,
      previousSeenAt: prevSeenAt,
    }).map((t) => t.id),
    [1, 3]
  );
});





