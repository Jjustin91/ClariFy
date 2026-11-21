import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useRef, useState } from 'react';
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
import { CourseHubChatView } from '@/components/CourseHubChatView';
import { MobileAppShell } from '@/components/MobileAppShell';
import { ScopedChannelsDrawer } from '@/components/ScopedChannelsDrawer';
import {
  EmptyState,
  ErrorBanner,
  SkeletonCards,
} from '@/components/StateViews';
import { useAuth } from '@/context/AuthContext';
import { useChannels } from '@/context/ChannelsContext';
import { useOptionalRealtime } from '@/context/RealtimeContext';
import { useAnnouncementsFeed } from '@/hooks/useAnnouncementsFeed';
import { markChannelSeenApi } from '@/lib/api-client';
import {
  formatCourseHubName,
  formatEnrolledRosterSummary,
  formatSubChannelDisplayName,
  getChannelFacultyLabel,
  getChannelParentHubId,
  getSubChannelsForHub,
  resolveCourseHubSelection,
} from '@/lib/domain-logic';
import { getChannelMembersCount } from '@/lib/feed-reducer';
import { colors, radii, spacing, touchTarget, typography } from '@/theme';
import type { Announcement, ApiError, Channel } from '@/types/api';

type HubTabKey = 'noticeboard' | 'chat';

/**
 * ClariFy Mobile Course Hub screen ported from clarify-web/app/channels/[channelId]/page.tsx.
 * - Strict invalid channel ID guard (never silently opens another hub when an unknown ID is requested)
 * - Noticeboard tab (read-only announcements feed + Read Reach + acknowledge)
 * - Chat tab (cursor-paginated inverted FlatList, optimistic send/retry, unsend, focused Reverb subscription)
 * - Calls markChannelSeenApi on focus and clears unseen hub badges locally
 */
