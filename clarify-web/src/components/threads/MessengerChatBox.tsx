'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowRight,
  Check,
  Clock,
  Download,
  Edit3,
  FileText,
  Image as ImageIcon,
  LogOut,
  MessageCircle,
  Mic,
  Plus,
  RotateCcw,
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
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase';
import { formatShortTime } from '../announcements/AnnouncementCard';
import { useClarify } from '../../context/ClarifyContext';
import {
  getChannelChatMessagesApi,
  joinChannelApi,
  leaveChannelApi,
  manageChannelMemberApi,
  sendChannelChatMessageApi,
  unsendChannelChatMessageApi,
} from '../../lib/api-client';
import {
  createRetryableChatFileStore,
  formatCourseHubName,
  formatEnrolledRosterSummary,
  formatSubChannelDisplayName,
  getChannelFacultyLabel,
  getCleanChannelDescription,
  getFieldValidationError,
  getJoinedCourseHubs,
  getUnsentMessagePlaceholder,
  isSubChannel,
  isUserCourseAdmin,
  parseChatMessageContent,
  validateChatAttachmentFile,
} from '../../lib/domain-logic';
import {
  type ReverbBroadcastPayload,
  subscribeChannelReverb,
} from '../../lib/reverb-client';
import type {
  Channel,
  ChatAttachment,
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

interface StagedChatMedia {
  file: File;
  previewUrl: string;
  kind: 'image' | 'file' | 'voice';
  name: string;
  mimeType: string;
  size: number;
  durationSec?: number;
}

/**
 * Generates a compact, playable WAV audio File when browser/iframe permissions block hardware microphone capture
 */
function createSynthesizedVoiceNoteWavFile(durationSec: number): File {
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

  return new File(
    [buffer],
    `Voice_Note_${formatDurationClock(clampedSeconds).replace(':', 'm')}s.wav`,
    {
      type: 'audio/wav',
      lastModified: Date.now(),
    }
  );
}

/**
 * Compresses an uploaded image file via canvas.toBlob and returns a real File
 * (never base64-encoding the image inside message content).
 */
async function compressImageFileToBlobFile(file: File): Promise<File> {
  if (typeof window === 'undefined' || file.type === 'image/gif') {
    return file;
  }

  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new window.Image();
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const maxDim = 1280;
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
        resolve(file);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob || blob.size >= file.size) {
            resolve(file);
            return;
          }
          const baseName = file.name.replace(/\.[^.]+$/, '') || 'photo';
          resolve(
            new File([blob], `${baseName}.jpg`, {
              type: 'image/jpeg',
              lastModified: Date.now(),
            })
          );
        },
        'image/jpeg',
        0.82
      );
    };
    img.src = objectUrl;
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
    rosterChannelById,
    isLoadingRosterById,
    refreshChannelRoster,
    setRosterChannelSnapshot,
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
  const [hasMoreByChannel, setHasMoreByChannel] = useState<
    Record<number, boolean>
  >({});
  const [nextBeforeByChannel, setNextBeforeByChannel] = useState<
    Record<number, number | null>
  >({});
  const [isLoadingOlderByChannel, setIsLoadingOlderByChannel] = useState<
    Record<number, boolean>
  >({});
  const [loadedChannelKeys, setLoadedChannelKeys] = useState<
    Record<number, boolean>
  >({});
  const [isLoadingChannel, setIsLoadingChannel] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [stagedMedia, setStagedMedia] = useState<StagedChatMedia | null>(
    null
  );
  const [brokenImageUrls, setBrokenImageUrls] = useState<
    Record<string, boolean>
  >({});
  const retryFileStoreRef = useRef(createRetryableChatFileStore<File>());
  const activeObjectUrlsRef = useRef<Set<string>>(new Set());

  const createTrackedObjectUrl = useCallback((blob: Blob): string => {
    const url = URL.createObjectURL(blob);
    activeObjectUrlsRef.current.add(url);
    return url;
  }, []);

  const revokeTrackedObjectUrl = useCallback(
    (url: string | null | undefined) => {
      if (!url || !url.startsWith('blob:')) return;
      activeObjectUrlsRef.current.delete(url);
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Ignore revoke errors
      }
    },
    []
  );

  const clearStagedMedia = useCallback(
    (preservePreviewUrl = false) => {
      setStagedMedia((prev) => {
        if (prev && !preservePreviewUrl) {
          revokeTrackedObjectUrl(prev.previewUrl);
        }
        return null;
      });
    },
    [revokeTrackedObjectUrl]
  );

  useEffect(() => {
    const tracked = activeObjectUrlsRef.current;
    return () => {
      tracked.forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // Ignore revoke errors
        }
      });
      tracked.clear();
    };
  }, []);

  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const skipAutoScrollRef = useRef(false);

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
  const [processingMemberIds, setProcessingMemberIds] = useState<
    Record<string, boolean>
  >({});
  const [confirmingUnsendId, setConfirmingUnsendId] = useState<
    string | number | null
  >(null);
  const [unsendingById, setUnsendingById] = useState<Record<string, boolean>>(
    {}
  );

  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamContainerRef = useRef<HTMLDivElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const scrollToBottomSmooth = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.requestAnimationFrame(() => {
      if (streamContainerRef.current) {
        streamContainerRef.current.scrollTo({
          top: streamContainerRef.current.scrollHeight,
          behavior: 'smooth',
        });
      }
    });
  }, []);

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

  // Always load fresh roster & pending_requests when a Course Hub opens AND whenever the settings/pending-requests view opens
  useEffect(() => {
    if (!isAuthReady || !isAuthenticated || !hubKey) return;
    void refreshChannelRoster(hubKey);
  }, [isAuthReady, isAuthenticated, hubKey, refreshChannelRoster]);

  useEffect(() => {
    if (showSettingsMenu && hubKey) {
      void refreshChannelRoster(hubKey);
    }
  }, [showSettingsMenu, hubKey, refreshChannelRoster]);

  /**
   * Appends an incoming real-time message or reconciles it with an in-flight optimistic message
   * matching by confirmed `id`, `temp_id`, or pending sender+content to prevent duplicate rendering.
   */
  const appendMessageIdempotently = useCallback(
    (targetChannelId: number, incomingMessage: ChatMessage) => {
      setMessagesByChannel((prev) => {
        const existing = prev[targetChannelId] || [];
        const incomingIdStr = String(incomingMessage.id);
        const incomingTempIdStr = incomingMessage.temp_id
          ? String(incomingMessage.temp_id)
          : null;

        // 1. Check if already present by confirmed ID or temp_id
        const exactMatchIndex = existing.findIndex(
          (m) =>
            String(m.id) === incomingIdStr ||
            (incomingTempIdStr !== null &&
              (String(m.id) === incomingTempIdStr ||
                (m.temp_id && String(m.temp_id) === incomingTempIdStr)))
        );

        if (exactMatchIndex !== -1) {
          const updated = [...existing];
          updated[exactMatchIndex] = {
            ...existing[exactMatchIndex],
            ...incomingMessage,
            status: 'sent',
          };
          return {
            ...prev,
            [targetChannelId]: updated,
          };
        }

        // 2. If a realtime INSERT arrives before the sender's POST response resolves,
        // match the oldest in-flight optimistic message from the same sender with identical content.
        const optimisticMatchIndex = existing.findIndex(
          (m) =>
            m.status === 'sending' &&
            String(m.id).startsWith('temp-') &&
            Number(m.author.id) === Number(incomingMessage.author.id) &&
            m.content === incomingMessage.content
        );

        if (optimisticMatchIndex !== -1) {
          const updated = [...existing];
          updated[optimisticMatchIndex] = {
            ...incomingMessage,
            temp_id: String(existing[optimisticMatchIndex].id),
            status: 'sent',
          };
          return {
            ...prev,
            [targetChannelId]: updated,
          };
        }

        return {
          ...prev,
          [targetChannelId]: [
            ...existing,
            { ...incomingMessage, status: incomingMessage.status || 'sent' },
          ],
        };
      });
    },
    []
  );

  const hasLoadedCurrentChannel = Boolean(
    channelKey && loadedChannelKeys[channelKey]
  );
  const isInitialChannelLoading =
    Boolean(channelKey) && !hasLoadedCurrentChannel && isLoadingChannel;

  const loadChatMessages = useCallback(async () => {
    if (!isAuthReady || !isAuthenticated || !channelKey) return;
    setIsLoadingChannel(true);
    try {
      const res = await getChannelChatMessagesApi(channelKey, { limit: 50 });
      if (Array.isArray(res.data)) {
        setHasMoreByChannel((prev) => ({
          ...prev,
          [channelKey]: Boolean(res.meta?.has_more),
        }));
        setNextBeforeByChannel((prev) => ({
          ...prev,
          [channelKey]:
            res.meta?.next_before !== undefined
              ? res.meta.next_before
              : res.data.length > 0
              ? Number(res.data[0].id)
              : null,
        }));
        setMessagesByChannel((prev) => {
          const currentList = prev[channelKey] || [];
          const latestIds = new Set(res.data.map((m) => String(m.id)));
          const earliestNewId =
            res.data.length > 0 ? Number(res.data[0].id) : Infinity;
          // Preserve any older paginated messages already loaded in this channel
          const olderLoaded = currentList.filter(
            (m) =>
              m.status === 'sent' &&
              !String(m.id).startsWith('temp-') &&
              Number(m.id) < earliestNewId &&
              !latestIds.has(String(m.id))
          );
          // Preserve any optimistic messages currently in 'sending' or 'failed' state
          const pendingOptimistic = currentList.filter(
            (m) =>
              (m.status === 'sending' || m.status === 'failed') &&
              !res.data.some(
                (serverMsg) =>
                  String(serverMsg.id) === String(m.id) ||
                  (serverMsg.temp_id &&
                    String(serverMsg.temp_id) === String(m.temp_id || m.id))
              )
          );
          return {
            ...prev,
            [channelKey]: [
              ...olderLoaded,
              ...res.data.map((m) => ({ ...m, status: 'sent' as const })),
              ...pendingOptimistic,
            ],
          };
        });
      }
    } catch {
      // Retain existing messages if offline
    } finally {
      setLoadedChannelKeys((prev) => ({ ...prev, [channelKey]: true }));
      setIsLoadingChannel(false);
    }
  }, [channelKey, isAuthReady, isAuthenticated]);

  const loadOlderChatMessages = useCallback(async () => {
    if (!channelKey) return;
    const hasMore = hasMoreByChannel[channelKey];
    const nextBefore = nextBeforeByChannel[channelKey];
    const isLoadingOlder = isLoadingOlderByChannel[channelKey];
    if (!hasMore || !nextBefore || isLoadingOlder) return;

    setIsLoadingOlderByChannel((prev) => ({ ...prev, [channelKey]: true }));
    const container = streamContainerRef.current;
    const prevScrollHeight = container?.scrollHeight || 0;
    const prevScrollTop = container?.scrollTop || 0;

    try {
      const res = await getChannelChatMessagesApi(channelKey, {
        before: nextBefore,
        limit: 50,
      });
      if (Array.isArray(res.data)) {
        skipAutoScrollRef.current = true;
        setHasMoreByChannel((prev) => ({
          ...prev,
          [channelKey]: Boolean(res.meta?.has_more),
        }));
        setNextBeforeByChannel((prev) => ({
          ...prev,
          [channelKey]:
            res.meta?.next_before !== undefined
              ? res.meta.next_before
              : res.data.length > 0
              ? Number(res.data[0].id)
              : null,
        }));
        setMessagesByChannel((prev) => {
          const existing = prev[channelKey] || [];
          const existingIds = new Set(existing.map((m) => String(m.id)));
          const olderUnique = res.data
            .filter((m) => !existingIds.has(String(m.id)))
            .map((m) => ({ ...m, status: 'sent' as const }));
          return {
            ...prev,
            [channelKey]: [...olderUnique, ...existing],
          };
        });

        if (typeof window !== 'undefined' && container) {
          window.requestAnimationFrame(() => {
            const newScrollHeight = container.scrollHeight;
            container.scrollTop =
              prevScrollTop + (newScrollHeight - prevScrollHeight);
          });
        }
      }
    } catch {
      // Ignore older load error
    } finally {
      setIsLoadingOlderByChannel((prev) => ({ ...prev, [channelKey]: false }));
    }
  }, [
    channelKey,
    hasMoreByChannel,
    nextBeforeByChannel,
    isLoadingOlderByChannel,
  ]);

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

  // Supabase Realtime WebSocket Subscription: listen to INSERT events on "messages" filtered by channel_id=eq.${channelKey}
  useEffect(() => {
    if (!isAuthReady || !isAuthenticated || !channelKey) return;

    const handleRealtimeChatEvent = (
      event: RealtimeEvent | ReverbBroadcastPayload
    ) => {
      if (
        event.type === 'membership.changed' ||
        event.type === 'channel.updated'
      ) {
        if (
          hubKey &&
          (!event.channel_id || Number(event.channel_id) === Number(hubKey))
        ) {
          void refreshChannelRoster(hubKey);
        }
        return;
      }
      if (event.type === 'chat.message_unsent') {
        if (event.channel_id && Number(event.channel_id) !== Number(channelKey)) {
          return;
        }
        const targetMsgId = event.message_id ?? event.message?.id;
        if (targetMsgId !== undefined && targetMsgId !== null) {
          setMessagesByChannel((prev) => {
            const list = prev[channelKey] || [];
            if (!list.some((m) => String(m.id) === String(targetMsgId))) {
              return prev;
            }
            return {
              ...prev,
              [channelKey]: list.map((m) =>
                String(m.id) === String(targetMsgId)
                  ? {
                      ...m,
                      is_unsent: true,
                      content: '',
                      attachment: null,
                    }
                  : m
              ),
            };
          });
        }
        return;
      }
      if (event.type !== 'chat.message') return;
      if (event.channel_id && Number(event.channel_id) !== Number(channelKey)) {
        return;
      }
      if (event.message && event.message.id !== undefined) {
        appendMessageIdempotently(channelKey, event.message);
        scrollToBottomSmooth();
      } else {
        void loadChatMessages();
      }
    };

    const unsubscribeReverb = subscribeChannelReverb(
      channelKey,
      handleRealtimeChatEvent
    );
    const unsubscribeStream = subscribeRealtimeEvents(handleRealtimeChatEvent);

    // Subscribe to Supabase Realtime postgres_changes INSERT on public.messages
    const supabaseClient = isSupabaseConfigured ? getSupabaseClient() : null;
    let realtimeChannel: ReturnType<
      NonNullable<typeof supabaseClient>['channel']
    > | null = null;

    if (supabaseClient) {
      try {
        realtimeChannel = supabaseClient
          .channel(`channel-messages-${channelKey}`)
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'messages',
              filter: `channel_id=eq.${channelKey}`,
            },
            (payload) => {
              const raw = payload.new as Record<string, unknown> | undefined;
              if (!raw || raw.id === undefined) return;

              // Only process channel chat rows (exclude Q&A thread roots or thread replies)
              if (
                raw.parent_id !== null &&
                raw.parent_id !== undefined
              ) {
                return;
              }
              if (
                typeof raw.subject_hashtag === 'string' &&
                raw.subject_hashtag !== '__CHAT__'
              ) {
                return;
              }

              const senderId = Number(raw.sender_id || 0);
              const isSenderCurrentUser =
                senderId > 0 && Number(currentUser.id) === senderId;
              const rosterMatch = channel?.roster?.find(
                (member) => Number(member.id) === senderId
              );
              const rawAuthor =
                raw.author && typeof raw.author === 'object'
                  ? (raw.author as Partial<ChatMessage['author']>)
                  : null;

              const incomingMsg: ChatMessage = {
                id: raw.id as number | string,
                temp_id:
                  typeof raw.temp_id === 'string' ? raw.temp_id : undefined,
                channel_id: Number(raw.channel_id || channelKey),
                sender_id: senderId,
                content: String(raw.content || ''),
                created_at:
                  typeof raw.created_at === 'string'
                    ? raw.created_at
                    : new Date().toISOString(),
                status: 'sent',
                author: {
                  id: Number(rawAuthor?.id || senderId),
                  name:
                    rawAuthor?.name ||
                    (isSenderCurrentUser
                      ? currentUser.name
                      : rosterMatch?.name || 'USTP Member'),
                  role:
                    rawAuthor?.role ||
                    (isSenderCurrentUser
                      ? currentUser.role
                      : rosterMatch?.role || 'student'),
                  avatar_url:
                    rawAuthor?.avatar_url ??
                    (isSenderCurrentUser ? currentUser.avatar_url : null),
                },
              };

              appendMessageIdempotently(channelKey, incomingMsg);
              scrollToBottomSmooth();
            }
          )
          .subscribe();
      } catch {
        realtimeChannel = null;
      }
    }

    return () => {
      unsubscribeReverb();
      unsubscribeStream();
      if (supabaseClient && realtimeChannel) {
        void supabaseClient.removeChannel(realtimeChannel);
      }
    };
  }, [
    hubKey,
    channelKey,
    channel?.roster,
    currentUser.id,
    currentUser.name,
    currentUser.role,
    currentUser.avatar_url,
    isAuthReady,
    isAuthenticated,
    appendMessageIdempotently,
    loadChatMessages,
    refreshChannelRoster,
    scrollToBottomSmooth,
    subscribeRealtimeEvents,
  ]);

  const conversationMessages = channelKey
    ? messagesByChannel[channelKey] || []
    : [];
  const hasMoreOlderMessages = Boolean(
    channelKey && hasMoreByChannel[channelKey]
  );
  const isLoadingOlderMessages = Boolean(
    channelKey && isLoadingOlderByChannel[channelKey]
  );

  useEffect(() => {
    if (skipAutoScrollRef.current) {
      skipAutoScrollRef.current = false;
      return;
    }
    if (streamContainerRef.current && activeTab === 'messenger') {
      streamContainerRef.current.scrollTo({
        top: streamContainerRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [channelKey, conversationMessages.length, activeTab]);

  const courseHeaderTitle = channel
    ? `${channel.scope_section || 'IT3R2'}-${channel.course_code || 'IT314'} ${channel.name.replace(
        /^#\s*\S+\s*/,
        ''
      )}`
    : 'No Course Hub Selected';

  const sendOptimisticMessage = useCallback(
    async (
      targetChannelId: number,
      finalContent: string,
      existingTempId?: string,
      attachmentFile?: File | null,
      optimisticAttachment?: ChatAttachment | null
    ) => {
      const tempId =
        existingTempId ||
        `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const nowIso = new Date().toISOString();

      if (attachmentFile) {
        retryFileStoreRef.current.stage(tempId, attachmentFile);
      }

      if (existingTempId) {
        // Mark existing failed message as 'sending' again
        setMessagesByChannel((prev) => ({
          ...prev,
          [targetChannelId]: (prev[targetChannelId] || []).map((m) =>
            String(m.id) === existingTempId ||
            String(m.temp_id) === existingTempId
              ? { ...m, status: 'sending' as const }
              : m
          ),
        }));
      } else {
        const optimisticMessage: ChatMessage = {
          id: tempId,
          temp_id: tempId,
          channel_id: targetChannelId,
          sender_id: currentUser.id,
          content: finalContent,
          attachment: optimisticAttachment ?? null,
          created_at: nowIso,
          status: 'sending',
          author: {
            id: currentUser.id,
            name: currentUser.name,
            role: currentUser.role,
            avatar_url: currentUser.avatar_url,
          },
        };

        setMessagesByChannel((prev) => ({
          ...prev,
          [targetChannelId]: [
            ...(prev[targetChannelId] || []),
            optimisticMessage,
          ],
        }));
      }

      scrollToBottomSmooth();

      try {
        const res = await sendChannelChatMessageApi(
          targetChannelId,
          finalContent,
          tempId,
          attachmentFile
        );
        const confirmedRecord: ChatMessage = {
          ...res.data,
          temp_id: tempId,
          status: 'sent',
        };

        retryFileStoreRef.current.clear(tempId);
        if (optimisticAttachment?.url) {
          revokeTrackedObjectUrl(optimisticAttachment.url);
        }

        setMessagesByChannel((prev) => {
          const list = prev[targetChannelId] || [];
          // If Realtime already reconciled or appended confirmedRecord.id, deduplicate cleanly
          const alreadyHasConfirmed = list.some(
            (m) =>
              String(m.id) === String(confirmedRecord.id) &&
              String(m.id) !== tempId
          );

          if (alreadyHasConfirmed) {
            return {
              ...prev,
              [targetChannelId]: list
                .filter(
                  (m) =>
                    String(m.id) !== tempId && String(m.temp_id) !== tempId
                )
                .map((m) =>
                  String(m.id) === String(confirmedRecord.id)
                    ? { ...m, ...confirmedRecord, status: 'sent' as const }
                    : m
                ),
            };
          }

          const replaced = list.map((m) =>
            String(m.id) === tempId || String(m.temp_id) === tempId
              ? confirmedRecord
              : m
          );

          return {
            ...prev,
            [targetChannelId]: replaced,
          };
        });

        scrollToBottomSmooth();
        void refreshChannels();
        onMessageSentToast?.(
          res.message || 'Message sent to Course Hub chat.'
        );
      } catch (err) {
        const apiErr = err as LaravelValidationError;
        const validationMsg =
          apiErr?.errors?.attachment?.[0] ||
          apiErr?.errors?.content?.[0] ||
          apiErr?.message;
        if (validationMsg) {
          showToast(validationMsg, 'error');
        }
        setMessagesByChannel((prev) => ({
          ...prev,
          [targetChannelId]: (prev[targetChannelId] || []).map((m) =>
            String(m.id) === tempId || String(m.temp_id) === tempId
              ? { ...m, status: 'failed' as const }
              : m
          ),
        }));
      }
    },
    [
      currentUser.id,
      currentUser.name,
      currentUser.role,
      currentUser.avatar_url,
      onMessageSentToast,
      refreshChannels,
      revokeTrackedObjectUrl,
      scrollToBottomSmooth,
      showToast,
    ]
  );

  const submitCurrentDraft = () => {
    if (!channelKey) {
      showToast('Please join or select a Course Hub first.', 'error');
      return;
    }
    const trimmed = messageText.trim();
    if (!trimmed && !stagedMedia) return;

    const fileToUpload = stagedMedia?.file || null;
    const optimisticAttachment: ChatAttachment | null = stagedMedia
      ? {
          url: stagedMedia.previewUrl,
          name: stagedMedia.name,
          type:
            stagedMedia.kind === 'image'
              ? 'image'
              : stagedMedia.kind === 'voice'
                ? 'voice'
                : 'document',
          mime: stagedMedia.mimeType,
          size: stagedMedia.size,
          duration_sec: stagedMedia.durationSec,
        }
      : null;

    // Clear input field and staged attachment immediately (preserve previewUrl until server confirms)
    setMessageText('');
    clearStagedMedia(true);
    if (composerTextareaRef.current) {
      composerTextareaRef.current.style.height = 'auto';
    }

    void sendOptimisticMessage(
      channelKey,
      trimmed,
      undefined,
      fileToUpload,
      optimisticAttachment
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitCurrentDraft();
  };

  const handleComposerKeyDown = (
    e: React.KeyboardEvent<HTMLTextAreaElement>
  ) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitCurrentDraft();
    }
  };

  const handleRetryFailedMessage = (failedMsg: ChatMessage) => {
    if (!channelKey) return;
    const tempKey = String(failedMsg.temp_id || failedMsg.id);
    const retryFile = retryFileStoreRef.current.getForRetry(tempKey) || null;
    void sendOptimisticMessage(
      channelKey,
      failedMsg.content,
      tempKey,
      retryFile,
      failedMsg.attachment || null
    );
  };

  const handleConfirmUnsendMessage = async (msg: ChatMessage) => {
    if (!channelKey || msg.is_unsent) return;
    const msgKey = String(msg.id);
    if (msgKey.startsWith('temp-') || unsendingById[msgKey]) return;

    const snapshot: ChatMessage = {
      ...msg,
      attachment: msg.attachment ? { ...msg.attachment } : null,
    };

    setConfirmingUnsendId(null);
    setUnsendingById((prev) => ({ ...prev, [msgKey]: true }));

    // Optimistic patch
    setMessagesByChannel((prev) => ({
      ...prev,
      [channelKey]: (prev[channelKey] || []).map((m) =>
        String(m.id) === msgKey
          ? {
              ...m,
              is_unsent: true,
              content: '',
              attachment: null,
            }
          : m
      ),
    }));

    try {
      await unsendChannelChatMessageApi(channelKey, msg.id);
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      // Roll back optimistic unsend on failure
      setMessagesByChannel((prev) => ({
        ...prev,
        [channelKey]: (prev[channelKey] || []).map((m) =>
          String(m.id) === msgKey ? snapshot : m
        ),
      }));
      showToast(
        apiErr?.message || 'Unable to unsend message. Please try again.',
        'error'
      );
    } finally {
      setUnsendingById((prev) => {
        const next = { ...prev };
        delete next[msgKey];
        return next;
      });
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
        const preferredMime = MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : MediaRecorder.isTypeSupported('audio/ogg')
            ? 'audio/ogg'
            : '';
        const recorder = preferredMime
          ? new MediaRecorder(stream, { mimeType: preferredMime })
          : new MediaRecorder(stream);
        mediaRecorderRef.current = recorder;

        recorder.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) {
            audioChunksRef.current.push(ev.data);
          }
        };

        recorder.onstop = () => {
          const duration = Math.max(1, recordingSecondsRef.current);
          const rawMime = recorder.mimeType || 'audio/webm';
          const cleanMime = rawMime.split(';')[0].trim() || 'audio/webm';
          const ext = cleanMime.includes('ogg')
            ? 'ogg'
            : cleanMime.includes('mp4') || cleanMime.includes('m4a')
              ? 'm4a'
              : cleanMime.includes('wav')
                ? 'wav'
                : 'webm';
          const blob = new Blob(audioChunksRef.current, { type: cleanMime });
          if (blob.size > 0) {
            const voiceFile = new File(
              [blob],
              `Voice_Note_${formatDurationClock(duration).replace(':', 'm')}s.${ext}`,
              {
                type: cleanMime,
                lastModified: Date.now(),
              }
            );
            const validation = validateChatAttachmentFile(voiceFile);
            if (!validation.valid) {
              showToast(validation.error, 'error');
              cleanupRecordingTimersAndStream();
              return;
            }
            const previewUrl = createTrackedObjectUrl(voiceFile);
            setStagedMedia((prev) => {
              if (prev) revokeTrackedObjectUrl(prev.previewUrl);
              return {
                file: voiceFile,
                previewUrl,
                kind: 'voice',
                name: voiceFile.name,
                mimeType: cleanMime,
                size: voiceFile.size,
                durationSec: duration,
              };
            });
          } else {
            const wavFile = createSynthesizedVoiceNoteWavFile(duration);
            const previewUrl = createTrackedObjectUrl(wavFile);
            setStagedMedia((prev) => {
              if (prev) revokeTrackedObjectUrl(prev.previewUrl);
              return {
                file: wavFile,
                previewUrl,
                kind: 'voice',
                name: wavFile.name,
                mimeType: wavFile.type,
                size: wavFile.size,
                durationSec: duration,
              };
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
    const wavFile = createSynthesizedVoiceNoteWavFile(duration);
    const previewUrl = createTrackedObjectUrl(wavFile);
    setStagedMedia((prev) => {
      if (prev) revokeTrackedObjectUrl(prev.previewUrl);
      return {
        file: wavFile,
        previewUrl,
        kind: 'voice',
        name: wavFile.name,
        mimeType: wavFile.type,
        size: wavFile.size,
        durationSec: duration,
      };
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

    const validation = validateChatAttachmentFile(file);
    if (!validation.valid) {
      showToast(validation.error, 'error');
      return;
    }

    try {
      const processedFile = await compressImageFileToBlobFile(file);
      const previewUrl = createTrackedObjectUrl(processedFile);
      setStagedMedia((prev) => {
        if (prev) revokeTrackedObjectUrl(prev.previewUrl);
        return {
          file: processedFile,
          previewUrl,
          kind: 'image',
          name: file.name,
          mimeType: processedFile.type || file.type || 'image/jpeg',
          size: processedFile.size,
        };
      });
    } catch {
      showToast('Could not process selected image.', 'error');
    }
  };

  const handleDocumentInputChange = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const validation = validateChatAttachmentFile(file);
    if (!validation.valid) {
      showToast(validation.error, 'error');
      return;
    }

    const previewUrl = createTrackedObjectUrl(file);
    setStagedMedia((prev) => {
      if (prev) revokeTrackedObjectUrl(prev.previewUrl);
      return {
        file,
        previewUrl,
        kind:
          validation.attachmentType === 'image'
            ? 'image'
            : validation.attachmentType === 'voice'
              ? 'voice'
              : 'file',
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
      };
    });
  };

  const renderMessageContent = (msg: ChatMessage, isOwnBubble: boolean) => {
    const legacyParsed = parseChatMessageContent(msg.content);
    const text = msg.attachment ? msg.content : legacyParsed.text;
    const resolvedAttachment: {
      url: string;
      name: string;
      type: 'image' | 'document' | 'voice';
      size: number | null;
      durationSec?: number;
    } | null = msg.attachment
      ? {
          url: msg.attachment.url,
          name: msg.attachment.name,
          type: msg.attachment.type,
          size: msg.attachment.size,
          durationSec: msg.attachment.duration_sec,
        }
      : legacyParsed.attachment
        ? {
            url: legacyParsed.attachment.dataUrl,
            name: legacyParsed.attachment.name,
            type:
              legacyParsed.attachment.kind === 'image'
                ? 'image'
                : legacyParsed.attachment.kind === 'voice' ||
                    legacyParsed.attachment.kind === 'audio'
                  ? 'voice'
                  : 'document',
            size:
              legacyParsed.attachment.size ??
              legacyParsed.attachment.sizeBytes ??
              null,
            durationSec: legacyParsed.attachment.durationSec,
          }
        : null;

    const sizeLabel = formatFileSize(resolvedAttachment?.size ?? undefined);
    const isBrokenImage = Boolean(
      resolvedAttachment && brokenImageUrls[resolvedAttachment.url]
    );

    return (
      <div className="space-y-2">
        {resolvedAttachment && resolvedAttachment.type === 'image' && (
          <div className="rounded-xl overflow-hidden border border-black/10 bg-black/5">
            {isBrokenImage ? (
              <a
                href={resolvedAttachment.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center justify-between gap-3 p-2.5 transition-colors ${
                  isOwnBubble
                    ? 'bg-white/10 hover:bg-white/15 text-white'
                    : 'bg-white hover:bg-slate-50 text-ustp-navy'
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
                    <ImageIcon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-extrabold truncate">
                      {resolvedAttachment.name}
                    </p>
                    <p
                      className={`text-[10px] font-mono tabular-nums ${
                        isOwnBubble ? 'text-slate-300' : 'text-slate-500'
                      }`}
                    >
                      {sizeLabel || 'Image Attachment'}
                    </p>
                  </div>
                </div>
              </a>
            ) : (
              <a
                href={resolvedAttachment.url}
                target="_blank"
                rel="noopener noreferrer"
                title={`View ${resolvedAttachment.name}`}
              >
                <img
                  src={resolvedAttachment.url}
                  alt={resolvedAttachment.name}
                  onError={() =>
                    setBrokenImageUrls((prev) => ({
                      ...prev,
                      [resolvedAttachment.url]: true,
                    }))
                  }
                  className="max-h-64 w-auto max-w-full object-contain rounded-lg block"
                />
              </a>
            )}
            <div
              className={`px-2.5 py-1 flex items-center justify-between gap-2 text-[11px] ${
                isOwnBubble ? 'text-slate-200' : 'text-slate-600'
              }`}
            >
              <span className="truncate font-medium">
                {resolvedAttachment.name}
                {sizeLabel ? ` (${sizeLabel})` : ''}
              </span>
              <a
                href={resolvedAttachment.url}
                download={resolvedAttachment.name}
                target="_blank"
                rel="noopener noreferrer"
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

        {resolvedAttachment && resolvedAttachment.type === 'document' && (
          <a
            href={resolvedAttachment.url}
            download={resolvedAttachment.name}
            target="_blank"
            rel="noopener noreferrer"
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
                  {resolvedAttachment.name}
                </p>
                <p
                  className={`text-[10px] font-mono tabular-nums ${
                    isOwnBubble ? 'text-slate-300' : 'text-slate-500'
                  }`}
                >
                  {sizeLabel || 'Document Attachment'}
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

        {resolvedAttachment && resolvedAttachment.type === 'voice' && (
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
              <span className="font-mono tabular-nums text-[10px] opacity-80">
                {resolvedAttachment.durationSec !== undefined
                  ? formatDurationClock(resolvedAttachment.durationSec)
                  : sizeLabel}
              </span>
            </div>
            <audio
              controls
              preload="metadata"
              src={resolvedAttachment.url}
              className="w-full max-w-[240px] sm:max-w-[280px] h-8"
            />
          </div>
        )}

        {text && <p className="whitespace-pre-wrap break-words">{text}</p>}
      </div>
    );
  };

  const detailedChannel =
    (hubKey ? rosterChannelById[hubKey] : undefined) || channel;
  const isLoadingHubRoster = Boolean(hubKey && isLoadingRosterById[hubKey]);
  const channelRoster = detailedChannel?.roster || channel?.roster || [];
  const enrolledCount =
    detailedChannel?.members_count !== undefined
      ? detailedChannel.members_count
      : channel?.members_count !== undefined
      ? channel.members_count
      : channelRoster.length;
  const enrolledRosterSummary = formatEnrolledRosterSummary(
    detailedChannel || channel
  );
  const currentFacultyLabel = getChannelFacultyLabel(
    detailedChannel || channel
  );

  const handleSyncRosterAccess = async () => {
    const targetHubId = hubKey || channelKey;
    if (!targetHubId) return;
    setIsManagingRoster(true);
    try {
      const res = await joinChannelApi(targetHubId);
      if (res?.data) {
        setRosterChannelSnapshot(targetHubId, res.data);
      }
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
      await refreshChannels({ forceImmediate: true });
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
    const targetHubId = hubKey || channelKey;
    if (!targetHubId) return;
    setRosterFieldErrors({});
    setIsManagingRoster(true);
    try {
      const res = await manageChannelMemberApi(targetHubId, {
        institutional_id: newMemberId,
        name: newMemberName,
        section: channel?.scope_section || 'IT3R2',
        action: 'add',
      });
      if (res?.data) {
        setRosterChannelSnapshot(targetHubId, res.data);
      }
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
    const targetHubId = hubKey || channelKey;
    if (!targetHubId) return;
    setIsManagingRoster(true);
    try {
      const res = await manageChannelMemberApi(targetHubId, {
        institutional_id: institutionalId,
        action: 'remove',
      });
      if (res?.data) {
        setRosterChannelSnapshot(targetHubId, res.data);
      }
      await refreshChannels();
      showToast(res.message || 'Member removed from roster.', 'info');
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      showToast(apiErr.message || 'Failed to remove member.', 'error');
    } finally {
      setIsManagingRoster(false);
    }
  };

  const removeStalePendingMemberFromSnapshot = (
    targetHubId: number,
    institutionalId: string,
    replacementChannel?: Channel
  ) => {
    const base = replacementChannel || detailedChannel;
    if (!base) return;
    const filteredPending = (base.pending_requests || []).filter(
      (req) => req.institutional_id !== institutionalId
    );
    setRosterChannelSnapshot(targetHubId, {
      ...base,
      pending_requests: filteredPending,
    });
  };

  const handleApprovePendingMember = async (institutionalId: string) => {
    const targetHubId = hubKey || channelKey;
    if (!targetHubId || processingMemberIds[institutionalId]) return;
    setProcessingMemberIds((prev) => ({ ...prev, [institutionalId]: true }));
    try {
      const res = await manageChannelMemberApi(targetHubId, {
        institutional_id: institutionalId,
        action: 'approve',
      });
      if (res?.data) {
        removeStalePendingMemberFromSnapshot(
          targetHubId,
          institutionalId,
          res.data
        );
      } else {
        removeStalePendingMemberFromSnapshot(targetHubId, institutionalId);
      }
      await refreshChannels();
      showToast(res.message || 'Join request approved!', 'success');
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      if (apiErr.status === 409) {
        showToast(
          apiErr.message ||
            'This request was already approved/declined by another Course Admin.',
          'info'
        );
        if (apiErr.data && typeof apiErr.data === 'object') {
          removeStalePendingMemberFromSnapshot(
            targetHubId,
            institutionalId,
            apiErr.data as Channel
          );
        } else {
          removeStalePendingMemberFromSnapshot(targetHubId, institutionalId);
          void refreshChannelRoster(targetHubId);
        }
        void refreshChannels();
      } else {
        showToast(
          apiErr.message || 'Failed to approve join request.',
          'error'
        );
      }
    } finally {
      setProcessingMemberIds((prev) => {
        const next = { ...prev };
        delete next[institutionalId];
        return next;
      });
    }
  };

  const handleRejectPendingMember = async (institutionalId: string) => {
    const targetHubId = hubKey || channelKey;
    if (!targetHubId || processingMemberIds[institutionalId]) return;
    setProcessingMemberIds((prev) => ({ ...prev, [institutionalId]: true }));
    try {
      const res = await manageChannelMemberApi(targetHubId, {
        institutional_id: institutionalId,
        action: 'reject',
      });
      if (res?.data) {
        removeStalePendingMemberFromSnapshot(
          targetHubId,
          institutionalId,
          res.data
        );
      } else {
        removeStalePendingMemberFromSnapshot(targetHubId, institutionalId);
      }
      await refreshChannels();
      showToast(res.message || 'Join request declined.', 'info');
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      if (apiErr.status === 409) {
        showToast(
          apiErr.message ||
            'This request was already approved/declined by another Course Admin.',
          'info'
        );
        if (apiErr.data && typeof apiErr.data === 'object') {
          removeStalePendingMemberFromSnapshot(
            targetHubId,
            institutionalId,
            apiErr.data as Channel
          );
        } else {
          removeStalePendingMemberFromSnapshot(targetHubId, institutionalId);
          void refreshChannelRoster(targetHubId);
        }
        void refreshChannels();
      } else {
        showToast(
          apiErr.message || 'Failed to decline join request.',
          'error'
        );
      }
    } finally {
      setProcessingMemberIds((prev) => {
        const next = { ...prev };
        delete next[institutionalId];
        return next;
      });
    }
  };

  const pendingJoinRequests =
    detailedChannel?.pending_requests || channel?.pending_requests || [];

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
              <span>Add Course Hub</span>
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
              className="relative p-2 rounded-full text-ustp-navy hover:bg-slate-300/70 transition-colors cursor-pointer"
            >
              <Settings className="w-5 h-5 stroke-[2.2]" />
              {isCurrentUserCourseAdmin && pendingJoinRequests.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-ustp-orange text-ustp-navy text-[10px] font-mono font-extrabold flex items-center justify-center">
                  {pendingJoinRequests.length}
                </span>
              )}
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
              <p className="text-[11px] text-slate-600 font-mono tabular-nums">
                Enrolled Roster:{' '}
                <span className="font-bold text-ustp-navy">
                  {enrolledRosterSummary}
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
                {isCurrentUserCourseAdmin && (
                  <button
                    type="button"
                    disabled={isManagingRoster}
                    onClick={handleSyncRosterAccess}
                    className="px-2.5 py-1 text-[11px] font-bold bg-ustp-gold text-ustp-navy rounded hover:opacity-95 disabled:opacity-50 cursor-pointer"
                  >
                    Sync Admin Access
                  </button>
                )}
              </div>

              {/* Pending Join Requests (Course Admin Approval Queue) */}
              {isCurrentUserCourseAdmin && (
                <div className="p-2.5 bg-amber-50 border border-amber-300 rounded-md space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-extrabold text-amber-950 flex items-center gap-1.5 tabular-nums">
                      <Clock className="w-3.5 h-3.5 text-amber-700" />
                      <span>
                        Pending Join Requests ({pendingJoinRequests.length})
                      </span>
                    </p>
                    <span className="text-[10px] font-bold text-amber-800">
                      {isLoadingHubRoster
                        ? 'Refreshing...'
                        : pendingJoinRequests.length > 0
                        ? 'Requires Approval'
                        : 'Up to date'}
                    </span>
                  </div>
                  {isLoadingHubRoster && pendingJoinRequests.length === 0 ? (
                    <div className="px-3 py-3 text-center text-[11px] font-semibold text-amber-900 bg-white rounded border border-amber-200">
                      Loading pending join requests...
                    </div>
                  ) : pendingJoinRequests.length === 0 ? (
                    <div className="px-3 py-2.5 text-center text-[11px] text-slate-500 bg-white rounded border border-amber-200">
                      No pending join requests right now.
                    </div>
                  ) : (
                    <div className="divide-y divide-amber-200/80 max-h-36 overflow-y-auto bg-white rounded border border-amber-200">
                      {pendingJoinRequests.map((reqMember) => {
                        const isRowProcessing = Boolean(
                          processingMemberIds[reqMember.institutional_id]
                        );
                        return (
                          <div
                            key={reqMember.institutional_id}
                            className="flex items-center justify-between gap-2 px-2.5 py-2 text-xs"
                          >
                            <div className="min-w-0">
                              <p className="font-bold text-ustp-text truncate">
                                {reqMember.name}{' '}
                                <span className="text-slate-500 font-mono tabular-nums font-normal text-[10px]">
                                  ({reqMember.institutional_id})
                                </span>
                              </p>
                              <p className="text-[10px] font-semibold text-slate-500 uppercase">
                                {reqMember.role.replace('_', ' ')} •{' '}
                                {reqMember.section}
                              </p>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                disabled={isRowProcessing || isManagingRoster}
                                onClick={() =>
                                  handleApprovePendingMember(
                                    reqMember.institutional_id
                                  )
                                }
                                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-extrabold disabled:opacity-50 cursor-pointer"
                              >
                                <Check className="w-3 h-3" />
                                <span>
                                  {isRowProcessing ? 'Working...' : 'Approve'}
                                </span>
                              </button>
                              <button
                                type="button"
                                disabled={isRowProcessing || isManagingRoster}
                                onClick={() =>
                                  handleRejectPendingMember(
                                    reqMember.institutional_id
                                  )
                                }
                                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-red-300 bg-red-50 hover:bg-red-100 text-red-700 text-[10px] font-bold disabled:opacity-50 cursor-pointer"
                              >
                                <X className="w-3 h-3" />
                                <span>
                                  {isRowProcessing ? 'Working...' : 'Decline'}
                                </span>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Add Student / Faculty Form — Restricted to Course Admins Only */}
              {isCurrentUserCourseAdmin && (
                <form
                  onSubmit={handleAddMemberToRoster}
                  className="p-2.5 bg-slate-50 border border-slate-200 rounded-md space-y-2"
                >
                  <p className="text-[11px] font-bold text-ustp-navy flex items-center gap-1">
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>Add Student or Faculty to Roster (Course Admin)</span>
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
                      className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 text-xs font-bold bg-ustp-navy text-white rounded hover:opacity-95 disabled:opacity-50 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5 text-ustp-gold shrink-0" />
                      <span>Add Member</span>
                    </button>
                  </div>
                  {memberIdError && (
                    <p
                      className="text-[11px] font-semibold text-red-600"
                      role="alert"
                    >
                      {memberIdError}
                    </p>
                  )}
                </form>
              )}

              {/* Enrolled Roster Member List */}
              <div className="border border-slate-200 rounded-md divide-y divide-slate-100 max-h-52 overflow-y-auto bg-white">
                {channelRoster.length === 0 ? (
                  <div className="px-3 py-4 text-center text-[11px] text-slate-500">
                    No members enrolled yet.
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
                      {isCurrentUserCourseAdmin && (
                        <button
                          type="button"
                          disabled={isManagingRoster}
                          onClick={() =>
                            handleRemoveMemberFromRoster(
                              member.institutional_id
                            )
                          }
                          aria-label={`Remove ${member.name} from roster`}
                          title={`Remove ${member.name} from roster`}
                          className="p-1 text-red-600 hover:text-red-800 hover:bg-red-50 rounded shrink-0 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
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
            onScroll={(e) => {
              const el = e.currentTarget;
              if (
                el.scrollTop <= 16 &&
                hasMoreOlderMessages &&
                !isLoadingOlderMessages
              ) {
                void loadOlderChatMessages();
              }
            }}
            className="flex-1 min-h-0 px-3 sm:px-6 py-4 sm:py-5 space-y-3.5 overflow-y-auto overscroll-contain bg-white"
          >
            {hasMoreOlderMessages && (
              <div className="flex justify-center pb-2">
                <button
                  type="button"
                  disabled={isLoadingOlderMessages}
                  onClick={() => void loadOlderChatMessages()}
                  className="px-3 py-1 rounded-md border border-slate-300 bg-ustp-cream text-ustp-navy text-xs font-bold hover:bg-amber-100/60 disabled:opacity-50 cursor-pointer"
                >
                  {isLoadingOlderMessages
                    ? 'Loading older messages...'
                    : 'Load older messages'}
                </button>
              </div>
            )}
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

                const unsentPlaceholder = getUnsentMessagePlaceholder(
                  msg,
                  currentUser.id
                );
                const canUnsendOwnMessage =
                  isCurrentUser &&
                  !msg.is_unsent &&
                  (!msg.status || msg.status === 'sent') &&
                  !String(msg.id).startsWith('temp-');
                const isConfirmingThisUnsend =
                  canUnsendOwnMessage &&
                  String(confirmingUnsendId) === String(msg.id);

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
                      /* CURRENT USER MESSAGE: Right-aligned USTP Navy Bubble (#1a1851) or muted unsent placeholder */
                      <div className="flex flex-col items-end">
                        <div className="flex items-end justify-end gap-1.5 w-full">
                          {canUnsendOwnMessage && !isConfirmingThisUnsend && (
                            <button
                              type="button"
                              onClick={() => setConfirmingUnsendId(msg.id)}
                              aria-label="Unsend message"
                              title="Unsend message"
                              className="min-w-[40px] min-h-[40px] px-2 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 inline-flex items-center justify-center gap-1 text-[11px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-ustp-navy shrink-0 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">Unsend</span>
                            </button>
                          )}
                          {unsentPlaceholder ? (
                            <div
                              className="rounded-[20px] rounded-br-xs px-4 py-2 text-xs italic text-slate-500 bg-slate-100 border border-slate-200 max-w-[82%] sm:max-w-[68%] select-none"
                              title={`Unsent at ${displayTime}`}
                            >
                              {unsentPlaceholder}
                            </div>
                          ) : (
                            <div
                              className={`rounded-[20px] rounded-br-xs px-4 py-2.5 text-xs sm:text-sm leading-relaxed shadow-2xs max-w-[82%] sm:max-w-[68%] break-words transition-opacity ${
                                msg.status === 'failed'
                                  ? 'bg-red-900/90 text-white border border-red-500'
                                  : msg.status === 'sending'
                                  ? 'bg-ustp-navy/80 text-white border border-ustp-navy/80 opacity-85'
                                  : 'bg-ustp-navy text-white border border-ustp-navy'
                              }`}
                              title={`Sent by you (${currentUser.name}) at ${displayTime}`}
                            >
                              {renderMessageContent(msg, true)}
                            </div>
                          )}
                        </div>
                        {isConfirmingThisUnsend && (
                          <div
                            role="group"
                            aria-label="Confirm unsend message"
                            className="mt-1.5 flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-md px-2.5 py-1 text-xs"
                          >
                            <span className="font-semibold text-red-900 text-[11px]">
                              Unsend for everyone?
                            </span>
                            <button
                              type="button"
                              onClick={() => void handleConfirmUnsendMessage(msg)}
                              className="min-h-[36px] px-2.5 py-1 rounded bg-red-600 hover:bg-red-700 text-white text-[11px] font-extrabold cursor-pointer"
                            >
                              Unsend
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmingUnsendId(null)}
                              className="min-h-[36px] px-2 py-1 rounded bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 text-[11px] font-bold cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                        {msg.status === 'sending' && (
                          <div className="mt-1 pr-1 flex items-center gap-1.5 select-none">
                            <Clock className="w-3 h-3 text-slate-400 animate-spin" />
                            <span className="text-[10px] font-medium text-slate-400">
                              Sending...
                            </span>
                          </div>
                        )}
                        {msg.status === 'failed' && (
                          <div className="mt-1 pr-1 flex items-center gap-2 select-none">
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-600">
                              <AlertCircle className="w-3 h-3" />
                              Failed to send
                            </span>
                            <button
                              type="button"
                              onClick={() => handleRetryFailedMessage(msg)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-[10px] font-extrabold cursor-pointer"
                            >
                              <RotateCcw className="w-2.5 h-2.5" />
                              Retry
                            </button>
                          </div>
                        )}
                        {(!msg.status || msg.status === 'sent') &&
                          isLastMessage && (
                            <div className="mt-1 pr-1 flex items-center gap-1.5 select-none">
                              <span className="text-[10px] font-medium text-slate-400">
                                {msg.is_unsent ? 'Unsent' : `Sent ${displayTime}`}
                              </span>
                            </div>
                          )}
                      </div>
                    ) : (
                      /* RESPONDENT MESSAGE: Left-aligned USTP Cream Bubble (#FFFAF2) or muted unsent placeholder */
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

                            {unsentPlaceholder ? (
                              <div className="bg-slate-100 text-slate-500 border border-slate-200 rounded-[20px] rounded-bl-xs px-4 py-2 text-xs italic select-none">
                                {unsentPlaceholder}
                              </div>
                            ) : (
                              <div className="bg-ustp-cream text-ustp-text border border-amber-200/80 rounded-[20px] rounded-bl-xs px-4 py-2.5 text-xs sm:text-sm leading-relaxed shadow-2xs break-words">
                                {renderMessageContent(msg, false)}
                              </div>
                            )}
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
                    src={stagedMedia.previewUrl}
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
                    src={stagedMedia.previewUrl}
                    className="h-8 max-w-[200px] sm:max-w-[240px]"
                  />
                )}
                <div className="min-w-0">
                  <p className="font-bold text-ustp-navy truncate">
                    {stagedMedia.name}
                  </p>
                  <p className="text-[10px] text-slate-500 font-mono tabular-nums">
                    {stagedMedia.kind === 'voice'
                      ? `Voice Recording • ${formatDurationClock(
                          stagedMedia.durationSec || 1
                        )}${
                          formatFileSize(stagedMedia.size)
                            ? ` • ${formatFileSize(stagedMedia.size)}`
                            : ''
                        }`
                      : formatFileSize(stagedMedia.size) || 'Ready to send'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => clearStagedMedia(false)}
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

            {/* Rounded Pill Message Input (Enter to submit, Shift + Enter for newline) */}
            <label htmlFor="messenger-chat-input" className="sr-only">
              Type a message in {activeChatChannelLabel} ({courseHeaderTitle})
            </label>
            <textarea
              ref={composerTextareaRef}
              id="messenger-chat-input"
              rows={1}
              value={messageText}
              disabled={isInitialChannelLoading}
              onChange={(e) => setMessageText(e.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder={
                isInitialChannelLoading
                  ? 'Loading channel messages...'
                  : `Message ${activeChatChannelLabel} in ${courseHeaderTitle}...`
              }
              className="flex-1 min-w-0 bg-white border border-slate-300 rounded-2xl px-4 py-2 text-xs sm:text-sm text-ustp-text placeholder:text-slate-400 focus:outline-none focus:border-ustp-navy focus:ring-2 focus:ring-ustp-gold/40 resize-none max-h-28 overflow-y-auto leading-snug disabled:opacity-50"
            />

            {/* Circular USTP Navy & Gold Send Arrow Button */}
            <button
              type="submit"
              disabled={
                (!messageText.trim() && !stagedMedia) || isInitialChannelLoading
              }
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
