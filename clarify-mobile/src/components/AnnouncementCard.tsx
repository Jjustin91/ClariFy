import { Feather } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors, radii, spacing, touchTarget, typography } from '../theme';
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
 * Read-only Announcement Card ported from clarify-web/src/components/announcements/AnnouncementCard.tsx.
 * - Omits create/edit/delete/pin/attachment controls for all roles in this milestone.
 * - Displays urgent and pinned styling, semantic tag pills, author & tabular published_at.
 * - Uses server-returned Read Reach verbatim.
 * - Hides the "Mark as Read / Acknowledge" button once `read_reach.has_current_user_acknowledged` is true.
 */
export function AnnouncementCard({
  announcement,
  channels = [],
  isAckLoading = false,
  onAcknowledge,
  compact = false,
}: {
  announcement: Announcement;
  channels?: Channel[];
  isAckLoading?: boolean;
  onAcknowledge?: (announcement: Announcement) => void;
  compact?: boolean;
}) {
  const matchedChannel = channels.find(
    (c) => Number(c.id) === Number(announcement.channel_id)
  );
  const isCampusWideMemo =
    announcement.channel_type === 'university' ||
    matchedChannel?.channel_type === 'university';

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

  return (
    <View
      style={[
        styles.card,
        announcement.is_urgent && styles.cardUrgent,
        !announcement.is_urgent && announcement.is_pinned && styles.cardPinned,
      ]}
    >
      {/* Top Status Strip for Urgent / Pinned */}
      {(announcement.is_urgent || announcement.is_pinned) && (
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
      <Text
        numberOfLines={compact ? 4 : undefined}
        style={styles.bodyText}
      >
        {announcement.content}
      </Text>

      {/* Footer: Honest Server Read Reach & Conditional Acknowledge Button */}
      <View style={styles.footer}>
        <ReadReachBar readReach={announcement.read_reach} />

        {!hasAcknowledged && onAcknowledge && (
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
              <Feather name="check-circle" size={16} color={colors.ustpGold} />
            )}
            <Text style={styles.ackButtonText}>
              {isAckLoading ? 'Recording...' : 'Mark as Read / Acknowledge'}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
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
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
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
  buttonPressed: {
    opacity: 0.85,
  },
});
