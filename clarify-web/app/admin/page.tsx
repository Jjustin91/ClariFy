'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Database,
  History,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { AppShell } from '@/src/components/layout/AppShell';
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
import { getFieldValidationError } from '@/src/lib/domain-logic';
import type {
  AdminMetricsResponse,
  LaravelValidationError,
  User,
  UserRole,
} from '@/src/types/api';

type AdminTab = 'verifications' | 'rbac' | 'prisms' | 'metrics';

export default function AdminConsolePage() {
  const { announcementVersion, showToast } = useClarify();

  const [activeTab, setActiveTab] = useState<AdminTab>('verifications');
  const [pendingUsers, setPendingUsers] = useState<User[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [metrics, setMetrics] = useState<AdminMetricsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // PRISMS Sync state (FR-10)
  const [semesterCode, setSemesterCode] = useState('2026-1ST-SEM');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncErrors, setSyncErrors] = useState<Record<string, string[]>>({});

  const loadAdminData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [pendingRes, usersRes, metricsRes] = await Promise.all([
        getPendingUsersApi(),
        getAllUsersApi(),
        getAdminMetricsApi(),
      ]);
      setPendingUsers(pendingRes.data);
      setAllUsers(usersRes.data);
      setMetrics(metricsRes.data);
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      setError(
        apiErr.message || 'Failed to load IT Administrator Console data.'
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAdminData();
  }, [loadAdminData, announcementVersion]);

  const handleVerifyUser = async (
    userId: number,
    status: 'approved' | 'rejected'
  ) => {
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
    }
  };

  const handleRoleChange = async (
    userId: number,
    newRole: UserRole,
    department: string
  ) => {
    try {
      const res = await updateUserRoleApi(userId, {
        role: newRole,
        department,
      });
      showToast(res.message || 'Role updated.', 'success');
      await loadAdminData();
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      showToast(apiErr.message || 'Role update failed.', 'error');
    }
  };

  const handleTriggerPrismsSync = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSyncing(true);
    setSyncErrors({});
    try {
      const res = await triggerPrismsSyncApi(semesterCode);
      showToast(
        `${res.message} (${res.total_updated} records synced)`,
        'success'
      );
      await loadAdminData();
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      if (apiErr.status === 422 && apiErr.errors) {
        setSyncErrors(apiErr.errors);
      } else {
        showToast(apiErr.message || 'PRISMS sync failed.', 'error');
      }
    } finally {
      setIsSyncing(false);
    }
  };

  const semesterError = getFieldValidationError(syncErrors, 'semester_code');

  return (
    <AppShell title="IT Admin Console">
      <div className="p-6 lg:p-8 max-w-6xl w-full mx-auto space-y-6">
        {/* Top Summary KPI Cards */}
        {metrics && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <p className="text-xs font-bold text-slate-500">
                Pending Verifications (FR-08)
              </p>
              <p className="text-2xl font-extrabold text-ustp-navy font-mono tabular-nums mt-1">
                {pendingUsers.length}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <p className="text-xs font-bold text-slate-500">
                PRISMS Synced Accounts (FR-10)
              </p>
              <p className="text-2xl font-extrabold text-ustp-navy font-mono tabular-nums mt-1">
                {metrics.active_users_count.toLocaleString()}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <p className="text-xs font-bold text-slate-500">
                Urgent Push Latency (NFR-02 &le;2.0s)
              </p>
              <p className="text-2xl font-extrabold text-emerald-700 font-mono tabular-nums mt-1">
                {metrics.push_queue_latency_seconds}s
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <p className="text-xs font-bold text-slate-500">
                Immutable Edit Audits (NFR-03_REV)
              </p>
              <p className="text-2xl font-extrabold text-ustp-navy font-mono tabular-nums mt-1">
                {metrics.announcement_audits.length}
              </p>
            </div>
          </div>
        )}

        {/* 4 Tabbed Views matching Section A.7 */}
        <div
          className="flex items-center gap-2 flex-wrap border-b border-slate-200 pb-3"
          role="tablist"
          aria-label="IT Administrator Console Tabs"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'verifications'}
            onClick={() => setActiveTab('verifications')}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-bold transition-colors cursor-pointer ${
              activeTab === 'verifications'
                ? 'bg-ustp-navy text-ustp-gold'
                : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-100'
            }`}
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span>1. Account Verification Queue ({pendingUsers.length})</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'rbac'}
            onClick={() => setActiveTab('rbac')}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-bold transition-colors cursor-pointer ${
              activeTab === 'rbac'
                ? 'bg-ustp-navy text-ustp-gold'
                : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-100'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>2. RBAC Role Management (FR-09)</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'prisms'}
            onClick={() => setActiveTab('prisms')}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-bold transition-colors cursor-pointer ${
              activeTab === 'prisms'
                ? 'bg-ustp-navy text-ustp-gold'
                : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-100'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>3. PRISMS Database Sync Console (FR-10)</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'metrics'}
            onClick={() => setActiveTab('metrics')}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-bold transition-colors cursor-pointer ${
              activeTab === 'metrics'
                ? 'bg-ustp-navy text-ustp-gold'
                : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-100'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>4. System Metrics &amp; Audit Trail (NFR-03_REV)</span>
          </button>
        </div>

        {isLoading ? (
          <SkeletonCards count={2} />
        ) : error ? (
          <ErrorBanner message={error} onRetry={loadAdminData} />
        ) : activeTab === 'verifications' ? (
          /* TAB 1: ACCOUNT VERIFICATION QUEUE (FR-08) */
          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-extrabold text-ustp-text">
                  Registrar Account Verification Queue (FR-08 • GET /api/v1/admin/users/pending)
                </h2>
                <p className="text-xs text-slate-500">
                  Cross-check pending Student and Faculty registrations against USTP Registrar records.
                </p>
              </div>
            </div>

            {pendingUsers.length === 0 ? (
              <EmptyState
                title="All Pending Accounts Verified"
                description="There are zero unverified registrations waiting in the registrar queue."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                      <th className="py-3 px-4">Institutional ID</th>
                      <th className="py-3 px-4">Full Name &amp; Email</th>
                      <th className="py-3 px-4">Requested Role</th>
                      <th className="py-3 px-4">Department / Section</th>
                      <th className="py-3 px-4 text-right">Actions (PATCH /verify)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {pendingUsers.map((pending) => (
                      <tr key={pending.id} className="hover:bg-slate-50/80">
                        <td className="py-3 px-4 font-mono font-bold text-ustp-navy tabular-nums">
                          {pending.institutional_id}
                        </td>
                        <td className="py-3 px-4">
                          <p className="font-bold text-ustp-text">{pending.name}</p>
                          <p className="text-slate-500">{pending.email}</p>
                        </td>
                        <td className="py-3 px-4 font-semibold uppercase">
                          {pending.role}
                        </td>
                        <td className="py-3 px-4">
                          {pending.academic_profile?.department} •{' '}
                          {pending.academic_profile?.section}
                        </td>
                        <td className="py-3 px-4 text-right space-x-2 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() =>
                              handleVerifyUser(pending.id, 'approved')
                            }
                            className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded cursor-pointer"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Approve</span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handleVerifyUser(pending.id, 'rejected')
                            }
                            className="inline-flex items-center gap-1 px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-800 font-bold rounded border border-red-300 cursor-pointer"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Reject</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : activeTab === 'rbac' ? (
          /* TAB 2: RBAC ROLE MANAGEMENT (FR-09) */
          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h2 className="text-sm font-extrabold text-ustp-text">
                Role-Based Access Control (RBAC) Directory (FR-09 • PATCH /api/v1/admin/users/&#123;id&#125;/role)
              </h2>
              <p className="text-xs text-slate-500">
                Assign, modify, or revoke institutional roles and department scopes.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                    <th className="py-3 px-4">ID Number</th>
                    <th className="py-3 px-4">User</th>
                    <th className="py-3 px-4">Department Scope</th>
                    <th className="py-3 px-4">Assigned Role</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {allUsers.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50/80">
                      <td className="py-3 px-4 font-mono font-bold text-ustp-navy tabular-nums">
                        {u.institutional_id}
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-bold text-ustp-text">{u.name}</p>
                        <p className="text-slate-500">{u.email}</p>
                      </td>
                      <td className="py-3 px-4 font-semibold">
                        {u.academic_profile?.department || 'CITC'} (
                        {u.academic_profile?.section || 'Scope'})
                      </td>
                      <td className="py-3 px-4">
                        <select
                          aria-label={`Assign role for ${u.name}`}
                          value={u.role}
                          onChange={(e) =>
                            handleRoleChange(
                              u.id,
                              e.target.value as UserRole,
                              u.academic_profile?.department || 'CITC'
                            )
                          }
                          className="px-2.5 py-1.5 text-xs font-bold bg-white border border-slate-300 rounded text-ustp-navy focus:outline-none focus:border-ustp-navy"
                        >
                          <option value="student">student</option>
                          <option value="faculty">faculty</option>
                          <option value="dept_head">dept_head</option>
                          <option value="it_admin">it_admin</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : activeTab === 'prisms' ? (
          /* TAB 3: PRISMS DATABASE SYNC CONSOLE (FR-10) */
          <section className="space-y-5">
            <div className="bg-white border border-slate-200 rounded-lg p-5">
              <h2 className="text-sm font-extrabold text-ustp-text">
                USTP PRISMS Roster &amp; Scoped Channel Synchronization (FR-10 • POST /api/v1/admin/sync-prisms)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Automated midnight batch job runs every 24h. Trigger a manual sync below to provision semester channels and rosters immediately.
              </p>

              <form
                onSubmit={handleTriggerPrismsSync}
                className="mt-4 flex flex-col sm:flex-row items-start sm:items-center gap-3"
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
                      ? 'Synchronizing PRISMS...'
                      : 'Trigger Manual PRISMS Sync'}
                  </span>
                </button>
              </form>
            </div>

            {/* Sync History Log Table */}
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-600">
                  PRISMS Synchronization History Logs
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs font-mono tabular-nums">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-sans font-bold">
                      <th className="py-3 px-4">Sync ID</th>
                      <th className="py-3 px-4">Semester Code</th>
                      <th className="py-3 px-4">Triggered By</th>
                      <th className="py-3 px-4 text-right">Records Updated</th>
                      <th className="py-3 px-4 text-right">Channels</th>
                      <th className="py-3 px-4 text-right">Duration</th>
                      <th className="py-3 px-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {(metrics?.sync_logs || []).map((log) => (
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
                          <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-sans font-bold text-[11px]">
                            {log.status.toUpperCase()}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        ) : (
          /* TAB 4: SYSTEM METRICS & IMMUTABLE ANNOUNCEMENT AUDIT TRAIL (NFR-03_REV) */
          <section className="space-y-5">
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-extrabold text-ustp-text flex items-center gap-2">
                    <Activity className="w-4 h-4 text-ustp-navy" />
                    <span>
                      Immutable Announcement Audit Trail (NFR-03_REV • announcement_audits)
                    </span>
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Append-only log recording every edit made to published announcements, including previous/new content and editor identity.
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                      <th className="py-3 px-4">Audit ID</th>
                      <th className="py-3 px-4">Previous Title &rarr; New Title</th>
                      <th className="py-3 px-4">Content Revision Diff</th>
                      <th className="py-3 px-4">Editor</th>
                      <th className="py-3 px-4">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {(metrics?.announcement_audits || []).map((audit) => (
                      <tr key={audit.id} className="hover:bg-slate-50 align-top">
                        <td className="py-3 px-4 font-mono font-bold text-ustp-navy tabular-nums">
                          #{audit.id} (Post #{audit.announcement_id})
                        </td>
                        <td className="py-3 px-4 space-y-1">
                          <p className="text-red-700 line-through">
                            {audit.previous_title}
                          </p>
                          <p className="font-bold text-emerald-800">
                            {audit.new_title}
                          </p>
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
                          <p className="text-slate-500 font-mono text-[11px] tabular-nums">
                            ID: {audit.editor_id} ({audit.editor_role})
                          </p>
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-600 tabular-nums whitespace-nowrap">
                          {new Date(audit.edited_at).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
