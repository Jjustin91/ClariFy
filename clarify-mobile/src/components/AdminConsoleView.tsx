import { Feather } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAuth } from '../context/AuthContext';
import { useOptionalRealtime } from '../context/RealtimeContext';
import {
  getAdminMetricsApi,
  getAllUsersApi,
  getPendingUsersApi,
  triggerPrismsSyncApi,
  updateUserRoleApi,
  verifyUserAccountApi,
} from '../lib/api-client';
import {
  filterAnnouncementAudits,
  getFieldValidationError,
  type AuditChangeTypeFilter,
} from '../lib/domain-logic';
import { resolveAdminPendingCount } from '../lib/realtime-reducer';
import {
  colors,
  elevation,
  radii,
  spacing,
  touchTarget,
  typography,
} from '../theme';
import type {
  AdminMetricsResponse,
  ApiError,
  User,
  UserRole,
} from '../types/api';
import { EmptyState, ErrorBanner, SkeletonCards } from './StateViews';

type AdminTab = 'verifications' | 'rbac' | 'prisms' | 'metrics';

const ALL_ROLES: { value: UserRole; label: string }[] = [
  { value: 'student', label: 'Student' },
  { value: 'faculty', label: 'Faculty' },
  { value: 'dept_head', label: 'Dept Head' },
  { value: 'it_admin', label: 'IT Admin' },
];

const DEPARTMENT_SCOPES = ['CITC', 'CEA', 'CSM', 'COT', 'CSTE', 'ICTO'] as const;

function formatRoleBadge(role: UserRole): string {
  if (role === 'dept_head') return 'DEPT HEAD';
  if (role === 'it_admin') return 'IT ADMIN';
  return role.toUpperCase();
}

function formatAuditTimestamp(iso: string): string {
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Manila',
    });
  } catch {
    return iso;
  }
}

/**
 * Full 4-Tab IT Administrator Console ported from clarify-web/app/admin/page.tsx.
 * Rendered directly on the Admin Dashboard when user.role === 'it_admin'.
 */
