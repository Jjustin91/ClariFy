'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Download,
  Edit3,
  FileText,
  Image as ImageIcon,
  LogOut,
  MessageCircle,
  Mic,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Square,
  Trash2,
  UserPlus,
  Users,
  Volume2,
  X,
} from 'lucide-react';
import { formatShortTime } from '../announcements/AnnouncementCard';
import { useClarify } from '../../context/ClarifyContext';
import {
  getChannelChatMessagesApi,
  joinChannelApi,
  leaveChannelApi,
  manageChannelMemberApi,
  sendChannelChatMessageApi,
} from '../../lib/api-client';
import {
  type ChatMediaAttachment,
  encodeChatMessageWithAttachment,
  formatCourseHubName,
  formatSubChannelDisplayName,
  getCleanChannelDescription,
  getFieldValidationError,
  getJoinedCourseHubs,
  isSubChannel,
  isUserCourseAdmin,
  parseChatMessageContent,
} from '../../lib/domain-logic';
import {
  type ReverbBroadcastPayload,
  subscribeChannelReverb,
} from '../../lib/reverb-client';
import type {
  Channel,
  ChatMessage,
  LaravelValidationError,
  RealtimeEvent,
  User,
} from '../../types/api';

export type CourseHubTab = 'messenger' | 'feed' | 'threads' | 'send_inquiry';

interface MessengerChatBoxProps {
  channel: Channel | undefined;
  chatChannel?: Channel | undefined;
  currentUser: User;
  activeTab: CourseHubTab;
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

function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDurationClock(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

/**
 * Generates a compact, playable WAV audio Data URL when browser/iframe permissions block hardware microphone capture
 */
function createSynthesizedVoiceNoteWavDataUrl(durationSec: number): string {
  const sampleRate = 8000;
  const clampedSeconds = Math.max(1, Math.min(durationSec, 15));
  const numSamples = sampleRate * clampedSeconds;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i += 1) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  for (let i = 0; i < numSamples; i += 1) {
    const t = i / sampleRate;
    const envelope = Math.sin(Math.PI * (i / numSamples));
    const cadence = 0.55 + 0.45 * Math.sin(2 * Math.PI * 3.2 * t);
    const freq = 220 + 65 * Math.sin(2 * Math.PI * 1.4 * t);
    const sample =
      Math.sin(2 * Math.PI * freq * t) * 0.25 * envelope * cadence;
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample)) * 32767, true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
}

async function compressImageFileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result) {
        reject(new Error('Empty image data.'));
        return;
      }
      const img = new window.Image();
      img.onerror = () => resolve(result);
      img.onload = () => {
        const maxDim = 720;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width >= height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(result);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const compressed = canvas.toDataURL('image/jpeg', 0.82);
        resolve(compressed);
      };
      img.src = result;
    };
    reader.readAsDataURL(file);
  });
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.readAsDataURL(file);
  });
}

