import { apiClient } from '@/lib/api-client';
import { mockAnnouncementList } from '@/mocks/announcements';
import type { Announcement, ApiError } from '@/types/api';

export const USE_MOCKS = true;

const wait = (ms = 500) => new Promise((r) => setTimeout(r, ms));

function createApiError(
  status: number,
  message: string,
  errors?: Record<string, string[]>
): ApiError {
  const err = new Error(message) as ApiError;
  err.status = status;
  if (errors) err.errors = errors;
  return err;
}

export async function acknowledgeAnnouncement(id: number): Promise<void> {
  if (USE_MOCKS) {
    await wait();
    const target = mockAnnouncementList.find((x) => x.id === id);
    if (target && !target.read_reach.has_current_user_acknowledged) {
      const reach = target.read_reach;
      reach.acknowledged_count += 1;
      reach.percentage = Math.round((reach.acknowledged_count / reach.enrolled_total) * 1000) / 10;
      reach.has_current_user_acknowledged = true;
    }
    return;
  }
  await apiClient.post(`/announcements/${id}/acknowledge`);
}

export async function deleteAnnouncement(id: number): Promise<void> {
  if (USE_MOCKS) {
    await wait();
    const index = mockAnnouncementList.findIndex((x) => x.id === id);
    if (index >= 0) {
      mockAnnouncementList.splice(index, 1);
    }
    return;
  }
  await apiClient.delete(`/announcements/${id}`);
}

export async function createAnnouncement(form: FormData): Promise<Announcement> {
  if (USE_MOCKS) {
    await wait();
    const title = String(form.get('title') ?? '').trim();
    const content = String(form.get('content') ?? '').trim();

    const errors: Record<string, string[]> = {};
    if (!title) errors.title = ['The title field is required.'];
    if (!content) errors.content = ['The content field is required.'];

    if (Object.keys(errors).length > 0) {
      throw createApiError(422, 'Validation failed.', errors);
    }

    const now = new Date().toISOString();
    const isUrgent = form.get('is_urgent') === '1';

    const created: Announcement = {
      id: Date.now(),
      channel_id: Number(form.get('channel_id')) || 1,
      title,
      content,
      attachment_url: null,
      tags: form.getAll('tags[]').map(String),
      is_urgent: isUrgent,
      is_pinned: isUrgent,
      status: form.get('status') === 'draft' ? 'draft' : 'published',
      is_edited: false,
      published_at: now,
      updated_at: now,
      read_reach: {
        acknowledged_count: 0,
        enrolled_total: 42,
        percentage: 0,
        has_current_user_acknowledged: false,
      },
      publisher: {
        id: 1,
        name: 'Zyra Nadine Flores',
        role: 'faculty',
        department: 'CITC',
      },
    };

    mockAnnouncementList.unshift(created);
    return created;
  }

  const res = (await apiClient.post('/announcements', form)) as { data: Announcement };
  return res.data;
}

export async function updateAnnouncement(
  id: number,
  payload: { title: string; content: string; is_urgent: boolean }
): Promise<Announcement | null> {
  if (USE_MOCKS) {
    await wait();
    const errors: Record<string, string[]> = {};

    if (!payload.title.trim()) {
      errors.title = ['The title field is required.'];
    }
    if (!payload.content.trim()) {
      errors.content = ['The content field is required.'];
    }

    if (Object.keys(errors).length > 0) {
      throw createApiError(422, 'Validation failed.', errors);
    }

    const target = mockAnnouncementList.find((x) => x.id === id);
    if (!target) return null;

    Object.assign(target, payload, {
      is_pinned: payload.is_urgent,
      is_edited: true,
      updated_at: new Date().toISOString(),
    });

    return target;
  }

  const res = (await apiClient.patch(`/announcements/${id}`, payload)) as { data: Announcement };
  return res.data;
}