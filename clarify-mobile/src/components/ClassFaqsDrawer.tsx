import { Feather } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { extractPublishedFaqs } from '../lib/qa-reducer';
import {
  colors,
  elevation,
  radii,
  spacing,
  touchTarget,
  typography,
} from '../theme';
import type { ApiError, QaThread } from '../types/api';
import { EmptyState, ErrorBanner, SkeletonCards } from './StateViews';

export interface ClassFaqsDrawerProps {
  visible: boolean;
  onClose: () => void;
  channelTitle: string;
  hasActiveChannel: boolean;
  threads: QaThread[];
  isLoading: boolean;
  error: ApiError | null;
  onRetry: () => void;
  /** Optional FAQ ID to auto-expand when opened directly after pinning a Q&A ticket */
  highlightedFaqId?: number | null;
}

/**
 * Right-hand slide-over Class FAQs Drawer ported from
 * clarify-web/app/channels/[channelId]/page.tsx (lines 1518-1760).
 *
 * - Accessible from the top Course Hub bar across Feed, Q&A, and Chat.
 * - Enforces strict "Anonymous Student" privacy masking on every pinned FAQ
 *   via `extractPublishedFaqs` (never displays or retains sender_id or real name).
 * - Implements all four UI states: Skeleton, Error with Retry, Empty, and Populated.
 */
