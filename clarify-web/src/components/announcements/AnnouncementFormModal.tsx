'use client';
import { useState } from 'react';
import { createAnnouncement, updateAnnouncement } from '@/lib/announcement-service';
import { TAG_OPTIONS } from './AnnouncementFilterBar';
import type { Announcement, ApiError } from '@/types/api';

interface FormModalProps {
  announcement: Announcement | null; // null = create, object = edit
  channels: { id: number; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}

function FieldError({ message }: { message?: string }) {
  return message ? <p className="mt-1 text-sm text-red-600">{message}</p> : null;
}

export function AnnouncementFormModal({ announcement, channels, onClose, onSaved }: FormModalProps) {
  const isEdit = announcement !== null;

  const [title, setTitle] = useState(announcement?.title ?? '');
  const [content, setContent] = useState(announcement?.content ?? '');
  const [channelId, setChannelId] = useState<string>(String(announcement?.channel_id ?? channels[0]?.id ?? ''));
  const [tags, setTags] = useState<string[]>(announcement?.tags ?? []);
  const [isUrgent, setIsUrgent] = useState(announcement?.is_urgent ?? false);
  const [isDraft, setIsDraft] = useState(false);
  const [smsFallback, setSmsFallback] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const toggleTag = (tag: string) =>
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldErrors({});
    setFormError(null);
    setIsSubmitting(true);

    try {
      if (isEdit && announcement) {
        await updateAnnouncement(announcement.id, { title, content, is_urgent: isUrgent });
      } else {
        const fd = new FormData();
        fd.append('channel_id', channelId);
        fd.append('title', title);
        fd.append('content', content);
        tags.forEach((t) => fd.append('tags[]', t));
        fd.append('is_urgent', isUrgent ? '1' : '0');
        fd.append('trigger_sms_fallback', smsFallback ? '1' : '0');
        fd.append('status', isDraft ? 'draft' : 'published');
        if (file) fd.append('attachment', file);
        await createAnnouncement(fd);
      }
      onSaved();
    } catch (err) {
      const apiErr = err as Partial<ApiError>;
      if (apiErr.status === 422 && apiErr.errors) {
        // show the first message under each field
        const mapped: Record<string, string> = {};
        Object.entries(apiErr.errors).forEach(([field, msgs]) => {
          mapped[field] = msgs[0];
        });
        setFieldErrors(mapped);
      } else if (apiErr.status === 403) {
        setFormError('Access Denied: Only authorized faculty assigned to this Course Hub can publish announcements.');
      } else {
        setFormError(apiErr.message ?? 'Something went wrong. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const input = 'mt-1 w-full rounded border border-gray-300 px-3 py-2 text-ustp-text';
  const label = 'block text-sm font-semibold text-ustp-navy';

  const submitLabel = isSubmitting
    ? isEdit ? 'Saving...' : 'Publishing...'
    : isEdit ? 'Save Changes' : isDraft ? 'Save Draft' : 'Publish';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div role="dialog" aria-modal="true" className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6">
        <h2 className="mb-4 text-xl font-bold text-ustp-navy">
          {isEdit ? 'Edit Announcement' : 'New Announcement'}
        </h2>

        {formError && (
          <div role="alert" className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
            {formError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isEdit && (
            <div>
              <label className={label} htmlFor="channel">Course Hub / Channel</label>
              <select id="channel" className={input} value={channelId} onChange={(e) => setChannelId(e.target.value)}>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <FieldError message={fieldErrors.channel_id} />
            </div>
          )}

          <div>
            <label className={label} htmlFor="title">Title</label>
            <input id="title" className={input} value={title} onChange={(e) => setTitle(e.target.value)} />
            <FieldError message={fieldErrors.title} />
          </div>

          <div>
            <label className={label} htmlFor="content">Content</label>
            <textarea id="content" rows={5} className={input} value={content} onChange={(e) => setContent(e.target.value)} />
            <FieldError message={fieldErrors.content} />
          </div>

          {!isEdit && (
            <>
              <div>
                <span className={label}>Tags</span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {TAG_OPTIONS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleTag(t)}
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        tags.includes(t) ? 'bg-ustp-navy text-white' : 'bg-gray-100 text-ustp-text'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <FieldError message={fieldErrors.tags} />
              </div>

              <div>
                <label className={label} htmlFor="attachment">Attachment (file or photo)</label>
                <input
                  id="attachment"
                  type="file"
                  className="mt-1 block w-full text-sm"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <FieldError message={fieldErrors.attachment} />
              </div>
            </>
          )}

          <div className="space-y-2 text-sm text-ustp-text">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={isUrgent} onChange={(e) => setIsUrgent(e.target.checked)} />
              Mark as Urgent (Pin + Push Alert)
            </label>
            {!isEdit && (
              <>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={smsFallback} onChange={(e) => setSmsFallback(e.target.checked)} />
                  Trigger Offline SMS Fallback
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={isDraft} onChange={(e) => setIsDraft(e.target.checked)} />
                  Save as Draft
                </label>
              </>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded border border-gray-300 px-4 py-2 text-sm font-semibold text-ustp-text"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded bg-ustp-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}