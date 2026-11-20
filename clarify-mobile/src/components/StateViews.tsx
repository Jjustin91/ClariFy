import { Feather } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, touchTarget, typography } from '../theme';
import type { ApiError } from '../types/api';

/**
 * Semantic Tag Pill ported from clarify-web/src/components/ui/StateViews.tsx.
 * Uses strictly centralized USTP design tokens.
 */
export function TagPill({
  tag,
  size = 'sm',
}: {
  tag: string;
  size?: 'xs' | 'sm';
}) {
  const upper = tag.toUpperCase();

  let bgColor: string = colors.tagNeutralBg;
  let borderColor: string = colors.tagNeutralBorder;
  let textColor: string = colors.tagNeutralText;

  if (upper.includes('URGENT') || upper.includes('MEMORANDUM')) {
    bgColor = colors.tagUrgentBg;
    borderColor = colors.tagUrgentBorder;
    textColor = colors.tagUrgentText;
  } else if (upper.includes('COURSE HUB')) {
    bgColor = colors.tagCourseHubBg;
    borderColor = colors.tagCourseHubBorder;
    textColor = colors.tagCourseHubText;
  } else if (
    upper.includes('OFFICIAL MEMO') ||
    upper.includes('CDO CAMPUS') ||
    upper.includes('CAMPUS')
  ) {
    bgColor = colors.tagMemoBg;
    borderColor = colors.tagMemoBorder;
    textColor = colors.tagMemoText;
  } else if (
    upper === 'CITC' ||
    upper === 'CEA' ||
    upper === 'COT' ||
    upper === 'CSM' ||
    upper.includes('IT3') ||
    upper.includes('ES211')
  ) {
    bgColor = colors.tagDeptBg;
    borderColor = colors.tagDeptBorder;
    textColor = colors.tagDeptText;
  } else if (upper.includes('FACULTY') || upper.includes('RESOLVED')) {
    bgColor = colors.tagFacultyBg;
    borderColor = colors.tagFacultyBorder;
    textColor = colors.tagFacultyText;
  }

  return (
    <View
      style={[
        styles.tagPill,
        size === 'xs' ? styles.tagPillXs : styles.tagPillSm,
        { backgroundColor: bgColor, borderColor },
      ]}
    >
      <Text
        numberOfLines={1}
        style={[
          styles.tagText,
          size === 'xs' ? styles.tagTextXs : styles.tagTextSm,
          { color: textColor },
        ]}
      >
        {tag}
      </Text>
    </View>
  );
}

/**
 * Flat skeleton loading cards matching clarify-web/src/components/ui/StateViews.tsx.
 */
