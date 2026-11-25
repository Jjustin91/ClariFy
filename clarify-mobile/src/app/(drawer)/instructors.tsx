import { Feather } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { FilterPopover } from '@/components/FilterPopover';
import { MobileAppShell } from '@/components/MobileAppShell';
import {
  EmptyState,
  ErrorBanner,
  SkeletonCards,
  TagPill,
} from '@/components/StateViews';
import { useAuth } from '@/context/AuthContext';
import { getInstructorsApi } from '@/lib/api-client';
import { colors, radii, spacing, touchTarget, typography } from '@/theme';
import type { ApiError, Instructor, PaginatedMeta } from '@/types/api';

const DEPARTMENTS = ['ALL', 'CITC', 'CEA', 'COT', 'CSM'] as const;

/**
 * ClariFy Mobile View Faculty Directory ported from
 * clarify-web/app/instructors/page.tsx.
 * Connects to GET /api/v1/instructors with server pagination, search, department filter, and sort.
 */
export default function MobileInstructorsScreen() {
  const { user } = useAuth();

  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [department, setDepartment] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<'name' | 'department'>('name');

  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [meta, setMeta] = useState<PaginatedMeta>({
    current_page: 1,
    last_page: 1,
    per_page: 12,
    total: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [selectedInstructor, setSelectedInstructor] =
    useState<Instructor | null>(null);

  const seqRef = useRef(0);
  const inFlightMoreRef = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const fetchInstructors = useCallback(
    async (targetPage: number, mode: 'initial' | 'refresh' | 'more') => {
      if (!user || user.role === 'it_admin') {
        return;
      }
      if (mode === 'more') {
        if (inFlightMoreRef.current) return;
        inFlightMoreRef.current = true;
        setIsLoadingMore(true);
      } else if (mode === 'refresh') {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      const seq = ++seqRef.current;

      try {
        const res = await getInstructorsApi({
          search: debouncedSearch.trim() || undefined,
          department,
          sort: sortBy,
          page: targetPage,
          per_page: 12,
        });

        if (seq !== seqRef.current) return;

        const list = Array.isArray(res?.data) ? res.data : [];
        const nextMeta = res?.meta ?? {
          current_page: targetPage,
          last_page: targetPage,
          per_page: 12,
          total: list.length,
        };

        setInstructors((prev) => {
          if (mode !== 'more') return list;
          const existingIds = new Set(prev.map((i) => i.id));
          return [...prev, ...list.filter((i) => !existingIds.has(i.id))];
        });
        setMeta(nextMeta);
      } catch (err) {
        if (seq !== seqRef.current) return;
        setError(err as ApiError);
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
        setIsLoadingMore(false);
        if (mode === 'more') {
          inFlightMoreRef.current = false;
        }
      }
    },
    [user, debouncedSearch, department, sortBy]
  );

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) {
        void fetchInstructors(1, 'initial');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [fetchInstructors]);

  const hasMore = meta.current_page < meta.last_page;

  const handleLoadMore = useCallback(() => {
    if (isLoading || isRefreshing || isLoadingMore || !hasMore) {
      return;
    }
    void fetchInstructors(meta.current_page + 1, 'more');
  }, [isLoading, isRefreshing, isLoadingMore, hasMore, fetchInstructors, meta.current_page]);

  const handleResetFilters = () => {
    setSearchInput('');
    setDebouncedSearch('');
    setDepartment('ALL');
    setSortBy('name');
  };

  const renderItem = useCallback(
    ({ item }: { item: Instructor }) => {
      const isSelected = selectedInstructor?.id === item.id;
      const initials = item.name
        .replace(/^(ENGR\.|PROF\.|DR\.)\s*/i, '')
        .split(' ')
        .slice(0, 2)
        .map((part) => part.charAt(0))
        .join('');

      return (
        <Pressable
          onPress={() =>
            setSelectedInstructor((prev) => (prev?.id === item.id ? null : item))
          }
          accessibilityRole="button"
          accessibilityLabel={`View consultation details for ${item.name}`}
          accessibilityState={{ expanded: isSelected }}
          style={({ pressed }) => [
            styles.facultyCard,
            isSelected && styles.facultyCardSelected,
            pressed && styles.pressed,
          ]}
        >
          <View style={styles.facultyTopRow}>
            <View style={styles.avatarCircle}>
              {item.avatar_url ? (
                <Image
                  source={{ uri: item.avatar_url }}
                  accessibilityLabel={item.name}
                  style={styles.avatarImage}
                />
              ) : (
                <Text style={styles.avatarInitials}>{initials || 'F'}</Text>
              )}
            </View>

            <View style={styles.facultyInfoWrap}>
              <Text style={styles.facultyName}>{item.name}</Text>
              <Text numberOfLines={1} style={styles.facultySpec}>
                {item.specialization}
              </Text>
              <Text style={styles.facultyHours}>{item.consultation_hours}</Text>
              <View style={styles.badgeRow}>
                <View style={styles.campusBadge}>
                  <Text style={styles.campusBadgeText}>{item.campus}</Text>
                </View>
                <TagPill tag={item.department} size="xs" />
              </View>
            </View>

            <Feather
              name={isSelected ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={colors.ustpNavy}
            />
          </View>

          {isSelected && (
            <View style={styles.detailsBox}>
              <Text style={styles.detailRow}>
                <Text style={styles.detailLabel}>Office: </Text>
                {item.office_location}
              </Text>
              <Text style={styles.detailRow}>
                <Text style={styles.detailLabel}>Consultation: </Text>
                {item.consultation_hours}
              </Text>
              <Text style={styles.detailRow}>
                <Text style={styles.detailLabel}>Email: </Text>
                {item.email}
              </Text>
              {item.courses_handled && item.courses_handled.length > 0 && (
                <Text style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Courses Handled: </Text>
                  {item.courses_handled.join(', ')}
                </Text>
              )}
            </View>
          )}
        </Pressable>
      );
    },
    [selectedInstructor]
  );

  const keyExtractor = useCallback((item: Instructor) => String(item.id), []);

  const activeFilterCount =
    (department !== 'ALL' ? 1 : 0) + (sortBy !== 'name' ? 1 : 0);

  const renderHeader = () => (
    <View style={styles.controlsWrap}>
      {/* Search Bar + Single Filter Button */}
      <View style={styles.searchFilterRow}>
        <View style={styles.searchBox}>
          <Feather name="search" size={16} color={colors.mutedSlate} />
          <TextInput
            value={searchInput}
            onChangeText={setSearchInput}
            placeholder="Search faculty, courses..."
            placeholderTextColor={colors.placeholder}
            returnKeyType="search"
            accessibilityLabel="Search verified instructors"
            style={styles.searchInput}
          />
          {searchInput.length > 0 && (
            <Pressable
              onPress={() => {
                setSearchInput('');
                setDebouncedSearch('');
              }}
              accessibilityRole="button"
              accessibilityLabel="Clear instructor search"
              style={styles.clearBtn}
            >
              <Feather name="x" size={16} color={colors.mutedSlate} />
            </Pressable>
          )}
        </View>

        <FilterPopover
          title="Filter & Sort Faculty"
          accessibilityLabel="Filter and sort verified instructors"
          activeCount={activeFilterCount}
          onReset={() => {
            setDepartment('ALL');
            setSortBy('name');
          }}
          sections={[
            {
              kind: 'single',
              id: 'mobile-faculty-dept',
              label: 'College / Department',
              value: department,
              onChange: (val) => setDepartment(val),
              options: DEPARTMENTS.map((dept) => ({
                value: dept,
                label: dept === 'ALL' ? 'All Colleges / Depts' : dept,
              })),
            },
            {
              kind: 'single',
              id: 'mobile-faculty-sort',
              label: 'Sort by',
              value: sortBy,
              activeTone: 'blue',
              onChange: (val) => setSortBy(val as 'name' | 'department'),
              options: [
                { value: 'name', label: 'Name (A–Z)' },
                { value: 'department', label: 'Department' },
              ],
            },
          ]}
        />
      </View>

      {error && instructors.length > 0 && (
        <ErrorBanner
          error={error}
          onRetry={() => void fetchInstructors(1, 'initial')}
        />
      )}
    </View>
  );

  const renderEmpty = () => {
    if (isLoading) {
      return <SkeletonCards count={4} />;
    }
    if (error) {
      return (
        <ErrorBanner
          error={error}
          onRetry={() => void fetchInstructors(1, 'initial')}
        />
      );
    }
    return (
      <EmptyState
        title="No Verified Instructors Found"
        description="No faculty directory entries match your current search or department filter."
        actionLabel="Show All Instructors"
        onAction={handleResetFilters}
      />
    );
  };

  const renderFooter = () => {
    if (isLoading || instructors.length === 0) return null;
    if (isLoadingMore) {
      return (
        <View style={styles.footerLoader}>
          <ActivityIndicator size="small" color={colors.ustpNavy} />
          <Text style={styles.footerText}>Loading more faculty...</Text>
        </View>
      );
    }
    return (
      <View style={styles.footerSummary}>
        <Text style={styles.footerText}>
          Showing {instructors.length} of {meta.total}{' '}
          {meta.total === 1 ? 'instructor' : 'instructors'} • Page{' '}
          {meta.current_page} of {Math.max(1, meta.last_page)}
        </Text>
        {hasMore && (
          <Pressable
            onPress={handleLoadMore}
            accessibilityRole="button"
            accessibilityLabel="Load more instructors"
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
    <MobileAppShell title="View Faculty">
      <FlatList
        data={isLoading ? [] : instructors}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={renderFooter}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => void fetchInstructors(1, 'refresh')}
            tintColor={colors.ustpNavy}
            colors={[colors.ustpNavy]}
          />
        }
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.4}
      />
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
  searchFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  searchBox: {
    flex: 1,
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
  clearBtn: {
    minWidth: touchTarget.minWidth,
    minHeight: touchTarget.minHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  facultyCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  facultyCardSelected: {
    borderColor: colors.ustpNavy,
    borderWidth: 2,
  },
  facultyTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  avatarCircle: {
    width: 56,
    height: 56,
    borderRadius: radii.pill,
    backgroundColor: colors.ustpNavy,
    borderWidth: 2,
    borderColor: colors.ustpGold,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarInitials: {
    fontSize: typography.sizes.bodyLg,
    fontWeight: '900',
    color: colors.ustpGold,
  },
  facultyInfoWrap: {
    flex: 1,
    gap: 3,
  },
  facultyName: {
    fontSize: typography.sizes.body,
    lineHeight: typography.lineHeights.body,
    fontWeight: '800',
    color: colors.ustpText,
  },
  facultySpec: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    color: colors.mutedSlate,
  },
  facultyHours: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '700',
    color: colors.ustpNavy,
    ...typography.tabularNums,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs + 2,
    marginTop: 2,
  },
  campusBadge: {
    backgroundColor: colors.ustpGold,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  campusBadgeText: {
    fontSize: typography.sizes.xxs,
    lineHeight: typography.lineHeights.xxs,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  detailsBox: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    gap: spacing.xs + 2,
  },
  detailRow: {
    fontSize: typography.sizes.sm,
    lineHeight: typography.lineHeights.sm,
    color: colors.ustpText,
  },
  detailLabel: {
    fontWeight: '800',
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
