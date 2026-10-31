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
import type { Channel, ChatMessage, User } from '../../types/api';

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
  const { announcementVersion, triggerAnnouncementRefresh, showToast } =
    useClarify();
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

  const loadChatMessages = useCallback(async () => {
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
  }, [channelKey]);

  useEffect(() => {
    void loadChatMessages();
  }, [loadChatMessages, announcementVersion]);

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
      setMessagesByChannel((prev) => ({
        ...prev,
        [channelKey]: [...(prev[channelKey] || []), res.data],
      }));
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
      <div className="bg-slate-200/90 border-b border-slate-300 px-4 sm:px-5 py-2.5 space-y-2 relative shrink-0">
        {/* Header Row 1: Course Title + Settings Gear Icon matching Wireframe */}
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base sm:text-lg font-extrabold text-ustp-text truncate">
            {courseHeaderTitle}
          </h2>

          <button
            type="button"
            onClick={() => setShowSettingsMenu((prev) => !prev)}
            aria-label="Conversation options and settings"
            aria-expanded={showSettingsMenu}
            className="p-1.5 rounded-full text-ustp-navy hover:bg-slate-300/70 transition-colors shrink-0 cursor-pointer"
          >
            <Settings className="w-5 h-5 stroke-[2.2]" />
          </button>
        </div>

        {/* Header Row 2: 3 Separate Workspace Tabs (Messenger Chat | Noticeboard Feed | Isolated Q&A Threads) + Primary Action Button */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-slate-300/70">
          <div
            className="flex items-center gap-1.5 flex-wrap"
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
        <div className="flex-1 min-h-0 overflow-y-auto p-5 lg:p-6 bg-slate-50/70">
          {childrenWhenNotMessenger}
        </div>
      ) : (
        <>
          {/* Center White Full-Height Scrollable Message Stream matching Wireframe Bubbles */}
          <div
            ref={streamContainerRef}
            className="flex-1 min-h-0 p-5 sm:p-6 space-y-5 overflow-y-auto bg-white"
          >
            {conversationMessages.map((msg) => {
              const isFacultySender =
                msg.author.role === 'faculty' ||
                msg.author.role === 'dept_head' ||
                msg.author.role === 'it_admin';
              const roleTitle = isFacultySender ? 'Faculty Name' : 'Student Name';
              const displayTime = formatShortTime(msg.created_at);
              const initial = msg.author.name
                ? msg.author.name.charAt(0).toUpperCase()
                : isFacultySender
                ? 'F'
                : 'S';

              return (
                <div
                  key={msg.id}
                  className="flex items-end justify-between gap-4"
                >
                  <div className="flex items-end gap-3 min-w-0 max-w-2xl">
                    {/* Left Circular Sender Avatar */}
                    <div
                      className={`w-10 h-10 sm:w-11 sm:h-11 rounded-full shrink-0 flex items-center justify-center font-extrabold text-sm border-2 shadow-2xs select-none ${
                        isFacultySender
                          ? 'bg-ustp-navy text-ustp-gold border-ustp-gold'
                          : 'bg-amber-100 text-ustp-navy border-ustp-orange'
                      }`}
                      title={`${msg.author.name} (${roleTitle})`}
                    >
                      {initial}
                    </div>

                    {/* Sender Role/Name Label + Dark Navy Rounded Chat Bubble */}
                    <div className="space-y-1 min-w-0">
                      <p className="text-xs font-semibold text-ustp-text pl-1">
                        {roleTitle}{' '}
                        <span className="text-slate-500 font-normal">
                          · {msg.author.name}
                        </span>
                      </p>
                      <div className="bg-[#0c0a3e] text-white rounded-2xl px-4 py-3 text-xs sm:text-sm leading-relaxed shadow-xs break-words">
                        {msg.content}
                      </div>
                    </div>
                  </div>

                  {/* Right-Aligned Timestamp matching Wireframe ("5:30pm") */}
                  <span className="text-[11px] text-slate-400 font-mono tabular-nums shrink-0 pb-1">
                    {displayTime}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Staged Attachment Chip */}
          {stagedAttachment && (
            <div className="px-4 py-1.5 bg-slate-100 border-t border-slate-200 flex items-center justify-between text-xs shrink-0">
              <span className="font-semibold text-ustp-navy truncate">
                Attached: {stagedAttachment}
              </span>
              <button
                type="button"
                onClick={() => setStagedAttachment(null)}
                aria-label="Remove staged attachment"
                className="text-slate-500 hover:text-red-600 p-0.5 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Bottom Gray Messenger Composer Bar matching Wireframe (Mic+, Image, File, Rounded Pill Input, Send Arrow) */}
          <form
            onSubmit={handleSubmit}
            className="bg-slate-200/90 border-t border-slate-300 px-4 py-3 flex items-center gap-2.5 shrink-0"
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
              className="relative p-1.5 rounded-lg text-ustp-navy hover:bg-slate-300/80 transition-colors shrink-0 cursor-pointer"
            >
              <Mic className="w-5 h-5 stroke-[2.2]" />
              <span className="w-3.5 h-3.5 rounded-full bg-ustp-navy text-white text-[10px] font-extrabold flex items-center justify-center absolute -bottom-0.5 -right-0.5">
                +
              </span>
            </button>

            {/* 2. Image / Photo Attachment Button */}
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              aria-label="Attach photo or image"
              title="Attach photo or image"
              className="p-1.5 rounded-lg text-ustp-navy hover:bg-slate-300/80 transition-colors shrink-0 cursor-pointer"
            >
              <ImageIcon className="w-5 h-5 stroke-[2.2]" />
            </button>

            {/* 3. Document / File Attachment Button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Attach document file"
              title="Attach document file"
              className="p-1.5 rounded-lg text-ustp-navy hover:bg-slate-300/80 transition-colors shrink-0 cursor-pointer"
            >
              <FileText className="w-5 h-5 stroke-[2.2]" />
            </button>

            {/* Rounded White Pill Message Input */}
            <label htmlFor="messenger-chat-input" className="sr-only">
              Type a message in {courseHeaderTitle}
            </label>
            <input
              id="messenger-chat-input"
              type="text"
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              placeholder={`Message ${courseHeaderTitle} as ${currentUser.name}...`}
              className="flex-1 min-w-0 bg-white border border-slate-300 rounded-full px-4 py-2 text-xs sm:text-sm text-ustp-text placeholder:text-slate-400 focus:outline-none focus:border-ustp-navy"
            />

            {/* Circular Dark Navy Send Arrow Button */}
            <button
              type="submit"
              disabled={(!messageText.trim() && !stagedAttachment) || isSending}
              aria-label="Send message"
              className="w-9 h-9 rounded-full bg-[#0c0a3e] hover:bg-ustp-navy disabled:opacity-50 text-white flex items-center justify-center shrink-0 transition-opacity cursor-pointer"
            >
              <ArrowRight className="w-4 h-4 stroke-[2.5]" />
            </button>
          </form>
        </>
      )}
    </section>
  );
}
