'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock,
  Edit3,
  FolderPlus,
  Hash,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { useClarify } from '../../context/ClarifyContext';
import {
  createChannelApi,
  deleteChannelApi,
  joinChannelApi,
  leaveChannelApi,
  updateChannelApi,
} from '../../lib/api-client';
import {
  formatCourseHubName,
  formatSubChannelDisplayName,
  getCleanChannelDescription,
  getFieldValidationError,
  getJoinedCourseHubs,
  getSubChannelsForHub,
  getTopLevelCourseHubs,
  isUserCourseAdmin,
  isUserEnrolledInCourseHub,
  isUserPendingInCourseHub,
} from '../../lib/domain-logic';
import type { Channel, LaravelValidationError } from '../../types/api';

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
  const joinedCourseHubs = getJoinedCourseHubs(channels, user);

  const [activeTab, setActiveTab] = useState<
    'create_hub' | 'edit_hub' | 'create_channel' | 'browse'
  >('create_hub');

  // Create / Edit Course Hub fields
  const [editingHubId, setEditingHubId] = useState<number | null>(null);
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

  // Browse Course Hubs search & Edit Hub delete confirmation
  const [browseSearch, setBrowseSearch] = useState('');
  const [confirmDeleteHubId, setConfirmDeleteHubId] = useState<number | null>(
    null
  );
  const [isDeletingId, setIsDeletingId] = useState<number | null>(null);
  const [joiningHubId, setJoiningHubId] = useState<number | null>(null);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Guard ref so form inputs are ONLY initialized when the modal opens or switches target tab/hub, never on keystrokes or background polls
  const lastInitKeyRef = useRef<string>('');

  const populateEditFields = (hub: Channel) => {
    setEditingHubId(hub.id);
    const code = (hub.course_code || '').trim();
    const cleanFull = formatCourseHubName(hub);
    const strippedTitle =
      code && cleanFull.toLowerCase().startsWith(code.toLowerCase())
        ? cleanFull.slice(code.length).trim() || cleanFull
        : cleanFull;
    setCourseCode(code);
    setHubName(strippedTitle);
    setDescription(getCleanChannelDescription(hub.description));
    setScopeDepartment(hub.scope_department || 'CITC');
    setScopeSection(hub.scope_section || 'IT3R2');
  };

  useEffect(() => {
    if (!isChannelModalOpen) {
      lastInitKeyRef.current = '';
      return;
    }

    const initKey = `${channelModalDefaultTab || 'create_hub'}:${
      channelModalTargetHubId ?? 'none'
    }`;
    if (lastInitKeyRef.current === initKey) {
      return;
    }
    lastInitKeyRef.current = initKey;

    const currentHubs = getTopLevelCourseHubs(channels);
    setFieldErrors({});
    setConfirmDeleteHubId(null);
    const nextTab = channelModalDefaultTab || 'create_hub';
    setActiveTab(nextTab);

    const fallbackHubId =
      channelModalTargetHubId &&
      currentHubs.some((h) => h.id === channelModalTargetHubId)
        ? channelModalTargetHubId
        : currentHubs[0]?.id || 1;
    setSelectedParentHubId(fallbackHubId);

    if (nextTab === 'edit_hub') {
      const targetHub =
        currentHubs.find((h) => h.id === channelModalTargetHubId) ||
        currentHubs[0];
      if (targetHub) {
        populateEditFields(targetHub);
      }
    } else if (nextTab === 'create_hub') {
      setEditingHubId(null);
      setCourseCode('');
      setHubName('');
      setDescription('');
      setScopeDepartment(user?.academic_profile?.department || 'CITC');
      setScopeSection(user?.academic_profile?.section || 'IT3R2');
    } else if (nextTab === 'create_channel') {
      setSubChannelName('');
      setSubChannelTopic('');
    }
  }, [
    isChannelModalOpen,
    channelModalDefaultTab,
    channelModalTargetHubId,
    channels,
    user?.academic_profile?.department,
    user?.academic_profile?.section,
  ]);

  if (!isChannelModalOpen) return null;

  const editingHub =
    courseHubs.find((h) => h.id === editingHubId) ||
    courseHubs.find((h) => h.id === channelModalTargetHubId);
  const canAdminEditCurrentHub = isUserCourseAdmin(editingHub, user);

  const handleJoinChannel = async (
    channelId: number,
    openAfterJoin = true
  ) => {
    setJoiningHubId(channelId);
    try {
      const res = await joinChannelApi(channelId);
      await refreshChannels();
      const wasImmediatelyApproved = isUserEnrolledInCourseHub(res.data, user);
      showToast(
        res.message ||
          (wasImmediatelyApproved
            ? 'Joined Course Hub!'
            : 'Join request sent! Waiting for Course Admin approval.'),
        'success'
      );
      if (openAfterJoin && wasImmediatelyApproved) {
        setIsChannelModalOpen(false);
        router.push(`/channels/${channelId}`);
      }
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      showToast(apiErr.message || 'Unable to join Course Hub.', 'error');
    } finally {
      setJoiningHubId(null);
    }
  };

  const handleCancelJoinRequest = async (channelId: number) => {
    setJoiningHubId(channelId);
    try {
      const res = await leaveChannelApi(channelId);
      await refreshChannels();
      showToast(res.message || 'Join request cancelled.', 'info');
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      showToast(apiErr.message || 'Unable to cancel join request.', 'error');
    } finally {
      setJoiningHubId(null);
    }
  };

  const handleDeleteHub = async (hub: Channel) => {
    setIsDeletingId(hub.id);
    try {
      const res = await deleteChannelApi(hub.id);
      await refreshChannels();
      setConfirmDeleteHubId(null);
      setIsChannelModalOpen(false);
      showToast(
        res.message || `Deleted ${formatCourseHubName(hub)}.`,
        'info'
      );
      const remainingJoined = joinedCourseHubs.filter((h) => h.id !== hub.id);
      if (remainingJoined.length > 0) {
        router.push(`/channels/${remainingJoined[0].id}`);
      } else {
        router.push('/');
      }
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      showToast(apiErr.message || 'Failed to delete Course Hub.', 'error');
    } finally {
      setIsDeletingId(null);
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
          `${scopeSection} Scoped Course Hub with built-in Noticeboard Feed and Isolated Q&A Threads.`,
        channel_type: 'course_hub',
        scope_college: scopeDepartment,
        scope_department: scopeDepartment,
        scope_section: scopeSection,
      });
      await refreshChannels();
      showToast(
        'Course Hub created with Noticeboard Feed and Isolated Q&A Threads!',
        'success'
      );
      setCourseCode('');
      setHubName('');
      setDescription('');
      setIsChannelModalOpen(false);
      if (res.data?.id) {
        router.push(`/channels/${res.data.id}?tab=feed`);
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

  const handleUpdateCourseHub = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingHubId) return;
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

      const res = await updateChannelApi(editingHubId, {
        course_code: courseCode.trim().toUpperCase(),
        name: formattedHubName,
        description:
          description.trim() ||
          `${scopeSection} Scoped Course Hub with built-in Noticeboard Feed and Isolated Q&A Threads.`,
        scope_college: scopeDepartment,
        scope_department: scopeDepartment,
        scope_section: scopeSection,
      });
      await refreshChannels();
      showToast(res.message || 'Course Hub updated successfully!', 'success');
      setIsChannelModalOpen(false);
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      if (apiErr.status === 422 && apiErr.errors) {
        setFieldErrors(apiErr.errors);
      } else {
        showToast(apiErr.message || 'Failed to update Course Hub.', 'error');
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

  const filteredBrowseHubs = courseHubs.filter((hub) => {
    const q = browseSearch.trim().toLowerCase();
    if (!q) return true;
    return `${hub.name} ${hub.course_code || ''} ${hub.scope_section || ''} ${
      hub.scope_department || ''
    } ${hub.description || ''}`
      .toLowerCase()
      .includes(q);
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="channel-portal-modal-title"
    >
      <div className="bg-white border border-slate-300 rounded-lg shadow-xl w-full max-w-2xl max-h-[90dvh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 bg-ustp-navy text-white shrink-0">
          <div className="flex items-center gap-2">
            {activeTab === 'create_channel' ? (
              <Hash className="w-4 h-4 text-ustp-gold" />
            ) : activeTab === 'edit_hub' ? (
              <Edit3 className="w-4 h-4 text-ustp-gold" />
            ) : activeTab === 'browse' ? (
              <Search className="w-4 h-4 text-ustp-gold" />
            ) : (
              <FolderPlus className="w-4 h-4 text-ustp-gold" />
            )}
            <h2 id="channel-portal-modal-title" className="text-sm font-bold">
              {activeTab === 'create_channel' && targetParentHub
                ? `Add Channel inside ${formatCourseHubName(targetParentHub)}`
                : activeTab === 'edit_hub'
                ? 'Edit Course Hub'
                : activeTab === 'browse'
                ? `Browse Course Hubs (${courseHubs.length})`
                : 'Add Course Hub'}
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

        <div className="p-4 sm:p-6 flex-1 min-h-0 overflow-y-auto">
          {(activeTab === 'create_hub' || activeTab === 'edit_hub') && (
            <form
              onSubmit={
                activeTab === 'edit_hub'
                  ? handleUpdateCourseHub
                  : handleCreateCourseHub
              }
              className="space-y-4"
            >
              {activeTab === 'create_hub' && (
                <div className="p-3 bg-ustp-cream border border-amber-200/80 rounded-md text-xs text-ustp-text space-y-1">
                  <p className="font-extrabold text-ustp-navy flex items-center gap-1.5">
                    <BookOpen className="w-3.5 h-3.5 text-ustp-orange" />
                    <span>What comes built-in with every Course Hub:</span>
                  </p>
                  <p className="text-slate-600 leading-relaxed">
                    Every new Course Hub automatically includes{' '}
                    <span className="font-bold text-ustp-navy">
                      Noticeboard Feed
                    </span>{' '}
                    and{' '}
                    <span className="font-bold text-ustp-navy">
                      Isolated Q&amp;A Threads
                    </span>
                    . You can add custom chat channels inside the Course Hub
                    anytime using <span className="font-bold">Add Channel</span>.
                  </p>
                </div>
              )}

              {activeTab === 'edit_hub' && editingHub && (
                <div className="p-3 bg-ustp-cream border border-amber-200/80 rounded-md text-xs text-ustp-text flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5 font-extrabold text-ustp-navy">
                    <ShieldCheck className="w-4 h-4 text-ustp-orange shrink-0" />
                    <span>
                      Course Admin Role:{' '}
                      {user.role === 'faculty' || user.role === 'dept_head'
                        ? 'Faculty Course Admin'
                        : 'Course Hub Creator (Course Admin)'}
                    </span>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-ustp-navy text-ustp-gold font-mono font-bold text-[10px]">
                    COURSE ADMIN
                  </span>
                </div>
              )}

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
                    className="w-full px-3 py-2 text-xs font-mono bg-white text-ustp-text border border-slate-300 rounded focus:outline-none focus:border-ustp-navy"
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
                    placeholder="e.g., Capstone 1 or Information Assurance"
                    className="w-full px-3 py-2 text-xs bg-white text-ustp-text border border-slate-300 rounded focus:outline-none focus:border-ustp-navy"
                  />
                  {nameError && (
                    <p className="text-xs font-semibold text-red-600 mt-1">
                      {nameError}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="new-hub-dept"
                    className="block text-xs font-bold text-ustp-text mb-1"
                  >
                    College / Department Scope
                  </label>
                  <select
                    id="new-hub-dept"
                    value={scopeDepartment}
                    onChange={(e) => setScopeDepartment(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-semibold border border-slate-300 rounded bg-white text-ustp-text"
                  >
                    <option value="CITC">CITC — Information Tech &amp; Computing</option>
                    <option value="CEA">CEA — Engineering &amp; Architecture</option>
                    <option value="COT">COT — College of Technology</option>
                    <option value="CSM">CSM — Science &amp; Mathematics</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="new-hub-section"
                    className="block text-xs font-bold text-ustp-text mb-1"
                  >
                    Target Class Section
                  </label>
                  <input
                    id="new-hub-section"
                    type="text"
                    value={scopeSection}
                    onChange={(e) => setScopeSection(e.target.value)}
                    placeholder="e.g., IT3R2"
                    className="w-full px-3 py-2 text-xs font-mono bg-white text-ustp-text border border-slate-300 rounded focus:outline-none focus:border-ustp-navy"
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
                  placeholder="Describe the course hub scope, consultation schedule, and Q&A guidelines..."
                  className="w-full px-3 py-2 text-xs bg-white text-ustp-text border border-slate-300 rounded focus:outline-none focus:border-ustp-navy"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200">
                <div>
                  {activeTab === 'edit_hub' &&
                    editingHub &&
                    canAdminEditCurrentHub && (
                      <>
                        {confirmDeleteHubId === editingHub.id ? (
                          <div className="inline-flex items-center gap-2 bg-red-50 border border-red-200 rounded px-3 py-1.5">
                            <span className="text-[11px] font-bold text-red-800">
                              Delete {formatCourseHubName(editingHub)}?
                            </span>
                            <button
                              type="button"
                              disabled={isDeletingId === editingHub.id}
                              onClick={() => handleDeleteHub(editingHub)}
                              className="px-2.5 py-1 rounded bg-red-600 hover:bg-red-700 text-white text-[11px] font-extrabold disabled:opacity-50 cursor-pointer"
                            >
                              {isDeletingId === editingHub.id
                                ? 'Deleting...'
                                : 'Confirm Delete'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteHubId(null)}
                              className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteHubId(editingHub.id)}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-extrabold border border-red-300 bg-red-50 text-red-700 hover:bg-red-100 rounded cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Delete Course Hub</span>
                          </button>
                        )}
                      </>
                    )}
                </div>

                <div className="flex items-center gap-2 ml-auto">
                  <button
                    type="button"
                    onClick={() => setIsChannelModalOpen(false)}
                    className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={
                      isSubmitting ||
                      (activeTab === 'edit_hub' && !canAdminEditCurrentHub)
                    }
                    className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-extrabold bg-ustp-navy text-ustp-gold rounded hover:opacity-95 disabled:opacity-50 cursor-pointer"
                  >
                    {activeTab === 'edit_hub' ? (
                      <>
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>
                          {isSubmitting ? 'Saving Changes...' : 'Save Changes'}
                        </span>
                      </>
                    ) : (
                      <>
                        <Plus className="w-3.5 h-3.5" />
                        <span>
                          {isSubmitting
                            ? 'Creating Course Hub...'
                            : 'Create Course Hub'}
                        </span>
                      </>
                    )}
                  </button>
                </div>
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
                    className="w-full pl-7 pr-3 py-2 text-xs font-mono bg-white text-ustp-text border border-slate-300 rounded focus:outline-none focus:border-ustp-navy"
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
                  className="w-full px-3 py-2 text-xs bg-white text-ustp-text border border-slate-300 rounded focus:outline-none focus:border-ustp-navy"
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
              {/* Search Course Hubs Bar */}
              <div className="pb-1">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="search"
                    value={browseSearch}
                    onChange={(e) => setBrowseSearch(e.target.value)}
                    placeholder="Search Course Hubs by code, name, section, or college..."
                    className="w-full pl-8 pr-3 py-2 text-xs bg-white text-ustp-text border border-slate-300 rounded focus:outline-none focus:border-ustp-navy"
                  />
                </div>
              </div>

              {filteredBrowseHubs.length === 0 ? (
                <div className="py-8 text-center border border-dashed border-slate-300 rounded-lg bg-slate-50">
                  <p className="text-xs font-bold text-ustp-navy">
                    No Course Hubs Found
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Create a new Course Hub to start collaborating with your class.
                  </p>
                </div>
              ) : (
                filteredBrowseHubs.map((hub) => {
                  const enrolledCount =
                    hub.members_count !== undefined
                      ? hub.members_count
                      : hub.roster !== undefined
                      ? hub.roster.length
                      : 0;
                  const hubSubChannels = getSubChannelsForHub(channels, hub.id);
                  const isJoined = isUserEnrolledInCourseHub(hub, user);
                  const isPending = isUserPendingInCourseHub(hub, user);
                  const isHubCourseAdmin = isUserCourseAdmin(hub, user);

                  return (
                    <div
                      key={hub.id}
                      className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/60 space-y-2.5"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-extrabold text-ustp-navy">
                              {formatCourseHubName(hub)}
                            </span>
                            <span className="text-xs font-semibold text-slate-600">
                              · {hub.scope_section || 'IT3R2'} ·{' '}
                              {hub.scope_department || 'CITC'}
                            </span>
                            {isJoined && (
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Joined</span>
                              </span>
                            )}
                            {isPending && !isJoined && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 text-[10px] font-extrabold">
                                <Clock className="w-3 h-3" />
                                <span>Pending Approval</span>
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-600 mt-0.5">
                            {getCleanChannelDescription(hub.description)}
                          </p>
                          <p className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums">
                            {enrolledCount}{' '}
                            {enrolledCount === 1 ? 'member' : 'members'} ·{' '}
                            {hub.unread_count || 0} open{' '}
                            {hub.unread_count === 1 ? 'inquiry' : 'inquiries'} ·{' '}
                            {hub.chat_messages_count || 0}{' '}
                            {hub.chat_messages_count === 1 ? 'chat' : 'chats'}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                          {isJoined ? (
                            <button
                              type="button"
                              onClick={() => {
                                setIsChannelModalOpen(false);
                                router.push(`/channels/${hub.id}`);
                              }}
                              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-extrabold bg-ustp-navy text-ustp-gold rounded hover:opacity-95 cursor-pointer"
                            >
                              <span>Open Hub</span>
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                          ) : isPending ? (
                            <button
                              type="button"
                              disabled={joiningHubId === hub.id}
                              onClick={() => handleCancelJoinRequest(hub.id)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 rounded disabled:opacity-50 cursor-pointer"
                            >
                              <Clock className="w-3.5 h-3.5" />
                              <span>
                                {joiningHubId === hub.id
                                  ? 'Updating...'
                                  : 'Pending Approval (Cancel)'}
                              </span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={joiningHubId === hub.id}
                              onClick={() => handleJoinChannel(hub.id, true)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-extrabold bg-ustp-gold text-ustp-navy rounded hover:opacity-95 disabled:opacity-50 cursor-pointer"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span>
                                {joiningHubId === hub.id
                                  ? 'Submitting...'
                                  : isHubCourseAdmin
                                  ? 'Join Course Hub'
                                  : 'Request to Join'}
                              </span>
                            </button>
                          )}

                          {isHubCourseAdmin && (
                            <button
                              type="button"
                              onClick={() => {
                                populateEditFields(hub);
                                setConfirmDeleteHubId(null);
                                setActiveTab('edit_hub');
                              }}
                              title={`Edit ${formatCourseHubName(hub)}`}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold border border-slate-300 bg-white text-slate-700 hover:text-ustp-navy hover:border-ustp-navy rounded cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              <span>Edit</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Built-in + Custom Channels Preview */}
                      <div className="pt-2 border-t border-slate-200/80 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                          <span className="font-bold text-ustp-navy">
                            Noticeboard Feed
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-bold text-ustp-navy">
                            Isolated Q&amp;A Threads
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono font-bold text-ustp-navy">
                            # general
                          </span>
                          {hubSubChannels.map((sub) => (
                            <React.Fragment key={sub.id}>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono font-bold text-ustp-navy">
                                {formatSubChannelDisplayName(sub)}
                              </span>
                            </React.Fragment>
                          ))}
                        </div>
                        {isJoined && (
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
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
