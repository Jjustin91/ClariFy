import { Feather } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../context/AuthContext';
import { useChannels } from '../context/ChannelsContext';
import { deleteChannelApi } from '../lib/api-client';
import {
  formatCourseHubName,
  formatEnrolledRosterSummary,
  formatUnreadBadgeCount,
  getChannelFacultyLabel,
  isUserCourseAdmin,
} from '../lib/domain-logic';
import {
  buildScopedChannelHierarchy,
  type CourseHubHierarchyNode,
} from '../lib/feed-reducer';
import {
  colors,
  elevation,
  radii,
  spacing,
  touchTarget,
  typography,
} from '../theme';
import type { ApiError, Channel } from '../types/api';

export type CourseHubDrawerTab = 'noticeboard' | 'qa' | 'chat';

/**
 * Left-hand Scoped Channels & Course Hubs Drawer ported from
 * clarify-web/app/channels/[channelId]/page.tsx (lines 597-952).
 * - Top action buttons: Add Course Hub & Browse Course Hubs.
 * - Displays joined Course Hubs with Noticeboard Feed, Isolated Q&A Threads,
 *   and active nested #channels (with Course Admin Edit, + Add Channel, and Delete).
 * - Uses `members_count` / `students_count` strictly; never loads full rosters.
 */
