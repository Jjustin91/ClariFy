import { Feather } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useAuth } from '../context/AuthContext';
import { resolveApiAssetUrl } from '../lib/api-client';
import {
  canManageAnnouncement,
  parseAnnouncementAttachment,
} from '../lib/domain-logic';
import {
  colors,
  elevation,
  radii,
  spacing,
  touchTarget,
  typography,
} from '../theme';
import type { Announcement, Channel } from '../types/api';
import { ReadReachBar } from './ReadReachBar';
import { TagPill } from './StateViews';

/**
 * Formats an ISO timestamp in Asia/Manila time matching clarify-web's AnnouncementCard.
 */
export function formatAnnouncementTimestamp(iso: string): string {
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return iso;
    }
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Manila',
    });
  } catch {
    return iso;
  }
}

function formatRoleLabel(role: Announcement['publisher']['role']): string {
  if (role === 'faculty') return 'Faculty';
  if (role === 'dept_head') return 'Department Head';
  if (role === 'student') return 'Student';
  return role.replace('_', ' ').toUpperCase();
}

/**
 * Announcement Card ported from clarify-web/src/components/announcements/AnnouncementCard.tsx.
 * - Renders urgent/pinned/draft styling, semantic tag pills, author & tabular published_at.
 * - Renders inline image previews with full-screen lightbox + document open/download controls.
 * - Displays Edit & Delete (with confirmation popup) strictly for authorized faculty/dept_head roles
 *   and NEVER for students.
 * - Uses server-returned Read Reach verbatim and hides Acknowledge once acknowledged.
 */
