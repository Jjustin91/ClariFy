import { StyleSheet } from 'react-native';

import { colors, radii, spacing, touchTarget, typography } from '@/theme';
import type { UserRole } from '@/types/api';

export const ROLE_LABELS: Record<UserRole, string> = {
  student: 'Student',
  faculty: 'Faculty',
  dept_head: 'Dept Head',
  it_admin: 'IT Admin',
};

export function getRoleBadgeColors(role: UserRole): {
  backgroundColor: string;
  borderColor: string;
  textColor: string;
} {
  switch (role) {
    case 'faculty':
      return {
        backgroundColor: colors.tagFacultyBg,
        borderColor: colors.tagFacultyBorder,
        textColor: colors.tagFacultyText,
      };
    case 'dept_head':
      return {
        backgroundColor: colors.tagMemoBg,
        borderColor: colors.tagMemoBorder,
        textColor: colors.tagMemoText,
      };
    case 'it_admin':
      return {
        backgroundColor: colors.ustpNavy,
        borderColor: colors.ustpNavy,
        textColor: colors.ustpGold,
      };
    default:
      return {
        backgroundColor: colors.tagDeptBg,
        borderColor: colors.tagDeptBorder,
        textColor: colors.tagDeptText,
      };
  }
}

export function getDeptBadgeColors(dept: string | null | undefined): {
  backgroundColor: string;
  borderColor: string;
  textColor: string;
} {
  const normalized = (dept || '').trim().toUpperCase();
  if (
    normalized === 'CITC' ||
    normalized === 'CEA' ||
    normalized === 'COT' ||
    normalized === 'CSM'
  ) {
    return {
      backgroundColor: colors.tagDeptBg,
      borderColor: colors.tagDeptBorder,
      textColor: colors.ustpBlue,
    };
  }
  return {
    backgroundColor: colors.tagNeutralBg,
    borderColor: colors.tagNeutralBorder,
    textColor: colors.tagNeutralText,
  };
}

export function formatAdminShortDate(
  iso: string | null | undefined
): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return date.toLocaleDateString();
  }
}

export function formatAdminDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  try {
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return date.toLocaleString();
  }
}

export const adminSharedStyles = StyleSheet.create({
  sectionStack: {
    gap: spacing.lg,
  },
  sectionCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    overflow: 'hidden',
  },
  sectionHeaderBlock: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.xs,
  },
  sectionHeaderTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
  },
  sectionTitle: {
    flexShrink: 1,
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.bodyLg,
    lineHeight: typography.lineHeights.bodyLg,
    fontWeight: '800',
    color: colors.ustpText,
  },
  sectionSubtitle: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    color: colors.mutedSlate,
  },
  showingCounter: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '700',
    color: colors.mutedSlate,
    ...typography.tabularNums,
  },
  filterPanel: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surfaceSubtle,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm + 2,
  },
  searchAndResetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  searchWrap: {
    flex: 1,
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
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    paddingLeft: 38,
    paddingRight: 40,
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xs,
    color: colors.ustpText,
  },
  searchClearBtn: {
    position: 'absolute',
    right: 0,
    minWidth: 40,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resetBtn: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
  },
  resetBtnText: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.mutedSlate,
  },
  filterGroup: {
    gap: spacing.xs,
  },
  filterGroupLabel: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xxs,
    lineHeight: typography.lineHeights.xxs,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: colors.mutedSlate,
    textTransform: 'uppercase',
  },
  chipsScrollRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    paddingRight: spacing.xs,
  },
  filterChip: {
    minHeight: 36,
    paddingHorizontal: spacing.sm + 4,
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
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xxs,
    fontWeight: '800',
    color: colors.ustpText,
    ...typography.tabularNums,
  },
  filterChipTextNavyActive: {
    color: colors.ustpGold,
  },
  filterChipTextBlueActive: {
    color: colors.white,
  },
  sectionBody: {
    padding: spacing.lg,
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
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  recordId: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '800',
    color: colors.ustpNavy,
    ...typography.tabularNums,
  },
  recordSubMeta: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xxs,
    lineHeight: typography.lineHeights.xxs,
    color: colors.mutedSlate,
    ...typography.tabularNums,
  },
  recordName: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.body,
    lineHeight: typography.lineHeights.body,
    fontWeight: '800',
    color: colors.ustpText,
  },
  recordEmail: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    color: colors.mutedSlate,
  },
  recordPhone: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xxs,
    lineHeight: typography.lineHeights.xxs,
    color: colors.mutedSlate,
    ...typography.tabularNums,
  },
  badgesWrapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  badgePill: {
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgePillText: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xxs,
    lineHeight: typography.lineHeights.xxs,
    fontWeight: '800',
    textTransform: 'uppercase',
    ...typography.tabularNums,
  },
  sectionPill: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  sectionPillText: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xxs,
    lineHeight: typography.lineHeights.xxs,
    fontWeight: '700',
    color: colors.tagNeutralText,
    ...typography.tabularNums,
  },
  minTouchButton: {
    minHeight: touchTarget.minHeight,
  },
  disabledBtn: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.85,
  },
});
