'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BookOpen, FolderPlus, Hash, Plus, X } from 'lucide-react';
import { useClarify } from '../../context/ClarifyContext';
import { createChannelApi, joinChannelApi } from '../../lib/api-client';
import {
  formatCourseHubName,
  formatSubChannelDisplayName,
  getCleanChannelDescription,
  getFieldValidationError,
  getSubChannelsForHub,
  getTopLevelCourseHubs,
} from '../../lib/domain-logic';
import type { LaravelValidationError } from '../../types/api';

export function ChannelRosterModal() {
  const router = useRouter();
  const {
    user,
    channels,
    refreshChannels,
    isChannelModalOpen,
    setIsChannelModalOpen,
    channelModalTargetHubId,
    channelModalDefaultTab,
    showToast,
  } = useClarify();

  const courseHubs = getTopLevelCourseHubs(channels);

  const [activeTab, setActiveTab] = useState<
    'create_hub' | 'create_channel' | 'browse'
  >('create_hub');

  // Create Course Hub fields
  const [courseCode, setCourseCode] = useState('');
  const [hubName, setHubName] = useState('');
  const [description, setDescription] = useState('');
  const [scopeDepartment, setScopeDepartment] = useState(
    user?.academic_profile?.department || 'CITC'
  );
  const [scopeSection, setScopeSection] = useState(
    user?.academic_profile?.section || 'IT3R2'
  );

  // Create Sub-Channel inside a Course Hub fields
  const [selectedParentHubId, setSelectedParentHubId] = useState<number>(
    channelModalTargetHubId || courseHubs[0]?.id || 1
  );
  const [subChannelName, setSubChannelName] = useState('');
  const [subChannelTopic, setSubChannelTopic] = useState('');

  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isChannelModalOpen) {
      setFieldErrors({});
      setActiveTab(channelModalDefaultTab || 'create_hub');
      const fallbackHubId =
        channelModalTargetHubId &&
        courseHubs.some((h) => h.id === channelModalTargetHubId)
          ? channelModalTargetHubId
          : courseHubs[0]?.id || 1;
      setSelectedParentHubId(fallbackHubId);
    }
  }, [
    isChannelModalOpen,
    channelModalDefaultTab,
    channelModalTargetHubId,
    courseHubs,
  ]);

  if (!isChannelModalOpen) return null;

  const handleJoinChannel = async (channelId: number) => {
    try {
      const res = await joinChannelApi(channelId);
      await refreshChannels();
      showToast(res.message || 'Joined Course Hub.', 'success');
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      showToast(apiErr.message || 'Unable to join Course Hub.', 'error');
    }
  };

  const handleCreateCourseHub = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFieldErrors({});
    try {
      const cleanHubTitle = hubName.replace(/^#\s*/, '').trim();
      const formattedHubName =
        courseCode.trim() &&
        !cleanHubTitle
          .toLowerCase()
          .startsWith(courseCode.trim().toLowerCase())
          ? `${courseCode.trim().toUpperCase()} ${cleanHubTitle}`
          : cleanHubTitle;

      const res = await createChannelApi({
        course_code: courseCode.trim().toUpperCase(),
        name: formattedHubName,
        description:
          description.trim() ||
          `${scopeSection} Scoped Course Hub with built-in Noticeboard Feed, Isolated Q&A Threads, and #general chat.`,
        channel_type: 'course_hub',
        scope_college: scopeDepartment,
        scope_department: scopeDepartment,
        scope_section: scopeSection,
      });
      await refreshChannels();
      showToast(
        'Course Hub created with Noticeboard Feed, Q&A Threads, and #general!',
        'success'
      );
      setCourseCode('');
      setHubName('');
      setDescription('');
      setIsChannelModalOpen(false);
      if (res.data?.id) {
        router.push(`/channels/${res.data.id}`);
      }
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      if (apiErr.status === 422 && apiErr.errors) {
        setFieldErrors(apiErr.errors);
      } else {
        showToast(apiErr.message || 'Failed to create Course Hub.', 'error');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateSubChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFieldErrors({});

    const parentHub =
      courseHubs.find((h) => h.id === Number(selectedParentHubId)) ||
      courseHubs[0];

    if (!parentHub) {
      showToast('Please create a Course Hub first.', 'error');
      setIsSubmitting(false);
      return;
    }

    const rawChannelSlug = subChannelName
      .replace(/^#\s*/, '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-');

    if (!rawChannelSlug) {
      setFieldErrors({
        name: ['Please enter a channel name (e.g., project-groups).'],
      });
      setIsSubmitting(false);
      return;
    }

    try {
      const res = await createChannelApi({
        course_code: parentHub.course_code || 'HUB',
        name: `# ${rawChannelSlug}`,
        description: `[HUB:${parentHub.id}] ${
          subChannelTopic.trim() ||
          `Channel inside ${formatCourseHubName(parentHub)}`
        }`,
        channel_type: 'course_hub',
        scope_college: parentHub.scope_college || 'CITC',
        scope_department: parentHub.scope_department || 'CITC',
        scope_section: parentHub.scope_section || 'IT3R2',
      });
      await refreshChannels();
      showToast(
        `Created # ${rawChannelSlug} inside ${formatCourseHubName(parentHub)}!`,
        'success'
      );
      setSubChannelName('');
      setSubChannelTopic('');
      setIsChannelModalOpen(false);
      if (res.data?.id) {
        router.push(`/channels/${res.data.id}`);
      }
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      if (apiErr.status === 422 && apiErr.errors) {
        setFieldErrors(apiErr.errors);
      } else {
        showToast(apiErr.message || 'Failed to create channel.', 'error');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const nameError = getFieldValidationError(fieldErrors, 'name');
  const codeError = getFieldValidationError(fieldErrors, 'course_code');
  const targetParentHub =
    courseHubs.find((h) => h.id === Number(selectedParentHubId)) ||
    courseHubs[0];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="channel-portal-modal-title"
    >
      <div className="bg-white border border-slate-300 rounded-lg shadow-xl w-full max-w-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 bg-ustp-navy text-white">
          <div className="flex items-center gap-2">
            {activeTab === 'create_channel' ? (
              <Hash className="w-4 h-4 text-ustp-gold" />
            ) : (
              <FolderPlus className="w-4 h-4 text-ustp-gold" />
            )}
            <h2 id="channel-portal-modal-title" className="text-sm font-bold">
              {activeTab === 'create_channel' && targetParentHub
                ? `Add Channel inside ${formatCourseHubName(targetParentHub)}`
                : 'Course Hubs & Scoped Channels'}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setIsChannelModalOpen(false)}
            aria-label="Close Course Hub modal"
            className="p-1 rounded hover:bg-white/10 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Tabs (shown only when creating/browsing Course Hubs) */}
        {activeTab !== 'create_channel' && (
          <div className="flex flex-wrap items-center gap-2 px-6 pt-3 border-b border-slate-200 bg-ustp-cream">
            <button
              type="button"
              onClick={() => {
                setFieldErrors({});
                setActiveTab('create_hub');
              }}
              className={`px-3.5 py-2 text-xs font-extrabold border-b-2 transition-colors cursor-pointer ${
                activeTab === 'create_hub'
                  ? 'border-ustp-navy text-ustp-navy'
                  : 'border-transparent text-slate-600 hover:text-ustp-text'
              }`}
            >
              + Add Course Hub
            </button>
            <button
              type="button"
              onClick={() => {
                setFieldErrors({});
                setActiveTab('browse');
              }}
              className={`px-3.5 py-2 text-xs font-bold border-b-2 transition-colors cursor-pointer ${
                activeTab === 'browse'
                  ? 'border-ustp-navy text-ustp-navy'
                  : 'border-transparent text-slate-600 hover:text-ustp-text'
              }`}
            >
              Browse Course Hubs ({courseHubs.length})
            </button>
          </div>
        )}

        <div className="p-6 max-h-[72vh] overflow-y-auto">
          {activeTab === 'create_hub' && (
            <form onSubmit={handleCreateCourseHub} className="space-y-4">
              <div className="p-3 bg-ustp-cream border border-amber-200/80 rounded-md text-xs text-ustp-text space-y-1">
                <p className="font-extrabold text-ustp-navy flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5 text-ustp-orange" />
                  <span>What comes built-in with every Course Hub:</span>
                </p>
                <p className="text-slate-600 leading-relaxed">
                  Every new Course Hub automatically includes{' '}
                  <span className="font-bold text-ustp-navy">
                    Noticeboard Feed
                  </span>
                  ,{' '}
                  <span className="font-bold text-ustp-navy">
                    Isolated Q&amp;A Threads
                  </span>
                  , and a default{' '}
                  <span className="font-mono font-bold text-ustp-navy">
                    # general
                  </span>{' '}
                  chat channel. You can then add custom sub-channels inside the
                  Course Hub anytime.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="new-hub-code"
                    className="block text-xs font-bold text-ustp-text mb-1"
                  >
                    Course Code
                  </label>
                  <input
                    id="new-hub-code"
                    type="text"
                    value={courseCode}
                    onChange={(e) => setCourseCode(e.target.value)}
                    placeholder="e.g., IT315"
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded focus:outline-none focus:border-ustp-navy"
                  />
                  {codeError && (
                    <p className="text-xs font-semibold text-red-600 mt-1">
                      {codeError}
                    </p>
                  )}
                </div>
                <div>
                  <label
                    htmlFor="new-hub-name"
                    className="block text-xs font-bold text-ustp-text mb-1"
                  >
                    Course Hub Name
                  </label>
                  <input
                    id="new-hub-name"
                    type="text"
                    value={hubName}
                    onChange={(e) => setHubName(e.target.value)}
                    placeholder="e.g., IT315 Elective 1 or Capstone Group"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded focus:outline-none focus:border-ustp-navy"
                  />
                  {nameError && (
                    <p className="text-xs font-semibold text-red-600 mt-1">
                      {nameError}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="new-hub-dept"
                    className="block text-xs font-bold text-ustp-text mb-1"
                  >
                    Department Scope
                  </label>
                  <select
                    id="new-hub-dept"
                    value={scopeDepartment}
                    onChange={(e) => setScopeDepartment(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded bg-white focus:outline-none focus:border-ustp-navy"
                  >
                    <option value="CITC">CITC</option>
                    <option value="CEA">CEA</option>
                    <option value="COT">COT</option>
                    <option value="CSM">CSM</option>
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="new-hub-section"
                    className="block text-xs font-bold text-ustp-text mb-1"
                  >
                    Target Section
                  </label>
                  <input
                    id="new-hub-section"
                    type="text"
                    value={scopeSection}
                    onChange={(e) => setScopeSection(e.target.value)}
                    placeholder="IT3R2"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded focus:outline-none focus:border-ustp-navy"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="new-hub-desc"
                  className="block text-xs font-bold text-ustp-text mb-1"
                >
                  Course Hub Description
                </label>
                <textarea
                  id="new-hub-desc"
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Scoped Course Hub for announcements, Q&A threads, and class channels..."
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded focus:outline-none focus:border-ustp-navy"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsChannelModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-extrabold bg-ustp-navy text-ustp-gold rounded hover:opacity-95 disabled:opacity-50 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>
                    {isSubmitting ? 'Creating Hub...' : 'Create Course Hub'}
                  </span>
                </button>
              </div>
            </form>
          )}

          {activeTab === 'create_channel' && (
            <form onSubmit={handleCreateSubChannel} className="space-y-4">
              <div>
                <label
                  htmlFor="parent-hub-select"
                  className="block text-xs font-bold text-ustp-text mb-1"
                >
                  Parent Course Hub
                </label>
                <select
                  id="parent-hub-select"
                  value={selectedParentHubId}
                  onChange={(e) => setSelectedParentHubId(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs font-bold text-ustp-navy border border-slate-300 rounded bg-slate-50 focus:outline-none focus:border-ustp-navy"
                >
                  {courseHubs.map((hub) => (
                    <option key={hub.id} value={hub.id}>
                      {formatCourseHubName(hub)} ({hub.scope_section || 'IT3R2'} •{' '}
                      {hub.scope_department || 'CITC'})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="sub-channel-name"
                  className="block text-xs font-bold text-ustp-text mb-1"
                >
                  Channel Name
                </label>
                <div className="relative flex items-center">
                  <span className="absolute left-3 text-xs font-mono font-extrabold text-slate-400 select-none">
                    #
                  </span>
                  <input
                    id="sub-channel-name"
                    type="text"
                    value={subChannelName}
                    onChange={(e) => setSubChannelName(e.target.value)}
                    placeholder="e.g., project-groups, lecture-notes, lab-help"
                    className="w-full pl-7 pr-3 py-2 text-xs font-mono border border-slate-300 rounded focus:outline-none focus:border-ustp-navy"
                  />
                </div>
                {nameError && (
                  <p className="text-xs font-semibold text-red-600 mt-1">
                    {nameError}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="sub-channel-topic"
                  className="block text-xs font-bold text-ustp-text mb-1"
                >
                  Channel Topic / Purpose (Optional)
                </label>
                <input
                  id="sub-channel-topic"
                  type="text"
                  value={subChannelTopic}
                  onChange={(e) => setSubChannelTopic(e.target.value)}
                  placeholder="Coordinate group deliverables, share reviewers, or discuss lab exercises..."
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded focus:outline-none focus:border-ustp-navy"
                />
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsChannelModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-extrabold bg-ustp-navy text-ustp-gold rounded hover:opacity-95 disabled:opacity-50 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>
                    {isSubmitting ? 'Adding Channel...' : 'Add Channel'}
                  </span>
                </button>
              </div>
            </form>
          )}

          {activeTab === 'browse' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 pb-1">
                <p className="text-xs font-bold text-slate-600">
                  Available Course Hubs ({courseHubs.length})
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab('create_hub')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-ustp-gold text-ustp-navy rounded hover:opacity-95 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ Add Course Hub</span>
                </button>
              </div>
              {courseHubs.map((hub) => {
                const enrolledCount =
                  hub.roster !== undefined
                    ? hub.roster.length
                    : hub.members_count ?? 0;
                const hubSubChannels = getSubChannelsForHub(channels, hub.id);

                return (
                  <div
                    key={hub.id}
                    className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/60 space-y-2.5"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-extrabold text-ustp-navy">
                            {formatCourseHubName(hub)}
                          </span>
                          <span className="text-xs font-semibold text-slate-600">
                            · {hub.scope_section} · {hub.scope_department}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 mt-0.5">
                          {getCleanChannelDescription(hub.description)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs font-mono tabular-nums text-slate-600">
                          {enrolledCount}{' '}
                          {enrolledCount === 1 ? 'member' : 'members'}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleJoinChannel(hub.id)}
                          className="px-3 py-1.5 text-xs font-bold bg-ustp-navy text-white rounded hover:opacity-95 cursor-pointer"
                        >
                          Verify / Sync Access
                        </button>
                      </div>
                    </div>

                    {/* Built-in + Custom Channels Preview */}
                    <div className="pt-2 border-t border-slate-200/80 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-950 font-bold">
                          Noticeboard Feed
                        </span>
                        <span className="px-2 py-0.5 rounded bg-sky-100 text-sky-950 font-bold">
                          Isolated Q&amp;A Threads
                        </span>
                        <span className="px-2 py-0.5 rounded bg-slate-200 text-ustp-navy font-mono font-bold">
                          # general
                        </span>
                        {hubSubChannels.map((sub) => (
                          <span
                            key={sub.id}
                            className="px-2 py-0.5 rounded bg-slate-200 text-ustp-navy font-mono font-bold"
                          >
                            {formatSubChannelDisplayName(sub)}
                          </span>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedParentHubId(hub.id);
                          setActiveTab('create_channel');
                        }}
                        className="inline-flex items-center gap-1 text-[11px] font-extrabold text-ustp-navy hover:underline cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Add Channel</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
