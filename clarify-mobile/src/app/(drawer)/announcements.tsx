import { Feather } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AnnouncementCard } from '@/components/AnnouncementCard';
import {
  AnnouncementFormModal,
  type AnnouncementComposerMode,
} from '@/components/AnnouncementFormModal';
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
  canPublishCampusWideAnnouncements,
  canPublishOrManageAnnouncements,
} from '@/lib/domain-logic';
import { colors, radii, spacing, touchTarget, typography } from '@/theme';
import type { Announcement } from '@/types/api';

const FILTER_TAGS = [
  'ALL',
  'COURSE HUB',
  'URGENT NOTICE',
  'OFFICIAL MEMO',
  'CDO CAMPUS',
  'CITC',
  'CEA',
  'MEMORANDUM',
] as const;

type SortOption = {
  value: 'latest' | 'oldest' | 'read_reach';
  label: string;
};

const SORT_OPTIONS: SortOption[] = [
  { value: 'latest', label: 'Latest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'read_reach', label: 'Read Reach' },
];

/**
 * ClariFy Mobile Announcements Feed ported from clarify-web/app/announcements/page.tsx.
 * - Server-paginated via GET /announcements?search=...&tag=...&sort=...&page=...&per_page=10
 * - FlatList with stable keyExtractor, pull-to-refresh, and infinite scroll pagination
 * - Faculty & Department Head Create / Edit / Delete announcement flows (strictly hidden for students)
 */
export default function MobileAnnouncementsScreen() {
  const { user } = useAuth();
  const { channels, joinedCourseHubs, allCourseHubs } = useChannels();

  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedTag, setSelectedTag] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<'latest' | 'oldest' | 'read_reach'>(
    'latest'
  );
  const [composerState, setComposerState] = useState<{
    visible: boolean;
    mode: AnnouncementComposerMode;
    editingAnnouncement: Announcement | null;
  }>({
    visible: false,
    mode: 'campus_wide',
    editingAnnouncement: null,
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const isAdmin = user?.role === 'it_admin';

  const feed = useAnnouncementsFeed({
    search: debouncedSearch,
    tag: selectedTag,
    sort: sortBy,
    perPage: 10,
    enabled: Boolean(user && !isAdmin),
  });

  const handleResetFilters = useCallback(() => {
    setSearchInput('');
    setDebouncedSearch('');
    setSelectedTag('ALL');
    setSortBy('latest');
  }, []);

  const canPublish = Boolean(
    user && canPublishOrManageAnnouncements(user.role)
  );
  const canPublishCampusWide = Boolean(
    user && canPublishCampusWideAnnouncements(user.role)
  );
  const hasHandledHubs = joinedCourseHubs.length > 0 || allCourseHubs.length > 0;

  const handleOpenCreate = useCallback(
    (mode: AnnouncementComposerMode) => {
      setComposerState({
        visible: true,
        mode,
        editingAnnouncement: null,
      });
    },
    []
  );

  const handleOpenEdit = useCallback((announcement: Announcement) => {
    setComposerState({
      visible: true,
      mode:
        announcement.channel_type === 'university'
          ? 'campus_wide'
          : 'course_hub',
      editingAnnouncement: announcement,
    });
  }, []);

  const handleCloseComposer = useCallback(() => {
    setComposerState((prev) => ({
      ...prev,
      visible: false,
      editingAnnouncement: null,
    }));
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: Announcement }) => (
      <AnnouncementCard
        announcement={item}
        channels={channels}
        isAckLoading={feed.ackLoadingIds.includes(item.id)}
        isDeleting={feed.deletingIds.includes(item.id)}
        onAcknowledge={feed.acknowledge}
        onEdit={canPublish ? handleOpenEdit : undefined}
        onDelete={canPublish ? feed.deleteAnnouncement : undefined}
      />
    ),
    [
      channels,
      feed.ackLoadingIds,
      feed.deletingIds,
      feed.acknowledge,
      feed.deleteAnnouncement,
      canPublish,
      handleOpenEdit,
    ]
  );

  const keyExtractor = useCallback((item: Announcement) => String(item.id), []);

  const renderListHeader = () => (
    <View style={styles.controlsWrap}>
      {/* Search Input */}
      <View style={styles.searchBox}>
        <Feather name="search" size={16} color={colors.mutedSlate} />
        <TextInput
          value={searchInput}
          onChangeText={setSearchInput}
          placeholder="Search... (e.g., IT314, ES211a, CEA)"
          placeholderTextColor={colors.placeholder}
          returnKeyType="search"
          accessibilityLabel="Search announcements by course code, keyword, or department"
          style={styles.searchInput}
        />
        {searchInput.length > 0 && (
          <Pressable
            onPress={() => {
              setSearchInput('');
              setDebouncedSearch('');
            }}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            style={styles.clearIconBtn}
          >
            <Feather name="x" size={16} color={colors.mutedSlate} />
          </Pressable>
        )}
      </View>

      {/* Sort Selector */}
      <View style={styles.sortRow}>
        <Text style={styles.sortLabel}>Sort by:</Text>
        <View style={styles.sortPillsRow}>
          {SORT_OPTIONS.map((opt) => {
            const active = sortBy === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => setSortBy(opt.value)}
                accessibilityRole="button"
                accessibilityLabel={`Sort announcements by ${opt.label}`}
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [
                  styles.sortPill,
                  active && styles.sortPillActive,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.sortPillText,
                    active && styles.sortPillTextActive,
                  ]}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Horizontal Tag Filter Row */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tagScrollRow}
      >
        {FILTER_TAGS.map((tag) => {
          const active = selectedTag === tag;
          const label = tag === 'ALL' ? 'All Tags' : tag;
          return (
            <Pressable
              key={tag}
              onPress={() => setSelectedTag(tag)}
              accessibilityRole="button"
              accessibilityLabel={`Filter by ${label}`}
              accessibilityState={{ selected: active }}
              style={({ pressed }) => [
                styles.filterChip,
                active && styles.filterChipActive,
                pressed && styles.pressed,
              ]}
            >
              <Text
                style={[
                  styles.filterChipText,
                  active && styles.filterChipTextActive,
                ]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Faculty / Department Head Quick-Create Trigger Bar (Strictly Hidden for Students) */}
      {canPublish && (canPublishCampusWide || hasHandledHubs) && (
        <Pressable
          onPress={() =>
            handleOpenCreate(
              canPublishCampusWide ? 'campus_wide' : 'course_hub'
            )
          }
          accessibilityRole="button"
          accessibilityLabel={
            canPublishCampusWide
              ? 'Create Campus-Wide Announcement'
              : 'Create Course Hub Announcement'
          }
          style={({ pressed }) => [
            styles.quickCreateBar,
            pressed && styles.pressed,
          ]}
        >
          <View style={styles.quickCreateLeft}>
            <View style={styles.quickCreateBadge}>
              <Feather name="plus" size={14} color={colors.ustpGold} />
            </View>
            <Text style={styles.quickCreateText}>
              {canPublishCampusWide
                ? 'Create Campus-Wide Announcement'
                : 'Create Course Hub Announcement'}
            </Text>
          </View>
          <View style={styles.quickCreateIcons}>
            <Feather name="file-text" size={16} color={colors.ustpNavy} />
            <Feather name="image" size={16} color={colors.ustpNavy} />
          </View>
        </Pressable>
      )}

      {/* Inline error banner if refresh/pagination failed while items are displayed */}
      {feed.error && feed.items.length > 0 && (
        <ErrorBanner error={feed.error} onRetry={feed.retry} />
      )}
    </View>
  );

  const renderListFooter = () => {
    if (feed.isLoading || feed.items.length === 0) {
      return null;
    }

    if (feed.isLoadingMore) {
      return (
        <View style={styles.footerLoader}>
          <ActivityIndicator size="small" color={colors.ustpNavy} />
          <Text style={styles.footerText}>Loading more announcements...</Text>
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
            accessibilityLabel="Load more announcements"
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

  const renderListEmpty = () => {
    if (feed.isLoading) {
      return <SkeletonCards count={4} />;
    }
    if (feed.error) {
      return <ErrorBanner error={feed.error} onRetry={feed.retry} />;
    }
    const hasFilters = Boolean(debouncedSearch.trim()) || selectedTag !== 'ALL';
    return (
      <EmptyState
        title={
          hasFilters
            ? 'No Announcements Match Your Filter'
            : 'No Announcements Yet'
        }
        description={
          hasFilters
            ? "Try clearing your search query or selecting 'All Tags' to view all campus and department notices."
            : 'Scoped campus and course announcements will appear here once published.'
        }
        actionLabel={hasFilters ? 'Reset Filters' : undefined}
        onAction={hasFilters ? handleResetFilters : undefined}
      />
    );
  };

  return (
    <MobileAppShell title="Announcements">
      <FlatList
        data={feed.isLoading ? [] : feed.items}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ListHeaderComponent={renderListHeader}
        ListEmptyComponent={renderListEmpty}
        ListFooterComponent={renderListFooter}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        refreshControl={
          <RefreshControl
            refreshing={feed.isRefreshing}
            onRefresh={() => void feed.refresh()}
            tintColor={colors.ustpNavy}
            colors={[colors.ustpNavy]}
          />
        }
        onEndReached={() => void feed.loadMore()}
        onEndReachedThreshold={0.4}
      />

      {canPublish && (
        <AnnouncementFormModal
          visible={composerState.visible}
          mode={composerState.mode}
          editingAnnouncement={composerState.editingAnnouncement}
          allowModeSwitch={canPublishCampusWide}
          onClose={handleCloseComposer}
          onSaved={() => void feed.refresh()}
        />
      )}
    </MobileAppShell>
  );
}

const styles = StyleSheet.create({
  listContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
    flexGrow: 1,
  },
  controlsWrap: {
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  searchBox: {
    minHeight: touchTarget.minHeight,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.xl,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    minHeight: touchTarget.minHeight,
    fontSize: typography.sizes.body,
    color: colors.ustpText,
  },
  clearIconBtn: {
    minWidth: touchTarget.minWidth,
    minHeight: touchTarget.minHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  sortLabel: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpText,
  },
  sortPillsRow: {
    flexDirection: 'row',
    gap: spacing.xs + 2,
  },
  sortPill: {
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sortPillActive: {
    backgroundColor: colors.ustpNavy,
    borderColor: colors.ustpNavy,
  },
  sortPillText: {
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.ustpText,
  },
  sortPillTextActive: {
    color: colors.ustpGold,
    fontWeight: '800',
  },
  tagScrollRow: {
    gap: spacing.xs + 2,
    paddingVertical: 2,
  },
  filterChip: {
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterChipActive: {
    backgroundColor: colors.ustpNavy,
    borderColor: colors.ustpNavy,
  },
  filterChipText: {
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.mutedSlate,
  },
  filterChipTextActive: {
    color: colors.ustpGold,
    fontWeight: '800',
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
  quickCreateBar: {
    minHeight: touchTarget.minHeight + 4,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.ustpNavy,
    borderRadius: radii.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  quickCreateLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  quickCreateBadge: {
    width: 28,
    height: 28,
    borderRadius: radii.md,
    backgroundColor: colors.ustpNavy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickCreateText: {
    flex: 1,
    fontSize: typography.sizes.sm,
    fontWeight: '700',
    color: colors.ustpText,
  },
  quickCreateIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pressed: {
    opacity: 0.85,
  },
});
