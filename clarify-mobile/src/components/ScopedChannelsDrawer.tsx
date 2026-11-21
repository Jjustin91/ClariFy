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
import {
  formatCourseHubName,
  formatEnrolledRosterSummary,
  formatUnreadBadgeCount,
  getChannelFacultyLabel,
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
 * - Displays top-level Course Hubs with live links for Noticeboard Feed,
 *   Isolated Q&A Threads (with unread count badge), and active nested #channels.
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
}) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedHubIds, setCollapsedHubIds] = useState<number[]>([]);

  const hierarchy = useMemo(
    () => buildScopedChannelHierarchy(channels, user, searchQuery),
    [channels, user, searchQuery]
  );

  const toggleExpanded = (hubId: number) => {
    setCollapsedHubIds((prev) =>
      prev.includes(hubId)
        ? prev.filter((id) => id !== hubId)
        : [...prev, hubId]
    );
  };

  const renderHubNode = ({ item }: { item: CourseHubHierarchyNode }) => {
    const { hub, subChannels, membersCount, isJoined } = item;
    const isCurrentHub = activeChannel?.id === hub.id;
    const isExpanded =
      !collapsedHubIds.includes(hub.id) || searchQuery.trim().length > 0;
    const isNoticeboardActive =
      isCurrentHub && (!activeTab || activeTab === 'noticeboard');
    const isQaActive = isCurrentHub && activeTab === 'qa';
    const unreadQaCount = Math.max(0, Number(hub.unread_count ?? 0));

    return (
      <View style={[styles.hubCard, isCurrentHub && styles.hubCardActive]}>
        {/* Course Hub Header Row */}
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
              {[hub.course_code, hub.scope_section].filter(Boolean).join(' • ')}{' '}
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
          {!isJoined && (
            <View style={styles.unjoinedBadge}>
              <Text style={styles.unjoinedBadgeText}>Scoped</Text>
            </View>
          )}
        </Pressable>

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
                <Pressable
                  onPress={() => {
                    if (onSelectSubChannel) {
                      onSelectSubChannel(hub.id, hub.id);
                    } else {
                      onSelectHub(hub.id);
                    }
                    onClose();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Open general chat for ${formatCourseHubName(hub)}`}
                  accessibilityState={{
                    selected:
                      isCurrentHub &&
                      activeTab === 'chat' &&
                      activeChatChannelId === hub.id,
                  }}
                  style={({ pressed }) => [
                    styles.subChannelRow,
                    isCurrentHub &&
                      activeTab === 'chat' &&
                      activeChatChannelId === hub.id &&
                      styles.subChannelRowActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <Feather name="hash" size={14} color={colors.ustpGold} />
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.subChannelText,
                      isCurrentHub &&
                        activeTab === 'chat' &&
                        activeChatChannelId === hub.id &&
                        styles.subChannelTextActive,
                    ]}
                  >
                    general
                  </Text>
                </Pressable>
              ) : (
                subChannels.map((sub) => {
                  const cleanName = sub.name.replace(/^#\s*/, '').trim();
                  const isSubActive =
                    isCurrentHub &&
                    activeTab === 'chat' &&
                    activeChatChannelId === sub.id;

                  return (
                    <Pressable
                      key={String(sub.id)}
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
                        styles.subChannelRow,
                        isSubActive && styles.subChannelRowActive,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Feather name="hash" size={14} color={colors.ustpGold} />
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
              paddingTop: Math.max(insets.top, spacing.md),
              paddingBottom: Math.max(insets.bottom, spacing.md),
            },
          ]}
        >
          {/* Drawer Header */}
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>COURSE HUBS</Text>
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
          ) : hierarchy.length === 0 ? (
            <View style={styles.stateBox}>
              <Text style={styles.stateText}>
                {channels.length === 0
                  ? 'No Course Hubs available yet.'
                  : 'No matching Course Hubs found.'}
              </Text>
            </View>
          ) : (
            <FlatList
              data={hierarchy}
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
    paddingHorizontal: spacing.md,
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
    marginBottom: spacing.sm,
  },
  headerTitle: {
    fontSize: typography.sizes.xs,
    fontWeight: '900',
    color: colors.ustpGold,
    letterSpacing: 0.9,
  },
  closeBtn: {
    minWidth: touchTarget.minWidth,
    minHeight: touchTarget.minHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchWrap: {
    minHeight: touchTarget.minHeight,
    backgroundColor: colors.ustpNavySurface,
    borderWidth: 1,
    borderColor: colors.ustpNavyBorder,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm + 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  searchInput: {
    flex: 1,
    minHeight: touchTarget.minHeight,
    fontSize: typography.sizes.sm,
    color: colors.white,
  },
  listContent: {
    paddingBottom: spacing.lg,
  },
  listGap: {
    height: spacing.sm + 2,
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
  hubHeaderBtn: {
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  hubHeaderTextWrap: {
    flex: 1,
    gap: 2,
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
  unjoinedBadge: {
    backgroundColor: colors.ustpNavyDark,
    borderWidth: 1,
    borderColor: colors.ustpNavyBorder,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
  },
  unjoinedBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.ustpNavyMutedText,
  },
  hubBody: {
    borderTopWidth: 1,
    borderTopColor: colors.ustpNavyBorder,
    padding: spacing.sm,
    gap: spacing.xs + 2,
  },
  spaceRow: {
    minHeight: touchTarget.minHeight,
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
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  subSectionLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.ustpNavyMutedText,
    letterSpacing: 0.7,
    paddingHorizontal: spacing.xs,
  },
  subChannelRow: {
    minHeight: 44,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
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
  },
  stateText: {
    fontSize: typography.sizes.sm,
    color: colors.ustpNavyMutedText,
    textAlign: 'center',
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
    paddingTop: spacing.md,
    gap: 3,
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
