import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';

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
  type AdminSectionTab,
  computeAdminMetricsSnapshot,
} from '../lib/domain-logic';
import { resolveAdminPendingCount } from '../lib/realtime-reducer';
import { colors, spacing } from '../theme';
import type {
  AdminMetricsResponse,
  ApiError,
  User,
  UserRole,
} from '../types/api';
import { AdminKpiRow } from './admin/AdminKpiRow';
import { AdminMetricsAuditSection } from './admin/AdminMetricsAuditSection';
import { AdminRbacSection } from './admin/AdminRbacSection';
import { AdminRosterSyncSection } from './admin/AdminRosterSyncSection';
import { AdminVerificationSection } from './admin/AdminVerificationSection';

export interface AdminConsoleViewProps {
  activeTab?: AdminSectionTab;
  onSelectTab?: (tab: AdminSectionTab) => void;
}

/**
 * Slim IT Administrator Console Coordinator ported from clarify-web/app/admin/page.tsx.
 * - Fetches pending+rejected queue (`status: 'all', per_page: 100`), approved users, and live metrics.
 * - Measures real client round-trip latency and updates drawer `adminPendingCount`.
 * - Subscribes to RealtimeContext events (zero polling).
 * - Renders the shared tappable `AdminKpiRow` above the active section component.
 */
