'use client';

import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  FileText,
  Image as ImageIcon,
  Plus,
  Radio,
  Smartphone,
  X,
} from 'lucide-react';
import { useClarify } from '../../context/ClarifyContext';
import {
  createAnnouncementApi,
  updateAnnouncementApi,
} from '../../lib/api-client';
import {
  formatCourseHubName,
  getFieldValidationError,
  getJoinedCourseHubs,
  getTopLevelCourseHubs,
} from '../../lib/domain-logic';
import type { LaravelValidationError } from '../../types/api';
import { TagBadge } from '../ui/StateViews';

const AVAILABLE_TAGS = [
  'URGENT NOTICE',
  'OFFICIAL MEMO',
  'CDO CAMPUS',
  'CITC',
  'CEA',
  'COT',
  'CSM',
  'Faculty',
  'MEMORANDUM',
];

const CAMPUS_DEPARTMENTS = ['CITC', 'CEA', 'COT', 'CSM'];

export function AnnouncementFormModal() {
  const {
    user,
    announcementModalState,
    closeAnnouncementModal,
    channels,
    triggerAnnouncementRefresh,
    showToast,
  } = useClarify();

  const allCourseHubs = getTopLevelCourseHubs(channels);
  const joinedCourseHubs = getJoinedCourseHubs(channels, user);
  const handledCourseHubs =
    joinedCourseHubs.length > 0 ? joinedCourseHubs : allCourseHubs;

  const { isOpen, editingAnnouncement, defaultChannelId, mode } =
    announcementModalState;

  const isCampusWideMode = editingAnnouncement
    ? editingAnnouncement.channel_type === 'university'
    : mode === 'campus_wide';

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [selectedChannelIds, setSelectedChannelIds] = useState<number[]>(
    defaultChannelId ? [defaultChannelId] : []
  );
  const [selectedTags, setSelectedTags] = useState<string[]>([
    'OFFICIAL MEMO',
    'CDO CAMPUS',
    user?.academic_profile?.department || 'CITC',
  ]);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [isUrgent, setIsUrgent] = useState(false);
  const [triggerSmsFallback, setTriggerSmsFallback] = useState(false);
  const [status, setStatus] = useState<'published' | 'draft'>('published');
  const [attachmentName, setAttachmentName] = useState<string | null>(null);
  const [attachmentType, setAttachmentType] = useState<'image' | 'document' | null>(
    null
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  const wasOpenRef = React.useRef(false);
  const lastEditingIdRef = React.useRef<number | null>(null);
  const lastDefaultChannelIdRef = React.useRef<number | undefined>(undefined);
  const lastModeRef = React.useRef<'campus_wide' | 'course_hub' | undefined>(
    undefined
  );

  useEffect(() => {
    const editingId = editingAnnouncement?.id ?? null;
    const justOpened = isOpen && !wasOpenRef.current;
    const switchedTarget =
      isOpen &&
      (editingId !== lastEditingIdRef.current ||
        defaultChannelId !== lastDefaultChannelIdRef.current ||
        mode !== lastModeRef.current);

    wasOpenRef.current = isOpen;
    lastEditingIdRef.current = editingId;
    lastDefaultChannelIdRef.current = defaultChannelId;
    lastModeRef.current = mode;

    if (!justOpened && !switchedTarget) {
      return;
    }

    setFieldErrors({});
    setGeneralError(null);
    setShowTagPicker(false);
    if (editingAnnouncement) {
      setTitle(editingAnnouncement.title);
      setContent(editingAnnouncement.content);
      setSelectedChannelIds([editingAnnouncement.channel_id]);
      setSelectedTags(
        editingAnnouncement.channel_type === 'university'
          ? editingAnnouncement.tags
          : []
      );
      setIsUrgent(editingAnnouncement.is_urgent);
      setTriggerSmsFallback(Boolean(editingAnnouncement.trigger_sms_fallback));
      setStatus(
        editingAnnouncement.status === 'draft' ? 'draft' : 'published'
      );
      setAttachmentName(editingAnnouncement.attachment_name || null);
      setAttachmentType(editingAnnouncement.attachment_type || null);
    } else {
      setTitle('');
      setContent('');
      const validDefault =
        defaultChannelId || handledCourseHubs[0]?.id || 1;
      setSelectedChannelIds([validDefault]);
      const userDept = user?.academic_profile?.department || 'CITC';
      setSelectedTags(
        mode === 'campus_wide' ? ['OFFICIAL MEMO', 'CDO CAMPUS', userDept] : []
      );
      setIsUrgent(false);
      setTriggerSmsFallback(false);
      setStatus('published');
      setAttachmentName(null);
      setAttachmentType(null);
    }
  }, [
    isOpen,
    editingAnnouncement,
    defaultChannelId,
    mode,
    handledCourseHubs,
    user?.academic_profile?.department,
  ]);

  if (!isOpen) return null;

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const toggleCourseHubSelection = (hubId: number) => {
    setSelectedChannelIds((prev) => {
      if (prev.includes(hubId)) {
        if (prev.length === 1) return prev; // Keep at least 1 handled course selected
        return prev.filter((id) => id !== hubId);
      }
      return [...prev, hubId];
    });
  };

  const handleSimulatedFileSelect = (type: 'image' | 'document') => {
    if (type === 'image') {
      setAttachmentName('USTP_CITC_Room302_Floorplan.png');
      setAttachmentType('image');
    } else {
      setAttachmentName('Official_CITC_Memorandum_2026.pdf');
      setAttachmentType('document');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFieldErrors({});
    setGeneralError(null);

    const outgoingTags = isCampusWideMode ? selectedTags : [];

    try {
      if (editingAnnouncement) {
        const res = await updateAnnouncementApi(editingAnnouncement.id, {
          title,
          content,
          tags: outgoingTags,
          is_urgent: isUrgent,
          trigger_sms_fallback: triggerSmsFallback,
          status,
        });
        showToast(res.message || 'Announcement updated.', 'success');
      } else {
        const formData = new FormData();
        formData.set(
          'scope_mode',
          isCampusWideMode ? 'campus_wide' : 'course_hub'
        );
        if (!isCampusWideMode) {
          const primaryId =
            selectedChannelIds[0] || defaultChannelId || handledCourseHubs[0]?.id || 1;
          const targetIds =
            selectedChannelIds.length > 0 ? selectedChannelIds : [primaryId];
          formData.set('channel_id', String(primaryId));
          formData.set('channel_ids', JSON.stringify(targetIds));
        }
        formData.set('title', title);
        formData.set('content', content);
        formData.set('tags', JSON.stringify(outgoingTags));
        formData.set('is_urgent', String(isUrgent));
        formData.set('trigger_sms_fallback', String(triggerSmsFallback));
        formData.set('status', status);
        if (attachmentName) {
          formData.set('attachment_name', attachmentName);
        }
        if (attachmentType) {
          formData.set('attachment_type', attachmentType);
        }

        const res = await createAnnouncementApi(formData);
        showToast(res.message || 'Announcement posted.', 'success');
      }
      triggerAnnouncementRefresh();
      closeAnnouncementModal();
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      if (apiErr.status === 422 && apiErr.errors) {
        setFieldErrors(apiErr.errors);
      } else {
        setGeneralError(
          apiErr.message || 'Failed to publish announcement. Please try again.'
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const titleError = getFieldValidationError(fieldErrors, 'title');
  const contentError = getFieldValidationError(fieldErrors, 'content');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="announcement-modal-title"
    >
      <div className="bg-white border border-slate-300 rounded-lg shadow-xl w-full max-w-2xl overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center justify-between px-6 py-3.5 bg-ustp-navy text-white">
          <h2 id="announcement-modal-title" className="text-sm font-bold tracking-tight">
            {editingAnnouncement
              ? `Edit ${
                  isCampusWideMode ? 'Campus-Wide' : 'Course Hub'
                } Announcement #${editingAnnouncement.id}`
              : isCampusWideMode
              ? 'Create Campus-Wide Announcement (Department Head)'
              : 'Create Course Hub Announcement'}
          </h2>
          <button
            type="button"
            onClick={closeAnnouncementModal}
            aria-label="Close announcement modal"
            className="p-1 rounded hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-ustp-gold cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Wireframe Page 6 Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {generalError && (
            <div className="p-3 bg-red-50 border border-red-300 rounded text-xs text-red-800 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{generalError}</span>
            </div>
          )}

          {/* Large "Title" Input matching Page 6 */}
          <div>
            <label htmlFor="announcement-title-input" className="sr-only">
              Announcement Title
            </label>
            <input
              id="announcement-title-input"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              className="w-full text-2xl font-bold text-ustp-text placeholder:text-slate-400 border-b border-slate-200 pb-2 focus:outline-none focus:border-ustp-navy"
            />
            {titleError && (
              <p className="text-xs font-semibold text-red-600 mt-1" role="alert">
                {titleError}
              </p>
            )}
          </div>

          {/* Campus-Wide Mode: "Add tags +" multi-select pill picker */}
          {isCampusWideMode && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  {selectedTags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleTag(tag)}
                      title="Click to remove tag"
                      className="cursor-pointer"
                    >
                      <TagBadge tag={tag} size="xs" />
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setShowTagPicker((v) => !v)}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded cursor-pointer"
                  >
                    <span>Add tags</span>
                    <Plus className="w-3 h-3" />
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-bold text-slate-600">
                    Departments:
                  </span>
                  {CAMPUS_DEPARTMENTS.map((dept) => {
                    const isDeptActive = selectedTags.includes(dept);
                    return (
                      <button
                        key={dept}
                        type="button"
                        onClick={() => toggleTag(dept)}
                        className={`px-2 py-0.5 rounded text-[11px] font-bold border transition-colors cursor-pointer ${
                          isDeptActive
                            ? 'bg-ustp-navy text-ustp-gold border-ustp-navy'
                            : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'
                        }`}
                      >
                        {isDeptActive ? `✓ ${dept}` : dept}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Course Hub Mode: Allow Instructor to select 1 or multiple handled Course Hubs */}
          {!isCampusWideMode && !editingAnnouncement && (
            <div className="p-2.5 bg-ustp-cream border border-amber-200/80 rounded-md space-y-1.5">
              <p className="text-[11px] font-extrabold text-ustp-navy">
                Target Handled Course Hub(s) ({selectedChannelIds.length}{' '}
                selected):
              </p>
              <div className="flex flex-wrap gap-1.5">
                {handledCourseHubs.map((ch) => {
                  const isSelected = selectedChannelIds.includes(ch.id);
                  return (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() => toggleCourseHubSelection(ch.id)}
                      className={`px-2.5 py-1 rounded text-xs font-bold border transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-ustp-navy text-ustp-gold border-ustp-navy'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      {isSelected ? '✓ ' : '+ '}
                      {formatCourseHubName(ch)} ({ch.scope_section || 'IT3R2'})
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {isCampusWideMode && showTagPicker && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-md flex flex-wrap gap-1.5">
              {AVAILABLE_TAGS.map((tag) => {
                const active = selectedTags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className={`px-2.5 py-1 rounded text-xs font-semibold border transition-colors cursor-pointer ${
                      active
                        ? 'bg-ustp-navy text-white border-ustp-navy'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    {active ? `✓ ${tag}` : `+ ${tag}`}
                  </button>
                );
              })}
            </div>
          )}

          {/* "Type here" rich textarea matching Page 6 */}
          <div>
            <label htmlFor="announcement-content-input" className="sr-only">
              Announcement Content
            </label>
            <textarea
              id="announcement-content-input"
              rows={5}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Type here"
              className="w-full text-sm text-ustp-text placeholder:text-slate-400 border border-slate-200 rounded-md p-3 focus:outline-none focus:border-ustp-navy leading-relaxed"
            />
            {contentError && (
              <p className="text-xs font-semibold text-red-600 mt-1" role="alert">
                {contentError}
              </p>
            )}
          </div>

          {/* Workflow 2 Delivery & Urgency Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
            <label className="flex items-start gap-2 p-2.5 rounded border border-slate-200 bg-slate-50/70 cursor-pointer">
              <input
                type="checkbox"
                checked={isUrgent}
                onChange={(e) => setIsUrgent(e.target.checked)}
                className="mt-0.5 accent-ustp-navy"
              />
              <span className="text-xs">
                <span className="font-bold text-ustp-text flex items-center gap-1">
                  <Radio className="w-3.5 h-3.5 text-red-600" />
                  Urgent Pin & Push
                </span>
                <span className="text-slate-600 block text-[11px]">
                  Pins top + &le;2.0s alert
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2 p-2.5 rounded border border-slate-200 bg-slate-50/70 cursor-pointer">
              <input
                type="checkbox"
                checked={triggerSmsFallback}
                onChange={(e) => setTriggerSmsFallback(e.target.checked)}
                className="mt-0.5 accent-ustp-navy"
              />
              <span className="text-xs">
                <span className="font-bold text-ustp-text flex items-center gap-1">
                  <Smartphone className="w-3.5 h-3.5 text-amber-600" />
                  SMS Fallback
                </span>
                <span className="text-slate-600 block text-[11px]">
                  Offline weather/emergency blast
                </span>
              </span>
            </label>

            <div className="flex flex-col justify-center p-2.5 rounded border border-slate-200 bg-slate-50/70">
              <label
                htmlFor="announcement-status-select"
                className="text-[11px] font-bold text-slate-600"
              >
                Publication Status
              </label>
              <select
                id="announcement-status-select"
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as 'published' | 'draft')
                }
                className="text-xs font-bold text-ustp-text bg-transparent focus:outline-none mt-0.5"
              >
                <option value="published">Published (Live Feed)</option>
                <option value="draft">Save as Draft</option>
              </select>
            </div>
          </div>

          {/* Bottom Action Row matching Wireframe Page 6 (Bottom-left Image & File icons, Bottom-right Navy "Post" button) */}
          <div className="flex items-center justify-between pt-3 border-t border-slate-200">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleSimulatedFileSelect('image')}
                aria-label="Attach image"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-ustp-text bg-slate-100 hover:bg-slate-200 rounded border border-slate-300 cursor-pointer"
              >
                <ImageIcon className="w-4 h-4 text-ustp-navy" />
                <span>Image</span>
              </button>
              <button
                type="button"
                onClick={() => handleSimulatedFileSelect('document')}
                aria-label="Attach document"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-ustp-text bg-slate-100 hover:bg-slate-200 rounded border border-slate-300 cursor-pointer"
              >
                <FileText className="w-4 h-4 text-ustp-navy" />
                <span>Document</span>
              </button>
              {attachmentName && (
                <span className="text-xs text-slate-600 font-mono truncate max-w-[180px]">
                  {attachmentName}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={closeAnnouncementModal}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-6 py-2 text-xs font-bold bg-ustp-navy text-white rounded hover:opacity-95 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-ustp-gold cursor-pointer"
              >
                {isSubmitting
                  ? 'Publishing...'
                  : editingAnnouncement
                  ? 'Save Changes'
                  : 'Post'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
