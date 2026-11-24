import { Redirect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AnnouncementCard } from '@/components/AnnouncementCard';
import { AnnouncementFormModal } from '@/components/AnnouncementFormModal';
import { MobileAppShell } from '@/components/MobileAppShell';
import {
  EmptyState,
  ErrorBanner,
  SkeletonCards,
} from '@/components/StateViews';
import { useAuth } from '@/context/AuthContext';
import { useChannels } from '@/context/ChannelsContext';
import { useAnnouncementsFeed } from '@/hooks/useAnnouncementsFeed';
import {
  canPublishOrManageAnnouncements,
  formatCourseHubName,
  formatHubActivityBreakdownChips,
} from '@/lib/domain-logic';
import { getChannelMembersCount } from '@/lib/feed-reducer';
import { colors, radii, spacing, touchTarget, typography } from '@/theme';
import type { Announcement } from '@/types/api';

/**
 * ClariFy Mobile Dashboard ported from clarify-web/app/page.tsx.
 * - Gold "Welcome back!" banner
 * - Latest announcements (GET /announcements?sort=latest&page=1&per_page=2) with Read Reach & Acknowledge
 * - Course Hubs activity summary (GET /channels using members_count, never loading full rosters)
 */
export default function MobileDashboardScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const {
    channels,
    allCourseHubs,
    joinedCourseHubs,
    primaryChannelId,
    isLoadingChannels,
    isRefreshingChannels,
    channelsError,
    refreshChannels,
  } = useChannels();

  const isAdmin = user?.role === 'it_admin';
  const canManageAnnouncements = Boolean(
    user && canPublishOrManageAnnouncements(user.role)
  );
  const [editingAnnouncement, setEditingAnnouncement] =
    useState<Announcement | null>(null);

  const feed = useAnnouncementsFeed({
    sort: 'latest',
    perPage: 2,
    enabled: Boolean(user && !isAdmin),
  });

  const handlePullRefresh = useCallback(() => {
    void Promise.all([feed.refresh(), refreshChannels()]);
  }, [feed, refreshChannels]);

  if (!user) {
    return null;
  }

  if (isAdmin) {
    return <Redirect href="/admin?tab=verifications" />;
  }

  const updatedHubs = joinedCourseHubs.filter((ch) => ch.has_updates === true);
  const openHubsRoute = `/channels/${primaryChannelId ?? 0}`;

  return (
    <MobileAppShell title="Dashboard">
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={feed.isRefreshing || isRefreshingChannels}
            onRefresh={handlePullRefresh}
            tintColor={colors.ustpNavy}
            colors={[colors.ustpNavy]}
          />
        }
      >
        {/* Top Banner matching clarify-web/app/page.tsx */}
        <View style={styles.welcomeBanner}>
          <Text style={styles.welcomeText}>Welcome back!</Text>
        </View>

        {/* Section 1: Latest announcements */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Latest announcements</Text>
            <Pressable
              onPress={() => router.push('/announcements' as never)}
              accessibilityRole="button"
              accessibilityLabel="See all announcements"
              style={({ pressed }) => [
                styles.sectionLinkBtn,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.sectionLinkText}>See all...</Text>
            </Pressable>
          </View>

          {feed.isLoading ? (
            <SkeletonCards count={2} />
          ) : feed.error ? (
            <ErrorBanner error={feed.error} onRetry={feed.retry} />
          ) : feed.items.length === 0 ? (
            <EmptyState
              title="No Campus Announcements Yet"
              description="Scoped announcements for your courses and CDO Campus will appear here."
            />
          ) : (
            <View style={styles.cardsStack}>
              {feed.items.map((item) => (
                <AnnouncementCard
                  key={String(item.id)}
                  announcement={item}
                  channels={channels}
                  compact
                  isAckLoading={feed.ackLoadingIds.includes(item.id)}
                  isDeleting={feed.deletingIds.includes(item.id)}
                  onAcknowledge={feed.acknowledge}
                  onEdit={
                    canManageAnnouncements
                      ? (ann) => setEditingAnnouncement(ann)
                      : undefined
                  }
                  onDelete={
                    canManageAnnouncements ? feed.deleteAnnouncement : undefined
                  }
                />
              ))}
            </View>
          )}
        </View>

            {/* Section 2: Course Hubs */}
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Course Hubs</Text>
                <Pressable
                  onPress={() => router.push(openHubsRoute as never)}
                  accessibilityRole="button"
                  accessibilityLabel="Open Course Hubs"
                  style={({ pressed }) => [
                    styles.sectionLinkBtn,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.sectionLinkText}>
                    Open Course Hubs ({allCourseHubs.length}) →
                  </Text>
                </Pressable>
              </View>

              {isLoadingChannels ? (
                <SkeletonCards count={2} />
              ) : channelsError ? (
                <ErrorBanner
                  error={channelsError}
                  onRetry={() => void refreshChannels()}
                />
              ) : joinedCourseHubs.length === 0 ? (
                <EmptyState
                  title="You Haven't Joined Any Course Hubs Yet"
                  description="Open Course Hubs to inspect available scoped course noticeboards and channels."
                  actionLabel={`View Course Hubs (${allCourseHubs.length})`}
                  onAction={() => router.push(openHubsRoute as never)}
                />
              ) : (
                <View style={styles.hubsStack}>
                  {updatedHubs.length === 0 ? (
                    <View style={styles.caughtUpCard}>
                      <Text style={styles.caughtUpTitle}>
                        You&apos;re all caught up
                      </Text>
                      <Text style={styles.caughtUpDesc}>
                        None of your enrolled Course Hubs have new messages,
                        announcements, or Q&amp;A activity since your last visit.
                      </Text>
                    </View>
                  ) : (
                    updatedHubs.map((hub) => {
                      const titleDisplay = hub.course_code
                        ? `${hub.scope_section || 'Section'} — ${hub.course_code} ${formatCourseHubName(
                            hub
                          )}`
                        : formatCourseHubName(hub);
                      const newCount = Math.max(1, hub.new_activity_count || 0);
                      const badgeLabel = `${newCount} new ${
                        newCount === 1 ? 'update' : 'updates'
                      }`;
                      const breakdownChips = formatHubActivityBreakdownChips(
                        hub.new_activity_breakdown
                      );
                      const membersCount = getChannelMembersCount(hub);

                      return (
                        <Pressable
                          key={String(hub.id)}
                          onPress={() =>
                            router.push(`/channels/${hub.id}` as never)
                          }
                          accessibilityRole="button"
                          accessibilityLabel={`Open ${titleDisplay}, ${badgeLabel}`}
                          style={({ pressed }) => [
                            styles.hubUpdateCard,
                            pressed && styles.pressed,
                          ]}
                        >
                          <View style={styles.hubCardTopRow}>
                            <Text numberOfLines={1} style={styles.hubTitle}>
                              {titleDisplay}
                            </Text>
                            <View style={styles.newUpdatePill}>
                              <Text style={styles.newUpdatePillText}>
                                {badgeLabel}
                              </Text>
                            </View>
                          </View>

                          <Text numberOfLines={2} style={styles.hubPreview}>
                            {hub.latest_activity_preview ||
                              `${hub.instructor_name || 'Instructor'}: Course Hub active`}
                          </Text>

                          <View style={styles.hubMetaRow}>
                            <View style={styles.hubChipsRow}>
                              {breakdownChips.map((chip) => (
                                <View key={chip.key} style={styles.breakdownChip}>
                                  <Text style={styles.breakdownChipText}>
                                    {chip.label}
                                  </Text>
                                </View>
                              ))}
                              <Text style={styles.membersCountText}>
                                {membersCount}{' '}
                                {membersCount === 1 ? 'member' : 'members'}
                              </Text>
                            </View>
                            <Text style={styles.hubTimeText}>
                              {hub.latest_activity_at || 'Just now'}
                            </Text>
                          </View>
                        </Pressable>
                      );
                    })
                  )}
                </View>
              )}
            </View>
      </ScrollView>

      {canManageAnnouncements && (
        <AnnouncementFormModal
          visible={Boolean(editingAnnouncement)}
          mode={
            editingAnnouncement?.channel_type === 'university'
              ? 'campus_wide'
              : 'course_hub'
          }
          editingAnnouncement={editingAnnouncement}
          onClose={() => setEditingAnnouncement(null)}
          onSaved={() => void feed.refresh()}
        />
      )}
    </MobileAppShell>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    padding: spacing.lg,
    gap: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  welcomeBanner: {
    alignSelf: 'flex-start',
    backgroundColor: colors.ustpGold,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radii.xxl,
  },
  welcomeText: {
    fontSize: typography.sizes.titleLg,
    lineHeight: typography.lineHeights.titleLg,
    fontWeight: '900',
    color: colors.white,
  },
  section: {
    gap: spacing.md,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  sectionTitle: {
    fontSize: typography.sizes.titleSm,
    lineHeight: typography.lineHeights.titleSm,
    fontWeight: '800',
    color: colors.ustpText,
  },
  sectionLinkBtn: {
    minHeight: touchTarget.minHeight,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  sectionLinkText: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '800',
    color: colors.ustpNavy,
    textDecorationLine: 'underline',
    ...typography.tabularNums,
  },
  cardsStack: {
    gap: spacing.md,
  },
  hubsStack: {
    gap: spacing.md,
  },
  caughtUpCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.xs,
  },
  caughtUpTitle: {
    fontSize: typography.sizes.bodyLg,
    lineHeight: typography.lineHeights.bodyLg,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  caughtUpDesc: {
    fontSize: typography.sizes.sm,
    lineHeight: typography.lineHeights.sm,
    color: colors.mutedSlate,
    textAlign: 'center',
  },
  hubUpdateCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.urgentCardBorder,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.xs + 2,
  },
  hubCardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  hubTitle: {
    flex: 1,
    fontSize: typography.sizes.body,
    lineHeight: typography.lineHeights.body,
    fontWeight: '800',
    color: colors.ustpText,
  },
  newUpdatePill: {
    backgroundColor: colors.tagUrgentBg,
    borderWidth: 1,
    borderColor: colors.tagUrgentBorder,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  newUpdatePillText: {
    fontSize: typography.sizes.xxs,
    lineHeight: typography.lineHeights.xxs,
    fontWeight: '800',
    color: colors.tagUrgentText,
    ...typography.tabularNums,
  },
  hubPreview: {
    fontSize: typography.sizes.sm,
    lineHeight: typography.lineHeights.sm,
    color: colors.mutedSlate,
  },
  hubMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  hubChipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs + 2,
  },
  breakdownChip: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  breakdownChipText: {
    fontSize: typography.sizes.xxs,
    fontWeight: '700',
    color: colors.ustpNavy,
    ...typography.tabularNums,
  },
  membersCountText: {
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.mutedSlate,
    ...typography.tabularNums,
  },
  hubTimeText: {
    fontSize: typography.sizes.xxs,
    color: colors.mutedSlate,
    ...typography.tabularNums,
  },
  pressed: {
    opacity: 0.85,
  },
});
