import { Platform } from 'react-native';

/**
 * Official USTP-CDO ClariFy Mobile Design System Tokens.
 * Screens and components must import tokens from '@/theme' and never hardcode hex values.
 */
export const colors = {
  ustpNavy: '#1a1851',
  ustpNavyDark: '#000b3d',
  ustpNavySurface: '#25236b',
  ustpNavyBorder: '#353282',
  ustpNavyMutedText: '#cbd5e1',
  ustpGold: '#fcb315',
  ustpGoldSoft: '#fef3c7',
  ustpOrange: '#ff9718',
  ustpOrangeDark: '#ff6418',
  ustpOrangeDivider: '#c26a0a',
  ustpCream: '#FFFAF2',
  ustpText: '#031c2e',
  ustpBlue: '#0d4a77',
  ustpSky: '#329dea',

  white: '#FFFFFF',
  surfaceMuted: '#f1f5f9',
  surfaceSubtle: '#f8fafc',
  border: '#e2e8f0',
  borderStrong: '#cbd5e1',
  mutedSlate: '#475569',
  placeholder: '#94a3b8',
  skeletonBase: '#e2e8f0',
  skeletonLight: '#f1f5f9',
  overlayBackdrop: 'rgba(3, 28, 46, 0.55)',
  avatarRingRed: '#dc2626',

  // Status & Alert Semantic Tokens
  dangerBg: '#fee2e2',
  dangerBorder: '#b91c1c',
  dangerText: '#7f1d1d',
  dangerTitle: '#991b1b',
  urgentCardBg: '#fff5f5',
  urgentCardBorder: '#fca5a5',

  warningBg: '#fef3c7',
  warningBorder: '#b45309',
  warningText: '#78350f',

  successBg: '#dcfce7',
  successBorder: '#15803d',
  successText: '#14532d',

  infoBg: '#e0f2fe',
  infoBorder: '#0369a1',
  infoText: '#0c4a6e',

  // Tag Pill Tokens (high-contrast bordered pills matching clarify-web)
  tagUrgentBg: '#fee2e2',
  tagUrgentBorder: '#fca5a5',
  tagUrgentText: '#b91c1c',

  tagMemoBg: '#fef3c7',
  tagMemoBorder: '#fcd34d',
  tagMemoText: '#92400e',

  tagDeptBg: '#e0f2fe',
  tagDeptBorder: '#7dd3fc',
  tagDeptText: '#075985',

  tagCourseHubBg: '#e8eaf6',
  tagCourseHubBorder: '#1a1851',
  tagCourseHubText: '#1a1851',

  tagFacultyBg: '#dcfce7',
  tagFacultyBorder: '#86efac',
  tagFacultyText: '#166534',

  tagResolvedBg: '#fef08a',
  tagResolvedBorder: '#16a34a',
  tagResolvedText: '#14532d',

  tagNeutralBg: '#f1f5f9',
  tagNeutralBorder: '#cbd5e1',
  tagNeutralText: '#334155',
} as const;

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radii = {
  sm: 4,
  md: 6,
  lg: 8,
  xl: 12,
  xxl: 16,
  pill: 9999,
} as const;

export const touchTarget = {
  minWidth: 44,
  minHeight: 44,
} as const;

/**
 * Shadows/elevation are permitted ONLY on floating overlays (drawers, modals, bottom sheets).
 * Resting cards and surfaces must stay flat with 1px borders.
 */
export const elevation = {
  overlay: Platform.select({
    ios: {
      shadowColor: '#031c2e',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.22,
      shadowRadius: 10,
    },
    android: {
      elevation: 10,
    },
    default: {},
  }),
} as const;

export const typography = {
  fontFamilySans: Platform.select({
    ios: 'System',
    android: 'sans-serif',
    default: 'System',
  }),
  fontFamilyMono: Platform.select({
    ios: 'Menlo',
    android: 'monospace',
    default: 'monospace',
  }),
  sizes: {
    xxs: 11,
    xs: 12,
    sm: 13,
    body: 15,
    bodyLg: 16,
    titleSm: 18,
    titleMd: 20,
    titleLg: 24,
    display: 28,
  },
  lineHeights: {
    xxs: 16,
    xs: 18,
    sm: 20,
    body: 22,
    bodyLg: 24,
    titleSm: 26,
    titleMd: 28,
    titleLg: 32,
    display: 36,
  },
  tabularNums: {
    fontVariant: ['tabular-nums' as const],
  },
} as const;

export const theme = {
  colors,
  spacing,
  radii,
  touchTarget,
  elevation,
  typography,
} as const;

export type AppTheme = typeof theme;
