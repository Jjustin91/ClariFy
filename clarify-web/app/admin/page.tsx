'use client';

import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  History,
  RefreshCw,
  Search,
  ShieldCheck,
  UserCheck,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import { AppShell } from '@/src/components/layout/AppShell';
import { FilterPopover } from '@/src/components/ui/FilterPopover';
import {
  EmptyState,
  ErrorBanner,
  SkeletonCards,
} from '@/src/components/ui/StateViews';
import { useClarify } from '@/src/context/ClarifyContext';
import {
  getAdminMetricsApi,
  getAllUsersApi,
  getPendingUsersApi,
  triggerPrismsSyncApi,
  updateUserRoleApi,
  verifyUserAccountApi,
} from '@/src/lib/api-client';
import {
  ADMIN_DEPARTMENT_TAGS,
  type AdminSectionTab,
  type AuditChangeTypeFilter,
  type VerificationStatusFilter,
  filterAnnouncementAudits,
  filterRbacUsers,
  filterSyncLogs,
  filterVerificationQueueUsers,
  formatMeasuredLatency,
  getAdminSectionTitle,
  getFieldValidationError,
  parseAdminSectionTab,
} from '@/src/lib/domain-logic';
import type {
  AdminMetricsResponse,
  LaravelValidationError,
  User,
  UserRole,
} from '@/src/types/api';

const ROLE_LABELS: Record<UserRole, string> = {
  student: 'Student',
  faculty: 'Faculty',
  dept_head: 'Dept Head',
  it_admin: 'IT Admin',
};

function getRoleTagStyle(role: UserRole): string {
  switch (role) {
    case 'faculty':
      return 'bg-emerald-50 text-emerald-800 border-emerald-300';
    case 'dept_head':
      return 'bg-amber-50 text-amber-900 border-amber-300';
    case 'it_admin':
      return 'bg-ustp-navy text-ustp-gold border-ustp-navy';
    default:
      return 'bg-sky-50 text-sky-900 border-sky-300';
  }
}

function getDeptTagStyle(dept: string | null | undefined): string {
  const normalized = (dept || '').trim().toUpperCase();
  if (
    normalized === 'CITC' ||
    normalized === 'CEA' ||
    normalized === 'COT' ||
    normalized === 'CSM'
  ) {
    return 'bg-sky-50 text-ustp-blue border-sky-200';
  }
  return 'bg-slate-100 text-slate-700 border-slate-200';
}

function AdminConsoleContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab: AdminSectionTab = parseAdminSectionTab(
    searchParams.get('tab')
  );

  const {
    user,
    isAuthenticated,
    isAuthReady,
    announcementVersion,
    setAdminPendingCount,
    subscribeRealtimeEvents,
    showToast,
  } = useClarify();

  const [queueUsers, setQueueUsers] = useState<User[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [metrics, setMetrics] = useState<AdminMetricsResponse | null>(null);
  const [clientRoundTripMs, setClientRoundTripMs] = useState<number | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedOnceRef = useRef(false);

  // Per-row saving states
  const [busyUserIds, setBusyUserIds] = useState<Record<number, boolean>>({});

  // Section 1: Account Verification Queue filters
  const [queueSearch, setQueueSearch] = useState('');
  const [queueStatusFilter, setQueueStatusFilter] =
    useState<VerificationStatusFilter>('pending');
  const [queueRoleFilter, setQueueRoleFilter] = useState<
    'all' | 'student' | 'faculty'
  >('all');
  const [queueDeptFilter, setQueueDeptFilter] = useState<string>('ALL');

  // Section 2: RBAC Role Management filters
  const [rbacSearch, setRbacSearch] = useState('');
  const [rbacRoleFilter, setRbacRoleFilter] = useState<'all' | UserRole>('all');
  const [rbacDeptFilter, setRbacDeptFilter] = useState<string>('ALL');

  // Section 3: Registered Account & Roster Sync Console state + log filters
  const [semesterCode, setSemesterCode] = useState('2026-1ST-SEM');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncErrors, setSyncErrors] = useState<Record<string, string[]>>({});
  const [syncSearch, setSyncSearch] = useState('');
  const [syncTypeFilter, setSyncTypeFilter] = useState<
    'all' | 'manual_admin' | 'scheduled_midnight'
  >('all');
  const [syncStatusFilter, setSyncStatusFilter] = useState<
    'all' | 'completed' | 'partial_warning' | 'failed'
  >('all');

  // Section 4: System Metrics & Audit Trail filters
  const [auditSearch, setAuditSearch] = useState('');
  const [auditEditorRoleFilter, setAuditEditorRoleFilter] = useState<
    'all' | UserRole
  >('all');
  const [auditChangeTypeFilter, setAuditChangeTypeFilter] =
    useState<AuditChangeTypeFilter>('all');

  const loadAdminData = useCallback(
    async (options?: { manual?: boolean }) => {
      if (!isAuthReady || !isAuthenticated || user.role !== 'it_admin') {
        setIsLoading(false);
        return;
      }
      if (!hasLoadedOnceRef.current) {
        setIsLoading(true);
      } else if (options?.manual) {
        setIsRefreshing(true);
      }
      setError(null);
      try {
        const startedAt =
          typeof performance !== 'undefined' ? performance.now() : Date.now();
        const [queueRes, usersRes, metricsRes] = await Promise.all([
          getPendingUsersApi({ status: 'all', per_page: 100 }),
          getAllUsersApi(),
          getAdminMetricsApi(),
        ]);
        const endedAt =
          typeof performance !== 'undefined' ? performance.now() : Date.now();
        const measuredMs = Math.max(1, Math.round(endedAt - startedAt));
        setClientRoundTripMs(measuredMs);

        const loadedQueue = queueRes.data || [];
        const loadedUsers = usersRes.data || [];
        setQueueUsers(loadedQueue);
        setAllUsers(loadedUsers);
        setMetrics(metricsRes.data);

        const pendingLiveCount = loadedQueue.filter(
          (u) => u.verification_status === 'pending'
        ).length;
        setAdminPendingCount(
          typeof metricsRes.data?.pending_verifications_count === 'number'
            ? metricsRes.data.pending_verifications_count
            : pendingLiveCount
        );
        hasLoadedOnceRef.current = true;
      } catch (err) {
        const apiErr = err as LaravelValidationError;
        setError(
          apiErr.message || 'Failed to load IT Administrator Console data.'
        );
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [isAuthReady, isAuthenticated, user.role, setAdminPendingCount]
  );

  useEffect(() => {
    if (!isAuthReady || !isAuthenticated) {
      return;
    }
    void loadAdminData();
  }, [loadAdminData, announcementVersion, isAuthReady, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || user.role !== 'it_admin') return;
    return subscribeRealtimeEvents((event) => {
      if (
        event.type === 'admin.updated' ||
        event.type === 'announcement.updated' ||
        event.type === 'announcement.created' ||
        event.type === 'announcement.urgent' ||
        event.type === 'channel.created'
      ) {
        void loadAdminData();
      }
    });
  }, [isAuthenticated, user.role, subscribeRealtimeEvents, loadAdminData]);

  const navigateToSection = (tab: AdminSectionTab) => {
    router.push(`/admin?tab=${tab}`);
  };

  const handleVerifyUser = async (
    userId: number,
    status: 'approved' | 'rejected'
  ) => {
    setBusyUserIds((prev) => ({ ...prev, [userId]: true }));
    try {
      const res = await verifyUserAccountApi(userId, status);
      showToast(
        res.message || `Account ${status}.`,
        status === 'approved' ? 'success' : 'info'
      );
      await loadAdminData();
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      showToast(apiErr.message || 'Verification update failed.', 'error');
    } finally {
      setBusyUserIds((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
    }
  };

  const handleRoleOrDepartmentChange = async (
    userId: number,
    newRole: UserRole,
    newDepartment: string
  ) => {
    setBusyUserIds((prev) => ({ ...prev, [userId]: true }));
    try {
      const res = await updateUserRoleApi(userId, {
        role: newRole,
        department: newDepartment,
      });
      showToast(res.message || 'Account permissions updated.', 'success');
      await loadAdminData();
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      showToast(
        apiErr.message || 'Failed to update account role or department.',
        'error'
      );
    } finally {
      setBusyUserIds((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
    }
  };

  const handleTriggerRosterSync = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSyncing(true);
    setSyncErrors({});
    try {
      const res = await triggerPrismsSyncApi(semesterCode.trim());
      showToast(
        res.message ||
          `Synchronized ${res.total_updated} registered accounts.`,
        'success'
      );
      await loadAdminData();
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      if (apiErr.status === 422 && apiErr.errors) {
        setSyncErrors(apiErr.errors);
      } else {
        showToast(
          apiErr.message || 'Account & roster synchronization failed.',
          'error'
        );
      }
    } finally {
      setIsSyncing(false);
    }
  };

  // Live counts derived strictly from real database records (zero hardcoded placeholders)
  const pendingCount = useMemo(() => {
    const queuePending = queueUsers.filter(
      (u) => u.verification_status === 'pending'
    ).length;
    if (typeof metrics?.pending_verifications_count === 'number') {
      return metrics.pending_verifications_count;
    }
    return queuePending;
  }, [queueUsers, metrics]);

  const rejectedCount = useMemo(() => {
    const queueRejected = queueUsers.filter(
      (u) => u.verification_status === 'rejected'
    ).length;
    if (typeof metrics?.rejected_verifications_count === 'number') {
      return metrics.rejected_verifications_count;
    }
    return queueRejected;
  }, [queueUsers, metrics]);

  const verifiedAccountsCount = useMemo(() => {
    if (typeof metrics?.verified_accounts_count === 'number') {
      return metrics.verified_accounts_count;
    }
    return allUsers.length;
  }, [metrics, allUsers]);

  const totalRegisteredAccountsCount = useMemo(() => {
    if (typeof metrics?.total_registered_users_count === 'number') {
      return metrics.total_registered_users_count;
    }
    return verifiedAccountsCount + pendingCount + rejectedCount;
  }, [metrics, verifiedAccountsCount, pendingCount, rejectedCount]);

  const roleCounts = useMemo(() => {
    if (metrics?.role_breakdown) {
      return metrics.role_breakdown;
    }
    const counts = { student: 0, faculty: 0, dept_head: 0, it_admin: 0 };
    for (const u of allUsers) {
      if (u.role in counts) {
        counts[u.role] += 1;
      }
    }
    return counts;
  }, [metrics, allUsers]);

  const departmentCounts = useMemo(() => {
    if (
      metrics?.department_breakdown &&
      Object.keys(metrics.department_breakdown).length > 0
    ) {
      return metrics.department_breakdown;
    }
    const map: Record<string, number> = {};
    for (const u of allUsers) {
      const dept =
        (u.academic_profile?.department || 'UNASSIGNED').trim().toUpperCase() ||
        'UNASSIGNED';
      map[dept] = (map[dept] || 0) + 1;
    }
    return map;
  }, [metrics, allUsers]);

  const latencyInfo = useMemo(
    () =>
      formatMeasuredLatency({
        apiLatencyMs: metrics?.api_latency_ms ?? null,
        clientRoundTripMs,
      }),
    [metrics, clientRoundTripMs]
  );

  const auditsTotal = useMemo(() => {
    if (typeof metrics?.announcement_audits_total === 'number') {
      return metrics.announcement_audits_total;
    }
    return metrics?.announcement_audits?.length ?? 0;
  }, [metrics]);

  // Filtered datasets for Sections 1, 2, 3, and 4
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

  const filteredRbacUsers = useMemo(
    () =>
      filterRbacUsers(allUsers, {
        search: rbacSearch,
        role: rbacRoleFilter,
        department: rbacDeptFilter,
      }),
    [allUsers, rbacSearch, rbacRoleFilter, rbacDeptFilter]
  );

  const filteredSyncLogs = useMemo(
    () =>
      filterSyncLogs(metrics?.sync_logs || [], {
        search: syncSearch,
        syncType: syncTypeFilter,
        status: syncStatusFilter,
      }),
    [metrics, syncSearch, syncTypeFilter, syncStatusFilter]
  );

  const filteredAudits = useMemo(
    () =>
      filterAnnouncementAudits(metrics?.announcement_audits || [], {
        search: auditSearch,
        editorRole: auditEditorRoleFilter,
        changeType: auditChangeTypeFilter,
      }),
    [metrics, auditSearch, auditEditorRoleFilter, auditChangeTypeFilter]
  );

  const semesterError = getFieldValidationError(syncErrors, 'semester_code');

  if (!isAuthReady || !isAuthenticated) {
    return null;
  }

  if (user.role !== 'it_admin') {
    return (
      <AppShell title="IT Admin Console">
        <div className="p-6 lg:p-8 max-w-2xl w-full mx-auto">
          <div className="bg-white border-2 border-ustp-navy rounded-lg p-6 text-center space-y-3">
            <ShieldCheck className="w-10 h-10 text-ustp-navy mx-auto" />
            <h2 className="text-lg font-extrabold text-ustp-navy">
              IT Administrator Domain Isolated
            </h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              You are currently signed in to the{' '}
              <span className="font-bold text-ustp-navy uppercase">
                {user.role.replace('_', ' ')}
              </span>{' '}
              domain ({user.name}). To access the Account Verification Queue,
              RBAC Role Management, Account &amp; Roster Sync, and System
              Metrics, please sign in with an IT Administrator account.
            </p>
            <div className="pt-2">
              <a
                href="/login"
                className="inline-flex items-center gap-2 px-4 py-2 bg-ustp-navy text-ustp-gold text-xs font-extrabold rounded hover:opacity-95"
              >
                Go to Login Page
              </a>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  const queueFilterCount =
    (queueStatusFilter !== 'pending' ? 1 : 0) +
    (queueRoleFilter !== 'all' ? 1 : 0) +
    (queueDeptFilter !== 'ALL' ? 1 : 0);
  const hasActiveQueueFilters = queueSearch.trim() !== '' || queueFilterCount > 0;

  const rbacFilterCount =
    (rbacRoleFilter !== 'all' ? 1 : 0) + (rbacDeptFilter !== 'ALL' ? 1 : 0);

  const syncFilterCount =
    (syncTypeFilter !== 'all' ? 1 : 0) + (syncStatusFilter !== 'all' ? 1 : 0);

  const auditFilterCount =
    (auditEditorRoleFilter !== 'all' ? 1 : 0) +
    (auditChangeTypeFilter !== 'all' ? 1 : 0);

  const verificationRatePercent =
    totalRegisteredAccountsCount > 0
      ? Math.round((verifiedAccountsCount / totalRegisteredAccountsCount) * 100)
      : 0;

  return (
    <AppShell
      title={getAdminSectionTitle(activeTab)}
      activeAdminTab={activeTab}
    >
      <div className="p-4 sm:p-6 lg:p-8 max-w-6xl w-full mx-auto space-y-5 sm:space-y-6">
        {/* Top Live KPI Summary Row (4 cards matching live PostgreSQL records) */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Live Platform Overview (Actual Registered Accounts)
            </p>
            <button
              type="button"
              onClick={() => void loadAdminData({ manual: true })}
              disabled={isRefreshing || isLoading}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold text-ustp-navy bg-white border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`}
              />
              <span>{isRefreshing ? 'Refreshing...' : 'Refresh Data'}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {/* KPI 1: Pending Verifications */}
            <button
              type="button"
              onClick={() => navigateToSection('verifications')}
              className={`text-left bg-white rounded-lg p-3.5 sm:p-4 border transition-colors cursor-pointer ${
                activeTab === 'verifications'
                  ? 'border-ustp-navy ring-1 ring-ustp-navy/15'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <p className="text-xs font-bold text-slate-500">
                Pending Verifications
              </p>
              <p
                className={`text-xl sm:text-2xl font-extrabold font-mono tabular-nums mt-1 ${
                  pendingCount > 0 ? 'text-amber-700' : 'text-ustp-navy'
                }`}
              >
                {pendingCount.toLocaleString()}
              </p>
              <p className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums">
                {rejectedCount > 0
                  ? `${rejectedCount} rejected in archive`
                  : 'Registrar queue live'}
              </p>
            </button>

            {/* KPI 2: Registered Accounts (Actual DB Count, zero fake floor) */}
            <button
              type="button"
              onClick={() => navigateToSection('rbac')}
              className={`text-left bg-white rounded-lg p-3.5 sm:p-4 border transition-colors cursor-pointer ${
                activeTab === 'rbac'
                  ? 'border-ustp-navy ring-1 ring-ustp-navy/15'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <p className="text-xs font-bold text-slate-500">
                Registered Accounts
              </p>
              <p className="text-xl sm:text-2xl font-extrabold text-ustp-navy font-mono tabular-nums mt-1">
                {verifiedAccountsCount.toLocaleString()}
              </p>
              <p className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums">
                {totalRegisteredAccountsCount.toLocaleString()} total •{' '}
                {roleCounts.student} students,{' '}
                {roleCounts.faculty + roleCounts.dept_head} faculty
              </p>
            </button>

            {/* KPI 3: Live API Latency & Urgent Alerts (Real Measured Latency) */}
            <button
              type="button"
              onClick={() => navigateToSection('metrics')}
              className={`text-left bg-white rounded-lg p-3.5 sm:p-4 border transition-colors cursor-pointer ${
                activeTab === 'metrics'
                  ? 'border-ustp-navy ring-1 ring-ustp-navy/15'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <p className="text-xs font-bold text-slate-500">
                Live API Latency (&le;2.0s)
              </p>
              <p
                className={`text-xl sm:text-2xl font-extrabold font-mono tabular-nums mt-1 ${
                  latencyInfo.withinSla ? 'text-emerald-700' : 'text-red-700'
                }`}
              >
                {latencyInfo.primaryDisplay}
              </p>
              <p className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums">
                {typeof metrics?.urgent_announcements_count === 'number'
                  ? `${metrics.urgent_announcements_count} urgent alerts sent`
                  : 'Live DB round-trip'}
              </p>
            </button>

            {/* KPI 4: Immutable Edit Audits */}
            <button
              type="button"
              onClick={() => navigateToSection('metrics')}
              className={`text-left bg-white rounded-lg p-3.5 sm:p-4 border transition-colors cursor-pointer ${
                activeTab === 'metrics'
                  ? 'border-ustp-navy ring-1 ring-ustp-navy/15'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <p className="text-xs font-bold text-slate-500">
                Immutable Edit Audits
              </p>
              <p className="text-xl sm:text-2xl font-extrabold text-ustp-navy font-mono tabular-nums mt-1">
                {auditsTotal.toLocaleString()}
              </p>
              <p className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums">
                {typeof metrics?.published_announcements_count === 'number'
                  ? `${metrics.published_announcements_count} published notices`
                  : 'Append-only revision log'}
              </p>
            </button>
          </div>
        </div>

        {isLoading ? (
          <SkeletonCards count={2} />
        ) : error ? (
          <ErrorBanner message={error} onRetry={() => void loadAdminData()} />
        ) : activeTab === 'verifications' ? (
          /* ================================================================
             SECTION 1: ACCOUNT VERIFICATION QUEUE (SEARCH + TAGS + REJECTED)
             ================================================================ */
          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-extrabold text-ustp-text flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-ustp-navy" />
                  <span>Registrar Account Verification Queue</span>
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Review, approve, or reject pending Student and Faculty sign-ups, or re-approve previously rejected accounts.
                </p>
              </div>
              <span className="text-xs font-mono font-bold tabular-nums text-slate-500">
                Showing {filteredQueueUsers.length} of {queueUsers.length}
              </span>
            </div>

            {/* Search & Single Floating Filter Button */}
            <div className="px-5 py-3.5 bg-slate-50/80 border-b border-slate-200">
              <div className="flex items-center gap-2.5">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={queueSearch}
                    onChange={(e) => setQueueSearch(e.target.value)}
                    placeholder="Search by name, Institutional ID, @ustp.edu.ph email, mobile, or section..."
                    aria-label="Search verification queue"
                    className="w-full pl-9 pr-8 py-2 text-xs bg-white border border-slate-300 rounded-md text-ustp-text placeholder:text-slate-400 focus:outline-none focus:border-ustp-navy"
                  />
                  {queueSearch && (
                    <button
                      type="button"
                      onClick={() => setQueueSearch('')}
                      aria-label="Clear verification search"
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <FilterPopover
                  title="Filter Verification Queue"
                  ariaLabel="Filter verification queue"
                  activeCount={queueFilterCount}
                  triggerClassName="rounded-md"
                  onReset={() => {
                    setQueueStatusFilter('pending');
                    setQueueRoleFilter('all');
                    setQueueDeptFilter('ALL');
                  }}
                  sections={[
                    {
                      kind: 'single',
                      id: 'queue-status',
                      label: 'Status',
                      value: queueStatusFilter,
                      onChange: (val) =>
                        setQueueStatusFilter(val as VerificationStatusFilter),
                      options: [
                        { key: 'pending', label: `Pending (${pendingCount})` },
                        {
                          key: 'rejected',
                          label: `Rejected (${rejectedCount})`,
                        },
                        {
                          key: 'all',
                          label: `All Queue (${queueUsers.length})`,
                        },
                      ].map((item) => ({
                        value: item.key,
                        label: item.label,
                      })),
                    },
                    {
                      kind: 'single',
                      id: 'queue-role',
                      label: 'Role',
                      value: queueRoleFilter,
                      onChange: (val) =>
                        setQueueRoleFilter(val as 'all' | 'student' | 'faculty'),
                      options: [
                        { value: 'all', label: 'All' },
                        { value: 'student', label: 'Student' },
                        { value: 'faculty', label: 'Faculty' },
                      ],
                    },
                    {
                      kind: 'single',
                      id: 'queue-dept',
                      label: 'Department',
                      value: queueDeptFilter,
                      activeTone: 'blue',
                      onChange: (val) => setQueueDeptFilter(val),
                      options: (['ALL', ...ADMIN_DEPARTMENT_TAGS] as const).map(
                        (dept) => ({
                          value: dept,
                          label: dept === 'ALL' ? 'All Depts' : dept,
                        })
                      ),
                    },
                  ]}
                />
              </div>
            </div>

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
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                      <th className="py-3 px-4">Institutional ID</th>
                      <th className="py-3 px-4">Applicant &amp; Contact</th>
                      <th className="py-3 px-4">Role &amp; Scope Tags</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {filteredQueueUsers.map((applicant) => {
                      const isBusy = Boolean(busyUserIds[applicant.id]);
                      const isRejected =
                        applicant.verification_status === 'rejected';
                      const dept =
                        applicant.academic_profile?.department || 'UNASSIGNED';
                      const section = applicant.academic_profile?.section;

                      return (
                        <tr
                          key={applicant.id}
                          className="hover:bg-slate-50/80"
                        >
                          <td className="py-3 px-4 font-mono font-bold text-ustp-navy tabular-nums whitespace-nowrap">
                            {applicant.institutional_id}
                            {applicant.created_at && (
                              <p className="text-[11px] font-normal text-slate-500 mt-0.5">
                                {new Date(
                                  applicant.created_at
                                ).toLocaleDateString()}
                              </p>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <p className="font-bold text-ustp-text">
                              {applicant.name}
                            </p>
                            <p className="text-slate-500">{applicant.email}</p>
                            {applicant.contact_number && (
                              <p className="text-[11px] font-mono text-slate-500 tabular-nums mt-0.5">
                                {applicant.contact_number}
                              </p>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold border uppercase ${getRoleTagStyle(
                                  applicant.role
                                )}`}
                              >
                                {ROLE_LABELS[applicant.role]}
                              </span>
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold border uppercase ${getDeptTagStyle(
                                  dept
                                )}`}
                              >
                                {dept}
                              </span>
                              {section && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-slate-100 text-slate-700 border border-slate-200">
                                  {section}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold border uppercase ${
                                isRejected
                                  ? 'bg-red-50 text-red-800 border-red-200'
                                  : 'bg-amber-50 text-amber-800 border-amber-300'
                              }`}
                            >
                              {applicant.verification_status}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right space-x-2 whitespace-nowrap">
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                void handleVerifyUser(applicant.id, 'approved')
                              }
                              className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded disabled:opacity-50 cursor-pointer"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>
                                {isRejected ? 'Re-Approve' : 'Approve'}
                              </span>
                            </button>
                            {!isRejected && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() =>
                                  void handleVerifyUser(
                                    applicant.id,
                                    'rejected'
                                  )
                                }
                                className="inline-flex items-center gap-1 px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-800 font-bold rounded border border-red-300 disabled:opacity-50 cursor-pointer"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                <span>Reject</span>
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : activeTab === 'rbac' ? (
          /* ================================================================
             SECTION 2: RBAC ROLE MANAGEMENT (SEARCH + TAGS + DEPT EDITING)
             ================================================================ */
          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-extrabold text-ustp-text flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-ustp-navy" />
                  <span>Role-Based Access Control (RBAC) Directory</span>
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Manage verified ClariFy accounts, update institutional roles, and reassign department scopes in real time.
                </p>
              </div>
              <span className="text-xs font-mono font-bold tabular-nums text-slate-500">
                Showing {filteredRbacUsers.length} of {allUsers.length} approved
              </span>
            </div>

            {/* Search & Single Floating Filter Button */}
            <div className="px-5 py-3.5 bg-slate-50/80 border-b border-slate-200">
              <div className="flex items-center gap-2.5">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={rbacSearch}
                    onChange={(e) => setRbacSearch(e.target.value)}
                    placeholder="Search approved accounts by name, ID number, email, section, or role..."
                    aria-label="Search RBAC directory"
                    className="w-full pl-9 pr-8 py-2 text-xs bg-white border border-slate-300 rounded-md text-ustp-text placeholder:text-slate-400 focus:outline-none focus:border-ustp-navy"
                  />
                  {rbacSearch && (
                    <button
                      type="button"
                      onClick={() => setRbacSearch('')}
                      aria-label="Clear RBAC search"
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <FilterPopover
                  title="Filter RBAC Directory"
                  ariaLabel="Filter RBAC directory"
                  activeCount={rbacFilterCount}
                  triggerClassName="rounded-md"
                  onReset={() => {
                    setRbacRoleFilter('all');
                    setRbacDeptFilter('ALL');
                  }}
                  sections={[
                    {
                      kind: 'single',
                      id: 'rbac-role',
                      label: 'Role',
                      value: rbacRoleFilter,
                      onChange: (val) =>
                        setRbacRoleFilter(val as 'all' | UserRole),
                      options: [
                        { value: 'all', label: `All (${allUsers.length})` },
                        {
                          value: 'student',
                          label: `Student (${roleCounts.student})`,
                        },
                        {
                          value: 'faculty',
                          label: `Faculty (${roleCounts.faculty})`,
                        },
                        {
                          value: 'dept_head',
                          label: `Dept Head (${roleCounts.dept_head})`,
                        },
                        {
                          value: 'it_admin',
                          label: `IT Admin (${roleCounts.it_admin})`,
                        },
                      ],
                    },
                    {
                      kind: 'single',
                      id: 'rbac-dept',
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
              </div>
            </div>

            {filteredRbacUsers.length === 0 ? (
              <EmptyState
                title="No Accounts Match Your Filters"
                description="Try clearing the search query or switching the role and department filter tags."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                      <th className="py-3 px-4">ID Number</th>
                      <th className="py-3 px-4">Registered User</th>
                      <th className="py-3 px-4">Department Scope</th>
                      <th className="py-3 px-4">Assigned Role</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {filteredRbacUsers.map((u) => {
                      const isSelf = Number(u.id) === Number(user.id);
                      const isBusy = Boolean(busyUserIds[u.id]);
                      const currentDept = (
                        u.academic_profile?.department || 'CITC'
                      )
                        .trim()
                        .toUpperCase();
                      const deptOptions = Array.from(
                        new Set([...ADMIN_DEPARTMENT_TAGS, currentDept])
                      );

                      return (
                        <tr key={u.id} className="hover:bg-slate-50/80">
                          <td className="py-3 px-4 font-mono font-bold text-ustp-navy tabular-nums whitespace-nowrap">
                            {u.institutional_id}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-bold text-ustp-text">
                                {u.name}
                              </p>
                              <span
                                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border uppercase ${getRoleTagStyle(
                                  u.role
                                )}`}
                              >
                                {ROLE_LABELS[u.role]}
                              </span>
                              {isSelf && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                                  YOU
                                </span>
                              )}
                            </div>
                            <p className="text-slate-500">{u.email}</p>
                            {u.contact_number && (
                              <p className="text-[11px] font-mono text-slate-500 tabular-nums">
                                {u.contact_number}
                              </p>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2 flex-wrap">
                              <select
                                aria-label={`Assign department for ${u.name}`}
                                value={currentDept}
                                disabled={isBusy}
                                onChange={(e) =>
                                  void handleRoleOrDepartmentChange(
                                    u.id,
                                    u.role,
                                    e.target.value
                                  )
                                }
                                className="px-2.5 py-1.5 text-xs font-bold bg-white border border-slate-300 rounded text-ustp-blue focus:outline-none focus:border-ustp-navy disabled:opacity-50"
                              >
                                {deptOptions.map((d) => (
                                  <option key={d} value={d}>
                                    {d}
                                  </option>
                                ))}
                              </select>
                              {u.academic_profile?.section && (
                                <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 font-mono text-[11px] font-semibold">
                                  {u.academic_profile.section}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <select
                              aria-label={`Assign role for ${u.name}`}
                              value={u.role}
                              disabled={isBusy || isSelf}
                              title={
                                isSelf
                                  ? 'You cannot demote your own active IT Administrator account.'
                                  : undefined
                              }
                              onChange={(e) =>
                                void handleRoleOrDepartmentChange(
                                  u.id,
                                  e.target.value as UserRole,
                                  currentDept
                                )
                              }
                              className="px-2.5 py-1.5 text-xs font-bold bg-white border border-slate-300 rounded text-ustp-navy focus:outline-none focus:border-ustp-navy disabled:opacity-50 disabled:bg-slate-100"
                            >
                              <option value="student">Student</option>
                              <option value="faculty">Faculty</option>
                              <option value="dept_head">Dept Head</option>
                              <option value="it_admin">IT Admin</option>
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : activeTab === 'roster-sync' ? (
          /* ================================================================
             SECTION 3: REGISTERED ACCOUNT & ROSTER SYNC CONSOLE
             ================================================================ */
          <section className="space-y-5">
            <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-extrabold text-ustp-text flex items-center gap-2">
                    <Database className="w-4 h-4 text-ustp-navy" />
                    <span>Registered Account &amp; Roster Sync Console</span>
                  </h2>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    Synchronizes actual approved ClariFy accounts from PostgreSQL into matching department and section Course Hubs (while direct USTP PRISMS database access is not yet connected).
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-50 border border-amber-300 text-amber-900 text-[11px] font-bold shrink-0">
                  <Users className="w-3.5 h-3.5" />
                  <span className="font-mono tabular-nums">
                    {verifiedAccountsCount} Live Registered Accounts
                  </span>
                </span>
              </div>

              {/* Live Registered Accounts by Department Breakdown */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 pt-1">
                {ADMIN_DEPARTMENT_TAGS.map((dept) => (
                  <div
                    key={dept}
                    className="bg-slate-50 border border-slate-200 rounded-md px-3 py-2.5"
                  >
                    <p className="text-[11px] font-bold text-ustp-blue uppercase">
                      {dept}
                    </p>
                    <p className="text-lg font-extrabold text-ustp-navy font-mono tabular-nums mt-0.5">
                      {(departmentCounts[dept] || 0).toLocaleString()}
                    </p>
                    <p className="text-[10px] text-slate-500">
                      approved accounts
                    </p>
                  </div>
                ))}
                <div className="bg-slate-50 border border-slate-200 rounded-md px-3 py-2.5 col-span-2 sm:col-span-1">
                  <p className="text-[11px] font-bold text-slate-600 uppercase">
                    Scoped Channels
                  </p>
                  <p className="text-lg font-extrabold text-ustp-navy font-mono tabular-nums mt-0.5">
                    {(metrics?.active_channels_count ?? 0).toLocaleString()}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    {metrics?.course_hubs_count ?? 0} course hubs
                  </p>
                </div>
              </div>

              <form
                onSubmit={handleTriggerRosterSync}
                className="pt-2 border-t border-slate-200 flex flex-col sm:flex-row items-start sm:items-center gap-3"
              >
                <div className="w-full sm:w-64">
                  <label htmlFor="semester-code-input" className="sr-only">
                    Target Semester Code
                  </label>
                  <input
                    id="semester-code-input"
                    type="text"
                    value={semesterCode}
                    onChange={(e) => setSemesterCode(e.target.value)}
                    placeholder="2026-1ST-SEM"
                    className="w-full px-3.5 py-2 text-xs font-mono font-bold text-ustp-text border border-slate-300 rounded focus:outline-none focus:border-ustp-navy"
                  />
                  {semesterError && (
                    <p
                      className="text-xs font-semibold text-red-600 mt-1"
                      role="alert"
                    >
                      {semesterError}
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isSyncing}
                  className="inline-flex items-center gap-2 px-5 py-2 bg-ustp-navy text-ustp-gold text-xs font-extrabold rounded hover:opacity-95 disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`}
                  />
                  <span>
                    {isSyncing
                      ? 'Reconciling Registered Accounts...'
                      : 'Run Account & Roster Sync'}
                  </span>
                </button>
              </form>
            </div>

            {/* Synchronization History Logs with Search + Filter Tags */}
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-600">
                  Roster Synchronization History Logs
                </h3>
                <span className="text-xs font-mono font-bold tabular-nums text-slate-500">
                  Showing {filteredSyncLogs.length} of{' '}
                  {(metrics?.sync_logs || []).length} runs
                </span>
              </div>

              <div className="px-5 py-3 bg-slate-50/80 border-b border-slate-200">
                <div className="flex items-center gap-2.5">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={syncSearch}
                      onChange={(e) => setSyncSearch(e.target.value)}
                      placeholder="Search sync logs by ID, semester code, or admin name..."
                      aria-label="Search synchronization logs"
                      className="w-full pl-9 pr-8 py-2 text-xs bg-white border border-slate-300 rounded-md text-ustp-text placeholder:text-slate-400 focus:outline-none focus:border-ustp-navy"
                    />
                    {syncSearch && (
                      <button
                        type="button"
                        onClick={() => setSyncSearch('')}
                        aria-label="Clear sync log search"
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <FilterPopover
                    title="Filter Sync History"
                    ariaLabel="Filter synchronization logs"
                    activeCount={syncFilterCount}
                    triggerClassName="rounded-md"
                    onReset={() => {
                      setSyncTypeFilter('all');
                      setSyncStatusFilter('all');
                    }}
                    sections={[
                      {
                        kind: 'single',
                        id: 'sync-trigger',
                        label: 'Trigger',
                        value: syncTypeFilter,
                        onChange: (val) =>
                          setSyncTypeFilter(
                            val as 'all' | 'manual_admin' | 'scheduled_midnight'
                          ),
                        options: [
                          { value: 'all', label: 'All Runs' },
                          { value: 'manual_admin', label: 'Manual Admin' },
                          { value: 'scheduled_midnight', label: 'Scheduled' },
                        ],
                      },
                      {
                        kind: 'single',
                        id: 'sync-status',
                        label: 'Status',
                        value: syncStatusFilter,
                        activeTone: 'blue',
                        onChange: (val) =>
                          setSyncStatusFilter(
                            val as
                              | 'all'
                              | 'completed'
                              | 'partial_warning'
                              | 'failed'
                          ),
                        options: [
                          { value: 'all', label: 'All' },
                          { value: 'completed', label: 'Completed' },
                          { value: 'partial_warning', label: 'Warning' },
                          { value: 'failed', label: 'Failed' },
                        ],
                      },
                    ]}
                  />
                </div>
              </div>

              {filteredSyncLogs.length === 0 ? (
                <EmptyState
                  title={
                    (metrics?.sync_logs || []).length === 0
                      ? 'No Synchronization Runs Recorded Yet'
                      : 'No Sync Logs Match Your Filters'
                  }
                  description={
                    (metrics?.sync_logs || []).length === 0
                      ? 'Run an Account & Roster Sync above to reconcile approved registered accounts with Course Hubs.'
                      : 'Try adjusting your search query or trigger/status tags.'
                  }
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs font-mono tabular-nums">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-sans font-bold">
                        <th className="py-3 px-4">Sync ID</th>
                        <th className="py-3 px-4">Semester</th>
                        <th className="py-3 px-4">Triggered By</th>
                        <th className="py-3 px-4">Type</th>
                        <th className="py-3 px-4 text-right">
                          Accounts Synced
                        </th>
                        <th className="py-3 px-4 text-right">Channels</th>
                        <th className="py-3 px-4 text-right">Duration</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4">Executed At</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {filteredSyncLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-slate-50">
                          <td className="py-3 px-4 font-bold text-ustp-navy">
                            #{log.id}
                          </td>
                          <td className="py-3 px-4 font-bold">
                            {log.semester_code}
                          </td>
                          <td className="py-3 px-4 font-sans">
                            {log.triggered_by}
                          </td>
                          <td className="py-3 px-4 font-sans">
                            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 font-bold text-[10px] uppercase">
                              {log.sync_type === 'manual_admin'
                                ? 'Manual'
                                : 'Scheduled'}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right font-bold text-ustp-navy">
                            {log.total_updated.toLocaleString()}
                          </td>
                          <td className="py-3 px-4 text-right">
                            {log.channels_provisioned}
                          </td>
                          <td className="py-3 px-4 text-right text-slate-500">
                            {log.duration_ms}ms
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`px-2 py-0.5 rounded font-sans font-bold text-[11px] uppercase ${
                                log.status === 'failed'
                                  ? 'bg-red-100 text-red-800'
                                  : log.status === 'partial_warning'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-emerald-100 text-emerald-800'
                              }`}
                            >
                              {log.status.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-slate-500 whitespace-nowrap">
                            {log.executed_at
                              ? new Date(log.executed_at).toLocaleString()
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        ) : (
          /* ================================================================
             SECTION 4: SYSTEM METRICS & IMMUTABLE AUDIT TRAIL (SEARCH + TAGS)
             ================================================================ */
          <section className="space-y-5">
            {/* Real PostgreSQL Platform Health Breakdown */}
            <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-extrabold text-ustp-text flex items-center gap-2">
                    <Activity className="w-4 h-4 text-ustp-navy" />
                    <span>Live Platform Health Metrics</span>
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Real-time metrics computed directly from ClariFy PostgreSQL tables.
                  </p>
                </div>
                <span className="text-[11px] font-mono font-bold tabular-nums px-2.5 py-1 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                  API: {latencyInfo.primaryDisplay}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="bg-slate-50 border border-slate-200 rounded-md p-3.5">
                  <p className="text-[11px] font-bold text-slate-500 uppercase">
                    Verification Ratio
                  </p>
                  <p className="text-lg font-extrabold text-ustp-navy font-mono tabular-nums mt-0.5">
                    {verificationRatePercent}%
                  </p>
                  <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                    {verifiedAccountsCount} approved of{' '}
                    {totalRegisteredAccountsCount} registered
                  </p>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-md p-3.5">
                  <p className="text-[11px] font-bold text-slate-500 uppercase">
                    Overall Read Reach
                  </p>
                  <p className="text-lg font-extrabold text-ustp-navy font-mono tabular-nums mt-0.5">
                    {(metrics?.overall_read_reach_percentage ?? 0).toFixed(1)}%
                  </p>
                  <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                    Across {metrics?.published_announcements_count ?? 0}{' '}
                    published notices
                  </p>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-md p-3.5">
                  <p className="text-[11px] font-bold text-slate-500 uppercase flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 text-red-600" />
                    <span>Urgent &amp; SMS Notices</span>
                  </p>
                  <p className="text-lg font-extrabold text-ustp-navy font-mono tabular-nums mt-0.5">
                    {(metrics?.urgent_announcements_count ?? 0).toLocaleString()}
                  </p>
                  <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                    {metrics?.sms_fallback_dispatched_count ?? 0} with SMS
                    fallback
                  </p>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-md p-3.5">
                  <p className="text-[11px] font-bold text-slate-500 uppercase">
                    Active Channels
                  </p>
                  <p className="text-lg font-extrabold text-ustp-navy font-mono tabular-nums mt-0.5">
                    {(metrics?.active_channels_count ?? 0).toLocaleString()}
                  </p>
                  <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                    {metrics?.course_hubs_count ?? 0} top-level Course Hubs
                  </p>
                </div>
              </div>
            </div>

            {/* Searchable & Taggable Immutable Announcement Audit Trail */}
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-extrabold text-ustp-text flex items-center gap-2">
                    <History className="w-4 h-4 text-ustp-navy" />
                    <span>Immutable Announcement Audit Trail</span>
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Append-only log recording every edit made to published announcements, including previous/new content and editor identity.
                  </p>
                </div>
                <span className="text-xs font-mono font-bold tabular-nums text-slate-500">
                  Showing {filteredAudits.length} of{' '}
                  {(metrics?.announcement_audits || []).length} loaded (
                  {auditsTotal} total)
                </span>
              </div>

              {/* Search & Single Floating Filter Button */}
              <div className="px-5 py-3.5 bg-slate-50/80 border-b border-slate-200">
                <div className="flex items-center gap-2.5">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={auditSearch}
                      onChange={(e) => setAuditSearch(e.target.value)}
                      placeholder="Search audits by audit ID, post ID, title revision, content diff, or editor name..."
                      aria-label="Search announcement audit trail"
                      className="w-full pl-9 pr-8 py-2 text-xs bg-white border border-slate-300 rounded-md text-ustp-text placeholder:text-slate-400 focus:outline-none focus:border-ustp-navy"
                    />
                    {auditSearch && (
                      <button
                        type="button"
                        onClick={() => setAuditSearch('')}
                        aria-label="Clear audit search"
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <FilterPopover
                    title="Filter Audit Trail"
                    ariaLabel="Filter announcement audit trail"
                    activeCount={auditFilterCount}
                    triggerClassName="rounded-md"
                    onReset={() => {
                      setAuditEditorRoleFilter('all');
                      setAuditChangeTypeFilter('all');
                    }}
                    sections={[
                      {
                        kind: 'single',
                        id: 'audit-editor-role',
                        label: 'Editor Role',
                        value: auditEditorRoleFilter,
                        onChange: (val) =>
                          setAuditEditorRoleFilter(val as 'all' | UserRole),
                        options: [
                          { value: 'all', label: 'All Editors' },
                          { value: 'faculty', label: 'Faculty' },
                          { value: 'dept_head', label: 'Dept Head' },
                          { value: 'it_admin', label: 'IT Admin' },
                        ],
                      },
                      {
                        kind: 'single',
                        id: 'audit-change-type',
                        label: 'Change Type',
                        value: auditChangeTypeFilter,
                        activeTone: 'blue',
                        onChange: (val) =>
                          setAuditChangeTypeFilter(val as AuditChangeTypeFilter),
                        options: [
                          { value: 'all', label: 'All Changes' },
                          { value: 'title_changed', label: 'Title Changed' },
                          {
                            value: 'content_changed',
                            label: 'Content Changed',
                          },
                        ],
                      },
                    ]}
                  />
                </div>
              </div>

              {filteredAudits.length === 0 ? (
                <EmptyState
                  title={
                    (metrics?.announcement_audits || []).length === 0
                      ? 'No Announcement Revisions Logged Yet'
                      : 'No Audit Records Match Your Filters'
                  }
                  description={
                    (metrics?.announcement_audits || []).length === 0
                      ? 'When Faculty or Department Heads edit a published announcement, an immutable before/after audit record appears here.'
                      : 'Try clearing your search input or switching the editor role and change type tags.'
                  }
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                        <th className="py-3 px-4">Audit / Post ID</th>
                        <th className="py-3 px-4">
                          Previous Title &rarr; New Title
                        </th>
                        <th className="py-3 px-4">Content Revision Diff</th>
                        <th className="py-3 px-4">Editor</th>
                        <th className="py-3 px-4">Timestamp</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {filteredAudits.map((audit) => {
                        const titleChanged =
                          audit.previous_title.trim() !==
                          audit.new_title.trim();
                        const contentChanged =
                          audit.previous_content.trim() !==
                          audit.new_content.trim();

                        return (
                          <tr
                            key={audit.id}
                            className="hover:bg-slate-50 align-top"
                          >
                            <td className="py-3 px-4 font-mono font-bold text-ustp-navy tabular-nums whitespace-nowrap">
                              <p>#{audit.id}</p>
                              <p className="text-[11px] font-normal text-slate-500">
                                Post #{audit.announcement_id}
                              </p>
                              <div className="flex flex-wrap gap-1 mt-1.5 font-sans">
                                {titleChanged && (
                                  <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-bold">
                                    TITLE
                                  </span>
                                )}
                                {contentChanged && (
                                  <span className="px-1.5 py-0.5 rounded bg-sky-50 text-ustp-blue border border-sky-200 text-[10px] font-bold">
                                    CONTENT
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-3 px-4 space-y-1">
                              {titleChanged ? (
                                <>
                                  <p className="text-red-700 line-through">
                                    {audit.previous_title}
                                  </p>
                                  <p className="font-bold text-emerald-800">
                                    {audit.new_title}
                                  </p>
                                </>
                              ) : (
                                <p className="font-bold text-ustp-text">
                                  {audit.new_title}
                                </p>
                              )}
                            </td>
                            <td className="py-3 px-4 max-w-md space-y-1">
                              <p className="text-slate-500 text-[11px] line-clamp-2">
                                Prev: {audit.previous_content}
                              </p>
                              <p className="text-ustp-text font-medium text-[11px] line-clamp-2">
                                New: {audit.new_content}
                              </p>
                            </td>
                            <td className="py-3 px-4 whitespace-nowrap">
                              <p className="font-bold text-ustp-text">
                                {audit.editor_name}
                              </p>
                              <div className="flex items-center gap-1.5 mt-1">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold border uppercase ${getRoleTagStyle(
                                    audit.editor_role
                                  )}`}
                                >
                                  {ROLE_LABELS[audit.editor_role] ||
                                    audit.editor_role}
                                </span>
                                <span className="text-slate-500 font-mono text-[11px] tabular-nums">
                                  ID #{audit.editor_id}
                                </span>
                              </div>
                            </td>
                            <td className="py-3 px-4 font-mono text-slate-600 tabular-nums whitespace-nowrap">
                              {new Date(audit.edited_at).toLocaleString()}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}

export default function AdminConsolePage() {
  return (
    <Suspense fallback={null}>
      <AdminConsoleContent />
    </Suspense>
  );
}
