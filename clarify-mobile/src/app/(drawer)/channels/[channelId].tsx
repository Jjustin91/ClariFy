import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AnnouncementCard } from '@/components/AnnouncementCard';
import { MobileAppShell } from '@/components/MobileAppShell';
import { ScopedChannelsDrawer } from '@/components/ScopedChannelsDrawer';
import {
  EmptyState,
  ErrorBanner,
  SkeletonCards,
} from '@/components/StateViews';
import { useAuth } from '@/context/AuthContext';
import { useChannels } from '@/context/ChannelsContext';
import { useAnnouncementsFeed } from '@/hooks/useAnnouncementsFeed';
import {
  formatCourseHubName,
  formatEnrolledRosterSummary,
  getChannelFacultyLabel,
  getSubChannelsForHub,
  resolveCourseHubSelection,
} from '@/lib/domain-logic';
import { getChannelMembersCount } from '@/lib/feed-reducer';
import { colors, radii, spacing, touchTarget, typography } from '@/theme';
import type { Announcement } from '@/types/api';

/**
 * ClariFy Mobile Course Hub & Scoped Channels screen ported from
 * clarify-web/app/channels/[channelId]/page.tsx.
 * Read-only Noticeboard Feed + Scoped Channels drawer (no chat, Q&A, create/edit/delete yet).
 */
