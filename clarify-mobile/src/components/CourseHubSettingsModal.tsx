import { Feather } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../context/AuthContext';
import { useChannels } from '../context/ChannelsContext';
import { useOptionalRealtime } from '../context/RealtimeContext';
import {
  joinChannelApi,
  leaveChannelApi,
  manageChannelMemberApi,
} from '../lib/api-client';
import {
  formatCourseHubName,
  formatEnrolledRosterSummary,
  getChannelFacultyLabel,
  getFieldValidationError,
  getSubChannelsForHub,
  isUserCourseAdmin,
} from '../lib/domain-logic';
import { getChannelMembersCount } from '../lib/feed-reducer';
import { removePendingRequestFromChannel } from '../lib/qa-reducer';
import {
  colors,
  elevation,
  radii,
  spacing,
  touchTarget,
  typography,
} from '../theme';
import type { ApiError, Channel } from '../types/api';

export interface CourseHubSettingsModalProps {
  visible: boolean;
  onClose: () => void;
  hub: Channel | undefined;
  onOpenEditHub: (hubId: number) => void;
  onLeftHub: (leftHubId: number) => void;
}

/**
 * Course Hub Settings & Channel Roster Modal ported from
 * clarify-web/src/components/threads/MessengerChatBox.tsx (lines 1886-2176).
 *
 * - Loads full roster & pending_requests on demand via GET /channels/{id}/roster.
 * - Displays Course Hub metadata, Course Admin badge, Edit Hub shortcut, and Leave Hub.
 * - Course Admins: Pending Join Requests approve/decline (with HTTP 409 recovery),
 *   Sync Admin Access, Add Member by Institutional ID (with 422 inline field errors),
 *   and Remove Member from Roster.
 */
