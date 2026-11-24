import { Feather } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useAuth } from '../context/AuthContext';
import { useOptionalRealtime } from '../context/RealtimeContext';
import {
  acknowledgeAnnouncementApi,
  resolveApiAssetUrl,
} from '../lib/api-client';
import { parseAnnouncementAttachment } from '../lib/domain-logic';
import {
  colors,
  elevation,
  radii,
  spacing,
  touchTarget,
  typography,
} from '../theme';
import type { ApiError } from '../types/api';
import { formatAnnouncementTimestamp } from './AnnouncementCard';
import { ReadReachBar } from './ReadReachBar';
import { ErrorBanner } from './StateViews';

/**
 * Priority Urgent Announcement Popup Modal ported from
 * clarify-web/src/components/modals/UrgentAnnouncementModal.tsx.
 *
 * Mounted once inside MobileAppShell, strictly hidden for `it_admin`.
 * Renders attachment previews/links, live Read Reach progress,
 * and allows Students to acknowledge (refreshing feed + dismissing)
 * or dismiss while recording the ID in RealtimeContext's dismissed set.
 */
export function UrgentAnnouncementModal() {
  const { user, showToast } = useAuth();
  const realtime = useOptionalRealtime();

  const [isAcknowledging, setIsAcknowledging] = useState(false);
  const [ackError, setAckError] = useState<ApiError | null>(null);
  const [isOpeningAttachment, setIsOpeningAttachment] = useState(false);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);

  const announcement = realtime?.urgentPopupAnnouncement ?? null;

  if (!user || user.role === 'it_admin' || !announcement) {
    return null;
  }

  const parsed = parseAnnouncementAttachment(announcement);
  const resolvedAttachmentUrl = resolveApiAssetUrl(parsed.attachmentUrl);
  const hasImageAttachment = Boolean(
    resolvedAttachmentUrl && parsed.attachmentType === 'image'
  );
  const hasDocumentAttachment = Boolean(
    resolvedAttachmentUrl && parsed.attachmentType !== 'image'
  );

  const canStudentAcknowledge =
    user.role === 'student' &&
    !announcement.read_reach.has_current_user_acknowledged;

  const handleDismiss = () => {
    if (isAcknowledging) return;
    setAckError(null);
    setIsLightboxOpen(false);
    realtime?.dismissUrgentPopup(announcement.id);
  };

  const handleAcknowledge = async () => {
    if (isAcknowledging) return;
    setAckError(null);
    setIsAcknowledging(true);
    try {
      await acknowledgeAnnouncementApi(announcement.id);
      showToast('Urgent announcement acknowledged!', 'success');
      realtime?.triggerAnnouncementRefresh();
      realtime?.dismissUrgentPopup(announcement.id);
    } catch (err) {
      const apiErr = err as ApiError;
      setAckError(
        apiErr?.message
          ? apiErr
          : {
              status: apiErr?.status ?? 500,
              message:
                'Failed to record acknowledgment. Please check your connection and try again.',
            }
      );
    } finally {
      setIsAcknowledging(false);
    }
  };

  const handleOpenAttachment = async () => {
    if (!resolvedAttachmentUrl || isOpeningAttachment) return;
    setIsOpeningAttachment(true);
    try {
      await WebBrowser.openBrowserAsync(resolvedAttachmentUrl);
    } catch {
      try {
        await Linking.openURL(resolvedAttachmentUrl);
      } catch {
        showToast('Unable to open attachment link on this device.', 'error');
      }
    } finally {
      setIsOpeningAttachment(false);
    }
  };

  const formattedTimestamp = formatAnnouncementTimestamp(
    announcement.published_at || announcement.updated_at
  );
  const publisherRoleLabel = announcement.publisher.role
    .replace('_', ' ')
    .toUpperCase();

  return (
    <>
      <Modal
        visible
        transparent
        animationType="fade"
        onRequestClose={handleDismiss}
      >
        <View style={styles.backdrop}>
          <View
            accessibilityViewIsModal
            style={styles.modalCard}
          >
            {/* Urgent Red Header */}
            <View style={styles.headerBar}>
              <View style={styles.headerLeft}>
                <View style={styles.headerIconBox}>
                  <Feather
                    name="alert-triangle"
                    size={20}
                    color={colors.white}
                  />
                </View>
                <View style={styles.headerCopy}>
                  <Text style={styles.headerTitle}>
                    URGENT CAMPUS ANNOUNCEMENT
                  </Text>
                  <Text style={styles.headerSub}>
                    Priority Notice · Immediate Attention Required
                  </Text>
                </View>
              </View>

              <Pressable
                onPress={handleDismiss}
                disabled={isAcknowledging}
                accessibilityRole="button"
                accessibilityLabel="Dismiss urgent announcement popup"
                style={({ pressed }) => [
                  styles.closeBtn,
                  pressed && styles.pressed,
                ]}
              >
                <Feather name="x" size={20} color={colors.white} />
              </Pressable>
            </View>

            {/* Scrollable Body */}
            <ScrollView
              contentContainerStyle={styles.bodyContent}
              showsVerticalScrollIndicator={false}
            >
              {/* Status & Scope Tags */}
              <View style={styles.tagsRow}>
                <View style={styles.urgentTag}>
                  <Text style={styles.urgentTagText}>URGENT NOTICE</Text>
                </View>
                {announcement.trigger_sms_fallback && (
                  <View style={styles.smsTag}>
                    <Feather
                      name="smartphone"
                      size={11}
                      color={colors.warningText}
                    />
                    <Text style={styles.smsTagText}>
                      SMS Fallback Dispatched
                    </Text>
                  </View>
                )}
                {announcement.course_code ? (
                  <View style={styles.courseTag}>
                    <Text style={styles.courseTagText}>
                      {announcement.course_code}
                    </Text>
                  </View>
                ) : null}
                {(announcement.tags || []).map((tag) => (
                  <View key={tag} style={styles.deptTag}>
                    <Text style={styles.deptTagText}>{tag}</Text>
                  </View>
                ))}
              </View>

              {/* Title + Publisher Meta */}
              <View style={styles.titleBlock}>
                <Text style={styles.announcementTitle}>
                  {announcement.title}
                </Text>
                <Text style={styles.metaText}>
                  Published by{' '}
                  <Text style={styles.metaAuthor}>
                    {announcement.publisher.name}
                  </Text>{' '}
                  ({publisherRoleLabel}) • {formattedTimestamp}
                </Text>
              </View>

              {/* Clean Message Body */}
              {parsed.cleanContent.length > 0 && (
                <View style={styles.contentBox}>
                  <Text style={styles.contentText}>{parsed.cleanContent}</Text>
                </View>
              )}

              {/* Image Attachment Preview */}
              {hasImageAttachment && resolvedAttachmentUrl && (
                <View style={styles.attachmentSection}>
                  <Pressable
                    onPress={() => setIsLightboxOpen(true)}
                    accessibilityRole="button"
                    accessibilityLabel={`View attached image ${parsed.attachmentName || 'Attachment'}`}
                    style={({ pressed }) => [
                      styles.imagePreviewWrap,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Image
                      source={{ uri: resolvedAttachmentUrl }}
                      resizeMode="contain"
                      accessibilityLabel={
                        parsed.attachmentName || 'Urgent announcement image'
                      }
                      style={styles.attachmentImage}
                    />
                  </Pressable>
                  <View style={styles.attachmentCaptionRow}>
                    <Text numberOfLines={1} style={styles.attachmentCaption}>
                      {parsed.attachmentName || 'Attached Image'}
                    </Text>
                    <Pressable
                      onPress={() => void handleOpenAttachment()}
                      disabled={isOpeningAttachment}
                      accessibilityRole="button"
                      accessibilityLabel="Open full image in browser"
                      style={styles.inlineOpenBtn}
                    >
                      <Feather
                        name="external-link"
                        size={13}
                        color={colors.ustpBlue}
                      />
                      <Text style={styles.inlineOpenText}>Open</Text>
                    </Pressable>
                  </View>
                </View>
              )}

              {/* Document Attachment Button */}
              {hasDocumentAttachment && resolvedAttachmentUrl && (
                <Pressable
                  onPress={() => void handleOpenAttachment()}
                  disabled={isOpeningAttachment}
                  accessibilityRole="button"
                  accessibilityLabel={`Open attached document ${parsed.attachmentName || 'Official Attachment'}`}
                  style={({ pressed }) => [
                    styles.documentCard,
                    pressed && styles.pressed,
                  ]}
                >
                  <Feather
                    name="paperclip"
                    size={16}
                    color={colors.ustpNavy}
                  />
                  <View style={styles.documentCopy}>
                    <Text numberOfLines={1} style={styles.documentTitle}>
                      {parsed.attachmentName || 'Official Memo Attachment'}
                    </Text>
                    <Text style={styles.documentSub}>
                      {isOpeningAttachment
                        ? 'Opening attachment...'
                        : 'Tap to view or download attachment'}
                    </Text>
                  </View>
                  <Feather
                    name="external-link"
                    size={16}
                    color={colors.ustpBlue}
                  />
                </Pressable>
              )}

              {/* Live Read Reach Bar */}
              <ReadReachBar readReach={announcement.read_reach} />

              {/* Inline Acknowledge Error with Retry */}
              {ackError && (
                <ErrorBanner
                  error={ackError}
                  onRetry={() => void handleAcknowledge()}
                />
              )}
            </ScrollView>

            {/* Footer Action Buttons */}
            <View style={styles.footerBar}>
              <Pressable
                onPress={handleDismiss}
                disabled={isAcknowledging}
                accessibilityRole="button"
                accessibilityLabel={
                  canStudentAcknowledge ? 'Remind Me Later' : 'Close Notice'
                }
                style={({ pressed }) => [
                  styles.secondaryBtn,
                  isAcknowledging && styles.disabledBtn,
                  pressed && !isAcknowledging && styles.pressed,
                ]}
              >
                <Text style={styles.secondaryBtnText}>
                  {canStudentAcknowledge ? 'Remind Me Later' : 'Close Notice'}
                </Text>
              </Pressable>

              {canStudentAcknowledge && (
                <Pressable
                  onPress={() => void handleAcknowledge()}
                  disabled={isAcknowledging}
                  accessibilityRole="button"
                  accessibilityLabel="I Understand and Acknowledge"
                  accessibilityState={{
                    disabled: isAcknowledging,
                    busy: isAcknowledging,
                  }}
                  style={({ pressed }) => [
                    styles.ackBtn,
                    isAcknowledging && styles.disabledBtn,
                    pressed && !isAcknowledging && styles.pressed,
                  ]}
                >
                  {isAcknowledging ? (
                    <ActivityIndicator size="small" color={colors.ustpGold} />
                  ) : (
                    <Feather
                      name="check-circle"
                      size={16}
                      color={colors.ustpGold}
                    />
                  )}
                  <Text style={styles.ackBtnText}>
                    {isAcknowledging
                      ? 'Recording...'
                      : 'I Understand & Acknowledge'}
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>
      </Modal>

      {/* Fullscreen Image Lightbox */}
      {hasImageAttachment && resolvedAttachmentUrl && (
        <Modal
          visible={isLightboxOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setIsLightboxOpen(false)}
        >
          <View style={styles.lightboxBackdrop}>
            <Pressable
              onPress={() => setIsLightboxOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="Close image preview"
              style={styles.lightboxCloseBtn}
            >
              <Feather name="x" size={24} color={colors.white} />
            </Pressable>
            <Image
              source={{ uri: resolvedAttachmentUrl }}
              resizeMode="contain"
              style={styles.lightboxImage}
            />
          </View>
        </Modal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlayBackdrop,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.white,
    borderRadius: radii.xl,
    borderWidth: 2,
    borderColor: colors.dangerBorder,
    overflow: 'hidden',
    maxHeight: '88%',
    ...elevation.overlay,
  },
  headerBar: {
    backgroundColor: colors.dangerBorder,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  headerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerIconBox: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    backgroundColor: colors.dangerTitle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: {
    flex: 1,
    gap: 2,
  },
  headerTitle: {
    fontSize: typography.sizes.sm,
    lineHeight: typography.lineHeights.sm,
    fontWeight: '900',
    color: colors.white,
    letterSpacing: 0.4,
  },
  headerSub: {
    fontSize: typography.sizes.xxs,
    lineHeight: typography.lineHeights.xxs,
    fontWeight: '700',
    color: colors.dangerBg,
  },
  closeBtn: {
    minWidth: touchTarget.minWidth,
    minHeight: touchTarget.minHeight,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
  },
  bodyContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs + 2,
  },
  urgentTag: {
    backgroundColor: colors.tagUrgentBg,
    borderWidth: 1,
    borderColor: colors.tagUrgentBorder,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  urgentTagText: {
    fontSize: typography.sizes.xxs,
    fontWeight: '900',
    color: colors.tagUrgentText,
  },
  smsTag: {
    backgroundColor: colors.warningBg,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  smsTagText: {
    fontSize: typography.sizes.xxs,
    fontWeight: '800',
    color: colors.warningText,
  },
  courseTag: {
    backgroundColor: colors.tagCourseHubBg,
    borderWidth: 1,
    borderColor: colors.tagCourseHubBorder,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  courseTagText: {
    fontSize: typography.sizes.xxs,
    fontWeight: '800',
    color: colors.tagCourseHubText,
  },
  deptTag: {
    backgroundColor: colors.tagDeptBg,
    borderWidth: 1,
    borderColor: colors.tagDeptBorder,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  deptTagText: {
    fontSize: typography.sizes.xxs,
    fontWeight: '800',
    color: colors.tagDeptText,
  },
  titleBlock: {
    gap: spacing.xs,
  },
  announcementTitle: {
    fontSize: typography.sizes.titleMd,
    lineHeight: typography.lineHeights.titleMd,
    fontWeight: '900',
    color: colors.ustpText,
  },
  metaText: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    color: colors.mutedSlate,
    ...typography.tabularNums,
  },
  metaAuthor: {
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  contentBox: {
    backgroundColor: colors.ustpCream,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  contentText: {
    fontSize: typography.sizes.body,
    lineHeight: typography.lineHeights.body,
    color: colors.ustpText,
  },
  attachmentSection: {
    gap: spacing.xs,
  },
  imagePreviewWrap: {
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    overflow: 'hidden',
  },
  attachmentImage: {
    width: '100%',
    height: 190,
  },
  attachmentCaptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  attachmentCaption: {
    flex: 1,
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.mutedSlate,
  },
  inlineOpenBtn: {
    minHeight: 36,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  inlineOpenText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpBlue,
  },
  documentCard: {
    minHeight: touchTarget.minHeight,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  documentCopy: {
    flex: 1,
    gap: 2,
  },
  documentTitle: {
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  documentSub: {
    fontSize: typography.sizes.xxs,
    color: colors.mutedSlate,
  },
  footerBar: {
    backgroundColor: colors.surfaceSubtle,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  ackBtn: {
    minHeight: touchTarget.minHeight,
    borderRadius: radii.md,
    backgroundColor: colors.ustpNavy,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  ackBtnText: {
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.ustpGold,
  },
  secondaryBtn: {
    minHeight: touchTarget.minHeight,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.mutedSlate,
  },
  lightboxBackdrop: {
    flex: 1,
    backgroundColor: colors.overlayBackdrop,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  lightboxCloseBtn: {
    position: 'absolute',
    top: 48,
    right: 20,
    minWidth: touchTarget.minWidth,
    minHeight: touchTarget.minHeight,
    borderRadius: radii.pill,
    backgroundColor: colors.ustpNavy,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  lightboxImage: {
    width: '100%',
    height: '75%',
  },
  disabledBtn: {
    opacity: 0.6,
  },
  pressed: {
    opacity: 0.85,
  },
});
