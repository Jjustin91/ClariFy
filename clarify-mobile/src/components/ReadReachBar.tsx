import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  formatServerReadReachText,
  getReadReachBarFillPercent,
} from '../lib/feed-reducer';
import { colors, radii, spacing, typography } from '../theme';
import type { ReadReach } from '../types/api';

/**
 * Honest Read Reach progress bar displaying `acknowledged_count`, `enrolled_total`,
 * and `percentage` strictly as returned by clarify-api.
 * Ported from clarify-web/src/components/announcements/AnnouncementCard.tsx.
 */
export function ReadReachBar({ readReach }: { readReach: ReadReach }) {
  const fillPercent = getReadReachBarFillPercent(readReach);
  const summaryText = formatServerReadReachText(readReach);

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={`Read Reach: ${summaryText}`}
      style={styles.container}
    >
      <View style={styles.labelRow}>
        <Text style={styles.prefix}>Read Reach:</Text>
        <Text style={styles.metricsText}>{summaryText}</Text>
      </View>

      {readReach.enrolled_total > 0 && (
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${fillPercent}%` }]} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs + 2,
  },
  labelRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
  },
  prefix: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '700',
    color: colors.mutedSlate,
  },
  metricsText: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '800',
    color: colors.ustpNavy,
    ...typography.tabularNums,
  },
  track: {
    height: 7,
    width: '100%',
    backgroundColor: colors.border,
    borderRadius: radii.pill,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: colors.ustpGold,
    borderRadius: radii.pill,
  },
});
