import { Feather } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FilterPopover } from '@/components/FilterPopover';
import {
  EmptyState,
  ErrorBanner,
  SkeletonCards,
} from '@/components/StateViews';
import {
  ADMIN_DEPARTMENT_TAGS,
  filterRbacUsers,
  getFieldValidationError,
  getRbacDepartmentOptions,
} from '@/lib/domain-logic';
import {
  colors,
  elevation,
  radii,
  spacing,
  touchTarget,
  typography,
} from '@/theme';
import type {
  AdminRoleBreakdown,
  ApiError,
  User,
  UserRole,
} from '@/types/api';

import {
  adminSharedStyles,
  getDeptBadgeColors,
  getRoleBadgeColors,
  ROLE_LABELS,
} from './adminSharedStyles';

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: 'student', label: 'Student' },
  { value: 'faculty', label: 'Faculty' },
  { value: 'dept_head', label: 'Dept Head' },
  { value: 'it_admin', label: 'IT Admin' },
];

export interface AdminRbacSectionProps {
  currentUserId: number;
  allUsers: User[];
  roleCounts: AdminRoleBreakdown | null;
  busyUserIds: Record<number, boolean>;
  isLoading: boolean;
  error: ApiError | null;
  onRetry: () => void;
  onUpdateRoleAndDept: (
    userId: number,
    role: UserRole,
    department: string
  ) => Promise<{ ok: boolean; errors?: Record<string, string[]> }>;
}

/**
 * Section 2: Role-Based Access Control (RBAC) Directory ported from clarify-web/app/admin/page.tsx.
 * - Search, Role filter chips with live counts, Department filter chips, Reset Filters
 * - Bottom-sheet role & department editor using web's options and self-demotion guard
 */
