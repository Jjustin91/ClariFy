import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
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
import { ErrorBanner } from '@/components/StateViews';
import {
  requestPasswordOtpApi,
  resetPasswordApi,
  verifyPasswordOtpApi,
} from '@/lib/api-client';
import {
  extractRetryAfterSeconds,
  formatOtpCooldownLabel,
  getFieldValidationError,
  sanitizeOtpInput,
  validatePasswordResetFields,
  type PasswordResetStep,
} from '@/lib/domain-logic';
import { colors, radii, spacing, touchTarget, typography } from '@/theme';
import type { ApiError } from '@/types/api';

const STEP_LABELS: { key: Exclude<PasswordResetStep, 'done'>; num: number; label: string }[] = [
  { key: 'request', num: 1, label: 'Verify ID' },
  { key: 'verify', num: 2, label: 'SMS Code' },
  { key: 'reset', num: 3, label: 'New Password' },
];

/**
 * 3-Step SMS OTP Password Recovery screen ported from clarify-web/app/forgot-password/page.tsx.
 * Step 1: Request 6-digit SMS OTP by Institutional ID (POST /auth/password/request-otp).
 * Step 2: Verify 6-digit SMS code with resend cooldown & 429 retry-after handling (POST /auth/password/verify-otp).
 * Step 3: Set new password (min 8 chars + confirmation) (POST /auth/password/reset).
 */