export function ScopedChannelsDrawer({
  visible,
  onClose,
  channels,
  activeChannel,
  activeTab,
  activeChatChannelId,
  isLoading,
  error,
  onRetry,
  onSelectHub,
  onSelectQa,
  onSelectSubChannel,
  onOpenAddHub,
  onOpenBrowseHubs,
  onOpenEditHub,
  onOpenAddChannel,
  onSubChannelDeleted,
}: {
  visible: boolean;
  onClose: () => void;
  channels: Channel[];
  activeChannel?: Channel;
  activeTab?: CourseHubDrawerTab;
  activeChatChannelId?: number;
  isLoading: boolean;
  error: ApiError | null;
  onRetry: () => void;
  onSelectHub: (hubId: number) => void;
  onSelectQa?: (hubId: number) => void;
  onSelectSubChannel?: (hubId: number, subChannelId: number) => void;
  onOpenAddHub?: () => void;
  onOpenBrowseHubs?: () => void;
  onOpenEditHub?: (hubId: number) => void;
  onOpenAddChannel?: (hubId: number) => void;
  onSubChannelDeleted?: (hubId: number, deletedSubId: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const { user, showToast } = useAuth();
  const { refreshChannels } = useChannels();

  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedHubIds, setCollapsedHubIds] = useState<number[]>([]);
  const [confirmDeleteSubId, setConfirmDeleteSubId] = useState<number | null>(
    null
  );
  const [deletingSubId, setDeletingSubId] = useState<number | null>(null);

  const hierarchy = useMemo(
    () => buildScopedChannelHierarchy(channels, user, searchQuery),
    [channels, user, searchQuery]
  );

  const joinedHierarchy = useMemo(
    () => hierarchy.filter((node) => node.isJoined),
    [hierarchy]
  );

  const totalJoinedHubsCount = useMemo(
    () =>
      buildScopedChannelHierarchy(channels, user, '').filter(
        (node) => node.isJoined
      ).length,
    [channels, user]
  );

  const toggleExpanded = (hubId: number) => {
    setCollapsedHubIds((prev) =>
      prev.includes(hubId)
        ? prev.filter((id) => id !== hubId)
        : [...prev, hubId]
    );
  };

  const handleDeleteSubChannel = async (hubId: number, sub: Channel) => {
    if (deletingSubId !== null) return;
    const cleanName = sub.name.replace(/^#\s*/, '').trim();
    setDeletingSubId(sub.id);
    try {
      const res = await deleteChannelApi(sub.id);
      await refreshChannels();
      setConfirmDeleteSubId(null);
      showToast(res.message || `Deleted # ${cleanName}.`, 'info');
      onSubChannelDeleted?.(hubId, sub.id);
    } catch (err) {
      const apiErr = err as ApiError;
      showToast(apiErr?.message || 'Failed to delete channel.', 'error');
    } finally {
      setDeletingSubId(null);
    }
  };

  const renderHubNode = ({ item }: { item: CourseHubHierarchyNode }) => {
    const { hub, subChannels, membersCount } = item;
    const isCurrentHub = activeChannel?.id === hub.id;
    const isExpanded =
      !collapsedHubIds.includes(hub.id) || searchQuery.trim().length > 0;
    const isNoticeboardActive =
      isCurrentHub && (!activeTab || activeTab === 'noticeboard');
    const isQaActive = isCurrentHub && activeTab === 'qa';
    const unreadQaCount = Math.max(0, Number(hub.unread_count ?? 0));
    const isHubCourseAdmin = isUserCourseAdmin(hub, user);

    return (
      <View style={[styles.hubCard, isCurrentHub && styles.hubCardActive]}>
        {/* Course Hub Header Row */}
        <View style={styles.hubHeaderRow}>
          <Pressable
            onPress={() => toggleExpanded(hub.id)}
            accessibilityRole="button"
            accessibilityLabel={`Toggle ${formatCourseHubName(hub)} spaces and channels`}
            accessibilityState={{ expanded: isExpanded }}
            style={({ pressed }) => [
              styles.hubHeaderBtn,
              pressed && styles.pressed,
            ]}
          >
            <Feather
              name={isExpanded ? 'chevron-down' : 'chevron-right'}
              size={16}
              color={isCurrentHub ? colors.ustpGold : colors.ustpNavyMutedText}
            />
            <View style={styles.hubHeaderTextWrap}>
              <Text
                numberOfLines={1}
                style={[
                  styles.hubNameText,
                  isCurrentHub && styles.hubNameTextActive,
                ]}
              >
                {formatCourseHubName(hub)}
              </Text>
              <Text style={styles.hubMetaLine}>
                {[hub.course_code, hub.scope_section]
                  .filter(Boolean)
                  .join(' • ')}{' '}
                • {membersCount} {membersCount === 1 ? 'member' : 'members'}
              </Text>
            </View>
            {unreadQaCount > 0 && (
              <View style={styles.hubUnreadBadge}>
                <Text style={styles.hubUnreadBadgeText}>
                  {formatUnreadBadgeCount(unreadQaCount)}
                </Text>
              </View>
            )}
          </Pressable>

          {/* Per-Hub Quick Actions: Edit (Course Admin) & + Add Channel */}
          <View style={styles.hubQuickActions}>
            {isHubCourseAdmin && onOpenEditHub && (
              <Pressable
                onPress={() => {
                  onClose();
                  onOpenEditHub(hub.id);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${formatCourseHubName(hub)}`}
                style={({ pressed }) => [
                  styles.hubIconBtn,
                  pressed && styles.pressed,
                ]}
              >
                <Feather
                  name="edit-3"
                  size={15}
                  color={colors.ustpNavyMutedText}
                />
              </Pressable>
            )}
            {onOpenAddChannel && (
              <Pressable
                onPress={() => {
                  onClose();
                  onOpenAddChannel(hub.id);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Add channel to ${formatCourseHubName(hub)}`}
                style={({ pressed }) => [
                  styles.hubIconBtn,
                  pressed && styles.pressed,
                ]}
              >
                <Feather name="plus" size={16} color={colors.ustpGold} />
              </Pressable>
            )}
          </View>
        </View>

        {/* Expanded Spaces & Active Nested Sub-Channels */}
        {isExpanded && (
          <View style={styles.hubBody}>
            {/* 1. Built-in Course Hub Spaces: Noticeboard Feed & Isolated Q&A Threads */}
            <Pressable
              onPress={() => {
                onSelectHub(hub.id);
                onClose();
              }}
              accessibilityRole="button"
              accessibilityLabel={`Open Noticeboard Feed for ${formatCourseHubName(hub)}`}
              accessibilityState={{ selected: isNoticeboardActive }}
              style={({ pressed }) => [
                styles.spaceRow,
                isNoticeboardActive && styles.spaceRowActive,
                pressed && styles.pressed,
              ]}
            >
              <Feather
                name="volume-2"
                size={15}
                color={isNoticeboardActive ? colors.ustpNavy : colors.ustpGold}
              />
              <Text
                numberOfLines={1}
                style={[
                  styles.spaceRowText,
                  isNoticeboardActive && styles.spaceRowTextActive,
                ]}
              >
                Noticeboard Feed
              </Text>
            </Pressable>

            <Pressable
              onPress={() => {
                if (onSelectQa) {
                  onSelectQa(hub.id);
                } else {
                  onSelectHub(hub.id);
                }
                onClose();
              }}
              accessibilityRole="button"
              accessibilityLabel={`Open Isolated Q and A Threads for ${formatCourseHubName(hub)}`}
              accessibilityState={{ selected: isQaActive }}
              style={({ pressed }) => [
                styles.spaceRow,
                isQaActive && styles.spaceRowActive,
                pressed && styles.pressed,
              ]}
            >
              <Feather
                name="help-circle"
                size={15}
                color={isQaActive ? colors.ustpNavy : colors.ustpGold}
              />
              <Text
                numberOfLines={1}
                style={[
                  styles.spaceRowText,
                  isQaActive && styles.spaceRowTextActive,
                ]}
              >
                Isolated Q&amp;A Threads
              </Text>
              {unreadQaCount > 0 && (
                <View
                  style={[
                    styles.spaceCountPill,
                    isQaActive && styles.spaceCountPillActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.spaceCountText,
                      isQaActive && styles.spaceCountTextActive,
                    ]}
                  >
                    {formatUnreadBadgeCount(unreadQaCount)}
                  </Text>
                </View>
              )}
            </Pressable>

            {/* 2. Active Nested Chat Channels */}
            <View style={styles.subChannelsBlock}>
              <Text style={styles.subSectionLabel}>CHANNELS</Text>

              {subChannels.length === 0 ? (
                <Text style={styles.emptySubChannelsText}>
                  No chat channels yet
                </Text>
              ) : (
                subChannels.map((sub) => {
                  const cleanName = sub.name.replace(/^#\s*/, '').trim();
                  const isSubActive =
                    isCurrentHub &&
                    activeTab === 'chat' &&
                    typeof activeChatChannelId === 'number' &&
                    activeChatChannelId === sub.id;
                  const isConfirmingDelete = confirmDeleteSubId === sub.id;
                  const isDeletingThis = deletingSubId === sub.id;

                  return (
                    <View key={String(sub.id)} style={styles.subChannelItemWrap}>
                      <View
                        style={[
                          styles.subChannelRowContainer,
                          isSubActive && styles.subChannelRowActive,
                        ]}
                      >
                        <Pressable
                          onPress={() => {
                            if (onSelectSubChannel) {
                              onSelectSubChannel(hub.id, sub.id);
                            } else {
                              onSelectHub(hub.id);
                            }
                            onClose();
                          }}
                          accessibilityRole="button"
                          accessibilityLabel={`Open channel ${cleanName}`}
                          accessibilityState={{ selected: isSubActive }}
                          style={({ pressed }) => [
                            styles.subChannelPressArea,
                            pressed && styles.pressed,
                          ]}
                        >
                          <Feather
                            name="hash"
                            size={14}
                            color={colors.ustpGold}
                          />
                          <Text
                            numberOfLines={1}
                            style={[
                              styles.subChannelText,
                              isSubActive && styles.subChannelTextActive,
                            ]}
                          >
                            {cleanName}
                          </Text>
                        </Pressable>

                        {isHubCourseAdmin && (
                          <Pressable
                            onPress={() =>
                              setConfirmDeleteSubId(
                                isConfirmingDelete ? null : sub.id
                              )
                            }
                            accessibilityRole="button"
                            accessibilityLabel={`Delete channel ${cleanName}`}
                            style={({ pressed }) => [
                              styles.subDeleteIconBtn,
                              pressed && styles.pressed,
                            ]}
                          >
                            <Feather
                              name="trash-2"
                              size={13}
                              color={colors.ustpNavyMutedText}
                            />
                          </Pressable>
                        )}
                      </View>

                      {isHubCourseAdmin && isConfirmingDelete && (
                        <View style={styles.subDeleteConfirmRow}>
                          <Text style={styles.subDeleteConfirmText}>
                            Delete #{cleanName}?
                          </Text>
                          <Pressable
                            disabled={isDeletingThis}
                            onPress={() =>
                              void handleDeleteSubChannel(hub.id, sub)
                            }
                            accessibilityRole="button"
                            accessibilityLabel={`Confirm delete channel ${cleanName}`}
                            style={({ pressed }) => [
                              styles.subDeleteConfirmBtn,
                              pressed && styles.pressed,
                            ]}
                          >
                            <Text style={styles.subDeleteConfirmBtnText}>
                              {isDeletingThis ? '...' : 'Delete'}
                            </Text>
                          </Pressable>
                          <Pressable
                            disabled={isDeletingThis}
                            onPress={() => setConfirmDeleteSubId(null)}
                            accessibilityRole="button"
                            accessibilityLabel="Cancel delete channel"
                            style={styles.subDeleteCancelBtn}
                          >
                            <Text style={styles.subDeleteCancelText}>
                              Cancel
                            </Text>
                          </Pressable>
                        </View>
                      )}
                    </View>
                  );
                })
              )}
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
        <View
          style={[
            styles.drawerPanel,
            {
              paddingTop: Math.max(insets.top, spacing.sm),
              paddingBottom: Math.max(insets.bottom + spacing.xs, spacing.sm),
            },
          ]}
        >
          {/* Drawer Header */}
          <View style={styles.headerRow}>
            <View style={styles.headerTitleRow}>
              <Feather name="book-open" size={14} color={colors.ustpGold} />
              <Text style={styles.headerTitle}>COURSE HUBS</Text>
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close scoped channels drawer"
              style={({ pressed }) => [
                styles.closeBtn,
                pressed && styles.pressed,
              ]}
            >
              <Feather name="x" size={20} color={colors.white} />
            </Pressable>
          </View>

          {/* Search Hubs / Sub-channels */}
          <View style={styles.searchWrap}>
            <Feather
              name="search"
              size={15}
              color={colors.ustpNavyMutedText}
            />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search hubs or #channels..."
              placeholderTextColor={colors.placeholder}
              accessibilityLabel="Filter course hubs and sub-channels"
              style={styles.searchInput}
            />
          </View>

          {/* Top Action Buttons: Add Course Hub & Browse Course Hubs */}
          {(onOpenAddHub || onOpenBrowseHubs) && (
            <View style={styles.topActionsStack}>
              {onOpenAddHub && (
                <Pressable
                  onPress={() => {
                    onClose();
                    onOpenAddHub();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Add Course Hub"
                  style={({ pressed }) => [
                    styles.addHubActionBtn,
                    pressed && styles.pressed,
                  ]}
                >
                  <Feather
                    name="folder-plus"
                    size={15}
                    color={colors.ustpNavy}
                  />
                  <Text style={styles.addHubActionText}>Add Course Hub</Text>
                </Pressable>
              )}

              {onOpenBrowseHubs && (
                <Pressable
                  onPress={() => {
                    onClose();
                    onOpenBrowseHubs();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Browse Course Hubs"
                  style={({ pressed }) => [
                    styles.browseHubsActionBtn,
                    pressed && styles.pressed,
                  ]}
                >
                  <Feather name="compass" size={15} color={colors.ustpGold} />
                  <Text style={styles.browseHubsActionText}>
                    Browse Course Hubs
                  </Text>
                </Pressable>
              )}
            </View>
          )}

          {/* Four States for Channel List */}
          {isLoading ? (
            <View style={styles.stateBox}>
              <Text style={styles.stateText}>Loading Course Hubs...</Text>
            </View>
          ) : error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorTitle}>Unable to load channels</Text>
              <Text style={styles.errorBody}>{error.message}</Text>
              <Pressable
                onPress={onRetry}
                accessibilityRole="button"
                accessibilityLabel="Retry loading channels"
                style={({ pressed }) => [
                  styles.retryBtn,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.retryBtnText}>Retry</Text>
              </Pressable>
            </View>
          ) : joinedHierarchy.length === 0 ? (
            <View style={styles.stateBox}>
              <Text style={styles.stateText}>
                {totalJoinedHubsCount === 0
                  ? 'You have not joined any Course Hubs yet.'
                  : 'No matching joined Course Hubs found.'}
              </Text>
              {totalJoinedHubsCount === 0 && onOpenBrowseHubs && (
                <Pressable
                  onPress={() => {
                    onClose();
                    onOpenBrowseHubs();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Browse and Join Course Hubs"
                  style={({ pressed }) => [
                    styles.emptyBrowseBtn,
                    pressed && styles.pressed,
                  ]}
                >
                  <Feather name="compass" size={14} color={colors.ustpNavy} />
                  <Text style={styles.emptyBrowseBtnText}>
                    Browse &amp; Join Course Hubs
                  </Text>
                </Pressable>
              )}
            </View>
          ) : (
            <FlatList
              data={joinedHierarchy}
              keyExtractor={(node) => String(node.hub.id)}
              renderItem={renderHubNode}
              contentContainerStyle={styles.listContent}
              ItemSeparatorComponent={() => <View style={styles.listGap} />}
              showsVerticalScrollIndicator={false}
            />
          )}

          {/* Bottom Scope Metadata matching clarify-web */}
          <View style={styles.footerMeta}>
            {activeChannel ? (
              <>
                <Text style={styles.footerScope}>
                  {activeChannel.scope_college || 'CITC'} •{' '}
                  {activeChannel.scope_section || 'Course Hub'}
                </Text>
                <Text numberOfLines={1} style={styles.footerFaculty}>
                  Faculty: {getChannelFacultyLabel(activeChannel)}
                </Text>
                <Text style={styles.footerRoster}>
                  Enrolled: {formatEnrolledRosterSummary(activeChannel)}
                </Text>
              </>
            ) : (
              <Text style={styles.footerRoster}>No Course Hub selected</Text>
            )}
          </View>
        </View>

        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close scoped channels backdrop"
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlayRoot: {
    flex: 1,
    flexDirection: 'row',
  },
  drawerPanel: {
    width: 304,
    maxWidth: '86%',
    height: '100%',
    backgroundColor: colors.ustpNavy,
    borderRightWidth: 1,
    borderRightColor: colors.ustpNavyBorder,
    paddingHorizontal: spacing.sm + 4,
    ...elevation.overlay,
  },
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlayBackdrop,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  headerTitle: {
    fontSize: typography.sizes.xs,
    fontWeight: '900',
    color: colors.ustpGold,
    letterSpacing: 0.9,
  },
  closeBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchWrap: {
    minHeight: 44,
    backgroundColor: colors.ustpNavySurface,
    borderWidth: 1,
    borderColor: colors.ustpNavyBorder,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm + 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  searchInput: {
    flex: 1,
    minHeight: 44,
    paddingVertical: 0,
    fontSize: typography.sizes.sm,
    color: colors.white,
  },
  topActionsStack: {
    gap: spacing.xs + 2,
    marginBottom: spacing.sm + 2,
  },
  addHubActionBtn: {
    minHeight: 44,
    borderRadius: radii.md,
    backgroundColor: colors.ustpGold,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
  },
  addHubActionText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  browseHubsActionBtn: {
    minHeight: 44,
    borderRadius: radii.md,
    backgroundColor: colors.ustpNavySurface,
    borderWidth: 1,
    borderColor: colors.ustpNavyBorder,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
  },
  browseHubsActionText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.white,
  },
  listContent: {
    paddingBottom: spacing.sm,
  },
  listGap: {
    height: spacing.sm,
  },
  hubCard: {
    backgroundColor: colors.ustpNavySurface,
    borderWidth: 1,
    borderColor: colors.ustpNavyBorder,
    borderRadius: radii.lg,
    overflow: 'hidden',
  },
  hubCardActive: {
    borderColor: colors.ustpGold,
  },
  hubHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  hubHeaderBtn: {
    flex: 1,
    minHeight: 44,
    paddingLeft: spacing.sm + 2,
    paddingRight: spacing.xs,
    paddingVertical: spacing.xs + 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  hubQuickActions: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: spacing.xs,
  },
  hubIconBtn: {
    minWidth: 38,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
  },
  hubHeaderTextWrap: {
    flex: 1,
    gap: 1,
  },
  hubNameText: {
    fontSize: typography.sizes.sm,
    lineHeight: typography.lineHeights.sm,
    fontWeight: '800',
    color: colors.white,
  },
  hubNameTextActive: {
    color: colors.ustpGold,
  },
  hubMetaLine: {
    fontSize: typography.sizes.xxs,
    color: colors.ustpNavyMutedText,
    ...typography.tabularNums,
  },
  hubUnreadBadge: {
    backgroundColor: colors.ustpOrange,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
  },
  hubUnreadBadgeText: {
    fontSize: 10,
    fontWeight: '900',
    color: colors.ustpNavy,
    ...typography.tabularNums,
  },
  hubBody: {
    borderTopWidth: 1,
    borderTopColor: colors.ustpNavyBorder,
    padding: spacing.xs + 2,
    gap: spacing.xs,
  },
  spaceRow: {
    minHeight: 44,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm + 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  spaceRowActive: {
    backgroundColor: colors.ustpGold,
  },
  spaceRowText: {
    flex: 1,
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.white,
  },
  spaceRowTextActive: {
    color: colors.ustpNavy,
  },
  spaceCountPill: {
    backgroundColor: colors.ustpNavyDark,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
  },
  spaceCountPillActive: {
    backgroundColor: colors.ustpNavy,
  },
  spaceCountText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.ustpGold,
    ...typography.tabularNums,
  },
  spaceCountTextActive: {
    color: colors.ustpGold,
  },
  subChannelsBlock: {
    borderTopWidth: 1,
    borderTopColor: colors.ustpNavyBorder,
    paddingTop: spacing.xs + 2,
    gap: 2,
  },
  subSectionLabel: {
    paddingHorizontal: spacing.xs,
    paddingBottom: 2,
    fontSize: 10,
    fontWeight: '800',
    color: colors.ustpNavyMutedText,
    letterSpacing: 0.7,
  },
  subChannelItemWrap: {
    gap: spacing.xs,
  },
  subChannelRowContainer: {
    minHeight: 44,
    borderRadius: radii.md,
    flexDirection: 'row',
    alignItems: 'center',
  },
  subChannelPressArea: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  subDeleteIconBtn: {
    minWidth: 38,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subDeleteConfirmRow: {
    backgroundColor: colors.ustpNavyDark,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  subDeleteConfirmText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
    color: colors.white,
  },
  subDeleteConfirmBtn: {
    minHeight: 34,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: colors.dangerBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subDeleteConfirmBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.white,
  },
  subDeleteCancelBtn: {
    minHeight: 34,
    paddingHorizontal: spacing.xs + 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subDeleteCancelText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.ustpNavyMutedText,
  },
  emptySubChannelsText: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    fontSize: typography.sizes.xxs,
    lineHeight: typography.lineHeights.xxs,
    fontStyle: 'italic',
    color: colors.ustpNavyMutedText,
  },
  subChannelRowActive: {
    backgroundColor: colors.ustpNavyDark,
    borderLeftWidth: 3,
    borderLeftColor: colors.ustpGold,
  },
  subChannelText: {
    flex: 1,
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.ustpNavyMutedText,
  },
  subChannelTextActive: {
    color: colors.white,
    fontWeight: '800',
  },
  stateBox: {
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.md,
  },
  stateText: {
    fontSize: typography.sizes.sm,
    color: colors.ustpNavyMutedText,
    textAlign: 'center',
  },
  emptyBrowseBtn: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.ustpGold,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
  },
  emptyBrowseBtnText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  errorBox: {
    backgroundColor: colors.dangerBg,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.xs,
  },
  errorTitle: {
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.dangerTitle,
  },
  errorBody: {
    fontSize: typography.sizes.xs,
    color: colors.dangerText,
  },
  retryBtn: {
    marginTop: spacing.xs,
    minHeight: touchTarget.minHeight,
    backgroundColor: colors.ustpNavy,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryBtnText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.white,
  },
  footerMeta: {
    borderTopWidth: 1,
    borderTopColor: colors.ustpNavyBorder,
    paddingTop: spacing.sm,
    gap: 2,
  },
  footerScope: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpGold,
  },
  footerFaculty: {
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.white,
  },
  footerRoster: {
    fontSize: typography.sizes.xxs,
    color: colors.ustpNavyMutedText,
    ...typography.tabularNums,
  },
  pressed: {
    opacity: 0.85,
  },
});
