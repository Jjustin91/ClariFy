import { Feather } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type {
  AdminMetricsSnapshot,
  AdminSectionTab,
} from '@/lib/domain-logic';
import { colors, radii, spacing, typography } from '@/theme';

export interface AdminKpiRowProps {
  activeTab: AdminSectionTab;
  snapshot: AdminMetricsSnapshot;
  isLoading: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  onSelectTab: (tab: AdminSectionTab) => void;
}

/**
 * Shared Top Live KPI Summary Row ported from clarify-web/app/admin/page.tsx.
 * - Visible "Refresh Data" button alongside pull-to-refresh.
 * - 4 Pressable KPI cards that deep-link to sections, show an active border,
 *   color pending (>0 amber) and latency (emerald/red SLA), and render "—" when missing.
 */
export function AdminKpiRow({
  activeTab,
  snapshot,
  isLoading,
  isRefreshing,
  onRefresh,
  onSelectTab,
}: AdminKpiRowProps) {
  const { kpi } = snapshot;
  const refreshDisabled = isLoading || isRefreshing;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.eyebrow}>
          LIVE PLATFORM OVERVIEW (ACTUAL REGISTERED ACCOUNTS)
        </Text>
        <Pressable
          onPress={onRefresh}
          disabled={refreshDisabled}
          accessibilityRole="button"
          accessibilityLabel={
            isRefreshing ? 'Refreshing admin data' : 'Refresh Data'
          }
          style={({ pressed }) => [
            styles.refreshBtn,
            refreshDisabled && styles.disabledBtn,
            pressed && !refreshDisabled && styles.pressed,
          ]}
        >
          {isRefreshing ? (
            <ActivityIndicator size="small" color={colors.ustpNavy} />
          ) : (
            <Feather name="refresh-cw" size={13} color={colors.ustpNavy} />
          )}
          <Text style={styles.refreshBtnText}>
            {isRefreshing ? 'Refreshing...' : 'Refresh Data'}
          </Text>
        </Pressable>
      </View>

      <View style={styles.grid}>
        {/* KPI 1: Pending Verifications */}
        <Pressable
          onPress={() => onSelectTab('verifications')}
          accessibilityRole="button"
          accessibilityState={{ selected: activeTab === 'verifications' }}
          accessibilityLabel={`Pending Verifications: ${kpi.pendingDisplay}. ${kpi.pendingSubline}`}
          style={({ pressed }) => [
            styles.card,
            activeTab === 'verifications' && styles.cardActive,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.cardLabel}>Pending Verifications</Text>
          <Text
            style={[
              styles.cardValue,
              kpi.isPendingWarning && styles.cardValueWarning,
            ]}
          >
            {kpi.pendingDisplay}
          </Text>
          <Text numberOfLines={2} style={styles.cardSubline}>
            {kpi.pendingSubline}
          </Text>
        </Pressable>

        {/* KPI 2: Registered Accounts */}
        <Pressable
          onPress={() => onSelectTab('rbac')}
          accessibilityRole="button"
          accessibilityState={{ selected: activeTab === 'rbac' }}
          accessibilityLabel={`Registered Accounts: ${kpi.registeredDisplay}. ${kpi.registeredSubline}`}
          style={({ pressed }) => [
            styles.card,
            activeTab === 'rbac' && styles.cardActive,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.cardLabel}>Registered Accounts</Text>
          <Text style={styles.cardValue}>{kpi.registeredDisplay}</Text>
          <Text numberOfLines={2} style={styles.cardSubline}>
            {kpi.registeredSubline}
          </Text>
        </Pressable>

        {/* KPI 3: Live API Latency (<=2.0s) */}
        <Pressable
          onPress={() => onSelectTab('metrics')}
          accessibilityRole="button"
          accessibilityState={{ selected: activeTab === 'metrics' }}
          accessibilityLabel={`Live API Latency: ${kpi.latencyDisplay}. ${kpi.latencySubline}`}
          style={({ pressed }) => [
            styles.card,
            activeTab === 'metrics' && styles.cardActive,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.cardLabel}>Live API Latency (≤2.0s)</Text>
          <Text
            style={[
              styles.cardValue,
              kpi.hasLatencyMeasurement &&
                (kpi.isLatencySlaMet
                  ? styles.cardValueSuccess
                  : styles.cardValueDanger),
            ]}
          >
            {kpi.latencyDisplay}
          </Text>
          <Text numberOfLines={2} style={styles.cardSubline}>
            {kpi.latencySubline}
          </Text>
        </Pressable>

        {/* KPI 4: Immutable Edit Audits */}
        <Pressable
          onPress={() => onSelectTab('metrics')}
          accessibilityRole="button"
          accessibilityState={{ selected: activeTab === 'metrics' }}
          accessibilityLabel={`Immutable Edit Audits: ${kpi.auditsDisplay}. ${kpi.auditsSubline}`}
          style={({ pressed }) => [
            styles.card,
            activeTab === 'metrics' && styles.cardActive,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.cardLabel}>Immutable Edit Audits</Text>
          <Text style={styles.cardValue}>{kpi.auditsDisplay}</Text>
          <Text numberOfLines={2} style={styles.cardSubline}>
            {kpi.auditsSubline}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm + 2,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  eyebrow: {
    flex: 1,
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xxs,
    lineHeight: typography.lineHeights.xxs,
    fontWeight: '800',
    letterSpacing: 0.6,
    color: colors.mutedSlate,
  },
  refreshBtn: {
    minHeight: 38,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.white,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
  },
  refreshBtnText: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  card: {
    width: '48%',
    flexGrow: 1,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.xs,
  },
  cardActive: {
    borderWidth: 2,
    borderColor: colors.ustpNavy,
  },
  cardLabel: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '700',
    color: colors.mutedSlate,
  },
  cardValue: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.titleLg,
    lineHeight: typography.lineHeights.titleLg,
    fontWeight: '900',
    color: colors.ustpNavy,
    ...typography.tabularNums,
  },
  cardValueWarning: {
    color: colors.warningBorder,
  },
  cardValueSuccess: {
    color: colors.successBorder,
  },
  cardValueDanger: {
    color: colors.dangerBorder,
  },
  cardSubline: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xxs,
    lineHeight: typography.lineHeights.xxs,
    color: colors.mutedSlate,
    ...typography.tabularNums,
  },
  disabledBtn: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.85,
  },
});
