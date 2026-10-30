import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateAcknowledgedReadReach,
  canPublishOrManageAnnouncements,
  canResolveOrPinThreads,
  canStudentModifyOwnInquiry,
  enforceFaqAnonymity,
  filterAndSortAnnouncements,
  formatSubjectHashtag,
  getFieldValidationError,
  isThreadVisibleToUser,
} from './domain-logic';
import type { Announcement, QaThread, User } from '../types/api';

test('calculateAcknowledgedReadReach increments count and recalculates percentage accurately', () => {
  const initial = {
    acknowledged_count: 1,
    enrolled_total: 42,
    percentage: 2.4,
    has_current_user_acknowledged: false,
  };

  const updated = calculateAcknowledgedReadReach(initial);
  assert.equal(updated.acknowledged_count, 2);
  assert.equal(updated.enrolled_total, 42);
  assert.equal(updated.percentage, 4.8);
  assert.equal(updated.has_current_user_acknowledged, true);

  // Calling again should be idempotent
  const duplicate = calculateAcknowledgedReadReach(updated);
  assert.equal(duplicate.acknowledged_count, 2);
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
  assert.equal(canPublishOrManageAnnouncements('it_admin'), true);

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

test('ClariFy API Engine enforces FR-08 pending 403, TC-NFR01 student 403, TC-NFR03 audit logs, and TC-FR07 FAQ masking', async () => {
  const { handleClarifyApiRequest, resetServerStore } = await import(
    '../server/clarify-api-engine'
  );
  resetServerStore();

  // 1. Pending account receives HTTP 403 Forbidden on login (FR-08 / TC-FR08)
  const pendingLogin = handleClarifyApiRequest({
    method: 'POST',
    path: '/auth/login',
    body: { institutional_id: '2023309999', password: 'ustp2026' },
  });
  assert.equal(pendingLogin.status, 403);
  assert.equal(pendingLogin.body.verification_status, 'pending');

  // 2. Student token receives HTTP 403 Forbidden on POST /announcements/create (TC-NFR01)
  const studentCreate = handleClarifyApiRequest({
    method: 'POST',
    path: '/announcements/create',
    headers: { authorization: 'Bearer clarify-jwt-student-2020202020' },
    body: { channel_id: 7, title: 'Unauthorized Student Post', content: 'Blocked' },
  });
  assert.equal(studentCreate.status, 403);

  // 3. Faculty token publishes announcement (201) and edits it (200) -> logs immutable audit (TC-NFR03)
  const facultyUpdate = handleClarifyApiRequest({
    method: 'PATCH',
    path: '/announcements/42',
    headers: { authorization: 'Bearer clarify-jwt-faculty-10492' },
    body: {
      title: 'CITC Lab Room Reassignment: IT314 moved to CEA 302 (Updated)',
      content: 'Updated laboratory schedule for Group 5.',
    },
  });
  assert.equal(facultyUpdate.status, 200);
  const metricsRes = handleClarifyApiRequest({
    method: 'GET',
    path: '/admin/metrics',
    headers: { authorization: 'Bearer clarify-jwt-it_admin-90001' },
  });
  assert.equal(metricsRes.status, 200);
  const metricsData = metricsRes.body.data as {
    announcement_audits: Array<{ new_title: string }>;
  };
  assert.equal(
    metricsData.announcement_audits[0].new_title,
    'CITC Lab Room Reassignment: IT314 moved to CEA 302 (Updated)'
  );

  // 4. 1-Click FAQ conversion masks student author as "Anonymous Student" (TC-FR07)
  const faqRes = handleClarifyApiRequest({
    method: 'POST',
    path: '/threads/205/convert-faq',
    headers: { authorization: 'Bearer clarify-jwt-faculty-10492' },
  });
  assert.equal(faqRes.status, 200);
  const convertedThread = faqRes.body.data as QaThread;
  assert.equal(convertedThread.is_pinned_faq, true);
  assert.equal(convertedThread.author.name, 'Anonymous Student');
  assert.equal(convertedThread.author.id, null);

  // 5. Student token can create a new Course Hub channel and add/remove roster members
  const studentChannelCreate = handleClarifyApiRequest({
    method: 'POST',
    path: '/channels',
    headers: { authorization: 'Bearer clarify-jwt-student-2020202020' },
    body: {
      course_code: 'IT315',
      name: '# IT315 IT Elective 1',
      description: 'Student study hub for IT315',
      channel_type: 'course_hub',
      scope_college: 'CITC',
      scope_department: 'CITC',
      scope_section: 'IT3R2',
    },
  });
  assert.equal(studentChannelCreate.status, 201);

  const studentRosterAdd = handleClarifyApiRequest({
    method: 'POST',
    path: '/channels/7/members',
    headers: { authorization: 'Bearer clarify-jwt-student-2020202020' },
    body: {
      institutional_id: '2020201199',
      name: 'Asa Mitaka',
      section: 'IT3R2',
      action: 'add',
    },
  });
  assert.equal(studentRosterAdd.status, 200);

  const studentRosterRemove = handleClarifyApiRequest({
    method: 'POST',
    path: '/channels/7/members',
    headers: { authorization: 'Bearer clarify-jwt-student-2020202020' },
    body: {
      institutional_id: '2020201199',
      action: 'remove',
    },
  });
  assert.equal(studentRosterRemove.status, 200);
});

