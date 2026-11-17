import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radii, spacing, touchTarget, typography } from '@/theme';

export default function MobileRegisterPlaceholderScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.title}>Account Registration</Text>
          <Text style={styles.subtitle}>
            Student &amp; Faculty Campus Portal Sign Up
          </Text>
          <Text style={styles.description}>
            Full Student and Faculty registration with @ustp.edu.ph verification
            and IT Administrator approval queue will be enabled in Step 3 of the
            mobile port.
          </Text>

          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Back to Sign In"
            style={({ pressed }) => [
              styles.backButton,
              pressed && styles.buttonPressed,
            ]}
          >
            <Feather name="arrow-left" size={16} color={colors.ustpGold} />
            <Text style={styles.backButtonText}>Back to Sign In</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.ustpNavy,
  },
  container: {
    flex: 1,
    padding: spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.ustpGold,
    borderRadius: radii.lg,
    padding: spacing.xxl,
    gap: spacing.md,
  },
  title: {
    fontSize: typography.sizes.titleLg,
    lineHeight: typography.lineHeights.titleLg,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  subtitle: {
    fontSize: typography.sizes.body,
    lineHeight: typography.lineHeights.body,
    fontWeight: '700',
    color: colors.ustpBlue,
  },
  description: {
    fontSize: typography.sizes.sm,
    lineHeight: typography.lineHeights.sm,
    color: colors.mutedSlate,
  },
  backButton: {
    marginTop: spacing.sm,
    minHeight: touchTarget.minHeight,
    minWidth: touchTarget.minWidth,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.ustpNavy,
    borderRadius: radii.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  backButtonText: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '800',
    color: colors.ustpGold,
  },
  buttonPressed: {
    opacity: 0.85,
  },
});