export function AdminRbacSection({
  currentUserId,
  allUsers,
  roleCounts,
  busyUserIds,
  isLoading,
  error,
  onRetry,
  onUpdateRoleAndDept,
}: AdminRbacSectionProps) {
  const insets = useSafeAreaInsets();
  const [rbacSearch, setRbacSearch] = useState('');
  const [rbacRoleFilter, setRbacRoleFilter] = useState<'all' | UserRole>('all');
  const [rbacDeptFilter, setRbacDeptFilter] = useState<string>('ALL');

  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [draftRole, setDraftRole] = useState<UserRole>('student');
  const [draftDepartment, setDraftDepartment] = useState<string>('CITC');
  const [formErrors, setFormErrors] = useState<Record<string, string[]>>({});
  const [isSavingModal, setIsSavingModal] = useState(false);

  const resolvedRoleCounts = useMemo<AdminRoleBreakdown>(() => {
    if (roleCounts) return roleCounts;
    const counts: AdminRoleBreakdown = {
      student: 0,
      faculty: 0,
      dept_head: 0,
      it_admin: 0,
    };
    for (const u of allUsers) {
      if (u.role in counts) {
        counts[u.role] += 1;
      }
    }
    return counts;
  }, [roleCounts, allUsers]);

  const filteredRbacUsers = useMemo(
    () =>
      filterRbacUsers(allUsers, {
        search: rbacSearch,
        role: rbacRoleFilter,
        department: rbacDeptFilter,
      }),
    [allUsers, rbacSearch, rbacRoleFilter, rbacDeptFilter]
  );

  if (isLoading) {
    return <SkeletonCards count={2} />;
  }

  if (error) {
    return <ErrorBanner error={error} onRetry={onRetry} />;
  }

  const rbacFilterCount =
    (rbacRoleFilter !== 'all' ? 1 : 0) + (rbacDeptFilter !== 'ALL' ? 1 : 0);

  const openEditor = (targetUser: User) => {
    const currentDept =
      (targetUser.academic_profile?.department || 'CITC')
        .trim()
        .toUpperCase() || 'CITC';
    setEditingUser(targetUser);
    setDraftRole(targetUser.role);
    setDraftDepartment(currentDept);
    setFormErrors({});
  };

  const closeEditor = () => {
    if (isSavingModal) return;
    setEditingUser(null);
    setFormErrors({});
  };

  const isEditingSelf = Boolean(
    editingUser && Number(editingUser.id) === Number(currentUserId)
  );
  const modalDeptOptions = getRbacDepartmentOptions(
    editingUser?.academic_profile?.department
  );
  const roleFieldError = getFieldValidationError(formErrors, 'role');
  const deptFieldError = getFieldValidationError(formErrors, 'department');

  const handleSaveModal = async () => {
    if (!editingUser || isSavingModal) return;
    const normalizedDept = draftDepartment.trim().toUpperCase();
    if (!normalizedDept) {
      setFormErrors({
        department: ['Please select a valid department scope.'],
      });
      return;
    }
    if (isEditingSelf && draftRole !== 'it_admin') {
      setFormErrors({
        role: ['You cannot demote your own active IT Administrator account.'],
      });
      return;
    }

    setFormErrors({});
    setIsSavingModal(true);
    const result = await onUpdateRoleAndDept(
      editingUser.id,
      draftRole,
      normalizedDept
    );
    setIsSavingModal(false);

    if (result.ok) {
      setEditingUser(null);
    } else if (result.errors) {
      setFormErrors(result.errors);
    }
  };

  return (
    <>
      <View style={adminSharedStyles.sectionCard}>
        {/* Section Header */}
        <View style={adminSharedStyles.sectionHeaderBlock}>
          <View style={adminSharedStyles.sectionHeaderTopRow}>
            <View style={adminSharedStyles.sectionTitleRow}>
              <Feather name="shield" size={16} color={colors.ustpNavy} />
              <Text style={adminSharedStyles.sectionTitle}>
                Role-Based Access Control (RBAC) Directory
              </Text>
            </View>
            <Text style={adminSharedStyles.showingCounter}>
              Showing {filteredRbacUsers.length} of {allUsers.length} approved
            </Text>
          </View>
          <Text style={adminSharedStyles.sectionSubtitle}>
            Manage verified ClariFy accounts, update institutional roles, and
            reassign department scopes in real time.
          </Text>
        </View>

        {/* Search & Single Floating Filter Button */}
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
                value={rbacSearch}
                onChangeText={setRbacSearch}
                placeholder="Search approved accounts, ID, email..."
                placeholderTextColor={colors.placeholder}
                accessibilityLabel="Search RBAC directory"
                style={adminSharedStyles.searchInput}
              />
              {rbacSearch.length > 0 && (
                <Pressable
                  onPress={() => setRbacSearch('')}
                  accessibilityRole="button"
                  accessibilityLabel="Clear RBAC search"
                  style={adminSharedStyles.searchClearBtn}
                >
                  <Feather name="x" size={15} color={colors.mutedSlate} />
                </Pressable>
              )}
            </View>

            <FilterPopover
              title="Filter RBAC Directory"
              accessibilityLabel="Filter RBAC directory"
              compact
              activeCount={rbacFilterCount}
              onReset={() => {
                setRbacRoleFilter('all');
                setRbacDeptFilter('ALL');
              }}
              sections={[
                {
                  kind: 'single',
                  id: 'mobile-rbac-role',
                  label: 'Role',
                  value: rbacRoleFilter,
                  onChange: (val) =>
                    setRbacRoleFilter(val as 'all' | UserRole),
                  options: [
                    { value: 'all', label: `All (${allUsers.length})` },
                    {
                      value: 'student',
                      label: `Student (${resolvedRoleCounts.student})`,
                    },
                    {
                      value: 'faculty',
                      label: `Faculty (${resolvedRoleCounts.faculty})`,
                    },
                    {
                      value: 'dept_head',
                      label: `Dept Head (${resolvedRoleCounts.dept_head})`,
                    },
                    {
                      value: 'it_admin',
                      label: `IT Admin (${resolvedRoleCounts.it_admin})`,
                    },
                  ],
                },
                {
                  kind: 'single',
                  id: 'mobile-rbac-dept',
                  label: 'Department',
                  value: rbacDeptFilter,
                  activeTone: 'blue',
                  onChange: (val) => setRbacDeptFilter(val),
                  options: (['ALL', ...ADMIN_DEPARTMENT_TAGS] as const).map(
                    (dept) => ({
                      value: dept,
                      label: dept === 'ALL' ? 'All Depts' : dept,
                    })
                  ),
                },
              ]}
            />
          </View>
        </View>

        {/* RBAC Directory Body */}
        <View style={adminSharedStyles.sectionBody}>
          {filteredRbacUsers.length === 0 ? (
            <EmptyState
              title="No Accounts Match Your Filters"
              description="Try clearing the search query or switching the role and department filter tags."
            />
          ) : (
            filteredRbacUsers.map((u) => {
              const isSelf = Number(u.id) === Number(currentUserId);
              const isBusy = Boolean(busyUserIds[u.id]);
              const currentDept =
                (u.academic_profile?.department || 'CITC')
                  .trim()
                  .toUpperCase() || 'CITC';
              const roleColors = getRoleBadgeColors(u.role);
              const deptColors = getDeptBadgeColors(currentDept);

              return (
                <View key={String(u.id)} style={adminSharedStyles.recordCard}>
                  <View style={adminSharedStyles.recordTopRow}>
                    <Text style={adminSharedStyles.recordId}>
                      {u.institutional_id}
                    </Text>
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
                          {ROLE_LABELS[u.role]}
                        </Text>
                      </View>
                      {isSelf && (
                        <View style={styles.selfBadge}>
                          <Text style={styles.selfBadgeText}>YOU</Text>
                        </View>
                      )}
                    </View>
                  </View>

                  <Text style={adminSharedStyles.recordName}>{u.name}</Text>
                  <Text style={adminSharedStyles.recordEmail}>{u.email}</Text>
                  {Boolean(u.contact_number) && (
                    <Text style={adminSharedStyles.recordPhone}>
                      {u.contact_number}
                    </Text>
                  )}

                  <View style={styles.cardFooterRow}>
                    <View style={adminSharedStyles.badgesWrapRow}>
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
                          {currentDept}
                        </Text>
                      </View>
                      {Boolean(u.academic_profile?.section) && (
                        <View style={adminSharedStyles.sectionPill}>
                          <Text style={adminSharedStyles.sectionPillText}>
                            {u.academic_profile?.section}
                          </Text>
                        </View>
                      )}
                    </View>

                    <Pressable
                      onPress={() => openEditor(u)}
                      disabled={isBusy}
                      accessibilityRole="button"
                      accessibilityLabel={`Manage role and department for ${u.name}`}
                      style={({ pressed }) => [
                        styles.manageBtn,
                        isBusy && adminSharedStyles.disabledBtn,
                        pressed && !isBusy && adminSharedStyles.pressed,
                      ]}
                    >
                      {isBusy ? (
                        <ActivityIndicator
                          size="small"
                          color={colors.ustpNavy}
                        />
                      ) : (
                        <Feather
                          name="sliders"
                          size={14}
                          color={colors.ustpNavy}
                        />
                      )}
                      <Text style={styles.manageBtnText}>
                        Manage Role &amp; Scope
                      </Text>
                    </Pressable>
                  </View>
                </View>
              );
            })
          )}
        </View>
      </View>

      {/* Bottom-Sheet Role & Department Editor Modal */}
      <Modal
        visible={Boolean(editingUser)}
        transparent
        animationType="slide"
        onRequestClose={closeEditor}
      >
        <View style={styles.sheetOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={closeEditor}
            accessibilityRole="button"
            accessibilityLabel="Close role and department sheet"
          />

          <View
            style={[
              styles.sheetCard,
              { paddingBottom: Math.max(insets.bottom, spacing.lg) },
            ]}
          >
            <View style={styles.sheetHeader}>
              <View style={styles.sheetHeaderCopy}>
                <Text style={styles.sheetTitle}>
                  Update Role &amp; Department Scope
                </Text>
                {editingUser && (
                  <Text numberOfLines={1} style={styles.sheetSub}>
                    {editingUser.name} ({editingUser.institutional_id})
                  </Text>
                )}
              </View>
              <Pressable
                onPress={closeEditor}
                disabled={isSavingModal}
                accessibilityRole="button"
                accessibilityLabel="Close dialog"
                style={styles.sheetCloseBtn}
              >
                <Feather name="x" size={18} color={colors.white} />
              </Pressable>
            </View>

            <View style={styles.sheetBody}>
              {/* Department Scope Selection */}
              <View style={styles.sheetFieldGroup}>
                <Text style={styles.sheetFieldLabel}>Department Scope</Text>
                <View style={styles.sheetChipsGrid}>
                  {modalDeptOptions.map((dept) => {
                    const active = draftDepartment === dept;
                    return (
                      <Pressable
                        key={dept}
                        onPress={() => setDraftDepartment(dept)}
                        disabled={isSavingModal}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={`Assign department ${dept}`}
                        style={[
                          styles.sheetChip,
                          active && styles.sheetChipBlueActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.sheetChipText,
                            active && styles.sheetChipTextBlueActive,
                          ]}
                        >
                          {dept}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {deptFieldError && (
                  <Text style={styles.fieldError} accessibilityRole="alert">
                    {deptFieldError}
                  </Text>
                )}
              </View>

              {/* Assigned Role Selection */}
              <View style={styles.sheetFieldGroup}>
                <Text style={styles.sheetFieldLabel}>Assigned Role</Text>
                <View style={styles.sheetChipsGrid}>
                  {ROLE_OPTIONS.map((roleOpt) => {
                    const active = draftRole === roleOpt.value;
                    const lockedForSelf =
                      isEditingSelf && roleOpt.value !== 'it_admin';
                    return (
                      <Pressable
                        key={roleOpt.value}
                        onPress={() => setDraftRole(roleOpt.value)}
                        disabled={isSavingModal || lockedForSelf}
                        accessibilityRole="button"
                        accessibilityState={{
                          selected: active,
                          disabled: isSavingModal || lockedForSelf,
                        }}
                        accessibilityLabel={`Assign role ${roleOpt.label}`}
                        style={[
                          styles.sheetChip,
                          active && styles.sheetChipNavyActive,
                          lockedForSelf && adminSharedStyles.disabledBtn,
                        ]}
                      >
                        <Text
                          style={[
                            styles.sheetChipText,
                            active && styles.sheetChipTextNavyActive,
                          ]}
                        >
                          {roleOpt.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {isEditingSelf && (
                  <Text style={styles.selfLockHint}>
                    You cannot demote your own active IT Administrator account.
                  </Text>
                )}
                {roleFieldError && (
                  <Text style={styles.fieldError} accessibilityRole="alert">
                    {roleFieldError}
                  </Text>
                )}
              </View>

              <View style={styles.sheetActionsRow}>
                <Pressable
                  onPress={closeEditor}
                  disabled={isSavingModal}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel changes"
                  style={({ pressed }) => [
                    styles.cancelBtn,
                    pressed && adminSharedStyles.pressed,
                  ]}
                >
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </Pressable>

                <Pressable
                  onPress={() => void handleSaveModal()}
                  disabled={isSavingModal}
                  accessibilityRole="button"
                  accessibilityLabel="Save account permissions"
                  style={({ pressed }) => [
                    styles.saveBtn,
                    isSavingModal && adminSharedStyles.disabledBtn,
                    pressed && !isSavingModal && adminSharedStyles.pressed,
                  ]}
                >
                  {isSavingModal ? (
                    <ActivityIndicator size="small" color={colors.ustpGold} />
                  ) : (
                    <Feather name="check" size={15} color={colors.ustpGold} />
                  )}
                  <Text style={styles.saveBtnText}>
                    {isSavingModal ? 'Saving...' : 'Save Permissions'}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  selfBadge: {
    backgroundColor: colors.warningBg,
    borderWidth: 1,
    borderColor: colors.tagMemoBorder,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
  },
  selfBadgeText: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xxs,
    lineHeight: typography.lineHeights.xxs,
    fontWeight: '800',
    color: colors.warningText,
  },
  cardFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  manageBtn: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.ustpNavy,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
  },
  manageBtnText: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  sheetOverlay: {
    flex: 1,
    backgroundColor: colors.overlayBackdrop,
    justifyContent: 'flex-end',
  },
  sheetCard: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radii.xxl,
    borderTopRightRadius: radii.xxl,
    borderTopWidth: 1,
    borderColor: colors.borderStrong,
    overflow: 'hidden',
    ...elevation.overlay,
  },
  sheetHeader: {
    backgroundColor: colors.ustpNavy,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  sheetHeaderCopy: {
    flex: 1,
    gap: 2,
  },
  sheetTitle: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.bodyLg,
    fontWeight: '800',
    color: colors.white,
  },
  sheetSub: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xs,
    color: colors.ustpGold,
    ...typography.tabularNums,
  },
  sheetCloseBtn: {
    minWidth: touchTarget.minWidth,
    minHeight: touchTarget.minHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetBody: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  sheetFieldGroup: {
    gap: spacing.sm,
  },
  sheetFieldLabel: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpText,
  },
  sheetChipsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  sheetChip: {
    minHeight: 42,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetChipNavyActive: {
    backgroundColor: colors.ustpNavy,
    borderColor: colors.ustpNavy,
  },
  sheetChipBlueActive: {
    backgroundColor: colors.ustpBlue,
    borderColor: colors.ustpBlue,
  },
  sheetChipText: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpText,
  },
  sheetChipTextNavyActive: {
    color: colors.ustpGold,
  },
  sheetChipTextBlueActive: {
    color: colors.white,
  },
  selfLockHint: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xxs,
    lineHeight: typography.lineHeights.xxs,
    fontWeight: '700',
    color: colors.warningText,
  },
  fieldError: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.dangerTitle,
  },
  sheetActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  cancelBtn: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.sm,
    fontWeight: '700',
    color: colors.mutedSlate,
  },
  saveBtn: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.ustpNavy,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
  },
  saveBtnText: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.ustpGold,
  },
});