export default function MobileForgotPasswordScreen() {
  const router = useRouter();

  const [step, setStep] = useState<PasswordResetStep>('request');
  const [institutionalId, setInstitutionalId] = useState('');
  const [maskedPhone, setMaskedPhone] = useState<string | null>(null);
  const [expiresInMinutes, setExpiresInMinutes] = useState<number>(10);
  const [otpCode, setOtpCode] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState<number>(0);
  const [rateLimitSeconds, setRateLimitSeconds] = useState<number>(0);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [generalError, setGeneralError] = useState<ApiError | null>(null);
  const [infoBanner, setInfoBanner] = useState<string | null>(null);
  const [tokenExpired, setTokenExpired] = useState(false);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  useEffect(() => {
    if (rateLimitSeconds <= 0) return;
    const timer = setInterval(() => {
      setRateLimitSeconds((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [rateLimitSeconds]);

  const clearErrors = () => {
    setFieldErrors({});
    setGeneralError(null);
    setTokenExpired(false);
  };

  const clearFieldError = (field: string) => {
    if (!fieldErrors[field]) return;
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const handleRestartFlow = () => {
    setStep('request');
    setOtpCode('');
    setResetToken('');
    setPassword('');
    setConfirmPassword('');
    setMaskedPhone(null);
    setResendCooldown(0);
    setRateLimitSeconds(0);
    setInfoBanner(null);
    clearErrors();
  };

  const handleRequestOtp = async () => {
    if (isLoading || rateLimitSeconds > 0) return;
    clearErrors();
    setInfoBanner(null);

    const trimmedId = institutionalId.trim();
    if (!trimmedId) {
      setFieldErrors({
        institutional_id: ['Please enter your USTP Institutional ID.'],
      });
      return;
    }

    setIsLoading(true);
    try {
      const res = await requestPasswordOtpApi(trimmedId);
      setInstitutionalId(trimmedId);
      setMaskedPhone(res.masked_phone ?? null);
      setExpiresInMinutes(
        Math.max(1, Math.round((res.expires_in_seconds || 600) / 60))
      );
      setResendCooldown(res.resend_cooldown_seconds || 60);
      setInfoBanner(
        res.message ||
          'If this account has a registered mobile number, a 6-digit verification code has been sent.'
      );
      setOtpCode('');
      setStep('verify');
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr?.status === 422 && apiErr.errors) {
        setFieldErrors(apiErr.errors);
      } else if (apiErr?.status === 429) {
        const retrySec = extractRetryAfterSeconds(apiErr) || 60;
        setRateLimitSeconds(retrySec);
        setResendCooldown((prev) => Math.max(prev, retrySec));
        setGeneralError({
          status: 429,
          retryAfter: retrySec,
          message: `Too many attempts, try again in ${retrySec} seconds`,
        });
      } else {
        setGeneralError(
          apiErr?.message
            ? apiErr
            : {
                status: apiErr?.status ?? 500,
                message: 'Could not send verification code. Please try again.',
              }
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (isResending || resendCooldown > 0 || !institutionalId.trim()) return;
    clearErrors();
    setIsResending(true);
    try {
      const res = await requestPasswordOtpApi(institutionalId.trim());
      setMaskedPhone(res.masked_phone ?? maskedPhone);
      setExpiresInMinutes(
        Math.max(1, Math.round((res.expires_in_seconds || 600) / 60))
      );
      setResendCooldown(res.resend_cooldown_seconds || 60);
      setInfoBanner(
        res.message || 'A new 6-digit verification code has been sent via SMS.'
      );
      setOtpCode('');
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr?.status === 429) {
        const retrySec = extractRetryAfterSeconds(apiErr) || 60;
        setResendCooldown(retrySec);
        setRateLimitSeconds(retrySec);
        setGeneralError({
          status: 429,
          retryAfter: retrySec,
          message: `Too many attempts, try again in ${retrySec} seconds`,
        });
      } else {
        setGeneralError(
          apiErr?.message
            ? apiErr
            : {
                status: apiErr?.status ?? 500,
                message: 'Could not resend verification code. Please try again.',
              }
        );
      }
    } finally {
      setIsResending(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (isLoading || rateLimitSeconds > 0) return;
    clearErrors();

    const cleanCode = sanitizeOtpInput(otpCode);
    setOtpCode(cleanCode);
    if (cleanCode.length !== 6) {
      setFieldErrors({
        otp: ['Please enter the 6-digit verification code sent to your phone.'],
      });
      return;
    }

    setIsLoading(true);
    try {
      const res = await verifyPasswordOtpApi(institutionalId.trim(), cleanCode);
      setResetToken(res.reset_token);
      setInfoBanner(
        res.message ||
          'Verification code confirmed. Enter your new password below.'
      );
      setStep('reset');
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr?.status === 422 && apiErr.errors) {
        setFieldErrors(apiErr.errors);
      } else if (apiErr?.status === 429) {
        const retrySec = extractRetryAfterSeconds(apiErr) || 60;
        setRateLimitSeconds(retrySec);
        setGeneralError({
          status: 429,
          retryAfter: retrySec,
          message: `Too many attempts, try again in ${retrySec} seconds`,
        });
      } else {
        setGeneralError(
          apiErr?.message
            ? apiErr
            : {
                status: apiErr?.status ?? 500,
                message: 'Could not verify the code. Please try again.',
              }
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (isLoading || rateLimitSeconds > 0) return;
    clearErrors();

    const validationErrors = validatePasswordResetFields(
      password,
      confirmPassword
    );
    if (Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors);
      return;
    }

    setIsLoading(true);
    try {
      const res = await resetPasswordApi({
        institutional_id: institutionalId.trim(),
        reset_token: resetToken,
        password,
        password_confirmation: confirmPassword,
      });
      setInfoBanner(
        res.message ||
          'Password reset successful! You can now sign in with your new password.'
      );
      setPassword('');
      setConfirmPassword('');
      setResetToken('');
      setStep('done');
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr?.status === 422 && apiErr.errors) {
        setFieldErrors(apiErr.errors);
        if (apiErr.errors.reset_token?.length) {
          setTokenExpired(true);
          setGeneralError({
            status: 422,
            message: apiErr.errors.reset_token[0],
          });
        }
      } else if (apiErr?.status === 429) {
        const retrySec = extractRetryAfterSeconds(apiErr) || 60;
        setRateLimitSeconds(retrySec);
        setGeneralError({
          status: 429,
          retryAfter: retrySec,
          message: `Too many attempts, try again in ${retrySec} seconds`,
        });
      } else {
        setGeneralError(
          apiErr?.message
            ? apiErr
            : {
                status: apiErr?.status ?? 500,
                message: 'Could not reset your password. Please try again.',
              }
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  const idError = getFieldValidationError(fieldErrors, 'institutional_id');
  const codeError = 
    getFieldValidationError(fieldErrors, 'otp') ??
    getFieldValidationError(fieldErrors, 'code');
  const passwordError = getFieldValidationError(fieldErrors, 'password');
  const confirmPasswordError = getFieldValidationError(
    fieldErrors,
    'password_confirmation'
  );

  const currentStepIndex =
    step === 'request' ? 0 : step === 'verify' ? 1 : step === 'reset' ? 2 : 3;

  return (
    <SafeAreaView
      style={styles.safeArea}
      edges={['top', 'bottom', 'left', 'right']}
    >
      <StatusBar style="light" />
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Institutional Header Card (USTP Navy + Gold Border) */}
          <View style={styles.headerSection}>
            <View style={styles.brandingCard}>
              <View style={styles.logoWrap}>
                <ClarifyLogoWordmark height={42} />
              </View>
              <Text style={styles.pageTitle}>Password Recovery</Text>
              <Text style={styles.pageSubtitle}>
                SMS One-Time Verification Code (OTP)
              </Text>
              <Text style={styles.pageCaption}>
                Reset your USTP ClariFy password using the mobile number
                registered on your account.
              </Text>

              <Pressable
                onPress={() => router.replace('/(auth)/login')}
                accessibilityRole="button"
                accessibilityLabel="Back to Sign In"
                style={({ pressed }) => [
                  styles.backToLoginBtn,
                  pressed && styles.pressed,
                ]}
              >
                <Feather name="arrow-left" size={16} color={colors.ustpGold} />
                <Text style={styles.backToLoginText}>Back to Sign In</Text>
              </Pressable>
            </View>
          </View>

          {/* Main Form Panel (USTP Cream Surface) */}
          <View style={styles.panelSection}>
            <View style={styles.card}>
              {/* Step Indicator */}
              {step !== 'done' && (
                <View style={styles.stepRow} accessibilityRole="tablist">
                  {STEP_LABELS.map((item, idx) => {
                    const isActive = idx === currentStepIndex;
                    const isCompleted = idx < currentStepIndex;
                    return (
                      <View
                        key={item.key}
                        style={[
                          styles.stepPill,
                          isActive && styles.stepPillActive,
                          isCompleted && styles.stepPillDone,
                        ]}
                      >
                        <Text
                          style={[
                            styles.stepPillText,
                            isActive && styles.stepPillTextActive,
                            isCompleted && styles.stepPillTextDone,
                          ]}
                        >
                          {item.num}. {item.label}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}

              {/* 429 Rate-Limit Live Countdown */}
              {rateLimitSeconds > 0 && (
                <View accessibilityRole="alert" style={styles.warningBox}>
                  <Feather name="clock" size={16} color={colors.warningText} />
                  <Text style={styles.warningText}>
                    Too many attempts, try again in {rateLimitSeconds} seconds
                  </Text>
                </View>
              )}

              {/* General Error Banner with Retry (500 / network / expired token) */}
              {generalError && generalError.status !== 429 && (
                <View style={styles.errorStack}>
                  <ErrorBanner
                    error={generalError}
                    onRetry={
                      generalError.status === 0 || generalError.status >= 500
                        ? () => {
                            if (step === 'request') void handleRequestOtp();
                            else if (step === 'verify') void handleVerifyOtp();
                            else if (step === 'reset')
                              void handleResetPassword();
                          }
                        : undefined
                    }
                  />
                  {tokenExpired && (
                    <Pressable
                      onPress={handleRestartFlow}
                      accessibilityRole="button"
                      accessibilityLabel="Start over with a new SMS code"
                      style={({ pressed }) => [
                        styles.secondaryBtn,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.secondaryBtnText}>
                        Start over with a new SMS code
                      </Text>
                    </Pressable>
                  )}
                </View>
              )}

              {/* Info Banner */}
              {infoBanner && step !== 'done' && (
                <View style={styles.infoBox}>
                  <Feather name="info" size={16} color={colors.infoText} />
                  <Text style={styles.infoText}>{infoBanner}</Text>
                </View>
              )}

              {/* Submitting Progress Indicator */}
              {isLoading && (
                <View
                  accessibilityRole="progressbar"
                  accessibilityLabel="Processing password reset step"
                  style={styles.submittingBanner}
                >
                  <ActivityIndicator size="small" color={colors.ustpNavy} />
                  <Text style={styles.submittingBannerText}>
                    {step === 'request'
                      ? 'Sending verification code via SMS...'
                      : step === 'verify'
                        ? 'Verifying 6-digit SMS code...'
                        : 'Updating your password...'}
                  </Text>
                </View>
              )}

              {/* STEP 1: REQUEST OTP */}
              {step === 'request' && (
                <View style={styles.stepContent}>
                  <View style={styles.stepIntro}>
                    <Text style={styles.cardHeading}>
                      Enter Your Institutional ID
                    </Text>
                    <Text style={styles.cardSub}>
                      We&apos;ll send a 6-digit SMS code to the mobile number
                      saved on your ClariFy account.
                    </Text>
                  </View>

                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>USTP Institutional ID</Text>
                    <TextInput
                      value={institutionalId}
                      onChangeText={(val) => {
                        setInstitutionalId(val);
                        clearFieldError('institutional_id');
                      }}
                      placeholder="e.g., 2023300001 or FAC-10492"
                      placeholderTextColor={colors.placeholder}
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="done"
                      onSubmitEditing={() => void handleRequestOtp()}
                      editable={!isLoading}
                      accessibilityLabel="USTP Institutional ID"
                      style={[
                        styles.textInput,
                        styles.monoInput,
                        idError ? styles.inputError : null,
                      ]}
                    />
                    {idError && (
                      <Text accessibilityRole="alert" style={styles.fieldError}>
                        {idError}
                      </Text>
                    )}
                  </View>

                  <Pressable
                    onPress={() => void handleRequestOtp()}
                    disabled={isLoading || rateLimitSeconds > 0}
                    accessibilityRole="button"
                    accessibilityLabel="Send 6-Digit SMS Code"
                    accessibilityState={{
                      disabled: isLoading || rateLimitSeconds > 0,
                      busy: isLoading,
                    }}
                    style={({ pressed }) => [
                      styles.primarySubmitBtn,
                      (isLoading || rateLimitSeconds > 0) && styles.disabledBtn,
                      pressed &&
                        !isLoading &&
                        rateLimitSeconds === 0 &&
                        styles.pressed,
                    ]}
                  >
                    <Feather
                      name="smartphone"
                      size={16}
                      color={colors.ustpGold}
                    />
                    <Text style={styles.primarySubmitText}>
                      {rateLimitSeconds > 0
                        ? `Try again in ${rateLimitSeconds}s`
                        : 'Send 6-Digit SMS Code'}
                    </Text>
                  </Pressable>
                </View>
              )}

              {/* STEP 2: VERIFY 6-DIGIT OTP */}
              {step === 'verify' && (
                <View style={styles.stepContent}>
                  <View style={styles.stepIntro}>
                    <Text style={styles.cardHeading}>
                      Enter 6-Digit SMS Code
                    </Text>
                    <Text style={styles.cardSub}>
                      Account:{' '}
                      <Text style={styles.monoBoldInline}>
                        {institutionalId}
                      </Text>
                      {maskedPhone ? (
                        <>
                          {' '}
                          • Sent to{' '}
                          <Text style={styles.monoBoldInline}>
                            {maskedPhone}
                          </Text>
                        </>
                      ) : null}
                      . Code expires in {expiresInMinutes} minutes.
                    </Text>
                  </View>

                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Verification Code</Text>
                    <TextInput
                      value={otpCode}
                      onChangeText={(val) => {
                        setOtpCode(sanitizeOtpInput(val));
                        clearFieldError('otp');
                        clearFieldError('code');
                      }}
                      placeholder="000000"
                      placeholderTextColor={colors.placeholder}
                      keyboardType="number-pad"
                      maxLength={6}
                      textContentType="oneTimeCode"
                      autoComplete="sms-otp"
                      returnKeyType="done"
                      onSubmitEditing={() => void handleVerifyOtp()}
                      editable={!isLoading}
                      accessibilityLabel="6-digit SMS verification code"
                      style={[
                        styles.textInput,
                        styles.otpInput,
                        codeError ? styles.inputError : null,
                      ]}
                    />
                    {codeError && (
                      <Text accessibilityRole="alert" style={styles.fieldError}>
                        {codeError}
                      </Text>
                    )}
                  </View>

                  <Pressable
                    onPress={() => void handleVerifyOtp()}
                    disabled={
                      isLoading ||
                      rateLimitSeconds > 0 ||
                      otpCode.length !== 6
                    }
                    accessibilityRole="button"
                    accessibilityLabel="Verify Code"
                    accessibilityState={{
                      disabled:
                        isLoading ||
                        rateLimitSeconds > 0 ||
                        otpCode.length !== 6,
                      busy: isLoading,
                    }}
                    style={({ pressed }) => [
                      styles.primarySubmitBtn,
                      (isLoading ||
                        rateLimitSeconds > 0 ||
                        otpCode.length !== 6) &&
                        styles.disabledBtn,
                      pressed &&
                        !isLoading &&
                        rateLimitSeconds === 0 &&
                        otpCode.length === 6 &&
                        styles.pressed,
                    ]}
                  >
                    <Feather
                      name="shield"
                      size={16}
                      color={colors.ustpGold}
                    />
                    <Text style={styles.primarySubmitText}>Verify Code</Text>
                  </Pressable>

                  <View style={styles.secondaryActionsRow}>
                    <Pressable
                      onPress={() => void handleResendOtp()}
                      disabled={isResending || resendCooldown > 0}
                      accessibilityRole="button"
                      accessibilityLabel={formatOtpCooldownLabel(resendCooldown)}
                      style={({ pressed }) => [
                        styles.secondaryBtn,
                        styles.flexBtn,
                        (isResending || resendCooldown > 0) &&
                          styles.disabledBtn,
                        pressed &&
                          !isResending &&
                          resendCooldown === 0 &&
                          styles.pressed,
                      ]}
                    >
                      {isResending ? (
                        <ActivityIndicator
                          size="small"
                          color={colors.ustpNavy}
                        />
                      ) : (
                        <Feather
                          name="refresh-cw"
                          size={14}
                          color={colors.ustpNavy}
                        />
                      )}
                      <Text style={styles.secondaryBtnText}>
                        {isResending
                          ? 'Sending...'
                          : formatOtpCooldownLabel(resendCooldown)}
                      </Text>
                    </Pressable>

                    <Pressable
                      onPress={handleRestartFlow}
                      disabled={isLoading || isResending}
                      accessibilityRole="button"
                      accessibilityLabel="Change Institutional ID"
                      style={({ pressed }) => [
                        styles.secondaryBtn,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.secondaryBtnText}>Change ID</Text>
                    </Pressable>
                  </View>
                </View>
              )}

              {/* STEP 3: SET NEW PASSWORD */}
              {step === 'reset' && (
                <View style={styles.stepContent}>
                  <View style={styles.stepIntro}>
                    <Text style={styles.cardHeading}>Set a New Password</Text>
                    <Text style={styles.cardSub}>
                      Choose a strong password of at least 8 characters. All
                      other active ClariFy sessions will be signed out.
                    </Text>
                  </View>

                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>New Password</Text>
                    <View style={styles.passwordWrap}>
                      <TextInput
                        value={password}
                        onChangeText={(val) => {
                          setPassword(val);
                          clearFieldError('password');
                        }}
                        placeholder="Min. 8 characters"
                        placeholderTextColor={colors.placeholder}
                        secureTextEntry={!showPassword}
                        autoCapitalize="none"
                        autoCorrect={false}
                        editable={!isLoading}
                        accessibilityLabel="New Password"
                        style={[
                          styles.textInput,
                          styles.passwordInput,
                          passwordError ? styles.inputError : null,
                        ]}
                      />
                      <Pressable
                        onPress={() => setShowPassword((prev) => !prev)}
                        accessibilityRole="button"
                        accessibilityLabel={
                          showPassword ? 'Hide password' : 'Show password'
                        }
                        style={styles.eyeButton}
                      >
                        <Feather
                          name={showPassword ? 'eye-off' : 'eye'}
                          size={18}
                          color={colors.mutedSlate}
                        />
                      </Pressable>
                    </View>
                    {passwordError && (
                      <Text accessibilityRole="alert" style={styles.fieldError}>
                        {passwordError}
                      </Text>
                    )}
                  </View>

                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Confirm New Password</Text>
                    <View style={styles.passwordWrap}>
                      <TextInput
                        value={confirmPassword}
                        onChangeText={(val) => {
                          setConfirmPassword(val);
                          clearFieldError('password_confirmation');
                        }}
                        placeholder="Re-enter new password"
                        placeholderTextColor={colors.placeholder}
                        secureTextEntry={!showConfirmPassword}
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="done"
                        onSubmitEditing={() => void handleResetPassword()}
                        editable={!isLoading}
                        accessibilityLabel="Confirm New Password"
                        style={[
                          styles.textInput,
                          styles.passwordInput,
                          confirmPasswordError ? styles.inputError : null,
                        ]}
                      />
                      <Pressable
                        onPress={() => setShowConfirmPassword((prev) => !prev)}
                        accessibilityRole="button"
                        accessibilityLabel={
                          showConfirmPassword
                            ? 'Hide confirm password'
                            : 'Show confirm password'
                        }
                        style={styles.eyeButton}
                      >
                        <Feather
                          name={showConfirmPassword ? 'eye-off' : 'eye'}
                          size={18}
                          color={colors.mutedSlate}
                        />
                      </Pressable>
                    </View>
                    {confirmPasswordError && (
                      <Text accessibilityRole="alert" style={styles.fieldError}>
                        {confirmPasswordError}
                      </Text>
                    )}
                  </View>

                  <Pressable
                    onPress={() => void handleResetPassword()}
                    disabled={isLoading || rateLimitSeconds > 0}
                    accessibilityRole="button"
                    accessibilityLabel="Reset Password"
                    accessibilityState={{
                      disabled: isLoading || rateLimitSeconds > 0,
                      busy: isLoading,
                    }}
                    style={({ pressed }) => [
                      styles.primarySubmitBtn,
                      (isLoading || rateLimitSeconds > 0) && styles.disabledBtn,
                      pressed &&
                        !isLoading &&
                        rateLimitSeconds === 0 &&
                        styles.pressed,
                    ]}
                  >
                    <Feather name="lock" size={16} color={colors.ustpGold} />
                    <Text style={styles.primarySubmitText}>Reset Password</Text>
                  </Pressable>
                </View>
              )}

              {/* STEP 4: DONE */}
              {step === 'done' && (
                <View style={styles.stepContent}>
                  <View style={styles.successHeaderRow}>
                    <Feather
                      name="check-circle"
                      size={26}
                      color={colors.successBorder}
                    />
                    <View style={styles.successTitleWrap}>
                      <Text style={styles.successTitle}>
                        Password Updated Successfully
                      </Text>
                      <Text style={styles.successSubtitle}>
                        Ready to sign in to ClariFy Mobile
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.successBody}>
                    {infoBanner ||
                      'Your password has been updated and all prior sessions were signed out for security.'}
                  </Text>

                  <Pressable
                    onPress={() => router.replace('/(auth)/login')}
                    accessibilityRole="button"
                    accessibilityLabel="Proceed to Sign In"
                    style={({ pressed }) => [
                      styles.primarySubmitBtn,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.primarySubmitText}>
                      Proceed to Sign In
                    </Text>
                  </Pressable>
                </View>
              )}
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
    backgroundColor: colors.ustpCream,
  },
  headerSection: {
    backgroundColor: colors.ustpNavy,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  brandingCard: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 2,
    borderColor: colors.ustpGold,
    borderRadius: radii.lg,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.xs,
  },
  logoWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  pageTitle: {
    fontSize: typography.sizes.titleMd,
    lineHeight: typography.lineHeights.titleMd,
    fontWeight: '800',
    color: colors.ustpNavy,
    textAlign: 'center',
  },
  pageSubtitle: {
    fontSize: typography.sizes.sm,
    lineHeight: typography.lineHeights.sm,
    fontWeight: '700',
    color: colors.ustpBlue,
    textAlign: 'center',
  },
  pageCaption: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    color: colors.mutedSlate,
    textAlign: 'center',
  },
  backToLoginBtn: {
    marginTop: spacing.sm,
    minHeight: touchTarget.minHeight,
    minWidth: touchTarget.minWidth,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.sm,
    backgroundColor: colors.ustpNavy,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  backToLoginText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpGold,
  },
  panelSection: {
    flex: 1,
    backgroundColor: colors.ustpCream,
    padding: spacing.lg,
    alignItems: 'center',
  },
  card: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  stepRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  stepPill: {
    flex: 1,
    minHeight: 34,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepPillActive: {
    backgroundColor: colors.ustpNavy,
    borderColor: colors.ustpNavy,
  },
  stepPillDone: {
    backgroundColor: colors.successBg,
    borderColor: colors.tagFacultyBorder,
  },
  stepPillText: {
    fontSize: typography.sizes.xxs,
    fontWeight: '800',
    color: colors.mutedSlate,
    textAlign: 'center',
    ...typography.tabularNums,
  },
  stepPillTextActive: {
    color: colors.ustpGold,
  },
  stepPillTextDone: {
    color: colors.successText,
  },
  stepContent: {
    gap: spacing.md,
  },
  stepIntro: {
    gap: spacing.xs,
  },
  cardHeading: {
    fontSize: typography.sizes.titleSm,
    lineHeight: typography.lineHeights.titleSm,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  cardSub: {
    fontSize: typography.sizes.sm,
    lineHeight: typography.lineHeights.sm,
    color: colors.mutedSlate,
  },
  monoBoldInline: {
    fontFamily: typography.fontFamilyMono,
    fontWeight: '800',
    color: colors.ustpNavy,
    ...typography.tabularNums,
  },
  errorStack: {
    gap: spacing.sm,
  },
  warningBox: {
    backgroundColor: colors.warningBg,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    borderRadius: radii.md,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  warningText: {
    flex: 1,
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '700',
    color: colors.warningText,
    ...typography.tabularNums,
  },
  infoBox: {
    backgroundColor: colors.infoBg,
    borderWidth: 1,
    borderColor: colors.infoBorder,
    borderRadius: radii.md,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  infoText: {
    flex: 1,
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '700',
    color: colors.infoText,
  },
  submittingBanner: {
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  submittingBannerText: {
    flex: 1,
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.ustpNavy,
  },
  fieldGroup: {
    gap: spacing.xs,
  },
  fieldLabel: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '800',
    color: colors.ustpText,
  },
  textInput: {
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.sizes.body,
    lineHeight: typography.lineHeights.body,
    backgroundColor: colors.white,
    color: colors.ustpText,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
  },
  monoInput: {
    fontFamily: typography.fontFamilyMono,
    ...typography.tabularNums,
  },
  otpInput: {
    fontFamily: typography.fontFamilyMono,
    fontSize: typography.sizes.titleLg,
    fontWeight: '900',
    letterSpacing: 10,
    textAlign: 'center',
    ...typography.tabularNums,
  },
  inputError: {
    borderColor: colors.dangerBorder,
    borderWidth: 2,
  },
  passwordWrap: {
    position: 'relative',
    justifyContent: 'center',
  },
  passwordInput: {
    paddingRight: 52,
  },
  eyeButton: {
    position: 'absolute',
    right: 0,
    minWidth: touchTarget.minWidth,
    minHeight: touchTarget.minHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldError: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '700',
    color: colors.dangerTitle,
  },
  primarySubmitBtn: {
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.md,
    backgroundColor: colors.ustpNavy,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  primarySubmitText: {
    fontSize: typography.sizes.body,
    fontWeight: '800',
    color: colors.ustpGold,
    ...typography.tabularNums,
  },
  secondaryActionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  flexBtn: {
    flex: 1,
  },
  secondaryBtn: {
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceSubtle,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
  },
  secondaryBtnText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpNavy,
    ...typography.tabularNums,
  },
  successHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  successTitleWrap: {
    flex: 1,
  },
  successTitle: {
    fontSize: typography.sizes.titleSm,
    lineHeight: typography.lineHeights.titleSm,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  successSubtitle: {
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.successText,
  },
  successBody: {
    fontSize: typography.sizes.body,
    lineHeight: typography.lineHeights.body,
    color: colors.ustpText,
  },
  disabledBtn: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.85,
  },
});
