'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Edit3,
  Lock,
  Plus,
  Search,
  Star,
  Trash2,
  Users,
} from 'lucide-react';
import { AppShell } from '@/src/components/layout/AppShell';
import {
  AnnouncementCard,
  formatShortTime,
} from '@/src/components/announcements/AnnouncementCard';
import {
  type CourseHubTab,
  MessengerChatBox,
} from '@/src/components/threads/MessengerChatBox';
import {
  EmptyState,
  ErrorBanner,
  SkeletonCards,
} from '@/src/components/ui/StateViews';
import { useClarify } from '@/src/context/ClarifyContext';
import {
  convertThreadToFaqApi,
  createThreadApi,
  deleteThreadApi,
  getAnnouncementsApi,
  getChannelThreadsApi,
  replyToThreadApi,
  updateThreadApi,
} from '@/src/lib/api-client';
import {
  canPublishOrManageAnnouncements,
  canResolveOrPinThreads,
  canStudentModifyOwnInquiry,
  getFieldValidationError,
  isThreadVisibleToUser,
} from '@/src/lib/domain-logic';
import type {
  Announcement,
  LaravelValidationError,
  QaThread,
} from '@/src/types/api';

export default function CourseHubPage() {
  const params = useParams<{ channelId: string }>();
  const channelId = Number(params?.channelId || 7);

  const {
    user,
    channels,
    announcementVersion,
    openAnnouncementModal,
    setIsChannelModalOpen,
    showToast,
  } = useClarify();

  const activeChannel =
    channels.find((c) => c.id === channelId) || channels[0];

  const [channelSearch, setChannelSearch] = useState('');
  const [activeTab, setActiveTab] = useState<CourseHubTab>('messenger');

  // Data states
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [threads, setThreads] = useState<QaThread[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Student Send an Inquiry form state (Wireframe Page 4)
  const [inquirySubject, setInquirySubject] = useState('');
  const [inquiryContent, setInquiryContent] = useState('');
  const [inquiryPrivate, setInquiryPrivate] = useState(false);
  const [inquiryErrors, setInquiryErrors] = useState<Record<string, string[]>>({});
  const [isSubmittingInquiry, setIsSubmittingInquiry] = useState(false);

  // Student Edit Own Unresolved Inquiry state (Workflow 3 Activity Diagram)
  const [editingThreadId, setEditingThreadId] = useState<number | null>(null);
  const [editingThreadContent, setEditingThreadContent] = useState('');

  // Faculty Answer Ticket state (Wireframe Page 8)
  const [answeringThread, setAnsweringThread] = useState<QaThread | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const [markResolved, setMarkResolved] = useState(true);
  const [pinTicketToFaq, setPinTicketToFaq] = useState(true);
  const [replyErrors, setReplyErrors] = useState<Record<string, string[]>>({});
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);

  // Class FAQs Accordion open state
  const [openFaqIds, setOpenFaqIds] = useState<number[]>([201, 202, 204]);

  const loadHubData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [annRes, threadRes] = await Promise.all([
        getAnnouncementsApi({ channel_id: channelId, per_page: 20 }),
        getChannelThreadsApi(channelId),
      ]);
      setAnnouncements(annRes.data);
      setThreads(threadRes.data);
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      setError(
        apiErr.message || 'Failed to load Course Hub workspace data.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [channelId]);

  useEffect(() => {
    loadHubData();
  }, [loadHubData, announcementVersion]);

  const canPublish = canPublishOrManageAnnouncements(user.role);
  const canResolve = canResolveOrPinThreads(user.role);
  const isStudent = user.role === 'student';

  const filteredChannels = channels.filter((c) =>
    `${c.name} ${c.course_code || ''}`
      .toLowerCase()
      .includes(channelSearch.trim().toLowerCase())
  );

  const visibleThreads = threads.filter((t) => isThreadVisibleToUser(t, user));
  const publishedFaqs = threads.filter((t) => t.is_pinned_faq);

  const toggleFaqAccordion = (id: number) => {
    setOpenFaqIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  // Student Submit Inquiry handler (Wireframe Page 4)
  const handleSendInquiry = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingInquiry(true);
    setInquiryErrors({});
    try {
      const res = await createThreadApi(channelId, {
        subject_hashtag: inquirySubject,
        content: inquiryContent,
        is_private: inquiryPrivate,
      });
      showToast(res.message || 'Inquiry submitted.', 'success');
      setInquirySubject('');
      setInquiryContent('');
      setInquiryPrivate(false);
      await loadHubData();
      setActiveTab('threads');
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      if (apiErr.status === 422 && apiErr.errors) {
        setInquiryErrors(apiErr.errors);
      } else {
        showToast(apiErr.message || 'Failed to submit inquiry.', 'error');
      }
    } finally {
      setIsSubmittingInquiry(false);
    }
  };

  // Student Update/Delete Own Inquiry handlers
  const handleSaveEditedInquiry = async (threadId: number) => {
    try {
      const res = await updateThreadApi(threadId, {
        content: editingThreadContent,
      });
      showToast(res.message || 'Inquiry updated.', 'success');
      setEditingThreadId(null);
      await loadHubData();
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      showToast(apiErr.message || 'Could not update inquiry.', 'error');
    }
  };

  const handleDeleteInquiry = async (threadId: number) => {
    try {
      const res = await deleteThreadApi(threadId);
      showToast(res.message || 'Inquiry deleted.', 'info');
      await loadHubData();
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      showToast(apiErr.message || 'Could not delete inquiry.', 'error');
    }
  };

  // Faculty Submit Answer Ticket handler (Wireframe Page 8)
  const handleAnswerTicketSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!answeringThread) return;
    setIsSubmittingReply(true);
    setReplyErrors({});
    try {
      const res = await replyToThreadApi(answeringThread.id, {
        content: replyContent,
        mark_resolved: markResolved,
        pin_to_faq: pinTicketToFaq,
      });
      showToast(res.message || 'Ticket answered.', 'success');
      if (pinTicketToFaq && !openFaqIds.includes(answeringThread.id)) {
        setOpenFaqIds((prev) => [answeringThread.id, ...prev]);
      }
      setAnsweringThread(null);
      setReplyContent('');
      await loadHubData();
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      if (apiErr.status === 422 && apiErr.errors) {
        setReplyErrors(apiErr.errors);
      } else {
        showToast(apiErr.message || 'Failed to post reply.', 'error');
      }
    } finally {
      setIsSubmittingReply(false);
    }
  };

  // Faculty 1-Click Convert to Class FAQ
  const handleOneClickConvertFaq = async (threadId: number) => {
    try {
      const res = await convertThreadToFaqApi(threadId);
      showToast(res.message || 'Converted to anonymized Class FAQ.', 'success');
      if (!openFaqIds.includes(threadId)) {
        setOpenFaqIds((prev) => [threadId, ...prev]);
      }
      await loadHubData();
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      showToast(apiErr.message || 'Failed to pin FAQ.', 'error');
    }
  };

  const subjectError = getFieldValidationError(inquiryErrors, 'subject_hashtag');
  const contentError = getFieldValidationError(inquiryErrors, 'content');
  const replyContentError = getFieldValidationError(replyErrors, 'content');

  const hubHeaderTitle = activeChannel
    ? `${activeChannel.scope_section || 'IT3R2'} — ${activeChannel.name.replace(
        /^#\s*/,
        ''
      )} Hub`
    : 'IT3R2 — Software Engineering Hub';

  return (
    <AppShell title={hubHeaderTitle}>
      <div className="flex-1 flex flex-col lg:flex-row lg:items-start min-h-[calc(100vh-3.5rem)]">
        {/* LEFT COLUMN: ustp-navy (#1a1851) Scoped Channels Sidebar matching Oct 22 MVP & Wireframes */}
        <aside
          aria-label="Scoped Channels Sidebar"
          className="w-full lg:w-60 lg:sticky lg:top-14 lg:h-[calc(100vh-3.5rem)] lg:overflow-y-auto lg:self-start bg-ustp-navy text-white border-r border-slate-800 shrink-0 flex flex-col justify-between p-3.5"
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-xs font-extrabold uppercase tracking-wider text-ustp-gold">
                SCOPED CHANNELS
              </h2>
              <button
                type="button"
                onClick={() => setIsChannelModalOpen(true)}
                aria-label="Open Channel Roster and Management"
                className="text-[11px] font-bold text-slate-300 hover:text-ustp-gold flex items-center gap-1 cursor-pointer"
              >
                <Users className="w-3.5 h-3.5" />
                <span>Roster</span>
              </button>
            </div>

            {/* Channel Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
              <input
                type="search"
                value={channelSearch}
                onChange={(e) => setChannelSearch(e.target.value)}
                placeholder="Search channels..."
                aria-label="Filter scoped channels"
                className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-white/10 text-white placeholder:text-slate-400 rounded border border-white/15 focus:outline-none focus:border-ustp-gold"
              />
            </div>

            {canPublish && (
              <button
                type="button"
                onClick={() => setIsChannelModalOpen(true)}
                className="w-full flex items-center justify-between px-3 py-1.5 text-xs font-bold bg-white/10 hover:bg-white/15 text-ustp-gold rounded border border-ustp-gold/40 cursor-pointer"
              >
                <span>Add Channel</span>
                <Plus className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Scoped Channel List matching Oct 22 MVP (# IT314 SoftEng, # IT311 InfoAssurance, etc.) */}
            <nav aria-label="Course Hub Channels" className="space-y-1 pt-1">
              {filteredChannels.map((ch) => {
                const isActive = ch.id === activeChannel?.id;
                return (
                  <Link
                    key={ch.id}
                    href={`/channels/${ch.id}`}
                    className={`flex items-center justify-between px-3 py-2.5 rounded-md text-xs font-bold transition-colors ${
                      isActive
                        ? 'bg-white/15 text-white border-l-4 border-ustp-gold'
                        : 'text-slate-300 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <span className="truncate">{ch.name}</span>
                    {ch.unread_count !== undefined && ch.unread_count > 0 && (
                      <span className="ml-2 px-1.5 py-0.5 text-[10px] font-mono font-extrabold bg-ustp-orange text-ustp-navy rounded-full tabular-nums">
                        {ch.unread_count}
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Bottom Channel Scope Metadata */}
          <div className="pt-4 mt-4 border-t border-white/10 text-[11px] text-slate-300 space-y-1">
            <p className="font-bold text-ustp-gold">
              {activeChannel?.scope_college || 'CITC'} •{' '}
              {activeChannel?.scope_section || 'IT3R2'}
            </p>
            <p className="font-mono tabular-nums text-slate-400">
              Enrolled Roster: {activeChannel?.members_count || 42} students
            </p>
          </div>
        </aside>

        {/* CENTER COLUMN: Full-Height Messenger Chat Box & Course Hub Workspace */}
        <div className="flex-1 min-w-0 flex flex-col lg:h-[calc(100vh-3.5rem)] overflow-hidden bg-white">
          <MessengerChatBox
            channel={activeChannel}
            threadsCount={visibleThreads.length}
            currentUser={user}
            activeTab={activeTab}
            onTabChange={(tab) => setActiveTab(tab)}
            isStudent={isStudent}
            onOpenCreateAnnouncement={() =>
              openAnnouncementModal({ defaultChannelId: channelId })
            }
            onMessageSentToast={(msg) => showToast(msg, 'success')}
            childrenWhenNotMessenger={
              isLoading ? (
                <SkeletonCards count={2} />
              ) : error ? (
                <ErrorBanner message={error} onRetry={loadHubData} />
              ) : activeTab === 'send_inquiry' ? (
                /* STUDENT "SEND AN INQUIRY / CREATE TICKET" VIEW (Wireframe Page 4) */
                <section
                  aria-labelledby="send-inquiry-heading"
                  className="bg-white border border-slate-200 rounded-lg p-6 max-w-2xl space-y-4 mx-auto"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3
                        id="send-inquiry-heading"
                        className="text-xl font-extrabold text-ustp-text"
                      >
                        Send an Inquiry
                      </h3>
                      <p className="text-xs font-semibold text-slate-500 mt-0.5">
                        Any Questions or clarifications? (Scoped to{' '}
                        {activeChannel?.name})
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab('threads')}
                      className="text-xs font-bold text-slate-600 hover:text-ustp-navy cursor-pointer"
                    >
                      &larr; Back to Isolated Q&amp;A Threads
                    </button>
                  </div>

                  <form
                    onSubmit={handleSendInquiry}
                    className="space-y-4"
                    noValidate
                  >
                    <div>
                      <label htmlFor="inquiry-subject-input" className="sr-only">
                        Subject Hashtag or Title
                      </label>
                      <input
                        id="inquiry-subject-input"
                        type="text"
                        value={inquirySubject}
                        onChange={(e) => setInquirySubject(e.target.value)}
                        placeholder="Title here.... (e.g., #Midterm_Rubric or #Defence)"
                        className="w-full px-3.5 py-2.5 text-sm font-semibold text-ustp-text border border-slate-300 rounded focus:outline-none focus:border-ustp-navy"
                      />
                      {subjectError && (
                        <p
                          className="text-xs font-semibold text-red-600 mt-1"
                          role="alert"
                        >
                          {subjectError}
                        </p>
                      )}
                    </div>

                    <div>
                      <label
                        htmlFor="inquiry-content-textarea"
                        className="sr-only"
                      >
                        Inquiry Question Content
                      </label>
                      <textarea
                        id="inquiry-content-textarea"
                        rows={6}
                        value={inquiryContent}
                        onChange={(e) => setInquiryContent(e.target.value)}
                        placeholder="Type here..."
                        className="w-full px-3.5 py-2.5 text-sm text-ustp-text border border-slate-300 rounded focus:outline-none focus:border-ustp-navy leading-relaxed"
                      />
                      {contentError && (
                        <p
                          className="text-xs font-semibold text-red-600 mt-1"
                          role="alert"
                        >
                          {contentError}
                        </p>
                      )}
                    </div>

                    {/* Private Inquiry Toggle (Stakeholder Table E) */}
                    <label className="flex items-center gap-2 text-xs font-semibold text-ustp-text cursor-pointer">
                      <input
                        type="checkbox"
                        checked={inquiryPrivate}
                        onChange={(e) => setInquiryPrivate(e.target.checked)}
                        className="accent-ustp-navy"
                      />
                      <Lock className="w-3.5 h-3.5 text-slate-600" />
                      <span>
                        Make Inquiry Private (Visible only to Instructor — Table E)
                      </span>
                    </label>

                    <div className="flex justify-end pt-2">
                      <button
                        type="submit"
                        disabled={isSubmittingInquiry}
                        className="px-6 py-2 bg-ustp-navy text-white text-xs font-extrabold rounded hover:opacity-95 disabled:opacity-50 cursor-pointer"
                      >
                        {isSubmittingInquiry ? 'Submitting...' : 'Submit'}
                      </button>
                    </div>
                  </form>
                </section>
              ) : activeTab === 'feed' ? (
                /* SEPARATE TAB: NOTICEBOARD FEED */
                announcements.length === 0 ? (
                  <EmptyState
                    title={`No Announcements in ${
                      activeChannel?.name || 'Course Hub'
                    }`}
                    description="Official course memos and room reassignments will appear here chronologically with urgent notices pinned on top."
                    actionLabel={
                      canPublish ? '+ Create First Announcement' : undefined
                    }
                    onAction={
                      canPublish
                        ? () =>
                            openAnnouncementModal({ defaultChannelId: channelId })
                        : undefined
                    }
                  />
                ) : (
                  <div className="space-y-4">
                    {announcements.map((ann) => (
                      <AnnouncementCard
                        key={ann.id}
                        announcement={ann}
                        variant="feed"
                        onUpdated={loadHubData}
                      />
                    ))}
                  </div>
                )
              ) : visibleThreads.length === 0 ? (
                /* SEPARATE TAB: ISOLATED Q&A THREADS (EMPTY STATE) */
                <EmptyState
                  title="No Academic Inquiries Submitted Yet"
                  description="Students can submit structured questions or clarifications without cluttering the official noticeboard."
                  actionLabel={isStudent ? '+ Ask in Q&A Thread' : undefined}
                  onAction={
                    isStudent ? () => setActiveTab('send_inquiry') : undefined
                  }
                />
              ) : (
                /* SEPARATE TAB: ISOLATED Q&A THREADS (STRUCTURED TICKET CARDS) */
                <div className="space-y-4">
                  {visibleThreads.map((thread) => {
                    const canStudentEdit = canStudentModifyOwnInquiry(
                      user,
                      thread
                    );
                    const authorLabel = thread.is_pinned_faq
                      ? 'Anonymous Student'
                      : thread.author.name;
                    const threadTime = formatShortTime(thread.created_at);

                    return (
                      <article
                        key={thread.id}
                        className="bg-white border border-slate-200 rounded-lg p-5 space-y-3"
                      >
                        {/* Top Row: Subject Hashtag in bold navy + right-aligned RESOLVED / Private badges */}
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="text-base font-extrabold text-ustp-navy tracking-tight">
                                {thread.subject_hashtag}
                              </h3>
                              {thread.is_private && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-300">
                                  <Lock className="w-3 h-3" />
                                  Private Inquiry
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-500 mt-0.5 font-medium tabular-nums">
                              From: {authorLabel} • {threadTime}
                            </p>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {thread.is_resolved ? (
                              <span className="px-2.5 py-0.5 rounded text-[11px] font-extrabold bg-amber-100 text-amber-900 border border-amber-300">
                                RESOLVED
                              </span>
                            ) : (
                              <span className="px-2.5 py-0.5 rounded text-[11px] font-bold bg-sky-100 text-sky-900 border border-sky-300">
                                OPEN TICKET
                              </span>
                            )}

                            {/* Student Edit/Delete Own Unresolved Inquiry (Workflow 3 Activity Diagram) */}
                            {canStudentEdit && (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingThreadId(thread.id);
                                    setEditingThreadContent(thread.content);
                                  }}
                                  aria-label={`Edit inquiry ${thread.subject_hashtag}`}
                                  className="p-1 text-slate-500 hover:text-ustp-navy rounded cursor-pointer"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteInquiry(thread.id)}
                                  aria-label={`Delete inquiry ${thread.subject_hashtag}`}
                                  className="p-1 text-slate-500 hover:text-red-700 rounded cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Student Inquiry Body or Inline Edit Box */}
                        {editingThreadId === thread.id ? (
                          <div className="space-y-2">
                            <textarea
                              rows={3}
                              value={editingThreadContent}
                              onChange={(e) =>
                                setEditingThreadContent(e.target.value)
                              }
                              className="w-full p-2.5 text-sm border border-slate-300 rounded"
                            />
                            <div className="flex gap-2 justify-end">
                              <button
                                type="button"
                                onClick={() => setEditingThreadId(null)}
                                className="px-3 py-1 text-xs font-semibold text-slate-600 cursor-pointer"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSaveEditedInquiry(thread.id)}
                                className="px-3 py-1 text-xs font-bold bg-ustp-navy text-white rounded cursor-pointer"
                              >
                                Save Inquiry
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-ustp-text leading-relaxed max-w-[70ch]">
                            {thread.content}
                          </p>
                        )}

                        {/* Nested Faculty Reply Block matching Oct 22 MVP Screenshot */}
                        {thread.replies.length > 0 && (
                          <div className="pl-4 py-2 bg-amber-50/60 border border-amber-200 rounded-md space-y-1">
                            {thread.replies.map((reply) => (
                              <div key={reply.id}>
                                <p className="text-xs sm:text-sm text-ustp-text">
                                  <span className="font-extrabold text-ustp-navy">
                                    {reply.author.role === 'student'
                                      ? `Student Reply (${reply.author.name}): `
                                      : `Faculty Reply (${reply.author.name}): `}
                                  </span>
                                  {reply.content}
                                </p>
                              </div>
                            ))}
                            {thread.is_pinned_faq && (
                              <p className="text-[11px] font-bold text-amber-700 flex items-center gap-1 pt-0.5">
                                <Star className="w-3 h-3 fill-ustp-gold text-ustp-gold" />
                                <span>
                                  Pinned to Class FAQs (Student Identity Masked)
                                </span>
                              </p>
                            )}
                          </div>
                        )}

                        {/* Faculty Answer / Pin Controls (Wireframe Page 8 & Oct 22 MVP) */}
                        {canResolve && (
                          <div className="pt-2 border-t border-slate-100 flex items-center justify-end gap-2">
                            {!thread.is_pinned_faq && (
                              <button
                                type="button"
                                onClick={() =>
                                  handleOneClickConvertFaq(thread.id)
                                }
                                className="px-3 py-1.5 text-xs font-bold bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 rounded cursor-pointer"
                              >
                                ★ Pin to Class FAQs
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setAnsweringThread(thread);
                                setReplyContent('');
                                setMarkResolved(true);
                                setPinTicketToFaq(true);
                                setReplyErrors({});
                              }}
                              className="px-4 py-1.5 text-xs font-extrabold bg-ustp-navy text-white rounded hover:opacity-95 cursor-pointer"
                            >
                              Answer
                            </button>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )
            }
          />
        </div>

        {/* INNER-RIGHT PANEL: Class FAQs — 1-Click Converted Accordion OR Faculty "Answer Ticket" Panel (Wireframes Pages 7 & 8 + Oct 22 MVP) */}
        <aside
          aria-label="Class FAQs and Answer Ticket Panel"
          className="w-full lg:w-72 xl:w-80 lg:sticky lg:top-14 lg:h-[calc(100vh-3.5rem)] lg:overflow-y-auto lg:self-start bg-white border-t lg:border-t-0 lg:border-l border-slate-200 shrink-0 p-4 space-y-4"
        >
          {answeringThread && canResolve ? (
            /* FACULTY "ANSWER TICKET" PANEL matching Wireframe Page 8 */
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
                <button
                  type="button"
                  onClick={() => setAnsweringThread(null)}
                  className="inline-flex items-center gap-1 text-sm font-extrabold text-ustp-navy hover:underline cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>{answeringThread.subject_hashtag}</span>
                </button>
                <span className="text-[11px] font-bold text-slate-500">
                  Answer Ticket
                </span>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded text-xs space-y-1">
                <p className="font-bold text-slate-500">
                  {answeringThread.is_pinned_faq
                    ? 'Anonymous Student'
                    : answeringThread.author.name}
                </p>
                <p className="text-ustp-text leading-relaxed">
                  {answeringThread.content}
                </p>
              </div>

              <form onSubmit={handleAnswerTicketSubmit} className="space-y-3">
                <div>
                  <label htmlFor="faculty-reply-textarea" className="sr-only">
                    Faculty Reply
                  </label>
                  <textarea
                    id="faculty-reply-textarea"
                    rows={5}
                    value={replyContent}
                    onChange={(e) => setReplyContent(e.target.value)}
                    placeholder="Type here..."
                    className="w-full p-3 text-xs sm:text-sm border border-slate-300 rounded focus:outline-none focus:border-ustp-navy"
                  />
                  {replyContentError && (
                    <p
                      className="text-xs font-semibold text-red-600 mt-1"
                      role="alert"
                    >
                      {replyContentError}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-xs font-bold text-ustp-text cursor-pointer">
                    <input
                      type="checkbox"
                      checked={markResolved}
                      onChange={(e) => setMarkResolved(e.target.checked)}
                      className="accent-ustp-navy"
                    />
                    <span>Mark as Resolved (TC-FR03)</span>
                  </label>

                  <label className="flex items-center gap-2 text-xs font-bold text-ustp-text cursor-pointer">
                    <input
                      type="checkbox"
                      checked={pinTicketToFaq}
                      onChange={(e) => setPinTicketToFaq(e.target.checked)}
                      className="accent-ustp-navy"
                    />
                    <span>Pin Ticket (1-Click Anonymized FAQ — FR-07)</span>
                  </label>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setAnsweringThread(null)}
                    className="px-3 py-1.5 text-xs font-semibold text-slate-600 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingReply}
                    className="px-5 py-1.5 bg-ustp-navy text-white text-xs font-extrabold rounded hover:opacity-95 cursor-pointer"
                  >
                    {isSubmittingReply ? 'Saving...' : 'Submit'}
                  </button>
                </div>
              </form>
            </div>
          ) : (
            /* CLASS FAQS — 1-CLICK CONVERTED ACCORDION matching Oct 22 MVP & Wireframe Page 7 */
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
                <h2 className="text-sm font-extrabold text-ustp-text">
                  Class FAQs
                </h2>
                <span className="text-[11px] font-semibold text-slate-500">
                  1-Click Converted
                </span>
              </div>

              {publishedFaqs.length === 0 ? (
                <p className="text-xs text-slate-500 py-4 text-center">
                  No Class FAQs published for {activeChannel?.name} yet.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {publishedFaqs.map((faq) => {
                    const isExpanded = openFaqIds.includes(faq.id);
                    const latestReply =
                      faq.replies[faq.replies.length - 1]?.content ||
                      'Resolved during consultation.';

                    return (
                      <div
                        key={faq.id}
                        className="border border-slate-200 rounded-md overflow-hidden bg-slate-50/60"
                      >
                        <button
                          type="button"
                          onClick={() => toggleFaqAccordion(faq.id)}
                          aria-expanded={isExpanded}
                          className="w-full px-3 py-2.5 flex items-center justify-between text-left bg-white hover:bg-slate-50 transition-colors cursor-pointer"
                        >
                          <span className="text-xs font-extrabold text-ustp-navy truncate">
                            {faq.subject_hashtag}
                          </span>
                          {isExpanded ? (
                            <ChevronUp className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          )}
                        </button>

                        {isExpanded && (
                          <div className="px-3 pb-3 pt-1.5 text-xs space-y-2 border-t border-slate-100">
                            <p className="text-[11px] font-semibold text-slate-500">
                              Asked by: Anonymous Student
                            </p>
                            <p className="text-slate-700 leading-relaxed">
                              {faq.content}
                            </p>
                            <div className="pt-1.5 border-t border-slate-200/80 text-ustp-text font-medium leading-relaxed">
                              {latestReply}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
    </AppShell>
  );
}
