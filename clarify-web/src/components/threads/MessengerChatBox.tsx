'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  FileText,
  Image as ImageIcon,
  MessageCircle,
  MessageSquarePlus,
  Mic,
  Plus,
  Settings,
  X,
} from 'lucide-react';
import { formatShortTime } from '../announcements/AnnouncementCard';
import { useClarify } from '../../context/ClarifyContext';
import {
  getChannelChatMessagesApi,
  sendChannelChatMessageApi,
} from '../../lib/api-client';
import {
  type ReverbBroadcastPayload,
  subscribeChannelReverb,
} from '../../lib/reverb-client';
import type { Channel, ChatMessage, RealtimeEvent, User } from '../../types/api';

export type CourseHubTab = 'messenger' | 'feed' | 'threads' | 'send_inquiry';

interface MessengerChatBoxProps {
  channel: Channel | undefined;
  threadsCount: number;
  currentUser: User;
  activeTab: CourseHubTab;
  onTabChange: (tab: CourseHubTab) => void;
  isStudent: boolean;
  onOpenCreateAnnouncement: () => void;
  onMessageSentToast?: (message: string) => void;
  childrenWhenNotMessenger?: React.ReactNode;
}

function formatMessengerTimestampDivider(raw: string): string {
  if (!raw) return 'NOV 1, 2026 AT 9:00 AM';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return `NOV 1, 2026 AT ${raw.toUpperCase()}`;
  }
  const datePart = parsed
    .toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
    .toUpperCase();
  const timePart = parsed
    .toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
    .toUpperCase();
  return `${datePart} AT ${timePart}`;
}

function shouldShowTimestampDivider(
  currentMsg: ChatMessage,
  prevMsg: ChatMessage | undefined
): boolean {
  if (!prevMsg) return true;
  const currDate = new Date(currentMsg.created_at);
  const prevDate = new Date(prevMsg.created_at);
  if (Number.isNaN(currDate.getTime()) || Number.isNaN(prevDate.getTime())) {
    return currentMsg.created_at !== prevMsg.created_at;
  }
  const diffMinutes =
    Math.abs(currDate.getTime() - prevDate.getTime()) / (1000 * 60);
  return diffMinutes >= 10;
}