export function SkeletonCards({ count = 3 }: { count?: number }) {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading content"
      style={styles.skeletonStack}
    >
      {Array.from({ length: count }).map((_, idx) => (
        <View key={`skeleton-${idx}`} style={styles.skeletonCard}>
          <View style={styles.skeletonHeaderRow}>
            <View style={[styles.skeletonBar, styles.skeletonTitle]} />
            <View style={[styles.skeletonBarLight, styles.skeletonTime]} />
          </View>
          <View style={styles.skeletonPillRow}>
            <View style={styles.skeletonPillWide} />
            <View style={styles.skeletonPillNarrow} />
          </View>
          <View style={styles.skeletonBodyGroup}>
            <View style={[styles.skeletonBar, styles.skeletonLineFull]} />
            <View style={[styles.skeletonBar, styles.skeletonLineLong]} />
            <View style={[styles.skeletonBarLight, styles.skeletonLineShort]} />
          </View>
          <View style={styles.skeletonFooterRow}>
            <View style={[styles.skeletonBarLight, styles.skeletonReadReach]} />
            <View style={[styles.skeletonBar, styles.skeletonAction]} />
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * Error Banner with Retry button, offline guidance for network errors (status 0),
 * and non-destructive permission styling for HTTP 403.
 */
export function ErrorBanner({
  error,
  message,
  onRetry,
  retryLabel = 'Retry',
}: {
  error?: ApiError | null;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  const status = error?.status;
  const isOffline = status === 0;
  const isForbidden = status === 403;

  const heading = isOffline
    ? 'You appear to be offline'
    : isForbidden
      ? 'Permission Required'
      : 'Unable to load latest data';

  const bodyText =
    message ||
    error?.message ||
    (isOffline
      ? 'No network connection detected. Check your internet connection and try again.'
      : 'Something went wrong while contacting ClariFy. Please try again.');

  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.errorCard,
        isForbidden ? styles.errorCardWarning : styles.errorCardDanger,
      ]}
    >
      <View style={styles.errorHeaderRow}>
        <Feather
          name={isOffline ? 'wifi-off' : isForbidden ? 'lock' : 'alert-triangle'}
          size={18}
          color={isForbidden ? colors.warningText : colors.dangerTitle}
        />
        <View style={styles.errorTextWrap}>
          <Text
            style={[
              styles.errorHeading,
              isForbidden ? styles.warningTitleText : styles.dangerTitleText,
            ]}
          >
            {heading}
          </Text>
          <Text
            style={[
              styles.errorMessage,
              isForbidden ? styles.warningBodyText : styles.dangerBodyText,
            ]}
          >
            {bodyText}
          </Text>
        </View>
      </View>

      {onRetry && (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel={retryLabel}
          style={({ pressed }) => [
            styles.retryButton,
            pressed && styles.pressed,
          ]}
        >
          <Feather name="refresh-cw" size={14} color={colors.white} />
          <Text style={styles.retryButtonText}>{retryLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

/**
 * Empty state card ported from clarify-web/src/components/ui/StateViews.tsx.
 */
export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.emptyCard}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDescription}>{description}</Text>
      {actionLabel && onAction && (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          style={({ pressed }) => [
            styles.emptyActionButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.emptyActionText}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tagPill: {
    borderWidth: 1,
    borderRadius: radii.sm,
    alignSelf: 'flex-start',
  },
  tagPillXs: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  tagPillSm: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 3,
  },
  tagText: {
    fontWeight: '700',
  },
  tagTextXs: {
    fontSize: typography.sizes.xxs,
    lineHeight: typography.lineHeights.xxs,
  },
  tagTextSm: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
  },
  skeletonStack: {
    gap: spacing.md,
  },
  skeletonCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  skeletonHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  skeletonBar: {
    height: 14,
    backgroundColor: colors.skeletonBase,
    borderRadius: radii.sm,
  },
  skeletonBarLight: {
    height: 12,
    backgroundColor: colors.skeletonLight,
    borderRadius: radii.sm,
  },
  skeletonTitle: {
    width: '65%',
    height: 18,
  },
  skeletonTime: {
    width: 60,
  },
  skeletonPillRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  skeletonPillWide: {
    width: 88,
    height: 20,
    backgroundColor: colors.skeletonLight,
    borderRadius: radii.sm,
  },
  skeletonPillNarrow: {
    width: 56,
    height: 20,
    backgroundColor: colors.skeletonLight,
    borderRadius: radii.sm,
  },
  skeletonBodyGroup: {
    gap: spacing.xs + 2,
  },
  skeletonLineFull: {
    width: '100%',
  },
  skeletonLineLong: {
    width: '88%',
  },
  skeletonLineShort: {
    width: '55%',
  },
  skeletonFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  skeletonReadReach: {
    width: '48%',
  },
  skeletonAction: {
    width: 96,
    height: 28,
  },
  errorCard: {
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  errorCardDanger: {
    backgroundColor: colors.dangerBg,
    borderColor: colors.dangerBorder,
  },
  errorCardWarning: {
    backgroundColor: colors.warningBg,
    borderColor: colors.warningBorder,
  },
  errorHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  errorTextWrap: {
    flex: 1,
    gap: spacing.xs,
  },
  errorHeading: {
    fontSize: typography.sizes.body,
    lineHeight: typography.lineHeights.body,
    fontWeight: '800',
  },
  dangerTitleText: {
    color: colors.dangerTitle,
  },
  warningTitleText: {
    color: colors.warningText,
  },
  errorMessage: {
    fontSize: typography.sizes.sm,
    lineHeight: typography.lineHeights.sm,
  },
  dangerBodyText: {
    color: colors.dangerText,
  },
  warningBodyText: {
    color: colors.warningText,
  },
  retryButton: {
    alignSelf: 'flex-start',
    minHeight: touchTarget.minHeight,
    minWidth: touchTarget.minWidth,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.ustpNavy,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  retryButtonText: {
    fontSize: typography.sizes.sm,
    lineHeight: typography.lineHeights.sm,
    fontWeight: '700',
    color: colors.white,
  },
  emptyCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.xxl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  emptyTitle: {
    fontSize: typography.sizes.bodyLg,
    lineHeight: typography.lineHeights.bodyLg,
    fontWeight: '800',
    color: colors.ustpText,
    textAlign: 'center',
  },
  emptyDescription: {
    fontSize: typography.sizes.body,
    lineHeight: typography.lineHeights.body,
    color: colors.mutedSlate,
    textAlign: 'center',
  },
  emptyActionButton: {
    marginTop: spacing.sm,
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.ustpNavy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyActionText: {
    fontSize: typography.sizes.sm,
    lineHeight: typography.lineHeights.sm,
    fontWeight: '700',
    color: colors.white,
  },
  pressed: {
    opacity: 0.85,
  },
});
