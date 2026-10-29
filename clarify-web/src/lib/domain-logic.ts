import type {
  Announcement,
  QaThread,
  ReadReach,
  User,
  UserRole,
} from '../types/api';

/**
 * Computes the updated ReadReach state when a student acknowledges an announcement.
 * Enforces idempotent acknowledgment and 1-decimal percentage calculation.
 */
export function calculateAcknowledgedReadReach(current: ReadReach): ReadReach {
  if (current.has_current_user_acknowledged) {
    return current;
  }
  const enrolledTotal = Math.max(1, current.enrolled_total);
  const nextCount = Math.min(enrolledTotal, current.acknowledged_count + 1);
  const percentage = Number(((nextCount / enrolledTotal) * 100).toFixed(1));
  return {
    acknowledged_count: nextCount,
    enrolled_total: current.enrolled_total,
    percentage,
    has_current_user_acknowledged: true,
  };
}

/**
 * Enforces FR-07 and NFR-05 (RA 10173 Data Privacy Act):
 * When a thread is converted/pinned to Class FAQs (`is_pinned_faq === true`),
 * the student's identity must be strictly masked as "Anonymous Student".
 */
export function enforceFaqAnonymity(thread: QaThread): QaThread {
  if (!thread.is_pinned_faq) {
    return thread;
  }
  return {
    ...thread,
    is_resolved: true,
    is_private: false,
    author: {
      id: null,
      name: 'Anonymous Student',
      role: 'student',
      avatar_url: null,
    },
  };
}

/**
 * Formats a student inquiry subject into a valid hashtag (auto-prefixing # and replacing spaces).
 */
export function formatSubjectHashtag(rawInput: string): string {
  const trimmed = rawInput.trim();
  if (!trimmed) return '';
  const withoutLeadingHashes = trimmed.replace(/^#+/, '').trim();
  if (!withoutLeadingHashes) return '';
  return `#${withoutLeadingHashes}`;
}

/**
 * Role-Based Access Control (FR-02, FR-04_REV, NFR-01_REV):
 * Students are strictly prohibited from creating, editing, or deleting announcements.
 */
export function canPublishOrManageAnnouncements(role: UserRole): boolean {
  return role === 'faculty' || role === 'dept_head' || role === 'it_admin';
}

/**
 * Role-Based Access Control (FR-03_REV, FR-07):
 * Only Faculty, Department Heads, and IT Admins can resolve tickets or pin to Class FAQs.
 */
export function canResolveOrPinThreads(role: UserRole): boolean {
  return role === 'faculty' || role === 'dept_head' || role === 'it_admin';
}

/**
 * Workflow 3 Activity Diagram:
 * A student can edit or delete their own inquiry only while `is_resolved === false`.
 */
export function canStudentModifyOwnInquiry(user: User, thread: QaThread): boolean {
  if (user.role !== 'student') return false;
  if (thread.is_resolved || thread.is_pinned_faq) return false;
  return thread.author.id === user.id;
}

/**
 * Privacy filter for Isolated Q&A Threads (Stakeholder Review Table E):
 * Private inquiries (`is_private === true`) are visible only to instructors/admins
 * or the student who authored them.
 */
export function isThreadVisibleToUser(thread: QaThread, user: User): boolean {
  if (!thread.is_private) return true;
  if (canResolveOrPinThreads(user.role)) return true;
  return thread.author.id === user.id;
}

export interface AnnouncementFilterOptions {
  channelId?: number | null;
  search?: string;
  tag?: string;
  department?: string;
  sort?: 'latest' | 'oldest' | 'urgent_first' | 'read_reach';
  includeDrafts?: boolean;
}

/**
 * Filters and sorts announcements according to FR-04_REV and FR-05.
 * Urgent/Pinned notices always appear at the top unless explicitly sorted by oldest.
 */
export function filterAndSortAnnouncements(
  announcements: Announcement[],
  options: AnnouncementFilterOptions = {}
): Announcement[] {
  const {
    channelId,
    search = '',
    tag = 'ALL',
    department = 'ALL',
    sort = 'latest',
    includeDrafts = false,
  } = options;

  const query = search.trim().toLowerCase();

  const filtered = announcements.filter((item) => {
    if (!includeDrafts && item.status !== 'published') {
      return false;
    }
    if (channelId && item.channel_id !== channelId) {
      return false;
    }
    if (tag && tag !== 'ALL') {
      const hasTag = item.tags.some((t) => t.toLowerCase() === tag.toLowerCase());
      if (!hasTag) return false;
    }
    if (department && department !== 'ALL') {
      const matchesDept =
        item.publisher.department.toLowerCase() === department.toLowerCase() ||
        item.tags.some((t) => t.toLowerCase() === department.toLowerCase());
      if (!matchesDept) return false;
    }
    if (query) {
      const haystack = [
        item.title,
        item.subtitle || '',
        item.content,
        item.publisher.name,
        item.publisher.department,
        ...item.tags,
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(query)) {
        return false;
      }
    }
    return true;
  });

  return [...filtered].sort((a, b) => {
    // Always prioritize urgent notices first, then pinned notices (FR-04_REV)
    const aUrgent = a.is_urgent ? 1 : 0;
    const bUrgent = b.is_urgent ? 1 : 0;
    if (aUrgent !== bUrgent) {
      return bUrgent - aUrgent;
    }

    const aPinned = a.is_pinned ? 1 : 0;
    const bPinned = b.is_pinned ? 1 : 0;
    if (aPinned !== bPinned) {
      return bPinned - aPinned;
    }

    if (sort === 'read_reach') {
      return b.read_reach.percentage - a.read_reach.percentage;
    }

    const timeA = new Date(a.published_at).getTime();
    const timeB = new Date(b.published_at).getTime();
    return sort === 'oldest' ? timeA - timeB : timeB - timeA;
  });
}

/**
 * Extracts the first field validation message from a Laravel 422 response payload.
 */
export function getFieldValidationError(
  errors: Record<string, string[]> | undefined,
  field: string
): string | null {
  if (!errors || !errors[field] || errors[field].length === 0) {
    return null;
  }
  return errors[field][0];
}