export function AdminConsoleView({
  activeTab: controlledTab,
  onSelectTab,
}: AdminConsoleViewProps = {}) {
  const { user, showToast } = useAuth();
  const realtime = useOptionalRealtime();

  const [fallbackTab, setFallbackTab] =
    useState<AdminSectionTab>('verifications');
  const activeTab: AdminSectionTab = controlledTab ?? fallbackTab;

  const handleSelectTab = useCallback(
    (nextTab: AdminSectionTab) => {
      if (onSelectTab) {
        onSelectTab(nextTab);
      } else {
        setFallbackTab(nextTab);
      }
    },
    [onSelectTab]
  );

  const [queueUsers, setQueueUsers] = useState<User[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [metrics, setMetrics] = useState<AdminMetricsResponse | null>(null);
  const [clientRoundTripMs, setClientRoundTripMs] = useState<number | null>(
    null
  );
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [busyUserIds, setBusyUserIds] = useState<Record<number, boolean>>({});

  const hasLoadedOnceRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const setAdminPendingCount = realtime?.setAdminPendingCount;

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
        const startedAt = Date.now();
        const [queueRes, usersRes, metricsRes] = await Promise.all([
          getPendingUsersApi({ status: 'all', per_page: 100 }),
          getAllUsersApi(),
          getAdminMetricsApi(),
        ]);
        const endedAt = Date.now();
        const measuredMs = Math.max(1, Math.round(endedAt - startedAt));

        if (!mountedRef.current) return;

        const loadedQueue = Array.isArray(queueRes?.data) ? queueRes.data : [];
        const loadedUsers = Array.isArray(usersRes?.data) ? usersRes.data : [];
        const loadedMetrics = metricsRes?.data ?? null;

        setClientRoundTripMs(measuredMs);
        setQueueUsers(loadedQueue);
        setAllUsers(loadedUsers);
        setMetrics(loadedMetrics);

        const pendingLiveCount = loadedQueue.filter(
          (u) => u.verification_status === 'pending'
        ).length;
        setAdminPendingCount?.(
          resolveAdminPendingCount(
            loadedMetrics?.pending_verifications_count,
            pendingLiveCount
          )
        );

        hasLoadedOnceRef.current = true;
        setHasLoadedOnce(true);
        setError(null);
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
    [user, setAdminPendingCount]
  );

  // Initial load + reload when RealtimeContext bumps adminVersion (admin.updated, db.changed, foreground resume, socket reconnect)
  const realtimeAdminVersion = realtime?.adminVersion ?? 0;

  useEffect(() => {
    if (!user || user.role !== 'it_admin') {
      return;
    }
    const mode = hasLoadedOnceRef.current ? 'silent' : 'initial';
    void loadAdminData(mode);
  }, [user, realtimeAdminVersion, loadAdminData]);

  // Also refresh on announcement/channel realtime events (matching clarify-web/app/admin/page.tsx)
  const subscribeRealtimeEvents = realtime?.subscribeRealtimeEvents;

  useEffect(() => {
    if (!user || user.role !== 'it_admin' || !subscribeRealtimeEvents) {
      return;
    }
    return subscribeRealtimeEvents((event) => {
      if (
        event.type === 'announcement.updated' ||
        event.type === 'announcement.created' ||
        event.type === 'announcement.urgent' ||
        event.type === 'announcement.deleted' ||
        event.type === 'channel.created' ||
        event.type === 'channel.updated'
      ) {
        void loadAdminData('silent');
      }
    });
  }, [user, subscribeRealtimeEvents, loadAdminData]);

  const handleVerifyUser = useCallback(
    async (userId: number, status: 'approved' | 'rejected') => {
      setBusyUserIds((prev) => ({ ...prev, [userId]: true }));
      try {
        const res = await verifyUserAccountApi(userId, status);
        showToast(
          res?.message || `Account ${status}.`,
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
          setBusyUserIds((prev) => {
            const next = { ...prev };
            delete next[userId];
            return next;
          });
        }
      }
    },
    [loadAdminData, showToast]
  );

  const handleUpdateRoleAndDept = useCallback(
    async (
      userId: number,
      newRole: UserRole,
      newDepartment: string
    ): Promise<{ ok: boolean; errors?: Record<string, string[]> }> => {
      setBusyUserIds((prev) => ({ ...prev, [userId]: true }));
      try {
        const res = await updateUserRoleApi(userId, {
          role: newRole,
          department: newDepartment,
        });
        showToast(res?.message || 'Account permissions updated.', 'success');
        await loadAdminData('silent');
        return { ok: true };
      } catch (err) {
        const apiErr = err as ApiError;
        if (apiErr.status === 422 && apiErr.errors) {
          return { ok: false, errors: apiErr.errors };
        }
        if (apiErr.status !== 401) {
          showToast(
            apiErr.message || 'Failed to update account role or department.',
            'error'
          );
        }
        return { ok: false };
      } finally {
        if (mountedRef.current) {
          setBusyUserIds((prev) => {
            const next = { ...prev };
            delete next[userId];
            return next;
          });
        }
      }
    },
    [loadAdminData, showToast]
  );

  const handleTriggerRosterSync = useCallback(
    async (
      semesterCode: string
    ): Promise<{ ok: boolean; errors?: Record<string, string[]> }> => {
      try {
        const res = await triggerPrismsSyncApi(semesterCode);
        showToast(
          res.message ||
            `Synchronized ${res.total_updated} registered accounts.`,
          'success'
        );
        await loadAdminData('silent');
        return { ok: true };
      } catch (err) {
        const apiErr = err as ApiError;
        if (apiErr.status === 422 && apiErr.errors) {
          return { ok: false, errors: apiErr.errors };
        }
        if (apiErr.status !== 401) {
          showToast(
            apiErr.message || 'Account & roster synchronization failed.',
            'error'
          );
        }
        return { ok: false };
      }
    },
    [loadAdminData, showToast]
  );

  const snapshot = useMemo(
    () =>
      computeAdminMetricsSnapshot({
        metrics,
        queueUsers: hasLoadedOnce ? queueUsers : null,
        allUsers: hasLoadedOnce ? allUsers : null,
        clientRoundTripMs,
      }),
    [metrics, queueUsers, allUsers, hasLoadedOnce, clientRoundTripMs]
  );

  // Strict non-admin render isolation
  if (!user || user.role !== 'it_admin') {
    return null;
  }

  return (
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
      <AdminKpiRow
        activeTab={activeTab}
        snapshot={snapshot}
        isLoading={isLoading}
        isRefreshing={isRefreshing}
        onRefresh={() => void loadAdminData('refresh')}
        onSelectTab={handleSelectTab}
      />

      {activeTab === 'verifications' ? (
        <AdminVerificationSection
          queueUsers={queueUsers}
          pendingCount={snapshot.pendingCount}
          rejectedCount={snapshot.rejectedCount}
          busyUserIds={busyUserIds}
          isLoading={isLoading}
          error={error}
          onRetry={() => void loadAdminData('initial')}
          onVerifyUser={(uid, status) => void handleVerifyUser(uid, status)}
        />
      ) : activeTab === 'rbac' ? (
        <AdminRbacSection
          currentUserId={user.id}
          allUsers={allUsers}
          roleCounts={snapshot.roleCounts}
          busyUserIds={busyUserIds}
          isLoading={isLoading}
          error={error}
          onRetry={() => void loadAdminData('initial')}
          onUpdateRoleAndDept={handleUpdateRoleAndDept}
        />
      ) : activeTab === 'roster-sync' ? (
        <AdminRosterSyncSection
          snapshot={snapshot}
          syncLogs={metrics?.sync_logs ?? []}
          isLoading={isLoading}
          error={error}
          onRetry={() => void loadAdminData('initial')}
          onTriggerSync={handleTriggerRosterSync}
        />
      ) : (
        <AdminMetricsAuditSection
          snapshot={snapshot}
          audits={metrics?.announcement_audits ?? []}
          isLoading={isLoading}
          error={error}
          onRetry={() => void loadAdminData('initial')}
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
});
