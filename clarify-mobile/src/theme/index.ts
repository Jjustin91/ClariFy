import { Platform } from 'react-native';

/**
 * Official USTP-CDO ClariFy Mobile Design System Tokens.
 * Screens and components must import tokens from '@/theme' and never hardcode hex values.
 */
export const colors = {
  ustpNavy: '#1a1851',
  ustpNavyDark: '#000b3d',
  ustpGold: '#fcb315',
  ustpOrange: '#ff9718',
  ustpOrangeDark: '#ff6418',
  ustpCream: '#FFFAF2',
  ustpText: '#031c2e',
  ustpBlue: '#0d4a77',
  ustpSky: '#329dea',

  white: '#FFFFFF',
  surfaceMuted: '#f1f5f9',
  border: '#e2e8f0',
  borderStrong: '#cbd5e1',
  mutedSlate: '#475569',
  placeholder: '#94a3b8',

  // Status & Alert Semantic Tokens
  dangerBg: '#fee2e2',
  dangerBorder: '#b91c1c',
  dangerText: '#7f1d1d',
  dangerTitle: '#991b1b',

  warningBg: '#fef3c7',
  warningBorder: '#b45309',
  warningText: '#78350f',

  successBg: '#dcfce7',
  successBorder: '#15803d',
  successText: '#14532d',

  infoBg: '#e0f2fe',
  infoBorder: '#0369a1',
  infoText: '#0c4a6e',

  // Tag Pill Tokens
  tagUrgentBg: '#dc2626',
  tagUrgentText: '#FFFFFF',
  tagMemoBg: '#f59e0b',
  tagMemoText: '#031c2e',
  tagDeptBg: '#329dea',
  tagDeptText: '#FFFFFF',
  tagFacultyBg: '#16a34a',
  tagFacultyText: '#FFFFFF',
  tagResolvedBg: '#fef08a',
  tagResolvedBorder: '#16a34a',
  tagResolvedText: '#14532d',
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
  pill: 9999,
} as const;

export const touchTarget = {
  minWidth: 44,
  minHeight: 44,
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
  typography,
} as const;

export type AppTheme = typeof theme;
