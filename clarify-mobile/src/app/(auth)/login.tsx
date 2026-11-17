import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
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

import { useAuth } from '@/context/AuthContext';
import { getFieldValidationError } from '@/lib/domain-logic';
import { colors, radii, spacing, touchTarget, typography } from '@/theme';
import type { ApiError } from '@/types/api';

/**
 * Ported from clarify-web/app/login/page.tsx
 * Preserves the USTP Navy institutional branding card + USTP Orange sign-in panel,
 * adapted vertically for mobile handsets with strict theme tokens and 44x44pt touch targets.
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
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom', 'left', 'right']}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Top Section: USTP Navy background with centered Institutional Branding Card */}
          <View style={styles.brandingSection}>
            <View style={styles.brandingCard}>
              <View style={styles.logoBadge}>
                <Text style={styles.logoBadgeText}>ClariFy</Text>
              </View>
              <Text style={styles.platformSubtitle}>
                Unified Campus Noticeboard &amp; Scoped Communication Platform
              </Text>
              <Text style={styles.campusCaption}>
                University of Science and Technology of Southern Philippines — Cagayan de Oro Campus
              </Text>

              {/* Student / Faculty Registration Link */}
              <View style={styles.registerCalloutRow}>
                <View style={styles.registerCopyBox}>
                  <Text style={styles.registerHeading}>
                    Student or Faculty Member?
                  </Text>
                  <Text style={styles.registerDescription}>
                    Register your Student or Faculty account and get verified by the IT Admin.
                  </Text>
                </View>

                <Pressable
                  onPress={() => router.push('/(auth)/register')}
                  accessibilityRole="button"
                  accessibilityLabel="Sign Up for a Student or Faculty account"
                  style={({ pressed }) => [
                    styles.signUpButton,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <Feather
                    name="user-plus"
                    size={15}
                    color={colors.ustpGold}
                  />
                  <Text style={styles.signUpButtonText}>Sign Up</Text>
                </Pressable>
              </View>
            </View>
          </View>

          {/* Bottom Section: USTP Orange Institutional Sign-In Panel */}
          <View style={styles.loginPanel}>
            <View style={styles.loginFormContainer}>
              <View style={styles.emblemHeader}>
                <View style={styles.emblemCircle}>
                  <Text style={styles.emblemMarkText}>CF</Text>
                </View>
                <Text style={styles.signInTitle}>Institutional Sign In</Text>
                <Text style={styles.signInSubtitle}>
                  Enter your Institutional ID &amp; Password
                </Text>
              </View>

              {/* 401 Session Expired Notice */}
              {sessionExpiredMessage && (
                <View
                  accessibilityRole="alert"
                  style={styles.warningAlertBox}
                >
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
                <View
                  accessibilityRole="alert"
                  style={styles.pendingAlertBox}
                >
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
                <View
                  accessibilityRole="alert"
                  style={styles.errorBannerBox}
                >
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

              {/* Password Field with 44x44pt Visibility Toggle */}
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

              {/* Create Account & Forgot Password Links */}
              <View style={styles.linksRow}>
                <Pressable
                  onPress={() => router.push('/(auth)/register')}
                  accessibilityRole="link"
                  accessibilityLabel="Create Account Sign Up"
                  style={styles.inlineLinkBtn}
                >
                  <Text style={styles.createAccountLinkText}>
                    Create Account (Sign Up)
                  </Text>
                </Pressable>

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
                  <Text style={styles.forgotPasswordText}>
                    Forgot Password?
                  </Text>
                </Pressable>
              </View>

              {/* Submit Button */}
              <View style={styles.submitRow}>
                <Pressable
                  onPress={handleSubmit}
                  disabled={isLoading}
                  accessibilityRole="button"
                  accessibilityLabel={isLoading ? 'Verifying credentials' : 'Enter ClariFy'}
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
              </View>
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
    backgroundColor: colors.ustpNavy,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  brandingSection: {
    backgroundColor: colors.ustpNavy,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandingCard: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 2,
    borderColor: colors.ustpGold,
    borderRadius: radii.lg,
    padding: spacing.xl,
    alignItems: 'center',
  },
  logoBadge: {
    backgroundColor: colors.ustpNavy,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.ustpGold,
    marginBottom: spacing.sm,
  },
  logoBadgeText: {
    fontSize: typography.sizes.titleLg,
    lineHeight: typography.lineHeights.titleLg,
    fontWeight: '800',
    color: colors.ustpGold,
    letterSpacing: 0.4,
  },
  platformSubtitle: {
    fontSize: typography.sizes.body,
    lineHeight: typography.lineHeights.body,
    fontWeight: '700',
    color: colors.ustpBlue,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  campusCaption: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    color: colors.mutedSlate,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  registerCalloutRow: {
    width: '100%',
    marginTop: spacing.xl,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.borderStrong,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  registerCopyBox: {
    flex: 1,
    minWidth: 180,
  },
  registerHeading: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  registerDescription: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    color: colors.mutedSlate,
    marginTop: spacing.xxs,
  },
  signUpButton: {
    minHeight: touchTarget.minHeight,
    minWidth: touchTarget.minWidth,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.ustpNavy,
    borderRadius: radii.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  signUpButtonText: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '800',
    color: colors.ustpGold,
  },
  loginPanel: {
    flex: 1,
    backgroundColor: colors.ustpOrange,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxxl,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.ustpOrangeDark,
  },
  loginFormContainer: {
    width: '100%',
    maxWidth: 360,
    gap: spacing.md,
  },
  emblemHeader: {
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  emblemCircle: {
    width: 76,
    height: 76,
    borderRadius: radii.pill,
    backgroundColor: colors.ustpNavyDark,
    borderWidth: 4,
    borderColor: colors.ustpGold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emblemMarkText: {
    fontSize: typography.sizes.titleLg,
    lineHeight: typography.lineHeights.titleLg,
    fontWeight: '800',
    color: colors.ustpGold,
  },
  signInTitle: {
    marginTop: spacing.md,
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
  linksRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  inlineLinkBtn: {
    minHeight: touchTarget.minHeight,
    justifyContent: 'center',
    paddingVertical: spacing.xs,
  },
  createAccountLinkText: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '800',
    color: colors.ustpNavy,
    textDecorationLine: 'underline',
  },
  forgotPasswordText: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '700',
    color: colors.ustpNavy,
    textDecorationLine: 'underline',
  },
  submitRow: {
    paddingTop: spacing.xs,
    alignItems: 'center',
  },
  enterButton: {
    minHeight: touchTarget.minHeight,
    minWidth: 140,
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
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonPressed: {
    opacity: 0.85,
  },
});
