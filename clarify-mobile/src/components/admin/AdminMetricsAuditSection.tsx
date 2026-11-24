import { Feather } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import {
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
  type AdminMetricsSnapshot,
  type AuditChangeTypeFilter,
  filterAnnouncementAudits,
} from '@/lib/domain-logic';
import { colors, radii, spacing, typography } from '@/theme';
import type { AnnouncementAudit, ApiError, UserRole } from '@/types/api';

import {
  adminSharedStyles,
  formatAdminDateTime,
  getRoleBadgeColors,
  ROLE_LABELS,
} from './adminSharedStyles';

export interface AdminMetricsAuditSectionProps {
  snapshot: AdminMetricsSnapshot;
  audits: AnnouncementAudit[];
  isLoading: boolean;
  error: ApiError | null;
  onRetry: () => void;
}

/**
 * Section 4: System Metrics & Immutable Audit Trail ported from clarify-web/app/admin/page.tsx.
 * - "Live Platform Health Metrics" card with 4 health cards + API latency pill
 * - Searchable & taggable "Immutable Announcement Audit Trail" with before/after diff boxes
 */
export function AdminMetricsAuditSection({
  snapshot,
  audits,
  isLoading,
  error,
  onRetry,
}: AdminMetricsAuditSectionProps) {
  const [auditSearch, setAuditSearch] = useState('');
  const [auditEditorRoleFilter, setAuditEditorRoleFilter] = useState<
    'all' | UserRole
  >('all');
  const [auditChangeTypeFilter, setAuditChangeTypeFilter] =
    useState<AuditChangeTypeFilter>('all');

  const filteredAudits = useMemo(
    () =>
      filterAnnouncementAudits(audits, {
        search: auditSearch,
        editorRole: auditEditorRoleFilter,
        changeType: auditChangeTypeFilter,
      }),
    [audits, auditSearch, auditEditorRoleFilter, auditChangeTypeFilter]
  );

  if (isLoading) {
    return <SkeletonCards count={2} />;
  }

  if (error) {
    return <ErrorBanner error={error} onRetry={onRetry} />;
  }

  const hasActiveAuditFilters =
    auditSearch.trim() !== '' ||
    auditEditorRoleFilter !== 'all' ||
    auditChangeTypeFilter !== 'all';

  const { health, latency, kpi } = snapshot;

  return (
    <View style={adminSharedStyles.sectionStack}>
      {/* Top Card: Live Platform Health Metrics (4 Health Cards + API Latency Pill) */}
      <View style={styles.healthContainerCard}>
        <View style={styles.healthHeaderRow}>
          <View style={styles.healthHeaderCopy}>
            <View style={adminSharedStyles.sectionTitleRow}>
              <Feather name="activity" size={16} color={colors.ustpNavy} />
              <Text style={adminSharedStyles.sectionTitle}>
                Live Platform Health Metrics
              </Text>
            </View>
            <Text style={adminSharedStyles.sectionSubtitle}>
              Real-time metrics computed directly from ClariFy PostgreSQL
              tables.
            </Text>
          </View>

          <View
            style={[
              styles.apiLatencyPill,
              !latency.withinSla && styles.apiLatencyPillDanger,
            ]}
          >
            <Text
              style={[
                styles.apiLatencyPillText,
                !latency.withinSla && styles.apiLatencyPillTextDanger,
              ]}
            >
              API: {latency.primaryDisplay}
            </Text>
          </View>
        </View>

        <View style={styles.healthGrid}>
          {/* Health Card 1: Verification Ratio */}
          <View style={styles.healthCard}>
            <Text style={styles.healthCardLabel}>Verification Ratio</Text>
            <Text style={styles.healthCardValue}>
              {health.verificationRatioDisplay}
            </Text>
            <Text style={styles.healthCardSubline}>
              {health.verificationRatioSubline}
            </Text>
          </View>

          {/* Health Card 2: Overall Read Reach */}
          <View style={styles.healthCard}>
            <Text style={styles.healthCardLabel}>Overall Read Reach</Text>
            <Text style={styles.healthCardValue}>
              {health.overallReadReachDisplay}
            </Text>
            <Text style={styles.healthCardSubline}>
              {health.overallReadReachSubline}
            </Text>
          </View>

          {/* Health Card 3: Urgent & SMS Notices */}
          <View style={styles.healthCard}>
            <View style={styles.urgentLabelRow}>
              <Feather
                name="alert-triangle"
                size={12}
                color={colors.dangerBorder}
              />
              <Text style={styles.healthCardLabel}>
                Urgent &amp; SMS Notices
              </Text>
            </View>
            <Text style={styles.healthCardValue}>
              {health.urgentNoticesDisplay}
            </Text>
            <Text style={styles.healthCardSubline}>
              {health.urgentNoticesSubline}
            </Text>
          </View>

          {/* Health Card 4: Active Channels */}
          <View style={styles.healthCard}>
            <Text style={styles.healthCardLabel}>Active Channels</Text>
            <Text style={styles.healthCardValue}>
              {health.activeChannelsDisplay}
            </Text>
            <Text style={styles.healthCardSubline}>
              {health.activeChannelsSubline}
            </Text>
          </View>
        </View>
      </View>

      {/* Bottom Card: Immutable Announcement Audit Trail */}
      <View style={adminSharedStyles.sectionCard}>
        <View style={adminSharedStyles.sectionHeaderBlock}>
          <View style={adminSharedStyles.sectionHeaderTopRow}>
            <View style={adminSharedStyles.sectionTitleRow}>
              <Feather name="clock" size={16} color={colors.ustpNavy} />
              <Text style={adminSharedStyles.sectionTitle}>
                Immutable Announcement Audit Trail
              </Text>
            </View>
            <Text style={adminSharedStyles.showingCounter}>
              Showing {filteredAudits.length} of {audits.length} loaded (
              {kpi.auditsDisplay} total)
            </Text>
          </View>
          <Text style={adminSharedStyles.sectionSubtitle}>
            Append-only log recording every edit made to published
            announcements, including previous/new content and editor identity.
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
                value={auditSearch}
                onChangeText={setAuditSearch}
                placeholder="Search audits by audit ID, post ID, title revision, content diff, or editor name..."
                placeholderTextColor={colors.placeholder}
                accessibilityLabel="Search announcement audit trail"
                style={adminSharedStyles.searchInput}
              />
              {auditSearch.length > 0 && (
                <Pressable
                  onPress={() => setAuditSearch('')}
                  accessibilityRole="button"
                  accessibilityLabel="Clear audit search"
                  style={adminSharedStyles.searchClearBtn}
                >
                  <Feather name="x" size={15} color={colors.mutedSlate} />
                </Pressable>
              )}
            </View>

            {hasActiveAuditFilters && (
              <Pressable
                onPress={() => {
                  setAuditSearch('');
                  setAuditEditorRoleFilter('all');
                  setAuditChangeTypeFilter('all');
                }}
                accessibilityRole="button"
                accessibilityLabel="Reset Filters"
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
                <Text style={adminSharedStyles.resetBtnText}>
                  Reset Filters
                </Text>
              </Pressable>
            )}
          </View>

          {/* Editor Role Filter Chips */}
          <View style={adminSharedStyles.filterGroup}>
            <Text style={adminSharedStyles.filterGroupLabel}>
              Editor Role:
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={adminSharedStyles.chipsScrollRow}
            >
              {(
                [
                  { key: 'all', label: 'All Editors' },
                  { key: 'faculty', label: 'Faculty' },
                  { key: 'dept_head', label: 'Dept Head' },
                  { key: 'it_admin', label: 'IT Admin' },
                ] as const
              ).map((item) => {
                const active = auditEditorRoleFilter === item.key;
                return (
                  <Pressable
                    key={item.key}
                    onPress={() => setAuditEditorRoleFilter(item.key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Filter audits by editor role ${item.label}`}
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

          {/* Change Type Filter Chips */}
          <View style={adminSharedStyles.filterGroup}>
            <Text style={adminSharedStyles.filterGroupLabel}>
              Change Type:
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={adminSharedStyles.chipsScrollRow}
            >
              {(
                [
                  { key: 'all', label: 'All Changes' },
                  { key: 'title_changed', label: 'Title Changed' },
                  { key: 'content_changed', label: 'Content Changed' },
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

        {/* Audit Records Body */}
        <View style={adminSharedStyles.sectionBody}>
          {filteredAudits.length === 0 ? (
            <EmptyState
              title={
                audits.length === 0
                  ? 'No Announcement Revisions Logged Yet'
                  : 'No Audit Records Match Your Filters'
              }
              description={
                audits.length === 0
                  ? 'When Faculty or Department Heads edit a published announcement, an immutable before/after audit record appears here.'
                  : 'Try clearing your search input or switching the editor role and change type tags.'
              }
            />
          ) : (
            filteredAudits.map((audit) => {
              const titleChanged =
                (audit.previous_title || '').trim() !==
                (audit.new_title || '').trim();
              const contentChanged =
                (audit.previous_content || '').trim() !==
                (audit.new_content || '').trim();
              const roleColors = getRoleBadgeColors(audit.editor_role);

              return (
                <View
                  key={String(audit.id)}
                  style={adminSharedStyles.recordCard}
                >
                  <View style={adminSharedStyles.recordTopRow}>
                    <View>
                      <Text style={adminSharedStyles.recordId}>
                        #{audit.id} • Post #{audit.announcement_id}
                      </Text>
                    </View>
                    <Text style={adminSharedStyles.recordSubMeta}>
                      {formatAdminDateTime(audit.edited_at)}
                    </Text>
                  </View>

                  <View style={adminSharedStyles.badgesWrapRow}>
                    {titleChanged && (
                      <View style={styles.titleChangeBadge}>
                        <Text style={styles.titleChangeBadgeText}>TITLE</Text>
                      </View>
                    )}
                    {contentChanged && (
                      <View style={styles.contentChangeBadge}>
                        <Text style={styles.contentChangeBadgeText}>
                          CONTENT
                        </Text>
                      </View>
                    )}
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
                        {ROLE_LABELS[audit.editor_role] || audit.editor_role}
                      </Text>
                    </View>
                  </View>

                  {/* Title Diff */}
                  <View style={styles.titleDiffBlock}>
                    {titleChanged ? (
                      <>
                        <Text style={styles.prevTitleText}>
                          {audit.previous_title}
                        </Text>
                        <Text style={styles.newTitleText}>
                          → {audit.new_title}
                        </Text>
                      </>
                    ) : (
                      <Text style={styles.unchangedTitleText}>
                        {audit.new_title}
                      </Text>
                    )}
                  </View>

                  {/* Content Revision Diff Box */}
                  <View style={styles.diffBox}>
                    <Text numberOfLines={3} style={styles.prevContentText}>
                      Prev: {audit.previous_content}
                    </Text>
                    <Text numberOfLines={3} style={styles.newContentText}>
                      New: {audit.new_content}
                    </Text>
                  </View>

                  <Text style={adminSharedStyles.recordSubMeta}>
                    Editor: {audit.editor_name} • ID #{audit.editor_id}
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
  healthContainerCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  healthHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  healthHeaderCopy: {
    flex: 1,
    minWidth: 180,
    gap: spacing.xxs,
  },
  apiLatencyPill: {
    backgroundColor: colors.successBg,
    borderWidth: 1,
    borderColor: colors.tagFacultyBorder,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
  },
  apiLatencyPillDanger: {
    backgroundColor: colors.dangerBg,
    borderColor: colors.urgentCardBorder,
  },
  apiLatencyPillText: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xxs,
    fontWeight: '800',
    color: colors.successText,
    ...typography.tabularNums,
  },
  apiLatencyPillTextDanger: {
    color: colors.dangerTitle,
  },
  healthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  healthCard: {
    width: '48%',
    flexGrow: 1,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: 2,
  },
  urgentLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  healthCardLabel: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xxs,
    lineHeight: typography.lineHeights.xxs,
    fontWeight: '800',
    color: colors.mutedSlate,
    textTransform: 'uppercase',
  },
  healthCardValue: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.titleSm,
    lineHeight: typography.lineHeights.titleSm,
    fontWeight: '900',
    color: colors.ustpNavy,
    marginTop: 2,
    ...typography.tabularNums,
  },
  healthCardSubline: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xxs,
    lineHeight: typography.lineHeights.xxs,
    color: colors.mutedSlate,
    ...typography.tabularNums,
  },
  titleChangeBadge: {
    backgroundColor: colors.tagMemoBg,
    borderWidth: 1,
    borderColor: colors.tagMemoBorder,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
  },
  titleChangeBadgeText: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xxs,
    fontWeight: '800',
    color: colors.tagMemoText,
  },
  contentChangeBadge: {
    backgroundColor: colors.tagDeptBg,
    borderWidth: 1,
    borderColor: colors.tagDeptBorder,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
  },
  contentChangeBadgeText: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xxs,
    fontWeight: '800',
    color: colors.ustpBlue,
  },
  titleDiffBlock: {
    gap: 2,
  },
  prevTitleText: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.dangerTitle,
    textDecorationLine: 'line-through',
  },
  newTitleText: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.successText,
  },
  unchangedTitleText: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.ustpText,
  },
  diffBox: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  prevContentText: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xxs,
    lineHeight: typography.lineHeights.xxs,
    color: colors.mutedSlate,
  },
  newContentText: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xxs,
    lineHeight: typography.lineHeights.xxs,
    fontWeight: '600',
    color: colors.ustpText,
  },
});
