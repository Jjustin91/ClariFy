import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ClarifyLogoWordmark } from '@/components/ClarifyLogo';
import { useAuth } from '@/context/AuthContext';
import { getFieldValidationError } from '@/lib/domain-logic';
import { colors, radii, spacing, touchTarget, typography } from '@/theme';
import type { ApiError } from '@/types/api';

/**
 * Ported from clarify-web/app/login/page.tsx and unified for mobile handsets:
 * single full-screen USTP Orange canvas with navy ClariFy wordmark + campus branding
 * at the top, Institutional Sign In form in the center, and Sign Up callout below Enter.
 */
export default function MobileLoginScreen() {
  const router = useRouter();
  const {
    login,
    sessionExpiredMessage,
    dismissSessionExpiredMessage,
    showToast,
  } = useAuth();

  const [institutionalId, setInstitutionalId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pendingNotice, setPendingNotice] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [isRetryableError, setIsRetryableError] = useState<boolean>(false);

  const authenticateWithCredentials = async (
    idToUse: string,
    passToUse: string
  ) => {
    if (isLoading) return;
    setIsLoading(true);
    setFieldErrors({});
    setPendingNotice(null);
    setGeneralError(null);
    setIsRetryableError(false);
    dismissSessionExpiredMessage();

    try {
      await login(idToUse, passToUse);
      router.replace('/(drawer)');
    } catch (err) {
      const apiErr = err as ApiError;
      const lowerMsg = (apiErr?.message || '').toLowerCase();

      if (apiErr?.status === 422 && apiErr.errors) {
        setFieldErrors(apiErr.errors);
      } else if (
        apiErr?.status === 403 &&
        (apiErr.verification_status === 'pending' ||
          apiErr.verification_status === 'rejected' ||
          lowerMsg.includes('pending') ||
          lowerMsg.includes('rejected'))
      ) {
        setPendingNotice(
          apiErr.message ||
            'Your account is pending IT Administrator registrar verification.'
        );
      } else if (apiErr?.status === 429) {
        const seconds = apiErr.retryAfter ?? 60;
        setGeneralError(
          `Too many attempts, try again in ${seconds} seconds`
        );
      } else {
        const canRetry =
          !apiErr?.status || apiErr.status === 0 || apiErr.status >= 500;
        setIsRetryableError(canRetry);
        setGeneralError(apiErr?.message || 'Authentication failed.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = () => {
    void authenticateWithCredentials(institutionalId, password);
  };

  const idError = getFieldValidationError(fieldErrors, 'institutional_id');
  const passwordError = getFieldValidationError(fieldErrors, 'password');

  return (
    <SafeAreaView
      style={styles.safeArea}
      edges={['top', 'bottom', 'left', 'right']}
    >
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.loginFormContainer}>
            {/* Top Institutional Branding directly on USTP Orange */}
            <View style={styles.brandingHeader}>
              <View style={styles.logoWrap}>
                <ClarifyLogoWordmark height={48} color={colors.ustpNavy} />
              </View>
              <Text style={styles.platformSubtitle}>
                Unified Campus Noticeboard &amp; Scoped Communication Platform
              </Text>
              <Text style={styles.campusCaption}>
                University of Science and Technology of Southern Philippines —
                Cagayan de Oro Campus
              </Text>
            </View>

            {/* Sign-In Section Heading */}
            <View style={styles.signInHeader}>
              <Text style={styles.signInTitle}>Institutional Sign In</Text>
              <Text style={styles.signInSubtitle}>
                Enter your Institutional ID &amp; Password
              </Text>
            </View>

            {/* 401 Session Expired Notice */}
            {sessionExpiredMessage && (
              <View accessibilityRole="alert" style={styles.warningAlertBox}>
                <View style={styles.alertHeaderRow}>
                  <Feather
                    name="clock"
                    size={16}
                    color={colors.warningText}
                  />
                  <Text style={styles.warningAlertTitle}>Session Expired</Text>
                </View>
                <Text style={styles.warningAlertText}>
                  {sessionExpiredMessage}
                </Text>
              </View>
            )}

            {/* 403 Forbidden Pending / Rejected Verification Banner */}
            {pendingNotice && (
              <View accessibilityRole="alert" style={styles.pendingAlertBox}>
                <View style={styles.alertHeaderRow}>
                  <Feather
                    name="shield-off"
                    size={16}
                    color={colors.dangerTitle}
                  />
                  <Text style={styles.pendingAlertTitle}>
                    Verification Pending
                  </Text>
                </View>
                <Text style={styles.pendingAlertBody}>{pendingNotice}</Text>
              </View>
            )}

            {/* General / 401 / 429 / 500 / Network Error Banner */}
            {generalError && (
              <View accessibilityRole="alert" style={styles.errorBannerBox}>
                <View style={styles.errorBannerRow}>
                  <Feather
                    name="alert-circle"
                    size={16}
                    color={colors.dangerTitle}
                  />
                  <Text style={styles.errorBannerText}>{generalError}</Text>
                </View>
                {isRetryableError && (
                  <Pressable
                    onPress={handleSubmit}
                    disabled={isLoading}
                    accessibilityRole="button"
                    accessibilityLabel="Retry Sign In"
                    style={({ pressed }) => [
                      styles.retryButton,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <Feather
                      name="refresh-cw"
                      size={13}
                      color={colors.ustpGold}
                    />
                    <Text style={styles.retryButtonText}>Retry</Text>
                  </Pressable>
                )}
              </View>
            )}

            {/* Institutional ID Field */}
            <View style={styles.fieldGroup}>
              <TextInput
                value={institutionalId}
                onChangeText={(val) => {
                  setInstitutionalId(val);
                  if (fieldErrors.institutional_id) {
                    setFieldErrors((prev) => {
                      const next = { ...prev };
                      delete next.institutional_id;
                      return next;
                    });
                  }
                }}
                placeholder="Institutional ID Number"
                placeholderTextColor={colors.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="default"
                returnKeyType="next"
                editable={!isLoading}
                accessibilityLabel="Institutional ID Number"
                style={[
                  styles.textInput,
                  styles.tabularInput,
                  idError ? styles.inputErrorBorder : null,
                ]}
              />
              {idError && (
                <View accessibilityRole="alert" style={styles.fieldErrorPill}>
                  <Text style={styles.fieldErrorText}>{idError}</Text>
                </View>
              )}
            </View>

            {/* Password Field with 48x48dp Visibility Toggle */}
            <View style={styles.fieldGroup}>
              <View style={styles.passwordInputWrapper}>
                <TextInput
                  value={password}
                  onChangeText={(val) => {
                    setPassword(val);
                    if (fieldErrors.password) {
                      setFieldErrors((prev) => {
                        const next = { ...prev };
                        delete next.password;
                        return next;
                      });
                    }
                  }}
                  placeholder="Password"
                  placeholderTextColor={colors.placeholder}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="go"
                  onSubmitEditing={handleSubmit}
                  editable={!isLoading}
                  accessibilityLabel="Password"
                  style={[
                    styles.textInput,
                    styles.passwordInput,
                    passwordError ? styles.inputErrorBorder : null,
                  ]}
                />
                <Pressable
                  onPress={() => setShowPassword((prev) => !prev)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    showPassword ? 'Hide password' : 'Show password'
                  }
                  accessibilityState={{ selected: showPassword }}
                  style={styles.eyeToggleBtn}
                >
                  <Feather
                    name={showPassword ? 'eye-off' : 'eye'}
                    size={18}
                    color={colors.mutedSlate}
                  />
                </Pressable>
              </View>
              {passwordError && (
                <View accessibilityRole="alert" style={styles.fieldErrorPill}>
                  <Text style={styles.fieldErrorText}>{passwordError}</Text>
                </View>
              )}
            </View>

            {/* Forgot Password Link Only */}
            <View style={styles.forgotRow}>
              <Pressable
                onPress={() =>
                  showToast(
                    'Password recovery link dispatched via USTP ICTO Registrar portal.',
                    'info'
                  )
                }
                accessibilityRole="button"
                accessibilityLabel="Forgot Password"
                style={styles.inlineLinkBtn}
              >
                <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
              </Pressable>
            </View>

            {/* Primary Submit Button */}
            <Pressable
              onPress={handleSubmit}
              disabled={isLoading}
              accessibilityRole="button"
              accessibilityLabel={
                isLoading ? 'Verifying credentials' : 'Enter ClariFy'
              }
              accessibilityState={{ disabled: isLoading, busy: isLoading }}
              style={({ pressed }) => [
                styles.enterButton,
                isLoading && styles.buttonDisabled,
                pressed && !isLoading && styles.buttonPressed,
              ]}
            >
              {isLoading ? (
                <View style={styles.loadingBtnContent}>
                  <ActivityIndicator size="small" color={colors.white} />
                  <Text style={styles.enterButtonText}>Verifying...</Text>
                </View>
              ) : (
                <Text style={styles.enterButtonText}>Enter</Text>
              )}
            </Pressable>

            {/* Divider + Student / Faculty Sign Up Section below Enter */}
            <View style={styles.registerSection}>
              <Text style={styles.registerHeading}>
                Student or Faculty Member?
              </Text>
              <Text style={styles.registerDescription}>
                Register your Student or Faculty account and get verified by the
                IT Admin.
              </Text>

              <Pressable
                onPress={() => router.push('/(auth)/register')}
                accessibilityRole="button"
                accessibilityLabel="Sign Up for a Student or Faculty account"
                style={({ pressed }) => [
                  styles.signUpButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Feather name="user-plus" size={16} color={colors.ustpNavy} />
                <Text style={styles.signUpButtonText}>Sign Up</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.ustpOrange,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    backgroundColor: colors.ustpOrange,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loginFormContainer: {
    width: '100%',
    maxWidth: 380,
    gap: spacing.md,
  },
  brandingHeader: {
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  logoWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  platformSubtitle: {
    fontSize: typography.sizes.body,
    lineHeight: typography.lineHeights.body,
    fontWeight: '800',
    color: colors.ustpNavy,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  campusCaption: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '600',
    color: colors.ustpText,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  signInHeader: {
    alignItems: 'center',
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  signInTitle: {
    fontSize: typography.sizes.titleSm,
    lineHeight: typography.lineHeights.titleSm,
    fontWeight: '800',
    color: colors.ustpNavy,
    textAlign: 'center',
  },
  signInSubtitle: {
    marginTop: spacing.xxs,
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '600',
    color: colors.ustpText,
    textAlign: 'center',
  },
  warningAlertBox: {
    padding: spacing.md,
    backgroundColor: colors.warningBg,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    borderRadius: radii.md,
    gap: spacing.xs,
  },
  warningAlertTitle: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '800',
    color: colors.warningText,
  },
  warningAlertText: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '600',
    color: colors.warningText,
  },
  pendingAlertBox: {
    padding: spacing.md,
    backgroundColor: colors.dangerBg,
    borderWidth: 2,
    borderColor: colors.dangerBorder,
    borderRadius: radii.md,
    gap: spacing.xs,
  },
  alertHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  pendingAlertTitle: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '800',
    color: colors.dangerTitle,
  },
  pendingAlertBody: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '600',
    color: colors.dangerText,
  },
  errorBannerBox: {
    padding: spacing.md,
    backgroundColor: colors.dangerBg,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    borderRadius: radii.sm,
    gap: spacing.sm,
  },
  errorBannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  errorBannerText: {
    flex: 1,
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '600',
    color: colors.dangerTitle,
    ...typography.tabularNums,
  },
  retryButton: {
    minHeight: touchTarget.minHeight,
    minWidth: touchTarget.minWidth,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.ustpNavy,
    borderRadius: radii.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  retryButtonText: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '800',
    color: colors.ustpGold,
  },
  fieldGroup: {
    gap: spacing.xs,
  },
  textInput: {
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.sizes.body,
    lineHeight: typography.lineHeights.body,
    backgroundColor: colors.white,
    color: colors.ustpText,
    borderWidth: 2,
    borderColor: colors.white,
    borderRadius: radii.sm,
  },
  tabularInput: {
    fontFamily: typography.fontFamilyMono,
    ...typography.tabularNums,
  },
  inputErrorBorder: {
    borderColor: colors.dangerBorder,
  },
  passwordInputWrapper: {
    position: 'relative',
    justifyContent: 'center',
  },
  passwordInput: {
    paddingRight: 52,
  },
  eyeToggleBtn: {
    position: 'absolute',
    right: spacing.xxs,
    minWidth: touchTarget.minWidth,
    minHeight: touchTarget.minHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldErrorPill: {
    backgroundColor: colors.dangerBg,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.sm,
  },
  fieldErrorText: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '800',
    color: colors.dangerTitle,
  },
  forgotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: -spacing.xs,
  },
  inlineLinkBtn: {
    minHeight: touchTarget.minHeight,
    justifyContent: 'center',
    paddingVertical: spacing.xs,
    paddingLeft: spacing.sm,
  },
  forgotPasswordText: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '700',
    color: colors.ustpNavy,
    textDecorationLine: 'underline',
  },
  enterButton: {
    width: '100%',
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.xxxl,
    paddingVertical: spacing.sm,
    backgroundColor: colors.ustpNavy,
    borderWidth: 1,
    borderColor: colors.ustpNavy,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingBtnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  enterButtonText: {
    fontSize: typography.sizes.body,
    lineHeight: typography.lineHeights.body,
    fontWeight: '800',
    color: colors.white,
  },
  registerSection: {
    width: '100%',
    marginTop: spacing.md,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.ustpOrangeDivider,
    alignItems: 'center',
    gap: spacing.xs,
  },
  registerHeading: {
    fontSize: typography.sizes.sm,
    lineHeight: typography.lineHeights.sm,
    fontWeight: '800',
    color: colors.ustpNavy,
    textAlign: 'center',
  },
  registerDescription: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '600',
    color: colors.ustpText,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  signUpButton: {
    width: '100%',
    minHeight: touchTarget.minHeight,
    minWidth: touchTarget.minWidth,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: colors.ustpNavy,
    borderRadius: radii.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  signUpButtonText: {
    fontSize: typography.sizes.body,
    lineHeight: typography.lineHeights.body,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonPressed: {
    opacity: 0.85,
  },
});