export function ClassFaqsDrawer({
  visible,
  onClose,
  channelTitle,
  hasActiveChannel,
  threads,
  isLoading,
  error,
  onRetry,
  highlightedFaqId = null,
}: ClassFaqsDrawerProps) {
  const insets = useSafeAreaInsets();
  const [openFaqIds, setOpenFaqIds] = useState<number[]>([]);
  const [prevHighlightedId, setPrevHighlightedId] = useState<number | null>(
    highlightedFaqId
  );

  if (highlightedFaqId !== prevHighlightedId) {
    setPrevHighlightedId(highlightedFaqId);
    if (highlightedFaqId && highlightedFaqId > 0) {
      setOpenFaqIds((prev) =>
        prev.includes(highlightedFaqId) ? prev : [highlightedFaqId, ...prev]
      );
    }
  }

  const publishedFaqs = useMemo(() => extractPublishedFaqs(threads), [threads]);

  const toggleFaqAccordion = (faqId: number) => {
    setOpenFaqIds((prev) =>
      prev.includes(faqId)
        ? prev.filter((id) => id !== faqId)
        : [...prev, faqId]
    );
  };

  const renderFaqCard = ({ item: faq }: { item: QaThread }) => {
    const isExpanded = openFaqIds.includes(faq.id);
    const latestReplyObj =
      faq.replies.length > 0
        ? faq.replies[faq.replies.length - 1]
        : undefined;
    const latestReply =
      latestReplyObj?.content || 'Resolved during consultation.';
    const facultyReplyHeader = latestReplyObj?.author?.name
      ? `Faculty reply · ${latestReplyObj.author.name}`
      : 'Faculty reply';

    return (
      <View style={styles.faqCard}>
        <Pressable
          onPress={() => toggleFaqAccordion(faq.id)}
          accessibilityRole="button"
          accessibilityLabel={`Class FAQ ${faq.subject_hashtag}`}
          accessibilityState={{ expanded: isExpanded }}
          style={({ pressed }) => [
            styles.faqHeaderBtn,
            pressed && styles.pressed,
          ]}
        >
          <Text numberOfLines={2} style={styles.faqHashtag}>
            {faq.subject_hashtag}
          </Text>
          <Feather
            name={isExpanded ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={colors.mutedSlate}
          />
        </Pressable>

        {isExpanded && (
          <View style={styles.faqBody}>
            <View style={styles.anonRow}>
              <View style={styles.maskedAvatar}>
                <Feather name="user" size={12} color={colors.ustpNavy} />
              </View>
              <Text style={styles.anonText}>Asked by: Anonymous Student</Text>
            </View>

            <Text style={styles.questionText}>{faq.content}</Text>

            <View style={styles.replyBox}>
              <Text style={styles.replyHeading}>{facultyReplyHeader}</Text>
              <Text style={styles.replyText}>{latestReply}</Text>
            </View>
          </View>
        )}
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlayRoot}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close Class FAQs backdrop"
        />

        <View
          style={[
            styles.drawerPanel,
            {
              paddingTop: Math.max(insets.top, spacing.md),
              paddingBottom: Math.max(insets.bottom, spacing.md),
            },
          ]}
        >
          {/* Drawer Header */}
          <View style={styles.headerRow}>
            <View style={styles.headerTitleGroup}>
              <Feather name="book-open" size={18} color={colors.ustpOrange} />
              <Text style={styles.headerTitle}>Class FAQs</Text>
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>
                  {publishedFaqs.length}
                </Text>
              </View>
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close Class FAQs panel"
              style={({ pressed }) => [
                styles.closeBtn,
                pressed && styles.pressed,
              ]}
            >
              <Feather name="x" size={20} color={colors.ustpNavy} />
            </Pressable>
          </View>

          {hasActiveChannel && (
            <Text numberOfLines={1} style={styles.hubSubtitle}>
              {channelTitle} • Verified Instructor Answers
            </Text>
          )}

          {/* Four States: Loading Skeleton, Error with Retry, Empty, Populated */}
          {!hasActiveChannel ? (
            <View style={styles.stateWrap}>
              <EmptyState
                title="No Course Hub Selected"
                description="Join or select a Course Hub to view its published Class FAQs."
              />
            </View>
          ) : isLoading && publishedFaqs.length === 0 ? (
            <View style={styles.stateWrap}>
              <SkeletonCards count={3} />
            </View>
          ) : error && publishedFaqs.length === 0 ? (
            <View style={styles.stateWrap}>
              <ErrorBanner error={error} onRetry={onRetry} />
            </View>
          ) : publishedFaqs.length === 0 ? (
            <View style={styles.stateWrap}>
              <EmptyState
                title="No Class FAQs Published Yet"
                description="When faculty pin a Q&A answer to Class FAQs, it appears here with student identity strictly anonymized."
              />
            </View>
          ) : (
            <FlatList
              data={publishedFaqs}
              keyExtractor={(item) => String(item.id)}
              renderItem={renderFaqCard}
              contentContainerStyle={styles.listContent}
              ItemSeparatorComponent={() => <View style={styles.listGap} />}
              ListHeaderComponent={
                error ? (
                  <View style={styles.inlineErrorWrap}>
                    <ErrorBanner error={error} onRetry={onRetry} />
                  </View>
                ) : undefined
              }
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlayRoot: {
    flex: 1,
    flexDirection: 'row',
  },
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlayBackdrop,
  },
  drawerPanel: {
    width: 320,
    maxWidth: '88%',
    height: '100%',
    backgroundColor: colors.white,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
    paddingHorizontal: spacing.md,
    ...elevation.overlay,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: spacing.sm,
    marginBottom: spacing.xs,
  },
  headerTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  headerTitle: {
    fontSize: typography.sizes.bodyLg,
    lineHeight: typography.lineHeights.bodyLg,
    fontWeight: '800',
    color: colors.ustpText,
  },
  countBadge: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  countBadgeText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpNavy,
    ...typography.tabularNums,
  },
  closeBtn: {
    minWidth: touchTarget.minWidth,
    minHeight: touchTarget.minHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hubSubtitle: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '600',
    color: colors.mutedSlate,
    marginBottom: spacing.md,
  },
  stateWrap: {
    paddingTop: spacing.md,
  },
  inlineErrorWrap: {
    marginBottom: spacing.md,
  },
  listContent: {
    paddingBottom: spacing.xxl,
  },
  listGap: {
    height: spacing.sm + 2,
  },
  faqCard: {
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    overflow: 'hidden',
  },
  faqHeaderBtn: {
    minHeight: touchTarget.minHeight,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  faqHashtag: {
    flex: 1,
    fontSize: typography.sizes.sm,
    lineHeight: typography.lineHeights.sm,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  faqBody: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing.md,
    gap: spacing.sm,
  },
  anonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  maskedAvatar: {
    width: 22,
    height: 22,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  anonText: {
    fontSize: typography.sizes.xxs,
    fontWeight: '700',
    color: colors.mutedSlate,
  },
  questionText: {
    fontSize: typography.sizes.sm,
    lineHeight: typography.lineHeights.sm,
    color: colors.ustpText,
  },
  replyBox: {
    backgroundColor: colors.ustpCream,
    borderWidth: 1,
    borderColor: colors.tagMemoBorder,
    borderLeftWidth: 3,
    borderLeftColor: colors.ustpNavy,
    borderRadius: radii.md,
    padding: spacing.sm + 2,
    gap: spacing.xs,
  },
  replyHeading: {
    fontSize: typography.sizes.xxs,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  replyText: {
    fontSize: typography.sizes.sm,
    lineHeight: typography.lineHeights.sm,
    fontWeight: '500',
    color: colors.ustpText,
  },
  pressed: {
    opacity: 0.85,
  },
});