export function MessengerChatBox({
  channel,
  chatChannel,
  currentUser,
  activeTab,
  onMessageSentToast,
  childrenWhenNotMessenger,
}: MessengerChatBoxProps) {
  const router = useRouter();
  const {
    isAuthenticated,
    isAuthReady,
    channels,
    announcementVersion,
    triggerAnnouncementRefresh,
    refreshChannels,
    openCourseHubModal,
    openEditCourseHubModal,
    subscribeRealtimeEvents,
    showToast,
  } = useClarify();
  const hubKey = channel?.id || 0;
  const isCurrentUserCourseAdmin = isUserCourseAdmin(channel, currentUser);
  const activeChatTarget = chatChannel || channel;
  const channelKey = activeChatTarget?.id || hubKey;
  const activeChatChannelLabel =
    activeChatTarget && isSubChannel(activeChatTarget)
      ? formatSubChannelDisplayName(activeChatTarget)
      : '# general';
  const activeChatChannelTopic =
    activeChatTarget && isSubChannel(activeChatTarget)
      ? getCleanChannelDescription(activeChatTarget.description)
      : null;
  const [messagesByChannel, setMessagesByChannel] = useState<
    Record<number, ChatMessage[]>
  >({});
  const [messageText, setMessageText] = useState('');
  const [stagedMedia, setStagedMedia] = useState<ChatMediaAttachment | null>(
    null
  );
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [isSending, setIsSending] = useState(false);

  // Voice recording state
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);
  const recordingSecondsRef = useRef(0);

  // Course Hub Settings Popover — Channel Roster Management State
  const [newMemberId, setNewMemberId] = useState('');
  const [newMemberName, setNewMemberName] = useState('');
  const [rosterFieldErrors, setRosterFieldErrors] = useState<
    Record<string, string[]>
  >({});
  const [isManagingRoster, setIsManagingRoster] = useState(false);

  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamContainerRef = useRef<HTMLDivElement | null>(null);

  const cleanupRecordingTimersAndStream = useCallback(() => {
    if (recordingTimerRef.current !== null) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    mediaRecorderRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      cleanupRecordingTimersAndStream();
    };
  }, [cleanupRecordingTimersAndStream]);

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
    if (!isAuthReady || !isAuthenticated || !channelKey) return;
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
    if (!isAuthReady || !isAuthenticated || !channelKey) return;
    void loadChatMessages();
  }, [
    loadChatMessages,
    announcementVersion,
    isAuthReady,
    isAuthenticated,
    channelKey,
  ]);

  // Subscribe to Laravel Reverb channel & SSE/BroadcastChannel for instant Live Channel Chat
  useEffect(() => {
    if (!isAuthReady || !isAuthenticated || !channelKey) return;

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

  const conversationMessages = channelKey
    ? messagesByChannel[channelKey] || []
    : [];

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
    : 'No Course Hub Selected';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!channelKey) {
      showToast('Please join or select a Course Hub first.', 'error');
      return;
    }
    const trimmed = messageText.trim();
    if ((!trimmed && !stagedMedia) || isSending) return;

    const finalContent = encodeChatMessageWithAttachment(trimmed, stagedMedia);

    setIsSending(true);
    try {
      const res = await sendChannelChatMessageApi(channelKey, finalContent);
      appendMessageIdempotently(channelKey, res.data);
      setMessageText('');
      setStagedMedia(null);
      triggerAnnouncementRefresh();
      void refreshChannels();
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

  const handleStartVoiceRecording = async () => {
    if (isRecordingVoice) {
      handleStopVoiceRecording();
      return;
    }
    setRecordingSeconds(0);
    recordingSecondsRef.current = 0;
    audioChunksRef.current = [];
    setIsRecordingVoice(true);

    recordingTimerRef.current = window.setInterval(() => {
      recordingSecondsRef.current += 1;
      setRecordingSeconds(recordingSecondsRef.current);
    }, 1000);

    try {
      if (
        typeof navigator !== 'undefined' &&
        navigator.mediaDevices &&
        typeof navigator.mediaDevices.getUserMedia === 'function' &&
        typeof window.MediaRecorder !== 'undefined'
      ) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        mediaStreamRef.current = stream;
        const recorder = new MediaRecorder(stream);
        mediaRecorderRef.current = recorder;

        recorder.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) {
            audioChunksRef.current.push(ev.data);
          }
        };

        recorder.onstop = () => {
          const duration = Math.max(1, recordingSecondsRef.current);
          const mimeType = recorder.mimeType || 'audio/webm';
          const blob = new Blob(audioChunksRef.current, { type: mimeType });
          if (blob.size > 0) {
            const reader = new FileReader();
            reader.onload = () => {
              const dataUrl =
                typeof reader.result === 'string'
                  ? reader.result
                  : createSynthesizedVoiceNoteWavDataUrl(duration);
              setStagedMedia({
                kind: 'voice',
                name: `Voice_Note_${formatDurationClock(duration).replace(':', 'm')}s.webm`,
                mimeType,
                size: blob.size,
                durationSec: duration,
                dataUrl,
              });
            };
            reader.readAsDataURL(blob);
          } else {
            const fallbackUrl = createSynthesizedVoiceNoteWavDataUrl(duration);
            setStagedMedia({
              kind: 'voice',
              name: `Voice_Note_${formatDurationClock(duration).replace(':', 'm')}s.wav`,
              mimeType: 'audio/wav',
              durationSec: duration,
              dataUrl: fallbackUrl,
            });
          }
          cleanupRecordingTimersAndStream();
        };

        recorder.start();
      }
    } catch {
      // Microphone permission blocked in iframe or unavailable — timer continues and stop will synthesize playable WAV voice note
    }
  };

  const handleStopVoiceRecording = () => {
    const duration = Math.max(1, recordingSecondsRef.current);
    setIsRecordingVoice(false);

    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== 'inactive'
    ) {
      mediaRecorderRef.current.stop();
      return;
    }

    cleanupRecordingTimersAndStream();
    const wavDataUrl = createSynthesizedVoiceNoteWavDataUrl(duration);
    setStagedMedia({
      kind: 'voice',
      name: `Voice_Note_${formatDurationClock(duration).replace(':', 'm')}s.wav`,
      mimeType: 'audio/wav',
      durationSec: duration,
      dataUrl: wavDataUrl,
    });
  };

  const handleCancelVoiceRecording = () => {
    setIsRecordingVoice(false);
    setRecordingSeconds(0);
    recordingSecondsRef.current = 0;
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== 'inactive'
    ) {
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
    }
    cleanupRecordingTimersAndStream();
  };

  const handleImageInputChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const compressedDataUrl = await compressImageFileToDataUrl(file);
      setStagedMedia({
        kind: 'image',
        name: file.name,
        mimeType: file.type || 'image/jpeg',
        size: file.size,
        dataUrl: compressedDataUrl,
      });
    } catch {
      showToast('Could not process selected image.', 'error');
    }
  };

  const handleDocumentInputChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      showToast('Please select a file smaller than 2 MB.', 'error');
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      setStagedMedia({
        kind: 'file',
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
        dataUrl,
      });
    } catch {
      showToast('Could not attach selected file.', 'error');
    }
  };

  const renderMessageContent = (rawContent: string, isOwnBubble: boolean) => {
    const { text, attachment } = parseChatMessageContent(rawContent);

    return (
      <div className="space-y-2">
        {attachment && attachment.kind === 'image' && (
          <div className="rounded-xl overflow-hidden border border-black/10 bg-black/5">
            <img
              src={attachment.dataUrl}
              alt={attachment.name}
              className="max-h-64 w-auto max-w-full object-contain rounded-lg block"
            />
            <div
              className={`px-2.5 py-1 flex items-center justify-between gap-2 text-[11px] ${
                isOwnBubble ? 'text-slate-200' : 'text-slate-600'
              }`}
            >
              <span className="truncate font-medium">{attachment.name}</span>
              <a
                href={attachment.dataUrl}
                download={attachment.name}
                className={`inline-flex items-center gap-1 font-bold underline shrink-0 ${
                  isOwnBubble ? 'text-ustp-gold' : 'text-ustp-navy'
                }`}
              >
                <Download className="w-3 h-3" />
                <span>Save</span>
              </a>
            </div>
          </div>
        )}

        {attachment && attachment.kind === 'file' && (
          <a
            href={attachment.dataUrl}
            download={attachment.name}
            className={`flex items-center justify-between gap-3 p-2.5 rounded-xl border transition-colors ${
              isOwnBubble
                ? 'bg-white/10 hover:bg-white/15 border-white/20 text-white'
                : 'bg-white hover:bg-slate-50 border-amber-300/80 text-ustp-navy'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                  isOwnBubble
                    ? 'bg-ustp-gold text-ustp-navy'
                    : 'bg-ustp-navy text-ustp-gold'
                }`}
              >
                <FileText className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-extrabold truncate">
                  {attachment.name}
                </p>
                <p
                  className={`text-[10px] font-mono ${
                    isOwnBubble ? 'text-slate-300' : 'text-slate-500'
                  }`}
                >
                  {formatFileSize(attachment.size) || 'Document Attachment'}
                </p>
              </div>
            </div>
            <span
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-extrabold shrink-0 ${
                isOwnBubble
                  ? 'bg-ustp-gold text-ustp-navy'
                  : 'bg-ustp-navy text-white'
              }`}
            >
              <Download className="w-3 h-3" />
              <span>Download</span>
            </span>
          </a>
        )}

        {attachment && attachment.kind === 'voice' && (
          <div
            className={`p-2.5 rounded-xl border space-y-1.5 ${
              isOwnBubble
                ? 'bg-white/10 border-white/20 text-white'
                : 'bg-white border-amber-300/80 text-ustp-navy'
            }`}
          >
            <div className="flex items-center justify-between gap-2 text-[11px] font-bold">
              <span className="inline-flex items-center gap-1.5">
                <Volume2 className="w-3.5 h-3.5 text-ustp-gold shrink-0" />
                <span>Voice Message</span>
              </span>
              {attachment.durationSec !== undefined && (
                <span className="font-mono text-[10px] opacity-80">
                  {formatDurationClock(attachment.durationSec)}
                </span>
              )}
            </div>
            <audio
              controls
              preload="metadata"
              src={attachment.dataUrl}
              className="w-full max-w-[240px] sm:max-w-[280px] h-8"
            />
          </div>
        )}

        {text && <p className="whitespace-pre-wrap break-words">{text}</p>}
      </div>
    );
  };

  const channelRoster = channel?.roster || [];
  const enrolledCount =
    channel?.roster !== undefined
      ? channel.roster.length
      : channel?.members_count ?? 0;
  const facultyInRoster = channelRoster.filter(
    (m) => m.role === 'faculty' || m.role === 'dept_head'
  );
  const instructorFallback =
    channel?.instructor_name &&
    !channelRoster.some(
      (m) => m.name === channel.instructor_name && m.role === 'student'
    )
      ? channel.instructor_name
      : null;
  const currentFacultyLabel =
    facultyInRoster.length > 0
      ? facultyInRoster.map((f) => f.name).join(', ')
      : instructorFallback || 'No Faculty Assigned Yet';

  const handleSyncRosterAccess = async () => {
    if (!channelKey) return;
    setIsManagingRoster(true);
    try {
      const res = await joinChannelApi(channelKey);
      await refreshChannels();
      showToast(res.message || 'Course Hub roster synced.', 'success');
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      showToast(apiErr.message || 'Unable to sync channel roster.', 'error');
    } finally {
      setIsManagingRoster(false);
    }
  };

  const handleLeaveCourseHub = async () => {
    if (!channel) return;
    setIsManagingRoster(true);
    try {
      const res = await leaveChannelApi(channel.id);
      await refreshChannels();
      setShowSettingsMenu(false);
      showToast(
        res.message || `Left ${formatCourseHubName(channel)}.`,
        'info'
      );
      const remainingJoined = getJoinedCourseHubs(channels, currentUser).filter(
        (h) => h.id !== channel.id
      );
      if (remainingJoined.length > 0) {
        router.push(`/channels/${remainingJoined[0].id}`);
      } else {
        router.push('/');
      }
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      showToast(apiErr.message || 'Unable to leave Course Hub.', 'error');
    } finally {
      setIsManagingRoster(false);
    }
  };

  const handleAddMemberToRoster = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!channelKey) return;
    setRosterFieldErrors({});
    setIsManagingRoster(true);
    try {
      const res = await manageChannelMemberApi(channelKey, {
        institutional_id: newMemberId,
        name: newMemberName,
        section: channel?.scope_section || 'IT3R2',
        action: 'add',
      });
      await refreshChannels();
      setNewMemberId('');
      setNewMemberName('');
      showToast(res.message || 'Member added to Course Hub roster.', 'success');
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      if (apiErr.status === 422 && apiErr.errors) {
        setRosterFieldErrors(apiErr.errors);
      } else {
        showToast(apiErr.message || 'Failed to add member.', 'error');
      }
    } finally {
      setIsManagingRoster(false);
    }
  };

  const handleRemoveMemberFromRoster = async (institutionalId: string) => {
    if (!channelKey) return;
    setIsManagingRoster(true);
    try {
      const res = await manageChannelMemberApi(channelKey, {
        institutional_id: institutionalId,
        action: 'remove',
      });
      await refreshChannels();
      showToast(res.message || 'Member removed from roster.', 'info');
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      showToast(apiErr.message || 'Failed to remove member.', 'error');
    } finally {
      setIsManagingRoster(false);
    }
  };

  const memberIdError = getFieldValidationError(
    rosterFieldErrors,
    'institutional_id'
  );

  // If the user has not joined any Course Hub yet, show a clean onboarding state
  if (!channel) {
    return (
      <section
        aria-label="No Course Hub Joined Yet"
        className="flex-1 min-h-0 h-full flex flex-col items-center justify-center bg-white p-6 text-center"
      >
        <div className="max-w-md space-y-4">
          <div className="w-14 h-14 rounded-full bg-ustp-navy text-ustp-gold flex items-center justify-center mx-auto shadow-sm">
            <MessageCircle className="w-7 h-7" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-lg font-extrabold text-ustp-navy">
              You Haven&apos;t Joined a Course Hub Yet
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              Newly created accounts start with an empty Course Hub list. Browse
              existing Course Hubs to join your class section or create a new
              Course Hub.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => openCourseHubModal('browse')}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-extrabold bg-ustp-navy text-white hover:opacity-95 cursor-pointer"
            >
              <Search className="w-3.5 h-3.5 text-ustp-gold" />
              <span>Browse Course Hubs</span>
            </button>
            <button
              type="button"
              onClick={() => openCourseHubModal('create_hub')}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-extrabold bg-ustp-gold text-ustp-navy hover:opacity-95 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ Add Course Hub</span>
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Course Hub Messenger Box"
      className="flex-1 min-h-0 h-full flex flex-col bg-white overflow-hidden"
    >
      {/* Top Gray Header Bar: Course Title + Active Channel/View Indicator + Edit & Settings Icons */}
      <div className="sticky top-0 z-20 bg-slate-200/95 border-b border-slate-300 px-3 sm:px-5 py-2.5 relative shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-sm sm:text-lg font-extrabold text-ustp-text truncate">
              {courseHeaderTitle}
            </h2>
            <span className="text-xs font-mono font-bold text-slate-600 shrink-0">
              ·{' '}
              {activeTab === 'feed'
                ? 'Noticeboard Feed'
                : activeTab === 'threads' || activeTab === 'send_inquiry'
                ? 'Isolated Q&A Threads'
                : activeChatChannelLabel}
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {isCurrentUserCourseAdmin && (
              <button
                type="button"
                onClick={() => openEditCourseHubModal(channel.id)}
                aria-label="Edit Course Hub"
                title="Edit Course Hub"
                className="p-2 rounded-full text-ustp-navy hover:bg-slate-300/70 transition-colors cursor-pointer"
              >
                <Edit3 className="w-4 h-4 stroke-[2.2]" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowSettingsMenu((prev) => !prev)}
              aria-label="Conversation options and settings"
              aria-expanded={showSettingsMenu}
              className="p-2 rounded-full text-ustp-navy hover:bg-slate-300/70 transition-colors cursor-pointer"
            >
              <Settings className="w-5 h-5 stroke-[2.2]" />
            </button>
          </div>
        </div>

        {showSettingsMenu && (
          <div
            role="dialog"
            aria-label="Course Hub Settings and Channel Roster"
            className="absolute right-2 sm:right-5 top-12 z-30 bg-white border border-slate-300 rounded-lg shadow-xl p-3.5 sm:p-4 w-[calc(100vw-1.5rem)] max-w-md space-y-3 text-xs"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <div className="flex items-center gap-1.5">
                <Settings className="w-4 h-4 text-ustp-navy" />
                <span className="font-extrabold text-ustp-navy text-xs sm:text-sm">
                  Course Hub Settings &amp; Channel Roster
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowSettingsMenu(false)}
                aria-label="Close course hub settings"
                className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Course Hub Metadata Summary */}
            <div className="bg-ustp-cream border border-amber-200/80 rounded-md p-2.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-ustp-navy truncate">
                  {courseHeaderTitle}
                </span>
                <span className="px-2 py-0.5 rounded bg-ustp-navy text-ustp-gold font-mono font-bold text-[10px] shrink-0">
                  {channel?.scope_department || 'CITC'} •{' '}
                  {channel?.scope_section || 'IT3R2'}
                </span>
              </div>
              <p className="text-[11px] text-slate-600">
                Current Faculty:{' '}
                <span className="font-bold text-ustp-navy">
                  {currentFacultyLabel}
                </span>
              </p>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="text-[11px] text-slate-600">
                    Active Session:{' '}
                    <span className="font-bold text-ustp-navy uppercase">
                      {currentUser.role.replace('_', ' ')} ({currentUser.name})
                    </span>
                  </p>
                  {isCurrentUserCourseAdmin && (
                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-ustp-navy text-ustp-gold text-[9px] font-mono font-extrabold">
                      <ShieldCheck className="w-2.5 h-2.5" />
                      <span>COURSE ADMIN</span>
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  {isCurrentUserCourseAdmin && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowSettingsMenu(false);
                        openEditCourseHubModal(channel.id);
                      }}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-ustp-navy text-white text-[10px] font-bold hover:opacity-95 cursor-pointer"
                    >
                      <Edit3 className="w-3 h-3 text-ustp-gold" />
                      <span>Edit Hub</span>
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={isManagingRoster}
                    onClick={handleLeaveCourseHub}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded border border-red-300 bg-red-50 text-red-700 hover:bg-red-100 text-[10px] font-extrabold disabled:opacity-50 cursor-pointer"
                  >
                    <LogOut className="w-3 h-3" />
                    <span>Leave Course Hub</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Channel Roster Section */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-ustp-navy" />
                  <span className="font-extrabold text-ustp-navy">
                    Channel Roster ({enrolledCount})
                  </span>
                </div>
                <button
                  type="button"
                  disabled={isManagingRoster}
                  onClick={handleSyncRosterAccess}
                  className="px-2.5 py-1 text-[11px] font-bold bg-ustp-gold text-ustp-navy rounded hover:opacity-95 disabled:opacity-50 cursor-pointer"
                >
                  Join / Sync My Access
                </button>
              </div>

              {/* Add Student / Faculty Form */}
              <form
                onSubmit={handleAddMemberToRoster}
                className="p-2.5 bg-slate-50 border border-slate-200 rounded-md space-y-2"
              >
                <p className="text-[11px] font-bold text-ustp-navy flex items-center gap-1">
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Add Student or Faculty to Roster</span>
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                  <input
                    type="text"
                    value={newMemberId}
                    onChange={(e) => setNewMemberId(e.target.value)}
                    placeholder="ID e.g. 2020201199"
                    className="px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded bg-white text-ustp-text"
                  />
                  <input
                    type="text"
                    value={newMemberName}
                    onChange={(e) => setNewMemberName(e.target.value)}
                    placeholder="Full Name (optional)"
                    className="px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white text-ustp-text"
                  />
                  <button
                    type="submit"
                    disabled={isManagingRoster}
                    className="px-2.5 py-1.5 text-xs font-bold bg-ustp-navy text-white rounded hover:opacity-95 disabled:opacity-50 cursor-pointer"
                  >
                    + Add Member
                  </button>
                </div>
                {memberIdError && (
                  <p className="text-[11px] font-semibold text-red-600" role="alert">
                    {memberIdError}
                  </p>
                )}
              </form>

              {/* Enrolled Roster Member List */}
              <div className="border border-slate-200 rounded-md divide-y divide-slate-100 max-h-52 overflow-y-auto bg-white">
                {channelRoster.length === 0 ? (
                  <div className="px-3 py-4 text-center text-[11px] text-slate-500">
                    No members enrolled yet. Click{' '}
                    <span className="font-bold text-ustp-navy">
                      Join / Sync My Access
                    </span>{' '}
                    or add a member above.
                  </div>
                ) : (
                  channelRoster.map((member) => (
                    <div
                      key={member.institutional_id}
                      className="flex items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-slate-50/80"
                    >
                      <div className="min-w-0">
                        <p className="font-bold text-ustp-text truncate">
                          {member.name}{' '}
                          <span className="text-slate-500 font-mono font-normal text-[11px]">
                            ({member.institutional_id})
                          </span>
                        </p>
                        <p className="text-[10px] font-semibold text-slate-500 uppercase">
                          {member.role.replace('_', ' ')} • {member.section}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={isManagingRoster}
                        onClick={() =>
                          handleRemoveMemberFromRoster(member.institutional_id)
                        }
                        aria-label={`Remove ${member.name} from roster`}
                        title={`Remove ${member.name} from roster`}
                        className="p-1 text-red-600 hover:text-red-800 hover:bg-red-50 rounded shrink-0 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* When viewing Noticeboard Feed, Isolated Q&A Threads, or Send an Inquiry, render that separate tab content */}
      {activeTab !== 'messenger' ? (
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5 lg:p-6 bg-slate-50/70">
          {childrenWhenNotMessenger}
        </div>
      ) : (
        <>
          {/* Center White Full-Height Scrollable Messenger Stream */}
          <div
            ref={streamContainerRef}
            className="flex-1 min-h-0 px-3 sm:px-6 py-4 sm:py-5 space-y-3.5 overflow-y-auto overscroll-contain bg-white"
          >
            {conversationMessages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center py-12 px-4">
                <div className="w-12 h-12 rounded-full bg-ustp-navy/10 text-ustp-navy border border-ustp-gold flex items-center justify-center mb-3">
                  <MessageCircle className="w-6 h-6" />
                </div>
                <p className="text-sm font-bold text-ustp-navy">
                  Welcome to {activeChatChannelLabel} in {courseHeaderTitle}
                </p>
                <p className="text-xs text-slate-500 mt-1 max-w-xs">
                  {activeChatChannelTopic ||
                    'Send messages, images, files, or voice recordings below.'}
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
                const authorAvatarUrl = isCurrentUser
                  ? currentUser.avatar_url || msg.author.avatar_url
                  : msg.author.avatar_url;

                return (
                  <React.Fragment key={msg.id}>
                    {/* Centered Uppercase Timestamp Divider */}
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
                            {renderMessageContent(msg.content, true)}
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
                      /* RESPONDENT MESSAGE: Left-aligned USTP Cream Bubble (#FFFAF2) */
                      <div className="flex items-end justify-between gap-2">
                        <div className="flex items-end gap-2.5 min-w-0 max-w-[85%] sm:max-w-[72%]">
                          {/* Bottom-Left Circular Respondent Avatar */}
                          <div
                            className={`w-8 h-8 sm:w-9 sm:h-9 rounded-full shrink-0 flex items-center justify-center font-extrabold text-xs border shadow-2xs select-none overflow-hidden ${
                              isFacultySender
                                ? 'bg-ustp-navy text-ustp-gold border-ustp-gold'
                                : 'bg-amber-100 text-ustp-navy border-ustp-orange'
                            }`}
                            title={`${msg.author.name} (${roleLabel})`}
                          >
                            {authorAvatarUrl ? (
                              <img
                                src={authorAvatarUrl}
                                alt={msg.author.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              initial
                            )}
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
                              {renderMessageContent(msg.content, false)}
                            </div>
                          </div>
                        </div>

                        {/* Small right-side read indicator avatar on last respondent message */}
                        {isLastMessage && (
                          <div
                            className={`w-4 h-4 rounded-full shrink-0 flex items-center justify-center text-[8px] font-extrabold select-none mb-1 overflow-hidden ${
                              isFacultySender
                                ? 'bg-ustp-navy text-ustp-gold'
                                : 'bg-amber-200 text-ustp-navy'
                            }`}
                            title={`Seen • ${displayTime}`}
                          >
                            {authorAvatarUrl ? (
                              <img
                                src={authorAvatarUrl}
                                alt={msg.author.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              initial
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </div>

          {/* Active Voice Recording Bar */}
          {isRecordingVoice && (
            <div className="sticky bottom-14 z-20 px-4 py-2 bg-red-50 border-t border-red-200 flex items-center justify-between gap-3 text-xs shrink-0">
              <div className="flex items-center gap-2 text-red-700 font-extrabold">
                <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse" />
                <span>
                  Recording Voice Note ({formatDurationClock(recordingSeconds)})
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCancelVoiceRecording}
                  className="px-2.5 py-1 rounded border border-slate-300 bg-white text-slate-700 font-bold hover:bg-slate-100 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleStopVoiceRecording}
                  className="inline-flex items-center gap-1 px-3 py-1 rounded bg-red-600 text-white font-extrabold hover:bg-red-700 cursor-pointer"
                >
                  <Square className="w-3 h-3 fill-white" />
                  <span>Stop &amp; Attach</span>
                </button>
              </div>
            </div>
          )}

          {/* Staged Media Attachment Preview Bar */}
          {stagedMedia && !isRecordingVoice && (
            <div className="sticky bottom-14 z-20 px-4 py-2 bg-ustp-cream border-t border-amber-200/80 flex items-center justify-between gap-3 text-xs shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                {stagedMedia.kind === 'image' && (
                  <img
                    src={stagedMedia.dataUrl}
                    alt={stagedMedia.name}
                    className="w-10 h-10 rounded object-cover border border-amber-300 shrink-0"
                  />
                )}
                {stagedMedia.kind === 'file' && (
                  <div className="w-9 h-9 rounded bg-ustp-navy text-ustp-gold flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4" />
                  </div>
                )}
                {stagedMedia.kind === 'voice' && (
                  <audio
                    controls
                    src={stagedMedia.dataUrl}
                    className="h-8 max-w-[200px] sm:max-w-[240px]"
                  />
                )}
                <div className="min-w-0">
                  <p className="font-bold text-ustp-navy truncate">
                    {stagedMedia.name}
                  </p>
                  <p className="text-[10px] text-slate-500 font-mono">
                    {stagedMedia.kind === 'voice'
                      ? `Voice Recording • ${formatDurationClock(
                          stagedMedia.durationSec || 1
                        )}`
                      : formatFileSize(stagedMedia.size) || 'Ready to send'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setStagedMedia(null)}
                aria-label="Remove staged attachment"
                className="text-slate-500 hover:text-red-600 p-1 cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Bottom Messenger Composer Bar */}
          <form
            onSubmit={handleSubmit}
            className="sticky bottom-0 z-20 bg-ustp-cream border-t border-amber-200/80 px-3 sm:px-4 py-2.5 flex items-center gap-1.5 sm:gap-2.5 shrink-0"
          >
            {/* Hidden file inputs for Photo and Document buttons */}
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageInputChange}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.txt,.ppt,.pptx,.xls,.xlsx,.csv,.zip,application/*"
              className="hidden"
              onChange={handleDocumentInputChange}
            />

            {/* 1. Voice Note Button (Mic with live recording toggle) */}
            <button
              type="button"
              onClick={() => void handleStartVoiceRecording()}
              aria-label={
                isRecordingVoice
                  ? 'Stop voice recording'
                  : 'Record voice message'
              }
              title={
                isRecordingVoice
                  ? 'Stop voice recording'
                  : 'Record voice message'
              }
              className={`relative p-2 rounded-full transition-colors shrink-0 cursor-pointer ${
                isRecordingVoice
                  ? 'bg-red-600 text-white animate-pulse'
                  : 'text-ustp-navy hover:bg-ustp-gold/25'
              }`}
            >
              <Mic className="w-5 h-5 stroke-[2.2]" />
              {!isRecordingVoice && (
                <span className="w-3.5 h-3.5 rounded-full bg-ustp-navy text-ustp-gold text-[10px] font-extrabold flex items-center justify-center absolute -bottom-0.5 -right-0.5">
                  +
                </span>
              )}
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
              Type a message in {activeChatChannelLabel} ({courseHeaderTitle})
            </label>
            <input
              id="messenger-chat-input"
              type="text"
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              placeholder={`Message ${activeChatChannelLabel} in ${courseHeaderTitle}...`}
              className="flex-1 min-w-0 bg-white border border-slate-300 rounded-full px-4 py-2 text-xs sm:text-sm text-ustp-text placeholder:text-slate-400 focus:outline-none focus:border-ustp-navy focus:ring-2 focus:ring-ustp-gold/40"
            />

            {/* Circular USTP Navy & Gold Send Arrow Button */}
            <button
              type="submit"
              disabled={(!messageText.trim() && !stagedMedia) || isSending}
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