export function MessengerChatBox({
  channel,
  threadsCount,
  currentUser,
  activeTab,
  onTabChange,
  isStudent,
  onOpenCreateAnnouncement,
  onMessageSentToast,
  childrenWhenNotMessenger,
}: MessengerChatBoxProps) {
  const {
    isAuthenticated,
    isAuthReady,
    announcementVersion,
    triggerAnnouncementRefresh,
    subscribeRealtimeEvents,
    showToast,
  } = useClarify();
  const channelKey = channel?.id || 1;
  const [messagesByChannel, setMessagesByChannel] = useState<
    Record<number, ChatMessage[]>
  >({});
  const [messageText, setMessageText] = useState('');
  const [stagedAttachment, setStagedAttachment] = useState<string | null>(null);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamContainerRef = useRef<HTMLDivElement | null>(null);

  const appendMessageIdempotently = useCallback(
    (targetChannelId: number, incomingMessage: ChatMessage) => {
      setMessagesByChannel((prev) => {
        const existing = prev[targetChannelId] || [];
        if (existing.some((m) => String(m.id) === String(incomingMessage.id))) {
          return prev;
        }
        return {
          ...prev,
          [targetChannelId]: [...existing, incomingMessage],
        };
      });
    },
    []
  );

  const loadChatMessages = useCallback(async () => {
    if (!isAuthReady || !isAuthenticated) return;
    try {
      const res = await getChannelChatMessagesApi(channelKey);
      if (Array.isArray(res.data)) {
        setMessagesByChannel((prev) => ({
          ...prev,
          [channelKey]: res.data,
        }));
      }
    } catch {
      // Retain existing messages if offline
    }
  }, [channelKey, isAuthReady, isAuthenticated]);

  useEffect(() => {
    if (!isAuthReady || !isAuthenticated) return;
    void loadChatMessages();
  }, [loadChatMessages, announcementVersion, isAuthReady, isAuthenticated]);

  // Subscribe to Laravel Reverb channel & SSE/BroadcastChannel for instant Live Channel Chat
  useEffect(() => {
    if (!isAuthReady || !isAuthenticated) return;

    const handleRealtimeChatEvent = (
      event: RealtimeEvent | ReverbBroadcastPayload
    ) => {
      if (event.type !== 'chat.message') return;
      if (event.channel_id && Number(event.channel_id) !== Number(channelKey)) {
        return;
      }
      if (event.message && event.message.id !== undefined) {
        appendMessageIdempotently(channelKey, event.message);
      } else {
        void loadChatMessages();
      }
    };

    const unsubscribeReverb = subscribeChannelReverb(
      channelKey,
      handleRealtimeChatEvent
    );
    const unsubscribeStream = subscribeRealtimeEvents(handleRealtimeChatEvent);

    return () => {
      unsubscribeReverb();
      unsubscribeStream();
    };
  }, [
    channelKey,
    isAuthReady,
    isAuthenticated,
    appendMessageIdempotently,
    loadChatMessages,
    subscribeRealtimeEvents,
  ]);

  const conversationMessages = messagesByChannel[channelKey] || [];

  useEffect(() => {
    if (streamContainerRef.current && activeTab === 'messenger') {
      streamContainerRef.current.scrollTop =
        streamContainerRef.current.scrollHeight;
    }
  }, [channelKey, conversationMessages.length, activeTab]);

  const courseHeaderTitle = channel
    ? `${channel.scope_section || 'IT3R2'}-${channel.course_code || 'IT314'} ${channel.name.replace(
        /^#\s*\S+\s*/,
        ''
      )}`
    : 'IT3R2-IT314 Software Engineering';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = messageText.trim();
    if ((!trimmed && !stagedAttachment) || isSending) return;

    const finalContent = stagedAttachment
      ? `${trimmed ? `${trimmed} ` : ''}[Attachment: ${stagedAttachment}]`
      : trimmed;

    setIsSending(true);
    try {
      const res = await sendChannelChatMessageApi(channelKey, finalContent);
      appendMessageIdempotently(channelKey, res.data);
      setMessageText('');
      setStagedAttachment(null);
      triggerAnnouncementRefresh();
      onMessageSentToast?.(
        res.message || 'Message sent to Course Hub chat.'
      );
    } catch (err) {
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message?: string }).message)
          : 'Failed to send message to database.';
      showToast(msg, 'error');
    } finally {
      setIsSending(false);
    }
  };

  const handleVoiceNoteClick = () => {
    setStagedAttachment((prev) =>
      prev === 'Voice_Note_Clarification.m4a (0:14)'
        ? null
        : 'Voice_Note_Clarification.m4a (0:14)'
    );
  };

  const handleFileChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    fallbackLabel: string
  ) => {
    const file = e.target.files?.[0];
    if (file) {
      setStagedAttachment(file.name);
    } else {
      setStagedAttachment(fallbackLabel);
    }
    e.target.value = '';
  };

  return (
    <section
      aria-label="Course Hub Messenger Box"
      className="flex-1 min-h-0 flex flex-col bg-white overflow-hidden"
    >
      {/* Top Gray Header Bar: Row 1 (Course Title + Gear Icon) & Row 2 (Messenger Chat | Noticeboard Feed | Isolated Q&A Threads + Action Button) */}
      <div className="bg-slate-200/90 border-b border-slate-300 px-3 sm:px-5 py-2.5 space-y-2 relative shrink-0">
        {/* Header Row 1: Course Title + Settings Gear Icon */}
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm sm:text-lg font-extrabold text-ustp-text truncate">
            {courseHeaderTitle}
          </h2>

          <button
            type="button"
            onClick={() => setShowSettingsMenu((prev) => !prev)}
            aria-label="Conversation options and settings"
            aria-expanded={showSettingsMenu}
            className="p-2 rounded-full text-ustp-navy hover:bg-slate-300/70 transition-colors shrink-0 cursor-pointer"
          >
            <Settings className="w-5 h-5 stroke-[2.2]" />
          </button>
        </div>

        {/* Header Row 2: 3 Separate Workspace Tabs (Messenger Chat | Noticeboard Feed | Isolated Q&A Threads) + Primary Action Button */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-slate-300/70">
          <div
            className="flex items-center gap-1.5 overflow-x-auto max-w-full pb-0.5 sm:pb-0"
            role="tablist"
            aria-label="Course Hub Workspace Views"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'messenger'}
              onClick={() => onTabChange('messenger')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'messenger'
                  ? 'bg-ustp-navy text-white shadow-2xs'
                  : 'bg-white/85 text-slate-700 hover:bg-white border border-slate-300'
              }`}
            >
              <MessageCircle className="w-3.5 h-3.5 text-ustp-gold" />
              <span>Messenger Chat</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'feed'}
              onClick={() => onTabChange('feed')}
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'feed'
                  ? 'bg-ustp-navy text-white shadow-2xs'
                  : 'bg-white/85 text-slate-700 hover:bg-white border border-slate-300'
              }`}
            >
              Noticeboard Feed
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'threads'}
              onClick={() => onTabChange('threads')}
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'threads'
                  ? 'bg-ustp-navy text-white shadow-2xs'
                  : 'bg-white/85 text-slate-700 hover:bg-white border border-slate-300'
              }`}
            >
              Isolated Q&amp;A Threads ({threadsCount})
            </button>
          </div>

          {isStudent ? (
            <button
              type="button"
              onClick={() => onTabChange('send_inquiry')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-extrabold transition-opacity whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'send_inquiry'
                  ? 'bg-ustp-navy text-ustp-gold ring-2 ring-ustp-gold'
                  : 'bg-ustp-gold text-ustp-navy hover:opacity-95'
              }`}
            >
              <MessageSquarePlus className="w-3.5 h-3.5" />
              <span>+ Ask in Q&amp;A Thread</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onOpenCreateAnnouncement}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-extrabold bg-ustp-navy text-white hover:opacity-95 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 text-ustp-gold" />
              <span>+ Create Announcement</span>
            </button>
          )}
        </div>

        {showSettingsMenu && (
          <div className="absolute right-4 top-12 z-20 bg-white border border-slate-300 rounded-lg shadow-lg p-3 w-64 space-y-2 text-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
              <span className="font-extrabold text-ustp-navy">
                Course Hub Chat Settings
              </span>
              <button
                type="button"
                onClick={() => setShowSettingsMenu(false)}
                aria-label="Close chat settings"
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-[11px] text-slate-600">
              Active User:{' '}
              <span className="font-bold text-ustp-navy uppercase">
                {currentUser.role.replace('_', ' ')} ({currentUser.name})
              </span>
            </p>
            <p className="text-[11px] text-slate-500">
              Channel: <span className="font-semibold">{courseHeaderTitle}</span>
            </p>
          </div>
        )}
      </div>

      {/* When viewing Noticeboard Feed, Isolated Q&A Threads, or Send an Inquiry, render that separate tab content */}
      {activeTab !== 'messenger' ? (
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 lg:p-6 bg-slate-50/70">
          {childrenWhenNotMessenger}
        </div>
      ) : (
        <>
          {/* Center White Full-Height Scrollable Messenger Stream matching Attached Reference UI */}
          <div
            ref={streamContainerRef}
            className="flex-1 min-h-0 px-3 sm:px-6 py-4 sm:py-5 space-y-3.5 overflow-y-auto bg-white"
          >
            {conversationMessages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center py-12 px-4">
                <div className="w-12 h-12 rounded-full bg-ustp-navy/10 text-ustp-navy border border-ustp-gold flex items-center justify-center mb-3">
                  <MessageCircle className="w-6 h-6" />
                </div>
                <p className="text-sm font-bold text-ustp-navy">
                  Start the conversation in {courseHeaderTitle}
                </p>
                <p className="text-xs text-slate-500 mt-1 max-w-xs">
                  Your messages appear in USTP Navy on the right; classmate and faculty replies appear in USTP Cream on the left.
                </p>
              </div>
            ) : (
              conversationMessages.map((msg, index) => {
                const prevMsg =
                  index > 0 ? conversationMessages[index - 1] : undefined;
                const isLastMessage =
                  index === conversationMessages.length - 1;
                const showDivider = shouldShowTimestampDivider(msg, prevMsg);

                const isCurrentUser =
                  Number(msg.author.id) > 0 &&
                  Number(currentUser.id) > 0 &&
                  Number(msg.author.id) === Number(currentUser.id);

                const isFacultySender =
                  msg.author.role === 'faculty' ||
                  msg.author.role === 'dept_head' ||
                  msg.author.role === 'it_admin';

                const roleLabel = isFacultySender ? 'Faculty' : 'Student';
                const displayTime = formatShortTime(msg.created_at);
                const initial = msg.author.name
                  ? msg.author.name
                      .replace(/^(ENGR\.|PROF\.|DR\.)\s*/i, '')
                      .charAt(0)
                      .toUpperCase()
                  : isFacultySender
                  ? 'F'
                  : 'S';

                return (
                  <React.Fragment key={msg.id}>
                    {/* Centered Uppercase Timestamp Divider (e.g., "NOV 1, 2026 AT 5:30 PM") */}
                    {showDivider && (
                      <div className="py-2 text-center select-none">
                        <span className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
                          {formatMessengerTimestampDivider(msg.created_at)}
                        </span>
                      </div>
                    )}

                    {isCurrentUser ? (
                      /* CURRENT USER MESSAGE: Right-aligned USTP Navy Bubble (#1a1851) */
                      <div className="flex flex-col items-end">
                        <div className="flex items-end justify-end gap-2 w-full">
                          <div
                            className="bg-ustp-navy text-white border border-ustp-navy rounded-[20px] rounded-br-xs px-4 py-2.5 text-xs sm:text-sm leading-relaxed shadow-2xs max-w-[82%] sm:max-w-[68%] break-words"
                            title={`Sent by you (${currentUser.name}) at ${displayTime}`}
                          >
                            {msg.content}
                          </div>
                        </div>
                        {isLastMessage && (
                          <div className="mt-1 pr-1 flex items-center gap-1.5 select-none">
                            <span className="text-[10px] font-medium text-slate-400">
                              Sent {displayTime}
                            </span>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* RESPONDENT MESSAGE: Left-aligned USTP Cream Bubble (#FFFAF2) with circular avatar on bottom-left and sender name + role above */
                      <div className="flex items-end justify-between gap-2">
                        <div className="flex items-end gap-2.5 min-w-0 max-w-[85%] sm:max-w-[72%]">
                          {/* Bottom-Left Circular Respondent Avatar */}
                          <div
                            className={`w-8 h-8 sm:w-9 sm:h-9 rounded-full shrink-0 flex items-center justify-center font-extrabold text-xs border shadow-2xs select-none ${
                              isFacultySender
                                ? 'bg-ustp-navy text-ustp-gold border-ustp-gold'
                                : 'bg-amber-100 text-ustp-navy border-ustp-orange'
                            }`}
                            title={`${msg.author.name} (${roleLabel})`}
                          >
                            {initial}
                          </div>

                          {/* Respondent Name + Role Header above USTP Cream Bubble */}
                          <div className="space-y-1 min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 pl-1 flex-wrap">
                              <span className="text-[11px] font-bold text-ustp-navy truncate">
                                {msg.author.name}
                              </span>
                              <span
                                className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                                  isFacultySender
                                    ? 'bg-ustp-navy text-ustp-gold'
                                    : 'bg-ustp-gold/30 text-ustp-navy'
                                }`}
                              >
                                {roleLabel}
                              </span>
                              <span className="text-[10px] text-slate-400 font-mono tabular-nums">
                                {displayTime}
                              </span>
                            </div>

                            <div className="bg-ustp-cream text-ustp-text border border-amber-200/80 rounded-[20px] rounded-bl-xs px-4 py-2.5 text-xs sm:text-sm leading-relaxed shadow-2xs break-words">
                              {msg.content}
                            </div>
                          </div>
                        </div>

                        {/* Small right-side read indicator avatar on last respondent message matching Messenger UI */}
                        {isLastMessage && (
                          <div
                            className={`w-4 h-4 rounded-full shrink-0 flex items-center justify-center text-[8px] font-extrabold select-none mb-1 ${
                              isFacultySender
                                ? 'bg-ustp-navy text-ustp-gold'
                                : 'bg-amber-200 text-ustp-navy'
                            }`}
                            title={`Seen • ${displayTime}`}
                          >
                            {initial}
                          </div>
                        )}
                      </div>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </div>

          {/* Staged Attachment Chip */}
          {stagedAttachment && (
            <div className="px-4 py-1.5 bg-ustp-cream border-t border-amber-200/80 flex items-center justify-between text-xs shrink-0">
              <span className="font-semibold text-ustp-navy truncate">
                Attached: {stagedAttachment}
              </span>
              <button
                type="button"
                onClick={() => setStagedAttachment(null)}
                aria-label="Remove staged attachment"
                className="text-slate-500 hover:text-red-600 p-1 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Bottom Messenger Composer Bar */}
          <form
            onSubmit={handleSubmit}
            className="bg-ustp-cream/70 border-t border-amber-200/70 px-3 sm:px-4 py-2.5 flex items-center gap-1.5 sm:gap-2.5 shrink-0"
          >
            {/* Hidden file inputs for Photo and Document buttons */}
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleFileChange(e, 'Class_Screenshot.png')}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.txt,.ppt,.pptx"
              className="hidden"
              onChange={(e) => handleFileChange(e, 'Manuscript_Draft_A4.pdf')}
            />

            {/* 1. Voice Note Button (Mic with + badge) */}
            <button
              type="button"
              onClick={handleVoiceNoteClick}
              aria-label="Attach voice message"
              title="Attach voice message"
              className="relative p-2 rounded-full text-ustp-navy hover:bg-ustp-gold/25 transition-colors shrink-0 cursor-pointer"
            >
              <Mic className="w-5 h-5 stroke-[2.2]" />
              <span className="w-3.5 h-3.5 rounded-full bg-ustp-navy text-ustp-gold text-[10px] font-extrabold flex items-center justify-center absolute -bottom-0.5 -right-0.5">
                +
              </span>
            </button>

            {/* 2. Image / Photo Attachment Button */}
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              aria-label="Attach photo or image"
              title="Attach photo or image"
              className="p-2 rounded-full text-ustp-navy hover:bg-ustp-gold/25 transition-colors shrink-0 cursor-pointer"
            >
              <ImageIcon className="w-5 h-5 stroke-[2.2]" />
            </button>

            {/* 3. Document / File Attachment Button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Attach document file"
              title="Attach document file"
              className="p-2 rounded-full text-ustp-navy hover:bg-ustp-gold/25 transition-colors shrink-0 cursor-pointer"
            >
              <FileText className="w-5 h-5 stroke-[2.2]" />
            </button>

            {/* Rounded Pill Message Input */}
            <label htmlFor="messenger-chat-input" className="sr-only">
              Type a message in {courseHeaderTitle}
            </label>
            <input
              id="messenger-chat-input"
              type="text"
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              placeholder={`Message ${courseHeaderTitle}...`}
              className="flex-1 min-w-0 bg-white border border-slate-300 rounded-full px-4 py-2 text-xs sm:text-sm text-ustp-text placeholder:text-slate-400 focus:outline-none focus:border-ustp-navy focus:ring-2 focus:ring-ustp-gold/40"
            />

            {/* Circular USTP Navy & Gold Send Arrow Button */}
            <button
              type="submit"
              disabled={(!messageText.trim() && !stagedAttachment) || isSending}
              aria-label="Send message"
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-ustp-navy hover:opacity-95 disabled:opacity-45 text-ustp-gold border border-ustp-gold flex items-center justify-center shrink-0 transition-opacity cursor-pointer shadow-2xs"
            >
              <ArrowRight className="w-4 h-4 stroke-[2.5]" />
            </button>
          </form>
        </>
      )}
    </section>
  );
}
