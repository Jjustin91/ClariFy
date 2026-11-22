import { Feather } from '@expo/vector-icons';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as WebBrowser from 'expo-web-browser';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  FlatList,
  Image,
  Keyboard,
  type KeyboardEvent,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../context/AuthContext';
import {
  getChannelChatMessagesApi,
  resolveApiAssetUrl,
  sendChannelChatMessageApi,
  unsendChannelChatMessageApi,
} from '../lib/api-client';
import {
  courseChatReducer,
  createInitialCourseChatState,
  getChatMessageActionCapabilities,
  getChatSenderInitial,
  isFacultyChatRole,
  toInvertedChatList,
} from '../lib/chat-reducer';
import {
  buildVoiceRecordingDescriptor,
  formatAudioDuration,
  formatFileSize,
  getUnsentMessagePlaceholder,
  type NativeUploadFile,
  normalizePickedChatImage,
  validateChatAttachmentFile,
} from '../lib/domain-logic';
import { computeDebouncedRefreshDelayMs } from '../lib/realtime-reducer';
import {
  subscribeChannelReverb,
  type ReverbBroadcastPayload,
} from '../lib/reverb-client';
import {
  colors,
  elevation,
  radii,
  spacing,
  touchTarget,
  typography,
} from '../theme';
import type {
  ApiError,
  ChatAttachment,
  ChatMessage,
  ChatSeenByUser,
} from '../types/api';
import { ChatVoicePlayer } from './ChatVoicePlayer';
import { EmptyState, ErrorBanner } from './StateViews';

interface StagedChatMedia {
  uri: string;
  name: string;
  type: string;
  size: number;
  kind: 'image' | 'document' | 'voice';
  durationSec?: number;
}

const CHAT_PAGE_LIMIT = 50;

function formatChatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function ChatSenderAvatar({
  name,
  role,
  avatarUrl,
  size = 'md',
  accessibilityLabel,
}: {
  name: string;
  role: string;
  avatarUrl?: string | null;
  size?: 'md' | 'xs';
  accessibilityLabel?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const isFaculty = isFacultyChatRole(role);
  const initial = getChatSenderInitial(name, role);
  const normalizedUrl = resolveApiAssetUrl(avatarUrl);
  const showImage = Boolean(normalizedUrl && failedUrl !== normalizedUrl);

  return (
    <View
      accessible={Boolean(accessibilityLabel)}
      accessibilityLabel={accessibilityLabel}
      style={[
        size === 'xs' ? styles.avatarXs : styles.avatarMd,
        isFaculty ? styles.avatarFaculty : styles.avatarStudent,
      ]}
    >
      {showImage && normalizedUrl ? (
        <Image
          source={{ uri: normalizedUrl }}
          onError={() => setFailedUrl(normalizedUrl)}
          style={styles.avatarImage}
        />
      ) : (
        <Text
          style={[
            size === 'xs' ? styles.avatarInitialXs : styles.avatarInitialMd,
            isFaculty
              ? styles.avatarInitialFaculty
              : styles.avatarInitialStudent,
          ]}
        >
          {initial}
        </Text>
      )}
    </View>
  );
}

function SeenByAvatarsRow({
  readers,
  alignRight,
}: {
  readers: ChatSeenByUser[];
  alignRight: boolean;
}) {
  if (readers.length === 0) return null;
  const visibleReaders = readers.slice(0, 4);
  const overflowCount = Math.max(0, readers.length - visibleReaders.length);
  const namesSummary = visibleReaders.map((r) => r.name).join(', ');

  return (
    <View
      accessible
      accessibilityLabel={`Seen by ${namesSummary}${overflowCount > 0 ? ` and ${overflowCount} more` : ''}`}
      style={[
        styles.seenByRow,
        alignRight ? styles.seenByRowRight : styles.seenByRowLeft,
      ]}
    >
      <Text style={styles.seenByText}>Seen</Text>
      <View style={styles.seenByAvatarsStack}>
        {visibleReaders.map((reader) => (
          <ChatSenderAvatar
            key={`seen-${reader.id}`}
            name={reader.name}
            role={reader.role}
            avatarUrl={reader.avatar_url}
            size="xs"
          />
        ))}
        {overflowCount > 0 && (
          <View style={styles.seenOverflowBadge}>
            <Text style={styles.seenOverflowText}>+{overflowCount}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function ChatSkeleton() {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading course chat messages"
      style={styles.skeletonWrap}
    >
      {[false, true, false, true, false].map((isOwn, idx) => (
        <View
          key={`chat-skel-${idx}`}
          style={[
            styles.skeletonRow,
            isOwn ? styles.skeletonRowOwn : styles.skeletonRowOther,
          ]}
        >
          {!isOwn && <View style={styles.skeletonAvatar} />}
          <View
            style={[
              styles.skeletonBubble,
              isOwn ? styles.skeletonBubbleOwn : styles.skeletonBubbleOther,
            ]}
          >
            <View style={styles.skeletonLineWide} />
            <View style={styles.skeletonLineShort} />
          </View>
        </View>
      ))}
    </View>
  );
}

export interface CourseHubChatViewProps {
  channelId: number;
  channelTitle: string;
  isFocused: boolean;
}

/**
 * Course Hub Messenger Chat view (`subject_hashtag = '__CHAT__'`).
 * - Cursor pagination (`before`, `limit=50`, `meta.has_more`, `meta.next_before`) with inverted FlatList
 * - Overlap-measured Android keyboard avoidance + iOS KeyboardAvoidingView so composer is never blocked
 * - Sender circular avatars, Faculty/Student role badges, and web-parity Sent/Seen indicators
 * - Messenger-style long-press action menu (Copy Message & Unsend Message) + confirmation modal
 * - Private Reverb subscription `clarify.channel.{id}` active only while focused & AppState === 'active'
 */
export function CourseHubChatView({
  channelId,
  channelTitle,
  isFocused,
}: CourseHubChatViewProps) {
  const insets = useSafeAreaInsets();
  const { user, showToast } = useAuth();
  const [state, dispatch] = useReducer(
    courseChatReducer,
    channelId,
    createInitialCourseChatState
  );

  const [draft, setDraft] = useState('');
  const [stagedMedia, setStagedMedia] = useState<StagedChatMedia | null>(null);
  const [isAttachSheetOpen, setIsAttachSheetOpen] = useState(false);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [activeVoiceId, setActiveVoiceId] = useState<string | null>(null);
  const [lightboxMedia, setLightboxMedia] = useState<{
    url: string;
    name: string;
  } | null>(null);
  const [brokenImageUrls, setBrokenImageUrls] = useState<
    Record<string, boolean>
  >({});
  const [actionMenuTarget, setActionMenuTarget] = useState<ChatMessage | null>(
    null
  );
  const [unsendTarget, setUnsendTarget] = useState<ChatMessage | null>(null);
  const [appActiveEpoch, setAppActiveEpoch] = useState(0);
  const [androidKeyboardOverlap, setAndroidKeyboardOverlap] = useState(0);
  const [iosKeyboardOffset, setIosKeyboardOffset] = useState(96);

  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder, 250);
  const recordingActiveRef = useRef<boolean>(false);
  const retryAttachmentByTempIdRef = useRef<Record<string, NativeUploadFile>>(
    {}
  );

  const rootRef = useRef<React.ComponentRef<typeof View> | null>(null);
  const keyboardTopYRef = useRef<number | null>(null);
  const isAppActiveRef = useRef<boolean>(AppState.currentState === 'active');
  const latestFetchInFlightRef = useRef<Promise<void> | null>(null);
  const olderFetchInFlightRef = useRef<Promise<void> | null>(null);
  const debouncedSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const activeChannelRef = useRef<number>(channelId);

  useEffect(() => {
    activeChannelRef.current = channelId;
  }, [channelId]);

  const recalculateKeyboardBounds = useCallback(() => {
    if (!rootRef.current) return;
    rootRef.current.measureInWindow((_x, y, _width, height) => {
      if (height <= 0) return;
      if (Platform.OS === 'ios') {
        if (y > 0) {
          setIosKeyboardOffset(Math.round(y));
        }
        return;
      }
      if (Platform.OS === 'android') {
        const keyboardTopY = keyboardTopYRef.current;
        if (keyboardTopY === null) {
          setAndroidKeyboardOverlap(0);
          return;
        }
        const rootBottomY = y + height;
        const overlap = Math.max(0, Math.round(rootBottomY - keyboardTopY));
        setAndroidKeyboardOverlap(overlap);
      }
    });
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    const showSub = Keyboard.addListener(
      'keyboardDidShow',
      (event: KeyboardEvent) => {
        keyboardTopYRef.current = event.endCoordinates.screenY;
        recalculateKeyboardBounds();
      }
    );
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      keyboardTopYRef.current = null;
      setAndroidKeyboardOverlap(0);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [recalculateKeyboardBounds]);

  const clearDebouncedSyncTimer = useCallback(() => {
    if (debouncedSyncTimerRef.current) {
      clearTimeout(debouncedSyncTimerRef.current);
      debouncedSyncTimerRef.current = null;
    }
  }, []);

  const fetchLatestChat = useCallback(
    async (mode: 'initial' | 'refresh' | 'silent') => {
      if (channelId <= 0) return;
      if (mode === 'silent' && !isAppActiveRef.current) return;
      if (latestFetchInFlightRef.current) {
        return latestFetchInFlightRef.current;
      }

      if (mode === 'initial') {
        dispatch({ type: 'LOAD_START' });
      } else if (mode === 'refresh') {
        dispatch({ type: 'REFRESH_START' });
      }

      const targetChannelId = channelId;
      const req = (async () => {
        try {
          const res = await getChannelChatMessagesApi(targetChannelId, {
            limit: CHAT_PAGE_LIMIT,
          });
          if (activeChannelRef.current !== targetChannelId) {
            return;
          }
          dispatch({
            type: 'LOAD_SUCCESS',
            messages: Array.isArray(res?.data) ? res.data : [],
            hasMore: Boolean(res?.meta?.has_more),
            nextBefore: res?.meta?.next_before ?? null,
          });
        } catch (err) {
          if (activeChannelRef.current !== targetChannelId) {
            return;
          }
          if (mode !== 'silent') {
            dispatch({ type: 'LOAD_ERROR', error: err as ApiError });
          }
        } finally {
          latestFetchInFlightRef.current = null;
        }
      })();

      latestFetchInFlightRef.current = req;
      return req;
    },
    [channelId]
  );

  const scheduleDebouncedChatSync = useCallback(() => {
    if (!isAppActiveRef.current || !isFocused || channelId <= 0) {
      return;
    }
    if (debouncedSyncTimerRef.current) {
      return;
    }
    const delayMs = computeDebouncedRefreshDelayMs();
    debouncedSyncTimerRef.current = setTimeout(() => {
      debouncedSyncTimerRef.current = null;
      if (!isAppActiveRef.current || !isFocused) {
        return;
      }
      void fetchLatestChat('silent');
    }, delayMs);
  }, [channelId, isFocused, fetchLatestChat]);

  const handleLoadOlder = useCallback(async () => {
    if (
      channelId <= 0 ||
      !state.hasMore ||
      !state.nextBefore ||
      state.isLoading ||
      state.isLoadingOlder ||
      olderFetchInFlightRef.current
    ) {
      return;
    }

    dispatch({ type: 'LOAD_OLDER_START' });
    const targetChannelId = channelId;
    const cursorBefore = state.nextBefore;

    const req = (async () => {
      try {
        const res = await getChannelChatMessagesApi(targetChannelId, {
          before: cursorBefore,
          limit: CHAT_PAGE_LIMIT,
        });
        if (activeChannelRef.current !== targetChannelId) {
          return;
        }
        dispatch({
          type: 'LOAD_OLDER_SUCCESS',
          messages: Array.isArray(res?.data) ? res.data : [],
          hasMore: Boolean(res?.meta?.has_more),
          nextBefore: res?.meta?.next_before ?? null,
        });
      } catch (err) {
        if (activeChannelRef.current !== targetChannelId) {
          return;
        }
        dispatch({ type: 'LOAD_OLDER_ERROR', error: err as ApiError });
      } finally {
        olderFetchInFlightRef.current = null;
      }
    })();

    olderFetchInFlightRef.current = req;
    return req;
  }, [
    channelId,
    state.hasMore,
    state.nextBefore,
    state.isLoading,
    state.isLoadingOlder,
  ]);

  // Reset & initial load when channelId changes
  useEffect(() => {
    clearDebouncedSyncTimer();
    latestFetchInFlightRef.current = null;
    olderFetchInFlightRef.current = null;
    retryAttachmentByTempIdRef.current = {};
    if (recordingActiveRef.current) {
      recordingActiveRef.current = false;
      void audioRecorder
        .stop()
        .catch(() => undefined)
        .finally(() => {
          void setAudioModeAsync({
            allowsRecording: false,
            playsInSilentMode: true,
          }).catch(() => undefined);
          setIsRecordingVoice(false);
        });
    }
    dispatch({ type: 'RESET', channelId });
    if (channelId > 0) {
      void fetchLatestChat('initial');
    }
  }, [channelId, clearDebouncedSyncTimer, fetchLatestChat, audioRecorder]);

  // Pause background refetches & stop active recording when AppState leaves 'active'; run one catch-up fetch on return while focused
  useEffect(() => {
    const sub = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        const nextIsActive = nextState === 'active';
        const wasActive = isAppActiveRef.current;
        isAppActiveRef.current = nextIsActive;

        if (!nextIsActive) {
          clearDebouncedSyncTimer();
          setActiveVoiceId(null);
          if (recordingActiveRef.current) {
            recordingActiveRef.current = false;
            void audioRecorder
              .stop()
              .catch(() => undefined)
              .finally(() => {
                void setAudioModeAsync({
                  allowsRecording: false,
                  playsInSilentMode: true,
                }).catch(() => undefined);
                setIsRecordingVoice(false);
              });
          }
          return;
        }

        if (!wasActive && nextIsActive && isFocused && channelId > 0) {
          setAppActiveEpoch((n) => n + 1);
          void fetchLatestChat('silent');
        }
      }
    );
    return () => {
      sub.remove();
    };
  }, [
    channelId,
    isFocused,
    clearDebouncedSyncTimer,
    fetchLatestChat,
    audioRecorder,
  ]);

  // Ensure any active recording is cleanly stopped on unmount
  useEffect(() => {
    return () => {
      if (recordingActiveRef.current) {
        recordingActiveRef.current = false;
        void audioRecorder.stop().catch(() => undefined);
        void setAudioModeAsync({
          allowsRecording: false,
          playsInSilentMode: true,
        }).catch(() => undefined);
      }
    };
  }, [audioRecorder]);

  // Subscribe to private `clarify.channel.{channelId}` ONLY while screen is focused and app is active
  useEffect(() => {
    if (!isFocused || channelId <= 0 || !isAppActiveRef.current) {
      clearDebouncedSyncTimer();
      return;
    }

    const unsubscribe = subscribeChannelReverb(
      channelId,
      (payload: ReverbBroadcastPayload) => {
        if (
          payload.channel_id &&
          Number(payload.channel_id) !== Number(channelId)
        ) {
          return;
        }

        if (payload.type === 'chat.message') {
          if (payload.message && payload.message.id) {
            dispatch({
              type: 'REALTIME_MESSAGE',
              message: payload.message,
            });
          } else {
            scheduleDebouncedChatSync();
          }
          return;
        }

        if (payload.type === 'chat.message_unsent') {
          const targetMsgId = Number(
            payload.message_id ?? payload.message?.id ?? 0
          );
          if (targetMsgId > 0) {
            dispatch({
              type: 'MARK_UNSENT',
              messageId: targetMsgId,
            });
          } else {
            scheduleDebouncedChatSync();
          }
        }
      }
    );

    return () => {
      clearDebouncedSyncTimer();
      unsubscribe();
    };
  }, [
    channelId,
    isFocused,
    appActiveEpoch,
    clearDebouncedSyncTimer,
    scheduleDebouncedChatSync,
  ]);

  const handleOpenExternalUrl = useCallback(
    async (rawUrl: string) => {
      const resolved = resolveApiAssetUrl(rawUrl);
      if (!resolved) {
        showToast('Unable to open this attachment.', 'error');
        return;
      }
      if (resolved.startsWith('file://') || resolved.startsWith('content://')) {
        showToast(
          'Attachment is still uploading. Try opening once sent.',
          'info'
        );
        return;
      }
      try {
        await WebBrowser.openBrowserAsync(resolved);
      } catch {
        try {
          await Linking.openURL(resolved);
        } catch {
          showToast('Unable to open attachment on this device.', 'error');
        }
      }
    },
    [showToast]
  );

  const handlePickImage = useCallback(
    async (source: 'library' | 'camera') => {
      setIsAttachSheetOpen(false);
      Keyboard.dismiss();

      try {
        if (source === 'camera') {
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (!perm.granted) {
            showToast(
              'Camera permission is required to take a photo.',
              'error'
            );
            return;
          }
        } else {
          const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!perm.granted) {
            showToast(
              'Photo library permission is required to attach images.',
              'error'
            );
            return;
          }
        }

        const result =
          source === 'camera'
            ? await ImagePicker.launchCameraAsync({
                mediaTypes: ['images'],
                quality: 0.85,
                allowsEditing: false,
              })
            : await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                quality: 0.85,
                allowsEditing: false,
              });

        if (result.canceled || !result.assets || result.assets.length === 0) {
          return;
        }

        const asset = result.assets[0];
        const normalized = normalizePickedChatImage({
          uri: asset.uri,
          fileName: asset.fileName,
          mimeType: asset.mimeType,
          fileSize: asset.fileSize,
        });

        const validation = validateChatAttachmentFile({
          name: normalized.name,
          size: normalized.size,
          type: normalized.type,
        });

        if (!validation.valid) {
          showToast(validation.error, 'error');
          return;
        }

        setActiveVoiceId(null);
        setStagedMedia({
          ...normalized,
          kind: validation.attachmentType,
        });
      } catch {
        showToast('Could not select photo. Please try again.', 'error');
      }
    },
    [showToast]
  );

  const handlePickDocument = useCallback(async () => {
    setIsAttachSheetOpen(false);
    Keyboard.dismiss();

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      const fileName = (asset.name || 'document.pdf').trim();
      const mimeType = asset.mimeType || 'application/octet-stream';
      const fileSize =
        typeof asset.size === 'number' && asset.size > 0 ? asset.size : 1024;

      const validation = validateChatAttachmentFile({
        name: fileName,
        size: fileSize,
        type: mimeType,
      });

      if (!validation.valid) {
        showToast(validation.error, 'error');
        return;
      }

      setActiveVoiceId(null);
      setStagedMedia({
        uri: asset.uri,
        name: fileName,
        type: mimeType,
        size: fileSize,
        kind: validation.attachmentType,
      });
    } catch {
      showToast('Could not select document. Please try again.', 'error');
    }
  }, [showToast]);

  const handleStartVoiceRecording = useCallback(async () => {
    if (recordingActiveRef.current) return;
    Keyboard.dismiss();
    setIsAttachSheetOpen(false);
    setActiveVoiceId(null);

    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        showToast(
          'Microphone permission is required to record voice notes.',
          'error'
        );
        return;
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      recordingActiveRef.current = true;
      setIsRecordingVoice(true);
    } catch {
      recordingActiveRef.current = false;
      setIsRecordingVoice(false);
      void setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      }).catch(() => undefined);
      showToast(
        'Could not start voice recording on this device. Please try again.',
        'error'
      );
    }
  }, [audioRecorder, showToast]);

  const handleCancelVoiceRecording = useCallback(async () => {
    if (!recordingActiveRef.current) {
      setIsRecordingVoice(false);
      return;
    }
    recordingActiveRef.current = false;
    setIsRecordingVoice(false);
    try {
      await audioRecorder.stop();
    } catch {
      // Ignore recorder stop errors during cancel
    } finally {
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      }).catch(() => undefined);
    }
  }, [audioRecorder]);

  const handleStopVoiceRecording = useCallback(async () => {
    if (!recordingActiveRef.current) {
      setIsRecordingVoice(false);
      return;
    }

    const preStopStatus = audioRecorder.getStatus();
    const durationMillis =
      recorderState.durationMillis || preStopStatus.durationMillis || 1000;
    const durationSec = Math.max(1, Math.round(durationMillis / 1000));

    recordingActiveRef.current = false;
    setIsRecordingVoice(false);

    try {
      await audioRecorder.stop();
      const postStopStatus = audioRecorder.getStatus();
      const recordedUri = audioRecorder.uri || postStopStatus.url;
      const recordedSize = postStopStatus.fileSize || preStopStatus.fileSize;

      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      }).catch(() => undefined);

      if (!recordedUri) {
        showToast('No audio was captured. Please try recording again.', 'error');
        return;
      }

      const descriptor = buildVoiceRecordingDescriptor({
        uri: recordedUri,
        durationSec,
        fileSize: recordedSize,
      });

      const validation = validateChatAttachmentFile({
        name: descriptor.name,
        size: descriptor.size,
        type: descriptor.type,
      });

      if (!validation.valid) {
        showToast(validation.error, 'error');
        return;
      }

      setStagedMedia({
        uri: descriptor.uri,
        name: descriptor.name,
        type: descriptor.type,
        size: descriptor.size,
        kind: 'voice',
        durationSec: descriptor.durationSec,
      });
    } catch {
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      }).catch(() => undefined);
      showToast('Unable to save voice recording. Please try again.', 'error');
    }
  }, [audioRecorder, recorderState.durationMillis, showToast]);

  const dispatchSendRequest = useCallback(
    async (
      text: string,
      tempId: string,
      attachmentFile?: NativeUploadFile | null
    ) => {
      try {
        const res = await sendChannelChatMessageApi(
          channelId,
          text,
          tempId,
          attachmentFile
        );
        if (activeChannelRef.current !== channelId) {
          return;
        }
        delete retryAttachmentByTempIdRef.current[tempId];
        if (res?.data) {
          dispatch({
            type: 'SEND_SUCCESS',
            tempId,
            message: res.data,
          });
        }
      } catch (err) {
        if (activeChannelRef.current !== channelId) {
          return;
        }
        const apiErr = err as ApiError;
        const firstFieldErr = apiErr?.errors
          ? Object.values(apiErr.errors).flat()[0]
          : undefined;
        dispatch({
          type: 'SEND_FAILED',
          tempId,
          errorMessage:
            firstFieldErr ||
            apiErr?.message ||
            'Unable to send message. Tap Retry to try again.',
        });
      }
    },
    [channelId]
  );

  const handleSend = useCallback(() => {
    const trimmed = draft.trim();
    if ((!trimmed && !stagedMedia) || !user || channelId <= 0 || isRecordingVoice) {
      return;
    }

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const mediaToSend = stagedMedia;
    const uploadDescriptor: NativeUploadFile | null = mediaToSend
      ? {
          uri: mediaToSend.uri,
          name: mediaToSend.name,
          type: mediaToSend.type,
        }
      : null;

    if (uploadDescriptor) {
      retryAttachmentByTempIdRef.current[tempId] = uploadDescriptor;
    }

    const optimisticAttachment: ChatAttachment | null = mediaToSend
      ? {
          url: mediaToSend.uri,
          name: mediaToSend.name,
          type: mediaToSend.kind,
          mime: mediaToSend.type,
          size: mediaToSend.size,
          ...(mediaToSend.durationSec
            ? { duration_sec: mediaToSend.durationSec }
            : {}),
        }
      : null;

    const optimistic: ChatMessage = {
      id: tempId,
      temp_id: tempId,
      channel_id: channelId,
      sender_id: user.id,
      is_unsent: false,
      content: trimmed,
      attachment: optimisticAttachment,
      created_at: new Date().toISOString(),
      status: 'sending',
      author: {
        id: user.id,
        name: user.name,
        role: user.role,
        avatar_url: user.avatar_url ?? null,
      },
    };

    if (activeVoiceId === 'staged-preview') {
      setActiveVoiceId(null);
    }
    setDraft('');
    setStagedMedia(null);
    dispatch({ type: 'OPTIMISTIC_ADD', message: optimistic });
    void dispatchSendRequest(trimmed, tempId, uploadDescriptor);
  }, [
    draft,
    stagedMedia,
    user,
    channelId,
    isRecordingVoice,
    activeVoiceId,
    dispatchSendRequest,
  ]);

  const handleRetryFailed = useCallback(
    (msg: ChatMessage) => {
      const tempId = msg.temp_id || String(msg.id);
      const attachmentFile = retryAttachmentByTempIdRef.current[tempId] ?? null;
      if (!tempId || (!msg.content.trim() && !attachmentFile)) return;
      dispatch({ type: 'RETRY_START', tempId });
      void dispatchSendRequest(msg.content, tempId, attachmentFile);
    },
    [dispatchSendRequest]
  );

  const handleDismissFailed = useCallback((tempId: string) => {
    delete retryAttachmentByTempIdRef.current[tempId];
    dispatch({ type: 'DISMISS_FAILED', tempId });
  }, []);

  const handleCopyActionMessage = useCallback(async () => {
    if (!actionMenuTarget) return;
    const textToCopy = actionMenuTarget.content.trim();
    setActionMenuTarget(null);
    if (!textToCopy) return;
    try {
      await Clipboard.setStringAsync(textToCopy);
      showToast('Message copied to clipboard.', 'info');
    } catch {
      showToast('Unable to copy message.', 'error');
    }
  }, [actionMenuTarget, showToast]);

  const handleRequestUnsendFromMenu = useCallback(() => {
    if (!actionMenuTarget) return;
    const target = actionMenuTarget;
    setActionMenuTarget(null);
    setUnsendTarget(target);
  }, [actionMenuTarget]);

  const handleConfirmUnsend = useCallback(async () => {
    if (!unsendTarget) return;
    const targetId = Number(unsendTarget.id);
    if (!Number.isFinite(targetId) || targetId <= 0) {
      setUnsendTarget(null);
      return;
    }

    setUnsendTarget(null);
    dispatch({ type: 'UNSEND_START', messageId: targetId });

    try {
      const res = await unsendChannelChatMessageApi(channelId, targetId);
      dispatch({
        type: 'MARK_UNSENT',
        messageId: targetId,
        serverMessage: res?.data,
      });
    } catch (err) {
      const apiErr = err as ApiError;
      dispatch({ type: 'UNSEND_ERROR', messageId: targetId });
      showToast(
        apiErr?.message || 'Unable to unsend this message.',
        'error'
      );
    }
  }, [unsendTarget, channelId, showToast]);

  const invertedMessages = useMemo(
    () => toInvertedChatList(state.messages),
    [state.messages]
  );

  const keyExtractor = useCallback(
    (item: ChatMessage) =>
      String(
        item.temp_id && typeof item.id !== 'number' ? item.temp_id : item.id
      ),
    []
  );

  const renderMessage = useCallback(
    ({ item, index }: { item: ChatMessage; index: number }) => {
      const isLatestMessage = index === 0;
      const isOwn =
        Boolean(user?.id) &&
        Number(item.author?.id ?? item.sender_id ?? 0) === Number(user?.id);
      const isSending = item.status === 'sending';
      const isFailed = item.status === 'failed';
      const tempKey = item.temp_id || String(item.id);
      const failedReason = state.failedErrorByTempId[tempKey];
      const unsentPlaceholder = getUnsentMessagePlaceholder(item, user?.id);
      const capabilities = getChatMessageActionCapabilities(item, user);
      const isUnsending =
        typeof item.id === 'number' && state.unsendingIds.includes(item.id);

      const senderName = item.author?.name || 'Campus Member';
      const senderRole = item.author?.role || 'student';
      const isFacultySender = isFacultyChatRole(senderRole);
      const roleLabel = isFacultySender ? 'Faculty' : 'Student';
      const authorAvatarUrl = isOwn
        ? user?.avatar_url || item.author?.avatar_url
        : item.author?.avatar_url;
      const displayTime = formatChatTime(item.created_at);
      const explicitSeenBy = Array.isArray(item.seen_by) ? item.seen_by : [];

      if (isOwn) {
        return (
          <View style={styles.ownMessageColumn}>
            <Pressable
              onLongPress={
                capabilities.canOpenMenu && !isUnsending
                  ? () => {
                      Keyboard.dismiss();
                      setActionMenuTarget(item);
                    }
                  : undefined
              }
              delayLongPress={280}
              accessibilityRole="button"
              accessibilityLabel={`Your message at ${displayTime}`}
              accessibilityHint={
                capabilities.canOpenMenu
                  ? 'Press and hold for Copy or Unsend options'
                  : undefined
              }
              style={({ pressed }) => [
                styles.bubble,
                styles.bubbleOwn,
                item.is_unsent && styles.bubbleUnsent,
                isFailed && styles.bubbleFailed,
                isSending && styles.bubbleSending,
                pressed && capabilities.canOpenMenu && styles.bubblePressed,
              ]}
            >
              {/* Own Header: You + Time */}
              <View style={styles.bubbleMetaRow}>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.authorName,
                    !item.is_unsent
                      ? styles.authorNameOwn
                      : styles.authorNameOther,
                  ]}
                >
                  You
                </Text>
                <Text
                  style={[
                    styles.timestampText,
                    !item.is_unsent
                      ? styles.timestampOwn
                      : styles.timestampOther,
                  ]}
                >
                  {displayTime}
                </Text>
              </View>

              {/* Body or Unsent Placeholder */}
              {unsentPlaceholder ? (
                <Text style={styles.unsentText}>{unsentPlaceholder}</Text>
              ) : (
                <>
                  {item.content.trim().length > 0 && (
                    <Text style={[styles.messageBody, styles.messageBodyOwn]}>
                      {item.content}
                    </Text>
                  )}

                  {item.attachment && (() => {
                    const att = item.attachment;
                    const resolvedUrl = resolveApiAssetUrl(att.url);
                    const isBroken = Boolean(
                      resolvedUrl && brokenImageUrls[resolvedUrl]
                    );

                    if (att.type === 'image' && resolvedUrl && !isBroken) {
                      return (
                        <Pressable
                          onPress={() =>
                            setLightboxMedia({
                              url: resolvedUrl,
                              name: att.name || 'Chat Image',
                            })
                          }
                          onLongPress={
                            capabilities.canOpenMenu && !isUnsending
                              ? () => {
                                  Keyboard.dismiss();
                                  setActionMenuTarget(item);
                                }
                              : undefined
                          }
                          delayLongPress={280}
                          accessibilityRole="button"
                          accessibilityLabel={`View image ${att.name}`}
                          style={({ pressed }) => [
                            styles.imageAttachmentWrap,
                            styles.imageAttachmentOwn,
                            pressed && styles.pressed,
                          ]}
                        >
                          <Image
                            source={{ uri: resolvedUrl }}
                            resizeMode="cover"
                            onError={() =>
                              setBrokenImageUrls((prev) => ({
                                ...prev,
                                [resolvedUrl]: true,
                              }))
                            }
                            style={styles.chatImageThumb}
                          />
                        </Pressable>
                      );
                    }

                    if (att.type === 'voice' && resolvedUrl) {
                      return (
                        <ChatVoicePlayer
                          playerId={`msg-${String(item.id)}`}
                          uri={resolvedUrl}
                          name={att.name}
                          durationHintSec={att.duration_sec}
                          variant="own"
                          activeVoiceId={activeVoiceId}
                          onActivate={setActiveVoiceId}
                          onOpenExternal={handleOpenExternalUrl}
                        />
                      );
                    }

                    const sizeLabel = att.size ? formatFileSize(att.size) : '';
                    return (
                      <Pressable
                        onPress={() =>
                          resolvedUrl
                            ? void handleOpenExternalUrl(resolvedUrl)
                            : undefined
                        }
                        onLongPress={
                          capabilities.canOpenMenu && !isUnsending
                            ? () => {
                                Keyboard.dismiss();
                                setActionMenuTarget(item);
                              }
                            : undefined
                        }
                        delayLongPress={280}
                        accessibilityRole="button"
                        accessibilityLabel={`Open attachment ${att.name}`}
                        style={({ pressed }) => [
                          styles.docAttachmentCard,
                          styles.docAttachmentCardOwn,
                          pressed && styles.pressed,
                        ]}
                      >
                        <View style={styles.docIconWrapOwn}>
                          <Feather
                            name={att.type === 'image' ? 'image' : 'file-text'}
                            size={16}
                            color={colors.ustpGold}
                          />
                        </View>
                        <View style={styles.docMetaCol}>
                          <Text
                            numberOfLines={1}
                            style={[
                              styles.attachmentName,
                              styles.attachmentNameOwn,
                            ]}
                          >
                            {att.name}
                          </Text>
                          <Text style={styles.docMetaSubOwn}>
                            {sizeLabel ? `${sizeLabel} · Tap to open` : 'Tap to open'}
                          </Text>
                        </View>
                        <Feather
                          name="download"
                          size={15}
                          color={colors.ustpGold}
                        />
                      </Pressable>
                    );
                  })()}
                </>
              )}

              {/* Inline Failed Send Controls */}
              {isFailed && (
                <View style={styles.failedActionsBox}>
                  <Text style={styles.failedErrorText}>
                    {failedReason || 'Failed to send.'}
                  </Text>
                  <View style={styles.failedButtonsRow}>
                    <Pressable
                      onPress={() => handleRetryFailed(item)}
                      accessibilityRole="button"
                      accessibilityLabel="Retry sending message"
                      style={({ pressed }) => [
                        styles.failedRetryBtn,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Feather
                        name="refresh-cw"
                        size={13}
                        color={colors.ustpGold}
                      />
                      <Text style={styles.failedRetryText}>Retry</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => handleDismissFailed(tempKey)}
                      accessibilityRole="button"
                      accessibilityLabel="Dismiss failed message"
                      style={({ pressed }) => [
                        styles.failedDismissBtn,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.failedDismissText}>Dismiss</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </Pressable>

            {/* Below-Bubble Status / Seen Receipt Footer */}
            {isSending ? (
              <Text style={styles.ownFooterStatus}>Sending...</Text>
            ) : isUnsending ? (
              <Text style={styles.ownFooterStatus}>Unsending...</Text>
            ) : explicitSeenBy.length > 0 ? (
              <SeenByAvatarsRow readers={explicitSeenBy} alignRight />
            ) : (
              (!item.status || item.status === 'sent') &&
              isLatestMessage && (
                <Text style={styles.ownFooterStatus}>
                  {item.is_unsent ? 'Unsent' : `Sent ${displayTime}`}
                </Text>
              )
            )}
          </View>
        );
      }

      /* OTHER SENDER MESSAGE: Left Circular Avatar + Name/Role Header + Crisp Bubble + Latest Read Indicator */
      return (
        <View style={styles.otherMessageOuter}>
          <View style={styles.otherMessageRow}>
            <View style={styles.otherLeftGroup}>
              <ChatSenderAvatar
                name={senderName}
                role={senderRole}
                avatarUrl={authorAvatarUrl}
                size="md"
                accessibilityLabel={`${senderName}, ${roleLabel}`}
              />

              <View style={styles.otherBubbleColumn}>
                {/* Sender Name + Role Pill + Timestamp */}
                <View style={styles.otherHeaderRow}>
                  <Text numberOfLines={1} style={styles.otherAuthorName}>
                    {senderName}
                  </Text>
                  <View
                    style={[
                      styles.rolePill,
                      isFacultySender
                        ? styles.rolePillFaculty
                        : styles.rolePillStudent,
                    ]}
                  >
                    <Text
                      style={[
                        styles.rolePillText,
                        isFacultySender
                          ? styles.rolePillTextFaculty
                          : styles.rolePillTextStudent,
                      ]}
                    >
                      {roleLabel}
                    </Text>
                  </View>
                  <Text style={styles.otherTimestampText}>{displayTime}</Text>
                </View>

                <Pressable
                  onLongPress={
                    capabilities.canOpenMenu
                      ? () => {
                          Keyboard.dismiss();
                          setActionMenuTarget(item);
                        }
                      : undefined
                  }
                  delayLongPress={280}
                  accessibilityRole="button"
                  accessibilityLabel={`Message from ${senderName} at ${displayTime}`}
                  accessibilityHint={
                    capabilities.canOpenMenu
                      ? 'Press and hold to copy message'
                      : undefined
                  }
                  style={({ pressed }) => [
                    styles.bubble,
                    styles.bubbleOther,
                    item.is_unsent && styles.bubbleUnsent,
                    pressed && capabilities.canOpenMenu && styles.bubblePressed,
                  ]}
                >
                  {unsentPlaceholder ? (
                    <Text style={styles.unsentText}>{unsentPlaceholder}</Text>
                  ) : (
                    <>
                      {item.content.trim().length > 0 && (
                        <Text
                          style={[styles.messageBody, styles.messageBodyOther]}
                        >
                          {item.content}
                        </Text>
                      )}

                      {item.attachment && (() => {
                        const att = item.attachment;
                        const resolvedUrl = resolveApiAssetUrl(att.url);
                        const isBroken = Boolean(
                          resolvedUrl && brokenImageUrls[resolvedUrl]
                        );

                        if (att.type === 'image' && resolvedUrl && !isBroken) {
                          return (
                            <Pressable
                              onPress={() =>
                                setLightboxMedia({
                                  url: resolvedUrl,
                                  name: att.name || 'Chat Image',
                                })
                              }
                              onLongPress={
                                capabilities.canOpenMenu
                                  ? () => {
                                      Keyboard.dismiss();
                                      setActionMenuTarget(item);
                                    }
                                  : undefined
                              }
                              delayLongPress={280}
                              accessibilityRole="button"
                              accessibilityLabel={`View image ${att.name}`}
                              style={({ pressed }) => [
                                styles.imageAttachmentWrap,
                                styles.imageAttachmentOther,
                                pressed && styles.pressed,
                              ]}
                            >
                              <Image
                                source={{ uri: resolvedUrl }}
                                resizeMode="cover"
                                onError={() =>
                                  setBrokenImageUrls((prev) => ({
                                    ...prev,
                                    [resolvedUrl]: true,
                                  }))
                                }
                                style={styles.chatImageThumb}
                              />
                            </Pressable>
                          );
                        }

                        if (att.type === 'voice' && resolvedUrl) {
                          return (
                            <ChatVoicePlayer
                              playerId={`msg-${String(item.id)}`}
                              uri={resolvedUrl}
                              name={att.name}
                              durationHintSec={att.duration_sec}
                              variant="other"
                              activeVoiceId={activeVoiceId}
                              onActivate={setActiveVoiceId}
                              onOpenExternal={handleOpenExternalUrl}
                            />
                          );
                        }

                        const sizeLabel = att.size ? formatFileSize(att.size) : '';
                        return (
                          <Pressable
                            onPress={() =>
                              resolvedUrl
                                ? void handleOpenExternalUrl(resolvedUrl)
                                : undefined
                            }
                            onLongPress={
                              capabilities.canOpenMenu
                                ? () => {
                                    Keyboard.dismiss();
                                    setActionMenuTarget(item);
                                  }
                                : undefined
                            }
                            delayLongPress={280}
                            accessibilityRole="button"
                            accessibilityLabel={`Open attachment ${att.name}`}
                            style={({ pressed }) => [
                              styles.docAttachmentCard,
                              styles.docAttachmentCardOther,
                              pressed && styles.pressed,
                            ]}
                          >
                            <View style={styles.docIconWrapOther}>
                              <Feather
                                name={att.type === 'image' ? 'image' : 'file-text'}
                                size={16}
                                color={colors.ustpNavy}
                              />
                            </View>
                            <View style={styles.docMetaCol}>
                              <Text
                                numberOfLines={1}
                                style={[
                                  styles.attachmentName,
                                  styles.attachmentNameOther,
                                ]}
                              >
                                {att.name}
                              </Text>
                              <Text style={styles.docMetaSubOther}>
                                {sizeLabel
                                  ? `${sizeLabel} · Tap to open`
                                  : 'Tap to open'}
                              </Text>
                            </View>
                            <Feather
                              name="download"
                              size={15}
                              color={colors.ustpNavy}
                            />
                          </Pressable>
                        );
                      })()}
                    </>
                  )}
                </Pressable>
              </View>
            </View>

            {/* Right-side mini read indicator matching clarify-web on latest respondent message */}
            {explicitSeenBy.length === 0 && isLatestMessage && (
              <View style={styles.latestSeenIndicatorWrap}>
                <ChatSenderAvatar
                  name={senderName}
                  role={senderRole}
                  avatarUrl={authorAvatarUrl}
                  size="xs"
                  accessibilityLabel={`Seen at ${displayTime}`}
                />
              </View>
            )}
          </View>

          {explicitSeenBy.length > 0 && (
            <SeenByAvatarsRow readers={explicitSeenBy} alignRight={false} />
          )}
        </View>
      );
    },
    [
      user,
      state.failedErrorByTempId,
      state.unsendingIds,
      brokenImageUrls,
      activeVoiceId,
      handleRetryFailed,
      handleDismissFailed,
      handleOpenExternalUrl,
    ]
  );

  // In an inverted FlatList, ListFooterComponent renders at the visual TOP (older history)
  const renderOlderMessagesHeader = () => {
    if (state.isLoading || state.messages.length === 0) {
      return null;
    }
    if (state.isLoadingOlder) {
      return (
        <View style={styles.olderLoaderRow}>
          <ActivityIndicator size="small" color={colors.ustpNavy} />
          <Text style={styles.olderLoaderText}>Loading older messages...</Text>
        </View>
      );
    }
    if (state.hasMore && state.nextBefore) {
      return (
        <View style={styles.olderActionWrap}>
          <Pressable
            onPress={() => void handleLoadOlder()}
            accessibilityRole="button"
            accessibilityLabel="Load older messages"
            style={({ pressed }) => [
              styles.loadOlderBtn,
              pressed && styles.pressed,
            ]}
          >
            <Feather name="chevron-up" size={16} color={colors.ustpNavy} />
            <Text style={styles.loadOlderText}>Load older messages</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={styles.beginningWrap}>
        <Text style={styles.beginningText}>
          Beginning of {channelTitle} chat history
        </Text>
      </View>
    );
  };

  const canSubmit =
    (draft.trim().length > 0 || stagedMedia !== null) &&
    !isRecordingVoice &&
    !state.isLoading &&
    state.error?.status !== 403;

  const recordingClockLabel = formatAudioDuration(
    Math.floor((recorderState.durationMillis || 0) / 1000)
  );

  const actionMenuCapabilities = actionMenuTarget
    ? getChatMessageActionCapabilities(actionMenuTarget, user)
    : null;

  const composerBottomPadding =
    Platform.OS === 'android' && androidKeyboardOverlap > 0
      ? spacing.sm
      : Math.max(insets.bottom, spacing.sm);

  const chatContent = (
    <View
      style={[
        styles.innerFlex,
        Platform.OS === 'android' && androidKeyboardOverlap > 0
          ? { paddingBottom: androidKeyboardOverlap }
          : null,
      ]}
    >
      {/* State 1: Loading Skeleton */}
      {state.isLoading ? (
        <ChatSkeleton />
      ) : state.error && state.messages.length === 0 ? (
        /* State 2: Full-view Error with Retry (403 / 404 / 500 / Offline) */
        <View style={styles.statePad}>
          <ErrorBanner
            error={state.error}
            onRetry={() => void fetchLatestChat('initial')}
          />
        </View>
      ) : (
        /* States 3 & 4: Empty or Populated Inverted FlatList */
        <View style={styles.listWrap}>
          {state.error && state.messages.length > 0 && (
            <View style={styles.inlineErrorWrap}>
              <ErrorBanner
                error={state.error}
                onRetry={() => void fetchLatestChat('refresh')}
              />
            </View>
          )}

          {invertedMessages.length === 0 ? (
            <View style={styles.statePad}>
              <EmptyState
                title={`No Messages in ${channelTitle} Yet`}
                description="Start the conversation with your classmates and course faculty below."
              />
            </View>
          ) : (
            <FlatList
              data={invertedMessages}
              inverted
              keyExtractor={keyExtractor}
              renderItem={renderMessage}
              ListFooterComponent={renderOlderMessagesHeader}
              contentContainerStyle={styles.listContent}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              onEndReached={() => void handleLoadOlder()}
              onEndReachedThreshold={0.25}
              keyboardShouldPersistTaps="handled"
            />
          )}
        </View>
      )}

      {/* Staged Attachment Preview Strip (above composer) */}
      {state.error?.status !== 403 && stagedMedia && !isRecordingVoice && (
        <View style={styles.stagedBar}>
          {stagedMedia.kind === 'image' ? (
            <View style={styles.stagedRow}>
              <Image
                source={{ uri: stagedMedia.uri }}
                resizeMode="cover"
                style={styles.stagedImageThumb}
              />
              <View style={styles.stagedMetaCol}>
                <Text numberOfLines={1} style={styles.stagedTitle}>
                  {stagedMedia.name}
                </Text>
                <Text style={styles.stagedSubtitle}>
                  Image · {formatFileSize(stagedMedia.size) || 'Ready to send'}
                </Text>
              </View>
            </View>
          ) : stagedMedia.kind === 'voice' ? (
            <ChatVoicePlayer
              playerId="staged-preview"
              uri={stagedMedia.uri}
              name={stagedMedia.name}
              durationHintSec={stagedMedia.durationSec}
              variant="preview"
              activeVoiceId={activeVoiceId}
              onActivate={setActiveVoiceId}
            />
          ) : (
            <View style={styles.stagedRow}>
              <View style={styles.stagedDocIcon}>
                <Feather name="file-text" size={18} color={colors.ustpNavy} />
              </View>
              <View style={styles.stagedMetaCol}>
                <Text numberOfLines={1} style={styles.stagedTitle}>
                  {stagedMedia.name}
                </Text>
                <Text style={styles.stagedSubtitle}>
                  Document · {formatFileSize(stagedMedia.size) || 'Ready to send'}
                </Text>
              </View>
            </View>
          )}

          <Pressable
            onPress={() => {
              if (activeVoiceId === 'staged-preview') {
                setActiveVoiceId(null);
              }
              setStagedMedia(null);
            }}
            accessibilityRole="button"
            accessibilityLabel="Remove staged attachment"
            style={({ pressed }) => [
              styles.stagedRemoveBtn,
              pressed && styles.pressed,
            ]}
          >
            <Feather name="x" size={18} color={colors.mutedSlate} />
          </Pressable>
        </View>
      )}

      {/* Message Composer Bar OR Live Voice Recording Bar (hidden only on 403 forbidden channel) */}
      {state.error?.status !== 403 &&
        (isRecordingVoice ? (
          <View
            style={[
              styles.recordingBar,
              { paddingBottom: composerBottomPadding },
            ]}
          >
            <Pressable
              onPress={() => void handleCancelVoiceRecording()}
              accessibilityRole="button"
              accessibilityLabel="Cancel voice recording"
              style={({ pressed }) => [
                styles.recordingCancelBtn,
                pressed && styles.pressed,
              ]}
            >
              <Feather name="trash-2" size={18} color={colors.dangerBorder} />
            </Pressable>

            <View style={styles.recordingCenter}>
              <View style={styles.recordingPulseDot} />
              <Text style={styles.recordingStatusText}>Recording</Text>
              <Text style={styles.recordingTimerText}>
                {recordingClockLabel}
              </Text>
            </View>

            <Pressable
              onPress={() => void handleStopVoiceRecording()}
              accessibilityRole="button"
              accessibilityLabel="Stop recording and preview voice note"
              style={({ pressed }) => [
                styles.recordingStopBtn,
                pressed && styles.pressed,
              ]}
            >
              <Feather name="square" size={16} color={colors.ustpGold} />
              <Text style={styles.recordingStopText}>Stop</Text>
            </Pressable>
          </View>
        ) : (
          <View
            style={[
              styles.composerBar,
              { paddingBottom: composerBottomPadding },
            ]}
          >
            <Pressable
              onPress={() => {
                Keyboard.dismiss();
                setIsAttachSheetOpen(true);
              }}
              accessibilityRole="button"
              accessibilityLabel="Attach image or document"
              style={({ pressed }) => [
                styles.composerIconBtn,
                pressed && styles.pressed,
              ]}
            >
              <Feather name="plus" size={20} color={colors.ustpNavy} />
            </Pressable>

            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={
                stagedMedia
                  ? 'Add an optional caption...'
                  : `Message ${channelTitle}...`
              }
              placeholderTextColor={colors.placeholder}
              multiline
              maxLength={2000}
              accessibilityLabel={`Message ${channelTitle}`}
              style={styles.composerInput}
            />

            <Pressable
              onPress={() => void handleStartVoiceRecording()}
              accessibilityRole="button"
              accessibilityLabel="Record voice note"
              style={({ pressed }) => [
                styles.composerIconBtn,
                pressed && styles.pressed,
              ]}
            >
              <Feather name="mic" size={19} color={colors.ustpNavy} />
            </Pressable>

            <Pressable
              onPress={handleSend}
              disabled={!canSubmit}
              accessibilityRole="button"
              accessibilityLabel="Send chat message"
              accessibilityState={{ disabled: !canSubmit }}
              style={({ pressed }) => [
                styles.sendButton,
                !canSubmit && styles.sendButtonDisabled,
                pressed && canSubmit && styles.pressed,
              ]}
            >
              <Feather
                name="send"
                size={18}
                color={canSubmit ? colors.ustpGold : colors.placeholder}
              />
            </Pressable>
          </View>
        ))}
    </View>
  );

  return (
    <View
      ref={rootRef}
      style={styles.root}
      onLayout={recalculateKeyboardBounds}
    >
      {Platform.OS === 'ios' ? (
        <KeyboardAvoidingView
          style={styles.innerFlex}
          behavior="padding"
          keyboardVerticalOffset={iosKeyboardOffset}
        >
          {chatContent}
        </KeyboardAvoidingView>
      ) : (
        chatContent
      )}

      {/* Messenger-Style Long-Press Message Action Popup */}
      <Modal
        visible={Boolean(actionMenuTarget)}
        transparent
        animationType="fade"
        onRequestClose={() => setActionMenuTarget(null)}
      >
        <View style={styles.actionSheetBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setActionMenuTarget(null)}
            accessibilityRole="button"
            accessibilityLabel="Close message actions"
          />
          {actionMenuTarget && actionMenuCapabilities && (
            <View
              accessibilityViewIsModal
              style={[
                styles.actionSheetCard,
                { marginBottom: Math.max(insets.bottom, spacing.md) },
              ]}
            >
              {/* Clipped Message Preview */}
              <View style={styles.actionSheetPreview}>
                <View style={styles.actionSheetPreviewMeta}>
                  <Text numberOfLines={1} style={styles.actionSheetSender}>
                    {Number(
                      actionMenuTarget.author?.id ??
                        actionMenuTarget.sender_id ??
                        0
                    ) === Number(user?.id)
                      ? 'You'
                      : actionMenuTarget.author?.name || 'Campus Member'}
                  </Text>
                  <Text style={styles.actionSheetTime}>
                    {formatChatTime(actionMenuTarget.created_at)}
                  </Text>
                </View>
                <Text numberOfLines={2} style={styles.actionSheetSnippet}>
                  {actionMenuTarget.content.trim() ||
                    actionMenuTarget.attachment?.name ||
                    'Attachment'}
                </Text>
              </View>

              {/* Action Buttons */}
              <View style={styles.actionSheetButtons}>
                {actionMenuCapabilities.canCopy && (
                  <Pressable
                    onPress={() => void handleCopyActionMessage()}
                    accessibilityRole="button"
                    accessibilityLabel="Copy message text"
                    style={({ pressed }) => [
                      styles.actionSheetRow,
                      pressed && styles.actionSheetRowPressed,
                    ]}
                  >
                    <Feather name="copy" size={18} color={colors.ustpNavy} />
                    <Text style={styles.actionSheetRowText}>Copy Message</Text>
                  </Pressable>
                )}

                {actionMenuCapabilities.canUnsend && (
                  <Pressable
                    onPress={handleRequestUnsendFromMenu}
                    accessibilityRole="button"
                    accessibilityLabel="Unsend message"
                    style={({ pressed }) => [
                      styles.actionSheetRow,
                      actionMenuCapabilities.canCopy &&
                        styles.actionSheetRowBorder,
                      pressed && styles.actionSheetRowPressed,
                    ]}
                  >
                    <Feather
                      name="trash-2"
                      size={18}
                      color={colors.dangerBorder}
                    />
                    <Text style={styles.actionSheetRowDangerText}>
                      Unsend Message
                    </Text>
                  </Pressable>
                )}
              </View>

              <Pressable
                onPress={() => setActionMenuTarget(null)}
                accessibilityRole="button"
                accessibilityLabel="Cancel message actions"
                style={({ pressed }) => [
                  styles.actionSheetCancelBtn,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.actionSheetCancelText}>Cancel</Text>
              </Pressable>
            </View>
          )}
        </View>
      </Modal>

      {/* Unsend Confirmation Modal */}
      <Modal
        visible={Boolean(unsendTarget)}
        transparent
        animationType="fade"
        onRequestClose={() => setUnsendTarget(null)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setUnsendTarget(null)}
            accessibilityRole="button"
            accessibilityLabel="Cancel unsend backdrop"
          />
          <View accessibilityViewIsModal style={styles.modalCard}>
            <Text style={styles.modalTitle}>Unsend Message?</Text>
            <Text style={styles.modalBody}>
              This removes your message text and any attached media and replaces
              it with an unsent placeholder for everyone in {channelTitle}.
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setUnsendTarget(null)}
                accessibilityRole="button"
                accessibilityLabel="Cancel unsend"
                style={({ pressed }) => [
                  styles.modalCancelBtn,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => void handleConfirmUnsend()}
                accessibilityRole="button"
                accessibilityLabel="Confirm unsend message"
                style={({ pressed }) => [
                  styles.modalConfirmBtn,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.modalConfirmText}>Unsend</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Plus (+) Media Attach Bottom Sheet */}
      <Modal
        visible={isAttachSheetOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsAttachSheetOpen(false)}
      >
        <View style={styles.actionSheetBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setIsAttachSheetOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Close attach menu"
          />
          <View
            accessibilityViewIsModal
            style={[
              styles.actionSheetCard,
              { marginBottom: Math.max(insets.bottom, spacing.md) },
            ]}
          >
            <View style={styles.actionSheetButtons}>
              <View style={styles.attachSheetHeader}>
                <Text style={styles.attachSheetTitle}>Attach to Message</Text>
                <Text style={styles.attachSheetSubtitle}>
                  Images, PDF, Office docs, TXT/CSV/ZIP, or audio up to 10 MB
                </Text>
              </View>

              <Pressable
                onPress={() => void handlePickImage('library')}
                accessibilityRole="button"
                accessibilityLabel="Choose photo from library"
                style={({ pressed }) => [
                  styles.actionSheetRow,
                  styles.actionSheetRowBorder,
                  pressed && styles.actionSheetRowPressed,
                ]}
              >
                <Feather name="image" size={18} color={colors.ustpNavy} />
                <Text style={styles.actionSheetRowText}>Photo Library</Text>
              </Pressable>

              <Pressable
                onPress={() => void handlePickImage('camera')}
                accessibilityRole="button"
                accessibilityLabel="Take photo with camera"
                style={({ pressed }) => [
                  styles.actionSheetRow,
                  styles.actionSheetRowBorder,
                  pressed && styles.actionSheetRowPressed,
                ]}
              >
                <Feather name="camera" size={18} color={colors.ustpNavy} />
                <Text style={styles.actionSheetRowText}>Take Photo</Text>
              </Pressable>

              <Pressable
                onPress={() => void handlePickDocument()}
                accessibilityRole="button"
                accessibilityLabel="Attach document or audio file"
                style={({ pressed }) => [
                  styles.actionSheetRow,
                  styles.actionSheetRowBorder,
                  pressed && styles.actionSheetRowPressed,
                ]}
              >
                <Feather name="file-text" size={18} color={colors.ustpNavy} />
                <Text style={styles.actionSheetRowText}>
                  Document / Audio File
                </Text>
              </Pressable>
            </View>

            <Pressable
              onPress={() => setIsAttachSheetOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="Cancel attach menu"
              style={({ pressed }) => [
                styles.actionSheetCancelBtn,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.actionSheetCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Full-Screen Chat Image Lightbox Modal */}
      <Modal
        visible={Boolean(lightboxMedia)}
        transparent
        animationType="fade"
        onRequestClose={() => setLightboxMedia(null)}
      >
        <View style={styles.lightboxBackdrop}>
          <View
            style={[
              styles.lightboxHeader,
              { paddingTop: Math.max(insets.top, spacing.lg) },
            ]}
          >
            <Text numberOfLines={1} style={styles.lightboxTitle}>
              {lightboxMedia?.name || 'Image Attachment'}
            </Text>
            <Pressable
              onPress={() => setLightboxMedia(null)}
              accessibilityRole="button"
              accessibilityLabel="Close image preview"
              style={({ pressed }) => [
                styles.lightboxCloseBtn,
                pressed && styles.pressed,
              ]}
            >
              <Feather name="x" size={22} color={colors.white} />
            </Pressable>
          </View>

          <View style={styles.lightboxImageStage}>
            {lightboxMedia?.url ? (
              <Image
                source={{ uri: lightboxMedia.url }}
                resizeMode="contain"
                style={styles.lightboxImage}
              />
            ) : null}
          </View>

          {lightboxMedia?.url &&
            !lightboxMedia.url.startsWith('file://') &&
            !lightboxMedia.url.startsWith('content://') && (
              <View
                style={[
                  styles.lightboxFooter,
                  { paddingBottom: Math.max(insets.bottom, spacing.lg) },
                ]}
              >
                <Pressable
                  onPress={() => void handleOpenExternalUrl(lightboxMedia.url)}
                  accessibilityRole="button"
                  accessibilityLabel="Open or download full image"
                  style={({ pressed }) => [
                    styles.lightboxOpenBtn,
                    pressed && styles.pressed,
                  ]}
                >
                  <Feather name="download" size={16} color={colors.ustpNavy} />
                  <Text style={styles.lightboxOpenText}>Open / Download</Text>
                </Pressable>
              </View>
            )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.ustpCream,
  },
  innerFlex: {
    flex: 1,
  },
  listWrap: {
    flex: 1,
  },
  statePad: {
    flex: 1,
    padding: spacing.lg,
    justifyContent: 'center',
  },
  inlineErrorWrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    flexGrow: 1,
  },
  separator: {
    height: spacing.md,
  },

  /* Own Message Layout */
  ownMessageColumn: {
    width: '100%',
    alignItems: 'flex-end',
    gap: 3,
  },
  ownFooterStatus: {
    fontSize: typography.sizes.xxs,
    color: colors.mutedSlate,
    fontWeight: '600',
    paddingRight: spacing.xs,
    ...typography.tabularNums,
  },

  /* Other Sender Message Layout */
  otherMessageOuter: {
    width: '100%',
    gap: 3,
  },
  otherMessageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  otherLeftGroup: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    flexShrink: 1,
    maxWidth: '88%',
  },
  otherBubbleColumn: {
    flexShrink: 1,
    gap: 4,
  },
  otherHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    paddingLeft: 2,
  },
  otherAuthorName: {
    fontSize: typography.sizes.xxs,
    lineHeight: typography.lineHeights.xxs,
    fontWeight: '800',
    color: colors.ustpNavy,
    flexShrink: 1,
  },
  rolePill: {
    borderRadius: radii.sm,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  rolePillFaculty: {
    backgroundColor: colors.ustpNavy,
  },
  rolePillStudent: {
    backgroundColor: colors.ustpGoldSoft,
    borderWidth: 1,
    borderColor: colors.tagMemoBorder,
  },
  rolePillText: {
    fontSize: 10,
    fontWeight: '800',
  },
  rolePillTextFaculty: {
    color: colors.ustpGold,
  },
  rolePillTextStudent: {
    color: colors.ustpNavy,
  },
  otherTimestampText: {
    fontSize: typography.sizes.xxs,
    lineHeight: typography.lineHeights.xxs,
    color: colors.mutedSlate,
    ...typography.tabularNums,
  },
  latestSeenIndicatorWrap: {
    paddingBottom: 2,
    flexShrink: 0,
  },

  /* Sender Avatars */
  avatarMd: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  },
  avatarXs: {
    width: 16,
    height: 16,
    borderRadius: radii.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  },
  avatarFaculty: {
    backgroundColor: colors.ustpNavy,
    borderColor: colors.ustpGold,
  },
  avatarStudent: {
    backgroundColor: colors.ustpGoldSoft,
    borderColor: colors.ustpOrange,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarInitialMd: {
    fontSize: typography.sizes.xs,
    fontWeight: '900',
  },
  avatarInitialXs: {
    fontSize: 8,
    fontWeight: '900',
  },
  avatarInitialFaculty: {
    color: colors.ustpGold,
  },
  avatarInitialStudent: {
    color: colors.ustpNavy,
  },

  /* Seen-By Reader Avatars Row (additive support) */
  seenByRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.xs,
  },
  seenByRowRight: {
    justifyContent: 'flex-end',
  },
  seenByRowLeft: {
    justifyContent: 'flex-start',
    paddingLeft: 40,
  },
  seenByText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.mutedSlate,
  },
  seenByAvatarsStack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  seenOverflowBadge: {
    minWidth: 18,
    height: 16,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seenOverflowText: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.ustpNavy,
    ...typography.tabularNums,
  },

  /* Chat Bubbles */
  bubble: {
    borderRadius: radii.xxl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    gap: spacing.xs,
  },
  bubbleOwn: {
    maxWidth: '82%',
    backgroundColor: colors.ustpNavy,
    borderWidth: 1,
    borderColor: colors.ustpNavy,
    borderBottomRightRadius: radii.sm,
  },
  bubbleOther: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: radii.sm,
  },
  bubbleUnsent: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  bubbleSending: {
    opacity: 0.82,
  },
  bubbleFailed: {
    borderColor: colors.dangerBorder,
    borderWidth: 2,
  },
  bubblePressed: {
    opacity: 0.82,
  },
  bubbleMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  authorName: {
    fontSize: typography.sizes.xxs,
    lineHeight: typography.lineHeights.xxs,
    fontWeight: '800',
    flexShrink: 1,
  },
  authorNameOwn: {
    color: colors.ustpGold,
  },
  authorNameOther: {
    color: colors.ustpNavy,
  },
  timestampText: {
    fontSize: typography.sizes.xxs,
    lineHeight: typography.lineHeights.xxs,
    ...typography.tabularNums,
  },
  timestampOwn: {
    color: colors.ustpNavyMutedText,
  },
  timestampOther: {
    color: colors.mutedSlate,
  },
  messageBody: {
    fontSize: typography.sizes.body,
    lineHeight: typography.lineHeights.body,
  },
  messageBodyOwn: {
    color: colors.white,
  },
  messageBodyOther: {
    color: colors.ustpText,
  },
  unsentText: {
    fontSize: typography.sizes.sm,
    lineHeight: typography.lineHeights.sm,
    fontStyle: 'italic',
    color: colors.mutedSlate,
  },
  imageAttachmentWrap: {
    borderRadius: radii.md,
    overflow: 'hidden',
    borderWidth: 1,
    marginTop: 2,
  },
  imageAttachmentOwn: {
    borderColor: colors.ustpNavyBorder,
    backgroundColor: colors.ustpNavySurface,
  },
  imageAttachmentOther: {
    borderColor: colors.border,
    backgroundColor: colors.surfaceSubtle,
  },
  chatImageThumb: {
    width: 210,
    height: 160,
    backgroundColor: colors.surfaceMuted,
  },
  docAttachmentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: touchTarget.minHeight,
    minWidth: 200,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    borderRadius: radii.md,
    borderWidth: 1,
    marginTop: 2,
  },
  docAttachmentCardOwn: {
    backgroundColor: colors.ustpNavySurface,
    borderColor: colors.ustpNavyBorder,
  },
  docAttachmentCardOther: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
  },
  docIconWrapOwn: {
    width: 32,
    height: 32,
    borderRadius: radii.sm,
    backgroundColor: colors.ustpNavyDark,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  docIconWrapOther: {
    width: 32,
    height: 32,
    borderRadius: radii.sm,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  docMetaCol: {
    flex: 1,
    gap: 1,
  },
  attachmentName: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
  },
  attachmentNameOwn: {
    color: colors.white,
  },
  attachmentNameOther: {
    color: colors.ustpNavy,
  },
  docMetaSubOwn: {
    fontSize: typography.sizes.xxs,
    color: colors.ustpNavyMutedText,
    ...typography.tabularNums,
  },
  docMetaSubOther: {
    fontSize: typography.sizes.xxs,
    color: colors.mutedSlate,
    ...typography.tabularNums,
  },
  failedActionsBox: {
    marginTop: spacing.xs,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.dangerBorder,
    gap: spacing.xs,
  },
  failedErrorText: {
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.dangerBg,
  },
  failedButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  failedRetryBtn: {
    minHeight: touchTarget.minHeight,
    minWidth: touchTarget.minWidth,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    backgroundColor: colors.ustpNavyDark,
    borderWidth: 1,
    borderColor: colors.ustpGold,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  failedRetryText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpGold,
  },
  failedDismissBtn: {
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  failedDismissText: {
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.white,
    textDecorationLine: 'underline',
  },
  olderLoaderRow: {
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  olderLoaderText: {
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.mutedSlate,
  },
  olderActionWrap: {
    paddingBottom: spacing.md,
    alignItems: 'center',
  },
  loadOlderBtn: {
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.ustpNavy,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  loadOlderText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  beginningWrap: {
    paddingBottom: spacing.md,
    alignItems: 'center',
  },
  beginningText: {
    fontSize: typography.sizes.xs,
    fontWeight: '600',
    color: colors.mutedSlate,
  },

  /* Staged Media Preview Bar */
  stagedBar: {
    backgroundColor: colors.ustpCream,
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stagedRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    padding: spacing.xs + 2,
  },
  stagedImageThumb: {
    width: 44,
    height: 44,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceMuted,
  },
  stagedDocIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stagedMetaCol: {
    flex: 1,
    gap: 2,
  },
  stagedTitle: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  stagedSubtitle: {
    fontSize: typography.sizes.xxs,
    color: colors.mutedSlate,
    ...typography.tabularNums,
  },
  stagedRemoveBtn: {
    minWidth: touchTarget.minWidth,
    minHeight: touchTarget.minHeight,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Live Voice Recording Bar */
  recordingBar: {
    backgroundColor: colors.dangerBg,
    borderTopWidth: 1,
    borderColor: colors.urgentCardBorder,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  recordingCancelBtn: {
    minWidth: touchTarget.minWidth,
    minHeight: touchTarget.minHeight,
    borderRadius: radii.md,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.urgentCardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  recordingPulseDot: {
    width: 10,
    height: 10,
    borderRadius: radii.pill,
    backgroundColor: colors.dangerBorder,
  },
  recordingStatusText: {
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.dangerTitle,
  },
  recordingTimerText: {
    fontSize: typography.sizes.body,
    fontWeight: '900',
    color: colors.dangerTitle,
    ...typography.tabularNums,
  },
  recordingStopBtn: {
    minWidth: 84,
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.ustpNavy,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  recordingStopText: {
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.ustpGold,
  },

  /* Composer Bar */
  composerBar: {
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm + 2,
    paddingTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.xs + 2,
  },
  composerIconBtn: {
    minWidth: touchTarget.minWidth,
    minHeight: touchTarget.minHeight,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerInput: {
    flex: 1,
    minHeight: touchTarget.minHeight,
    maxHeight: 120,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.sizes.body,
    lineHeight: typography.lineHeights.body,
    color: colors.ustpText,
  },
  sendButton: {
    minWidth: touchTarget.minWidth,
    minHeight: touchTarget.minHeight,
    borderRadius: radii.md,
    backgroundColor: colors.ustpNavy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },

  /* Attach Sheet & Lightbox */
  attachSheetHeader: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: 2,
  },
  attachSheetTitle: {
    fontSize: typography.sizes.body,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  attachSheetSubtitle: {
    fontSize: typography.sizes.xs,
    color: colors.mutedSlate,
  },
  lightboxBackdrop: {
    flex: 1,
    backgroundColor: colors.ustpText,
    justifyContent: 'space-between',
  },
  lightboxHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.md,
  },
  lightboxTitle: {
    flex: 1,
    fontSize: typography.sizes.sm,
    fontWeight: '700',
    color: colors.white,
  },
  lightboxCloseBtn: {
    minWidth: touchTarget.minWidth,
    minHeight: touchTarget.minHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxImageStage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  lightboxImage: {
    width: '100%',
    height: '100%',
  },
  lightboxFooter: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    alignItems: 'center',
  },
  lightboxOpenBtn: {
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.md,
    backgroundColor: colors.ustpGold,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  lightboxOpenText: {
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.ustpNavy,
  },

  /* Skeleton Loading */
  skeletonWrap: {
    flex: 1,
    padding: spacing.lg,
    justifyContent: 'flex-end',
    gap: spacing.md,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  skeletonRowOwn: {
    justifyContent: 'flex-end',
  },
  skeletonRowOther: {
    justifyContent: 'flex-start',
  },
  skeletonAvatar: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    backgroundColor: colors.skeletonBase,
  },
  skeletonBubble: {
    width: '68%',
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.xs + 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  skeletonBubbleOwn: {
    backgroundColor: colors.skeletonBase,
  },
  skeletonBubbleOther: {
    backgroundColor: colors.white,
  },
  skeletonLineWide: {
    height: 12,
    width: '90%',
    borderRadius: radii.sm,
    backgroundColor: colors.skeletonLight,
  },
  skeletonLineShort: {
    height: 12,
    width: '55%',
    borderRadius: radii.sm,
    backgroundColor: colors.skeletonLight,
  },

  /* Messenger-Style Long-Press Action Popup */
  actionSheetBackdrop: {
    flex: 1,
    backgroundColor: colors.overlayBackdrop,
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.md,
  },
  actionSheetCard: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    gap: spacing.sm,
  },
  actionSheetPreview: {
    backgroundColor: colors.ustpNavy,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.ustpNavyBorder,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    gap: 4,
    ...elevation.overlay,
  },
  actionSheetPreviewMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  actionSheetSender: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpGold,
    flexShrink: 1,
  },
  actionSheetTime: {
    fontSize: typography.sizes.xxs,
    color: colors.ustpNavyMutedText,
    ...typography.tabularNums,
  },
  actionSheetSnippet: {
    fontSize: typography.sizes.sm,
    lineHeight: typography.lineHeights.sm,
    color: colors.white,
  },
  actionSheetButtons: {
    backgroundColor: colors.white,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...elevation.overlay,
  },
  actionSheetRow: {
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  actionSheetRowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionSheetRowPressed: {
    backgroundColor: colors.surfaceSubtle,
  },
  actionSheetRowText: {
    fontSize: typography.sizes.body,
    fontWeight: '700',
    color: colors.ustpNavy,
  },
  actionSheetRowDangerText: {
    fontSize: typography.sizes.body,
    fontWeight: '800',
    color: colors.dangerBorder,
  },
  actionSheetCancelBtn: {
    minHeight: 48,
    backgroundColor: colors.white,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...elevation.overlay,
  },
  actionSheetCancelText: {
    fontSize: typography.sizes.body,
    fontWeight: '800',
    color: colors.mutedSlate,
  },

  /* Unsend Confirmation Modal */
  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.overlayBackdrop,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.md,
    ...elevation.overlay,
  },
  modalTitle: {
    fontSize: typography.sizes.titleSm,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  modalBody: {
    fontSize: typography.sizes.sm,
    lineHeight: typography.lineHeights.sm,
    color: colors.mutedSlate,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  modalCancelBtn: {
    minHeight: touchTarget.minHeight,
    minWidth: touchTarget.minWidth,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelText: {
    fontSize: typography.sizes.sm,
    fontWeight: '700',
    color: colors.ustpText,
  },
  modalConfirmBtn: {
    minHeight: touchTarget.minHeight,
    minWidth: touchTarget.minWidth,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.dangerBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalConfirmText: {
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.white,
  },
  pressed: {
    opacity: 0.85,
  },
});