export function AnnouncementCard({
  announcement,
  channels = [],
  isAckLoading = false,
  isDeleting = false,
  onAcknowledge,
  onEdit,
  onDelete,
  compact = false,
}: {
  announcement: Announcement;
  channels?: Channel[];
  isAckLoading?: boolean;
  isDeleting?: boolean;
  onAcknowledge?: (announcement: Announcement) => void;
  onEdit?: (announcement: Announcement) => void;
  onDelete?: (announcement: Announcement) => Promise<void> | void;
  compact?: boolean;
}) {
  const { user, showToast } = useAuth();
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isOpeningAttachment, setIsOpeningAttachment] = useState(false);

  const matchedChannel = channels.find(
    (c) => Number(c.id) === Number(announcement.channel_id)
  );
  const isCampusWideMemo =
    announcement.channel_type === 'university' ||
    matchedChannel?.channel_type === 'university';

  const canManage =
    canManageAnnouncement(announcement, user, channels) &&
    Boolean(onEdit || onDelete);
  const isStudent = user?.role === 'student';

  const {
    cleanContent,
    attachmentUrl: rawAttachmentUrl,
    attachmentName,
    attachmentType,
  } = parseAnnouncementAttachment(announcement);

  const resolvedAttachmentUrl = resolveApiAssetUrl(rawAttachmentUrl);
  const isRenderableImage = Boolean(
    attachmentType === 'image' && resolvedAttachmentUrl
  );
  const hasAttachment = Boolean(resolvedAttachmentUrl || attachmentName);

  const courseCode =
    announcement.course_code ||
    (!isCampusWideMemo ? matchedChannel?.course_code : null) ||
    null;

  const courseHubName =
    announcement.channel_name ||
    (!isCampusWideMemo && matchedChannel?.name
      ? matchedChannel.name.replace(/^#\s*/, '').trim()
      : null);

  const departmentSubtitle =
    !isCampusWideMemo && courseHubName
      ? `${courseHubName} • ${announcement.publisher.department || 'CITC'} Department`
      : announcement.subtitle &&
          announcement.subtitle !== 'USTP Digital Transformation'
        ? announcement.subtitle
        : `${announcement.publisher.department || 'CITC'} Department`;

  const displayTags: string[] = isCampusWideMemo
    ? announcement.tags || []
    : Array.from(
        new Set([
          ...(announcement.is_urgent ? ['URGENT NOTICE'] : []),
          'COURSE HUB',
          ...(courseCode ? [courseCode] : []),
          ...(announcement.tags || []),
        ])
      );

  const publishedFormatted = formatAnnouncementTimestamp(
    announcement.published_at
  );
  const editedFormatted = announcement.is_edited
    ? formatAnnouncementTimestamp(announcement.updated_at)
    : null;

  const hasAcknowledged = Boolean(
    announcement.read_reach?.has_current_user_acknowledged
  );

  const resolvedDocumentName =
    attachmentName ||
    (isCampusWideMemo
      ? 'Official_USTP_Attachment.pdf'
      : 'Course_Hub_Attachment.pdf');

  const handleOpenAttachment = async () => {
    if (isOpeningAttachment) return;
    if (!resolvedAttachmentUrl) {
      showToast(
        `Attachment "${resolvedDocumentName}" has no downloadable file URL.`,
        'info'
      );
      return;
    }

    setIsOpeningAttachment(true);
    try {
      if (
        resolvedAttachmentUrl.startsWith('http://') ||
        resolvedAttachmentUrl.startsWith('https://')
      ) {
        await WebBrowser.openBrowserAsync(resolvedAttachmentUrl);
      } else {
        const supported = await Linking.canOpenURL(resolvedAttachmentUrl);
        if (supported) {
          await Linking.openURL(resolvedAttachmentUrl);
        } else {
          showToast(
            'Unable to open this attachment format on your device.',
            'info'
          );
        }
      }
    } catch {
      try {
        await Linking.openURL(resolvedAttachmentUrl);
      } catch {
        showToast('Unable to open attachment. Please try again.', 'error');
      }
    } finally {
      setIsOpeningAttachment(false);
    }
  };

  const handleConfirmDelete = async () => {
    setIsDeleteConfirmOpen(false);
    await onDelete?.(announcement);
  };

  return (
    <>
      <View
        style={[
          styles.card,
          announcement.is_urgent && styles.cardUrgent,
          !announcement.is_urgent && announcement.is_pinned && styles.cardPinned,
        ]}
      >
        {/* Top Row: Status Pills on Left, Faculty/Dept Head Edit & Delete on Right */}
        {(announcement.is_urgent ||
          announcement.is_pinned ||
          announcement.status === 'draft' ||
          canManage) && (
          <View style={styles.topActionStrip}>
            <View style={styles.statusRow}>
              {announcement.is_urgent && (
                <View style={styles.urgentIndicator}>
                  <Feather
                    name="alert-circle"
                    size={13}
                    color={colors.tagUrgentText}
                  />
                  <Text style={styles.urgentIndicatorText}>URGENT NOTICE</Text>
                </View>
              )}
              {announcement.is_pinned && (
                <View style={styles.pinnedIndicator}>
                  <Feather name="bookmark" size={13} color={colors.ustpNavy} />
                  <Text style={styles.pinnedIndicatorText}>Pinned</Text>
                </View>
              )}
              {announcement.status === 'draft' && (
                <View style={styles.draftIndicator}>
                  <Text style={styles.draftIndicatorText}>DRAFT</Text>
                </View>
              )}
            </View>

            {canManage && (
              <View style={styles.manageActionsRow}>
                {onEdit && (
                  <Pressable
                    onPress={() => onEdit(announcement)}
                    disabled={isDeleting}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit announcement ${announcement.title}`}
                    style={({ pressed }) => [
                      styles.iconActionBtn,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <Feather name="edit-2" size={15} color={colors.ustpNavy} />
                  </Pressable>
                )}
                {onDelete && (
                  <Pressable
                    onPress={() => setIsDeleteConfirmOpen(true)}
                    disabled={isDeleting}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete announcement ${announcement.title}`}
                    style={({ pressed }) => [
                      styles.iconActionBtn,
                      styles.iconDeleteBtn,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    {isDeleting ? (
                      <ActivityIndicator
                        size="small"
                        color={colors.dangerBorder}
                      />
                    ) : (
                      <Feather
                        name="trash-2"
                        size={15}
                        color={colors.dangerBorder}
                      />
                    )}
                  </Pressable>
                )}
              </View>
            )}
          </View>
        )}

        {/* Title & Edited Badge */}
        <View style={styles.titleBlock}>
          <Text style={styles.title}>{announcement.title}</Text>
          {announcement.is_edited && editedFormatted && (
            <Text style={styles.editedBadge}>(Edited {editedFormatted})</Text>
          )}
          <Text style={styles.subtitle}>{departmentSubtitle}</Text>
        </View>

        {/* Semantic Tag Pills */}
        {displayTags.length > 0 && (
          <View style={styles.tagRow}>
            {displayTags.map((tag) => (
              <TagPill key={`${announcement.id}-${tag}`} tag={tag} size="xs" />
            ))}
          </View>
        )}

        {/* Publisher & Tabular Timestamp */}
        <Text style={styles.metaText}>
          Posted by {announcement.publisher.name} (
          {formatRoleLabel(announcement.publisher.role)}) • {publishedFormatted}
        </Text>

        {/* Announcement Body */}
        {cleanContent.length > 0 && (
          <Text
            numberOfLines={compact ? 4 : undefined}
            style={styles.bodyText}
          >
            {cleanContent}
          </Text>
        )}

        {/* Attached Picture (Inline Preview + Lightbox) or Document Button */}
        {isRenderableImage && resolvedAttachmentUrl ? (
          <Pressable
            onPress={() => setIsLightboxOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`View full size image ${attachmentName || announcement.title}`}
            style={({ pressed }) => [
              styles.imageAttachmentCard,
              pressed && styles.buttonPressed,
            ]}
          >
            <Image
              source={{ uri: resolvedAttachmentUrl }}
              resizeMode="cover"
              style={[
                styles.attachmentImage,
                compact && styles.attachmentImageCompact,
              ]}
              accessibilityLabel={attachmentName || announcement.title}
            />
            <View style={styles.imageAttachmentBar}>
              <Text numberOfLines={1} style={styles.imageAttachmentName}>
                {attachmentName || 'Attached Image'}
              </Text>
              <View style={styles.viewFullSizePill}>
                <Feather name="maximize-2" size={12} color={colors.ustpNavy} />
                <Text style={styles.viewFullSizeText}>View Full Size</Text>
              </View>
            </View>
          </Pressable>
        ) : hasAttachment ? (
          <Pressable
            onPress={() => void handleOpenAttachment()}
            disabled={isOpeningAttachment}
            accessibilityRole="button"
            accessibilityLabel={`Open attachment ${resolvedDocumentName}`}
            style={({ pressed }) => [
              styles.docAttachmentBtn,
              pressed && styles.buttonPressed,
            ]}
          >
            <View style={styles.docIconTile}>
              {isOpeningAttachment ? (
                <ActivityIndicator size="small" color={colors.ustpGold} />
              ) : (
                <Feather name="file-text" size={16} color={colors.ustpGold} />
              )}
            </View>
            <View style={styles.docMetaWrap}>
              <Text numberOfLines={1} style={styles.docNameText}>
                {resolvedDocumentName}
              </Text>
              <Text style={styles.docSubText}>Tap to view / download file</Text>
            </View>
            <Feather name="external-link" size={16} color={colors.ustpNavy} />
          </Pressable>
        ) : null}

        {/* Footer: Honest Server Read Reach & Conditional Acknowledge Button */}
        <View style={styles.footer}>
          <ReadReachBar readReach={announcement.read_reach} />

          {isStudent ? (
            !hasAcknowledged && onAcknowledge ? (
              <Pressable
                onPress={() => onAcknowledge(announcement)}
                disabled={isAckLoading}
                accessibilityRole="button"
                accessibilityLabel={`Mark as Read / Acknowledge ${announcement.title}`}
                style={({ pressed }) => [
                  styles.ackButton,
                  isAckLoading && styles.ackButtonDisabled,
                  pressed && !isAckLoading && styles.buttonPressed,
                ]}
              >
                {isAckLoading ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <Feather
                    name="check-circle"
                    size={16}
                    color={colors.ustpGold}
                  />
                )}
                <Text style={styles.ackButtonText}>
                  {isAckLoading ? 'Recording...' : 'Mark as Read / Acknowledge'}
                </Text>
              </Pressable>
            ) : null
          ) : (
            <View style={styles.trackingBadge}>
              <Feather name="activity" size={13} color={colors.successText} />
              <Text style={styles.trackingBadgeText}>
                Live Delivery Tracking Active
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Full-Screen Image Lightbox Modal */}
      {isRenderableImage && resolvedAttachmentUrl && (
        <Modal
          visible={isLightboxOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setIsLightboxOpen(false)}
        >
          <View style={styles.lightboxOverlay}>
            <View style={styles.lightboxCard}>
              <View style={styles.lightboxHeader}>
                <View style={styles.lightboxHeaderCopy}>
                  <Text numberOfLines={1} style={styles.lightboxTitle}>
                    {attachmentName || announcement.title}
                  </Text>
                  <Text numberOfLines={1} style={styles.lightboxSubtitle}>
                    {departmentSubtitle} • Posted by {announcement.publisher.name}
                  </Text>
                </View>
                <Pressable
                  onPress={() => setIsLightboxOpen(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Close image preview"
                  style={({ pressed }) => [
                    styles.lightboxCloseBtn,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <Feather name="x" size={20} color={colors.white} />
                </Pressable>
              </View>

              <View style={styles.lightboxImageStage}>
                <Image
                  source={{ uri: resolvedAttachmentUrl }}
                  resizeMode="contain"
                  style={styles.lightboxImage}
                />
              </View>

              <View style={styles.lightboxFooter}>
                <Pressable
                  onPress={() => void handleOpenAttachment()}
                  disabled={isOpeningAttachment}
                  accessibilityRole="button"
                  accessibilityLabel="Open or download image in browser"
                  style={({ pressed }) => [
                    styles.lightboxDownloadBtn,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <Feather name="download" size={15} color={colors.ustpNavy} />
                  <Text style={styles.lightboxDownloadText}>
                    Open / Download
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Archive / Delete Confirmation Dialog */}
      <Modal
        visible={isDeleteConfirmOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsDeleteConfirmOpen(false)}
      >
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <View style={styles.confirmHeader}>
              <Feather
                name="trash-2"
                size={18}
                color={colors.dangerBorder}
              />
              <Text style={styles.confirmTitle}>Archive Announcement?</Text>
            </View>
            <Text style={styles.confirmBody}>
              This will archive &ldquo;{announcement.title}&rdquo; and remove it
              from the active noticeboard feed for all members.
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                onPress={() => setIsDeleteConfirmOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Cancel archiving announcement"
                style={({ pressed }) => [
                  styles.confirmCancelBtn,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.confirmCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => void handleConfirmDelete()}
                accessibilityRole="button"
                accessibilityLabel="Confirm archive announcement"
                style={({ pressed }) => [
                  styles.confirmDeleteBtn,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.confirmDeleteText}>Archive</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm + 2,
  },
  cardUrgent: {
    backgroundColor: colors.urgentCardBg,
    borderColor: colors.urgentCardBorder,
    borderLeftWidth: 4,
    borderLeftColor: colors.dangerBorder,
  },
  cardPinned: {
    borderLeftWidth: 4,
    borderLeftColor: colors.ustpGold,
  },
  topActionStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  statusRow: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  urgentIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.tagUrgentBg,
    borderWidth: 1,
    borderColor: colors.tagUrgentBorder,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  urgentIndicatorText: {
    fontSize: typography.sizes.xxs,
    lineHeight: typography.lineHeights.xxs,
    fontWeight: '800',
    color: colors.tagUrgentText,
  },
  pinnedIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.ustpGoldSoft,
    borderWidth: 1,
    borderColor: colors.ustpGold,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  pinnedIndicatorText: {
    fontSize: typography.sizes.xxs,
    lineHeight: typography.lineHeights.xxs,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  draftIndicator: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  draftIndicatorText: {
    fontSize: typography.sizes.xxs,
    lineHeight: typography.lineHeights.xxs,
    fontWeight: '800',
    color: colors.mutedSlate,
  },
  manageActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  iconActionBtn: {
    minWidth: 40,
    minHeight: 40,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconDeleteBtn: {
    backgroundColor: colors.dangerBg,
    borderColor: colors.urgentCardBorder,
  },
  titleBlock: {
    gap: spacing.xxs,
  },
  title: {
    fontSize: typography.sizes.bodyLg,
    lineHeight: typography.lineHeights.bodyLg,
    fontWeight: '800',
    color: colors.ustpText,
  },
  editedBadge: {
    fontSize: typography.sizes.xxs,
    lineHeight: typography.lineHeights.xxs,
    fontWeight: '700',
    color: colors.warningText,
    ...typography.tabularNums,
  },
  subtitle: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '600',
    color: colors.mutedSlate,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs + 2,
  },
  metaText: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '600',
    color: colors.mutedSlate,
    ...typography.tabularNums,
  },
  bodyText: {
    fontSize: typography.sizes.body,
    lineHeight: typography.lineHeights.body,
    color: colors.ustpText,
  },
  imageAttachmentCard: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    overflow: 'hidden',
    backgroundColor: colors.surfaceSubtle,
  },
  attachmentImage: {
    width: '100%',
    height: 200,
    backgroundColor: colors.surfaceMuted,
  },
  attachmentImageCompact: {
    height: 150,
  },
  imageAttachmentBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  imageAttachmentName: {
    flex: 1,
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.ustpText,
  },
  viewFullSizePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  viewFullSizeText: {
    fontSize: typography.sizes.xxs,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  docAttachmentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.minHeight,
    padding: spacing.sm + 2,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  docIconTile: {
    width: 38,
    height: 38,
    borderRadius: radii.sm,
    backgroundColor: colors.ustpNavy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  docMetaWrap: {
    flex: 1,
    gap: 2,
  },
  docNameText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpBlue,
  },
  docSubText: {
    fontSize: typography.sizes.xxs,
    color: colors.mutedSlate,
  },
  footer: {
    marginTop: spacing.xs,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.md,
  },
  ackButton: {
    minHeight: touchTarget.minHeight,
    borderRadius: radii.md,
    backgroundColor: colors.ustpNavy,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  ackButtonDisabled: {
    opacity: 0.7,
  },
  ackButtonText: {
    fontSize: typography.sizes.sm,
    lineHeight: typography.lineHeights.sm,
    fontWeight: '800',
    color: colors.white,
  },
  trackingBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    backgroundColor: colors.successBg,
    borderWidth: 1,
    borderColor: colors.tagFacultyBorder,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
  },
  trackingBadgeText: {
    fontSize: typography.sizes.xxs,
    fontWeight: '800',
    color: colors.successText,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  lightboxOverlay: {
    flex: 1,
    backgroundColor: colors.overlayBackdrop,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  lightboxCard: {
    backgroundColor: colors.white,
    borderRadius: radii.xl,
    overflow: 'hidden',
    maxHeight: '88%',
    ...elevation.overlay,
  },
  lightboxHeader: {
    backgroundColor: colors.ustpNavy,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  lightboxHeaderCopy: {
    flex: 1,
    gap: 2,
  },
  lightboxTitle: {
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.white,
  },
  lightboxSubtitle: {
    fontSize: typography.sizes.xxs,
    color: colors.ustpNavyMutedText,
  },
  lightboxCloseBtn: {
    minWidth: 40,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxImageStage: {
    backgroundColor: colors.ustpText,
    height: 360,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.sm,
  },
  lightboxImage: {
    width: '100%',
    height: '100%',
  },
  lightboxFooter: {
    padding: spacing.md,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    alignItems: 'flex-end',
  },
  lightboxDownloadBtn: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.ustpGold,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  lightboxDownloadText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  confirmOverlay: {
    flex: 1,
    backgroundColor: colors.overlayBackdrop,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  confirmCard: {
    backgroundColor: colors.white,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.md,
    ...elevation.overlay,
  },
  confirmHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  confirmTitle: {
    fontSize: typography.sizes.titleSm,
    fontWeight: '800',
    color: colors.ustpText,
  },
  confirmBody: {
    fontSize: typography.sizes.sm,
    lineHeight: typography.lineHeights.sm,
    color: colors.mutedSlate,
  },
  confirmActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  confirmCancelBtn: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmCancelText: {
    fontSize: typography.sizes.sm,
    fontWeight: '700',
    color: colors.mutedSlate,
  },
  confirmDeleteBtn: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.dangerBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmDeleteText: {
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.white,
  },
});