export default function MobileChannelHubScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ channelId?: string; tab?: string }>();
  const rawChannelParam = params?.channelId;
  const parsedRequestedId = Number(rawChannelParam ?? 0);
  const hasExplicitId =
    rawChannelParam !== undefined &&
    rawChannelParam !== '' &&
    rawChannelParam !== '0';
  const isMalformedId =
    hasExplicitId &&
    (!Number.isInteger(parsedRequestedId) || parsedRequestedId <= 0);
  const requestedChannelId = isMalformedId ? -1 : parsedRequestedId;

  const { user } = useAuth();
  const {
    channels,
    isLoadingChannels,
    isRefreshingChannels,
    channelsError,
    refreshChannels,
    applyChannelsPatch,
  } = useChannels();
  const realtime = useOptionalRealtime();

  const [isChannelsDrawerOpen, setIsChannelsDrawerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<HubTabKey>(() =>
    params?.tab === 'chat' ? 'chat' : 'noticeboard'
  );
  const [selectedSubChannelId, setSelectedSubChannelId] = useState<
    number | null
  >(null);
  const [isScreenFocused, setIsScreenFocused] = useState(false);

  // Resolve active hub strictly: if an explicit non-zero channelId was requested and is missing
  // once channels finish loading, report a 404 error and NEVER fall back to another Course Hub.
  const resolution = useMemo<{
    activeHub: Channel | undefined;
    requestedSubChannel: Channel | undefined;
    isInvalidChannel: boolean;
  }>(() => {
    if (isMalformedId) {
      return {
        activeHub: undefined,
        requestedSubChannel: undefined,
        isInvalidChannel: true,
      };
    }

    if (hasExplicitId && requestedChannelId > 0) {
      const exactMatch = channels.find(
        (c) => Number(c.id) === requestedChannelId
      );
      if (!exactMatch) {
        return {
          activeHub: undefined,
          requestedSubChannel: undefined,
          isInvalidChannel: !isLoadingChannels && !channelsError,
        };
      }

      const parentHubId = getChannelParentHubId(exactMatch);
      if (parentHubId !== null) {
        const parentHub =
          channels.find((c) => Number(c.id) === parentHubId) ?? exactMatch;
        return {
          activeHub: parentHub,
          requestedSubChannel: exactMatch,
          isInvalidChannel: false,
        };
      }

      return {
        activeHub: exactMatch,
        requestedSubChannel: undefined,
        isInvalidChannel: false,
      };
    }

    // Generic entry (`/channels/0` or missing param) selects user's primary joined hub
    const base = resolveCourseHubSelection(channels, 0, user);
    return {
      activeHub: base.activeChannel,
      requestedSubChannel: base.activeSubChannel,
      isInvalidChannel: false,
    };
  }, [
    isMalformedId,
    hasExplicitId,
    requestedChannelId,
    channels,
    isLoadingChannels,
    channelsError,
    user,
  ]);

  const activeChannel = resolution.activeHub;
  const effectiveHubId = activeChannel?.id ?? 0;

  const subChannels = useMemo(
    () =>
      effectiveHubId > 0
        ? getSubChannelsForHub(channels, effectiveHubId)
        : [],
    [channels, effectiveHubId]
  );

  // Derive active chat target (either a tapped sub-channel, requested sub-channel, or parent hub)
  const effectiveChatChannel = useMemo<Channel | undefined>(() => {
    if (!activeChannel) return undefined;
    if (selectedSubChannelId) {
      const found = subChannels.find((s) => s.id === selectedSubChannelId);
      if (found) return found;
    }
    if (resolution.requestedSubChannel) {
      return resolution.requestedSubChannel;
    }
    return activeChannel;
  }, [
    activeChannel,
    selectedSubChannelId,
    subChannels,
    resolution.requestedSubChannel,
  ]);

  const effectiveChatChannelId = effectiveChatChannel?.id ?? 0;

  const seenKeyRef = useRef<string>('');
  const setActiveChannelId = realtime?.setActiveChannelId;

  useFocusEffect(
    useCallback(() => {
      setIsScreenFocused(true);

      if (
        !resolution.isInvalidChannel &&
        effectiveHubId > 0 &&
        effectiveChatChannelId > 0 &&
        user &&
        user.role !== 'it_admin'
      ) {
        setActiveChannelId?.(effectiveHubId);

        const focusSeenKey = `${user.id}:${effectiveChatChannelId}`;
        if (seenKeyRef.current !== focusSeenKey) {
          seenKeyRef.current = focusSeenKey;
          void markChannelSeenApi(effectiveChatChannelId)
            .then(() => {
              applyChannelsPatch((prev) => {
                let mutated = false;
                const next = prev.map((ch) => {
                  if (Number(ch.id) !== effectiveHubId) return ch;
                  if (!ch.has_updates && (ch.new_activity_count ?? 0) === 0) {
                    return ch;
                  }
                  mutated = true;
                  return {
                    ...ch,
                    has_updates: false,
                    new_activity_count: 0,
                    new_activity_breakdown: {
                      chat: 0,
                      announcements: 0,
                      qa: 0,
                    },
                    new_activity_sub_channel_id: null,
                  };
                });
                return { channels: mutated ? next : prev, mutated };
              });
            })
            .catch(() => {
              // Non-fatal: chat/feed views surface 403/network errors cleanly
            });
        }
      }

      return () => {
        setIsScreenFocused(false);
        seenKeyRef.current = '';
        setActiveChannelId?.(0);
      };
    }, [
      resolution.isInvalidChannel,
      effectiveHubId,
      effectiveChatChannelId,
      user,
      setActiveChannelId,
      applyChannelsPatch,
    ])
  );

  const feed = useAnnouncementsFeed({
    channelId:
      !resolution.isInvalidChannel && effectiveHubId > 0
        ? effectiveHubId
        : null,
    sort: 'latest',
    perPage: 10,
    enabled: Boolean(
      user &&
        user.role !== 'it_admin' &&
        !resolution.isInvalidChannel &&
        effectiveHubId > 0
    ),
  });

  const handleSelectHub = useCallback(
    (hubId: number) => {
      setSelectedSubChannelId(null);
      router.replace(`/channels/${hubId}` as never);
    },
    [router]
  );

  const handleRefreshAll = useCallback(() => {
    void Promise.all([
      refreshChannels(),
      !resolution.isInvalidChannel && effectiveHubId > 0
        ? feed.refresh()
        : Promise.resolve(),
    ]);
  }, [refreshChannels, resolution.isInvalidChannel, effectiveHubId, feed]);

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
  const chatCount = Math.max(0, Number(activeChannel?.chat_messages_count ?? 0));

  const shellTitle = resolution.isInvalidChannel
    ? 'Course Hub Not Found'
    : activeChannel
      ? formatCourseHubName(activeChannel)
      : 'Course Hubs';

  const notFoundError: ApiError = useMemo(
    () => ({
      status: 404,
      message: `Course Hub #${rawChannelParam || requestedChannelId} was not found or is no longer available.`,
    }),
    [rawChannelParam, requestedChannelId]
  );

  const renderHubHeader = () => (
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
              <Text style={styles.noticeboardBadgeText}>
                {activeTab === 'chat' ? 'Course Chat' : 'Noticeboard'}
              </Text>
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
              <Pressable
                onPress={() => setSelectedSubChannelId(null)}
                accessibilityRole="button"
                accessibilityLabel="Main Course Hub"
                style={({ pressed }) => [
                  styles.subPill,
                  effectiveChatChannelId === activeChannel.id &&
                    styles.subPillActive,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.subPillText,
                    effectiveChatChannelId === activeChannel.id &&
                      styles.subPillTextActive,
                  ]}
                >
                  # general
                </Text>
              </Pressable>

              {subChannels.map((sub) => {
                const isSelected = effectiveChatChannelId === sub.id;
                return (
                  <Pressable
                    key={String(sub.id)}
                    onPress={() => {
                      setSelectedSubChannelId(sub.id);
                      setActiveTab('chat');
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Open sub-channel ${formatSubChannelDisplayName(
                      sub
                    )}`}
                    style={({ pressed }) => [
                      styles.subPill,
                      isSelected && styles.subPillActive,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text
                      style={[
                        styles.subPillText,
                        isSelected && styles.subPillTextActive,
                      ]}
                    >
                      {formatSubChannelDisplayName(sub)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      )}

      {feed.error && feed.items.length > 0 && activeTab === 'noticeboard' && (
        <ErrorBanner error={feed.error} onRetry={feed.retry} />
      )}
    </View>
  );

  const renderNoticeboardEmpty = () => {
    if (isLoadingChannels || (effectiveHubId > 0 && feed.isLoading)) {
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
    if (!activeChannel || effectiveHubId <= 0) {
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

  const renderNoticeboardFooter = () => {
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
      {/* Compact Scoped Channels Switcher Strip */}
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
            {resolution.isInvalidChannel
              ? 'Select a valid Course Hub'
              : activeChannel
                ? `${formatCourseHubName(activeChannel)} • ${
                    activeTab === 'chat' ? 'Chat' : 'Noticeboard'
                  }`
                : 'Select Course Hub'}
          </Text>
          <Feather name="chevron-down" size={16} color={colors.ustpGold} />
        </Pressable>

        {activeChannel && !resolution.isInvalidChannel && (
          <View style={styles.membersBadge}>
            <Feather name="users" size={13} color={colors.ustpGold} />
            <Text style={styles.membersBadgeText}>{membersCount}</Text>
          </View>
        )}
      </View>

      {/* Noticeboard / Chat Segmented Tab Bar (48dp touch targets) */}
      {activeChannel && !resolution.isInvalidChannel && (
        <View style={styles.tabBar} accessibilityRole="tablist">
          <Pressable
            onPress={() => setActiveTab('noticeboard')}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === 'noticeboard' }}
            accessibilityLabel="Course Noticeboard tab"
            style={({ pressed }) => [
              styles.tabButton,
              activeTab === 'noticeboard' && styles.tabButtonActive,
              pressed && styles.pressed,
            ]}
          >
            <Feather
              name="bell"
              size={16}
              color={
                activeTab === 'noticeboard'
                  ? colors.ustpGold
                  : colors.ustpNavy
              }
            />
            <Text
              style={[
                styles.tabButtonText,
                activeTab === 'noticeboard' && styles.tabButtonTextActive,
              ]}
            >
              Noticeboard
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setActiveTab('chat')}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === 'chat' }}
            accessibilityLabel="Course Chat tab"
            style={({ pressed }) => [
              styles.tabButton,
              activeTab === 'chat' && styles.tabButtonActive,
              pressed && styles.pressed,
            ]}
          >
            <Feather
              name="message-square"
              size={16}
              color={
                activeTab === 'chat' ? colors.ustpGold : colors.ustpNavy
              }
            />
            <Text
              style={[
                styles.tabButtonText,
                activeTab === 'chat' && styles.tabButtonTextActive,
              ]}
            >
              Chat
            </Text>
            {chatCount > 0 && (
              <View
                style={[
                  styles.tabCountBadge,
                  activeTab === 'chat' && styles.tabCountBadgeActive,
                ]}
              >
                <Text
                  style={[
                    styles.tabCountText,
                    activeTab === 'chat' && styles.tabCountTextActive,
                  ]}
                >
                  {chatCount}
                </Text>
              </View>
            )}
          </Pressable>
        </View>
      )}

      {/* Wrong / Unknown Channel ID Guard (never silently falls back to another hub) */}
      {resolution.isInvalidChannel ? (
        <View style={styles.invalidWrap}>
          <ErrorBanner
            error={notFoundError}
            onRetry={() => void refreshChannels()}
          />
          <Pressable
            onPress={() => setIsChannelsDrawerOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Open Scoped Channels"
            style={({ pressed }) => [
              styles.openChannelsBtn,
              pressed && styles.pressed,
            ]}
          >
            <Feather name="hash" size={16} color={colors.ustpGold} />
            <Text style={styles.openChannelsBtnText}>Open Scoped Channels</Text>
          </Pressable>
        </View>
      ) : activeTab === 'chat' && effectiveChatChannel && effectiveChatChannelId > 0 ? (
        <View style={styles.chatTabContainer}>
          {subChannels.length > 0 && (
            <View style={styles.chatSubStrip}>
              <Pressable
                onPress={() => setSelectedSubChannelId(null)}
                accessibilityRole="button"
                accessibilityLabel="Switch to main Course Hub chat"
                style={({ pressed }) => [
                  styles.subPill,
                  effectiveChatChannelId === activeChannel?.id &&
                    styles.subPillActive,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.subPillText,
                    effectiveChatChannelId === activeChannel?.id &&
                      styles.subPillTextActive,
                  ]}
                >
                  # general
                </Text>
              </Pressable>
              {subChannels.map((sub) => {
                const isSelected = effectiveChatChannelId === sub.id;
                return (
                  <Pressable
                    key={String(sub.id)}
                    onPress={() => setSelectedSubChannelId(sub.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Switch to ${formatSubChannelDisplayName(
                      sub
                    )}`}
                    style={({ pressed }) => [
                      styles.subPill,
                      isSelected && styles.subPillActive,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text
                      style={[
                        styles.subPillText,
                        isSelected && styles.subPillTextActive,
                      ]}
                    >
                      {formatSubChannelDisplayName(sub)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          <CourseHubChatView
            channelId={effectiveChatChannelId}
            channelTitle={
              effectiveChatChannel.id === activeChannel?.id
                ? formatCourseHubName(activeChannel)
                : formatSubChannelDisplayName(effectiveChatChannel)
            }
            isFocused={isScreenFocused && activeTab === 'chat'}
          />
        </View>
      ) : (
        <FlatList
          data={
            isLoadingChannels || feed.isLoading || effectiveHubId <= 0
              ? []
              : feed.items
          }
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          ListHeaderComponent={renderHubHeader}
          ListEmptyComponent={renderNoticeboardEmpty}
          ListFooterComponent={renderNoticeboardFooter}
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
      )}

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
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  tabButton: {
    flex: 1,
    minHeight: touchTarget.minHeight,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceSubtle,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  tabButtonActive: {
    backgroundColor: colors.ustpNavy,
    borderColor: colors.ustpNavy,
  },
  tabButtonText: {
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  tabButtonTextActive: {
    color: colors.ustpGold,
  },
  tabCountBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  tabCountBadgeActive: {
    backgroundColor: colors.ustpGold,
    borderColor: colors.ustpGold,
  },
  tabCountText: {
    fontSize: typography.sizes.xxs,
    fontWeight: '800',
    color: colors.ustpNavy,
    ...typography.tabularNums,
  },
  tabCountTextActive: {
    color: colors.ustpNavy,
  },
  invalidWrap: {
    flex: 1,
    padding: spacing.lg,
    justifyContent: 'center',
    gap: spacing.md,
  },
  openChannelsBtn: {
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.md,
    backgroundColor: colors.ustpNavy,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    alignSelf: 'flex-start',
  },
  openChannelsBtnText: {
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.ustpGold,
  },
  chatTabContainer: {
    flex: 1,
  },
  chatSubStrip: {
    backgroundColor: colors.surfaceSubtle,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
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
    minHeight: touchTarget.minHeight,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
  },
  subPillActive: {
    backgroundColor: colors.ustpNavy,
    borderColor: colors.ustpNavy,
  },
  subPillText: {
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.ustpNavy,
  },
  subPillTextActive: {
    color: colors.ustpGold,
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
