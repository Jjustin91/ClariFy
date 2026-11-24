import { Feather } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  EmptyState,
  ErrorBanner,
  SkeletonCards,
} from '@/components/StateViews';
import {
  ADMIN_DEPARTMENT_TAGS,
  filterVerificationQueueUsers,
  type VerificationStatusFilter,
} from '@/lib/domain-logic';
import { colors, radii, spacing, typography } from '@/theme';
import type { ApiError, User } from '@/types/api';

import {
  adminSharedStyles,
  formatAdminShortDate,
  getDeptBadgeColors,
  getRoleBadgeColors,
  ROLE_LABELS,
} from './adminSharedStyles';

export interface AdminVerificationSectionProps {
  queueUsers: User[];
  pendingCount: number | null;
  rejectedCount: number | null;
  busyUserIds: Record<number, boolean>;
  isLoading: boolean;
  error: ApiError | null;
  onRetry: () => void;
  onVerifyUser: (userId: number, status: 'approved' | 'rejected') => void;
}

/**
 * Section 1: Registrar Account Verification Queue ported from clarify-web/app/admin/page.tsx.
 * - Status (Pending / Rejected / All Queue), Role, and Department filter chips + Reset Filters
 * - Search over name, Institutional ID, @ustp.edu.ph email, mobile, or section
 * - Re-approve support for previously rejected accounts
 */