export default function MobileChannelHubScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ channelId?: string }>();
  const requestedChannelId = Number(params?.channelId || 0);

  const { user } = useAuth();
  const {
    channels,
    isLoadingChannels,
    isRefreshingChannels,
    channelsError,
    refreshChannels,
  } = useChannels();

  const [isChannelsDrawerOpen, setIsChannelsDrawerOpen] = useState(false);

  const selection = useMemo(() => {
    const base = resolveCourseHubSelection(channels, requestedChannelId, user);
    // If user explicitly navigated to a scoped Course Hub (e.g. from the drawer), allow viewing it so server 403/200 policies apply cleanly
    const exactMatch =
      requestedChannelId > 0
        ? channels.find((c) => c.id === requestedChannelId)
        : undefined;
    if (exactMatch && !base.activeChannel) {
      return {
        ...base,
        activeChannel: exactMatch,
        channelId: exactMatch.id,
      };
    }
    if (
      exactMatch &&
      exactMatch.channel_type === 'course_hub' &&
      !exactMatch.parent_hub_id &&
      exactMatch.id !== base.channelId
    ) {
      return {
        ...base,
        activeChannel: exactMatch,
        channelId: exactMatch.id,
      };
    }
    return base;
  }, [channels, requestedChannelId, user]);

  const activeChannel = selection.activeChannel;
  const effectiveChannelId = selection.channelId;

  const subChannels = useMemo(
    () =>
      effectiveChannelId > 0
        ? getSubChannelsForHub(channels, effectiveChannelId)
        : [],
    [channels, effectiveChannelId]
  );

  const feed = useAnnouncementsFeed({
    channelId: effectiveChannelId > 0 ? effectiveChannelId : null,
    sort: 'latest',
    perPage: 10,
    enabled: Boolean(user && user.role !== 'it_admin' && effectiveChannelId > 0),
  });

  const handleSelectHub = useCallback(
    (hubId: number) => {
      router.replace(`/channels/${hubId}` as never);
    },
    [router]
  );

  const handleRefreshAll = useCallback(() => {
    void Promise.all([
      refreshChannels(),
      effectiveChannelId > 0 ? feed.refresh() : Promise.resolve(),
    ]);
  }, [refreshChannels, effectiveChannelId, feed]);

  const renderItem = useCallback(
    ({ item }: { item: Announcement }) => (
      <AnnouncementCard
        announcement={item}
        channels={channels}
        isAckLoading={feed.ackLoadingIds.includes(item.id)}
        onAcknowledge={feed.acknowledge}
      />
    ),
    [channels, feed.ackLoadingIds, feed.acknowledge]
  );

  const keyExtractor = useCallback((item: Announcement) => String(item.id), []);

  const membersCount = getChannelMembersCount(activeChannel);

  const shellTitle = activeChannel
    ? formatCourseHubName(activeChannel)
    : 'Course Hubs';

  const renderListHeader = () => (
    <View style={styles.hubInfoWrap}>
      {activeChannel && (
        <View style={styles.hubSummaryCard}>
          <View style={styles.hubSummaryTopRow}>
            <View style={styles.hubSummaryTitleWrap}>
              <Text style={styles.hubSummaryTitle}>
                {formatCourseHubName(activeChannel)}
              </Text>
              <Text style={styles.hubSummaryScope}>
                {[
                  activeChannel.course_code,
                  activeChannel.scope_college,
                  activeChannel.scope_section,
                ]
                  .filter(Boolean)
                  .join(' • ')}
              </Text>
            </View>
            <View style={styles.noticeboardBadge}>
              <Text style={styles.noticeboardBadgeText}>Noticeboard</Text>
            </View>
          </View>

          <Text style={styles.hubSummaryFaculty}>
            Faculty: {getChannelFacultyLabel(activeChannel)}
          </Text>
          <Text style={styles.hubSummaryMembers}>
            {formatEnrolledRosterSummary(activeChannel)}
          </Text>

          {subChannels.length > 0 && (
            <View style={styles.subPillsRow}>
              {subChannels.map((sub) => (
                <View key={String(sub.id)} style={styles.subPill}>
                  <Text style={styles.subPillText}>
                    # {sub.name.replace(/^#\s*/, '').trim()}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {feed.error && feed.items.length > 0 && (
        <ErrorBanner error={feed.error} onRetry={feed.retry} />
      )}
    </View>
  );

  const renderListEmpty = () => {
    if (isLoadingChannels || (effectiveChannelId > 0 && feed.isLoading)) {
      return <SkeletonCards count={3} />;
    }
    if (channelsError) {
      return (
        <ErrorBanner
          error={channelsError}
          onRetry={() => void refreshChannels()}
        />
      );
    }
    if (!activeChannel || effectiveChannelId <= 0) {
      return (
        <EmptyState
          title="No Course Hub Selected"
          description="Open Scoped Channels to select a Course Hub and view its noticeboard announcements."
          actionLabel="Open Scoped Channels"
          onAction={() => setIsChannelsDrawerOpen(true)}
        />
      );
    }
    if (feed.error) {
      return <ErrorBanner error={feed.error} onRetry={feed.retry} />;
    }
    return (
      <EmptyState
        title="No Announcements in This Course Hub"
        description={`Official notices posted to ${formatCourseHubName(
          activeChannel
        )} will appear here.`}
      />
    );
  };

  const renderListFooter = () => {
    if (feed.isLoading || feed.items.length === 0) {
      return null;
    }
    if (feed.isLoadingMore) {
      return (
        <View style={styles.footerLoader}>
          <ActivityIndicator size="small" color={colors.ustpNavy} />
          <Text style={styles.footerText}>Loading older announcements...</Text>
        </View>
      );
    }
    return (
      <View style={styles.footerSummary}>
        <Text style={styles.footerText}>
          Showing {feed.items.length} of {feed.meta.total}{' '}
          {feed.meta.total === 1 ? 'announcement' : 'announcements'} • Page{' '}
          {feed.meta.current_page} of {Math.max(1, feed.meta.last_page)}
        </Text>
        {feed.hasMore && (
          <Pressable
            onPress={() => void feed.loadMore()}
            accessibilityRole="button"
            accessibilityLabel="Load more channel announcements"
            style={({ pressed }) => [
              styles.loadMoreBtn,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.loadMoreBtnText}>Load More</Text>
          </Pressable>
        )}
      </View>
    );
  };

  return (
    <MobileAppShell title={shellTitle}>
      {/* Compact Scoped Channels Switcher Strip matching clarify-web mobile bar */}
      <View style={styles.switcherBar}>
        <Pressable
          onPress={() => setIsChannelsDrawerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Open Scoped Channels list"
          style={({ pressed }) => [
            styles.switcherButton,
            pressed && styles.pressed,
          ]}
        >
          <Feather name="hash" size={16} color={colors.ustpGold} />
          <Text numberOfLines={1} style={styles.switcherButtonText}>
            {activeChannel
              ? `${formatCourseHubName(activeChannel)} • Noticeboard`
              : 'Select Course Hub'}
          </Text>
          <Feather name="chevron-down" size={16} color={colors.ustpGold} />
        </Pressable>

        {activeChannel && (
          <View style={styles.membersBadge}>
            <Feather name="users" size={13} color={colors.ustpGold} />
            <Text style={styles.membersBadgeText}>{membersCount}</Text>
          </View>
        )}
      </View>

      <FlatList
        data={
          isLoadingChannels || feed.isLoading || effectiveChannelId <= 0
            ? []
            : feed.items
        }
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ListHeaderComponent={renderListHeader}
        ListEmptyComponent={renderListEmpty}
        ListFooterComponent={renderListFooter}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        refreshControl={
          <RefreshControl
            refreshing={feed.isRefreshing || isRefreshingChannels}
            onRefresh={handleRefreshAll}
            tintColor={colors.ustpNavy}
            colors={[colors.ustpNavy]}
          />
        }
        onEndReached={() => void feed.loadMore()}
        onEndReachedThreshold={0.4}
      />

      <ScopedChannelsDrawer
        visible={isChannelsDrawerOpen}
        onClose={() => setIsChannelsDrawerOpen(false)}
        channels={channels}
        activeChannel={activeChannel}
        isLoading={isLoadingChannels}
        error={channelsError}
        onRetry={() => void refreshChannels()}
        onSelectHub={handleSelectHub}
      />
    </MobileAppShell>
  );
}

const styles = StyleSheet.create({
  switcherBar: {
    backgroundColor: colors.ustpNavyDark,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.ustpNavyBorder,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  switcherButton: {
    flex: 1,
    minHeight: touchTarget.minHeight,
    backgroundColor: colors.ustpNavySurface,
    borderWidth: 1,
    borderColor: colors.ustpNavyBorder,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  switcherButtonText: {
    flex: 1,
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpGold,
  },
  membersBadge: {
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.ustpNavySurface,
    borderWidth: 1,
    borderColor: colors.ustpNavyBorder,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  membersBadgeText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.white,
    ...typography.tabularNums,
  },
  listContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
    flexGrow: 1,
  },
  hubInfoWrap: {
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  hubSummaryCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.xs + 2,
  },
  hubSummaryTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  hubSummaryTitleWrap: {
    flex: 1,
    gap: 2,
  },
  hubSummaryTitle: {
    fontSize: typography.sizes.titleSm,
    lineHeight: typography.lineHeights.titleSm,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  hubSummaryScope: {
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.mutedSlate,
  },
  noticeboardBadge: {
    backgroundColor: colors.ustpGold,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  noticeboardBadgeText: {
    fontSize: typography.sizes.xxs,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  hubSummaryFaculty: {
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.ustpText,
  },
  hubSummaryMembers: {
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.mutedSlate,
    ...typography.tabularNums,
  },
  subPillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs + 2,
    paddingTop: spacing.xs,
  },
  subPill: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  subPillText: {
    fontSize: typography.sizes.xxs,
    fontWeight: '700',
    color: colors.ustpNavy,
  },
  separator: {
    height: spacing.md,
  },
  footerLoader: {
    paddingVertical: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  footerSummary: {
    paddingTop: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  footerText: {
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.mutedSlate,
    textAlign: 'center',
    ...typography.tabularNums,
  },
  loadMoreBtn: {
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.ustpNavy,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadMoreBtnText: {
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  pressed: {
    opacity: 0.85,
  },
});