export function AdminConsoleView() {
  const { user, showToast } = useAuth();
  const realtime = useOptionalRealtime();

  const [activeTab, setActiveTab] = useState<AdminTab>('verifications');
  const [pendingUsers, setPendingUsers] = useState<User[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [metrics, setMetrics] = useState<AdminMetricsResponse | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  // Per-action loading & search filters
  const [verifyingUserId, setVerifyingUserId] = useState<number | null>(null);
  const [verificationSearch, setVerificationSearch] = useState('');
  const [rbacSearch, setRbacSearch] = useState('');

  // Immutable Announcement Audit Trail filters
  const [auditSearch, setAuditSearch] = useState('');
  const [auditRoleFilter, setAuditRoleFilter] = useState<'all' | UserRole>(
    'all'
  );
  const [auditChangeTypeFilter, setAuditChangeTypeFilter] =
    useState<AuditChangeTypeFilter>('all');

  // Role edit modal state
  const [editingRoleUser, setEditingRoleUser] = useState<User | null>(null);
  const [draftRole, setDraftRole] = useState<UserRole>('student');
  const [draftDepartment, setDraftDepartment] = useState<string>('CITC');
  const [isSavingRole, setIsSavingRole] = useState(false);

  // PRISMS Sync state
  const [semesterCode, setSemesterCode] = useState('2026-1ST-SEM');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncErrors, setSyncErrors] = useState<Record<string, string[]>>({});

  const hasLoadedOnceRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const requestAdminSnapshot = useCallback(async () => {
    const [pendingRes, usersRes, metricsRes] = await Promise.all([
      getPendingUsersApi(),
      getAllUsersApi(),
      getAdminMetricsApi(),
    ]);
    return {
      pendingUsers: Array.isArray(pendingRes?.data) ? pendingRes.data : [],
      allUsers: Array.isArray(usersRes?.data) ? usersRes.data : [],
      metrics: metricsRes?.data ?? null,
    };
  }, []);

  const loadAdminData = useCallback(
    async (mode: 'initial' | 'refresh' | 'silent' = 'initial') => {
      if (!user || user.role !== 'it_admin') {
        setIsLoading(false);
        return;
      }
      if (mode === 'refresh') {
        setIsRefreshing(true);
        setError(null);
      } else if (mode === 'initial') {
        if (!hasLoadedOnceRef.current) {
          setIsLoading(true);
        }
        setError(null);
      }

      try {
        const snapshot = await requestAdminSnapshot();
        if (!mountedRef.current) return;

        setPendingUsers(snapshot.pendingUsers);
        setAllUsers(snapshot.allUsers);
        setMetrics(snapshot.metrics);
        realtime?.setAdminPendingCount(
          resolveAdminPendingCount(
            snapshot.metrics?.pending_verifications_count,
            snapshot.pendingUsers.length
          )
        );
        setError(null);
        hasLoadedOnceRef.current = true;
      } catch (err) {
        if (!mountedRef.current) return;
        if (mode !== 'silent') {
          setError(err as ApiError);
        }
      } finally {
        if (mountedRef.current) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [user, requestAdminSnapshot, realtime]
  );

  // Initial load & realtime auto-refresh
  const realtimeAdminVersion = realtime?.adminVersion ?? 0;
  const realtimeAnnouncementVersion = realtime?.announcementVersion ?? 0;
  const setAdminPendingCount = realtime?.setAdminPendingCount;

  useEffect(() => {
    if (!user || user.role !== 'it_admin') {
      return;
    }

    let cancelled = false;
    const isInitialLoad = !hasLoadedOnceRef.current;

    requestAdminSnapshot()
      .then((snapshot) => {
        if (cancelled || !mountedRef.current) return;
        setPendingUsers(snapshot.pendingUsers);
        setAllUsers(snapshot.allUsers);
        setMetrics(snapshot.metrics);
        setAdminPendingCount?.(
          resolveAdminPendingCount(
            snapshot.metrics?.pending_verifications_count,
            snapshot.pendingUsers.length
          )
        );
        setError(null);
        hasLoadedOnceRef.current = true;
        setIsLoading(false);
        setIsRefreshing(false);
      })
      .catch((err) => {
        if (cancelled || !mountedRef.current) return;
        if (isInitialLoad) {
          setError(err as ApiError);
        }
        setIsLoading(false);
        setIsRefreshing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    user,
    realtimeAdminVersion,
    realtimeAnnouncementVersion,
    requestAdminSnapshot,
    setAdminPendingCount,
  ]);

  const handleVerifyUser = async (
    targetUser: User,
    status: 'approved' | 'rejected'
  ) => {
    if (verifyingUserId !== null) return;
    setVerifyingUserId(targetUser.id);
    try {
      const res = await verifyUserAccountApi(targetUser.id, status);
      showToast(
        res?.message || `${targetUser.name} ${status}.`,
        status === 'approved' ? 'success' : 'info'
      );
      await loadAdminData('silent');
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.status === 409) {
        showToast(
          apiErr.message || 'Verification already handled. Refreshing queue.',
          'info'
        );
        await loadAdminData('silent');
      } else if (apiErr.status !== 401) {
        showToast(apiErr.message || 'Verification update failed.', 'error');
      }
    } finally {
      if (mountedRef.current) {
        setVerifyingUserId(null);
      }
    }
  };

  const openRoleEditor = (targetUser: User) => {
    setEditingRoleUser(targetUser);
    setDraftRole(targetUser.role);
    setDraftDepartment(targetUser.academic_profile?.department || 'CITC');
  };

  const handleSaveRole = async () => {
    if (!editingRoleUser || isSavingRole) return;
    setIsSavingRole(true);
    try {
      const res = await updateUserRoleApi(editingRoleUser.id, {
        role: draftRole,
        department: draftDepartment,
      });
      showToast(
        res?.message || `Updated ${editingRoleUser.name} to ${draftRole}.`,
        'success'
      );
      setEditingRoleUser(null);
      await loadAdminData('silent');
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.status !== 401) {
        showToast(apiErr.message || 'Role update failed.', 'error');
      }
    } finally {
      if (mountedRef.current) {
        setIsSavingRole(false);
      }
    }
  };

  const handleTriggerPrismsSync = async () => {
    if (isSyncing) return;
    setSyncErrors({});
    const trimmed = semesterCode.trim();
    if (!trimmed) {
      setSyncErrors({
        semester_code: ['The semester code field is required.'],
      });
      return;
    }

    setIsSyncing(true);
    try {
      const res = await triggerPrismsSyncApi(trimmed);
      showToast(
        `${res.message || 'PRISMS synced.'} (${res.total_updated} records synced)`,
        'success'
      );
      await loadAdminData('silent');
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.status === 422 && apiErr.errors) {
        setSyncErrors(apiErr.errors);
      } else if (apiErr.status !== 401) {
        showToast(apiErr.message || 'PRISMS sync failed.', 'error');
      }
    } finally {
      if (mountedRef.current) {
        setIsSyncing(false);
      }
    }
  };

  const filteredPendingUsers = useMemo(() => {
    const q = verificationSearch.trim().toLowerCase();
    if (!q) return pendingUsers;
    return pendingUsers.filter((u) =>
      `${u.institutional_id} ${u.name} ${u.email} ${u.role} ${u.academic_profile?.department ?? ''} ${u.academic_profile?.section ?? ''}`
        .toLowerCase()
        .includes(q)
    );
  }, [pendingUsers, verificationSearch]);

  const filteredAllUsers = useMemo(() => {
    const q = rbacSearch.trim().toLowerCase();
    if (!q) return allUsers;
    return allUsers.filter((u) =>
      `${u.institutional_id} ${u.name} ${u.email} ${u.role} ${u.academic_profile?.department ?? ''} ${u.academic_profile?.section ?? ''}`
        .toLowerCase()
        .includes(q)
    );
  }, [allUsers, rbacSearch]);

  const semesterError = getFieldValidationError(syncErrors, 'semester_code');
  const syncLogs = metrics?.sync_logs ?? [];
  const announcementAudits = useMemo(
    () => metrics?.announcement_audits ?? [],
    [metrics]
  );
  const auditsTotal =
    metrics?.announcement_audits_total ?? announcementAudits.length;

  const filteredAnnouncementAudits = useMemo(
    () =>
      filterAnnouncementAudits(announcementAudits, {
        search: auditSearch,
        editorRole: auditRoleFilter,
        changeType: auditChangeTypeFilter,
      }),
    [announcementAudits, auditSearch, auditRoleFilter, auditChangeTypeFilter]
  );

  const hasActiveAuditFilters = Boolean(
    auditSearch.trim() ||
      auditRoleFilter !== 'all' ||
      auditChangeTypeFilter !== 'all'
  );

  return (
    <>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => void loadAdminData('refresh')}
            tintColor={colors.ustpNavy}
            colors={[colors.ustpNavy]}
          />
        }
      >
        {/* Welcome / Console Banner */}
        <View style={styles.consoleBanner}>
          <View style={styles.consoleBannerTop}>
            <Feather name="shield" size={18} color={colors.ustpNavy} />
            <Text style={styles.consoleBannerEyebrow}>
              ICTO SYSTEM GOVERNANCE
            </Text>
          </View>
          <Text style={styles.consoleBannerTitle}>IT Admin Console</Text>
          <Text style={styles.consoleBannerSub}>
            Manage registrar account verifications, RBAC roles, PRISMS roster
            syncs, and immutable announcement edit audits.
          </Text>
        </View>

        {/* Top 4 Summary KPI Cards matching clarify-web/app/admin/page.tsx */}
        {metrics && (
          <View style={styles.kpiGrid}>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>Pending Verifications</Text>
              <Text style={styles.kpiValue}>{pendingUsers.length}</Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>PRISMS Synced Accounts</Text>
              <Text style={styles.kpiValue}>
                {(metrics.active_users_count ?? 0).toLocaleString()}
              </Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>Urgent Push Latency (≤2.0s)</Text>
              <Text style={[styles.kpiValue, styles.kpiValueSuccess]}>
                {metrics.push_queue_latency_seconds}s
              </Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>Immutable Edit Audits</Text>
              <Text style={styles.kpiValue}>
                {auditsTotal.toLocaleString()}
              </Text>
            </View>
          </View>
        )}

        {/* Horizontal 4-Tab Bar */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabsRow}
          accessibilityRole="tablist"
        >
          <Pressable
            onPress={() => setActiveTab('verifications')}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === 'verifications' }}
            accessibilityLabel={`Account Verification Queue, ${pendingUsers.length} pending`}
            style={[
              styles.tabPill,
              activeTab === 'verifications' && styles.tabPillActive,
            ]}
          >
            <Feather
              name="user-check"
              size={14}
              color={
                activeTab === 'verifications' ? colors.ustpGold : colors.ustpText
              }
            />
            <Text
              style={[
                styles.tabPillText,
                activeTab === 'verifications' && styles.tabPillTextActive,
              ]}
            >
              1. Verifications ({pendingUsers.length})
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setActiveTab('rbac')}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === 'rbac' }}
            accessibilityLabel="RBAC Role Management"
            style={[styles.tabPill, activeTab === 'rbac' && styles.tabPillActive]}
          >
            <Feather
              name="shield"
              size={14}
              color={activeTab === 'rbac' ? colors.ustpGold : colors.ustpText}
            />
            <Text
              style={[
                styles.tabPillText,
                activeTab === 'rbac' && styles.tabPillTextActive,
              ]}
            >
              2. RBAC Roles ({allUsers.length})
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setActiveTab('prisms')}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === 'prisms' }}
            accessibilityLabel="PRISMS Database Sync Console"
            style={[
              styles.tabPill,
              activeTab === 'prisms' && styles.tabPillActive,
            ]}
          >
            <Feather
              name="database"
              size={14}
              color={activeTab === 'prisms' ? colors.ustpGold : colors.ustpText}
            />
            <Text
              style={[
                styles.tabPillText,
                activeTab === 'prisms' && styles.tabPillTextActive,
              ]}
            >
              3. PRISMS Sync
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setActiveTab('metrics')}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === 'metrics' }}
            accessibilityLabel="System Metrics and Audit Trail"
            style={[
              styles.tabPill,
              activeTab === 'metrics' && styles.tabPillActive,
            ]}
          >
            <Feather
              name="activity"
              size={14}
              color={
                activeTab === 'metrics' ? colors.ustpGold : colors.ustpText
              }
            />
            <Text
              style={[
                styles.tabPillText,
                activeTab === 'metrics' && styles.tabPillTextActive,
              ]}
            >
              4. Audits ({auditsTotal})
            </Text>
          </Pressable>
        </ScrollView>

        {/* Main Tab Content with 4 States */}
        {isLoading ? (
          <SkeletonCards count={3} />
        ) : error ? (
          <ErrorBanner
            error={error}
            onRetry={() => void loadAdminData('initial')}
          />
        ) : activeTab === 'verifications' ? (
          /* TAB 1: ACCOUNT VERIFICATION QUEUE */
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>
                Registrar Account Verification Queue
              </Text>
              <Text style={styles.sectionSubtitle}>
                Cross-check pending Student and Faculty registrations against
                USTP Registrar records.
              </Text>
            </View>

            {pendingUsers.length > 0 && (
              <View style={styles.searchWrap}>
                <Feather
                  name="search"
                  size={15}
                  color={colors.mutedSlate}
                  style={styles.searchIcon}
                />
                <TextInput
                  value={verificationSearch}
                  onChangeText={setVerificationSearch}
                  placeholder="Filter pending accounts by ID, name, or email..."
                  placeholderTextColor={colors.placeholder}
                  accessibilityLabel="Filter pending accounts"
                  style={styles.searchInput}
                />
              </View>
            )}

            {filteredPendingUsers.length === 0 ? (
              <EmptyState
                title={
                  pendingUsers.length === 0
                    ? 'All Pending Accounts Verified'
                    : 'No Matching Pending Accounts'
                }
                description={
                  pendingUsers.length === 0
                    ? 'There are zero unverified registrations waiting in the registrar queue.'
                    : 'Try clearing your search filter to inspect all pending registrations.'
                }
              />
            ) : (
              <View style={styles.cardsList}>
                {filteredPendingUsers.map((pending) => {
                  const isBusy = verifyingUserId === pending.id;
                  return (
                    <View key={String(pending.id)} style={styles.recordCard}>
                      <View style={styles.recordTopRow}>
                        <Text style={styles.recordId}>
                          {pending.institutional_id}
                        </Text>
                        <View style={styles.rolePill}>
                          <Text style={styles.rolePillText}>
                            {formatRoleBadge(pending.role)}
                          </Text>
                        </View>
                      </View>

                      <Text style={styles.recordName}>{pending.name}</Text>
                      <Text style={styles.recordEmail}>{pending.email}</Text>
                      <Text style={styles.recordScope}>
                        {pending.academic_profile?.department || 'CITC'} •{' '}
                        {pending.academic_profile?.section || 'Unassigned'}
                      </Text>

                      <View style={styles.verifyActionsRow}>
                        <Pressable
                          onPress={() =>
                            void handleVerifyUser(pending, 'approved')
                          }
                          disabled={isBusy || verifyingUserId !== null}
                          accessibilityRole="button"
                          accessibilityLabel={`Approve account ${pending.name}`}
                          style={({ pressed }) => [
                            styles.approveBtn,
                            (isBusy || verifyingUserId !== null) &&
                              styles.disabledBtn,
                            pressed && styles.pressed,
                          ]}
                        >
                          {isBusy ? (
                            <ActivityIndicator
                              size="small"
                              color={colors.white}
                            />
                          ) : (
                            <Feather
                              name="check-circle"
                              size={15}
                              color={colors.white}
                            />
                          )}
                          <Text style={styles.approveBtnText}>Approve</Text>
                        </Pressable>

                        <Pressable
                          onPress={() =>
                            void handleVerifyUser(pending, 'rejected')
                          }
                          disabled={isBusy || verifyingUserId !== null}
                          accessibilityRole="button"
                          accessibilityLabel={`Reject account ${pending.name}`}
                          style={({ pressed }) => [
                            styles.rejectBtn,
                            (isBusy || verifyingUserId !== null) &&
                              styles.disabledBtn,
                            pressed && styles.pressed,
                          ]}
                        >
                          <Feather
                            name="x-circle"
                            size={15}
                            color={colors.dangerTitle}
                          />
                          <Text style={styles.rejectBtnText}>Reject</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        ) : activeTab === 'rbac' ? (
          /* TAB 2: RBAC ROLE MANAGEMENT */
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>
                Role-Based Access Control (RBAC) Directory
              </Text>
              <Text style={styles.sectionSubtitle}>
                Assign, modify, or revoke institutional roles and department
                scopes.
              </Text>
            </View>

            <View style={styles.searchWrap}>
              <Feather
                name="search"
                size={15}
                color={colors.mutedSlate}
                style={styles.searchIcon}
              />
              <TextInput
                value={rbacSearch}
                onChangeText={setRbacSearch}
                placeholder="Search by ID, name, role, or department..."
                placeholderTextColor={colors.placeholder}
                accessibilityLabel="Search institutional users"
                style={styles.searchInput}
              />
            </View>

            {filteredAllUsers.length === 0 ? (
              <EmptyState
                title="No Matching Users Found"
                description="No institutional accounts match your current search filter."
              />
            ) : (
              <View style={styles.cardsList}>
                {filteredAllUsers.map((account) => (
                  <View key={String(account.id)} style={styles.recordCard}>
                    <View style={styles.recordTopRow}>
                      <Text style={styles.recordId}>
                        {account.institutional_id}
                      </Text>
                      <View
                        style={[
                          styles.rolePill,
                          account.role === 'it_admin' && styles.rolePillAdmin,
                          account.role === 'dept_head' && styles.rolePillDeptHead,
                          account.role === 'faculty' && styles.rolePillFaculty,
                        ]}
                      >
                        <Text style={styles.rolePillText}>
                          {formatRoleBadge(account.role)}
                        </Text>
                      </View>
                    </View>

                    <Text style={styles.recordName}>{account.name}</Text>
                    <Text style={styles.recordEmail}>{account.email}</Text>

                    <View style={styles.rbacFooterRow}>
                      <Text style={styles.recordScope}>
                        Scope: {account.academic_profile?.department || 'CITC'}{' '}
                        ({account.academic_profile?.section || 'Scope'})
                      </Text>
                      <Pressable
                        onPress={() => openRoleEditor(account)}
                        accessibilityRole="button"
                        accessibilityLabel={`Manage role for ${account.name}`}
                        style={({ pressed }) => [
                          styles.changeRoleBtn,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Feather
                          name="sliders"
                          size={14}
                          color={colors.ustpNavy}
                        />
                        <Text style={styles.changeRoleBtnText}>
                          Change Role
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        ) : activeTab === 'prisms' ? (
          /* TAB 3: PRISMS DATABASE SYNC CONSOLE */
          <View style={styles.tabStack}>
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>
                  USTP PRISMS Roster &amp; Scoped Channel Sync
                </Text>
                <Text style={styles.sectionSubtitle}>
                  Automated midnight batch job runs every 24h. Trigger a manual
                  sync below to provision semester channels and rosters
                  immediately.
                </Text>
              </View>

              <View style={styles.prismsForm}>
                <Text style={styles.inputLabel}>Target Semester Code</Text>
                <TextInput
                  value={semesterCode}
                  onChangeText={setSemesterCode}
                  placeholder="2026-1ST-SEM"
                  placeholderTextColor={colors.placeholder}
                  autoCapitalize="characters"
                  editable={!isSyncing}
                  accessibilityLabel="Target Semester Code"
                  style={[
                    styles.monoInput,
                    semesterError && styles.inputBorderError,
                  ]}
                />
                {semesterError && (
                  <Text style={styles.fieldErrorText} accessibilityRole="alert">
                    {semesterError}
                  </Text>
                )}

                <Pressable
                  onPress={() => void handleTriggerPrismsSync()}
                  disabled={isSyncing}
                  accessibilityRole="button"
                  accessibilityLabel="Trigger Manual PRISMS Sync"
                  style={({ pressed }) => [
                    styles.syncBtn,
                    isSyncing && styles.disabledBtn,
                    pressed && !isSyncing && styles.pressed,
                  ]}
                >
                  {isSyncing ? (
                    <ActivityIndicator size="small" color={colors.ustpGold} />
                  ) : (
                    <Feather
                      name="refresh-cw"
                      size={16}
                      color={colors.ustpGold}
                    />
                  )}
                  <Text style={styles.syncBtnText}>
                    {isSyncing
                      ? 'Synchronizing PRISMS...'
                      : 'Trigger Manual PRISMS Sync'}
                  </Text>
                </Pressable>
              </View>
            </View>

            {/* Sync History Logs */}
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>
                  PRISMS Synchronization History Logs
                </Text>
              </View>

              {syncLogs.length === 0 ? (
                <EmptyState
                  title="No Sync Logs Recorded Yet"
                  description="Trigger a manual PRISMS sync above to provision semester rosters."
                />
              ) : (
                <View style={styles.cardsList}>
                  {syncLogs.map((log) => (
                    <View key={String(log.id)} style={styles.recordCard}>
                      <View style={styles.recordTopRow}>
                        <Text style={styles.recordId}>
                          #{log.id} • {log.semester_code}
                        </Text>
                        <View style={styles.statusCompletedPill}>
                          <Text style={styles.statusCompletedText}>
                            {log.status.toUpperCase()}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.recordEmail}>
                        Triggered by: {log.triggered_by}
                      </Text>
                      <View style={styles.syncMetricsRow}>
                        <Text style={styles.syncMetricChip}>
                          {log.total_updated.toLocaleString()} records
                        </Text>
                        <Text style={styles.syncMetricChip}>
                          {log.channels_provisioned} channels
                        </Text>
                        <Text style={styles.syncMetricChip}>
                          {log.duration_ms}ms
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </View>
        ) : (
          /* TAB 4: SYSTEM METRICS & IMMUTABLE ANNOUNCEMENT AUDIT TRAIL */
          <View style={styles.tabStack}>
            {metrics && (
              <View style={styles.metricsStripCard}>
                <View style={styles.metricsStripItem}>
                  <Text style={styles.metricsStripLabel}>Verified Accounts</Text>
                  <Text style={styles.metricsStripValue}>
                    {(metrics.verified_accounts_count ?? 0).toLocaleString()}
                  </Text>
                </View>
                <View style={styles.metricsStripDivider} />
                <View style={styles.metricsStripItem}>
                  <Text style={styles.metricsStripLabel}>SMS Fallbacks</Text>
                  <Text style={styles.metricsStripValue}>
                    {(
                      metrics.sms_fallback_dispatched_count ?? 0
                    ).toLocaleString()}
                  </Text>
                </View>
                <View style={styles.metricsStripDivider} />
                <View style={styles.metricsStripItem}>
                  <Text style={styles.metricsStripLabel}>Avg Read Reach</Text>
                  <Text style={styles.metricsStripValue}>
                    {metrics.overall_read_reach_percentage ?? 0}%
                  </Text>
                </View>
              </View>
            )}

            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <View style={styles.auditHeaderTopRow}>
                  <Text style={styles.sectionTitle}>
                    Immutable Announcement Audit Trail
                  </Text>
                  <Text style={styles.auditCountSummary}>
                    Showing {filteredAnnouncementAudits.length} of{' '}
                    {announcementAudits.length} loaded ({auditsTotal} total)
                  </Text>
                </View>
                <Text style={styles.sectionSubtitle}>
                  Append-only log recording every edit made to published
                  announcements, including previous/new content and editor
                  identity.
                </Text>
              </View>

              {/* Audit Search + Editor Role + Change Type Filter Bar */}
              <View style={styles.auditFilterBox}>
                <View style={styles.searchRow}>
                  <View style={[styles.searchWrap, styles.searchWrapFlex]}>
                    <Feather
                      name="search"
                      size={15}
                      color={colors.mutedSlate}
                      style={styles.searchIcon}
                    />
                    <TextInput
                      value={auditSearch}
                      onChangeText={setAuditSearch}
                      placeholder="Search by audit ID, post ID, title, or editor..."
                      placeholderTextColor={colors.placeholder}
                      accessibilityLabel="Search announcement audits"
                      style={[styles.searchInput, styles.searchInputClearable]}
                    />
                    {auditSearch.length > 0 && (
                      <Pressable
                        onPress={() => setAuditSearch('')}
                        accessibilityRole="button"
                        accessibilityLabel="Clear audit search"
                        style={styles.searchClearBtn}
                      >
                        <Feather
                          name="x"
                          size={15}
                          color={colors.mutedSlate}
                        />
                      </Pressable>
                    )}
                  </View>

                  {hasActiveAuditFilters && (
                    <Pressable
                      onPress={() => {
                        setAuditSearch('');
                        setAuditRoleFilter('all');
                        setAuditChangeTypeFilter('all');
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Reset audit filters"
                      style={({ pressed }) => [
                        styles.resetFilterBtn,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Feather
                        name="rotate-ccw"
                        size={14}
                        color={colors.ustpNavy}
                      />
                      <Text style={styles.resetFilterText}>Reset</Text>
                    </Pressable>
                  )}
                </View>

                <View style={styles.filterGroup}>
                  <Text style={styles.filterGroupLabel}>EDITOR ROLE</Text>
                  <View style={styles.filterChipsRow}>
                    {(
                      [
                        { key: 'all', label: 'All Editors' },
                        { key: 'faculty', label: 'Faculty' },
                        { key: 'dept_head', label: 'Dept Head' },
                        { key: 'it_admin', label: 'IT Admin' },
                      ] as const
                    ).map((item) => {
                      const active = auditRoleFilter === item.key;
                      return (
                        <Pressable
                          key={item.key}
                          onPress={() => setAuditRoleFilter(item.key)}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          accessibilityLabel={`Filter audits by editor role ${item.label}`}
                          style={[
                            styles.filterChip,
                            active && styles.filterChipNavyActive,
                          ]}
                        >
                          <Text
                            style={[
                              styles.filterChipText,
                              active && styles.filterChipNavyTextActive,
                            ]}
                          >
                            {item.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                <View style={styles.filterGroup}>
                  <Text style={styles.filterGroupLabel}>CHANGE TYPE</Text>
                  <View style={styles.filterChipsRow}>
                    {(
                      [
                        { key: 'all', label: 'All Changes' },
                        { key: 'title', label: 'Title Changed' },
                        { key: 'content', label: 'Content Changed' },
                      ] as const
                    ).map((item) => {
                      const active = auditChangeTypeFilter === item.key;
                      return (
                        <Pressable
                          key={item.key}
                          onPress={() => setAuditChangeTypeFilter(item.key)}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          accessibilityLabel={`Filter audits by change type ${item.label}`}
                          style={[
                            styles.filterChip,
                            active && styles.filterChipBlueActive,
                          ]}
                        >
                          <Text
                            style={[
                              styles.filterChipText,
                              active && styles.filterChipBlueTextActive,
                            ]}
                          >
                            {item.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              </View>

              {filteredAnnouncementAudits.length === 0 ? (
                <EmptyState
                  title={
                    announcementAudits.length === 0
                      ? 'No Announcement Audits Yet'
                      : 'No Audits Match Your Filters'
                  }
                  description={
                    announcementAudits.length === 0
                      ? 'Edits made to published announcements will be immutably logged here.'
                      : 'Try adjusting your search text, editor role, or change-type filters.'
                  }
                />
              ) : (
                <View style={styles.cardsList}>
                  {filteredAnnouncementAudits.map((audit) => {
                    const titleChanged =
                      (audit.previous_title || '').trim() !==
                      (audit.new_title || '').trim();
                    const contentChanged =
                      (audit.previous_content || '').trim() !==
                      (audit.new_content || '').trim();
                    return (
                      <View key={String(audit.id)} style={styles.recordCard}>
                        <View style={styles.recordTopRow}>
                          <Text style={styles.recordId}>
                            #{audit.id} (Post #{audit.announcement_id})
                          </Text>
                          <Text style={styles.auditTimeText}>
                            {formatAuditTimestamp(audit.edited_at)}
                          </Text>
                        </View>

                        <View style={styles.auditBadgesRow}>
                          {titleChanged && (
                            <View style={styles.changeBadgeTitle}>
                              <Text style={styles.changeBadgeTitleText}>
                                TITLE
                              </Text>
                            </View>
                          )}
                          {contentChanged && (
                            <View style={styles.changeBadgeContent}>
                              <Text style={styles.changeBadgeContentText}>
                                CONTENT
                              </Text>
                            </View>
                          )}
                          <View
                            style={[
                              styles.rolePill,
                              audit.editor_role === 'it_admin' &&
                                styles.rolePillAdmin,
                              audit.editor_role === 'dept_head' &&
                                styles.rolePillDeptHead,
                              audit.editor_role === 'faculty' &&
                                styles.rolePillFaculty,
                            ]}
                          >
                            <Text style={styles.rolePillText}>
                              {formatRoleBadge(audit.editor_role)}
                            </Text>
                          </View>
                        </View>

                        <View style={styles.diffBox}>
                          {titleChanged ? (
                            <>
                              <Text style={styles.diffPrevTitle}>
                                {audit.previous_title}
                              </Text>
                              <Text style={styles.diffNewTitle}>
                                → {audit.new_title}
                              </Text>
                            </>
                          ) : (
                            <Text style={styles.diffUnchangedTitle}>
                              {audit.new_title}
                            </Text>
                          )}
                        </View>

                        <View style={styles.diffContentBox}>
                          {contentChanged ? (
                            <>
                              <Text
                                numberOfLines={3}
                                style={styles.diffPrevContent}
                              >
                                Prev: {audit.previous_content}
                              </Text>
                              <Text
                                numberOfLines={3}
                                style={styles.diffNewContent}
                              >
                                New: {audit.new_content}
                              </Text>
                            </>
                          ) : (
                            <Text
                              numberOfLines={3}
                              style={styles.diffPrevContent}
                            >
                              {audit.new_content}
                            </Text>
                          )}
                        </View>

                        <Text style={styles.auditEditorText}>
                          Editor: {audit.editor_name} • ID: {audit.editor_id} (
                          {audit.editor_role})
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          </View>
        )}
      </ScrollView>

      {/* RBAC Role & Department Scope Editor Modal */}
      <Modal
        visible={Boolean(editingRoleUser)}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!isSavingRole) setEditingRoleUser(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderCopy}>
                <Text style={styles.modalTitle}>Assign Institutional Role</Text>
                {editingRoleUser && (
                  <Text numberOfLines={1} style={styles.modalSub}>
                    {editingRoleUser.name} ({editingRoleUser.institutional_id})
                  </Text>
                )}
              </View>
              <Pressable
                onPress={() => setEditingRoleUser(null)}
                disabled={isSavingRole}
                accessibilityRole="button"
                accessibilityLabel="Close role assignment dialog"
                style={styles.modalCloseBtn}
              >
                <Feather name="x" size={18} color={colors.white} />
              </Pressable>
            </View>

            <View style={styles.modalBody}>
              <Text style={styles.modalSectionLabel}>Assigned Role</Text>
              <View style={styles.chipsGrid}>
                {ALL_ROLES.map((roleOpt) => {
                  const active = draftRole === roleOpt.value;
                  return (
                    <Pressable
                      key={roleOpt.value}
                      onPress={() => setDraftRole(roleOpt.value)}
                      disabled={isSavingRole}
                      accessibilityRole="button"
                      accessibilityLabel={`Select role ${roleOpt.label}`}
                      style={[
                        styles.modalChip,
                        active && styles.modalChipActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.modalChipText,
                          active && styles.modalChipTextActive,
                        ]}
                      >
                        {roleOpt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.modalSectionLabel}>Department Scope</Text>
              <View style={styles.chipsGrid}>
                {DEPARTMENT_SCOPES.map((dept) => {
                  const active = draftDepartment === dept;
                  return (
                    <Pressable
                      key={dept}
                      onPress={() => setDraftDepartment(dept)}
                      disabled={isSavingRole}
                      accessibilityRole="button"
                      accessibilityLabel={`Select department ${dept}`}
                      style={[
                        styles.modalChip,
                        active && styles.modalChipActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.modalChipText,
                          active && styles.modalChipTextActive,
                        ]}
                      >
                        {dept}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.modalActionsRow}>
                <Pressable
                  onPress={() => setEditingRoleUser(null)}
                  disabled={isSavingRole}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel role change"
                  style={({ pressed }) => [
                    styles.modalCancelBtn,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </Pressable>

                <Pressable
                  onPress={() => void handleSaveRole()}
                  disabled={isSavingRole}
                  accessibilityRole="button"
                  accessibilityLabel="Save role assignment"
                  style={({ pressed }) => [
                    styles.modalSaveBtn,
                    isSavingRole && styles.disabledBtn,
                    pressed && !isSavingRole && styles.pressed,
                  ]}
                >
                  {isSavingRole ? (
                    <ActivityIndicator size="small" color={colors.white} />
                  ) : (
                    <Feather name="check" size={15} color={colors.ustpGold} />
                  )}
                  <Text style={styles.modalSaveText}>
                    {isSavingRole ? 'Updating...' : 'Save Role'}
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
  scrollContent: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  consoleBanner: {
    backgroundColor: colors.ustpGold,
    borderRadius: radii.xl,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  consoleBannerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  consoleBannerEyebrow: {
    fontSize: typography.sizes.xxs,
    fontWeight: '900',
    letterSpacing: 0.7,
    color: colors.ustpNavy,
  },
  consoleBannerTitle: {
    fontSize: typography.sizes.titleLg,
    lineHeight: typography.lineHeights.titleLg,
    fontWeight: '900',
    color: colors.ustpNavy,
  },
  consoleBannerSub: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '700',
    color: colors.ustpText,
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  kpiCard: {
    width: '48.5%',
    flexGrow: 1,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.xs,
  },
  kpiLabel: {
    fontSize: typography.sizes.xxs,
    lineHeight: typography.lineHeights.xxs,
    fontWeight: '700',
    color: colors.mutedSlate,
  },
  kpiValue: {
    fontSize: typography.sizes.titleLg,
    lineHeight: typography.lineHeights.titleLg,
    fontWeight: '900',
    color: colors.ustpNavy,
    fontFamily: typography.fontFamilyMono,
    ...typography.tabularNums,
  },
  kpiValueSuccess: {
    color: colors.successBorder,
  },
  tabsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingBottom: spacing.xs,
  },
  tabPill: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.white,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  tabPillActive: {
    backgroundColor: colors.ustpNavy,
    borderColor: colors.ustpNavy,
  },
  tabPillText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpText,
    ...typography.tabularNums,
  },
  tabPillTextActive: {
    color: colors.ustpGold,
  },
  tabStack: {
    gap: spacing.lg,
  },
  sectionCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  sectionHeader: {
    gap: spacing.xxs,
  },
  sectionTitle: {
    fontSize: typography.sizes.bodyLg,
    lineHeight: typography.lineHeights.bodyLg,
    fontWeight: '800',
    color: colors.ustpText,
  },
  sectionSubtitle: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    color: colors.mutedSlate,
  },
  searchWrap: {
    position: 'relative',
    justifyContent: 'center',
  },
  searchIcon: {
    position: 'absolute',
    left: spacing.md,
    zIndex: 1,
  },
  searchInput: {
    minHeight: 44,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    paddingLeft: 38,
    paddingRight: spacing.md,
    fontSize: typography.sizes.sm,
    color: colors.ustpText,
  },
  cardsList: {
    gap: spacing.md,
  },
  recordCard: {
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.xs + 2,
  },
  recordTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  recordId: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpNavy,
    fontFamily: typography.fontFamilyMono,
    ...typography.tabularNums,
  },
  rolePill: {
    backgroundColor: colors.tagNeutralBg,
    borderWidth: 1,
    borderColor: colors.tagNeutralBorder,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  rolePillFaculty: {
    backgroundColor: colors.tagFacultyBg,
    borderColor: colors.tagFacultyBorder,
  },
  rolePillDeptHead: {
    backgroundColor: colors.tagMemoBg,
    borderColor: colors.tagMemoBorder,
  },
  rolePillAdmin: {
    backgroundColor: colors.tagCourseHubBg,
    borderColor: colors.tagCourseHubBorder,
  },
  rolePillText: {
    fontSize: typography.sizes.xxs,
    fontWeight: '800',
    color: colors.ustpText,
  },
  recordName: {
    fontSize: typography.sizes.body,
    lineHeight: typography.lineHeights.body,
    fontWeight: '800',
    color: colors.ustpText,
  },
  recordEmail: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    color: colors.mutedSlate,
  },
  recordScope: {
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.ustpBlue,
  },
  verifyActionsRow: {
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
  },
  approveBtnText: {
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
  },
  rejectBtnText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.dangerTitle,
  },
  rbacFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  changeRoleBtn: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.ustpNavy,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  changeRoleBtnText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  prismsForm: {
    gap: spacing.sm,
  },
  inputLabel: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpText,
  },
  monoInput: {
    minHeight: touchTarget.minHeight,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    fontSize: typography.sizes.body,
    fontWeight: '800',
    fontFamily: typography.fontFamilyMono,
    color: colors.ustpText,
  },
  inputBorderError: {
    borderColor: colors.dangerBorder,
  },
  fieldErrorText: {
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.dangerTitle,
  },
  syncBtn: {
    minHeight: touchTarget.minHeight,
    borderRadius: radii.md,
    backgroundColor: colors.ustpNavy,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  syncBtnText: {
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.ustpGold,
  },
  statusCompletedPill: {
    backgroundColor: colors.successBg,
    borderWidth: 1,
    borderColor: colors.tagFacultyBorder,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  statusCompletedText: {
    fontSize: typography.sizes.xxs,
    fontWeight: '800',
    color: colors.successText,
  },
  syncMetricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs + 2,
    marginTop: spacing.xxs,
  },
  syncMetricChip: {
    fontSize: typography.sizes.xxs,
    fontWeight: '700',
    color: colors.ustpNavy,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    fontFamily: typography.fontFamilyMono,
    ...typography.tabularNums,
  },
  metricsStripCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  metricsStripItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  metricsStripLabel: {
    fontSize: typography.sizes.xxs,
    fontWeight: '700',
    color: colors.mutedSlate,
    textAlign: 'center',
  },
  metricsStripValue: {
    fontSize: typography.sizes.titleSm,
    fontWeight: '900',
    color: colors.ustpNavy,
    fontFamily: typography.fontFamilyMono,
    ...typography.tabularNums,
  },
  metricsStripDivider: {
    width: 1,
    height: 32,
    backgroundColor: colors.border,
  },
  auditHeaderTopRow: {
    gap: spacing.xxs,
  },
  auditCountSummary: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpNavy,
    fontFamily: typography.fontFamilyMono,
    ...typography.tabularNums,
  },
  auditFilterBox: {
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  searchWrapFlex: {
    flex: 1,
  },
  searchInputClearable: {
    paddingRight: 40,
  },
  searchClearBtn: {
    position: 'absolute',
    right: 0,
    minWidth: 40,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resetFilterBtn: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.white,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  resetFilterText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  filterGroup: {
    gap: spacing.xs,
  },
  filterGroupLabel: {
    fontSize: typography.sizes.xxs,
    fontWeight: '800',
    color: colors.mutedSlate,
    letterSpacing: 0.5,
  },
  filterChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs + 2,
  },
  filterChip: {
    minHeight: 36,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterChipNavyActive: {
    backgroundColor: colors.ustpNavy,
    borderColor: colors.ustpNavy,
  },
  filterChipBlueActive: {
    backgroundColor: colors.ustpBlue,
    borderColor: colors.ustpBlue,
  },
  filterChipText: {
    fontSize: typography.sizes.xxs,
    fontWeight: '800',
    color: colors.ustpText,
  },
  filterChipNavyTextActive: {
    color: colors.ustpGold,
  },
  filterChipBlueTextActive: {
    color: colors.white,
  },
  auditBadgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
  },
  changeBadgeTitle: {
    backgroundColor: colors.tagMemoBg,
    borderWidth: 1,
    borderColor: colors.tagMemoBorder,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
  },
  changeBadgeTitleText: {
    fontSize: typography.sizes.xxs,
    fontWeight: '800',
    color: colors.tagMemoText,
  },
  changeBadgeContent: {
    backgroundColor: colors.tagDeptBg,
    borderWidth: 1,
    borderColor: colors.tagDeptBorder,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
  },
  changeBadgeContentText: {
    fontSize: typography.sizes.xxs,
    fontWeight: '800',
    color: colors.tagDeptText,
  },
  auditTimeText: {
    fontSize: typography.sizes.xxs,
    color: colors.mutedSlate,
    fontFamily: typography.fontFamilyMono,
    ...typography.tabularNums,
  },
  diffBox: {
    gap: 2,
  },
  diffPrevTitle: {
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.dangerTitle,
    textDecorationLine: 'line-through',
  },
  diffNewTitle: {
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.successText,
  },
  diffUnchangedTitle: {
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.ustpText,
  },
  diffContentBox: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  diffPrevContent: {
    fontSize: typography.sizes.xxs,
    lineHeight: typography.lineHeights.xxs,
    color: colors.mutedSlate,
  },
  diffNewContent: {
    fontSize: typography.sizes.xxs,
    lineHeight: typography.lineHeights.xxs,
    fontWeight: '600',
    color: colors.ustpText,
  },
  auditEditorText: {
    fontSize: typography.sizes.xxs,
    fontWeight: '700',
    color: colors.mutedSlate,
    ...typography.tabularNums,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.overlayBackdrop,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.white,
    borderRadius: radii.xl,
    overflow: 'hidden',
    ...elevation.overlay,
  },
  modalHeader: {
    backgroundColor: colors.ustpNavy,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  modalHeaderCopy: {
    flex: 1,
    gap: 2,
  },
  modalTitle: {
    fontSize: typography.sizes.bodyLg,
    fontWeight: '800',
    color: colors.white,
  },
  modalSub: {
    fontSize: typography.sizes.xs,
    color: colors.ustpGold,
    ...typography.tabularNums,
  },
  modalCloseBtn: {
    minWidth: 40,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBody: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  modalSectionLabel: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpText,
  },
  chipsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  modalChip: {
    minHeight: 42,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalChipActive: {
    backgroundColor: colors.ustpNavy,
    borderColor: colors.ustpNavy,
  },
  modalChipText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpText,
  },
  modalChipTextActive: {
    color: colors.ustpGold,
  },
  modalActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  modalCancelBtn: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelText: {
    fontSize: typography.sizes.sm,
    fontWeight: '700',
    color: colors.mutedSlate,
  },
  modalSaveBtn: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.ustpNavy,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    justifyContent: 'center',
  },
  modalSaveText: {
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.white,
  },
  disabledBtn: {
    opacity: 0.6,
  },
  pressed: {
    opacity: 0.85,
  },
});
