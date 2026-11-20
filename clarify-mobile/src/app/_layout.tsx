import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '@/context/AuthContext';
import { colors, radii, spacing, touchTarget, typography } from '@/theme';

void SplashScreen.preventAutoHideAsync();

function ToastHost() {
  const { toasts, dismissToast } = useAuth();
  const insets = useSafeAreaInsets();

  if (toasts.length === 0) {
    return null;
  }

  return (
    <View
      pointerEvents="box-none"
      style={[styles.toastContainer, { top: Math.max(insets.top + spacing.sm, spacing.lg) }]}
    >
      {toasts.map((toast) => {
        const isSuccess = toast.variant === 'success';
        const isError = toast.variant === 'error';
        return (
          <View
            key={toast.id}
            accessibilityLiveRegion="polite"
            style={[
              styles.toastCard,
              isSuccess
                ? styles.toastSuccess
                : isError
                  ? styles.toastError
                  : styles.toastInfo,
            ]}
          >
            <Text
              style={[
                styles.toastText,
                isSuccess
                  ? styles.toastTextSuccess
                  : isError
                    ? styles.toastTextError
                    : styles.toastTextInfo,
              ]}
            >
              {toast.message}
            </Text>
            <Pressable
              onPress={() => dismissToast(toast.id)}
              accessibilityRole="button"
              accessibilityLabel="Dismiss notification"
              style={styles.toastDismissBtn}
            >
              <Text style={styles.toastDismissLabel}>✕</Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

function RootNavigationGate() {
  const { isAuthenticated, isAuthReady } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isAuthReady) {
      void SplashScreen.hideAsync();
    }
  }, [isAuthReady]);

  useEffect(() => {
    if (!isAuthReady) {
      return;
    }

    const inAuthGroup = segments[0] === '(auth)';

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup) {
      router.replace('/(drawer)');
    }
  }, [isAuthReady, isAuthenticated, segments, router]);

  if (!isAuthReady) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color={colors.ustpGold} />
        <Text style={styles.loadingLabel}>Verifying USTP Session...</Text>
      </View>
    );
  }

  return (
    <View style={styles.rootFlex}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(drawer)" />
      </Stack>
      <ToastHost />
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <RootNavigationGate />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  rootFlex: {
    flex: 1,
    backgroundColor: colors.ustpCream,
  },
  loadingScreen: {
    flex: 1,
    backgroundColor: colors.ustpNavy,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  loadingLabel: {
    marginTop: spacing.md,
    fontSize: typography.sizes.sm,
    lineHeight: typography.lineHeights.sm,
    fontWeight: '700',
    color: colors.ustpGold,
  },
  toastContainer: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    zIndex: 100,
    gap: spacing.sm,
  },
  toastCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  toastSuccess: {
    backgroundColor: colors.successBg,
    borderColor: colors.successBorder,
  },
  toastError: {
    backgroundColor: colors.dangerBg,
    borderColor: colors.dangerBorder,
  },
  toastInfo: {
    backgroundColor: colors.ustpNavy,
    borderColor: colors.ustpGold,
  },
  toastText: {
    flex: 1,
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '700',
    marginRight: spacing.sm,
  },
  toastTextSuccess: {
    color: colors.successText,
  },
  toastTextError: {
    color: colors.dangerText,
  },
  toastTextInfo: {
    color: colors.ustpGold,
  },
  toastDismissBtn: {
    minWidth: touchTarget.minWidth,
    minHeight: touchTarget.minHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toastDismissLabel: {
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.mutedSlate,
  },
});