export function AdminVerificationSection({
  queueUsers,
  pendingCount,
  rejectedCount,
  busyUserIds,
  isLoading,
  error,
  onRetry,
  onVerifyUser,
}: AdminVerificationSectionProps) {
  const [queueSearch, setQueueSearch] = useState('');
  const [queueStatusFilter, setQueueStatusFilter] =
    useState<VerificationStatusFilter>('pending');
  const [queueRoleFilter, setQueueRoleFilter] = useState<
    'all' | 'student' | 'faculty'
  >('all');
  const [queueDeptFilter, setQueueDeptFilter] = useState<string>('ALL');

  const resolvedPendingCount = useMemo(() => {
    if (typeof pendingCount === 'number') return pendingCount;
    return queueUsers.filter((u) => u.verification_status === 'pending').length;
  }, [pendingCount, queueUsers]);

  const resolvedRejectedCount = useMemo(() => {
    if (typeof rejectedCount === 'number') return rejectedCount;
    return queueUsers.filter((u) => u.verification_status === 'rejected').length;
  }, [rejectedCount, queueUsers]);

  const filteredQueueUsers = useMemo(
    () =>
      filterVerificationQueueUsers(queueUsers, {
        search: queueSearch,
        status: queueStatusFilter,
        role: queueRoleFilter,
        department: queueDeptFilter,
      }),
    [queueUsers, queueSearch, queueStatusFilter, queueRoleFilter, queueDeptFilter]
  );

  if (isLoading) {
    return <SkeletonCards count={2} />;
  }

  if (error) {
    return <ErrorBanner error={error} onRetry={onRetry} />;
  }

  const hasActiveQueueFilters =
    queueSearch.trim() !== '' ||
    queueRoleFilter !== 'all' ||
    queueDeptFilter !== 'ALL' ||
    queueStatusFilter !== 'pending';

  return (
    <View style={adminSharedStyles.sectionCard}>
      {/* Section Header */}
      <View style={adminSharedStyles.sectionHeaderBlock}>
        <View style={adminSharedStyles.sectionHeaderTopRow}>
          <View style={adminSharedStyles.sectionTitleRow}>
            <Feather name="user-check" size={16} color={colors.ustpNavy} />
            <Text style={adminSharedStyles.sectionTitle}>
              Registrar Account Verification Queue
            </Text>
          </View>
          <Text style={adminSharedStyles.showingCounter}>
            Showing {filteredQueueUsers.length} of {queueUsers.length}
          </Text>
        </View>
        <Text style={adminSharedStyles.sectionSubtitle}>
          Review, approve, or reject pending Student and Faculty sign-ups, or
          re-approve previously rejected accounts.
        </Text>
      </View>

      {/* Search & Filter Tag Controls */}
      <View style={adminSharedStyles.filterPanel}>
        <View style={adminSharedStyles.searchAndResetRow}>
          <View style={adminSharedStyles.searchWrap}>
            <Feather
              name="search"
              size={15}
              color={colors.placeholder}
              style={adminSharedStyles.searchIcon}
            />
            <TextInput
              value={queueSearch}
              onChangeText={setQueueSearch}
              placeholder="Search by name, Institutional ID, @ustp.edu.ph email, mobile, or section..."
              placeholderTextColor={colors.placeholder}
              accessibilityLabel="Search verification queue"
              style={adminSharedStyles.searchInput}
            />
            {queueSearch.length > 0 && (
              <Pressable
                onPress={() => setQueueSearch('')}
                accessibilityRole="button"
                accessibilityLabel="Clear verification search"
                style={adminSharedStyles.searchClearBtn}
              >
                <Feather name="x" size={15} color={colors.mutedSlate} />
              </Pressable>
            )}
          </View>

          {hasActiveQueueFilters && (
            <Pressable
              onPress={() => {
                setQueueSearch('');
                setQueueStatusFilter('pending');
                setQueueRoleFilter('all');
                setQueueDeptFilter('ALL');
              }}
              accessibilityRole="button"
              accessibilityLabel="Reset Filters"
              style={({ pressed }) => [
                adminSharedStyles.resetBtn,
                pressed && adminSharedStyles.pressed,
              ]}
            >
              <Feather name="rotate-ccw" size={13} color={colors.mutedSlate} />
              <Text style={adminSharedStyles.resetBtnText}>Reset Filters</Text>
            </Pressable>
          )}
        </View>

        {/* Status Chips */}
        <View style={adminSharedStyles.filterGroup}>
          <Text style={adminSharedStyles.filterGroupLabel}>Status:</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={adminSharedStyles.chipsScrollRow}
          >
            {(
              [
                {
                  key: 'pending',
                  label: `Pending (${resolvedPendingCount})`,
                },
                {
                  key: 'rejected',
                  label: `Rejected (${resolvedRejectedCount})`,
                },
                {
                  key: 'all',
                  label: `All Queue (${queueUsers.length})`,
                },
              ] as const
            ).map((item) => {
              const active = queueStatusFilter === item.key;
              return (
                <Pressable
                  key={item.key}
                  onPress={() => setQueueStatusFilter(item.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={item.label}
                  style={[
                    adminSharedStyles.filterChip,
                    active && adminSharedStyles.filterChipNavyActive,
                  ]}
                >
                  <Text
                    style={[
                      adminSharedStyles.filterChipText,
                      active && adminSharedStyles.filterChipTextNavyActive,
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* Role Chips */}
        <View style={adminSharedStyles.filterGroup}>
          <Text style={adminSharedStyles.filterGroupLabel}>Role:</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={adminSharedStyles.chipsScrollRow}
          >
            {(
              [
                { key: 'all', label: 'All' },
                { key: 'student', label: 'Student' },
                { key: 'faculty', label: 'Faculty' },
              ] as const
            ).map((item) => {
              const active = queueRoleFilter === item.key;
              return (
                <Pressable
                  key={item.key}
                  onPress={() => setQueueRoleFilter(item.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Role filter ${item.label}`}
                  style={[
                    adminSharedStyles.filterChip,
                    active && adminSharedStyles.filterChipNavyActive,
                  ]}
                >
                  <Text
                    style={[
                      adminSharedStyles.filterChipText,
                      active && adminSharedStyles.filterChipTextNavyActive,
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* Department Chips */}
        <View style={adminSharedStyles.filterGroup}>
          <Text style={adminSharedStyles.filterGroupLabel}>Dept:</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={adminSharedStyles.chipsScrollRow}
          >
            {(['ALL', ...ADMIN_DEPARTMENT_TAGS] as const).map((dept) => {
              const active = queueDeptFilter === dept;
              const label = dept === 'ALL' ? 'All Depts' : dept;
              return (
                <Pressable
                  key={dept}
                  onPress={() => setQueueDeptFilter(dept)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Department filter ${label}`}
                  style={[
                    adminSharedStyles.filterChip,
                    active && adminSharedStyles.filterChipBlueActive,
                  ]}
                >
                  <Text
                    style={[
                      adminSharedStyles.filterChipText,
                      active && adminSharedStyles.filterChipTextBlueActive,
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>

      {/* Queue Body */}
      <View style={adminSharedStyles.sectionBody}>
        {filteredQueueUsers.length === 0 ? (
          <EmptyState
            title={
              queueStatusFilter === 'pending' && !hasActiveQueueFilters
                ? 'All Pending Accounts Verified'
                : 'No Matching Registrations Found'
            }
            description={
              queueStatusFilter === 'pending' && !hasActiveQueueFilters
                ? 'There are zero unverified registrations waiting in the registrar queue.'
                : 'Try adjusting your search keywords or status, role, and department filter tags.'
            }
          />
        ) : (
          filteredQueueUsers.map((applicant) => {
            const isBusy = Boolean(busyUserIds[applicant.id]);
            const isRejected = applicant.verification_status === 'rejected';
            const dept = applicant.academic_profile?.department || 'UNASSIGNED';
            const section = applicant.academic_profile?.section;
            const createdDate = formatAdminShortDate(applicant.created_at);
            const roleColors = getRoleBadgeColors(applicant.role);
            const deptColors = getDeptBadgeColors(dept);

            return (
              <View
                key={String(applicant.id)}
                style={adminSharedStyles.recordCard}
              >
                <View style={adminSharedStyles.recordTopRow}>
                  <View>
                    <Text style={adminSharedStyles.recordId}>
                      {applicant.institutional_id}
                    </Text>
                    {createdDate && (
                      <Text style={adminSharedStyles.recordSubMeta}>
                        {createdDate}
                      </Text>
                    )}
                  </View>
                  <View
                    style={[
                      adminSharedStyles.badgePill,
                      isRejected ? styles.statusRejected : styles.statusPending,
                    ]}
                  >
                    <Text
                      style={[
                        adminSharedStyles.badgePillText,
                        isRejected
                          ? styles.statusRejectedText
                          : styles.statusPendingText,
                      ]}
                    >
                      {applicant.verification_status}
                    </Text>
                  </View>
                </View>

                <Text style={adminSharedStyles.recordName}>
                  {applicant.name}
                </Text>
                <Text style={adminSharedStyles.recordEmail}>
                  {applicant.email}
                </Text>
                {Boolean(applicant.contact_number) && (
                  <Text style={adminSharedStyles.recordPhone}>
                    {applicant.contact_number}
                  </Text>
                )}

                <View style={adminSharedStyles.badgesWrapRow}>
                  <View
                    style={[
                      adminSharedStyles.badgePill,
                      {
                        backgroundColor: roleColors.backgroundColor,
                        borderColor: roleColors.borderColor,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        adminSharedStyles.badgePillText,
                        { color: roleColors.textColor },
                      ]}
                    >
                      {ROLE_LABELS[applicant.role]}
                    </Text>
                  </View>

                  <View
                    style={[
                      adminSharedStyles.badgePill,
                      {
                        backgroundColor: deptColors.backgroundColor,
                        borderColor: deptColors.borderColor,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        adminSharedStyles.badgePillText,
                        { color: deptColors.textColor },
                      ]}
                    >
                      {dept}
                    </Text>
                  </View>

                  {Boolean(section) && (
                    <View style={adminSharedStyles.sectionPill}>
                      <Text style={adminSharedStyles.sectionPillText}>
                        {section}
                      </Text>
                    </View>
                  )}
                </View>

                <View style={styles.actionsRow}>
                  <Pressable
                    onPress={() => onVerifyUser(applicant.id, 'approved')}
                    disabled={isBusy}
                    accessibilityRole="button"
                    accessibilityLabel={`${
                      isRejected ? 'Re-Approve' : 'Approve'
                    } ${applicant.name}`}
                    style={({ pressed }) => [
                      styles.approveBtn,
                      isBusy && adminSharedStyles.disabledBtn,
                      pressed && !isBusy && adminSharedStyles.pressed,
                    ]}
                  >
                    {isBusy ? (
                      <ActivityIndicator size="small" color={colors.white} />
                    ) : (
                      <Feather
                        name="check-circle"
                        size={15}
                        color={colors.white}
                      />
                    )}
                    <Text style={styles.approveBtnText}>
                      {isRejected ? 'Re-Approve' : 'Approve'}
                    </Text>
                  </Pressable>

                  {!isRejected && (
                    <Pressable
                      onPress={() => onVerifyUser(applicant.id, 'rejected')}
                      disabled={isBusy}
                      accessibilityRole="button"
                      accessibilityLabel={`Reject ${applicant.name}`}
                      style={({ pressed }) => [
                        styles.rejectBtn,
                        isBusy && adminSharedStyles.disabledBtn,
                        pressed && !isBusy && adminSharedStyles.pressed,
                      ]}
                    >
                      <Feather
                        name="x-circle"
                        size={15}
                        color={colors.dangerTitle}
                      />
                      <Text style={styles.rejectBtnText}>Reject</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            );
          })
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  statusPending: {
    backgroundColor: colors.warningBg,
    borderColor: colors.tagMemoBorder,
  },
  statusPendingText: {
    color: colors.warningText,
  },
  statusRejected: {
    backgroundColor: colors.dangerBg,
    borderColor: colors.urgentCardBorder,
  },
  statusRejectedText: {
    color: colors.dangerTitle,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  approveBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: radii.md,
    backgroundColor: colors.successBorder,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.md,
  },
  approveBtnText: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.white,
  },
  rejectBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: radii.md,
    backgroundColor: colors.dangerBg,
    borderWidth: 1,
    borderColor: colors.urgentCardBorder,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.md,
  },
  rejectBtnText: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.dangerTitle,
  },
});
