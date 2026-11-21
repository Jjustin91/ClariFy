import { Feather } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../context/AuthContext';
import { useChannels } from '../context/ChannelsContext';
import { useOptionalRealtime } from '../context/RealtimeContext';
import {
  createAnnouncementApi,
  resolveApiAssetUrl,
  updateAnnouncementApi,
} from '../lib/api-client';
import {
  buildAnnouncementFormData,
  CAMPUS_DEPARTMENTS,
  CAMPUS_WIDE_AVAILABLE_TAGS,
  canPublishCampusWideAnnouncements,
  formatCourseHubName,
  formatFileSize,
  getFieldValidationError,
  getJoinedCourseHubs,
  getTopLevelCourseHubs,
  parseAnnouncementAttachment,
  validateAnnouncementAttachmentFile,
  type NativeUploadFile,
} from '../lib/domain-logic';
import {
  colors,
  elevation,
  radii,
  spacing,
  touchTarget,
  typography,
} from '../theme';
import type { Announcement, ApiError } from '../types/api';
import { TagPill } from './StateViews';

export type AnnouncementComposerMode = 'campus_wide' | 'course_hub';

export interface AnnouncementFormModalProps {
  visible: boolean;
  mode: AnnouncementComposerMode;
  editingAnnouncement?: Announcement | null;
  defaultChannelId?: number | null;
  allowModeSwitch?: boolean;
  onClose: () => void;
  onSaved?: (announcement?: Announcement) => void;
}

const ACCEPTED_DOCUMENT_MIMES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
];

function inferImageFileName(asset: ImagePicker.ImagePickerAsset): string {
  if (asset.fileName && asset.fileName.trim().length > 0) {
    return asset.fileName.trim();
  }
  const uriSegment = asset.uri.split('/').pop()?.split('?')[0];
  if (uriSegment && /\.(jpg|jpeg|png|webp|gif)$/i.test(uriSegment)) {
    return uriSegment;
  }
  const mime = (asset.mimeType || '').toLowerCase();
  if (mime.includes('png')) return `announcement_${Date.now()}.png`;
  if (mime.includes('webp')) return `announcement_${Date.now()}.webp`;
  if (mime.includes('gif')) return `announcement_${Date.now()}.gif`;
  return `announcement_${Date.now()}.jpg`;
}