export function CourseHubSettingsModal({
  visible,
  onClose,
  hub,
  onOpenEditHub,
  onLeftHub,
}: CourseHubSettingsModalProps) {
  const insets = useSafeAreaInsets();
  const { user, showToast } = useAuth();
  const {
    channels,
    rosterByChannelId,
    isLoadingRosterById,
    refreshChannelRoster,
    setRosterChannelSnapshot,
    refreshChannels,
  } = useChannels();
  const realtime = useOptionalRealtime();

  const [newMemberId, setNewMemberId] = useState('');
  const [newMemberName, setNewMemberName] = useState('');
  const [rosterFieldErrors, setRosterFieldErrors] = useState<
    Record<string, string[]>
  >({});
  const [isManagingRoster, setIsManagingRoster] = useState(false);
  const [processingMemberIds, setProcessingMemberIds] = useState<
    Record<string, boolean>
  >({});
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  const hubId = hub?.id ?? 0;

  useEffect(() => {
    if (visible && hubId > 0) {
      void refreshChannelRoster(hubId);
    }
  }, [visible, hubId, refreshChannelRoster]);

  if (!hub) {
    return null;
  }

  const detailedChannel = rosterByChannelId[hub.id] ?? hub;
  const isLoadingRoster = Boolean(isLoadingRosterById[hub.id]);
  const isCourseAdmin = isUserCourseAdmin(detailedChannel, user);
  const enrolledCount = getChannelMembersCount(detailedChannel);
  const facultyLabel = getChannelFacultyLabel(detailedChannel);
  const rosterSummary = formatEnrolledRosterSummary(detailedChannel);
  const pendingJoinRequests = detailedChannel.pending_requests ?? [];
  const enrolledRoster = rosterByChannelId[hub.id]?.roster ?? [];
  const hasLoadedRoster = Boolean(rosterByChannelId[hub.id]);

  const memberIdError = getFieldValidationError(
    rosterFieldErrors,
    'institutional_id'
  );

  const handleClose = () => {
    setConfirmingLeave(false);
    setRosterFieldErrors({});
    onClose();
  };

  const handleSyncAdminAccess = async () => {
    if (isManagingRoster) return;
    setIsManagingRoster(true);
    try {
      const res = await joinChannelApi(hub.id);
      if (res?.data) {
        setRosterChannelSnapshot(res.data);
      }
      await Promise.all([refreshChannelRoster(hub.id), refreshChannels()]);
      showToast(
        res.message || 'Course Admin access synced with roster.',
        'success'
      );
    } catch (err) {
      const apiErr = err as ApiError;
      showToast(apiErr?.message || 'Unable to sync admin access.', 'error');
    } finally {
      setIsManagingRoster(false);
    }
  };

  const handleLeaveCourseHub = async () => {
    if (isManagingRoster) return;
    setIsManagingRoster(true);
    try {
      const res = await leaveChannelApi(hub.id);
      const subChannelIds = getSubChannelsForHub(channels, hub.id).map(
        (sub) => sub.id
      );
      const leftChannelIds = Array.from(
        new Set([
          hub.id,
          ...subChannelIds,
          ...(Array.isArray(res?.left_channel_ids) ? res.left_channel_ids : []),
        ])
      );
      realtime?.removeChannelAnnouncementsFromState(leftChannelIds);
      realtime?.triggerAnnouncementRefresh();
      await refreshChannels();
      setConfirmingLeave(false);
      onClose();
      showToast(
        res.message || `Left ${formatCourseHubName(hub)}.`,
        'info'
      );
      onLeftHub(hub.id);
    } catch (err) {
      const apiErr = err as ApiError;
      showToast(apiErr?.message || 'Unable to leave Course Hub.', 'error');
    } finally {
      setIsManagingRoster(false);
    }
  };

  const handleAddMember = async () => {
    if (isManagingRoster) return;
    const trimmedId = newMemberId.trim();
    if (!trimmedId) {
      setRosterFieldErrors({
        institutional_id: ['Please enter an Institutional ID.'],
      });
      return;
    }

    setRosterFieldErrors({});
    setIsManagingRoster(true);
    try {
      const res = await manageChannelMemberApi(hub.id, {
        institutional_id: trimmedId,
        name: newMemberName.trim() || undefined,
        section: detailedChannel.scope_section || 'IT3R2',
        action: 'add',
      });
      if (res?.data) {
        setRosterChannelSnapshot(res.data);
      }
      await refreshChannels();
      setNewMemberId('');
      setNewMemberName('');
      showToast(res.message || 'Member added to Course Hub roster.', 'success');
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr?.status === 422 && apiErr.errors) {
        setRosterFieldErrors(apiErr.errors);
      } else {
        showToast(apiErr?.message || 'Failed to add member.', 'error');
      }
    } finally {
      setIsManagingRoster(false);
    }
  };

  const handleRemoveMember = async (institutionalId: string) => {
    if (isManagingRoster) return;
    setIsManagingRoster(true);
    try {
      const res = await manageChannelMemberApi(hub.id, {
        institutional_id: institutionalId,
        action: 'remove',
      });
      if (res?.data) {
        setRosterChannelSnapshot(res.data);
      }
      await refreshChannels();
      showToast(res.message || 'Member removed from roster.', 'info');
    } catch (err) {
      const apiErr = err as ApiError;
      showToast(apiErr?.message || 'Failed to remove member.', 'error');
    } finally {
      setIsManagingRoster(false);
    }
  };

  const handlePendingAction = async (
    institutionalId: string,
    action: 'approve' | 'reject'
  ) => {
    if (processingMemberIds[institutionalId] || isManagingRoster) return;
    setProcessingMemberIds((prev) => ({ ...prev, [institutionalId]: true }));
    try {
      const res = await manageChannelMemberApi(hub.id, {
        institutional_id: institutionalId,
        action,
      });
      const updatedSnapshot = removePendingRequestFromChannel(
        res?.data ?? detailedChannel,
        institutionalId
      );
      setRosterChannelSnapshot(updatedSnapshot);
      await refreshChannels();
      showToast(
        res.message ||
          (action === 'approve'
            ? 'Join request approved!'
            : 'Join request declined.'),
        action === 'approve' ? 'success' : 'info'
      );
    } catch (err) {
      const apiErr = err as ApiError;
      // HTTP 409: Another Course Admin already approved/declined this request.
      // Treat gracefully as "already handled", remove stale pending row, and refetch.
      if (apiErr?.status === 409) {
        showToast(
          apiErr.message ||
            'This request was already handled by another Course Admin.',
          'info'
        );
        const recoveredChannel =
          apiErr.data && typeof apiErr.data === 'object'
            ? (apiErr.data as Channel)
            : detailedChannel;
        setRosterChannelSnapshot(
          removePendingRequestFromChannel(recoveredChannel, institutionalId)
        );
        void Promise.all([refreshChannelRoster(hub.id), refreshChannels()]);
      } else {
        showToast(
          apiErr?.message ||
            (action === 'approve'
              ? 'Failed to approve join request.'
              : 'Failed to decline join request.'),
          'error'
        );
      }
    } finally {
      setProcessingMemberIds((prev) => {
        const next = { ...prev };
        delete next[institutionalId];
        return next;
      });
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (confirmingLeave) {
          if (!isManagingRoster) setConfirmingLeave(false);
          return;
        }
        handleClose();
      }}
    >
      <KeyboardAvoidingView
        style={styles.modalBackdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Close Course Hub Settings backdrop"
        />

        <View
          style={[
            styles.modalSheet,
            {
              marginTop: Math.max(insets.top + spacing.md, spacing.xl),
              marginBottom: Math.max(insets.bottom + spacing.md, spacing.xl),
            },
          ]}
        >
          {/* Navy Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleWrap}>
              <Feather name="settings" size={18} color={colors.ustpGold} />
              <Text numberOfLines={1} style={styles.headerTitle}>
                Course Hub Settings &amp; Roster
              </Text>
            </View>
            <Pressable
              onPress={handleClose}
              accessibilityRole="button"
              accessibilityLabel="Close Course Hub Settings"
              style={({ pressed }) => [
                styles.closeBtn,
                pressed && styles.pressed,
              ]}
            >
              <Feather name="x" size={20} color={colors.white} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* 1. Course Hub Metadata Summary Card */}
            <View style={styles.summaryCard}>
              <View style={styles.summaryTopRow}>
                <Text style={styles.summaryHubTitle}>
                  {formatCourseHubName(detailedChannel)}
                </Text>
                <View style={styles.scopePill}>
                  <Text style={styles.scopePillText}>
                    {detailedChannel.scope_department || 'CITC'} •{' '}
                    {detailedChannel.scope_section || 'IT3R2'}
                  </Text>
                </View>
              </View>

              <Text style={styles.metaLine}>
                Current Faculty:{' '}
                <Text style={styles.metaBold}>{facultyLabel}</Text>
              </Text>
              <Text style={styles.metaLine}>
                Enrolled Roster:{' '}
                <Text style={[styles.metaBold, styles.tabular]}>
                  {rosterSummary}
                </Text>
              </Text>
              {user && (
                <View style={styles.sessionRow}>
                  <Text style={styles.metaLine}>
                    Active Session:{' '}
                    <Text style={styles.metaBold}>
                      {user.role.replace('_', ' ').toUpperCase()} ({user.name})
                    </Text>
                  </Text>
                  {isCourseAdmin && (
                    <View style={styles.adminBadge}>
                      <Feather
                        name="shield"
                        size={11}
                        color={colors.ustpGold}
                      />
                      <Text style={styles.adminBadgeText}>COURSE ADMIN</Text>
                    </View>
                  )}
                </View>
              )}

              {/* Edit Hub & Leave Course Hub Actions */}
              <View style={styles.summaryActions}>
                {isCourseAdmin && (
                  <Pressable
                    onPress={() => {
                      handleClose();
                      onOpenEditHub(hub.id);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Edit Course Hub"
                    style={({ pressed }) => [
                      styles.editHubBtn,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Feather name="edit-3" size={14} color={colors.ustpGold} />
                    <Text style={styles.editHubBtnText}>Edit Hub</Text>
                  </Pressable>
                )}

                <Pressable
                  disabled={isManagingRoster}
                  onPress={() => setConfirmingLeave(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Leave Course Hub"
                  style={({ pressed }) => [
                    styles.leaveHubBtn,
                    pressed && styles.pressed,
                  ]}
                >
                  <Feather
                    name="log-out"
                    size={14}
                    color={colors.dangerText}
                  />
                  <Text style={styles.leaveHubBtnText}>Leave Course Hub</Text>
                </Pressable>
              </View>
            </View>

            {/* 2. Channel Roster Header + Sync Admin Access */}
            <View style={styles.rosterHeaderRow}>
              <View style={styles.rosterHeaderLeft}>
                <Feather name="users" size={16} color={colors.ustpNavy} />
                <Text style={styles.rosterHeaderTitle}>
                  Channel Roster ({enrolledCount})
                </Text>
              </View>

              {isCourseAdmin && (
                <Pressable
                  disabled={isManagingRoster}
                  onPress={() => void handleSyncAdminAccess()}
                  accessibilityRole="button"
                  accessibilityLabel="Sync Course Admin Access"
                  style={({ pressed }) => [
                    styles.syncAdminBtn,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.syncAdminBtnText}>Sync Admin Access</Text>
                </Pressable>
              )}
            </View>

            {/* 3. Pending Join Requests Queue (Course Admin Only) */}
            {isCourseAdmin && (
              <View style={styles.pendingBox}>
                <View style={styles.pendingHeaderRow}>
                  <View style={styles.pendingTitleWrap}>
                    <Feather
                      name="clock"
                      size={14}
                      color={colors.warningText}
                    />
                    <Text style={styles.pendingTitle}>
                      Pending Join Requests ({pendingJoinRequests.length})
                    </Text>
                  </View>
                  <Text style={styles.pendingStatusText}>
                    {isLoadingRoster
                      ? 'Refreshing...'
                      : pendingJoinRequests.length > 0
                        ? 'Requires Approval'
                        : 'Up to date'}
                  </Text>
                </View>

                {isLoadingRoster && pendingJoinRequests.length === 0 ? (
                  <View style={styles.pendingEmptyBox}>
                    <ActivityIndicator size="small" color={colors.ustpNavy} />
                    <Text style={styles.pendingEmptyText}>
                      Loading pending join requests...
                    </Text>
                  </View>
                ) : pendingJoinRequests.length === 0 ? (
                  <View style={styles.pendingEmptyBox}>
                    <Text style={styles.pendingEmptyText}>
                      No pending join requests right now.
                    </Text>
                  </View>
                ) : (
                  <View style={styles.pendingList}>
                    {pendingJoinRequests.map((reqMember) => {
                      const isRowBusy = Boolean(
                        processingMemberIds[reqMember.institutional_id]
                      );
                      return (
                        <View
                          key={reqMember.institutional_id}
                          style={styles.pendingRow}
                        >
                          <View style={styles.memberTextWrap}>
                            <Text style={styles.memberName}>
                              {reqMember.name}{' '}
                              <Text style={styles.memberIdInline}>
                                ({reqMember.institutional_id})
                              </Text>
                            </Text>
                            <Text style={styles.memberRoleMeta}>
                              {reqMember.role.replace('_', ' ').toUpperCase()} •{' '}
                              {reqMember.section || 'IT3R2'}
                            </Text>
                          </View>

                          <View style={styles.pendingRowActions}>
                            <Pressable
                              disabled={isRowBusy || isManagingRoster}
                              onPress={() =>
                                void handlePendingAction(
                                  reqMember.institutional_id,
                                  'approve'
                                )
                              }
                              accessibilityRole="button"
                              accessibilityLabel={`Approve ${reqMember.name}`}
                              style={({ pressed }) => [
                                styles.approveBtn,
                                (isRowBusy || isManagingRoster) &&
                                  styles.disabledBtn,
                                pressed && styles.pressed,
                              ]}
                            >
                              <Feather
                                name="check"
                                size={13}
                                color={colors.white}
                              />
                              <Text style={styles.approveBtnText}>
                                {isRowBusy ? 'Working...' : 'Approve'}
                              </Text>
                            </Pressable>

                            <Pressable
                              disabled={isRowBusy || isManagingRoster}
                              onPress={() =>
                                void handlePendingAction(
                                  reqMember.institutional_id,
                                  'reject'
                                )
                              }
                              accessibilityRole="button"
                              accessibilityLabel={`Decline ${reqMember.name}`}
                              style={({ pressed }) => [
                                styles.declineBtn,
                                (isRowBusy || isManagingRoster) &&
                                  styles.disabledBtn,
                                pressed && styles.pressed,
                              ]}
                            >
                              <Feather
                                name="x"
                                size={13}
                                color={colors.dangerText}
                              />
                              <Text style={styles.declineBtnText}>Decline</Text>
                            </Pressable>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            )}

            {/* 4. Add Student / Faculty Form (Course Admin Only) */}
            {isCourseAdmin && (
              <View style={styles.addMemberCard}>
                <View style={styles.addMemberHeader}>
                  <Feather
                    name="user-plus"
                    size={14}
                    color={colors.ustpNavy}
                  />
                  <Text style={styles.addMemberTitle}>
                    Add Student or Faculty to Roster
                  </Text>
                </View>

                <TextInput
                  value={newMemberId}
                  onChangeText={(val) => {
                    setNewMemberId(val);
                    if (rosterFieldErrors.institutional_id) {
                      setRosterFieldErrors({});
                    }
                  }}
                  placeholder="Institutional ID (e.g., 2023300010)"
                  placeholderTextColor={colors.placeholder}
                  autoCapitalize="none"
                  editable={!isManagingRoster}
                  accessibilityLabel="Member Institutional ID"
                  style={[
                    styles.input,
                    memberIdError ? styles.inputError : null,
                  ]}
                />
                {memberIdError && (
                  <Text accessibilityRole="alert" style={styles.fieldError}>
                    {memberIdError}
                  </Text>
                )}

                <TextInput
                  value={newMemberName}
                  onChangeText={setNewMemberName}
                  placeholder="Full Name (optional)"
                  placeholderTextColor={colors.placeholder}
                  editable={!isManagingRoster}
                  accessibilityLabel="Member Full Name optional"
                  style={styles.input}
                />

                <Pressable
                  disabled={isManagingRoster}
                  onPress={() => void handleAddMember()}
                  accessibilityRole="button"
                  accessibilityLabel="Add Member to Roster"
                  style={({ pressed }) => [
                    styles.addMemberSubmitBtn,
                    isManagingRoster && styles.disabledBtn,
                    pressed && styles.pressed,
                  ]}
                >
                  <Feather name="plus" size={15} color={colors.ustpGold} />
                  <Text style={styles.addMemberSubmitText}>
                    {isManagingRoster ? 'Updating Roster...' : 'Add Member'}
                  </Text>
                </Pressable>
              </View>
            )}

            {/* 5. Enrolled Roster Member List */}
            <View style={styles.rosterListCard}>
              {isLoadingRoster && !hasLoadedRoster ? (
                <View style={styles.rosterEmptyBox}>
                  <ActivityIndicator size="small" color={colors.ustpNavy} />
                  <Text style={styles.rosterEmptyText}>
                    Loading enrolled roster...
                  </Text>
                </View>
              ) : enrolledRoster.length === 0 ? (
                <View style={styles.rosterEmptyBox}>
                  <Text style={styles.rosterEmptyText}>
                    No members enrolled yet.
                  </Text>
                </View>
              ) : (
                enrolledRoster.map((member, index) => (
                  <View
                    key={member.institutional_id}
                    style={[
                      styles.rosterRow,
                      index > 0 && styles.rosterRowBorder,
                    ]}
                  >
                    <View style={styles.memberTextWrap}>
                      <Text style={styles.memberName}>
                        {member.name}{' '}
                        <Text style={styles.memberIdInline}>
                          ({member.institutional_id})
                        </Text>
                      </Text>
                      <Text style={styles.memberRoleMeta}>
                        {member.role.replace('_', ' ').toUpperCase()} •{' '}
                        {member.section || 'IT3R2'}
                      </Text>
                    </View>

                    {isCourseAdmin && (
                      <Pressable
                        disabled={isManagingRoster}
                        onPress={() =>
                          void handleRemoveMember(member.institutional_id)
                        }
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${member.name} from roster`}
                        style={({ pressed }) => [
                          styles.removeMemberBtn,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Feather
                          name="trash-2"
                          size={16}
                          color={colors.dangerText}
                        />
                      </Pressable>
                    )}
                  </View>
                ))
              )}
            </View>
          </ScrollView>
        </View>

        {/* Centered Confirmation Popup Dialog for Leaving Course Hub */}
        {confirmingLeave && (
          <View style={styles.confirmOverlay}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => {
                if (!isManagingRoster) setConfirmingLeave(false);
              }}
              accessibilityRole="button"
              accessibilityLabel="Cancel leaving Course Hub"
            />
            <View
              accessibilityViewIsModal
              style={styles.confirmDialogCard}
            >
              <View style={styles.confirmDialogHeader}>
                <Feather
                  name="alert-triangle"
                  size={20}
                  color={colors.dangerText}
                />
                <Text style={styles.confirmDialogTitle}>Leave Course Hub?</Text>
              </View>
              <Text style={styles.confirmDialogBody}>
                Are you sure you want to leave{' '}
                <Text style={styles.confirmDialogHubName}>
                  {formatCourseHubName(detailedChannel)}
                </Text>
                ? You will lose access to its noticeboard, Q&amp;A threads, and
                chat channels until you rejoin.
              </Text>
              <View style={styles.confirmDialogActions}>
                <Pressable
                  disabled={isManagingRoster}
                  onPress={() => setConfirmingLeave(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel leaving Course Hub"
                  style={({ pressed }) => [
                    styles.confirmCancelBtn,
                    isManagingRoster && styles.disabledBtn,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.confirmCancelBtnText}>Cancel</Text>
                </Pressable>
                <Pressable
                  disabled={isManagingRoster}
                  onPress={() => void handleLeaveCourseHub()}
                  accessibilityRole="button"
                  accessibilityLabel={`Confirm leaving ${formatCourseHubName(detailedChannel)}`}
                  style={({ pressed }) => [
                    styles.confirmDestructiveBtn,
                    isManagingRoster && styles.disabledBtn,
                    pressed && styles.pressed,
                  ]}
                >
                  {isManagingRoster ? (
                    <ActivityIndicator size="small" color={colors.white} />
                  ) : (
                    <Text style={styles.confirmDestructiveBtnText}>
                      Leave Course Hub
                    </Text>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.overlayBackdrop,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  modalSheet: {
    maxHeight: '88%',
    backgroundColor: colors.white,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    overflow: 'hidden',
    ...elevation.overlay,
  },
  header: {
    backgroundColor: colors.ustpNavy,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  headerTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  headerTitle: {
    flex: 1,
    fontSize: typography.sizes.body,
    fontWeight: '800',
    color: colors.white,
  },
  closeBtn: {
    minWidth: touchTarget.minWidth,
    minHeight: touchTarget.minHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bodyContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  summaryCard: {
    backgroundColor: colors.ustpCream,
    borderWidth: 1,
    borderColor: colors.tagMemoBorder,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.xs + 2,
  },
  summaryTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  summaryHubTitle: {
    fontSize: typography.sizes.body,
    fontWeight: '800',
    color: colors.ustpNavy,
    flexShrink: 1,
  },
  scopePill: {
    backgroundColor: colors.ustpNavy,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  scopePillText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.ustpGold,
  },
  metaLine: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    color: colors.mutedSlate,
  },
  metaBold: {
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  tabular: {
    ...typography.tabularNums,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs + 2,
  },
  adminBadge: {
    backgroundColor: colors.ustpNavy,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  adminBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.ustpGold,
  },
  summaryActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  editHubBtn: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.ustpNavy,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  editHubBtnText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.white,
  },
  leaveHubBtn: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerBg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  leaveHubBtnText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.dangerText,
  },
  confirmOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.overlayBackdrop,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  confirmDialogCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.white,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    padding: spacing.lg,
    gap: spacing.md,
    ...elevation.overlay,
  },
  confirmDialogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  confirmDialogTitle: {
    flex: 1,
    fontSize: typography.sizes.titleSm,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  confirmDialogBody: {
    fontSize: typography.sizes.sm,
    lineHeight: typography.lineHeights.sm,
    color: colors.ustpText,
  },
  confirmDialogHubName: {
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  confirmDialogActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  confirmCancelBtn: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmCancelBtnText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  confirmDestructiveBtn: {
    minHeight: 44,
    minWidth: 132,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.dangerBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmDestructiveBtnText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.white,
  },
  rosterHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  rosterHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  rosterHeaderTitle: {
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.ustpNavy,
    ...typography.tabularNums,
  },
  syncAdminBtn: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.ustpGold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncAdminBtnText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  pendingBox: {
    backgroundColor: colors.warningBg,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  pendingHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  pendingTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  pendingTitle: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.warningText,
    ...typography.tabularNums,
  },
  pendingStatusText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.warningText,
  },
  pendingEmptyBox: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.tagMemoBorder,
    borderRadius: radii.md,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  pendingEmptyText: {
    fontSize: typography.sizes.xs,
    color: colors.mutedSlate,
  },
  pendingList: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.tagMemoBorder,
    borderRadius: radii.md,
    overflow: 'hidden',
  },
  pendingRow: {
    padding: spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  pendingRowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  approveBtn: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.successBorder,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  approveBtnText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.white,
  },
  declineBtn: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerBg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  declineBtnText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.dangerText,
  },
  addMemberCard: {
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  addMemberHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  addMemberTitle: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  input: {
    minHeight: touchTarget.minHeight,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    fontSize: typography.sizes.sm,
    color: colors.ustpText,
  },
  inputError: {
    borderColor: colors.dangerBorder,
  },
  fieldError: {
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.dangerText,
  },
  addMemberSubmitBtn: {
    minHeight: touchTarget.minHeight,
    borderRadius: radii.md,
    backgroundColor: colors.ustpNavy,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
  },
  addMemberSubmitText: {
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.white,
  },
  rosterListCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    overflow: 'hidden',
  },
  rosterEmptyBox: {
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  rosterEmptyText: {
    fontSize: typography.sizes.xs,
    color: colors.mutedSlate,
  },
  rosterRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  rosterRowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  memberTextWrap: {
    flex: 1,
    gap: 2,
  },
  memberName: {
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.ustpText,
  },
  memberIdInline: {
    fontSize: typography.sizes.xs,
    fontWeight: '600',
    color: colors.mutedSlate,
    ...typography.tabularNums,
  },
  memberRoleMeta: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.mutedSlate,
  },
  removeMemberBtn: {
    minWidth: touchTarget.minWidth,
    minHeight: touchTarget.minHeight,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
  },
  disabledBtn: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.85,
  },
});
