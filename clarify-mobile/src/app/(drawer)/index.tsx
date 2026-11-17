import { Feather } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/context/AuthContext';
import { colors, radii, spacing, touchTarget, typography } from '@/theme';

export default function MobileDashboardScreen() {
  const { user, logout } = useAuth();

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.topBar}>
        <Text style={styles.topBarTitle}>ClariFy Mobile</Text>
        <Pressable
          onPress={() => void logout()}
          accessibilityRole="button"
          accessibilityLabel="Sign Out"
          style={({ pressed }) => [
            styles.signOutButton,
            pressed && styles.buttonPressed,
          ]}
        >
          <Feather name="log-out" size={15} color={colors.ustpGold} />
          <Text style={styles.signOutText}>Sign Out</Text>
        </Pressable>
      </View>

      <View style={styles.body}>
        <View style={styles.welcomeBanner}>
          <Text style={styles.welcomeText}>Welcome back!</Text>
        </View>

        {user && (
          <View style={styles.profileCard}>
            <Text style={styles.userName}>{user.name}</Text>
            <Text style={styles.userMeta}>
              Institutional ID: {user.institutional_id} • Role:{' '}
              {user.role.replace('_', ' ').toUpperCase()}
            </Text>
            <Text style={styles.userEmail}>{user.email}</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.ustpCream,
  },
  topBar: {
    backgroundColor: colors.ustpNavy,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topBarTitle: {
    fontSize: typography.sizes.titleSm,
    lineHeight: typography.lineHeights.titleSm,
    fontWeight: '800',
    color: colors.ustpGold,
  },
  signOutButton: {
    minHeight: touchTarget.minHeight,
    minWidth: touchTarget.minWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.ustpGold,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  signOutText: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '800',
    color: colors.ustpGold,
  },
  body: {
    flex: 1,
    padding: spacing.lg,
    gap: spacing.lg,
  },
  welcomeBanner: {
    alignSelf: 'flex-start',
    backgroundColor: colors.ustpGold,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radii.xl,
  },
  welcomeText: {
    fontSize: typography.sizes.titleLg,
    lineHeight: typography.lineHeights.titleLg,
    fontWeight: '800',
    color: colors.white,
  },
  profileCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  userName: {
    fontSize: typography.sizes.titleSm,
    lineHeight: typography.lineHeights.titleSm,
    fontWeight: '800',
    color: colors.ustpText,
  },
  userMeta: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '700',
    color: colors.ustpNavy,
    ...typography.tabularNums,
  },
  userEmail: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    color: colors.mutedSlate,
  },
  buttonPressed: {
    opacity: 0.85,
  },
});
