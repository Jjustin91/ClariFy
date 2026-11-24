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
  type AdminMetricsSnapshot,
  filterSyncLogs,
  getFieldValidationError,
} from '@/lib/domain-logic';
import { colors, radii, spacing, touchTarget, typography } from '@/theme';
import type { ApiError, PrismsSyncLog } from '@/types/api';

import { adminSharedStyles, formatAdminDateTime } from './adminSharedStyles';

export interface AdminRosterSyncSectionProps {
  snapshot: AdminMetricsSnapshot;
  syncLogs: PrismsSyncLog[];
  isLoading: boolean;
  error: ApiError | null;
  onRetry: () => void;
  onTriggerSync: (semesterCode: string) => Promise<{
    ok: boolean;
    errors?: Record<string, string[]>;
  }>;
}

/**
 * Section 3: Registered Account & Roster Sync Console ported from clarify-web/app/admin/page.tsx.
 * - 5-card summary (CITC, CEA, COT, CSM approved accounts + Scoped Channels / Course Hubs)
 * - Semester sync trigger form
 * - Synchronization History Logs with search, Trigger (manual_admin / scheduled_midnight),
 *   and Status (completed / partial_warning / failed) filter chips
 * - Shows all 9 web fields including Type and Executed At on each log card
 */
export function AdminRosterSyncSection({
  snapshot,
  syncLogs,
  isLoading,
  error,
  onRetry,
  onTriggerSync,
}: AdminRosterSyncSectionProps) {
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

  const filteredSyncLogs = useMemo(
    () =>
      filterSyncLogs(syncLogs, {
        search: syncSearch,
        syncType: syncTypeFilter,
        status: syncStatusFilter,
      }),
    [syncLogs, syncSearch, syncTypeFilter, syncStatusFilter]
  );

  if (isLoading) {
    return <SkeletonCards count={2} />;
  }

  if (error) {
    return <ErrorBanner error={error} onRetry={onRetry} />;
  }

  const semesterError = getFieldValidationError(syncErrors, 'semester_code');
  const hasActiveSyncFilters =
    syncSearch.trim() !== '' ||
    syncTypeFilter !== 'all' ||
    syncStatusFilter !== 'all';

  const handleRunSync = async () => {
    if (isSyncing) return;
    const trimmed = semesterCode.trim();
    if (!trimmed) {
      setSyncErrors({
        semester_code: [
          'Please specify a target semester code (e.g., 2026-1ST-SEM).',
        ],
      });
      return;
    }

    setSyncErrors({});
    setIsSyncing(true);
    const result = await onTriggerSync(trimmed);
    setIsSyncing(false);

    if (!result.ok && result.errors) {
      setSyncErrors(result.errors);
    }
  };

  return (
    <View style={adminSharedStyles.sectionStack}>
      {/* Top Card: Registered Account & Roster Sync Console + 5-Card Summary */}
      <View style={styles.topSyncCard}>
        <View style={styles.topSyncHeader}>
          <View style={styles.topSyncCopy}>
            <View style={adminSharedStyles.sectionTitleRow}>
              <Feather name="database" size={16} color={colors.ustpNavy} />
              <Text style={adminSharedStyles.sectionTitle}>
                Registered Account &amp; Roster Sync Console
              </Text>
            </View>
            <Text style={adminSharedStyles.sectionSubtitle}>
              Synchronizes actual approved ClariFy accounts from PostgreSQL into
              matching department and section Course Hubs (while direct USTP
              PRISMS database access is not yet connected).
            </Text>
          </View>

          <View style={styles.liveRegisteredPill}>
            <Feather name="users" size={13} color={colors.warningText} />
            <Text style={styles.liveRegisteredPillText}>
              {snapshot.rosterSummary.liveRegisteredLabel}
            </Text>
          </View>
        </View>

        {/* 5-Card Summary Grid (CITC, CEA, COT, CSM + Scoped Channels) */}
        <View style={styles.summaryGrid}>
          {ADMIN_DEPARTMENT_TAGS.map((dept) => (
            <View key={dept} style={styles.summaryCard}>
              <Text style={styles.summaryDeptLabel}>{dept}</Text>
              <Text style={styles.summaryValue}>
                {snapshot.rosterSummary.departmentDisplayByTag[dept]}
              </Text>
              <Text style={styles.summarySubline}>approved accounts</Text>
            </View>
          ))}

          <View style={[styles.summaryCard, styles.summaryCardWide]}>
            <Text style={styles.summaryChannelLabel}>Scoped Channels</Text>
            <Text style={styles.summaryValue}>
              {snapshot.rosterSummary.scopedChannelsDisplay}
            </Text>
            <Text style={styles.summarySubline}>
              {snapshot.rosterSummary.courseHubsSubline}
            </Text>
          </View>
        </View>

        {/* Semester Code Form */}
        <View style={styles.syncFormBlock}>
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
              styles.semesterInput,
              Boolean(semesterError) && styles.semesterInputError,
            ]}
          />
          {semesterError && (
            <Text style={styles.fieldErrorText} accessibilityRole="alert">
              {semesterError}
            </Text>
          )}

          <Pressable
            onPress={() => void handleRunSync()}
            disabled={isSyncing}
            accessibilityRole="button"
            accessibilityLabel="Run Account and Roster Sync"
            style={({ pressed }) => [
              styles.syncSubmitBtn,
              isSyncing && adminSharedStyles.disabledBtn,
              pressed && !isSyncing && adminSharedStyles.pressed,
            ]}
          >
            {isSyncing ? (
              <ActivityIndicator size="small" color={colors.ustpGold} />
            ) : (
              <Feather name="refresh-cw" size={15} color={colors.ustpGold} />
            )}
            <Text style={styles.syncSubmitBtnText}>
              {isSyncing
                ? 'Reconciling Registered Accounts...'
                : 'Run Account & Roster Sync'}
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Bottom Card: Roster Synchronization History Logs */}
      <View style={adminSharedStyles.sectionCard}>
        <View style={adminSharedStyles.sectionHeaderBlock}>
          <View style={adminSharedStyles.sectionHeaderTopRow}>
            <Text style={styles.historyTitle}>
              ROSTER SYNCHRONIZATION HISTORY LOGS
            </Text>
            <Text style={adminSharedStyles.showingCounter}>
              Showing {filteredSyncLogs.length} of {syncLogs.length} runs
            </Text>
          </View>
        </View>

        {/* Search + Trigger + Status Filter Chips */}
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
                value={syncSearch}
                onChangeText={setSyncSearch}
                placeholder="Search sync logs by ID, semester code, or admin name..."
                placeholderTextColor={colors.placeholder}
                accessibilityLabel="Search synchronization logs"
                style={adminSharedStyles.searchInput}
              />
              {syncSearch.length > 0 && (
                <Pressable
                  onPress={() => setSyncSearch('')}
                  accessibilityRole="button"
                  accessibilityLabel="Clear sync log search"
                  style={adminSharedStyles.searchClearBtn}
                >
                  <Feather name="x" size={15} color={colors.mutedSlate} />
                </Pressable>
              )}
            </View>

            {hasActiveSyncFilters && (
              <Pressable
                onPress={() => {
                  setSyncSearch('');
                  setSyncTypeFilter('all');
                  setSyncStatusFilter('all');
                }}
                accessibilityRole="button"
                accessibilityLabel="Reset sync log filters"
                style={({ pressed }) => [
                  adminSharedStyles.resetBtn,
                  pressed && adminSharedStyles.pressed,
                ]}
              >
                <Feather
                  name="rotate-ccw"
                  size={13}
                  color={colors.mutedSlate}
                />
                <Text style={adminSharedStyles.resetBtnText}>Reset</Text>
              </Pressable>
            )}
          </View>

          {/* Trigger Chips */}
          <View style={adminSharedStyles.filterGroup}>
            <Text style={adminSharedStyles.filterGroupLabel}>Trigger:</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={adminSharedStyles.chipsScrollRow}
            >
              {(
                [
                  { key: 'all', label: 'All Runs' },
                  { key: 'manual_admin', label: 'Manual Admin' },
                  { key: 'scheduled_midnight', label: 'Scheduled' },
                ] as const
              ).map((item) => {
                const active = syncTypeFilter === item.key;
                return (
                  <Pressable
                    key={item.key}
                    onPress={() => setSyncTypeFilter(item.key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Trigger filter ${item.label}`}
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
                  { key: 'all', label: 'All' },
                  { key: 'completed', label: 'Completed' },
                  { key: 'partial_warning', label: 'Warning' },
                  { key: 'failed', label: 'Failed' },
                ] as const
              ).map((item) => {
                const active = syncStatusFilter === item.key;
                return (
                  <Pressable
                    key={item.key}
                    onPress={() => setSyncStatusFilter(item.key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Status filter ${item.label}`}
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
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>

        {/* Sync History Cards */}
        <View style={adminSharedStyles.sectionBody}>
          {filteredSyncLogs.length === 0 ? (
            <EmptyState
              title={
                syncLogs.length === 0
                  ? 'No Synchronization Runs Recorded Yet'
                  : 'No Sync Logs Match Your Filters'
              }
              description={
                syncLogs.length === 0
                  ? 'Run an Account & Roster Sync above to reconcile approved registered accounts with Course Hubs.'
                  : 'Try adjusting your search query or trigger/status tags.'
              }
            />
          ) : (
            filteredSyncLogs.map((log) => {
              const isFailed = log.status === 'failed';
              const isWarning = log.status === 'partial_warning';
              const typeLabel =
                log.sync_type === 'manual_admin' ? 'Manual' : 'Scheduled';

              return (
                <View key={String(log.id)} style={adminSharedStyles.recordCard}>
                  <View style={adminSharedStyles.recordTopRow}>
                    <Text style={adminSharedStyles.recordId}>
                      #{log.id} • {log.semester_code}
                    </Text>

                    <View style={adminSharedStyles.badgesWrapRow}>
                      <View style={styles.typePill}>
                        <Text style={styles.typePillText}>{typeLabel}</Text>
                      </View>
                      <View
                        style={[
                          adminSharedStyles.badgePill,
                          isFailed
                            ? styles.statusFailed
                            : isWarning
                              ? styles.statusWarning
                              : styles.statusCompleted,
                        ]}
                      >
                        <Text
                          style={[
                            adminSharedStyles.badgePillText,
                            isFailed
                              ? styles.statusFailedText
                              : isWarning
                                ? styles.statusWarningText
                                : styles.statusCompletedText,
                          ]}
                        >
                          {log.status.replace('_', ' ')}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <Text style={adminSharedStyles.recordEmail}>
                    Triggered By: {log.triggered_by}
                  </Text>

                  <View style={styles.metricsChipsRow}>
                    <View style={styles.metricChip}>
                      <Text style={styles.metricChipText}>
                        Accounts Synced: {log.total_updated.toLocaleString()}
                      </Text>
                    </View>
                    <View style={styles.metricChip}>
                      <Text style={styles.metricChipText}>
                        Channels: {log.channels_provisioned}
                      </Text>
                    </View>
                    <View style={styles.metricChip}>
                      <Text style={styles.metricChipText}>
                        Duration: {log.duration_ms}ms
                      </Text>
                    </View>
                  </View>

                  <Text style={adminSharedStyles.recordSubMeta}>
                    Executed At: {formatAdminDateTime(log.executed_at)}
                  </Text>
                </View>
              );
            })
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  topSyncCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.md + 2,
  },
  topSyncHeader: {
    gap: spacing.sm,
  },
  topSyncCopy: {
    gap: spacing.xs,
  },
  liveRegisteredPill: {
    alignSelf: 'flex-start',
    backgroundColor: colors.warningBg,
    borderWidth: 1,
    borderColor: colors.tagMemoBorder,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  liveRegisteredPillText: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xxs,
    fontWeight: '800',
    color: colors.warningText,
    ...typography.tabularNums,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  summaryCard: {
    width: '48%',
    flexGrow: 1,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    gap: 2,
  },
  summaryCardWide: {
    width: '100%',
  },
  summaryDeptLabel: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xxs,
    fontWeight: '800',
    color: colors.ustpBlue,
    textTransform: 'uppercase',
  },
  summaryChannelLabel: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xxs,
    fontWeight: '800',
    color: colors.mutedSlate,
    textTransform: 'uppercase',
  },
  summaryValue: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.titleSm,
    lineHeight: typography.lineHeights.titleSm,
    fontWeight: '900',
    color: colors.ustpNavy,
    ...typography.tabularNums,
  },
  summarySubline: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xxs,
    lineHeight: typography.lineHeights.xxs,
    color: colors.mutedSlate,
    ...typography.tabularNums,
  },
  syncFormBlock: {
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  inputLabel: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpText,
  },
  semesterInput: {
    minHeight: touchTarget.minHeight,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.ustpText,
    ...typography.tabularNums,
  },
  semesterInputError: {
    borderColor: colors.dangerBorder,
  },
  fieldErrorText: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.dangerTitle,
  },
  syncSubmitBtn: {
    minHeight: touchTarget.minHeight,
    borderRadius: radii.md,
    backgroundColor: colors.ustpNavy,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  syncSubmitBtnText: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpGold,
  },
  historyTitle: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '800',
    letterSpacing: 0.6,
    color: colors.mutedSlate,
  },
  typePill: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  typePillText: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xxs,
    lineHeight: typography.lineHeights.xxs,
    fontWeight: '800',
    color: colors.tagNeutralText,
    textTransform: 'uppercase',
  },
  statusCompleted: {
    backgroundColor: colors.successBg,
    borderColor: colors.tagFacultyBorder,
  },
  statusCompletedText: {
    color: colors.successText,
  },
  statusWarning: {
    backgroundColor: colors.warningBg,
    borderColor: colors.tagMemoBorder,
  },
  statusWarningText: {
    color: colors.warningText,
  },
  statusFailed: {
    backgroundColor: colors.dangerBg,
    borderColor: colors.urgentCardBorder,
  },
  statusFailedText: {
    color: colors.dangerTitle,
  },
  metricsChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs + 2,
    marginTop: 2,
  },
  metricChip: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  metricChipText: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xxs,
    fontWeight: '700',
    color: colors.ustpNavy,
    ...typography.tabularNums,
  },
});