function inferImageMimeType(
  asset: ImagePicker.ImagePickerAsset,
  fileName: string
): string {
  if (asset.mimeType && asset.mimeType.startsWith('image/')) {
    return asset.mimeType;
  }
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

/**
 * Create & Edit Announcement Modal ported from clarify-web/src/components/modals/AnnouncementFormModal.tsx.
 * Supports:
 * - Campus-Wide mode (Department Heads) with semantic tag picker & department quick-toggles
 * - Course Hub mode (Faculty / Department Heads) with multi-hub broadcasting
 * - Urgent Pin & Push, SMS Fallback, and Published/Draft status controls
 * - Image attachments (Gallery & Camera via expo-image-picker) & Document attachments (expo-document-picker) up to 10 MB
 * - Inline Laravel 422 field validation errors and remove_attachment=1 on edit
 */
export function AnnouncementFormModal({
  visible,
  mode,
  editingAnnouncement = null,
  defaultChannelId = null,
  allowModeSwitch = false,
  onClose,
  onSaved,
}: AnnouncementFormModalProps) {
  const insets = useSafeAreaInsets();
  const { user, showToast } = useAuth();
  const { channels } = useChannels();
  const realtime = useOptionalRealtime();

  const handledCourseHubs = useMemo(() => {
    const allHubs = getTopLevelCourseHubs(channels);
    const joinedHubs = getJoinedCourseHubs(channels, user);
    return joinedHubs.length > 0 ? joinedHubs : allHubs;
  }, [channels, user]);

  const canPublishCampusWide = Boolean(
    user && canPublishCampusWideAnnouncements(user.role)
  );

  const [activeMode, setActiveMode] = useState<AnnouncementComposerMode>(mode);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [selectedChannelIds, setSelectedChannelIds] = useState<number[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [showImageSourceRow, setShowImageSourceRow] = useState(false);
  const [isUrgent, setIsUrgent] = useState(false);
  const [triggerSmsFallback, setTriggerSmsFallback] = useState(false);
  const [status, setStatus] = useState<'published' | 'draft'>('published');

  const [selectedFile, setSelectedFile] = useState<NativeUploadFile | null>(
    null
  );
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null);
  const [attachmentName, setAttachmentName] = useState<string | null>(null);
  const [attachmentType, setAttachmentType] = useState<
    'image' | 'document' | null
  >(null);
  const [removeExistingAttachment, setRemoveExistingAttachment] =
    useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  // Render-time initialization guard (avoids synchronous setState inside useEffect)
  const initKey = visible
    ? `open:${editingAnnouncement?.id ?? 'new'}:${mode}:${defaultChannelId ?? 'none'}`
    : 'closed';
  const [lastInitKey, setLastInitKey] = useState<string>('closed');

  if (initKey !== lastInitKey) {
    setLastInitKey(initKey);
    if (visible) {
      setFieldErrors({});
      setGeneralError(null);
      setShowTagPicker(false);
      setShowImageSourceRow(false);
      setRemoveExistingAttachment(false);
      setSelectedFile(null);

      if (editingAnnouncement) {
        const isEditingCampusWide =
          editingAnnouncement.channel_type === 'university';
        const parsed = parseAnnouncementAttachment(editingAnnouncement);
        setActiveMode(isEditingCampusWide ? 'campus_wide' : 'course_hub');
        setTitle(editingAnnouncement.title);
        setContent(parsed.cleanContent);
        setSelectedChannelIds([editingAnnouncement.channel_id]);
        setSelectedTags(isEditingCampusWide ? editingAnnouncement.tags : []);
        setIsUrgent(Boolean(editingAnnouncement.is_urgent));
        setTriggerSmsFallback(Boolean(editingAnnouncement.trigger_sms_fallback));
        setStatus(
          editingAnnouncement.status === 'draft' ? 'draft' : 'published'
        );
        setAttachmentUrl(resolveApiAssetUrl(parsed.attachmentUrl));
        setAttachmentName(parsed.attachmentName);
        setAttachmentType(parsed.attachmentType);
      } else {
        const resolvedMode: AnnouncementComposerMode =
          mode === 'campus_wide' && canPublishCampusWide
            ? 'campus_wide'
            : 'course_hub';
        setActiveMode(resolvedMode);
        setTitle('');
        setContent('');
        const validDefault =
          (defaultChannelId && defaultChannelId > 0 ? defaultChannelId : null) ??
          handledCourseHubs[0]?.id ??
          null;
        setSelectedChannelIds(validDefault ? [validDefault] : []);
        const userDept = user?.academic_profile?.department || 'CITC';
        setSelectedTags(
          resolvedMode === 'campus_wide'
            ? ['OFFICIAL MEMO', 'CDO CAMPUS', userDept]
            : []
        );
        setIsUrgent(false);
        setTriggerSmsFallback(false);
        setStatus('published');
        setAttachmentUrl(null);
        setAttachmentName(null);
        setAttachmentType(null);
      }
    }
  }

  if (!user || user.role === 'student' || user.role === 'it_admin') {
    return null;
  }

  const isCampusWideMode = editingAnnouncement
    ? editingAnnouncement.channel_type === 'university'
    : activeMode === 'campus_wide' && canPublishCampusWide;

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const toggleCourseHubSelection = (hubId: number) => {
    setSelectedChannelIds((prev) => {
      if (prev.includes(hubId)) {
        if (prev.length === 1) return prev;
        return prev.filter((id) => id !== hubId);
      }
      return [...prev, hubId];
    });
  };

  const handleModeSwitch = (nextMode: AnnouncementComposerMode) => {
    if (editingAnnouncement || nextMode === activeMode) return;
    setActiveMode(nextMode);
    setFieldErrors({});
    setGeneralError(null);
    if (nextMode === 'campus_wide') {
      const userDept = user?.academic_profile?.department || 'CITC';
      setSelectedTags((prev) =>
        prev.length > 0 ? prev : ['OFFICIAL MEMO', 'CDO CAMPUS', userDept]
      );
    } else if (selectedChannelIds.length === 0 && handledCourseHubs[0]) {
      setSelectedChannelIds([handledCourseHubs[0].id]);
    }
  };

  const clearAttachmentError = () => {
    setFieldErrors((prev) => {
      if (!prev.attachment) return prev;
      const next = { ...prev };
      delete next.attachment;
      return next;
    });
  };

  const stagePickedImage = (asset: ImagePicker.ImagePickerAsset) => {
    const fileName = inferImageFileName(asset);
    const mimeType = inferImageMimeType(asset, fileName);
    const validation = validateAnnouncementAttachmentFile(
      {
        name: fileName,
        size: asset.fileSize,
        type: mimeType,
      },
      'image'
    );

    if (!validation.valid) {
      setFieldErrors((prev) => ({
        ...prev,
        attachment: [validation.error],
      }));
      return;
    }

    setGeneralError(null);
    clearAttachmentError();
    setSelectedFile({
      uri: asset.uri,
      name: fileName,
      type: mimeType,
      size: asset.fileSize,
    });
    setAttachmentUrl(asset.uri);
    setAttachmentName(fileName);
    setAttachmentType('image');
    setRemoveExistingAttachment(false);
    setShowImageSourceRow(false);
  };

  const handlePickImageFromGallery = async () => {
    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setFieldErrors((prev) => ({
          ...prev,
          attachment: [
            'Photo library permission is required to attach an image.',
          ],
        }));
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.85,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }
      stagePickedImage(result.assets[0]);
    } catch {
      setGeneralError('Unable to open photo library. Please try again.');
    }
  };

  const handleTakePhoto = async () => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setFieldErrors((prev) => ({
          ...prev,
          attachment: ['Camera permission is required to take a photo.'],
        }));
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.85,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }
      stagePickedImage(result.assets[0]);
    } catch {
      setGeneralError('Unable to open camera on this device.');
    }
  };

  const handlePickDocument = async () => {
    setShowImageSourceRow(false);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ACCEPTED_DOCUMENT_MIMES,
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const doc = result.assets[0];
      const fileName = doc.name || `document_${Date.now()}.pdf`;
      const mimeType = doc.mimeType || 'application/octet-stream';
      const validation = validateAnnouncementAttachmentFile({
        name: fileName,
        size: doc.size,
        type: mimeType,
      });

      if (!validation.valid) {
        setFieldErrors((prev) => ({
          ...prev,
          attachment: [validation.error],
        }));
        return;
      }

      setGeneralError(null);
      clearAttachmentError();
      setSelectedFile({
        uri: doc.uri,
        name: fileName,
        type: mimeType,
        size: doc.size,
      });
      setAttachmentUrl(validation.attachmentType === 'image' ? doc.uri : null);
      setAttachmentName(fileName);
      setAttachmentType(validation.attachmentType);
      setRemoveExistingAttachment(false);
    } catch {
      setGeneralError('Unable to open document picker. Please try again.');
    }
  };

  const handleRemoveAttachment = () => {
    setSelectedFile(null);
    setAttachmentUrl(null);
    setAttachmentName(null);
    setAttachmentType(null);
    setRemoveExistingAttachment(true);
    clearAttachmentError();
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;
    setFieldErrors({});
    setGeneralError(null);

    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();
    const localErrors: Record<string, string[]> = {};
    if (!trimmedTitle) {
      localErrors.title = ['The title field is required.'];
    }
    if (!trimmedContent) {
      localErrors.content = ['The announcement content field is required.'];
    }
    if (
      !isCampusWideMode &&
      !editingAnnouncement &&
      selectedChannelIds.length === 0
    ) {
      localErrors.channel_id = [
        'Please select at least one Course Hub before publishing.',
      ];
    }

    if (Object.keys(localErrors).length > 0) {
      setFieldErrors(localErrors);
      return;
    }

    setIsSubmitting(true);
    try {
      const formData = buildAnnouncementFormData({
        title: trimmedTitle,
        content: trimmedContent,
        isCampusWide: isCampusWideMode,
        isEditing: Boolean(editingAnnouncement),
        tags: selectedTags,
        isUrgent,
        triggerSmsFallback,
        status,
        selectedChannelIds,
        attachment: selectedFile,
        attachmentType,
        removeExistingAttachment,
      });

      let savedAnnouncement: Announcement | undefined;
      if (editingAnnouncement) {
        const res = await updateAnnouncementApi(
          editingAnnouncement.id,
          formData
        );
        savedAnnouncement = res.data;
        showToast(res.message || 'Announcement updated.', 'success');
      } else {
        const res = await createAnnouncementApi(formData);
        savedAnnouncement = res.data;
        showToast(res.message || 'Announcement posted.', 'success');
      }

      realtime?.triggerAnnouncementRefresh();
      onSaved?.(savedAnnouncement);
      onClose();
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.status === 422 && apiErr.errors) {
        setFieldErrors(apiErr.errors);
      } else if (apiErr.status !== 401) {
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
  const channelError = getFieldValidationError(fieldErrors, 'channel_id');
  const attachmentError = getFieldValidationError(fieldErrors, 'attachment');

  const modalTitle = editingAnnouncement
    ? `Edit ${isCampusWideMode ? 'Campus-Wide' : 'Course Hub'} Announcement #${editingAnnouncement.id}`
    : isCampusWideMode
      ? 'Create Campus-Wide Announcement'
      : 'Create Course Hub Announcement';

  const hasActiveAttachment = Boolean(!removeExistingAttachment && attachmentName);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={() => {
        if (!isSubmitting) onClose();
      }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <View
          style={[
            styles.sheet,
            { paddingBottom: Math.max(insets.bottom, spacing.md) },
          ]}
        >
          {/* Navy Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleWrap}>
              <Text numberOfLines={2} style={styles.headerTitle}>
                {modalTitle}
              </Text>
              {isCampusWideMode && !editingAnnouncement && (
                <Text style={styles.headerSubtitle}>
                  Department Head Scope • CDO Campus
                </Text>
              )}
            </View>
            <Pressable
              onPress={onClose}
              disabled={isSubmitting}
              accessibilityRole="button"
              accessibilityLabel="Close announcement composer"
              style={({ pressed }) => [
                styles.closeBtn,
                pressed && styles.pressed,
              ]}
            >
              <Feather name="x" size={20} color={colors.white} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.bodyScroll}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
          >
            {generalError && (
              <View style={styles.errorBanner} accessibilityRole="alert">
                <Feather
                  name="alert-circle"
                  size={16}
                  color={colors.dangerBorder}
                />
                <Text style={styles.errorBannerText}>{generalError}</Text>
              </View>
            )}

            {/* Mode Switcher (only for Dept Head when creating from Announcements feed) */}
            {allowModeSwitch &&
              !editingAnnouncement &&
              canPublishCampusWide &&
              handledCourseHubs.length > 0 && (
                <View style={styles.modeSwitchRow}>
                  <Pressable
                    onPress={() => handleModeSwitch('campus_wide')}
                    accessibilityRole="button"
                    accessibilityLabel="Campus-Wide Announcement mode"
                    style={[
                      styles.modeSwitchBtn,
                      isCampusWideMode && styles.modeSwitchBtnActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.modeSwitchText,
                        isCampusWideMode && styles.modeSwitchTextActive,
                      ]}
                    >
                      Campus-Wide Memo
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleModeSwitch('course_hub')}
                    accessibilityRole="button"
                    accessibilityLabel="Course Hub Announcement mode"
                    style={[
                      styles.modeSwitchBtn,
                      !isCampusWideMode && styles.modeSwitchBtnActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.modeSwitchText,
                        !isCampusWideMode && styles.modeSwitchTextActive,
                      ]}
                    >
                      Course Hub Post
                    </Text>
                  </Pressable>
                </View>
              )}

            {/* Large Title Input */}
            <View style={styles.fieldGroup}>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="Title"
                placeholderTextColor={colors.placeholder}
                editable={!isSubmitting}
                accessibilityLabel="Announcement Title"
                style={[
                  styles.titleInput,
                  titleError && styles.inputBorderError,
                ]}
              />
              {titleError && (
                <Text style={styles.fieldErrorText} accessibilityRole="alert">
                  {titleError}
                </Text>
              )}
            </View>

            {/* Campus-Wide Mode: Tags & Department Quick Toggles */}
            {isCampusWideMode && (
              <View style={styles.tagsSection}>
                <View style={styles.selectedTagsRow}>
                  {selectedTags.map((tag) => (
                    <Pressable
                      key={tag}
                      onPress={() => toggleTag(tag)}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove tag ${tag}`}
                    >
                      <TagPill tag={tag} size="xs" />
                    </Pressable>
                  ))}
                  <Pressable
                    onPress={() => setShowTagPicker((prev) => !prev)}
                    accessibilityRole="button"
                    accessibilityLabel="Toggle tag picker"
                    style={({ pressed }) => [
                      styles.addTagsBtn,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.addTagsBtnText}>Add tags</Text>
                    <Feather
                      name={showTagPicker ? 'minus' : 'plus'}
                      size={13}
                      color={colors.ustpText}
                    />
                  </Pressable>
                </View>

                <View style={styles.deptRow}>
                  <Text style={styles.deptLabel}>Departments:</Text>
                  {CAMPUS_DEPARTMENTS.map((dept) => {
                    const isDeptActive = selectedTags.includes(dept);
                    return (
                      <Pressable
                        key={dept}
                        onPress={() => toggleTag(dept)}
                        accessibilityRole="button"
                        accessibilityLabel={`Toggle ${dept} department tag`}
                        style={[
                          styles.deptChip,
                          isDeptActive && styles.deptChipActive,
                        ]}
                      >
                        {isDeptActive && (
                          <Feather
                            name="check"
                            size={12}
                            color={colors.ustpGold}
                          />
                        )}
                        <Text
                          style={[
                            styles.deptChipText,
                            isDeptActive && styles.deptChipTextActive,
                          ]}
                        >
                          {dept}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                {showTagPicker && (
                  <View style={styles.tagPickerBox}>
                    {CAMPUS_WIDE_AVAILABLE_TAGS.map((tag) => {
                      const active = selectedTags.includes(tag);
                      return (
                        <Pressable
                          key={tag}
                          onPress={() => toggleTag(tag)}
                          accessibilityRole="button"
                          accessibilityLabel={`Toggle tag ${tag}`}
                          style={[
                            styles.pickerChip,
                            active && styles.pickerChipActive,
                          ]}
                        >
                          <Feather
                            name={active ? 'check' : 'plus'}
                            size={12}
                            color={active ? colors.white : colors.ustpText}
                          />
                          <Text
                            style={[
                              styles.pickerChipText,
                              active && styles.pickerChipTextActive,
                            ]}
                          >
                            {tag}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </View>
            )}

            {/* Course Hub Mode: Target Handled Course Hub(s) Multi-Select */}
            {!isCampusWideMode && !editingAnnouncement && (
              <View style={styles.hubPickerCard}>
                <Text style={styles.hubPickerHeading}>
                  Target Handled Course Hub(s) ({selectedChannelIds.length}{' '}
                  selected):
                </Text>
                {handledCourseHubs.length === 0 ? (
                  <Text style={styles.hubPickerEmpty}>
                    You have no joined Course Hubs yet. Create or join a Course
                    Hub first.
                  </Text>
                ) : (
                  <View style={styles.hubChipsWrap}>
                    {handledCourseHubs.map((ch) => {
                      const isSelected = selectedChannelIds.includes(ch.id);
                      return (
                        <Pressable
                          key={String(ch.id)}
                          onPress={() => toggleCourseHubSelection(ch.id)}
                          accessibilityRole="button"
                          accessibilityLabel={`Toggle target hub ${formatCourseHubName(ch)}`}
                          style={[
                            styles.hubChip,
                            isSelected && styles.hubChipActive,
                          ]}
                        >
                          <Feather
                            name={isSelected ? 'check' : 'plus'}
                            size={13}
                            color={
                              isSelected ? colors.ustpGold : colors.ustpText
                            }
                          />
                          <Text
                            style={[
                              styles.hubChipText,
                              isSelected && styles.hubChipTextActive,
                            ]}
                          >
                            {formatCourseHubName(ch)} (
                            {ch.scope_section || 'Section'})
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
                {channelError && (
                  <Text style={styles.fieldErrorText} accessibilityRole="alert">
                    {channelError}
                  </Text>
                )}
              </View>
            )}

            {/* Content Multiline Input */}
            <View style={styles.fieldGroup}>
              <TextInput
                value={content}
                onChangeText={setContent}
                placeholder="Type your announcement details here..."
                placeholderTextColor={colors.placeholder}
                multiline
                numberOfLines={6}
                textAlignVertical="top"
                editable={!isSubmitting}
                accessibilityLabel="Announcement Content"
                style={[
                  styles.contentInput,
                  contentError && styles.inputBorderError,
                ]}
              />
              {contentError && (
                <Text style={styles.fieldErrorText} accessibilityRole="alert">
                  {contentError}
                </Text>
              )}
            </View>

            {/* Delivery & Urgency Controls */}
            <View style={styles.controlsGrid}>
              <Pressable
                onPress={() => setIsUrgent((prev) => !prev)}
                disabled={isSubmitting}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isUrgent }}
                accessibilityLabel="Urgent Pin and Push"
                style={[
                  styles.toggleCard,
                  isUrgent && styles.toggleCardUrgentActive,
                ]}
              >
                <View
                  style={[
                    styles.checkboxBox,
                    isUrgent && styles.checkboxBoxChecked,
                  ]}
                >
                  {isUrgent && (
                    <Feather name="check" size={13} color={colors.white} />
                  )}
                </View>
                <View style={styles.toggleCardCopy}>
                  <View style={styles.toggleCardTitleRow}>
                    <Feather
                      name="radio"
                      size={14}
                      color={colors.dangerBorder}
                    />
                    <Text style={styles.toggleCardTitle}>Urgent Pin & Push</Text>
                  </View>
                  <Text style={styles.toggleCardSub}>
                    Pins top + ≤2.0s urgent alert
                  </Text>
                </View>
              </Pressable>

              <Pressable
                onPress={() => setTriggerSmsFallback((prev) => !prev)}
                disabled={isSubmitting}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: triggerSmsFallback }}
                accessibilityLabel="SMS Fallback"
                style={[
                  styles.toggleCard,
                  triggerSmsFallback && styles.toggleCardSmsActive,
                ]}
              >
                <View
                  style={[
                    styles.checkboxBox,
                    triggerSmsFallback && styles.checkboxBoxChecked,
                  ]}
                >
                  {triggerSmsFallback && (
                    <Feather name="check" size={13} color={colors.white} />
                  )}
                </View>
                <View style={styles.toggleCardCopy}>
                  <View style={styles.toggleCardTitleRow}>
                    <Feather
                      name="smartphone"
                      size={14}
                      color={colors.warningBorder}
                    />
                    <Text style={styles.toggleCardTitle}>SMS Fallback</Text>
                  </View>
                  <Text style={styles.toggleCardSub}>
                    Offline weather/emergency blast
                  </Text>
                </View>
              </Pressable>

              {/* Publication Status Selector */}
              <View style={styles.statusBox}>
                <Text style={styles.statusLabel}>Publication Status</Text>
                <View style={styles.statusPillRow}>
                  <Pressable
                    onPress={() => setStatus('published')}
                    disabled={isSubmitting}
                    accessibilityRole="button"
                    accessibilityLabel="Set status to Published Live Feed"
                    style={[
                      styles.statusBtn,
                      status === 'published' && styles.statusBtnActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusBtnText,
                        status === 'published' && styles.statusBtnTextActive,
                      ]}
                    >
                      Published (Live Feed)
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setStatus('draft')}
                    disabled={isSubmitting}
                    accessibilityRole="button"
                    accessibilityLabel="Set status to Save as Draft"
                    style={[
                      styles.statusBtn,
                      status === 'draft' && styles.statusBtnActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusBtnText,
                        status === 'draft' && styles.statusBtnTextActive,
                      ]}
                    >
                      Save as Draft
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>

            {/* Active Attachment Preview Bar */}
            {hasActiveAttachment && (
              <View style={styles.attachmentPreviewBar}>
                <View style={styles.attachmentPreviewLeft}>
                  {attachmentType === 'image' && attachmentUrl ? (
                    <Image
                      source={{ uri: attachmentUrl }}
                      style={styles.attachmentThumb}
                      accessibilityLabel={attachmentName || 'Attached image'}
                    />
                  ) : (
                    <View style={styles.attachmentIconTile}>
                      <Feather
                        name={attachmentType === 'image' ? 'image' : 'file-text'}
                        size={18}
                        color={colors.ustpGold}
                      />
                    </View>
                  )}
                  <View style={styles.attachmentMeta}>
                    <Text numberOfLines={1} style={styles.attachmentNameText}>
                      {attachmentName}
                    </Text>
                    <Text style={styles.attachmentTypeText}>
                      {attachmentType === 'image'
                        ? 'ATTACHED IMAGE'
                        : 'ATTACHED DOCUMENT'}
                      {selectedFile?.size
                        ? ` • ${formatFileSize(selectedFile.size)}`
                        : ''}
                    </Text>
                  </View>
                </View>
                <Pressable
                  onPress={handleRemoveAttachment}
                  disabled={isSubmitting}
                  accessibilityRole="button"
                  accessibilityLabel="Remove attachment"
                  style={({ pressed }) => [
                    styles.removeAttachmentBtn,
                    pressed && styles.pressed,
                  ]}
                >
                  <Feather name="x" size={14} color={colors.dangerTitle} />
                  <Text style={styles.removeAttachmentText}>Remove</Text>
                </Pressable>
              </View>
            )}

            {attachmentError && (
              <Text style={styles.fieldErrorText} accessibilityRole="alert">
                {attachmentError}
              </Text>
            )}

            {/* Image Source Picker Row (Gallery / Camera) */}
            {showImageSourceRow && (
              <View style={styles.imageSourceRow}>
                <Pressable
                  onPress={() => void handlePickImageFromGallery()}
                  disabled={isSubmitting}
                  accessibilityRole="button"
                  accessibilityLabel="Choose image from gallery"
                  style={({ pressed }) => [
                    styles.imageSourceBtn,
                    pressed && styles.pressed,
                  ]}
                >
                  <Feather name="image" size={15} color={colors.ustpNavy} />
                  <Text style={styles.imageSourceBtnText}>Photo Gallery</Text>
                </Pressable>
                <Pressable
                  onPress={() => void handleTakePhoto()}
                  disabled={isSubmitting}
                  accessibilityRole="button"
                  accessibilityLabel="Take photo with camera"
                  style={({ pressed }) => [
                    styles.imageSourceBtn,
                    pressed && styles.pressed,
                  ]}
                >
                  <Feather name="camera" size={15} color={colors.ustpNavy} />
                  <Text style={styles.imageSourceBtnText}>Take Photo</Text>
                </Pressable>
              </View>
            )}

            {/* Attachment Buttons Row */}
            <View style={styles.attachActionRow}>
              <Pressable
                onPress={() => setShowImageSourceRow((prev) => !prev)}
                disabled={isSubmitting}
                accessibilityRole="button"
                accessibilityLabel="Attach image"
                style={({ pressed }) => [
                  styles.attachBtn,
                  showImageSourceRow && styles.attachBtnActive,
                  pressed && styles.pressed,
                ]}
              >
                <Feather name="image" size={16} color={colors.ustpNavy} />
                <Text style={styles.attachBtnText}>
                  {hasActiveAttachment && attachmentType === 'image'
                    ? 'Replace Image'
                    : 'Attach Image'}
                </Text>
              </Pressable>

              <Pressable
                onPress={() => void handlePickDocument()}
                disabled={isSubmitting}
                accessibilityRole="button"
                accessibilityLabel="Attach document"
                style={({ pressed }) => [
                  styles.attachBtn,
                  pressed && styles.pressed,
                ]}
              >
                <Feather name="file-text" size={16} color={colors.ustpNavy} />
                <Text style={styles.attachBtnText}>
                  {hasActiveAttachment && attachmentType === 'document'
                    ? 'Replace Document'
                    : 'Attach Document'}
                </Text>
              </Pressable>
            </View>
          </ScrollView>

          {/* Sticky Footer Actions */}
          <View style={styles.footer}>
            <Pressable
              onPress={onClose}
              disabled={isSubmitting}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              style={({ pressed }) => [
                styles.cancelBtn,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </Pressable>

            <Pressable
              onPress={() => void handleSubmit()}
              disabled={isSubmitting}
              accessibilityRole="button"
              accessibilityLabel={
                editingAnnouncement
                  ? 'Save announcement changes'
                  : 'Post announcement'
              }
              style={({ pressed }) => [
                styles.submitBtn,
                isSubmitting && styles.disabledBtn,
                pressed && !isSubmitting && styles.pressed,
              ]}
            >
              {isSubmitting ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <Feather name="send" size={15} color={colors.ustpGold} />
              )}
              <Text style={styles.submitBtnText}>
                {isSubmitting
                  ? selectedFile
                    ? 'Uploading...'
                    : 'Publishing...'
                  : editingAnnouncement
                    ? 'Save Changes'
                    : 'Post'}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlayBackdrop,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radii.xxl,
    borderTopRightRadius: radii.xxl,
    maxHeight: '92%',
    overflow: 'hidden',
    ...elevation.overlay,
  },
  header: {
    backgroundColor: colors.ustpNavy,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  headerTitleWrap: {
    flex: 1,
    gap: 2,
  },
  headerTitle: {
    fontSize: typography.sizes.bodyLg,
    lineHeight: typography.lineHeights.bodyLg,
    fontWeight: '800',
    color: colors.white,
  },
  headerSubtitle: {
    fontSize: typography.sizes.xxs,
    fontWeight: '700',
    color: colors.ustpGold,
  },
  closeBtn: {
    minWidth: touchTarget.minWidth,
    minHeight: touchTarget.minHeight,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
  },
  bodyScroll: {
    flexGrow: 0,
  },
  bodyContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.dangerBg,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  errorBannerText: {
    flex: 1,
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '700',
    color: colors.dangerText,
  },
  modeSwitchRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  modeSwitchBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  modeSwitchBtnActive: {
    backgroundColor: colors.ustpNavy,
    borderColor: colors.ustpNavy,
  },
  modeSwitchText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpText,
  },
  modeSwitchTextActive: {
    color: colors.ustpGold,
  },
  fieldGroup: {
    gap: spacing.xs,
  },
  titleInput: {
    fontSize: typography.sizes.titleMd,
    lineHeight: typography.lineHeights.titleMd,
    fontWeight: '800',
    color: colors.ustpText,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderStrong,
    paddingVertical: spacing.sm,
  },
  contentInput: {
    minHeight: 130,
    fontSize: typography.sizes.body,
    lineHeight: typography.lineHeights.body,
    color: colors.ustpText,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  inputBorderError: {
    borderColor: colors.dangerBorder,
  },
  fieldErrorText: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '700',
    color: colors.dangerTitle,
  },
  tagsSection: {
    gap: spacing.sm,
  },
  selectedTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  addTagsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 34,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  addTagsBtnText: {
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.ustpText,
  },
  deptRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  deptLabel: {
    fontSize: typography.sizes.xxs,
    fontWeight: '800',
    color: colors.mutedSlate,
  },
  deptChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 32,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  deptChipActive: {
    backgroundColor: colors.ustpNavy,
    borderColor: colors.ustpNavy,
  },
  deptChipText: {
    fontSize: typography.sizes.xxs,
    fontWeight: '800',
    color: colors.mutedSlate,
  },
  deptChipTextActive: {
    color: colors.ustpGold,
  },
  tagPickerBox: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs + 2,
    padding: spacing.md,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
  },
  pickerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 34,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.sm,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  pickerChipActive: {
    backgroundColor: colors.ustpNavy,
    borderColor: colors.ustpNavy,
  },
  pickerChipText: {
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.ustpText,
  },
  pickerChipTextActive: {
    color: colors.white,
  },
  hubPickerCard: {
    backgroundColor: colors.ustpCream,
    borderWidth: 1,
    borderColor: colors.tagMemoBorder,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  hubPickerHeading: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpNavy,
    ...typography.tabularNums,
  },
  hubPickerEmpty: {
    fontSize: typography.sizes.xs,
    color: colors.mutedSlate,
  },
  hubChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs + 2,
  },
  hubChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 38,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    borderRadius: radii.md,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  hubChipActive: {
    backgroundColor: colors.ustpNavy,
    borderColor: colors.ustpNavy,
  },
  hubChipText: {
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.ustpText,
  },
  hubChipTextActive: {
    color: colors.ustpGold,
  },
  controlsGrid: {
    gap: spacing.sm,
  },
  toggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.minHeight,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
  },
  toggleCardUrgentActive: {
    backgroundColor: colors.urgentCardBg,
    borderColor: colors.urgentCardBorder,
  },
  toggleCardSmsActive: {
    backgroundColor: colors.warningBg,
    borderColor: colors.tagMemoBorder,
  },
  checkboxBox: {
    width: 22,
    height: 22,
    borderRadius: radii.sm,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxBoxChecked: {
    backgroundColor: colors.ustpNavy,
    borderColor: colors.ustpNavy,
  },
  toggleCardCopy: {
    flex: 1,
    gap: 2,
  },
  toggleCardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  toggleCardTitle: {
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.ustpText,
  },
  toggleCardSub: {
    fontSize: typography.sizes.xxs,
    color: colors.mutedSlate,
  },
  statusBox: {
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  statusLabel: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.mutedSlate,
  },
  statusPillRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statusBtn: {
    flex: 1,
    minHeight: 40,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  statusBtnActive: {
    backgroundColor: colors.ustpNavy,
    borderColor: colors.ustpNavy,
  },
  statusBtnText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpText,
  },
  statusBtnTextActive: {
    color: colors.ustpGold,
  },
  attachmentPreviewBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    padding: spacing.sm + 2,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
  },
  attachmentPreviewLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    minWidth: 0,
  },
  attachmentThumb: {
    width: 48,
    height: 48,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.white,
  },
  attachmentIconTile: {
    width: 44,
    height: 44,
    borderRadius: radii.sm,
    backgroundColor: colors.ustpNavy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentMeta: {
    flex: 1,
    gap: 2,
  },
  attachmentNameText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpText,
  },
  attachmentTypeText: {
    fontSize: typography.sizes.xxs,
    fontWeight: '700',
    color: colors.mutedSlate,
    ...typography.tabularNums,
  },
  removeAttachmentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 36,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.sm,
    backgroundColor: colors.dangerBg,
    borderWidth: 1,
    borderColor: colors.urgentCardBorder,
  },
  removeAttachmentText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.dangerTitle,
  },
  imageSourceRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.sm,
    backgroundColor: colors.ustpCream,
    borderWidth: 1,
    borderColor: colors.tagMemoBorder,
    borderRadius: radii.md,
  },
  imageSourceBtn: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.ustpNavy,
    borderRadius: radii.md,
  },
  imageSourceBtnText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  attachActionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  attachBtn: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
  },
  attachBtnActive: {
    borderColor: colors.ustpNavy,
    backgroundColor: colors.tagCourseHubBg,
  },
  attachBtnText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpText,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.white,
  },
  cancelBtn: {
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.white,
  },
  cancelBtnText: {
    fontSize: typography.sizes.sm,
    fontWeight: '700',
    color: colors.mutedSlate,
  },
  submitBtn: {
    minHeight: touchTarget.minHeight,
    minWidth: 132,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.md,
    backgroundColor: colors.ustpNavy,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  submitBtnText: {
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.white,
  },
  disabledBtn: {
    opacity: 0.65,
  },
  pressed: {
    opacity: 0.85,
  },
});
